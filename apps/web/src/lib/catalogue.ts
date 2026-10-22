// The catalogue snapshot the site is built from (ADM-CAT-05, WEB-G-07, WEB-SVC-05). Build time only (node:fs): nothing
// here reaches the browser or the web Worker.
//
// Source, in order:
//   1. apps/web/catalogue-snapshot.json, when present: the public snapshot published from the admin (M4.1). It is
//      git-ignored. It must pass the @techaust/core schema; an invalid file FAILS THE BUILD, never falls back (a
//      silent fallback would ship stale prices).
//   2. else the same shape built from the owner-approved seed (packages/db, Phase 2).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CatalogueSnapshot, catalogueSnapshot, SETTINGS_DEFAULTS } from "@techaust/core";
import { CATALOGUE } from "@techaust/db/catalogue";

/**
 * The published snapshot, apps/web/catalogue-snapshot.json, resolved from this module (never from the working
 * directory): walk up from here to the folder holding astro.config.mjs. (Astro may bundle this module into a chunk
 * below dist/, so a fixed "../.." is not safe.)
 */
function appRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "astro.config.mjs"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("catalogue: cannot find apps/web (astro.config.mjs) above " + import.meta.url);
}
export const SNAPSHOT_FILE = join(appRoot(), "catalogue-snapshot.json");

/** The snapshot as the seed builds it: public fields only (no SAC code, no internal notes). */
export function snapshotFromSeed(): CatalogueSnapshot {
  const terms = SETTINGS_DEFAULTS.payment_terms;
  return catalogueSnapshot.parse({
    version: 1,
    items: CATALOGUE.map((c) => ({
      code: c.code,
      name: c.name,
      slug: c.slug,
      category: c.category,
      showOnSite: c.showOnSite,
      unit: c.unit,
      priceInrMinor: c.priceInr,
      priceUsdMinor: c.priceUsd,
      schedule: c.schedule.map((s) => ({ label: s.label, pctBp: s.pctBp, trigger: s.trigger })),
      defaultLines: (c.defaultLines ?? []).map((l) => ({
        description: l.description,
        unit: l.unit,
        qtyMilli: l.qtyMilli,
        rateInrMinor: l.rateInrMinor,
        rateUsdMinor: l.rateUsdMinor,
      })),
    })),
    paymentTerms: {
      dueDays: terms.dueDays,
      proposalValidityDays: terms.proposalValidityDays,
      buildSchedule: terms.buildSchedule.map((s) => ({ label: s.label, pctBp: s.pctBp })),
      smallJobThreshold: terms.smallJobThreshold,
    },
  });
}

/**
 * The snapshot at `file` when it exists (validated: throws on malformed JSON or a schema failure), else the seed's.
 * Error messages name the file and the failing paths, never the values.
 */
export function loadSnapshot(file: string): CatalogueSnapshot {
  if (!existsSync(file)) return snapshotFromSeed();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file} is not valid JSON: fix or delete it (the build will not fall back silently)`);
  }
  const parsed = catalogueSnapshot.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`${file} is not a valid catalogue snapshot: ${where}`);
  }
  return parsed.data;
}

let cached: CatalogueSnapshot | undefined;

/** Which source a build uses, in words: the snapshot file, or the seed when there is none at `file`. */
export function snapshotSource(file: string): string {
  return existsSync(file) ? `snapshot file ${file}` : `seed (no snapshot file at ${file})`;
}

/** The snapshot for this build (read once; one log line names the source). CATALOGUE_SNAPSHOT overrides the path (tests). */
export function snapshot(): CatalogueSnapshot {
  if (!cached) {
    const file = process.env.CATALOGUE_SNAPSHOT ?? SNAPSHOT_FILE;
    cached = loadSnapshot(file);
    console.log(`catalogue: ${snapshotSource(file)}`);
  }
  return cached;
}
