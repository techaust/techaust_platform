// docs/07 tokens in plain-text places (meta descriptions, link previews), where there is no currency switch.
// These are read by search engines and link previews, so they use the site's default currency, INR, with the
// "+ GST" wording of 07: {{price:Sx}} → "from ₹2,00,000 + GST", {{price-plain:Sx}} → "₹2,00,000".
import { displayAmount, priceOf } from "./prices";

export function plainText(text: string): string {
  return text
    .replace(/\{\{price-plain:(S\d+(?:-[a-z]+)?)\}\}/g, (_, ref: string) => displayAmount(priceOf(ref).inr))
    .replace(/(from\s)?\{\{price:(S\d+(?:-[a-z]+)?)\}\}/gi, (_, from: string | undefined, ref: string) => {
      return `${from ?? "from "}${displayAmount(priceOf(ref).inr)} + GST`;
    });
}
