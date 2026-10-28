# 07-T: Credit note and debit note copy for M5.3

_Drafted by the lead on 2026-10-27 from approved facts:
- 04: ADM-INV-11 (credit notes; the 30 November block; IMS status), debit notes (s.34(3));
- 07: §1, §8 (the credit and debit note email cores);
- 08-A §6 (s.34, Rule 53(1A), IMS) and TL;DR rows 6, 9, 10;
- the M5 batch decisions (owner question Q14 built with its default; LD17).

**Approved by the lead on 2026-10-28 under the owner's delegation** ([13-decisions](../13-decisions.md) 2026-10-28), after the research in [08-C](../08-research-appendix/C-research-register.md). Sections 1–2 are client-facing (PDF and email; the email bodies of §2 are replaced by 07-U §1). The rest is staff-facing. `{…}` is filled by the screen. Tax and legal lines carry **(Researched, 08-C <ID>)** or **(OPEN, 08-C <ID>)**: an OPEN line is our wording until the CA answers. Section 9 holds the lines added on 2026-10-28._

## 1. Credit note and debit note PDFs (client-facing)
- Titles: "Credit Note" · "Debit Note"
- Copy mark: "ORIGINAL FOR RECIPIENT"; the stored supplier copy: "DUPLICATE FOR SUPPLIER" (07-R §6)
- Header labels: "Credit note number" / "Debit note number" · "Date" · "Against invoice" · "Invoice date" · "Place of supply" · "State code"
- Reason line: "Reason: {reason}"
- Lines and tax summary as the tax invoice (07-R §6), with the amounts being credited or added.
- Totals: "Taxable value" · "CGST" · "SGST" · "IGST" · "Round-off" · "Total credited" (credit note) / "Total added" (debit note)
- Words: "Amount in words: {words}"
- Reverse charge: as frozen at issue (07-R §6)
- Effect line, credit note: "This credit note reduces the amount due on invoice {invoice number} by {total}."
- Effect line, debit note: "This debit note increases the amount due on invoice {invoice number} by {total}."
- Export credit note (USD): "Exchange rate: 1 USD = ₹{rate} (the rate of invoice {invoice number})" (OPEN, 08-C RA-21: which date's rate a note on a USD export uses was not researched; the invoice's rate is our default)
- Signature: "For {company legal name}" · "Authorised signatory"

## 2. Emails (client-facing, from billing@; 07 §8 cores)
- Credit note, subject: "Credit note {number} for invoice {invoice number}"
- Credit note, body: "Hi {first name}, we've issued credit note {number} for {total} against invoice {invoice number}. Reason: {reason}. The amount due on the invoice is now {balance}. The credit note is attached and in your client portal."
- Debit note, subject: "Debit note {number} for invoice {invoice number}"
- Debit note, body: "Hi {first name}, we've issued debit note {number} for {total} against invoice {invoice number}, because the invoice amount needed correcting upwards. Reason: {reason}. The amount due on the invoice is now {balance}. The debit note is attached and in your client portal."
- (Sent in M5.4 with the other invoice emails.)

## 3. Creating a note (admin, Owner)
- Actions on an issued invoice: "Issue credit note" · "Issue debit note"
- Credit note dialog title: "Credit note against {invoice number}"
- Choice: "Credit some lines" · "Credit an amount" · "Credit the whole invoice"
- Line picker column: "Credit" · hint: "Up to {remaining} can still be credited on this line."
- Amount field: "Amount to credit (GST included)" · hint: "Up to {remaining} can still be credited on this invoice."
- Reason label: "Reason (required, printed on the credit note)" · options: "Price correction" · "Service not delivered" · "Service deficient" · "Discount after sale" · "Other" (then "Describe the reason") (Researched, 08-C RA-02, RA-22; "Discount after sale" only for notes dated 1 November 2026 or later)
- Debit note dialog title: "Debit note against {invoice number}"
- Debit note body: "Use a debit note when the invoice amount was too low. It adds to the amount due."
- Debit reason options: replaced by §9 (Q35, owner 2026-10-28)
- Step-up and final statement: "Once issued, this note can't be changed." + the standard code prompt (07-H)
- Buttons: "Issue credit note" / "Issue debit note" · "Cancel"
- Done toasts: "Credit note {number} issued." · "Debit note {number} issued."

## 4. Deadline banner (ADM-INV-11; s.34(2))
- Before the deadline: "A credit note for this invoice must be reported in a GST return filed by {date} (30 November after its financial year, or the day you file that year's annual return, if earlier)." (Researched, 08-C RA-03)
- From 1 October before it (replaces "within 30 days"; lead 2026-10-28): "Only {days} days left for a credit note on this invoice. Issue it by 31 October so it goes into a return filed in time." (OPEN, 08-C RA-31: the warning is the safe side)
- After it (credit actions disabled): "The deadline for a credit note on this invoice was {date}. A refund now can't reduce the GST already paid. Talk to your CA." (Researched, 08-C RA-03)
- Settings › Tax field: "Annual return (GSTR-9) filed on" · hint: "Only if you file GSTR-9 for that year: it's optional up to ₹2 crore turnover. Once you enter the date, credit notes for that year are blocked." (Researched, 08-C RA-03)

## 5. IMS status (Q14)
- Field label on an issued credit note: "Client's response in IMS"
- Options: "Pending" · "Accepted" · "Rejected" · "Not applicable" (unregistered clients)
- Hint: "For a GST-registered client, your GST is reduced only once they accept the credit note in the GST portal's Invoice Management System. Update this from the portal." (Researched, 08-C RA-04; what a rejection means for the client's balance is OPEN, RA-04)
- Saved toast: "IMS status saved."

## 6. Invoice status and list
- Status badges: "Partly credited" · "Credited"
- Frozen invoice view, notes section: "Credit and debit notes" · row "{number} · {date} · {total} · {status}"
- Balance line: "Balance due: {balance} (after {count} notes)"

## 7. Error messages (API codes)
| Code | Message |
|---|---|
| credit_exceeds_remaining | "That's more than can still be credited on this invoice ({remaining})." |
| line_credit_exceeds | "Line {n} can only be credited up to {remaining}." |
| credit_deadline_passed | "The deadline for a credit note on this invoice has passed." (Researched, 08-C RA-03) |
| parent_not_issued | "Notes can only be issued against an issued invoice." |
| parent_void | "This invoice is void, so no note can be issued against it." |
| note_reason_required | "Enter a reason." |
| nothing_to_credit | "Choose at least one line or an amount above zero." |
| ims_not_applicable | "IMS status only applies to credit notes for GST-registered clients." |

## 8. Lines added after the M5.3 brief and stage A (2026-10-27; pending owner approval)
| Code or place | Line |
|---|---|
| parent_fully_credited | "This invoice has already been credited in full." |
| parent_changed | "Another credit or debit note was issued on this invoice a moment ago. Open it again to see what's left." |
| note_draft_exists | "There's already a draft {credit/debit} note for this invoice. Open it to continue." |
| notes_limit | "This invoice already has 20 {credit/debit} notes, the most it can have." |
| note_lines_derived | "A note's lines come from its invoice and can't be edited directly." |
| note_not_voidable | "Credit and debit notes can't be voided. Correct a credit note with a debit note, or a debit note with a credit note." (Researched, 08-C RA-22) |
| ims_not_pending | "The client's IMS response is already recorded." |
| annual_return_future | "The filing date can't be in the future." |
| credit_amount_unfit | "Because of rounding, the nearest amount this credit note can be is {closest}. Use that amount instead?" · button "Use {closest}" |
| credit_shape_mismatch | "This credit note doesn't match its invoice any more. Start again from the invoice." |
| Staff, notes | "Request issue" (as 07-R §3) · bell to the owner: "{requester} asked you to issue a {credit/debit} note for {client name}." · requester, approved: "Your {credit/debit} note for {client name} was issued as {number}." · rejected: "Your request to issue the {credit/debit} note for {client name} was rejected." |
| Approval emails, notes | subject "{Credit/Debit} note issue requested for {client name}" · body "{requester} asked you to issue a draft {credit/debit} note for {client name}, total {total}, against invoice {invoice number}. Open the approvals queue to issue or reject it." · decided as 07-R §3 with "{credit/debit} note" |
| Refund due line (invoice view) | "Refund due to the client: {amount}. Refunds are recorded with payments." |
| Against line label | "Against line {n}" |
| Deadline basis, supply year earlier | "The deadline counts from FY {fy}, when the payment was received or the work was completed." (OPEN, 08-C RA-03 Q32: the earlier year is the stricter reading) |
| §3 line hint (replaces the earlier one) | "Before GST. Up to {remaining} can still be credited on this line." |
| Debit note, USD rate line (PDF) | "Exchange rate: 1 USD = ₹{rate} (the rate of invoice {invoice number})" |
| Debit reasons (Q35, replaces §3's list) | replaced by §9 |
| Annual returns list, errors | "Enter the financial year." · "This year already has a filing date." · "The filing date must be after the end of that financial year." |

## 9. Lines added on 2026-10-28 (lead, from 08-C, the owner's answers and the code's marked gaps)
| Code or place | Line |
|---|---|
| Debit reasons (Q35, owner 2026-10-28; replaces §3 and §8) | "Price correction" · "Tax charged too low" · "Other" (then "Describe the reason") (Researched, 08-C RA-22) |
| "Tax charged too low" hint | "Adds only the missing tax. The taxable value stays as invoiced." |
| "Tax charged too low", amount field | "Tax to add" · hint: "Up to the difference between the tax due and the tax on invoice {invoice number}." |
| debit_tax_only_invalid | "Enter tax only: the taxable value of a "Tax charged too low" note is zero." |
| "Discount after sale" hint | "For a discount agreed after the invoice. Your GST is reduced only once a registered client reverses the matching input tax credit." (Researched, 08-C RA-02, RA-04) |
| discount_reason_not_in_force | "A credit note for a discount after sale can be dated from 1 November 2026." (Researched, 08-C RA-02) |
| debit_parent_fully_credited | "This invoice has been credited in full, so a debit note can't be issued against it. Issue a new invoice instead." |
| credit_amount_unfit, no closest amount (Q66) | "This amount is too small to credit after rounding. Enter a larger amount." |
| content_changed, a note draft whose invoice changed | "Another note was issued on this invoice since this draft was saved. Open the draft and save it again." |
