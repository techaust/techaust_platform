# Runbook: lock staging with Cloudflare Access (M1.4, owner checklist)

**Why:** from M1.4 the staging Workers start holding test logins and data. Cloudflare Access puts a sign-in page in front of them: only the people you allow can open them. It is free for up to 50 users.

**Owner decisions (2026-10-06, 2026-10-17):** only you get in (the "Cloudflare account" policy; you are the only account member); the jobs Worker gets Access too, with a bypass for webhook paths when they exist (M6); the CPU benchmark runs from an owner-only GitHub workflow using an Access **service token**.

**Never:**
- turn on Access for the live Worker **`techaust-web`**
- use the account-level **"Protect all Workers"** card (it would cover `techaust-web` too)
- touch DNS or `techaust.com`

**Already in the M1.4 PR:** every staging Worker has `preview_urls: false` in its config, so a deploy can't switch Preview URLs back on; and the workflow **Actions → Auth CPU benchmark (staging)** is added.

Sources (checked 2026-10-17): Cloudflare docs "Service tokens", "Policies" (Service Auth), "Strict service token authentication" (changelog 2026-10-02).

---

## Part 1. Access on the four staging Workers ✅ done 2026-10-17

Done by you for these four Workers only: `techaust-platform-web-staging`, `techaust-platform-admin-staging`, `techaust-platform-portal-staging`, `techaust-platform-jobs-staging`.

For each one:
1. Cloudflare dashboard → **Workers & Pages** → the Worker → the **Access** tab.
2. Protect **All traffic**, with the policy **Cloudflare account**. Zero Trust plan: **Free**.
3. **Domains** tab → **Preview URLs** off.

**Lead check (2026-10-17):** every staging URL answers 302 to the Access login at `orange-bread-211d.cloudflareaccess.com`.

| Worker | URL |
|---|---|
| web | https://techaust-platform-web-staging.techaust-technologies-153.workers.dev/ |
| admin | https://techaust-platform-admin-staging.techaust-technologies-153.workers.dev/ |
| portal | https://techaust-platform-portal-staging.techaust-technologies-153.workers.dev/ |
| jobs | https://techaust-platform-jobs-staging.techaust-technologies-153.workers.dev/healthz |

**Careful:** the "Cloudflare account" policy lets in **every member of your Cloudflare account**. Before you add anyone to the account, tell me: we switch the policy to an **Emails** rule (`admin@techaust.com`) first.

## Part 3. Login secrets for the staging admin (about 3 minutes; do this first, before the PR merges)

The staging admin Worker needs four random secrets. The deploy **fails without them**, so this comes before the merge. A script makes each value on your PC and hands it straight to Cloudflare: nobody sees or types it.

1. Press the **Windows key**, type `powershell`, and open **Windows PowerShell**.
2. Paste this line and press **Enter**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform\.logs\owner\staging-login-secrets.ps1"
```

3. When it finishes, copy back to me **only the line that starts with `RESULT:`**.

If the result says you are not logged in to Cloudflare, run these two lines one at a time (a browser window opens; approve it), then run step 2 again:

```powershell
cd "D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform\apps\admin"
```

```powershell
node .\node_modules\wrangler\bin\wrangler.js login
```

Production secrets are separate and come only in Phase 7.

## Part 2. A service token for the CPU benchmark (about 10 minutes; before the benchmark run)

The benchmark sends 100+ automated test logins to the staging admin, and a robot can't type a one-time PIN. A service token is a robot ID card that Access accepts for one application.

**A. Create the token**
1. Open **https://one.dash.cloudflare.com** and pick the **Techaust Technologies** account.
2. In the left menu: **Access controls → Service credentials → Service Tokens**. (Older layout: **Access → Service Auth → Service Tokens**.)
3. Click **Create Service Token**.
   - Name: `staging-cpu-benchmark`
   - Service Token Duration: **1 year**
4. Click **Generate token**. The page shows a **Client ID** (ends in `.access`) and a **Client Secret** (starts with `cfast_`). The secret is shown **only once**: keep this page open. **Don't paste either value into this chat.**

**B. Store them in GitHub**
1. In PowerShell, paste this line and press **Enter**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform\.logs\owner\set-bench-token.ps1"
```

2. It asks for the Client ID, then the Client Secret: copy each from the Cloudflare page and paste it (the typing stays hidden), then press **Enter**.
3. Copy back to me **only the `RESULT:` line**.

**C. Let the token into the admin app only**
1. Back on one.dash.cloudflare.com: **Access controls → Applications**.
2. Open the application for **`techaust-platform-admin-staging`** (its name or domain contains `admin-staging`) and click **Configure** (or **Edit**) → the **Policies** tab.
3. Add a policy (**Add a policy** or **Create new policy**):
   - Policy name: `CPU benchmark (service token)`
   - Action: **Service Auth**
   - Include: Selector **Service Token**, Value `staging-cpu-benchmark`
4. Save the policy. If it was created separately, make sure it is in the application's **Access policies** list, then **Save** the application.
5. Keep the **Cloudflare account** policy as it is: the two work side by side. Don't add the token to the other three Workers.

Your Zero Trust account is new, so **strict service token authentication** is on (Cloudflare's default since 2026-10-05): a refused token gets a 401/403 instead of the sign-in page. The benchmark script reports that as "Cloudflare Access refused the service token".

The workflow runs only when you press **Run workflow** in GitHub Actions, only for the `techaust` account, and never on fork pull requests.

## Part 4. A service token for the deploy health checks (about 10 minutes; before the workflow PR merges)

After each staging deploy, the workflow asks every Worker "are you healthy?" (full audit A6 8, owner 2026-10-30). Staging sits behind Access, so the check needs its own robot ID card that all four staging apps accept.

**A. Create the token**
1. Open **https://one.dash.cloudflare.com** and pick the **Techaust Technologies** account.
2. In the left menu: **Access controls → Service credentials → Service Tokens**. (Older layout: **Access → Service Auth → Service Tokens**.)
3. Click **Create Service Token**. Name: `staging-deploy-check`. Service Token Duration: **1 year**.
4. Click **Generate token**. Keep the page open: the Client Secret is shown only once. **Don't paste either value into the chat.**

**B. Store it in GitHub**
1. In PowerShell, paste this line and press **Enter**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform\.logs\owner\set-deploy-token.ps1"
```

2. Paste the Client ID, then the Client Secret (the typing stays hidden), pressing **Enter** after each.
3. Copy back to the lead **only the `RESULT:` line**.

**C. Let the token into all four staging apps**
For each application (**admin-staging, portal-staging, jobs-staging, web-staging**): **Access controls → Applications**, open it, **Configure** (or **Edit**) → **Policies** → **Add a policy**: name `Deploy check (service token)`, Action **Service Auth**, Include Selector **Service Token**, Value `staging-deploy-check`. Save, check the policy is in the application's **Access policies** list, and **Save** the application. Keep the existing sign-in policy as it is.

## Later: webhook bypass on jobs (M6)

When the jobs Worker gets its webhook routes (`/razorpay`, `/stripe`, `/paypal`, `/ses`), the providers must reach them without signing in; signature checks protect them instead. In M6 I'll give you the exact steps for a **Bypass** policy on those paths.
