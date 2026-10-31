// The first version of the proposal terms (ADM-SET-08, M4.3 review fix 7): the text of docs/07-content-appendix/O-m4.3-proposal-screens.md section 2,
// word for word. Every line comes from approved copy (docs/07 5.3 and 5.5); no placeholders. Insert-only like the rest of the seed: a terms row the
// owner has already saved as version 1 is never replaced, and a later version the owner writes is never touched.
//
// OPEN (08-C RB-38): the text, Ownership (Copyright Act s.19) and the GST line; GST at 18 %: Researched 2026-10-28 (08-C RA-16).
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
 * Ownership clause (Researched 2026-10-29, Copyright Act ss.17, 19 (08-C RB-38); OPEN (08-C RB-38): the lawyer's final assignment wording) and the
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
 * 2026-10-29, Copyright Act ss.17, 19 (08-C RB-38); OPEN (08-C RB-38): the lawyer's final assignment wording (the lead settles it on the safest
 * reading under the owner's 2026-10-30 no-CA decision, docs/13).
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

/**
 * The fourth seeded proposal terms (T6; 07-ZE lines 6 to 12, approved by the owner on 2026-10-31, docs/13): items 1 to 5 are version 3's word
 * for word; item 6 "Validity and acceptance" replaces "Validity" (07-ZE line 7); items 7 to 10 are new (lines 8, 9 with line 10 in the same
 * paragraph, 11 and 12); the consumer line (07-ZE line 6) follows item 10 as its own paragraph. Documents already sent keep the version they
 * pinned. The seed adds it as the NEXT version, once, only while the newest proposal terms row is the seeded version 3; an owner's own later
 * version is never followed. Tags (07-ZE "Tags for code comments"):
 *   - item 6: Researched 2026-10-31, Contract Act s.7(2) (08-C RB-35); its IST closes OPEN (08-C RB-35(a)) by naming the time zone; the
 *     newer-version sentence: Researched 2026-10-29, Contract Act s.6 (08-C RB-35); OPEN (08-C RB-35(b)): s.5 not read.
 *   - items 7, 8, 9 and 10: OPEN (08-C RB-38(c)): commercial choices, no statute read; item 8's personal data also OPEN (08-C RB-38(c)): DPDP s.8.
 *   - item 10's MCIA facts (a Kolkata seat the parties agree): Researched 2026-10-31, MCIA Rules 2025 r.30.1 (08-C RB-38(c)).
 *   - the consumer line: OPEN (08-C RB-23): CPA 2019 ss.2(7) and 34 read in secondary sources only.
 * Items 1 to 5 keep version 3's tags (Ownership and GST: Researched 2026-10-29, Copyright Act ss.17, 19 (08-C RB-38)).
 */
export const PROPOSAL_TERMS_V4 = [
  "1. **Scope and price.** The price covers the written scope. If you want something new, we quote it before doing it, and you decide. We don't bill for our own estimating mistakes.",
  "2. **Payment.** Payments follow the schedule in this proposal or estimate. Invoices are due within 7 days. GST at 18 % is added unless the work is an export of services under our Letter of Undertaking.",
  "3. **Ownership.** On full payment, we assign to you all copyright in the work we make under this proposal or estimate, worldwide and for its full term; the assignment does not lapse if unused. Our pre-existing tools and third-party or open-source parts are licensed to you, not assigned. We keep the right to reuse general know-how.",
  "4. **Warranty.** Defects in what we delivered are fixed free for 30 days after launch.",
  "5. **AI tools.** We use AI coding and writing tools to work faster. A senior engineer reviews everything before it reaches you, and we never paste your confidential data into tools that train on it.",
  "6. **Validity and acceptance.** This proposal or estimate is valid until the end of the date shown on it, India Standard Time (IST). You accept it only by typing your name and clicking Accept in our client portal; a reply by email, letter or message is not an acceptance. When we send a newer version, it replaces the earlier ones, which can no longer be accepted.",
  "7. **Ending the work.** Either of us may end this work with 15 days' written notice; email is fine. If you ask us to stop sooner, we stop that day. You pay for work done up to the end and for third-party costs we've already committed for you; we refund anything you've paid for work not done, as our Refunds and cancellations policy says. Care plans and subscriptions need 30 days' notice. Once you've paid everything due, the Ownership clause applies to the work delivered up to the end. Items 8 to 10 still apply after the work ends.",
  "8. **Confidentiality.** Each of us keeps the other's confidential information private and uses it only for this work, while the work lasts and for 3 years after it ends; trade secrets and personal data stay protected for as long as they remain confidential or the law requires. Either of us may share it with our own staff or contractors who need it and must keep it confidential, or when a law, court or regulator requires it (telling the other first where we're allowed to). Information isn't confidential if it was already public or already known to the one receiving it, came lawfully from someone else, or was developed independently. We name you as a client, or show the work publicly, only with your written permission.",
  "9. **Liability.** Neither of us is liable to the other for indirect or remote losses, or for lost profits or revenue. Each side's total liability under this proposal or estimate is limited to the fees you have paid us under it. These limits don't apply to fraud, to deliberate wrongdoing, to your payment of our fees, or to any liability the law doesn't allow to be limited.",
  "10. **Law and disputes.** Indian law governs this agreement. If you are based in India, the courts at Balurghat, Dakshin Dinajpur, West Bengal, have exclusive jurisdiction. If you are based outside India, any dispute we can't settle by talking within 30 days is finally decided by arbitration under the Arbitration and Conciliation Act, 1996, and the Rules of the Mumbai Centre for International Arbitration (MCIA): one arbitrator, seated in Kolkata, in English, with hearings by video where the arbitrator allows.",
  "If you are a consumer under the Consumer Protection Act, 2019, nothing in these terms limits your rights under that Act, including where you may bring a complaint.",
].join("\n\n");

/** SHA-256 of `PROPOSAL_TERMS_V4` (hex); a test recomputes it. */
export const PROPOSAL_TERMS_V4_SHA256 = "e180ddb4ab49141860b2d59fa80ec824a2f129ab781110fa24e32d9a446746fe";
