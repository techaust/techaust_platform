// Fixtures of the catalogue tests (M4.1): items and the payment-terms setting written straight to the test database.
import { env } from "cloudflare:workers";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
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
