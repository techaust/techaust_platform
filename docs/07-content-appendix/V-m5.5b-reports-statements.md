# 07-V: GST and CA exports, export realisation, EDF, statements and the finance tiles (M5.5)

_Drafted by the lead on 2026-10-28 from approved facts:
- 04: ADM-REP-04 (GST and CA exports), ADM-INV-17 (realisation tracker), ADM-REP-07 (EDF report), ADM-CLI-04 (statement of account), ADM-DASH-01 (finance tiles);
- 07: §1 (voice, the banned-phrase list), §8 (staff alert emails);
- 07-R, 07-S, 07-T and 07-U (invoice, proforma, note and email words);
- 08-A (GSTR-1 sections, SAC list, Rule 96A, FEMA realisation periods) and 08-C;
- the M5 batch questions Q52–Q62, each built with its recommended default.

**Approved by the lead on 2026-10-28 under the owner's delegation** ([13-decisions](../13-decisions.md) 2026-10-28), after the research in [08-C](../08-research-appendix/C-research-register.md). Everything here is staff-facing except §6 (the statement PDF, which a client may receive). `{…}` is filled by the system. Tax and legal lines carry **(Researched, 08-C <ID>)** or **(OPEN, 08-C <ID>)**. Changes of 2026-10-28 are made in place and listed in §11.

**Rules used:** official names (GSTR-1, GSTR-3B, Table 13, EDF, FIRA, FIRC, LUT, SAC) are kept as the GST portal and banks use them; every other word is plain English; "and", never "&"; no urgency words._

## 1. Navigation
- Sidebar group: "Reports"
- Items: "GST exports", "Sales register", "EDF list", "Export realisation"
- Client tab: "Statement"
- Audit labels: `report.export` "Exported a report", `client.statement_pdf` "Made a statement PDF"

## 2. GST exports (Owner, Accountant; a fresh code on every export)
- Title: "GST exports"
- Lede: "Files for your GSTR-1 and GSTR-3B, made from the invoices and notes issued in the period. Check them with your CA before you file." **Replaced on 2026-11-01 by [07-ZK](ZK-ca-wording.md) line 1; kept for history only.**
- Period picker label: "Period"; options "Month" and "Quarter"; default hint: "The last complete quarter is selected."
- "This period has not ended. The files will change if you issue more documents before it ends."
- Button: "Make files"
- Progress: "Reading issued documents: {count} so far" then "Checking {count} documents"
- Done: "{count} documents checked. No errors."
- Errors heading: "{count} problems to fix before these files can be made"; each line: "{document number}: {message}" with "Open document"
- Warnings heading: "Check before filing"
- Totals panel heading: "Totals for the period"
  - section names: "B2B (registered clients)", "B2CL (unregistered, inter-state, above {threshold})", "B2CS (unregistered, other)", "Exports", "Credit and debit notes (registered)", "Credit and debit notes (unregistered)", "HSN/SAC summary", "Documents issued (Table 13)"
  - "HSN/SAC summary matches the section totals." / "HSN/SAC summary does not match the section totals." (the second blocks the download)
- GSTR-3B summary heading: "GSTR-3B figures"
  - "3.1(a) Outward taxable supplies (other than zero-rated)"
  - "3.1(b) Outward taxable supplies (zero-rated)"
  - "3.2 Inter-state supplies to unregistered persons, by place of supply"
- Table 13 preview heading: "Documents issued"; columns "Series", "From", "To", "Total", "Cancelled"
- Downloads: "Download {section} CSV"; "Download all (ZIP)"
- Layout note (under the downloads): "Made with layout {version} for the GSTR-1 offline tool. Layouts change; before your first upload, test-import one file with your CA." (OPEN, 08-C RA-23 Q17) **Replaced on 2026-11-01 by [07-ZK](ZK-ca-wording.md) line 2; kept for history only.**

### 2.1 Error messages (one per code)
| Code | Message |
|---|---|
| `kind_not_reportable` | "This document type is not reported in GSTR-1." |
| `gstin_missing` | "The client's GSTIN is missing." |
| `gstin_invalid` | "The client's GSTIN is not valid." |
| `parent_missing` | "The invoice this note is against was not found in the data." |
| `parent_invalid` | "The invoice this note is against is not a reportable invoice." |
| `supply_mismatch` | "The supply details (type, client, place of supply or tax heads) don't agree with each other." |
| `sac_missing` | "A line has no SAC code." |
| `sac_invalid` | "A line's SAC code is not six digits." |
| `params_invalid` | "Your state code in Settings is not valid." |
| `rates_empty` | "The document has no tax lines." |
| `rate_invalid` | "A line has a GST rate that isn't allowed." |
| `amount_invalid` | "An amount on the document is not valid." |
| `amount_out_of_range` | "An amount is too large to report." |
| `totals_mismatch` | "The document's totals don't add up from its lines." |
| `pos_invalid` | "The place of supply is not a valid state code." |
| `export_pos_mismatch` | "An export must have place of supply 96 (other countries)." |
| `number_invalid` | "The document number has characters the GST portal won't accept." |
| `duplicate_row` | "This document appears twice." |
| `date_invalid` | "The document date is not valid." |
| `threshold_invalid` | "The B2CL threshold in Settings is not valid." |
| `series_not_gst` | "This number series is not a GST document series." |
| `docs_counts_invalid` | "The documents-issued counts don't add up." |
| `fx_missing` | "A foreign-currency document has no exchange rate." |
| `rules_invalid` | "The realisation periods in Settings are not valid." |
| `period_invalid` | "Pick a period within one financial year, of at most a year." |
| `rates_sum_mismatch` | "The tax lines don't add up to the document total." |
| `layout_unknown` | "This file layout is not known." |
| `internal_error` | "Something went wrong making this file. Try again; if it keeps happening, tell us." |

### 2.2 Warnings
| Code | Message |
|---|---|
| `b2cs_negative_net` | "B2CS for {state} and {rate} comes to below zero after credit notes. Check with your CA how to report it." **Replaced on 2026-11-01 by [07-ZK](ZK-ca-wording.md) line 3; kept for history only.** |
| `hsn_description_missing` | "SAC {code} has no description in our list; the file leaves it blank." |
| `before_fema_2026` | "Issued before 1 October 2026: a different realisation period may apply. Ask your bank or CA." (OPEN, 08-C RB-02) **Replaced on 2026-11-01 by [07-ZK](ZK-ca-wording.md) line 4; kept for history only.** |

## 3. Sales register and output tax (Owner, Accountant)
- Title: "Sales register"
- Lede: "Every tax invoice, export invoice, credit note and debit note issued in the range, for your accounts."
- Range label: "From" / "To"; error `period_invalid` as §2.1
- Downloads: "Download sales register (CSV)", "Download output tax (CSV)", "Download GSTR-3B figures (CSV)"
- **`sales-register-v1` headers:** Date · Number · Type · Client · GSTIN · Place of supply · Supply type · Currency · Document total · Exchange rate · Total in INR · SAC · Rate · Taxable value · IGST · CGST · SGST · Status
  - Status values: "Issued", "Cancelled"; a cancelled row shows zero amounts
- **`output-tax-v1` headers:** Supply · Rate · Taxable value · IGST · CGST · SGST
  - Supply values: "Intra-state", "Inter-state", "Zero-rated, without payment of tax (LUT)", "Zero-rated, with payment of tax"
- **`gstr3b-summary-v1` headers:** Table · Description · Place of supply · Taxable value · IGST · CGST · SGST
- Empty state: "No documents were issued in this range."

## 4. EDF list (Owner, Accountant; Q56)
- Title: "EDF list"
- Lede: "Export invoices issued in the month, for the export declaration (EDF) you give your bank. One EDF can cover the whole month. Due by {due date}." (Researched, 08-C RB-03)
- Month picker label: "Month"; default the previous month
- Columns: "Invoice", "Date", "Client", "Country", "Currency", "Amount", "Purpose code", "Amount realised"
- Note under the table: "Amount realised is left blank: payments are recorded from the payments update."
- Download: "Download EDF list (CSV)"
- Empty state: "No export invoices were issued in {month}."

## 5. Export realisation (Owner, Accountant)
- Title: "Export realisation"
- Lede: "Export invoices not yet fully paid, most urgent first. Money from an export must reach India within the FEMA period: 9 months from the invoice date, or 12 if it was invoiced or settled in Indian Rupees." (Researched, 08-C RB-01)
- Toggle: "Show realised"
- Columns: "Invoice", "Client", "Issued", "Outstanding", "Stage", "Due by"
- Stage labels:
  - `ok` "On track"
  - `fema_approaching` "FEMA date in 30 days"
  - `fema_overdue` "Past the FEMA date"
  - `gst_approaching` "GST date in 30 days"
  - `gst_overdue` "Past the GST date"
  - `realised` "Realised"
- Line on rows issued before 1 October 2026: "Issued before 1 October 2026: a different realisation period may apply." (OPEN, 08-C RB-02)
- IGST note (Q53): "Exports where IGST was charged show only the FEMA dates; the 12 months and 15 days GST date applies to exports under your LUT." (Researched, 08-C RA-20)
- Extension note (Q60): "If your bank extended a date, you can record it with the proof of payment in the payments update." (Researched, 08-C RB-04; the proof document is OPEN, RB-05)
- Empty state: "No export invoices are waiting for payment."

## 6. Client statement (tab: Owner, Staff, Accountant; Q58, Q59)
- Tab title: "Statement"
- Range labels: "From" / "To"; default "This financial year to date"; currency label: "Currency"
- Lines: "Opening balance on {date}: {amount}"; "Closing balance on {date}: {amount}"
- Columns (and `statement-v1` CSV headers): Date · Document · Details · Debit · Credit · Balance
- Entry kinds (Details): "Invoice", "Export invoice", "Debit note", "Credit note against {number}", "Payment received"
- Notes under the table:
  - "Payment requests (proformas) aren't listed: a payment against one shows through its tax invoice."
  - "Only payments recorded against payment requests are listed until online payments arrive."
- Buttons: "Download CSV", "Make PDF"; pending "Making the PDF…"; ready "Download PDF"
- Errors:
  - `statement_too_long` "This range has more than 200 entries. Pick a shorter range for the PDF."
  - `statement_empty` "Nothing to list in this range."
  - `client_anonymised` "This client's details were erased, so no statement can be made."
  - `statement_failed` "The PDF couldn't be made. Try again."
  - `period_invalid` "Pick a start date on or before the end date."
- Empty state: "Nothing has been issued to this client in this range."
- Kept note (Q57): "Statement PDFs are kept for 30 days."

### 6.1 Statement PDF fixed words (client may receive it)
- Title: "Statement of account"
- "Period: {from} to {to}"; "Currency: {currency}"
- "Opening balance", "Closing balance", "Total debits", "Total credits"
- Column headers as §6
- "Amount due: {closing}" (only when the closing balance is above zero)
- Footer: "Questions about this statement? Write to billing@techaust.com." and "Generated on {date}."

## 7. Dashboard finance tiles (Owner, Accountant; Q52)
- "Invoiced": sub-labels "This month", "This financial year"; hint "Before GST"; secondary "≈ {amount} in INR" for USD
- "Outstanding": sub-label "{count} documents"
- "Overdue": sub-label "{count} documents"; list heading "Oldest"; row "{number} · {client} · {days} days"
- "Payment requests awaiting payment": sub-label "{count} open"
- "Exports nearing a deadline": counts "FEMA in 30 days", "Past FEMA", "GST in 30 days", "Past GST"; list heading "Next"
- Empty states: "Nothing invoiced yet.", "Nothing outstanding.", "Nothing overdue.", "No payment requests open.", "No export deadlines coming up."
- Replaces 07-J's line: "Collected figures arrive with payments." The finance tiles' foot line joins both in one sentence: "Collected figures and payments waiting for checks arrive with payments." (07-Y item 4, owner 2026-10-29)

## 8. Settings › Tax
- "B2CL threshold" hint: "Invoices to unregistered clients in another state above this amount are reported one by one (B2CL). Default ₹1,00,000." (Researched, 08-C RA-13)
- "Realisation period for INR exports" hint: "Months within which payment must arrive for an export invoiced or settled in Indian Rupees. Default 12. A foreign-currency invoice has 9 months; ask your bank before treating one as settled in rupees." (Researched, 08-C RB-01)
- Errors: "Enter an amount above zero." / "Enter a whole number of months from 1 to 120."

## 9. Bells (staff)
- `export.fema_approaching` "{number}: FEMA date in 30 days ({date})"
- `export.fema_overdue` "{number}: past the FEMA date ({date})"
- `export.gst_approaching` "{number}: GST date in 30 days ({date})"
- `export.gst_overdue` "{number}: past the GST date ({date})"
- `edf.due` "EDF list for {month} is due by {date}"
- `statement.ready` "Statement PDF for {client} is ready"
- `statement.failed` "Statement PDF for {client} couldn't be made"

## 10. Staff emails (from no-reply@, Reply-To contact@, owners only; Q54, Q55)
- **EDF reminder**, subject: "EDF list for {month}: {count} export invoices"
  - body: "{count} export invoices were issued in {month}. The EDF list is ready for your bank, due by {due date}." (Researched, 08-C RB-03)
  - button: "Open EDF list"
- **Realisation alert**, subject by stage:
  - `fema_approaching` "{number}: FEMA date in 30 days"
  - `fema_overdue` "{number}: past the FEMA date"
  - `gst_approaching` "{number}: GST date in 30 days"
  - `gst_overdue` "{number}: past the GST date"
  - body: "Export invoice {number} to {client} still shows {outstanding} outstanding. {stage sentence} If the payment has arrived, record it when payments are available; if your bank extended the date, keep its letter." (Researched, 08-C RB-01, RB-04)
  - stage sentences: "Its FEMA realisation date is {date}." / "Its FEMA realisation date was {date}." / "Its GST date (12 months and 15 days, Rule 96A) is {date}." / "Its GST date (12 months and 15 days, Rule 96A) was {date}."
  - button: "Open export realisation"

## 11. Changes of 2026-10-28 (lead)
- "GST refund date" becomes "GST date" everywhere (the Rule 96A date is when IGST becomes payable under the LUT, not a refund date).
- The FEMA, EDF, extension and INR-period lines follow 08-C RB-01 to RB-04; "RBI" no longer extends dates (the bank does).
- The audit labels of §1 lose their "[Placeholder]" mark.
