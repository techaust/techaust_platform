# CPU tuning 3: staff security emails and portal `/magic`

```
Status: merged; staging test waits for the owner
Tier: B (Workers, queues; docs/14 §2)
Usage: builder claude-sonnet-5-5 / medium (workers-profiling, workers-best-practices, wrangler, turnstile-spin), 17 min,
  212k tokens · reviewer claude-opus-5-5 / high (code-review, security-review, workers-best-practices, workers-profiling), 11 min,
  125k tokens · re-check reviewer claude-opus-5-5 / medium (code-review, workers-best-practices), 4 min, 54k tokens: weekly 39 → 39 %, 5-h 24 → 27 % (model audit: all runs within the plan)
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

## Builder report (Step 1, Sonnet 5.5, 2026-10-23)

**Skills loaded:** `cloudflare:workers-profiling` (per-step timing in a fresh process, then a profile; no hosted capture), `cloudflare:workers-best-practices` (no env or secrets at top level, async work handled, no refused global-scope calls), `cloudflare:wrangler` (local config reading only; no deploy, no `wrangler dev`), `cloudflare:turnstile-spin` (siteverify rules only: `verifyTurnstile` already checks success, action, hostname, token length and fails closed; unchanged; the wizard was not run). Context7 not needed.

**Files changed:** `packages/auth/src/warm.ts` (new `warmPortalAuth`), `packages/auth/src/index.ts` (one export line), `packages/auth/test/warm.test.ts`, `apps/portal/worker/index.ts` (`void warmPortalAuth()` at module top level), `apps/portal/worker/warm.test.ts`. No new package, no `wrangler.jsonc` change, no change to `apps/jobs` or `packages/email`: the email consumer has no fix to make on this evidence (below).

**Method.** Same as rounds 1 and 2: a step harness in `.logs/perf/` (git-ignored) bundles the real modules with workerd-style esbuild settings and times each step in a fresh Node process, first message after the module warm-up and a 100 ms idle ("cold"), the second, and the 51st ("warm"). Medians of 15 fresh processes for `/magic`. Added this round: a **workerd** probe, a temporary vitest file in `apps/jobs/test/` (deleted, not committed). In the local workerd the clock moves in whole milliseconds, so it is coarse but real V8 and workerd; D1 and fetch are stubbed or absent, so it shows JS CPU only. Not available: workerd's own CPU time per invocation (only Workers Logs on staging), the real TLS connection to SES, D1's JS-side cost.

**Staff emails vs the magic-link email (the gap).**

| Message, first in a fresh isolate, JS only | Node total, ms | workerd probe, total ms (5 runs, cold) |
|---|---|---|
| portal.magic_link | 2.2 | 2, 1, 4, 15 (outlier), 2 |
| staff.new_device | 3.8 (1.07 ms of it logId noise) | 2, 2, 4, 1, 1 |
| staff.2fa_change | 2.4 | 3, 4, 15 (outlier), 1, 2 |
| staff.lockout | 2.5 | 4, 1, 1, 1, 2 |
| staff.lockout_owner | 2.6 | not run |
| any of them, warm (51st) | 0.3 to 0.45 | 0 to 1 |

Cold per step (Node, all five templates alike): parse 0.1 to 0.3, `emailLogId` 0.2, `transportFor` 0.1, `renderEmail` 0.05 to 0.1, sign (the real key derivation with the real secret) 1.6 to 1.9, response 0.2. **No template-specific cost exists.** The staff templates render in 0.05 to 0.1 ms cold, the HTML sizes are alike, the warm-up already renders every branch real data reaches (the extra `role` field only picks one of two strings), and the staff and magic-link emails take the same code in `processEmail` except one `if` for the magic link's expiry. So the staging gap (8 ms against 4 ms) is **not in the code the two messages differ in**; the workerd probe shows the same 1 to 4 ms of JS for both. What the staging numbers can still contain, which nothing local can show, in order of plausibility:
1. **The isolate's first SES connection (TLS) and the first signature of the UTC day.** Staff emails come minutes apart, from new sign-ins, so each lands in an isolate that has not just sent an email; the magic link was measured right after other emails. The day's signing key (about 1.7 ms) cannot be warmed because it needs the secret, and `fetch` is refused at start-up.
2. The queue invocation's own overhead (message deserialising, four sequential D1 calls: INSERT OR IGNORE, claim, suppression SELECT, status UPDATE), the same for both.

This is a hypothesis, not a finding: only another staging reading (two staff emails and a magic link back to back, then the same set after an idle period) separates cold from warm.

**Portal `/magic`: found and fixed.** Cold cost of each piece in a fresh process (Node, ms): first zod parse of `magicRequest` 3.7 to 3.9, first HMAC (import of the pepper plus sign) 1.2 to 1.5, `addressOf` 0.2 to 0.3 (regex build), `res.json` 0.3, `newToken` 0.2, the rest under 0.15. Separately, **the first run of the Hono pipeline costs about 3 ms in Node** (a bare `GET /api/v1/health` cold: 3.1 to 3.6 ms, then 0.6): `secureHeaders`, `csrf`, `bodyLimit`, `guard`, `sValidator` and the exit log line are compiled on first use. **Fix (one commit):** `warmPortalAuth()` in `packages/auth/src/warm.ts`, started from the portal's module top level. It parses one made-up body through `magicRequest`, `magicVerifyRequest` and `docTokenRequest`, runs `addressOf` (IPv4 and IPv6) and `readPortalCookie`, the three counter-key HMACs with a made-up 32-byte key (the HMAC key cache is keyed by secret, so this adds one dummy entry and never touches the real pepper) and one SHA-256. It never reads `env`, uses none of `getRandomValues`, `new Request`, `new Response`, `fetch` or timers (workerd refuses them in the global scope, so `newToken` cannot be warmed), swallows every error, and returns the number of steps that worked (9). Tests: auth package (9 steps; none of the refused calls used, nothing logged; no throw when Web Crypto fails) and portal in workerd (9 steps).

**Not fixed, and why.** The Hono pipeline's 3 ms cannot be warmed from the global scope without a `Request` and a `Response`, which workerd refuses there. Running the app on a fake request that throws at the first `Response` would compile part of it, but risks a start-up log line and is fragile, so I did not do it. Left as is: the real pepper's HMAC import (needs the secret), the siteverify `fetch` (I/O), `newToken` (`getRandomValues`).

**Before / after (Node, ms, `/magic`, first request in a fresh isolate, median of 15 fresh processes; the ranges are wide on this PC)**

| | before | after |
|---|---|---|
| first, run 1 | 11.6 (min 9.9) | 8.5 (min 6.2) |
| first, run 2 (repeat) | 10.6 (min 7.1) | 9.2 (min 7.9) |
| second | 2.1 to 5 | 1.4 to 2.4 |
| warm | about 0.5 | about 0.4 |

The `batch(5)` step (counter-key HMACs and the reserve SQL) dropped from 1.7 to 0.75; the rest of the gain is zod. Node over-states workerd (staging's first `/magic` was 6 to 8 ms against Node's 10 to 12 before the change), so the expected staging first request is about 4 to 6 ms; **a reading of the first `/magic` in a fresh isolate on staging decides**. Warm `/magic` was never the problem (0.4 ms in Node). Email consumer: unchanged, so no before/after.

**Commands:** `pnpm --filter @techaust/auth test` exit 0 (126); `pnpm --filter @techaust/portal test` exit 0 (424, workerd); `pnpm check` exit 0; `pnpm test` exit 0; `pnpm build` exit 0; `pnpm lint` exit 0 (6 existing infos). `biome check` on the changed files: clean. Dev servers: none started.

**Not verified:**
- Real workerd CPU per invocation (`cpuTimeMs`); every figure is Node or the coarse workerd JS probe.
- That `warmPortalAuth` (Web Crypto at start-up) runs in the real global scope: the unit tests simulate the refused calls; the same pattern is proven for the SES warm-up by round 2's reviewer, and the function swallows a refusal anyway. `wrangler check startup` was not run.
- Whether the first TLS connection to SES is what makes the staff emails 8 ms (hypothesis 1).
- D1's JS-side cost per call.

**Open questions for the lead:**
1. **The staff email 8 ms is not explained by any code difference I can find.** If staging still shows more than 7 ms after this change, the next steps, smallest first: (a) read cold and warm staff emails separately on staging (two sends right after an idle period, two in a row) to separate isolate/connection coldness from per-message cost; (b) one `db.batch([INSERT OR IGNORE, claim UPDATE])` in `processEmail` instead of two awaits (same semantics, one D1 call fewer; its CPU is unmeasurable locally). If cold-connection cost is the cause, no code change fixes it on the Free plan: that is the design-change case you asked me to report (options then: accept 8 ms, under the 10 ms limit, for rare cold emails and set the target for them separately, or a Paid-plan proposal).
2. `/step-up` and `/totp` untouched (out of scope).

## Review (reviewer Opus 5.5 high, 2026-10-23): APPROVE
`b716896` against `main`. Checks (heavy.sh): `pnpm check`, `pnpm test` (auth 126, portal 424, all green), `pnpm build` (portal bundle 57,521 bytes, admin 83,983) green. Security: the made-up key can't reach the real pepper's cached key, counters or responses; nothing logged; no call refused at start-up; can't throw or reject.

| # | Sev | Finding | Where |
|---|---|---|---|
| 1 | Low | `btoa(...)` at module top level can't be tree-shaken: a dead call in the admin bundle (and likely web) | `packages/auth/src/warm.ts:13` |
| 2 | Low | No test fails if the entry stops running the warm-up | `apps/portal/worker/warm.test.ts`, `index.ts:20` |
| 3 | Low | Comments state the start-up effect as fact; only local workerd shows it | `index.ts:18-19`, `warm.ts:2-4` |

**The staff-email 8 ms (reviewer's assessment):** the builder's TLS hypothesis is very unlikely (`cpuTimeMs` excludes waiting on subrequests, and the magic-link send uses the same `fetch`); batching is ruled out (`max_batch_size: 1`); start-up billed to the first event is ruled out (first jobs invocations measured 4 ms). Most plausible: isolate coldness in what no start-up warm-up can reach (the real SigV4 key derivation, the first `Request`/`fetch`/`Response` handling, the D1 wrapper's first use, the queue glue); whole-millisecond rounding may make "8" about 7.5. The M2.4b samples can't tell cold from warm: jobs log lines carry no isolate marker. **Recommended next step:** add the portal's `iso`/`n` to the jobs log lines and read `cpuTimeMs` with `n` on staging; if the `n=1` sends are the 8 ms ones, the candidate change is deriving the SES signing key during the `staff.alert` expansion (a hypothesis until measured); the `email_log` batch idea is low value. Also: the portal SPA calls `/me` first, so `/magic` is usually `n=2`; read `n` for `/magic` too.

## Lead fixes after the review (2026-10-23)
- 1: the key is a base64 literal (the admin build no longer contains the string). 2: `apps/portal/worker/warm.ts` exports `portalWarm`; the entry imports it for its side effect; the test awaits it in workerd and scans the entry's source for the import. 3: comments reworded ("shown in local workerd; confirmed on staging").
- The reviewer's next step, done here: jobs `logEvent` lines carry `iso` (random per isolate, made at the first invocation) and `n` (this isolate's invocation count, counted at the start of `handleQueue`); a test checks the keys, a stable `iso` and a growing `n`. No personal data.
- Checks (heavy.sh, main checkout): `pnpm test` green (jobs 60, portal 425, all packages); `pnpm check` green; `pnpm build` green (portal 57,527 bytes, admin 83,942).
- Next: re-check (reviewer, Opus medium) of this fix diff, then the PR, staging, and Step 3 with the owner (read `cpuTimeMs` with `n`).

## Re-check (reviewer Opus 5.5 medium, 2026-10-23): APPROVE
`b716896..4ba0174`: the three lows fixed; `iso`/`n` carry no personal data, `getRandomValues` runs only inside an invocation (the warm-up test proves it never logs), fields can't overwrite callers' keys and are absent outside queue runs; existing log assertions hold. Checks: jobs 60, portal 425, auth 126, `pnpm check` green. One new **low**: nothing proved `handleQueue` calls `noteInvocation()`. **Lead fix:** the dead-letter handler test in `pipeline.test.ts` now finds the `queue.dead_letter` line and asserts its `iso` (6 hex) and `n` (≥ 1); jobs 60/60 and `pnpm check` green.

## Handover (lead, 2026-10-23, 21:45 IST)
Merged as [PR #69](https://github.com/techaust/techaust_platform/pull/69); its staging deploy follows `main`'s CI. **Next: Step 3 with the owner** (about 10 minutes): a sign-in to staging admin from a new browser (new-device email), one recovery code (2FA-change email), and a portal sign-in link. The lead reads each invocation's `cpuTimeMs` with `iso`/`n` from Workers Logs (read-only) and records them here. Pass: each staff send and `/magic` ≤ 7 ms. If cold (`n=1`) staff sends stay at 8 ms: try deriving the SES signing key during the `staff.alert` expansion, else bring the owner the options (accept 8 ms for rare cold sends, or a Paid-plan proposal).

## Step 3: staging reading (owner and lead, 2026-10-24, about 14:50 IST): NOT PASSED
The owner signed in to staging admin from an InPrivate window (authenticator code, not a recovery code: the owner had no codes), made new recovery codes (2FA-change email instead of "recovery code used") and requested a portal sign-in link; all three emails arrived. Read-only Workers Logs, `cpuTimeMs`:

| Invocation | Isolate `iso` / `n` | CPU ms | Pass (≤ 7) |
|---|---|---|---|
| jobs: `staff_alert.queued` new device | ad4972 / 1 | 2 | yes |
| jobs: send `staff.new_device` | ad4972 / 2 | 4 | yes (was 8) |
| jobs: `staff_alert.queued` 2FA change | d143c0 / 1 | 4 | yes |
| jobs: send `staff.2fa_change` | d143c0 / 2 | **11** | **no** (over the 10 ms Free limit; outcome ok) |
| jobs: send `portal.magic_link` | ad4972 / 3 | 2 | yes |
| portal `/magic` (first) | a7d5a2 / 1 | 5 | yes |
| portal `/magic` (second) | b8bc8e / 2 | **8** | **no** |
| admin `/login`, `/salt`, `/step-up`, `/recovery/regenerate` | 0694f7 | 2–5 | yes |
| admin `/totp` | 0694f7 / 3 | 8 | out of scope (later round) |

Reading: a warm isolate's staff send is now 4 ms, but the first send in a fresh jobs isolate (d143c0, whose only earlier work was the alert expansion) took 11 ms: the cold-send case predicted in the handover (first SES TLS and the day's signing key). Portal `/magic` was 5 ms cold and 8 ms on a second-request isolate, so the warm-up did not settle it. Single readings; CPU time on Workers varies by 1–3 ms between runs.

**Next (lead's proposal, owner decides):** the handover's candidate: derive the SES signing key during the `staff.alert` expansion (same isolate, one invocation earlier), and profile `/magic`'s second-request 8 ms; otherwise the owner's options (accept rare cold sends over 7 ms, or a Paid-plan proposal).
