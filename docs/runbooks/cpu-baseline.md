# Runbook: auth CPU baseline (M1.4 gate)

**Gate (docs/09 M1.4):** login p99 ≤ **5 ms** CPU, and every route ≤ **7 ms** p99, on the Workers **Free** plan (10 ms per invocation). If it doesn't fit, I stop and ask: tune, use Cloudflare Access with simpler auth, or move to the $5 plan.

**Status:** method ready; **results pending** the first run on staging (after Access, the service token and the login secrets are in place, see [access-staging.md](access-staging.md)).

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
1. GitHub → **Actions → Auth CPU benchmark (staging) → Run workflow** (defaults: 12 users, 5 minutes). Only the `techaust` account can run it.
2. When it finishes, the run page shows the time window and wall-clock timings. Tell me "benchmark done".
3. I read the CPU time of every request in that window from **Workers Logs** (Cloudflare MCP, read-only), compute p50/p99/max per route, include the first requests after the deploy (cold isolates), and fill in the table below.

The benchmark creates throwaway users (`@bench.invalid`) and deletes them at the end. The append-only audit log keeps their `auth.login` rows, as designed.

## Results
_To be filled after the first run._

| Route | Requests | CPU p50 | CPU p99 | CPU max | Gate |
|---|---|---|---|---|---|
| salt | | | | | ≤ 7 ms |
| login | | | | | ≤ 5 ms |
| totp | | | | | ≤ 7 ms |
| me | | | | | ≤ 7 ms |

**Browser Argon2id** (m = 19 MiB, t = 2, p = 1; the sign-in page shows the time):
- this PC (owner's Windows machine, local dev): **86–92 ms**
- mid-range Android phone: _optional; open the staging sign-in page on your phone and tell me the number shown_ (target ≤ 800 ms)
