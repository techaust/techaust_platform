// The PDF of a sent proposal or estimate (M4.4, JOB-PDF-01). VERIFY WITH CA/LEGAL: the PDF is the evidence an acceptance is tied to (run file).
//   send route -> `pdf.snapshot` (admin `afterSend`, through waitUntil)
//   snapshot  -> reads the sent rows in ONE batch, checks the seal with the send route's own functions (`envelopeOfBundle`), writes the
//                R2 envelope (`docs/<type>/<fy>/<nnnn>-v<v>.json`, once, never overwritten), sets `snapshot_r2_key`, enqueues `pdf.render`.
//   render    -> reads the envelope from R2 (never from the live rows), verifies every hash, renders the HTML, calls Browser Run (paced:
//                one call every 10 s), writes the PDF (once), sets `pdf_r2_key` and `pdf_sha256` (set-once after the freeze), counts it.
//   sweep     -> the daily cron enqueues ONE `pdf.sweep`; it picks at most 20 sent documents without a PDF (`documents_pdf_pending`) and
//                enqueues a `pdf.snapshot` for each. The cron itself reads nothing.
// M4.5 adds to this queue: `pdf.certificate` (the acceptance certificate: the same paced render, the same error table, the same put-once
// helper; then `offer.accepted` follows) and `offer.sweep` (the waiting offer emails and the missing certificates). After a document's PDF is
// stored, or found already stored, `onRendered` queues the offer emails that were waiting for it (offers.ts).
// Errors (the table of the brief): a rate limit sends a delayed copy and acknowledges (`hop` counts them, cap 30); the daily quota does the
// same until the next UTC midnight + 120 s and rings the owners' bell once a day; a bad render, an upstream error or a non-PDF is thrown,
// so the queue retries with backoff (5 tries) and then the dead-letter queue rings the bell. An envelope that fails verification is never
// rendered: it rings the bell and is acknowledged (a retry cannot help). No personal data in a log line or a bell title: ids, numbers, kinds.

import { todayIst } from "@techaust/core/offers";
import {
  isPdfMessage,
  nextUtcMidnight,
  type OfferSweepMessage,
  PDF_MAX_HOPS,
  type PdfCertificateMessage,
  type PdfRenderMessage,
  type PdfSnapshotMessage,
  type PdfSweepMessage,
  pdfKeys,
  utcDateOf,
} from "@techaust/core/pdf-jobs";
import { bundleOf, loadStatements, type TermsRow } from "@techaust/db/documents";
import {
  type Envelope,
  envelopeOfBundle,
  type PdfView,
  parseEnvelope,
  pdfOptionsFor,
  renderCertificateHtml,
  renderDocumentHtml,
  serializeEnvelope,
  toPdfView,
  verifyEnvelope,
  viewConfigFor,
} from "@techaust/pdf";
import { type RenderEnv, renderPaced } from "./browser.ts";
import { readCertificateView } from "./certificate.ts";
import { logEvent } from "./log.ts";
import { processOfferSweep, queueAcceptedConfirmation, queueWaitingSends } from "./offers.ts";
import { type Clock, realClock } from "./pacer.ts";

/** The Free plan's Browser Run time: 10 minutes a day. The bell rings once at half of it. */
export const BROWSER_DAILY_MS = 600_000;
export const BROWSER_ALERT_MS = BROWSER_DAILY_MS / 2;
/** A run of the sweep enqueues at most this many documents. */
export const SWEEP_LIMIT = 20;
/** A document is swept only once it is older than this (the send route's own enqueue gets the first chance). */
export const SWEEP_GRACE_MS = 600_000;
/** The queue keeps a message for 24 hours; a delay stays an hour under that, so the delayed copy is never lost to retention. */
const MAX_DELAY_S = 82_800;
/** After the daily quota resets at 00:00 UTC, wait this long before trying again. */
const QUOTA_MARGIN_MS = 120_000;

const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
/** The bell lines of 07-P §4 (word for word). */
export const BELL_COPY = {
  failed: (number: string, version: number) =>
    `The PDF for ${number} v${version} could not be made. Open it to try again.`,
  /** A PDF that failed its integrity check (07-Q Q9, owner 2026-10-26): it was not sent; the same check would fail again, so a person looks. */
  integrity: (label: string) =>
    `The PDF of ${label} didn't match its saved copy, so it wasn't sent. A developer needs to look at it before it can be sent.`,
  half: "Half of today's PDF allowance is used.",
  quota: "Today's PDF allowance is used up. Waiting PDFs are made tomorrow.",
} as const;

/** What a bell calls a document: its number, else "Untitled" (a sent version always has a number; this is the safety net). Never the title: a staff-typed title can hold a client name, and a bell outlives an anonymised client (07-Q, lead 2026-10-26). */
export const documentLabel = (number: string | null): string => number?.trim() || "Untitled";

export const sha256Bytes = async (bytes: Uint8Array): Promise<string> =>
  hex(await crypto.subtle.digest("SHA-256", bytes));

// ---- the bell and the statistics ---------------------------------------------------------------------------------------------------

const BELL_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), u.id, ?1, ?2, ?3, ?4, ?5 FROM staff_users u WHERE u.status = 'active' AND u.role = 'owner'`;

const bell = (
  env: Env,
  kind: string,
  entityType: string,
  entityId: string,
  title: string,
  link: string,
): D1PreparedStatement => env.DB.prepare(BELL_SQL).bind(kind, entityType, entityId, title, link);

/** The half-of-the-day bell, written only once the day's total has reached the threshold (`?1` date, `?2` threshold, `?3` title). */
export const HALF_BELL_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), u.id, 'pdf.browser_half', 'system', ?1, ?3, '/'
  FROM staff_users u WHERE u.status = 'active' AND u.role = 'owner'
    AND (SELECT value FROM stats_daily WHERE date = ?1 AND metric = 'pdf.browser_ms' AND dimension = '') >= ?2`;

/** Adds to one counter of `stats_daily` (`?1` date, `?2` metric, `?3` amount, `?4` time). The dimension is always empty. */
export const STAT_ADD_SQL = `INSERT INTO stats_daily (date, metric, dimension, value, updated_at) VALUES (?1, ?2, '', ?3, ?4)
  ON CONFLICT(date, metric, dimension) DO UPDATE SET value = value + excluded.value, updated_at = excluded.updated_at`;

const stat = (env: Env, date: string, metric: string, amount: number, now: number) =>
  env.DB.prepare(STAT_ADD_SQL).bind(date, metric, amount, now);

// ---- R2: write once -------------------------------------------------------------------------------------------------------------------

/**
 * Writes an object that must never be replaced. A `head` first (a cheap miss), then a put that fails if the key exists (`If-None-Match: *`,
 * R2 `onlyIf`). `existing` hands back the object that was already there.
 */
async function putOnce(
  bucket: R2Bucket,
  key: string,
  body: string | Uint8Array,
  contentType: string,
): Promise<{ created: true } | { created: false; existing: R2ObjectBody }> {
  if ((await bucket.head(key)) === null) {
    const put = await bucket.put(key, body, {
      httpMetadata: { contentType },
      onlyIf: { etagDoesNotMatch: "*" },
    });
    if (put !== null) return { created: true };
  }
  const existing = await bucket.get(key);
  if (existing === null) throw new Error("r2: the put was refused but no object is there");
  return { created: false, existing };
}

// ---- snapshot --------------------------------------------------------------------------------------------------------------------------

export type SnapshotOutcome = "queued" | "skipped" | "refused";

/** Handles one `pdf.snapshot` message. Throws for anything a retry can fix (D1, R2, the queue); returns for everything else. */
export async function processSnapshot(env: Env, msg: PdfSnapshotMessage): Promise<SnapshotOutcome> {
  const bundle = bundleOf<TermsRow>(await env.DB.batch(loadStatements(env.DB, msg.documentId)));
  if (!bundle) return skip("not_found");
  const d = bundle.document;
  const label = documentLabel(d.number_display);
  if (d.pdf_sha256 !== null) return skip("done");
  // An erased client takes nothing new: no envelope, no PDF, no bell (the standing rule for anonymised clients; VERIFY WITH CA/LEGAL).
  if (await clientIsGone(env, d.client_id)) return skip("client_gone");
  const made = await envelopeOfBundle(bundle);
  if (!made.ok) {
    if (made.code === "unsupported_type" || made.code === "not_sent") return skip(made.code);
    // The rows do not reproduce what the send route sealed: nothing is written, the owners are told, and a retry cannot help.
    logEvent("pdf.refused", { stage: "snapshot", code: made.code });
    await env.DB.batch([
      bell(env, "pdf.failed", "document", d.id, BELL_COPY.integrity(label), `/proposals/${d.id}`),
    ]);
    return "refused";
  }
  const e = made.envelope;
  const keys = pdfKeys({ type: e.type, fy: e.fy, number: e.number, version: e.version });
  const text = serializeEnvelope(e);
  const put = await putOnce(env.DOCS, keys.snapshot, text, "application/json");
  if (!put.created && (await put.existing.text()) !== text) {
    // A different envelope already holds the key: never overwritten, never rendered from; a person looks.
    logEvent("pdf.refused", { stage: "snapshot", code: "key_conflict" });
    await env.DB.batch([
      bell(env, "pdf.failed", "document", d.id, BELL_COPY.integrity(label), `/proposals/${d.id}`),
    ]);
    return "refused";
  }
  await env.DB.prepare("UPDATE documents SET snapshot_r2_key = ?2 WHERE id = ?1 AND snapshot_r2_key IS NULL")
    .bind(d.id, keys.snapshot)
    .run();
  await env.PDF_QUEUE.send({ v: 1, kind: "pdf.render", documentId: d.id, hop: 0 } satisfies PdfRenderMessage);
  logEvent("pdf.snapshot", { reason: msg.reason, created: put.created });
  return "queued";
}

const GONE_SQL = "SELECT 1 AS gone FROM clients WHERE id = ?1 AND anonymised_at IS NOT NULL";
async function clientIsGone(env: Env, clientId: string): Promise<boolean> {
  return (await env.DB.prepare(GONE_SQL).bind(clientId).first()) !== null;
}

function skip(why: string): SnapshotOutcome {
  logEvent("pdf.snapshot_skipped", { why });
  return "skipped";
}

// ---- render ----------------------------------------------------------------------------------------------------------------------------

type RenderRow = {
  id: string;
  type: string;
  frozen_at: number | null;
  fy: string | null;
  number: number | null;
  number_display: string | null;
  title: string | null;
  version: number;
  snapshot_r2_key: string | null;
  snapshot_sha256: string | null;
  pdf_sha256: string | null;
  client_gone: number;
};

export const RENDER_ROW_SQL = `SELECT id, type, frozen_at, fy, number, number_display, title, version, snapshot_r2_key, snapshot_sha256, pdf_sha256,
  EXISTS (SELECT 1 FROM clients c WHERE c.id = documents.client_id AND c.anonymised_at IS NOT NULL) AS client_gone
  FROM documents WHERE id = ?1`;

/** The view of an envelope as this Worker prints it: the acceptance box names the host of `PORTAL_URL` (07-P §1). */
export const viewOf = (env: Pick<Env, "PORTAL_URL">, envelope: Envelope): PdfView =>
  toPdfView(envelope, viewConfigFor(env.PORTAL_URL));

export type RenderOutcome = "rendered" | "adopted" | "delayed" | "skipped" | "refused" | "resnapshot";

/**
 * What the rest of the system learns when a PDF is stored (M4.5). A document's PDF queues the offer emails that were waiting for it; an
 * acceptance certificate queues the confirmation emails. Both are idempotent, and both are called again when a redelivery finds the work
 * already done, so an `onRendered` that failed once is completed by the retry.
 */
export type RenderedEvent =
  | { kind: "document"; documentId: string }
  | { kind: "certificate"; acceptanceId: string };
export async function onRendered(env: Env, event: RenderedEvent): Promise<void> {
  if (event.kind === "document") await queueWaitingSends(env, event.documentId);
  else await queueAcceptedConfirmation(env, event.acceptanceId);
}

const dayOf = (now: number) => utcDateOf(now);

/** Saves a stored PDF on the row once, and counts the render in the statistics when the browser did the work. */
async function settle(
  env: Env,
  row: RenderRow,
  pdfKey: string,
  pdfSha256: string,
  usage: { renders: number; browserMs: number },
  now: number,
): Promise<void> {
  const date = dayOf(now);
  const statements = [
    env.DB.prepare(
      "UPDATE documents SET pdf_r2_key = ?2, pdf_sha256 = ?3 WHERE id = ?1 AND pdf_sha256 IS NULL",
    ).bind(row.id, pdfKey, pdfSha256),
  ];
  if (usage.renders > 0) {
    statements.push(
      stat(env, date, "pdf.renders", usage.renders, now),
      stat(env, date, "pdf.browser_ms", usage.browserMs, now),
      env.DB.prepare(HALF_BELL_SQL).bind(date, BROWSER_ALERT_MS, BELL_COPY.half),
    );
  }
  await env.DB.batch(statements);
  await onRendered(env, { kind: "document", documentId: row.id });
}

/** Handles one `pdf.render` message. `clock` is the pacer's (a test passes a fake). */
export async function processRender(
  env: Env,
  msg: PdfRenderMessage,
  now = Date.now(),
  clock: Clock = realClock,
): Promise<RenderOutcome> {
  const row = await env.DB.prepare(RENDER_ROW_SQL).bind(msg.documentId).first<RenderRow>();
  if (!row || row.frozen_at === null || (row.type !== "proposal" && row.type !== "estimate")) {
    logEvent("pdf.render_skipped", { why: row ? "not_supported" : "not_found" });
    return "skipped";
  }
  if (row.pdf_sha256 !== null) {
    // Done already. A redelivery whose first run stored the PDF but died before `onRendered` completes it here (idempotent).
    await onRendered(env, { kind: "document", documentId: row.id });
    logEvent("pdf.render_skipped", { why: "done" });
    return "skipped";
  }
  // Anonymised while the render waited (a quota or rate delay): no PDF, no `onRendered` (the standing rule; VERIFY WITH CA/LEGAL).
  if (row.client_gone) {
    logEvent("pdf.render_skipped", { why: "client_gone" });
    return "skipped";
  }
  if (row.snapshot_r2_key === null) {
    // The envelope step has not finished (or its row update was lost): do it again, then the render follows.
    await env.PDF_QUEUE.send({
      v: 1,
      kind: "pdf.snapshot",
      documentId: row.id,
      reason: "retry",
    } satisfies PdfSnapshotMessage);
    return "resnapshot";
  }
  const envelopeObject = await env.DOCS.get(row.snapshot_r2_key);
  if (envelopeObject === null) throw new Error("the envelope object is missing");
  const envelope = parseEnvelope(await envelopeObject.text());
  const verdict =
    envelope === null
      ? ({ ok: false, code: "shape" } as const)
      : envelope.documentId !== row.id || envelope.snapshotSha256 !== row.snapshot_sha256
        ? ({ ok: false, code: "row_mismatch" } as const)
        : await verifyEnvelope(envelope);
  if (!envelope || !verdict.ok) {
    logEvent("pdf.refused", { stage: "render", code: verdict.ok ? "unknown" : verdict.code });
    await env.DB.batch([
      bell(
        env,
        "pdf.failed",
        "document",
        row.id,
        BELL_COPY.integrity(documentLabel(row.number_display)),
        `/proposals/${row.id}`,
      ),
    ]);
    return "refused";
  }
  const keys = pdfKeys({
    type: envelope.type,
    fy: envelope.fy,
    number: envelope.number,
    version: envelope.version,
  });

  // A PDF stored by an earlier run whose row update was lost: the first one stays, a document is never rendered twice.
  const already = await env.DOCS.get(keys.pdf);
  if (already !== null) {
    await settle(
      env,
      row,
      keys.pdf,
      await sha256Bytes(new Uint8Array(await already.arrayBuffer())),
      { renders: 0, browserMs: 0 },
      now,
    );
    logEvent("pdf.adopted", {});
    return "adopted";
  }

  const view = viewOf(env, envelope);
  const result = await renderPaced(env, renderDocumentHtml(view), pdfOptionsFor(view), clock);
  if (!result.ok) return failed(env, msg, result, now);

  const stored = await putOnce(env.DOCS, keys.pdf, result.bytes, "application/pdf");
  const bytes = stored.created ? result.bytes : new Uint8Array(await stored.existing.arrayBuffer());
  await settle(
    env,
    row,
    keys.pdf,
    await sha256Bytes(bytes),
    { renders: 1, browserMs: result.browserMs },
    now,
  );
  logEvent("pdf.rendered", { bytes: bytes.byteLength, browserMs: result.browserMs, hop: msg.hop });
  return "rendered";
}

/** A render that did not give a PDF: delay (rate, quota) or throw (anything a retry might fix). */
async function failed(
  env: Env,
  msg: PdfRenderMessage | PdfCertificateMessage,
  result: Exclude<Awaited<ReturnType<typeof renderPaced>>, { ok: true }>,
  now: number,
): Promise<"delayed"> {
  if (result.kind === "rate" || result.kind === "quota") {
    if (msg.hop >= PDF_MAX_HOPS) throw new Error(`pdf: ${result.kind} limit, ${PDF_MAX_HOPS} hops used`);
    let delay: number;
    if (result.kind === "rate") {
      delay = Math.max(result.retryAfterS, 10);
    } else {
      delay = Math.min(MAX_DELAY_S, Math.ceil((nextUtcMidnight(now) + QUOTA_MARGIN_MS - now) / 1000));
      // Counted, and the bell rings once a day (unique per owner, kind and date).
      await env.DB.batch([
        stat(env, dayOf(now), "pdf.quota_hits", 1, now),
        bell(env, "pdf.quota", "system", dayOf(now), BELL_COPY.quota, "/"),
      ]);
    }
    await env.PDF_QUEUE.send({ ...msg, hop: msg.hop + 1 }, { delaySeconds: delay });
    logEvent("pdf.delayed", { kind: result.kind, delay, hop: msg.hop + 1 });
    return "delayed";
  }
  logEvent("pdf.render_failed", { kind: result.kind });
  throw new Error(`pdf render failed: ${result.kind}`);
}

// ---- certificate ------------------------------------------------------------------------------------------------------------------

export type CertificateOutcome = "rendered" | "adopted" | "delayed" | "skipped";

/**
 * Handles one `pdf.certificate` message (M4.5, ADM-PROP-08). The same paced render as a document (`renderPaced`, `failed`, `putOnce`), so a
 * burst of acceptances and sends never makes more than one Browser Run call per 10 s. The certificate is rendered ONCE: a head before the
 * render, `If-None-Match: *` on the put, `INSERT OR IGNORE` on the row (append-only). Then `onRendered` queues the confirmation emails.
 * The data is the evidence row read in one query, never the live document.
 */
export async function processCertificate(
  env: Env,
  msg: PdfCertificateMessage,
  now = Date.now(),
  clock: Clock = realClock,
): Promise<CertificateOutcome> {
  const read = await readCertificateView(env.DB, msg.acceptanceId);
  if (read === null) {
    logEvent("pdf.certificate_skipped", { why: "no_acceptance" });
    return "skipped";
  }
  if (read.rendered) {
    await onRendered(env, { kind: "certificate", acceptanceId: msg.acceptanceId });
    logEvent("pdf.certificate_skipped", { why: "done" });
    return "skipped";
  }
  const insert = (sha: string, stats?: { browserMs: number }) => {
    const date = dayOf(now);
    const statements = [
      env.DB.prepare(
        "INSERT OR IGNORE INTO acceptance_certificates (acceptance_id, r2_key, sha256, rendered_at) VALUES (?1, ?2, ?3, ?4)",
      ).bind(msg.acceptanceId, read.key, sha, now),
    ];
    if (stats) {
      statements.push(
        stat(env, date, "pdf.renders", 1, now),
        stat(env, date, "pdf.browser_ms", stats.browserMs, now),
        env.DB.prepare(HALF_BELL_SQL).bind(date, BROWSER_ALERT_MS, BELL_COPY.half),
      );
    }
    return env.DB.batch(statements);
  };

  // A certificate stored by an earlier run whose row write was lost: the first one stays, an acceptance never gets two.
  const already = await env.DOCS.get(read.key);
  if (already !== null) {
    await insert(await sha256Bytes(new Uint8Array(await already.arrayBuffer())));
    await onRendered(env, { kind: "certificate", acceptanceId: msg.acceptanceId });
    logEvent("pdf.certificate_adopted", {});
    return "adopted";
  }

  const result = await renderPaced(
    env as unknown as RenderEnv,
    renderCertificateHtml(read.view),
    pdfOptionsFor(),
    clock,
  );
  if (!result.ok) return failed(env, msg, result, now);
  const stored = await putOnce(env.DOCS, read.key, result.bytes, "application/pdf");
  const bytes = stored.created ? result.bytes : new Uint8Array(await stored.existing.arrayBuffer());
  await insert(await sha256Bytes(bytes), { browserMs: result.browserMs });
  await onRendered(env, { kind: "certificate", acceptanceId: msg.acceptanceId });
  logEvent("pdf.certificate_rendered", {
    bytes: bytes.byteLength,
    browserMs: result.browserMs,
    hop: msg.hop,
  });
  return "rendered";
}

// ---- sweep -----------------------------------------------------------------------------------------------------------------------------

/** The sweep's pick (`?1` the newest `frozen_at` it may take). Exported so a test can EXPLAIN it: it must use `documents_pdf_pending`. */
export const SWEEP_SQL = `SELECT id FROM documents INDEXED BY documents_pdf_pending
  WHERE frozen_at IS NOT NULL AND pdf_sha256 IS NULL AND type IN ('proposal', 'estimate') AND frozen_at <= ?1
    AND NOT EXISTS (SELECT 1 FROM clients z WHERE z.id = documents.client_id AND z.anonymised_at IS NOT NULL)
  ORDER BY frozen_at LIMIT ${SWEEP_LIMIT}`;

/** Handles one `pdf.sweep` message: enqueues a snapshot for each sent document that still has no PDF (at most 20 per run). */
export async function processSweep(env: Env, msg: PdfSweepMessage): Promise<number> {
  const { results } = await env.DB.prepare(SWEEP_SQL)
    .bind(msg.asOf - SWEEP_GRACE_MS)
    .all<{ id: string }>();
  if (results.length > 0) {
    await env.PDF_QUEUE.sendBatch(
      results.map((r) => ({
        body: { v: 1, kind: "pdf.snapshot", documentId: r.id, reason: "sweep" } satisfies PdfSnapshotMessage,
      })),
    );
  }
  logEvent("pdf.sweep", { picked: results.length });
  return results.length;
}

/** The cron's one job for PDFs: enqueue ONE sweep message. No D1 read. */
export async function enqueueSweep(env: Env, scheduledTime: number): Promise<void> {
  // One `sendBatch` of two messages (still one queue operation): the PDF sweep (M4.4) and the offer sweep (M4.5).
  await env.PDF_QUEUE.sendBatch([
    { body: { v: 1, kind: "pdf.sweep", asOf: scheduledTime } satisfies PdfSweepMessage },
    { body: { v: 1, kind: "offer.sweep", asOf: scheduledTime } satisfies OfferSweepMessage },
  ]);
}

// ---- the queues ------------------------------------------------------------------------------------------------------------------------

/** Routes one message of the PDF queue. A body this version cannot use is logged and acknowledged (a retry cannot help). */
export async function processPdf(
  env: Env,
  body: unknown,
  now = Date.now(),
  clock: Clock = realClock,
): Promise<void> {
  if (!isPdfMessage(body)) {
    logEvent("pdf.unknown");
    return;
  }
  if (body.kind === "pdf.snapshot") await processSnapshot(env, body);
  else if (body.kind === "pdf.render") await processRender(env, body, now, clock);
  else if (body.kind === "pdf.certificate") await processCertificate(env, body, now, clock);
  else if (body.kind === "offer.sweep") await processOfferSweep(env, body);
  else await processSweep(env, body);
}

/**
 * A PDF message that ran out of tries: the owners are told (once per document and kind), and the next daily sweep picks the document up
 * again. A sweep that ran out of tries is only logged: tomorrow's cron enqueues another.
 */
export async function processPdfDeadLetter(env: Env, body: unknown, now = Date.now()): Promise<void> {
  if (isPdfMessage(body) && body.kind === "pdf.certificate") {
    // The acceptance is safe (its evidence row is written); only the certificate file is missing. The owners are told, the sweep tries again.
    // The bell is unique per (user, kind, entity), so the entity carries the IST day: a failure on a later day (the sweep's retry) rings again,
    // a redelivery on the same day does not.
    await env.DB.batch([
      bell(
        env,
        "pdf.failed",
        "acceptance",
        `${body.acceptanceId}:${todayIst(now)}`,
        "An acceptance certificate couldn't be made. We'll try again tonight.",
        "/",
      ),
    ]);
  } else if (isPdfMessage(body) && (body.kind === "pdf.snapshot" || body.kind === "pdf.render")) {
    const row = await env.DB.prepare(
      `SELECT number_display, version,
        EXISTS (SELECT 1 FROM clients c WHERE c.id = documents.client_id AND c.anonymised_at IS NOT NULL) AS client_gone
        FROM documents WHERE id = ?1`,
    )
      .bind(body.documentId)
      .first<{ number_display: string | null; version: number; client_gone: number }>();
    // No bell for an anonymised client: nothing is left to try again.
    if (row?.client_gone) {
      logEvent("pdf.dead_letter", { kind: body.kind, skipped: "client_gone" });
      return;
    }
    await env.DB.batch([
      bell(
        env,
        "pdf.failed",
        "document",
        body.documentId,
        BELL_COPY.failed(row?.number_display ?? "this document", row?.version ?? 1),
        `/proposals/${body.documentId}`,
      ),
    ]);
  }
  logEvent("pdf.dead_letter", { kind: isPdfMessage(body) ? body.kind : "unknown" });
}
