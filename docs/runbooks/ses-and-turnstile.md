# Runbook: email (Amazon SES) and spam protection (Turnstile) for staging (M2.4, owner checklist)

**Why:** from M2.4 the website's contact and quote forms create leads and send two emails: a "we've received your request" email to the visitor and an alert to you. Amazon SES sends them; Cloudflare Turnstile keeps bots out of the forms.

**What this covers:** staging only. SES stays in its **sandbox**, so it can send only to addresses you have verified (your test inboxes) and at most 200 emails a day. Leaving the sandbox (production access), DMARC tightening and the production Turnstile widget come in Phase 7, with you.

**Never:**
- paste a secret key into the chat (the scripts below take them with hidden input)
- change or delete any existing DNS record of `techaust.com` (the Zoho mail records and the live site's records stay as they are)
- touch the live Worker **`techaust-web`**

**Order:** Parts 1–4 any time; Part 5 (the scripts) **before the M2.4 PR merges**, because the staging deploy fails while the Workers' new secrets are missing. I'll remind you.

Sources: AWS docs "Creating and verifying identities in Amazon SES", "Easy DKIM", "Using a custom MAIL FROM domain", "Moving out of the SES sandbox"; Cloudflare docs "Turnstile: get started", "Server-side validation". The screens' names can shift slightly; if one doesn't match, tell me what you see.

---

## Parts 1 and 2: ✅ done before M2.4 (lead check 2026-10-23)

You had already verified `techaust.com` in SES. Your custom MAIL FROM domain is **`noreply.techaust.com`** (not `mail.`, as the steps below assumed; the code doesn't depend on it). Public DNS lookups through Cloudflare's resolver on 2026-10-23 matched SES's three record files exactly:
- the three DKIM CNAMEs `…._domainkey.techaust.com` → `….dkim.amazonses.com` (DNS only, not proxied, as they must be)
- `noreply.techaust.com` MX `10 feedback-smtp.ap-south-1.amazonses.com` and TXT `v=spf1 include:amazonses.com ~all` (the `ap-south-1` in the MX shows the identity is in Mumbai)
- `_dmarc.techaust.com` `v=DMARC1; p=none; rua=…@dmarc-reports.cloudflare.net` (SES's minimum plus Cloudflare's DMARC reports; stays `p=none` until Phase 7)
- Zoho's MX and SPF on `techaust.com` are untouched. The old `amazonses:…` TXT on `techaust.com` is a leftover verification record from SES's older method: harmless, keep it.

The steps below are kept for reference (a second domain, or a rebuild).

## Part 1. SES: the sending domain (about 10 minutes, then a wait for DNS)

1. Sign in to **https://console.aws.amazon.com** with your AWS account (not a work-in-progress IAM user).
2. Top right, the region menu: choose **Asia Pacific (Mumbai) ap-south-1**. Everything below happens in this region.
3. In the search bar type **SES** and open **Amazon Simple Email Service**.
4. Left menu: **Configuration → Identities** → **Create identity**.
   - Identity type: **Domain**
   - Domain: `techaust.com`
   - Tick **Use a custom MAIL FROM domain**; MAIL FROM domain: `mail` (it shows `mail.techaust.com`); Behavior on MX failure: **Use default MAIL FROM domain**
   - **Verifying your domain** → Advanced DKIM settings: **Easy DKIM**, DKIM signing key length **RSA_2048_BIT**; leave **Publish DNS records to Route53** unticked (your DNS is at Cloudflare); **DKIM signatures** enabled
   - Click **Create identity**.
5. The identity page now lists DNS records: **three CNAME records** (DKIM) and, under **Custom MAIL FROM domain**, **one MX and one TXT record**. These are public values, not secrets.
6. **Stop here and send me a screenshot of those records** (or copy their Name/Type/Value into the chat). I check them against what we expect before anything is added to your DNS.

## Part 2. DNS records at Cloudflare (about 5 minutes; only after my check and your yes)

This adds five records to `techaust.com`. It changes nothing for your existing Zoho mail or the live site: the DKIM records have their own names (`…._domainkey`), and the MAIL FROM records sit on the new name `mail.techaust.com`.

1. First check that nothing named `mail` exists yet: Cloudflare dashboard → **techaust.com** → **DNS → Records**, search `mail`. If a record named exactly `mail.techaust.com` already exists, **stop and tell me**.
2. For each of the five records: **Add record**, choose the Type, paste the Name and the Value exactly as SES shows them, and:
   - CNAME records: **Proxy status off** (grey cloud, "DNS only"). This matters: a proxied DKIM record fails.
   - MX record: Mail server = the value SES shows (`feedback-smtp.ap-south-1.amazonses.com`), Priority **10**.
   - TXT record: the SPF value SES shows (`v=spf1 include:amazonses.com ~all`).
   - TTL: **Auto**. **Save**.
3. Back in the SES identity page, wait until **DKIM configuration** says **Successful** and the identity says **Verified** (usually under an hour; up to 72 hours). The MAIL FROM status should also turn **Successful**.

## Part 3. SES: the configuration set and your test inboxes (about 5 minutes)

**A. Configuration set** (groups the emails so we can track them later)
1. SES left menu: **Configuration → Configuration sets** → **Create set**.
2. Name: `techaust-transactional`. Leave the other settings as they are. **Create set**.

**B. Test inboxes** (the only addresses staging can email while SES is in the sandbox)
1. SES left menu: **Configuration → Identities** → **Create identity** → Identity type **Email address**.
2. Enter a test inbox you control, for example `admin@techaust.com`, and **Create identity**. Open that inbox and click the link in Amazon's email.
3. Repeat for each test inbox (two is enough, for example `admin@techaust.com` and a personal Gmail).
4. Tell me the verified addresses (an email address isn't a secret). They go into the staging setting `EMAIL_ALLOWED_RECIPIENTS`; staging refuses to email any other address.

## Part 4. AWS: a user that can only send email (about 10 minutes)

Workers can't sign in to AWS the modern way, so they need an access key. This user can do one thing only: send email from an `@techaust.com` address in Mumbai.

1. AWS search bar: **IAM** → left menu **Users** → **Create user**.
2. User name: `techaust-ses-sender-staging`. Leave **Provide user access to the AWS Management Console** unticked. **Next**.
3. Permissions options: **Attach policies directly** → **Create policy** (opens a new tab) → **JSON** tab → replace everything with:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendFromTechaustInMumbaiOnly",
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "*",
      "Condition": {
        "StringLike": { "ses:FromAddress": "*@techaust.com" },
        "StringEquals": { "aws:RequestedRegion": "ap-south-1" }
      }
    }
  ]
}
```

4. **Next** → Policy name `techaust-ses-send-only` → **Create policy**. Close that tab.
5. Back on the user tab: click the refresh button, search `techaust-ses-send-only`, tick it, **Next** → **Create user**.
6. Open the user → **Security credentials** tab → **Access keys** → **Create access key** → use case **Application running outside AWS** → **Next** → description `cloudflare-jobs-staging` → **Create access key**.
7. The page shows an **Access key** (starts with `AKIA`) and a **Secret access key** (shown **only once**). **Keep this page open** and go to Part 5 B. **Don't paste either into the chat.**

The key is rotated every 90 days (08); I'll remind you.

## Part 5. Store the secrets on the staging Workers (about 5 minutes; before the M2.4 PR merges)

Both scripts take values with hidden input or make them on your PC, hand them straight to Cloudflare, and print one line starting with `RESULT:`. Copy back **only that line**.

**A. Turnstile widget and the website's two secrets**
1. Cloudflare dashboard → the **Techaust Technologies** account → left menu **Turnstile** (under Application security, or search "Turnstile") → **Add widget**.
   - Widget name: `techaust-staging-forms`
   - Hostname management → **Add hostnames**: `techaust-platform-web-staging.techaust-technologies-153.workers.dev` (only this one)
   - Widget mode: **Managed**
   - Pre-clearance: **No**
   - **Create**.
2. The page shows a **Site Key** (public: send it to me in the chat, it goes into the code) and a **Secret Key** (keep the page open; **don't paste it into the chat**).
3. Press the **Windows key**, type `powershell`, open **Windows PowerShell**, paste this line and press **Enter**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform\.logs\owner\m2.4-web-secrets.ps1"
```

4. It asks for the Turnstile **Secret Key**: copy it from the Cloudflare page and paste it (the typing stays hidden), **Enter**. It also makes a random `FORMS_IP_PEPPER` (used to hash visitors' addresses) by itself.
5. Copy back the `RESULT:` line.

**B. The SES sending key for the jobs Worker**
1. In PowerShell, paste this line and press **Enter**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform\.logs\owner\m2.4-ses-keys.ps1"
```

2. It asks for the **Access key** (`AKIA…`), then the **Secret access key**: copy each from the AWS page and paste it, **Enter**.
3. Copy back the `RESULT:` line. You can then close the AWS page.

If a result says you are not logged in to Cloudflare, run these two lines one at a time (a browser window opens; approve it), then the script again:

```powershell
cd "D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform\apps\jobs"
```

```powershell
node .\node_modules\wrangler\bin\wrangler.js login
```

## Part 6. The test on staging (after the merge)

1. Open the staging website (Cloudflare Access asks you to sign in, as usual), go to **Contact**, and send a message from one of your verified inboxes.
2. Do the same on **Get a quote**.
3. Each time: the thank-you page shows a reference like `L-7K3Q9`; within a minute your inbox gets the acknowledgement and `LEAD_ALERT_TO` gets the alert. Tell me what arrived; I check the lead rows and the email log on staging.

## Later (Phase 7, with you)
- **SES production access** (AWS → SES → Account dashboard → **Request production access**), so the visitor's acknowledgement reaches any address.
- A production IAM user and key, the production Turnstile widget on `techaust.com`, and the production queue.
- DMARC: check the existing `_dmarc.techaust.com` record, then move from `p=none` to `quarantine` after a few weeks of clean reports.

## Part 7. Let the email logo through Access on staging (owner decision 2026-10-23; about 3 minutes)

The emails load the logo from `https://techaust-platform-web-staging.techaust-technologies-153.workers.dev/brand/…`. Email apps can't sign in to Access, so this one folder (public logo files only) gets a **Bypass**; everything else on staging stays locked.

1. Open **https://one.dash.cloudflare.com** and pick the **Techaust Technologies** account.
2. Left menu: **Access controls → Applications** → **Add an application** → **Self-hosted**.
3. Application name: `web-staging public logos`.
4. **Add public hostname** (or "Destination"): choose the domain `techaust-platform-web-staging.techaust-technologies-153.workers.dev` (if it's offered as a subdomain + domain pair, pick `techaust-technologies-153.workers.dev` as the domain and type `techaust-platform-web-staging` as the subdomain), and in **Path** type `brand/*`. If the workers.dev name can't be chosen at all, stop and tell me.
5. **Access policies** → **Create new policy**: name `Public logos`, Action **Bypass**, Include selector **Everyone**. Save the policy and make sure it's the only policy on this application.
6. Leave session settings as they are; **Save** the application.
7. Check: open a private browser window at `https://techaust-platform-web-staging.techaust-technologies-153.workers.dev/brand/logo-email-light.png`. Before the M2.4 deploy it shows a "not found" page (not the Access sign-in); after the deploy, the logo. The home page in the same private window must still show the Access sign-in.
