# CPU tuning 4: the 2FA-change send and portal `/magic`

```
Status: brief written; builder next
Tier: B (Workers, queues; docs/14 §2)
Usage: (filled in after each run)
```

## Before the build (2026-10-24)
- **Owner (2026-10-24):** "Start a CPU tuning round now for the 2FA-change send and portal /magic; I'll do one more staging test after."
- **Why:** the staging reading of CPU tuning 3 ([cpu-staff-email.md](cpu-staff-email.md) "Step 3") missed the 7 ms target on two invocations; everything else passed:
  - **jobs: send `staff.2fa_change` 11 ms** (isolate `d143c0`, `n=2`; `n=1` was its `staff.alert` expansion, 4 ms). Over the 10 ms Free limit (outcome ok).
  - **portal `/magic` 8 ms** (isolate `b8bc8e`, `n=2`; `n=1` was a 401 `GET /me`, 2 ms). The earlier `/magic` in a fresh isolate (`a7d5a2`, `n=1`) was 5 ms.
  - for comparison: send `staff.new_device` 4 ms in the **same situation** (isolate `ad4972`, `n=2` after its expansion, also that isolate's first SES send); send `portal.magic_link` 2 ms.
- **Lead's clues (to test, not to assume):**
  1. The 2FA-change email today was `change: "recovery_codes_regenerated"` (the owner made new codes), while the start-up warm-up in `apps/jobs/src/warm.ts` renders `staff.2fa_change` only with `change: "recovery_code_used"`. A branch the warm-up never reaches (copy lookup, a different block) would compile on the first real send. Also check `reset_by_owner` and any other `change` values.
  2. Only one magic-link email was sent across the two `/magic` requests, so the 5 ms one was most likely an address with no account (nothing queued) and the 8 ms one an address with an account: token generation (`newToken`, which the warm-up cannot run), SHA-256, the token insert's JS side, the queue message and `waitUntil` send. The warm-up covers the schemas, address, cookie, HMAC keys and one digest, not the known-account branch.
  3. The cold SigV4 day key and first SES TLS cost about the same for `new_device` (4 ms in total), so they are probably not the whole 11 ms; the handover's idea (derive the SES signing key during the `staff.alert` expansion) is a fallback if 1 does not explain it.
- Earlier rounds and their method: [cpu-tuning.md](cpu-tuning.md), [cpu-tuning-email.md](cpu-tuning-email.md), [cpu-staff-email.md](cpu-staff-email.md) (harness in `.logs/cpu-tuning/perf/`, git-ignored, if still present).

## Brief

**PRD IDs:** ADM-AUTH-09, ADM-MAIL-01, POR-01 (behaviour unchanged); the Free plan rule (CLAUDE.md "Free plan": target p99 CPU ≤ 7 ms).

**Branch:** `perf/cpu-cold-send` (holds this brief). The builder creates `perf/cpu-cold-send-builder` from `origin/perf/cpu-cold-send` in its own worktree and pushes only that; the lead merges.

### Step 1: builder (Sonnet 5.5, medium)
**First step:** load `cloudflare:workers-profiling`, `cloudflare:workers-best-practices` and `cloudflare:wrangler`. List them in the report.

**Never touch hosted services:** no deploy, no tail, no hosted profiling, no AWS or Cloudflare API calls, no installs. Local only; the lead re-measures on staging.

**In scope:** `apps/jobs/src/{email,queue,staff-alerts,warm}.ts`, `packages/email/src/*` (templates and transport) and what they import on that path; `apps/portal/worker/{auth,sender,guard,context}.ts`, `packages/auth/src/{portal,warm,turnstile,attempts-sql,crypto,tokens}.ts`.

**How:**
1. **Test clue 1:** list every `change` value `staff.2fa_change` can carry and what each renders. Measure the first render of each value in a fresh process (and in local workerd if practical) after the current warm-up. If an unwarmed branch is costly, warm every value (or the shared code they reach) in `warmConsumers`, and update its count test.
2. **Test clue 2:** measure `/magic` cold and warm for an address **with** an account and one **without**, by step (zod, Turnstile JS side, quota keys, reserve SQL JS side, account lookup, `newToken`, hashing, insert, queue message build, `waitUntil`). Warm what can be warmed from the global scope (no `env`, no `getRandomValues`, no `Request`, no timers); remove work that repeats per request (key imports, strings built twice, schemas built per request).
3. **Only if 1 doesn't explain the 11 ms:** measure the cold SES path (signing key derivation, JSON body, signing) and try deriving the day's SES signing key into the shared `SIGNING_KEYS` map during the `staff.alert` expansion (it has `env`; same isolate in the staging reading). It must never log or expose the secret and must not send any request.
4. **Measure again:** before/after per message and per request, cold and warm.

**Rules:** behaviour, email bytes, response bodies, logs, statuses and audit rows unchanged; existing tests pass unchanged; tests for new code and for any warm-up change (counts); no new packages; no secrets at module top level (a warm-up never uses `env`); heavy commands via `bash tools/heavy.sh`; commit every 20 minutes; whole-repo lint once at the end. **Stop and report if the evidence says ≤ 7 ms needs a design change** (the lead brings the options to the owner).

**Checks:** `pnpm check`, `pnpm test`, `pnpm build`.

**Done:** commit, push `perf/cpu-cold-send-builder`, append "Builder report" (skills; files; method; per-step breakdown; what clues 1–3 turned out to be; before/after; not verified; open questions), stop any dev server, stop.

### Step 2: review and merge
Reviewer (Opus 5.5, high; `code-review`, `security-review` (sign-in code), `cloudflare:workers-best-practices`, `cloudflare:workers-profiling`), fixes, re-check at medium, PR with auto-merge and Auto-fix, staging deploy.

### Step 3: staging reading (owner and lead, about 10 minutes)
The owner signs in to staging admin from an InPrivate window (new-device email), makes new recovery codes (2FA-change email, `recovery_codes_regenerated`), and requests a portal sign-in link **for an address with an account**. The lead reads `cpuTimeMs` with `iso`/`n` (read-only). **Pass:** each staff send and `/magic` ≤ 7 ms, nothing else above its earlier figure.
