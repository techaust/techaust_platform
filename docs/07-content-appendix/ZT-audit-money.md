# 07-ZT: M6–M7 audit, the money core and gateways (refund that came back, payments first seen partly refunded, receipts that can't be numbered)

Status: **drafts for approval.** The client lines C1–C3 are the owner's: they show "[Placeholder] " and the jobs Worker sends no `refund.reversed` email outside "local" until the owner approves them word for word (`APPROVED_07ZT` in `packages/core/src/copy-zt.ts`, the `refundCopyGate` pattern). The staff lines 1–8 are the lead's under the owner's delegation (run file [full-audit-m6-m7](../runs/full-audit-m6-m7.md), lead's triage AU1, AU3, AU4, AU6, AU16); they are drafted by the builder (AF1) and are in the code unmarked, so the lead approves or changes them. English (India/UK spelling), "and" never "&", no banned phrases (07 §1.3), sentence case, amounts as the admin and the emails write them.

Where they live: C1–C3 in `packages/core/src/copy-zt.ts` (`REFUND_REVERSED_COPY`) and the template `refund.reversed` in `packages/email/src/notifications.ts`; staff lines 1–3 in `apps/admin/worker/gateway/reasons.ts`; 4–5 in `apps/admin/worker/receipt-issue.ts`; 6 in `apps/admin/worker/reductions.ts`; 7–8 in `apps/admin/worker/payment-messages.ts` and `apps/admin/src/lib/payments.ts`.

## The client's email about a refund that came back (AU1; the owner's)
When: a gateway refund we had marked as made comes back failed (Stripe: the client's bank returned it, up to 30 days later; Stripe's `requires_action` after success; Razorpay or PayPal if they ever report a made refund as failed). The money is the client's credit again. To the client's contacts with portal access and "can see finance", from billing@, inside the reminder window (09:00 to 19:00 IST), once per refund. Not sent for a lost dispute or an anonymised client.

- **C1** subject: "Your refund of {amount} for {document number} came back to us"
  - Recommendation: approve as written. Alternative: "We couldn't complete your refund of {amount} for {document number}".
- **C2** body: "Hi {first name}, the refund of {amount} for {document number} was returned to us by the bank or card network, so it didn't reach you. The amount is held as credit on your account."
  - Recommendation: approve as written (it states the fact and where the money is, and makes no promise of timing).
- **C3** next step: "We'll contact you to agree how to send it again. Reply to this email if your bank details have changed."
  - Recommendation: approve as written. It commits you to contacting the client; if you'd rather not, use "Reply to this email to tell us how you'd like it sent again."
- Button: "View invoice" (07-ZQ C4, already approved).
- Template name in Settings › Email (staff): "Refund came back (client)".

## Staff lines (the lead's; drafted by the builder)
1. **Needs review, `refund_reversed`** (AU1): "{Gateway}'s refund of {amount} came back after it was made, so it is marked failed and the money is the client's credit again. Check it in {Gateway}'s dashboard, then refund it again or keep it as credit."
2. **Needs review, `refunded_outside`, a payment first seen partly refunded** (AU6): with the amount (Razorpay, Stripe): "{Gateway} had already refunded {refunded} of this payment of {amount} when it reached us, so it waits here instead of being counted. Record the refund, then confirm what was kept." · without it (PayPal names no refunded total): "{Gateway} had already refunded part of this payment of {amount} when it reached us, so it waits here instead of being counted. Check the amount in {Gateway}, record the refund, then confirm what was kept."
3. (unchanged M6.5 line kept for a refund made outside with no partial refund: "This payment was refunded in {Gateway}, outside the admin. The invoice's balance hasn't changed until you record the refund.")
4. **Bell `receipt.blocked`, a full receipt series** (AU3; Owners, once, after the third refused try): "Receipts can't be numbered: the receipt series is full for this year. Widen its format in Settings › Numbering."
5. **Bell `receipt.blocked`, any other refusal** (AU3): "A payment's receipt couldn't be issued after 3 tries. Open the payment to check it."
6. **409 `reduction_exists`** (AU3; a reduction's id sent again with other details): "This reduction was already recorded with other details"
7. **409 `payment_linked`, and the line beside a hidden Withdraw** (AU4, AU16): "This payment is ticked as seen in the bank statement or linked to a remittance advice. Remove that first, then withdraw it."
8. **The line beside a hidden Withdraw when a refund stands** (AU16; the M6.5 server line reused): "This payment has a refund, so it can't be withdrawn."

Note for the lead: the refused-recipient line of "Send receipt again" ("Some recipients can't get this receipt: they need portal access and finance access") now also covers a contact whose address is stopped (a hard bounce or a complaint, AU21). If you want the reason named, a draft: "Some recipients can't get this receipt: they need portal access and finance access, and an address that isn't stopped."
