// Build time only (node:fs): writes src/generated/quotable-services.json, the list of services the quote form accepts (audit A2
// finding 3). It reads the SAME snapshot as the pages (lib/catalogue.ts: catalogue-snapshot.json when present, else the seed;
// CATALOGUE_SNAPSHOT or `snapshotPath` overrides the path) and applies the SAME rule (lib/visibility.ts with the S3 flag), so the
// form accepts exactly the services the pages treat as on the site (isServiceOnSite: the service pages, the quote picker,
// /pricing). Called by astro.config.mjs (every `astro build`, `astro dev`, `astro check`, so `deploy:staging` bundles the list of
// the snapshot it built) and by vitest.config.ts (the seed, for the tests).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { flags } from "../config/site.ts";
import { appRoot, loadSnapshot, snapshotFile } from "./catalogue.ts";
import { type QuotableFile, quotableCodes } from "./visibility.ts";

/** Where the Worker's list lives (src/generated/quotable-services.json under apps/web). */
export const quotableFile = (root: string = appRoot()): string =>
  join(root, "src", "generated", "quotable-services.json");

/** The list for a snapshot path (the seed when the file does not exist; an invalid file throws, as in the pages' build). */
export function quotableFor(snapshotPath: string, s3Flag: boolean = flags.S3_DPDP_PAGE): QuotableFile {
  return {
    source: existsSync(snapshotPath) ? "snapshot" : "seed",
    codes: quotableCodes(loadSnapshot(snapshotPath).items, s3Flag),
  };
}

/**
 * Writes the list (only when it changed, so a parallel run sees a whole file) and returns it. `snapshotPath` defaults to the pages'
 * source: CATALOGUE_SNAPSHOT, else apps/web/catalogue-snapshot.json.
 */
export function writeQuotable(
  opts: { snapshotPath?: string; out?: string; s3Flag?: boolean } = {},
): QuotableFile {
  const snapshotPath = opts.snapshotPath ?? process.env.CATALOGUE_SNAPSHOT ?? snapshotFile();
  const out = opts.out ?? quotableFile();
  const data = quotableFor(snapshotPath, opts.s3Flag);
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (!existsSync(out) || readFileSync(out, "utf8") !== text) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
  }
  return data;
}
