# CPU tuning 2: the email consumer

```
Status: open
Tier: B (Workers, queues; docs/14 §2)
Usage: builder claude-sonnet-5-5/medium (workers-profiling, workers-best-practices, wrangler,
  aws-messaging-and-streaming) · reviewer claude-opus-5-5/high (code-review, workers-best-practices, workers-profiling;
  helper general-purpose opus/high, allowed) · re-check reviewer claude-opus-5-5/medium (code-review,
  workers-best-practices; helper general-purpose opus/low, allowed): weekly 31 → 31 %, 5-h 5 → 8 % (model audit: all
  runs within the plan)
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

## Builder report (Step 1, Sonnet 5.5, 2026-10-23)

**Skills loaded:** `cloudflare:workers-profiling` (method: per-step timing, then a profile, smallest fix; no hosted capture), `cloudflare:workers-best-practices` (no module-level request state, no secrets at top level, async work fully handled), `cloudflare:wrangler` (checked `wrangler check startup`; see Not verified), `aws-core:aws-messaging-and-streaming` (read only; SES itself belongs to the `amazon-ses` skill, not needed for a CPU change; no AWS call made). Context7 not needed.

**Files changed:** `packages/email/src/transport.ts` (new `warmSesSigning`), `packages/email/test/email.test.ts`, `apps/jobs/src/warm.ts` (new `warmSes`), `apps/jobs/src/index.ts` (one call line), `apps/jobs/test/warm.test.ts`. No new package, no `wrangler.jsonc` change. Email bytes, logs and statuses unchanged.

**Method.** Node only (workerd CPU cannot be read locally). A step harness (`.logs/perf/steps.mjs`, git-ignored) bundles the real modules with wrangler-like esbuild settings, then times each step of one email in a fresh process: message parse, `emailLogId`, `transportFor`, `renderEmail`, "sign and build" (JSON body, `AbortSignal`, `Request`, SigV4: body digest, canonical request, key derivation, signature, up to the `fetch` call) and "fetch and response handling" (stub). First message cold (after round one's warm-up), second, and warm (51st). Then round one's queue harness (`bench-jobs.mjs`, with a 100 ms idle before the first message so start-up work can finish, as in a real isolate) and an inspector profile of the first message. D1 is a stub, so its JS-side cost and I/O are not measured.

**Per-step breakdown, first email in a fresh isolate, ms (Node; after round one's warm-up, before this change)**

| Step | ack | alert | warm (51st) |
|---|---|---|---|
| parse (zod) | 0.14 | 0.2 | 0.01 |
| emailLogId | 0.19 | 0.18 | 0.01 |
| transportFor | 0.10 | 0.11 | 0 |
| renderEmail | 0.03 | 0.07 | 0.01 to 0.03 |
| **sign and build (first SigV4)** | **6.6** | **4.5 to 7.4** | 0.25 to 0.34 |
| fetch and response | 0.18 | 0.19 | 0.03 |
| total | 7.2 | 5.6 | 0.4 |

Without any warm-up the first email's parse adds 2 to 4 ms and render 0.4 to 0.65 (total 10 to 13, the same as round one's baseline). **One cost dominates: the first SigV4 signature in an isolate** (first `crypto.subtle` use, the HMAC and digest paths, `Request` and header set-up, the JSON build). Everything else in the message is under 0.6 ms together. Round one's warm-up did not cover it, because it needs a transport and credentials. This fits staging's 9 ms (quote acknowledgement) and 6 ms (alert).

**Fix (one commit):** `warmSesSigning()` in `packages/email`, started from the jobs module top level (`void warmSes()`): it signs one made-up request (fixed dummy credentials, never `env`, its own key cache so the shared `SIGNING_KEYS` map is untouched, no `fetch`), swallows every error, resolves true when it signed. Tests: email package (signs, calls `subtle.sign`, never calls `fetch`, a real transport afterwards still derives its own key: exactly 5 `sign` calls) and jobs in workerd (`warmSes()` is true and `fetch` is not called).

**After (Node, ms, first email in a fresh isolate, 4 runs each)**

| | ack | alert |
|---|---|---|
| sign and build | 1.3 to 1.7 (was 6.6) | 1.3 to 1.5 (was 4.5 to 7.4) |
| first email, six steps together | 1.9 to 2.0, one run 3.9 (was 7.2) | 2.0 to 2.6 (was 5.6) |
| warm | about 0.4, unchanged | about 0.4, unchanged |

Through the whole queue path (`bench-jobs.mjs` with the 100 ms idle; includes `handleQueue`, stub D1 promises, `ack`, and Node-only undici/webstream first use): first message before 8.2 to 9.8 (alert) and 9.9 to 15.4 (ack); after 4.8 to 7.9 (alert) and 5.1 to 6.8 (ack); second message 2.3 to 3.4 before, 1.1 to 2.2 after; warm median 0.5 unchanged. The 1.3 to 1.7 ms left in "sign and build" is the real key derivation (4 HMACs with the real secret): it cannot be warmed without the secret and happens once per isolate per day.

**Not changed, and why:** D1 round trips (INSERT OR IGNORE, claim UPDATE, suppression SELECT, status UPDATE: four calls; a `db.batch()` of the first two keeps the semantics and saves one call, but its CPU cannot be measured locally and it changes the query shape: a candidate only if staging still shows more than 7 ms). `stableId`, template escaping, JSON, `transportFor` and regexes are each under 0.2 ms cold and about 0.01 ms warm.

**Commands:** `pnpm install --frozen-lockfile --prefer-offline`; `pnpm --filter @techaust/email test` exit 0 (22); `pnpm --filter @techaust/jobs test` exit 0 (32, workerd); `pnpm check` exit 0; `pnpm build` exit 0; `pnpm test` exit 0; `pnpm lint` exit 0 (6 existing infos).

**Not verified:**
- Real workerd CPU (all figures Node, relative). Expected on staging: the first email in an isolate no longer carries the 4 to 6 ms first-signature cost.
- **Whether `crypto.subtle` is allowed in workerd's global scope.** `warmSesSigning` catches every error, so a refusal makes the warm-up a no-op (returns false), never a failed start. The workerd unit test runs it in a request-like context, not the global scope. I tried `wrangler check startup` for this, but the permission classifier denied it; the lead should run `pnpm --filter @techaust/jobs exec wrangler check startup --env staging` locally (it also shows the start-up cost of the new call) and read the first email's `cpuTimeMs` on staging. If there is no gain, the fallback is to do the same signing lazily on the first lead message (which has 2 to 3 ms of room), not on the email.
- Whether the warm-up's remaining CPU is billed to the first invocation (same open question as round one).
- D1 cost per call.

**Open questions:** none blocking.

## Review (reviewer, Opus 5.5 high, 2026-10-23)
**SEND BACK** (1 high, 1 medium, 2 low). Skills: `code-review`, `cloudflare:workers-best-practices`, `cloudflare:workers-profiling`. `pnpm check` and `pnpm test` exit 0.

**Evidence (reviewer's probe in the repo's own workerd 1.20261001.1, scratch Worker, no repo files touched):** at module top level workerd refuses `AbortSignal.timeout`, `new Request`, `new Response` and `crypto.getRandomValues` ("Disallowed operation called within global scope"); `new Headers`, `new URL` and Web Crypto (`importKey`, `sign`, `digest`) are allowed. A floating crypto promise at top level finishes during start-up, before the first event (`Date.now()` still reads 0 when it resolves). The branch's `warmSesSigning` resolved `false` with 0 sign calls; a signer-only version resolved `true` with 5.

| # | Sev | Where | Finding | Triage |
|---|---|---|---|---|
| 1 | high | `packages/email/src/transport.ts` | `AbortSignal.timeout` (and `AwsClient.sign`'s `new Request`) throw at start-up, so the warm-up never signs | Fixed (lead): `AwsV4Signer(...).sign()` directly, no signal, no `Request` |
| 2 | medium | `apps/jobs/test/warm.test.ts`, `email.test.ts` | Tests run outside start-up rules, so they pass while production fails | Fixed: a test makes `Request`, `Response`, `fetch`, `setTimeout`, `AbortSignal.timeout` and `getRandomValues` throw and expects `true` with 5 sign calls (the old code fails it) |
| 3 | low | `email.test.ts` | "leaves the shared key map alone" never checked it | Fixed: the follow-up transport uses the warm-up's own credentials and region (`WARM_KEY_ID`, `WARM_SECRET`) and still needs 5 sign calls |
| 4 | low | `apps/jobs/src/index.ts` | Dropped result, pass-through wrapper | Fixed: wrapper removed, `void warmSesSigning()` called directly; the result is covered by finding 2's test |

`pnpm check` exit 0; `pnpm test` exit 0 (email 23, jobs 32, the rest unchanged).

## Re-check (reviewer, Opus 5.5 medium, 2026-10-23)
**APPROVE** on `e2e209d`: findings 1–4 fixed, nothing new. In the repo's workerd: the branch's real `warmSesSigning` bundled from `transport.ts` and called at module top level resolved `true` with 5 sign calls during start-up (the old code: `false`, 0); the whole jobs entry booted with the warm-up done before the first fetch, `/healthz` 200.

## Integration notes (lead, 2026-10-23)
- Builder branch fast-forwarded into `perf/email-cpu`, `main` (with #54) merged in before the review; builder worktree removed, harness kept in `.logs/cpu-tuning-email/perf/`.
- Review fixes by the lead (small, one area). `pnpm check` and `pnpm test` exit 0.
- **Process note:** the builder's `wrangler check startup` was refused by the permission classifier; the reviewer's Miniflare probe (local workerd) settled the start-up question instead. Node benchmarks don't apply workerd's start-up rules, so future warm-up work is checked in workerd (a start-up-rules test, as in `email.test.ts`).
- **Staging check:** the owner sends two quote requests and one contact, a few minutes apart; the lead reads every email's `cpuTimeMs`. Pass: every email ≤ 7 ms.
