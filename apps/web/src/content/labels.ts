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
} as const;
