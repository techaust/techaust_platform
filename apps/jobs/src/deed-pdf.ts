// The deed of assignment's unsigned PDF and the signed-deed email (T11; run file docs/runs/t11-deed.md, L4, L5; 08-C RB-38(a), RB-21; POR-05).
//
// `pdf.deed` (PDF_QUEUE; one unit of work per message: the admin API sends it after the finalise batch, and on the Owner's "render again"):
//   (1) read the deed row and whether its client is anonymised; a deed that is not final or signed, already has its PDF, is gone, or belongs to an anonymised
//       client is acknowledged with no work (no PDF work for an anonymised client, M4.4's rule);
//   (2) the sealed snapshot: its SHA-256 must be the one sealed at finalising AND it must read back as a deed snapshot of a known layout, else it is REFUSED (the
//       owners' `pdf.refused` bell once, acknowledged, never retried: a retry cannot help), like a tampered invoice envelope;
//   (3) the text is core `deedText` (07-ZE word for word) with the number from the row (the number sits outside the seal, as an invoice's does);
//   (4) the object already at `deeds/<id>/unsigned-<snapshot sha>.pdf` is ADOPTED; otherwise the HTML is rendered through the paced Browser Run client with the
//       M4.4 error table (`failed`: rate and quota delay and re-send with `hop`; anything else throws and the queue retries, then the dead letter logs it);
//   (5) put once, then ONE batch: `unsigned_r2_key` and `unsigned_sha256` set only `WHERE unsigned_r2_key IS NULL` on a final or signed deed with the same seal
//       (the trigger `deeds_set_once` holds it too), and the render counted. `updated_at` is not moved: the Owner's open upload form stays current.
// While the PDF layout is the builder's placeholder (`DEED_LAYOUT_PLACEHOLDER`), deeds are rendered only when ENVIRONMENT is "local": nothing placeholder is ever
// stored write-once on staging or production.
//
// `deed.signed` (EMAIL_QUEUE; ids only): the admin API sends it after the sign batch. One batch reads the signed deed, its accepted version and the client's live
// portal contacts (at most `DEED_MAIL_MAX`); one `deed.signed` email per contact is queued (`email_log` id = template + deed + recipient, so a redelivery sends
// nothing twice). Staging sends only to `EMAIL_ALLOWED_RECIPIENTS` (the email consumer). The words are a placeholder until 07-ZJ is approved.
// No personal data in a log line or a bell title: ids, numbers, codes.
import { type DeedSignedMessage, deedSignedMessage, type EmailMessage } from "@techaust/core";
import { deedText, deedUnsignedKey, parseDeedSnapshot } from "@techaust/core/deeds";
import { sha256Hex } from "@techaust/core/hash";
import { firstNameOf } from "@techaust/core/offers";
import type { PdfDeedMessage } from "@techaust/core/pdf-jobs";
import { DEED_LAYOUT_PLACEHOLDER, DEED_PDF_LAYOUT_ID, pdfOptionsFor, renderDeedHtml } from "@techaust/pdf";
import { portalBase } from "./billing-shared.ts";
import { type RenderEnv, renderPaced } from "./browser.ts";
import { logEvent } from "./log.ts";
import { type Clock, realClock } from "./pacer.ts";
import {
  BROWSER_ALERT_MS,
  dayOf,
  failed,
  HALF_BELL_SQL,
  putPdfOnce,
  STAT_ADD_SQL,
  sha256Bytes,
} from "./pdf.ts";
import { sendChunked } from "./send-batch.ts";

export const DEED_ROW_SQL = `SELECT d.id, d.status, d.client_id, d.project_id, d.number_display, d.snapshot, d.snapshot_sha256, d.unsigned_r2_key,
    EXISTS (SELECT 1 FROM clients c WHERE c.id = d.client_id AND c.anonymised_at IS NOT NULL) AS client_gone
  FROM deeds d WHERE d.id = ?1`;

type DeedRow = {
  id: string;
  status: string;
  client_id: string;
  project_id: string;
  number_display: string | null;
  snapshot: string | null;
  snapshot_sha256: string | null;
  unsigned_r2_key: string | null;
  client_gone: number;
};

/** The owners' bell when a deed's sealed values fail their check: 07-ZJ line 32 (approved by the lead under the owner's delegation, 2026-11-01). */
export const DEED_REFUSED_BELL = (number: string) =>
  `The PDF of deed ${number} didn't match its saved copy, so it wasn't made. A developer needs to look at it.`;

const REFUSED_BELL_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), u.id, 'pdf.refused', 'deed', ?1, ?2, ?3 FROM staff_users u WHERE u.status = 'active' AND u.role = 'owner'`;

export type DeedPdfOutcome = "rendered" | "adopted" | "delayed" | "skipped" | "refused";

const skip = (why: string): "skipped" => {
  logEvent("pdf.deed_skipped", { why });
  return "skipped";
};

/** Handles one `pdf.deed` message. `clock` is the pacer's (a test passes a fake). Throws for anything a retry can fix. */
export async function processDeedPdf(
  env: Env,
  msg: PdfDeedMessage,
  now = Date.now(),
  clock: Clock = realClock,
): Promise<DeedPdfOutcome> {
  const row = await env.DB.prepare(DEED_ROW_SQL).bind(msg.deedId).first<DeedRow>();
  if (!row) return skip("not_found");
  if (row.unsigned_r2_key !== null) return skip("done");
  if (row.status !== "final" && row.status !== "signed") return skip("not_final");
  if (row.client_gone === 1) return skip("client_gone");
  // The generated Env types ENVIRONMENT from the staging config ("staging"); the local config says "local" (browser.ts reads it the same way).
  const environment: string = env.ENVIRONMENT;
  if (DEED_LAYOUT_PLACEHOLDER && environment !== "local") return skip("layout_placeholder");

  // The seal: the stored text must hash to the sealed SHA-256 and read back as a deed snapshot; the number must be there. Anything else is refused, once.
  const snapshot = parseDeedSnapshot(row.snapshot);
  const sealed =
    row.snapshot !== null &&
    row.snapshot_sha256 !== null &&
    (await sha256Hex(row.snapshot)) === row.snapshot_sha256 &&
    snapshot !== null &&
    row.number_display !== null;
  if (!sealed || !snapshot || row.snapshot_sha256 === null || row.number_display === null) {
    await env.DB.batch([
      env.DB.prepare(REFUSED_BELL_SQL).bind(
        row.id,
        DEED_REFUSED_BELL(row.number_display ?? "Untitled"),
        `/projects/${row.project_id}?tab=deed`,
      ),
    ]);
    logEvent("pdf.refused", { stage: "render", code: "deed_seal", family: "deed" });
    return "refused";
  }

  const key = deedUnsignedKey(row.id, row.snapshot_sha256);
  const settle = async (pdfSha: string, usage: { browserMs: number } | null) => {
    const date = dayOf(now);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE deeds SET unsigned_r2_key = ?2, unsigned_sha256 = ?3
         WHERE id = ?1 AND unsigned_r2_key IS NULL AND status IN ('final', 'signed') AND snapshot_sha256 = ?4`,
      ).bind(row.id, key, pdfSha, row.snapshot_sha256),
      ...(usage
        ? [
            env.DB.prepare(STAT_ADD_SQL).bind(date, "pdf.renders", 1, now),
            env.DB.prepare(STAT_ADD_SQL).bind(date, "pdf.browser_ms", usage.browserMs, now),
            env.DB.prepare(HALF_BELL_SQL).bind(
              date,
              BROWSER_ALERT_MS,
              "Half of today's PDF allowance is used.",
            ),
          ]
        : []),
    ]);
  };

  // Already stored (a repeat, or an earlier run whose row update was lost): adopted, never rendered twice.
  const already = await env.DOCS.get(key);
  if (already !== null) {
    await settle(await sha256Bytes(new Uint8Array(await already.arrayBuffer())), null);
    logEvent("pdf.deed_adopted", { layout: DEED_PDF_LAYOUT_ID });
    return "adopted";
  }
  const html = renderDeedHtml(deedText(snapshot, row.number_display));
  const result = await renderPaced(env as unknown as RenderEnv, html, pdfOptionsFor(), clock);
  if (!result.ok) return failed(env, msg, result, now);
  const { bytes, sha256 } = await putPdfOnce(env.DOCS, key, result.bytes);
  await settle(sha256, { browserMs: result.browserMs });
  logEvent("pdf.deed_rendered", {
    bytes: bytes.byteLength,
    browserMs: result.browserMs,
    hop: msg.hop,
    layout: DEED_PDF_LAYOUT_ID,
  });
  return "rendered";
}

// ---- deed.signed ------------------------------------------------------------------------------------------------------------------------------------------

/** The most portal contacts one deed's email goes to (a client has a handful; one `sendBatch`). */
export const DEED_MAIL_MAX = 20;

export const DEED_SIGNED_SQL = `SELECT d.id, d.status, d.number_display, d.source_document_id, s.type AS offer_type, s.number_display AS offer_number, s.version AS offer_version,
    EXISTS (SELECT 1 FROM clients c WHERE c.id = d.client_id AND c.anonymised_at IS NOT NULL) AS client_gone
  FROM deeds d JOIN documents s ON s.id = d.source_document_id AND s.client_id = d.client_id WHERE d.id = ?1`;
/** The client's live portal contacts (the people who can see the deed in the portal). */
export const DEED_CONTACTS_SQL = `SELECT c.name, lower(c.email) AS email FROM contacts c
  WHERE c.client_id = (SELECT client_id FROM deeds WHERE id = ?1) AND c.portal_access = 1 AND c.anonymised_at IS NULL
  ORDER BY c.is_primary DESC, c.created_at, c.id LIMIT ${DEED_MAIL_MAX}`;

type SignedRow = {
  id: string;
  status: string;
  number_display: string | null;
  source_document_id: string;
  offer_type: string;
  offer_number: string | null;
  offer_version: number;
  client_gone: number;
};

export type DeedMailOutcome = "queued" | "skipped" | "invalid";

/** Expands one `deed.signed` message into one email per portal contact. Returns how many were queued (0 when skipped). */
export async function processDeedSigned(
  env: Env,
  body: unknown,
): Promise<{ outcome: DeedMailOutcome; queued: number }> {
  const parsed = deedSignedMessage.safeParse(body);
  if (!parsed.success) {
    logEvent("deed.signed_invalid");
    return { outcome: "invalid", queued: 0 };
  }
  const m: DeedSignedMessage = parsed.data;
  const [deedRes, contactsRes] = await env.DB.batch([
    env.DB.prepare(DEED_SIGNED_SQL).bind(m.deedId),
    env.DB.prepare(DEED_CONTACTS_SQL).bind(m.deedId),
  ]);
  const row = deedRes?.results[0] as SignedRow | undefined;
  if (row?.status !== "signed" || row.number_display === null) {
    logEvent("deed.signed_skipped", { why: row ? "not_signed" : "not_found" });
    return { outcome: "skipped", queued: 0 };
  }
  if (row.client_gone === 1) {
    logEvent("deed.signed_skipped", { why: "client_gone" });
    return { outcome: "skipped", queued: 0 };
  }
  const contacts = (contactsRes?.results ?? []) as { name: string; email: string }[];
  const url = `${portalBase(env)}/proposals/${encodeURIComponent(row.source_document_id)}`;
  const messages: EmailMessage[] = contacts.map((c) => ({
    template: "deed.signed",
    to: c.email,
    data: {
      first_name: firstNameOf(c.name),
      number: row.number_display as string,
      offer_type: row.offer_type,
      offer_number: row.offer_number ?? "",
      offer_version: String(row.offer_version),
      url,
    },
    entity: { type: "deed", id: row.id },
  }));
  if (messages.length > 0) await sendChunked(env.EMAIL_QUEUE, messages);
  logEvent("deed.signed_queued", { count: messages.length });
  return { outcome: "queued", queued: messages.length };
}
