# 07-X: Lines for the M5 owner fixes (2026-10-29)

_Drafted by the designer of the M5 owner fixes task ([runs/m5-owner-fixes](../runs/m5-owner-fixes.md), D1 and D2) for the owner's decisions of 2026-10-28 (docs/13: an "Assumptions and exclusions" section with no Catalogue text is hidden and the draft says which service lacks it) and Q3 of 2026-10-29 (the same for Deliverables), and for sweep findings 7, 8 and 9. **PENDING the owner.** Until approved, each line shows on screen as "[Placeholder] " followed by the recommended words (`APPROVED_07X` in `apps/admin/src/lib/copy-x.ts` and `apps/portal/src/copy-documents.ts`; one switch each). Staff-facing unless marked. `{…}` is filled by the screen. Rules used: plain words, no `{{…}}` syntax on screen (the brief), "and" never "&", India/UK spelling, no banned phrases (07 §1.3)._

**Recommendation for every line: approve as written.** Where there is an alternative worth a look, it is given after "Or:".

## 1. What still stops a send (the Send panel, replaces 07-O's "These placeholders have no value yet: {list}. Fill them in before sending." and the panel's "Some placeholders have no value yet.")
1. Lead-in above the list: "Fill these in before sending:"
2. One item per place: "{place}: waiting for {values}." The place is a section's name (a link that opens the section and puts the cursor in its text), or "Title", "Lines" or "Payment schedule" (the editor's own labels). `{values}` is a list of §2's words joined with commas and "and". Without a known place: "Waiting for {values}." Example: "Acceptance: waiting for the contact's name."
   Or: "{place}: {values} still missing."
3. Inside an open section, above its text: "This text is waiting for {values}." (replaces the bare amber `{{…}}` tokens)
4. Fix beside a service value when the draft has no service line yet (moves the cursor to "Add from the catalogue"): "Add a service line"
5. Fix beside the contact's name when no contact is chosen (moves the cursor to "Send to"): "Choose a contact"

## 2. What each template value is called (used in §1)
6. `client.name`: "the client's name"
7. `client.contact`: "the contact's name"
8. `company.name`: "the company name"
9. `proposal.validity_days`: "the validity in days"
10. `service.code`: "the service code"
11. `service.name`: "the service name"
12. `service.short`: "the service summary"
13. `service.deliverables`: "the deliverables"
14. `service.assumptions`: "the assumptions"
15. `service.exclusions`: "the exclusions"
16. `service.schedule`: "the service's payment schedule"
17. A value typed by hand that the system doesn't know: "a value that can't be filled in"

## 3. Catalogue gaps (a note on the Send panel, and a margin note on the section itself)
18. A service with no text: "{service} has no {fields} in Catalogue." `{fields}` is "deliverables", "assumptions", "exclusions", or two or three of them joined with "and" (for example "assumptions and exclusions"). Example: "Custom Web Apps and Business Portals has no exclusions in Catalogue."
19. Catalogue has been filled in since the draft was made: "Catalogue now has the {fields} for {service}."
20. Why the section is hidden: "This section is hidden until it has text."
21. Link to the service's Catalogue page: "Add the text in Catalogue"
22. On a hidden section: shows it, opens it and puts the cursor in its text: "Write it here"
23. Button that adds Catalogue's text to the section (given by the brief, not marked): "Use Catalogue text"
24. Toast after it: "Catalogue text added."
25. Error `nothing_to_fill` (Catalogue still has no text): "Catalogue has no text for this section yet."
26. Screen-reader name of each section's text box (given by the brief, not marked; like 07-O §10's "Title of {section}"): "Text of {section}"

## 4. Other screens (sweep findings 8 and 9)
27. Proposals list with nothing to show (the type filter on): "No proposals yet" (finding 8; 07-O's "No proposals or estimates yet" stays when both types are shown)
28. Estimates list, the same: "No estimates yet"
29. Catalogue, under "Deliverables, assumptions and exclusions" (the service page and the edit form): "A new proposal or estimate takes its Deliverables section, and its Assumptions and exclusions section, from these texts. Where a text is empty, the section is hidden and the draft says so."
   Or (shorter): "New proposals and estimates take their Deliverables and Assumptions and exclusions sections from these texts. An empty text hides its section."

## 5. Client portal (client-facing, finding 7)
30. A proposal or estimate email link that has ended (expired, revoked, the contact's access turned off, or never valid), under the heading "Proposals and estimates", with the "Sign in" button; the pattern of 07-U §3's invoice line: "This link no longer works. Sign in to your client portal to see your proposals and estimates, or ask us for a new link at contact@techaust.com."

## Not new (reused, approved earlier)
- Draft "Send to" list: contacts without portal access are grouped under, and the hint under the list says, "Has no portal access yet" (the send dialog's approved line, `OFFER_COPY.noPortal`).
- "Write these sections or hide them before sending: {sections}." (07-O §10) is unchanged.
