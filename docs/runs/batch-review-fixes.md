Status: open
Tier: B (send logic and the anonymised-client name change; the screens are C)
Usage: reviewer claude-opus-5-5/high (UI/UX check; skills frontend-design, dataviz): 5-h 19 → 39 %; code-finder claude-haiku-5-5/low (placeholder sweep; no skill fits a read-only search)

# Batch review fixes (UI/UX sweep and copy, after the owner's M3.4 to M4.5 test)

Branch `fix/batch-review-ui` from main at 2bde203. The owner tested all seven batch milestones on staging on 2026-10-26 and found them working apart from UI issues. Owner's words: "once you fix them we are good to go to M5". On this task's approval on staging, the batch (M3.4, M3.5, M4.1 to M4.5) is approved and M5 may start.

Plan approved by the owner (2026-10-26):
1. A full UI/UX check by the reviewer (read-only, every admin and portal screen).
2. At the same time, the lead drafts one copy page: every `[Placeholder]` line and open copy question from 07-K to 07-P, with suggested wording. The owner approves it word for word.
3. One fix task for the designer: the owner's findings, the check's findings that the lead accepts, and the approved copy.
4. Re-check by the reviewer, PR (auto-merge, Auto-fix), staging.
5. The owner looks at staging (before and after screenshots); "approved" closes the batch.

## Owner's findings (2026-10-26)
1. **Empty states on list pages** (seen on Projects): the empty-state box touches the filter panel above it (no gap), takes about half the width instead of lining up with the panel, and the Client filter field is too narrow (its hint is cut off). The shared `EmptyState` (`apps/admin/src/components/display.tsx`) is used on 19 admin screens. The Client filter hint is still a `[Placeholder]` line (copy page).
2. **Two-column forms** (seen on New care plan, Billing): fields side by side don't line up. Billing day has a hint above its input and Start date has none, so the inputs sit at different heights. In the same shot, the native date input shows the browser locale's order (10/26/2026) and its calendar icon is dark on the dark theme (barely visible).

## Staging data change by the lead (2026-10-26)
Catalogue `deliverables_md` filled for S1, S2, S4 to S7 and S10 to S14, and `assumptions_md` for S1 ("What we need from you: …"), word for word from the site's 07 content (first letter capitalised as the site does; "↔" set as an en dash, as the arrow isn't in the fonts). Direct D1 update with `wrangler d1 execute --remote`, only where the field was empty; no audit row. S9, S16 and S18 have no 07 deliverables, and no service has exclusions in 07 (owner chose "seed only 07"; empty sections are hidden when sending).

## Brief: reviewer, full UI/UX check (lead, 2026-10-26)
**Goal:** find every UI/UX defect on the admin and portal screens, so the designer can fix them in one pass. This is an audit of what is on `main`, not a diff review: there is no diff. **Change no code**, no commits.

**Allowed beyond the reviewer's usual read commands (local only):** `pnpm install --frozen-lockfile --offline`, `pnpm dev:secrets`, `pnpm db:migrate:local`, `pnpm db:seed:local`, `pnpm portal:sample`, `pnpm invite …`, `pnpm portal:link …`, the admin and portal dev servers, and making sample data through the local screens or API (names marked "(sample)", emails `@example.test`). Never touch staging or any hosted service. Stop every dev server before you report.

**Skills first:** `frontend-design:frontend-design` (as the design bar), `dataviz` (the dashboard tiles and the hours bars), `code-review` only if you read code to find a cause.

**Screens (admin):** sign-in and invite, shell and rail, dashboard, leads (list, board, lead page), clients (list, page, every tab, data-tool dialogs), projects (list, new, page and every tab), care plans (list, new, plan page, change terms, change status), time (week, entry dialog, export), catalogue (services, templates, publish), documents (list, proposal and estimate editor, PDF panel, signature control, send dialog, approvals), users, every Settings screen, the audit log, account, the bell, search.
**Screens (portal):** sign-in, callback, the home page, the offer page (view, accept, decline, confirmation), the offer-link page, not found.
**Also glance at:** a proposal PDF, an estimate PDF and the acceptance certificate, if the local setup can render them; skip and say so if it can't.

**For each screen:** 1280, 768 and 375 px wide, light and dark; the empty, loading, error and full states where they exist; dialogs open. Look for:
- **Layout:** alignment, spacing and gaps between panels, widths that don't line up, fields side by side at different heights, cut-off or overflowing text, sideways scroll at 375.
- **Controls:** native inputs in dark mode (date and time pickers, selects, checkboxes, icons), the date order (the product shows IST and Indian conventions, docs/06), 44 px targets, visible focus, keyboard order, no traps, Escape on dialogs.
- **Consistency:** the same pattern drawn the same way on every screen (filters, tables, empty states, toasts, confirmations, stale notices); tokens only.
- **Accessibility:** axe (WCAG 2.2 A/AA; a temporary copy in `public/` is fine if deleted before you report), text sizes, contrast, reduced motion.
- Console errors.

The owner's two findings above are known. Confirm them and list every screen each one affects; don't stop at them.

**Report:** most severe first. For each finding: severity, the screens affected, `file:line` of the likely cause (shared component or CSS) where you can find it, the problem and the fix you suggest. Group findings that share one cause. List every `[Placeholder]` line you saw on screen, with its screen (the lead drafts the copy). Screenshots go under `.logs/shots/batch-review-fixes/` in your worktree, with absolute filenames. End with **APPROVE** (nothing above low) or **SEND BACK**.

## Copy (lead, 2026-10-26): approved by the owner ("approve all")
The lead's page listed 16 open questions, 8 changed lines and every other placeholder line; the owner approved all of it word for word. The approved text is [07-Q](../07-content-appendix/Q-batch-review-copy.md).

**Where each line lives** (code-finder sweep, Haiku, read-only; 381 lines; tests skipped):
- **Projects:** `apps/admin/src/lib/projects.ts` `PENDING` (L138–167).
- **Care plans:** `apps/admin/src/lib/care.ts` `CARE_PENDING` (L126–134).
- **Time:** `apps/admin/src/lib/time.ts` `TIME_PENDING` (L42–52).
- **Dashboard:** `apps/admin/src/lib/dashboard.ts` `ACTIVITY_PENDING` (L42–56).
- **Catalogue:** `apps/admin/src/lib/catalogue.ts` `PENDING` (L162–182), `NOT_SET` (L533).
- **Documents:** `apps/admin/src/lib/documents.ts` `DOC_PENDING` (L191–227), the 07-O §10 block (L234–250), `approval_rejected` (L438); `apps/admin/worker/quote-model.ts:82` `APPROVAL_PENDING`.
- **PDF:** `packages/pdf/src/layout/copy.ts` `PDF_COPY`; `apps/admin/src/lib/pdf.ts` `PDF_COPY`, `SIGNATURE_COPY`; `apps/jobs/src/pdf.ts:506` (bell); `apps/admin/worker/document-pdf.ts:14` `PDF_PENDING`.
- **Send and offers:** `apps/admin/src/lib/offers.ts` `OFFER_PENDING`, `OFFER_COPY`, `EMAIL_PREVIEW`, `DELIVERY_N`, `OFFER_ERRORS`; `apps/admin/src/lib/offer-words.ts`; `apps/jobs/src/offers.ts:239` (bells), `:338` (`next_step`).
- **Portal:** `apps/portal/src/copy-documents.ts` `PENDING` (L171–177) and `N` (L71–161).
- **Emails:** `packages/email/src/offers.ts` (L32–130).
- **Certificate:** `packages/pdf/src/layout/certificate-skeleton.ts` `CERTIFICATE_COPY` (L52–72, `PH` tag L48); `apps/admin/worker/document-links.ts:39` `CERTIFICATE_PENDING`.
- **Appendices** whose PENDING marks the approval clears: 07-N (whole file, certificate labels), 07-O (whole file, §9, §10), 07-P (whole file, "Sent", the INR line).

**Approved decisions that need code, not only words** (07-Q §1): Q1 the search hint per role; Q2 "Anonymised client" replaces "Removed client" (core `ANONYMISED_CLIENT`; check stored `display_name` values and tests); Q8 hide an estimate's empty Acceptance heading; Q10 the INR note without a rate; Q11 the PDF footer prints Settings "Email on documents"; Q12 the "Viewed" hint; Q13 the switch hint by the client's setting; Q14 the Acceptance text follows the draft's current contact.

## Review: full UI/UX check (reviewer Opus 5.5 high, 2026-10-26): SEND BACK (3 high, 12 medium, lows)
Local only (sample data made through the screens; 63 screenshots copied to the main checkout's `.logs/shots/batch-review-fixes/`). Clean: no sideways scroll at 375, axe one violation (H2), reduced motion respected, keyboard order and Escape fine, no console errors beyond the expected `/me` 401. **Not checked:** PDFs (need the jobs Worker and Browser Run), the real portal offer pages (checked through the portal's dev `/preview` screens), the approval detail (needs a non-owner requester), the users invite dialog, the client data-tool dialogs, the leads board visuals, the email previews.

**High**
- **H1** The admin logo is invisible on signed-out screens when the in-app theme differs from the OS theme. `apps/admin/src/components/ui.tsx:11-17` uses `<picture><source media="(prefers-color-scheme: dark)">`; the theme is `data-theme`. Fix like `.topbar__mark` (`screens.css:45-58`).
- **H2** Settings › Document terms: the version text is an unfocusable scroll box (axe serious, `screens.css:311-314`) and shows raw Markdown (`routes/settings/terms.tsx:91`, `:250`). Render with `components/markdown.tsx`; drop the max-height or make the box a focusable labelled region.
- **H3** Hiding a section doesn't clear its unresolved placeholders, so Send stays blocked although the screen says "write these sections or hide them" (`apps/admin/worker/quote-model.ts:958-963`, `unresolvedIn` scans hidden sections). Every seeded template has `{{service.exclusions}}` and no service has exclusions, so every new proposal and estimate is blocked. Reproduced.

**Medium**
- **M1** Empty states touch the filter panel and stop at half width (owner finding 1): `components/data-table.tsx:48` returns `props.empty` bare (loses `.dtable` margin, `shell.css:1441`); `.empty-state { max-width: 40rem }` (`shell.css:1178`). Seen on Projects, Leads, Care plans, Approvals; Time shows a nested half-width card and "No time logged this week" twice. Same component on Clients, Proposals/Estimates, Audit, Users, Catalogue services, Leads "Scheduled for deletion", the lead timeline, every client tab, Settings terms history, `states.tsx`. Drop "0 projects on this page" when empty.
- **M2** The Client filter is too narrow, hint cut off (`.filters--clients` flex, `clients.css:73`); generalise `documents.css:874-882` (`flex: 1 1 22rem; max-width: 26rem`).
- **M3** Fields side by side at different heights (owner finding 2, wider): `shell.css:2163-2170` `.form-grid > .field { align-content: start }`. New care plan (price/overage, start/billing day), Change terms, Log time (date/hours), Catalogue service (code/name/website address), proposal editor (Send to/Validity). The editor's Send to select is 59.2 px and truncates (`documents.css:137-146`).
- **M4** Native date inputs show the browser's order (every date field); 45.2 px against 44 px. The dark calendar icon was not reproduced in Chromium (browser-specific).
- **M5** Link-buttons underlined (`app.css:359`, `.btn` lacks `text-decoration: none`). One-line.
- **M6** Project Overview's recent notes and files go stale after adding in their tabs.
- **M7** "Linked records: The linked proposal arrives with proposals." is out of date.
- **M8** The Send dialog is a dead end when no contact has portal access.
- **M9** The hours bar track vanishes in dark mode (`care.css:35`, about 1.05:1); the 80 % tick has no label; the discount meter and schedule bar have no scale or labels.
- **M10** The portal decision card mixes "Valid until 10 Nov 26" (`packages/pdf/src/format.ts:9-16`) with "26 Oct 2026"; use the four-digit year on screen.
- **M11** The admin document preview shows the terms line with no terms text; its Cover reads as a run-on.
- **M12** The New proposal or estimate dialog scrolls inside a scroll; Create draft starts off-screen at 1280×900.

**Low:** Numbering "Edit" buttons 42 px (one-line); at 375 px the Proposals rows-per-page select overhangs about 14 px and the Time week buttons wrap; the time grid says "1:30" against "1 h 30 min" totals; status pill icons (Planned uses Draft's pencil, Active uses Sent's plane); identity strips' six equal columns wrap the client name; page-header action placement differs (care plan below the title, others right); Care plans has no lede; the Catalogue h1 jumps about 8 px between tabs; the Pause dialog breaks the date ("26 / Oct 2026"); Status history prints the date twice; catalogue service names use "&"; "(milestone M4.1)" in Settings copy; dashboard activity rows mix one- and two-line layouts and "sent a document" has no number or link; signing in from `/login` lands on Not found; signed-out screens log two `/me` 401s in both apps; the convert dialog's scrollbar is light in dark mode.

**Placeholders seen on screen:** the Client filter hint, the empty notes, milestones and files lines, the emails panel heading, "Send again", "Revoke links", and four dashboard activity labels; all are in 07-Q.

## Lead triage of the check (2026-10-26)
Every finding is real and fixed in this task (the owner asked that no UI/UX issue be left); none belongs to a later milestone. The lead asked the owner the four new copy questions the check raised.

**Owner's answers (2026-10-26):**
- **M7:** "No proposal is linked to this project." A project started from an accepted proposal links to it.
- **M8:** Send is disabled with "No contact of this client has portal access yet. Turn it on for a contact first." and a link to the client's Contacts tab.
- **"&" in service names:** "and" in the seed and on staging (for example "Custom Web Apps and Business Portals"); documents already sent keep their names.
- **"(milestone M4.1)":** removed from both Settings lines; the rest stays word for word.

**Lead decisions:**
- **M4:** one shared admin `DateField`: typed as DD/MM/YYYY, with the date echoed as "26 Oct 2026" under it, a calendar picker button that is token-coloured in both themes, 44 px. The value sent to the API is unchanged.
- **"sent a document":** the activity row gets the document number as a link, like the other rows; no new words.
- **Split:** a builder takes the Workers, packages and data; a designer takes every screen. They run at the same time on separate files.

## Brief: builder (lead, 2026-10-26)
Branch `fix/batch-review-ui-builder` from `origin/fix/batch-review-ui`, in your own worktree. Sonnet 5.5, medium. Skills: `cloudflare:workers-best-practices`, `cloudflare:wrangler` (D1 migration), and `code-review` on your own diff before you report.

**Your files.** The designer owns `apps/admin/src/**` and `apps/portal/src/**`; touch them only where a test there must change because of your change, and say so.
1. **H3 (send block):** the unresolved-placeholder scan (`apps/admin/worker/quote-model.ts:958-963` `unresolvedIn`, and any shared twin in `packages/core`) skips hidden sections, for the blockers and for send. Tests: a hidden section holding `{{service.exclusions}}` no longer blocks; a visible one still does; a hidden section stays out of the snapshot and the PDF.
2. **Q2 "Anonymised client":** `packages/core/src/clients.ts` `ANONYMISED_CLIENT` becomes "Anonymised client". A new migration updates the stored `display_name` of clients already anonymised (`anonymised_at IS NOT NULL AND display_name = 'Removed client'`). Never edit an applied migration; never rebuild a table. Check that the anonymised-client lock and the triggers allow this one update; if a trigger blocks it, stop and report, never drop the trigger. Issued or frozen snapshots are not touched. Tests.
3. **PDF copy (`packages/pdf`):** Q10 the INR note becomes "Prices exclude GST."; Q7 `termsLine` becomes "The terms below are version {version} of our terms."; Q11 the footer prints the Settings "Email on documents" value (fallback hello@techaust.com) through the envelope or view, with no arithmetic in the view; the certificate's `PH` "[Placeholder] " tag is removed (07-Q CERT lines). Update the tests and visual baselines the pdf suite keeps.
4. **Emails and bells:** remove the "[Placeholder]" tag in `packages/email/src/offers.ts` ("Open in the portal"); `apps/jobs/src/pdf.ts:506` becomes "An acceptance certificate couldn't be made. We'll try again tonight." (07-Q C2); the integrity-failure bell gets its own line, "A PDF didn't match its saved copy, so it wasn't sent. Make the PDF again from the document." (Q9).
5. **API sentences:** `apps/admin/worker/quote-model.ts:82` "An approval is already waiting for the owner." (C4); `apps/admin/worker/document-pdf.ts:14` "The PDF isn't ready yet. Try again in a minute." (C5); `apps/admin/worker/document-links.ts:39` "The certificate is still being made. Try again in a minute." (C6).
6. **Q14:** the draft's Acceptance text (`{{client.contact}}`) follows the draft's current contact when `contactId` changes on a draft; sent versions keep their snapshot. Tests.
7. **Service names:** "&" becomes "and" in `packages/db/src/seed/catalogue.ts` (S2, S5, S6, S8, S10, S15). Update every test or snapshot keyed on those names. **Don't touch staging:** put the exact SQL for the lead to run on staging after the merge in your report (it changes only rows whose name still has the old text).

**Rules:** CLAUDE.md conventions; heavy commands through `bash tools/heavy.sh`; commit at least every 20 minutes; never touch hosted services; append your report to this file under "Builder report".
**Done:** `pnpm check` and the tests of every package you touched pass, then `pnpm test` in full as the final check; the admin worker budget line is printed (it was 414,109 of 415,878 bytes; report the new number, and if a change would cross the ceiling, stop and report).

## Brief: designer (lead, 2026-10-26)
Branch `fix/batch-review-ui-design` from `origin/fix/batch-review-ui`, in your own worktree. Opus 5.5, medium. Skills first: `frontend-design:frontend-design`, `dataviz` (M9 and the dashboard).

**Your files:** `apps/admin/src/**` and `apps/portal/src/**`. The builder owns the Workers, `packages/*` and the migrations; if a screen fix needs a change there, report it instead.

**Fix, with one fix per shared cause wherever the check names one:**
1. The owner's findings 1 and 2 and every High, Medium and Low finding in "Review: full UI/UX check" above, except H3, Q2, the PDF, email and API sentences and the service names (the builder's). M4 as the lead decided (one shared `DateField`). M7 and M8 in the owner's words above. "(milestone M4.1)" removed from `settings/flags.tsx:61` and `settings/payment-terms.tsx:224`.
2. **Copy, word for word from [07-Q](../07-content-appendix/Q-batch-review-copy.md):** every SPA line (admin `lib/{care,catalogue,dashboard,documents,offers,offer-words,pdf,projects,time}.ts`, portal `copy-documents.ts`, and the rest under "Where each line lives" above) loses its "[Placeholder]" tag and takes its approved wording. That includes C1, C3, C7, C8 and the SPA parts of Q1 (the search hint per role, from what each role can search), Q3, Q7, Q8 (hide an estimate's empty Acceptance heading), Q12 (the "Viewed" hint) and Q13 (the switch hint by the client's setting). Update the copy tests (they check the copy word for word); no placeholder tag may remain in the SPAs.
3. **Then check what the reviewer couldn't:** the users invite dialog, the client data-tool dialogs, the leads board, the approval detail (make a local staff requester), the admin email previews, and the proposal, estimate and certificate PDFs through the pdf package's local visual suite or sample (no hosted service). Fix what you find in your files, and list anything in the builder's.

**Checks:** every screen the review names, at 1280, 768 and 375, light and dark, and with the in-app theme set against the OS theme; axe 0 violations; keyboard; before and after screenshots under `.logs/shots/batch-review-fixes-after/` (absolute paths, sample data only). `pnpm check` and the admin and portal tests pass; the whole-repo lint once at the end; the admin and portal build budget lines. Commit at least every 20 minutes; stop every dev server; append your report to this file under "Designer report".

## Builder report (builder, Sonnet 5.5 medium, 2026-10-26)
Branch `fix/batch-review-ui-builder` (3 builder commits plus the review fix below, from `origin/fix/batch-review-ui`). Skills: `cloudflare:workers-best-practices` (no new bindings, no buffering; the Q14 rename runs inside the existing save batch, no extra reads), `cloudflare:wrangler` (checked: the migration is a plain data UPDATE, nothing touches a hosted service), `code-review` on my own diff (see "Review of my own diff").

**Done (brief item, then where)**
1. **H3:** `apps/admin/worker/quote-model.ts` `blockersOf`: the unresolved-placeholder scan skips hidden sections. No twin exists in `packages/core` (`unresolvedIn` only scans what it is given). The PDF view already filters hidden sections (`packages/pdf/src/view.ts`); the snapshot keeps the hidden flag, as before. Test `apps/admin/worker/documents-batch-fixes.test.ts` (visible blocks and is named; hidden does not block and the send succeeds).
2. **Q2:** `packages/core/src/clients.ts` `ANONYMISED_CLIENT` = "Anonymised client" (the erase path writes it to `legal_name` and `display_name`). Migration `packages/db/migrations/0036_anonymised_client_name.sql` (custom, data UPDATE only, no table rebuilt) renames `display_name` and, where it equalled the old label, `legal_name`, only where `anonymised_at IS NOT NULL AND display_name = 'Removed client'`. No trigger on `clients` watches those columns (triggers: currency, type, gst_status/state_code), so nothing blocks it; verified by running the migration's own SQL in `packages/db/test/anonymised-name.test.ts` (an anonymised client is renamed; a non-anonymised "Removed client" and another name are left alone). Frozen snapshots untouched. Tests keyed on the old text: the core test only.
3. **PDF copy:** Q10 `inrNote` "Prices exclude GST."; Q7 `termsLine` "...version {version} of our terms."; Q11 `IssuerSnap.company.email` (optional) frozen at send from Settings "Email on documents" (`document-send.ts`, `packages/db/src/schema/documents.ts`), copied by the envelope builder only when present (so older sealed envelopes still verify and are unchanged), and `toPdfView` prints it in the supplier block and builds `view.footer.brand` through `footerLine()` (no arithmetic); older versions fall back to `hello@techaust.com`. Certificate `PH` tag removed with the labels as approved. The 07-Q Q5 USD to INR note is unchanged.
4. **Bells and email:** "Open in the portal" without the tag; certificate dead-letter bell per C2; every integrity refusal (snapshot rows that don't reproduce the seal, key conflict, render-time envelope check) rings the new Q9 line (`BELL_COPY.integrity`); the generic "could not be made" line stays for dead letters.
5. **API sentences:** C4, C5, C6 as written.
6. **Q14:** `document-save.ts`: when `contactId` changes on a draft, the previous contact's name (or the literal `{{client.contact}}` token when there was none) is replaced, as a whole word, with the new contact's name in `acceptance` sections, also when sections are sent in the same save; sent versions are frozen and never reach this. Test included (a longer word containing the name is untouched).
7. **Service names:** `packages/db/src/seed/catalogue.ts` S2, S5, S6, S8, S10, S15 now say "and". No test keyed on the seed names (the admin tests use their own fixtures).

**Staging SQL for the service names (lead runs after the merge; only rows still carrying the old text)**
```sql
UPDATE catalogue_items SET name = 'App Rescue and Production-Readiness Audit' WHERE code = 'S2' AND name = 'App Rescue & Production-Readiness Audit';
UPDATE catalogue_items SET name = 'Custom Web Apps and Business Portals' WHERE code = 'S5' AND name = 'Custom Web Apps & Business Portals';
UPDATE catalogue_items SET name = 'MVP and SaaS Product Development' WHERE code = 'S6' AND name = 'MVP & SaaS Product Development';
UPDATE catalogue_items SET name = 'UI/UX and Design Systems' WHERE code = 'S8' AND name = 'UI/UX & Design Systems';
UPDATE catalogue_items SET name = 'Workflow Automation and AI Agents' WHERE code = 'S10' AND name = 'Workflow Automation & AI Agents';
UPDATE catalogue_items SET name = 'Payments and Billing Modules' WHERE code = 'S15' AND name = 'Payments & Billing Modules';
```
No trigger on `catalogue_items` blocks an UPDATE of `name` (only delete is refused). Migration 0036 is applied by the normal staging deploy. Publish the catalogue again afterwards so the website snapshot picks the names up.

**Commands and results (all through `tools/heavy.sh`)**
- `pnpm --filter @techaust/core test`: 1027 passed, coverage 98.7 %. `@techaust/db test`: 206 passed. `@techaust/pdf test`: 124 passed (coverage 97.9 % statements). `@techaust/email test`: 78 passed. `@techaust/jobs test`: 257 passed. `@techaust/admin test`: 2116 passed.
- `pnpm check` (lint over the whole repo, typecheck, guards, migration guard "37 migrations"): exit 0. Pre-existing warnings only. `pnpm test` in full: exit 0.
- `pnpm --filter @techaust/admin build`: **admin bundle ok: 414514 bytes (limit 415878), startup 49.5 ms** (was 414,109, +405 bytes).
- The one test outside my files that changed: `apps/jobs/test/{pdf,offers-wiring}.test.ts` (bell lines) and `packages/pdf/test/{layout,view}.test.ts`. I touched nothing in `apps/admin/src` or `apps/portal/src`.

**Review of my own diff (code-review, low).** Fixed: the Q14 rename was a plain substring replace and skipped when sections were sent too (now whole-word and applies to both). Kept, with reasons: the Q9 line is the owner's approved wording for every integrity refusal and carries no number by design; the INR note lost its rate by the owner's approval (VERIFY WITH CA/LEGAL stays); migration gating on `display_name` is exact because the erase path always set both names together.

**Not verified**
- The PDFs rendered through Browser Run and the Playwright visual suite (`test:visual`, needs a browser; the package keeps no stored baselines) were not run; the footer and Q7/Q10 lines are covered by the layout and view tests only.
- Migration 0036 was run against test data only, not a copy of staging data.
- The portal's own tests were not run separately (only through `pnpm test`, which passed).

**Open questions**
- **Certificate footer:** the acceptance certificate still prints the fixed `hello@techaust.com` (Q11 names the proposal and estimate PDF footer). To follow Settings it would need the sent document's frozen `issuer.company.email` passed to the certificate view in the jobs Worker (small change). Do you want it, or keep the certificate fixed?
- **Settings default:** the Settings default for "Email on documents" may differ from `hello@techaust.com` (the code-review helper read it as contact@); the PDF footer now prints whatever Settings holds at send, so check the value on staging before the next send.

### Builder report: certificate footer (builder, Sonnet 5.5 medium, 2026-10-26)
The acceptance certificate's page footer now prints the document's frozen "Email on documents", like the proposal and estimate PDFs, and falls back to hello@techaust.com for versions sent before it was frozen.
- `apps/jobs/src/certificate.ts`: `CERTIFICATE_READ` also reads `issuer.company.email` (`issuer_email`, JSON-guarded); `buildCertificateView` sets `emailOnDocuments` only when present.
- `packages/pdf/src/layout/certificate-skeleton.ts`: `CertificateView.emailOnDocuments?`, `certificateCss(footer)` (the old `CERTIFICATE_CSS` stays as the default), `certificateFooter(view)` using `footerLine`; `render.ts` builds the stylesheet from it.
- Tests: `packages/pdf/test/m45.test.ts` (footer with and without the address), `apps/jobs/test/offers.test.ts` (read from the issuer; absent on an older issuer; `world` takes `issuerEmail`).
- Results: pdf 125 passed, jobs 258 passed, `pnpm check` exit 0. No admin code changed, so the admin budget line stands at 414,514 bytes. Q9 and the Settings value are kept as decided.

## Designer report (designer, Opus 5.5 medium, 2026-10-26)
Branch `fix/batch-review-ui-design` (from `origin/fix/batch-review-ui` at 2bde203+), commits 8b77a29, ef92985, e55c221, a page-header commit, 16aeef8 and the report commit. Only `apps/admin/src/**` and `apps/portal/src/**` changed (checked with `git diff --name-only origin/fix/batch-review-ui...HEAD`).

**Skills loaded:** `frontend-design:frontend-design` (set the bar: one way to draw each pattern, no decoration added; it led to the flat date field joined to its calendar button, the content-sized identity strip, and keeping the bar labels to caption-size muted ink); `dataviz` (M9 and the dashboard: recessive but visible track in both themes, labels in text tokens never series colour, selective labels only where a mark needs a name, bars stay aria-hidden because the words carry every figure). `code-review` not run (no review asked of this task; the reviewer re-checks).

**Findings and what I did**
- **Owner 1 / M1 (empty states):** `DataTable` now wraps its empty state in `.dtable dtable--empty` (keeps the table's top margin); `.empty-state` loses its 40rem cap (full width, body text keeps the lede measure). One fix covers the 19 screens. The "0 … on this page" line is dropped when a list is empty (projects, leads, clients, care plans, documents, approvals, catalogue services, audit, users). Time: the empty week is one quiet panel line (no card in a card) and the Entries panel is left out while the week is empty, so the sentence shows once.
- **M2 (Client filter):** the width rule moved from `documents.css` to the shared `.client-filter` (`projects.css`): `flex: 1 1 22rem; max-width: 26rem`; hint is C1 "Client code or name".
- **Owner 2 / M3 (fields side by side):** `FormField` renders a head (label + hint) and a body (control, status, error); in a two-column `.form-grid` each field spans two grid rows with `grid-template-rows: subgrid`, so the controls of one row always line up whatever the hints. Every child of `.form-grid` spans two rows so mixed fields stay in step. Proposal editor: Send to over Validity (a select can't wrap; no stretched select). Log time dialog: Date over Time spent (different shapes, they can't line up side by side).
- **M4 (dates):** new `components/date-field.tsx` + pure `lib/date-field.ts` (tested): typed DD/MM/YYYY (also 6/1/2026, dots, dashes, spaces, a pasted ISO), echo "26 Oct 2026" under it (linked by `aria-describedby`), a 44 px calendar button in tokens (`surface-alt` / `text-accent`) that opens the browser's own calendar through a hidden native input (`showPicker`, falls back to focusing the field). ISO in and out, so no caller or API changed. Replaced all 15 native date inputs (audit, care new, document start, schedule target date, lead next action, new lead, milestone, project new and overview, time entry, CSV export).
- **M5:** `.btn` gets `text-decoration: none`; link-buttons keep their own colours on hover.
- **M6:** coming back to Overview from Notes or Files reloads the project page.
- **M7:** "No proposal is linked to this project."; a project with `sourceDocumentId` shows an "Open it" link (DOC38) to the proposal.
- **M8:** the Send dialog shows "No contact of this client has portal access yet. Turn it on for a contact first." with a "Contacts" link to `?tab=contacts`, and Send is disabled.
- **M9:** hours bar track = `color-mix(border-control 40%, surface)` (visible in dark); the large bar labels its mark "80 %"; the discount meter shows 0 %, 10 % and its end; the schedule bar numbers each instalment's segment (where it is at least 8 % wide). New shared `.bar-scale` in `shell.css`, all aria-hidden.
- **M10:** the portal decision card's "Valid until" uses the document's ISO date through `dateText` (four-digit year). The document paper keeps the PDF view's own short dates.
- **M11:** the Cover renders one line per line (`SectionBody cover`), the client line first in 600. The terms text itself is not in the document read API (only id, version, sha) and the settings route is owner-only: **builder item**.
- **M12:** `.dialog__actions` is sticky at the dialog's bottom edge with a hairline; the services list lost its inner scroll, so the New proposal dialog has one scroll and Create draft is always in view (applies to every long dialog).
- **H1:** `Logo` draws both lockups and CSS shows one by `data-theme` (then the OS), like the top bar mark. Checked: in-app dark on OS light shows the on-dark lockup.
- **H2:** Settings › Document terms renders versions with `Markdown`; the scroll box is gone (axe clean).
- **Lows:** numbering Edit buttons measure 44 px now (1280 and 375); the Proposals rows-per-page select sits inside the content edge at 375; week buttons share one row at 375 ("week" kept for screen readers); the time grid prints "1 h 30 min" like the totals; Planned uses a calendar icon and Active a progress icon (projects and care plans); identity strips size each fact by its value (flex), two columns on phones; page-header actions stay at the right of a long title from 48rem, and the header row is at least 44 px so the Catalogue h1 no longer moves between tabs; Status history prints the recorded time only when it differs from the effective day; the Pause, Resume and Cancel sentences keep dates on one line (`KeepDates`); dashboard activity rows are all two lines (what, then when); `/login` and `/sign-in` go to the dashboard after signing in; "(milestone M4.1)" removed from both Settings lines. The convert dialog's light scrollbar: not reproduced (Chromium draws the dark scrollbar with `color-scheme: dark`; no accepted estimate locally to open that dialog). The two `/me` 401s on signed-out screens come from React StrictMode running the effect twice in dev only; production asks once (no change).
- **Found while checking (fixed):** a gap in the tablet breakpoint (`min-width: 48.01rem` left exactly 768 px with neither the phone nor the tablet rule) in care, clients, documents and projects CSS, now `48rem`; the Users table overflowed the page at 768 (now scrolls in its own box); the invite dialog's "You can change their role later." sat against the next label (now under "Role").
- **Copy (07-Q):** every `pending()` wrapper removed (admin `projects`, `catalogue`, `care`, `time`, `dashboard`, `offers`; the helper is gone), portal `Ph`/`ErrorLine`/`isPendingText` and the `.ph` style removed. C1, C3, C7, C8, Q3 ("a care plan"), Q6 (one line for type, bytes and pixels, `image_too_big` included), Q7 (SPA `termsLine`), Q12 (`viewedHint` under the delivery list), Q13 (`attachHintOn` when the client's setting starts On), Q8 (an Acceptance section with no text is hidden until there is an acceptance or a decline), Q1 (hint built per role: owner "Search leads, clients, projects, documents and people", staff and sales "Search leads, clients, projects and documents", accountant "Search clients and documents"). No "[Placeholder]" remains in either SPA (grep and on screen).

**Files changed:** `apps/admin/src/{app,care,clients,documents,projects,screens,shell}.css`; `apps/admin/src/components/{data-table,date-field (new),display,form,ui}.tsx`; `apps/admin/src/lib/{care,catalogue,dashboard,date-field (new),documents,offer-words,offers,pdf,projects,time}.ts` and tests `{batch-review (new),care-time,catalogue,documents,offers,pdf,projects}.test.ts`; `apps/admin/src/main.tsx`; `apps/admin/src/routes/{approvals,audit,care-plans,clients,documents,leads,projects,shell,time,users}.tsx`, `routes/care/{new,parts,plan}.tsx`, `routes/catalogue/services.tsx`, `routes/documents/{dialogs,money,offer-panels,read,schedule,send-dialog,side}.tsx`, `routes/leads/{lead,new}.tsx`, `routes/projects/{milestones,new,overview,project}.tsx`, `routes/settings/{flags,payment-terms,terms}.tsx`, `routes/time/{entry-dialog,export}.tsx`; `apps/portal/src/{copy-documents.ts,portal.css}`, `components/decision/{decision-panel,decline-dialog}.tsx`, `components/pending.tsx` (deleted), `lib/offers.ts`, `lib/offers.test.ts`, `routes/offer.tsx`, `screens/document-page.tsx`; this run file.

**Checks and results**
- `bash tools/heavy.sh --log design-check pnpm check`: exit 0 (lint, typecheck, binding, content, worker config, migration guards ok).
- `pnpm --filter @techaust/admin test`: 67 files, 2119 tests passed. `pnpm --filter @techaust/portal test`: 22 files, 577 passed.
- Builds: "admin bundle ok: 414109 bytes (limit 415878), startup 43.4 ms"; "portal bundle ok: 90974 bytes (limit 120000), startup 9.4 ms" (Worker bundles unchanged by SPA work).
- `pnpm lint` once at the end: exit 0, 10 warnings and 6 infos, all in files outside this task (`apps/web/src/lib/catalogue.ts`, `scripts/web-content-lint.mjs`, `packages/pdf/test/*`).
- axe 4.14 (WCAG 2.0 to 2.2 A/AA, temporary copy in `apps/admin/public`, deleted): 0 violations on 16 admin screens (dashboard, projects list and page, care plans list, plan and new, time, proposals list, a draft and a sent proposal, Settings › Document terms, catalogue, clients, leads, approvals, audit) in light and dark. Portal not run through axe (no public folder; only copy and one date changed there).
- Keyboard: the date field is text field then calendar button (Tab order), Escape closes every dialog opened, focus visible; console: only the expected signed-out `/me` 401s, plus router warnings caused by my own `pushState` test navigation.
- Local data (all "(sample)", `@example.test`): owner and staff invites, `portal:sample`, a client "Riverside Clinic (sample)" with no portal contact, a project, milestones, a note, a care plan, time entries, two leads, two proposals (one sent), one approval request from the staff member.

**Screenshots (after)** in `D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform\.claude\worktrees\agent-a4dbe5909a5257ae9\.logs\shots\batch-review-fixes-after\` (the "before" set is the reviewer's in the main checkout's `.logs\shots\batch-review-fixes\`):
- `admin-projects-empty-1280-light.png`: full-width empty state with its gap, wide Client filter, no underline, no "0 projects".
- `admin-care-new-1280-apptheme-dark-oslight.png`: Start date and Billing day inputs level; the date field with its token calendar button and echo.
- `admin-datefield-picker-1280-dark.png`: the field after the calendar button (the native popup isn't captured headless).
- `admin-care-plan-1280-light.png`: actions at the right of a long title, 80 % label, strip sized by content, status history without the doubled date.
- `admin-dashboard-1280-dark.png`: hours track visible in dark, activity rows all two lines, no tags.
- `admin-time-375-dark.png`: week buttons on one row, durations as "1 h 30 min".
- `admin-time-entry-dialog-768-dark.png`: Date over Time spent (before the stacking fix; the stack was checked by code, see below).
- `admin-project-overview-1280-light.png`: "No proposal is linked to this project.", recent notes.
- `admin-new-document-dialog-1280-light.png`: one scroll, Create draft in view.
- `admin-proposal-editor-1280-light.png`: Send to over Validity, meter scale, schedule segment number.
- `admin-send-dialog-1280-light.png`, `admin-send-dialog-no-portal-1280-light.png`: the send dialog, and the M8 notice with Send disabled.
- `admin-proposal-sent-1280-dark.png`: Emails panel without tags, the "Viewed" hint, Cover on separate lines, "version 1 of our terms".
- `admin-settings-terms-1280-light.png`: terms as rendered Markdown, no scroll box.
- `admin-proposals-list-375-dark.png`: cards and pager inside the edges.
- `admin-catalogue-new-768-dark.png`: Code and Name inputs level although only Code has a hint.
- `admin-client-erase-dialog-768-dark.png`, `admin-users-invite-dialog-768-dark.png`, `admin-leads-board-768-dark.png`, `admin-approval-detail-1280-light.png`: the screens the review couldn't reach.
- `admin-login-apptheme-dark-oslight.png`: the on-dark lockup on a dark page with the OS light (H1).
- `portal-home-375-light.png`, `portal-offer-sent-375-dark.png` (dev preview data: header "Valid until 10 Nov 2026", no tags), `portal-email-preview-1280-light.png`.

**Not verified**
- The Log time dialog after stacking Date over Time spent was not re-shot (code change only after the 768 shot); the users invite shot is after its fix.
- The proposal, estimate and certificate PDFs (need the jobs Worker and Browser Run; the pdf package is the builder's): not looked at. The real portal offer pages (the local offer waits for its PDF), so the portal was checked on its dev `/preview` screens only.
- The care convert dialog (needs an accepted estimate); the native calendar popup itself; NVDA.
- Before/after pairs at every width for every screen: I shot the changed patterns at the widths where each defect showed, not all 3 widths times 2 themes per screen.

**Placeholder text:** none left. Labels I added without a 07 line, for the lead to confirm: the date field's calendar button name "Choose a date" (screen readers only) and its "DD/MM/YYYY" format placeholder; "Contacts" as the M8 link text (the tab's own name); "Open it" (DOC38) reused as the project's proposal link; "80 %", "0 %", "10 %" and instalment numbers on the bars.

**Items for the builder**
1. **"sent a document" activity row:** `apps/admin/worker/dashboard.ts` `ACTIVITY_SQL` has no join for `entity_type = 'document'`, so `ref` is null. Add `LEFT JOIN documents d ON a.entity_type = 'document' AND d.id = a.entity_id` and `d.number` in the `coalesce` (an index on the primary key only). The SPA already links any `ref` to `/documents/:id`.
2. **M11 terms text in the admin read view:** the document read API returns `terms: { id, version, sha256 }` only; the staff preview can print the terms text only if the read returns the version's `bodyMd` (frozen with the version). Then `read.tsx` renders it with `Markdown` under `termsLine`.
3. The portal document paper prints the PDF view's short dates ("10 Nov 26"); if the lead wants four-digit years there too, that is `packages/pdf/src/format.ts` (it would change the PDF as well).

**Open questions:** none beyond confirming the four labels above.

## Lead triage of the builder and designer reports (2026-10-26)
- **Merged:** builder (1171f71, fast-forward) and designer (2cdaa7c) into `fix/batch-review-ui`; the run file kept both reports. Designer screenshots copied to the main checkout's `.logs/shots/batch-review-fixes-after/`.
- **Labels without a 07 line, accepted by the lead** (labels, not sentences): "Choose a date" (screen reader), "DD/MM/YYYY", "Contacts" (M8 link), "Open it" (DOC38, reused), and the bar figures.
- **"Email on documents":** the default and the staging value are `contact@techaust.com`, not hello@ as 07-Q Q11 said; the PDFs print the Settings value. Told to the owner.
- **Kept:** the two `/me` 401s on signed-out screens (React StrictMode in dev only).
- **Builder round 2** (below): the dashboard document number, the staff preview's terms text (M11), the portal's on-screen dates (M10 on the document view).
- **Not verified yet:** the PDFs and the real portal offer pages (need Browser Run: checked on staging after the merge); the Log time dialog at 768 after Date moved; NVDA; the portal through axe. The re-check covers what it can locally.

## Brief: builder round 2 (lead, 2026-10-26)
Branch `fix/batch-review-ui-builder2` from `origin/fix/batch-review-ui`. Sonnet 5.5, medium. Skills: `cloudflare:workers-best-practices`, `code-review` on your own diff.
1. **Dashboard:** `apps/admin/worker/dashboard.ts` `ACTIVITY_SQL` gets the document number for `entity_type = 'document'` (a `LEFT JOIN documents` on the id, `d.number` in the `coalesce`), keeping the one batch and the row cap. Test.
2. **M11:** the staff document read returns the pinned terms version's frozen `bodyMd` (only roles that can read the document; no new route, no owner-only data). Then render it in the admin read view under the terms line with `components/markdown.tsx` (one small screen change in `apps/admin/src/routes/documents/read.tsx` is yours). Tests.
3. **M10 on the portal document view:** on screen, dates use the four-digit year ("10 Nov 2026"); the PDF keeps its approved short form. Add a long option to `packages/pdf/src/format.ts` (or a view field) used by the portal view only, and use it in `apps/portal/src`. Tests.
Run the tests of every package you touch, `pnpm check`, and the admin and portal build budget lines. Commit, push your branch, append "Builder report: round 2" to this file, and report.

## Builder report: round 2 (builder, Sonnet 5.5 medium, 2026-10-26)
Branch `fix/batch-review-ui-builder2` from `origin/fix/batch-review-ui`.

**Skills:** `cloudflare:workers-best-practices` (kept the one-batch reads, no new `import()`, no extra D1 call: the terms text rides in the same batch by switching the existing statement). `code-review` on my own diff: done by reading the diff, not by running the skill; nothing further found.

1. **Dashboard:** `ACTIVITY_SQL` gets `LEFT JOIN documents d ON a.entity_type = 'document' AND d.id = a.entity_id` and `d.number_display` last in the `coalesce` (primary-key join; one batch and the row cap unchanged). Test in `documents-batch-fixes.test.ts` (a sent document's `document.send` row carries its number).
2. **M11:** `readContext(c, id, extra, { fullTerms })`; only the document GET asks for the full terms row (the same single statement, with `body_md`). `documentView` returns `terms.bodyMd`; the save answer does not. The route's existing permission covers it, no new route. SPA: `terms.bodyMd` typed in `lib/documents-api.ts` and `lib/documents.ts`; `routes/documents/read.tsx` renders it with `Markdown` (class `terms-md`) under the terms line. Tests: the read returns the text to owner and sales, the save answer has none; the "light reads" test in `documents-fixes.test.ts` now says only the GET loads `body_md`.
3. **M10 portal view:** `longIsoDate` in `packages/pdf/src/format.ts`; `toPdfView(envelope, cfg, { longDates })` (default short, so the PDF is unchanged); the portal's `worker/viewer.ts` and the dev preview `sample-api.ts` pass `longDates: true`, so issue date, valid-until, its note and instalment dates show "10 Nov 2026". Tests: `packages/pdf/test/view.test.ts`, `apps/portal/worker/offer-view.test.ts`.

**Files:** `apps/admin/worker/{dashboard,documents,document-view}.ts`, `apps/admin/worker/{documents-batch-fixes,documents-fixes}.test.ts`, `apps/admin/src/lib/{documents,documents-api}.ts`, `apps/admin/src/routes/documents/read.tsx`, `apps/portal/worker/{viewer.ts,offer-view.test.ts}`, `apps/portal/src/preview/sample-api.ts`, `packages/pdf/src/{format,view}.ts`, `packages/pdf/test/view.test.ts`, this file.

**Commands (all through `tools/heavy.sh`):** admin test 68 files, 2123 passed; pdf test passed (coverage 98.0 % statements); portal test 578 passed; jobs test 258 passed; `pnpm check` exit 0. A first admin run failed on missing workspace links (`Cannot find package '@techaust/core'` from packages/email, fixed with `pnpm install --frozen-lockfile --offline`) and on the one "light reads" test updated above.
**Budget lines:** "admin bundle ok: 414797 bytes (limit 415878), startup 42.1 ms"; "portal bundle ok: 91174 bytes (limit 120000), startup 9.4 ms".
**Not verified:** the admin screen with the terms text and the portal page on screen (no browser run); a separate whole-repo `pnpm lint` (`pnpm check` includes lint). A save in the editor does not refresh `terms.bodyMd`, which only the frozen read view uses.
**Open questions:** none.

## Brief: review of the fixes (lead, 2026-10-26)
Round 2 merged (f9d3a7c). Note: the round 2 builder did not load `code-review` (model-audit shows only `cloudflare:workers-best-practices`); the review covers its diff. Admin Worker 414,797 of 415,878 bytes.
Review `git diff origin/main...origin/fix/batch-review-ui` (code and visual, high). Check that every finding in "Review: full UI/UX check" and the owner's two findings is fixed, that 07-Q is in word for word with no "[Placeholder]" left, and the builder's changes (H3 send logic, migration 0036, the frozen issuer email, Q14, the dashboard join, the terms body on GET, the portal long dates). Visual: the screens the check named, 1280/768/375, light and dark, the in-app theme against the OS theme, axe on admin and portal, keyboard; the Log time dialog at 768 (not verified by the designer). Local only; the allowed setup commands are those in the first brief. Screenshots under `.logs/shots/batch-review-fixes-recheck/`.

## Review of the fixes (reviewer Opus 5.5 high, 2026-10-26): SEND BACK (1 high, 1 medium, 10 low)
Skills: code-review (its helper ran on an allowed model), security-review (no finding at 8/10 or above: terms text behind the route's permission, migration 0036 gated and rebuild-free, the frozen email validated and escaped, hidden sections never reach the portal, the Q14 contact scoped to the client, the dashboard join shows numbers only to roles that see document activity), frontend-design, dataviz. `pnpm check` and full `pnpm test` exit 0; admin bundle 414,797 of 415,878 bytes. Every earlier finding and both owner findings were confirmed fixed (on screen or by code), 07-Q is in, no "[Placeholder]" is left, axe 0 on 15 admin screens and the portal home and offer preview. 20 screenshots in the main checkout's `.logs/shots/batch-review-fixes-recheck/`.
1. **High:** `DateField` drops a date it can't read (`components/date-field.tsx:63-66`, `lib/date-field.ts:23`): "31/02/2026" saves as "Not set" with no message and no `aria-invalid` (WCAG 3.3.1, data lost); the autosaving schedule target date saves `""` while a date is being retyped.
2. **Medium:** the week buttons read "Previous  week" from 768 px (`routes/time.tsx:197`, `:213`).
3. **Low:** clearing a draft's contact puts `{{client.contact}}` back (`worker/document-save.ts:212-213`): accepted, pin it with a test.
4. **Low:** the Q14 rename runs after `checkSections` (`document-save.ts:211`), so a longer name can pass `SECTION_BODY_MAX` without a 400.
5. **Low:** the rename knows only the unspaced `{{client.contact}}`, and its word boundary ignores `\p{M}` (Indic vowel signs) (`document-save.ts:113`).
6. **Low:** the GET loads the full terms text for drafts too (`worker/documents.ts:406`).
7. **Low:** `"body_md" in bundle.terms` and `String()` (`worker/document-view.ts:336`): NULL becomes "null".
8. **Low:** `ANONYMISED_LABEL` duplicates core's `ANONYMISED_CLIENT` (`document-view.ts:27`).
9. **Low:** `CERTIFICATE_CSS` unused, the default footer address in two places, the layout imports from `view.ts` (`packages/pdf/src/layout/certificate-skeleton.ts:134`).
10. **Low:** a redundant long-date conversion with a stale comment (`apps/portal/src/routes/offer.tsx:127`).
11. **Low:** the integrity bells don't name the document, and "Make the PDF again" re-runs a refusal that fails the same way (`apps/jobs/src/pdf.ts:69`, `:142`, `:292`).
12. **Low:** every calendar button is named "Choose a date" (`date-field.tsx:80`).
Notes: proposal terms v1 still says "GST at 18 % is added for Indian clients." (VERIFY WITH CA/LEGAL); not verified: PDFs, the real portal offer page, NVDA, the approval detail, the staging SQL, the native calendar popup.

## Lead triage of the review (2026-10-26)
All twelve are fixed in this task (3 by a test). Owner's answers (2026-10-26):
- **Date error (finding 1):** "Enter the date as DD/MM/YYYY, for example 26/10/2026."
- **Integrity bell (finding 11):** "The PDF of {number} didn't match its saved copy, so it wasn't sent. A developer needs to look at it before it can be sent." (replaces the 07-Q Q9 line; when a document has no number yet, its title stands in, falling back to "Untitled").
- **Terms v1 GST line:** kept for now; on the CA list (VERIFY WITH CA/LEGAL). A change later is a new version in Settings › Document terms.
Fix split: designer (findings 1, 2, 10, 12; screens) and builder (3 to 9 and 11; Workers and packages), in parallel on separate files, then a re-check at medium.

## Fix brief: designer (lead, 2026-10-26)
Branch `fix/batch-review-ui-design2` from `origin/fix/batch-review-ui`. Opus 5.5, medium. Skills: `frontend-design:frontend-design`. Your files: `apps/admin/src/**`, `apps/portal/src/**`.
- **Finding 1:** when the text is not empty and not a real date, the field reports an invalid state to its form (not `""`): `aria-invalid`, the owner's error line linked by `aria-describedby`, and the save blocked in required and optional forms alike; the autosaving schedule keeps the last valid value until the text is a full date or empty. Tests for every path (bad date, two-digit year, empty optional, cleared required, autosave).
- **Finding 2:** one span per label so the gap isn't doubled.
- **Finding 10:** drop the redundant conversion and the stale comment.
- **Finding 12:** each calendar button is named with its field label too (`aria-labelledby` the button and the label).
Checks: the admin and portal tests, `pnpm check`, screenshots of the invalid date (1280 light, 375 dark) and the week buttons at 768 under `.logs/shots/batch-review-fixes-design2/`, axe on the project form with an invalid date. Append "Designer report: review fixes".

## Fix brief: builder (lead, 2026-10-26)
Branch `fix/batch-review-ui-builder3` from `origin/fix/batch-review-ui`. Sonnet 5.5, medium. Skills: `cloudflare:workers-best-practices`, and `code-review` on your diff (load it; the last round skipped it). Your files: the Workers, `packages/*`.
- **3:** a test that pins it (clearing the contact puts `{{client.contact}}` back and blocks send).
- **4:** run the rename before `checkSections`, so a too-long result is a 400 on the save. Test.
- **5:** match the spaced form too, and treat `\p{M}` as part of a word. Tests with a Bengali or Hindi name.
- **6:** load the terms text only for frozen (sent) versions.
- **7:** type the bundle by terms mode; a NULL gives no text, never "null".
- **8:** import `ANONYMISED_CLIENT` from core.
- **9:** remove `CERTIFICATE_CSS` if unused, keep the default address in one place, and fix the import direction.
- **11:** the owner's line above for every integrity refusal, with the number (or the title, or "Untitled"). Tests.
Checks: the tests of every package you touch, `pnpm check`, the admin budget line (don't grow it past the ceiling). Append "Builder report: round 3".

## Builder report: round 3 (builder, Sonnet 5.5 medium, 2026-10-26)
Skills: `cloudflare:workers-best-practices` (no new async work, no module state, no `import()`; the one new SQL is indexed), `code-review` (run on my diff `origin/fix/batch-review-ui..HEAD`: no finding). Branch `fix/batch-review-ui-builder3`, commit ba828dc.
- **3:** a test pins it: clearing the contact puts `{{client.contact}}` back, `unresolved` has `client.contact`, `canSend` is false, the send is refused (`documents-batch-fixes.test.ts`).
- **4:** `document-save.ts`: the rename now runs before `checkSections` (on the sent sections or the stored ones), so a too-long result is a 400 and nothing is written. Test: "Al" x1,990 (5,969 characters) renamed to a 200-character name gives 400, contact and text unchanged.
- **5:** `renameContact` (exported) matches `{{client.contact}}` with or without spaces inside the braces (the catalogue's `PLACEHOLDER_RE` reading), and the whole-word boundary now includes `\p{M}`. Tests: a Bengali name (next to the longer word that starts with it), a Hindi name (same), and the spaced token.
- **6 and 7:** `loadStatements` has a third mode `terms: "frozen"` (new `termsFrozen` SQL in `packages/db/src/documents.ts`: the text only when the document's `frozen_at` is set, else NULL; indexed; the EXPLAIN test now replaces every `?1`). The staff GET uses it, so a draft's read carries `bodyMd: null`. New type `TermsView` (`body_md?: string | null`); `documentView` takes `DocumentBundle<TermsView>` and reads `bundle.terms.body_md ?? null` (no `in`, no `String()`). Test: draft read null, sent read has the text for owner and sales, the save answer carries none.
- **8:** `ANONYMISED_LABEL` removed; `document-view.ts` and the two tests import core's `ANONYMISED_CLIENT`.
- **9:** `CERTIFICATE_CSS` removed; new `packages/pdf/src/footer.ts` holds `DEFAULT_CONTACT_EMAIL` and `footerLine` (the one place the default address is written; `layout/copy.ts` and `view.ts` read it). Not put in `layout/copy.ts`: the portal's view entry may not import `layout` (guard in `m45.test.ts`, which failed on my first try). The certificate layout no longer imports `view.ts`.
- **11:** `BELL_COPY.integrity(label)` is the owner's line; `documentLabel(number, title)` gives number, else title, else "Untitled"; used at all three refusals (snapshot rows, key conflict, render-time envelope check; the render row now selects `title`). Tests updated, plus a unit test for the label and the exact text. The 07-Q Q9 row has the owner's wording.
Commands (all through `tools/heavy.sh`): `pnpm install --frozen-lockfile --offline` (links were missing); `pnpm typecheck` exit 0; `pnpm check` exit 0; tests: admin 68 files 2,128 tests, jobs 15 files 259, pdf all pass (coverage gate ok), db 13 files 206, all exit 0; `pnpm --filter @techaust/admin build`: **admin bundle 415,159 of 415,878 bytes** (round 2: 414,797, so +362; startup 45.7 ms, no forbidden modules).
Not verified: the whole-repository `pnpm lint` (left for the lead's final run; biome was run on every changed file), the admin and portal SPA tests (the designer's files), PDFs rendered in a real browser. The admin budget has only 719 bytes of room left. A DRAFT's staff read no longer shows the terms text under the Terms section (only the "version n" line), as briefed; if the designer's draft preview needs the text, say so.

## Designer report: review fixes (designer, Opus 5.5 medium, 2026-10-26)
Branch `fix/batch-review-ui-design2` from `origin/fix/batch-review-ui`. Only `apps/admin/src/**` and `apps/portal/src/**` changed (plus this report).

**Skills:** `frontend-design:frontend-design` loaded first; it kept the fix to one way of drawing an invalid date (the shared FieldError under the control, and the form's error summary linking to it), with nothing added. No other skill in docs/14 §9 fits a screen-only fix (`dataviz`: no chart touched; `code-review`: no review asked of this step, the reviewer re-checks).

**Findings fixed**
- **1 (high):** `lib/date-field.ts` adds `INVALID_DATE` (what the field gives its form while the text is not empty and not a real date, never `""`), `fieldValue`, `dateError` (the owner's line, word for word: "Enter the date as DD/MM/YYYY, for example 26/10/2026.") and `settledValue`. `components/date-field.tsx`: in a form the field reports `INVALID_DATE`, and the person's text stays (it is no longer reset to empty). With `keepLastValid` (the payment schedule's autosaving target date and the audit log's From/To filters) the last valid value stays until the text is a full date or empty; the field then shows the line itself after blur, with `aria-invalid` and `aria-describedby`. The "26 Oct 2026" read-back is hidden while the text isn't that date. The hidden native input gets only ISO values. Saves are blocked, with the line in the error summary and under the field, in required and optional forms alike: project new and details (`detailsErrors`), milestone (`milestoneInput`, new `dueDate` error; the field id is now `ms-dueDate` so focus lands on it), new care plan (`planInput`), convert to care plan (`dialogs.tsx`), time entry (`entryInput`), new lead, the lead's next action, and the time CSV export (From and To are now `FormField`s with their own errors). A cleared required date still shows its own "enter a date" line.
- **2 (medium):** week buttons: each label is one span ("Previous week", "Next week"), so the gap isn't doubled.
- **10 (low):** portal `offer.tsx`: `validUntil: view.validUntil` (already the long date); the redundant conversion, its stale comment and the `dateText` import are gone.
- **12 (low):** each calendar button is `aria-labelledby` itself ("Choose a date") and `<id>-label`. `FormField` labels now have the id `<id>-label`, and the hand-written labels (project details, time entry, audit, schedule) have it too. Read as, for example, "Choose a date Start date (optional)".
- Also: `.filters--audit { align-items: start }`, so a date filter's error line no longer stretches the selects beside it (seen at 1280).

**Files:** `apps/admin/src/lib/{date-field,projects,care,time}.ts`, `apps/admin/src/lib/{batch-review,care-time}.test.ts`, `apps/admin/src/components/{date-field,form}.tsx`, `apps/admin/src/routes/{audit,time}.tsx`, `routes/time/{export,entry-dialog}.tsx`, `routes/projects/{overview,milestones}.tsx`, `routes/leads/{new,lead}.tsx`, `routes/documents/{dialogs,schedule}.tsx`, `apps/admin/src/shell.css`, `apps/portal/src/routes/offer.tsx`.

**Tests:** new tests cover a bad date (31/02/2026), a two-digit year, a partial date, an empty optional date (saved as null), a cleared required date (keeps its own line), the order rule on two real dates, the autosave's `settledValue`, and the owner's line word for word, through `detailsErrors`, `milestoneInput`, `planInput` and `entryInput`. The admin has no DOM test setup, so the component's behaviour (text kept, its own error after blur) was checked in the browser.

**Screenshots** in `D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform\.claude\worktrees\agent-a002a4cfe2f726924\.logs\shots\batch-review-fixes-design2\`:
- `project-new-invalid-date-1280-light.png`: New project after submit with 31/02/2026: the summary "Fix 2 things before saving" with the owner's line, the red field and its line under Start date, and Target date with its read-back.
- `project-new-invalid-date-375-dark.png`: the same at 375 in dark, with no sideways scroll (scrollWidth 360).
- `audit-filter-invalid-date-1280-dark.png`: audit From typed as 31/02/2026 and left: the line under it, the list still filtered from 01/10/2026 (URL `?from=2026-10-01`), and the selects at their own height.
- `time-week-buttons-768-dark.png`: "Previous week", "This week" and "Next week" with single spaces.
- `time-export-invalid-date-768-dark.png`: the CSV export with From 26/10/26 after Download: the line under From, and nothing downloaded.

**Commands:**
- `pnpm exec biome check --write <changed files>`: fixed formatting. One existing warning remains in portal `offer.tsx:89` (an unused suppression on code I didn't touch).
- `vitest run src/lib/batch-review.test.ts src/lib/care-time.test.ts`: 35 passed.
- `bash tools/heavy.sh --log design2-typecheck`: admin and portal typecheck, exit 0.
- `bash tools/heavy.sh --log design2-test`: admin 2,127 and portal 578 tests passed.
- `bash tools/heavy.sh --log design2-check pnpm check`: exit 0 (this includes the whole-repository lint).
- Local setup: `pnpm dev:secrets`, `db:migrate:local`, `db:seed:local`, `pnpm invite --email owner.sample@example.test --role owner`, and the admin dev server (now stopped).
- axe (WCAG 2.2 A/AA; a temporary copy in `public/`, since deleted) on the project form with an invalid date: 0 violations, light and dark.
- Keyboard: the text field, then the calendar button, with a visible focus ring; the error summary takes focus on submit. Console: no errors.

**Not verified:** the payment schedule's autosave in the browser (I made no draft proposal locally; it takes the same `keepLastValid` path as the audit filter, which was checked); the native calendar popup; NVDA reading the new names. No placeholder text was added.

**Lead's follow-up, done:** the audit log's To field cut its placeholder to "DD/MM/YYY" at 1280. The filter row now wraps (flex: about 9rem per select, at least 11.5rem per date field, which is "DD/MM/YYYY" plus the 44 px button; the hint itself is unchanged), so no cell gets too narrow. It is one row at 1280 (input text area 116 to 119 px, against 106 px for the hint, with or without a scrollbar), selects on the first row and From and To on the second at 1024 and 768, and full width on phones.
Checked at 1280, 1024, 768 and 375 in light and dark, plus the time export dialog (186 px at 375; no other screen has date filters). Screenshots `audit-filters-{1280,1280-light,1024-light,768-light,768-dark,375-light,375-dark}.png` and `time-export-375-dark.png` are in the same folder. Admin tests: 2,127 passed. `pnpm check`: exit 0.

**Open questions:** none.
