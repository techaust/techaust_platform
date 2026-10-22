# CPU tuning: form post, leads and email consumers

```
Status: open
Tier: B (Workers, queues; docs/14 §2)
Usage: (filled by the lead from node tools/model-audit.mjs)
```

## Before the build (2026-10-23)
- **Owner (2026-10-23):** approved this follow-up when approving M2.4, and approved the plan today (lead measures → builder profiles and fixes → reviewer → PR → owner's staging test → lead re-measures).
- **Why:** the Free plan stops an invocation at **10 ms CPU**, including queue consumers; the target is **p99 ≤ 7 ms** (CLAUDE.md, Free plan conventions).
- **Baseline (lead, staging Workers Logs, read-only, the owner's two tests on 2026-10-22 22:20 and 22:23 UTC):**

| Invocation | CPU (ms) | Wall (ms) |
|---|---|---|
| web `POST /api/forms/contact` | 6 | 600 |
| web `POST /api/forms/quote` | 10 | 193 |
| jobs queue `techaust-staging-leads` | 8, 8 | 1,045, 687 |
| jobs queue `techaust-staging-email` | 14, 7, 5, 4 | 1,797, 1,724, 1,543, 1,055 |
| for comparison: web `GET /api/geo` | 1–2 | |

  Only two submissions, so these are mostly cold or near-cold isolates. The first email message (14 ms) and the quote post (10 ms) are the ones at or over the limit. Script startup (module top level: building zod schemas, catalogue, templates) is a likely share of it.

## Brief

**PRD IDs:** FRM-01..07 (behaviour unchanged); the Free plan rule (CLAUDE.md "Free plan", docs/05).

**Branch:** `perf/cpu-tuning` (holds this brief). The builder creates `perf/cpu-tuning-builder` from `origin/perf/cpu-tuning` in its own worktree and pushes only that; the lead merges.

### Step 1: builder (Sonnet 5.5, medium)
**First step:** load `cloudflare:workers-profiling`, `cloudflare:workers-best-practices` and `cloudflare:wrangler`. List them in the report.

**Never touch hosted services.** Profile **locally** only: no hosted profiling captures, no `wrangler deploy`, no `wrangler tail` against staging, no `cf` CLI (not installed; no installs). The lead re-measures on staging after the merge.

**In scope (only what the measurements show):**
- `apps/web/src/forms.ts`, `apps/web/src/worker.ts` (the form post: Origin, size cap, HMAC, honeypot, Turnstile fetch, zod, queue send)
- `apps/jobs/src/{queue,leads,email,form-limits}.ts` (leads and email consumers, DLQ consumers)
- `packages/email/src/*` (templates, SigV4 transport), and the exports of `packages/core` / `packages/db/catalogue` that these Workers import, if a barrel import pulls in work they don't need

**How:**
1. **Measure first, both script startup and per-message work, for each of the three paths.** Use a local CPU profile (for example `wrangler dev` with the DevTools inspector, or a Node `--cpu-prof` micro-benchmark of the same functions with a note that Node is not workerd). Record the top functions with self time in ms. Also measure the bundle each Worker ships (`wrangler deploy --dry-run --outdir`, sizes raw and gzipped) and what runs at module top level.
2. **Fix the largest costs, smallest change first.** Candidates to check against the evidence, not to apply blindly: building zod schemas at module load (lazy-build on first use, or import only the schema needed instead of the `@techaust/core` barrel); the whole catalogue loaded where one lookup is needed; email templates compiled or strings built at startup; SigV4 signing-key derivation repeated per message (cache the derived key per date and region within the isolate); JSON re-serialising; the web bundle (141 KB gzipped, mostly zod) and anything from `@techaust/auth` the web Worker doesn't use.
3. **Measure again** the same way and give before and after per path in a table.

**Rules:**
- Behaviour, responses, logs, email bytes and the order of the form checks stay exactly the same. Every existing test still passes unchanged; add tests only for new code (for example a cached signing key is re-derived when the date changes).
- No new packages (stop and report). No floats in money code. No `wrangler.jsonc` changes except where a profile shows a need (then say why and regenerate types).
- No personal data in logs. Commit at least every 20 minutes and at each finished path.
- Heavy commands through `bash tools/heavy.sh --log <name> <command>`; the whole-repo lint once, as your final check.
- Stop and report if blocked, or if the evidence says the 7 ms target can't be met without a design change (for example splitting work into another queue message).

**Checks:** `pnpm check`, `pnpm test`, `pnpm build` (web dist checks and Worker dry runs).

**Done:** commit, push `perf/cpu-tuning-builder`, append "Builder report" below (skills loaded; files changed; profile method; before/after table per path, startup and per message; bundle sizes; commands and results; not verified; open questions). Stop every dev server you started, then stop.

### Step 2: review and merge
- Reviewer (Opus 5.5, high; `code-review` and `cloudflare:workers-best-practices`; no screens, so no visual review) on the whole branch against `main`.
- Fixes, re-check, the lead integrates, runs `pnpm check` and `pnpm test`, opens the PR with auto-merge and Auto-fix.
- **On staging:** the owner sends one contact and one quote request; the lead reads `cpuTimeMs` for the web post, the leads consumer and each email message from Workers Logs (read-only) and compares with the baseline above.

## Out of scope
| Item | Owner |
|---|---|
| Page JavaScript size on `/contact` and `/get-a-quote` (32 KB gzipped, mostly zod) | M2.5 |
| Workers Logs tracing, hosted profiling | Later, with the owner's yes |
| M2.4b emails (magic link, staff security) | M2.4b, which must keep these gains |
