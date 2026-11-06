# Runbook: security incident (docs/08 §5)

_Draft by analyst R, 2026-11-07, for the lead to finalise. Read from the code at M7.5's base (fea31a76). Anything marked **unverified** was not checked against its source._

Every command runs in **PowerShell** from any folder, because it names the repository folder in full. The lead runs the commands. The owner says yes to each hosted action (CLAUDE.md rule 4) and does the steps marked **Owner**. **Staging only until Phase 7:** production has no D1, queues, buckets or secrets yet. Each production line below works only after Phase 7 L3.

## Who does what
| Who | Does |
|---|---|
| Owner | Decides; signs in to Cloudflare, AWS, GitHub, Razorpay, Stripe and PayPal; runs the secret scripts; sends the CERT-In report and the Board intimation in their own name (rule 8); signs the notices |
| Lead | Keeps the internal log (template T5); prepares every command and the owner's click steps; runs the D1 and rollback commands with the owner's yes; exports the evidence; drafts the notices (T1–T4) |

## Step 0. Start the clock (first 10 minutes)
1. Open the internal log (T5). Write the **time anyone first noticed** (IST and UTC). The CERT-In 6 hours run from that moment (Researched 2026-10-28, CERT-In Directions 2022 direction (ii) (08-C RB-15)).
2. Save the database's current bookmark. It costs nothing and marks the state at detection for 7 days (Free plan, Cloudflare Time Travel page, read 2026-11-07). The output line starting "The current bookmark is" goes in T5.
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 time-travel info DB --env staging
```
3. Workers Logs keep **3 days** and traces **7 days** (Free plan; Workers Logs page read 2026-11-07, traces per cpu-baseline.md read 2026-10-30). Export the logs you need in step 3 today, not later.

## Step 1. Detect: what raises an incident here
- Bells and emails: the lockout alert, "new device", a 2FA change, the unfinished sign-in alert (M7.2), the `email.erased_skip` bell, dead-letter bells, "Needs review" items that aren't explained, a `job.failed` bell.
- Workers Logs lines:
  - `"pdf object missing"` (`apps/admin/worker/document-pdf.ts:76`);
  - `"r2 object missing"` (`files.ts:345`, `docs-upload.ts:185`);
  - `forms.pepper_invalid` (`apps/web/src/forms.ts:173`);
  - any `exceededCpu` or `exception` outcome.
- An unexpected row in the Audit log (admin › **Audit log**), a client's report, a provider's email (Razorpay, Stripe, PayPal, AWS, GitHub, Cloudflare).
- Sentry and uptime alerts come at Phase 7.

## Step 2. Contain (immediately)

### 2.1 Sign out every staff member
**Owner, in the admin:**
1. Open **Users**.
2. Open the **More** menu, choose **Sign out everyone except you**, then confirm with a fresh authenticator code. This is `POST /api/v1/users/sessions/revoke-all` (Owner, step-up; audit `user.sessions_revoke_all`; `users.ts:210-224`).
3. Open **Your account** and choose **Sign out everywhere** (this browser included; `account.ts:164-179`).

**If the admin can't be used** (the lead, with the owner's yes):
1. Write this into `.logs\incident\staff-signout.sql`. Put a fresh UUID in place of `<uuid>` (PowerShell: `[guid]::NewGuid()`) and the internal log's reference in place of `<ref>`:
```sql
UPDATE staff_sessions SET revoked_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE revoked_at IS NULL;
INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) VALUES ('<uuid>', 'system', NULL, 'user.sessions_revoke_all', 'staff_user', NULL, '{"via":"cli","incident":"<ref>"}');
```
2. Run it:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 execute DB --remote --env staging --file "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\.logs\incident\staff-signout.sql"
```
Every check reads `revoked_at IS NULL` (for example `packages/db/src/ledger.ts:60`), so a revoked session ends at its next request.

### 2.2 Sign out every client
There is no staff route that ends every client's sessions. The portal's own `/auth/sessions/revoke-all` ends only the caller's. Removing one contact's portal access ends that contact's sessions (`packages/db/src/contact-access.ts:45`).

For everyone (the lead, with the owner's yes):
1. Write this into `.logs\incident\portal-signout.sql`:
```sql
UPDATE client_sessions SET revoked_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE revoked_at IS NULL;
UPDATE magic_link_tokens SET used_at = CAST(strftime('%s','now') AS INTEGER) * 1000 WHERE used_at IS NULL AND expires_at > CAST(strftime('%s','now') AS INTEGER) * 1000;
INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) VALUES ('<uuid>', 'system', NULL, 'portal.sessions_revoke_all', 'client_session', NULL, '{"via":"cli","incident":"<ref>"}');
```
2. Run it:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 execute DB --remote --env staging --file "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\.logs\incident\portal-signout.sql"
```
Notes:
- The trigger `client_sessions_revoked_once` only stops a second revocation, so the `WHERE` above passes it.
- No trigger on `magic_link_tokens` was found. Sign-in links die by themselves within 15 minutes anyway.
- **Run the file once against a local database first** (`--local --persist-to "…\.wrangler\state"`). It has not been run anywhere yet.

**Only if emailed links leaked** (`doc_access_tokens`, `offer_links`): use admin › the document › **Revoke links**, per document. Revoking them all by SQL also pauses reminders and stops clients paying through their emailed links (CLAUDE.md M5.4), so it is the owner's decision.

### 2.3 Rotate the affected secrets
Read the "Breaks" column before rotating anything. A `wrangler secret put` **deploys a new version at once** (Cloudflare secrets page). The staging Worker names add `-staging`; production drops it.

| Secret | Worker(s) and `--config` (from `apps/<app>`) | Value | What a new value breaks (from the code) | How |
|---|---|---|---|---|
| `PASSWORD_PEPPER` | admin front (`apps/admin/wrangler.jsonc`) | base64 of 32 random bytes (`keyBytes`, `crypto.ts:38`) | **Every staff password stops verifying: nobody can sign in.** Each member is reset with break-glass (below) | **Never routinely.** Only with a suspected copy of the database and this key |
| `SALT_PEPPER` | admin front | base64, 32 bytes | (a) Unknown emails get new fake salts, so someone who saved one can tell it was fake. (b) Per-address sign-in locks (`ip:` keys, `lockout.ts:102`) restart. (c) An invite between "start" and "finish" yields an account whose password never matches; reset that member | Script (to be written, F1) |
| `TOTP_ENC_KEY` | admin front | base64, first 32 bytes used | **Every stored authenticator secret can't be opened.** Code sign-in and step-up fail for every member (decrypt throws, `crypto.ts:89-97`). Recovery codes still sign in, but nothing needing step-up works. **No re-encryption script exists** (08 §4 assumes one) | **Do not rotate** until the re-encrypt script exists (F2). If the database and this key are both exposed, rotate and re-enrol everyone with break-glass |
| `SESSION_HMAC_KEY` | admin front | base64, 32 bytes | Sign-ins in their 5-minute code step and enrolments in their 10-minute step fail; the person starts again (invitees reopen their link). Sessions aren't touched (random tokens, SHA-256) | Script (F1) |
| `TURNSTILE_SECRET` | web (widget `techaust-staging-forms`); admin front and portal (widget `techaust-staging-signin`, shared) | Turnstile dashboard › the widget › rotate the secret (label and grace period unverified) | Until every Worker of that widget holds the new secret: the web forms fail, the portal refuses every link request (400 `turnstile_failed`), and admin refuses sign-in after 3 failures | Script, paste mode (F1); store on each Worker of the widget straight away |
| `PORTAL_KEY_PEPPER` | portal (`apps/portal/wrangler.jsonc`) | base64, 32 bytes | Only the counters restart (`p:req:`, `p:mail:`, `p:fail:`, `p:pay:`); a locked address is unlocked | `tools/set-portal-pepper.ps1` (staging only) |
| `FORMS_IP_PEPPER` | web (`apps/web/wrangler.jsonc`) | base64, 32 bytes | The per-address form counters restart. New leads and consent receipts carry a different `ip_hash` for the same address (no link across the rotation) | Script (F1) |
| `ERASURE_HASH_KEY` | admin API (`wrangler.api.jsonc`) **and** jobs, same value | hex | **People erased before could be emailed again** (environments.md "Losing or changing the key") | **Never by re-running** `scripts/set-erasure-hash-key.ps1`. A change is its own task |
| `UNSUBSCRIBE_KEY` | jobs | hex | One-click links in digests already sent stop working (no `_PREVIOUS`, `apps/jobs/src/unsubscribe.ts`). Owners can switch the digest off in **Your account › Notifications** | `tools/set-gateway-keys.ps1 -Gateway unsubscribe-key -Configs "apps\jobs\wrangler.jsonc"` |
| `SES_EVENTS_TOKEN` | jobs + the EventBridge connection | hex | SES events are refused until both sides match. EventBridge retries for up to 24 h (m7.2 run file). `SES_EVENTS_TOKEN_PREVIOUS` allows an overlap, but no script sets it (F3) | `-Gateway ses-events` (on the clipboard), then paste it into the connection's API key value at once |
| `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY` | jobs | from AWS IAM | See 2.5 | ses-and-turnstile.md Part 8; **its script is missing** (F4) |
| Gateway keys and webhook secrets | See 2.4 | | | `tools/set-gateway-keys.ps1` |

**The owner's line for the existing scripts** (staging; paste in PowerShell, copy back only the `RESULT:` line):
```
powershell -ExecutionPolicy Bypass -File "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\tools\set-portal-pepper.ps1"
```
```
powershell -ExecutionPolicy Bypass -File "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform\tools\set-gateway-keys.ps1" -Gateway unsubscribe-key -Configs "apps\jobs\wrangler.jsonc"
```

**Until script F1 exists**, the lead can store a value with wrangler's own prompt. Wrangler 4.156.2 hides what is typed (`prompt(…, { isSecret: true })`). It needs a random value the owner can't easily make, so F1 should be built before Phase 7. The form, for each Worker:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/admin exec wrangler secret put SESSION_HMAC_KEY --config wrangler.jsonc --env staging
```
- The other admin Workers use the same form with `--config wrangler.api.jsonc`, `wrangler.finance.jsonc` or `wrangler.invoices.jsonc`.
- For portal, web and jobs, use their own `--filter` (`@techaust/portal`, `@techaust/web`, `@techaust/jobs`) and drop `--config`.
- The front's `--config wrangler.jsonc --env staging` form is the same mechanism the scripts already use for finance and the API, but it hasn't been run on the front (**unverified**).

**Break-glass after a `PASSWORD_PEPPER` (or `TOTP_ENC_KEY`) rotation** (docs/08 §3.2). For each member but the only owner:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" admin:reset-2fa --email <member's email> --staging
```
For the only active owner (a one-time owner invite to a second address; then reset the lost account from **Users**):
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" admin:reset-2fa --email <owner's email> --new-email <second address> --staging
```
The script sends no email. Tell each member by hand. It has no production mode yet (F5).

### 2.4 Payment gateways (test keys until Phase 7 L9)
Labels in the providers' dashboards are **unverified**. If one differs, look for the nearest match and tell the lead.

| Key | Where it lives | Owner's steps | Store with |
|---|---|---|---|
| Razorpay Key Id and Secret | admin finance | Razorpay › Test Mode › Account & Settings › API Keys › **Regenerate** | `-Gateway razorpay -Configs "apps\admin\wrangler.finance.jsonc"` |
| `RAZORPAY_WEBHOOK_SECRET` | jobs | The script makes it and puts it on the clipboard; paste it at once into Razorpay › Webhooks › the staging webhook › **Secret** | `-Gateway razorpay-webhook -Configs "apps\jobs\wrangler.jsonc"` |
| `STRIPE_SECRET_KEY` (restricted `rk_test_`) | admin finance | Stripe sandbox › API keys › the restricted key › roll it, ending the old key now | `-Gateway stripe -Configs "apps\admin\wrangler.finance.jsonc"` |
| `STRIPE_WEBHOOK_SECRET` | jobs | Workbench › Webhooks › the staging endpoint › roll the signing secret, ending the old one now; **Reveal** the new `whsec_` | `-Gateway stripe-webhook -Configs "apps\jobs\wrangler.jsonc"` |
| PayPal Client ID and Secret | admin finance | developer.paypal.com › Apps & Credentials (Sandbox) › the app › make a new secret, disable the old | `-Gateway paypal -Configs "apps\admin\wrangler.finance.jsonc"` |
| `PAYPAL_WEBHOOK_ID` | jobs | An identifier, not a credential. If the webhook itself is suspect, delete it, make it again, then store the new ID | `-Gateway paypal-webhook -Configs "apps\jobs\wrangler.jsonc"` |

- Between storing a new webhook secret and pasting it at the provider, real events are refused.
- Nothing is lost: every money write re-fetches from the gateway, and the sweeps and "Check now" read the checkouts again (CLAUDE.md M6.2–M6.4).
- Afterwards, open **Payments › Needs review**.
- The `_PREVIOUS` names (`RAZORPAY_WEBHOOK_SECRET_PREVIOUS`, `STRIPE_WEBHOOK_SECRET_PREVIOUS`) are for a planned overlap only. Never keep a compromised value there.

### 2.5 Amazon SES
Follow `docs/runbooks/ses-and-turnstile.md` Part 8 with two changes for an incident:
- In D, deactivate the old key **straight after** the check, not the next day.
- If the AWS sign-in itself is suspect, the owner also checks IAM › Users for unknown keys or users and CloudTrail › Event history (labels unverified).

**The Part 8 B script (`.logs\owner\m2.4-ses-keys.ps1`) no longer exists on this PC (F4).** Until it is rewritten, the lead stores the two values with wrangler's hidden prompt (form above, `--filter @techaust/jobs`, `SES_ACCESS_KEY_ID` then `SES_SECRET_ACCESS_KEY`). Expect one failed email in the seconds between them (Part 8's note).

### 2.6 GitHub, Cloudflare and Access tokens (labels unverified)
- **`CF_API_TOKEN_STAGING`** (GitHub secret):
  1. Cloudflare › My Profile › API Tokens › the token › **Roll**.
  2. Store the new value:
```
gh secret set CF_API_TOKEN_STAGING --repo techaust/techaust_platform
```
  `gh` asks for the value. Whether it hides the typing is **unverified**, so prefer a hidden-input script (F1 covers `gh secret set` too).
- **Access service tokens** `staging-deploy-check` (`CF_ACCESS_DEPLOY_CLIENT_ID`/`_SECRET`) and the benchmark token (`CF_ACCESS_BENCH_*`): Zero Trust › Access › Service credentials › the token › refresh or rotate. Then store both values with `gh secret set` as above.
- **`CF_ANALYTICS_TOKEN`** (jobs secret, after Q4): roll it in Cloudflare › API Tokens. Then `wrangler secret put CF_ANALYTICS_TOKEN` on jobs (form above).
- **The owner's own sign-ins:**
  - Cloudflare: Manage Account › Audit Log; revoke unknown API tokens.
  - GitHub: Settings › Sessions, Security log, Personal access tokens; check repo Settings › Branches (`main` protection) and Actions secrets.
  - `wrangler logout` then `wrangler login` on this PC (from `apps\jobs`).
- **`BUILD_SNAPSHOT_TOKEN`** is listed in 08 §4 but used nowhere today. Nothing to rotate; remove the row (F6).

### 2.7 Take something offline
**No feature-flag kill switch exists** (no such var in any `wrangler*.jsonc`). The levers that do exist:
1. roll the Worker back (2.8);
2. deploy a fix that removes the route (normal PR; held if needed);
3. Cloudflare Access in front of a host (staging already has it; production at Phase 7);
4. for payments, keep `PAYMENTS_LIVE_ALLOWED` "false" and switch a gateway off in **Settings › Gateways** (exact effect per gateway unverified).

A kill switch is a follow-up proposal (F7).

### 2.8 Roll a Worker back
1. See the versions:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler deployments list --name techaust-platform-jobs-staging
```
2. Roll back to the previous version. Without a version ID, wrangler picks "the latest stable Worker Version"; it asks for a message, then for confirmation:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler rollback --name techaust-platform-jobs-staging -m "incident <ref>"
```
Use the same form for the other Workers:
- admin, from `--filter @techaust/admin`: `techaust-platform-admin-staging`, `-admin-api-staging`, `-admin-invoices-staging`, `-admin-finance-staging`;
- portal: `techaust-platform-portal-staging`;
- web: `techaust-platform-web-staging`;
- production names drop `-staging`.

Dashboard alternative: Workers & Pages › the Worker › **Deployments** › ⋯ on the version › **Rollback**.

Rules:
- **Order.**
  - To undo the fourth admin Worker's split: **admin finance first, then jobs, then the admin front; leave invoices and the API** (owner Q2 A, 2026-11-02; environments.md).
  - Any other release (analyst's proposal; the lead checks the release's run file): roll back only the Workers that release changed, in the **reverse of the deploy order**. That is web, jobs, portal, admin front, admin finance, admin invoices, admin API, from the M6.5 order. Each Worker deploys after the Workers it binds, so callers go back first.
- **Data is never rolled back** (Cloudflare rollbacks page: "Resources connected to your Worker will not be changed"). Migrations are backward-compatible (05 §5.5).
- **Secrets (unverified):** wrangler asks you to confirm when "secrets have changed since version X". The older version may carry the **old secret values**. After rotating a compromised secret, don't roll back past the rotation. If you must, rotate again straight after.
- Only the 100 most recent versions can be rolled back to.
- Then run the health checks: `node scripts/staging-health.mjs admin` (and `jobs`, `portal`, `web`) with the deploy-check token.

## Step 3. Assess and keep the evidence (within hours)
Save everything in the evidence folder (question QA). It holds IP addresses: never commit it. Keep it as long as the security log (13 months, owner 2026-10-21).

1. `audit_log` and `access_log`, the whole tables. **The database is unavailable while a remote export runs** (wrangler's prompt), so expect a short pause.
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 export DB --remote --env staging --table audit_log --table access_log --output "<evidence folder>\logs-<date>.sql"
```
2. A whole-database copy at detection:
```
pnpm --dir "D:\Business\1. Parent Project\TecHaust Technologies\Application\techaust_platform" --filter @techaust/jobs exec wrangler d1 export DB --remote --env staging --output "<evidence folder>\db-<date>.sql"
```
3. A time window without blocking (rows read count against the day's 5,000,000):
   - `audit_log` has an index on `at` (`… --command "SELECT * FROM audit_log WHERE at >= <ms> ORDER BY at" --json`).
   - `access_log` has no index on `at`. Filter on its UUIDv7 `id`: `WHERE id >= '<12 hex digits of the start time in ms, as tttttttt-tttt>-0000-0000-000000000000'`. A real id at the same millisecond sorts after it, because its version digit is 7.
   - Save the output with `| Out-File -Encoding utf8 "<file>"`. Windows PowerShell's `>` writes UTF-16.
4. The admin's own export: **Audit log › Export CSV** (Owner, fresh code; each page audited `audit.export`).
5. Workers Logs (3 days) and traces (7 days): the lead queries them read-only through the Cloudflare MCP server and saves the results. Also save the Cloudflare account Audit Log, GitHub's security log and, for AWS, CloudTrail.
6. Write down: what data, whose (clients, contacts, staff), how many people, since when, how it got in, what is still exposed.

## Step 4. A missing R2 object (13 2026-10-30: an incident, not a view question)
`DOCS` and `FILES` are write-once. A key the database names with no object behind it means storage loss or deletion.

1. **Find it:**
   - Workers Logs `"pdf object missing"` (proposal and estimate PDFs) or `"r2 object missing"` (vault files, signed uploads);
   - staff see "PDF pending" (409) on a document whose PDF was made;
   - other routes answer 404 or 409 without a named log line (not checked one by one).
2. **Confirm:** Cloudflare › R2 › `techaust-staging-docs` (or `-files`) › Objects, search the key from the row (`documents.pdf_r2_key`, `files.r2_key`).
3. **Rule out the expected deletions:**
   - a redacted offer (`documents.redacted_at` set, audit `document.redact`);
   - a statement PDF past its 30 days (`statement.purge`);
   - a vault file deleted with its row (the M7.4 outbox);
   - an erased client's objects.
   Anything else is unexplained: treat it as an incident from step 2.
4. **How far does it go?**
   - Compare the bucket's object count (R2 › bucket › **Metrics**) with `SELECT count(*) FROM documents WHERE pdf_sha256 IS NOT NULL` (one PDF per row, plus envelopes and supplier copies).
   - Check the R2 operations metrics for deletes (`r2OperationsAdaptiveGroups`, `actionType`).
5. **Restore:**
   - **No automatic path exists when the row already has `pdf_sha256`.** "Retry" answers 409 `pdf_done` (`document-pdf.ts:101`). `pdf.render` returns "done" (`apps/jobs/src/pdf.ts:199`). The sweep only takes rows without a PDF (`pdf.ts:791`).
   - Until the R2 copy to S3 exists (N8, Phase 7), the bytes can't be restored.
   - A rebuilt PDF must be rendered from the sealed envelope and checked against the stored hash. That is a Tier A builder task, not a hand fix.
   - For the invoice family, the stored **DUPLICATE FOR SUPPLIER** copy (`-supplier.pdf`) shows what the client's page said.
6. **Is it a personal-data breach?** DPDP s.2(u) counts "loss of access to personal data". This is not an 08-C row and is **unverified**; the safest reading treats it as one from 13 May 2027.

## Step 5. Report

| Duty | When | Who | Basis |
|---|---|---|---|
| CERT-In report | **Within 6 hours** of noticing | Owner sends; lead drafts T3 | Researched 2026-10-28, CERT-In Directions 2022 direction (ii) (08-C RB-15). A proprietorship is covered: Settled by the lead on the safest reading, 2026-10-30 (08-C RB-14). The report form, channel and the list of reportable incident types: **unverified** (08 §5 names incident@cert-in.org.in; cert-in.org.in's incident page didn't load on 2026-11-07). The CERT-In point of contact is the owner's duty (12) |
| Data Protection Board: intimation | Without delay | Owner; lead drafts T1 | Researched 2026-10-28, DPDP Rules 2025 Rule 7 (08-C RB-15); **from 13 May 2027**. The Board's channel: **unverified** |
| Data Protection Board: detailed report | Within 72 hours | Owner; lead drafts T1 part 2 | As above |
| The people affected | Without delay | Owner; lead drafts T2 | As above. Before 13 May 2027 Rule 7 isn't in force; telling people anyway is the lead's suggested practice (no 08-C row) |
| Clients whose systems' data is involved (we act as processor) | ≤ 24 h of confirmation | Owner; lead drafts T4 | 08 §5 step 7; **unverified (not an 08-C row)**: depends on each client's contract |
| EU and UK people's data | 72 h to the supervisory authority where we are controller (GDPR Art. 33) | Owner | 08 §5 step 8; **unverified (not an 08-C row)**. A GDPR and UK GDPR representative is appointed before the first EU or UK client (08-C RB-27) |

Logs that back a report: the security log is kept 13 months (owner 2026-10-21). Processing logs are kept at least one year (Researched 2026-10-28, DPDP Rules 2025 Rule 8(3) (08-C RB-09)). IP and browser in the logs: Settled by the lead on the safest reading, 2026-10-30 (08-C RB-12). A copy of the logs in India is T5 (08-C RB-14, settled as above).

The contents in T1 and T2 follow the lead's reading of Rule 7. **08-C settles only the timelines**, so check them against Rule 7's text before first use. A one-off lawyer's look at the four templates would be wise.

## Step 6. Recover and learn (within 2 weeks)
- Fix the root cause through a normal task.
- Run the post-incident review: timeline, what worked, what didn't.
- Update 08 §5, this runbook and 13.
- Delete the evidence folder when its retention ends.

## Templates (fill the brackets; no line goes out without the owner's approval)

**T1. Data Protection Board (intimation, then the 72-hour report).** Contents per the lead's reading of DPDP Rule 7 (unverified beyond the timelines):
1. Who we are: TecHaust Technologies (sole proprietorship), [GSTIN], [postal address], contact [name, email, phone].
2. What happened: [description]; the nature of the breach; its extent; when it happened and when we noticed [date, time IST]; where [system].
3. Likely impact on the people affected: [ ].
4. *(72-hour report)* What we know now: the broad facts and circumstances; what we have done to contain it [steps, times]; what caused it and who, if known; what we have done so it doesn't happen again; and the notices we sent the people affected [date, number, channel].

**T2. To the people affected** (plain language, email from no-reply@ with Reply-To contact@):
> Subject: About your information held by TecHaust Technologies
>
> Dear [first name],
> On [date] we found that [what happened, in one sentence]. It affects [which of your details]. It happened between [from] and [to].
> What this may mean for you: [likely consequences].
> What we have done: [containment, in plain words].
> What you can do: [concrete safety steps, for example watch for emails that claim to be from us, and never share a sign-in link].
> Questions: [name], [email], [phone]. We will answer within [n] working days.
> Rupak Sarkar, TecHaust Technologies

**T3. CERT-In (within 6 hours).** The form and fields are unverified; take them from CERT-In's site at the time. Have ready:
- organisation and contact;
- the time of the incident and the time we noticed it;
- type of incident;
- systems affected (Cloudflare Workers, D1, R2; hostnames);
- a description;
- indicators (IP addresses, request IDs, user agents from `access_log`);
- the steps taken;
- the evidence kept (folder, files).

**T4. To a client (as their processor).**
> Subject: Security incident affecting [client] data, [date]
>
> [Contact name], we confirmed on [date, time IST] an incident that involves data we hold for [client]: [which data, how many records].
> Timeline: [first sign], [confirmed], [contained].
> Cause, as known so far: [ ]. What we have done: [ ]. What we still check: [ ].
> What you may need for your own reports: [the facts above, the affected records list on request].
> Our contact for this incident: [name, email, phone]. The next update by [date, time].

**T5. Internal incident log** (`<evidence folder>\log.md`):

| Time (IST) | Time (UTC) | Who | What was seen or done | Command or screen | Result |
|---|---|---|---|---|---|

Header fields:
- reference;
- first noticed (IST and UTC);
- bookmark at detection;
- CERT-In due (+6 h);
- Board report due (+72 h), when in force;
- people notified (when, how many);
- clients notified;
- closed on.

## Follow-ups this runbook needs (for the lead)
- **F1** `tools/rotate-secret.ps1`: random base64 (32 bytes) or random hex, or a pasted value with hidden input; `-Env staging|production`; several configs in one run; `gh secret set`; the house `RESULT:` line and BOM guard (model: `set-erasure-hash-key.ps1`).
- **F2** A `TOTP_ENC_KEY` re-encryption script (old and new key held for the run). Until then: never rotate.
- **F3** A `-Previous` mode for webhook and SES-event secrets.
- **F4** Replace the lost SES key script.
- **F5** Production modes for `admin:reset-2fa` and every secret script (Phase 7 L3).
- **F6** 08 §4 fixes:
  - drop `BUILD_SNAPSHOT_TOKEN`;
  - correct the `TOTP_ENC_KEY` line;
  - add `SALT_PEPPER`'s side effects.
  Also 08 §5 step 4: RB-14 is settled.
- **F7** A route kill switch (proposal).
- **F8** A tool that re-renders a lost PDF from its envelope (Tier A).

