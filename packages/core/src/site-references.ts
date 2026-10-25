// What the website needs from the published catalogue snapshot (M4.1 review finding 2; ADM-CAT-05, WEB-G-07, WEB-SVC-05).
//
// The website is built from the newest snapshot, and its build throws when a price it prints is missing (`priceOf` in
// apps/web/src/lib/prices.ts). A snapshot that passes the schema but lacks one of these would be stored, and then every staging
// web build would fail, `deploy-staging` for every later merge included. So publishing checks the built snapshot against this
// list and refuses (422 `snapshot_invalid`) instead.
//
// The list is a pure constant. `apps/web/test/site-references.test.ts` scans the website's content and components for every
// `{{price:…}}` / `{{price-plain:…}}` token, `ref` and service `code`, and fails when this list misses one, so the list cannot
// drift from the pages. Add a code here when a page starts to use it, and remove it when the page goes.
//
// - `price`: the currencies the headline price (`priceOf("S5")`) must have. The website prints USD only where there is one and
//   says "on request" otherwise, so only INR is ever required.
// - `lines`: the default lines the website reads by the FIRST WORD of the description (`priceOf("S11-setup")`: "Setup fee" is
//   `setup`), with the currencies their rate must have. The word must be unique within the service.
// - Every code listed must be in the snapshot (active and on the website): the service page, its price table, the services hub
//   and the payment schedule are built from it.

export type SiteCurrency = "inr" | "usd";

export type SiteNeed = {
  readonly code: string;
  readonly price: readonly SiteCurrency[];
  readonly lines: Readonly<Record<string, readonly SiteCurrency[]>>;
};

const INR = ["inr"] as const;
const priced = (code: string): SiteNeed => ({ code, price: INR, lines: {} });

export const SITE_REFERENCES: readonly SiteNeed[] = [
  priced("S1"),
  priced("S2"),
  priced("S4"),
  priced("S5"),
  priced("S6"),
  priced("S7"),
  priced("S9"),
  priced("S10"),
  // The page's hero price is the setup line; {{price:S11}} (the industries page) is the headline price.
  { code: "S11", price: INR, lines: { setup: INR, monthly: INR } },
  priced("S12"),
  priced("S13"),
  priced("S14"),
  // Payments and billing: a row of the pricing table, no page of its own.
  priced("S15"),
  // Care plans: three tiers, each its own line.
  { code: "S16", price: [], lines: { essential: INR, growth: INR, scale: INR } },
  // AI Ops add-on: a row of the pricing table, no page of its own.
  priced("S17"),
  priced("S18"),
];

/** What a publish lacks: the service itself, its headline price in a currency, or a default line (by its first word). */
export type SiteGap =
  | { readonly code: string; readonly kind: "service"; readonly path: string }
  | { readonly code: string; readonly kind: "price"; readonly currency: SiteCurrency; readonly path: string }
  | {
      readonly code: string;
      readonly kind: "line";
      readonly word: string;
      readonly currency: SiteCurrency | null;
      readonly ambiguous: boolean;
      readonly path: string;
    };

type SnapshotLine = {
  readonly description: string;
  readonly rateInrMinor: number | null;
  readonly rateUsdMinor: number | null;
};
type SnapshotItemNeeds = {
  readonly code: string;
  readonly priceInrMinor: number | null;
  readonly priceUsdMinor: number | null;
  readonly defaultLines: readonly SnapshotLine[];
};

/** The first word of a line's description, lower case: how the website finds a line (`lineByFirstWord` in apps/web). */
export const firstWord = (description: string): string =>
  (description.trim().split(/\s+/)[0] ?? "").toLowerCase();

const PRICE_FIELD: Record<SiteCurrency, "priceInrMinor" | "priceUsdMinor"> = {
  inr: "priceInrMinor",
  usd: "priceUsdMinor",
};
const RATE_FIELD: Record<SiteCurrency, "rateInrMinor" | "rateUsdMinor"> = {
  inr: "rateInrMinor",
  usd: "rateUsdMinor",
};

/**
 * What the website needs that the snapshot lacks, as gaps with their paths (`items.S7`, `items.S7.priceInrMinor`,
 * `items.S11.lines.setup`; codes, never values). Empty when the website can be built. Checked on the built snapshot, after the
 * schema: it is the snapshot's content that matters, not the rows it came from.
 */
export function siteGaps(
  items: readonly SnapshotItemNeeds[],
  needs: readonly SiteNeed[] = SITE_REFERENCES,
): SiteGap[] {
  const byCode = new Map(items.map((i) => [i.code, i]));
  const gaps: SiteGap[] = [];
  for (const need of needs) {
    const item = byCode.get(need.code);
    if (!item) {
      gaps.push({ code: need.code, kind: "service", path: `items.${need.code}` });
      continue;
    }
    for (const currency of need.price)
      if (item[PRICE_FIELD[currency]] === null)
        gaps.push({
          code: need.code,
          kind: "price",
          currency,
          path: `items.${need.code}.${PRICE_FIELD[currency]}`,
        });
    for (const [word, currencies] of Object.entries(need.lines)) {
      const path = `items.${need.code}.lines.${word}`;
      const hits = item.defaultLines.filter((l) => firstWord(l.description) === word);
      if (hits.length === 0) {
        gaps.push({ code: need.code, kind: "line", word, currency: null, ambiguous: false, path });
        continue;
      }
      if (hits.length > 1) {
        gaps.push({ code: need.code, kind: "line", word, currency: null, ambiguous: true, path });
        continue;
      }
      const line = hits[0] as SnapshotLine;
      for (const currency of currencies)
        if (line[RATE_FIELD[currency]] === null)
          gaps.push({ code: need.code, kind: "line", word, currency, ambiguous: false, path });
    }
  }
  return gaps;
}

/** True when `code` is on the list: the services whose retirement or removal from the website stops the next publish. */
export const isSiteReferenced = (code: string, needs: readonly SiteNeed[] = SITE_REFERENCES): boolean =>
  needs.some((n) => n.code === code);
