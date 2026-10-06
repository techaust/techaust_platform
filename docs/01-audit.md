# 01: Audit of the current techaust.com

| | |
|---|---|
| **Phase** | 1, Audit (**APPROVED 2026-10-06**) |
| **Date** | 2026-10-06 |
| **Revised** | 2026-10-07, documentation quality pass ([runs/docs-quality-pass.md](runs/docs-quality-pass.md)) |
| **Audited source** | `D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\ASSETS\WEBSITE`, read-only and not modified. Builds ran on a copy in a scratch folder. |
| **Audited live site** | https://techaust.com. Read-only GET and HEAD requests only. No forms were submitted and no dashboards were touched. |
| **Detailed evidence** | [Appendix A: code, build and security](01-audit-appendix/A-code-build-security.md) · [Appendix B: content inventory and design](01-audit-appendix/B-content-design.md) · [Appendix C: live performance, SEO, accessibility and links](01-audit-appendix/C-live-perf-seo-a11y.md) |

> **Legal note.** Anything about tax, invoicing law, consumer protection or data protection (India's DPDP Act 2023) is marked **VERIFY WITH CA/LEGAL**. It is not settled advice.

---

## 1. Executive summary

The current site is **technically competent but makes claims it can't back up**. The code is clean TypeScript. It has good accessibility basics, zero console errors and no exposed secrets. The problems are mostly **trust, legal and positioning**, plus a handful of real engineering defects.

1. **The site claims things that aren't true.** It shows fake "LIVE" dashboards and metrics: "Platform v2.4", "1,847 documents processed today", "258 threats blocked", "ALL AI SYSTEMS OPERATIONAL". It makes absolute guarantees: "100% accurate answers", "no hallucinations", "full legal compliance". It implies a team and customers that don't appear anywhere. For the regulated-enterprise buyers it targets, this **lowers** credibility and creates misleading-advertising exposure (VERIFY WITH CA/LEGAL).
2. **The legal pages are unadapted templates.** The privacy policy follows GDPR/CCPA with nothing for DPDP, and it names the wrong service providers. The terms choose Delaware (USA) law with a USD $100 liability cap. No legal entity, CIN or GSTIN appears anywhere (VERIFY WITH CA/LEGAL).
3. **The positioning is unclear.** "Next-Gen Autonomous AI Infrastructure for Enterprise" doesn't say what is sold, to whom, how, or at what price. USD pricing and US Pacific time slots sit next to a Balurghat address.
4. **Leads can be lost.** The only lead channel (the contact form) has a rate limit that's easy to bypass, may sit on a 100-emails-a-day free email tier (if on the free tier; plan not confirmed, Q-H4), and rejects calculator-sourced leads with decimal or missing values. There is no acknowledgement email and no tests.
5. **The site is slower than it needs to be.** Every page is rendered fresh on each request with `no-store`, giving 0.8–1.05 s time to first byte (curl through the Marseille colo; re-measure from India, see H-7). A site-wide loading spinner causes a layout jump of CLS 0.21–0.32 (needs improvement to poor) and hides page content from crawlers that don't run JavaScript.

**Rebuild verdict:** reuse almost nothing of the code, keep a few ideas, and replace all the copy. Things worth carrying forward are in §6.

---

## 2. Current system at a glance

| Area | Finding |
|---|---|
| Framework | Next.js 16.3.4 App Router, React 19.2.8, TypeScript (strict) |
| Production build | **vinext 1.0.0-beta.9** (beta Vite reimplementation of Next.js) → **Cloudflare Workers**. A second `next build` is kept "for Vercel compatibility". Stable vinext 1.0.1 now exists. |
| Hosting (see Q-H1) | The code and live headers show **Cloudflare Workers** (`wrangler.jsonc`, project `techaust-web`, `X-Vinext-Build-Id` header), not Cloudflare Pages. If it is in fact a Pages project, that only changes how we cut over; the rebuild plan is the same. |
| Deploy pipeline | GitHub `techaust/techaust-web`, branch `master`, one commit. Workers Builds **auto-deploys every push to production**. No CI, no branch protection known, no tests. |
| Styling and UI | Tailwind CSS v4, Framer Motion, lucide-react; dark-only "obsidian glass" theme |
| Forms | React Hook Form + Zod (client); Zod (server, duplicated and drifted) |
| Backend | One edge route, `POST /api/contact` → Resend email API (if on the free tier, 100 a day; plan not confirmed, Q-H4). No database, auth, storage or analytics beyond the Cloudflare Web Analytics beacon. |
| Pages | `/`, `/about`, `/services/knowledge-systems`, `/services/workforce-automation`, `/services/security-guard`, `/calculator`, `/contact`, `/privacy`, `/terms`, plus 404, error and loading |
| Size | About 35 source files. Home page loads about 197–225 KB of compressed JavaScript; Worker bundle 1.25 MB uncompressed. |
| DNS and email (observed) | Mail on Zoho (SPF `include:zoho.in`). Resend DKIM present. DMARC `p=none`. Google site-verification TXT record present. TLS certificate auto-renewed by Cloudflare. |

**Build and check results (run on a copy):** type check passes · lint passes on a clean tree but **fails after `build:vinext`** because `dist/` isn't ignored (5 errors, 4,728 warnings) · `next build` passes, with a deprecation warning · `build:vinext` passes but **prerenders 0 of 9 pages** · `npm audit` reports 1 critical (in `next/og`, unused) and 15 high (build and dev tooling only).

---

## 3. Findings ranked by severity

IDs are stable so later docs can refer to them. "Evidence" points to the appendix with file and line detail.

### Critical

| ID | Area | Finding | Evidence | Why it matters for the rebuild |
|---|---|---|---|---|
| C-1 | Trust / legal | **Simulated telemetry presented as fact:** the hero "LIVE" command console (random ping, 2,847 docs, 1,847 invoices, 258 threats), "Platform v2.4", "Live: 1,847 documents processed today • 4.2s vs 8.5 min", the Guard "real-time threat monitor" (no visible "simulation" label), the knowledge demo badged "VERIFIED ANSWER… Confidence 99.2%", and the footer "ALL AI SYSTEMS OPERATIONAL". Misleading-advertising risk (Consumer Protection Act 2019 / ASCI code: **VERIFY WITH CA/LEGAL**). | App. B §0 #1, §C C1 | New site: real figures only, or a clearly labelled "Illustrative demo". No fake status badges. |
| C-2 | Trust / legal | **Absolute guarantees:** "100% accurate answers", "No hallucinations", "Zero manual errors", "Proprietary data never leaks", "Full legal compliance", "no gaps, no exceptions", "100% private". | App. B §C C2; e.g. `app/services/knowledge-systems/page.tsx:20` | Copy guideline: describe outcomes honestly ("designed to", "helps reduce") and back them with evidence. |
| C-3 | Legal / DPDP | **The privacy policy isn't aligned with India's DPDP Act 2023 / DPDP Rules 2025.** It names no legal entity, no Grievance Officer and no Data Protection Board route. It has no proper notice or consent at the point of collection. It names the wrong processors ("Vercel Edge / Cloudflare Pages" instead of Workers + Resend + Zoho, and the Cloudflare analytics beacon is unnamed). It makes security claims the site can't support ("zero-data retention", "never visible to staff", a "System Guard" blocking prompt injection on a site with no AI). **Timeline note:** the DPDP Rules' core duties start on 13 May 2027; until then the IT Act s.43A and the SPDI Rules 2011 apply (see [08 L-1 and L-2](08-security-compliance.md)). **VERIFY WITH CA/LEGAL.** | App. B §A.8; `app/privacy/page.tsx:86` | A new DPDP-aware privacy notice, drafted for lawyer review. The admin backend will hold client personal data, which raises the stakes. |

### High

| ID | Area | Finding | Evidence |
|---|---|---|---|
| H-1 | Legal | **Terms use Delaware (USA) law with exclusive venue in Wilmington** and a USD $100 liability cap for an India-based business. Looks like an unadapted template. **VERIFY WITH CA/LEGAL.** | `app/terms/page.tsx:130` |
| H-2 | Legal / trust | **No legal entity anywhere.** No Pvt Ltd / LLP / proprietorship, no CIN, GSTIN or Udyam. The contact page labels the address "Registered office", and the schema sets `legalName` to the brand name. Also needed for invoices later (GST). **VERIFY WITH CA/LEGAL.** | App. B §A.15 |
| H-3 | Trust | **Team and customers overstated:** "founded by operators", "Solutions Architecture Team", "a named architect", "Meet the team", "Trusted for high-compliance enterprise workloads", "Why back-office teams choose…". The founder card says one person built everything. There are no clients, case studies, testimonials or photos. | `app/about/page.tsx:67`; App. B §A.2 |
| H-4 | Conversion bug | **Calculator → contact hand-off rejects valid leads.** A decimal hourly rate (the 38.5 URL was seen live; the server regex `^\d{1,6}$` rejects it) or any missing URL value (the client sends `"-"`) fails the server's digits-only check, so the whole enquiry is rejected with a generic "Validation failed". The client and server schemas are duplicated and have drifted. | App. A F-Q1; App. B H4 |
| H-5 | Security / availability | **Contact rate limit is bypassable** (confirmed locally). It keys on the client-controlled first `X-Forwarded-For` value and keeps counts in memory per Worker isolate. Header-less requests share one "unknown" bucket. A simple script can use up the Resend quota (100 a day if on the free tier; plan not confirmed, Q-H4) and silently kill the only lead channel. | `app/api/contact/route.ts:36-57` |
| H-6 | Performance / SEO | **The site-wide `app/loading.tsx` wraps every page in a loading state.** The server HTML shows "LOADING TECHAUST CORE…" while real content sits in a hidden `<div>`. That causes **CLS 0.21–0.32** (needs improvement to poor), and crawlers, link unfurlers and AI crawlers that don't run JavaScript see only a spinner. | App. C P1/S4 |
| H-7 | Performance / cost | **No page is prerendered or cached.** vinext prerenders 0 of 9 pages, and HTML (plus robots, sitemap and icons) is served `no-store`, `CF-Cache-Status: BYPASS`. Time to first byte was 0.8–1.05 s (curl; the Cloudflare colo that answered was MRS, Marseille, so this may include the route to Europe and is not a true measure for Indian visitors; re-measure from India, App. C §3). Every view uses Worker CPU and requests (free plan: 10 ms CPU, 100k requests a day). | App. A F-B1; App. C P2 |
| H-8 | Process | **No tests and no CI. Every push to `master` ships to production.** The checks in AGENTS.md are convention only. | App. A F-B2/F-T1 |
| H-9 | SEO / trust | **The X account `@techaustsocial` appears not to exist.** It returns 404, the same as a nonsense control handle. It is still used in Twitter meta tags, the footer on every page and the Organization schema. The LinkedIn, Instagram and Facebook company handles couldn't be verified (those sites block bots). | App. C S1 |
| H-10 | SEO | **Misleading structured data:** every page declares a `SoftwareApplication` "Autonomous AI Platform" offered **free (price 0 USD)**. That's inaccurate for a paid services business and risks a manual action from Google. | App. C S2 |
| H-11 | Positioning | **Unclear offer and audience.** A visitor can't tell in five seconds whether TecHaust is a product, an agency or a consultancy. There are no engagement models, timelines, prices or integrations (Tally, Zoho, SAP…). USD, PT call slots and Delaware sit beside "Engineered in India". The same three-pillar sentence is repeated more than 10 times. | App. B §B.11 |

### Medium

| ID | Area | Finding | Evidence |
|---|---|---|---|
| M-1 | Security | Contact API leaks internals: error responses include a `debug` object with the to/from addresses and Resend's raw error, plus full validation details (`route.ts:134-156`). | App. A F-S2; App. C H2 |
| M-2 | Security | No body-size limit (an oversized body was parsed); `size`, `focus` and `slot` are free text of any length, go into the email **subject**, and CR/LF isn't stripped. There's no Origin check and `text/plain` is accepted, so any website can submit the form from visitors' browsers. | App. A F-S3, F-S4, F-S5 |
| M-3 | Security | No Content-Security-Policy. The five other headers **do** reach production on HTML and API responses, but not on static assets. No COOP/CORP, no `security.txt`. HSTS says `preload` but the domain was never submitted to the preload list. | App. A F-S8, F-S9, F-S10; App. C H1, H3, H5 |
| M-4 | Accessibility | Text contrast below 4.5:1: `text-white/30` (2.6:1), `/40` (3.8:1), `slate-500` (3.9–4.2:1) on 10–12px text. Many labels are 8–11px. This contradicts the README's "WCAG AAA" claim. | App. C A2; App. B §B.3 |
| M-5 | Accessibility | The hero feed updates on a timer forever with **no pause button**, and two `role="status"` live regions make screen readers announce every ~2 s (WCAG 2.2.2). `focus:outline-none` on inputs overrides the global focus ring (2.4.7). | App. C A1; App. A F-A1, F-A2 |
| M-6 | Performance | About 200 KB of compressed JavaScript for a brochure site. Framer Motion loads on every page just for the navbar dropdown. Two constant animation loops (`neural-cursor-canvas`, `ambient-light`) run with an O(n²) link check. | App. A F-Q3; App. C P3, P6 |
| M-7 | Design | The intended heading font (Space Grotesk) isn't applied in 71 places (`font-[var(--font-space)]` doesn't resolve). Brand colour tokens are defined but mostly unused, so Tailwind defaults drift from the brand. 16 ad-hoc text sizes and no type scale. | App. B §B.2, §B.3 |
| M-8 | Design / responsive | Every layout switches at 1024px only, so a 768px tablet gets the full mobile layout with very long pages (home is about 6,300–7,300px tall). No sideways overflow at any width. | App. B §B.1, §B.9 |
| M-9 | Conversion | 13+ differently worded CTAs all land on one generic 7-field form. None pre-selects a service. Two hero CTAs go to unexpected places. No phone, booking link, WhatsApp or acknowledgement email. | App. B §A.14, §C M5 |
| M-10 | Content | The homepage ROI example ($1,058,400 / 27,864h) can't be produced by the calculator. The "conservative 72%" automation rate has no source, and the efficiency figure is always 72%. | App. B §0 #9, §A.6 |
| M-11 | SEO | Stale search identity: third-party profiles still describe TecHaust as "digital marketing", the `www` variant is what gets indexed, and the name collides with *Tech Australia* (techaust.com.au). Local SEO is thin (no LocalBusiness/ProfessionalService schema, phone or street address). No Service or Breadcrumb schema. | App. C S3, S5 |
| M-12 | SEO / social | The social preview image is the 512×512 icon used as a large-image card; there is no 1200×630 image. | App. C S6 |
| M-13 | Maintainability | Content is duplicated: the three-division data is defined in 8 places and `contact@techaust.com` is hard-coded about 20 times despite a "single source of truth" config. | App. A F-Q2 |
| M-14 | Platform risk | Production runs on a **beta** framework (vinext) with caret ranges on pre-release versions. The two builds already render titles differently. ESLint lints `dist/`. | App. A F-B3, F-B4 |

### Low

| ID | Finding | Evidence |
|---|---|---|
| L-1 | Duplicated brand in titles ("Privacy Policy — TecHaust Technologies — TecHaust Technologies", also /terms and /about). The About title is 90 characters. | App. A F-Q7; App. C S8 |
| L-2 | `sitemap.xml` `lastmod` is the time of each request. The 404 page has two robots tags and a canonical pointing at the home page. | App. C S7, S9; App. A F-Q8 |
| L-3 | The calculator rate field clamps on every keystroke, so typing 50 gives 10 and then 100. The client's `res.json()` isn't guarded. No `global-error.tsx`. | App. A F-Q5, F-Q6 |
| L-4 | ARIA patterns are incomplete: `role="menu"` without menu keyboard support, tabs without arrow keys, `aria-controls` pointing at elements that don't exist yet. Some 36px touch targets on legal pages. | App. A F-A3, F-A4; App. C A3 |
| L-5 | DMARC `p=none`; no CAA records; legacy TLS 1.0/1.1 status unconfirmed (set the Cloudflare minimum to TLS 1.2). | App. C H4, §1 (TLS) |
| L-6 | Founder's personal Facebook and Instagram on a B2B site; social buttons use text monograms instead of icons; an 8px logo caption. | App. B §A.2, §B.5; App. C A4 |
| L-7 | Stale docs and comments still mention Vercel, Cloudflare Pages, next-on-pages and Upstash. The `edge` runtime on the contact route is deprecated. `@types/node` is ^20 while the runtime is Node 24. | App. A F-S7, F-B5, §2.4 (@types/node) |
| L-8 | The 404 and error pages have no helpful links. The error page's "Your data remains secure" line is unearned. | App. B §A.10, §A.11 |

### Info / dead code

- Unused: `components/ui/button.tsx`, `components/particle-canvas.tsx` (which also has a duplicate-loop bug), `EMAIL_DIRECTORY` and the sales@, support@, admin@ and billing@ addresses in `lib/site-config.ts`, 8 CSS classes, the `class-variance-authority` dependency, and a stale `app/icon-512.png`.
- **Secrets:** none found in the source tree or build output; **git history was not scanned** (App. A F-S12, Q4). The Resend key is read correctly as a runtime secret.
- **Production may be a newer revision than this folder:** the live bundle file names differ from the local `dist/` (see Q-H2).
- PageSpeed / Lighthouse scores and real-user (CrUX) data were **not obtained**; Google's anonymous API quota was exhausted. Figures above come from browser measurements and curl.

---

## 4. Content inventory (summary)

Full section-by-section copy, every CTA and link, the form spec and the business-facts table are in [Appendix B §A](01-audit-appendix/B-content-design.md).

| Route | H1 | Purpose and notable content |
|---|---|---|
| `/` | "Next-Gen Autonomous AI Infrastructure for Enterprise." | Hero + "core guarantees"; fake "LIVE" command console; trust bar implying customers; 3 division cards; ROI teaser with an example that can't be reproduced; trust grid repeating the cards; CTA banner. |
| `/about` | "We build AI that works like your best team — only faster." | Mission, story ("founded by operators"), values, divisions, who we serve (VPC/on-prem, 14-day audit claims), founder card (Rupak Sarkar, monogram, 4 personal socials), "Meet the team" CTA. |
| `/services/knowledge-systems` | "Transform messy files into an intelligent Corporate Brain." | Private document search (RAG). 3-step workflow; canned demo badged "VERIFIED ANSWER"; "100% accurate", "No hallucinations". |
| `/services/workforce-automation` | "Deploy autonomous AI agents for back-office execution." | Document and invoice processing agents; stepper simulation with a "Live: 1,847 documents processed today" claim. No named ERP integrations. |
| `/services/security-guard` | "Ironclad digital shields for enterprise AI deployments." | LLM security and guardrails; simulated threat monitor; "guarantees… full legal compliance". |
| `/calculator` | "Quantify back-office automation ROI — live." | USD-only ROI estimate (team × hours × 48 × 72% × rate) → export to the contact page via URL. Decimal bug (H-4). |
| `/contact` | "Request your AI Security & Workflow Audit." | 7-field form + honeypot → Resend → contact@techaust.com. Address: Pirozpur, Balurghat, Dakshin Dinajpur, WB 733133. "4 business hour" response promise. |
| `/privacy`, `/terms` | Privacy Policy / Terms of Service | GDPR/CCPA template; Delaware terms (C-3, H-1). |
| 404 / error / loading | "404 — Core Node Not Found" / "Something went wrong" / spinner | Loading spinner causes H-6. |

**Business facts on the site:** brand "TecHaust Technologies"; founder Rupak Sarkar; Balurghat, West Bengal address; contact@techaust.com is the only published contact; brand socials @techaustsocial; **no** phone, legal entity, GSTIN, clients, testimonials, case studies, pricing or team photos. **Images:** none. All visuals are code-drawn (SVG, canvas, CSS); the only brand assets are the logo mark and icons generated by `scripts/generate-brand-assets.mjs`.

---

## 5. Design summary

- **Look:** dark-only "obsidian" glassmorphism with neon cyan (#00F0FF) and violet (#7C3AED), a terminal and command-centre aesthetic, film grain and constant motion (8+ animating elements per screen; the pulsing green dot appears about 7 times). It reads as a **startup demo reel more than a calm, trustworthy vendor**.
- **Typography:** Plus Jakarta Sans (body), Space Grotesk (display, often not applied, M-7) and JetBrains Mono, which is overused for whole paragraphs. Fluid `clamp()` headings are good; everything else is ad-hoc pixel sizes.
- **Colour tokens** (from `globals.css`): background #07080C, surface #0F111A, foreground #E2E8F0, cyan #00F0FF / #00D4E0, violet #7C3AED / #A78BFA, neon #B026FF, border #1E293B. In practice Tailwind defaults are used instead.
- **Logo:** a chamfered geometric "T" mark with a metallic gradient and cyan "energy core", and a "Tec**Haust**" wordmark. It's distinctive and worth keeping or refining (Q-B4). Small details blur at 16px.
- **Responsive:** no overflow at 375, 768 or 1280px. Tablet gets the mobile layout.
- **Accessibility strengths:** skip link, landmarks, visible focus (except inputs), an accessible mobile menu, labelled sliders, accessible form errors, `prefers-reduced-motion` support, pause controls on two of the three animations.

---

## 6. What to carry into the rebuild

**Keep or reuse (as ideas, not code)**

> **Superseded (2026-10-06).** The logo and colours were not kept: the new identity "Patina" replaced them ([ADR 0013](adr/0013-new-brand-identity.md), [06 §1](06-design-system.md)). The ROI calculator is deferred ([04 §11](04-prd.md)). The list below is the original Phase 1 view.

- The logo mark and wordmark (pending your view, Q-B4), and the cyan/violet brand colours as a starting point.
- Plain one-sentence service explanations (the site's best copy).
- The accessibility discipline in AGENTS.md: 44px targets, focus rings, reduced motion, one h1 per page.
- An ROI-calculator → pre-filled enquiry flow (rebuilt with INR/USD, a shared schema and tests).
- Security headers, the honeypot, server-side validation, and keeping secrets out of the repo (already done well).
- A single source of truth for site config and an SEO helper for metadata.

**Avoid**
- Fabricated metrics, fake "LIVE" widgets and absolute guarantees.
- Template legal pages; a GDPR-only privacy notice.
- A beta framework in production; per-request rendering of static pages; a root `loading.tsx`.
- An in-memory rate limit; a form with no acknowledgement email; auto-deploy to production without CI and tests.
- Constant decorative animation; mono-font paragraphs; text below 12px.

**Already flagged for later phases**
- Phase 2: what the company actually sells, who to, and at what price (H-11).
- Phase 3: hosting, given that we need a database, auth, PDFs and payments (§2 hosting note); legal entity and GST registration status, needed for invoices (H-2).

---

## 7. Open questions

These are deduplicated from all three audits. I'll ask them in small batches through the question tool as we go; you don't need to answer everything now. Items marked ★ affect Phase 2 or 3 directly.

> **Resolved in later phases (status at 2026-10-07).** The questions below are the Phase 1 record and are left as asked.
>
> | Question | Answer | Resolved in |
> |---|---|---|
> | Q-H1 | A Cloudflare **Worker** (`techaust-web`); the new Workers have their own names | [ADR 0011](adr/0011-worker-names.md) |
> | Q-B1 | Sole proprietorship, GST-registered | [02 §1](02-services-strategy.md) |
> | Q-B4 | The logo is replaced by the new identity "Patina" | [ADR 0013](adr/0013-new-brand-identity.md) |
> | Q-B5, Q-B6, Q-B10 | Team size and response time, case studies, and "starting from" prices | [02](02-services-strategy.md) (§1 Team, D-3) and [04 §0](04-prd.md) (Team, Contact, Q-B16) |
> | Q-B2 | Both India and international, split by offer | [02 §1](02-services-strategy.md) (Markets) and D-2 |
> | Q-B3 | AI projects are in progress, so there is no completed public AI case study yet; the old product names are retired | [02 §1](02-services-strategy.md) (AI projects in progress) and D-4 |
> | Q-B7 | Grievance Officer: Rupak Sarkar, Founder; no lawyer: the legal pages are drafted in-house (04 §0 Q-B12) | [04 §0](04-prd.md) (Identity) |
> | Q-B8 | LinkedIn company page and the founder's LinkedIn only | [04 §0](04-prd.md) (Q-B15) |
> | Q-B9 | Headshot and bio at the website milestone; a WhatsApp business number (to be provided); a plain Cal.com link, no embedded widget | [04 §0](04-prd.md) (Assets, Contact, Q-P3-1) |
>
> **Still open:** Q-H2 to Q-H6 (hosting and account checks that only the owner can make).

### Hosting, accounts and deployment
- **Q-H1** ★ Is techaust.com a Cloudflare **Workers** project or a **Pages** project? (You said you're unsure. The code and live headers say Workers. You can check in Cloudflare dashboard → Workers & Pages → `techaust-web`, which will be labelled either Worker or Pages.)
- **Q-H2** Is `ASSETS\WEBSITE` exactly the code running in production? The live bundle file names differ from the local build.
- **Q-H3** Is the Cloudflare account on the Free or Paid Workers plan? Is GitHub branch protection on for `techaust/techaust-web`?
- **Q-H4** Has the contact form ever been spammed, or the Resend daily limit hit? Which mailbox host receives contact@techaust.com (DNS suggests Zoho)?
- **Q-H5** Is Google Search Console set up for the apex domain, with the sitemap submitted? Is there a Google Business Profile for the Balurghat office?
- **Q-H6** Are any subdomains served over plain HTTP? (HSTS `includeSubDomains` would break them.)

### Business and legal (★ needed for Phase 2 and the invoicing module)
- **Q-B1** ★ Legal form of TecHaust Technologies (proprietorship / partnership / LLP / Pvt Ltd)? CIN or LLPIN, **GSTIN**, Udyam? Is the Balurghat address a registered office?
- **Q-B2** ★ Is there any US entity, or is everything billed from India? Target market: India, international, or both?
- **Q-B3** ★ Are any of the current products (Corporate Brain, Digital Workforce, System Guard) live with paying or pilot clients? Are any of the site's metrics real?
- **Q-B4** Keep the current logo, refine it, or redesign?
- **Q-B5** ★ How many people work at TecHaust today, and who handles enquiries? What response time can you honestly commit to (and in IST)?
- **Q-B6** ★ Can you share client names, logos, testimonials or case studies (anonymised is fine) that we may publish?
- **Q-B7** Who will be the Grievance Officer / privacy contact under DPDP? Is lawyer review of the new privacy notice and terms planned? (VERIFY WITH CA/LEGAL)
- **Q-B8** Are the @techaustsocial accounts on LinkedIn, Instagram and Facebook real? (X appears not to exist.) Should the founder's personal socials stay on the corporate site?
- **Q-B9** Can you provide a professional headshot and short bio, a public phone or WhatsApp number, and a booking link (e.g. Cal.com or Calendly) if you want one?
- **Q-B10** Do you want indicative pricing or engagement models shown publicly?

---

## 8. Phase 1 status

- [x] Read-only audit of source and live site (stack, structure, content, design, performance, accessibility, SEO, security, links)
- [x] Findings ranked by severity, with evidence appendices
- [x] **Approved by the owner, 2026-10-06.** Phase 2 (business and services interview + market research) followed: see [02](02-services-strategy.md)
