// The indexable pages of the public site, as data (WEB-G-11): one list for the sitemap and llms.txt. It is built from the
// same content the pages are (live services, industries, published posts and case studies, the legal pages), so a
// flagged-off service (WEB-G-17), a draft or the 404, /thanks and /preview/* can never appear. Every page carries a
// dated `lastmod` (content/page-dates.ts, the post's `updated ?? date`, the legal page's `effective`); a page without
// one throws, which fails the build.

import { about, howWeBuildAi, howWeWork } from "../content/company";
import { contactPage, quotePage } from "../content/forms";
import { home } from "../content/home";
import { industries, industriesHub } from "../content/industries";
import { legal } from "../content/legal";
import { legalPages } from "../content/legal-pages";
import { pageDates } from "../content/page-dates";
import { pricing } from "../content/pricing";
import { liveServices } from "../content/services";
import { servicesHub } from "../content/services-hub";
import { blogPage, workPage } from "../content/work-page";
import { istDay } from "./blog";
import { plainText } from "./copy";
import { LEGAL_SLUGS } from "./legal";

export type Section = "Services" | "Industries" | "Company" | "Blog" | "Legal";

export type SitePage = {
  /** Path on the site: "/" or "/services/app-rescue" (no trailing slash). */
  path: string;
  section: Section | "Home";
  /** Short name for llms.txt. */
  name: string;
  /** The page's own meta description, as plain text. */
  description: string;
  /** YYYY-MM-DD */
  lastmod: string;
};

export type PostLike = {
  id: string;
  data: { title: string; description: string; date: Date; updated?: Date };
};
export type CaseLike = { id: string; data: { title: string; outcome: string } };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function dateOf(path: string, dates: Readonly<Record<string, string>>): string {
  const d = dates[path];
  if (d === undefined) throw new Error(`sitemap: no lastmod for ${path} (add it to content/page-dates.ts)`);
  if (!ISO_DAY.test(d)) throw new Error(`sitemap: lastmod "${d}" of ${path} is not YYYY-MM-DD`);
  return d;
}

/**
 * Every indexable page, in a fixed order (home, services, industries, company, blog, legal). `posts` are the published
 * posts and `cases` the published case studies (drafts already removed by the caller).
 */
export function sitePages(
  posts: readonly PostLike[] = [],
  cases: readonly CaseLike[] = [],
  dates: Readonly<Record<string, string>> = pageDates,
): SitePage[] {
  const at = (path: string) => dateOf(path, dates);
  const out: SitePage[] = [
    {
      path: "/",
      section: "Home",
      name: "Home",
      description: plainText(home.meta.description),
      lastmod: at("/"),
    },
    {
      path: "/services",
      section: "Services",
      name: "Services",
      description: plainText(servicesHub.meta.description),
      lastmod: at("/services"),
    },
    ...liveServices().map((s) => ({
      path: `/services/${s.slug}`,
      section: "Services" as const,
      name: s.name,
      description: plainText(s.meta.description),
      lastmod: at(`/services/${s.slug}`),
    })),
    {
      path: "/industries",
      section: "Industries",
      name: "Industries",
      description: plainText(industriesHub.meta.description),
      lastmod: at("/industries"),
    },
    ...industries.map((x) => ({
      path: `/industries/${x.slug}`,
      section: "Industries" as const,
      name: x.name,
      description: plainText(x.meta.description),
      lastmod: at(`/industries/${x.slug}`),
    })),
    ...(
      [
        ["/pricing", "Pricing", pricing.meta.description],
        ["/how-we-work", "How we work", howWeWork.meta.description],
        ["/how-we-build-ai", "How we build AI", howWeBuildAi.meta.description],
        ["/about", "About", about.meta.description],
        ["/work", "Work", workPage.meta.description],
        ["/contact", "Contact", contactPage.meta.description],
        ["/get-a-quote", "Get a quote", quotePage.meta.description],
      ] as const
    ).map(([path, name, description]) => ({
      path,
      section: "Company" as const,
      name,
      description: plainText(description),
      lastmod: at(path),
    })),
    ...cases.map((c) => ({
      path: `/work/${c.id}`,
      section: "Company" as const,
      name: c.data.title,
      description: c.data.outcome,
      lastmod: at(`/work/${c.id}`),
    })),
    {
      path: "/blog",
      section: "Blog",
      name: "Blog",
      description: plainText(blogPage.meta.description),
      lastmod: at("/blog"),
    },
    ...posts.map((p) => ({
      path: `/blog/${p.id}`,
      section: "Blog" as const,
      name: p.data.title,
      description: p.data.description,
      lastmod: istDay(p.data.updated ?? p.data.date),
    })),
    ...LEGAL_SLUGS.map((slug) => ({
      path: `/${slug}`,
      section: "Legal" as const,
      name: legalPages[slug].title,
      description: plainText(legalPages[slug].meta.description),
      lastmod: legal[slug].effective,
    })),
  ];
  for (const p of out) if (!ISO_DAY.test(p.lastmod)) throw new Error(`sitemap: bad lastmod for ${p.path}`);
  return out;
}
