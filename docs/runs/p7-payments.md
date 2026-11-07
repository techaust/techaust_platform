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
