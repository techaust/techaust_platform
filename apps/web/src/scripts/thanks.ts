// /thanks (07 §5.10, FRM-07): show the lead reference from `?ref=` only when it has the reference shape; anything else
// leaves the page as built (the text without a reference). textContent only: nothing from the URL becomes markup.
// The reference line and the WhatsApp line keep their place while hidden (thanks.astro, so showing them shifts
// nothing); without a valid reference they are removed.
import { LEAD_REF } from "@techaust/core";

const ref = new URLSearchParams(location.search).get("ref") ?? "";
const lines = document.querySelectorAll<HTMLElement>("[data-ref-line], [data-ref-only]");
if (LEAD_REF.test(ref)) {
  const code = document.querySelector<HTMLElement>("[data-ref]");
  if (code) code.textContent = ref;
  for (const el of lines) el.hidden = false;
} else {
  for (const el of lines) el.remove();
}
