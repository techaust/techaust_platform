# 08: Security and compliance

| | |
|---|---|
| **Phase** | 4, Project documentation (**APPROVED** 2026-10-06) |
| **Date** | 2026-10-06 |
| **Research** | [08-A GST & invoicing](08-research-appendix/A-gst-invoicing.md) (≈ 690 lines, CBIC/RBI/NPCI primary sources) · [08-B DPDP & legal](08-research-appendix/B-dpdp-legal.md) (≈ 700 lines, DPDP Rules Gazette, CERT-In, CCPA) · [05-A stack](05-research-appendix/A-stack-verification.md) |
| **Implements** | [04 PRD](04-prd.md) NFR-5/6/7/9, ADM-AUTH, ADM-AUD, JOB-BKP · [05 Architecture](05-architecture.md) §1.1, §6, §12 |

> **Professional-advice disclaimer.** You asked me to act as CA and lawyer. Everything marked **VERIFY WITH CA/LEGAL** is my best-effort reading of current official sources (checked 2026-10-06), with citations in the appendices. **It is not professional advice and I can't sign it off.** §7 is written so that an optional one-hour review with a CA and a lawyer can confirm it quickly. Whether to get that review is your decision before launch.

---

## 0. Urgent items for you (outside the software)

| # | Item | Why now | Action (yours) |
|---|---|---|---|
| U-1 | **LUT for FY 2026-27** (Form GST RFD-11) | If you have invoiced any foreign client since 1 April 2026 without a filed LUT, those invoices may attract IGST at 18 %. A late LUT can sometimes be condoned, but don't rely on it. (VERIFY WITH CA) | Check the GST portal: Services → User Services → **Furnish Letter of Undertaking** → view filed LUTs. If none is filed for 2026-27, file it now (free, online, with DSC/EVC) and note the ARN for Settings. |
| U-2 | **FEMA 2026: export realisation is now 9 months, plus a new monthly EDF** (from 1 Oct 2026) | Any unpaid foreign invoice older than ~9 months breaches FEMA. EDFs are due within 30 days of the end of each invoice month. (VERIFY WITH CA) | Ask your bank (AD bank) how they want the EDF filed for services. Our admin will produce the monthly list (ADM-REP-07). |
| U-3 | **UPI merchant fee from 15 Oct 2026** (0.4 % above ₹2,000, capped at ₹300; NPCI FAQ dated 15 Sep 2026) | Affects Razorpay costs on B2B invoices. You absorb fees, so prices may need a small buffer. | Ask Razorpay for its restated pricing; for large INR invoices, nudge clients to netbanking or NEFT. |
| U-4 | **Razorpay website checklist** | Live keys need Terms, Privacy, Refund, **Delivery**, Contact and Pricing pages live on the domain | Covered by the new site (Phase 7 order: site live → apply for live keys) |
| U-5 | **Zoho aliases** `hello@`, `billing@`, `privacy@`, `security@` | Needed for email sending (SES identities), legal pages and security.txt | Create them in Zoho before the email milestone |
| U-6 | **Public GitHub repo** (since 2026-10-06, owner decision) | `docs/` publicly describes unfixed weaknesses of the live site (audit H-5, M-1, M-2: form rate-limit bypass, debug leak, no Origin check) and business-confidential plans; the commit email is public | Make the repo private when convenient (Settings → General → Change visibility). Already-copied content can't be recalled. Until then nothing sensitive is committed (CLAUDE.md rule 6). |
| U-7 | **GitHub billing block** | GitHub refused to run Actions on the private repo ("recent account payments have failed or your spending limit…"). Public repos aren't affected, but it returns if the repo goes private. | Check GitHub → Settings → Billing and licensing for a failed payment |
| U-8 | **Trademark clearance for the new identity** (VERIFY WITH LEGAL) | The new name treatment and TH mark (ADR 0013) have not been searched. A clash found after printing or launch means redoing everything. | Ask a trademark agent to search IP India for "TecHaust" (word) and the TH device mark in classes 9, 35 and 42, then consider filing both ([11 §4](11-brand-audit.md)) |

---

## 1. Security goals and assets

| Asset | Why it matters | Where it lives |
|---|---|---|
| Client personal data (contacts, documents, acceptance records) | DPDP/GDPR duties; client trust | D1, R2 (private), SES logs |
| Financial records (invoices, credit/debit notes, payments) | GST/tax law (8+ years), money | D1, R2 (frozen PDFs + snapshots), S3 backups |
| Staff accounts (Owner especially) | Full control of money and data | D1 (`staff_*`), the owner's authenticator app |
| Secrets (pepper, gateway keys, SES keys, Cloudflare tokens) | Compromise = account takeover or fraud | Wrangler secrets, GitHub repo secrets, the owner's password manager |
| Backup decryption key (age identity) | Restores everything | **Offline with the owner only** (two copies) |
| Domain and DNS (techaust.com) | Phishing, email spoofing, takeover | Cloudflare account (owner) |
| Payment gateway accounts | Funds | Razorpay/Stripe/PayPal dashboards (owner, with 2FA) |

**Security targets:** OWASP ASVS Level 2 for authentication, sessions, access control, validation, cryptography, error handling and logging; OWASP Top 10 (2021) mapped in [03 §3C.6](03-plan.md).

---

## 2. Threat model (STRIDE per surface)

| Surface | Threat | Example | Mitigations |
|---|---|---|---|
| **Website forms** | Spoofing / DoS | Bots flood `/api/forms`, burn the 100k/day request budget or the email quota | Turnstile; honeypot + minimum fill time; Rate Limiting binding keyed on `CF-Connecting-IP + route`; a free WAF rate-limit rule (with your approval); body ≤ 16 KB; Origin check; the queue decouples the email send; alert at 50 % of daily requests |
| | Tampering / injection | Header injection into emails; stored XSS shown in the admin | A shared zod schema; CR/LF stripping; output encoding; React escaping; a strict CSP in the admin; no `dangerouslySetInnerHTML` on user data |
| | Information disclosure | Error responses leak internals (old audit M-1) | Generic errors with a request ID only |
| **Public Worker** | Elevation | A compromised public code path reads client data | **No D1/R2 bindings at all** (CI guard) |
| **Admin login** | Spoofing | Credential stuffing, phishing, stolen client hash | Mandatory TOTP; browser Argon2id + server HMAC with pepper; uniform responses (no enumeration); lockout; Turnstile after 3 failures; login alerts; optional Cloudflare Access in front |
| | Repudiation | "I didn't issue that invoice" | Audit log with actor, IP, user agent and request ID; append-only triggers |
| | Session theft | XSS steals the cookie; CSRF | `HttpOnly`, `Secure`, `SameSite=Strict`, `__Host-` cookies; CSP `script-src 'self'`; JSON-only + Origin-check CSRF middleware; session rotation; step-up TOTP for sensitive actions |
| **Admin authorisation** | Elevation | Sales reads invoices; Staff issues an invoice or refunds | A server-side permission matrix on every route; a route-coverage test; per-role tests; Owner-only issue/refund with step-up; approval workflows |
| **Portal** | Spoofing | Magic-link interception or replay; email scanners pre-fetching links | Single-use tokens stored as hashes; 15-min expiry; the token sits in the URL **fragment** and is consumed by a POST; rate limits; uniform responses |
| | Elevation (IDOR) | Client A fetches client B's invoice by guessing the ID | Client ID comes from the session only; every query is scoped; UUIDv7 IDs (not guessable sequences); cross-tenant tests on every route → 404 |
| | Information disclosure | A "View & pay" token is forwarded | The token grants **one document** only, expires (paid + 30 days), is revocable and is audit-logged |
| **Webhooks** | Spoofing / tampering | Forged "payment succeeded" event | Signature verified on the **raw body** (Razorpay HMAC, Stripe `constructEventAsync`, PayPal verify API, SES shared secret); constant-time compares; a server-side status re-fetch before marking paid; amount and reference checks |
| | Replay | The same event processed twice → double receipt | `UNIQUE(provider, event_id)`; idempotent consumers; Stripe timestamp tolerance |
| **Payments UX** | Tampering | Client edits the amount in the browser | The amount comes from the server balance; partial amount bounds checked server-side; nothing is marked paid on a redirect |
| **Documents** | Tampering | An issued invoice silently edited | DB triggers freeze content; the PDF and snapshot are stored with SHA-256; corrections only via credit/debit notes |
| **Files** | Malicious upload | HTML or SVG with script; zip bombs; huge files | Allow-list by magic bytes; ≤ 25 MB; served as `attachment` with `X-Content-Type-Options: nosniff`; private R2 with 5-min signed URLs; no server-side unzip |
| **Supply chain** | Tampering | A malicious npm release | Exact pins; pnpm `minimumReleaseAge` 1 day (install fails on newer packages, as seen in P5.2) + Renovate's 7-day delay on updates; `allowBuilds` allow-list (only esbuild and workerd run install scripts; dev-only design tooling in `packages/ui` such as sharp, HarfBuzz and pdf-lib ships no install scripts and never reaches a Worker bundle); Renovate PRs with CI; `--frozen-lockfile` in CI; actions pinned by SHA; gitleaks secret scan |
| **CI/CD (public repo)** | Elevation | A fork PR's code runs with our secrets ("pwn request"); a malicious workflow change | `deploy-staging` runs only for `push` events on this repo's `main` (never fork PRs); CI has no secrets; first-time fork contributors need approval to run Actions; branch protection requires CI on every PR |
| **CI/CD** | Elevation | A collaborator adds a workflow that exfiltrates the prod token | Write access limited to the Owner; the prod token is used only in `deploy-prod.yml` (actor guard + typed confirmation); separate least-privilege tokens per environment; branch protection; review of `.github/` changes |
| **Outbound calls** | SSRF | User-supplied URL fetched server-side | No user-supplied URLs are fetched; outbound hosts are allow-listed (gateways, SES, Turnstile, FBIL/RBI rates, PayPal certs) |
| **Email** | Spoofing of our domain | Phishing "invoices" from techaust.com | SPF, DKIM (SES Easy DKIM) and DMARC (`p=none` → `quarantine` after monitoring); a custom MAIL FROM; BIMI later (optional) |
| **Availability** | DoS / free-plan exhaustion | D1 daily limits hit; request cap hit | Static-first design; budgets and alerts ([05 §1.2](05-architecture.md)); the upgrade trigger proposal |

---

## 3. Security controls (build checklist)

### 3.1 Transport and headers
- [ ] HTTPS only; HSTS `max-age=31536000; includeSubDomains` (no `preload` until every subdomain is confirmed HTTPS-only: old audit Q-H6)
- [ ] **Headers on every response** (static via `_headers`, dynamic via Hono `secureHeaders`):
  - CSP (per surface)
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy` (camera, microphone, geolocation, payment off)
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Resource-Policy: same-site`
  - `frame-ancestors 'none'`
- [ ] CSP baselines:
  - **web:** `default-src 'self'; script-src 'self' 'sha256-…' https://challenges.cloudflare.com https://static.cloudflareinsights.com [+ https://www.googletagmanager.com after consent]; frame-src https://challenges.cloudflare.com; connect-src 'self' https://cloudflareinsights.com [+ GA endpoints]; img-src 'self' data:; style-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'`
  - **admin/portal:** `script-src 'self'`; `connect-src 'self'` (+ `api.pwnedpasswords.com` on password screens; + gateway checkout hosts for redirects only); `frame-src https://challenges.cloudflare.com`
- [ ] Cloudflare zone settings (**each needs your approval at the time**): minimum TLS 1.2, Always Use HTTPS, a free WAF managed ruleset, a rate-limit rule on `/api/forms/*`, CAA records (old audit L-5)

### 3.2 Authentication and sessions
See [05 §6](05-architecture.md). Key controls:
- [ ] Argon2id in the browser (m=19 MiB, t=2, p=1; per-user params)
- [ ] HMAC-SHA-256 with `PASSWORD_PEPPER`
- [ ] Fake salts via `SALT_PEPPER`
- [ ] Mandatory TOTP with replay guard; hashed recovery codes
- [ ] Sessions: hashed tokens, idle/absolute expiry, rotation, remote sign-out
- [ ] Step-up for sensitive actions
- [ ] Exact lockout counters + rate limits + Turnstile
- [ ] Login and 2FA-change alerts
- [ ] Owner break-glass: recovery codes printed and stored offline. If they are all lost, a documented **`pnpm admin:reset-2fa`** script, run locally by the Owner with the prod Cloudflare token, clears the Owner's TOTP and issues a one-time enrolment link (audit-logged). Rotating `PASSWORD_PEPPER` is **not** a recovery method, because it would lock out every user.

### 3.3 Authorisation
- [ ] Deny by default; permission declared per route; route-coverage test
- [ ] Portal: client ID from the session only; cross-tenant tests
- [ ] Field-level stripping for Sales (no finance fields)
- [ ] Approvals bound to a content hash (any edit invalidates them)

### 3.4 Data protection in the app
- [ ] Money as integers; tax maths in pure, tested functions
- [ ] Immutable issued documents (DB triggers) + SHA-256 of snapshots and PDFs
- [ ] Append-only audit log (triggers) for ≥ 10 years
- [ ] Bank account numbers masked in the UI and never logged
- [ ] TOTP secrets encrypted (AES-GCM, `TOTP_ENC_KEY`)
- [ ] No personal data in logs or Sentry (`beforeSend` scrubber; auth/payment bodies never logged)
- [ ] Security `access_log` in D1, retained 13 months
- [ ] Clocks: Workers time is NTP-synced by Cloudflare; timestamps stored in UTC (CERT-In clock-sync direction)

### 3.5 Secure development
- [ ] TypeScript strict; Biome lint (including a no-floating-point-money rule and banned `innerHTML`)
- [ ] Unit tests for money, tax, numbering, schedules, ledger, permissions (≥ 90 % coverage in `packages/core`)
- [ ] Integration tests in the Workers runtime (auth, portal scoping, webhooks, numbering concurrency)
- [ ] E2E tests (Playwright) + axe
- [ ] A security review (the `/security-review` command or a manual checklist) before each milestone sign-off
- [x] gitleaks (full git history) in CI; exact pins + `minimumReleaseAge` + `allowBuilds` (Phase 5)
- [ ] Dependency audit in CI; Renovate app with a 7-day delay (installing the Renovate app needs owner approval)

---

## 4. Secrets handling

| Secret | Where stored | Who can read | Rotation |
|---|---|---|---|
| `PASSWORD_PEPPER`, `SALT_PEPPER` | Wrangler secret (admin), staging and prod differ | Cloudflare account owner only | **Never routinely** (rotation forces password resets). Rotate only on suspected compromise, with a reset procedure. |
| `SESSION_HMAC_KEY`, `MAGIC_LINK_KEY`, `DOC_TOKEN_KEY`, `TOTP_ENC_KEY` | Wrangler secrets | Owner | Yearly or on suspicion. Session keys can rotate with a key ID (old one valid 7 days); `TOTP_ENC_KEY` rotation re-encrypts the secrets via a script. |
| Gateway API keys and webhook secrets (Razorpay, Stripe, PayPal) | Wrangler secrets (admin/portal: create-only keys where providers allow restricted keys; jobs: status/refund) | Owner | Yearly or on staff change. **Test keys only until Phase 7.** Stripe **restricted keys** with minimal permissions. |
| SES IAM access key | Wrangler secret (jobs) | Owner | 90 days (calendar reminder + a cron alert from key age) |
| `SES_EVENTS_TOKEN` | Wrangler secret + EventBridge connection | Owner | Yearly |
| `TURNSTILE_SECRET` | Wrangler secret | Owner | On suspicion |
| `CF_API_TOKEN_STAGING` (**created 2026-10-06** by the owner: Workers Scripts/D1/Queues edit + Account Settings read; no zone/DNS) + `CLOUDFLARE_ACCOUNT_ID` | GitHub repo secrets | `deploy-staging.yml` only (never exposed to fork PRs) | Yearly; least privilege |
| `CF_API_TOKEN_PROD`, `CF_API_TOKEN_BACKUP` (Phase 7) | GitHub repo secrets | `deploy-prod.yml` / `backup.yml` only (repo write access = Owner) | Yearly; least privilege per token |
| Local `wrangler login` (OAuth) | The owner's machine (`%APPDATA%\xdg.config\.wrangler`) | Local CLI only | `wrangler logout` to revoke |
| AWS (backups) | **No stored keys**: GitHub OIDC → IAM role (`s3:PutObject` on the backup prefix only) | — | n/a |
| `BUILD_SNAPSHOT_TOKEN` | Wrangler secret (admin) + GitHub secret | Workflows | Yearly |
| age **identity** (backup private key) | **Offline**: the owner's password manager + a printed copy in a safe place | Owner only | Only if exposed (then re-encrypt the retained backups) |
| Bank details | D1 (`bank_accounts`), entered by the Owner in Settings | Owner (full), Accountant (masked) | n/a |

**Rules:**
- **Never commit secrets.** `.env.example` and `.dev.vars.example` list names only. `.dev.vars` and `.env*` are git-ignored. gitleaks scans the full git history in CI (a local pre-commit hook is optional and not yet installed).
- I will **never** read your `CREDENTIALS` folder. When a secret is needed, I give you the exact `wrangler secret put NAME --env staging` command and **you** paste the value into your terminal.
- Gateway keys can't be entered in the admin UI (ADM-SET-06). The UI shows only "configured / missing" and the mode.
- Owner accounts on Cloudflare, GitHub, AWS, Razorpay, Stripe, PayPal, Zoho and the domain registrar all use **2FA with an authenticator app or passkey**, and recovery codes stored offline.

---

## 5. Incident response (VERIFY WITH CA/LEGAL for the legal timelines)

| Step | Action | Timing |
|---|---|---|
| 1 Detect | Sentry or uptime alert, an anomaly in the audit/access log, a webhook-failure spike, a client report | — |
| 2 Contain | Revoke sessions (`sign out everyone`), rotate the affected secrets, put admin behind Cloudflare Access, disable affected routes via feature flag, roll back the Worker | Immediately |
| 3 Assess | What data, whose, how many people, since when; preserve logs (export `access_log` and `audit_log`) | Within hours |
| 4 Report: CERT-In | If the incident is a reportable type under the 2022 CERT-In Directions (applicability to a sole proprietorship is a lawyer question, §7.2), report to incident@cert-in.org.in | **Within 6 hours** of noticing |
| 5 Report: DPDP Board | A personal-data breach: a brief intimation "without delay", then a **detailed report within 72 hours** (DPDP Rule 7; core duties from **13 May 2027**) | 72 h |
| 6 Notify affected people | Plain-language notice: what happened, likely impact, what we did, what they can do, contact | Without delay |
| 7 Notify clients (as processor) | Where client-system data is involved: notice to the client within 24 h of confirmation, with the information they need for their own reports | ≤ 24 h |
| 8 EU/UK | If EU/UK personal data is affected: supervisory authority within 72 h (GDPR Art. 33), where we are controller | 72 h |
| 9 Recover and learn | Fix the root cause; post-incident review; update this document | Within 2 weeks |

**Templates** for steps 4–7 are drafted in Phase 6 M7 (hardening) and kept in `docs/runbooks/incident.md`.

---

## 6. Backup, restore and rollback runbooks

### 6.1 What is backed up

| Data | Mechanism | RPO | Retention |
|---|---|---|---|
| D1 (all tables) | **D1 Time Travel** (built-in, point-in-time) | Minutes | 7 days (Free) |
| D1 (all tables) | **Nightly `wrangler d1 export`** → age-encrypt → S3 Mumbai (versioning + Object Lock, governance mode) | 24 h | 90 daily copies + the first-of-month copy for **10 years** (GST ≥ 8 years; VERIFY WITH CA) |
| R2 documents (frozen PDFs, snapshots) | Weekly sync of new objects → S3 Mumbai (encrypted) via GitHub Actions | 7 days (the documents can also be re-rendered from D1 snapshots) | 10 years |
| R2 client files | Weekly incremental sync → S3 | 7 days | While the client is active + 1 year (data-processing note) |
| Code and config | GitHub (+ the local clone) | Each commit | Forever |
| Secrets | **Not backed up by the system**; listed in the owner's password manager | — | — |

### 6.2 Restore runbook: D1 (summary; the full step-by-step version goes in `docs/runbooks/restore.md` in Phase 5)
1. **Decide the scope:** a single-table or row mistake within 7 days → **Time Travel**. A disaster, or anything older than 7 days → **S3 backup**.
2. **Time Travel:** `wrangler d1 time-travel info techaust-prod --timestamp=<ISO>` → restore **into a scratch database first** (`wrangler d1 time-travel restore` acts on the target DB, so for a partial fix restore a copy and move only the needed rows across).
3. **S3 restore:**
   - (a) download the chosen `db-YYYYMMDD.sql.age` from S3 (AWS console or CLI on the owner's machine)
   - (b) `age -d -i <offline identity> -o db.sql db-YYYYMMDD.sql.age` on the owner's machine
   - (c) `wrangler d1 create techaust-restore-YYYYMMDD`
   - (d) `wrangler d1 execute techaust-restore-YYYYMMDD --remote --file=db.sql`
   - (e) verify: row counts per table, latest invoice number per series, ledger totals vs the last known report, audit-log tail
   - (f) either point the Workers' `DB` binding to the restored database (a config change + approved prod deploy) or copy the needed rows back
   - (g) record the incident in the audit log and the runbook log
4. **Quarterly restore drill** (NFR-7, RTO ≤ 4 h): restore the latest backup to a scratch D1, run the verification script (`pnpm drill:verify`), write the result (date, duration, issues) into `docs/runbooks/drill-log.md`, then delete the scratch DB. **The first drill is part of the Phase 7 launch checklist.**

### 6.3 Code rollback
- `wrangler rollback --name techaust-platform-<app> --env production` (to the previous version), run by the owner locally or through a manual workflow. Migrations are backward-compatible ([05 §5.5](05-architecture.md)), so code rollback never needs a DB rollback.
- Cut-over rollback (Phase 7): the old `techaust-web` Worker stays deployed. Rollback = re-attach `techaust.com` to it (a DNS/route change; your approval).

---

## 7. Compliance register and the "VERIFY WITH CA/LEGAL" list

### 7.1 GST and invoicing (VERIFY WITH CA): defaults in the software

| # | Topic | Default in the software ([08-A](08-research-appendix/A-gst-invoicing.md)) | Confidence |
|---|---|---|---|
| G-1 | GST rate | 18 % on all our services (CGST 9 + SGST 9, or IGST 18); exports under LUT 0 % | High |
| G-2 | SAC codes | 998314 build/web/app/AI/UI-UX · 998313 consulting/AMC/support/fractional CTO · 998315 hosting · 998316 managed infra · 6 digits printed | Med |
| G-3 | Numbering | `TH/{INV,EXP,CN,DN,RV,RF}/2627/0001` (≤ 16 chars, A–Z 0–9 `/` `-`), reset 1 April, gap-free, never reused; voided numbers reported as cancelled (GSTR-1 Table 13). Proforma `TH/PI/…` and Payment Receipt `TH/RCT/…` are not GST documents. | High |
| G-4 | Invoice contents | All Rule 46 fields; "ORIGINAL FOR RECIPIENT"; reverse charge "No"; authorised-signatory block (no digital signature needed for an electronic invoice) | High |
| G-5 | Timing | Within 30 days of completing a service (alert at day 25); care plans/retainers on or before the payment due date (continuous supply) | High |
| G-6 | Advances | Default: Proforma → on payment, an auto **Tax Invoice** for the amount received. Optional modes: tax invoice upfront; Receipt Voucher (Rule 50) + Refund Voucher (Rule 51). Also selectable per client/document ("invoice first" for clients who pay only against a tax invoice). | Med |
| G-7 | Place of supply | WB (19) → CGST+SGST; other states → IGST; unregistered → the address state (none → WB); overseas → export | High |
| G-8 | Exports | LUT mode needs a saved ARN for the FY; full Rule 46 endorsement text; country of destination; INR value + rate | High |
| G-9 | FX | FBIL/RBI reference rate on the invoice date, stored and frozen | Med |
| G-10 | Rounding | Integer paise; tax per line per tax head, half-up; grand total to the nearest ₹1 with a Round-off line; USD not rounded | Med |
| G-11 | Credit/debit notes | Debit notes for upward corrections; credit-note **hard block** after 30 Nov following the FY; IMS / ITC-reversal status tracked | High |
| G-12 | Realisation (FEMA 2026) | Warn at 9 months; escalate at 12 months + 15 days (IGST + interest under LUT); FIRA/FIRC per receipt; archive PayPal FIRAs; monthly EDF list | Med |
| G-13 | Returns | QRMP default; GSTR-1 Offline-Tool-compatible exports (b2b, b2cl, b2cs, exp, cdnr, cdnur, hsn b2b/b2c, docs); GSTR-3B is hard-locked to GSTR-1, so the exports must be right first time | Med |
| G-14 | E-invoicing | Off (AATO ≤ ₹5 Cr assumed); IRN/QR fields ready behind a flag | High |
| G-15 | Retention | 10 years default (≥ 8 years from FY end; s.36); no hard deletes; edit/void log | Med |
| G-16 | Supplier name | Trade name in the header + "Legal name: ‹proprietor› (Proprietor)", GSTIN, the registered address exactly as on the GST certificate | Med |
| G-17 | TDS | Manual adjustment, section "393(1) [old 194J]" (Income-tax Act 2025), tracked as TDS receivable | Med |
| G-18 | Gateways | Warn above ₹25 lakh per cross-border gateway transaction; never surcharge UPI MDR | Med |
| G-19 | Out of scope at launch | Purchase side: RCM self-invoices for imported services (foreign SaaS/cloud), gateway GST invoices for ITC: **ask your CA how you handle these today** | — |

### 7.2 Questions for an optional one-hour CA review
All 15 questions are in [08-A, the last section](08-research-appendix/A-gst-invoicing.md). The five most important:
1. Is our AATO definitely ≤ ₹5 Cr (no e-invoicing)?
2. Is the **LUT for FY 2026-27** filed? If not, how do we treat exports since 1 April 2026?
3. Is the SAC mapping (G-2) right?
4. Is a tax invoice on receipt of an advance acceptable instead of a receipt voucher?
5. **FEMA 2026 EDF:** does it apply to every export invoice, including Stripe/PayPal receipts? Do we need an IEC? How do we file with our bank?

### 7.3 Data protection and legal (VERIFY WITH CA/LEGAL)

| # | Topic | Position taken ([08-B](08-research-appendix/B-dpdp-legal.md)) |
|---|---|---|
| L-1 | Law in force today | IT Act s.43A + SPDI Rules 2011 (privacy policy + Grievance Officer replying within 1 month) **until 13 May 2027**; CERT-In 2022 Directions (6-hour reporting, 180-day logs) |
| L-2 | DPDP timeline | Rules notified 13 Nov 2025; Consent Managers 13 Nov 2026; **core duties 13 May 2027** (notice, security, breach, rights, retention). We build to them now. |
| L-3 | Legal basis | Enquiries, client contacts and invoices: "voluntarily provided for a specified purpose" (s.7(a)) + legal obligation. GA4 and marketing: **consent**, with consent receipts stored. |
| L-4 | Notice | Itemised and standalone; English, with Eighth Schedule languages on request ([07-A §1](07-content-appendix/A-legal-pages.md)) |
| L-5 | Rights | Access, correction, erasure, withdrawal, nomination, grievance; we respond within 30 days (the law allows up to 90); DSR workflow in the admin |
| L-6 | Retention | Leads 12 months; security logs 13 months (Rule 6: 1 year; CERT-In: 180 days); financial records 10 years; legal holds |
| L-7 | Cross-border | Allowed (no restricted countries notified); disclosed in the privacy notice; D1 has no India region |
| L-8 | GDPR | Probably applies when marketing to EU/UK clients (Art. 3(2)). Whether an Art. 27 representative is needed is a lawyer question. EU/UK section in the privacy notice. |
| L-9 | Cookies | GA4 only after consent; Reject as easy as Accept; Consent Mode v2 default denied |
| L-10 | Advertising | No unsubstantiated claims; "+ GST" next to prices; no false urgency (CCPA 2022, dark-patterns guidelines 2023); claims register ([07 §1.4](07-content.md)) |
| L-11 | E-contracts | Click-to-accept is valid (Contract Act + IT Act s.10A); the evidence pack (hash, IP, time, verified email, certificate); BSA s.63 certificate if ever needed in court; **West Bengal stamp duty on e-accepted proposals is an open question** |
| L-12 | Website terms | Indian law; Balurghat courts (or Kolkata); website liability capped at ₹10,000; arbitration belongs in the client MSA |
| L-13 | Refunds | Draft policy ([07-A §3](07-content-appendix/A-legal-pages.md)); refunds to the original method (RBI PA Directions 2025) |
| L-14 | E-Commerce Rules 2020 | Possibly applicable. One combined Grievance Officer block covers SPDI, DPDP and E-Com. |
| L-15 | Accessibility | WCAG 2.2 AA; watch the **draft RPwD Amendment Rules 2026** (IS 17802; an 18-month deadline for firms under ₹500 Cr if finalised) |
| L-16 | Identity on the site | Trade name + "sole proprietorship, Balurghat, West Bengal" + the Grievance Officer's name; **no GSTIN on the website** (owner decision); full postal address on Contact and legal pages only |
| L-17 | Trademark and font licences | New identity "Patina" (ADR 0013): trademark search and filing not done (U-8). Fonts are SIL OFL 1.1: using them in a logo is allowed, the outlined wordmark is artwork; licence texts ship in `packages/ui/fonts/LICENSES.md` |

**Questions for an optional one-hour lawyer review:** the 15 questions in [08-B](08-research-appendix/B-dpdp-legal.md). The five most important:
1. Does CERT-In apply to a sole proprietorship?
2. Does one combined Grievance Officer block satisfy SPDI, DPDP and the E-Commerce Rules?
3. Should disputes go to Balurghat or Kolkata courts, and should the MSA use arbitration?
4. Is West Bengal stamp duty due on e-accepted proposals?
5. Is a GDPR Art. 27 representative needed?

### 7.4 What to look for if you do bring in professionals later
- **CA:** GST for **exports of services** (LUT, refunds of unutilised ITC, FIRC/EDF practice), comfortable with QRMP and the GSTR-1 Offline Tool; ideally works with IT/software clients. An hourly or fixed-fee review of §7.1–7.2 should take about an hour with these documents.
- **Lawyer:** technology/data-protection practice (DPDP + GDPR), contract drafting (MSA, DPA, proposal terms), familiar with Calcutta High Court commercial matters.

---

## 8. Launch gates (checked in Phase 7)

| Gate | Condition | Owner action |
|---|---|---|
| S-1 | Security review of every milestone done; no open high-severity findings | Approve |
| S-2 | All secrets set per environment; the prod token used only by `deploy-prod.yml`; 2FA on all owner accounts | Confirm |
| S-3 | First **restore drill** completed and logged | Approve |
| S-4 | DNS: SPF/DKIM/DMARC for SES, CAA, minimum TLS 1.2: **each change approved individually** | Approve each |
| C-1 | Legal pages published with version and date; the S3 page stays off | Approve the text |
| C-2 | Tax defaults reviewed by you (and optionally a CA); **LUT ARN for the current FY saved** before any export invoice | Decide on a CA review; file the LUT |
| C-3 | `PAYMENTS_LIVE_ALLOWED=true` **only after your explicit go-live approval**; live keys set by you | Approve go-live |
| C-4 | SES out of the sandbox (your request to AWS) | Request |
