// MVP and SaaS Product Development (S6): docs/07-content.md §4.3, word for word. Typesetting only: curly apostrophes,
// capitals at the start of 07's lower-case fragments where they stand alone, and the step's bracketed week set as its
// duration. {{schedule:S6}} is scheduleOf("S6") (WEB-SVC-05).
// FAQs: 07-C, drafted by the lead, confirmed by the owner (2026-10-22). Related: the designer's pick.
import { cta, homeOneLiner } from "../shared";
import { SCHEDULE, type ServiceContent } from "../types";

export const mvpSaasDevelopment: ServiceContent = {
  code: "S6",
  slug: "mvp-saas-development",
  name: "MVP and SaaS Development",
  oneLiner: homeOneLiner("S6"),
  meta: {
    title: "MVP and SaaS development with a senior team | TecHaust",
    description:
      "A production-grade MVP in 6–10 weeks: design, web app, auth, payments, admin and analytics. Staging from day one; IP transferred on payment.",
  },
  hero: {
    h1: "A first version you won’t have to throw away.",
    whoFor: "Seed and pre-seed founders, and innovation teams inside larger companies.",
    price: { ref: "S6" },
    primary: cta.quote("S6"),
  },
  problem:
    "AI tools make prototypes cheap. Making them reliable, secure and maintainable is still the hard part, and that’s the part investors and first customers notice.",
  build: {
    deliverables: [
      "product scoping and a design-system starter",
      "a web app (and mobile if needed)",
      "auth, payments, admin and analytics",
      "staging from day one",
      "weekly demos",
      "launch support",
      "code, docs and IP handed over",
      "an optional care plan or dev subscription afterwards",
    ],
  },
  how: {
    steps: [
      { title: "Blueprint", when: "Week 0–1" },
      { title: "2-week sprints with demos" },
      { title: "Launch" },
      { title: "Stabilise" },
    ],
    aside: {
      title: "Time zones",
      text: "We overlap 3–4 hours with UK and European working days, and with US East-coast mornings by arrangement. Written updates every week.",
    },
  },
  pricing: {
    prices: [{ ref: "S6" }],
    lines: ["Fixed, sprint-based", SCHEDULE],
  },
  faqs: [
    {
      q: "Can you work with our in-house developer?",
      a: "Yes. We share the repository, review each other’s code, and agree in the plan who owns which parts.",
    },
    {
      q: "What if scope changes mid-sprint?",
      a: "We re-prioritise within the sprint, or quote the change before we do it.",
    },
    {
      q: "Do you take equity?",
      a: "No. We work for fees, so incentives stay simple.",
    },
    {
      q: "Will you sign our contract?",
      a: "Usually yes, after a review. We also have a standard MSA.",
    },
    {
      q: "Who owns the code?",
      a: "You do. The code, documentation and IP transfer to you on payment.",
    },
  ],
  related: ["S1", "S7", "S18"],
};
