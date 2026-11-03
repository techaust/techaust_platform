---
name: techaust-business-profile
description: "TecHaust business facts from the Phase 2 interview (2026-10-06) — team, legal form, GST, markets, capacity, goals"
metadata:
  node_type: memory
  type: project
  originSessionId: c042bbd5-0842-493b-8aa5-10b5bf1749ab
  modified: 2026-11-01T10:45:29.982Z
---

Interview answers (2026-10-06), use for services strategy, site copy and invoicing:
- Sole proprietorship, GST-registered (has GSTIN). Founder Rupak Sarkar, Balurghat, West Bengal.
- Company phone (owner, 2026-11-01): **+91 98830 23931** (registered, on WhatsApp Business), written with that spacing, used everywhere a phone belongs (site WhatsApp + "Phone" line, JSON-LD, card, letterhead, Settings › Company). No live chat/AI auto-reply before launch (13). Task: docs/runs/company-phone.md.
- Domain (owner, 2026-11-01): main address stays https://techaust.com, www redirects to it (gateways were verified with the www URL while it already redirected). Don't re-ask; 13 row.
- Team 2–5 people, 10+ yrs experience; skills: web/full-stack, AI/LLM & automation, mobile, UI/UX & marketing.
- 20+ projects delivered (websites, web apps/SaaS, AI/automation, mobile). Most profitable: custom web apps/SaaS. Enjoys all, AI/automation especially.
- Markets: wants all four (India SMB/startup, India enterprise, intl SMB, intl enterprise). Industries: startups/SaaS/tech; finance/accounting/legal; retail/e-commerce/logistics.
- Capacity 3–4 concurrent projects. (Revenue target and marketing budget are kept out of this public copy: ask the owner if needed.)
- Has retainers/AMC clients already; wants monthly care plans. Portfolio: anonymised case studies only. Excludes no work types.
- Direction: productized agency now → own products later.

Phase 2 decisions (2026-10-06): positioning = senior product + AI automation studio, finance/accounting/legal ops niche first; lead market = both, split by offer (India: automation/integrations/care plans; intl: product builds/dev subscription); website shows "starting from" prices, no hourly rate; retire Corporate Brain/Digital Workforce/System Guard names. Portfolio S1–S18 in docs/02-services-strategy.md.

Phase 3 key decisions (2026-10-06): all-Cloudflare FREE plan forever (budget ₹500–1000/mo max) → static Astro site, React SPA + Hono API for admin/portal, D1+Drizzle, R2, Browser Run PDFs, Queues/Cron; admin login = email+password (browser Argon2id + server HMAC) + mandatory TOTP; portal magic links; SES Mumbai email; Razorpay (INR) + existing Stripe & PayPal (USD) + manual bank transfer; backups nightly encrypted to S3 Mumbai; GA4 only after consent + CF Web Analytics; GSTIN/proprietor on invoices only (not website); new private repo in techaust GitHub org; domains techaust.com / admin. / portal. Full list in docs/03-plan.md §0.

**How to apply:** don't invent clients/metrics; site must be honest (see [[techaust-rebuild-project]] audit C-1..C-3).

Phase 4 answers to 03 §5 (2026-10-06):
- Approvals: tiered — Staff/Sales may send proposals/estimates up to 10% discount (more → owner approval); Staff drafts invoices, only Owner issues; Staff records bank transfers as "pending verification" until Owner confirms; refunds Owner-only.
- Advances: build proforma + tax-invoice-upfront modes; default = Proforma → auto Tax Invoice on payment. Care-plan invoices: draft for review by default, per-client auto-issue toggle.
- Payment schedule: builds 40/30/30; small jobs (<₹1L/$2k: Discovery Sprint, audits, single workflow) 100% upfront; care plans monthly in advance; proposal validity 15 days.
- Booking: form "preferred call window" + plain Cal.com link (no embed). Senders: hello@ (leads/proposals), billing@ (invoices/reminders/receipts), no-reply@ (magic links/security); replies to Zoho; contact@ stays public.
- USD bank: same Indian current account via SWIFT. Staging: *.workers.dev behind Cloudflare Access.
- No CA and no lawyer: owner asked Claude to act as CA/lawyer → Claude researches & drafts best-effort positions with sources, keeps VERIFY WITH CA/LEGAL tags; optional 1-hr professional review is the owner's call at Phase 7 (told owner Claude can't sign off). S3 DPDP page hidden until a legal partner exists.
- Content: owner fills 2–3 case-study briefs; socials = LinkedIn company page + founder LinkedIn only; logo now into `brand-incoming/`, headshot+bio at website milestone; AMC clients 1–3.
- Public contact: WhatsApp business number (owner gives later), reply within 1 business day (Mon–Sat 10:00–19:00 IST), address shown as city+state only ("Balurghat, West Bengal, India"); 3 launch blog posts drafted by Claude.
- Care SLAs business-hours only (Essential 2 BD, Growth 1 BD, Scale 4 business hours critical); About = founder profile + team by role (no names); founder leads Fractional CTO.
- Note: GST serial no. max 16 chars → TH/INV/26-27/0001 (17) too long; use e.g. TH/INV/2627/0001.
- Follow-up decision: full postal address only on the Contact + legal pages (header/footer/schema = city+state). Legal pages name "TecHaust Technologies, sole proprietorship, Balurghat WB"; Grievance Officer = Rupak Sarkar, Founder (privacy@/grievance@ alias); no GSTIN anywhere on the website.
- Research (docs/08-research-appendix A/B): FEMA realisation 9 months + monthly EDF from 1 Oct 2026; Debit Note type added; numbering TH/{INV,EXP,CN,DN,RV,RF,RCT,PI}/2627/0001; LUT for FY26-27 possibly unfiled (urgent flag); Razorpay needs a Delivery policy page; keep security logs ≥ 13 months.
- Stack changes approved 2026-10-06: in-house auth (packages/auth: @oslojs/otp + Web Crypto + D1 sessions) instead of Better Auth; production deploy = owner-only workflow_dispatch + typed tag confirmation + separate prod CF token (GitHub Free). Versions per docs/05-research-appendix/A-stack-verification.md (Astro 7, React Router 8, Vitest 4.1, TS 6).
- Phase 5 P5.1: owner approved all recommended tools T1–T12 (docs/10-tooling.md): Cloudflare plugin (install), Context7, GitHub, Playwright, built-in skills; AWS + Sentry later. Not: Supabase/Upstash/Expo/Chrome/community plugins.
- Corrections since: the repo is PUBLIC (not private); the supplied logo is RETIRED. The new identity "Patina" was chosen by the owner 2026-10-06 (see [[techaust-rebuild-project]]). Owner still owes: WhatsApp business number (also needed on the business card), headshot + bio, case-study briefs.
- 2026-10-16: owner confirmed TecHaust Technologies has served clients under this name since 2019, and the core team each have 10+ years' experience (07 §1.4). "10+ years" is never the company's age.
