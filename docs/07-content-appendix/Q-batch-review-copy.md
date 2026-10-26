# 07-Q: Batch review copy (M3.4 to M4.5)

**Approved by the owner word for word on 2026-10-26 ("approve all").** Every recommendation in §1 is taken, every change in §2 is made, and every line in §3 stays as written. Lines marked VERIFY WITH CA/LEGAL stay draft wording for the CA or lawyer before production. Text in {braces} is filled in by the system. The source for each line is the code constant listed in [docs/runs/batch-review-fixes.md](../runs/batch-review-fixes.md); a fix task removes the "[Placeholder]" tag from every line here.

## 1. Open questions: decisions

| No. | Question | Before | Decision |
|---|---|---|---|
| Q1 | Search box hint for roles that can search documents but not leads or clients | Everyone sees one hint now; the Accountant sees "Search clients", although documents are searchable too. | Build the hint from what each role can search, using the same words. Accountant: **"Search clients and documents"**. |
| Q2 | "Removed client" or "Anonymised client" | Lists, search and approvals show "Removed client" after anonymising; frozen documents show "Anonymised client" (your earlier words). | **"Anonymised client" everywhere**, so one client never has two names. |
| Q3 | The care plan result line (07-O §10) | "Converted to care plan for {client} ({tier})." and, without a tier, "Converted to care plan for {client}." | Add "a": **"Converted to a care plan for {client} ({tier})."** and **"Converted to a care plan for {client}."** |
| Q4 | The "Sent" status on a PDF (07-P) | The PDF prints the document's status; the designer kept "Sent". | **Keep "Sent".** |
| Q5 | The USD total in rupees (07-P) (VERIFY WITH CA/LEGAL) | "Indicative total in INR: {₹ amount} (1 USD = ₹{rate})." | **Keep as written.** |
| Q6 | The signature-too-large error | The server's own sentence shows now ("larger than 2400 by 1200 pixels"). | One line for both file errors: **"Use a PNG or JPEG image up to 256 KB and 2400 by 1200 pixels."** |
| Q7 | "Proposal terms" printed on an estimate | Estimates say "The terms below are version {n} of our proposal terms." | **"The terms below are version {n} of our terms."** on both proposals and estimates. |
| Q8 | The empty "Acceptance" heading on a sent estimate (staff view) | The heading shows with nothing under it until the estimate is decided. | **Hide the heading until there is an acceptance or a decline to show.** No new words needed. |
| Q9 | A line for a PDF that fails its integrity check (staff bell) | The general "PDF failed" line shows now. | **"The PDF of {number} didn't match its saved copy, so it wasn't sent. A developer needs to look at it before it can be sent."** (owner, 2026-10-26; the title, else "Untitled", stands in when there is no number) |
| Q10 | The GST rate in the PDF's rupee note (VERIFY WITH CA/LEGAL) | "Prices exclude GST (18 %)." has the rate typed in, even when a line has another rate. | **"Prices exclude GST."** The tax summary under it shows each rate. |
| Q11 | Settings › "Email on documents" | The setting is not used: the PDF footer always prints hello@techaust.com. | **Print the Settings value in the PDF footer** (hello@techaust.com until you change it). |
| Q12 | What "Viewed" means | An email security scanner can open a link before the client does, so "Viewed" means the link was opened. | Keep "Viewed" and add a hint under the delivery list: **"Viewed means the link was opened. Email security scanners can open links too."** |
| Q13 | The "Attach the PDF" hint when a client's setting is On | "Off by default: the email links to the portal." reads oddly when it starts On. | Off: keep it. On: **"On for this client: the PDF goes with the email."** |
| Q14 | A contact changed on a draft after it was created | The Acceptance text keeps the first contact's name. | **Fix it in this task**, so the name follows the contact chosen. No new words needed. |
| Q15 | The warranty line in the proposal terms (VERIFY WITH CA/LEGAL) | "4. Warranty. Defects in what we delivered are fixed free for 30 days after launch." | **Keep as written**, matching the 30-day warranty on the website. |
| Q16 | The Client filter hint is cut off | The box is too narrow for "Start of a code or name" (finding 1). | Shorter words as well as a wider box: see **C1**. |

## 2. Changed lines

| No. | Before | Approved | Where |
|---|---|---|---|
| C1 | Start of a code or name | Client code or name | Client filter box on Projects and Care plans |
| C2 | An acceptance certificate could not be made; it will be tried again tonight | An acceptance certificate couldn't be made. We'll try again tonight. | Staff bell |
| C3 | Keep the note to 1,000 characters. | Keep the note to 1,000 characters or fewer. | Time entry, error (matches the portal's name line) |
| C4 | An approval is already waiting for the owner | An approval is already waiting for the owner. | Approvals, error |
| C5 | The PDF is not ready yet | The PDF isn't ready yet. Try again in a minute. | Documents, error |
| C6 | The certificate is still being prepared | The certificate is still being made. Try again in a minute. | Documents, error (matches the other certificate line) |
| C7 | Custom lines are not counted in the discount guard. | Custom lines don't count towards the discount limit. | Proposal side panel and approvals |
| C8 | not set | Not set | Catalogue price cells |

## 3. Lines approved as written

### Projects

| No. | Line | Where |
|---|---|---|
| PRJ1 | No milestones yet. | Milestones, empty |
| PRJ2 | No notes yet. | Notes, empty |
| PRJ3 | No files yet. | Files, empty |
| PRJ4 | No notes for this client yet. | Client notes, empty |
| PRJ5 | Milestone deleted. | Toast |
| PRJ6 | Note deleted. | Toast |
| PRJ7 | Project marked as {status}. | Toast |
| PRJ8 | Someone else changed this project. | Stale notice |
| PRJ9 | Someone else changed this project while you were editing it. | Stale notice |
| PRJ10 | Someone else changed this milestone. | Stale notice |
| PRJ11 | Someone else changed this note. | Stale notice |
| PRJ12 | No client's code or name starts with that. | Client search, no match |
| PRJ13 | Choose the client. | Projects and care plans, error |
| PRJ14 | Show projects of all clients | Screen reader only |
| PRJ15 | {n} client(s) found | Screen reader count |
| PRJ16 | Enter the project name. | Error |
| PRJ17 | Enter the milestone title. | Error |
| PRJ18 | Enter a percentage from 0 to 100, with at most 2 decimals. | Error |
| PRJ19 | Write the note first. | Error |
| PRJ20 | The target date can't be before the start date. | Error |
| PRJ21 | This client's personal details were removed, so nothing new can be added to it. | Client and project, notice |
| PRJ22 | The budget can't change while a percentage milestone is invoiced or paid. | Error |
| PRJ23 | A milestone can't move from {from} to {to}. | Error |
| PRJ24 | {the server's own sentence} | Error for a rare code with no wording |

### Care plans

| No. | Line | Where |
|---|---|---|
| CARE1 | Someone else changed this care plan. | Stale notice |
| CARE2 | Enter a day from 1 to 28. | Error |
| CARE3 | Enter the start date. | Error |
| CARE4 | Enter the price per month. | Error |
| CARE5 | Enter whole hours, then choose the minutes. | Error |
| CARE6 | Change at least one of the terms first. | Change terms, error |
| CARE7 | Show care plans of all clients | Screen reader only |
| CARE8 | {the server's own sentence} | Error for a rare code |

### Time

| No. | Line | Where |
|---|---|---|
| TIME1 | Someone else changed this time entry. | Stale notice |
| TIME2 | Delete this time entry? This can't be undone. | Delete dialog |
| TIME3 | Enter the date. | Error |
| TIME4 | Enter the time spent, in steps of 15 minutes. | Error |
| TIME5 | No project or care plan starts with that. | Target search, no match |
| TIME6 | {n} match(es) found | Screen reader count |
| TIME7 | Choose dates no more than 366 days apart, the first before the second. | CSV export, error |
| TIME8 | This week has more rows than the timesheet shows. Filter by person or target to see them all. | Timesheet notice |

### Dashboard activity

| No. | Line | Where |
|---|---|---|
| DASH1 | added a lead | Recent activity |
| DASH2 | changed a lead |  |
| DASH3 | added a note to a lead |  |
| DASH4 | moved a lead to another stage |  |
| DASH5 | replied to a lead |  |
| DASH6 | converted a lead into a client |  |
| DASH7 | deleted old leads |  |
| DASH8 | added a care plan |  |
| DASH9 | changed a care plan's terms |  |
| DASH10 | changed a care plan's status |  |
| DASH11 | logged time |  |
| DASH12 | changed a time entry |  |
| DASH13 | deleted a time entry |  |
| DASH14 | marked a document as expired |  |
| DASH15 | marked an approval as expired |  |

### Catalogue

| No. | Line | Where |
|---|---|---|
| CAT1 | No services yet | Empty, heading |
| CAT2 | Add the first service, or load the seed catalogue. | Empty, body |
| CAT3 | No services match these filters | No match |
| CAT4 | Someone else changed this service. | Stale notice |
| CAT5 | Someone else changed this service while you were editing it. | Stale notice |
| CAT6 | Enter a code: S and up to four digits, for example S19. | Error |
| CAT7 | Enter the service name. | Error |
| CAT8 | Enter a short description. | Error |
| CAT9 | Enter the six-digit SAC. | Error |
| CAT10 | Enter a rate from 0 to 100 %, with at most 2 decimals, or leave it empty. | Error |
| CAT11 | Use lower-case letters, digits and single hyphens, for example cloud-migration. | Error |
| CAT12 | Describe line {n}. | Error |
| CAT13 | Line {n} has the same description as another line. | Error |
| CAT14 | Enter the quantity of line {n}: more than 0, with at most 3 decimals. | Error |
| CAT15 | Name step {n}. | Error |
| CAT16 | Enter a percentage for step {n}. | Error |
| CAT17 | Keep at least one step. | Error |
| CAT18 | A section needs a heading. | Template, error |
| CAT19 | Something outside the services can't be published. Check the payment terms. | Publish, error |
| CAT20 | No active service is marked for the website, or two share a code. | Publish, error |
| CAT21 | This is an older version. Version {n} is the newest. | Template notice |

### Proposals and estimates

| No. | Line | Where |
|---|---|---|
| DOC1 | Enter a quantity like 1 or 2.5. | Error |
| DOC2 | Enter a percentage like 10 or 12.5. | Error |
| DOC3 | Enter a description. | Error |
| DOC4 | Enter a name for this instalment. | Error |
| DOC5 | Enter the six-digit SAC code. | Error |
| DOC6 | Enter a number of days from 1 to 90. | Error |
| DOC7 | Untitled | Fallback title |
| DOC8 | Section | Section kind |
| DOC9 | No lines yet. Add a line from the catalogue or a custom line. | Lines, empty |
| DOC10 | Add from the catalogue | Button and dialog title |
| DOC11 | Add a custom line | Button |
| DOC12 | Add an instalment | Button |
| DOC13 | Add a section | Button |
| DOC14 | Choose a service | Error |
| DOC15 | Search by the start of a lead reference or email | New document, label |
| DOC16 | Convert this lead to a client first. | Error |
| DOC17 | Choose at least one service. | Error |
| DOC18 | Choose a client. | Error |
| DOC19 | Choose a lead. | Error |
| DOC20 | Next steps | Read view heading |
| DOC21 | Show more requests | Approvals button |
| DOC22 | the owner | Fallback name |
| DOC23 | No requests match these filters. | Approvals, no match |
| DOC24 | Couldn't load this service's lines. Close the dialog and try again. | Error |
| DOC25 | No proposals or estimates match these filters | List, no match |
| DOC26 | Search by number | List search |
| DOC27 | No proposal or estimate has a number starting with that. | Search, no match |
| DOC28 | 1 custom line / {n} custom lines | Side panel and approvals |
| DOC29 | Your role can read this draft but not change it. | Notice |
| DOC30 | Open the care plan | Link |
| DOC31 | A newer version of this document exists. | Notice |
| DOC32 | Open the newest version | Link |
| DOC33 | Leave empty to use the plan's 2 hours. | Care block hint |
| DOC34 | Required: this plan's hours are agreed per client. | Care block hint |
| DOC35 | {tier} care plan for {client}: {price} a month before GST | Care block summary |
| DOC36 | plus {aiOps} a month for AI Ops | Care block summary |
| DOC37 | Converted to an invoice draft. | Estimate result |
| DOC38 | Open it | Link |
| DOC39 | Title of {section} | Screen reader only |
| DOC40 | Write these sections or hide them before sending: {list}. | Send blocker |
| DOC41 | The owner rejected this version. Change it before asking again. | Error |

### PDF (proposal and estimate)

| No. | Line | Where |
|---|---|---|
| PDF1 | From · Prepared for · Document | Block labels |
| PDF2 | No. · Date · Valid until · Currency | Document labels |
| PDF3 | Place of supply: {label} | Line |
| PDF4 | Prepared for | Cover |
| PDF5 | Your contact at TecHaust: {who} | Cover |
| PDF6 | # · Description · SAC · Qty · Unit · Rate · Discount · Taxable value · GST % | Line table columns |
| PDF7 | Tax summary · Taxable value · CGST · SGST · IGST | Tax summary |
| PDF8 | Amount in words: {words} | Line |
| PDF9 | Payment schedule · Instalment · When · Share · Amount | Schedule table |
| PDF10 | Milestone · What you get · Target date · Payment | Timeline table |
| PDF11 | International projects are invoiced from India in USD as an export of services. | USD note (VERIFY WITH CA/LEGAL) |
| PDF12 | Accept online in the TecHaust client portal: | Acceptance box |
| PDF13 | Your acceptance is recorded on a separate acceptance certificate. This document doesn't change. | Acceptance box |
| PDF14 | TecHaust Technologies · techaust.com · hello@techaust.com | Footer (see Q11) |
| PDF15 | Page {x} of {y} | Footer |
| PDF16 | Investment · Terms · Acceptance | Headings |
| PDF17 | Download PDF · PDF ready · Making the PDF… · Try again | Admin PDF panel |
| PDF18 | The PDF is taking longer than usual. | Admin PDF panel |
| PDF19 | We'll make the PDF again. | Toast |
| PDF20 | Fingerprint · Fingerprint {first 12 characters} | Admin PDF panel |
| PDF21 | The PDF is still being made. Try again in a minute. | Error |
| PDF22 | The PDF is already made. | Error |
| PDF23 | Signature · Upload signature · Replace · Remove | Settings › Signature |
| PDF24 | Printed on tax invoices above "Authorised signatory". PNG or JPEG, up to 256 KB. | Signature hint |
| PDF25 | Remove the signature? Invoices issued already keep theirs. | Confirmation |

### Send and offers (admin)

| No. | Line | Where |
|---|---|---|
| OFF1 | Emails | Delivery heading |
| OFF2 | Sending · Delivered · Bounced · Marked as spam · Not sent | Delivery pills |
| OFF3 | Sent again · PDF attached | Delivery labels |
| OFF4 | Send again | Button |
| OFF5 | Revoke links | Button |
| OFF6 | Revoke the links? | Dialog title |
| OFF7 | Every link we emailed for this offer stops working at once, and emails still waiting to go are not sent. The client can still sign in to the portal. | Dialog body |
| OFF8 | Revoking… | Busy |
| OFF9 | {n} link(s) revoked, {m} waiting email(s) stopped. | Toast |
| OFF10 | Accepted through · The emailed link · The portal, signed in · Country | Acceptance panel |
| OFF11 | The certificate is being made. | Notice |
| OFF12 | Declined | Heading |
| OFF13 | Milestones · First instalment | Start project panel |
| OFF14 | Proforma invoice (draft) · Tax invoice (draft) · Export invoice (draft) | Instalment type |
| OFF15 | Open the project | Link |
| OFF16 | Fill in the client's {fields} first. | Error |
| OFF17 | Only the latest sent version, still open, can be sent again. | Error |
| OFF18 | The first instalment can't be worked out from this client's details. | Error |
| OFF19 | Send {number or title} v{version} | Send dialog title |
| OFF20 | Send to | Label |
| OFF21 | Contacts with portal access. Each gets their own link. | Hint |
| OFF22 | Attach the PDF | Switch |
| OFF23 | Off by default: the email links to the portal. | Switch hint (see Q13) |
| OFF24 | The message | Label |
| OFF25 | Has no portal access yet | Contact note |
| OFF26 | Choose at least one contact. | Error |
| OFF27 | Sending… | Busy |
| OFF28 | Sent to 1 contact. / Sent to {n} contacts. | Toast |
| OFF29 | The email goes once the PDF is ready, usually within a minute. | Notice |
| OFF30 | This version · Acceptance | Headings |
| OFF31 | Start the project? | Dialog title |
| OFF32 | This creates the project and its milestones from the payment schedule, and a draft of the first instalment for you to issue. | Dialog body |
| OFF33 | Nothing is sent to the client. | Dialog note |
| OFF34 | Starting… | Busy |
| OFF35 | Project {code} started. | Toast |
| OFF36 | Accepted by · Email · Date and time · Document fingerprint · Declined by · Reason · IP address · Browser | Record labels |
| OFF37 | Download the acceptance certificate | Button |
| OFF38 | Start project | Button |
| OFF39 | Number · Total · Valid until | Email preview facts |
| OFF40 | The PDF is attached. / You can download the PDF from the same page. | Email preview |
| OFF41 | Waiting for the PDF · Queued · Sent · Failed | Send status |
| OFF42 | The certificate is still being made. Try again in a minute. | Error |
| OFF43 | There's a newer version. Open the latest one. | Error |
| OFF44 | This has expired and can't be accepted. | Error |
| OFF45 | This has already been accepted. | Error |
| OFF46 | A decision has already been recorded. | Error |
| OFF47 | This contact can't receive it: no portal access or no email address. | Error |
| OFF48 | Choose up to 5 contacts. | Error |
| OFF49 | Only an accepted proposal can start a project. | Error |
| OFF50 | The payment schedule has no first instalment to bill. | Error |
| OFF51 | The first instalment combines more than 10 service codes; check it before issuing. | Error |
| OFF52 | Accepted: {title} v{version} / Declined: {title} v{version} | Staff bell |

### Portal

| No. | Line | Where |
|---|---|---|
| POR1 | Shorten the name to 120 characters or fewer. | Accept, error |
| POR2 | Take out any symbols or hidden characters, then type the name again. | Accept, error |
| POR3 | Show more | Button |
| POR4 | Too many attempts from this network. Wait {wait}, then open the link again. | Link, error |
| POR5 | Your account · Menu · Close menu · Back · Continue | Navigation |
| POR6 | Awaiting your decision | Home heading |
| POR7 | Nothing is waiting for your decision. | Home, empty |
| POR8 | When we send you a proposal or an estimate, it appears here. We email you each time too. | Home, empty |
| POR9 | Decided | Home heading |
| POR10 | Proposals and estimates you accept or decline are kept here. | Home, empty |
| POR11 | All proposals and estimates | Back link |
| POR12 | Also in your portal | Home heading |
| POR13 | Your invoices and payments will appear here. | Coming soon |
| POR14 | Your projects and their milestones will appear here. | Coming soon |
| POR15 | Your contact details will appear here. | Coming soon |
| POR16 | In scope · Out of scope · Date · Your contact at TecHaust · Amount in words · Contents | Proposal page labels |
| POR17 | Document sections | Screen reader only |
| POR18 | A new version is being prepared. We'll email you when it's ready. | Notice |
| POR19 | There's a newer version of this {kind}. You're seeing version {n}, the latest. | Notice |
| POR20 | This {kind} expired on {date}. Reply to our email or contact us if you'd still like to go ahead. | Notice |
| POR21 | You opened this from an email link. You can review and accept it here, or sign in to see everything we've sent you. | Notice |
| POR22 | Sign in | Button |
| POR23 | The PDF is being prepared. Check back in a minute. | Notice |
| POR24 | To accept, type your full name and tick the box. We record your acceptance against this exact version. | Accept intro |
| POR25 | Full name | Label |
| POR26 | As it should appear on the acceptance record. | Hint |
| POR27 | Type your full name. | Error |
| POR28 | Read the terms | Link |
| POR29 | Tick the box to confirm you agree to the terms. | Error |
| POR30 | Check these before you accept: | Error summary |
| POR31 | Not going ahead? You can decline instead and tell us why. | Hint |
| POR32 | Decline | Button |
| POR33 | Accept this {kind}? | Dialog title |
| POR34 | Please check the details below. | Dialog lead |
| POR35 | Accepting… | Busy |
| POR36 | You accepted this {kind} | Result |
| POR37 | {name} accepted this {kind} | Result |
| POR38 | Accepted by · Email · Date and time · Document fingerprint · Declined by · Reason | Record labels |
| POR39 | This version is locked: it can't be changed or accepted again. | Result note |
| POR40 | What happens next: we'll confirm the start date with you and send the first invoice. | Result note |
| POR41 | Why are you declining? | Decline title |
| POR42 | The price doesn't fit our budget · The timing doesn't work for us · We've chosen another option · We've decided not to go ahead · Other | Decline reasons (also in admin) |
| POR43 | Tell us the reason | Label |
| POR44 | Tell us the reason. | Error |
| POR45 | Choose a reason. | Error |
| POR46 | Anything else we should know (optional) | Label |
| POR47 | Decline this {kind}? | Dialog title |
| POR48 | We'll let the team know. You can still contact us if anything changes. | Dialog body |
| POR49 | Declining… | Busy |
| POR50 | You declined this {kind} | Result |
| POR51 | Thank you for telling us. We'll be in touch only if you ask us to. | Result |
| POR52 | The PDF is still being made. Try again in a minute. | Error |
| POR53 | The certificate is still being made. Try again in a minute. | Error |
| POR54 | There's a newer version. Open the latest one. | Error |
| POR55 | This has expired and can't be accepted. | Error |
| POR56 | This has already been accepted. | Error |
| POR57 | A decision has already been recorded. | Error |

### Emails

| No. | Line | Where |
|---|---|---|
| EM1 | The PDF is attached. / You can download the PDF from the same page. | Offer email |
| EM2 | Number · Total · Valid until | Offer email facts |
| EM3 | Open in the portal | Offer email button |
| EM4 | Next: we'll confirm the start date with you and send the first invoice. | Acceptance email |
| EM5 | {who} accepted {number} v{version} on {date and time IST}. | Acceptance email |
| EM6 | {name} declined {number} v{version}. Reason: {reason}. Note: {note} | Staff decline email |

### Acceptance certificate

| No. | Line | Where |
|---|---|---|
| CERT1 | Acceptance certificate | Title |
| CERT2 | This certificate records an electronic acceptance through the TecHaust client portal. | Statement (VERIFY WITH CA/LEGAL) |
| CERT3 | Document · Number and version · Total · Prepared for · Accepted by · Email | Labels |
| CERT4 | Date and time (IST) · Date and time (UTC) · IP address · Browser · Country | Labels (VERIFY WITH CA/LEGAL) |
| CERT5 | How it was accepted · From the emailed link · Signed in to the client portal | Labels |
| CERT6 | Evidence | Heading |
| CERT7 | Document fingerprint (SHA-256 of the accepted PDF) | Label |
| CERT8 | Fingerprint of the sent copy (SHA-256) · Terms version · Terms fingerprint (SHA-256) | Labels |

## 4. Added after the checks (owner, 2026-10-26)
| No. | Line | Where |
|---|---|---|
| Q9 (replaced) | The PDF of {number} didn't match its saved copy, so it wasn't sent. A developer needs to look at it before it can be sent. | Staff bell; {number} falls back to the title, then "Untitled" |
| ADD1 | No proposal is linked to this project. | Project page, Linked records |
| ADD2 | No contact of this client has portal access yet. Turn it on for a contact first. | Send dialog, with a "Contacts" link |
| ADD3 | Enter the date as DD/MM/YYYY, for example 26/10/2026. | Every date field, error |
| ADD4 | Service names use "and", never "&" | Catalogue (S2, S5, S6, S8, S10, S15) |
| ADD5 | "(milestone M4.1)" removed | Settings › Website switches and Payment terms hints |
