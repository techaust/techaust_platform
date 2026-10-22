// Small helpers shared by the web build scripts (web-dist-checks, web-link-check, web-content-lint,
// check-prod-readiness). Dependency-free Node.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every file under `dir`, recursively (full paths). */
export function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** A string value of `key: "…"` in apps/web/src/config/site.ts ("" when empty or missing). */
export function readSiteString(siteTs, key) {
  return new RegExp(`\\b${key}:\\s*"([^"]*)"`).exec(siteTs)?.[1] ?? "";
}

/** A boolean value of `key: true|false` in site.ts (false when missing). */
export function readSiteBool(siteTs, key) {
  return new RegExp(`\\b${key}:\\s*(true|false)\\b`).exec(siteTs)?.[1] === "true";
}

/**
 * What `{{postal_address}}` shows while site.postalAddress is empty. The same text is POSTAL_ADDRESS_PLACEHOLDER in
 * apps/web/src/lib/tokens.ts (TypeScript can't import this file); test/content-m23.test.ts pins the two together.
 */
export const POSTAL_PLACEHOLDER_TEXT = "[Postal address: owner input pending]";
