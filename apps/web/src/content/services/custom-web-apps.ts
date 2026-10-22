// Custom Web Apps and Business Portals (S5): docs/07-content.md §4.2, word for word. Typesetting only: curly
// apostrophes, capitals at the start of 07's lower-case fragments where they stand alone, and each step's bracketed
// time set as its duration. {{schedule:S5}} is scheduleOf("S5") (WEB-SVC-05).
// GAPS (run file): 07's four FAQs are notes in brackets, not written answers, so the FAQ section is omitted (never
// written by the designer); 04 asks for a UI/UX section (S8) and 07 has no copy for it beyond the deliverable
// "discovery and UX design (S8 included)", shown as written. Related services: the designer's pick (run file).
import { cta, homeOneLiner } from "../shared";
import { SCHEDULE, type ServiceContent } from "../types";

export const customWebApps: ServiceContent = {
  code: "S5",
  slug: "custom-web-apps",
  name: "Custom Web Apps and Portals",
  oneLiner: homeOneLiner("S5"),
  meta: {
    title: "Custom web apps and business portals | TecHaust",
    description:
      "Internal tools, client and dealer portals, and Excel or Access processes rebuilt as secure web apps. Fixed price, from {{price-plain:S5}}.",
  },
  hero: {
    h1: "The software your business actually runs on, built properly.",
    whoFor:
      "Operations, finance and sales teams outgrowing spreadsheets and email threads; companies replacing per-seat SaaS that doesn’t fit.",
    price: { ref: "S5" },
    primary: cta.quote("S5"),
  },
  problem:
    "Most businesses run on a patchwork: a shared Excel file, a WhatsApp group and a SaaS tool that does 60 % of the job. It works until it doesn’t. Then nobody knows which version is right.",
  build: {
    deliverables: [
      "discovery and UX design (S8 included)",
      "a web app with roles and permissions",
      "integrations with your existing tools",
      "automated tests",
      "staging and production environments",
      "documentation and handover",
      "a 30-day warranty",
      "an optional care plan",
    ],
    aside: {
      title: "From Excel or Access to a real app",
      text: "We keep what works about your spreadsheet (the speed, the familiarity) and add what it lacks: one source of truth, permissions, an audit trail, and nobody overwriting anyone else’s work.",
    },
  },
  how: {
    steps: [
      { title: "Discover", when: "1–2 weeks" },
      { title: "Design", when: "1–2 weeks" },
      { title: "Build in milestones with fortnightly demos" },
      { title: "Launch" },
      { title: "Warranty" },
      { title: "Care plan" },
    ],
    timeline: "6–14 weeks",
  },
  pricing: {
    prices: [{ ref: "S5" }],
    lines: ["Fixed per milestone", SCHEDULE, "Change requests quoted before work"],
  },
  tech: "Modern web stack (TypeScript, React, cloud hosting in India or abroad), chosen per project and documented.",
  related: ["S7", "S2", "S16"],
};
