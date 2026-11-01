# Run: parallel cloud sessions, 2026-11-01

Status: open (polish-sweep #144 merging; test-hardening #143, ca-wording #142, m63-m64-briefs #141 merged)
Tier: mixed (C, B, C, A planning)
Usage: four cloud sessions plus the PC's agents shared one 5-hour window: 14 % at 02:05 IST → 62 % at 03:21 → 88 % at 04:00 → limit at ~04:30; reset 06:10.

The owner (2026-11-01, ~02:00 IST) asked the PC main session to open cloud sessions for the pending work it could control. Only work that skips no milestone, needs no migration and no hosted change qualified: the follow-up backlog (polish sweep, test hardening), the "ask your CA" wording, and the M6.3/M6.4 briefs (planning only). M6.2 and T11 stayed on the PC. Sessions start only from a message typed in the desktop app (not over Remote Control).

## Shared rules (each prompt began with these)
```text
You are the TASK LEAD for ONE task of the TecHaust rebuild, running as a cloud session. A MAIN SESSION on the owner's PC controls four parallel cloud sessions (and runs T11 and M6.2 on the PC itself): it relays the owner's answers, posts usage readings, turns on auto-merge and Auto-fix, and alone keeps the record. You do the whole task inside this session with your own agents.

START
1. The SessionStart hook's note must not say "MODEL IS …, NOT Opus 5.5". If it does, stop and say so in one line.
2. Run `bash scripts/cloud-check.sh`. Any FAIL: stop and report the whole output.
3. Read CLAUDE.md (all rules apply, including "In a cloud session"), docs/12-status.md, docs/13-decisions.md (never re-ask a decided question), docs/14-models-and-usage.md §2–§5 and §9, docs/runs/README.md, docs/runbooks/cloud-sessions.md ("What runs where"), and the files named in YOUR TASK below.
4. Load every skill that fits (docs/14 §9). Every agent you start loads its own fitting skills too.
5. Create your branch (named in YOUR TASK) from origin/main and push it. Create your run file docs/runs/<name>.md (docs/runs/README.md format) with a "Status:" line at the top that you keep current (e.g. "Status: builder running", "Status: WAITING ON OWNER (Q1, Q2)", "Status: PR READY <url>"). Commit and push it now.

AGENTS AND USAGE
- Order inside the task (CLAUDE.md): Tier A: analyst drafts the brief, you write the final brief in the run file; builder (Tier A: stops after schema, migrations, core logic and API for the analyst's early check) → Tiers A and B: analyst early check (GO/CHANGE) → designer (screens, its own screenshots) → reviewer (code + visual) → fixes → re-check (a second review after any critical or high finding).
- At most 2 agents at once in this session, at most 1 using a browser (TECHAUST_PORT_OFFSET=0). Every agent on Opus 5.5 at high; never Sonnet, Haiku, Fable, Explore, Plan, general-purpose or claude agents.
- Before EVERY agent start run `node tools/agent-slots.mjs --cloud --running <n> --browsers <n> [--browser] --reading <pct> --reading-at <ISO time>` with the newest "USAGE <pct> at <ISO time>" message from the main session (first reading: USAGE 14 at 2026-11-01T02:05+05:30). Never edit or commit docs/runs/usage-reading.md. "start: no" means wait; running agents keep going.
- Each builder or designer works in its own worktree on a sub-branch made from origin/<your branch> (e.g. fix/<name>-r1); you merge it into your branch. Record each agent's model and effort from `node tools/model-audit.mjs` in the run file's "Usage:" line; check it before every review.
- Heavy commands only through `bash tools/heavy.sh --log <name> <command>`.

LIMITS
- Never deploy, never touch staging, production, Cloudflare, AWS, DNS, GitHub settings or secrets. Never push to main, never merge a PR, never turn on auto-merge.
- Never edit docs/12-status.md, docs/13-decisions.md, CHANGELOG.md, CLAUDE.md or memory. Put your decisions in the run file under "Lead decisions (for 13)" and leftovers under "Follow-ups (for 12)"; the main session copies them.
- Workflow files (.github/workflows/*) need the owner's yes: ask, don't change.
- **No database migrations in this run.** The PC is building T11 (migrations 0061–0062) and M6.2 (0063–0064). If your task turns out to need a migration, stop that item, record it under "Follow-ups (for 12)" and carry on with the rest.
- Worker budgets on main (2026-11-01): admin front 100,839, admin API 438,052 (plan line 650,000), admin finance 507,872 (plan line 650,000), portal 104,589 (ceiling 120,000), jobs 667,870 (ceiling 1,000,000). Write your branch's numbers in the run file.
- Commit identity: TecHaust Technologies <admin@techaust.com> (repo-local). Conventional commits with PRD IDs. End every commit message with: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>. Commit and push at least every 20 minutes and at each finished layer.

QUESTIONS FOR THE OWNER
- Do NOT use AskUserQuestion here. Write each question in the run file under "Questions for the owner" as multiple choice, the recommended option first and marked "(Recommended)", with plain-English context. New user-facing wording goes word for word into the copy file named in YOUR TASK as numbered lines with your recommendation; it counts as a question. Until approved, a new line shows "[Placeholder]" in code.
- Set "Status: WAITING ON OWNER (…)", commit, push, and KEEP WORKING on everything the question doesn't block. Only when nothing else can move, end your turn with the first line "WAITING ON OWNER: <session name>".
- The owner's answers arrive as messages from the main session; record each answer in the run file with the date.

FINISH
- Done = review APPROVE, every critical/high/medium/low finding fixed or kept with a reason, re-check passed, then `bash tools/heavy.sh --log check pnpm check` and `bash tools/heavy.sh --log test pnpm test` green on your branch tip (state the exact numbers). (A docs-only task: the reviewer's APPROVE and `pnpm check` are enough.)
- Before opening the PR, merge origin/main into your branch and re-run the checks.
- Open the PR: `bash tools/cloud-pr.sh --title "<conventional title with PRD IDs>" --body-file <file>`; the body says what changed, what ran and passed, what wasn't verified and the Worker bytes, and ends with: 🤖 Generated with [Claude Code](https://claude.com/claude-code)
- Set "Status: PR READY <url>", push, and end your turn with the first line "PR READY: <url>" and a five-line summary. Stay open: the main session may send merge or CI fixes, which you do on the same branch.
- Stop every dev server you started before you end a turn.
```

## Tasks
## Task 1: `polish-sweep` (Tier C)
YOUR TASK: the admin and website polish sweep (follow-ups from earlier reviews, listed in docs/12-status.md "Open follow-ups").
- Session name: polish-sweep. Branch: fix/polish-sweep. Run file: docs/runs/polish-sweep.md. Copy file: docs/07-content-appendix/ZL-polish-sweep.md (only if a new user-facing line is needed; staff-only lines are approved by the main session under the owner's delegation, client-facing ones by the owner).
- Items (check each still exists on main first; drop any already fixed, saying so):
  1. Final sweep (docs/runs/final-sweep.md): the week grid's "1 h 45 min" wraps at 1280 with the menu open; the activity feed's label for a credit or debit note issue; same-name people in the Time Entries table (tell them apart by email, as `apps/admin/src/lib/people.ts` does elsewhere); the website focus outline is 1.6 px against docs/06's 2 px.
  2. rt1 (docs/runs/rt1-notes-rules.md follow-ups 4, 5): show known blockers on a dialog's confirm step before step-up; the draft row's 44 px inline link line gap.
  3. rt2 (docs/runs/rt2-signature-udyam.md): the invoice issue dialog's wrong-code notice and one shared `invalid_code` helper; the `Field` scroll effect key; the save bar after a "No change" save.
  4. The admin bell's "9+" accessible name (axe finding since #78).
  5. T7 (docs/runs/t7-offer-erasure.md): after an anonymise the Emails row shows "Not sent"; the dialog title scrolls away.
  6. M2.5: `zod/mini` on the website's /contact and /get-a-quote pages (about 20 KB gzipped saved), if it needs no shared-schema change.
- Agents: one designer (screens; `frontend-design` loaded; before/after screenshots both themes, 1280 and 390; axe on each changed screen), a builder only if an item needs logic; then one reviewer (code + visual).
- Other work nearby: the PC session is building T11 (project page deed panel, portal deed section) and M6.2 (invoice payments panel, portal Pay now). Don't restyle those areas; keep changes local to the items.

## Task 2: `test-hardening` (Tier B)
YOUR TASK: test and guard hardening (follow-ups from docs/12-status.md).
- Session name: test-hardening. Branch: fix/test-hardening. Run file: docs/runs/test-hardening.md. Copy file: none (no user-facing wording changes).
- Items (check each still exists on main first):
  1. Flaky tests: web e2e `apps/web/e2e/forms.spec.ts:37` "the contact form is reachable and submittable by keyboard" (40 s `waitForURL` timeout once on main); admin `leads-api.test.ts` "a stale page is a 409 stale_version" (same-millisecond saves; strictly increasing `updated_at` in the test, not a production change unless the reviewer agrees it's a real bug).
  2. A longer timeout or a faster setup for the M5.4 test "each send names the staff member…" in `apps/admin/worker/invoice-send.test.ts`; also the 5 s timeouts seen today in `apps/admin/worker/dashboard-stress.test.ts` and `apps/portal/worker/scope.test.ts` under a full parallel run.
  3. Export the realisation bounds (1,200 / 36,500) from `@techaust/core` instead of three copies (M5.5b re-check low 4).
  4. rt2: one shared must-be-signed list (core, used by admin, db SQL builders and jobs); inner spaces in a pasted Udyam number; the duplicate PNG builder in `apps/admin/e2e/sample-data.ts`.
  5. Verify, against main, the code-review candidates nobody checked: the 10 M5.4 candidates (docs/runs/m5-batch.md or the M5.4 run file: the helper reviewed main by mistake) and the T6 candidates (`packages/pdf/src/view.ts:212`, `apps/admin/src/lib/offers.ts:151`, `send-parts.tsx:112`). For each: real or not, with evidence; fix the real ones if small and in scope, else list them.
  6. M4.5: one shared list of the 07-N §3 decline reasons in `@techaust/core` (now copied in admin, portal and jobs).
- Agents: one builder, then the analyst's early check (Tier B), then one reviewer (no screens unless an item changes one).
- Other work nearby: the PC session's M6.2 builder is editing `packages/core/src/payments.ts`, `razorpay.ts`, `online-pay.ts`, `permissions.ts` and `packages/db` ledger and issue builders; T11 touches `packages/db/src/deeds.ts`, `triggers.ts`, `issue.ts`. Avoid those files; if an item needs one, list it as a follow-up.

## Task 3: `ca-wording` (Tier C)
YOUR TASK: replace the screen and page lines that send the owner to "your CA" or "your CA and lawyer". The owner has no CA or lawyer (owner, 2026-10-30; CLAUDE.md rule 8), so these lines mislead. Follow-up from T12 (docs/runs/t12-retag-open.md).
- Session name: ca-wording. Branch: fix/ca-wording. Run file: docs/runs/ca-wording.md. Copy file: docs/07-content-appendix/ZK-ca-wording.md.
- Known places (grep the whole repo for "CA", "chartered accountant", "your CA", "lawyer", "legal adviser" in user-facing text to find the rest): admin `apps/admin/src/lib/reports.ts` (~91 — the GST exports intro "Check them with your CA before you file." the owner saw today — ~224, ~229, ~243, ~256, ~473); `apps/admin/worker/settings.ts:131-133`, `:634`; `apps/admin/src/api.ts:81`; `apps/admin/src/components/form.tsx:262`; web `apps/web/src/content/legal-pages.ts:3`; the tests that pin them; 08-C header lines 7 and 9 (the tag list and the stale CA/lawyer line).
- Do: 1) list every line found (file:line, current text, who sees it: staff or client); 2) draft a replacement for each as numbered lines in 07-ZK with your recommendation — plain, honest, no advice the owner can't follow, no banned phrases (docs/07 §1.3), never claiming a professional checked anything; where a line points at an OPEN register item, it may say the figure should be checked before filing, without naming a profession; 3) put the questions in the run file and set WAITING ON OWNER; the main session brings them to the owner as one page; 4) once approved, a builder changes the lines and their tests word for word (comments and code tags that mention a CA as "a one-off professional opinion would still be wise" in 08-C stay — that's the register, not screen text).
- Agents: you draft the copy yourself (or with one analyst); one builder for the change; one reviewer (visual check of the changed screens: designer screenshots not needed unless layout changes).
- Owner-approved copy earlier (07-V, 07-ZA, …) is being replaced: say so in the copy file, line by line.

## Task 4: `m63-m64-briefs` (Tier A planning; docs only)
YOUR TASK: draft the briefs for M6.3 Stripe (test mode) and M6.4 PayPal (sandbox), ready for when M6.2 is approved. **Planning only: no code, no migrations, no configs.** The owner chose to prepare these early (2026-11-01); building them waits for M6.2's approval on staging.
- Session name: m63-m64-briefs. Branch: docs/m63-m64-briefs. Run files: docs/runs/m6.3-stripe.md and docs/runs/m6.4-paypal.md. Copy file: none yet (draft client lines go in each run file as numbered lines, marked for the owner).
- Read: the M6.2 brief on its branch (`git show origin/feat/m6.2-razorpay:docs/runs/m6.2-razorpay.md`; its provider interface, `checkout_sessions`, `webhook_events`, `review_items`, the jobs hook pattern, the finance RPC entrypoints, the held-PR rule, the hosted owner steps); `docs/runs/m6.1-ledger-payments.md`; docs/04 ADM-PAY-01, -03, -04, -06, -07, -11, -12, JOB-HOOK-01..03, POR-06; docs/09-roadmap.md rows M6.3, M6.4; docs/05 payments; 08-C (RB-01, RB-07, FEMA/FIRC/FIRA, export realisation, EDF); docs/13 rows on payments, Stripe (the owner's existing verified Stripe account for the same business; Stripe India invite-only) and L9; docs/runbooks/payment-gateways.md.
- Do, with an analyst agent drafting each brief and you finalising: the same sections as the M6.2 brief (order and agents, data, core, finance Worker, jobs, portal, config/secrets/scripts and hosted owner steps with click-by-click text, screens, copy, tests, Free-plan bytes, done means, out of scope, tax and legal rules with 08-C tags, lead decisions, risks). Stripe: Checkout Session (USD), `constructEventAsync` on the raw body with the 5-minute tolerance, the restricted key's permissions list, the webhook acting only on TecHaust-created sessions (the account is shared with another business: metadata and a check in SQL), the statement-descriptor check, the FIRC attachment flow. PayPal: Orders v2 create → approve → server capture → webhook verify-signature postback; the FIRA archive. Assume M6.2 lands as briefed; mark anything that depends on M6.2's final code as "check against M6.2 at build time". Migration numbers: "after M6.2's".
- Questions for the owner (multiple choice, recommendation first): the Stripe account facts (its legal name, PAN and GSTIN must be TecHaust's: if they're not, what then), anything the record doesn't decide. Never guess a tax or legal rule; OPEN items stay OPEN.
- Agents: one analyst per brief (they can run together: 2 agents), then one reviewer reading both briefs against the record. `pnpm check` only (docs).

## Orchestrator log (main session)
| Time (IST) | Session | Event | Action |
|---|---|---|---|
| 02:45 | all | started from the desktop app | watcher (one-minute GitHub poll of Status lines, newest copy only), keep-awake |
| 02:55 | ca-wording | 07-ZK lines 1–13 | approved by the lead under the owner's delegation (lines 4, 5–7, 8, 10 checked against 08-C) |
| 02:55 | m63-m64-briefs | Stripe account facts | the owner's answer relayed (legal name, proprietor, personal PAN) |
| 03:10 | m63-m64-briefs | URGENT: 0063 too narrow for Stripe ids | accepted; recorded on feat/m6.2-razorpay before B2 |
| 03:21 | all | usage 62 % | readings sent |
| 03:45 | m63-m64-briefs | PR #141 (docs only, review APPROVE after a send-back) | auto-merge; merged |
| 03:55 | ca-wording | PR #142 (review APPROVE, 5 findings fixed, LUT case hidden per RA-18) | auto-merge; branch updated; merged |
| 04:00 | all | usage 88 % | no new agents until 06:10 |
| ~04:30 | main + PC agents | session limit | everything paused; the main session resumed 10:25 |
| 10:28 | test-hardening | PR #143 (review APPROVE, 9,522 tests green, no migration or workflow change) | auto-merge; merged |
| 10:28 | polish-sweep | PR #144 waiting on 07-ZL 1–3 | approved (staff lines); flip then auto-merge |

## Lessons
- The 5-hour window is the real limit of a parallel run: four cloud sessions plus two PC agents used ~75 % in two hours. Start right after a reset, run at most two cloud sessions beside the PC's agents, stop new agents at 85 %.
- When the main session itself hits the limit, nothing reviews or merges until a person types again: PRs #143 and #144 waited ~6 hours.
- A cloud session's planning work can catch irreversible schema choices early (the 0063 widths): worth running briefs ahead of builds.
