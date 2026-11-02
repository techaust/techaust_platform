# 07-ZO: M6.5 receipts, refunds and reconciliation

Status: **DRAFT, waiting for the owner** (one page at build time, owner 2026-11-01). Client lines are approved by the owner word for word; until then the code shows `[Placeholder]`. Staff lines are approved by the lead under the owner's delegation once placed (listed in [runs/m6.5-receipts-refunds](../runs/m6.5-receipts-refunds.md)). Lines in `{braces}` are filled in by the screen. All lines pass 07 §1.3.

## Client lines (for the owner's approval; recommendation: approve as drafted)

### The receipt PDF
1. Title: "Payment receipt"
2. "Receipt number" / "Receipt date"
3. "Received from"
4. "Amount received" / "Amount in words"
5. "Received on" / "Paid by" / "Reference"
6. "Applied to", with the columns "Invoice" and "Amount"
7. "Held as credit on your account"
8. "This is a receipt for a payment we received. It is not a tax invoice." (rests on 08-C n1, being settled)
9. "Computer-generated receipt." (makes no claim about a signature or stamp; rests on 08-C n2, being settled)
10. "Paid by" words, one per way of paying: "Bank transfer", "UPI", "Card", "Netbanking", "PayPal", "International bank transfer (SWIFT)", "Cheque", "Cash" (only the ways the business takes are ever shown)

### The receipt email
11. Subject: "Receipt {number} for your payment of {amount}"
12. Body: "Thank you. We received {amount} on {date}. Your receipt {number} is attached." / without an attachment: "Thank you. We received {amount} on {date}. You can download receipt {number} from your client portal."

### The client portal
13. Link on a payment: "Receipt"
14. A refund on an invoice: "Refunded {amount} on {date}"
15. The receipts list heading: "Receipts"
16. A row of the list: "Receipt {number}: {amount} received on {date}"

**Recommended, no line needed:** clients see a refund only once it has gone through (line 14), so there is no "refund in progress" line.

## Staff lines (lead under delegation)
Drafted by the builder and designer (the refund dialog, the errors, the export warning, the TDS panel, the credit line, "This refund needs a credit note first", the reconciliation labels, the ₹25 lakh line reusing 07-ZM S18, the audit labels); listed here when approved.
