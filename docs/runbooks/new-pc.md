# A new or freshly formatted PC

How to carry on with the project after the PC is formatted (owner, 2026-11-03: "fresh start", nothing kept on the PC). The project itself is safe: the code, the record (`docs/`) and every decision are on GitHub; the Workers, D1, R2, queues and their secrets are in Cloudflare; the CI secrets are in GitHub. Only what lived on the PC alone is lost, and this page covers it.

## What is where

| Thing | Where it lives | After the format |
|---|---|---|
| Code, docs, record, run files | GitHub `techaust/techaust_platform` | Downloaded again |
| Claude's memory notes | A copy in [new-pc-memory/](new-pc-memory/) (snapshot of 2026-11-03, two notes trimmed for this public repo) | Copied back by the lead (step 6) |
| Old site (read-only reference) | GitHub `techaust/techaust-web` (fully pushed on 2026-11-03; only build folders and `node_modules` were local) | Not needed on the PC; download only if a page must be compared |
| Worker secrets, D1, R2, staging | Cloudflare | Nothing to do |
| CI and deploy secrets | GitHub repository secrets | Nothing to do |
| Local test secrets (`.dev.vars`), local database, generated types | Rebuilt by commands | Rebuilt by the lead (step 5) |
| `.logs/` (old review screenshots, 1.2 GB) | Not kept (owner, 2026-11-03) | Every review result is already in `docs/runs/` |
| Conversation history | Not kept | The record and run files hold every decision |
| The `CREDENTIALS` folder | **Never on GitHub** (public repo; the lead never reads it) | The owner's to keep, or lost |

## Before formatting (owner)

1. Make sure you can still sign in **without this PC** to: GitHub, Cloudflare, AWS, Zoho Mail, Razorpay, Stripe, PayPal and the Claude app. The authenticator app on your phone holds the 2FA codes; it is not affected by formatting the PC.
2. Anything in the `CREDENTIALS` folder that you cannot get again from the service itself (for example 2FA recovery codes) is gone after the format. Every key the apps use can be made again in the service's dashboard and re-stored with the lead's scripts, so a lost key costs a rotation, not the project.
3. No open pull request and no unpushed branch should be left (on 2026-11-03: none).

## After formatting

1. **Install** (owner): Git for Windows, Node.js 24 (LTS, from nodejs.org), GitHub CLI (cli.github.com) and the Claude desktop app. Python only if the print colours are ever re-measured.
2. **Windows Smart App Control:** if pnpm or Biome later fail with "Application Control policy has blocked this file", turn Smart App Control off yourself (Windows Security › App & browser control). The lead never changes it.
3. **Sign in to the Claude app** with admin@techaust.com, open the Code tab, choose the folder `D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE` and pick **Opus 5.5** in the model menu.
4. **Say to Claude:** "set up this PC from docs/runbooks/new-pc.md". The lead then does steps 5 to 7, asking you only to sign in where a browser window opens.
5. **The lead downloads and builds** (keep the same folder path, so the memory folder name below stays the same):
   - `git config --global core.longpaths true`
   - `git clone https://github.com/techaust/techaust_platform.git` into the folder above
   - in the repo: `git config user.name "TecHaust Technologies"` and `git config user.email admin@techaust.com`
   - `npm install -g pnpm@12.9.1` (owner's go-ahead is this page), then `pnpm install`, `pnpm dev:secrets`, `pnpm db:migrate:local`, `pnpm db:seed:local`
   - `node tools/mcp-local-off.mjs` (keeps the cloud-only browser server off on the PC)
   - the Playwright browser for the visual checks
   - `pnpm check` and `pnpm test` once, through `bash tools/heavy.sh`, to prove the setup
6. **The lead restores the memory notes:** copy every file in [new-pc-memory/](new-pc-memory/) to `%USERPROFILE%\.claude\projects\D--BUSINESS-1--PARENT-PROJECT-TECHAUST-TECHNOLOGIES-WEBSITE-techaust-platform\memory\`. The two trimmed lines (an outside AWS account number, the revenue target and marketing budget) are not needed for the work.
7. **Sign-ins** (owner clicks, the lead starts each one): `gh auth login` (GitHub), `pnpm exec wrangler login` (Cloudflare), and the app's plugins listed in `.claude/settings.json` (Cloudflare, GitHub, Playwright, Context7, frontend-design). Turn the AWS, Supabase and Upstash servers off again for this project (they were off on the old PC; AWS waits until it is signed in to the TecHaust account). No Worker or GitHub secret is entered again.
8. **Carry on:** a new conversation, "start the day". The lead reads `docs/12-status.md` and continues from "Next".

## Keep in mind

- The copy in `new-pc-memory/` is a snapshot. After the restore, the live notes are the ones in the user folder; `docs/12-status.md` and `docs/13-decisions.md` stay the source of truth.
- The repo is public: nothing from `CREDENTIALS`, no keys, no client data ever goes into it.
