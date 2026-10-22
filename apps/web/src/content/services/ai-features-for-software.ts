// AI Features for Your Software (S13): docs/07-content.md §4.9, word for word (07's bold kept). Typesetting only:
// capitals at the start of 07's lower-case fragments where they stand alone. The payment schedule is
// scheduleOf("S13") (WEB-SVC-05). 07 has only the h1, "What you get" and pricing: no problem, how-it-works or tech.
// GAP (run file): no "Who it's for" and no FAQs in 07 (WEB-SVC-04 wants 4–8): FAQ section not shown.
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
  related: ["S12", "S6", "S16"],
};
