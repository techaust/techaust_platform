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

## Builder report
Builder: claude-opus-5-5 (high), 2026-10-29 09:10–10:10 IST, branch `fix/fx3-builder` from `origin/fix/fx3-admin-portal` (0ac65643). 11 commits, pushed.

### Skills
- `cloudflare:workers-best-practices`: Worker code, Hono routes and D1. Applied: one batch per read, every statement through an index (EXPLAIN-tested), no buffering of large bodies, no module-level request state.
- `cloudflare:wrangler`: no config or binding changed, so nothing to do with it beyond the existing typecheck (`wrangler types`).
- Not loaded: `cloudflare:workers-profiling`, which profiles deployed Workers (hosted, off-limits). Rows read were measured in local tests instead. `cloudflare:cloudflare` was not loaded because no platform feature changed.

### Per item
1. **Client Overview figures (A3 4, ADM-CLI-03): done.** `GET /clients/:id/finance` (new `apps/admin/worker/figures.ts`) answers `{available: true, asOf, currencies: [{currency, billedMinor, creditedMinor, balanceMinor, overdueMinor, overdueCount}]}`.
   - It is one batch: the client row and `CLIENT_FIGURES_SQL` (`packages/db/src/reports.ts`, a seek on `documents_client_issued`, EXPLAIN-tested).
   - It uses the statement's rules:
     - billed is the debit column over all time (tax invoices, export invoices and debit notes, tax included);
     - credited is the credit notes;
     - the balance is Σ of the open debit documents' balances, which is what a statement made today closes at;
     - overdue counts documents due strictly before today (IST);
     - proformas and voided documents never count.
   - "Collected" is left out of the answer entirely. An anonymised client gets `{available: false, reason: "anonymised"}`. Sales gets 403, as before.
   - Twin test (`figures.test.ts`): billed equals the statement's `range.debitMinor` and the balance equals `range.closingMinor`, for INR (every kind of line), for USD, and for a client with 200 documents.
   - **Rows read for a client with 200 documents: 400.** D1 counts each document twice (the index entry, then the row). Another client's 50 documents are never read.
   - Builder decision: "billed" is gross (the statement's debit column) and the credit notes are a separate figure, so the screen can show both. Netting them is the designer's or owner's choice.
2. **Project Figures (A3 5, ADM-PRJ-05): done.**
   - `GET /projects/:id` `figures.billed` is `{available: true, currencies: [{currency, billedMinor, creditedMinor}]}`, from the project's issued, not voided invoice-family documents with the same rules (`PROJECT_BILLED_SQL`, on `documents_project`).
   - Sales gets no `billed` key, and its statement never runs.
   - An anonymised client's project gets `{available: false, reason: "anonymised"}`.
   - "Paid" is left out. `billedVsPaid` is gone (no screen used it).
3. **Note headings (A3 7, ADM-PRJ-03): done.**
   - Core `parseNoteMarkdown` reads `#`, `##` and `###` (`####`, `#tag` and a bare `#` stay text). `parseMarkdown` is unchanged, so proposal and estimate sections (the PDF, the portal) still read `#` as text and frozen documents look as before.
   - The admin `Markdown` takes a `headings` prop, which both note views turn on. It draws the headings as h3, h4 and h5 with classes `md__h md__h--N` for the designer to style. No HTML is set.
   - Core coverage gate passed (`pnpm test` runs it).
4. **Manual lead fields (A3 8, ADM-LEAD-01): API done; the form is the designer's.**
   - `POST /leads` takes `currency`, `budgetBand` and `timeline`. A band needs its currency and must be one of that currency's bands. Validation uses the new core `isBudgetBand` and `isTimeline` (`form-labels.ts`, no zod load).
   - Anything else is a 400 and writes nothing.
   - The lead page already returns the three fields. `NewLead` in `api.ts` has them; `LeadPatch` leaves them out (see question 2).
5. **Dashboard (A3 10): done.**
   - The Projects tile answers `{planned, active, onHold}`, and the tile shows a "Planned" line (the existing status label).
   - Date-only next action: core `istDayEnd`, `isIstDayEnd` and `formatIstMoment`. The shared `When`, `when()` and `relative()` print a date-only moment as the day ("25 Oct 2026", "yesterday", "in 3 days") with an ISO-day `dateTime`. `dateToMs` now uses `istDayEnd`.
   - Every place that prints a next action was checked:
     - the dashboard tile: fixed;
     - the list, board, lead page and timeline: they already print `formatDate`.
   - The stress test's rows-read ceiling went from 6,000 to 6,100: the owner reads 6,014 rows because the fixture's 50 Planned projects now count.
6. **"has approved" (A4 5): done.** The decision is lower case mid-sentence; the subject keeps "Approved:". The test covers approved and rejected.
7. **Accept on a superseded version (A4 9): API done; the message is the designer's.**
   - `REREAD_SQL` also reads the newest frozen version's PDF hash.
   - While that version is unrendered, an accept or decline on an older version answers **409 `newer_version_pending`** (API message "A newer version is being prepared"), with no `latestId`.
   - Once it is rendered, the answer is `superseded` with its id, as before.
   - Tested: v2 unrendered; v2 rendered; v3 frozen after v2 rendered (an accept on v1 or v2 is then pending).
8. **Signature size (A6 1c): done.**
   - Core `SIGNATURE_MAX_WIDTH` = 800 and `SIGNATURE_MAX_HEIGHT` = 400.
   - SPA: the new `lib/signature-scale.ts` (`signatureFit`, and `scaleSignature` with an injectable `ImageIo`, so it is tested without a browser) draws a larger image on a canvas (high-quality smoothing, aspect kept, PNG out). An image that already fits is sent unchanged. An unreadable image, or a result over 256 KB, shows the wrong-file line. `signature.tsx` calls it before the upload.
   - Worker: `settings-signature.ts` refuses a PNG over the bound from its IHDR (no decoding).
   - Builder decision: the same 800 × 400 bound applies to a JPEG (from its frame header). The SPA never sends a larger JPEG, and one rule is simpler.
   - Stored signatures are untouched.
9. **Bare VERIFY tags: done where 08-C has a row. The rest are listed below and guarded.**
   - Retagged:
     - `Researched … (08-C RA-12)`: state code, db test and leads test;
     - `RB-31`: billing contact flag;
     - `RB-19`: `document-pdf.ts`;
     - `RA-25` and `RB-11`: `data-tools.tsx`;
     - `RA-23`: `sales-register.tsx`;
     - `RA-12, RA-05`: core `clients.ts`;
     - `OPEN (08-C RB-23)`: the ₹10,000 liability cap, in core settings (2) and its test.
   - The settings API's `meta.verify` values were bare tags. They now point to the 08-C §5 list: `"08-C §5: CA"` and `"08-C §5: CA and lawyer"`. The SPA's `/legal|lawyer/` test still reads them.
   - Guard: `packages/core/test/verify-tags.test.ts` scans `apps/`, `packages/` and `scripts/` (not `migrations/`). It catches a tag even when a comment breaks the line, and fails on any tag beyond the list below, or on a stale count.
   - **No 08-C row yet (left bare, listed in the guard with the reason):**
     - `apps/admin/worker/clients.ts` ×5: what a data-subject export holds (offer links, invoice links, decisions, file contents), and the erase of never-sent drafts (O-Q4);
     - `apps/admin/worker/documents-convert.test.ts`: a sent offer as evidence against erasing the person it names;
     - `apps/admin/src/lib/clients.ts` ×2: data-subject items;
     - `apps/admin/src/lib/projects.ts`: notes and files deleted with the last contact;
     - `apps/admin/src/routes/settings/payment-terms.tsx`: due days, validity, the small-job threshold and the part-payment floor (the cap within it is RB-23);
     - `apps/admin/src/routes/settings/terms.tsx`: the document terms text (the export declaration within it is RA-18);
     - `apps/jobs/src/expire.ts` and `apps/jobs/test/expire.test.ts`: what an expired offer means;
     - `packages/core/src/documents.ts` ×2 and `packages/core/test/documents.test.ts`: a sent proposal as evidence, and the validity rule;
     - `packages/core/src/gstin.ts` and `packages/core/test/gstin.test.ts`: the state-code list and legacy codes;
     - `packages/core/src/schemas/settings.ts` ×3: the GSTIN check ×2 and the ₹10,000 part-payment floor;
     - `packages/core/src/pdf-jobs.ts`: the place-of-supply wording on a proposal;
     - `packages/db/src/contact-access.ts`: when portal access ends;
     - `packages/db/src/schema/crm.ts`: the lead's consent receipt (FRM-05; RB-28 covers marketing consent only);
     - `packages/db/src/seed/terms.ts`: the terms text and "Ownership" (its "GST at 18 %" part is RA-16).
   - **Applied migration left as it is:** `packages/db/migrations/0016_leads_duplicate_proposal_retention.sql:16`.
10. **Care's next billing day (FX-1 follow-up): done.**
    - Core `CARE_SCAN_REPEAT_HOURS` (2) and `CARE_SCAN_LAST_HOUR_IST` (8). Jobs `REPEAT_HOURS` now is that same constant.
    - `nextBillingDayOf` says today until 08:00 IST has begun, and tomorrow from then on, matching the 06:00, 07:00 and 08:00 scans.
    - No wording change: the page shows the date.
11. **(last, own commit fd576356) `series_full` on proposals and estimates: done.** `DOC_ERRORS.series_full` carries the invoice line's meaning as a new 07-Y line.
12. **(last) The first service's fill past 6,000 characters: NOT DONE, blocked.**
    - The `noRoom` leave-out-and-name rule doesn't exist on this base. It was added in M5 owner-fix rounds 4 and 5 (bcdbd376, b48122fe, 0cd745dc), which are on `origin/fix/m5-owner-findings` (18 commits not in `origin/fix/fx3-admin-portal`).
    - Here, `service-fill.ts` has no length rule for any service. Building one now would fork that work.
    - The brief says the base holds the M5 owner fixes; it holds them only up to round 3.
    - Redo item 12, and check item 11 against round 4's `documents.ts`, once `fix/m5-owner-findings` is merged.

### Tests added or changed
- admin worker:
  - `figures.test.ts` (new, 8 tests);
  - `leads-api.test.ts`: lead fields;
  - `dashboard.test.ts`: planned;
  - `dashboard-stress.test.ts`: 6,100 ceiling;
  - `settings-signature.test.ts`: 800 × 400 bound;
  - `care-billing.test.ts`: 08:00 boundary;
  - `settings.test.ts`, `projects.test.ts`, `clients.test.ts`: new shapes.
- admin SPA:
  - `signature-scale.test.ts` (new);
  - `projects.test.ts`: h3 to h5;
  - `leads.test.ts`: day-only `when` and `relative`;
  - `documents.test.ts`: `series_full`;
  - `pdf.test.ts`, `batch-review.test.ts`: the wrong-file line.
- portal: `offer-routes.test.ts` (`newer_version_pending`).
- core:
  - `markdown.test.ts`: headings, with a property test;
  - `dates.test.ts`: day end, with a property test;
  - `form-labels.test.ts`;
  - `care-billing.test.ts`;
  - `verify-tags.test.ts` (new).
- db: `reports.test.ts` (EXPLAIN of the two new statements).
- email: `m45.test.ts`.

### Commands (all heavy ones through `tools/heavy.sh`)
- Per-package runs while working, all green at the end.
- `pnpm typecheck`: exit 0.
- `pnpm test`: exit 0. Results by package:

  | Package | Tests passed |
  |---|---|
  | core (coverage gate passed) | 1,768 |
  | db | 471 |
  | email | 128 |
  | pdf | 340 |
  | auth | 135 |
  | ui | 469 (2 skipped) |
  | web | 428 (16 skipped) |
  | jobs | 525 |
  | portal | 621 |
  | admin | 3,247 |

- `pnpm --filter @techaust/admin build`: exit 0.
  - front bundle 99,131 bytes, startup 18.4 ms;
  - API bundle 599,273 bytes, startup 56.4 ms.
- `pnpm --filter @techaust/portal build`: exit 0. Bundle 97,011 bytes, startup 9.3 ms.
- `pnpm check` (the one whole-repository lint): exit 0. Its 10 warnings and 8 infos are all in files I didn't touch (pdf tests, `reports.test.ts`, web `catalogue.ts`, `web-content-lint.mjs`).

### Not verified
- The canvas scaling in a real browser: only the rules are tested, with a fake `ImageIo`. The designer should upload a large PNG and a JPEG on Settings › Company.
- The rows-read figure on staging: 400 is the local D1 count.
- The `newer_version_pending` screen path: the SPA has no mapping yet, so it falls back to the generic server line until the designer adds it. It also belongs in `offer.tsx`'s `FINAL` set.
- No screens were looked at. No dev server was started.

### Placeholder lines (for 07-Y)
1. `apps/admin/src/lib/pdf.ts` `SIGNATURE_COPY.wrongFile`: "Use a PNG or JPEG image up to 256 KB." It replaces "…and 2400 by 1200 pixels.", now that the browser scales the image down.
2. `SIGNATURE_COPY.scaled` (defined, not yet shown; for the designer): "We made the image smaller to fit 800 by 400 pixels."
3. `apps/admin/src/lib/documents.ts` `DOC_ERRORS.series_full`: "This series has run out of numbers for the year. Change the numbering format in Settings › Numbering."
4. Not in code yet (the designer adds it to the portal copy): the `newer_version_pending` line. Suggested: "A new version is being prepared. Try again in a few minutes."

The marks come from the new `apps/admin/src/lib/copy-y.ts` (`APPROVED_07Y = false`, `Y()`), on the 07-X pattern.

API sentences changed (not screen copy):
- `image_too_big` now says "800 by 400 pixels";
- `newer_version_pending` says "A newer version is being prepared".

### Open questions
1. **Item 12 is blocked:** it needs `fix/m5-owner-findings` (rounds 4–5) in this task's base first. The lead decides the order.
2. Should a manual lead's budget band, timeline and currency also be editable after creation (`PATCH /leads/:id`)? Only creation takes them now. Editing needs timeline labels for the three fields, which is the designer's part.
3. The 08-C register needs rows for the questions listed under item 9. Each tag can be retagged once its row exists, and the guard's list then shrinks.
