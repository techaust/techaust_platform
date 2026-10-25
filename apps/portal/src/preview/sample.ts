// PREVIEW ONLY (dev server, never built): made-up sample data for the M4.5 design preview. Every name is invented and
// labelled "(sample)", every address is on example.test, the GSTIN is a test value marked as a sample. The figures are
// worked out by the real M4.2 tax engine (`computeDocument`, `computeSchedule`) from the settings defaults, exactly as the
// server will freeze them at send; the screens only format them.
import { type CalendarDate, fromIst, SETTINGS_DEFAULTS } from "@techaust/core";
import {
  type ComputedDocument,
  computeDocument,
  computeSchedule,
  type DocumentInput,
  type ScheduleInstalment,
  type ScheduleStep,
  type TaxContext,
} from "@techaust/core/tax";
import type { DocumentView, LineText } from "../lib/document-view.ts";
import type { DocSummary } from "../screens/home.tsx";

const CTX: TaxContext = {
  tax: SETTINGS_DEFAULTS.tax,
  supplierStateCode: "19",
  luts: [{ fy: "2627", arn: "SAMPLE-ARN-2627" }],
};

const d = (year: number, month: number, day: number): CalendarDate => ({ year, month, day });

function compute(input: DocumentInput): ComputedDocument {
  const r = computeDocument(input, CTX);
  if (!r.ok) throw new Error(`Sample document doesn't compute: ${r.errors.map((e) => e.code).join(", ")}`);
  return r.value;
}

function schedule(c: ComputedDocument, steps: ScheduleStep[]): ScheduleInstalment[] {
  const r = computeSchedule(c.totalMinor, c.currency, steps, CTX);
  if (!r.ok) throw new Error(`Sample schedule doesn't compute: ${r.errors.map((e) => e.code).join(", ")}`);
  return r.value;
}

const STEPS: ScheduleStep[] = [
  { label: "Advance", trigger: "on_accept", pctBp: 4000 },
  { label: "Midpoint milestone", trigger: "milestone", pctBp: 3000 },
  { label: "Delivery", trigger: "delivery", pctBp: 3000 },
];

export const ME = { name: "Asha Iyer", email: "asha.iyer@kestrel.example.test" };
export const COLLEAGUE = { name: "Rahul Sen", email: "rahul.sen@kestrel.example.test" };
export const ORG = "Kestrel Distributors (sample)";

// ---------- The INR proposal: a registered client in West Bengal (intra-state: CGST and SGST) ----------

const INR_LINES: LineText[] = [
  {
    description: "Discovery and process mapping",
    detail: "Two workshops with your accounts team, and a written map of how invoices reach Tally",
    qty: "1",
    unit: "fixed",
    rateMinor: 4_500_000,
  },
  {
    description: "Invoice extraction pipeline",
    detail: "Reads supplier PDFs and scans, and flags any field it isn't sure of for a person to check",
    qty: "1",
    unit: "fixed",
    rateMinor: 12_000_000,
  },
  {
    description: "Tally integration and review screen",
    detail: "Checked entries are posted to Tally after review",
    qty: "1",
    unit: "fixed",
    rateMinor: 9_000_000,
  },
  {
    description: "Pilot support",
    detail: "Fixes and tuning while your team uses it",
    qty: "2",
    unit: "months",
    rateMinor: 1_500_000,
  },
];

const INR = compute({
  currency: "INR",
  documentDate: d(2026, 10, 18),
  recipient: { gstStatus: "registered", country: "IN", gstin: "19ABCDE1234F1ZX" },
  lines: [
    { sac: "998313", qtyMilli: 1000, rateMinor: 4_500_000 },
    { sac: "998314", qtyMilli: 1000, rateMinor: 12_000_000, discount: { kind: "percent", bp: 1000 } },
    { sac: "998314", qtyMilli: 1000, rateMinor: 9_000_000 },
    { sac: "998313", qtyMilli: 2000, rateMinor: 1_500_000 },
  ],
});

const TERMS = {
  version: "Proposal terms, version 3 (sample)",
  paragraphs: [
    "Sample text. In the portal this section shows, word for word, the version of the proposal terms the proposal was sent with.",
    "Intellectual property is transferred to you on full payment.",
    "30-day warranty after launch: defects against the agreed written scope are fixed free for 30 days after launch. New features are not covered.",
  ],
};

export const PROPOSAL_INR: DocumentView = {
  id: "sample-prp-0003",
  kind: "proposal",
  title: "Invoice-to-Tally automation pilot",
  number: "TH/PRP/2627/0003",
  version: 2,
  status: "viewed",
  currency: "INR",
  client: {
    name: "Kestrel Distributors Pvt Ltd (sample)",
    addressLines: ["12 Sample Road", "Siliguri, West Bengal 734001"],
    gstin: "19ABCDE1234F1ZX (sample)",
    placeOfSupply: "West Bengal (19)",
  },
  contact: { name: "Rupak Sarkar", email: "hello@techaust.com" },
  sentOn: d(2026, 10, 18),
  validUntil: d(2026, 11, 2),
  summary: {
    outcome:
      "Your accounts team stops retyping supplier invoices into Tally. Invoices are read automatically, a person checks anything the system isn't sure of, and the entries are posted after review.",
    timeline: "About 8 weeks from acceptance",
  },
  goals: {
    intro:
      "Today about 600 supplier invoices a month are keyed into Tally by hand (sample figure). The aim of this pilot is to show, on your own invoices, that most of that typing can go.",
    points: [
      "Fewer hours spent each month on data entry",
      "Fewer typing mistakes reaching the books",
      "A clear record of who checked and posted each invoice",
    ],
  },
  scope: {
    inScope: [
      "Supplier invoices in PDF and scanned form",
      "Posting purchase entries to one Tally company",
      "A review screen for your accounts team",
    ],
    outOfScope: [
      "Sales invoices and e-invoicing",
      "Changes to your chart of accounts",
      "Hardware or Tally licences",
    ],
  },
  deliverables: [
    "A written process map, before and after",
    "The extraction pipeline, running on your invoices",
    "The review screen and the Tally posting",
    "Handover notes and a recorded walk-through",
  ],
  milestones: [
    {
      name: "Kick-off and process map",
      what: "The project plan and the written process map",
      target: d(2026, 11, 6),
      pctBp: 4000,
    },
    {
      name: "Extraction pilot live",
      what: "Your team tries the extraction on real invoices",
      target: d(2026, 12, 4),
      pctBp: 3000,
    },
    {
      name: "Tally posting and handover",
      what: "Checked entries posted to Tally; handover notes",
      target: d(2027, 1, 1),
      pctBp: 3000,
    },
  ],
  assumptions: [
    "You share 50 sample invoices in the first week",
    "Someone from your accounts team can join two one-hour workshops",
    "Tally runs on a computer we can reach remotely during set-up",
  ],
  terms: TERMS,
  lines: INR_LINES,
  computed: INR,
  schedule: schedule(INR, STEPS),
  documentId: "6f1d2c3a-0000-4000-8000-000000000003",
  fingerprint: "3f9a1c0b7e24",
  acceptance: null,
  decline: null,
  replaced: null,
};

// ---------- The USD proposal: an overseas client, export of services under LUT (zero-rated) ----------

const USD = compute({
  currency: "USD",
  documentDate: d(2026, 10, 20),
  recipient: { gstStatus: "overseas", country: "US" },
  lines: [
    { sac: "998313", qtyMilli: 1000, rateMinor: 150_000 },
    { sac: "998314", qtyMilli: 1000, rateMinor: 600_000 },
    { sac: "998314", qtyMilli: 1000, rateMinor: 350_000, discount: { kind: "fixed", minor: 25_000 } },
    { sac: "998313", qtyMilli: 3000, rateMinor: 60_000 },
  ],
});

export const PROPOSAL_USD: DocumentView = {
  ...PROPOSAL_INR,
  id: "sample-prp-0004",
  title: "Shipment-document extraction pilot for the Newark and Rotterdam operations teams",
  number: "TH/PRP/2627/0004",
  version: 1,
  status: "sent",
  currency: "USD",
  client: {
    name: "Northwind Freight Forwarding International Holdings LLC (sample)",
    addressLines: ["100 Sample Street, Suite 400", "Newark, NJ 07102", "United States"],
    gstin: null,
    placeOfSupply: "Outside India (96 – Other Territory)",
  },
  sentOn: d(2026, 10, 20),
  validUntil: d(2026, 11, 4),
  summary: {
    outcome:
      "Bills of lading and commercial invoices are read automatically and land in your transport management system, so your operations team checks them instead of retyping them.",
    timeline: "About 10 weeks from acceptance",
  },
  lines: [
    { description: "Discovery and document review", qty: "1", unit: "fixed", rateMinor: 150_000 },
    {
      description: "Shipment-document extraction pipeline",
      detail: "Bills of lading, commercial invoices and packing lists",
      qty: "1",
      unit: "fixed",
      rateMinor: 600_000,
    },
    { description: "Integration with your TMS", qty: "1", unit: "fixed", rateMinor: 350_000 },
    { description: "Pilot support", qty: "3", unit: "months", rateMinor: 60_000 },
  ],
  computed: USD,
  schedule: schedule(USD, STEPS),
  documentId: "6f1d2c3a-0000-4000-8000-000000000004",
  fingerprint: "a81e05d3c9f2",
};

// ---------- An INR estimate (home card) ----------

const EST = compute({
  currency: "INR",
  documentDate: d(2026, 10, 22),
  recipient: { gstStatus: "registered", country: "IN", gstin: "19ABCDE1234F1ZX" },
  lines: [{ sac: "998313", qtyMilli: 12000, rateMinor: 600_000 }],
});

export const ESTIMATE: DocSummary = {
  id: "sample-est-0007",
  kind: "estimate",
  title: "Website care plan, 12 months",
  number: "TH/EST/2627/0007",
  version: 1,
  status: "sent",
  currency: "INR",
  validUntil: d(2026, 11, 6),
  acceptance: null,
  decline: null,
  totalMinor: EST.totalMinor,
};

export const summaryOf = (doc: DocumentView): DocSummary => ({
  id: doc.id,
  kind: doc.kind,
  title: doc.title,
  number: doc.number,
  version: doc.version,
  status: doc.status,
  currency: doc.currency,
  validUntil: doc.validUntil,
  acceptance: doc.acceptance,
  decline: doc.decline,
  totalMinor: doc.computed.totalMinor,
});

// ---------- The states the preview switches between ----------

export const ACCEPTED_AT = fromIst(d(2026, 10, 25), 11, 42);
export const DECLINED_AT = fromIst(d(2026, 10, 25), 16, 5);

export const STATES = {
  sent: { label: "Sent", doc: { ...PROPOSAL_INR, status: "sent" } },
  viewed: { label: "Viewed (open to accept)", doc: PROPOSAL_INR },
  usd: { label: "USD, export under LUT", doc: PROPOSAL_USD },
  accepted: {
    label: "Accepted",
    doc: {
      ...PROPOSAL_INR,
      status: "accepted",
      acceptance: { name: ME.name, email: ME.email, atMs: ACCEPTED_AT, fingerprint: "3f9a1c0b7e24" },
    },
  },
  "accepted-other": {
    label: "Already accepted by a colleague",
    doc: {
      ...PROPOSAL_INR,
      status: "accepted",
      acceptance: {
        name: COLLEAGUE.name,
        email: COLLEAGUE.email,
        atMs: ACCEPTED_AT,
        fingerprint: "3f9a1c0b7e24",
      },
    },
  },
  declined: {
    label: "Declined",
    doc: {
      ...PROPOSAL_INR,
      status: "declined",
      decline: { name: ME.name, atMs: DECLINED_AT, reason: "The timeline doesn't suit us", note: null },
    },
  },
  expired: {
    label: "Expired",
    doc: { ...PROPOSAL_INR, status: "expired", sentOn: d(2026, 10, 3), validUntil: d(2026, 10, 18) },
  },
  superseded: {
    label: "Superseded (old link opened)",
    doc: { ...PROPOSAL_INR, replaced: { version: 1, on: d(2026, 10, 18) } },
  },
} satisfies Record<string, { label: string; doc: DocumentView }>;

export type StateKey = keyof typeof STATES;
