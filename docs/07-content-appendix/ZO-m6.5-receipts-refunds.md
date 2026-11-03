# 07-ZO: M6.5 receipts, refunds and reconciliation

Status: **Client lines 1–18, 12b included, APPROVED by the owner as drafted (2026-11-03)**; the code switch `APPROVED_07ZO` turns on in M6.5 after builder B6. Staff lines are approved by the lead under the owner's delegation once placed (listed in [runs/m6.5-receipts-refunds](../runs/m6.5-receipts-refunds.md)). Lines in `{braces}` are filled in by the screen. All lines pass 07 §1.3.

## Client lines (approved by the owner as drafted, 2026-11-03)

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

### The statement of account
17. A refund line: "Refund" (the refund's reference beside it, as for payments)

### Added after the designer (2026-11-03)
12b. The receipt email's closing line: "Questions? Just reply to this email." (as the other house emails)
18. Under a long "Applied to" list on the receipt PDF: "and {n} more"

(Both placed by builder B4, 2026-11-03, through `@techaust/core/copy-zo` behind `APPROVED_07ZO`: 12b closes the `receipt.sent` email in the HTML and the text, after the portal button when there is one; both show `[Placeholder]` until the owner approves this page.)

**Recommended, no line needed:** clients see a refund only once it has gone through (line 14), so there is no "refund in progress" line.

### Client-line gaps found by the designer (for the owner's page; not placed)
- The receipt email has no closing line: the house emails end "Questions? Just reply to this email." (07-ZE line 4's first sentence). Recommended: add it as line 12b. Until then the email ends after its facts (and, without the PDF, 07 §8's "Open in the portal" button).
- The receipt PDF writes the client's GSTIN as "GSTIN {number}", as every invoice PDF does (no new words); "and {n} more" under a long "Applied to" list is drafted in `copy-zo.ts` and marked like the rest.
- The refund dialog's "Draft the credit note" opens the invoice's existing credit-note dialog (M5.3 words); its reason is not prefilled with "Service not delivered" (the dialog says which reason to pick, RA-40).

## Staff lines (lead under delegation)
Drafted by the builder (the API's refusals in `apps/admin/worker/refunds.ts`, `recon.ts`, `reductions.ts`, `receipt-issue.ts`; the review reasons in `worker/gateway/reasons.ts`; the audit labels) and by the designer (2026-11-03, `apps/admin/src/lib/copy-zo.ts`, unmarked as the M6.4 `ZN_UI` lines were). The designer's, for the lead's approval:

**Receipts (S1–S4):** "Receipt" · "Receipt being prepared" · "PDF being made" · "Make the PDF again" · "A new PDF was asked for. It is on its way." · "Void (payment withdrawn)".

**Refund rows (S5–S9):** "Refund" · "Refund credit" · "This client has no credit left to refund." · "Refunds" · "Try again" · "Cancel refund" · "Keep it" · "Try again or cancel after {time} IST." · "Refund in progress" (with its amount; the hint "Not in the credit any more. It leaves the client's account when the gateway pays it.") · "Asked the gateway again." · "Refund cancelled. The money stays as the client's credit." · "It is cancelled only if the gateway shows it never received this refund. The money then stays as the client's credit." · "Gateway code: {code}" · states "Requested", "With the gateway", "Refunded", "Failed" · reasons "After a credit note", "Paid too much", "Paid twice", "TDS paid back", "Lost dispute", "Other" · ways "Through {gateway}", "By bank transfer", "Made in {gateway}", "Lost dispute" · columns "Asked on", "How", "Reason", "Amount", "Status", "Client", "Refunded on {day}".

**The refund dialog (S10–S22):** titles "Refund money to the client", "Record a refund made outside the admin", "Record a lost dispute" · "Payment", "Payment received", "{amount} on {day}", "Invoice", "Received {day}: {amount} available" · "Refund from": "The client's credit" ("This payment can give back up to {amount}."), "This invoice's excess" ("Paid above what the invoice owes: {amount}."), "The whole payment (not confirmed yet)" ("A payment waiting for its check goes back in full through its own gateway.") · "Amount to refund", "At most {amount}." · "How the money goes back": "Through {gateway} (to the card or account it came from)", "By our bank transfer" ("A card or wallet payment refunded by bank transfer goes to another account in the payer's own name.") · "Paid by", "Bank reference (UTR)", "Paid on", "Paid to": "The account the money came from", "Another account in the payer's own name" ("Only when the client asks for it in writing (RBI: a refund goes to the original method or the payer's own account)." RB-24) · "The client asked for this in writing" / "Tick this once you have the client's written request." · "{gateway} refund ID", "{gateway} dispute ID", "Refunded on", "Dispute closed on" · "Reason", "Note" · buttons "Refund", "Record refund", "Record lost dispute" · "Fill this in." · results "Refund requested. The gateway hasn't answered yet; it is checked again every hour.", "Refund sent. The gateway is paying it.", "Refund made.", "Refund recorded.", "Lost dispute recorded. The invoice shows what is owed again." · chargeback hint "Use this only when the dispute is lost and the gateway took the money back. The invoice reopens with what is owed." (L40).

**Credit note first (Q1 A, RA-40):** "This refund needs a credit note first" (the brief's) · "Money paid on an invoice goes back only after a credit note lowers what the invoice owes. Issue the credit note for the amount you want to refund, then refund it here." · "Paid above what it owes now: {amount}." · "This invoice was issued for a payment received, so the credit note's reason is “Service not delivered”." · "Last day for a credit note on this invoice: {day}." · "The last day for a credit note is close: {day}." · "The last day for a credit note on this invoice was {day}, so its money can't be refunded from here." (RA-40's OPEN s.54 edge: nothing guessed) · "Draft the credit note".

**RA-41:** "This credit arrived in {period} and is refunded in {period}. If it was more than ₹1,000 over an invoice, or never on one, GST on it was due when it arrived: record the advance in GSTR-1 Table 11 by hand." (periods as "November 2026" or "October to December 2026").

**RB-43:** the lead's export line (run file) · "The bank approved the lower amount" / "Tick this once the bank has approved the lower amount." · reductions: "Bank-approved reductions", "Record bank's reduction", "{amount} approved {day}, reference {ref}", "On our own declaration (up to ₹10 lakh an invoice)" ("Tick only when the bank allowed it on our declaration rather than its own approval letter."), "Approved on", "Bank's reference", "Amount reduced", "Reduction recorded.", "FEMA treats this invoice as not fully realised until the bank's reduction is recorded here."

**₹25 lakh (ADM-PAY-13, RB-07; 07-ZM S18's wording reused):** "At the invoice's rate this is about {INR}. RBI limits a payment aggregator's export payment to ₹25 lakh per transaction, so PayPal can't take it in one payment; card payments are kept under it too. Ask the client to pay by bank transfer or in parts." · "No recent exchange rate on this invoice, so the ₹25 lakh check can't be made."

**Refunds tab and Needs review (S23–S26):** "Refunds" · "No refunds yet." · "No refunds in this state." · "Show more" · "Record this refund" (the brief's) · "Record lost dispute".

**Reports, builder B4 (S31–S33; 2026-11-03, for the lead under the delegation):**
- S31, Reports › "Refunds register" (the index entry and the title) · lede "Every refund that went out in the financial year, by the day it went out, for your books." · "1 refund read." / "{n} refunds read." · "No refunds went out in this financial year." · "Download the register (CSV)" (the payments register's words; its "Financial year" and "Show" are reused as they are).
- S32, the `refunds-v1` CSV headings: "Refund date", "Client code", "Client", "Refunded from", "Credit note", "Payment reference", "How", "Gateway refund ID", "Bank reference (UTR)", "Currency", "Amount", "INR value", "Reason", "Status". Cell words come from the lines above: the ways ("Through {gateway}", "By bank transfer", "Made in {gateway}", "Lost dispute"), the reasons, "The client's credit" (no invoice) and "Refunded" (the register lists only refunds that went out).
- S33, the `edf-v2` CSV headings after "Purpose code": "Amount realised" (07-V's), "Credit notes", "Amount reduced (FEMA Reg. 6)", "Reduction approved on", "Bank's reference", "Proof awaited" (07-ZM S15's words; the cell reads "Yes" or is blank). 07-V §4's note "Amount realised is left blank: payments are recorded from the payments update." is removed from the EDF screen, which now shows the amount.

**Review part 1 fixes, builder B5 (S34–S38; 2026-11-03, for the lead under the delegation; no client line):**
- S34, RA-41 on the Payments panel (one line per GST period in which a payment holding money on the invoice arrived, when its credit may be an advance): "This credit arrived in {period}. If it was more than ₹1,000 over an invoice, or never on one, GST on it was due when it arrived: record the advance in GSTR-1 Table 11 by hand." The approved RA-41 line above without its "and is refunded in {period}" clause: on the panel nothing is being refunded, so the approved line as written would say something untrue there.
- S35, Payments › "Credit at period end" (tab, Owner and Accountant) · lede "Credit a client held when a GST period ended that may be an advance: money on no invoice, or more than ₹1,000 over its invoices. Refund it, use it, or record it in GSTR-1 Table 11 for that period." · "Period" · columns "Client", "Received on", "Held since", "Part on an invoice" ("Yes"/"No"), "Credit at period end" · empty "No client held such credit when this period ended." · "Show more" (S23's).
- S36, the bank's INR figure of a USD refund (L9): "Record INR amount" (button and dialog title) · "INR the bank debited" · hint "As the bank's advice shows it. It can be recorded once." · "INR debited {amount}" (under the refund's state) · "INR amount recorded." · audit label "recorded the INR amount of a refund".
- S37, API refusals: `credit_note_mismatch` "That credit note isn't an issued credit note of this invoice" · `inr_already_set` "The INR amount of this refund is already recorded" · `inr_not_applicable` "An INR amount is recorded only for a refund in another currency once it has gone out" · the refund body's `written_request_missing` (a code only; the dialog's own S10–S22 line "Tick this once you have the client's written request." is what the Owner sees).
- S38, the owners' bell when a receipt's PDF failed on 3 IST days (jobs): "The PDF of receipt {number} couldn't be made on 3 days, so the hourly retry has stopped. A developer needs to look at it." (M4.4's 07-Y item 26 line says "nightly"; receipts are swept hourly.)
**Review part 2, designer pass 2 (S39–S45; 2026-11-03, for the lead under the delegation; no client line):**
- S39, the "credit note first" step on a debit note (P2-5; M5.3 never issues a credit note on a debit note): "A credit note can't be issued on a debit note, so only what was paid above what this debit note owes can be refunded from here." (no "Draft the credit note" there).
- S40, a refund made in the gateway's dashboard that the invoice's excess can't cover (P2-3; the server's L7 rule): "{gateway} has already sent this money back, but the invoice still counts it as paid. Issue a credit note on this invoice for the part its excess doesn't cover, then record this refund again." · from Needs review, the way there: "Open invoice {number}".
- S41, the amount of a lost dispute: "Amount the gateway took back" (in place of "Amount to refund").
- S42, L47 (RB-43 after the fact; outside and lost-dispute modes show no tick): "This client is outside India and the money has already gone back. Ask your bank to approve the lower amount for this invoice (FEMA Reg. 6), then record it with “Record bank's reduction” on the invoice. Until then FEMA treats the invoice as not fully realised."
- S43, the wait line of a refund with the gateway (no Cancel): "Try again after {time} IST."
- S44, the Refunds tab's count: "1 refund" · "{n} refunds" · "{n}+ refunds" (S31's count words without "read").
- S45, reconciliation: "Razorpay settlement ID" (the settlement dialog; the UTR column shows "–" when Razorpay names no UTR).
- Changed: S27–S30's "Statement reference (optional)" is now "Statement reference" with the form's own "(optional)" marker; "On our own declaration (up to ₹10 lakh an invoice)" placed (approved, lead on B5).
- Not changed (for the lead): "On our own declaration (up to ₹10 lakh an invoice)" now holds per invoice (finding 2); "(up to ₹10 lakh an invoice)" would say so, if the lead wants the words to match.

**Reconciliation (S27–S30):** "Reconciliation" · "Razorpay's settlements to our bank, matched to the payments and refunds they carry." · tabs "Settlements", "Unmatched" · columns "Settled on", "UTR", "Net to bank", "Fees and GST (absorbed)" (with "GST {amount}" under the fee), "Matched" ("{n} of {m}"), "Bank statement", "Line" · "Seen in bank statement", "Tick as seen", "Undo", "Why it is undone", "Statement date", "Statement reference (optional)", "Ticked as seen in the bank statement.", "Tick undone." · "Fetch now", "Day to fetch", results "Settlements fetched.", "Razorpay has no settlements for that day.", "Razorpay isn't set up here.", "Live payments are switched off.", "Razorpay didn't answer. Try again later." · "No settlements yet" / "Razorpay's settlements are fetched every morning at 9:00 for the day before. Fetch a day now to see it here." · lists "Settlement lines without a payment", "Razorpay payments not settled", "Bank payments not ticked", with hints "Lines Razorpay settled that match nothing here: check them in Razorpay's dashboard.", "Confirmed Razorpay payments 5 or more days old that no settlement includes yet.", "Confirmed bank payments not yet ticked as seen in the bank statement after 7 days." and empty lines "Every settlement line matches a payment or refund.", "Every Razorpay payment older than 5 days is in a settlement.", "Every confirmed bank payment older than 7 days is ticked as seen." · line kinds "Payment", "Refund", "Adjustment", "Transfer", "Other", "In", "Out" · "Matched", "Not matched", "Ignored", "Fee differs from the payment's" · "Lines in this settlement", "Close" · "Fees and their GST are shown as absorbed. Whether Razorpay invoices the GST to our GSTIN is still open." (OPEN 08-C RA-29).
