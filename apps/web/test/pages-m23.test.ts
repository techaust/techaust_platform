// The M2.3 pages' content (designer, step 2b): industries link at least 3 live services and carry their FAQs; the
// pricing extras exist on their pages; every legal page has text; the VERIFY notes stay out of page text; the cookie
// page leaves Google Analytics out while the GA4 ID is empty; every string renders (tokens resolve, no "&"); the
// plain-text helper for JSON-LD drops markup.
import { describe, expect, it } from "vitest";
import { site } from "../src/config/site";
import { about, howWeBuildAi, howWeWork } from "../src/content/company";
import { industries, industriesHub } from "../src/content/industries";
import { legalPages } from "../src/content/legal-pages";
import { pricing, pricingExtras } from "../src/content/pricing";
import { serviceContent } from "../src/content/services";
import { blogPage, workPage } from "../src/content/work-page";
import { plainCopy } from "../src/lib/copy";
import { LEGAL_SLUGS } from "../src/lib/legal";
import { isServiceOnSite } from "../src/lib/prices";
import { parseTokens } from "../src/lib/tokens";

/** Every string in a content object. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

const all = [
  industries,
  industriesHub,
  pricing,
  howWeWork,
  howWeBuildAi,
  about,
  workPage,
  blogPage,
  legalPages,
];

describe("M2.3 content", () => {
  it("renders every string: tokens resolve, no '&', no VERIFY note in page text", () => {
    for (const text of all.flatMap(strings)) {
      expect(() => parseTokens(text)).not.toThrow();
      expect(text).not.toMatch(/ & /);
      expect(text).not.toMatch(/VERIFY/);
    }
  });

  it("links at least 3 live services from each industry page (WEB-IND) and shows its FAQs", () => {
    expect(industries.map((i) => i.slug)).toEqual([
      "finance-accounting-legal",
      "retail-ecommerce-logistics",
      "saas-startups",
    ]);
    for (const i of industries) {
      expect(i.related.length).toBeGreaterThanOrEqual(3);
      for (const code of i.related) expect(isServiceOnSite(code)).toBe(true);
      expect(i.faqs.length).toBe(5);
      expect(i.problems.length).toBe(4);
    }
  });

  it("points the pricing extras at sections that exist on their pages", () => {
    for (const x of pricingExtras) {
      const page = serviceContent(x.after);
      const id = x.href.split("#")[1]?.replace(/-title$/, "");
      expect(page.sections?.some((s) => s.id === id)).toBe(true);
    }
  });

  it("has text for every legal page and ends privacy and terms with 07-A's own Changes section", () => {
    for (const slug of LEGAL_SLUGS) {
      const doc = legalPages[slug];
      expect(doc.slug).toBe(slug);
      expect((doc.blocks?.length ?? 0) + (doc.sections?.length ?? 0)).toBeGreaterThan(0);
    }
    expect(legalPages.privacy.sections?.some((s) => s.id === "changes")).toBe(true);
    expect(legalPages.terms.sections?.some((s) => s.id === "changes")).toBe(true);
  });

  it("leaves Google Analytics off the cookie page while the GA4 ID is empty (docs/13, 2026-10-22)", () => {
    const text = strings(legalPages.cookies).join("\n");
    if (site.ga4Id) expect(text).toMatch(/_ga/);
    else {
      expect(text).not.toMatch(/`_ga/);
      expect(text).not.toMatch(/Google Analytics loads/);
    }
  });

  it("keeps the website liability cap a formatted amount, never typed", () => {
    const liability = legalPages.terms.sections?.find((s) => s.id === "liability");
    expect(strings(liability).join(" ")).toMatch(/limited to ₹10,000\./);
  });

  it("reduces copy to plain words for JSON-LD", () => {
    expect(plainCopy("See our [Cookie policy](/cookies) and **bold** text.")).toBe(
      "See our Cookie policy and bold text.",
    );
    expect(plainCopy("From {{price:S14}} per connector.")).toMatch(/^From ₹[\d,]+ \+ GST per connector\.$/);
  });
});
