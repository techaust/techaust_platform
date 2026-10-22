// Labels of the page templates (section headings and small interface words). Where docs/07 or docs/04 names the
// part, that name is used ("and" for "&"); the source is noted per line. NOT final copy from 07: listed in the M2.2
// run file for the owner to approve or change.

export const serviceLabels = {
  /** Breadcrumb landmark name and its first crumb (the nav label, 07 §2.1). */
  breadcrumb: "Breadcrumb",
  services: "Services",
  /** 07 §4 "Who it's for". */
  whoFor: "Who it’s for",
  /** 04 §3.2 "The problem" (07 §4: "Problem"). */
  problem: "The problem",
  /** 07 §4.5 "What we build" (04 §3.2: "What you get"); "What you get" on pages that list deliverables. */
  build: "What we build",
  deliverables: "What you get",
  /** 07 §4.5 "Typical uses". */
  uses: "Typical uses",
  /** 04 §3.2 / 07 §4 "How it works". */
  how: "How it works",
  /** 07 §4 "Pricing". */
  pricing: "Pricing",
  /** 04 §3.2 "Tech and integrations". */
  tech: "Tech and integrations",
  /** 07 §4 "FAQs". */
  faqs: "FAQs",
  /** 04 §3.2 "Related services". */
  related: "Related services",
} as const;
