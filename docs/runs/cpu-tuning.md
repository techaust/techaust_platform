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

## Builder report (Step 1, Sonnet 5.5, 2026-10-23)

**Skills loaded:** `cloudflare:workers-profiling` (method: profile, find self time, smallest fix; no hosted capture was possible or allowed, so a local Node profile was used), `cloudflare:workers-best-practices` (checked: no module-level request state, no ctx destructuring, no new floats), `cloudflare:wrangler` (used `wrangler deploy --dry-run --outdir` for bundle sizes and `wrangler types`; no remote command). Context7 was not needed: no library API was used beyond what the repo already pins (the aws4fetch `cache` option was read from the installed `.d.ts`).

**Files changed:** `packages/core/src/schemas/{catalogue-snapshot,domain,fields,forms,messages,settings}.ts` (import style), `packages/core/src/warm.ts` (new), `packages/core/src/index.ts`, `packages/core/src/form-labels.ts` (`countryName` keeps its formatter), `packages/core/test/warm.test.ts` (new), `packages/email/src/transport.ts`, `packages/email/test/email.test.ts`, `apps/jobs/src/warm.ts` (new), `apps/jobs/src/index.ts`, `apps/web/src/forms.ts`. No `wrangler.jsonc` change, no new package.

**Method.** Real CPU in workerd cannot be read locally, so: (1) esbuild with wrangler-like settings (`workerd` conditions, metafile) to see what each bundle holds; (2) a Node micro-benchmark per path that bundles the real Worker entry, imports it (startup) and calls `fetch` / `queue` with stubbed bindings (D1, queues, rate limiter, Turnstile fetch, SES fetch), measuring the first call in a fresh process (the cold case that hit the limit), the second, and the median of 100 (warm); (3) `node --cpu-prof` (100 us) for self times. Node is not workerd: use the numbers as relative. Node-only noise (undici's lazy load, about 9 ms) was removed from the harness by touching `Request/Response` before timing. The scripts are in `.logs/perf/` (git-ignored).

**What the evidence showed**
1. **Bundle (largest finding).** `import { z } from "zod"` made esbuild keep the whole `z` namespace object: `toJSONSchema`, `fromJSONSchema`, `compile` (a declared side-effect module) and every locale (zod was 752 KB of the web Worker's 843 KB unminified). `import * as z from "zod"` lets it tree-shake. Same types, same runtime schemas.
2. **First zod parse and Intl in the first message.** The first contact post cost about 8 ms in Node and the first quote lead 10 to 12 ms; the profile showed `Intl.NumberFormat` creation (budget band labels, about 15 ms of ICU set-up when it is the first Intl use), `Intl.DisplayNames` (country, 4 ms) and zod's first run of each schema. Whichever message arrives first in an isolate pays them.
3. **SigV4 key derivation per message.** `transportFor(env)` makes a new `AwsClient` per message and aws4fetch's derived-key cache lives in the client, so every email repeated 4 HMACs.
4. Not a cost: `stableId` (BigInt FNV, 0.17 ms cold, measured alone; an earlier profile attribution was a sampling artefact), template rendering (0.5 ms warm), JSON, `escapeHtml`.

**Fixes (commits, smallest first)**
- `import * as z from "zod"` in the six core schema files (no behaviour change).
- `sesTransport` passes a module-level `SIGNING_KEYS` map to `AwsClient` (`cache`): one derivation per secret, day, region and service per isolate; a new date derives again. Test: 5 `subtle.sign` calls, then 1 on a new transport the same day with an identical Authorization header, then 5 after midnight.
- `countryName` keeps its `Intl.DisplayNames` after first use.
- **Start-up warm-up** (`warmFormSchemas`, `warmLabels` in `core/src/warm.ts`; `warmConsumers` in `apps/jobs/src/warm.ts`, which also renders both email templates once): run at module top level of the web `forms.ts` and the jobs `index.ts`, with made-up sample values, no I/O, no logging, errors swallowed. It moves the cold costs of item 2 out of the first message. **This rests on one assumption I could not test locally: that module top-level work is not billed to the first invocation's `cpuTimeMs`.** The baseline supports it (`GET /api/geo` is 1 to 2 ms CPU with a bundle that takes about 55 ms to evaluate in Node), but the lead's staging re-measure decides it. If startup turns out to be counted, drop the warm-up commit (the `warm.ts` files and the two call lines); the other fixes stand.
- Tried and reverted: making the "Keep this under 2,000 characters" text lazy. It removed 17 ms from startup, but ICU is needed later by the quote consumer anyway, so it only moved the cost into the first quote message (first quote lead 11 ms became 26 ms).

**Before / after (Node, ms CPU, 3 runs each, ranges)**

| Path | Startup before | Startup after | First message before | First message after | Warm median before | after |
|---|---|---|---|---|---|---|
| web `POST /api/forms/contact` | 54 to 58 | 45 to 50 | 6.5 to 8.8 | 3.5 to 5.7 | 0.19 | 0.18 to 0.22 |
| jobs leads, contact | 52 to 64 | 51 to 95 (noisy) | 5.2 to 9.2 | 1.5 to 2.1 | 0.10 | 0.08 to 0.14 |
| jobs leads, quote | 57 to 66 | 51 to 53 | 10.1 to 12.4 | 1.7 to 2.1 | 0.15 | 0.13 to 0.15 |
| jobs email, lead.alert | 60 to 71 | 51 to 59 | 8.4 to 14.5 | 8.8 to 9.1 | 0.78 to 1.3 | 0.52 to 0.57 |
| jobs email, lead.acknowledgement | 59 to 70 | 54 to 79 | 8.0 to 11.2 | 5.6 to 8.0 | 0.73 to 0.89 | 0.45 to 0.48 |

The web quote post was not benchmarked separately (same code; its extra cost on staging is the larger `quoteForm` first run, now in the warm-up). The email first-message figure in Node is dominated by Node's own crypto and undici first-use cost and the first SES signature, so the email path is the least certain: the saving there is mostly the signing key from the second message of an isolate on (warm median down about 40 %), and the first message in a fresh isolate is only modestly better. The lead should read `cpuTimeMs` for each email on staging.

**Bundles (`wrangler deploy --dry-run`, raw / gzip bytes):** web 878,772 / 145,674 before, 301,037 / 66,351 after; jobs 933,656 / 162,675 before, 355,215 / 82,606 after.

**Commands:** `pnpm install --frozen-lockfile --prefer-offline` (the worktree had no `node_modules`; no new package), `pnpm check` exit 0, `pnpm build` exit 0, `pnpm test` exit 0 (core 342, email 21, db 53, auth 94, ui 469 + 2 skipped, jobs 30, web 303, admin 420, portal 404), `pnpm lint` exit 0 (6 existing infos). Core coverage 99.4 %.

**Not verified:** real workerd CPU (all figures are Node); whether startup work is billed to the first request (above); that the page JavaScript for `/contact` and `/get-a-quote` shrank (it should with the same import change, but was not compared; it is M2.5's); the email first-message cost in workerd.

**Candidates not done (no local evidence, or out of scope):** batching the email consumer's INSERT OR IGNORE and claim UPDATE into one `db.batch()` (saves a D1 round trip per message; needs a D1 measurement and changes the query shape); static budget-band labels to avoid `Intl.NumberFormat` (would type amounts, against the "amounts from numbers" rule in `form-labels.ts`, so a lead/owner call); computing `leadId` once per lead message (trivial saving).

**Open questions:** none blocking. Lead: keep or drop the warm-up commit after the staging re-measure.
