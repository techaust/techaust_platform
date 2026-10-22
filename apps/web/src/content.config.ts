// Content collections (built-in glob loader, no extra packages): the blog (WEB-BLOG) and case studies (WEB-WORK).
// Schemas and helpers live in lib/blog.ts and lib/work.ts so tests can reach them without Astro.
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import "./content/legal"; // validates the legal page version data on every build (lib/legal.ts)
import { blogSchema } from "./lib/blog";
import { snapshot } from "./lib/catalogue";
import { caseStudySchema } from "./lib/work";

const blog = defineCollection({
  loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/blog" }),
  schema: blogSchema(snapshot().items.map((i) => i.code)),
});

const caseStudies = defineCollection({
  loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/work" }),
  schema: caseStudySchema,
});

export const collections = { blog, caseStudies };
