# 07-ZM: M6.3 Stripe Pay by card

Status: **client lines C1–C12 APPROVED by the owner, 2026-11-01** (as drafted; run file [m6.3-stripe](../runs/m6.3-stripe.md), Q4 A). Staff lines S13–S18 are staff-only: drafted in the brief, approved by the lead under the owner's delegation once the designer has placed them (the designer may tighten them; any change is listed in the run file). **S19 was the builder's draft (B2, 2026-11-02); the lead approved it under the owner's delegation after early check 2 (2026-11-02), with the changes listed there** (the `not_export_receipt` line, the S18 hint, the `below_gateway_minimum` words, and the `stripe_permission` API message dropped). The lead approves S13–S19 as placed once the designer has placed them. Lines in `{braces}` are filled in by the screen or the server. All lines pass 07 §1.3.

Reused word for word from [07-ZI](ZI-m6.2-razorpay.md) (currency-neutral): lines 2 to 6, 10, 11 and 14. Amounts in US dollars are written en-US (`$1,234.56`).

## Client lines (portal; owner-approved, word for word)
1. "Pay by card"
2. "Continue to Stripe"
3. "You'll pay by card on Stripe's page. Stripe asks for the cardholder's name and billing address. We never see your card details."
4. "We haven't had confirmation from Stripe yet. If your card was charged, the payment will show here once Stripe confirms it. There's no need to pay again."
5. "You left Stripe's page. If you didn't finish paying, you can try again."
6. "Online payments are limited to {maximum} at a time. Pay part now and the rest later, or pay by bank transfer."
7. "Thank you. We've received {amount}. The invoice for this payment will follow and will appear under Invoices."
8. "Paid by card on {date}; invoice to follow"

### On Stripe's own page (sent with each Checkout Session)
9. "Invoice {number}" (an export invoice) / "Proforma invoice {number}" / "Debit note {number}" (the line item's name)
10. "TecHaust Technologies: software and IT services, {document type} {number}" (the payment's description; `{document type}` is "invoice", "proforma invoice" or "debit note")
11. "TECHAUST" (the card-statement suffix)
12. "TecHaust Technologies" (the name on Stripe's page)

## Staff lines (admin; lead under delegation)
S13. "Card payments" / "Clients pay by card from their portal page or the emailed invoice link. Each card page lasts an hour, so there is no link to copy." / "Copy portal link"
S14. "Stripe · card · {payment id}" / "INR credited by Stripe {inr} (about ₹{rate} per USD; not the GST rate)" / "Stripe fee {fee} incl. GST {tax} (absorbed)"
S15. "Proof awaited" / "Attach Stripe's payment advice or the bank's e-FIRA for this payment."
S16. blocker `fx_rate_needed`: "enter the exchange rate of the day the money arrived"
S17. bells: "{client} paid {amount} by card for {number}." / "Stripe webhook signatures failed 5 times in an hour. Check the webhook secret."
S18. "Smallest part-payment by card (USD)" / "Largest card payment (USD)"; hint: "RBI limits a payment aggregator's export payment to ₹25 lakh per transaction. We keep card payments under it too: keep this below ₹25 lakh at today's rate." (early check 2, finding 3: the ₹25 lakh cap binds a payment aggregator; Stripe is not one, so for card payments it is our safest setting, 08-C RB-07)

### S19. API messages and review lines (builder's draft B2; approved by the lead after early check 2, 2026-11-02)
- `payment_processing` (409): "A payment on this document is still being confirmed. Wait for it before taking another."
- `amount_above_maximum` (400): "Online payments are limited to {maximum} at a time."
- `not_payable_online` with reason `use_portal` (409): "Card payments are made by the client from the portal. Copy the portal link and send it to them instead."
- `gateway_error` (502, Stripe): "Stripe couldn't be reached. Try again."
- `gateway_refund_needed` (409, Stripe): "A Stripe payment can't be rejected here. It needs a refund through Stripe."
- `gateway_payment` (409, Stripe): "A Stripe payment can't be withdrawn here. It needs a refund through Stripe."
- review reason `not_export_receipt`: "The card was issued in India, or Stripe didn't say where, so this payment doesn't count as money received from abroad and can't be treated as an export receipt under the LUT. Check with the client before confirming it or issuing a tax invoice for it." (early check 2, finding 2: the line names the tax consequence, 08-C RA-38)
- review reason `refetch_failed` with `stripe_permission`: "Stripe refused to show this payment to our key. Check the restricted key's permissions, then try again."
- review reason `not_captured` (Stripe): "Stripe reports this payment as not completed, refunded or disputed. Nothing was recorded."
- `document_not_payable` reasons in words: `client_domestic` "the client is in India"; `not_usd` "it isn't in US dollars"; `above_gateway_maximum` "even the smallest payment allowed is above the card payment limit"; `payment_pending` "a payment on it is still waiting to be confirmed"; `use_portal` "card payments are made by the client from the portal"
- The M6.2 review lines that named Razorpay name the item's gateway (Stripe or Razorpay) with the same words: `refetch_failed`, `dead_letter`, `partial_payment`, `payment_not_on_link`, `unreadable_event`; amounts in the item's currency.
- `document_not_payable` reason `below_gateway_minimum` (changes the M6.2 words of [07-ZI](ZI-m6.2-razorpay.md) S20's `{reason}`, "less than ₹1 was due on it", which named the rupee while Stripe's minimum is USD 0.50; staff-only, early check 2, open question 4): "less than the smallest amount the gateway takes was due on it"
