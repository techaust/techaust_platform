// The Work pages (/work, /work/<slug>, WEB-WORK): docs/07-content.md §5.4, word for word. Case studies themselves are
// Markdown entries in src/content/work (none yet: they come from the owner's briefs, 07 §6, and only verified ones are
// published, lib/work.ts).
export const workPage = {
  meta: {
    title: "Work: anonymised case studies | TecHaust",
    description:
      "Case studies from our client projects, anonymised at clients’ request: the problem, our approach, the stack and real results.",
  },
  h1: "Work",
  /** Shown only while at least one case study is published (07-Y item 3, owner 2026-10-29). */
  lede: "Selected projects, anonymised at our clients’ request. Every number on these pages was measured on the real project.",
  empty:
    "Our first public case studies are being written with our clients’ permission. Want to see how we work? Ask us for a sample discovery report or architecture document.",
} as const;

/** The blog index (/blog, WEB-BLOG). 07 gives it no h1 or meta: the h1 is the footer label "Blog" (labels.ts). */
export const blogPage = {
  // The description is 07-F (owner-approved); the RSS channel uses the same line.
  meta: {
    title: "Blog | TecHaust",
    description:
      "Practical notes on custom software, AI document automation, workflow automation and connecting business systems, from the TecHaust team.",
  },
  /** 07-D §6: shown while no post is published (owner decision 2026-10-22, docs/13). */
  empty:
    "Our first articles are on their way: practical guides on Tally automation, GST e-invoicing and automation audits.",
} as const;
