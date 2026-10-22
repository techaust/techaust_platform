// AI Knowledge Assistants (S12): docs/07-content.md §4.8, word for word. Typesetting only: curly apostrophes,
// capitals at the start of 07's lower-case fragments where they stand alone, and 07's pricing line
// "pilot {{price:S12}} → production → AI Ops" set as the pilot price plus the path. The payment schedule is
// scheduleOf("S12") (WEB-SVC-05). 07 calls the list "What makes ours different"; the honest note follows it.
// GAP (run file): no FAQs in 07 (WEB-SVC-04 wants 4–8): FAQ section not shown. Related: the designer's pick.
import { cta } from "../shared";
import { SCHEDULE, type ServiceContent } from "../types";

export const aiKnowledgeAssistants: ServiceContent = {
  code: "S12",
  slug: "ai-knowledge-assistants",
  name: "AI Knowledge Assistants",
  meta: {
    title: "Private AI knowledge assistants with citations | TecHaust",
    description:
      "Search and answers over your own documents, with access control, source citations and a quality test set. Pilot from {{price-plain:S12}}.",
  },
  hero: {
    h1: "Answers from your own documents, with the source one click away.",
    whoFor: "Legal, CA and consulting firms; support teams; companies with large policy and SOP libraries.",
    price: { ref: "S12", lead: "Pilot" },
    primary: cta.pilot("S12"),
  },
  problem:
    "The answer is somewhere in 4,000 PDFs and three shared drives. General chatbots don’t know your documents, and you can’t let them see everything.",
  build: {
    title: "What makes ours different",
    deliverables: [
      "access control (people only see what they’re allowed to)",
      "citations on every answer",
      "a quality test set we run before and after changes",
      "India-hosted or on-premises options where needed",
      "honest “I don’t know” behaviour when the sources don’t cover a question",
    ],
    note: "No AI system is right every time. We design for traceability: every answer shows its sources, and we measure quality on your own questions.",
  },
  pricing: {
    prices: [{ ref: "S12", lead: "Pilot" }],
    lines: ["Pilot → production → AI Ops", "Model and API usage passed through at cost", SCHEDULE],
  },
  related: ["S9", "S13", "S16"],
};
