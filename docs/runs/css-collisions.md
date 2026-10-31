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

## Designer report
Branch `fix/css-collisions-design` (from `origin/fix/css-collisions`). Commits: `cfe1fb62` (the fix and the guard), `96c6e91d` (the 3B table width after the rename), and this report. Opus 5.5, high.

**Skills loaded:** `frontend-design:frontend-design` (first step). It set the rule for this run: no new look, one owner per component, and the shared switch's own design (the chosen half filled edge to edge with `--color-selection`, weight 600) is the only switch. That is also why the GST page's old inverse span had to go, not be restyled. `dataviz`: not loaded, because there are no charts or stat tiles here. No other docs/14 §9 row fits a CSS-only task.

**Cause, confirmed:** I reproduced the owner's screenshot (`before/01-gst-quarter-dark-1280.png`: a light block that doesn't fill its half). The leak is real too. After Reports, the milestone list took the report table's smaller text (`before/07-project-milestones-*` against `before-clean/07-*`), and the switches on Clients › New, Invoices › New and Settings › Gateways shrank to the old inline copy (`before/05`, `06`, `09`). **I also found that the Reports page itself loads eight other route stylesheets** (leads, clients, projects, catalogue, documents, invoices and payments css, through shared imports). So the report tables were also getting projects' `.ledger` rules, and the GST files list was getting projects' `.file-list { margin: 0 }`.

**What changed**
- **Switch:** both `.segmented` blocks are gone from `reports.css`. The GST markup drops its inner `<span>`, so it matches the other ten screens. Phone width comes from a scoped `.period-picker .segmented` in the existing `max-width: 479px` block. The chosen state is fill plus weight 600 (500 → 600), visible in both themes (`after/01`, `02`). Disabled now uses the shared muted and surface-alt look instead of opacity 0.7.
- **Report tables** are now `.rledger`, `.rledger--plain`, `.rledger--3b`, `.rledger__total/__group/__sub/__held/__held-label`, `.rledger-scroll` and `.rledger-check(--bad)`. That covers `reports.css`, `routes/reports/{gst,manual-entries,payments,sales-register}.tsx` and the e2e locator in `apps/admin/e2e/rt1-screens.spec.ts:340`. My first pass missed the second class in the compound `.rledger.ledger--3b`, so the 3B row names lost their width. The screenshot diff caught it and `96c6e91d` fixes it.
- **The GST files list** is `.report-files*`.
- **Settings › Terms versions** use `.terms-versions`, `__item`, `__title` and `__meta` (`screens.css`, `routes/settings/terms.tsx`). The proposal's versions panel kept its names. It had been borrowing `display: grid; gap: space-4` from Settings' `.versions` (screens.css is always loaded), so `documents.css` now owns that rule.
- **`.tnum`:** one copy in `app.css` (`tabular-nums`). Reports and the statement keep `lining-nums` and `nowrap` only in their own scope (`.amount, .report .tnum, .statement .tnum`), so projects wrap again.
- **`.md`:** one copy in `shell.css`, projects' fuller version with the note headings. Both old copies are deleted.
- **Portal `.back`:** the two copies were not identical. `portal.css` replaced the margins. So the shared look stays in `app.css`, and each context sets its own margins: `.card__top .back` (inline-end −space-2, as before) and `.docpage .back` (the same shorthand `portal.css` had).
- **Guard:** `scripts/css-collisions.mjs` (+ `.d.mts`) scans every `.css` under `apps/<app>/src`. A base rule is a single compound selector, also inside `@media` and `@supports`. Its key is its set of classes, ignoring what is inside `:has()`, `:not()`, `:is()` and attribute selectors. The same key in two files of one app fails, unless `scripts/css-collisions-allow.json` lists it with a reason. That list is `[]` today, and a stale entry fails too. The script runs a self-test first: it must catch the `.segmented` case and pass `.dialog .radios` and `.period-picker .segmented`. Before the fix, the scan found exactly the brief's 8 clashes; now it finds none. It is wired into `pnpm check` (root `package.json`) and, as one extra step, into CI (`.github/workflows/ci.yml`, "Stylesheet clash guard"). CI runs these guards as separate steps, so `pnpm check` alone wouldn't have reached CI. Node test: `apps/web/test/css-collisions.test.ts`, 7 tests.

**Files changed:** `.github/workflows/ci.yml`, `package.json`, `scripts/css-collisions.mjs`, `scripts/css-collisions.d.mts`, `scripts/css-collisions-allow.json`, `apps/web/test/css-collisions.test.ts`, `apps/admin/src/{app,shell,reports,projects,catalogue,screens,documents}.css`, `apps/admin/src/routes/reports/{gst,manual-entries,payments,sales-register}.tsx`, `apps/admin/src/routes/settings/terms.tsx`, `apps/admin/e2e/rt1-screens.spec.ts`, `apps/portal/src/{app,portal}.css`.

**Visible differences on a component's own screen (please check):**
1. **GST › Files:** the list now keeps the 20 px bottom margin that `reports.css` always declared. Projects' `.file-list` had been zeroing it on the Reports page, so the "Researched default" note sat flush under the last row. I kept the designed gap. If the old flush look is wanted, `.report-files { margin: 0 }` is a one-line change. This makes GST pages 17 px taller. All other report pixels are identical (sales register 0 px different; GST tables identical).
2. **Settings › Terms:** the terms text now gets the shared `.md` rules on every visit (list indent `space-6` instead of the browser's 40 px, `space-2` between blocks), the same as the same text on a proposal. Before, it got them only if a Projects, Catalogue or proposal screen had been opened first.
3. **A proposal's versions list with two or more versions** no longer draws the bottom hairline that leaked from Settings' list. The design in `documents.css` is the left rule. The sample proposal has one version, so the screenshots can't show this.

**Screenshots** (in `D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform\.claude\worktrees\agent-a7633676adc00747b\.logs\css-collisions\`, every name in light and dark at 1280 and 390, e.g. `01-gst-quarter-dark-1280.png`). Four folders:
- `before/`: the old code, Reports first, then each screen by in-app navigation (the leak).
- `before-clean/`: the old code, each screen by a fresh load (each component's own look).
- `after/`: the new code, the same route as `before/`.
- `after-clean/`: the new code, fresh loads.

Screens:
- `01-gst-quarter`: the switch.
- `02-gst-month-focus`: Month chosen, keyboard focus ring.
- `03-gst-result`: a made report with the tables and files.
- `04-sales-register`: the renamed table.
- `05-clients-new`, `06-invoices-new` (the dialog), `07-project-milestones`, `08-project-files`, `09-settings-gateways`, `10-settings-terms`, `10b-terms-versions-dialog`, `11-proposal-versions`, `12-client-statement`.
- `cmp-*.png`: side-by-side bands I used to check the differences.

**Pixel comparison** (`diff.mjs`):
- `after` against `before-clean`: 0 px different for milestones, gateways, proposal versions and the sales register. So after a Reports visit these screens now look exactly as they do on their own.
- `after` against `after-clean`: identical apart from three kinds of band:
  - "N minutes ago" text on project files and the terms dialog;
  - the date fields (the clock passed midnight between runs);
  - one band on the 390 px New invoice dialog's search field, where I checked the computed border, outline and shadow and they are identical on both paths (interaction state).

**axe** (WCAG 2.0, 2.1 and 2.2 A/AA tags) on Reports › GST exports and Clients › New client (a switch screen), light and dark, 1280 and 390: **0 violations** in all 8 runs, before and after. Console errors: 0. Keyboard: Tab reaches the switch, arrow keys move the choice, and the focus ring shows inside the chosen half (`after/02-*`).

**Commands and results**
- `pnpm install --frozen-lockfile --offline`: ok.
- Local data: `pnpm dev:secrets && pnpm db:migrate:local && pnpm db:seed:local && pnpm portal:sample`, then the admin e2e global setup with `E2E_SAMPLE=1` and two sample files plus one proposal draft over the local API. All local and labelled sample.
- `node scripts/css-collisions.mjs`: ok (22 stylesheets in 4 apps).
- `bash tools/heavy.sh --log css-admin-test pnpm --filter @techaust/admin test`: 126 files, 3,809 tests passed.
- `bash tools/heavy.sh --log css-portal-test pnpm --filter @techaust/portal test`: 678 passed, 1 timeout (`worker/scope.test.ts` "the spy sees the schema's client_id tables", 5 s limit, a Worker test with no CSS involved). Re-run alone (`css-portal-scope`): 42 of 42 passed.
- `bash tools/heavy.sh --log css-web-node-test pnpm --filter @techaust/web exec vitest run --project node`: 37 files, 707 passed, 17 skipped.
- `bash tools/heavy.sh --log css-admin-build pnpm --filter @techaust/admin build`: ok. Front 100,839 bytes, API 438,052, finance 507,872.
- `bash tools/heavy.sh --log css-portal-build pnpm --filter @techaust/portal build`: ok, 104,589 bytes.
- `bash tools/heavy.sh --log css-check pnpm check` (the one whole-repo lint): ok, every guard including "css collisions: ok".
- `pnpm exec biome check` on the changed files: ok.

**Not verified**
- **Portal `.back`:** I took no screenshots, because the portal needs a client sign-in. By construction the document page's computed margins are unchanged: before, `portal.css`'s `margin` shorthand replaced `app.css`'s inline-end margin; now `.docpage .back` sets the same shorthand. The card's `back` prop has no callers today.
- **The admin e2e suite:** not run (about 15 minutes); only its one locator changed.
- **Production CSS order:** not checked in a built SPA. The fix no longer depends on stylesheet order.

**Placeholder text:** none. No copy changed.

**Open questions:** visible difference 1 (keep the GST files list's designed 20 px gap, or restore the old flush look). Dev server stopped; browser closed.

## Review
### Review (reviewer, 2026-11-01, `fe26c746` vs `origin/main`): **APPROVE**, 0 critical, 0 high, 1 medium, 4 low
Copied in by the lead (the reviewer can't commit). Skills: `code-review` (recipe; 9 candidate points, 4 kept), `frontend-design:frontend-design`; `security-review` not needed (CSS, a Node guard, one CI step).

1. **Medium** (`apps/admin/src/shell.css:895-899`, unchanged here, now draws GST too): the shared switch's chosen state is weak: fill vs unchosen 1.15:1 light, 1.85:1 dark; the only other cue is weight 500 → 600 at 14 px (not a strict AA failure: a non-colour cue exists and text contrast passes, 13.19:1 / 8.21:1). While busy (`disabled`) the fill disappears because `:has(input:disabled)` comes after `:has(input:checked)`. Fix: a mark ≥ 3:1 against the unchosen half in the shared rule (e.g. an inset 2 px bar in `--color-text`); changes every switch, so the owner decides.
2. **Low** (`apps/web/test/css-collisions.test.ts:96`): the repo scan calls `checkApps(apps)` without `scripts/css-collisions-allow.json`; the first real allow-list entry would fail `pnpm test` while the CLI passes. Read and pass the JSON.
3. **Low** (`scripts/css-collisions.mjs:121-128`): two limits — a rule in a second file that only styles inside another file's component (`.segmented__opt span` alone) isn't caught; `.x.y` and `.x` get different keys. Stricter versions flag 17 descendant and 5 compound rules that the brief lists as intentional, so the narrow definition is right; state both limits in the script header.
4. **Low** (`scripts/css-collisions.mjs:246`): the "run as script" check compares `fileURLToPath(import.meta.url) === process.argv[1]`, which silently does nothing on a junctioned path or drive-letter case; use `pathToFileURL(resolve(process.argv[1])).href === import.meta.url` like `check-worker-config.mjs`.
5. **Low** (`apps/admin/src/routes/reports/{gst,payments,sales-register,manual-entries}.tsx`): `rledger--plain` (was `ledger--plain`) has no CSS anywhere; drop the dead modifier.

Checked and dismissed: `.report .tnum` specificity (no conflicting `white-space`), `packages/ui` not scanned (no class rules), preview stylesheets scanned (harmless), `selfTest` duplication and a shadowed name (style).

**Requirements and visual review:** the GST switch uses the shared rules (grid, 44 px halves, full width at 390: two 178 px halves); keyboard (Tab, ArrowRight picks Month, focus ring inside the chosen half); same as Clients › New and Settings › Gateways in both themes. Renames complete (grep across TSX, CSS, e2e). The guard on main's CSS reports `file-list`, `ledger`, `segmented`, `segmented__opt`, `tnum`; on the branch it passes (22 stylesheets). CI step plain `node`, no secrets or new actions, fork-safe. Portal `.back` margins unchanged by construction. The designer's three visible differences are intended. Leak path checked by computed styles after Reports (Clients › New, Milestones, Files, Gateways, Terms and its dialog, New invoice, proposal versions, statement); GST in both themes at 1280, Month + focus, busy and a result at 390; axe 0 on GST (light 1280) and Clients › New (light 390). Ran: the guard (ok), its test (7/7). Screenshots: `.logs/css-collisions/review/` (main checkout).

## Fix round 1 (lead, 2026-11-01)
**Owner's decision (2026-11-01):** the chosen half of every switch gets a clear mark: keep its fill, add a **2 px ink bar along its bottom edge** (`--color-text`, inset so the control's size doesn't change), at least 3:1 against the unchosen half, in both themes **and while busy/disabled** (the chosen half keeps its mark and fill when the control is disabled; the rule order in `shell.css` fixed so `:checked` wins over `:disabled`). It applies to every `.segmented` and the theme picker (`.theme-pick__opt`), which share the rule.

**Designer, in one round:** finding 1 as the owner decided; findings 2, 3 (header comment), 4 and 5. Screenshots before/after of the GST switch (Quarter chosen, Month chosen, busy), Clients › New and the theme picker, light and dark, 1280 and 390, in `.logs/css-collisions/fix1/`; measure and report the bar's contrast against the unchosen half in both themes; axe on GST and one other switch screen. Then `pnpm check` and the admin tests through `bash tools/heavy.sh`. Your own branch from `origin/fix/css-collisions` (e.g. `fix/css-collisions-fix1`); append "Designer report (fix round 1)" below.
