// Shapes of the website's structured copy (home and the service-page template). Text fields may hold docs/07
// tokens ({{price:Sx}}) and the arrows → / ↔ as written in 07; CopyText renders both.

/** A catalogue reference for lib/prices.ts priceOf(): "S5", "S16-essential". */
export type PriceRef = `S${number}` | `S${number}-${string}`;

export type Link = { label: string; href: string };

/** One service in an index (home "What we do", "Related services", later the services hub). */
export type ServiceLink = { title: string; href: string; text: string; price: PriceRef; unit?: string };

/** One step of an ordered process (home "How we work", a service's "How it works"). */
export type Step = { title: string; text: string };

/**
 * One question and its answer. The visible text is the single source for the FAQPage JSON-LD (M2.5, WEB-SVC-04),
 * so keep it as data, never only in markup.
 */
export type FaqItem = { q: string; a: string };

/**
 * A service page (docs/04 §3.2, WEB-SVC-01…06): the template renders the sections in this order and omits any
 * section with no content (WEB-SVC-02). Copy from docs/07 §4.
 */
export type ServiceContent = {
  code: `S${number}`;
  slug: string;
  /** The name as the site writes it (07 §2.1 menu name, "and" never "&"), for the breadcrumb and links. */
  name: string;
  meta: { title: string; description: string };
  hero: {
    h1: string;
    whoFor: string;
    /** The hero price: the catalogue reference and an optional lead word (07: "Pilot {{price:S9}}"). */
    price: { ref: PriceRef; lead?: string; unit?: string };
    primary: Link;
  };
  problem?: string;
  build?: {
    /** "What we build" / "What you get": a paragraph, or a list of deliverables. */
    text?: string;
    deliverables?: string[];
    uses?: string[];
    /** The illustrative diagram (07 §2.4 label): the stations in order. */
    diagram?: string[];
  };
  how?: { steps: Step[]; note?: string };
  pricing?: {
    lead?: string;
    ref: PriceRef;
    unit?: string;
    /** The other lines of the engagement model, as written in 07. */
    lines: string[];
  };
  tech?: string;
  faqs?: FaqItem[];
  related?: ServiceLink[];
};
