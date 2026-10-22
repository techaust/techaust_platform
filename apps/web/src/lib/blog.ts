// The blog collection (WEB-BLOG): front-matter schema and pure helpers. `src/content.config.ts` registers the collection
// with this schema; the helpers take plain entries so Vitest can test them without Astro. Drafts (the default) are
// excluded from every route and from RSS: pages and the feed read only `published()`.
import { z } from "astro/zod";

/** The schema; `codes` are the catalogue codes `relatedServices` may name. */
export function blogSchema(codes: readonly string[]) {
  return z.strictObject({
    title: z.string().min(1),
    description: z.string().min(1),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    tags: z.array(z.string().min(1)).default([]),
    draft: z.boolean().default(true),
    relatedServices: z
      .array(z.string().refine((c) => codes.includes(c), { message: "not a catalogue code (S1, S5 ...)" }))
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

/** The text without Markdown code fences, for counting words and finding headings. */
const prose = (md: string): string => md.replace(/```[\s\S]*?```/g, " ");

/** Minutes to read: words ÷ 200, rounded up, at least 1. */
export function readingTime(markdown: string): number {
  const words = prose(markdown).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

export type TocItem = { depth: 2 | 3; text: string; slug: string };

/** GitHub-style slug of a heading, as Astro's Markdown renderer writes ids. */
export const headingSlug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");

/** h2 and h3 headings of a Markdown body for a table of contents (code fences skipped). */
export function headings(markdown: string): TocItem[] {
  const out: TocItem[] = [];
  for (const line of prose(markdown).split(/\r?\n/)) {
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = (m[2] as string).replace(/[*_`]/g, "");
    out.push({ depth: (m[1] as string).length as 2 | 3, text, slug: headingSlug(text) });
  }
  return out;
}
