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

## Builder report
Builder (Opus 5.5, high), branch `fix/p7-ops-b1` from `origin/feat/p7-ops` (cd5a7dd0). Commits: 3ea47669 (monthly builder), 8559e6e0 (backup workflow), 234f8fd5 (production snapshot), 45084eb5 (runbooks), plus this report. Pushed. No deploy, no hosted change, no secret value.

**Skills loaded:**
- `cloudflare:wrangler`: kept every Cloudflare call on the project's own wrangler (`WRANGLER_BIN`, the deploy-tools copy) from `apps/jobs`, whose `env.production` binds `DB` (P7-A). `--env` reaches wrangler only as `staging` or `production`. No new wrangler command was added.
- `aws-core:aws-iam`: shaped the exact role policy in restore.md §3.6.4:
  - `s3:PutObject` on `daily/*` and `monthly/*`;
  - `s3:ListBucket` with `StringLike` `s3:prefix` `["daily/*", "monthly/*"]`;
  - no Get, Delete or DeleteObjectVersion; the OIDC trust is unchanged.
- `aws-core:aws-storage`: shaped the `monthly/` lifecycle rule (3,653 days for current and noncurrent versions, with the reason) on the versioned bucket. It also made me keep the put-only, list-to-verify pattern.
- Context7 (GitHub Actions docs, "Defining prerequisite jobs"): a skipped job skips every later job in the chain unless a condition says otherwise. So `build` and `deploy` carry explicit `if:` conditions.

### Files
- **`scripts/backup-monthly.mjs`** (new), with `.d.mts`:
  - **`build <export.sql> <finance.sql>`:**
    - loads the export into an **in-memory** `node:sqlite` database, so no plaintext database file is written. It uses drill-verify's `loadOrder` (schema, then rows; transactions dropped);
    - **never creates the triggers**; foreign keys are off (`PRAGMA foreign_keys=OFF` after the schema); `sqlite_*` statements are skipped;
    - refuses, and writes nothing, when the export holds a table `BACKUP_SCOPE` doesn't classify, or lacks a monthly table;
    - writes:
      - a header: format `techaust-finance-monthly/1`, the time, the source name and the row counts;
      - each monthly table's own definition as `CREATE TABLE IF NOT EXISTS` (no index, trigger or view);
      - the rows of `monthlyExportSql(table)` as `INSERT`s that name their columns, in one transaction;
    - values are exact: bigints, reals kept REAL, quotes, NUL as a cast blob, and blobs;
    - the output is opened `wx` with mode 600 and removed on any failure;
    - it prints only the table count and the byte size. A SQLite error prints only `errstr` (`safeMessage`), because SQLite's own message can quote part of a statement into the public log.
  - **`restore <finance.sql> <new.db>`:** reads the copy into a new SQLite file for the owner (runbook §3.6.3).
- **`scripts/backup-monthly-scope.json`** (new): `BACKUP_SCOPE` and every `monthlyExportSql(table)`, generated from `packages/db/src/backup-scope.ts`, which is used as it is (not edited). The runner installs only wrangler, so it can't import the TS module. The drift test regenerates the file and compares it (`UPDATE_BACKUP_SCOPE=1` rewrites it).
- **`.github/workflows/backup.yml`:**
  - a `monthly` boolean input;
  - the step "Is this run also the monthly copy": the run's UTC day is `01` or the box is ticked. It sets `FINANCE`, `FINANCE_ARCHIVE` and `FINANCE_OBJECT=monthly/techaust-prod-finance-<YYYY-MM>.tar`;
  - "Build and encrypt the monthly finance-only copy", straight after the daily encryption: no secret, `continue-on-error`;
  - "Delete the plaintexts" (`always()`; the `techaust-prod-*.sql` pattern covers both files);
  - the daily upload and check, unchanged;
  - the monthly upload and the listing check, `if: steps.monthly.outcome == 'success'`, with the manifest in the summary;
  - "Fail the run when the monthly copy failed", after the daily upload, so a monthly failure never costs the daily copy;
  - the archives and the key file removed on every path;
  - no new secret or variable.
- **`.github/workflows/deploy-prod.yml`:**
  - a new job `snapshot` (needs `guard`, `if: inputs.stage == 'full'`, `environment: backup`):
    - checks out the workflow's own commit with `persist-credentials: false`;
    - installs only `@techaust/deploy-tools` and checks the credentials;
    - runs `node scripts/fetch-catalogue-snapshot.mjs --env production --out apps/web/catalogue-snapshot.json` with `CF_API_TOKEN_BACKUP` and `WRANGLER_BIN`;
    - uploads the artifact `catalogue-snapshot-production` only when a snapshot was found;
  - `build`: `needs: [guard, snapshot]`, with an explicit condition: after a passed guard, and after a successful snapshot (or a skipped one on stage database). It downloads the artifact into `apps/web` after the install and before any build;
  - `deploy`: `if: !cancelled() && needs.build.result == 'success'`;
  - the header documents all of this.
- **`scripts/fetch-catalogue-snapshot.mjs`** (and its `.d.mts`):
  - `--env staging|production` (default staging; anything else, or a missing value, is refused before wrangler runs);
  - `envOf`, `wranglerArgs` and `runWrangler(env)`;
  - `main({env})` logs the environment.
  - The staging callers are unchanged.
- **`docs/runbooks/restore.md`:**
  - §1: a row for the 10-year copy;
  - §3.1: the policy and lifecycle notes;
  - new **§3.6**: what the monthly copy holds, how it is made, how to open and read it (including onto a schema built from the migrations), and the AWS changes;
  - the old §3.6 became §3.7.
- **`docs/runbooks/environments.md`:** a new "Production" section:
  - the resources and hosts, with no routes or domains in any config;
  - the GitHub environments;
  - the deploy workflow: its inputs, the four jobs, the single approval, the order and the health checks;
  - "after publishing in the production admin, run Deploy production (stage full)";
  - rollback per 08 §6.3 and incident §2.8;
  - the backups, with the access-method line.
- **Tests:**
  - `apps/web/test/backup-monthly.test.ts` (new, 26), on an export of the **real schema** (all 87 migrations through `node:sqlite`, every trigger written before the rows):
    - the scope file equals `backup-scope.ts`, and broken scope files are refused (7);
    - values round-trip exactly;
    - only the monthly tables come out: the invoice and accepted proposal kept, the open proposal and draft estimate dropped, their lines likewise; the numbered deed only; the pinned terms only;
    - finance audit rows only, with `ip` and `user_agent` absent; no lead or contact email;
    - an amount above 2^53 and quoted multi-line text kept exactly;
    - the copy also loads onto a migrated schema;
    - refusals (an unclassified table, a missing monthly table, an existing output) leave nothing behind;
    - a SQLite error's text never reaches the message;
    - the CLI's build, restore and refusals.
  - `apps/web/test/backup-workflow.test.ts`:
    - the order test extended (14 points);
    - plaintexts deleted after the last encryption, archives removed last;
    - two `aws s3 cp`;
    - a new block (10): the input, the decision, the build step's exact script with no secret, the monthly upload and check, and the failure step;
    - the decision run through bash with a stand-in `date` for 5 day/input cases.
  - `apps/web/test/deploy-workflow.test.ts`:
    - the guard and token tests updated (secrets now `CF_API_TOKEN_PROD`, `CF_API_TOKEN_BACKUP`, `CLOUDFLARE_ACCOUNT_ID`);
    - a new snapshot block (6): the job order, the environment and token, wrangler only and no ref, the fetch and conditional upload, the build and deploy conditions, and the download placed after the install and before the web build with no secret;
    - a `--env` block (3) for the fetcher.

### Commands and results
- `vitest run --project node test/backup-monthly.test.ts`: 26 passed.
- `test/backup-workflow.test.ts test/workflow-actor.test.ts`: 45 passed, 1 skipped (the existing "no bash or openssl" placeholder).
- `test/deploy-workflow.test.ts test/prod-deploy.test.ts`: 119 passed, 1 skipped.
- `packages/core`: `test/fetch-catalogue-snapshot.test.ts test/drill-verify.test.ts` (no coverage gate): 30 passed. Staging's use of the fetcher is unchanged.
- Strict YAML parse of both workflows (`yaml` 2.9.1, `uniqueKeys`): ok. Jobs `guard, snapshot, build, deploy`; 18 backup steps. actionlint is not installed.
- `bash tools/heavy.sh --log p7ops-web-test pnpm --filter @techaust/web test`: **exit 0, 48 files, 1180 passed, 21 skipped**.
- `bash tools/heavy.sh --log p7ops-check pnpm check` (the one whole-repository lint): **exit 0**. That covers lint, typecheck and every guard: web bindings, content lint, worker config, SPA headers, migrations (87), CSS collisions.

### The exact AWS changes the owner must make (before 2026-12-01; restore.md §3.6.4 has the clicks)
1. **The backup role's inline policy, in full** (replace `<bucket>`):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "PutBackups", "Effect": "Allow", "Action": "s3:PutObject",
      "Resource": ["arn:aws:s3:::<bucket>/daily/*", "arn:aws:s3:::<bucket>/monthly/*"] },
    { "Sid": "ListBackupPrefixes", "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::<bucket>",
      "Condition": { "StringLike": { "s3:prefix": ["daily/*", "monthly/*"] } } }
  ]
}
```
   The trust policy is unchanged. Still no GetObject, DeleteObject or DeleteObjectVersion.
2. **A lifecycle rule `monthly-10-years`**, filtered to the prefix `monthly/`:
   - expire current versions after **3653** days;
   - permanently delete noncurrent versions after **3653** days. Reason: a noncurrent version exists only after a same-month re-run or a misused put-only role, and keeping it can't lose a record.
   - The `daily/` rule (90 and 90 days) is unchanged.
3. No GitHub change. `deploy-prod.yml`'s `snapshot` job uses the existing `backup` environment and its `CF_API_TOKEN_BACKUP`. That token must be able to read the production D1. P7-N says it has D1 edit on the account; not verified here.

### Decisions I took (for the reviewer and the lead)
- **`node:sqlite`, not the `sqlite3` command-line tool.**
  - The brief says "the runner's sqlite3". Node's built-in SQLite is SQLite too, it needs nothing installed on the runner, and the same code runs in the tests on this PC, which has no `sqlite3` binary. So the whole path is tested here.
  - An in-memory database also means no plaintext database file on the runner's disk.
- **The copy carries its own table definitions** (`CREATE TABLE IF NOT EXISTS`, no index, trigger or view).
  - The brief assumed a rows-only copy restored "onto a schema built from the migrations". That path still works, and it is tested and documented in §3.6.3 step 5.
  - The copy also opens on its own in 10 years, when the migrations may have moved on: `backup-monthly.mjs restore` writes a plain SQLite file.
  - Neither path can load into a D1: D1 enforces foreign keys, and the copy leaves out `clients`/`contacts` on purpose. The runbook says so.
- **"The 1st" is the run's UTC day for any trigger**, plus the box. A manual daily run on the 1st also writes the month's copy; versioning keeps the earlier one.
- **The snapshot job checks out the workflow's own commit (main)**, not `inputs.tag`, so the code that runs with the token is main's. The build still builds `inputs.tag`.

### Gaps found (reported, not redesigned)
1. **`acceptances` goes into the 10-year copy whole**, including `ip`, `user_agent`, `country`, `email` and `typed_name`. `monthlyExportSql` takes every other monthly table whole (L48, 08-C RB-37). L35 removes the IP and the browser from `audit_log` for this copy, but an acceptance's IP and browser stay for 10 years. This may be intended as e-acceptance evidence. It is the lead's call whether `backup-scope.ts` should give `acceptances` a column list like `audit_log`'s. I did not edit `packages/db`.
2. **`documents.recipient`** (the client's name and address on each invoice) is in the copy. That is the tax record itself, as the owner's 2026-10-07 decision intends; noted only so nobody calls the copy "free of personal data". The runbook doesn't.

### Not verified
- **No hosted run.** Untested on GitHub or AWS: the `monthly/` upload under the new policy, the `backup` environment accepting the `snapshot` job, the production snapshot read with `CF_API_TOKEN_BACKUP`, and the explicit `if:` conditions on the job graph. The first `monthly` run by hand, and the first `full` production run, are the proof.
- The AWS console labels in §3.6.4 ("Expire current versions of objects", "Permanently delete noncurrent versions of objects") are from memory, not read from the console today.
- The real D1 export's format (still open from P7-N). The builder doesn't depend on the statement order, because triggers are never created. A `_cf_*` table is allowed, and a missing monthly table or an unclassified table stops the copy with a named reason.
- **Size:** the export is read whole into memory. That is fine for today's database; V8's string limit (~512 MB) sits just above D1 Free's 500 MB per database.

### Open questions
1. **Runs from a tag.** The `backup` environment accepts `main` only, so a production deploy started with "Use workflow from: <a v* tag>" fails at `snapshot`. Starting from main with `tag: v…` works, and the workflow header and environments.md say so. Should the `backup` environment also accept `v*` tags (a hosted change, the owner's yes)? Or is "always start from main" enough?
2. **Stage full on a database never migrated** fails at `snapshot` (no `site_snapshots` table). The launch order runs stage `database` first, and environments.md says so. Say if the job should instead treat a missing table as "nothing published".
3. Gap 1 above (`acceptances` IP and browser in the 10-year copy).

Usage: builder for P7 ops, claude-opus-5-5/high (the lead fills in the agent id from `node tools/model-audit.mjs`).

## Builder report 2
The lead's change (2026-11-07, settled on the safest reading): no contact's personal data in the 10-year copy. Commit 940dc303, plus this report; pushed to `fix/p7-ops-b1`. The lead answered open questions 1 and 2 with no change (launches run from main; stage database runs first).

### What changed
- **`packages/db/src/backup-scope.ts`** (the header cites "Settled by the lead on the safest reading, 2026-11-07 (08-C RB-12)"; RB-12 is the IP, browser and country of acceptance evidence. The lead decides whether 08-C needs its own row for the name and email):
  - **`acceptances`:** `ACCEPTANCE_EXPORT_COLUMNS` = `id`, `document_id`, `contact_id`, `session_id`, `accepted_at`, `pdf_sha256`, `terms_version_id`, `certificate_r2_key`, `via`, `offer_link_hash`, `snapshot_sha256`. `ACCEPTANCE_PERSONAL_COLUMNS` = `typed_name`, `email`, `ip`, `user_agent`, `country`, never exported. The column names were read from the migrated schema. A db test fails if a new acceptances column is in neither list.
  - **`documents`** (found in the check below): the export now names every column. The list comes from the Drizzle schema (`getTableColumns`), so a new column still joins the copy. `recipient` becomes `json_remove(recipient, '$.email', '$.contactName')` when it is valid JSON.
  - The client's `legalName`, `gstin`, `stateCode`, `address`, `country`, `contactId`, `clientType` and `deliveryAddress` stay. `contactName` is the "Attn:" line the invoice PDF prints (`packages/pdf/src/invoice-view.ts`). Rule 46 doesn't need it, and the PDFs in R2 are not part of this backup. The email isn't printed.
- **`scripts/backup-monthly.mjs`:** each table's definition in the copy is now its own (`copyTableSql`): exactly the columns the query returns, with production's declared types, and no constraint, index or trigger.
  - Why: production's `acceptances` declares `typed_name` and `email` NOT NULL, so production's own definition would refuse the stripped rows. In the copy, a left-out column isn't a column at all; `audit_log` there has no `ip` or `user_agent` column either.
  - Consequence: the copy no longer loads onto a schema built from the migrations. Its plain `CREATE TABLE` refuses over existing tables, so nothing is half-loaded. The runbook (restore.md §3.6.1, §3.6.3 step 5) says so; reading it with `backup-monthly.mjs restore` is unchanged.
  - `ifNotExists` is removed.
- **`scripts/backup-monthly-scope.json`:** regenerated (`UPDATE_BACKUP_SCOPE=1`); the drift test passes.
- **Tests:**
  - `apps/web/test/backup-monthly.test.ts` (27):
    - the acceptance row is kept with its ids, time, way, hashes and terms; its columns equal `ACCEPTANCE_EXPORT_COLUMNS`; none of the five personal columns exists; the typed name, email, IP, browser and country appear nowhere in the file;
    - the invoice's recipient block equals the original minus `email` and `contactName`, and neither value appears in the file; every documents column is still present;
    - `audit_log` has no `ip` or `user_agent` column in the copy;
    - the definitions hold no NOT NULL, PRIMARY KEY, REFERENCES or CHECK;
    - the copy refuses to run over a migrated schema (this replaces the "loads onto migrations" test).
  - `packages/db/test/retention.test.ts`, in workerd on D1:
    - the L48 test now also checks that the exported acceptance has only the kept columns and no name or email;
    - a new test checks that the acceptances columns are fully classified, that the export SQL names no personal column and no `SELECT *`, and that an issued invoice's exported recipient loses exactly `email` and `contactName` while keeping every documents column.

### Every other monthly table, checked column by column (all 26, from the migrated schema)
No other **column** holds a contact's name, email, phone, IP or browser. `payment_refunds.paid_to` is an enum (`original` or `own_account`); the `*_by` columns are staff ids; `audit_log.summary` holds ids, numbers, amounts and codes (core `FINANCE_AUDIT_ACTIONS`).

**Free-text fields that could contain such data, not stripped.** Each is part of the record itself; stripping it would need text redaction, not a column list. They are listed for the lead:
1. **`document_sections.body_md` of an accepted proposal or estimate:** the Acceptance text is filled with the contact's name when the draft is made (CLAUDE.md M4.3 "the contact token"). This is the accepted contract's text.
2. **`documents.decision_note`:** the client's optional free-text note when deciding (an accepted offer only, in this copy). It is not a tax record, so it is the likeliest candidate to blank (`NULL AS decision_note`, a one-line change) if the lead wants it.
3. **`deeds.snapshot` and `sched_*`:** the sealed deed text, which names the parties.
4. Staff-written notes: `payments.note`, `proof_ref`, `decision_note`, `withdraw_reason`; `payment_refunds.note`; the `realisation_*` notes; `bank_matches.statement_ref`; and document line and schedule `detail`.
5. **`documents.issuer`:** our own sender's name and email (staff, not a contact).

### Commands and results
- `bash tools/heavy.sh --log p7ops-db-test pnpm --filter @techaust/db test`: **exit 0, 62 files, 1093 passed**.
- `bash tools/heavy.sh --log p7ops-web-test2 pnpm --filter @techaust/web test`: **exit 0, 48 files, 1181 passed, 21 skipped**.
- `bash tools/heavy.sh --log p7ops-check2 pnpm check`: **exit 0** (lint, typecheck, every guard).
- `packages/core` `test/verify-tags.test.ts test/zod-import.test.ts`: 5 passed (the new comment tag is in the accepted form).

### Not verified
Unchanged from report 1: no hosted run. `json_remove` was checked on D1 (the workerd db test) and on node:sqlite (the builder).

- **Report 2 follow-up (lead, 2026-11-07, same safest reading):** `documents.decision_note` is exported as NULL in the monthly copy (`BLANKED_DOCUMENT_COLUMNS` in `backup-scope.ts`; scope JSON regenerated); the acceptance text, deed text and staff notes stay. Tests: web `backup-monthly` + `backup-workflow` 68 passed, 1 skipped; db `retention` 14 passed; `pnpm check` exit 0 (all through `tools/heavy.sh`).

## Builder report 4
Builder (Opus 5.5, high), branch `fix/p7-ops-b2` from `origin/feat/p7-ops` (d02a4a0a). Commit ef1b658e (the fixes) plus this report; pushed. No deploy, no hosted change, no secret, action SHA pins unchanged; no plaintext or signed link reaches any log.

**Skills loaded:**
- `aws-core:aws-storage`: shaped H1. Checked the versioned-bucket lifecycle against the S3 User Guide (Context7, `/websites/aws_amazon_s3`, "Lifecycle configuration examples"): expiring a current version adds a delete marker, the copy becomes noncurrent, and the noncurrent days count from then (their own example: 60 + 30 = "permanently removed 90 days after object creation").
- `aws-core:aws-iam`: confirmed the catch-up listing (prefix `monthly/techaust-prod-finance-<YYYY-MM>`) is matched by the existing `s3:ListBucket` condition `StringLike s3:prefix monthly/*`; no policy change.
- `cloudflare:wrangler`: kept wrangler free of AWS credentials. The AWS step moved after the export, and a test pins that order.

### The fixes
1. **H1, lifecycle days add up** (`docs/runbooks/restore.md` §3.1, §1 "How long", §3.6.4 b; `environments.md`):
   - a new §3.1 paragraph and table explain that every copy becomes noncurrent when it expires;
   - `expire-daily-90d` on `daily/`: current **60** + noncurrent **30**;
   - `monthly-10-years` on `monthly/`: current **3623** + noncurrent **30** (3,653 days in all);
   - "Number of newer versions to retain" stays empty in both rules.
   - **"Delete expired object delete markers" can't be ticked in these rules (see Open questions).** The S3 docs say "You can't specify both a `Days` and an `ExpiredObjectDeleteMarker` tag on the same rule"; the console docs (the S3 on Outposts page) say the box can't be chosen together with "Expire current versions". When current versions expire by age, S3 "detects and removes the expired object delete markers for you". The runbook says this instead of telling the owner to tick it.
2. **Unique monthly names** (`backup.yml`): `monthly/techaust-prod-finance-<YYYY-MM>-<YYYYMMDDTHHMMSSZ>.tar`.
   - The month, the day and the time come from one `date -u +%Y%m%dT%H%M%SZ` reading, so they can't straddle midnight.
   - The plaintext `techaust-prod-finance-<month>-<stamp>.sql` still matches the delete step's `techaust-prod-*.sql` pattern.
   - The runbook (§3.6.2 Where, §3.6.3 steps 1–3) and the header comment are updated.
3. **M1 catch-up** (`backup.yml`):
   - The new order: export, encrypt, AWS credentials, then the decision step "Is this run also the monthly copy", the monthly build and the plaintext deletion.
   - The AWS step moved from after the deletion to just after the daily encryption. The decision needs the listing, and wrangler never runs with AWS credentials.
   - The plaintext now waits only for the STS call and one listing before the monthly build, and the deletion stays `always()`.
   - The decision makes the copy on:
     - UTC day 01;
     - the `monthly` tick;
     - or when `aws s3api list-objects-v2 --prefix "monthly/techaust-prod-finance-$month" --query "Contents[0].Key" --output text` answers `None` (or nothing).
   - A failed listing makes the copy anyway, with a `::warning::`. If ListBucket were refused, the upload check would fail the run anyway.
   - The step runs under GitHub's default `bash -e`: the listing sits in an `elif` condition, so it can't abort the step.
   - The failure message now says the next night tries again by itself.
4. **L1:** restore.md §3.6.1 now reads "No contact's personal data outside the signed contract texts". A new bullet names those texts (an accepted offer's sections, a deed's sealed text) and the NULL decision note.
5. **L2** (`packages/db/src/backup-scope.ts`): **no CHECK guarantees valid JSON.** `documents.recipient` is a plain nullable `text` in `0000_init.sql:437`, with no CHECK and no trigger checking it (only the freeze triggers compare it).
   - New `RECIPIENT_EXPORT_SQL`: `CASE WHEN json_valid(recipient) THEN CASE WHEN json_type(recipient) = 'object' THEN json_remove(…) END END`.
   - Invalid JSON is NULL. So is valid JSON that isn't an object (a string, an array, a number), because `json_remove` would hand those back raw.
   - The cases are nested because `json_type` raises an error on invalid JSON.
   - `scripts/backup-monthly-scope.json` is regenerated; the drift test passes.

### Tests
- `apps/web/test/backup-workflow.test.ts` (46 passed, 1 skipped, the existing placeholder):
  - the order test (credentials after encryption and before the decision);
  - a new test: the AWS credentials come after the export, and no wrangler, pnpm or npx after them;
  - the adjacency of encrypt, AWS, decision, build and delete;
  - the decision strings (one `date` call, the listing command, `BACKUP_BUCKET` as env, no s3 cp, get or put);
  - the decision run through `bash -e` with stand-ins for `date` and `aws`, 8 cases:
    - day 01, or the tick: no listing is made;
    - day 15 with a copy listed: daily only;
    - days 02 and 28 with `None` listed: the copy is made (catch-up);
    - a refused listing: the copy is made, with the warning;
  - two runs in one month give two different object names.
- `packages/db/test/retention.test.ts` (15 passed): a new test checks the documents DDL in D1 (no `json_valid` or `json_type`) and `RECIPIENT_EXPORT_SQL` in the export. Then, on D1, a recipient that is not JSON, a JSON string, a JSON array or NULL is exported as NULL, and an object loses `email`; the made-up email never appears.
- `apps/web/test/backup-monthly.test.ts` (27 passed, with `UPDATE_BACKUP_SCOPE=1` to regenerate, then as the drift check inside the web run).

### Commands and results
- `bash tools/heavy.sh --log p7ops-b2-db-retention pnpm --filter @techaust/db exec vitest run test/retention.test.ts`: **exit 0, 15 passed**.
- `bash tools/heavy.sh --log p7ops-b2-web-test pnpm --filter @techaust/web test`: **exit 0, 48 files, 1186 passed, 21 skipped**.
- `bash tools/heavy.sh --log p7ops-b2-check pnpm check` (the one whole-repository lint): **exit 0**: lint, typecheck, every guard, migrations (87).
- `pnpm exec biome check` on the changed files: clean.

### Not verified
- **No hosted run:** the listing under the real role, the AWS step's new position and the catch-up on GitHub are unproven until the first run by hand.
- **The console's greyed-out "Delete expired object delete markers" box:** read from AWS's docs today (the general S3 guide for the API rule, and the S3 on Outposts console page), not from the console.

### Open questions
1. **H1's "Delete expired object delete markers" ticked** can't be done in `expire-daily-90d` or `monthly-10-years`, because AWS refuses it beside "Expire current versions" (quoted above), and it isn't needed: S3 removes those markers itself. If the owner already tried to tick it and the console refused, that's why. Only a separate rule with just that box would allow it. I did not add one to the runbook as a step; it is the lead's call.
