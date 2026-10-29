# Runbook: Claude Code cloud sessions for TecHaust (CLOUD-1, owner checklist)

**Why:** a cloud session runs the work on Anthropic's virtual machine instead of this PC (8 GB of RAM), so up to five agents can run at once (docs/14 §5). You set it up once on claude.ai; after that, every new session starts ready.

**Owner decisions (2026-10-29, docs/13):** a Playwright browser server committed in `.mcp.json` for the cloud; separate dev ports for two browser agents; the model is held by the project's settings and the guard hook only (no admin setting); a cloud session opens its PR through GitHub's REST API, and the local lead turns on auto-merge and Auto-fix.

**Never:**
- put a secret in the environment (no API keys, no tokens, no passwords): the cloud session never needs one
- give the environment access to Cloudflare (`api.cloudflare.com`, `*.workers.dev`): cloud sessions never deploy or touch staging

**Before you start:** the CLOUD-1 pull request must have merged into `main` (the cloud session clones `main`).

Sources (read 2026-10-29): Claude Code docs "Claude Code on the web", "Cloud environments", "Settings", "MCP", "Hooks", "Environment variables" (code.claude.com/docs).

---

## Part 1. Let Claude reach the repository (once)
Installing the GitHub App changes a GitHub setting, so only you do it.
1. Open **https://claude.ai/code** and sign in with the TecHaust account. If it says cloud sessions are off for your organisation, turn them on under **Organization settings > Claude Code** (the **Cloud sessions** switch, at https://claude.ai/admin-settings/claude-code), then come back. (This step is from the Claude Code docs; it was not checked on the TecHaust Team organisation.)
2. If it asks you to connect GitHub, click **Connect GitHub** (or **Install GitHub App**).
3. On GitHub's page, choose the **techaust** account, then **Only select repositories** → pick **techaust_platform** → **Install**.
4. You land back on claude.ai/code. The repository picker now lists **techaust/techaust_platform**.

## Part 2. Create the "techaust_platform" environment (once)
1. On **https://claude.ai/code**, find the environment selector under the message box (it shows the current environment's name) and click it.
2. Click **New environment** (or **Add environment**) at the bottom of the menu. If a dialog asks for the kind, pick the **Cloud** tab.
3. **Name:** `techaust_platform` (owner, 2026-10-30)
4. Click the **Network access** row:
   - choose **Custom**
   - tick **Also include default list of common package managers** (npm, GitHub, Ubuntu and the other trusted hosts)
   - in **Allowed domains**, type these three lines exactly:
     ```text
     nodejs.org
     cdn.playwright.dev
     playwright.download.prss.microsoft.com
     ```
     (Node 24 comes from nodejs.org, which is already in the default list: listing it again is harmless, so it stays. The browser for screenshots comes from the two Playwright hosts.)
5. Click the **Environment variables** row and paste these three lines exactly (no secrets go here):
   ```text
   CLAUDE_CODE_EFFORT_LEVEL=high
   BASH_DEFAULT_TIMEOUT_MS=600000
   BASH_MAX_TIMEOUT_MS=600000
   ```
6. Click the **Setup script** row. In a new browser tab open
   **https://github.com/techaust/techaust_platform/blob/main/scripts/cloud-setup.sh**, click **Raw**, press **Ctrl+A** then **Ctrl+C**, come back and paste it into the box (**Ctrl+V**). Paste the whole file; don't edit it.
7. Click **Add environment** (or **Save changes**).

The first session in this environment takes a few minutes longer: the setup script installs Node 24, pnpm and the browsers, and Claude then keeps a copy, so later sessions start fast. The copy is rebuilt by itself about once a week, or when you change the script or the allowed domains.

## Part 3. Check it (once, then whenever something looks wrong)
1. On **https://claude.ai/code**, pick the repository **techaust/techaust_platform**, the branch **main**, and the environment **techaust_platform**.
2. In the model menu under the message box, choose **Opus 5.5** before sending (the project can't choose it for you). Do this every time you start a session. If you forget, the session's first note says "MODEL IS …, NOT Opus 5.5": stop and tell the lead.
3. Type: **check cloud setup** and send it.
4. Claude runs `bash scripts/cloud-check.sh` and answers with a short list. A good result ends with **"cloud check: all passed"**, and shows:
   - `ok - cloud session (CLAUDE_CODE_REMOTE=true)`
   - `ok - node v24.…` and `ok - pnpm 12.9.1`
   - `ok - pnpm --filter @techaust/core test passed`
   - `ok - claude mcp list: playwright: …` (the browser server)
   - `ok - @playwright/test Chromium launches headless` and `ok - the MCP server's Chromium is installed`
   - `info` lines with the free memory, processors, load and the agent-start rule (`start: no … no usage reading posted today` is normal until the lead posts a reading in `docs/runs/usage-reading.md`)
5. Copy the answer back to the lead in one message.

**If a line says FAIL:** copy the whole answer to the lead. If the session didn't start at all, the setup script stopped: open the environment (gear icon next to its name), check Part 2 was pasted exactly, and save again; the next session reruns it.

---

## What runs where (for the lead)
| Piece | Where | What it does |
|---|---|---|
| `scripts/cloud-setup.sh` | the environment's setup script, before Claude starts (cloud only, cached) | Node 24.22.2 (checksum pinned) first on PATH, pnpm 12.9.1, Chromium for `@playwright/test` 1.64.1 and for `@playwright/mcp` 0.0.83 in `/opt/ms-playwright`; logs in `/var/log/techaust-setup/` |
| `scripts/cloud-session-start.sh` | SessionStart hook in `.claude/settings.json` (on startup and resume) | exits at once unless `CLAUDE_CODE_REMOTE=true`; then flags a model other than Opus 5.5 (first in its summary line), Node 24 and `PLAYWRIGHT_BROWSERS_PATH` for every Bash command, `pnpm install --frozen-lockfile` (skipped while the lockfile, package files and the script are unchanged), dev secrets, local migrations and seed; log `.logs/cloud-session-start.log` |
| `.mcp.json` | loaded by every session in this folder | the `playwright` browser server (headless Chromium, in-memory profile) |
| `tools/mcp-local-off.mjs` | this PC, once per checkout (the main checkout's was set before the merge) | keeps that server off here (`disabledMcpjsonServers` in the git-ignored `.claude/settings.local.json`; `--user` writes `~/.claude/settings.json` instead, which covers every worktree); `--check` reports |
| `scripts/cloud-check.sh` | "check cloud setup" | the report in Part 3 |
| `tools/cloud-pr.sh` | a cloud session's last step | opens the PR over REST and prints its address; never merges |
| `TECHAUST_PORT_OFFSET` | browser agents (docs/14 §4) | 0 for the first, 100 for the second: every dev, browser-test and inspector port moves by 100 |

**On this PC, before the CLOUD-1 merge (done by the lead, 2026-10-29):** the main checkout's git-ignored `.claude/settings.local.json` holds `"disabledMcpjsonServers": ["playwright"]`, so the `.mcp.json` server never starts here, not even in the first session after the merge. After the merge, `node tools/mcp-local-off.mjs --check` in the main checkout confirms it (it prints "off on this PC"); `node tools/mcp-local-off.mjs` writes the setting again if it is ever lost. Without it, a session started from the desktop app or the SDK loads project servers without asking, and a second Playwright browser would start next to the plugin's.
