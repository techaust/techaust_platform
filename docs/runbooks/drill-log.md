# Restore drill log (NFR-7: RTO ≤ 4 h)

_Draft by analyst R, 2026-11-07._ One entry per drill, newest first. The quarterly drill on the production backup is part of Phase 7 L7. M7.5 runs the first drill on **staging** (owner Q5 A, 2026-11-01): a read-only copy restored locally, and one Time Travel rewind of staging and back. Exports hold staging data: keep them in `.logs\drill\` (git-ignored) and delete them after the entry is written.

## How to run the staging drill (M7.5)
The clock starts at step 1 and stops when `drill:verify` passes. The RTO also counts the steps a real restore adds (creating the database, pointing the bindings, deploying); write your estimate of them in the entry.

1. **Copy staging (read-only).** Wrangler asks "Ok to proceed?": staging is unavailable to queries while the export runs.
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 export DB --remote --env staging --output "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\.logs\drill\staging-<date>.sql"
```
2. **Check the order in the file (the risk to prove).** Find the first `CREATE TRIGGER` and the last `INSERT INTO`. The local export code writes `PRAGMA defer_foreign_keys=TRUE` first, then tables with their rows, then indexes and triggers last, so inserts never fire triggers. Cloudflare's remote format is **unverified**; this step proves it.
```
Select-String -Path "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\.logs\drill\staging-<date>.sql" -Pattern "^CREATE TRIGGER" | Select-Object -First 1 LineNumber
```
```
Select-String -Path "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\.logs\drill\staging-<date>.sql" -Pattern "^INSERT INTO" | Select-Object -Last 1 LineNumber
```
   This step is for the record only: `drill:verify --import` (step 3) loads schema, then data, then triggers whatever the file's order, and drops `BEGIN TRANSACTION`/`COMMIT`. Write in the entry whether the remote file had triggers last. If the file has a `_cf_KV` table, stop and tell the lead.
3. **Restore and verify in one step** into a fresh local scratch database (separate from the dev database; the script refuses `--remote`, applies no migrations first because the file carries the schema and `d1_migrations`, and verifies the same database it loaded):
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" drill:verify -- --import "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\.logs\drill\staging-<date>.sql" --persist-to "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\.wrangler\drill-<date>"
```
4. **Read the result.** The script prints each check and ends with a pass or the list of problems. To run the checks again on the same database without loading it, drop `--import` and keep the same `--persist-to`.
   What it checks (I4):
   - row counts per table, compared with the same counts read from staging just before the export;
   - the last number per series and FY against `doc_counters` (no gaps);
   - the ledger recomputed against the stored figures;
   - the audit tail (the newest rows match);
   - every trigger of every set in `packages/db/src/triggers.ts` (`TRIGGER_SETS`) present;
   - the migration count against `packages/db/migrations` (81 files, 0000–0080, in M7.5).
5. **Clean up:** delete `.wrangler\drill-<date>` and the export.
6. **The Time Travel rehearsal** (only with the owner's yes at the time; question QB):
   1. `time-travel info` (save **B0**);
   2. read `SELECT count(*) FROM audit_log`;
   3. restore to a moment 10–30 minutes earlier and after the last migration (`SELECT max(applied_at) FROM d1_migrations`);
   4. read the count again (lower or equal);
   5. `restore --bookmark=<B0>` and read the count again (it must equal step 2);
   6. re-apply migrations (restore.md §2.4) and run the health checks.
   Never use `--json` on a restore. Writes made while rewound are lost: note any cron or queue work in that window.

## Template
```
### <date>: <staging copy | Time Travel rehearsal | production backup (L7, quarterly)>
- Who: <lead / owner>; owner's yes: <reference>
- Source: <database>, export file <name, size>; bookmark B0 <…>
- Times (IST): start <hh:mm>; export done <…>; import done <…>; verify passed <…>; total <h:mm>
- Trigger order in the file: first CREATE TRIGGER line <n>, last INSERT line <n>: <safe / split needed>
- drill:verify: row counts <pass/fail>; numbers vs counters <pass/fail>; ledger <pass/fail>; audit tail <pass/fail>; triggers <n of n>; migrations <n of n>
- Time Travel: count before <n>, rewound <n>, after return <n>; migrations re-applied <yes/no>; health checks <pass/fail>
- Steps a real restore adds (estimate): <create D1, import remote, bindings, deploy: h:mm>
- RTO ≤ 4 h: <met / not met>
- Issues and follow-ups: <…>
- Clean-up: scratch DB and export deleted <yes/no>
```

## Entries


### 2026-11-07: production backup (L7, first drill)
- Who: lead, with the owner (download and decrypt); owner's yes: the launch plan (13, 2026-11-07, "Nightly backups before launch").
- Source: `techaust-prod` (production, after `deploy-prod.yml stage=database`: 87 migrations, the seed only, no client data), via the first nightly-style run of `backup.yml` started by hand (run 42389213512, after the role's trust was corrected to GitHub's immutable subject). Archive `daily/techaust-prod-20261107T160207Z.tar`, decrypted by the owner with `scripts/backup-decrypt.ps1`: 319,083 bytes, SHA-256 matching the manifest.
- Times (IST): backup run 21:32; decrypt 21:40; local verify 21:42 (31.2 s); remote load 21:49; total about 20 minutes (most of it waiting for the owner's download).
- Trigger order in the file: first CREATE TRIGGER line 1741, last INSERT line 1479: data before triggers, no transactions; but `CREATE VIEW issue_guard` is the file's last statement, after the trigger created on it, so a straight remote load failed ("no such table: main.issue_guard"). Split needed: `scripts/drill-split.mjs` (new) writes schema, data, triggers in drill-verify's `loadOrder`.
- drill:verify: row counts pass (79 tables: catalogue_items 18, templates 25, terms_versions 4, settings 8, d1_migrations 87, the rest 0); numbers vs counters pass (no series yet); ledger pass; audit tail pass (empty); triggers 299 of 299; migrations 87 of 87; "drill-verify: ok".
- Remote: scratch D1 `techaust-restore-2026-11-07` (APAC), the three parts loaded in order (344, 145, 299 statements); counts equal the local ones (migrations 87, catalogue 18, templates 25, terms 4, settings 8, triggers 299, audit_log 0).
- Steps a real restore adds (estimate): create D1, load the three parts, point the bindings, deploy: about 1 h.
- RTO ≤ 4 h: met.
- Issues and follow-ups: the view-order split is now a script and in restore.md §3.4 and §3.5; a drill on a production backup with real data at the first quarterly drill.
- Clean-up: scratch D1 deleted (twice: the first, partly loaded attempt too); the `.tar`, `.sql`, parts and `.wrangler/drill-2026-11-07` deleted from the PC.

### 2026-11-__: staging copy and Time Travel rehearsal (M7.5, owner Q5 A)
- Who:
- Source: `techaust-staging`, export file: ; bookmark B0:
- Times (IST): start ; export done ; import done ; verify passed ; total
- Trigger order in the file:
- drill:verify:
- Time Travel:
- Steps a real restore adds (estimate):
- RTO ≤ 4 h:
- Issues and follow-ups:
- Clean-up:

