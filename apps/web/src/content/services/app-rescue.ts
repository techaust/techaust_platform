// App Rescue and Production-Readiness Audit (S2): docs/07-content.md §4.11, word for word. Typesetting only: curly
// apostrophes and capitals at the start of 07's lower-case fragments where they stand alone ("audit …" → "Audit").
// The scope note sits under "What you get". The payment schedule is scheduleOf("S2") (WEB-SVC-05).
// GAP (run file): no "Who it's for" in 07. FAQs: 07-C, drafted by the lead, confirmed by the owner (2026-10-22).
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
  faqs: [
    {
      q: "What kinds of apps do you audit?",
      a: "Apps built quickly with AI tools (such as Lovable, Bolt or Cursor), by freelancers or by a past team, and older apps that have become fragile.",
    },
    {
      q: "Is this a penetration test?",
      a: "No. It’s an engineering review of code, security and performance. If you need a formal penetration test, we’ll recommend a specialist.",
    },
    {
      q: "What do we get at the end?",
      a: "A written report and a risk-ranked fix list, with an optional fixed-price hardening sprint for the most important items.",
    },
    {
      q: "Do we have to use you for the fixes?",
      a: "No. The report and fix list are yours; your own team or another vendor can work from them.",
    },
    {
      q: "What does it cost?",
      a: "The audit is from {{price:S2}}; the hardening sprint is quoted from the findings.",
    },
  ],
  related: ["S16", "S4", "S5"],
};
