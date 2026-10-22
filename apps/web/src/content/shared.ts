// Shared snippets: docs/07-content.md §2.4, word for word, and the standard CTA labels of §2.3.

export const shared = {
  /** VERIFY WITH CA (07 §2.4). */
  gstNote: "Prices exclude GST (18 %).",
  usdNote: "International projects are invoiced from India in USD as an export of services.",
  illustrative: "Illustrative example. Not a real client system.",
  cta: {
    discovery: "Book a Discovery Sprint",
    quote: "Get a quote",
    pilot: "Start a pilot",
    talk: "Talk to us",
    pricing: "See pricing",
  },
} as const;
