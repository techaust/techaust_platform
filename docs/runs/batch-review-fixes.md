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
