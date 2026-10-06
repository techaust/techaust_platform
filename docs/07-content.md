# 07: Content: final copy and asset list

| | |
|---|---|
| **Phase** | 4, Project documentation (**APPROVED** 2026-10-06) |
| **Date** | 2026-10-06 |
| **Inputs** | [02](02-services-strategy.md) positioning, portfolio and prices · [04 PRD](04-prd.md) · [06 design system](06-design-system.md) · legal research [08-B](08-research-appendix/B-dpdp-legal.md) |
| **Legal page drafts** | [07-A Legal pages](07-content-appendix/A-legal-pages.md) (privacy, terms, refund, delivery, cookies, security, accessibility). VERIFY WITH CA/LEGAL. |

**How to read this document**
- Copy here is **final draft** wording. In Phase 6 it moves into Markdown files under `apps/web/src/content/`. Small edits for layout fit may happen; changes of meaning come back to you.
- `{{price:S5}}` = the "from" price, read at build time from the catalogue snapshot. It renders as **"from ₹3,00,000 + GST"** (India) or **"from $12,000"** (international). See [04 WEB-G-06/07](04-prd.md).
- `{{price-plain:S5}}` = the amount alone, with no "from" and no "+ GST" (used in meta descriptions and running text).
- `{{price:S16-growth}}` = the form `{{price:Sx-<line>}}`: it reads the named default line of that catalogue entry (e.g. `S16-growth`, `S11-monthly`) instead of the entry's headline price.
- `{{terms:small_job_threshold}}` = a published payment-terms setting, rendered from the snapshot (e.g. "about ₹1,00,000"; owner decision 2026-10-07).
- `{{schedule:S5}}` = the payment-schedule text from the catalogue (e.g. "40 % on acceptance · 30 % at the midpoint milestone · 30 % on delivery").
- 🟧 **OWNER** = something only you can provide or confirm. All of these are listed in §9.
- Every page has a meta title (≤ 60 characters) and a description (≤ 155).

---

## 1. Voice, style and honesty rules

### 1.1 Voice
- **Senior, calm, specific.** Short sentences. Concrete nouns (Tally, GSTR-2B, purchase orders) over abstractions ("digital transformation").
- **"We"** for TecHaust, **"you"** for the reader. No "leverage", "synergy", "cutting-edge", "next-gen", "revolutionary", "seamless", "robust", "world-class" (style guidance, not linted).
- **Outcomes, then method.** "Your team stops retyping invoices into Tally" comes before "we use document AI".
- **India + global:** INR in the lakh format (₹3,00,000) for India, USD for international. Times in IST, with the reader's local time where it helps.
- **English (India/UK spelling):** organisation, optimise, colour, programme (but "program" for software).

### 1.2 Honesty rules (audit C-1, C-2, H-3; [08-B §14](08-research-appendix/B-dpdp-legal.md))
1. No metric without evidence on file (the claims register, §1.4).
2. No absolute promises about **outcomes**: no "100 %", "guarantee", "zero errors", "no hallucinations". Write "paid in full upfront" in place of "100 % upfront". "We never…" about our own process (§4.5 FAQs, §5.5 item 7) is allowed when it is true and written into the terms.
3. Demos and diagrams are labelled **"Illustrative example"**.
4. No invented people, clients, logos, reviews or "trusted by" lines.
5. No false urgency or scarcity (no countdowns, no "only 2 slots left").
6. Prices always say **"+ GST"** next to INR figures, and "from" prices must be real prices for the stated minimum scope.
7. AI claims are phrased as "designed to", "helps reduce", "in our pilots we measure…".

### 1.3 Banned-phrase list (CI content lint, [04 WEB-G-14](04-prd.md))
`100%` · `guarantee(d)` (except "warranty" as defined in the terms) · `no hallucinations` · `zero errors` / `zero manual` · `ironclad` · `bulletproof` · `military-grade` · `LIVE` (as a badge) · `real-time` (unless true and explained) · `trusted by` · `industry-leading` · `#1` · `best-in-class` · `world-class` · `fully compliant` · `certified` (unless a certificate exists) · `next-gen` · `revolutionary` · `cutting-edge` · `limited slots` · `act now`. Exceptions are allow-listed in the file with a comment.

### 1.4 Claims register (facts the site states, with their source)

| Claim on site | Source | Status |
|---|---|---|
| "A small senior team with 10+ years' experience" | Owner interview, 02 §1 | 🟧 OWNER confirms before launch |
| "20+ projects delivered (web apps, AI and automation, mobile, websites)" | Owner interview, 02 §1 | 🟧 OWNER confirms |
| "Experience with Tally integration and GST e-invoice / GSP APIs" | Owner, 03 §0 | Confirmed (03 §0) |
| "React Native/Expo and Flutter" | Owner, 03 §0 | Confirmed |
| "Based in Balurghat, West Bengal, India" | Owner | Confirmed |
| "We reply within one business day (Mon–Sat, 10:00–19:00 IST)" | Owner, Phase 4 | Confirmed |
| Care-plan response times (business hours) | Owner, Phase 4 | Confirmed |
| Case-study metrics | Case-study briefs (§6) | 🟧 OWNER per study |
| "IP transferred to you on full payment" | Proposal terms | Confirmed in the terms block |
| "30-day warranty after launch" | 02 §4 S5 | 🟧 OWNER confirms the warranty length and scope |
| "Discovery Sprint fee credited if you proceed within 60 days" | 02 §4 S1 | Confirmed (owner approved in Phase 2) |

---

## 2. Global elements

### 2.1 Header
- **Nav:** Services ▾ · Industries ▾ · Pricing · Work · About · Contact
- **Services menu** (grouped):
  - **Advise:** Discovery Sprint · App Rescue & Audit · Fractional CTO
  - **Build:** Custom Web Apps & Portals · MVP & SaaS Development · Mobile Apps
  - **Automate:** AI Document Automation · Workflow Automation & AI Agents · WhatsApp Automation · AI Knowledge Assistants · AI Features for Your Software
  - **Connect:** Business Systems Integration
  - **Run:** Care Plans · Dev Subscription
  - Footer link of the menu: "All services →"
- **Industries menu:** Finance, Accounting & Legal · Retail, E-commerce & Logistics · SaaS & Startups
- **Header CTA:** "Book a Discovery Sprint"
- **Toggles:** "₹ / $" (accessible name: "Show prices in"), theme (accessible name: "Theme: system/light/dark")

### 2.2 Footer
- **Brand line:** "TecHaust Technologies is a senior software and AI automation studio in India. We build the software your business runs on, and automate the paperwork around it."
- **Columns:**
  - **Services** (the 6 headline services + "All services")
  - **Industries** (3)
  - **Company:** About · How we work · How we build AI · Work · Blog · Pricing
  - **Help:** Contact · Get a quote · Security · Cookie settings
- **Contact block:** contact@techaust.com · WhatsApp {{whatsapp}} (Mon–Sat, 10:00–19:00 IST) · Balurghat, West Bengal, India
- **Social:** LinkedIn (company) 🟧 OWNER URL · Founder on LinkedIn 🟧 OWNER URL
- **Legal row:** © {{year}} TecHaust Technologies · Privacy · Terms · Refunds & cancellations · Delivery policy · Cookies · Accessibility

### 2.3 Standard CTA labels (use exactly these; audit M-9)

| Intent | Label | Target |
|---|---|---|
| Entry offer | **Book a Discovery Sprint** | `/get-a-quote?service=S1` |
| Build quote | **Get a quote** | `/get-a-quote?service=<code>` |
| AI pilot | **Start a pilot** | `/get-a-quote?service=<code>&type=pilot` |
| Audit | **Book an audit** | `/get-a-quote?service=S2` |
| Conversation | **Talk to us** | `/contact` |
| Pricing | **See pricing** | `/pricing` |
| Plan | **Choose a plan** | `/get-a-quote?service=S16&plan=<tier>` |

### 2.4 Shared snippets
- **GST note (INR):** "Prices exclude GST (18 %)." (VERIFY WITH CA)
- **USD note:** "International projects are invoiced from India in USD as an export of services."
- **Fee note:** "No card or gateway surcharges: the price you see is the price you pay (plus GST in India)."
- **Response promise:** "We reply within one business day (Mon–Sat, 10:00–19:00 IST)."
- **Illustrative label:** "Illustrative example. Not a real client system."

---

## 3. Home (`/`)

**Meta title:** "TecHaust Technologies: Software and AI automation studio" (56)
**Meta description:** "Senior engineers who build custom software and automate back-office paperwork: Tally, Zoho, GST, WhatsApp. Fixed prices, India and international." (145)

**Hero**
- Eyebrow: "Software & AI automation studio · India"
- **H1:** "Build it right. Automate the rest."
- Lede: "We're a small senior team that builds the custom software your business runs on, and automates the paperwork around it: invoices into Tally, orders from WhatsApp, reports that write themselves. Fixed prices, written scope, and support after launch."
- CTAs: **Book a Discovery Sprint** · See pricing
- Small print under the CTAs: "Discovery Sprint {{price:S1}}, credited to your build if you go ahead within 60 days."

**Who we help** (two columns)
- **In India:** "Finance-heavy SMBs, CA, accounting and legal firms, distributors and online sellers running on Tally, Zoho, WhatsApp and spreadsheets. We connect those systems and automate the manual work between them."
- **Internationally:** "Founders, SaaS teams and growing businesses that need a senior product team, or AI added to the tools they already use, at Indian rates with overlap in your working hours."

**What we do** (6 cards; each shows a "from" price)

| Card | One-liner |
|---|---|
| Custom Web Apps & Portals | "Internal tools, client and dealer portals, and the Excel sheet your business secretly runs on, rebuilt as a proper web app." |
| AI Document Automation | "Invoices, purchase orders and contracts read, checked and posted to Tally, Zoho, QuickBooks or Xero, with a person reviewing exceptions." |
| Workflow Automation & AI Agents | "Hand off the repetitive steps between email, sheets, CRM and accounting, with monitoring so nothing fails silently." |
| Business Systems Integration | "Tally ↔ Zoho, GST e-invoicing and e-way bills, Shopify, payments: connected, monitored and documented." |
| MVP & SaaS Development | "A production-grade first version in 6–10 weeks, with staging from day one and the code handed over to you." |
| Discovery Sprint | "Not sure where to start? In 1–2 weeks we map the work and give you a costed plan and a fixed quote." |

Link: "All services →"

**How we work** (4 steps)
1. **Discover.** "A paid Discovery Sprint, or a free first call for smaller jobs. We learn how the work is done today and what 'better' means in numbers."
2. **Plan and price.** "A written proposal: scope, deliverables, timeline, a fixed price and a payment schedule. No surprises later."
3. **Build in the open.** "Staging from the first week, regular demos, and you can see progress at any time."
4. **Launch and look after it.** "We launch, fix anything we got wrong under warranty, and keep it healthy on a care plan."

Link: "How we work →"

**Care Plans teaser**
- H2: "Software needs looking after. We do that too."
- Text: "Monitoring, security patches, backups, small changes and a named response time, from {{price:S16-essential}} a month."
- CTA: "Compare care plans"

**Pricing anchors**
- H2: "Real prices, published"
- 3 tiles: Discovery Sprint {{price:S1}} · Workflow automation {{price:S10}} per workflow · Custom web app {{price:S5}}
- Text: "Every project gets a written fixed quote. These are honest starting points, not bait."
- CTA: "See all pricing"

**Proof**
- If case studies exist: H2 "Recent work" + 2–3 case-study cards ("Anonymised at the client's request").
- If none: H2 "Recent work" + "We're writing up our first public case studies with our clients' permission. In the meantime, ask us for a sample deliverable (a discovery report or an architecture document) on a call." CTA: Talk to us

**FAQ** (5)
1. **What does a project with you usually cost?** "Most automation work starts from {{price:S10}} per workflow, and custom web apps from {{price:S5}}. After a short call or a Discovery Sprint you get a fixed quote in writing."
2. **Do you work with clients outside India?** "Yes. We invoice in USD and keep 3–4 hours of overlap with UK and European working days, and with US mornings by arrangement."
3. **Who will actually do the work?** "Senior engineers with 10+ years' experience, and the founder reviews every project. We don't hand your project to a junior bench."
4. **Who owns the code?** "You do. Intellectual property transfers to you on full payment, and you get the repository, documentation and access."
5. **What happens after launch?** "A 30-day warranty for defects, then an optional care plan for monitoring, updates and small changes."

**Final CTA band**
- H2: "Tell us what slows your team down."
- Text: "We'll reply within one business day with next steps, and an honest view of whether we're the right fit."
- CTA: Book a Discovery Sprint · secondary "Chat on WhatsApp"

---

## 4. Service pages

Every page follows the template in [04 §3.2](04-prd.md): hero → problem → what you get → how it works → pricing & engagement → tech → proof → FAQs → related → CTA. Below is the copy per page. "Proof" follows WEB-SVC-03 (a case study if available, otherwise a sample, otherwise omitted).

### 4.1 Discovery Sprint (S1) · `/services/discovery-sprint`
- **Meta:** "Discovery Sprint: a fixed price before you build | TecHaust" · "A 1–2 week paid sprint: workflow map, ROI-ranked roadmap or product blueprint, and a fixed quote. Fee credited to your build."
- **H1:** "Know exactly what to build, and what it will cost, before you commit."
- **Who it's for:** owners, finance and operations heads, and founders who know something must change but not yet what, or how much.
- **Problem:** "Big software and AI projects fail in the first week, not the last: unclear goals, messy data, and a quote that was a guess. A short, paid discovery removes the guesswork for both of us."
- **Two flavours** (side by side):
  - **Automation Audit:** "We map how documents and data move through your team today, check whether the data is ready for automation, and rank opportunities by effort and return. Includes risk and data-protection notes."
  - **Product Blueprint:** "We turn your idea into scope, architecture and a clickable prototype that users can try, with a fixed quote for the first release."
- **What you get:** findings report · prioritised roadmap with estimated savings (your numbers, our method) · architecture sketch or clickable prototype · a fixed-price proposal for phase 1 · a 60-minute walkthrough call.
- **How it works:** (1) Kick-off call (60 min) → (2) interviews and data samples (week 1) → (3) analysis and prototype (week 1–2) → (4) walkthrough and proposal. **What we need from you:** 2–4 hours of your team's time and sample documents or data (we sign an NDA first if you like).
- **Pricing:** {{price:S1}} · fixed · paid in full upfront · "**Credited in full against your build** if you go ahead within 60 days."
- **FAQs:**
  - "Is the sprint worth it for a small project?" → "For small, well-defined jobs, we usually skip it and quote after a call."
  - "What if you recommend not building anything?" → "Then we say so. Sometimes the answer is a setting in Zoho or a better spreadsheet."
  - "Can the sprint be remote?" → "Yes, fully. On-site visits in India can be arranged at cost."
  - "Do you sign NDAs?" → "Yes, before you share any data."
- **CTA:** Book a Discovery Sprint

### 4.2 Custom Web Apps & Business Portals (S5) · `/services/custom-web-apps`
- **Meta:** "Custom web apps and business portals | TecHaust" · "Internal tools, client and dealer portals, and Excel or Access processes rebuilt as secure web apps. Fixed price, from {{price-plain:S5}}."
- **H1:** "The software your business actually runs on, built properly."
- **Who it's for:** operations, finance and sales teams outgrowing spreadsheets and email threads; companies replacing per-seat SaaS that doesn't fit.
- **Problem:** "Most businesses run on a patchwork: a shared Excel file, a WhatsApp group and a SaaS tool that does 60 % of the job. It works until it doesn't. Then nobody knows which version is right."
- **What you get:** discovery and UX design (S8 included) · a web app with roles and permissions · integrations with your existing tools · automated tests · staging and production environments · documentation and handover · a 30-day warranty · an optional care plan.
- **Sub-section "From Excel or Access to a real app":** "We keep what works about your spreadsheet (the speed, the familiarity) and add what it lacks: one source of truth, permissions, an audit trail, and nobody overwriting anyone else's work."
- **How it works:** Discover (1–2 weeks) → Design (1–2 weeks) → Build in milestones with fortnightly demos → Launch → Warranty → Care plan. Typical timeline: 6–14 weeks.
- **Pricing:** {{price:S5}} · fixed per milestone · {{schedule:S5}} · change requests quoted before work.
- **Tech:** "Modern web stack (TypeScript, React, cloud hosting in India or abroad), chosen per project and documented."
- **FAQs:** "Can it work on phones?" (yes, responsive; native apps via S7) · "Where is it hosted?" (your cloud account or ours on a care plan; India regions available) · "Can you take over an existing app?" (yes, via App Rescue) · "Who owns it?" (you, on full payment).
- **CTA:** Get a quote

### 4.3 MVP & SaaS Product Development (S6) · `/services/mvp-saas-development`
- **Meta:** "MVP and SaaS development with a senior team | TecHaust" · "A production-grade MVP in 6–10 weeks: design, web app, auth, payments, admin and analytics. Staging from day one; IP transferred on payment."
- **H1:** "A first version you won't have to throw away."
- **Who it's for:** seed and pre-seed founders, and innovation teams inside larger companies.
- **Problem:** "AI tools make prototypes cheap. Making them reliable, secure and maintainable is still the hard part, and that's the part investors and first customers notice."
- **What you get:** product scoping and a design-system starter · a web app (and mobile if needed) · auth, payments, admin and analytics · staging from day one · weekly demos · launch support · code, docs and IP handed over · an optional care plan or dev subscription afterwards.
- **How it works:** Blueprint (week 0–1) → 2-week sprints with demos → launch → stabilise.
- **Time zones:** "We overlap 3–4 hours with UK and European working days, and with US East-coast mornings by arrangement. Written updates every week."
- **Pricing:** {{price:S6}} · fixed, sprint-based · {{schedule:S6}}.
- **FAQs:** "Can you work with our in-house developer?" · "What if scope changes mid-sprint?" (re-prioritise within the sprint or quote a change) · "Do you take equity?" ("No. We work for fees, so incentives stay simple.") · "Will you sign our contract?" ("Usually yes, after a review; we have a standard MSA too.")
- **CTA:** Get a quote

### 4.4 Mobile Apps (S7) · `/services/mobile-apps`
- **Meta:** "Cross-platform mobile apps: React Native, Flutter | TecHaust" · "iOS and Android apps built with React Native/Expo or Flutter, usually alongside a web app or portal. Fixed price, from {{price-plain:S7}}."
- **H1:** "Mobile apps that share a backbone with your web system."
- **Problem:** "A mobile app on its own is rarely the point. It's the field team's order form, the customer's tracking screen, the dealer's catalogue. It has to talk to everything else."
- **What you get:** UX for small screens · a cross-platform app (React Native/Expo or Flutter, chosen per project) · API and back-end integration · store submission support · crash and analytics monitoring.
- **Pricing:** {{price:S7}} · fixed · {{schedule:S7}}.
- **FAQs:** "React Native or Flutter?" → "Whichever fits your team and existing code; we use both." · "Do you publish to the stores?" → "We prepare and submit under your developer accounts."
- **CTA:** Get a quote

### 4.5 AI Document Automation (S9) · `/services/ai-document-automation`
- **Meta:** "AI document automation: invoices, POs, contracts | TecHaust" · "Extract, check and post invoices, purchase orders and KYC files into Tally, Zoho, QuickBooks or Xero, with human review. Pilot from {{price-plain:S9}}."
- **H1:** "Stop retyping invoices. Keep control of every entry."
- **Who it's for:** CA and accounting firms, finance teams in SMBs, NBFCs, logistics companies and online sellers.
- **Problem:** "Somewhere in your office, skilled people copy numbers from PDFs into Tally all day. It's slow, it's error-prone, and it's the first job they'd happily give up."
- **What we build:** "A pipeline that reads documents (emailed PDFs, scans, photos), extracts the fields you need, checks them against rules and your records (purchase orders, GSTR-2B, vendor masters), and posts clean entries to your accounting system. Anything uncertain goes to a review screen for a person to approve."
- **Typical uses:** vendor invoices → Tally vouchers · PO ↔ invoice ↔ GSTR-2B matching · delivery proofs and freight invoices · KYC document checks · contract clause extraction.
- **Diagram:** "Inbox → extract → validate → review queue → Tally/Zoho → audit log" (Illustrative example).
- **How it works:**
  1. **Pilot (about 4 weeks):** one document type, your real samples, a baseline (e.g. minutes per invoice today) and a test set we measure against.
  2. **Production rollout:** integrations, monitoring, guardrails, training.
  3. **AI Ops:** monthly monitoring and tuning (S17).
- **Honest note:** "Accuracy depends on your documents. In the pilot we measure it on your own samples and agree the target with you before rollout. We don't promise a number we haven't measured."
- **Pricing:** Pilot {{price:S9}} · production rollout quoted after the pilot · optional per-document pricing with a monthly minimum.
- **FAQs:** "Does our data leave India?" ("It can stay in India-region services where needed; we document every system that touches it.") · "Which AI models do you use?" ("Chosen per project for accuracy, cost and data-handling terms; we never let providers train on your data where an opt-out exists.") · "What about handwritten or poor scans?" · "Do you work with Tally Prime?" ("Yes, via Tally's XML/ODBC interfaces or connectors.") 🟧 OWNER confirms
- **CTA:** Start a pilot

### 4.6 Workflow Automation & AI Agents (S10) · `/services/workflow-automation`
- **Meta:** "Workflow automation and AI agents | TecHaust" · "Automations across email, sheets, CRM and accounting with n8n, Make or custom code, monitored and documented. From {{price-plain:S10}} per workflow."
- **H1:** "Hand off the repetitive work, without losing sight of it."
- **Problem:** "Copying leads from email to the CRM, chasing payments, building the Monday report: small jobs that eat hours, and break quietly when someone changes a column."
- **What you get:** a workflow map · built and tested automations (n8n, Make or custom code) · narrow AI agents where they help (lead qualification, collection follow-ups, order-status replies, report drafting) · error alerts · a run-book · optional monitoring on a care plan.
- **Quick-Win bundle:** "3–5 small automations delivered together: the fastest way to see what automation can do for you."
- **Pricing:** {{price:S10}} per workflow · Quick-Win bundles quoted · monthly retainer for monitoring and new workflows.
- **FAQs:** "n8n, Make or custom?" · "Who owns the accounts?" ("You do; we build in your workspace.") · "What happens when an API changes?" ("Alerts tell us; on a care plan we fix it.")
- **CTA:** Automate a workflow

### 4.7 WhatsApp Business Automation (S11) · `/services/whatsapp-automation`
- **Meta:** "WhatsApp automation for orders and payments | TecHaust" · "Order updates, payment reminders, catalogue ordering and support handover on the WhatsApp Business Platform, connected to your systems."
- **H1:** "Meet customers on WhatsApp, with your systems behind it."
- **Problem:** "Your customers already message you on WhatsApp. Answering by hand doesn't scale, and order details end up trapped in chats."
- **What you get:** WhatsApp Business Platform setup through an official provider · flows for order updates, payment links and reminders, catalogue ordering, COD confirmation and returns · handover to a person · integration with your order, billing or CRM system · reporting.
- **Pricing:** setup {{price:S11-setup}} + management {{price:S11-monthly}}/month · "**Meta's per-message charges are passed through at cost.**" 🟧 OWNER: a USD price for the Gulf/international market? (Currently INR only.)
- **FAQs:** "Do we need a new number?" · "Can a person take over a chat?" (yes) · "What does Meta charge?" ("Per message, by category and country; we show you the current rates before you start.")
- **CTA:** Get a quote

### 4.8 AI Knowledge Assistants (S12) · `/services/ai-knowledge-assistants`
- **Meta:** "Private AI knowledge assistants with citations | TecHaust" · "Search and answers over your own documents, with access control, source citations and a quality test set. Pilot from {{price-plain:S12}}."
- **H1:** "Answers from your own documents, with the source one click away."
- **Who it's for:** legal, CA and consulting firms; support teams; companies with large policy and SOP libraries.
- **Problem:** "The answer is somewhere in 4,000 PDFs and three shared drives. General chatbots don't know your documents, and you can't let them see everything."
- **What makes ours different:** access control (people only see what they're allowed to) · citations on every answer · a quality test set we run before and after changes · India-hosted or on-premises options where needed · honest "I don't know" behaviour when the sources don't cover a question.
- **Honest note:** "No AI system is right every time. We design for traceability: every answer shows its sources, and we measure quality on your own questions."
- **Pricing:** pilot {{price:S12}} → production → AI Ops · model and API usage passed through at cost.
- **CTA:** Start a pilot

### 4.9 AI Features for Your Software (S13) · `/services/ai-features-for-software`
- **Meta:** "Add AI features, MCP servers and agent-ready APIs | TecHaust" · "Smart search, summaries, copilots and document understanding in your product, plus MCP servers so AI assistants can use it. From {{price-plain:S13}}."
- **H1:** "Add useful AI to the product you already have."
- **What you get:** feature discovery (where AI actually helps your users) · implementation (search, summarisation, extraction, copilots) · **MCP servers and agent-ready APIs** so your product works inside ChatGPT, Claude and Copilot · evaluation and cost controls · documentation.
- **Pricing:** {{price:S13}} · fixed.
- **CTA:** Get a quote

### 4.10 Business Systems Integration (S14, + S15) · `/services/business-systems-integration`
- **Meta:** "Tally, Zoho, GST e-invoice, Shopify integration | TecHaust" · "Connectors between Tally, Zoho, GST e-invoicing and e-way bills, Shopify, QuickBooks, Xero and payments, monitored and documented."
- **H1:** "Make your systems talk to each other, reliably."
- **Problem:** "Sales are in Shopify, accounts in Tally, invoices in Zoho, and someone re-enters everything at month end. Every copy is a chance for a mistake."
- **What you get:** connectors (Tally ↔ Zoho, GST e-invoicing and e-way bills via a GST Suvidha Provider, Shopify ↔ ERP, CRM ↔ accounting, QuickBooks, Xero, HubSpot, Stripe) · sync monitoring and error alerts · documentation · a care plan.
- **Section "Payments & billing" (S15):** "Razorpay, Cashfree or Stripe; UPI AutoPay and subscriptions; payment links, webhooks and reconciliation, from {{price:S15}}."
- **Pricing:** {{price:S14}} per connector.
- **FAQs:** "Do you need our Tally licence?" · "Is GST e-invoicing mandatory for us?" ("It depends on your turnover; your CA confirms it. We build the integration either way.") · "What if Tally is on a local PC?"
- **CTA:** Get a quote

### 4.11 App Rescue & Production-Readiness Audit (S2) · `/services/app-rescue`
- **Meta:** "App rescue and production-readiness audit | TecHaust" · "A senior review of apps built fast (AI-generated, freelancer or legacy), then a fixed-price hardening plan. Audit from {{price-plain:S2}}."
- **H1:** "Your app works in the demo. Let's make it work in production."
- **Problem:** "Apps built quickly, by AI tools, freelancers or a past team, often hide the same problems: weak security, no tests, fragile deployments, and nobody who understands all of it."
- **What you get:** a code, security and performance review · a risk-ranked fix list · an optional fixed-price hardening sprint · handover to a care plan.
- **Scope note:** "This is an engineering review, not a formal penetration test. If you need one, we'll recommend a specialist."
- **Pricing:** audit {{price:S2}} · hardening sprint quoted from the findings.
- **CTA:** Book an audit

### 4.12 DPDP Readiness for Apps (S3) · `/services/dpdp-readiness` · **feature-flagged OFF**
- **Banner:** "We implement the technical side of DPDP compliance. Legal interpretation comes from your lawyer or our legal partner."
- Full copy is written when a legal partner is confirmed (🟧 OWNER).

### 4.13 Fractional CTO (S4) · `/services/fractional-cto`
- **Meta:** "Fractional CTO for startups and SMBs | TecHaust" · "Part-time senior technical leadership: architecture, hiring help, vendor reviews and roadmap, led by our founder. From {{price-plain:S4}} a month."
- **H1:** "Senior technical judgement, without a full-time CTO."
- **Who it's for:** non-technical founders, SMB owners managing in-house or outsourced developers, and startups between technical leaders.
- **What you get:** a fixed number of hours each month · architecture and build-vs-buy decisions · vendor and code-quality reviews · hiring help (job specs, interviews) · a roadmap and a monthly written report. **Led personally by our founder.**
- **Pricing:** {{price:S4}} per month · monthly retainer · 30 days' notice to stop.
- **CTA:** Talk to us

### 4.14 Care Plans (S16 + S17) · `/services/care-plans`
- **Meta:** "Website and app care plans, clear response times | TecHaust" · "Monitoring, security patches, backups, small changes and business-hours response times. Essential, Growth and Scale plans from {{price-plain:S16-essential}} a month."
- **H1:** "Keep your software healthy, with a named response time."
- **Intro:** "Software that isn't maintained slowly breaks: expiring certificates, outdated libraries, a backup nobody tested. A care plan makes someone responsible."

**Comparison table** (prices from the catalogue)

| | Essential | Growth | Scale |
|---|---|---|---|
| Price | {{price:S16-essential}}/mo | {{price:S16-growth}}/mo | {{price:S16-scale}}/mo |
| Hosting management, uptime and error monitoring | ✓ | ✓ | ✓ |
| Security and dependency updates | ✓ | ✓ | ✓ |
| Daily backups (restore-tested quarterly) | ✓ | ✓ | ✓ |
| Monthly report | ✓ | ✓ | ✓ |
| Development hours included | 2 h | 8–10 h | 25–40 h |
| Performance and technical SEO checks | — | ✓ | ✓ |
| Quarterly roadmap call | — | ✓ | ✓ |
| DevOps / CI and security review | — | — | ✓ |
| Fractional-CTO advisory | — | — | ✓ |
| **Response time** (business hours, Mon–Sat 10:00–19:00 IST) | **2 business days** | **1 business day** | **4 business hours** for critical issues |

- **Rules (small print):** "Essential: no rollover. Growth and Scale: unused hours roll over for one month. Extra hours are billed at the plan rate. Pay annually and save 10 %. Out-of-hours cover can be quoted separately. Billed monthly in advance; cancel with 30 days' notice." (10 % confirmed by the owner, 2026-10-07.)
- **AI Ops add-on (S17):** "For AI systems in production: monitoring, test-set reruns, prompt and model updates, and cost tracking, from {{price:S17}} a month."
- **CTA:** Choose a plan

### 4.15 Dev Subscription (S18) · `/services/dev-subscription`
- **Meta:** "Senior developer subscription, monthly | TecHaust" · "A senior development and design subscription: one active request at a time, an unlimited queue, and pause or cancel monthly. From {{price-plain:S18}} a month."
- **H1:** "A senior development team on a monthly subscription."
- **How it works:** "Add requests to your queue. We work on one at a time, in priority order, and ship each as soon as it's done. Pause or cancel any month."
- **Good for:** SaaS teams and agencies with steady work; not for fixed-deadline projects (use S5/S6).
- **Capacity note:** "We take a small number of subscriptions at a time so quality stays high. If we're full, we'll tell you when the next opening is." (No counters.)
- **Pricing:** {{price:S18}} per month.
- **CTA:** Start a subscription

---

## 5. Other pages

### 5.1 Services hub (`/services`)
- **Meta:** "Services: build, automate, connect and run | TecHaust" · "Custom software, AI document and workflow automation, systems integration and care plans, with fixed prices for India and international clients."
- **H1:** "What we do"
- **Lede:** "Five kinds of work, one team. Most clients start with Advise or Automate and stay with us on a Run plan."
- **Group intros:**
  - **Advise:** "Clarity before code."
  - **Build:** "Software made to last."
  - **Automate:** "Less manual work, more control."
  - **Connect:** "Systems that agree with each other."
  - **Run:** "Looked after, every month."

### 5.2 Industries
**Hub (`/industries`).** **H1:** "Industries we know well". Lede: "We work across sectors, but these three are where our experience runs deepest."

**Finance, Accounting & Legal (`/industries/finance-accounting-legal`)**
- **Meta:** "Automation for CA firms, finance and legal teams | TecHaust" · "Invoice-to-Tally automation, GSTR-2B reconciliation, contract extraction and client portals for finance, accounting and legal teams."
- **H1:** "Less data entry. More time for the work clients pay you for."
- **Use cases:**
  1. Vendor invoices posted to Tally or Zoho with review
  2. GSTR-2B ↔ purchase-register reconciliation
  3. Client document collection portals for CA firms
  4. Contract clause extraction and renewal tracking
  5. WhatsApp client-query assistants
- **Related:** S9, S14, S10, S12, S5
- **FAQ:** "Do you understand GST workflows?" → "We build software for them every day; your CA stays in charge of tax decisions." · "Is client data safe?" → "Access control, audit logs, encryption, and documented data handling. We'll walk your team through it."

**Retail, E-commerce & Logistics (`/industries/retail-ecommerce-logistics`)**
- **Meta:** "Automation for sellers, distributors, logistics | TecHaust" · "WhatsApp commerce, Shopify-to-ERP sync, delivery-proof and freight-invoice extraction, and dealer ordering portals."
- **H1:** "Orders, stock and paperwork that keep up with your sales."
- **Use cases:** WhatsApp ordering and payment reminders · Shopify ↔ Tally/Zoho sync · delivery-proof and freight-invoice extraction · dealer and distributor ordering portals · COD confirmation and returns flows
- **Related:** S11, S14, S9, S5

**SaaS & Startups (`/industries/saas-startups`)**
- **Meta:** "Product engineering and AI for SaaS and founders | TecHaust" · "Production-grade MVPs, AI features, MCP servers, a dev subscription and fractional CTO support for startups and SaaS companies."
- **H1:** "A senior product team when you need one, without hiring one."
- **Use cases:** MVP builds · AI features and MCP servers · rescuing a fast-built prototype · steady capacity via the dev subscription · technical leadership via the fractional CTO
- **Related:** S6, S13, S2, S18, S4

### 5.3 Pricing (`/pricing`)
- **Meta:** "Pricing: published starting prices | TecHaust" · "Starting prices for discovery, custom software, AI automation, integration and care plans. Fixed quotes in writing; INR + GST or USD."
- **H1:** "Pricing"
- **Lede:** "Honest starting prices for each service. Your fixed quote depends on scope, and you'll get it in writing before any work begins."
- **Sections:** the price table grouped by category (from the catalogue) · care-plan tiers (as §4.14)
- **"What affects the price":** number of user roles and screens · integrations and data migration · document variety (for AI) · deadlines · hosting and compliance needs
- **"How payment works":**
  - "**Builds:** 40 % to start, 30 % at a mid-project milestone, 30 % on delivery."
  - "**Smaller fixed jobs** (under {{terms:small_job_threshold}}): paid in full upfront."
  - "**Care plans and subscriptions:** monthly in advance."
  - "**Invoices are due within 7 days.** Proposals are valid for 15 days."
  - "**India:** UPI, cards and netbanking (Razorpay) or bank transfer. **International:** card (Stripe), PayPal or bank transfer (SWIFT)."
  - (GST note and USD note from §2.4)
- **FAQ:**
  - "Why don't you show an hourly rate?" → "Because you're buying an outcome, not hours. Fixed prices put the risk of estimating on us."
  - "Do prices include GST?" → "No. GST at 18 % is added for Indian clients."
  - "Can we pay in instalments?" → "Builds are already paid in stages. Ask if you need a different schedule."

### 5.4 Work (`/work`, `/work/[slug]`)
- **Meta:** "Work: anonymised case studies | TecHaust" · "Case studies from our client projects, anonymised at clients' request: the problem, our approach, the stack and real results."
- **H1:** "Work"
- **Lede:** "Selected projects, anonymised at our clients' request. Every number on these pages was measured on the real project."
- **Empty state:** "Our first public case studies are being written with our clients' permission. Want to see how we work? Ask us for a sample discovery report or architecture document."
- **Detail template:** Context (industry, size, region) · The problem · What we did · Stack · Results (with how they were measured) · What's next · CTA "Similar project? Talk to us"

### 5.5 How we work (`/how-we-work`)
- **Meta:** "How we work: process, pricing rules and ownership | TecHaust" · "Our 4-step process, fixed-price rules, IP transfer, time-zone overlap, communication cadence, AI-use policy and warranty."
- **H1:** "How we work"
- **Sections:**
  1. **The four steps:** as on Home, expanded.
  2. **Engagement models:** fixed price (most projects) · pilot → rollout (AI) · retainer (care plans, fractional CTO) · subscription (dev subscription).
  3. **Fixed-price rules:** "The price covers the written scope. If you want something new, we quote it before doing it, and you decide. We don't bill for our own estimating mistakes."
  4. **Ownership:** "On full payment, the code, designs and documentation are yours. We keep the right to reuse general know-how and our own pre-existing tools, which we list in the proposal."
  5. **Working across time zones:** "We're in India (IST, UTC+5:30). We keep 3–4 hours of overlap with UK and European working days, and with US East-coast mornings by arrangement."
  6. **Communication:** "A weekly written update, a demo every sprint, one shared channel, and a named contact."
  7. **How we use AI tools:** "We use AI coding and writing tools to work faster. A senior engineer reviews everything before it reaches you, and we never paste your confidential data into tools that train on it."
  8. **Warranty:** "Defects in what we delivered are fixed free for 30 days after launch." 🟧 OWNER confirms
  9. **After launch:** care plans.
- **CTA:** Book a Discovery Sprint

### 5.6 How we build AI (`/how-we-build-ai`)
- **Meta:** "How we build AI systems you can trust | TecHaust" · "Production-first AI: test sets, guardrails, human review, careful data handling and honest limits. How we design AI that holds up in real work."
- **H1:** "How we build AI that holds up in real work"
- **Lede:** "Most AI pilots fail not because the model is weak, but because nobody measured, nobody reviewed, and nobody planned for the cases it gets wrong. We design for those cases from day one."
- **Principles:**
  1. **Measure first:** "We agree a baseline and build a test set from your real examples before we write code."
  2. **People stay in control:** "Uncertain results go to a review screen. People approve; the system learns what to escalate."
  3. **Show the source:** "Answers and extracted fields link back to the document they came from."
  4. **Guardrails:** "Input checks, output validation and limits on what an AI step is allowed to do."
  5. **Data handling:** "We use providers whose terms don't train on your data where an opt-out exists, keep data in India where required, and document every system that touches it."
  6. **Privacy by design:** "Collect only what's needed, delete on schedule, and log access, in line with India's DPDP Act." (VERIFY WITH CA/LEGAL)
  7. **Honest limits:** "No AI system is right every time. We tell you where ours is weaker, and we monitor it after launch."
- **CTA:** Start a pilot

### 5.7 About (`/about`)
- **Meta:** "About TecHaust Technologies | Senior software studio, India" · "A small senior software and AI automation studio in Balurghat, West Bengal, working with clients across India and abroad."
- **H1:** "A small senior team, by design"
- **Story (draft, 🟧 OWNER reviews):** "TecHaust Technologies is a software and AI automation studio in Balurghat, West Bengal. We've delivered 20+ projects (business web apps, SaaS products, automations and mobile apps) for clients in India and abroad. We stay deliberately small: a few senior people who build carefully, explain clearly, and look after what they ship."
- **Founder:** headshot 🟧 OWNER · "**Rupak Sarkar**, Founder" · bio 🟧 OWNER (≈ 80–120 words) · LinkedIn link 🟧 OWNER
- **The team:** "Alongside the founder, a small team of senior engineers and designers, each with 10+ years' experience across web, mobile, AI and automation. We bring in trusted specialists, such as security testers and legal partners, when a project needs them." (No names or photos until each person agrees.)
- **What we value:** "Say what we'll do, then do it" · "Fixed prices, written scope" · "Senior people on every project" · "Honest numbers" · "Look after what we build"
- **Where we are:** "Balurghat, West Bengal, India. We work remotely with clients everywhere, and visit in India when it helps."
- **CTA:** Talk to us

### 5.8 Contact (`/contact`)
- **Meta:** "Contact TecHaust Technologies" · "Email, WhatsApp or send a message. We reply within one business day (Mon–Sat, 10:00–19:00 IST)."
- **H1:** "Talk to us"
- **Lede:** "Tell us a little about what you need. We reply within one business day (Mon–Sat, 10:00–19:00 IST)."
- **Form labels:** Your name · Work email · Company (optional) · Phone or WhatsApp (optional) · How can we help? (hint: "A few sentences is plenty.") · Submit: "Send message"
- **Side panel:**
  - Email contact@techaust.com
  - WhatsApp {{whatsapp}} ("Chat on WhatsApp")
  - "Prefer a call? Book a time" → Cal.com 🟧 OWNER URL
  - Address: **{{postal_address}}** 🟧 OWNER provides the exact postal address for this page and the legal pages
- **Consent notice** (beside submit): "We use these details only to reply to your enquiry and, if you go ahead, to prepare a proposal. See our [privacy notice](/privacy). You can ask us to delete them at any time." Optional checkbox (unticked): "Also send me occasional updates (about one email a month). You can unsubscribe at any time."

### 5.9 Get a quote (`/get-a-quote`)
- **Meta:** "Get a quote or book a Discovery Sprint | TecHaust" · "Tell us about your project in four short steps. We reply within one business day with next steps and an honest view of fit."
- **H1:** "Tell us about your project"
- **Step 1, "What do you need?":** service radio cards (grouped), plus "Not sure: recommend something". Hint: "Pick the closest. We'll refine it together."
- **Step 2, "What should it achieve?":** "What would you like to achieve?" (textarea; hint: "e.g. 'Stop retyping 400 invoices a month into Tally'") · "Which tools do you use today?" (Tally, Zoho, Excel/Sheets, QuickBooks, Xero, Shopify, WhatsApp Business, Other)
- **Step 3, "Budget and timing":** budget bands (INR or USD by the currency toggle; [04 FRM-QUOTE](04-prd.md)) with a hint: "This helps us suggest the right approach. It isn't a commitment." · timeline (As soon as possible · 1–3 months · 3–6 months · Just exploring)
- **Step 4, "Your details":** name · work email · company · country · phone/WhatsApp (optional) · "Best time for a call" (IST + "your time: {{local}}") · consent notice and optional updates checkbox (as §5.8) · Submit: "Send request"
- **Errors** (examples): "Enter your name" · "Enter an email address like name@company.com" · "Tell us a little more: at least 20 characters" · "Please choose a service, or 'Not sure'"

### 5.10 Thanks (`/thanks`)
- **H1:** "Thanks, we've got it."
- **Text:** "Your reference is **{{ref}}**. We'll reply within one business day (Mon–Sat, 10:00–19:00 IST). If it's urgent, message us on WhatsApp and quote your reference."
- "Want to pick a time now?" → Cal.com link
- "While you wait: [How we work](/how-we-work) · [Pricing](/pricing)"

### 5.11 Security (`/security`)
- **H1:** "Security and responsible disclosure"
- **Copy:** see [07-A §6](07-content-appendix/A-legal-pages.md).

### 5.12 404
- **H1:** "We couldn't find that page"
- **Text:** "It may have moved, or the link may be wrong. Here are some useful places:" · Services · Pricing · Contact · Home

---

## 6. Case-study brief (🟧 OWNER fills one per project; 2–3 wanted)

> Copy this into an email or a file in `brand-incoming/case-studies/` (git-ignored; never committed). Short answers are fine; I'll write the final page and send it back to you for approval.

1. **Client type** (no name needed): industry, size (staff or revenue band), country/state.
2. **May we publish an anonymised version?** Yes / No / Only after the client approves the text.
3. **The problem in their words:** what was slow, costly or risky?
4. **What we built:** main features, integrations, users.
5. **Stack:** languages, frameworks, hosting, AI models or tools.
6. **Timeline and team size.**
7. **Results with numbers**, and how each was measured (e.g. "invoice entry time fell from ~6 min to ~1 min, measured over 2 weeks of logs"). Only numbers you can back up.
8. **A quote from the client?** Only with their written permission; otherwise leave it blank.
9. **What's next** (care plan, phase 2)?
10. **Anything we must not mention.**

---

## 7. Blog: 3 launch articles (I draft in the website milestone, you review)

| # | Working title | Target query (India-first) | Outline | Related service |
|---|---|---|---|---|
| B1 | "Automating invoice entry into Tally: what works in 2026" | tally invoice automation | The manual process and its cost → options (Tally import templates, connectors, AI extraction + review) → what accuracy really means and how to measure it → a pilot plan → the questions to ask a vendor | S9, S14 |
| B2 | "GST e-invoicing API integration, explained for business owners" | gst e-invoice api integration | Who must e-invoice (threshold; "check with your CA") → IRN and QR in plain words → the GSP vs direct API route → integration patterns (ERP, Tally, custom) → common failures and how to monitor → checklist | S14 |
| B3 | "What an automation audit should cover (and what it shouldn't)" | automation audit / workflow audit | Why audits beat jumping into tools → what to map → data readiness → ranking by effort and return → risk and data-protection notes → what a good deliverable looks like | S1, S10 |

**Rules:** no invented statistics. Any market figure is cited to a source dated 2025–26 (from the [02 appendices](02-research-appendix/)). Tax statements say "confirm with your CA". Author: the founder. Each article is ~1,200–1,800 words with a FAQ block.

---

## 8. Email copy (transactional; HTML + plain text, [06 §6](06-design-system.md))

| Template | Subject | Body (core text) |
|---|---|---|
| Lead acknowledgement (from hello@) | "We've received your request ({{ref}})" | "Hi {{first_name}}, thanks for getting in touch about {{service_name}}. We'll reply within one business day (Mon–Sat, 10:00–19:00 IST). If you'd like to pick a call time now: {{cal_link}}. Your reference: {{ref}}. — TecHaust Technologies" |
| Internal lead alert | "New lead {{ref}}: {{service_name}} · {{budget_band}} · {{country}}" | A summary + "Open in admin" |
| Proposal sent | "Proposal: {{proposal_title}} ({{number}} v{{version}})" | "Hi {{first_name}}, your proposal is ready. It covers scope, timeline, price and payment schedule, and it's valid until {{valid_until}}. [Review and accept]. Questions? Just reply to this email." |
| Estimate sent (from hello@) | "Estimate: {{estimate_title}} ({{number}} v{{version}})" | "Hi {{first_name}}, your estimate is ready. It covers the line items, price and payment terms, and it's valid until {{valid_until}}. [Review and accept]. Questions? Just reply to this email." |
| Proposal accepted (both) | "Accepted: {{proposal_title}} ({{number}} v{{version}})" | "Thank you, {{typed_name}}. Your acceptance was recorded on {{accepted_at_ist}}. Links to the accepted proposal and the acceptance certificate are below. Next: {{next_step}}." |
| Proforma (billing@) | "Payment request {{number}}: {{amount}}" | "…for {{description}}. [Pay online] · bank details inside. A tax invoice will be issued when payment is received." |
| Invoice issued | "Invoice {{number}} from TecHaust Technologies: {{amount}} due {{due_date}}" | "Hi {{first_name}}, please find invoice {{number}} for {{amount}}, due on {{due_date}}. [View & pay]. You can pay by {{methods}}." |
| Reminder −3 | "Invoice {{number}} is due on {{due_date}}" | "A friendly reminder that invoice {{number}} ({{balance}}) is due in 3 days. [View & pay]. If you've already paid, thank you, and please ignore this." |
| Reminder 0 | "Invoice {{number}} is due today" | Same tone. |
| Reminder +3 | "Invoice {{number}} is now overdue" | "…was due on {{due_date}} and shows {{balance}} outstanding. If there's a problem with the invoice, reply and we'll sort it out." |
| Reminder +7 | "Second reminder: invoice {{number}}" | Polite and firm; offers a call. |
| Reminder +14 | "Action needed: invoice {{number}} is 14 days overdue" | Firm; names the owner as contact; no threats. |
| Payment received + receipt | "Payment received, thank you ({{receipt_number}})" | "We've received {{amount}} via {{mode}} for {{document_number}}. Remaining balance: {{balance}}. [Download receipt]." |
| Credit note | "Credit note {{number}} for invoice {{invoice_number}}" | Reason + amount + link |
| Debit note | "Debit note {{number}} for invoice {{invoice_number}}" | Reason + amount + link. Plain wording that the invoice amount has been corrected upwards. |
| Approval requested (to the owner) | "Approval needed: {{document_type}} {{number}}" | "{{requester_name}} asks you to approve {{request_reason}} for {{document_number}} ({{amount}}). [Open in admin]. Your decision applies to this version only." |
| Approval decided (to the requester) | "{{decision}}: {{document_type}} {{number}}" | "{{approver_name}} has {{decision}} your request for {{document_number}}. Note: {{decision_note}}. [Open in admin]." |
| Weekly digest (to the owner, Mondays 09:00 IST) | "Your week at TecHaust: {{week_label}}" | "Pipeline, invoiced and collected, overdue invoices, new leads and upcoming reminders. [Open dashboard]." Non-transactional: it carries the "Why you're receiving this" line and a link to switch it off. |
| Magic link (no-reply@) | "Your sign-in link for the TecHaust client portal" | "Use this link to sign in. It works once and expires in 15 minutes: [Sign in]. If you didn't ask for it, you can ignore this email." |
| Staff invite | "You've been invited to TecHaust admin" | Link valid 48 h; mentions the authenticator-app requirement. |
| Login alert | "New sign-in to your TecHaust admin account" | Time (IST), approximate location, device; "Not you? Contact the owner immediately." |
| 2FA changed / lockout | "Security change on your account" / "Your account is temporarily locked" | Plain facts + next steps. |

**Footer (all):** "TecHaust Technologies · Balurghat, West Bengal, India · contact@techaust.com". Non-transactional emails add "Why you're receiving this" + an unsubscribe link.

---

## 9. Asset list and owner inputs

| Asset / input | Used on | Status |
|---|---|---|
| Logo | Everywhere; PDFs; email; favicon | ✅ New identity "Patina" approved 2026-10-06; files in `packages/ui/brand/` ([06 §1](06-design-system.md)). The supplied `TecHaust.ai` logo is retired. |
| Founder headshot (≥ 1200 px, plain background) | About, blog author, OG | 🟧 OWNER (website milestone) |
| Founder bio (80–120 words) + LinkedIn URL | About, blog | 🟧 OWNER |
| TecHaust LinkedIn company page URL | Footer, schema `sameAs` | 🟧 OWNER |
| WhatsApp business number | Contact, footer, thanks | 🟧 OWNER |
| Full postal address (for Contact + legal pages only) | Contact, privacy, terms, refund, delivery | 🟧 OWNER |
| Cal.com booking URL | Contact, thanks, acknowledgement email | 🟧 OWNER (create a free account) |
| 2–3 case-study briefs (§6) | Work, service-page proof, home | 🟧 OWNER |
| Confirmations in the claims register (§1.4): experience, project count, warranty length (annual care-plan discount: 10 %, confirmed 2026-10-07) | Various | 🟧 OWNER |
| USD price for WhatsApp Automation (S11), or INR-only | S11 page, pricing | 🟧 OWNER |
| Email aliases in Zoho: hello@, billing@, privacy@ (or grievance@), security@ | Email, legal pages, security.txt | 🟧 OWNER creates them in Zoho |
| Bank details, GSTIN, legal name, LUT ARN (if filed) | Invoices and documents (admin Settings) | 🟧 OWNER types them into the admin Settings screen (invoice milestone), never in chat or code |
| Gateway sandbox/test keys (Razorpay, Stripe, PayPal) | Payments | 🟧 OWNER sets them as Wrangler secrets (payments milestone); I give the exact commands |
| Diagrams (document pipeline, integration map, process) | S9, S14, How we work | Me (SVG, "Illustrative") |
| OG images | All pages | Me (generated at build) |
| Icons | Everywhere | Lucide (ISC licence) |
| Fonts | Everywhere | Archivo + IBM Plex Mono (OFL), self-hosted |
| Stock photos | — | **None** (by design) |

---

## 10. Status
- [x] **Approved by owner 2026-10-06** (copy edits still welcome)
