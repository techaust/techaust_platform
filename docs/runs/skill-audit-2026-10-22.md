# Skill-guided audit of merged M1.5 / M1.6 / M2.1 code (2026-10-22)

```
Status: open: fixes
Tier: A (touches staff-auth and portal Worker code)
Usage: reviewer claude-opus-5-5/high (audit; skills read from disk as checklists because the Skill tool wasn't available to agents in this session); builder: filled in when it runs
```

## Why
Owner rule (2026-10-22, CLAUDE.md rule 13): skills are mandatory. The M1.5, M1.6 and M2.1 builds and reviews loaded no skills, so a reviewer re-checked the merged code with cloudflare:workers-best-practices, cloudflare:wrangler, cloudflare:workers-profiling, cloudflare:web-perf, security-review and code-review. Result: no critical or high; 3 medium, 8 low (new).

## Findings and decisions (lead)
**Fix now (builder):**
- **M1** `preview_urls: false` at the top level and in every `env.production` of `apps/{admin,portal,web,jobs}/wrangler.jsonc` (Access bypass risk in Phase 7). Add a CI guard (extend `scripts/check-web-bindings.mjs` or a new `scripts/check-worker-config.mjs` run by `pnpm check`) that fails if any app's top level, `env.staging` or `env.production` lacks `preview_urls: false`.
- **M2** Cap untrusted header values before they reach D1: `ua` at 512 characters and `ip` at 64 in `apps/admin/worker/index.ts` and `apps/portal/worker/index.ts` (and any non-`cf-ray` request ID at 64). Tests: a 10 KB User-Agent is stored truncated to 512.
- **M3** Workers Logs privacy for web and jobs like admin/portal: `observability: { enabled: true, redact_query_string: true }` at the top level; `env.production` adds `logs: { enabled: true, invocation_logs: false }`. (Owner decision 2026-10-21, applied to all four Workers.)
- **L1** `apps/web/wrangler.jsonc` `run_worker_first`: narrow to `["/api/geo", "/api/forms/*"]` so junk `/api/x` paths are served the static 404 without invoking the Worker; keep the Worker's own 404 for unknown `/api` routes; test.
- **L2** `scripts/create-invite.mjs`: like `reinviteStatements` — expire older pending invites for the email, refuse an email that already has an active account, insert the invite, then a guarded `user.invite` audit row (actor `system`, summary `{via:"cli", role}`, no email); tests in the admin pool like the break-glass ones.
- **L3** `apps/admin/worker/users.ts` invite audit summary: `{ role }` only (no email; the email stays in the erasable `staff_invites` row). Adjust tests. DPDP retention stays VERIFY WITH CA/LEGAL.
- **L4** `apps/admin/wrangler.jsonc` `env.production.secrets.required` = the four login secrets; `apps/portal/wrangler.jsonc` `env.production.secrets.required` = `PORTAL_KEY_PEPPER` (closes the existing portal follow-up too).
- **L5** Admin and portal exit middleware: run the access-row write (and the touch riding in it) with `c.executionCtx.waitUntil(...)` so responses don't wait for it; keep the error handling; update the D1-call tests to wait for the execution context (`waitOnExecutionContext` / the pool's equivalent). CPU unchanged; verify the D1 call table still holds.
- **L8a** `apps/web/src/worker.ts`: `hono/tiny` like admin/portal.

**Deferred (recorded follow-ups):**
- **L6** immutable cache for admin/portal `/assets/*`: with the M3.1 / M4.5 `_headers` work.
- **L7** tracing on staging: after checking the Free-plan Workers Logs event quota.
- **L8b** per-email link quota lock-out by third parties: design in M2.4 with Turnstile.
- Widen the Phase 7 WAF/rate-limit follow-up to cover web `/api/*` too.

## Rules for the builder
Branch `fix/skill-audit-findings` (this file is its first commit), own worktree. **Load the skills first** (Skill tool if available, else read the SKILL.md files as the reviewer did and say so): cloudflare:workers-best-practices, cloudflare:wrangler. No `__new_` rebuilds or migrations needed (none expected). No hosted services, no new packages. Heavy commands via `bash tools/heavy.sh --log <name> <command>`; final `pnpm check`, `pnpm test`, `pnpm build`, one whole-repo lint. Commit as you go; append "Builder report"; do not push.

## Builder report
Builder: Sonnet 5.5 (effort as passed by the lead; the `Usage:` line is for the lead to fill from `node tools/model-audit.mjs`). Branch `fix/skill-audit-findings`, not pushed, no PR.

**Skills:** `cloudflare:workers-best-practices` and `cloudflare:wrangler`, both loaded with the Skill tool (it was available). What they changed: workers-best-practices drove the L5 design (the access write is tied to `ctx.waitUntil`, called as `c.executionCtx.waitUntil(...)` with no destructuring, errors still caught inside the promise, so nothing is dropped or unhandled) and confirmed the M3 observability shape; wrangler drove the config work (per-environment fields are not inherited, so `preview_urls`, `observability` and `secrets.required` are written in every `env.production`, and `wrangler types` is rerun by `pnpm check`).

**Commits (on top of 6ec322f):** `00cf227` fix(config): M1, M3, L1, L4, L8a; `33ae515` fix(logs): M2, L5; `94b6916` fix(auth): L2, L3; then this report.

**Files:**
- Config: `apps/{admin,portal,web,jobs}/wrangler.jsonc`; `scripts/check-worker-config.mjs` (new guard, exports `parseJsonc` and `missingPreviewOff`); `package.json` (`pnpm check` runs it); `.github/workflows/ci.yml` (one new step running the guard, same shape as the binding-guard step; no action versions or secrets touched).
- Web: `apps/web/src/worker.ts` (`hono/tiny`); `apps/web/test/worker-config.test.ts` (new).
- Logs: `packages/db/src/log.ts` (`HEADER_LIMITS`, `clipHeader`); `apps/admin/worker/index.ts`, `apps/portal/worker/index.ts` (M2 caps and L5 `waitUntil`).
- Tests changed: `apps/admin/worker/{test-helpers,logs.test,rbac.test,csrf-corpus.test,users.test}.ts`, `apps/portal/worker/{test-helpers,logs.test,csrf.test,realm.test}.ts`, `packages/db/test/log.test.ts`.
- Invites: `apps/admin/worker/users.ts` (L3); `scripts/create-invite.mjs`; `scripts/create-invite-sql.mjs` and `.d.mts` (new, the SQL kept testable like `reset-2fa-sql.mjs`).

**What each finding became:**
- **M1:** `"preview_urls": false` at the top level and in `env.staging` and `env.production` of all four apps. The guard fails CI if any of the three scopes lacks it (`pnpm check` and the CI `checks` job).
- **M2:** `clipHeader` with `ua` 512, `ip` 64 and the request ID 64, applied in both exit middlewares where the values enter the request, so every row written in the request (audit, access, alert) gets the capped value. Deviation: no request ID is taken from any header other than `cf-ray` (otherwise it is our own 16-hex value), so the 64 cap is applied to `cf-ray` itself, the only header-derived request ID.
- **M3:** web and jobs: `observability: { enabled: true, redact_query_string: true }` at the top level and in `env.production` with `logs: { enabled: true, invocation_logs: false }`. Staging inherits the top level (invocation logs on, as admin and portal).
- **L1:** web `run_worker_first: ["/api/geo", "/api/forms/*"]`. The Worker keeps its own 404. The test reads `wrangler.jsonc`, checks that every non-`ALL` route registered on the Worker (`app.routes`) is covered by a pattern (so a route added in M2.4 without updating the config fails the test), and that `/api/x`, `/api/nope`, `/api` and look-alikes are not matched.
- **L2:** `pnpm invite` now runs three guarded statements: expire older pending invites for the address (only if no non-"invited" account exists), insert the invite (same guard), then the `user.invite` audit row (actor `system`, summary `{via:"cli", role}`, no email), written only if the invite row exists. The script also reads first and refuses an address that has an active or deactivated account (the API's rule, `status <> 'invited'`), and checks afterwards that the invite exists. Smoke-tested on the local D1 only (two invites for one address both printed; the second replaced the first). The script's refusal branch was not run locally; its SQL guard is covered by the tests.
- **L3:** invite audit summary is `{ role }`.
- **L4:** `env.production.secrets.required` for admin (the four login secrets) and portal (`PORTAL_KEY_PEPPER`).
- **L5:** both exit middlewares build the access statements and run them inside `write()`, handed to `c.executionCtx.waitUntil(write())`. The try/catch and the error line are unchanged and sit inside `write()`. Statements are built before the first await, so they see the request's final state.
- **L8a:** `hono/tiny` in the web Worker.

**Tests added:**
- web `worker-config.test.ts`: L1 patterns, route coverage, the M1 guard fails on a missing or true value at top level, staging and production, each real config passes, JSONC parsing.
- admin and portal `logs.test.ts`: a 10 KB User-Agent is stored as 512 characters, a 200-character address and `cf-ray` as 64; (admin only) normal values are stored untouched; the access write is handed to `waitUntil` exactly once and the row exists after the context settles; a failing write still answers 200 and logs exactly one line with the route pattern, `access log write failed` and the error class, never the driver message.
- `packages/db` `log.test.ts`: `clipHeader` and `HEADER_LIMITS`.
- admin `users.test.ts`: the invite audit summary is `{role:"sales"}` and the address appears in no audit row (L3); a "pnpm invite" block (L2): stored invite and audit row with actor `system` and role only, works once end to end, a second invite expires the first, active and deactivated accounts refused with nothing written and older invites untouched, an "invited" member after a reset gets a fresh invite.

**Existing tests changed, and why:**
- L5: the deferred write means a test that reads the database right after a response could race it, and without an execution context `c.executionCtx` throws in Hono. So both `test-helpers.ts` gained `sendTo(app, url, init, env)` and `send(...)`: they pass a `createExecutionContext()` and await `waitOnExecutionContext` before returning. `call` (and the portal `callerFor`) now go through it. The direct `app.request(...)` calls in `csrf-corpus.test.ts`, `rbac.test.ts` (3 sites), portal `csrf.test.ts` (6), `logs.test.ts` (1) and `realm.test.ts` (2) now use `send` or `sendTo`. No assertion was weakened or edited. Tests that go through `exports.default.fetch` (health, routes, a few in `auth.test.ts`) were left as they are; none of them reads the access log afterwards.
- L3: no existing test asserted the old summary shape (`{email, role}`), so none had to change; the new assertions were added to the first invite test.

**Checks (in the worktree, via `tools/heavy.sh`):**
- `pnpm check` (lint, typecheck, binding guard, new config guard): exit 0.
- `pnpm build`: exit 0 (the existing "multiple environments, no target environment" notes from the web and jobs dry-runs and the missing-secrets notes for admin and portal are not new).
- `pnpm test`: exit 0 on the second run (admin 419, portal 404, and db, web, jobs, core, ui green). The first run had one failure, `lockout.test.ts > RESERVE_SQL agrees with reserveAttempt > random sequence 9`, a 5 s timeout while other packages ran in parallel. The file passes alone and in the second full run, and it does not go through the changed code. Worth watching if it recurs.
- `pnpm lint` (whole repository, once, last): exit 0, 334 files.
- Per-package runs while working: admin 411 then 419, portal 404, db log test, web 26.

**D1 call table check:** the call-count tests did not change and still pass with the write inside the execution context: admin `rbac.test.ts` "D1 calls: a refusal by the guard is 1 read + the access row; an allowed read adds its own", the 2-call invite and revoke tests in `users.test.ts`, and the 2-call and 0-call assertions in the portal `magic`, `doc-token`, `csrf` and `realm` tests. `counted()` wraps the same DB the deferred write uses, and `send` waits for the context, so the count includes the deferred call: still one D1 call per request exit (a batch when a touch is due). CPU is unchanged (same statements, only moved after the response).

**Not verified:**
- Nothing ran against staging or any hosted service. `preview_urls: false` and the production `observability` and `secrets.required` blocks are checked by the schema (wrangler typecheck, dry-run builds) and the guard only; their effect on a real deploy is not observed. A production deploy will refuse to start without the `secrets.required` values, so they must be set before Phase 7.
- Workers Logs behaviour for web and jobs (`redact_query_string`) is config only.
- The real `waitUntil` timing in production (the response returning before the write) was proved with a counting context in tests, not measured.
- The script's refusal branch for an existing account and its `--staging` run were not run.
- The L1 narrowing relies on the assets binding's `run_worker_first` matcher (literal paths and a trailing `/*`); the test checks our patterns against our routes, not Cloudflare's matcher. Worth one look at the next staging deploy: `/api/geo` should answer, `/api/x` should return the static 404 page.

**Deviations from the brief:** (1) M2 caps `cf-ray` rather than a separate "non-cf-ray request ID" (none exists). (2) The L2 SQL lives in a new `scripts/create-invite-sql.mjs` instead of inline in `create-invite.mjs`, so the tests run exactly the SQL the script runs (same pattern as the break-glass script). (3) The CI workflow got a new step for the guard (a file in the repo; no hosted setting changed).

**Open questions:** none for the owner. For the lead: the web `run_worker_first` list must be extended by each M2.4 route (the new test fails if it is not).
