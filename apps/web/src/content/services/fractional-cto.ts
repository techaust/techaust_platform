// Fractional CTO (S4): docs/07-content.md §4.13, word for word (07's bold line kept). Typesetting only: curly
// apostrophes and capitals at the start of 07's lower-case fragments where they stand alone. The payment schedule
// is scheduleOf("S4") (WEB-SVC-05).
// GAP (run file): no problem statement in 07. FAQs: 07-C, drafted by the lead, confirmed by the owner (2026-10-22).
// Related: the designer's pick.
import { cta } from "../shared";
import { SCHEDULE, type ServiceContent } from "../types";

export const fractionalCto: ServiceContent = {
  code: "S4",
  slug: "fractional-cto",
  name: "Fractional CTO",
  meta: {
    title: "Fractional CTO for startups and SMBs | TecHaust",
    description:
      "Part-time senior technical leadership: architecture, hiring help, vendor reviews and roadmap, led by our founder. From {{price-plain:S4}} a month.",
  },
  hero: {
    h1: "Senior technical judgement, without a full-time CTO.",
    whoFor:
      "Non-technical founders, SMB owners managing in-house or outsourced developers, and startups between technical leaders.",
    price: { ref: "S4", unit: "per month" },
    primary: cta.talk(),
  },
  build: {
    deliverables: [
      "a fixed number of hours each month",
      "architecture and build-vs-buy decisions",
      "vendor and code-quality reviews",
      "hiring help (job specs, interviews)",
      "a roadmap and a monthly written report",
    ],
    highlight: "**Led personally by our founder.**",
  },
  pricing: {
    prices: [{ ref: "S4", unit: "per month" }],
    lines: ["Monthly retainer", "30 days’ notice to stop", SCHEDULE],
  },
  faqs: [
    {
      q: "Who will we work with?",
      a: "Our founder, personally.",
    },
    {
      q: "How many hours a month?",
      a: "A fixed number agreed up front, usually between 8 and 20 hours a month.",
    },
    {
      q: "Can you help us hire developers?",
      a: "Yes: job specs, interview questions, and interviews alongside you.",
    },
    {
      q: "Can you review our outsourced team’s work?",
      a: "Yes. Vendor and code-quality reviews are part of the role, with the findings in your monthly written report.",
    },
    {
      q: "How do we stop?",
      a: "It’s a monthly retainer with 30 days’ notice to stop.",
    },
  ],
  related: ["S1", "S2", "S18"],
};
