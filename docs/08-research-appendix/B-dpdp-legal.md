# Appendix B: Indian data protection and website legal requirements (as of 6 October 2026)

> **VERIFY WITH CA/LEGAL. Everything in this document.** This is best-effort research to help us draft the website legal pages and to design the admin backend and client portal. It is not legal advice. Nobody on this project is a lawyer. A short paid review by an Indian lawyer (and the CA for GST and tax points) should happen before the pages go live.
>
> Conventions: **[?]** marks a fact I could not confirm from a primary source, or where sources disagree. "Checked 06-Oct-2026" means I opened the source on that date. "Not fetched" means the URL is the standard official location, but it did not load from this environment.

**Business context assumed:** TecHaust Technologies is a sole proprietorship in Balurghat (Dakshin Dinajpur, West Bengal). It is GST-registered and has a team of 2 to 5 people. It sells B2B software and AI-automation services to clients in India, the US, the UK, the EU and the Gulf. Systems: (1) a static marketing site with a quote form, Turnstile, Cloudflare Web Analytics, and GA4 loaded only after consent; (2) a staff admin backend; (3) a client portal with magic-link login, proposal acceptance, invoices and payments.

---

## TL;DR table

| # | Requirement | Applies to us? | What we build or write | Confidence | Source |
|---|---|---|---|---|---|
| 1 | DPDP Rules 2025 phased start | Yes. Core duties start **13 May 2027**. Consent-manager rule starts **13 Nov 2026** (does not affect us directly) | Build for DPDP now so we are ready by May 2027 | High | G.S.R. 846(E), Rule 1 |
| 1a | **IT Act s.43A + SPDI Rules 2011 still in force today** (until 13 May 2027) | **Yes, now** | Privacy policy on site; named Grievance Officer; reply to grievances within 1 month | High | SPDI Rules 4, 5(9); DPDP s.44(2) timing |
| 2 | Notice (s.5, Rule 3) | Yes (from May 2027; good practice now) | A notice that stands on its own: itemised data, purposes, how to withdraw, rights, how to complain to the Board; option for English or an Eighth Schedule language | High | DPDP s.5, s.6(3), Rule 3 |
| 3 | Consent or legitimate use (s.6 to 7) | Yes | Quote form, contracts and invoices rely on s.7(a) "voluntarily provided". GA4 and marketing email need **consent**. B2B work emails **are** personal data | Medium-High | DPDP s.4, 6, 7 |
| 4 | Rights and grievance (s.11 to 14, Rules 9, 14) | Yes | Rights-request form and portal button; published contact person; reply in 90 days or less under DPDP (aim for 30 days to cover SPDI and GDPR) | High | Rules 9, 14; SPDI 5(9) |
| 5 | Security safeguards (Rule 6) | Yes | Encryption, access control, access logs **kept 1 year**, backups, processor contracts | High | Rule 6 |
| 5a | Breach notice (Rule 7) | Yes (May 2027) | Tell affected people "without delay"; Board: brief notice without delay, then a **detailed report within 72 hours** | High | Rule 7 |
| 5b | CERT-In directions (2022) | **Yes, now** (a sole proprietorship is a "body corporate" under the IT Act definition) [?] | Report listed incidents **within 6 hours**; keep ICT logs for **180 days** (storage outside India is allowed if we can produce them); sync clocks to NIC/NPL time; register a Point of Contact | Medium-High | CERT-In Directions 28-Apr-2022 and FAQ Q35 |
| 6 | Retention and erasure (s.8(7), Rule 8) | Yes | Erase when the purpose ends. **Keep personal data and processing logs at least 1 year** (Rule 8(3)). Keep GST records **72 months**. The 3-year inactivity erasure rule does not apply to us | High | Rule 8, Third Schedule; CGST s.36 |
| 7 | Cross-border transfer (s.16, Rule 15) | Yes | Allowed. **No restricted-country list has been notified.** Cloudflare and US storage are fine for now; disclose them in the notice | High (as of today) | s.16, Rule 15 |
| 8 | Children (s.9, Rule 10) | Effectively no (B2B) | Add a "not for under-18s" clause; never build tracking or targeting aimed at children | High | s.9, Rule 10 |
| 9 | Penalties | Context | Up to ₹250 cr (security), ₹200 cr (breach notice or children), ₹50 cr (other) | High | DPDP Schedule |
| 10 | Cookies / GA4 | Yes (EU/UK strictly; DPDP by inference) | Banner with **Reject as easy as Accept**, nothing pre-ticked, categories, GA4 off by default (Consent Mode **basic**), a link to change the choice later | High for EU/UK; Medium for India | ePrivacy 5(3); ICO; EDPB taskforce |
| 11 | GDPR / UK GDPR | Likely **yes** when we target EU/UK clients (Art. 3(2)) | Add an EU/UK section to the notice (legal bases, transfers, rights, how to complain to a supervisory authority); decide on an Art. 27 representative | Medium | GDPR Art. 3, 13, 27; EDPB 3/2018 |
| 11a | US (CCPA etc.) | No (below every threshold) | One short "US residents" paragraph, optional | High | CPPA thresholds |
| 12 | Website Terms of Use | Yes (contract law) | Governing law India; courts at Balurghat (or Kolkata) [?]; IP, acceptable use, disclaimers on "starting from" prices and demos; liability cap | Medium | Contract Act; IT Act s.10A |
| 13 | Refund and cancellation; gateway pages | Yes (Razorpay requires the pages) | Pages: Terms, Privacy, Refund/Cancellation, Shipping/Delivery (digital), Contact Us, Pricing; refunds go to the original payment method | High | Razorpay docs; RBI PA Directions 2025 |
| 13a | **Stripe in India is invite-only** | **Yes, changes the design** | Do not depend on Stripe. Razorpay is the primary gateway; PayPal for cross-border only | High | Stripe India docs |
| 13b | E-Commerce Rules 2020 | Partly [?] (B2B buyers are mostly not "consumers") | Publish a Grievance Officer (name, contact, designation); acknowledge within 48 h, resolve within 1 month | Medium | CP (E-Commerce) Rules 2020 r.4 |
| 14 | Misleading ads and dark patterns | Yes | No fake urgency, fake scarcity or drip pricing; **"+ GST" shown next to every price**; claims and testimonials must be backed up | High | CPA 2019; CCPA 2022 and 2023 guidelines; ASCI |
| 15 | Click-to-accept proposals | Yes | Evidence pack: typed name, verified email, timestamp, IP, user-agent, SHA-256 of the exact PDF, version, confirmation email | Medium-High | IT Act s.10A; BSA 2023 s.63 |
| 15a | Stamp duty on e-agreements (West Bengal) | Possibly [?] | Flag for the lawyer/CA; may need e-stamping for large contracts | Low | Indian Stamp Act (WB) |
| 16 | Email | Yes | Transactional email is fine. Marketing needs opt-in (DPDP, GDPR), an unsubscribe link and a postal address (CAN-SPAM). TRAI rules cover SMS/calls only | High | FTC CAN-SPAM; TCCCPR |
| 17 | security.txt / vulnerability disclosure | No legal duty | Publish `/.well-known/security.txt` (RFC 9116) and a safe-harbour page | High | RFC 9116 |
| 18 | Accessibility | India: **draft 2026 rules would make it mandatory** [?]; EU Accessibility Act: exempt (micro, B2B); US ADA: low risk | Build to **WCAG 2.2 AA** (covers IS 17802 / WCAG 2.1) | Medium | RPwD Act s.40, 46; draft S.O. 3962(E); EAA Art. 4(5) |

---

## 1. DPDP Rules 2025: notification and phased start

**Rule.** Digital Personal Data Protection Rules, 2025, G.S.R. 846(E), Gazette notification dated **13 November 2025**. PIB says the Rules were "notified on 14 November 2025", and the Gazette PDF is digitally signed 14-Nov-2025 at 10:43. Most commentators count from **13 November 2025**. [?] Whether the "date of publication" is 13 or 14 November could move each deadline by one day. Plan for the earlier date.

Rule 1 (commencement), quoted in substance from the Gazette:
- Rule 1(2): **Rules 1, 2 and 17 to 21** came into force on publication (13 Nov 2025). These cover the Board: selection, salaries, meetings, the Board as a digital office, and staff.
- Rule 1(3): **Rule 4** (Consent Managers) comes into force "one year after the date of publication", which is **13 Nov 2026**. This confirms the "Nov 2026" consent-manager date.
- Rule 1(4): **Rules 3, 5 to 16, 22 and 23** come into force "eighteen months after", which is **13 May 2027**. This confirms the "13 May 2027" core date. It covers notice, security, breach notice, retention, the contact person, children, rights, cross-border transfer and appeals.

The Act itself was brought into force in matching stages by a separate notification of the same date (reported as G.S.R. 843(E)) [?]:
- Now: s.1(2), 2, 18 to 26, 35, 38 to 43, 44(1) and 44(3) (the RTI amendment).
- 13 Nov 2026: s.6(9) and 27(1)(d) (registering Consent Managers).
- 13 May 2027: s.3 to 5, 6(1) to (8) and (10), 7 to 17, 27 (except 1(d)), 28 to 34, 36, 37 and **44(2)**. Section 44(2) deletes **IT Act s.43A**, which means the **SPDI Rules 2011 stay in force until 13 May 2027**.

**What is new in 2026**
- 22 to 23 Jan 2026: at a stakeholder meeting, MeitY suggested shortening the 18-month window to 12 months for **Significant Data Fiduciaries**, and possibly cutting the Rule 8(3) timing as well. **Nothing has been notified in the Gazette.**
- 31 Aug 2026: the MeitY Secretary was reported as saying the notified deadlines stay unchanged.
- The Data Protection Board has been set up under s.18. On 6 May 2026 MeitY invited applications for a Chairperson and 4 Members. LiveLaw reported on 1 Aug 2026 that **no Chairperson or Members had yet been appointed**. One vendor blog says appointments were "formalised" on 6 June 2026. I could not confirm that. [?]
- No startup or MSME exemption under s.17(3) has been notified. There is **no size threshold**: a 3-person proprietorship is a Data Fiduciary.

**What this means for us.** Today, the IT Act s.43A, the SPDI Rules 2011 and the CERT-In directions are binding. DPDP's substantive duties start 13 May 2027. Build to DPDP now. It is stricter than SPDI on most points, so one design covers both.

**Sources**
- DPDP Rules 2025, G.S.R. 846(E), MeitY Gazette PDF: https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf (checked 06-Oct-2026)
- PIB backgrounder "DPDP Rules, 2025 Notified" (17-Nov-2025): https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf (checked 06-Oct-2026)
- DPDP Act 2023 (Gazette): https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf (checked 06-Oct-2026)
- Act commencement tranches (secondary): https://buildwright.co.in/blog/dpdp-commencement-timeline-what-applies-when (checked 06-Oct-2026)
- Proposed compression (secondary): https://www.mondaq.com/india/data-protection/1773554/meity-plans-to-cut-short-dpdp-compliance-timeline-and-notify-cross-border-restrictions-for-sdfs (checked 06-Oct-2026)
- "Deadline stays" (secondary, 31-Aug-2026): https://varindia.com/news/dpdp-deadline-stays-meity-issues-major-update (checked 06-Oct-2026)
- DPBI vacancy circular F. No. 2(1)/2026-Pers.I, 6-May-2026: https://www.meity.gov.in/static/uploads/2026/05/cd481c027470b420b4cb85fb40a91c53.pdf (checked 06-Oct-2026)
- LiveLaw, "India's Data Protection Board: Established In Law, Absent In Fact" (1-Aug-2026): https://www.livelaw.in/articles/india-data-protection-board-established-law-543751 (checked 06-Oct-2026)

---

## 1a. The rules in force today: IT Act s.43A and the SPDI Rules 2011

**Rule.** IT (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011:
- Rule 4: publish a privacy policy. It must cover the types of personal and sensitive data collected, the purpose, disclosures, and security practices.
- Rule 5: collect data for a lawful purpose and tell people the purpose and who receives it.
- **Rule 5(9)**: designate a **Grievance Officer**, publish their **name and contact details** on the website, and resolve grievances **within one month**.
- Rule 8: reasonable security practices (ISO 27001 is the example the rules give).

The definition of "body corporate" in s.43A **includes a sole proprietorship** engaged in commercial or professional activity.

**Plain English.** Until May 2027 we need a privacy policy and a named Grievance Officer who replies within a month. "Sensitive personal data" includes passwords and bank or card details. We hold almost none: the gateways hold card data, and magic links mean we store no passwords. Bank details collected for refunds or vendor payments would count.

**Put in the privacy notice.** A Grievance Officer block (name, email, postal address, phone optional), a 1-month response promise, and a security summary.

**Risk.** Compensation claims under s.43A (no cap). IT Act s.72A (disclosing data in breach of a lawful contract) carries up to 3 years in prison or a fine up to ₹5 lakh.

**Sources**
- SPDI Rules 2011 text (WIPO Lex): https://www.wipo.int/wipolex/en/legislation/details/15063. CIS copy: https://cis-india.org/internet-governance/files/it-reasonable-security-practices-and-procedures-and-sensitive-personal-data-or-information-rules-2011.pdf (seen in search 06-Oct-2026; Rule 5(9) wording confirmed through secondary summaries)
- SPDI after DPDP (secondary): https://www.legal500.com/intelligence/india/privacy/what-happens-to-existing-spdi-rules-after-full-dpdp-enforcement (06-Oct-2026)

---

## 2. Notice requirements (DPDP s.5, s.6(3), Rule 3)

**Rule.**
- **s.5(1)**: every request for consent must come with, or after, a notice that states: (i) the personal data and the purpose; (ii) how to withdraw consent (s.6(4)) and how to use grievance redressal (s.13); (iii) how to complain to the Board.
- **s.5(2)**: people who consented before the Act started must get a notice "as soon as reasonably practicable".
- **s.5(3)**: the person must have **the option to read the notice in English or any language in the Eighth Schedule** to the Constitution (22 languages). **s.6(3)** says the same for the consent request itself and adds that it must give the **contact details of the DPO or authorised person**.
- **Rule 3**: the notice must (a) be **understandable on its own**, without relying on other documents; (b) be in **clear and plain language** and include at minimum (i) an **itemised description of the personal data** and (ii) the **specified purposes** with a **specific description of the goods or services** or uses that the processing enables; (c) give **the link to our website or app**, and any other means, by which the person can (i) **withdraw consent as easily as they gave it**, (ii) use their rights, and (iii) **complain to the Board**.

**Plain English.** A short, standalone notice at each point of collection: the quote form, the cookie banner, the portal invitation. It lists each data item next to its purpose, and has working links for withdrawing consent, making a rights request, and complaining to the Board. The long privacy policy can sit behind it, but the short notice must make sense alone.

On language, the Act says "give the option". Most commentators read this as: offer a language selector or "available on request" for the 22 languages [?]. For a West Bengal business serving India, publish **English plus Hindi and Bengali** versions of the short notice and translate others on request within a stated time. Ask the lawyer whether "on request" is enough.

**What to put where**
- Quote form (short notice): "We use your name, email, company, phone (optional), budget band and message to reply to your enquiry and prepare a quote. [Privacy notice] · [Your rights / withdraw] · [Complain to the Data Protection Board]".
- Cookie banner: the categories, what each does, who receives the data (Google for GA4), and a link to change the choice later.
- Portal invitation email: what data the portal holds, why, and links.
- Privacy policy: the full itemised table (see Drafting checklist).

**Product.** Version every notice. Store `notice_version` and `language` with every consent and form submission. Under **s.6(10)** the Data Fiduciary **must prove** that notice was given and consent obtained.

**Sources:** DPDP Act s.5, 6 and Rules 3 (URLs in §1; checked 06-Oct-2026).

---

## 3. Consent and legitimate uses (s.4, 6, 7): what we can rely on

**Rule.**
- **s.4**: personal data may be processed only for a lawful purpose, either (a) with consent or (b) for a "certain legitimate use".
- **s.6(1)**: consent must be "free, specific, informed, unconditional and unambiguous with a clear affirmative action", and limited to the data needed for the purpose. s.6(4) allows withdrawal at any time, as easily as consent was given.
- **s.7(a)**: data may be processed "for the specified purpose for which the Data Principal has **voluntarily provided** her personal data… and in respect of which she has not indicated… that she does not consent". The Act's illustrations: a pharmacy sending a receipt to a phone number the customer gave; a broker helping someone who messaged them, who must stop when told.
- **s.7(i)**: employment purposes (covers our own staff).
- **DPDP has no general "contract" or "legitimate interests" ground.** In practice, s.7(a) covers much of what GDPR would put under the contract ground.

**Is B2B contact data in scope?** **Yes.** "Personal data" means any data about an identifiable individual. A named employee's work email, phone or name is personal data. Neither the Act nor the Rules exclude business contacts. Two exceptions:
- s.3(c)(ii): data the person has **made publicly available** themselves is outside the Act. Do not rely on this for scraped leads. [?]
- **s.17(1)(d)**: personal data of people **outside India**, processed by an India-based person under a contract with someone outside India, is exempt from most of Chapters II and III and s.16. The exception is security (s.8(1) and (5)), which still applies. This clearly covers our work as a processor for foreign clients, such as data inside an app we build or host for them. Whether it also covers the foreign client's own contact people is less certain [?]. Treat it as a fallback, not a design basis.

**Our processing mapped to a basis** (VERIFY WITH CA/LEGAL)

| Processing | DPDP basis | GDPR basis (EU/UK people) |
|---|---|---|
| Quote/contact form, replying, preparing a quote | s.7(a) voluntarily provided | Art. 6(1)(b) steps before a contract / (f) |
| Turnstile bot check | s.7(a), plus the Rule 6 security duty [?] | Art. 6(1)(f); ePrivacy "strictly necessary" [?] |
| Cloudflare Web Analytics (cookieless) | Data is probably not personal; otherwise s.7(a) [?] | Art. 6(1)(f) |
| **GA4** | **Consent** | **Consent** (ePrivacy 5(3)) |
| **Marketing email or newsletter** | **Consent**, as a separate unticked checkbox | Consent (or the soft opt-in for existing clients, UK/EU) |
| Client contacts in admin; projects; files | s.7(a) | Art. 6(1)(b) / (f) |
| Invoices, payments, GST records | s.7(a) + **legal obligation** (CGST s.35/36; the s.8(7) "law requires" carve-out) | Art. 6(1)(c) / (b) |
| Proposal acceptance logs (name, IP, timestamp) | s.7(a); s.17(1)(a) for enforcing legal claims | Art. 6(1)(b) / (f) |
| Sentry error tracking, security logs | s.7(a) + Rule 6(1)(c),(e) security duty | Art. 6(1)(f) |
| Cal.com booking | s.7(a) | Art. 6(1)(b) |
| Staff data | s.7(i) | Art. 6(1)(b) / (c) |

**Important.** Rights of access, correction and erasure (s.11, 12) apply to data given by consent **and** under s.7(a). So "legitimate use" does not mean "no rights".

**Risks.**
- Bundled consent: for example, "by submitting you agree to marketing". s.6(1) and the s.6 illustration on unnecessary data make this invalid.
- Pre-ticked boxes.
- Using enquiry data for unrelated marketing.

**Sources:** DPDP Act s.3, 4, 6, 7, 17 (URL in §1; checked 06-Oct-2026).

---

## 4. Data principal rights, contact person and grievances

**Rule.**
- **s.11** Access: a summary of the data and processing, the identities of all other Data Fiduciaries and **Data Processors** the data was shared with, and what was shared.
- **s.12** Correction, completion, updating and erasure. Erasure can be refused where retention is needed for the purpose or required by law.
- **s.13** Grievance redressal. The person must use our grievance process **before** going to the Board.
- **s.14** Nominate someone to act on death or incapacity.
- **s.8(9) + Rule 9**: **prominently publish** on the website the **business contact information of the DPO (if applicable) or a person who can answer questions** about processing. Mention it **in every reply** to a rights request.
- **s.8(10)**: an effective grievance mechanism.
- **Rule 14(1)**: publish **how** to make a request and what **identifier** we need (for example, email address or client ID).
- **Rule 14(3)**: publish the grievance response period, **not exceeding 90 days**, and use measures that make the deadline achievable.
- **Rule 14(4)**: nomination, following our terms of service.
- PIB: requests for access, correction, updating or erasure must be handled within a maximum of 90 days.
- A **DPO is mandatory only for a Significant Data Fiduciary** (s.10). We are not one. A "contact person" is enough.

**Timelines to design for**
- DPDP: no more than 90 days (from May 2027).
- SPDI Rule 5(9): **1 month**, now.
- E-Commerce Rules: acknowledge in 48 h, resolve in 1 month (if they apply).
- GDPR Art. 12(3): **1 month**, extendable by 2 months.
- **Design: acknowledge within 48 hours, resolve within 30 days, internal hard stop at 90 days.**

**Product**
- A public `/privacy/requests` form (choose access, correction, erasure, withdraw consent, nominate, grievance) and a portal button.
- Verify identity by magic link to the email on file.
- Admin queue: ticket, SLA clock, status, reply template that includes the contact-person block (Rule 9), and an export of the person's data (JSON/PDF).
- Erasure workflow that respects legal holds: invoices (72 months, GST), the Rule 8(3) one-year log minimum, and open disputes.

**Sources:** DPDP s.8 to 14; Rules 9, 14 (URL in §1, checked 06-Oct-2026); GDPR Art. 12 (https://eur-lex.europa.eu/eli/reg/2016/679/oj, canonical URL, not fetched).

---

## 5. Security safeguards, breach notification, CERT-In

### 5.1 Reasonable security (DPDP s.8(5), Rule 6), from 13 May 2027
Rule 6(1) sets the **minimum**:
- (a) encryption, obfuscation, masking or tokenisation;
- (b) access control on computer resources (ours and our processors');
- (c) visibility of access through **logs, monitoring and review**, so we can detect, investigate and fix problems;
- (d) continuity measures such as **backups**;
- (e) **keep those logs and personal data for one year**, unless another law requires otherwise;
- (f) **security clauses in processor contracts**;
- (g) technical and organisational measures.

s.8(2) also requires a **valid contract** with every Data Processor.

**Product checklist**
- TLS everywhere. R2 and S3 encryption at rest. Encrypted S3 Mumbai backups.
- Field-level encryption for any bank details.
- Role-based admin access. MFA for staff (passkeys or TOTP), even though clients use magic links.
- Short-lived, single-use magic links.
- An append-only **audit log** of who viewed or exported what, kept **at least 12 months**.
- Tested restore of backups.
- A DPA or processor terms on file for **every vendor**: Cloudflare, AWS, Razorpay, Stripe, PayPal, Google, Zoho, Cal.com, Sentry.

### 5.2 Breach notification (s.8(6), Rule 7), from 13 May 2027
- **To each affected person**, "without delay", through their account or registered contact. Include: what happened (nature, extent, timing); likely consequences for them; what we are doing; what they can do; and a **contact person**.
- **To the Board**: (a) **without delay**, a description of nature, extent, timing, location and likely impact; then (b) **within 72 hours** of becoming aware (longer if the Board allows on written request): updated details, facts and reasons, mitigation, findings about who caused it, steps to prevent recurrence, and a report on the notices sent to affected people.
- There is **no "low risk" exemption**. Every personal data breach must be reported.

### 5.3 CERT-In Directions (28 April 2022, under IT Act s.70B(6)), in force now
- (i) Sync ICT clocks to NIC or NPL NTP servers, or a source traceable to them. Cloudflare and AWS time sources are generally accepted if they do not drift [?].
- (ii) **Report listed cyber incidents within 6 hours** of noticing them, to incident@cert-in.org.in. Annexure I lists the incident types, which include data breach and data leak.
- (iii) Designate a **Point of Contact** and send CERT-In the Annexure II details.
- (iv) **Keep logs of all ICT systems for a rolling 180 days**, "within the Indian jurisdiction". However, **CERT-In FAQ Q35** says logs "may be stored outside India also" if they can be produced to CERT-In in reasonable time.
- (v) The 5-year customer-record duties apply only to data centres, VPS, cloud and VPN providers. **Not us**, unless we start selling hosting.
- Who is covered: "service providers, intermediaries, data centres, **body corporate** and Government organisations". Individuals are not covered (FAQ). A sole proprietorship falls within the IT Act's s.43A definition of "body corporate" [?]. Once s.43A is deleted in May 2027, that definition goes with it. Ask the lawyer.
- Penalty (s.70B(7)): up to 1 year in prison or a fine up to ₹1 lakh. The FAQ says enforcement targets deliberate non-compliance.

**Design changes**
1. Cloudflare's default log retention is short. **Export** Worker, D1-access and admin audit logs to R2 or S3 and keep them **at least 1 year**. That covers both the CERT-In 180 days and DPDP Rule 6(1)(e)/8(3).
2. Write an **incident runbook** with a single clock:
   - T+6 h: CERT-In.
   - "Without delay": a brief note to the Board, and notices to affected people.
   - T+72 h: the Board's detailed report.
   - T+72 h: the GDPR supervisory authority, if EU/UK people are affected and GDPR applies.
   - Also: tell the affected client organisations, as our contracts require.
3. Add a "Security" page and the Point-of-Contact record.

**Sources**
- Rules 6 and 7 (URL in §1; checked 06-Oct-2026)
- CERT-In Directions No. 20(3)/2022-CERT-In: https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf (checked 06-Oct-2026)
- CERT-In FAQs (May 2022), Q35: https://www.cert-in.org.in/PDF/FAQs_on_CyberSecurityDirections_May2022.pdf (checked 06-Oct-2026)

---

## 6. Retention and erasure

**Rule.**
- **s.8(7)**: erase when consent is withdrawn, or when it is reasonable to assume the purpose is no longer served, unless the law requires retention. Make processors erase too.
- **s.8(8) + Rule 8(1),(2) + Third Schedule**: erasure after **3 years of inactivity**, with **48 hours' warning**. This applies **only** to e-commerce entities with 2 crore or more registered users in India, online gaming intermediaries with 50 lakh or more, and social media intermediaries with 2 crore or more. **Not us.**
- **Rule 8(3)**: every Data Fiduciary must **keep personal data, associated traffic data and processing logs for at least one year from the date of processing**, for the state-access purposes in the Seventh Schedule. After that, erase, unless another law requires longer. The Gazette illustration: an e-book platform must keep order, payment and delivery logs for a year **even if the user deletes their account**. A cloud processor must do the same.
- **Rule 6(1)(e)**: keep security logs and personal data for one year.
- **CGST Act s.36**: keep books and records "until the expiry of **seventy-two months** from the due date of furnishing of annual return" for that year. In practice that is about 7.5 years from the invoice date.
- Income-tax: the Income-tax Act 2025 replaced the 1961 Act from 1 April 2026. Check its retention period with the CA [?].

**How it fits together (proposed schedule, VERIFY WITH CA/LEGAL)**

| Data | Keep | Then |
|---|---|---|
| Unconverted leads (quote form) | 24 months from last contact [?]. Never less than 12 months (Rule 8(3)) | Delete, or anonymise into statistics |
| Marketing consent records | For as long as we email the person, plus 3 years (proof of consent) | Delete |
| Client org and contacts | Contract term, plus 8 years (to cover GST's 72 months and limitation) | Delete or archive |
| Invoices, receipts, payment refs, credit notes | **72 months from the annual-return due date** | Delete |
| Proposals and acceptance evidence | Contract term, plus 3 years (Limitation Act) [?], and never less than the invoice retention for that project | Delete |
| Project files (client IP) | Per contract; default: return or delete 90 days after closure | Delete with a certificate |
| Security, audit and access logs | **12 months minimum** (rolling); 180 days is the CERT-In floor | Delete |
| Sentry events | 90 days (scrub PII) [?]. Logs needed under Rule 8(3) are kept elsewhere | Delete |
| GA4 | 2 months (the lowest GA4 setting) or 14 months | Automatic |
| Backups | 35 to 90 days rolling. Erased records disappear from backups as they expire | Expire |

**Product.** A scheduled retention job; a `legal_hold` flag; a tombstone record on erasure (ID, date and reason only); a processor-erasure checklist covering R2, S3, Zoho mailbox and Sentry.

**Sources:** DPDP s.8; Rules 6, 8; Third and Seventh Schedules (URL in §1, checked 06-Oct-2026); CGST Act s.35/36 via https://cbic-gst.gov.in/gst-acts.html (reachable 06-Oct-2026; s.36 wording from memory) [?].

---

## 7. Cross-border transfer (s.16, Rule 15)

**Rule.**
- **s.16(1)**: the Government *may* notify countries to which transfer is **restricted**. This is a "negative list" model.
- **s.16(2)**: stricter sector laws still apply. Example: RBI's 2018 payment-data localisation rule, which binds payment system operators such as Razorpay, not us.
- **Rule 15** (from May 2027): data may be transferred abroad provided we meet any requirements the Government sets by general or special order about making data available to a foreign State or its agencies.
- **Rule 13(4)**: localisation applies only to **Significant Data Fiduciaries**, for data a committee specifies.
- **Status on 06-Oct-2026: no country has been notified as restricted, and no Rule 15 order has been issued** (as far as I could find). In January 2026 MeitY talked about fast-tracking restrictions **for SDFs** only.

**What this means for us.** Storing data in Cloudflare D1 and R2 (no India region; US or other locations) and using US processors (Google, Sentry, Cal.com, Stripe, PayPal) is **permitted** under DPDP today. Name the countries or regions in the privacy notice. Watch the Gazette for any s.16 notification. If one names the US, plan to move D1 to an EU jurisdiction or move to an India-region database.

**GDPR angle.** India has **no EU adequacy decision**. Collecting data directly from EU/UK people is not a GDPR "transfer" in EDPB's view, but we must still comply with GDPR (Art. 3(2)). For onward transfers to US processors, check each vendor's **EU-US Data Privacy Framework** listing and SCCs in their DPA: https://www.dataprivacyframework.gov/list (reachable 06-Oct-2026).

**Sources:** DPDP s.16; Rules 13, 15 (URL in §1, checked 06-Oct-2026); MeitY January 2026 proposal (secondary): https://chambers.com/articles/meity-plans-to-cut-short-dpdp-compliance-timeline-and-notify-cross-border-restrictions-for-sdfs (06-Oct-2026).

---

## 8. Children's data (s.9, Rules 10 to 12)

- **s.9(1)**: obtain verifiable consent of a parent before processing a child's data ("child" means under 18).
- **s.9(3)**: no tracking, behavioural monitoring or targeted advertising aimed at children.
- **Rule 10**: check that the parent is an identifiable adult, using reliable identity and age details we already hold, or details provided voluntarily, or a virtual token from an authorised entity (for example DigiLocker).
- **Us:** this is B2B, so it does not apply in practice. Add to the notice and Terms: "Our services are for businesses. The site is not directed to anyone under 18, and we do not knowingly collect children's data. If we learn we have, we delete it." Do not build age-targeted features.
- **Client work:** if a client's app processes children's data (for example ed-tech), the **client** is the Data Fiduciary. Our contract should say they handle Rule 10 consent, and we build what they specify.

**Sources:** DPDP s.9; Rules 10 to 12 (URL in §1, checked 06-Oct-2026).

---

## 9. Penalties (s.33, Schedule): for context

| Breach | Maximum |
|---|---|
| Failing to take reasonable security safeguards (s.8(5)) | ₹250 crore |
| Failing to notify the Board or affected people of a breach (s.8(6)) | ₹200 crore |
| Children's obligations (s.9) | ₹200 crore |
| SDF obligations (s.10) | ₹150 crore |
| Data Principal's own duties (s.15) | ₹10,000 |
| Breach of a voluntary undertaking (s.32) | Up to the relevant amount |
| Anything else in the Act or Rules | ₹50 crore |

The Board must weigh nature, gravity, duration, repetition, gain and mitigation (s.33(2)), so maximums are unlikely for a micro firm. There are no criminal penalties under DPDP. Other laws for context:
- IT Act s.72A: up to 3 years or ₹5 lakh.
- s.70B(7): up to 1 year or ₹1 lakh.
- CPA 2019 s.21: up to ₹10 lakh, or ₹50 lakh for a repeat, for misleading ads.
- GDPR Art. 83: up to €20 m or 4% of turnover.
- UK PECR (after DUAA): up to £17.5 m or 4% [?].

**Sources:** DPDP Schedule (URL in §1, checked 06-Oct-2026); PIB backgrounder (checked 06-Oct-2026).

---

## 10. Cookies and GA4 consent

**India.** DPDP has **no cookie-specific provision**. Cookies and online identifiers that can be linked to a person are personal data. Analytics and advertising cookies do not fit any s.7 legitimate use, so they need **s.6 consent**: free, specific, informed, unambiguous, a clear affirmative action, and withdrawable as easily as given. The CCPA dark-patterns guidelines (2023) also ban "confirm shaming", "nagging", "interface interference" and "forced action" in UIs, and that includes consent banners. **Our planned design (GA4 only after consent) is correct.**

**EU (ePrivacy Directive Art. 5(3) + GDPR).**
- Consent is needed **before** storing or reading non-essential cookies or identifiers.
- The EDPB Cookie Banner Taskforce (Jan 2023) treats these as problems: no reject option on the first layer; pre-ticked boxes; deceptive colours or contrast; relying on legitimate interest for cookies; no easy way to withdraw.
- Strictly necessary cookies (security, load balancing, Turnstile [?]) are exempt.

**UK (PECR as amended by the Data (Use and Access) Act 2025; changes in force from 5 Feb 2026 [?]; ICO final guidance 29 Apr 2026).**
- There is a new "**statistical purposes**" exception to consent. Conditions: the analytics are used only to improve our service; any third-party provider acts **only as our processor** and does not link the data with other data; we give clear information and a "simple and free" way to object. It **does not cover advertising**.
- GA4 is doubtful under this exception, because Google may use data for its own purposes depending on settings [?]. **Keep GA4 consent-gated for the UK too.** Cloudflare Web Analytics (cookieless) is the low-risk default.

**US.** No federal cookie consent law. CCPA "Do Not Sell/Share" would apply only above the thresholds in §11.

**What a compliant banner looks like (one design for all regions)**
1. **First layer:** "Accept all", "Reject all" and "Customise". All three are equally prominent: same size, style and contrast. No "X" that counts as acceptance.
2. **Categories:** Strictly necessary (always on; Turnstile, session, consent cookie); Analytics (GA4; off by default). Add Marketing only if we ever add ad pixels.
3. **Nothing pre-ticked.** Scrolling or continuing to browse is not consent.
4. **Google Consent Mode v2, "basic" implementation:** GA4 tags do not load until consent is given. Defaults `analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization` = `denied`. Never send `ad_*` = granted unless we run ads.
5. A permanent "Cookie settings" link in the footer, so withdrawal is as easy as acceptance (DPDP s.6(4), Rule 3(c)(i)).
6. **Store a consent record:** random ID, choices, banner version, timestamp, region. Do not store the full IP. Keep it 12 months and ask again after 6 to 12 months.
7. GA4 settings: Google Signals off; data retention 2 months; IP is not logged in GA4; no user-ID; Data Processing Terms accepted.
8. A short cookie policy table: name, provider, purpose, duration, category.

**Sources**
- ICO storage and access technologies guidance (final 29-Apr-2026): https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/ (checked 06-Oct-2026); its "exceptions" sub-page (checked 06-Oct-2026)
- EDPB Cookie Banner Taskforce report: https://www.edpb.europa.eu/our-work-tools/our-documents/other/report-work-undertaken-cookie-banner-taskforce_en (reachable 06-Oct-2026)
- Google consent mode (GA4): https://support.google.com/analytics/answer/9976101 (checked 06-Oct-2026)
- DUAA commencement (secondary): https://bratby.law/data-use-and-access-act-2025-commencement/ (06-Oct-2026) [?]
- Dark Patterns Guidelines 2023: https://consumeraffairs.nic.in/theconsumerprotection/guidelines-prevention-and-regulation-dark-patterns-2023 (seen 06-Oct-2026)

---

## 11. GDPR / UK GDPR applicability; US state laws

**Art. 3(2)(a)** applies GDPR to a non-EU controller that offers goods or services to data subjects in the EU. EDPB Guidelines 3/2018 look at signs of targeting:
- EU languages or currencies;
- naming EU customers or "we serve clients in Germany/UK";
- EU phone numbers;
- ads aimed at the EU.

Contact people at EU client businesses are "data subjects". **Art. 3(2)(b)** (monitoring behaviour) could also be triggered by analytics on EU visitors. **Conclusion: if we actively market to EU/UK clients (and we plan to), assume GDPR and UK GDPR apply to that processing.** [?]

**Art. 27 representative.** A non-EU controller under Art. 3(2) must appoint an EU representative (and a UK one under UK GDPR) **unless** its processing is **occasional**, does not involve large-scale special-category or criminal data, and is unlikely to create risk (Art. 27(2)(a)). Regular EU client work is arguably not "occasional" in EDPB's reading. A representative costs roughly €/£ hundreds a year [?]. **This is a decision for the lawyer.** Option: start without one while EU work is rare, document why we think the exemption applies, and appoint one once we have regular EU/UK clients.

**Minimum EU/UK additions to the privacy notice (Art. 13)**
- Controller identity: proprietor's name, trade name, address, contact. Representative if appointed.
- Purposes **with legal bases**: contract, legitimate interests (and what those interests are), consent, legal obligation.
- Recipients and processors.
- **International transfers**: we are in India (no adequacy decision); processors in the US/EU; safeguards (SCCs, DPF).
- Retention periods.
- Rights: access, rectification, erasure, restriction, portability, objection (including an absolute right to object to direct marketing), and withdrawal of consent.
- The right to **complain to a supervisory authority**: the person's local EU authority; the **ICO** for the UK.
- Whether giving data is a contractual requirement; no automated decision-making.
- **Breaches**: 72 hours to the supervisory authority where required (Art. 33). One runbook (see §5).

**When we act as a processor for EU clients** (we build or run systems holding their customers' data), we need an **Art. 28 DPA** with each client. This is very commonly requested. Keep a template ready.

**US.**
- CCPA/CPRA applies only above: **annual gross revenue over US$26,625,000** (2025-26 adjusted figure), **or** buying, selling or sharing the personal information of 100,000 or more California consumers or households, **or** 50% or more of revenue from selling or sharing. **Not us.** Other state laws (Virginia, Colorado and others) have similar or higher volume thresholds. **N/A.**
- Optional one-line "US visitors" paragraph: we do not sell or share personal information.

**Gulf (brief, [?]).** UAE PDPL (Federal Decree-Law 45/2021) and Saudi PDPL (enforced from Sept 2024) have extraterritorial reach. For B2B contact data the practical steps are the same: notice, consent for marketing, security, transfer terms in contracts. Check if Gulf work grows.

**Sources**
- EDPB Guidelines 3/2018 on territorial scope: https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-32018-territorial-scope-gdpr-article-3-version_en (reachable 06-Oct-2026)
- GDPR: https://eur-lex.europa.eu/eli/reg/2016/679/oj (canonical; not fetched)
- CPPA monetary thresholds: https://www.cppa.ca.gov/regulations/cpi_adjustment.html (reachable 06-Oct-2026)

---

## 12. Website Terms of Use (Indian services company)

**Law.**
- Indian Contract Act 1872.
- IT Act 2000 **s.10A**: contracts formed electronically are not unenforceable just because they are electronic.
- CPA 2019 unfair-contract-term rules: these protect **consumers**. B2B buyers who buy "for a commercial purpose" are mostly not consumers, but sole traders buying for their livelihood may be [?].
- Courts generally uphold an **exclusive jurisdiction clause** in favour of one of the courts that already has jurisdiction. Courts at our place of business qualify. [?] The lawyer should confirm the leading Supreme Court authority (commonly cited: *Swastik Gases v. IOC*, 2013).

**Governing law and forum (options, VERIFY WITH CA/LEGAL)**
- **Option A (simplest, best for the owner):** laws of India; exclusive jurisdiction of the **courts at Balurghat, Dakshin Dinajpur, West Bengal**.
- **Option B:** courts at **Kolkata**. The Calcutta High Court's commercial division handles larger commercial disputes, and some clients will prefer it.
- **Commercial Courts Act 2015:** disputes of a "specified value" of ₹3 lakh or more are "commercial disputes". **Pre-institution mediation (s.12A)** is mandatory unless urgent relief is sought. Which commercial court serves Dakshin Dinajpur is [?].
- **International clients:** add **arbitration** (Arbitration and Conciliation Act 1996), seated in Kolkata (or online), English language, sole arbitrator. Arbitral awards are enforceable abroad under the New York Convention; Indian court judgments often are not. This belongs in the **client contract/MSA**, not only in the website terms.

**Clauses**
- Who we are: trade name, proprietor, GSTIN, address.
- Acceptance by using the site.
- Changes to the terms.
- **Information only, no offer**: prices marked "**starting from**" are indicative. Every engagement needs a written proposal, and the proposal and MSA override the site.
- **All prices exclude GST** unless stated otherwise. GST at the applicable rate is added. Exports may be zero-rated under a LUT [?].
- **Demos, case studies and AI outputs** are illustrative. Results vary. Client names and logos are shown with permission. Mark any mock-ups or synthetic demo data as such.
- **IP**: site content belongs to us. Licence to view only. No scraping or reuse. Third-party marks belong to their owners.
- **Acceptable use**: no attacks, probing outside our disclosure policy, malware, spam through forms, or automated submissions (Turnstile).
- Links to third-party sites; no liability for them.
- **Disclaimer of warranties** ("as is"). **Limitation of liability** for site use (for example, nil or ₹10,000 [?]; service-contract caps go in the MSA). Nothing excludes liability that cannot be excluded by law, such as fraud.
- Indemnity for misuse of the site.
- Privacy and cookies: by reference.
- Governing law and jurisdiction (above).
- Contact and grievance officer.
- Severability. Date and version.

**IT Act / Intermediary Rules 2021: we are N/A for the marketing site.** We publish our own content, not third-party content.
- The **client portal** stores files clients upload for our own engagement. We are a party to that, not an intermediary [?].
- **If we later host client apps or user-generated content**, we may be an "intermediary". That brings IT Rules 2021 due diligence: terms, a grievance officer, takedown timelines. The **IT Amendment Rules 2026** (notified 10 Feb 2026, in force 20 Feb 2026) add labelling of **synthetically generated information** for intermediaries.
- Good practice even though we are not an intermediary: label AI-generated images and voice in our own demos.

**Sources:** IT Act 2000: https://www.indiacode.nic.in/handle/123456789/1999 (canonical; timed out 06-Oct-2026) [?]; e-contract enforceability (secondary): https://www.mondaq.com/india/it-and-internet/1305896/though-click-wraps-are-legal-can-minors-enter-click-wraps (06-Oct-2026); IT Amendment Rules 2026 (secondary): https://www.khaitanco.com/thought-leadership/MeitY-notifies-the-IT-Amendment-Rules-2026 (06-Oct-2026).

---

## 13. Refund and cancellation; payment-gateway requirements; E-Commerce Rules

**Razorpay** (business website details doc) wants these policy pages on the primary website before live keys are issued: **Terms and Conditions, Privacy Policy, Shipping Policy, Contact Us, Cancellation and Refunds**. For additional websites it also lists About Us and **Pricing details**. Services businesses still need a "Shipping" page. Write it as a **Delivery Policy**: services are delivered digitally through the portal, email or repositories; timelines are as set out in each proposal; nothing is physically shipped.

**Stripe** (account activation FAQ) wants: business name; a description of the services; customer-service contact; **refund and dispute policy**; **cancellation policy**; legal or export restrictions; promo terms; pages that do not need a password. **Important:** Stripe **is invite-only for Indian businesses** (new sign-ups since May 2024). From 1 Jan 2026, onboarding also involves video KYC liveness checks. **Do not depend on Stripe.** Design the portal so the gateway can be swapped.

**PayPal.** PayPal stopped **domestic** Indian payments in April 2021. Indian accounts can only **receive cross-border** payments. This is fine for US/UK/EU clients, but invoices need the export-of-services details. [?]

**RBI (Regulation of Payment Aggregators) Directions, 2025** (15 Sept 2025). These bind the gateways, and they pass the terms on to us:
- **refunds must go to the original payment method** unless the payer asks for another account in their own name;
- card data must not be stored by the merchant (we comply: hosted pages);
- merchant agreements must cover refunds, failed transactions, returns policy and grievances.

**Recurring payments:** RBI e-mandate rules apply (pre-debit notice; additional factor of authentication above ₹15,000 per transaction [?]). Use the gateway's subscription product.

**E-Commerce Rules 2020.** The rules apply to goods and services bought or sold over a digital network. Their protections are for "consumers". A B2B services firm taking payments on its own site is arguably an **inventory e-commerce entity / seller** [?].

If they apply, Rule 4 requires:
- display legal name, address, website and customer-care contact;
- a **Grievance Officer** whose name, contact details and designation are displayed;
- **acknowledge complaints within 48 hours and resolve them within one month**;
- no hidden charges;
- refund within a reasonable time.

Low cost: **publish one Grievance Officer block that serves SPDI, DPDP and the E-Commerce Rules together.**

**Typical refund terms (draft positions, VERIFY WITH CA/LEGAL)**

*Fixed-price projects*
- Deposit (for example 30 to 50%) books capacity and covers discovery. It is non-refundable once work has started, or refundable minus the cost of work done if cancelled before kick-off.
- Milestone payments are earned when the milestone is delivered and accepted, or deemed accepted after X business days without written objection.
- If the client cancels: pay for work done to date plus committed third-party costs. Unearned prepayments are refunded within 14 business days.
- If we cancel or cannot deliver: refund unearned amounts in full.

*Retainers*
- Billed monthly in advance. Cancel with 30 days' written notice.
- Unused hours do not roll over (or roll over one month only).
- No refund for a month already started, except where we fail to provide the service.

*Subscriptions / SaaS / maintenance plans*
- Cancel anytime, effective at the end of the current billing period.
- No partial-period refunds, except where the law requires them or the service is materially unavailable (SLA credits).
- Show the **renewal date and price before charging**, and allow **cancellation online as easily as sign-up**. The 2023 dark-pattern guidelines ban "subscription trap" and "SaaS billing" dark patterns.

*Process and GST*
- How to ask: email or portal ticket.
- Acknowledge within 48 h; decide within 14 days; refund within 5 to 7 business days after approval, to the original method (the bank may take longer).
- Currency: refunded in the currency charged; FX differences are not covered.
- **GST**: we issue a **credit note** under CGST s.34. There is a time limit for declaring credit notes (around 30 November after the end of the financial year [?]). Ask the CA.
- Disputes and chargebacks: contact us first. This does not limit card-network rights.

**Sources**
- Razorpay business website details: https://razorpay.com/docs/payments/dashboard/account-settings/business-website-details/ (checked 06-Oct-2026)
- Stripe activation FAQ: https://support.stripe.com/questions/business-website-for-account-activation-faq (seen 06-Oct-2026)
- Stripe India invite-only: https://stripe.com/docs/india-exports (seen in search 06-Oct-2026) and https://support.stripe.com/questions/india-faq
- RBI PA Master Direction 2025: https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12896 (checked 06-Oct-2026)
- E-Commerce Rules r.4 (secondary): https://www.mondaq.com/india/dodd-frank-consumer-protection-act/985606/the-consumer-protection-e-commerce-rules-2020 (06-Oct-2026)

---

## 14. Misleading advertising and dark patterns

**Law.**
- CPA 2019 s.2(28) defines a misleading advertisement. s.21 lets the CCPA order corrective ads and impose penalties (up to ₹10 lakh, or ₹50 lakh for a repeat; endorsers can be barred). s.89 creates an offence.
- **CCPA Guidelines for Prevention of Misleading Advertisements and Endorsements, 2022**: claims need substantiation; disclaimers must not contradict the main claim and must be legible and in the same language; "**bait advertising**" is restricted (you must have reasonable capacity to supply at the advertised price); "free" claims are restricted.
- **Guidelines for Prevention and Regulation of Dark Patterns, 2023** (30 Nov 2023) list 13 patterns: false urgency, basket sneaking, confirm shaming, forced action, subscription trap, interface interference, bait and switch, **drip pricing**, disguised ads, nagging, trick wording, SaaS billing, rogue malware.
- CCPA self-audit advisory to e-commerce platforms (5 June 2025).
- **Greenwashing Guidelines 2024**: relevant if we say "green" or "carbon-neutral hosting".
- **ASCI Code** (self-regulation): truthful and honest; substantiated; no denigration; comparisons must be fair; testimonials genuine; influencer disclosures.

**What our site copy must avoid or do**
- **Prices:** every price shows "+ GST" or "excl. 18% GST" [?] **next to the figure**, not only in a footnote. "Starting from ₹X" must be a price we really sell at for the stated scope. The proposal total must not add surprise fees (drip pricing).
- **No fake urgency or scarcity:** no countdown timers or "only 2 slots left" unless literally true and documented.
- **Claims:** "AI cuts costs 70%", "#1", "guaranteed results", "ISO-certified", "GDPR-compliant" only with evidence on file. Keep a claims register (claim → evidence → date). Phrase results as "for client X we achieved Y".
- **Testimonials and logos:** real, with written permission, not edited to change meaning. No AI-generated "client" faces or reviews.
- **Demos:** label them "illustrative demo, sample data".
- **Forms and cookie banner:** no confirm-shaming ("No, I don't want to grow my business"), no pre-ticked marketing, no nagging pop-ups.
- **Subscriptions:** a clear cancellation path. No "SaaS billing" surprises, such as auto-converting a trial without notice.

**Sources:** CCPA guidelines list: https://ccpa.doca.gov.in/guidelines.php (page "last updated 29-09-2026", checked 06-Oct-2026); ASCI Code: https://www.ascionline.in/the-asci-code/ (reachable 06-Oct-2026); CCPA advisory 5-Jun-2025: https://consumeraffairs.gov.in/public/upload/admin/cmsfiles/pressRelease/Central_Consumer_Protection_Authority_issues_advisory_to_E-Commerce_Platforms_for_self-audit_within_3_months_to_detect_Dark_Patterns_and_ensure_its_resolutionpress_release.pdf (seen 06-Oct-2026).

---

## 15. Click-to-accept proposals: enforceability and evidence

**Law.**
- Indian Contract Act: offer, acceptance, consideration, free consent.
- **IT Act s.10A**: a contract formed by electronic records is not unenforceable on that ground alone. Click-wrap acceptance is generally upheld in India.
- **IT Act s.3A / Second Schedule**: a legally recognised "electronic signature" means approved methods such as Aadhaar eSign or a DSC. A typed name **is not** a s.3A electronic signature, but **a contract does not need one**. The typed name and click are evidence of acceptance.
- **IT Act First Schedule** exclusions (wills, trusts, powers of attorney, immovable-property sale contracts, negotiable instruments other than cheques) are not relevant to us.
- **Evidence:** the **Bharatiya Sakshya Adhiniyam 2023 s.63** (replacing Evidence Act s.65B from 1 July 2024) admits electronic records with a **certificate** (Schedule format) that includes **hash values**.

**Evidence to record (design)**
- Proposal ID, version, and **SHA-256 of the exact rendered PDF** shown. Store an immutable copy in R2 with object lock or versioning.
- Signer: typed full name, title, organisation; **email verified by magic link** (the session ID); a checkbox with text such as "I have authority to bind [Org] and accept this proposal and the linked MSA v[x]".
- Timestamp (UTC + IST, NTP-synced), **IP address**, user-agent, geolocation from IP (country only).
- The terms version hash, if the MSA is linked.
- Immediately afterwards, email both parties a PDF "acceptance certificate" with the hash, plus the proposal. Log email delivery (SES message ID).
- An append-only audit trail: viewed, downloaded, accepted, and any change to signer details. Back it up to S3.
- For high-value or government clients, offer **Aadhaar eSign or DSC** through a provider, or a wet-ink counter-signature.

**Stamp duty (flag only) [?].** Under the Indian Stamp Act 1899 as it applies in West Bengal, an "agreement" may attract a small fixed stamp duty. Electronic agreements are not clearly exempt. Unstamped agreements can still be admitted as evidence after paying duty and penalty. West Bengal uses GRIPS or e-stamping. **Ask the lawyer/CA** whether proposals and MSAs above a value need e-stamping, and who pays.

**Sources:** BSA s.63: https://indiankanoon.org/doc/125020475/ (seen 06-Oct-2026); click-wrap (secondary): https://www.mondaq.com/india/it-and-internet/1305896/though-click-wraps-are-legal-can-minors-enter-click-wraps (06-Oct-2026); WB stamp/GRIPS (secondary, property-focused): https://cleartax.in/s/stamp-duty-and-registration-charges-in-west-bengal (06-Oct-2026) [?].

---

## 16. Email: transactional and marketing

- **India:** there is no email-specific anti-spam law. **TRAI TCCCPR 2018** (as amended) covers commercial **SMS and voice calls**, not email. If we ever send SMS or WhatsApp, its DLT registration rules apply [?]. Under DPDP, marketing email to individuals (including work emails) needs **consent** (see §3). Enquiry replies and service email are s.7(a).
- **US, CAN-SPAM** (applies to B2B too): no misleading headers or subjects; mark ads as ads; **a valid physical postal address**; a working **opt-out honoured within 10 business days**; we are responsible even if a vendor sends the email.
- **EU / UK:**
  - EU: ePrivacy Art. 13. Consent is needed for marketing to individuals; B2B rules differ by member state [?]; the "soft opt-in" for existing clients covers similar services.
  - UK: PECR reg 22 covers individual subscribers only. Corporate addresses can receive B2B marketing without consent, but the sender must identify itself and offer an opt-out. UK GDPR still applies to named people.
  - Either way, always include an unsubscribe link.
- **Deliverability** (not law, but practical): Gmail and Yahoo bulk-sender rules from 2024 require SPF, DKIM, DMARC and **one-click unsubscribe (RFC 8058)** for bulk marketing. Set these up in SES.
- **Design:**
  - Separate SES configuration sets for transactional and marketing mail.
  - Marketing only to contacts with `marketing_consent=true`, with the source and timestamp stored.
  - A suppression list.
  - Footer: legal name, postal address, why you are receiving this, unsubscribe.
  - Never send marketing from the portal's transactional stream.

**Sources:** FTC CAN-SPAM guide: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business (reachable 06-Oct-2026).

---

## 17. security.txt and vulnerability disclosure

- There is no legal requirement in India, the EU (for us) or the US. **RFC 9116** defines `/.well-known/security.txt`. `Contact` and `Expires` are required; `Policy`, `Preferred-Languages` and `Canonical` are recommended.
- Unauthorised access is an offence or civil wrong under **IT Act s.43/66**. We **cannot give legal immunity**, but we can promise not to pursue good-faith researchers. CERT-In runs a Responsible Vulnerability Disclosure and Coordination programme. Refer researchers there if they prefer.

**Suggested safe-harbour wording (draft, VERIFY WITH CA/LEGAL)**
> "If you make a good-faith effort to follow this policy, we will consider your research authorised, we will not pursue or support legal action against you, and we will work with you to understand and fix the issue quickly. Please: test only against your own accounts and data; do not access, change or keep other people's data (stop and report at first sight of personal data); no denial-of-service, spam, social engineering or physical attacks; give us 90 days before public disclosure. This policy cannot bind third parties (such as our hosting providers) or authorities. We do not offer paid bounties at this time."

Scope: techaust.com, portal.\*, admin.\* (admin login only, no brute force). Out of scope: third-party services (Cloudflare, Razorpay and so on). Template source: disclose.io.

**Sources:** RFC 9116: https://www.rfc-editor.org/rfc/rfc9116 (reachable 06-Oct-2026); CERT-In RVDCP: https://www.cert-in.org.in/RVDCP.jsp (reachable 06-Oct-2026); https://disclose.io/ (reachable 06-Oct-2026).

---

## 18. Accessibility

- **India, current law.** RPwD Act 2016 s.40 (accessibility standards) and **s.46** (service providers, **government or private**, must provide services in line with the accessibility rules). RPwD Rules 2017 **Rule 15** points to GIGW and the BIS standard **IS 17802 (Parts 1 and 2)**, which aligns with WCAG 2.1. The Supreme Court in *Rajive Raturi v. Union of India* (8 Nov 2024) told the Government to make the rules mandatory rather than advisory.
- **New in 2026:** the **draft RPwD (Amendment) Rules 2026**, S.O. 3962(E) dated 16 July 2026 (published 20 July 2026). They would cover every establishment that makes ICT available to people in India. Requirements: **IS 17802**, **Accessibility Conformance Reports**, and deadlines of **18 months for establishments under ₹500 crore turnover** (1 year for larger ones). **This is still a draft.** The final text and dates are [?].
- **GIGW 3.0** binds government sites only. If we build for a government client, GIGW applies to that project.
- **EU Accessibility Act** (Directive 2019/882, applies from 28 June 2025): it mostly covers **consumer** products and services, such as e-commerce to consumers and banking. **Art. 4(5) exempts microenterprises providing services** (fewer than 10 staff and €2 m or less turnover or balance sheet). **We are exempt**, but EU clients may contractually require their own products to meet EN 301 549. That is a sales opportunity.
- **US ADA Title III:** courts disagree about web-only businesses. The DOJ's 2022 guidance gives no fixed standard for private sites. The 2024 Title II rule (WCAG 2.1 AA) binds state and local government only. Risk for a B2B studio is low, but US clients increasingly ask for WCAG 2.1/2.2 AA in their deliverables.
- **Conclusion:** build the site and portal to **WCAG 2.2 AA**, which is a superset of WCAG 2.1 and IS 17802 for the web. Publish an **Accessibility statement** with the standard, known gaps and a contact. Keep a short self-assessed ACR/VPAT so we are ready if the draft Indian rule is finalised.

**Sources:** draft RPwD Amendment Rules 2026 (secondary, 29-Jul-2026): https://www.mondaq.com/india/compliance/1824050/the-new-accessibility-conformance-regime-key-takeaways-from-the-draft-rpwd-amendment-rules-2026 (06-Oct-2026); India framework (secondary): https://www.azbpartners.com/bank/bridging-the-digital-divide-indias-evolving-accessibility-framework/ (seen 06-Oct-2026); EAA: https://eur-lex.europa.eu/eli/dir/2019/882/oj (canonical; not fetched); ADA guidance: https://www.ada.gov/resources/web-guidance/ (reachable 06-Oct-2026).

---

## Drafting checklists (VERIFY WITH CA/LEGAL)

### A. Privacy notice (one page, with a short standalone summary on top)
- [ ] Summary box (Rule 3 "understandable on its own"): who we are; what we collect; why; who we share with; your choices; contact.
- [ ] **Who we are:** TecHaust Technologies, sole proprietorship of [Proprietor name], [full address, Balurghat, Dakshin Dinajpur, WB, PIN], GSTIN [x], email, phone.
- [ ] **Contact person for privacy questions (DPDP Rule 9)** and **Grievance Officer (SPDI 5(9) / E-Com r.4)**: name, designation, email (privacy@ / grievance@), postal address. Response times: acknowledge in 48 h, resolve within 30 days (and never later than 90 days).
- [ ] **Itemised data table** per system: website visitors (IP, device, Turnstile signals, analytics if consented); enquirers (name, email, company, phone optional, budget band, message); clients' contacts (name, title, work email, phone, portal activity); proposal acceptance (typed name, IP, timestamp, user-agent); billing (invoice details, GSTIN, payment status and references, never card data); bookings (Cal.com); email correspondence (Zoho); error and diagnostic data (Sentry); staff (a separate internal notice).
- [ ] **Purpose and basis for each item:** DPDP (legitimate use s.7(a), consent, legal obligation) plus a GDPR column.
- [ ] **Recipients and processors**, with country: Cloudflare (global/US; hosting, D1, R2, Turnstile, Web Analytics), AWS (SES and S3, Mumbai), Razorpay (India), Stripe (if used), PayPal (cross-border), Google (GA4, US, with consent), Zoho (mail), Cal.com (booking), Sentry (errors). We do not sell data.
- [ ] **Cross-border**: data stored outside India (US/EU). Lawful under DPDP s.16 (no restricted countries notified). EU/UK safeguards (SCCs/DPF).
- [ ] **Retention** table (see §6), including the 1-year log minimum and the GST 72 months.
- [ ] **Security** summary (Rule 6 measures in plain words).
- [ ] **Your rights:** access, correction, completion, updating, erasure, withdrawing consent (as easy as giving it), nomination, grievance. How to apply (form link + email), the identifier we need (email / client ID), and identity verification.
- [ ] **Complaint to the Data Protection Board of India** (after using our grievance process; link to the Board's portal once live [?]). EU/UK: the right to complain to your supervisory authority or the ICO.
- [ ] **Cookies**: summary + link to the cookie policy + "Cookie settings" control.
- [ ] **Marketing**: only with opt-in; unsubscribe in every email.
- [ ] **Children**: not directed at under-18s.
- [ ] **EU/UK section**: controller, legal bases, legitimate interests explained, transfers, Art. 27 representative (or a statement), automated decisions (none), whether data is required.
- [ ] **US paragraph** (optional): no sale or sharing.
- [ ] **Language**: "Available in English, Hindi and Bengali; other Eighth Schedule languages on request" [?].
- [ ] **Breach**: we will inform you and the authorities as the law requires.
- [ ] Version, effective date, change log; we notify material changes by email to clients.

### B. Terms of Use (website)
- [ ] Parties and identity (trade name, proprietor, GSTIN, address); acceptance; changes.
- [ ] Site is information only. No offer. **"Starting from" prices are indicative. Proposals and MSA override.** **All prices exclude GST.**
- [ ] Demos, case studies, AI examples are illustrative; results vary; synthetic content labelled.
- [ ] IP ownership; limited licence; trademarks; feedback licence.
- [ ] Acceptable use (no attacks, scraping, spam, bypassing Turnstile; security testing only under our disclosure policy).
- [ ] Third-party links and services.
- [ ] Disclaimers; limitation of liability; nothing excludes liability that cannot be excluded by law; indemnity.
- [ ] Privacy, cookies, refund policy: by reference.
- [ ] Governing law India; exclusive jurisdiction at Balurghat (or Kolkata) [?]; arbitration for clients goes in the MSA.
- [ ] Contact / grievance officer; severability; entire site terms; version and date.
- [ ] Portal Terms addendum: magic-link security (do not forward links); authorised users only; uploads (client warrants rights, no malware, no unlawful or children's data unless agreed); acceptance of proposals by click is binding; record-keeping notice (we log IP and timestamp).

### C. Refund and Cancellation Policy (+ Delivery Policy for Razorpay)
- [ ] Scope (fixed-price projects, retainers, subscriptions/maintenance, consulting hours, bookings).
- [ ] Deposits; milestone earning and deemed acceptance; cancellation by client or by us; refund of unearned prepayments.
- [ ] Retainers: notice period, roll-over rules.
- [ ] Subscriptions: cancel anytime online, effective at period end; renewal reminders; no surprise charges.
- [ ] Process: how to request; 48 h acknowledgement; decision in ≤14 days; refund in 5 to 7 business days to the **original payment method**; currency and FX; gateway fees [?].
- [ ] GST credit notes; tax not refundable once paid to government except through a credit note [?].
- [ ] Chargebacks: contact us first; no waiver of card-network rights.
- [ ] **Delivery Policy**: digital delivery only; how and when; acceptance; no physical shipping.
- [ ] Contact / grievance officer; date and version.

### D. Cookie policy
- [ ] What cookies and similar technologies are; our approach (cookieless analytics by default; GA4 only with consent).
- [ ] Table: name, provider, purpose, category, duration (Turnstile `cf_*` [?], consent cookie, GA4 `_ga`, `_ga_<id>`, session cookies for the portal).
- [ ] Legal basis per region (necessary = no consent; analytics = consent).
- [ ] How to change or withdraw (footer link; browser settings).
- [ ] Consent Mode v2 statement (no Google tags before consent); retention of consent records.
- [ ] Last updated; contact.

### E. Security / Responsible disclosure page (+ `security.txt`)
- [ ] Our security commitments (encryption, MFA for staff, least privilege, logging, backups, vendor due diligence). Keep it modest; no unverifiable claims.
- [ ] How to report: security@ email, PGP key optional, what to include.
- [ ] Scope and out-of-scope; rules of engagement; safe-harbour wording (§17); 90-day disclosure timeline; we acknowledge within 3 business days; no bounty.
- [ ] Incident communication: how we notify clients, and our CERT-In / DPDP duties summarised.
- [ ] `security.txt`: Contact, Expires (≤1 year), Policy URL, Preferred-Languages: en, Canonical.

### F. Client-facing Data Processing note (attached to proposals / MSA)
- [ ] Roles: for our own client-relationship data we are the **Data Fiduciary / controller**. For data in systems we build or run for the client, the **client is the Data Fiduciary / controller and we are the Data Processor** (DPDP s.8(2) "valid contract"; GDPR Art. 28).
- [ ] We process only on documented instructions; confidentiality of staff; security per Rule 6 (encryption, access control, logs kept 1 year, backups).
- [ ] Sub-processors list (as above) with notice of changes and a right to object.
- [ ] **Breach notice to the client** without undue delay (target: within 24 hours of confirmation) with the information they need for **Rule 7** (Board within 72 h) and **GDPR Art. 33**; we also meet our CERT-In 6-hour duty where it applies to our systems.
- [ ] Help with data-principal rights requests and DPIAs (if the client is an SDF).
- [ ] Deletion or return at the end of the engagement (within 90 days), subject to legal retention (Rule 8(3) 1-year logs; client may instruct otherwise where law permits [?]).
- [ ] International transfers: where data is hosted; SCCs/IDTA for EU/UK clients.
- [ ] Children's or special-category data only if agreed in writing; client handles consent (Rule 10).
- [ ] Audit: questionnaire annually; on-site audit at the client's cost with notice.
- [ ] Liability for data matters follows the MSA cap (lawyer to set; consider a higher cap for data breaches caused by our negligence).
- [ ] Section 17(1)(d) note for foreign clients [?] (lawyer to decide whether to mention it).

---

## Questions a lawyer should confirm in a 1-hour review

1. Does the **CERT-In 2022 direction** bind a **sole proprietorship** (as a "body corporate")? Does that change after s.43A is deleted on 13 May 2027? Do we need to register a Point of Contact now?
2. Is it right that **SPDI Rules 2011** apply until **13 May 2027**? Is one combined "Grievance Officer + Rule 9 contact person" block enough for SPDI, DPDP and the E-Commerce Rules?
3. Do the **Consumer Protection (E-Commerce) Rules 2020** apply to a B2B services site that takes payments, and which obligations (Rule 4/5/6) bite?
4. Can we rely on **s.7(a) legitimate use** for enquiries, client contacts, invoices and portal logs? Is any separate consent needed for portal access logging or Sentry?
5. Does **s.17(1)(d)** (foreign data principals under a contract with a foreign person) cover only data we process as a processor for foreign clients, or also the foreign client's own staff contacts?
6. **Language:** is "English, Hindi and Bengali, other Eighth Schedule languages on request" enough to satisfy s.5(3) and s.6(3)?
7. **Rule 8(3) 1-year retention:** does it override an erasure request for leads and portal users? How do we word this in the notice?
8. **GDPR:** do we fall under Art. 3(2), and can we rely on the **Art. 27(2) "occasional" exemption** (EU and UK), or should we appoint representatives now?
9. **Jurisdiction:** Balurghat courts or Kolkata? Which commercial court serves Dakshin Dinajpur? Should the MSA use arbitration (seat, institution, online hearings) for Indian and foreign clients?
10. **Liability caps:** reasonable caps for the website terms and the MSA (for example, fees paid in the last 12 months), and carve-outs for data breach and IP infringement.
11. **Click-to-accept proposals:** is our evidence pack enough under the Contract Act, IT Act s.10A and BSA s.63? When should we use Aadhaar eSign or a DSC instead?
12. **West Bengal stamp duty** on e-accepted proposals and MSAs: is it payable, how much, and through e-stamping or GRIPS? What happens if a document is not stamped?
13. **Refund policy and GST:** deposit non-refundability (enforceability against B2B clients); the credit-note time limits; whether refunds of export invoices raise FEMA/FIRC issues.
14. **Accessibility:** if the **draft RPwD Amendment Rules 2026** are finalised, does a micro B2B firm's marketing site and client portal fall within "establishment … making available ICT to persons in India"?
15. **Marketing email:** for Indian B2B contacts, is opt-in consent needed under DPDP, or can s.7(a) cover follow-ups after an enquiry? How long can we email a lead who went quiet?

---

## Changes this research makes to the planned design

1. **Logs:** keep access, audit and security logs for **at least 12 months**, outside Cloudflare's short default retention (DPDP Rule 6(1)(e), 8(3); CERT-In 180 days). Sync clocks to NTP.
2. **Erasure** cannot be instant or total. Use legal holds, keep a tombstone record, and enforce the 1-year log minimum and GST 72 months.
3. **Rights-request workflow** in admin and portal with a 30-day SLA (90-day hard stop) and a Rule 9 contact block in every reply.
4. **Consent records** (notice version, language, timestamp) for cookies and marketing (s.6(10) burden of proof). Marketing opt-in as a **separate unticked checkbox** on the quote form.
5. **Incident runbook:** CERT-In 6 h, Board brief notice without delay, then the detailed report within 72 h; notify affected people; GDPR 72 h.
6. **Payments:** **Stripe is invite-only in India.** Make Razorpay primary (domestic and international cards), PayPal for cross-border only, and keep the gateway layer swappable. Refunds go to the original method.
7. **Policy pages:** Razorpay requires Terms, Privacy, Refund/Cancellation, **Shipping/Delivery**, Contact Us and Pricing before going live.
8. **Accessibility:** target WCAG 2.2 AA from the start (draft 2026 Indian rules).
9. **Proposal acceptance:** an evidence pack with a document hash and an emailed acceptance certificate. Optional eSign for large deals.
10. **Prices:** show "+ GST" next to every price. No urgency timers.
