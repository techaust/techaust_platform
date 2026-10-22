// Shapes of the website's structured copy (home, the services hub and the service-page template). Text fields may
// hold docs/07 price tokens ({{price:Sx}}, {{price-plain:Sx}}), 07's bold (**…**) and the arrows → / ↔ as written
// in 07; CopyText renders all three.

/** A catalogue reference for lib/prices.ts priceOf(): "S5", "S16-essential". */
export type PriceRef = `S${number}` | `S${number}-${string}`;

/** A catalogue code: "S5". */
export type ServiceCode = `S${number}`;

export type Link = { label: string; href: string };

/** A price as a page shows it: the catalogue reference, an optional lead word ("Pilot") and unit ("per workflow"). */
export type PriceSpec = { ref: PriceRef; lead?: string; unit?: string };

/** One service in an index (home "What we do", "Related services", the services hub). */
export type ServiceLink = {
  title: string;
  href: string;
  text: string;
  price: PriceRef;
  lead?: string;
  unit?: string;
};

/**
 * One step of an ordered process (home "How we work", a service's "How it works"). `when` is the step's duration or
 * week as 07 writes it in brackets ("60 min", "Week 1"); `text` is optional (07 lists some processes as titles only).
 */
export type Step = { title: string; text?: string; when?: string };

/**
 * One question and its answer. The visible text is the single source for the FAQPage JSON-LD (M2.5, WEB-SVC-04),
 * so keep it as data, never only in markup. Only questions whose answer 07 writes out in full are listed.
 */
export type FaqItem = { q: string; a: string };

/** A titled block inside a section (07 "sub-section", e.g. S5 "From Excel or Access to a real app"). */
export type Aside = { title: string; text: string };

/**
 * The payment-schedule line of a pricing section (WEB-SVC-05): rendered from the catalogue by scheduleOf(). With a
 * label it reads "Setup: paid in full upfront" (a page whose price has parts, S11).
 */
export type ScheduleLine = { schedule: true; label?: string };
export const SCHEDULE: ScheduleLine = { schedule: true };
export const scheduleLine = (label: string): ScheduleLine => ({ schedule: true, label });
export type PricingLine = string | ScheduleLine;

/** The care-plan comparison (07 §4.14): a cell is included (true), not included (false) or a value as written. */
export type PlanCell = boolean | string;
export type Plans = {
  tiers: { name: string; price: PriceSpec; plan: string }[];
  rows: { label: string; cells: PlanCell[] }[];
  /** The small print under the table, word for word. */
  rules: string;
};

/**
 * An industry page (WEB-IND, docs/07 §5.2 and 07-D §2–§4): the h1, the problems we see, the use cases, the tools
 * (with their section label), related services (≥ 3 catalogue codes, linked with "from" prices) and the FAQ.
 */
export type IndustryContent = {
  slug: string;
  /** The industries-menu name (07 §2.1). */
  name: string;
  /** The hub card's label (07-D §1). */
  label: string;
  meta: { title: string; description: string };
  h1: string;
  problems: string[];
  useCases: string[];
  tools: { label: string; items: string[] };
  related: ServiceCode[];
  faqs: FaqItem[];
};

/**
 * A service page (docs/04 §3.2, WEB-SVC-01…06): the template renders the sections in this order and omits any
 * section with no content (WEB-SVC-02). Copy from docs/07 §4.
 */
export type ServiceContent = {
  code: ServiceCode;
  slug: string;
  /** The name as the site writes it (07 §2.1 menu name, "and" never "&"): breadcrumb, hub and related links. */
  name: string;
  meta: { title: string; description: string };
  /** The 07 §3 home one-liner, where 07 has one (the hub and related lists use it; else the h1). */
  oneLiner?: string;
  hero: {
    h1: string;
    /** 07 "Who it's for" (or "Good for", with `whoForLabel`). */
    whoFor?: string;
    whoForLabel?: "whoFor" | "goodFor";
    /** 07 "Intro" (care plans): a lede under the h1. */
    lede?: string;
    price: PriceSpec;
    primary: Link;
  };
  problem?: string;
  /** S1: the two flavours, side by side. */
  flavours?: Aside[];
  build?: {
    /** The section heading: "What we build" (text) or "What you get" (a list) by default, or a 07 label. */
    title?: string;
    text?: string;
    deliverables?: string[];
    uses?: string[];
    /** The illustrative diagram (07 §2.4 label): the stations in order. */
    diagram?: string[];
    /** A bold line under the list (S4 "Led personally by our founder."). */
    highlight?: string;
    aside?: Aside;
    /** A note under the section (S2 scope note, S12 honest note). */
    note?: string;
  };
  /** Extra sections 07 names (S14 "Payments and billing", S16 "AI Ops add-on"), after "What you get". */
  sections?: (Aside & { id: string })[];
  how?: {
    steps?: Step[];
    /** 07 writes some processes as a paragraph (S18). */
    text?: string;
    /** "Typical timeline: …" (the value only). */
    timeline?: string;
    /** "What we need from you: …" (the value only). */
    needs?: string;
    aside?: Aside;
    note?: string;
  };
  plans?: Plans;
  pricing?: {
    prices: PriceSpec[];
    lines: PricingLine[];
    /** A bold line under the lines (S1 credit rule, S11 Meta charges). */
    highlight?: string;
    note?: string;
  };
  tech?: string;
  faqs?: FaqItem[];
  /** Codes of the related services (07 where it names them, else the designer's pick, listed for the owner). */
  related?: ServiceCode[];
};
