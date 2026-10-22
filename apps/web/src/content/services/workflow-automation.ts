// Workflow Automation and AI Agents (S10): docs/07-content.md §4.6, word for word. Typesetting only: curly apostrophes
// and capitals at the start of 07's lower-case fragments where they stand alone. The payment schedule is
// scheduleOf("S10") (WEB-SVC-05). The page's own CTA "Automate a workflow" (07 §4.6, 04 §3.2) is not in the 07 §2.3
// table, so it takes the build-quote target.
// GAP (run file): 07 writes answers for two of the three FAQs ("n8n, Make or custom?" has none): fewer than 4
// (WEB-SVC-04), so the FAQ section is not shown until 07 has them. Related: the designer's pick.
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
    { q: "Who owns the accounts?", a: "You do; we build in your workspace." },
    { q: "What happens when an API changes?", a: "Alerts tell us; on a care plan we fix it." },
  ],
  related: ["S9", "S11", "S14"],
};
