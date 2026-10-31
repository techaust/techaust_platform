# 07-ZC: the signature rule and the Udyam number (T4, T10)

Status: **APPROVED by the owner, 2026-10-31** (all six lines as drafted). Change a line here first, then in the code. Lines in `{braces}` are filled in by the screen or the PDF. Staff-facing except line 6, which prints on the client's tax invoice.

1. Issue blocker (`signature_missing`): "Add the signature in Settings › Company. Credit notes, debit notes and invoices for a payment received always carry it."
2. Settings › Company, signature hint: "Credit notes, debit notes and invoices for a payment received always carry the signature. Other invoices you send electronically don't need one (GST Rule 46). If you add one, it prints above "Authorised signatory"."
3. Settings › Tax, the signatory switch, an added line: "This switch covers tax invoices, export invoices and proformas only."
4. Settings › Company, the Udyam field: label "Udyam registration number"; hint "Printed on tax invoices. Leave it empty to leave it off."; error "Enter the number as UDYAM-XX-00-0000000."
5. Settings › Company, the category field: label "Enterprise category"; options "Micro enterprise", "Small enterprise", "Medium enterprise".
6. On the tax invoice PDF and its on-screen paper, under the GSTIN line: "Udyam Registration No. {number} ({category})", where `{category}` is the option's words from line 5 (owner's wording of 2026-10-30: "Udyam Registration No. … (Micro enterprise)").
7. Staff bell when jobs refuses the PDF of a document issued without the signature (`pdf.refused`, only older staging documents): "The PDF of {label} wasn't made because it was issued without the signature. Credit notes, debit notes and invoices for a payment received always carry it. A developer needs to look at it." (Lead, 2026-10-31, under the owner's delegation for staff-only wording; the owner may change it.)
