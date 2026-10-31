// The first version of the proposal terms (ADM-SET-08, M4.3 review fix 7): the text of docs/07-content-appendix/O-m4.3-proposal-screens.md section 2,
// word for word. Every line comes from approved copy (docs/07 5.3 and 5.5); no placeholders. Insert-only like the rest of the seed: a terms row the
// owner has already saved as version 1 is never replaced, and a later version the owner writes is never touched.
//
// Settled by the lead on the safest reading, 2026-10-30 (08-C RB-38): the text (the owner chose the four clauses, 07-ZE, terms v4), Ownership (Copyright Act s.19: a one-page deed of assignment on full payment, signed by the owner with Aadhaar eSign, 07-ZE, T11) and the GST line; GST at 18 %: Researched 2026-10-28 (08-C RA-16).
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

/**
 * The second seeded proposal terms (FX-5; 07-Y items 1 and 2, approved by the owner on 2026-10-29, docs/13): version 1 with the owner's interim
 * Ownership clause (Researched 2026-10-29, Copyright Act ss.17, 19 (08-C RB-38); Settled by the lead on the safest reading, 2026-10-30 (08-C RB-38): a one-page deed of assignment on full payment, signed by the owner with Aadhaar eSign (07-ZE, T11; a one-off lawyer review of the deed is wise)) and the
 * GST line that no longer says "for Indian clients" (IGST can fall on an overseas client too; 08-C RB-38, RA-16, RA-18). Every other line is
 * version 1's, word for word. Documents already sent keep the version they pinned. The seed adds it as the NEXT version of the proposal terms,
 * once (by its SHA-256), only while the newest proposal terms row is the seeded version 1 (FX-5 review M2); an owner's later version is never
 * touched or followed.
 */
export const PROPOSAL_TERMS_V2 = [
  "1. **Scope and price.** The price covers the written scope. If you want something new, we quote it before doing it, and you decide. We don't bill for our own estimating mistakes.",
  "2. **Payment.** Payments follow the schedule in this proposal. Invoices are due within 7 days. GST at 18 % is added unless the work is an export of services under our Letter of Undertaking.",
  "3. **Ownership.** On full payment, we assign to you all copyright in the work we make under this proposal, worldwide and for its full term; the assignment does not lapse if unused. Our pre-existing tools and third-party or open-source parts are licensed to you, not assigned. We keep the right to reuse general know-how.",
  "4. **Warranty.** Defects in what we delivered are fixed free for 30 days after launch.",
  "5. **AI tools.** We use AI coding and writing tools to work faster. A senior engineer reviews everything before it reaches you, and we never paste your confidential data into tools that train on it.",
  "6. **Validity.** This proposal is valid until the date shown on it.",
].join("\n\n");

/** SHA-256 of `PROPOSAL_TERMS_V2` (hex); a test recomputes it. */
export const PROPOSAL_TERMS_V2_SHA256 = "7493354ab0e8dd4ae1a1f748c555d65f057d8c7bf52558e57b1fa50b81a556ab";

/**
 * The third seeded proposal terms (final sweep P9; 07-ZA item 14, approved by the owner on 2026-10-30, docs/13): one shared text for proposals
 * and estimates, so "this proposal" becomes "this proposal or estimate" in Payment (item 2) and Ownership (item 3), and "This proposal is
 * valid" becomes "This proposal or estimate is valid" in Validity (item 6). Every other word is version 2's. Documents already sent keep the
 * version they pinned. The seed adds it as the NEXT version, once, only while the newest proposal terms row is the seeded version 2; an
 * owner's own later version is never followed. The Ownership and GST lines are version 2's word for word, with its tags: Researched
 * 2026-10-29, Copyright Act ss.17, 19 (08-C RB-38); Settled by the lead on the safest reading, 2026-10-30 (08-C RB-38): a one-page deed of assignment
 * on full payment, signed by the owner with Aadhaar eSign (07-ZE, T11; a one-off lawyer review of the deed is wise).
 */
export const PROPOSAL_TERMS_V3 = [
  "1. **Scope and price.** The price covers the written scope. If you want something new, we quote it before doing it, and you decide. We don't bill for our own estimating mistakes.",
  "2. **Payment.** Payments follow the schedule in this proposal or estimate. Invoices are due within 7 days. GST at 18 % is added unless the work is an export of services under our Letter of Undertaking.",
  "3. **Ownership.** On full payment, we assign to you all copyright in the work we make under this proposal or estimate, worldwide and for its full term; the assignment does not lapse if unused. Our pre-existing tools and third-party or open-source parts are licensed to you, not assigned. We keep the right to reuse general know-how.",
  "4. **Warranty.** Defects in what we delivered are fixed free for 30 days after launch.",
  "5. **AI tools.** We use AI coding and writing tools to work faster. A senior engineer reviews everything before it reaches you, and we never paste your confidential data into tools that train on it.",
  "6. **Validity.** This proposal or estimate is valid until the date shown on it.",
].join("\n\n");

/** SHA-256 of `PROPOSAL_TERMS_V3` (hex); a test recomputes it. */
export const PROPOSAL_TERMS_V3_SHA256 = "be066fe58669d4d1701ec1eb598caf308eab79a97e05d04116d30b5750be8f70";
