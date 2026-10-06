// Service catalogue seed S1–S18 [ADM-CAT-01]: names, categories and "from" prices from docs/02 §4.1–4.2
// (owner-approved, M1.3); slugs from docs/04 §4.2; SAC codes from docs/08 §7.1 G-2 (VERIFY WITH CA);
// payment schedules from Q-P3-6. Prices are minor units. Everything is editable in the admin later; the seed
// only inserts entries that don't exist yet, so it never overwrites the Owner's edits.
import type { DefaultLine, ScheduleStep } from "../schema/catalogue.ts";

const L = 100; // paise per rupee / cents per dollar
const BUILD: ScheduleStep[] = [
  { label: "On acceptance", pctBp: 4_000, trigger: "on_accept" },
  { label: "Midpoint milestone", pctBp: 3_000, trigger: "milestone" },
  { label: "On delivery", pctBp: 3_000, trigger: "delivery" },
];
const UPFRONT: ScheduleStep[] = [{ label: "On acceptance", pctBp: 10_000, trigger: "on_accept" }];
const MONTHLY: ScheduleStep[] = [{ label: "Monthly in advance", pctBp: 10_000, trigger: "monthly" }];

export type CatalogueSeed = {
  code: string;
  name: string;
  category: "advise" | "build" | "automate" | "connect" | "run";
  short: string;
  unit: "fixed" | "milestone" | "month" | "workflow" | "connector";
  priceInr: number | null;
  priceUsd: number | null;
  sac: string;
  schedule: ScheduleStep[];
  slug: string | null;
  showOnSite: boolean;
  defaultLines?: DefaultLine[];
};

const tier = (description: string, inr: number, usd: number): DefaultLine => ({
  description,
  unit: "month",
  qtyMilli: 1_000,
  rateInrMinor: inr * L,
  rateUsdMinor: usd * L,
});

export const CATALOGUE: readonly CatalogueSeed[] = [
  {
    code: "S1",
    name: "Discovery Sprint",
    category: "advise",
    short:
      "A 1–2 week paid engagement: an automation audit or a product blueprint, ending in a costed plan and a fixed quote. The fee is credited to the build if you proceed within 60 days.",
    unit: "fixed",
    priceInr: 40_000 * L,
    priceUsd: 2_000 * L,
    sac: "998313",
    schedule: UPFRONT,
    slug: "discovery-sprint",
    showOnSite: true,
  },
  {
    code: "S2",
    name: "App Rescue & Production-Readiness Audit",
    category: "advise",
    short:
      "A code, security and performance review of an app built quickly, with a risk-ranked fix list and an optional fixed-price hardening sprint.",
    unit: "fixed",
    priceInr: 50_000 * L,
    priceUsd: 2_000 * L,
    sac: "998313",
    schedule: UPFRONT,
    slug: "app-rescue",
    showOnSite: true,
  },
  {
    code: "S3",
    name: "DPDP Readiness for Apps",
    category: "advise",
    short:
      "Technical implementation of DPDP-aligned features: consent and notices, a rights-request portal, retention jobs and access logs. Legal interpretation comes from your lawyer.",
    unit: "fixed",
    priceInr: 75_000 * L,
    priceUsd: null,
    sac: "998314",
    schedule: UPFRONT,
    slug: "dpdp-readiness",
    showOnSite: false, // flag off until a legal partner exists (Q-B12)
  },
  {
    code: "S4",
    name: "Fractional CTO",
    category: "advise",
    short:
      "Part-time senior technical leadership: architecture, hiring help, vendor review, roadmap and code-quality oversight, for a fixed number of hours a month.",
    unit: "month",
    priceInr: 75_000 * L,
    priceUsd: 3_000 * L,
    sac: "998313",
    schedule: MONTHLY,
    slug: "fractional-cto",
    showOnSite: true,
  },
  {
    code: "S5",
    name: "Custom Web Apps & Business Portals",
    category: "build",
    short:
      "Internal tools, client and dealer portals, and the Excel sheet your business secretly runs on, rebuilt as a proper web app.",
    unit: "milestone",
    priceInr: 3_00_000 * L,
    priceUsd: 12_000 * L,
    sac: "998314",
    schedule: BUILD,
    slug: "custom-web-apps",
    showOnSite: true,
  },
  {
    code: "S6",
    name: "MVP & SaaS Product Development",
    category: "build",
    short:
      "A production-grade first version in 6–10 weeks, with staging from day one and the code handed over to you.",
    unit: "fixed",
    priceInr: 4_00_000 * L,
    priceUsd: 15_000 * L,
    sac: "998314",
    schedule: BUILD,
    slug: "mvp-saas-development",
    showOnSite: true,
  },
  {
    code: "S7",
    name: "Mobile Apps",
    category: "build",
    short: "Cross-platform iOS and Android apps, usually alongside a web app or portal.",
    unit: "fixed",
    priceInr: 3_00_000 * L,
    priceUsd: 12_000 * L,
    sac: "998314",
    schedule: BUILD,
    slug: "mobile-apps",
    showOnSite: true,
  },
  {
    code: "S8",
    name: "UI/UX & Design Systems",
    category: "build",
    short:
      "UX research, wireframes, UI design and design-system starters. Usually part of a build; available on its own.",
    unit: "fixed",
    priceInr: 60_000 * L,
    priceUsd: 3_000 * L,
    sac: "998314",
    schedule: UPFRONT,
    slug: null, // shown inside Custom Web Apps (docs/04 §4.2)
    showOnSite: true,
  },
  {
    code: "S9",
    name: "AI Document Automation",
    category: "automate",
    short:
      "Invoices, purchase orders and contracts read, checked and posted to Tally, Zoho, QuickBooks or Xero, with a person reviewing exceptions.",
    unit: "fixed",
    priceInr: 2_00_000 * L,
    priceUsd: 8_000 * L,
    sac: "998314",
    schedule: BUILD,
    slug: "ai-document-automation",
    showOnSite: true,
  },
  {
    code: "S10",
    name: "Workflow Automation & AI Agents",
    category: "automate",
    short:
      "Hand off the repetitive steps between email, sheets, CRM and accounting, with monitoring so nothing fails silently.",
    unit: "workflow",
    priceInr: 50_000 * L,
    priceUsd: 2_000 * L,
    sac: "998314",
    schedule: UPFRONT,
    slug: "workflow-automation",
    showOnSite: true,
  },
  {
    code: "S11",
    name: "WhatsApp Business Automation",
    category: "automate",
    short:
      "WhatsApp flows connected to your systems: order updates, payment links and reminders, catalogue ordering and handover to a person. Meta message charges are passed through at cost.",
    unit: "fixed",
    priceInr: 60_000 * L,
    priceUsd: null,
    sac: "998314",
    schedule: UPFRONT,
    slug: "whatsapp-automation",
    showOnSite: true,
    defaultLines: [
      { description: "Setup", unit: "fixed", qtyMilli: 1_000, rateInrMinor: 60_000 * L, rateUsdMinor: null },
      {
        description: "Monthly management",
        unit: "month",
        qtyMilli: 1_000,
        rateInrMinor: 8_000 * L,
        rateUsdMinor: null,
      },
    ],
  },
  {
    code: "S12",
    name: "AI Knowledge Assistants",
    category: "automate",
    short:
      "Private search and answers over your company documents, with access control, source citations and a quality test set.",
    unit: "fixed",
    priceInr: 2_50_000 * L,
    priceUsd: 10_000 * L,
    sac: "998314",
    schedule: BUILD,
    slug: "ai-knowledge-assistants",
    showOnSite: true,
  },
  {
    code: "S13",
    name: "AI Features for Your Software",
    category: "automate",
    short:
      "AI added to an existing SaaS or app (search, summaries, copilots, document understanding), plus MCP servers and agent-ready APIs.",
    unit: "fixed",
    priceInr: 1_50_000 * L,
    priceUsd: 5_000 * L,
    sac: "998314",
    schedule: BUILD,
    slug: "ai-features-for-software",
    showOnSite: true,
  },
  {
    code: "S14",
    name: "Business Systems Integration",
    category: "connect",
    short:
      "Tally and Zoho, GST e-invoicing and e-way bills, Shopify and payments: connected, monitored and documented.",
    unit: "connector",
    priceInr: 75_000 * L,
    priceUsd: 3_000 * L,
    sac: "998314",
    schedule: UPFRONT,
    slug: "business-systems-integration",
    showOnSite: true,
  },
  {
    code: "S15",
    name: "Payments & Billing Modules",
    category: "connect",
    short:
      "Razorpay, Cashfree or Stripe integration, UPI Autopay, subscriptions, payment links, webhooks and reconciliation.",
    unit: "fixed",
    priceInr: 50_000 * L,
    priceUsd: 2_000 * L,
    sac: "998314",
    schedule: UPFRONT,
    slug: null, // shown inside Business Systems Integration
    showOnSite: true,
  },
  {
    code: "S16",
    name: "Care Plans",
    category: "run",
    short: "Monitoring, security patches, backups, small changes and a named response time, in three tiers.",
    unit: "month",
    priceInr: 9_999 * L,
    priceUsd: 299 * L,
    sac: "998313",
    schedule: MONTHLY,
    slug: "care-plans",
    showOnSite: true,
    defaultLines: [tier("Essential", 9_999, 299), tier("Growth", 24_999, 899), tier("Scale", 59_999, 2_499)],
  },
  {
    code: "S17",
    name: "AI Ops",
    category: "run",
    short:
      "Monitoring, test-set reruns, prompt and model updates and cost tracking for AI systems in production. Usage is passed through.",
    unit: "month",
    priceInr: 20_000 * L,
    priceUsd: 1_000 * L,
    sac: "998313",
    schedule: MONTHLY,
    slug: null, // shown on the Care Plans page
    showOnSite: true,
  },
  {
    code: "S18",
    name: "Dev Subscription",
    category: "run",
    short:
      "A senior developer and design subscription: one active request at a time, an unlimited queue, pause or cancel monthly.",
    unit: "month",
    priceInr: 1_75_000 * L,
    priceUsd: 2_900 * L,
    sac: "998314",
    schedule: MONTHLY,
    slug: "dev-subscription",
    showOnSite: true,
  },
];
