Status: WAITING ON OWNER (Q1); reviewer re-checking the brief after round 1 fixes
Tier: B (Workers; planning only, no code)
Usage: lead claude-opus-5-5/high (cloud session admin-split-plan); analyst (measure + options) claude-opus-5-5/high, skills asked for `cloudflare:workers-best-practices`, `cloudflare:wrangler`, `cloudflare:workers-profiling` (each "Unknown skill": Cloudflare skills don't load in cloud sessions; no other skill fits a split plan): 5-h 5 % at start (23:12 IST). reviewer (brief) claude-opus-5-5/high started 23:48 IST at 5-h 5 % (reading). Readings: USAGE 5 at 2026-11-02T23:40+05:30.

# Run: the fourth admin Worker (split the admin finance Worker before M6.5), build brief

Session: `admin-split-plan` (cloud). Branch: `docs/admin-split-plan` (from `main` e765e2f). Copy file: none (the split adds no user-facing wording). **Planning only:** this file is the only file the run changes; no code, configs or migrations.

**Why:** L28/L32 of 2026-11-02 in `docs/runs/m6.4-paypal.md` (on `origin/feat/m6.4-paypal`). On the M6.4 branch the admin finance Worker is at 701,805 of 800,000 bytes, past the 650,000 plan line (CLAUDE.md "Worker budget": "a fourth admin Worker is planned when finance passes the 650,000 planBytes line"). M6.5 (refunds, receipts, reconciliation) adds about 40 KB more to finance, and M7.3 adds about 15 KB. The owner chose this planning run on 2026-11-02. **The split is built after M6.4 merges and before M6.5 starts.**

## Questions for the owner
Status: open (the main session brings them as one batch).

**Q1. Deploying the new admin Worker to staging.** This changes `.github/workflows/deploy-staging.yml`, which needs your yes.
The finance Worker is too big for what M6.5 and M7 will add, so the invoice, report and dashboard routes move into a fourth admin Worker, "admin invoices". Payments, the gateways and their keys stay where they are. Staging needs one more deploy step for the new Worker.
- **A (Recommended):** add one step for the new Worker and move the finance step later. The new order is:
  1. the admin API;
  2. **the admin invoices Worker (new);**
  3. the admin front;
  4. **jobs (moved up);**
  5. **the admin finance Worker (moved down; it comes after the front instead of before it, as you set on 2026-10-31);**
  6. the portal;
  7. the website.

  With this order every Worker that another one calls is already live at each step, so staging has **no gap** on the first deploy: no "not found" pages and no failed background jobs, and a deploy that stops halfway still leaves a working set. The admin health check also proves the new Worker answers. Nothing else in the workflow changes: it stays fork-safe, with actions pinned by SHA.
- B: add the new step only, right after the admin API, and keep finance where it is. On the first deploy, invoice pages can show "not found" for a minute or two between two steps, as with the third Worker in M6.1 (staging only).
- C: no new step. The PR waits and M6.5 can't start, because finance would cross its 800,000 ceiling during M6.5 or M7.

**No secret moves and no key steps for you.** The Razorpay, Stripe and PayPal test keys stay on the admin finance Worker, so `tools/set-gateway-keys.ps1` isn't run again. This is one of the reasons for the recommended cut: the Razorpay and Stripe test secrets are shown only once, so moving them would mean making new ones.

## Measurements (analyst, 2026-11-02; checked by the lead)
**Method:** exact Vite builds through `scripts/worker-budget.mjs`. Start-up is the fastest of 7 runs in the local `node:vm` proxy, which is noisy (±30 %).
- **Byte breakdown:** admin was rebuilt with `vite build --sourcemap` (the bundle is identical apart from the 34-byte comment), and every byte was attributed to its source through the map. 7.7 % unmapped bytes (rolldown runtime) are spread pro rata. Error against the real build: 0 bytes.
- **Candidate Workers:** built with the real Vite and Cloudflare plugin through a scratch config. That config's calibration run reproduced 701,805 exactly. The other options are rolldown estimates (about 1–1.7 % high, scaled).
- Logs: `/home/user/split-m64/.logs/{m64-admin-build,m64-sourcemap,split-vite-b,split-startup}.log` (this session's container only).

| Worker | main e765e2f | M6.4 3f19098 |
|---|---|---|
| admin front | 110,696 (24–27 ms) | 111,333 (27–31 ms) |
| admin API | 489,310 (66–68 ms) | 489,947 (74–82 ms) |
| admin finance | 646,479 (61–79 ms) | **701,805** (76–93 ms; one bundle read 63 and 91 ms in the same run) |
| portal | 119,256 | 122,724 (12.5 ms; ceiling 150,000 on M6.4) |
| jobs | about 712,374 | 727,573 (70 ms) |

**Finance at M6.4, by group** (bytes including the pro-rata share):

| Group | Bytes |
|---|---|
| invoices, notes, issue, approvals (`invoice-*`, `note-*`, `db/issue.ts`, `db/documents.ts`, core invoices/notes/numbering/fx) | ~164,700 |
| gateway (`gateway/**`, `db/gateway.ts`, core paypal/stripe/razorpay/online-pay/gateway-rpc) | ~142,600 (main 89,459; M6.4 +42 KB) |
| proposal code pulled in by the invoice chain (`quote-model`, `documents.ts`, `document-*`, `service-*`) | ~77,500 |
| payments, ledger, advices (`payments.ts`, `payment-ledger.ts`, `advices.ts`, `db/ledger.ts`, `db/advices.ts`) | ~58,900 |
| care billing (`care-billing.ts`, `care.ts`, `db/care.ts`) | ~40,200 |
| core shared | ~37,900 |
| zod/mini | ~37,200 |
| reports, statements, dashboard, realisation | ~33,200 |
| start-up dry run (`warm-fixtures/finance.ts` alone is 20,352) | ~29,200 |
| admin shared (app, guard, context, http, system) | ~26,500 |
| hono | ~20,200 |
| core/tax | ~20,100 |
| db shared, deeds, auth, other npm | ~13,700 |

## Options (bytes after M6.4)
| Option | New Worker | Finance | Duplicated | Verdict |
|---|---|---|---|---|
| (a) gateway-only Worker, the automatic advance with it | 507,776 (est.): the advance pulls in the whole invoice chain | 571,889 (est.) | ~270 KB | no |
| (a′) gateway-only Worker, the advance by RPC to finance | ~236,000 (est.) | ~562,000 (est.) | ~100 KB | finance only ~50–60 KB under the line after M6.5 and M7.3; **all five gateway secrets move** (new Razorpay and Stripe test secrets, three key runs), and the jobs `ADMIN_GATEWAY` and portal `ADMIN_PAY` bindings are re-targeted |
| (b) payments + gateways / invoices, without the import cut | 520,931 (est.) | 420,654 (est.) | n/a | needs the cut below |
| **(B1) = (b) + one import cut + the advance by RPC** | **invoices 511,770 (exact)** | **309,347 (exact)** | 119,312 (exact) | **chosen** |
| (b′) B1 with reports, statements and the dashboard on the payments side | ~472,000 (est.) | ~374,000 (est.) | ~160 KB | a later lever only |
| (c) reports, statements and the dashboard out | ~164,000 (est.) | ~667,000 (est.) | n/a | still over 650,000 |
| (c′) care billing (`BillingJobs`) out | ~343,000 (est.) | ~662,000 (est.) | n/a | still over 650,000 |

**Growth after B1** (estimates from the briefs):

| Stage | finance (payments side) | invoices |
|---|---|---|
| The split on M6.4 (exact; every fixture still on invoices) | 309,347 | 511,770 |
| Fixtures redistributed; M6.4's fix round (L31 RPC dry runs) | ~320–330 K | ~507 K |
| M6.5 (+40 KB: refunds, reconciliation, receipts) | ~360–370 K | ~510 K |
| M7.1 (`/payments/notices`) and M7.2 | ~370 K | ~513 K |
| M7.3 (revenue and ageing reports, dashboard v2 → invoices) | **~372–380 K** | **~525–530 K** |

**The money-path test (a blocker if any batch would span two Workers): none does.** The lead checked these on the M6.4 branch:
1. `gateway/advance.ts` (`issueGatewayAdvance`, `mutateSystem` batch: the issue, the receipt, the allocation and the deed) reads only `DB` and `PDF_QUEUE` and makes no gateway call; its imports are the invoice chain (`invoice-model.ts`, `invoices.ts`, `quote-model.ts`, `care-billing.ts`, `@techaust/db/issue`) plus `./messages.ts` and `REVIEW_LINK` from `./settle.ts` (A.6 cuts the latter). It moves whole to invoices. Callers:
   - jobs `gateway.advance` through `GatewayEvents.issueGatewayAdvance` (after the split: jobs' own `ADMIN_ADVANCE`, B); finance's `events.ts` and `settle.ts` hand it over through the queue, never synchronously;
   - the Owner's `POST /payments/review/:id/retry` (`gateway/routes.ts:345`), synchronously. Its follow-up resolve (`routes.ts:349-362`) is already a separate batch and stays in finance.
2. `invoice-advance.ts` ("Confirm by issuing": issue, payment confirm, allocation, recompute, deed) has no gateway import and goes whole to invoices.
3. The gateway settle batches (`settle.ts`, `stripe-settle.ts`, `paypal-capture.ts`) issue nothing; they stay in finance with the keys.
4. `payments.ts` and `payment-ledger.ts` batches are ledger only (proforma money is refused with `use_advance_invoice`); they stay in finance.
5. Note issue (`invoice-issue.ts`) and the care auto-issue go to invoices. They use the pure SQL builders `@techaust/db/ledger` and `@techaust/db/deeds`, which both bundles carry.
6. M6.5 refunds (batch 1 release + recompute, the provider call with the keys, batch 2) are all finance. A needed credit note is an earlier, separate Owner step in invoices (409 `credit_note_needed`).

## Brief
_Final, by the lead, from the analyst's draft (2026-11-02). Reviewed: see "Review"._

**PRD:** ADM-G-02 (the admin API behind service bindings; as M5.0), ADM-PAY-01 (payments, as M6.1 stage A). **No change in behaviour:** every route keeps its path, method, permission, audit action, body kind, answers and errors. Every RPC method keeps its name, arguments and answers, except that `GatewayEvents.issueGatewayAdvance` moves to the invoices Worker's `GatewayAdvance` with the same arguments and answers, and jobs calls it there (B.3).
**Branch:** `feat/admin-invoices-worker`, from `main` **after M6.4 merges** (and before M6.5 branches). The milestone is approved on staging like any other (CLAUDE.md hard rule 2).
**Tier:** B (Workers, bindings, a money path's RPC hop). **No migrations. No secrets. No screens.**

### Order and agents
1. **Builder B1:** Step 0, then A (code cut and routing), B (RPC), C (config) and D (scripts), with the tests in F. Stop after A–C build and their tests pass, for the **early check** (analyst: the routing table, the advance RPC on the money path, the configs).
2. **Builder B2:** early-check changes, D–E (scripts, start-up dry run and fixtures, runbooks), the remaining tests, then the full `pnpm check` and `pnpm test` through `tools/heavy.sh`.
3. **Reviewer:** code only (no screens), with `code-review` (and `security-review`: a payment path and service bindings). There is no designer step.
4. Fixes, then the re-check. A second review after any critical or high finding.

**Rules:**
- Each agent works on its own branch from `origin/feat/admin-invoices-worker` and pushes only that.
- Commit at each finished layer and at least every 20 minutes. Heavy commands only through `bash tools/heavy.sh --log …`.
- Never touch staging, secrets or hosted services. `.github/workflows/deploy-staging.yml` changes only after the owner's yes to Q1; until then, the PR is held.
- Stop every dev server you started.
- Skills: the Cloudflare skills (`workers-best-practices`, `wrangler`, `workers-profiling`) on the PC; in a cloud session say they're absent.

### Step 0 (check at build time, against `main` after M6.4)
1. **Re-measure** finance, API and front with `pnpm --filter @techaust/admin build`, and record the bytes. Compare finance with M6.4's final figure in `docs/runs/m6.4-paypal.md` (after its fix round B3, which adds the L31 RPC dry runs; 701,805 before it). If it differs from that by more than 30 KB, re-read the row lists below against `guard.ts`.
2. **Row list.** List every `X(...)` row in `apps/admin/worker/guard.ts` (61 on 3f19098) and classify each by the rule in A.2. Any row not covered by the rule: stop and ask the lead.
3. **The import cut still holds, both ways.**
   - **Payments side into the invoice chain:** `apps/admin/worker/payment-ledger.ts:52` imports `INVOICE_VOID` from `invoice-model.ts`; `payments.ts:87` and `payment-ledger.ts:65` import `CLIENT_GONE` from `quote-model.ts` (tree-shaken today, 16 bytes). Find any other import from a payments-side module (`payments.ts`, `payment-ledger.ts`, `advices.ts`, `gateway/**` except `advance.ts`) into the invoice chain (`invoice-*.ts`, `note-*.ts`, `quote-model.ts`, `invoices.ts`, `care-billing.ts`, `documents.ts`, `document-*.ts`).
   - **Invoice side into gateway code:** `gateway/advance.ts:38-39` imports `./messages.ts` (wording; allowed in invoices) and `REVIEW_LINK` from `./settle.ts`, which brings settle's top-level SQL strings (`withdrawnSql("d")`, `advanceWaitingSql`, `settle.ts:85-104`) into invoices. Find any other import from an invoice-side module (the chain above plus `advance.ts`, `reports.ts`, `statements.ts`, `dashboard.ts`, `approvals.ts`) into `gateway/**` other than `messages.ts`/`reasons.ts`, or into `payments.ts`, `payment-ledger.ts` or `advices.ts`.
   - Each one is either cut (A.6) or reported.
4. **Local service bindings with a named entrypoint.** Prove these under `@cloudflare/vite-plugin` 1.62.5 in `pnpm dev`, and that vitest's in-process route set can stand in for them (F):
   - finance (auxiliary) → invoices (auxiliary), `ADMIN_ADVANCE` / `GatewayAdvance`;
   - jobs (its own process, through the dev registry) → invoices `ADMIN_JOBS` / `BillingJobs` and `ADMIN_ADVANCE` / `GatewayAdvance`.

   The jobs-to-finance binding never connected locally in M6.2 (a known follow-up), so a jobs failure that is the same as that one is reported, not fixed here. If the finance-to-invoices binding can't connect, report it before going on; the fallback is the lead's call (Risks 2).
5. **Env typing:** find how the front's generated `Env` (`wrangler types --env staging` on `wrangler.jsonc`) covers the finance-only bindings today (`LEADS_QUEUE`, the gateway secrets read with `envText`), and give `ADMIN_INVOICES` and `ADMIN_ADVANCE` the same treatment. No hand-written `Env` interface (CLAUDE.md "Workers").
6. **Deploy with a missing bound Worker:** confirm from wrangler's docs or source whether `wrangler deploy` of a Worker whose service binding names a missing Worker or entrypoint fails. The C.6 order never needs it (every bound Worker exists at every step), but the answer goes in the builder report for Phase 7.

### A. The cut and the routing (B1)
1. **Names (lead decision L1):**
   - Worker `techaust-platform-admin-invoices` (`-staging` on staging);
   - config `apps/admin/wrangler.invoices.jsonc`; Vite environment `techaust_platform_admin_invoices`;
   - entry `apps/admin/worker/invoicing.ts` (`invoices.ts` is the invoice router); route mount `routes-invoices.ts` (`mountInvoices`);
   - row helper `I(...)` marking `on: "invoices"`;
   - front binding `ADMIN_INVOICES`; finance binding `ADMIN_ADVANCE` → entrypoint `GatewayAdvance`.

   The finance Worker keeps its name, its config, its secrets and its RPC entrypoints `GatewayEvents` and `PortalPayments`. After the split it is the payments side: payments, the ledger, credit, advices, the gateways and their keys.
2. **Which rows go where** (the rule; the line numbers are from 3f19098):
   - **to invoices (32 rows):** a client's statement and its PDFs (`guard.ts:104,106,107`); the dashboard (`:169`); the reports (`:172-176`); every invoice and note row (`:217-243`: list, read, drafts, issue, request, approve, advance-invoice, withdraw, void, notes, send, links, PDFs including the supplier copy); approvals (`:289,290`); `GET /clients/:id/invoices`.
   - **stay finance (29 rows):** the gateway rows (`:248-254`: payment links on an invoice, `/payments/review*`, gateways status); advices (`:256-268`); payments, TDS, credit, `/invoices/:id/payments`, credit moves, the realisation extensions (`:269-284`).
   - **The rule for any row not listed:** a row whose handler needs a gateway key, writes `payments`/`payment_allocations` without issuing a document, or reads the ledger panels stays finance. A row that drafts, issues, sends, voids or renders an invoice-family document, or reads a report, statement or the dashboard, goes to invoices.
3. **`context.ts`:** `on?: "front" | "finance" | "invoices"`. **`guard.ts`:** a helper `I(...)` beside `X(...)`; the 32 rows change from `X` to `I`, with nothing else on the row changed.
4. **`forward.ts`:** `workerOf(row)` returns `"api" | "finance" | "invoices"`, and the forwarder picks `ADMIN_INVOICES` for `"invoices"`. The 502 body and the log line (`w` names the Worker) are otherwise unchanged. The TrieRouter table and `warmForwardTable` keep working on every non-front row.
5. **`routes-invoices.ts`** (new) mounts, in today's order: `clientInvoices`, `statements`, `statementPdf`, `reports`, `invoices`, `invoiceIssue`, `invoiceAdvance`, `invoiceWithdraw`, `invoiceNotes`, `invoiceSend`, `invoicePdf`, `invoiceSupplierPdf`, `approvals`, `dashboard`, and imports `./warm-invoices.ts`.
   **`routes-finance.ts`** keeps `invoicePaymentLinks`, `gatewayPayments` and the M6.4 advices router **mounted before** `payments` (whose `/:id` would otherwise match `/review`, `/gateways` and the advice paths), then `payments`, `clientCredit` and `invoiceLedger`.
6. **The import cuts:**
   - **`INVOICE_VOID`** moves into `apps/admin/worker/invoice-consts.ts`, which has no top-level side effects. **`payment-ledger.ts` and every other payments-side importer import it from `invoice-consts.ts`.** `invoice-model.ts` re-exports it for the invoice chain only. Importing it from `invoice-model.ts` would keep that module's top-level `e(...)` lines (`:66`, `:82`), which the `INVOICE_CODE` marker matches, so the finance budget would fail. The analyst's exact build shows this cut alone removes about 108 KB (`start-project-plan` → `document-convert` → `documents`, `care`, `quote-model`, the tax engine) from finance.
   - **`CLIENT_GONE`:** the payments side imports it from a side-effect-free module (`quote-model.ts` re-exports it), so the tree-shaking doesn't depend on luck.
   - **`REVIEW_LINK`:** it moves out of `gateway/settle.ts` into a side-effect-free `gateway/consts.ts`. `advance.ts` and `settle.ts` import it from there; jobs keeps its own copy (`apps/jobs/src/gateway.ts:43`).
   - Anything else Step 0.3 finds is cut the same way.
7. **Warm-up modules:**
   - split `warm-finance.ts` into `warm-invoices.ts` (the invoice, note, approval decision, settings and report schemas) and `warm-finance.ts` (payments, advices, the gateway schemas, `gateway/warm.ts`);
   - each keeps returning a count that a test pins;
   - nothing moves between them except by this rule.
8. **`invoicing.ts`** (new entry), modelled on `finance.ts`:
   - `createApp(mountInvoices)`; `warmRouter(app, ROUTES.filter(r => r.on === "invoices"))`; `warmAtStartup(() => createApp(mountInvoices, undefined, { warm: true }), INVOICES_WARM)`;
   - exports `default`, **`BillingJobs` moved word for word** from `finance.ts`, and **`GatewayAdvance`** (B);
   - no named export that isn't an entrypoint (a named export of an entry is read as an entrypoint).
9. **Shared RPC helpers:** `rpcLog`, its `isolateCalls` counter, `id()` and `rpcId()` (`finance.ts:48,141-146` on 3f19098) move into a side-effect-free `apps/admin/worker/rpc.ts` that both entries import. The `ev:"rpc"` line keeps the same shape in both Workers, and each isolate keeps its own counter.
10. **`finance.ts`** loses `BillingJobs`, the invoice imports and **`GatewayEvents.issueGatewayAdvance`**: after the split, jobs calls the invoices Worker directly (B.5). `GatewayEvents` keeps `processEvent` and `refreshCheckout`, and `PortalPayments` keeps its two methods. `split.test.ts` pins the new method lists, and `GatewayEventsApi` in core loses the method.

### B. The advance RPC (B1; review finding 1: a failure is never swallowed)
1. **`@techaust/core/gateway-rpc`:** a `GatewayAdvanceApi` with one method, `issueGatewayAdvance({paymentId, lastTry?}): Promise<IssueAdvanceResult>`, and a runtime answer guard `isIssueAdvanceResult` (result codes and the `blockers` array shape). `GatewayEventsApi` loses `issueGatewayAdvance`.
2. **`invoicing.ts` `GatewayAdvance extends WorkerEntrypoint<Env>`:**
   - exactly that one public method;
   - `rpcId` check on `paymentId` (1–64 characters), else a TypeError with nothing written; `lastTry` taken only when strictly `true`;
   - calls `issueGatewayAdvance(this.env, paymentId, { lastTry })` from `gateway/advance.ts`, which now lives in the invoices bundle only;
   - one id-only `ev:"rpc"` line with `f` (`rpc.ts`).
3. **Jobs calls it directly (lead decision L2).**
   - New jobs binding **`ADMIN_ADVANCE` → `techaust-platform-admin-invoices(-staging)` / `GatewayAdvance`** (C.4).
   - `apps/jobs/src/gateway.ts` `gateway.advance` calls `env.ADMIN_ADVANCE.issueGatewayAdvance({ paymentId, lastTry })` in place of `adminGateway(env).issueGatewayAdvance`, and checks the answer with `isIssueAdvanceResult`. **A malformed answer throws.**
   - **A thrown binding error or a malformed answer propagates** to the `catch` in `apps/jobs/src/queue.ts:206`, exactly as a thrown error does today. The queue redelivers up to `max_retries`, then the dead-letter path (`processGatewayDeadLetter`) writes the `dead_letter` review item and rings the Owner's bell.
   - Only a real `{result:"retry"}` from `issueGatewayAdvance` (a proforma changed meanwhile) keeps today's one-retry-then-last-try rule (`gateway.ts:76-80`, `ADVANCE_TRIES`).
   - Every other `gateway.*` kind keeps `ADMIN_GATEWAY` (finance).
4. **The Owner's review retry (finance, the only finance → invoices call).**
   - `apps/admin/worker/gateway/advance-rpc.ts` (new): `advanceViaRpc(env, paymentId)` calls `env.ADMIN_ADVANCE.issueGatewayAdvance({ paymentId })` and checks the answer with `isIssueAdvanceResult`. **A malformed answer throws; a binding error is not caught.**
   - `gateway/routes.ts:345` calls it. A throw ends in the app's standard 500 answer, exactly as a D1 failure there does today: nothing is written and the review item stays open. It is **never** 409 `ADVANCE_CHANGED`, whose text says the proforma changed. Errors and copy are unchanged.
   - The follow-up `already_issued` resolve stays a separate finance batch, as today.
   - **No module in finance imports `advance.ts`** (the `ADVANCE_CODE` budget marker in D.1 proves it).
5. **Jobs' other bindings:** `ADMIN_GATEWAY` still names finance's `GatewayEvents` (`processEvent`, `refreshCheckout`). `ADMIN_JOBS` is re-pointed to invoices' `BillingJobs` (C.4); `apps/jobs/src/billing-rpc.ts` changes its comment only.
6. **Idempotency is unchanged:** `issueGatewayAdvance` is already one try per invocation, guarded in SQL (the payment's receipt, the proforma's `updated_at`). A redelivery after a lost RPC answer can only get `already_issued`.

### C. Config (B1)
1. **`apps/admin/wrangler.invoices.jsonc`** (new; a copy of `wrangler.finance.jsonc` minus what invoices doesn't need):
   - `main: "worker/invoicing.ts"`; `workers_dev: false` and `preview_urls: false` **in every scope** (top, staging, production); no routes, no assets, no custom domains;
   - **no `secrets`** (the invoice chain holds none);
   - top-level and staging: the front's `DB` (same `database_name`/`database_id` per scope); R2 `FILES` and `DOCS`; queue producers `EMAIL_QUEUE` and `PDF_QUEUE`; **no `LEADS_QUEUE`** and no `services`;
   - vars `ENVIRONMENT`, `PAYMENTS_LIVE_ALLOWED: "false"`, `LEAD_PURGE_MODE`. The reviewer found that the moved modules read only `DB`, `DOCS`, `EMAIL_QUEUE` and `PDF_QUEUE` from the env (no `PORTAL_URL`, `GATEWAY_TRANSPORT` or `LEADS_QUEUE`); re-grep `env.`/`c.env.` in the moved modules at build time;
   - observability as finance per scope (staging traces `head_sampling_rate: 0.1`, logs and invocation logs on; production invocation logs off);
   - production: name and vars only (no bindings until Phase 7, as finance).
2. **`apps/admin/wrangler.finance.jsonc`:** add `services: [{ binding: "ADMIN_ADVANCE", service: "techaust-platform-admin-invoices", entrypoint: "GatewayAdvance" }]` at the top level, and the `-staging` target under `env.staging`. Production: as for finance's other bindings, none until Phase 7. Keep the five gateway secrets, the three queue producers and the vars. Update the header comment.
3. **`apps/admin/wrangler.jsonc` (front):** `ADMIN_INVOICES` → `techaust-platform-admin-invoices` in all three scopes (staging `-staging`), as `ADMIN_FINANCE` is. Bindings aren't inherited between scopes.
4. **`apps/jobs/wrangler.jsonc`:** `ADMIN_JOBS` → `techaust-platform-admin-invoices` / `BillingJobs`, and a new **`ADMIN_ADVANCE` → `techaust-platform-admin-invoices` / `GatewayAdvance`** (top level; `-staging` under `env.staging`); production still has none. `ADMIN_GATEWAY` unchanged. Update the deploy-order comment.
5. **`apps/portal/wrangler.jsonc`:** no change (`ADMIN_PAY` → finance `PortalPayments`).
6. **Deploy order (Q1 A; review finding 2):** admin API → **admin invoices** → admin front → **jobs** → **admin finance** → portal → web.
   - **Every bound Worker exists at every step,** and the old finance Worker still answers every row and still exports `BillingJobs` and `GatewayEvents.issueGatewayAdvance` until step 5:
     - the new front sends invoice rows to the live invoices Worker and the rest to the old finance and the API;
     - the new jobs calls invoices (`ADMIN_JOBS`, `ADMIN_ADVANCE`) and the old finance (`ADMIN_GATEWAY`: `processEvent`, `refreshCheckout`);
     - the new finance binds invoices (`ADMIN_ADVANCE`), which already exists;
     - the portal binds finance (unchanged).
   - So the **first deploy has no gap** (no 404s, no failed `care.bill` or `gateway.advance` calls), and a deploy that stops at any step leaves a working set.
   - The order differs from the owner's 2026-10-31 row (finance "after the admin API and before the admin front"), so Q1 asks for it. If the owner picks Q1 B, the M6.1-style window of 1–2 minutes of invoice-row 404s applies (staging only).
7. **`apps/admin/vite.config.ts`:** `auxiliaryWorkers: [api, finance, invoices]`; `techaust_platform_admin_invoices: { build: { minify: true } }`.
8. **`apps/admin/vitest.config.ts`:** a stub `ADMIN_INVOICES` service binding (502, like the others). The advance RPC in tests: see F.3.
9. **`apps/admin/package.json`:**
   - `build` adds `node ../../scripts/worker-budget.mjs adminInvoices`;
   - `deploy:staging:invoices` = `node ../../scripts/check-staging-build.mjs admin-invoices && wrangler deploy --config dist/techaust_platform_admin_invoices/wrangler.json`.
10. **`.env.example`, `.dev.vars.example`, `tools/set-gateway-keys.ps1`, `docs/runbooks/payment-gateways.md`, `scripts/dev-ports.mjs`:** no change. There is no new secret; the gateway keys stay on finance, so the key script's `-Configs "apps\admin\wrangler.finance.jsonc"` target is unchanged. The new Worker runs inside the admin Vite process (one inspector port). Step 0.4 may change the last.

### D. Scripts (B1 for D.1–D.4; B2 for the rest)
1. **`scripts/worker-budget.mjs`:**
   - **new `adminInvoices`:** file `apps/admin/dist/techaust_platform_admin_invoices/index.js`; `maxBytes` 800,000; `planBytes` 650,000; `maxStartupMs` 200; forbidden `CLASSIC_ZOD`, `PDF_LIB`, `PUPPETEER`, `PDF_FONTS`, `SIGN_IN_TABLES`, `GST_CORE`, `GATEWAY_CODE`;
   - **new marker `GATEWAY_CODE`:** string contents that survive minification and exist only in the gateway **client** modules (`gateway/razorpay.ts`, `stripe*.ts`, `paypal*.ts`), never in `messages.ts` or `reasons.ts`, which invoices legitimately carries. For example `/api\.razorpay\.com|api\.stripe\.com|api-m(?:\.sandbox)?\.paypal\.com/`; pick from the bundle, and test that the marker matches today's finance bundle. Add it to `admin`, `adminApi` and `adminInvoices`;
   - **`adminFinance`:** add `INVOICE_CODE` to its forbidden list; `planBytes` 500,000 (lead decision L4); ceiling 800,000 kept;
   - **an `ADVANCE_CODE` marker** (a string only `gateway/advance.ts` holds) forbidden in `adminFinance`, so the advance never comes back into finance;
   - update the comments (the fourth Worker, M-date).
2. **`scripts/check-worker-config.mjs`:**
   - `wrangler.invoices.jsonc` joins the auxiliary admin configs: no public URL in any scope; bindings in step with the front per scope (D1, R2, `EMAIL_QUEUE`, `PDF_QUEUE`); **no `secrets`** and no `LEADS_QUEUE` (as the API); `PAYMENTS_LIVE_ALLOWED` `"false"` in every scope; the staging observability rule;
   - the front: three service bindings (`ADMIN_API`, `ADMIN_FINANCE`, `ADMIN_INVOICES`) with the right targets per scope;
   - finance: `ADMIN_ADVANCE` → invoices / `GatewayAdvance` per scope, and **finance is the only config with gateway secrets** (existing `FINANCE_OPTS`; unchanged);
   - jobs: `ADMIN_JOBS` must target the invoices Worker (`BillingJobs`), `ADMIN_ADVANCE` the invoices Worker (`GatewayAdvance`), `ADMIN_GATEWAY` the finance Worker (`GatewayEvents`); the portal's `ADMIN_PAY` the finance Worker;
   - tests for each new rule in the existing test file, failure cases included.
3. **`scripts/check-staging-build.mjs`:** a target `admin-invoices` (`dist/techaust_platform_admin_invoices/wrangler.json` names `techaust-platform-admin-invoices-staging`; a plain build names the production Worker and fails).
4. **`scripts/check-prod-readiness.mjs`** (review finding 4):
   - add the new config to its production config list (`PROD_CONFIGS` or its equivalent), with the same checks as finance;
   - extend `checkProductionConfig` (`:198-220` on 3f19098, today only queue producers, consumers and Turnstile) so **every `services` binding in `env.staging` needs a production twin** with the same binding name and entrypoint, and a production service name. Without this, a production finance without `ADMIN_ADVANCE`, or a production jobs without `ADMIN_JOBS`, `ADMIN_ADVANCE` or `ADMIN_GATEWAY`, passes the Phase 7 gate;
   - add a failing test for each case. The script runs only in `deploy-prod.yml`, which already fails while production lacks its bindings.
5. **`scripts/staging-health.mjs` `CHECKS.admin`:**
   - `/api/v1/health` 200 (front);
   - `/api/v1/leads` 401 (API);
   - `/api/v1/dashboard` 401 (now **invoices**);
   - **+ `/api/v1/payments` 401 (finance)**, never a 502.

   Update its test and the comment ("four Workers").
6. **`scripts/cpu-probe.mjs`:** an `invoices` Worker.
   - It loads the invoices module, adds `ADMIN_INVOICES` to `frontEnv` (`:330-334` on 3f19098 builds it with only `ADMIN_API`/`ADMIN_FINANCE`), and gives `financeEnv` an `ADMIN_ADVANCE` that calls the loaded `GatewayAdvance`.
   - A new probe row: `rpc GatewayAdvance.issueGatewayAdvance`.
   - The hot routes are reassigned as the rows are: issue, `GET /invoices/:id`, `PATCH`, advance-invoice, the dashboard, `/invoices` and `/approvals` → invoices; `/invoices/:id/payments`, `/payments/review` and the gateway RPC dry runs stay finance.
   - `--write-fixtures` writes `warm-fixtures/invoices.ts` and slims `warm-fixtures/finance.ts`.
7. **Start-up dry run:** `INVOICES_WARM` and a slimmer `FINANCE_WARM`, regenerated with `node scripts/cpu-probe.mjs --write-fixtures` after building admin and jobs (runbook `cpu-baseline.md`). The dry runs:
   - invoices' covers `BillingJobs` and **`GatewayAdvance.issueGatewayAdvance`**, with made-up fixtures in the L31 pattern;
   - finance's keeps the gateway RPC dry runs (M6.4 L31; `GatewayEvents.issueGatewayAdvance` is gone, B.3), and runs the review-retry route against a **warm stub `ADMIN_ADVANCE`** that answers a made-up `IssueAdvanceResult` and never calls out;
   - the jobs dry run (`apps/jobs/src/warm.ts`, if it covers `gateway.advance`) uses a warm stub `ADMIN_ADVANCE` the same way.

   `.gitleaks.toml` already allows the folder. `warm-routes.test.ts` and the fixtures test are updated.
8. **Runbooks:**
   - `docs/runbooks/environments.md`: the fourth admin Worker, its bindings and the deploy order;
   - `docs/runbooks/cpu-baseline.md`: an invoices row, and the dashboard and invoice rows moved under it.

   CLAUDE.md, 12 and 13 belong to the main session (see "Proposed CLAUDE.md text").

### E. The workflow (B2, **only after the owner's yes to Q1**)
`.github/workflows/deploy-staging.yml`:
- one new step "Deploy 2 of 7, the admin invoices Worker (staging)" (`pnpm --filter @techaust/admin run deploy:staging:invoices`), with the same env and token handling as the finance step;
- the order of C.6: 1 admin API, 2 admin invoices, 3 admin front, 4 jobs (with its health check), 5 admin finance, then the admin health check (all four admin Workers), 6 portal, 7 web, each step named "N of 7". The steps keep their existing commands, env and health checks; only their positions change;
- the admin health step's name says four Workers;
- the order comment updated.

Nothing else changes: no new secret, no new permission, actions pinned by SHA, fork-safe.

### F. Tests
1. **`apps/admin/worker/split.test.ts`:**
   - ownership both ways for the three-way split: every `on: "invoices"` row is answered by the invoices app and 404 in the finance and API apps, and the same for finance and API rows;
   - the forwarder picks `ADMIN_INVOICES` for every invoices row (and only those);
   - parity: the union of the four route sets equals `ROUTES`;
   - entrypoints: `BillingJobs` and `GatewayAdvance` exported by `invoicing.ts` only, with exactly their method lists; `GatewayEvents` and `PortalPayments` by `finance.ts` only; no other named exports on any entry.
2. **`test-app.ts`:** mounts all four route sets in process (every route available, as today), with **`mountInvoices` before `mountFinance`**, so the in-process order matches today's `routes-finance.ts` order (the invoice routers came first).
3. **The advance across the hop** (review finding 1):
   - the admin tests that run the review retry route, or called `GatewayEvents.issueGatewayAdvance` before, get an in-process `ADMIN_ADVANCE` that calls the real `issueGatewayAdvance` with the passed (counting) env (`test-gateway.ts`); they now call `GatewayAdvance` directly. This covers `gateway-review.test.ts` (≤ 45 statements), `gateway.test.ts` (the advance cases) and the race injections;
   - assert ≤ 45 D1 statements per invocation on each side;
   - **jobs:** `gateway.advance` calls `ADMIN_ADVANCE`. A real `retry` keeps today's one-retry rule. **The binding throws on the last try → the handler throws, the queue redelivers, and after `max_retries` the dead-letter path writes the `dead_letter` review item and rings the bell.** A malformed answer throws the same way. No message is acked with nothing written;
   - **the Owner's route:** the binding throws → the standard 500, nothing written, the review item stays open, never 409 `ADVANCE_CHANGED`; a malformed answer → the same;
   - `GatewayAdvance` refuses a bad id (TypeError, nothing written); `lastTry` other than `true` is ignored.
4. **Budget and config guards:** `packages/core/test/worker-budget.test.ts` (the new budget and the `GATEWAY_CODE`/`ADVANCE_CODE` markers, each matching today's finance bundle text and not the others); `check-worker-config` tests (every new rule, with a failing case each); `check-staging-build` and `staging-health` tests.
5. **`warm-routes.test.ts` and the fixtures test** fail when a hot route of either Worker changes (as today), now per Worker.
6. **No test calls a gateway** (stubbed `fetch`, as today). The full `pnpm test` and `pnpm check` must be green. Any test that moved Worker keeps its assertions word for word.

### G. Free plan, bytes and CPU
- **Bytes after the split (exact, on M6.4):** finance about 309,347 (plus the L31 dry runs, about 320–330 K); invoices about 511,770; API and front unchanged. Record the real numbers from the build in the builder report.
- **Start-up** ≤ 200 ms each, the fastest of 7. Measured on the exact bundles without fixtures: finance 32 ms, invoices 51 ms; expect about 40–55 ms each with the dry runs.
- **Per request:** every admin request still crosses exactly two Workers (front → one answering Worker). Jobs' `gateway.advance` still crosses two Workers (jobs → invoices, where it was jobs → finance). Only the Owner's review retry adds a hop (front → finance → invoices), each invocation with its own 10 ms meter.
- **First-call targets** as M6.4 L31: `GatewayAdvance.issueGatewayAdvance` ≤ 7 ms first run on staging (local proxy ≤ 2.5 ms); `f:1` on the new `ev:"rpc"` and `ev:"fwd"` lines.
- **No `import()`.** Schemas at module top level. One unit of work per queue message (unchanged).
- **The staging cold reading** of all four admin Workers goes in `docs/runbooks/cpu-baseline.md` after the deploy (lead).

### H. Done means
- Every row in the right Worker: `split.test.ts` green, and the budget markers prove that no invoice code is in finance and no gateway code is in invoices, the API or the front.
- `pnpm check` and `pnpm test` green on the branch tip (numbers stated); the admin build prints all four budgets under their plan lines.
- The configs pass `check-worker-config.mjs`, with no public URL for the new Worker in any scope.
- The early check is GO, the reviewer APPROVEs, and every finding is fixed or kept with a reason.
- After the merge, staging deploys in seven steps in the C.6 order, the admin health check passes (four Workers), and a staging walk-through works: an invoice list and detail, a draft and issue, the dashboard, a report page, Payments and "Needs review", and a sandbox payment link opening. The owner approves on staging.

### I. Out of scope
- Any change in behaviour, copy, screens, migrations, secrets or the gateway code itself.
- Moving the gateway keys. Renaming the finance Worker (that would move all five secrets).
- Production bindings (Phase 7).
- M6.5's own work; its brief is amended by the main session (Follow-ups).

### J. Risks
1. **A forgotten row mark** is a deny-by-default 404 in the wrong Worker. Mitigated by `split.test.ts` ownership and parity, and by the Step 0.2 classification.
2. **The local auxiliary-to-auxiliary entrypoint binding** (finance → invoices) is unproven under the Vite plugin and vitest (Step 0.4). If dev can't connect it, the lead decides between:
   - (i) tests and staging only, with dev answering the standard 500 on that one Owner action (the jobs path is already a cross-process binding locally, a known M6.2 follow-up);
   - (ii) the retry route enqueues `gateway.advance` and answers "queued" (a behaviour and copy change, so an owner question).
3. **An undone import cut** brings the invoice chain back into finance (about 108 KB). Mitigated by `INVOICE_CODE` and `ADVANCE_CODE` in `adminFinance.forbidden`.
4. **Hono mount order in finance:** the gateway and advice routers must stay before `payments` (`/:id`).
5. **M6.4's fix round** (B3: `finance.ts`, `warm-routes.ts`, `cpu-probe.mjs`, the fixtures) must be merged first. That is why the split starts from `main` after M6.4. No migrations, so there's no migration-order issue.
6. **A swallowed RPC failure** would leave a proforma paid online without its tax invoice and nobody told (review finding 1). B.3–B.4 never turn a thrown binding error into a result, and F.3 tests the dead-letter path.
7. **First deploy:** no gap with the C.6 order. With Q1 B, about 1–2 minutes of invoice-row 404s and retried `care.bill` calls on staging only.

## Review
### Round 1 (reviewer, 2026-11-02, against `origin/feat/m6.4-paypal` 3f19098): **SEND BACK**, 1 high, 2 medium (plus 1 medium), 4 low → all fixed by the lead
Skills: `code-review` (high; each finding re-checked by the reviewer); the Cloudflare skills are absent in cloud sessions; `security-review` not loaded (it reviews code diffs; this branch changes a plan only).
Confirmed against the code: the 32/29 row split and its rule; the mount order; `advance.ts` reads only `DB` and `PDF_QUEUE`, with its only other caller at `routes.ts:345`; the invoice side imports no gateway client or key; the moved modules read only `DB`, `DOCS`, `EMAIL_QUEUE`, `PDF_QUEUE`; no batch spans two Workers; the follow-ups' claims about the M6.5 brief.
1. **High:** the draft's `advanceViaRpc` turned a thrown binding error into `retry`. Jobs (`apps/jobs/src/gateway.ts:76-80`, `ADVANCE_TRIES` 2) acks the last try, so a broken invoices binding would leave a proforma paid online without its tax invoice and nobody told (today a throw reaches `queue.ts:206` → redelivery → dead letter → review item and bell). The Owner's route would also have answered 409 `ADVANCE_CHANGED`, whose text is false during an outage. **Fixed:** B.3–B.4, F.3, L2. Jobs binds `GatewayAdvance` directly; errors propagate; the route gives the standard 500.
2. **Medium:** a deploy order with no first-deploy gap exists (API → invoices → front → jobs → finance). **Fixed:** C.6, E, Q1 (it names the change from the 2026-10-31 order), L5; Q2 dropped.
3. **Medium:** A.6's "importers don't change" would keep `invoice-model.ts`' `INVOICE_CODE` lines in finance. **Fixed:** A.6 (payments-side importers import from `invoice-consts.ts`).
4. **Medium:** `check-prod-readiness.mjs` `checkProductionConfig` doesn't check service bindings, so a production finance or jobs without its bindings would pass the Phase 7 gate. **Fixed:** D.4, L7.
5. **Low:** Step 0.3 checked imports in one direction only (`advance.ts` → `settle.ts` `REVIEW_LINK` pulls settle's SQL into invoices; `CLIENT_GONE` not named); `GATEWAY_CODE` must come from client modules only. **Fixed:** Step 0.3, A.6, D.1.
6. **Low:** the RPC helpers would be copied. **Fixed:** A.9 (`worker/rpc.ts`).
7. **Low:** Step 0.1's 15 KB threshold sat inside M6.4 B3's expected growth. **Fixed:** compared against M6.4's final figure, 30 KB.
8. **Low:** the probe and test wiring wasn't named. **Fixed:** D.6 (`frontEnv`, `financeEnv`, a probe row), F.2 (mount order), Step 0.4 (jobs' local bindings).

## Lead decisions (for 13)
- **L1 (Lead, 2026-11-02):** the fourth admin Worker is **`techaust-platform-admin-invoices`** (cut B1). It holds invoices and notes, issue, approvals, reports, statements, the dashboard and `BillingJobs`. The admin finance Worker keeps payments, the ledger, credit, advices, the gateways, their five keys and the `GatewayEvents`/`PortalPayments` entrypoints.
  - Reasons: both Workers keep 120 KB or more under their lines through M7.3, no secret moves (the Razorpay and Stripe test secrets are shown once), the portal is untouched, jobs changes one call (B.3), and no D1 batch spans two Workers.
  - Rejected: a gateway-only Worker (finance only ~50–60 KB under the line after M7.3, and all five secrets move); moving reports or care billing alone (finance stays over 650,000).
- **L2 (changed after review finding 1):** the gateway advance runs in the invoices Worker behind a new entrypoint `GatewayAdvance`.
  - Jobs binds it directly (`ADMIN_ADVANCE`), and `GatewayEvents` drops `issueGatewayAdvance`. Finance binds it only for the Owner's review retry.
  - A thrown binding error or a malformed answer propagates: in jobs to the queue's retry and dead letter (the review item and the bell, as today); in the Owner's route to the standard 500. It is never turned into `retry` or "issued".
  - This replaces the draft's finance forward, which turned a binding failure into `retry` and would have acked the last try with nothing written.
- **L3:** the import cuts: `INVOICE_VOID` into `invoice-consts.ts` (payments-side importers import it from there), `CLIENT_GONE` from a side-effect-free module, `REVIEW_LINK` into `gateway/consts.ts`. `INVOICE_CODE`/`ADVANCE_CODE` are forbidden in finance, and a `GATEWAY_CODE` marker (from the gateway client modules only) in the front, API and invoices. The RPC helpers go in a shared `worker/rpc.ts`.
- **L4:** budgets: `adminInvoices` ceiling 800,000, plan line 650,000; `adminFinance` plan line lowered to 500,000 (estimated ~380 K at the end of M7), ceiling 800,000 kept. Start-up ≤ 200 ms each.
- **L5 (changed after review finding 2):** deploy order admin API → admin invoices → admin front → jobs → admin finance → portal → web (Q1 A). Every bound Worker exists at every step, so the first deploy has no gap and Q2 (a rollback rule) is dropped. Health: `/payments` 401 added for finance; `/dashboard` 401 now proves invoices.
- **L7:** `check-prod-readiness.mjs` requires a production twin for every staging service binding (review finding 4).
- **L6:** Tier B, with an analyst early check after the routing, config and RPC layer (a money path's hop), as M6.1 stage A.

## Proposed CLAUDE.md text
_For the main session after the split merges (replaces "The admin API is three Workers (M5.0; the third in M6.1)")._

> **The admin API is four Workers (M5.0; the third in M6.1; the fourth before M6.5):** the front (`worker/index.ts`, `wrangler.jsonc`) serves the SPA plus the `ROUTES` rows marked `on: "front"` (health, `/auth/*`, `/users/*`) and forwards every other row untouched (`forward.ts`, before any middleware):
> - rows marked `on: "invoices"` with `ADMIN_INVOICES.fetch(c.req.raw)` to `techaust-platform-admin-invoices` (`worker/invoicing.ts`, `wrangler.invoices.jsonc`, `routes-invoices.ts`, row helper `I`: invoices and notes, a client's invoices and statement, reports, the approval queue and decision, the dashboard). It also exports `BillingJobs` (jobs, `ADMIN_JOBS`) and `GatewayAdvance` (the automatic tax invoice of a proforma paid online; bound as `ADMIN_ADVANCE` by jobs, and by finance for the Owner's "Try again"; a binding failure is thrown, never read as a result);
> - rows marked `on: "finance"` with `ADMIN_FINANCE.fetch` to `techaust-platform-admin-finance` (`worker/finance.ts`, `wrangler.finance.jsonc`, `routes-finance.ts`, row helper `X`: payments, TDS, credit, advices, payment links, "Needs review", the gateways). It holds the gateway test keys and exports `GatewayEvents` (jobs, `ADMIN_GATEWAY`) and `PortalPayments` (portal, `ADMIN_PAY`);
> - every other row with `ADMIN_API.fetch` to `techaust-platform-admin-api`.
>
> The API, finance and invoices Workers are Vite auxiliary Workers with no public URL in any scope. All four build from `createApp` in `app.ts`, re-run CSRF and the guard from the cookie, and hold no secrets except finance's gateway keys. New admin routes go in `routes-api.ts`, `routes-invoices.ts` (documents of the invoice family, reports, statements) or `routes-finance.ts` (money in and out, gateways). The budget markers keep the invoice chain out of finance and the API, and gateway code out of the others.

Also in "Worker budget": "admin invoices 800,000 (plan line 650,000), admin finance 800,000 (plan line 500,000)". In "Staging deploys build first, then deploy": "seven deploys in order: admin API, admin invoices, admin front, jobs, admin finance, portal, web (`deploy:staging:invoices`; every bound Worker exists at every step)". In "Razorpay (M6.2)": the automatic invoice "under the issuing Owner's `gateway_auto` authority" runs in the invoices Worker through `GatewayAdvance`.

## Follow-ups (for 12)
- **The M6.5 brief needs amending before M6.5 starts (main session):**
  - §B/§C/§D put `issueReceipt`, `checkRefund` and `fetchSettlements` on `BillingJobs`. After the split they belong on finance's **`GatewayEvents`**, because they need the keys or are payment-side and `BillingJobs` lives in invoices. Jobs routes `receipt.issue`, `refund.check` and the settlement fetch to `ADMIN_GATEWAY`.
  - §F line "all five Workers" becomes six configs for `PAYMENTS_LIVE_ALLOWED`.
  - Any M6.5 credit-note-with-refund route goes to invoices, its refund leg to finance.
- **M7.3 brief:** C1–C6, C9 (revenue, ageing, dashboard v2) and J's `warmReports` go to the invoices Worker (`warm-invoices.ts`), not finance. **M7.1:** `/payments/notices` stays finance.
- **Not verified in planning:** start-up with the real fixtures; the B3, M6.5 and M7 growth (brief estimates); the local auxiliary-to-auxiliary entrypoint binding (Step 0.4); whether wrangler refuses a deploy whose bound Worker is missing (Step 0.6); whether service-binding and RPC calls count against the Free plan's daily request limit (each counts as an invocation; checked at the staging reading).

## Handover
Brief written from the analyst's draft and checked by the lead against the M6.4 branch (the import cut, the advance's callers, the row count). Review round 1 SEND BACK, all eight findings fixed; the reviewer re-checks. Then the owner's Q1 and Q2 go to the main session; then the PR.
