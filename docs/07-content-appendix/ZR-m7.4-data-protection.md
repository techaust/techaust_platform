# 07-ZR: M7.4 data-protection tooling (requests, acknowledgement, retention, legal hold)

Status: **Client lines C1–C7 and the Rule 9 block: waiting for the owner's approval.** Until then every client line shows "[Placeholder]" (`APPROVED_07ZR` in `packages/core/src/copy-zr.ts`), and the jobs Worker queues no `request.received` email outside local development (so no portal request is marked acknowledged by an email that wasn't sent). Staff lines S1–S10 are the brief's words, approved by the lead under the owner's delegation (run file [m7.4-data-protection](../runs/m7.4-data-protection.md) section H); the two extra staff lines at the end are the builder's drafts for the lead. English (India/UK spelling), "and" never "&", no banned phrases (07 §1.3). No legal wording is invented here: the Rule 9 block is 07-A §8 word for word.

## Client lines (for the owner)
- **C1** (the portal's own requests; replaces 07-ZP C21; the date is the reply day in IST): "We'll reply by email by {date}."
- **C2** (acknowledgement email, subject): "We've received your request"
- **C3** (acknowledgement email, body): "We received your "{kind label}" request on {date}. We'll reply by {due date}." The kind label is 07-ZP C19's (or C5, C6 below), quoted.
- **C4** (acknowledgement email, closing; the house sign-off of 07 §8's lead acknowledgement): "— TecHaust Technologies"
- **C5** (kind label): "Withdraw my consent"
- **C6** (kind label): "Nominate someone to act for me"
- **C7** (privacy page line, L31; the analyst's idea, not final wording): "If you ask us to erase your data, we keep only a scrambled form of your email address for 3 years, so that we don't email you and can show what you agreed to."

## The Rule 9 contact block (in every reply email: acknowledgement, close and decline; L32)
07-A §8 word for word (the brief names "07-A §7"; §7 is "Your rights", §8 is the Grievance Officer block itself):

> **Rupak Sarkar**, Founder, TecHaust Technologies · privacy@techaust.com · {{postal_address}}.

`{{postal_address}}` is the owner's open input (07-A placeholders); until it exists the email shows "[Placeholder] postal address".

## Staff lines (lead's delegation; the brief's words)
- **S1** "Legal hold is on. Nothing about this record can be erased, anonymised or deleted until the hold is lifted."
- **S2** "Turn on real deletion. Until then the clean-up only reports what it would delete."
- **S3** bell `retention.report_ready`: "The clean-up trial report is ready to review."
- **S4** bell `request.overdue`: "A data request from {client code or lead ref} is past its reply date."
- **S5** bell `request.due_soon`: "A data request from {ref} is due in {n} days."
- **S6** bell `request.ack_overdue`: "A request from {ref} hasn't been acknowledged within 48 hours."
- **S7** bell `r2.stuck`: "Some stored files couldn't be deleted. A developer needs to look."
- **S8** the 2026-10-25 trial line, kept (the lead list's "scheduled for deletion" view, now read from the real-deletion switch).
- **S9** "Allow emails again to an erased address. Use this only when the person has asked us to contact them again." · toast "Emails to this address are allowed again." · error "This address isn't on the erased list."
- **S10** bell `email.erased_skip` (L25): "Emails to {ref} are stopped because the address was erased. If they've asked to hear from us again, allow emails again in Settings › Data retention."

## Builder's drafts for the lead (staff only)
- Bell `retention.done_with_holds` (a live run that skipped held rows; S3's pair): "The clean-up ran. Some records were kept because a legal hold stands on them."
- S3's bell kind words for the two new kinds (beside M7.1's): "withdrawal of their consent" · "nomination of someone to act for them".
- A request that names only an address has no client code or lead ref for S4–S6: the bell shows "[Placeholder] an address not in our records" until the lead words it.
