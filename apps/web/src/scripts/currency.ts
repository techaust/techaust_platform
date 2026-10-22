// The one currency state of a page (WEB-G-06): <html data-currency>, set before the first paint by the head script
// (layouts/BaseLayout.astro) from a stored choice (ta_currency), else the cached /api/geo answer (ta_geo), else INR.
// Every switch (CurrencyToggle in the footer and the phone menu, CurrencyNote beside prices) draws its state from that
// attribute in CSS, so nothing changes when this module runs; it only keeps the radios in sync, handles clicks, and
// asks /api/geo once when there is neither a choice nor a fresh answer. Imported by both components, bundled once.
type Currency = "inr" | "usd";
const root = document.documentElement;

function current(): Currency {
  return root.dataset.currency === "usd" ? "usd" : "inr";
}

/** The radios follow the attribute (for clicks, arrow keys and assistive tech; the look never depends on them). */
function sync(cur: Currency) {
  for (const input of document.querySelectorAll<HTMLInputElement>("[data-currency-toggle] input")) {
    input.checked = input.value === cur;
  }
}

function apply(cur: Currency) {
  root.dataset.currency = cur;
  sync(cur);
}

function choose(cur: Currency) {
  apply(cur);
  try {
    localStorage.setItem("ta_currency", cur);
  } catch {
    // Storage blocked: the choice lasts for this page view.
  }
}

apply(current());

// No stored choice and no fresh geo answer (the head script left INR): ask /api/geo once, keep it 30 days.
try {
  const chosen = localStorage.getItem("ta_currency");
  let geo: { at: number } | null = null;
  try {
    geo = JSON.parse(localStorage.getItem("ta_geo") || "null");
  } catch {} // corrupt cache = no cache: ask /api/geo again
  if (chosen !== "inr" && chosen !== "usd" && !(geo && geo.at > Date.now() - 2592e6)) {
    fetch("/api/geo")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { currency?: string } | null) => {
        const cur: Currency = j?.currency === "USD" ? "usd" : "inr";
        localStorage.setItem("ta_geo", JSON.stringify({ c: cur, at: Date.now() }));
        // The visitor may have chosen while the request was in flight.
        const now = localStorage.getItem("ta_currency");
        if (now !== "inr" && now !== "usd") apply(cur);
      })
      .catch(() => {});
  }
} catch {
  // Storage blocked: stay on INR.
}

document.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement | null;
  if (input?.closest("[data-currency-toggle]")) choose(input.value === "usd" ? "usd" : "inr");
});

document.addEventListener("click", (event) => {
  const btn = (event.target as Element | null)?.closest("[data-currency-switch]");
  if (!btn) return;
  const cur: Currency = current() === "usd" ? "inr" : "usd";
  choose(cur);
  // The button keeps focus and its text flips; the note's status line says what the prices are now in.
  const status = btn.closest("[data-currency-note]")?.querySelector("[data-currency-status]");
  if (status) status.textContent = status.getAttribute(`data-${cur}`) ?? "";
});
