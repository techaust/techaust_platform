# 07-A: Legal page drafts (privacy, terms, refunds, delivery, cookies, security, accessibility)

| | |
|---|---|
| **Status** | **Draft v0.1 (2026-10-06). VERIFY WITH CA/LEGAL.** You asked me to draft these myself without a lawyer. They follow the research in [08-B](../08-research-appendix/B-dpdp-legal.md), but I am not a lawyer and this is not legal advice. An optional one-hour lawyer review ([08 §7.3](../08-security-compliance.md)) is your decision before launch. |
| **Placeholders** | `{{postal_address}}` (🟧 OWNER) · `{{effective_date}}` (set at launch) · `privacy@`/`security@` aliases (🟧 OWNER creates them in Zoho) |
| **Identity rule** | Owner decision: legal pages name "TecHaust Technologies, a sole proprietorship based in Balurghat, West Bengal" and the Grievance Officer **Rupak Sarkar (Founder)**. **No GSTIN on the website.** |
| **Website notice** | Each page shows "Version X · Effective {{date}}" and a short changelog at the bottom. |

---

## 1. Privacy notice (`/privacy`)

### Summary (shown first, in a box)
- **Who we are:** TecHaust Technologies, a sole proprietorship based in Balurghat, West Bengal, India. We build software and automation for businesses.
- **What we collect:**
  - what you send us (name, work email, company, phone, project details)
  - what our systems need to work (technical logs, security checks)
  - for clients, what we need to deliver and bill (contacts, documents, invoices, payment records)
- **Why:** to answer you, prepare proposals, deliver and support our work, bill and get paid, keep our systems secure, and meet legal duties such as GST record-keeping.
- **Who sees it:** our team, and service providers that host, email or process payments for us (listed below). **We don't sell personal data.**
- **Your choices:** analytics cookies only with your consent; marketing emails only if you opt in; you can ask us to access, correct or delete your data.
- **Contact:** Rupak Sarkar, Founder (Grievance Officer) · privacy@techaust.com.

### 1. Who is responsible for your data
TecHaust Technologies ("TecHaust", "we") is a sole proprietorship based at {{postal_address}}, India. For data about our website visitors, enquirers and our clients' contacts, we decide how and why it is used. Under India's Digital Personal Data Protection Act, 2023 that makes us the **Data Fiduciary**; under the GDPR/UK GDPR, the **controller**.

When we build or run systems **for** a client that contain the client's customers' or staff's data, the client is responsible for that data and we act on their instructions (as a **Data Processor**). Our client contracts cover that separately.

### 2. What we collect and why

| Who you are | Data | Why we use it | Basis (India / EU-UK) |
|---|---|---|---|
| **Website visitor** | IP address, browser and device details, pages visited (cookieless Cloudflare Web Analytics); Cloudflare Turnstile security signals | Run and secure the website; understand overall usage | India: provided voluntarily by using the site for that purpose (DPDP s.7(a)). EU/UK: legitimate interests (VERIFY WITH CA/LEGAL) |
| **Visitor who accepts analytics** | Google Analytics identifiers and usage events | Understand which pages help visitors | **Consent** (withdraw at any time via "Cookie settings") |
| **Enquirer** (contact or quote form, email, WhatsApp, booking) | Name, work email, company, country, phone/WhatsApp (optional), project details, budget band, timeline, preferred call time, the page you came from | Reply, assess fit, prepare a proposal | Information you provide voluntarily for that purpose (DPDP s.7(a)) / steps before a contract, legitimate interests |
| **Newsletter subscriber** (only if you tick the box) | Email, name, consent record | Occasional updates (about one a month) | **Consent** |
| **Client contact** | Name, title, work email, phone, portal sign-in activity, messages and files you share, proposal acceptance details (typed name, time, IP address, browser), billing details (company name, address, GSTIN), payment status and references | Deliver services, give portal access, invoice, collect payment, keep records | India: provided voluntarily for that purpose (DPDP s.7(a)); **legal obligation** for tax records. EU/UK: contract; **legal obligation** for tax records (VERIFY WITH CA/LEGAL) |
| **Everyone** | Security logs (sign-ins, access to admin and portal, IP address, time) | Protect accounts and data; investigate incidents | Legal obligation and security |

**We never collect or store card numbers, UPI PINs or bank passwords.** Payments happen on our payment providers' secure pages.

### 3. Who we share it with
We use these service providers ("processors"). Each receives only what it needs:

| Provider | What for | Where |
|---|---|---|
| Cloudflare, Inc. | Website and application hosting, database, file storage, security (Turnstile), cookieless analytics | Global network (including the USA and EU) |
| Amazon Web Services (SES, S3) | Sending email; encrypted backups | India (Mumbai region) |
| Razorpay Software Pvt Ltd | Payments in INR | India |
| Stripe (if used) | Card payments in USD | USA / global |
| PayPal | Payments in USD | Global |
| Google (Analytics) | Website analytics, **only with your consent** | USA / global |
| Zoho Corporation | Our email inbox | India |
| Cal.com | Call booking (if you use the booking link) | USA / EU |
| Meta Platforms (WhatsApp) | Messages you exchange with us on WhatsApp, if you choose to contact us there | USA / global |
| Sentry | Error monitoring (personal data removed where possible) | USA |

We may also disclose information when the law requires it, or to protect our rights in a legal dispute.

### 4. Data stored outside India
Some providers store data outside India. Indian law currently permits this, as the Government has not restricted transfers to these countries (VERIFY WITH CA/LEGAL). For visitors and clients in the EU or UK, we rely on our providers' standard contractual clauses or equivalent safeguards.

### 5. How long we keep it

| Data | How long |
|---|---|
| Enquiries that don't become projects | 12 months after our last contact, then deleted |
| Client records, proposals, invoices, payment records | At least 8 years after the end of the financial year (GST and tax law); our default is 10 years |
| Security and access logs | 13 months |
| Email delivery records | 13 months |
| Analytics (Google, with consent) | 14 months (Google's setting) |
| Newsletter consent | Until you unsubscribe, plus proof of consent for 3 years after (VERIFY WITH CA/LEGAL) |
| Backups | Rolling encrypted backups are kept for up to 90 days, so deleted data disappears from them within 90 days. Long-term archive copies hold only invoices, payments and other tax records (8–10 years, as above), never enquiries or contact lists |

If the law requires us to keep something longer (for example, during a dispute), we keep it only for that purpose.

### 6. How we protect it
- Encryption in transit (HTTPS) and at rest.
- Two-factor sign-in for our staff, and role-based access.
- Audit logs of who accessed or changed records.
- Encrypted, off-site backups.
- Written agreements with our providers.

No system is perfectly secure. If a breach affects you, we will tell you and the authorities as the law requires.

### 7. Your rights
You can ask us to:
- **access** a summary of your personal data and how we use it
- **correct, complete or update** it
- **erase** it, where we don't need to keep it by law
- **withdraw consent** (as easily as you gave it; this doesn't affect what we did before)
- **nominate** someone to exercise your rights if you die or become unable to

Email **privacy@techaust.com**, or use "Request my data" in the client portal. We may need to confirm your identity. We acknowledge requests within 48 hours and respond within 30 days.

### 7a. If you are in the EU or UK (VERIFY WITH LEGAL)
- **Who controls your data:** TecHaust Technologies (Rupak Sarkar, proprietor), {{postal_address}}, India · privacy@techaust.com.
- **Extra rights under the GDPR / UK GDPR:** you can also ask us to **restrict** how we use your data, to give it to you in a **portable** format, and you can **object** to our use of it based on legitimate interests, and to direct marketing at any time.
- **Our legitimate interests** (where the table above says so): keeping the website secure and free of abuse, replying to business enquiries, and keeping proper business records.
- **Automated decisions:** we don't make decisions about you by purely automated means.
- **Representative:** we haven't appointed a representative in the EU or UK (VERIFY WITH LEGAL whether one is needed for our level of activity).
- **Transfers:** see section 4.

**Complaints:** please contact our Grievance Officer first (below). If you're not satisfied, you can complain to the **Data Protection Board of India** once its complaint process is available. In the EU/UK, you can complain to your local data-protection authority (in the UK, the ICO).

### 8. Grievance Officer and privacy contact
**Rupak Sarkar**, Founder, TecHaust Technologies · privacy@techaust.com · {{postal_address}}.

We acknowledge complaints within 48 hours and aim to resolve them within one month.

### 9. Cookies
See our [Cookie policy](/cookies). You can change your choice at any time with "Cookie settings" in the footer.

### 10. Children
Our services are for businesses. We don't knowingly collect data from children (under 18).

### 11. Languages
This notice is available in English. If you'd like it in Hindi, Bengali or another language listed in the Eighth Schedule to the Constitution of India, email us and we'll provide it. (VERIFY WITH CA/LEGAL)

### 12. Changes
We'll post changes here and update the date. For significant changes affecting clients, we'll email you.

*Version 0.1 · Effective {{effective_date}}*

---

## 2. Website terms of use (`/terms`)

1. **About these terms.** These terms apply to your use of techaust.com and our client portal. The site is run by TecHaust Technologies, a sole proprietorship based at {{postal_address}}, India. By using the site, you agree to these terms.
2. **Information, not an offer.** The site describes our services. Prices marked "from" are **indicative starting prices for the minimum scope described**. Every engagement is agreed in a **written proposal** (and, where used, a master services agreement). If anything on this site conflicts with your proposal or contract, the proposal or contract wins.
3. **Prices and tax.** Prices for clients in India **exclude GST**, which is added at the applicable rate. Prices for international clients are in USD and are invoiced from India (VERIFY WITH CA).
4. **Examples and results.** Diagrams and demos marked "Illustrative" are examples, not real client systems. Case studies describe specific projects. Your results depend on your circumstances.
5. **Our content.** The text, design, code and graphics on this site belong to TecHaust or its licensors. You may view and share pages for personal or internal business use. You may not copy, scrape or republish them without permission. Third-party names and logos belong to their owners.
6. **Acceptable use.** Don't:
   - attack, overload or probe the site, except as allowed by our [security policy](/security)
   - submit spam or automated form entries
   - bypass security checks
   - upload malware
   - use the site unlawfully
7. **Client portal.** Access is for authorised contacts of our clients. Keep sign-in links private and don't forward them. You're responsible for files you upload: you confirm you have the right to share them and that they contain no malware. **Accepting a proposal in the portal (typing your name and clicking Accept) forms a binding agreement** on the terms of that proposal, and we keep a record of it (name, email, time, IP address, browser and a fingerprint of the document).
8. **Third-party links.** We aren't responsible for other websites we link to.
9. **No warranty for the website.** The site is provided "as is". We try to keep it accurate and available, but we don't promise it will be error-free or uninterrupted.
10. **Liability.** To the extent the law allows, we aren't liable for indirect or consequential losses from using this website, and our total liability for use of the website is limited to ₹10,000. Liability for services is governed by your proposal or contract. Nothing here limits liability that can't be limited by law, such as liability for fraud. (VERIFY WITH CA/LEGAL)
11. **Privacy.** See our [Privacy notice](/privacy) and [Cookie policy](/cookies).
12. **Law and courts.** These terms are governed by the laws of India. The courts at **Balurghat, Dakshin Dinajpur, West Bengal** have exclusive jurisdiction, subject to any dispute-resolution clause in a signed contract. (VERIFY WITH CA/LEGAL: Balurghat vs Kolkata; arbitration for client contracts goes in the MSA.)
13. **Changes.** We may update these terms. The version and date below show the current one.
14. **Contact.** contact@techaust.com · Grievance Officer: Rupak Sarkar, Founder, privacy@techaust.com.

*Version 0.1 · Effective {{effective_date}}*

---

## 3. Refunds & cancellations (`/refund-policy`)

> This policy summarises our standard terms. Your proposal may set different terms for your project, and if so, the proposal applies. (VERIFY WITH CA/LEGAL)

1. **Fixed-price projects**
   - **Advance (usually 40 %):** reserves our team's time and pays for planning. If you cancel **before work starts**, we refund it in full, minus any third-party costs we've already paid for you. Once work has started, the advance covers work done and is not refundable.
   - **Milestone payments** are earned when the milestone is delivered. A milestone counts as accepted if you approve it, or if you don't raise specific issues within **7 business days** of delivery.
   - **If you cancel mid-project:** you pay for work done up to cancellation plus committed third-party costs. We refund any payment for work not yet done.
   - **If we cancel or can't deliver:** we refund everything paid for undelivered work.
2. **Small fixed jobs** (Discovery Sprint, audits, single workflows; paid upfront): fully refundable if cancelled before the kick-off call; after kick-off, refundable only for work not yet done.
3. **Care plans, retainers and subscriptions** (billed monthly in advance): cancel any time with **30 days' written notice** (email is fine). No refund for a month that has started, except where we failed to provide the service. Unused hours don't carry over (except as stated in your plan).
4. **How to ask:** email billing@techaust.com or use the portal. We acknowledge within 48 hours and decide within 14 days.
5. **How refunds are paid:** to the **original payment method** (as payment rules require), within 5–7 business days of approval. Banks and card networks may take longer. Refunds are made in the currency you paid. Exchange-rate differences aren't covered. Payment-gateway fees aren't charged to you.
6. **GST:** for Indian invoices, a refund is documented with a **credit note**. (VERIFY WITH CA)
7. **Disputes:** please contact us first. We'd rather fix the problem. This doesn't affect your rights with your bank or card provider.
8. **Contact:** billing@techaust.com · {{postal_address}}.

*Version 0.1 · Effective {{effective_date}}*

---

## 4. Delivery policy (`/delivery-policy`)

1. **What we deliver:** software, designs, documents, automations and services. **Nothing is shipped physically.**
2. **How:** through our client portal, by email, in code repositories (such as GitHub) under your account or transferred to it, or by deploying to hosting you choose.
3. **When:** timelines and milestones are set out in your proposal. We update you weekly and tell you promptly if a date is at risk.
4. **Acceptance:** each milestone is reviewed by you, as described in our [Refunds & cancellations](/refund-policy) policy.
5. **Access and ownership:** on full payment, ownership of the deliverables passes to you as stated in your proposal.
6. **Questions:** contact@techaust.com.

*Version 0.1 · Effective {{effective_date}}*

---

## 5. Cookie policy (`/cookies`)

**What cookies are.** Small files or browser storage that a website uses to remember things.

**Our approach.** Our website works without analytics cookies. We use Cloudflare Web Analytics, which doesn't use cookies, to count visits. **Google Analytics loads only if you click "Accept analytics".**

| Name | Provider | Purpose | Type | Duration |
|---|---|---|---|---|
| `ta_consent` (browser storage) | TecHaust | Remembers your cookie choice | Necessary | 12 months |
| `ta_theme`, `ta_currency` (browser storage) | TecHaust | Remember light/dark theme and ₹/$ choice | Necessary (preferences) | Until cleared |
| Turnstile (`cf_*`, if set) | Cloudflare | Protects forms from bots | Necessary | Session |
| `_ga`, `_ga_<id>` | Google | Analytics (only after consent) | Analytics | Up to 2 years (GA4 default) |
| `__Host-ta_portal` | TecHaust | Keeps you signed in to the client portal | Necessary | Up to 90 days |
| `__Host-ta_admin` | TecHaust | Keeps staff signed in to the admin | Necessary | Up to 7 days |

**Your choice.** Use "Cookie settings" in the footer to accept or reject analytics at any time. Rejecting is as easy as accepting. You can also delete cookies in your browser. We record your choice (and when you made it) so we can show we respected it.

*Version 0.1 · Effective {{effective_date}}*

---

## 6. Security & responsible disclosure (`/security`)

**How we protect our systems.** HTTPS everywhere, two-factor sign-in for staff, role-based access, audit logs, encrypted off-site backups and regular updates. We keep these claims modest and true.

**Found a vulnerability?** Email **security@techaust.com** with:
- what you found
- where (URL or endpoint)
- steps to reproduce
- any proof-of-concept

We acknowledge within 3 business days.

**In scope:** techaust.com, portal.techaust.com, admin.techaust.com (the login page only; no brute-force attempts), hooks.techaust.com.

**Out of scope:** third-party services we use (Cloudflare, Razorpay, Stripe, PayPal, Google, Zoho), denial-of-service, spam, social engineering and physical attacks.

**Rules:**
- Test only against your own accounts and data.
- If you see anyone else's personal data, stop and tell us. Don't access, change or keep it.
- Give us 90 days to fix the issue before you disclose it publicly.

**Safe harbour:** if you act in good faith and follow this policy, we will treat your research as authorised, we won't pursue or support legal action against you, and we'll work with you to fix the issue quickly. This policy can't bind third parties or the authorities. We don't offer paid bounties at this time. You may also report through CERT-In's vulnerability disclosure programme. (VERIFY WITH CA/LEGAL)

**`/.well-known/security.txt`:**
```text
Contact: mailto:security@techaust.com
Expires: {{one year from launch, ISO 8601}}
Preferred-Languages: en
Policy: https://techaust.com/security
Canonical: https://techaust.com/.well-known/security.txt
```

*Version 0.1 · Effective {{effective_date}}*

---

## 7. Client data-processing note (attached to proposals; not a website page)

A one-page schedule attached to proposals where we handle the client's personal data. It is based on [08-B checklist F](../08-research-appendix/B-dpdp-legal.md) and covers:
- **roles:** client = Data Fiduciary/controller; TecHaust = Data Processor
- **instructions only:** we process data only as the client instructs
- **staff confidentiality**
- **security measures**
- **sub-processor list**, with notice of changes
- **breach notice to the client** without undue delay (target 24 hours from confirmation) with what the client needs for its own 72-hour reports
- **help with rights requests**
- **deletion or return within 90 days** of the end of the engagement, subject to legal retention
- **international transfer safeguards** for EU/UK clients
- **liability** follows the main contract

**Full text is drafted in the proposals milestone** (Phase 6 M4). VERIFY WITH CA/LEGAL.

---

## 8. Accessibility statement (`/accessibility`)

*Draft. VERIFY WITH CA/LEGAL. Source: [08 §7.3 L-15](../08-security-compliance.md) and [04 WEB-G-16](../04-prd.md).*

**Our aim.** We build techaust.com, the client portal and the admin to meet the Web Content Accessibility Guidelines (WCAG) 2.2, level AA.

**What we do.**
- Every page works with a keyboard alone, with visible focus, a skip link and labelled forms.
- Colours are checked against contrast requirements in the build, and information is never shown by colour alone.
- Tap and click targets are at least 44 × 44 pixels, and motion respects your "reduce motion" setting.
- We test with automated checks (axe) and with a manual keyboard and screen-reader (NVDA) pass before launch.
- Proposals, invoices and other PDFs are tagged where our PDF renderer allows it.

**Known gaps.** None recorded yet. When we find one we will list it here with a date and say when we expect to fix it.

**Tell us.** If something on our site or in a document is hard to use, email contact@techaust.com. We reply within one business day, and we will give you the information in another format if you ask.

*Version 0.1 · Effective {{effective_date}}*
