Status: reviewed (APPROVE), lows 1 and 3 fixed; PR open
Tier: C
Usage: designer claude-opus-5-5/high (frontend-design:frontend-design); reviewer claude-opus-5-5/high (code-review at high, frontend-design:frontend-design); 5-h 8 % at the reviewer's start

# Portal times in the client's own time zone (2026-11-01)

## Brief (lead, 2026-11-01; to be completed against the merged M6.2 code)
**Owner's decision (2026-11-01, [13](../13-decisions.md)):** the client portal shows on-screen **times** in the client's own clock with their zone's short name, and **only that one time** (an IST clock sees IST): e.g. London "25 Oct 2026, 07:12 GMT", India "25 Oct 2026, 11:42 IST". If the local date differs, the local date is shown.

- **Where:** every on-screen date-and-time the server writes as "dd Mon yyyy, HH:MM IST" (acceptance and decision times, the signed deed's moment, payment and Paid-online times, any other timestamp found); send the instant (UTC ms) to the SPA or format a returned instant in the browser, falling back to the server's IST text without scripts or a zone.
- **Unchanged:** deadline and due **dates** (validity "(IST)", due dates; 07-ZE lines 1–2 fix them to Indian dates); PDFs, emails and the admin stay IST.
- **Designer** (portal screens, both themes, 390 and 1280, axe 0); tests for IST, London winter and summer, Los Angeles (date before), Tokyo (date after), missing zone name.

### Brief completed against main `22282a1c` (lead, 2026-11-01, after M6.2 merged)
**Branch:** `feat/portal-local-time` (from main with M6.2). The designer creates `feat/portal-local-time-design` from `origin/feat/portal-local-time` in its own worktree and pushes only that. One agent (Tier C: no early check; reviewer afterwards). The lead decides: the designer may add **read-only** fields to existing portal responses (an instant as UTC ms next to the existing IST text, e.g. `decidedAtMs`), with tests; no new route, no SQL write, no migration, no change to what a client may see.

**Where to look** (grep `IST`, `Asia/Kolkata`, `strftime` in `apps/portal`): `worker/offer-sql.ts`, `offer-core.ts`, `offers.ts`, `deeds.ts`, `invoice-summary.ts`, `invoices.ts`; SPA `src/lib/{offers,invoices,pay}.ts`, `src/api.ts`, `src/screens/{home,document-page}.tsx`, `src/components/decision/decision-panel.tsx`; previews `src/preview/sample-*.ts`. Every **time of day** shown on screen moves to the client's clock; a **date alone** (due date, validity "(IST)", the deed's dates, the PDF) stays as it is.

**How:**
- one shared helper in the portal SPA (e.g. `src/lib/local-time.ts`): `Intl.DateTimeFormat("en-IN", { timeZone: <the browser's zone from resolvedOptions()>, timeZoneName: "short", … })` (day-month order as today); output "25 Oct 2026, 07:12 GMT" (same day-month-year and 24-hour layout as the IST text it replaces);
- a zone name the runtime gives as an offset only ("GMT+5:30" style) is shown as given; an unknown or failing zone → the server's IST text (never a blank);
- the first render (and without scripts) is the server's IST text, replaced after hydration without a layout shift (same width class; reserve with `min-width` in `ch` if needed);
- copy lines that embed a time ("… on {date} at {time} IST") keep their wording with the zone name from the helper in place of "IST"; no new copy, so no owner page (if a line can't take it, report it, don't rewrite it).

**Tests:** unit tests of the helper with fixed zones: Asia/Kolkata (IST), Europe/London winter (GMT) and summer (BST), America/Los_Angeles (the date before), Asia/Tokyo (the date after), a zone with no short name; component or route tests that the IST fallback renders without the zone; the worker's new `…Ms` fields equal the stored instant.

**Screens:** offers (accepted, declined), the invoice summary (Paid online, payments), the deed card, home's activity; both themes, 390 and 1280, axe 0; screenshots with the browser zone set to Europe/London and Asia/Kolkata (Playwright `timezoneId`, or the `TZ` of the dev browser) in the run file.

**Checks:** portal tests, `pnpm check` (heavy queue), the portal byte budget (115,225 of 120,000 on main: keep the helper tiny, no new dependency; report the new size).

## Designer report (designer, 2026-11-01; branch `feat/portal-local-time-design`)
**Skills:** `frontend-design:frontend-design`, loaded first. It set the one design call: a moment is typography, so it must never break inside itself. A longer zone name ("GMT+9", "GMT+5:45") pushed a lone zone onto its own line in the list's narrow "when" column and split "on 03 / Nov 2026" on the deed card. Every moment is now two unbreakable runs, "25 Oct 2026," and "06:12 GMT", in the existing type, colours and spacing. No new tokens, styles or copy. `dataviz` doesn't apply (no chart or tile). `cloudflare:workers-best-practices` and `wrangler` don't apply (no Worker source changed, only two Worker tests).

**What the brief's "where to look" found.** The portal already sent every on-screen time as an instant: offers `acceptance.acceptedAt`, `decline.at`, the list's `decidedAt`, and the deed's `esignAt`. So no response field was added (no `…Ms`), and no route, SQL or migration changed. The places that showed a **time of day**, all now in the client's clock:
1. the acceptance record's "Date and time" (`components/decision/decision-panel.tsx`; signed in and on the emailed link `/o`);
2. the decline record's "Date and time" (same file);
3. the summary card's "Accepted {moment}" (`screens/document-page.tsx`);
4. the decided rows of Proposals and estimates (`screens/home.tsx`, `DocumentsScreen`; home itself shows no decided times);
5. the deed card's 07-ZJ line 5, "Signed with Aadhaar eSign on {moment}" (`components/document/signed-deed.tsx`; the copy function is called unchanged and the moment is put in its place, so no copy was rewritten).

The invoice screens show **no time of day**. "Paid online on {date}" (07-ZI line 16) is a date alone, so it stays IST, and so do issue, due, withdrawn and validity "(IST)" dates. PDFs, emails and the admin are unchanged.

**The helper** (`apps/portal/src/lib/local-time.ts`, `localDateTime(utcMs, clock?)`). It uses Intl only and adds no dependency, and keeps core's layout (`formatDate` plus `HH:MM`).
- **Zone names, a deviation from the brief:** the brief suggested `en-IN`. For the same zone names as the website (`apps/web/src/scripts/call-time.ts`), the name is instead Intl's short name in the reader's first English locale, else en-US. So a US browser sees "PDT", where en-IN would write "GMT-7", and an en-GB browser sees "BST". "GMT+0" becomes "GMT". With no name, the offset is shown (`gmtName`, as on the website).
- **IST and failures:** an IST clock (offset +05:30) returns core's `formatIstDateTime` text, and so does any failure (an unknown zone, Intl throwing), so the result is never blank.
- **Seconds** are dropped before the offset is taken, so 11:42:59 IST is still the IST text.

Examples for 25 Oct 2026 06:12 UTC (11:42 IST):
- India: `25 Oct 2026, 11:42 IST`
- London: `25 Oct 2026, 06:12 GMT`; summer with en-GB: `01 Jul 2026, 07:42 BST`
- Los Angeles: `24 Oct 2026, 23:12 PDT` (the date before)
- Kathmandu with no name: `25 Oct 2026, 11:57 GMT+5:45`
- Tokyo, 16:00 UTC: `26 Oct 2026, 01:00 GMT+9` (the date after; en-US Intl has no short name for Tokyo, so the offset is shown as given)

`components/moment.tsx` renders it: `Moment` as the two `nowrap` runs, and `LineWithMoment` for a copy line that embeds one. The portal is a client-rendered SPA, so there is no server-rendered first paint to swap and no layout shift. Without scripts the portal doesn't run at all, as before.

**Files changed:** `apps/portal/src/lib/local-time.ts` (new), `src/lib/local-time.test.ts` (new), `src/components/moment.tsx` (new), `src/components/moment.test.ts` (new), `src/components/decision/decision-panel.tsx`, `src/components/document/signed-deed.tsx`, `src/screens/document-page.tsx`, `src/screens/home.tsx`, `src/lib/offers.ts` (dropped the unused `formatIstDateTime` re-export), and comments only in `src/api.ts` and `src/copy-zj.ts`. Tests and config: `worker/deeds.test.ts`, `worker/offer-routes.test.ts`, `e2e/local-time.spec.ts` (new), and `playwright.config.ts`, where `timezoneId: "Asia/Kolkata"` pins the e2e default so the IST texts the existing specs expect hold on any machine, a cloud VM on UTC included.

**Tests and checks:**
- `local-time.test.ts` (10): IST with en-IN and en-US, London GMT and BST, Los Angeles the date before, Tokyo the date after, no short name (Kathmandu, London, St John's), GMT+0, an unknown zone and a throwing namer falling back to IST, seconds, the default clock.
- `moment.test.ts` (3, react-dom/server in workerd): the two runs, the IST fallback text for an IST clock and an unknown zone, and the 07-ZJ line around the moment.
- Worker tests: the accept answer's `acceptedAt` equals `acceptances.accepted_at`; the view's `decline.at` equals `documents.decided_at`; the deed list's `esignAt` equals the stored `esign_at`.
- `bash tools/heavy.sh --log local-time-portal-test pnpm --filter @techaust/portal test`: 32 files, 736 tests passed.
- `bash tools/heavy.sh --log local-time-e2e … playwright test e2e/local-time.spec.ts e2e/t11-deed.spec.ts e2e/accept.spec.ts`: 16 passed. That covers four zones; axe 0 (moderate and up, WCAG 2.2 AA plus best-practice) on accepted, declined and the list at 1280 and 390 in light and dark for India and London, and at 1280 light for Los Angeles and Tokyo; no console errors; and the existing deed and accept specs (44 px button, keyboard focus ring) unchanged.
- `bash tools/heavy.sh --log local-time-portal-build pnpm --filter @techaust/portal build`: "portal bundle ok: **115860 bytes** (limit 120000), startup 17.6 ms". No Worker source changed (`git diff origin/feat/portal-local-time -- apps/portal/worker packages` lists only the two test files), so the Worker bundle is the branch base's own. The brief's 115,225 must predate the final M6.2 code on main. The SPA's `index.js` is 429.68 kB (131.35 kB gzip); it isn't budgeted.
- `bash tools/heavy.sh --log local-time-check pnpm check`: passed. The first run failed on my own `exactOptionalPropertyTypes` slip in `moment.tsx`, fixed. Biome reports 10 warnings and 8 infos in files this task didn't touch.
- `pnpm exec biome check` on every changed file: clean.

**Screenshots** (`.logs/portal-local-time/` in the designer's worktree; full page with the "sample data" bar):
- `accepted-{kolkata,london}-{1280,390}-{light,dark}.png`: the summary's "Accepted …", the deed card ("…eSign on 03 Nov 2026, 14:05 IST" or "08:35 GMT") and the acceptance record. London shows BST for a mid-October acceptance and GMT for the 3 November deed.
- `accepted-los-angeles-1280-light.png`: PDT acceptance, deed "03 Nov 2026, 00:35 PST".
- `accepted-tokyo-1280-light.png`: "15 Oct 2026, 02:4x GMT+9", the day after India's 14 Oct.
- `declined-{kolkata,london}-{1280,390}-{light,dark}.png`, `declined-{los-angeles,tokyo}-1280-light.png`: the decline record's "Date and time".
- `list-{kolkata,london}-{1280,390}-{light,dark}.png`, `list-{los-angeles,tokyo}-1280-light.png`: Proposals and estimates, decided rows in the local clock (two clean lines in the 1280 column) beside the expired row's "01 Sep 2026 (IST)".

**Not verified:**
- The in-app theme against the OS theme: the portal has no in-app theme switch; it follows `prefers-color-scheme` only, and both schemes are covered.
- Screen readers (spans only; no ARIA change).
- Firefox and Safari: Chromium only. Their zone names may differ, for example Safari's; the GMT+0 normalisation and the offset fallback cover the known cases.
- The sample decision times are relative to now, so the screenshots' minutes differ run to run.

**Placeholder text:** none. No copy was added or changed.

**Open questions (lead):**
1. A clock on +05:30 outside India (Asia/Colombo) reads "IST", because the website and this helper treat that offset as IST. The time is right, but Sri Lanka's own name differs. Keep it (Recommended: one rule with the website), or name it by the zone ID?
2. "Paid online on {date}" (07-ZI line 16) stays the IST date, by the rule that dates alone stay IST. For a client west of India paying late in their evening, it is the next day's date. Keep it (Recommended: it matches the tax invoice's date), or show the local date?
3. The deed's `signatureLine` (the sealed text, also on the PDF) still carries "IST". It isn't shown on screen today, so it was left as the document's own words.
4. Zone names follow the website's locale rule rather than the brief's `en-IN`. Confirm (Recommended: one rule across website and portal).

Usage: designer claude-opus-5-5/high (skills: frontend-design:frontend-design). `node tools/model-audit.mjs` finds no logs from inside the agent's worktree; the lead reads it from the main checkout.

## Lead decisions on the designer's questions (2026-11-01)
1. **A +05:30 clock outside India shows "IST"** (e.g. Asia/Colombo): kept. One rule across the website and portal (13, 2026-11-01); the time is right.
2. **"Paid online on {date}" stays the IST date:** kept. The owner's rule keeps dates alone in Indian dates, and it matches the tax invoice's date.
3. **The deed's sealed `signatureLine` keeps "IST":** kept. It is the document's own sealed wording and isn't shown on screen.
4. **Zone names follow the website's rule** (the browser's first English locale, else en-US; "GMT+0" as "GMT"; offset when no short name) over the brief's `en-IN`: accepted, so the website and portal read the same.
- **Bytes:** 115,860 of 120,000 is what the base builds to (no Worker source changed); the 115,225 in 12 predates M6.2's final code.
- Screenshots copied to `.logs/portal-local-time/` in the main checkout (30).

## Integration notes (lead, 2026-11-01)
- `feat/portal-local-time-design` fast-forwarded into `feat/portal-local-time`; `main` (#153, docs only) merged in: `13` and the M6.3 run file taken from `main` (a superset), this run file kept from the branch (the diff to `main` only adds the designer's section). Next: the reviewer (code and visual).

## Review (reviewer claude-opus-5-5/high, 2026-11-01; copied by the lead, the reviewer changes no files)
**APPROVE** (`origin/feat/portal-local-time` @ `74660563`): no critical, high or medium finding; four lows.
1. low, `apps/portal/e2e/local-time.spec.ts:123-125`: the list check accepted any row ending in "(IST)", so a decided row that fell back to its validity text would pass. Choose the expectation by the row's status.
2. low, `apps/portal/src/lib/local-time.ts:24-28, 61-70, 91-94`: the zone-name rule (`gmtName`, the +05:30 IST check, "GMT+0" as "GMT", the locale choice) is a copy of `apps/web/src/scripts/call-time.ts:80-142`; the two can drift. Move the pure rule into `@techaust/core/dates` and import it in both apps.
3. low, `apps/portal/src/copy-zj.ts:15`: the moment comment sat above `number`, not `signedOn`.
4. low: no test exercises the emailed-link view `/o` in another zone (covered by construction: the same `DecisionPanel`).

**Verified:** grep for every IST/zone path in `apps/portal/src` (no time of day left in IST on screen; dates alone stay IST); Node runs of the helper on London's two clock-change edges, Lord Howe, Chatham, Kiritimati, Colombo, UTC, Etc/GMT+12, en-IN in London, an invalid locale, seconds, the legacy alias Asia/Calcutta; no hydration or no-script case (client-rendered SPA); unit 22 passed, e2e 16 passed (axe 0, 44 px), build 115,860 bytes, startup 16.0 ms; live: the accepted page at 390 light and the list at 1280 dark in IST, wrapping only between date and time, keyboard order, no console errors. **Not verified:** Firefox, Safari, screen readers, `/o` in another zone, a live London or LA pass in the MCP browser (covered by the e2e screenshots), full `pnpm check` and full portal tests (the designer ran both).
**Outside this task:** `cpu-baseline.md` said "two of four above" 5 ms for the hook (three of four) and called the webhook path "inside the gate" with 8 and 9 ms readings.

## Review triage (lead, 2026-11-01)
- **1 fixed:** the list check follows each row's status (Accepted or Declined must show a local time, any other row its "(IST)" validity) and needs at least one decided row.
- **3 fixed:** the comment moved to `signedOn`.
- **2 kept as a follow-up** (for 12): one shared zone-name rule in `@techaust/core/dates` for the website and portal; it touches the website's call-time script, outside this task.
- **4 kept as a follow-up** (for 12): one `/o` e2e assertion in London, with M7.1's portal work; covered by construction today.
- **Outside:** the cpu-baseline line corrected ("three of four"; the path is under 10 ms but not all under 7).
- **Checks after the fixes:** `playwright test e2e/local-time.spec.ts` 4 passed (India, London, Los Angeles, Tokyo); portal typecheck exit 0; biome clean on the changed files.
