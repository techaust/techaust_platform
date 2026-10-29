// No new bare "VERIFY WITH CA/LEGAL" tag (FX-3, A4 lead's addition; owner rule 8 of 2026-10-28): a tax or legal note in code says
// `Researched <date>, <source> (08-C <ID>)` when the register settles it, or `OPEN (08-C <ID>): <question>` when it does not. This test scans
// apps/, packages/, scripts/, tools/ and .github/ (code, styles, JSON and JSONC, Markdown, SQL, YAML and shell or PowerShell scripts; applied
// migrations are never edited, so `packages/db/migrations/` is left out; FX-3 fix round, item 9; the wrangler `.jsonc` configs, whose comments
// can carry a note, fix round 2, item G; FX-5: HTML, Python and `.example` files too, such as `index.html`, `measure-cmyk.py` and
// `.dev.vars.example`; test snapshots stay out, being generated) and fails on a bare tag in a file that is not below, or on more
// tags than the file is allowed. The list is the tags whose question has no 08-C row yet (FX-3 builder report): each is retagged
// once the register has a row, and a stale count fails too, so the list only shrinks.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");
const SCANNED = ["apps", "packages", "scripts", "tools", ".github"];
/** Installed packages, build output, generated files and test snapshots, skipped wherever they sit; below the tops, every folder whose name starts with "." too. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  "generated",
  "fonts",
  "brand",
  "__snapshots__",
]);
/** The applied migrations (never edited): skipped by their path only, so a `.sql` file anywhere else is scanned. */
const SKIP_PATHS = new Set(["packages/db/migrations"]);
const EXTENSIONS = /\.(ts|tsx|mts|mjs|cjs|js|astro|css|jsonc?|md|sql|ya?ml|sh|ps1|html|py|example)$/;
/** "VERIFY WITH CA", "VERIFY WITH CA/LEGAL", "VERIFY WITH LEGAL", also when a comment breaks the line between the words. */
const BARE = /VERIFY\s+WITH(?:\s|\/\/|\*)+(?:CA|LEGAL)\b/g;
const SELF = "packages/core/test/verify-tags.test.ts";

/**
 * File → how many bare tags it may still hold, and why (no 08-C row covers the question yet). Empty since FX-5 (2026-10-30): the last 25 tags
 * in 17 files were retagged once 08-C gained RA-34, RA-35 and RB-35 to RB-39 (and amended RB-28). It stays so a question found later can be
 * listed while its row is researched; the list only shrinks back to empty.
 */
const NO_ROW_YET: Record<string, { count: number; why: string }> = {};

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

  it("FX-3 fix round (item 9): the scan reaches tools/, .github/, SQL, YAML, shell and (fix round 2, item G) JSONC files, and skips only the applied migrations", () => {
    const all = scanned();
    for (const want of [
      "tools/heavy.sh",
      ".github/workflows/ci.yml",
      "packages/db/src/triggers.ts",
      // fix round 2 (item G): every wrangler config, comments included
      "apps/admin/wrangler.jsonc",
      "apps/admin/wrangler.api.jsonc",
      "apps/jobs/wrangler.jsonc",
      "apps/portal/wrangler.jsonc",
      "apps/web/wrangler.jsonc",
      "packages/db/wrangler.jsonc",
      // FX-5: HTML, Python and .example files
      "apps/admin/index.html",
      "apps/portal/index.html",
      "packages/ui/scripts/measure-cmyk.py",
      "apps/admin/.dev.vars.example",
      "apps/web/.dev.vars.example",
    ])
      expect(all, want).toContain(want);
    expect(all.some((f) => f.startsWith("packages/db/migrations/"))).toBe(false);
    // FX-5: test snapshots are generated, so they stay out
    expect(all.some((f) => f.includes("/__snapshots__/"))).toBe(false);
    expect(entersDir("packages/email/test/__snapshots__", "__snapshots__")).toBe(false);
    // the folder rule: the migrations are skipped at their own path only; installed packages and dot folders below the tops never entered
    expect(entersDir("packages/db/migrations", "migrations")).toBe(false);
    expect(entersDir("packages/db/src/migrations", "migrations")).toBe(true);
    expect(entersDir("apps/web/node_modules", "node_modules")).toBe(false);
    expect(entersDir("apps/web/.wrangler", ".wrangler")).toBe(false);
    for (const name of [
      "x.sql",
      "x.yml",
      "x.yaml",
      "x.sh",
      "x.ps1",
      "x.ts",
      "x.md",
      "x.json",
      "x.jsonc",
      "x.html",
      "x.py",
      ".dev.vars.example",
    ])
      expect(EXTENSIONS.test(name), name).toBe(true);
    for (const name of ["x.png", "x.woff2", "x.pdf", "x.lock"])
      expect(EXTENSIONS.test(name), name).toBe(false);
  });

  it("no file holds a bare tag beyond the list of questions 08-C has no row for yet, and the list is not stale", () => {
    const got = found();
    const allowed = Object.fromEntries(Object.entries(NO_ROW_YET).map(([f, v]) => [f, v.count]));
    expect(got).toEqual(allowed);
    // FX-5: every question now has its 08-C row, so no file may hold a bare tag
    expect(allowed).toEqual({});
  });
});
