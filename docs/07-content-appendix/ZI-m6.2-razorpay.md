# 07-ZI: M6.2 Razorpay Pay now

Status: **client lines C1–C16 APPROVED by the owner, 2026-11-01** (as drafted). Staff lines S17–S24 are staff-only: drafted by the analyst, approved by the lead under the owner's delegation once the designer has placed them (the designer may tighten them; any change is listed in the run file). Lines in `{braces}` are filled in by the screen. All lines pass 07 §1.3.

## Client lines (portal; owner-approved, word for word)
1. "Pay now"
2. "How much would you like to pay?"
3. "The full amount due ({amount})"
4. "Part of it (at least {minimum})"
5. "Enter an amount between {minimum} and {balance}."
6. "Enter an amount of at least {minimum}." / "That's more than the amount due ({balance})."
7. "Enter a whole number of rupees."
8. "Continue to Razorpay"
9. "You'll pay on Razorpay's page by UPI, card or netbanking. We never see your card or bank details."
10. "Checking your payment…" / "This usually takes under a minute. You can close this page; the invoice will show the payment once it's confirmed."
11. "Thank you. We've received {amount}."
12. "Thank you. We've received {amount}. Your tax invoice for this payment is being prepared and will appear under Invoices."
13. "We haven't had confirmation from Razorpay yet. If money left your account, it will show here once Razorpay confirms it. There's no need to pay again."
14. "Online payment isn't available right now. You can pay by bank transfer using the details on the invoice."
15. "Thank you. If your payment went through, it will show on the invoice within a few minutes. Open the link in our email again to see it."
16. "Paid online on {date}; tax invoice to follow"

### Razorpay payment page description (owner, 2026-11-01, early check 1 Q4)
17. "Invoice {number}" (a tax invoice)
18. "Proforma {number}"
19. "Debit note {number}"

## Staff lines (admin; lead under delegation)
S17. "Payment link", "Create payment link", "Copy link", "Cancel link", "Expires {date}"; chips "Live", "Paid", "Expired", "Cancelled", "Replaced"
18. "Razorpay · {method} · {payment id}" / "Fee {amount} (absorbed)"
19. "Needs review" / "Nothing needs review."
20. Review reasons:
    - `amount_mismatch` "The amount paid ({paid}) doesn't match the link ({expected})."
    - `unknown_link` "A payment arrived for a link we don't know."
    - `document_not_payable` "The invoice could no longer be paid when the money arrived ({reason}). The money waits for your decision."
    - `advance_blocked` "The tax invoice for this payment couldn't be issued automatically: {blocker}. Issue it from the proforma."
    - `refetch_failed` / `dead_letter` "Razorpay couldn't be reached to confirm this payment. Try again."
    - `overpaid` "The client paid {extra} more than was due. It is held as credit."
    - `proforma_overpaid`, `partial_payment`, `client_gone`, `currency_mismatch`, `reference_mismatch`: one line each in the same style (designer drafts)
21. "Mark as resolved", "Try again", "Open payment"
22. Bells: "{client} paid {amount} online for {number}." / "A payment needs review: {reason}." / "Razorpay webhook signatures failed 5 times in an hour. Check the webhook secret."
23. "Keys: configured / missing", "Last verified webhook: {time}", "No webhook received yet"
24. The API messages for every new error code in the run file's section C (designer drafts).
