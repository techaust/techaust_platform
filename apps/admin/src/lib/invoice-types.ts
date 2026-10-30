// The words and pure rules of the M5.2 screens (ADM-INV-06, -08, -10, -18, ADM-SET-02, -03): the export invoice, the proforma and the tax invoice
// for a payment received, the exchange rate, the letters of undertaking and the mandatory-field checklist. 07-S word for word
// (docs/07-content-appendix/S-m5.2-invoice-types.md), approved by the lead on 2026-10-28 under the owner's delegation; the tax lines are Researched
// 2026-10-28 or OPEN per 08-C (the IDs are noted at each line). A line 07-S lacked is 07-W's (approved 2026-10-28), never
// invented; a word borrowed from an approved screen says where it comes from.
//
// Money: amounts are the server's minor units, formatted through core; typed amounts are parsed through core (`moneyFrom`), the rate through core's
// `parseFxRate` (digit by digit, no float). Nothing here adds, multiplies or rounds money: the only arithmetic is comparing two integers.
import {
  FX_SOURCE_CODES,
  type FxSourceCode,
  HOUSE_RULE_ITEMS,
  isHouseRuleItem,
  PURPOSE_CODE,
  parseFxRate,
} from "@techaust/core/invoices";
import { fyLabelOfToken } from "@techaust/core/pdf-jobs";
import type { Currency } from "../api.ts";
import { dayText, moneyText } from "./documents.ts";
import { moneyFrom } from "./settings-form.ts";

// ---- 07-S word for word --------------------------------------------------------------------------------------------------------------------------

export const INVT_COPY = {
  // §1 (the PDF's labels, shown the same way on the issued invoice)
  countryOfDestination: "Country of destination",
  addressOfDelivery: "Address of delivery",
  placeOfSupply: "Place of supply: Outside India (96)",
  valueInInr: "Value in INR",
  taxableInInr: "Taxable value in INR",
  igstInInr: "IGST in INR",
  purposeCode: "Purpose code",
  // §2
  validUntil: "Valid until",
  proformaNotice: "This is not a tax invoice. A tax invoice will be issued when payment is received.",
  // §3
  checklistTitle: "What every invoice must show",
  // Researched 2026-10-28, Rule 46 CGST (08-C RA-05, RA-06).
  checklistIntro:
    'Issuing is blocked while anything ticked here is missing. The defaults follow GST Rule 46. Items marked "House rule" aren\'t required by GST law; you can turn them off.',
  checklistLocked: "Required by GST law, so it can't be turned off.",
  houseRule: "House rule",
  // §4
  fxTitle: "Exchange rate for this invoice",
  fxRate: "1 USD = ₹",
  fxDate: "Rate date",
  fxSource: "Source",
  fxError: "Enter a rate above zero, with up to 4 decimal places.",
  // Researched 2026-10-28, s.2(6) IGST and FEMA 23(R)/2026-RB (08-C RA-18, RB-32).
  inrConfirm:
    "This export invoice is in INR. It counts as an export only if the payment reaches you in a way the RBI allows for exports in rupees: check with your bank. Issue it in INR anyway?",
  issueInInr: "Issue in INR",
  cancel: "Cancel",
  // §5
  lutSection: "Letters of undertaking (LUT)",
  lutIntro:
    "File a new LUT on the GST portal for each financial year (Form GST RFD-11), then save its ARN here. Export invoices without IGST need the LUT for their year.",
  lutFy: "Financial year",
  lutArn: "ARN",
  lutFiledOn: "Filed on",
  addLut: "Add LUT",
  lutDuplicate: "This year already has an LUT.",
  lutArnMissing: "Enter the ARN from the GST portal.",
  // §6
  advanceAction: "Issue tax invoice for payment received",
  advanceBody:
    "Record a payment you've received against this proforma. A tax invoice is issued for the amount received, with the next number, and linked to the proforma.",
  amountReceived: "Amount received",
  dateReceived: "Date received",
  paymentReference: "Payment reference (UTR or bank reference)",
  referenceUsed: "This payment reference was already used for this proforma.",
  exceedsBalance: "The amount can't be more than the proforma's balance.",
  converted: "Converted",
  // §8
  intermediaryLabel: "Intermediary bank (if your bank uses one)",
  purposeHint:
    "The RBI purpose code for the foreign payments you receive, for example P0802 for software services. Ask your bank which code to use.",
  exportNoteHint:
    "Optional. Printed on export invoices after the legal export statement, which is always printed.",
  previousPeriod:
    "This payment arrived in an earlier month. The GST on it belongs to that month's return: check with your CA.",
  routeLegend: "How is GST handled on this export?",
  routeLut: "Under LUT, without IGST",
  routeIgst: "With IGST paid",
  fxNoteLabel: "Describe the source",
  fxNoteMissing: "Describe where the rate comes from.",
  referenceMissing: "Enter the payment reference.",
  amountZero: "Enter an amount above zero.",
  serviceDateMissing: "Enter the date the service was completed.",
  dateReceivedMissing: "Enter the date the payment was received.",
  proformaIssueStatement:
    "This proforma will get the next number in its series and can't be edited afterwards. It is not a tax invoice.",
  proformaVoidBlocked: "This proforma can't be voided because a payment has been recorded against it.",
  advanceSupplyChanged:
    "The client's GST details changed after this proforma was issued, so the tax on this payment can't be worked out from it. Check the client's details with your CA before recording the payment.",
  // §9 (Q37, owner 2026-10-28; Researched 2026-10-28, Rule 96A CGST, 08-C RA-19): the route when the payment's year has no LUT.
  advanceRouteLegend: "This payment's year has no LUT",
  advanceRouteSaveLut: "Save the LUT first",
  advanceRouteIgst: "Issue with IGST",
  advanceIgstNote: "IGST at 18 % is charged on this payment. The proforma's other payments are not affected.",
  /**
   * The FX dialog's statement that no rate was published on the invoice's day (contract `noRateThatDay`, builder item 5). 07-S has no line for the
   * checkbox itself: its words are a proposal built from 07-S §4 and §8's own ("If none was published that day"), approved in 07-W §1.
   */
  fxNoRateThatDay: "No rate was published that day",
} as const;

/** 07-S §9 `advance_lut_missing` (Q37): `fy` is the financial year of the day the payment was received. */
export const advanceLutMissing = (fy: string) =>
  `There's no LUT saved for FY ${fy}, when this payment was received, so this tax invoice can't be issued without IGST. Save that year's LUT ARN in Settings › Tax first, or issue it with IGST.`;

/** The house rules of the checklist (07-S §3; Researched 2026-10-28, 08-C RA-05, RA-06): switchable, with the "House rule" badge. Core's
 * `HOUSE_RULE_ITEMS` (the list the settings API refuses `checklist_item_statutory` against); the API's `houseRule` mark wins when sent. */
export const HOUSE_RULE_IDS: readonly string[] = HOUSE_RULE_ITEMS;
export const isHouseRule = (item: { id: string; houseRule?: boolean | undefined }) =>
  item.houseRule ?? isHouseRuleItem(item.id);

/** 07-S §8: the proforma draft's title. */
export const proformaDraftTitle = (clientName: string) => `Draft proforma for ${clientName}`;
/** 07-S §8: the issued proforma's locked banner. */
export const proformaLockedLine = (date: string, name: string) =>
  `Issued ${date} by ${name}. This proforma is locked. If it's wrong and it hasn't been emailed, opened by the client, paid or converted, void it and issue a new one.`;

/** 07-S §4 "Source" options, by the API's codes. */
export const FX_SOURCE_LABELS: Record<FxSourceCode, string> = {
  FBIL: "FBIL reference rate",
  RBI: "RBI reference rate",
  OTHER: "Other (describe)",
};

/** 07-S §3, one label per checklist item, by core's ids (`INVOICE_CHECKLIST`), in its order. */
export const CHECKLIST_LABELS: Record<string, string> = {
  companyNames: "Company legal name and trade name",
  companyAddressGstin: "Company address and GSTIN",
  invoiceNumberDate: "Invoice number and date",
  clientNameAddress: "Client name and address",
  clientGstin: "Client GSTIN (registered clients)",
  placeOfSupply: "Place of supply (state and code)",
  lineDetails: "Line description, SAC, quantity, unit and rate",
  discountTaxable: "Discount and taxable value",
  taxPerType: "Tax rate and amount per tax type",
  totalsWords: "Totals in figures and words",
  reverseCharge: "Reverse-charge statement",
  signatory: "Authorised signatory",
  originalForRecipient: "ORIGINAL FOR RECIPIENT",
  exportDeclaration: "Export declaration (exports)",
  countryOfDestination: "Country of destination (exports)",
  bankDetails: "Bank details",
  paymentLink: "Payment link or QR (off until online payment exists)",
  unregisteredHighValue: "Name, address and state for unregistered clients at ₹50,000 or more",
};

/** "File next year's LUT (FY {next fy}) before 1 April, then save its ARN here." (07-S §5, from 1 March.) */
export const lutDueBanner = (nextFyLabel: string) =>
  `File next year's LUT (FY ${nextFyLabel}) before 1 April, then save its ARN here.`;
/** 07-S §8: the running year has no letter. */
export const lutMissingBanner = (fyLabel: string) =>
  `There's no LUT for FY ${fyLabel}. Export invoices without IGST are blocked until you save its ARN.`;
/** 07-S §1: "LUT ARN: {arn} (FY {fy})". */
export const lutLine = (arn: string, fyLabel: string) => `LUT ARN: ${arn} (FY ${fyLabel})`;
/** 07-S §4 body (Researched 2026-10-28, Rule 34(2) CGST, 08-C RA-21). */
export const fxBody = (issueDate: string) =>
  `Enter the RBI or FBIL reference rate for ${issueDate}. If none was published that day, use the last published rate. The rate is stored with the invoice and used for its INR values in your GST return.`;
/** 07-S §1: "Exchange rate: 1 USD = ₹{rate} ({source}, {date})". */
export const fxLine = (rate: string, source: string, date: string) =>
  `Exchange rate: 1 USD = ₹${rate} (${source}, ${date})`;
/** 07-S §6: a tax invoice made from the proforma. */
export const childLine = (number: string, amount: string, date: string) =>
  `Tax invoice ${number} issued for ${amount} on ${date}.`;
/** 07-S §6: the 25-day warning (Rule 47). */
export const warn25Line = (number: string) =>
  `Proforma ${number} for delivered work has been unpaid for 25 days. Issue a tax invoice within 30 days of supply.`;
/**
 * 07-S §8: the PDF's line under the title, shown the same way on the issued invoice; §9 when it was issued with IGST although the proforma was under LUT
 * (`igstFy`: the financial year that had no LUT).
 */
export const advanceLine = (
  proformaNumber: string,
  proformaDate: string,
  receivedOn: string,
  igstFy?: string | null,
) =>
  igstFy
    ? `Against proforma ${proformaNumber} of ${proformaDate}, payment received on ${receivedOn}. Issued with IGST: no LUT was in place for FY ${igstFy}.`
    : `Against proforma ${proformaNumber} of ${proformaDate}, payment received on ${receivedOn}.`;

// ---- small rules -----------------------------------------------------------------------------------------------------------------------------------

/**
 * The admin's one FY label (rt1 review, finding 10): "2627" as people read it ("2026-27"), through core's `fyLabelOfToken`, which also refuses a
 * damaged token ("2729"). A missing or damaged token reads as `otherwise` when given (a sentence passes `UNKNOWN`, never a guessed year), else
 * as it came.
 */
export function fyLabel(token: string | null | undefined, otherwise?: string): string {
  const label = token ? fyLabelOfToken(token) : null;
  return label ?? otherwise ?? token ?? "";
}

/** A date as the admin writes it ("27 Oct 2026"), or the text as it came. */
export const day = (iso: string | null | undefined) => (iso ? (dayText(iso) ?? iso) : "");

/** The money of the M5.2 screens, through core. */
export const amount = (minor: number, currency: Currency) => moneyText(minor, currency);

/** The money received arrived in an earlier calendar month than today's (Q27: a warning, not a block). Both are ISO dates. */
export const arrivedEarlierMonth = (receivedOn: string, todayIso: string) =>
  /^\d{4}-\d{2}/.test(receivedOn) && receivedOn.slice(0, 7) < todayIso.slice(0, 7);

// ---- the exchange rate (Q7, Q24) ---------------------------------------------------------------------------------------------------------------------

/** `noRate`: the Owner states no rate was published on the invoice's day, so an earlier day's rate may be used (contract `noRateThatDay`, S §8). */
export type FxForm = { rate: string; date: string; source: FxSourceCode; note: string; noRate: boolean };
export type FxValue = {
  rate: string;
  date: string;
  source: FxSourceCode;
  sourceNote?: string;
  noRateThatDay?: boolean;
};

/** The form from what the draft holds (its `source` is the printed label: a fixed one maps back to its code, anything else is "Other"). */
export function fxFormOf(
  v: { rate: string; date: string; source: string; noRateThatDay?: boolean | undefined } | null,
  today: string,
): FxForm {
  if (!v) return { rate: "", date: today, source: "FBIL", note: "", noRate: false };
  const noRate = v.noRateThatDay === true;
  const code = (FX_SOURCE_CODES as readonly string[]).find(
    (c) => c !== "OTHER" && FX_SOURCE_LABELS[c as FxSourceCode] === v.source,
  ) as FxSourceCode | undefined;
  return code
    ? { rate: v.rate, date: v.date, source: code, note: "", noRate }
    : { rate: v.rate, date: v.date, source: "OTHER", note: v.source, noRate };
}

/** The rate as typed, checked as the API checks it (core's `parseFxRate`): the body to send, or the error per field. */
export function checkFx(
  f: FxForm,
): { ok: true; value: FxValue } | { ok: false; errors: Partial<Record<"rate" | "note", string>> } {
  const errors: Partial<Record<"rate" | "note", string>> = {};
  if (parseFxRate(f.rate.trim()) === null) errors.rate = INVT_COPY.fxError;
  if (f.source === "OTHER" && f.note.trim() === "") errors.note = INVT_COPY.fxNoteMissing;
  if (errors.rate || errors.note) return { ok: false, errors };
  return {
    ok: true,
    value: {
      rate: f.rate.trim(),
      date: f.date,
      source: f.source,
      ...(f.source === "OTHER" ? { sourceNote: f.note.trim() } : {}),
      // Sent only when it is said: the server reads a missing flag as false (contract).
      ...(f.noRate ? { noRateThatDay: true } : {}),
    },
  };
}

/** Whether the rate's day is earlier than the document's own day (both ISO): only then is "no rate was published that day" asked. */
export const rateDayEarlier = (rateDate: string, refDate: string | null | undefined) =>
  /^\d{4}-\d{2}-\d{2}$/.test(rateDate) && typeof refDate === "string" && rateDate < refDate;

// ---- the payment received against a proforma (Q9) ----------------------------------------------------------------------------------------------------

export type AdvanceForm = { amount: string; date: string; reference: string };

/** The advance dialog's checks before it is sent: an amount above zero and not above the balance, a reference. The server checks everything again. */
export function checkAdvance(
  f: AdvanceForm,
  currency: Currency,
  balanceMinor: number,
):
  | { ok: true; amountMinor: number }
  | { ok: false; errors: Partial<Record<"amount" | "reference", string>> } {
  const errors: Partial<Record<"amount" | "reference", string>> = {};
  const m = moneyFrom(f.amount, currency);
  let amountMinor = 0;
  if (!m.ok) errors.amount = m.error;
  else if (m.minor <= 0) errors.amount = INVT_COPY.amountZero;
  else if (m.minor > balanceMinor) errors.amount = INVT_COPY.exceedsBalance;
  else amountMinor = m.minor;
  if (f.reference.trim() === "") errors.reference = INVT_COPY.referenceMissing;
  if (errors.amount || errors.reference) return { ok: false, errors };
  return { ok: true, amountMinor };
}

/** The advance dialog's fields that can carry an error, one key each (review 2, 2: the rate date has its own, never "Date received"'s). */
export type AdvanceErrors = Partial<
  Record<"amount" | "date" | "reference" | "rate" | "fxDate" | "note", string>
>;

/** The fields in the order the dialog draws them, with their element ids. */
export const ADVANCE_FIELDS = [
  ["amount", "adv-amount"],
  ["date", "adv-date"],
  ["reference", "adv-ref"],
  ["rate", "adv-fx-rate"],
  ["fxDate", "adv-fx-date"],
  ["note", "adv-fx-note"],
] as const;

/** The id of the first field (in drawn order) with an error, for the focus; null when there is none. */
export function advanceFocus(errors: AdvanceErrors): string | null {
  return ADVANCE_FIELDS.find(([k]) => errors[k])?.[1] ?? null;
}

/**
 * "Date received" changed (review 2, 1): the rate is the one for the day the money came (Q9), so its date follows until the Owner picks its own
 * (`own`); an empty "Date received" leaves the rate's date as it is.
 */
export function rateDateFollows(fx: FxForm, own: boolean, received: string): FxForm {
  return own || received === "" ? fx : { ...fx, date: received };
}

/** The blockers about the rate's day (S §8): shown under the rate's date field, never in the list. */
export const RATE_DATE_CODES: readonly string[] = ["fx_date_invalid", "fx_same_day_exists"];

/** A refused advance (409 `issue_blocked`): the rate's date blocker goes under its field; the rest are listed in their own lines. */
export function splitAdvanceRefusal<B extends { code: string }>(
  blockers: readonly B[],
): { rateDate: B | null; rest: B[] } {
  return {
    rateDate: blockers.find((b) => RATE_DATE_CODES.includes(b.code)) ?? null,
    rest: blockers.filter((b) => !RATE_DATE_CODES.includes(b.code)),
  };
}

// ---- the letters of undertaking (ADM-INV-18) ---------------------------------------------------------------------------------------------------------

export type LutRow = { fy: string; arn: string; filedOn: string | null };

/** The ARN as the API stores it (spaces dropped, upper case: core's `lutEntry` transform). */
export const cleanArn = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** A letter to add, checked as the API checks it: a financial year not already listed, and an ARN of 1 to 30 letters and digits. */
export function checkLut(
  row: { fy: string; arn: string; filedOn: string },
  existing: readonly LutRow[],
): { ok: true; value: LutRow } | { ok: false; errors: Partial<Record<"fy" | "arn", string>> } {
  const errors: Partial<Record<"fy" | "arn", string>> = {};
  // The line the single-letter Tax screen used for a missing year (07-S has none of its own).
  if (!/^\d{4}$/.test(row.fy)) errors.fy = "Pick the financial year the LUT covers.";
  else if (existing.some((l) => l.fy === row.fy)) errors.fy = INVT_COPY.lutDuplicate;
  const arn = cleanArn(row.arn);
  if (!/^[A-Z0-9]{1,30}$/.test(arn)) errors.arn = INVT_COPY.lutArnMissing;
  if (errors.fy || errors.arn) return { ok: false, errors };
  return { ok: true, value: { fy: row.fy, arn, filedOn: row.filedOn || null } };
}

/** The letters newest year first (the screen's order; the stored order does not matter). */
export const lutsByYear = (luts: readonly LutRow[]) => [...luts].sort((a, b) => b.fy.localeCompare(a.fy));

// ---- the purpose code (ADM-SET-02) -------------------------------------------------------------------------------------------------------------------

/** The purpose code as the API stores it, or the field's error (core's `PURPOSE_CODE`; the API's own words, 07-S has none). */
export function checkPurposeCode(
  s: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const v = s.trim().toUpperCase();
  if (v === "") return { ok: true, value: null };
  return PURPOSE_CODE.test(v)
    ? { ok: true, value: v }
    : { ok: false, error: "A purpose code is P and four digits, like P0802." };
}
