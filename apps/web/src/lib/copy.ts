// docs/07 tokens in plain-text places (meta descriptions, link previews, structured data), where there is no
// currency switch. A thin name for tokens.ts's renderPlain, which is the one renderer: {{price:Sx}} → "from ₹2,00,000
// + GST", {{price-plain:Sx}} → "₹2,00,000 + GST".
import { renderPlain } from "./tokens";

export const plainText = renderPlain;

/**
 * A content string as the words a visitor reads, for JSON-LD (FAQPage, Article): tokens rendered as plain text
 * (INR), 07's bold marks dropped, Markdown links reduced to their label. Arrows stay as characters (JSON-LD isn't
 * drawn in the page fonts).
 */
export const plainCopy = (text: string): string =>
  renderPlain(text)
    .replaceAll("**", "")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1");
