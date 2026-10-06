# Appendix A: GST and invoicing rules for the TecHaust billing system (as of 6 Oct 2026)

> **Status: research notes, not tax advice.** Every recommendation below is a best-effort default for configurable software settings and is labelled **VERIFY WITH CA**. Facts I could not confirm from a primary source are marked **[?]**. All sources were checked on **2026-10-06** unless stated otherwise.
>
> **Primary sources used:** the CBIC tax repository (taxinformation.cbic.gov.in) for the CGST/IGST Acts and Rules, CBIC PDFs, RBI notifications, the NPCI FAQ, the GST e-invoice portals (einvoice1 / einvoice6), and Stripe/PayPal's own pages. ClearTax, TaxGuru, EY, Grant Thornton and similar sites are used only as secondary sources and are labelled as such.
>
> **Business assumed:** sole proprietorship, GSTIN in West Bengal (state code 19), Balurghat; IT services only; AATO assumed to be well below ₹5 Cr; domestic B2B/B2C clients plus foreign clients paying in USD via Stripe, PayPal or SWIFT.

---

## TL;DR: settings defaults

| # | Item | Recommended default for the software (all **VERIFY WITH CA**) | Confidence | Source(s) |
|---|------|------------------------------------------------------------|-----------|-----------|
| 1 | GST rate | **18%** on all service lines (CGST 9% + SGST 9%, or IGST 18%). This covers hosting, AMC, retainers and subscriptions. Keep the rate per line item (configurable). | High | CBIC SAC annexure; EY 56th Council alert; secondary: Busy, RegisterKaro |
| 2 | SAC codes | Software/web/app/AI build: **998314**. Consulting, support, AMC, fractional CTO: **998313**. Hosting: **998315**. Infra/network/DevOps management: **998316**. UI/UX design: **998314** (alternative 998391). Software licence/SaaS: **997331** or 998315 (ambiguous). Other: 998319. Print **4 digits (9983)** at minimum while AATO ≤ ₹5 Cr, but default to **6 digits**. | Med | CBIC SAC annexure (Notification 11/2017-CTR); Notification 78/2020-CT |
| 3 | Invoice contents | All Rule 46 fields (list in §3). Mark the invoice "ORIGINAL FOR RECIPIENT" (Rule 48(2)). A PDF generated electronically needs no signature (Rule 46 proviso), but include an "authorised signatory" block anyway. | High | Rule 46, 48 CGST Rules (CBIC) |
| 4 | Invoice timing | Issue within **30 days** of completing the service (Rule 47). For retainers and subscriptions (continuous supply), issue **on or before the payment due date** (s.31(5)). Alert on any unbilled completed milestone at day 25. | High | Rule 47; s.31(2), 31(5) CGST |
| 5 | Number format | `TH/{TYPE}/{FY}/{NNNN}`, max 16 chars, uppercase A–Z, 0–9, `/` and `-` only, first character not `0`. Examples: `TH/INV/2627/0001` (16), `TH/EXP/2627/0001` (16), `TH/CN/2627/0001`, `TH/DN/2627/0001`, `TH/RV/2627/0001`, `TH/RF/2627/0001`. Proforma `TH/PI/2627/0001` is not a GST document. Payment receipt: `TH/RCT/2627/0001`. Reset on 1 April. | High | Rule 46(b), 50(b), 51(b), 53; e-invoice schema (secondary: ClearTax API docs) |
| 6 | Cancelled numbers | Never delete or reuse a number. If a document is voided before it is sent or reported, keep it as "Cancelled" and count it in GSTR-1 Table 13. After it has been sent or reported, reverse it with a credit note. | Med | Rule 46(b), 48(3); Rule 56(8); GSTN Table 13 advisory |
| 7 | Advances (domestic) | Default: on receipt of payment, **auto-issue a Tax Invoice for the amount received** (time of supply = date of receipt), plus a non-GST payment receipt. Optional mode: Receipt Voucher (Rule 50) now, Tax Invoice later, and a Refund Voucher (Rule 51) if the job is cancelled. Proforma = not a GST document. | Med | s.13(2), 31(2), 31(3)(d),(e) CGST; Rules 50, 51 |
| 8 | Advances (export, LUT) | Same flow. Tax is nil under LUT; print the LUT endorsement on every export document. | Med | s.16 IGST; Rule 96A; Rule 89(4)(D) |
| 9 | Credit notes | Rule 53(1A) fields. Must reference the original invoice number(s) and date(s). Hard cut-off: **30 Nov after the end of the FY of the supply** (or the date the annual return is filed, if earlier). Block issue after that date. Report in GSTR-1 Table 9B. | High | s.34 CGST; Rule 53(1A) |
| 10 | Debit notes | **Add a Debit Note type** (missing from the plan). It is needed for any upward correction, because invoices are immutable. | High | s.34(3),(4) CGST |
| 11 | Tax type | Client GSTIN state = 19 → CGST+SGST. Any other Indian state → IGST. Unregistered client: use the state of the client's address on record (WB → CGST+SGST, other → IGST); with no address, treat as WB. Foreign → export (zero-rated). | High | s.12(2) IGST |
| 12 | Export invoices | Endorsement (exact text): **"SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX"**. Show recipient name and address and the country of destination. Print the LUT ARN and FY. The invoice currency may be USD; also print the INR value and the exchange rate. | High | Rule 46 proviso (CBIC text) |
| 13 | LUT | Prompt to file RFD-11 every FY before the first export (free, online). Block LUT-mode export invoices unless an LUT ARN for that FY is saved. | High | Rule 96A(1); secondary: ClearTax |
| 14 | Realisation tracking | Track each export invoice to receipt. Warn at **9 months** (FEMA limit from 1 Oct 2026). Escalate at **12 months + 15 days** (GST: IGST + interest due under the LUT bond). Store the FIRA/FIRC/payment-advice reference for every receipt. | Med | RBI FEMA 23(R)/2026-RB as amended 22 Sep 2026; Rule 96A(1)(b) |
| 15 | FEMA EDF (NEW) | Monthly report of all export-of-services invoices for the **EDF filing with the AD bank, within 30 days of the end of the invoice month** (new from 1 Oct 2026). | Med | RBI FEMA 2026 Regulations; secondary: TaxGuru |
| 16 | FX rate | Default: **FBIL/RBI reference rate** for USD/INR **on the invoice date** (previous published day on holidays). Options: CBIC customs export rate, or the bank's TT buying rate. Store rate, source and date on the invoice and freeze them. | Med | Rule 34(2) CGST; RBI/FBIL |
| 17 | Rounding | Integer paise throughout. Tax per line per tax head = round-half-up(taxable × rate) to paise; compute CGST and SGST separately at 9% each. Invoice tax totals = sum of line taxes. Round the **grand total to the nearest ₹1** with a visible "Round off" line (−₹0.49 … +₹0.50). Never round USD to whole dollars. | Med | s.170 CGST; e-invoice validation rules (einvoice6) |
| 18 | E-invoicing | **Off** (AATO ≤ ₹5 Cr), behind a feature flag. When on: IRN + QR on B2B, export and CDN documents. Add a setting "AATO > ₹5 Cr in any FY since 2017-18? (Y/N)". | High | Notification 10/2023-CT; Rule 48(4) |
| 19 | Returns | Default **QRMP** (quarterly GSTR-1/3B, optional monthly IFF for B2B). Export CSVs that match the GST Offline Tool sheets: b2b, b2cl, b2cs, exp, cdnr, cdnur, at/atadj, hsn(b2b), hsn(b2c), docs. | Med | GST portal QRMP FAQ; Offline Tool |
| 20 | Retention | Keep all documents and audit logs for **at least 8 years from FY end** (default retention 10 years). Never hard-delete. Keep an edit/void log. | Med | s.36 CGST; Rule 56(8), 57; IT Rules 2026 r.46(9) [?] |
| 21 | Supplier name | Print **Trade name** in the header, plus "Legal name: ⟨proprietor name per PAN/GST certificate⟩ (Proprietor)", GSTIN, the principal place of business address exactly as registered, and State: West Bengal (19). | Med | Rule 46(a); e-invoice schema needs LglNm (secondary) |
| 22 | Reverse charge | Print "Tax payable on reverse charge: No" on every tax invoice, receipt voucher and refund voucher. | High | Rule 46(p), 50(j), 51(j) |
| 23 | B2C details | Always capture the client's state (it drives the place of supply). Require name, address and state when an unregistered client's invoice value is ≥ ₹50,000. B2C dynamic QR: **N/A** (only for AATO > ₹500 Cr). | High | Rule 46(e),(f); Notification 14/2020-CT |
| 24 | Gateways | Warn when a Stripe/PayPal export payment would exceed **₹25 lakh per transaction** (PA-CB cap). Never add a UPI surcharge line: the merchant must absorb the UPI MDR (0.4% above ₹2,000, capped at ₹300, from 15 Oct 2026). | Med | RBI PA Directions 15 Sep 2025 (secondary); NPCI FAQ 15 Sep 2026 |
| 25 | TDS | A manual "TDS deducted by client" adjustment on a receipt. Section field default "393(1) [old 194J]". Suggested rates 10% / 2% (editable). TDS is computed on the pre-GST value. Track it as TDS receivable and match it to Form 26AS/AIS. | Med | Income-tax Act 2025 s.393 (secondary) |

---

## 1. GST rate for IT and software services

**Rule.** IT services fall under heading 9983 ("Other professional, technical and business services") in the services rate schedule (Notification 11/2017-Central Tax (Rate), as amended). The general rate is 9% CGST + 9% SGST, or 18% IGST. The 56th GST Council (3 Sep 2025) rationalised rates from 22 Sep 2025 through Notifications 9/2025–17/2025-CT(Rate), dated 17 Sep 2025. Its service-side changes were targeted (for example, gyms and salons cut to 5%, and local delivery through e-commerce operators). I found **no change** to heading 9983 IT services, and secondary sources agree that IT stays at 18%. Notification 01/2026-CT(Rate) (30 Apr 2026, effective 1 May 2026) changed goods tariff entries only, to align with the Finance Act 2026.

**Plain English.** Every TecHaust service charges 18%. That includes development, hosting management, maintenance/AMC, support retainers, the dev subscription and fractional-CTO retainers. A bundled retainer is one service at one rate, so composite versus mixed supply makes no difference here.

**Default (VERIFY WITH CA).** A rate field on each line, default 18%, with an "export (LUT): 0% IGST" mode. Do not hard-code 18%.

**Open risks.** (a) If TecHaust rebills third-party costs (AWS, domains, licences) to clients, those amounts are part of the taxable value at 18%. They are excluded only if the strict "pure agent" conditions are met (Rule 33). Default: treat them as taxable. (b) The 57th GST Council meets on 7/8 Oct 2026 and is billed as being about "process reforms", not rates. Re-check after it meets.

**Sources (checked 2026-10-06).**
- CBIC SAC scheme (annexure to Notification 11/2017-CTR): https://cbic-gst.gov.in/hindi/pdf/central-tax-rate/Notification11-CGST-Annexure.pdf
- EY alert on the 56th Council notifications (17 Sep 2025): https://www.ey.com/en_in/technical/alerts-hub/2025/09/cbic-issues-notifications-giving-effect-to-the-recommendations-made
- PIB FAQs on the 56th Council (seen in search results only): https://www.pib.gov.in/PressReleasePage.aspx?PRID=2163560
- Secondary: https://busy.in/gst-rates/it-services/ ; https://www.registerkaro.in/post/gst-registration-for-software-it-services
- Secondary, on the 2026 rate notifications: https://taxguru.in/goods-and-service-tax/cbic-revises-gst-rate-notification-under-finance-act-2026.html
- Secondary, on the 57th Council agenda: https://taxguru.in/goods-and-service-tax/57th-gst-council-meeting-registration-itc-process-reforms-focus.html

---

## 2. SAC codes

**Rule.** The SAC codes come from the "Scheme of Classification of Services" (annexure to Notification 11/2017-CTR). Group 99831 contains:

- 998311 Management consulting and management services
- 998312 Business consulting, including PR
- **998313 IT consulting and support services**
- **998314 IT design and development services**
- **998315 Hosting and IT infrastructure provisioning services**
- **998316 IT infrastructure and network management services**
- 998319 Other IT services n.e.c.

Related codes:

- 998391 Specialty design services
- 997331 Licensing services for the right to use computer software and databases
- 998434 Software downloads (on-line content)
- 998713 Maintenance and repair of computers and peripheral equipment (hardware only)

Confirmed from the CBIC annexure PDF, whose table layout is jumbled; the code order is inferred from the group sequence.

**Digit requirement.** Notification 78/2020-CT (15 Oct 2020, effective 1 Apr 2021) sets the HSN/SAC digits required on tax invoices:

- AATO up to ₹5 Cr in the previous FY: **4 digits** on B2B invoices; optional on B2C invoices.
- AATO above ₹5 Cr: **6 digits** on all invoices.

GSTR-1 Table 12 now needs the HSN chosen from a dropdown (Phase III, from the April 2025 tax period; secondary sources). In practice that means a 6-digit code for services.

| Service | Default SAC | Ambiguity / alternative |
|---|---|---|
| Custom software development | 998314 | — |
| Website / web app / mobile app development | 998314 | — |
| IT consulting, architecture review, fractional CTO | 998313 | 998311 if the work is mainly business/management strategy |
| IT support, maintenance, AMC, bug-fix retainers, monthly care plan | 998313 | 998316 if it is mainly managing the client's infrastructure or network |
| Hosting / infrastructure provisioning (TecHaust supplies the hosting) | 998315 | — |
| Hosting management / DevOps on the client's cloud account | 998316 | 998313 |
| UI/UX design | 998314 (when part of a software build) | 998391 for standalone design-only work |
| AI automation / systems integration | 998314 | 998313 if advisory only |
| Licensing / SaaS subscription of TecHaust's own software | 997331 | 998315 (application hosting) or 998434. Genuinely ambiguous |
| "Dev subscription" (development capacity on retainer) | 998314 | 998313 |

**Default (VERIFY WITH CA).** A SAC master table mapped to service types, always printing 6 digits. The rate is 18% for every code above, so a wrong pick changes reporting, not tax.

**Open risks.** A SaaS licence versus an online service may be OIDAR (online information and database access or retrieval) for B2C sales. If it is, Rule 46(f) requires the recipient's state on the invoice for every unregistered recipient, whatever the value.

**Sources (checked 2026-10-06).**
- CBIC SAC annexure (above).
- Notification 78/2020-CT (copy hosted by ICMAI): https://icmai.in/upload/Taxation/Top_Stories/ITN/ITN_08012021_78.pdf
- Secondary: https://taxguru.in/goods-and-service-tax/hsn-code-mandatory-irrespective-turnover-01-04-2021.html
- Secondary, Table 12 Phase III: https://taxguru.in/goods-and-service-tax/gstn-implements-phase-iii-table-12-gstr-1-1a-april-2025.html

---

## 3. Tax invoice contents (Rule 46), signature, and timing (Rule 47)

**Rule 46 (CBIC current text).** A tax invoice must contain:

- (a) supplier name, address and GSTIN
- (b) **"a consecutive serial number not exceeding sixteen characters, in one or multiple series, containing alphabets or numerals or special characters – hyphen or dash and slash … and any combination thereof, unique for a financial year"**
- (c) date of issue
- (d) recipient name, address and GSTIN/UIN, if registered
- (e) for an unregistered recipient where the value is **≥ ₹50,000**: name, address, address of delivery, State name and code
- (f) the same details below ₹50,000 if the recipient asks. A proviso makes the recipient's State mandatory at any value for OIDAR or e-commerce supplies to unregistered persons.
- (g) HSN/SAC
- (h) description
- (i) quantity and unit (goods only)
- (j) total value
- (k) taxable value after discount
- (l) rate of tax per head (CGST/SGST/IGST/cess)
- (m) amount of tax per head
- (n) place of supply with State name, for inter-State supplies
- (o) delivery address if it differs from the place of supply
- (p) whether tax is payable on reverse charge
- (q) signature or digital signature
- (r) QR code with IRN, only for e-invoices
- (s) a declaration, only for taxpayers above the e-invoice threshold who are exempt from it; not applicable to us

**Signature.** A proviso, inserted by Notification 74/2018-CT, says a signature or digital signature is **not required** for an electronic invoice issued under the IT Act, 2000.

**Copies.** Rule 48(2): service invoices are prepared in duplicate, marked "ORIGINAL FOR RECIPIENT" and "DUPLICATE FOR SUPPLIER".

**Timing.**
- Section 31(2): a services invoice may be issued before or after the service, within the prescribed period.
- Rule 47: the prescribed period is **30 days from the date of supply of service**.
- Section 31(5), continuous supply of services: (a) invoice on or before the due date of payment, if the contract fixes one; (b) otherwise, before or when payment is received; (c) where payment is linked to an event, on or before that event is completed.
- Section 31(6): if the contract ends early, invoice when the supply ceases.

**Plain English.** Generated PDFs need no wet or digital signature, although an "Authorised signatory" line is customary. Raise the invoice within 30 days of finishing the work. For monthly retainers, care plans and the dev subscription, raise it on or before each payment due date.

**Default (VERIFY WITH CA).**
- An invoice template that checks all mandatory fields before issue. Block issue if a B2B client has no GSTIN, or if any client has no state.
- Mark copies "ORIGINAL FOR RECIPIENT".
- A scheduler that issues retainer invoices on their billing date.
- An alert for completed, unbilled milestones at 25 days.

**Open risks.** Whether TecHaust's plans (care plan, dev subscription, fractional CTO) count as "continuous supply" depends on the contract terms (recurring, more than 3 months, periodic payments). The default above works either way.

**Sources (checked 2026-10-06).**
- Rule 46: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html
- Rule 47: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule47_v1.00.html
- Rule 48: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule48_v1.00.html
- Section 31 CGST: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter7/section31_v1.00.html

---

## 4. Invoice numbering, cancelled documents, GSTR-1 Table 13

**Rule.**
- Rule 46(b), 50(b), 51(b) and 53(1A)(c): numbers may run in "one or multiple series" and must be unique for a financial year. **Separate series per document type are expressly allowed.**
- Rule 48(3): invoice serial numbers must be furnished in GSTR-1/1A.
- Rule 56(8): entries must not be erased or overwritten; electronic records must keep "a log of every entry edited or deleted".
- GSTR-1 Table 13 ("documents issued") lists each document type with its from/to numbers, total, cancelled and net issued counts. GSTN made Table 13 **mandatory from the May 2025 return period**: a return with B2B/B2C data cannot be filed with Table 13 blank (secondary sources on the GSTN advisory of 1 May 2025).
- The e-invoice schema (relevant if e-invoicing ever applies) limits `DocDtls.No` to 16 characters. It must start with A–Z, a–z or 1–9 (not 0), followed by alphanumerics, `/` or `-` (secondary: ClearTax API docs).

**Cancelled or voided invoices.** GST law has no general "cancel invoice" provision. Common practice:
- A number generated in error before the document is sent or reported is kept, marked cancelled, and shown in Table 13's "Cancelled" column.
- Once the document has been given to the client or reported in GSTR-1, it is reversed with a credit note.

TecHaust's plan (immutable invoices, corrections by credit note) fits this practice. One practitioner opinion [?] says portal invoice-number matching is case-insensitive, so always use uppercase.

**Proposed format (≤16 characters).**

| Document | Format | Length | GST document? | Table 13 row |
|---|---|---|---|---|
| Tax Invoice (domestic) | `TH/INV/2627/0001` | 16 | Yes | Invoices for outward supply |
| Export Invoice | `TH/EXP/2627/0001` | 16 | Yes | Invoices for outward supply |
| Credit Note | `TH/CN/2627/0001` | 15 | Yes | Credit Note |
| Debit Note (add) | `TH/DN/2627/0001` | 15 | Yes | Debit Note |
| Receipt Voucher (optional mode) | `TH/RV/2627/0001` | 15 | Yes | Receipt voucher |
| Refund Voucher (optional mode) | `TH/RF/2627/0001` | 15 | Yes | Refund voucher |
| Self-invoice, RCM imports (see §19) | `TH/SI/2627/0001` | 15 | Yes | Invoices for inward supply from unregistered person |
| Payment Voucher, RCM (see §19) | `TH/PV/2627/0001` | 15 | Yes | Payment voucher |
| Payment Receipt (acknowledgement) | `TH/RCT/2627/0001` | 16 | No | — |
| Proforma / payment request | `TH/PI/2627/0001` | 15 | No | — |

`2627` = FY 2026-27. A 4-digit counter allows 9,999 documents per series per FY. Having two series for outward invoices (INV and EXP) is fine. Table 13 simply gets two rows of the same type.

**Default (VERIFY WITH CA).**
- Gapless counters allocated in a DB transaction only at the moment of issue. Drafts carry no number.
- Reset on 1 April, using the document date's FY.
- Validate with the regex `^[A-Z1-9][A-Z0-9/-]{0,15}$`.
- A "void" action is allowed only before the document is sent or reported. It keeps the number with status CANCELLED and a reason.
- Table 13 export generated from the counters.

**Sources (checked 2026-10-06).**
- Rules 46, 48, 50, 51, 53: CBIC URLs in §3, §5 and §6.
- Rule 56: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter7/rule56_v1.00.html
- Secondary, Table 13 mandatory: https://taxo.online/latest-news/02-05-2025-gstn-issued-advisory-relating-to-reporting-of-hsn-codes-in-table-12-and-list-of-documents-in-table-13-of-gstr-1-1a/ ; https://www.centaxonline.com/blog/gstn-advisory-dropdown-hsn-mandatory-table-13-in-gstr-1
- Secondary, e-invoice field rules: https://docs.cleartax.in/cleartax-docs/e-invoicing-api/e-invoicing-api-reference/resources-and-master/e-invoice-object

---

## 5. Advances for services: time of supply, receipt and refund vouchers, proforma

**Rule.**
- **Section 13(2) CGST.** The time of supply of services is the earliest of: (a) the invoice date, if the invoice is issued within the s.31 period, or the date of receipt of payment, whichever is earlier; (b) if the invoice is late, the date of provision or of payment, whichever is earlier; (c) the date the recipient books the service. "Date of receipt of payment" is the earlier of the date it is entered in the books and the date it is credited to the bank. The supply is deemed made "to the extent" covered by the invoice or payment. Proviso: an excess of up to ₹1,000 over the invoice may be taxed at the next invoice. **So GST on services is due on advances.** (The goods-advance exemption, Notification 66/2017-CT, does not cover services.)
- **Section 31(3)(d) and Rule 50.** On receiving an advance, the supplier must issue a receipt voucher "or any other document" evidencing receipt. Rule 50 lists its contents: supplier details; serial number (≤16 characters); date; recipient details; description; advance amount; rate and amount of tax; place of supply for inter-State supplies; reverse-charge flag; signature. Proviso: if the rate is not determinable, tax at 18%; if the nature of supply is not determinable, treat it as inter-State.
- **Section 31(3)(e) and Rule 51.** If no supply is made and no invoice issued, the supplier may issue a refund voucher. It must reference the receipt voucher and state the refund and tax amounts.
- **Proforma.** CGST law does not mention a "proforma invoice", so it is not a GST document. It carries no tax liability and is not reported. It must never be titled "Tax Invoice" (secondary consensus; no CBIC text found).

**Practical flow for a small services firm (matches the planned design).**
1. **Proforma / payment request** (`TH/PI/...`). It shows the amount, GST estimate and payment link, and is clearly marked "This is not a tax invoice".
2. **Payment received.** Automatically issue a **Tax Invoice for the amount received**, grossed up as taxable + GST so that the receipt equals the invoice total. Also issue a **Payment Receipt** (non-GST acknowledgement). The time of supply is the payment date, so the GST goes in that period's GSTR-1 and GSTR-3B.
3. **Balance billing.** On completion, issue a Tax Invoice for the remainder. Each invoice covers its own portion, per the "to the extent" explanation in s.13.
4. **Cancellation after an advance invoice.** Issue a credit note within the s.34 time limit and refund. After the limit, the GST cannot be recovered (see §6).

**Why the tax-invoice-on-receipt mode is the default.** An invoice issued before the service is permitted (s.31(2) says "before or after"). It avoids GSTR-1 Table 11A/11B (advances and their later adjustment). The client gets its ITC document straight away.

**Alternative (setting `advance_mode = receipt_voucher`).**
- Issue a Receipt Voucher with tax, reported in Table 11A.
- Issue the Tax Invoice on completion, adjusting the advance in Table 11B.
- Issue a Refund Voucher if the job is cancelled.
- This mode is better when the scope or rate is uncertain at the time of the advance. It costs more reporting work.

**Exports under LUT.**
- Advances in foreign currency are zero-rated: the tax on the receipt voucher or invoice is nil.
- Print the LUT endorsement on the document.
- For refunds of unutilised ITC, Rule 89(4)(D) counts payments received in the period, plus advances from earlier periods whose supply was completed this period, minus advances whose supply is not yet completed. So the system should record the **service completion date** on every export invoice.
- FEMA: the 2026 Regulations govern advance receipts against exports. Track the advance against the later invoice for the bank's EDF/EDPMS reporting [?].

**Default (VERIFY WITH CA).** `advance_mode = tax_invoice` (configurable). The proforma template carries the "not a tax invoice" watermark. The payment receipt shows the linked invoice number. Also support the normal B2B pattern of **tax invoice first, then payment**: many Indian clients pay only against a tax invoice. Under that pattern GST is due on the invoice date even if the client has not paid.

**Open risks.** Whether "any other document" in s.31(3)(d) fully replaces the receipt voucher with a tax invoice is accepted practice, not a CBIC clarification I could find [?].

**Sources (checked 2026-10-06).**
- Section 13 CGST: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter4/section13_v1.00.html
- Rule 50: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule50_v1.00.html
- Rule 51: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule51_v1.00.html
- Rule 89: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter10/rule89_v1.00.html
- Section 31 CGST (see §3).

---

## 6. Credit notes (Section 34)

**Rule (CBIC current text).**
- **s.34(1)** allows "one or more credit notes for supplies made in a financial year" when: the taxable value or tax charged is too high; services are deficient; or (inserted by the Finance Act 2026, s.154, **commencement "yet to be notified"**) a post-supply discount under s.15(3)(b) is given.
- **s.34(2)** requires the credit note to be declared in the return for the month of issue, but **"not later than the thirtieth day of November following the end of the financial year in which such supply was made, or the date of furnishing of the relevant annual return, whichever is earlier"**.
- **New proviso (w.e.f. 1 Oct 2025, Finance (No. 7) Act 2025).** The supplier's output liability is **not reduced** if a registered recipient has not reversed the ITC attributable to the credit note. For an unregistered recipient, it is not reduced if the tax incidence was passed on to anyone else.
- **s.34(3)–(4).** A **debit note** (which includes a supplementary invoice) is issued when the value or tax was too low. There is no time limit beyond normal returns.
- **Rule 53(1A) contents.** Supplier details; nature of the document; serial number (≤16 characters); date; recipient details (with State name and code if unregistered); **serial number(s) and date(s) of the corresponding tax invoice(s)**; taxable value, rate and tax credited; signature.
- **GSTR-1 reporting.** Table 9B: **CDNR** for registered recipients; **CDNUR** for unregistered recipients against B2CL invoices and against exports. Credit notes against small B2C sales (B2CS) are netted in Table 7 [?]. Amendments go in Table 9C or through GSTR-1A.
- **IMS.** Since the October 2025 tax period, a recipient can mark a credit note "Pending" for one tax period and declare the ITC reversal amount (secondary sources on the GSTN advisory). Combined with the new proviso, the reduction in TecHaust's liability depends on the client accepting the credit note in IMS.

**Plain English.** A credit note must point to the original invoice. There is a hard yearly deadline: a credit note for an invoice issued in FY 2026-27 must be issued and reported by 30 Nov 2027 at the latest. For GST-registered clients, the GST is reduced only if the client accepts the credit note and reverses its credit.

**Default (VERIFY WITH CA).**
- One credit note per invoice by default; a multi-invoice credit note is optional.
- Compute and display `latest_cn_date = 30 Nov of (FY of the original invoice + 1)`. Block issue after that date. After the deadline, the only option is a commercial refund with no GST reduction.
- An optional field to record the client's IMS status: pending / accepted / rejected.
- Add a Debit Note type for upward corrections.

**Sources (checked 2026-10-06).**
- Section 34 CGST: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter7/section34_v1.00.html
- Rule 53: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule53_v1.00.html
- Secondary, IMS changes from Oct 2025: https://taxguru.in/goods-and-service-tax/gstn-advisories-october-2025-ims-updates-annual-returns-warehouse-registration-clarifications.html ; https://www.taxscan.in/top-stories/gstn-introduces-pending-option-for-credit-notes-and-itc-reversal-declaration-in-invoice-management-system-ims-1435215
- Secondary, Finance Act 2026: https://www.grantthornton.in/insights/articles/gst-on-intermediary-services/

---

## 7. Place of supply and tax type (domestic)

**Rule. Section 12(2) IGST Act** (the general rule; none of TecHaust's services fall under the special sub-sections 12(3)–(14)):
- (a) supply to a registered person: the place of supply is that person's location, i.e. the State of the GSTIN billed;
- (b) supply to anyone else: the recipient's location "where the address on record exists"; otherwise the supplier's location.

The supplier's location is West Bengal (19). Place of supply in WB → CGST 9% + SGST 9%. Any other State → IGST 18% (inter-State).

**State codes.** These are the first two digits of the GSTIN and the masters on the GST and e-invoice portals:

| Code | State / UT | Code | State / UT | Code | State / UT |
|---|---|---|---|---|---|
| 01 | J&K | 13 | Nagaland | 26 | Dadra & Nagar Haveli and Daman & Diu |
| 02 | Himachal Pradesh | 14 | Manipur | 27 | Maharashtra |
| 03 | Punjab | 15 | Mizoram | 29 | Karnataka |
| 04 | Chandigarh | 16 | Tripura | 30 | Goa |
| 05 | Uttarakhand | 17 | Meghalaya | 31 | Lakshadweep |
| 06 | Haryana | 18 | Assam | 32 | Kerala |
| 07 | Delhi | **19** | **West Bengal** | 33 | Tamil Nadu |
| 08 | Rajasthan | 20 | Jharkhand | 34 | Puducherry |
| 09 | Uttar Pradesh | 21 | Odisha | 35 | Andaman & Nicobar |
| 10 | Bihar | 22 | Chhattisgarh | 36 | Telangana |
| 11 | Sikkim | 23 | Madhya Pradesh | 37 | Andhra Pradesh |
| 12 | Arunachal Pradesh | 24 | Gujarat | 38 | Ladakh |

- 97 = Other Territory.
- In the e-invoice schema, exports use place of supply 96 and PIN 999999 (secondary).
- Codes 25 (old Daman & Diu) and 28 (old Andhra Pradesh) are legacy codes.

Verified on 2026-10-06 against the official e-way bill master (docs.ewaybillgst.gov.in/apidocs/state-code.html), which also lists 99 = Other Country. Implemented in `packages/core/src/gstin.ts`; codes 25 and 28 are kept as legacy (accepted but flagged, and hidden from state pickers).

**Default (VERIFY WITH CA).** Derive the place of supply from the client's GSTIN for B2B clients, and from the billing-address state for unregistered clients. Make "state" a required field. Tax type = `pos == 19 ? CGST+SGST : IGST`. Allow a manual override, with a logged reason.

**Sources (checked 2026-10-06).**
- Section 12 IGST: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chapterv/section12_v1.00.html
- Secondary, POS code 96 for exports: ClearTax e-invoice object docs (URL in §4).

---

## 8. Export of services, LUT, endorsement, realisation, Stripe and PayPal

**Definition: Section 2(6) IGST (CBIC text).** "Export of services" means a supply where:
- (i) the supplier is located in India;
- (ii) the recipient is located outside India;
- (iii) the place of supply is outside India;
- (iv) payment is received "in convertible foreign exchange or in Indian rupees wherever permitted by the Reserve Bank of India";
- (v) the supplier and recipient are "not merely establishments of a distinct person".

For TecHaust's services, the place of supply for a foreign recipient is the recipient's location (s.13(2) IGST).

**2026 change.** The Finance Act 2026 (s.157) **omitted s.13(8)(b) IGST** (intermediary services), reportedly from 30 Mar 2026. Intermediary-type work, such as arranging third-party vendors for a foreign client, can now qualify as an export (secondary: Grant Thornton).

**Zero-rating: Section 16 IGST.** Exports are zero-rated supplies (s.16(1)(a)). Since 1 Oct 2023 the law gives two routes:
- **s.16(3), LUT/bond route.** Supply without paying IGST, then claim a refund of unutilised ITC. Rule 96A requires a **Letter of Undertaking in FORM GST RFD-11 "prior to export"**.
- **s.16(4), pay IGST and claim a refund.** Allowed only for notified classes. Notification 01/2023-IT (31 Jul 2023) notified all goods and services except a list of goods, so **services may still use the IGST-paid route** (secondary: GSTGyaan).

**LUT practicalities.**
- File it on the GST portal: Services → User Services → Furnish Letter of Undertaking, signed with DSC or EVC.
- It is free, valid for **one FY**, and must be renewed every FY, ideally before 1 April.
- A late LUT can be condoned after the event under Circular 37/11/2018 (secondary: ClearTax), but do not rely on that.

**Mandatory endorsement (Rule 46 third proviso, current CBIC text).** Export invoices must carry, as the case may be:
- LUT route: **"SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX"**;
- IGST route: **"…ON PAYMENT OF INTEGRATED TAX"**.

In place of clause (e), the invoice must also show the recipient's name and address, the address of delivery, and **the name of the country of destination**. The shorter wording ("SUPPLY MEANT FOR EXPORT UNDER LETTER OF UNDERTAKING…") was the pre-27 Jul 2017 text. Use the current full text.

**Non-realisation: the GST consequence (Rule 96A(1)(b), as substituted by Notification 12/2024-CT).** Under the LUT, the exporter must pay IGST with interest (s.50) within 15 days after **one year from the invoice date, or the FEMA period including any RBI extension, whichever is later** (or any further period the Commissioner allows), if payment is not received in convertible foreign exchange (or INR where RBI permits).

**FEMA realisation period (RBI).**
- The **Foreign Exchange Management (Export and Import of Goods and Services) Regulations, 2026** (FEMA 23(R)/2026-RB, 13 Jan 2026) came into force on **1 Oct 2026**.
- As amended on **22 Sep 2026**, the realisation period for services is **9 months from the invoice date**, or **12 months** if invoiced or settled in INR.
- The January 2026 text had said 15 or 18 months. An earlier amendment (Nov 2025) to the 2015 regulations had also temporarily allowed 15 months.
- **New for services:** the exporter must furnish an **EDF (Export Declaration Form) to the AD bank "within 30 days from the end of month in which invoice … has been raised"**. Secondary sources say one EDF can cover a whole month and that software exports may file with the bank or STPI. EDF replaces the old SOFTEX form.
- Exports worth up to ₹10 lakh can be written off or reduced by the AD bank on the exporter's declaration (secondary).

So the effective GST deadline is about 12 months + 15 days, and the FEMA deadline is 9 months.

**Proof of realisation.**
- The GST refund rules (Rule 89(2)) require BRC/FIRC details for export of services. In practice, the bank's FIRC or e-FIRC, or a PA-CB's FIRA, plus the DGFT e-BRC (where an IEC exists) are used.
- **Stripe India (official pages):**
  - Stripe is **invite-only** in India.
  - Export payments must carry the customer's name, billing address and a service description, plus an RBI purpose code (P0802 software consultancy/implementation, or P0807 off-site software exports).
  - Payouts are in **INR**.
  - Standard Chartered Bank emails a **payment advice** for each export payout. Stripe says you "present the payment advice to your bank to obtain a … FIRC". **So Stripe does not itself issue a FIRA/e-FIRA**; the FIRC comes from your bank.
- **PayPal India (official page):** a free, automatically generated **Digital FIRA, weekly from Feb 2026** (monthly before that), downloadable at Reports → Tax → FIRA. It is kept for 12 months only, **so the billing system must archive it**. Custom FIRAs come through Citibank for a fee.
- Whether a PA-CB FIRA is accepted for GST refund purposes as a "FIRC" is accepted in practice and in some court rulings, but **not codified [?]**.
- Whether Stripe or PayPal currently hold full PA-CB authorisation is unclear from secondary sources [?].

**Gateway fees.**
- GST is charged on the full invoice value. The INR realised is lower after fees and the FX spread.
- Record the gross amount as realised, and the fee as an expense, with GST input credit where the gateway issues a GST invoice to TecHaust's GSTIN.
- Whether FEMA accepts the fee deduction as "full export value" without bank approval is a CA question [?].

**Default (VERIFY WITH CA).**
- Export Invoice series with `mode = LUT` by default; LUT ARN + FY required; endorsement auto-printed.
- Fields: country, client address, service-completion date, purpose code, payment rail (Stripe/PayPal/SWIFT), FIRA/FIRC/payment-advice number and file upload.
- Realisation tracker with 9-month and 12-month alerts.
- Monthly EDF export: client name, address, country, invoice number and date, currency, amount, SAC/description, amount realised.
- Option `mode = IGST_PAID` (IGST 18% charged; refund claimed later).

**Sources (checked 2026-10-06).**
- Section 2 IGST: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chapteri/section2_v1.00.html
- Section 13 IGST: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chapterv/section13_v1.00.html
- Section 16 IGST: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chaptervii/section16_v1.00.html
- Rule 96A: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter10/rule96a_v1.00.html
- Rule 46 (§3).
- RBI FEMA 2026 Regulations: https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=13277 (the page states 9 months for services and the EDF for services)
- RBI Directions (A.P. (DIR) Circular 20, 16 Jan 2026): https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=13278
- Secondary, 22 Sep 2026 amendment: https://www.niftytrader.in/markets/fema-rules-from-oct-1-rbi-keeps-export-deadline-at-9-months/ ; https://www.scconline.com/blog/post/2026/09/29/rbi-amends-fema-export-import-goods-services-regulations-2026/
- Secondary, EDF details: https://taxguru.in/rbi/rbi-export-declaration-form-edf-rules-export-services-1-october-2026.html
- Stripe: https://docs.stripe.com/india-exports ; https://support.stripe.com/questions/firc-payment-advice-for-international-transactions-in-india
- PayPal: https://www.paypal.com/in/business/firc-certificate ; https://newsroom.apac.paypal-corp.com/Digital-Foreign-Inward-Remittance-Advice
- Notification 01/2023-IT (secondary): https://gstgyaan.com/notification-no-012023-integrated-tax-dated-31-07-2023-section-164-of-igst-act
- Circular 37/11/2018: https://cbic-gst.gov.in/pdf/circularno-37-cgst.pdf
- Circular 125/44/2019: https://cbic-gst.gov.in/pdf/circular-cgst-125.pdf
- Secondary, LUT: https://cleartax.in/s/lut-letter-of-undertaking-gst
- Secondary, intermediary change: https://www.grantthornton.in/insights/articles/gst-on-intermediary-services/

---

## 9. Foreign-currency valuation (Rule 34)

**Rule (CBIC text, substituted by Notification 17/2017-CT).**
- **Rule 34(1), goods:** the rate notified by CBIC under s.14 of the Customs Act for the date of the time of supply.
- **Rule 34(2), services:** "the applicable rate of exchange determined as per the **generally accepted accounting principles** for the date of time of supply".
- The original 2017 text named the RBI reference rate. That reference was removed.
- **RBI reference rate:** since 10 Jul 2018 the USD/INR reference rate is computed by **FBIL** (Financial Benchmarks India Ltd). It is published every weekday except Mumbai bank holidays and shown on RBI's reference-rate page.

**Plain English.** For services, use any consistent accounting-standard rate for the date of the time of supply, which is usually the invoice date (or the advance receipt date). The FBIL/RBI reference rate is the most defensible and auditable choice. The CBIC customs rate is meant for goods. Any difference between the invoice-date INR value and the INR actually received is an FX gain or loss in the books, not a GST adjustment [?].

**Default (VERIFY WITH CA).**
- `fx_source = FBIL_REFERENCE`, `fx_date = time_of_supply_date`. If no rate is published that day, use the last published rate.
- Store `fx_rate` (6 decimals), `fx_source` and `fx_date` on the invoice. They are immutable after issue.
- Options: CBIC customs export rate, or the bank's TT buying rate.
- Show on the export invoice: "Exchange rate: 1 USD = ₹xx.xxxx (FBIL reference rate, dd-mm-yyyy); Taxable value ₹…".

**Sources (checked 2026-10-06).**
- Rule 34: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter4/rule34_v1.00.html
- RBI reference-rate page: https://www.rbi.org.in/Scripts/BS_DisplayReferenceRate.aspx
- FBIL: https://www.fbil.org.in
- RBI press release on the FBIL takeover (search result): https://www.rbi.org.in/commonman/english/scripts/PressReleases.aspx?Id=3111

---

## 10. Rounding

**Rule. Section 170 CGST:** "The amount of tax, interest, penalty, fine or any other sum payable, and the amount of refund … shall be rounded off to the nearest rupee". 50 paise or more rounds up; less is ignored. This governs amounts **payable** (returns and challans). It does not prescribe per-line invoice rounding.

**E-invoice tolerances (einvoice6 portal, validation rules).** The IRP computes line tax as taxable × rate. It accepts a submitted value within a band around the computed value (computed 2345.01–2345.99 → accepted 2344.00–2347.00). The invoice-level round-off (`RndOffAmt`) must lie between −99.99 and +99.99.

**Common practice.** Compute tax per line to paise, sum per tax head, and round the invoice grand total to the nearest rupee with a separate "Round off" line. Some firms round each tax head to whole rupees instead. Either approach passes IRP tolerances.

**Default (VERIFY WITH CA).**
- Integer paise everywhere. `line_tax[head] = round_half_up(taxable_paise × rate_bp / 10000)` per head.
- CGST and SGST are computed separately at 9% each, so they are always equal. Never compute 18% and split it.
- Invoice totals are sums of the line values.
- `grand_total = round_to_nearest_100_paise(taxable + taxes)` with a `round_off` line in the range −49 to +50 paise. The setting `round_grand_total` defaults to on for INR invoices.
- Export (foreign-currency) invoices: work in integer cents; no rounding to whole USD. The INR equivalent is computed to paise from the stored rate.
- Returns export: the values as on the documents. Section 170 rounding applies at challan/return level, which the portal handles.

**Sources (checked 2026-10-06).**
- Section 170 CGST: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter21/section170_v1.00.html
- E-invoice validations (dated 20 Aug 2023): https://einvoice6.gst.gov.in/content/validation-rules-for-e-invoicing-that-you-must-take-care-to-avoid-errors/

---

## 11. E-invoicing

**Rule.**
- Rule 48(4) applies e-invoicing to notified classes of taxpayer. **Notification 10/2023-CT (10 May 2023):** from 1 Aug 2023 it applies to taxpayers whose **aggregate turnover in any preceding FY from 2017-18 onwards exceeds ₹5 Cr**.
- It covers B2B supplies, **exports** (SupTyp EXPWP/EXPWOP), SEZ supplies, and credit/debit notes. It does not cover B2C.
- Under Rule 48(5), an invoice that should have been an e-invoice but wasn't **is not a valid invoice**.
- **"Aggregate turnover"** (s.2(6) CGST) is all taxable, exempt, export and inter-State supplies of all GSTINs **under the same PAN**, computed all-India, excluding taxes. For a proprietor, that means every GST registration under their PAN counts.
- **30-day reporting limit.** From 1 Apr 2025, taxpayers with **AATO ≥ ₹10 Cr** cannot report documents older than 30 days to the IRP. This does not apply below ₹10 Cr (einvoice6 advisory).
- **MFA.** Two-factor authentication is mandatory on the e-invoice/e-way-bill portals for all taxpayers from 1 Apr 2025. Reports also mention an IRP MFA registration requirement from 1 Feb 2026 (secondary) [?].
- **"3-year limit".** I could not verify a 3-year limit on reporting old e-invoices. The 3-year bar that exists applies to **filing returns** (see §12/§19) [?].
- **No threshold change.** I found no notification lowering the ₹5 Cr threshold as of Oct 2026. Discussion of ₹2 Cr is unconfirmed [?].
- **Checking AATO.** On einvoice1.gst.gov.in, use **Search → "e-Invoice Status of Taxpayer"** (enter the GSTIN) to see whether the GSTIN is enabled. On the GST portal, add up each FY's turnover from filed GSTR-3B/GSTR-9 (or the annual-return summary) for all GSTINs under the PAN, from FY 2017-18. Whether the portal shows a ready-made AATO figure for small taxpayers is unconfirmed [?].

**Default (VERIFY WITH CA).**
- `einvoice_enabled = false`.
- Settings: "AATO exceeded ₹5 Cr in any FY since 2017-18" (Y/N, with a yearly reminder each April) and "AATO ≥ ₹10 Cr" (enforces the 30-day limit).
- Build the data model so it can produce INV-01 JSON later: legal name, POS 96 for exports, document number regex.

**Sources (checked 2026-10-06).**
- Notification 10/2023-CT: https://www.gstcouncil.gov.in/node/4365
- Rule 48: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule48_v1.00.html
- Section 2 CGST: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter1/section2_v1.00.html
- 30-day advisory: https://einvoice6.gst.gov.in/content/revised-time-limit-for-e-invoice-reporting-for-businesses-with-aato-of-%E2%82%B910-crores-above/
- Portal: https://einvoice1.gst.gov.in/
- Secondary, MFA: https://tallysolutions.com/business-guides/what-changed-in-e-invoicing-compliance-in-2026/
- Secondary, threshold status: https://www.xflowpay.com/blog/e-invoice-limit

---

## 12. GSTR-1 / IFF, QRMP, GSTR-1A, and what to export

**Rule and practice.**
- **QRMP** is available if the PAN-based AATO is up to ₹5 Cr. Under it, GSTR-1 and GSTR-3B are quarterly. Tax is still paid monthly by PMT-06 challan for months 1–2 of each quarter.
- The **IFF** (optional, months 1–2) lets B2B invoices reach clients' GSTR-2B monthly. It is capped at ₹50 lakh of invoices per month.
- Monthly filers: GSTR-1 by the 11th, GSTR-3B by the 20th. Quarterly: GSTR-1 by the 13th after the quarter; GSTR-3B by the 22nd/24th depending on the State. West Bengal is believed to be in the 24th group [?].
- **GSTR-1A** (Notification 12/2024-CT, available from the July 2024 period): an optional one-time-per-period amendment after GSTR-1 and before GSTR-3B. For QRMP filers it is quarterly.

**Tables relevant to TecHaust.**

| Table | Content | Source documents |
|---|---|---|
| 4A | B2B supplies to registered persons (invoice-wise) | Tax Invoice with client GSTIN |
| 5 (B2CL) | Inter-State B2C invoices **> ₹1 lakh** (threshold cut from ₹2.5 lakh from Aug 2024, Notification 12/2024-CT) | Tax Invoice, unregistered, POS ≠ 19 |
| 7 (B2CS) | All other B2C supplies, net, by POS and rate | Tax Invoice, unregistered |
| 6A | Exports, WPAY/WOPAY, invoice-wise, INR value | Export Invoice |
| 9B | CDNR (registered) / CDNUR (unregistered B2CL and exports) | Credit/Debit Notes |
| 9A / 9C | Amendments | — |
| 11A / 11B | Advances received / adjusted (only if `advance_mode = receipt_voucher`) | Receipt Vouchers |
| 12 | HSN summary, **split into B2B and B2C tabs** (Phase III from the Apr 2025 period); HSN chosen from a dropdown; exports (6A) feed the **B2C** tab | All |
| 13 | Documents issued, per series (from, to, total, cancelled) | Counters |

**Offline Tool format.** The GST Returns Offline Tool (download at gst.gov.in/download/returns) imports the `GSTR1_Excel_Workbook_Template.xlsx` or **section-wise CSV files** and generates a **JSON** file for upload.

**Default (VERIFY WITH CA).**
- `return_frequency = QRMP`, with an IFF toggle.
- A period export producing (1) the offline-tool workbook sheets or CSVs (b2b, b2cl, b2cs, exp, cdnr, cdnur, at, atadj, hsn(b2b), hsn(b2c), docs) and (2) a reconciliation summary that should match GSTR-3B Table 3.1 (taxable, zero-rated) and 3.2 (inter-State to unregistered by State).
- Generating the JSON directly is a later phase.

**Sources (checked 2026-10-06).**
- QRMP FAQ: https://tutorial.gst.gov.in/userguide/returns/FAQs_change_profile.htm
- Secondary, GSTR-1A: https://taxguru.in/goods-and-service-tax/advisory-form-gstr-1a.html ; https://services.gst.gov.in/services/advisoryandreleases/read/506
- Secondary, B2CL ₹1 lakh: https://irisgst.com/10-major-gst-changes-as-per-gst-notification-12-2024/
- Secondary, Table 12: https://taxguru.in/goods-and-service-tax/gstn-implements-phase-iii-table-12-gstr-1-1a-april-2025.html
- Offline Tool: https://www.gst.gov.in/download/returns ; https://tutorial.gst.gov.in/downloads/invoiceuploadofflineutility.pdf

---

## 13. Record retention

**Rule.**
- **Section 36 CGST.** Keep books and records "until the expiry of **seventy-two months from the due date of furnishing of annual return** for the year". Keep them longer while an appeal, proceeding or investigation is pending. Example: for FY 2026-27, GSTR-9 is due 31 Dec 2027, so retain until 31 Dec 2033.
- **Rule 56(8).** Electronic records must log every edit or deletion.
- **Rule 57.** Electronic records are acceptable. Keep proper backups and be able to produce authenticated hard copies or readable files on demand.
- **Income tax.** The Income-tax Act 2025 (in force 1 Apr 2026) moved books-of-account rules to **s.62**. Secondary sources say **Rule 46(9) of the Income-tax Rules 2026** requires retention for **seven tax years from the end of the relevant tax year**, and that electronic books must be accessible in India with daily backups on servers in India [?]. The old Rule 6F said 6 years from the end of the assessment year.

**Default (VERIFY WITH CA).**
- `retention_years = 10` from FY end.
- No hard deletes of documents, payments or logs; soft-delete is not allowed for issued documents.
- An append-only audit log.
- Monthly encrypted backup. Keep **at least one copy on a server located in India** until the Rule 46(9) backup point is confirmed. This affects the choice of hosting region.

**Sources (checked 2026-10-06).**
- Section 36 CGST: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter8/section36_v1.00.html
- Rule 56 (§4).
- Rule 57: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter7/rule57_v1.00.html
- Secondary, IT Act 2025 s.62 and Rule 46: https://www.caclubindia.com/news/maintenance-of-books-of-accounts-under-income-tax-act-2025-26756.asp ; https://www.incometaxindia.gov.in/w/section-62-134 (seen in search only)

---

## 14. Sole-proprietor supplier details

**Rule.** Rule 46(a) needs the supplier's "name, address and GSTIN".
- A proprietor's GST registration has a **Legal Name**, which is the proprietor's name as per PAN, and an optional **Trade Name** ("TecHaust Technologies").
- The e-invoice schema makes `LglNm` mandatory and `TrdNm` optional (secondary).
- The address should be the **principal place of business as registered** (Balurghat). Use an additional place of business only if it is registered and is the place the service is supplied from.

**Default (VERIFY WITH CA).** Header layout:
- **TecHaust Technologies** (trade name)
- "Proprietor: ⟨Legal name exactly as on the GST certificate⟩"
- GSTIN, registered address with PIN, "State: West Bengal, Code: 19"
- Optional: PAN, email, phone

Pull these values from one settings record that matches the GST certificate. An address change must be made on the GST portal first.

**Sources (checked 2026-10-06).**
- Rule 46 (§3).
- ClearTax e-invoice object (§4, secondary).

---

## 15. Reverse charge

**Rule.** RCM on services applies only to the services notified under s.9(3) CGST / s.5(3) IGST (Notifications 13/2017-CTR and 10/2017-ITR), such as GTA, legal services and director services. IT and software services supplied by TecHaust are **not** on those lists, so TecHaust's outward supplies are under forward charge. Rule 46(p), 50(j) and 51(j) require every tax invoice, receipt voucher and refund voucher to state **whether tax is payable on reverse charge**.

**Default (VERIFY WITH CA).** Print "Tax payable on reverse charge: No" on every GST document; it is a fixed field.

**Inward side (see §19).** Services TecHaust **imports** (foreign SaaS, foreign freelancers) are generally taxable under RCM for a registered recipient (s.5(3) IGST, Notification 10/2017-ITR entry 1) [?].

**Sources (checked 2026-10-06).**
- Rules 46, 50, 51 (CBIC URLs above). The RCM notifications themselves were not re-fetched in this session [?].

---

## 16. B2C invoices to unregistered domestic clients

**Rule.**
- **B2C dynamic QR code** (Notification 14/2020-CT, 21 Mar 2020; from 1 Dec 2020): only for taxpayers with **AATO > ₹500 Cr**. **Not applicable** to TecHaust.
- Rule 46(e): for unregistered recipients, name, address, delivery address and **State name and code** are mandatory when the value is **₹50,000 or more**.
- Rule 46(f): below ₹50,000, the same details are included on request. They are mandatory at any value for OIDAR or e-commerce supplies.

**Default (VERIFY WITH CA).** B2C client records require name and state always. Address is required when an invoice is ≥ ₹50,000; the system blocks issue without it. B2C QR is off.

**Sources (checked 2026-10-06).**
- Rule 46 (§3).
- B2C QR (einvoice6 article): https://einvoice6.gst.gov.in/content/e-invoice-b2c-qr-code-applicability-penalty-contents-generation-exemption-list/
- Secondary: https://taxguru.in/goods-and-service-tax/applicability-dynamic-qr-code-b2c-invoices.html

---

## 17. Payment-gateway rules that affect invoicing

**PA-CB.** The RBI **Master Direction on Regulation of Payment Aggregators (15 Sep 2025)** consolidated the earlier PA/PG and PA-CB circulars. Secondary sources state:
- a **₹25 lakh per-transaction cap** on PA-CB transactions, applying to both export and import;
- PA-CBs must give the AD bank the exporter's documents for **EDPMS** flagging;
- non-INR settlement is allowed only for directly onboarded Indian exporters.

I did not fetch the RBI text itself [?].

**UPI MDR (verified as real).** NPCI's FAQ, "Merchant Discount Rate (MDR) on Select UPI (P2M) Transactions", dated **15 Sep 2026**, says:
- From **15 Oct 2026**, an MDR of **0.4%** applies to person-to-merchant UPI payments **above ₹2,000**, **capped at ₹300** for payments of ₹75,000 and above.
- P2P transfers and payments up to ₹2,000 have zero MDR.
- Small merchants under P2PM (up to ₹1 lakh/month) have zero MDR.
- Railways, telecom, insurance and fuel pay a flat ₹5. Capital-markets payments pay 0.02% (capped at ₹300).
- UPI AutoPay mandates carry no prescribed MDR. Credit-line/RuPay-credit UPI follows card rules.
- **"Merchants … cannot pass on MDR charges to customers"** (Q34).
- The parameters are set by the UPI Steering Committee headed by NPCI. Secondary sources mention a Finance Ministry gazette of 14 Sep 2026 [?]. GST at 18% presumably applies to MDR, as for other bank charges [?].

**Impact on billing.**
- No "UPI convenience fee" line is allowed.
- Gateway fees and MDR are absorbed, as planned. Record them as expenses with ITC.
- For recurring care plans, prefer UPI AutoPay mandates where the gateway supports them, since they carry no prescribed MDR.
- Warn when a Stripe/PayPal export payment is > ₹25 lakh; split it or use SWIFT.

**Sources (checked 2026-10-06).**
- NPCI FAQ PDF: https://www.npci.org.in/uploads/FA_Qs_Merchant_Discount_Rate_MDR_on_Select_UPI_P2_M_Transactions_58dba1d39e.pdf
- Secondary: https://www.scconline.com/blog/post/2026/09/16/npci-released-upi-mdr-faqs-explained/
- Secondary, PA directions: https://indiacorplaw.in/2025/10/09/decoding-rbis-overhaul-of-the-payment-aggregator-directions/ ; https://www.winvesta.in/blog/businesses/rbis-25-lakh-cap-on-cross-border-payments-what-to-know

---

## 18. TDS deducted by clients (Income-tax)

**Rule.**
- From 1 Apr 2026 the **Income-tax Act, 2025** replaced the 1961 Act. The old **s.194J** (fees for professional or technical services) is now in **s.393(1)** (Table, Sl. 6(iii).D).
- Secondary sources say the rates and thresholds are unchanged: **2%** for fees for technical services, **10%** for professional services and royalty, with a ₹50,000 threshold [?].
- Clients often treat software development as technical services (2%) or royalty/professional (10%). TecHaust cannot control which they choose.
- The old CBDT Circular 23/2017 said TDS is not deducted on the GST component when GST is shown separately. Whether this carries over to s.393 is unconfirmed [?].

**Default (VERIFY WITH CA).**
- On a payment, add an optional "TDS deducted by client" line: section (default "393(1) / old 194J"), rate (editable; 10% or 2%), and amount.
- `amount_received + tds = amount_settled`. The invoice is marked paid when the settled amount equals the invoice total.
- Post TDS to a **TDS Receivable** ledger and reconcile it quarterly with Form 26AS/AIS. TDS does **not** change the GST invoice or the GST liability.

**Sources (checked 2026-10-06).**
- Secondary: https://blog.tdsman.com/2026/07/tds-on-fees-for-professional-and-technical-services-section-3931-194j/ ; https://cadialogue.in/tds-professional-fees-section-393-tax-year-2026/

---

## 19. Other things the billing system must get right in 2026

1. **GSTR-3B hard-locking (from the July 2025 period).** Outward liability (Tables 3.1/3.2) is auto-populated from GSTR-1/IFF/1A and **cannot be edited** in GSTR-3B. Any GSTR-1 error must be fixed in GSTR-1A before 3B is filed. So the GSTR-1 export must be right first time. Hard-locking of ITC (Table 4) is reported as the next phase [?].
2. **3-year bar on returns.** From the July 2025 period, the portal blocks filing any return (GSTR-1, 3B, 9 and others) more than 3 years after its due date. Alert on any unfiled period.
3. **IMS.** TecHaust's B2B invoices appear in clients' IMS, where clients accept, reject or keep them pending. A client's rejection does **not** reduce TecHaust's liability on an invoice. For credit notes, the client's acceptance and ITC reversal now decide whether TecHaust's liability falls (s.34(2) proviso, §6). Expect clients to ask for corrections; handle them by CN/DN, never by editing.
4. **E-way bill: N/A.** It applies only to movement of goods. No pure services transaction needs one.
5. **Debit notes and supplementary invoices.** These are required for upward changes (s.34(3)) because issued invoices are immutable. Add the document type.
6. **Inward RCM on imported services.** Foreign tools, cloud services and contractors billed to TecHaust's GSTIN are generally an "import of services" taxable under RCM (IGST 18%, credit available). Section 31(3)(f) requires a **self-invoice** for supplies from unregistered suppliers, and Rule 47A sets 30 days. Section 31(3)(g) requires a **payment voucher**. Whether a self-invoice is needed for imports is debated [?]. Provide an optional "Self-invoice (RCM)" + "Payment voucher" series and a purchase register feeding GSTR-3B Table 3.1(d).
7. **Gateway and bank invoices.** Capture Stripe/PayPal/bank/UPI-MDR GST invoices to claim ITC. Without the vendor's GST invoice, no ITC.
8. **Post-sale discounts.** Finance Act 2026 amended s.15(3)(b) and s.34(1) for discounts given through credit notes with ITC reversal by the recipient, removing the need for a prior agreement. Commencement is not yet notified at the time of checking. Keep a "discount credit note" reason code ready.
9. **57th GST Council (7/8 Oct 2026).** Its agenda covers process reforms (ITC, registration, invoice matching). **Re-check this appendix after the meeting.**
10. **Foreign clients' tax IDs.** Not required by GST, but store the client's tax ID and country code. The ISO 3166 alpha-2 code is needed by Stripe and useful for EDF.
11. **Time-of-supply date versus document date.** Store both. For the tax-invoice-on-advance mode they are equal. For invoices raised late (after the 30-day window), the time of supply is the earlier of the service date and the payment date.
12. **ITC refund for exporters.** Under LUT, input GST accumulates. Rule 89 refund claims (RFD-01) need invoice-wise export data and FIRC/FIRA details per invoice. The realisation tracker should produce "Statement 3".

**Sources (checked 2026-10-06).**
- Secondary, hard-locking and 3-year bar: https://cleartax.in/s/hard-locking-in-gstr-3b ; https://cleartax.in/s/gst-return-filing-rule-changes-from-july-2025
- Section 31 CGST (§3).
- Section 34 CGST (§6).
- Secondary, Finance Act 2026: https://www.grantthornton.in/insights/articles/gst-on-intermediary-services/
- Secondary, 57th Council: https://taxguru.in/goods-and-service-tax/57th-gst-council-meeting-registration-itc-process-reforms-focus.html

---

## Where the planned design needs adjusting (summary)

| Planned | Finding | Suggested change (VERIFY WITH CA) |
|---|---|---|
| Document types: Tax Invoice, Export Invoice, Credit Note, Receipt, Proforma | Upward corrections need a **Debit Note** (s.34(3)). The optional receipt-voucher mode needs **Receipt** and **Refund Vouchers** (Rules 50/51). RCM imports may need **Self-invoice** and **Payment Voucher**. | Add DN (now), plus RV/RF/SI/PV (behind settings) |
| "Receipt (per payment)" | A plain payment acknowledgement is not a GST document. A Rule 50 receipt voucher is. | Title it "Payment Receipt", show "Not a tax invoice", link the invoice. Never call it "Receipt Voucher". |
| Proforma → payment → tax invoice | Fine for advances. Many B2B clients pay only against a tax invoice. | Also support invoice-first (credit terms) |
| Export flow | **New FEMA 2026 regime from 1 Oct 2026**: services realisation is **9 months** (not 15), plus a **monthly EDF filing** with the bank | Realisation tracker + EDF export |
| Stripe as export rail | Stripe gives only an SCB payment advice; the FIRC comes from your bank. Stripe is invite-only in India. PayPal gives a free weekly FIRA, kept for 12 months only. | Store and upload FIRA/FIRC per receipt; archive PayPal FIRAs monthly |
| Invoices immutable | Correct. Also matches Rule 56(8)'s edit-log requirement. | Keep; add an append-only audit log |
| Credit notes | Hard deadline of 30 Nov after the FY. Liability reduction depends on the client's ITC reversal (since 1 Oct 2025). | Deadline guard + IMS status field |

---

## Questions a CA should confirm in a 1-hour review

1. Is our AATO (PAN-level, all GSTINs, every FY since 2017-18) definitely ≤ ₹5 Cr, so that e-invoicing is off and 4-digit HSN is the minimum? Should we still print 6-digit SAC?
2. Do you agree with the SAC mapping (998314 build, 998313 consulting/AMC/fractional CTO, 998315 hosting, 998316 managed infra, 997331 vs 998315 for our SaaS/licence)?
3. For advances, is issuing a **tax invoice on receipt of payment** (instead of a Rule 50 receipt voucher) acceptable for us? Is there any downside if a project is later cancelled after the 30-Nov credit-note cut-off?
4. Are our retainers, care plans and dev subscription "continuous supply of services" under s.31(5)? Is invoicing on or before each due date correct?
5. Is our LUT for **FY 2026-27** filed? If not, how should exports invoiced since 1 Apr 2026 be treated (Circular 37/11/2018 condonation, or pay IGST)?
6. Which exchange rate should we use for export invoices: the FBIL reference rate on the invoice date, the CBIC customs rate, or the bank TT rate? How should we book realisation differences?
7. Does the **new FEMA 2026 EDF** requirement apply to us for every export invoice, including Stripe/PayPal receipts? Do we need an IEC? Which bank and portal do we file with, and in what format?
8. Are Stripe's SCB payment advice (plus a bank FIRC) and PayPal's weekly Digital FIRA acceptable proof of realisation for GST refunds and FEMA? Is a realised amount net of gateway fees treated as "full export value"?
9. How should we handle an export invoice not realised within 9 months (FEMA) or 12 months + 15 days (Rule 96A)? What should the system do (alert, auto-compute IGST + interest)?
10. For credit notes to B2B clients after 1 Oct 2025, what process do you want for confirming the client's ITC reversal and IMS acceptance before we reduce our GSTR-1/3B liability?
11. Should we file monthly (with IFF) or under QRMP? Is the Offline-Tool CSV/Excel set (b2b, b2cl, b2cs, exp, cdnr, cdnur, hsn b2b/b2c, docs) all you need from us each period?
12. Do we need to self-invoice and pay IGST under RCM on imported services (foreign SaaS, cloud, contractors)? Should we keep a separate SI/PV series?
13. Which TDS section and rate do clients usually apply to our services under s.393 of the Income-tax Act 2025 (2% or 10%)? Should TDS be computed on the value excluding GST?
14. Under the Income-tax Rules 2026, what is the exact books retention period, and must our electronic books be backed up on servers physically in India?
15. Should the invoice show the proprietor's legal name, the trade name, or both? Is our registered address on the GST certificate the one that must appear?
