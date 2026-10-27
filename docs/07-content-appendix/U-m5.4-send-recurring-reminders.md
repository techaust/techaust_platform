# 07-U: Sending invoices, recurring care invoices and reminders (M5.4)

_Drafted by the lead on 2026-10-27 from approved facts:
- 04: ADM-INV-15 (send), ADM-INV-13 (reminders), ADM-INV-12 and ADM-CARE-02 (recurring care invoices), ADM-INV-19 (unbilled work), ADM-INV-10 (25-day proforma warning), POR-06;
- 07: §1 (voice, the banned-phrase list), §8 (the invoice and reminder email cores, "View & pay" replaced per Q13);
- 07-M (care plans), 07-R, 07-S, 07-T (invoice, proforma and note words);
- the M5 batch questions Q12, Q13, Q20, Q42–Q51 and Q63, each built with its recommended default.

**PENDING the owner's word-for-word approval** (batch rule). Sections 1–3 are client-facing. The rest is staff-facing. `{…}` is filled by the system. **Every tax and legal line is VERIFY WITH CA/LEGAL.** Anything still missing is `[Placeholder]`.

**Rules used:** client emails come from billing@ with Reply-To billing@ (LD65); the button is "View invoice" (Q13; "View and pay" from M6/M7.1); until M6 the only payment method is bank transfer; "and", never "&"; no threats, no urgency words._

## 1. Document emails (client-facing, from billing@)
Each body has two forms: **attached** (the PDF is attached) and **link only** (no attachment: the client's setting, or the PDF is too large). Only the last sentence changes.

**Closing sentence, attached:** "The {document} is attached as a PDF, and it's also in your client portal."
**Closing sentence, link only:** "You can view and download it with the button below or in your client portal."
`{document}` is "invoice", "payment request", "credit note" or "debit note".

- **Invoice**, subject: "Invoice {number} from TecHaust Technologies: {total} due {due date}"
  - body: "Hi {first name}, please find invoice {number} for {total}, issued on {issue date} and due on {due date}. You can pay by bank transfer; the bank details are on the invoice. {closing sentence}"
  - button: "View invoice"
- **Proforma** (replaces 07-S §2's body, which assumed an attachment), subject: "Payment request {number}: {total}"
  - body: "Hi {first name}, please find payment request {number} for {total}, valid until {due date}. You can pay by bank transfer; the bank details are on the payment request. A tax invoice will be issued when payment is received. {closing sentence}" (VERIFY WITH CA/LEGAL)
  - button: "View payment request"
- **Credit note** (07-T §2 subject unchanged), body: "Hi {first name}, we've issued credit note {number} for {total} against invoice {parent number}. Reason: {reason}. The amount due on the invoice is now {balance}. {closing sentence}"
  - button: "View credit note"
- **Debit note** (replaces 07-T §2's body, per Q63: a debit note is its own amount with its own due date; the invoice's balance does not change), subject unchanged.
  - body: "Hi {first name}, we've issued debit note {number} for {total} against invoice {parent number}, because the invoice amount needed correcting upwards. Reason: {reason}. Please pay {total} by {due date}. {closing sentence}" (VERIFY WITH CA/LEGAL)
  - button: "View debit note"
- **Footer** (all): 07 §8's footer.

## 2. Payment reminders (client-facing, from billing@; 07 §8 cores; Q47, Q48, Q50)
Sent only for a document that was emailed (Q50), only 09:00–19:00 IST (Q48), and never once it is paid, credited in full or void. Each body ends: "If you've already paid, thank you, and please ignore this." The button is the document's own ("View invoice", "View payment request", "View debit note"). Reminders never attach the PDF; the body ends with §1's link-only closing sentence before the "already paid" line.

| Day | Subject (invoice) | Body (invoice) |
|---|---|---|
| 3 days before | "Invoice {number} is due on {due date}" | "Hi {first name}, a friendly reminder that invoice {number} ({balance}) is due in 3 days, on {due date}." |
| Due date | "Invoice {number} is due today" | "Hi {first name}, a friendly reminder that invoice {number} ({balance}) is due today." |
| 3 days after | "Invoice {number} is now overdue" | "Hi {first name}, invoice {number} was due on {due date} and shows {balance} outstanding. If there's a problem with the invoice, reply to this email and we'll sort it out." |
| 7 days after | "Second reminder: invoice {number}" | "Hi {first name}, invoice {number} was due on {due date} and {balance} is still outstanding. Could you let us know when we can expect payment? If it would help to talk it through, reply and we'll arrange a call." |
| 14 days after | "Action needed: invoice {number} is 14 days overdue" | "Hi {first name}, invoice {number} was due on {due date} and {balance} is still outstanding. Please arrange payment, or reply to this email so we can agree a date. You can also contact Rupak Sarkar, the owner, directly at contact@techaust.com." |

- **Payment request variant** (proforma): "invoice" becomes "payment request" in subject and body, and the 3 days after, 7 days after and 14 days after bodies say "was requested by {due date}" in place of "was due on {due date}".
- **Debit note variant:** "invoice" becomes "debit note"; the bodies are otherwise the same.

## 3. Client portal (POR-06; Q49)
- Navigation: "Invoices"
- List heading: "Invoices" · columns: "Number" · "Type" · "Issued" · "Due" · "Total" · "Balance" · "Status"
- Types: "Invoice" · "Export invoice" · "Payment request" · "Credit note" · "Debit note"
- Statuses: "Due" · "Overdue" · "Paid" · "Credited" · "Void"
- Empty list: "No invoices yet. When we send you one, it appears here."
- Document page: the document's number as the heading, then "Issued {issue date}" · "Due {due date}" · "Total" · "Balance due" · the lines and tax summary as on the PDF · the button "Download PDF"
- How to pay (until M6): "Pay by bank transfer to the account shown on the {document}. Please quote {number} as the payment reference."
- Against an invoice (notes): "Against invoice {parent number}"
- Link expired or revoked: "This link no longer works. Sign in to your client portal to see your invoices, or ask us for a new link at contact@techaust.com."
- PDF not ready: "The PDF is still being prepared. Try again in a minute."

## 4. Sending (admin)
- Action on an issued document: "Email to client" · after a first send: "Email again"
- Dialog title: "Email {document} {number}"
- Recipients label: "Send to (up to 5)" · hint: "Only contacts with portal access can receive documents."
- No eligible contact: "No contact of this client has portal access. Turn it on for a contact on the client's page, then send."
- Attach option: "Attach the PDF" · hint: "Without it, the email has a link to the document only."
- Button: "Send" · toast: "Sent to {n} contact." / "Sent to {n} contacts." · queued toast: "Queued. It will be emailed in a moment."
- After sending, the lock line: "Emailed, so this {document} can no longer be voided. Corrections are made with a credit note or a debit note." (VERIFY WITH CA/LEGAL; Q1)
- Sends list heading: "Emails" · columns: "To" · "Sent by" · "When" · "Status" · statuses: "Queued" · "Sent" · "Delivered" · "Failed" · "Cancelled"
- Sent by an automatic send: "Sent automatically"
- Revoke: "Revoke links" · confirm title: "Revoke every link to {number}?" · body: "The links in the emails sent so far stop working. Contacts can still see the {document} in the client portal." · button: "Revoke links" · toast: "Links revoked."

## 5. Reminders panel (admin)
- Heading: "Reminders"
- Not started: "Reminders start when the {document} is first emailed."
- Schedule rows: "{n} days before the due date" · "On the due date" · "{n} days after the due date" · states: "Sent {date}" · "Due {date}" · "Skipped: {reason}"
- Skip reasons: "paid" · "credited in full" · "void" · "paused" · "no contact with portal access"
- Pause: "Pause reminders" · resume: "Resume reminders" · paused line: "Reminders are paused. Nothing is sent until you resume them."
- Window note: "Reminders go out between 09:00 and 19:00 IST."
- Errors: `reminders_not_started` "Reminders haven't started: email the {document} first." · `not_issued` "Only an issued document can be emailed." · `invoice_void` "This {document} is void, so it can't be emailed." · `owner_only` "Only an owner can do this." · `recipient_invalid` "One of the contacts can't receive documents. Check that they still have portal access." · `send_refused` "This can't be sent right now. Reload the page and try again."

## 6. Recurring care invoices (admin; ADM-CARE-02, ADM-INV-12; Q43–Q46, Q51)
- **Care line descriptions** (on the invoice and the PDF; VERIFY WITH CA/LEGAL):
  - plan fee: "{plan name} care plan, {period start} to {period end}"
  - AI Ops: "AI Ops, {period start} to {period end}"
  - extra hours: "Extra hours above the plan, {period start} to {period end} ({hours} h at {rate} per hour)"
- **Client page, billing card:** toggle "Issue care invoices automatically" · hint: "On the billing day, the invoice is issued and emailed to the client's billing contacts with portal access. Only an owner can turn this on; anyone can turn it off." · on, by: "On, turned on by {name} on {date}"
- **Owner-only refusal:** "Only an owner can turn on automatic issuing."
- **Why it was drafted, not issued** (a line on the draft): "Drafted, not issued automatically, because {reasons}."
  - `toggle_off`: "automatic issuing is off for this client"
  - `toggle_not_owner`: "automatic issuing wasn't turned on by an owner"
  - `terms_not_owner`: "the plan's current price wasn't set by an owner"
  - `usd_needs_fx`: "a US dollar invoice needs the exchange rate entered"
  - `overage_present`: "it includes extra hours, which you check first"
  - `blockers`: "the invoice has a missing field (see the checklist)"
  - `copy_placeholder`: "a line's wording isn't approved yet"
  - `export_inr_confirm`: "an export invoice in rupees needs your confirmation"
- **Issued, not emailed** (bell line): "Care invoice {number} for {client} was issued, but no billing contact has portal access, so it wasn't emailed."

## 7. Bells (staff)
- Care draft ready: "Care invoice draft for {client} ({period}) is ready to check."
- Care invoice issued: "Care invoice {number} for {client} was issued and emailed."
- Care invoice failed: "The care invoice for {client} ({period}) couldn't be drafted. Open the care plan to see why."
- Missed period (Q51): "{client}'s care plan has an unbilled period ({period}). Invoice it by hand."
- USD rate needed: "Care invoice draft for {client} needs the exchange rate before it can be issued."
- Unbilled work (Q20): "{milestone} for {client} was delivered {days} days ago and isn't invoiced yet."
- Proforma unpaid after delivery (ADM-INV-10): "Payment request {number} for {client} is still unpaid {days} days after {milestone} was delivered. A tax invoice is due within 30 days of delivery." (VERIFY WITH CA/LEGAL)
- Email failed: "The email of {number} to {contact} failed. Check the address and send again."

## 8. Staff alert emails (to every owner, from no-reply@; Q20)
- Unbilled work, subject: "Not invoiced yet: {milestone} for {client}" · body: "Hi {owner first name}, {milestone} for {client} was delivered on {delivered date}, {days} days ago, and has no invoice yet. [Open in admin]"
- Proforma unpaid, subject: "Payment request {proforma number} still unpaid after delivery" · body: "Hi {owner first name}, {milestone} for {client} was delivered on {delivered date}, {days} days ago, and payment request {proforma number} still shows {balance} unpaid. A tax invoice is due within 30 days of delivery even if payment hasn't arrived. [Open in admin]" (VERIFY WITH CA/LEGAL)
- LUT reminder: 07-S §5 unchanged; the line for "the running FY has no letter" (07-S copy gap): subject "No LUT saved for FY {fy}" · body "Hi {owner first name}, there's no letter of undertaking saved for FY {fy}, so export invoices without IGST are blocked. File it on the GST portal and save the ARN in Settings › Tax. [Open in admin]" (VERIFY WITH CA/LEGAL)
