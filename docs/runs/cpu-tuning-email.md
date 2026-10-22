# CPU tuning 2: the email consumer

```
Status: open
Tier: B (Workers, queues; docs/14 §2)
Usage: (filled by the lead from node tools/model-audit.mjs)
```

## Before the build (2026-10-23)
- **Owner (2026-10-23):** "tune the email consumer next, before M2.4b".
- **Why:** after PR #53 every form post and lead is 2–3 ms on staging, but one email took **9 ms** (target ≤ 7 ms, Free plan limit 10 ms). M2.4b adds more emails (magic link, staff security emails) through the same consumer. Background, method and the first round's results: [cpu-tuning.md](cpu-tuning.md) (Builder report, Staging result).
- **Staging after #53 (lead, Workers Logs):** emails 6, 3 (contact acknowledgement, alert) and 9, 6 (quote acknowledgement, alert), about a minute apart. Single samples: whether the 9 ms is a fresh isolate, the quote path or noise is not known. The leads consumer in the same isolates took 2–3 ms, so the email path's own per-message work is the suspect.

## Brief

**PRD IDs:** FRM-04 (behaviour unchanged); the Free plan rule (CLAUDE.md "Free plan").

**Branch:** `perf/email-cpu` (holds this brief). The builder creates `perf/email-cpu-builder` from `origin/perf/email-cpu` in its own worktree and pushes only that; the lead merges.

### Step 1: builder (Sonnet 5.5, medium)
**First step:** load `cloudflare:workers-profiling`, `cloudflare:workers-best-practices` and `cloudflare:wrangler`; also `aws-core:aws-messaging-and-streaming` (SES; read only, no AWS calls). List them in the report.

**Never touch hosted services:** no deploy, no tail, no hosted profiling, no AWS or Cloudflare API calls, no installs. Local only; the lead re-measures on staging.

**In scope:** `apps/jobs/src/{email,queue,warm}.ts`, `packages/email/src/*` (templates, headers, transport), and anything they import on the email path (`stableId`, `emailMessage`).

**How:**
1. **Profile one email message end to end**, cold (fresh process, after the module warm-up) and warm, for each of the four messages (contact and quote, acknowledgement and alert), with the round-one harness in `.logs/cpu-tuning/perf/` (copy it; git-ignored) or a better one. Break the time down by step: message parse, `emailLogId`, each D1 call's JS side (statement build, result handling), suppression and allow-list checks, `renderEmail` (HTML and text), the SES request (JSON body, SigV4: body hash, canonical request, signature), response handling. Note what Node can't show (D1 and fetch are I/O, not CPU; workerd's crypto differs).
2. **Also try a workerd measurement** if one is practical locally, e.g. `wrangler dev` with the DevTools profiler on a local queue message, or `wrangler check startup` for start-up. Say what worked.
3. **Fix the largest per-message costs, smallest change first.** Candidates to check against the evidence, not to apply blindly: work the warm-up doesn't yet cover (the SES transport's first signature, `crypto.subtle.importKey`, the first `fetch` set-up), repeated escaping or string building in templates, `transportFor(env)` rebuilt per message, JSON built twice, regex compiled per call.
4. **Measure again**; before/after per message, cold and warm.

**Rules:** as round one ([cpu-tuning.md](cpu-tuning.md) Step 1 rules): behaviour, email bytes, logs and statuses unchanged; existing tests pass unchanged; tests for new code; no new packages; no secrets at module top level (the warm-up must never use `env`); heavy commands via `bash tools/heavy.sh`; commit every 20 minutes; whole-repo lint once at the end. Stop and report if the evidence says ≤ 7 ms needs a design change.

**Checks:** `pnpm check`, `pnpm test`, `pnpm build`.

**Done:** commit, push `perf/email-cpu-builder`, append "Builder report" (skills; files; method; per-step breakdown; before/after; not verified; open questions), stop any dev server, stop.

### Step 2: review and merge
Reviewer (Opus 5.5, high; `code-review`, `cloudflare:workers-best-practices`), fixes, re-check at medium, PR with auto-merge and Auto-fix, staging deploy. **On staging:** the owner sends two quote requests and one contact, a few minutes apart; the lead reads every email's `cpuTimeMs`. **Pass:** every email ≤ 7 ms.

## Out of scope
| Item | Owner |
|---|---|
| New templates (magic link, staff security) | M2.4b |
| SES bounce events | M7.2 |
