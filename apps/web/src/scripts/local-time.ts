// Every [data-hours] on the page (components/Hours.astro: the footer, the contact panel, the reply promise, the care-plan
// response times, the quote form's call windows) in the visitor's own clock, one time only (owner, 2026-11-01; docs/07 §1 "Times"). A clock on IST
// keeps the server's text, and so does a search engine's renderer. textContent only. The zone's short name is written in the
// visitor's English locale when they have one ("BST" for en-GB, "PDT" for en-US), else in en-US, so the sentence around
// it stays English.
import { type Clock, isCrawler, localWindow, textRuns } from "./call-time";

const clock: Clock = {
  locale: navigator.languages?.find((l) => /^en(-|$)/i.test(l)) ?? "en-US",
};

/** Writes the window's runs into `el` (each run unbreakable, as Hours.astro renders them). */
function writeRuns(el: HTMLElement, runs: string[]) {
  el.replaceChildren(
    ...runs.flatMap((r, i) => {
      const run = document.createElement("span");
      run.className = "hours__run";
      run.textContent = r;
      return i > 0 ? [" ", run] : [run];
    }),
  );
}

const now = new Date();
// A search engine keeps the IST text, which matches the meta description and the structured data (call-time.ts).
const elements = isCrawler(navigator.userAgent) ? [] : document.querySelectorAll<HTMLElement>("[data-hours]");
for (const el of elements) {
  const [first, last] = (el.dataset.days ?? "").split("-").map(Number);
  const local = localWindow(
    {
      from: Number(el.dataset.from),
      to: Number(el.dataset.to),
      ...(first !== undefined && last !== undefined && !Number.isNaN(first) && !Number.isNaN(last)
        ? { days: [first, last] as const }
        : {}),
    },
    now,
    clock,
  );
  if (local) writeRuns(el, textRuns(local));
}
