Status: open
Tier: B
Usage: builder claude-opus-5-5/high, 5-h 0 → 9 % (skills: cloudflare:workers-best-practices, cloudflare:wrangler)

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

## Lead's notes after the builder (2026-10-29 ~10:20 IST)
- Merged `fix/fx3-builder` (31bdf3ec) into `fix/fx3-admin-portal` (fast-forward); removed the builder's worktree.
- **Item 12 and the check of item 11** wait for the M5 owner-fix PR (#106) and FX-1 to reach `main`. Then this branch merges `main`, and a short builder round does item 12 on top of the M5 round 4–7 `noRoom` rule and re-checks the `series_full` line against the newer `documents.ts`.
- **Open questions answered** (docs/13, 2026-10-29):
  1. the order is as above;
  2. a manual lead's currency, band and timeline are editable afterwards too: the same short builder round adds them to `PATCH /leads/:id`;
  3. the 22 tags with no 08-C row stay in the guard's list until researched, as their own step after FX-4.
- **Next: the designer**, after the FX-2 designer finishes (one browser agent at a time). Its extra items from the builder:
  - the manual lead form fields;
  - the portal line for `newer_version_pending`, plus the code in `offer.tsx`'s `FINAL` set;
  - placing `SIGNATURE_COPY.scaled`;
  - the client Overview and project Figures panels.

## Merge of `main` (lead, 2026-10-29 ~11:30 IST)
`main` now holds the M5 owner fixes (#106) and FX-1 (#107); `main` equals FX-1's final head. Merged into this branch (1486aca9):
- **main's side** wherever FX-3 never changed the file;
- **`apps/admin/src/lib/documents.ts` and its test:** main's files, with FX-3's `series_full` line, its `Y` import and its test re-applied;
- **`apps/jobs/src/billing.ts`:** FX-3's shared `CARE_SCAN_REPEAT_HOURS` kept;
- **docs/13:** both sets of rows.

## Builder round 2 (lead's brief; builder claude-opus-5-5/high)
On `fix/fx3-b2` from `origin/fix/fx3-admin-portal`:
1. **First, prove the merge.** Run the full `pnpm test` and `pnpm check`; fix anything the merge broke.
2. **Item 12:** in `apps/admin/worker/service-fill.ts` `fillServiceTokens`, the first service's own template fill can pass 6,000 characters on a staff-edited template. Apply the same leave-out-and-name rule (`noRoom` gap) the other services get under the block model (M5 rounds 4–7; see the file header and `docs/runs/m5-owner-fixes.md`). Test it with a long template: the save and the creation both succeed, the gap is named, and nothing is refused.
3. **Item 11 re-check:** the `series_full` line in `apps/admin/src/lib/documents.ts` still maps correctly against the newer file.
4. **Manual lead fields after creation (docs/13 2026-10-29):** `PATCH /leads/:id` takes `currency`, `budgetBand` and `timeline` with the same checks as `POST` (a band needs its own currency). Add tests.

Make one commit per item. Report under "### Builder round 2 report".

### Builder round 2 report
Builder: claude-opus-5-5 (high), 2026-10-29 ~11:45–12:30 IST, branch `fix/fx3-b2` from `origin/fix/fx3-admin-portal` (97020de6). Three commits (655ebfed, 12fbf076, b62b8129) plus this report, pushed.

#### Skills
- `cloudflare:workers-best-practices`: Worker routes and D1. Applied: the lead PATCH stays one guarded `mutate` batch; the check runs on the row read at the same `updated_at` the UPDATE is bound to; no request state at module level.
- `cloudflare:wrangler`: no config or binding changed, so nothing to do beyond the existing `wrangler types` in typecheck.
- Not loaded: `cloudflare:workers-profiling` (it profiles deployed Workers, which are off-limits; the bundle and startup figures come from the build's budget script), `cloudflare:cloudflare` (no platform feature changed).

#### Per item
1. **The merge is proven; nothing needed fixing, so there is no commit for it.**
   - Full `pnpm test` on 97020de6: exit 0, every package green.
   - Caveat: I started item 2's edits while that run's admin package was still going, so its admin count (3,304) may include half-edited files. The final run below, on the finished branch, is the clean proof.
   - `pnpm check` ran once, at the end (below). It covers the merge too.
2. **Item 12, the first service's own fill past 6,000 characters: done (655ebfed).**
   - New `fitFirstService` in `service-fill.ts`. Each section that holds the first service's tokens is rendered twice: `full`, with the Catalogue texts, and `bare`, with them taken out like an empty text (`withoutTexts`). In section order:
     - a section takes `full` while it stays within 6,000 characters and the document within 30,000. The document is counted with every section bare, so the first service comes before the services added after it;
     - otherwise, in a Deliverables or Assumptions and exclusions section, the parts whose tokens the template held go in once, by the block rule, when that fits. A repeated token, or the token's own line, can make `full` the longer text;
     - otherwise the section keeps the template's words without the texts (`leftOut`). A section left with no text is hidden like an empty one;
     - a title that would pass 120 characters takes its bare title.
   - It is used in both places:
     - the save that adds the first service line (`fillServiceTokens`);
     - creation (`document-draft.ts`). There, the full, bare and raw templates each go through `sectionsFromTemplate`, which places sections by key alone, so the rows line up.
   - **Naming (`catalogueGaps`):** a left-out first service keeps the template's words as its unheaded opening, so under the old rule it "had a block" and was never named. It is now named `noRoom` when its opening holds none of the section's parts and they don't fit. The new `ownsOpening` comes from `parseBlocks`'s `opening` field.
     - My first version named any block like that. The round 5 finding 3 test caught it: a headed block the person emptied must not be called "no room". So I narrowed the rule to the first service's unheaded opening.
     - The fill and the read count the room the same way, and the total only grows after the fill. So whatever the fill leaves out of those two sections is named.
   - `document-save.ts`: the comment on the remaining `checkSections` now says what it still guards (the short values; see open question 1).
   - The header limits were updated in `service-fill.ts`:
     - deleting the first service's parts from its opening, in a section with no room for them, reads as "left out" and is named;
     - text left out of a section of another kind, or out of a title, is not named.
3. **Item 11 re-check: done (12fbf076, test only).**
   - The merged `documents.ts` still has `DOC_ERRORS.series_full` (the 07-Y line), and `document-send.ts:318` still answers 409 `series_full`.
   - The send dialog maps errors with `offerErrorText`, which falls through to `docErrorText`. The new test in `offers.test.ts` proves that path; the existing `documents.test.ts` test still passes.
4. **Manual lead fields after creation: done (b62b8129).**
   - `PATCH /leads/:id` takes `currency`, `budgetBand` and `timeline`. The creation checks run on the values the lead **ends up with**, so a band must be one of its own currency's: a currency change that strands the stored band is a 400, and changing both together works. Any 400 writes nothing.
   - Changes go on the timeline (field names `currency`, `budget_band`, `timeline`, with before and after); the audit row gets the names only.
   - **Builder decision:** docs/13 says "a manual lead's", so a website lead's answers stay the visitor's own words:
     - changing one is 409 `lead_answers_fixed` ("The website form's answers can't be changed"), and nothing is written;
     - sending them unchanged is no change, so a whole-form save still works.
     - See open question 4.
   - SPA:
     - `LeadPatch` now includes the three fields;
     - `FIELD_LABELS` gets "Currency", "Budget" and "Timeline", the words the lead page already shows (`lead.tsx:725-733`), so it is not new copy.

#### Tests
- `apps/admin/worker/service-fill.test.ts`, 10 new tests:
  - the reviewer's case (2,000 characters of template around both texts at 2,500): the template's words kept, both parts `noRoom`, nothing to fill;
  - a text that fits, as before;
  - a repeated token: the text goes in once;
  - only the parts whose tokens the template held go in;
  - the 30,000 total: the section is hidden and named;
  - a later service still gets its block;
  - the title bound;
  - a section of another kind is left out and not named;
  - `fitFirstService` pass-through;
  - L1 still holds (an opening holding one part, or none while they would fit, names nothing).
- `apps/admin/worker/documents-first-fill.test.ts` (new, 2 API tests, its own database because it adds a template):
  - **creation:** 201, every section ≤ 6,000, both parts named `noRoom`, then save 200 and send 200;
  - **the save that adds the first line:** 200, the template's words kept, gaps named and equal to the read, `sectionsChanged` carries both sections, a later save 200, and "Use Catalogue text" answers 409 `nothing_to_fill`.
- `apps/admin/src/lib/offers.test.ts`: `series_full` through `offerErrorText`.
- `apps/admin/worker/leads-api.test.ts`, one new test:
  - a band change in the same currency, and the timeline;
  - eight refusals (currency alone strands the band, currency null, a dollar band on a rupee lead, both wrong, an unknown band, EUR, an unknown timeline, `__proto__`), each writing nothing;
  - currency and band changed together; clearing;
  - the timeline's field order and values; the audit rows hold no values;
  - a website lead: 409 `lead_answers_fixed` writes nothing (not even the name sent with it), and the same answers plus a name change is 200.

#### Commands (heavy ones through `tools/heavy.sh`)
- Targeted runs while working: `service-fill` and `service-blocks` (59 tests), `documents-first-fill`, `documents-service-text`, `service-fill` and `service-blocks` (87), `offers`, `documents` and `documents-series-full` (46), `leads-api` and `leads` (44). All green at the end; the one failure on the way is explained under item 2.
- `pnpm --filter @techaust/admin typecheck`: exit 0.
- Final full `pnpm test` on b62b8129: exit 0.

  | Package | Tests passed |
  |---|---|
  | core | 1,768 |
  | db | 471 |
  | email | 128 |
  | pdf | 340 |
  | auth | 135 |
  | ui | 469 (2 skipped) |
  | web | 428 (16 skipped) |
  | jobs | 525 |
  | portal | 621 |
  | admin | 3,317 (13 more than after the merge) |

- `pnpm --filter @techaust/admin build`: exit 0.
  - front bundle 99,131 bytes, startup 16.2 ms;
  - API bundle 606,234 bytes, startup 70.5 ms (fastest of 7, under this PC's load). That is under the 650,000 mark for a third Worker.
- `pnpm check` (the one whole-repository lint): exit 0. Its 10 warnings and 8 infos are the same ones as round 1, none in a file I changed.

#### Not verified
- No screen was looked at and no dev server was started:
  - the `noRoom` note for the first service on the editor;
  - the lead edit form for the three fields;
  - the timeline rows for them. Their values print as raw codes (`3l-7l`) until the designer formats them with `budgetBandLabel` and `TIMELINE_LABELS`.
- The SPA has no line for `lead_answers_fixed` yet. It falls back to the API sentence.
- Staging: nothing deployed (not mine to do).

#### Placeholder lines (for 07-Y)
- No new `[Placeholder]` line in code.
- For the designer, if the lead form ever sends a changed answer on a website lead: suggested "These answers came from the website form and can't be changed." The screen should simply not offer those fields for a website lead.
- API sentence added (not screen copy): `lead_answers_fixed`, "The website form's answers can't be changed".

#### Open questions (lead's call)
1. **Overlong titles from short values (existing before this task, not item 12):** a template heading of up to 120 characters plus `{{service.name}}` (up to 120) or `{{client.name}}` can pass the 120-character title bound.
   - At creation the draft is stored that way, and every later save is a 400 `section_title_too_long`.
   - At the save that adds the first line, it is a 400.
   - Recommended: a follow-up that shortens or bounds the rendered title, or a template rule.
2. **More than 3 custom sections (existing before this task):** `sectionsFromTemplate` joins custom sections beyond the third into the last one. Several 2,000-character template sections can then make a body over 6,000 at creation. Recommended: the template save refuses a body whose merge would pass the limit.
3. **Text tokens outside their own sections:** a staff template that puts `{{service.deliverables}}` into Scope, or into a heading, now has that text left out when there is no room, but it is not named (the gaps read only the two service sections). Recommended: a template-save rule that allows the three text tokens only in their own section kinds, once each, and never in a heading. That needs a core change and a template copy line.
4. **Website leads' answers:** I kept them fixed (409). If the owner wants staff to correct a visitor's answers too, drop the source check: one line in `leads.ts` and its test.

## Lead's answers after round 2 (2026-10-29 ~12:30 IST)
- **Q1, long titles:** fix it in round 3. When filling a value (`client.name`, `service.name`, …) would take a section title past 120 characters, the token stays unfilled. The send check then names it, and the person writes a shorter title. Every later save keeps working, and nothing is refused at creation.
- **Q2, merged custom sections:** fix it in round 3. Saving a template refuses one whose sections beyond the third would be joined past 6,000 characters. It answers 400 naming the template sections, with a 07-Y line.
- **Q3, text tokens outside their own sections:** accepted. Saving a template allows `{{service.deliverables}}` only in a Deliverables section, and `{{service.assumptions}}` and `{{service.exclusions}}` only in Assumptions and exclusions. Anything else is a 400 with a 07-Y line. First check that the seeded templates and every template in local seed data comply.
- **Q4, website leads:** a visitor's answers stay fixed (they are a record of what the visitor said); staff write corrections in a note. Recorded in docs/13.

## Builder round 3 (lead's brief; builder claude-opus-5-5/high)
Work on `fix/fx3-b3` from `origin/fix/fx3-admin-portal`, one commit per item:
1. Q1 above, with tests.
2. Q2 above, with tests.
3. Q3 above, with tests.
4. **Follow-ups the FX-2 reviewer's code-review helper found on `main`** (the M5 owner fixes). Verify each one. Fix it, or write it down as a known limit with the reason if a fix isn't worth it:
   - `apps/admin/worker/document-draft.ts:~195`: a hidden Scope section stays hidden after the lead's message is appended to it at conversion, so the client never sees the scope;
   - `apps/jobs/src/browser.ts:~168`: a render refused as `damaged` never adds its browser time to the pacing budget;
   - `packages/pdf/src/integrity.ts:~359`: streams that aren't Flate get no byte-level check beyond `/Length` → `endstream`. Judge whether out-of-order chunks inside a large non-Flate stream (images) can pass the xref and `/Length` checks; if they can, say so in the run file with the reason, and decide fix or limit.

Then run the full `pnpm test` and `pnpm check` through the queue, and report under "### Builder round 3 report".
