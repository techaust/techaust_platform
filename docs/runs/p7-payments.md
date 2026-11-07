# P7 payments: test-payment separation between environments, and live-payment readiness

Status: brief written (lead, 2026-11-07 evening); builder next.
Tier: A (payments). Branch: `feat/p7-payments` (from `origin/main` at the time of writing; PR #193 merges first, then this branch takes `main` in).

## Why
- **The owner's decisions (13, 2026-11-07):** production launches on 2026-11-08 once every pre-launch item has passed review. Payments stay on TEST keys (`PAYMENTS_LIVE_ALLOWED` "false") until the owner's explicit go-live later. The live-payment code is built NOW, so that going live later only means setting keys and flipping the flag.
- **Test payments would otherwise cross between staging and production** (the analyst's Phase 7 finding 5, [phase7-production](phase7-production.md)). Staging and production share one sandbox account per gateway, and the webhooks of both environments receive every event.
  - Razorpay's `settlePayment` turns an event for a link this database doesn't know into an `unknown_link` "Needs review" item.
  - PayPal (`paypal-capture.ts`) does the same whenever the checkout id is a UUIDv7, which staging's are too.
  - Stripe already filters on `metadata.techaust_env` (`packages/core/src/stripe.ts`, `apps/admin/worker/gateway/stripe-settle.ts`, L5).

## Do
1. **Environment marks** for Razorpay and PayPal, mirroring Stripe's `techaust_env`:
   - **Razorpay:** `notes.techaust_env = <ENVIRONMENT>` when a payment link is created (`apps/admin/worker/gateway/links.ts` and the core Razorpay builders).
   - **PayPal:** the order's purchase unit carries the environment (`custom_id`, or the field the code already uses for our checkout id, extended without breaking the existing parsing).
   - **On every webhook or refetch**, an event whose mark names ANOTHER environment is quietly ignored, as Stripe's are: no ledger write, no "Needs review" item, no bell. Log one line without personal data, and record the webhook event with a result such as `ignored_other_env` (read how `webhook_events` records results first).
   - **An event with no mark** (links created before this change) keeps today's behaviour.
   - Tests for each gateway: same environment → processed; other environment → ignored; no mark → today's path.
2. **Live readiness**, from [phase7-production](phase7-production.md) A2.1–A2.3 and A2.5. Read each current behaviour first and keep everything test-only while `PAYMENTS_LIVE_ALLOWED` is "false".
   - **A2.1 PayPal:** the accepted cert hosts and the API and checkout hosts follow the Settings mode: live hosts only in live mode, sandbox hosts only in test mode (`packages/core/src/paypal.ts` ~798–808; `apps/admin/worker/gateway/paypal.ts` ~481, ~532). Check whether `www.sandbox.paypal.com` in those lines is stub-only or real.
   - **A2.2 Stripe:** the hook's and the judge's `livemode` expectation follows the Settings mode, not only the flag (`apps/jobs/src/hooks/stripe.ts` ~121, `gateway/routes.ts` ~94). A test-mode event in live mode, or the reverse, is refused or held for review; it never reaches the ledger.
   - **A2.3:** a gateway left in live mode falls back to test behaviour, with an Owner bell, as soon as `PAYMENTS_LIVE_ALLOWED` is "false" (M3.1 follow-up).
   - **A2.5:** the "Before going live" text on Settings › Gateways. This is a staff-only line, drafted by you under the lead's delegation and marked for the lead in this run file. It lists what must be true before switching a gateway to live: live keys set, webhooks pointed at `https://hooks.techaust.com/<gateway>` with live secrets, and `PAYMENTS_LIVE_ALLOWED` set to "true" by the owner.
   - **Never** set `PAYMENTS_LIVE_ALLOWED` to "true" anywhere. The guards stay as they are.
3. **Refunds:** `refund-gw.ts` and `refund-events.ts` follow the same environment-mark rule for refund events from Razorpay and PayPal, if their payloads carry the payment's notes. Read first; if the payload doesn't carry the mark, refetch and read it, or keep today's path and say so.

**Files:**
- `apps/admin/worker/gateway/*`;
- `packages/core/src/{razorpay,paypal,stripe,gateway-rpc,online-pay}.ts` as needed;
- `apps/jobs/src/hooks/*`;
- `packages/db/src/gateway.ts` and `webhook_events` handling;
- tests.
- No migration is expected. If one is truly needed (for example a new enumerated result held by a trigger), stop and report: another branch is adding migrations in parallel and the lead plans the numbering.

**Not your files** (others are editing them in parallel):
- the statement code (core `statement.ts`, `apps/admin/worker/statements.ts`, `apps/jobs/src/statement-pdf.ts`, the statement layout and the portal statement view);
- `apps/jobs/src/pdf.ts` and the admin PDF routes;
- the workflows;
- the settings and LUT code (`packages/core/src/schemas/settings.ts`, `apps/admin/worker/settings.ts`).

The Settings › Gateways screen is yours only for the A2.5 text; if it lives in the shared settings files, stop and ask.

**Order:** builder (stops after core, SQL and routes for the analyst's early check) → the analyst's early check → the reviewer → fixes → re-check. There are no new screens, except the A2.5 line, which the builder adds as text.

**Done when:**
- the admin worker tests, the jobs, core and db suites, and `pnpm check` are green;
- the finance, invoices and jobs Worker bytes are under their ceilings and plan lines;
- your report is appended here ("## Builder report"), with the tests and their counts;
- the branch `fix/p7-payments-b1` is pushed.

## Builder report (early-check stop)

Builder `fix/p7-payments-b1` (Opus 5.5, high), 2026-11-07. Tier A: I stopped after core, SQL, the hooks and the finance routes, with their tests, for the analyst's early check.

**Not done yet:**
- the A2.5 "Before going live" line on Settings › Gateways (a text on an existing screen), added after the verdict;
- the full `pnpm lint` and `pnpm check` (the final step).

**Skills loaded:**
- `cloudflare:workers-best-practices`: what it changed:
  - no unbounded body reads (the existing capped reads only);
  - no module-level request state (the only new module state is a per-isolate memo of the bell's settings versions);
  - `ENVIRONMENT` read with `Reflect.get`, never a hand-written `Env`.
- `cloudflare:wrangler`: no config change was needed; types regenerated by `typecheck`.
- Not loaded: `cloudflare:workers-profiling`. The CPU added is one regex and one compare per event; bytes and start-up come from the budget script below.

### What was built

**1. Environment marks (finding 5).**
- **Razorpay:**
  - `linkRequestOf` takes `env` and sends `notes.techaust_env`; anything but 1 to 16 lower-case letters is refused as `env_invalid`.
  - `readRazorpayLink` and `parseRazorpayEvent` read `envMark`.
  - `razorpayEnvMarkOf(obj)` reads the link's notes, else the payment's.
- **PayPal:**
  - `custom_id` is `<checkout id>-<env>` (`payPalCustomIdOf`); `reference_id` stays the bare checkout id.
  - Every reader splits the suffix off again (`readPayPalMark`). So `customId` downstream is still the checkout id, every existing comparison is unchanged, and `envMark` is a new field.
  - `payPalEventOwnership(e, env)` answers `other_env` first; `payPalEventFacts` keeps `env`.
  - The local simulator now reads the checkout id from `reference_id`.
- **Shared:**
  - core `payments.ts` adds `ENV_MARK`, `isEnvMark` and `envMarkVerdict(mark, env)`, which answers `same`, `other` or `unmarked`;
  - a Worker with no `ENVIRONMENT` treats any marked event as `other`.
- **Hooks (jobs):**
  - Razorpay and PayPal store another environment's event once, as `ignored` with outcome `other_env` (`WEBHOOK_EVENT_IGNORED_SQL`, `processed_at` = arrival).
  - Its facts are `{event, env}` only. It is never queued, and logs one line, `hook.other_env`, with no id.
  - The 0064 triggers already allow an `ignored` insert and a free-text `outcome`: **no migration**.
  - Stripe keeps its M6.3 L5 behaviour (no D1 write for `other_env`), unchanged.
- **Finance:**
  - `settlePayment` and the expired/cancelled branch check the RE-FETCHED link's mark before any lookup (`ignoredAsOtherEnv`). The event goes to `ignored`/`other_env`: no review item, no bell, no payment fetch.
  - `processPayPalEvent` refuses a stored event whose facts name another environment (defence in depth).
  - Unmarked events keep today's path everywhere.
- **Refunds (item 3):** today's path is kept, because the code already ends another environment's refund event quietly:
  - **Razorpay and Stripe:** `processRefundEvent` finds no payment of ours, so the event ends `ignored`/`not_ours`.
  - **PayPal:** the refund's own `custom_id` is our refund id, unmarked. With no refund or payment here, `processPayPalEvent` ends it `ignored`/`no_payment`.
  - **The Razorpay hook also reads the payment entity's notes.** If Razorpay copies a link's notes to its payment, another environment's refund event stops at the hook.
  - No refund request was changed.

**2. A2.1: PayPal hosts by mode.**
- **Certificate host:** `isPayPalCertUrl(v, {mode})` and `verifyPayPalSignature({mode})` accept `api.sandbox.paypal.com` only in test and `api.paypal.com` only in live.
  - With no mode, either host is accepted (the M6.4 rule); only the start-up dry run calls it that way.
  - The hook takes its mode from `hookModeOf(env, "paypal")`.
- **Approval page:** `isPayPalApproveUrl(v, id, mode)` and `readPayPalOrder(obj, mode)` accept only the page of the client's own mode. An open order's stored URL is reused only on the current mode's host.
- **The lines at `gateway/paypal.ts` ~481 and ~532 are stub-only.** That `www.sandbox.paypal.com` is the local simulator's, which answers only for the sandbox origin.

**3. A2.2: Stripe `livemode` by the Settings mode.**
- The hook keeps an event only when `livemode` equals the mode Stripe runs in (`hookModeOf`):
  - **flag off:** test only, as before, with no D1 read;
  - **flag on:** Settings › Gateways' Stripe mode, from one primary-key read (`GATEWAY_MODES_SQL`). A missing row or a failed read counts as test.
- This replaces AU7 L1 ("both modes kept while the flag is true"); its test is amended.
- The finance judge already used the Settings mode AND the flag (`expectedLivemode`); unchanged.

**4. A2.3: a live mode falls back to test.**
- **The rule:** core `effectiveMode(settingsMode, flag)`. The finance mode readers (`gatewayModeOf`, `stripeModeOfSettings`, `payPalModeOfSettings`) take `env` and answer the effective mode. Every call site passes it, and `linkContext` applies it too.
- **The bell:** while a gateway is live in Settings and the flag is off, every active Owner gets one bell per settings version (`liveRevertBellStatement`).
  - Kind `payment.live_reverted`, entity `settings` / `gateways:v<version>`, written with `INSERT OR IGNORE`.
  - A per-isolate memo skips the repeat write; a failed write only logs.
- `cancelPayPal`'s "live while not allowed → 503" became the effective-mode read.
- **Kept on purpose:**
  - the API clients' own guard: `razorpayOf`, `stripeOf` and `payPalOf`, handed a raw "live" with the flag off, still answer `live_not_allowed` with zero calls;
  - the key-mode guards: `rzp_live_` and `rk_live_` are refused in test mode.
- **So turning the flag off with live keys still set makes no live call.** Razorpay and Stripe refuse the live key. PayPal's live credentials go only to the sandbox host and fail there.

### For the analyst (decisions I took; please confirm or send back)
- **D1. The PayPal mark rides in `custom_id`** as `<UUIDv7>-<env>`: 36 + 1 + at most 16 characters, where PayPal allows 127.
  - Context7 (PayPal REST specs) lists no character pattern for `custom_id`. The mark uses letters, digits and "-" only, like PayPal's own example `my-internal-ref`.
  - **Not verified against the sandbox**: the first sandbox order after deploy should show the suffix echoed on the capture's `custom_id`.
  - If PayPal didn't echo it, the events read as unmarked, which is today's path. No money risk, but PayPal's cross-environment `unknown_link` item would remain.
- **D2. `other_env` rows are recorded for Razorpay and PayPal** (as the brief asks), not for Stripe (M6.3 L5 writes nothing; left as is). Cost: one D1 row per foreign event on the shared sandbox accounts.
- **D3. A2.3 changes three existing tests' expectations:**
  - `refunds.test.ts`: live in Settings with the flag off was 503 `live_not_allowed`; it now runs in test mode, with the bell;
  - `paypal-gateway.test.ts`: the same case; the order is made on the sandbox host;
  - `stripe-hook.test.ts`: AU7 L1, amended by A2.2.
  - `warm-rpc.test.ts`'s client-level live refusal passes unchanged.
- **D4. The bell's words, marked for the lead.** A staff line, my draft under the lead's delegation (`BELL_LIVE_REVERTED` in `gateway/messages.ts`): "Live payments are switched off, so every gateway set to Live is running in test mode. Set it back to Test in Settings › Gateways."
- **D5. Settings › Gateways still shows the saved mode ("Live")** while the Worker runs it as test. The bell and the A2.5 line explain it. Showing the effective mode would touch the shared `apps/admin/worker/settings.ts`, so I didn't.

### Files
- **Core:** `packages/core/src/{payments,razorpay,paypal}.ts`; tests `packages/core/test/{env-marks (new),razorpay,paypal}.test.ts`.
- **Db:** `packages/db/src/gateway.ts` (`WEBHOOK_EVENT_IGNORED_SQL`, `OTHER_ENV_OUTCOME`, `GATEWAY_MODES_SQL`, `liveRevertBellStatement`).
- **Jobs:** `apps/jobs/src/hooks/{shared,razorpay,paypal,stripe}.ts`; tests `apps/jobs/test/{p7-env-marks (new),stripe-hook}.test.ts`.
- **Admin finance:**
  - `apps/admin/worker/gateway/{config,consts,events,link-context,links,messages,paypal,paypal-capture,paypal-links,razorpay,refund-gw,routes,settle,stripe-settle,warm}.ts`;
  - `apps/admin/worker/recon.ts`;
  - tests `apps/admin/worker/{p7-env-marks (new),paypal-gateway,refunds}.test.ts`.
- **Not touched:** no migration, no wrangler config. `PAYMENTS_LIVE_ALLOWED` is untouched ("false" everywhere).

### Commands and results
All ran through `tools/heavy.sh`, except single-file core runs.
- **Typecheck:** `pnpm --filter @techaust/admin typecheck` exit 0; `pnpm --filter @techaust/jobs typecheck` exit 0.
- **Core** (`pnpm --filter @techaust/core test`, with the coverage gate): 133 files, **2,728 passed**.
- **Db** (`pnpm --filter @techaust/db test`): 62 files, **1,092 passed**.
- **Jobs** (`pnpm --filter @techaust/jobs test`): 53 files, 792 passed, 1 failed (the AU7 L1 test, then amended).
  - The amended file re-run: 15 passed.
  - The full suite runs again at the end.
- **Admin** (`pnpm --filter @techaust/admin test`): 199 files, 5,306 passed, 4 failed. The failures were the three expectation changes above, plus the client-level guard, which I then restored.
  - The five affected files re-run: 89 passed.
  - `paypal-gateway.test.ts` re-run after its fix: 31 passed.
  - The full suite runs again at the end.
- **Admin build** (`pnpm --filter @techaust/admin build`, with the worker budget):

  | Worker | Bytes | Ceiling | Plan line |
  |---|---|---|---|
  | front | 121,871 | 150,000 | none |
  | API | 560,633 | 800,000 | none |
  | **finance** | **438,229** | 800,000 | 500,000 |
  | **invoices** | **567,389** | 800,000 | 650,000 |

  Start-up 46–93 ms (limit 200).
- **Jobs build** (`pnpm --filter @techaust/jobs build`): **873,830** of 1,000,000 bytes; start-up 78.7 ms.
- **Biome:** `pnpm exec biome check` on every changed file: clean.

### Not verified
- Any sandbox behaviour: PayPal echoing the `custom_id` suffix, and Razorpay copying link notes to payments. No hosted service was touched.
- The full `pnpm check` and `pnpm lint` (the final step).

## Builder report 2

Builder `fix/p7-payments-b1` (Opus 5.5, high), 2026-11-07. This round applies the analyst's early check (CHANGE), as the lead passed it on. No skill was added: the two loaded in round 1 still fit.

### What changed, by the lead's items
1. **M (`hookModeOf` returns null on a failed read):** `hookModeOf` (`apps/jobs/src/hooks/shared.ts`) now answers `"test" | "live" | null`.
   - Null means the Settings read failed. A missing row or field still means test, and with the flag off there is still no read.
   - Stripe answers 503 `mode_unavailable` with nothing written and no failure counted.
   - PayPal answers the same, through a new verifier verdict `mode_unavailable` (core `PAYPAL_SIGNATURE_VERDICTS`).
   - The test "a failed read is test" is now "a failed read is null". Two new hook tests (Stripe, PayPal) check 503, no row, no `hook_failures` change and no message.
2. **L (lazy PayPal mode read):** the PayPal verifier takes `modeOf` (core `PayPalSignatureInput.modeOf`).
   - It calls `modeOf` only after the webhook id, transmission id, time and base64 signature are well formed.
   - The hook passes it lazily, and `keyFor` re-checks the URL against the mode it read.
   - New test: a post with malformed headers is 400 `signature_missing` with no D1 statement prepared at all.
3. **L (marked stubs):** the local PayPal simulator now marks `custom_id` as `<checkoutId>-local`, so every finance PayPal test (capture, re-fetch, judge, refund) runs through the split on the real paths. That is `stubCapture` and `stubOrder` in `apps/admin/worker/gateway/paypal.ts`, and `scripts/pay-simulate-paypal.mjs` (approved and captured events).
4. **L (adapter `env` required):** both the Razorpay and Stripe adapters now require `env`, with no default.
   - **`razorpayProvider`:** a malformed mark is refused before any call.
     - It answers `provider_error`, because the provider contract has no `env_invalid` code.
     - The live guard is checked first, as in Stripe's adapter.
   - **`stripeProvider`:** its `sessionRequestOf` already refuses a bad mark, so it also answers `provider_error`, with no call.
   - Contract tests pass `env: "local"`. New tests cover a bad mark (no call) and a good one (`notes.techaust_env` sent).
   - The `stripe.ts` ~423 line the lead named is the simulator's `stubSession`. It keeps reading the mark the request sent.
5. **Lead's decision on finding 5 (refunds and reconciliation stay refused):** `refundGwOf` and `fetchSettlements` / "Fetch now" read Settings' own mode again (no `env`). While Settings says live and the flag is off, they stay 503 `live_not_allowed` with zero calls.
   - `refunds.test.ts` is back to its original assertions.
   - A new test checks all three refund gateways and the reconciliation fetch.
   - **Scope, my reading (please confirm):** "only new checkouts fall back" covers the checkout's whole life. That is making the link or order, and settling it: webhook processing, refresh, "Try again", PayPal capture and cancel. Otherwise a test checkout made in fallback could never settle. Refunds and reconciliation do not fall back.
6. **Bell text (D4):** the lead's approved wording is now `BELL_LIVE_REVERTED` (`apps/admin/worker/gateway/messages.ts`).
7. **A2.5 "Before going live":** `GO_LIVE` in `apps/admin/src/lib/gateway.ts` (the gateways copy module, not a shared settings file), shown on `apps/admin/src/routes/settings/gateways.tsx`. It uses the existing `Notice` (info tone), placed under the keys notice; no new CSS and no new component. **Staff-only draft, marked for the lead:**
   > **Before going live**
   > Switch a gateway to Live only when all of this is done, in this order:
   > 1. Set the gateway's live keys, and its webhook at https://hooks.techaust.com/<gateway> with the live webhook secret.
   > 2. The owner sets PAYMENTS_LIVE_ALLOWED to "true" and deploys.
   > 3. Only then switch each gateway to Live here.
   >
   > Online payments may fail for a short time between these steps.

   The designer may want to check the screen; it is the only screen change.
8. **D5 (follow-up, not done):** the Settings screen shows the saved mode ("Live") while new checkouts run in test. Fixing that touches the shared `apps/admin/worker/settings.ts`, which is not mine.

### Files (this round)
- **Core:** `packages/core/src/paypal.ts` (`modeOf`, the `mode_unavailable` verdict).
- **Jobs:**
  - `apps/jobs/src/hooks/{shared,stripe,paypal}.ts`
  - `apps/jobs/test/p7-env-marks.test.ts`
- **Admin finance:**
  - `apps/admin/worker/gateway/{paypal,razorpay,stripe,refund-gw,messages}.ts`
  - `apps/admin/worker/recon.ts`
- **Admin tests:** `apps/admin/worker/{p7-env-marks,refunds,gateway,stripe-gateway}.test.ts`
- **Admin screen and copy:**
  - `apps/admin/src/lib/gateway.ts`
  - `apps/admin/src/routes/settings/gateways.tsx`
- **Script:** `scripts/pay-simulate-paypal.mjs`
- **Not touched:** no migration, no wrangler config. `PAYMENTS_LIVE_ALLOWED` is still "false" everywhere.

### Commands and results (all through `tools/heavy.sh`, one at a time)
- **Typecheck:** `pnpm --filter @techaust/admin typecheck` and `pnpm --filter @techaust/jobs typecheck`, both exit 0.
- **Admin suite** (`pnpm --filter @techaust/admin test`): **200 files, 5,321 passed, 0 failed**.
- **Jobs suite** (`pnpm --filter @techaust/jobs test`): **53 files, 796 passed, 0 failed**.
- **Core suite** (`pnpm --filter @techaust/core test`, with the coverage gate): **133 files, 2,728 passed**.
- **Db suite:** unchanged this round. Round 1 ran it: 62 files, 1,092 passed.
- **Admin build** (`pnpm --filter @techaust/admin build`, worker budget):

  | Worker | Bytes | Ceiling | Plan line |
  |---|---|---|---|
  | front | 121,871 | 150,000 | none |
  | API | 560,633 | 800,000 | none |
  | finance | 438,304 | 800,000 | 500,000 |
  | invoices | 567,389 | 800,000 | 650,000 |

  Start-up 41–104 ms (limit 200).
- **Jobs build** (`pnpm --filter @techaust/jobs build`): the first run failed the start-up limit at 215.6 ms. Another agent's `pnpm check` was running and free memory was about 300 MB. The re-run on a quiet machine passed: **874,208 bytes** (limit 1,000,000), start-up 84.7 ms.
- **`pnpm check`:** exit 0. It covers the full `biome check` lint, typecheck in every package, the web binding guard, web content lint, worker config guard, SPA headers, the migration guard (87, none rebuilds) and CSS collisions.
  - The repository-wide lint ran this once, inside `pnpm check`. I did not run `pnpm lint` a second time, to keep to the once-only rule; it is the same `biome check`.

### Not verified
- Sandbox behaviour: PayPal echoing the `custom_id` suffix, and Razorpay copying link notes to payments.
- A visual check of the A2.5 notice. No dev server or browser was started.

### Open questions for the lead
- **The scope of "only new checkouts fall back" (item 5):** I read it as including the settlement of those checkouts.
- **Wording:** the A2.5 text.

## Early check (analyst, Opus 5.5 high, 2026-11-07): CHANGE, fixed in Builder report 2
- **1 MEDIUM:** a failed Settings read in the hooks counted as "test". Fixed: `hookModeOf` returns null, and the hooks answer 503 `mode_unavailable` with nothing written.
- **2 LOW:** the PayPal hook read D1 before checking its headers. Fixed: lazy `modeOf`.
- **3 LOW:** the stubs and simulator sent a bare `custom_id`. Fixed: they send `-local` marks.
- **4 LOW:** the adapters defaulted `env` to "local". Fixed: `env` is required.
- **5 (D3):** refunds and the reconciliation fetch keep `503 live_not_allowed` while Settings is live and the flag is off (lead's decision); checkouts fall back for their whole life (lead accepts the builder's reading, 2026-11-07).
- **6:** the live-credentials fallback goes into the A2.5 safe order.
- **D4:** bell wording approved by the lead.
- **D5:** stays a follow-up.
- **Wanted before production go-live (L9), not before launch:** one sandbox PayPal order and one Razorpay link on staging after merge, to confirm the `custom_id` suffix is echoed and `notes.techaust_env` is present.
- Usage: builder agent-a5c1936fb71e4ef83, analyst agent-ab7030af55bfdcc39, both claude-opus-5-5/high.
