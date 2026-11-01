// Structured data (JSON-LD, M2.5; WEB-G-09, WEB-SVC-04, WEB-BLOG): pure builders for the one @graph every page prints.
// Every page has the Organization and the WebSite; a page adds the nodes that match what it shows: BreadcrumbList (the
// same trail Breadcrumbs.astro renders), Service (service pages), FAQPage (the visible FAQ), Article (blog posts).
// Nothing here states a fact the site doesn't show: no Review, no AggregateRating, no Person beyond the blog author,
// and the company LinkedIn joins `sameAs` only once site.linkedinCompany is set. Prices come from the catalogue
// (never typed). The page-side collector is lib/ld-collector.ts; the dist test (test/structured-data.test.ts) checks
// every built page against its visible text.
import type { Money } from "@techaust/core";
import { site } from "../config/site";
import { ORIGIN } from "./machine-files";

export type LdNode = Record<string, unknown>;

export const ORG_ID = `${ORIGIN}/#org`;
export const WEBSITE_ID = `${ORIGIN}/#website`;

/** The logo file on the site: copied from @techaust/ui/brand at build time (astro.config.mjs emailLogos). */
export const LOGO_PATH = "/brand/logo-email-color@2x.png";

type SiteSlice = Pick<
  typeof site,
  "name" | "email" | "locality" | "postalAddress" | "linkedinCompany" | "phone"
>;

/**
 * The postal address as a PostalAddress: the street line is the owner's address minus its region and PIN; the
 * locality is the first part of site.locality. Returns null while the address is empty (never invented).
 */
export function postalAddressNode(s: Pick<SiteSlice, "postalAddress" | "locality">): LdNode | null {
  const raw = s.postalAddress.trim();
  if (!raw) return null;
  const pin = /\b(\d{6})\b/.exec(raw)?.[1];
  const parts = raw.split(",").map((p) => p.trim());
  const last = parts.at(-1) ?? "";
  const region = pin && last.includes(pin) ? last.replace(pin, "").trim() : "";
  const street = (region ? parts.slice(0, -1) : parts).join(", ");
  return {
    "@type": "PostalAddress",
    streetAddress: street,
    addressLocality: s.locality.split(",")[0]?.trim() ?? "",
    ...(region ? { addressRegion: region } : {}),
    ...(pin ? { postalCode: pin } : {}),
    addressCountry: "IN",
  };
}

/**
 * WEB-G-10's identity fields (docs/04; audit A2 finding 4), word for word: the short name (02-C section 4: "TecHaust" only, never
 * "Techaust", which would merge us with Tech Australia), India and worldwide as the area served, NAICS 541511 (custom computer
 * programming services) and the line that tells us apart from Tech Australia. No taxID and no proprietor name (owner: invoices only).
 */
export const ORG_IDENTITY = {
  alternateName: ["TecHaust"],
  areaServed: [
    { "@type": "Country", name: "India" },
    { "@type": "Place", name: "Worldwide" },
  ],
  naics: "541511",
  disambiguatingDescription: "Indian software and AI automation studio; not affiliated with Tech Australia",
} as const;

export function organizationNode(s: SiteSlice = site): LdNode {
  const address = postalAddressNode(s);
  const sameAs = [s.linkedinCompany].filter((u) => u !== "");
  return {
    "@type": ["Organization", "ProfessionalService"],
    "@id": ORG_ID,
    name: s.name,
    alternateName: [...ORG_IDENTITY.alternateName],
    url: ORIGIN,
    logo: { "@type": "ImageObject", url: `${ORIGIN}${LOGO_PATH}` },
    email: s.email,
    // The company phone in Google's form (E.164, "+919883023931"; owner, 2026-11-01), only while the site shows it
    // (test/company-phone.test.ts: `dial` is empty exactly when `display` is).
    ...(s.phone.dial ? { telephone: s.phone.dial } : {}),
    ...(address ? { address } : {}),
    areaServed: ORG_IDENTITY.areaServed.map((a) => ({ ...a })),
    naics: ORG_IDENTITY.naics,
    disambiguatingDescription: ORG_IDENTITY.disambiguatingDescription,
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

export function websiteNode(s: Pick<SiteSlice, "name"> = site): LdNode {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: ORIGIN,
    name: s.name,
    inLanguage: "en-IN",
    publisher: { "@id": ORG_ID },
  };
}

/** The absolute URL of a site path, no trailing slash except the home page. */
export function absoluteUrl(path: string): string {
  const href = new URL(path, `${ORIGIN}/`).href;
  return href.length > ORIGIN.length + 1 && href.endsWith("/") ? href.slice(0, -1) : href;
}

export type Crumb = { label: string; href?: string };

/** BreadcrumbList from the trail Breadcrumbs.astro renders; the last crumb (the current page) is the page's own URL. */
export function breadcrumbNode(trail: readonly Crumb[], pagePath: string): LdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      item: absoluteUrl(c.href ?? pagePath),
    })),
  };
}

/** A minor-unit amount as a plain decimal string ("200000.00"), with integer maths only. */
export function decimalAmount(m: Money): string {
  const abs = BigInt(Math.abs(m.amount));
  const sign = m.amount < 0 ? "-" : "";
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

/** A unit that means "per month": "a month", "per month", "/month", "/mo". */
export const MONTHLY = /(^|[\s/])(month|mo)$/i; // scripts/web-seo-checks.mjs `MONTHLY_UNIT` matches it (pinned by a test)

export type ServiceInput = {
  name: string;
  description: string;
  path: string;
  /** The catalogue "from" price in INR (the one the page shows); omitted when the page shows none. */
  fromInr?: Money;
  /** The unit the hero prints after the price ("a month", "per workflow"), as the page words it. */
  unit?: string;
  /** The lead word the hero prints before "from" ("Pilot", "Audit", "Setup"); becomes the Offer's name. */
  lead?: string;
  /** The page shows a USD price too, so the service is offered outside India. */
  international: boolean;
};

export function serviceNode(i: ServiceInput): LdNode {
  const url = absoluteUrl(i.path);
  return {
    "@type": "Service",
    "@id": `${url}#service`,
    name: i.name,
    description: i.description,
    url,
    provider: { "@id": ORG_ID },
    areaServed: [
      { "@type": "Country", name: "India" },
      ...(i.international ? [{ "@type": "Place", name: "International" }] : []),
    ],
    ...(i.fromInr
      ? {
          offers: {
            "@type": "Offer",
            priceCurrency: "INR",
            ...(i.lead ? { name: i.lead } : {}),
            priceSpecification: {
              "@type": i.unit ? "UnitPriceSpecification" : "PriceSpecification",
              minPrice: decimalAmount(i.fromInr),
              priceCurrency: "INR",
              ...(i.unit ? { unitText: i.unit } : {}),
              // A monthly price also says so in a form machines read: one month.
              ...(i.unit && MONTHLY.test(i.unit)
                ? { referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" } }
                : {}),
            },
            url,
          },
        }
      : {}),
  };
}

export type FaqPair = { q: string; a: string };

/** FAQPage from the visible FAQ (the caller passes the questions and answers as plain text). */
export function faqNode(items: readonly FaqPair[], pagePath: string): LdNode {
  return {
    "@type": "FAQPage",
    "@id": `${absoluteUrl(pagePath)}#faq`,
    mainEntity: items.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export type ArticleInput = {
  slug: string;
  headline: string;
  description: string;
  datePublished: string;
  dateModified: string;
  authorName: string;
};

export function articleNode(i: ArticleInput): LdNode {
  const url = absoluteUrl(`/blog/${i.slug}`);
  return {
    "@type": "Article",
    "@id": `${url}#article`,
    headline: i.headline,
    description: i.description,
    datePublished: i.datePublished,
    dateModified: i.dateModified,
    author: { "@type": "Person", name: i.authorName, url: absoluteUrl("/about") },
    publisher: { "@id": ORG_ID },
    mainEntityOfPage: url,
    inLanguage: "en-IN",
  };
}

/** The page's single graph: Organization and WebSite first, then the page's own nodes in the order they were added. */
export function buildGraph(own: readonly LdNode[]): { "@graph": LdNode[] } {
  return { "@graph": [organizationNode(), websiteNode(), ...own] };
}
