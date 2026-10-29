// No new bare "VERIFY WITH CA/LEGAL" tag (FX-3, A4 lead's addition; owner rule 8 of 2026-10-28): a tax or legal note in code says
// `Researched <date>, <source> (08-C <ID>)` when the register settles it, or `OPEN (08-C <ID>): <question>` when it does not. This test scans
// apps/, packages/, scripts/, tools/ and .github/ (code, styles, JSON, Markdown, SQL, YAML and shell or PowerShell scripts; applied migrations are
// never edited, so `packages/db/migrations/` is left out; FX-3 fix round, item 9) and fails on a bare tag in a file that is not below, or on more
// tags than the file is allowed. The list is the tags whose question has no 08-C row yet (FX-3 builder report): each is retagged
// once the register has a row, and a stale count fails too, so the list only shrinks.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");
const SCANNED = ["apps", "packages", "scripts", "tools", ".github"];
/** Installed packages, build output and generated files, skipped wherever they sit; below the tops, every folder whose name starts with "." too. */
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", "generated", "fonts", "brand"]);
/** The applied migrations (never edited): skipped by their path only, so a `.sql` file anywhere else is scanned. */
const SKIP_PATHS = new Set(["packages/db/migrations"]);
const EXTENSIONS = /\.(ts|tsx|mts|mjs|cjs|js|astro|css|json|md|sql|ya?ml|sh|ps1)$/;
/** "VERIFY WITH CA", "VERIFY WITH CA/LEGAL", "VERIFY WITH LEGAL", also when a comment breaks the line between the words. */
const BARE = /VERIFY\s+WITH(?:\s|\/\/|\*)+(?:CA|LEGAL)\b/g;
const SELF = "packages/core/test/verify-tags.test.ts";

/** File → how many bare tags it may still hold, and why (no 08-C row covers the question yet). */
const NO_ROW_YET: Record<string, { count: number; why: string }> = {
  "apps/admin/worker/clients.ts": {
    count: 5,
    why: "what a data-subject export holds (offer links, invoice links, decisions, file contents) and the erase of never-sent drafts (O-Q4)",
  },
  "apps/admin/worker/documents-convert.test.ts": {
    count: 1,
    why: "a sent offer as evidence against erasing the person it names",
  },
  "apps/admin/src/lib/clients.ts": { count: 2, why: "data-subject items (export, erase, anonymise)" },
  "apps/admin/src/lib/projects.ts": {
    count: 1,
    why: "notes and files deleted with an individual's last contact",
  },
  "apps/admin/src/routes/settings/payment-terms.tsx": {
    count: 1,
    why: "due days, validity, the small-job threshold and the part-payment floor (the liability cap is RB-23)",
  },
  "apps/admin/src/routes/settings/terms.tsx": {
    count: 1,
    why: "the document terms text (the export declaration is RA-18)",
  },
  "apps/jobs/src/expire.ts": { count: 1, why: "what an expired offer means" },
  "apps/jobs/test/expire.test.ts": { count: 1, why: "what an expired offer means" },
  "packages/core/src/documents.ts": {
    count: 2,
    why: "a sent proposal as evidence of an offer, and the validity rule (run file items 1 to 12)",
  },
  "packages/core/test/documents.test.ts": { count: 1, why: "the validity rule (item 5)" },
  "packages/core/src/gstin.ts": { count: 1, why: "the GST state-code list (e-way bill master)" },
  "packages/core/test/gstin.test.ts": { count: 1, why: "legacy state codes" },
  "packages/core/src/schemas/settings.ts": {
    count: 3,
    why: "the GSTIN check (twice) and the INR 10,000 part-payment floor",
  },
  "packages/core/src/pdf-jobs.ts": { count: 1, why: "the place-of-supply wording on a proposal" },
  "packages/db/src/contact-access.ts": { count: 1, why: "when a contact's portal access ends" },
  "packages/db/src/schema/crm.ts": { count: 1, why: "the consent receipt kept with a lead (FRM-05)" },
  "packages/db/src/seed/terms.ts": {
    count: 1,
    why: "the proposal terms text and Ownership (GST at 18 % is RA-16)",
  },
};

const relOf = (path: string): string => relative(REPO, path).replaceAll("\\", "/");

/** Whether the walk goes into a folder (`rel` its path from the repo root, `name` its own name). */
const entersDir = (rel: string, name: string): boolean =>
  !SKIP_DIRS.has(name) && !name.startsWith(".") && !SKIP_PATHS.has(rel);

/** The scanned files below `dir`, relative to the repo root. */
function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entersDir(relOf(path), entry.name)) yield* files(path);
    } else if (EXTENSIONS.test(entry.name)) yield relOf(path);
  }
}

/** Every scanned file, relative to the repo root with forward slashes. */
const scanned = (): string[] => SCANNED.flatMap((top) => [...files(join(REPO, top))]);

const found = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const rel of scanned()) {
    if (rel === SELF) continue;
    const n = readFileSync(join(REPO, rel), "utf8").match(BARE)?.length ?? 0;
    if (n > 0) out[rel] = n;
  }
  return out;
};

describe("bare VERIFY tags (FX-3)", () => {
  it("the pattern sees a tag on one line or broken by a comment, and nothing else", () => {
    const n = (s: string) => s.match(BARE)?.length ?? 0;
    expect(n("// VERIFY WITH CA/LEGAL: x")).toBe(1);
    expect(n("(VERIFY WITH CA)")).toBe(1);
    expect(n("// owner O-Q4; VERIFY WITH\n        //     CA/LEGAL). A sent")).toBe(1);
    expect(n(" * (VERIFY WITH\n * CA/LEGAL): the client")).toBe(1);
    expect(n('expect(part).not.toContain("VERIFY WITH");')).toBe(0);
    expect(n("SITEVERIFY_URL")).toBe(0);
    expect(n("// Researched 2026-10-28, s.12 IGST (08-C RA-12)")).toBe(0);
  });

  it("FX-3 fix round (item 9): the scan reaches tools/, .github/, SQL, YAML and shell files, and skips only the applied migrations", () => {
    const all = scanned();
    for (const want of ["tools/heavy.sh", ".github/workflows/ci.yml", "packages/db/src/triggers.ts"])
      expect(all, want).toContain(want);
    expect(all.some((f) => f.startsWith("packages/db/migrations/"))).toBe(false);
    // the folder rule: the migrations are skipped at their own path only; installed packages and dot folders below the tops never entered
    expect(entersDir("packages/db/migrations", "migrations")).toBe(false);
    expect(entersDir("packages/db/src/migrations", "migrations")).toBe(true);
    expect(entersDir("apps/web/node_modules", "node_modules")).toBe(false);
    expect(entersDir("apps/web/.wrangler", ".wrangler")).toBe(false);
    for (const name of ["x.sql", "x.yml", "x.yaml", "x.sh", "x.ps1", "x.ts", "x.md"])
      expect(EXTENSIONS.test(name), name).toBe(true);
    for (const name of ["x.png", "x.woff2", "x.pdf", "x.lock"])
      expect(EXTENSIONS.test(name), name).toBe(false);
  });

  it("no file holds a bare tag beyond the list of questions 08-C has no row for yet, and the list is not stale", () => {
    const got = found();
    const allowed = Object.fromEntries(Object.entries(NO_ROW_YET).map(([f, v]) => [f, v.count]));
    expect(got).toEqual(allowed);
  });
});
