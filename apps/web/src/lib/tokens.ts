// The one renderer of docs/07 price tokens in content strings (WEB-G-07), used by every page and by the plain-text
// places (meta descriptions). Tokens:
//   {{price:Sx}}        a price with "from" and, for INR, "+ GST" (07 "How to read"); Sx-<line> for a default line
//   {{price-plain:Sx}}  the bare amount
// An unknown or malformed token, an unknown code or a hidden service THROWS: the build fails, a wrong or missing price
// is never shipped.
import { displayAmount, priceOf, type SitePrice } from "./prices";

export type TextPart = { kind: "text"; text: string };
export type PricePart = SitePrice & {
  kind: "price";
  ref: string;
  /** {{price-plain:…}}: the amount alone, no "from" and no "+ GST". */
  plain: boolean;
  /** Whether to print "from": false when the copy already says "from" just before the token (07 writes both). */
  from: boolean;
};
export type Part = TextPart | PricePart;

const TOKEN = /\{\{([^{}]*)\}\}/g;
const KNOWN = /^(price|price-plain):(S\d+(?:-[a-z]+)?)$/;

/** Splits a content string into text and price parts. Throws on any `{{…}}` that is not a valid price token. */
export function parseTokens(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const known = KNOWN.exec(m[1] as string);
    if (!known) throw new Error(`Unknown content token ${m[0]} (known: {{price:Sx}}, {{price-plain:Sx}})`);
    const before = text.slice(last, m.index);
    if (before) parts.push({ kind: "text", text: before });
    const plain = known[1] === "price-plain";
    const ref = known[2] as string;
    parts.push({
      kind: "price",
      ref,
      plain,
      from: !plain && !/\bfrom\s$/i.test(text.slice(0, m.index)),
      ...priceOf(ref),
    });
    last = m.index + m[0].length;
  }
  const rest = text.slice(last);
  if (rest) parts.push({ kind: "text", text: rest });
  return parts;
}

/** Whether a string holds any token. */
export const hasTokens = (text: string): boolean => parseTokens(text).some((p) => p.kind === "price");

/**
 * Tokens as plain text, in INR (the site's default currency; no switch exists in meta text or link previews):
 * {{price:S1}} → "from ₹40,000 + GST" ("from" once), {{price-plain:S9}} → "₹2,00,000".
 */
export function renderPlain(text: string): string {
  return parseTokens(text)
    .map((p) => {
      if (p.kind === "text") return p.text;
      const amount = displayAmount(p.inr);
      return p.plain ? amount : `${p.from ? "from " : ""}${amount} + GST`;
    })
    .join("");
}
