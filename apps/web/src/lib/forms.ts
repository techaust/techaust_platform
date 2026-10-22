// Build-time data for the form pages (M2.4): the budget bands as money, the country list, the call windows, the
// service picker's groups and the consent notice version. Nothing here is copy except through content/forms.ts.
import { BUDGET_BANDS, type Currency, formatMoney, money } from "@techaust/core";
import { formUi, quotePage } from "../content/forms";
import { legal } from "../content/legal";
import { servicesHub } from "../content/services-hub";
import { serviceContent } from "../content/services";
import { isServiceOnSite } from "./prices";

/**
 * The budget bands of 04 FRM-QUOTE as amounts in minor units (paise, cents): [from, up to). The labels are written from
 * these with @techaust/core's formatMoney, never typed (WEB-G-07). One lakh rupees is 1,00,00,000 paise.
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

export type Band = { value: string; label: string };

/** One currency's bands in the schema's order (BUDGET_BANDS in @techaust/core), "Not sure" last. */
export function budgetBands(currency: Currency): Band[] {
  return BUDGET_BANDS[currency].map((value) => {
    if (value === "not-sure") return { value, label: quotePage.budget.notSure };
    const bounds = BAND_BOUNDS[currency][value];
    if (!bounds) throw new Error(`budgetBands: no amounts for ${currency} band "${value}"`);
    const [from, upTo] = bounds;
    const f = (n: number) => formatMoney(money(n, currency), { wholeUnits: true });
    if (from === null && upTo !== null) return { value, label: `${formUi.under} ${f(upTo)}` };
    if (from !== null && upTo === null) return { value, label: `${f(from)} ${formUi.orMore}` };
    if (from !== null && upTo !== null) return { value, label: `${f(from)} ${formUi.to} ${f(upTo)}` };
    throw new Error(`budgetBands: ${currency} band "${value}" has no amounts`);
  });
}

/** ISO 3166-1 alpha-2 codes (the 249 officially assigned); the names come from the browser-independent ICU data. */
const ISO_CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC " +
  "CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD " +
  "GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH " +
  "KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW " +
  "MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC " +
  "SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY " +
  "UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW";

/** Every country as { code, name }, sorted by name; "and", never "&", in the names (ICU writes "Antigua & Barbuda"). */
export function countries(): { code: string; name: string }[] {
  const names = new Intl.DisplayNames("en-IN", { type: "region", fallback: "none" });
  return ISO_CODES.split(" ")
    .map((code) => {
      const name = names.of(code);
      if (!name) throw new Error(`countries: no name for ${code}`);
      return { code, name: name.replace(/\s*&\s*/g, " and ") };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/**
 * "Best time for a call" (07 §5.9): windows inside the published hours (Mon–Sat, 10:00–19:00 IST), as minutes after
 * midnight IST. The value sent is the IST text; the page adds the visitor's own clock beside each window.
 */
export const CALL_WINDOWS = [
  { from: 600, to: 780 },
  { from: 780, to: 960 },
  { from: 960, to: 1140 },
] as const;

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function callWindows(): { value: string; from?: number; to?: number }[] {
  return [
    ...CALL_WINDOWS.map((w) => ({ value: `${hhmm(w.from)}–${hhmm(w.to)} IST`, from: w.from, to: w.to })),
    { value: formUi.anyTime },
  ];
}

/** The service picker: the hub's groups (07 §2.1 order), only services on the site, with their 07 names. */
export function serviceGroups() {
  return servicesHub.groups
    .map((g) => ({
      id: g.id,
      name: g.name,
      intro: g.intro,
      services: g.codes.filter((c) => isServiceOnSite(c)).map((c) => ({ code: c, name: serviceContent(c).name })),
    }))
    .filter((g) => g.services.length > 0);
}

/** The consent receipt's notice version (FRM-05): the privacy notice the form links to. */
export const noticeVersion: string = legal.privacy.version;
