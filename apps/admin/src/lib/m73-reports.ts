// The words and the pure rules of the M7.3 screens (ADM-REP-01, -02, -03, -05, -06; ADM-DASH-01; ADM-G-05): the four management reports (revenue and
// collections, outstanding and ageing, pipeline and win rate, care plan hours), the dashboard v2 additions and the offer list's search. Copy C1 to C24 is the run
// file's section H (docs/runs/m7.3-reports.md), word for word, approved by the lead under the owner's delegation (staff screens); C18b and the `month_invalid`
// line are the lead's triage. A line H lacks is marked DRAFT here, listed in the designer's report for the lead's approval, and never invented elsewhere.
//
// Money: every figure is the API's integer minor units; the only arithmetic here goes through core (`sum`, `negate`, `formatMoney`), never rupees and dollars
// together except the labelled "Total in INR", which adds INR amounts only (INR documents and the frozen INR values of USD ones, L4) and is shown only when every
// USD figure has its INR value (C7 otherwise). Reports are not tax documents (Researched 2026-10-28 (08-C RA-28)).
import { type Currency, formatMoney, money, negate, sum } from "@techaust/core";
import { CATALOGUE_CATEGORIES } from "@techaust/core/catalogue";
import { parseIsoDate } from "@techaust/core/dates";
import type {
  AgeingBucket,
  CareBilled,
  CollectedFigures,
  InvoicedFigures,
  RevenueKind,
  TimeToWinBand,
} from "@techaust/core/reports";
import { csvCell, plainAmount } from "./payments.ts";

// ---- C1 to C4: the report names (the section index) ---------------------------------------------------------------------------------------------------

export const M73_TITLES = {
  revenue: "Revenue and collections",
  ageing: "Outstanding and ageing",
  pipeline: "Pipeline and win rate",
  careHours: "Care plan hours",
} as const;

// ---- C5 to C11, C20, C21: revenue and collections -------------------------------------------------------------------------------------------------------

export const REVENUE_COPY = {
  /** C8 (Researched (08-C RA-04); Researched 2026-10-28 (08-C RA-28)): the page's lede. */
  lede: "Management figures, not a GST return. Credit notes count on the day they are issued.",
  /** C5 */
  month: "Month",
  invoicedBefore: "Invoiced (before GST)",
  invoicedWith: "Invoiced (with GST)",
  collected: "Collected",
  tds: "TDS deducted",
  refunded: "Refunded",
  /** C6 (M6.1 L15; RA-21: the invoice's frozen INR, never converted again) */
  inrNote:
    "INR equivalent: invoices at the rate on the invoice; payments at the INR amount on the bank advice.",
  /** C7 */
  inrMissing: (n: number) => `${n} USD payments have no INR amount recorded, so the INR total is not shown.`,
  /** C10 */
  noCategory: "Not from the catalogue",
  /** C11 (L8) */
  categoryNote: "A service's category is today's category in the catalogue.",
  /** C20 */
  empty: (fy: string) => `Nothing invoiced in ${fy}.`,
  /** C21 */
  exportCsv: "Export CSV",
  // ---- DRAFT (not in H; for the lead's approval) ----
  /** DRAFT: the view switch's legend and options (the brief's `by=month|category|kind`). */
  view: "Show by",
  byMonth: "Month",
  byCategory: "Category",
  byKind: "Kind of work",
  /** DRAFT: the currency switch's legend (shown only when the year has both currencies). */
  currency: "Currency",
  /** DRAFT: the shared rules' "Total in INR" (brief C, shared rules), the label of the INR figure across both currencies. */
  totalInInr: "Total in INR",
  /** DRAFT: the closing row of a table (the financial year's figures). */
  fyTotal: (fy: string) => `Total for ${fy}`,
  /** DRAFT: the category table's columns (C5 has the money columns). */
  category: "Category",
  kind: "Kind",
  /** DRAFT: a category counts lines, not documents (analyst's note). */
  lines: "Lines",
  documents: "Documents",
  /** existing word (documents.ts `roundOff`): the documents' round-off, one row per currency, in no category */
  roundOff: "Round-off",
  /** DRAFT: the per-client block (C2 of the routes) and its client column (PAY_UI.colClient). */
  perClient: "By client",
  client: "Client",
  showMore: "Show more",
  /** DRAFT: the chart titles (single series: the title names it). */
  chartMonths: (currency: Currency) => `Invoiced and collected by month, ${currency}`,
  chartCategories: (currency: Currency) => `Invoiced by category before GST, ${currency}`,
  chartKinds: (currency: Currency) => `Invoiced by kind of work before GST, ${currency}`,
  /** DRAFT: an empty view of one currency (the year has the other currency only). */
  emptyCurrency: (currency: Currency, fy: string) => `Nothing invoiced in ${currency} in ${fy}.`,
  /** DRAFT: the export's progress and refusal lines. */
  exporting: (n: number) => (n === 1 ? "1 client read so far" : `${n} clients read so far`),
  exportCancelled: "Cancelled. No file was made.",
} as const;

/** C9 */
export const KIND_LABELS: Record<RevenueKind, string> = {
  recurring: "Care plans (recurring)",
  project: "Projects",
  other: "Other",
};

/** The catalogue's categories (the catalogue screen's own labels), and C10 for a line not from the catalogue. */
export function categoryLabel(key: string, labels: Readonly<Record<string, string>>): string {
  if (key === "none") return REVENUE_COPY.noCategory;
  return labels[key] ?? key;
}
export const CATEGORY_ORDER: readonly string[] = [...CATALOGUE_CATEGORIES, "none"];

// ---- C12, C13, C20: outstanding and ageing ---------------------------------------------------------------------------------------------------------------

/** C12: the bucket columns, in `AGEING_BUCKETS` order. */
export const AGEING_LABELS: Record<AgeingBucket, string> = {
  not_due: "Not yet due",
  d1_30: "1–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: "Over 90 days",
};

export const AGEING_COPY = {
  creditHeld: "Credit held",
  statement: "Statement",
  /** C13 (L7; RA-17, RA-36: credit held apart, never netted) */
  lede: (date: string) =>
    `As at today (${date}). Credit held is shown apart and is not taken off the amounts due.`,
  /** C20 */
  empty: "Nothing outstanding.",
  // ---- DRAFT ----
  /** DRAFT: the total column (07-V's "Total", Table 13's column word). */
  total: "Total",
  client: "Client",
  /** DRAFT: the statement link's words for a screen reader and the cell's visible text. */
  openStatement: "Open statement",
  /** DRAFT: the per-currency heading and the totals row. */
  owedIn: (currency: Currency) => `Owed in ${currency}`,
  allClients: "All clients",
  /** DRAFT: the dashboard tile's link to the report (C2's own name). */
} as const;

// ---- C14 to C16, C20, C24: pipeline and win rate --------------------------------------------------------------------------------------------------------

export const PIPELINE_COPY = {
  /** C14 */
  leads: "Leads in this period",
  won: "Won",
  conversion: "Conversion",
  winRate: "Offer win rate",
  medianToWin: "Median time to win",
  /** C15 (Researched 2026-10-28 (08-C RB-10); Q3 A) */
  retention: "Leads are deleted 12 months after their last activity, so older periods are not shown.",
  /** C20 */
  empty: "No leads in this period.",
  /** C24 (Q1 A) */
  usdNote: "USD offers are shown in USD: an offer has no exchange rate until it is invoiced.",
  // ---- DRAFT ----
  from: "From",
  to: "To",
  show: "Show",
  byStage: "Leads by stage",
  lostReasons: "Why leads were lost",
  bySource: "Where leads came from",
  topPaths: "Pages leads came from",
  page: "Page",
  created: "Leads",
  openTrend: "Open leads by day",
  date: "Date",
  open: "Open",
  offersSent: "Offers sent in this period",
  status: "Status",
  currency: "Currency",
  count: "Offers",
  value: "Value before GST",
  decided: "Decided offers",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  timeToWin: "Time to win",
  band: "Days to win",
  noPage: "No page recorded",
  noRate: "No offers decided",
  noConversion: "No leads",
  noMedian: "No wins yet",
  days: (n: number) => (n === 1 ? "1 day" : `${n} days`),
  /** "{won} of {leads}" under a rate */
  ofLeads: (won: number, created: number) => `${won} won of ${created}`,
  ofDecided: (accepted: number, decided: number) => `${accepted} accepted of ${decided} decided`,
  wins: (n: number) => (n === 1 ? "1 win" : `${n} wins`),
  noTrend: "No daily counts in this period yet.",
  noOffers: "No offers were sent in this period.",
  /** DRAFT: the disclosure that shows a chart's figures as a table (the chart's accessible twin). */
  asTable: "Show as a table",
  /** the server's range refusals (report-delivery.ts, B1), said before asking */
  rangeInvalid: "Choose a start date on or before the end date",
  rangeTooLong: "Choose a period of up to 366 days",
} as const;

/** DRAFT: the time-to-win bands, in `TIME_TO_WIN_BANDS` order (the C12 style). */
export const BAND_LABELS: Record<TimeToWinBand, string> = {
  d0_7: "0–7 days",
  d8_30: "8–30 days",
  d31_90: "31–90 days",
  d90_plus: "Over 90 days",
};

// ---- C17 to C20: care plan hours ---------------------------------------------------------------------------------------------------------------------------

export const CARE_HOURS_COPY = {
  /** C17 */
  period: "Period",
  included: "Included",
  used: "Used",
  over: "Over",
  billedOn: "Billed on",
  /** C18 */
  notBilled: "Not billed yet",
  /** C18b (lead's triage of the early check, finding 6) */
  discarded: "Draft discarded",
  /** C19 */
  overageNote: "Overage is priced on the care invoice.",
  /** C20 */
  empty: "No active care plans this month.",
  /** the lead's triage of B2 (4): the server's `month_invalid` */
  monthInvalid: "Choose a month up to this one",
  // ---- DRAFT ----
  month: "Month",
  plan: "Care plan",
  /** DRAFT: a care invoice still a draft, and a voided one (the document words of 07, "Draft" and "Void"). */
  draft: "Draft",
  void: "Void",
  /** DRAFT: the overage's own invoice, under the plan's. */
  overageOn: (text: string) => `Overage: ${text}`,
} as const;

// ---- C22, C23: the dashboard and the search ----------------------------------------------------------------------------------------------------------------

/** C22: a figure against the previous IST month, in words (never an arrow alone). `period` is the month's name ("October 2026"). */
export function deltaText(minor: number, currency: Currency, period: string): string {
  if (minor === 0) return `Same as ${period}`;
  const amount = formatMoney(minor > 0 ? money(minor, currency) : negate(money(minor, currency)));
  return minor > 0 ? `${amount} more than ${period}` : `${amount} less than ${period}`;
}

/** C23 lives with the offer list's words (lib/documents.ts `DOC_PENDING.searchNumberOrClient`), so that chunk doesn't carry this module. */

export const DASH_M73 = {
  /** DRAFT: the sparkline's accessible name. */
  trendLabel: (from: number, to: number) => `Open leads over the last 30 days: ${from} then, ${to} now`,
  trendCaption: "Last 30 days",
  /** DRAFT: the reports tile's heading is 07-V's "Reports"; its links are C1 to C4. */
} as const;

// ---- months and periods --------------------------------------------------------------------------------------------------------------------------------

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

/** "2026-10" (or "2026-10-01") → "October 2026"; the text itself when malformed. */
export function monthName(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  const name = m ? MONTH_NAMES[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${m[1]}` : iso;
}

/** "2026-10" → "Oct" (a chart's axis); the text itself when malformed. */
export function monthShort(iso: string): string {
  const name = monthName(iso);
  return name === iso ? iso : name.slice(0, 3);
}

/** "2627" → "2026-27"; anything else as it is. */
export const fyLabel = (token: string) =>
  /^\d{4}$/.test(token) ? `20${token.slice(0, 2)}-${token.slice(2)}` : token;

/** The FY token of an IST date ("2026-11-06" → "2627"). */
export function fyTokenOf(iso: string): string {
  const d = parseIsoDate(iso);
  if (!d) return "";
  const start = d.month >= 4 ? d.year : d.year - 1;
  return `${String(start % 100).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The months a care-hours report can be read for: this IST month and the eleven before it, newest first (C4 refuses a later month). */
export function monthChoices(todayIso: string): { value: string; label: string }[] {
  const y = Number(todayIso.slice(0, 4));
  const m = Number(todayIso.slice(5, 7));
  return Array.from({ length: 12 }, (_, i) => {
    const k = y * 12 + (m - 1) - i;
    const value = `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
    return { value, label: monthName(value) };
  });
}

// ---- figures ---------------------------------------------------------------------------------------------------------------------------------------------

/** Σ of minor amounts of one currency, through core (never a float, never two currencies). */
export const sumMinor = (values: readonly number[], currency: Currency): number =>
  sum(
    values.map((v) => money(v, currency)),
    currency,
  ).amount;

/** One currency's figures of a month, or zeros when the month has none. */
export const invoicedOf = (rows: readonly InvoicedFigures[], currency: Currency): InvoicedFigures =>
  rows.find((r) => r.currency === currency) ?? {
    currency,
    count: 0,
    taxableMinor: 0,
    totalMinor: 0,
    inrTaxableMinor: 0,
    inrTotalMinor: 0,
  };
export const collectedOf = (rows: readonly CollectedFigures[], currency: Currency): CollectedFigures =>
  rows.find((r) => r.currency === currency) ?? {
    currency,
    payments: 0,
    receivedMinor: 0,
    refundedMinor: 0,
    collectedMinor: 0,
    tdsMinor: 0,
    inrCollectedMinor: 0,
    inrMissing: 0,
  };

/**
 * "Total in INR" over both currencies (brief C, shared rules): INR figures as they are, USD figures by their frozen INR values. Null when any USD figure has no
 * INR value (the invoices' rule) or `missing` USD payments lack one (C7). Only INR amounts are added.
 */
export function totalInInr(
  parts: readonly { currency: Currency; minor: number; inrMinor: number | null }[],
): number | null {
  const inr: number[] = [];
  for (const p of parts) {
    if (p.currency === "INR") inr.push(p.minor);
    else if (p.inrMinor === null) return null;
    else inr.push(p.inrMinor);
  }
  return sumMinor(inr, "INR");
}

/** A rate in basis points as "42 %" or "42.5 %" (whole tenths; never a float sum: the digits of the integer). */
export function rateText(bp: number): string {
  const tenths = Math.round(bp / 10); // basis points → tenths of a per cent, for display only (no money)
  const whole = Math.floor(tenths / 10);
  const rest = tenths % 10;
  return rest === 0 ? `${whole} %` : `${whole}.${rest} %`;
}

/** The share of a part in a whole for a chart's geometry (0 to 1); never shown as money. */
export const shareOf = (part: number, whole: number) => (whole <= 0 ? 0 : Math.max(0, part) / whole);

/** The billed state of a care period in words (C17 to C19): a date, "Not billed yet", "Draft discarded", "Draft" or "Void". */
export function billedText(b: CareBilled | null, day: (iso: string) => string): string {
  if (!b) return CARE_HOURS_COPY.notBilled;
  if (b.status === "discarded") return CARE_HOURS_COPY.discarded;
  if (b.status === "void") return CARE_HOURS_COPY.void;
  if (b.status === "draft" || b.issueDate === null) return CARE_HOURS_COPY.draft;
  return b.number ? `${day(b.issueDate)} (${b.number})` : day(b.issueDate);
}

// ---- CSV built from the screen's data (L6: pipeline and care; the per-client finance CSVs come from the /export routes) -----------------------------------

const line = (cells: readonly string[]) => cells.map(csvCell).join(",");
const csv = (rows: readonly (readonly string[])[]) => `${rows.map(line).join("\r\n")}\r\n`;
const amount = (minor: number | null, currency: Currency) =>
  minor === null ? "" : plainAmount(minor, currency);

/** The revenue-per-client CSV (C6's export twin): one row per client, in the API's order; the INR column empty where the value is unknown. */
export function revenueClientsCsv(
  rows: readonly {
    client: { code: string; name: string };
    invoiced: InvoicedFigures;
    collected: CollectedFigures;
  }[],
  currency: Currency,
): string {
  return csv([
    [
      "Client code",
      "Client",
      "Currency",
      REVENUE_COPY.invoicedBefore,
      REVENUE_COPY.invoicedWith,
      REVENUE_COPY.collected,
      REVENUE_COPY.tds,
      REVENUE_COPY.refunded,
      ...(currency === "USD" ? ["Invoiced (with GST) in INR", "Collected in INR"] : []),
    ],
    ...rows.map((r) => [
      r.client.code,
      r.client.name,
      currency,
      amount(r.invoiced.taxableMinor, currency),
      amount(r.invoiced.totalMinor, currency),
      amount(r.collected.collectedMinor, currency),
      amount(r.collected.tdsMinor, currency),
      amount(r.collected.refundedMinor, currency),
      ...(currency === "USD"
        ? [amount(r.invoiced.inrTotalMinor, "INR"), amount(r.collected.inrCollectedMinor, "INR")]
        : []),
    ]),
  ]);
}

/** The ageing CSV (C6's export twin): one row per client and currency, the C12 columns. */
export function ageingCsv(
  rows: readonly {
    client: { code: string; name: string };
    currency: Currency;
    buckets: Record<AgeingBucket, { count: number; balanceMinor: number }>;
    totalMinor: number;
    creditHeldMinor: number;
  }[],
  asOf: string,
  buckets: readonly AgeingBucket[],
): string {
  return csv([
    [
      "As at",
      "Client code",
      "Client",
      "Currency",
      ...buckets.map((b) => AGEING_LABELS[b]),
      AGEING_COPY.total,
      AGEING_COPY.creditHeld,
    ],
    ...rows.map((r) => [
      asOf,
      r.client.code,
      r.client.name,
      r.currency,
      ...buckets.map((b) => amount(r.buckets[b].balanceMinor, r.currency)),
      amount(r.totalMinor, r.currency),
      amount(r.creditHeldMinor, r.currency),
    ]),
  ]);
}

/** The care-hours CSV, from the rows on screen (hours as decimal hours of whole minutes: "1:30" style would be misread by a spreadsheet). */
export function careHoursCsv(
  rows: readonly {
    client: { code: string; name: string };
    period: { start: string; end: string };
    includedMinutes: number;
    availableMinutes: number;
    usedMinutes: number;
    overageMinutes: number;
    billed: CareBilled | null;
  }[],
  month: string,
): string {
  const mins = (n: number) => String(n);
  return csv([
    [
      CARE_HOURS_COPY.month,
      "Client code",
      "Client",
      "Period start",
      "Period end",
      "Included (minutes)",
      "Available (minutes)",
      "Used (minutes)",
      "Over (minutes)",
      CARE_HOURS_COPY.billedOn,
    ],
    ...rows.map((r) => [
      month,
      r.client.code,
      r.client.name,
      r.period.start,
      r.period.end,
      mins(r.includedMinutes),
      mins(r.availableMinutes),
      mins(r.usedMinutes),
      mins(r.overageMinutes),
      billedText(r.billed, (d) => d),
    ]),
  ]);
}

/** The pipeline CSV, from the report on screen: one row per figure (section, item, value), so every block reads in one sheet. */
export function pipelineCsv(rows: readonly (readonly [string, string, string])[]): string {
  return csv([["Section", "Item", "Value"], ...rows]);
}
