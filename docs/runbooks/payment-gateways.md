# Runbook: payment gateway test accounts and keys (M6.2–M6.4)

For the owner. Sandbox and test keys only until the go-live step (Phase 7 L9; `PAYMENTS_LIVE_ALLOWED=false`). Never paste a key into chat, an email or a file: the script below reads it with hidden input and sends it straight to Cloudflare.

**Two parts:**
- **Part A, now:** create the three accounts, so sign-up and any business checks are out of the way. No keys are copied yet.
- **Part B, when each milestone starts** (M6.2 Razorpay, M6.3 Stripe, M6.4 PayPal): make the test keys and store them with one command the lead gives you then. The command names the Workers, which the milestone decides.

The webhook secrets (`RAZORPAY_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, `PAYPAL_WEBHOOK_ID`) come later still, inside each milestone. They need the webhook address, and staging sits behind Cloudflare Access, so each milestone first asks your yes for an Access exception on the webhook path.

Steps checked against each provider's own documentation on 2026-10-31. Screens change: if a label differs, look for the nearest match and tell the lead.

## Part A: create the accounts (about 30–60 minutes in all)

### Razorpay
1. Open https://dashboard.razorpay.com/signup and sign up with `admin@techaust.com` (or the email you want for billing), your mobile number and a password you keep in your password manager.
2. Razorpay asks about the business. Fill in what it asks; for test mode you don't need to finish activation (KYC). Razorpay's documentation says test keys can be made without adding a website. Live mode needs the website and checks that take up to 3 working days (that is Phase 7).
3. Find the mode switch in the top bar and choose **Test Mode**.
4. Go to **Account & Settings** › **API Keys** (under **Website and app settings**). Check the page opens. **Don't click Generate Key yet**: the secret is shown only once, so you make it in Part B straight into the script.
5. Tell the lead "Razorpay account ready".

### Stripe
TecHaust uses **your existing verified Stripe account** (the one for the same business on another domain; owner, 2026-10-31). Stripe accounts in India are invite-only, so a second account under the same login can't be activated (https://support.stripe.com/questions/stripe-accounts-are-invite-only-in-india); close the new TecHaust account you opened.
1. Sign in to https://dashboard.stripe.com with the existing account. Open **Settings** › **Business** › **Account details** and check that the legal name, PAN and GSTIN are TecHaust's. Tell the lead if any of them differ: that changes the plan.
2. Switch to the account's **sandbox** (a test area). Don't change the account's public website, and don't touch live mode: that is Phase 7.
3. Open https://dashboard.stripe.com/apikeys while the sandbox is selected and check the page opens. In M6.3 you make a **restricted key** (`rk_test_…`) there, straight into the script (Part B); the lead lists the permissions it needs.
4. Tell the lead "Stripe account ready".

What the lead builds around a shared account (M6.3): the webhook acts only on payments TecHaust itself created (anything else is recorded and ignored); the statement name customers see is checked before go-live; no payment-method domain needs registering, because Checkout is hosted by Stripe. Optional, before going live: ask Stripe's account team for a separate India account for TecHaust.

### PayPal
1. Open https://developer.paypal.com and click **Log in to Dashboard**. Sign in with a PayPal account, or create one (a business account in TecHaust's name is best, since the same login is used for live payments later).
2. Open **Apps & Credentials**. Check that the **Sandbox** view is selected (not Live).
3. Under **REST API apps**, check there is a **Default Application** (or click **Create App**, name it `TecHaust staging`, type **Merchant**). Its **Client ID** and **Secret** show on its page; nothing needs saving now.
4. Tell the lead "PayPal account ready".

## Part B: store the test keys (at the start of M6.2, M6.3, M6.4)

The lead gives you one line like this, with the Worker configs filled in:

```powershell
powershell -ExecutionPolicy Bypass -File "D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform\tools\set-gateway-keys.ps1" -Gateway razorpay -Configs "apps\jobs\wrangler.jsonc"
```

The script:
1. asks for each key with hidden input (nothing shows as you paste);
2. refuses anything that isn't a test key: Razorpay's key ID must start `rzp_test_`; Stripe's key must be a **restricted** test key starting `rk_test_` (an `sk_` key is refused, M6.3 L3); PayPal's pair must be accepted by PayPal's **sandbox** sign-in address;
3. asks the provider's test API once to prove the key works;
4. stores the values on the staging Workers named in the command (`wrangler secret put … --env staging`, using your own `wrangler login`);
5. prints one `RESULT:` line. Copy back **only that line**.

What to have open when you run it:
- **Razorpay:** Test Mode › **Account & Settings** › **API Keys** › **Generate Key** (or **Generate new key**). Paste the **Key Id** when asked, then the **Key Secret**. Close the dialog only after the script says `RESULT:`. If the secret is lost, generate a new key and run the script again.
- **Stripe (M6.3, H2):** https://dashboard.stripe.com/apikeys in the existing account's sandbox; **Create restricted key**, name `techaust-staging`, with exactly **Checkout Sessions: Write**, **PaymentIntents: Read**, **Charges: Read**, **Balance: Read**, and everything else **None** (Customers too). Copy it (`rk_test_…`) and run the script with `-Gateway stripe -Configs "apps\admin\wrangler.finance.jsonc"`. Besides `GET /v1/balance`, the script checks each permission (sessions, payment intents, charges, balance transactions), checks that **Customers is refused** (the key is really restricted), and makes then expires one USD 0.50 test session (marked `techaust-keycheck`, which the webhook ignores). A failed check prints `RESULT: FAILED … add "<permission>"`: edit the key in Stripe and run the script again.
- **Stripe webhook (M6.3, H3):** in the sandbox, **Workbench** › **Webhooks** › **Create an event destination** › **Your account** › payload **Snapshot** (not Thin) with API version **2026-09-30.endive** › events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` › **Webhook endpoint** › URL `https://techaust-platform-jobs-staging.techaust-technologies-153.workers.dev/stripe`. On the endpoint's page, **Reveal** the signing secret (`whsec_…`) and run the script with `-Gateway stripe-webhook -Configs "apps\jobs\wrangler.jsonc"`; paste it when asked. Its `RESULT:` line says it isn't checked with Stripe: the first test event proves it.
- **PayPal:** **Apps & Credentials** (Sandbox) › your app; copy the **Client ID**, then the **Secret**.

If a key was ever pasted anywhere else (chat, email, a document), treat it as exposed: make a new one and run the script again.
