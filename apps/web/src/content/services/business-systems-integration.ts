// Business Systems Integration (S14, with S15): docs/07-content.md §4.10, word for word. Typesetting only: capitals
// at the start of 07's lower-case fragments where they stand alone. The "Payments and billing" section (S15) carries
// its price in running text ({{price:S15}}). The payment schedule is scheduleOf("S14") (WEB-SVC-05).
// GAP (run file): one FAQ with a written answer ("Is GST e-invoicing mandatory for us?"); "Do you need our Tally
// licence?" and "What if Tally is on a local PC?" have none. Fewer than 4 (WEB-SVC-04): FAQ section not shown.
// No "Who it's for" in 07. Related: the designer's pick.
import { cta, homeOneLiner } from "../shared";
import { SCHEDULE, type ServiceContent } from "../types";

export const businessSystemsIntegration: ServiceContent = {
  code: "S14",
  slug: "business-systems-integration",
  name: "Business Systems Integration",
  oneLiner: homeOneLiner("S14"),
  meta: {
    title: "Tally, Zoho, GST e-invoice, Shopify integration | TecHaust",
    description:
      "Connectors between Tally, Zoho, GST e-invoicing and e-way bills, Shopify, QuickBooks, Xero and payments, monitored and documented.",
  },
  hero: {
    h1: "Make your systems talk to each other, reliably.",
    price: { ref: "S14", unit: "per connector" },
    primary: cta.quote("S14"),
  },
  problem:
    "Sales are in Shopify, accounts in Tally, invoices in Zoho, and someone re-enters everything at month end. Every copy is a chance for a mistake.",
  build: {
    deliverables: [
      "connectors (Tally ↔ Zoho, GST e-invoicing and e-way bills via a GST Suvidha Provider, Shopify ↔ ERP, CRM ↔ accounting, QuickBooks, Xero, HubSpot, Stripe)",
      "sync monitoring and error alerts",
      "documentation",
      "a care plan",
    ],
  },
  sections: [
    {
      id: "payments",
      title: "Payments and billing",
      text: "Razorpay, Cashfree or Stripe; UPI AutoPay and subscriptions; payment links, webhooks and reconciliation, from {{price:S15}}.",
    },
  ],
  pricing: {
    prices: [{ ref: "S14", unit: "per connector" }],
    lines: [SCHEDULE],
  },
  faqs: [
    {
      q: "Is GST e-invoicing mandatory for us?",
      a: "It depends on your turnover; your CA confirms it. We build the integration either way.",
    },
  ],
  related: ["S9", "S10", "S16"],
};
