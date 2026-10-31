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
1. Open https://dashboard.stripe.com/register and sign up with your email, name, country (India) and a password from your password manager.
2. Stripe opens in a **sandbox** (a test area). Don't activate payments or add bank details: that is Phase 7.
3. Open https://dashboard.stripe.com/apikeys while the sandbox is selected. Check you see a **Publishable key** starting `pk_test_` and a **Secret key** starting `sk_test_`. Sandbox keys can be revealed again at any time, so nothing needs saving now.
4. Tell the lead "Stripe account ready".

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
2. refuses anything that isn't a test key: Razorpay's key ID must start `rzp_test_`; Stripe's key must start `sk_test_` or `rk_test_`; PayPal's pair must be accepted by PayPal's **sandbox** sign-in address;
3. asks the provider's test API once to prove the key works;
4. stores the values on the staging Workers named in the command (`wrangler secret put … --env staging`, using your own `wrangler login`);
5. prints one `RESULT:` line. Copy back **only that line**.

What to have open when you run it:
- **Razorpay:** Test Mode › **Account & Settings** › **API Keys** › **Generate Key** (or **Generate new key**). Paste the **Key Id** when asked, then the **Key Secret**. Close the dialog only after the script says `RESULT:`. If the secret is lost, generate a new key and run the script again.
- **Stripe:** https://dashboard.stripe.com/apikeys in the sandbox; reveal and copy the **Secret key** (`sk_test_…`).
- **PayPal:** **Apps & Credentials** (Sandbox) › your app; copy the **Client ID**, then the **Secret**.

If a key was ever pasted anywhere else (chat, email, a document), treat it as exposed: make a new one and run the script again.
