Status: open
Tier: C
Usage:

# Company phone, WhatsApp and local hours (2026-11-01)

## Brief (lead, 2026-11-01)
**Owner's input (2026-11-01):** the company's registered phone is **+91 98830 23931**, on WhatsApp Business, and it goes everywhere a phone number belongs. Written **"+91 98830 23931"** wherever it is shown or printed (owner). The website gets the WhatsApp chat button (no live chat or AI auto-reply; owner, on the lead's recommendation) **and** a tappable "Phone" line in the footer and on the contact page (owner). The label **"Phone"** is owner-approved (2026-11-01).

**PRD:** WEB-G-18 (contact details from `site.ts`), WEB-G-16 (footer), the contact page (07 §5), docs/06 §1.6 (print: the business-card phone, an owner action now done).

**Designer, your own branch `feat/company-phone-design` from `origin/feat/company-phone`.** Load `frontend-design:frontend-design` first (and the Cloudflare `web-perf` skill for the Lighthouse check).

1. **`apps/web/src/config/site.ts`:**
   - `whatsapp: "919883023931"` (international form without "+", as the comment says).
   - A new `phone` field: the display text `"+91 98830 23931"` and the dial form `"+919883023931"` (for `tel:`), with a comment in the file's style; empty hides the line (WEB-G-18 pattern).
2. **Website screens** (Astro; docs/06; both themes; 1280, 768, 390, 375):
   - **Footer** (`SiteFooter.astro`): a "Phone" line beside the email, `tel:` link, with the hours the same way the WhatsApp line carries them; the WhatsApp line now shows (its placeholder goes).
   - **Contact page** (`pages/contact.astro`, the side panel; labels in `content/forms.ts` `panel`): a "Phone" row with the `tel:` link next to Email; the WhatsApp row now shows.
   - Everything already keyed on `site.whatsapp` simply appears: the CTA band button on home, service, industry and blog pages, the contact form description (07-ZA item 2 wording with WhatsApp), the "urgent" line after a sent form. Check each renders and reads right; no new wording beyond "Phone".
   - `tel:` and `wa.me` links: `wa.me` is external (through `ExternalLink`, the build check enforces it); `tel:` is not an external link (no new tab, no arrow). Make sure `scripts/web-dist-checks.mjs`, the link checker and the content lint accept `tel:` and do not mistake the digits for a typed price; if a guard needs a rule, add the narrowest one with a test.
   - 44 px targets, focus ring, `aria` as for the email link; the number never wraps mid-group on 375 px (keep it on one line).
3. **Search data** (`components/JsonLd.astro`): `telephone: "+919883023931"` on the organisation (Google's form); validate the JSON-LD stays valid.
4. **Print** (`packages/ui/src/brand/print.ts`): add `+91 98830 23931` to `CARD.lines` (after the email) and to `LETTERHEAD_FOOTER` (after the email); drop the "added once the owner confirms it" comment; `pnpm --filter @techaust/ui build:brand`; commit the outputs (drift tests). Look at the rebuilt card and letterhead PDFs (render to PNG) and check nothing crowds or overflows the 3.5 × 2 in card; docs/06 §1.6 and line 88: mark the owner action done.
5. **Content doc:** docs/07 — the contact panel's "Phone" label (owner, 2026-11-01) and the number's written form, in the contact section beside the existing labels.
6. **Hours in the visitor's own time** (owner, 2026-11-01; [13](../13-decisions.md)): **one time only, in the visitor's zone**. A visitor whose clock is on IST sees today's text ("Mon–Sat, 10:00–19:00 IST"); anyone else sees the same window in their own clock with their zone's short name and **no IST beside it**, e.g. London in winter "Mon–Sat, 04:30–13:30 GMT"; when the window crosses local midnight the end gets **"next day"** (owner-approved words) and the weekdays shift with the start, e.g. Los Angeles "Sun–Fri, 20:30–05:30 next day PST". Zone name from `Intl.DateTimeFormat(…, {timeZoneName: "short"})`; where the browser gives none, its "GMT+1" form. Computed in the browser for today's date (daylight saving included); **without scripts the IST text stays** (server-rendered, never empty).
   - **Where:** every rendering of the hours: the footer (with the WhatsApp and Phone lines), the contact page panel, the forms' "We reply within one business day (…)" description and lede and the sent-form "reply" line (`content/forms.ts`), and the care-plan page's response-time label and FAQ answer (`content/services/care-plans.ts`). Keep one source for the window (10:00–19:00 IST, Mon–Sat) instead of the repeated strings.
   - **Quote form "Best time for a call":** each window's label shows the visitor's local times only with the zone name (the "your time:" label in 07 §5.9 goes); the submitted value stays the IST window, so staff always read IST.
   - **Logic:** extend `apps/web/src/scripts/call-time.ts` (pure, Node-tested) for the day shift, "next day" and the zone name; tests for IST (no change), London winter and summer, New York, Los Angeles, a half-hour zone, a zone east of IST (e.g. Tokyo, Sydney: the window may start before the IST day), and a missing zone name.
   - **Unchanged:** "We're in India (IST, UTC+5:30)" in the FAQs (it says where we are); blog and legal *dates*. CSP hashes for any new inline script (the build checks them).
   - Record the wording in docs/07 (§1 "Times" rule: local time only, IST for India and without scripts; §5.9; the contact and footer lines; "next day").
7. **Checks:** `pnpm --filter @techaust/web build` (dist checks, link check, content lint), `pnpm --filter @techaust/ui test`, the web tests; axe 0 and no console errors on home, contact, one service page; Lighthouse on contact no lower than before. Heavy commands through `bash tools/heavy.sh --log <name> …`; the whole-repo lint once at the end. Screenshots to `.logs/company-phone/` in your worktree.

**Out of scope:** Admin › Settings › Company › "Phone on documents" (the owner types it on staging; the live value at Phase 7 L-checklist); a live-chat or AI assistant (later, its own milestone if ever); the social profiles (the owner adds the number on each platform); WhatsApp Business greeting/away messages (drafted by the lead for the owner, not code).

**Done means:** the number shows correctly in the footer, contact page, CTA bands and JSON-LD; the hours show in the visitor's own time everywhere (IST in India and without scripts); the business card and letterhead carry it; build guards and tests green; screenshots in this file; reviewer approves.

**Rules:** commit at each finished part and at least every 20 minutes; stop every dev server you started; never touch hosted services; append your "Designer report" here and push only your branch.

## Designer report (designer, 2026-11-01)
Branch `feat/company-phone-design` from `origin/feat/company-phone` (fcf1972a); commits 9bf603b3, 5dac7c1f, 6f7c5d7c and this report, all pushed.

**Skills loaded:** `frontend-design:frontend-design` (loaded first). It set the direction inside docs/06: no new devices or decoration; the phone and hours follow the contact panel's existing pattern (value, then a quiet muted line), so the footer's long local times ("Sun–Fri, 21:30–05:30 next day PDT") sit on their own line instead of stretching the link, and the print contact block was re-anchored to the card's type lines rather than just appended. `cloudflare:web-perf`: used for the Lighthouse and layout-shift checks (it led to measuring CLS for visitors outside India, which Lighthouse on an IST machine never sees, and to the /thanks fix below). Not loaded: `dataviz` (no chart or stat tile).

**What was built**
1. `site.ts`: `whatsapp: "919883023931"`; `phone: { display: "+91 98830 23931", dial: "+919883023931" }` (empty `display` hides it); `HOURS = { from: 600, to: 1140, days: [1, 6] }` is the one source, `site.hours` is derived from it.
2. Hours in the visitor's own clock: `scripts/call-time.ts` (pure, Node-tested: `localWindow`, `istText`, `textRuns`, `gmtName`), `components/Hours.astro` (server writes IST in unbreakable runs "Mon–Sat," · "10:00–19:00" · "IST"), `scripts/local-time.ts` (loaded from the head on every page; rewrites every `[data-hours]` once, textContent only; zone name in the visitor's first English locale, else en-US; Chromium's "GMT+0" written "GMT"). Content uses a new `{{hours}}` token (`lib/tokens.ts`; plain text and JSON-LD print IST): contact meta, lede, thanks reply, care-plan response-time row and FAQ. The quote form's call windows are `Choice` labels with `window` (Hours), value still the IST window; "your time:" and `yourTime` removed.
3. Footer: phone line (`tel:`, same tab, "Phone" visually hidden before the number, number never wraps) and the WhatsApp line, each with the hours on a muted line under the link; WhatsApp placeholder removed.
4. Contact panel: Email · **Phone** (`tel:` link, hours under it) · WhatsApp (hours under it) · Address. Its external links now get the 44 px target (`dd :global(a)`; the scoped `dd a` rule never reached `ExternalLink`, so the WhatsApp link was only its line's height, visibly tighter than the email and phone rows in the first screenshot).
5. CTA band: the "Chat on WhatsApp" button is now an `ExternalLink` (new tab, arrow, screen-reader note). As a plain `Button` it would have failed `checkExternalLinks` the moment the number was set.
6. /thanks: with JavaScript the reference line and the WhatsApp "urgent" line keep their place while hidden and are removed when the URL has no valid reference (CLS at 375 px was 0.104 with the new WhatsApp line, now 0 at 375 and 1280 px in three zones).
7. JSON-LD: `telephone: "+919883023931"` on the organisation (only while the phone shows), tested.
8. Print: `CARD.lines` and `LETTERHEAD_FOOTER` carry "+91 98830 23931" after the email; the card's contact block stacks upward from the role's line (its last two lines share the name's and role's lines; nothing crosses the 6 mm margin); the letterhead footer spreads its five items with equal gaps across the 178 mm measure (fixed columns would have overlapped). `build:brand` outputs committed (all four PDFs change because the print source hash is in their metadata).
9. Docs: 07 §1 "Times" rule, §2.2 footer and the phone's written form, §2.4, §4.14 note, §5.8 panel "Phone", §5.9 call windows, §9 WhatsApp row done; 06 §1.6 owner action done, print file notes.

**Files changed:** `apps/web/src/config/site.ts`, `src/scripts/call-time.ts`, `src/scripts/local-time.ts` (new), `src/scripts/forms.ts`, `src/scripts/thanks.ts`, `src/components/Hours.astro` (new), `src/components/SiteFooter.astro`, `src/components/CTABand.astro`, `src/components/CopyText.astro`, `src/components/form/Choice.astro`, `src/layouts/BaseLayout.astro`, `src/lib/tokens.ts`, `src/lib/structured-data.ts`, `src/content/forms.ts`, `src/content/services/care-plans.ts`, `src/pages/contact.astro`, `src/pages/get-a-quote.astro`, `src/pages/thanks.astro`, `apps/web/test/forms-m24.test.ts`, `apps/web/test/structured-data.test.ts`, `packages/ui/src/brand/print.ts`, `packages/ui/brand/print/*.pdf` (4), `docs/06-design-system.md`, `docs/07-content.md`, this file.

**Commands and results** (heavy ones through `tools/heavy.sh`, logs in `.logs/` of the worktree)
- `pnpm --filter @techaust/ui build:brand`: 22 SVGs, 15 rasters, 4 print PDFs; `pnpm --filter @techaust/ui test`: 471 passed, 2 skipped (drift tests green); `pnpm --filter @techaust/ui typecheck`: clean.
- `pnpm --filter @techaust/web build`: `check-web-dist: ok` (CSP hashes, external links, link check, content lint, no price literals; the phone digits are not taken for a price, so no guard needed a new rule; `tel:` is skipped by the link checker and the external-link check by design).
- `pnpm --filter @techaust/web test`: 40 files, 880 passed (new: IST unchanged, London winter and summer (en-GB "BST", en-US "GMT+1"), New York EST and EDT, Los Angeles PST and PDT, Kathmandu +5:45, St John's −3:30, Adelaide ending at local midnight, Tokyo, Sydney both seasons, Kiritimati +14, the IST day near midnight, no zone name, "GMT+0", call windows; JSON-LD telephone).
- `pnpm --filter @techaust/web typecheck`: 0 errors, 0 warnings.
- `pnpm --filter @techaust/web lhci` (10 URLs × 3 runs, mobile): all assertions passed; /contact 100/100/100/100 in all three runs, CLS 0 (the gate's maximum, so not lower than before).
- Playwright (built site, `astro preview`): 58 shots, 0 console errors (the missing `/api/geo` under `astro preview` excluded: no Worker there), 0 horizontal overflow; axe (WCAG 2.0/2.1/2.2 A and AA) 0 violations on home, contact, care plans and get-a-quote, light and dark, visitor in Los Angeles. CLS measured in Los Angeles, London and IST at 375 and 1280 on contact, thanks and care plans: 0 everywhere.
- Keyboard pass on /contact: tab order header → form → panel (email, phone, WhatsApp) → footer (logo, email, phone, WhatsApp, columns); focus ring on each, every link 44 px; no trap.
- `pnpm lint` (whole repo, once): exit 0; 10 warnings and 8 infos, all in files this task didn't touch.

**Screenshots** (`D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform\.claude\worktrees\agent-a0736b0f2943594b9\.logs\company-phone\`; names are `<view>-<width>-<theme>-<zone>.png`)
- `contact-{375,768,1280,1920}-{light,dark}-{Asia_Kolkata,America_Los_Angeles}.png`: the contact page, full height; IST text in India, "Sun–Fri, 21:30–05:30 next day PDT" in Los Angeles (today is the US clock-change day, so the window starts in PDT).
- `contact-en-GB-1280-light-Europe_London.png` ("Mon–Sat, 04:30–13:30 GMT"), `contact-sydney-375-light-Australia_Sydney.png` ("15:30–00:30 next day GMT+11").
- `home-footer-{375,390,1280}-{light,dark}-{zone}.png`: the footer, phone and WhatsApp with the hours under each.
- `home-band-{375,1280}-{light,dark}-Asia_Kolkata.png`: the CTA band with "Chat on WhatsApp" as an external link.
- `care-plans-{375,1280}-{light,dark}-America_Los_Angeles.png` (full page) and `care-sections-…-{1,2}.png` (the plan table's response-time row; the FAQ answer).
- `quote-step4-{375,1280}-{light,dark}-{zone}.png`: "Best time for a call" in local time only (IST windows in India).
- `thanks-{375,1280}-{light,dark}-Europe_London.png` (reference, local reply hours, WhatsApp line) and `thanks-no-ref-…-Asia_Kolkata.png` (no gap left when there is no reference).
- `keyboard-focus-{19,20,23,24}-1280.png`: focus on the panel's phone and WhatsApp links and the footer's.
- `axe_*.png`: the pages axe ran on; `results.json`: per shot the hours text, console errors, overflow and axe result.
- `print-business-card-p1.png` / `-p2.png` (front, back) and `print-letterhead-p1.png`: the rebuilt print PDFs rendered at 6× and 2×.

**Not verified**
- Real devices: the `tel:` link dialling on a phone, and Safari's and Firefox's zone names (Node and Chromium were tested; the GMT-offset fallback covers a browser that gives none).
- NVDA or another screen reader (axe and the accessibility tree only).
- A printed proof of the card and letterhead (on-screen render only).
- `/api/geo` and the forms' Worker were not running in the screenshot server (`astro preview`); the Worker is unchanged.

**Placeholders:** none added.

**Open questions for the lead**
1. The care-plan row "(business hours, Mon–Sat 10:00–19:00 IST)" now reads "(business hours, Mon–Sat, 10:00–19:00 IST)" (a comma after "Mon–Sat"), because it comes from the one hours source like every other rendering; docs/07 §4.14's table now matches. Keep, or should the row have its own format?
2. Footer layout: the hours sit on a muted line under the phone and the WhatsApp links (as on the contact page) instead of in brackets inside the link as before; with a long local time the bracketed form wrapped awkwardly and pushed the WhatsApp arrow to the far edge. "Phone" is read by screen readers before the footer number; on screen the phone icon stands for it, as the mail icon does for the email. Confirm, or ask for the visible word "Phone" in the footer too.
3. On the day a visitor's clock changes (US and EU twice a year) the window can start in one zone abbreviation and end in another; the label shows the start's (e.g. "21:30–05:30 next day PDT" on 1 November). Acceptable for one day a year?
4. The contact page's meta description and the JSON-LD keep IST (plain text, no script), as the brief implies for "meta text"; confirm.

### Lead decisions on the designer report (2026-11-01)
1. The care-plan row's comma ("Mon–Sat, 10:00–19:00 IST", from the one hours source): kept.
2. The footer's Phone line uses the icon with "Phone" for screen readers, like the email line: kept (one pattern); the contact panel shows the visible "Phone" label.
3. On a clock-change day the zone name is the one in force at the window's start: accepted.
4. Meta descriptions and JSON-LD stay IST (crawlers have no visitor zone): confirmed.
Usage: designer claude-opus-5-5/high (from the agent's report; model-audit at integration).

## Review brief (lead, 2026-11-01)
Reviewer, Opus 5.5 at high; load `code-review`, `frontend-design:frontend-design`, `cloudflare:web-perf`. Your own worktree from `origin/feat/company-phone`; review the branch against `origin/main`. Check the brief items 1–6 and the owner's decisions in 13 (the last four rows): the number's written form everywhere, `tel:` and `wa.me` links (external-link rule), the hours shown **once** in the visitor's own zone ("next day", the weekday shift, zones east of IST, half-hour zones, a missing zone name; IST in India and without scripts; no layout shift), the quote form's call windows (labels local, value still the IST window), JSON-LD, CSP hashes for the head script, the card and letterhead PDFs (render them and look), docs/07 and docs/06 lines; no new wording beyond "Phone" and "next day". Run the web build and tests and `@techaust/ui` tests through `bash tools/heavy.sh`; a live look at contact, the footer, a service page's CTA band, care plans, get-a-quote step 4 and thanks at 375 and 1280, both themes, with the browser's time zone set to IST, London and Los Angeles; axe 0, keyboard, no console errors. Append "## Review" (APPROVE or SEND BACK, findings ranked with file:line and the fix), push your branch `review/company-phone` only; stop every dev server you started.

## Review (reviewer, 2026-11-01)
**APPROVE.** No critical or high findings; two medium and seven low, listed for the lead's triage.

**Skills loaded:** `code-review` (high, review only: its read-only helper produced nine candidate findings, each checked here; four kept as written, the rest merged or downgraded), `frontend-design:frontend-design` (judged the footer and panel pattern, the CTA button and the thanks page against docs/06 rather than proposing new devices), `cloudflare:web-perf` (led to the head-module timing and layout-shift checks below). Not loaded: `dataviz` (no chart), `security-review` (no auth, session, money or Worker change; the web Worker is untouched).

### Findings
1. **Medium** `apps/web/src/pages/thanks.astro:23-27`: the "If it’s urgent, message us on WhatsApp and quote your reference." link wraps to two lines at 375 px and its arrow icon sits detached at the far right edge of the column, not after "reference." (ExternalLink is `inline-flex`, so the wrapped text becomes one full-width flex item). The line was hidden while `site.whatsapp` was empty; this task makes it visible on every sent form. Screenshot `thanks-body-375-dark-London.png`. Fix: in thanks.astro, `.thanks__urgent :global(a) { display: inline; }` (the icon then follows the last word), or teach ExternalLink to keep its last word and the icon together (a `white-space: nowrap` span); recheck at 375 and 390.
2. **Medium** `apps/web/src/scripts/local-time.ts:23-24`: crawlers render JavaScript (the Google renderer does, on a clock that is not IST), so the indexed page text and search snippets carry the crawler zone ("Sun–Fri, 21:30–05:30 next day PDT") while the meta description and the care-plans FAQPage JSON-LD say IST (lead decision 4 assumed crawlers have no visitor zone). An Indian searcher can see US hours in a snippet, and the FAQ answer no longer matches its structured data. Fix: skip the rewrite for crawler user agents (one guard at the top, e.g. `/bot|crawl|spider|slurp|inspectiontool/i.test(navigator.userAgent)`), or record the trade-off as a lead decision.
3. **Low** `apps/web/src/layouts/BaseLayout.astro:99-104`: the hours module ships as an external `type="module"` script (`BaseLayout.astro_astro_type_script_index_0_*.js`, 1.98 KB), which is deferred, so "before the first paint where it can" depends on the network. Where the local text is longer than IST it can add a line (the care-plan card "Response time" label is three lines at 375 px in Los Angeles); a late module would then shift the content below. Measured here on the local preview: no page-height change on /contact at 375, 768 and 1280 in London and Los Angeles. Fix: none required now; check Lighthouse CLS on a throttled run with a non-IST zone at the Phase 7 performance pass.
4. **Low** `apps/web/src/pages/thanks.astro:115-124` with `src/scripts/thanks.ts:13-14`: with JavaScript on and no valid `?ref`, the two hidden lines hold their space until thanks.ts removes them; a late module shifts the page, a failed one leaves a blank gap. Rare path (bookmarks); accept, or reserve the space only when `?ref=` is present (an inline head check of `location.search`).
5. **Low, one-line** `apps/web/src/lib/forms.ts:36-38`: the `callWindows()` comment still says "the page adds the visitor own clock beside each window"; now the label itself is the visitor clock.
6. **Low** `apps/web/src/pages/get-a-quote.astro:244` and `src/components/form/Choice.astro:51`: `label={w.value}` is ignored when `window` is passed; make `label` optional when `window` is given (or a union type) so nobody edits a label that never shows.
7. **Low** `apps/web/src/lib/structured-data.ts:74`, `src/config/site.ts:282-288`, `packages/ui/src/brand/print.ts:68,76`: the number is typed five times (whatsapp, display, dial, card, letterhead) and JSON-LD gates on `display` but prints `dial`. Add a test that `dial` is `display` without spaces, `whatsapp` is `dial` without "+", and the print lines equal `display`.
8. **Low** `packages/email/src/templates.ts:192,204`, `packages/core/src/reply-templates.ts:25`: the acknowledgement email and the staff reply template still write "Mon–Sat, 10:00–19:00 IST" by hand. Correct today (emails stay IST by the owner decision), but not the one source; a follow-up could move `HOURS` and `istText` into `@techaust/core` beside `CALL_WINDOWS` (call-time.ts `hhmm` and `istText` also duplicate core `callWindowText`, pinned by a test).
9. **Low, one-line** `apps/web/src/components/SiteFooter.astro:5`: the header still says preview pages show labelled placeholders for empty values; the WhatsApp placeholder branch was removed and the phone has none (CTABand keeps its own). Update the comment, or restore a placeholder branch for both lines.

### Checked and found right
- Written form "+91 98830 23931" in the footer, contact panel, card and letterhead; `tel:+919883023931` (same tab, no arrow, 44 px, `white-space: nowrap`, never wraps at 375); footer accessible name "Phone +91 98830 23931"; panel label "Phone". `wa.me/919883023931` through ExternalLink everywhere (CTA band button, footer, panel, thanks), `target=_blank`, `rel="noopener noreferrer"`, screen-reader note; the dist external-link check is green.
- Hours: one source (`site.ts` `HOURS`, the `{{hours}}` token, `Hours.astro`); server HTML and no-script text IST; an IST clock is unchanged (machine zone Asia/Calcutta); London "Mon–Sat, 04:30–13:30 GMT" (en-GB); Los Angeles today "Sun–Fri, 21:30–05:30 next day PDT" (the clock-change day, accepted in decision 3); the tests cover New York, half-hour and 45-minute zones, Tokyo, Sydney, Kiritimati, the IST day near midnight, a missing zone name and the Chromium "GMT+0". Only "Phone" and "next day" are new words.
- Quote step 4: labels local only ("21:30–00:30 next day PDT", "00:30–02:30 PDT", "02:30–05:30 PST", "Any time"), values still "10:00–13:00 IST" and so on; `yourTime` and `data-sub` fully removed; the forms e2e submits by keyboard.
- JSON-LD `telephone: "+919883023931"` on the organisation; meta descriptions IST; CSP: no new inline script (the module is served from self), the dist CSP-hash check is green.
- Print: card (front and back) and letterhead rendered and inspected: the four-line contact block sits right-aligned inside the margins, its last two lines on the name and role lines; the letterhead footer spreads its five items evenly with no crowding. Drift tests green. docs/06 §1.5, §1.6 and docs/07 §1, §2.2, §2.4, §4.14, §5.8, §5.9, §9 match the code and the last four rows of 13.

### Commands run (heavy ones through `tools/heavy.sh`)
- `pnpm --filter @techaust/web build`: exit 0, `check-web-dist: ok` (CSP hashes, external links, link check, content lint, no price literals, no unrendered tokens).
- `pnpm --filter @techaust/web test`: 40 files, 880 passed.
- `pnpm --filter @techaust/ui test`: 471 passed, 2 skipped.
- `playwright test e2e/axe.spec.ts` on index, contact, care-plans, get-a-quote, thanks and pricing (light and dark, 1280 and 375): 24 passed, no violation at moderate or above (IST machine zone).
- `playwright test e2e/forms.spec.ts`: 3 passed.
- Live look on `astro preview` of the built site at 375, 768 and 1280, light and dark: London and Los Angeles emulated by re-running the shipped hours module with the zone forced (the browser tool has no time-zone switch); keyboard pass on /contact (panel phone and WhatsApp, then footer logo, email, phone, WhatsApp: logical order, visible 2.4 px focus ring, no trap); reduced motion on; no console errors except the known `/api/geo` 404 under `astro preview` (no Worker there). Preview server and browser stopped. Not run: Lighthouse (the designer lhci run stands), a real phone dialling `tel:`, Safari or Firefox zone names.

### Screenshots (`.logs/company-phone/review/` in the reviewer worktree)
`contact-375-light-IST.png`, `contact-375-light-LA.png`, `contact-panel-375-light-LA.png`, `contact-768-dark-LA.png`, `contact-1280-dark-London.png`, `care-table-375-light-LA.png`, `care-plan-card-375-light-LA.png`, `quote-step4-375-light-LA.png`, `service-band-375-dark-London.png`, `service-band-1280-light-London.png`, `thanks-375-dark-London.png`, `thanks-body-375-dark-London.png`, `keyboard-panel-phone-1280.png`, `keyboard-footer-whatsapp-1280.png`.

Usage: reviewer claude-opus-5-5/high.
