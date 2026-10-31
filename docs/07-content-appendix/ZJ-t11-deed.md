# 07-ZJ: the deed of assignment's screens, bells and email (T11)

Status: **PENDING the lead's approval** (designer's draft, 2026-11-01). The owner delegated every line here to the lead (owner, 2026-11-01, "You approve them"); staff lines are the lead's under the standing delegation. Change a line here first, then in the code. Lines in `{braces}` are filled in by the screen, the email or the PDF. Until approved, the admin and the portal show each line after a "[Placeholder]" mark (`APPROVED_07ZJ` in `apps/admin/src/lib/copy-zj.ts` and `apps/portal/src/copy-zj.ts`; one switch each removes every mark). The deed's own text is 07-ZE's, word for word, and is not repeated here. No line claims a lawyer reviewed anything.

**(C)** = a client reads it (portal, email, PDF). **(S)** = staff only (admin, bells, audit log). Every line is "Recommended: as written" unless it says otherwise.

Words already approved elsewhere are reused and not repeated: "Draft", "Cancel", "Reason", the step-up code field, "Making the PDF…" and "We'll make the PDF again." (07-P §3), "Fingerprint" (07-P §3), "Open in the portal" (07 §8), "Questions? Just reply to this email." (07-ZE line 4), "All fields are needed unless marked optional" (06 §5.4), the anonymised-client notice (07-K), invoice type names (07-R).

## A. The PDF (C)
1. The signature sentence on the unsigned PDF ends with a full stop: "Signed by the assignor with an Aadhaar-based electronic signature (eSign): Rupak Sarkar, sole proprietor, TecHaust Technologies." with the empty space for the provider's signature below it (lead decision 5). The screens keep 07-ZE's full sentence with " · {eSign date and time} · {transaction ID}.".
2. Labels inside the Schedules (optional; the PDF prints the values without labels until approved, so no "[Placeholder]" is ever stored in a write-once PDF):
   - Schedule 1: "Deliverables", "Where it was delivered", "Delivered on".
   - Schedule 2: "Pre-existing tools", "Third-party and open-source parts".
   - **Recommended: approve.** Without them Schedule 1 is three loose paragraphs; with them it reads like the rest of the house documents.

## B. Portal: the accepted proposal or estimate page (C)
Shown only once the deed is signed; nothing for a draft, final or cancelled deed.
3. Card heading: "Deed of assignment".
4. Lead line: "We've signed the deed that assigns the copyright in this work to you."
5. Facts: "Deed number" {number}; "Signed with Aadhaar eSign on {date and time IST}"; "Transaction ID" {transaction ID}.
6. Button: "Download signed deed".
7. A failed download: "The signed deed couldn't be downloaded. Try again in a minute."

## C. The `deed.signed` email (C; from hello@, to each portal contact)
8. Subject: "Signed deed of assignment: {offer number} v{version}".
9. First paragraph: "Hi {first name}, we've signed the deed that assigns the copyright in the work under {proposal/estimate} {offer number} v{version} to you. It's on that {proposal/estimate}'s page in the portal, ready to download."
10. Facts: "Deed number" {number}; "For" "{Proposal/Estimate} {offer number} v{version}".
11. Button: "Open in the portal" (07 §8, reused). Then: "Keep a copy with your records. Questions? Just reply to this email."
12. Settings › Email, the template's name: "Signed deed ready (client)".

## D. Admin: the project's Deed tab (S)
13. Tab: "Deed". Heading: "Deed of assignment". Loading: "Loading the deed".
14. States (chip and the three-step rail): "Draft", "Final", "Signed", "Cancelled"; with no deed: "No deed yet".
15. The one line under the heading, by state:
    - no deed, not qualifying: "A draft deed is prepared when the project is completed and paid in full."
    - no deed, qualifying (a project completed before deeds existed): "This project qualifies. Check again to prepare the draft deed."
    - draft: "Fill in both Schedules, read the deed, then finalise it."
    - final: "Sign the PDF on your eSign provider's website, then upload the signed copy here."
    - signed: "Signed. The client can download it from the {proposal/estimate}'s page in the portal."
    - only cancelled drafts: "The draft was cancelled. Check again to prepare a new one if the project still qualifies."
16. Paid in full, heading "Paid in full"; rows "Accepted {proposal/estimate} total", "Credit notes", "Owed", "Paid, including TDS", "Still to pay"; the state "Paid in full" / "Not paid in full yet".
17. Why there is no deed yet (the blockers, one line each):
    - `not_completed`: "The project isn't marked Completed."
    - `no_accepted_source`: "The project wasn't started from an accepted proposal or estimate."
    - `client_anonymised`: "This client's details were erased."
    - `care_plan`: "Care-plan work doesn't get a deed."
    - `no_invoices`: "No issued invoice is linked to this project yet."
    - `balance_due`: "An invoice still has a balance to pay."
    - `short_paid`: "The payments haven't reached the amount owed yet."
    - `nothing_paid`: "Nothing has been paid on this project's invoices."
18. Invoices counted: heading "Invoices counted"; columns "Invoice", "Total", "Paid", "Credit notes", "Balance"; a row in another currency: "Not counted: in {currency}"; under the table: "Only invoices issued against this project's milestones are counted." With none: "No issued invoice is linked to this project yet." (line 17).
19. Schedules form: headings 07-ZE's "Schedule 1, the work" and "Schedule 2, not assigned"; fields and hints:
    - "Deliverables", hint "One per line, as the client will read them."
    - "Where it was delivered", hint "For example a repository, a server or a handover."
    - "Delivered on", hint "Add a date for each delivery."; buttons "Add another date", "Remove {date}".
    - "Pre-existing tools", hint "Your own tools, libraries or templates used in the work."
    - "Third-party and open-source parts", hint "Each with its licence, for example Astro (MIT licence)."
    - Schedule 2's explicit none: button "None", and the hint "If there are none, choose None: a blank field can't be finalised."
    - Save: "Save Schedules"; saved: "Schedules saved."; unsaved: the existing unsaved-changes guard words.
    - A blank field when finalising: "Fill in this field, or choose None." (Schedule 2) / "Fill in this field." (Schedule 1).
    - A field longer than the database takes: "Use at most {n} characters."
20. Read the deed: heading "Read the deed"; on a draft: "This is how the deed reads today. Its values are fixed when you finalise it."; when it can't be filled yet: "The deed can be read once these are fixed:".
21. What stops a finalise (value problems):
    - `company_principal_place_missing`: "Add the principal place of business in Settings › Company."
    - `company_gstin_missing`: "Add the GSTIN in Settings › Company."
    - `offer_unreadable`: "The accepted proposal or estimate can't be read. A developer needs to look at it."
    - `schedules_blank`: "Fill in every Schedule field."
    - `made_on_invalid`: "Today's date couldn't be read. Reload the page and try again."
22. Finalise: button "Finalise deed"; dialog title "Finalise the deed"; body "This gives the deed its number, fixes its text and makes the PDF. A final deed can't be changed or cancelled."; confirm "Finalise deed"; done: "Deed {number} finalised. The PDF is being made."
23. The unsigned PDF: heading "Unsigned PDF"; "Download unsigned PDF"; the Owner's retry "Make the PDF again"; `pdf_done`: "This deed already has its PDF."
24. Upload the signed copy: heading "Upload the signed copy"; fields "Signed PDF" (hint "The PDF your eSign provider gave you, up to 10 MB."), "eSign date", "eSign time (IST)" (hint "24-hour, as the provider shows it, for example 14:05."), "Transaction ID" (hint "As the provider shows it."); button "Upload signed deed"; errors "Choose the signed PDF.", "Enter the eSign date.", "Enter the time as HH:MM, for example 14:05.", "Enter the transaction ID."; done: "Signed deed uploaded. The client's portal contacts are being emailed."
25. The signed copy: heading "Signed copy"; "Download signed PDF"; "Signed with Aadhaar eSign on {date and time IST}" (as line 5); "Transaction ID {id}"; "Uploaded by {name} on {date}"; "Finalised by {name} on {date}".
26. Cancel: button "Cancel draft"; dialog title "Cancel the draft deed"; body "The draft stays in this project's history with your reason. Check again can prepare a new one."; field "Reason" (empty: "Enter a reason for cancelling."); confirm "Cancel draft"; done "Draft deed cancelled."
27. Check again: button "Check again"; a draft made: "Draft deed prepared."; none made: "The project doesn't qualify for a deed yet." (the blockers then show why).
28. A final or signed deed whose project is no longer paid in full: "This project is no longer paid in full. The deed hasn't changed; check the project's payments."
29. History: heading "Cancelled drafts"; each row "Cancelled on {date} by {name}" and the reason below it.
30. Refusals the API returns (by code; the builder's words, kept unless noted):
    - `deed_not_draft`: "This deed is no longer a draft."
    - `deed_not_final`: "Only a finalised deed takes a signed copy."
    - `deed_not_eligible`: "The project isn't completed and paid in full."
    - `deed_values_missing`: "Some details the deed needs are missing." (the screen lists them, line 21)
    - `client_anonymised`: "This client's details were erased."
    - `series_full`: "The deed numbering series is full for this year."
    - `settings_changed`: "The company or numbering settings changed. Check the deed and try again."
    - `esign_invalid`: "Enter the eSign date and time and the transaction ID as the provider shows them." (also when the moment is in the future or before the deed was finalised)
    - `pdf_not_ready`: "The PDF isn't ready yet."
    - `file_too_large`: "The signed PDF can be up to 10 MB."
    - `file_type_not_allowed`: "Upload the signed deed as a PDF."
    - `stale_version`: "Someone changed this deed since you opened it. Reload to see the latest." (replaces the generic line on this tab)

## E. Bells and the audit log (S)
31. The Owner's bell when a draft is prepared: "Draft deed ready for {project code}: fill in the Schedules."
32. The Owner's bell when a deed's values fail their check (`pdf.refused`): "The PDF of deed {number} didn't match its saved copy, so it wasn't made. A developer needs to look at it." (the wording of the other documents' refusal bell)
33. Audit log: the group "Deeds", the record type "Deed"; actions:
    - `deed.draft` "prepared a draft deed"
    - `deed.recheck` "checked a project for a deed"
    - `deed.edit` "edited a deed's Schedules"
    - `deed.finalise` "finalised a deed"
    - `deed.sign` "uploaded a signed deed"
    - `deed.cancel` "cancelled a draft deed"
    - `deed.pdf_retry` "asked for a deed's PDF again"
