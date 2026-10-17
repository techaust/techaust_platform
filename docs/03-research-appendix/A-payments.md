# Payments Research: TecHaust Technologies (Sole Proprietorship, GST-registered, West Bengal)

Research date: 2026-10-06. Web-only; no sign-ups or logins.

> **Outcome (research record).** The owner already holds active Razorpay, Stripe and PayPal accounts. [03 §3B.5](../03-plan.md) and [05 §9](../05-architecture.md) adopt them plus manual bank transfer. Xflow, Skydo, MoneySaver and Cashfree are later options, added through the provider interface ([ADR 0008](../adr/0008-payment-provider-interface.md)). Where this appendix says Stripe is not available to a new Indian account or recommends other providers first, the owner's existing accounts and the decisions above win.
>
> See [05-A §11](../05-research-appendix/A-stack-verification.md) for PayPal and Stripe webhook verification on Workers (this appendix covers Razorpay and Cashfree).

**Legend**
- **[S]** = sourced fact (URL + date, or "fetched 2026-10-06" for live pages without a visible date)
- **[I]** = inference / analysis by the researcher
- **[3P]** = sourced, but only from a third party. Many 2026 fee comparisons are published by competitors (Xflow, Skydo, Winvesta), so treat them as indicative and confirm on the provider's own page or in a signed pricing annexure.
- **VERIFY WITH CA/LEGAL** = needs professional sign-off before you rely on it

---

## 0. Executive summary

| Need | Recommendation | Why (short) |
|---|---|---|
| Domestic INR (UPI, cards, netbanking, wallets, payment links, partial payments) | **Razorpay** as the primary gateway, with **Cashfree** as a backup or cheaper option | Both accept sole proprietors and both have Payment Links with partial payments, HMAC-SHA256 webhooks and test mode. Razorpay has the more mature Invoices/Links/recon APIs. Cashfree is slightly cheaper (1.95% promo) and has a first-class `x-idempotency-key` header. |
| International B2B (USD/GBP/EUR/AED…) by bank transfer | **A PA-CB collection account**, either **Skydo** or **Xflow** (flat fee, mid-market FX, free e-FIRA), or **Razorpay MoneySaver** (1%, min ₹1,000, same dashboard and API as domestic) | Clients pay a local account in their own country (ACH/SEPA/FPS). An RBI-authorised PA-CB issues the e-FIRA that GST zero-rating under LUT relies on. Total cost is about 0.3–1.2% versus 7–8% on PayPal. |
| International by card (convenience) | **Razorpay international cards** on the same payment link (up to 3% plus conversion), or Cashfree (2.99%) | Use only when the client insists on a card. |
| Avoid / fallback only | **PayPal** (about 7–8% all-in, international receipts only); **Stripe** (invite-only in India) | See sections 4 and 5. |
| Edge runtime (Cloudflare Workers) | **Call the REST APIs with `fetch` and verify webhooks with Web Crypto (`crypto.subtle`)**. Do not use the Razorpay or Cashfree Node SDKs. | Both SDKs depend on axios and Node `crypto`, and Cashfree's also pulls in `@sentry/node`. Signature schemes are plain HMAC-SHA256, which is trivial in Web Crypto. |

**Most important recent change [S]:** NPCI has published an FAQ (dated 15 Sept 2026) introducing **0.4% MDR on P2M UPI transactions above ₹2,000, capped at ₹300 for transactions of ₹75,000 and above, effective 15 October 2026.** Almost every B2B UPI invoice will be above ₹2,000. See section 8.

---

## 1. Razorpay

### 1.1 Eligibility / KYC (sole proprietorship)
- **[S]** Sole proprietorship KYC asks for:
  - proof of business identity and existence: an **MSME/Udyam certificate or GST certificate**
  - proof of a working business account: cancelled cheque or bank letter
  - proprietor PAN
  - proprietor address proof (Aadhaar, Voter ID or Passport)

  Source: https://razorpay.com/docs/payments/kyc/ (Business Types and KYC Documents; fetched via a mirror, mirror details not captured, 2026-10-06). A Razorpay blog dated 30 Apr 2026 lists PAN, government ID, Shop & Establishment or Udyam, a cancelled cheque or bank statement **with the name matching PAN exactly**, GST certificate or a non-enrolment declaration, and business address proof. It notes video KYC as an onboarding method. https://razorpay.com/blog/payment-gateway-kyc-onboarding-india/ (30 Apr 2026)
- **[3P]** A savings account is accepted only for sole proprietors; other entities need a current account. The bank account is checked with a penny-drop name match. https://razorpay.com/blog/documents-required-for-payment-gateway
- **[I]** Use a current account in the trade name, linked to the proprietor PAN. It avoids name-mismatch rejections and keeps business receipts clean for GST and income tax.

### 1.2 Domestic methods and fees
- **[S]** Standard plan: **2% per successful transaction**, plus 18% GST, on domestic cards (Visa, Mastercard, RuPay, Amex, Diners), UPI, netbanking, wallets and EMI. Setup fee, AMC and refund fee are all ₹0. Payment Links, Payment Pages, Buttons and Invoices are included at no extra cost. Settlement is T+1, or instant for a fee.
- **[S]** The pricing page says UPI is *"Zero MDR — 2% platform fee applies"*. In other words, Razorpay charges 2% on UPI as a "platform fee", not as MDR. https://razorpay.com/pricing/ (fetched 2026-10-06)
- **[3P]** Subscriptions/recurring on cards are quoted at 0.9% on top of platform fees, and UPI QR at 0.99%. Treat these as unconfirmed.
- **[I]** For B2B tickets (₹20k–₹5L), 2% is expensive. Negotiate a custom rate once volume exists, especially for UPI and netbanking, and above all once the UPI MDR regime starts on 15 Oct 2026 (section 8).
- Recurring payments: UPI AutoPay, e-mandate (NACH) and card mandates are available through Subscriptions. Pricing is not confirmed for this report. **[I]**

### 1.3 International
- **[S]** International cards: **"up to 3% per successful transaction"**. https://razorpay.com/pricing/ (fetched 2026-10-06)
- **[S] MoneySaver Export Account (international bank transfers):**
  - virtual accounts in USD, GBP and EUR, plus local rails (ACH, FPS, SEPA, NPP, EFT, SWIFT)
  - **1% Razorpay fee, 0% FX markup, 1-day settlement**
  - "FlashLinks US payments" at 2% with 5-day settlement
  - automated **eFIRC within 24 hours of settlement**

  Source: https://razorpay.com/accept-international-payments/bank-transfers/ (fetched 2026-10-06)
- **[3P]** MoneySaver has a minimum charge of **₹1,000 + GST** for transfers under ₹1,00,000. https://www.skydo.com/compare/razorpay-pricing (2026)
- **[S]** Purpose code, IEC and HS code are configured in the dashboard. https://razorpay.com/docs/payments/dashboard/account-settings/international-payment-codes/ . Typical software export purpose codes are P0802 (software consultancy) and P0807 (off-site software exports). https://razorpay.com/blog/rbi-purpose-code-remittance-compliance-guide/ (2026)
- **[S]** Invoices API: non-GST invoices can be created in international currencies, and `currency` is mandatory for international payments. https://razorpay.com/docs/api/payments/invoices/create-with-details/

### 1.4 Developer features
- **[S] Payment Links API:** `POST https://api.razorpay.com/v1/payment_links/`. It supports `accept_partial` and `first_min_partial_amount` (in subunits), plus a currency, reminders and notify options. https://razorpay.com/docs/api/payments/payment-links/create-standard/
- **[S] Invoices API:** `partial_payment: true`. https://razorpay.com/docs/api/payments/invoices/create-with-details/
- **[S] Webhooks:**
  - The `X-Razorpay-Signature` header carries **HMAC-SHA256 (hex) of the raw request body**, keyed with the webhook secret. That secret is different from the API secret.
  - The `x-razorpay-event-id` header can be used to de-duplicate retries.
  - Events can arrive out of order.
  - Test-mode webhooks are triggered by test-mode transactions.

  Source: https://razorpay.com/docs/webhooks/validate-test/ (fetched 2026-10-06)
- **[S] Idempotency:**
  - `X-Payout-Idempotency` has been mandatory for RazorpayX payouts since 15 Mar 2025.
  - Refunds support the `X-Refund-Idempotency` header.

  Sources: https://razorpay.com/docs/api/x/payout-idempotency/ and the Razorpay refunds idempotent docs (source detail not captured).
- **[3P / unverified]** There are claims that the Orders `receipt` field acts as an idempotency key. **[I]** Do not rely on that. Store your own invoice↔order mapping and check it before creating.
- **[S] Node SDK** (`razorpay` v2.9.8):
  - depends on **axios ^1.18**
  - `validateWebhookSignature` uses Node `require("crypto")` `createHmac('sha256')` and compares with plain `===`, which is **not timing-safe**

  Sources: https://raw.githubusercontent.com/razorpay/razorpay-node/master/package.json and `lib/utils/razorpay-utils.js` in the same repository (full URL not captured; fetched 2026-10-06)
- **[I] Cloudflare Workers:** the SDK might run under `nodejs_compat` with axios's fetch adapter. However:
  - **[3P]** axios 1.20's fetch adapter sets `cache: 'default'`, which Workers reject (https://github.com/axios/axios/issues/11192)
  - **Recommendation:** call the REST API directly with `fetch` and Basic auth (`key_id:key_secret`), and verify webhooks with Web Crypto
- **[S] Disputes and settlements:**
  - `GET /v1/disputes` lists disputes
  - `GET /v1/settlements` lists settlements
  - `GET /v1/settlements/recon/combined?year=&month=&day=` returns the payments, refunds, transfers and adjustments in each settlement

  Sources: https://razorpay.com/docs/api/disputes/fetch-all/ and https://razorpay.com/docs/api/settlements/

---

## 2. Cashfree Payments

### 2.1 Eligibility / KYC
- **[3P]** A proprietorship needs:
  - proprietor PAN
  - address proof (Aadhaar, DL, Voter ID, Passport or a utility bill)
  - a cancelled cheque or statement for an account in the business name
  - GST certificate if applicable

  Activation takes about 48 hours once documents are complete. https://www.cashfree.com/blog/documents-required-for-payment-gateway-in-india/
- **[S]** Cashfree holds a full **PA-CB licence** covering both export and import (announced July 2024). https://www.business-standard.com/companies/start-ups/cashfree-payments-gets-payment-aggregator-cross-border-licence-from-rbi-124072201242_1.html

### 2.2 Domestic fees
- **[S]** The current "festive offer" (for new merchants, up to ₹20L GMV):
  - **1.95%** platform fee on cards (Visa, Mastercard, RuPay, Maestro)
  - Amex and Diners 2.95%
  - **International cards 2.99%**
  - UPI "as per the applicable law"
  - Pay Later 2.2–2.5%
  - Credit card EMI 2.2%
  - **Virtual bank accounts ₹20 per transaction**
  - Instant settlement 0.30%
  - Zero setup fee
  - 18% GST on fees
- **[S] Recurring:**
  - UPI AutoPay: ₹7.5 per mandate plus ₹5 per debit under ₹1,000, or ₹15 per debit at ₹1,000 and above
  - e-NACH and card mandates: ₹7.5 + ₹7.5

  Source: https://www.cashfree.com/payment-gateway-charges/ (fetched 2026-10-06)

### 2.3 International
- **[S]** International Payment Gateway accepts cards in 140+ currencies and PayPal.
- **[S] Global Collections:**
  - local accounts in **USD, EUR, CAD and GBP**, plus a Global SWIFT account for 30+ currencies
  - "no currency conversion fees or forex markups" (as stated)
  - **limit of USD 10,000 per transaction**

  Source: https://www.cashfree.com/accept-international-payments/ (fetched 2026-10-06)
- **[3P]** Global Collections pricing is "request price" (third parties estimate about 1–1.5%). e-FIRA is issued within 24 hours at no extra cost. https://www.skydo.com/compare/cashfree-overview (2026)
- **[S]** International payments on Payment Links need activation by Cashfree. `link_currency` is a field on the link. https://docs.cashfree.com/docs/payment-links-introduction

### 2.4 Developer features
- **[S] Payment Links API:** `link_partial_payments` (boolean) and `link_minimum_partial_amount`. Requests carry the `x-api-version`, `x-client-id`, `x-client-secret` and **`x-idempotency-key`** (UUID) headers. https://www.cashfree.com/docs/api-reference/payments/latest/payment-links/create
- **[S] Webhooks:**
  - The signature is **Base64(HMAC-SHA256(secret_key, x-webhook-timestamp + rawBody))**.
  - It arrives in the headers `x-webhook-signature` and `x-webhook-timestamp`.
  - You must hash the raw payload.

  Source: https://www.cashfree.com/docs/payments/online/webhooks/signature-verification (fetched 2026-10-06)
- **[I]** Including the timestamp lets you reject replays by checking the timestamp is within ±5 minutes. Razorpay's scheme does not include a timestamp.
- **[S] Node SDK** (`cashfree-pg` v6.0.6): depends on **axios ^1.19 and `@sentry/node` ^10**. https://raw.githubusercontent.com/cashfree/cashfree-pg-sdk-nodejs/main/package.json (fetched 2026-10-06)
- **[I]** `@sentry/node` makes Workers compatibility doubtful. Use REST and Web Crypto instead.
- **[S] Refunds, disputes and reconciliation:**
  - Refund APIs support full, partial and multiple partial refunds.
  - Disputes APIs cover types, states and actions.
  - A Settlement Recon report includes adjustments, refunds and disputes.

  Source: https://www.cashfree.com/docs/payments/manage/refunds and the related pages (source detail not captured).
- **[S]** Sandbox is available (Dev Studio, including a webhook verification tool).

---

## 3. PayU India

- **[S] Fees:**
  - **2%** on Visa/Mastercard cards, netbanking, BNPL and wallets
  - **3%** on Diners, Amex, EMI and **international**
  - 18% GST
  - no setup fee or AMC
  - merchant UPI priced "by business type and volume"
  - **standard settlement T+2**

  Source: https://payu.in/pricing/ (fetched 2026-10-06)
- **[S] Integration and webhooks:** PayU uses **SHA-512 hash strings with a merchant salt**, not HMAC. The reverse-hash check on responses is `sha512(SALT|status||||||udf5|…|txnid|key)`. Chargeback webhooks send a SHA-512 hex digest in the `X-PayU-Dispute-Webhook-Signature` header. https://docs.payu.in/docs/cb-integration-non-seamless and https://docs.payu.in/docs/webhooks-for-chargeback
- **[I]** PayU's pipe-delimited salted-hash model is older and easier to get wrong. T+2 settlement is slower. Payment Links exist, but partial-payment support on links was not confirmed in this research. **Not recommended as primary.**
- KYC: **[3P]** standard sole proprietor flow based on PAN. Details were not confirmed on PayU's own site.

---

## 4. Stripe (India)

- **[S] Invite-only.** Stripe's help page says *"Businesses from India are not able to sign up for a new Stripe account through our website."* New businesses must request an invite through Sales. Stripe focuses on "a select number of businesses, with a focus on international expansion". No end date is given. https://support.stripe.com/questions/stripe-accounts-are-invite-only-in-india (fetched 2026-10-06)
- **[3P]** The invite-only status has been in place since May 2024. https://www.xflowpay.com/blog/stripe-transaction-fees (2026)
- **[S]** From **1 Jan 2026**, revised RBI PA guidelines require liveness checks (a live **video KYC** call) for all new Stripe India users. https://support.stripe.com/questions/video-kyc-for-india-onboarding (fetched 2026-10-06)
- **[3P]** Indicative fees:
  - 2% on domestic cards
  - 3% on international cards charged in INR
  - 4.3% on international cards charged in foreign currency, plus a 2% conversion fee and GST
  - no UPI support

  Source: https://www.xflowpay.com/blog/stripe-transaction-fees (2026). These are competitor figures; unverified on Stripe.
- **[S/I] Developer side:** stripe-node supports Workers through `Stripe.createFetchHttpClient()`, and webhooks through `constructEventAsync` with `Stripe.createSubtleCryptoProvider()`. https://blog.cloudflare.com/announcing-stripe-support-in-workers . It is technically the best edge story, but **[I]** it is not practically available to a new Indian sole proprietorship. **Do not plan on Stripe.**

---

## 5. PayPal (India)

- **[S] Fees:**
  - International commercial receipts: **4.40% + a fixed fee** (USD 0.30, EUR 0.35)
  - Currency conversion: **3.0% over the base rate**
  - *"For India users, we only support international payments"* (no domestic)
  - Withdrawal is free without conversion; a failed withdrawal costs ₹250
  - The page was last updated 28 Mar 2024

  Source: https://www.paypal.com/in/webapps/mpp/merchant-fees (fetched 2026-10-06)
- **[3P]** The all-in cost is about 7–8% once you add 18% GST on fees. https://www.xflowpay.com/blog/paypal-transaction-fees (2026)
- **[S]** PayPal received RBI in-principle PA-CB approval in May 2025. https://www.business-standard.com/companies/news/paypal-receives-rbi-nod-to-operate-as-cross-border-payment-aggregator-125052800922_1.html (28 May 2025; URL date code)
- FIRA: not stated on the fees page. **[I]** Historically PayPal provides FIRC/FIRA through its partner bank on request. Confirm current e-FIRA availability with PayPal.
- **[I]** Use PayPal only as a fallback when a client insists. It is expensive and has a history of reserves and holds.

---

## 6. Cross-border B2B receivables services

| Provider | RBI status | Fee (as published) | FX | e-FIRA | Notes |
|---|---|---|---|---|---|
| **Skydo** | **[S]** Final PA-CB authorisation (https://ibsintelligence.com/ibsi-news/skydo-secures-final-rbi-authorisation-for-cross-border-payments/) | **[3P]** $19 flat up to $2,000; $29 for $2,001–10,000; 0.3% above $10k; plus 18% GST on fee (https://www.xflowpay.com/blog/skydo-review 2026) | **[3P]** mid-market, 0 markup | **[3P]** free, automatic per payment | 32+ currencies **[S]**. Its own pricing page returned 404 on 2026-10-06, so confirm current rates. |
| **Xflow** | Licensing claims are on Xflow's own site; status not confirmed separately in this research | **[S]** Starter: $12 flat up to $2,000, then 0.6%. Growth: $20 flat up to $5,000, then 0.4%. Scale: custom. **Next business day settlement by noon.** "No GST: Xflow's US entity provides services; GST may apply via reverse charge." (https://www.xflowpay.com/pricing fetched 2026-10-06) | **[S]** mid-market | **[3P]** auto e-FIRA within 24 hours, free; SOFTEX/EDPMS support | **[3P]** Supports sole proprietorships (PAN and brand name; IEC only for goods). Has API and payment-link features (not confirmed in this research). **Reverse-charge GST point: VERIFY WITH CA.** |
| **Razorpay MoneySaver** | Razorpay is a PA-CB **[I/3P]** | **[S]** 1%, 0% FX markup, T+1; **[3P]** min ₹1,000 + GST under ₹1L | **[S]** 0 markup | **[S]** eFIRC within 24 hours | Same account and API as domestic: one vendor, one reconciliation path. |
| **Cashfree Global Collections** | **[S]** Full PA-CB | **[3P]** quote-based (about 1–1.5%) | **[S]** "no forex markup" | **[3P]** free within 24 hours | **[S]** USD 10k per transaction limit |
| **Wise Business** | **[S]** In-principle PA-CB, July 2025 (announced 3 Jul 2025; https://newsroom.wise.com/en-CAS/250703-wise-granted-rbi-s-in-principle-approval-to-operate-as-cross-border-payment-aggregator/) | **[3P]** small receive fees plus mid-market conversion; **[3P]** FIRA said to cost $2.50 each | mid-market | **[3P]** yes, paid | **[3P]** ₹25L per-transfer cap; India business receiving reportedly supports sole proprietors and freelancers but **not registered companies**; Indian accounts cannot hold FX balances long-term; personal-account receiving was ended from 5 Apr 2026 (https://www.winvesta.in/blog/businesses/wise-india-review-2026-features-fees-limitations-verdict). No invoicing/payment-link API suitable for your admin backend. **[I]** |
| **Payoneer** | **[S]** In-principle PA-CB, Jan 2026 (https://www.nasdaq.com/press-release/payoneer-receives-principle-authorization-cross-border-payment-aggregator-india-2026) | **[3P]** local receiving accounts free; ACH from non-Payoneer payers 1%; cards 3.2% + $0.49; **1–4% withdrawal/FX to INR**; $29.95 annual fee if receipts are under $6k in 12 months (https://www.xflowpay.com/blog/payoneer-charges 2026) | 1–4% markup | **[S]** free digital FIRA/FIRS/NOC (https://www.payoneer.com/en-in/digital-firc/) | Expensive on FX. **[I]** Fine if clients already use Payoneer. |

**[I] Worked example** (assumes ₹88/USD, a rough per-appendix assumption: [03-B](B-platform-stack.md) uses ₹90 and 05 uses 88.42; fee only, before GST):

| Invoice | Razorpay MoneySaver | Skydo | Xflow Starter | Xflow Growth | PayPal (approx.) |
|---|---|---|---|---|---|
| $1,000 | max(1%, ₹1,000) ≈ $11.4 | $19 | $12 | $20 | $44.30 + about $30 FX ≈ $74 |
| $5,000 | $50 | $29 | $30 (0.6%) | $20 | $220.30 + about $150 FX ≈ $370 |

Recompute with live rates before choosing.

---

## 7. Developer architecture notes (Cloudflare Workers / edge)

**[I] Recommendation:** no gateway SDKs on Workers. Use `fetch` against the REST APIs:
- Razorpay: Basic auth with `key_id:key_secret`
- Cashfree: `x-client-id`, `x-client-secret` and `x-api-version` headers

Verify webhooks with Web Crypto. Both schemes are plain HMAC-SHA256.

```ts
// Shared helpers (Workers / any WinterCG runtime)
async function hmacSha256(secret: string, data: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
}
const toHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const toB64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));
function safeEqual(a: string, b: string) { // constant-time compare
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// Razorpay: hex(HMAC_SHA256(webhookSecret, rawBody)) vs X-Razorpay-Signature
// Cashfree: base64(HMAC_SHA256(secretKey, timestamp + rawBody)) vs x-webhook-signature
const raw = await request.text(); // read raw body ONCE; JSON.parse only after verifying
```

**Implementation rules [I]:**
1. **Raw body first.** Verify the signature before `JSON.parse`. Both vendors state this explicitly **[S]**.
2. **Idempotent webhook handler.** Store the Razorpay `x-razorpay-event-id`, or a Cashfree event key such as order_id + cf_payment_id + type, in a unique-key table. Ignore duplicates. Treat events as unordered.
3. **Never trust the redirect alone.** Mark an invoice paid only after a verified webhook, or after a server-side fetch of the payment/link status.
4. **Partial payments.** Model `invoice.amount_due` and `invoice.amount_paid` as a ledger of payment rows, whether they come from the gateway, a manual bank transfer or a cross-border provider. Razorpay links emit `payment_link.partially_paid` and `payment_link.paid` events **[I: confirm event names in docs]**.
5. **Manual bank transfers.** Record UTR/reference, date, amount, mode (NEFT/RTGS/IMPS/SWIFT) and the attached FIRA PDF for exports. Optional automation: Razorpay Smart Collect or Cashfree Virtual Accounts (₹20 per transaction **[S]**) give each client a unique virtual account number, so NEFT/RTGS receipts reconcile automatically.
6. **No card or bank credentials stored.** Use hosted payment links and hosted checkout only, which keeps you outside PCI DSS card-data scope **[I]**. Store only gateway IDs, statuses and amounts.
7. **Idempotency on create.** Send Cashfree `x-idempotency-key` and Razorpay `X-Refund-Idempotency` for refunds. For Razorpay link/order creation, de-duplicate with your own invoice-ID→link-ID mapping, and use `reference_id` on payment links **[I: confirm uniqueness semantics]**.
8. **Test mode.** Razorpay test keys and test-mode webhooks: **[S]** the default webhook-setup OTP in test mode is 754081. Cashfree sandbox and Dev Studio webhook tester **[S]**.
9. **Reconciliation job.** Run a nightly pull of Razorpay `/v1/settlements/recon/combined` (or the Cashfree settlement recon report). Match against invoice payments, and post fees and GST on fees to an expense ledger for input tax credit.

---

## 8. Regulatory changes 2025–26

1. **RBI Master Direction on Regulation of Payment Aggregators, 2025 (15 Sep 2025)**
   - **[S]** It consolidates and supersedes the 2020–21 PA/PG guidelines and the 2023 PA-CB circular.
   - **[S]** It creates three categories: PA-P (physical), PA-O (online) and PA-CB (cross-border).
   - **[S]** For PA-CB: separate inward and outward collection accounts with AD-I banks, no pre-funding, and a **₹25 lakh cap per cross-border transaction**.
   - **[S]** New merchant due diligence applies from **1 Jan 2026**. "Small merchants" (domestic turnover up to ₹40L, or export turnover up to ₹5L) can be onboarded with PAN or Form 60, contact point verification and the proprietor's OVD.

   Sources: https://www.fidcindia.org.in/wp-content/uploads/2025/09/RBI-PAYMENT-AGGREGATORS-DIRECTIONS-15-09-25.pdf ; https://indiacorplaw.in/2025/10/09/decoding-rbis-overhaul-of-the-payment-aggregator-directions/ ; https://authbridge.com/blog/rbi-payment-aggregator-master-direction-2025/

   **[I] Implications:**
   - Expect a video KYC or liveness step and stricter business-nature checks; Stripe already applies this **[S]**.
   - Invoices over ₹25L, roughly $28k, must be split or sent by direct bank SWIFT.
   - Cashfree Global Collections adds its own lower cap of USD 10k **[S]**.
2. **Foreign PA-CB approvals**
   - **[S]** PayPal (in-principle, May 2025), Wise (in-principle, July 2025; announced 3 Jul 2025) and Payoneer (in-principle, Jan 2026).
   - **[3P]** About 19 entities hold full PA-CB authorisation (https://www.winvesta.in/blog/businesses/19-firms-got-rbis-pa-cb-license-who-won-and-why). Skydo and Cashfree hold final authorisation **[S]**.
3. **UPI MDR from 15 Oct 2026**
   - **[S]** NPCI's FAQ dated 15 Sept 2026, hosted by the Department of Financial Services:
     - **0.4% MDR on P2M UPI above ₹2,000**, capped at **₹300 per transaction for ₹75,000 and above**
     - ₹2,000 and below stays free
     - small "P2PM" merchants (up to ₹1L per month on QR) stay at zero
     - UPI AutoPay/mandates carry no prescribed MDR
     - flat ₹5 for certain categories (insurance, utilities, fuel, telecom, railways)
     - merchants **cannot pass the MDR on to customers**
     - RuPay credit card on UPI follows card rules

     Source: https://financialservices.gov.in/sites/default/files/2026-09/FAQs---Merchant-Discount-Rate--MDR--on-Select-UPI--P2M--Transactions_0.pdf

   **[S]** For context, the Finance Ministry had denied UPI MDR plans on 11 Jun 2025 (https://www.tribuneindia.com/news/business/finance-ministry-dismisses-speculation-of-mdr-of-upi-transactions-says-claims-false-baseless).

   **[I] Implications:**
   - (a) B2B UPI collections will carry statutory MDR, so expect gateways to restate UPI pricing. Razorpay's current "2% platform fee" on UPI could become MDR plus platform fee; watch for pricing emails.
   - (b) Do not add a "UPI surcharge" line to invoices.
   - (c) For large invoices, netbanking or NEFT/RTGS to a virtual account may now be cheaper than UPI. Also note that general P2M UPI limits remain about ₹1L per transaction for most merchant categories **[I: VERIFY]**.
   - (d) This policy is three weeks old, so re-check NPCI circulars before launch.
4. **UPI P2M limit increase (15 Sep 2025)**
   - **[S]** ₹5L per transaction and ₹10L per day for specific categories only: insurance, capital markets, travel, collections, GeM.
   - **[S]** P2P stays at ₹1L. https://www.newsonair.gov.in/npci-raises-upi-person-to-merchant-transaction-limit-to-%E2%82%B95-lakh
   - **[I]** A software studio likely falls in a general category, so treat UPI as unsuitable for large invoices.
5. **Stripe India:** invite-only, with video KYC from 1 Jan 2026 **[S]**.

---

## 9. Refunds, disputes, chargebacks: comparison

| | Razorpay | Cashfree | PayU | PayPal |
|---|---|---|---|---|
| Refund API | Yes; full and partial; `X-Refund-Idempotency` **[S]**; refund fee ₹0 **[S]** | Yes; full, partial, multiple partial **[S]** | Yes **[S]** (instant refunds marketed) | Yes (dashboard/API) |
| Disputes API | `GET /v1/disputes` **[S]**; contest/accept via API **[I: confirm]** | Disputes APIs and actions **[S]** | Chargeback webhooks (SHA-512) **[S]** | Resolution Center |
| Settlement recon | `/v1/settlements/recon/combined` **[S]** | Settlement recon report/API **[S]** | Reports (not confirmed in this research) | Activity reports |
| Settlement time | T+1 (instant optional) **[S]** | Standard cycle; instant 0.30% **[S]** | T+2 **[S]** | Manual/auto withdrawal |

**[I]** International card chargebacks are the main dispute risk. B2B bank transfers through PA-CB accounts are push payments with practically no chargeback exposure. That is another reason to prefer bank transfer for foreign clients.

---

## 10. Final recommendation

### (a) Domestic INR
**Razorpay** (primary):
- Payment Links with `accept_partial` attached to each invoice.
- UPI, cards, netbanking and wallets on a hosted page.
- Optional Smart Collect virtual accounts for NEFT/RTGS on big invoices.
- Webhooks verified with Web Crypto on Workers.
- Nightly settlement recon.

**Cashfree** (secondary or negotiation lever):
- Lower card rate (1.95% promo), `x-idempotency-key`, and timestamped (replay-resistant) webhooks.
- ₹20 virtual accounts.
- Full PA-CB licence if you want a single vendor for international too.

**Rationale [I]:**
- Both onboard sole proprietors with GST and PAN.
- Both have partial-payment links, sandbox mode and HMAC-SHA256 webhooks.
- Razorpay has deeper Invoices/Links/recon tooling and an integrated export account.

**Manual bank-transfer recording:** keep it as a first-class payment row with a UTR in your own ledger.

### (b) International
1. **Default: bank transfer to a PA-CB local collection account**, with free automatic e-FIRA and the purpose code set to P0802/P0807 (confirm with your CA).
   - **Xflow** (confirm its PA-CB authorisation first; VERIFY WITH CA/LEGAL) or **Skydo** for invoices of about $2k–$25k: flat or low percentage fee, mid-market FX.
   - **Razorpay MoneySaver** if you prefer one vendor and API for everything. Watch the ₹1,000 minimum fee on small invoices.
2. **Cards as an opt-in** on the same Razorpay (or Cashfree) link for clients who insist. Budget about 3% plus FX, plus dispute risk.
3. **PayPal only as a last resort.** **Stripe is not available** unless invited.
4. AED/Gulf clients: Razorpay MoneySaver lists USD/GBP/EUR; Cashfree adds CAD plus SWIFT for 30+ currencies; Skydo claims 32+ currencies. **[I]** Have Gulf clients pay in USD unless the provider confirms an AED local account.

---

## 11. VERIFY WITH CA/LEGAL

1. **FIRA/e-FIRA as GST export evidence.** Confirm that a PA-CB-issued e-FIRA, rather than a bank e-FIRC or e-BRC, is enough for your jurisdictional GST officer and for the GSTR-1 Table 6A, LUT and refund route. Also confirm the e-BRC self-generation position for services under DGFT. Context: https://razorpay.com/blog/difference-between-brc-and-firc/ ; https://www.taxtmi.com/article/detailed?id=16382
2. **LUT for FY 2026-27.** It must be filed before the first zero-rated export of the year (**[3P]** https://www.incorpx.io/blog/lut-gst-export-filing-process-fy-2026-27). Also confirm that each export meets all the conditions of IGST Act s.2(6): place of supply outside India, payment in convertible foreign exchange (or INR as permitted by RBI), and not merely an establishment of a distinct person.
3. **Purpose codes.** Choose the correct one (P0802 vs P0807 vs other P08xx/P10xx) and use it consistently across providers.
4. **GST on gateway and PA-CB fees.** 18% under SAC 998433 is understood to be ITC-eligible for registered businesses (**[3P]** https://www.incorpx.io/blog/payment-gateway-compliance-rbi-gst-requirements). There is also the **reverse charge question on Xflow's US-entity fees** (Xflow's own pricing page says "GST may apply via reverse charge" **[S]**). Similar import-of-service questions may apply to Payoneer or Wise fees billed from abroad.
5. **TDS/TCS.**
   - Is TDS deductible by you on gateway fees or MDR? **[3P]** The general position is no (http://taxbymanish.blogspot.com/2026/01/applicability-of-tds-on-interchange.html).
   - Does **s.194-O** (0.1% e-commerce operator TDS) apply to any aggregator settling to you? It is generally not applied to pure PAs; confirm.
   - Note that the **Income-tax Act, 2025 takes effect 1 Apr 2026** and renumbers TDS sections (for example to s.393). **[3P]** https://onefinops.com/blog/section-194-to-393-tds-mapping-guide-fy-2026-27
   - Confirm that TCS does not apply to inward export receipts.
6. **UPI MDR from 15 Oct 2026.** Confirm the merchant-category classification of a software services studio, and whether gateways' "platform fees" on UPI are permitted on top of MDR.
7. **FEMA realisation timelines.** Confirm export proceeds are realised within the RBI-permitted period (currently understood as 9 months for exports; confirm) and how partial payments map to invoices in EDPMS/SOFTEX. **SOFTEX filing** may apply to software exports; Xflow mentions SOFTEX support **[3P]**.
8. **Sole proprietorship name matching.** Confirm the trade name on the GST certificate matches the bank current account and the gateway KYC, so onboarding is not rejected.
9. **Splitting invoices above ₹25L / USD 10k caps.** Get advice on whether splitting is acceptable or whether direct bank SWIFT should be used for large contracts.
10. **Refunds of export receipts.** Refunding foreign currency receipts has FEMA and outward-remittance implications; confirm the process with the provider and your AD bank.

---

## Source quality caveats [I]
- Many 2026 fee comparisons come from **Xflow, Skydo and Winvesta blogs**, which are competitors with an incentive to frame rivals as expensive. Primary pages were fetched where possible:
  - Razorpay pricing and bank-transfers pages
  - Cashfree pricing and international pages
  - PayU pricing page
  - PayPal fees page
  - Xflow pricing page
  - Stripe help pages
  - NPCI MDR FAQ
  - Razorpay, Cashfree and PayU docs
  - SDK package.json files on GitHub
- Skydo's pricing page returned 404, so its fees are **[3P]**.
- The Razorpay pricing page as fetched may be a summarised or LLM-friendly rendering. Confirm exact figures in the dashboard or on the pricing annexure at signup.
