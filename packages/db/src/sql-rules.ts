// Pure SQL text of the tax rules that both the issue statements (`issue.ts`, a Worker module) and the generated triggers (`triggers.ts`, also read by the
// Node-only script `scripts/write-triggers.ts`) use. No D1 types and no imports, so either side can take it. `issue.ts` re-exports every name.

/**
 * The currencies a document or a payment can be in: the schema's `CURRENCY_CODES` (the CHECK constraints `documents_currency`, `payments_currency`), kept here
 * as plain text so Worker SQL needs no drizzle import. The dashboard's one-pass figures (`INVOICED_SQL`, `OWED_SQL`, `PROFORMAS_AWAITING_SQL`, the ledger's
 * `COLLECTED_TILE_SQL`) have one column set per currency in this list, so a db test pins it to `CURRENCY_CODES` and to the installed CHECK constraints: a new
 * currency added to one and not the other fails there, never silently drops its row.
 */
export const SQL_CURRENCIES = ["INR", "USD"] as const;

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
 */
export const paymentNetAtSql = (payment: string, at: string): string =>
  `(SELECT coalesce(sum(CASE pna.kind WHEN 'allocate' THEN pna.amount_minor ELSE -pna.amount_minor END), 0) FROM payment_allocations pna INDEXED BY payment_allocations_payment WHERE pna.payment_id = ${payment} AND pna.created_at <= ${at})`;

/**
 * M6.5 (RA-41; review part 1, finding 3): payment row `p`'s credit held at instant `at`: its amount less what it held net then (`paymentNetAtSql`) and less its
 * refunds that had gone out by then (succeeded, settled at or before `at`; money still on its way back was still held: the safe side for Table 11A).
 */
export const paymentFreeAtSql = (p: string, at: string): string =>
  `(${p}.amount_minor - ${paymentNetAtSql(`${p}.id`, at)} - (SELECT coalesce(sum(pra.amount_minor), 0) FROM payment_refunds pra INDEXED BY payment_refunds_payment WHERE pra.payment_id = ${p}.id AND pra.status = 'succeeded' AND pra.settled_at <= ${at}))`;

/**
 * M6.5 (RA-41; Settled by the lead on the safest reading, 2026-11-03 (08-C RA-41); review part 1, finding 3): `overpaymentAdvanceSql` at instant `at` (a period's
 * end): payment row `p` held credit then that may be an advance (on no invoice, not in INR, or above the proviso `proviso`). A db test holds it to core
 * `overpaymentAdvanceLine` over the figures at `at`.
 */
export const overpaymentAdvanceAtSql = (p: string, at: string, proviso: string): string =>
  `(${paymentFreeAtSql(p, at)} > 0 AND (${paymentNetAtSql(`${p}.id`, at)} <= 0 OR ${p}.currency <> 'INR' OR ${paymentFreeAtSql(p, at)} > ${proviso}))`;

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
