// App Rescue and Production-Readiness Audit (S2): docs/07-content.md §4.11, word for word. Typesetting only: curly
// apostrophes and capitals at the start of 07's lower-case fragments where they stand alone ("audit …" → "Audit").
// The scope note sits under "What you get". The payment schedule is scheduleOf("S2") (WEB-SVC-05).
// GAP (run file): no "Who it's for" and no FAQs in 07 (WEB-SVC-04 wants 4–8): FAQ section not shown.
// Related: the designer's pick.
import { cta } from "../shared";
import { SCHEDULE, type ServiceContent } from "../types";

export const appRescue: ServiceContent = {
  code: "S2",
  slug: "app-rescue",
  name: "App Rescue and Audit",
  meta: {
    title: "App rescue and production-readiness audit | TecHaust",
    description:
      "A senior review of apps built fast (AI-generated, freelancer or legacy), then a fixed-price hardening plan. Audit from {{price-plain:S2}}.",
  },
  hero: {
    h1: "Your app works in the demo. Let’s make it work in production.",
    price: { ref: "S2", lead: "Audit" },
    primary: cta.audit(),
  },
  problem:
    "Apps built quickly, by AI tools, freelancers or a past team, often hide the same problems: weak security, no tests, fragile deployments, and nobody who understands all of it.",
  build: {
    deliverables: [
      "a code, security and performance review",
      "a risk-ranked fix list",
      "an optional fixed-price hardening sprint",
      "handover to a care plan",
    ],
    note: "This is an engineering review, not a formal penetration test. If you need one, we’ll recommend a specialist.",
  },
  pricing: {
    prices: [{ ref: "S2", lead: "Audit" }],
    lines: ["Hardening sprint quoted from the findings", SCHEDULE],
  },
  related: ["S16", "S4", "S5"],
};
