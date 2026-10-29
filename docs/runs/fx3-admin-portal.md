Status: open
Tier: B
Usage:

# FX-3: admin and portal fixes from the full audit

This is part of the owner's full audit of M1–M5 ([full-audit-m1-m5.md](full-audit-m1-m5.md), "Fix plan").
- **Model:** Opus 5.5 at high effort for every agent (owner's audit instruction).
- **Base:** `origin/fix/fx1-data-jobs`, which already holds the M5 owner fixes and FX-1 (care billing, numbering, `series_full`).
- **Merge order:** M5 owner fixes, then FX-1, then FX-2, then FX-3. FX-2 also edits `apps/admin/src/app.css`, `apps/admin/vite.config.ts` and `apps/portal/vite.config.ts`; keep both sides when merging.
- **M5 is still in re-check.** If it is sent back, round 6 may touch `apps/admin/worker/service-fill.ts` and `apps/admin/src/lib/documents.ts`. So items 11 and 12 below come **last**, each in its own commit, so they can be redone on top.

## Brief (lead, 2026-10-29)
Read each finding in full in the audit run file: sections A3, A4 and A6 (1c), and "Fix plan".

### Builder (Opus high): data, logic, API and the small UI wiring each item needs
1. **A3 4 (ADM-CLI-03): client Overview figures.** `apps/admin/worker/clients.ts:790` answers `{available:false}`. Answer billed, overdue and balance per currency from frozen documents now:
   - use the same rules as the client statement (`statements.ts`, core `statement.ts`): debits are invoices and debit notes, credits are credit notes and advance receipts, and proformas are left out. Billed, overdue and balance must agree with the statement for the same client. Prove that with a twin test;
   - "Collected" waits for M6: leave it out, don't show 0;
   - an anonymised client gets no figures.

   Keep the read inside one batch with indexed filters. Report the rows read for a client with 200 documents.
2. **A3 5 (ADM-PRJ-05): project Figures.** `projects.ts:406-408` shows hours only. Add billed, from the project's issued invoice-family documents, with the same rules as item 1. "Paid" waits for M6.
3. **A3 7 (ADM-PRJ-03): note headings.** `@techaust/core/markdown` supports `#`, `##` and `###`, rendered as h3/h4/h5 inside a note, so a note never adds an h1 or h2 to the page. Still no HTML is set. Keep core's coverage at 90 % or more.
4. **A3 8 (ADM-LEAD-01): manual lead fields.** A manual lead can carry a budget band, a timeline and a currency, using the labels core already has. Do the API, the validation and the tests. The designer does the form.
5. **A3 10: dashboard.**
   - the Projects tile counts Planned projects as well;
   - a date-only next action prints without "23:59 IST" (the shared date formatter; check every place that prints a next action).
6. **A4 5:** "has Approved your request": lower-case "approved" (`packages/email/src/offers.ts:171`), plus its test.
7. **A4 9: accept on a superseded version.** When the newest version is frozen but not yet rendered, an accept on the old version is refused as `superseded` and leads to a 404 (`apps/portal/worker/offer-sql.ts:94,116`).
   - Answer a distinct code, e.g. 409 `newer_version_pending`, when a newer frozen version exists without a PDF.
   - When the newer version is rendered, keep pointing to it as today.
   - The designer shows the message. The line goes on the 07-Y copy page.
8. **A6 1c: signature size.**
   - The SPA scales an uploaded signature down to fit within 800 × 400 px (canvas, PNG out, aspect kept) before upload.
   - `apps/admin/worker/settings-signature.ts` refuses a PNG wider than 800 or taller than 400 by reading its IHDR. That costs no decode CPU.
   - Tests for both. Already-stored signatures are left as they are.
9. **Bare VERIFY tags.** Retag every bare `VERIFY WITH CA/LEGAL` (about 29 in `apps`, `packages`, `scripts`) against `docs/08-research-appendix/C-research-register.md`:
   - a settled item gets `Researched <date>, <source> (08-C <ID>)`;
   - an open one gets `OPEN (08-C <ID>): <question>`.
   - Where 08-C has no row for it, **stop and list it** rather than invent a source.
   - **Never edit an applied migration** (`packages/db/migrations/*.sql`): leave those tags and list them.
   - Add a test or guard that fails on a new bare tag outside `migrations/`.
10. **FX-1 follow-up: care's next billing day.** The care page says "tomorrow" from 06:00 IST, but the 07:00 and 08:00 repeats can still draft the same day (`nextBillingDayOf` in `packages/core/src/care-billing.ts`, used by `apps/admin/worker/care-authority.ts`).
    - Make the answer match what the hourly tick really does.
    - Any wording change is a new line for 07-Y; mark it `[Placeholder]` in the admin.
11. **(last) FX-1 follow-up: `series_full` on proposals and estimates.** `apps/admin/src/lib/documents.ts` has no message for a 409 `series_full` from send. Reuse the meaning of `apps/admin/src/lib/invoices.ts:467`; any new wording is a 07-Y line.
12. **(last) M5 round 4, question 2.** In `apps/admin/worker/service-fill.ts` `fillServiceTokens`, the first service's own template fill can pass 6,000 characters on a staff-edited template. Apply the same leave-out-and-name rule (`noRoom` gap) there as the other services get. Test it with a long template.

**Not in this task (owner's go-ahead needed):** A4 3, the Bengali and Devanagari fonts for PDFs, needs a new package (`@fontsource/noto-sans-bengali` / `-devanagari`, OFL). The lead asks the owner. Don't install anything.

### Designer (Opus high, after the builder): admin and portal screens
- **A3 1:** tables that scroll sideways can be scrolled by keyboard: `.sheet-wrap` on /time and `DataTable`'s `.dtable`, with `tabIndex=0`, `role="region"`, an `aria-label` and a focus style. Add axe at 768 and 1024 to e2e.
- **A3 2:** no sideways page scroll at 1024 on /time (`.visually-hidden` escaping the clip). Put `position: relative` on overflow wrappers. Add a sweep test that `scrollWidth` ≤ `clientWidth` at 768 and 1024 on every admin route.
- **A3 3:** the Entries "Note" column wraps on words.
- **A3 6:** remove the "Password hashing took N ms" line (`sign-in.tsx:272-275`).
- **A3 9:** converting a lead opens the draft proposal.
- **A3 12:** the Convert dialog asks for a country when the lead gave none (no India default).
- **A3 13:** staff sign-in gets the "Show password" toggle that enrolment has (same component).
- **A4 1:** the portal accept form keeps the error line's space, or clears it on input, so the first click after a correction isn't lost; add an e2e test.
- **A4 2:** at 375 the document number in the accept dialog doesn't break; consider a sticky dialog footer.
- **A4 7:** hide the Acceptance section's "Accept this offer…" text once decided.
- **A4 8:** the whole agreement row is the checkbox's label (44 px).
- **The builder's items:** client Overview figures, project Figures (billed), note headings, the manual lead fields, the `newer_version_pending` message, signature scaling feedback, and the care and `series_full` lines.
- **Checks:** every admin and portal route at 375, 768, 1024, 1280 and 1600, in both themes and with the in-app theme against the OS theme. Cover the empty, loading and error states, with axe. This includes the screens A3 left out: care, catalogue, settings, users, account and audit at 768 and 1600, and dark at 1024.

### Rules
- Never touch staging or any hosted service; no workflow changes; install nothing.
- Don't touch FX-2's files (`public/_headers`, `apps/{admin,portal}/worker/{app,index}.ts`, `apps/admin/worker/catalogue.ts`, `apps/web/**`, `scripts/check-*`) or FX-4's (invoice screens and `@techaust/core/gst`, `invoices`, `notes`).
- New copy shows `[Placeholder]` and is listed under "Placeholder lines" in your report, for the 07-Y page.
- Commit at least every 20 minutes, on your own branch made from `origin/fix/fx3-admin-portal` (`fix/fx3-builder`, `fix/fx3-designer`). Push only that branch.

### Done means
`pnpm check`, the full `pnpm test` and the admin and portal builds pass (all through `bash tools/heavy.sh`). Write your report in this file under "Builder report" or "Designer report", with:
- the skills loaded;
- what changed per item;
- the tests;
- the commands and their results;
- what wasn't verified;
- the placeholder lines;
- any open questions.
