// Mobile Apps (S7): docs/07-content.md §4.4, word for word. Typesetting only: curly apostrophes and capitals at the
// start of 07's lower-case fragments where they stand alone. {{schedule:S7}} is scheduleOf("S7") (WEB-SVC-05).
// No "Who it's for", "How it works" or Tech line in 07: omitted.
// GAP (run file): two FAQs in 07, fewer than 4 (WEB-SVC-04), so the FAQ section is not shown until 07 has more.
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
    { q: "React Native or Flutter?", a: "Whichever fits your team and existing code; we use both." },
    { q: "Do you publish to the stores?", a: "We prepare and submit under your developer accounts." },
  ],
  related: ["S5", "S6", "S16"],
};
