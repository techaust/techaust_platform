Status: open
Tier: B (tooling: hooks, scripts, dev ports, MCP config)
Usage:

# CLOUD-1: set the project up for Claude Code cloud sessions

The owner asked for it on 2026-10-29 and approved this plan the same day. Facts come from the Claude Code docs (code.claude.com/docs: claude-code-on-the-web, cloud-environments, settings, model-config, mcp, sub-agents), read on 2026-10-29.

**What a cloud session is:**
- an Ubuntu 24.04 VM (about 4 vCPU, 16 GB RAM, 30 GB disk) with Node 20, 21 and 22 (22 on PATH), npm, pnpm and chromedriver;
- it loads the repo's `.claude/settings.json` (hooks, `env`, `effortLevel`), `.claude/agents/`, `.claude/skills/` and `.mcp.json` in single-repo sessions;
- **it does not load `enabledPlugins`**, so there is no Playwright, GitHub or Cloudflare plugin;
- `CLAUDE_CODE_REMOTE=true` is set there and never locally;
- the GitHub proxy blocks GraphQL (`gh pr …` gets 403; REST `gh api` works);
- the network is the Trusted list by default (npm, GitHub, nodejs.org, …), which doesn't include `api.cloudflare.com`, `*.workers.dev` or Playwright's browser CDN.

**Owner's answers (2026-10-29, docs/13):**
- commit a Playwright MCP server in `.mcp.json` for the cloud browser;
- build separate dev ports now;
- the model lock in the cloud is the project's settings plus the guard hook only (no admin setting);
- a cloud session opens its PR through REST, and the local lead turns on auto-merge and Auto-fix.

**Base:** `origin/chore/agent-slots` (PR #111, holding `tools/agent-slots.mjs`). Once #111 merges, this branch merges `main`.

## Brief (lead, 2026-10-29)

### Builder (Opus 5.5 high)
1. **`scripts/cloud-setup.sh`**, the environment setup script. The owner pastes it into the claude.ai environment; it is committed for reference and review. It runs as root, before Claude starts, and must exit 0 within about 5 minutes.
   - Install Node **24** from nodejs.org (pin the exact version `.nvmrc` or `engines` implies; check what the repo uses) and put it first on PATH for later sessions (e.g. `/usr/local/bin` symlinks).
   - `corepack enable` and prepare **pnpm 12.9.1** (`packageManager`).
   - Install the Chromium the Playwright MCP server and `@playwright/test` need, with its system libraries: `npx playwright@<the pinned version> install --with-deps chromium`. Use the version the repo already pins (1.64.1).
   - Use `|| true` only on non-critical steps, and print a short summary.
2. **SessionStart hook** in `.claude/settings.json` (`matcher: "startup|resume"`), running `bash "$CLAUDE_PROJECT_DIR"/scripts/cloud-session-start.sh`. The script **exits at once unless `CLAUDE_CODE_REMOTE` is `true`**, so it never changes this PC. Then it:
   - puts Node 24 first on PATH if the setup script installed it;
   - runs `pnpm install --frozen-lockfile`, skipped while a sha256 of `pnpm-lock.yaml`, every `package.json` and this script is unchanged (the docs' pattern);
   - runs `pnpm dev:secrets` when `.dev.vars` are missing (local random values only);
   - runs `pnpm db:migrate:local` and `pnpm db:seed:local`;
   - runs `wrangler types` (the apps' `types` scripts), if needed by typecheck;
   - finishes within the 600 s hook timeout (set `timeout` if needed), or runs the slow parts with `async: true`, and prints one summary line.
3. **`.mcp.json`:** the official Playwright MCP server (`@playwright/mcp`, an exact version at least a day old per `minimumReleaseAge`), headless, with an isolated profile and Chromium.
   - Locally, the plugin already provides Playwright, so a second server must not start here. Find the documented way to keep a project `.mcp.json` server off on this PC (e.g. `disabledMcpjsonServers` in a git-ignored `.claude/settings.local.json`, or `enabledMcpjsonServers` scoping), apply it, and document it. Make sure this PC's agents keep working exactly as now.
   - **The owner approved this MCP server (rule 11).**
4. **`tools/heavy.sh` on Linux:**
   - free memory from `/proc/meminfo` (`MemAvailable`) when `powershell.exe` isn't there;
   - the PID-alive checks work on Linux too;
   - keep the Windows path unchanged, and extend `tools/heavy.selftest.sh` if practical.
5. **`tools/agent-slots.mjs`:** detect a cloud session by `CLAUDE_CODE_REMOTE === "true"` (any OS), keep `--cloud`, and test it.
6. **Separate dev ports:** one variable, `TECHAUST_PORT_OFFSET` (default 0), shifts every local port:
   - web 4321;
   - admin 5173 and portal 5174 (Vite);
   - jobs 8787;
   - the wrangler and workerd inspector ports;
   - each Playwright e2e config's `webServer` and `baseURL`;
   - any script that assumes these ports (`dev:worker`, e2e global setups).

   With offset 100, two browser agents (designer and reviewer) run side by side. Prove it: two sets of dev servers at offsets 0 and 100 at the same time, each answering, plus a test of the port helper. docs/14 §4 assigns offsets: the first browser agent 0, the second 100.
7. **`tools/cloud-pr.sh`:** opens a PR from the current branch through REST (`gh api repos/techaust/techaust_platform/pulls -f head=… -f base=main -f title=… -f body=…`), using `--body-file` content, and prints the PR URL. It never merges and never touches auto-merge.
8. **CLAUDE.md**, a short "In a cloud session" block:
   - no plugins (no Cloudflare, GitHub or Playwright plugin; the browser comes from `.mcp.json`);
   - never deploy or touch staging, hosted services or secrets;
   - read `docs/runs/usage-reading.md` (docs/14 §5);
   - open PRs with `tools/cloud-pr.sh`; the local lead turns on auto-merge and Auto-fix;
   - Opus 5.5 at high is set by the project's settings and the guard hook (owner, 2026-10-29: no admin lock);
   - browser agents use the port offsets.
9. **`docs/runbooks/cloud-sessions.md`:** the owner's click-by-click steps on claude.ai:
   - **create the "techaust_platform" environment (the owner named it on 2026-10-30):**
     - network **Custom**, with "include the default list" ticked plus the Playwright browser download hosts (find the exact hosts `playwright install` uses);
     - environment variables `CLAUDE_CODE_EFFORT_LEVEL=high`, `BASH_DEFAULT_TIMEOUT_MS=600000` and `BASH_MAX_TIMEOUT_MS=600000`;
     - no secrets;
     - paste `scripts/cloud-setup.sh`;
   - install the Claude GitHub App on `techaust/techaust_platform`;
   - start a cloud session and type "check cloud setup".
10. **`scripts/cloud-check.sh`**, what "check cloud setup" runs. It reports:
    - the Node and pnpm versions;
    - `CLAUDE_CODE_REMOTE`;
    - one quick test package (`pnpm --filter @techaust/core test`);
    - that the Playwright MCP server is listed;
    - Chromium launching headless;
    - `tools/agent-slots.mjs --cloud` output;
    - the free memory and load.

### Rules
- Keep every change inert on this PC unless it's an improvement there too (the heavy queue, the ports default to today's values).
- Install nothing on this PC beyond what the lockfile has. `@playwright/mcp` runs through `npx` in the cloud only, unless a pinned devDependency is cleaner; if so, say so and stop for the lead.
- Never touch hosted services. No workflow changes.
- Heavy commands go through `bash tools/heavy.sh --log <name> <command>`.
- Commit at least every 20 minutes. Work on `fix/cloud-1-b` from `origin/chore/cloud-sessions` and push only that.

### Done means
- `pnpm check` and the full `pnpm test` pass.
- The two-offset proof runs on this PC.
- The SessionStart hook is a no-op here (shown by running it locally).
- Report under "## Builder report" in this file:
  - the skills;
  - each item and its files;
  - the commands and their results;
  - what you didn't verify (anything only a real cloud session can show);
  - any open questions.

## Builder report (Opus 5.5 high, 2026-10-29, branch `fix/cloud-1-b` from `origin/chore/cloud-sessions` 55ed6e4d)

### Skills
- `cloudflare:wrangler`: had me read the installed wrangler 4.147.0 and `@cloudflare/vite-plugin` 1.62.5 code instead of memory: `--inspector-port`, the Vite plugin's `inspectorPort` option (first free port from 9229 when unset), and the dev registry paths (`WRANGLER_REGISTRY_PATH` for wrangler, `MINIFLARE_REGISTRY_PATH` for the Vite plugin), which shaped the per-offset registry.
- `cloudflare:workers-best-practices`: checked that nothing touches Worker code or bindings; only dev-time config (`vite.config.ts`, the launcher) changed, and `wrangler types` stays inside each `typecheck`.
- `update-config`: the SessionStart hook was merged into `.claude/settings.json` (existing hook and plugins kept) and run by hand before writing it; `disabledMcpjsonServers` was chosen from the settings schema to keep the project server off locally.
- Not loaded: `cloudflare:workers-profiling` (no CPU work), `cloudflare:web-perf` (no pages), `frontend-design` / `dataviz` (no screens), `code-review` / `security-review` (the reviewer's), `aws-*` (no AWS).
- Library docs: Context7 `/websites/code_claude` (cloud environments, setup scripts vs SessionStart hooks, `CLAUDE_ENV_FILE`, `CLAUDE_CODE_REMOTE`, `.mcp.json` approval and `disabledMcpjsonServers`, default allowed domains). Playwright facts were read from the published packages (`@playwright/mcp@0.0.83`, its `playwright-core@1.64.0-alpha-1790635538000`, `playwright-core@1.64.1`) unpacked in the scratchpad.

### Items and files
1. **Setup script:** `scripts/cloud-setup.sh`. Node **24.22.2** (the latest 24.x, which is what CI's `.nvmrc` "24" resolves to; inside `engines` >=24.19.0) from nodejs.org, **sha256-verified** against pinned x64/arm64 sums, unpacked to `/opt`, linked as `/opt/node24`, node/npm/npx/corepack linked into `/usr/local/bin`; `corepack enable pnpm` + `prepare pnpm@12.9.1`; then in parallel `npx playwright@1.64.1 install --with-deps chromium` and `npx @playwright/mcp@0.0.83 install-browser --no-shell chromium` into `/opt/ms-playwright`. Finding: the MCP server's Playwright build uses Chromium **revision 1247**, `@playwright/test` 1.64.1 uses **1248**, and MCP `--browser chromium` means channel `chrome-for-testing` (the registry's full `chromium`), so both installs are needed. Node and pnpm failures stop it (`die`); browser failures are reported and it carries on; a summary at the end; exit 0.
2. **SessionStart hook:** `.claude/settings.json` (`SessionStart`, matcher `startup|resume`, `bash "$CLAUDE_PROJECT_DIR/scripts/cloud-session-start.sh"`, timeout 600, synchronous) and `scripts/cloud-session-start.sh`: first line `[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0`; then Node 24 and `PLAYWRIGHT_BROWSERS_PATH` for itself and, through `CLAUDE_ENV_FILE`, for every later Bash command; `pnpm install --frozen-lockfile` skipped while the sha256 of `pnpm-lock.yaml`, every tracked `package.json` and the script is unchanged (stamp inside `node_modules/`); `pnpm dev:secrets`, `pnpm db:migrate:local`, `pnpm db:seed:local`; one summary line; full log `.logs/cloud-session-start.log`. `wrangler types` is not run: every package's `typecheck` runs it first.
3. **`.mcp.json`:** `playwright` = `npx -y @playwright/mcp@0.0.83 --headless --browser chromium --isolated --output-dir .playwright-mcp`, env `PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}` (0.0.83 published 2026-09-28). Kept off on this PC with the documented `disabledMcpjsonServers` ("never connects them or asks for approval"; it wins over every approval) in the **git-ignored** `.claude/settings.local.json` (`.gitignore` updated), written by the new `tools/mcp-local-off.mjs` (`--user` writes `~/.claude/settings.json` instead, covering every worktree; `--check` reports; it refuses in a cloud session). Per the docs, `claude -p`, SDK and cloud sessions load project servers **without asking**, so without this setting a desktop/SDK session here would start a second browser next to the plugin's.
4. **heavy.sh on Linux:** `tools/heavy.sh` `free_mb`: PowerShell when `powershell.exe` exists (this PC, unchanged), else `MemAvailable` from `/proc/meminfo` (`HEAVY_MEMINFO` names a stand-in file for the self-test). The PID checks were already `kill -0`, which works on Linux. `tools/heavy.selftest.sh` cases 12 (low and ample memory from a stand-in meminfo) and 13 (the real `/proc/meminfo`, Linux only).
5. **agent-slots:** `tools/agent-slots.mjs` `isCloudSession(env)` = `CLAUDE_CODE_REMOTE === "true"` on any OS (before: Linux and any value); `--cloud` kept. Tests in `apps/web/test/agent-slots.test.ts` (pure and command line).
6. **Dev ports:** `scripts/dev-ports.mjs` (+ `.d.mts`) and the launcher `scripts/dev.mjs` (runs the package's own bin with this Node, no shell; forwards signals; passes the exit code on). `TECHAUST_PORT_OFFSET` ∈ {0, 100 … 900} (anything else is an error) moves web 4321, web Worker 8787, web e2e 8799, admin 5173, portal 5174, jobs 8787; a non-zero offset also gets a dev registry of its own (`.wrangler/registry-<offset>`) and `--var` overrides for the local URLs the Workers carry (web `FORMS_ALLOWED_ORIGINS`; jobs `ADMIN_URL`, `PORTAL_URL`, `EMAIL_ASSET_BASE`); the portal's built-in website origin moves too (local only). Wired into: every app's `dev` script and web `dev:worker`; the three Playwright configs (`webServer` command and `baseURL`); `apps/admin/e2e/global-setup.ts`; the local links of `pnpm invite`, `pnpm admin:reset-2fa`, `pnpm portal:link`. **Inspector ports:** each Worker gets 9229 + slot + offset (admin 9229, portal 9230, jobs 9231, web Worker 9232, web e2e 9233) at **every** offset, set in `vite.config.ts` (dev server only) and by the launcher, falling back to the old automatic choice when the port is taken. Reason: the first proof run reproduced a race in today's behaviour (admin's Vite plugin and the jobs wrangler both took 9229; jobs crashed with `bind(): … os error 10013`); commit `62fe7333`. Test: `apps/web/test/dev-ports.test.ts` (offset 0 = the old ports and command lines, offset 100, no port shared by any two allowed offsets, the fallback, the apps wired to it).
7. **Cloud PR:** `tools/cloud-pr.sh --title … --body-file … [--head] [--base main] [--dry-run]`: checks the branch is pushed and at HEAD, prints an existing open PR for the same head instead of opening a second, else `gh api --method POST repos/techaust/techaust_platform/pulls … -F body=@file --jq .html_url`. No merge or auto-merge anywhere (a test greps the code lines).
8. **CLAUDE.md:** a short "In a cloud session" section (after Git workflow) with the six points, and the offset on the `pnpm dev` line.
9. **Runbook:** `docs/runbooks/cloud-sessions.md`: the GitHub App (the owner's action), the "techaust_platform" environment (Custom network with the default list plus `nodejs.org`, `cdn.playwright.dev`, `playwright.download.prss.microsoft.com`; the three variables; paste the setup script from GitHub's Raw view), "check cloud setup" and what a good answer looks like, a table for the lead, and the one local step after the merge (`node tools/mcp-local-off.mjs`).
10. **Check:** `scripts/cloud-check.sh`: the cloud flag, Node against `.nvmrc`, pnpm against `packageManager`, memory/processors/load (Linux), `agent-slots --cloud`, `pnpm --filter @techaust/core test` through the heavy queue, the `.mcp.json` server and `claude mcp list`, `@playwright/test` Chromium launching headless, and the MCP server's Chromium location (a dry run of its own installer). Exit 1 on any FAIL.
- Also: `docs/14-models-and-usage.md` §4 "Browser agents": the offsets are assigned (first 0, second 100); two browser agents in one cloud session stay "not yet proven" (question 2). `apps/web/test/cloud-setup.test.ts` pins the setup script to the repository (Node/.nvmrc/engines, pnpm, `@playwright/test` in every package, the `.mcp.json` version), checks the MCP entry, the hook entry and the hook's first line, runs the hook outside a cloud session, and dry-runs `cloud-pr.sh`.

### Commands and results
- `pnpm install --frozen-lockfile --offline`: ok (worktree links).
- `pnpm --filter @techaust/web exec vitest run --project node test/dev-ports.test.ts test/agent-slots.test.ts test/cloud-setup.test.ts`: **43 passed** (the bash cases ran, with Git Bash).
- `bash tools/heavy.selftest.sh`: **all passed** (the 11 old checks and the 2 new; the real-`/proc/meminfo` check is skipped off Linux).
- **Two-offset proof** (`node scripts/dev.mjs <app>` at offsets 0 and 100, at the same time):
  - offset 0, full set together: admin `:5173/api/v1/health` 200, portal `:5174` 200, jobs `:8787/healthz` 200, web `:4321` 200; free memory then **355 MB**, so all eight servers at once would have broken the 300/512 MB floors with a designer working on this PC;
  - admin + jobs at 0 and 100 together: `:5173` 200, `:5273` 200, `:8787` 200, `:8887` 200; inspectors 9229/9231 and 9329/9331; `.wrangler/registry-100` held admin, admin-api and jobs, and jobs-100's `ADMIN_JOBS` showed `[connected]` to its own set;
  - portal + web at 0 and 100 together: `:5174` 200, `:5274` 200, `:4321` 200, `:4421` 200; portal-0 found 9230 taken by another agent's Vite on this PC and fell back as designed;
  - every server I started was stopped (process trees killed; no workerd left).
- **Hook no-op on this PC:** the exact settings command with the Windows-form `CLAUDE_PROJECT_DIR`: exit 0, no output, 110 ms; with `CLAUDE_CODE_REMOTE` unset or `false`: env file 0 bytes, no log, working tree unchanged.
- **Hook cloud path simulated here** (`CLAUDE_CODE_REMOTE=true`, through the heavy queue, in my worktree): run 1 "done: install dev secrets local database seed" (14 s); run 2 "install (unchanged, skipped)" (7 s). (The summary now joins the steps with commas.)
- `node tools/mcp-local-off.mjs` / `--check` / under `CLAUDE_CODE_REMOTE=true`: writes, is idempotent, reports, refuses. `claude mcp list` in my worktree: with the setting, the project server is not listed and never spawned (a stand-in server that writes a marker file did not run); without it, "Pending approval"; with the real `.mcp.json` and the setting, only `plugin:playwright:playwright` shows.
- `bash scripts/cloud-check.sh` on this PC: all passed (cloud-only lines as info; Chromium 156.0.8078.4 launched headless).
- `bash tools/heavy.sh --log cloud1-test pnpm test`: every package passed except one **jobs** test that timed out at 5 s under load (`pdf-supplier.test.ts`, "an export invoice has a copy too…"; that run's setup took 351 s while the designer's tests ran), which stopped admin early. Reruns: `pnpm --filter @techaust/jobs test` **528 passed**, `pnpm --filter @techaust/admin test` **3372 passed**. Totals: auth 135, ui 469 (+2 skipped), core 1801, email 128, db 471, pdf 340, web 553 (+17 skipped, the build-dependent ones), portal 631, jobs 528, admin 3372.
- `bash tools/heavy.sh --log cloud1-check pnpm check`: **exit 0** (lint: 10 warnings, all in files this task didn't touch; typecheck clean; the four guards ok).

### Not verified (only a real cloud session can show it)
- The setup script end to end: run time under 5 minutes, corepack and the pnpm shim, the `--with-deps` apt install, both Chromium downloads through the allowed hosts, and whether `nodejs.org` is already in the default list (added to the Custom list to be safe).
- The session user (root or not), and so whether the setup script's npx and corepack caches are reused; the SessionStart hook in the cloud (`CLAUDE_ENV_FILE`, PATH order against the image's Node 22).
- The MCP server starting in the cloud and its tool names; Chromium launching there without a sandbox (read in the code: on Linux the `chrome-for-testing` channel turns the sandbox off).
- `tools/cloud-pr.sh` against the real REST proxy (only `--dry-run` and the argument checks ran here).
- The browser-test configs at offset 100 (`pnpm --filter … e2e` was not run at either offset: heavy, it needs a web build, and it would have competed with the designer's browser); the launcher-based `webServer` commands are covered by the unit tests and the dev-server proof only.

### Open questions (for the lead)
1. **The designer and reviewer agent files list only the plugin's browser tools** (`mcp__plugin_playwright_playwright__browser_*` in their `tools:` lines). In the cloud the browser's tools are `mcp__playwright__browser_*`, so those agents get **no browser there** until the same thirteen tools are added under the `mcp__playwright__` prefix (harmless here, where that server is off). Not changed: agent files are outside this brief.
2. **Two browser agents in one cloud session** most likely share the one `.mcp.json` server (one browser). If the first cloud check shows that, the options are a second server (`playwright-2`) that the second agent's brief names, or an `mcpServers` entry in each browser agent's frontmatter; docs/14 §4 keeps cloud sessions at one browser agent until then.
3. **Applying the local switch:** after the merge, run `node tools/mcp-local-off.mjs` in the main checkout, or `--user` once for the whole PC (covers worktrees too). The lead's choice; I applied it only in my own worktree.
4. **Inspector ports at offset 0** are now named (9229–9233) instead of "first free from 9229", with the old behaviour as the fallback when a port is taken: a small change on this PC, made because the old behaviour crashed the jobs Worker when it started together with the admin (reproduced). Confirm, or ask me to keep offset 0 fully automatic.
5. Not shifted: the Lighthouse run's port 8798 (`apps/web/lighthouserc.json`): it runs only through the heavy queue, one at a time per machine.

## Lead, after the builder (2026-10-29)
- Merged `fix/cloud-1-b` (2c895fed) into `chore/cloud-sessions`, then `main` (#111 squash; `git diff --quiet 275bdb32 origin/main` held, so this branch's side was kept).
- **Accepted the inspector-port deviation** (one port per Worker even at offset 0): it fixes the reproduced 9229 clash that killed the jobs Worker. docs/13 row.
- **Agent files:** added the 13 `mcp__playwright__browser_*` tools (the `.mcp.json` server's names) to `designer.md` and `reviewer.md` beside the plugin's, as the builder found. Agent files load only in new conversations; harmless here, where that server is off.
- **This PC:** done **before the merge** (the triage below): the main checkout's `.claude/settings.local.json` holds `disabledMcpjsonServers: ["playwright"]` (the lead's sessions start there; subagents share the parent's MCP connections). After the merge, `node tools/mcp-local-off.mjs --check` in the main checkout confirms it.
- The flaky first `pnpm test` (a jobs test timed out while another agent's tests ran) passed alone; the review re-runs the full suite with the queue free.
- Next: the analyst's early check (Tier B), then the review.

## Early check (analyst claude-opus-5-5/high, 2026-10-29, on 377fefb8): CHANGE
_(Summary by the lead; the full text is in the conversation record.)_ Sound: the hook is a no-op here (the exact settings command through `bash -c` with the spaced Windows path, `CLAUDE_CODE_REMOTE` unset and `false`: exit 0, no output); offset 0 reproduces today's command lines; the inspector-port change is sound; pins exact, Node 24.22.2 checksums match nodejs.org; the two Chromium installs don't delete each other (Playwright's dir lock); `cloud-pr.sh` never merges; no secrets or personal data; the guard is not weakened.
- **H1:** in a cloud session nothing enforces "never merge, never deploy": REST `gh api` can merge (held PRs too), enable auto-merge, force-push, delete branches and dispatch workflows (`publish-catalogue` deploys staging, `backup` touches hosted data). Fix: a cloud-only block in `tools/model-guard.mjs`'s Bash branch, behind `CLAUDE_CODE_REMOTE === "true"` (no new process here).
- **M1:** nothing sets or checks the main conversation's model in the cloud (`availableModels` without managed `enforceAvailableModels` doesn't). Runbook: pick Opus 5.5 in the menu; the SessionStart hook flags another model from its stdin `model` field; reword CLAUDE.md.
- **M2:** after the merge, a new session here would start the `.mcp.json` server before `mcp-local-off` ran.
- **M3:** two browser agents can't share one stdio server (one browser, one tab; cookies ignore ports): state it in docs/14 §4 and docs/13.
- **Lows:** L1 hash `pnpm-workspace.yaml` too; L2 `ls-remote` by exact ref; L3 install `xz-utils` if missing; L4 `WRANGLER_SEND_METRICS=false`; L5 a clearer hook status message; L6 runbook labels, `nodejs.org` already default, the org switch; L7 one worktree per browser agent (own local D1); L8 test the settings command via `bash -c` with a spaced `CLAUDE_PROJECT_DIR`, and `mcp-local-off` refusing in the cloud; L9 optional `pnpm fetch` speed-up.

## Lead's triage after the early check (2026-10-29)
- **M2 done by the lead before the merge:** the main checkout's `.claude/settings.local.json` holds `disabledMcpjsonServers: ["playwright"]` (project scope only, narrower than `--user`; subagents share the parent's connections, and the lead never starts Claude in side worktrees), with `.claude/settings.local.json` in `.git/info/exclude` until this branch's `.gitignore` lands. Checked with `coversServers`: off. The runbook and the run file's "This PC" note say "before the merge".
- **Builder fix round** (`fix/cloud-1-r1`): H1, M1, M3, L1–L8. L9 is kept as an idea for after the first cloud check (unverified; a fresh clone per session makes it uncertain).
- **For the owner later (no workflow changes in this task):** an actor check in `publish-catalogue.yml` and `backup.yml` like `deploy-prod.yml`'s.

### Lead: the owner-only workflow check (owner's yes, 2026-10-29)
`publish-catalogue.yml` and `backup.yml` now start with "Who started this run": a run by hand or any re-run needs `techaust` as both actor and triggering actor; a scheduled first attempt passes (so the 30-minute publish is unchanged). The case logic was run in bash against six cases (schedule first try, schedule re-run by the owner and by a bot, dispatch by the owner, by a bot, re-run by another account): pass, pass, refused, pass, refused, refused. `apps/web/test/workflow-actor.test.ts` pins it (4 tests; removing the step from backup.yml fails 2). Not verifiable until merged: a real run by hand on GitHub.

### Fix round 1 report (builder, Opus 5.5 high, 2026-10-29/30, branch `fix/cloud-1-r1` from `origin/chore/cloud-sessions` b304a046)

**Skills:**
- `update-config`: the settings change (L5) was a merge into the existing SessionStart entry, checked by reading the file back with node; the guard's hook output (PreToolUse `permissionDecision: "deny"` with a reason) and the SessionStart input (`model` is optional; plain stdout reaches Claude as context) were checked against code.claude.com/docs (hooks) through Context7 `/websites/code_claude`.
- `cloudflare:wrangler`: the refused wrangler commands were taken from the repo's own scripts (`deploy:staging` in admin, portal, jobs and web; `db:migrate:local` / `db:seed:local` use `--local --persist-to`), so the guard refuses deploys and `--remote` while every local command the project runs still passes.
- Not loaded: `cloudflare:workers-best-practices` (no Worker code changed), `code-review` / `security-review` (the reviewer's), `frontend-design` / `dataviz` (no screens), `aws-*` (no AWS).
- Docs read (Context7, code.claude.com/docs): hooks (SessionStart input, PreToolUse decisions), cloud-environments (the dialog's "Also include default list of common package managers"), errors and managed-settings (cloud sessions are an Owner switch in Claude Code admin settings, claude.ai/admin-settings/claude-code).

**Items, files and commits:**
- **H1, cloud-only command guard** (b0d64f0a): `tools/model-guard.mjs` (Bash branch: only when `process.env.CLAUDE_CODE_REMOTE === "true"` it loads `tools/cloud-guard.mjs` with a dynamic import and answers `deny` with a plain reason; header comment updated), `tools/cloud-guard.mjs` (new: the patterns), `apps/web/test/model-guard.test.ts`. The patterns live in their own file so 90-odd cases can be tested without a process each; on this PC that file is never even read and the hook's local path is the old one (the effort note), so nothing new runs and nothing is refused here.
  - Refused: `gh pr merge|ready`, `gh workflow run|enable|disable`, `gh run rerun|cancel|delete`, `gh secret …`, `gh variable …`; `gh api` with any method but GET (fields without `-X` mean POST, as in gh) except POST to `repos/techaust/techaust_platform/pulls` and `…/issues/<n>/comments` (`{owner}/{repo}` accepted), or a path holding `merge`, `/dispatches`, `/actions`, `/environments`, `/protection`, `/rulesets` (GraphQL is a POST, so refused); `git push` with `-f`/`--force*`/`--delete`/`-d`/`--mirror`/`--all`/`--prune`, a refspec with `:` or `+`, or `main`/`master`; `wrangler deploy|publish|secret|versions|rollback|login|delete` and any wrangler `--remote`, however started (npx, pnpm, pnpm exec, `pnpm --filter … exec`, `node …/wrangler.js`, the heavy queue, `timeout`, `sudo env …`); the `deploy:*` scripts.
  - Matching splits at `&&`, `||`, `;`, `|`, `&`, newlines, `( )`, backticks and `$(`, and checks quoted text again when it would run (`bash -c`, `eval`, `$(…)`, multi-line text such as heredocs); a quoted search pattern (`grep 'gh pr merge'`) or a one-line commit message is only text. Borderline cases are refused (`git push origin HEAD:refs/heads/x`, a push to a URL with `:`, `gh api` with an unreadable path or a variable method).
  - Tests: every refusal (85 commands), the allowed ones (cloud-pr.sh itself, its exact GET and POST, PR comments, ordinary git and gh reads, local wrangler, text that mentions a refused command), the hook answering `deny` with its reason, and **every refused command passing untouched with `CLAUDE_CODE_REMOTE` unset, `false`, `1`, `TRUE` or empty**.
  - **Best effort:** a script, an alias, another language (`node -e "…execSync('wrangler deploy')"`, `find -exec`) or a command built at run time can get round a pattern. CLAUDE.md "In a cloud session" stays the rule; the guard only catches the plain mistakes. The hook's reason says so too.
- **M1, the model in the cloud** (e7482854; b00ee20a makes its test fast): `docs/runbooks/cloud-sessions.md` Part 3 step 2 ("In the model menu under the message box, choose **Opus 5.5** before sending (the project can't choose it for you)", plus what the warning looks like); `scripts/cloud-session-start.sh` (cloud path only: reads the hook's stdin JSON with `timeout 2 cat`, skipped when stdin is a terminal; Node parses it; a `model` not starting with `claude-opus-5-5` puts `MODEL IS <x>, NOT Opus 5.5: stop and tell the owner; ` first in the summary line); the CLAUDE.md cloud block's model line reworded as briefed; no `model` key in settings.json. Test: the cloud path in an empty folder with a stand-in `pnpm`: another model leads the summary; Opus 5.5, `claude-opus-5-5[1m]`, no field, empty input, bad JSON and no stdin do not.
- **M3, one browser agent** (c8d75366): docs/14 §4 bullet replaced as briefed; the §4 lead line and the §5 table cell say 1 until a second browser server exists; docs/13's last CLOUD-1 row drops "until the first cloud check shows…" and keeps one browser agent; **`tools/agent-slots.mjs` cloud browser limit 2 → 1** (its header says why), test updated. I also added "**1** until a second browser server exists" to CLAUDE.md's "Agents at once" cloud line so it doesn't contradict the tool (the owner's "at most 2" stays as the ceiling); revert that half-line if you'd rather keep CLAUDE.md untouched there.
- **L1** (df33d53f): `pnpm-workspace.yaml` joins the install-skip hash (+ a test).
- **L2** (fa846585): `tools/cloud-pr.sh` uses `git ls-remote origin "refs/heads/$HEAD"` (+ a test); checked read-only against GitHub: the exact ref of `chore/cloud-sessions` resolves, a bare suffix does not.
- **L3** (8f130368): `scripts/cloud-setup.sh` installs `xz-utils` with apt (critical: `die` on failure) when `xz` is missing, before `tar -xJf` (+ a test); `bash -n` clean.
- **L4** (81a25d7b): `WRANGLER_SEND_METRICS=false` for the hook and in the cloud env file (+ a test).
- **L5** (1d8faf3c): SessionStart `statusMessage` "Session start (cloud setup only)".
- **L6** (950c1320): the runbook uses "Also include default list of common package managers", says `nodejs.org` is already in the default list (kept, harmless), and adds the organisation switch (Organization settings > Claude Code > Cloud sessions, claude.ai/admin-settings/claude-code), marked as from the docs and not checked on this Team org. The same commit carries the **"before the merge"** wording for the local server switch (runbook bottom note and table row); the run file's "This PC" note above now says the same (committed with this report).
- **L7** (f939359a): docs/14 §4: each browser agent works in its own worktree, which gives it its own local database (`--persist-to` / `persistState` point at the worktree's own `.wrangler/state`, not tied to the offset).
- **L8** (da46f455): `apps/web/test/cloud-setup.test.ts`: the exact `settings.hooks.SessionStart[0].hooks[0].command` through `bash -c` with `CLAUDE_PROJECT_DIR` = the repo root (spaces) and `CLAUDE_CODE_REMOTE` unset: exit 0, no output; `tools/mcp-local-off.mjs`, run from a copy in a temp folder (with `HOME` there too), refuses under `CLAUDE_CODE_REMOTE=true`, with and without `--user`, and writes nothing.
- **Lead's extra item, agent-slots input checks** (5758dd6c): the CLI refuses a non-numeric, negative, hex, empty or missing value for `--usage` and `--reading` (plain non-negative numbers) and `--running` and `--browsers` (whole numbers), a flag followed by another flag, and a `--reading-at` that isn't a date: `start: no (bad value for --usage: "abc")` (or `: none given`), exit 1. `decide` is unchanged and pure. 14 bad-value CLI cases plus a good-values case in `apps/web/test/agent-slots.test.ts`.

**Commands and results:**
- `pnpm install --frozen-lockfile --offline`: ok (worktree links).
- `vitest run --project node` (web) on `model-guard`, `cloud-setup`, `agent-slots`: 10, 19 and 25 passed (after each change); `pnpm exec biome check` on every changed file: clean.
- By hand: the guard on this PC still prints the effort note for a Bash call with an effort level and refuses nothing; with `CLAUDE_CODE_REMOTE=true` it answers `deny` for `gh pr merge 1`.
- `bash tools/heavy.sh --log cloud1r1-check pnpm check`: **exit 0** (lint: the same 10 warnings in files this task doesn't touch; typecheck clean; the four guards ok).
- Full `pnpm test` through the queue, twice; both stopped early on **timeouts under load** (the lead's `dash-lead` heavy commands and another agent were running): run 1 (`.logs/cloud1r1-test.log`) passed auth 135, ui 469, core 1801, email 128, db 471, pdf 340, with timeouts in portal, admin, jobs and web, among them my new M1 test (120 s: it then ran the real pnpm four times per case; it now uses a stand-in, 13 s for the file); run 2 (`.logs/cloud1r1-test2.log`) stopped on a ui PNG test at 5 s. **Reruns, each package alone through the queue:** web **579 passed** (+17 skipped), portal **631**, jobs **528**, ui **469** (+2 skipped), admin **3371 passed, 1 failed**.
- **The admin failure is not this branch's:** `worker/dashboard-stress.test.ts` "reads at most 6,100 rows per call for every role…": `owner read 6126 rows: expected 6126 to be less than or equal to 6100` (`.logs/cloud1r1-admin.log`). This branch changes no admin, db or package code (`git diff --stat b304a046..HEAD`: tooling, tests in apps/web and docs only); the lead's `dash-lead` worktree was running this same test in the queue meanwhile, and the date had just turned to 2026-10-30, which the fixture's figures may depend on. Not investigated further (outside this brief).
- `bash tools/heavy.sh --log cloud1r1-lint pnpm lint` (the final whole-repository lint): **exit 0**, 1,320 files, the same 10 warnings (none in this branch's files).

**Not verified (needs a real cloud session):**
- That hooks in the cloud see `CLAUDE_CODE_REMOTE=true` in their environment (the SessionStart hook already relies on it; documented, not observed), so that the guard is active there.
- That the cloud's SessionStart input carries `model` (the docs say it is optional and can be omitted, e.g. after `/clear`): without it there is no warning, only the owner's pick.
- `xz-utils` from apt through the Custom network; `nodejs.org` being in the default list (from the docs as quoted in the early check; the default-list excerpts I read did not show it either way); the organisation switch's label on this Team org.
- The guard against real cloud commands beyond the test list; it sees only the command typed (`bash tools/cloud-pr.sh …`), never what a script runs inside.

**Open points for the lead:**
1. CLAUDE.md "Agents at once" now says the cloud runs 1 browser agent until a second server exists (M3 consistency): confirm or revert.
2. `origin/chore/cloud-sessions` has moved since my base (b304a046 → 49991901 when I checked); this branch is on b304a046 as briefed.
3. The admin dashboard stress test failure above (owner 6,126 rows against the 6,100 ceiling).

### Lead, after fix round 1 (2026-10-30)
- Merged `fix/cloud-1-r1` (81c5467c) into `chore/cloud-sessions`; the conflicts in docs/13 and this file kept both sides (the builder's edited CLOUD-1 row, then the owner-only workflow row).
- **Open point 1, accepted:** CLAUDE.md says one cloud browser agent "until a second browser server exists", matching the analyst's M3 and `tools/agent-slots.mjs`.
- **Open point 3, explained:** the admin failure (`dashboard-stress.test.ts`, owner 6,126 rows against 6,100) is a date-dependent test, not this branch; it failed every PR on 30 October and is fixed in #114 (pinned to the worst day measured). This branch merges `main` once #114 is in.
- The full `pnpm test` timeouts came from several heavy runs sharing this PC; each package passed alone. The review re-runs the full suite with the queue free.
- Next: the review (reviewer, Opus high).

## Review (reviewer, Opus 5.5 high, 2026-10-30, on 01bced49): APPROVE (copied by the lead; the reviewer can't write)
No critical or high findings; 3 medium, 8 low. Skills: `code-review` (high; its helper's 10 candidates checked against 66 probe commands, 6 held), `security-review` (done by hand: no Agent tool for its sub-tasks). No visual review (no screens).

1. **medium** `tools/cloud-guard.mjs:166-183`: `gh` subcommands use a short deny-list. Passes in the cloud: `gh repo edit --visibility private`, `gh repo delete --yes`, `gh release create`, `gh cache delete --all`, `gh label …`, `gh repo deploy-key add`, and `gh alias set mm 'pr merge'` then `gh mm 12`. Fix: in the cloud allow only read subcommands (`pr view|list|diff|checks|status`, `run view|list|watch`, `workflow view|list`, `repo view`, `issue view|list`, `release view|list`, `auth status`, `api` under its rules); refuse everything else, `alias`, `extension` and unknown first words included; tests.
2. **medium** `tools/cloud-guard.mjs:266-272`: a leading redirection or `$"…"` stops the lead-word scan: `>out.log wrangler deploy`, `2>/dev/null gh pr merge 12`, `</dev/null gh pr merge 12`, `$"wrangler" deploy` pass. Fix: `/^\d*(<|>|&>)/` words are lead words (a lone operator also skips the next word); `$"` like `"`; tests.
3. **medium** `.claude/settings.json:26`: the PreToolUse matcher `Agent|Bash` leaves other shell-running tools (Monitor) unchecked in the cloud. Fix: add them to the matcher and read their command field in `model-guard.mjs`; confirm in the first cloud check.
4. **low** `tools/cloud-guard.mjs:237-238`: on main, `git push`, `git push origin HEAD`, `git push origin heads/main` pass (branch protection still stops them). Fix: refuse `heads/main`; refuse bare push / `HEAD` when the current branch is main, or document protection as the stop.
5. **low** `tools/cloud-guard.mjs:244-252`: `wrangler dev -r`, `d1 create`, `queues create`, `r2 bucket create`, `kv namespace create` pass. Fix: refuse `-r` and `create`.
6. **low** `tools/cloud-guard.mjs:249`: false positive on `pnpm -F @techaust/jobs exec wrangler deploy --dry-run --outdir dist`. Fix: allow `deploy` with `--dry-run`.
7. **low** `tools/cloud-guard.mjs:293`: heredoc and quoted text that never runs is checked (commit bodies through `$(cat <<'EOF' …)`, `cat > file <<'EOF'`, quoted arguments of `bash script.sh`). Fix: re-check heredocs only when they feed a shell, quoted text only for `bash|sh -c` and `eval`; a lone `-` is not a lead-word flag.
8. **low** `docs/10-tooling.md:27` (T4): `@playwright/mcp@0.0.83` (`.mcp.json`) isn't listed (hard rule 11). Fix: add the cloud-only line.
9. **low** `docs/14-models-and-usage.md:119` vs runbook Part 2 step 5: §6 says `CLAUDE_CODE_EFFORT_LEVEL` stays unset, the runbook sets it in the cloud. Fix: "on this PC" plus the cloud exception.
10. **low** `scripts/dev-ports.mjs:76`: the free-port test tries only 127.0.0.1; a port held on `::1` or `0.0.0.0` is reported free. Fix: free only when all three are free.
11. **low** `scripts/dev.mjs:49-53`: SIGINT is passed on although Ctrl-C already reaches the child; a double SIGINT can skip workerd clean-up. Fix: forward SIGTERM/SIGHUP only, or skip SIGINT on a terminal.

**Checked and sound:** the workflow actor checks (first step, safe under `bash -e`, scheduled first attempt passes, by hand needs both actors, expressions via `env`, fork-safe); the guard refuses quoting, `VAR=` prefixes, `&&`/`;`/`|`, subshells, braces, backticks, `$(…)`, `bash -c`, `eval`, `xargs`, `sudo -u`, `env -i`, `nice`, `timeout`, `exec -a`, `npx wrangler@4`, `pnpm exec --`, `deploy:*`, `gh api` merge/GraphQL/PATCH/releases/refs, `-R`/`--repo=`, force/`+`/`:` refspecs; ordinary work allowed; a thrown error fails open; on this PC the hooks print nothing and refuse nothing; `agent-slots.mjs` matches docs/14 §5; dev ports never collide across offsets 0–900; `heavy.sh` lock unchanged; no secrets or personal data; `cloud-pr.sh` never merges; docs agree apart from 8 and 9.

**Commands:** `pnpm check` (queue): exit 0 (10 lint warnings outside this diff). `pnpm test` (queue): exit 1 on a load timeout in web `og.test.ts` (not in this diff), after auth 135, ui 469, core 1801, email 128, db 471, pdf 340 passed; reruns alone: web 583 (+17 skipped), portal 631, jobs 528, admin 3372, all passed. Manual hook checks on this PC: clean.

**Not verified:** hooks seeing `CLAUDE_CODE_REMOTE=true` in a real cloud session; which shell-running tools the cloud has (3); the GitHub App's permissions (1); the setup script end to end, the MCP tool names, `cloud-pr.sh` against the real proxy; a real by-hand run of the two workflows; e2e at offset 100.

## Lead's triage after the review (2026-10-30)
- Fix in this task (fix round 2, builder): 1, 2, 4 (refuse `heads/main`, and bare push / `HEAD` while on main), 5, 6, 7, 8, 9, 10, 11.
- 3 changes `.claude/settings.json` (the hook matcher): asked the owner first, since it changes the project's hook configuration.

## Fix round 2 brief (lead, 2026-10-30)
Builder, Opus 5.5 high, Tier B. Branch `fix/cloud-1-r2` from `origin/chore/cloud-sessions` (d40ea728 or later); push only that branch.
- Fix review findings 1, 2, 4, 5, 6, 7, 8, 9, 10 and 11 as described in the review above. Not 3 (waits on the owner; don't touch `.claude/settings.json`).
- Finding 1: in the cloud, `gh` is an allow-list of read subcommands plus `api` under its current rules; everything else is refused with a clear reason (the reason names the allowed list). Keep what `tools/cloud-pr.sh` needs working.
- Finding 4: refuse `heads/main` and `refs/heads/main` targets; refuse a bare `git push` or a `HEAD` refspec when the current branch is `main` (a read-only `git rev-parse --abbrev-ref HEAD`, only when `CLAUDE_CODE_REMOTE=true`; if it fails, refuse).
- Finding 7: no new false negatives: the probes the review lists as correctly refused must stay refused.
- Each fix gets tests in `apps/web/test/model-guard.test.ts`, `dev-ports.test.ts` or a new test beside them; every probe named in findings 1, 2, 4, 5, 6 and 7 becomes a test case.
- On this PC (`CLAUDE_CODE_REMOTE` unset) the hooks must still print nothing and refuse nothing.
- Checks: the touched test files, `pnpm exec biome check` on changed files, then `bash tools/heavy.sh --log cloud1r2-check pnpm check` and, as the final check, `bash tools/heavy.sh --log cloud1r2-lint pnpm lint`. No full `pnpm test` needed (only tooling and web tests change); run web's tests alone through the queue.
- Append "## Builder report, fix round 2" to this file: what changed per finding, commands and results, not verified.

## Builder report, fix round 2 (Opus 5.5 high, 2026-10-30, branch `fix/cloud-1-r2` from `origin/chore/cloud-sessions` 3c75ebd7)

**Skills:**
- `cloudflare:wrangler`: the wrangler refusals (findings 5 and 6) come from the installed wrangler 4.147.0's own help, not memory: `wrangler dev -r` is `--remote`; `deploy --dry-run` "compiles … without actually uploading"; the command list showed `wrangler preview` ("Create a Preview deployment"), so `preview` joins the refused words with `create`.
- Not loaded: `cloudflare:workers-best-practices` (no Worker code), `update-config` (the one settings change is a matcher string the lead specified, checked by a test), `code-review` / `security-review` (the reviewer's), `frontend-design` / `dataviz` (no screens), `aws-*` (no AWS).
- Docs: Context7 `/websites/code_claude` (hooks: matchers are bare tool names; `tool_input` per tool). The Monitor tool's input fields came from this project's own session logs (11 Monitor calls: `command`, `description`, `timeout_ms`; only `command` holds a command).

**Per finding (commits):**
1. **gh allow-list** (f805e8ed): `tools/cloud-guard.mjs` `GH_READ` (pr view|list|diff|checks|status, run view|list|watch, workflow view|list, repo view, issue view|list, release view|list, auth status) plus `gh help`, `gh version`, flags only (`gh --version`), and `gh api` under its old rules. Everything else is refused with `"gh <sub> <act>" is not a read; in a cloud session gh runs only: <the list>` (exported as `GH_ALLOWED`), alias, extension and unknown first words included. `tools/cloud-pr.sh` uses only `gh api` GET and POST to `…/pulls`: unchanged and tested.
2. **Leading redirections and `$"…"`** (f805e8ed): a word starting with a redirection (`>out`, `2>/dev/null`, `<in`, `&>log`, `>&2`, `<<EOF`) is a lead word, and a lone operator (`>`, `2>`, `<`, `&>`) makes its target one too; `&` after `<`/`>` or before `>`, and `|` after `>`, belong to the redirection, not separators; `$"…"` is read like `"…"`.
3. **Monitor** (c16af855, owner's yes 2026-10-30): `.claude/settings.json` matcher `Agent|Bash|Monitor` (nothing else changed there); `tools/model-guard.mjs` reads `tool_input.command` for Monitor and runs the same cloud check, only under `CLAUDE_CODE_REMOTE=true`; the effort note stays Bash-only, so on this PC a Monitor call prints nothing. docs/13 row added as given; the docs/14 §6 table names the matcher (the runbook doesn't name it).
4. **Pushes to main** (f805e8ed): `heads/main` and `refs/heads/main` (and master) targets are refused; a push with no refspec or a `HEAD`/`@` refspec reads the current branch through `opts.currentBranch(dir)`, which model-guard supplies as a read-only `git -C <dir or the hook's cwd> rev-parse --abbrev-ref HEAD` (5 s timeout), cloud only. `main`/`master` refuse; a failure, an empty answer or no reader refuses ("can't be read here"). A detached HEAD passes. `git -C <dir> push` reads that folder's branch (relative to the hook's `cwd`).
5. **wrangler** (f805e8ed): `-r` is refused like `--remote`; `create` and `preview` join the refused words (`d1 create`, `queues create`, `r2 bucket create`, `kv namespace create`, `wrangler preview`). Side effect, intended: `wrangler d1 migrations create` is refused too (the repo makes migrations with drizzle-kit).
6. **Dry runs** (f805e8ed): `deploy` passes when `--dry-run` (or `--dry-run=true`) is present; `--dry-run=false` is refused; `--remote`/`-r` still refuse beside it.
7. **Text that never runs** (f805e8ed): the splitter is now a small parser. `$(…)` and backticks are parsed as commands wherever bash runs them (unquoted, in double quotes, in heredocs with an unquoted delimiter); heredoc bodies are kept as text on their command (`<<`, `<<-`, quoted or not, several per line, `cat<<EOF` without a space); pipelines are tracked. Quoted text is re-checked only after `bash|sh|zsh|dash -c` (also `-lc`, and after `-o pipefail`), `eval` (its words joined) and `watch`; a heredoc body only when its command, or another in the same `|` pipeline, is a shell or `source`/`.`. A lone `-` no longer makes the next word a flag value. No new false negatives: every probe the review listed as correctly refused is a test case and still refused, plus `cat <<'EOF' | bash`, `cat<<EOF | sh`, `source /dev/stdin <<'EOF'`, `$(…)` and backticks inside an unquoted heredoc, `VAR=$(…)`, nested `$(…)`, `|&`.
8. **docs/10 T4b** (fbac15f3): the cloud-only `@playwright/mcp` 0.0.83 line (owner approved 2026-10-29; off on this PC).
9. **docs/14 §6** (fbac15f3): `CLAUDE_CODE_EFFORT_LEVEL` stays unset on this PC; the cloud environment sets it to high (runbook Part 2).
10. **Free port** (24c8acd2): `scripts/dev-ports.mjs` `isPortFree(port, hosts = PORT_HOSTS)` is true only when the port is free on 127.0.0.1, ::1 and 0.0.0.0 in turn; an address the machine lacks (`EADDRNOTAVAIL`, `EAFNOSUPPORT`, e.g. no IPv6) counts as free there. `.d.mts` updated.
11. **SIGINT** (24c8acd2): `scripts/dev.mjs` `forwardedSignals(fromTerminal)`: SIGTERM and SIGHUP always; SIGINT only when stdin isn't a terminal (Playwright's web server); the launcher still catches SIGINT and waits for the server to exit.

**Tests:** `apps/web/test/model-guard.test.ts` (19 tests): every probe of findings 1, 2, 4, 5, 6 and 7 as a REFUSED or ALLOWED case (about 70 new lines); the gh reason names the list; finding 4 with a stand-in branch (main and master refuse seven current-branch pushes; `fix/x`, `fix/main-menu` and a detached HEAD pass them; a named branch passes on main; null, empty, throwing or no reader refuse; `git -C` passes its folder) and end to end through the hook with real `git init` repositories (main refuses, `fix/x` passes, a folder outside any repository refuses, `git -C` both ways); Monitor in the cloud (`wrangler deploy` and `gh pr merge 12` denied, `bash tools/watch.sh x` allowed with empty output); Monitor on this PC prints nothing for four commands; `.claude/settings.json`'s model-guard matcher is exactly Agent, Bash, Monitor. `apps/web/test/dev-ports.test.ts` (+4): a listener on ::1 and on 0.0.0.0 is seen (the IPv6 case skips itself without IPv6), an absent address counts as free, the two signal sets.

**Commands and results:**
- `pnpm install --frozen-lockfile --offline`: ok.
- `vitest run --project node` (web) on `model-guard`, `cloud-setup`, `agent-slots`, `dev-ports`: **87 passed**. (The first model-guard run had 1 failure in my new end-to-end test: a fresh `git init` repository has no commit, so `rev-parse HEAD` fails and the push is refused, which is the intended behaviour; the test now makes one empty commit.)
- `pnpm exec biome check` on every changed code file: clean (after `--write` formatting).
- `bash tools/heavy.sh --log cloud1r2-check pnpm check`: **exit 0** (typecheck clean, the guards ok).
- `bash tools/heavy.sh --log cloud1r2-web-test pnpm --filter @techaust/web test`: **596 passed, 17 skipped** (32 files).
- `bash tools/heavy.sh --log cloud1r2-lint pnpm lint` (final): **exit 0**, 1,321 files, 10 warnings and 8 infos, all in files this branch doesn't touch (admin `reports.test.ts`, web `catalogue.ts`, core `public-text.ts`, pdf tests).

**Not verified:**
- Finding 3 is **not verified in a real cloud session**: that Claude Code there sends Monitor calls to the PreToolUse hook with `tool_input.command`, and that hooks see `CLAUDE_CODE_REMOTE=true`.
- Finding 4's `git rev-parse` in the cloud's working folder (the hook's `cwd`); a `cd elsewhere && git push` is checked against the hook's folder, not `elsewhere` (best effort, as the guard's header says).
- Finding 11 by hand (Ctrl-C in a terminal, and Playwright stopping its web server): only the signal choice is unit-tested; no dev server was started in this round.
- The parser is still not a full shell: `case … )` patterns and process substitution `<(…)` can be misread (they split more, so they check more); arithmetic `$(( a << b ))` is read as a heredoc, which would treat the following lines as its text (a possible false negative, needing a deliberate shift operator).

**Open point for the lead:** `wrangler d1 migrations create` is now refused in the cloud (finding 5's `create`); say if that one local-only command should be allowed.

## Re-check (reviewer, Opus 5.5 high, 2026-10-30, on b7569d83): SEND BACK (copied by the lead)
All 11 review findings are closed as briefed. The new parser in `tools/cloud-guard.mjs` lets through forms the old guard (3c75ebd7) refused, which the finding 7 brief ruled out. About 200 probe commands, old guard against new (probes kept in the lead's `.logs/cloud1-recheck-probes/`). Skills: `code-review` (high; its helper's 10 candidates re-run, 9 confirmed), `security-review` by hand.

1. **high** `tools/cloud-guard.mjs:290`: `<<<` (here-string) is read as a heredoc from its second `<`; the string becomes the delimiter and every later line goes unchecked. Pass now, refused before: `read -r n <<< "$(gh pr list …)"` then `gh pr merge "$n" --squash`; `jq -r .x <<< "$json"` then `gh pr merge 1`; `grep -q ok <<< "$out" && echo y` then `wrangler deploy`; `bash <<< 'gh pr merge 1'`, `bash <<<'gh pr merge 1'`. Fix: `<<<` is a three-character redirection, the next word a string; for a shell (`readsAsShell`), check that string as a command; tests.
2. **medium** `:290`: an arithmetic shift is read as a heredoc: `x=$(( 1 << 3 ))` or `(( i <<= 1 ))` then `gh pr merge 1` passes. Fix: inside `$((…))` and `((…))` read to the matching `))` as text; `let x=1<<2` stays a heredoc (bash does the same); tests.
3. **medium** `:315-321`: `|&` ends the pipeline at `&`, so `cat <<EOF |& bash` with `gh pr merge 1` in the body passes. Fix: `|&` is one pipe (`endCommand(true)`, advance 2); heredoc test.
4. **low** `:481` (`shellTexts`): option scan stops at a long option's value: `bash --rcfile /dev/null -c 'gh pr merge 1'`, `bash --init-file x -c '…'` pass. Fix: skip `--rcfile`/`--init-file` values, or find a `-c`-style word anywhere after the shell name.
5. **low** `:297-298`: redirection detection looks at the word's last character including quoted text: `echo "a>"& gh pr merge 1`, `echo "a>"| gh pr merge 1`, `echo 'a<'& gh pr merge 1` pass. Fix: last unquoted character only.
6. **low** `:437`: `wrangler deploy --dry-run false` and `--dry-run --no-dry-run` pass. Fix: exempt only without `--no-dry-run` and when the word after `--dry-run` isn't `false`/`0`.
7. **low** `:180, 283`: ~5,000 nested `$(` throw a RangeError; the hook exits with an error, which Claude Code treats as allowed. Fix: catch in `cloudRefusal` and refuse ("can't be parsed"), or cap the depth.
8. **low** `scripts/dev.mjs:59-63`: on a terminal, a SIGINT sent to the launcher alone is swallowed. Fix: if the server is still running a moment after SIGINT, pass it on.
9. **low, older or accepted best effort:** `echo 'gh pr merge 1' | bash` passes (old guard too); `cat <<EOF > x.sh && bash x.sh` passes (script class, accepted); wrangler is still a deny-list (`d1 time-travel restore`, `queues purge` pass; an allow-list closes the class); `git switch main && git push` / `cd elsewhere && git push` are checked against the hook's folder (branch protection stops them).

**Commands:** `pnpm check` (queue): exit 0. Web tests (queue): 596 passed, 17 skipped. Old-vs-new probe runs; hook checks with `CLAUDE_CODE_REMOTE` unset (prints nothing, exit 0) and true.
**Ordinary work passes** in a simulated cloud: `cloud-pr.sh`, `watch.sh`, `heavy.sh … pnpm check`, gh reads, `gh api` PR create and comment, `wrangler deploy --dry-run --outdir dist`.
**Not verified:** a real cloud session (Monitor reaching the hook with `tool_input.command`, `CLAUDE_CODE_REMOTE=true` in hooks, `git rev-parse` there); wrangler's reading of `--dry-run false`; finding 8 at run time.

## Lead's triage after the re-check (2026-10-30)
- Fix round 3 (builder): 1–8, plus from 9: quoted text piped into a shell (`echo '…' | bash`, `printf … | sh`) is checked as a command; wrangler becomes an allow-list in the cloud (see the brief). Accepted as best effort and documented in the guard's header: a script written then run, and the folder used for the branch read (branch protection is the stop).
- A high finding → a second re-check after the fix (1–3, 7 and the wrangler allow-list at least).

## Fix round 3 brief (lead, 2026-10-30)
Builder, Opus 5.5 high, Tier B. Branch `fix/cloud-1-r3` from `origin/chore/cloud-sessions` (this commit or later); push only that branch. Don't touch `.claude/settings.json`.
- Fix re-check findings 1–8 as described above, each with tests built from every probe named there (all must be refused, and a here-string with harmless text such as `jq -r .x <<< "$json"` alone must pass).
- From 9: a pipeline whose last command is a shell (`bash`, `sh`, `zsh`, `dash`, `source /dev/stdin`) checks the quoted text of `echo`/`printf` before it as a command.
- wrangler in the cloud is an allow-list: `dev` (refused with `--remote`/`-r`), `types`, `build`, `deploy` only as a real dry run (finding 6), `d1 migrations list|apply` and `d1 execute` only with `--local`, `--version`/`-v`, `help`/`--help`. Everything else refused; the reason names the allowed list. Keep `pnpm --filter … dev`, `pnpm build`, `pnpm typecheck`, `pnpm db:migrate:local` and `pnpm --filter @techaust/jobs types` working in a simulated cloud (tests).
- Header comment of `tools/cloud-guard.mjs`: name the accepted best-effort classes (a script written then run; the branch read uses the hook's folder; branch protection is the stop).
- No new false negatives: every probe in the review and the re-check that the guard refuses today stays refused (add the re-check's list as a regression table; the lead's copy of the probe files is in the main checkout's `.logs/cloud1-recheck-probes/`, readable by absolute path).
- Checks: touched test files, `biome check` on changed files, `bash tools/heavy.sh --log cloud1r3-check pnpm check`, web tests alone through the queue, and the whole-repository `pnpm lint` last. Append "## Builder report, fix round 3".
