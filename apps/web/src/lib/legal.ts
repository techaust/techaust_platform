// Legal page versioning (WEB-LEGAL, roadmap M2.3 "legal page versioning"): every legal page and /security carries a
// version, an effective date and a list of changes. The pages show "Version 0.1 · Effective <date>" and a "Changes"
// section; they replace 07-A's "Version x · Effective" footers. The data is content/legal.ts; this file is the schema and the
// helpers. A page missing from the data, or with a malformed entry, fails the build (the module throws on import).
import { z } from "astro/zod";

/** The slugs of the seven pages that must carry version data (07-A §1–§6 and §8, and /security). */
export const LEGAL_SLUGS = [
  "privacy",
  "terms",
  "refund-policy",
  "delivery-policy",
  "cookies",
  "accessibility",
  "security",
] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD");
const version = z.string().regex(/^\d+\.\d+$/, 'a version like "0.1"');

export const legalPageSchema = z.strictObject({
  version,
  effective: isoDate,
  changes: z.array(z.strictObject({ version, date: isoDate, note: z.string().min(1) })).min(1),
});
export type LegalPage = z.infer<typeof legalPageSchema>;

/** Checks every legal slug has a valid entry; returns the parsed data. Throws listing what is wrong. */
export function validateLegal(data: Record<string, unknown>): Record<LegalSlug, LegalPage> {
  const problems: string[] = [];
  const out: Partial<Record<LegalSlug, LegalPage>> = {};
  for (const slug of LEGAL_SLUGS) {
    const parsed = legalPageSchema.safeParse(data[slug]);
    if (!parsed.success) {
      const where = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(entry)"}: ${i.message}`)
        .join("; ");
      problems.push(`${slug}: ${data[slug] === undefined ? "no version data" : where}`);
      continue;
    }
    const p = parsed.data;
    if (!p.changes.some((c) => c.version === p.version))
      problems.push(`${slug}: no "changes" entry for the current version ${p.version}`);
    out[slug] = p;
  }
  for (const slug of Object.keys(data))
    if (!(LEGAL_SLUGS as readonly string[]).includes(slug)) problems.push(`${slug}: not a legal page slug`);
  if (problems.length) throw new Error(`legal page data is invalid:\n  - ${problems.join("\n  - ")}`);
  return out as Record<LegalSlug, LegalPage>;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-10-22" → "22 October 2026" (no locale data needed in the build). */
export function formatLegalDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !month) throw new Error(`formatLegalDate: "${iso}" is not YYYY-MM-DD`);
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** The line at the top of a page: "Version 0.1 · Effective 22 October 2026". The dist check looks for it. */
export const versionLine = (p: LegalPage): string =>
  `Version ${p.version} · Effective ${formatLegalDate(p.effective)}`;
