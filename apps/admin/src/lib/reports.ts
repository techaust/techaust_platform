// The words and the pure rules of the M5.5b screens (ADM-REP-04, ADM-REP-07, ADM-INV-17, ADM-CLI-04, ADM-DASH-01): the reports section (GST exports,
// sales register, EDF list, export realisation), the client's statement tab and the dashboard's finance tiles.
//
// Copy: 07-V (docs/07-content-appendix/V-m5.5b-reports-statements.md), drafted by the lead and PENDING the owner's word-for-word approval. Every line that
// comes only from 07-V is shown with the "[Placeholder] " mark (`V`), as the M5.1 to M5.4 screens mark unapproved lines; when the owner approves 07-V,
// `APPROVED_07V` turns to true and the marks go at once. A line 07-V doesn't have either is the plain mark (`P`), never invented, and listed in the run file.
// Every tax and legal line is VERIFY WITH CA/LEGAL.
//
// No value import of `@techaust/core/gst` here (the gst core is fetched only by the reports screens: ./reports-build.ts); types only. Money is formatted
// through core (`moneyText`); nothing here adds up an amount.
import { formatDate, parseIsoDate } from "@techaust/core/dates";
import type { CalendarDate, GstErrorCode, GstIssue, GstWarning, RealisationStage } from "@techaust/core/gst";
import { STATE_CODES } from "@techaust/core/gstin";
import type { StatementKind } from "@techaust/core/statement";
import { RequestError } from "../api.ts";
import type { PillTone } from "../components/display.tsx";
import { INV_PLACEHOLDER } from "./invoice-types.ts";

/** Flip to true when the owner approves 07-V word for word: every mark below disappears at once (the email package has the same switch). */
export const APPROVED_07V = false;
/** A 07-V line, marked until the owner approves it. */
export const V = (line: string): string => (APPROVED_07V ? line : `${INV_PLACEHOLDER} ${line}`);
/** A line 07-V doesn't have: the plain mark, so approving 07-V alone doesn't unmark it. Each one is listed in the run file. */
export const P = (line: string): string => `${INV_PLACEHOLDER} ${line}`;

/** "1 document" / "3 documents": the count words 07-V's lines use ({count} documents). */
const docs = (n: number) => `${n} ${n === 1 ? "document" : "documents"}`;

// ---- 07-V §1 navigation ------------------------------------------------------------------------------------------------------------------------

export type ReportKey = "gst" | "sales-register" | "edf" | "realisation";

/** The four reports, in 07-V §1's order, with their address under /reports. */
export const REPORTS: readonly { key: ReportKey; path: string; label: string }[] = [
  { key: "gst", path: "/reports/gst", label: V("GST exports") },
  { key: "sales-register", path: "/reports/sales-register", label: V("Sales register") },
  { key: "edf", path: "/reports/edf", label: V("EDF list") },
  { key: "realisation", path: "/reports/realisation", label: V("Export realisation") },
];

export const REPORTS_COPY = {
  /** 07-V §1: the sidebar group, used as the section's crumb and its sub-navigation's name. */
  group: V("Reports"),
} as const;

// ---- 07-V §2 GST exports ------------------------------------------------------------------------------------------------------------------------

export const GST_COPY = {
  title: V("GST exports"),
  lede: V(
    "Files for your GSTR-1 and GSTR-3B, made from the invoices and notes issued in the period. Check them with your CA before you file.",
  ),
  period: V("Period"),
  month: V("Month"),
  quarter: V("Quarter"),
  defaultHint: V("The last complete quarter is selected."),
  notEnded: V("This period has not ended. The files will change if you issue more documents before it ends."),
  make: V("Make files"),
  reading: (n: number) => V(`Reading issued documents: ${n} so far`),
  checking: (n: number) => V(`Checking ${n} documents`),
  done: (n: number) => V(`${n} documents checked. No errors.`),
  errorsHeading: (n: number) => V(`${n} problems to fix before these files can be made`),
  openDocument: V("Open document"),
  warningsHeading: V("Check before filing"),
  totalsHeading: V("Totals for the period"),
  hsnMatches: V("HSN/SAC summary matches the section totals."),
  hsnDiffers: V("HSN/SAC summary does not match the section totals."),
  gstr3bHeading: V("GSTR-3B figures"),
  table31a: V("3.1(a) Outward taxable supplies (other than zero-rated)"),
  table31b: V("3.1(b) Outward taxable supplies (zero-rated)"),
  table32: V("3.2 Inter-state supplies to unregistered persons, by place of supply"),
  table13Heading: V("Documents issued"),
  table13Columns: {
    series: V("Series"),
    from: V("From"),
    to: V("To"),
    total: V("Total"),
    cancelled: V("Cancelled"),
  },
  download: (section: string) => V(`Download ${section} CSV`),
  downloadAll: V("Download all (ZIP)"),
  verify: (version: string) =>
    V(
      `Made with layout ${version} for the GSTR-1 offline tool. Layouts change; check with your CA that this one is current before you upload. (VERIFY WITH CA/LEGAL)`,
    ),
  /** Not in 07-V: the column words of the totals panel and the 3B table (the GST portal's own names are kept, 07-V's rule). */
  columns: {
    section: P("Section"),
    documents: P("Documents"),
    taxable: P("Taxable value"),
    igst: "IGST",
    cgst: "CGST",
    sgst: "SGST",
    table: P("Table"),
    pos: P("Place of supply"),
  },
  /** Not in 07-V: the line when the step-up was cancelled before any page was read. */
  cancelled: P("Cancelled. No files were made."),
  /** Not in 07-V: the closing row of the totals panel (every reported document of the period, signed). */
  overall: P("Overall"),
  /** Not in 07-V: the heading of the file list. */
  filesHeading: P("Files"),
  /** Not in 07-V: a 3.2 table with no supplies to unregistered persons in other states. */
  table32Empty: P("None in this period."),
} as const;

/** 07-V §2 section names, by the GSTR-1 file's stem (`gstr1Csv`'s file names); the two HSN files share one name, the file name tells them apart. */
export const SECTION_NAMES = {
  b2b: V("B2B (registered clients)"),
  b2cl: (threshold: string) => V(`B2CL (unregistered, inter-state, above ${threshold})`),
  b2cs: V("B2CS (unregistered, other)"),
  exp: V("Exports"),
  cdnr: V("Credit and debit notes (registered)"),
  cdnur: V("Credit and debit notes (unregistered)"),
  hsn: V("HSN/SAC summary"),
  docs: V("Documents issued (Table 13)"),
} as const;

/** The section name of one GSTR-1 file by its stem ("b2b", "hsn_b2b", "docs"…); an unknown stem is the stem itself. */
export function sectionNameOf(stem: string, threshold: string): string {
  if (stem === "b2cl") return SECTION_NAMES.b2cl(threshold);
  if (stem === "hsn_b2b" || stem === "hsn_b2c") return SECTION_NAMES.hsn;
  if (Object.hasOwn(SECTION_NAMES, stem)) {
    const v = SECTION_NAMES[stem as Exclude<keyof typeof SECTION_NAMES, "b2cl">];
    return typeof v === "string" ? v : stem;
  }
  return stem;
}

/** 07-V §2.1: one message per code (28), VERIFY WITH CA/LEGAL. */
export const GST_ERRORS: Readonly<Record<GstErrorCode, string>> = {
  kind_not_reportable: V("This document type is not reported in GSTR-1."),
  gstin_missing: V("The client's GSTIN is missing."),
  gstin_invalid: V("The client's GSTIN is not valid."),
  parent_missing: V("The invoice this note is against was not found in the data."),
  parent_invalid: V("The invoice this note is against is not a reportable invoice."),
  supply_mismatch: V(
    "The supply details (type, client, place of supply or tax heads) don't agree with each other.",
  ),
  sac_missing: V("A line has no SAC code."),
  sac_invalid: V("A line's SAC code is not six digits."),
  params_invalid: V("Your state code in Settings is not valid."),
  rates_empty: V("The document has no tax lines."),
  rate_invalid: V("A line has a GST rate that isn't allowed."),
  amount_invalid: V("An amount on the document is not valid."),
  amount_out_of_range: V("An amount is too large to report."),
  totals_mismatch: V("The document's totals don't add up from its lines."),
  pos_invalid: V("The place of supply is not a valid state code."),
  export_pos_mismatch: V("An export must have place of supply 96 (other countries)."),
  number_invalid: V("The document number has characters the GST portal won't accept."),
  duplicate_row: V("This document appears twice."),
  date_invalid: V("The document date is not valid."),
  threshold_invalid: V("The B2CL threshold in Settings is not valid."),
  series_not_gst: V("This number series is not a GST document series."),
  docs_counts_invalid: V("The documents-issued counts don't add up."),
  fx_missing: V("A foreign-currency document has no exchange rate."),
  rules_invalid: V("The realisation periods in Settings are not valid."),
  period_invalid: V("Pick a period within one financial year, of at most a year."),
  rates_sum_mismatch: V("The tax lines don't add up to the document total."),
  layout_unknown: V("This file layout is not known."),
  internal_error: V("Something went wrong making this file. Try again; if it keeps happening, tell us."),
};

export const gstErrorText = (code: string): string =>
  Object.hasOwn(GST_ERRORS, code) ? GST_ERRORS[code as GstErrorCode] : GST_ERRORS.internal_error;

/** A document the screens can name and link: what the register said about it. */
export type DocRef = { id: string; number: string; kind: string };

/** Where a document of the invoice family opens in the admin. */
export const documentHref = (id: string) => `/invoices/${encodeURIComponent(id)}`;

/** One problem as the screen lists it: the document it is about (path[0] is a document id when it names one), and its 07-V message. */
export type IssueLine = { key: string; doc: DocRef | null; message: string };

/** Problems in the order core gave them, one line per (code, document); a path that names no document of the page has no link. */
export function issueLines(issues: readonly GstIssue[], docsById: ReadonlyMap<string, DocRef>): IssueLine[] {
  const seen = new Set<string>();
  const out: IssueLine[] = [];
  for (const i of issues) {
    const first = i.path[0];
    const doc = typeof first === "string" ? (docsById.get(first) ?? null) : null;
    const key = `${i.code}|${doc?.id ?? i.path.join(".")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, doc, message: gstErrorText(i.code) });
  }
  return out;
}

/** A place of supply in words: "West Bengal (19)"; "96" and an unknown code stay as the code. */
export function stateText(code: string | null): string {
  if (code === null) return "";
  return Object.hasOwn(STATE_CODES, code)
    ? `${STATE_CODES[code as keyof typeof STATE_CODES].name} (${code})`
    : code;
}

/** 07-V §2.2 warnings, with what each names (the state and rate of a B2CS row, the SAC). `rate` and `state` come pre-worded from the screen. */
export function gstWarningText(
  w: GstWarning,
  facts: { state?: string; rate?: string; sac?: string } = {},
): string {
  switch (w.code) {
    case "b2cs_negative_net":
      return V(
        `B2CS for ${facts.state ?? ""} and ${facts.rate ?? ""} comes to below zero after credit notes. Check with your CA how to report it.`,
      );
    case "hsn_description_missing":
      return V(`SAC ${facts.sac ?? ""} has no description in our list; the file leaves it blank.`);
    case "before_fema_2026":
      return V("Issued before 1 October 2026: the older realisation period may apply. Check with your CA.");
  }
}

// ---- periods (07-V §2: the last complete quarter by default; QRMP quarters of the financial year) ----------------------------------------------------

export type PeriodChoice =
  | { kind: "month"; year: number; month: number }
  | { kind: "quarter"; fyStartYear: number; quarter: 1 | 2 | 3 | 4 };

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** The quarter a month falls in, as the financial year counts them (Q1 = April to June). */
function quarterOf(year: number, month: number): { fyStartYear: number; quarter: 1 | 2 | 3 | 4 } {
  const fyStartYear = month >= 4 ? year : year - 1;
  const i = (month + 8) % 12; // April 0 … March 11
  return { fyStartYear, quarter: (Math.floor(i / 3) + 1) as 1 | 2 | 3 | 4 };
}

/** The last quarter that has fully ended on `today` (IST). */
export function lastCompleteQuarter(today: CalendarDate): PeriodChoice {
  const q = quarterOf(today.year, today.month);
  return q.quarter === 1
    ? { kind: "quarter", fyStartYear: q.fyStartYear - 1, quarter: 4 }
    : { kind: "quarter", fyStartYear: q.fyStartYear, quarter: (q.quarter - 1) as 1 | 2 | 3 };
}

/** The month before `today`'s (the EDF list's default, 07-V §4). */
export function previousMonth(today: CalendarDate): { year: number; month: number } {
  return today.month === 1
    ? { year: today.year - 1, month: 12 }
    : { year: today.year, month: today.month - 1 };
}

/** The first and last day of a period, as calendar dates (a quarter's months are the FY's: Q4 is January to March of the next year). */
export function periodDates(p: PeriodChoice): { from: CalendarDate; to: CalendarDate } {
  if (p.kind === "month")
    return { from: { year: p.year, month: p.month, day: 1 }, to: monthEnd(p.year, p.month) };
  const startMonth = 4 + (p.quarter - 1) * 3; // 4, 7, 10, 13
  const y = startMonth > 12 ? p.fyStartYear + 1 : p.fyStartYear;
  const m = startMonth > 12 ? startMonth - 12 : startMonth;
  return { from: { year: y, month: m, day: 1 }, to: monthEnd(y, m + 2) };
}

function monthEnd(year: number, month: number): CalendarDate {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: last };
}

const key = (d: CalendarDate) => d.year * 10_000 + d.month * 100 + d.day;
/** The period's last day is today or later: it has not ended. */
export const periodOpen = (p: PeriodChoice, today: CalendarDate) => key(periodDates(p).to) >= key(today);

/** "April to June 2026" and "January to March 2027", or "October 2026". */
export function periodLabel(p: PeriodChoice): string {
  if (p.kind === "month") return `${MONTH_NAMES[p.month - 1]} ${p.year}`;
  const { from, to } = periodDates(p);
  return `${MONTH_NAMES[from.month - 1]} to ${MONTH_NAMES[to.month - 1]} ${to.year}`;
}

export const monthLabel = (year: number, month: number) => `${MONTH_NAMES[month - 1]} ${year}`;

/** The choices of the picker: the months and quarters from the start of last financial year up to the current one (newest first). */
export function periodOptions(today: CalendarDate, kind: "month" | "quarter"): PeriodChoice[] {
  const cur = quarterOf(today.year, today.month);
  const out: PeriodChoice[] = [];
  if (kind === "quarter") {
    for (let fy = cur.fyStartYear; fy >= cur.fyStartYear - 1; fy--)
      for (let q = 4; q >= 1; q--) {
        const c: PeriodChoice = { kind: "quarter", fyStartYear: fy, quarter: q as 1 | 2 | 3 | 4 };
        if (key(periodDates(c).from) <= key(today)) out.push(c);
      }
    return out;
  }
  let y = today.year;
  let m = today.month;
  while (out.length < 24) {
    out.push({ kind: "month", year: y, month: m });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    if (quarterOf(y, m).fyStartYear < cur.fyStartYear - 1) break;
  }
  return out;
}

/** A period as a form value and back ("q:2026:2", "m:2026:10"). */
export const periodValue = (p: PeriodChoice) =>
  p.kind === "month" ? `m:${p.year}:${p.month}` : `q:${p.fyStartYear}:${p.quarter}`;
export function periodFromValue(v: string): PeriodChoice | null {
  const m = /^([mq]):(\d{4}):(\d{1,2})$/.exec(v);
  if (!m) return null;
  const a = Number(m[2]);
  const b = Number(m[3]);
  if (m[1] === "m") return b >= 1 && b <= 12 ? { kind: "month", year: a, month: b } : null;
  return b >= 1 && b <= 4 ? { kind: "quarter", fyStartYear: a, quarter: b as 1 | 2 | 3 | 4 } : null;
}

/** "2026-27" from the first year of a financial year (07-R's FY label). */
export const fyText = (startYear: number) => `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

/** A quarter's option text: "Q2, July to September 2026 (FY 2026-27)". */
export function periodOptionText(p: PeriodChoice): string {
  if (p.kind === "month") return periodLabel(p);
  return `Q${p.quarter}, ${periodLabel(p)} (FY ${fyText(p.fyStartYear)})`;
}

/** ISO text of a calendar date. */
export const iso = (d: CalendarDate) =>
  `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** "05 Nov 2026" from a calendar date. */
export const dateText = (d: CalendarDate) => formatDate(d);
/** "05 Nov 2026" from an ISO day; the text itself when it doesn't read. */
export const isoDayText = (s: string) => {
  const d = parseIsoDate(s);
  return d ? formatDate(d) : s;
};

// ---- 07-V §3 sales register ----------------------------------------------------------------------------------------------------------------------

export const SALES_COPY = {
  title: V("Sales register"),
  lede: V(
    "Every tax invoice, export invoice, credit note and debit note issued in the range, for your accounts.",
  ),
  from: V("From"),
  to: V("To"),
  rangeInvalid: V("Pick a period within one financial year, of at most a year."),
  downloadRegister: V("Download sales register (CSV)"),
  downloadOutput: V("Download output tax (CSV)"),
  downloadGstr3b: V("Download GSTR-3B figures (CSV)"),
  empty: V("No documents were issued in this range."),
  /** Not in 07-V: the button that reads the range, and the heading of the preview. */
  show: P("Show"),
  previewHeading: P("Output tax"),
  supply: {
    intra: V("Intra-state"),
    inter: V("Inter-state"),
    zero_rated_wopay: V("Zero-rated, without payment of tax (LUT)"),
    zero_rated_wpay: V("Zero-rated, with payment of tax"),
  },
  /** 07-V §3 output-tax headers (the file's own words). */
  columns: {
    supply: V("Supply"),
    rate: V("Rate"),
    taxable: V("Taxable value"),
    igst: "IGST",
    cgst: "CGST",
    sgst: "SGST",
  },
} as const;

/** The range rule of the register route (07-V §2.1 `period_invalid`): from ≤ to, at most 366 days, one financial year. */
export function rangeOk(from: string, to: string): boolean {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b || key(a) > key(b)) return false;
  const fy = (d: CalendarDate) => (d.month >= 4 ? d.year : d.year - 1);
  if (fy(a) !== fy(b)) return false;
  return true; // inside one FY, so never more than 366 days
}

// ---- 07-V §4 EDF list --------------------------------------------------------------------------------------------------------------------------

export const EDF_COPY = {
  title: V("EDF list"),
  lede: (due: string) =>
    V(
      `Export invoices issued in the month, for the export declaration (EDF) your bank files. Due by ${due}. (VERIFY WITH CA/LEGAL)`,
    ),
  month: V("Month"),
  columns: {
    invoice: V("Invoice"),
    date: V("Date"),
    client: V("Client"),
    country: V("Country"),
    currency: V("Currency"),
    amount: V("Amount"),
    purpose: V("Purpose code"),
    realised: V("Amount realised"),
  },
  realisedNote: V("Amount realised is left blank: payments are recorded from the payments update."),
  download: V("Download EDF list (CSV)"),
  empty: (month: string) => V(`No export invoices were issued in ${month}.`),
} as const;

// ---- 07-V §5 export realisation ------------------------------------------------------------------------------------------------------------------

export const REALISATION_COPY = {
  title: V("Export realisation"),
  lede: V(
    "Export invoices not yet fully paid, most urgent first. Money from an export must reach India within the FEMA period. (VERIFY WITH CA/LEGAL)",
  ),
  showRealised: V("Show realised"),
  columns: {
    invoice: V("Invoice"),
    client: V("Client"),
    issued: V("Issued"),
    outstanding: V("Outstanding"),
    stage: V("Stage"),
    dueBy: V("Due by"),
  },
  beforeFema: V("Issued before 1 October 2026: the older realisation period may apply."),
  igstNote: V(
    "Exports where IGST was charged show only the FEMA dates; the 12 months and 15 days GST date applies to exports under your LUT. (VERIFY WITH CA/LEGAL)",
  ),
  extensionNote: V(
    "If your bank or RBI extended a date, it can be recorded with the FIRA/FIRC uploads in the payments update.",
  ),
  empty: V("No export invoices are waiting for payment."),
} as const;

/** 07-V §5 stage labels. */
export const STAGE_LABELS: Readonly<Record<RealisationStage, string>> = {
  ok: V("On track"),
  fema_approaching: V("FEMA date in 30 days"),
  fema_overdue: V("Past the FEMA date"),
  gst_approaching: V("GST refund date in 30 days"),
  gst_overdue: V("Past the GST date"),
  realised: V("Realised"),
};

/** The reserved status colours (docs/06 §2.1, §5.5; dataviz: status never reused for anything else), always with the icon and the label. */
export const STAGE_PILLS: Readonly<
  Record<RealisationStage, { tone: PillTone; icon: "check" | "clock" | "alert"; outline?: boolean }>
> = {
  ok: { tone: "success", icon: "check", outline: true },
  fema_approaching: { tone: "warning", icon: "clock" },
  fema_overdue: { tone: "danger", icon: "alert" },
  gst_approaching: { tone: "warning", icon: "clock", outline: true },
  gst_overdue: { tone: "danger", icon: "alert", outline: true },
  realised: { tone: "muted", icon: "check" },
};

/** Most urgent first (07-V §5): past GST, past FEMA, GST in 30 days, FEMA in 30 days, on track, realised. */
export const STAGE_ORDER: readonly RealisationStage[] = [
  "gst_overdue",
  "fema_overdue",
  "gst_approaching",
  "fema_approaching",
  "ok",
  "realised",
];

export const isStage = (s: string): s is RealisationStage => (STAGE_ORDER as readonly string[]).includes(s);

/** The date a row is due by: the GST date once a GST stage is reached, the FEMA date otherwise. */
export const dueOf = (r: { stage: RealisationStage; femaDue: CalendarDate; gstDue: CalendarDate }) =>
  r.stage === "gst_overdue" || r.stage === "gst_approaching" ? r.gstDue : r.femaDue;

/** Rows by urgency, then by the date they are due by, then by number: a stable order for the list. */
export function byUrgency<
  T extends { stage: RealisationStage; femaDue: CalendarDate; gstDue: CalendarDate; number: string },
>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const s = STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
    if (s !== 0) return s;
    const d = key(dueOf(a)) - key(dueOf(b));
    if (d !== 0) return d;
    return a.number < b.number ? -1 : a.number > b.number ? 1 : 0;
  });
}

// ---- 07-V §6 statement ------------------------------------------------------------------------------------------------------------------------

export const STATEMENT_COPY = {
  tab: "Statement",
  from: V("From"),
  to: V("To"),
  defaultRange: V("This financial year to date"),
  currency: V("Currency"),
  opening: (date: string, amount: string) => V(`Opening balance on ${date}: ${amount}`),
  closing: (date: string, amount: string) => V(`Closing balance on ${date}: ${amount}`),
  /** The same two lines as a label over their figure (the amount is set below it, in tabular figures). */
  openingLabel: (date: string) => V(`Opening balance on ${date}`),
  closingLabel: (date: string) => V(`Closing balance on ${date}`),
  periodInvalid: V("Pick a start date on or before the end date."),
  anonymised: V("This client's details were erased, so no statement can be made."),
  columns: {
    date: V("Date"),
    document: V("Document"),
    details: V("Details"),
    debit: V("Debit"),
    credit: V("Credit"),
    balance: V("Balance"),
  },
  proformasNote: V(
    "Payment requests (proformas) aren't listed: a payment against one shows through its tax invoice.",
  ),
  paymentsNote: V("Only payments recorded against payment requests are listed until online payments arrive."),
  downloadCsv: V("Download CSV"),
  makePdf: V("Make PDF"),
  making: V("Making the PDF…"),
  downloadPdf: V("Download PDF"),
  empty: V("Nothing has been issued to this client in this range."),
  kept: V("Statement PDFs are kept for 30 days."),
  /** 07-V §6.1's words, used for the CSV's opening and closing rows. */
  openingWord: V("Opening balance"),
  closingWord: V("Closing balance"),
  /** Not in 07-V: the button that reads the range, the summary's sub-labels and the "more lines" button. */
  show: P("Show"),
  debits: V("Total debits"),
  credits: V("Total credits"),
  more: P("Show more"),
  /** Not in 07-V: the visually hidden caption of the table. */
  caption: P("Statement entries"),
} as const;

/** 07-V §6 entry kinds (Details). A credit note says which invoice it is against when the API gives that number; until then the plain mark. */
export function statementKindText(kind: StatementKind, againstNumber?: string | null): string {
  switch (kind) {
    case "tax_invoice":
      return V("Invoice");
    case "export_invoice":
      return V("Export invoice");
    case "debit_note":
      return V("Debit note");
    case "credit_note":
      return againstNumber ? V(`Credit note against ${againstNumber}`) : P("Credit note");
    case "receipt":
      return V("Payment received");
  }
}

/** The CSV's words (core `statementCsv` takes them from the caller, LD83). */
export const statementCsvLabels = () => ({
  opening: STATEMENT_COPY.openingWord,
  closing: STATEMENT_COPY.closingWord,
  kinds: {
    tax_invoice: statementKindText("tax_invoice"),
    export_invoice: statementKindText("export_invoice"),
    debit_note: statementKindText("debit_note"),
    credit_note: statementKindText("credit_note"),
    receipt: statementKindText("receipt"),
  } satisfies Record<StatementKind, string>,
});

/** 07-V §6 errors by the API's code; any other refusal keeps the server's own sentence. */
export const STATEMENT_ERRORS: Readonly<Record<string, string>> = {
  statement_too_long: V("This range has more than 200 entries. Pick a shorter range for the PDF."),
  statement_empty: V("Nothing to list in this range."),
  client_anonymised: V("This client's details were erased, so no statement can be made."),
  statement_failed: V("The PDF couldn't be made. Try again."),
  period_invalid: V("Pick a start date on or before the end date."),
};

export function statementErrorText(e: unknown): string {
  if (e instanceof RequestError) {
    if (Object.hasOwn(STATEMENT_ERRORS, e.code)) return STATEMENT_ERRORS[e.code] as string;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/** The report screens' answer to a refused page: 07-V's period line, the settings line, else the server's sentence. */
export function reportErrorText(e: unknown): string {
  if (e instanceof RequestError) {
    if (e.code === "period_invalid") return GST_ERRORS.period_invalid;
    if (e.code === "step_up_cancelled") return GST_COPY.cancelled;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/** While a statement PDF is being made, the tab asks again this often, and gives up waiting after this long (it says so; the bell rings anyway). */
export const STATEMENT_POLL_MS = 3_000;
export const STATEMENT_WAIT_MS = 120_000;

// ---- 07-V §7 dashboard finance tiles -----------------------------------------------------------------------------------------------------------

export const FINANCE_COPY = {
  invoiced: V("Invoiced"),
  thisMonth: V("This month"),
  thisFy: V("This financial year"),
  beforeGst: V("Before GST"),
  inrEquivalent: (amount: string) => V(`≈ ${amount} in INR`),
  outstanding: V("Outstanding"),
  overdue: V("Overdue"),
  documents: (n: number) => V(docs(n)),
  oldest: V("Oldest"),
  overdueRow: (number: string, client: string, days: number) =>
    V(`${number} · ${client} · ${days} ${days === 1 ? "day" : "days"}`),
  proformas: V("Payment requests awaiting payment"),
  open: (n: number) => V(`${n} open`),
  exports: V("Exports nearing a deadline"),
  counts: {
    femaApproaching: V("FEMA in 30 days"),
    femaOverdue: V("Past FEMA"),
    gstApproaching: V("GST in 30 days"),
    gstOverdue: V("Past GST"),
  },
  next: V("Next"),
  noneInvoiced: V("Nothing invoiced yet."),
  noneOutstanding: V("Nothing outstanding."),
  noneOverdue: V("Nothing overdue."),
  noneProformas: V("No payment requests open."),
  noneExports: V("No export deadlines coming up."),
  collectedArrives: V("Collected figures arrive with payments."),
  /** Not in 07-V: the tile's line when the stored realisation settings can't be read (the API withholds the figures, never guesses). */
  exportsSettings: P("Export deadlines can't be worked out until the Tax settings are saved again."),
  /** Not in 07-V: the link of the exports tile and of the overdue tile. */
  openRealisation: P("Open export realisation"),
  openInvoices: P("Open invoices"),
} as const;

// ---- 07-V §8 settings › tax ---------------------------------------------------------------------------------------------------------------------

export const TAX_FIELDS_COPY = {
  /** The labels are 07-V §8's field names (the hint lines name them). */
  b2clLabel: V("B2CL threshold"),
  b2clHint: V(
    "Invoices to unregistered clients in another state above this amount are reported one by one (B2CL). Default ₹1,00,000. (VERIFY WITH CA/LEGAL)",
  ),
  inrMonthsLabel: V("Realisation period for INR exports"),
  inrMonthsHint: V(
    "Months within which payment for an export invoiced in rupees must arrive. Default 12. (VERIFY WITH CA/LEGAL)",
  ),
  b2clError: V("Enter an amount above zero."),
  inrMonthsError: V("Enter a whole number of months from 1 to 120."),
} as const;

// 07-V §9 bells: the titles are the jobs Worker's; where each lands is ./bell-links.ts (kept apart so the shell stays small).
export { reportBellHref } from "./bell-links.ts";
