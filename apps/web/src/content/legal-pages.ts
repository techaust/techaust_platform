// The legal pages and the security policy (WEB-LEGAL, WEB-SEC): docs/07-content-appendix/A-legal-pages.md v0.3 (2026-10-28) §1–§6 and
// §8, word for word. Every page is drafted without a lawyer and checked against the research register (08-C, owner rule 8); the
// optional lawyer review of the OPEN points (08-C §5) is the owner's decision before launch. The "(Researched, 08-C …)" and
// "(OPEN, 08-C …)" notes 07-A writes inline stay out of the pages and are kept here as comments next to the text they qualify.
//
// Typesetting only: curly apostrophes and quotes; e-mail addresses written as Markdown links to themselves (mailto) so
// they can be clicked, and 07-A's Markdown links as written; a bold lead that 07-A ends with "." becomes the section
// heading on the pages with numbered sections (privacy, terms), without that full stop. Numbers are 07-A's. The
// version line and the version log ("Changes") come from content/legal.ts (lib/legal.ts), not from here; 07-A's
// "*Version x · Effective <date>*" footers are replaced by that line at the top of each page.
// {{postal_address}} renders site.postalAddress, or a marked gap while the owner hasn't supplied it.
// "Cookie settings" links (#cookie-settings) open the footer's preferences dialog (CopyText).
import { money, SETTINGS_DEFAULTS } from "@techaust/core";
import { site } from "../config/site";
import type { LegalSlug } from "../lib/legal";
import { displayAmount } from "../lib/prices";

export type LegalBlock =
  | { p: string }
  | { ul: string[] }
  | { ol: { text: string; list?: string[] }[] }
  | { quote: string }
  | { table: { head: string[]; rows: string[][] } }
  | { pre: string };

export type LegalSection = { id: string; num?: string; title: string; blocks: LegalBlock[] };

export type LegalDoc = {
  slug: LegalSlug;
  /** The page's h1 (07-A's heading for the page). */
  title: string;
  /** Title: the h1 with the site suffix. Description: docs/07-content-appendix/F (07-A gives none). */
  meta: { title: string; description: string };
  /** Privacy only: "Summary (shown first, in a box)". */
  summary?: { term: string; text?: string; list?: string[] }[];
  /** Text before the first numbered section (or the whole page when it has no sections). */
  blocks?: LegalBlock[];
  sections?: LegalSection[];
};

const mail = (a: string) => `[${a}](mailto:${a})`;
const PRIVACY = mail("privacy@techaust.com");
const CONTACT = mail("contact@techaust.com");
const BILLING = mail("billing@techaust.com");
const SECURITY = mail("security@techaust.com");

/**
 * 07-A §2 item 10: the website liability cap (Settled by the lead on the safest reading, 2026-10-30 (08-C RB-23): the ₹10,000 cap stays, with a consumer carve-out; 07-ZE, built in T6). Not a catalogue price, so not a {{price}} token:
 * an integer amount in paise, formatted by @techaust/core like every amount on the site (never typed as text).
 */
const WEBSITE_LIABILITY_CAP = displayAmount(
  money(SETTINGS_DEFAULTS.payment_terms.websiteLiabilityCapInrMinor, "INR"),
);

/**
 * 07-A §5 (cookie policy) while the GA4 ID setting is empty (lead decision 2026-10-22, docs/13): the Google Analytics
 * sentence and the `_ga` row are left out. They come back as written when site.ga4Id is set.
 */
const GA_ON = Boolean(site.ga4Id);

const makePrivacy = (ga: boolean): LegalDoc => ({
  slug: "privacy",
  title: "Privacy notice",
  // 07-F (owner-approved 2026-10-22).
  meta: {
    title: "Privacy notice | TecHaust",
    description:
      "What personal data TecHaust Technologies collects and why, who we share it with, how long we keep it, and how to use your rights.",
  },
  summary: [
    {
      term: "Who we are",
      text: "TecHaust Technologies, a sole proprietorship based in Balurghat, West Bengal, India. We build software and automation for businesses.",
    },
    {
      term: "What we collect",
      list: [
        "what you send us (name, work email, company, phone, project details)",
        "what our systems need to work (technical logs, security checks)",
        "for clients, what we need to deliver and bill (contacts, documents, invoices, payment records)",
      ],
    },
    {
      term: "Why",
      text: "to answer you, prepare proposals, deliver and support our work, bill and get paid, keep our systems secure, and meet legal duties such as GST record-keeping.",
    },
    {
      term: "Who sees it",
      text: "our team, and service providers that host, email or process payments for us (listed below). **We don’t sell personal data.**",
    },
    {
      term: "Your choices",
      text: `${ga ? "analytics cookies only with your consent; " : ""}marketing emails only if you opt in; you can ask us to access, correct or delete your data.`,
    },
    { term: "Contact", text: `Rupak Sarkar, Founder (Grievance Officer) · ${PRIVACY}.` },
  ],
  sections: [
    {
      id: "responsible",
      num: "1",
      title: "Who is responsible for your data",
      blocks: [
        {
          p: "TecHaust Technologies (“TecHaust”, “we”) is a sole proprietorship based at {{postal_address}}, India. For data about our website visitors, enquirers and our clients’ contacts, we decide how and why it is used. Under India’s Digital Personal Data Protection Act, 2023 that makes us the **Data Fiduciary**; under the GDPR/UK GDPR, the **controller**.",
        },
        {
          p: "When we build or run systems **for** a client that contain the client’s customers’ or staff’s data, the client is responsible for that data and we act on their instructions (as a **Data Processor**). Our client contracts cover that separately.",
        },
      ],
    },
    {
      id: "what-we-collect",
      num: "2",
      title: "What we collect and why",
      blocks: [
        {
          table: {
            head: ["Who you are", "Data", "Why we use it", "Basis (India / EU-UK)"],
            rows: [
              [
                "**Website visitor**",
                "IP address, browser and device details, pages visited (cookieless Cloudflare Web Analytics); Cloudflare Turnstile security signals",
                "Run and secure the website; understand overall usage",
                // Settled by the lead on the safest reading, 2026-10-30 (08-C RB-12): for the acceptance IP address and browser only, GDPR Art. 6(1)(f) for EU and UK persons and DPDP s.7(a) in India; the acceptance record is kept with the offer (RB-37 (b)).
                "India: provided voluntarily by using the site for that purpose (DPDP s.7(a)). EU/UK: legitimate interests",
              ],
              // Google Analytics rows: only while GA is on (site.ga4Id set).
              ...(ga
                ? [
                    [
                      "**Visitor who accepts analytics**",
                      "Google Analytics identifiers and usage events",
                      "Understand which pages help visitors",
                      "**Consent** (withdraw at any time via “Cookie settings”)",
                    ],
                  ]
                : []),
              [
                "**Enquirer** (contact or quote form, email, WhatsApp, booking)",
                "Name, work email, company, country, phone/WhatsApp (optional), project details, budget band, timeline, preferred call time, the page you came from",
                "Reply, assess fit, prepare a proposal",
                "Information you provide voluntarily for that purpose (DPDP s.7(a)) / steps before a contract, legitimate interests",
              ],
              [
                "**Newsletter subscriber** (only if you tick the box)",
                "Email, name, consent record",
                "Occasional updates (about one a month)",
                "**Consent**",
              ],
              [
                "**Client contact**",
                "Name, title, work email, phone, portal sign-in activity, messages and files you share, proposal acceptance details (typed name, time, IP address, browser), billing details (company name, address, GSTIN), payment status and references",
                "Deliver services, give portal access, invoice, collect payment, keep records",
                // Settled by the lead on the safest reading, 2026-10-30 (08-C RB-12): for the acceptance IP address and browser only, GDPR Art. 6(1)(f) for EU and UK persons and DPDP s.7(a) in India; the acceptance record is kept with the offer (RB-37 (b)).
                "India: provided voluntarily for that purpose (DPDP s.7(a)); **legal obligation** for tax records. EU/UK: contract; **legal obligation** for tax records",
              ],
              [
                "**Everyone**",
                "Security logs (sign-ins, access to admin and portal, IP address, time)",
                "Protect accounts and data; investigate incidents",
                "Legal obligation and security",
              ],
            ],
          },
        },
        {
          p: "**We never collect or store card numbers, UPI PINs or bank passwords.** Payments happen on our payment providers’ secure pages.",
        },
      ],
    },
    {
      id: "sharing",
      num: "3",
      title: "Who we share it with",
      blocks: [
        { p: "We use these service providers (“processors”). Each receives only what it needs:" },
        {
          table: {
            head: ["Provider", "What for", "Where"],
            rows: [
              [
                "Cloudflare, Inc.",
                "Website and application hosting, database, file storage, security (Turnstile), cookieless analytics",
                "Global network (including the USA and EU)",
              ],
              ["Amazon Web Services (SES, S3)", "Sending email; encrypted backups", "India (Mumbai region)"],
              ["Razorpay Software Pvt Ltd", "Payments in INR", "India"],
              ["Stripe (if used)", "Card payments in USD", "USA / global"],
              ["PayPal", "Payments in USD", "Global"],
              ...(ga
                ? [["Google (Analytics)", "Website analytics, **only with your consent**", "USA / global"]]
                : []),
              ["Zoho Corporation", "Our email inbox", "India"],
              ["Cal.com", "Call booking (if you use the booking link)", "USA / EU"],
              [
                "Meta Platforms (WhatsApp)",
                "Messages you exchange with us on WhatsApp, if you choose to contact us there",
                "USA / global",
              ],
              ["Sentry", "Error monitoring (personal data removed where possible)", "USA"],
            ],
          },
        },
        {
          p: "We may also disclose information when the law requires it, or to protect our rights in a legal dispute.",
        },
      ],
    },
    {
      id: "outside-india",
      num: "4",
      title: "Data stored outside India",
      blocks: [
        {
          // OPEN (08-C RB-16, watch): any DPDP s.16(1) notification restricting a country we use? None reported to September 2026.
          p: "Some providers store data outside India. Indian law currently permits this, as the Government has not restricted transfers to these countries. For visitors and clients in the EU or UK, we rely on our providers’ standard contractual clauses or equivalent safeguards.",
        },
      ],
    },
    {
      id: "retention",
      num: "5",
      title: "How long we keep it",
      blocks: [
        {
          table: {
            head: ["Data", "How long"],
            rows: [
              ["Enquiries that don’t become projects", "12 months after our last contact, then deleted"],
              [
                "Client records, proposals, invoices, payment records",
                "At least 8 years after the end of the financial year (GST and tax law); our default is 10 years",
              ],
              ["Security and access logs", "13 months"],
              ["Email delivery records", "13 months"],
              ...(ga ? [["Analytics (Google, with consent)", "14 months (Google’s setting)"]] : []),
              // Owner policy, above the one-year legal minimum: Researched 2026-10-28, DPDP Rules 2025 (08-C RB-28).
              ["Newsletter consent", "Until you unsubscribe, plus proof of consent for 3 years after"],
              [
                "Backups",
                "Rolling encrypted backups are kept for up to 90 days, so deleted data disappears from them within 90 days. Long-term archive copies hold only invoices, payments and other tax records (8–10 years, as above), never enquiries or contact lists",
              ],
            ],
          },
        },
        {
          p: "If the law requires us to keep something longer (for example, during a dispute), we keep it only for that purpose.",
        },
      ],
    },
    {
      id: "protection",
      num: "6",
      title: "How we protect it",
      blocks: [
        {
          ul: [
            "Encryption in transit (HTTPS) and at rest.",
            "Two-factor sign-in for our staff, and role-based access.",
            "Audit logs of who accessed or changed records.",
            "Encrypted, off-site backups.",
            "Written agreements with our providers.",
          ],
        },
        {
          p: "No system is perfectly secure. If a breach affects you, we will tell you and the authorities as the law requires.",
        },
      ],
    },
    {
      id: "your-rights",
      num: "7",
      title: "Your rights",
      blocks: [
        { p: "You can ask us to:" },
        {
          ul: [
            "**access** a summary of your personal data and how we use it",
            "**correct, complete or update** it",
            "**erase** it, where we don’t need to keep it by law",
            "**withdraw consent** (as easily as you gave it; this doesn’t affect what we did before)",
            "**nominate** someone to exercise your rights if you die or become unable to",
          ],
        },
        {
          p: `Email **${PRIVACY}**, or use “Request my data” in the client portal. We may need to confirm your identity. We acknowledge requests within 48 hours and respond within 30 days.`,
        },
      ],
    },
    {
      // The GDPR / UK GDPR section as a whole (07-A heading of §7a). Settled by the lead on the safest reading, 2026-10-30 (08-C RB-27): a representative is appointed before the first EU or UK client (owner's choice).
      id: "eu-uk",
      num: "7a",
      title: "If you are in the EU or UK",
      blocks: [
        {
          ul: [
            `**Who controls your data:** TecHaust Technologies (Rupak Sarkar, proprietor), {{postal_address}}, India · ${PRIVACY}.`,
            "**Extra rights under the GDPR / UK GDPR:** you can also ask us to **restrict** how we use your data, to give it to you in a **portable** format, and you can **object** to our use of it based on legitimate interests, and to direct marketing at any time.",
            "**Our legitimate interests** (where the table above says so): keeping the website secure and free of abuse, replying to business enquiries, and keeping proper business records.",
            "**Automated decisions:** we don’t make decisions about you by purely automated means.",
            // Settled by the lead on the safest reading, 2026-10-30 (08-C RB-27): a representative is appointed before the first EU or UK client (owner's choice).
            "**Representative:** we haven’t appointed a representative in the EU or UK.",
            "**Transfers:** see section 4.",
          ],
        },
        {
          p: "**Complaints:** please contact our Grievance Officer first (below). If you’re not satisfied, you can complain to the **Data Protection Board of India** once its complaint process is available. In the EU/UK, you can complain to your local data-protection authority (in the UK, the ICO).",
        },
      ],
    },
    {
      id: "grievance-officer",
      num: "8",
      title: "Grievance Officer and privacy contact",
      blocks: [
        { p: `**Rupak Sarkar**, Founder, TecHaust Technologies · ${PRIVACY} · {{postal_address}}, India.` },
        // 07-A v0.3: Researched 2026-10-28, SPDI Rule 5(9) and DPDP (08-C RB-13, RB-22).
        {
          p: "We acknowledge complaints within 48 hours and resolve them within one month. We send you a copy of your complaint as we recorded it.",
        },
      ],
    },
    {
      id: "cookies",
      num: "9",
      title: "Cookies",
      blocks: [
        {
          p: "See our [Cookie policy](/cookies). You can change your choice at any time with “[Cookie settings](#cookie-settings)” in the footer.",
        },
      ],
    },
    {
      id: "children",
      num: "10",
      title: "Children",
      blocks: [
        { p: "Our services are for businesses. We don’t knowingly collect data from children (under 18)." },
      ],
    },
    {
      id: "languages",
      num: "11",
      title: "Languages",
      blocks: [
        {
          // 08-B §2, DPDP s.5(3) (text of 2026-10-06).
          p: "This notice is available in English. If you’d like it in Hindi, Bengali or another language listed in the Eighth Schedule to the Constitution of India, email us and we’ll provide it.",
        },
      ],
    },
    {
      id: "changes",
      num: "12",
      title: "Changes",
      blocks: [
        {
          p: "We’ll post changes here and update the date. For significant changes affecting clients, we’ll email you.",
        },
      ],
    },
  ],
});

const terms: LegalDoc = {
  slug: "terms",
  title: "Website terms of use",
  // 07-F (owner-approved 2026-10-22).
  meta: {
    title: "Website terms of use | TecHaust",
    description:
      "The terms for using techaust.com and our client portal: prices and tax, our content, acceptable use, liability and the law that applies.",
  },
  sections: [
    {
      id: "about-these-terms",
      num: "1",
      title: "About these terms",
      blocks: [
        {
          p: "These terms apply to your use of techaust.com and our client portal. The site is run by TecHaust Technologies, a sole proprietorship based at {{postal_address}}, India. By using the site, you agree to these terms.",
        },
      ],
    },
    {
      id: "information-not-an-offer",
      num: "2",
      title: "Information, not an offer",
      blocks: [
        {
          p: "The site describes our services. Prices marked “from” are **indicative starting prices for the minimum scope described**. Every engagement is agreed in a **written proposal** (and, where used, a master services agreement). If anything on this site conflicts with your proposal or contract, the proposal or contract wins.",
        },
      ],
    },
    {
      id: "prices-and-tax",
      num: "3",
      title: "Prices and tax",
      blocks: [
        {
          // Researched 2026-10-28, s.2(6) IGST (08-C RA-18).
          p: "Prices for clients in India **exclude GST**, which is added at the applicable rate. Prices for international clients are in USD and are invoiced from India.",
        },
      ],
    },
    {
      id: "examples-and-results",
      num: "4",
      title: "Examples and results",
      blocks: [
        {
          p: "Diagrams and demos marked “Illustrative” are examples, not real client systems. Case studies describe specific projects. Your results depend on your circumstances.",
        },
      ],
    },
    {
      id: "our-content",
      num: "5",
      title: "Our content",
      blocks: [
        {
          p: "The text, design, code and graphics on this site belong to TecHaust or its licensors. You may view and share pages for personal or internal business use. You may not copy, scrape or republish them without permission. Third-party names and logos belong to their owners.",
        },
      ],
    },
    {
      id: "acceptable-use",
      num: "6",
      title: "Acceptable use",
      blocks: [
        { p: "Don’t:" },
        {
          ul: [
            "attack, overload or probe the site, except as allowed by our [security policy](/security)",
            "submit spam or automated form entries",
            "bypass security checks",
            "upload malware",
            "use the site unlawfully",
          ],
        },
      ],
    },
    {
      id: "client-portal",
      num: "7",
      title: "Client portal",
      blocks: [
        {
          p: "Access is for authorised contacts of our clients. Keep sign-in links private and don’t forward them. You’re responsible for files you upload: you confirm you have the right to share them and that they contain no malware. **Accepting a proposal in the portal (typing your name and clicking Accept) forms a binding agreement** on the terms of that proposal, and we keep a record of it (name, email, time, IP address, browser and a fingerprint of the document).",
        },
      ],
    },
    {
      id: "third-party-links",
      num: "8",
      title: "Third-party links",
      blocks: [{ p: "We aren’t responsible for other websites we link to." }],
    },
    {
      id: "no-warranty",
      num: "9",
      title: "No warranty for the website",
      blocks: [
        {
          p: "The site is provided “as is”. We try to keep it accurate and available, but we don’t promise it will be error-free or uninterrupted.",
        },
      ],
    },
    {
      id: "liability",
      num: "10",
      title: "Liability",
      blocks: [
        {
          // Settled by the lead on the safest reading, 2026-10-30 (08-C RB-23): the ₹10,000 cap stays, with a consumer carve-out on the website and proposal terms (07-ZE lines 6, 14, 15; built in T6).
          p: `To the extent the law allows, we aren’t liable for indirect or consequential losses from using this website, and our total liability for use of the website is limited to ${WEBSITE_LIABILITY_CAP}. Liability for services is governed by your proposal or contract. Nothing here limits liability that can’t be limited by law, such as liability for fraud.`,
        },
      ],
    },
    {
      id: "privacy",
      num: "11",
      title: "Privacy",
      blocks: [{ p: "See our [Privacy notice](/privacy) and [Cookie policy](/cookies)." }],
    },
    {
      id: "law-and-courts",
      num: "12",
      title: "Law and courts",
      blocks: [
        {
          // Settled by the lead on the safest reading, 2026-10-30 (08-C RB-23): Balurghat kept, with a consumer carve-out on the website and proposal terms (07-ZE; built in T6); arbitration for client contracts goes in the MSA.
          p: "These terms are governed by the laws of India. The courts at **Balurghat, Dakshin Dinajpur, West Bengal** have exclusive jurisdiction, subject to any dispute-resolution clause in a signed contract.",
        },
      ],
    },
    {
      id: "changes",
      num: "13",
      title: "Changes",
      blocks: [{ p: "We may update these terms. The version and date below show the current one." }],
    },
    {
      id: "contact",
      num: "14",
      title: "Contact",
      blocks: [{ p: `${CONTACT} · Grievance Officer: Rupak Sarkar, Founder, ${PRIVACY}.` }],
    },
  ],
};

const refunds: LegalDoc = {
  slug: "refund-policy",
  title: "Refunds and cancellations",
  // 07-F (owner-approved 2026-10-22).
  meta: {
    title: "Refunds and cancellations | TecHaust",
    description:
      "How cancellations and refunds work for fixed-price projects, small fixed jobs, care plans and subscriptions, and how to ask for a refund.",
  },
  blocks: [
    // A product term (07-A §3).
    {
      quote:
        "This policy summarises our standard terms. Your proposal may set different terms for your project, and if so, the proposal applies.",
    },
    {
      ol: [
        {
          text: "**Fixed-price projects**",
          list: [
            "**Advance (usually 40 %):** reserves our team’s time and pays for planning. If you cancel **before work starts**, we refund it in full, minus any third-party costs we’ve already paid for you. Once work has started, the advance covers work done and is not refundable.",
            "**Milestone payments** are earned when the milestone is delivered. A milestone counts as accepted if you approve it, or if you don’t raise specific issues within **7 business days** of delivery.",
            "**If you cancel mid-project:** you pay for work done up to cancellation plus committed third-party costs. We refund any payment for work not yet done.",
            "**If we cancel or can’t deliver:** we refund everything paid for undelivered work.",
          ],
        },
        {
          text: "**Small fixed jobs** (Discovery Sprint, audits, single workflows; paid upfront): fully refundable if cancelled before the kick-off call; after kick-off, refundable only for work not yet done.",
        },
        {
          text: "**Care plans, retainers and subscriptions** (billed monthly in advance): cancel any time with **30 days’ written notice** (email is fine). No refund for a month that has started, except where we failed to provide the service. Unused hours don’t carry over (except as stated in your plan).",
        },
        {
          text: `**How to ask:** email ${BILLING} or use the portal. We acknowledge within 48 hours and decide within 14 days.`,
        },
        {
          // 07-A v0.3: Researched 2026-10-28, RBI Payment Aggregator Directions 2025 para 10(f) (08-C RB-07, RB-24).
          text: "**How refunds are paid:** to the **original payment method** or, if you ask, to another account in your own name (as payment rules require), within 5–7 business days of approval. Banks and card networks may take longer. Refunds are made in the currency you paid. Exchange-rate differences aren’t covered. Payment-gateway fees aren’t charged to you.",
        },
        // 07-A v0.3: Researched 2026-10-28, s.34(2) CGST (08-C RA-03, RA-22).
        {
          text: "**GST:** for Indian invoices, a refund is documented with a **credit note**, issued within the GST time limit (30 November after the financial year of the invoice).",
        },
        {
          text: "**Disputes:** please contact us first. We’d rather fix the problem. This doesn’t affect your rights with your bank or card provider.",
        },
        { text: `**Contact:** ${BILLING} · {{postal_address}}, India.` },
      ],
    },
  ],
};

const delivery: LegalDoc = {
  slug: "delivery-policy",
  title: "Delivery policy",
  // 07-F (owner-approved 2026-10-22).
  meta: {
    title: "Delivery policy | TecHaust",
    description:
      "How we deliver software, designs and automations: nothing is shipped physically. Delivery methods, timelines, acceptance and ownership.",
  },
  blocks: [
    {
      ol: [
        {
          text: "**What we deliver:** software, designs, documents, automations and services. **Nothing is shipped physically.**",
        },
        {
          text: "**How:** through our client portal, by email, in code repositories (such as GitHub) under your account or transferred to it, or by deploying to hosting you choose.",
        },
        {
          text: "**When:** timelines and milestones are set out in your proposal. We update you weekly and tell you promptly if a date is at risk.",
        },
        {
          text: "**Acceptance:** each milestone is reviewed by you, as described in our [Refunds and cancellations](/refund-policy) policy.",
        },
        {
          text: "**Access and ownership:** on full payment, ownership of the deliverables passes to you as stated in your proposal.",
        },
        { text: `**Questions:** ${CONTACT}.` },
      ],
    },
  ],
};

const cookieRows = (ga: boolean): string[][] => [
  ["`ta_consent` (browser storage)", "TecHaust", "Remembers your cookie choice", "Necessary", "12 months"],
  [
    "`ta_theme`, `ta_currency` (browser storage)",
    "TecHaust",
    "Remember light/dark theme and INR/USD choice",
    "Necessary (preferences)",
    "Until cleared",
  ],
  ["Turnstile (`cf_*`, if set)", "Cloudflare", "Protects forms from bots", "Necessary", "Session"],
  ...(ga
    ? [
        [
          "`_ga`, `_ga_<id>`",
          "Google",
          "Analytics (only after consent)",
          "Analytics",
          "Up to 2 years (GA4 default)",
        ],
      ]
    : []),
  [
    "`__Host-ta_portal`",
    "TecHaust",
    "Keeps you signed in to the client portal",
    "Necessary",
    "Up to 90 days",
  ],
  ["`__Host-ta_admin`", "TecHaust", "Keeps staff signed in to the admin", "Necessary", "Up to 7 days"],
];

const makeCookies = (ga: boolean): LegalDoc => ({
  slug: "cookies",
  title: "Cookie policy",
  // 07-F (owner-approved 2026-10-22).
  meta: {
    title: "Cookie policy | TecHaust",
    description:
      "The cookies and browser storage techaust.com uses, why each is needed and how long it lasts. We count visits with cookieless analytics.",
  },
  blocks: [
    { p: "**What cookies are.** Small files or browser storage that a website uses to remember things." },
    {
      p: `**Our approach.** Our website works without analytics cookies. We use Cloudflare Web Analytics, which doesn’t use cookies, to count visits.${ga ? " **Google Analytics loads only if you click “Accept analytics”.**" : ""}`,
    },
    { table: { head: ["Name", "Provider", "Purpose", "Type", "Duration"], rows: cookieRows(ga) } },
    {
      // While GA is off there is nothing to accept or reject (lead wording, docs/13 2026-10-22).
      p: ga
        ? "**Your choice.** Use “[Cookie settings](#cookie-settings)” in the footer to accept or reject analytics at any time. Rejecting is as easy as accepting. You can also delete cookies in your browser. We record your choice (and when you made it) so we can show we respected it."
        : "**Your choice.** You can delete cookies in your browser.",
    },
  ],
});

const security: LegalDoc = {
  slug: "security",
  title: "Security and responsible disclosure",
  // 07-F (owner-approved 2026-10-22).
  meta: {
    title: "Security and responsible disclosure | TecHaust",
    description:
      "How we protect our systems and how to report a vulnerability: what is in scope, the rules for testing, and our safe harbour for good-faith research.",
  },
  blocks: [
    {
      p: "**How we protect our systems.** HTTPS everywhere, two-factor sign-in for staff, role-based access, audit logs, encrypted off-site backups and regular updates. We keep these claims modest and true.",
    },
    { p: `**Found a vulnerability?** Email **${SECURITY}** with:` },
    { ul: ["what you found", "where (URL or endpoint)", "steps to reproduce", "any proof-of-concept"] },
    { p: "We acknowledge within 3 business days." },
    {
      p: "**In scope:** techaust.com, portal.techaust.com, admin.techaust.com (the login page only; no brute-force attempts), hooks.techaust.com.",
    },
    {
      p: "**Out of scope:** third-party services we use (Cloudflare, Razorpay, Stripe, PayPal, Google, Zoho), denial-of-service, spam, social engineering and physical attacks.",
    },
    { p: "**Rules:**" },
    {
      ul: [
        "Test only against your own accounts and data.",
        "If you see anyone else’s personal data, stop and tell us. Don’t access, change or keep it.",
        "Give us 90 days to fix the issue before you disclose it publicly.",
      ],
    },
    {
      // Researched 2026-10-28, RFC 9116 and CERT-In's disclosure programme (08-C RB-29).
      p: "**Safe harbour:** if you act in good faith and follow this policy, we will treat your research as authorised, we won’t pursue or support legal action against you, and we’ll work with you to fix the issue quickly. This policy can’t bind third parties or the authorities. We don’t offer paid bounties at this time. You may also report through CERT-In’s vulnerability disclosure programme.",
    },
    // The file itself is shown from the built endpoint (pages/security.astro), never retyped.
    { p: "**[/.well-known/security.txt](/.well-known/security.txt):**" },
  ],
};

const accessibility: LegalDoc = {
  slug: "accessibility",
  title: "Accessibility statement",
  // 07-F (owner-approved 2026-10-22).
  meta: {
    title: "Accessibility statement | TecHaust",
    description:
      "Our aim to meet WCAG 2.2 level AA on techaust.com, the client portal and the admin, what we do to get there, and how to tell us about a problem.",
  },
  // 07-A §8: "Draft. OPEN (watch), 08-C RB-33. Source: 08 §7.3 L-15 and 04 WEB-G-16."
  blocks: [
    {
      p: "**Our aim.** We build techaust.com, the client portal and the admin to meet the Web Content Accessibility Guidelines (WCAG) 2.2, level AA.",
    },
    { p: "**What we do.**" },
    {
      ul: [
        "Every page works with a keyboard alone, with visible focus, a skip link and labelled forms.",
        "Colours are checked against contrast requirements in the build, and information is never shown by colour alone.",
        "Tap and click targets are at least 44 × 44 pixels, and motion respects your “reduce motion” setting.",
        "We test with automated checks (axe) and with a manual keyboard and screen-reader (NVDA) pass before launch.",
        "Proposals, invoices and other PDFs are tagged where our PDF renderer allows it.",
      ],
    },
    {
      p: "**Known gaps.** None recorded yet. When we find one we will list it here with a date and say when we expect to fix it.",
    },
    {
      p: `**Tell us.** If something on our site or in a document is hard to use, email ${CONTACT}. We reply within one business day, and we will give you the information in another format if you ask.`,
    },
  ],
};

/** The seven pages; `ga` is whether site.ga4Id is set (the GA lines in privacy and cookies come back when it is). */
export const buildLegalPages = (ga: boolean): Record<LegalSlug, LegalDoc> => ({
  privacy: makePrivacy(ga),
  terms,
  "refund-policy": refunds,
  "delivery-policy": delivery,
  cookies: makeCookies(ga),
  accessibility,
  security,
});

export const legalPages = buildLegalPages(GA_ON);
