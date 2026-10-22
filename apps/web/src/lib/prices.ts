// The website's one door to prices (WEB-G-07): every price on the site is read here, at build time, by its
// catalogue reference, and rendered only by PriceTag / CopyText through @techaust/core's formatMoney. No amount is
// ever typed into a template or a content file (scripts/web-dist-checks.mjs fails the build on one).
//
// Source today: the owner-approved seed catalogue (packages/db, Phase 2). Phase 2 of M2.2 (builder) puts the
// published catalogue snapshot (ADM-CAT-05) behind this same interface, with the seed as the fallback, so keep the
// interface narrow: a reference in, two Money values out.
//
// References (the {{price:…}} tokens of docs/07):
//   "S5"            the entry's headline "from" price
//   "S16-essential" a named default line of the entry (07: {{price:Sx-<line>}}), matched on its description
import { formatMoney, type Money, money } from "@techaust/core";
import { CATALOGUE } from "@techaust/db/catalogue";

/** A price as the site shows it: INR always, USD where the service is offered internationally. */
export type SitePrice = { readonly inr: Money; readonly usd: Money | null };

/** The {{price:…}} token pattern of docs/07 (also used by CopyText to find prices in running text). */
export const PRICE_TOKEN = /\{\{price:(S\d+(?:-[a-z]+)?)\}\}/g;

/**
 * The price behind a docs/07 reference. Throws at build time (failing the build, never shipping a wrong price) for an
 * unknown code or line, an entry hidden from the site, or an entry without an INR price.
 */
export function priceOf(ref: string): SitePrice {
  const match = /^(S\d+)(?:-([a-z]+))?$/.exec(ref);
  if (!match) throw new Error(`priceOf: "${ref}" is not a catalogue reference (S1, S16-essential…)`);
  const [, code, line] = match;
  const entry = CATALOGUE.find((c) => c.code === code);
  if (!entry) throw new Error(`priceOf: no catalogue entry ${code}`);
  if (!entry.showOnSite) throw new Error(`priceOf: ${code} is hidden from the site (showOnSite: false)`);
  if (line) {
    const l = entry.defaultLines?.find((d) => d.description.toLowerCase() === line);
    if (!l || l.rateInrMinor === null) throw new Error(`priceOf: ${code} has no priced line "${line}"`);
    return {
      inr: money(l.rateInrMinor, "INR"),
      usd: l.rateUsdMinor === null ? null : money(l.rateUsdMinor, "USD"),
    };
  }
  if (entry.priceInr === null) throw new Error(`priceOf: ${code} has no INR price`);
  return {
    inr: money(entry.priceInr, "INR"),
    usd: entry.priceUsd === null ? null : money(entry.priceUsd, "USD"),
  };
}

/**
 * An amount as the site prints it: @techaust/core's format, with a zero minor part dropped (site prices are whole
 * rupees and dollars: "₹3,00,000", "$12,000"). String only, no maths. Phase 2: a whole-unit option in core replaces
 * the trim (M2.1 follow-up).
 */
export const displayAmount = (m: Money): string => formatMoney(m).replace(/\.00$/, "");
