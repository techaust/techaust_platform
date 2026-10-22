// AI Document Automation (S9): docs/07-content.md §4.5, word for word (FAQs confirmed by the owner, 2026-10-22).
// Typesetting only: curly apostrophes, and 07's lower-case list fragments start with a capital where they stand alone
// (the pricing lines). No "Tech" line in 07 for S9 and no case study or sample, so those sections are omitted
// (WEB-SVC-02, -03). Related services: not listed in 07; the three below are the lead-reviewable choice of the
// preview (run file), with their home-page one-liners from 07 §3.
import { home } from "../home";
import type { ServiceContent } from "../types";

const card = (href: string) => {
  const c = home.services.cards.find((s) => s.href === href);
  if (!c) throw new Error(`No home card for ${href}`);
  return c;
};

export const aiDocumentAutomation: ServiceContent = {
  code: "S9",
  slug: "ai-document-automation",
  name: "AI Document Automation",
  meta: {
    title: "AI document automation: invoices, POs, contracts | TecHaust",
    description:
      "Extract, check and post invoices, purchase orders and KYC files into Tally, Zoho, QuickBooks or Xero, with human review. Pilot from {{price-plain:S9}}.",
  },
  hero: {
    h1: "Stop retyping invoices. Keep control of every entry.",
    whoFor: "CA and accounting firms, finance teams in SMBs, NBFCs, logistics companies and online sellers.",
    price: { ref: "S9", lead: "Pilot" },
    primary: { label: "Start a pilot", href: "/get-a-quote?service=S9&type=pilot" },
  },
  problem:
    "Somewhere in your office, skilled people copy numbers from PDFs into Tally all day. It’s slow, it’s error-prone, and it’s the first job they’d happily give up.",
  build: {
    text: "A pipeline that reads documents (emailed PDFs, scans, photos), extracts the fields you need, checks them against rules and your records (purchase orders, GSTR-2B, vendor masters), and posts clean entries to your accounting system. Anything uncertain goes to a review screen for a person to approve.",
    uses: [
      "vendor invoices → Tally vouchers",
      "PO ↔ invoice ↔ GSTR-2B matching",
      "delivery proofs and freight invoices",
      "KYC document checks",
      "contract clause extraction",
    ],
    diagram: ["Inbox", "extract", "validate", "review queue", "Tally/Zoho", "audit log"],
  },
  how: {
    steps: [
      {
        title: "Pilot (about 4 weeks)",
        text: "One document type, your real samples, a baseline (e.g. minutes per invoice today) and a test set we measure against.",
      },
      { title: "Production rollout", text: "Integrations, monitoring, guardrails, training." },
      { title: "AI Ops", text: "Monthly monitoring and tuning (S17)." },
    ],
    note: "Accuracy depends on your documents. In the pilot we measure it on your own samples and agree the target with you before rollout. We don’t promise a number we haven’t measured.",
  },
  pricing: {
    lead: "Pilot",
    ref: "S9",
    lines: [
      "Production rollout quoted after the pilot",
      "Optional per-document pricing with a monthly minimum",
    ],
  },
  faqs: [
    {
      q: "Does our data leave India?",
      a: "It can stay in India-region services where needed; we document every system that touches it.",
    },
    {
      q: "Which AI models do you use?",
      a: "Chosen per project for accuracy, cost and data-handling terms; we never let providers train on your data where an opt-out exists.",
    },
    {
      q: "What about handwritten or poor scans?",
      a: "We test them in the pilot. Clear printed documents work best; handwriting and poor scans usually go to the review screen for a person to check, and we tell you the share we can handle automatically before rollout.",
    },
    { q: "Do you work with Tally Prime?", a: "Yes, via Tally’s XML/ODBC interfaces or connectors." },
  ],
  related: [
    card("/services/workflow-automation"),
    card("/services/business-systems-integration"),
    card("/services/discovery-sprint"),
  ],
};
