// Workflow Automation and AI Agents (S10): docs/07-content.md §4.6, word for word. Typesetting only: curly apostrophes
// and capitals at the start of 07's lower-case fragments where they stand alone. The payment schedule is
// scheduleOf("S10") (WEB-SVC-05). The page's own CTA "Automate a workflow" (07 §4.6, 04 §3.2) is not in the 07 §2.3
// table, so it takes the build-quote target.
// FAQs: 07-C, drafted by the lead, confirmed by the owner (2026-10-22). Related: the designer's pick.
import { cta, homeOneLiner } from "../shared";
import { SCHEDULE, type ServiceContent } from "../types";

export const workflowAutomation: ServiceContent = {
  code: "S10",
  slug: "workflow-automation",
  name: "Workflow Automation and AI Agents",
  oneLiner: homeOneLiner("S10"),
  meta: {
    title: "Workflow automation and AI agents | TecHaust",
    description:
      "Automations across email, sheets, CRM and accounting with n8n, Make or custom code, monitored and documented. From {{price-plain:S10}} per workflow.",
  },
  hero: {
    h1: "Hand off the repetitive work, without losing sight of it.",
    price: { ref: "S10", unit: "per workflow" },
    primary: cta.own("Automate a workflow", "S10"),
  },
  problem:
    "Copying leads from email to the CRM, chasing payments, building the Monday report: small jobs that eat hours, and break quietly when someone changes a column.",
  build: {
    deliverables: [
      "a workflow map",
      "built and tested automations (n8n, Make or custom code)",
      "narrow AI agents where they help (lead qualification, collection follow-ups, order-status replies, report drafting)",
      "error alerts",
      "a run-book",
      "optional monitoring on a care plan",
    ],
    aside: {
      title: "Quick-Win bundle",
      text: "3–5 small automations delivered together: the fastest way to see what automation can do for you.",
    },
  },
  pricing: {
    prices: [{ ref: "S10", unit: "per workflow" }],
    lines: ["Quick-Win bundles quoted", "Monthly retainer for monitoring and new workflows", SCHEDULE],
  },
  faqs: [
    {
      q: "n8n, Make or custom code?",
      a: "Whichever fits the job and your team: n8n or Make for flows your team may want to adjust themselves, custom code where volume, reliability or a missing connector calls for it. The workflow map explains the choice.",
    },
    {
      q: "Who owns the accounts?",
      a: "You do; we build in your workspace.",
    },
    {
      q: "What happens when an API changes?",
      a: "Alerts tell us; on a care plan we fix it.",
    },
    {
      q: "What’s in a Quick-Win bundle?",
      a: "3–5 small automations delivered together for one quoted price: the fastest way to see what automation can do for you.",
    },
    {
      q: "How is it priced?",
      a: "From {{price:S10}} per workflow. Quick-Win bundles are quoted, and monitoring plus new workflows can run on a monthly retainer.",
    },
  ],
  related: ["S9", "S11", "S14"],
};
