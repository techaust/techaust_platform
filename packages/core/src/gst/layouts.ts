// The export layouts (M5.5a; ADM-REP-04, ADM-REP-07), frozen constants. A layout version is NEVER edited: a change is a new
// version (`-v2`), and a snapshot test pins every version's headers. EVERY column below is UNVERIFIED (written from memory
// of the GSTN Offline Tool templates, VERIFY WITH CA/LEGAL): before anything is filed, the owner or the CA imports the sample
// CSVs into the current Offline Tool, and a mismatch becomes `gstr1-csv-v2`. The EDF and realisation lists are our own
// working lists, not the bank's or the portal's forms.
import type { StateCode } from "../gstin.ts";
import { type Cell, type CsvOptions, cell, writeCsv } from "./csv.ts";
import type { DocsRow } from "./docs.ts";
import type { EdfRow } from "./edf.ts";
import type { RealisationRow } from "./realisation.ts";
import type { B2csRow, Gstr1Sections, HsnRow, InvoiceRow, NoteRow } from "./sections.ts";
import { fail, type GstResult, guard, issue, ok } from "./types.ts";

export type Column<R> = { readonly header: string; readonly cell: (row: R) => Cell };
export type FileLayout<R> = { readonly stem: string; readonly columns: readonly Column<R>[] };

const col = <R>(header: string, make: (row: R) => Cell): Column<R> => Object.freeze({ header, cell: make });
const file = <R>(stem: string, columns: readonly Column<R>[]): FileLayout<R> =>
  Object.freeze({ stem, columns: Object.freeze([...columns]) });

const blank = <R>(header: string): Column<R> => col<R>(header, () => cell.blank());
const text = <R>(header: string, value: string): Column<R> => col<R>(header, () => cell.text(value));

/** "19-West Bengal". UNVERIFIED: the legacy codes 25 and 28 and the spelling of every label. */
const POS_LABELS_V1: Readonly<Record<StateCode, string>> = Object.freeze({
  "01": "01-Jammu and Kashmir",
  "02": "02-Himachal Pradesh",
  "03": "03-Punjab",
  "04": "04-Chandigarh",
  "05": "05-Uttarakhand",
  "06": "06-Haryana",
  "07": "07-Delhi",
  "08": "08-Rajasthan",
  "09": "09-Uttar Pradesh",
  "10": "10-Bihar",
  "11": "11-Sikkim",
  "12": "12-Arunachal Pradesh",
  "13": "13-Nagaland",
  "14": "14-Manipur",
  "15": "15-Mizoram",
  "16": "16-Tripura",
  "17": "17-Meghalaya",
  "18": "18-Assam",
  "19": "19-West Bengal",
  "20": "20-Jharkhand",
  "21": "21-Odisha",
  "22": "22-Chhattisgarh",
  "23": "23-Madhya Pradesh",
  "24": "24-Gujarat",
  "25": "25-Daman and Diu",
  "26": "26-Dadra and Nagar Haveli and Daman and Diu",
  "27": "27-Maharashtra",
  "28": "28-Andhra Pradesh (before 2014)",
  "29": "29-Karnataka",
  "30": "30-Goa",
  "31": "31-Lakshadweep",
  "32": "32-Kerala",
  "33": "33-Tamil Nadu",
  "34": "34-Puducherry",
  "35": "35-Andaman and Nicobar Islands",
  "36": "36-Telangana",
  "37": "37-Andhra Pradesh",
  "38": "38-Ladakh",
  "97": "97-Other Territory",
} satisfies Record<StateCode, string>);

/** The place of supply as the label, or empty for an export ("96"). */
const pos = (code: StateCode | "96"): Cell => (code === "96" ? cell.blank() : cell.text(POS_LABELS_V1[code]));
const yn = (value: boolean): Cell => cell.text(value ? "Y" : "N");

// ---- GSTR-1 (gstr1-csv-v1) ---------------------------------------------------------------------------------------------
const b2bV1 = file<InvoiceRow>("b2b", [
  col("GSTIN/UIN of Recipient", (r) => (r.gstin === null ? cell.blank() : cell.text(r.gstin))),
  col("Receiver Name", (r) => cell.text(r.receiverName)),
  col("Invoice Number", (r) => cell.text(r.number)),
  col("Invoice date", (r) => cell.date(r.date)),
  col("Invoice Value", (r) => cell.amount(r.valueInrMinor)),
  col("Place Of Supply", (r) => pos(r.posCode)),
  col("Reverse Charge", (r) => yn(r.reverseCharge)),
  blank("Applicable % of Tax Rate"),
  text("Invoice Type", "Regular B2B"),
  blank("E-Commerce GSTIN"),
  col("Rate", (r) => cell.rate(r.rateBp)),
  col("Taxable Value", (r) => cell.amount(r.taxableMinor)),
  blank("Cess Amount"),
]);

const b2clV1 = file<InvoiceRow>("b2cl", [
  col("Invoice Number", (r) => cell.text(r.number)),
  col("Invoice date", (r) => cell.date(r.date)),
  col("Invoice Value", (r) => cell.amount(r.valueInrMinor)),
  col("Place Of Supply", (r) => pos(r.posCode)),
  blank("Applicable % of Tax Rate"),
  col("Rate", (r) => cell.rate(r.rateBp)),
  col("Taxable Value", (r) => cell.amount(r.taxableMinor)),
  blank("Cess Amount"),
  blank("E-Commerce GSTIN"),
]);

const b2csV1 = file<B2csRow>("b2cs", [
  text("Type", "OE"),
  col("Place Of Supply", (r) => pos(r.posCode)),
  blank("Applicable % of Tax Rate"),
  col("Rate", (r) => cell.rate(r.rateBp)),
  col("Taxable Value", (r) => cell.amount(r.taxableMinor)),
  blank("Cess Amount"),
  blank("E-Commerce GSTIN"),
]);

const expV1 = file<InvoiceRow>("exp", [
  col("Export Type", (r) => (r.exportType === null ? cell.blank() : cell.text(r.exportType))),
  col("Invoice Number", (r) => cell.text(r.number)),
  col("Invoice date", (r) => cell.date(r.date)),
  col("Invoice Value", (r) => cell.amount(r.valueInrMinor)),
  blank("Port Code"),
  blank("Shipping Bill Number"),
  blank("Shipping Bill Date"),
  col("Rate", (r) => cell.rate(r.rateBp)),
  col("Taxable Value", (r) => cell.amount(r.taxableMinor)),
  blank("Cess Amount"),
]);

const cdnrV1 = file<NoteRow>("cdnr", [
  col("GSTIN/UIN of Recipient", (r) => (r.gstin === null ? cell.blank() : cell.text(r.gstin))),
  col("Receiver Name", (r) => cell.text(r.receiverName)),
  col("Note Number", (r) => cell.text(r.number)),
  col("Note Date", (r) => cell.date(r.date)),
  col("Note Type", (r) => cell.text(r.noteType)),
  col("Place Of Supply", (r) => pos(r.posCode)),
  col("Reverse Charge", (r) => yn(r.reverseCharge)),
  text("Note Supply Type", "Regular B2B"),
  col("Note Value", (r) => cell.amount(r.valueInrMinor)),
  blank("Applicable % of Tax Rate"),
  col("Rate", (r) => cell.rate(r.rateBp)),
  col("Taxable Value", (r) => cell.amount(r.taxableMinor)),
  blank("Cess Amount"),
]);

const cdnurV1 = file<NoteRow>("cdnur", [
  col("UR Type", (r) => (r.urType === null ? cell.blank() : cell.text(r.urType))),
  col("Note Number", (r) => cell.text(r.number)),
  col("Note Date", (r) => cell.date(r.date)),
  col("Note Type", (r) => cell.text(r.noteType)),
  col("Place Of Supply", (r) => pos(r.posCode)),
  col("Note Value", (r) => cell.amount(r.valueInrMinor)),
  blank("Applicable % of Tax Rate"),
  col("Rate", (r) => cell.rate(r.rateBp)),
  col("Taxable Value", (r) => cell.amount(r.taxableMinor)),
  blank("Cess Amount"),
]);

const hsnColumns = (stem: string): FileLayout<HsnRow> =>
  file<HsnRow>(stem, [
    col("HSN", (r) => cell.text(r.sac)),
    col("Description", (r) => cell.text(r.description)),
    text("UQC", "NA"),
    col("Total Quantity", () => cell.count(0)),
    col("Total Value", (r) => cell.amount(r.totalValueMinor)),
    col("Rate", (r) => cell.rate(r.rateBp)),
    col("Taxable Value", (r) => cell.amount(r.taxableMinor)),
    col("Integrated Tax Amount", (r) => cell.amount(r.igstMinor)),
    col("Central Tax Amount", (r) => cell.amount(r.cgstMinor)),
    col("State/UT Tax Amount", (r) => cell.amount(r.sgstMinor)),
    blank("Cess Amount"),
  ]);

const docsV1 = file<DocsRow>("docs", [
  col("Nature of Document", (r) => cell.text(r.nature)),
  col("Sr. No. From", (r) => cell.text(r.from)),
  col("Sr. No. To", (r) => cell.text(r.to)),
  col("Total Number", (r) => cell.count(r.total)),
  col("Cancelled", (r) => cell.count(r.cancelled)),
]);

export const GSTR1_LAYOUTS = Object.freeze({
  "gstr1-csv-v1": Object.freeze({
    posLabels: POS_LABELS_V1,
    b2b: b2bV1,
    b2cl: b2clV1,
    b2cs: b2csV1,
    exp: expV1,
    cdnr: cdnrV1,
    cdnur: cdnurV1,
    hsnB2b: hsnColumns("hsn_b2b"),
    hsnB2c: hsnColumns("hsn_b2c"),
    docs: docsV1,
  } as const),
} as const);
export type Gstr1LayoutId = keyof typeof GSTR1_LAYOUTS;
export const CURRENT_GSTR1_LAYOUT: Gstr1LayoutId = "gstr1-csv-v1";

// ---- EDF working list (edf-v1) -----------------------------------------------------------------------------------------
const opt = (value: string | null): Cell => (value === null ? cell.blank() : cell.text(value));

const edfV1 = file<EdfRow>("edf", [
  col("Invoice number", (r) => cell.text(r.number)),
  col("Invoice date", (r) => cell.date(r.issueDate)),
  col("Client name", (r) => cell.text(r.clientName)),
  col("Client address", (r) => opt(r.clientAddress)),
  col("Country (ISO code)", (r) => opt(r.countryCode)),
  col("Currency", (r) => cell.text(r.currency)),
  col("Invoice amount", (r) => cell.amount(r.totalMinor)),
  col("Exchange rate", (r) => (r.fxRateMicros === null ? cell.blank() : cell.micros(r.fxRateMicros))),
  col("INR value", (r) => cell.amount(r.inrValueMinor)),
  col("SAC", (r) => cell.text(r.sac)),
  col("Service description", (r) => cell.text(r.description)),
  col("Purpose code", (r) => opt(r.purposeCode)),
  // Nothing records receipts before M6.1 (FIRA): the column stays empty rather than showing a guess.
  blank("Amount realised"),
  col("FEMA realisation due", (r) => cell.date(r.femaDue)),
  col("EDF due", (r) => cell.date(r.edfDue)),
]);
export const EDF_LAYOUTS = Object.freeze({ "edf-v1": edfV1 } as const);
export type EdfLayoutId = keyof typeof EDF_LAYOUTS;
export const CURRENT_EDF_LAYOUT: EdfLayoutId = "edf-v1";

// ---- Realisation report (realisation-v1) ---------------------------------------------------------------------------------
const realisationV1 = file<RealisationRow>("realisation", [
  col("Invoice number", (r) => cell.text(r.number)),
  col("Invoice date", (r) => cell.date(r.issueDate)),
  col("Client", (r) => cell.text(r.clientName)),
  col("Currency", (r) => cell.text(r.currency)),
  col("Outstanding", (r) => cell.amount(r.outstandingMinor)),
  col("FEMA due", (r) => cell.date(r.femaDue)),
  col("GST due", (r) => cell.date(r.gstDue)),
  col("Stage", (r) => cell.text(r.stage)),
]);
export const REALISATION_LAYOUTS = Object.freeze({ "realisation-v1": realisationV1 } as const);
export type RealisationLayoutId = keyof typeof REALISATION_LAYOUTS;
export const CURRENT_REALISATION_LAYOUT: RealisationLayoutId = "realisation-v1";

// ---- Writers -------------------------------------------------------------------------------------------------------------
const render = <R>(layout: FileLayout<R>, rows: readonly R[], opts: CsvOptions): string =>
  writeCsv(
    [
      layout.columns.map((c) => cell.text(c.header)),
      ...rows.map((r) => layout.columns.map((c) => c.cell(r))),
    ],
    opts,
  );

export type CsvFile = { readonly name: string; readonly csv: string };
const named = <R>(layout: FileLayout<R>, rows: readonly R[], opts: CsvOptions): CsvFile => ({
  name: `${layout.stem}.csv`,
  csv: render(layout, rows, opts),
});

/** Every GSTR-1 file of a layout version, in the layout's order: the sections, the two HSN tables and Table 13. */
export function gstr1Csv(
  sections: Gstr1Sections,
  docs: readonly DocsRow[],
  version: Gstr1LayoutId = CURRENT_GSTR1_LAYOUT,
  opts: CsvOptions = {},
): GstResult<readonly CsvFile[]> {
  return guard(() => {
    if (!Object.hasOwn(GSTR1_LAYOUTS, version)) return fail([issue("layout_unknown", "version")]);
    const l = GSTR1_LAYOUTS[version];
    return ok([
      named(l.b2b, sections.b2b, opts),
      named(l.b2cl, sections.b2cl, opts),
      named(l.b2cs, sections.b2cs, opts),
      named(l.exp, sections.exp, opts),
      named(l.cdnr, sections.cdnr, opts),
      named(l.cdnur, sections.cdnur, opts),
      named(l.hsnB2b, sections.hsnB2b, opts),
      named(l.hsnB2c, sections.hsnB2c, opts),
      named(l.docs, docs, opts),
    ]);
  });
}

/** The EDF working list of one month. */
export function edfCsv(
  rows: readonly EdfRow[],
  version: EdfLayoutId = CURRENT_EDF_LAYOUT,
  opts: CsvOptions = {},
): GstResult<string> {
  return guard(() =>
    Object.hasOwn(EDF_LAYOUTS, version)
      ? ok(render(EDF_LAYOUTS[version], rows, opts))
      : fail([issue("layout_unknown", "version")]),
  );
}

/** The realisation report. */
export function realisationCsv(
  rows: readonly RealisationRow[],
  version: RealisationLayoutId = CURRENT_REALISATION_LAYOUT,
  opts: CsvOptions = {},
): GstResult<string> {
  return guard(() =>
    Object.hasOwn(REALISATION_LAYOUTS, version)
      ? ok(render(REALISATION_LAYOUTS[version], rows, opts))
      : fail([issue("layout_unknown", "version")]),
  );
}
