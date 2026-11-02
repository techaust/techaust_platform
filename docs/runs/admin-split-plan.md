Status: WAITING ON OWNER (Q1, Q2); reviewer checking the brief
Tier: B (Workers; planning only, no code)
Usage: lead claude-opus-5-5/high (cloud session admin-split-plan); analyst (measure + options) claude-opus-5-5/high, skills asked for `cloudflare:workers-best-practices`, `cloudflare:wrangler`, `cloudflare:workers-profiling` (each "Unknown skill": Cloudflare skills don't load in cloud sessions; no other skill fits a split plan): 5-h 5 % at start (23:12 IST). reviewer (brief) claude-opus-5-5/high started 23:48 IST at 5-h 5 % (reading). Readings: USAGE 5 at 2026-11-02T23:40+05:30.

# Run: the fourth admin Worker (split the admin finance Worker before M6.5), build brief

Session: `admin-split-plan` (cloud). Branch: `docs/admin-split-plan` (from `main` e765e2f). Copy file: none (the split adds no user-facing wording). **Planning only:** this file is the only file the run changes; no code, configs or migrations.

**Why:** L28/L32 of 2026-11-02 in `docs/runs/m6.4-paypal.md` (on `origin/feat/m6.4-paypal`). On the M6.4 branch the admin finance Worker is at 701,805 of 800,000 bytes, past the 650,000 plan line (CLAUDE.md "Worker budget": "a fourth admin Worker is planned when finance passes the 650,000 planBytes line"). M6.5 (refunds, receipts, reconciliation) adds about 40 KB more to finance, and M7.3 adds about 15 KB. The owner chose this planning run on 2026-11-02. **The split is built after M6.4 merges and before M6.5 starts.**

## Questions for the owner
Status: open (the main session brings them as one batch).

**Q1. Deploying the new admin Worker to staging.** This changes `.github/workflows/deploy-staging.yml`, which needs your yes.
The finance Worker is too big for what M6.5 and M7 will add, so the invoice, report and dashboard routes move into a fourth admin Worker, "admin invoices". Payments, the gateways and their keys stay where they are. Staging needs one more deploy step for the new Worker.
- **A (Recommended):** add one step, "Deploy 2 of 7, the admin invoices Worker (staging)", right after the admin API and before the admin finance Worker. The admin health check also proves the new Worker answers. Steps after it are renumbered "N of 7". Nothing else in the workflow changes: it stays fork-safe, with actions pinned by SHA.
- B: no new step. The PR waits, and M6.5 can't start; finance would cross its 800,000 ceiling during M6.5 or M7.

**Q2. Rolling back the first staging deploy.** On the first deploy of the split, invoice pages can show "not found" for a minute or two between two deploy steps (staging only, as with the third Worker in M6.1).
- **A (Recommended):** if the new set misbehaves on staging, the lead may roll the staging admin front and admin finance Workers back to their previous versions straight away and tell you afterwards. This is the same rule you gave for M5.0 (2026-10-27), and it applies to staging only.
- B: the lead asks you before any rollback.

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
1. `gateway/advance.ts` (`issueGatewayAdvance`, `mutateSystem` batch: the issue, the receipt, the allocation and the deed) reads only `DB` and `PDF_QUEUE` and makes no gateway call; its imports are the invoice chain (`invoice-model.ts`, `invoices.ts`, `quote-model.ts`, `care-billing.ts`, `@techaust/db/issue`). It moves whole to invoices. Callers:
   - jobs `gateway.advance` through `GatewayEvents.issueGatewayAdvance`; finance's `events.ts` and `settle.ts` hand it over through the queue, never synchronously;
   - the Owner's `POST /payments/review/:id/retry` (`gateway/routes.ts:345`), synchronously. Its follow-up resolve (`routes.ts:349-362`) is already a separate batch and stays in finance.
2. `invoice-advance.ts` ("Confirm by issuing": issue, payment confirm, allocation, recompute, deed) has no gateway import and goes whole to invoices.
3. The gateway settle batches (`settle.ts`, `stripe-settle.ts`, `paypal-capture.ts`) issue nothing; they stay in finance with the keys.
4. `payments.ts` and `payment-ledger.ts` batches are ledger only (proforma money is refused with `use_advance_invoice`); they stay in finance.
5. Note issue (`invoice-issue.ts`) and the care auto-issue go to invoices. They use the pure SQL builders `@techaust/db/ledger` and `@techaust/db/deeds`, which both bundles carry.
6. M6.5 refunds (batch 1 release + recompute, the provider call with the keys, batch 2) are all finance. A needed credit note is an earlier, separate Owner step in invoices (409 `credit_note_needed`).

## Brief
_Final, by the lead, from the analyst's draft (2026-11-02). Reviewed: see "Review"._

**PRD:** ADM-G-02 (the admin API behind service bindings; as M5.0), ADM-PAY-01 (payments, as M6.1 stage A). **No change in behaviour:** every route keeps its path, method, permission, audit action, body kind, answers and errors. Every RPC method keeps its name, arguments and answers.
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
1. **Re-measure** finance, API and front with `pnpm --filter @techaust/admin build`, and record the bytes. If finance on `main` differs from 701,805 by more than 15 KB (M6.4's fix round B3 adds the L31 RPC dry runs), re-read the row lists below against `guard.ts`.
2. **Row list.** List every `X(...)` row in `apps/admin/worker/guard.ts` (61 on 3f19098) and classify each by the rule in A.2. Any row not covered by the rule: stop and ask the lead.
3. **The import cut still holds:** `apps/admin/worker/payment-ledger.ts` imports `INVOICE_VOID` from `invoice-model.ts` (line 52 on 3f19098). Find any other import from a payments-side module (`payments.ts`, `payment-ledger.ts`, `advices.ts`, `gateway/**` except `advance.ts`) into the invoice chain (`invoice-*.ts`, `note-*.ts`, `quote-model.ts`, `invoices.ts`, `care-billing.ts`, `documents.ts`, `document-*.ts`). Each one is either cut (moved into a side-effect-free constants module) or reported.
4. **Local service binding between two auxiliary Workers with a named entrypoint.** Finance (auxiliary) binds invoices (auxiliary) with `entrypoint: "GatewayAdvance"`. Prove it works under `@cloudflare/vite-plugin` 1.62.5 in `pnpm dev`, and that vitest's in-process route set can stand in for it (F). If the dev server can't connect it, report it before going on; the fallback is the lead's call (see Risks 2).
5. **Env typing:** find how the front's generated `Env` (`wrangler types --env staging` on `wrangler.jsonc`) covers the finance-only bindings today (`LEADS_QUEUE`, the gateway secrets read with `envText`), and give `ADMIN_INVOICES` and `ADMIN_ADVANCE` the same treatment. No hand-written `Env` interface (CLAUDE.md "Workers").
6. **Deploy with a missing bound Worker:** confirm from wrangler's docs or source that `wrangler deploy` of a Worker whose service binding names a Worker that doesn't exist fails. That fact sets the deploy order (C.6).

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
6. **The import cut:** move `INVOICE_VOID` (and anything else Step 0.3 finds) into `apps/admin/worker/invoice-consts.ts`, which has no top-level side effects. `invoice-model.ts` re-exports it, so its importers don't change. The analyst's exact build shows this alone removes about 108 KB (`start-project-plan` → `document-convert` → `documents`, `care`, `quote-model`, the tax engine) from finance.
7. **Warm-up modules:**
   - split `warm-finance.ts` into `warm-invoices.ts` (the invoice, note, approval decision, settings and report schemas) and `warm-finance.ts` (payments, advices, the gateway schemas, `gateway/warm.ts`);
   - each keeps returning a count that a test pins;
   - nothing moves between them except by this rule.
8. **`invoicing.ts`** (new entry), modelled on `finance.ts`:
   - `createApp(mountInvoices)`; `warmRouter(app, ROUTES.filter(r => r.on === "invoices"))`; `warmAtStartup(() => createApp(mountInvoices, undefined, { warm: true }), INVOICES_WARM)`;
   - exports `default`, **`BillingJobs` moved word for word** from `finance.ts` (with its `id()` guard and `rpcLog`), and **`GatewayAdvance`** (B);
   - no named export that isn't an entrypoint (a named export of an entry is read as an entrypoint).
9. **`finance.ts`** loses `BillingJobs` and the invoice imports. `GatewayEvents.issueGatewayAdvance` stays as the jobs contract and forwards through `ADMIN_ADVANCE` (B). `GatewayEvents` and `PortalPayments` keep exactly their method lists, which `split.test.ts` pins.

### B. The advance RPC (B1; the only new synchronous cross-Worker call)
1. **`@techaust/core/gateway-rpc`:** a `GatewayAdvanceApi` with one method, `issueGatewayAdvance({paymentId, lastTry?}): Promise<IssueAdvanceResult>`, and a runtime answer guard `isIssueAdvanceResult` (result codes and the `blockers` array shape; anything else is refused).
2. **`invoicing.ts` `GatewayAdvance extends WorkerEntrypoint<Env>`:**
   - exactly that one public method;
   - `rpcId` check on `paymentId` (1–64 characters); `lastTry` taken only when strictly `true`;
   - calls `issueGatewayAdvance(this.env, paymentId, { lastTry })` from `gateway/advance.ts`, which now lives in the invoices bundle only;
   - one id-only `ev:"rpc"` line with `f` (as `rpcLog`).
3. **`apps/admin/worker/gateway/advance-rpc.ts`** (new, finance side): `advanceViaRpc(env, paymentId, opts)` calls `env.ADMIN_ADVANCE.issueGatewayAdvance(...)` and checks the answer with `isIssueAdvanceResult`.
   - **A thrown binding error or a malformed answer is `{ result: "retry" }`**, which is today's answer for a changed proforma. The job retries; the Owner's route answers 409 `ADVANCE_CHANGED`. It never counts as issued, and never resolves a review item.
   - No body, name or amount in a log line.
4. **Callers in finance:**
   - `GatewayEvents.issueGatewayAdvance` → `advanceViaRpc`;
   - `gateway/routes.ts:345` (review retry) → `advanceViaRpc`. Its follow-up `already_issued` resolve stays a separate finance batch, as today.
   - **`finance.ts` and `gateway/**` other than `advance.ts` must no longer import `advance.ts`** (the budget marker in D.1 proves it).
5. **Jobs:** no code change. `ADMIN_GATEWAY` still names finance's `GatewayEvents`. `ADMIN_JOBS` is re-pointed to invoices' `BillingJobs` (C.4); `apps/jobs/src/billing-rpc.ts` changes its comment only.
6. **Idempotency is unchanged:** `issueGatewayAdvance` is already one try per invocation, guarded in SQL (the payment's receipt, the proforma's `updated_at`). A finance retry after a lost RPC answer can only get `already_issued`.

### C. Config (B1)
1. **`apps/admin/wrangler.invoices.jsonc`** (new; a copy of `wrangler.finance.jsonc` minus what invoices doesn't need):
   - `main: "worker/invoicing.ts"`; `workers_dev: false` and `preview_urls: false` **in every scope** (top, staging, production); no routes, no assets, no custom domains;
   - **no `secrets`** (the invoice chain holds none);
   - top-level and staging: the front's `DB` (same `database_name`/`database_id` per scope); R2 `FILES` and `DOCS`; queue producers `EMAIL_QUEUE` and `PDF_QUEUE`; **no `LEADS_QUEUE`** and no `services`;
   - vars `ENVIRONMENT`, `PAYMENTS_LIVE_ALLOWED: "false"`, `LEAD_PURGE_MODE`, plus any var the moved code reads (Step 0: grep `c.env.`/`env.` in the moved modules; for example `PORTAL_URL`, if an invoice email or link builder reads it);
   - observability as finance per scope (staging traces `head_sampling_rate: 0.1`, logs and invocation logs on; production invocation logs off);
   - production: name and vars only (no bindings until Phase 7, as finance).
2. **`apps/admin/wrangler.finance.jsonc`:** add `services: [{ binding: "ADMIN_ADVANCE", service: "techaust-platform-admin-invoices", entrypoint: "GatewayAdvance" }]` at the top level, and the `-staging` target under `env.staging`. Production: as for finance's other bindings, none until Phase 7. Keep the five gateway secrets, the three queue producers and the vars. Update the header comment.
3. **`apps/admin/wrangler.jsonc` (front):** `ADMIN_INVOICES` → `techaust-platform-admin-invoices` in all three scopes (staging `-staging`), as `ADMIN_FINANCE` is. Bindings aren't inherited between scopes.
4. **`apps/jobs/wrangler.jsonc`:** `ADMIN_JOBS` → `techaust-platform-admin-invoices` / `BillingJobs` (top level) and `techaust-platform-admin-invoices-staging` (staging); production still has none. `ADMIN_GATEWAY` unchanged. Update the deploy-order comment.
5. **`apps/portal/wrangler.jsonc`:** no change (`ADMIN_PAY` → finance `PortalPayments`).
6. **Deploy order (Q1):** admin API → **admin invoices** → admin finance → admin front → portal → jobs → web. Each Worker is deployed before any Worker that binds it: finance binds invoices, the front binds all three, jobs binds invoices and finance, and the portal binds finance.
   - **First deploy only:** between the finance and front steps (about 1–2 minutes), the old front forwards invoice rows to the new finance, which answers 404 (deny by default). Jobs' `care.bill` calls fail until jobs deploys (retried, idempotent). This is the same window as M6.1. Q2 covers a rollback.
7. **`apps/admin/vite.config.ts`:** `auxiliaryWorkers: [api, finance, invoices]`; `techaust_platform_admin_invoices: { build: { minify: true } }`.
8. **`apps/admin/vitest.config.ts`:** a stub `ADMIN_INVOICES` service binding (502, like the others). The advance RPC in tests: see F.3.
9. **`apps/admin/package.json`:**
   - `build` adds `node ../../scripts/worker-budget.mjs adminInvoices`;
   - `deploy:staging:invoices` = `node ../../scripts/check-staging-build.mjs admin-invoices && wrangler deploy --config dist/techaust_platform_admin_invoices/wrangler.json`.
10. **`.env.example`, `.dev.vars.example`, `tools/set-gateway-keys.ps1`, `docs/runbooks/payment-gateways.md`, `scripts/dev-ports.mjs`:** no change. No new secret, and the new Worker runs inside the admin Vite process (one inspector port). Step 0.4 may change the last.

### D. Scripts (B1 for D.1–D.4; B2 for the rest)
1. **`scripts/worker-budget.mjs`:**
   - **new `adminInvoices`:** file `apps/admin/dist/techaust_platform_admin_invoices/index.js`; `maxBytes` 800,000; `planBytes` 650,000; `maxStartupMs` 200; forbidden `CLASSIC_ZOD`, `PDF_LIB`, `PUPPETEER`, `PDF_FONTS`, `SIGN_IN_TABLES`, `GST_CORE`, `GATEWAY_CODE`;
   - **new marker `GATEWAY_CODE`** (string contents that survive minification and exist only in gateway code, e.g. `/api\.razorpay\.com|api\.stripe\.com|api-m(?:\.sandbox)?\.paypal\.com/`; pick from the bundle, and test that the marker matches today's finance bundle). Add it to `admin`, `adminApi` and `adminInvoices`;
   - **`adminFinance`:** add `INVOICE_CODE` to its forbidden list; `planBytes` 500,000 (lead decision L4); ceiling 800,000 kept;
   - **an `ADVANCE_CODE` marker** (a string only `gateway/advance.ts` holds) forbidden in `adminFinance`, so the advance never comes back into finance;
   - update the comments (the fourth Worker, M-date).
2. **`scripts/check-worker-config.mjs`:**
   - `wrangler.invoices.jsonc` joins the auxiliary admin configs: no public URL in any scope; bindings in step with the front per scope (D1, R2, `EMAIL_QUEUE`, `PDF_QUEUE`); **no `secrets`** and no `LEADS_QUEUE` (as the API); `PAYMENTS_LIVE_ALLOWED` `"false"` in every scope; the staging observability rule;
   - the front: three service bindings (`ADMIN_API`, `ADMIN_FINANCE`, `ADMIN_INVOICES`) with the right targets per scope;
   - finance: `ADMIN_ADVANCE` → invoices / `GatewayAdvance` per scope, and **finance is the only config with gateway secrets** (existing `FINANCE_OPTS`; unchanged);
   - jobs: `ADMIN_JOBS` must target the invoices Worker (`BillingJobs`), `ADMIN_GATEWAY` the finance Worker (`GatewayEvents`); the portal's `ADMIN_PAY` the finance Worker;
   - tests for each new rule in the existing test file, failure cases included.
3. **`scripts/check-staging-build.mjs`:** a target `admin-invoices` (`dist/techaust_platform_admin_invoices/wrangler.json` names `techaust-platform-admin-invoices-staging`; a plain build names the production Worker and fails).
4. **`scripts/check-prod-readiness.mjs`:** add the new config to its production config list (`PROD_CONFIGS` or its equivalent), with the same checks as finance.
5. **`scripts/staging-health.mjs` `CHECKS.admin`:**
   - `/api/v1/health` 200 (front);
   - `/api/v1/leads` 401 (API);
   - `/api/v1/dashboard` 401 (now **invoices**);
   - **+ `/api/v1/payments` 401 (finance)**, never a 502.

   Update its test and the comment ("four Workers").
6. **`scripts/cpu-probe.mjs`:** an `invoices` Worker. The hot routes are reassigned as the rows are: issue, `GET /invoices/:id`, `PATCH`, advance-invoice, the dashboard, `/invoices` and `/approvals` → invoices; `/invoices/:id/payments`, `/payments/review` and the RPC dry runs stay finance. `--write-fixtures` writes `warm-fixtures/invoices.ts` and slims `warm-fixtures/finance.ts`.
7. **Start-up dry run:** `INVOICES_WARM` and a slimmer `FINANCE_WARM`, regenerated with `node scripts/cpu-probe.mjs --write-fixtures` after building admin and jobs (runbook `cpu-baseline.md`). The dry runs:
   - invoices' covers `BillingJobs` and **`GatewayAdvance.issueGatewayAdvance`**, with made-up fixtures in the L31 pattern;
   - finance's keeps the gateway RPC dry runs (M6.4 L31) and runs `GatewayEvents.issueGatewayAdvance` against a **warm stub `ADMIN_ADVANCE`** that answers a made-up `IssueAdvanceResult` and never calls out.

   `.gitleaks.toml` already allows the folder. `warm-routes.test.ts` and the fixtures test are updated.
8. **Runbooks:**
   - `docs/runbooks/environments.md`: the fourth admin Worker, its bindings and the deploy order;
   - `docs/runbooks/cpu-baseline.md`: an invoices row, and the dashboard and invoice rows moved under it.

   CLAUDE.md, 12 and 13 belong to the main session (see "Proposed CLAUDE.md text").

### E. The workflow (B2, **only after the owner's yes to Q1**)
`.github/workflows/deploy-staging.yml`:
- one new step "Deploy 2 of 7, the admin invoices Worker (staging)" (`pnpm --filter @techaust/admin run deploy:staging:invoices`), with the same env and token handling as the finance step;
- the other steps renumbered "N of 7";
- the admin health step's name says four Workers;
- the order comment updated.

Nothing else changes: no new secret, no new permission, actions pinned by SHA, fork-safe.

### F. Tests
1. **`apps/admin/worker/split.test.ts`:**
   - ownership both ways for the three-way split: every `on: "invoices"` row is answered by the invoices app and 404 in the finance and API apps, and the same for finance and API rows;
   - the forwarder picks `ADMIN_INVOICES` for every invoices row (and only those);
   - parity: the union of the four route sets equals `ROUTES`;
   - entrypoints: `BillingJobs` and `GatewayAdvance` exported by `invoicing.ts` only, with exactly their method lists; `GatewayEvents` and `PortalPayments` by `finance.ts` only; no other named exports on any entry.
2. **`test-app.ts`:** mounts all four route sets in process (every route available, as today).
3. **The advance across the hop:**
   - the tests that run the review retry route or `GatewayEvents.issueGatewayAdvance` get an in-process `ADMIN_ADVANCE` that calls the real `issueGatewayAdvance` with the passed (counting) env (`test-gateway.ts`). This covers `gateway-review.test.ts` (≤ 45 statements), `gateway.test.ts` (the advance cases) and the race injections;
   - assert ≤ 45 D1 statements per invocation on each side;
   - **new failure cases:** the binding throws → `retry`, nothing written in finance, the review item stays open, the route answers 409 `ADVANCE_CHANGED`; a malformed answer → `retry`; `GatewayAdvance` refuses a bad id (TypeError, nothing written); `lastTry` other than `true` is ignored.
4. **Budget and config guards:** `packages/core/test/worker-budget.test.ts` (the new budget and the `GATEWAY_CODE`/`ADVANCE_CODE` markers, each matching today's finance bundle text and not the others); `check-worker-config` tests (every new rule, with a failing case each); `check-staging-build` and `staging-health` tests.
5. **`warm-routes.test.ts` and the fixtures test** fail when a hot route of either Worker changes (as today), now per Worker.
6. **No test calls a gateway** (stubbed `fetch`, as today). The full `pnpm test` and `pnpm check` must be green. Any test that moved Worker keeps its assertions word for word.

### G. Free plan, bytes and CPU
- **Bytes after the split (exact, on M6.4):** finance about 309,347 (plus the L31 dry runs, about 320–330 K); invoices about 511,770; API and front unchanged. Record the real numbers from the build in the builder report.
- **Start-up** ≤ 200 ms each, the fastest of 7. Measured on the exact bundles without fixtures: finance 32 ms, invoices 51 ms; expect about 40–55 ms each with the dry runs.
- **Per request:** every admin request still crosses exactly two Workers (front → one answering Worker). The new RPC paths (the Owner's review retry, jobs' `gateway.advance`) add one invocation each, each with its own 10 ms meter; the finance side is a one-object structured-clone forward.
- **First-call targets** as M6.4 L31: `GatewayAdvance.issueGatewayAdvance` ≤ 7 ms first run on staging (local proxy ≤ 2.5 ms); `f:1` on the new `ev:"rpc"` and `ev:"fwd"` lines.
- **No `import()`.** Schemas at module top level. One unit of work per queue message (unchanged).
- **The staging cold reading** of all four admin Workers goes in `docs/runbooks/cpu-baseline.md` after the deploy (lead).

### H. Done means
- Every row in the right Worker: `split.test.ts` green, and the budget markers prove that no invoice code is in finance and no gateway code is in invoices, the API or the front.
- `pnpm check` and `pnpm test` green on the branch tip (numbers stated); the admin build prints all four budgets under their plan lines.
- The configs pass `check-worker-config.mjs`, with no public URL for the new Worker in any scope.
- The early check is GO, the reviewer APPROVEs, and every finding is fixed or kept with a reason.
- After the merge, staging deploys in seven steps, the admin health check passes (four Workers), and a staging walk-through works: an invoice list and detail, a draft and issue, the dashboard, a report page, Payments and "Needs review", and a sandbox payment link opening. The owner approves on staging.

### I. Out of scope
- Any change in behaviour, copy, screens, migrations, secrets or the gateway code itself.
- Moving the gateway keys. Renaming the finance Worker (that would move all five secrets).
- Production bindings (Phase 7).
- M6.5's own work; its brief is amended by the main session (Follow-ups).

### J. Risks
1. **A forgotten row mark** is a deny-by-default 404 in the wrong Worker. Mitigated by `split.test.ts` ownership and parity, and by the Step 0.2 classification.
2. **The local auxiliary-to-auxiliary entrypoint binding** (finance → invoices) is unproven under the Vite plugin and vitest (Step 0.4). If dev can't connect it, the lead decides between:
   - (i) tests and staging only, with dev showing the 409 `ADVANCE_CHANGED` on that one Owner action (the jobs path is already a cross-process binding locally, a known M6.2 follow-up);
   - (ii) the retry route enqueues `gateway.advance` and answers "queued" (a behaviour and copy change, so an owner question).
3. **An undone import cut** brings the invoice chain back into finance (about 108 KB). Mitigated by `INVOICE_CODE` and `ADVANCE_CODE` in `adminFinance.forbidden`.
4. **Hono mount order in finance:** the gateway and advice routers must stay before `payments` (`/:id`).
5. **M6.4's fix round** (B3: `finance.ts`, `warm-routes.ts`, `cpu-probe.mjs`, the fixtures) must be merged first. That is why the split starts from `main` after M6.4. No migrations, so there's no migration-order issue.
6. **First deploy window** (C.6): about 1–2 minutes of invoice-row 404s and retried `care.bill` calls on staging only (Q2).

## Review
(pending: one reviewer checks this brief against the code on `main` and `origin/feat/m6.4-paypal`)

## Lead decisions (for 13)
- **L1 (Lead, 2026-11-02):** the fourth admin Worker is **`techaust-platform-admin-invoices`** (cut B1). It holds invoices and notes, issue, approvals, reports, statements, the dashboard and `BillingJobs`. The admin finance Worker keeps payments, the ledger, credit, advices, the gateways, their five keys and the `GatewayEvents`/`PortalPayments` entrypoints.
  - Reasons: both Workers keep 120 KB or more under their lines through M7.3, no secret moves (the Razorpay and Stripe test secrets are shown once), the portal and jobs code are untouched, and no D1 batch spans two Workers.
  - Rejected: a gateway-only Worker (finance only ~50–60 KB under the line after M7.3, and all five secrets move); moving reports or care billing alone (finance stays over 650,000).
- **L2:** the gateway advance runs in the invoices Worker behind a new entrypoint `GatewayAdvance`, reached from finance through `ADMIN_ADVANCE`. Jobs keeps calling `GatewayEvents.issueGatewayAdvance` (its contract unchanged), which forwards. A binding failure or a malformed answer is `retry`, never "issued".
  - Kept over a second jobs binding straight to invoices: it leaves the jobs code and the RPC surface unchanged. The extra hop costs a short invocation of its own on a rare path.
- **L3:** one import cut (`INVOICE_VOID` into `invoice-consts.ts`) plus `INVOICE_CODE`/`ADVANCE_CODE` forbidden in finance and a `GATEWAY_CODE` marker forbidden in the front, API and invoices.
- **L4:** budgets: `adminInvoices` ceiling 800,000, plan line 650,000; `adminFinance` plan line lowered to 500,000 (estimated ~380 K at the end of M7), ceiling 800,000 kept. Start-up ≤ 200 ms each.
- **L5:** deploy order admin API → admin invoices → admin finance → admin front → portal → jobs → web (Q1). Health: `/payments` 401 added for finance; `/dashboard` 401 now proves invoices.
- **L6:** Tier B, with an analyst early check after the routing, config and RPC layer (a money path's hop), as M6.1 stage A.

## Proposed CLAUDE.md text
_For the main session after the split merges (replaces "The admin API is three Workers (M5.0; the third in M6.1)")._

> **The admin API is four Workers (M5.0; the third in M6.1; the fourth before M6.5):** the front (`worker/index.ts`, `wrangler.jsonc`) serves the SPA plus the `ROUTES` rows marked `on: "front"` (health, `/auth/*`, `/users/*`) and forwards every other row untouched (`forward.ts`, before any middleware):
> - rows marked `on: "invoices"` with `ADMIN_INVOICES.fetch(c.req.raw)` to `techaust-platform-admin-invoices` (`worker/invoicing.ts`, `wrangler.invoices.jsonc`, `routes-invoices.ts`, row helper `I`: invoices and notes, a client's invoices and statement, reports, the approval queue and decision, the dashboard). It also exports `BillingJobs` (jobs, `ADMIN_JOBS`) and `GatewayAdvance` (the automatic tax invoice of a proforma paid online; finance, `ADMIN_ADVANCE`);
> - rows marked `on: "finance"` with `ADMIN_FINANCE.fetch` to `techaust-platform-admin-finance` (`worker/finance.ts`, `wrangler.finance.jsonc`, `routes-finance.ts`, row helper `X`: payments, TDS, credit, advices, payment links, "Needs review", the gateways). It holds the gateway test keys and exports `GatewayEvents` (jobs, `ADMIN_GATEWAY`) and `PortalPayments` (portal, `ADMIN_PAY`);
> - every other row with `ADMIN_API.fetch` to `techaust-platform-admin-api`.
>
> The API, finance and invoices Workers are Vite auxiliary Workers with no public URL in any scope. All four build from `createApp` in `app.ts`, re-run CSRF and the guard from the cookie, and hold no secrets except finance's gateway keys. New admin routes go in `routes-api.ts`, `routes-invoices.ts` (documents of the invoice family, reports, statements) or `routes-finance.ts` (money in and out, gateways). The budget markers keep the invoice chain out of finance and the API, and gateway code out of the others.

Also in "Worker budget": "admin invoices 800,000 (plan line 650,000), admin finance 800,000 (plan line 500,000)". In "Staging deploys build first, then deploy": "seven deploys in order: admin API, admin invoices, admin finance, admin front, portal, jobs, web (`deploy:staging:invoices`)". In "Razorpay (M6.2)": the automatic invoice "under the issuing Owner's `gateway_auto` authority" runs in the invoices Worker through `GatewayAdvance`.

## Follow-ups (for 12)
- **The M6.5 brief needs amending before M6.5 starts (main session):**
  - §B/§C/§D put `issueReceipt`, `checkRefund` and `fetchSettlements` on `BillingJobs`. After the split they belong on finance's **`GatewayEvents`**, because they need the keys or are payment-side and `BillingJobs` lives in invoices. Jobs routes `receipt.issue`, `refund.check` and the settlement fetch to `ADMIN_GATEWAY`.
  - §F line "all five Workers" becomes six configs for `PAYMENTS_LIVE_ALLOWED`.
  - Any M6.5 credit-note-with-refund route goes to invoices, its refund leg to finance.
- **M7.3 brief:** C1–C6, C9 (revenue, ageing, dashboard v2) and J's `warmReports` go to the invoices Worker (`warm-invoices.ts`), not finance. **M7.1:** `/payments/notices` stays finance.
- **Not verified in planning:** start-up with the real fixtures; the B3, M6.5 and M7 growth (brief estimates); the local auxiliary-to-auxiliary entrypoint binding (Step 0.4); whether wrangler refuses a deploy whose bound Worker is missing (Step 0.6); whether service-binding and RPC calls count against the Free plan's daily request limit (each counts as an invocation; checked at the staging reading).

## Handover
Brief written from the analyst's draft and checked by the lead against the M6.4 branch (the import cut, the advance's callers, the row count). Next: the reviewer checks the brief against the code; then the owner's Q1 and Q2 go to the main session; then the PR.
