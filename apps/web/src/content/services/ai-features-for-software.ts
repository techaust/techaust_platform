// AI Features for Your Software (S13): docs/07-content.md §4.9, word for word (07's bold kept). Typesetting only:
// capitals at the start of 07's lower-case fragments where they stand alone. The payment schedule is
// scheduleOf("S13") (WEB-SVC-05). 07 has only the h1, "What you get" and pricing: no problem, how-it-works or tech.
// GAP (run file): no "Who it's for" in 07. FAQs: 07-C, drafted by the lead, confirmed by the owner (2026-10-22).
// Related: the designer's pick.
import { cta } from "../shared";
import { SCHEDULE, type ServiceContent } from "../types";

export const aiFeaturesForSoftware: ServiceContent = {
  code: "S13",
  slug: "ai-features-for-software",
  name: "AI Features for Your Software",
  meta: {
    title: "Add AI features, MCP servers and agent-ready APIs | TecHaust",
    description:
      "Smart search, summaries, copilots and document understanding in your product, plus MCP servers so AI assistants can use it. From {{price-plain:S13}}.",
  },
  hero: {
    h1: "Add useful AI to the product you already have.",
    price: { ref: "S13" },
    primary: cta.quote("S13"),
  },
  build: {
    deliverables: [
      "feature discovery (where AI actually helps your users)",
      "implementation (search, summarisation, extraction, copilots)",
      "**MCP servers and agent-ready APIs** so your product works inside ChatGPT, Claude and Copilot",
      "evaluation and cost controls",
      "documentation",
    ],
  },
  pricing: {
    prices: [{ ref: "S13" }],
    lines: ["Fixed", SCHEDULE],
  },
  faqs: [
    {
      q: "What is an MCP server?",
      a: "A standard way for AI assistants such as ChatGPT, Claude and Copilot to use your product’s features and data, with your permissions. We build one so your product works inside them.",
    },
    {
      q: "How do you decide where AI helps?",
      a: "We start with feature discovery: where AI actually saves your users time, and where it doesn’t. You see that before we build anything.",
    },
    {
      q: "How do you keep AI costs under control?",
      a: "Evaluation and cost controls are part of the build: we measure quality and usage, and set limits so costs stay predictable.",
    },
    {
      q: "Which AI models do you use?",
      a: "Chosen per project for accuracy, cost and data-handling terms; we never let providers train on your data where an opt-out exists.",
    },
    {
      q: "Who owns the code?",
      a: "You do. The code and documentation transfer to you on full payment.",
    },
  ],
  related: ["S12", "S6", "S16"],
};
