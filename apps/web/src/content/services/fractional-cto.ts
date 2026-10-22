// Fractional CTO (S4): docs/07-content.md §4.13, word for word (07's bold line kept). Typesetting only: curly
// apostrophes and capitals at the start of 07's lower-case fragments where they stand alone. The payment schedule
// is scheduleOf("S4") (WEB-SVC-05).
// GAP (run file): no problem statement and no FAQs in 07 (WEB-SVC-04 wants 4–8): FAQ section not shown.
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
  related: ["S1", "S2", "S18"],
};
