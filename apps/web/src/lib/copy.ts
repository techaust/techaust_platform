// docs/07 tokens in plain-text places (meta descriptions, link previews), where there is no currency switch.
// A thin name for tokens.ts's renderPlain, which is the one renderer: {{price:Sx}} → "from ₹2,00,000 + GST",
// {{price-plain:Sx}} → "₹2,00,000 + GST".
import { renderPlain } from "./tokens";

export const plainText = renderPlain;
