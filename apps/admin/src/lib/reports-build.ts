// What the report screens make from the register rows (M5.5b, LD71, LD73, LD83, LD84): every figure and every file comes from the gst core
// (`@techaust/core/gst`, SPA only); this module only calls it in order, names what it found in 07-V's words (./reports.ts) and keeps the results
// for the screen. It is imported by the reports screens (a lazy chunk) and, through `import()`, by the statement tab's CSV button, so the gst core
// is fetched only where it is used.
import type { RegisterApiRow, ReportMeta } from "@techaust/core/gst";
import {
  CURRENT_GSTR1_LAYOUT,
  docsIssuedInputs,
  docsRows,
  type EdfRow,
  edfCsv,
  edfRows,
  formatRate,
  type GstIssue,
  type GstPeriod,
  type Gstr1Totals,
  type Gstr3bImsHeld,
  type Gstr3bLine,
  type GstWarning,
  gstr1Csv,
  gstr1Sections,
  gstr3bCsv,
  gstr3bSummary,
  issuedRowsOf,
  type ManualTaxEntry,
  NO_IMS_HELD,
  type OutputTaxRow,
  outputTaxCsv,
  outputTaxRows,
  type RealisationRow,
  type RealisationRules,
  realisationRows,
  realisationRulesOf,
  SAC_DESCRIPTIONS,
  type SectionTotals,
  salesRegisterCsv,
  salesRegisterRows,
  statementCsv,
  storedZip,
} from "@techaust/core/gst";
import { documentsIssuedSummary } from "@techaust/core/invoices";
import type { StatementEntry } from "@techaust/core/statement";
import {
  type DocRef,
  gstWarningText,
  type IssueLine,
  issueLines,
  type PeriodChoice,
  periodDates,
  statementCsvLabels,
  stateText,
} from "./reports.ts";

/** The documents of a read, by id, so a problem can name and link its document. */
export const docsByIdOf = (rows: readonly RegisterApiRow[]): Map<string, DocRef> =>
  new Map(rows.map((r) => [r.id, { id: r.id, number: r.number, kind: r.kind }]));

const gstPeriodOf = (p: PeriodChoice): GstPeriod =>
  p.kind === "month"
    ? { kind: "month", year: p.year, month: p.month }
    : { kind: "quarter", fyStartYear: p.fyStartYear, quarter: p.quarter };

/**
 * One warning in words. `blocking` (FX-4, full audit A5 1): the files are made but are not complete for filing until the person does what it says (a tax-only note's
 * tax entered by hand); `manual` is what to enter, per rate, for the screen to set out.
 */
export type WarningLine = {
  key: string;
  text: string;
  doc: DocRef | null;
  blocking: boolean;
  manual: ManualTaxEntry | null;
};

/** A warning in words, with the state and rate (B2CS) or the SAC it names; the blocking ones first. */
function warningLines(
  warnings: readonly GstWarning[],
  b2cs: readonly { posCode: string; rateBp: number }[],
  docsById: ReadonlyMap<string, DocRef>,
): WarningLine[] {
  const seen = new Set<string>();
  const out: WarningLine[] = [];
  const line = (key: string, text: string, doc: DocRef | null, w: GstWarning): WarningLine => ({
    key,
    text,
    doc,
    blocking: w.blocking === true,
    manual: w.manual ?? null,
  });
  for (const w of warnings) {
    const k = `${w.code}|${w.path.join(".")}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (w.code === "b2cs_negative_net") {
      const row = typeof w.path[1] === "number" ? b2cs[w.path[1]] : undefined;
      out.push(
        line(
          k,
          gstWarningText(w, {
            state: row ? stateText(row.posCode) : "",
            rate: row ? `${formatRate(row.rateBp)} %` : "",
          }),
          null,
          w,
        ),
      );
    } else if (w.code === "hsn_description_missing") {
      out.push(line(k, gstWarningText(w, { sac: String(w.path[1] ?? "") }), null, w));
    } else {
      const id = w.path[0];
      out.push(line(k, gstWarningText(w), typeof id === "string" ? (docsById.get(id) ?? null) : null, w));
    }
  }
  // Stable: the blocking lines first, each group in core's order.
  return [...out.filter((l) => l.blocking), ...out.filter((l) => !l.blocking)];
}

/** The section totals the panel lists, in the order of the GSTR-1 files. */
export const TOTAL_KEYS = [
  "b2b",
  "b2cl",
  "b2cs",
  "exp",
  "cdnr",
  "cdnur",
] as const satisfies readonly (keyof Gstr1Totals)[];

/**
 * Whether the two HSN/SAC tables together carry the same taxable value and heads as the period overall (07-V §2: the second line blocks the
 * download). A comparison of core's own totals, not a figure shown anywhere; core builds both from the same documents, so a difference is a bug.
 */
export function hsnMatches(t: Gstr1Totals): boolean {
  const heads = ["taxableMinor", "igstMinor", "cgstMinor", "sgstMinor"] as const;
  return heads.every((h) => BigInt(t.hsnB2b[h]) + BigInt(t.hsnB2c[h]) === BigInt(t.overall[h]));
}

export type GstExport =
  | { ok: false; problems: IssueLine[]; checked: number }
  | {
      ok: true;
      checked: number;
      totals: Gstr1Totals;
      hsnOk: boolean;
      gstr3b: readonly Gstr3bLine[];
      /**
       * rt1 T3 (Researched 2026-10-28, s.34(2) proviso CGST Act (08-C RA-04)): the credit notes to registered clients not yet accepted in IMS, NOT deducted from
       * 3.1(a) (`count` for the panel's 07-ZD line 8; amounts SIGNED as cdnr sums them, negative). The 3B file (`gstr3b-summary-v2`) prints them as its last
       * row as positive amounts not deducted (rt1 F3, lead D8); a screen that shows them shows them positive too.
       */
      imsHeld: Gstr3bImsHeld;
      table13: readonly {
        series: string;
        nature: string;
        from: string;
        to: string;
        total: number;
        cancelled: number;
      }[];
      files: { name: string; stem: string; csv: string }[];
      warnings: WarningLine[];
      /** FX-4 (full audit A5 1): false while a blocking warning is present; the panel then says `GST_COPY.doneManual`, never "No errors". */
      complete: boolean;
      /** How many blocking warnings (tax-only notes to enter by hand). */
      blocking: number;
      layout: string;
    };

/** GSTR-1 (the sections, the HSN tables, Table 13), the 3B summary and every file of a period, from one read of the register (LD71, LD73). */
export function buildGstExport(
  rows: readonly RegisterApiRow[],
  meta: ReportMeta,
  period: PeriodChoice,
): GstExport {
  const docsById = docsByIdOf(rows);
  const checked = rows.length;
  const sections = gstr1Sections(rows, gstPeriodOf(period), {
    b2clThresholdInrMinor: meta.b2clThresholdInrMinor,
    supplierStateCode: meta.supplierStateCode,
    sacDescriptions: SAC_DESCRIPTIONS,
  });
  if (!sections.ok) return { ok: false, problems: issueLines(sections.errors, docsById), checked };
  const summary = gstr3bSummary(sections.value);
  const inputs = docsIssuedInputs(documentsIssuedSummary(issuedRowsOf(rows)));
  const docs = inputs.ok ? docsRows(inputs.value) : inputs;
  const problems: GstIssue[] = [...(summary.ok ? [] : summary.errors), ...(docs.ok ? [] : docs.errors)];
  if (!summary.ok || !docs.ok) return { ok: false, problems: issueLines(problems, docsById), checked };
  const files = gstr1Csv(sections.value, docs.value);
  const b3 = gstr3bCsv(summary.value);
  if (!files.ok || !b3.ok) {
    const errs = [...(files.ok ? [] : files.errors), ...(b3.ok ? [] : b3.errors)];
    return { ok: false, problems: issueLines(errs, docsById), checked };
  }
  const warnings = warningLines([...sections.warnings, ...summary.warnings], sections.value.b2cs, docsById);
  const blocking = warnings.filter((w) => w.blocking).length;
  return {
    ok: true,
    checked,
    totals: sections.value.totals,
    hsnOk: hsnMatches(sections.value.totals),
    gstr3b: summary.value.lines,
    imsHeld: summary.value.imsHeld ?? NO_IMS_HELD,
    table13: docs.value,
    files: [
      ...files.value.map((f) => ({ name: f.name, stem: f.name.replace(/\.csv$/, ""), csv: f.csv })),
      { name: "gstr3b_summary.csv", stem: "gstr3b_summary", csv: b3.value },
    ],
    warnings,
    complete: blocking === 0,
    blocking,
    layout: CURRENT_GSTR1_LAYOUT,
  };
}

/** Every file of an export as one store-only ZIP (LD84), the files in the screen's order. */
export const zipOf = (files: readonly { name: string; csv: string }[]): Uint8Array =>
  storedZip(files.map((f) => ({ name: f.name, text: f.csv })));

/** A range is one whole month or one whole quarter (the 3B summary of the sales register is offered only then: core's 3B is per return period). */
export function wholePeriodOf(from: string, to: string): PeriodChoice | null {
  const a = /^(\d{4})-(\d{2})-01$/.exec(from);
  if (!a) return null;
  const year = Number(a[1]);
  const month = Number(a[2]);
  const m: PeriodChoice = { kind: "month", year, month };
  const isoOf = (d: { year: number; month: number; day: number }) =>
    `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  if (isoOf(periodDates(m).to) === to) return m;
  if (![4, 7, 10, 1].includes(month)) return null;
  const fyStartYear = month >= 4 ? year : year - 1;
  const quarter = (month === 4 ? 1 : month === 7 ? 2 : month === 10 ? 3 : 4) as 1 | 2 | 3 | 4;
  const q: PeriodChoice = { kind: "quarter", fyStartYear, quarter };
  return isoOf(periodDates(q).to) === to ? q : null;
}

export type SalesRegister =
  | { ok: false; problems: IssueLine[] }
  | {
      ok: true;
      count: number;
      outputTax: readonly OutputTaxRow[];
      files: { register: string; outputTax: string; gstr3b: string | null };
      /**
       * FX-4 (early check L3): when the 3B file is offered, the GST export's blocking lines (tax-only notes to enter by hand) of the same period, so the
       * panel says what the GST exports say and never "No errors" while one is present. Empty when there is no 3B file.
       */
      manual: WarningLine[];
      /** rt1 T3: with the 3B file, the credit notes held back until the client accepts them in IMS (07-ZD line 8); null when there is no 3B file. */
      imsHeld: Gstr3bImsHeld | null;
    };

/** The sales register and output tax of a range (any range inside one FY), and the 3B figures when the range is a whole return period. */
export function buildSalesRegister(
  rows: readonly RegisterApiRow[],
  meta: ReportMeta,
  from: string,
  to: string,
): SalesRegister {
  const docsById = docsByIdOf(rows);
  const parse = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return { year: y as number, month: m as number, day: d as number };
  };
  const range = { from: parse(from), to: parse(to) };
  const register = salesRegisterRows(rows, range, meta.supplierStateCode);
  const output = outputTaxRows(rows, range, meta.supplierStateCode);
  const errs = [...(register.ok ? [] : register.errors), ...(output.ok ? [] : output.errors)];
  if (!register.ok || !output.ok) return { ok: false, problems: issueLines(errs, docsById) };
  const regCsv = salesRegisterCsv(register.value);
  const outCsv = outputTaxCsv(output.value);
  if (!regCsv.ok || !outCsv.ok) {
    const e = [...(regCsv.ok ? [] : regCsv.errors), ...(outCsv.ok ? [] : outCsv.errors)];
    return { ok: false, problems: issueLines(e, docsById) };
  }
  let gstr3b: string | null = null;
  let manual: WarningLine[] = [];
  let imsHeld: Gstr3bImsHeld | null = null;
  const period = wholePeriodOf(from, to);
  if (period) {
    const g = buildGstExport(rows, meta, period);
    if (!g.ok) return { ok: false, problems: g.problems };
    gstr3b = g.files.find((f) => f.stem === "gstr3b_summary")?.csv ?? null;
    manual = g.warnings.filter((w) => w.blocking);
    imsHeld = g.imsHeld;
  }
  return {
    ok: true,
    count: rows.length,
    outputTax: output.value,
    files: { register: regCsv.value, outputTax: outCsv.value, gstr3b },
    manual,
    imsHeld,
  };
}

/**
 * The realisation rules of the stored settings: core's mapping of `tax.realisation`, then the INR period the settings now carry (`inrMonths`, LD77),
 * which core's `realisationRulesOf` does not map yet. `realisationRows` checks the rules again.
 */
export function rulesOfMeta(meta: ReportMeta): RealisationRules | null {
  const r = realisationRulesOf(meta.realisation);
  return r.ok ? { ...r.value, femaMonthsInr: meta.realisation.inrMonths } : null;
}

export type EdfList =
  | { ok: false; problems: IssueLine[] }
  | {
      ok: true;
      rows: readonly EdfRow[];
      csv: string;
      warnings: WarningLine[];
    };

export function buildEdf(
  rows: readonly RegisterApiRow[],
  meta: ReportMeta,
  year: number,
  month: number,
): EdfList {
  const docsById = docsByIdOf(rows);
  const rules = rulesOfMeta(meta);
  const out = edfRows(rows, year, month, { ...(rules ? { rules } : {}), sacDescriptions: SAC_DESCRIPTIONS });
  if (!out.ok) return { ok: false, problems: issueLines(out.errors, docsById) };
  const csv = edfCsv(out.value);
  if (!csv.ok) return { ok: false, problems: issueLines(csv.errors, docsById) };
  return { ok: true, rows: out.value, csv: csv.value, warnings: warningLines(out.warnings, [], docsById) };
}

export type RealisationList =
  | { ok: false; problems: IssueLine[] }
  | {
      ok: true;
      rows: readonly (RealisationRow & { supplyType: string; beforeFema: boolean; clientId: string })[];
    };

/** The tracker's rows as of the server's today, each with whether it predates the FEMA 2026 rules and how it was supplied (Q53: IGST, FEMA only). */
export function buildRealisation(rows: readonly RegisterApiRow[], meta: ReportMeta): RealisationList {
  const docsById = docsByIdOf(rows);
  const rules = rulesOfMeta(meta);
  if (!rules)
    return { ok: false, problems: issueLines([{ code: "rules_invalid", path: ["rules"] }], docsById) };
  const out = realisationRows(rows, meta.today, rules);
  if (!out.ok) return { ok: false, problems: issueLines(out.errors, docsById) };
  const before = new Set(out.warnings.filter((w) => w.code === "before_fema_2026").map((w) => w.path[0]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    ok: true,
    rows: out.value.map((r) => ({
      ...r,
      supplyType: byId.get(r.id)?.supplyType ?? "",
      clientId: byId.get(r.id)?.clientId ?? "",
      beforeFema: before.has(r.id),
    })),
  };
}

/** The statement as a `statement-v1` CSV with 07-V's words (core `statementCsv`); null when core refuses the data. */
export function statementCsvText(input: {
  from: string;
  to: string;
  openingMinor: number;
  closingMinor: number;
  entries: readonly StatementEntry[];
}): string | null {
  const r = statementCsv({ ...input, labels: statementCsvLabels(input.entries) });
  return r.ok ? r.value : null;
}

export type { SectionTotals };
