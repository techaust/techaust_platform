# 07-T: Credit note and debit note copy for M5.3

_Drafted by the lead on 2026-10-27 from approved facts:
- 04: ADM-INV-11 (credit notes; the 30 November block; IMS status), debit notes (s.34(3));
- 07: §1, §8 (the credit and debit note email cores);
- 08-A §6 (s.34, Rule 53(1A), IMS) and TL;DR rows 6, 9, 10;
- the M5 batch decisions (owner question Q14 built with its default; LD17).

**PENDING the owner's word-for-word approval** (batch rule). Sections 1–2 are client-facing (PDF and email). The rest is staff-facing. `{…}` is filled by the screen. **Every tax and legal line is VERIFY WITH CA/LEGAL.** Anything missing is `[Placeholder]`._

## 1. Credit note and debit note PDFs (client-facing)
- Titles: "Credit Note" · "Debit Note"
- Copy mark: "ORIGINAL FOR RECIPIENT"
- Header labels: "Credit note number" / "Debit note number" · "Date" · "Against invoice" · "Invoice date" · "Place of supply" · "State code"
- Reason line: "Reason: {reason}"
- Lines and tax summary as the tax invoice (07-R §6), with the amounts being credited or added.
- Totals: "Taxable value" · "CGST" · "SGST" · "IGST" · "Round-off" · "Total credited" (credit note) / "Total added" (debit note)
- Words: "Amount in words: {words}"
- Reverse charge: as frozen at issue (07-R §6)
- Effect line, credit note: "This credit note reduces the amount due on invoice {invoice number} by {total}."
- Effect line, debit note: "This debit note increases the amount due on invoice {invoice number} by {total}."
- Export credit note (USD): "Exchange rate: 1 USD = ₹{rate} (the rate of invoice {invoice number})" (VERIFY WITH CA/LEGAL)
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
- Reason label: "Reason (required, printed on the credit note)" · options: "Price correction" · "Service not delivered" · "Service deficient" · "Discount after sale" · "Other" (then "Describe the reason") (VERIFY WITH CA/LEGAL)
- Debit note dialog title: "Debit note against {invoice number}"
- Debit note body: "Use a debit note when the invoice amount was too low. It adds to the amount due."
- Debit reason options: "Price correction" · "Additional work agreed" · "Tax charged too low" · "Other" (VERIFY WITH CA/LEGAL)
- Step-up and final statement: "Once issued, this note can't be changed." + the standard code prompt (07-H)
- Buttons: "Issue credit note" / "Issue debit note" · "Cancel"
- Done toasts: "Credit note {number} issued." · "Debit note {number} issued."

## 4. Deadline banner (ADM-INV-11; s.34(2))
- Before the deadline: "Credit notes for this invoice must be issued by {date} (30 November after its financial year, or earlier if the annual return is filed)." (VERIFY WITH CA/LEGAL)
- Within 30 days of it: "Only {days} days left to issue a credit note for this invoice."
- After it (credit actions disabled): "The deadline for a credit note on this invoice was {date}. A refund now can't reduce the GST already paid. Talk to your CA." (VERIFY WITH CA/LEGAL)
- Settings › Tax field: "Annual return (GSTR-9) filed on" · hint: "Once filed, credit notes for that year are blocked."

## 5. IMS status (Q14)
- Field label on an issued credit note: "Client's response in IMS"
- Options: "Pending" · "Accepted" · "Rejected" · "Not applicable" (unregistered clients)
- Hint: "For a GST-registered client, your GST is reduced only once they accept the credit note in the GST portal's Invoice Management System. Update this from the portal." (VERIFY WITH CA/LEGAL)
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
| credit_deadline_passed | "The deadline for a credit note on this invoice has passed." (VERIFY WITH CA/LEGAL) |
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
| note_not_voidable | "Credit and debit notes can't be voided. Correct a credit note with a debit note, or a debit note with a credit note." (VERIFY WITH CA/LEGAL) |
| ims_not_pending | "The client's IMS response is already recorded." |
| annual_return_future | "The filing date can't be in the future." |
| credit_amount_unfit | "Because of rounding, the nearest amount this credit note can be is {closest}. Use that amount instead?" · button "Use {closest}" |
| credit_shape_mismatch | "This credit note doesn't match its invoice any more. Start again from the invoice." |
| Staff, notes | "Request issue" (as 07-R §3) · bell to the owner: "{requester} asked you to issue a {credit/debit} note for {client name}." · requester, approved: "Your {credit/debit} note for {client name} was issued as {number}." · rejected: "Your request to issue the {credit/debit} note for {client name} was rejected." |
| Approval emails, notes | subject "{Credit/Debit} note issue requested for {client name}" · body "{requester} asked you to issue a draft {credit/debit} note for {client name}, total {total}, against invoice {invoice number}. Open the approvals queue to issue or reject it." · decided as 07-R §3 with "{credit/debit} note" |
| Refund due line (invoice view) | "Refund due to the client: {amount}. Refunds are recorded with payments." |
| Against line label | "Against line {n}" |
| Deadline basis, supply year earlier | "The deadline counts from FY {fy}, when the payment was received or the work was completed." (VERIFY WITH CA/LEGAL) |
| §3 line hint (replaces the earlier one) | "Before GST. Up to {remaining} can still be credited on this line." |
| Debit note, USD rate line (PDF) | "Exchange rate: 1 USD = ₹{rate} (the rate of invoice {invoice number})" |
| Debit reasons (Q35, replaces §3's list) | "Price correction" · "Other" (then "Describe the reason") |
| Annual returns list, errors | "Enter the financial year." · "This year already has a filing date." · "The filing date must be after the end of that financial year." |
