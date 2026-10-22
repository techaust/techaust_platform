// The one renderer of docs/07 tokens in content strings (WEB-G-07), used by every page and by the plain-text
// places (meta descriptions). Tokens:
//   {{price:Sx}}        a price with "from" and, for INR, "+ GST" (07 "How to read"); Sx-<line> for a default line
//   {{price-plain:Sx}}  the amount without "from" (on a page: no "+ GST"; in plain text, INR gets "+ GST")
//   {{terms:small_job_threshold}}  the settings default (catalogue snapshot payment terms), whole units, INR and USD,
//                       rendered like a plain price (ref "terms:…", no "+ GST")
//   {{postal_address}}  site.postalAddress, or a labelled placeholder while it is empty (OWNER input; never invented)
// An unknown or malformed token, an unknown code or a hidden service THROWS: the build fails, a wrong or missing price
// is never shipped.
import { money } from "@techaust/core";
import { site } from "../config/site";
import { draft } from "../content/shell";
import { snapshot } from "./catalogue";
import { displayAmount, priceOf, type SitePrice } from "./prices";

export type TextPart = { kind: "text"; text: string };
export type PricePart = SitePrice & {
  kind: "price";
  ref: string;
  /** {{price-plain:…}} and {{terms:…}}: the amount alone, no "from" and no "+ GST". */
  plain: boolean;
  /** Whether to print "from": false when the copy already says "from" just before the token (07 writes both). */
  from: boolean;
};
export type Part = TextPart | PricePart;

const TOKEN = /\{\{([^{}]*)\}\}/g;
const KNOWN = /^(price|price-plain):(S\d+(?:-[a-z]+)?)$/;
const TERMS = /^terms:([a-z_]+)$/;

/** What a legal page shows while `site.postalAddress` is empty (a visible, labelled gap, never an invented address). */
export const POSTAL_ADDRESS_PLACEHOLDER = "[Postal address: owner input pending]";

/** The payment-terms settings a `{{terms:key}}` token may name, as a price (INR and USD whole-unit amounts). */
function termsOf(key: string): SitePrice {
  const terms = snapshot().paymentTerms;
  if (key === "small_job_threshold")
    return {
      inr: money(terms.smallJobThreshold.INR, "INR"),
      usd: money(terms.smallJobThreshold.USD, "USD"),
    };
  throw new Error(`Unknown content token {{terms:${key}}} (known: small_job_threshold)`);
}

/** Splits a content string into text and price parts. Throws on any `{{…}}` that is not a valid token. */
export function parseTokens(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const body = m[1] as string;
    const known = KNOWN.exec(body);
    const terms = TERMS.exec(body);
    let asText: string | undefined;
    if (body === "postal_address") asText = site.postalAddress || POSTAL_ADDRESS_PLACEHOLDER;
    if (!known && !terms && asText === undefined)
      throw new Error(
        `Unknown content token ${m[0]} (known: {{price:Sx}}, {{price-plain:Sx}}, {{terms:small_job_threshold}}, {{postal_address}})`,
      );
    const before = text.slice(last, m.index);
    if (before) parts.push({ kind: "text", text: before });
    last = m.index + m[0].length;
    if (asText !== undefined) {
      parts.push({ kind: "text", text: asText });
    } else if (terms) {
      parts.push({ kind: "price", ref: body, plain: true, from: false, ...termsOf(terms[1] as string) });
    } else if (known) {
      const plain = known[1] === "price-plain";
      const ref = known[2] as string;
      parts.push({
        kind: "price",
        ref,
        plain,
        from: !plain && !/\bfrom\s$/i.test(text.slice(0, m.index)),
        ...priceOf(ref),
      });
    }
  }
  const rest = text.slice(last);
  if (rest) parts.push({ kind: "text", text: rest });
  return parts;
}

/** Whether a string holds any price or terms token. */
export const hasTokens = (text: string): boolean => parseTokens(text).some((p) => p.kind === "price");

/**
 * Tokens as plain text, in INR (the site's default currency; no switch exists in meta text or link previews):
 * {{price:S1}} → "from ₹40,000 + GST" ("from" once), {{price-plain:S9}} → "₹2,00,000 + GST" (owner, 2026-10-22: INR
 * amounts in meta text carry "+ GST"; VERIFY WITH CA/LEGAL). The words come from the shell copy, as on the pages.
 * A terms amount (a threshold) is not a price: no "+ GST".
 */
export function renderPlain(text: string): string {
  return parseTokens(text)
    .map((p) => {
      if (p.kind === "text") return p.text;
      if (p.ref.startsWith("terms:")) return displayAmount(p.inr);
      const amount = `${displayAmount(p.inr)} ${draft.gst}`;
      return p.plain || !p.from ? amount : `${draft.priceFrom} ${amount}`;
    })
    .join("");
}
