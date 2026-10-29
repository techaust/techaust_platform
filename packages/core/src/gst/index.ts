// The GST and report core: `@techaust/core/gst` (M5.5a; ADM-REP-04, ADM-REP-07, ADM-INV-17). Pure, deterministic, never throws:
// every function returns a `GstResult` (codes only). Researched 2026-10-28, GSTN advisories of June 2025 (08-C RA-23): every rule and every column is a researched default
// or a working assumption (docs/08-research-appendix/A-gst-invoicing.md).
// SPA ONLY: never import this from Worker code. It is for the admin SPA's reports (bytes: LD16). `scripts/worker-budget.mjs` fails
// a Worker bundle that contains this module (the `GST_CORE` marker), and a source test fails a value import of it from any Worker
// or package source (`import type` is allowed).
export {
  type ClassifyInput,
  classifyInvoice,
  classifyNote,
  DEFAULT_B2CL_THRESHOLD_INR_MINOR,
  type InvoiceSection,
  type NoteClass,
  type NoteSection,
  type UrType,
} from "./classify.ts";
export { type Cell, type CsvOptions, cell, defuse, field, writeCsv } from "./csv.ts";
export { type DocsRow, docsRows, type GstSeries, NATURE_OF_DOCUMENT } from "./docs.ts";
export { docsIssuedInputs, issuedRowsOf } from "./docs-issued.ts";
export {
  EDF_DAYS_AFTER_MONTH,
  type EdfMonth,
  type EdfOptions,
  type EdfRow,
  edfMonth,
  edfRows,
} from "./edf.ts";
export { formatAmount, formatCount, formatDate, formatMicros, formatRate } from "./format.ts";
export {
  type Column,
  type CsvFile,
  CURRENT_EDF_LAYOUT,
  CURRENT_GSTR1_LAYOUT,
  CURRENT_GSTR3B_LAYOUT,
  CURRENT_OUTPUT_TAX_LAYOUT,
  CURRENT_REALISATION_LAYOUT,
  CURRENT_SALES_REGISTER_LAYOUT,
  EDF_LAYOUTS,
  type EdfLayoutId,
  edfCsv,
  type FileLayout,
  GSTR1_LAYOUTS,
  GSTR3B_LAYOUTS,
  type Gstr1LayoutId,
  type Gstr3bLayoutId,
  gstr1Csv,
  gstr3bCsv,
  OUTPUT_TAX_LAYOUTS,
  type OutputTaxLayoutId,
  outputTaxCsv,
  REALISATION_LAYOUTS,
  type RealisationLayoutId,
  realisationCsv,
  SALES_REGISTER_LAYOUTS,
  type SalesRegisterLayoutId,
  salesRegisterCsv,
} from "./layouts.ts";
export { addMonthsClamped, gstPeriod, inPeriod, lastDayOfMonth, type PeriodRange } from "./period.ts";
export { registerRatesOf } from "./rates.ts";
export {
  DEFAULT_REALISATION_RULES,
  type RealisationDates,
  type RealisationInput,
  type RealisationRow,
  type RealisationRules,
  type RealisationSettings,
  type RealisationStage,
  type RealisationStatus,
  realisationDates,
  realisationRows,
  realisationRulesOf,
  realisationStatus,
  stageOf,
} from "./realisation.ts";
export {
  OUTPUT_TAX_BUCKETS,
  type OutputTaxBucket,
  type OutputTaxRow,
  outputTaxRows,
  type RegisterStatus,
  type SalesRegisterRow,
  salesRegisterRows,
} from "./registers.ts";
export { SAC_DESCRIPTIONS } from "./sac.ts";
export {
  type B2csRow,
  type ExportType,
  type Gstr1Sections,
  type Gstr1Totals,
  gstr1Sections,
  type HsnRow,
  type InvoiceRow,
  type NoteRow,
  type SectionTotals,
} from "./sections.ts";
export {
  CURRENT_STATEMENT_LAYOUT,
  STATEMENT_LAYOUTS,
  type StatementCsvInput,
  type StatementCsvRow,
  type StatementLabels,
  type StatementLayoutId,
  statementCsv,
  statementCsvRows,
} from "./statement-csv.ts";
export { type Gstr3bLine, type Gstr3bSummary, type Gstr3bTable, gstr3bSummary } from "./summary.ts";
export {
  type CalendarDate,
  type Currency,
  type DocsIssuedInput,
  fail,
  GST_DOC_KINDS,
  type GstDocKind,
  type GstErrorCode,
  type GstIssue,
  type GstPeriod,
  type GstResult,
  type Gstr1Params,
  type GstWarning,
  type GstWarningCode,
  type ManualTaxEntry,
  type NoteParent,
  ok,
  type Path,
  type RecipientStatus,
  type RegisterApiRow,
  type RegisterRate,
  type RegisterRow,
  type ReportMeta,
  type Series,
  type StateCode,
  type SupplyType,
} from "./types.ts";
export { crc32, storedZip, type ZipFile } from "./zip.ts";
