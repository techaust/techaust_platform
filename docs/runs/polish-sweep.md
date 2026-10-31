# Polish sweep (admin and website follow-ups)

Status: builder and designer running
Tier: C
Usage: (none yet)

Session: polish-sweep (cloud). Branch: `fix/polish-sweep`. Copy file: `docs/07-content-appendix/ZL-polish-sweep.md` (only if a new user-facing line is needed).

## Brief
**Tier C** (screens built from existing parts, plus two small API/logic fixes). PRD IDs: ADM-DASH-01 (activity feed), ADM-TIME-01 (time), ADM-INV-03/ADM-INV-05 (issue and note dialogs), ADM-SET-01 (settings save bar), ADM-CLI-05 (anonymise), WEB-G-16 (website focus). Use the closest real IDs from docs/04 in commits; the lead fixes them at integration if wrong.

**Checked on main (474ec9c, 2026-11-01) before briefing:**
| # | Item | Still there? | Owner |
|---|---|---|---|
| 1a | Week grid "1 h 45 min" wraps at 1280 with the menu open (final sweep) | yes (not re-measured by the lead) | designer |
| 1b | Activity feed (and audit log) says "issued an invoice" for a credit or debit note (`apps/admin/src/lib/audit.ts:134` `invoice.issue`) | yes | builder |
| 1c | Same-name people look alike in the Time page's Entries table Person column (`lib/people.ts` `personLabels` is used by the menus, not the table) | yes | designer |
| 1d | Website focus outline measures 1.6 px against docs/06's 2 px (the CSS says `2px`; find why it renders 1.6) | yes | designer |
| 2a | rt1 f4: show known blockers on a dialog's confirm step before the step-up code is asked (note dialog `note-dialog.tsx`, invoice issue dialog `dialogs.tsx`) | yes (blockers only appear after a 409) | designer (stop and report if it needs an API change) |
| 2b | rt1 f5: the note ledger's draft row: the 44 px inline link makes a wide line gap | yes | designer |
| 3a | rt2 F: the invoice issue dialog (`dialogs.tsx`) puts a wrong code in its general notice; one shared `invalid_code` helper (copies in `types-parts.tsx:856`, `note-dialog.tsx:269`, `data-tools.tsx:124,291`, `payments/parts.tsx:103`, `step-up-dialog.tsx:56`, `lib/step-up.ts:15`) | yes | designer |
| 3b | rt2: `Field`'s scroll effect (`components/ui.tsx` ~116) keys on the error text, so the same error twice doesn't scroll again | yes | designer |
| 3c | rt2: after a settings save answered "No change" (e.g. only a trailing space), the "Unsaved changes" bar stays up (`settings/kit.tsx` `GroupForm` dirty check) | yes | designer |
| 4 | The bell's "9+" vs its name "Notifications, N unread" (axe `label-content-name-mismatch`, `components/shell/top-menus.tsx:50-56`) | yes | designer (07-ZL 3) |
| 5a | T7: after an anonymise, the offer's Emails row for that contact shows "–" and "Not sent" though the email was sent | yes (per T7 run file; root cause unconfirmed) | builder |
| 5b | T7: the Erase or anonymise dialog's title scrolls out of view when its body scrolls (shared `Modal`) | yes | designer |
| 6 | M2.5: `zod/mini` on `/contact` and `/get-a-quote` | **dropped**: the form pages use the shared classic-zod schemas `packages/core/src/schemas/{fields,forms}.ts` (web and jobs), so it needs a shared-schema rewrite, which this task excludes | follow-up |

### Builder (`builder`, worktree, sub-branch `fix/polish-sweep-b1` from `origin/fix/polish-sweep`; no browser)
Skills: `cloudflare:workers-best-practices`, `cloudflare:wrangler` (report if they don't load in the cloud).
- **5a.** Find the root cause of the Emails row after an anonymise (`apps/admin/worker/clients.ts` erase batch, `offer-redaction.ts`, `document-links.ts`, the document view's sends list, `src/lib/offers.ts` delivery labels). A send that was emailed keeps its real delivery state (Delivered, Bounced, …); only a send that was still waiting and got cancelled reads "Not sent". The row never shows the erased name or email again: use the existing anonymised wording (core `ANONYMISED_CLIENT` or the contact equivalent already in the code); if no existing words fit, stop and report the line you need. Worker tests for: emailed then anonymised (state kept, no personal data), waiting then anonymised (Not sent).
- **1b.** The activity feed and the audit log name a credit note issue "issued a credit note" and a debit note issue "issued a debit note" (07-ZL 1, 2) from the row's document type (the dashboard rows already carry `docType`; check the audit log rows; add the type to the audit API only if it is missing and cheap: one join or a column already read). New `apps/admin/src/lib/copy-zl.ts` with `APPROVED_07ZL = false`, `PLACEHOLDER_MARK` and a `ZL()` helper in the `copy-y.ts` pattern; the lead flips it when approved. Unit tests.
- Files: `apps/admin/worker/**`, `apps/admin/src/lib/{audit,dashboard,offers,copy-zl}.ts` (+ their tests), `apps/admin/src/api.ts` types if needed. **Do not touch** anything the designer owns (below).
- Run: the admin worker tests you touched, `pnpm --filter @techaust/admin typecheck`, then the whole admin suite through `bash tools/heavy.sh --log b1-admin pnpm --filter @techaust/admin test`; whole-repo lint once at the end (`bash tools/heavy.sh --log b1-lint pnpm lint`).

### Designer (`designer`, worktree, sub-branch `fix/polish-sweep-d1` from `origin/fix/polish-sweep`; browser, `TECHAUST_PORT_OFFSET=0`)
Skills: `frontend-design:frontend-design` first (report if it can't load in the cloud), `dataviz` not needed.
- **1a** week grid: "1 h 45 min" on one line at 1280 with the menu open (keep the durations' words; fix by the grid's own sizing, e.g. `white-space: nowrap` on the duration with a sensible column minimum, without a sideways scroll at 1280, 1024, 768, 390).
- **1c** Time › Entries: the Person cell tells same-name people apart by email, the `personLabels` way (`lib/people.ts`; the email in the cell's quiet second line like the "Log time for" field's echo, final sweep R4).
- **1d** website focus ring: find why `outline: 2px` measures 1.6 px (zoom, a transform, `em` units, device scale…) and make it render 2 px per docs/06, on links, buttons and form fields; check the home page, /contact, /get-a-quote and one service page.
- **2a** a dialog's confirm step shows the blockers already known to the screen (the draft view's/parent's blockers the page already has) **before** the step-up code is asked, and disables the confirm button while any remain; the server's 409 blockers keep working. If the dialogs can't know the blockers without an API change, stop that item and report.
- **2b** note ledger draft row: the 44 px inline link keeps its target size without opening a wide gap between the row's lines (e.g. a negative block margin, as A3 did in the final sweep).
- **3a** one shared helper in `lib/step-up.ts` (e.g. `isWrongCode(e)`) used in every copy listed above; the invoice issue dialog sends a wrong code to its code field (cleared, `WRONG_CODE` under it, `aria-invalid`, focused), as the note and advance dialogs do; extend the rt2 e2e (`apps/admin/e2e/signature-udyam.spec.ts` "dialogs: a focused code field…") to enter a wrong code in the issue dialog too. In `routes/payments/parts.tsx` change only that one check (the PC builds M6.2 next to it).
- **3b** `Field`'s effect re-runs for every new error, even the same text twice (e.g. a counter or the error object as the key); no scroll on a mere re-render.
- **3c** a "No change" answer takes the form back from the saved values (or the dirty check compares trimmed values the way the server does), so the bar goes away.
- **4** bell: the name matches what is shown: "Notifications, 9+ unread" over 9 (07-ZL 3, through `ZL()`), the exact count up to 9; axe 0 on the shell with 10+ unread.
- **5b** `Modal`: the dialog title stays in view while a long body scrolls (sticky head inside the dialog's own scroll box, both themes, 390 and 1280), checked on the Erase or anonymise dialog with a long contact name and two other dialogs (note dialog, Log time).
- Files: `apps/admin/src/{components,routes}/**`, `apps/admin/src/lib/step-up.ts`, admin CSS, `apps/web/src/styles/**` and web components, admin e2e specs. **Do not touch** `apps/admin/worker/**`, `apps/admin/src/lib/{audit,dashboard,offers,copy-zl}.ts` (builder), the `.segmented` rule in `apps/admin/src/shell.css` (#140), the project page's deed panel and the invoice payments panel (the PC's T11 and M6.2).
- Screenshots before and after for each item, light and dark, 1280 and 390, in `.logs/shots/polish-d1/` of the worktree; axe on each changed screen; no sideways scroll. Local data: `pnpm dev:secrets && pnpm db:migrate:local && pnpm db:seed:local && pnpm portal:sample` in the worktree (and `E2E_SAMPLE=1` sample data as in [final-sweep](final-sweep.md) when you need invoices and notes). The MCP browser may not reach `/opt/pw-browsers`; `@playwright/test` with Chromium works (cloud-check). Stop every dev server before you report.
- Run: admin and web unit tests you touched, `pnpm --filter @techaust/admin typecheck`, the admin e2e specs you changed through `tools/heavy.sh`; whole-repo lint once at the end.

**Both agents:** commit at least every 20 minutes and at each finished item; push only your own sub-branch; append your report to this run file under "Builder report" / "Designer report" (files, commands and results, not verified, questions, the skills loaded). No migrations, no hosted services, no new packages. A new user-facing line you need is a question: report it, don't invent it.

**Done:** every item above fixed (or reported as blocked with the reason), tests for each logic change, before/after shots, axe 0, then the reviewer (code + visual), fixes, re-check if any critical or high finding, `pnpm check` and `pnpm test` green.

## Questions for the owner
- **For the main session (staff-only copy, owner's delegation):** approve [07-ZL](../07-content-appendix/ZL-polish-sweep.md) lines 1–3 (recommended: as written). Until then the lines show "[Placeholder]".

## Lead decisions (for 13)
- 2026-11-01, Lead: item 6 (`zod/mini` on the form pages) is dropped from the polish sweep: it needs the shared form schemas rewritten (the task's condition). Applied: this run file.
- 2026-11-01, Lead: the first usage reading (USAGE 17 at 2026-11-01T02:40+05:30) carries a time ~27 minutes after the session's clock (02:13 IST); `agent-slots.mjs` accepted it; noted, not corrected.

## Follow-ups (for 12)
- M2.5's `zod/mini` on `/contact` and `/get-a-quote` (~20 KB gzipped): still needs the shared schemas `packages/core/src/schemas/{fields,forms}.ts` rewritten in the mini API (web and jobs Workers); not done here (no shared-schema change in this task).
