# 07-ZV: Rebuild PDF (staff lines)

Status: **lines 1–19 approved as written (the lead, under the owner's delegation for staff-only lines, 2026-11-07). Q2 was answered A (no mark), so no client-visible line is added; Q1 was answered B, so line 19 is used.** Staff-only lines (the admin and staff bells); no client sees any of them. If Q2 in the [run file](../runs/rebuild-pdf.md) is answered B, its one client-visible line is added here for the owner. English (India/UK spelling), "and" never "&", no banned phrases (07 §1.3), sentence case. `{number}` is the document number, `{label}` the number or "Untitled" (never the title), `{date}` as the admin writes dates, `{fp}` the first 12 characters of the SHA-256.

Recommendation for every line: approve as written.

## The action
1. Button: "Rebuild PDF". On the certificate: "Rebuild certificate". On the supplier copy: "Rebuild supplier copy". On a deed: "Rebuild unsigned PDF".
2. Dialog title: "Rebuild the PDF of {number}?"
3. Dialog body: "We'll check the stored file. If it's missing or damaged, we'll make it again from the document's sealed record and keep a record of the rebuild. Nothing in the document changes. It can take a few minutes."
4. Dialog buttons: "Rebuild PDF" and "Cancel".
5. Started: "Rebuilding the PDF. It will be ready in a few minutes."

## Refusals (the admin API's messages)
6. `nothing_to_rebuild`: "The stored PDF is complete and matches its fingerprint, so there's nothing to rebuild."
7. `too_soon`: "A rebuild was asked for less than 5 minutes ago. Try again later."
8. `rebuild_in_progress`: "This PDF is already being rebuilt."
9. `client_gone`: "This client's details were erased, so no PDF can be made for them."
10. `queue_unavailable`: "The rebuild couldn't be started. Try again in a minute."

## The state on the document page
11. Fact: "Rebuilt on {date}. Fingerprint of the stored file: {fp}." While it runs: "Being rebuilt…"
12. Refused (the sealed record failed its check): "The rebuild was refused because the saved record didn't match its seal. A developer needs to look at it."
13. `envelope_missing`: "The document's saved record is missing too, so the PDF can't be rebuilt. A developer needs to look at it."
14. Failed: "The rebuild didn't finish. Try again."
15. Found intact by the jobs Worker: "The stored PDF was found complete, so nothing was rebuilt."

## Bells (Owners)
16. `pdf.rebuilt`: "The PDF of {label} was rebuilt."
17. `pdf.refused` (rebuild): "The PDF of {label} couldn't be rebuilt because its saved record didn't match. A developer needs to look at it."
18. `pdf.failed` (rebuild): "The PDF of {label} couldn't be rebuilt. Open it to try again."

## The open-offer refusal (Q1 answered B)
19. `offer_open`: "This offer can still be accepted. Send a new version instead."
