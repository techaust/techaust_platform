// AI Knowledge Assistants (S12): docs/07-content.md §4.8, word for word. Typesetting only: curly apostrophes,
// capitals at the start of 07's lower-case fragments where they stand alone, and 07's pricing line
// "pilot {{price:S12}} → production → AI Ops" set as the pilot price plus the path. The payment schedule is
// scheduleOf("S12") (WEB-SVC-05). 07 calls the list "What makes ours different"; the honest note follows it.
// FAQs: 07-C, drafted by the lead, confirmed by the owner (2026-10-22). Related: the designer's pick.
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
  faqs: [
    {
      q: "Can people see documents they shouldn’t?",
      a: "It’s built so they can’t: access control means each person only gets answers from documents they’re allowed to see.",
    },
    {
      q: "How do we know the answers are right?",
      a: "Every answer shows its sources, one click away, and we measure quality on a test set of your own questions before and after every change. When the sources don’t cover a question, it says it doesn’t know.",
    },
    {
      q: "Can it run in India or on our own servers?",
      a: "Yes. India-hosted and on-premises options are available where you need them.",
    },
    {
      q: "What about model and API costs?",
      a: "They’re passed through at cost, with no mark-up. Once it’s live, AI Ops tracks the costs each month.",
    },
    {
      q: "Does it work in Indian languages?",
      a: "Yes, for the languages your documents and users need; we test them in the pilot.",
    },
  ],
  related: ["S9", "S13", "S16"],
};
