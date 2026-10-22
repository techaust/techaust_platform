// Labels of the page templates (section headings and small interface words). Where docs/07 or docs/04 names the
// part, that name is used ("and" for "&"); the source is noted per line. The M2.2 preview's labels were approved by
// the owner (2026-10-22); the ones marked NEW (M2.2 build) are listed in the run file for approval.

export const serviceLabels = {
  /** Breadcrumb landmark name and its first crumb (the nav label, 07 §2.1). */
  breadcrumb: "Breadcrumb",
  services: "Services",
  /** 07 §4 "Who it's for". */
  whoFor: "Who it’s for",
  /** NEW: 07 §4.15 "Good for" (S18). */
  goodFor: "Good for",
  /** 04 §3.2 "The problem" (07 §4: "Problem"). */
  problem: "The problem",
  /** NEW: 07 §4.1 "Two flavours" (S1). */
  flavours: "Two flavours",
  /** 07 §4.5 "What we build" (04 §3.2: "What you get"); "What you get" on pages that list deliverables. */
  build: "What we build",
  deliverables: "What you get",
  /** 07 §4.5 "Typical uses". */
  uses: "Typical uses",
  /** 04 §3.2 / 07 §4 "How it works". */
  how: "How it works",
  /** NEW: 07 §4.2 "Typical timeline" and 07 §4.1 "What we need from you". */
  timeline: "Typical timeline",
  needs: "What we need from you",
  /** 07 §4 "Pricing". */
  pricing: "Pricing",
  /** 04 §3.2 "Tech and integrations". */
  tech: "Tech and integrations",
  /** 07 §4 "FAQs". */
  faqs: "FAQs",
  /** 04 §3.2 "Related services". */
  related: "Related services",
  /** NEW: the care-plan comparison (07 §3 "Compare care plans", the home teaser's CTA). */
  compare: "Compare care plans",
  /** NEW: the comparison table's cells, for assistive technology (07 writes ✓ and —). */
  included: "Included",
  notIncluded: "Not included",
  /** The services hub's jump nav, for assistive technology (lead, 2026-10-22: its own name, not the page's). */
  kinds: "Kinds of work",
} as const;

/**
 * Labels of the M2.3 pages (industries, pricing, about, work, blog, legal). Same rule as above: the source is noted;
 * NEW (M2.3 build) marks interface words that docs/07 doesn't have, listed in the run file for the owner.
 */
export const pageLabels = {
  /** The nav label (07 §2.1), as the breadcrumb's first crumb on the industry pages. */
  industries: "Industries",
  /** 07-D §2 section label of "The problems we see" (used on all three industry pages). */
  problems: "What slows teams down",
  /** 07 §5.2 "Use cases". */
  useCases: "Use cases",
  /** 07-D §2 section label of "Tools we connect" (finance and retail); SaaS has its own (07-D §4). */
  tools: "Works with",
  stacks: "Stacks we use",
  /** 07 §5.3 sections. */
  whatAffects: "What affects the price",
  howPayment: "How payment works",
  /** NEW: the price list's column headings (07 §5.3 "the price table grouped by category"). */
  colService: "Service",
  colPrice: "Starting price",
  colPayment: "Payment",
  /** 07 §5.7 section names. */
  founder: "Founder",
  team: "The team",
  values: "What we value",
  where: "Where we are",
  /** 07 §5.4 detail template. */
  context: "Context",
  industry: "Industry",
  size: "Size",
  region: "Region",
  problem: "The problem",
  stack: "Stack",
  similar: "Similar project?",
  /** 07 §3 Proof ("Anonymised at the client's request"). */
  anonymised: "Anonymised at the client’s request",
  /** The footer label (07 §2.2), as the blog's h1 and breadcrumb (07 gives /blog no h1). */
  blog: "Blog",
  /** NEW: blog post meta. */
  updated: "Updated",
  minRead: "min read",
  by: "By",
  tags: "Tags",
  /** NEW: the contents list of long pages (docs/06 §5.2 TOC). */
  onThisPage: "On this page",
  /** 07-A: "Summary (shown first, in a box)"; the version log (07-A "a short changelog at the bottom"). */
  summary: "Summary",
  changes: "Changes",
  /** NEW: the version log's column headings. */
  colVersion: "Version",
  colDate: "Date",
  colNote: "What changed",
} as const;
