// The words the quote form and the lead alert both show for coded answers (budget band, timeline, tool, call window,
// country). One list here so the web pages and the jobs Worker cannot drift: the wording is the owner-approved copy of
// docs/07 §5.9 (moved from apps/web, unchanged). Amounts are written from numbers with `formatMoney`, never typed.
import { type Currency, formatMoney, money } from "./money.ts";
import { BUDGET_BANDS, type TIMELINES, type TOOLS } from "./schemas/forms.ts";

/**
 * The budget bands of 04 FRM-QUOTE as amounts in minor units (paise, cents): [from, up to). One lakh rupees is
 * 1,00,00,000 paise.
 */
const LAKH = 10_000_000;
const THOUSAND_USD = 100_000;
export const BAND_BOUNDS: Record<Currency, Record<string, readonly [number | null, number | null]>> = {
  INR: {
    "lt-1l": [null, 1 * LAKH],
    "1l-3l": [1 * LAKH, 3 * LAKH],
    "3l-7l": [3 * LAKH, 7 * LAKH],
    "7l-15l": [7 * LAKH, 15 * LAKH],
    "15l-plus": [15 * LAKH, null],
  },
  USD: {
    "lt-2k": [null, 2 * THOUSAND_USD],
    "2k-5k": [2 * THOUSAND_USD, 5 * THOUSAND_USD],
    "5k-15k": [5 * THOUSAND_USD, 15 * THOUSAND_USD],
    "15k-40k": [15 * THOUSAND_USD, 40 * THOUSAND_USD],
    "40k-plus": [40 * THOUSAND_USD, null],
  },
};

/** Interface words of the band labels ("Under ₹1,00,000", "₹1,00,000 to ₹3,00,000", "₹15,00,000 or more"). */
export const BAND_WORDS = { under: "Under", to: "to", orMore: "or more", notSure: "Not sure" } as const;

/** The label of one budget band, or the code itself when it is not a known band for that currency. */
export function budgetBandLabel(currency: Currency, value: string): string {
  if (value === "not-sure") return BAND_WORDS.notSure;
  const bounds = BAND_BOUNDS[currency][value];
  if (!bounds) return value;
  const [from, upTo] = bounds;
  const f = (n: number) => formatMoney(money(n, currency), { wholeUnits: true });
  if (from === null && upTo !== null) return `${BAND_WORDS.under} ${f(upTo)}`;
  if (from !== null && upTo === null) return `${f(from)} ${BAND_WORDS.orMore}`;
  if (from !== null && upTo !== null) return `${f(from)} ${BAND_WORDS.to} ${f(upTo)}`;
  return value;
}

/** One currency's bands in the schema's order, "Not sure" last. */
export const budgetBandOptions = (currency: Currency): { value: string; label: string }[] =>
  BUDGET_BANDS[currency].map((value) => ({ value, label: budgetBandLabel(currency, value) }));

/** 07 §5.9 timeline options, by the schema's values. */
export const TIMELINE_LABELS: Record<(typeof TIMELINES)[number], string> = {
  asap: "As soon as possible",
  "1-3-months": "1–3 months",
  "3-6-months": "3–6 months",
  exploring: "Just exploring",
};

/** 07 §5.9 tool names, by the schema's values. */
export const TOOL_LABELS: Record<(typeof TOOLS)[number], string> = {
  tally: "Tally",
  zoho: "Zoho",
  "excel-sheets": "Excel/Sheets",
  quickbooks: "QuickBooks",
  xero: "Xero",
  shopify: "Shopify",
  "whatsapp-business": "WhatsApp Business",
  other: "Other",
};

/** The label of a coded answer; the code itself when unknown (a label list that lags never hides an answer). */
export const labelOf = (labels: Readonly<Record<string, string>>, code: string): string => labels[code] ?? code;

/**
 * "Best time for a call" (07 §5.9): windows inside the published hours (Mon–Sat, 10:00–19:00 IST), as minutes after
 * midnight IST. The value sent is the IST text.
 */
export const CALL_WINDOWS = [
  { from: 600, to: 780 },
  { from: 780, to: 960 },
  { from: 960, to: 1140 },
] as const;
export const ANY_TIME = "Any time";

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** "10:00–13:00 IST" */
export const callWindowText = (w: { from: number; to: number }): string =>
  `${hhmm(w.from)}–${hhmm(w.to)} IST`;

/** A country's English name from its ISO 3166-1 code (ICU data), "and" never "&"; the code itself when unknown. */
export function countryName(code: string): string {
  const names = new Intl.DisplayNames("en-IN", { type: "region", fallback: "none" });
  let name: string | undefined;
  try {
    name = names.of(code);
  } catch {
    name = undefined;
  }
  return name ? name.replace(/\s*&\s*/g, " and ") : code;
}
