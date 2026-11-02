// One block line whose parts are joined by " · " ("GSTIN … · State …"), shared by the invoice, document (proposal and estimate) and statement layouts
// (M6.3 staging fixes, review L5: it was written out three times).
import { esc } from "../escape.ts";

/**
 * A `<p class="{cls}">` of `text`. When its parts are joined by " · " it breaks only between the parts, one part a line, and the separator is dropped there: the
 * party columns are too narrow for both parts, so the joined line wrapped and left " ·" dangling at the end of its first line, or broke inside "State West Bengal
 * (19)" (M6.3 staging fixes, part 3: the layout audit). Each part stays whole on its own line (`.keep`).
 */
export const partsLine = (cls: string, text: string): string =>
  !text.includes(" · ")
    ? `<p class="${cls}">${esc(text)}</p>`
    : `<p class="${cls}">${text
        .split(" · ")
        .map((part) => `<span class="keep">${esc(part)}</span>`)
        .join("<br>")}</p>`;
