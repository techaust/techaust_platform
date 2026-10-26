# 07-N: Portal proposals, acceptance and send copy for M4.5

_Drafted by the lead on 2026-10-26 from approved facts:
- 04 ADM-PROP-07…10, POR-03…06;
- 07 §8 (the sent and accepted emails), 07-A §7 (the binding-agreement sentence);
- the owner's approval of the M4.5 preview (2026-10-25);
- the designer's "[Placeholder]" drafts in `apps/portal/src/copy-documents.ts`.

**PENDING the owner's word-for-word approval** (batch rule). Sections 1–5 are client-facing (portal, emails, certificate); sections 6–7 are staff-facing. `{…}` is filled by the system. Acceptance and evidence wording is VERIFY WITH CA/LEGAL._

## 1. Portal home and lists
| Where | Copy |
|---|---|
| Labels | "Your account" · "Menu" · "Close menu" · "Back" · "Continue" |
| Awaiting heading | "Awaiting your decision" |
| Awaiting, empty | "Nothing is waiting for your decision." · "When we send you a proposal or an estimate, it appears here. We email you each time too." |
| Decided heading | "Decided" · "Proposals and estimates you accept or decline are kept here." |
| All link | "All proposals and estimates" |
| Also in your portal | "Also in your portal" · Invoices: "Your invoices and payments will appear here." · Projects: "Your projects and their milestones will appear here." · Profile: "Your contact details will appear here." (each with "Coming soon") |

## 2. The proposal page
| Where | Copy |
|---|---|
| Labels | "In scope" · "Out of scope" · "Date" · "Your contact at TecHaust" · "Amount in words" · "Contents" · "Document sections" |
| A newer version is still being prepared | "A new version is being prepared. We'll email you when it's ready." |
| Superseded notice | "There's a newer version of this {proposal/estimate}. You're seeing version {n}, the latest." |
| Expired notice | "This {proposal/estimate} expired on {date}. Reply to our email or contact us if you'd still like to go ahead." |
| Single-document link notice | "You opened this from an email link. You can review and accept it here, or sign in to see everything we've sent you." · button "Sign in" |
| PDF still being made | "The PDF is being prepared. Check back in a minute." |

## 3. Accept and decline
| Where | Copy |
|---|---|
| Accept intro | "To accept, type your full name and tick the box. We record your acceptance against this exact version." |
| Full name | Label "Full name" · hint "As it should appear on the acceptance record." · error "Type your full name." |
| Terms tick | "I have read and agree to the terms" · link "Read the terms" · error "Tick the box to confirm you agree to the terms." |
| Error summary | "Check these before you accept:" |
| Decline hint | "Not going ahead? You can decline instead and tell us why." · button "Decline" |
| Accept confirmation | Title "Accept this {proposal/estimate}?" · "Please check the details below." · then the 07-A §7 sentence on what is recorded · buttons "Accept" · "Back" |
| Accepting | "Accepting…" |
| Accepted record | "You accepted this {proposal/estimate}" / "{name} accepted this {proposal/estimate}" · "Accepted by" · "Email" · "Date and time" · "Document fingerprint" · "This version is locked: it can't be changed or accepted again." |
| What happens next | "What happens next: we'll confirm the start date with you and send the first invoice." |
| Decline reason | Title "Why are you declining?" · reasons: "The price doesn't fit our budget" · "The timing doesn't work for us" · "We've chosen another option" · "We've decided not to go ahead" · "Other" |
| Other | Label "Tell us the reason" · error "Tell us the reason." · "Choose a reason." (no reason chosen) |
| Note | "Anything else we should know (optional)" |
| Decline confirmation | Title "Decline this {proposal/estimate}?" · "We'll let the team know. You can still contact us if anything changes." · buttons "Decline" · "Back" |
| Declining | "Declining…" |
| Declined record | "You declined this {proposal/estimate}" · "Declined by" · "Reason" · "Thank you for telling us. We'll be in touch only if you ask us to." |

## 4. Emails (07 §8 core text unchanged; the missing parts)
| Where | Copy |
|---|---|
| Sent email, fact labels | "Number" · "Total" · "Valid until" |
| Sent email, PDF note | With the PDF attached: "The PDF is attached." · Without: "You can download the PDF from the same page." |
| Accepted email, `{{next_step}}` | "we'll confirm the start date with you and send the first invoice" |
| Accepted email, TecHaust side | Subject as 07 §8 · "{typed_name} ({email}) accepted {number} v{version} on {accepted_at_ist}. [Open in admin]." |
| Declined email, TecHaust side | Subject "Declined: {{title}} ({{number}} v{{version}})" · "{name} declined {number} v{version}. Reason: {reason}. Note: {note}. [Open in admin]." |
| Approval emails | As corrected in 07-O §8: "Approval needed: {{title}} v{{version}}" and "{{decision}}: {{title}} v{{version}}" |

## 5. Acceptance certificate (PDF)
"Acceptance certificate" · "Document" · "Number and version" · "Total" · "Accepted by" · "Email" · "Date and time (IST)" · "Date and time (UTC)" · "IP address" · "Browser" · "Document fingerprint (SHA-256 of the accepted PDF)" · "This certificate records an electronic acceptance through the TecHaust client portal." (VERIFY WITH CA/LEGAL)

## 6. Admin (staff)
| Where | Copy |
|---|---|
| Send dialog | Title "Send {number} v{n}" · "Send to" · hint "Contacts with portal access. Each gets their own link." · "Attach the PDF" · hint "Off by default: the email links to the portal." · "The message" · per-contact note "Has no portal access yet" · error "Choose at least one contact." · "Sending…" · result "Sent to {n} contacts." |
| Delivery list | "The email goes once the PDF is ready, usually within a minute." · statuses "Waiting for the PDF" · "Queued" · "Sent" · "Failed" |
| Record panel | "This version" · "Acceptance" · IP and browser shown to the owner only |
| Start project | Title "Start the project?" · "This creates the project and its milestones from the payment schedule, and a draft of the first instalment for you to issue." · "Nothing is sent to the client." · "Starting…" · result "Project {code} started." · started line "Project {code} started on {date}." |
| Bells | "Accepted: {title} v{version}" · "Declined: {title} v{version}" |

## 7. Errors (by API code)
| Code | Copy |
|---|---|
| `pdf_pending` | "The PDF is still being made. Try again in a minute." |
| `certificate_pending` | "The certificate is still being made. Try again in a minute." |
| `superseded` | "There's a newer version. Open the latest one." |
| `expired` | "This has expired and can't be accepted." |
| `already_accepted` | "This has already been accepted." |
| `already_decided` | "A decision has already been recorded." |
| `recipient_invalid` | "This contact can't receive it: no portal access or no email address." |
| `recipients_required` | "Choose at least one contact." |
| `recipients_too_many` | "Choose up to {n} contacts." |
| `not_a_proposal` | "Only an accepted proposal can start a project." |
| `no_advance_step` | "The payment schedule has no first instalment to bill." |
| `instalment_sac_merged` | "The first instalment combines more than 10 service codes; check it before issuing." (VERIFY WITH CA) |
