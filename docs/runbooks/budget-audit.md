# Runbook: Free plan budget audit (M7.5 J; the evidence for the owner's $5 decision)

_Draft by analyst R, 2026-11-07._ The lead reads every source **read-only**: the Cloudflare dashboard, or the Cloudflare MCP server (as in M7.5 Step 0, which read `workersInvocationsAdaptive`). **Daily limits reset at 00:00 UTC** (Workers requests and D1, per the Workers limits and D1 pricing pages read 2026-11-07; Browser Run "until the next UTC day").

**Per account, not per Worker or database (audit B6 L11):** the daily D1 rows read and written, the requests per day and the queue operations are account-wide limits. After launch, staging (benchmarks, e2e runs, the nightly jobs) and production share them, and the live `techaust-web` shares the requests until it is deleted at L8. The production projection adds staging's own daily use.

## The table (J)
| Metric | Free limit | NFR-2 target | Where to read it | Rule |
|---|---|---|---|---|
| CPU per invocation (HTTP, cron, queue) | 10 ms (HTTP and cron per the limits page; queue consumers not listed separately, so treated as 10 ms, CLAUDE.md rule 9) | p99 ≤ 7; login, hooks, cron ≤ 5; RPC first call ≤ 7 | Workers Logs `$workers.cpuTimeMs` on every invocation; trace root spans `cloudflare.cpu_time_ms`, `cloudflare.outcome` (1 in 10 sampled) | I1 pass rule |
| Requests per day (account) | 100,000; over it, error 1027 | < 50,000; alert at 50 % | GraphQL `workersInvocationsAdaptive` `sum { requests }` by `scriptName`; the Q4 job's `cf.requests` | Step 0: 3,070–5,525 a day, **shared with `techaust-web`** (≈ 3,100 a day of it) |
| D1 rows read per day | 5,000,000 | < 1,000,000 | D1 › the database › **Metrics**; GraphQL `d1AnalyticsAdaptiveGroups` `rowsRead`; per query `d1QueriesAdaptiveGroups`; per request trace spans `cloudflare.d1.response.rows_read` | Over the limit, D1 refuses queries until 00:00 UTC |
| D1 rows written per day | 100,000 | < 50,000 | `d1AnalyticsAdaptiveGroups` `rowsWritten` | As above |
| D1 queries and subrequests per invocation | 50 D1 queries (a `db.batch()` counts as one, docs read 2026-11-07); 50 subrequests (fetch, R2, D1, queue sends, service and RPC calls) | house rule (L16): ≤ 45 statements in one batch (T7), and D1 calls + subrequests ≤ 45 per invocation | the shared counting env in the admin, portal and jobs tests (M7.5 L18, `afterEach`); `.logs/route-inventory.json` `d1` per row | Static |
| D1 storage | 500 MB per database, 5 GB per account (J; the D1 pricing page read 2026-11-07 gives 5 GB total) | growth per year | `wrangler d1 info DB --env staging` (size); `d1StorageAdaptiveGroups` | Projection |
| Queue operations per day | 10,000; one operation per 64 KB written, read or deleted | < 5,000 | `queueMessageOperationsAdaptiveGroups` `billableOperations` by `queueID`, `actionType`; backlog `queuesBacklogAdaptiveGroups` | What happens over the Free allowance: not stated on the pricing page |
| Browser Run | 10 min a day, 3 browsers, 1 request per 10 s | < 50 % | Dashboard › **Browser Run**; our own `stats_daily` metric `pdf.browser_ms` (UTC day, from `X-Browser-Ms-Used`) | The half-day bell already exists |
| R2 | 10 GB-month, 1M Class A, 10M Class B a month (J) | < 50 % | R2 › bucket › **Metrics**; `r2OperationsAdaptiveGroups` (`actionType`, `bucketName`), `r2StorageAdaptiveGroups` (`payloadSize`, `objectCount`) | The A/B split by `actionType`: unverified mapping |
| Logs and traces | 200,000 log events a day until 2026-11-30; from 2026-12-01 Cloudflare Observability pricing (0.5 GB a day, cpu-baseline.md, read 2026-10-30) | traces < 25 % | Workers & Pages › **Observability** | Ingestion stops for the day when used up |
| Bundle and startup | 64 MiB uncompressed, no compressed limit (Workers limits page, **read 2026-11-07; J's "3 MB compressed" is out of date**); startup 1 s | our ceilings; ≤ 200 ms | `scripts/worker-budget.mjs` in the build | Static |

## How to read each source

**1. CPU per route (I1).** Same day as the run: logs last 3 days, traces 7.
1. Workers & Pages › **Observability**, filtered on each staging Worker and the run's UTC window. Or through the MCP server, read-only. **First list the available fields** (cpu-baseline.md); `$workers.cpuTimeMs` is the field used in earlier readings.
2. Per inventory row:
   - count;
   - first runs (`f:1` on the `ev:"req"`, `ev:"fwd"` and RPC lines) apart from warm runs;
   - warm p99 by nearest rank (with ≤ 100 samples it is the max);
   - the max;
   - any `exceededCpu`.
3. Forwarded admin requests: add the front's and the target's CPU, joined on `rid` or `cloudflare.ray_id`.
4. Queue consumers: take the message kind from the invocation's log lines. It is not a span attribute.
5. Write the results into `cpu-baseline.md` as "M7.5 reading".

**2. Requests.** GraphQL, one UTC day per row:
```graphql
query { viewer { accounts(filter: {accountTag: "153cd8b23edd2bc9dec570ffaf467c2f"}) {
  workersInvocationsAdaptive(limit: 100, filter: {datetime_geq: "<day>T00:00:00Z", datetime_lt: "<next day>T00:00:00Z"}) {
    sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 } dimensions { scriptName status } } } } }
```
Dataset and field names: Cloudflare's "Querying Workers metrics with GraphQL" page, read 2026-11-07. `datetime_lt` is assumed by analogy with its `datetime_leq`; check it. Whether a service-binding call or a queue invocation counts against the 100,000 is **unverified**. Count both, the safe way.

**3. D1.** Dashboard: the D1 page › `techaust-staging` › **Metrics** (24 h by default). GraphQL `d1AnalyticsAdaptiveGroups` with `readQueries`, `writeQueries`, `rowsRead`, `rowsWritten`; `d1QueriesAdaptiveGroups` shows rows read per query string (D1 metrics page, read 2026-11-07). The dimension names are unverified: introspect the schema first. Compare the rows read per route on staging with the local probe. A mismatch reopens "D1 query plans on staging" (I1).

**4. Queues.** `queueMessageOperationsAdaptiveGroups` (`billableOperations`, `retryCount`; dimensions `queueID`, `actionType`, `outcome`, `date`) and `queuesBacklogAdaptiveGroups` (Queues metrics page, read 2026-11-07). The dashboard path for queue metrics is not given on that page.

**5. Browser Run.** Dashboard › **Browser Run** (usage and session close reasons; Browser Run limits page). Our own figure needs no hosted access:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 execute DB --remote --env staging --command "SELECT date, value FROM stats_daily WHERE metric = 'pdf.browser_ms' AND dimension = '' ORDER BY date DESC LIMIT 14"
```
No GraphQL dataset for Browser Run is named on its limits page (unverified whether one exists).

**6. R2.** R2 › bucket (`techaust-staging-docs`, `techaust-staging-files`) › **Metrics**. GraphQL datasets as in the table.

**7. Logs and traces.** Workers & Pages › Observability (volume per day). If traces take more than a quarter, lower the 0.1 rate in every config and in the guard together (cpu-baseline.md "Traces").

## Decision rule (J; the decision is the owner's, 13 2026-11-01)
- **Every inventory row passes I1:** recommend **staying on Free**.
- **After at most 2 tuning rounds, any of these:** an invocation over 10 ms, any `exceededCpu`, or more than 0.1 % of load-run invocations over 10 ms (05 §1.2). Recommend **Workers Paid at $5 a month before launch**.
- **First runs between 7 and 10 ms with nothing over 10:** the owner's call, leaning to $5 for safety.
- The proposal is separate (rule 9). Re-read the price and its INR amount on the day.
- Also put before the owner what Paid changes, as verified on the day: Time Travel 30 days instead of 7 (Time Travel page, 2026-11-07); Queues 1,000,000 operations a month included (Queues pricing page, 2026-11-07); the rest re-read then.

## Production projection (the model is an assumption, shown to the owner)
1. **Inputs from the record** (each named as an assumption):
   - 500–2,000 emails a month (03 §4);
   - 2,000 documents (M5.5's rows-read target);
   - staff of 2–5 (business profile).
   Clients, portal visits and form submissions per day are left blank for the owner. **Never invented.**
2. **Requests per day:**
   - for each inventory row: calls per day × invocations per call (forwarded admin rows count 2: front + target; RPC calls count 1);
   - plus crons: 25 a day (24 hourly + 1 daily);
   - plus one invocation per queue message (`max_batch_size` 1), retries included;
   - plus webhooks.
   - After L8, `techaust-web` is gone and website pages are static assets (free per J). Only `/api/*` invokes the web Worker, so most of today's ≈ 3,100 a day leave the count.
3. **D1 rows read and written per day:** calls × rows per call at the 2,000-document volume. Keyset pages ≤ 50 rows; aggregates from the I1 trace spans, or the local `EXPLAIN` tests where staging is too small.
4. **Queue operations per day:** about 3 × messages (write, read, delete) + retries + messages over 64 KB counted per 64 KB.
5. **Browser Run per day:** PDFs a day × the per-PDF figure (`pdf.browser_ms` ÷ `pdf.renders` from `stats_daily`).
6. **R2 per month:** Class A from PDF and upload writes plus lists; Class B from downloads.
7. **Logs per day:** production has no invocation logs and no traces, so console lines only.
8. For each row: projected ÷ limit, flagged at 50 % and 80 % (the Q4 alert lines).

## Recording
Put the result table (per Worker and per inventory row, with histograms) in `cpu-baseline.md` "M7.5 reading", the day's account figures here, and the owner's decision in 13.

