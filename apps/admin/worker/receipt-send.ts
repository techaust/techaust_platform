// "Send receipt again" (M7.2; ADM-PAY-09; run file docs/runs/m7.2-notifications.md C.2, L14). Tier A ground: client email recipients. Finance Worker (a read and
// a send beside the payment; no invoice chain). `POST /receipts/:id/send {contactIds: 1 to 5}`, `invoices.send`, audit `receipt.send`:
//   ONE batch through `mutate`: one `document_sends` row of kind `resend` per chosen contact, written only for a contact with portal access AND "can see finance"
//   (Researched 2026-10-28, RB-31), not anonymised, whose `client_id` is the receipt's, of an ISSUED receipt (never voided) of a client that isn't anonymised:
//   every rule in the INSERT's WHERE (checked first for a 409 that names the refused contacts); the audit row only when a row was written.
//   -> then one `receipt.sent` email per row from `waitUntil`, entity `{type: "document_send", id}` (a manual send goes at once, Q48; a new press is a new send).
// 409 `recipient_invalid` names the refused contacts; 409 `receipt_void`, `client_anonymised`; 409 `receipt_refunded` (review 1, finding 5): the payment's money
// has all gone back (`paymentRefundedInFullSql`: nothing held net and its live refunds at least its amount), so no receipt is sent again; a payment held as
// credit (net 0, nothing refunded) or partly refunded still has its receipt sent. The rule is in the pre-check and in the INSERT's WHERE; 404.
import type { EmailMessage } from "@techaust/core"; // type only
import { formatDate, parseIsoDate } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import { formatMoney, money } from "@techaust/core/money";
import { paymentRefundedInFullSql } from "@techaust/db/sql-rules";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type ApiError, type AppEnv, actor, err, mutate, NOT_FOUND } from "./context.ts";
import { body, idParam, param } from "./http.ts";
import { queueEmail } from "./mail.ts";

const RECEIPT_VOID: ApiError = {
  code: "receipt_void",
  message: "This receipt was voided, so it can't be sent",
};
const CLIENT_ANONYMISED: ApiError = {
  code: "client_anonymised",
  message: "This client has been anonymised, so nothing can be sent",
};
const RECEIPT_REFUNDED: ApiError = {
  code: "receipt_refunded",
  message: "This payment has been refunded in full, so its receipt can't be sent again",
};
const RECIPIENT_INVALID: ApiError = {
  code: "recipient_invalid",
  message: "Some recipients can't get this receipt: they need portal access and finance access",
};

const sendBody = z.object({
  contactIds: z
    .array(z.string().check(z.minLength(1), z.maxLength(64)))
    .check(z.minLength(1), z.maxLength(5)),
});

type Receipt = {
  id: string;
  client_id: string;
  status: string;
  version_group_id: string;
  number_display: string | null;
  pdf_r2_key: string | null;
  attach_pdf: number;
  client_anonymised_at: number | null;
  amount_minor: number | null;
  currency: "INR" | "USD" | null;
  received_on: string | null;
  refunded_in_full: number | null;
};

const RECEIPT_SQL = `SELECT d.id, d.client_id, d.status, d.version_group_id, d.number_display, d.pdf_r2_key, k.attach_pdf, k.anonymised_at AS client_anonymised_at,
     p.amount_minor, p.currency, p.received_on, ${paymentRefundedInFullSql("p")} AS refunded_in_full
   FROM documents d JOIN clients k ON k.id = d.client_id LEFT JOIN payments p ON p.receipt_document_id = d.id
   WHERE d.id = ?1 AND d.type = 'receipt'`;

/**
 * M6–M7 audit AU21 (B4 L2): an address that may be emailed: not on the suppression list (a hard bounce, a complaint). The erased `h:` form needs the erasure key,
 * which only the jobs Worker holds, so the email consumer stays the guard for it (a contact who was erased here is anonymised, which the rule already refuses).
 */
const NOT_SUPPRESSED = "NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email = lower(c.email))";

/** The chosen contacts that may receive it (the same rule as the INSERT's WHERE), for the 409's names. */
const ELIGIBLE_SQL = `SELECT c.id, lower(c.email) AS email FROM contacts c
   WHERE c.id IN (SELECT j.value FROM json_each(?2) j) AND c.client_id = (SELECT d.client_id FROM documents d WHERE d.id = ?1 AND d.type = 'receipt')
     AND c.portal_access = 1 AND c.can_see_finance = 1 AND c.anonymised_at IS NULL AND ${NOT_SUPPRESSED}`;

/**
 * The refusal names the refused contacts at the top level, as `recipientRefusal` of the document sends does (M6–M7 audit AU16, B2 2: the SPA reads `contactIds`
 * there, so the dialog marks them).
 */
const recipientRefusal = (c: Parameters<typeof err>[0], contactIds: readonly string[]) =>
  c.json(
    {
      error: { code: RECIPIENT_INVALID.code, message: RECIPIENT_INVALID.message },
      request_id: c.var.rid,
      contactIds,
    },
    409,
  );

export const receiptSend = new Hono<AppEnv>().post("/:id/send", param(idParam), body(sendBody), async (c) => {
  const { id } = c.req.valid("param");
  const ids = [...new Set(c.req.valid("json").contactIds)];
  const u = actor(c);
  const db = c.env.DB;
  const [rR, eR] = await db.batch([
    db.prepare(RECEIPT_SQL).bind(id),
    // the receipt's own client, read in SQL (never from the request)
    db.prepare(ELIGIBLE_SQL).bind(id, JSON.stringify(ids)),
  ]);
  const r = rR?.results[0] as Receipt | undefined;
  if (!r) return err(c, NOT_FOUND, 404);
  if (r.client_anonymised_at !== null) return err(c, CLIENT_ANONYMISED, 409);
  if (r.status !== "issued") return err(c, RECEIPT_VOID, 409);
  if (r.refunded_in_full === 1) return err(c, RECEIPT_REFUNDED, 409);
  const eligible = (eR?.results ?? []) as { id: string; email: string }[];
  const ok = new Set(eligible.map((x) => x.id));
  const refused = ids.filter((x) => !ok.has(x));
  if (refused.length > 0) return recipientRefusal(c, refused);
  const now = Date.now();
  const sends = eligible.map((x) => ({ sendId: uuidv7(), contactId: x.id, email: x.email }));
  const attach = r.attach_pdf === 1 && r.pdf_r2_key !== null;
  // One INSERT for every row, each guarded by the rules again (a contact changed since the read gets no row); the audit row follows it.
  const values = sends.map((_, i) => `(?${i * 2 + 4}, ?${i * 2 + 5})`).join(", ");
  const insert = db
    .prepare(
      `INSERT INTO document_sends (id, document_id, version_group_id, client_id, contact_id, email, attach_pdf, kind, queued_at, created_by)
         SELECT v.column1, d.id, coalesce(d.version_group_id, d.id), d.client_id, c.id, lower(c.email), ?2, 'resend', ?3, ?${sends.length * 2 + 4}
         FROM (VALUES ${values}) v
         JOIN contacts c ON c.id = v.column2
         JOIN documents d ON d.id = ?1 AND d.type = 'receipt' AND d.status = 'issued' AND d.client_id = c.client_id
         JOIN clients k ON k.id = d.client_id AND k.anonymised_at IS NULL
         WHERE c.portal_access = 1 AND c.can_see_finance = 1 AND c.anonymised_at IS NULL AND ${NOT_SUPPRESSED}
           AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.receipt_document_id = d.id AND ${paymentRefundedInFullSql("p")})
         RETURNING id, email`,
    )
    .bind(id, attach ? 1 : 0, now, ...sends.flatMap((s) => [s.sendId, s.contactId]), u.id);
  let written: { id: string; email: string }[] = [];
  const done = await mutate(c, {
    main: insert,
    action: "receipt.send",
    entityType: "document",
    entityId: id,
    summary: { receiptId: id, contactIds: sends.map((s) => s.contactId) },
    // Only the rows the guarded INSERT wrote are emailed (never the pre-check's list).
    onResults: (results, auditAt) => {
      // the main statement sits right before the audit row (a session touch may come first)
      written = (results[auditAt - 1]?.results ?? []) as { id: string; email: string }[];
    },
  });
  if (!done) return err(c, NOT_FOUND, 404);
  const day = r.received_on ? parseIsoDate(r.received_on) : null;
  const data = {
    number: r.number_display ?? "",
    amount: r.amount_minor !== null && r.currency ? formatMoney(money(r.amount_minor, r.currency)) : "",
    date: day ? formatDate(day) : (r.received_on ?? ""),
    attached: attach ? "1" : "0",
    // finance's own var (wrangler.finance.jsonc; the generated Env is the front's, which has no PORTAL_URL). M6–M7 audit AU13 (B3 L1): the portal's own
    // receipts page (M7.1 `/receipts`), as the first send from jobs (`apps/jobs/src/receipts.ts`), never the invoices list.
    url: `${String(Reflect.get(c.env, "PORTAL_URL") ?? "").replace(/\/+$/, "")}/receipts`,
  };
  for (const s of written) {
    const message: EmailMessage = {
      template: "receipt.sent",
      to: s.email,
      data,
      entity: { type: "document_send", id: s.id },
      ...(attach && r.pdf_r2_key
        ? {
            attachment: {
              key: r.pdf_r2_key,
              filename: `${(r.number_display ?? "receipt").replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`,
            },
          }
        : {}),
    };
    queueEmail(c, message);
  }
  return c.json({ ok: true, queued: written.length }, 202);
});
