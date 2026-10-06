# Runbook: environments and Cloudflare resources

Cloudflare account: **Techaust Technologies** (`153cd8b23edd2bc9dec570ffaf467c2f`), owner `admin@techaust.com`. _Last updated 2026-10-07._
The live site is the old Worker **`techaust-web`**. **Never deploy to, rename or delete it** (rollback target until Phase 7 + 2 weeks).

## Staging (created 2026-10-06, P5.6, approved by the owner)

| Resource | Name | ID / note | Used from |
|---|---|---|---|
| D1 | `techaust-staging` | `879c63dd-fedd-4710-9b13-21d8804879a9` (location hint apac); bound to admin, portal and jobs; **migrated and seeded on every merge** (seed is insert-only, no personal data) | M1.3 |
| Queue | `techaust-staging-leads` (+ `-dlq`) | — | M2.4 |
| Queue | `techaust-staging-pdf` (+ `-dlq`) | — | M4.4 |
| Queue | `techaust-staging-email` (+ `-dlq`) | — | M2.4 |
| Queue | `techaust-staging-events` (+ `-dlq`) | — | M6 |
| R2 | `techaust-staging-files`, `techaust-staging-docs` | **Not created yet** (owner deferred; R2 may need a payment method on file) | M3.4 / M4.4 |
| Turnstile widget | staging hostnames | **Not created yet**: dashboard checklist at M2.4 | M2.4 |
| Access app | the staging `*.workers.dev` hosts | **Not created yet**: dashboard checklist before any real data (M1.4) | M1.4 |
| Workers | `techaust-platform-{web,admin,portal,jobs}-staging` | **Deployed 2026-10-06** (PR #1); health routes return 200 | — |

**Staging URLs** (workers.dev subdomain `techaust-technologies-153`; noindex placeholders, no personal data; Cloudflare Access pending the owner's setup, see `docs/runbooks/access-staging.md` in PR #7):
- Web: https://techaust-platform-web-staging.techaust-technologies-153.workers.dev (`/api/geo`)
- Admin: https://techaust-platform-admin-staging.techaust-technologies-153.workers.dev (`/api/v1/health`)
- Portal: https://techaust-platform-portal-staging.techaust-technologies-153.workers.dev (`/api/v1/health`)
- Jobs: https://techaust-platform-jobs-staging.techaust-technologies-153.workers.dev (`/healthz`)

Deploys happen automatically when a PR is merged to `main` (`.github/workflows/deploy-staging.yml`): first `wrangler d1 migrations apply DB --remote --env staging` and the seed, then the four Workers.

## Production
Nothing is created until Phase 7 (L3), with owner approval per resource.

## Access methods
- Local: `wrangler login` (OAuth, the owner's machine). Scopes include Workers/D1/Queues write and zone **read** only.
- CI: `CF_API_TOKEN_STAGING` (repo secret, created by the owner with the scoped permissions in [05 §12.3](../05-architecture.md)), plus `CLOUDFLARE_ACCOUNT_ID`.
- Cloudflare MCP (plugin, authorised): read-only use (logs, listing).

## GitHub
- Repo `techaust/techaust_platform`: **public** (owner decision, 2026-10-06). `main` is protected (PR + CI `checks` required, conversation resolution required, linear history, no force-push, admins included). **Auto-merge is on** (owner, 2026-10-07): PRs merge themselves when CI passes, except held PRs.
- Repo secrets: `CF_API_TOKEN_STAGING`, `CLOUDFLARE_ACCOUNT_ID`. Repo variable `PRODUCTION_ENABLED`: **unset** (production deploys disabled until Phase 7).
