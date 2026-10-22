// Discovery Sprint (S1): docs/07-content.md §4.1, word for word. Typesetting only: curly apostrophes, a capital at the
// start of 07's lower-case fragments where they stand alone (who it's for, list items, steps, pricing lines), and
// each step's bracketed time set as its duration ("Kick-off call (60 min)" → "Kick-off call" + "60 min").
// "paid in full upfront" is the catalogue's payment schedule (WEB-SVC-05), rendered by scheduleOf. No Tech line and
// no case study or sample: those sections are omitted. Related services: not in 07, the designer's pick (run file).
import { cta, homeOneLiner } from "../shared";
import { SCHEDULE, type ServiceContent } from "../types";

export const discoverySprint: ServiceContent = {
  code: "S1",
  slug: "discovery-sprint",
  name: "Discovery Sprint",
  oneLiner: homeOneLiner("S1"),
  meta: {
    title: "Discovery Sprint: a fixed price before you build | TecHaust",
    description:
      "A 1–2 week paid sprint: workflow map, ROI-ranked roadmap or product blueprint, and a fixed quote. Fee credited to your build.",
  },
  hero: {
    h1: "Know exactly what to build, and what it will cost, before you commit.",
    whoFor:
      "Owners, finance and operations heads, and founders who know something must change but not yet what, or how much.",
    price: { ref: "S1" },
    primary: cta.discovery(),
  },
  problem:
    "Big software and AI projects fail in the first week, not the last: unclear goals, messy data, and a quote that was a guess. A short, paid discovery removes the guesswork for both of us.",
  flavours: [
    {
      title: "Automation Audit",
      text: "We map how documents and data move through your team today, check whether the data is ready for automation, and rank opportunities by effort and return. Includes risk and data-protection notes.",
    },
    {
      title: "Product Blueprint",
      text: "We turn your idea into scope, architecture and a clickable prototype that users can try, with a fixed quote for the first release.",
    },
  ],
  build: {
    deliverables: [
      "findings report",
      "prioritised roadmap with estimated savings (your numbers, our method)",
      "architecture sketch or clickable prototype",
      "a fixed-price proposal for phase 1",
      "a 60-minute walkthrough call",
    ],
  },
  how: {
    steps: [
      { title: "Kick-off call", when: "60 min" },
      { title: "Interviews and data samples", when: "Week 1" },
      { title: "Analysis and prototype", when: "Week 1–2" },
      { title: "Walkthrough and proposal" },
    ],
    needs: "2–4 hours of your team’s time and sample documents or data (we sign an NDA first if you like).",
  },
  pricing: {
    prices: [{ ref: "S1" }],
    lines: ["Fixed", SCHEDULE],
    highlight: "**Credited in full against your build** if you go ahead within 60 days.",
  },
  faqs: [
    {
      q: "Is the sprint worth it for a small project?",
      a: "For small, well-defined jobs, we usually skip it and quote after a call.",
    },
    {
      q: "What if you recommend not building anything?",
      a: "Then we say so. Sometimes the answer is a setting in Zoho or a better spreadsheet.",
    },
    { q: "Can the sprint be remote?", a: "Yes, fully. On-site visits in India can be arranged at cost." },
    { q: "Do you sign NDAs?", a: "Yes, before you share any data." },
  ],
  related: ["S9", "S6", "S5"],
};
