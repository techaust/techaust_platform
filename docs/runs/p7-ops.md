# P7 ops: the monthly 10-year finance backup copy and production catalogue prices

Status: brief written (lead, 2026-11-07 evening); builder next.
Tier: B (workflows and scripts; owner's yes to these workflow changes: 13 2026-11-07, Q10). Branch: `feat/p7-ops`, cut from `origin/feat/p7-production` (PR #193). After #193 squash-merges, this branch takes `main` in under CLAUDE.md's pre-squash-head rule.

## Why
- **The owner (13, 2026-11-07):** nothing that production needs stays pending before go-live.
- **The monthly finance-only copy** (PRD JOB-BKP-01, priority M; 08 §6.1; T7 F1) is not built ([restore.md](../runbooks/restore.md) §3.6; P7 re-check M3). The first copy is due on 2026-12-01; build it now.
- **The production website builds from the seed catalogue** (P7-B report). The owner's published prices in the production admin never reach the production website. The existing owner decision (`publish-catalogue.yml`'s header) is that production follows the normal approved deploy, never the 30-minute staging publisher. So `deploy-prod.yml` must read the production snapshot before it builds the website.

## Do
1. **The monthly copy, in `.github/workflows/backup.yml`:**
   - **When:** on the 1st of each month (UTC day of the run) and on a manual input `monthly: true`.
   - **What:** after the daily export, build the finance-only copy ON THE RUNNER.
     - Load the plaintext export into a local `sqlite3` database (the runner's sqlite3).
     - For each table that `BACKUP_SCOPE` (`packages/db/src/backup-scope.ts`) marks as monthly, write that table's rows with `monthlyExportSql(table)` into a new SQL file. That query keeps the invoice family and accepted offers and leaves out proposals, estimates and personal data (T7 F1). Read the module first and use it as it is; if a gap shows, report it, don't redesign.
     - Encrypt it with the same envelope (`scripts/backup-encrypt.sh`) and upload it to `s3://$BACKUP_BUCKET/monthly/techaust-prod-finance-<YYYY-MM>.tar`.
     - Verify it by listing, as the daily copy does.
     - Delete both plaintexts on every path.
   - **Helper:** a small Node script `scripts/backup-monthly.mjs`, with tests, that turns the export into the finance SQL.
   - **Runbook** ([restore.md](../runbooks/restore.md) §3): replace "not built yet" with how the copy is made and restored. A table-filtered copy has no triggers or indexes, so it is restored onto a schema built from the migrations. Add what the owner must add in AWS (below).
   - **Workflow tests** (`apps/web/test/backup-workflow.test.ts`): the monthly branch; plaintext deleted; the upload prefix is `monthly/`.
2. **Production prices, in `.github/workflows/deploy-prod.yml`:**
   - A new job `snapshot`, before `build`, reads the newest published catalogue snapshot from the PRODUCTION D1, read-only.
     - It uses `scripts/fetch-catalogue-snapshot.mjs` with an environment argument: add `--env production` support and keep staging the default.
     - It runs in the GitHub environment `backup` (`main` only, no reviewer; secret `CF_API_TOKEN_BACKUP`, scoped to D1 only). **Lead's decision:** that way the deploy keeps a single owner approval, and no job runs package code while it holds a token. Install only `@techaust/deploy-tools`, as the deploy job does.
     - It uploads `apps/web/catalogue-snapshot.json` as an artifact. When production has no snapshot yet (the first deploy), it uploads nothing and the build uses the seed.
   - `build` needs `snapshot`. It downloads the artifact into `apps/web/` before building the website, and the existing zod validation in the web build checks it.
   - On `stage: database`, `snapshot` is skipped.
   - **Workflow tests** (`deploy-workflow.test.ts`, `prod-deploy.test.ts`): order, environment, no token in build, artifact path.
   - **Runbook** (`docs/runbooks/environments.md`): after publishing in the production admin, run "Deploy production" (`stage: full`) to update the website's prices.
3. **The `environments.md` production section**, the Phase 7 gap the P7-B report named: the production deploy workflow (stages, approval, order, health checks, rollback per 08 §6.3), the backups, and the snapshot.

**AWS changes the owner makes** (the lead gives the clicks; write them in the runbook):
- the role's inline policy also allows `s3:PutObject` on `monthly/*`, and `s3:ListBucket` with the prefix `monthly/*`;
- a lifecycle rule on `monthly/`: expire after 3,653 days (10 years) for current versions, and the noncurrent-version rule.

**Files:** `.github/workflows/backup.yml`, `.github/workflows/deploy-prod.yml`, `scripts/backup-monthly.mjs` (new), `scripts/fetch-catalogue-snapshot.mjs`, `docs/runbooks/restore.md`, `docs/runbooks/environments.md`, and their tests in `apps/web/test`.

**Not your files:** `apps/*` source, `packages/*` source (read `backup-scope.ts` only), the gateway code, the statement code, the PDF code, the settings and LUT code.

**Order:** builder → reviewer → fixes → re-check (Tier B; no analyst early check is needed for a workflow and script change).

**Done when:**
- `apps/web` tests and `pnpm check` are green;
- your report is appended here ("## Builder report");
- `fix/p7-ops-b1` is pushed.
