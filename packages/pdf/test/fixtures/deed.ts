// T11: deed of assignment fixtures (sample data only: invented names, addresses, numbers and amounts; never client data). Each is a sealed snapshot as the
// finalise freezes it, turned into core `deedText` with a deed number, exactly as the jobs Worker does before rendering.
//   short-inr  a typical deed: one invoice, a short Schedule (the deed proper on page 1)
//   long-inr   the overflow test of docs/06 §7.5: a long legal name and address, a GSTIN, four invoices, Schedules typed one per line over many lines
//   usd        an export client: the amount in USD (en-US), no GSTIN
import { type DeedSnapshot, type DeedText, deedText } from "@techaust/core/deeds";

const base: DeedSnapshot = {
  layout: "deed-v1",
  madeOn: "2026-11-01",
  supplier: {
    address: "12 Sample Road, Sample Para, Balurghat, Dakshin Dinajpur, West Bengal 733101",
    gstin: "19ABCDE1234F1Z5",
  },
  client: {
    legalName: "Sample Traders Private Limited",
    address: "4 Sample Street, Salt Lake, Kolkata, West Bengal, 700091, India",
    reg: "19AAACS1234A1Z2",
  },
  offer: { docType: "proposal", number: "TH/PRP/2627/0007", version: 2, acceptedOn: "2026-08-05" },
  payment: { invoiceNumbers: ["TH/INV/2627/0009"], amountPaidMinor: 29_500_000, currency: "INR" },
  schedule1: {
    deliverables: "Website source code\nDesign files\nDeployment notes",
    location: "Private Git repository handed over on 28 Oct 2026",
    deliveredDates: "14 Oct 2026, 28 Oct 2026",
  },
  schedule2: { tools: "None", thirdParty: "Astro (MIT licence)\nTailwind CSS (MIT licence)" },
};

const long: DeedSnapshot = {
  ...base,
  client: {
    legalName: "Sample Brahmaputra Valley Agro Processing and Cold Chain Logistics Private Limited",
    address:
      "Unit 1104, Eleventh Floor, Sample Commercial Tower, Plot 17, Sector V, Bidhannagar, Salt Lake City, Kolkata, West Bengal, 700091, India",
    reg: "19AAACS9876B1Z7",
  },
  offer: { docType: "estimate", number: "TH/EST/2627/0031", version: 3, acceptedOn: "2026-06-18" },
  payment: {
    invoiceNumbers: ["TH/INV/2627/0012", "TH/INV/2627/0019", "TH/INV/2627/0027", "TH/INV/2627/0040"],
    amountPaidMinor: 1_234_567_800,
    currency: "INR",
  },
  schedule1: {
    deliverables: [
      "Order management web application (source code, database schema and migrations)",
      "Warehouse mobile app for Android and iOS (React Native source code)",
      "Tally integration service and its configuration",
      "Admin dashboard with reports and exports",
      "Design system: Figma files, icons and illustrations made for the project",
      "Technical documentation, runbooks and the handover recording",
      "Automated test suites and the CI configuration",
    ].join("\n"),
    location:
      "Private Git repositories transferred to the assignee's organisation; design files shared in the assignee's workspace; the handover recording on the assignee's drive",
    deliveredDates: "02 Aug 2026, 30 Aug 2026, 27 Sep 2026, 25 Oct 2026",
  },
  schedule2: {
    tools: [
      "The assignor's deployment scripts and project templates",
      "The assignor's internal component library (licensed under clause 5)",
    ].join("\n"),
    thirdParty: [
      "React (MIT licence)",
      "React Native (MIT licence)",
      "PostgreSQL client libraries (PostgreSQL licence)",
      "Hono (MIT licence)",
      "Archivo font (SIL Open Font Licence 1.1)",
    ].join("\n"),
  },
};

const usd: DeedSnapshot = {
  ...base,
  client: { legalName: "Sample Robotics Inc.", address: "100 Example Avenue, Austin, Texas, 78701, United States", reg: null },
  payment: { invoiceNumbers: ["TH/EXP/2627/0003"], amountPaidMinor: 1_250_000, currency: "USD" },
};

export const DEED_FIXTURES = { "short-inr": base, "long-inr": long, usd } as const;
export type DeedFixtureName = keyof typeof DEED_FIXTURES;
export const DEED_FIXTURE_NAMES = Object.keys(DEED_FIXTURES) as DeedFixtureName[];

const NUMBERS: Record<DeedFixtureName, string> = {
  "short-inr": "TH/DA/2627/0001",
  "long-inr": "TH/DA/2627/0002",
  usd: "TH/DA/2627/0003",
};

export const deedFixture = (name: DeedFixtureName): DeedText => deedText(DEED_FIXTURES[name], NUMBERS[name]);
