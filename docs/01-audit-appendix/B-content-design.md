# TecHaust Technologies website: content inventory and design audit

> **Phase 1 evidence (APPROVED 2026-10-06).** Parent: [01-audit](../01-audit.md). Fixes apply to the old site; for how the rebuild maps them, see [04 §10](../04-prd.md) (traceability) and §11 (later).

- **Scope:** full content inventory (every route, section, CTA, link, form, visual, business fact) and design system review.
- **Source (read-only):** `D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\ASSETS\WEBSITE` (app/, components/, lib/, public/, scripts/generate-brand-assets.mjs, README.md).
- **Live site checked:** https://techaust.com, 2026-10-06, in the built-in browser at 375x812, 768x1024 and 1280x800. No forms were submitted.
- **Source vs live:** live copy matches the source text on every page checked. But the live bundle hashes (`index.CLS60pd_.css`, `contact-form-island-Dt--XRw6.js`) differ from the local `dist/` build (`index.BoyYMGjp.css`, `contact-form-island-C17INOmM.js`), so production was built from a slightly different revision than the local `dist/`. **VERIFY** that the ASSETS copy is the latest source.
- **Not legal advice:** all legal and compliance remarks are flagged **VERIFY WITH CA/LEGAL**.

Severity scale: **Critical** (legal or trust exposure, or a broken conversion path), **High**, **Medium**, **Low**, **Info**.

---

## 0. Top findings (summary)

| # | Sev | Finding |
|---|---|---|
| 1 | **Critical** | **Simulated telemetry is shown as fact.** These read as real production data but are hard-coded or random: "TECHAUST PLATFORM v2.4", "LIVE", "4–12ms PING", "OPERATIONAL NODES", "2,847 DOCS INDEXED", "1,847 INVOICES SYNCED / documents processed today", "Avg 4.2s vs 8.5 min", "258 THREATS BLOCKED" (89/142/27, "100% blocked"), "Confidence 99.2%", and the footer badge "ALL AI SYSTEMS OPERATIONAL". The Guard "REAL-TIME THREAT MONITOR" carries no visible "simulation" label (only screen-reader text says so). The Knowledge demo returns canned answers labelled "VERIFIED ANSWER • CITATIONS INCLUDED". This is a misleading-advertising risk (Consumer Protection Act 2019 / ASCI code: **VERIFY WITH CA/LEGAL**). |
| 2 | **Critical** | **Absolute guarantees no vendor can contractually honour:** "100% accurate answers", "No hallucinations", "Zero manual errors", "Proprietary data never leaks", "Full legal compliance", "no gaps, no exceptions", "100% private", "100% auditable", "ironclad". Terms §2 tries to limit them to the MSA, but the marketing claims stand on their own. |
| 3 | **Critical** | **The Privacy Policy is GDPR/CCPA-styled with no India DPDP Act 2023 alignment.** It names no Indian legal entity, no Grievance Officer, no Data Protection Board complaint route, no consent-manager or withdrawal mechanics, and names the wrong processors (it says "Vercel Edge / Cloudflare Pages"; production actually uses Cloudflare Workers plus Resend, a US email API). It also promises things the stack can't evidence ("zero-data retention", "never visible to TecHaust staff", "AES-256", "System Guard" protecting the site against prompt injection on a site that has no AI). **VERIFY WITH CA/LEGAL.** |
| 4 | **High** | **The Terms choose Delaware (USA) law with exclusive venue in Wilmington** and a USD $100 liability cap, for a business whose only stated address is Balurghat, West Bengal. This looks like an unadapted template. **VERIFY WITH CA/LEGAL.** |
| 5 | **High** | **The legal entity is unclear.** The site says only "TecHaust Technologies" (no Pvt Ltd/LLP/proprietorship, no CIN/GSTIN/Udyam), yet the Contact page labels the address "REGISTERED OFFICE" and JSON-LD sets `legalName` to the brand name. |
| 6 | **High** | **The team is overstated against a solo-founder reality.** The copy says "founded by operators" (plural), "Solutions Architecture Team", "every enquiry lands with a named architect", "Meet the team behind your AI workforce", while the founder block says Rupak Sarkar built "every system it runs today". There are no team members, clients, case studies, testimonials or logos anywhere. "TRUSTED FOR HIGH-COMPLIANCE ENTERPRISE WORKLOADS" implies existing customers. |
| 7 | **High** | **A conversion bug kills calculator-sourced leads.** The calculator allows decimal hourly rates (verified live: typing 38.5 produced `/contact?…&rate=38.5…`), and partial URLs fill missing values with "-". The API's `calc` regex accepts digits only (`^\d{1,6}$`), so the whole submission is rejected with a generic "Validation failed". Client and server limits also differ (name max 80, email max 120 and company max 120 are enforced only on the server). |
| 8 | **High** | **Every page's initial HTML shows "LOADING TECHAUST CORE..."** in `<main>`. The real content sits in `<div hidden id="S:0">` and only swaps in after JS runs: `app/loading.tsx` wraps every route in Suspense. In the browser pane the spinner stayed visible for 6+ seconds while the tab was backgrounded. Non-JS crawlers, AI crawlers and link unfurlers see a spinner page, and LCP is delayed. (This is SEO/perf: see App. C S4 and P1.) |
| 9 | **Medium** | **The homepage ROI "EXAMPLE OUTPUT" ($1,058,400 / 27,864h) can't be reproduced by the calculator.** 27,864 / (48 × 0.72) = 806.25 team-hours, which the integer sliders can't produce. The calculator defaults show $1,063,772 / 27,994h. The "72% automation rate", called "conservative", has no cited source. |
| 10 | **Medium** | **The intended display font isn't applied to most headings.** 71 uses of `font-[var(--font-space)]` don't resolve to Space Grotesk: live computed styles show card h3s and the ROI/CTA headings in Plus Jakarta Sans. Only `.fluid-*` headings get Space Grotesk. |
| 11 | **Medium** | **Text contrast and sizes fail the README's "WCAG AAA" claim:** `text-white/30` (≈2.6:1) and `/40` (≈3.6:1 on #0F111A; 3.8:1 on #07080C, App. C A2), slate-500 small text, 8–11px text (logo caption 8px, hop labels 9px, 11× 10px, 24× 11px). |
| 12 | **Medium** | **The audience is unclear:** USD-only pricing logic, call slots in "PT" (US Pacific Time), "EMEA" and "Acme" demo data, Delaware law, for an Indian company. That suits US enterprise buyers but confuses Indian prospects, and the copy never says who the site targets. |

---

## A. Content inventory

### A.0 Global chrome (every page)

**Root layout** (`app/layout.tsx`)
- `<html lang="en" class="dark">`, a skip link ("Skip to main content" → `#main-content`) and a fixed film-grain overlay (an inline SVG noise data-URI at 2.5% opacity).
- `AmbientLight`: a cursor-following 1400px blurred cyan/violet/fuchsia radial wash. It only runs on hover-capable devices without reduced motion, and sits at fixed `z-[1]`, i.e. above page content at 13% opacity.
- `NeuralCursorCanvas`: a canvas particle constellation at z-index −1 that links to the cursor. Same device gating; 48–120 nodes.
- A 64px spacer for the fixed header, then `<main id="main-content">`, then the footer.
- JSON-LD `@graph`:
  - **Organization:** `name` and `legalName` = "TecHaust Technologies"; logo `/icon-512.png`; founder Rupak Sarkar with 4 personal socials as `sameAs`; address Balurghat, WB 733133, IN; brand socials; contactPoint `contact@techaust.com`.
  - **WebSite.**
  - **SoftwareApplication** "TecHaust Autonomous AI Platform", **offer price "0" USD**. *Low/Medium:* this implies a free product and is not a true statement.
- Default metadata: title template "%s — TecHaust Technologies". OG/Twitter images point to `/icon-512.png` (a 512×512 square icon) while declaring `summary_large_image`.
- *Low:* `/about`, `/privacy` and `/terms` titles already contain "TecHaust Technologies", so the live titles duplicate it, e.g. "Privacy Policy — TecHaust Technologies — TecHaust Technologies".
- *Low:* there is no dedicated 1200×630 OG image; `/og.png` returns 404.

**Navbar** (`components/navbar.tsx`)
- Fixed and frosted; it deepens after 20px of scroll.
- Logo (BrandLogo, `aria-label="TecHaust Technologies — Home"`) → `/`.
- Desktop (≥1024px):
  - "SERVICES" hover/click dropdown (ARIA menu):
    - AI Knowledge Systems, "The Corporate Brain — private search" → `/services/knowledge-systems`
    - AI Workforce Automation, "The Digital Workforce — agents" → `/services/workforce-automation`
    - AI Security & Compliance, "The System Guard — ironclad wall" → `/services/security-guard`
  - "ROI CALCULATOR" → `/calculator`; "ABOUT" → `/about`; "CONTACT" → `/contact`.
  - Primary CTA "DEPLOY AI AGENT →" → `/contact`.
- Mobile/tablet (<1024px, including 768): a hamburger opens a dialog drawer with a focus trap, Escape to close and scroll lock. It contains:
  - SERVICES: the 3 links above
  - ROI Calculator, About TecHaust, Contact & Audit
  - "Deploy AI Agent" → `/contact`
- *Low:* the label "Deploy AI Agent" overpromises; the link only opens an enquiry form.

**Footer** (`components/footer.tsx`)
- Logo; tagline "Autonomous AI infrastructure for regulated enterprise — transforming scattered records…"; map-pin "Balurghat, West Bengal, India".
- "@techaustsocial" followed by 4 round buttons that use **text monograms, not icons** ("in", "𝕏", "f", "ig"). All open in a new tab (`target="_blank" rel="noopener noreferrer"`):
  - LinkedIn → https://linkedin.com/company/techaustsocial (HTTP 200 behind a bot wall: unverified, App. C §5)
  - X → https://x.com/techaustsocial (404; **superseded:** App. C S1 control-tested it, and the account does not exist)
  - Facebook → https://facebook.com/techaustsocial (bot wall: unverified, App. C §5)
  - Instagram → https://instagram.com/techaustsocial (a generic page that Instagram returns for any handle: unverified, App. C §5)
- PLATFORM: AI Knowledge Systems, AI Workforce Automation, AI Security & Compliance, ROI Calculator.
- COMPANY: About TecHaust, Contact & Audit, Privacy Policy, Terms of Service.
- Bottom bar: "© {current year} TecHaust Technologies. All rights reserved."; a pulsing green badge "**ALL AI SYSTEMS OPERATIONAL**" (static string from `siteConfig.status`, *High trust risk: no status system behind it*); "Engineered with ♥ (heartbeat animation) in India."
- No phone, no email, no legal-entity line, no GSTIN/CIN.

### A.1 `/` Home

- **Purpose:** positioning plus the route into the 3 services and the calculator.
- **Metadata:** title "Autonomous AI Infrastructure for the Enterprise — TecHaust Technologies".

**H1:** "Next-Gen / Autonomous AI / Infrastructure / for Enterprise." ("Autonomous AI" in a cyan→violet→fuchsia gradient.)

Sections in order:
1. **Hero**
   - Pill: "● TECHAUST PLATFORM v2.4 • NEXT-GEN AI INFRASTRUCTURE". *The version number implies a shipping, versioned product.* **VERIFY**
   - Body: unlocking corporate intelligence, automating back-office execution, "enforcing ironclad AI compliance"; TecHaust unifies Corporate Brain, Digital Workforce and System Guard into "one autonomous operating layer — private, accurate, and built for regulated enterprise".
   - CTAs:
     - "Explore Capabilities →" → `/services/knowledge-systems`. *Mislabelled: it goes to one service only.*
     - "Schedule Security Audit" → `/services/security-guard`. *Mislabelled: it says "schedule" but opens a service page, not the form.*
   - "Core guarantees" strip: "100% private / Within your perimeter", "Zero manual errors / Guarded ERP sync", "Ironclad shield / Edge-enforced defense".
2. **AI Core Matrix**, "TECHAUST CORE — COMMAND & CONTROL ● LIVE" (`hero-matrix-island.tsx`)
   - A tablist of 3 capabilities: Knowledge Systems (Corporate Brain • CORE://01), Workforce Automation (AI Agent • CORE://02), Security & Compliance (System Guard • CORE://03).
   - Each tab shows a 3-stage diagram, an animated "EXECUTION FEED" with canned lines ("Ingesting FY24_Q3_Consolidated.xlsx — chunk 042/128 vectorized", "Cross-checking line 09/14 against SO-8823", "Threat neutralized at edge in 4ms") and a metric: DOCS INDEXED 2,847 / INVOICES SYNCED 1,847 / THREATS BLOCKED 258.
   - Status bar: random "4–12ms PING", "OPERATIONAL NODES", "HYBRID-ENCRYPTED TRANSPORT".
   - Side note "CORE MATRIX NODE — Three divisions, one interoperable operating layer."
   - **Not labelled as a simulation.** *Critical (see #1).*
3. **Trust bar:** "TRUSTED FOR HIGH-COMPLIANCE ENTERPRISE WORKLOADS" over 3 badges: "100% Private Knowledge Retrieval", "Automated Invoice Reconciliation", "Prompt-Injection Shielding". *High: implies customers; none are named.*
4. **Capabilities overview**
   - Eyebrow "CAPABILITIES OVERVIEW". H2: "Three autonomous divisions. / One unified enterprise OS." Body: independently deployable, interoperable via the AI Core Matrix; "No fragmented tools. No manual handoffs."
   - 3 cards, each with an inline-SVG diagram (`PillarVisual`, `role="img"` with aria-label "… — bespoke system diagram"), a big watermark numeral, eyebrow, H3, description, a green "outcome" box, "Learn More →" to the service page, and a footer bullet line:
     - "01 — THE CORPORATE BRAIN / AI Knowledge Systems": "turn your company's messy files, PDFs, and spreadsheets into a private, secure internal search engine"; outcome "instant, accurate answers…"; bullet "Indexes PDFs • Sheets • Docs • Emails • Private by design".
     - "02 — THE DIGITAL WORKFORCE / AI Workforce Automation": AI agents for repetitive multi-step back-office paperwork; outcome "Reads inbound files, cross-checks invoices against shipping orders, and syncs your ERP — without manual data-entry errors".
     - "03 — THE SYSTEM GUARD / AI Security & Compliance": "ironclad digital wall… stop company data leaks, prompt hacks, and privacy vulnerabilities"; outcome "…full audit-ready compliance".
5. **ROI teaser**
   - Eyebrow "INTERACTIVE ROI CALCULATOR". H3 (no H2 in this section): "Calculate back-office hours / & cost saved — live."
   - Body: input team size and weekly document hours, see results, export to your audit request.
   - Chips: Team Size 5–500, Hours/Week 2–40h, Hourly Rate Adjustable.
   - "EXAMPLE OUTPUT $1,058,400 — Annual savings • 27,864h recovered". *Medium: not reproducible (see #9).*
   - CTA "Open Full Calculator →" → `/calculator`.
6. **Enterprise Trust Grid**
   - H2: "The enterprise outcomes that matter — no filler, no fluff."
   - 3 linked cards ("Explore →"): "Private Internal Search" (citation-backed, never the open web) → KS; "Automated Error Elimination" → WA; "Prompt & Data Shielding" ("executive peace of mind, full legal compliance") → SG.
   - *Medium: these largely repeat section 4 in different words.*
7. **CTA banner:** H3 "Ready to deploy your AI workforce?"; body "Get a quantified ROI blueprint and ironclad security audit…"; CTA "Deploy AI Agent — Request Audit →" → `/contact`.

- **Visuals:** lucide icons (all `aria-hidden`), 3 inline SVG pillar diagrams (labelled), animated terminal, background canvases. No `<img>` elements anywhere on the site, so alt text is N/A. Decorative SVGs are correctly hidden.
- **Length:** about 7,300px tall at 375px and about 6,300px at 768px. Heavy for mobile.

### A.2 `/about`

**H1:** "We build AI that works / like your best team — only faster."

1. **Hero**
   - Eyebrow: "ABOUT TECHAUST TECHNOLOGIES • NEW ERA TECH".
   - Body: "autonomous AI infrastructure company for regulated enterprise… We don't sell dashboards or generic chatbots"; three interoperable systems.
   - CTAs: "Start with an Audit →" → `/contact`; "Explore the Platform" → `/services/knowledge-systems`.
2. **Our Mission** (H2): eliminate the "search tax" and the "error tax"; "protects it with a wall no prompt hack or data leak can cross"; success is measured in hours returned and errors prevented.
3. **Our Story** (H2): "TecHaust was founded by **operators** who lived the back-office grind…"; existing AI tools introduced hallucinated citations and data egress; "So we built the opposite… ready for regulated workloads from day one". *High: the plural "operators" contradicts the solo-founder block below.*
4. **WHAT WE STAND FOR** (H2, mono): 3 values: "Accuracy Over Speed Theater", "Execution Over Demos" ("isn't a prototype… handling real paperwork volumes without human errors"), "Protection Over Promises". *High: "isn't a prototype" is a production-status claim. VERIFY.*
5. **The three divisions — one platform** (H2): 3 linked rows. Row 01 claims "Employees get instant, **100% accurate** answers" (*Critical*). Row 02: "zero manual entry errors". Row 03: "Proprietary records never leave your organization".
6. **WHO WE SERVE** (H3): ops, finance and compliance leaders in high-compliance enterprises processing "hundreds to thousands of documents monthly".
   - Stat tiles: Focus "Regulated Enterprise"; Deployment "Private / VPC / On-Prem"; Interop "Core Matrix (3 divisions)"; Response "4h • Audit in 14 days".
   - Note: "integrate with your existing stack… start with one workflow (e.g., invoice reconciliation)".
   - *High: on-prem/VPC capability and a 14-day audit SLA are capability claims. VERIFY.*
7. **Founder** (H2 "Rupak Sarkar")
   - "RS" monogram tile (no photo); "FOUNDER — TECHAUST TECHNOLOGIES"; "Founded the platform from the ground up in Balurghat, West Bengal, India — building every system it runs today."
   - 4 personal social pills opening in a new tab: LinkedIn /in/r4rupak1997, X /r4rupak1997, Facebook /r4rupak1997, Instagram /r4rupak1997. *Low: personal Facebook/Instagram on a B2B enterprise site.*
   - Narrative: a near-verbatim repeat of "Our Story", now singular ("an operator").
   - Quote: "Enterprise AI must be private by default, accurate to the source, and auditable end to end. Everything else is theater."
8. **CTA:** H2 "Meet the team behind your AI workforce."; "Request a 30-minute discovery with Solutions Architecture — NDA available, no sales pressure"; button "Contact & Audit →" → `/contact`. *High: no team is shown.*

### A.3 `/services/knowledge-systems` (The Corporate Brain)

**H1:** "Transform messy files / into an intelligent Corporate Brain."

1. **Hero**
   - Eyebrow "01 — THE CORPORATE BRAIN • AI KNOWLEDGE SYSTEMS".
   - Body: private, secure internal search engine; "**instant, 100% accurate answers**… completely eliminating guesswork" (*Critical*).
   - CTAs: "Deploy Corporate Brain →" → `/contact`; "Estimate Time Saved" → `/calculator`.
2. **H2 "From scattered files to instant answers — the workflow":** 01 Ingestion (native formats, incremental sync); 02 Vector Indexing (chunked, embedded, provenance, "Encrypted at rest and in transit"); 03 Private Internal Search (natural language, citation-backed, "No web hallucination").
3. **Demo** (H2 sr-only "Interactive Corporate Brain demo")
   - Widget "ASK YOUR CORPORATE BRAIN — INTERACTIVE DEMO": a search input plus 3 sample chips.
   - Samples: "Q3 revenue for the EMEA enterprise segment" → "$14.2M, up 18.4% QoQ… Confidence: 99.2%"; "compliance exceptions flagged last month" → "7 exceptions in Audit_Log_Nov2024.pdf"; "vendor contract renewal terms for Acme Corp".
   - Free text returns "Your Corporate Brain indexed 2,847 documents… Try one of the verified sample queries".
   - Every result is badged "VERIFIED ANSWER • CITATIONS INCLUDED", "Provenance: Encrypted", "Confidence: 99.2%", "Private • No web source".
   - *Critical: canned output presented as verified; the page never says "sample data". Only the Privacy Policy says it is synthetic. The data is also dated (FY24, Nov 2024).*
   - Side panel H3 "Value metrics — what you reclaim": "Elimination of guesswork" ("No hallucinations"), "Instant document lookup", "Zero folder hunting" ("**2,847+ documents unified**"). Note: "No data leaves your perimeter, and no conversation is retained for training."
4. **CTA strip:** "Indexes PDFs • Sheets • Docs • Emails • Incremental sync • Encrypted provenance"; "Request Brain Demo →" → `/contact`.

- **Metadata:** set in `layout.tsx`, because `page.tsx` has no metadata (a server page importing a client demo). Fine.

### A.4 `/services/workforce-automation` (The Digital Workforce)

**H1:** "Deploy autonomous AI agents / for back-office execution."

1. **Hero:** eyebrow "02 — THE DIGITAL WORKFORCE…"; body: agents read inbound files, cross-check invoices against shipping orders, and update your database "without human data-entry errors". CTAs: "Deploy Digital Workforce →" → `/contact`; "Calculate Hours Saved" → `/calculator`.
2. **H2 (mono) "STEP-BY-STEP VISUAL PIPELINE — LIVE SIMULATION"**
   - An auto-advancing 3-step stepper (2s per step, Pause/Resume button, progressbar): "Inbound File Reading" (email, SFTP, shared drives; PDF/XLSX/CSV/images); "Invoice & Order Cross-Checking" (price, qty, terms, duplicates); "Database / ERP Sync" (audited API, before/after log).
   - Footer line: "**Live: 1,847 documents processed today • Avg. handling time 4.2s vs. 8.5 min manual**"; "Automated execution • 100% auditable". *Critical: stated as a live fact despite the "simulation" heading.*
3. **H2 "Why back-office teams choose the Digital Workforce":** "Elimination of human data-entry errors", "Multi-step back-office processing", "Background workflow automation". *"choose" implies existing customers.*
4. **Interop note** plus "Map My Workflow →" → `/contact`.

- *Low:* no named ERP integrations (Tally, SAP, Zoho, etc.), which Indian SMB/enterprise buyers would look for.

### A.5 `/services/security-guard` (The System Guard)

**H1:** "Ironclad digital shields / for enterprise AI deployments."

1. **Hero:** eyebrow "03 — THE SYSTEM GUARD • AI SECURITY & COMPLIANCE"; body: ironclad wall… data stays inside your organization "with audit-ready evidence for leadership and regulators". CTAs: "Request Security Audit →" → `/contact`; "See Corporate Brain" → KS.
2. **H2 "Three pillars — no gaps, no exceptions":** "Stop Company Data Leaks" ("No proprietary file, prompt, or record ever leaves"), "Block Prompt Hacks" (real-time injection detection, intent sandboxing, output guardrails), "Eliminate Privacy Vulnerabilities" (auto PII redaction, scope-limited retrieval).
3. **Monitor** (H2 sr-only "Real-time threat monitor simulation")
   - Widget "SYSTEM GUARD — REAL-TIME THREAT MONITOR ● ACTIVE" with Pause/Resume.
   - Tiles: Data Leak Blocks 89, Prompt Hacks Blocked 142, Privacy Guards Hit 27, each "100% blocked".
   - A feed adds a random event every 2.8s timestamped with the visitor's clock ("Prompt Injection — Blocked… Live detection • Auto-guardrail").
   - Footer: "All events are immutably logged… Export an auditor-ready evidence pack at any time."
   - *Critical: looks like live production telemetry; there is no visible simulation label.*
   - Side H3 "Executive assurance — what the Guard guarantees": "Proprietary data never leaks", "**Full legal compliance**" ("compliant by design — not by manual review"), "Peace of mind for leadership". Interop note. CTA "Get Executive Assurance Pack →" → `/contact`.
   - *Critical: "guarantees" plus "full legal compliance".*

### A.6 `/calculator` (ROI estimator, client page)

**H1:** "Quantify back-office / automation ROI — live."

- **Intro:** a "conservative 72% automation rate derived from invoice cross-checking and ERP sync workloads protected by the System Guard". *Medium: no source; "conservative" is unsupported.*
- **Inputs:**
  - TEAM SIZE: range 5–500, step 5, default 45.
  - MANUAL DATA-ENTRY HOURS / WEEK (PER PERSON): range 2–40, default 18.
  - AVERAGE HOURLY RATE (BLENDED, USD): number 10–300, default 38, clamped on every keystroke.
  - Fixed tiles: Weeks/Year 48, Automation rate 72%, Source "Digital Workforce pipeline".
- **Outputs** (`aria-live`): Annual cost reduction (default **$1,063,772**), hours recovered/year (**27,994h**, about 3,499 workdays), efficiency gain 72% ("Manual effort eliminated"), plus a "How this maps to your 3 pillars" list.
- **CTA:** "Export Calculation to Security Audit Request →" → `/contact?team=&hours=&rate=&savings=&recovered=`. Caption: "Forwards your figures… via secure URL parameters" (*Low: URL parameters aren't "secure"*).
- **Methodology note:** team × hours × 48 × 72% × rate; "Your actual gain is typically higher…" (*Medium: unsupported upward claim*).
- **Issues:**
  - USD only, with no INR option for an Indian company.
  - Efficiency gain is always 72% regardless of input, so it isn't a computed result.
  - The decimal-rate export breaks the contact submission (see #7).

### A.7 `/contact`

**H1:** "Request your / AI Security & Workflow Audit."

1. **Hero:** eyebrow "CONTACT & AI SECURITY / WORKFLOW AUDIT"; body: "Our solutions architect will map your… deployment — with a quantified ROI plan, ironclad data-leak protection, and prompt-hack shielding."
2. **Form section** (`ContactFormIsland`)
   - Left column, H2 "What you receive in 30 minutes": Private search readiness; Automated back-office blueprint; Ironclad guard assessment.
   - "CALCULATOR IMPORTED" card (only with URL params; dismissible): TEAM, HOURS/WEEK, HOURS RECOVERED, EST. SAVINGS. Verified live.
   - Contact card: "TH" gradient avatar, "TecHaust Solutions Architecture Team", "NDA available • 4-hour response • Technical deep-dive first", "Direct: contact@techaust.com" (mailto).
   - Right column: the form card, H3 "Security Audit & ROI Blueprint Request" with a "🔒 TLS 1.3 • Private" tag.
3. **Facts band:**
   - "REGISTERED OFFICE: Pirozpur, Balurghat, Dakshin Dinajpur, West Bengal - 733133, India". *High: "registered office" implies a registered company. VERIFY.*
   - "RESPONSE SLA: Within 4 business hours, with NDA available on request. Every enquiry lands with a named architect — never a queue."
   - "HANDLING: Enquiries are handled from this office in India. Delivered straight to the audit inbox above — no forwarding queues." (*Low: "above" refers to nothing directly above.*)

**Form spec** (client: Zod + react-hook-form, `noValidate`; server: `app/api/contact/route.ts`)

| Field | Type | Req | Client rule | Server rule |
|---|---|---|---|---|
| Full name | text, autocomplete=name, placeholder "Alex Morgan" | Yes | trim, min 2 | min 2, **max 80** |
| Work email | email, placeholder alex@company.com | Yes | valid email | valid email, **max 120** (free webmail accepted despite "work email") |
| Organization name | text, placeholder "Acme Corporation" | Yes | min 2 | min 2, **max 120** |
| Organization size | select: 1–20 / 21–100 / 101–500 / 501–2,000 / 2,000+ | Yes | non-empty | non-empty (any string accepted) |
| Service category interest | select: knowledge / workforce / security / all | Yes | non-empty | non-empty |
| Project details | textarea, 4 rows | Yes | 10–2000 chars | 10–2000 |
| Request AI Security & Workflow Audit | checkbox, **pre-checked** | No | — | boolean |
| Discovery call slot | select: Next available (within 4h) / Tomorrow AM (PT) / Tomorrow PM (PT) / Later this week | No | — | string |
| `website` | hidden honeypot | — | — | if filled: silent 200, no email |
| `calc` | from URL params | — | strings or "-" | each `^\d{1,6}$` (savings/recovered `^\d{1,12}$`), so **decimals or "-" fail the whole request** |

- **Consent:** only the text "By submitting, you agree to our Privacy Policy and Terms. Submissions are securely delivered to contact@techaust.com." There is no separate consent checkbox and no purpose-specific notice (DPDP §5/§6 notice and consent: **VERIFY WITH CA/LEGAL**).
- **On submit:**
  1. POST `/api/contact`, rate-limited to 5 per minute per IP (in-memory, per-isolate).
  2. Zod validation, then honeypot check, then `<>` stripped.
  3. Resend API sends to `CONTACT_TO_EMAIL` (default contact@techaust.com) with `reply_to` set to the submitter. Subject: "Audit Request — {company} ({focus})".
  4. **Success:** a toast for 6s: "Audit request received, {first name}. Our solutions architect will contact you at {email} within 4 business hours [• Calculator: Nh / $N saved]. All inquiries are securely delivered to contact@techaust.com." The form resets.
  5. No auto-acknowledgement email to the submitter, and no analytics or conversion event.
- **Errors:** 429 "Too many requests…"; 400 "Validation failed" (generic and unhelpful); 503 "Email service is not configured. Please email contact@techaust.com directly."; 502 "Delivery failed…".
  - *Medium (security; see App. A F-S2):* the 502 body includes `debug` with the Resend error text and the configured `from`/`to` addresses.
- **Data flow:** personal data goes to Cloudflare (edge), then Resend (US), then the techaust.com mailbox provider (unknown). The Privacy Policy names none of these correctly.

### A.8 `/privacy`

**H1:** "Privacy Policy". Badge "EFFECTIVE 04 SEPTEMBER 2026". Chips: "Controller: TecHaust Technologies", "Contact: contact@techaust.com", "Jurisdiction: Global • GDPR / CCPA aligned".

What it says, by section:
- **Core principle:** "strict zero-data retention"; customer data "never retained for training, never shared externally, and never visible to TecHaust staff unless you… grant scoped support access"; TLS 1.3 and AES-256.
- **1. Information we collect:** the contact form fields, which go to contact@ and are "stored solely to fulfill your request"; calculator inputs (URL params). Automatic: "basic web analytics… cookie-minimal" and "security telemetry… processed by the System Guard to block prompt injections". Note: "The Corporate Brain demo uses synthetic sample documents only."
- **2. Use:** reply within 4 business hours, site security, service communications ("No marketing emails without explicit opt-in"), legal compliance.
- **3. Legal bases (EEA/UK):** contract, legitimate interest, consent.
- **4. Sharing:** no sale; service providers "e.g., hosting on **Vercel Edge / Cloudflare Pages**, email relay"… with "zero-retention commitments"; legal disclosure; "No sharing with AI model training partners. Ever."
- **5. Retention:** contact requests up to 24 months; security logs 12 months; customer deployments per DPA.
- **6. Rights:** access, correct, delete, restrict, object, export, withdraw, via contact@; "We respond within 24 hours and fulfill verified requests within 30 days"; GDPR supervisory-authority complaint.
- **7. Security:** "The same wall we sell is the wall we live behind": perimeter enforcement, prompt-injection shielding, PII redaction on logs, immutable audit trails.
- **8. International transfers:** SCCs "or equivalent".
- **9. Cookies:** essential and anonymous analytics only.
- **10. Children:** not intended for under-18s.
- **11. Changes:** "Continued use… constitutes acceptance."
- **Contact:** contact@ (listed twice); "[SECURITY]" subject tag.

**Gaps vs India's DPDP Act 2023 and DPDP Rules 2025 (all VERIFY WITH CA/LEGAL)**

> **Timeline.** The DPDP Rules' core duties start on **13 May 2027**. Until then the IT Act s.43A and the SPDI Rules 2011 apply (see [08 L-1 and L-2](../08-security-compliance.md) and [08-B](../08-research-appendix/B-dpdp-legal.md)). **VERIFY WITH CA/LEGAL.**

| Sev | Gap |
|---|---|
| Critical | No mention of the DPDP Act at all; the jurisdiction says "Global • GDPR/CCPA aligned" for an India-based Data Fiduciary. |
| Critical | No identified legal entity or postal address of the Data Fiduciary inside the policy. The address appears only on /contact. |
| High | No **Grievance Officer / contact person** with a name, designation and response timeline, and no stated route to escalate to the **Data Protection Board of India**. |
| High | **Notice requirements** (itemised data, specific purpose, how to withdraw consent, how to complain to the Board) aren't given at the point of collection. The form relies on "by submitting you agree". Consent bundled with Terms acceptance may not qualify as "free, specific, informed, unconditional and unambiguous". |
| High | **Processors misidentified.** It says Vercel Edge / Cloudflare Pages; production is Cloudflare Workers plus **Resend** (US email API, which keeps message logs) plus an unnamed mailbox host. The "zero-retention commitments" from providers are unverified. Cross-border transfer: the policy cites EU SCCs, not DPDP §16 (transfers allowed except to notified restricted countries). |
| High | **Unverifiable security statements:** "System Guard" protects the site against prompt injection (the site has no AI endpoint); "immutable audit trails"; "PII redaction on logs"; AES-256; "never visible to TecHaust staff" (contact emails are, by design, read by staff). If false, these are deceptive. |
| Medium | **Analytics is unnamed.** The live site loads the Cloudflare Web Analytics/RUM beacon (`/cdn-cgi/rum` observed); the policy doesn't name it. |
| Medium | **Retention:** "24 months to maintain a service relationship" needs a basis; DPDP requires erasure once the purpose is served (and Rules-prescribed periods). There is no deletion-on-withdrawal statement. |
| Medium | Internal inconsistencies: "respond within 24 hours" vs "4 business hours" elsewhere; "Continued use constitutes acceptance" is weak for consent-based processing. |
| Medium | No breach-notification commitment (DPDP requires intimation to the Board and affected Data Principals). |
| Low | Rights list is GDPR-style; DPDP-specific rights (summary of data and processing, list of recipients, **right to nominate**) are missing. |
| Low | Children: DPDP defines a child as under 18 and requires verifiable parental consent. "Not intended for under-18s" is fine, but say what happens if a child's data is received. |

### A.9 `/terms`

**H1:** "Terms of Service". Badge "EFFECTIVE 04 SEPTEMBER 2026". Chips: Entity TecHaust Technologies; Contact contact@; "MSA + DPA prevail over web terms for customers".

Summary:
- **Plain-English summary:** the web terms cover the site and audit requests; the enterprise MSA/DPA controls production.
- **§1:** 18+ and authority to act.
- **§2:** Services; the site's descriptive guarantees "are delivered under that production contract, not by browsing the site".
- **§3:** acceptable use (no bypassing the Guard, prompt injection, scanning, malware); right to rate-limit or block.
- **§4:** IP ("glassmorphism, Core Matrix visuals, particle system"); limited licence; customer keeps its data.
- **§5:** confidentiality (an NDA controls); don't submit credentials.
- **§6:** privacy pointer.
- **§7:** the calculator is directional only.
- **§8:** as-is disclaimer.
- **§9:** liability capped at **USD $100**; consequential damages excluded.
- **§10:** indemnity.
- **§11:** termination and survival.
- **§12: governing law is Delaware, USA, with exclusive venue in Wilmington, DE** for website-only disputes.
- **§13:** unilateral changes, with continued use as acceptance.
- **Contact:** contact@ with [LEGAL] / [SECURITY] subject tags.

Gaps (VERIFY WITH CA/LEGAL):

| Sev | Gap |
|---|---|
| High | Delaware law and venue for an Indian business with no stated US entity. Indian consumer and IT law may apply regardless; it looks templated and undermines credibility with Indian buyers. |
| High | No legal entity name, registration number, registered address or GST details. |
| Medium | No IT Act 2000 / IT (Intermediary) Rules grievance mechanism reference. No dispute-resolution option under Indian law (arbitration seat, e.g. Kolkata). |
| Low | Liability cap in USD, not INR. |
| Low | §4 claims IP in generic design elements (glassmorphism), which is an odd boast. |

### A.10 404 (`app/not-found.tsx`)

- Live returns HTTP **404** and `meta robots noindex`. Title "404 — Core Node Not Found — TecHaust Technologies".
- H1 "404 — Core Node Not Found"; "The requested system path does not exist."; CTA "Return to Core" → `/`.
- *Low:* no links to services or contact, and no search.

### A.11 Error (`app/error.tsx`, client)

- H1 "Something went wrong"; "The AI Core encountered an unexpected state. Your data remains secure and private."; optional "Ref: {digest}"; a "Try again" button that calls `reset()`.
- *Low:* the "data remains secure" reassurance is unearned on a marketing site. There is no contact link.

### A.12 Loading (`app/loading.tsx`)

- `role="status"`, aria-label "Loading TecHaust Core", a spinner and "LOADING TECHAUST CORE...".
- **High:** this is the server-rendered `<main>` content of every route; the real content streams into a hidden div (see #8).

### A.13 Other routes and assets

- `/sitemap.xml`: 9 routes with `lastModified` = request time (always "now"; *Low*).
- `/robots.txt`: allow all, disallow `/api/`.
- `/manifest.webmanifest`: standalone, #07080C.
- Icons: `/icon.svg` (64-unit chamfered octagon tile with the T mark), `/favicon.ico` (16/32/48), `/apple-icon.png` (180), `/icon-512.png` (512, also used as the OG image). All return 200.
- `app/icon-512.png` is a stale duplicate (5.5KB vs 22.8KB in public/; not served from app/; *Info*).
- `www` returns a 301 to apex.
- Security headers on live: HSTS (preload), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy. No CSP (see App. A F-S8 and App. C H1).
- Dead code (*Info*): `components/particle-canvas.tsx` (unused), `components/ui/button.tsx` (unused), and in `lib/site-config.ts` `EMAIL_DIRECTORY` plus the sales@/support@/admin@/billing@ addresses (never rendered; README lists sales@ and support@ as live contacts).

### A.14 Consolidated link inventory

**Internal**

| Link | Target |
|---|---|
| Logo | `/` |
| Nav: Services | 3 service pages |
| Nav: ROI Calculator | `/calculator` |
| Nav: About | `/about` |
| Nav: Contact | `/contact` |
| Nav CTA "DEPLOY AI AGENT" | `/contact` |
| Footer: Platform | 3 service pages + `/calculator` |
| Footer: Company | `/about`, `/contact`, `/privacy`, `/terms` |
| 404 "Return to Core" | `/` |

In-page CTAs:

| Page | CTA | Target |
|---|---|---|
| Home | Explore Capabilities | KS |
| Home | Schedule Security Audit | SG |
| Home | Learn More ×3 | service pages |
| Home | Open Full Calculator | `/calculator` |
| Home | Explore ×3 | service pages |
| Home | Deploy AI Agent — Request Audit | `/contact` |
| About | Start with an Audit | `/contact` |
| About | Explore the Platform | KS |
| About | 3 division rows | service pages |
| About | Contact & Audit | `/contact` |
| KS | Deploy Corporate Brain | `/contact` |
| KS | Estimate Time Saved | `/calculator` |
| KS | Request Brain Demo | `/contact` |
| WA | Deploy Digital Workforce | `/contact` |
| WA | Calculate Hours Saved | `/calculator` |
| WA | Map My Workflow | `/contact` |
| SG | Request Security Audit | `/contact` |
| SG | See Corporate Brain | KS |
| SG | Get Executive Assurance Pack | `/contact` |
| Calculator | Export… | `/contact?params` |
| Contact | Privacy, Terms (plain `<a>`) | `/privacy`, `/terms` |
| Privacy | inline links; "Go to Contact & Audit"; "View Terms of Service" | `/contact`, `/calculator`, `/terms` |
| Terms | inline links; "View Privacy Policy"; "Contact & Audit" | `/contact`, `/calculator`, `/privacy` |

- *Medium (conversion):* 13+ differently worded CTAs all land on the same generic `/contact`. None pre-selects the service category (e.g. `?focus=security`), and none delivers the promised "Assurance Pack", "Brain Demo" or "Workflow map".

**External** (all `target="_blank" rel="noopener noreferrer"`)
- Brand: linkedin.com/company/techaustsocial, x.com/techaustsocial, facebook.com/techaustsocial, instagram.com/techaustsocial.
- Founder: linkedin.com/in/r4rupak1997, x.com/r4rupak1997, facebook.com/r4rupak1997, instagram.com/r4rupak1997.

**mailto**
- `contact@techaust.com` on Contact (direct line and consent text), Privacy (×3) and Terms (×2).
- **No `tel:` links and no phone number anywhere.**

### A.15 Business facts stated on the site

| Fact | Value on site | Status |
|---|---|---|
| Brand | TecHaust Technologies ("TecHaust") | OK |
| Legal entity | none stated; JSON-LD legalName = brand | **VERIFY** (High) |
| Address | Pirozpur, Balurghat, Dakshin Dinajpur, West Bengal 733133, India (labelled "Registered office") | VERIFY registration |
| Phone | none | Gap (Medium trust) |
| Emails | contact@techaust.com (only one rendered) | sales/support/admin/billing defined but unused |
| Socials | @techaustsocial on LinkedIn/X/FB/IG | X does not exist (App. C S1); LinkedIn, Facebook and Instagram unverified (App. C §5) |
| Founder | Rupak Sarkar, "Founder"; personal handles r4rupak1997 | OK; no photo, background, credentials or LinkedIn summary on the page |
| Team | "Solutions Architecture Team", "named architect", "operators" | **Likely overstated** (High) |
| Products | Corporate Brain / Digital Workforce / System Guard; "Platform v2.4"; "AI Core Matrix" | **VERIFY** production status |
| Deployment | Private / VPC / On-Prem | VERIFY |
| SLAs | 4 business-hour response; audit in 14 days; "within 4h" call slot; privacy says 24h | Inconsistent |
| Stats | 2,847 docs; 1,847 docs/invoices; 4.2s vs 8.5 min; 258 threats (89/142/27); 99.2% confidence; ping 4–12ms; $1,058,400 / 27,864h example; 72% automation | **Fabricated or simulated; must be labelled or removed** |
| Security | TLS 1.3, AES-256, zero retention, immutable logs, PII redaction | VERIFY |
| Compliance | "full legal compliance", "GDPR/CCPA aligned", "audit-ready" | No certifications claimed (no SOC2/ISO, which is good), but compliance claims are unsupported |
| Testimonials / logos / case studies | none | Gap (no social proof) |
| Pricing | none; SoftwareApplication JSON-LD says price 0 USD | Misleading schema (Medium) |
| Currency / timezone | USD; PT call slots | Audience mismatch |

---

## B. Design

### B.1 Layout system and grid

- **Container:** `max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8` on every section; the navbar uses `max-w-7xl` (also 1280). Gutters are 16 / 24 / 32px.
- **Grid:** no formal 12-column grid. Each section uses its own CSS grid:
  - `lg:grid-cols-3` for cards
  - asymmetric splits: `[1.05fr_0.95fr]`, `[0.95fr_1.15fr]`, `[1.1fr_0.9fr]`, `[290px_1fr]`, `[minmax(280px,0.72fr)_1.4fr]`
  - `max-w-[900px]` for the legal pages
- **Breakpoints:** almost every multi-column layout and the desktop nav switch at **lg (1024px)**, and `md` is barely used. At **768px tablet everything is single-column with a hamburger**, so card grids become very tall full-width stacks (home is about 6,300px at 768). *Medium:* add `md:grid-cols-2/3`.
- **Vertical rhythm:** sections use `py-12 md:py-20 lg:py-28` on home and services but `py-10 lg:py-14` / `py-2 lg:py-6` on About, so spacing is inconsistent between pages.
- **Card language:** a gradient-border "frame" (`p-[1px] bg-gradient-to-b from-white/10 to-white/5`) around a solid `#0F111A` or glass inner. Radii are 24/23px for large cards and 16/15px for small ones, plus `rounded-xl`/`rounded-full` pills. Consistent overall.

### B.2 Typography

- **Fonts**, all via `next/font/google` (`display: swap`, latin subset). vinext self-hosts them under `/_next/static/_vinext_fonts/` (observed in network; the README's "loads from CDN" troubleshooting note is outdated):
  - **Plus Jakarta Sans:** body (`--font-jakarta`)
  - **Space Grotesk:** display (`--font-space`)
  - **JetBrains Mono:** labels and UI (`--font-jetbrains`)
- **Fluid scale** (globals.css):
  - `.fluid-display` clamp(2.75rem, 1.25rem+7vw, 5rem): home H1 (80px at desktop)
  - `.fluid-hero` clamp(2rem, 1.2rem+4vw, 3.375rem): inner-page H1s
  - `.fluid-h2` clamp(1.625rem, 1.2rem+2.2vw, 2.5rem): home H2s and legal H1s
  - `.fluid-h3` (defined, unused)
  - Line-height 0.98–1.1, negative tracking, `text-wrap: balance`.
- **Everything else** uses arbitrary pixel sizes: 9px ×1, 10px ×11, 11px ×24, 12px ×78, 13px ×25, 14px ×71, 15, 16, 17, 18, 20, 22, 24, 30, 36, 72. That's 16 distinct sizes, so there is effectively no type scale.
- **Bug (Medium, verified live):** 71 uses of `font-[var(--font-space)]` intended to set Space Grotesk on h3s, card titles and CTA headings resolve to **Plus Jakarta Sans** (computed style on `main h3` and `#roi-heading`). Use the existing `--font-display` theme token (`font-display`) or `font-(family-name:--font-space)`.
- **Mono overuse (Medium):** JetBrains Mono, uppercase with 0.12–0.16em tracking, is used for eyebrows and nav, and also for whole paragraphs (About division descriptions, Guard assurance bullets, Privacy/Terms intros, the calculator methodology, home outcome boxes). That hurts readability, and the result reads more "hacker terminal" than "enterprise".
- **Small text:** the logo caption "TECHNOLOGIES" renders at **8px**; hop labels 9px; many 10–11px labels. The README says "minimum 12px for mono labels (WCAG)", and the code violates its own rule.
- **Heading hierarchy:** the home ROI and CTA sections use H3 without an H2 parent; About uses H2 for "Our Mission", "Our Story", "WHAT WE STAND FOR" and the founder name but H3 for "WHO WE SERVE". *Low.*

### B.3 Colour palette

**Exact tokens in `app/globals.css` (`@theme inline`)**

| Token | Hex |
|---|---|
| --color-background / --color-obsidian | `#07080C` |
| --color-foreground | `#E2E8F0` |
| --color-obsidian-soft | `#0F111A` |
| --color-cyan | `#00F0FF` |
| --color-cyan-soft | `#00D4E0` |
| --color-violet | `#7C3AED` |
| --color-violet-soft | `#A78BFA` |
| --color-neon | `#B026FF` |
| --color-border | `#1E293B` |

**Other hard-coded colours**
- Surfaces: `#0B0D14`, `#0F111A`, `#080A0F`, `#0A0C14`, `#12141f`, `#090A0F` (button text).
- Glass: `rgba(13,16,23,.65)`, `rgba(15,17,26,.72)`, `rgba(7,8,12,.5/.85)`.
- Logo metal gradient: `#FFFFFF` → `#D7E3F2` → `#8EA2B8`; core `#EAFDFF`.
- Scrollbar gradient: `#00F0FF` → `#7C3AED`.
- Focus ring: `#00F0FF` 3px.
- Status: emerald-400 `#34D399`, amber `#FBBF24`, red `#F87171`/`#EF4444`.

**In practice**
- Components mostly use **Tailwind defaults** (cyan-200/300/400, violet-200/300/400/500/600, fuchsia-300/600, emerald-200/300/400/500, teal-600, slate-200/300/400/500, `white/xx`) rather than the theme tokens. `bg-obsidian`, `text-cyan` and the other tokens are almost never referenced, so the token layer is decorative. *Medium (consistency):* Tailwind's cyan-400 is `#22D3EE`, not the brand `#00F0FF`.
- **Gradient system:** primary CTA cyan-400 → violet-600; each division has its own accent (KS cyan→violet; WA violet→cyan; SG emerald→cyan). This works as a colour-coding system.
- **Contrast (Medium):**
  - `text-white/30` (≈2.6:1) and `/40` (≈3.6:1 on #0F111A; 3.8:1 on #07080C, App. C A2) fail WCAG AA for small text (4 + 9 uses), e.g. calculator sub-labels and "Forwards your figures…".
  - `text-slate-500` (#64748B ≈ 4.2:1) at 11–12px in the footer and contact band fails AA (below 4.5:1).
  - Gradient-clipped text (cyan→violet) is fine at display sizes.
- `AmbientLight` sits at fixed `z-[1]` *above* page content (13% opacity, blurred), which slightly tints text on desktop. *Low.*

### B.4 Logo and brand assets

- **Mark (`components/brand-logo.tsx`):** a chamfered geometric "T" on a 32-unit grid with a metallic white→slate gradient, a cyan "energy core" glow top-right, a cyan hairline under the bar, a cyan trace and a violet satellite node. It sits in a 10px-radius glass tile with a hover glow.
- **Wordmark:** "Tec" white + "Haust" cyan-400 in bold Space Grotesk (applied via inline style, so it renders correctly), with a "TECHNOLOGIES" mono caption at 0.32em tracking.
- **Generated assets:** `scripts/generate-brand-assets.mjs` (pure-Node rasteriser) writes `app/apple-icon.png` (180), `public/icon-512.png` (512) and `app/favicon.ico` (16/32/48) on a `#0B0D14` chamfered-octagon tile. `app/icon.svg` holds the same geometry at 64 units.
- **Assessment:**
  - The mark is distinctive and coherent with the UI.
  - At 16px the small details (traces, satellite) will mush. A simplified favicon variant would help. *Low.*
  - The caption at 8px is illegible. *Low.*
  - **No proper OG/social card:** the square icon is reused as a `summary_large_image`, so shares on LinkedIn/X/WhatsApp will look poor. *Medium.*
- **No photography or illustration assets:** all visuals are code-drawn (SVG, canvas, CSS).

### B.5 Iconography

- `lucide-react` throughout (Brain, Bot, ShieldCheck, Lock, FileCheck, Database, Zap, Activity, Sparkles, etc.), usually 14–20px inside 28–40px rounded tiles, consistently `aria-hidden`.
- Social links use text monograms ("in", "𝕏", "f", "ig") instead of recognisable brand glyphs. *Low.*
- Icons are reused across unrelated meanings: ShieldCheck appears for SG, values, the trust grid and the handling band; Sparkles for random eyebrows. *Low.*

### B.6 Motion and animation

Motion appears in the following places:
- Neural cursor canvas (rAF) and ambient light (rAF), desktop only.
- Film grain.
- Navbar scroll state.
- Framer Motion: dropdown, mobile drawer, matrix entrance, tab panel and feed transitions, contact toast, demo answers, guard events, stepper progress.
- CSS:
  - shimmer sweep on CTAs
  - `animate-pulse` dots (hero pill, LIVE, ACTIVE, footer status, calculator)
  - `animate-ping` in the matrix
  - deck-pulse dots travelling along connectors
  - pillar SVG dash/pulse/spin
  - matrix glow
  - footer heart "heartbeat"
- Interval-driven fake telemetry: matrix every 1.7–2.1s, guard feed every 2.8s, stepper every 2s.

**Reduced motion** is handled well: there is a global CSS kill-switch, `useReducedMotion` in islands, and the canvases are disabled. The stepper and guard feed have Pause controls (WCAG 2.2.2).

**Critique (Medium):** motion is constant and everywhere. On a single home viewport there can be 8+ simultaneously animating elements, and the "pulsing green dot" idiom is used about 7 times. It reads as a demo reel rather than a calm enterprise vendor, and it drives CPU/battery use.

### B.7 Dark/light mode

- **Dark only:** `class="dark"` is forced and `themeColor` is `#07080C`. There is no light theme and no `prefers-color-scheme` handling.
- Acceptable as a brand choice. Note that legal pages printed or read in bright environments use small grey mono text. *Info.*

### B.8 Imagery style and brand tone

- **Imagery:** "obsidian" near-black, glassmorphism, neon cyan/violet glows, terminal/command-centre UI, faux telemetry, particle networks. There are no people, offices, product screenshots or real dashboards.
- **Tone:** hyperbolic and militarised ("ironclad", "wall", "shield", "neutralized", "Command & Control", "Deploy AI Agent", "Core Node", "Return to Core"). It mixes very plain explanations ("We turn your company's messy files… into a private, secure internal search engine", which is good and clear) with jargon and absolutes.
- The same 3-pillar sentence is repeated almost verbatim 10+ times across pages.

### B.9 Responsiveness (observed live)

| Viewport | Horizontal overflow | Observations |
|---|---|---|
| 375×812 | None (scrollWidth = 375 on all 9 routes plus 404) | Hamburger nav works. Matrix collapses to a 3-up tab grid; terminal title truncates ("TECHAUST CORE — COMMAND …"); hop labels drop to 9px. Hero pill wraps to 2 lines. Home is about 7,300px long. Footer stacks cleanly. |
| 768×1024 | None | Still mobile layout (hamburger, single-column cards). Card watermark numerals ("02") are visibly clipped at the card's top edge. Large empty side margins on cards. |
| 1280×800 | None | Layout as designed. 3-column grids, sticky calculator results panel, desktop dropdown. |

- `body { overflow-x: hidden }` would mask any overflow anyway. Measured element bounds showed no element outside the viewport.

### B.10 Consistency issues (summary)

- **CTA verbs vary:** Deploy / Request / Schedule / Get / Map / Start / Explore / Calculate / Estimate. "Schedule Security Audit" and "Explore Capabilities" go to unexpected targets.
- **Response promises conflict:** 4 business hours; "within 4h" call slot; "24 hours" (privacy); "rapid acknowledgment" (terms).
- **Founding story:** "founded by operators" vs a sole founder.
- **Heading font:** Space Grotesk on fluid headings, Jakarta everywhere else (bug).
- **Colour:** brand tokens defined but Tailwind palette used, so cyan `#00F0FF` vs `#22D3EE` both appear.
- **Copy reuse:** Story and Founder narrative are duplicate paragraphs; Home trust grid repeats the capability cards.
- **Workforce sub-label:** "AI Agent" in the matrix vs "Digital Workforce" elsewhere.
- **Same number, two meanings:** 1,847 is "invoices synced" (home) and "documents processed today" (WA).

### B.11 Honest critique: how a prospective client would read it

**What works**
- A visually polished, modern, technically competent site. Fast edge hosting, accessible patterns (skip link, focus rings, ARIA tabs and menus, pause controls, reduced motion).
- The three offerings are explained in one plain sentence each, which is the site's best copy.
- The calculator → contact hand-off is a smart conversion idea.

**What hurts**

1. **Clarity of what's sold:** "Next-Gen Autonomous AI Infrastructure for Enterprise" is generic; a visitor can't tell in 5 seconds whether TecHaust is a product company, a custom-build agency or a consultancy.
   - In reality it reads as custom RAG search, document/invoice automation agents, and LLM security guardrails, delivered as projects.
   - Nothing describes engagement models, timelines, price bands, tech stack, integrations (Tally/SAP/Zoho/Google Drive/SharePoint) or who owns the IP and data.
2. **Trust signals are inverted.** Enterprise and regulated buyers (the stated target) do due diligence. They will find:
   - no legal entity, no phone, no team, no clients, no case studies
   - a one-person founder card with a monogram
   - simulated "LIVE" dashboards and fabricated metrics
   - absolute guarantees ("100% accurate", "never leaks", "full legal compliance")
   - a Delaware-law template and GDPR boilerplate for an Indian company

   For a sceptical CISO or CFO, the gap between "regulated-enterprise platform v2.4" and the visible company size **reduces** credibility more than modest, honest positioning would. The aesthetic (neon, terminal, constant motion) signals "startup demo" rather than "safe pair of hands for compliance data".
3. **Conversion path:** many CTAs, one generic form, and no way to book a call directly (no Calendly or phone). Service context isn't carried into the form. The "Deploy AI Agent" CTA label overpromises. The form asks for a lot (7 fields) for a first touch, and the calculator path can fail on decimal input. There is no acknowledgement email, so leads can't tell whether the request went through after the 6s toast.
4. **Audience mismatch:** USD and PT slots and Delaware imply US enterprise; the address and "Engineered in India" imply an Indian SMB vendor. Pick one, or localise (INR/IST for India, plus explicit "serving US/EU clients from India" if that's the intent).

**Recommended direction**
- Replace fabricated numbers with clearly labelled "Illustrative demo" or real, sourced figures.
- Soften absolutes ("designed to", "helps reduce").
- Add a real entity block (legal name, CIN/GSTIN or Udyam, phone).
- Show the founder properly (photo, background), plus any pilot or case study (anonymised is fine).
- Put engagement models and indicative pricing on the page.
- Add one calm "How we work" section.
- Make the calculator results INR/USD selectable.
- Fix the display-font bug and add `md` breakpoints.
- Tone motion down to one hero animation.

---

## C. Issue register (by severity)

**Critical**
- C1. Simulated "LIVE" telemetry and metrics presented as real: matrix, Guard monitor, stepper "Live: 1,847 documents processed today", demo "VERIFIED ANSWER… 99.2%", footer "ALL AI SYSTEMS OPERATIONAL", "Platform v2.4". (home, KS, WA, SG, footer)
- C2. Absolute or unsubstantiated performance and compliance guarantees ("100% accurate", "No hallucinations", "Zero manual errors", "never leaks", "Full legal compliance", "no gaps, no exceptions"). (all service pages, About, home)
- C3. Privacy Policy not aligned with DPDP Act 2023; processors misnamed; unverifiable security claims. **VERIFY WITH CA/LEGAL.**

**High**
- H1. Terms: Delaware governing law and venue, USD cap. **VERIFY WITH CA/LEGAL.**
- H2. No legal entity, registration or GST details; "Registered office" label; JSON-LD `legalName`.
- H3. Overstated team and customer base ("operators", "Solutions Architecture Team", "named architect", "Meet the team", "Trusted for high-compliance enterprise workloads", "Why back-office teams choose…").
- H4. Calculator → contact submission fails for decimal rates or partial params (server `calc` regex); client/server length mismatch gives a generic error.
- H5. SSR `<main>` is a loading spinner on every route; content hidden until JS runs (see App. C S4 and P1).

**Medium**
- M1. Home ROI example not reproducible; 72% rate unsourced; "typically higher" claim.
- M2. `font-[var(--font-space)]` doesn't apply Space Grotesk (71 places).
- M3. Contrast failures (white/30, white/40, slate-500 small) and sub-12px text despite the "WCAG AAA" claim.
- M4. Tablet (768) gets the mobile layout; no `md` grid steps; very long pages.
- M5. 13+ CTAs to the same generic form; no service pre-selection; mislabelled hero CTAs; no booking link or phone; no acknowledgement email.
- M6. USD/PT/Delaware vs India: audience and localisation mismatch.
- M7. No OG card image (square icon used as large image).
- M8. SoftwareApplication JSON-LD "price 0 USD".
- M9. 502 response leaks debug info (from/to addresses, Resend error body) to the browser (see App. A F-S2).
- M10. Excessive concurrent motion and pulsing indicators; theme tokens defined but unused (palette drift).
- M11. Analytics (Cloudflare RUM observed) not named in the privacy policy.

**Low**
- L1. Duplicate brand in titles (/about, /privacy, /terms).
- L2. Personal Facebook/Instagram links for the founder on a B2B site.
- L3. Social buttons are text monograms, not icons.
- L4. Contact band copy "the audit inbox above"; "secure URL parameters" wording.
- L5. Heading-level skips (H3 without H2 on home ROI/CTA).
- L6. 404 and error pages lack helpful links.
- L7. Sitemap `lastModified` is always "now".
- L8. Favicon detail at 16px; 8px logo caption.
- L9. Card watermark numerals clipped at 768px.
- L10. `AmbientLight` overlay sits above content (z-1).

**Info**
- I1. Dead code: `particle-canvas.tsx`, `ui/button.tsx`, `EMAIL_DIRECTORY` and 4 unused mailboxes; stale `app/icon-512.png`.
- I2. README font note outdated (fonts are self-hosted on live).
- I3. Live build hashes differ from the local `dist/`; confirm the source revision.
- I4. Dark-only theme (intentional).

---

## D. Open questions for the owner

1. What is the **legal form** of TecHaust Technologies (proprietorship / partnership / LLP / Pvt Ltd)? CIN or LLPIN, GSTIN, Udyam? Is the Balurghat address a *registered* office?
2. Is there any **US entity** that justifies Delaware law and USD pricing? Who is the target market: Indian SMB/enterprise, US/EU, or both?
3. Are **any** of the products in production with paying or pilot clients? Is "Platform v2.4" real? Which metrics (2,847 docs, 1,847 invoices, 258 threats, 4.2s, 99.2%) come from real deployments, if any?
4. How many people work at TecHaust today? Is there a "Solutions Architecture Team"? Who answers enquiries within "4 business hours" (and in which timezone: PT or IST)?
5. Can you share any **client names, logos, testimonials or case studies** (even anonymised) that may be published?
6. Which **mail host** receives contact@techaust.com (Google Workspace, Zoho, Cloudflare Email Routing)? **Answered in part:** DNS shows Zoho (App. C H4). Is Resend's data retention acceptable? Who is the **Grievance Officer** under DPDP? (Answered later: Rupak Sarkar, [04 §0](../04-prd.md).)
7. Is any **analytics** installed besides Cloudflare Web Analytics/RUM? Any cookies set?
8. Do you actually offer **on-prem / VPC** deployment, a **14-day audit**, an **NDA**, and an "Executive Assurance Pack"? What does the "audit" deliverable contain, and is it free?
9. Should the founder's personal Facebook/Instagram be on the corporate site? Can you provide a professional headshot and short bio (background, credentials)?
10. Is the X account @techaustsocial live? (**Answered:** it does not exist; App. C S1 control-tested it. LinkedIn, Facebook and Instagram remain unverified, App. C §5.)
11. Do you want sales@ / support@ / billing@ shown publicly, and is a phone or WhatsApp number available?
12. Is the ASSETS\WEBSITE folder the exact source of the current production deploy (the bundle hashes differ from the local `dist/`)?
13. Pricing: do you want indicative pricing or engagement models (fixed-scope pilot, monthly retainer) on the site?
