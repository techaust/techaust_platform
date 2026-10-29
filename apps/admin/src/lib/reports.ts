// The words and the pure rules of the M5.5b screens (ADM-REP-04, ADM-REP-07, ADM-INV-17, ADM-CLI-04, ADM-DASH-01): the reports section (GST exports,
// sales register, EDF list, export realisation), the client's statement tab and the dashboard's finance tiles.
//
// Copy: 07-V (docs/07-content-appendix/V-m5.5b-reports-statements.md), approved by the lead on 2026-10-28 under the owner's delegation, word for word.
// A singular of a 07-V plural line ("1 document checked") follows that line; a word 07-V or another approved appendix has is used as written and says
// where it comes from. A line 07-V lacked is 07-W's (approved 2026-10-28), never invented.
// Tax and legal lines: Researched 2026-10-28 or OPEN, per 08-C (the IDs are noted at each line).
//
// No value import of `@techaust/core/gst` here (the gst core is fetched only by the reports screens: ./reports-build.ts); types only. Money is formatted
// through core (`moneyText`); nothing here adds up an amount.
import { compareDocNumbers, formatMoney, money } from "@techaust/core";
import { formatDate, parseIsoDate } from "@techaust/core/dates";
import type { CalendarDate, GstErrorCode, GstIssue, GstWarning, RealisationStage } from "@techaust/core/gst";
import { STATE_CODES } from "@techaust/core/gstin";
import type { StatementKind } from "@techaust/core/statement";
import { RequestError } from "../api.ts";
import type { PillTone } from "../components/display.tsx";
import { Y } from "./copy-y.ts";

/** An INR amount in words for a line (core formats it; nothing here adds up). */
const inr = (minor: number): string => formatMoney(money(minor, "INR"));

/** "1 document" / "3 documents": the count words 07-V's lines use ({count} documents). */
const docs = (n: number) => `${n} ${n === 1 ? "document" : "documents"}`;

// ---- 07-V §1 navigation ------------------------------------------------------------------------------------------------------------------------

export type ReportKey = "gst" | "sales-register" | "edf" | "realisation";

/** The four reports, in 07-V §1's order, with their address under /reports. */
export const REPORTS: readonly { key: ReportKey; path: string; label: string }[] = [
  { key: "gst", path: "/reports/gst", label: "GST exports" },
  { key: "sales-register", path: "/reports/sales-register", label: "Sales register" },
  { key: "edf", path: "/reports/edf", label: "EDF list" },
  { key: "realisation", path: "/reports/realisation", label: "Export realisation" },
];

export const REPORTS_COPY = {
  /** 07-V §1: the sidebar group, used as the section's crumb and its sub-navigation's name. */
  group: "Reports",
} as const;

// ---- 07-V §2 GST exports ------------------------------------------------------------------------------------------------------------------------

export const GST_COPY = {
  title: "GST exports",
  lede: "Files for your GSTR-1 and GSTR-3B, made from the invoices and notes issued in the period. Check them with your CA before you file.",
  period: "Period",
  month: "Month",
  quarter: "Quarter",
  defaultHint: "The last complete quarter is selected.",
  notEnded: "This period has not ended. The files will change if you issue more documents before it ends.",
  make: "Make files",
  reading: (n: number) => `Reading issued documents: ${n} so far`,
  checking: (n: number) => `Checking ${n} documents`,
  /** 07-V has the plural; one document is said in its singular (the plural line's own words). */
  done: (n: number) => (n === 1 ? "1 document checked. No errors." : `${n} documents checked. No errors.`),
  /**
   * FX-4 (full audit A5 1; 07-Y, PENDING): said instead of `done` while a blocking warning is present (a tax-only note whose tax the files leave out), so the panel never
   * says "No errors" then. OPEN (08-C RA-32): how such a note is reported in Table 9B.
   */
  doneManual: (n: number, k: number) =>
    Y(
      `${docs(n)} checked. ${k === 1 ? "1 note needs its" : `${k} notes need their`} tax entered by hand before you file.`,
    ),
  errorsHeading: (n: number) =>
    n === 1
      ? "1 problem to fix before these files can be made"
      : `${n} problems to fix before these files can be made`,
  openDocument: "Open document",
  warningsHeading: "Check before filing",
  totalsHeading: "Totals for the period",
  hsnMatches: "HSN/SAC summary matches the section totals.",
  hsnDiffers: "HSN/SAC summary does not match the section totals.",
  gstr3bHeading: "GSTR-3B figures",
  table31a: "3.1(a) Outward taxable supplies (other than zero-rated)",
  table31b: "3.1(b) Outward taxable supplies (zero-rated)",
  table32: "3.2 Inter-state supplies to unregistered persons, by place of supply",
  table13Heading: "Documents issued",
  table13Columns: {
    series: "Series",
    from: "From",
    to: "To",
    total: "Total",
    cancelled: "Cancelled",
  },
  download: (section: string) => `Download ${section} CSV`,
  downloadAll: "Download all (ZIP)",
  verify: (version: string) =>
    // OPEN (08-C RA-23 Q17): the offline tool's layout is the CA's to confirm.
    `Made with layout ${version} for the GSTR-1 offline tool. Layouts change; before your first upload, test-import one file with your CA.`,
  /**
   * The column words of the totals panel and the 3B table: "Taxable value", "Table" and "Place of supply" are 07-V §3's CSV headers; the GST portal's own
   * names are kept (07-V's rule); "Section" and "Documents" are not in 07-V.
   */
  columns: {
    section: "Section",
    documents: "Documents",
    taxable: "Taxable value",
    igst: "IGST",
    cgst: "CGST",
    sgst: "SGST",
    table: "Table",
    pos: "Place of supply",
  },
  /** Not in 07-V: the line when the step-up was cancelled before any page was read. */
  cancelled: "Cancelled. No files were made.",
  /** Not in 07-V: the closing row of the totals panel (every reported document of the period, signed). */
  overall: "Overall",
  /** Not in 07-V: the heading of the file list. */
  filesHeading: "Files",
  /** Not in 07-V (batch Q69): the two HSN/SAC files' rows, which 07-V names alike; the file name tells them apart. */
  downloadHsnB2b: "Download HSN/SAC summary (B2B) CSV",
  downloadHsnB2c: "Download HSN/SAC summary (B2C) CSV",
  /** Not in 07-V: a 3.2 table with no supplies to unregistered persons in other states. */
  table32Empty: "None in this period.",
} as const;

/** 07-V §2 section names, by the GSTR-1 file's stem (`gstr1Csv`'s file names); the two HSN files share one name, the file name tells them apart. */
export const SECTION_NAMES = {
  b2b: "B2B (registered clients)",
  b2cl: (threshold: string) => `B2CL (unregistered, inter-state, above ${threshold})`,
  b2cs: "B2CS (unregistered, other)",
  exp: "Exports",
  cdnr: "Credit and debit notes (registered)",
  cdnur: "Credit and debit notes (unregistered)",
  hsn: "HSN/SAC summary",
  docs: "Documents issued (Table 13)",
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

/** The label of one file's download row: 07-V's "Download {section} CSV", the two HSN/SAC files told apart (not in 07-V, batch Q69). */
export function fileDownloadText(stem: string, section: string): string {
  if (stem === "hsn_b2b") return GST_COPY.downloadHsnB2b;
  if (stem === "hsn_b2c") return GST_COPY.downloadHsnB2c;
  return GST_COPY.download(stem === "docs" ? SECTION_NAMES.docs : section);
}

/** 07-V §2.1: one message per code (28). */
export const GST_ERRORS: Readonly<Record<GstErrorCode, string>> = {
  kind_not_reportable: "This document type is not reported in GSTR-1.",
  gstin_missing: "The client's GSTIN is missing.",
  gstin_invalid: "The client's GSTIN is not valid.",
  parent_missing: "The invoice this note is against was not found in the data.",
  parent_invalid: "The invoice this note is against is not a reportable invoice.",
  supply_mismatch:
    "The supply details (type, client, place of supply or tax heads) don't agree with each other.",
  sac_missing: "A line has no SAC code.",
  sac_invalid: "A line's SAC code is not six digits.",
  params_invalid: "Your state code in Settings is not valid.",
  rates_empty: "The document has no tax lines.",
  rate_invalid: "A line has a GST rate that isn't allowed.",
  amount_invalid: "An amount on the document is not valid.",
  amount_out_of_range: "An amount is too large to report.",
  totals_mismatch: "The document's totals don't add up from its lines.",
  pos_invalid: "The place of supply is not a valid state code.",
  export_pos_mismatch: "An export must have place of supply 96 (other countries).",
  number_invalid: "The document number has characters the GST portal won't accept.",
  duplicate_row: "This document appears twice.",
  date_invalid: "The document date is not valid.",
  threshold_invalid: "The B2CL threshold in Settings is not valid.",
  series_not_gst: "This number series is not a GST document series.",
  docs_counts_invalid: "The documents-issued counts don't add up.",
  fx_missing: "A foreign-currency document has no exchange rate.",
  rules_invalid: "The realisation periods in Settings are not valid.",
  period_invalid: "Pick a period within one financial year, of at most a year.",
  rates_sum_mismatch: "The tax lines don't add up to the document total.",
  layout_unknown: "This file layout is not known.",
  internal_error: "Something went wrong making this file. Try again; if it keeps happening, tell us.",
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
      return `B2CS for ${facts.state ?? ""} and ${facts.rate ?? ""} comes to below zero after credit notes. Check with your CA how to report it.`;
    case "hsn_description_missing":
      return `SAC ${facts.sac ?? ""} has no description in our list; the file leaves it blank.`;
    case "before_fema_2026":
      // OPEN (08-C RB-02): which period applies to an invoice raised before 1 October 2026.
      return "Issued before 1 October 2026: a different realisation period may apply. Ask your bank or CA.";
    case "tax_only_note_manual":
      return taxOnlyNoteText(w);
  }
}

/**
 * FX-4 (full audit A5 1; 07-Y, PENDING): a tax-only note's blocking warning, naming the note, the recipient's GSTIN and each tax head with its amount to enter by hand.
 * OPEN (08-C RA-32): how is a tax-only debit note (taxable value nil, tax only) reported in GSTR-1 Table 9B through the Offline Tool, and how does it flow to 3B Table 3?
 * The line names what the files may leave out (OPEN (08-C RA-23): the Offline Tool import is untested, so it says "may not come through", never "would be nil") and
 * sends the question to the CA; it never says how to file it.
 */
export function taxOnlyNoteText(w: GstWarning): string {
  const m = w.manual;
  if (!m) return Y("A tax-only note's tax is not in the files. Ask your CA how to report it.");
  const heads = [
    m.igstMinor > 0 ? `IGST ${inr(m.igstMinor)}` : null,
    m.cgstMinor > 0 ? `CGST ${inr(m.cgstMinor)}` : null,
    m.sgstMinor > 0 ? `SGST ${inr(m.sgstMinor)}` : null,
  ].filter((h): h is string => h !== null);
  const who = m.gstin === null ? "unregistered client" : `GSTIN ${m.gstin}`;
  // By kind (early check L2): a debit note adds tax, a credit note takes it away. A b2cs note sits in the B2CS file, not a note file, so its line names no table.
  const what =
    m.kind === "credit_note"
      ? "is a credit note that reduces tax only"
      : "is a debit note that adds tax only";
  const ask =
    m.section === "b2cs" ? "Ask your CA how to report it." : "Ask your CA how to report it in Table 9B.";
  return Y(
    `${m.number} (${who}) ${what}. The files show it with a taxable value of 0.00 and no tax column, so its tax may not come through on import. Enter by hand: ${heads.join(", ")}. ${ask}`,
  );
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
  title: "Sales register",
  lede: "Every tax invoice, export invoice, credit note and debit note issued in the range, for your accounts.",
  from: "From",
  to: "To",
  rangeInvalid: "Pick a period within one financial year, of at most a year.",
  downloadRegister: "Download sales register (CSV)",
  downloadOutput: "Download output tax (CSV)",
  downloadGstr3b: "Download GSTR-3B figures (CSV)",
  empty: "No documents were issued in this range.",
  /** Not in 07-V: the button that reads the range, and the heading of the preview. */
  show: "Show",
  previewHeading: "Output tax",
  supply: {
    intra: "Intra-state",
    inter: "Inter-state",
    zero_rated_wopay: "Zero-rated, without payment of tax (LUT)",
    zero_rated_wpay: "Zero-rated, with payment of tax",
  },
  /** 07-V §3 output-tax headers (the file's own words). */
  columns: {
    supply: "Supply",
    rate: "Rate",
    taxable: "Taxable value",
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
  title: "EDF list",
  lede: (due: string) =>
    // Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 3(2)(a) (08-C RB-03).
    `Export invoices issued in the month, for the export declaration (EDF) you give your bank. One EDF can cover the whole month. Due by ${due}.`,
  month: "Month",
  columns: {
    invoice: "Invoice",
    date: "Date",
    client: "Client",
    country: "Country",
    currency: "Currency",
    amount: "Amount",
    purpose: "Purpose code",
    realised: "Amount realised",
  },
  realisedNote: "Amount realised is left blank: payments are recorded from the payments update.",
  download: "Download EDF list (CSV)",
  empty: (month: string) => `No export invoices were issued in ${month}.`,
} as const;

// ---- 07-V §5 export realisation ------------------------------------------------------------------------------------------------------------------

export const REALISATION_COPY = {
  title: "Export realisation",
  // Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 5(1) (08-C RB-01).
  lede: "Export invoices not yet fully paid, most urgent first. Money from an export must reach India within the FEMA period: 9 months from the invoice date, or 12 if it was invoiced or settled in Indian Rupees.",
  showRealised: "Show realised",
  columns: {
    invoice: "Invoice",
    client: "Client",
    issued: "Issued",
    outstanding: "Outstanding",
    stage: "Stage",
    dueBy: "Due by",
  },
  // OPEN (08-C RB-02).
  beforeFema: "Issued before 1 October 2026: a different realisation period may apply.",
  // Researched 2026-10-28, Rule 96A CGST (08-C RA-20).
  igstNote:
    "Exports where IGST was charged show only the FEMA dates; the 12 months and 15 days GST date applies to exports under your LUT.",
  // Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 5(1) (08-C RB-04); the proof document is OPEN (RB-05).
  extensionNote:
    "If your bank extended a date, you can record it with the proof of payment in the payments update.",
  empty: "No export invoices are waiting for payment.",
  /** Not in 07-V (batch Q69): the empty list with "Show realised" ticked (nothing open and nothing realised). */
  emptyAll: "No export invoices in this list.",
} as const;

/** 07-V §5 stage labels. */
export const STAGE_LABELS: Readonly<Record<RealisationStage, string>> = {
  ok: "On track",
  fema_approaching: "FEMA date in 30 days",
  fema_overdue: "Past the FEMA date",
  gst_approaching: "GST date in 30 days",
  gst_overdue: "Past the GST date",
  realised: "Realised",
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
    // the number in issue order ("/10" after "/9", FX-4 review L3), as the register's rows are
    return compareDocNumbers(a.number, b.number);
  });
}

// ---- 07-V §6 statement ------------------------------------------------------------------------------------------------------------------------

export const STATEMENT_COPY = {
  tab: "Statement",
  from: "From",
  to: "To",
  defaultRange: "This financial year to date",
  currency: "Currency",
  opening: (date: string, amount: string) => `Opening balance on ${date}: ${amount}`,
  closing: (date: string, amount: string) => `Closing balance on ${date}: ${amount}`,
  /** The same two lines as a label over their figure (the amount is set below it, in tabular figures). */
  openingLabel: (date: string) => `Opening balance on ${date}`,
  closingLabel: (date: string) => `Closing balance on ${date}`,
  periodInvalid: "Pick a start date on or before the end date.",
  anonymised: "This client's details were erased, so no statement can be made.",
  columns: {
    date: "Date",
    document: "Document",
    details: "Details",
    debit: "Debit",
    credit: "Credit",
    balance: "Balance",
  },
  proformasNote:
    "Payment requests (proformas) aren't listed: a payment against one shows through its tax invoice.",
  paymentsNote: "Only payments recorded against payment requests are listed until online payments arrive.",
  downloadCsv: "Download CSV",
  makePdf: "Make PDF",
  making: "Making the PDF…",
  downloadPdf: "Download PDF",
  empty: "Nothing has been issued to this client in this range.",
  kept: "Statement PDFs are kept for 30 days.",
  /** 07-V §6.1's words, used for the CSV's opening and closing rows. */
  openingWord: "Opening balance",
  closingWord: "Closing balance",
  /** Not in 07-V: the button that reads the range. */
  show: "Show",
  debits: "Total debits",
  credits: "Total credits",
  // 07-Q POR3.
  more: "Show more",
  /** Not in 07-V: the visually hidden caption of the table. */
  caption: "Statement entries",
} as const;

/**
 * 07-V §6 entry kinds (Details). A credit note says which invoice it is against when the API gives that number; else 07-U §3's type name. A debit note does the same
 * (FX-4, full audit A5 7): "Debit note against {number}" is 07-Y's (PENDING, marked); without a number it stays 07-V's "Debit note".
 */
export function statementKindText(kind: StatementKind, againstNumber?: string | null): string {
  switch (kind) {
    case "tax_invoice":
      return "Invoice";
    case "export_invoice":
      return "Export invoice";
    case "debit_note":
      return againstNumber ? Y(`Debit note against ${againstNumber}`) : "Debit note";
    case "credit_note":
      return againstNumber ? `Credit note against ${againstNumber}` : "Credit note";
    case "receipt":
      return "Payment received";
  }
}

/** The Details cell of one statement entry (the screen's words; the CSV's come from `statementCsvLabels`). */
export const statementDetailsText = (e: { kind: StatementKind; againstNumber?: string | null }): string =>
  statementKindText(e.kind, e.againstNumber);

/** The CSV's credit-note words: 07-V's line with core's `{number}` slot, or 07-U §3's type name when a credit note in the file lacks its invoice number. */
export function statementCsvCreditNoteLabel(
  entries: readonly { kind: StatementKind; againstNumber?: string | null }[],
) {
  return entries.every((e) => e.kind !== "credit_note" || e.againstNumber)
    ? "Credit note against {number}"
    : "Credit note";
}

/**
 * The scroll position that brings the open report's tab fully into view in the tab row (like `scrollIntoView({inline: "nearest"})`, but only the
 * row moves, never the page). All values in CSS pixels, the link's left edge measured from the row's content start.
 */
export function nearestScrollLeft(
  rowScrollLeft: number,
  rowWidth: number,
  linkLeft: number,
  linkWidth: number,
): number {
  if (linkLeft < rowScrollLeft) return Math.max(0, linkLeft);
  if (linkLeft + linkWidth > rowScrollLeft + rowWidth) return Math.max(0, linkLeft + linkWidth - rowWidth);
  return rowScrollLeft;
}

/** The CSV's debit-note words (FX-4, A5 7): 07-Y's line with core's `{number}` slot (marked while 07-Y is pending), or 07-V's "Debit note" when a debit note in the file lacks its invoice number. */
export function statementCsvDebitNoteLabel(
  entries: readonly { kind: StatementKind; againstNumber?: string | null }[],
) {
  return entries.every((e) => e.kind !== "debit_note" || e.againstNumber)
    ? Y("Debit note against {number}")
    : "Debit note";
}

/** The CSV's words (core `statementCsv` takes them from the caller, LD83; it fills `{number}` with each note's invoice number). */
export const statementCsvLabels = (
  entries: readonly { kind: StatementKind; againstNumber?: string | null }[] = [],
) => ({
  opening: STATEMENT_COPY.openingWord,
  closing: STATEMENT_COPY.closingWord,
  kinds: {
    tax_invoice: statementKindText("tax_invoice"),
    export_invoice: statementKindText("export_invoice"),
    debit_note: statementCsvDebitNoteLabel(entries),
    credit_note: statementCsvCreditNoteLabel(entries),
    receipt: statementKindText("receipt"),
  } satisfies Record<StatementKind, string>,
});

/** 07-V §6 errors by the API's code; any other refusal keeps the server's own sentence. */
export const STATEMENT_ERRORS: Readonly<Record<string, string>> = {
  statement_too_long: "This range has more than 200 entries. Pick a shorter range for the PDF.",
  statement_empty: "Nothing to list in this range.",
  client_anonymised: "This client's details were erased, so no statement can be made.",
  statement_failed: "The PDF couldn't be made. Try again.",
  period_invalid: "Pick a start date on or before the end date.",
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
  invoiced: "Invoiced",
  thisMonth: "This month",
  thisFy: "This financial year",
  beforeGst: "Before GST",
  inrEquivalent: (amount: string) => `≈ ${amount} in INR`,
  outstanding: "Outstanding",
  overdue: "Overdue",
  documents: (n: number) => docs(n),
  oldest: "Oldest",
  overdueRow: (number: string, client: string, days: number) =>
    `${number} · ${client} · ${days} ${days === 1 ? "day" : "days"}`,
  proformas: "Payment requests awaiting payment",
  open: (n: number) => `${n} open`,
  exports: "Exports nearing a deadline",
  counts: {
    femaApproaching: "FEMA in 30 days",
    femaOverdue: "Past FEMA",
    gstApproaching: "GST in 30 days",
    gstOverdue: "Past GST",
  },
  next: "Next",
  noneInvoiced: "Nothing invoiced yet.",
  noneOutstanding: "Nothing outstanding.",
  noneOverdue: "Nothing overdue.",
  noneProformas: "No payment requests open.",
  noneExports: "No export deadlines coming up.",
  collectedArrives: "Collected figures arrive with payments.",
  /** Not in 07-V: the tile's line when the stored realisation settings can't be read (the API withholds the figures, never guesses). */
  exportsSettings: "Export deadlines can't be worked out until the Tax settings are saved again.",
  /** Not in 07-V: the link of the exports tile and of the overdue tile. */
  // 07-V §10 (the alert email's button).
  openRealisation: "Open export realisation",
  openInvoices: "Open invoices",
} as const;

// ---- 07-V §8 settings › tax ---------------------------------------------------------------------------------------------------------------------

export const TAX_FIELDS_COPY = {
  /** The labels are 07-V §8's field names (the hint lines name them). */
  b2clLabel: "B2CL threshold",
  // Researched 2026-10-28, Rule 59(4) CGST as amended by Notification 12/2024-CT (08-C RA-13).
  b2clHint:
    "Invoices to unregistered clients in another state above this amount are reported one by one (B2CL). Default ₹1,00,000.",
  inrMonthsLabel: "Realisation period for INR exports",
  // Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 5(1) (08-C RB-01).
  inrMonthsHint:
    "Months within which payment must arrive for an export invoiced or settled in Indian Rupees. Default 12. A foreign-currency invoice has 9 months; ask your bank before treating one as settled in rupees.",
  b2clError: "Enter an amount above zero.",
  inrMonthsError: "Enter a whole number of months from 1 to 120.",
} as const;

// 07-V §9 bells: the titles are the jobs Worker's; where each lands is ./bell-links.ts (kept apart so the shell stays small).
export { reportBellHref } from "./bell-links.ts";
