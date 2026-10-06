// GSTIN validation and GST state codes [ADM-SET-01, ADM-CLI-01]. VERIFY WITH CA: the state list is the
// e-way bill master (docs.ewaybillgst.gov.in/apidocs/state-code.html, checked 2026-10-06; docs/08-A §place
// of supply). Tax and place-of-supply rules live in settings and the tax engine (M4.2), not here.

export type StateInfo = {
  readonly name: string;
  readonly kind: "state" | "ut" | "other";
  readonly legacy?: true;
};

export const SUPPLIER_STATE_CODE = "19"; // West Bengal (TecHaust's registration)

export const STATE_CODES = {
  "01": { name: "Jammu and Kashmir", kind: "ut" },
  "02": { name: "Himachal Pradesh", kind: "state" },
  "03": { name: "Punjab", kind: "state" },
  "04": { name: "Chandigarh", kind: "ut" },
  "05": { name: "Uttarakhand", kind: "state" },
  "06": { name: "Haryana", kind: "state" },
  "07": { name: "Delhi", kind: "ut" },
  "08": { name: "Rajasthan", kind: "state" },
  "09": { name: "Uttar Pradesh", kind: "state" },
  "10": { name: "Bihar", kind: "state" },
  "11": { name: "Sikkim", kind: "state" },
  "12": { name: "Arunachal Pradesh", kind: "state" },
  "13": { name: "Nagaland", kind: "state" },
  "14": { name: "Manipur", kind: "state" },
  "15": { name: "Mizoram", kind: "state" },
  "16": { name: "Tripura", kind: "state" },
  "17": { name: "Meghalaya", kind: "state" },
  "18": { name: "Assam", kind: "state" },
  "19": { name: "West Bengal", kind: "state" },
  "20": { name: "Jharkhand", kind: "state" },
  "21": { name: "Odisha", kind: "state" },
  "22": { name: "Chhattisgarh", kind: "state" },
  "23": { name: "Madhya Pradesh", kind: "state" },
  "24": { name: "Gujarat", kind: "state" },
  "25": { name: "Daman and Diu", kind: "ut", legacy: true },
  "26": { name: "Dadra and Nagar Haveli and Daman and Diu", kind: "ut" },
  "27": { name: "Maharashtra", kind: "state" },
  "28": { name: "Andhra Pradesh (before 2014)", kind: "state", legacy: true },
  "29": { name: "Karnataka", kind: "state" },
  "30": { name: "Goa", kind: "state" },
  "31": { name: "Lakshadweep", kind: "ut" },
  "32": { name: "Kerala", kind: "state" },
  "33": { name: "Tamil Nadu", kind: "state" },
  "34": { name: "Puducherry", kind: "ut" },
  "35": { name: "Andaman and Nicobar Islands", kind: "ut" },
  "36": { name: "Telangana", kind: "state" },
  "37": { name: "Andhra Pradesh", kind: "state" },
  "38": { name: "Ladakh", kind: "ut" },
  "97": { name: "Other Territory", kind: "other" },
} as const satisfies Record<string, StateInfo>;

export type StateCode = keyof typeof STATE_CODES;

/** Place-of-supply code for exports of services in the e-invoice schema (docs/06 §export invoice). */
export const EXPORT_PLACE_OF_SUPPLY = "96";

export const isStateCode = (code: string): code is StateCode => Object.hasOwn(STATE_CODES, code);

/** Current (non-legacy) codes in code order, for state pickers. (Object.entries would put "10"–"97"
 * before "01"–"09": JavaScript orders integer-like keys first.) */
export const selectableStates = (): { code: StateCode; name: string }[] =>
  (Object.entries(STATE_CODES) as [StateCode, StateInfo][])
    .filter(([, s]) => !s.legacy)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, s]) => ({ code, name: s.name }));

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// 2-digit state + PAN (5 letters, 4 digits, 1 letter) + entity number + default "Z" (any A–Z/0–9 accepted;
// the check character catches typos) + check character.
const SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$/;

/** The GSTIN check character (mod-36, alternating weights 1 and 2) for the first 14 characters. */
export function gstinCheckChar(first14: string): string {
  if (!/^[0-9A-Z]{14}$/.test(first14)) throw new RangeError("Expected 14 characters A–Z or 0–9");
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const product = ALPHABET.indexOf(first14[i] as string) * (i % 2 === 0 ? 1 : 2);
    total += Math.trunc(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (total % 36)) % 36] as string;
}

export type GstinResult =
  | { ok: true; gstin: string; stateCode: StateCode; state: string; pan: string; legacyState: boolean }
  | { ok: false; error: string };

/** Normalise (trim, upper-case, drop spaces) and validate a GSTIN, deriving its state and PAN. */
export function validateGstin(input: string): GstinResult {
  const gstin = input.replace(/\s+/g, "").toUpperCase();
  if (gstin.length !== 15) return { ok: false, error: "A GSTIN has 15 characters" };
  if (!SHAPE.test(gstin))
    return { ok: false, error: "That doesn't look like a GSTIN (e.g. 19ABCDE1234F1Z5)" };
  const stateCode = gstin.slice(0, 2);
  if (!isStateCode(stateCode)) return { ok: false, error: `Unknown state code ${stateCode}` };
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) {
    return { ok: false, error: "The GSTIN's last character doesn't match. Check for a typo" };
  }
  const state: StateInfo = STATE_CODES[stateCode];
  return {
    ok: true,
    gstin,
    stateCode,
    state: state.name,
    pan: gstin.slice(2, 12),
    legacyState: !!state.legacy,
  };
}
