// The first version of the proposal terms (ADM-SET-08, M4.3 review fix 7): the text of docs/07-content-appendix/O-m4.3-proposal-screens.md section 2,
// word for word. Every line comes from approved copy (docs/07 5.3 and 5.5); no placeholders. Insert-only like the rest of the seed: a terms row the
// owner has already saved as version 1 is never replaced, and a later version the owner writes is never touched.
//
// VERIFY WITH CA/LEGAL: the whole text, and especially "Payment" (GST at 18 %) and "Ownership".
// THE OWNER CONFIRMS: the warranty line (item 4, "fixed free for 30 days after launch"); docs/07 5.5 item 8 is still marked for the owner.
export const PROPOSAL_TERMS_V1_OWNER_CONFIRMS = "warranty";

export const PROPOSAL_TERMS_V1 = [
  "1. **Scope and price.** The price covers the written scope. If you want something new, we quote it before doing it, and you decide. We don't bill for our own estimating mistakes.",
  "2. **Payment.** Payments follow the schedule in this proposal. Invoices are due within 7 days. GST at 18 % is added for Indian clients.",
  "3. **Ownership.** On full payment, the code, designs and documentation are yours. We keep the right to reuse general know-how and our own pre-existing tools, which we list in this proposal.",
  "4. **Warranty.** Defects in what we delivered are fixed free for 30 days after launch.",
  "5. **AI tools.** We use AI coding and writing tools to work faster. A senior engineer reviews everything before it reaches you, and we never paste your confidential data into tools that train on it.",
  "6. **Validity.** This proposal is valid until the date shown on it.",
].join("\n\n");

/** SHA-256 of `PROPOSAL_TERMS_V1` (hex). The seed is plain SQL text, so the hash is written down; a test recomputes it. */
export const PROPOSAL_TERMS_V1_SHA256 = "b22d7bddec58c7f45a0cc3997e387e5c292ffc39bf57fb990787c5d2d977edee";
