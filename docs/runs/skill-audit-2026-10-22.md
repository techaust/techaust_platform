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
