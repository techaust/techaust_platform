# Run: style-name clashes in the admin and portal stylesheets

Status: open
Tier: C
Usage:

## Brief
**Owner's report (2026-10-31, screenshot):** on Reports › GST exports, the Quarter / Month switch draws the chosen option as a light block that doesn't fill its half (dark strips on both sides of "Quarter"). The owner asked for the cause and every other place with the same problem.

**Cause (lead):** two stylesheets define the same class names. `apps/admin/src/shell.css:854–911` (the shared switch: the label is padded, the chosen label is filled with `--color-selection`) and `apps/admin/src/reports.css:129–180` plus its mobile block at `:718–731` (an older copy: the inner `span` is padded and painted `--color-text` on `--color-bg`). On the GST page both apply, so the painted span sits inside the label's padding. Route stylesheets are imported by route modules (`routes/*/parts.tsx`, `routes/clients/statement.tsx` imports `reports.css`) and stay loaded for the rest of the SPA session, so after visiting Reports or a client's statement the old copy also reaches every other `.segmented` (clients new/overview/data tools, invoices new/notes/types, leads convert, project milestones and notes, settings gateways).

**Scan (lead, every `.css` under `apps/*/src` and `packages/ui/src`; class rules starting in more than one file).** Real clashes:
| Class | Files | Effect |
|---|---|---|
| `.segmented`, `.segmented__opt` | `shell.css`, `reports.css` | the owner's report, and leaks to ~10 screens |
| `.ledger` (+ `th`, `td`, `.num`, …) | `projects.css:279` (the milestone `<ol>`, draggable), `reports.css:449` (report tables) | two different components under one name; after Reports, the milestone list takes the table's width and smaller text |
| `.file-list` | `projects.css:935` (project files), `reports.css:635` (GST files) | different margins and row borders leak both ways |
| `.versions__item` | `documents.css:1177` (proposal versions, `routes/documents/side.tsx:370`), `screens.css:384` (Settings › Terms, `routes/settings/terms.tsx:268`) | each list takes the other's borders and spacing |
| `.tnum` | `projects.css:1`, `reports.css:608` | `white-space: nowrap` and lining figures leak to projects |
| `.md` | `catalogue.css:18–54`, `projects.css:748–814` | the same rules twice (projects adds headings); drift risk |
| portal `.back` | `apps/portal/src/app.css:218`, `portal.css:908` | the same rule twice; drift risk |

Not clashes (intentional local adjustments, leave them): `.hint`, `.radios`, `.btn--text`, `.dialog`, `.dialog__body`, `.filters`, `.dash`, `.dcards`, `.facts`, `.inv-sheet`, `.notes-panel`, `.settings-form__body`, `.topbar__mark`, `.form-section`, `.lut-list`, `.logo-tile__art`, `.field-warning`. `apps/web` has none.

**What to do (designer; load `frontend-design:frontend-design` first):**
1. **One switch.** Keep the shared `.segmented` in `shell.css` (its look is used on ~10 screens: the chosen half filled edge to edge with `--color-selection`, weight 600). Delete the copy in `reports.css` (both blocks). Make the GST page's markup (`routes/reports/gst.tsx:116–131`) work with the shared rules (the inner `span` gets no padding or paint of its own); keep its mobile full width through a scoped rule (`.period-picker .segmented`) if needed. The chosen state must not rely on colour alone (the shared rule's weight change, check it is visible in both themes; WCAG 2.2 AA, `--color-selection` contrast against the text).
2. **Own names** for the second component of each pair: the report tables (`reports.css` `.ledger*` → e.g. `.rledger*`, every TSX use under `routes/reports/`, `routes/clients/statement.tsx` and anywhere else `grep` finds), the GST files list (`.file-list` in `reports.css` and `routes/reports/gst.tsx:351` → e.g. `.report-files`), Settings › Terms versions (`screens.css` `.versions__item` and `routes/settings/terms.tsx` → e.g. `.terms-versions__item`). Keep the names that the older, wider component uses (projects' `.ledger`, `.file-list`; documents' `.versions__item`) unchanged.
3. **One copy** of `.tnum` (in `app.css`; decide whether lining figures and nowrap belong in the shared rule or in a report-scoped one, so projects keep wrapping), of `.md` (move to `app.css` or `shell.css` with projects' heading rules, delete both copies), and of the portal's `.back` (keep `app.css`, delete `portal.css`'s, or the reverse if `portal.css` is the global one: check the imports).
4. **A guard so it can't come back:** `scripts/css-collisions.mjs`, run by `pnpm check` (root `package.json`), that fails when the same class is the **subject of a base rule** (a selector that is exactly `.x`, optionally with pseudo-classes, attributes or a compound modifier on the same element, and not inside a parent selector from another class) in two stylesheets of the same app. An allow-list `scripts/css-collisions-allow.json` with a reason per entry for genuine shared adjustments, if any are needed. A Node test or a self-test fixture proving it catches the `.segmented` case and passes on a scoped rule like `.dialog .radios`.
5. **Screenshots** (both themes, 1280 and 390 wide), before and after, saved under `.logs/css-collisions/` and listed in your report: Reports › GST exports (the switch, Month chosen too); the route **Reports first, then** Clients › New client, Invoices › New invoice, a project's Milestones and Files, Settings › Payment gateways and Settings › Terms; a proposal's version list. Use the admin e2e sample data (`E2E_SAMPLE=1`, `apps/admin/e2e/sample-data.ts`) or the local seed. Run axe on the GST page and one other switch screen (0 violations).

**Done means:** no clash left by the guard's own scan; the switch identical on every screen including GST; the renamed components look exactly as before on their own screens; `pnpm check`, admin and portal tests and builds green through `bash tools/heavy.sh`; screenshots and axe results in the report.

**Out of scope:** any copy change; the other style findings in 12 (week grid wrap, focus outline width); changing the switch's look beyond making GST match the shared one.

**Rules:** your own branch from `origin/fix/css-collisions` (e.g. `fix/css-collisions-design`), push only that; commit at each finished step and at least every 20 minutes; heavy commands through `bash tools/heavy.sh --log <name> <command>`; stop every dev server you started before reporting; `TECHAUST_PORT_OFFSET=0`. Append your report below as "Designer report".
