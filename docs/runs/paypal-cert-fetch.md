# PayPal webhook certificate fetch (staging fix, 2026-11-03)

Status: fix built and tested by the lead; review next; PR auto-merges on green (not held)

Tier: A (payments; one line). Requirement: JOB-HOOK-01, ADM-PAY-04.

## What the owner's sandbox payment showed
- The owner paid USD 35.40 with a US sandbox Personal account on staging (2026-11-03, 08:40 UTC). The capture went through the return path: payment `ppl_9RE42009AK391310E` confirmed, fee 1.98 USD, invoice TH/EXP/2627/0003 paid in full.
- **No PayPal webhook was recorded.** The jobs Worker answered `POST /paypal` with 503 `cert_unavailable` eight times between 08:41 and 08:44 UTC, in fresh isolates too (Workers Logs, read-only).
- **Cause:** `apps/jobs/src/hooks/paypal.ts` fetched the certificate with `redirect: "error"`, which the Workers runtime refuses with a TypeError ("Invalid redirect value, must be one of "follow" or "manual""; confirmed in workerd through the jobs test pool). Every certificate fetch failed. The tests inject their own fetch, so none caught it. The certificate reader itself works on PayPal's real 2024 sandbox certificate (checked locally with `importPayPalCertKey`).

## Fix (lead)
- `redirect: "manual"`: a redirect answer is a 3xx, which the existing status check refuses (never followed).
- Tests in `apps/jobs/test/paypal-hook.test.ts`: the fetch is asked with `manual` through workerd's own `Request`, and a 302 is refused; no jobs source asks fetch for redirect "error". Both fail on the old line and pass on the new.
- No other Worker code uses redirect "error".

## Checks
- jobs typecheck exit 0; jobs tests 39 files, 646 passed; jobs build: 735,103 bytes (limit 1,000,000), start-up 92.9 ms.

## After the merge
- PayPal retries a failed webhook for up to 3 days, so this payment's `PAYMENT.CAPTURE.COMPLETED` (and the order event) should arrive on their own once staging has the fix: the lead reads `webhook_events` (provider `paypal`) and the hook's log lines to prove the path, with no second payment needed.
