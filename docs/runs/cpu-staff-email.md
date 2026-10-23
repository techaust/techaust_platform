# CPU tuning 3: staff security emails and portal `/magic`

```
Status: open
Tier: B (Workers, queues; docs/14 §2)
Usage: (filled in per agent run from node tools/model-audit.mjs)
```

## Before the build (2026-10-23)
- **Owner (2026-10-23):** "Yes, start the staff-email CPU task on that plan" (row in 13): builder measures and fixes locally → review → PR → staging deploy → the owner triggers the emails → the lead reads `cpuTimeMs`.
- **Why:** M2.4b's staging test ([m2.4b-signin-email.md](m2.4b-signin-email.md) "Staging result") measured, all under the 10 ms Free plan limit but over the **7 ms target**:
  - **each staff email send (jobs email consumer): 8 ms**, three of three (new device, 2FA change, lockout), while the magic-link send in the same consumer was 4 ms
  - **portal `/magic`: 6–8 ms** (Turnstile siteverify, quotas, token insert, `waitUntil` queue send)
  - the rest for reference: `staff.alert` expansion 4–5 ms, `/magic/verify` 2 ms, admin `/login` 1–5 ms, `/totp` 3–6 ms, `/step-up` 4–9 ms (unchanged since M1.5, out of scope)
- **What's known:** every staff template and the user-agent reader are already rendered once at start-up (`apps/jobs/src/warm.ts`), so first-render compile cost is not the obvious cause. The difference between a staff email (8 ms) and a magic-link email (4 ms) through the same consumer is the lead's best clue.
- Earlier rounds and their method: [cpu-tuning.md](cpu-tuning.md), [cpu-tuning-email.md](cpu-tuning-email.md) (harness in `.logs/cpu-tuning/perf/`, git-ignored, if still present).

## Brief

**PRD IDs:** ADM-AUTH-09, ADM-MAIL-01, POR-01 (behaviour unchanged); the Free plan rule (CLAUDE.md "Free plan": target p99 CPU ≤ 7 ms).

**Branch:** `perf/staff-email-cpu` (holds this brief). The builder creates `perf/staff-email-cpu-builder` from `origin/perf/staff-email-cpu` in its own worktree and pushes only that; the lead merges.

### Step 1: builder (Sonnet 5.5, medium)
**First step:** load `cloudflare:workers-profiling`, `cloudflare:workers-best-practices` and `cloudflare:wrangler`; also `cloudflare:turnstile-spin` (siteverify rules only; never its wizard). List them in the report.

**Never touch hosted services:** no deploy, no tail, no hosted profiling, no AWS or Cloudflare API calls, no installs. Local only; the lead re-measures on staging.

**In scope:** the email consumer path in `apps/jobs/src/{email,queue,staff-alerts,warm}.ts`, `packages/email/src/*`, and what they import on that path; the portal `/magic` route in `apps/portal/worker/{auth,sender,guard,context}.ts` and `packages/auth/src/{portal,turnstile,attempts-sql,crypto,tokens}.ts`.

**How:**
1. **Profile, per message and per request, cold (fresh process after the warm-up) and warm:** each staff email (`staff.new_device`, `staff.2fa_change`, `staff.lockout`, `staff.lockout_owner`) against `portal.magic_link` through the email consumer, and portal `/magic`. Break it down by step: message parse, the `email_log` claim's JS side, suppression and allow-list checks, `renderEmail` (HTML and text), headers, the SES request (JSON body, SigV4), response handling; for `/magic`: body parse and zod, the Turnstile call's JS side, HMAC quota keys, the reserve SQL's JS side, token generation and hashing, the queue message build. Say what Node can't show (D1 and fetch are I/O; workerd's crypto differs). Try a workerd measurement locally if practical and say what worked.
2. **Explain the staff vs magic-link gap** with evidence (template size, escaping, extra lookups, data built per message, anything the warm-up doesn't cover such as a branch only real data reaches).
3. **Fix the largest per-message and per-request costs, smallest change first.** Candidates to test against the evidence, not to apply blindly: work repeated per message that could be built once per isolate; a warm-up that renders different branches than real data; repeated HMAC key imports (`crypto.subtle.importKey` per call) in the portal quotas; schemas built per request; strings built twice.
4. **Measure again**; before/after per message and per request, cold and warm.

**Rules:** behaviour, email bytes, response bodies, logs, statuses and audit rows unchanged; existing tests pass unchanged; tests for new code (and a warm-up test if the warm-up changes); no new packages; no secrets at module top level (a warm-up never uses `env`; a per-isolate key cache keyed by the secret's value is fine if it never logs it); heavy commands via `bash tools/heavy.sh`; commit every 20 minutes; whole-repo lint once at the end. **Stop and report if the evidence says ≤ 7 ms needs a design change** (the lead brings the options to the owner).

**Checks:** `pnpm check`, `pnpm test`, `pnpm build`.

**Done:** commit, push `perf/staff-email-cpu-builder`, append "Builder report" (skills; files; method; per-step breakdown; the staff vs magic-link explanation; before/after; not verified; open questions), stop any dev server, stop.

### Step 2: review and merge
Reviewer (Opus 5.5, high; `code-review`, `security-review` (the change touches sign-in code), `cloudflare:workers-best-practices`, `cloudflare:workers-profiling`), fixes, re-check at medium, PR with auto-merge and Auto-fix, staging deploy.

### Step 3: staging measurement (owner and lead)
The owner, about 10 minutes: sign in to staging admin from a new browser (new-device email), use one recovery code (2FA-change email), and request a portal sign-in link. The lead reads every invocation's `cpuTimeMs` from Workers Logs (read-only). **Pass:** each staff email send and `/magic` ≤ 7 ms, and nothing else above its M2.4b figure.

## Out of scope
| Item | Owner |
|---|---|
| `/step-up` (up to 9 ms since M1.5), `/totp` | a later CPU round if needed, or M3.1 |
| Workers Paid plan | a separate proposal, only if ≤ 7 ms needs a design change |
| Any copy or template wording | none (bytes unchanged) |
