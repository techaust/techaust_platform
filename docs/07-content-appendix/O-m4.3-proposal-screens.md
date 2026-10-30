# 07-O: Proposal and estimate copy for M4.3

_Drafted by the lead on 2026-10-26 from approved facts:
- 04: ADM-PROP-01…09, ADM-APR-01…02, ADM-G-04, ADM-SET-05;
- 07: §1 (voice and honesty), §5.3 (how payment works), §5.5 (fixed-price rules, ownership, AI tools, warranty) and §8 (emails);
- the owner's answers in docs/13.

**Approved by the owner word for word on 2026-10-26 ([07-Q](Q-batch-review-copy.md), "approve all")**. Sections 1 and 2 are client-facing (they appear in proposals, estimates and their PDFs). The rest is staff-facing admin copy. `{…}` is filled by the screen; `{{…}}` is a template placeholder (07-L). Tax and legal wording is VERIFY WITH CA/LEGAL._

## 1. Template wording (new versions of the M4.1 templates; client-facing)
The new version keeps every section key and heading from M4.1. Sections marked "written per proposal" stay empty in the template, and the editor asks staff to write them or hide them (§3).

### Proposal templates (one per category)
| Section | All categories | Category-specific line (first line of the Summary) |
|---|---|---|
| Cover | "{{client.name}}" · "{{service.name}}" · "Proposal from {{company.name}}" | |
| Summary | (category line) | **advise:** "{{client.name}} asked us for {{service.name}}. This proposal sets out what we'll look at, what you'll receive and what it costs." · **build:** "This proposal covers {{service.name}} for {{client.name}}: what we'll build, how we'll deliver it in stages, and the fixed price for the written scope." · **automate:** "This proposal covers {{service.name}} for {{client.name}}: what we'll automate, how we'll measure it in a pilot, and the price." · **connect:** "This proposal covers {{service.name}} for {{client.name}}: which systems we'll connect, how data will move between them, and the price." · **run:** "This proposal covers {{service.name}} for {{client.name}}: the support we'll provide each month and the monthly price." |
| Problem and goals | written per proposal | |
| Scope | "{{service.short}}" · "The price covers the written scope. If you want something new, we quote it before doing it, and you decide." | |
| Deliverables | "{{service.deliverables}}" | |
| Timeline (milestones) | written per proposal | |
| Team (roles) | written per proposal | |
| Estimate | "Payment schedule: {{service.schedule}}" | |
| Assumptions and exclusions | "{{service.assumptions}}" · "{{service.exclusions}}" | |
| Terms | "The terms below are version {terms version} of our proposal terms." | |
| Acceptance | "Prepared for {{client.contact}}." · "To accept, open this proposal in the client portal, type your full name and tick "I have read and agree to the terms". This proposal is valid for {{proposal.validity_days}} days from the date it's sent." | |

### Estimate templates (one per category, same wording for all five)
| Section | Copy |
|---|---|
| Estimate | "Estimate for {{service.name}}, prepared for {{client.name}}." · "This is an estimate, not a tax invoice." (VERIFY WITH CA/LEGAL) |
| Validity (the template's second section; the payment schedule itself is the table under Estimate) | "This estimate is valid for {{proposal.validity_days}} days from the date it's sent." |

### Care plan block
"Care plans are paid monthly in advance. Hours above the included hours are charged at the overage rate, before GST. Price and hours changes take effect from the next billing period."

### Terms block
"These terms are part of the proposal from {{company.name}}."

## 2. Proposal terms, first version (ADM-SET-08; client-facing; OPEN (08-C RB-38))
Every line comes from approved copy (07 §5.3, §5.5). Placeholders aren't used in terms.
1. **Scope and price.** "The price covers the written scope. If you want something new, we quote it before doing it, and you decide. We don't bill for our own estimating mistakes."
2. **Payment.** "Payments follow the schedule in this proposal. Invoices are due within 7 days. GST at 18 % is added for Indian clients."
3. **Ownership.** "On full payment, the code, designs and documentation are yours. We keep the right to reuse general know-how and our own pre-existing tools, which we list in this proposal."
4. **Warranty.** "Defects in what we delivered are fixed free for 30 days after launch." 🟧 **The owner confirms** (07 §5.5 item 8 is still marked for the owner).
5. **AI tools.** "We use AI coding and writing tools to work faster. A senior engineer reviews everything before it reaches you, and we never paste your confidential data into tools that train on it."
6. **Validity.** "This proposal is valid until the date shown on it."

### 2b. Proposal terms, second version (FX-5; owner-approved 2026-10-29, 07-Y items 1 and 2, docs/13; 08-C RB-38)
Seeded as the next version of the proposal terms (`PROPOSAL_TERMS_V2`), only while the newest proposal terms are still the seeded first version and Payment terms says 7 days (terms the owner saved are never replaced); documents already sent keep the version they pinned. Lines 1, 4, 5 and 6 are the first version's, word for word. The lawyer's final assignment wording is still OPEN (08-C RB-38).
2. **Payment.** "Payments follow the schedule in this proposal. Invoices are due within 7 days. GST at 18 % is added unless the work is an export of services under our Letter of Undertaking."
3. **Ownership.** "On full payment, we assign to you all copyright in the work we make under this proposal, worldwide and for its full term; the assignment does not lapse if unused. Our pre-existing tools and third-party or open-source parts are licensed to you, not assigned. We keep the right to reuse general know-how."

### 2c. Proposal terms, third version (final sweep; owner-approved 2026-10-30, 07-ZA item 14, docs/13; 08-C RB-38)
Seeded as the next version of the proposal terms (`PROPOSAL_TERMS_V3`), only while the newest proposal terms row is the seeded second version (by its id and text) and Payment terms says 7 days; terms the owner saved are never followed or replaced, and documents already sent keep the version they pinned. Proposals and estimates share these terms, so it is the second version word for word except:
2. **Payment.** "Payments follow the schedule in this proposal or estimate. Invoices are due within 7 days. GST at 18 % is added unless the work is an export of services under our Letter of Undertaking."
3. **Ownership.** "On full payment, we assign to you all copyright in the work we make under this proposal or estimate, worldwide and for its full term; the assignment does not lapse if unused. Our pre-existing tools and third-party or open-source parts are licensed to you, not assigned. We keep the right to reuse general know-how."
6. **Validity.** "This proposal or estimate is valid until the date shown on it."

## 3. Editor (staff)
| Where | Copy |
|---|---|
| List heading | "Proposals and estimates" |
| List, empty | "No proposals or estimates yet. Start one from a lead or a client." |
| List, nothing matches | "Try fewer filters, or search for the start of a number." |
| Create dialog | Title "New proposal or estimate" · "For a client" / "For a lead" · "Type" ("Proposal" · "Estimate") · "Services" · "Choose the default lines for {service}" · button "Create draft" |
| Create, hint | "The matching template fills in the sections, lines and payment schedule. You can change everything before sending." |
| Section, written per proposal | "Write this section for this client, or hide it." |
| Always included | "Always included: the estimate, terms and acceptance sections can't be hidden." |
| Lines table | "Description" · "Quantity" · "Rate" · "Discount" · "Taxable" · "Tax" · "Amount" |
| Discount fields | "Line discount" · "Document discount" · "Fixed" / "Percent" |
| Tax preview | "Place of supply: {label}" · "CGST" · "SGST" · "IGST" · "Round-off" · "Total" · "In words: {words}" · "A preview: the tax is fixed on the invoice." |
| Schedule | "Instalment" · "When" · "Share" · "Amount" · "What you get" · "Target date" · "Instalments always add up to the total." |
| Validity | "Valid for {n} days from sending" |
| Contact | "Send to" · "No contact chosen yet: you choose recipients when sending." |
| Newer terms | "Newer terms (version {n}) exist. Use them? This changes the content, so any approval has to be asked for again." · button "Use newer terms" |
| Unresolved placeholders | "These placeholders have no value yet: {list}. Fill them in before sending." |
| Save states | "Saving…" · "Saved" · "Not saved: {reason}" |
| Needs resave | "Prices or tax rules changed since this draft was saved. Save it once to update the figures." |
| Custom line | "Custom line: not from the catalogue" |

## 4. Discount guard and approvals (staff)
| Where | Copy |
|---|---|
| Guard line | "{n} % off catalogue prices" |
| Over 10 % | Staff and Sales: "More than 10 % off catalogue prices needs the owner's approval before sending." · Owner: "More than 10 % off catalogue prices. As the owner, you can send it without approval." |
| Request dialog | Title "Ask the owner to approve" · "Reason" · button "Send request" · "The approval applies to this version only. Any change afterwards needs a new approval." |
| States | "Approval pending" · "Approved by {person} on {date}" · "Rejected by {person}: {note}" · "Approval expired: the document changed after the request." |
| Owner's queue | Heading "Approvals" · empty "Nothing waiting for your approval." · columns "Document" · "Requested by" · "Discount" · "Total" · "Requested" |
| Decision dialog | Title "Approve {title} v{version}?" · "{n} % off catalogue prices, {total} total" · "Note (optional)" · buttons "Approve" · "Reject" |
| Bell, request | "Approval needed: {title} v{version}" |
| Bell, decided | "{Approved/Rejected}: {title} v{version}" |

## 5. Send, versions and conversions (staff)
| Where | Copy |
|---|---|
| Send confirmation (ADM-G-04) | Title "Send {title} v{version}?" · "{total} to {client}" · "Sending gives this version its number and freezes it. Changes afterwards make a new version." · button "Send" |
| Until M4.5 | "Emailing proposals arrives with the client portal update. For now, sending numbers and freezes the version only." |
| Sent | "Sent as {number} v{version}." |
| Statuses | "Draft" · "Pending approval" · "Sent" · "Viewed" · "Accepted" · "Rejected" · "Expired" · "Revised" |
| Versions panel | Heading "Versions" · "v{n}, {status}, {date}" |
| Revise dialog | Title "Make a new version?" · "v{version} stays acceptable until the new version is sent; then it shows as Revised." · button "Make new version" |
| Discard dialog | Title "Discard this draft?" · "This can't be undone." · button "Discard" |
| Create invoice draft | Title "Create an invoice draft from {number} v{version}?" · button "Create invoice draft" · result "Invoice draft created." · until M5: "Invoices arrive with invoicing." (07-K) |
| Create care plan | Title "Create a care plan from {number} v{version}?" · "Start date" · "Billing day" · "Included hours" · button "Create care plan" · result "Care plan for {client} ({tier}) created." |

## 6. Errors (by API code; staff)
| Code | Copy |
|---|---|
| `approval_required` | "This needs the owner's approval before sending." |
| `approval_not_needed` | "No approval is needed: the discount is 10 % or less." |
| `approval_pending` | "An approval request is already waiting." |
| `approval_exists` | "This version is already approved." |
| `approval_expired` | "This approval expired because the document changed." |
| `approval_decided` | "This request has already been decided." |
| `stale_version` | "Someone else saved this at the same moment. Reload and try again." |
| `frozen` / `not_draft` | "This version has been sent and can't be changed. Make a new version instead." |
| `draft_exists` | "A draft of the next version already exists." |
| `not_latest` | "Only the newest version can be revised." |
| `already_accepted` | "This proposal has been accepted and can't be revised." |
| `unresolved_placeholders` | "Some placeholders have no value yet." |
| `terms_missing` | "There are no proposal terms yet. Add them in Settings, Terms." |
| `service_inactive` | "{service} is retired and can't be added." |
| `service_not_priced` | "{service} has no price in {currency}." |
| `choose_default_lines` | "Choose the default lines for {service}." |
| `service_duplicate` | "This service is listed twice." |
| `default_line_duplicate` | "This default line is chosen twice." |
| `too_many_lines` | "A document can have up to 100 lines." |
| `line_catalogue_changed` | "The catalogue price of this line changed. Save to update it." |
| `line_tax_fixed` | "The tax on this line comes from the catalogue and can't be changed here." |
| `content_changed` | "The document changed while it was being sent. Reload and try again." |
| `numbering_changed` | "The numbering settings changed while it was being sent. Try again." |
| `schedule_missing` | "Add a payment schedule before sending." |
| `title_required` | "Add a title." |
| `no_lines` | "Add at least one line." |
| `tax_errors` | "Fix the tax problems shown before sending." |
| `sections_invalid` | "A required section is missing or too long." |
| `client_anonymised` / `contact_anonymised` | "This client's or contact's details were erased, so this can't be sent." |
| `not_accepted` | "Only an accepted version can be converted." |
| `already_converted` | "This version has already been converted." |
| `converted_to_care_plan` | "This estimate has already become a care plan, so it can't also become an invoice draft." |
| `converted_to_invoice` | "This estimate already has an invoice draft, so it can't also become a care plan." |
| `included_minutes_required` | "Enter the included hours for this plan." |
| `not_an_estimate` / `not_a_care_estimate` | "Only an estimate can be converted this way." / "Only a care-plan estimate can become a care plan." |
| `currency_mismatch` | "The currencies don't match." |
| `monthly_line_in_proposal` | "Monthly lines belong in a care-plan estimate, not a proposal." |
| `lead_has_proposal` | "This lead already has a proposal." |
| `lead_client_mismatch` | "This lead belongs to a different client." |

## 7. Other places (staff)
| Where | Copy |
|---|---|
| Dashboard pipeline tile | Heading "Pipeline" · "{n} open, {total} before GST" · empty "No open proposals." |
| Client page tab | "Proposals and estimates" · empty "No proposals or estimates for this client yet." |
| Search group | "Proposals and estimates" |
| Global search box | Placeholder "Search leads, clients, projects, documents and people" · intro "Search by the start of a name, code or number." |
| Toasts | "Draft created." · "Draft saved." · "Sent as {number} v{version}." · "New version made." · "Draft discarded." · "Approval requested." · "Approved." · "Rejected." |
| Audit labels | "created a draft" · "changed a draft" · "discarded a draft" · "sent a document" · "made a new version" · "asked for approval" · "decided an approval" · "converted a document" |

## 8. Correction to 07 §8
- **The approval emails:** "Approval needed: {{document_type}} {{number}}" can't work for drafts, which have no number before sending. Subject and bell use the title and version instead: "Approval needed: {{title}} v{{version}}". The decision email becomes "{{decision}}: {{title}} v{{version}}".

## 9. Added after the screens (lead, 2026-10-26; approved 2026-10-26, 07-Q)
The designer's drafts, accepted as wording to approve:

| Where | Copy |
|---|---|
| Field errors | "Enter a quantity like 1 or 2.5." · "Enter a percentage like 10 or 12.5." · "Enter a description." · "Enter a name for this instalment." · "Enter the six-digit SAC code." · "Enter a number of days from 1 to 90." |
| Fallbacks | "Untitled" (a draft with no title) · "Section" (a section with no heading) · "the owner" (when no owner name is known) |
| Lines | "No lines yet. Add a line from the catalogue or a custom line." · "Add from the catalogue" · "Add a custom line" |
| Schedule, sections | "Add an instalment" · "Add a section" |
| Create dialog | "Choose a service" · "Search by the start of a lead reference or email" · "Convert this lead to a client first." · "Choose at least one service." · "Choose a client." · "Choose a lead." · "Couldn't load this service's lines. Close the dialog and try again." |
| Approvals queue | "No requests match these filters." · "Show more requests" |
| List | "No proposals or estimates match these filters." · "Search by number" · "No proposal or estimate has a number starting with that." |
| Custom lines | "{n} custom lines" · "Custom lines are not counted in the discount guard." |
| Read view | "Your role can read this draft but not change it." · "Next steps" · "A newer version of this document exists." · "Open the newest version" · "Open the care plan" |
| Activity feed | "marked a document as expired" · "marked an approval as expired" |

## 10. Added after the review (lead, 2026-10-26; approved 2026-10-26, 07-Q)
| Where | Copy |
|---|---|
| Care plan dialog, included hours | Essential: "Leave empty to use the plan's 2 hours." · Growth, Scale and Dev Subscription: "Required: this plan's hours are agreed per client." |
| Care plan dialog, summary (ADM-G-04) | "{tier} care plan for {client}: {price} a month before GST" · with AI Ops: "plus {ai_ops} a month for AI Ops" |
| `section_empty` | "Write these sections or hide them before sending: {list}." |
| `approval_rejected` | "The owner rejected this version. Change it before asking again." |
| Converted estimate | "Converted to an invoice draft." / "Converted to care plan for {client} ({tier})." · link "Open it" |
| Section title field (accessible name) | "Title of {section}" |
| Sent version of an anonymised client or contact (**the owner's answer, 2026-10-26; VERIFY WITH CA/LEGAL**) | "Anonymised client" in place of the name, with no email, GSTIN or address; the same words for a contact whose details were removed. Only the staff view changes: the frozen copy is kept as evidence. |
| Converted to a care plan before the tier is known (the lines are still loading) | "Converted to care plan for {client}." |
