# Runbook: restore (docs/08 §6, NFR-7)

_Draft by analyst R, 2026-11-07._ Targets: RPO ≤ minutes within the Time Travel window and ≤ 24 h from the nightly copy; **RTO ≤ 4 h** (NFR-7). Every restore of production is a production action and needs the owner's yes for that action (rule 4). Commands run in PowerShell and name the repository in full.

## 1. Pick the path
| What happened | Path |
|---|---|
| A wrong change to a few rows or one table, inside the window | **Time Travel, "look back and copy"** (§2.2): the database is put back only for minutes |
| The whole database is damaged, inside the window | **Time Travel, full restore** (§2.3), then the reconciliation in §4 |
| Older than the window, or the database or account is lost | **S3 copy** (§3), Phase 7 (N8) |
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
   Writes made while the database is rewound are lost when it goes back to B0.
3. Restore to the moment before the mistake. Wrangler asks "OK to proceed (y/N)"; answer `y`:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 time-travel restore DB --env staging --timestamp=<RFC3339 time>
```
4. Copy out what you need. Prefer a `SELECT … --json | Out-File -Encoding utf8 <file>`, which doesn't block. `wrangler d1 export … --table <name>` writes a file but makes the database unavailable while it runs.
5. Go back to B0:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 time-travel restore DB --env staging --bookmark=<B0>
```
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

## 3. The S3 copy (Phase 7 L1, task N8; not built: `backup.yml` is a stub)
The design (05 §backup.yml; 08 §6.2):
- nightly `wrangler d1 export` → age-encrypted → S3 Mumbai (versioning, Object Lock);
- 90 daily copies, plus a monthly finance-only copy kept 10 years (owner 2026-10-07; T7 F1: the monthly copy leaves out proposals and estimates, `BACKUP_SCOPE`).

The restore, once N8 exists:
1. download `db-YYYYMMDD.sql.age`;
2. decrypt on the owner's PC with the offline identity;
3. create a new D1;
4. import with `wrangler d1 execute <new db> --remote --file=db.sql`;
5. run `pnpm drill:verify` against it;
6. either point every Worker's `DB` binding at it, or copy rows back;
7. record it.

Step 6 means the `database_id` in `apps/admin/wrangler.jsonc`, `wrangler.api.jsonc`, `wrangler.finance.jsonc`, `wrangler.invoices.jsonc`, `apps/portal/wrangler.jsonc` and `apps/jobs/wrangler.jsonc`, then an approved deploy.

Known points for N8:
- **A table-filtered export carries no triggers and no indexes.** The local export code keeps an index or trigger only if its own name is in `--table`; the remote format is unverified. The finance-only copy must be restored onto a schema built from the migrations.
- **A remote export blocks the database while it runs** (wrangler's prompt; D1 docs): schedule the nightly export when no one works.
- D1's import rules (Cloudflare import and export page): remove `BEGIN TRANSACTION`/`COMMIT` and any `_cf_KV` table; one file ≤ 5 GiB; "Statement too long" means splitting an `INSERT`. There are no virtual tables in our migrations (checked 0000–0079), so export works.

## 4. After a restore that loses recent work: reconcile before reopening
Anything made after the restore point exists outside D1: PDFs and envelopes in R2, emails, and payments at the gateways.
1. **Document numbers.**
   - List the R2 keys under `docs/<type>/<fy>/` newer than the restore point (R2 › `…-docs` › Objects, or the lead read-only). The key holds the number (`<number>-v<version>`).
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

