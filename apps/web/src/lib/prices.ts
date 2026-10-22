// The website's one door to prices and payment schedules (WEB-G-07, WEB-SVC-05): everything is read here, at build time,
// from the catalogue snapshot (lib/catalogue.ts) by its catalogue reference, and rendered only by PriceTag / CopyText
// through @techaust/core's formatMoney. No amount is ever typed into a template or a content file
// (scripts/web-dist-checks.mjs fails the build on one).
//
// References (the {{price:…}} tokens of docs/07):
//   "S5"            the entry's headline "from" price
//   "S16-essential" a named default line of the entry (07: {{price:Sx-<line>}}), matched on the FIRST WORD of its
//                   description ("Monthly management" is S11-monthly); the word must be unique within the entry
import { formatMoney, type Money, money, scheduleText } from "@techaust/core";
import { flags } from "../config/site";
import { snapshot } from "./catalogue";
import { isVisible } from "./service-visibility";

/** A price as the site shows it: INR always, USD where the service is offered internationally. */
export type SitePrice = { readonly inr: Money; readonly usd: Money | null };

type Item = ReturnType<typeof snapshot>["items"][number];

const find = (code: string): Item | undefined => snapshot().items.find((c) => c.code === code);

export { isVisible };

const visible = (item: Item): boolean => isVisible(item, flags.S3_DPDP_PAGE);

/** The default line whose description starts with `word` (case-insensitive); throws when two do (ambiguous). */
export function lineByFirstWord<L extends { description: string }>(
  code: string,
  lines: readonly L[],
  word: string,
): L | undefined {
  const first = (d: string): string => (d.trim().split(/\s+/)[0] ?? "").toLowerCase();
  const hits = lines.filter((d) => first(d.description) === word.toLowerCase());
  if (hits.length > 1)
    throw new Error(`priceOf: ${code} has more than one line starting with "${word}": ambiguous reference`);
  return hits[0];
}

/** For pages and the services hub: false means "do not build the page, do not list it" (WEB-G-17). */
export function isServiceOnSite(code: string): boolean {
  const item = find(code);
  return item !== undefined && visible(item);
}

function entry(fn: string, code: string): Item {
  const item = find(code);
  if (!item) throw new Error(`${fn}: no catalogue entry ${code}`);
  if (!visible(item))
    throw new Error(`${fn}: ${code} is hidden from the site (showOnSite: false / flag off)`);
  return item;
}

/**
 * The price behind a docs/07 reference. Throws at build time (failing the build, never shipping a wrong price) for an
 * unknown code or line, an entry hidden from the site, or an entry without an INR price.
 */
export function priceOf(ref: string): SitePrice {
  const match = /^(S\d+)(?:-([a-z]+))?$/.exec(ref);
  if (!match) throw new Error(`priceOf: "${ref}" is not a catalogue reference (S1, S16-essential…)`);
  const [, code, line] = match;
  const item = entry("priceOf", code as string);
  if (line) {
    const l = lineByFirstWord(code as string, item.defaultLines, line);
    if (!l || l.rateInrMinor === null) throw new Error(`priceOf: ${code} has no priced line "${line}"`);
    return {
      inr: money(l.rateInrMinor, "INR"),
      usd: l.rateUsdMinor === null ? null : money(l.rateUsdMinor, "USD"),
    };
  }
  if (item.priceInrMinor === null) throw new Error(`priceOf: ${code} has no INR price`);
  return {
    inr: money(item.priceInrMinor, "INR"),
    usd: item.priceUsdMinor === null ? null : money(item.priceUsdMinor, "USD"),
  };
}

/**
 * The payment schedule of a service as text (WEB-SVC-05), worded from the catalogue steps and never typed:
 * "40 % on acceptance, 30 % at the midpoint milestone, 30 % on delivery", "Paid in full upfront", "Monthly in advance".
 * Throws for an unknown or hidden code.
 */
export function scheduleOf(code: string): string {
  return scheduleText(entry("scheduleOf", code).schedule);
}

/** An amount as the site prints it: whole rupees and dollars without a zero minor part ("₹3,00,000", "$12,000"). */
export const displayAmount = (m: Money): string => formatMoney(m, { wholeUnits: true });
