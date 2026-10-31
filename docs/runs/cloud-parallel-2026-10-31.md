# Run: five tasks in parallel cloud sessions (2026-10-31)
Status: running (restarted 2026-10-31 ~13:00 IST from the main session)
Tier: by task (below)
Usage: lead claude-opus-5-5/high (this plan, the five starts, #126; `node tools/model-audit.mjs`); no agent ran. 5-h 3 % at the start.

**Owner's request (2026-10-31):** start every pending task at once in cloud sessions; the local session is the main session that controls them all.

**Owner's answers (2026-10-31, for 13 at the end of the day):** all five tasks start now; the main session starts the sessions; **at most 2 agents at once per cloud session** (instead of docs/14's 5, today's parallel run); questions come through the main session via each run file.

**Started (2026-10-31, ~12:00 IST, environment `techaust_platform`, from `main` a5f9f929):** task ids `task_d95e89ac` (t12-retag), `task_be050590` (t6-terms), `task_8a478052` (proforma-withdraw), `task_b33963ec` (t7-erasure), `task_389a53d0` (m6-1-ledger). Each prompt below was sent with the shared rules filled in.

## Which tasks, and why only these five
Pending and unblocked today (docs/12-status.md "Next"):

| # | Session name | Task | Tier | Branch | Copy file (if new copy) | Migrations? |
|---|---|---|---|---|---|---|
| 1 | `t12-retag` | T12: retag settled `OPEN (08-C …)` comments, rewrite 08-C §5 | C | `chore/t12-retag-open` | none | no |
| 2 | `t6-terms` | T6: MCIA check, then offer wording, proposal terms v4, website Terms 0.2 (07-ZE) | B/C | `feat/t6-terms-offers` | none (07-ZE approved) | maybe (seed) |
| 3 | `proforma-withdraw` | Withdraw a proforma the client has seen | A | `feat/proforma-withdraw` | 07-ZF | likely |
| 4 | `t7-erasure` | T7: erasure in never-accepted offers | A | `feat/t7-offer-erasure` | 07-ZG | likely |
| 5 | `m6-1-ledger` | M6.1: ledger and manual payments, T8 (TDS), the third admin Worker plan, an L9 recommendation | A (milestone) | `feat/m6.1-ledger-payments` | 07-ZH | yes |

**Not started, and why:** T5 (needs the owner's AWS), T11 (needs M6.1's "fully paid"), M6.2–M6.4 (need the gateway test keys and the L9 decision), M6.5 and M7 (come after M6.1–M6.4 in the build order; milestone approval rule).

## How the main session controls them
- **Starts** each session in the cloud environment `techaust_platform`, from `main`, on Opus 5.5 at high (checked after the start).
- **Usage:** all sessions share one 5-hour window. The main session reads it and sends each session `USAGE <pct> at <ISO time>` (e.g. `USAGE 3 at 2026-10-31T11:54+05:30`); a session passes the latest one to `node tools/agent-slots.mjs --cloud --reading … --reading-at …` (it never edits or commits `usage-reading.md`, so five branches don't conflict on one line).
- **Watching:** cloud sessions can't message back. Each pushes its branch and run file often; the main session runs `git fetch` and reads the run files (status line, questions, findings) when the owner asks "check the cloud sessions" and at each step it takes.
- **Owner questions:** collected from the run files into one AskUserQuestion batch here; answers go back to each session as a message.
- **PRs:** each session opens its PR with `tools/cloud-pr.sh`. The main session binds it, turns on Auto-fix, and turns on auto-merge **in this order only**: 1 → 2 → 3 → 4 → 5. Before each next one, that branch takes `main` in (unapplied migrations renumbered per CLAUDE.md "migration order"), sent to its own session as a message.
- **Record:** only the main session edits `docs/12-status.md`, `docs/13-decisions.md`, `CHANGELOG.md`, `CLAUDE.md` and memory, from the run files' "Lead decisions" and "Follow-ups" sections.
- **Staging:** M6.1 is a milestone: the owner approves it on staging before M6.2 starts.

---

## Shared rules (pasted at the top of every prompt)

```text
You are the TASK LEAD for ONE task of the TecHaust rebuild, running as a cloud session. A MAIN SESSION on the owner's PC controls five parallel cloud sessions: it relays the owner's answers, posts usage readings, turns on auto-merge and Auto-fix, and alone keeps the record. You do the whole task inside this session with your own agents.

START
1. The SessionStart hook's note must not say "MODEL IS …, NOT Opus 5.5". If it does, stop and say so in one line.
2. Run `bash scripts/cloud-check.sh`. Any FAIL: stop and report the whole output.
3. Read CLAUDE.md (all rules apply, including "In a cloud session"), docs/12-status.md, docs/13-decisions.md (never re-ask a decided question), docs/14-models-and-usage.md §2–§5 and §9, docs/runs/README.md, docs/runbooks/cloud-sessions.md ("What runs where"), and the files named in YOUR TASK below.
4. Load every skill that fits (docs/14 §9). Every agent you start loads its own fitting skills too.
5. Create your branch (named in YOUR TASK) from origin/main and push it. Create your run file docs/runs/<name>.md (docs/runs/README.md format) with a "Status:" line at the top that you keep current (e.g. "Status: builder running", "Status: WAITING ON OWNER (Q1, Q2)", "Status: PR READY <url>"). Commit and push it now.

AGENTS AND USAGE
- Order inside the task (CLAUDE.md): Tier A: analyst drafts the brief, you write the final brief in the run file; builder (Tier A: stops after schema, migrations, core logic and API for the analyst's early check) → Tiers A and B: analyst early check (GO/CHANGE) → designer (screens, its own screenshots) → reviewer (code + visual) → fixes → re-check (a second review after any critical or high finding).
- At most 2 agents at once in this session, at most 1 using a browser (TECHAUST_PORT_OFFSET=0). Every agent on Opus 5.5 at high; never Sonnet, Haiku, Fable, Explore, Plan, general-purpose or claude agents.
- Before EVERY agent start run `node tools/agent-slots.mjs --cloud --running <n> --browsers <n> [--browser] --reading <pct> --reading-at <ISO time>` with the newest "USAGE <pct> at <ISO time>" message from the main session (first reading: USAGE 3 at 2026-10-31T11:54+05:30). Never edit or commit docs/runs/usage-reading.md. "start: no" means wait; running agents keep going.
- Each builder or designer works in its own worktree on a sub-branch made from origin/<your branch> (e.g. fix/<name>-r1); you merge it into your branch. Record each agent's model and effort from `node tools/model-audit.mjs` in the run file's "Usage:" line; check it before every review.
- Heavy commands only through `bash tools/heavy.sh --log <name> <command>`.

LIMITS
- Never deploy, never touch staging, production, Cloudflare, AWS, DNS, GitHub settings or secrets. Never push to main, never merge a PR, never turn on auto-merge.
- Never edit docs/12-status.md, docs/13-decisions.md, CHANGELOG.md, CLAUDE.md or memory. Put your decisions in the run file under "Lead decisions (for 13)" and leftovers under "Follow-ups (for 12)"; the main session copies them.
- Workflow files (.github/workflows/*) need the owner's yes: ask, don't change.
- Migrations: number yours after main's newest. Another parallel branch may take the same number; the main session tells you when to renumber. List every migration you add in the run file.
- Worker budgets on main: admin API 618,422 bytes (plan line 650,000), jobs 984,266 of 1,000,000. Write your branch's numbers in the run file. If your task would take jobs over 1,000,000 or the admin API over 650,000, stop and ask (M6.1 handles the admin split itself).
- Commit identity: TecHaust Technologies <admin@techaust.com> (repo-local). Conventional commits with PRD IDs. End every commit message with: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>. Commit and push at least every 20 minutes and at each finished layer.

QUESTIONS FOR THE OWNER
- Do NOT use AskUserQuestion here. Write each question in the run file under "Questions for the owner" as multiple choice, the recommended option first and marked "(Recommended)", with plain-English context. New user-facing wording goes word for word into the copy file named in YOUR TASK as numbered lines with your recommendation; it counts as a question. Until approved, a new line shows "[Placeholder]" in code.
- Set "Status: WAITING ON OWNER (…)", commit, push, and KEEP WORKING on everything the question doesn't block. Only when nothing else can move, end your turn with the first line "WAITING ON OWNER: <session name>".
- The owner's answers arrive as messages from the main session; record each answer in the run file with the date.

FINISH
- Done = review APPROVE, every critical/high/medium/low finding fixed or kept with a reason, re-check passed, then `bash tools/heavy.sh --log check pnpm check` and `bash tools/heavy.sh --log test pnpm test` green on your branch tip (state the exact numbers).
- Open the PR: `bash tools/cloud-pr.sh --title "<conventional title with PRD IDs>" --body-file <file>`; the body says what changed, what ran and passed, what wasn't verified, the migrations and the Worker bytes, and ends with: 🤖 Generated with [Claude Code](https://claude.com/claude-code)
- Set "Status: PR READY <url>", push, and end your turn with the first line "PR READY: <url>" and a five-line summary. Stay open: the main session may send merge, renumbering or CI fixes, which you do on the same branch.
- Stop every dev server you started before you end a turn.
```

---

## Prompt 1: `t12-retag` (Tier C)

```text
<SHARED RULES>

YOUR TASK: T12, retag the settled OPEN comments and rewrite 08-C §5.
- Session name: t12-retag. Branch: chore/t12-retag-open. Run file: docs/runs/t12-retag-open.md. Copy file: none.
- Read: docs/08-research-appendix/C-research-register.md (all of it), docs/runs/settle-08c.md (the T-list and which items are settled), packages/core/test/verify-tags.test.ts.
- Do: every code comment `OPEN (08-C <ID>): …` whose register item is now settled becomes `Researched <date>, <source> (08-C <ID>)` or `Settled by the lead on the safest reading, <date> (08-C <ID>)`, exactly as the register row says; items still OPEN keep their tag and question. Then rewrite 08-C §5 so it matches the register as it stands. Comments and docs only: no logic, no copy, no tests changed except where the tag test needs it.
- Agents: one builder for the code comments (with a table in the run file: file:line, ID, old tag, new tag); you do the register yourself; then one reviewer (no screens).
- This task merges FIRST; keep it small and finish fast. Touch only the comment lines and 08-C (other sessions are editing code nearby).
```

## Prompt 2: `t6-terms` (Tier B/C)

```text
<SHARED RULES>

YOUR TASK: T6, the offer wording, proposal terms v4 and website Terms 0.2 (all wording owner-approved in 07-ZE).
- Session name: t6-terms. Branch: feat/t6-terms-offers. Run file: docs/runs/t6-terms-offers.md. Copy file: none (07-ZE is approved; any line it lacks is a question).
- Read: docs/07-content-appendix/ZE-terms-offers-deed.md (the 20 lines and Q1–Q4), 08-C rows RB-23, RB-35, RB-38, docs/runs/settle-08c.md (T6), docs/07-content-appendix/O-*.md (terms versions), packages/db/src/seed/index.ts (`nextProposalTermsSelect`), apps/web/src/content/legal-pages.ts and legal.ts, the portal offer files (apps/portal/worker/offer-*.ts, offers.ts) and packages/pdf/src/layout/copy.ts.
- STEP 1 FIRST, before any build: the MCIA check (07-ZE Q2, 08-C RB-38(c)). From MCIA's own published sources only: (a) the current fee schedule (record the amounts for a small claim), (b) whether the MCIA Rules let the parties choose Kolkata as the seat. Record both in the RB-38(c) row with "Researched 2026-10-31, <source URL and section>". If either fails, or the sources are unclear, write the question for line 12 under "Questions for the owner" and build everything else while you wait.
- STEP 2: brief in the run file, then builder: proposal terms v4 as a new seeded version that follows only the seeded predecessor by id and hash (the existing pattern); the offer wording ("(IST)", "replaces version N", acceptance only by the button, consumer carve-outs) in portal, emails and PDF as 07-ZE places it; website Terms 0.2 with its version line, effective date literal and Changes section. Delivery 0.2 (07-ZE line 16) is NOT published: it waits for T11. Sent documents keep their pinned terms.
- Then the analyst early check (Tier B), the designer for any screen the wording changes (portal offer view, the website legal pages), the reviewer with a live visual review.
- Watch the jobs Worker bytes (984,266 of 1,000,000): PDF copy goes into jobs.
```

## Prompt 3: `proforma-withdraw` (Tier A)

```text
<SHARED RULES>

YOUR TASK: let staff withdraw a proforma the client has already seen.
- Session name: proforma-withdraw. Branch: feat/proforma-withdraw. Run file: docs/runs/proforma-withdraw.md. Copy file: docs/07-content-appendix/ZF-proforma-withdraw.md (new).
- The owner's decision (docs/13-decisions.md, 2026-10-30): staff may take back a delivered proforma that has no payment and no invoice made from it, with a reason; it stays in the records (never deleted); the client sees it as withdrawn. It replaces "it stays until converted". Keep the separate rule that a viewed tax or export invoice can never be voided (08-C RA-10, trigger 0053): withdrawing is for proformas only.
- Read: docs/runs/m5.2-invoice-types.md (proformas), docs/runs/final-sweep.md (the proforma void dialog), packages/core/src/invoices.ts, packages/db/src/issue.ts, the invoice triggers (0038, 0053), apps/admin/worker/invoice-*.ts, apps/portal/worker/invoices.ts and invoice-summary.ts, the permissions matrix (packages/core/src/permissions.ts; who may withdraw is a question if docs/04 §9 doesn't settle it).
- Tier A: the analyst drafts the brief (status flow, every guard in core + route + the statement's WHERE + a trigger, audit row, the portal view, emails if any, what happens to links and reminders, the 08-C basis: a proforma is not a GST invoice). Builder stops after schema, migrations, core and API for the analyst's early check; then the designer (admin dialog and banner, portal view), reviewer, fixes, re-check.
- New wording (dialog, banner, portal lines, any email) goes to 07-ZF as numbered lines for the owner; build with "[Placeholder]" meanwhile; the PR opens only after the owner approves 07-ZF.
```

## Prompt 4: `t7-erasure` (Tier A)

```text
<SHARED RULES>

YOUR TASK: T7, erase a person's data in the frozen copies of never-accepted offers.
- Session name: t7-erasure. Branch: feat/t7-offer-erasure. Run file: docs/runs/t7-offer-erasure.md. Copy file: docs/07-content-appendix/ZG-offer-erasure.md (new, only if new wording is needed).
- The rule (08-C RB-37(a), settled): on an erasure request, erase the person's data in the frozen copy of every proposal or estimate that was never accepted; keep the number, status, dates and hash. Accepted offers and every invoice-family document are untouched (financial records). Due before 13 May 2027 (DPDP).
- Read: 08-C RB-37 and the DPDP rows, docs/runs/settle-08c.md (T7), apps/admin/worker/clients.ts (the owner-only export and erase/anonymise), apps/admin/worker/anonymised.ts, the frozen-document and append-only triggers (packages/db/src/triggers.ts), the snapshot and hash code (packages/db/src/documents.ts, issue.ts), the redacted view of an anonymised client in the M4.3 notes of CLAUDE.md, the PDFs in DOCS (write-once R2: say what happens to a stored PDF of such an offer).
- Tier A: the analyst drafts the brief (exactly which columns and snapshot fields, how the frozen-row triggers allow only this one guarded change, how the kept hash stays explainable, the audit row, how the export and the portal behave afterwards). Builder stops after schema, migrations, core and API for the analyst's early check; designer only if a screen changes; reviewer; fixes; re-check.
```

## Prompt 5: `m6-1-ledger` (Tier A, milestone)

```text
<SHARED RULES>

YOUR TASK: milestone M6.1, the ledger and manual payments (sandbox only), with T8 and the third admin Worker plan.
- Session name: m6-1-ledger. Branch: feat/m6.1-ledger-payments. Run file: docs/runs/m6.1-ledger-payments.md. Copy file: docs/07-content-appendix/ZH-m6.1-payments.md (new).
- Scope (docs/09-roadmap.md M6.1; docs/04-prd.md ADM-PAY-01, -05, -06, ADM-INV-16): the provider interface (no gateway code: Razorpay, Stripe and PayPal are M6.2–M6.4), ledger maths, manual entry, Staff → pending verification → Owner confirms, overpayment credits, the TDS line; T8 (08-C RA-30): the client picks section and rate, the certificate's amount is recorded, invoice and GST stay at full value. Also the M6.1 follow-ups in docs/12-status.md (FEMA extensions Q60, the receipts post-condition, refunds/payment register/"collected" figures where M6.1 owns them; leave M6.5's parts listed). PAYMENTS_LIVE_ALLOWED stays false; nothing is ever marked paid on a redirect.
- Read: docs/05-architecture.md (payments, ledger), docs/08-security-compliance.md, 08-C RA-30 and the payment rows, docs/runs/m5.0-admin-split.md (how the split was done), docs/runs/m5.2-invoice-types.md (advance receipts: the only place M5 writes paid amounts), docs/runs/rt2-signature-udyam.md "L9", scripts/worker-budget.mjs.
- FIRST, the analyst writes two plans in the run file before the brief: (1) the third admin Worker (the admin API is at 618,422; plan before 650,000): which routes move, configs, the deploy order; if M6.1 would cross 650,000 the split is built first in this task. Any change to .github/workflows is a question for the owner. (2) An L9 recommendation for the main session (jobs `minify: true` measured, a separate payment-webhook Worker, or a measured ceiling), to decide before M6.2; not built here.
- Tier A order: analyst brief → builder (stops for the early check) → designer (payment screens in admin; preview screenshots of the new screens go in the run file for the owner) → reviewer → fixes → re-check. Ledger property tests (fast-check), verification workflow per role, money only in bigint minor units (add new money modules to no-floats.test.ts).
- This branch merges LAST of the five; it will take main in before its review when the main session says so. M6.1 is a milestone: after it merges the owner approves it on staging.
```

---

## Integration notes (lead, 2026-10-31)
- The owner started all five task cards (~12:00 IST). **Every one stopped in the environment's setup script:** `[setup] FAILED: node -v says v24.22.1, not v24.22.2`. No branch, run file or agent exists for any of them.
- Cause and fix: [cloud-1-sessions, integration note](cloud-1-sessions.md) (#126: Node in `/opt/techaust-node`).
- This file is now the **template** for parallel task sessions ([runbook Part 4](../runbooks/cloud-sessions.md); CLAUDE.md "In a cloud session").

## Handover (lead, 2026-10-31)
Where it stands: the plan, the shared rules and the five prompts above are final and approved by the owner (all five tasks; the main session starts them; 2 agents per session; questions through the main session). None of the sessions got past setup.

Next, in order:
1. #126 merges (auto-merge on).
2. The owner pastes the new `scripts/cloud-setup.sh` from `main` into the `techaust_platform` environment (runbook Part 2, step 6) and archives the five failed sessions.
3. "Start the day" on the PC: read usage, then start the five sessions again with `start_session` (target cloud, environment `techaust_platform`), each prompt = the shared rules + its task, as above, with the day's first `USAGE <pct> at <ISO time>` in place of the 2026-10-31 reading. Check that each passes setup and runs on Opus 5.5 (its first `git push` and run file show on GitHub).
4. Then control them as Part 4 says: "check the cloud sessions" → read run files → one question batch → answers by message; merge order T12 → T6 → proforma withdraw → T7 → M6.1.

## Restart (main session, 2026-10-31 ~13:00 IST)
- **Correction to the integration note above:** two of the first five sessions got past setup by hand (they moved the image's `/opt/node24` aside) and pushed work: `t6-terms` (the MCIA check in 08-C RB-38, the brief, Q1 and Q2) and `proforma-withdraw` (the run file only). The other three pushed nothing.
- #126 merged; the owner pasted the new setup script and archived the first five sessions.
- Restarted with the shared rules and the prompts above (first reading `USAGE 8 at 2026-10-31T12:58+05:30`): task ids `task_ed913c4d` (t12-retag), `task_f2e11d4c` (t6-terms, continues its branch), `task_e9d1f5f0` (proforma-withdraw, continues its branch), `task_37313f60` (t7-erasure), `task_949683ff` (m6-1-ledger). Each prompt also names the files it shares with the others (08-C §5 only in T12; separate migrations and new trigger names for proforma and T7; admin API bytes add up).
- **Owner's answers sent to t6-terms with its prompt:** Q1 A (keep MCIA, Kolkata), Q2 A (the admin box; labels "Client accepted by email?" and "Copy reply" approved).
- **Check-ins:** a session-only schedule in the main session every 30 minutes (:13 and :43) reads the run files, answers what the record settles, re-prompts a session silent for 40+ minutes, and brings the owner one batch of questions.

## Orchestrator log (main session)
| Time (IST) | Session | Question or event | Answer or action | Basis |
|---|---|---|---|---|
| 2026-10-31 13:00 | t6-terms | Q1, Q2 | Owner: A, A (sent in the prompt) | 13-decisions |
| 2026-10-31 13:18 | proforma-withdraw | Q1–Q4 (who withdraws, email, client view, 07-ZF) | Owner: A, A, A, A (sent) | AskUserQuestion |
| 2026-10-31 13:20 | main session | the watcher (one-minute GitHub poll of the task branches' Status lines) replaces the 30-minute poll; the heartbeat only re-arms it and sends usage | Owner's concern about lost time |
| 2026-10-31 13:30 | t7-erasure | Q1 (an open offer at anonymise), 07-ZG lines 1–3 | Owner: A, approved (sent) | AskUserQuestion |
| 2026-10-31 13:40 | m6-1-ledger | Q1 (deploy step, workflow change), Q2 (step-up for payments), Q3 (07-ZH) | Owner: A, A, A (sent) | AskUserQuestion |
| 2026-10-31 13:45 | t12-retag | PR #129 | SEND BACK: RB-23, RB-35, RB-38(c) retagged as settled though 07-ZE keeps them OPEN; branch behind main | 07-ZE line 42, 08-C RB-23 |
| 2026-10-31 13:55 | t12-retag | PR #129 fixed | Re-checked; auto-merge on; merged | |
| 2026-10-31 14:15 | t6-terms | T12 merged | Take main in; keep T12's tags | merge order |
| 2026-10-31 14:20 | t7-erasure | Q2 (audit label, 07-ZG line 4) | Owner: A (sent) | AskUserQuestion |
| 2026-10-31 15:15 | t6-terms | PR #130 (ready since ~14:42; the watcher missed it: it marked a push seen before reading it, fixed) | Reviewed (APPROVE, CI green, no migration or workflow change, jobs 985,956); merged | |
| 2026-10-31 15:15 | proforma-withdraw | T6 merged | Take main in after the current fixes | merge order |
| 2026-10-31 15:40 | main session | MCIA re-check on the PC | 08-C RB-38 corrected (2017 schedule, no halving, plus taxes) | mcia.org.in |
