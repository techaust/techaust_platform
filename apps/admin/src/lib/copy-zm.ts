// 07-ZM (docs/07-content-appendix/ZM-m6.3-stripe.md): the staff lines of Stripe Pay by card [ADM-PAY-01, -03, ADM-INV-17, ADM-SET-06; M6.3 run file G, H]. Staff-only
// words, drafted in the brief (S13 to S18) and approved by the lead under the owner's delegation once the designer has placed them; until then each shows the
// "[Placeholder] " mark (the copy-zl.ts pattern), and `APPROVED_07ZM` turns true when the lead approves the placed page. S16, S17 and S19 are the finance
// Worker's (apps/admin/worker/gateway/reasons.ts and messages.ts); S19 is the builder's draft for the lead. Pure, so the words are tested without a browser.

export const APPROVED_07ZM = false;
export const PLACEHOLDER_MARK = "[Placeholder]";
/** A 07-ZM staff line as the screen shows it: marked until the lead approves the placed page. */
export const ZM = (line: string): string => (APPROVED_07ZM ? line : `${PLACEHOLDER_MARK} ${line}`);

export const CARD_ZM = {
  /** S13: the "Card payments" card on a USD document's Payments panel (no staff-made link, L7). */
  cardTitle: ZM("Card payments"),
  cardBody: ZM(
    "Clients pay by card from their portal page or the emailed invoice link. Each card page lasts an hour, so there is no link to copy.",
  ),
  copyPortalLink: ZM("Copy portal link"),
  /** S14: a Stripe payment's rows. `rate` is worked out in bigint from the two INR and USD figures, never a stored float (L10). */
  paymentRow: (paymentId: string) => ZM(`Stripe · card · ${paymentId}`),
  inrCredited: (inr: string, rate: string) =>
    ZM(`INR credited by Stripe ${inr} (about ₹${rate} per USD; not the GST rate)`),
  fee: (fee: string, tax: string) => ZM(`Stripe fee ${fee} incl. GST ${tax} (absorbed)`),
  /** S15: the proof slot (L11). */
  proofAwaited: ZM("Proof awaited"),
  proofHint: ZM("Attach Stripe's payment advice or the bank's e-FIRA for this payment."),
  /** S18: Settings › Payment terms, the two USD fields (Owner only). */
  floorLabel: ZM("Smallest part-payment by card (USD)"),
  maximumLabel: ZM("Largest card payment (USD)"),
  // Early check 2, finding 3 (lead under delegation, 2026-11-02): the ₹25 lakh cap binds a payment aggregator (PA-CB); Stripe is not one, so for card payments it
  // is our safest setting, not a legal limit (Researched 2026-10-28, RBI PA Directions 2025 ¶11(d); lead, 2026-11-02 (08-C RB-07)).
  maximumHint: ZM(
    "RBI limits a payment aggregator's export payment to ₹25 lakh per transaction. We keep card payments under it too: keep this below ₹25 lakh at today's rate.",
  ),
} as const;

/**
 * Designer's drafts for the lead (M6.3, 2026-11-02; staff-only): words the placed screens need that 07-ZM doesn't have. Marked with the "[Placeholder]" sign
 * until the lead approves them (`APPROVED_ZM_DRAFTS`, its own switch, so approving S13 to S19 never approves these by accident). Listed in the run file's
 * designer report.
 */
export const APPROVED_ZM_DRAFTS = false;
const DRAFT = (line: string): string => (APPROVED_ZM_DRAFTS ? line : `${PLACEHOLDER_MARK} ${line}`);
export const ZM_DRAFTS = {
  /** "Needs review": the column naming the item's gateway (run file G2). */
  colGateway: DRAFT("Gateway"),
  /** Settings › Gateways, the Stripe key's kind (L3: only a restricted test key is used while payments are not live). */
  keyRestrictedTest: DRAFT("Restricted test key"),
  keyRestrictedLive: DRAFT("Restricted live key. It isn't used until go-live."),
  keyRefused: DRAFT("Not a restricted key, so it is refused. Card payments stay off until it is replaced."),
} as const;
