# Runbook: restore (docs/08 §6, NFR-7)

_Draft by analyst R, 2026-11-07._ Targets: RPO ≤ minutes within the Time Travel window and ≤ 24 h from the nightly copy; **RTO ≤ 4 h** (NFR-7). Every restore of production is a production action and needs the owner's yes for that action (rule 4). Commands run in PowerShell and name the repository in full.

## 1. Pick the path
| What happened | Path |
|---|---|
| A wrong change to a few rows or one table, inside the window | **Time Travel, "look back and copy"** (§2.2): the database is put back only for minutes |
| The whole database is damaged, inside the window | **Time Travel, full restore** (§2.3), then the reconciliation in §4 |
| Older than the window, or the database or account is lost | **S3 copy** (§3: the nightly encrypted backup, P7-N) |
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
- **When:** every night at 21:30 UTC (03:00 IST), before the jobs Worker's 22:00 UTC cron, because a remote export makes the database unavailable while it runs. The owner can also start it by hand (GitHub › Actions › "Backup D1 to S3" › Run workflow); only the owner (`techaust`) may start or re-run it.
- **What:** `wrangler d1 export DB --remote --env production` (the whole production D1: schema, rows, triggers, indexes and `d1_migrations`), then the OpenSSL envelope:
  - a fresh random key for each backup (32 random bytes, kept as 64 hex characters) encrypts the dump with `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -md sha256`;
  - that key is wrapped with the owner's RSA-4096 public key (`openssl pkeyutl -encrypt`, RSA-OAEP with SHA-256), the repo variable `BACKUP_PUBLIC_KEY_PEM`;
  - one `.tar` holds exactly `dump.sql.enc`, `key.bin.enc` and `manifest.json` (format `techaust-d1-backup/1`, the UTC time, byte sizes, the SHA-256 of the plaintext dump and of the public key).
  The plaintext dump is deleted on the runner straight after the encryption, also when a step failed. Nothing but the encrypted archive leaves the runner; nothing goes into an artifact, a cache or the log.
- **Where:** the private S3 bucket named by the repo variable `BACKUP_BUCKET`, region **ap-south-1 (Mumbai)**, under `daily/`, one object per night: `daily/techaust-prod-YYYYMMDDTHHMMSSZ.tar` (UTC). The run's summary (Actions › the run › Summary) shows the object name, its size and the manifest.
- **How long:** **90 days**, by the bucket's lifecycle rule (expire objects under `daily/` after 90 days). The workflow can't delete or read objects: its role may only put objects under `daily/` and list `daily/`.
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
- permissions: `s3:PutObject` on `arn:aws:s3:::<bucket>/daily/*`, and `s3:ListBucket` on `arn:aws:s3:::<bucket>` with the condition `s3:prefix` like `daily/*`; nothing else (no GetObject, no DeleteObject);
- the bucket: Block Public Access on, default encryption on, the 90-day lifecycle rule on `daily/`.

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
   2. if step 2 found the first `CREATE TRIGGER` **before** the last `INSERT INTO`, or the file holds `BEGIN TRANSACTION`/`COMMIT`, stop: the file needs splitting first (the lead; drill:verify's `loadOrder` shows the order it uses);
   3. load it (wrangler finds the database by name; it asks to confirm, answer `y`):
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 execute techaust-restore-<date> --remote --file "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\.logs\drill\techaust-prod-<date and time>.sql"
```
   4. compare a few counts with step 3's printed counts (`audit_log`, `documents`, `d1_migrations`), one command each, for example:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 execute techaust-restore-<date> --remote --command "SELECT count(*) AS n FROM audit_log"
```
   `drill:verify` can't check this remote copy (it reads local databases only); the counts are the check.
5. **Clean up:** the lead deletes the scratch D1 `techaust-restore-<date>` (connector); delete `.wrangler\drill-<date>`, the `.sql` and the `.tar` from `.logs\drill\`.
6. **Record it:** finish the drill-log entry (times, results, RTO), and, after the first drill on the production backup (L7), set `scripts/backup-verified.json` to `{"verifiedOn": "YYYY-MM-DD", "restoreDrill": true}` (the drill's date) in a commit. Until then `scripts/check-prod-readiness.mjs` blocks the production deploy (stage full).

### 3.5 A real restore from the S3 copy
Steps 1–4 of §3.4 on the chosen night's backup, with the scratch D1 named for the incident, then:
1. either point every Worker's `DB` binding at the restored D1, or copy rows back (Tier A SQL, checked by the analyst);
2. the reconciliation in §4 before anyone issues a document or takes a payment;
3. record it.

Pointing the bindings means the `database_id` in `apps/admin/wrangler.jsonc`, `wrangler.api.jsonc`, `wrangler.finance.jsonc`, `wrangler.invoices.jsonc`, `apps/portal/wrangler.jsonc` and `apps/jobs/wrangler.jsonc` (each `env.production`), then an approved deploy.

### 3.6 Known points and what is not built
- **Not built yet:** the monthly finance-only copy kept 10 years (owner 2026-10-07; PRD JOB-BKP-01; T7 F1 `BACKUP_SCOPE`: it leaves out proposals and estimates). A table-filtered export carries no triggers and no indexes (the local export code keeps an index or trigger only if its own name is in `--table`), so that copy must be restored onto a schema built from the migrations. Object Lock and versioning on the bucket are the lead's hosted choice, not something the workflow needs.
- **A remote export blocks the database while it runs** (wrangler's prompt; D1 docs): hence 03:00 IST.
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

