// The tax engine: `@techaust/core/tax` (M4.2; ADM-INV-05, docs/05 §10). A subpath export, not re-exported from the package
// root: it is only needed where documents are computed, and its `TaxWarning` would clash with `clients.ts`'s.
// Pure and deterministic; every function returns a `TaxResult` and never throws. VERIFY WITH CA/LEGAL: every rule is a
// researched default (docs/08-research-appendix/A-gst-invoicing.md), and the settings feed it as an input.
export { type CreditedLine, type CreditedSoFar, type CreditRequest, creditNote } from "./credit.ts";
export { computeDocument, type DocumentInput } from "./document.ts";
export {
  groupsOf,
  type InclusiveGroup,
  type InclusiveSplit,
  MAX_GROUPS,
  splitInclusive,
} from "./inclusive.ts";
export { effectiveRateBp, headsFor, MAX_LINES } from "./lines.ts";
export { computeSchedule, MAX_SCHEDULE_STEPS } from "./schedule.ts";
export {
  determineSupply,
  lutsOf,
  type PlaceOfSupplyOverride,
  type SupplyOptions,
  supplyIssues,
  usableDate,
} from "./supply.ts";
export { ROUND_OFF_BAND, roundingUnit } from "./totals.ts";
export {
  type CalendarDate,
  type ComputedDocument,
  type ComputedInr,
  type ComputedLine,
  type ComputedLineInr,
  type Discount,
  type ExportMode,
  type Fx,
  type LineInput,
  type Path,
  type ScheduleInstalment,
  type ScheduleStep,
  SUPPLY_TYPES,
  type SummaryRow,
  type Supply,
  type SupplyType,
  type TaxContext,
  type TaxErrorCode,
  type TaxIssue,
  type TaxResult,
  type TaxWarning,
  type TaxWarningCode,
} from "./types.ts";
