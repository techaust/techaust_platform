# 07-P: Proposal and estimate PDF wording and admin PDF copy for M4.4

_Drafted by the lead on 2026-10-26 from approved facts:
- 06 §7.1–§7.4 (layout, footer, integrity line, per-document blocks);
- 07 §5.3 and §8;
- 07-O (the template wording, terms and status names);
- the M4.4 lead decisions in `docs/runs/m4.4-pdf.md`.

**Approved by the owner word for word on 2026-10-26 ([07-Q](Q-batch-review-copy.md), "approve all")**. Sections 1–2 print on the client's PDF; sections 3–4 are staff-facing admin copy. `{…}` is filled from the frozen snapshot. Tax wording is VERIFY WITH CA/LEGAL._

## 1. Fixed wording on the PDF (client-facing)
| Where | Copy |
|---|---|
| Titles | "Proposal" · "Estimate" |
| Header blocks | "From" · "Prepared for" · "Document" |
| Supplier block | "Proprietor: {legal name}" · "GSTIN {gstin} · State {state} ({code})" · `hello@techaust.com`. Fields still empty in Settings are left out, never shown as blanks. |
| Recipient block | "GSTIN {gstin}" (or left out) · "Place of supply: {state} ({code})" · for export: "Place of supply: Outside India (96 – Other Territory)" (VERIFY WITH CA) |
| Document block | "No. {number} v{version}" · "Date {date}" · "Valid until {date}" · "Currency {INR/USD}" |
| Document status (beside "Document") | "Sent" (approved 2026-10-26, 07-Q Q4; it carries the PDF's status check) |
| Cover (proposal) | "Prepared for {client}" · "{date}" · "Version {n}" · "Valid until {date}" · "{number}" · "Your contact at TecHaust: {name}, {email}" |
| Line table | "#" · "Description" · "SAC" · "Qty" · "Unit" · "Rate" · "Discount" · "Taxable value" · "GST %" |
| Tax summary | "Tax summary" · "Taxable value" · "CGST" · "SGST" · "IGST" · "Total tax" |
| Totals | "Sub-total" · "Discount" · "Taxable value" · "Round-off" · "Total" · "Amount in words: {words}" |
| Schedule | "Payment schedule" · "Instalment" · "When" · "Share" · "Amount" |
| Timeline | "Milestone" · "What you get" · "Target date" · "Payment" |
| Estimate notice | "This is an estimate, not a tax invoice." (VERIFY WITH CA/LEGAL) |
| USD note | "International projects are invoiced from India in USD as an export of services." (07 §2.4; VERIFY WITH CA) |
| INR note | "Prices exclude GST (18 %)." (07 §2.4; VERIFY WITH CA) |
| USD documents, the rupee figure | "Indicative total in INR: {₹ amount} (1 USD = ₹{rate})." (approved 2026-10-26, 07-Q Q5; the builder's wording, printed now, lead answer 1 of 2026-10-26; VERIFY WITH CA) |
| Acceptance box | "Accept online in the TecHaust client portal: {portal link}" · "Your acceptance is recorded on a separate acceptance certificate. This document doesn't change." |
| Footer (every page) | "TecHaust Technologies · techaust.com · hello@techaust.com" · "{number} v{version}" · "Page {x} of {y}" |
| Integrity line (last page) | "Document ID {uuid} · Content fingerprint {first 12 characters}" |

## 2. Section headings
As 07-O §1 and 06 §7.4: "Summary" · "Your goals" · "Scope" · "Deliverables" · "Timeline" · "Team" · "Investment" · "Assumptions and exclusions" · "Terms" · "Acceptance".

## 3. Admin (staff)
| Where | Copy |
|---|---|
| PDF button | "Download PDF" |
| PDF states | "PDF ready" · "Making the PDF…" · after 5 minutes: "The PDF is taking longer than usual." with the button "Try again" |
| Retry result | "We'll make the PDF again." |
| A draft, where the PDF will be (owner, 2026-10-28) | "The PDF is made when you send this proposal." ("estimate" on an estimate) |
| Fingerprint | "Fingerprint {first 12 characters}" |
| Signature control (Settings, Company) | Heading "Signature" · "Printed on tax invoices above "Authorised signatory". PNG or JPEG, up to 256 KB." · buttons "Upload signature" · "Replace" · "Remove" · "Remove the signature? Invoices issued already keep theirs." |

## 4. Errors and bells (staff)
| Code or event | Copy |
|---|---|
| `pdf_pending` | "The PDF is still being made. Try again in a minute." |
| `pdf_done` | "The PDF is already made." |
| Signature, wrong type or size | "Use a PNG or JPEG image up to 256 KB." |
| Bell, the PDF failed | "The PDF for {number} v{version} could not be made. Open it to try again." |
| Bell, the PDF allowance is half used | "Half of today's PDF allowance is used." |
| Bell, the allowance ran out | "Today's PDF allowance is used up. Waiting PDFs are made tomorrow." |
