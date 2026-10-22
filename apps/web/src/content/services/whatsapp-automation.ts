// WhatsApp Business Automation (S11): docs/07-content.md §4.7, word for word. Typesetting only: curly apostrophes
// and capitals at the start of 07's lower-case fragments where they stand alone ("setup …" → "Setup"). Pricing is
// 07's "setup {{price:S11-setup}} + management {{price:S11-monthly}}/month" as two price tags. The schedule is worded
// per line (lead, 2026-10-22): the setup from the catalogue (scheduleOf("S11"), WEB-SVC-05), the management as
// "billed monthly in advance". S11 has no USD price: USD visitors see the INR price with "USD price on request"
// (07 §4.7, owner 2026-10-22).
// GAP (run file): one FAQ with a written answer ("What does Meta charge?"); "Do we need a new number?" has none and
// "Can a person take over a chat?" only "(yes)". Fewer than 4 (WEB-SVC-04): FAQ section not shown.
// Related: the designer's pick.
import { cta } from "../shared";
import { type ServiceContent, scheduleLine } from "../types";

export const whatsappAutomation: ServiceContent = {
  code: "S11",
  slug: "whatsapp-automation",
  name: "WhatsApp Automation",
  meta: {
    title: "WhatsApp automation for orders and payments | TecHaust",
    description:
      "Order updates, payment reminders, catalogue ordering and support handover on the WhatsApp Business Platform, connected to your systems.",
  },
  hero: {
    h1: "Meet customers on WhatsApp, with your systems behind it.",
    price: { ref: "S11-setup", lead: "Setup" },
    primary: cta.quote("S11"),
  },
  problem:
    "Your customers already message you on WhatsApp. Answering by hand doesn’t scale, and order details end up trapped in chats.",
  build: {
    deliverables: [
      "WhatsApp Business Platform setup through an official provider",
      "flows for order updates, payment links and reminders, catalogue ordering, COD confirmation and returns",
      "handover to a person",
      "integration with your order, billing or CRM system",
      "reporting",
    ],
  },
  pricing: {
    prices: [
      { ref: "S11-setup", lead: "Setup" },
      { ref: "S11-monthly", lead: "+ management", unit: "/month" },
    ],
    lines: [scheduleLine("Setup"), "Management: billed monthly in advance"],
    highlight: "**Meta’s per-message charges are passed through at cost.**",
  },
  faqs: [
    {
      q: "What does Meta charge?",
      a: "Per message, by category and country; we show you the current rates before you start.",
    },
  ],
  related: ["S10", "S14", "S1"],
};
