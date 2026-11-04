# A new or freshly formatted PC

How to carry on with the project after the PC is formatted (owner, 2026-11-03: "fresh start", nothing kept on the PC). The project itself is safe: the code, the record (`docs/`) and every decision are on GitHub; the Workers, D1, R2, queues and their secrets are in Cloudflare; the CI secrets are in GitHub. Only what lived on the PC alone is lost, and this page covers it. **Proven on 2026-11-04** (the first restore; the corrections below come from it).

## What is where

| Thing | Where it lives | After the format |
|---|---|---|
| Code, docs, record, run files | GitHub `techaust/techaust_platform` | Downloaded again |
| Claude's memory notes | A copy in [new-pc-memory/](new-pc-memory/) (snapshot of 2026-11-04, two notes trimmed for this public repo) | Copied back by the lead (step 7) |
| Old site (read-only reference) | GitHub `techaust/techaust-web` (fully pushed on 2026-11-03; only build folders and `node_modules` were local) | Not needed on the PC; download only if a page must be compared |
| Worker secrets, D1, R2, staging | Cloudflare | Nothing to do |
| CI and deploy secrets | GitHub repository secrets | Nothing to do |
| Local test secrets (`.dev.vars`), local database, generated types | Rebuilt by commands | Rebuilt by the lead (step 6) |
| Claude plugins (user scope) | Lost with the format | Reinstalled by the lead (step 8) |
| `.logs/` (old review screenshots, 1.2 GB) | Not kept (owner, 2026-11-03) | Every review result is already in `docs/runs/` |
| Conversation history | Not kept | The record and run files hold every decision |
| The `CREDENTIALS` folder | **Never on GitHub** (public repo; the lead never reads it) | The owner's to keep, or lost |

## Before formatting (owner)

1. Make sure you can still sign in **without this PC** to: GitHub, Cloudflare, AWS, Zoho Mail, Razorpay, Stripe, PayPal and the Claude app. The authenticator app on your phone holds the 2FA codes; it is not affected by formatting the PC.
2. Anything in the `CREDENTIALS` folder that you cannot get again from the service itself (for example 2FA recovery codes) is gone after the format. Every key the apps use can be made again in the service's dashboard and re-stored with the lead's scripts, so a lost key costs a rotation, not the project.
3. No open pull request and no unpushed branch should be left (on 2026-11-03: none).

## After formatting

1. **Install the Claude desktop app** (owner), sign in with admin@techaust.com, open the Code tab and pick **Opus 5.5** in the model menu.
2. **The project folder:** since 2026-11-04 the project lives at `D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform`. Either clone it there (step 5) or, if the files are already there without git history (a downloaded copy), the lead links the folder to GitHub (step 5) and checks that it matches `main` before anything is replaced. Choose that folder in the Code tab.
3. **Say to Claude:** "set up this PC from docs/runbooks/new-pc.md" (or "start the day": the lead notices the missing tools). The lead does steps 4 to 10 and asks you only to click **Yes** on Windows' install prompts and to sign in where a browser opens.
4. **Programs** (the lead, with winget, on the owner's word; Windows asks "allow changes?" once per installer):
   - `winget install --id Git.Git --exact`
   - `winget install --id OpenJS.NodeJS.LTS --exact --version 24.<newest>`: **Node 24**, matching `.nvmrc` (the plain LTS is Node 26 since October 2026, which the project hasn't moved to)
   - `winget install --id GitHub.cli --exact`
   - then `npm install -g pnpm@12.9.1` and `npm install -g @anthropic-ai/claude-code` (the command-line tool that installs plugins)
   - The app that was open during the installs doesn't see the new programs: restart the Claude app afterwards, and **sign out of Windows and back in once** so every new PowerShell window finds `pnpm` and `claude` (until then use `& "$env:APPDATA\npm\pnpm.cmd"` and `& "$env:APPDATA\npm\claude.cmd"`).
   - Python is **not** needed (only `packages/ui/scripts/measure-cmyk.py` uses it, with Pillow, after a palette change).
5. **Git** (the lead):
   - `git config --global core.longpaths true` and `git config --global init.defaultBranch main`
   - a fresh clone: `git clone https://github.com/techaust/techaust_platform.git` into the folder above; a downloaded copy: `git init -b main`, `git remote add origin https://github.com/techaust/techaust_platform.git`, `git fetch origin`, `git reset origin/main` (keeps the files), check that `git status` is empty, then `git branch --set-upstream-to=origin/main main` and `git remote set-head origin --auto`
   - in the repo: `git config user.name "TecHaust Technologies"` and `git config user.email admin@techaust.com`
   - no SSH or GPG key: GitHub is reached over HTTPS with the GitHub CLI's sign-in, and local commits aren't signed (GitHub signs the squash merges)
6. **Packages, local secrets and database** (the lead): `pnpm install --frozen-lockfile`, `pnpm dev:secrets`, `pnpm db:migrate:local`, `pnpm db:seed:local`, `node tools/mcp-local-off.mjs` (keeps the cloud-only browser server off on the PC), `pnpm --filter @techaust/admin exec playwright install chromium`.
7. **Memory notes** (the lead): copy every file in [new-pc-memory/](new-pc-memory/) to `%USERPROFILE%\.claude\projects\<the folder path, every non-letter as ->\memory\` (for the folder above: `D--Business-1--Parent-Project-TecHaust-Technologies-Application-techaust-platform`). The two trimmed lines (an outside AWS account number, the revenue target and marketing budget) are not needed for the work.
8. **Plugins** (the lead):
   - `claude plugin install <name>` for `cloudflare@cloudflare`, `playwright@claude-plugins-official`, `context7@claude-plugins-official`, `frontend-design@claude-plugins-official` and `github@claude-plugins-official` (the list is `enabledPlugins` in `.claude/settings.json`);
   - the AWS skills (`aws-core`) come from the Claude account's plugin directory: the lead shows its install card and the owner clicks **Install**;
   - the project's `.claude/settings.json` already turns off what it doesn't use (plugins, connections, skills; [10](../10-tooling.md) "unused tools off"); the one thing it can't hold is the `aws-core` plugin's own connection: add `plugin:aws-core:aws-mcp` (with `supabase`, `upstash`, `aws-mcp`) to `disabledMcpServers` in the `~/.claude.json` project entry (AWS waits until it is signed in to the TecHaust account).
9. **Sign-ins** (owner clicks, the lead gives each command; run them in a new Windows PowerShell window, not the app's terminal):
   - GitHub CLI: `gh auth login --web --hostname github.com --git-protocol https` (enter the one-time code, **Authorize**)
   - Cloudflare: **inside an app folder** (wrangler isn't installed at the repository root): `cd` into `…\techaust_platform\apps\jobs`, then `.\node_modules\.bin\wrangler.cmd login`, and choose the full (write) access it asks for (the secret scripts and the `--staging` commands write). If Cloudflare answers "error fetching accounts", sign in at dash.cloudflare.com first and retry.
   - Cloudflare and Context7 plugin connections: `& "$env:APPDATA\npm\claude.cmd"` in the project folder, `/mcp`, pick each, **Authenticate**, `/exit`.
   - GitHub plugin connection: it has no sign-in button (it reads a Windows setting): `[Environment]::SetEnvironmentVariable("GITHUB_PERSONAL_ACCESS_TOKEN", (gh auth token), "User")` copies the GitHub CLI's sign-in without showing it; then restart the app.
   - No Worker or GitHub secret is entered again.
10. **Prove it** (the lead): `bash tools/heavy.sh --log setup-check pnpm check`, then `pnpm build` and `pnpm test` the same way, and `pnpm dev` once (website :4321, admin :5173 `/api/v1/health`, portal :5174 `/api/v1/health`, jobs :8787 `/healthz`). On Windows, stopping `pnpm dev` leaves its node and workerd processes running: end them by PID.
11. **Carry on:** "start the day". The lead reads `docs/12-status.md` and continues from "Next".

## Keep in mind

- The copy in `new-pc-memory/` is a snapshot. After the restore, the live notes are the ones in the user folder; `docs/12-status.md` and `docs/13-decisions.md` stay the source of truth.
- The repo is public: nothing from `CREDENTIALS`, no keys, no client data ever goes into it.
- **Windows Smart App Control:** if pnpm or Biome fail with "Application Control policy has blocked this file", turn Smart App Control off yourself (Windows Security › App & browser control). The lead never changes it. (On 2026-11-04 it was in evaluation mode and blocked nothing.)
- **Don't restart the Claude app while tests run:** a restart stops the lead's background commands.
- On an 8 GB PC a full parallel `pnpm test` can time out a few slow tests (`geo.test.ts`, `cloud-setup.test.ts`, `password-policy.test.ts`); they pass alone.
