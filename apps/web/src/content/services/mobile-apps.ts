// Mobile Apps (S7): docs/07-content.md §4.4, word for word. Typesetting only: curly apostrophes and capitals at the
// start of 07's lower-case fragments where they stand alone. {{schedule:S7}} is scheduleOf("S7") (WEB-SVC-05).
// No "Who it's for", "How it works" or Tech line in 07: omitted.
// FAQs: 07-C, drafted by the lead, confirmed by the owner (2026-10-22).
// Related: the designer's pick.
import { cta } from "../shared";
import { SCHEDULE, type ServiceContent } from "../types";

export const mobileApps: ServiceContent = {
  code: "S7",
  slug: "mobile-apps",
  name: "Mobile Apps",
  meta: {
    title: "Cross-platform mobile apps: React Native, Flutter | TecHaust",
    description:
      "iOS and Android apps built with React Native/Expo or Flutter, usually alongside a web app or portal. Fixed price, from {{price-plain:S7}}.",
  },
  hero: {
    h1: "Mobile apps that share a backbone with your web system.",
    price: { ref: "S7" },
    primary: cta.quote("S7"),
  },
  problem:
    "A mobile app on its own is rarely the point. It’s the field team’s order form, the customer’s tracking screen, the dealer’s catalogue. It has to talk to everything else.",
  build: {
    deliverables: [
      "UX for small screens",
      "a cross-platform app (React Native/Expo or Flutter, chosen per project)",
      "API and back-end integration",
      "store submission support",
      "crash and analytics monitoring",
    ],
  },
  pricing: {
    prices: [{ ref: "S7" }],
    lines: ["Fixed", SCHEDULE],
  },
  faqs: [
    {
      q: "React Native or Flutter?",
      a: "Whichever fits your team and existing code; we use both.",
    },
    {
      q: "Do you publish to the stores?",
      a: "We prepare and submit under your developer accounts.",
    },
    {
      q: "Do we also need a web app?",
      a: "Not always, but most apps need a back end and an admin screen. We usually build them together, so everything shares one system.",
    },
    {
      q: "Who owns the app?",
      a: "You do. It’s listed under your developer accounts, and the code transfers to you on full payment.",
    },
    {
      q: "What happens after launch?",
      a: "A 30-day warranty for defects against the agreed scope, then an optional care plan for monitoring, updates and small changes.",
    },
  ],
  related: ["S5", "S6", "S16"],
};
