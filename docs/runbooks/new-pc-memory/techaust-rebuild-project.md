---
name: techaust-rebuild-project
description: "TecHaust website+admin+portal rebuild: folders, phase/approval workflow, ground rules, status snapshot (M1.5–M2.4b approved; M2.5 built 2026-10-23, awaits owner NVDA + approval) + tooling lessons"
metadata:
  node_type: memory
  type: project
  originSessionId: 8623b5fa-bc1b-4e6c-93b9-287cca6c6b74
  modified: 2026-11-04T10:02:24.490Z
---

Rebuilding techaust.com from scratch: public site + admin backend + client portal. Started 2026-10-06.

- **Root (since the PC was formatted, 2026-11-04):** `D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform`; setup steps in docs/runbooks/new-pc.md.
- **Repo:** `techaust/techaust_platform`. It's **PUBLIC** (owner decision; may go private later), so commit nothing sensitive and keep workflows fork-safe. `main` is protected: branch → PR → `gh pr merge --auto --squash` (merges itself on green, owner rule 2026-10-07) → staging auto-deploys.
- **Old site** (READ-ONLY, never modify or build there): the GitHub repo `techaust/techaust-web` (no longer on the PC). The live Worker is **`techaust-web`**: never deploy to, rename or delete it (except its deletion at Phase 7 L8 with the owner's go-ahead). Never read the `Credentials` folder (`D:\Business\1. Parent Project\TecHaust Technologies\Credentials`).
- **Workflow:** milestones are approved on staging (they merge on green), and the next milestone waits for "approved". See [[working-with-owner]]. Ask with AskUserQuestion (≤ 4 questions, recommended option first). Tag GST/DPDP/legal items "VERIFY WITH CA/LEGAL". Payments sandbox-only. Free plan only. No fabricated content.

**Why:** strict owner brief (7 phases, never guess, approvals per milestone).
**How to apply:** read docs/12-status.md and docs/13-decisions.md (the status is no longer in CLAUDE.md), see [[record-and-daily-sessions]]. The status below is a snapshot and may be stale.

**Status (2026-10-23, snapshot; docs/12-status.md is the source of truth):**
- Phases 1–5, M1.1–M1.3 approved; wallpapers (#15) and the social media kit for 12 platforms + bios (#17, docs/07-content-appendix/B-social-profiles.md) merged.
- M1.4 accepted, M1.5 (staff auth) and M1.6 (portal auth) approved 2026-10-21/22, M2.1 site shell approved 2026-10-22. Skills mandatory (rule 13). Both audits merged (#36, #38); docs matched to built auth (#41).
- M2.2 home + services approved on staging 2026-10-22 (#42–#44): prices only via catalogue helper/tokens, content lint, FAQs drafted by the lead from approved facts and owner-approved (07-C). M2.3 other pages approved on staging 2026-10-23 (#47, #48): placeholders for headshot/bio/address block production via scripts/check-prod-readiness.mjs. M2.4 forms + SES emails approved 2026-10-23 (#50). CPU tuning done (#53, #55): owner accepted a 9 ms first lead after deploys as a watch item. M2.4b (portal link email, staff security emails, Turnstile on sign-in) approved 2026-10-23 (#61, #62); staff email sends 8 ms accepted with a CPU follow-up before launch. Owner inputs live: postal address, founder LinkedIn (About only; footer = company links only). Headshot on hold (new iPhone photo coming). M2.5 built and on staging 2026-10-23 (#66), awaits the owner's NVDA pass and approval; CPU tuning 3 merged (#69), staging test waits for the owner. Owner withdrew an overnight M3+M4 batch plan the same evening (PR #70 left open, auto-merge off): ask the owner's new plan before starting M3.1. Lesson: a reviewer started with a checkout step runs its code-review skill fork before checking out, so it reviews main; tell reviewers to check out first. Lesson: Node benchmarks miss workerd start-up rules (Request, Response, AbortSignal.timeout, getRandomValues refused at global scope; Web Crypto allowed): check warm-ups in workerd.
- Owner said no Claude mods/dashboards for now (2026-10-17).
- **Lessons:**
  - Worktree removal that works (2026-10-21): `cmd /c rd /s /q "\\?\<full literal path>"` run 2–3 times (no variables; the PowerShell tool blocks `Remove-Item \\?\…`), then `git worktree prune` and `git branch -d worktree-agent-*`. A stale lock names a pid; if the pid is gone and the tree is clean, removing it is safe.
  - Worked 2026-10-22: after `git worktree remove --force` fails on long paths, the PowerShell tool's `Remove-Item -LiteralPath '\\?\<full path>' -Recurse -Force` (in try/catch) deletes the folder; then `git worktree prune` and `git branch -D worktree-agent-*`. Agents check out the task branch in their worktree with `git checkout -B <branch> origin/<branch>`, so the lead must not have that branch checked out.
  - Agent worktrees live in `.claude/worktrees/`; `git worktree remove` fails with "Filename too long" (node_modules) — use `git -c core.longpaths=true worktree remove --force`, then delete the folder with PowerShell `Remove-Item -LiteralPath "\\?\<full path>" -Recurse -Force`.
  - 2026-10-23: a reviewer agent left `wrangler dev` (node + workerd) running from its worktree, which locked the folder; find it with Get-CimInstance Win32_Process (CommandLine contains the worktree path), stop those PIDs, then delete. Agents now push their own branch (`fix/<task>-…`) from origin/<task branch>; two parallel agents both append to the run file, so the lead resolves by keeping both sections. A squash-merged docs PR on main conflicts with the same commits still on a task branch: keep the branch side. `pnpm test` fails on a stale apps/web/dist; rebuild web first. After a GitHub incident, the push CI on main started ~15 min late (wait, do not force a deploy).
  - Auto-merge merges as soon as the first CI run is green: commits pushed after that are left on the branch (PR #33 lost two). Finish all commits before `gh pr merge --auto`, or open a new PR for the rest.
  - YAML: a step `name:` containing ": " breaks the whole workflow (GitHub runs no checks, so Auto-fix never wakes): avoid colons in step names.
  - Agents read `.claude/agents/*.md` when a session starts; tool changes there (e.g. adding Skill) reach agents only after the change is on disk before the agent starts (later in the same session it worked).
  - Python on Windows writes CRLF unless `open(..., newline="\n")`; use that for repo edits.
  - Python heredoc edits with `assert` stop the whole edit on one mismatch; check before committing.
  - Cloudflare's dashboard changes often: verify click paths against developers.cloudflare.com before giving them; the per-Worker **Access** tab replaced "Enable Cloudflare Access" in Domains; never use the account-level "Protect all Workers" card (would lock the live `techaust-web`).
  - 2026-10-23: Astro scoped styles don't reach markup rendered by a child component: moving links into ExternalLink.astro broke the footer/About layout (owner spotted the misaligned arrow). Style child-rendered elements with `:global()` and open the page in a browser for every style-affecting web change.
  - 2026-10-23: owner-supplied text that ends up in a public run file (e.g. a personal Gmail) stays out of docs; staging test accounts are fine in D1.
  - Platform image sizes: LinkedIn's official company cover is 1512×256 (some search results wrongly say 4200×700); flat-tone PNGs can fall under minimum file sizes (Google Business 10 KB).
