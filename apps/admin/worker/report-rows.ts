// What the report routes send to the SPA (M5.5b, LD71, LD72, LD87; ADM-REP-04, ADM-REP-07): a register row as the gst core wants it (`RegisterApiRow`), made from one
// row of the SQL page (`@techaust/db/reports`) and nothing else. Self-contained on purpose (LD85): it imports only packages, so a later third Worker can take it.
// The gst core is SPA only (LD16, worker-budget marker), so this file has `import type` from it and nothing else: the types keep the SPA and the API in step,
// and the SQL (`RATES_SQL`, proved a twin of core's `registerRatesOf`) does the grouping: the Worker never parses `documents.computed`.
// A value that is not what core expects (a USD line without its INR view, a recipient without a GST status, a malformed note block) is passed through as it is,
// so core answers `amount_invalid` or `supply_mismatch` and the export fails whole: nothing is guessed or filled in here.
import { parseIsoDate } from "@techaust/core/dates";
import type {
  CalendarDate,
  GstDocKind,
  NoteParent,
  RegisterApiRow,
  RegisterRate,
  ReportMeta,
} from "@techaust/core/gst";
import { noteOfFromStored } from "@techaust/core/invoices";
import type { RegisterSqlRow } from "@techaust/db/reports";

type Address = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const parseJson = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** A postal address as one line: street, second line, city, state, PIN, country (the parts that exist). Empty text is null. */
export function addressLine(a: unknown): string | null {
  if (!isRecord(a)) return null;
  const x = a as Address;
  const parts = [x.line1, x.line2, x.city, x.state, x.postalCode, x.country]
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  return parts.length === 0 ? null : parts.join(", ");
}

/**
 * The rates JSON of a row, sorted here by SAC (none first, code-unit order) and then rate, the order of core's `registerRatesOf` (L2: the SQL's own order is not
 * relied on). Text that is not a JSON array gives no rates at all, and core refuses a row without rates (`rates_empty`): nothing is made up.
 */
function ratesOf(text: string | null): readonly RegisterRate[] {
  const v = parseJson(text);
  if (!Array.isArray(v)) return [];
  const key = (r: RegisterRate): string => (typeof r?.sac === "string" ? r.sac : "");
  return [...(v as RegisterRate[])].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return x < y ? -1 : x > y ? 1 : a.rateBp - b.rateBp;
  });
}

/**
 * The parent block of a note: `header_extras.noteOf.parent` (LD53) as core's `NoteParent`. Its INR total is the parent's own when the parent was a USD
 * document, else (an INR parent) its total. A block that does not read back is null (core: `parent_missing`).
 */
function noteParentOf(text: string | null, currency: string): NoteParent | null {
  const note = noteOfFromStored(parseJson(text));
  if (note === null) return null;
  const p = note.parent;
  const issueDate = parseIsoDate(p.issueDate);
  if (issueDate === null) return null;
  return {
    number: p.number,
    issueDate,
    supplyType: p.supplyType as NoteParent["supplyType"],
    recipientStatus: p.recipientStatus,
    placeOfSupplyCode: p.placeOfSupplyCode as NoteParent["placeOfSupplyCode"],
    totalInrMinor: (p.totalInrMinor ?? (currency === "INR" ? p.totalMinor : null)) as number,
  };
}

/** One SQL row as a `RegisterApiRow` (LD72, LD87): the recipient is the frozen snapshot as issued (an anonymised client's issued documents keep it, Q61). */
export function registerRowOf(r: RegisterSqlRow): RegisterApiRow {
  const issueDate = parseIsoDate(r.issue_date) as CalendarDate;
  const note = r.type === "credit_note" || r.type === "debit_note";
  return {
    id: r.id,
    kind: r.type as GstDocKind,
    voided: r.voided_at !== null,
    number: r.number_display,
    issueDate,
    currency: r.currency as RegisterApiRow["currency"],
    totalMinor: r.total_minor,
    totalInrMinor: r.total_inr_minor as number,
    roundOffInrMinor: r.round_off_inr_minor as number,
    fxRateMicros: r.fx_rate_micros,
    supplyType: r.supply_type as RegisterApiRow["supplyType"],
    placeOfSupplyCode: r.place_of_supply_code as RegisterApiRow["placeOfSupplyCode"],
    // No reverse-charge document type exists (LD87; Researched 2026-10-28, Rules 46(p), 50 and 51 CGST Rules (08-C RA-26))
    reverseCharge: false,
    recipient: {
      status: r.r_status as RegisterApiRow["recipient"]["status"],
      gstin: r.r_gstin,
      // The frozen snapshot's legal name (`clients.legal_name` is NOT NULL, so every snapshot has it; SQL falls back to the same snapshot's display name). A snapshot
      // with neither is blank here, never a name taken from somewhere else (L3).
      name: r.r_name ?? "",
      address: addressLine(parseJson(r.r_address)),
      stateCode: r.r_state as RegisterApiRow["recipient"]["stateCode"],
      countryCode: r.r_country,
    },
    rates: ratesOf(r.rates),
    noteOf: note ? noteParentOf(r.note_of, r.currency) : null,
    outstandingMinor: r.balance_minor,
    purposeCode: r.purpose_code,
    // rt1 T3: the credit note's IMS answer as stored (null for every other document); only the 3B helper reads it.
    imsStatus: r.ims_status,
    // M6.1 (Q60, L14): the latest AD-bank extension of an export invoice's FEMA period (null when none): the realisation and EDF rows use it.
    extendedTo: r.extended_to === null || r.extended_to === undefined ? null : parseIsoDate(r.extended_to),
    series: r.series as RegisterApiRow["series"],
    fy: r.fy,
    seq: r.seq,
    clientId: r.client_id,
    clientCode: r.client_code,
  };
}

/** `ReportMeta` from what the page route knows (the realisation values are the reader's: `femaMonthsForeign` is the settings' `warnMonths`, and so on). */
export function metaOf(
  today: CalendarDate,
  supplierStateCode: string,
  b2clThresholdInrMinor: number,
  rules: { femaMonthsForeign: number; femaMonthsInr: number; gstMonths: number; gstExtraDays: number },
): ReportMeta {
  return {
    today,
    supplierStateCode: supplierStateCode as ReportMeta["supplierStateCode"],
    b2clThresholdInrMinor,
    realisation: {
      warnMonths: rules.femaMonthsForeign,
      inrMonths: rules.femaMonthsInr,
      escalateMonths: rules.gstMonths,
      escalateExtraDays: rules.gstExtraDays,
    },
  };
}
