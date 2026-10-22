# 07-C: Service-page FAQs

_Drafted by the lead on 2026-10-22 for the 12 service pages that had fewer than the 4 FAQs WEB-SVC-04 asks for ([07 §4](../07-content.md)); **approved by the owner on 2026-10-22, including every 🟧 answer.** These are the FAQs the pages show (`apps/web/src/content/services/*.ts`); 07 §4 points here._

**Notes:**
- Every answer uses only facts that were already approved (07, 02, decisions). Questions already in 07 keep their wording.
- 🟧 marks the answers the owner confirmed on 2026-10-22 (they state how TecHaust works and weren't written down before).
- `{{price:…}}` shows the live catalogue price on the page.

---

## S5 · Custom Web Apps and Business Portals
1. **Can it work on phones?** "Yes. Everything we build works on phones and tablets in the browser. If you also need an app in the stores, we build it alongside (see Mobile Apps)."
2. **Where is it hosted?** "In your own cloud account, or in ours while you're on a care plan. Hosting in India is available where your data needs to stay here."
3. **Can you take over an existing app?** "Yes. We start with an App Rescue audit, so you know what you have before anything changes."
4. **Who owns it?** "You do. The code, documentation and access transfer to you on full payment."
5. **How long does it take?** "Typically 6–14 weeks, depending on scope. The timeline is in the written proposal, with a demo every fortnight."

## S6 · MVP and SaaS Product Development
1. **Can you work with our in-house developer?** 🟧 "Yes. We share the repository, review each other's code, and agree in the plan who owns which parts."
2. **What if scope changes mid-sprint?** "We re-prioritise within the sprint, or quote the change before we do it."
3. **Do you take equity?** "No. We work for fees, so incentives stay simple."
4. **Will you sign our contract?** "Usually yes, after a review. We also have a standard MSA."
5. **Who owns the code?** "You do. The code, documentation and IP transfer to you on payment."

## S7 · Mobile Apps
1. **React Native or Flutter?** "Whichever fits your team and existing code; we use both."
2. **Do you publish to the stores?** "We prepare and submit under your developer accounts."
3. **Do we also need a web app?** "Not always, but most apps need a back end and an admin screen. We usually build them together, so everything shares one system."
4. **Who owns the app?** "You do. It's listed under your developer accounts, and the code transfers to you on full payment."
5. **What happens after launch?** "A 30-day warranty for defects against the agreed scope, then an optional care plan for monitoring, updates and small changes."

## S10 · Workflow Automation and AI Agents
1. **n8n, Make or custom code?** 🟧 "Whichever fits the job and your team: n8n or Make for flows your team may want to adjust themselves, custom code where volume, reliability or a missing connector calls for it. The workflow map explains the choice."
2. **Who owns the accounts?** "You do; we build in your workspace."
3. **What happens when an API changes?** "Alerts tell us; on a care plan we fix it."
4. **What's in a Quick-Win bundle?** "3–5 small automations delivered together for one quoted price: the fastest way to see what automation can do for you."
5. **How is it priced?** "From {{price:S10}} per workflow. Quick-Win bundles are quoted, and monitoring plus new workflows can run on a monthly retainer."

## S11 · WhatsApp Business Automation
1. **Do we need a new number?** 🟧 "Not always. An existing number can usually move to the WhatsApp Business Platform, but it then stops working in the regular WhatsApp Business app, so many businesses use a new number. We check your case before setup."
2. **Can a person take over a chat?** "Yes. Any chat can be handed to someone on your team, with the conversation so far in front of them."
3. **What does Meta charge?** "Per message, by category and country; we show you the current rates before you start."
4. **Which provider do you use?** "An official Meta Business Solution Provider, chosen for your volume and needs."
5. **Can it connect to our order or billing system?** "Yes. The flows read and update your order, billing or CRM system, so customers get current order status and payment links."

## S12 · AI Knowledge Assistants
1. **Can people see documents they shouldn't?** "It's built so they can't: access control means each person only gets answers from documents they're allowed to see."
2. **How do we know the answers are right?** "Every answer shows its sources, one click away, and we measure quality on a test set of your own questions before and after every change. When the sources don't cover a question, it says it doesn't know."
3. **Can it run in India or on our own servers?** "Yes. India-hosted and on-premises options are available where you need them."
4. **What about model and API costs?** "They're passed through at cost, with no mark-up. Once it's live, AI Ops tracks the costs each month."
5. **Does it work in Indian languages?** 🟧 "Yes, for the languages your documents and users need; we test them in the pilot."

## S13 · AI Features for Your Software
1. **What is an MCP server?** "A standard way for AI assistants such as ChatGPT, Claude and Copilot to use your product's features and data, with your permissions. We build one so your product works inside them."
2. **How do you decide where AI helps?** "We start with feature discovery: where AI actually saves your users time, and where it doesn't. You see that before we build anything."
3. **How do you keep AI costs under control?** "Evaluation and cost controls are part of the build: we measure quality and usage, and set limits so costs stay predictable."
4. **Which AI models do you use?** "Chosen per project for accuracy, cost and data-handling terms; we never let providers train on your data where an opt-out exists."
5. **Who owns the code?** "You do. The code and documentation transfer to you on full payment."

## S14 · Business Systems Integration
1. **Do you need our Tally licence?** 🟧 "We work with your existing Tally and its licence; you don't buy anything new from Tally for the integration."
2. **Is GST e-invoicing mandatory for us?** "It depends on your turnover; your CA confirms it. We build the integration either way." (VERIFY WITH CA)
3. **What if Tally is on a local PC?** 🟧 "That's common. A small connector runs on that PC or your server and syncs over the internet; Tally needs to be running for the sync, and an alert tells you if it stops."
4. **What happens if a sync fails?** "Monitoring raises an alert and shows what failed, so it can be corrected and sent again."
5. **Who looks after it afterwards?** "A care plan. Vendors change their systems, and someone has to notice: on a plan, we monitor the sync and fix breakages."

## S2 · App Rescue and Production-Readiness Audit
1. **What kinds of apps do you audit?** "Apps built quickly with AI tools (such as Lovable, Bolt or Cursor), by freelancers or by a past team, and older apps that have become fragile."
2. **Is this a penetration test?** "No. It's an engineering review of code, security and performance. If you need a formal penetration test, we'll recommend a specialist."
3. **What do we get at the end?** "A written report and a risk-ranked fix list, with an optional fixed-price hardening sprint for the most important items."
4. **Do we have to use you for the fixes?** 🟧 "No. The report and fix list are yours; your own team or another vendor can work from them."
5. **What does it cost?** "The audit is from {{price:S2}}; the hardening sprint is quoted from the findings."

## S4 · Fractional CTO
1. **Who will we work with?** "Our founder, personally."
2. **How many hours a month?** 🟧 "A fixed number agreed up front, usually between 8 and 20 hours a month."
3. **Can you help us hire developers?** "Yes: job specs, interview questions, and interviews alongside you."
4. **Can you review our outsourced team's work?** "Yes. Vendor and code-quality reviews are part of the role, with the findings in your monthly written report."
5. **How do we stop?** "It's a monthly retainer with 30 days' notice to stop."

## S16 · Care Plans
1. **What counts as a critical issue?** 🟧 "Your site or app is down, or a core function such as sign-in, payments or orders isn't working for your users."
2. **Do you offer out-of-hours cover?** "Response times are in business hours (Mon–Sat, 10:00–19:00 IST). Out-of-hours cover can be quoted separately."
3. **What happens to unused hours?** "On Essential they don't roll over. On Growth and Scale they roll over for one month. Extra hours are billed at the plan rate."
4. **Can you look after software someone else built?** 🟧 "Yes, usually after an App Rescue audit, so we both know what we're taking on."
5. **Can we pay annually?** "Yes: pay annually and save 10 %. Otherwise plans are billed monthly in advance, and you can cancel with 30 days' notice."

## S18 · Dev Subscription
1. **How does the queue work?** "Add as many requests as you like. We work on one at a time, in your priority order, and ship each as soon as it's done."
2. **Can we pause or cancel?** "Yes, any month."
3. **Is it right for a fixed-deadline project?** "No. For a fixed scope and deadline, a fixed-price build fits better: see Custom Web Apps or MVP and SaaS Development."
4. **Who does the work?** "Senior engineers with 10+ years' experience, and the founder reviews the work."
5. **Are you taking new subscriptions?** "We take a small number at a time so quality stays high. If we're full, we'll tell you when the next opening is."
