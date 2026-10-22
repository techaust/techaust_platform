// The industries hub and the three industry pages (WEB-IND): docs/07-content.md §5.2 (H1s, meta, use cases, related
// services, the first two finance FAQs) and 07-content-appendix/D-m2.3-missing-copy.md §1–§4 (card labels, the hub's
// closing line, problems, tools and the other FAQs), both owner-approved, word for word. Typesetting only: curly
// apostrophes. Arrows (↔) stay as 07 writes them; CopyText draws them as icons. Prices are {{price:Sx}} tokens.
// Lists 07 writes in lower case (retail and SaaS use cases) keep their case here; the page capitalises the first
// letter of each item, as the service pages' "Typical uses" do.
import type { IndustryContent } from "./types";

export const industriesHub = {
  // 07 §5.2 gives the hub no meta title or description (run file: a gap for the owner). The title is the h1 with the
  // site suffix; there is no description until the owner writes one.
  meta: { title: "Industries we know well | TecHaust" },
  h1: "Industries we know well",
  lede: "We work across sectors, but these three are where our experience runs deepest.",
  closing:
    "Work in another sector? Most of what we build applies anywhere there’s paperwork, a spreadsheet or two systems that don’t talk. Tell us about yours.",
} as const;

const finance: IndustryContent = {
  slug: "finance-accounting-legal",
  name: "Finance, Accounting and Legal",
  label: "CA firms, finance teams and legal practices",
  meta: {
    title: "Automation for CA firms, finance and legal teams | TecHaust",
    description:
      "Invoice-to-Tally automation, GSTR-2B reconciliation, contract extraction and client portals for finance, accounting and legal teams.",
  },
  h1: "Less data entry. More time for the work clients pay you for.",
  problems: [
    "Invoices and bank statements typed into Tally or Zoho by hand, then checked again at month end.",
    "GSTR-2B mismatches found late, when there’s little time left to chase vendors.",
    "Client documents arriving by email, WhatsApp and pen drive, with no single list of what’s still missing.",
    "Contract renewal dates and key clauses kept in someone’s memory or a spreadsheet.",
  ],
  useCases: [
    "Vendor invoices posted to Tally or Zoho with review",
    "GSTR-2B ↔ purchase-register reconciliation",
    "Client document collection portals for CA firms",
    "Contract clause extraction and renewal tracking",
    "WhatsApp client-query assistants",
  ],
  tools: {
    label: "Works with",
    items: [
      "Tally Prime",
      "Zoho Books",
      "QuickBooks",
      "Xero",
      "GST e-invoicing (via a GST Suvidha Provider)",
      "WhatsApp Business",
      "Excel and Google Sheets",
    ],
  },
  related: ["S9", "S14", "S10", "S12", "S5"],
  faqs: [
    {
      q: "Do you understand GST workflows?",
      a: "We build software for them every day; your CA stays in charge of tax decisions.",
    },
    {
      q: "Is client data safe?",
      a: "Access control, audit logs, encryption, and documented data handling. We’ll walk your team through it.",
    },
    {
      q: "Can it work with Tally on a local PC?",
      a: "Yes. A small connector runs on that PC or your server and syncs over the internet; Tally needs to be running for the sync, and an alert tells you if it stops.",
    },
    {
      q: "What happens when the AI isn’t sure about a document?",
      a: "It goes to a review screen, and a person on your team checks it before anything is posted. In the pilot we measure how many documents need review, so you know before rollout.",
    },
    {
      q: "Where is our clients’ data kept?",
      a: "In your own cloud account or ours, with hosting in India where your data needs to stay here. We document every system that touches it.",
    },
  ],
};

const retail: IndustryContent = {
  slug: "retail-ecommerce-logistics",
  name: "Retail, E-commerce and Logistics",
  label: "Online sellers, distributors and logistics teams",
  meta: {
    title: "Automation for sellers, distributors, logistics | TecHaust",
    description:
      "WhatsApp commerce, Shopify-to-ERP sync, delivery-proof and freight-invoice extraction, and dealer ordering portals.",
  },
  h1: "Orders, stock and paperwork that keep up with your sales.",
  problems: [
    "Orders arrive on WhatsApp, the website and by phone, and someone copies each one into the billing system.",
    "Stock in Shopify and stock in Tally or Zoho disagree by the end of the week.",
    "Delivery proofs and freight invoices pile up as photos and PDFs that nobody has time to check.",
    "Dealers phone in orders because there’s no simple way for them to order themselves.",
  ],
  useCases: [
    "WhatsApp ordering and payment reminders",
    "Shopify ↔ Tally/Zoho sync",
    "delivery-proof and freight-invoice extraction",
    "dealer and distributor ordering portals",
    "COD confirmation and returns flows",
  ],
  tools: {
    // 07-D §3 "Tools we connect", under the label 07-D §2 gives that section.
    label: "Works with",
    items: [
      "Shopify",
      "Tally Prime",
      "Zoho Books and Zoho Inventory",
      "WhatsApp Business Platform",
      "Razorpay",
      "Cashfree",
      "GST e-invoicing and e-way bills (via a GST Suvidha Provider)",
    ],
  },
  related: ["S11", "S14", "S9", "S5"],
  faqs: [
    {
      q: "Can customers order and pay on WhatsApp?",
      a: "Yes. A WhatsApp flow can take the order, send a payment link and confirm it, with a person able to take over any chat.",
    },
    {
      q: "Will Shopify and our accounts stay in sync?",
      a: "We build a connector between Shopify and Tally or Zoho, with monitoring that alerts you and shows what failed if a sync doesn’t go through.",
    },
    {
      q: "Can you read delivery proofs and freight invoices?",
      a: "Yes. Fields are extracted and checked, and anything the system isn’t sure about goes to a person for review.",
    },
    {
      q: "Do we need a new WhatsApp number?",
      a: "Not always. An existing number can usually move to the WhatsApp Business Platform, but it then stops working in the regular WhatsApp Business app, so many businesses use a new number. We check your case before setup.",
    },
    {
      q: "What does it cost?",
      a: "Integrations are from {{price:S14}} per connector and WhatsApp automation from {{price:S11}}. You get a fixed quote in writing before work starts.",
    },
  ],
};

const saas: IndustryContent = {
  slug: "saas-startups",
  name: "SaaS and Startups",
  label: "Founders and software companies",
  meta: {
    title: "Product engineering and AI for SaaS and founders | TecHaust",
    description:
      "Production-grade MVPs, AI features, MCP servers, a dev subscription and fractional CTO support for startups and SaaS companies.",
  },
  h1: "A senior product team when you need one, without hiring one.",
  problems: [
    "A prototype built fast that now needs to hold up with real users, real data and real payments.",
    "A roadmap with AI on it, and no one on the team who has shipped AI features to production.",
    "More product work than the team can take on, but not enough steady work to hire.",
    "Technical decisions being made without a senior engineer in the room.",
  ],
  useCases: [
    "MVP builds",
    "AI features and MCP servers",
    "rescuing a fast-built prototype",
    "steady capacity via the dev subscription",
    "technical leadership via the fractional CTO",
  ],
  tools: {
    label: "Stacks we use",
    items: [
      "React and TypeScript",
      "React Native and Flutter",
      "Cloudflare, AWS and other clouds",
      "Stripe and Razorpay",
      "MCP servers for ChatGPT, Claude and Copilot",
    ],
  },
  related: ["S6", "S13", "S2", "S18", "S4"],
  faqs: [
    {
      q: "Can you work with our in-house developer?",
      a: "Yes. We share the repository, review each other’s code, and agree in the plan who owns which parts.",
    },
    { q: "Do you take equity?", a: "No. We work for fees, so incentives stay simple." },
    {
      q: "Can you fix an app built with AI tools?",
      a: "Yes. We start with an App Rescue audit: a written report and a risk-ranked fix list, before anything changes.",
    },
    {
      q: "Do you work in our time zone?",
      a: "We’re in India (IST, UTC+5:30) and keep 3–4 hours of overlap with UK and European working days, and with US East-coast mornings by arrangement.",
    },
    {
      q: "Who owns the code?",
      a: "You do. The code, documentation and IP transfer to you on full payment.",
    },
  ],
};

/** In the industries menu's order (07 §2.1). */
export const industries: readonly IndustryContent[] = [finance, retail, saas];
