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
