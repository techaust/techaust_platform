// The company pages: How we work (/how-we-work, WEB-HOW: docs/07 §5.5 + 07-D §5), How we build AI (/how-we-build-ai,
// WEB-AI: 07 §5.6) and About (/about, WEB-ABOUT: 07 §5.7). Word for word; typesetting only (curly apostrophes and
// quotes; 07's quote marks around list items, which only mark the copy, are left out). Section names are 07's.
// Prices are {{price:Sx}} tokens. Change copy in docs/07 first.
import { home } from "./home";
import type { Step } from "./types";

/** The four steps: the home title and line (07 §3), then the expanded text (07-D §5). */
export type DetailedStep = Step & { more: string };

const [discover, plan, build, launch] = home.how.steps as readonly Step[];
if (!discover || !plan || !build || !launch) throw new Error("How we work: the home page has fewer than four steps");

export const howWeWork = {
  meta: {
    title: "How we work: process, pricing rules and ownership | TecHaust",
    description:
      "Our 4-step process, fixed-price rules, IP transfer, time-zone overlap, communication cadence, AI-use policy and warranty.",
  },
  h1: "How we work",
  steps: {
    title: "The four steps",
    items: [
      {
        ...discover,
        more: "For larger projects, a Discovery Sprint ({{price:S1}}, 1–2 weeks) maps how the work is done today, the systems involved and the data, and ends with a costed plan and a fixed quote. The fee is credited to your build if you go ahead within 60 days. Smaller jobs start with a free call.",
      },
      {
        ...plan,
        // 07-D §5 (approved with its 🟧 note): "You accept it online" once the client portal has proposal acceptance;
        // until then "You accept it in writing". Switch this sentence when the portal milestone ships acceptance.
        more: "The proposal sets out the scope, what you’ll receive, the timeline, the fixed price and the payment schedule. You accept it in writing, and nothing starts until you do.",
      },
      {
        ...build,
        more: "You get a staging link in the first week and a demo every sprint, with a weekly written update in between. Changes to the scope are quoted before we do them, and you decide.",
      },
      {
        ...launch,
        more: "We launch together, hand over the code, documentation and access, and fix defects in what we delivered free for 30 days. After that, a care plan keeps it monitored, patched and backed up.",
      },
    ] satisfies DetailedStep[],
  },
  models: {
    title: "Engagement models",
    items: [
      { name: "fixed price", note: "most projects" },
      { name: "pilot → rollout", note: "AI" },
      { name: "retainer", note: "care plans, fractional CTO" },
      { name: "subscription", note: "dev subscription" },
    ],
  },
  /** Sections 3–8 of 07 §5.5, in order. */
  terms: [
    {
      id: "fixed-price",
      title: "Fixed-price rules",
      text: "The price covers the written scope. If you want something new, we quote it before doing it, and you decide. We don’t bill for our own estimating mistakes.",
    },
    {
      id: "ownership",
      title: "Ownership",
      text: "On full payment, the code, designs and documentation are yours. We keep the right to reuse general know-how and our own pre-existing tools, which we list in the proposal.",
    },
    {
      id: "time-zones",
      title: "Working across time zones",
      text: "We’re in India (IST, UTC+5:30). We keep 3–4 hours of overlap with UK and European working days, and with US East-coast mornings by arrangement.",
    },
    {
      id: "communication",
      title: "Communication",
      text: "A weekly written update, a demo every sprint, one shared channel, and a named contact.",
    },
    {
      id: "ai-tools",
      title: "How we use AI tools",
      text: "We use AI coding and writing tools to work faster. A senior engineer reviews everything before it reaches you, and we never paste your confidential data into tools that train on it.",
    },
    {
      // 30-day warranty confirmed by the owner on 2026-10-22 (07 §1.4 claims register).
      id: "warranty",
      title: "Warranty",
      text: "Defects in what we delivered are fixed free for 30 days after launch.",
    },
  ],
  after: {
    title: "After launch",
    text: "Software needs looking after: dependencies age, vendors change their systems, and small changes keep coming. Care plans cover monitoring, security patches, backups, small changes and a named response time, from {{price:S16-essential}} a month.",
    link: { label: "Compare care plans", href: "/services/care-plans" },
  },
} as const;

export const howWeBuildAi = {
  meta: {
    title: "How we build AI systems you can trust | TecHaust",
    description:
      "Production-first AI: test sets, guardrails, human review, careful data handling and honest limits. How we design AI that holds up in real work.",
  },
  h1: "How we build AI that holds up in real work",
  lede: "Most AI pilots fail not because the model is weak, but because nobody measured, nobody reviewed, and nobody planned for the cases it gets wrong. We design for those cases from day one.",
  principlesTitle: "Principles",
  principles: [
    {
      title: "Measure first",
      text: "We agree a baseline and build a test set from your real examples before we write code.",
    },
    {
      title: "People stay in control",
      text: "Uncertain results go to a review screen. People approve; the system learns what to escalate.",
    },
    {
      title: "Show the source",
      text: "Answers and extracted fields link back to the document they came from.",
    },
    {
      title: "Guardrails",
      text: "Input checks, output validation and limits on what an AI step is allowed to do.",
    },
    {
      title: "Data handling",
      text: "We use providers whose terms don’t train on your data where an opt-out exists, keep data in India where required, and document every system that touches it.",
    },
    {
      // VERIFY WITH CA/LEGAL (07 §5.6): the DPDP reference.
      title: "Privacy by design",
      text: "Collect only what’s needed, delete on schedule, and log access, in line with India’s DPDP Act.",
    },
    {
      title: "Honest limits",
      text: "No AI system is right every time. We tell you where ours is weaker, and we monitor it after launch.",
    },
  ],
} as const;

export const about = {
  meta: {
    title: "About TecHaust Technologies | Senior software studio, India",
    description:
      "A small senior software and AI automation studio in Balurghat, West Bengal, working with clients across India and abroad.",
  },
  h1: "A small senior team, by design",
  /** Approved as written (owner, 2026-10-22). */
  story:
    "TecHaust Technologies is a software and AI automation studio in Balurghat, West Bengal. We’ve delivered 20+ projects (business web apps, SaaS products, automations and mobile apps) for clients in India and abroad. We stay deliberately small: a few senior people who build carefully, explain clearly, and look after what they ship.",
  founder: {
    name: "Rupak Sarkar",
    role: "Founder",
  },
  /** No names or photos until each person agrees (07 §5.7). */
  team: "Alongside the founder, a small team of senior engineers and designers, each with 10+ years’ experience across web, mobile, AI and automation. We bring in trusted specialists, such as security testers and legal partners, when a project needs them.",
  values: [
    "Say what we’ll do, then do it",
    "Fixed prices, written scope",
    "Senior people on every project",
    "Honest numbers",
    "Look after what we build",
  ],
  where: "Balurghat, West Bengal, India. We work remotely with clients everywhere, and visit in India when it helps.",
} as const;
