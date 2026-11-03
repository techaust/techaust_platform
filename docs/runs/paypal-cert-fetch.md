# PayPal webhook certificate fetch (staging fix, 2026-11-03)

Status: review APPROVE, findings 1, 3, 4, 6 fixed; PR #168 auto-merges on green (not held)

Tier: A (payments; one line). Requirement: JOB-HOOK-01, ADM-PAY-04.

## What the owner's sandbox payment showed
- The owner paid a USD export invoice with a US sandbox Personal account on staging (2026-11-03, 08:40 UTC). The capture went through the return path: the payment confirmed, PayPal's fee recorded, the invoice paid in full.
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

## Review (reviewer, 2026-11-03, 1743ce94): APPROVE
_Summarised by the lead from the reviewer's reply._ Usage: reviewer claude-opus-5-5/high (skills `code-review`, `cloudflare:workers-best-practices`). Ran the jobs tests: 39 files, 646 passed.
Verified: only `paypal.ts:87` changes in production code; `manual` is safe (a 3xx is answered, its body cancelled, never followed; the allow-list is checked before every fetch; timeout, size cap and fetch budget unchanged); no other Worker fetch passes an option workerd refuses (PayPal, Razorpay, Stripe, Turnstile, SES/aws4fetch pass only method, headers, body, signal).
Findings: (1, medium) the test's own `new Request` check is swallowed by `fetchPem`'s catch, and the shared `certFetch` ignores `init`; (2, low) the source scan covers only jobs and one quote style; (3, low) the `ImportMeta.glob` type is loose (the portal has the precise one); (4, low) a refused certificate fetch logs no reason; (5, low) the admin gateway transports follow redirects by default with an `Authorization` header (fixed API hosts, small risk); (6, low) the run file published a sandbox payment id and invoice number.

## Lead triage
- **1:** fixed. `certFetch` builds workerd's own `Request(input, init)` before it answers, so every certificate test checks the options (on the old line 12 of 20 tests fail, not 1); the new test gets a real key with the options and a 302 refusal.
- **3:** fixed (the portal's overload; the cast dropped). The scan also matches both quote styles (part of 2).
- **4:** fixed. `hook.cert_fetch_failed` with `why` (`network`, `status_Nxx`, `too_large`, `not_utf8`, `cert_invalid`), never the URL or a header; test.
- **6:** trimmed.
- **2 and 5:** a listed follow-up (for 12), together: a repo-wide `scripts/` guard in `pnpm check` for fetch options workerd refuses (all Worker sources, both quote styles), and `redirect: "manual"` with a 3xx refusal in the admin gateway transport (`gateway/config.ts`). Reason: 5 changes finance's money transports (Tier A) and needs its own tests and review, not this hotfix.
- Lead's checks after the fixes: jobs typecheck exit 0; jobs tests 39 files, 646 passed; jobs build 735,289 bytes, start-up 61.7 ms.
