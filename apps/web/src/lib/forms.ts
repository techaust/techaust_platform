// Build-time data for the form pages (M2.4): the budget bands as money, the country list, the call windows, the
// service picker's groups and the consent notice version. Nothing here is copy except through content/forms.ts.
// The budget bands, call windows and country names live in @techaust/core (form-labels.ts) because the lead alert in
// apps/jobs shows the same words; this file re-exports them for the pages.
import {
  ANY_TIME,
  BAND_BOUNDS,
  budgetBandOptions,
  CALL_WINDOWS,
  type Currency,
  callWindowText,
  countryName,
} from "@techaust/core";
import { legal } from "../content/legal";
import { serviceContent } from "../content/services";
import { servicesHub } from "../content/services-hub";
import { isServiceOnSite } from "./prices";

export { BAND_BOUNDS, CALL_WINDOWS };

export type Band = { value: string; label: string };

/** One currency's bands in the schema's order (BUDGET_BANDS in @techaust/core), "Not sure" last. */
export const budgetBands = (currency: Currency): Band[] => budgetBandOptions(currency);

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
  return ISO_CODES.split(" ")
    .map((code) => {
      const name = countryName(code);
      if (name === code) throw new Error(`countries: no name for ${code}`);
      return { code, name };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/**
 * "Best time for a call" (07 §5.9): the windows and the text sent are in @techaust/core; the page adds the visitor's own
 * clock beside each window.
 */
export function callWindows(): { value: string; from?: number; to?: number }[] {
  return [
    ...CALL_WINDOWS.map((w) => ({ value: callWindowText(w), from: w.from, to: w.to })),
    { value: ANY_TIME },
  ];
}

/** The service picker: the hub's groups (07 §2.1 order), only services on the site, with their 07 names. */
export function serviceGroups() {
  return servicesHub.groups
    .map((g) => ({
      id: g.id,
      name: g.name,
      intro: g.intro,
      services: g.codes
        .filter((c) => isServiceOnSite(c))
        .map((c) => ({ code: c, name: serviceContent(c).name })),
    }))
    .filter((g) => g.services.length > 0);
}

/** The consent receipt's notice version (FRM-05): the privacy notice the form links to. */
export const noticeVersion: string = legal.privacy.version;
