# Status

_Replaced (never appended) at the end of every session. Last updated: **2026-10-07**._

## Done
- **Phases 1–5:** approved. See [09-roadmap.md](09-roadmap.md).
- **M1.1:** design tokens, fonts and the brand identity "Patina". Approved ([PR #3](https://github.com/techaust/techaust_platform/pull/3)).
- **M1.2:** the core library in `packages/core`. Approved ([PR #5](https://github.com/techaust/techaust_platform/pull/5)).
- **M1.3:** the D1 schema, triggers and seed. Staging D1 is migrated and seeded on every merge. Approved ([PR #6](https://github.com/techaust/techaust_platform/pull/6)).
- **Working rules (2026-10-07):**
  - builder and reviewer agents
  - the heavy-command queue
  - the start-session and end-session skills
  - this record (STATUS, DECISIONS, CHANGELOG, `docs/runs/`)
  - merge-on-green

## In progress
- **M1.4:** the auth CPU spike, a gate ([PR #7](https://github.com/techaust/techaust_platform/pull/7)).
  - Built and tested locally: the staff login API, the sign-in and invite screens, the benchmark workflow.
  - The full login flow works locally; Argon2id in the browser took 86–92 ms on the owner's PC.
  - **PR #7 must not merge before Access is on.** Auto-merge stays off for it.

## Next
1. Once the owner says "Access is on":
   - verify that every staging URL shows the Access sign-in
   - update PR #7 with `main`, then merge it
2. The owner runs **Actions → Auth CPU benchmark (staging)**. I read the CPU times from Workers Logs and fill in `docs/runbooks/cpu-baseline.md` (in PR #7).
3. **Gate:** login p99 ≤ 5 ms and every route ≤ 7 ms p99. If it fails, stop and ask the owner.
4. Then M1.5 ([09-roadmap.md](09-roadmap.md)).

## Waits on the owner
- Parts 1–3 of `docs/runbooks/access-staging.md` (in PR #7):
  - turn on Access for the four staging Workers
  - create the benchmark service token and its two `gh secret set` commands
  - run the four `wrangler secret put … --env staging` login secrets
- **Not blocking:**
  - trademark search (VERIFY WITH LEGAL)
  - printed brand proof and Pantone match
  - phone number for the business card
  - headshot and bio (for M2)
  - optional: Argon2id timing on a phone

## Open follow-ups
- After this PR merges, PR #7 still carries the first draft of today's setup (`slice-builder`/`slice-reviewer`, `scripts/heavy.mjs`, `start-the-day`, and the work-split section in CLAUDE.md). When `main` is merged in, remove those, and move PR #7's status lines out of CLAUDE.md.
- `docs/09-roadmap.md` on `main` still says M1.3 is "awaiting approval". PR #7 corrects it.
