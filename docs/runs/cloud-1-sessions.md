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
   - **create the "TecHaust" environment:**
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
