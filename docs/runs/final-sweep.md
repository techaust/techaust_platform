# Run: final sweep of the website, admin and portal, and its fixes

The full audit M1–M5's last step (owner, 2026-10-29; `docs/runs/full-audit-m1-m5.md` "Final sweep"). Three reviewer sweeps on main after FX-1 to FX-5 (2026-10-30), then one fix task (owner rule 2026-10-26: collect every finding, then fix together; copy questions to the owner as one page: [07-ZA](../07-content-appendix/ZA-final-sweep.md)). Owner, 2026-10-30: the whole sweep, its fixes and reviews run on this PC. Screenshots: the lead's `.logs/shots/sweep-admin/` and `sweep-portal/` (the website sweep's were lost with its worktree).

## Final sweep part 1: public website (reviewer, Opus 5.5 high, 2026-10-30, on main a304afc3): SEND BACK
1. HIGH every page: header 8 px too wide at 320 px with a classic scrollbar (WCAG 1.4.10; 1280 at 400 %): gutter 2x16 + logo ~171 + gap --space-6 (24) + Menu 102 = 329. `apps/web/src/styles/header.css:43`, `apps/web/src/components/Logo.astro:47`. Fix: below ~22.5rem gap --space-3 and/or smaller --logo-h, or icon-only Menu (label kept for screen readers); add 320 to the e2e sideways-scroll check.
2. MEDIUM /work title and meta promise case studies that don't exist ("Work: anonymised case studies"; "Case studies from our client projects… real results"): `apps/web/src/content/work-page.ts:6-8`, 07 line 425. Fix: an empty-state title and meta (07 first), like the home "If none" branch.
3. MEDIUM /contact meta names WhatsApp while `site.whatsapp` is empty (`apps/web/src/config/site.ts:12`). Fix: meta from the channels that exist, or add whatsapp to check-prod-readiness. /blog meta describes an empty blog (low, same pattern).
4. LOW straight quotes: quote step 1 error "or 'Not sure'" (`packages/core/src/schemas/forms.ts:25-26`, 07 line 489; the option is "Not sure: recommend something"); "what 'better' means" (home, /how-we-work; 07 line 145). Fix: curly quotes in 07 then code.
5. LOW /pricing words the payment schedule two ways (table "40 % on acceptance, 30 % at the midpoint milestone…" vs "40 % to start, 30 % at a mid-project milestone…", `apps/web/src/content/pricing.ts:25`, 07 line 413). Pick one.
6. LOW bad breaks: "(Mon–" / "Sat," on /thanks at 375 and the /contact lede; "GST e-" / "invoicing" on /blog at 768. Fix: no-wrap spans.
7. LOW verify on staging: locally every form POST logged `forms.rate_limiter_error` and the 2-a-minute limit never fired (by design a limiter error passes; config looks right; likely a Miniflare quirk). Grep staging Worker logs for `forms.rate_limiter_error`.
Passing: e2e 175 passed (axe on 37 pages at 375/1280 both themes, keyboard, menus, forms); build guards ok; no CSP/script errors; no sideways scroll at 375-1600 except 1; text >= 12 px; targets >= 44 px; images alt/size; external links; theme switch vs OS; reduced motion; brand; copy sample matches 07; perf headers.
Not verified: Safari, Firefox (real text-only zoom), phones, NVDA, staging behind Access, quote steps 3-4 by eye, forced colours, a full manual Tab pass.
Screenshots: .logs/shots/sweep-web/ (F-header-320-light.png for 1).

## Final sweep part 2: admin (reviewer, Opus 5.5 high, 2026-10-30, on main a304afc3; third attempt after two network drops): SEND BACK, 4 high, 7 medium, 9 low
Screenshots and progress: .logs/shots/sweep-admin/ (progress.md; empty/ for empty states).
1. HIGH Project › Milestones at 768/1024: title column shrinks to 0-50 px (one letter per line), draft-invoice link 35 px strip, headers overlap. `apps/admin/src/projects.css:254-270` (--ledger-cols), stacked layout only below 48rem (:460). Fix: stack below ~80rem or title minmax(12rem,1fr) with wrapping columns. Shots project-milestones-768/1024-light.
2. HIGH Invoices, FX panel empty state on an export draft: link button 26 px tall. `routes/invoices/types-parts.tsx:224-231` (.inv-blockers__jump min-height 0, invoices.css:465-473; 44 px only inside .inv-blockers :486). Fix: 44 px min height or the full-row hit layer.
3. HIGH credit/debit note pages: "Against invoice" link 154x22 px standalone. `routes/invoices/notes-parts.tsx:227`. Fix: the 44 px target the strip's client link has.
4. MEDIUM every invoice page: axe landmark-unique: sheet section named "Lines" by a hidden h2 (`routes/invoices/read.tsx:404-407`, `note-draft.tsx:147`) and `section.read-lines aria-label="Lines"` (`routes/documents/money.tsx:101`). Fix: name the sheet by the number or drop one landmark.
5. LOW void invoice still shows the locked line "corrections are made with a credit note or a debit note" (`read.tsx:293-308` frozenBanner). Fix: leave it out when void.
6. LOW line Tax column stacks CGST and SGST with no labels ("₹5,400.00 ₹5,400.00" to a screen reader): `money.tsx:151-160`, `lib/documents.ts:523`. Fix: visually hidden CGST/SGST.
7. LOW 375: lines table clips at the right edge with no scroll cue (FX-4 edge shade only in WideList).
8. HIGH Export realisation report at 768 with rows: nested scroll regions both named "Export realisation"; inner `.dtable` gets tabIndex=0/role=region from `useScrollRegion` (`components/scroll-region.ts:15-32`, `data-table.tsx:50`) though it can't scroll; arrow keys do nothing. Fix: require overflow-x auto/scroll in useScrollRegion, or DataTable skips its region inside WideList.
9. MEDIUM Time at 1280: page scrolls 6 px sideways, Entries table past its panel (`clients.css:58-61` scroll only 48-79.99rem; `care.css:597-620`). Fix: scroll region at every width or wrap the actions column.
10. MEDIUM Care plan: axe landmark-unique when the periods table overflows: section "Last 12 billing periods" and the DataTable region (caption) share a name (`routes/care/plan.tsx:403-407`). Fix: different caption name.
11. MEDIUM Dashboard at 320: 6 px sideways scroll; Invoiced table 278 px in a 273 px tile (`routes/dashboard-finance.css:111`). Fix: wrap the year column or smaller money type at the narrowest width.
12. LOW Dashboard Pipeline line breaks after "1 open," (`lib/dashboard.ts:37`, `care.css:1003`).
13. LOW Recent activity: "created a draft"/"logged time" rows name no document or project.
14. MEDIUM Proposals: send-panel and gap-note links ("Team (roles)", "Deliverables", "Assumptions and exclusions") 15 px tall (`documents.css:1153-1158`, `routes/documents/side.tsx:199,250,306`, `routes/documents/parts.tsx:170`); invoice side already 44 px.
15. MEDIUM every list/record: a non-JSON server error (Cloudflare 502/503, CPU-limit HTML) shows "You seem to be offline…"; a malformed JSON error shows ". Try again in a moment." (`apps/admin/src/api.ts:1104` falls back to code "network"; `components/states.tsx:107`). Fix: non-OK + non-JSON → server error with its status.
16. LOW Settings › Bank: error summary repeats "Type the account number again." for INR and USD without naming which (`lib/bank-form.ts:60-61`).
17. LOW copy for the owner: Settings › Tax offers "RBI reference rate on the invoice date" (`routes/settings/tax.tsx:455`); 08-C RA-21 says the time-of-supply date.
18. LOW Settings › Numbering "Edit" buttons 42x44 px.
19. LOW first breadcrumb link and the catalogue "AI Ops" name link 38-43 px wide.
20. LOW staff names not unique in Log time "Log time for" and leads Owner filter (add email when names match).
Clean: axe 0 at 375/1280 both themes on the dashboard, leads, clients (9 tabs), projects, care, time, documents, invoices list, approvals, catalogue, reports, audit, account, settings; no sideways scroll at 375/768/1024/1600/640 except 9, 11; no text < 12 px; focus visible and logical; Escape/dialog focus; reduced motion; theme vs OS at 320; console clean; A3 finding 6 gone; copy sample matches 07.
e2e: 6/6 failed with data (landmark-unique on /reports/realisation and the draft debit note; ERR_INSUFFICIENT_RESOURCES low memory; arrow keys on realisation at 768) — passed 6/6 before data existed.
Not verified: Safari, Firefox, phones, NVDA, staging, real PDFs, step-up actions, register exports with data, sign-in at 320, the FX empty state live, 768/1600 by eye on settings/catalogue/audit.

## Final sweep part 3: portal (reviewer, Opus 5.5 high, 2026-10-30, on main 7e8526e9): SEND BACK, 1 high, 7 medium, 9 low
Shots and progress: .logs/shots/sweep-portal/ (54 files).
1. HIGH all load-failure states (home, proposals list, invoices list, invoice page): no h1, stale page title, focus on body; axe page-has-heading-one. `apps/portal/src/routes/portal.tsx:115` (LoadProblem), `routes/invoices.tsx:71-79, 208-216`. Fix: ProblemScreen with the page's own title (as `routes/offer.tsx:102`) and set document.title. (Wording right: non-JSON 502 says "Something went wrong on our side".)
2. MEDIUM invoice page: paid and credited amounts never shown (`screens/invoices.tsx:219-229`; `creditedMinor` from `worker/invoice-summary.ts:219` unused). Fix: "Paid" and "Credited (credit note number)" rows between Total and Balance due (copy: owner page).
3. MEDIUM invoice page: line discounts missing (lines ~270-300); PDF prints a Discount column (`packages/pdf/src/layout/invoice.ts:251`). Fix: show the discount column as the PDF (07-U §3).
4. MEDIUM contacts without finance: Invoices nav item opens "Page not found"; home tile says invoices "Coming soon" (`components/shell/nav.tsx:12`, `screens/home.tsx:167-172`). Fix: hide both for them, or a short line (owner copy).
5. MEDIUM proposal cover (portal and PDF): the three cover lines run into one sentence (`document-paper.tsx:139`, `packages/pdf/src/layout/document.ts:247`; seed `packages/db/src/seed/templates.ts:88`); client name repeated in "Prepared for". Fix: render the cover's lines as separate lines.
6. MEDIUM proposals list Decided rows at 768: "version" / "1" split (`screens/home.tsx:214-217`). Fix: nowrap or more room.
7. LOW date column shifts with the status pill width. Fix: fixed pill slot.
8. MEDIUM copy record: M1.6 portal copy not in docs/07 (`apps/portal/src/copy.ts:1` header "PLACEHOLDER COPY"): sign-in, Request received, Continue, used link, sign-out, sign out of all devices, errors. Fix: owner page or record approval.
9. LOW (owner copy) estimate terms say "this proposal" three times (`packages/db/src/seed/terms.ts`).
10. LOW (owner copy) payment request page never says "not a tax invoice" (the estimate page does; the PDF carries it).
11. LOW (owner copy) "Prices exclude GST." under a total that includes GST.
12. LOW Invoices icon is a receipt with "$" for INR clients (`components/icons.tsx:129`; admin same).
13. LOW home invoice rows: accessible name "… Due Due 06 Nov 2026" (`screens/invoices.tsx:341-347`); balance shown with no label.
14. LOW after a decision: Acceptance block still shows "Valid until" and extra Download PDF buttons; "Document fingerprint" and "Content fingerprint" side by side confuse.
15. LOW credit note page: "Against invoice …" plain text, not a link; reason not shown.
16. LOW list: credit note total positive ₹5,900.00 with no sign or note.
17. LOW footer contact@techaust.com plain text, not mailto (`components/shell/portal-shell.tsx:90`).
18. LOW PDF route records the view before streamPdf (`apps/portal/worker/invoices.ts:82-96`) — FX-5 review L9, kept with a reason.
Observations: local SQLite contention (credit-note send 500 then retry ok; "access log write failed" on accept): check the accept's access row on staging. A 200 HTML answer from /api leaves "Loading the portal…" forever (unlikely). Portal has no in-app theme (follows the OS; logos by prefers-color-scheme). Anonymised client not exercised live.
Passing: axe clean everywhere except 1; no sideways scroll incl. 320 and 200 %; text >= 12 px; targets; keyboard, dialogs, Escape; reduced motion; CSP on the built app; flows (sign-in, accept, decline, email-link accept, ended link, 404 scoping); four-digit years; money formats. e2e 9 passed; build ok (97,558 bytes, startup 9.0 ms).
Not verified: Safari, Firefox, phones, NVDA, staging, real Browser Run PDFs, real emails, staging CPU, live anonymised client.

## Lead's triage (2026-10-30)
Numbers below are per sweep: W = website, A = admin, P = portal.
- **Fix now (designer, round 1; no new words):** W1, W6; A1, A2, A3, A4, A5 (omit the locked line on a void invoice), A6 (visually hidden "CGST"/"SGST"), A7, A8, A9, A10, A11, A12, A14, A15, A18, A19, A20; P1, P3, P5, P6, P7, P12, P13, P14, P15, P16, P17. A13 (activity rows naming their document or project) if the data is already in the response; if it needs an API change, stop that item and report.
- **After the owner answers 07-ZA (round 2):** W2, W3, W4, W5; A16, A17 and the FX-5 review's L5 (07-ZA 6–10); P2, P4, P8, P9, P10, P11 (07-ZA 11–16).
- **Kept with a reason:** P18 = FX-5 review L9 (`DOCS` is write-once; a key without its object is an incident, not a client view question).
- **Lead checks:** W7 (the forms rate limiter on staging: Workers logs for `forms.rate_limiter_error`, read-only); the portal accept's access row on staging (P observation).
- **Order:** designer round 1 → reviewer (code + visual) → fixes → re-check; round 2 when the owner answers; then the PR.

## Designer brief, round 1 (lead, 2026-10-30)
Designer, Opus 5.5 high. Branch `fix/final-sweep-d1` from `origin/fix/final-sweep`; push only that branch.
- Fix every item in "Fix now" above, in the order website → admin → portal, committing per screen or group. Each finding names its file and line and a suggested fix; take the suggestion unless a better one fits the design system (docs/06; tokens only; 44 px targets; WCAG 2.2 AA), and say when you differ.
- No new words: where a fix seems to need wording, stop that item and list it. No API, SQL or migration change, except A13's read if the data is already returned (else stop that item).
- For the e2e checks that must hold with data (the admin sweep's 6/6 failed with data): add 320 px to the website's sideways-scroll check (W1); make the admin e2e pass with realistic data (A4, A8, A9, A10) and say how you seeded it.
- Check each fixed screen at the widths the finding names plus 375 and 1280, both themes, keyboard, axe; save screenshots by absolute path into the main checkout's `.logs/shots/sweep-fix/` (and keep a `progress.md` there so a network drop loses nothing). Stop every dev server you start.
- Checks: the touched packages' tests and the three apps' e2e through the queue (`bash tools/heavy.sh --log …`), `pnpm check`, the whole-repository `pnpm lint` last. Append "## Designer report, round 1".

## Owner's answer and round 2 brief (lead, 2026-10-30)
The owner approved 07-ZA as recommended ("Approve all", 2026-10-30; docs/13). Round 2 builds it:
- **Designer (after round 1, same branch or `fix/final-sweep-d2` from the task branch):** W2, W3 (descriptions while there is no case study / WhatsApp number / post, switching back by themselves; the content lint keeps every description ≤ 155 characters), W4, W5 (07-ZA 1–5); A16, A17 and the FX-5 review's L5 (07-ZA 6–10: the void dialog's title, body and button for a proforma; the proforma banner); P2, P4, P8 (record the M1.6 lines word for word in docs/07 and drop the "PLACEHOLDER COPY" header), P10, P11 (07-ZA 11–16 except 14). Copy word for word from 07-ZA; update the tests that pin the old words.
- **07-ZA 14 (the terms text) is a seed change, not a screen change:** a new proposal terms version with "this proposal or estimate" in its three places, inserted only while the newest proposal terms row is the seeded version 2 (the `proposalTermsV2Select` pattern: guards that hold on their own; never replaces the owner's own terms), with tests. Lead or a builder, after round 2's screens.

## Builder brief, 07-ZA 14: proposal terms version 3 (lead, 2026-10-30)
Builder, Opus 5.5 high, Tier A (terms pinned by documents). Branch `fix/final-sweep-b1` from `origin/fix/final-sweep`; push only that branch.
- `packages/db/src/seed/terms.ts`: `PROPOSAL_TERMS_V3` = version 2 word for word, except "this proposal" → "this proposal or estimate" in item 2 (Payment) and item 3 (Ownership), and "This proposal is valid" → "This proposal or estimate is valid" in item 6 (Validity) (07-ZA 14, owner-approved). Its SHA-256 written down, recomputed by a test.
- `packages/db/src/seed/index.ts`: a version 3 insert in the `proposalTermsV2Select` pattern (refactor both into one helper if it stays readable): added once, as the next version, only while the newest proposal terms row is the seeded version 2 (its sha), version 3's sha is absent, and Payment terms says 7 days; guards that hold on their own, never the unique index. A fresh seed ends with versions 1, 2 and 3; a rerun adds nothing; the owner's own newest version is never followed.
- Tests: `seed.test.ts` (counts and bodies), `seed-terms-v2.test.ts` (still standing alone), a version 3 test file in the same style; every admin, portal or jobs test that pins the newest terms text or count.
- Documents already sent keep the terms they pinned (check a sent proposal's frozen terms are unchanged).
- Checks: db, admin, portal, jobs tests through the queue (`bash tools/heavy.sh --log …`), `pnpm check`, the whole-repository `pnpm lint` last. Append "## Builder report, terms version 3".

## Designer report, rounds 1 and 2 (designer, Opus 5.5 high, 2026-10-30)
Branch `fix/final-sweep-d1` (from `origin/fix/final-sweep` dccdb06f; 5dd20ba2 merged in at 66b003af before round 2). Every commit is pushed. Screenshots: the main checkout's `.logs/shots/sweep-fix/` (named by item; `progress.md` beside them). Skills: `frontend-design:frontend-design`, loaded first (it kept every fix inside docs/06 and the existing visual language: no new devices, the existing 44 px and focus patterns reused, a deliberate layout per narrow case rather than smaller type everywhere); `dataviz` not loaded (no chart or new stat tile: A11 and A12 only re-flow existing figures); no other docs/14 §9 skill fits a designer's screen fixes.

### Round 1
**Website**
- W1 (1ab2b8b6): below 22.5rem the header's lockup is 20 px tall (about 143 px wide, above the 96 px minimum), with a smaller gap and Menu padding; the phone menu's bar matches: 329 → about 285 px. New e2e test in `apps/web/e2e/site.spec.ts`: every built page at 320 and 303 px (303 = 320 with a classic 17 px scrollbar; Playwright hides scrollbars) has no sideways scroll; the old header fails it. Shots `W1-W6-thanks-320-light.png` (a real classic scrollbar), `W1-menu-open-320-dark.png`.
- W6 (1ab2b8b6): `CopyText` keeps short ranges ("Mon–Sat,", "10:00–19:00") and "e-" words on one line; the page hero lede, the /thanks reply and the empty-blog line go through `CopyText`. Shots `W6-contact-375-light.png`, `W6-blog-768-dark.png`, `W6-thanks-1280-light.png`.

**Admin**
- A1 (e70ef69c): the milestones ledger switches by the panel's own width (container `ledger`): columns from 50rem, stacked rows below; from 36rem due, amount and status share one line under the full-width title. Shots `A1-milestones-768-light.png`, `-1024-light`, `-1280-dark`, `-375-dark`.
- A2 (3186336e): the FX panel's sentence button is 44 px tall. Shot `A2-fx-empty-focus-1280-dark.png` (focused).
- A3 (3186336e): links in a client strip (the client, "Against invoice") are 44 px targets; padding taken back by a negative margin. Shot `A3-credit-note-1024-dark.png`.
- A4 (3186336e): invoice and note sheets are named by their head (number and type), not a second "Lines"; axe 0 on the void invoice and the draft debit note at 1024.
- A5 (3186336e): a void invoice shows "Issued {date} by {name}." without the locked line. Shot `A4-A5-A6-void-invoice-1024-dark.png`.
- A6 (3186336e): `LineTax` (routes/documents/money.tsx) names CGST and SGST for screen readers on invoice and note lines.
- A7 (3186336e): the scroll cue moved from the reports' WideList to `components/scroll-cue.tsx` (CSS in app.css) and wraps the invoice and note lines. Shot `A7-invoice-lines-375-dark.png`.
- A8 (3186336e): `useScrollRegion` makes a box a keyboard region only when its own overflow-x is auto or scroll (`scrollsSideways`): one region on the realisation report. Shot `A8-realisation-768-dark.png`.
- A9 (3186336e): the Time entries table scrolls in its own box from 48rem and its headers wrap; at 1280 neither page nor box scrolls. Shot `A9-time-1280-dark.png` (taken before the header wrap; 0 px of box scroll measured after it).
- A10 (3186336e): "Last 12 billing periods" is a plain panel with its heading, not a second landmark of the same name. Shot `A10-care-plan-1024-dark.png`.
- A11 (3c8f9198): at 320 px the Invoiced figures take the small size, the INR line under a USD figure the caption size, with a no-break space after "≈". Shot `A11-dashboard-invoiced-320-dark-simulated-figures.png` (the reviewer's figures injected).
- A12 (3c8f9198): the pipeline row is two unbreakable pieces, "INR  1 open," and "₹3,00,000.00 before GST": one line where it fits, else the amount starts the next line whole. Shots `A12-pipeline-*-simulated.png` (no sent proposal locally; rows injected).
- A14 (3c8f9198): `a.blockers__link` (section names in the send panel and gap notes, "Add the text in Catalogue") is padded to 44 px; the padding drops while it has keyboard focus so the ring hugs the words. Shot `A14-send-panel-links-1280-dark.png`.
- A15 (3c8f9198): an error answer that isn't our JSON, or has no message, is `internal` "Something went wrong" (the Worker's own words), never "offline"; test in `src/api.test.ts`.
- A18, A19 (3c8f9198): `.btn`, breadcrumb links and the catalogue name link are at least 44 px wide. Shot `A18-A19-numbering-1280-dark.png`.
- Admin e2e with data: `apps/admin/e2e/sample-data.ts`, run by global-setup when `E2E_SAMPLE=1` and the database has no invoice: company (valid GSTIN), LUT, INR and USD bank rows, two sample clients, a project with three milestones, eight time entries, a care plan started 13 months back, and through the API a tax invoice with an issued credit note and a draft debit note, an export invoice under the LUT and a voided invoice. The sweep now visits every invoice of the first page. Run: `pnpm dev:secrets && pnpm db:migrate:local && pnpm db:seed:local && pnpm portal:sample`, then `E2E_SAMPLE=1 bash tools/heavy.sh --log … pnpm --filter @techaust/admin e2e`: 6/6 passed (13.8 min; 5 scroll boxes met by the keyboard).

**Portal**
- P1 (48a5811d): `components/load-problem.tsx` (`LoadProblemScreen`): a failed load keeps the page's h1 and tab title (home: the organisation; the list: "Proposals and estimates"; invoice list and page: "Invoices") and focus moves to it. Shot `P1-invoices-load-failed-375-dark.png` (502 page injected).
- P5 (48a5811d): the cover's lines are separate paragraphs on the portal and in the PDF (`coverLines`). Not seen live (no sample cover text); PDF tests pass.
- P6, P7 (48a5811d): "version 1" never splits; from 48rem the status pill has a 7.5rem slot so the dates line up. Shot `P6-P7-proposals-decided-768-light-simulated.png` (rows injected).
- P12 (48a5811d): the receipt icon has text lines instead of "$" (portal and admin). Shot `P12-P13-home-invoices-tile-375-dark.png`.
- P13 (48a5811d): the home tile's amount is labelled "Balance due" (existing words) above it; a "Due" pill is followed by the date alone.
- P14 (48a5811d): the validity line and its Download PDF button show only while the decision is open. Shot `P14-accepted-1280-light-preview.png`.
- P16 (48a5811d): a credit note's list total has a true minus (`minusMoneyText`, core `negate`). Shot `P12-P16-invoices-1280-light.png`.
- P17 (48a5811d): the footer address is a mailto link with a 44 px target. Shot `P17-footer-mailto-focus-1280-dark.png` (focused).

### Round 2 (07-ZA, owner-approved)
- W2, W3, W4, W5 (ae05b538): /work title and description while no case study is published (`workPage.metaEmpty`, 127 characters); /contact description without WhatsApp while `site.whatsapp` is empty; curly quotes in the service and budget errors (`packages/core/src/schemas/forms.ts`, test updated) and in docs/07; /pricing "How payment works" in the catalogue's wording. docs/07 records the new lines.
- A16, A17, FX-5 L5 (d14d9fc0): bank errors name INR or USD (SPA; test updated, USD case added); "RBI reference rate on the date of supply"; the void dialog's longer sentence; a proforma's own dialog ("Void proforma {number}", its body, the "Void proforma" button and menu item); the proforma's locked banner (test updated). Shot `R2-L5-void-proforma-dialog-1280-dark.png`.
- P2, part (c81b8dd9): a "Paid" row between Total and Balance due once something was paid. Shot `R2-P2-paid-row-375-dark-preview.png`.
- P4 (c81b8dd9): no Invoices link (bar and phone menu) and no Invoices tile for a contact who can't see finance. Shot `R2-P4-no-finance-home-1280-dark.png`.
- P8 (c81b8dd9): the M1.6 lines recorded word for word as [07-ZB](../07-content-appendix/ZB-portal-sign-in-account.md), indexed in docs/07's header; the "PLACEHOLDER COPY" header is gone from `apps/portal/src/copy.ts`.
- P10 (c81b8dd9): the payment request page shows the frozen statutory line (core `PROFORMA_NOTICE`). Shot `R2-P10-payment-request-1280-light-preview.png`.
- P11 (c81b8dd9): "Prices exclude GST." sits under the lines (portal paper and PDF), never under the total; PDF test updated.

### Stopped (each needs an API or SQL change, or wording from the owner)
- A13: the activity feed returns `ref: null` for a draft and nothing about a time entry's project.
- A20: `/time/people` and `/leads/assignees` return id and name only (no email).
- P3: the portal invoice summary selects no line discount (`apps/portal/worker/invoice-summary.ts`, LINES SQL).
- P15: the summary has no parent id and no reason for a note.
- P2, the "Credited ({credit note numbers})" row: the summary carries `creditedMinor` but not the notes' numbers.
- W3, the /blog description: the approved line (07-ZA item 3) is 158 characters, over the 155 the build enforces; it needs a shorter wording (or a decision on the limit).
- Copy questions seen on the way (nothing changed): a proforma's void dialog still says "Reason (required, kept with the invoice)"; the acceptance block's "Document fingerprint" beside the paper's "Content fingerprint" (P14's last part); the proposal cover names the client twice (its first line and "Prepared for"); 07-ZA item 4's service error ends with a full stop, the code keeps the form's no-full-stop style.

### Checks
- Tests: admin SPA (`vitest run src/`) 473 passed; portal 641; pdf 351; core 1,824; web 641.
- e2e: web 212 passed after round 2 (37 new reflow tests); portal 9 passed after round 2; admin 6/6 passed with data after round 1 (round 2 changed only admin words; not re-run).
- Builds: web build and dist checks ok; portal Worker 97,558 bytes (startup 11.1 ms); admin front 99,271 bytes, admin API 613,384 bytes (startup 69.1 ms).
- `pnpm check` ok. Whole-repository `pnpm lint`, run last: exit 0, 1,337 files, 10 warnings and 8 infos, all in files this task didn't touch (admin `worker/reports.test.ts`, web `src/lib/catalogue.ts`, core `src/public-text.ts`, three pdf tests).
- Visual: each screen at its finding's widths and 375/1280, light and dark (admin in-app theme set), axe 0 (axe-core injected) on the void invoice, the draft debit note, the care plan and the realisation report at their finding widths; focus seen on the FX button, a send-panel link and the portal footer link; no console errors from the changed screens. Dev servers stopped and the browser closed.

### Not verified
Safari, Firefox, phones, NVDA, staging; P5's cover and A11/A12's figures with real data (simulated in the page); a real Browser Run PDF; A9 at 1280 with long real names.

## Lead, after the designer's rounds 1 and 2 (2026-10-30)
- Merged `fix/final-sweep-d1` (63830858) and `main` (with #118) into `fix/final-sweep` (e77cada6).
- Stopped items needing an API or SQL change go to the builder (brief below), then a short designer round 3 shows them: A13, A20, P2 (Credited row), P3, P15.
- W3's approved /blog line is 158 characters (limit 155) and four copy questions the designer spotted go to the owner.

## Builder brief, round 3 data (lead, 2026-10-30), with the terms version 3 brief above
Builder, Opus 5.5 high. Branch `fix/final-sweep-b1` from `origin/fix/final-sweep` (e77cada6 or later); push only that branch. Do the "Builder brief, 07-ZA 14: proposal terms version 3" above first, then the data the screens need (API and SQL only; the designer shows them in round 3):
- **A13** admin dashboard "Recent activity": each row carries what it is about: a document's number, else its title (or "Untitled" as the bells do), and a time entry's project code and name. Read from data already in the database; keep the dashboard's one-batch read and its rows-read target (≤ 9,000 at 2,000 documents; `dashboard-stress.test.ts`).
- **A20** `/time/people` and `/leads/assignees`: also return each person's email, so the screens can tell two people with the same name apart (staff routes only; no client data).
- **P2 Credited row**, **P3 line discounts**, **P15 credit note parent and reason** in the portal invoice summary (`apps/portal/worker/invoice-summary.ts`, frozen rows only, every query bound to the session's client): the credit notes' numbers (issued, same client, against this invoice); each line's discount as the PDF shows it; for a credit or debit note, its parent invoice's id and number (only if that parent is the same client's and visible to this contact) and its reason as frozen in `header_extras.noteOf`.
- Tests for each (scoping: another client's parent or notes never appear), plus the existing portal and admin suites through the queue (`bash tools/heavy.sh --log …`), `pnpm check`, the whole-repository `pnpm lint` last. Append "## Builder report, round 3 data" (and the terms version 3 report).

## Designer brief, round 3 (lead, 2026-10-30; after the builder's round 3 data)
Designer, Opus 5.5 high. Branch `fix/final-sweep-d3` from `origin/fix/final-sweep` once the builder's branch is merged; push only that branch.
- Show the builder's new data: A13 (activity rows name their document or project), A20 (a person's email beside a repeated name in "Log time for" and the leads Owner filter), P2's "Credited ({credit note numbers})" row, P3 (line discounts as on the PDF), P15 (the credit note's "Against invoice" as a link, and its reason).
- 07-ZA additions 17–19 (owner, 2026-10-30): the /blog description (item 17), the proforma's void reason label (18), "PDF fingerprint" (19). Item 20: no change.
- Same rules and checks as round 1 (widths, themes, keyboard, axe, screenshots into the main checkout's `.logs/shots/sweep-fix/`, `progress.md`, e2e for the touched apps, `pnpm check`, lint last). Append "## Designer report, round 3".

## Builder report, terms version 3 (builder, Opus 5.5 high, 2026-10-30)
Branch `fix/final-sweep-b1` (from `origin/fix/final-sweep` a5be1e3d; 017e5037 merged in at fdbeaddd, docs only). Commit 1f75df51. Skills: `cloudflare:workers-best-practices` and `cloudflare:wrangler` loaded first (docs/14 §9, builder row): they kept every new read a batched, index-served D1 statement and changed no binding or config, so no `wrangler types` run was needed. `cloudflare:workers-profiling` not loaded (no CPU budget work; the Worker budget scripts were run instead), Turnstile, SES and the rest don't apply.
- `packages/db/src/seed/terms.ts`: `PROPOSAL_TERMS_V3` = version 2 word for word except "this proposal or estimate" in Payment and Ownership and "This proposal or estimate is valid" in Validity (07-ZA 14); `PROPOSAL_TERMS_V3_SHA256` = `be066fe58669d4d1701ec1eb598caf308eab79a97e05d04116d30b5750be8f70` (recomputed by a test).
- `packages/db/src/seed/index.ts`: one helper `nextProposalTermsSelect` builds both the version 2 and version 3 SELECTs (`proposalTermsV2Select`, `proposalTermsV3Select`); version 3 is inserted after version 2 in the same batch, only while the newest proposal terms row is the seeded version 2 (its sha), version 3's sha is absent and Payment terms says 7 days. A filtered row, never an aggregate; nothing rests on the unique index. `SEED_VERSION` 3 → 4. A fresh seed ends with versions 1, 2, 3; a rerun adds nothing.
- Tests: new `packages/db/test/seed-terms-v3.test.ts` (text differs from v2 in exactly the three places; due-days guard on its own; a proposal sent under version 2 keeps its pinned `terms_version_id` and body after the seed adds version 3; added once, its own hash stopping it on its own; the owner's own newer version is never followed, proven with the SELECT under another id and hash); `seed.test.ts` (versions 1, 2, 3 by sha; the owner's row is now version 4); `seed-terms-v2.test.ts` still stands alone (its filter now also drops version 3's statement, which names version 2's hash; comment updated). No admin, portal or jobs test pinned the seeded terms text or count (they seed only templates, or insert their own terms rows).

## Builder report, round 3 data (builder, Opus 5.5 high, 2026-10-30)
Same branch. Commits 99dca498 (A13), adb18659 (A20), 2486570a (P2, P3, P15). API and SQL only; no migration; screen files untouched (only the SPAs' `api.ts` response types).
- **A13** `apps/admin/worker/dashboard.ts` `ACTIVITY_SQL`: each row now also has `title` (a document, or an approval of one, with no number: its title; null for an anonymised client's document, so the screen shows "Untitled" as the bells do), `project` (`{id, code, name}`) and `carePlan` (`{id, clientCode}`) for a time entry, read from the ids its own audit row recorded (`time.create/update/delete` all write `projectId` and `carePlanId`), so a moved or deleted entry names what it was logged against at that event. `ref` now also gives an approval row its document's number. Every new join is a primary-key seek on the ≤ 20 rows (EXPLAIN test for the three plans); the summary itself never leaves the Worker (test). Stress test (rows read ≤ 6,300 per role, every statement indexed) passes unchanged. Lead's call: I added the care-plan case (a time entry is on a project or a care plan; without it those rows still name nothing) and approval rows (they are about a document).
- **A20** `/time/people` and `/leads/assignees` return `email` (work address from `staff_users`; a viewer who logs only their own time gets their own). Tests: two "Sam Same" people told apart; the assignees key set; the existing privacy scan still passes.
- **P2, P3, P15** `apps/portal/worker/invoice-summary.ts` (used by `/invoices/:id` and `/t/document`, both changed to add one statement to their existing batch):
  - P3: `LINES_SQL` reads `discount_kind`, `discount_value`; each line has `discountKind`, `discountValue` and `discount` (text as the PDF prints it: "10 %" via core `percentFromBp`, or the amount).
  - P2: `CREDIT_NOTES_SQL` (`INDEXED BY documents_parent`, bound to the client, frozen, not void, open statuses, issue order, `LIMIT NOTES_MAX` = 20, the per-invoice cap) gives `creditNotes: [{id, numberDisplay}]` on a tax or export invoice; empty on every other type. Debit notes are not listed.
  - P15: `parentId` (a note's invoice, only when same client and openable by the client: frozen, not void, open status and type; null on non-notes) beside the existing `parentNumber`; `noteReason: {code, text}` from `header_extras.noteOf` read through core `noteOfFromStored` (null on other types or damaged data, never a 500). The screen needs the 07-T §3 reason labels for `code`.
  - Tests: discounts, credit-note order, no debit notes, both note types' parent and reason, damaged extras, the token route, scoping (another organisation's contact gets the same 404; the statements bound to another client return nothing; B's invoice lists none of A's notes; no finance, 404), the parent guard proven on the statement (the parent-check trigger forbids a cross-client or void parent, so the subselect is run pointed at another client or a void parent: NULL), EXPLAIN for `CREDIT_NOTES_SQL`. `doc-token.test.ts` key list updated.
- Portal Worker 97,558 → 100,469 bytes (limit 120,000; startup 9.9 ms); admin front 99,271, admin API 614,993 (startup 78.4 ms).

### Commands and results
- `bash tools/heavy.sh --log b1-db-test pnpm --filter @techaust/db test`: 33 files, 490 passed.
- `… b1-admin-test pnpm --filter @techaust/admin test`: 115 files, 3,439 passed.
- `… b1-portal-test pnpm --filter @techaust/portal test`: 25 files, 647 passed.
- `… b1-jobs-test pnpm --filter @techaust/jobs test`: 31 files, 531 passed.
- `… b1-portal-build pnpm --filter @techaust/portal build`, `… b1-admin-build pnpm --filter @techaust/admin build`: ok (budgets above).
- `… b1-check pnpm check`: exit 0.
- `… b1-lint pnpm lint` (whole repository, run last): exit 0, 1,349 files, 10 warnings and 8 infos, all in files this task didn't touch (the same six the designer reported: admin `worker/reports.test.ts`, web `src/lib/catalogue.ts`, core `src/public-text.ts`, three pdf tests).

### Not verified
Staging (nothing deployed); the seed on the staging database (it runs on the next deploy: staging's newest proposal terms row must be the seeded version 2 for version 3 to appear; if the owner saved terms after it, nothing is added, by design); the screens (designer round 3); admin and portal e2e (not run: no screen changed).

### Open questions
- The portal needs labels for the note reason codes (07-T §3 has them for the PDF, `REASON_LABELS` in `packages/pdf/src/invoice-view.ts`); the designer should reuse those words.
- An anonymised client's draft shows no title in the activity feed (I chose this following the bells' rule; the documents list still shows such titles). Lead to confirm.

### Lead, after the builder's round (2026-10-30)
- Merged `fix/final-sweep-b1` (6e53554f).
- The builder's questions: (1) the portal shows a note's reason with the approved 07-T §3 words; the designer takes them from one shared place (move `REASON_LABELS` to `@techaust/pdf/copy` or core so portal, admin and PDF read the same words; no new words); (2) yes, the activity feed follows the bells' rule (a number, else "Untitled", never a title for an anonymised client's draft).
- The terms version 3 seed is Tier A (terms pinned by documents): an analyst's early check of 1f75df51 runs beside the designer's round 3.
