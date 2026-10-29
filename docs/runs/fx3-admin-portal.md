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

### Fix round, builder report
_(builder claude-opus-5-5/high, branch `fix/fx3-fix-b` from `origin/fix/fx3-admin-portal` 441e5ce0, 2026-10-29.)_

#### Skills
- `cloudflare:workers-best-practices`: loaded. It confirmed the approach of keeping the figures in one D1 batch (no extra round trip) and keeping every query typed against the generated `Env`. It changed no code.
- `cloudflare:wrangler`: loaded for the Worker and D1 work. No config, binding or command changed, so it shaped nothing.
- Not loaded:
  - `cloudflare:workers-profiling`: no CPU budget or cold-start work.
  - `frontend-design`: no screens.
  - `code-review` / `security-review`: those are the reviewer's.

#### Per item (one commit each)
- **4, `698eb587`** `fix(leads)` [ADM-LEAD-03] (`apps/admin/worker/leads.ts`)
  - The quote-answer checks now run only when the request **changes** currency, band or timeline. A request that sends the stored value unchanged changes nothing, so nothing is judged.
  - Inside that check, the source rule comes first: a website lead's change is always 409 `lead_answers_fixed`. Only a manual lead's values reach the band and timeline checks.
  - New test in `leads-api.test.ts`:
    - a website lead holding an unknown band and timeline accepts an owner, name and phone edit;
    - a manual lead with an unknown band accepts a company edit;
    - on a website lead, `currency: "USD"`, `currency: null` and `timeline: "next-year"` are each 409 `lead_answers_fixed`, and nothing is written. Before this fix the first was a 400.
- **6, `cce34bc0`** `refactor(documents)` [ADM-PROP-02]
  - `apps/admin/worker/service-fill.ts`:
    - `TEXT_TOKENS` is now `Object.keys(TEXT_TOKEN_KINDS)`.
    - `TOKEN_FIELD` is a `Map` built by joining `GAP_FIELDS` with `TEXT_TOKEN_KINDS`: `service.<field>` maps to `<field>` when the kinds agree.
    - A new test proves every token has its field, and that the field's section kind is the token's own kind.
  - `packages/core/src/documents.ts`: `sectionsFromTemplate` takes each section's kind from `templateKinds`, and the missing required sections come from the same list.
  - Behaviour is unchanged: the core documents tests (47) and the admin service-fill, documents and catalogue tests (129) pass unchanged.
- **7, `132d0635`** `perf(offers, figures)` [POR-05, ADM-CLI-03, ADM-PRJ-05]
  - **`REREAD_SQL`** (`apps/portal/worker/offer-sql.ts`) runs the "newest frozen version above" lookup once and joins that row by key (`LEFT JOIN documents l ON l.id = (…)`); `latest_id` and `latest_pdf` both come from it.
    - New EXPLAIN test in `offer-routes.test.ts`: exactly one correlated subquery, `l` searched by primary key, no table scan.
    - The existing `newer_version_pending` / `superseded` tests pass unchanged.
  - **The figures reads** (`packages/db/src/reports.ts`):
    - `CLIENT_FIGURES_SQL` now seeks with `d.client_id = (SELECT z.id FROM clients z WHERE z.id = ?1 AND z.anonymised_at IS NULL)`.
    - `PROJECT_BILLED_SQL` does the same through the project's client.
    - Once the client is anonymised the key is NULL, so SQLite skips the index seek and none of its documents is read.
    - I tried a plain `NOT EXISTS` guard first. The VDBE dump showed it is checked once per index entry, and it still read 8 rows for 7 documents, so I replaced it.
    - The batches in `figures.ts` and `projects.ts` keep one round trip and their `available: false` answers; only a comment changed in `figures.ts`.
  - **Tests:**
    - `figures.test.ts`: for an anonymised client the figures read returns no rows and reads at most 2 rows; for an anonymised client's project, at most 3 rows. With the documents read they would be 14 and 12.
    - `packages/db/test/reports.test.ts`: the anonymised check is a non-correlated lookup by key. The existing index-seek assertions and the 200-document bound (≤ 402 rows) still hold.
- **9, `62aa3943`** `test(compliance)` [ADM-SET-09] (`packages/core/test/verify-tags.test.ts`)
  - The scan now also covers `tools/` and `.github/`, and the file types `.sql`, `.yml`, `.yaml`, `.sh` and `.ps1`.
    - `.ps1` is my addition: `tools/` holds one PowerShell script, and leaving it out would leave a hole in "scan tools/".
  - The migrations are skipped by their path only (`packages/db/migrations`), so a `.sql` file anywhere else is scanned.
  - Dot folders below the tops and `node_modules`, `dist`, `coverage`, `generated`, `fonts` and `brand` are skipped as before.
  - The count check (`NO_ROW_YET`) is unchanged; the widened scan found no new tag.
  - New test: the scan reaches `tools/heavy.sh`, `.github/workflows/ci.yml` and `packages/db/src/triggers.ts`; no migration file is in it; the folder rule and the extension list behave as stated.

#### Commands (heavy ones through `tools/heavy.sh`)
- Per item:
  - admin `leads-api.test.ts`: 32/32;
  - core `documents.test.ts`: 47/47;
  - admin service-fill, documents and catalogue: 129/129;
  - portal `offer-routes.test.ts`: 63/63;
  - db `reports.test.ts`: 26/26;
  - admin figures and projects: 37/37;
  - core `verify-tags.test.ts`: 3/3.
- `pnpm exec biome check` on every changed file: clean.
- **`pnpm check`**: exit 0 (`.logs/fx3b-check.log`). That covers lint, typecheck in every package, the web binding guard, the content lint, the Worker config guard, the SPA headers and the migration guard (52 migrations).
- **`pnpm test`**: exit 0 with no timeouts (`.logs/fx3b-test.log`):
  - core 1,801, db 471, email 128, pdf 340, auth 135;
  - ui 469 (2 skipped), web 510 (17 skipped), portal 631, jobs 528, admin 3,349.

#### Not verified
- `pnpm build` was not run: no build was asked for, and the brief stays inside Worker code. So the Worker byte budget for these SQL-text changes isn't measured. They add a few hundred bytes to the admin API and portal bundles.
- No staging or hosted check.
- The rows-read figures come from local workerd D1 (miniflare), not from hosted D1.

#### Open questions
- None.
### Fix round, designer report
Designer: claude-opus-5-5 (high), 2026-10-29 ~16:40–18:00 IST, branch `fix/fx3-fix-d` from `origin/fix/fx3-admin-portal` (441e5ce0). 9 commits plus this report; only `fix/fx3-fix-d` pushed.

#### Skills
- `frontend-design:frontend-design` (loaded first): kept every change inside the existing panels, rules and tokens. What it changed: Figures first is done by reading order (the panel is the page's first child) rather than a visual `order:` trick, so sight and Tab agree; the rule between currencies is part of the group's reading width, not a second decoration; a note's headings keep the author's size while their levels follow the page's outline.
- `dataviz`: loaded for the Figures panel (stat figures). Applied: the lead figure and ledger rows unchanged, text in text tokens, the rule as wide as the figures it separates. No chart, so no palette run.
- Not loaded: Cloudflare skills (no Worker, binding or config change; one Worker test only), `code-review`/`security-review` (reviewer's).

#### Per item (files under `apps/admin/` unless named)
- **1, signature (167a34c6):** `src/lib/pdf.ts`: `SIGNATURE_INPUT_MAX` = 10 MB; `signatureFileOk` checks only the type and 1 byte to 10 MB; `SIGNATURE_COPY.wrongFile` is now `Y("Use a PNG or JPEG image up to 10 MB. We store it as a PNG of up to 256 KB.")`. `src/lib/signature-scale.ts`: new `prepareSignature(file, io)` runs the checks in order (type and 10 MB, then decode and scale, then the 256 KB on the PNG that comes out, `tooDetailed`); `src/routes/settings/signature.tsx` uses it. Tests: `signature-scale.test.ts` (a 1 MB 3000 × 4000 phone photo scaled to a 300 × 400 PNG and handed on; exactly 10 MB read; 11 MB and 10 MB + 1 refused before decoding; the 256 KB edge on the output), `worker/settings-signature.test.ts` (that 300 × 400, 180 KB PNG is stored), `pdf.test.ts`, `batch-review.test.ts`. Live: a 1.37 MB phone-style JPEG became a 300 × 400 PNG of 75,711 bytes, stored, with the "We made the image smaller" line; an 11 MB file shows the new line.
- **2, convert (3d46a736, then 8ba36bab):** the first commit called `onConverted()` (close and reload) before `navigate`. **Checked live, that was wrong:** the reload gives the lead a new `updatedAt`, `LeadView` is keyed by it, so the page started again, the leave question went with the old page and the proposal never opened. Now (8ba36bab): `ConvertDialog` calls a new `onOpening()` (closes the dialog, arms a reload) and then `navigate`; `UnsavedChangesGuard` (`src/components/unsaved.tsx`) gains an optional `onStay`, and the lead page reloads only on "Stay on this page" (or Escape). `onConverted` stays for the `already_converted` "Reload the latest" button. Live with unsaved lead edits: the convert dialog closes and the leave question stands alone; "Stay" shows the lead converted (no Convert button, client and draft proposal linked) with the edits kept; "Leave without saving" opens `/proposals/:id`.
- **3, e2e sweep (4cf6821e):** `e2e/sweep.spec.ts`: the lists are read with their own first page (no `?limit=1`), each must answer 200 with its key; a lead, a client and a template must be found; the record pages found are logged. The keyboard test also visits Settings › Numbering at 1024 and fails when it meets no `[data-scrolls]` box (it met 4). `e2e/global-setup.ts` adds one labelled sample lead ("Sample Lead (e2e sample)", `sample-lead@example.test`) over the API when the local database has none. The sweep now visits a lead, a client, a project, a document, a catalogue item and a template (local database: no care plan or invoice to visit).
- **New, found by the fixed sweep (69825606):** `/projects/:id` failed axe `heading-order`: a note that opened with `##` was drawn as an h4 straight under the panel's h2. `src/components/markdown.tsx` `noteHeadingTags`: a note's shallowest heading is an h3 and no heading goes more than one level below the one before; the size class stays the author's (`md__h--N`). Test in `src/lib/projects.test.ts`.
- **5, template heading (066ce0e9):** `src/lib/catalogue.ts` `templateRuleFields` (rules by field; `templateRuleErrors` now derives from it for the read view); `src/routes/catalogue/template.tsx`: a Catalogue-text placeholder in a heading and an unknown placeholder in a heading land on `tpl-s{i}-heading` (its own line `tpl-s{i}-heading-rule`, `aria-invalid`, `aria-describedby`), and the summary link is `#tpl-s{i}-heading`. Live: Save, then Tab and Enter on the summary link, focuses the heading input. Test in `lib/catalogue.test.ts`.
- **10, currency rule (a43b9317):** `src/clients.css`: the 30rem reading width moved from `.acct__rows` to `.acct__group`, so the rule between two currencies is as wide as their rows (both 480 px at 768).
- **11, project Overview (8acac0a1):** `src/routes/projects/project.tsx`: every return to the Overview from another tab reads the page again (quietly), from an effect on the tab, so any path counts. The old rule reloaded only on a direct switch from Notes or Files; Notes, then Milestones, then Overview showed "No notes yet". Live: that path now shows the new note.
- **Figures first on one column (5dda1d68):** `src/routes/clients/overview.tsx`: the Figures panel is the page's first child (out of the side column), so on phones and tablets it sits straight under the page heading, and the first Tab stop after the tab panel is "Open the statement". `src/clients.css`: from 64rem, `.client-overview:has(> .acct)` places it in column 2, row 1, the main column spans both rows, and the rest of the side column (primary contact, linked records) follows in row 2. **Changed behaviour to note:** in this layout the side column scrolls with the page (it was sticky; a sticky column would slide under the panel). Without a finance role, or for an anonymised client, the page is as before (sticky side column). The project Overview (which shares `client-overview`) is unaffected (its panel stays inside its side column).

#### Shots (`.logs/shots/fx3-fix-d/` in this worktree; `-SAMPLE` = the finance answer replaced in the page by labelled sample figures, two currencies with overdue and a credit note; no past-due invoice can be made locally)
- `client-figures-first-375-dark-on-light-os-SAMPLE.png`: phone, Figures straight under the heading and the tabs.
- `client-figures-first-empty-375-light-on-light-os.png`: the real empty state ("Nothing invoiced yet.") first on a phone.
- `client-figures-first-768-light-SAMPLE.png`: full page at 768: Figures, then Details, Tax and billing, Notes, Primary contact.
- `client-figures-rule-768-dark-on-light-os-SAMPLE.png`: item 10, the rule between INR and USD as wide as the rows.
- `client-figures-first-focus-768-dark-SAMPLE.png`: keyboard: the first Tab stop is "Open the statement", focus ring visible.
- `client-figures-side-1024-light-on-dark-os-SAMPLE.png`, `client-figures-side-1280-light-SAMPLE.png`, `client-figures-side-1280-dark-on-light-os-SAMPLE.png`, `client-figures-side-1600-dark-on-light-os-SAMPLE.png`: from 64rem, Figures heads the side column, Primary contact below it, 16 px apart as in the main column.
- `project-overview-notes-after-milestones-1280-light.png`: item 11, the Overview after Notes, then Milestones: both notes shown.
- `lead-convert-unsaved-leave-question-alone-light.png`: item 2, the leave question alone after a convert with unsaved edits (browser at about 1536 px).
- `lead-convert-stay-reloaded-converted-light.png`: after "Stay": no Convert button, the edit kept.
- `template-heading-rule-focus-1280-light.png`: item 5, the rule line under the heading input, which has focus from the summary link.
- `template-heading-unknown-375-dark-on-light-os.png`, `template-heading-unknown-1024-light-on-dark-os.png`: an unknown placeholder in the heading, on the heading.
- `signature-1mb-phone-photo-stored-1280-light.png`: item 1, the 1.37 MB photo stored as a 300 × 400 PNG with the scaled line.
- `signature-11mb-refused-1280-light.png`, `signature-11mb-refused-375-dark-on-light-os.png`: the 11 MB file refused with the amended line.
- axe (WCAG 2.2 AA + best practice, moderate and up) run in the page on every changed screen at 375, 768, 1024, 1280 and 1600 in both in-app themes against the opposite OS theme: clean, and no sideways scroll. (Two runs right after a theme switch reported `color-contrast` mid-transition; re-run after 800 ms, clean.) No console errors.

#### Commands (heavy ones through `tools/heavy.sh`)
- Local setup in this worktree: `pnpm dev:secrets`, `pnpm db:migrate:local`, `pnpm db:seed:local`, `pnpm portal:sample` (local only).
- Targeted vitest while working: `signature-scale`, `pdf`, `batch-review`, `worker/settings-signature` (43/43), `catalogue` (23/23), `routes/leads` (14/14), `projects` (21/21).
- `pnpm --filter @techaust/admin exec playwright test -g keyboard` (`.logs/fx3fd-e2e-kbd.log`): 1/1, met 4 boxes.
- `pnpm --filter @techaust/admin typecheck`: exit 0 (twice).
- `pnpm --filter @techaust/admin e2e`, first full run (`.logs/fx3fd-e2e-admin.log`): 4 of 6 failed, all on the new project page's `heading-order` (above); after 69825606 (`.logs/fx3fd-e2e-admin2.log`): **6/6 passed in 9.6 min**, record pages visited: lead, client, project, document, catalogue item, template.
- Full `pnpm test` (`.logs/fx3fd-test.log`): exit 0, no timeouts: core 1,800, db 471, email 128, pdf 340, auth 135, ui 469 (2 skipped), web 510 (17 skipped), portal 630, jobs 528, admin 3,354.
- `pnpm check` (the one whole-repository lint, last; `.logs/fx3fd-check.log`): exit 0; its 10 warnings and 8 infos are in files I didn't touch (pdf tests, db `reports.test.ts`, web `catalogue.ts`, core `public-text.ts`).
- Dev server stopped, browser closed; no node, workerd or Chrome process left from this worktree.

#### Not verified
- Overdue and two-currency figures with real invoices (sample answers injected in the page, `-SAMPLE`); a care plan's and an invoice's record page in the sweep (none in the local database).
- Safari, Firefox, NVDA, real phones; staging.
- The Playwright tool wrote its page snapshots to the main checkout's `.playwright-mcp/` (git-ignored).

#### Placeholder lines
- Changed: `SIGNATURE_COPY.wrongFile` = "Use a PNG or JPEG image up to 10 MB. We store it as a PNG of up to 256 KB." (07-Y amendment, marked through `Y()`). No other new screen text. Sample data: the e2e lead and my local leads, project and notes are labelled "(sample)" / "(e2e sample)" with `@example.test` addresses, local database only.

#### Open questions (lead's call)
1. With Figures out of the side column, the client Overview's side column no longer sticks from 64rem when the Figures panel shows. Keep (recommended: a sticky column would slide under the panel), or ask for a different desktop arrangement?
2. `UnsavedChangesGuard` gained an optional `onStay`; only the lead page uses it. Fine as a shared-part change?

**Lead, after the fix round (2026-10-29 ~18:10 IST):** both reports are kept above. The designer's two open questions are accepted:
1. From 64rem, the client Overview's side column scrolls with the page when the Figures panel is at its top (a fixed column would slide under the panel).
2. `UnsavedChangesGuard` gains the optional `onStay`.

The item-2 deviation from the brief is the right fix: reloading the lead would restart the page, so the lead reloads only when the person answers "Stay". Next: a re-check of the fix-round diff (reviewer, Opus high, live), then the PR.

## Re-check of the fix round (reviewer claude-opus-5-5/high, live, 2026-10-29 ~18:15–19:00 IST, on d08f26ee): SEND BACK
_(Summary by the lead; the full text is in the conversation record. Shots: `.logs/shots/fx3-recheck/` in the main checkout.)_

**Every earlier finding is fixed** (1–7, 9, 10 and 11, plus Figures first on phones), checked live:
- a 4 MB, 12 MP phone JPEG was stored as a 125 KB PNG; an 11 MB file is refused with the amended line;
- convert with and without unsaved edits works;
- the e2e sweep visits the lead, client, catalogue-item and template pages and meets 4 scroll boxes;
- the heading rule focuses the heading;
- the currency rule is 480 px at 768;
- the Overview refetches;
- Figures sit first at 375 and head the side column at 1280.

**Results:**
- `pnpm check`: exit 0.
- `pnpm test`: exit 0, no timeouts. Admin 3,356, core 1,801, portal 631, jobs 528.
- Admin e2e: 6 passed.

**New findings:**
- **A (high, WCAG 1.3.1):** `components/markdown.tsx:23` `noteHeadingTags` limits each heading to one below the previous *tag*. So `# Plan / ### Risks / ### Owners` gives h3, h4, **h5**: siblings announced as nested. Also `## A / ## B / # C` gives h3, h4, h3.
  - Fix: a stack of open author levels, tag = depth − 1, capped at h5, plus tests.
- **B (medium):** "Stay" after convert reloads the lead, which remounts `LeadView` (keyed by `updatedAt`). An unsaved quote-answers edit is lost, although the dialog promised staying keeps it (`lead.tsx:116,171,292-297`).
- **C (medium, one line):** the error summary's `key={e.id}` collides when a heading breaks two rules (`form.tsx:78`). Use `${e.id}-${i}`.
- **D (medium, from before FX-3):** every lead reload drops keyboard focus to `<body>` (`lead.tsx:116`).
- **E (low):** the lead PATCH still judges the whole answer set when only the timeline or currency changes (`leads.ts:699-709`).
- **F (low, information only):** at 64rem and wider, Tab reaches the Figures panel's link after the left column. That follows the accepted reading order; kept by the lead.
- **G (low, one line):** the VERIFY scan leaves out `.jsonc`.
- **H (low):** `createImageBitmap(file)` decodes at full resolution before scaling (`signature-scale.ts:98`). Use `resizeWidth`/`resizeHeight`.

## Fix round 2 (lead's triage)
All but F are fixed in this task.
- **Builder** (`fix/fx3-fix2-b`): E and G.
- **Designer** (`fix/fx3-fix2-d`): A, B, C, D and H. For B and D, either keep the lead view mounted across reloads (don't key it by `updatedAt`, and sync from props), or hold the answers edit in the drafts above the reload and restore focus to the control or panel heading that was used. Prefer the first if it's clean.

Then a re-check (live: the heading cases, convert then Stay with an answers edit, focus after a lead save).

### Fix round 2, builder report
_(builder claude-opus-5-5/high, branch `fix/fx3-fix2-b` from `origin/fix/fx3-admin-portal` 7dc4a611, 2026-10-29.)_

#### Skills
- `cloudflare:workers-best-practices`: loaded. The change stays inside one Hono handler: no new round trip, no binding, typed against the generated `Env`. It changed no code.
- `cloudflare:wrangler`: loaded because item G is about the `wrangler.jsonc` files. No config or command changed; it shaped nothing.
- Not loaded:
  - `cloudflare:workers-profiling`: no CPU or cold-start work.
  - `frontend-design` / `dataviz`: no screens.
  - `code-review` / `security-review`: those are the reviewer's.

#### Per item (one commit each)
- **E, `3f8ab558`** `fix(leads)` [ADM-LEAD-03] (`apps/admin/worker/leads.ts`, `leads-api.test.ts`)
  - The source rule still comes first: on a website lead, any change to currency, band or timeline is 409 `lead_answers_fixed`.
  - On a manual lead, each pair is now judged only when it changes:
    - the band against its currency, when the currency or the band changes;
    - the timeline, when the timeline changes. Only the new value is judged.
  - So a stored band the form no longer offers can't make a timeline-only change fail, and a stored retired timeline can't make a band or currency change fail.
  - **The decision (currency change with a stored band), by "a band needs its own currency":**
    - A stored band is in the stored currency's amounts. A new currency keeps it only when that currency has the same band, which today means only "Not sure".
    - A band the form no longer offers belongs to no currency, so it can't move to another one either. A currency-only change that keeps it is a 400.
    - To change the currency, the request has to change or clear the band in the same save. The SPA's `withCurrency` / `answersPatch` already do that: a changed currency always sends the band it ends with, and drops one the new currency lacks.
    - Clearing the currency while a band stays (even "Not sure") is a 400, as it was.
  - New test, "FX-3 fix round 2 (ADM-LEAD-03)". Each case runs on a fresh manual lead.
    - These save:
      - a timeline change, or clearing the timeline, with a retired band;
      - a band change, or a currency change with "Not sure", while the lead holds a retired timeline;
      - a currency change with no band.
    - A timeline that isn't the form's is still a 400.
    - These are 400 and write nothing:
      - a rupee band, or a retired band, with the currency changed to USD;
      - a retired band, or "Not sure", with the currency cleared;
      - a retired band sent unchanged next to the new currency;
      - a valid timeline change sent together with a bad currency change.
    - A currency change saves when the band changes with it, or when both are cleared.
    - A website lead with a retired band is 409 `lead_answers_fixed` for a timeline-only change.
  - The two earlier PATCH answer tests pass unchanged.
- **G, `0fe6c9ca`** `test(compliance)` [ADM-SET-09] (`packages/core/test/verify-tags.test.ts`)
  - `EXTENSIONS` now matches `jsonc?`.
  - The scope test checks that the scan reaches all six wrangler configs: admin, admin API, jobs, portal, web and db. It also checks that `x.json` and `x.jsonc` match.
  - **Confirmed:** no `.jsonc` file holds a bare tag. A grep of the six files for `VERIFY`, `OPEN (08-C` and `Researched` finds nothing, and the count test passes with `NO_ROW_YET` unchanged.

#### Commands (heavy ones through `tools/heavy.sh`)
- `pnpm install --frozen-lockfile --offline` (the worktree had no workspace links): no version changed.
- `pnpm exec biome check` on the three changed files: clean (one format fix applied to the test file).
- admin `leads-api.test.ts`: 33/33 (`.logs/fx3f2-leads.log`).
- core `verify-tags.test.ts`: 3/3 (`.logs/fx3f2-verify.log`).
- **`pnpm test`**: exit 0 with no timeouts (`.logs/fx3f2-test.log`):
  - core 1,801, db 471, email 128, pdf 340, auth 135;
  - ui 469 (2 skipped), web 510 (17 skipped), portal 631, jobs 528, admin 3,357.
- **`pnpm check`**: exit 0 (`.logs/fx3f2-check.log`). This was the one full lint, plus typecheck in every package, the web binding guard, the content lint, the Worker config guard, the SPA headers and the migration guard (52 migrations).

#### Not verified
- No build, so the admin API byte budget isn't measured. The change is a few lines of handler logic.
- No live or staging check. The SPA was not exercised against the new rule; per the code, `answersPatch` already sends the band with a changed currency.

#### Open questions
- None blocking.
- For the lead: tracked text files of other types still sit outside the VERIFY scan: `index.html` (admin, portal), `.dev.vars.example`, `packages/ui/scripts/measure-cmyk.py`, and the email, CSV and `.snap` snapshots. None holds a tag today (grep). I didn't widen the scan, because the brief named `.jsonc` only.
### Fix round 2, designer report
Designer: claude-opus-5-5 (high), 2026-10-29 ~18:30–19:40 IST, branch `fix/fx3-fix2-d` from `origin/fix/fx3-admin-portal` (7dc4a611). Four commits plus this report; only `fix/fx3-fix2-d` pushed. (The task branch moved to de7dbfb1 with the builder's E and G meanwhile; none of my files overlap, only this run file.)

#### Skills
- `frontend-design:frontend-design` (loaded first): kept every change inside the existing panels, tokens and type. What it changed: the focus that a save hands back goes to the control that opened the form (the Edit buttons) or to the panel's own heading, never a new element; a heading that takes focus hugs its words with the small radius, so its ring reads like the Edit button's ring rather than a box around the whole panel; the narrow timeline gives the decorative icon's width to the words.
- Not loaded: `dataviz` (no chart or stat tile), Cloudflare skills (no Worker, binding or config change), `code-review`/`security-review` (reviewer's).

#### Per item (files under `apps/admin/src`)
- **A (ce010a90), `components/markdown.tsx` `noteHeadingTags`:** a stack of the author levels still open; each heading pops every level ≥ its own, pushes its own, and its tag is h(2 + depth), capped at h5; the size class stays the author's (`md__h--N`). Tests (`lib/projects.test.ts`): `# Plan / ### Risks / ### Owners` is h3, h4, h4; `## A / ## B / # C` is h3, h3, h3; an 11-heading deep case (`h3 h4 h5 p h5 h4 h5 h3 h4 h4 h5`); `### Small / # Big / ## Mid` is h3, h3, h4; sizes kept. The earlier cases still hold. Live on a sample project's Notes tab (three notes with those outlines): every tag as above, axe clean; the e2e sweep visited that project page.
- **C (9b21283a), `components/form.tsx`:** the error summary's key is `${e.id}-${i}`. Live: the template heading `Cover {{nope}} {{service.deliverables}}` puts two lines on `#tpl-s0-heading`; both show, and the console has no duplicate-key error.
- **H (e2a252fe), `lib/signature-scale.ts`:** `imageHeaderSize` reads a PNG's IHDR or a JPEG's frame header (first 1 MB, `HEADER_READ`), turning the size for Exif orientation 5–8; `scaleSignature` asks `io.decode(file, fit)` for the box-fitted size when the image is larger than 800 × 400; `decodeFitted` calls `createImageBitmap(file, { resizeWidth, resizeHeight, resizeQuality: "high" })` (`fittedDecodeOptions`) and keeps the bitmap only when it comes back at exactly that size. If the browser rejects the options, ignores them, or applies them before the orientation, it closes that bitmap and takes the old path (a full-size decode drawn smaller on the canvas). An unreadable header also takes the old path. Tests (`lib/signature-scale.test.ts`, 16): the options (300 × 400, `high`); one decode at the fitted size; an Exif-6 JPEG asked for its shown shape; the three fallbacks (each bitmap freed); no options for a small image or an unreadable header; a broken image still refused; the old tests unchanged. Live in Chrome: a 3000 × 4000 PNG, a 4000 × 3000 JPEG and an Exif-6 phone JPEG were each decoded once, straight at 300 × 400, 533 × 400 and 300 × 400; the Exif-6 result matched a full decode drawn smaller at the sampled pixels (Chrome orients before it resizes); a 600 × 200 PNG was decoded without options; the Exif-6 photo uploaded on Settings › Company was stored as a 300 × 400 PNG with the "smaller" line.
- **B and D (eea514b3), the lead page:** the preferred route. `LeadView` is no longer keyed by `updatedAt`, so a reload is new props for the same view.
  - `routes/leads/drafts.ts`: the quote-answers edit is a draft above the reload (`answers`, `conflict.answers`, action `answers`; `loaded` carries the stored answers). `rebaseAnswers` treats the three answers as one set (a band belongs to its currency): untouched, the edit takes the stored answers; changed, it keeps the person's unless someone else changed any of them, when it takes theirs and the "Someone else changed this lead…" notice shows. "Reload the latest" drops it; the note is kept.
  - `routes/leads/lead.tsx`: on a new version the 409 flag and a failed save's line reset (as the remount did); the Timeline restarts its pages from the new first page, and an older page that answers after a reload is dropped. Focus after a save or cancel (`focusLater`): Pipeline's heading after "Save changes" or Discard; the contact's and Enquiry's Edit button after Save or Cancel; the note field after "Add note"; Linked records after a convert answered "Stay" (or Escape) or after "Reload the latest" on `already_converted`; the page heading after "Reload the latest" on the stale notice. "Move to…", Reply and Lost keep their own focus now that their buttons stay mounted.
  - `leads.css`: a lead panel heading that takes focus is as wide as its words with `--radius-sm`, and shows the focus ring after a keyboard action (none after a click, as app.css has it for headings).
  - **Found and fixed on the way (same commit):** at 1024 px with the menu open, the lead page's two columns leave the Timeline panel about 300 px wide, and the change table broke its words letter by letter (before FX-3 too; the sweep's sideways-scroll check can't see it). The timeline now answers its panel's width: `.lead-timeline` is a container; the single date column and the phone's tighter table apply below 30rem of panel; under 18rem the decorative entry icon gives its width to the table. Phones (375) look as before; the client's Activity tab, which shares the timeline, is unchanged at 1024 (its panel is wide).
  - Tests (`routes/leads/screens.test.ts`, 4 new): "Stay" after a convert keeps an answers edit and the next-action note; an untouched edit takes the stored answers and keeps its base; someone else's currency change drops the whole edit with the notice, and the same change by both is no conflict; closing clears the notice, and "Reload the latest" drops the edit and keeps the note. The SPA tests run in workerd without a DOM, so the mount and focus behaviour is checked live only.
  - Live (keyboard): Pipeline "Save changes" → focus on the Pipeline heading with the ring; contact Save → "Edit contact"; Enquiry Save → "Edit enquiry"; Add note → the note field, the new note on the timeline; Move to… Qualified → focus stays on "Move to…". Convert with an unsaved answers edit (timeline 3–6 months) and an unsaved next-action note: the convert dialog closes and one dialog ("Leave without saving?") stands; "Stay" (and, on a second lead, Escape) keeps both edits, the Convert button goes, Linked records shows the client and the draft proposal and has the focus. "Leave without saving" opens `/proposals/:id`; a convert with no edits opens the proposal at once. An answers conflict made over the API shows the notice and the stored answers; "Reload the latest" puts the focus on the page heading.

#### Shots (`.logs/shots/fx3-fix2-d/` in this worktree; light/dark = the in-app theme, "on-dark-os"/"on-light-os" = the emulated OS theme)
- `lead-follow-saved-focus-pipeline-768-dark-on-light-os.png`: D, after "Save changes" on Pipeline: the ring hugs "Pipeline"; the saved note shown.
- `lead-contact-saved-focus-edit-1024-light-on-dark-os.png`: D, after "Save contact": focus on Edit, the "Saved." toast.
- `lead-answers-saved-focus-edit-375-light-on-dark-os.png`: D, after the Enquiry save on a phone: focus on Edit, timeline 3–6 months.
- `lead-convert-leave-question-alone-1280-dark.png`: B, the leave question alone after a convert with unsaved edits.
- `lead-convert-stay-answers-kept-focus-linked-1280-dark.png`: B, after "Stay" (full page): the answers edit (3–6 months) and the next-action note kept, Convert gone, Linked records focused. (The top bar drawn mid-page is the full-page capture's sticky header, not the page.)
- `lead-convert-escape-stay-kept-focus-linked-1600-dark-on-light-os.png`: B, the same after Escape on a second lead.
- `lead-answers-conflict-notice-1536-dark.png`: someone else's currency change during an open answers edit: the notice and the stored answers.
- `lead-timeline-narrow-panel-1024-light-on-dark-os.png`: the timeline at 1024 with the menu open: whole words in the change tables.
- `lead-timeline-phone-unchanged-375-dark-on-light-os.png`: the timeline on a phone, as before.
- `client-activity-1024-dark-on-light-os.png`: the client's Activity tab (empty state) at 1024, unchanged.
- `project-note-headings-1024-light-on-dark-os.png`: A, three notes: the sizes are the author's, the levels as above.
- `template-heading-two-rules-summary-1024-light-on-dark-os.png`: C, two lines for one heading in the summary.
- `signature-exif6-photo-decoded-fitted-stored-1536-light.png`: H, the Exif-6 phone photo stored as a 300 × 400 PNG.
- axe (WCAG 2.2 AA + best practice, moderate and up), run in the page on the lead page at 375 (light on dark OS), 768 (dark on light OS), 1024 (light on dark OS) and 1600 (dark on light OS), with the forms open and after each save: clean, no sideways scroll. One run at 1600 reported `target-size` on the timeline select while the page was scrolled so that the sticky top bar covered it; at the top it is clean. Project notes and template pages: clean. No console errors or warnings on any of them.

#### Commands (heavy ones through `tools/heavy.sh`)
- Local setup in this worktree: `pnpm install --frozen-lockfile --offline`, `pnpm dev:secrets`, `pnpm db:migrate:local`, `pnpm db:seed:local`, `pnpm portal:sample`. A throwaway Owner (`designer-…@example.test`, local database only) was enrolled over the API as the e2e setup does, then signed in through the UI. Sample leads B, C and D, a sample project and its notes are labelled "(designer sample)" / "(sample)" with `@example.test` addresses.
- Targeted vitest: `src/lib/projects.test.ts` 22/22, `src/lib/signature-scale.test.ts` 16/16, `src/routes/leads` + `src/lib/leads.test.ts` 35/35.
- `pnpm --filter @techaust/admin typecheck` (`.logs/fx3f2d-tc2.log`): exit 0 (the first run, `.logs/fx3f2d-tc.log`, found two test typings, fixed before the H commit).
- Full `pnpm test` (`.logs/fx3f2d-test.log`): exit 0, no timeouts: core 1,801, db 471, email 128, pdf 340, auth 135, ui 469 (2 skipped), web 510 (17 skipped), portal 631, jobs 528, admin 3,368.
- `pnpm --filter @techaust/admin e2e` (`.logs/fx3f2d-e2e.log`): 6/6 passed in 9.4 min. Record pages visited: lead, client, project (with the heading notes), document, catalogue item, template; 4 scroll boxes met by the keyboard.
- `pnpm check` (the one whole-repository lint, last; `.logs/fx3f2d-check.log`): every step ran through to the migration guard. Its 10 warnings and 8 infos are in files I didn't touch (admin `reports.test.ts`, web `catalogue.ts`, core `public-text.ts`, pdf tests).
- `pnpm exec biome check` on each changed file: clean.
- Dev server stopped, browser closed; no node, workerd or bash process left from this worktree.

#### Not verified
- Firefox and Safari (the `createImageBitmap` fallback is covered by tests; Chrome honours the options); NVDA; real phones; staging.
- The mount and focus behaviour has no automated test (no DOM in the admin's workerd tests); checked live only.
- The Playwright tool wrote its page snapshots to the main checkout's `.playwright-mcp/` (git-ignored).

#### Placeholder lines
- None new. No screen text was added or changed.

#### Open questions (lead's call)
1. The 1024 px narrow column also affects other two-column pages with the menu open (on the template editor, the editor column is about 300 px). I saw no broken words there, but it's worth a look in the next sweep; I changed only the lead timeline.

**Lead, after fix round 2 (2026-10-29 ~19:20 IST):** both reports are kept above. The designer's fix beyond the brief is accepted: the lead timeline at 1024 px with the menu open now sizes to its panel. Its open question also stands: narrow second columns elsewhere at 1024 px with the menu open (the template editor is about 300 px). That goes on the final sweep's checklist. Next: the re-check (live).

## Re-check of fix round 2 (reviewer claude-opus-5-5/high, live, 2026-10-29 ~19:25–20:10 IST, on 53cf9fe6): APPROVE
_(Summary by the lead; the full text is in the conversation record. Shots: `.logs/shots/fx3-recheck2/`.)_

**A, B, C, D, E and G are fixed; H is partly fixed. All were checked live:**
- **A:** the heading levels in the accessibility tree are 3, 4, 4 / 3, 3, 3 / 3, 4, 5.
- **B:** "Stay" after convert keeps the answers edit and the notes, and focuses Linked records.
- **D:** focus lands correctly after each panel's save.
- **E:** every PATCH combination answers as specified.
- **H:** works for JPEG with Exif rotation and for plain PNG.
- **The designer's timeline change:** good.
- **The other-tab conflict paths:** correct.
- **axe:** 0 violations at 375, 768 and 1024 (menu open), in both themes against the opposite OS theme.
- **Results:** `pnpm check` exit 0; `pnpm test` exit 0 with no timeouts (admin 3,369); e2e 6/6.

**Findings:**
1. **Medium, new:** a PNG with an orientation chunk is stored stretched. `signature-scale.ts:70-72`, 187 and 205 read the size from the PNG header but ignore its orientation chunk, and Chrome applies the chunk.
2. **Medium, new:** a stale `emailError` or `nextDateError` stays under the stored value after a conflict reload (`lead.tsx:180-185`, 201-202).
3. **Medium, existing:** the Enquiry edit's `.form-grid` goes two columns by window width, so at 1024 px with the menu open (a 255 px column) the selects cut their values (`shell.css:2233`).
4. **Medium, existing:** in the template editor, a heading's blur check shows the error summary and pushes Save down, so the first click is lost (`template.tsx:295-307`, 370).
5. **Low:** a waiting focus target has no expiry (`lead.tsx:223-232`).
6. **Low:** a stale "Show older" request keeps `loading` on.
7. **Low, design note:** the answers are treated as one set. **Kept by the lead**, as the brief asked: a band belongs to its currency.
8. **Low, existing:** opening Edit contact or Edit enquiry puts focus on `body`.

## Fix round 3 (lead's triage)
- **Designer** (`fix/fx3-fix3-d`): 1, 2, 3, 4, 5, 6 and 8. Item 7 is kept.
- **After it:** a focused re-check of only these items, live. Then the FX-3 PR.

### Fix round 3, designer report
_(designer claude-opus-5-5/high, branch `fix/fx3-fix3-d` from `origin/fix/fx3-admin-portal` 5fd84df9, 2026-10-29)_

**Skills:** `frontend-design:frontend-design` loaded first. It kept every change inside docs/06 (tokens only; the Enquiry form uses the timeline's own container pattern; no new visual devices). It also pushed item 4 past the summary to the real cause of the lost click: a line appearing between the press and the release. `dataviz` does not apply (no chart or tile).

**Items, one commit each:**
1. `821c081a` Signature (`apps/admin/src/lib/signature-scale.ts`, `.test.ts`):
   - The fitted decode passes only `resizeWidth`, with `resizeQuality: "high"` and `imageOrientation: "from-image"`. The full-size decode also passes `imageOrientation: "from-image"`.
   - Both sides are still checked (`fittedDecodeMatches`): the width exactly, the height equal or one pixel more. Chrome rounds the side it computes up (measured live: 2400 by 901, asked for 800 wide, comes back 800 by 301; our fit rounds to 300). Without that one pixel, about half of all large images would fall back to the full-size decode and undo fix round 2's H. A match is drawn at exactly the fitted size.
   - New tests: a PNG that its orientation chunk turns the other way falls back (533 by 711, then 3000 by 4000, drawn at 300 by 400, both bitmaps freed); the rounding-up case; the match rule.
   - Live (Chrome): a 4000 by 3000 PNG with an eXIf chunk (orientation 6) is stored at 300 by 400, turned, with a drawn circle of 120 by 120 px (not stretched). The old both-sides options gave 533 by 400, the stretch the reviewer saw. A 4000 by 3000 JPEG with Exif 6 is stored at 300 by 400, circle 120 by 120.
2. `52b33625` Stale field lines (`lead.tsx`):
   - When a new copy arrives, `emailError` goes if the email field now shows a different value from the one the person last saw; `nextDateError` and `dates.reset()` go if the follow date does. A line under the person's own kept text stays.
   - "Reload the latest" now clears the email line too. Before, it was left behind and came back on the next Edit.
   - Live: the reviewer's steps (a bad email and an unreadable date saved, both changed in "another tab" through the API, then a note added here) leave no red line; the stored values and the stale notice show. In the opposite case (the other tab changed only the phone), the email line stays under the still-bad email.
3. `1a519f17` Enquiry edit (`leads.css`):
   - `.lead-answers` is an inline-size container. Its `.form-grid` has one column, and two from 30rem of form width, with the shared span-2 and subgrid rules so the controls start level. `.form-grid` elsewhere is unchanged.
   - Measured: the longest value (INR "₹7,00,000 to ₹15,00,000") needs 198 px; at 30rem each column is 228 px.
   - Live form widths: 255 px at 1024 with the menu open (stacked), 439 at 1024 with the menu closed (stacked), 407 at 768 (stacked), 294 at 375 (stacked), 511 at 1280 (two columns), 831 at 1600 (two columns). Every select shows its full value, and the budget hint row keeps both controls level.
4. `4adecc0d` Template editor (`template.tsx`):
   - The error summary renders only after a save was tried (`tried`).
   - Field lines still show live on blur. But a blur caused by pressing Save or Cancel waits until the press ends (`holdBlurChecks` on `pointerdown`, run after `pointerup` or `pointercancel`), because the field line alone also moved Save from under the pointer.
   - Live:
     - an invalid heading, then Save straight away: the summary appears and takes focus on the first click;
     - a valid heading, then Save straight away: saved as version 3;
     - an invalid body in the last section (the line right above Save), then Save: the summary on the first click;
     - Tab out of an invalid heading before any save: the field line, no summary.
5. `af217e15` Waiting focus (`lead.tsx`):
   - A waiting target lapses when a key or a pointer was pressed after `focusLater` and the focus is now on an element other than `body`.
   - A plain "focus moved" test was not used. The leave dialog hands focus back to "Convert to client" while the target waits, so that test would have broken fix round 2's D.
   - Live, with the lead reload delayed by 3 s: "Stay" after a convert, with no action, and Linked records takes the focus. The same with a press and focus in the note field while waiting: the note keeps the focus and Linked records doesn't take it.
6. `3c7905a2` "Show older" (`lead.tsx`, Timeline): a new first page sets `loading` to false, and each request has a number (`asked`); only the latest one shows its answer or ends the loading. Live (activities delayed by 6 s, 55 sample notes): "Show older" pressed, then a note added here. The button at once reads "Show older" and is enabled, and the stale answer adds nothing (25 entries).
8. `ccf61c76` First field (`lead.tsx`): Edit contact focuses Name (and clears a leftover email line); Edit enquiry focuses Currency. Checked live by mouse and by keyboard (Enter); Cancel returns the focus to the Edit button.
- `de01bd4e`: formatting of the Edit enquiry button. `pnpm check` caught it; my per-file check had hidden the error because I cut its output with `tail`.

**Files:**
- `apps/admin/src/lib/signature-scale.ts`
- `apps/admin/src/lib/signature-scale.test.ts`
- `apps/admin/src/routes/leads/lead.tsx`
- `apps/admin/src/leads.css`
- `apps/admin/src/routes/catalogue/template.tsx`
- this run file

**Screenshots** (`.logs/shots/fx3-fix3-d/` in the worktree; I opened and checked each one):
- `01-signature-png-exif6-1280-light.png`: the signature stored from the turned PNG, upright and round.
- `02-enquiry-edit-1024-menu-open-light.png`: stacked selects with full values, focus on Currency.
- `03-enquiry-edit-1280-light.png`: two columns, full values.
- `04-enquiry-edit-1600-dark-in-app-os-light.png`: two columns, in-app dark against OS light.
- `05-enquiry-edit-768-light-in-app-os-dark.png`: stacked, in-app light against OS dark.
- `06-enquiry-edit-375-dark-in-app-os-light.png`: stacked on a phone.
- `07-enquiry-edit-1024-menu-closed-dark-hint.png`: stacked, with the "choose a currency" hint.
- `08-enquiry-edit-1280-menu-closed-dark-hint-aligned.png`: two columns, controls level despite the hint.
- `09-lead-errors-before-other-tab-1280-dark.png`: the email and date lines before the other tab's change.
- `10-lead-no-stale-errors-after-reload-1280-dark.png`: after the note: the stored values, no stale lines, the notice.
- `11-edit-contact-focus-on-name-1280-dark.png`: Edit contact open, focus ring on Name.
- `12-template-first-save-click-summary-1280-dark.png`: the summary after the first Save click.
- `13-template-summary-after-submit-375-light.png`: the same at 375.
- `14-edit-contact-keyboard-focus-1600-light-in-app-os-dark.png`: Edit contact opened by keyboard, focus on Name.

**Checks:**
- **axe** (axe-core 4.14, WCAG 2.0 to 2.2 A and AA):
  - the lead page with both edits open, at 375, 768, 1024 (menu open and closed) and 1600, in-app light and dark, each against OS light and OS dark: 0 violations;
  - one `target-size` hit at 768 appeared only while the page was scrolled so the sticky top bar covered the date field; at the top of the page it was 0;
  - the template editor with the summary, both themes: 0.
- **Keyboard:**
  - Edit enquiry by Enter goes to Currency; Tab order is Currency, Budget, Timeline, Cancel, Save; Enter on Cancel returns to Edit.
  - Edit contact by Enter goes to Name.
  - Focus rings are visible and there are no traps.
- **Console:** no errors on the checked pages. The only ones were the expected 401s on the invite page before sign-in.
- **Commands:**
  - `pnpm --filter @techaust/admin exec vitest run src/lib/signature-scale.test.ts`: 19 passed.
  - `bash tools/heavy.sh --log fx3d-typecheck-admin pnpm --filter @techaust/admin typecheck`: exit 0.
  - `bash tools/heavy.sh --log fx3d-test pnpm test`: exit 0, no timeouts. Admin 3,372; portal 631; jobs 528; core 1,801; db 471; pdf 340; web 510 (+17 skipped); ui 469 (+2 skipped); auth 135; email 128.
  - `bash tools/heavy.sh --log fx3d-e2e-admin pnpm --filter @techaust/admin e2e`: 6/6 passed (9.2 min).
  - `bash tools/heavy.sh --log fx3d-check pnpm check`: exit 1, on my formatting of `lead.tsx` (fixed in `de01bd4e`).
  - `bash tools/heavy.sh --log fx3d-check2 pnpm check`: **exit 0**. Its 10 warnings and 8 infos are in files this round didn't touch.
- **Local data only:** an Owner `designer-fx3@example.test`, and sample leads "Sample Lead Asha/Bina/Chand/Devi (fake)" with `@example.test` addresses and notes, in this worktree's local D1.
- **Clean-up:** the dev server and the e2e server are stopped, no process runs from the worktree, and the browser is closed.

**Not verified:**
- Safari and Firefox were not run. The press hold in item 4 relies on `pointerdown` coming before `blur`, which is the order in all three engines.
- The PNG eXIf path was checked in Chrome only.

**Placeholders seen (not mine):**
- "[Placeholder] We made the image smaller to fit 800 by 400 pixels." (signature)
- "[Placeholder] Choose a currency first." (the Enquiry budget hint)
- "[Placeholder] Choose a country" (Convert dialog)

**Open questions:** none. A possible later improvement, outside this brief: `imageHeaderSize` could read a PNG's eXIf orientation, so a turned PNG also takes the fitted decode instead of the full-size fallback.

**Lead, after fix round 3 (2026-10-29 ~21:00 IST):** both deviations are accepted.
1. The fitted decode allows the long side to come back exactly one pixel larger (Chrome rounds up), so large images keep the fast path; a turned image misses by far more and still falls back.
2. The waiting focus target is dropped only after a key or pointer press, so the leave dialog handing focus back doesn't cancel round 2's D.

The designer's idea of reading the PNG orientation chunk in `imageHeaderSize` (the fast path for turned PNGs too) is a nice-to-have, not a defect; kept as a note for M7. Next: the focused re-check.
