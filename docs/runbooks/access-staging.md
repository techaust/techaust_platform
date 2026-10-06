# Runbook: lock staging with Cloudflare Access (M1.4, owner checklist)

**Why:** from M1.4 the staging Workers start holding test logins and data. Cloudflare Access puts a sign-in page in front of them: only the people you allow can open them. It is free for up to 50 users.

**Owner decisions (2026-10-06):** only `admin@techaust.com` gets in; the jobs Worker gets Access too, with a bypass for webhook paths when they exist (M6); the CPU benchmark runs from an owner-only GitHub workflow using an Access **service token**.

**Who does what:** you click through the dashboard (I can't change Cloudflare settings). Nothing here touches DNS, `techaust.com` or the live Worker **`techaust-web`**. Do **not** enable Access on `techaust-web`.

Sources: Cloudflare changelog "One-click Cloudflare Access for Workers" (2025-10-03), "Reusable Access policies" (2025-12-03), "New Domains tab in the Workers dashboard" (2026-05-14).

---

## Part 1. Access on the four staging Workers (about 10 minutes)

Repeat for each of these Workers, and **only** these:
- `techaust-platform-web-staging`
- `techaust-platform-admin-staging`
- `techaust-platform-portal-staging`
- `techaust-platform-jobs-staging`

1. Open the Cloudflare dashboard → **Workers & Pages**, and select the Worker.
2. Open the **Domains** tab. (On older layouts it's **Settings → Domains & Routes**.)
3. Next to **workers.dev**, click **Enable Cloudflare Access**.
   - The first time, Cloudflare may ask you to set up **Zero Trust**: choose a team name (for example `techaust`) and the **Free** plan.
   - If it asks for a payment method, stop and tell me. The Free plan costs nothing, but adding a card is your call, and we have other options.
4. Click **Manage Cloudflare Access**, open the policy (named `<worker-name> - Production`) and check that it says:
   - Action: **Allow**
   - Include: **Emails** → `admin@techaust.com` (and nothing broader, such as "everyone")
   - Login method: **One-time PIN** (Cloudflare emails you a code)

   Save.
5. If Version URLs or Preview URLs show as enabled, **Disable** them. They are separate addresses that would otherwise skip Access. My next PR also turns them off in the config (`preview_urls: false`), so a deploy can't switch them back on.

**Check:** open each staging URL in a private browser window. You should see the Cloudflare Access sign-in page, not the site. Sign in with the emailed code, and the site opens.

| Worker | URL to test |
|---|---|
| web | https://techaust-platform-web-staging.techaust-technologies-153.workers.dev/ |
| admin | https://techaust-platform-admin-staging.techaust-technologies-153.workers.dev/ |
| portal | https://techaust-platform-portal-staging.techaust-technologies-153.workers.dev/ |
| jobs | https://techaust-platform-jobs-staging.techaust-technologies-153.workers.dev/healthz |

Then tell me "Access is on". I'll confirm from my side that every URL now answers with the Access sign-in (a redirect), not the app.

## Part 2. A service token for the CPU benchmark (about 5 minutes)

The benchmark sends 100+ automated test logins to the staging admin, and robots can't type a one-time PIN. A service token is a robot ID card that Access accepts for one application.

1. In the Zero Trust dashboard (**one.dash.cloudflare.com**), go to **Access → Service credentials → Service Tokens → Create Service Token**.
   - Name: `staging-cpu-benchmark`
   - Duration: **1 year** (or shorter if you prefer)
2. Copy the **Client ID** and **Client Secret** immediately (the secret is shown only once). **Don't paste them into this chat.**
3. Go to **Access → Applications**, open the admin staging application (`techaust-platform-admin-staging`), then **Policies → Add a policy**:
   - Name: `CPU benchmark (service token)`
   - Action: **Service Auth**
   - Include: **Service Token** → `staging-cpu-benchmark`

   Save. Keep your email policy as it is; the two work side by side.
4. Store the two values as GitHub secrets. Run these in a terminal in the project folder; each command asks you to paste the value:

```bash
gh secret set CF_ACCESS_BENCH_CLIENT_ID --repo techaust/techaust_platform
```

```bash
gh secret set CF_ACCESS_BENCH_CLIENT_SECRET --repo techaust/techaust_platform
```

The benchmark workflow (coming in the M1.4 PR) runs only when you press **Run workflow** in GitHub Actions, never on fork pull requests.

## Part 3. Login secrets for the staging admin (I'll tell you when)

After the M1.4 code is reviewed, you'll create four random secrets on the staging admin Worker. Each command generates a random value on your machine and hands it straight to Cloudflare, so nobody ever sees or types it. Run these from the `apps/admin` folder:

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put PASSWORD_PEPPER --env staging
```

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put SALT_PEPPER --env staging
```

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put TOTP_ENC_KEY --env staging
```

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put SESSION_HMAC_KEY --env staging
```

Production secrets are separate and come only in Phase 7.

## Later: webhook bypass on jobs (M6)

When the jobs Worker gets webhook routes (`/webhooks/razorpay`, `/webhooks/stripe`, `/webhooks/paypal`), payment providers must reach them without signing in. They are protected by signature checks instead. In M6 I'll give you the exact steps for a second Access application on those paths with a **Bypass** policy.
