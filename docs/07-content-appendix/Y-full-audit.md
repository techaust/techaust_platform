# 07-Y: wording from the full audit (for the owner's approval)

Status: **PENDING the owner** (drafted by the lead, 2026-10-29). Every line below shows "[Placeholder]" on screen until you approve this page. Then one switch per app (`APPROVED_07Y`) removes the marks.

**How to answer:**
- "Approve all";
- or "Approve all except N, M", giving your wording for those;
- or "Change N to …".

The text after each number is my recommendation. `{…}` is filled in by the app.

---

## A. Proposal terms (a new terms version; documents already sent keep theirs)
1. **Ownership** (you chose the interim wording; the lawyer reviews it later): "3. **Ownership.** On full payment, we assign to you all copyright in the work we make under this proposal, worldwide and for its full term; the assignment does not lapse if unused. Our pre-existing tools and third-party or open-source parts are licensed to you, not assigned. We keep the right to reuse general know-how."
   - The last sentence carries over from today's text. Today's "which we list in this proposal" is dropped, because no proposal has such a list.
2. **GST line** (you chose it): "GST at 18 % is added unless the work is an export of services under our Letter of Undertaking."

## B. Website
3. **/work**, while there is no case study yet: hide the line above the empty state, so the page shows only the empty state ("Ask us for a sample discovery report or architecture document."). Recommended: **hide**.

## C. Admin: dashboard, leads, clients, projects
4. **Dashboard foot line:** "Collected figures and payments waiting for checks arrive with payments." (Today's line repeats itself.)
5. **Convert a lead**, country list: "Choose a country". The error: "Choose the client's country."
6. **Lead answers:**
   - "Choose a currency first.";
   - on a website lead: "These answers came from the website form and can't be changed."
7. **Client figures:**
   - "Billed to date";
   - its hint: "Invoices and debit notes, GST included.";
   - "Credit notes";
   - link: "Open the statement".
8. **Project notes, help line:** "You can use # headings, **bold**, *italic*, lists and links."
9. **Time page, the week grid's name for screen readers:** "Hours by day".

## D. Admin: proposals, estimates, templates, catalogue
10. **Send refused, series full:** "This series has run out of numbers for the year. Change the numbering format in Settings › Numbering."
11. **Template rules:**
    - "{placeholder} can't go in a heading. Put it in the text of its own section."
    - "{placeholder} can only go in the text of the {section} section."
    - "A proposal or estimate has room for 3 sections of your own. This one and the ones after the third are joined into one, which would pass 6,000 characters. Shorten them or remove some."
    - "This version was saved before the template rules below. Drafts made from it may not save. Edit it and save a new version."
12. **Catalogue › Publish refused:**
    - above the list: "The prices can't be published: some text the website would show breaks its content rules. Fix the fields listed below."
    - each line, "{field}: …":
      - "uses "&". Write "and"."
      - "uses "{phrase}", which the website never says."
      - "types an amount of money. The website takes prices only from the price fields."
      - "uses a straight apostrophe ('). Type a curly one (’) instead."
      - "uses "{{", "}}", "**" or an arrow, which the website can’t show. Remove them."
    - field names:
      - "Name"
      - "Unit"
      - "Payment schedule, step {n}"
      - "Line {n} description"
      - "Line {n} unit"
      - "Build schedule, instalment {n}"
    - fallbacks: "Field {path}", "breaks a content rule."
13. **Estimates worded as proposals** (three places: the binding sentence, the acceptance email, and a repeat of the accept notice): use "estimate" whenever the document is an estimate, e.g. "Links to the accepted estimate and the acceptance certificate are below." No other change.
14. **"Proposal sent" email:** "Hi {{first_name}}, your proposal is ready, with the price and payment schedule. It's valid until {{valid_until}}." Today's line says it covers scope and timeline even when those sections are hidden.

## E. Admin: invoices, notes, reports, settings
15. **GST export, when a note needs a hand entry** (instead of "No errors"): "{n} documents checked. 1 note needs its tax entered by hand before you file." With more than one note: "… {k} notes need their tax entered by hand before you file."
16. **The warning card:** "{number} ({GSTIN or "unregistered client"}) is a debit note that adds tax only. The files show it with a taxable value of 0.00 and no tax column, so its tax may not come through on import. Enter by hand: {the table of tax per rate}. Ask your CA how to report it in Table 9B."
    - For a credit note: "is a credit note that reduces tax only".
    - For a B2C note the last sentence is "Ask your CA how to report it."
17. **Statement:** "Debit note against {number}".
18. **Notes on an invoice:** "Balance due: {balance} (after 1 credit note)" / "(after {n} credit notes)".
19. **Totals:**
    - "Line discounts";
    - "Discounts (lines and document)";
    - "Document discount" stays as it is.
20. **Proformas from now on:** "CGST (estimate)", "SGST (estimate)", "IGST (estimate)" (screen and PDF). Older proformas print as before.
21. **Supplier copy:**
    - "The supplier copy is made after the client's PDF, which isn't ready yet. Use Try again on the PDF if it is taking longer than usual."
    - for an anonymised client: "No supplier copy was made before this client was anonymised, and none can be made now."
22. **Settings › Tax:**
    - "Default SAC for custom lines";
    - hint: "A new line that is not from the catalogue starts with this SAC. Leave it empty to enter one on each line.";
    - error: "The default SAC has 6 digits, or leave it empty."
23. **Settings › Tax, LUT list:** "Not saved yet".
24. **Settings › Numbering, clash:** "Numbers in this series could be the same as in the {series label} series. Give each series its own letters."
25. **Settings › Signature:**
    - "Use a PNG or JPEG image up to 256 KB."
    - "We made the image smaller to fit 800 by 400 pixels."
    - "This image is too detailed to keep as a signature. Use a scan on a plain white background."
26. **Bell when a PDF keeps failing:** "The PDF of {number} couldn't be made on 3 days, so the nightly retry has stopped. A developer needs to look at it."

## F. Audit log, action names
27. **Documents:**
    - "sent a document again"
    - "revoked a document's links"
    - "asked for a document's PDF again"
    - "viewed a proposal or estimate"
    - "accepted a proposal or estimate"
    - "declined a proposal or estimate"
    - "opened a proposal or estimate from an email link"
28. **Signature:**
    - "changed the signature image"
    - "removed the signature image"
29. **Invoices:**
    - "created an invoice draft"
    - "changed an invoice draft"
    - "discarded an invoice draft"
    - "issued an invoice"
    - "issued a care plan invoice automatically"
    - "issued a tax invoice for a payment received"
    - "voided an invoice"
    - "drafted a credit or debit note"
    - "recorded a client's IMS response"
    - "set the date the service was completed"
    - "sent an invoice"
    - "revoked an invoice's links"
    - "asked for an invoice's PDF again"
    - "paused payment reminders"
    - "resumed payment reminders"
    - "drafted a care plan invoice"
    - "could not issue a care plan invoice automatically"
30. **Settings › Tax audit field:** "Default SAC for custom lines".

## G. Client portal
31. **Accepting an older version while a newer one is being made:** "This version can no longer be accepted: a newer one is being prepared."

---

**Also waiting for you:** 07-X ([X-m5-owner-fixes.md](X-m5-owner-fixes.md)), the M5 fix lines 1–30 plus lines 31–32. One answer can cover both pages.
