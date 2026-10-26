// The GSTR-1 sections of one return period, built from the register (M5.5a; ADM-REP-04). Pure and deterministic; every rule is
// VERIFY WITH CA/LEGAL (docs/08-research-appendix/A-gst-invoicing.md §4, §8, §10, §12). A bad row fails the whole result:
// nothing is skipped quietly. Credit notes reduce the sums and debit notes add to them; rows of cdnr and cdnur carry the
// note's own (positive) amounts with a note type, as the Offline Tool does, while b2cs and hsn rows are signed.
import { type CalendarDate, isValidDate } from "../dates.ts";
import { isStateCode, type StateCode } from "../gstin.ts";
import { classifyInvoice, classifyNote, type NoteSection, type UrType } from "./classify.ts";
import { gstPeriod, inPeriod, type PeriodRange } from "./period.ts";
import {
  compareDates,
  compareText,
  fail,
  GST_DOC_KINDS,
  type GstIssue,
  type GstPeriod,
  type GstResult,
  type Gstr1Params,
  type GstWarning,
  guard,
  isInt,
  isIntBetween,
  isNonNegInt,
  issue,
  num,
  ok,
  type RegisterRate,
  type RegisterRow,
  signOf,
  uniqueIssues,
  warn,
} from "./types.ts";

/** The most characters of a document number the GST portal accepts (Rule 46(b)). */
const MAX_NUMBER_LENGTH = 16;

export type ExportType = "WOPAY" | "WPAY";

/** One row of b2b, b2cl or exp: one per (document, rate), the document's value repeated. */
export type InvoiceRow = {
  readonly docId: string;
  readonly section: "b2b" | "b2cl" | "exp";
  readonly number: string;
  readonly date: CalendarDate;
  readonly valueInrMinor: number;
  readonly posCode: StateCode | "96";
  readonly reverseCharge: boolean;
  readonly gstin: string | null;
  readonly receiverName: string;
  readonly exportType: ExportType | null;
  readonly rateBp: number;
  readonly taxableMinor: number;
  readonly igstMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
};

/** One row of cdnr or cdnur: one per (note, rate); amounts are the note's own, the note type says credit or debit. */
export type NoteRow = {
  readonly docId: string;
  readonly section: "cdnr" | "cdnur";
  readonly number: string;
  readonly date: CalendarDate;
  readonly noteType: "C" | "D";
  readonly valueInrMinor: number;
  readonly posCode: StateCode | "96";
  readonly reverseCharge: boolean;
  readonly gstin: string | null;
  readonly receiverName: string;
  readonly urType: UrType | null;
  readonly rateBp: number;
  readonly taxableMinor: number;
  readonly igstMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
};

/** One row of b2cs: per (place of supply, rate), the signed sums of invoices and of the notes netted in. */
export type B2csRow = {
  readonly posCode: StateCode | "96";
  readonly rateBp: number;
  readonly taxableMinor: number;
  readonly igstMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
};

/** One HSN row: per (SAC, rate), signed. `totalValueMinor` = taxable + IGST + CGST + SGST. */
export type HsnRow = {
  readonly sac: string;
  readonly description: string;
  readonly rateBp: number;
  readonly taxableMinor: number;
  readonly igstMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
  readonly totalValueMinor: number;
};

/** Signed sums. `valueMinor` = taxable + IGST + CGST + SGST; `documentValueMinor` = the documents' INR totals (round-off included, each once). */
export type SectionTotals = {
  readonly documents: number;
  readonly taxableMinor: number;
  readonly igstMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
  readonly valueMinor: number;
  readonly documentValueMinor: number;
};

export type Gstr1Totals = {
  readonly b2b: SectionTotals;
  readonly b2cl: SectionTotals;
  readonly b2cs: SectionTotals;
  readonly exp: SectionTotals;
  readonly cdnr: SectionTotals;
  readonly cdnur: SectionTotals;
  readonly hsnB2b: SectionTotals;
  readonly hsnB2c: SectionTotals;
  /** The signed sum of every reported document: the figure that must match the invoices (ADM-REP-04). */
  readonly overall: SectionTotals;
};

export type Gstr1Sections = {
  readonly period: GstPeriod;
  readonly range: PeriodRange;
  readonly supplierStateCode: StateCode;
  readonly b2b: readonly InvoiceRow[];
  readonly b2cl: readonly InvoiceRow[];
  readonly b2cs: readonly B2csRow[];
  readonly exp: readonly InvoiceRow[];
  readonly cdnr: readonly NoteRow[];
  readonly cdnur: readonly NoteRow[];
  readonly hsnB2b: readonly HsnRow[];
  readonly hsnB2c: readonly HsnRow[];
  readonly totals: Gstr1Totals;
};

type Sum = { taxable: bigint; igst: bigint; cgst: bigint; sgst: bigint };
type Amounts = Pick<RegisterRate, "taxableMinor" | "igstMinor" | "cgstMinor" | "sgstMinor">;
const zero = (): Sum => ({ taxable: 0n, igst: 0n, cgst: 0n, sgst: 0n });
const accumulate = (into: Sum, r: Amounts, sign: bigint): void => {
  into.taxable += sign * BigInt(r.taxableMinor);
  into.igst += sign * BigInt(r.igstMinor);
  into.cgst += sign * BigInt(r.cgstMinor);
  into.sgst += sign * BigInt(r.sgstMinor);
};
const totalOf = (s: Sum): bigint => s.taxable + s.igst + s.cgst + s.sgst;

type Counter = { documents: number; sum: Sum; documentValue: bigint };
const counter = (): Counter => ({ documents: 0, sum: zero(), documentValue: 0n });
const finish = (c: Counter): SectionTotals => ({
  documents: c.documents,
  taxableMinor: num(c.sum.taxable),
  igstMinor: num(c.sum.igst),
  cgstMinor: num(c.sum.cgst),
  sgstMinor: num(c.sum.sgst),
  valueMinor: num(totalOf(c.sum)),
  documentValueMinor: num(c.documentValue),
});

const rateFieldsOk = (r: RegisterRate): boolean =>
  isNonNegInt(r.taxableMinor) &&
  isNonNegInt(r.igstMinor) &&
  isNonNegInt(r.cgstMinor) &&
  isNonNegInt(r.sgstMinor);

/** The checks on one row that decides whether it can be reported (rule 7). */
function rowIssues(row: RegisterRow): GstIssue[] {
  const out: GstIssue[] = [];
  const add = (code: GstIssue["code"]) => out.push({ code, path: [row.id] });
  if (typeof row.number !== "string" || row.number.length < 1 || row.number.length > MAX_NUMBER_LENGTH) {
    add("number_invalid");
  }
  const amountsOk =
    isNonNegInt(row.totalMinor) &&
    isNonNegInt(row.totalInrMinor) &&
    isInt(row.roundOffInrMinor) &&
    row.rates.every(rateFieldsOk);
  if (!amountsOk) add("amount_invalid");
  if (row.rates.length === 0) add("rates_empty");
  if (row.rates.some((r) => !isIntBetween(r.rateBp, 0, 10_000))) add("rate_invalid");
  if (amountsOk && row.rates.length > 0) {
    let total = BigInt(row.roundOffInrMinor);
    for (const r of row.rates) {
      total += BigInt(r.taxableMinor) + BigInt(r.igstMinor) + BigInt(r.cgstMinor) + BigInt(r.sgstMinor);
    }
    if (total !== BigInt(row.totalInrMinor)) add("totals_mismatch");
  }
  const posOk = row.placeOfSupplyCode === "96" || isStateCode(row.placeOfSupplyCode);
  if (!posOk) add("pos_invalid");
  else if (
    (row.supplyType === "export_lut" || row.supplyType === "export_igst") !==
    (row.placeOfSupplyCode === "96")
  ) {
    add("export_pos_mismatch");
  }
  return out;
}

type Item = {
  readonly row: RegisterRow;
  readonly section: "b2b" | "b2cl" | "b2cs" | "exp" | NoteSection;
  readonly urType: UrType | null;
  /** The rates, one per rate in basis points (SACs merged), ascending. */
  readonly byRate: readonly Omit<RegisterRate, "sac">[];
};

const mergeByRate = (rates: readonly RegisterRate[]): Omit<RegisterRate, "sac">[] => {
  const map = new Map<number, Sum>();
  for (const r of rates) {
    let s = map.get(r.rateBp);
    if (s === undefined) {
      s = zero();
      map.set(r.rateBp, s);
    }
    accumulate(s, r, 1n);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rateBp, s]) => ({
      rateBp,
      taxableMinor: num(s.taxable),
      igstMinor: num(s.igst),
      cgstMinor: num(s.cgst),
      sgstMinor: num(s.sgst),
    }));
};

const byDateThenNumber = (a: Item, b: Item): number =>
  compareDates(a.row.issueDate, b.row.issueDate) || compareText(a.row.number, b.row.number);

/**
 * The sections of one return period. Only the four kinds, not voided, issued in the period are reported (a voided document
 * shows up in Table 13 as cancelled, through `docsRows`). Any problem in a reported row fails the whole result.
 */
export function gstr1Sections(
  register: readonly RegisterRow[],
  period: GstPeriod,
  params: Gstr1Params,
): GstResult<Gstr1Sections> {
  return guard(() => {
    const issues: GstIssue[] = [];
    const range = gstPeriod(period);
    if (!range.ok) issues.push(...range.errors);
    if (!isNonNegInt(params.b2clThresholdInrMinor)) {
      issues.push(issue("threshold_invalid", "params", "b2clThresholdInrMinor"));
    }
    if (!range.ok || issues.length > 0) return fail(uniqueIssues(issues));
    const threshold = params.b2clThresholdInrMinor;

    // Every row: a reportable kind, a real date, no duplicate.
    const ids = new Set<string>();
    const numbers = new Set<string>();
    for (const row of register) {
      const at = [row.id];
      if (!GST_DOC_KINDS.includes(row.kind)) issues.push({ code: "kind_not_reportable", path: at });
      if (!isValidDate(row.issueDate)) issues.push({ code: "date_invalid", path: at });
      const key = `${row.kind}|${row.number}`;
      if (ids.has(row.id) || numbers.has(key)) issues.push({ code: "duplicate_row", path: at });
      ids.add(row.id);
      numbers.add(key);
    }
    if (issues.length > 0) return fail(uniqueIssues(issues));

    const reported = register.filter((r) => !r.voided && inPeriod(r.issueDate, range.value));
    const items: Item[] = [];
    for (const row of reported) {
      const found = rowIssues(row);
      const at = [row.id];
      if (row.rates.some((r) => r.sac === null)) found.push({ code: "sac_missing", path: at });
      let section: Item["section"] = "b2cs";
      let urType: UrType | null = null;
      if (row.kind === "tax_invoice" || row.kind === "export_invoice") {
        const c = classifyInvoice(
          {
            supplyType: row.supplyType,
            recipientStatus: row.recipient.status,
            gstin: row.recipient.gstin,
            totalInrMinor: row.totalInrMinor,
          },
          threshold,
          at,
        );
        if (c.ok) section = c.value;
        else found.push(...c.errors);
      } else {
        const c = classifyNote({ gstin: row.recipient.gstin, noteOf: row.noteOf }, threshold, at);
        if (c.ok) {
          section = c.value.section;
          urType = c.value.urType;
        } else found.push(...c.errors);
      }
      issues.push(...found);
      if (found.length === 0) items.push({ row, section, urType, byRate: mergeByRate(row.rates) });
    }
    if (issues.length > 0) return fail(uniqueIssues(issues));

    items.sort(byDateThenNumber);
    const warnings: GstWarning[] = [];
    const out = buildTables(items, params, warnings);
    return ok(
      {
        period,
        range: range.value,
        supplierStateCode: params.supplierStateCode,
        ...out.tables,
        totals: out.totals,
      },
      warnings,
    );
  });
}

type Tables = Pick<Gstr1Sections, "b2b" | "b2cl" | "b2cs" | "exp" | "cdnr" | "cdnur" | "hsnB2b" | "hsnB2c">;

function buildTables(
  items: readonly Item[],
  params: Gstr1Params,
  warnings: GstWarning[],
): { tables: Tables; totals: Gstr1Totals } {
  const b2b: InvoiceRow[] = [];
  const b2cl: InvoiceRow[] = [];
  const exp: InvoiceRow[] = [];
  const cdnr: NoteRow[] = [];
  const cdnur: NoteRow[] = [];
  const b2csMap = new Map<string, { posCode: StateCode | "96"; rateBp: number; sum: Sum }>();
  type HsnEntry = { sac: string; rateBp: number; sum: Sum };
  const hsnMaps = { hsnB2b: new Map<string, HsnEntry>(), hsnB2c: new Map<string, HsnEntry>() };
  const counters = {
    b2b: counter(),
    b2cl: counter(),
    b2cs: counter(),
    exp: counter(),
    cdnr: counter(),
    cdnur: counter(),
    hsnB2b: counter(),
    hsnB2c: counter(),
    overall: counter(),
  };

  for (const item of items) {
    const { row, section } = item;
    const sign = signOf(row.kind);
    const docRows = item.byRate.map((r) => ({
      docId: row.id,
      number: row.number,
      date: row.issueDate,
      valueInrMinor: row.totalInrMinor,
      posCode: row.placeOfSupplyCode,
      reverseCharge: row.reverseCharge,
      gstin: row.recipient.gstin,
      receiverName: row.recipient.name,
      rateBp: r.rateBp,
      taxableMinor: r.taxableMinor,
      igstMinor: r.igstMinor,
      cgstMinor: r.cgstMinor,
      sgstMinor: r.sgstMinor,
    }));
    if (section === "b2b" || section === "b2cl" || section === "exp") {
      const exportType: ExportType | null =
        section === "exp" ? (row.supplyType === "export_lut" ? "WOPAY" : "WPAY") : null;
      const target = section === "b2b" ? b2b : section === "b2cl" ? b2cl : exp;
      for (const d of docRows) target.push({ ...d, section, exportType });
    } else if (section === "cdnr" || section === "cdnur") {
      const target = section === "cdnr" ? cdnr : cdnur;
      const noteType = row.kind === "credit_note" ? "C" : "D";
      for (const d of docRows) target.push({ ...d, section, noteType, urType: item.urType });
    } else {
      for (const r of item.byRate) {
        const key = `${row.placeOfSupplyCode}|${r.rateBp}`;
        let entry = b2csMap.get(key);
        if (entry === undefined) {
          entry = { posCode: row.placeOfSupplyCode, rateBp: r.rateBp, sum: zero() };
          b2csMap.set(key, entry);
        }
        accumulate(entry.sum, r, sign);
      }
    }

    // HSN: B2B invoices and CDNR notes in one table, everything else in the other.
    const hsnTable = section === "b2b" || section === "cdnr" ? "hsnB2b" : "hsnB2c";
    for (const r of row.rates) {
      const key = `${r.sac as string}|${r.rateBp}`;
      let entry = hsnMaps[hsnTable].get(key);
      if (entry === undefined) {
        entry = { sac: r.sac as string, rateBp: r.rateBp, sum: zero() };
        hsnMaps[hsnTable].set(key, entry);
      }
      accumulate(entry.sum, r, sign);
    }

    // Totals: the document once in its section, in its HSN table and overall.
    for (const c of [counters[section], counters[hsnTable], counters.overall]) {
      c.documents += 1;
      c.documentValue += sign * BigInt(row.totalInrMinor);
      for (const r of item.byRate) accumulate(c.sum, r, sign);
    }
  }

  const b2cs = [...b2csMap.values()]
    .sort((a, b) => compareText(a.posCode, b.posCode) || a.rateBp - b.rateBp)
    .map(
      ({ posCode, rateBp, sum }): B2csRow => ({
        posCode,
        rateBp,
        taxableMinor: num(sum.taxable),
        igstMinor: num(sum.igst),
        cgstMinor: num(sum.cgst),
        sgstMinor: num(sum.sgst),
      }),
    );
  b2cs.forEach((r, i) => {
    if (r.taxableMinor < 0) warnings.push(warn("b2cs_negative_net", "b2cs", i));
  });

  const missing = new Set<string>();
  const hsnRows = (table: "hsnB2b" | "hsnB2c"): HsnRow[] =>
    [...hsnMaps[table].values()]
      .sort((a, b) => compareText(a.sac, b.sac) || a.rateBp - b.rateBp)
      .map(({ sac, rateBp, sum }): HsnRow => {
        const known = Object.hasOwn(params.sacDescriptions, sac);
        if (!known && !missing.has(sac)) {
          missing.add(sac);
          warnings.push(warn("hsn_description_missing", "hsn", sac));
        }
        return {
          sac,
          description: known ? (params.sacDescriptions[sac] as string) : "",
          rateBp,
          taxableMinor: num(sum.taxable),
          igstMinor: num(sum.igst),
          cgstMinor: num(sum.cgst),
          sgstMinor: num(sum.sgst),
          totalValueMinor: num(totalOf(sum)),
        };
      });

  const hsnB2b = hsnRows("hsnB2b");
  const hsnB2c = hsnRows("hsnB2c");
  return {
    tables: { b2b, b2cl, b2cs, exp, cdnr, cdnur, hsnB2b, hsnB2c },
    totals: {
      b2b: finish(counters.b2b),
      b2cl: finish(counters.b2cl),
      b2cs: finish(counters.b2cs),
      exp: finish(counters.exp),
      cdnr: finish(counters.cdnr),
      cdnur: finish(counters.cdnur),
      hsnB2b: finish(counters.hsnB2b),
      hsnB2c: finish(counters.hsnB2c),
      overall: finish(counters.overall),
    },
  };
}
