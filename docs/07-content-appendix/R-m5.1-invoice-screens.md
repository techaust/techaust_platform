# 07-R: Invoice copy for M5.1 (issue, numbering, void)

_Drafted by the lead on 2026-10-27 from approved facts:
- 04: ADM-INV-01…04, -07, -14, ADM-APR-01/02, ADM-PRJ-02, §9;
- 07: §1 (voice and honesty), §5.3 (how payment works: "Invoices are due within 7 days"), §8 (emails);
- 08-A §3–§4 (Rule 46 fields; VERIFY WITH CA/LEGAL);
- docs/13 and the M5 batch decisions (LD1–LD21; owner questions built with their recommended defaults).

**PENDING the owner's word-for-word approval** (batch rule: built as drafts, approved at the batch review). Sections 1–5 are staff-facing admin copy. Section 6 is client-facing (it is printed on the tax invoice PDF). `{…}` is filled by the screen. Tax and legal wording is VERIFY WITH CA/LEGAL. Anything still missing is shown as `[Placeholder]`, never invented._

## 1. Navigation, list and client tab
- Nav item: "Invoices"
- Page title: "Invoices"
- Intro line: "Tax invoices you've drafted or issued. A number is given only when an invoice is issued, and an issued invoice can't be changed."
- Filters: "Type" · "Status" · "Client" · "All"
- Columns: "Number" · "Client" · "Issued" · "Due" · "Total" · "Balance" · "Status"
- Status badges: "Draft" · "Issued" · "Overdue" · "Void"
- A draft's number cell: "Not issued yet"
- Empty state: "No invoices yet. Create one from a client, or from a milestone that's ready to bill."
- Button: "New invoice"
- Client tab: "Invoices" · empty: "No invoices for this client yet."
- Search hint for roles without invoices: unchanged (07-Q).

## 2. Draft editor
- Title of a draft: "Draft invoice for {client name}"
- Under the title: "Drafts can be edited. Issuing gives the next number and locks the invoice."
- Fields: "Contact" · "Lines" · "Document discount" · "Due date"
- Due date note: "Due {date}: {days} days after the issue date (the client's terms, or Net 7)."
- Lines use the proposal line editor labels (07-O §3).
- From a milestone: "Created from the milestone "{milestone name}" of {project name}. The total matches the milestone amount, GST included."
- Buttons: "Save draft" · "Issue invoice" (Owner) · "Request issue" (Staff) · "Delete draft"
- Delete confirmation: "Delete this draft? It has no number yet, so nothing is lost from the series." · "Delete draft" · "Keep it"
- Saved toast: "Draft saved."

### Blockers (shown in the editor and the issue dialog; one line each, with a link to the place to fix it)
| Code | Line |
|---|---|
| supplier_legal_name | "Add the company's legal name in Settings › Company." |
| supplier_trade_name | "Add the trade name in Settings › Company." |
| supplier_address | "Add the company's registered address in Settings › Company." |
| supplier_gstin | "Add the company's GSTIN in Settings › Company." |
| supplier_state | "Add the company's state in Settings › Company." |
| recipient_legal_name | "Add the client's legal name." |
| recipient_address | "Add the client's billing address." |
| recipient_gstin | "This client is GST-registered: add their GSTIN." |
| recipient_state | "Add the client's state." |
| no_lines | "Add at least one line." |
| line_sac_missing | "Line {n} needs a 6-digit SAC code." |
| line_description_missing | "Line {n} needs a description." |
| computed_errors | "The totals couldn't be worked out. Check the lines and the discount." |
| zero_total | "An invoice can't be issued for ₹0 or $0." (VERIFY WITH CA/LEGAL) |
| reverse_charge_text | "Set the reverse-charge line in Settings › Tax." |
| currency_mismatch | "The invoice currency must be the client's currency ({currency})." |
| type_not_allowed | "This client is outside India, so this needs an export invoice. Export invoices arrive in the next update." |

## 3. Issue, request and approval
### Issue dialog (Owner)
- Title: "Issue invoice"
- Body: "This invoice will get the next number in the series ({series preview}, for example {next number}) and the date {issue date}. Once issued it can't be edited or deleted. Corrections are made with a credit note or a debit note."
- With blockers: "Fix these before issuing:" (the blocker list)
- Step-up: the standard code prompt (07-H): "Enter the 6-digit code from your authenticator app to continue."
- Buttons: "Issue invoice" · "Cancel"
- Done toast: "Invoice {number} issued."

### Request issue (Staff)
- Dialog title: "Ask the owner to issue this invoice"
- Body: "The owner gets a request to issue this invoice. If you change the draft afterwards, the request is cancelled and you'll need to send a new one."
- Buttons: "Send request" · "Cancel"
- After sending: "Issue requested. You'll get a bell when the owner decides."
- State line on the draft: "Waiting for the owner to issue it (requested {date})."

### Approvals queue (Owner)
- Kind label: "Issue invoice"
- Row: "{requester} asked to issue a draft invoice for {client name}: {total}."
- Buttons: "Issue invoice" · "Reject"
- Approve note: "Approving issues the invoice now, with the next number. You'll be asked for your code."
- Reject reason label: "Reason (optional, shown to {requester})"

### Bells
- To the owner: "{requester} asked you to issue an invoice for {client name}."
- To the requester, approved: "Your invoice for {client name} was issued as {number}."
- To the requester, rejected: "Your request to issue the invoice for {client name} was rejected."
- Draft invoices have no number, so bells never use a title (docs/13 2026-10-26).
- To every owner, a refused invoice PDF (`pdf.refused`): "The PDF of {number} didn't match its saved copy, so it wasn't made. A developer needs to look at it."

### Approval emails (staff, from no-reply@; same layout as the 07-O discount emails)
- Request, subject: "Invoice issue requested for {client name}"
- Request, body: "{requester} asked you to issue a draft invoice for {client name}, total {total}. Open the approvals queue to issue or reject it."
- Decided, subject: "Your invoice for {client name}: {Issued as {number} | Rejected}"
- Decided, body: "The owner {issued it as {number} | rejected the request}." (+ reason when given)

## 4. Issued invoice and void
- Frozen view banner: "Issued {date} by {name}. This invoice is locked: corrections are made with a credit note or a debit note."
- PDF states: "PDF being prepared…" · "Download PDF" · "The PDF couldn't be made. Try again." (button "Try again")
- Void button (Owner): "Void invoice"
- Void dialog title: "Void invoice {number}"
- Void body: "Voiding cancels this invoice. It keeps its number, which is reported as cancelled in your GST return. You can only void an invoice in the month it was issued, before it has been emailed, paid or corrected by a credit or debit note; after that, use a credit note." (VERIFY WITH CA/LEGAL)
- Reason label: "Reason (required, kept with the invoice)"
- Empty reason error: "Enter a reason for voiding."
- Buttons: "Void invoice" · "Cancel"
- Void badge line: "Voided {date} by {name}: {reason}"
- Milestone after void: "The milestone is back to Ready to bill."
- Milestone action: "Create invoice" · disabled hint when one exists: "This milestone already has invoice {number}." or, for a draft, "This milestone already has a draft invoice."
- Estimate link (docs/13 2026-10-26): "Converted to invoice {number}." or, for a draft, "Converted to a draft invoice."

## 5. Error messages (API codes)
| Code | Message |
|---|---|
| approval_required | "Only the owner can issue invoices. Send a request instead." |
| issue_directly | "You can issue this invoice yourself." |
| approval_expired | "The draft changed after the request, so this request no longer applies. Ask for a new one." |
| type_not_issuable | "This type of invoice can't be issued yet." |
| already_issued | "This invoice was already issued as {number}." |
| stale_version | (existing 07-J line) "Someone else changed this since you opened it. Reload to see the latest version." |
| content_changed | "The client or settings changed since this draft was saved, so the totals would differ. Open the draft and save it again." |
| issue_blocked | "Fix the items listed before issuing." |
| numbering_changed / settings_changed | "Company, tax, numbering or payment settings changed a moment ago. Try again." |
| client_changed | "The client's details changed a moment ago. Try again." |
| client_anonymised | (existing 07-Q line) |
| series_full | "This invoice series has run out of numbers for the year. Change the numbering format in Settings › Numbering." |
| step_up_required | (existing 07-H line) |
| void_not_allowed | "This invoice can't be voided: it has been emailed, paid or corrected. Use a credit note instead." |
| already_void | "This invoice is already void." |
| return_period_closed | "This invoice's GST return period has ended, so it can't be voided. Use a credit note instead." (VERIFY WITH CA/LEGAL) |
| contact_changed | "The contact's details changed a moment ago. Try again." |
| contact_anonymised | "This draft's contact has been anonymised. Choose another contact, then save the draft." |
| on_issued_document | (existing 07-J line) |
| milestone_has_invoice | "This milestone already has an invoice." |
| milestone_not_ready | "Only a milestone that's Ready to bill can be invoiced." |

## 6. Tax invoice PDF: fixed words (client-facing; `packages/pdf` `layout/copy.ts`; VERIFY WITH CA/LEGAL)
- Title: "Tax Invoice"
- Copy mark: "ORIGINAL FOR RECIPIENT"
- Header labels: "Invoice number" · "Invoice date" · "Due date" · "Place of supply" · "State code"
- Parties: "From" · "Billed to" · "GSTIN" · "PAN" · "Address" · "State"
- Lines: "#" · "Description" · "SAC" · "Qty" · "Rate" · "Discount" · "Taxable value"
- Tax summary: "Tax summary" · "SAC" · "Taxable value" · "CGST" · "SGST" · "IGST" · "Rate" · "Amount" (per-head rates printed, e.g. "CGST 9 %")
- Totals: "Taxable value" · "CGST" · "SGST" · "IGST" · "Round-off" · "Total" · "Balance due"
- Words: "Amount in words: {words}"
- Reverse charge: "Tax payable on reverse charge: No"
- Payment block heading: "How to pay"
- Payment lines: "Bank transfer (NEFT, RTGS or IMPS) to:" · "Account name" · "Account number" · "IFSC" · "Bank and branch" · "Please quote {number} as the payment reference." · "Or pay in the client portal: {portal address}"
- Signature: "For {company legal name}" · "Authorised signatory"
- Footer default notes: [Placeholder] (the owner may set footer notes in Settings; none is invented)
- IRN block (only when an IRN exists, from Phase 7): "IRN" · "Ack no." · "Ack date"
