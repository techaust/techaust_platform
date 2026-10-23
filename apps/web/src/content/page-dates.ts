// The date each page's content last changed (YYYY-MM-DD, IST calendar day), for the sitemap's <lastmod> (WEB-G-11).
// A date moves only when the page's content does, never at build time, so two builds of the same commit give the same
// sitemap. Blog posts take `updated ?? date` from their front-matter and the legal pages take `effective` from
// content/legal.ts; every other page is listed here by path. A page that is built, indexable and not in this map
// (or in the blog and legal data) fails the build (lib/site-pages.ts), so a new page cannot ship without a date.
// Case studies (/work/<slug>) are listed here when the first one is published.

export const pageDates: Readonly<Record<string, string>> = {
  "/": "2026-10-23",
  "/services": "2026-10-23",
  "/services/discovery-sprint": "2026-10-23",
  "/services/app-rescue": "2026-10-23",
  "/services/fractional-cto": "2026-10-23",
  "/services/custom-web-apps": "2026-10-23",
  "/services/mvp-saas-development": "2026-10-23",
  "/services/mobile-apps": "2026-10-23",
  "/services/ai-document-automation": "2026-10-23",
  "/services/workflow-automation": "2026-10-23",
  "/services/whatsapp-automation": "2026-10-23",
  "/services/ai-knowledge-assistants": "2026-10-23",
  "/services/ai-features-for-software": "2026-10-23",
  "/services/business-systems-integration": "2026-10-23",
  "/services/care-plans": "2026-10-23",
  "/services/dev-subscription": "2026-10-23",
  "/industries": "2026-10-23",
  "/industries/finance-accounting-legal": "2026-10-23",
  "/industries/retail-ecommerce-logistics": "2026-10-23",
  "/industries/saas-startups": "2026-10-23",
  "/pricing": "2026-10-23",
  "/how-we-work": "2026-10-23",
  "/how-we-build-ai": "2026-10-23",
  "/about": "2026-10-23",
  "/work": "2026-10-23",
  "/blog": "2026-10-23",
  "/contact": "2026-10-23",
  "/get-a-quote": "2026-10-23",
};
