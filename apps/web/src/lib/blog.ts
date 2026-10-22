// The blog collection (WEB-BLOG): front-matter schema and pure helpers. `src/content.config.ts` registers the collection
// with this schema; the helpers take plain entries so Vitest can test them without Astro. Drafts (the default) are
// excluded from every route and from RSS: pages and the feed read only `published()`.
import { istDate, toIsoDate } from "@techaust/core";
import { z } from "astro/zod";

/**
 * The schema; `codes` are the codes `relatedServices` may name: the services that have a live page on the site (a
 * post that names one with no page, such as S8 or S3 while flagged off, would break the build; the caller passes
 * `linkableServiceCodes()`).
 */
export function blogSchema(codes: readonly string[]) {
  return z.strictObject({
    title: z.string().min(1),
    description: z.string().min(1),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string().min(1)).default([]),
    draft: z.boolean().default(true),
    relatedServices: z
      .array(
        z.string().refine((c) => codes.includes(c), {
          message: `not a service with a live page (use one of: ${codes.join(", ")})`,
        }),
      )
      .default([]),
    faq: z.array(z.strictObject({ q: z.string().min(1), a: z.string().min(1) })).optional(),
  });
}
export type BlogData = z.infer<ReturnType<typeof blogSchema>>;

/** Non-draft posts, newest first (ties by id, so the order is stable). */
export function published<T extends { id: string; data: { draft: boolean; date: Date } }>(
  posts: readonly T[],
): T[] {
  return posts
    .filter((p) => !p.data.draft)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime() || a.id.localeCompare(b.id));
}

/** The text without Markdown code fences, for counting words. */
const prose = (md: string): string => md.replace(/```[\s\S]*?```/g, " ");

/** Minutes to read: words ÷ 200, rounded up, at least 1. */
export function readingTime(markdown: string): number {
  const words = prose(markdown).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

/** A table-of-contents entry (the post page reads Astro's own heading list, which has these fields). */
export type TocItem = { depth: number; text: string; slug: string };

/** A post date as the IST calendar day, "YYYY-MM-DD" (for visible dates and JSON-LD; never the UTC day). */
export const istDay = (d: Date): string => toIsoDate(istDate(d.getTime()));
