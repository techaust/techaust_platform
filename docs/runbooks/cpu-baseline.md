# Runbook: auth CPU baseline (M1.4 gate)

**Gate (docs/09 M1.4):** login p99 ≤ **5 ms** CPU, and every route ≤ **7 ms** p99, on the Workers **Free** plan (10 ms per invocation). If it doesn't fit, I stop and ask: tune, use Cloudflare Access with simpler auth, or move to the $5 plan.

**Status:** re-measured 2026-10-21 after the tuning (PR #24): totp, salt and me pass; login p99 6 ms vs 5 (one request over the line). **Owner accepted M1.4 as passed with this exception** (2026-10-21); cold starts move to M1.5. See Results. Setup: [access-staging.md](access-staging.md) (all three parts done 2026-10-17).

## What is measured
The staff login routes of the staging admin Worker (`techaust-platform-admin-staging`), as designed in [05 §6.1](../05-architecture.md):

| Route | Server work |
|---|---|
| `POST /api/v1/auth/salt` | 1 D1 read; 1 HMAC (fake salt) for unknown emails |
| `POST /api/v1/auth/login` | 2 D1 reads, 1 SHA-256, 1–2 HMACs, constant-time compare; 1 D1 write on failure |
| `POST /api/v1/auth/totp` | 2 D1 reads, HMAC challenge check, AES-GCM decrypt, TOTP (3 HOTPs max), 1 D1 batch (replay guard + session + audit) |
| `GET /api/v1/auth/me` | 1 D1 read (session ⋈ user); a write at most every 15 min |
| `POST /api/v1/auth/invite/*` | Enrolment only (rare): measured, but not part of the login gate |

## How to run it (owner)
1. Right after the staging deploy of PR #7 finishes (so the first requests hit cold isolates): GitHub → **Actions → Auth CPU benchmark (staging) → Run workflow** (defaults: 12 users, 5 minutes). Only the `techaust` account can run it.
2. When it finishes, the run page shows the time window and wall-clock timings. Tell me "benchmark done".
3. The same day (log retention is short), I read **Workers Logs** for `techaust-platform-admin-staging` (Cloudflare MCP, read-only), within the run's `windowUtc`, for paths under `/api/v1/auth/`:
   - first I list the available fields (the CPU-time field name is checked, not assumed)
   - per route (`salt`, `login`, `totp`, `me`; `invite/*` separately): count, CPU p50/p99/max, wall time, outcome and status (about 1 in 10 logins is a 401 by design)
   - the first requests after the deploy (cold isolates) and the max are reported separately
   - the gate: login p99 ≤ 5 ms and every route p99 ≤ 7 ms; on a fail I stop and ask

The benchmark creates throwaway users (`@bench.invalid`) and deletes them at the end. The append-only audit log keeps their `auth.login` rows, as designed.

## Results

### Run 4 (M1.5, PR #27): 2026-10-21 IST, 15 minutes, 12 users
Run `mvhpa77n3920`, window 05:57:33–06:13:03 UTC, version `f2da33e6` only (the M1.5 Worker: minified, `zod/mini`, `hono/tiny`, 79 KB); 198 logins, 0 unexpected failures; every outcome "ok" (1,088 × 200, 19 × 401 by design). CPU from Workers Logs (`$workers.cpuTimeMs`, whole ms), matched by request ID to the `ev:"req"` line (`n = 1` = first request of an isolate; 4 of 1,107 requests had no log line). Each cycle now also calls `/sessions` and `/step-up`, so there are fewer logins than in run 3. Read 2026-10-21 by the lead.

| Route | Requests | CPU p50 | CPU p99 (run 3 → 4) | CPU max | Over 10 ms | Target |
|---|---|---|---|---|---|---|
| salt | 190 | 1 ms | 7 → **4 ms** | 7 ms | 0 | ≤ 7 ms ✅ |
| login | 191 | 2 ms | 6 → **5 ms** | 13 ms | 1 (warm) | ≤ 6 ms ✅ (also the original 5 ms) |
| totp | 172 | 3 ms | 7 → **7 ms** | 13 ms | 1 (warm) | ≤ 7 ms ✅ |
| me | 176 | 1 ms | 3 → **3 ms** | 8 ms | 0 | ≤ 7 ms ✅ |
| sessions (new) | 173 | 2 ms | **7 ms** | 8 ms | 0 | ≤ 7 ms ✅ |
| step-up (new) | 171 | 3 ms | **6 ms** | 7 ms | 0 | ≤ 7 ms ✅ |
| invite/* (not gated) | 34 | 1–5 ms | 4–13 ms | 13 ms (invite/totp) | 1 | — |

- **Histograms** (ms: count). login: 1:43, 2:119, 3:22, 4:4, 5:2, 13:1. totp: 1:9, 2:66, 3:55, 4:24, 5:15, 6:1, 7:1, 13:1. sessions: 1:23, 2:99, 3:36, 4:10, 5:3, 7:1, 8:1. step-up: 1:1, 2:60, 3:76, 4:25, 5:5, 6:3, 7:1.
- **Cold starts:** 5 isolates; their first requests cost 4, 4, 4, 3 and 7 ms (4 on salt, 1 on me). Run 3: 6–14 ms with 2 of 8 over 10. **Every `n = 1` request ≤ 10 ms ✅.**
- **Over 10 ms:** 3 of 1,107 requests, all warm, scattered (login 13, totp 13, invite/totp 13); Cloudflare lets these finish but doesn't promise to.
- **Wall clock** (GitHub runner in the US, not gated): login p50 508 / p99 682 ms, totp 523 / 740, step-up 725 / 885.

### Verdict (run 4): M1.5 targets met (lead, 2026-10-21)
Every gated route's p99 is within target, login p99 is 5 ms, and the cold-start fix worked (first requests 3–7 ms, was up to 14). Three warm requests in 1,107 reached 13 ms; worth watching in M7.5's budget audit, not a blocker. The $5 plan question (before real staff use) stands as recorded.


### Run 3 (after the tuning, PR #24): 2026-10-21 IST (2026-10-20 UTC), 15 minutes, 12 users
Run `mvh4cyuc5298`, window ≈ 20:11:51–20:27:20 UTC, version `392f8376` only; 375 logins, 0 unexpected failures; every outcome "ok" (1,415 × 200, 36 × 401 by design). CPU from Workers Logs (`$workers.cpuTimeMs`, whole ms), each request matched by request ID to its `ev:"auth"` line (`n = 1` = first request of an isolate; 25 of 1,451 requests had no log line). Read 2026-10-21.

| Route | Requests | CPU p50 | CPU p99 (run 2 → 3) | CPU max | Over 10 ms | Gate |
|---|---|---|---|---|---|---|
| salt | 374 | 1 ms | 5 → **7 ms** | 14 ms | 2 (both cold) | ≤ 7 ms ✅ |
| login | 380 | 1 ms | 6 → **6 ms** | 10 ms | 0 | ≤ 5 ms ❌ (by one request) |
| totp | 339 | 2 ms | 12 → **7 ms** | 9 ms | **0** (was 4) | ≤ 7 ms ✅ |
| me | 324 | 1 ms | 3 → **3 ms** | 3 ms | 0 | ≤ 7 ms ✅ |
| invite/* (not gated) | 34 | 2 ms | 8 ms | 8 ms | 0 | — |

- **Histograms** (ms: count). login: 0:4, 1:256, 2:89, 3:16, 4:6, 5:5, 6:2, 8:1, 10:1 (376 of 380 ≤ 5 ms; the p99 is the 377th). totp: 1:61, 2:150, 3:63, 4:42, 5:12, 6:5, 7:3, 8:1, 9:2.
- **By status:** login 200 p50 1 / p99 6 / max 10 (344); login 401 p50 1 / p99 5 / max 5 (36).
- **Cold vs warm:** 8 isolates. Their first requests cost 6, 7, 7, 7, 8, 10, 13, 14 ms (7 on salt, 1 on invite). Warm salt p99 is 3 ms (max 4); warm login and totp match the totals above.
- **Wall clock** (GitHub runner in the US): login p50 262 / p99 564 ms, totp 523 / 627 ms (was ~980), not part of the gate.

### Verdict (run 3): accepted as passed with an exception (owner, 2026-10-21)
- The tuning worked where it mattered: totp p99 12 → 7 ms and nothing warm over 10 ms.
- Login p99 is 6 ms against the 5 ms margin, decided by one request of 380; its max is exactly 10 ms.
- Cold starts (module load on a fresh isolate) cost 6–14 ms; 2 of 8 went over 10 ms and Cloudflare let them finish, which it doesn't promise. Reducing cold-start cost is part of M1.5.
- The $5 plan is looked at again before staff use the admin for real work.

### Run 2 (decisive): 2026-10-17, 15 minutes, 12 users
Run `mvcbujlie045`, window 11:42:37–11:58:28 UTC, version `7361380c`; 382 logins, 0 unexpected failures; every request outcome "ok" (1,610 × 200, 37 × 401 by design). CPU from Workers Logs (`$workers.cpuTimeMs`, whole milliseconds; read 2026-10-17).

| Route | Requests | CPU p50 | CPU p99 | CPU max | Over 10 ms | Gate |
|---|---|---|---|---|---|---|
| salt | 432 | 1 ms | 5 ms | 7 ms | 0 | ≤ 7 ms ✅ |
| login | 419 | 2 ms | **6 ms** | 8 ms | 0 | ≤ 5 ms ❌ |
| totp | 388 | 4 ms | **12 ms** | 16 ms | **4** | ≤ 7 ms ❌ |
| me | 373 | 1 ms | 3 ms | 6 ms | 0 | ≤ 7 ms ✅ |
| invite/* (not gated) | 34 | 2–4 ms | — | 15 ms (first request) | 2 | — |

CPU histograms (ms: count). login: 1:176, 2:159, 3:56, 4:13, 5:10, 6:3, 7:1, 8:1. totp: 2:129, 3:59, 4:81, 5:71, 6:22, 7:11, 8:8, 9:3, 12:1, 14:1, 16:2.

### Run 1: 2026-10-17, 5 minutes, 12 users
Run `mvcb9b836a40`, window 11:26:06–11:31:57 UTC; 143 logins, 0 unexpected failures. login p50 2 / p99 7 / max 7 ms (148 requests); totp 4 / 7 / 16 ms (157); salt 1 / 3 / 6 ms (163); me 1 / 3 / 6 ms (140). Too few requests for a stable p99, so run 2 was made (owner decision).

### Verdict (runs 1–2): gate failed (owner decision 2026-10-17: tune, then re-measure)
- The spikes are scattered through both runs, not cold starts; most requests are cheap.
- totp is the main problem: about 1 % of requests exceed the Free plan's 10 ms (Cloudflare let them finish, but it may cut them off).
- Next: the analyst diagnoses where login and totp spend CPU; a builder tunes (Tier A); the 15-minute run is repeated. If tuning can't meet the gate, the owner chooses between the $5 plan and Access + simpler auth.
- Wall-clock times (GitHub runner in the US → MSP colo): login ~240 ms, totp ~980 ms (D1 batch), not part of the gate.

**Browser Argon2id** (m = 19 MiB, t = 2, p = 1; the sign-in page shows the time):
- this PC (owner's Windows machine, local dev): **86–92 ms**
- mid-range Android phone: _optional; open the staging sign-in page on your phone and tell me the number shown_ (target ≤ 800 ms)
