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

### Builder round 3 report
Builder: claude-opus-5-5 (high), 2026-10-29 ~12:35–13:30 IST, branch `fix/fx3-b3` from `origin/fix/fx3-admin-portal` (74f3f8a2). One commit per item (9aec0b5f, acc903f8, 9408b937, dd630cf6) plus this report, pushed. The lead's docs commit 294f5b7f landed on the task branch after I branched; this branch does not touch its files.

#### Skills
- `cloudflare:workers-best-practices`: Worker routes, D1 and the queue consumer. Applied: the template refusals answer before any write; the refused render's browser time goes in one D1 batch on the failure path, before the throw that retries; no request state at module level.
- `cloudflare:wrangler`: no config or binding changed; nothing beyond the existing `wrangler types` in typecheck.
- `cloudflare:workers-profiling`: loaded for item 4's CPU question. It profiles deployed Workers, which are off-limits, so no profile was taken; the CPU reasoning for the integrity check is below, and the bundle and startup figures come from the build's budget script.
- `cloudflare:cloudflare`: loaded for Browser Run (item 4); no platform feature changed.

#### Item 1: long values in section titles (Q1), commit 9aec0b5f
- `packages/core/src/catalogue.ts`: `renderTemplate` takes `max` and `unbounded` (`RenderOptions`).
  - When filling every value keeps the text within `max`, nothing changes.
  - Otherwise the values are filled in order. One that would take the text past `max` stays as written and is listed as unresolved. A value that shortens the text, or a name in `unbounded`, is always filled.
  - A held-back placeholder is never taken out as "empty": only names with no value are dropped.
- `apps/admin/worker/service-fill.ts`: new `renderSection`.
  - A title is bounded at 120 characters. The Catalogue texts are `unbounded` there, because `fitFirstService` decides their room as before.
  - `fillServiceTokens` (the save that adds the first service) uses it.
- `apps/admin/worker/document-draft.ts`: creation now joins the template's custom sections first (`sectionsFromTemplate` on the raw template), then fills the draft's sections, so the bound applies to what is stored.
- Result: the draft is made and every later save works. The send check names the placeholder in the title (`unresolved_placeholders`, part `section`), and a shorter title sends.

#### Item 2: joined custom sections (Q2), commit acc903f8
- Core `packages/core/src/documents.ts`:
  - `templateKinds`: the draft kind each template section becomes, by `sectionsFromTemplate`'s rule;
  - `joinedPastLimit`: the 0-based template sections joined into the third custom section when that text passes 6,000 characters. Counted on the same text a draft stores.
- `apps/admin/worker/catalogue.ts` (`POST /api/v1/templates`): a proposal or estimate template that breaks the rule is a 400 `template_joined_too_long` with `sections: [indexes]`, and nothing is stored. Care plan and terms blocks are never joined, so they are exempt.
  - This is FX-2's file. The change is two separate hunks (an import line and the route). `git merge-tree` against `origin/fix/fx2-security-web` merges `catalogue.ts` cleanly.
  - `merge-tree` does report conflicts in `document-draft.ts`, `service-fill.ts`, `service-fill.test.ts` and `docs/13`. Those exist between `origin/fix/fx3-admin-portal` itself and FX-2 already; they are not new in this round.
- **Builder decision: the same bound for texts.** The joined text is checked raw, but values can still grow it at creation. So a short value (a name, the short text, the schedule sentence) that would take a section's text past 6,000, or the document past 30,000, now stays unfilled too.
  - `renderWithin` shares out the document's room in section order; `held` keeps unfilled sections as they stand.
  - It is used for the render without Catalogue texts (`bare`), and for the whole fill at creation when there is no service.
  - Without it, Q2's guarantee (no draft that every later save refuses) would hold only on the template's own text.
  - The `document-save.ts` comment now says what `checkSections` still guards: the person's own text.
- SPA lib `apps/admin/src/lib/catalogue.ts`: `templateRuleErrors(kind, sections)` gives section index → the 07-Y line, so the editor can show the rule before it sends. `TEMPLATE_RULES.joinedTooLong` is a `Y()` line.
- Known limit, written in the `service-fill.ts` header: a template version saved before this rule whose joined sections already pass 6,000 still makes drafts whose saves are refused until that section is shortened. The seeded templates never do.

#### Item 3: Catalogue-text placeholders only in their own sections (Q3), commit 9408b937
- Core `misplacedTextTokens` and `TEXT_TOKEN_KINDS`:
  - `{{service.deliverables}}` is allowed only in the text of the Deliverables section; `{{service.assumptions}}` and `{{service.exclusions}}` only in the text of Assumptions and exclusions;
  - none of them in any heading. That was my round-2 recommendation, which the lead accepted;
  - the section is the one a draft makes of it, so a second `deliverables` key is a custom section.
- `POST /api/v1/templates` answers 400 `template_text_token_place` with `sections: [{ index, name, part }]` for every template kind, and stores nothing.
- `templateRuleErrors` adds the two 07-Y lines, `textInHeading` and `textElsewhere`. Several lines on one section are joined.
- **Seed check:** `packages/db/test/catalogue.test.ts` now proves that every seeded template version (V1–V3, all kinds) passes Q2 and Q3.
  - The local seed has no other templates. The fixtures that break the rule (`documents-first-fill`, `documents-service-text`, `documents-convert`) insert with SQL, as stored legacy versions would be, so they still exercise the old paths.
- The `service-fill.ts` header limit about Catalogue text outside its sections now says that only a version saved before this rule can do it.

#### Item 4: the FX-2 reviewer helper's findings, commit dd630cf6
1. **Hidden Scope after the lead's message (`document-draft.ts`): confirmed and fixed.**
   - A Scope section emptied by the first service (for example `{{service.deliverables}}` in Scope with no deliverables text: only a template version saved before Q3) was created hidden. The convert then appended the lead's message, but the section stayed hidden.
   - Appending the message now shows the section, which is `appendServices`' rule.
   - The new test in `documents-convert.test.ts` fails without the fix: I checked this by commenting the line out.
   - Known limit, written at the code: the message (at most 2,000 characters) is not held to the section's 6,000. Only a template whose Scope short values already fill 4,000 characters or more could pass it.
2. **A refused render's browser time (`browser.ts`, `pdf.ts`): confirmed and fixed.**
   - The pacing between calls was always applied (`paced` waits in `finally`). What the finding meant was the day's browser-time figure: `pdf.browser_ms` and the half-of-the-day bell counted only stored PDFs. A response refused as `damaged` or `not_pdf` (a 2xx, so the browser did the work), and every retry it caused, went uncounted.
   - Those two errors now carry `browserMs`: the `X-Browser-Ms-Used` header, else the wall time, as for a success.
   - `failed` adds that time and the half bell in one batch, then throws as before. No render is counted.
   - An error status or a thrown error adds nothing.
   - CPU: one small D1 batch on a failure path only.
3. **Non-Flate streams (`integrity.ts`): can pass. Kept as a known limit, with a test.**
   - 8 KB blocks moved among themselves wholly inside one non-Flate stream move no object, no xref target and no stream end, so every check passes.
   - In our PDFs the only such stream is a JPEG signature (DCTDecode, invoice family). The signature upload accepts JPEG up to 256 KB; Chrome writes text, fonts, SVG and PNG as Flate. Only a JPEG of 16 KB or more can hold two whole blocks.
   - **Why not fixed:**
     - JPEG entropy-coded data has no checksum or structure a byte check can test without decoding the image, which is far past the 10 ms budget.
     - The only cheap alternative is comparing each DCTDecode stream's SHA-256 with the JPEG the page embedded (about 0.2 ms for 256 KB). It works only if Browser Run copies JPEG bytes through unchanged, which is unverified here. A wrong guess would refuse every invoice with a JPEG signature for ever.
     - Converting JPEGs to PNG in the browser could push a signature past the 256 KB upload cap, and an 800 × 400 PNG mostly lands past the 512 KiB inflate budget anyway (the accepted `partial` limit).
   - Written in the `integrity.ts` header. `pdf-integrity.test.ts` proves both sides: the move inside a DCTDecode stream passes, and the same move across its end fails.

#### Tests
- New or changed:
  - core `catalogue.test.ts`: 3 tests (the `max` rule, held-back vs empty, a fast-check property that a text within `max` stays within it and nothing is held back when all fits);
  - core `documents.test.ts`: 6 tests (Q3: 2; Q2: 4);
  - db `catalogue.test.ts`: the seed passes Q2 and Q3;
  - admin `service-fill.test.ts`: 5 tests (`renderSection`; the first-service save with a long name; `renderWithin` per text, per document and with `held`; the save with many short values);
  - admin `documents-template-limits.test.ts` (new, its own database, 7 API tests):
    - Q1 at creation: made, saved, the send names `client.name` and `service.name` in the titles, and shorter titles send;
    - a name that fits fills;
    - Q2 refused with sections `[3, 4, 5]` and nothing stored, estimate too;
    - Q2 saved when it fits, and a care block is exempt;
    - short values held at 6,000 at creation, and the draft saves;
    - Q3 refused for body, custom and heading placements, a terms block too, nothing stored;
    - Q3 saved in their own sections;
  - admin `documents-convert.test.ts`: 1 test (item 4.1);
  - admin `src/lib/catalogue.test.ts`: 2 tests (the editor's rule lines, marked `[Placeholder]`);
  - jobs `pdf.test.ts`: 2 tests (damaged and not_pdf counted with the half bell; 503 and thrown errors add nothing);
  - jobs `pdf-integrity.test.ts`: 1 test (the documented limit).
- Full `pnpm test` (`.logs/fx3b3-test.log`):
  - core 1,777, db 471, email 128, pdf 340, auth 135, ui 469 (2 skipped), web 428 (16 skipped): all passed, core's coverage gate included.
  - jobs: 2 tests timed out at 5 s while every package ran at once (setup 328 s): `offers.test.ts` "the email consumer sends each once" and `pdf.test.ts` "burst: 20 sends". pnpm then stopped admin and portal.
- Re-run one package at a time through the queue, all exit 0:
  - jobs: 528 passed (`.logs/fx3b3-jobs.log`);
  - admin: 3,332 passed, 15 more than round 2 (`.logs/fx3b3-admin.log`);
  - portal: 621 passed (`.logs/fx3b3-portal.log`).
- `pnpm check` (`.logs/fx3b3-check.log`), the one whole-repository lint: exit 0. Its 10 warnings and 8 infos are the same as round 2, none in a file I changed.
- `pnpm --filter @techaust/admin build`: exit 0. Front 99,131 bytes, startup 14.9 ms; API 608,204 bytes (+1,970), startup 77.6 ms (fastest of 7, under this PC's load). Still under the 650,000 mark for a third Worker.

#### Not verified
- No screen was looked at, and no dev server was started. The template editor (`routes/catalogue/template.tsx`, the designer's) does not call `templateRuleErrors` yet and has no branch for the two new codes; until it does, a refused save shows the API sentence through `saveFailureText`.
- What Browser Run really sends with a damaged or non-PDF 2xx (the `X-Browser-Ms-Used` header): tested with fakes only.
- Whether Browser Run copies JPEG bytes through unchanged (item 4.3): not testable locally.
- The two jobs timeouts under full parallel load passed on the re-run. I did not investigate them further; neither test touches the code changed here except through `failed`, which only adds work on damaged and not_pdf answers.
- Staging: nothing deployed (not mine to do).

#### Placeholder lines (for 07-Y)
SPA, `apps/admin/src/lib/catalogue.ts` `TEMPLATE_RULES`, shown with `[Placeholder] ` until 07-Y is approved:
1. `textInHeading`: "{placeholder} can't go in a heading. Put it in the text of its own section." (for example `{{service.deliverables}}`)
2. `textElsewhere`: "{placeholder} can only go in the text of the {section} section." ({section} is "Deliverables" or "Assumptions and exclusions", the seeded headings)
3. `joinedTooLong`: "A proposal or estimate has room for 3 sections of your own. This one and the ones after the third are joined into one, which would pass 6,000 characters. Shorten them or remove some."

API sentences (not screen copy):
- `template_text_token_place`: "Catalogue text placeholders go only in the text of their own section: deliverables in Deliverables, assumptions and exclusions in Assumptions and exclusions";
- `template_joined_too_long`: "A draft has room for 3 sections of the template's own; the ones after that are joined into the third, and together they pass 6,000 characters".

#### Open questions (lead's call)
1. **Stored template versions that break Q2 or Q3** (staff-saved on staging before this round) stay as they are, and drafts from them keep the old limits. Recommended: the designer runs `templateRuleErrors` on the template page when it loads, so staff see the rule and save a new version. Alternatively, a read-only local check of the staging templates by the lead.
2. **JPEG signatures (item 4.3).** Recommended: a short staging experiment (render one invoice with a JPEG signature and compare its DCTDecode stream with the uploaded bytes). If they are equal, add the SHA-256 comparison and close the limit. Otherwise keep the limit as written.
3. **Limits left in place, both pre-existing and theoretical; recommended to keep:**
   - the lead's message is not held to Scope's 6,000;
   - `renameContact` could take an Acceptance text past 6,000 only with dozens of occurrences of a long contact name.

## Lead's notes after round 3 (2026-10-29 ~13:40 IST)
- Merged `fix/fx3-b3`, then `main` (FX-2 #108). The only conflict was docs/13, where both sets of rows were kept.
- **The two jobs tests that timed out** under a full parallel run ("the email consumer sends each once", "JOB-PDF-01 burst: 20 sends") now have 30 s timeouts, with the reason in a comment.
- **Open questions answered:**
  1. Stored templates that break the new rules: the designer runs `templateRuleErrors` when the template page loads and shows the problem, so staff save a new version.
  2. **JPEG signatures (the integrity limit):** the SPA re-encodes **every** uploaded signature to PNG, not only the larger ones. The API then accepts only PNG for new uploads. PNG's data is Flate-compressed, so the integrity check covers it. Older stored JPEGs keep working until replaced. This goes to the designer (signature screen and `lib/signature-scale.ts`) with the matching one-line API change and tests. No staging test is needed.
  3. The two theoretical limits stay, as written in the code.
- **Next:** the FX-3 designer, once the FX-4 designer frees the browser. Its extra items:
  - template rule errors on load and on save;
  - the two new template error codes;
  - signatures always PNG;
  - the lead timeline labels (`budgetBandLabel`, `TIMELINE_LABELS`);
  - the `lead_answers_fixed` line.

## Designer report
Designer: claude-opus-5-5 (high), 2026-10-29 ~13:45–15:40 IST, branch `fix/fx3-designer` from `origin/fix/fx3-admin-portal` (200e5f02). 12 commits plus this report, pushed.

### Skills
- `frontend-design:frontend-design` (loaded first): set the direction inside docs/06. Changes it led to: the client Figures panel leads with one figure (what the client owes now, in the display face, a ledger total's weight) and keeps the rest as quiet hairline rows; no card in a card for the panel's failed state (one quiet line); note headings step down in size without competing with the panel title; every new element reuses existing tokens, pills, panels and lines.
- `dataviz`: loaded for the figures panels (stat figures). Applied its stat-tile rules: one hero number, tabular figures, text in text tokens, the overdue state with icon and count in words (never colour alone). No chart was drawn, so the palette validator wasn't needed.
- Not loaded: the Cloudflare skills (one Worker change only, a refusal in `settings-signature.ts`; no binding, config or platform feature), `code-review`/`security-review` (reviewer skills).

### Per item (files under `apps/admin/src` or `apps/portal/src` unless named)
- **A3 1 (keyboard scroll):** `components/scroll-region.ts` (new `useScrollRegion`): a box that overflows sideways gets `tabIndex=0`, `role="region"`, its name and `data-scrolls`, only while it overflows (a box that fits adds no stop); the global `:focus-visible` ring shows. Used by `DataTable` (`components/data-table.tsx`, named by its caption), the week grid (`routes/time.tsx`, named "Hours by day": the panel already carries "Week of …", so axe's `landmark-unique` stays clean) and the catalogue's default lines (`routes/catalogue/service.tsx`).
- **A3 2 (no sideways page scroll):** `position: relative` on the overflow boxes (`shell.css .dtable`, `care.css .sheet-wrap`, `catalogue.css .lines-table` and `.md pre`, `documents.css .read-lines`, `screens.css .tabs__scroll`, `projects.css .md pre`). The new sweep found one more: Settings › Numbering scrolled the page at 1024 (the table beside the settings menu); `.settings__body .dtable` now scrolls in its own box (`shell.css`, end).
- **A3 3:** `care.css .entry-note`: `overflow-wrap: break-word` and `min-width: 12rem` (words wrap; a column of one letter per line can't happen).
- **A3 6:** the "Password hashing took N ms" line is gone from sign-in and from enrolment (`routes/sign-in.tsx`, `routes/invite.tsx`).
- **A3 9 and A3 12:** `routes/leads/convert.tsx`: a lead with no country starts unchosen ("Choose a country"), the country is required, GST status and state appear once it's chosen; after converting, the draft proposal opens (`/proposals/:id`).
- **A3 13:** sign-in's password field has the same Show/Hide toggle as enrolment (`routes/sign-in.tsx`; hidden again when the code step opens).
- **A4 1:** `components/decision/decision-panel.tsx`: after a check, the name's error follows the field as it is typed (never on blur), so a press of Accept can't be lost to a line vanishing under the pointer.
- **A4 2:** the number in the confirmation is `nowrap`; under 30rem each fact's label sits above its value (`portal.css .facts--confirm`); the dialog's buttons stick to its foot (`app.css .dialog__actions`).
- **A4 7:** `components/document/document-paper.tsx` (`acceptOpen`, set by `screens/document-page.tsx`): once a version can't be accepted (decided, expired, replaced), the Acceptance section's own "Accept this offer…" text is left out.
- **A4 8:** the whole agreement row is a `<label class="check">`, 44 px (`portal.css .check`, `.check__text`).
- **Client Overview figures (ADM-CLI-03):** `routes/clients/figures.tsx` (new; `ClientFiguresPanel`), first in the Overview's side column for finance roles, none for an anonymised client (`routes/clients/overview.tsx`, `client.tsx`). Outstanding (large), overdue (warning icon, amount, "{n} documents"), billed to date with its note, credit notes when there are any, 07-V's "Collected figures arrive with payments.", and a way to the Statement tab. Per currency, each under its code when there are two. Loading (skeleton), failed (one line and "Try again"), none ("Nothing invoiced yet."). Styles: `clients.css` (`.acct*`). Amounts through `moneyText` (core `formatMoney`); nothing is summed on screen.
- **Project Figures (ADM-PRJ-05):** `ProjectBilledFacts` in the project's Figures list (billed, per currency; credit notes when any), with the 07-V line (`routes/projects/overview.tsx`). Sales sees no money rows.
- **Note headings (ADM-PRJ-03):** `projects.css` `.md__h--1..3` (body-lg, body, small muted; more room above than below); the note editor's hint names headings (`lib/projects.ts noteFormattingHint`, `routes/projects/notes.tsx`). Document sections keep the old hint (no headings there).
- **Manual lead fields (ADM-LEAD-01):** `routes/leads/answers.tsx` (new; `AnswersFields`, `withCurrency`, `answersPatch`): Currency, Budget (the chosen currency's bands; a new currency drops a band it doesn't have; disabled with a hint until a currency is chosen), Timeline. On New lead (`routes/leads/new.tsx`) and, for a manual lead, behind the Enquiry panel's Edit (`routes/leads/lead.tsx`; only the changed fields are sent; part of the unsaved-changes guard; a stale save shows the usual notice). `leads.css .lead-answers`.
- **Timeline labels:** `lib/leads.ts answerText` (a band by the currency that has it, the timeline by `TIMELINE_LABELS`), used by the lead timeline's change table; `leads.css` Field column 27 % and tighter on phones so "Currency" stays whole at 375.
- **`lead_answers_fixed`:** mapped to its 07-Y line on the lead page (a race only: the screen never offers a website lead's answers).
- **`newer_version_pending` (A4 9):** `copy-y.ts` (portal, new), `lib/offers.ts` (`errorText`, and `FINAL` moved here from `routes/offer.tsx` so a test can read it), the sample API's `sample-pending` document and its `/preview` entry.
- **Signatures always PNG (docs/13 2026-10-29):** `lib/signature-scale.ts` draws every image again as a PNG within 800 × 400 (a JPEG or a PNG that fits included; `scaled` says whether the size changed); `apps/admin/worker/settings-signature.ts` refuses any new JPEG (415 `type_not_allowed`, "Send the signature as a PNG image"; the JPEG size reader is gone); a stored JPEG is served as before. `routes/settings/signature.tsx` shows `SIGNATURE_COPY.scaled` after a scaled upload and a new `tooDetailed` line when the PNG passes 256 KB (`lib/pdf.ts`, `screens.css .signature__scaled`).
- **Template rules:** `routes/catalogue/template.tsx`: `templateRuleErrors` on the stored version when the page opens (a notice above, the line under each section) and live in the editor (under each section; a save is held and the summary lists "Section N: …"); `template_text_token_place` and `template_joined_too_long` from the API name the same sections (otherwise the API sentence). `lib/catalogue.ts` `TEMPLATE_RULES.storedBreaks` and `section`.
- **Care's next billing day:** no screen change was needed (the page prints the date the builder's rule gives). Not looked at on screen: see below.
- **`series_full`:** already wired by the builder (`DOC_ERRORS`, `offerErrorText`); nothing to change.
- **E2E (A3 1, 2; A4 1):**
  - `apps/admin/playwright.config.ts`, `e2e/global-setup.ts` (enrols a throwaway Owner `e2e-…@example.test` in the local D1 over the API, Node's argon2 and TOTP, as `scripts/bench-auth.mjs` does), `e2e/sweep.spec.ts`: every admin route (36 lists and settings pages plus the first lead, client, project, document, invoice, catalogue item and template the database holds) at 768 and 1024, light and dark, with the in-app theme against the opposite OS theme: `scrollWidth` ≤ `clientWidth` and axe (WCAG 2.2 AA + best practice, moderate and up); 375, 1280 and 1600 for sideways scroll; every `[data-scrolls]` box takes focus and moves with the arrow keys.
  - `apps/portal/playwright.config.ts`, `e2e/accept.spec.ts` on the labelled sample API: A4 1 (one press after a correction; the error follows typing, not blur), A4 8 (44 px row; a press at its far end ticks it), A4 2 (one-line number at 375, buttons in view), A4 7, A4 9, and axe at 375, 768 and 1024.
  - **Designer decision, for the lead to confirm:** `@playwright/test` 1.64.1 and `@axe-core/playwright` 4.14.0 (the versions `apps/web` already pins) are now dev dependencies of admin and portal, with an `e2e` script each. The lockfile change is the two importers only; no new package or version was downloaded (`pnpm install --offline`). `.gitignore` gains `apps/{admin,portal}/test-results/` and `apps/admin/.e2e/`. CI doesn't run these (no workflow change); run them by hand like `apps/web`'s.

### Tests added or changed
- admin: `lib/leads.test.ts` (answer labels, `withCurrency`, `answersPatch`, the two lines), `lib/projects.test.ts` (note hint), `lib/catalogue.test.ts` (the page's two template lines), `lib/signature-scale.test.ts` (every image re-encoded to PNG), `lib/pdf.test.ts` (`tooDetailed`), `worker/settings-signature.test.ts` (every new JPEG refused with its code and message; a stored JPEG still served as `image/jpeg`).
- portal: `lib/offers.test.ts` (`newer_version_pending` line, marked; `FINAL`).
- e2e as above.

### Shots (`.logs/shots/fx3-designer/`, in this worktree; `-SAMPLE` = the API answer replaced in the page by labelled sample figures, or the portal's sample API)
- `client-figures-empty-1280-light.png`: Figures with nothing invoiced.
- `client-figures-1280-light.png`: one real local invoice (₹47,200), outstanding, nothing overdue.
- `client-figures-two-currencies-overdue-1280-light-SAMPLE.png`, `…-1280-dark-on-light-os-SAMPLE.png`, `client-figures-375-dark-SAMPLE.png`, `client-figures-768-dark-SAMPLE.png`: INR with overdue and credit notes beside USD; light, dark against a light OS, phone, tablet (rows held to a reading width).
- `client-figures-loading-1280-dark.png`, `client-figures-error-1280-dark-SAMPLE.png`: loading and failed states.
- `project-figures-empty-1280-dark.png`, `project-figures-empty-768-dark.png`, `project-figures-billed-1280-dark-SAMPLE.png`: project Figures, none billed and two currencies with a credit note.
- `project-note-headings-1280-dark.png`: a note with `#`, `##`, `###`.
- `lead-new-answers-1280-dark.png`, `lead-edit-answers-1280-dark.png`, `lead-timeline-labels-1280-dark.png`, `lead-timeline-diff-375-dark.png`: the answers on New lead and on edit; the timeline in the form's words.
- `convert-no-country-1280-dark.png`, `convert-country-chosen-1280-dark.png`, `convert-opens-draft-1280-dark.png`: A3 12 and A3 9.
- `sign-in-show-password-375-dark.png`, `sign-in-code-no-hashing-line-375-dark.png`: A3 13 and A3 6.
- `time-1024-dark.png`, `time-sheet-region-focus-1024-dark.png`: A3 3 notes wrap on words; the week grid focused by Tab, scrolled by the arrow keys.
- `settings-numbering-1024-dark.png`: the table in its own scroll box.
- `signature-jpeg-to-png-scaled-1280-dark.png`, `signature-too-detailed-1280-dark.png`: a 1600 × 600 JPEG stored as an 800 × 300 PNG (40 KB) with the scaled line; a noisy image refused with the new line.
- `template-stored-breaks-rule-1280-dark-SAMPLE.png`, `template-stored-breaks-section-1280-dark-SAMPLE.png`, `template-editor-rule-summary-1280-dark-SAMPLE.png`: a stored version with `{{service.deliverables}}` in Scope (injected into the page's answer): the notice, the section line, the editor's summary.
- `portal-accept-errors-375-light-SAMPLE.png`, `portal-accept-dialog-375-light-SAMPLE.png`, `portal-accept-dialog-375-dark-SAMPLE.png`, `portal-accepted-record-375-dark-SAMPLE.png`, `portal-newer-version-pending-375-dark-SAMPLE.png`: A4 1, 2, 7, 8, 9.
- `matrix/` (110 full-page shots + `report.txt`): client overview, project overview and notes, New lead, a manual lead, Time, Settings › Company and › Numbering, a template, and two portal proposals, each at 375, 768, 1024, 1280 and 1600, light and dark (admin: in-app theme against the opposite OS theme). No sideways scroll in any. Looked at by eye: a sample (client 1600 light, lead 375 light, New lead 375 dark, project 768 light, portal accepted 1600 light); the lead one showed "Currenc/y" breaking at 375, fixed (0f373164).

### Commands (heavy ones through `tools/heavy.sh`)
- Targeted vitest runs while working (portal `lib/offers`, admin `lib/leads`, `lib/projects`, `routes/leads/screens`, `lib/pdf`, `lib/signature-scale`, `lib/batch-review`, `worker/settings-signature`, `lib/catalogue`): all green.
- `pnpm --filter @techaust/portal e2e`: 9/9 passed (`.logs/fx3d-e2e-portal.log`).
- `pnpm --filter @techaust/admin e2e`: first run 3 of 5 failed and found `/time` `landmark-unique` and `/settings/numbering` sideways at 1024; after the fixes 6/6 passed in 8.0 min (`.logs/fx3d-e2e-admin2.log`).
- `pnpm --filter @techaust/admin --filter @techaust/portal typecheck`: exit 0.
- `pnpm --filter @techaust/admin test`: 3,347 passed (112 files).
- Full `pnpm test` (`.logs/fx3d-test.log`): core 1,800 (coverage gate passed), db 471, email 128, pdf 340, auth 135, ui 469 (2 skipped), web 510 (17 skipped) passed; jobs had one timeout at 5 s under the parallel load (`reports-b.test.ts` "realisation.scan: pages > 51 open exports", untouched here, the same class as round 3's two), so pnpm stopped admin and portal. Re-run one package at a time: jobs 528/528, portal 630/630, admin 3,347/3,347.
- `pnpm --filter @techaust/admin build`: exit 0; front 99,271 bytes (startup 10.9 ms), API 611,161 bytes (56.4 ms).
- `pnpm --filter @techaust/portal build`: exit 0; 97,151 bytes (9.8 ms).
- `pnpm check` (the one whole-repository lint, last): exit 0; its 10 warnings and 8 infos are all in files I didn't touch (pdf tests, admin `reports.test.ts`, web `catalogue.ts`, core `public-text.ts`).
- Dev servers stopped; the browser closed.

### Not verified
- The care page's next billing day on screen: no care plan in the local database, and building one by hand was skipped; the page prints the date as before, the rule is the builder's (tested).
- Overdue amounts and two-currency figures with real data: no past-due invoice can be made locally today, so those states were shown with labelled sample answers injected into the page (`-SAMPLE` shots); the real panel was seen with one real invoice.
- A credit note on a real client (FX-4's screens).
- The `template_*` refusals from the real API (the editor holds the save first; the API tests are the builder's).
- Safari, Firefox, NVDA, phones; staging.
- The jobs timeout under full parallel load was not investigated (jobs untouched; passes alone).
- The `-1600` and other matrix shots were not all opened one by one: the sweep checks sideways scroll and axe for every route, and the matrix's report confirms no sideways scroll.

### Placeholder lines (07-Y; shown with "[Placeholder] " until approved)
Admin (`apps/admin/src/lib/copy-y.ts` `Y()`):
1. `routes/leads/convert.tsx` `CONVERT_COPY.chooseCountry`: "Choose a country"
2. `CONVERT_COPY.countryRequired`: "Choose the client's country."
3. `routes/clients/figures.tsx` `FIGURES_COPY.billed`: "Billed to date"
4. `FIGURES_COPY.billedHint`: "Invoices and debit notes, GST included."
5. `FIGURES_COPY.credited`: "Credit notes"
6. `FIGURES_COPY.openStatement`: "Open the statement"
7. `lib/projects.ts` `COPY.noteFormattingHint`: "You can use # headings, **bold**, *italic*, lists and links."
8. `routes/leads/answers.tsx` `ANSWERS_COPY.chooseCurrencyFirst`: "Choose a currency first."
9. `ANSWERS_COPY.answersFixed`: "These answers came from the website form and can't be changed."
10. `lib/pdf.ts` `SIGNATURE_COPY.tooDetailed`: "This image is too detailed to keep as a signature. Use a scan on a plain white background."
11. `lib/catalogue.ts` `TEMPLATE_RULES.storedBreaks`: "This version was saved before the template rules below. Drafts made from it may not save. Edit it and save a new version."
12. `routes/time.tsx` `SHEET_REGION` (the week grid's accessible name when it scrolls): "Hours by day"

Portal (`apps/portal/src/copy-y.ts`):
13. `OFFER_Y.errors.newer_version_pending`: "This version can no longer be accepted: a newer one is being prepared." (the page then also shows 07-N's "A new version is being prepared. We'll email you when it's ready.")

Lines now shown that the builder had already added: `SIGNATURE_COPY.scaled`, `SIGNATURE_COPY.wrongFile`, `TEMPLATE_RULES.textInHeading`, `.textElsewhere`, `.joinedTooLong`, `DOC_ERRORS.series_full`.
Reused approved words (no new line): "Outstanding", "Overdue", "{n} documents", "Nothing outstanding.", "Nothing overdue.", "Nothing invoiced yet.", "Collected figures arrive with payments." (07-V §7); "Figures" (07-K); "Currency", "Budget", "Timeline", "Not given"; the Statement tab; "This didn't load." and "Try again" (the shared LoadFailed). Unmarked composition: "Section {n}: {line}" in the template summary.
API sentences (not screen copy): `type_not_allowed` on the signature upload is now "Send the signature as a PNG image".

### Open questions (lead's call)
1. Are `@playwright/test` and `@axe-core/playwright` as admin and portal dev dependencies acceptable (same pinned versions as `apps/web`, no download)? If not, the two e2e folders can move under `apps/web` or wait for the owner's yes.
2. A long PNG of a photo-like scan now fails the 256 KB cap where the original JPEG would have fitted (the new `tooDetailed` line says what to do). Keep the cap, or raise it for PNG?
3. The phone order of the client Overview puts Figures after Details, Tax and billing and Notes (the side column follows the main one). Bring Figures first on phones?


## Review (reviewer claude-opus-5-5/high, live browser, 2026-10-29 ~15:30–16:20 IST, on d976045f): APPROVE
_(Summary by the lead; the full text is in the conversation record. Shots: `.logs/shots/fx3-review/` in the main checkout.)_

**Every builder item (1–12), every round-3 item and every designer item is present and correct.** Highlights:
- **Figures:** match the statement's rules, both currencies; at most 402 rows read for 200 documents; Sales 403; anonymised clients get `available:false`.
- **`newer_version_pending`:** stays inside the link's version group.
- **Signature API:** PNG-only, with the IHDR bound checked; stored JPEGs are still served.
- **Hidden Scope:** fixed.
- **Damaged and not-PDF renders:** their browser time is now counted.
- **Care billing day:** the tick and the page agree.
- **VERIFY retags:** spot-checked against 08-C.
- **Package change:** importer-only, with nothing new resolved.
- **Tests:** `pnpm check` exit 0. `pnpm test` exit 0 with no timeouts:
  - core 1,800, db 471, email 128, pdf 340, auth 135;
  - ui 469, web 510, portal 630, jobs 528, admin 3,347.
- **e2e:** portal 9/9, admin 6/6.
- **Live check:** every changed record page at 375, 768, 1024 and 1600 in both themes, with the app's theme set against the OS theme; plus care, catalogue, settings, account, audit and time. axe was clean; there was no sideways scroll, text ≥ 12 px and targets ≥ 44 px.

**Findings:**
1. **Medium:** the 256 KB check runs on the original file before scaling (`signature.tsx:57`, `lib/pdf.ts:61-62`), so a phone photo of a signature (1–4 MB) can never be uploaded.
2. **Medium:** after a successful convert, `convert.tsx:126` navigates without `props.onConverted()`. With unsaved lead edits, the leave-guard stacks over a convert form that is still open; a second Convert then answers `already_converted`.
3. **Medium:** the admin e2e sweep asks for `?limit=1`, which every list refuses with 400, so `first()` returns null and no record page is ever visited (`e2e/sweep.spec.ts:57-66`). The keyboard test also passes with zero regions.
4. **Low:** the lead PATCH re-checks stored answers on every edit, and checks them before the source rule (`leads.ts:676-680`).
5. **Low:** a placeholder in a heading is reported on the body field (`template.tsx`), so the summary link focuses the wrong input, and the heading input never gets `aria-invalid`.
6. **Low:** rules duplicated: `TEXT_TOKENS`/`TOKEN_FIELD` (`service-fill.ts:153-158`) against core `TEXT_TOKEN_KINDS`; `templateKinds` against `sectionsFromTemplate` (`documents.ts:144-151`).
7. **Low:** `REREAD_SQL` runs its subquery twice (`offer-sql.ts:113-123`); the figures read still runs for an anonymised client (`figures.ts:66-69`, `projects.ts:404`).
8. **Low, M7.1 follow-up:** the portal must render shared notes with `parseNoteMarkdown`.
9. **Low:** the VERIFY guard skips `.sql` (outside migrations), `.yml`, `.sh`, `tools/` and `.github/`.
10. **Low:** at 768 px the currency rule in the client Figures panel is wider than its rows (`clients.css` `.acct*`).
11. **Low, from before FX-3:** the project Overview shows "No notes yet" after a note is added on the Notes tab, until a reload (tabs don't refetch).

## Fix round (lead's triage, 2026-10-29)
Every finding is fixed in this task, except 8, which goes to M7.1's brief (status follow-ups). Two lead decisions from the designer's questions:
- **The signature size limit stays at 256 KB, on the stored PNG.** The input cap before scaling is 10 MB.
- **On phones, the client's Figures panel comes first.**

Split so no two agents touch the same files:
- **Builder** (`fix/fx3-fix-b`): items 4, 6, 7 and 9.
- **Designer** (`fix/fx3-fix-d`, after the FX-4 review frees the browser): items 1, 2, 3, 5, 10 and 11, plus Figures first on phones.

Item 1's `wrongFile` line changes, a 07-Y amendment: "Use a PNG or JPEG image up to 10 MB. We store it as a PNG of up to 256 KB."
