# 03: Platform plan (public website + admin backend + architecture)

| | |
|---|---|
| **Phase** | 3, Plan (**APPROVED** 2026-10-06) |
| **Date** | 2026-10-06 |
| **Inputs** | [01-audit.md](01-audit.md) · [02-services-strategy.md](02-services-strategy.md) · owner interview (§0) · research: [A: payments](03-research-appendix/A-payments.md) · [B: platform & stack](03-research-appendix/B-platform-stack.md) |
| **Next** | Phase 4 turns this plan into the PRD, architecture, design system, content, security and roadmap docs |

> **Compliance.** Every tax, invoicing, payments-regulation and DPDP point is marked **VERIFY WITH CA/LEGAL**. The software will be configurable, so whatever your CA or lawyer decides can be applied without code changes wherever possible.

---

## 0. Decisions made in Phase 3 (owner interview, 2026-10-06)

| Area | Decision |
|---|---|
| Prices | The "starting from" prices in 02 §4.1 are approved as the catalogue base (editable later in the admin) |
| Capability | The team has Tally **and** GST e-invoice/GSP API experience. Mobile apps are built in both React Native/Expo and Flutter. |
| Tagline | **"Build it right. Automate the rest."** |
| Client portal | **Yes**, a full client portal with magic-link login |
| Roles | Owner/Admin · Staff · Accountant (read-only finance) · Sales/BD |
| Admin login | **Email + password + authenticator-app 2FA (TOTP).** To fit the free plan, password hashing runs in the browser (Argon2id) and the server applies a light salted, peppered HMAC (see §3C.4) |
| Audit log | Money actions · logins and security events · documents and clients · settings changes |
| Leads | Website forms create **leads** in a pipeline (New → Qualified → Proposal sent → Won/Lost) |
| Projects | **Light:** status, milestones, notes, files, dashboard. Day-to-day tasks stay in your existing tool. |
| Time tracking | **Simple hour logging** against projects and care plans (used vs included, overage flag) |
| Data import | None. Start fresh. |
| Proposals | A proposal contains an estimate section. Standalone quick estimates also exist. **Click-to-accept** in the portal. **Versioned** (v1, v2…; an accepted version is locked). |
| Currencies | **INR and USD** |
| Invoice numbering | **Separate series per type, reset each financial year** (e.g. `TH/INV/26-27/0001`, `TH/EXP/…`, `TH/CN/…`, `TH/RCP/…`). VERIFY WITH CA. |
| E-invoicing turnover | **Not sure** whether turnover is above ₹5 Cr. The design is IRP-ready but IRP is not integrated at launch. VERIFY WITH CA. |
| LUT for exports | **Not sure** whether one is filed. Export invoices support both "under LUT" and "IGST paid" modes. VERIFY WITH CA. |
| TDS | Clients don't deduct TDS, so no TDS module (a manual adjustment line is still possible) |
| Payment accounts held | **Razorpay** (INR), **Stripe** and **PayPal** (international) are active |
| INR payments | Razorpay (UPI, cards, netbanking, payment links, partial payments) |
| USD payments | The client chooses **Stripe, PayPal or bank transfer** on the invoice page |
| Gateway fees | **We absorb them** (built into prices) |
| Email provider | **Amazon SES, Mumbai region** |
| Payment terms | **Net 7**, with reminders at **−3, 0, +3, +7, +14 days** (editable per client and per invoice) |
| Reports | Revenue & collections · outstanding & ageing · pipeline & win rate · GST & CA exports |
| Visual style | **Calm, editorial, premium.** **Light by default with a dark-mode toggle.** |
| Logo | Refine your logo (you'll upload the file when asked) |
| Assets you'll provide | Founder headshot and bio. Everything else gets honest placeholders or diagrams. |
| Platform | **All-Cloudflare, free plan, permanently**, designed to fit free-tier limits (≈ ₹0–50/month). Within your budget of ₹500–1,000/month. |
| Domains | `techaust.com` (site) · `admin.techaust.com` (staff) · `portal.techaust.com` (clients) |
| Content editing | **Markdown files in the repo.** Prices are read from the admin catalogue. |
| Languages | English only |
| Analytics | Cloudflare Web Analytics (cookieless) **and** Google Analytics 4, which loads **only after cookie consent** |
| Proprietor name and GSTIN | **On invoices only, not on the website** |
| Off-site backups | **AWS S3 Mumbai**, encrypted, nightly |
| Code repository | **A new private repo, `techaust/techaust_platform`**, created by you. The old `techaust-web` repo is left untouched. Local project folder: `WEBSITE\techaust_platform` (renamed by you from `techaust_website`). |

---

# 3A. Public website

## 3A.1 Goals

1. **Explain in 5 seconds** what TecHaust does, for whom, and the first step (the Discovery Sprint).
2. **Convert** qualified visitors into **Discovery Sprint or quote requests** (primary) and enquiries (secondary).
3. **Earn trust honestly:** real prices, clear process, senior team, anonymised case studies with real metrics, no fake data (this fixes audit findings C-1, C-2, H-3 and H-11).
4. **Rank and get cited:** service and industry pages written for both search engines and AI answer engines (SEO + AEO).
5. **Fast and accessible:** static pages at the edge, WCAG 2.2 AA.

## 3A.2 Sitemap

| Route | Page | Purpose and key content | Primary CTA |
|---|---|---|---|
| `/` | Home | Tagline "Build it right. Automate the rest."; who we help (India + international); 5 headline services; how we work in 4 steps; Care Plans teaser; pricing anchors; anonymised proof; FAQ | Book a Discovery Sprint |
| `/services` | Services hub | All services grouped Advise / Build / Automate / Connect / Run, each with a "from" price | Choose a service |
| `/services/discovery-sprint` | S1 | Entry offer: two flavours (Automation Audit, Product Blueprint), deliverables, fee credited to the build | Book a Discovery Sprint |
| `/services/custom-web-apps` | S5 | Portals, internal tools, Excel/Access → web; includes a UI/UX section (S8) | Get a quote |
| `/services/mvp-saas-development` | S6 | MVP sprint, staging from day 1, IP transfer, overlap hours | Get a quote |
| `/services/mobile-apps` | S7 | React Native/Expo and Flutter, usually alongside web | Get a quote |
| `/services/ai-document-automation` | S9 | Invoice / PO / KYC / contract extraction into Tally, Zoho, QuickBooks, Xero; review screens; pilot → production | Start a pilot |
| `/services/workflow-automation` | S10 | n8n/Make/custom automations and narrow AI agents; Quick-Win bundle | Automate a workflow |
| `/services/whatsapp-automation` | S11 | Order updates, payment reminders, catalogue ordering, human handover | Get a quote |
| `/services/ai-knowledge-assistants` | S12 | Private document search with citations, access control, quality tests | Start a pilot |
| `/services/ai-features-for-software` | S13 | AI features in SaaS, MCP servers, agent-ready APIs | Get a quote |
| `/services/business-systems-integration` | S14 | Tally ↔ Zoho, GST e-invoice / e-way bill via GSP, Shopify, QuickBooks/Xero/HubSpot; includes a Payments & Billing section (S15) | Get a quote |
| `/services/app-rescue` | S2 | Production-readiness audit + hardening sprint | Book an audit |
| `/services/dpdp-readiness` | S3 | Technical DPDP implementation, delivered with a legal partner. **Published only once a legal partner is in place** (02 Q-B12). | Book an audit |
| `/services/fractional-cto` | S4 | Monthly senior technical leadership | Talk to us |
| `/services/care-plans` | S16 (+ S17) | Essential / Growth / Scale tiers with SLAs; AI Ops add-on | Choose a plan |
| `/services/dev-subscription` | S18 | One active request at a time, pause or cancel monthly (international) | Start a subscription |
| `/industries` | Industries hub | Three focus industries | — |
| `/industries/finance-accounting-legal` | Beachhead | Invoice-to-Tally, GSTR-2B reconciliation, contract extraction, CA-firm client bots, DPDP | Start a pilot |
| `/industries/retail-ecommerce-logistics` | Vertical | WhatsApp commerce, Shopify ↔ ERP, delivery-proof / freight-invoice extraction, dealer portals | Get a quote |
| `/industries/saas-startups` | Vertical | MVPs, AI features, MCP, dev subscription, fractional CTO | Get a quote |
| `/pricing` | Pricing | All "from" prices, care-plan tiers, what affects price, payment terms, GST note | Get a quote |
| `/work` + `/work/[slug]` | Case studies | 2–3 anonymised case studies at launch (problem → approach → stack → real metrics). Shows "coming soon" honestly if there are none yet. | Similar project? Talk to us |
| `/how-we-work` | Process & trust | 4-step process, engagement models, fixed-price rules, IP transfer, time-zone overlap, communication cadence, AI-use policy, warranty | Book a Discovery Sprint |
| `/how-we-build-ai` | AI approach | Production-first AI: test sets, guardrails, human review, data handling, DPDP awareness. **No absolute claims.** | Start a pilot |
| `/about` | About | Founder (headshot + bio), team roles, story, values, location. **No fabricated team members.** | Talk to us |
| `/blog` + `/blog/[slug]` | Blog | SEO/AEO articles (e.g. "Tally invoice automation", "GST e-invoice API integration") | Contextual |
| `/contact` | Contact | Short enquiry form, email, office location, response time (an honest SLA, in IST) | Send enquiry |
| `/get-a-quote` | Quote / Discovery request | Multi-step form: service (pre-selected from the referring page), goals, budget band, timeline, contact details; Turnstile spam check | Request quote |
| `/privacy` | Privacy notice | DPDP-aware notice, drafted for **lawyer review** (VERIFY WITH CA/LEGAL) | — |
| `/terms` | Website terms | Indian law and jurisdiction, drafted for **lawyer review** | — |
| `/refund-policy` | Refund & cancellation | **Required by payment gateways** for merchant compliance. Drafted for review. | — |
| `/cookies` | Cookie policy + preferences | Needed because GA4 loads after consent | — |
| `/security` | Security & disclosure | How to report a vulnerability; links to `/.well-known/security.txt` | — |
| `404` | Not found | Helpful links (services, contact) | — |
| Machine files | `sitemap.xml` (real lastmod dates), `robots.txt`, `llms.txt`, RSS, 1200×630 OG images per page | — | — |

**Launch count:** about 33 pages plus blog posts and case studies.

## 3A.3 Content structure

Each **service page** follows the same template, so pages are consistent and quick to write:
1. Hero: outcome headline, who it's for, "from ₹X / $Y", primary CTA.
2. The problem, in plain words.
3. What you get: deliverables.
4. How it works: steps, timeline, what we need from you.
5. Pricing and engagement model: fixed, retainer or pilot, plus payment schedule.
6. Tech and integrations, shown as logos only where truthful.
7. Proof: an anonymised case study or a sample deliverable, honestly labelled.
8. FAQs, marked up as `FAQPage` structured data.
9. Related services.
10. CTA band, which pre-fills the quote form with this service.

**Prices on pages** are read at build time from the admin's service catalogue (one source of truth). INR is shown to visitors from India and USD to everyone else, based on Cloudflare's country header, with a manual ₹/$ toggle. The GST note reads "Prices exclude GST" (VERIFY WITH CA).

## 3A.4 Lead capture and conversion

| Element | Detail |
|---|---|
| Forms | `/get-a-quote` (multi-step), `/contact` (short), and service-page CTAs that pre-select the service |
| Spam and abuse | Cloudflare Turnstile (free), honeypot field, rate limit per IP using `CF-Connecting-IP` (fixes audit H-5), body-size limit, strict validation shared between browser and server (fixes audit H-4) |
| Where leads go | Validated submission → queue → **lead record in the admin** + email alert to you + **acknowledgement email to the visitor** (the audit found none) |
| Consent | Purpose-specific notice beside every form, with a link to the privacy notice. No pre-ticked boxes. (VERIFY WITH CA/LEGAL) |
| Booking | The form asks for a preferred call window (in IST, and the visitor's local time). A Cal.com scheduling link can be added later (Q-P3-1). |
| Conversion goals | **Primary:** quote or Discovery Sprint request. **Secondary:** contact enquiry. **Micro:** pricing-page view, case-study read, CTA click. Tracked through cookieless events plus GA4 (after consent). |

## 3A.5 Design direction

- **Tone:** confident, plain-spoken, senior. Short sentences, specifics over superlatives, no fear language ("ironclad", "neutralized"), no absolute guarantees.
- **Visual style:** calm, editorial and premium:
  - generous white space and a strong type hierarchy
  - one confident accent colour (refined from the current cyan/violet brand toward a deeper, more trustworthy hue; final palette in `06-design-system.md`)
  - warm neutrals
  - real diagrams (architecture, workflow) instead of fake dashboards
  - **motion only where it explains something**, always respecting reduced-motion settings
- **Theme:** light by default; dark mode follows the visitor's system setting, with a toggle; both meet WCAG AA contrast.
- **Typography approach:**
  - one highly legible sans-serif for UI and body text
  - optionally an editorial display face for large headings
  - mono only for code snippets
  - a modular type scale with a 16px minimum body size and no text under 12px
  - fonts self-hosted
- **Brand assets:**
  - refined logo (from your upload), with simplified favicon and social variants
  - founder headshot
  - consistent icon set
  - generated per-page 1200×630 social images
- **Shared look with documents:** proposals, estimates, invoices and receipts use the same tokens (colours, type, logo) as the site (`06-design-system.md`).

## 3A.6 Performance, SEO and accessibility targets

| Area | Target |
|---|---|
| Lighthouse (mobile) | Performance ≥ 95 · Accessibility 100 · Best Practices 100 · SEO 100 on all templates |
| Core Web Vitals (field, 75th percentile) | **LCP < 2.0 s · INP < 200 ms · CLS < 0.05** |
| TTFB | < 200 ms (static HTML from the edge, cached) |
| JavaScript budget | ≤ 50 KB gzipped per page (Astro islands; no animation library site-wide) |
| Images | AVIF/WebP, explicit dimensions, lazy below the fold |
| Accessibility | **WCAG 2.2 AA:** contrast ≥ 4.5:1 (text) and 3:1 (UI), visible focus, 44px touch targets, keyboard-complete, `prefers-reduced-motion`, semantic landmarks, accessible forms. Automated checks with axe in CI, plus manual keyboard and screen-reader passes. |
| SEO | One `h1` per page; unique titles ≤ 60 characters and descriptions ≤ 155; canonical URLs on the apex domain; breadcrumbs. Structured data: `Organization`/`ProfessionalService` (name, alternateName, address, `areaServed`, NAICS 541511, `disambiguatingDescription` distinguishing us from Tech Australia), `Service` per service, `FAQPage`, `BreadcrumbList`, `Article`. Real sitemap lastmod dates. **No fake `SoftwareApplication` markup** (fixes audit H-10). |
| AEO | Question-led FAQs, explicit prices and specifics, `llms.txt`, consistent business details across directories, Google Business Profile, Search Console |
| Social | Remove the non-existent X handle (audit H-9) until handles are standardised (02 Q-B15) |

---

# 3B. Admin backend and client portal

**Three surfaces share one database:** the public site (no database access at all), the **admin** (staff) and the **portal** (clients).

## 3B.1 Authentication, roles and audit log

**Staff login (`admin.techaust.com`)**
- Email + password + **mandatory TOTP 2FA** (any authenticator app), with 10 one-time recovery codes.
- Password handling is designed for the free plan: the browser hashes the password with **Argon2id** (memory-hard), and the server stores **HMAC-SHA-256(pepper, salt + client hash)**. A stolen database still forces an attacker to run Argon2id for every password guess. The design is validated with a CPU measurement in Phase 6; if it doesn't fit, I stop and ask you.
- Sessions:
  - HttpOnly, Secure, `SameSite=Strict` cookies, scoped to the admin host only
  - 12-hour idle timeout, 7-day absolute limit
  - a list of active sessions with remote sign-out
- Login is rate-limited per IP and per account, with Turnstile after failures and a lockout with email alert.
- **Optional extra lock:** Cloudflare Access (free, up to 50 users) in front of `admin.` can be switched on at any time without code changes.

**Client login (`portal.techaust.com`)**
- **Magic link** by email (single-use, expires in 15 minutes) and a long-lived device session.
- No passwords to manage. Each client contact sees only their own organisation's data.

**Roles (permissions enforced on the server for every request)**

| Capability | Owner/Admin | Staff | Sales/BD | Accountant (read-only) |
|---|---|---|---|---|
| Settings, users, roles, gateway and tax config | ✅ | — | — | — |
| Leads & pipeline | ✅ | ✅ | ✅ | — |
| Clients & contacts | ✅ | ✅ | ✅ (no finance tab) | 👁 |
| Projects, milestones, notes, files, time logs | ✅ | ✅ | 👁 | — |
| Proposals & estimates | ✅ | ✅ draft · send ❓ | ✅ draft · send ❓ | 👁 |
| Invoices, credit notes | ✅ | ✅ draft · issue ❓ | — | 👁 |
| Payments, refunds, manual payment recording | ✅ | record manual ❓ · refunds — | — | 👁 |
| Reports & GST/CA exports | ✅ | Partial | Pipeline only | ✅ (exports) |
| Audit log | ✅ | — | — | 👁 (finance events) |

✅ = allowed · 👁 = read-only · — = no access · ❓ = to confirm (Q-P3-2)

**Audit log**
- Append-only: no update or delete through the app.
- Records actor, role, action, entity, before/after summary, IP, user agent and timestamp.
- Covers money actions, logins and security events, documents and clients, and settings.
- Exportable, and kept at least as long as financial records (VERIFY WITH CA).

## 3B.2 Leads, clients and projects

- **Leads:**
  - created by website forms (with source page, service, budget band, UTM) or manually
  - pipeline stages: New → Qualified → Proposal sent → Won / Lost (with a reason)
  - owner, next-action date, notes
  - **convert to client + proposal** in one click
- **Clients (organisations) and contacts:**
  - legal name, display name, **GSTIN** (validated format), state, place-of-supply code, country, currency (INR/USD), billing address, default payment terms, tags
  - multiple contacts with portal access on or off
- **Projects:**
  - linked to a client and to accepted proposals
  - status: Planned → Active → On hold → Completed → Cancelled
  - **milestones** (with amount and due date) that generate invoices
  - notes (internal or shared with the client)
  - **file vault** (private R2 storage; files can be shared to the portal)
- **Care plans / subscriptions:**
  - tier, start date, monthly price, included hours, AI Ops add-on
  - renewal and billing day
  - **hours used vs included** from time logs, with an overage flag
- **Time logs:** person, date, hours, project or care plan, note, billable flag.
- **Dashboard:**
  - pipeline value
  - this month invoiced vs collected
  - overdue invoices
  - active projects and upcoming milestones
  - care-plan hours burn
  - recent activity

## 3B.3 Service catalogue, proposals and estimates

- **Service catalogue**, seeded from 02 §4 (S1–S18). Each entry holds:
  - code, name, description
  - default line items (unit: fixed / milestone / month / hour / workflow / connector / document)
  - INR and USD prices
  - **SAC code** (VERIFY WITH CA)
  - deliverables, assumptions and exclusions text
  - default payment schedule (e.g. 30/40/30)
  - active flag
- **Templates:** one proposal template per category (Advise, Build, Automate, Connect, Run), plus a care-plan block and a standard terms block. **You enter only client, service(s), scope notes and any price changes**; everything else is pre-filled.
- **Proposal** = cover + summary + problem/goals + scope + deliverables + timeline + team + **estimate section** (line items, discounts, tax preview, payment schedule) + terms + acceptance block.
- **Standalone estimate:** line items only, for small jobs and care plans.
- **Versioning:** v1, v2… Each sent version is frozen. The client sees only the latest. **An accepted version is locked forever** and stored as a PDF with a SHA-256 fingerprint.
- **Statuses:** Draft → Sent → Viewed → Accepted / Rejected / Expired (validity date), plus Revised (superseded).
- **Click-to-accept** in the portal:
  - the client types their full name and ticks "I agree to the terms"
  - we record name, email, timestamp, IP, user agent and the fingerprint of the exact version
  - a confirmation email goes to both sides
  - VERIFY WITH CA/LEGAL for enforceability on high-value contracts
- **One-click conversion:** accepted proposal/estimate → project + milestones → invoice(s) per the payment schedule (e.g. a 30% advance invoice created immediately).
- **Branded PDFs:** identical layout system for proposals, estimates, invoices and receipts (`06-design-system.md`), with fonts embedded, including the ₹ glyph.

## 3B.4 Invoices (VERIFY WITH CA/LEGAL throughout)

- **Document types:**
  - **Tax Invoice** (domestic)
  - **Export Invoice** (international, either "under LUT without payment of IGST" with the LUT ARN, or "IGST paid", configurable)
  - **Credit Note** (corrections and refunds)
  - **Receipt** (per payment)
  - **Proforma / advance request**, if your CA advises it (Q-P3-3)
- **Numbering:**
  - a separate gap-free series per type, reset each financial year (1 April)
  - assigned **only when a document is issued** (drafts have none)
  - never reused; voided documents keep their number and are marked void
  - prefix and format editable in settings, with changes logged
- **Tax engine** (pure, fully unit-tested functions):
  - Supplier state: **West Bengal (state code 19)**.
  - Indian client in WB → CGST + SGST. Other Indian state → IGST. Export → zero-rated (LUT) or IGST.
  - Rate per line from the catalogue (default 18%, editable). HSN/SAC per line.
  - Rounding rules set in settings (per line vs per invoice: CA to confirm).
  - Money stored as **integer paise/cents**, never floating point.
- **Mandatory invoice fields** (configurable to the CA's checklist):
  - supplier legal name, trade name and **proprietor name**, GSTIN, address
  - invoice number and date
  - client name, address and GSTIN (if registered)
  - place of supply (state name and code)
  - line descriptions, SAC, quantity, rate, taxable value, tax breakup, total in figures and words
  - reverse-charge statement where applicable
  - signature or authorised-signatory line
- **USD invoices:** stored in USD, with the INR equivalent and the exchange rate used recorded for reporting. The rate source is for the CA to confirm.
- **Discounts** (per line or invoice, fixed or %), **due dates** (default Net 7), **partial payments** (balance tracked), status: Draft → Issued → Partially paid → Paid → Overdue → Void, plus credit-noted.
- **Immutable once issued:** an issued invoice's content and PDF are frozen (stored in R2 with a hash). Corrections are made **only through credit notes**, as GST practice requires.
- **Recurring care-plan invoices:** generated automatically on the billing day. **As a draft for your review, or sent automatically?** (Q-P3-4)
- **Reminders:** at −3, 0, +3, +7, +14 days by email, with a portal link and payment buttons. They stop automatically when paid, can be paused per invoice, and every send is logged.
- **IRP-ready (e-invoicing):** fields reserved for IRN, acknowledgement number and date, and the signed QR. Integration through a GSP can be added if your CA confirms turnover above ₹5 Cr.

## 3B.5 Payments (sandbox / test mode only until you approve going live)

| Method | Currency | How it works |
|---|---|---|
| **Razorpay** | INR | A Payment Link per invoice (partial payments allowed down to a set minimum) supporting UPI, cards and netbanking. Webhook confirms payment. |
| **Stripe** | USD (other currencies later) | Stripe Checkout or Payment Link per invoice. Webhook confirms payment. Stripe's SDK supports Cloudflare Workers natively. |
| **PayPal** | USD | PayPal order per invoice (shown as an option; fees ≈ 7–8% all-in). Webhook confirms payment. |
| **Bank transfer** | INR / USD | Bank details on the PDF and invoice page. Staff record payment manually (amount, date, mode NEFT/RTGS/IMPS/SWIFT, UTR or reference, attached proof such as a FIRA/e-FIRC for exports). |

- **Plug-in gateway design:** one internal "payment provider" interface, so Cashfree or a cross-border account that issues e-FIRAs automatically (Xflow, Skydo, Razorpay MoneySaver) can be added later without a redesign.
- **Payments are a ledger.** Each invoice has payment rows (gateway or manual), and the balance is derived from them. Refunds are linked rows with a credit note.
- **Webhook handling:**
  - Each provider has its own endpoint.
  - **The signature is verified on the raw request body before parsing:**
    - Razorpay: HMAC-SHA256 hex in `X-Razorpay-Signature`
    - Stripe: `Stripe-Signature`, verified with Web Crypto
    - PayPal: its verify-signature flow
  - Comparisons are constant-time.
  - **Idempotency:** each event ID is stored once and duplicates are ignored.
  - An invoice is marked paid **only after a verified webhook or a server-side status check**, never because the browser was redirected.
  - Unmatched or failed events are kept for review in the admin.
- **Receipts:** an automatic receipt (numbered `TH/RCP/…`) is emailed and added to the portal for every successful payment.
- **Reconciliation:** a gateway settlements view (Razorpay settlement report import or API) matched against payments, plus a manual "match bank entry" screen for transfers.
- **We never store card or bank credentials.** All entry happens on the gateway's hosted pages.
- **Regulatory notes (VERIFY WITH CA/LEGAL):**
  - The RBI Payment Aggregator rules cap cross-border transactions at ₹25 lakh each.
  - A new UPI merchant fee (0.4% above ₹2,000, capped at ₹300) is reportedly effective **15 Oct 2026**. Re-check, and expect Razorpay to restate its UPI pricing.
  - For large INR invoices, netbanking or NEFT may be cheaper than UPI.
  - Whether Stripe or PayPal provide valid proof of foreign receipt (FIRA/e-FIRC) for GST export rules is for your CA to confirm.
  - Stripe is invite-only for **new** Indian accounts, but yours is already active.

## 3B.6 Email and notifications

- **Amazon SES (Mumbai)**, called over HTTPS from Workers.
- **Setup (DNS changes need your approval at the time):**
  - Easy DKIM records
  - a custom MAIL FROM subdomain (e.g. `mail.techaust.com`) for SPF alignment
  - DMARC moved from `p=none` → `quarantine` after monitoring (audit L-5)
  - SES starts in **sandbox**: you request production access in the AWS console
- **Emails sent:**
  - proposal / estimate sent and accepted
  - invoice issued
  - payment reminders (−3, 0, +3, +7, +14)
  - payment received + receipt
  - magic-link login
  - lead acknowledgement and internal lead alert
  - 2FA, security and login alerts
  - weekly digest for the owner (optional)
- Templates share the brand tokens, include a plain-text version, and are sent from addresses such as `billing@`, `hello@` and `no-reply@techaust.com` (Q-P3-5).
- **Email log:** recipient, template, SES message ID, status (bounce and complaint notifications via SES events → queue).

## 3B.7 Reports

| Report | Contents |
|---|---|
| Revenue & collections | Invoiced vs collected by month, service, client, currency (INR and USD + INR equivalent); recurring vs project |
| Outstanding & ageing | Unpaid balances in 0–30 / 31–60 / 61–90 / 90+ day buckets; per-client statements |
| Pipeline & win rate | Leads and proposals by stage and value, conversion rates, lost reasons, source pages |
| GST & CA exports | Output tax by rate and type (CGST/SGST/IGST/zero-rated), export invoices, credit notes; GSTR-1-ready CSV and Excel; full invoice and payment registers. **Format to be confirmed with your CA.** |
| Care plans | Hours used vs included per client per month; overage to invoice |

---

# 3C. Architecture and stack

## 3C.1 Is Cloudflare Pages alone enough?

**No.** Static hosting alone (Pages, or Workers static assets) only covers the public pages. We also need:
- server-side logic (forms, admin and portal APIs, webhooks)
- a database
- file storage
- scheduled jobs (reminders, recurring invoices)
- background processing (PDFs, email)

Cloudflare provides all of these on one account (**Workers, D1, R2, Queues, Cron Triggers, Browser Run**). Cloudflare is folding Pages into Workers, so the new build uses **Workers with static assets** throughout. Separately, your current site is already a Workers project (audit §2).

## 3C.2 Recommended architecture (all-Cloudflare, free-plan-compatible)

```text
                       ┌──────────────────────── Cloudflare (free plan) ─────────────────────────┐
 Visitors ──────────▶  │  techaust.com      Worker "web": Astro 6 static assets (free, unlimited)│
                       │                    + /api/forms → validate + Turnstile → Queue (no DB)   │
                       │                                                                          │
 Staff ─────────────▶  │  admin.techaust.com  Worker "admin": React SPA assets + Hono JSON API    │
                       │                      (auth: password+TOTP, RBAC, audit) ──┐              │
 Clients ───────────▶  │  portal.techaust.com Worker "portal": React SPA + Hono API ┤             │
                       │                      (magic link, client-scoped access)    │              │
                       │                                                             ▼             │
 Razorpay/Stripe/ ──▶  │  hooks.techaust.com  Worker "jobs": webhooks (HMAC verify)  D1 (SQLite)  │
 PayPal webhooks       │                      + Queue consumers + Cron triggers ──▶ R2 (files,PDF)│
                       │                      (leads, PDFs via Browser Run, email)                 │
                       └──────────────┬──────────────────────────────┬──────────────────────────────┘
                                      │ SES API (HTTPS, SigV4)       │ nightly (GitHub Actions)
                                      ▼                              ▼
                              Amazon SES Mumbai           encrypted D1 export → AWS S3 Mumbai
```

**Separation of public and private (security boundary):**
- The **public site has no database binding at all**. It can only place validated form submissions on a queue. Even a compromised public page can't read client data.
- Admin and portal are **separate Workers on separate subdomains**, with separate cookies, auth realms and permission checks. The portal API only ever queries data scoped to the logged-in client's organisation.
- Webhooks and background jobs run in a **separate "jobs" Worker** with no user-facing pages.

## 3C.3 Stack choices: options and recommendation

| Layer | Option 1 (**recommended**) | Option 2 | Option 3 | Why option 1 |
|---|---|---|---|---|
| **Hosting / compute** | **Cloudflare Workers, free plan** (≈ ₹0) | Cloudflare Workers Paid ($5 ≈ ₹450/mo) | VPS in Mumbai + Docker (₹1.4–2.7k/mo + ops time) | Your choice. Lowest cost and ops burden; already your vendor. The upgrade path to $5 needs no code changes. |
| **Public site framework** | **Astro 6** (static output, islands) | Next.js 16 via OpenNext | vinext (current site's tool) | Cloudflare bought Astro in Jan 2026. Static output means zero CPU per page view (free-plan safe), top Core Web Vitals and Markdown content. Next.js is heavier on Workers; vinext's own README says it isn't production-ready. |
| **Admin & portal** | **React SPA (Vite + React Router) + Hono API** | React Router v7 framework mode (server-rendered) | Next.js via OpenNext | Pages are built in the browser, and each API call is small (CPU in the low milliseconds), which fits the free plan's 10 ms limit. Server-side rendering adds CPU per request. |
| **Database** | **Cloudflare D1** (SQLite) + **Drizzle ORM** | Neon Postgres (Singapore) via Hyperdrive (₹0–1.1k) | Supabase Postgres (Mumbai, Pro $25) | Free: 5 GB per account, 500 MB per database (years of our data), and 7-day point-in-time restore. Drizzle keeps the code portable to Postgres if a client ever requires India data residency. |
| **Files** | **Cloudflare R2** (private buckets, signed URLs) | S3 Mumbai | Supabase Storage | 10 GB free, no egress fees |
| **Auth** | **Better Auth** (TOTP 2FA, magic links, sessions in D1) with a **custom browser-side Argon2id + server HMAC password hasher** | Small in-house auth module | Clerk / Kinde (free tiers lack 2FA or add cost) | A maintained library with 2FA and magic links. The custom hasher fits the free CPU limit. Lucia is deprecated and Clerk's free tier has no MFA. |
| **PDF generation** | **Cloudflare Browser Run** (HTML/CSS → PDF; free 10 min/day ≈ 100+ PDFs/day), queued and cached in R2 | pdf-lib (hand-positioned layouts; fallback for receipts) | External API (DocRaptor/PDFShift; paid + another data processor) | One HTML template system for web, email and PDF gives a consistent brand. Free at our volume. @react-pdf breaks on Workers. |
| **Email** | **Amazon SES Mumbai** (your choice; ≈ $0.10 per 1,000) | Resend (free 3k/mo, domain already verified) | Cloudflare Email Service (paid plan only) | India region, pennies per month, reliable |
| **Payments** | **Razorpay (INR) + Stripe + PayPal (USD) + manual bank transfer** | + a cross-border e-FIRA account (Xflow/Skydo/MoneySaver) later | Cashfree as INR backup | Uses your active accounts; the plug-in design leaves room for options 2 and 3 |
| **Background work** | **Queues + Cron Triggers** (free: 10k queue ops/day) | Workflows | External cron (GitHub Actions) | Native; fits the free tier |
| **Backups** | **Built-in 7-day restore + nightly encrypted export → S3 Mumbai** (GitHub Actions, free) | R2 only | Both | Your choice. A truly off-site copy, ≈ ₹0–10/mo. Monthly copies kept 6+ years for GST record retention (VERIFY WITH CA). |
| **Monorepo** | **pnpm workspaces** (apps: web, admin, portal, jobs; packages: db, core, auth, pdf, email, ui, config) | Turborepo on top | Separate repos | Shared types, schema and money/tax logic. Simple tooling. |
| **Testing** | **Vitest** (unit/integration, with the Workers test pool) + **Playwright** (end-to-end, accessibility via axe) | Jest | Cypress | Fast, Workers-native, covers the critical logic |
| **CI/CD** | **GitHub Actions:** checks on every PR → auto-deploy to **staging**; **production deploy is a manual, approved step** | Cloudflare Workers Builds (Git-connected) | Manual `wrangler deploy` | Fixes audit H-8 (every push currently ships to production) |
| **Monitoring** | **Workers Logs** (free, 3-day retention) + **Sentry free** (errors) + a free uptime monitor | Cloudflare Observability (pricing changes 2026-12-01) | Paid APM | Free, enough at our scale. Set up in Phase 7. |

**Facts to re-check before committing** (from the research):
- Drizzle 1.0 is still a release candidate. Pin the version.
- Better Auth on Workers.
- Free-plan Browser Run rate limit (1 PDF per 10 s, queued).
- Workers Logs pricing changes on 2026-12-01.
- The UPI fee change effective 15 Oct 2026.

## 3C.4 Free-plan engineering rules

Free plan limits: 10 ms CPU per request, 100k requests/day, D1 5M reads/day, Browser Run 10 min/day.

1. **Nothing heavy per request.** No server-side rendering for admin/portal pages; the public site is fully static; long work goes to queues.
2. **Password hashing in the browser** (Argon2id); server does HMAC only. TOTP and webhook checks are cheap HMACs.
3. **PDFs are rendered once** (on issue or accept), stored in R2 with a hash, and served from R2 afterwards. Generation is queued and paced to the free rate limit.
4. **Cron triggers only enqueue work**; queue consumers do it in small batches.
5. **Upgrade triggers:** if any of the following happens, I'll propose the $5 plan, for your approval:
   - CPU-limit errors above 0.1%
   - PDF quota hit more than twice a month
   - a need for 30-day restore
   - sustained traffic above 50k requests/day

## 3C.5 Environments

| Environment | URL | Data | Payments | Deploy |
|---|---|---|---|---|
| Local | `localhost` (Wrangler, real Workers runtime) | Local D1/R2 with seed data | Gateway **test** keys | Developer machine |
| Staging / preview | `*.workers.dev` or `staging.` subdomains | Separate D1/R2 (anonymised seed) | Gateway **test/sandbox** keys | Auto on merge to `main` |
| Production | `techaust.com`, `admin.`, `portal.`, `hooks.` | Production D1/R2 | Test keys until **your explicit go-live approval** (Phase 7) | Manual approved workflow |

The DNS cutover from the old `techaust-web` Worker happens only in Phase 7, with your explicit approval. The old Worker stays available as a rollback.

## 3C.6 Security (OWASP Top 10 and more)

| Risk (OWASP 2021) | Measures |
|---|---|
| A01 Broken access control | Role checks on the server for every API route; the portal queries each client's own data only (organisation ID taken from the session, never from the request); deny by default; tests for every permission rule |
| A02 Cryptographic failures | TLS everywhere with HSTS; Argon2id (browser) + HMAC with a pepper (server); secrets only in Wrangler or GitHub encrypted secrets; encrypted backups (age/GPG) with the key held offline by you |
| A03 Injection | Drizzle parameterised queries; strict shared validation on every input; output encoding; strict CSP; no `dangerouslySetInnerHTML` on user data; CR/LF stripping on email headers |
| A04 Insecure design | Threat model per module in `08-security-compliance.md`; immutable invoices; append-only audit log; webhook idempotency; money as integers |
| A05 Security misconfiguration | Security headers on **all** responses, including static assets (CSP, HSTS, nosniff, frame-ancestors none, COOP/CORP, Referrer-Policy, Permissions-Policy); Cloudflare minimum TLS 1.2 (approval needed); no debug data in API errors (fixes audit M-1) |
| A06 Vulnerable components | Pinned versions, Dependabot/Renovate, `npm audit` in CI, no beta frameworks in production |
| A07 Identification & authentication failures | Mandatory TOTP for staff; rate limits and lockout; Turnstile; magic links single-use with 15-minute expiry; session rotation; login alerts |
| A08 Software & data integrity | Signed webhooks verified on the raw body; PDF hashes; CI-only deploys; lockfile integrity |
| A09 Logging & monitoring | Audit log, Workers Logs, Sentry, alerts on failed logins, webhook failures and job failures; no personal data in logs |
| A10 SSRF | No user-supplied URLs fetched server-side; outbound calls only to allow-listed hosts (gateways, SES) |
| Abuse / spam | Turnstile, Rate Limiting binding keyed on `CF-Connecting-IP`, free WAF rules, request body-size limits, Origin checks on state-changing requests (fixes audit H-5, M-2) |
| Files | Type and size allow-list, private R2, short-lived signed download URLs, served as downloads (never inline HTML), filenames sanitised |
| Data protection (DPDP, **VERIFY WITH CA/LEGAL**) | Data inventory; purpose-specific notices; GA4 only after consent; retention schedule (leads deleted after N months if not converted; financial records kept per GST/tax law); data-principal request handling (export, delete where lawful); breach response plan; processor list (Cloudflare, AWS, Razorpay, Stripe, PayPal, Google); Cloudflare D1 has no India region (DPDP doesn't currently require India residency, but your lawyer should confirm) |
| Backups & recovery | Built-in 7-day restore + nightly encrypted S3 copy (90 days daily, monthly for 6+ years); **quarterly restore drill** with a written runbook |

---

## 4. Running cost (monthly, at our scale)

| Item | Cost |
|---|---|
| Cloudflare Workers, static assets, D1, R2, Queues, Cron, Browser Run, Turnstile, WAF, Web Analytics | ₹0 (free plan) |
| Amazon SES (≈ 500–2,000 emails) | ≈ ₹5–20 |
| AWS S3 Mumbai (encrypted backups, a few hundred MB) | ≈ ₹0–10 |
| GitHub (private repo, Actions minutes) | ₹0 |
| Sentry (Developer free), uptime monitor (free tier) | ₹0 |
| Payment gateways | Per transaction only (absorbed in prices) |
| Domain renewal | Already paid yearly; unchanged |
| **Total** | **≈ ₹5–50 / month.** If the upgrade triggers in §3C.4 are hit, the $5 plan (≈ ₹450) still fits your ₹500–1,000 budget. |

---

## 5. Open questions for Phase 4

| ID | Question |
|---|---|
| Q-P3-1 | Add a free Cal.com booking link for discovery calls, or keep "preferred time" in the form only? |
| Q-P3-2 | Approval rules: can **Staff/Sales send** proposals, and can **Staff issue invoices or record payments**, or does that need Owner approval? |
| Q-P3-3 | Does your CA want **proforma invoices** for advance payments, or a tax invoice on receipt of the advance? (VERIFY WITH CA) |
| Q-P3-4 | Care-plan monthly invoices: **auto-send** on the billing day, or create a **draft for your review** first? |
| Q-P3-5 | Sender addresses: `billing@`, `hello@`, `no-reply@techaust.com` OK? Which inbox receives replies (Zoho)? |
| Q-P3-6 | Default payment schedule for builds (30/40/30?) and the validity period for proposals (15 or 30 days?) |
| Q-P3-7 | Bank details to print on invoices (account name, number, IFSC, SWIFT for USD), shared securely when we build the settings screen, never in chat or code |
| Q-P3-8 | Your CA's checklist: turnover vs ₹5 Cr (e-invoicing), LUT status for FY 2026-27, SAC codes, rounding, USD conversion rate source, GSTR-1 export format |
| Carried from 02 | Q-B12 legal partner (DPDP page/service and privacy notice) · Q-B13 CA advisor · Q-B14 AMC client count · Q-B15 social handle · Q-B16 case studies · logo file upload · founder headshot and bio |

---

## 6. Phase 3 status

- [x] Interview on every backend module (auth/roles/portal, clients/projects, proposals/estimates, invoices/GST, payments, email, reports) and on site design
- [x] Research: payment gateways (India + international) and platform/stack (2026 facts)
- [x] 3A website plan · 3B admin/portal modules · 3C architecture, options, security, environments, cost
- [x] **Approved by owner 2026-10-06.** Phase 4 (PRD, architecture, design system, content, security and compliance, roadmap, CLAUDE.md) started.
