# CPU tuning 4: the 2FA-change send and portal `/magic`

```
Status: re-check APPROVE; PR #72 (auto-merge), then the owner's staging reading
Tier: B (Workers, queues; docs/14 §2)
Usage: builder claude-sonnet-5-5 / medium (workers-profiling, workers-best-practices, wrangler), 11 min, 133k tokens ·
  reviewer claude-opus-5-5 / high (code-review, security-review, workers-best-practices, workers-profiling), 8 min, 96k tokens:
  weekly 40 → 40 %, 5-h 0 → 3 % (model audit: all runs within the plan)
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
The owner signs in to staging admin from an InPrivate window (new-device email), makes new recovery codes (2FA-change email, `recovery_codes_regenerated`), and requests a portal sign-in link **for an address with an account**. The lead reads `cpuTimeMs` with `iso`/`n` (read-only), **including each `staff.alert` expansion** (it now carries the SES prime). **Pass (restated after review M1):** each `staff.alert` expansion ≤ 7 ms, each staff send ≤ 7 ms and `/magic` ≤ 7 ms; everything else no higher than before. If the 2FA send is still over 7 ms, that is the brief's design-change stop: the lead brings the owner the options (next candidates: the three `email_log` D1 round trips, the response `text()`/`JSON.parse`). If an expansion goes over 7 ms, the cheaper prime (key derivation only, no `Request`) is the fallback.

## Builder report (2026-10-24, Sonnet 5.5, medium)
Usage: builder; model and effort to be taken from `node tools/model-audit.mjs` by the lead.

**Skills loaded:** `cloudflare:workers-profiling` (method only: no hosted profile; cold steps measured locally in a fresh Node process), `cloudflare:workers-best-practices` (warm-ups stay free of `env`, `Request` and random values at module scope; no secret logged), `cloudflare:wrangler` (config untouched; no binding or type change). Not loaded as not applicable: AWS skills (the SES path is plain aws4fetch), designer skills (no screens).

**Files:** `apps/jobs/src/{warm,staff-alerts}.ts`, `packages/email/src/transport.ts` (new `primeSesSigning`), `packages/auth/src/warm.ts`; tests `apps/jobs/test/{warm,m24b}.test.ts`, `packages/email/test/email.test.ts`, `packages/auth/test/warm.test.ts`, `apps/portal/worker/warm.test.ts`.

**Method:** fresh Node process (V8, like workerd), after the current warm-ups, `performance.now()` per step. Timers are coarse and runs vary by a few ms, so figures are indicative only. Local workerd gives no CPU time, so nothing here is a staging figure.

**Clue 1 (2FA change values): not the cause.** Values: `recovery_code_used`, `recovery_codes_regenerated`, `reset_by_owner` (anything else throws; jobs never queues one). The first render of any of them after the old warm-up costs 0.03 to 0.07 ms (0.1 ms with `role`). The old warm-up lacked two values and never passed `role` (the real alert data carries it and it picks the "Not you?" line). Fixed anyway because it is free: the warm-up renders all three with `role: "owner"` (renders 7 to 9, `warmConsumers()` count 12 to 14).

**Clue 3 (cold SES path): measured, explains about 3 to 4 ms, not 11.** First send in a process, network faked: key derivation 0.4 to 0.7 ms, first `new Request` about 1.8 ms, first sign 1.3 ms, 3 to 5 ms in total (second send under 1 ms). This matches `new_device` at 4 ms on staging. The old `warmSesSigning` uses its own cache and dummy credentials, so the real key is derived in the first real send. Change: `primeSesSigning(config)` signs a made-up `{}` body with the real credentials into the shared `SIGNING_KEYS` (no request sent, nothing logged, never throws), and `processStaffAlert` calls it before `sendBatch`, only when `EMAIL_TRANSPORT === "ses"`. This moves about 2 to 3 ms from the email send into the staff.alert expansion (same isolate in the staging reading), which measured 4 ms. Tests: 5 `crypto.subtle.sign` calls and no `fetch`, then the next real send signs once; the secret is not in the logs; it never throws.

**Clue 2 (portal `/magic`):** the known-address branch adds `newToken`, `tokenHash`, `new URL(request.url)`, the token insert, the queue message and `waitUntil`. JS-side first-call costs before the change: `newToken` 0.73 ms, `tokenHash` 0.18 ms, `URL` 1.7 ms; after: 0.16, 0.16, 0.02 ms (about 2.3 ms saved). `warmPortalAuth` now also runs the base64url encoder and `isToken` on a constant and parses a URL (steps 9 to 11; three count tests updated). The rest of the 5 ms to 8 ms gap (an extra D1 `INSERT` in the batch, `sendBatch` serialisation, `waitUntil`) is runtime and binding work that cannot be warmed from the global scope; not changed. I could not tell the with-account and without-account cases apart locally (no workerd CPU timer), so the clue stays a probable explanation, not a proven one.

**Not explained:** the 11 ms for `staff.2fa_change` against 4 ms for `new_device` in the same situation. Nothing in `email.ts`, the template or the transport differs between them, and no local step comes near 11 ms. It may have been a one-off (garbage collection, a slow D1 write). I am not claiming the change fixes it.

**Checks:** `pnpm check` exit 0; `pnpm build` exit 0; `pnpm test` exit 0 (portal 425, admin 489, jobs 61, auth 126, email 52 passed, none failed); whole-repo `pnpm lint` exit 0 (6 infos only). `pnpm install --frozen-lockfile --offline` was needed in the fresh worktree (lockfile only, no new packages). Throwaway measurement script in `.logs/cpu_m2.mjs` (git-ignored). No dev server was started.

**Not verified:** any staging figure; whether the 11 ms and the 8 ms drop to 7 ms or lower (Step 3). The priming adds 2 to 3 ms to the expansion, so its staging figure (4 ms before) must be read too. If the 2FA send still exceeds 7 ms, the next candidates are the three `email_log` D1 round trips per message and the response `text()` and `JSON.parse`; merging the claim and the insert would be a design change.

**Open questions:** none for the owner.

## Review (reviewer Opus 5.5 high, 2026-10-24): APPROVE
No critical or high. Checks on 21b6c34: email 52, auth 126, jobs 61, portal 425, `pnpm check` exit 0. `primeSesSigning` only signs (no `fetch`, no log, never throws), writes exactly the cache entry the first real send reads (aws4fetch 1.0.20 key `[secret, date, region, service]`), runs only with `EMAIL_TRANSPORT=ses`; warm-ups use no `env`, `getRandomValues`, `Request` or timers; behaviour and bytes unchanged.
- **M1** the prime moves 2–3 ms into the `staff.alert` expansion (4 ms on staging) and can bring the 11 ms send to about 8 ms at best; Step 3's "nothing above its earlier figure" fails by design.
- **L1** the send is not guaranteed to land in the same isolate (`max_concurrency: 2`).
- **L2** client and URL set-up duplicated between `sesTransport` and `primeSesSigning`.
- **L3** the 2FA warm-up renders only the owner's "Not you?" line.
- **L4** no test proves the prime is skipped with the `log` transport.
- **L5** `/magic` with/without account not separated locally; savings are Node first-call timings; the 11 ms stays unexplained.

## Lead triage and fixes (2026-10-24)
- **M1:** Step 3's pass rule restated above (expansion, send and `/magic` each ≤ 7 ms; the expansion read too); the prime stays as built, the cheaper prime is the fallback.
- **L1:** the comment in `staff-alerts.ts` says "usually this isolate" and names the `max_concurrency` limit; kept as a known limit.
- **L2:** one `sesClient(config)` and `sesUrl(region)` in `transport.ts`, used by both.
- **L3:** the warm-up also renders one member (`staff`) 2FA email; `warmConsumers` count 14 → 15.
- **L4:** new `m24b.test.ts` case: the `log` transport signs nothing during the expansion. The UTC-midnight flake of the exact sign count is kept (one run a day at worst, the test retries clean).
- **L5:** recorded as not verified; Step 3 uses a portal address that has an account.
- Checks: jobs 62/62, email 52/52, `pnpm check` exit 0; full `pnpm test` green (admin 489, jobs 62, portal 425, web 396, auth 126, core 360, db 53, email 52, ui 469).

## Re-check (reviewer Opus 5.5 medium, 2026-10-24): APPROVE
M1, L1–L3 and L5 do what the triage says; `sesClient` keeps the exact aws4fetch options and cache key. Three lows, all fixed by the lead: the `log`-transport test now passes SES credentials so only the guard stops the prime (it passed with the guard deleted); a stale cap comment removed from `sesTransport`; the isolate comment no longer implies `max_concurrency: 1` guarantees the same isolate. Jobs 62/62 and email 52/52 after the fixes.
