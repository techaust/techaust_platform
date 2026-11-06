# 07-ZS: M7.5 hardening (the Free-plan usage tile and its bell)

Status: **staff lines only, the lead's under the owner's delegation** (run file [m7.5-hardening](../runs/m7.5-hardening.md) section H; M7.5 has no client line). The bell title is approved (L41). The tile's lines ZS1–ZS15 are the designer's drafts for the lead's approval under the same delegation. English (India/UK spelling), "and" never "&", no banned phrases (07 §1.3), sentence case. Numbers in Indian grouping (`toLocaleString("en-IN")`); dates as the admin writes them ("06 Nov 2026"); days are UTC days, because Cloudflare's daily Free limits reset at 00:00 UTC.

Where they live: the tile's words in `apps/admin/src/lib/usage.ts` (`USAGE_COPY`); the metric names and the bell title in `packages/core/src/usage.ts` (`USAGE_METRIC_LABELS`, `usageBellTitle`).

## The bell (approved by the lead, L41)
- Bell `usage.limit` (Owners, at the 09:00 IST alerts): "Free plan: {Worker requests | D1 rows read | D1 rows written | Queue operations} at {50 | 80} % of the daily limit on {UTC date} ({figure} of {limit})", e.g. "Free plan: Worker requests at 80 % of the daily limit on 2026-11-06 (82,003 of 1,00,000)".
- The metric names (shared by the bell and the tile's rows): "Worker requests", "D1 rows read", "D1 rows written", "Queue operations".

## The dashboard tile (Owner and Accountant; designer's drafts for the lead)
- **ZS1** tile title: "Free plan usage"
- **ZS2** under the title, when the newest reading is yesterday's: "Use on {date} (UTC) against each daily limit, with the last 30 days."
- **ZS3** under the title, when the newest reading is older (with a clock icon, in the text colour): "No reading since {date} (UTC). The figures are from that day."
- **ZS4** a row's figure: "{figure} of {limit}", e.g. "82,003 of 1,00,000"
- **ZS5** a metric that day's reading missed (row figure and table cell): "Not read"
- **ZS6** the share of the limit: "{n} %"; a figure above zero under 1 %: "Under 1 %"
- **ZS7** status words beside the share (status colours with a flag icon): "50 % reached" · "80 % reached" · "Limit reached"
- **ZS8** the marks on each 30-day strip: "50 %" · "80 %"
- **ZS9** the line under the rows (invocations Cloudflare stopped for CPU time or memory that day): "Requests stopped at a Free-plan limit"
- **ZS10** empty (before the first nightly reading, or no analytics token): "No readings yet. Figures arrive each morning once the Cloudflare analytics token is set and the nightly reading has run."
- **ZS11** loading (screen readers): "Loading Free plan usage"
- **ZS12** error: "The usage figures didn't load. Try again in a moment." · button "Try again" (the app's existing word)
- **ZS13** each strip's name (screen readers): "{metric} over the last 30 days: highest {figure} on {date} ({share} of the limit); {n} of 30 days read." · with no day read: "{metric} over the last 30 days: no day read."
- **ZS14** the readout under the day: "{share} of the limit"
- **ZS15** the table: toggle "Show the 30 days as a table" / "Hide the table"; caption (screen readers) "Free plan usage over the last 30 days, newest first"; columns "Day (UTC)", the four metric names, "Stopped at a limit"
