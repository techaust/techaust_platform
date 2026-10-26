// The GST and report core: `@techaust/core/gst` (M5.5a; ADM-REP-04, ADM-REP-07, ADM-INV-17). Pure, deterministic, never throws:
// every function returns a `GstResult` (codes only). VERIFY WITH CA/LEGAL: every rule and every column is a researched default
// or a working assumption (docs/08-research-appendix/A-gst-invoicing.md).
// SPA ONLY: never import this from Worker code. It is for the admin SPA's reports (bytes: LD16). The Worker budget guard does
// not know this module yet: M5.5b adds the forbidden marker to `scripts/worker-budget.mjs`.
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
  CURRENT_REALISATION_LAYOUT,
  EDF_LAYOUTS,
  type EdfLayoutId,
  edfCsv,
  type FileLayout,
  GSTR1_LAYOUTS,
  type Gstr1LayoutId,
  gstr1Csv,
  REALISATION_LAYOUTS,
  type RealisationLayoutId,
  realisationCsv,
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
  type NoteParent,
  ok,
  type Path,
  type RecipientStatus,
  type RegisterRate,
  type RegisterRow,
  type Series,
  type StateCode,
  type SupplyType,
} from "./types.ts";
