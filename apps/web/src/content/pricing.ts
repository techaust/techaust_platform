// The pricing page (/pricing, WEB-PRICING): docs/07-content.md §5.3, word for word (typesetting only: curly
// apostrophes). The price list is not copy: it is built from the catalogue through the services hub's groups (07 §5.1)
// and each service page's prices (lib/prices.ts), so no amount is typed here (WEB-G-07). The small-job threshold is
// the settings default through {{terms:small_job_threshold}} (lead decision 2026-10-22, docs/13).
// "How payment works" ends with the GST and USD notes of 07 §2.4 (content/shared.ts; GST: VERIFY WITH CA).
import type { FaqItem, PriceSpec, ServiceCode } from "./types";

export const pricing = {
  meta: {
    title: "Pricing: published starting prices | TecHaust",
    description:
      "Starting prices for discovery, custom software, AI automation, integration and care plans. Fixed quotes in writing; INR + GST or USD.",
  },
  h1: "Pricing",
  lede: "Honest starting prices for each service. Your fixed quote depends on scope, and you’ll get it in writing before any work begins.",
  /** 07 §5.3, a list 07 writes in lower case (the page capitalises each item). */
  affects: [
    "number of user roles and screens",
    "integrations and data migration",
    "document variety (for AI)",
    "deadlines",
    "hosting and compliance needs",
  ],
  payment: [
    "**Builds:** 40 % to start, 30 % at a mid-project milestone, 30 % on delivery.",
    "**Smaller fixed jobs** (under {{terms:small_job_threshold}}): paid in full upfront.",
    "**Care plans and subscriptions:** monthly in advance.",
    "**Invoices are due within 7 days.** Proposals are valid for 15 days.",
    "**India:** UPI, cards and netbanking (Razorpay) or bank transfer. **International:** card (Stripe), PayPal or bank transfer (SWIFT).",
  ],
  faqs: [
    {
      q: "Why don’t you show an hourly rate?",
      a: "Because you’re buying an outcome, not hours. Fixed prices put the risk of estimating on us.",
    },
    { q: "Do prices include GST?", a: "No. GST at 18 % is added for Indian clients." },
    {
      q: "Can we pay in instalments?",
      a: "Builds are already paid in stages. Ask if you need a different schedule.",
    },
  ] satisfies FaqItem[],
} as const;

/**
 * Catalogue entries on the site that have no page of their own but a section on another page (07 §4.10 "Payments
 * and billing", 07 §4.14 "AI Ops add-on"): listed in the price table under the group of the page that shows them,
 * by the name 07 gives the section, linked to it. S8 (design, "included" in Custom Web Apps per 07 §4.2) has no site
 * name or section in 07, so it isn't listed (run file: a question for the owner).
 */
export const pricingExtras: readonly {
  code: ServiceCode;
  after: ServiceCode;
  title: string;
  href: string;
  price: PriceSpec;
}[] = [
  {
    code: "S15",
    after: "S14",
    title: "Payments and billing",
    href: "/services/business-systems-integration#payments-title",
    price: { ref: "S15" },
  },
  {
    code: "S17",
    after: "S16",
    title: "AI Ops add-on",
    href: "/services/care-plans#ai-ops-title",
    price: { ref: "S17", unit: "a month" },
  },
];
