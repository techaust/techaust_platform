// Rebuild PDF, the jobs consumer (JOB-PDF-02; JOB-PDF-01's recorded exception; run file docs/runs/rebuild-pdf.md, L3, L5, L6, L8, L10; owner Q2 = A, 2026-11-07:
// no mark, the rebuilt file prints exactly what the first printed). One `pdf.rebuild` message is one `pdf_repairs` request:
//   1. the request and its result (one read); a result already there: nothing to do;
//   2. the subject gone (unknown, anonymised client, redacted offer): result `skipped`, no render;
//   3. the old key checked again (R2's checksum, else a hash): present and matching: result `intact` / `original_present`, no render;
//   4. an object already at the new key (a redelivery after the put): adopted, result `rebuilt`;
//   5. the sealed record: the envelope (offers and the invoice family; missing: `failed` / `envelope_missing`, never re-made from rows, L5) or the sealed row;
//   6. the first render's own plan (`pdf.ts`, `receipts.ts`, `deed-pdf.ts`): a refusal is `refused` / its code, a `pdf.refused` bell (entity `pdf_repair`),
//      and no `pdf_failures` write;
//   7. the paced render with its integrity check (rate and quota: a delayed copy with `hop`; anything else throws and the queue retries);
//   8. the PDF stored write-once at the request's `new_key` (its SHA-256 passed to R2);
//   9. one batch: the `rebuilt` result and the statistics; when the subject was redacted or anonymised meanwhile the result is refused by its guard, the object
//      just stored is deleted and the result is `skipped` (the T7 pattern);
//  10. the owners' `pdf.rebuilt` bell.
// An object at the new key never outlives a request closed without a `rebuilt` result (early check change 3): every other result deletes it right after the
// result is written, and a redelivery of a closed request deletes it again (a
// redacted offer's stray `-rN` would otherwise survive erasure, since the redaction outbox queues only rebuilt keys); the dead letter adopts it while the
// subject may still be rebuilt.
// The frozen row and the old object are never touched. Bells name the document by its number (else "Untitled"); copy 07-ZV lines 16 to 18 (approved 2026-11-07).
// Ids, codes and counts only in logs.
import type { PdfRebuildMessage } from "@techaust/core/pdf-jobs";
import {
  REBUILD_EXPIRY_MARGIN_MS,
  REBUILD_HASH_MAX_BYTES,
  REBUILD_OPEN_MS,
  type RepairKind,
} from "@techaust/core/pdf-repair";
import { REPAIR_READ_SQL, RESULT_INSERT_SQL, type RepairReadRow } from "@techaust/db/pdf-repairs";
import { renderDocumentHtml } from "@techaust/pdf";
import { renderPaced } from "./browser.ts";
import { readCertificateView } from "./certificate.ts";
import { DEED_ROW_SQL, type DeedRow, deedPlan } from "./deed-pdf.ts";
import { logEvent } from "./log.ts";
import { type Clock, realClock } from "./pacer.ts";
import {
  BROWSER_ALERT_MS,
  bell,
  certificatePlan,
  dayOf,
  documentLabel,
  failed,
  HALF_BELL_SQL,
  type HtmlOf,
  invoiceCheck,
  invoicePlan,
  offerPlan,
  type PdfPage,
  putPdfOnce,
  RENDER_ROW_SQL,
  type RenderRow,
  sha256Bytes,
  stat,
} from "./pdf.ts";
import { receiptPlan, receiptRow } from "./receipts.ts";

/** The owners' bells of a rebuild (07-ZV lines 16 to 18 and 22, word for word). */
export const REBUILD_BELL = {
  rebuilt: (label: string) => `The PDF of ${label} was rebuilt.`,
  refused: (label: string) =>
    `The PDF of ${label} couldn't be rebuilt because its saved record didn't match. A developer needs to look at it.`,
  failed: (label: string) => `The PDF of ${label} couldn't be rebuilt. Open it to try again.`,
  /** 07-ZV line 22 (early check change 6): the saved record is missing, so trying again can't help. */
  envelopeMissing: (label: string) =>
    `The PDF of ${label} couldn't be rebuilt because its saved record is missing. A developer needs to look at it.`,
} as const;

export type RebuildOutcome =
  | "rebuilt"
  | "adopted"
  | "intact"
  | "refused"
  | "failed"
  | "skipped"
  | "delayed"
  | "done";

const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

/**
 * The stored object against its recorded hash (the admin route's `checkStored`, apps/admin/worker/pdf-rebuild.ts, read the same way): R2's own SHA-256 when the
 * head carries it, else a hash of the body (over `REBUILD_HASH_MAX_BYTES`, 2 MB: damaged, never read). A recorded hash of null (a supplier copy): the checksum against the bytes; with no
 * checksum a present copy counts as intact.
 */
export async function storedVerdict(
  docs: R2Bucket,
  key: string,
  recorded: string | null,
): Promise<"missing" | "damaged" | "intact"> {
  const head = await docs.head(key);
  if (head === null) return "missing";
  const stored = head.checksums.sha256 ? hex(head.checksums.sha256) : null;
  if (recorded !== null && stored !== null) return stored === recorded ? "intact" : "damaged";
  const expected = recorded ?? stored;
  if (expected === null) return "intact";
  const object = await docs.get(key);
  if (object === null) return "missing";
  if (object.size > REBUILD_HASH_MAX_BYTES) {
    await object.body.cancel();
    return "damaged";
  }
  return hex(await crypto.subtle.digest("SHA-256", await object.arrayBuffer())) === expected
    ? "intact"
    : "damaged";
}

// ---- the subject -----------------------------------------------------------------------------------------------------------------------------------------

/** What a plan gives: the page, or why not (a refusal of the sealed record, a gate that skips, the envelope missing). */
type PlanOutcome =
  | { ok: true; page: () => PdfPage }
  | { ok: false; code: string; as: "refused" | "skipped" | "failed" };

type Subject =
  | { found: false; code: "not_found" | "client_gone" | "redacted" }
  | { found: true; label: string; link: string; plan: () => Promise<PlanOutcome> };

const asPlan = (
  p: { ok: true; page: () => PdfPage } | { ok: false; code: string },
  skip = false,
): PlanOutcome => (p.ok ? p : { ok: false, code: p.code, as: skip ? "skipped" : "refused" });

const CERT_DOC_SQL = `SELECT d.id, d.number_display, d.redacted_at IS NOT NULL AS redacted,
    EXISTS (SELECT 1 FROM clients c WHERE c.id = d.client_id AND c.anonymised_at IS NOT NULL) AS client_gone
  FROM acceptances a JOIN documents d ON d.id = a.document_id WHERE a.id = ?1`;

/** The envelope of a document (offers and the invoice family): never re-made from the rows (L5). */
async function envelopeOf(env: Env, row: RenderRow): Promise<string | null> {
  if (row.snapshot_r2_key === null) return null;
  const object = await env.DOCS.get(row.snapshot_r2_key);
  return object === null ? null : object.text();
}

async function loadSubject(env: Env, req: RepairReadRow, htmlOf: HtmlOf): Promise<Subject> {
  const kind: RepairKind = req.subject_kind;
  if (kind === "offer" || kind === "invoice" || kind === "supplier") {
    const row = await env.DB.prepare(RENDER_ROW_SQL).bind(req.subject_id).first<RenderRow>();
    if (!row) return { found: false, code: "not_found" };
    if (row.client_gone) return { found: false, code: "client_gone" };
    if (row.redacted) return { found: false, code: "redacted" };
    if (!req.live) return { found: false, code: "not_found" };
    return {
      found: true,
      label: documentLabel(row.number_display),
      link: kind === "offer" ? `/proposals/${row.id}` : `/invoices/${row.id}`,
      plan: async () => {
        const text = await envelopeOf(env, row);
        if (text === null) return { ok: false, code: "envelope_missing", as: "failed" };
        if (kind === "offer") return asPlan(await offerPlan(env, row, text));
        const checked = await invoiceCheck(row, text);
        if (!checked.ok) return asPlan(checked);
        return asPlan(
          await invoicePlan(
            env,
            checked.envelope,
            row,
            kind === "supplier" ? "supplier" : "recipient",
            htmlOf,
          ),
        );
      },
    };
  }
  if (kind === "certificate") {
    const doc = await env.DB.prepare(CERT_DOC_SQL)
      .bind(req.subject_id)
      .first<{ id: string; number_display: string | null; redacted: number; client_gone: number }>();
    if (!doc) return { found: false, code: "not_found" };
    if (doc.client_gone) return { found: false, code: "client_gone" };
    if (doc.redacted) return { found: false, code: "redacted" };
    const read = req.live ? await readCertificateView(env.DB, req.subject_id) : null;
    if (!read) return { found: false, code: "not_found" };
    return {
      found: true,
      label: documentLabel(doc.number_display),
      link: `/proposals/${doc.id}`,
      // The rebuild never prints the live client name: a document without a frozen legal name is refused.
      plan: async () => asPlan(certificatePlan(read, { sealedName: true })),
    };
  }
  if (kind === "receipt") {
    const row = await receiptRow(env, req.subject_id);
    if (!row || row.frozen_at === null) return { found: false, code: "not_found" };
    if (row.anonymised_at !== null) return { found: false, code: "client_gone" };
    if (!req.live) return { found: false, code: "not_found" };
    return {
      found: true,
      label: documentLabel(row.number_display),
      link: "/payments",
      plan: async () => {
        const p = await receiptPlan(env, row);
        return p.ok ? p : { ok: false, code: p.code, as: p.skip ? "skipped" : "refused" };
      },
    };
  }
  const row = await env.DB.prepare(DEED_ROW_SQL).bind(req.subject_id).first<DeedRow>();
  if (!row) return { found: false, code: "not_found" };
  if (row.client_gone === 1) return { found: false, code: "client_gone" };
  if (!req.live) return { found: false, code: "not_found" };
  return {
    found: true,
    label: documentLabel(row.number_display),
    link: `/projects/${row.project_id}?tab=deed`,
    plan: async () => {
      const p = await deedPlan(env, row);
      return p.ok ? p : { ok: false, code: p.code, as: p.skip ? "skipped" : "refused" };
    },
  };
}

// ---- the consumer ----------------------------------------------------------------------------------------------------------------------------------------

/**
 * The result of a request that ended without a rebuilt file (`RESULT_INSERT_SQL`; once per request). Any object at the request's new key (a put whose result
 * batch never ran) is deleted so it never outlives the request (change 3; R2's delete of a missing key is a no-op), but only AFTER the result: when this run
 * wrote it, or when the result another run wrote is not `rebuilt`. A parallel run's `rebuilt` file is never deleted (review finding 3). Returns whether it
 * was written.
 */
export async function closeRequest(
  env: Env,
  req: Pick<RepairReadRow, "id" | "new_key">,
  outcome: "intact" | "refused" | "failed" | "skipped",
  code: string,
  now: number,
  bellStmt?: D1PreparedStatement,
): Promise<boolean> {
  const r = await env.DB.prepare(RESULT_INSERT_SQL).bind(req.id, outcome, code, null, null, now).run();
  const written = (r.meta.changes ?? 0) > 0;
  const other = written ? null : await env.DB.prepare(REPAIR_READ_SQL).bind(req.id).first<RepairReadRow>();
  if (written || other?.done_outcome !== "rebuilt") await env.DOCS.delete(req.new_key);
  // Only the run that wrote the result rings (re-check finding 3): a copy that lost the insert never rings "couldn't be rebuilt" beside a winner's bell.
  if (written && bellStmt) await env.DB.batch([bellStmt]);
  return written;
}

/**
 * A redelivery of a request that already has its result. When that result made no file, the new key is deleted again: a delete that failed after the result
 * committed (a transient R2 error) is retried here, so an erased person's stray `-rN` never stays (re-check finding 1; R2's delete of a missing key is a no-op).
 */
async function sweepClosed(env: Env, req: Pick<RepairReadRow, "new_key" | "done_outcome">): Promise<void> {
  if (req.done_outcome !== null && req.done_outcome !== "rebuilt") await env.DOCS.delete(req.new_key);
}

/** The `rebuilt` result with the statistics (`renders` when the browser did the work); false when its guard refused it (redacted or anonymised meanwhile). */
async function settleRebuilt(
  env: Env,
  req: RepairReadRow,
  stored: { sha256: string; bytes: number },
  usage: { browserMs: number } | null,
  subject: { label: string; link: string },
  now: number,
): Promise<boolean> {
  const date = dayOf(now);
  const [r] = await env.DB.batch([
    env.DB.prepare(RESULT_INSERT_SQL).bind(req.id, "rebuilt", null, stored.sha256, stored.bytes, now),
    ...(usage
      ? [
          stat(env, date, "pdf.renders", 1, now),
          stat(env, date, "pdf.browser_ms", usage.browserMs, now),
          env.DB.prepare(HALF_BELL_SQL).bind(
            date,
            BROWSER_ALERT_MS,
            "Half of today's PDF allowance is used.",
          ),
        ]
      : []),
  ]);
  if ((r?.meta.changes ?? 0) > 0) {
    // Counted only once the result is written: a result the guard refused (redacted or anonymised meanwhile) is no rebuild (review finding 2). The
    // browser's time and render above count either way: the browser was used.
    await env.DB.batch([
      stat(env, date, "pdf.rebuilds", 1, now),
      bell(env, "pdf.rebuilt", "pdf_repair", req.id, REBUILD_BELL.rebuilt(subject.label), subject.link),
    ]);
    return true;
  }
  // Not written: another run wrote the result, or the subject may no longer be rebuilt (redacted, anonymised): then the file just stored goes (T7).
  const again = await env.DB.prepare(REPAIR_READ_SQL).bind(req.id).first<RepairReadRow>();
  if (again && again.done_outcome === null && !again.live) {
    const now2 = await loadSubject(env, again, renderDocumentHtml);
    const code = now2.found ? "not_found" : now2.code;
    await closeRequest(env, req, "skipped", code, now);
    logEvent("pdf.rebuild_skipped", { why: code, after: "put" });
  } else if (again && again.done_outcome !== null && again.done_outcome !== "rebuilt") {
    // A parallel run closed the request without a file while this one stored it: the stray object goes too (change 3).
    await env.DOCS.delete(req.new_key);
  }
  return false;
}

/**
 * Handles one `pdf.rebuild` message. `clock` is the pacer's and `htmlOf` the invoice layout (a test passes its own). Throws for anything a retry can fix (D1,
 * R2, a failed render); returns for everything else.
 */
export async function processRebuild(
  env: Env,
  msg: PdfRebuildMessage,
  now = Date.now(),
  clock: Clock = realClock,
  htmlOf: HtmlOf = renderDocumentHtml,
): Promise<RebuildOutcome> {
  const req = await env.DB.prepare(REPAIR_READ_SQL).bind(msg.repairId).first<RepairReadRow>();
  if (!req) {
    logEvent("pdf.rebuild_skipped", { why: "no_request" });
    return "skipped";
  }
  if (req.done_outcome !== null) {
    await sweepClosed(env, req);
    logEvent("pdf.rebuild_skipped", { why: "done" });
    return "done";
  }
  const subject = await loadSubject(env, req, htmlOf);
  if (!subject.found) {
    await closeRequest(env, req, "skipped", subject.code, now);
    logEvent("pdf.rebuild_skipped", { why: subject.code, kind: req.subject_kind });
    return "skipped";
  }
  // The old file came back (or was never lost): nothing is rebuilt. Before the expiry below, so a late message for an original that came back reads intact
  // (re-check finding 2); it needs no render.
  if ((await storedVerdict(env.DOCS, req.old_key, req.old_sha256)) === "intact") {
    await closeRequest(env, req, "intact", "original_present", now);
    logEvent("pdf.rebuild_intact", { kind: req.subject_kind });
    return "intact";
  }
  // A request the admin no longer counts as open (L12: 26 hours; a quota delay can carry a message past it) is never rendered: the Owner may already have
  // asked again, and two renders would spend the day's Browser Run time twice (review finding 4). An hour's margin keeps this side first.
  // Before the adoption below: past the window a late object could race a newer request's served key.
  if (now - req.requested_at >= REBUILD_OPEN_MS - REBUILD_EXPIRY_MARGIN_MS) {
    await closeRequest(
      env,
      req,
      "failed",
      "expired",
      now,
      bell(env, "pdf.failed", "pdf_repair", req.id, REBUILD_BELL.failed(subject.label), subject.link),
    );
    logEvent("pdf.rebuild_failed", { stage: "rebuild", code: "expired", kind: req.subject_kind });
    return "failed";
  }
  // A redelivery after the put: the file stored at the new key is adopted, never rendered twice.
  const already = await env.DOCS.get(req.new_key);
  if (already !== null) {
    const bytes = new Uint8Array(await already.arrayBuffer());
    const ok = await settleRebuilt(
      env,
      req,
      { sha256: await sha256Bytes(bytes), bytes: bytes.byteLength },
      null,
      subject,
      now,
    );
    logEvent("pdf.rebuild_adopted", { kind: req.subject_kind, ok });
    return ok ? "adopted" : "skipped";
  }
  const plan = await subject.plan();
  if (!plan.ok) {
    const title =
      plan.as === "refused"
        ? REBUILD_BELL.refused(subject.label)
        : plan.code === "envelope_missing"
          ? REBUILD_BELL.envelopeMissing(subject.label)
          : REBUILD_BELL.failed(subject.label);
    const ring =
      plan.as === "skipped"
        ? undefined
        : bell(
            env,
            plan.as === "refused" ? "pdf.refused" : "pdf.failed",
            "pdf_repair",
            req.id,
            title,
            subject.link,
          );
    await closeRequest(env, req, plan.as, plan.code, now, ring);
    logEvent(plan.as === "refused" ? "pdf.refused" : "pdf.rebuild_failed", {
      stage: "rebuild",
      code: plan.code,
      kind: req.subject_kind,
    });
    return plan.as;
  }
  const page = plan.page();
  const result = await renderPaced(env, page.html, page.options, clock);
  if (!result.ok) return failed(env, msg, result, now);
  const stored = await putPdfOnce(env.DOCS, req.new_key, result.bytes);
  const ok = await settleRebuilt(
    env,
    req,
    { sha256: stored.sha256, bytes: stored.bytes.byteLength },
    { browserMs: result.browserMs },
    subject,
    now,
  );
  logEvent("pdf.rebuilt", {
    kind: req.subject_kind,
    bytes: stored.bytes.byteLength,
    browserMs: result.browserMs,
    hop: msg.hop,
    ok,
  });
  return ok ? "rebuilt" : "skipped";
}

/**
 * A `pdf.rebuild` that ran out of tries: the request ends `failed` / `dead_letter` and the owners get one bell (07-ZV line 18). A file already stored at the
 * new key (its put went through, the result batch never did) is adopted while the subject may still be rebuilt, else deleted with the `failed` result
 * (change 3). Throws on D1 errors.
 */
export async function processRebuildDeadLetter(
  env: Env,
  msg: PdfRebuildMessage,
  now = Date.now(),
): Promise<"adopted" | "failed" | "done"> {
  const req = await env.DB.prepare(REPAIR_READ_SQL).bind(msg.repairId).first<RepairReadRow>();
  logEvent("pdf.rebuild_dead_letter", { found: req !== null, done: req?.done_outcome != null });
  if (!req) return "done";
  if (req.done_outcome !== null) {
    await sweepClosed(env, req);
    return "done";
  }
  const subject = await loadSubject(env, req, renderDocumentHtml);
  if (subject.found) {
    const already = await env.DOCS.get(req.new_key);
    if (already !== null) {
      const bytes = new Uint8Array(await already.arrayBuffer());
      const sha256 = await sha256Bytes(bytes);
      const ok = await settleRebuilt(env, req, { sha256, bytes: bytes.byteLength }, null, subject, now);
      logEvent("pdf.rebuild_adopted", { kind: req.subject_kind, ok, after: "dead_letter" });
      if (ok) return "adopted";
      // Not written: settleRebuilt closed it (skipped) or another run did; nothing is left to end here.
      const back = await env.DB.prepare(REPAIR_READ_SQL).bind(req.id).first<RepairReadRow>();
      if (back?.done_outcome != null) return "done";
    }
  }
  const label = subject.found ? subject.label : "Untitled";
  const link = subject.found ? subject.link : "/";
  await closeRequest(
    env,
    req,
    "failed",
    "dead_letter",
    now,
    bell(env, "pdf.failed", "pdf_repair", req.id, REBUILD_BELL.failed(label), link),
  );
  return "failed";
}
