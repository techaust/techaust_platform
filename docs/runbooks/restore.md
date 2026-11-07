# Runbook: restore (docs/08 §6, NFR-7)

_Draft by analyst R, 2026-11-07._ Targets: RPO ≤ minutes within the Time Travel window and ≤ 24 h from the nightly copy; **RTO ≤ 4 h** (NFR-7). Every restore of production is a production action and needs the owner's yes for that action (rule 4). Commands run in PowerShell and name the repository in full.

## 1. Pick the path
| What happened | Path |
|---|---|
| A wrong change to a few rows or one table, inside the window | **Time Travel, "look back and copy"** (§2.2): the database is put back only for minutes |
| The whole database is damaged, inside the window | **Time Travel, full restore** (§2.3), then the reconciliation in §4 |
| Older than the window, or the database or account is lost | **S3 copy** (§3: the nightly encrypted backup, P7-N) |
| A finance or tax record older than the 90 days of the nightly copies (an assessment, an audit, a GST notice) | **The monthly finance-only copy** (§3.6, kept 10 years): read it, never restore production from it |
| A frozen PDF or file is missing from R2 | §5 |
| Bad code | §6 (code rollback never needs a database restore) |

**The window is 7 days on the Free plan and 30 days on Workers Paid** (Cloudflare Time Travel page, read 2026-11-07). Wrangler's own help says "within the last 30 days": that's the Paid figure. Bookmarks older than the window can't be used.

## 2. D1 Time Travel (in place only)
What Cloudflare says (Time Travel page, read 2026-11-07):
- Restore **overwrites the whole database in place**. There is no restore into a copy ("cloning or forking … not yet supported").
- In-flight queries and transactions are cancelled.
- A restore can be undone: its output prints the previous bookmark, and older bookmarks are kept.
- Timestamps: Unix seconds or RFC3339 (for example `2026-11-07T08:46:42.000Z`).

What it means here:
- A restore also rewinds the schema and `d1_migrations`. Re-apply migrations straight after a restore (§2.4); they are backward-compatible (05 §5.5).
- It rewinds `doc_counters`. Any number issued after the restore point would be issued again unless §4 is done first.
- R2, queues and the gateways are not rewound.
- **Never add `--json` to `restore`:** with `--json` wrangler skips its "OK to proceed (y/N)" question (installed wrangler 4.156.2).

### 2.1 Read a bookmark
The current one:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 time-travel info DB --env staging
```
The one for a past moment:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 time-travel info DB --env staging --timestamp=<RFC3339 time>
```
(Production: `--env production` after Phase 7 L3 binds `techaust-prod`.)

### 2.2 Look back and copy (a few rows)
1. Write the current bookmark into the log (**B0**).
2. Pick a quiet time:
   - not around :30 UTC (the hourly cron) or 22:00 UTC (the daily one);
   - no PR merging, because the staging deploy runs migrations.
   Writes made while the database is rewound are **lost** when it goes back to B0 (audit B6 M3). That includes:
   - a webhook event the gateway was told we received (its payment would never be recorded);
   - a document number issued in the window (the counter goes back, so the number would be issued twice);
   - an email row (it could be sent again).

   So, before step 3:
   - **Keep staff out:** tell everyone not to use the admin or the portal until step 5 is done.
   - **Pause the three queues' delivery** (messages are kept while paused; the crons only enqueue). Run this once per queue, with `<queue>` each of `techaust-staging-leads`, `techaust-staging-email` and `techaust-staging-pdf`:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler queues pause-delivery <queue>
```
     Both `pause-delivery` and `resume-delivery` exist in the installed wrangler 4.156.2 (checked 2026-11-07); neither has been run on staging yet.
3. Restore to the moment before the mistake. Wrangler asks "OK to proceed (y/N)"; answer `y`:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 time-travel restore DB --env staging --timestamp=<RFC3339 time>
```
4. Copy out what you need. Prefer a `SELECT … --json | Out-File -Encoding utf8 <file>`, which doesn't block. `wrangler d1 export … --table <name>` writes a file but makes the database unavailable while it runs.
5. Go back to B0:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 time-travel restore DB --env staging --bookmark=<B0>
```
   Then resume each queue (`wrangler queues resume-delivery <queue>`, same form) and do §4 step 3 (payments) for the rewound window: a webhook that arrived in it was answered but its row is gone.
6. Put the rows back. **Writing into frozen, append-only or triggered tables is Tier A:** the lead has the analyst check the SQL first. Many triggers refuse such inserts on purpose.
7. Write an audit row (actor `system`, summary `{"via":"cli","restore":"<ref>"}`) and a log entry.

### 2.3 Full restore to a moment
1. Do §2.2 steps 1–2, then step 3 without going back.
2. Re-apply migrations (§2.4).
3. Do §4 **before anyone issues a document or takes a payment**.

### 2.4 Re-apply migrations after any restore
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 migrations apply DB --remote --env staging
```

## 3. The S3 copy: nightly encrypted backups (P7-N)
_P7-N, 2026-11-07 (owner: "Nightly backups before launch"; the lead's decisions in [runs/p7-launch](../runs/p7-launch.md) P7-N)._ The workflow is `.github/workflows/backup.yml`; the envelope is `scripts/backup-encrypt.sh`; the owner opens a backup with `scripts/backup-decrypt.ps1`.

### 3.1 Backups: what runs and where they are
- **When:** every night at 21:10 UTC (02:40 IST), clear of the jobs Worker's :30 hourly tick and its 22:00 UTC run, because a remote export makes the database unavailable while it runs. The owner can also start it by hand (GitHub › Actions › "Backup D1 to S3" › Run workflow); only the owner (`techaust`) may start or re-run it.
- **What:** `wrangler d1 export DB --remote --env production` (the whole production D1: schema, rows, triggers, indexes and `d1_migrations`), then the OpenSSL envelope:
  - a fresh random key for each backup (32 random bytes, kept as 64 hex characters) encrypts the dump with `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -md sha256`;
  - that key is wrapped with the owner's RSA-4096 public key (`openssl pkeyutl -encrypt`, RSA-OAEP with SHA-256), the repo variable `BACKUP_PUBLIC_KEY_PEM`;
  - one `.tar` holds exactly `dump.sql.enc`, `key.bin.enc` and `manifest.json` (format `techaust-d1-backup/1`, the UTC time, byte sizes, the SHA-256 of the plaintext dump and of the public key).
  The plaintext dump is deleted on the runner straight after the encryption, also when a step failed. Nothing but the encrypted archive leaves the runner; nothing goes into an artifact, a cache or the log.
- **Where:** the private S3 bucket named by the repo variable `BACKUP_BUCKET`, region **ap-south-1 (Mumbai)**, under `daily/`, one object per night: `daily/techaust-prod-YYYYMMDDTHHMMSSZ.tar` (UTC). The run's summary (Actions › the run › Summary) shows the object name, its size and the manifest.
- **How long:** **90 days** after the upload, by the bucket's lifecycle rule `expire-daily-90d` (§3.1: current versions expire after 60 days, then the expired, noncurrent copy is deleted 30 days later). The workflow can't delete or read objects: its role may only put objects under `daily/` and `monthly/` and list those two prefixes.
- **Once a month** the same run also makes the finance-only copy kept 10 years, under `monthly/` (§3.6).
- **The private key** is `backup-private.pem`, made once by `scripts/make-backup-key.ps1` into `D:\Business\1. Parent Project\TecHaust Technologies\Backup-Keys\` (outside the repository), with an offline copy. **Without it no backup can be opened.** Never put it in the repository, in chat or in a cloud folder.
- **Why the export's output is never printed:** wrangler 4.156.2 prints a one-hour signed download link of the **plaintext** export, and the Actions logs of this public repository are public. The workflow writes wrangler's output to a private file and prints it only on failure, with links removed.

What the workflow needs (the lead's hosted setup, each with the owner's yes; the workflow fails by name while one is missing):
| Name | Kind | Holds |
|---|---|---|
| `backup` | GitHub environment | the secret below; deployment branch `main` |
| `CF_API_TOKEN_BACKUP` | secret, environment `backup` | a Cloudflare API token with D1 permission only |
| `CLOUDFLARE_ACCOUNT_ID` | repository secret | (already used by the deploys) |
| `AWS_BACKUP_ROLE_ARN` | repository variable | the IAM role the workflow assumes by GitHub OIDC (no AWS key is stored anywhere) |
| `BACKUP_BUCKET` | repository variable | the bucket name |
| `BACKUP_PUBLIC_KEY_PEM` | repository variable | the owner's public key (`scripts/make-backup-key.ps1` sets it) |

The role, as the workflow expects it:
- trust: the GitHub OIDC provider `token.actions.githubusercontent.com`, audience `sts.amazonaws.com`, subject exactly `repo:techaust/techaust_platform:environment:backup`;
- permissions: `s3:PutObject` on `arn:aws:s3:::<bucket>/daily/*` and `arn:aws:s3:::<bucket>/monthly/*`, and `s3:ListBucket` on `arn:aws:s3:::<bucket>` with the condition `s3:prefix` like `daily/*` or `monthly/*`; nothing else (no GetObject, no DeleteObject). The exact policy is in §3.6.4;
- the bucket: Block Public Access on, default encryption on, **versioning on** (P7 re-check M1, 08 §6: an overwrite by the put-only role keeps the earlier version, and the role has no DeleteObjectVersion), the lifecycle rule `expire-daily-90d` on `daily/`, and the 10-year rule `monthly-10-years` on `monthly/` (§3.6.4).

**The lifecycle rules, and why their days add up.** The bucket is versioned, so "Expire current versions of objects" deletes nothing: it adds a delete marker and the copy becomes a **noncurrent** version. Every copy therefore becomes noncurrent when it expires, and "Permanently delete noncurrent versions of objects" then counts its days **from that moment**. A copy lives the sum of the two numbers (AWS, S3 User Guide › Lifecycle configuration examples: current versions expired at 60 days plus noncurrent versions deleted 30 days later "permanently removed 90 days after object creation"). So:
| Rule | Prefix filter | Expire current versions after | Permanently delete noncurrent versions after | A copy is gone after |
|---|---|---|---|---|
| `expire-daily-90d` | `daily/` | **60** days | **30** days | 90 days |
| `monthly-10-years` | `monthly/` | **3623** days | **30** days | 3,653 days (10 years, with the leap days) |

In both rules leave "Number of newer versions to retain" empty. "Delete expired object delete markers" (the marker left once its copy is permanently deleted): AWS doesn't let that box be ticked in a rule that also expires current versions (the console greys it out; the API refuses `ExpiredObjectDeleteMarker` beside `Days`), and the S3 User Guide says that when current versions expire by age, "Amazon S3 detects and removes the expired object delete markers for you". So there is nothing more to tick in these two rules. (Only if markers ever should go at once would a separate rule with that one box be added; it isn't needed.)

### 3.2 Download a backup (AWS console)
1. Sign in to the AWS console (the TecHaust account) and switch the region to **Asia Pacific (Mumbai) ap-south-1**.
2. Open **S3**, then the backup bucket, then the folder **daily/**.
3. Tick the object of the night you need (`techaust-prod-<date and time>.tar`; the times are UTC) and click **Download**.
4. Save it into this folder (git-ignored), creating it if needed:
   `D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\.logs\drill\`

### 3.3 Open (decrypt) it on your PC
Run this in PowerShell. It asks for the path of the `.tar` and the path of `backup-private.pem` (paths copied with "Copy as path" are fine):
```
powershell -ExecutionPolicy Bypass -File "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\scripts\backup-decrypt.ps1"
```
- It uses the OpenSSL that comes with Git for Windows (found automatically) and the `tar` in Windows.
- It unwraps the backup's key, decrypts the dump, checks the size and SHA-256 against the manifest, and writes `techaust-prod-<date and time>.sql` **next to the `.tar`**. It never overwrites a file.
- If the private key has a passphrase, OpenSSL asks for it in the same window. Nothing secret is printed.
- The last line is `RESULT: OK: …` or `RESULT: FAILED: …`. "the key could not be unwrapped" means the wrong `backup-private.pem` (the message names the public key the backup was made for).
- **The `.sql` holds production data: keep it private and delete it (and the `.tar`) after the drill or the restore.**

The same by hand (for the lead, from Git Bash in a folder holding the extracted parts), if the script can't run:
```
openssl pkeyutl -decrypt -inkey backup-private.pem -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256 -in key.bin.enc -out key.bin
```
```
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -in dump.sql.enc -out dump.sql -pass file:key.bin
```
Then compare `openssl dgst -sha256 dump.sql` with `plaintext.sha256` in `manifest.json`, and delete `key.bin`.

### 3.4 Restore drill (Phase 7 L7, then every quarter)
The drill proves a backup opens, loads and holds what the code says it must. Write the entry in [drill-log.md](drill-log.md) (its template) as you go. Use the newest backup.
1. **Download and open** the backup (§3.2, §3.3).
2. **Check the file's order** (drill-log.md step 2): the line of the first `CREATE TRIGGER` and of the last `INSERT INTO`. If the file has a `_cf_KV` table, stop and tell the lead.
3. **Restore and verify locally** with `pnpm drill:verify` (`scripts/drill-verify.mjs`). It works **only on a local scratch database** (it never touches a remote one): `--import` loads the file into a fresh one (schema, then rows, then triggers, whatever the file's order; transactions dropped), then checks row counts, numbering against `doc_counters`, the ledger, the audit tail, every trigger of `TRIGGER_SETS` and the migration count. It refuses a `--persist-to` folder that already holds a database.
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" drill:verify -- --import "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\.logs\drill\techaust-prod-<date and time>.sql" --persist-to "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\.wrangler\drill-<date>"
```
   It ends with a pass, or the list of problems (exit 1): a problem stops the drill; tell the lead.
4. **Load it into a scratch D1 on Cloudflare** (proves Cloudflare accepts the file for a real restore):
   1. the lead creates an empty D1 `techaust-restore-<date>` (APAC) through the connector;
   2. **always split the file first** (first production drill, 2026-11-07: D1's export puts `CREATE VIEW issue_guard` last, after the trigger created on it, so a straight load fails): `node scripts/drill-split.mjs <the .sql> "…\.logs\drill\parts"` writes `part-1-schema.sql`, `part-2-data.sql`, `part-3-triggers.sql` in drill-verify's `loadOrder`;
   3. load the three parts in that order, one command each (wrangler finds the database by name; add `-y` or answer `y`), e.g. for the first part:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 execute techaust-restore-<date> --remote -y --file "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\.logs\drill\parts\part-1-schema.sql"
```
   then the same with `part-2-data.sql`, then `part-3-triggers.sql`;
   4. compare a few counts with step 3's printed counts (`audit_log`, `documents`, `d1_migrations`), one command each, for example:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 execute techaust-restore-<date> --remote --command "SELECT count(*) AS n FROM audit_log"
```
   `drill:verify` can't check this remote copy (it reads local databases only); the counts are the check.
5. **Clean up:** the lead deletes the scratch D1 `techaust-restore-<date>` (connector); delete `.wrangler\drill-<date>`, the `.sql`, the `.tar` and the `parts` folder from `.logs\drill\`.
6. **Record it:** finish the drill-log entry (times, results, RTO), and, after the first drill on the production backup (L7), set `scripts/backup-verified.json` to `{"verifiedOn": "YYYY-MM-DD", "restoreDrill": true}` (the drill's date) in a commit. Until then `scripts/check-prod-readiness.mjs` blocks the production deploy (stage full).

### 3.5 A real restore from the S3 copy
Steps 1–4 of §3.4 on the chosen night's backup, with the scratch D1 named for the incident, then:
1. either point every Worker's `DB` binding at the restored D1, or copy rows back (Tier A SQL, checked by the analyst);
2. the reconciliation in §4 before anyone issues a document or takes a payment;
3. record it.

Pointing the bindings means the `database_id` in `apps/admin/wrangler.jsonc`, `wrangler.api.jsonc`, `wrangler.finance.jsonc`, `wrangler.invoices.jsonc`, `apps/portal/wrangler.jsonc` and `apps/jobs/wrangler.jsonc` (each `env.production`), then an approved deploy.

### 3.6 The monthly finance-only copy (kept 10 years)
_P7 ops, 2026-11-07 ([runs/p7-ops](../runs/p7-ops.md); PRD JOB-BKP-01; 08 §6.1; owner 2026-10-07; T7 F1)._ GST and income-tax records must outlive the 90 days of the nightly copies, but erased personal data must not. So once a month a second, smaller copy is kept for **10 years**, holding only what `packages/db/src/backup-scope.ts` marks `finance_monthly`.

#### 3.6.1 What it holds
- The tables and rows `monthlyExportSql` keeps: the invoice family (proformas, tax and export invoices, credit and debit notes, receipts and vouchers) with their lines, sections and schedules; accepted proposals and estimates (the version accepted), their acceptances and certificates; `doc_counters`; payments, allocations, refunds, the realisation tables, settlements, bank matches; `care_invoices`, `fx_rates`; the numbered deeds; the terms versions and blocks that a sent document or an acceptance pins; the care plans' terms and status history; and the **finance** rows of `audit_log` **without** the IP address and the browser.
- **No contact's personal data outside the signed contract texts** (lead, 2026-11-07, on the safest reading; the privacy notice says long-term archive copies hold only invoices, payments and other tax records):
  - an acceptance keeps only the evidence that a document was accepted (its ids, time, way, PDF and snapshot hashes, terms version, certificate key). It never keeps the typed name, the email, the IP address, the browser or the country;
  - a document's frozen recipient block keeps the client's legal name, GSTIN, state, address and country, which Rule 46 needs. It never keeps the contact's name or the email. A recipient block that isn't a JSON object (none should exist; the column has no check that it is one) is left out whole (NULL), never copied raw;
  - a client's own free-text note when deciding on an offer is left out (NULL);
  - the signed contract texts stay as they were accepted or signed: an accepted proposal's or estimate's section text (its Acceptance text names the contact) and a numbered deed's sealed text (it names the parties). They are the contract itself.
- Never: leads, contacts, clients, never-accepted proposals and estimates, emails, files, sessions, or any table `backup-scope.ts` marks `rolling_only`.
- Each monthly table has its own definition in the copy: exactly the columns kept, with production's types, and **no constraint, index, trigger or view**. A left-out column, such as an acceptance's typed name, isn't even a column in the copy. The copy is a record to read, not a database to run the system on.

#### 3.6.2 How it is made
- **When:** in the nightly run (`.github/workflows/backup.yml`) whose UTC day is the 1st of the month (02:40 IST on the 2nd), in any run the owner starts by hand with **monthly** ticked (Actions › "Backup D1 to S3" › Run workflow › tick "monthly"), and **in any nightly run while the bucket lists no copy for the current UTC month** under `monthly/techaust-prod-finance-<YYYY-MM>`. That last rule is the catch-up: if the run on the 1st was missed or its monthly copy failed, the next night makes it. (A month whose every night fails is not caught up once the month has ended; the next month's copy then holds everything that copy would have.) If the listing itself fails, the run makes the copy anyway and shows a warning. The first copy is due on 2026-12-01.
- **How:** after the night's export is encrypted, the workflow signs in to AWS (after the export, so wrangler never runs with AWS credentials) and decides whether this run makes the monthly copy; then `scripts/backup-monthly.mjs build` reads the plaintext export on the runner into an in-memory SQLite (no database file on disk; triggers never created), checks that every table of the export is classified by `BACKUP_SCOPE` and that every monthly table is there (otherwise it writes nothing and the run fails), and writes the finance-only SQL. That file is encrypted with the same envelope (§3.1), and both plaintexts are deleted at once, on every path.
- **Where:** `monthly/techaust-prod-finance-<YYYY-MM>-<YYYYMMDDTHHMMSSZ>.tar` in the same bucket (the month and the time are the run's, in UTC; for example `monthly/techaust-prod-finance-2026-12-20261201T211012Z.tar`), checked by listing as the nightly copy is. The run's summary shows it under "Monthly finance-only copy". Every copy has its own name, so a second run in the same month adds a second copy and never replaces the first.
- **If it fails:** the night's daily copy is still uploaded, then the run fails with "The monthly finance-only copy failed". Fix the cause; the next nightly run tries again by itself while the month has no copy, or start the workflow by hand with **monthly** ticked to make it sooner.
- **The scope file:** the runner has no workspace packages installed, so the script reads `scripts/backup-monthly-scope.json`. It is generated from `backup-scope.ts`, and `apps/web/test/backup-monthly.test.ts` fails if the two differ. After changing `backup-scope.ts`, regenerate it (from the repository folder) and commit it:
```
$env:UPDATE_BACKUP_SCOPE = "1"; pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\apps\web" exec vitest run --project node test/backup-monthly.test.ts; Remove-Item Env:UPDATE_BACKUP_SCOPE
```

#### 3.6.3 How to open and read it
1. **Download** it as in §3.2, from the folder **monthly/** (`techaust-prod-finance-<YYYY-MM>-<date and time>.tar`; if the month has more than one, take the newest, unless an older one is needed), into `.logs\drill\`.
2. **Decrypt** it with `scripts/backup-decrypt.ps1` exactly as in §3.3 (same envelope, same private key). It writes `techaust-prod-finance-<YYYY-MM>-<date and time>.sql` next to the `.tar`.
3. **Read it into a new SQLite file** (Node 24 only; nothing to install):
```
node "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\scripts\backup-monthly.mjs" restore "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\.logs\drill\techaust-prod-finance-<YYYY-MM>-<date and time>.sql" "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\.logs\drill\finance-<YYYY-MM>.db"
```
   It prints each table's row count (compare them with the `-- Rows:` line at the top of the `.sql`) and never writes over an existing file. Foreign keys are off in that file, because the copy leaves out the clients and contacts they point at.
4. **Read the records** with any SQLite tool, or through Node (`node:sqlite`); the lead can help. Never load the copy into a production or staging D1: Cloudflare's D1 enforces foreign keys, and the copy deliberately lacks the tables they point at.
5. **Not onto a schema built from the migrations.** The copy creates its own tables and refuses to run over existing ones. Production's definitions would refuse its rows anyway: the columns left out, such as an acceptance's typed name and email, are required there. If a later tool needs the rows in today's shape, the lead copies them across column by column from the restored file.
6. **Clean up:** delete the `.tar`, the `.sql` and the `.db` from `.logs\drill\` when done. They hold invoices and payments.

#### 3.6.4 The AWS changes the owner makes before 2026-12-01 (lead gives the clicks)
**a. The role's inline policy** (IAM › Roles › the backup role, the one named by `AWS_BACKUP_ROLE_ARN` › Permissions › its inline policy › Edit › JSON). Replace `<bucket>` with the bucket name. The whole policy, with `monthly/` added beside `daily/`:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PutBackups",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": [
        "arn:aws:s3:::<bucket>/daily/*",
        "arn:aws:s3:::<bucket>/monthly/*"
      ]
    },
    {
      "Sid": "ListBackupPrefixes",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::<bucket>",
      "Condition": {
        "StringLike": { "s3:prefix": ["daily/*", "monthly/*"] }
      }
    }
  ]
}
```
Nothing else changes: no GetObject, no DeleteObject, no DeleteObjectVersion; the trust policy stays as in §3.1. If the policy in AWS holds anything this one doesn't, stop and tell the lead before saving. The workflow lists with two prefixes, both matched by `monthly/*`: the month's (`monthly/techaust-prod-finance-<YYYY-MM>`, to decide whether this night makes the month's copy) and the uploaded object's full key (to check its size).

**b. The lifecycle rules** (S3 › the bucket › Management; why the days add up: §3.1). The days are counted by S3 from each copy's upload, then from the day it expired:
1. **Change the `daily/` rule** to: name `expire-daily-90d`; prefix `daily/`; "Expire current versions of objects" after **60** days; "Permanently delete noncurrent versions of objects" after **30** days (number of newer versions to retain: empty). A daily copy is then gone 90 days after its upload, as before the bucket was versioned. (With 90 and 90, a copy lived 180 days.)
2. **Create** `monthly-10-years`: scope "Limit the scope of this rule using one or more filters", prefix `monthly/`; "Expire current versions of objects" after **3623** days; "Permanently delete noncurrent versions of objects" after **30** days (number of newer versions to retain: empty). A monthly copy is then gone **3,653 days** (10 years, with the leap days) after its upload.
3. "Delete expired object delete markers": AWS greys this box out in a rule that expires current versions, and removes those markers by itself in that case (§3.1). Nothing to tick.
- Every copy has its own name, so an expired copy is never replaced by a newer one; it becomes noncurrent only by expiring (or by the put-only role being misused), and the 30 days then run.

**c. Check:** after the next run by hand with **monthly** ticked, the run's summary shows "Monthly finance-only copy" and the object appears under `monthly/`. (Once a copy for the month is there, the nightly runs make no other copy that month unless the 1st comes or **monthly** is ticked.)

### 3.7 Known points
- **The monthly copy's restore** is a read, not a production restore (§3.6.3). Object Lock on the bucket is the lead's hosted choice, not something the workflows need.
- **A remote export blocks the database while it runs** (wrangler's prompt; D1 docs): hence 02:40 IST, away from the jobs crons.
- D1's import rules (Cloudflare import and export page): no `BEGIN TRANSACTION`/`COMMIT` and no `_cf_KV` table; one file ≤ 5 GiB; "Statement too long" means splitting an `INSERT`. There are no virtual tables in our migrations (checked 0000–0079), so export works.
- Scheduled workflows of a public repository are switched off by GitHub after 60 days without repository activity; the run history (Actions) shows a missing night.

## 4. After a restore that loses recent work: reconcile before reopening
Anything made after the restore point exists outside D1: PDFs and envelopes in R2, emails, and payments at the gateways.
1. **Document numbers.**
   - List the R2 keys under `docs/<type>/<fy>/` newer than the restore point (R2 › `…-docs` › Objects, or the lead read-only). The key holds the number (`<number>-v<version>`).
   - **Deeds** (series `deed`, `TH/DA/{FY}/{N}`) aren't in those keys: their PDFs sit under `deeds/<id>/unsigned-<sha>.pdf`. Read the number from each sealed deed snapshot or signed upload newer than the restore point (audit B6 L12).
   - For each series and FY, set the counter **past** the highest number found. `doc_counters.next_no` may only rise (trigger), so this is allowed; the SQL is Tier A, checked by the analyst.
   - Otherwise a new issue takes a number a client already holds. Jobs would then refuse its PDF ("a different envelope already holds the key").
2. **Lost documents:**
   - The sealed envelope JSON in R2 holds every word. Record each lost document in the log.
   - Rebuilding its row from the envelope needs a Tier A tool (incident.md F8). Until then, issue nothing for that client and tell the owner.
3. **Payments:**
   - Razorpay: **Payments › Reconciliation › Fetch now**, then the unmatched lists.
   - Stripe and PayPal: the gateways' own lists for the window.
   - Every money write re-fetches from the gateway, so record each missing payment through the normal screens. Never by SQL.
4. **PDFs made after the restore point for rows that now say "no PDF"** fix themselves: jobs adopts an object already at its key (`apps/jobs/src/pdf.ts`, "found already stored"). The daily `pdf.sweep` and hourly `receipt.sweep` do it, or use **Retry** on the document.
5. Re-run `pnpm drill:verify` against the restored database (when it accepts a remote target) and record the result.

## 5. Re-rendering PDFs: which work renders what
| Kind | Makes | Who asks |
|---|---|---|
| `pdf.snapshot` | the sealed envelope (JSON) of a sent document | send, issue |
| `pdf.render` | the client PDF of a proposal, estimate or invoice-family document | after the snapshot; Retry |
| `pdf.supplier` | DUPLICATE FOR SUPPLIER | `GET /invoices/:id/pdf/supplier` |
| `pdf.certificate` | an acceptance certificate | Accept |
| `pdf.statement` | a statement PDF (30-day cache) | statement download |
| `pdf.deed` | a deed of assignment | Finalise |
| `receipt.issue` → `receipt.render` | a receipt | payment confirm; `receipt.sweep` |
| `pdf.sweep`, `receipt.sweep` | find rows still without a PDF | daily and hourly crons |

All of them render **only when the row has no PDF yet** and never overwrite a key. A row with a PDF hash whose object is missing is an incident (incident.md step 4). Browser Run allows 10 minutes a day and one request every 10 s on Free (Browser Run limits page, read 2026-11-07). A large re-render must be paced over days.

## 6. Code rollback
See incident.md §2.8 for the commands, the order and the secrets warning. Data and migrations are not rolled back. A rollback is never a data fix.

## 7. Cut-over (Phase 7 L8)
At L8 the old `techaust-web` Worker is **deleted first**, then techaust.com is attached to the new `web` Worker. **There is no fallback to the old site** (owner, 2026-11-03; 08 §6.3). A problem after the cut-over is fixed forward, or the new `web` Worker is rolled back to its previous version (§6). DNS and custom-domain changes need the owner's yes at the time.

