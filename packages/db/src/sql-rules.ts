// Pure SQL text of the tax rules that both the issue statements (`issue.ts`, a Worker module) and the generated triggers (`triggers.ts`, also read by the
// Node-only script `scripts/write-triggers.ts`) use. No D1 types and no imports, so either side can take it. `issue.ts` re-exports every name.

/**
 * The currencies a document or a payment can be in: the schema's `CURRENCY_CODES` (the CHECK constraints `documents_currency`, `payments_currency`), kept here
 * as plain text so Worker SQL needs no drizzle import. The dashboard's one-pass figures (`INVOICED_SQL`, `OWED_SQL`, `PROFORMAS_AWAITING_SQL`, the ledger's
 * `COLLECTED_TILE_SQL`) have one column set per currency in this list, so a db test pins it to `CURRENCY_CODES` and to the installed CHECK constraints: a new
 * currency added to one and not the other fails there, never silently drops its row.
 */
export const SQL_CURRENCIES = ["INR", "USD"] as const;

/**
 * M6–M7 audit AU38: the FY (its first calendar year, e.g. 2026 for 2026-27) of the IST day of instant `ms` (an SQL expression, UTC ms): the twin of core
 * `fyOf(istDate(ms))`, the FY running 1 April to 31 March (a db test compares them across the 31 March / 1 April boundary).
 */
export const istFyOfMsSql = (ms: string): string =>
  `(CAST(strftime('%Y', (${ms}) / 1000 + 19800, 'unixepoch') AS INTEGER) - (CAST(strftime('%m', (${ms}) / 1000 + 19800, 'unixepoch') AS INTEGER) < 4))`;

/** M6–M7 audit AU37: the first UTC ms after IST day `day` (an SQL expression, ISO `YYYY-MM-DD`): IST midnight that ends it (UTC midnight + 24 h − 5 h 30 min). */
export const istDayEndMsSql = (day: string): string =>
  `((CAST(strftime('%s', ${day}) AS INTEGER) + 66600) * 1000)`;

/**
 * M6–M7 audit AU37 (Settled by the lead on the safest reading, 2026-11-07 (08-C RA-41)): refund row `f` counts as gone out at instant `at` (an SQL expression, UTC
 * ms, exclusive: the first instant AFTER the period) when it succeeded, or when it had succeeded and came back only at or after `at` (`reversed_at`, set once by
 * the reversal, which keeps `settled_on` and `settled_at`). So a period that ended before the refund came back keeps it, and filed figures never move. A reader
 * through the partial index `payment_refunds_settled` (succeeded only) adds the reversed ones through `refundsOutSql`'s second branch.
 */
export const refundOutAtSql = (f: string, at: string): string =>
  `(${f}.status = 'succeeded' OR (${f}.status = 'failed' AND ${f}.reversed_at IS NOT NULL AND ${f}.reversed_at >= ${at}))`;

/**
 * M6–M7 audit AU45: the IST day (ISO `YYYY-MM-DD`) of instant `ms` (an SQL expression, UTC ms): the twin of core `toIsoDate(istDate(ms))` (a db test compares
 * them across IST midnight). The statement dates a refund that came back by it (`reversed_at`).
 */
export const istDayOfMsSql = (ms: string): string =>
  `date(CAST(${ms} AS INTEGER) / 1000 + 19800, 'unixepoch')`;

/**
 * M6–M7 audit AU45: refund row `f` went out and came back: a gateway refund that had succeeded and was reversed (`failed` with `reversed_at`, set once by
 * `refundReverseStatement`). Never a lost dispute (`origin = 'chargeback'`) or a manual refund (`provider = 'manual'`): trigger `payment_refunds_status_flow` of
 * 0082 already refuses to reverse them, and saying it again here keeps the statement's debit and credit lines a pair whatever a row holds.
 */
export const refundReturnedSql = (f: string): string =>
  `(${f}.status = 'failed' AND ${f}.reversed_at IS NOT NULL AND ${f}.origin <> 'chargeback' AND ${f}.provider <> 'manual')`;

/**
 * M6–M7 audit AU45: refund row `f` went out at some time: it succeeded, or it succeeded and came back (`refundReturnedSql`). The statement lists each such
 * refund as a debit on its `settled_on` (kept by the reversal), and a returned one also as a credit on the IST day of `reversed_at`.
 */
export const refundWentOutSql = (f: string): string =>
  `(${f}.status = 'succeeded' OR ${refundReturnedSql(f)})`;

/**
 * M6–M7 audit AU37: the refunds with `settled_on` from `from` to `to` (SQL expressions, ISO days, inclusive) that had gone out by the end of IST day `to`, as a
 * source for `FROM (…) f` with every column of `payment_refunds`: the succeeded ones through the partial index `payment_refunds_settled`, and the reversed ones
 * that came back only after that day through `payment_refunds_status_list` (a seek of the failed refunds: a handful). With `asOf: null` the second branch takes
 * every reversed refund of the range, and the caller filters each of its own periods with `refundOutAtSql` (the dashboard's one-pass tile).
 */
export const refundsOutSql = (from: string, to: string, asOf: string | null = istDayEndMsSql(to)): string =>
  `SELECT * FROM payment_refunds INDEXED BY payment_refunds_settled WHERE status = 'succeeded' AND settled_on >= ${from} AND settled_on <= ${to}
     UNION ALL
     SELECT * FROM payment_refunds INDEXED BY payment_refunds_status_list
     WHERE status = 'failed' AND reversed_at IS NOT NULL${asOf === null ? "" : ` AND reversed_at >= ${asOf}`} AND settled_on >= ${from} AND settled_on <= ${to}`;

/** The first IST day a credit note for "Discount after sale" may be dated (core `DISCOUNT_AFTER_SALE_FROM`: a test compares the two; Researched 2026-10-28, 08-C RA-02). */
export const DISCOUNT_AFTER_SALE_FROM_SQL = "2026-11-01";

/**
 * Q37: a letter of undertaking with an ARN is saved in the `tax` setting for the FY token `?FY`: a `luts` list entry of that FY, or the one legacy `lut {arn, fy}`
 * of M3 of that FY, each with an ARN not blank once its spaces are trimmed. The pure twins are core `lutFor(fy, lutsOf(tax))` (export invoice and advance) and
 * core `lutForFy` (a debit note; the same rule), and both are STRICTER than this in one case, failing closed: they count the legacy `lut` only when
 * `legacyLutFate` folds it, so a legacy ARN the list would refuse (or one a full list leaves out) is refused by the blocker before this would pass it (a db test,
 * `note-rules-rt1.test.ts`, pins that core never allows what this refuses). Used inside a freeze WHERE, so a LUT removed between the read and the freeze refuses
 * the batch; and, with `?FY` replaced by `fyTokenOfDateSql` of the receipt day, by the trigger `documents_advance_lut_fy` (0050) and of the note's issue day by
 * `documents_debit_note_lut_fy` (0054).
 */
export const LUT_FOR_FY_SQL = `EXISTS (SELECT 1 FROM settings ts WHERE ts.key = 'tax' AND (
           EXISTS (SELECT 1 FROM json_each(ts.value, '$.luts') l WHERE json_extract(l.value, '$.fy') = ?FY AND trim(coalesce(json_extract(l.value, '$.arn'), '')) <> '')
           OR (json_extract(ts.value, '$.lut.fy') = ?FY AND trim(coalesce(json_extract(ts.value, '$.lut.arn'), '')) <> '')))`;

/**
 * FX-4 (full audit A5 11): a tax-only debit note ("Tax charged too low", Researched 2026-10-28, s.34(3) CGST Act (08-C RA-22); or any debit note with a taxable value of
 * nil) carries no round-off: its total is exactly its tax, in its own currency and in its INR view (`computed.inr.roundOffMinor`). True when the row `n` (a table name or
 * `NEW`) may freeze; every other document passes. The twin of core `taxOnlyDebitNote` (which never rounds); used by the note freeze's WHERE (`noteIssueTail`) and by the
 * trigger `documents_tax_only_note_exact` (0052). Settled by the lead on the safest reading, 2026-10-30 (08-C RA-33): never rounded: round-off 0, the total is its tax. Not
 * rounding is the engine's existing "none" mode: no direction is invented and the total is never below the tax.
 */
export const taxOnlyNoteExactSql = (n: string): string =>
  `(${n}.type IS NOT 'debit_note' OR (json_extract(${n}.header_extras, '$.noteOf.reason.code') IS NOT 'tax_charged_too_low' AND ${n}.taxable_minor IS NOT 0) OR (${n}.taxable_minor IS 0 AND ${n}.round_off_minor IS 0 AND ${n}.total_minor IS ${n}.cgst_minor + ${n}.sgst_minor + ${n}.igst_minor AND coalesce(json_extract(${n}.computed, '$.inr.roundOffMinor'), 0) IS 0))`;

/**
 * T4 (rt2): an issuer block (`issuer`, an SQL expression holding its JSON: a bound parameter or `NEW.issuer`) that carries the signature: a signature reference
 * with its SHA-256, and no `signatory` key (the switch-off marker never appears on a document that must be signed). The twin of core `signatureRequired` with a saved
 * signature; used by the note and advance freeze WHEREs (`issue.ts`) and the trigger `documents_signature_required` (0055). Researched 2026-10-30, Rule 53(1A) CGST
 * Rules (08-C RA-22) for notes; s.31(3)(d) CGST Act and Rule 50 CGST Rules (08-C RA-17) for the invoice for a payment received.
 */
export const signedIssuerSql = (issuer: string): string =>
  `(json_extract(${issuer}, '$.signature.sha256') IS NOT NULL AND json_type(${issuer}, '$.signatory') IS NULL)`;

/**
 * The FY token ("2627") of an ISO date given as an SQL expression (`date`), the twin of core `fyOfDate(...).token` (1 April to 31 March; a test compares the
 * two day by day). Used by the trigger `documents_advance_lut_fy` (0050), which has only the receipt day to go on; the advance freeze binds the token.
 */
export const fyTokenOfDateSql = (date: string): string =>
  `(CASE WHEN CAST(substr(${date}, 6, 2) AS INTEGER) >= 4 THEN substr(${date}, 3, 2) || printf('%02d', (CAST(substr(${date}, 3, 2) AS INTEGER) + 1) % 100) ELSE printf('%02d', (CAST(substr(${date}, 3, 2) AS INTEGER) + 99) % 100) || substr(${date}, 3, 2) END)`;

/**
 * ADM-INV-10 (owner, 2026-10-30, docs/13; runs/proforma-withdraw L1): the document `a` (a table alias or `NEW`/`OLD`) reached the client: it was opened
 * in the portal (`viewed_at`) or emailed (any `document_sends` row). The withdraw route's freeze WHERE and the readers of a withdrawn proforma use it.
 */
export const proformaDeliveredSql = (a: string): string =>
  `(${a}.viewed_at IS NOT NULL OR EXISTS (SELECT 1 FROM document_sends s WHERE s.document_id = ${a}.id))`;

/**
 * A withdrawn proforma: a void proforma that had reached the client (the twin of core `isWithdrawn`; a db test compares the two). Unambiguous because
 * a delivered proforma reaches `void` only through the withdraw route (the void route refuses a send row or a view, and so does trigger
 * `documents_viewed_no_void`); triggers `documents_void_no_view` and `document_sends_not_void` (0056) keep the facts from changing after the void.
 */
export const withdrawnSql = (a: string): string =>
  `(${a}.type = 'proforma' AND ${a}.status = 'void' AND ${proformaDeliveredSql(a)})`;

// ---- the ledger (M6.1; ADM-PAY-06, ADM-INV-16; run file A.5, A.6) -------------------------------------------------------------------------------------------
// Shared by the trigger set `payment_triggers` (0060) and the statements of `ledger.ts`, so the bound checks, the post-condition and the recompute sum the same way.
// Only CONFIRMED payments count: a pending, rejected or withdrawn payment's allocation rows (a withdrawn one keeps its history) are ignored by every sum.

/** The document types a payment is put on (core `PAYABLE_TYPES`; a test compares them): never a proforma or a credit note. */
export const PAYABLE_TYPES_SQL = "('tax_invoice', 'export_invoice', 'debit_note')";
/** The statuses the ledger moves an issued document between (core `LEDGER_STATUSES`). */
export const LEDGER_STATUSES_SQL = "('issued', 'partially_paid', 'paid', 'partially_credited', 'credited')";

/** What confirmed `payment` rows hold on document `doc` (an SQL expression): Σ allocate − Σ release. */
export const livePaidSql = (doc: string): string =>
  `(SELECT coalesce(sum(CASE lpa.kind WHEN 'allocate' THEN lpa.amount_minor ELSE -lpa.amount_minor END), 0) FROM payment_allocations lpa JOIN payments lpp ON lpp.id = lpa.payment_id WHERE lpa.document_id = ${doc} AND lpp.status = 'confirmed' AND lpp.kind = 'payment')`;

/** The TDS confirmed `tds` rows put on document `doc`: Σ allocate (a TDS row is never released). */
export const liveTdsSql = (doc: string): string =>
  `(SELECT coalesce(sum(lta.amount_minor), 0) FROM payment_allocations lta JOIN payments ltp ON ltp.id = lta.payment_id WHERE lta.document_id = ${doc} AND ltp.status = 'confirmed' AND ltp.kind = 'tds' AND lta.kind = 'allocate')`;

/** What payment `payment` holds net (Σ allocate − Σ release), on every document or on document `doc` only. */
export const paymentNetSql = (payment: string, doc?: string): string =>
  `(SELECT coalesce(sum(CASE pna.kind WHEN 'allocate' THEN pna.amount_minor ELSE -pna.amount_minor END), 0) FROM payment_allocations pna WHERE pna.payment_id = ${payment}${doc === undefined ? "" : ` AND pna.document_id = ${doc}`})`;

/**
 * M6.5 (L1, L8, L35; ADM-PAY-08): what payment `payment` (an SQL expression for its id) has given back or is giving back: Σ its refunds that are not `failed`
 * (`requested` and `processing` hold the money while the gateway works; a failed refund leaves it as credit). One seek of `payment_refunds_payment`. With
 * `which = "succeeded"`, only the refunds that went out (what a statement of account lists, `STATEMENT_LEDGER_SQL`).
 */
export const paymentRefundedSql = (payment: string, which: "live" | "succeeded" = "live"): string =>
  `(SELECT coalesce(sum(prf.amount_minor), 0) FROM payment_refunds prf WHERE prf.payment_id = ${payment} AND prf.status ${which === "live" ? "<> 'failed'" : "= 'succeeded'"})`;

/**
 * M7.2 (review 1, finding 5): payment row `p` (an SQL table name or alias of `payments`) has given all its money back: it holds nothing net on any document
 * (`paymentNetSql`) and its live refunds (`paymentRefundedSql`) cover its amount. "Send receipt again" refuses such a payment's receipt (409 `receipt_refunded`,
 * in the pre-check and the INSERT's WHERE) and the entry's receipt read says so (`refundedInFull`). A payment held as credit (net 0, nothing refunded) or partly
 * refunded is not refunded in full.
 */
export const paymentRefundedInFullSql = (p: string): string =>
  `(${paymentNetSql(`${p}.id`)} = 0 AND ${paymentRefundedSql(`${p}.id`)} >= ${p}.amount_minor)`;

/**
 * M6.5 (L35; Step 0 point 3): THE free money of payment row `p` (an SQL table name or alias of `payments`): its amount less what it holds net on documents
 * (`paymentNetSql`) and less what it has refunded or is refunding (`paymentRefundedSql`). It is the client's credit from that payment, what a refund from credit
 * may take, and what an allocation may still use. Every reader and trigger from 0070 on uses this one helper (core `unallocated` in `@techaust/core/ledger` is the
 * twin); `packages/db/test/free-money-guard.test.ts` fails on a hand-written `amount_minor - ${paymentNetSql(…)}` outside the triggers 0060 pins. `which`: as
 * `paymentRefundedSql` (the statement of account counts only the refunds that went out).
 */
export const paymentFreeSql = (p: string, which: "live" | "succeeded" = "live"): string =>
  `(${p}.amount_minor - ${paymentNetSql(`${p}.id`)} - ${paymentRefundedSql(`${p}.id`, which)})`;

/**
 * M6.5 (RA-41; Settled by the lead on the safest reading, 2026-11-03 (08-C RA-41)): payment row `p`'s credit may be an advance whose GST was due when it arrived,
 * so the screens show the RA-41 line: it has free money, and it is on no invoice, or it is not in INR, or its free money is above the s.13(2) proviso's amount
 * (`proviso`, an SQL expression: `tax.excessProvisoMinor`). The twin of core `overpaymentAdvanceLine` (`@techaust/core/refunds`; a db test compares them).
 */
export const overpaymentAdvanceSql = (p: string, proviso: string): string =>
  `(${paymentFreeSql(p)} > 0 AND (${paymentNetSql(`${p}.id`)} <= 0 OR ${p}.currency <> 'INR' OR ${paymentFreeSql(p)} > ${proviso}))`;

/**
 * M6.5 (RA-41; review part 1, finding 3): what payment `payment` (an SQL expression) held net on documents at instant `at` (UTC ms, an SQL expression): its
 * allocations less its releases written at or before `at`. The as-of twin of `paymentNetSql` (allocations are append-only, so the past is exact).
 * With `held` (payment row `p`, IST day `day`; code re-check of M6.5, finding 1): a payment received in the period but confirmed after `at` also counts what its
 * confirm (`created_at <= p.verified_at`) put on documents issued on or before `day`: the money paid an invoice of the period and was never an advance (L48).
 */
export const paymentNetAtSql = (payment: string, at: string, held?: { p: string; day: string }): string =>
  `(SELECT coalesce(sum(CASE pna.kind WHEN 'allocate' THEN pna.amount_minor ELSE -pna.amount_minor END), 0) FROM payment_allocations pna INDEXED BY payment_allocations_payment WHERE pna.payment_id = ${payment} AND (pna.created_at <= ${at}${
    held
      ? ` OR (${held.p}.verified_at > ${at} AND pna.created_at <= ${held.p}.verified_at AND EXISTS (SELECT 1 FROM documents pnd WHERE pnd.id = pna.document_id AND pnd.issue_date <= ${held.day}))`
      : ""
  }))`;

/**
 * M6.5 (RA-41; review part 1, finding 3): payment row `p`'s credit held at instant `at`, the last instant of IST day `day` (both SQL expressions): its amount less
 * what it held net then (`paymentNetAtSql`) and less its refunds that had gone out by then (succeeded; money still on its way back was still held: the safe side
 * for Table 11A). Second review, L4: a refund from credit (no release row) counts by the day it went out (`settled_on`, as the statement and "Collected" count
 * it), so a bank refund paid before the period ended but recorded after it is not held at the end; a refund of an invoice's excess counts at its instant
 * (`settled_at`), the instant its release row was written, so the two always cancel out together. M6–M7 audit AU37 (Settled by the lead on the safest reading,
 * 2026-11-07 (08-C RA-41)): a refund that came back after `at` still counts as gone out at `at` (`refundOutAtSql`), so a filed period's figure never moves.
 */
export const paymentFreeAtSql = (p: string, at: string, day: string): string =>
  `(${p}.amount_minor - ${paymentNetAtSql(`${p}.id`, at, { p, day })} - (SELECT coalesce(sum(pra.amount_minor), 0) FROM payment_refunds pra INDEXED BY payment_refunds_payment WHERE pra.payment_id = ${p}.id AND ${refundOutAtSql("pra", `(${at}) + 1`)}
     AND CASE WHEN pra.release_allocation_id IS NULL THEN pra.settled_on <= ${day} ELSE pra.settled_at <= ${at} END))`;

/**
 * M6.5 (RA-41; Settled by the lead on the safest reading, 2026-11-03 (08-C RA-41); review part 1, finding 3): `overpaymentAdvanceSql` at instant `at` (a period's
 * end, the last instant of IST day `day`): payment row `p` held credit then that may be an advance (on no invoice, not in INR, or above the proviso `proviso`).
 * A db test holds it to core `overpaymentAdvanceLine` over the figures at `at`.
 */
export const overpaymentAdvanceAtSql = (p: string, at: string, day: string, proviso: string): string =>
  `(${paymentFreeAtSql(p, at, day)} > 0 AND (${paymentNetAtSql(`${p}.id`, at, { p, day })} <= 0 OR ${p}.currency <> 'INR' OR ${paymentFreeAtSql(p, at, day)} > ${proviso}))`;

/**
 * The status of an issued document for these figures (SQL expressions): the twin of core `ledgerStatusOf(total, paid, credited, tds)` with `settled` = paid + TDS
 * (a db test compares them over a table of figures).
 */
export const ledgerStatusCaseSql = (total: string, settled: string, credited: string): string =>
  `CASE WHEN ${credited} >= ${total} THEN 'credited' WHEN ${settled} > 0 AND ${total} - ${settled} - ${credited} <= 0 THEN 'paid' WHEN ${settled} > 0 THEN 'partially_paid' WHEN ${credited} > 0 THEN 'partially_credited' ELSE 'issued' END`;

/**
 * M6.2: document `d` of client `k` (aliases) can be paid online now (the twin of core `payableOnline` in `@techaust/core/online-pay`): a tax invoice, debit note or
 * proforma; in INR; issued and not void (a withdrawn proforma is a void one); of a live client in India that is not overseas (owner, 2026-11-01, Q3 A; a USD
 * invoice credited to us in INR through a gateway keeps 9 months: Settled by the lead on the safest reading, 2026-10-30 (08-C RB-01)); with at least ₹1 due (Razorpay's minimum); a proforma issued
 * or converted (early check 1, finding 5) with its balance in whole rupees (LD28). A db test holds it to core `payableOnline`.
 * M6.3: by `provider`'s row of the rule table (`ONLINE_RULES_SQL`; Stripe: an export invoice, debit note or proforma in USD of an overseas client, at least 50
 * cents, cents allowed), and for every provider no gateway payment still waiting on it (`gatewayPaymentPendingSql`, core `payment_pending`).
 * M6.4: PayPal's row (Stripe's values, L21). `exceptCheckout` (an SQL expression): the PayPal capture claim asks whether the document is payable apart from its
 * OWN claimed checkout (a stale claim taken again must not block itself); every other caller leaves it out.
 */
export const onlinePayableSql = (
  d: string,
  k: string,
  provider: OnlineProviderSql,
  exceptCheckout?: string,
): string => {
  const r = ONLINE_RULES_SQL[provider];
  const whole = r.wholeUnitsOnProforma ? ` AND ${d}.balance_minor % 100 = 0` : "";
  return `(${d}.type IN (${r.types.map((t) => `'${t}'`).join(", ")}) AND ${d}.currency = '${r.currency}' AND ${d}.frozen_at IS NOT NULL AND ${d}.status <> 'void'
    AND ${k}.anonymised_at IS NULL AND ${clientSideSql(k, r.clients)}
    AND ${d}.balance_minor >= ${r.minMinor} AND (${d}.type <> 'proforma' OR (${d}.status IN ('issued', 'converted')${whole}))
    AND NOT ${gatewayPaymentPendingSql(d, exceptCheckout)})`;
};

/**
 * M6.3: the rule table of core `ONLINE_RULES` (`@techaust/core/online-pay`) as plain values, so this module keeps no imports (a db test holds the two equal). One row
 * per gateway (L14): its currency, whose documents (`domestic`: in India and not overseas; `overseas`: exactly the complement), the types, the gateway's minimum and
 * whether a proforma is paid in whole units. M6.4 adds PayPal.
 */
export const ONLINE_RULES_SQL = {
  razorpay: {
    currency: "INR",
    clients: "domestic",
    types: ["tax_invoice", "debit_note", "proforma"],
    minMinor: 100,
    wholeUnitsOnProforma: true,
  },
  stripe: {
    currency: "USD",
    clients: "overseas",
    types: ["export_invoice", "debit_note", "proforma"],
    minMinor: 50,
    wholeUnitsOnProforma: false,
  },
  paypal: {
    currency: "USD",
    clients: "overseas",
    types: ["export_invoice", "debit_note", "proforma"],
    minMinor: 50,
    wholeUnitsOnProforma: false,
  },
} as const;
export type OnlineProviderSql = keyof typeof ONLINE_RULES_SQL;

/** Client `k` (alias) is on the gateway's side: `domestic` (in India and not overseas) or `overseas` (`country <> 'IN' OR gst_status = 'overseas'`). */
export const clientSideSql = (k: string, side: "domestic" | "overseas"): string =>
  side === "domestic"
    ? `${k}.country = 'IN' AND ${k}.gst_status <> 'overseas'`
    : `(${k}.country <> 'IN' OR ${k}.gst_status = 'overseas')`;

/**
 * M6.3 staging fixes (L5, L6, L17; ADM-PAY-01, ADM-INV-10; Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17); lead's decision 1, 2026-11-02):
 * THE one rule "payment `p` is for document `doc`" (`p` an SQL table name or alias of `payments`, `doc` an SQL expression), as the documents it is for: the ones
 * its own `requested_allocations` name (frozen once written), and, for a gateway payment (`provider <> 'manual'`), the document its checkout was made for (a
 * payment that didn't match is pending with no request, but its money still came through that document's page). Every reader of the rule builds on this: the
 * advance's F6 check and freeze, the decision's refusal and `verifyPaymentStatement`, the waiting-payment guard, the proforma panel's waiting entries, the void
 * and withdraw blockers and the "payment already waiting" check of the payment links (`gatewayPaymentPendingSql`). No core twin exists (core only receives the
 * facts). A `json_each` of at most 10 rows and a primary-key seek.
 */
export const paymentDocumentsSql = (p: string): string =>
  `SELECT json_extract(fj.value, '$.documentId') FROM json_each(${p}.requested_allocations) fj
     UNION ALL SELECT fc.document_id FROM checkout_sessions fc WHERE fc.id = ${p}.checkout_id AND ${p}.provider <> 'manual'`;

/** Payment `p` is for document `doc` (`paymentDocumentsSql`): a boolean SQL expression. */
export const paymentForDocumentSql = (p: string, doc: string): string =>
  `(${doc} IN (${paymentDocumentsSql(p)}))`;

/**
 * M6.3 (generic, every gateway; reviewer X1; core `payableOnline`'s `payment_pending`): document `d` (alias) has a gateway payment still waiting: a
 * `pending_verification` payment through a gateway that is for it (`paymentForDocumentSql`: its request names it, or, lead's final round of the staging fixes,
 * 2026-11-02, it came through the document's checkout with no request: a mismatch). No new payment link or card page is made for the document while one waits
 * (the money may already be there: "no need to pay again", 07-ZI line 13, 07-ZM line 4). A manual entry Staff recorded doesn't count here: the client's lines
 * name the gateway. A seek of `payments_client`.
 * M6.4 (L24; Step 0.2 item 10): or a PayPal checkout of the document whose money may be on its way (`checkoutCapturingSql`): PayPal holds its capture
 * (`capture_pending`), or a capture call has claimed it. `exceptCheckout`: that one checkout doesn't count (the capture claim's own row).
 */
export const gatewayPaymentPendingSql = (d: string, exceptCheckout?: string): string =>
  `(EXISTS (SELECT 1 FROM payments gpp INDEXED BY payments_client
     WHERE gpp.client_id = ${d}.client_id AND gpp.status = 'pending_verification' AND gpp.provider <> 'manual' AND ${paymentForDocumentSql("gpp", `${d}.id`)})
     OR ${checkoutCapturingSql(`${d}.id`, exceptCheckout)})`;

/**
 * M6.4 (L24): document `doc` (an SQL expression) has a PayPal checkout whose money may be on its way: PayPal holds its capture (`capture_pending`: no payment row
 * until it completes, L6), or it is live or stale with a capture claim (a capture call may have gone through and its answer not come back). Neither is a
 * payment row, so the payment-row rules don't see it; this does, for the online pay rule (`gatewayPaymentPendingSql`) and the void and withdraw blockers
 * (`paymentPendingForSql`, `paymentPendingKindsSql` in `ledger.ts`). A stale claim still counts (the sweep re-fetches the order before anything ends it).
 * `except`: one checkout id (an SQL expression) left out. One seek of `checkout_sessions_document`.
 */
export const checkoutCapturingSql = (doc: string, except?: string): string =>
  `EXISTS (SELECT 1 FROM checkout_sessions gcc INDEXED BY checkout_sessions_document
     WHERE gcc.document_id = ${doc} AND gcc.provider = 'paypal' AND (gcc.status = 'capture_pending' OR (gcc.status IN ('live', 'stale') AND gcc.capture_started_at IS NOT NULL))${except === undefined ? "" : ` AND gcc.id <> ${except}`})`;

/**
 * M6.2 (review finding 10): proforma `d` has an online payment of client `client` (SQL expressions) waiting for its automatic tax invoice: a pending Razorpay payment
 * through one of its links WITH its requested allocation. A mismatch or an overpaid proforma's money has none, so no tax invoice follows it automatically and the
 * portal must not say "tax invoice to follow" (07-ZI line 16) or hide Pay now for it. The portal's Pay now block reads it; a db test holds it.
 */
// M6.3 (early check 1, "What B2 must not forget" 6): any gateway's payment, not only Razorpay's: a USD proforma paid by card waits for the Owner's tax invoice
// (C8 "Paid by card on {date}; invoice to follow"; Q1 A).
export const proformaOnlinePendingSql = (d: string, client: string): string =>
  `EXISTS (SELECT 1 FROM payments p JOIN checkout_sessions c ON c.id = p.checkout_id
        WHERE c.document_id = ${d}.id AND p.client_id = ${client} AND p.provider <> 'manual' AND p.status = 'pending_verification' AND p.requested_allocations IS NOT NULL AND ${d}.type = 'proforma')`;

// ---- the void rules (L17, L32; moved here from `ledger.ts` in M6.5 so the trigger set `refund_triggers` (0070) can read them; `ledger.ts` re-exports them) ----

/**
 * L17, L32 (the void rules): an allocation row names the document `doc` (an SQL expression), one released or withdrawn since included. Core `voidBlockers`
 * `payment_recorded`; one seek of `payment_allocations_document`.
 */
export const paymentRecordedSql = (doc: string): string =>
  `EXISTS (SELECT 1 FROM payment_allocations va INDEXED BY payment_allocations_document WHERE va.document_id = ${doc})`;

/**
 * L17 (the void rules): a PENDING payment of the client `client` is for the document `doc` (both SQL expressions; `paymentForDocumentSql`: its request, or, M6.3
 * staging fix, an online payment's checkout). Core `voidBlockers` `payment_pending`; a seek of `payments_client`. Any pending payment: the void and withdraw
 * WHEREs. The trigger `documents_void_no_payment` reads it too since 0070 (M6.5, L39; 0060 read the request only).
 * M6.4 (L24; Step 0.2 item 10): or a PayPal checkout of the document whose money may be on its way (`checkoutCapturingSql`: PayPal holds its capture, or a
 * capture call has claimed it): voiding or withdrawing the document then could leave money PayPal takes with nothing to apply it to (the trigger too, 0070).
 */
export const paymentPendingForSql = (doc: string, client: string): string =>
  `(EXISTS (SELECT 1 FROM payments vp INDEXED BY payments_client WHERE vp.client_id = ${client} AND vp.status = 'pending_verification'
     AND ${paymentForDocumentSql("vp", doc)}) OR ${checkoutCapturingSql(doc)})`;

/**
 * L17 (early check 2, finding 10): the payment test of the void statement's WHERE, `NOT ${paymentBlocksVoidSql(...)}`: an allocation row names the document,
 * or a pending payment of its client asks for it. The twin of the trigger `documents_void_no_payment` (which also refuses TDS, as the WHERE's `tds_minor = 0`
 * does) and of core `voidBlockers` (`payment_recorded`, `payment_pending`). `doc` and `client` are SQL expressions (`documents.id`, `documents.client_id`).
 */
export const paymentBlocksVoidSql = (doc: string, client: string): string =>
  `(${paymentRecordedSql(doc)} OR ${paymentPendingForSql(doc, client)})`;

/** Payment `p` (an alias) is on an advice now (a link not taken off): one seek of `realisation_advice_payments_active`. The "Proof awaited" filter reads it too. */
export const paymentHasAdviceSql = (p: string): string =>
  `EXISTS (SELECT 1 FROM realisation_advice_payments al INDEXED BY realisation_advice_payments_active WHERE al.payment_id = ${p}.id AND al.removed_at IS NULL)`;

// ---- the full client portal (M7.1; POR-06, POR-09, ADM-PAY-05; run file docs/runs/m7.1-portal.md B, L8, L10, L12) --------------------------------------------
// The SQL twins of `@techaust/core/portal` (a db test compares each with its core rule). Plain text, no imports, like everything above.

/** Core `VIEW_PAY_GRACE_MS` (30 days in ms; a test pins the two). */
export const VIEW_PAY_GRACE_MS_SQL = 2_592_000_000;

/**
 * When document `d` (a documents alias) was last settled: the latest of its allocation rows' `created_at`, the freeze of any credit note against it, and the
 * freeze of any tax or export invoice issued from it (a proforma's money is on its tax invoice for the payment received, `parent_id` = the proforma: early check 1
 * finding 2); never before the document's own freeze (B2: a document settled at issue, such as one with no allocation row, ends 30 days after it was issued,
 * never at once). One seek of `payment_allocations_document` and one of `documents_parent`.
 */
export const settledAtSql = (d: string): string =>
  `max(coalesce(${d}.frozen_at, 0),
       coalesce((SELECT max(vpa.created_at) FROM payment_allocations vpa INDEXED BY payment_allocations_document WHERE vpa.document_id = ${d}.id), 0),
       coalesce((SELECT max(vcn.frozen_at) FROM documents vcn INDEXED BY documents_parent WHERE vcn.parent_id = ${d}.id AND vcn.type IN ('credit_note', 'tax_invoice', 'export_invoice') AND vcn.frozen_at IS NOT NULL), 0))`;

/**
 * Document `d` is settled for L12: `paid` or `credited`, or a proforma `converted` with nothing left to pay (its last tax invoice for a payment received settled
 * it; a part-paid converted proforma is still owed: early check 1 finding 2). A refund moves a document back out of these (M6.5 L1).
 */
export const viewPaySettledSql = (d: string): string =>
  `(${d}.status IN ('paid', 'credited') OR (${d}.type = 'proforma' AND ${d}.status = 'converted' AND ${d}.balance_minor <= 0))`;

/**
 * L12: the emailed "View & pay" link of document `d` still opens at `now` (an SQL expression, UTC ms): the document is not settled (`viewPaySettledSql`), or it
 * was settled less than 30 days ago. The twin of core `viewPayLive(settledAt, now)` with `settledAt` from `settledAtSql` while settled, else null.
 */
export const viewPayLiveSql = (d: string, now: string): string =>
  `(NOT ${viewPaySettledSql(d)} OR ${now} < ${settledAtSql(d)} + ${VIEW_PAY_GRACE_MS_SQL})`;

/**
 * The start of the IST day of `now` (an SQL expression, UTC ms): the twin of core `fromIst(istDate(now))`. D1 binds a JavaScript number as REAL, so `now` is cast
 * to INTEGER first and the division is an integer one.
 */
export const istDayStartSql = (now: string): string =>
  `((CAST(${now} AS INTEGER) + 19800000) / 86400000 * 86400000 - 19800000)`;

/**
 * L8: how many requests contact `contact` has sent since the start of the IST day of `now` (both SQL expressions); the route refuses the sixth (core
 * `REQUESTS_PER_DAY`, 429 `too_many_requests`). One range seek of `client_requests_contact`.
 */
export const REQUESTS_TODAY_SQL = (contact: string, now: string): string =>
  `(SELECT count(*) FROM client_requests rq INDEXED BY client_requests_contact WHERE rq.contact_id = ${contact} AND rq.created_at >= ${istDayStartSql(now)} AND rq.channel = 'portal')`;
// M7.4 (M7.1 early check 1 note 1): only the contact's own portal requests count against the daily cap; a request staff logged for them (email, post,
// phone, in person) never stops them sending one from the portal.

/** Core `NOTICE_TYPES`, `NOTICE_OPEN_STATUSES` and `NOTICE_PROFORMA_STATUSES` (a test pins them). */
export const NOTICE_TYPES_SQL = "('tax_invoice', 'export_invoice', 'debit_note', 'proforma')";
export const NOTICE_OPEN_STATUSES_SQL = "('issued', 'partially_paid', 'partially_credited')";
export const NOTICE_PROFORMA_STATUSES_SQL = "('issued', 'converted')";

/**
 * L10: why document `d` (a documents alias) can't take an "I've paid" notice, as core `noticeAllowed`'s reason code in the same order, or NULL when it can. The
 * route's INSERT…SELECT keeps `${noticeRefusalSql("d")} IS NULL` in its WHERE, and a refused insert reads the code for its 409 `not_payable`.
 */
export const noticeRefusalSql = (d: string): string =>
  `(CASE WHEN ${withdrawnSql(d)} THEN 'withdrawn' WHEN ${d}.status = 'void' THEN 'void' WHEN ${d}.type = 'credit_note' THEN 'credit_note'
     WHEN ${d}.type NOT IN ${NOTICE_TYPES_SQL} THEN 'not_payable_type' WHEN ${d}.type = 'proforma' AND ${d}.status NOT IN ${NOTICE_PROFORMA_STATUSES_SQL} THEN 'proforma_not_issued'
     WHEN ${d}.status = 'paid' THEN 'paid' WHEN ${d}.type <> 'proforma' AND ${d}.status NOT IN ${NOTICE_OPEN_STATUSES_SQL} THEN 'not_open'
     WHEN ${d}.balance_minor IS NULL OR ${d}.balance_minor <= 0 THEN 'no_balance' END)`;

/**
 * L10 (C15): core `paidNoticeVerdict` over SQL expressions (the amount and the balance in minor units, the ISO days paid, of issue and of today in IST): `ok`, or
 * the first refusal in core's order. A NULL amount, balance or day paid refuses (early check 1 finding 7), and an issue day that is NULL refuses
 * (`date_before_issue`), so a document without one never takes a notice.
 */
export const paidNoticeVerdictSql = (
  amount: string,
  balance: string,
  paidOn: string,
  issueDate: string,
  today: string,
): string =>
  `(CASE WHEN ${amount} IS NULL OR ${balance} IS NULL OR ${amount} > ${balance} THEN 'amount_above_balance' WHEN ${paidOn} IS NULL OR ${paidOn} > ${today} THEN 'date_in_future'
     WHEN ${issueDate} IS NULL OR ${paidOn} < ${issueDate} THEN 'date_before_issue' ELSE 'ok' END)`;
