Status: designer started 2026-11-01 (branch `feat/portal-local-time`)
Tier: C
Usage:

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
