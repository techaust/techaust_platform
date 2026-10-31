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
