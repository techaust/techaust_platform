# 07-ZD: the credit-note deadline by filing frequency, the debit note's LUT, and IMS in the 3B helper (T1, T2, T3)

Status: **APPROVED by the owner, 2026-10-31** (all eight lines as drafted). Change a line here first, then in the code. Lines in `{braces}` are filled in by the screen. Staff-facing. These lines replace the 07-T §4 banner lines that named "30 November" and "Talk to your CA".

1. Settings › Tax: label "GSTR-1 filing"; options "Quarterly (QRMP scheme)", "Monthly"; hint "Sets the last day for credit notes on last year's invoices: 31 October for GST-registered clients, and 30 September for other clients if you file quarterly."
2. Note banner, before the deadline: "Issue any credit note for this invoice by {last day}, so it goes into a GST return filed by {cutoff date}."
3. Note banner, quarterly basis line: "This client isn't GST registered, so the note goes in your quarterly GSTR-1, not a monthly IFF."
4. Note banner, warning: "Only {days} days left to issue a credit note on this invoice."
5. Note banner, after the deadline: "The last day for a credit note on this invoice was {last day}. A refund now can't reduce the GST already paid."
6. Issue blocker `debit_lut_missing`: "This debit note is dated in FY {fy} and the invoice was exported under LUT. Save your LUT for FY {fy} in Settings › Tax first."
7. GSTR-3B summary CSV (layout v2), the held row: "Credit notes to registered clients not yet accepted in IMS (not deducted)"
8. Reports › GSTR-3B panel: "{count} credit notes aren't deducted until your client accepts them in IMS. Check the GST portal's GSTR-3B figures before you file."
9. Settings › Tax, the "Credit note cut-off" hint (replaces the earlier one): "Credit notes on last year's invoices are blocked after the last GST return period that ends before this date (see GSTR-1 filing below)." (Lead, 2026-10-31, staff-only wording under the owner's delegation.)

Singular forms (lead, 2026-10-31): line 4 "Only 1 day left to issue a credit note on this invoice."; line 8 "1 credit note isn't deducted until your client accepts it in IMS. Check the GST portal's GSTR-3B figures before you file."
