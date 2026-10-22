# 07-D: Copy for the M2.3 pages that 07 doesn't have yet

_Drafted by the lead on 2026-10-22 for the industry pages and How we work ([07 §5.2, §5.5](../07-content.md)); **Approved by the owner on 2026-10-22, including every 🟧 line.** The pages show this text word for word; 07 §5 points here._

**Notes:**
- Every answer uses only facts that are already approved (07, 07-C, the claims register 07 §1.4, decisions). No client names, numbers or results.
- 🟧 marks lines that state something new about how TecHaust works: please confirm each one.
- `{{price:…}}` shows the live catalogue price on the page.

---

## 1. Industries hub (`/industries`)
H1 and lede are in 07 §5.2. One card per industry, with the page's H1 as the card text and these labels:
- **Finance, Accounting and Legal:** "CA firms, finance teams and legal practices"
- **Retail, E-commerce and Logistics:** "Online sellers, distributors and logistics teams"
- **SaaS and Startups:** "Founders and software companies"

Closing line: "Work in another sector? Most of what we build applies anywhere there's paperwork, a spreadsheet or two systems that don't talk. Tell us about yours."

## 2. Finance, Accounting and Legal (`/industries/finance-accounting-legal`)
**The problems we see** (section label "What slows teams down"):
- "Invoices and bank statements typed into Tally or Zoho by hand, then checked again at month end."
- "GSTR-2B mismatches found late, when there's little time left to chase vendors."
- "Client documents arriving by email, WhatsApp and pen drive, with no single list of what's still missing."
- "Contract renewal dates and key clauses kept in someone's memory or a spreadsheet."

**Tools we connect** (section label "Works with"): Tally Prime · Zoho Books · QuickBooks · Xero · GST e-invoicing (via a GST Suvidha Provider) · WhatsApp Business · Excel and Google Sheets

**FAQ** (the 2 in 07 §5.2, then):
3. **Can it work with Tally on a local PC?** "Yes. A small connector runs on that PC or your server and syncs over the internet; Tally needs to be running for the sync, and an alert tells you if it stops."
4. **What happens when the AI isn't sure about a document?** "It goes to a review screen, and a person on your team checks it before anything is posted. In the pilot we measure how many documents need review, so you know before rollout."
5. **Where is our clients' data kept?** "In your own cloud account or ours, with hosting in India where your data needs to stay here. We document every system that touches it." 

## 3. Retail, E-commerce and Logistics (`/industries/retail-ecommerce-logistics`)
**The problems we see:**
- "Orders arrive on WhatsApp, the website and by phone, and someone copies each one into the billing system."
- "Stock in Shopify and stock in Tally or Zoho disagree by the end of the week."
- "Delivery proofs and freight invoices pile up as photos and PDFs that nobody has time to check."
- "Dealers phone in orders because there's no simple way for them to order themselves."

**Tools we connect:** Shopify · Tally Prime · Zoho Books and Zoho Inventory 🟧 · WhatsApp Business Platform · Razorpay · Cashfree · GST e-invoicing and e-way bills (via a GST Suvidha Provider)

**FAQ:**
1. **Can customers order and pay on WhatsApp?** "Yes. A WhatsApp flow can take the order, send a payment link and confirm it, with a person able to take over any chat."
2. **Will Shopify and our accounts stay in sync?** "We build a connector between Shopify and Tally or Zoho, with monitoring that alerts you and shows what failed if a sync doesn't go through."
3. **Can you read delivery proofs and freight invoices?** "Yes. Fields are extracted and checked, and anything the system isn't sure about goes to a person for review."
4. **Do we need a new WhatsApp number?** "Not always. An existing number can usually move to the WhatsApp Business Platform, but it then stops working in the regular WhatsApp Business app, so many businesses use a new number. We check your case before setup."
5. **What does it cost?** "Integrations are from {{price:S14}} per connector and WhatsApp automation from {{price:S11}}. You get a fixed quote in writing before work starts."

## 4. SaaS and Startups (`/industries/saas-startups`)
**The problems we see:**
- "A prototype built fast that now needs to hold up with real users, real data and real payments."
- "A roadmap with AI on it, and no one on the team who has shipped AI features to production."
- "More product work than the team can take on, but not enough steady work to hire."
- "Technical decisions being made without a senior engineer in the room."

**What we work with** (section label "Stacks we use"): React and TypeScript · React Native and Flutter · Cloudflare, AWS and other clouds 🟧 · Stripe and Razorpay · MCP servers for ChatGPT, Claude and Copilot

**FAQ:**
1. **Can you work with our in-house developer?** "Yes. We share the repository, review each other's code, and agree in the plan who owns which parts."
2. **Do you take equity?** "No. We work for fees, so incentives stay simple."
3. **Can you fix an app built with AI tools?** "Yes. We start with an App Rescue audit: a written report and a risk-ranked fix list, before anything changes."
4. **Do you work in our time zone?** "We're in India (IST, UTC+5:30) and keep 3–4 hours of overlap with UK and European working days, and with US East-coast mornings by arrangement."
5. **Who owns the code?** "You do. The code, documentation and IP transfer to you on full payment."

## 5. How we work (`/how-we-work`): the four steps, expanded
Each step keeps its Home title and line (07 §3), followed by:
1. **Discover.** "For larger projects, a Discovery Sprint ({{price:S1}}, 1–2 weeks) maps how the work is done today, the systems involved and the data, and ends with a costed plan and a fixed quote. The fee is credited to your build if you go ahead within 60 days. Smaller jobs start with a free call."
2. **Plan and price.** "The proposal sets out the scope, what you'll receive, the timeline, the fixed price and the payment schedule. You accept it online, and nothing starts until you do." 🟧 (online acceptance arrives with the client portal; until then "You accept it in writing")
3. **Build in the open.** "You get a staging link in the first week and a demo every sprint, with a weekly written update in between. Changes to the scope are quoted before we do them, and you decide."
4. **Launch and look after it.** "We launch together, hand over the code, documentation and access, and fix defects in what we delivered free for 30 days. After that, a care plan keeps it monitored, patched and backed up."

**After launch** (section 9): "Software needs looking after: dependencies age, vendors change their systems, and small changes keep coming. Care plans cover monitoring, security patches, backups, small changes and a named response time, from {{price:S16-essential}} a month." Link: "Compare care plans"

## 6. Blog (`/blog`) before the first post is approved
"Our first articles are on their way: practical guides on Tally automation, GST e-invoicing and automation audits." (No list, no RSS items.)
