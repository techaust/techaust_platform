// Structured data (M2.5; WEB-G-09, WEB-SVC-04, WEB-BLOG): the pure builders, the check that compares a page's JSON-LD with
// what the page shows (each rule must FAIL on bad input), and every built page when apps/web/dist exists. Runs in Node.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as seo from "../../../scripts/web-seo-checks.mjs";
// @ts-expect-error plain .mjs without types
import { walk } from "../../../scripts/web-shared.mjs";
import { addLd, takeLd } from "../src/lib/ld-collector";
import { cleanPath } from "../src/lib/page-path";
import {
  absoluteUrl,
  articleNode,
  breadcrumbNode,
  buildGraph,
  decimalAmount,
  faqNode,
  organizationNode,
  postalAddressNode,
  serviceNode,
  websiteNode,
} from "../src/lib/structured-data";

/** A JSON-shaped value the tests read freely (JSON.parse's own return type). */
type Json = ReturnType<typeof JSON.parse>;
type J = Record<string, Json>;

const SITE = {
  name: "TecHaust Technologies",
  email: "contact@techaust.com",
  locality: "Balurghat, West Bengal, India",
  postalAddress: "Pirozpur, Balurghat, Dakshin Dinajpur, West Bengal 733133",
  linkedinCompany: "",
};

describe("organization and website nodes", () => {
  it("is an Organization and ProfessionalService with a stable id, the logo, the e-mail and the postal address", () => {
    const o = organizationNode(SITE) as J;
    expect(o["@type"]).toEqual(["Organization", "ProfessionalService"]);
    expect(o["@id"]).toBe("https://techaust.com/#org");
    expect(o.logo.url).toBe("https://techaust.com/brand/logo-email-color@2x.png");
    expect(o.email).toBe("contact@techaust.com");
    expect(o.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "Pirozpur, Balurghat, Dakshin Dinajpur",
      addressLocality: "Balurghat",
      addressRegion: "West Bengal",
      postalCode: "733133",
      addressCountry: "IN",
    });
  });

  it("has no sameAs until the company LinkedIn is set, then exactly that link", () => {
    expect(organizationNode(SITE)).not.toHaveProperty("sameAs");
    const o = organizationNode({ ...SITE, linkedinCompany: "https://www.linkedin.com/company/x" }) as J;
    expect(o.sameAs).toEqual(["https://www.linkedin.com/company/x"]);
  });

  it("leaves the address out while it is empty (never invented)", () => {
    expect(organizationNode({ ...SITE, postalAddress: "" })).not.toHaveProperty("address");
    expect(postalAddressNode({ ...SITE, postalAddress: "  " })).toBeNull();
  });

  it("a postal address without a PIN keeps the whole text as the street line", () => {
    expect(postalAddressNode({ ...SITE, postalAddress: "1 Main Road, Balurghat" })).toMatchObject({
      streetAddress: "1 Main Road, Balurghat",
      addressCountry: "IN",
    });
  });

  it("the WebSite points at the Organization as its publisher", () => {
    expect(websiteNode(SITE)).toMatchObject({
      "@type": "WebSite",
      publisher: { "@id": "https://techaust.com/#org" },
    });
  });
});

describe("page nodes", () => {
  it("formats a minor-unit amount with integer maths only", () => {
    expect(decimalAmount({ amount: 20000000, currency: "INR" })).toBe("200000.00");
    expect(decimalAmount({ amount: 999900, currency: "INR" })).toBe("9999.00");
    expect(decimalAmount({ amount: 5, currency: "INR" })).toBe("0.05");
  });

  it("a Service has the provider, the area served and an INR offer only when the page shows a price", () => {
    const base = { name: "App Rescue", description: "d", path: "/services/app-rescue", international: false };
    const withPrice = serviceNode({
      ...base,
      fromInr: { amount: 5000000, currency: "INR" },
      international: true,
    }) as J;
    expect(withPrice.provider).toEqual({ "@id": "https://techaust.com/#org" });
    expect(withPrice.offers.priceSpecification.minPrice).toBe("50000.00");
    expect(withPrice.areaServed).toHaveLength(2);
    const without = serviceNode(base) as J;
    expect(without).not.toHaveProperty("offers");
    expect(without.areaServed).toHaveLength(1);
  });

  it("BreadcrumbList uses the page's own URL for the last crumb", () => {
    const b = breadcrumbNode(
      [{ label: "Services", href: "/services" }, { label: "App Rescue" }],
      "/services/app-rescue",
    ) as J;
    expect(b.itemListElement.map((e: Json) => [e.position, e.name, e.item])).toEqual([
      [1, "Services", "https://techaust.com/services"],
      [2, "App Rescue", "https://techaust.com/services/app-rescue"],
    ]);
  });

  it("FAQPage and Article carry the text they are given", () => {
    const f = faqNode([{ q: "Q?", a: "A." }], "/pricing") as J;
    expect(f.mainEntity[0]).toEqual({
      "@type": "Question",
      name: "Q?",
      acceptedAnswer: { "@type": "Answer", text: "A." },
    });
    const a = articleNode({
      slug: "p",
      headline: "H",
      description: "D",
      datePublished: "2026-01-01",
      dateModified: "2026-01-02",
      authorName: "N",
    }) as J;
    expect(a.publisher).toEqual({ "@id": "https://techaust.com/#org" });
    expect(a.mainEntityOfPage).toBe("https://techaust.com/blog/p");
  });

  it("absoluteUrl and cleanPath give the public URL of a built page file", () => {
    expect(absoluteUrl("/")).toBe("https://techaust.com/");
    expect(absoluteUrl("/about")).toBe("https://techaust.com/about");
    expect(cleanPath("/services/app-rescue.html")).toBe("/services/app-rescue");
    expect(cleanPath("/index.html")).toBe("/");
    expect(cleanPath("/404.html")).toBe("/404");
  });

  it("the graph starts with the Organization and the WebSite and keeps the page's nodes in order", () => {
    const g = buildGraph([{ "@type": "BreadcrumbList" }, { "@type": "FAQPage" }])["@graph"];
    expect(g.map((n) => n["@type"])).toEqual([
      ["Organization", "ProfessionalService"],
      "WebSite",
      "BreadcrumbList",
      "FAQPage",
    ]);
  });

  it("the collector keeps one node per @id, per page", () => {
    const req = {};
    addLd(req, { "@id": "x", n: 1 });
    addLd(req, { "@id": "x", n: 2 });
    addLd(req, { "@type": "Free" });
    expect(takeLd(req)).toHaveLength(2);
    expect(takeLd({})).toEqual([]);
  });
});

// ── the check, on fixtures ─────────────────────────────────────────────────────────────────────────────────────

const faqHtml = (q: string, a: string) =>
  `<details class="faq__item"><summary class="faq__q"><span class="t-h4 faq__qtext">${q}</span></summary><p class="copy faq__a"><span class="copy__v">${a}</span></p></details>`;
const crumbsHtml = `<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/services">Services</a></li><li><span aria-current="page">App Rescue</span></li></ol></nav>`;
const page = (graph: unknown[], body = "") =>
  `<html><body><h1>App Rescue</h1>${body}<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script></body></html>`;
const base = () => buildGraph([])["@graph"];

describe("checkStructuredData (WEB-SVC-04, WEB-BLOG)", () => {
  const svc = () =>
    serviceNode({
      name: "App Rescue",
      description: "d",
      path: "/services/app-rescue",
      fromInr: { amount: 5000000, currency: "INR" },
      international: true,
    });
  const crumb = () =>
    breadcrumbNode(
      [{ label: "Services", href: "/services" }, { label: "App Rescue" }],
      "/services/app-rescue",
    );

  it("accepts a service page whose graph matches its breadcrumbs and FAQ", () => {
    const html = page(
      [...base(), svc(), crumb(), faqNode([{ q: "What?", a: "This." }], "/services/app-rescue")],
      crumbsHtml + faqHtml("What?", "This."),
    );
    expect(seo.checkStructuredData("services/app-rescue.html", html)).toEqual([]);
  });

  it("fails when the FAQ answer in the data differs from the visible one", () => {
    const html = page(
      [...base(), svc(), crumb(), faqNode([{ q: "What?", a: "Something else." }], "/services/app-rescue")],
      crumbsHtml + faqHtml("What?", "This."),
    );
    expect(seo.checkStructuredData("services/app-rescue.html", html).join()).toContain(
      "FAQPage answer 1 differs",
    );
  });

  it("fails on an FAQ in the page with no FAQPage, and an FAQPage with no FAQ", () => {
    expect(
      seo
        .checkStructuredData(
          "services/app-rescue.html",
          page([...base(), svc(), crumb()], crumbsHtml + faqHtml("Q?", "A.")),
        )
        .join(),
    ).toContain("no FAQPage");
    expect(
      seo
        .checkStructuredData(
          "services/app-rescue.html",
          page([...base(), svc(), crumb(), faqNode([{ q: "Q?", a: "A." }], "/x")], crumbsHtml),
        )
        .join(),
    ).toContain("without a visible FAQ");
  });

  it("fails when the BreadcrumbList differs from the visible breadcrumbs", () => {
    const wrong = breadcrumbNode(
      [{ label: "Services", href: "/services" }, { label: "Other" }],
      "/services/app-rescue",
    );
    expect(
      seo.checkStructuredData("services/app-rescue.html", page([...base(), svc(), wrong], crumbsHtml)).join(),
    ).toContain("BreadcrumbList differs");
    expect(
      seo.checkStructuredData("services/app-rescue.html", page([...base(), svc()], crumbsHtml)).join(),
    ).toContain("no BreadcrumbList");
  });

  it("fails on two graphs, invalid JSON, an empty string, a repeated id and a type that states more than the page shows", () => {
    const one = page(base());
    expect(
      seo.checkStructuredData("about.html", one + one.match(/<script[\s\S]*<\/script>/)?.[0])[0],
    ).toContain("2 JSON-LD blocks");
    expect(
      seo.checkStructuredData("about.html", '<script type="application/ld+json">{nope</script>')[0],
    ).toContain("not valid JSON");
    expect(
      seo
        .checkStructuredData(
          "about.html",
          page([...base(), { "@type": "WebSite", "@id": "https://techaust.com/#website", name: "" }]).replace(
            "</body>",
            "</body>",
          ),
        )
        .join(),
    ).toMatch(/is empty|repeated @id/);
    expect(
      seo.checkStructuredData("about.html", page([...base(), { "@type": "Review", name: "x" }])).join(),
    ).toContain('type "Review"');
    expect(
      seo.checkStructuredData("about.html", page([...base(), { "@type": "AggregateRating" }])).join(),
    ).toContain("not allowed");
  });

  it("fails when the Organization lacks a required field, and for a Service on the wrong page or without an INR offer", () => {
    const org = { ...(organizationNode(SITE) as object), email: undefined } as Record<string, unknown>;
    delete org.email;
    expect(seo.checkStructuredData("about.html", page([org, websiteNode(SITE)])).join()).toContain(
      "Organization has no email",
    );
    expect(seo.checkStructuredData("about.html", page([...base(), svc()])).join()).toContain(
      "not a service page",
    );
    const bad = {
      ...(svc() as object),
      offers: { priceCurrency: "USD", priceSpecification: { minPrice: "12" } },
    };
    expect(
      seo.checkStructuredData("services/app-rescue.html", page([...base(), bad, crumb()], crumbsHtml)).join(),
    ).toContain("INR price");
  });

  it("requires exactly one Article on a blog post, with the h1 as its headline", () => {
    const art = articleNode({
      slug: "p",
      headline: "App Rescue",
      description: "D",
      datePublished: "2026-01-01",
      dateModified: "2026-01-01",
      authorName: "N",
    });
    expect(seo.checkStructuredData("blog/p.html", page([...base(), art])).join()).toBe("");
    expect(seo.checkStructuredData("blog/p.html", page(base())).join()).toContain(
      "needs exactly one Article",
    );
    expect(
      seo
        .checkStructuredData("blog/p.html", page([...base(), { ...(art as object), headline: "Other" }]))
        .join(),
    ).toContain("differs from the h1");
  });

  it("compares a priced answer with its INR view", () => {
    const priced = `<p class="copy copy--priced faq__a"><span class="copy__v copy__v--both">from <span class="copy__price"><span>₹50,000</span> + GST · <span>$2,000</span></span></span><span class="copy__v copy__v--inr">from <span class="copy__price"><span>₹50,000</span> + GST</span></span><span class="copy__v copy__v--usd">from <span>$2,000</span></span></p>`;
    const html = `<details class="faq__item"><summary><span class="faq__qtext">Cost?</span></summary>${priced}</details>`;
    expect(seo.visibleFaq(html)).toEqual([{ q: "Cost?", a: "from ₹50,000 + GST" }]);
  });
});

// ── every built page ───────────────────────────────────────────────────────────────────────────────────────────

const dist = fileURLToPath(new URL("../dist", import.meta.url));

describe("the built site (needs apps/web/dist)", () => {
  const files: string[] = existsSync(dist) ? (walk(dist) as string[]).filter((f) => f.endsWith(".html")) : [];

  it.skipIf(files.length === 0)("every page has one valid graph that matches what the page shows", () => {
    const problems: string[] = [];
    for (const f of files) {
      const name = f.slice(dist.length + 1).replaceAll("\\", "/");
      problems.push(...seo.checkStructuredData(name, readFileSync(f, "utf8")));
    }
    expect(problems).toEqual([]);
  });

  it.skipIf(files.length === 0)(
    "a service page prints its Service node and the catalogue price, not a typed one",
    () => {
      const html = readFileSync(`${dist}/services/app-rescue.html`, "utf8");
      expect(html).toContain('"@type":"Service"');
      expect(html).toContain('"minPrice":"50000.00"');
    },
  );
});
