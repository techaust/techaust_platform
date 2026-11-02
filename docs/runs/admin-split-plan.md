Status: PR READY https://github.com/techaust/techaust_platform/pull/163
Tier: B (Workers; planning only, no code)
Usage: lead claude-opus-5-5/high (cloud session admin-split-plan); analyst (measure + options) claude-opus-5-5/high, skills asked for `cloudflare:workers-best-practices`, `cloudflare:wrangler`, `cloudflare:workers-profiling` (each "Unknown skill": Cloudflare skills don't load in cloud sessions; no other skill fits a split plan): 5-h 5 % at start (23:12 IST). reviewer (brief, round 1 and re-check) claude-opus-5-5/high, skill code-review (Cloudflare skills absent in the cloud; security-review not fitting a plan), and its `code-review` helper general-purpose claude-opus-5-5/high (read-only, the docs/14 §9 exception): 5-h 5 % at start (reading). Readings: USAGE 26 at 2026-11-02T23:56+05:30; USAGE 5 at 2026-11-02T23:40+05:30; USAGE 25 at 2026-11-02T23:52+05:30; USAGE 24 at 2026-11-03T00:20+05:30.

# Run: the fourth admin Worker (split the admin finance Worker before M6.5), build brief

Session: `admin-split-plan` (cloud). Branch: `docs/admin-split-plan` (from `main` e765e2f). Copy file: none (the split adds no user-facing wording). **Planning only:** this file is the only file the run changes; no code, configs or migrations.

**Why:** L28/L32 of 2026-11-02 in `docs/runs/m6.4-paypal.md` (on `origin/feat/m6.4-paypal`). On the M6.4 branch the admin finance Worker is at 701,805 of 800,000 bytes, past the 650,000 plan line (CLAUDE.md "Worker budget": "a fourth admin Worker is planned when finance passes the 650,000 planBytes line"). M6.5 (refunds, receipts, reconciliation) adds about 40 KB more to finance, and M7.3 adds about 15 KB. The owner chose this planning run on 2026-11-02. **The split is built after M6.4 merges and before M6.5 starts.**

## Questions for the owner
**Owner's answers (2026-11-02, through the main session):**
- **Q1 A** ("New step, reordered (Recommended)"): the staging deploy order becomes admin API, **admin invoices (new)**, admin front, **jobs**, **admin finance**, portal, website. The health check covers all four admin Workers. (The main session relayed it as "New step, reordered (Recommended)", the round 1 wording of option A.)
- **Q2 A** ("Yes, roll back, tell me after (Recommended)"): if the split misbehaves on staging, the lead may roll the staging admin front, admin finance and jobs Workers back to their previous versions straight away and tell the owner afterwards (staging only), as the M5.0 rule of 2026-10-27. The Q1 order has no gap on this deploy, so this is a safety net only.

- **Q3 A** ("Yes, move it in M6.5 (Recommended)", 2026-11-02): keep the Q1 order for the split; in the M6.5 PR the finance step moves back right after admin invoices (admin API, admin invoices, admin finance, admin front, portal, jobs, website) and stays there.

**Q3 (asked 2026-11-02, answered A above). The deploy order after the split.**
The order you chose (Q1 A) is the right one for the split itself: nothing on staging breaks during that deploy. The reviewer then found that the same order is the wrong way round for later deploys that **add** something to the finance Worker that jobs uses. M6.5 does exactly that (receipts, refund checks and settlement downloads). With jobs going first, the new jobs would call finance for a few minutes before finance has the new parts. Those jobs would be retried, and some could land in "Needs review". So M6.5 needs finance deployed **before** jobs again.
- **A (Recommended):** keep your Q1 order for the split. In the M6.5 PR, move the finance step back to right after admin invoices (admin API, admin invoices, admin finance, admin front, portal, jobs, website: your 2026-10-31 order with the new step added) and keep it there from then on. This is a one-step move in `deploy-staging.yml`, approved now so M6.5 doesn't wait.
- B: decide it when M6.5 is ready (the M6.5 PR is held until then).
- C: keep jobs before finance permanently, and accept retried jobs (and possibly "Needs review" items) on staging at each deploy that adds a finance method.

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
1. **`@techaust/core/gateway-rpc`:** a `GatewayAdvanceApi` with one method, `issueGatewayAdvance({paymentId, lastTry?}): Promise<IssueAdvanceResult>`. Reuse the existing answer guard `isIssueAdvanceResult` (`packages/core/src/gateway-rpc.ts:62` on 3f19098); add none. `GatewayEventsApi` loses `issueGatewayAdvance`.
2. **`invoicing.ts` `GatewayAdvance extends WorkerEntrypoint<Env>`:**
   - exactly that one public method;
   - `rpcId` check on `paymentId` (1–64 characters), else a TypeError with nothing written; `lastTry` taken only when strictly `true`;
   - calls `issueGatewayAdvance(this.env, paymentId, { lastTry })` from `gateway/advance.ts`, which now lives in the invoices bundle only;
   - one id-only `ev:"rpc"` line with `f` (`rpc.ts`).
3. **Jobs calls it directly (lead decision L2).**
   - New jobs binding **`ADMIN_ADVANCE` → `techaust-platform-admin-invoices(-staging)` / `GatewayAdvance`** (C.4).
   - `apps/jobs/src/gateway-rpc.ts`: `adminGateway(env)` no longer requires or wraps `issueGatewayAdvance` (today it throws `rpc_unavailable` unless the binding has both methods, `:34-36`; once `GatewayEvents` drops the method, every `gateway.event` would throw against the test fakes in `apps/jobs/test/gateway.test.ts:318` and `stripe-hook.test.ts:300`, while a real RPC stub would hide it on staging). A new `adminAdvance(env)` in the same file wraps `env.ADMIN_ADVANCE` with the existing `GatewayRpcError` codes: `rpc_unavailable` for a missing binding or method, and `rpc_bad_result` when `isIssueAdvanceResult` fails. **Both throw.**
   - `apps/jobs/src/gateway.ts` `gateway.advance` calls `adminAdvance(env).issueGatewayAdvance({ paymentId, lastTry })` in place of `adminGateway(env).issueGatewayAdvance`. The test fakes are updated to the new shapes.
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
6. **Deploy order (the owner's Q1 A, 2026-11-02):** admin API → **admin invoices** → admin front → **jobs** → **admin finance** → portal → web.
   - **Every bound Worker exists at every step,** and the old finance Worker still answers every row and still exports `BillingJobs` and `GatewayEvents.issueGatewayAdvance` until step 5:
     - the new front sends invoice rows to the live invoices Worker and the rest to the old finance and the API;
     - the new jobs calls invoices (`ADMIN_JOBS`, `ADMIN_ADVANCE`) and the old finance (`ADMIN_GATEWAY`: `processEvent`, `refreshCheckout`, which the old finance has);
     - the new finance binds invoices (`ADMIN_ADVANCE`), which already exists;
     - the portal binds finance (unchanged).
   - So **this deploy has no gap** (no 404s, no failed `care.bill` or `gateway.advance` calls), and a deploy that stops at any step leaves a working set.
   - **This order is right for a deploy that removes from finance, and wrong for one that adds a finance method jobs calls** (review round 2, finding 1). M6.5 adds `issueReceipt`, `checkRefund` and `fetchSettlements` to `GatewayEvents`, so M6.5 restores finance before jobs (owner's Q3 A, 2026-11-02; Follow-ups).
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
   - jobs: no change. Its start-up warm-up (`apps/jobs/src/warm.ts:312` → `packages/core/src/warm.ts:167` `warmGatewayMessages`) only parses the message schemas and makes no RPC.

   `.gitleaks.toml` already allows the folder. `warm-routes.test.ts` and the fixtures test are updated.
8. **Runbooks:**
   - `docs/runbooks/environments.md`: the fourth admin Worker, its bindings and the deploy order;
   - `docs/runbooks/cpu-baseline.md`: an invoices row, and the dashboard and invoice rows moved under it.

   CLAUDE.md, 12 and 13 belong to the main session (see "Proposed CLAUDE.md text").

### E. The workflow (B2, **only after the owner's yes to Q1**)
`.github/workflows/deploy-staging.yml`:
- one new step "Deploy 2 of 7, the admin invoices Worker (staging)" (`pnpm --filter @techaust/admin run deploy:staging:invoices`), with the same env and token handling as the finance step;
- the order of C.6 (owner's Q1 A): 1 admin API, 2 admin invoices, 3 admin front, 4 jobs (with its health check), 5 admin finance, then the admin health check (all four admin Workers), 6 portal, 7 web, each named "N of 7". The steps keep their commands, env and health checks; only their positions change. The admin health check runs after step 5, once all four admin Workers are new;
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
7. **The deploy order after the split (C.6, Q3):** the owner's order has no gap for this deploy, but a later deploy that adds a finance method jobs calls must deploy finance first. M6.5's PR moves the finance step back before jobs (owner's Q3 A).

## Review
### Round 2, re-check (reviewer, 2026-11-02, at cd598ae3): **APPROVE**, 0 critical, 0 high, 1 medium, 2 low → all fixed by the lead
All eight round 1 findings were confirmed fixed against the code (`queue.ts:116-119,206`, `gateway.ts:76-80,160`, `app.ts:197` `onError`, `invoice-model.ts:66,82`, `check-prod-readiness.mjs:198-220`). The C.6 claims about the old finance Worker during the window held.
1. **Medium:** the round 1 order (jobs before finance) would be permanent, and it breaks later deploys that add finance methods jobs calls (M6.5's `issueReceipt`, `checkRefund`, `fetchSettlements` on `GatewayEvents`). Q1 A told the owner something true for this deploy only, and the order sat against docs/13 2026-10-30 ("admin API, then jobs") and 2026-10-31 (finance before the front). The reviewer corrected its own round 1 advice. **Handled:** the lead first moved the brief back to callee-first; then the owner's Q1 answer (option A of the round 1 wording, jobs before finance) arrived and stands for the split's deploy, where it has no gap. The later-deploy problem goes to the owner as Q3 (restore finance before jobs in M6.5's PR) and to Follow-ups; C.6, E, L5 and J.7 say so.
2. **Low:** B.3 didn't name `apps/jobs/src/gateway-rpc.ts`: `adminGateway()` throws `rpc_unavailable` unless the binding has `issueGatewayAdvance` (`:34-36`), so the test fakes would break. **Fixed:** B.3 (`adminGateway` drops it, a new `adminAdvance` with `rpc_unavailable`/`rpc_bad_result`), B.1 (reuse `isIssueAdvanceResult`, `packages/core/src/gateway-rpc.ts:62`), L1.
3. **Low:** the jobs warm-up makes no RPC (`apps/jobs/src/warm.ts:312` → `warmGatewayMessages`). **Fixed:** the D.7 bullet now says so.

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
  - Reasons: both Workers keep 120 KB or more under their lines through M7.3, no secret moves (the Razorpay and Stripe test secrets are shown once), the portal is untouched, jobs changes only `gateway.ts` and `gateway-rpc.ts` (B.3), and no D1 batch spans two Workers.
  - Rejected: a gateway-only Worker (finance only ~50–60 KB under the line after M7.3, and all five secrets move); moving reports or care billing alone (finance stays over 650,000).
- **L2 (changed after review finding 1):** the gateway advance runs in the invoices Worker behind a new entrypoint `GatewayAdvance`.
  - Jobs binds it directly (`ADMIN_ADVANCE`), and `GatewayEvents` drops `issueGatewayAdvance`. Finance binds it only for the Owner's review retry.
  - A thrown binding error or a malformed answer propagates: in jobs to the queue's retry and dead letter (the review item and the bell, as today); in the Owner's route to the standard 500. It is never turned into `retry` or "issued".
  - This replaces the draft's finance forward, which turned a binding failure into `retry` and would have acked the last try with nothing written.
- **L3:** the import cuts: `INVOICE_VOID` into `invoice-consts.ts` (payments-side importers import it from there), `CLIENT_GONE` from a side-effect-free module, `REVIEW_LINK` into `gateway/consts.ts`. `INVOICE_CODE`/`ADVANCE_CODE` are forbidden in finance, and a `GATEWAY_CODE` marker (from the gateway client modules only) in the front, API and invoices. The RPC helpers go in a shared `worker/rpc.ts`.
- **L4:** budgets: `adminInvoices` ceiling 800,000, plan line 650,000; `adminFinance` plan line lowered to 500,000 (estimated ~380 K at the end of M7), ceiling 800,000 kept. Start-up ≤ 200 ms each.
- **Owner (2026-11-02), for 13:** Q1 A, the staging deploy order admin API, admin invoices, admin front, jobs, admin finance, portal, website (one new step, finance moved after the front); Q2 A, a staging rollback of the admin front, admin finance and jobs Workers straight away, told afterwards; Q3 A, in the M6.5 PR the finance step moves back right after admin invoices (admin API, admin invoices, admin finance, admin front, portal, jobs, website) and stays there.
- **L5:** the split's deploy order is the owner's Q1 A (2026-11-02): admin API → admin invoices → admin front → jobs → admin finance → portal → web, with no gap on this deploy. Health: `/payments` 401 added for finance; `/dashboard` 401 now proves invoices. Review round 2 found that jobs-before-finance breaks a later deploy that adds finance methods jobs calls, so M6.5's PR restores finance before jobs (owner's Q3 A).
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

Also in "Worker budget": "admin invoices 800,000 (plan line 650,000), admin finance 800,000 (plan line 500,000)". In "Staging deploys build first, then deploy": "seven deploys in order: admin API, admin invoices, admin front, jobs, admin finance, portal, web (`deploy:staging:invoices`; owner 2026-11-02; from M6.5: admin API, admin invoices, admin finance, admin front, portal, jobs, web, owner's Q3 A)". In "Razorpay (M6.2)": the automatic invoice "under the issuing Owner's `gateway_auto` authority" runs in the invoices Worker through `GatewayAdvance`.

## Follow-ups (for 12)
- **M6.5 brief, deploy order (owner's Q3 A, 2026-11-02):** the M6.5 PR moves the `deploy-staging.yml` finance step back right after admin invoices: admin API, admin invoices, admin finance, admin front, portal, jobs, website. It stays there from then on; the owner's yes is already given. Reason: M6.5 adds finance methods that jobs calls.
- **The M6.5 brief needs amending before M6.5 starts (main session):**
  - §B/§C/§D put `issueReceipt`, `checkRefund` and `fetchSettlements` on `BillingJobs`. After the split they belong on finance's **`GatewayEvents`**, because they need the keys or are payment-side and `BillingJobs` lives in invoices. Jobs routes `receipt.issue`, `refund.check` and the settlement fetch to `ADMIN_GATEWAY`.
  - §F line "all five Workers" becomes six configs for `PAYMENTS_LIVE_ALLOWED`.
  - Any M6.5 credit-note-with-refund route goes to invoices, its refund leg to finance.
- **M7.3 brief:** C1–C6, C9 (revenue, ageing, dashboard v2) and J's `warmReports` go to the invoices Worker (`warm-invoices.ts`), not finance. **M7.1:** `/payments/notices` stays finance.
- **Not verified in planning:** start-up with the real fixtures; the B3, M6.5 and M7 growth (brief estimates); the local auxiliary-to-auxiliary entrypoint binding (Step 0.4); whether wrangler refuses a deploy whose bound Worker is missing (Step 0.6); whether service-binding and RPC calls count against the Free plan's daily request limit (each counts as an invocation; checked at the staging reading).

## Handover
Brief written from the analyst's draft and checked by the lead against the M6.4 branch (the import cut, the advance's callers, the row count). Review round 1 SEND BACK (eight findings, all fixed); round 2 APPROVE with one medium and two lows (the lows fixed; the medium handled through the owner's Q1 answer and Q3). The owner answered Q1 A (jobs before finance) and Q2 A (staging rollback, tell after) on 2026-11-02, recorded and built into C.6 and E. Q3 A (2026-11-02): finance moves back before jobs in the M6.5 PR. PR #163 is open; the main session merges it.

## Builder B1 report (Early check)
_Builder B1, 2026-11-03, branch `fix/admin-invoices-b1` from `origin/feat/admin-invoices-worker` (1bf03b41, the M6.4 head). Commits f0e73b2d (the cut, RPC, config, scripts, workflow) and 275ad43c (tests green). Stopped for the analyst's early check (A–C built, their tests pass). Tier B._

### Skills
- `cloudflare:workers-best-practices`: loaded. Applied: no hand-written `Env` (finance reads `ADMIN_ADVANCE` by name like `LEADS_QUEUE`; the front's `ADMIN_INVOICES` comes from `wrangler types`), no swallowed RPC failure, entrypoints extend `WorkerEntrypoint`, `this.env` in the class, no module-level request state (the `rpc.ts` counter is the existing per-isolate call count).
- `cloudflare:wrangler`: loaded. Applied: `services` are not inherited, so each scope lists its bindings; the Vite plugin's auxiliary Worker and the `--config dist/<env>/wrangler.json` deploy; Step 0.6 read from the Cloudflare docs.
- `cloudflare:workers-profiling`: loaded. Not used: there is nothing deployed to profile here. The start-up figures below are the budget's local `node:vm` proxy; the staging cold reading stays the lead's (G).

### Step 0
1. **Re-measure** (`pnpm --filter @techaust/admin build` on 1bf03b41, `.logs/b1-admin-build-base.log`): front 111,333; API 489,722; **finance 712,415** (M6.4's final figure 712,195: +220 bytes, well under 30 KB, so the row lists stand).
2. **Row list:** 61 `X(...)` rows in `guard.ts`, at exactly the brief's lines. 32 to invoices (`:104,106,107` statement; `:169` dashboard; `:172,173,174,176` reports, `/reports/payments` included: served by `reports.ts`; `:217–243` the 22 invoice and note rows, `/service-completed` (served by `invoices.ts`) and `/reminders/pause|resume` (served by `invoice-send.ts`) included, and `GET /clients/:id/invoices`; `:289,290` approvals). 29 stay finance (`:248–284`). **Every row is covered by the rule; none needed the lead.**
3. **Import cuts, both ways:**
   - payments side into the invoice chain: only the two the brief named (`payment-ledger.ts:54` `INVOICE_VOID` from `invoice-model.ts`; `payments.ts:87` and `payment-ledger.ts:67` `CLIENT_GONE` from `quote-model.ts`) plus `gateway/routes.ts:24` importing `advance.ts` (the B.4 cut). Shared modules (`anonymised`, `docs-upload`, `session-refusal`, `system`, `settings-cache`, `http`, `keyset`, `payment-messages`, `warm-rpc`) import nothing of the chain.
   - invoice side into gateway code: only `advance.ts` → `./settle.ts` (`REVIEW_LINK`) and `./messages.ts`. No invoice-side module imports `gateway/**`, `payments.ts`, `payment-ledger.ts` or `advices.ts`.
   - All cut (A.6); nothing else found.
4. **Local service bindings with a named entrypoint (proved in `pnpm dev`, offset 100, with a temporary uncommitted probe route, reverted):**
   - finance (auxiliary) → invoices (auxiliary) `ADMIN_ADVANCE`/`GatewayAdvance` under `@cloudflare/vite-plugin` 1.62.5: **connects**; `issueGatewayAdvance({paymentId:"probe-none"})` answered `{"result":"not_pending"}` from the invoices Worker. A signed-out `/api/v1/dashboard` (invoices) and `/api/v1/payments` (finance) both answered 401 through the front.
   - jobs (`wrangler dev`, own process, dev registry) → invoices `ADMIN_JOBS`/`BillingJobs` and `ADMIN_ADVANCE`/`GatewayAdvance`: wrangler listed both `local [connected]`; the calls answered `{"result":"skipped",…,"why":"plan_missing"}` and `{"result":"not_pending"}`. **jobs → finance `ADMIN_GATEWAY`/`GatewayEvents` also connected** (`refreshCheckout` answered `{"result":"no_open_link"}`), so the M6.2 "never connected locally" follow-up did not reproduce on this PC today.
   - vitest: the pool has no invoices Worker; `test-helpers.ts` `withAdvance` gives every request of the combined app an in-process `ADMIN_ADVANCE` (the real `issueGatewayAdvance` on the passed env) unless the test brings its own; the pool's `ADMIN_INVOICES` is a 502 stub like the others.
5. **Env typing:** the front's generated `Env` (`wrangler types --env staging` on `wrangler.jsonc`) does not hold the finance-only bindings; finance reads them by name (`Reflect.get(env, "LEADS_QUEUE")`, `envText(env, …)` for the keys). `ADMIN_ADVANCE` gets the same treatment (`gateway/advance-rpc.ts`, `Reflect.get`); `ADMIN_INVOICES` is a front binding, so it is in the generated `Env` and `forward.ts` uses `env.ADMIN_INVOICES` typed. No hand-written `Env`.
6. **Deploy with a missing bound Worker:** Cloudflare's service-bindings page ("Deployment"): "the target Worker … must be deployed first … Otherwise, when you attempt to deploy Worker A, deployment will fail, because Worker A declares a binding to Worker B, which does not yet exist." A missing **named entrypoint** on an existing Worker is not stated there (the jobs config's old comment claimed it fails; not verified). The C.6 order never needs either.

### What I built
- **A (cut and routing):** `context.ts` (`on: "invoices"`), `guard.ts` (`I(...)`, 32 rows `X` → `I`, nothing else on the rows changed), `forward.ts` (`workerOf` three-way, `ADMIN_INVOICES`), new `routes-invoices.ts` (today's order), `routes-finance.ts` (gateway and advice routers still before `payments`), new `invoicing.ts` (default app, `BillingJobs` word for word, `GatewayAdvance`), `finance.ts` (no `BillingJobs`, no `issueGatewayAdvance`), new `rpc.ts` (`id`, `rpcId`, `rpcLog` moved from finance), `warm-finance.ts` / new `warm-invoices.ts`, `test-app.ts` (`mountInvoices` before `mountFinance`). Cuts: `INVOICE_VOID` into `invoice-consts.ts` (re-exported by `invoice-model.ts`), `CLIENT_GONE` into `anonymised.ts` (re-exported by `quote-model.ts`), new `gateway/consts.ts` (`REVIEW_LINK`; `settle.ts` re-exports it).
- **B (advance RPC):** core `GatewayAdvanceApi` (and `GatewayEventsApi` without the method); `GatewayAdvance` in `invoicing.ts`; new `gateway/advance-rpc.ts` (`advanceViaRpc`: a binding error is not caught, a malformed answer throws `AdvanceRpcError`), `gateway/routes.ts:345` calls it; jobs `gateway-rpc.ts` (`adminGateway` needs only `processEvent`; new `adminAdvance` with `rpc_unavailable`/`rpc_bad_result`, both throw), `gateway.ts` `gateway.advance` → `adminAdvance`; `billing-rpc.ts` comment.
- **C (config):** new `apps/admin/wrangler.invoices.jsonc` (no secrets, no services, no `LEADS_QUEUE`; `PAYMENTS_LIVE_ALLOWED` "false" in every scope; production vars only); `wrangler.finance.jsonc` `ADMIN_ADVANCE` (top level and staging); front `ADMIN_INVOICES` (three scopes); jobs `ADMIN_JOBS` → invoices, new `ADMIN_ADVANCE` (top level and staging); `vite.config.ts` third auxiliary Worker and its minify; `vitest.config.ts` (admin `ADMIN_INVOICES` stub, jobs `ADMIN_ADVANCE` stub); `package.json` (`adminInvoices` budget, `deploy:staging:invoices`); **`.github/workflows/deploy-staging.yml`** in the owner's Q1 A order: 1 admin API, 2 admin invoices, 3 admin front, 4 jobs (+ its health check), 5 admin finance, then the admin health check (named for four Workers), 6 portal, 7 web; commands, env and health checks unchanged, no new secret. Re-grep of `env.`/`c.env.` in the moved modules: only `DB`, `DOCS`, `EMAIL_QUEUE`, `PDF_QUEUE`.
- **D.1–D.4 (scripts):** `worker-budget.mjs` (`adminInvoices`; `GATEWAY_CODE` = the gateways' API hosts and the `/v1/payment_links`, `/v2/checkout/orders` paths, in `admin`, `adminApi`, `adminInvoices`; `ADVANCE_CODE` = `invoice.advance_issue_auto`, in `adminFinance` with `INVOICE_CODE`; finance plan line 500,000); `check-worker-config.mjs` (the invoices config in `ADMIN_AUX_CONFIGS`, `AUX_OPTS`/`INVOICES_OPTS`, `services` refused unless listed (finance: exactly `ADMIN_ADVANCE`, none in production), `frontServiceProblems` with `ADMIN_INVOICES` and pairwise distinct names, new `entrypointBindingProblems` for all five entrypoint bindings, jobs `BillingJobs` target = invoices, invoices in the live-flag check); `check-staging-build.mjs` (`admin-invoices`); `check-prod-readiness.mjs` (the invoices config in `PROD_CONFIGS`; every staging `services` binding needs a production twin with the same binding and entrypoint naming the production Worker).
- **Deviation (interim warm fixtures, for B2):** D.6–D.7 are B2's, so until the probe writes `warm-fixtures/invoices.ts`, both Workers dry-run the existing `FINANCE_WARM`, each only the calls its own app answers (`ownCalls` in `warm-routes.ts`): invoices the issue, an invoice, the dashboard, the list, approvals (4 of 5 answer below 400, as before); finance the invoice's Payments panel and "Needs review" (2). Both bundles carry that answer book (~20 KB) for now; B2 replaces it and can drop `ownCalls`.
- **Deviation (settings warm-up in both):** A.7 lists the settings schemas under invoices only; `warm-finance.ts` keeps `warmSettings()` too, because the finance paths read settings through `cachedSetting` (payment terms, the gateways' modes) and the warm-up was there before; removing it would move a ~1 ms cold parse into finance's first request. Counts pinned in new `warm-split.test.ts` (invoices 28, finance 8 + 9 + `GATEWAY_WARM_STEPS`).
- Found by the tests and fixed: `warmEnv` had no `ADMIN_INVOICES`, so the front's start-up dry run answered 502 on its three forwarded invoice calls; it now has the drop-everything stub.

### Routing table
| Worker | Rows | Entrypoints |
|---|---|---|
| admin front (`index.ts`) | 24 (health, sign-in, account, staff) | default |
| admin API (`api.ts`) | 118 | default |
| **admin invoices (`invoicing.ts`)** | **32** | default, `BillingJobs` (draftCarePlan, issueCareDraft), **`GatewayAdvance` (issueGatewayAdvance)** |
| admin finance (`finance.ts`) | **29** | default, `GatewayEvents` (processEvent, refreshCheckout), `PortalPayments` (createLink, refreshForClient, capturePayPalReturn) |

### Bytes and start-up (`pnpm --filter @techaust/admin build`, `.logs/b1-admin-build.log`; start-up = fastest of 7, start-up work included, local proxy)
| Worker | Bytes | Line / ceiling | Start-up |
|---|---|---|---|
| admin front | 111,465 | – / 150,000 | 28.6 ms |
| admin API | 489,811 | – / 800,000 | 72.2 ms |
| **admin finance** | **342,405** | 500,000 / 800,000 | 65.2 ms |
| **admin invoices** | **511,413** | 650,000 / 800,000 | 79.2 ms |
Every forbidden marker passes (`INVOICE_CODE` and `ADVANCE_CODE` absent from finance; `GATEWAY_CODE` absent from front, API and invoices). Finance is ~12–22 KB over the brief's 320–330 K estimate because it still carries the shared `FINANCE_WARM` answer book (interim, above).

### Tests (all through `tools/heavy.sh`)
- admin full suite: **4,419 passed, 1 failed** (`reports.test.ts` pinned the report rows to `finance`; changed on purpose to `invoices`), re-run of that file 21/21 (`.logs/b1-admin-test.log`, `.logs/b1-reports-test.log`). Earlier focused run of split, gateway-review, warm-routes, warm-router, warm-split, care-billing: 505 tests, 2 failures fixed (the `warmEnv` stub), re-run green.
- jobs full suite: 643 passed, 1 failed (my new dead-letter test needed a checkout row; fixed), re-run of `gateway.test.ts` + `stripe-hook.test.ts` 40/40 (`.logs/b1-jobs-test.log`, `.logs/b1-jobs-gw-test.log`).
- web script tests (worker-config, worker-budget-finance, staging-checks, prod-readiness-apps, observability-config, deploy-workflow): 176/176 (`.logs/b1-web-scripts-test.log`).
- core `gateway-rpc` + `worker-budget`: 57/57.
- `node scripts/check-worker-config.mjs`: ok. Typecheck admin, jobs, web (and core): 0 errors (`.logs/b1-typecheck-final.log`). Whole-repository `pnpm lint`: exit 0, 10 warnings and 8 infos, all in files this branch does not touch (`.logs/b1-lint.log`).
- New tests: `split.test.ts` (32/29 counts, the invoices and finance path rules both ways, four apps mount exactly their rows and together `ROUTES`, the forwarder's binding per row with the two others never called, parity through the front for every forwarded row, the invoices app called directly, each entrypoint and method list on one entry only, the 502 per Worker, the import cuts at the source); `gateway-review.test.ts` (the retry route and the advance on separate counters, each ≤ 45; "Try again" when the binding throws, answers malformed, lacks the method or is absent: the standard 500, nothing written, item still open, never `advance_changed`, and the same item issues once the hop works; `GatewayAdvance` refuses bad ids with nothing read, `lastTry` only when strictly `true`, id-only `rpc` lines); jobs `gateway.test.ts` (a throwing or malformed `ADMIN_ADVANCE` propagates on every try including the last; through `handleQueue` the last try is retried, and its dead letter writes one open `dead_letter` item and the Owner's bell; `gateway.event` no longer needs the advance); `warm-split.test.ts`; script tests for every new rule with failing cases.

### Not verified
- The full `pnpm check` and `pnpm test` (B2's final step); the full jobs and admin suites were not re-run end to end after their one-line fixes (only the affected files).
- Staging: nothing deployed (never touched). The deploy order's no-gap claim, the cold readings, and whether a missing named entrypoint fails a deploy.
- `scripts/cpu-probe.mjs`, `staging-health.mjs` (D.5), the per-Worker fixtures (D.6–D.7) and the runbooks (D.8): B2's, untouched.

### Open questions
- None blocking. For the lead: keep `warmSettings()` in finance too (deviation above)?

### Dev servers
Both stopped (admin Vite on :5273, jobs wrangler on :8887); the probe edits reverted (`git checkout`), nothing of them committed.

## Lead on B1 (2026-11-03)
Usage: builder B1 claude-opus-5-5/high (skills `cloudflare:workers-best-practices`, `cloudflare:wrangler`, `cloudflare:workers-profiling`).
- **Deviation 2 accepted:** finance keeps `warmSettings()` (it reads payment terms and gateway modes through `cachedSetting`; about 1 ms of cold parsing stays out of its first request).
- **Deviation 1:** B2 replaces the interim shared `FINANCE_WARM` with per-Worker fixtures and removes `ownCalls`.
- The task branch took `origin/main` (M6.4 squash #164) keeping its side after `git diff --quiet 1bf03b41 origin/main` proved them equal.

## Early check (analyst, 2026-11-03, e8ae93cb vs `origin/main` 335efc4c): GO
Usage: analyst claude-opus-5-5/high (skills `cloudflare:workers-best-practices`, `cloudflare:wrangler`); no tests run (relies on B1's runs).

**Verified:** routing counts front 24, API 118, invoices 32, finance 29 (`split.test.ts:196-203`); exactly the 32 brief rows move `X(` → `I(` with path, permission, audit action and body kind unchanged; `forward.ts:17-22` three-way `workerOf`/`bindingOf`, the 502 body unchanged; mount orders kept; `approvals.ts` still refuses `payment_verify`. The advance RPC never swallows a failure (`gateway/advance-rpc.ts`: binding error not caught, malformed answer `AdvanceRpcError`, `retry` → 409 only on a real answer, `routes.ts:349`; jobs `gateway-rpc.ts:59-73` throws `rpc_unavailable`/`rpc_bad_result`, `gateway.ts:79` lets the queue retry and dead-letter; tests in jobs `gateway.test.ts` and `gateway-review.test.ts:1141,1161`). The Q1 deploy order has no gap at any step. Configs: `wrangler.invoices.jsonc` with no public URL in any scope, no secrets, `PAYMENTS_LIVE_ALLOWED` "false" in all scopes, bindings matching the front per scope; finance `ADMIN_ADVANCE` (top level, staging); front `ADMIN_INVOICES` (three scopes); jobs `ADMIN_JOBS`/`ADMIN_ADVANCE` → invoices, `ADMIN_GATEWAY` → finance. Guards and the workflow (Q1 order, health checks, actions pinned by SHA, triggers unchanged) correct; budget markers (`INVOICE_CODE`, `ADVANCE_CODE` forbidden in finance; `GATEWAY_CODE` forbidden in front, API, invoices); import cuts (`invoice-consts.ts`, `anonymised.ts`, `gateway/consts.ts`; `split.test.ts:891-931`). Both B1 deviations acceptable.

**Findings:**
1. **Medium** `.github/workflows/deploy-staging.yml:153-156` says the admin health check covers four Workers incl. `/api/v1/payments` 401 from finance, but `scripts/staging-health.mjs:19-26` is unchanged. **Fix (B2, D.5):** add `{path: "/api/v1/payments", status: 401}` to `CHECKS.admin`, its comment (dashboard is invoices now) and its test.
2. **Medium** the Q2 rollback order is written nowhere and only one is safe: **admin finance first, then jobs, then the admin front; leave invoices and the API in place** (old front before old finance → invoice rows 404; old jobs before old finance → `care.bill` and `gateway.advance` dead letters). **Fix (B2, D.8):** into `docs/runbooks/environments.md` with reasons; Phase 7 note: production creates the invoices Worker before the front, finance and jobs that bind it.
3. **Low** stale comments: `apps/admin/worker/index.ts:1-3`, `api.ts:1-3`, `routes-api.ts:1-3`, `scripts/staging-health.mjs:19-20`.
4. **Low** `apps/admin/worker/gateway/advance-rpc.ts:24-28`: an absent binding/method fails as a generic TypeError. **Fix:** a shape check throwing `AdvanceRpcError("rpc_unavailable")`; the test.
5. **Low** `scripts/check-worker-config.mjs:312-318`: `PAYMENTS_LIVE_ALLOWED` checked only where set. **Fix:** required and `"false"` in every scope of the finance and invoices configs; a failing test.
6. **Low** `apps/web/test/admin-portal-origin.test.ts:55-59`: also loop over `wrangler.finance.jsonc` and `wrangler.invoices.jsonc`.
7. **Low** start-up: invoices 79.2 ms, finance 65.2 ms (local proxy) with the interim `FINANCE_WARM`; nothing warms `GatewayAdvance.issueGatewayAdvance` yet. **Fix (B2, D.6–D.7):** per-Worker fixtures incl. the `GatewayAdvance` dry run; re-measure.

**B2 must carry:** D.5 (finding 1); the rollback order (finding 2); D.6–D.7 (`cpu-probe.mjs` with the invoices Worker: `frontEnv.ADMIN_INVOICES`, `financeEnv.ADMIN_ADVANCE` → the loaded `GatewayAdvance`, a probe row `rpc GatewayAdvance.issueGatewayAdvance`; `warm-fixtures/invoices.ts` and a slimmer `finance.ts`; `ownCalls` removed from both entries and `warm-routes.test.ts`; a dry run of `GatewayAdvance` and finance's review-retry route against a warm stub `ADMIN_ADVANCE`; re-measure); D.8 (`cpu-baseline.md` with an invoices row); findings 3–6; the full `pnpm check` and `pnpm test` with numbers.

**Not verified:** a deploy with a missing named entrypoint (Step 0.6); that `CF_API_TOKEN_STAGING` can create a new Worker script (account-wide Workers Scripts permission assumed); staging behaviour.

## Lead triage of the early check (2026-11-03)
All seven findings go to **builder B2** with D.5–D.8 and the full checks. The rollback order (finding 2) completes the owner's Q2 answer: it is copied next to Q2 at the top of this file once B2 writes it into the runbook. The token's Worker-create permission is checked by the first staging deploy itself (the deploy step fails loudly; Q2 rollback allowed).
