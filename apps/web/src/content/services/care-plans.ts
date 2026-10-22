// Care Plans (S16, with the AI Ops add-on S17): docs/07-content.md §4.14, word for word (07's bold kept). Typesetting
// only: curly apostrophes; 07's "Intro" is the hero lede; the table's "/mo" stays as written. Tier prices are the
// catalogue's default lines ({{price:S16-essential}} …), the add-on's price is in running text ({{price:S17}}).
// No separate schedule line: the rules already say "Billed monthly in advance" (lead, 2026-10-22; WEB-SVC-05).
// Each tier's "Choose a plan" takes its tier (07 §2.3 `plan=<tier>`); the hero and the band have no tier.
// GAP (run file): no "Who it's for" and no FAQs in 07 (WEB-SVC-04 wants 4–8): FAQ section not shown.
// Related: the designer's pick.
import { cta } from "../shared";
import type { ServiceContent } from "../types";

export const carePlans: ServiceContent = {
  code: "S16",
  slug: "care-plans",
  name: "Care Plans",
  meta: {
    title: "Website and app care plans, clear response times | TecHaust",
    description:
      "Monitoring, security patches, backups, small changes and business-hours response times. Essential, Growth and Scale plans from {{price-plain:S16-essential}} a month.",
  },
  hero: {
    h1: "Keep your software healthy, with a named response time.",
    lede: "Software that isn’t maintained slowly breaks: expiring certificates, outdated libraries, a backup nobody tested. A care plan makes someone responsible.",
    price: { ref: "S16-essential", unit: "a month" },
    primary: cta.plan(),
  },
  plans: {
    tiers: [
      { name: "Essential", price: { ref: "S16-essential", unit: "/mo" }, plan: "essential" },
      { name: "Growth", price: { ref: "S16-growth", unit: "/mo" }, plan: "growth" },
      { name: "Scale", price: { ref: "S16-scale", unit: "/mo" }, plan: "scale" },
    ],
    rows: [
      { label: "Hosting management, uptime and error monitoring", cells: [true, true, true] },
      { label: "Security and dependency updates", cells: [true, true, true] },
      { label: "Daily backups (restore-tested quarterly)", cells: [true, true, true] },
      { label: "Monthly report", cells: [true, true, true] },
      { label: "Development hours included", cells: ["2 h", "8–10 h", "25–40 h"] },
      { label: "Performance and technical SEO checks", cells: [false, true, true] },
      { label: "Quarterly roadmap call", cells: [false, true, true] },
      { label: "DevOps / CI and security review", cells: [false, false, true] },
      { label: "Fractional-CTO advisory", cells: [false, false, true] },
      {
        label: "**Response time** (business hours, Mon–Sat 10:00–19:00 IST)",
        cells: ["**2 business days**", "**1 business day**", "**4 business hours** for critical issues"],
      },
    ],
    rules:
      "Essential: no rollover. Growth and Scale: unused hours roll over for one month. Extra hours are billed at the plan rate. Pay annually and save 10 %. Out-of-hours cover can be quoted separately. Billed monthly in advance; cancel with 30 days’ notice.",
  },
  sections: [
    {
      id: "ai-ops",
      title: "AI Ops add-on",
      text: "For AI systems in production: monitoring, test-set reruns, prompt and model updates, and cost tracking, from {{price:S17}} a month.",
    },
  ],
  related: ["S2", "S18", "S14"],
};
