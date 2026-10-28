# 07-S: Export invoice, proforma, checklist, FX and LUT copy for M5.2

_Drafted by the lead on 2026-10-27 from approved facts:
- 04: ADM-INV-06, -08, -10, -18, ADM-SET-03;
- 07: §1, §5.3, §8 (the proforma email core);
- 08-A §8 (the Rule 46 export endorsement, current CBIC text, word for word);
- the M5 batch decisions (owner questions Q7–Q10 and Q22 built with their recommended defaults).

**Approved by the lead on 2026-10-28 under the owner's delegation** ([13-decisions](../13-decisions.md) 2026-10-28), after the research in [08-C](../08-research-appendix/C-research-register.md). Sections 1–2 are client-facing (printed on PDFs). The rest is staff-facing. `{…}` is filled by the screen. Tax and legal lines carry **(Researched, 08-C <ID>)** or **(OPEN, 08-C <ID>)**: an OPEN line is our wording until the CA answers. Section 9 holds the lines added on 2026-10-28._

## 1. Export invoice PDF (client-facing)
- Title: "Export Invoice"
- Copy mark: "ORIGINAL FOR RECIPIENT"; the stored supplier copy: "DUPLICATE FOR SUPPLIER" (07-R §6)
- **Endorsement, LUT route (Rule 46, word for word):** "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX"
- **Endorsement, IGST route (Rule 46, word for word):** "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS ON PAYMENT OF INTEGRATED TAX"
- LUT line (LUT route only): "LUT ARN: {arn} (FY {fy})"
- Labels: "Country of destination" · "Address of delivery" (the client's address, per Rule 46) · "Place of supply: Outside India (96)"
- INR value block: "Value in INR" · "Exchange rate: 1 USD = ₹{rate} ({source}, {date})" · "Taxable value in INR" · "IGST in INR" (IGST route only)
- Totals as 07-R §6, in the invoice currency, then the INR block.
- Payment block heading: "How to pay" · "International wire (SWIFT) to:" · "Beneficiary" · "Account number" · "SWIFT/BIC" · "Bank and branch" · "Bank address" · "Please quote {number} as the payment reference."
- Purpose code (when set): "Purpose code: {code}"

## 2. Proforma invoice PDF (client-facing)
- Title: "Proforma Invoice"
- Under the title (required; Researched, 08-C RA-17, RA-28): "This is not a tax invoice. A tax invoice will be issued when payment is received."
- Number label: "Proforma number" · "Proforma date" · "Valid until"
- Everything else as the tax invoice (07-R §6), without "ORIGINAL FOR RECIPIENT".
- Proforma email (from billing@; 07 §8 core): subject "Payment request {number}: {amount}" · body "Hi {first name}, please find payment request {number} for {amount}, for {description}. You can pay by bank transfer; the details are in the attached PDF and in your client portal. A tax invoice will be issued when payment is received." (The "[Pay online]" button arrives with online payments in M6; until then no button.)

## 3. Mandatory-field checklist (Settings › Tax; ADM-INV-06)
- Section title: "What every invoice must show"
- Intro: "Issuing is blocked while anything ticked here is missing. The defaults follow GST Rule 46. Items marked "House rule" aren't required by GST law; you can turn them off." (Researched, 08-C RA-05)
- Item labels (one per checklist entry): "Company legal name and trade name" · "Company address and GSTIN" · "Invoice number and date" · "Client name and address" · "Client GSTIN (registered clients)" · "Place of supply (state and code)" · "Line description, SAC, quantity, unit and rate" · "Discount and taxable value" · "Tax rate and amount per tax type" · "Totals in figures and words" · "Reverse-charge statement" · "Authorised signatory" · "ORIGINAL FOR RECIPIENT" · "Export declaration (exports)" · "Country of destination (exports)" · "Bank details" · "Payment link or QR (off until online payment exists)" · "Name, address and state for unregistered clients at ₹50,000 or more"
- Locked hint for statutory items: "Required by GST law, so it can't be turned off."
- House rules (switchable; badge "House rule"): "Bank details" · "Payment link or QR" · "Authorised signatory" (an electronically issued invoice needs no signature, 08-C RA-06). Every other item is statutory and locked. (Researched, 08-C RA-05, RA-06)
- New blocker lines (added to 07-R §2):
  - country_missing: "Add the client's country."
  - fx_missing: "Enter the exchange rate for {issue date} before issuing a USD invoice."
  - lut_missing: "Save the LUT ARN for FY {fy} in Settings › Tax before issuing an export invoice under LUT. Or issue it with IGST paid."
  - unregistered_high_value: "For an unregistered client and an invoice of ₹50,000 or more, add the client's name, address and state."
  - bank_missing: "Add an active bank account in Settings › Bank."
  - swift_missing: "Add the SWIFT details of a bank account in Settings › Bank for export invoices."

## 4. FX dialog (USD invoices; ADM-INV-08; Q7)
- Title: "Exchange rate for this invoice"
- Body: "Enter the RBI or FBIL reference rate for {issue date}. If none was published that day, use the last published rate. The rate is stored with the invoice and used for its INR values in your GST return." (Researched, 08-C RA-21; the "last published" case is limited to {days} days, lead 2026-10-28)
- Fields: "1 USD = ₹" · "Rate date" · "Source" (options "FBIL reference rate" · "RBI reference rate" · "Other (describe)")
- Error: "Enter a rate above zero, with up to 4 decimal places."
- INR export confirmation (Q8): "This export invoice is in INR. It counts as an export only if the payment reaches you in a way the RBI allows for exports in rupees: check with your bank. Issue it in INR anyway?" (Researched, 08-C RA-18, RB-32) · "Issue in INR" · "Cancel"

## 5. LUT settings and reminder (ADM-INV-18; Q22)
- Settings › Tax section: "Letters of undertaking (LUT)"
- Intro: "File a new LUT on the GST portal for each financial year (Form GST RFD-11), then save its ARN here. Export invoices without IGST need the LUT for their year."
- Columns: "Financial year" · "ARN" · "Filed on" · Button "Add LUT"
- Fields: "Financial year" · "ARN" · "Filed on"
- Errors: "This year already has an LUT." · "Enter the ARN from the GST portal."
- Banner from 1 March: "File next year's LUT (FY {next fy}) before 1 April, then save its ARN here."
- Reminder email (owners, from no-reply@): subject "File the LUT for FY {next fy}" · body "Export invoices without IGST from 1 April need a letter of undertaking for FY {next fy}. File it on the GST portal (Services, User Services, Furnish Letter of Undertaking) and save the ARN in Settings › Tax. We'll remind you each week until it's saved."

## 6. Advance received (proforma; ADM-INV-10; Q9)
- Action on an issued proforma (Owner): "Issue tax invoice for payment received"
- Dialog body: "Record a payment you've received against this proforma. A tax invoice is issued for the amount received, with the next number, and linked to the proforma." (Researched, 08-C RA-17; whether it also replaces a receipt voucher is OPEN, RA-17)
- Fields: "Amount received" · "Date received" · "Payment reference (UTR or bank reference)"
- Errors: "This payment reference was already used for this proforma." · "The amount can't be more than the proforma's balance."
- Proforma status: "Converted" · line "Tax invoice {number} issued for {amount} on {date}."
- 25-day warning (delivered work, unpaid proforma; Rule 47; owner bell): "Proforma {number} for delivered work has been unpaid for 25 days. Issue a tax invoice within 30 days of supply." (Researched, 08-C RA-08)

## 7. Error messages (new API codes)
| Code | Message |
|---|---|
| lut_missing | (as the blocker line above) |
| fx_missing | (as the blocker line above) |
| export_currency_confirm | "Confirm that this export invoice should be in INR." |
| advance_reference_used | "This payment reference was already used for this proforma." |
| advance_exceeds_balance | "The amount can't be more than the proforma's balance." |
| proforma_not_issued | "Only an issued proforma can be converted." |

## 8. Lines added after the M5.2 brief (2026-10-27; pending owner approval)
| Code or place | Line |
|---|---|
| fx_date_invalid | "Use the rate published on {invoice date}. If none was published that day, use the last one published before it, at most {days} days earlier." (Researched, 08-C RA-21; replaces the earlier line, lead 2026-10-28) |
| fx_same_day_exists (new) | "A rate was published on {invoice date}, so use that day's rate." |
| advance_date_invalid | "The date received can't be before the proforma's date or in the future." |
| advance_previous_period (warning) | "This payment arrived in an earlier month. The GST on it belongs to that month's return: check with your CA." (Researched, 08-C RA-17) |
| already_set (service date) | "The service completion date is already set and can't be changed." |
| service_date_future | "The service completion date can't be in the future." |
| service_date_not_applicable / export_mode_not_applicable / export_declaration_not_applicable | "This doesn't apply to this type of invoice." |
| export_declaration_missing | "The export note in Settings › Terms was removed. Choose again." |
| export_declaration_changed | "The export note in Settings › Terms changed since this draft was saved. Save the draft again." |
| invoice_void (service date) | "This invoice is void." |
| fx_not_applicable | "An exchange rate is only needed for USD invoices." |
| Q9 invoice line description | "Payment received against proforma {proforma number}" |
| Q9 invoice, PDF line under the title | "Against proforma {proforma number} of {proforma date}, payment received on {date}." |
| Bank settings, intermediary bank label | "Intermediary bank (if your bank uses one)" |
| Bank settings, purpose-code hint | "The RBI purpose code for the foreign payments you receive, for example P0802 for software services. Ask your bank which code to use." (OPEN, 08-C RB-06: the code is the bank's to confirm) |
| Settings › Terms, extra export note hint | "Optional. Printed on export invoices after the legal export statement, which is always printed." |
| LUT banner when the current year has none | "There's no LUT for FY {fy}. Export invoices without IGST are blocked until you save its ARN." |
| `lut.reminder` bell | "File the LUT for FY {next fy} and save its ARN in Settings › Tax." |
| export_declaration_tampered | "The export note in Settings › Terms doesn't match its saved copy, so the invoice wasn't issued. A developer needs to look at it." |
| Draft: export route legend | "How is GST handled on this export?" · options "Under LUT, without IGST" · "With IGST paid" (Researched, 08-C RA-18) |
| FX dialog, "Other" source note label | "Describe the source" |
| Advance dialog, empty reference | "Enter the payment reference." |
| Advance dialog, zero amount | "Enter an amount above zero." |
| FX dialog, empty "Other" note | "Describe where the rate comes from." |
| Service completion, empty date | "Enter the date the service was completed." |
| Advance dialog, empty "Date received" | "Enter the date the payment was received." |
| Proforma draft title | "Draft proforma for {client name}" |
| Issued proforma, locked banner | "Issued {date} by {name}. This proforma is locked. If it's wrong and nothing has been paid, void it and issue a new one." (Researched, 08-C RA-17: a proforma is not a tax document) |
| Proforma, issue dialog statement | "This proforma will get the next number in its series and can't be edited afterwards. It is not a tax invoice." |
| Proforma, void not allowed | "This proforma can't be voided because a payment has been recorded against it." |
| Advance, client's GST status changed since the proforma (`advance_supply_changed`) | "The client's GST details changed after this proforma was issued, so the tax on this payment can't be worked out from it. Check the client's details with your CA before recording the payment." (Researched, 08-C RA-12: a cautious product rule) |
| Proforma draft, under the title | "Drafts can be edited. Issuing gives the next proforma number and locks it." |
| Proforma, issue heading, dialog title and button | "Issue proforma" |
| Proforma, issued toast | "Proforma {number} issued." |
| Proforma, void refused because it was emailed | "This proforma has been emailed to the client, so it can't be voided." (product rule) |
| fx_date_invalid on the advance (tax invoice for payment received) | "Use the rate published on {date received}. If none was published that day, use the last one published before it, at most {days} days earlier." (Researched, 08-C RA-21; replaces the earlier line) |

## 9. Lines added on 2026-10-28 (lead, from 08-C and the owner's answers)
| Code or place | Line |
|---|---|
| advance_lut_missing (Q37, owner 2026-10-28) | "There's no LUT saved for FY {fy}, when this payment was received, so this tax invoice can't be issued without IGST. Save that year's LUT ARN in Settings › Tax first, or issue it with IGST." (Researched, 08-C RA-19) |
| Advance dialog, route choice when that year has no LUT | legend "This payment's year has no LUT" · options "Save the LUT first" (opens Settings › Tax) · "Issue with IGST" |
| Advance dialog, IGST note | "IGST at 18 % is charged on this payment. The proforma's other payments are not affected." |
| Q9 invoice, PDF line when issued with IGST although the proforma was under LUT | "Against proforma {proforma number} of {proforma date}, payment received on {date}. Issued with IGST: no LUT was in place for FY {fy}." |
