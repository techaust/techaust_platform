# Non-AI-Core Software Services: Demand, Pricing & Models (Research for TecHaust Technologies)

> **Phase 2 research record (APPROVED 2026-10-06).** Parent: [02](../02-services-strategy.md). Where it differs from a decision, [13-decisions](../13-decisions.md) wins.

Research date: 2026-10-06. Web research only. Sources are listed at the end with publication or update dates where shown.

**Legend:** **[S#]** = sourced fact (see the numbered source list). **[INF]** = inference or recommendation by the researcher. **[VENDOR]** = a figure from a vendor or agency blog with a commercial interest. Treat it as directional only.

FX assumption for the INR conversions: about ₹88 = US$1 **[INF]**.

---

## 0. Executive summary

1. **Overall spend is growing, not shrinking.** Gartner forecasts worldwide IT spending of $6.15T in 2026 (+10.8%) **[S1]**. Software spending is projected at about $1.44T (+15.1%), and IT services are the largest segment at about $1.86T **[S2]**. AI coding tools have not shrunk the services market overall.
2. **AI coding tools are squeezing hourly billing, not total project prices.** About a third of agencies had received "AI discount" requests by 2025. By March 2026 the expected wave had not grown, and value-based pricing is the preferred direction for agencies changing their models **[S3][S4]**. Coding is roughly 20% of project effort. Discovery, UX, QA, integration and accountability are the rest and are mostly unchanged, so quotes are not falling much: 61% of firms expect only 10–25% budget reduction **[S5][VENDOR]**.
3. **Most durable demand for a small senior studio:** custom web apps, portals and internal tools (35% of enterprises have replaced at least one SaaS tool with a custom build) **[S6]**; API and systems integration (India: Tally/Zoho/GST/Razorpay/WhatsApp); maintenance, AMC and DevOps retainers; and fixing or hardening apps generated with "vibe coding" tools **[S7][VENDOR]**.
4. **Most commoditised:** simple SMB brochure websites, due to AI site builders plus a ₹10k–₹50k price floor in India **[S8][S9]**; basic Shopify theme setups; and generic SEO.
5. **India-specific tailwinds:** DPDP Rules compliance (Consent Manager rules from 13 Nov 2026, full obligations from 13 May 2027) **[S10]**; GST e-invoicing for businesses above ₹5 cr, with a 30-day IRP upload rule for those at ₹10 cr+ **[S11]**; about 15M WhatsApp Business accounts **[S12][VENDOR]**; ONDC passing 500M cumulative transactions **[S13]**; and UPI at about 24B transactions a month **[S14]**.
6. **Pricing position:** Indian agencies sit at $25–49/hr on Clutch, versus $50–99 for US software firms and $100–149 for US web agencies **[S16][VENDOR]**, Canada and Australia **[S15]**. The ₹2–5 lakh/month goal (about $2.3k–5.7k) needs only about 1–2 international retainers, or 3–4 Indian mid-ticket projects plus care plans **[INF]**.

---

## 1. Demand by service line (2025–26)

Ratings in the table are **[INF]**, based on the evidence column.

| Service | Demand evidence | Who buys | Durability vs AI coding tools | Competition | Fit for TecHaust |
|---|---|---|---|---|---|
| **MVP / SaaS product development** | Production MVPs cost $15k–80k; most startups spend $25k–45k **[S16][VENDOR]**. India seed funding: Tracxn shows seed deal count down to 420 in H1 2026 and first-time funded companies down 31%. Inc42 shows seed dollars up 18% to $478M **[S17]**. Some founders now build v0 themselves with Lovable, Bolt or Cursor. | Seed/pre-seed founders (India, US, UK, Gulf), non-technical founders, corporate innovation teams | **Medium.** AI tools speed up setup, CRUD screens, tests and migrations, but not architecture, scope judgement, UX or security review **[S16]**. The prototype layer is commoditising; production-grade MVPs are not. | Very high, from global offshore firms and solo AI-assisted freelancers | **High** if packaged as a fixed-scope "MVP sprint" with productised discovery |
| **Custom web apps, portals, internal tools** | 35% of enterprises replaced at least one SaaS tool with custom software; 78% plan to build more internal tools in 2026. Workflow automation (35%) and admin tools (33%) top the list **[S6]**. McKinsey: 32% of organisations declined to buy software because they could build it **[S6 secondary]**. Clutch: most projects are $10k–49.9k; the average is about $132k over about 13 months **[S15]**. | SMB and mid-market operations teams; finance, legal and logistics firms; SaaS companies replacing seat-based tools | **High.** AI lowers the cost of building, which *increases* build-vs-buy demand. The bottleneck shifts to domain modelling, security and governance (only 8% of leaders rate internal-tool governance as strong) **[S18]**. | Medium–high. Low-code tools (Retool, Appsmith, Zoho Creator) are partial substitutes. | **Highest.** This is already the most profitable line. |
| **Mobile apps (cross-platform)** | MVP apps $15k–50k; growth-stage apps $50k–150k; cross-platform saves 30–50% versus dual native **[S19][VENDOR]**. | B2C startups, D2C brands, field-force and logistics apps, fintech | Medium | Very high, especially from Indian firms | Medium. Offer as an add-on (Flutter/React Native/Expo) to web apps, not as the lead offer. |
| **Legacy modernisation / cloud migration** | Market about $25.8B in 2026, +16% CAGR. Drivers: rising maintenance cost, unsupported software, scarce legacy skills **[S20]**. AI-assisted migration tools are a named trend **[S20]**. | Mid-market and enterprise (older PHP/.NET/Access/Excel-macro systems), Indian SMEs on desktop software | **Medium–high.** AI speeds up code translation, but data migration, cut-over risk and domain knowledge stay human work. | High at the enterprise end (large system integrators); low at the SMB end | Medium–high. For SMBs, "Excel/Access/Tally-desktop to web app" is a good niche. |
| **E-commerce (Shopify / headless)** | Shopify Plus builds $25k–150k. Headless builds: $10k–25k narrow, $25k–60k growth, $60k–150k+ complex. North American Plus agencies bill $150–300/hr **[S21][VENDOR]**. India: a Shopify store with 20–100 products costs ₹20k–80k **[S9]**. | D2C brands, retailers going omnichannel, B2B wholesale | Low for theme setup, which is commoditised. High for integrations (ERP, GST, WhatsApp, logistics) and headless. | Very high at the low end | Medium. Focus on integrations and custom apps, not theme installs. |
| **UI/UX & design systems** | US agency design systems $25k–160k by size; full product design $40k–150k **[S22][VENDOR]**. Design subscriptions $350–5,000/mo; Designjoy $4,995/mo **[S23][S24]**. | SaaS companies, funded startups, enterprises with several products | Medium. AI speeds up mockups; research, IA and system governance are durable. | High | Medium. Bundle with builds; sell a design-system starter to SaaS clients. |
| **SMB website design/dev** | AI builders are growing fast, and SMEs make up about 49% of builder revenue **[S8][VENDOR]**. India pricing: basic site ₹10k–50k; agency CMS site ₹80k–1.5L; freelancers ₹30k–70k **[S9]**. Even Wix has flagged AI as a threat to its core business **[S8]**. | Micro-businesses and professionals | **Low. Commoditised.** Value has moved to conversion, technical SEO and integrations ("AI builders handle about 60%") **[S8][VENDOR]**. | Extreme | Low as a standalone. Use as an entry product bundled with a care plan, or a premium "conversion site + AEO" offer. |
| **SEO / AEO (AI search optimisation)** | About 25% of Google searches triggered AI Overviews in early 2026. AI search visits grew 42.8% YoY. 51% of B2B buyers start research in AI chatbots. Only 20% of marketers have started AEO **[S25][VENDOR]**. AEO retainers: SMB $1.5k–5k/mo; mid-market $2k–8k/mo; under $1.5k/mo is "rebranded SEO" **[S26][VENDOR]**. India SEO: ₹15k–40k/mo for small businesses **[S27]**. | B2B SaaS, professional services (legal, finance), e-commerce | Medium. Fast-moving; the technical side (schema, site structure, performance) suits a dev studio. | Rising fast; many relabelled SEO shops | Medium. Offer "technical AEO" as a care-plan add-on, not as a content agency. |
| **Maintenance / AMC / DevOps / managed hosting** | US WordPress care plans $150–500/mo; premium $400–800 **[S28]**. India AMC ₹1.5k–15k/mo, and SMBs spend ₹5k–25k/mo on complete plans **[S29]**. AWS MSP retainers: SMB $3k–8k/mo **[S30][VENDOR]**. | Every past client; SMBs without in-house tech staff | **High.** Accountability and uptime are not commoditised by AI, and AI-generated apps *add* maintenance burden **[S7]**. | Medium | **Highest.** Recurring revenue toward the target. |
| **Fractional CTO / tech consulting** | $5k–15k/mo for 10–20 hrs/week; light advisory from $3k/mo; "advisory + MVP" $5k–8k/mo **[S31][VENDOR]**. | Non-technical founders, SMB owners, PE-owned SMBs | High. Judgement-based work. | Medium | High for international clients, given 10+ years of experience. In India, price at ₹50k–1.5L/mo **[INF]**. |
| **API & systems integration** | Indian SMEs commonly run TallyPrime for accounting plus Zoho for sales and inventory. Integration modes include direct IRP API, GSP middleware and ERP plug-ins **[S32]**. Tally uses ODBC/TDL (niche skill); Zoho uses REST and Deluge **[S32]**. ERP integration on Shopify Plus costs $25k–150k **[S21]**. | Indian SMEs (trading, distribution, manufacturing, CA firms); D2C brands; global SMBs (Stripe/HubSpot/QuickBooks) | **High.** Every system is different; vendor quirks and compliance resist commoditisation. | Low–medium in the India niche | **High.** Strong differentiator, and repeatable as productised connectors. |
| **Data dashboards / BI** | Power BI fixed-scope dashboards $4k–15k (some sources $5k–25k); part-time retainers $2k–8k/mo **[S33][VENDOR]**. UK SMBs spend £5k–20k on tactical BI **[S33]**. | Finance and accounting firms, logistics, e-commerce, SMB owners | Medium. AI chat-to-data is eroding simple dashboards; data plumbing remains. | Medium | Medium–high. Package as "Tally/Zoho/Shopify to owner dashboard" for India. |

### Specific demand signals worth noting
- **Vibe-coded app rescue.** Agencies now market "rescue engineering" for apps built with Lovable, Bolt, Cursor or Replit. Vendor claims: AI code accumulates issues about 1.7× faster, and security flaws appear in about 45% of tested AI codebases **[S7][VENDOR — the claim that "8,000 of 10,000 startups need rescue" is unverified and likely inflated]**. Stack Overflow's 2025 survey showed trust in AI tools falling, with most developers distrusting accuracy **[S34]**. **[INF]** A "Production-Readiness Audit + Hardening" package ($1.5k–5k international; ₹50k–2L India) fits TecHaust well.
- **The AI productivity reality.** METR's randomised trial (Feb–Jun 2025) found experienced developers were 19% *slower* with AI while believing they were 20% faster **[S35]**. Use this in sales: speed gains are real for routine work, not across the board **[INF]**.

---

## 2. Impact of AI coding tools on agency pricing and delivery

**Sourced facts**
- Tool cost is trivial: about $20/mo Pro tiers and $200/mo power tiers for Claude, Cursor and ChatGPT; Copilot Pro $10 **[S36]**.
- Productive.io surveyed 180+ agencies in Sept 2025: about one third had received AI-discount requests and about half expected them. The follow-up (174 agencies, March 2026) found discount requests "largely unchanged", no consensus on pricing, and value-based billing as the preferred direction. Agencies that monetise AI show more pricing confidence **[S3]**.
- Digital Applied (June 2026) says AI compresses deliverables 3–4×, which turns hourly billing into a revenue penalty. Retainer-heavy agencies earn margins about 8 points higher than project-based ones, and niche specialists earn 40–75%. Among earners above $150k, value-based pricing is the primary model 62% of the time versus 8% for hourly. WPP ties 20–25% of net sales to performance fees **[S4][VENDOR]**.
- FoundersBar (Apr 2026) splits projects 40/20/40 across planning, coding and QA/integration. AI shrinks the coding share from about 20% to 8–12%. Most agencies grant 20–30% discounts at most, and 50–70% demands are rarely approved **[S5][VENDOR]**.
- Indian IT services: one CEO reports clients want the same work for 25–30% less **[S37 secondary]**.

**How agencies are repositioning [INF, synthesised from S3–S5]**
1. **From hourly to fixed scope and value pricing.** Price the outcome, such as "billing portal live in 6 weeks", and keep the AI efficiency gain as margin.
2. **Productised packages** with tight scope (audit, MVP sprint, integration connector, care plan).
3. **Retainers and subscriptions** priced on throughput (one active request at a time) rather than hours.
4. **Selling speed as the value:** "2–3× faster delivery" at a similar total price, rather than cheaper prices.
5. **Selling judgement:** architecture, security review, code audits, and "AI-built app hardening".
6. **Being open about AI use**, with a short policy on how AI is used, who reviews the code and IP ownership. This addresses client distrust.

**Implication for TecHaust [INF]:** Avoid publishing hourly rates on the website. Publish "starting from" fixed packages and care-plan tiers. Quote an hourly rate only for overflow work, and set it at $35–50/hr (international) or ₹1,500–2,500/hr (India), which is the top of the Indian Clutch band and justified by 10+ years of seniority.

---

## 3. Pricing benchmarks

### 3a. Hourly rates
| Market | Rate | Source |
|---|---|---|
| India (Clutch, software development firms) | $25–49/hr | **[S15]** (updated 21 Sep 2026) |
| India freelancers (mid-level full-stack) | $20–52/hr; senior $30–72; staff/principal $42–95 | **[S38][VENDOR]** |
| Upwork freelance web developers (global) | $15–50/hr, median about $30 | **[S16]** citing Upwork |
| US software firms (Clutch) | $50–99/hr | **[S15]** |
| US web agencies (UX Continuum) | $100–149/hr | **[S16][VENDOR]** (UX Continuum) |
| US boutique design agencies | $100–149/hr; enterprise $200–300 | **[S22]** |
| Canada / Australia (Clutch) | $100–149/hr | **[S15]** |
| Australia mid-size agencies | AUD 150–330/hr | **[S39][VENDOR]** |
| UK | Roughly $50–199/hr; contractors $64–108 | **[S39][VENDOR]** |
| Poland | $50–99/hr; Ukraine, Spain, Mexico, Philippines $25–49 | **[S15]** |
| UAE local agencies | AED 250–450/hr (about $68–122); freelancers $60–100/hr | **[S39][VENDOR]** |
| Shopify Plus agencies (North America) | $150–300/hr; specialists $350+ | **[S21]** |
| Fractional CTO | $200–400/hr | **[S31]** |

### 3b. Project price ranges
| Deliverable | International (mostly US/global agency) | India (domestic) |
|---|---|---|
| MVP / SaaS MVP | $15k–80k; most $25k–45k; scoped 4–8 week MVP $28k–55k; US boutique $60k–120k **[S16][S40]** | **[INF]** ₹3L–15L for an Indian studio; offshore pricing to international clients $12k–40k |
| Custom web app | Most Clutch projects $10k–49.9k; average $132k **[S15]** | ₹2L–20L+ **[INF]** |
| Mobile app (cross-platform) | MVP $15k–50k; growth $50k–150k **[S19]** | ₹3L–15L **[INF]** |
| Shopify store | Plus $25k–150k; headless $10k–150k+ **[S21]** | ₹20k–80k for a 20–100 product store; custom e-commerce ₹1L–10L+ **[S9]** |
| SMB website | n/a (US agencies typically $5k–25k **[INF]**) | Basic ₹10k–50k; agency CMS site ₹80k–1.5L; freelancers ₹30k–70k **[S9]** |
| Design system | $25k–160k (US) **[S22]** | n/a |
| BI dashboards | $4k–25k fixed **[S33]** | ₹50k–3L **[INF]** |

### 3c. Monthly maintenance, AMC and care plans
| Example | Tiers and price | Inclusions |
|---|---|---|
| **WP Buffs** (US) **[S41]** | Maintain $89 / Protect $179 / Perform $239 / Custom $359 per month | Weekly updates, 4× daily backups, uptime monitoring, 24/7 emergency support; unlimited edits from Protect up; speed, e-commerce and malware removal from Perform up; staging updates on Custom |
| **Codeable** **[S28]** | $240 / $590 / $1,000+ per month | Escalating developer access and SLA |
| Other US agency plans **[S28]** | $95 / $195 / $395 per month; agency norm $150–500; premium $400–800 | Hosting, updates, backups, security; developer hours in higher tiers |
| **India AMC norms** **[S29]** | Basic ₹1.5k–3k / Standard ₹3k–7k / Premium ₹7k–15k per month. Annual: ₹18k–36k / ₹36k–84k / ₹84k–1.8L | Updates, backups, uptime, security, broken-link checks, form tests, SSL/domain reminders, small content changes, monthly report. "Complete" SMB plans ₹5k–25k/mo |
| AWS/DevOps MSP **[S30]** | SMB $3k–8k/mo; DevOps-as-a-service from about $500–2,999/mo | Monitoring, on-call, patching, cost optimisation. Cloud bill is usually separate. |

**Suggested TecHaust care-plan tiers for custom web apps, not WordPress [INF]:**

| Tier | India price | International price | What's included |
|---|---|---|---|
| **Essential** | ₹7,500–12,000/mo | $250–400/mo | Hosting management, uptime/error monitoring, dependency and security patches, daily backups, monthly report, 2 hrs of minor changes, 2-business-day response |
| **Growth** | ₹20,000–35,000/mo | $750–1,200/mo | Everything in Essential, plus 8–10 dev hours, performance and SEO/AEO technical checks, analytics dashboard, 1-business-day response, quarterly roadmap call |
| **Scale** | ₹50,000–1,00,000/mo | $2,000–4,000/mo | Everything in Growth, plus 25–40 dev hours or one active request at a time, DevOps/CI, security review, 4-hour critical SLA, fractional CTO advisory |

Supporting points:
- Unused hours do not roll over, or roll over for one month only.
- Overage is billed at the plan rate.
- An annual prepay discount of 10–15% fits Indian AMC norms.
- Pricing is anchored above the Indian WordPress AMC rates in **[S29]** because these are custom apps. International pricing stays below US agency norms **[S28]**.

---

## 4. Productised-service models that work for small studios

| Model | Real examples and pricing | Notes |
|---|---|---|
| **Design subscription** (one active request, unlimited queue) | Designjoy $4,995/mo for 1 request, $7,995 for 2, includes Webflow development **[S24]**. ManyPixels $549–1,299. Design Pickle $499–1,695. Flocksy $595. Kimp $599 **[S23]**. | Proven model. It caps work-in-progress, not total output. |
| **Development subscription** | Entry $890–1,500/mo for maintenance plus dev; core unlimited dev $2k–3k/mo; faster turnaround $3.5k–5k; premium $5.9k+ **[S42][VENDOR]**. Webflow agency: dev $5.9k, design+dev $7.9k, plus copy $9.9k/mo; hour packs from $2.5k **[S42]**. Bridgewood Creative: $3,699/mo for design+dev **[S23]**. | Sells "throughput, not hours" **[S42]**, so AI speed becomes margin **[INF]**. |
| **Care plans / AMC** | WP Buffs, Codeable, Inspirable ($49.99–159.99) **[S28][S41]** | Most reliable recurring revenue; low churn when bundled with hosting **[INF]**. |
| **Fractional CTO retainer** | $3k–25k/mo; "advisory + MVP slice" $5k–8k/mo **[S31]** | Good door-opener to builds **[INF]**. |
| **Fixed-scope packages** | Scoped MVP 4–8 weeks $28k–55k **[S40]**; Power BI 3–5 dashboards $5k–25k **[S33]**; AEO audit + schema retainer $1.5k–5k/mo **[S26]** | Package the discovery step as a paid product **[INF]**. |
| **Hybrid retainer** | Base retainer plus prepaid hour blocks, common with MSPs **[S30]** | Suits exploratory work **[S4]**. |

**Recommended product ladder for TecHaust [INF]**

| Step | Product | India price | International price |
|---|---|---|---|
| 1 | Paid discovery / "Blueprint" (scope, architecture, clickable prototype), credited against the build | ₹40k–1L | $1.5k–4k |
| 2 | Fixed-price builds: MVP Sprint (6–8 weeks), Business Portal/Internal Tool, Integration Connector | ₹3L–12L | $12k–40k |
| 3 | Rescue/Hardening Audit for AI-built or legacy apps | ₹50k–2L | $2k–6k |
| 4 | Care plans (three tiers, as in §3c) | see §3c | see §3c |
| 5 | Dev subscription with one active request | ₹1.5L–2.5L/mo | $2.5k–4.5k/mo |
| 6 | Fractional CTO | ₹75k–1.5L/mo | $3k–6k/mo |

**Revenue maths toward ₹2–5L/month [INF]**
- Four Growth-tier care plans in India (about ₹1L) plus one international dev subscription ($3k, about ₹2.6L) comes to about ₹3.6L/mo recurring before project revenue.
- Alternatively, one ₹6L project every two months (₹3L/mo) plus six care plans (₹1–1.5L) comes to about ₹4–4.5L.

---

## 5. Indian SMB-specific opportunities

| Theme | Sourced facts | Opportunity for a small studio [INF] |
|---|---|---|
| **MSME digitisation** | 8.95 crore MSMEs registered on Udyam and Udyam Assist as of 29 Jul 2026 **[S43]**. 5 in 10 MSMEs face supplier-management, invoice-compliance and credit challenges; digital procurement adoption is accelerating (India SME Forum, June 2026) **[S44]**. | Vertical micro-SaaS or templated portals: distributor ordering, dealer portals, job-work tracking. Sell as a setup fee plus monthly subscription. This is a bridge to TecHaust's own products. |
| **WhatsApp commerce** | India leads with about 15M active WhatsApp Business accounts. FY26 addressable spend about ₹4,200 cr, growing ~38% YoY (BFSI 24%, D2C 21%, healthcare 14%) **[S12][VENDOR]**. GoKwik (26B messages, 1,800+ brands): 83% of WhatsApp-driven festive orders came from first-time buyers **[S12]**. Meta India pricing: marketing ₹0.8631/msg, utility and authentication ₹0.115, plus 18% GST. Per-message billing since 1 Jul 2025. Service replies billed at ₹0.115 after 1,000 free from 1 Oct 2026 **[S45]** (that date is now past: re-verify against Meta's official rate card before quoting S11). | WhatsApp ordering/catalogue bots linked to Shopify, Zoho or Tally: order status, payment links, abandoned-cart flows. Charge setup ₹40k–2L plus ₹5k–20k/mo management. Integrate through BSP APIs rather than competing with BSPs. |
| **GST e-invoicing** | Mandatory above ₹5 cr AATO (unchanged for FY 2026–27). Since 1 Apr 2025, businesses at ₹10 cr+ must upload to the IRP within 30 days or invoices are rejected **[S11]**. Lower thresholds and B2C e-invoicing are speculated, not confirmed **[S11]**. Integration modes: direct IRP API, GSP middleware, ASP-GSP, ERP plug-in, bulk upload **[S32]**. | E-invoice and e-way bill integration for custom billing systems and portals, via a GSP API. Also a Tally/Zoho reconciliation dashboard. Note that one search snippet claimed a ₹2 cr threshold from Oct 2025; this was **not** confirmed by a March 2026 source and should be treated as false. |
| **ONDC** | 500M+ cumulative transactions (July 2026). 218M in FY2026. About 206k merchants had transacted by Dec 2025; 3 lakh+ sellers, 100+ buyer apps, 400+ cities **[S13]**. | ONDC catalogue and seller-app integration for brands and local retailers, typically through existing seller network participants (Unicommerce, etc.). Niche but low competition. Medium priority. |
| **UPI / payments** | UPI handled 24.51B transactions in Aug 2026 (record) and 24.07B in Sept 2026 (+23% YoY) **[S14]**. 65% UPI adoption among WhatsApp users **[S12][VENDOR]**. | Razorpay, Cashfree and PhonePe PG integration: subscriptions, UPI Autopay, payment links, reconciliation. Package as a fixed-price "payments & invoicing module" added to every custom build. |
| **DPDP Act compliance** | DPDP Rules notified Nov 2025. Consent Manager framework from 13 Nov 2026. Full obligations (notice, consent, security, rights, breach reporting) from 13 May 2027 (see [08-B](../08-research-appendix/B-dpdp-legal.md); **VERIFY WITH CA/LEGAL**). Penalties up to ₹250 cr **[S10]**. | **A time-bound opportunity, roughly Oct 2026 to May 2027.** Offer a DPDP readiness audit plus implementation: consent capture, notice flows, data-principal rights request portal, logging and retention, breach workflows. Fits finance, accounting and legal clients well. Price ₹75k–5L per app. |
| **Gulf / Middle East** | GCC digital transformation market about $20.4B in 2026; Vision 2030 drives outsourcing of software and cloud work. Indian mid-sized IT firms deliver through offshore and hybrid models **[S46]**. UAE agencies charge AED 250–450/hr **[S39]**. | Indian-diaspora SMB owners in the UAE and KSA are a warm channel. TecHaust's price point is about 40–60% of a local agency **[INF]**. |

---

## 6. Strategic takeaways for TecHaust [INF]

1. **Lead offers:** (a) custom web apps, portals and internal tools; (b) India integrations (Tally/Zoho/GST/WhatsApp/Razorpay); (c) MVP sprints for international founders.
2. **Recurring base:** three-tier care plans attached to every build, with the first 1–3 months included at launch to drive conversion. Add a dev subscription for international SaaS clients.
3. **Timely wedges:** DPDP compliance until May 2027, AI-built app rescue and hardening, and technical AEO for B2B sites.
4. **De-emphasise:** standalone SMB brochure sites, basic Shopify theme setups, and generic SEO content.
5. **Pricing:** fixed and value-based packages with "starting from" prices on the website, and no public hourly rate. Position "AI-accelerated delivery, senior-reviewed code" as faster at a similar price, not cheaper.
6. **Industry focus:** finance, accounting and legal for DPDP, dashboards, e-invoicing and portals; retail, e-commerce and logistics for WhatsApp, ONDC, Shopify integrations and dealer portals; SaaS and startups for MVPs, design systems, dev subscriptions and fractional CTO work.

---

## Sources

| # | Source | URL | Date |
|---|---|---|---|
| S1 | Gartner press release, worldwide IT spending +10.8% to $6.15T | https://www.gartner.com/en/newsroom/press-releases/2026-02-03-gartner-forecasts-worldwide-it-spending-to-grow-10-point-8-percent-in-2026-totaling-6-point-15-trillion-dollars | 2026-02-03 |
| S2 | SaaStr on Gartner: software $1.44T (+15.1%); Channel Dive on IT services | https://www.saastr.com/gartner-software-spend-now-1-44-trillion-in-2026-revised-back-up-to-15-1-the-slowdown-never-came-are-you-grabbing-it/ ; https://www.channeldive.com/news/global-tech-spend-it-services-consulting-gartner/811290/ | 2026 |
| S3 | Productive.io, "Agencies in the AI Era 2.0" pulse report (174 agencies) and 2025 original | https://productive.io/reports/agencies-in-the-ai-era-pulse-report/ ; https://productive.io/blog/agencies-in-the-ai-era/ | Mar 2026; Sep 2025 |
| S4 | Digital Applied, "AI-Era Agency Pricing Models: A 2026 Decision Guide" | https://www.digitalapplied.com/blog/ai-agency-pricing-models-2026-decision-guide | 2026-06-05 |
| S5 | FoundersBar, "Why Software Development Quotes Aren't Dropping" | https://foundersbar.com/articles-and-research/why-software-development-quotes-arent-dropping | 2026-04-21 |
| S6 | Retool, "Build vs. Buy Shift" report 2026 (817 respondents); McKinsey State of AI 2026 cited secondarily | https://retool.com/blog/ai-build-vs-buy-report-2026 ; https://www.lyntonweb.com/library/enterprises-dropping-saas | 2026 |
| S7 | Vibe-coding rescue market (vendor) | https://devoxsoftware.com/blog/top-vibe-coding-rescue-companies-in-2026/ ; https://keyholesoftware.com/vibe-coding-trends-2026/ | 2026 |
| S8 | AI website builder statistics (Hostinger); AI builder vs agency (Astucia) | https://www.hostinger.com/blog/ai-website-builder-statistics/ ; https://astucia.io/blog/ai-website-builder-vs-web-design-agency | 2026 |
| S9 | Website development cost in India 2026 (multiple Indian agency guides) | https://www.buildbyravirai.com/blog/website-development-cost-india-2026-complete-guide ; https://zethic.com/website-development-cost-in-india-2026-full-price-breakdown/ ; https://ewebworld.in/how-much-does-website-development-cost-in-india-2026-pricing-guide/ | 2026 |
| S10 | DPDP Rules 2025 timelines | https://www.privybyidfy.com/blog/dpdp-compliance-guide-2026-what-indian-enterprises-must-do-before-may-2027 ; https://www.vinsys.com/blog/dpdp-act-compliance-deadline-nov-2026-for-consent-manager ; https://www.consent.in/blog/dpdp-rules | 2026 |
| S11 | GimBooks, ₹5 crore e-invoice rule 2026; GSTN IRP 30-day advisory | https://www.gimbooks.com/blog/5-crore-e-invoice-turnover-rule-2026/ ; https://einvoice6.gst.gov.in/content/revised-time-limit-for-e-invoice-reporting-for-businesses-with-aato-of-%E2%82%B910-crores-above/ | 2026-03-13; 2025 |
| S12 | State of Indian WhatsApp Business 2026 (RichAutomate); GoKwik WhatsApp Intelligence Report; Future Market Insights | https://richautomate.in/research/state-of-indian-whatsapp-business-2026 ; https://www.gokwik.co/whatsapp-intelligence-report ; https://www.futuremarketinsights.com/reports/conversational-commerce-market | 2026 |
| S13 | ONDC crosses 500M transactions (WORLDEF); Unicommerce ONDC guide | https://worldef.com/2026/08/07/ondc-crosses-500-million-transactions-india/ ; https://unicommerce.com/blog/what-is-ondc/ | 2026-08-07 |
| S14 | UPI Aug 2026 record (MediaNama); Sept 2026 (StartupTalky) | https://www.medianama.com/2026/09/223-upi-transactions-august-2026/ ; https://startuptalky.com/upi-transactions-september-2026/ | Sep–Oct 2026 |
| S15 | Clutch Software Development Pricing Guide | https://clutch.co/developers/pricing | updated 2026-09-21 |
| S16 | UX Continuum, MVP Development Cost 2026 | https://uxcontinuum.com/blog/saas-development/mvp-development-cost-2026 | 2025-11-11, updated 2026-09-30 |
| S17 | Inc42 H1 2026 funding; Tracxn India Tech H1 2026; CIOL | https://inc42.com/features/indian-startup-funding-slips-9-to-5-2-bn-in-h1-2026/ ; https://tracxn.com/d/insights/market-reports/india-tech-h1-2026-geo-semi-annual-report/__lHq3otGqbon6v-RYcm3-B2GCw3b6bqZ3djS7ZXQ7As0 ; https://www.ciol.com/startups/beyond-funding-h1-2026-reveals-indias-narrowing-startup-pipeline-12123766 | Jul 2026 |
| S18 | Retool, State of AI Governance 2026 | https://retool.com/blog/ai-governance-report-2026 | 2026 |
| S19 | Mobile app cost 2026 (Unico Connect, AppZoro) | https://unicoconnect.com/blogs/mobile-app-development-cost-2026 ; https://appzoro.com/blog/cross-platform-mobile-app-development-cost | 2026 |
| S20 | Research and Markets, Legacy Modernization Global Market Report 2026 | https://www.researchandmarkets.com/reports/6226317/legacy-modernization-global-market-report | 2026 |
| S21 | Weaverse headless pricing; Liquid Lemon Shopify Plus agency cost; Weframetech | https://weaverse.io/blogs/shopify-headless-pricing ; https://www.liquidlemon.co/blogs/insights/shopify-plus-agency-cost ; https://weframetech.com/blog/shopify-plus-store-development-cost-breakdown-2026 | 2026 |
| S22 | Fuselab Creative, UI/UX design cost | https://fuselabcreative.com/ui-ux-design-cost/ | 2026 |
| S23 | ManyPixels, design subscription vs retainer and unlimited services list | https://www.manypixels.co/blog/get-a-designer/design-subscription-vs-agency-retainer ; https://www.manypixels.co/blog/graphic-design/top-unlimited-companies | 2026 |
| S24 | Designjoy pricing (ManyPixels vs Designjoy; PitchWorx) | https://www.manypixels.co/blog/get-a-designer/manypixels-vs-designjoy ; https://pitchworx.com/designjoy-alternative | 2026 |
| S25 | Omnibound AEO statistics 2026; Contently AEO definition | https://www.omnibound.ai/blog/answer-engine-optimization-aeo-statistics ; https://contently.com/2026/02/03/what-is-aeo-answer-engine-optimization/ | 2026 |
| S26 | AEO pricing (Stackmatix; The Remarkable Agency) | https://www.stackmatix.com/blog/aeo-services-pricing ; https://theremarkableagency.com/blog/aeo-geo-agency-cost | 2026 |
| S27 | SEO cost in India 2026 (Affable Solution; TeamTweaks) | https://affablesolution.com/blog/seo-services-cost-in-india/ ; https://www.teamtweaks.com/blog/seo-cost-in-india/ | 2026 |
| S28 | Codeable WordPress maintenance pricing 2026; Inspirable care plans guide | https://www.codeable.io/blog/wordpress-maintenance-pricing/ ; https://inspirable.com/insights/wordpress-care-plans-complete-guide-2026/ | 2026 |
| S29 | Website maintenance / AMC cost India 2026 | https://redpulsesoftware.in/blog/website-amc-packages-india-2026 ; https://crisant.com/blog/website-maintenance-cost-india ; https://www.dhirajweb.dev/blog/website-maintenance-cost-india | 2026 |
| S30 | Opsio, AWS managed services cost 2026 | https://opsiocloud.com/knowledge-base/aws-managed-services-cost-pricing/ | 2026 |
| S31 | Fractional CTO cost 2026 (Groovy Web; CTO on Demand) | https://www.groovyweb.co/blog/fractional-cto-cost-2026-pricing-guide ; https://ctoondemand.com/fractional-cto-cost | 2026 |
| S32 | Tally and Zoho integration guide for Indian SMEs; e-invoicing ERP integration | https://pragyantra.com/blog/tally-zoho-integration-guide-india ; https://www.patronaccounting.com/e-invoicing-for-erp-and-billing-software-integration | 2026 |
| S33 | Power BI consulting cost 2026 (Perceptive Analytics; Lets-Viz) | https://www.perceptive-analytics.com/how-much-does-a-power-bi-consultant-cost-2026-pricing-guide/ ; https://lets-viz.com/blogs/power-bi-consulting-cost | 2026 |
| S34 | MIT Technology Review, "AI coding is now everywhere…" (Stack Overflow 2025 trust data) | https://www.technologyreview.com/2025/12/15/1128352/rise-of-ai-coding-developers-2026/ | 2025-12-15 |
| S35 | METR RCT summary (ScienceBlog / ActuIA) | https://scienceblog.com/t-a-randomized-trial-by-metr-found-that-experienced-developers-completed-real-coding-tasks-19-slower-when-allowed-to-use-ai-tools-yet-afterwards-they-estimated-on-average-that-ai-had-made-them-20-fast/ | 2025 |
| S36 | AI coding tool pricing 2026 (daily.dev; Digital Applied) | https://daily.dev/blog/ai-coding-tools-cost-cursor-vs-copilot-vs-claude-code-pricing/ ; https://www.digitalapplied.com/blog/ai-coding-agent-cost-calculator-10-tools-2026 | 2026 |
| S37 | Digital Applied, "Clients want a share of your AI savings" | https://www.digitalapplied.com/blog/clients-want-share-of-ai-savings-agency-pricing | 2026 |
| S38 | SecondTalent, cost to hire freelance developers in India | https://www.secondtalent.com/cost-to-hire/india/ | 2026 |
| S39 | Regional rates (Qubit Labs; Conduct HQ Australia; Decipher Zone UAE; Lemon.io) | https://qubit-labs.com/average-hourly-rates-offshore-development-services-software-development-costs-guide/ ; https://www.conducthq.com/journal/how-much-does-software-development-cost-in-australia/ ; https://www.decipherzone.com/blog-detail/custom-software-development-cost-uae ; https://lemon.io/rate-calculator/germany/ | 2026 |
| S40 | SaaS MVP cost ranges (DevsAndLogics; DesignRevision) | https://devsandlogics.com/guides/saas-mvp-development-cost-2026 ; https://designrevision.com/blog/how-much-does-it-cost-to-build-a-saas | 2026 |
| S41 | WP Buffs plans | https://wpbuffs.com/plans/ | 2026 |
| S42 | Awesomic unlimited dev subscription; Fitr Media unlimited Webflow; Flowout pricing | https://www.awesomic.com/blog/unlimited-development-subscription-why-is-it-worth-it-for-scaleups-and-enterprises ; https://www.fitrmedia.com/posts/unlimited-webflow-development-how-it-works-pricing-and-top-providers ; https://www.flowout.com/pricing | 2026 |
| S43 | MSME statistics 2026 (DataRank India; IBEF) | https://datarankindia.com/india-msme-statistics/ ; https://www.ibef.org/news/over-7-83-crore-enterprises-registered-on-udyam-platforms-indicating-strong-msme-formalisation-growth | 2026 |
| S44 | World MSME Day 2026 / India Digital Procurement Report (The Wire / PTI) | https://m.thewire.in/article/ptiprnews/world-msme-day-2026-5-in-10-msmes-continue-to-face-supplier-management-invoice-compliance-price-volatility-and-credit-challenges-digital-procurement-adoption-accelerating/amp | Jun 2026 |
| S45 | WhatsApp Business API pricing India 2026 (MyOperator; Monty Mobile) | https://myoperator.com/blog/whatsapp-business-api-pricing-india-2026 ; https://montymobile.com/blogs/whatsapp-business-api-pricing-in-india-inr-rates-gst-and-the-2026-currency-migration-deadline/ | 2026 |
| S46 | GCC digital transformation market; Morgan Lewis UAE/KSA tech markets | https://www.marknteladvisors.com/research-library/gcc-digital-transformation-market.html ; https://www.morganlewis.com/blogs/sourcingatmorganlewis/2025/12/opportunities-and-challenges-in-the-tech-markets-of-the-uae-and-saudi-arabia | 2025-12 / 2026 |

**Caveats**
- Most price benchmarks come from agency or vendor blogs with SEO incentives. They are useful for ranges, not precise figures.
- Clutch has no figure for the UK.
- Indian project-level pricing for MVPs, apps and BI is researcher inference, extrapolated from Indian hourly rates and website-pricing guides.
- Figures were gathered via search snippets and selective page fetches. They were not independently audited.
