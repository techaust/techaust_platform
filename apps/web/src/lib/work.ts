// The case-study collection (WEB-WORK): front-matter schema. There are no entries yet (the owner supplies the
// briefs). A case study that is not a draft must be `verified: true` (the client or the owner confirmed every claim):
// the build fails otherwise, so nothing unverified is ever published (honesty rule, CLAUDE.md hard rule 10).
import { z } from "astro/zod";

export const caseStudySchema = z
  .strictObject({
    title: z.string().min(1),
    industry: z.string().min(1),
    size: z.string().min(1),
    region: z.string().min(1),
    problem: z.string().min(1),
    outcome: z.string().min(1),
    stack: z.array(z.string().min(1)).default([]),
    verified: z.boolean().default(false),
    draft: z.boolean().default(true),
  })
  .refine((c) => c.draft || c.verified, {
    message: "a published case study (draft: false) must have verified: true (WEB-WORK)",
    path: ["verified"],
  });
export type CaseStudy = z.infer<typeof caseStudySchema>;

/** Published case studies only (drafts never reach a page). */
export const publishedCases = <T extends { data: { draft: boolean } }>(entries: readonly T[]): T[] =>
  entries.filter((e) => !e.data.draft);
