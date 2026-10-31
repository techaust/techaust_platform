# 07-ZH: the ledger and manual payments, TDS and FEMA extensions (M6.1)

Status: **APPROVED by the owner, 2026-10-31** (lines 1–21 as written; run file [m6.1-ledger-payments](../runs/m6.1-ledger-payments.md), Q3). Change a line here first, then in the code. Lines in `{braces}` are filled in by the screen. Lines 1–17 and 19–21 are for staff (admin); line 18 is for clients (portal); line 19 also prints on the client's statement.

1. Invoice › Payments panel: heading "Payments"; rows "Paid", "TDS deducted by the client", "Credited", "Balance", "Paid above what it owes".
2. Record payment dialog: title "Record a payment"; fields "Amount the client paid", "Date received", "How it was paid" (options NEFT, RTGS, IMPS, UPI, SWIFT), "Bank reference (UTR)", "Bank charges (we absorb them)", "Proof", "Proof type" (hint "FIRA, FIRC, e-BRC or bank advice"), "Proof reference", "Note".
3. Staff notice in the dialog: "The owner checks this payment before it counts toward the balance."
4. Payments list: tab "Payments to check"; buttons "Confirm" and "Reject"; field "Why it is rejected".
5. Owner's bell: "{name} recorded a payment of {amount} from {client}. Check it."
6. Requester's bells: "Your payment of {amount} from {client} was confirmed." / "Your payment of {amount} from {client} was rejected: {reason}."
7. TDS: heading "Tax deducted at source (TDS)"; fields "Section the client used", "Rate the client used (%)", "TDS amount on the certificate", "Certificate number (Form 16A)"; hint "The invoice and its GST stay at full value. Enter the section, rate and amount exactly as the client's certificate shows them."
8. Badge on a TDS line without a certificate: "Certificate awaited".
9. Overpayment line: "{amount} is more than this invoice owes. It is kept as {client}'s credit."
10. Client credit: "Credit held: {amount}"; button "Use credit on this invoice"; warning: "This money arrived in {month}. GST on it was due in that month's return; if that return is filed, add it to the next one with interest."
11. Move excess: "Move {amount} paid above what this invoice owes to the client's credit."
12. Proforma: "A payment on a proforma is confirmed by issuing the tax invoice for the payment received."
13. Errors:
    - `allocation_exceeds_balance`: "This is more than the invoice still owes ({amount})."
    - `reference_seen`: "This bank reference was already recorded on {date} for {client}. Record it again only if it is a different payment."
    - `payment_not_pending`: "This payment was already checked."
    - `tds_not_allowed`: "TDS applies only to rupee invoices for clients in India."
14. Export invoice, realisation: button "Bank extended the date"; fields "New last date", "Bank's reference", "Bank's letter"; hint "Only your bank can extend this date." (08-C RB-04: "your bank", not "RBI".)
15. Proof hint on an export payment: "Add the bank's FIRA or FIRC when it arrives."
16. Dashboard tiles: "Collected this month", "Payments to check".
17. Client › Overview "Collected" and a project's "Paid" (they replace "Collected figures arrive with payments.").
18. Portal, the invoice summary (client-facing): "TDS deducted by you".
19. Statement line labels (screen and PDF): "Payment received", "TDS deducted".
20. Reports: "Payments and TDS register".
21. Void blocker: "A payment recorded on it is waiting for the owner's check. Reject it first."

22. Refusal when anonymising a client with a payment waiting for the check (`payments_pending`): "This client has payments waiting for the owner's check. Confirm or reject them first." (Lead, 2026-10-31, staff-only wording under the owner's delegation.)

Any line added after 2026-10-31 (an empty state, a withdraw dialog, a Reject confirmation) is numbered from 23 and is marked with whoever approved it.

## Lines 23–45: PENDING (the designer's recommended words, 2026-10-31; all staff-only, admin screens)

None of these is client-facing. Until they are approved the screens show each one after a "[Placeholder]" mark (`APPROVED_07ZH_NEW` in `apps/admin/src/lib/copy-zh.ts`; one switch removes every mark). Words already approved elsewhere are reused and not repeated here: "Client" (07-R), "Invoice" and "Amount" (07-V §4), "Enter an amount above zero.", "Enter the date the payment was received.", "Enter the payment reference." (07-S), "Requested" (07-O), the step-up code field and "Cancel".

23. Refusals the API returns without 07-ZH words (by code):
    - `already_recorded`: "This payment is already recorded."
    - `use_payment_verify`: "Check this payment from Payments, not from Approvals."
    - `received_on_future`: "The date received can't be after today."
    - `currency_mismatch`: "A payment must be in the client's currency."
    - `client_mismatch`: "That invoice belongs to another client."
    - `not_payable`: "A payment can go only on an issued invoice or debit note."
    - `exceeds_payment`: "The amounts put on invoices add up to more than the payment."
    - `tds_not_whole`: "A TDS amount goes on one invoice, in full."
    - `too_many`: "A payment can go on at most 10 invoices."
    - `reason_required`: "Say why it is rejected."
    - `payment_mismatch`: "The amount or date doesn't match the payment being confirmed."
    - `ledger_changed`: "The invoice's payments changed in the meantime. Reload and try again."
    - `payment_not_confirmed`: "Only a confirmed payment can be withdrawn."
    - `payment_advance_backed`: "A tax invoice was issued for this payment, so it can't be withdrawn. Correct it with a credit note."
    - `exceeds_credit`: "This is more than the client's credit."
    - `exceeds_excess`: "This is more than was paid above what the invoice owes."
    - `not_tds`: "Only a TDS entry has a certificate."
    - `certificate_already_set`: "The certificate is already recorded."
    - `proof_already_set`: "A proof is already attached to this payment."
    - `payment_closed`: "This payment was rejected or withdrawn, so it can't change."
    - `file_too_large`: "The file is larger than 5 MB."
    - `file_type_not_allowed`: "Attach a PDF, JPEG or PNG file."
    - `letter_already_set`: "The bank's letter is already attached."
    - `not_an_export_invoice`: "Only an issued export invoice has a realisation date."
    - `proforma_ask_whole` (second early check): "A payment for a proforma goes on that proforma alone, in full."
24. FEMA extension refusals: `extension_not_later` "The new last date must be after {date}." (the current FEMA date); `extension_too_far` "The new last date can't be after {date}." (the latest allowed).
25. Void blocker `payment_recorded` (second early check; a payment was put on the invoice, even one withdrawn later; line 21 stays `payment_pending`): "A payment was put on this invoice, so it can't be voided. Use a credit note instead."
26. Audit log actions (after the person's name): `payment.record` "recorded a payment"; `payment.verify` "checked a payment"; `payment.withdraw` "withdrew a payment"; `payment.proof` "attached a payment's proof"; `payment.tds_certificate` "recorded a TDS certificate"; `payment.credit_apply` "used a client's credit on an invoice"; `payment.credit_release` "moved an invoice's excess to the client's credit"; `invoice.realisation_extend` "recorded the bank's extension of a realisation date". The record type is "Payments" (line 1).
27. An entry's status chip: "Waiting for the owner's check", "Confirmed", "Rejected", "Withdrawn".
28. Entries and columns: "Payment", "TDS"; column headings "Entry", "Status".
29. Invoice › Payments panel: buttons "Record TDS", "Move excess to credit"; empty line "No payments recorded on this invoice yet."; proof column "Open proof" / "None yet".
30. Proof: button "Attach proof"; hint "PDF, JPEG or PNG, up to 5 MB."; error "Enter the proof type."
31. Allocation table in Record a payment and Confirm: heading "Put it on these invoices"; column "Amount on this invoice"; hint "Leave a row empty to skip that invoice."; with no open invoice "This client has no open invoices. The whole amount is kept as the client's credit."; row error "This is more than the invoice still owes."
32. TDS form: field "Certificate date"; errors "Enter the certificate number and its date together, or leave both empty.", "Enter the section the client used.", "Enter the rate as a percentage, for example 10 or 7.5.", "Pick the invoice the TDS is for."; hint under Invoice "Rupee tax invoices and debit notes only."; button "Add certificate"; dialog title "Add the TDS certificate".
33. USD payment: field "Amount credited in INR (bank advice)" (L15, register only).
34. Record a payment from Payments: field "Search clients"; errors "Pick the client who paid.", "Pick how it was paid."; the button after line 13's warning "Record it again".
35. Toasts: "Payment recorded and confirmed." / "Payment recorded. The owner checks it next." / "TDS recorded." / "Payment confirmed." / "Payment rejected." / "Payment withdrawn." / "Credit used on this invoice." / "Moved to the client's credit." / "Extension recorded." / "Certificate recorded." / "Proof attached."
36. Payments list: tab "All payments"; empty states "No payments waiting for your check.", "No payments recorded yet.", "No payments match these filters."; filters "Received from", "Received to"; button "Show more payments".
37. The Owner's check: "Confirm this payment" with "It counts toward the balance of the invoices below as soon as you confirm. You can change the amounts first."; "Reject this payment" with "Nothing is put on any invoice. The person who recorded it is told why."
38. Withdraw (Owner, a confirmed entry): button "Withdraw"; title "Withdraw this payment"; body "Withdraw only an entry made in error. The invoices it was put on owe that amount again, and the entry stays in the list as withdrawn."; field "Why it is withdrawn"; error "Say why it is withdrawn."
39. One entry: title "Payment"; facts "Recorded by", "Checked by", "Why it was rejected", "Why it was withdrawn"; list headings "Put on" (confirmed) and "Asked for" (waiting); a release "Moved to credit"; button "Close".
40. Credit: fields "Amount to use", "Amount to move"; source line "From the payment received on {date}"; error "Pick the invoice the credit goes on."
41. Export invoice realisation: labels "FEMA date", "GST date"; heading "Extensions by the bank"; row "Extended to {date}, bank's reference {ref}"; "Letter not attached"; errors "Enter the new last date.", "Enter the bank's reference."
42. Proforma: button "Confirm by issuing the tax invoice".
43. Dashboard tiles: count line "1 payment" / "{n} payments"; empty lines "Nothing collected this month.", "Nothing to check."; link "Open payments to check".
44. Reports › Payments and TDS register: lede "Every confirmed payment and TDS entry received in the financial year, for your books and for matching TDS with Form 26AS and AIS."; field "Financial year"; button "Show"; progress and result "1 entry read." / "{n} entries read."; empty "No confirmed payments in this financial year."; button "Download the register (CSV)"; heading "TDS waiting for a certificate"; none "Every TDS entry has its certificate."; CSV columns "Date received, Entry, Client code, Client, Currency, Amount, Bank charges, Amount credited in INR, How it was paid, Bank reference, TDS section, TDS rate (%), Certificate number, Certificate date, Proof type, Proof reference, Put on".
45. Reports › Export realisation, the note that replaces 07-V §5's "If your bank extended a date, you can record it with the proof of payment in the payments update.": "If your bank extended a date, record it on the export invoice's page: Bank extended the date."

Two approved lines the screens no longer show, because M6.1 made them untrue (the constants stay, their tests pin the approved words): 07-V §6 statement note "Only payments recorded against payment requests are listed until online payments arrive." and 07-V §10 / 07-Y foot line "Collected figures and payments waiting for checks arrive with payments." (shown now only if the API withholds the payment tiles). Line 17 replaces "Collected figures arrive with payments." on the client Overview and a project.
