// M6.5 payment receipts on the PDF queue (ADM-PAY-09, JOB-PDF-01, ADM-MAIL-01; run file D, L3 to L5, L34, L39):
//   `receipt.issue {paymentId}`   → the invoices Worker's `BillingJobs.issueReceipt` (ADMIN_JOBS; its own batch; it never opens the browser, so the pacer never
//                                   sleeps for it); it queues `receipt.render` itself;
//   `receipt.sweep {asOf}`         → up to 20 `receipt.issue` for confirmed payments still without a receipt 10 minutes after confirmation (`payments_receipt_due`),
//                                   and up to 20 `receipt.render` for receipts still without their PDF (`documents_receipt_pdf_pending`);
//   `receipt.render {receiptId}`   → the receipt's PDF from its SEALED `header_extras.receiptOf` (the seal must match `snapshot_sha256`, else REFUSED with the
//                                   owners' bell once, never retried), adopted if stored already, else rendered through the paced Browser Run client and put
//                                   write-once at `docs/receipt/<FY>/<n>-v1.pdf`; then its email (below).
// The email (`receipt.sent`, 07-ZO lines 11 and 12, from billing@): to the client's live contacts with portal access AND "can see finance" (RB-31); the PDF
// attached when the client's "attach PDF" is on, else the portal link; not for a payment confirmed more than 3 days before the receipt issued (L5: the staging
// back-catalogue); one `email_log` claim per receipt and recipient. No PDF and no email for an anonymised client. While the page is the builder's placeholder
// (`RECEIPT_LAYOUT_PLACEHOLDER`) receipts render only where `ENVIRONMENT` is "local" (nothing placeholder is stored write-once on staging).
// Review part 1: the sweep mirrors M4.4's (`RECEIPT_PDF_PENDING_SQL`: issued at least `RECEIPT_SWEEP_AFTER_MS` ago, never after `SWEEP_MAX_FAILED_NIGHTS` failed IST
// days or a refusal bell, the least recently tried first; each pick noted in `pdf_failures`), and a receipt render that ran out of tries counts a failed day, the
// third ringing the owners once (finding 4); outside "local" no receipt is rendered while 07-ZO is unapproved (`APPROVED_07ZO`), so no "[Placeholder]" word is
// ever stored write-once or emailed (finding 5: skipped, nothing counted; the sweep renders it once the switch flips); the email is queued BEFORE the PDF is
// marked made, so a failed send is retried with the message (finding 7; the email log keeps one email per receipt and recipient).
import type { EmailMessage } from "@techaust/core";
import { APPROVED_07ZO } from "@techaust/core/copy-zo";
import { formatDate, parseIsoDate } from "@techaust/core/dates";
import { canonicalJson, sha256Hex } from "@techaust/core/hash";
import { formatMoney, money } from "@techaust/core/money";
import { todayIst } from "@techaust/core/offers";
import {
  fyLabelOfToken,
  isReceiptMessage,
  pdfKeys,
  RECEIPT_SWEEP_AFTER_MS,
  type ReceiptRenderMessage,
} from "@techaust/core/pdf-jobs";
import { type ReceiptOf, receiptEmailDue } from "@techaust/core/receipts";
import { RECEIPT_PDF_PENDING_SQL, RECEIPTS_DUE_SQL } from "@techaust/db/receipts";
import {
  pdfOptionsFor,
  RECEIPT_LAYOUT_PLACEHOLDER,
  RECEIPT_PDF_LAYOUT_ID,
  receiptView,
  renderReceiptHtml,
} from "@techaust/pdf";
import { billingJobs } from "./billing-rpc.ts";
import { portalBase } from "./billing-shared.ts";
import { type RenderEnv, renderPaced } from "./browser.ts";
import { logEvent } from "./log.ts";
import { type Clock, realClock } from "./pacer.ts";
import {
  BROWSER_ALERT_MS,
  dayOf,
  FAILED_NIGHT_SQL,
  failed,
  HALF_BELL_SQL,
  putPdfOnce,
  STAT_ADD_SQL,
  STOPPED_BELL_SQL,
  SWEEP_ATTEMPT_SQL,
  SWEEP_MAX_FAILED_NIGHTS,
  sha256Bytes,
} from "./pdf.ts";
import { sendChunked } from "./send-batch.ts";

/** The most portal contacts one receipt's email goes to (one `sendBatch`). */
export const RECEIPT_MAIL_MAX = 20;
/** The owners' bell when a receipt's sealed values fail their check (builder's staff draft for the lead). */
export const RECEIPT_REFUSED_BELL = (number: string) =>
  `The PDF of receipt ${number} didn't match its saved copy, so it wasn't made. A developer needs to look at it.`;
/** Review part 1, finding 4: the owners' one bell once a receipt's PDF failed on `SWEEP_MAX_FAILED_NIGHTS` IST days (staff line for the lead, 07-ZO). */
export const RECEIPT_STOPPED_BELL = (number: string) =>
  `The PDF of receipt ${number} couldn't be made on 3 days, so the hourly retry has stopped. A developer needs to look at it.`;
/** 07-ZO approved (one switch, `@techaust/core/copy-zo`); behind an object so a test can stand in for the flipped switch. */
export const receiptCopyGate = { approved: (): boolean => APPROVED_07ZO };

/** Whether a receipt PDF may be rendered here: always locally; elsewhere only once the layout is final and 07-ZO's words are approved (finding 5, L5). */
const rendersAllowed = (env: Env): boolean => {
  const environment: string = env.ENVIRONMENT;
  return environment === "local" || (!RECEIPT_LAYOUT_PLACEHOLDER && receiptCopyGate.approved());
};

const ROW_SQL = `SELECT d.id, d.client_id, d.currency, d.fy, d.number, d.number_display, d.header_extras, d.snapshot_sha256, d.pdf_sha256, d.frozen_at, d.status,
     k.anonymised_at, k.attach_pdf, p.verified_at
   FROM documents d JOIN clients k ON k.id = d.client_id LEFT JOIN payments p ON p.id = substr(d.id, 5)
   WHERE d.id = ?1 AND d.type = 'receipt'`;
const CONTACTS_SQL = `SELECT lower(c.email) AS email FROM contacts c
   WHERE c.client_id = ?1 AND c.portal_access = 1 AND c.can_see_finance = 1 AND c.anonymised_at IS NULL
     AND EXISTS (SELECT 1 FROM documents r WHERE r.id = ?2 AND r.status = 'issued')
   ORDER BY c.is_primary DESC, c.created_at, c.id LIMIT ${RECEIPT_MAIL_MAX}`;
const REFUSED_BELL_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), u.id, 'pdf.refused', 'document', ?1, ?2, ?3 FROM staff_users u WHERE u.status = 'active' AND u.role = 'owner'`;

type Row = {
  id: string;
  client_id: string;
  currency: "INR" | "USD";
  fy: string | null;
  number: number | null;
  number_display: string | null;
  header_extras: string | null;
  snapshot_sha256: string | null;
  pdf_sha256: string | null;
  frozen_at: number | null;
  status: string;
  anonymised_at: number | null;
  attach_pdf: number | null;
  verified_at: number | null;
};

const receiptOfRow = (raw: string | null): ReceiptOf | null => {
  try {
    const v = JSON.parse(raw ?? "null") as { receiptOf?: ReceiptOf } | null;
    return v?.receiptOf && typeof v.receiptOf === "object" ? v.receiptOf : null;
  } catch {
    return null;
  }
};

export type ReceiptOutcome = "issued" | "swept" | "rendered" | "adopted" | "delayed" | "skipped" | "refused";

/** One body of the receipt family (`isReceiptKind` already said so). Throws for anything a retry can fix. */
export async function processReceipt(
  env: Env,
  body: unknown,
  now = Date.now(),
  clock: Clock = realClock,
): Promise<ReceiptOutcome> {
  if (!isReceiptMessage(body)) {
    logEvent("receipt.invalid_message");
    return "skipped";
  }
  if (body.kind === "receipt.issue") {
    const r = await billingJobs(env).issueReceipt?.({ paymentId: body.paymentId });
    logEvent("receipt.issue", { r: r?.result ?? "none", ...(r?.why ? { why: r.why } : {}) });
    return "issued";
  }
  if (body.kind === "receipt.sweep") {
    // Second review, L5: while the renderer would skip every receipt here (the layout or 07-ZO's words not approved, outside "local"), the sweep asks for no
    // render and notes no attempt; receipts are still issued.
    const renders = rendersAllowed(env);
    const [due, pending] = await env.DB.batch([
      env.DB.prepare(RECEIPTS_DUE_SQL).bind(body.asOf - RECEIPT_SWEEP_AFTER_MS),
      ...(renders
        ? [
            env.DB.prepare(RECEIPT_PDF_PENDING_SQL).bind(
              body.asOf - RECEIPT_SWEEP_AFTER_MS,
              SWEEP_MAX_FAILED_NIGHTS,
            ),
          ]
        : []),
    ]);
    const issue = ((due?.results ?? []) as { id: string }[]).map((r) => ({
      v: 1,
      kind: "receipt.issue",
      paymentId: r.id,
    }));
    const render = ((pending?.results ?? []) as { id: string }[])
      .filter((r) => r.id.length <= 64)
      .map((r) => ({ v: 1, kind: "receipt.render", receiptId: r.id, hop: 0 }));
    if (issue.length + render.length > 0) await sendChunked(env.PDF_QUEUE, [...issue, ...render]);
    // Finding 4: each render picked is noted (as M4.4's sweep), so the next sweep starts with the ones it tried least recently. The messages go first: a lost
    // note only changes the order, never loses a PDF.
    if (render.length > 0)
      await env.DB.batch(render.map((r) => env.DB.prepare(SWEEP_ATTEMPT_SQL).bind(r.receiptId, body.asOf)));
    logEvent("receipt.sweep", { issue: issue.length, render: render.length });
    return "swept";
  }
  return renderReceipt(env, body, now, clock);
}

async function renderReceipt(
  env: Env,
  msg: ReceiptRenderMessage,
  now: number,
  clock: Clock,
): Promise<ReceiptOutcome> {
  const row = await env.DB.prepare(ROW_SQL).bind(msg.receiptId).first<Row>();
  const skip = (why: string): ReceiptOutcome => {
    logEvent("receipt.render_skipped", { why });
    return "skipped";
  };
  if (!row || row.frozen_at === null) return skip("not_found");
  if (row.pdf_sha256 !== null) return skip("done");
  if (row.anonymised_at !== null) return skip("client_gone");
  // Early check 2, finding 4: a receipt voided (its payment withdrawn) before its PDF is never rendered or emailed.
  if (row.status !== "issued") return skip("not_issued");
  const environment: string = env.ENVIRONMENT;
  if (RECEIPT_LAYOUT_PLACEHOLDER && environment !== "local") return skip("layout_placeholder");
  // Finding 5: the receipt's words come from 07-ZO; until the owner approves it, nothing is stored write-once or emailed outside "local" (no failure counted).
  if (!rendersAllowed(env)) return skip("copy_unapproved");
  const receiptOf = receiptOfRow(row.header_extras);
  const label = row.fy ? fyLabelOfToken(row.fy) : null;
  const sealed =
    receiptOf !== null &&
    row.snapshot_sha256 !== null &&
    (await sha256Hex(canonicalJson(receiptOf))) === row.snapshot_sha256 &&
    row.number_display !== null &&
    row.number !== null &&
    label !== null;
  if (!sealed || !receiptOf || !row.number_display || row.number === null || !label) {
    await env.DB.batch([
      env.DB.prepare(REFUSED_BELL_SQL).bind(
        row.id,
        RECEIPT_REFUSED_BELL(row.number_display ?? "Untitled"),
        "/payments",
      ),
    ]);
    logEvent("pdf.refused", { stage: "render", code: "receipt_seal", family: "receipt" });
    return "refused";
  }
  const key = pdfKeys({ type: "receipt", fy: label, number: row.number, version: 1 }).pdf;
  const settle = async (pdfSha: string, usage: { browserMs: number } | null) => {
    const date = dayOf(now);
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE documents SET pdf_r2_key = ?2, pdf_sha256 = ?3 WHERE id = ?1 AND type = 'receipt' AND pdf_sha256 IS NULL AND snapshot_sha256 = ?4 AND status = 'issued'",
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
  const already = await env.DOCS.get(key);
  if (already !== null) {
    const sha = await sha256Bytes(new Uint8Array(await already.arrayBuffer()));
    // Finding 7: the email first, then the PDF marked made (a failed send throws, the message is retried and the stored PDF adopted again).
    await mailReceipt(env, row, receiptOf, key, now);
    await settle(sha, null);
    logEvent("receipt.adopted", { layout: RECEIPT_PDF_LAYOUT_ID });
    return "adopted";
  }
  const html = renderReceiptHtml(receiptView(receiptOf, row.number_display));
  const result = await renderPaced(env as unknown as RenderEnv, html, pdfOptionsFor(), clock);
  if (!result.ok) {
    await failed(env, msg, result, now);
    return "delayed";
  }
  const { bytes, sha256 } = await putPdfOnce(env.DOCS, key, result.bytes);
  await mailReceipt(env, row, receiptOf, key, now);
  await settle(sha256, { browserMs: result.browserMs });
  logEvent("receipt.rendered", {
    bytes: bytes.byteLength,
    browserMs: result.browserMs,
    hop: msg.hop,
    layout: RECEIPT_PDF_LAYOUT_ID,
  });
  return "rendered";
}

/**
 * Review part 1, finding 4: a receipt message that ran out of tries. A render counts one failed IST day for its receipt (`pdf_failures`, once per day); at the
 * third the sweep leaves it out and the owners get one bell. An issue or a sweep is only logged (the next hourly sweep asks again).
 */
export async function processReceiptDeadLetter(env: Env, body: unknown, now = Date.now()): Promise<void> {
  if (!isReceiptMessage(body) || body.kind !== "receipt.render") {
    logEvent("receipt.dead_letter", { kind: isReceiptMessage(body) ? body.kind : "invalid" });
    return;
  }
  const row = await env.DB.prepare(
    "SELECT id, number_display FROM documents WHERE id = ?1 AND type = 'receipt'",
  )
    .bind(body.receiptId)
    .first<{ id: string; number_display: string | null }>();
  if (!row) {
    logEvent("receipt.dead_letter", { kind: body.kind, skipped: "not_found" });
    return;
  }
  await env.DB.batch([
    env.DB.prepare(FAILED_NIGHT_SQL).bind(row.id, todayIst(now), now),
    env.DB.prepare(STOPPED_BELL_SQL).bind(
      row.id,
      RECEIPT_STOPPED_BELL(row.number_display ?? "Untitled"),
      "/payments",
    ),
  ]);
  logEvent("receipt.dead_letter", { kind: body.kind });
}

/** The receipt's email to the client's finance contacts (once per receipt and recipient: the `email_log` claim is keyed on the entity and recipient). */
async function mailReceipt(env: Env, row: Row, r: ReceiptOf, key: string, now: number): Promise<number> {
  if (row.verified_at === null || !receiptEmailDue(row.verified_at, row.frozen_at ?? now)) {
    logEvent("receipt.mail_skipped", { why: "old_payment" });
    return 0;
  }
  const contacts = ((await env.DB.prepare(CONTACTS_SQL).bind(row.client_id, row.id).all<{ email: string }>())
    .results ?? []) as { email: string }[];
  const attach = row.attach_pdf === 1;
  const received = parseIsoDate(r.receivedOn);
  const data = {
    number: row.number_display as string,
    amount: formatMoney(money(r.amountMinor, r.currency)),
    date: received ? formatDate(received) : r.receivedOn,
    attached: attach ? "1" : "0",
    url: `${portalBase(env)}/invoices`,
  };
  const messages: EmailMessage[] = contacts.map((c) => ({
    template: "receipt.sent",
    to: c.email,
    data,
    entity: { type: "document", id: row.id },
    ...(attach
      ? {
          attachment: {
            key,
            filename: `${(row.number_display as string).replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`,
          },
        }
      : {}),
  }));
  if (messages.length > 0) await sendChunked(env.EMAIL_QUEUE, messages);
  logEvent("receipt.mail_queued", { count: messages.length });
  return messages.length;
}
