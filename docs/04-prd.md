# 04: Product requirements (PRD)

| | |
|---|---|
| **Phase** | 4, Project documentation (**APPROVED** 2026-10-06) |
| **Date** | 2026-10-06 |
| **Inputs** | [01-audit.md](01-audit.md) · [02-services-strategy.md](02-services-strategy.md) · [03-plan.md](03-plan.md) (approved) · Phase 4 interview (§0) |
| **Companion docs** | [05 Architecture](05-architecture.md) · [06 Design system](06-design-system.md) · [07 Content](07-content.md) · [08 Security & compliance](08-security-compliance.md) · [09 Roadmap](09-roadmap.md) |

> **Compliance.** Anything touching GST, invoicing law, payments regulation or DPDP is marked **VERIFY WITH CA/LEGAL**. You asked me to act as CA and lawyer. I research current rules and set the best-supported defaults (sources in [08](08-security-compliance.md)), but I am not a licensed professional. Every tax and legal rule below is a **setting**, not hard-coded logic, so it can change without a code release.

---

## 0. Decisions made in Phase 4 (owner interview, 2026-10-06)

| ID | Topic | Decision |
|---|---|---|
| Q-P3-1 | Discovery-call booking | Form asks for a **preferred call window**, plus a **plain link** to a free Cal.com page on the contact and thank-you pages. No embedded widget and no third-party script. |
| Q-P3-2 | Approval rules | **Tiered.** Staff and Sales can send proposals and estimates when the total discount is **≤ 10 %** off catalogue; above that, the Owner approves. Staff can **draft** invoices, but only the Owner **issues** them. Staff can **record** bank transfers, which stay **"pending verification"** until the Owner confirms. **Refunds are Owner-only.** |
| Q-P3-3 | Advances (VERIFY WITH CA) | Both modes are built. **Default: Proforma (payment request, not a GST document) → on payment, a Tax Invoice is issued automatically.** A setting switches to "tax invoice upfront". |
| Q-P3-4 | Care-plan invoices | Created as a **draft for review** on the billing day, with a **per-client "auto-issue" toggle**. |
| Q-P3-5 | Senders | `hello@` (leads, proposals) · `billing@` (invoices, reminders, receipts) · `no-reply@` (magic links, security). Replies go to the Zoho mailboxes, and `contact@` stays the public address. |
| Q-P3-6 | Payment schedule | Builds: **40 / 30 / 30**. Small fixed jobs (under about ₹1 L / $2k: Discovery Sprint, audits, single workflows): **100 % upfront**. Care plans: **monthly in advance**. Proposal and estimate validity: **15 days**. All editable per document. |
| Q-P3-7 | Bank details | **One Indian current account** shows IFSC (INR) and SWIFT (USD). You enter the details yourself in Settings, never in chat or code. |
| Q-P3-8 | CA checklist | **Configurable defaults now**, researched by me ([08 §7](08-security-compliance.md)). The optional one-hour CA review is your decision at launch. |
| Q-B12 | Legal pages | I draft privacy, terms, refund and cookie pages myself (no lawyer). **The S3 DPDP Readiness page stays hidden** (feature flag) until a legal partner exists. |
| Q-B13 | CA advisor | None yet. |
| Q-B14 | AMC clients | 1–3, to migrate to Care Plan tiers at renewal |
| Q-B15 | Social links | **LinkedIn company page + founder's LinkedIn only** (you'll give the URLs) |
| Q-B16 | Case studies | You fill in 2–3 briefs (template in [07 §6](07-content.md)), and I write them up. Missing ones show an honest "coming soon". |
| Assets | Logo / photo / bio | Logo: superseded by the new identity "Patina" (M1.1, [ADR 0013](adr/0013-new-brand-identity.md)). Headshot and bio at the website milestone. |
| Contact | Public contact | **WhatsApp business number** (you'll provide it), with a reply promise of **within 1 business day (Mon–Sat, 10:00–19:00 IST)**. Address shown as **"Balurghat, West Bengal, India"** in the header, footer, schema and Google profile. The **full postal address** appears only on the Contact page and the legal pages (Razorpay checklist and SPDI/E-Commerce rules, VERIFY WITH CA/LEGAL). |
| Identity | Legal pages | "TecHaust Technologies, a sole proprietorship based in Balurghat, West Bengal". **Grievance Officer: Rupak Sarkar, Founder** (`privacy@` / `grievance@` alias). **No GSTIN on the website** (invoices only). |
| Blog | Launch posts | **3 articles** drafted by me and reviewed by you |
| Q-S3 | Care-plan SLAs | **Business hours only:** Essential 2 business days · Growth 1 business day · Scale 4 business hours (critical). Out-of-hours cover is quoted separately. |
| Team | About page | Founder profile + team described **by role**, with no names or photos until each person agrees |
| S4 | Fractional CTO lead | **The founder** |
| Env | Staging | `*.workers.dev`, behind **Cloudflare Access** |
| Numbering | Invoice number length | GST limits invoice serial numbers to **16 characters** (Rule 46(b), VERIFY WITH CA), so the format becomes **`TH/INV/2627/0001`** (16), not `TH/INV/26-27/0001` (17) |

---

## 1. Product overview

### 1.1 Surfaces

| Surface | Host | Users | Purpose |
|---|---|---|---|
| **Public website** | `techaust.com` | Prospects, search engines, AI answer engines | Explain, earn trust, convert to a quote or Discovery Sprint request |
| **Admin** | `admin.techaust.com` | Owner, Staff, Sales/BD, Accountant | Run the business: leads → clients → proposals → projects → invoices → payments → reports |
| **Client portal** | `portal.techaust.com` | Client contacts | View and accept proposals, view and pay invoices, download receipts and files |
| **Hooks / jobs** | `hooks.techaust.com` | Payment gateways, SES, cron | Webhooks, queues, scheduled jobs. No user-facing pages. |

### 1.2 Personas

| Persona | Needs | Key journeys |
|---|---|---|
| **P1 Indian SMB owner / finance head** | Understands the offer quickly, sees INR prices, trusts it's legitimate, can talk on WhatsApp | Home → AI Document Automation → Pricing → Get a quote |
| **P2 International founder / SaaS lead** | Sees senior capability, USD prices, time-zone overlap, IP transfer | Home → MVP & SaaS → How we work → Get a quote → Cal.com |
| **P3 Owner (admin)** | Sees pipeline and cash at a glance, sends documents fast, gets paid, stays GST-clean | Lead → proposal → accept → invoice → paid → GST export |
| **P4 Staff / Sales** | Drafts proposals from templates, logs time, records transfers | Lead → proposal draft → send (≤ 10 % discount) |
| **P5 Accountant (read-only)** | Pulls GST and register exports, checks invoices and payments | Reports → GST export |
| **P6 Client contact** | Opens an emailed link, reviews, accepts, pays, downloads | Email → proposal → accept · Email → invoice → pay → receipt |

### 1.3 Out of scope at launch (see §11 for the "later" list)
- E-invoicing (IRP/IRN) integration. The data model is ready; it switches on if turnover crosses ₹5 Cr (VERIFY WITH CA).
- Task management (stays in your existing tool), payroll, expenses and purchase invoices, and full double-entry accounting.
- Multi-language and a CMS (content is Markdown in the repo).
- Mobile apps.

---

## 2. Conventions

- **IDs:** `WEB-*` website · `FRM-*` forms · `ADM-*` admin · `POR-*` portal · `JOB-*` jobs and hooks · `NFR-*` non-functional. IDs are stable; tests and commits reference them.
- **Priority:** **M** = must for launch · **S** = should for launch · **L** = later.
- **Acceptance criteria (AC)** are written to be testable. Each AC becomes a unit, integration or end-to-end (E2E) test, or a manual checklist item ([09](09-roadmap.md)).
- **Global Definition of Done** (every page and module):
  1. Typecheck, lint and unit tests pass in CI.
  2. No console errors or warnings in the browser.
  3. Works at 375 / 768 / 1280 / 1920 px with no horizontal scroll.
  4. axe finds 0 serious or critical violations, keyboard-only use works, and focus is visible.
  5. Light and dark themes both meet contrast requirements.
  6. Every server route has authorisation tests (admin/portal).
  7. No secrets or personal data in logs.
  8. Fits the free-plan budgets in NFR-2.

---

## 3. Public website

### 3.1 Global requirements

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| WEB-G-01 | M | **Static output.** Every page is prerendered HTML, served as Workers static assets. The only server code on `techaust.com` is `/api/forms/*` and `/api/geo`. | The build emits HTML for every route. Page responses run no Worker script (the asset path is served directly). `CF-Cache-Status` is HIT on repeat views. The page TTFB p75 is < 200 ms from India. |
| WEB-G-02 | M | **No database access** from the public Worker | The `web` Worker's `wrangler` config has no D1, R2, KV, Durable Object or Hyperdrive bindings, only a Queue producer, Turnstile secret and rate limiter. A CI check (`scripts/check-web-bindings.mjs`) fails if any of those bindings is added to `apps/web`. |
| WEB-G-03 | M | **Header**: logo (home link), primary nav (Services ▾, Industries ▾, Pricing, Work, About, Contact), ₹/$ toggle, theme toggle, CTA "Book a Discovery Sprint" | Keyboard: Tab reaches every item. Dropdowns open on Enter/Space, close on Esc and return focus to the trigger. On mobile (< 768 px) a full-screen menu traps focus and closes on Esc. The menu works without JavaScript via `<details>` progressive enhancement. |
| WEB-G-04 | M | **Footer**: short brand line, service and industry links, company links, legal links, contact (email, WhatsApp, "Balurghat, West Bengal, India"), LinkedIn links, cookie-preferences link, ©. **No GSTIN or proprietor name** (the full address appears only on Contact and the legal pages). | Every link resolves (link checker in CI). No `@techaustsocial` anywhere. No GSTIN anywhere on the website (build check). |
| WEB-G-05 | M | **Theme**: light by default. Follows `prefers-color-scheme`; the toggle overrides it and remembers the choice (localStorage). No flash of the wrong theme. | First paint uses the correct theme (inline head script, < 1 KB). Both themes pass AA contrast on every template. |
| WEB-G-06 | M | **Currency**: prices render in INR for visitors from India and USD for everyone else, with a ₹/$ toggle | The HTML contains both values. Without JavaScript both are shown ("from ₹3,00,000 · $12,000"). With JavaScript: a stored preference wins; otherwise a one-time `/api/geo` call (cached 30 days client-side) picks the currency. Switching causes CLS < 0.01. |
| WEB-G-07 | M | **Prices come from the service catalogue**, not hard-coded | Each price on the site is read at build time from a catalogue snapshot (§ADM-CAT-05). Changing a price in the admin and publishing updates the site after the next deploy. A test fails if a `₹` or `$` amount literal appears in page templates. |
| WEB-G-08 | M | **Cookie consent**: Cloudflare Web Analytics (cookieless) always on. GA4 loads **only after "Accept analytics"**. "Reject" is as prominent as "Accept". A preferences link sits in the footer. Google Consent Mode v2 defaults to denied. | No GA requests or `_ga` cookies before consent (E2E check). Choosing Reject sets nothing except a necessary consent-record cookie or localStorage key. The banner is keyboard-accessible, doesn't trap focus, and doesn't cover the main CTA on 375 px screens. |
| WEB-G-09 | M | **SEO**: unique `<title>` ≤ 60 characters and description ≤ 155; canonical on the apex domain (`www` → 301 to apex); OG/Twitter tags with a per-page 1200×630 image; breadcrumbs on deep pages; one `h1` | A CI SEO test checks every built page: title and description lengths, canonical, OG image present, exactly one `h1`, no `noindex` except on thank-you and 404 pages. |
| WEB-G-10 | M | **Structured data**: `Organization` + `ProfessionalService` (name, alternateName, URL, logo, `areaServed` [IN, worldwide], `address` (locality Balurghat, region West Bengal, country IN), `sameAs` LinkedIn, NAICS 541511, `disambiguatingDescription` "Indian software and AI automation studio; not affiliated with Tech Australia"). `Service` per service page, `FAQPage` where there are FAQs, `BreadcrumbList`, `Article` per blog post. **No `SoftwareApplication`.** | Passes the Schema.org validator. No `taxID` or proprietor name in the schema (owner decision: invoices only). |
| WEB-G-11 | M | **Machine files**: `sitemap.xml` (lastmod from content `updated` dates), `robots.txt`, `llms.txt`, `rss.xml` (blog), `/.well-known/security.txt` | The sitemap lists only indexable pages. lastmod values are stable between builds unless the content changes. security.txt has Contact, Expires (≤ 1 year), Policy and Canonical. |
| WEB-G-12 | M | **Security headers on every response, including static assets**: CSP (no `unsafe-inline` for scripts except hashed inline theme/consent scripts), HSTS, `X-Content-Type-Options`, `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy, COOP | A header test against the staging URLs covers HTML, CSS, JS, image and font responses. The CSP allows only self, Cloudflare Insights, Turnstile, and Google Tag Manager/GA after consent. |
| WEB-G-13 | M | **Performance budgets** (NFR-1): ≤ 50 KB gzipped JS per page; fonts self-hosted, subset and preloaded (max 2 files on first view); images AVIF/WebP with width and height set | Lighthouse CI (mobile) on each template: Performance ≥ 95, Accessibility 100, Best Practices 100, SEO 100. Bundle-size check in CI. |
| WEB-G-14 | M | **Honesty rules** (audit C-1, C-2, H-3): no simulated "live" data, no unbacked metrics, no absolute guarantees, no invented people or clients. Demos and diagrams are labelled "Illustrative". | Content lint in CI fails on banned phrases (list in [07 §1.3](07-content.md)), e.g. "100%", "guarantee", "no hallucinations", "ironclad", "LIVE". Exceptions are allow-listed with a comment. |
| WEB-G-15 | M | **Motion** only where it explains something; respects `prefers-reduced-motion` | With reduced motion on, no element animates for more than 200 ms and nothing auto-plays. No infinite animation loops anywhere. |
| WEB-G-16 | M | **Accessibility**: WCAG 2.2 AA throughout. Skip link, landmarks, 44×44 px targets, visible focus, labelled forms, error summaries, language `en-IN` | axe in CI: 0 serious or critical. A manual keyboard and NVDA pass on each template before launch. |
| WEB-G-17 | S | **Feature flags** for content: `S3_DPDP_PAGE` (off), `BLOG` (on), `CASE_STUDIES` (on, with a "coming soon" fallback) | A flagged-off page isn't built and isn't in the sitemap or nav. Its direct URL returns 404. |
| WEB-G-18 | M | **WhatsApp link** (`https://wa.me/<number>?text=<prefilled>`) in the contact page and footer, with business hours shown | The number comes from site config (not repeated in templates). Hidden if the config is empty. |

### 3.2 Page template: service page (`/services/[slug]`)

Every service page uses one template, with sections in this order ([03 §3A.3](03-plan.md)). Copy is in [07 §4](07-content.md).

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| WEB-SVC-01 | M | **Hero**: outcome headline (`h1`), who it's for, "from ₹X / $Y" (WEB-G-06), primary CTA, secondary CTA "See pricing" | The primary CTA links to `/get-a-quote?service=<code>`, and the quote form opens with that service pre-selected. |
| WEB-SVC-02 | M | Sections: The problem · What you get (deliverables list) · How it works (steps + typical timeline + what we need from you) · Pricing & engagement model (incl. payment schedule) · Tech & integrations (text or truthful logos) · Proof · FAQs · Related services · CTA band | Each section has an `h2`. Sections with no content are omitted rather than shown empty. |
| WEB-SVC-03 | M | **Proof** shows a linked case study when one exists for the service, otherwise a sample deliverable labelled "Sample", otherwise the section is omitted | No fabricated testimonials or logos. |
| WEB-SVC-04 | M | **FAQs** (4–8) as an accessible disclosure list + `FAQPage` JSON-LD with identical text | The JSON-LD answers match the visible text (test). |
| WEB-SVC-05 | M | **Payment schedule text** comes from the catalogue entry (e.g. 40/30/30, 100 % upfront, monthly in advance) | Matches the catalogue snapshot. |
| WEB-SVC-06 | M | "Prices exclude GST" note next to INR prices (VERIFY WITH CA). For USD: "Invoiced from India; export of services." | Visible next to every INR price block. |

**Service pages at launch**

| Route | Code | Price source | Primary CTA | Specific requirements |
|---|---|---|---|---|
| `/services/discovery-sprint` | S1 | S1 | Book a Discovery Sprint | Two flavours (Automation Audit / Product Blueprint) side by side; "fee credited to the build within 60 days" |
| `/services/custom-web-apps` | S5 | S5 | Get a quote | Includes the UI/UX section (S8) and an "Excel/Access → web app" sub-section |
| `/services/mvp-saas-development` | S6 | S6 | Get a quote | Staging from day 1, weekly demos, IP transfer on payment, time-zone overlap |
| `/services/mobile-apps` | S7 | S7 | Get a quote | React Native/Expo and Flutter, usually alongside web |
| `/services/ai-document-automation` | S9 | S9 (pilot) | Start a pilot | Pilot → production → AI Ops path; Tally/Zoho/QuickBooks/Xero; human review screens; illustrative workflow diagram |
| `/services/workflow-automation` | S10 | S10 | Automate a workflow | Quick-Win bundle (3–5 workflows) |
| `/services/whatsapp-automation` | S11 | S11 (setup + monthly) | Get a quote | "Meta message charges passed through at cost" |
| `/services/ai-knowledge-assistants` | S12 | S12 | Start a pilot | Access control, citations, quality test set; model costs pass-through |
| `/services/ai-features-for-software` | S13 | S13 | Get a quote | MCP servers, agent-ready APIs |
| `/services/business-systems-integration` | S14 | S14 | Get a quote | Includes the Payments & Billing section (S15) |
| `/services/app-rescue` | S2 | S2 | Book an audit | Audit → hardening sprint → care plan. Penetration testing is out of scope (stated). |
| `/services/dpdp-readiness` | S3 | S3 | Book an audit | **Flag off** until a legal partner exists. "Technical implementation only, legal interpretation by your lawyer" banner. |
| `/services/fractional-cto` | S4 | S4 | Talk to us | Led by the founder |
| `/services/care-plans` | S16 + S17 | S16 tiers, S17 | Choose a plan | Three-tier comparison table; business-hours SLAs (Essential 2 BD, Growth 1 BD, Scale 4 business hours critical); rollover and overage rules; AI Ops add-on |
| `/services/dev-subscription` | S18 | S18 | Start a subscription | "One active request at a time; pause or cancel monthly"; a small number of subscriptions at a time (no scarcity counter) |

### 3.3 Other pages

| ID | Route | Pri | Requirements | Acceptance criteria |
|---|---|---|---|---|
| WEB-HOME | `/` | M | Hero (tagline "Build it right. Automate the rest.", positioning line, 2 CTAs); who we help (India / international); 5 headline services (S5, S9, S10, S14, S6) + Discovery Sprint; how we work in 4 steps; Care Plans teaser; pricing anchors (3 "from" prices); proof (case studies or an honest "coming soon"); FAQ (5); final CTA | A visitor can state what we do, for whom, and the first step within 5 s (5-person hallway test before launch). LCP element is text (no hero image required). No counters or "live" widgets. |
| WEB-SVCHUB | `/services` | M | All services grouped Advise / Build / Automate / Connect / Run, each with a one-liner, "from" price and link | Every launch service is listed exactly once. Flagged-off services are hidden. |
| WEB-IND | `/industries`, `/industries/finance-accounting-legal`, `/industries/retail-ecommerce-logistics`, `/industries/saas-startups` | M | Hub + 3 pages: the industry's problems, 3–5 concrete use cases, relevant services (linked), integrations, FAQ, CTA | Each page links to ≥ 3 services. FAQ JSON-LD present. |
| WEB-PRICING | `/pricing` | M | All "from" prices (by category), care-plan tiers, "What affects price", payment terms (40/30/30 builds; 100 % upfront under ₹1 L / $2k; care plans monthly in advance; **Net 7**; proposals valid 15 days), payment methods (UPI/cards/netbanking via Razorpay; Stripe, PayPal, bank transfer for USD), GST note, Discovery-Sprint credit rule | Every price matches the catalogue snapshot. Payment terms come from settings in the snapshot. |
| WEB-WORK | `/work`, `/work/[slug]` | M | Case-study cards (industry, problem, outcome metric). Detail page: context → problem → approach → stack → results (real metrics only) → what's next. "Anonymised" label. If none: an honest "First case studies coming soon" with a link to sample deliverables. | Each published case study has `verified: true` front-matter, set only after the owner confirms. A build check rejects case studies without it. |
| WEB-HOW | `/how-we-work` | M | 4-step process; engagement models (fixed / retainer / pilot / subscription); fixed-price rules (change requests); IP transfer on payment; time-zone overlap (IST, with overlap windows for UK/EU/US-East); communication cadence; AI-use policy; 30-day warranty; care-plan handover | All statements are consistent with the proposal terms block (shared source text). |
| WEB-AI | `/how-we-build-ai` | M | Production-first AI: test sets, guardrails, human review, data handling (no training on client data, provider choice, India/on-prem options), DPDP awareness, honest limitations. **No absolute claims.** | Passes the content lint (WEB-G-14). |
| WEB-ABOUT | `/about` | M | Founder profile (headshot + bio supplied by the owner), team by role (no names), story, values, location (Balurghat, West Bengal, India), how we work with partners | No fabricated people. The page builds with a placeholder until the headshot arrives; the placeholder is never shipped to production (pre-deploy check). |
| WEB-BLOG | `/blog`, `/blog/[slug]`, `/rss.xml` | M | List (newest first, with tags), post (title, date, updated, reading time, author = founder, ToC on long posts, related services CTA), `Article` JSON-LD. 3 launch posts. | Posts are Markdown with validated front-matter (title, description, date, updated, tags, draft). Drafts are excluded from the build. |
| WEB-CONTACT | `/contact` | M | Short form (FRM-CONTACT), email `contact@techaust.com`, WhatsApp link + hours, **full postal address** (from site config), response promise ("within one business day, Mon–Sat 10:00–19:00 IST"), Cal.com link | Works without JS (plain POST with a server redirect), progressively enhanced with inline validation. |
| WEB-QUOTE | `/get-a-quote` | M | Multi-step quote / Discovery request (FRM-QUOTE) | See §4. |
| WEB-THANKS | `/thanks` | M | Confirmation, what happens next (reply within 1 business day), Cal.com link, links to pricing and how-we-work. `noindex`. | Reached only after a successful submit. Shows a reference number (lead ref). |
| WEB-LEGAL | `/privacy`, `/terms`, `/refund-policy`, `/delivery-policy`, `/cookies` | M | Drafted per [08](08-security-compliance.md); the draft text is in [07-A](07-content-appendix/A-legal-pages.md) (**VERIFY WITH CA/LEGAL**). "Last updated" date and version shown. The cookie page includes the preferences control. **`/delivery-policy`** (how services are delivered: digitally, by milestones and timelines) is required by Razorpay's website checklist, together with Terms, Privacy, Refund, Contact and Pricing ([08-research B](08-research-appendix/B-dpdp-legal.md)). The privacy notice names a **Grievance Officer** (the founder) with a 1-month reply commitment (IT SPDI Rules 2011, in force now) and offers the notice in any Eighth Schedule language on request (DPDP Rule 3, from 13 May 2027). | Each legal page has a version and date in front-matter. Changes are listed in a changelog section. |
| WEB-SEC | `/security` | M | How to report a vulnerability, scope, safe-harbour wording, response targets; links security.txt | security.txt `Policy:` points here. |
| WEB-404 | 404 | M | Helpful links (services, pricing, contact), search-free | Returns HTTP 404 (not 200). `noindex`. No canonical tag pointing at home. |
| WEB-OG | OG images | S | A 1200×630 image per page, generated at build from the title + category using brand tokens | Each page's `og:image` URL exists and is 1200×630. |

---

## 4. Forms and lead capture

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| FRM-01 | M | **One shared schema** (Zod) for each form, used by the browser and the server (fixes audit H-4) | The schema lives in `packages/core`. The browser and server import the same module. A test proves decimals, empty optional fields and Unicode names pass, and that oversize and control characters fail. |
| FRM-QUOTE | M | **Quote / Discovery request**, 4 steps: (1) **service** (pre-selected via `?service=`; "Not sure, recommend something" option); (2) **goals**: what to achieve (textarea, 20–2,000 characters) + current tools (multi-select: Tally, Zoho, Excel, QuickBooks, Xero, Shopify, WhatsApp, Other); (3) **budget band** (INR bands if the currency is INR: < ₹1 L, ₹1–3 L, ₹3–7 L, ₹7–15 L, ₹15 L+, Not sure; USD bands: < $2k, $2–5k, $5–15k, $15–40k, $40k+, Not sure) + **timeline** (ASAP, 1–3 months, 3–6 months, Exploring); (4) **contact**: name, work email, company (optional), country, phone/WhatsApp (optional), preferred call window (IST, with the visitor's local time shown) | Back and forward keep values. Each step validates before moving on. An error summary links to the fields. Works on 375 px. A full submission completes using only the keyboard. Without JavaScript, all steps are shown as one long form. |
| FRM-CONTACT | M | **Contact**: name, email, message (20–2,000), optional company and phone | As above. |
| FRM-02 | M | **Spam protection**: Turnstile (managed, invisible where possible), a honeypot field, a minimum fill time of 3 s, and a **rate limit of 5 submissions per 10 min per `CF-Connecting-IP`** and 50 per day per IP | Requests without a Turnstile token, or with a filled honeypot, get a generic 400 (no detail). The 6th request in 10 min gets 429. The rate-limit key never uses `X-Forwarded-For` (fixes audit H-5). |
| FRM-03 | M | **Hardening**: `POST` only; `Content-Type` `application/x-www-form-urlencoded` or JSON; body ≤ 16 KB; an Origin check (`https://techaust.com`, or staging); CR/LF stripped from anything that reaches an email header; no debug output in errors (fixes audit M-1, M-2) | Tests: a 17 KB body → 413; a foreign Origin → 403; `\r\n` in the name never appears in a header; error JSON contains only `{ok:false, error:"…"}`. |
| FRM-04 | M | **Pipeline**: valid submission → **Queue** message → the jobs Worker creates a **Lead** (ADM-LEAD), sends an **internal alert** (to the owner) and an **acknowledgement email** to the visitor (from `hello@`) | E2E on staging: submit → the lead appears in the admin within 60 s → both emails are logged as sent. If the queue consumer fails, the message retries (max 5) and then goes to a dead-letter queue, with an admin alert. |
| FRM-05 | M | **Consent notice** beside the submit button: purpose, link to `/privacy`, and how to withdraw. No pre-ticked boxes. An optional, unticked "Send me occasional updates" checkbox (marketing consent stored separately). (VERIFY WITH CA/LEGAL) | The stored lead holds a **consent receipt**: notice version, purposes, timestamp, IP hash, marketing flag and withdrawal timestamp (if any). Under DPDP the business must be able to prove consent. Withdrawing is as easy as giving consent (a link in every non-transactional email). |
| FRM-06 | M | **Attribution**: source page, referrer host, UTM parameters (first-touch, stored in sessionStorage), service and currency | Stored on the lead. No third-party cookies. |
| FRM-07 | M | **Lead reference**: a human-friendly reference (e.g. `L-7K3Q9`) shown on `/thanks` and in the acknowledgement email | Unique. Not sequential (no enumeration). |

---

## 5. Admin (`admin.techaust.com`)

### 5.1 Global admin requirements

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-G-01 | M | **SPA shell** (React Router 8, data mode): left nav (Dashboard, Leads, Clients, Projects, Care plans, Time, Catalogue, Proposals, Estimates, Invoices, Payments, Reports, Approvals, Audit log, Settings), top bar (search, notifications, user menu), breadcrumbs | Usable at 375 px for: dashboard, lead view/edit, recording a payment, approvals. All screens work from 768 px up. |
| ADM-G-02 | M | **Server-side permission check on every API route** (deny by default), using the matrix in §9 | Each route has an automated test per role (allowed / denied). The UI hides what a role can't do, but the server is the source of truth. |
| ADM-G-03 | M | **Lists**: server-side keyset pagination (25/50 rows), sort, filters, search; filters kept in the URL | 1,000-row fixtures load a page in < 300 ms (API p95, staging). |
| ADM-G-04 | M | **Forms** validate with the shared schemas; unsaved-changes warning; optimistic UI only where safe (never for money actions) | Money actions show a confirmation dialog summarising the amount and the target. |
| ADM-G-05 | M | **Global search** across leads, clients, contacts, projects, documents (by number) | Returns within 500 ms on staging data. Results respect role permissions. |
| ADM-G-06 | M | **Audit log** entry for every create/update/delete on business records, every money action, every login or security event and every settings change (ADM-AUD) | A test asserts that each mutating route writes an audit row. |
| ADM-G-07 | M | **Money** stored as integer minor units (paise/cents) with a currency code. Formatting via `Intl.NumberFormat('en-IN')` for INR (₹1,23,456.00) and `en-US` for USD. | Property tests: format/parse round-trip; no floats in money paths (a scanning test, `packages/core/test/no-floats.test.ts`). |
| ADM-G-08 | M | **Dates** stored in UTC, displayed in IST (Asia/Kolkata). The financial year runs 1 April – 31 March. | FY boundary tests (31 Mar 23:59 IST vs 1 Apr 00:00 IST). |
| ADM-G-09 | S | **Notifications** in-app (bell) + email for: new lead, proposal viewed/accepted, payment received, approval requested, webhook failure, job failure | Each notification links to the record. |

### 5.2 Authentication and users (ADM-AUTH)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-AUTH-01 | M | **Email + password + mandatory TOTP** for all staff roles | A user can't reach any data route until TOTP is enrolled and verified. |
| ADM-AUTH-02 | M | **Browser-side Argon2id** (WASM, in a Web Worker) → the server stores `HMAC-SHA-256(pepper, salt ‖ clientHash)` (design in [05 §6](05-architecture.md)) | Server CPU for login ≤ 5 ms p99, measured in Phase 6 M1.4 (`docs/runbooks/cpu-baseline.md`, PR #7). If it doesn't fit, I stop and ask. The salt lookup for an unknown email returns a deterministic fake salt (no user enumeration). |
| ADM-AUTH-03 | M | **Password policy**: ≥ 12 characters, checked against a top-100k breached-password list (k-anonymity HIBP check from the browser, optional) and a zxcvbn-style strength score ≥ 3 | Weak passwords are rejected with a helpful message. |
| ADM-AUTH-04 | M | **TOTP** (RFC 6238, 30 s, 6 digits, ±1 step) + **10 single-use recovery codes** (shown once, stored hashed) | A replayed code within its window is rejected. A used recovery code can't be reused. |
| ADM-AUTH-05 | M | **Sessions**: HttpOnly, Secure, `SameSite=Strict`, `__Host-` prefix, admin host only; 12 h idle / 7 days absolute; rotation on login and on privilege change; active-sessions list with remote sign-out | Tests for each expiry. Signing out everywhere invalidates all sessions instantly. |
| ADM-AUTH-06 | M | **Brute-force protection**: per-IP and per-account rate limits; Turnstile after 3 failures; 15-min lockout after 10 failures in 1 h, with an email alert to the user and the owner | Tests simulate each threshold. |
| ADM-AUTH-07 | M | **Users** (Owner only): invite by email (single-use link, 48 h), assign a role, deactivate (immediately kills sessions), reset 2FA (requires owner TOTP re-entry) | At least one active Owner must exist (deactivating the last Owner is blocked). |
| ADM-AUTH-08 | M | **Re-authentication** (TOTP prompt) for sensitive actions: issuing an invoice, refunds, changing bank or gateway settings, user/role changes, data exports | A step-up token is valid for 10 min. |
| ADM-AUTH-09 | M | **Login alerts**: an email on login from a new device/browser, and on a 2FA change | Logged in the audit log. |
| ADM-AUTH-10 | S | **Cloudflare Access** can be switched on in front of `admin.` without code changes | Documented in [08](08-security-compliance.md). The app works behind Access. |

### 5.3 Settings (ADM-SET), Owner only unless stated

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-SET-01 | M | **Company profile**: trade name, legal name (proprietor's name), GSTIN (validated: 15-char format + checksum), PAN (derived from GSTIN), principal place of business, state + code (WB 19), email/phone for documents, logo (light/dark), signature image (optional) | GSTIN checksum test vectors pass. Changes are audit-logged with before/after. |
| ADM-SET-02 | M | **Bank details**: INR block (account name, number, IFSC, bank, branch) and a USD/SWIFT block (SWIFT/BIC, bank address, intermediary bank if any, purpose-code hint). **Entered by the owner in this screen only.** | Stored in D1. Displayed masked in the admin (last 4 digits), in full on documents. Edits need step-up auth and are audit-logged. Never logged in plain text. |
| ADM-SET-03 | M | **Tax settings** (VERIFY WITH CA): default GST rate (18 %), per-line override allowed, SAC defaults per category, rounding mode (default: tax per line to 2 decimals, grand total rounded to nearest ₹1 with a "Round off" line), export mode default (**under LUT** / IGST paid), LUT ARN + validity FY, USD→INR rate source (default: RBI reference rate on invoice date, entered or fetched), e-invoicing switch (off), reverse-charge text | Every tax-engine test reads its settings from fixtures, not constants. Changing a setting affects only new documents. |
| ADM-SET-04 | M | **Numbering** per document type: prefix, FY token format, padding, next number (read-only once used), reset each 1 April. Defaults: `TH/INV/2627/0001` (tax invoice), `TH/EXP/2627/0001` (export invoice), `TH/CN/2627/0001` (credit note), `TH/DN/2627/0001` (debit note), `TH/RV/2627/0001` and `TH/RF/2627/0001` (receipt/refund vouchers, used only in receipt-voucher mode), `TH/RCT/2627/0001` (payment receipt, not a GST document), `TH/PI/2627/0001` (proforma), `TH/EST/2627/0001` (estimate), `TH/PRP/2627/0001` (proposal; versions shown as "v2") | For every series, a validator rejects formats that can exceed **16 characters** or use characters other than A–Z, 0–9, `/` and `-` (GST requires this for invoice, export, credit/debit note and voucher series). Format changes are audit-logged. Next numbers can't be decreased. |
| ADM-SET-05 | M | **Payment terms**: default Net 7; reminder offsets (−3, 0, +3, +7, +14); default schedules per catalogue category (40/30/30 builds; 100 % small jobs; monthly in advance for care plans); proposal validity 15 days; Razorpay minimum partial amount (default ₹10,000 or the full balance if lower); advance mode (Proforma → Tax invoice / Tax invoice upfront / Receipt voucher), **overridable per client and per document** (some B2B clients pay only against a tax invoice) | Effective for new documents only. |
| ADM-SET-06 | M | **Gateways**: per provider, a mode (test/live) and a status. **Keys are not entered here.** They live in Wrangler secrets; the screen shows only "configured / missing" and the mode. **Live mode can't be selected until the owner's go-live approval flag (Phase 7) is set via a deploy-time variable.** | With `PAYMENTS_LIVE_ALLOWED=false`, the API rejects switching to live. |
| ADM-SET-07 | M | **Email settings**: sender identities (hello@, billing@, no-reply@), reply-to, BCC-to-owner toggle per template, footer text | Test-send button per template (to the current user only). |
| ADM-SET-08 | M | **Document terms**: standard terms block, proposal terms, invoice footer notes, export declaration text, refund-policy link | Versioned. Documents store the version used. |
| ADM-SET-09 | M | **Data retention** (VERIFY WITH CA/LEGAL): unconverted leads deleted N months after last activity (default 12, and never below the 1-year minimum in DPDP Rule 8(3)), email logs 13 months, **security/access logs ≥ 13 months** (DPDP Rule 6 asks for 1 year; CERT-In asks for 180 days), audit log and financial records **10 years** by default, never below 8 years from the FY end (≥ 72 months after the annual return due date; s.36). Financial records are never hard-deleted. **Legal hold** flag on a client or contact suspends erasure. | A nightly job enforces it. A dry-run report is shown before the first enforcement. Records under legal hold are never deleted (test). |
| ADM-SET-10 | S | **Feature flags** (site and admin): S3 page, blog, Cal.com link URL, WhatsApp number, GA4 measurement ID | Website flags apply on the next deploy. |

### 5.4 Dashboard (ADM-DASH)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-DASH-01 | M | Tiles: pipeline value (open proposals, INR + USD in INR equivalent), invoiced vs collected this month and this FY, overdue invoices (count + amount), payments pending verification, active projects, upcoming milestones (14 days), care-plan hours burn (≥ 80 % flagged), recent activity (last 20 audit events the user can see) | Numbers match the report queries for the same period (tested with fixtures). Role-filtered (Sales sees pipeline only; Accountant sees finance only). |
| ADM-DASH-02 | S | A weekly owner digest email (Monday 09:00 IST): the same figures, plus new leads and upcoming reminders | Can be switched off in settings. |

### 5.5 Leads (ADM-LEAD)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-LEAD-01 | M | A lead is created from website forms (FRM-04) or manually: contact name, email, phone, company, country, service, budget band, timeline, message, source page, UTM, currency, consent record | Website leads are marked `source=web` with the form version. Duplicates (same email within 30 days) are linked, not merged automatically. |
| ADM-LEAD-02 | M | **Pipeline stages**: New → Qualified → Proposal sent → Won / Lost (lost reason required: price, timing, scope fit, no response, chose competitor, other). Kanban + list views. | Moving to "Proposal sent" happens automatically when a linked proposal is sent. Won happens automatically when a linked proposal is accepted (with a manual override). |
| ADM-LEAD-03 | M | Owner (assignee), next-action date + note, activity timeline (notes, emails sent, stage changes) | Overdue next actions are highlighted and listed on the dashboard. |
| ADM-LEAD-04 | M | **Convert** → creates a Client + primary Contact (pre-filled) and opens a draft proposal (service pre-selected) | Conversion is atomic. The lead links to the client and proposal. |
| ADM-LEAD-05 | M | **Retention**: unconverted leads are auto-deleted per ADM-SET-09, with a 14-day "scheduled for deletion" view | A deletion writes an audit entry with no personal data (lead ref only). |
| ADM-LEAD-06 | S | Reply-from-admin: send a templated or free-text email from `hello@` (logged in the timeline) | Uses the email pipeline (JOB-Q-01). |

### 5.6 Clients and contacts (ADM-CLI)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-CLI-01 | M | **Client (organisation)**: legal name, display name, type (business / individual), country, **GST status** (registered / unregistered / overseas), GSTIN (validated, with the state derived from its first 2 digits), state + place-of-supply code, billing address, shipping/service address (optional), currency (INR/USD, fixed once any invoice exists), default payment terms (override), reminder override (on/off, custom offsets), care-plan auto-issue toggle (Q-P3-4), tags, notes | Changing currency after the first invoice is blocked. A GSTIN state that doesn't match the selected state shows a warning (not a block, VERIFY WITH CA). |
| ADM-CLI-02 | M | **Contacts**: name, email, phone, role/title, primary flag, billing-contact flag, **portal access on/off**, **can see finance** (default on for billing contacts), marketing consent | A contact without portal access can't receive a magic link. Emails are unique per client. |
| ADM-CLI-03 | M | Client page tabs: Overview (balance, overdue, lifetime billed), Contacts, Projects, Proposals & estimates, Invoices & payments (hidden for Sales), Files, Care plans, Activity | Sales role can't see the finance tabs (API also denies). |
| ADM-CLI-04 | M | **Statement of account** (PDF/CSV): opening balance, invoices, credit notes, payments, closing balance for a date range | Totals reconcile with the ledger (test). |
| ADM-CLI-05 | M | **Data-subject tools** (VERIFY WITH CA/LEGAL): export all personal data for a contact (JSON); erase or anonymise a contact where lawful (financial documents keep the legally required fields) | The action is audit-logged. Erasure is blocked while a contact appears on an issued document, unless anonymisation is chosen. |

### 5.7 Projects, milestones, notes, files (ADM-PRJ)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-PRJ-01 | M | **Project**: client, name, code (e.g. `PRJ-0007`), linked proposal version, status (Planned → Active → On hold → Completed → Cancelled), start/target dates, owner, currency, budget (from the proposal) | Created automatically on proposal acceptance (ADM-PROP-09), or manually. |
| ADM-PRJ-02 | M | **Milestones**: title, amount (or %), due date, status (Pending → Ready to bill → Invoiced → Paid), link to the invoice | "Ready to bill" offers "Create invoice" (draft) with the amount pre-filled. The sum of milestones = the project fee (warning if not). |
| ADM-PRJ-03 | M | **Notes**: rich text (sanitised Markdown), visibility internal / shared with client (shown in the portal) | Shared notes appear in the portal. Internal ones never do (API test). |
| ADM-PRJ-04 | M | **File vault**: upload to private R2 (≤ 25 MB per file; allow-list: pdf, png, jpg, webp, docx, xlsx, csv, txt, zip); per file: shared with portal yes/no; download via short-lived signed URL (5 min) with `Content-Disposition: attachment` | A disallowed type is rejected (checked by magic bytes, not just extension). Filenames are sanitised. A portal user can't fetch an unshared file (test). |
| ADM-PRJ-05 | M | Project dashboard: milestones timeline, billed vs paid, hours logged, recent notes/files | Figures match the ledger and time logs. |

### 5.8 Care plans (ADM-CARE)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-CARE-01 | M | **Care plan / subscription**: client, tier (Essential / Growth / Scale / Dev Subscription / custom), price per month, currency, included hours, AI Ops add-on (price), start date, billing day (1–28), status (Active / Paused / Cancelled), rollover rule (none / 1 month), overage rate | Billing day restricted to 1–28. |
| ADM-CARE-02 | M | **Monthly invoice** generation on the billing day (JOB-CRON-02): draft by default; auto-issue + send if the client toggle is on (Q-P3-4). Billed monthly in advance. | Idempotent: running the job twice creates one invoice per plan per period. Tested across month ends and the FY boundary. |
| ADM-CARE-03 | M | **Hours used vs included** for the period, from time logs, with an overage flag at 80 % / 100 % and "Add overage to next invoice" | Overage = (used − included − rollover) × rate. Tested. |
| ADM-CARE-04 | S | Pause/cancel with an effective date; proration off by default (VERIFY WITH CA for GST on cancelled periods) | |

### 5.9 Time logs (ADM-TIME)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-TIME-01 | M | Entry: person (self; Owner can log for others), date, hours (0.25 steps, ≤ 24 per day), project or care plan, note, billable flag | Validation tests. A person can't log more than 24 h on one day. |
| ADM-TIME-02 | M | Weekly timesheet view; filters by person, project, care plan; CSV export | Totals match the entries. |
| ADM-TIME-03 | M | Logs are editable for 7 days by the author, then locked (Owner can still edit, audit-logged) | |

### 5.10 Service catalogue (ADM-CAT)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-CAT-01 | M | Seeded from 02 §4 (S1–S18) | The seed is idempotent and versioned in the repo. |
| ADM-CAT-02 | M | **Entry**: code, name, category (Advise/Build/Automate/Connect/Run), short and long description, unit (fixed / milestone / month / hour / workflow / connector / document), INR and USD "from" prices, default line items, **SAC** (VERIFY WITH CA), GST rate override, deliverables, assumptions, exclusions, default payment schedule, website slug + "show on website" flag, active flag | Inactive entries can't be added to new documents. Existing documents are unaffected (they snapshot the line). |
| ADM-CAT-03 | M | **Templates** per category (Advise, Build, Automate, Connect, Run) + care-plan block + standard terms block, with placeholders (`{{client.name}}`, `{{service.deliverables}}` …) | Rendering a template with test data produces no unresolved placeholders (test). |
| ADM-CAT-04 | M | Price history: each change is recorded (who, when, old → new) | Audit-logged. |
| ADM-CAT-05 | M | **Publish to website**: produces a public catalogue snapshot (public fields only: code, name, slug, category, from-prices, unit, payment-schedule text, published payment-terms settings) used by the website build | The snapshot JSON validates against a schema. It contains no internal fields (test). Publishing triggers a staging rebuild. Production follows the normal approved deploy. |

### 5.11 Proposals (ADM-PROP)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-PROP-01 | M | **Create** from a lead or client: choose the service(s) → the matching template pre-fills everything; the user edits the scope notes, line items and prices | Creating a proposal for a lead with a service pre-selected takes ≤ 5 clicks to a sendable draft (UX check). |
| ADM-PROP-02 | M | **Sections**: cover, summary, problem/goals, scope, deliverables, timeline (milestones), team (roles), **estimate section** (line items, discounts, tax preview, payment schedule), assumptions & exclusions, terms (versioned), acceptance block | Each section can be reordered or hidden, except the estimate, terms and acceptance sections, which are always present. |
| ADM-PROP-03 | M | **Estimate section maths** (the shared tax engine, ADM-INV-05): line discounts (fixed/%), document discount, tax preview by place of supply, payment schedule computed from % and rounded so that the instalments sum exactly to the total | Property test: the instalments always sum to the total (paise exact). |
| ADM-PROP-04 | M | **Discount guard** (Q-P3-2): if the total discount vs catalogue prices is > 10 %, Staff/Sales can't send; "Request approval" goes to the Owner (ADM-APR) | API test: a Sales send with an 11 % discount → 403 `approval_required`. After approval → allowed for that version only. |
| ADM-PROP-05 | M | **Versioning**: v1, v2 … Sending freezes a version (content + PDF + SHA-256). Editing a sent proposal creates a new draft version; the previous one becomes "Revised (superseded)". The client sees only the latest sent version. | Frozen versions are immutable (API rejects updates; DB trigger blocks them). |
| ADM-PROP-06 | M | **Statuses**: Draft → (Pending approval) → Sent → Viewed → Accepted / Rejected / Expired, plus Revised. Expiry = sent date + validity (default 15 days). | Viewed is set on the first portal view by a client contact (not by staff previews). The expiry job runs daily. |
| ADM-PROP-07 | M | **Send**: email (from `hello@`) to the chosen contacts with a portal link; the PDF is attached optionally (default: link only) | The email is logged. The portal link opens the proposal after magic-link sign-in, or via a single-document view token (POR-06). |
| ADM-PROP-08 | M | **Click-to-accept** (portal): the client types their full name, ticks "I have read and agree to the terms" and accepts. We record name, email, timestamp (UTC), IP, user agent and the **SHA-256 of the exact version's PDF**. A confirmation email goes to both sides with the accepted PDF. (VERIFY WITH CA/LEGAL for high-value contracts) | An accepted version is **locked forever**. A second acceptance is impossible. Acceptance of an expired or superseded version is rejected. |
| ADM-PROP-09 | M | **On acceptance** (one click or automatic, per a setting; default one click "Start project"): create the Project + milestones from the payment schedule → create the **first instalment document** (Proforma or Tax invoice per the advance mode) as a draft for the Owner to issue | The created amounts equal the schedule. Idempotent (double click → one project). |
| ADM-PROP-10 | M | Reject with a reason (client) and revise | The reason is shown on the lead/proposal. |

### 5.12 Estimates (ADM-EST)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-EST-01 | M | A **standalone estimate** = line items + terms summary + validity, for small jobs and care plans. Same tax engine, statuses, versioning, approval guard and acceptance as proposals. | Shares code with proposals (tests run on both types). |
| ADM-EST-02 | M | Convert an accepted estimate → invoice draft (100 % upfront small job) or care plan | Amounts match. |

### 5.13 Invoices (ADM-INV), VERIFY WITH CA/LEGAL throughout

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-INV-01 | M | **Document types**: Tax Invoice (domestic), Export Invoice (under LUT / IGST paid), Credit Note, **Debit Note** (upward corrections, because invoices are immutable; s.34(3)), Payment Receipt (per payment; **not** titled "Receipt Voucher", which is a defined GST document), Proforma (payment request; **not a tax invoice**, clearly titled "Proforma Invoice – not a tax invoice"). Optional **receipt-voucher mode** (Rule 50 Receipt Voucher on an advance, Rule 51 Refund Voucher if cancelled), off by default. | Each type has its own number series, template and validation rules. |
| ADM-INV-02 | M | **Lifecycle**: Draft → Issued → Partially paid → Paid, plus Overdue (computed) and Void (keeps its number; content frozen; reason required). Credit-noted states: partially/fully credited. | Status is derived from the ledger, not set manually (except Void). Tests for every transition. |
| ADM-INV-03 | M | **Numbering**: assigned **only at issue**, gap-free per series per FY, never reused, atomic (no duplicates under concurrent issue) | A concurrency test issues 20 invoices in parallel → 20 consecutive numbers, none duplicated. FY rollover test. |
| ADM-INV-04 | M | **Issue = Owner only** (Q-P3-2), with step-up auth. Staff can "Request issue" (ADM-APR). | API tests per role. |
| ADM-INV-05 | M | **Tax engine** (pure functions in `packages/core/tax`, 100 % branch coverage): supplier state WB (19); client in WB → CGST + SGST (half each); other Indian state → IGST; overseas → export (LUT: 0 % IGST with the LUT declaration; IGST paid: IGST at the rate); unregistered Indian clients: the state of the client's address on record (no address → West Bengal); tax per line per tax head = round-half-up(taxable × rate) in paise, with CGST and SGST computed separately at half the rate each; per-line rate and SAC; rounding per ADM-SET-03; amount in words (Indian system for INR: lakh/crore, written "Rupees … and … Paise Only"; international for USD, written "US Dollars … and … Cents Only") | Golden tests: a table of ≥ 40 cases (intra/inter/export, discounts, mixed rates, rounding edge cases like ₹0.005, credit notes) with expected paise outputs. |
| ADM-INV-06 | M | **Mandatory fields** (configurable checklist; defaults from Rule 46, VERIFY WITH CA): supplier legal name (proprietor) + trade name, address, GSTIN; invoice number and date; client name, address, GSTIN if registered; place of supply (state name + code); line description, SAC, quantity, unit, rate, discount, taxable value, tax rate and amount per tax type; totals in figures and words; reverse-charge statement ("Tax payable on reverse charge: No"); signature/authorised signatory; "ORIGINAL FOR RECIPIENT" marking (Rule 48); export declaration for exports; country of destination for exports; bank details; payment link/QR. For unregistered clients with an invoice value ≥ ₹50,000: name, address and state are required. | Issuing is blocked if any mandatory field is missing (a validation list is shown). Test per field. |
| ADM-INV-07 | M | **Immutability**: at issue, the content snapshot + PDF are stored in R2 with a SHA-256 hash; the DB row is locked by a trigger. Corrections happen **only via credit notes**. | The update API returns 409 for issued invoices. A DB trigger blocks direct updates to frozen fields. |
| ADM-INV-08 | M | **USD invoices**: stored in USD; the INR equivalent and the exchange rate (value, date, source) are recorded at issue for GST reporting (Rule 34, VERIFY WITH CA) | The rate is required to issue a USD invoice. The rate can be entered manually or fetched (RBI reference rate). |
| ADM-INV-09 | M | **Discounts** per line or per invoice (fixed or %); **due date** default Net 7 (client override); **partial payments** with a running balance | Balance = total − payments + refunds − credits (ledger test). |
| ADM-INV-10 | M | **Proforma flow** (default advance mode): Proforma issued (own series, not reported as a GST invoice) → on full or partial payment, a **Tax Invoice for the amount received** is issued automatically (number assigned, PDF, email) and linked to the proforma; the proforma shows "Converted". If the proforma is for **work already delivered** and stays unpaid for 25 days, the Owner is warned to issue the tax invoice (services invoices are due within 30 days of supply, Rule 47, VERIFY WITH CA). | E2E: proforma → sandbox payment → tax invoice issued with the next number; both linked. |
| ADM-INV-11 | M | **Credit notes**: against one issued invoice; full or partial (by line or amount); reason; tax reversed proportionally; own series; reduces the balance; PDF + email; **hard block** on issuing after 30 November following the end of the FY of supply, or the annual-return date if earlier (s.34, VERIFY WITH CA); reported in GSTR-1 Table 9B. Since 1 Oct 2025 our tax reduces only once a registered client reverses its input credit (IMS); the credit note shows a status for that. | Can't exceed the invoice's remaining creditable amount (test). |
| ADM-INV-12 | M | **Recurring** care-plan invoices (ADM-CARE-02) | |
| ADM-INV-13 | M | **Reminders**: email at −3, 0, +3, +7, +14 days relative to the due date (settings and client overrides) with a "View & pay" link; they stop when paid or voided; can be paused per invoice; every send is logged | A job test with a fake clock: exact days, no duplicates, stops after payment. Reminders are sent only 09:00–19:00 IST. |
| ADM-INV-14 | M | **IRP-ready fields** (empty at launch): IRN, Ack No, Ack date, signed QR, e-invoice status | The schema has the columns. The PDF shows the QR block only when an IRN exists. |
| ADM-INV-15 | M | **Send**: from `billing@` with a "View & pay" link (POR-06) and a PDF download link. A PDF attachment is optional per client (off by default: base64 encoding costs CPU on the free plan) | Logged. |
| ADM-INV-16 | S | **Manual TDS adjustment** line on a payment (client deducted TDS; section default "393(1) [old 194J]" under the Income-tax Act 2025): records the TDS amount as a receivable, not a discount | The balance treats TDS as settled. Reported separately for matching against Form 26AS/AIS. |
| ADM-INV-17 | M | **Export realisation tracker** (VERIFY WITH CA): every export invoice tracks receipts against it, with a FIRA/FIRC/e-FIRA/payment-advice reference + file per receipt (**PayPal e-FIRAs are kept only 12 months on PayPal's side, so we archive them; Stripe gives no FIRA, so use your bank's FIRC**). Warn at **9 months** unrealised (FEMA limit from 1 Oct 2026); escalate at **12 months + 15 days** (GST: IGST + interest under the LUT bond). | Fake-clock tests on both thresholds. The dashboard lists exports approaching each threshold. |
| ADM-INV-18 | M | **LUT guard**: an LUT-mode export invoice can't be issued unless an LUT ARN for that FY is saved in settings. From 1 March each year, a reminder to file the next FY's LUT (Form RFD-11). | Test: no ARN for FY 2026-27 → issue blocked with a clear message. |
| ADM-INV-19 | M | **Unbilled work alert**: a milestone marked delivered with no tax invoice after 25 days → owner alert (Rule 47's 30-day limit). Care plans (continuous supply) are invoiced on or before the payment due date (s.31(5)). | Job test. |

### 5.14 Payments (ADM-PAY), sandbox/test only until go-live approval

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-PAY-01 | M | **Provider interface** (`PaymentProvider`: `createCheckout`, `verifyWebhook`, `parseEvent`, `fetchStatus`, `refund`) with Razorpay, Stripe, PayPal and Manual implementations | Contract tests run against each provider's sandbox recordings. |
| ADM-PAY-02 | M | **Razorpay** (INR): a Payment Link created on demand for the current balance (or a chosen partial amount ≥ the minimum), with UPI, cards and netbanking; expiry 7 days; reference = invoice ID | The link amount = balance (paise). Partial payments are allowed down to the minimum. |
| ADM-PAY-03 | M | **Stripe** (USD): a Checkout Session created on demand for the balance | Session metadata carries the invoice ID. Success is set only by the webhook. |
| ADM-PAY-04 | M | **PayPal** (USD): Orders v2 create → buyer approves → server capture → webhook | Marked paid only after a successful server capture response or a verified webhook. |
| ADM-PAY-05 | M | **Bank transfer**: details shown on the PDF and the invoice page; the client can click "I've paid" + reference (notifies staff); staff record the payment: amount, date, mode (NEFT/RTGS/IMPS/UPI/SWIFT), UTR/reference, bank charges (absorbed), proof attachment (e.g. FIRA/e-FIRC for exports) | **Staff-recorded payments stay "Pending verification"** (they don't count toward the balance) until the Owner confirms (Q-P3-2). Owner-recorded payments are confirmed immediately. |
| ADM-PAY-06 | M | **Ledger**: payments are rows (gateway/manual) linked to an invoice; the balance is derived; overpayments are held as client credit (Owner decides: refund or apply) | Ledger invariants are property-tested. |
| ADM-PAY-07 | M | **Webhooks** (JOB-HOOK) verified on the raw body; idempotent by event ID; a mismatch, failure or unknown invoice → "Needs review" queue in the admin | Duplicate delivery → one payment row (test). |
| ADM-PAY-08 | M | **Refunds** (Owner only, step-up auth): full/partial via the gateway API or manual; always paired with a credit note (created as a draft, issued by the Owner) | A refund can't exceed the amount paid. Refund status is tracked from the webhook. |
| ADM-PAY-09 | M | **Receipts**: an automatic receipt (`TH/RCT/…`) per confirmed payment: PDF to R2, email to the billing contacts from `billing@`, visible in the portal | Generated once per payment (idempotent). |
| ADM-PAY-10 | S | **Reconciliation**: Razorpay settlements (API) matched against payments; a "match bank entry" screen for transfers; unmatched items listed | The settlement fee is shown (absorbed, not charged to the client). |
| ADM-PAY-11 | M | **Go-live guard**: provider live keys are used only when `PAYMENTS_LIVE_ALLOWED=true` (set only at the Phase 7 approval) and the provider's mode = live | Test: live mode is rejected when the flag is false. |
| ADM-PAY-12 | M | **We never collect or store card or bank credentials of payers.** All entry happens on gateway-hosted pages. | No card fields in any of our UI (code review checklist). |
| ADM-PAY-13 | M | **Gateway limits** (VERIFY WITH CA/LEGAL): warn when a Stripe/PayPal export payment would exceed **₹25 lakh per transaction** (RBI PA-CB cap). Never add a UPI surcharge line (UPI MDR of 0.4% above ₹2,000, capped at ₹300, from 15 Oct 2026, must be absorbed by the merchant). | Test for the warning. |

### 5.15 Approvals (ADM-APR)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-APR-01 | M | Queue for the Owner: proposals/estimates with > 10 % discount, invoice issue requests, payments pending verification, refund requests (if Staff requested) | Approve/reject with a note. The requester is notified. Each approval applies to one specific version or amount. |
| ADM-APR-02 | M | Approvals expire if the document changes after the request | Test: editing after the request invalidates the approval. |

### 5.16 Email and notifications (ADM-MAIL)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-MAIL-01 | M | Templates (HTML + plain text, brand tokens): lead acknowledgement, internal lead alert, proposal/estimate sent, proposal accepted (both sides), invoice issued, proforma issued, reminder (5 variants), payment received + receipt, credit note issued, magic link, staff invite, login alert, 2FA changed, lockout, approval requested/decided, weekly digest | Each renders with fixture data and has a plain-text version. Snapshot tests. They pass a basic email-client check (tables layout, inline CSS). |
| ADM-MAIL-02 | M | **Email log**: recipient, template, related record, SES message ID, status (sent / delivered / bounced / complained), timestamps | Bounce/complaint events update the status (JOB-HOOK-01). Hard-bounced addresses are flagged on the contact. |
| ADM-MAIL-03 | M | Header-injection safe; the `List-Unsubscribe` header on non-transactional mail (digest, marketing) | Tests. |

### 5.17 Reports (ADM-REP)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-REP-01 | M | **Revenue & collections**: invoiced vs collected by month / service category / client / currency (USD + INR equivalent), recurring vs project | Matches the ledger for fixtures. |
| ADM-REP-02 | M | **Outstanding & ageing**: 0–30 / 31–60 / 61–90 / 90+ days past due, per client; statement links | |
| ADM-REP-03 | M | **Pipeline & win rate**: leads and proposals by stage and value, conversion %, lost reasons, source pages, time-to-win | |
| ADM-REP-04 | M | **GST & CA exports** (VERIFY WITH CA for formats): sales register, output tax by rate and type (CGST/SGST/IGST/zero-rated), B2B / B2C / export splits, credit notes, HSN/SAC summary, documents-issued summary (per series: from–to, total, cancelled), **GSTR-1-ready Excel/CSV**, payment register | Exports are generated **in the browser** from API JSON (free-plan CPU). Column layouts are versioned. Totals match the invoices. |
| ADM-REP-05 | M | **Care plans**: hours used vs included per client per month; overage to invoice | |
| ADM-REP-06 | M | Accountant role: all finance reports + exports, read-only | Role tests. |
| ADM-REP-07 | M | **FEMA EDF report** (new from 1 Oct 2026, VERIFY WITH CA): a monthly list of export-of-services invoices for filing with your bank (AD bank) within 30 days of the end of the invoice month; plus an export-realisation status report | Columns versioned. A reminder email on the 5th of each month. |

### 5.18 Audit log (ADM-AUD)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| ADM-AUD-01 | M | **Append-only**: actor, role, action, entity type/ID, before/after summary (diff of changed fields, with sensitive fields masked), IP, user agent, request ID, timestamp | DB triggers block UPDATE and DELETE on the audit table (test). |
| ADM-AUD-02 | M | Viewer with filters (actor, entity, action, date); export CSV (in the browser) | Owner: everything. Accountant: finance events only. |
| ADM-AUD-03 | M | Retained ≥ 8 years; included in backups | |

---

## 6. Client portal (`portal.techaust.com`)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| POR-01 | M | **Magic-link sign-in**: enter email → if it belongs to a contact with portal access, send a single-use link (15 min) from `no-reply@`; the same generic message is always shown (no enumeration); rate limited (3 per 15 min per email, 10 per hour per IP) | A link works once. An expired link shows "request a new link". The response is identical for unknown emails (test). |
| POR-02 | M | **Device session**: HttpOnly, Secure, `SameSite=Lax`, `__Host-`, portal host only; 30 days idle / 90 days absolute; "sign out of all devices" | Expiry tests. |
| POR-03 | M | **Organisation scoping**: every query is filtered by the session's client ID (never from the request); contacts without "can see finance" don't see invoices, payments or statements | Automated tests attempt cross-client access on every route → 404. |
| POR-04 | M | **Home**: open proposals/estimates awaiting a decision, unpaid invoices (balance, due date, Pay button), recent receipts, project status cards, shared notes and files | |
| POR-05 | M | **Proposals & estimates**: view the latest sent version (HTML view matching the PDF + PDF download), accept (ADM-PROP-08) or decline with a reason | Superseded versions aren't shown (except the accepted one, which stays downloadable). |
| POR-06 | M | **Invoices**: list + detail (HTML + PDF), **Pay** → choose Razorpay (INR) or Stripe / PayPal / bank transfer (USD) → redirect to the hosted page → return page shows "Processing…" until the webhook confirms. The **"View & pay" link in emails** opens a single-invoice page via an unguessable token (≥ 128-bit, valid until paid + 30 days, revocable) **without** full portal sign-in. | The token grants only that invoice (test). Payment status is shown only from the server. The return URL never marks anything paid. |
| POR-07 | M | **Receipts & credit notes**: list + PDF download | |
| POR-08 | M | **Projects**: status, milestones (with invoice links), shared notes, shared files (signed downloads) | Unshared items are never returned (test). |
| POR-09 | M | **Profile**: the contact's name and phone; see other portal contacts of their organisation; request a contact change (creates an admin task, no self-service add) | |
| POR-10 | M | Same design system, light/dark, WCAG 2.2 AA, 375 px+ | Same DoD. |
| POR-11 | S | "Download my data" request (DPDP rights), routed to the admin as a task (VERIFY WITH CA/LEGAL) | |

---

## 7. Jobs, hooks and scheduled work (`hooks.techaust.com`)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| JOB-HOOK-01 | M | `POST /razorpay` (`X-Razorpay-Signature` HMAC-SHA256 of the raw body), `POST /stripe` (`Stripe-Signature`, 5-min tolerance), `POST /paypal` (verify-signature), `POST /ses` (SNS signature verified, or a shared-secret path + SNS signature) | Invalid signature → 400 and an alert after 5 in 1 h. Constant-time comparisons. Tests with recorded sandbox payloads. |
| JOB-HOOK-02 | M | **Idempotency**: an event-ID unique table; duplicates → 200 with no side effects | Test. |
| JOB-HOOK-03 | M | Respond 2xx fast; heavy work (receipt PDF, emails) is queued | Hook CPU ≤ 5 ms p99. |
| JOB-Q-01 | M | Queues: `leads`, `pdf`, `email`, `events` (+ dead-letter queues). Consumers take batches of 1–5 (one unit of work per message; the PDF consumer runs with `max_concurrency` 1), max 5 retries with backoff, then DLQ + an admin alert | Tests per consumer. DLQ items are visible in the admin under "Needs review". |
| JOB-PDF-01 | M | PDF rendering via Browser Run: on proposal send, acceptance, invoice/credit-note/receipt issue, statement request. Paced to the free-tier limits; results cached in R2 with a hash; never re-rendered for frozen documents | A burst of 20 PDFs completes without errors (paced). The stored PDF hash matches the DB. |
| JOB-CRON-01 | M | Daily 03:30 IST: mark overdue invoices, expire proposals, enqueue reminders (sending window 09:00–19:00 IST), retention clean-up, session clean-up | Each cron handler only enqueues (≤ 5 ms CPU). |
| JOB-CRON-02 | M | Daily 06:00 IST: care-plan billing for plans whose billing day = today | Idempotent per plan per period. |
| JOB-CRON-03 | S | Monday 09:00 IST: weekly digest | |
| JOB-BKP-01 | M | **Nightly backup** (GitHub Actions, 02:00 IST): D1 export → encrypt (age, the owner's public key) → upload to S3 Mumbai (OIDC role, no stored AWS keys) → verify the object → retention 90 daily + monthly for ≥ 8 years | Workflow logs show success. A restore drill is documented ([08 §6](08-security-compliance.md)). |

---

## 8. Non-functional requirements

| ID | Area | Requirement |
|---|---|---|
| NFR-1 | Performance (site) | Lighthouse mobile ≥ 95/100/100/100; field LCP < 2.0 s, INP < 200 ms, CLS < 0.05 (p75); TTFB < 200 ms; JS ≤ 50 KB gz per page |
| NFR-2 | **Free-plan budgets** | Per request CPU: API p99 ≤ 7 ms (the Phase 6 gate, [05 §1.2](05-architecture.md)), login ≤ 5 ms, hooks ≤ 5 ms, cron ≤ 5 ms. Requests: total < 50k/day (alert at 50 %, the upgrade trigger in [05 §1.2](05-architecture.md)). D1: < 1M rows read/day (indexes on all filter columns). Browser Run: < 50 % of the daily minutes. Queues: < 5k ops/day. All monitored ([08](08-security-compliance.md)). |
| NFR-3 | Performance (apps) | Admin/portal initial JS ≤ 250 KB gz (code-split per route); API p95 < 300 ms from India; lists of 1,000 rows paginate server-side |
| NFR-4 | Accessibility | WCAG 2.2 AA for all three surfaces; PDFs tagged where the renderer allows (title, language, reading order) |
| NFR-5 | Security | OWASP ASVS L2 targets for auth, sessions, access control and input validation; details and threat model in [08](08-security-compliance.md) |
| NFR-6 | Privacy | Data minimisation; no personal data in logs or analytics; consent-gated GA4; retention jobs; DPDP-aware notices (VERIFY WITH CA/LEGAL) |
| NFR-7 | Reliability | Zero data loss on queue failure (DLQ); RPO ≤ 24 h (nightly off-site) and ≤ minutes within 7 days (D1 Time Travel); RTO ≤ 4 h (restore runbook) |
| NFR-8 | Browsers | The last 2 versions of Chrome, Edge, Firefox and Safari (desktop + mobile); Samsung Internet; the site degrades gracefully without JS |
| NFR-9 | Observability | Structured logs (request ID, route, status, CPU ms) with no personal data; Sentry for errors; alerts on webhook failures, DLQ messages, CPU-limit errors, failed backups. **Security log retention ≥ 13 months:** Workers Logs keep only 3 days on free, so auth, admin and portal access events are written to a D1 `access_log` table (pruned at 13 months, included in backups). |
| NFR-10 | Maintainability | TypeScript strict; shared packages; ≥ 90 % line coverage on `packages/core` (money, tax, numbering, schedules, permissions); conventional commits; ADRs for major decisions |
| NFR-11 | Cost | ≤ ₹1,000/month all-in; target ≈ ₹5–50. Any paid upgrade is proposed separately. |
| NFR-12 | Honesty | No fabricated metrics, testimonials, team members or "live" data (WEB-G-14) |

---

## 9. Permission matrix (final, with the Q-P3-2 rules)

✅ full · ✏️ draft/create · 📤 send · 👁 read-only · ⏳ needs Owner approval · — none

| Capability | Owner/Admin | Staff | Sales/BD | Accountant |
|---|---|---|---|---|
| Users, roles, settings, gateway modes, tax and numbering | ✅ | — | — | 👁 tax/numbering |
| Bank details | ✅ (step-up) | — | — | 👁 masked |
| Leads & pipeline | ✅ | ✅ | ✅ | — |
| Clients & contacts | ✅ | ✅ | ✅ (no finance tabs) | 👁 |
| Projects, milestones, notes, files | ✅ | ✅ | 👁 | — |
| Care plans | ✅ | ✏️ (no price changes) | 👁 | 👁 |
| Time logs | ✅ (anyone's) | ✏️ own | ✏️ own | 👁 |
| Service catalogue | ✅ (+ publish) | 👁 | 👁 | 👁 |
| Proposals & estimates | ✅ | ✏️ · 📤 if discount ≤ 10 %, else ⏳ | ✏️ · 📤 if discount ≤ 10 %, else ⏳ | 👁 |
| Invoices, proformas, credit notes | ✅ issue (step-up) | ✏️ drafts · issue ⏳ | — | 👁 |
| Record manual payment | ✅ (confirmed) | ✏️ → ⏳ pending verification | — | 👁 |
| Refunds | ✅ (step-up) | — | — | 👁 |
| Reports | ✅ | Projects, time, care plans | Pipeline only | ✅ finance + exports |
| GST/CA exports | ✅ (step-up) | — | — | ✅ (step-up) |
| Audit log | ✅ | — | — | 👁 finance events |
| Approvals queue | ✅ | own requests | own requests | — |

---

## 10. Traceability to audit findings

| Audit ID | Fixed by |
|---|---|
| C-1, C-2, H-3 | WEB-G-14, WEB-WORK, WEB-ABOUT, NFR-12 |
| C-3, H-1, H-2 | WEB-LEGAL, FRM-05, ADM-SET-01 (GSTIN on invoices), [08](08-security-compliance.md) |
| H-4 | FRM-01 |
| H-5, M-1, M-2 | FRM-02, FRM-03 |
| H-6, H-7 | WEB-G-01, NFR-1 |
| H-8 | [05 §12](05-architecture.md) CI/CD (no auto-deploy to production) |
| H-9 | WEB-G-04 (no @techaustsocial) |
| H-10 | WEB-G-10 (no SoftwareApplication) |
| H-11 | WEB-HOME, WEB-PRICING, the service template |
| M-3 | WEB-G-12, WEB-G-11 (security.txt) |
| M-4, M-5, L-4 | WEB-G-15, WEB-G-16, [06](06-design-system.md) |
| M-6 | WEB-G-13 |
| M-7, M-8 | [06](06-design-system.md) (type scale, tokens, breakpoints) |
| M-9 | WEB-SVC-01 (pre-selected service), FRM-04 (acknowledgement email), WEB-G-18 |
| M-10 | No ROI calculator at launch (§11); no unsourced numbers |
| M-11, M-12 | WEB-G-09, WEB-G-10, WEB-OG |
| M-13 | Site config single source (WEB-G-18), catalogue snapshot (WEB-G-07) |
| M-14 | Stable, pinned frameworks ([05 §2](05-architecture.md)) |
| L-1, L-2, L-8 | WEB-G-09, WEB-G-11, WEB-404 |
| L-5 | [08](08-security-compliance.md) DNS hardening (with approval) |

---

## 11. Later (not at launch)

| Item | Trigger |
|---|---|
| ROI calculator (INR/USD, shared schema, tests) → pre-filled quote | After launch, once real benchmark data exists (avoids audit M-10) |
| IRP e-invoicing via a GSP | Turnover crosses ₹5 Cr (VERIFY WITH CA) |
| Cross-border collection account (Skydo/Xflow/MoneySaver) provider | When USD bank-transfer volume grows (cheaper than PayPal, automatic e-FIRA) |
| Cashfree as a backup INR gateway | If Razorpay fees or availability become an issue |
| Client self-service: add contacts, saved payment preferences | Portal feedback |
| Expense tracking, purchase invoices, Tally export of sales vouchers | CA request |
| S3 DPDP Readiness page | A legal partner is in place |
| Multi-currency beyond INR/USD (GBP, EUR, AED) | First client needing it |

---

## 12. Inputs still needed from you

The single list is [07 §9](07-content.md) (asset list and owner inputs): headshot and bio, WhatsApp number, LinkedIn URLs, Cal.com URL, case-study briefs, Zoho aliases, bank details, GSTIN, legal name, LUT ARN and the gateway test keys. It is kept in one place so the two documents cannot drift apart.

---

## 13. Status

- [x] Phase 4 interview (§0)
- [x] **Approved by owner 2026-10-06**
