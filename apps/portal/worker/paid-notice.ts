// "I've paid" (M7.1; POR-06, ADM-PAY-05; run file C, L10, L21, L22, L23): `POST /invoices/:id/paid-notice` (signed in, finance) and
// `POST /t/document/paid-notice` (the emailed "View & pay" link; the token only in the body, the same open, `p:fail:` counter and lock as `/t/document`).
//
// A notice is what the client SAYS it paid: a `payment_notices` row, never a payment and never money (L10). Staff record the payment from it (M6.1's pending
// path, `POST /payments` with `noticeId`); a proforma's tax invoice follows only a recorded and confirmed payment (Researched 2026-10-28, s.13(2) and s.31(2)
// CGST Act (08-C RA-17)). The reference is a UTR or similar, never a credential, and no card or bank-account field exists (Researched 2026-10-28, RBI PA
// Directions 2025 (08-C RB-07); ADM-PAY-12). No Luhn check (L22: a false refusal would block a real payer).
//
// ONE batch, every rule in the INSERT…SELECT's WHERE (core `noticeAllowed` and `paidNoticeVerdict` have the same rules, twin-tested in packages/db): the
// document is this client's, issued, and can take a notice (`noticeRefusalSql`: not withdrawn, void, a credit note, another type, a proforma not issued or
// converted, paid, not open, no balance); the amount at most the balance; the day paid not after today in IST (L21) and not before the issue day; fewer than 3
// open notices on the document; no open notice with the same reference; the contact live with finance. The audit row is written only if the insert happened,
// the access row only if the audit row exists; a read in the same batch explains a refusal. Then the staff bells through jobs (`portal.alert`, L9).
import { uuidv7 } from "@techaust/core/ids";
import { issueDateOf, normaliseReference } from "@techaust/core/invoices";
import { formatMoney, money } from "@techaust/core/money";
import { NOTICES_OPEN_MAX } from "@techaust/core/portal";
import { noticeNoteOf, paidNotice, tokenPaidNotice } from "@techaust/core/portal-schemas";
import { accessStmt, auditStmt } from "@techaust/db/log";
import { noticeRefusalSql, paidNoticeVerdictSql } from "@techaust/db/sql-rules";
import { Hono } from "hono/tiny";
import { type AppEnv, accessEntry, type Ctx, err, NOT_FOUND, requestInfo } from "./context.ts";
import { linkLiveSql, open } from "./doc-token.ts";
import { openOrWithdrawnSql, TYPES_SQL } from "./invoice-summary.ts";
import { bound } from "./offer-core.ts";
import { alertStaff } from "./requests.ts";
import { scope } from "./scope.ts";
import { jsonFields } from "./validate.ts";

const OPEN_COUNT = `(SELECT count(*) FROM payment_notices n INDEXED BY payment_notices_document WHERE n.document_id = d.id AND n.status = 'open')`;
const DUPLICATE = `EXISTS (SELECT 1 FROM payment_notices n WHERE n.document_id = d.id AND n.reference_norm = ?8 AND n.status = 'open')`;
const VERDICT = paidNoticeVerdictSql("?5", "d.balance_minor", "?6", "d.issue_date", "?12");

/**
 * Early check 2, finding 4: a link's notice is written only while its link is still live in this batch (`open()` read it in an earlier one): the token not
 * revoked or expired, its live contact with finance at the same address, the client not anonymised, inside paid + 30 days (L12, L13). `?13` the token hash.
 */
const LINK_LIVE = `(?4 = 'portal' OR ${linkLiveSql("?13", "?10")})`;

/**
 * ?1 client, ?2 document, ?3 new id, ?4 via, ?5 amount, ?6 day paid, ?7 reference as typed, ?8 its stored form, ?9 note, ?10 now, ?11 contact, ?12 today
 * (IST), ?13 the link's token hash (`via = 'link'` only). The contact is joined live, with portal access and finance, of the same client; the client is
 * joined not anonymised (early check 2, finding 4: the insert holds the anonymised-client lock itself, not only through the guard's session read).
 */
export const NOTICE_INSERT_SQL = `INSERT INTO payment_notices (id, client_id, document_id, contact_id, via, amount_minor, currency, paid_on, reference, reference_norm, note, status, created_at)
   SELECT ?3, d.client_id, d.id, c.id, ?4, ?5, d.currency, ?6, ?7, ?8, ?9, 'open', ?10
   FROM documents d JOIN contacts c ON c.id = ?11 AND c.client_id = d.client_id AND c.portal_access = 1 AND c.can_see_finance = 1 AND c.anonymised_at IS NULL
     JOIN clients k ON k.id = d.client_id AND k.anonymised_at IS NULL
   WHERE d.client_id = ?1 AND d.id = ?2 AND d.frozen_at IS NOT NULL AND d.type IN (${TYPES_SQL})
     AND ${noticeRefusalSql("d")} IS NULL AND ${VERDICT} = 'ok' AND ${OPEN_COUNT} < ${NOTICES_OPEN_MAX} AND NOT ${DUPLICATE}
     AND ${LINK_LIVE}`;

/**
 * Read after the insert, in the same batch (the same placeholders): whether it was written, else why not. No row: not a document the client can open.
 * `link_live` 0: the link stopped opening between `open()` and this batch (a 404, as a link that never opened).
 */
export const NOTICE_AFTER_SQL = `SELECT (SELECT 1 FROM payment_notices w WHERE w.id = ?3 AND w.client_id = ?1) AS written, ${noticeRefusalSql("d")} AS refusal,
     ${VERDICT} AS verdict, d.balance_minor, d.currency, ${OPEN_COUNT} AS open_count, ${DUPLICATE} AS duplicate, ${LINK_LIVE} AS link_live
   FROM documents d WHERE d.client_id = ?1 AND d.id = ?2 AND d.frozen_at IS NOT NULL AND d.type IN (${TYPES_SQL}) AND ${openOrWithdrawnSql("d")}`;

type After = {
  written: number | null;
  refusal: string | null;
  verdict: string;
  balance_minor: number;
  currency: string;
  open_count: number;
  duplicate: number;
  link_live: number;
};

/**
 * The refusals: the SPA words them by code (C15), and since the full audit (AU13, B3 M3) the `message` carries the same owner-approved 07-ZP C15 words
 * (2026-11-05), never a placeholder. `not_payable` carries `reason` (core `NOTICE_REFUSALS`), `amount_above_balance` the balance.
 */
export const NOTICE_REFUSAL_WORDS: Readonly<Record<string, string>> = {
  date_in_future: "The date can't be in the future.",
  date_before_issue: "The date can't be before the invoice date.",
  notice_duplicate: "We already have a notice with this reference.",
  notice_open_limit: "You've told us about 3 payments for this document. We'll confirm them soon.",
  not_payable: "This document can't take a payment notice.",
};
const refusal = (code: string, balance?: { minor: number; currency: string }) => ({
  code,
  message:
    code === "amount_above_balance" && balance
      ? `That's more than the balance due (${formatMoney(money(balance.minor, balance.currency === "USD" ? "USD" : "INR"))}).`
      : (NOTICE_REFUSAL_WORDS[code] ?? (NOTICE_REFUSAL_WORDS.not_payable as string)),
});

type NoticeFacts = {
  clientId: string;
  contactId: string;
  documentId: string;
  via: "portal" | "link";
  amountMinor: number;
  paidOn: string;
  reference: string;
  note: string | null | undefined;
  /** The link's token hash (`via = 'link'`), re-checked live in the batch; null for a signed-in notice. */
  tokenHash: string | null;
};

/** The insert, its audit and access rows and the explaining read, in ONE batch; the answer. */
async function writeNotice(c: Ctx, f: NoticeFacts): Promise<Response> {
  const db = c.env.DB;
  const id = uuidv7();
  const auditId = uuidv7();
  const now = Date.now();
  // The schema accepted the reference only if it has a stored form.
  const referenceNorm = normaliseReference(f.reference) ?? "";
  const params = [
    f.clientId,
    f.documentId,
    id,
    f.via,
    f.amountMinor,
    f.paidOn,
    f.reference,
    referenceNorm,
    noticeNoteOf(f.note),
    now,
    f.contactId,
    issueDateOf(now),
    f.tokenHash ?? "",
  ];
  const touch = f.via === "portal" && c.var.touch ? [c.var.touch] : [];
  let results: D1Result[];
  try {
    results = await db.batch([
      ...touch,
      bound(db, NOTICE_INSERT_SQL, params),
      auditStmt(
        db,
        {
          ...requestInfo(c),
          id: auditId,
          actorType: "contact",
          actorId: f.contactId,
          role: null,
          action: "payment.notice",
          entityType: "payment_notice",
          entityId: id,
          // Ids, codes and amounts only (never the reference or the note).
          summary: { documentId: f.documentId, via: f.via, amountMinor: f.amountMinor, paidOn: f.paidOn },
        },
        "changes",
      ),
      accessStmt(db, accessEntry(c, 201, f.contactId), { auditId }),
      bound(db, NOTICE_AFTER_SQL, params),
    ]);
  } catch (e) {
    // The same reference sent twice at once: the partial unique index refuses the second (the WHERE's answer too).
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message))
      return err(c, refusal("notice_duplicate"), 409);
    throw e;
  }
  const at = touch.length;
  const after = results[at + 3]?.results[0] as After | undefined;
  if (results[at]?.meta.changes === 1 && after?.written === 1) {
    c.set("accessDone", true);
    alertStaff(c, auditId);
    return c.json(
      {
        notice: {
          id,
          status: "open",
          amountMinor: f.amountMinor,
          paidOn: f.paidOn,
          reference: f.reference,
          createdAt: now,
        },
      },
      201,
    );
  }
  if (f.via === "link") {
    // A valid link: no `p:fail:` count; the access row of the refusal is written here (a public route has no exit row).
    c.set("accessDone", true);
    const status =
      after?.link_live !== 1
        ? 404
        : after.refusal || after.open_count >= NOTICES_OPEN_MAX || after.duplicate
          ? 409
          : 400;
    await db.batch([accessStmt(db, accessEntry(c, status, f.contactId))]);
  }
  // A link that stopped opening since `open()` tells nothing more about the document (finding 4).
  if (after?.link_live !== 1) return err(c, NOT_FOUND, 404);
  if (after.refusal)
    return c.json({ error: refusal("not_payable"), reason: after.refusal, request_id: c.var.rid }, 409);
  if (after.verdict === "amount_above_balance")
    return c.json(
      {
        error: refusal("amount_above_balance", { minor: after.balance_minor, currency: after.currency }),
        balanceMinor: after.balance_minor,
        request_id: c.var.rid,
      },
      400,
    );
  if (after.verdict === "date_in_future" || after.verdict === "date_before_issue")
    return err(c, refusal(after.verdict), 400);
  if (after.open_count >= NOTICES_OPEN_MAX) return err(c, refusal("notice_open_limit"), 409);
  if (after.duplicate) return err(c, refusal("notice_duplicate"), 409);
  // The contact lost finance or access between the guard (or the link's open) and the batch.
  return err(c, NOT_FOUND, 404);
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** `POST /invoices/:id/paid-notice` (mounted under `/v1/invoices`). */
export const paidNoticeRoutes = new Hono<AppEnv>().post(
  "/:id/paid-notice",
  jsonFields(paidNotice),
  async (c) => {
    const s = scope(c);
    const id = c.req.param("id");
    if (!ID.test(id)) return err(c, NOT_FOUND, 404);
    const b = c.req.valid("json");
    return writeNotice(c, {
      clientId: s.clientId,
      contactId: s.contactId,
      documentId: id,
      via: "portal",
      amountMinor: b.amountMinor,
      paidOn: b.paidOn,
      reference: b.reference,
      note: b.note,
      tokenHash: null,
    });
  },
);

/** `POST /t/document/paid-notice` (mounted under `/v1/t`): the link's client and contact, never the body's. */
export const tokenPaidNoticeRoutes = new Hono<AppEnv>().post(
  "/document/paid-notice",
  jsonFields(tokenPaidNotice),
  async (c) => {
    const b = c.req.valid("json");
    const o = await open(c, b.token);
    if (o instanceof Response) return o;
    return writeNotice(c, {
      clientId: o.doc.link_client_id,
      contactId: o.doc.link_contact_id,
      documentId: o.doc.id,
      via: "link",
      amountMinor: b.amountMinor,
      paidOn: b.paidOn,
      reference: b.reference,
      note: b.note,
      tokenHash: o.hash,
    });
  },
);
