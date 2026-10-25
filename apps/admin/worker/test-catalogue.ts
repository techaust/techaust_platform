// Fixtures of the catalogue tests (M4.1): items and the payment-terms setting written straight to the test database.
import { env } from "cloudflare:workers";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { SITE_REFERENCES } from "@techaust/core/site-references";
import { insert } from "./test-clients.ts";

let seq = 2000;

export const UPFRONT = [{ label: "On acceptance", pctBp: 10_000, trigger: "on_accept" }];

/** A catalogue item with a fresh code (`S2001`...) and slug; `over` uses the column names. */
export async function mkItem(over: Record<string, unknown> = {}) {
  const n = ++seq;
  const id = crypto.randomUUID();
  const row = {
    id,
    code: `S${n}`,
    name: `Test service ${n}`,
    category: "build",
    short: "A short description",
    unit: "fixed",
    price_inr_minor: 100_000,
    price_usd_minor: null,
    sac: "998314",
    schedule: JSON.stringify(UPFRONT),
    slug: `test-service-${n}`,
    show_on_site: 1,
    active: 1,
    updated_at: Date.now() - 1000,
    ...over,
  };
  await insert("catalogue_items", row);
  return { id, code: row.code as string, updatedAt: row.updated_at as number };
}

/** The create body of the API for a fresh code. */
export function entryBody(over: Record<string, unknown> = {}) {
  const n = ++seq;
  return {
    code: `S${n}`,
    name: `New service ${n}`,
    category: "build",
    short: "A short description",
    unit: "fixed",
    priceInrMinor: 100_000,
    priceUsdMinor: null,
    sac: "998314",
    gstRateBp: null,
    defaultLines: null,
    schedule: UPFRONT,
    slug: `new-service-${n}`,
    showOnSite: true,
    ...over,
  };
}

/** The payment-terms setting, as the seed would have written it. */
export async function putPaymentTerms(value: unknown = SETTINGS_DEFAULTS.payment_terms) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO settings (key, value, version) VALUES ('payment_terms', ?1, 1)",
  )
    .bind(JSON.stringify(value))
    .run();
}

/** Take every item off the site and out of use, so a publish test sees only its own items (items are never deleted). */
export async function retireAll() {
  await env.DB.prepare("UPDATE catalogue_items SET active = 0, show_on_site = 0").run();
}

/**
 * Every other item off the site, and the services the website needs (core's SITE_REFERENCES) on it, each with a rupee price and
 * its named default lines, so a publish test can succeed (publishing refuses a snapshot the website cannot be built from).
 * The test database has no seed, so the rows are made (or reset, when an earlier test changed them). Returns each one's id.
 */
export async function siteItems(): Promise<Map<string, { id: string; updatedAt: number }>> {
  await retireAll();
  const out = new Map<string, { id: string; updatedAt: number }>();
  for (const need of SITE_REFERENCES) {
    const lines = Object.keys(need.lines).map((word) => ({
      description: `${word[0]?.toUpperCase()}${word.slice(1)} thing`,
      unit: "fixed",
      qtyMilli: 1_000,
      rateInrMinor: 50_000,
      rateUsdMinor: null,
    }));
    const updatedAt = Date.now() - 1000;
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO catalogue_items (id, code, name, category, short, unit, price_inr_minor, price_usd_minor, sac, schedule, default_lines, slug, show_on_site, active, updated_at)
       VALUES (?1, ?2, ?3, 'build', 'A short description', 'fixed', ?4, NULL, '998314', ?5, ?6, ?7, 1, 1, ?8)
       ON CONFLICT(code) DO UPDATE SET name = excluded.name, price_inr_minor = excluded.price_inr_minor, price_usd_minor = NULL,
         schedule = excluded.schedule, default_lines = excluded.default_lines, show_on_site = 1, active = 1, updated_at = excluded.updated_at`,
    )
      .bind(
        id,
        need.code,
        `Site service ${need.code}`,
        need.price.length ? 5_000_000 : null,
        JSON.stringify(UPFRONT),
        lines.length ? JSON.stringify(lines) : null,
        `site-${need.code.toLowerCase()}`,
        updatedAt,
      )
      .run();
    const row = await env.DB.prepare("SELECT id FROM catalogue_items WHERE code = ?1")
      .bind(need.code)
      .first<{ id: string }>();
    out.set(need.code, { id: row?.id ?? id, updatedAt });
  }
  return out;
}
