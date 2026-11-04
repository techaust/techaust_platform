// The owners' weekly digest (M7.2; JOB-CRON-03, ADM-DASH-02; run file docs/runs/m7.2-notifications.md B, D, L7). Pure: the IST week, the queue message and the
// figures turned into the template's strings (amounts only through money.ts, integers only). The figures are read by `@techaust/db/digest` with the dashboard's
// own SQL (one source; M7.3's dashboard v2 builds on the same module). The words of the email are 07 §8 (subject "Your week at TecHaust: {{week_label}}").
import { addDays, formatDate, istDate, parseIsoDate, toIsoDate } from "./dates.ts";
import { type Currency, formatMoney } from "./money.ts";
import { weekOf } from "./time.ts";

/** The IST week a moment falls in: its Monday (ISO date, the message's `weekStart` and the email's entity key) and the `week_label` (the Monday as a date). */
export function digestWeekOf(ms: number): { weekStart: string; weekEnd: string; label: string } {
  const today = toIsoDate(istDate(ms));
  const { start, end } = weekOf(today);
  const monday = parseIsoDate(start) as NonNullable<ReturnType<typeof parseIsoDate>>;
  return { weekStart: start, weekEnd: end, label: formatDate(monday) };
}

/** The Monday before a week's Monday (ISO): the digest's "last 7 days" start. */
export const previousMonday = (weekStart: string): string => {
  const d = parseIsoDate(weekStart);
  if (!d) throw new RangeError(`Not a date: ${weekStart}`);
  return toIsoDate(addDays(d, -7));
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The cron's message (L7): one per hourly tick at 09:00, 10:00 and 11:00 IST on Mondays; the consumer's email entity `digest:<userId>:<weekStart>` makes a
 * repeat tick send nothing twice.
 */
export type DigestMessage = { v: 1; kind: "digest.weekly"; weekStart: string };

/**
 * The consumer's reader of a digest body: exactly the version, the kind and the week's Monday (an ISO date that is a Monday), else null. A plain reader, not a zod
 * schema: the jobs Worker carries classic zod only, and `zod/mini` would add about 100 KB and 35 ms of start-up to it (measured at the M7.2 early check).
 */
export function parseDigestMessage(body: unknown): DigestMessage | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 3 || !keys.every((k) => k === "v" || k === "kind" || k === "weekStart")) return null;
  if (
    o.v !== 1 ||
    o.kind !== "digest.weekly" ||
    typeof o.weekStart !== "string" ||
    !ISO_DATE.test(o.weekStart)
  )
    return null;
  const d = parseIsoDate(o.weekStart);
  if (!d || new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() !== 1) return null;
  return { v: 1, kind: "digest.weekly", weekStart: o.weekStart };
}

/** The message of the week `ms` falls in. */
export const digestMessageOf = (ms: number): DigestMessage => ({
  v: 1,
  kind: "digest.weekly",
  weekStart: digestWeekOf(ms).weekStart,
});

export const isDigestKind = (body: unknown): boolean =>
  typeof body === "object" && body !== null && (body as { kind?: unknown }).kind === "digest.weekly";

/** One currency's figure: a count and an amount in minor units. */
export type CurrencyFigure = {
  readonly currency: Currency;
  readonly count: number;
  readonly amountMinor: number;
};

/** The digest's figures (07 §8: pipeline, invoiced and collected, overdue invoices, new leads, upcoming reminders), as `@techaust/db/digest` reads them. */
export type DigestFigures = {
  /** Offers out and still acceptable, before tax (the dashboard's pipeline tile). */
  readonly pipeline: readonly CurrencyFigure[];
  /** Invoiced this IST month, with tax (the finance tile's month row; credit notes subtract). */
  readonly invoicedMonth: readonly CurrencyFigure[];
  /** Collected this IST month (the finance tile's "Collected", less refunds). */
  readonly collectedMonth: readonly CurrencyFigure[];
  /** Overdue invoices: their count and balance (the finance tile's overdue row). */
  readonly overdue: readonly CurrencyFigure[];
  /** Leads created in the last 7 days. */
  readonly newLeads: number;
  /** Payment reminders due in the next 7 days, still waiting. */
  readonly remindersDue: number;
};

const ORDER: readonly Currency[] = ["INR", "USD"];

/** One line per currency in INR, USD order ("₹1,23,456.00 (3)"), joined by "; "; no figure at all is the INR zero. */
function line(figures: readonly CurrencyFigure[]): string {
  const rows = ORDER.flatMap((c) => figures.filter((f) => f.currency === c));
  if (rows.length === 0) return `${formatMoney({ amount: 0, currency: "INR" })} (0)`;
  return rows
    .map((f) => `${formatMoney({ amount: f.amountMinor, currency: f.currency })} (${f.count})`)
    .join("; ");
}

/**
 * The template's data (all strings; the email consumer's `data`): each money figure by currency, never added across currencies, with its count in brackets; the
 * two counts as integers. The words around them are the template's (designer, 07 §8).
 */
export function digestDataOf(f: DigestFigures, week: { label: string }): Record<string, string> {
  return {
    week_label: week.label,
    pipeline: line(f.pipeline),
    invoiced: line(f.invoicedMonth),
    collected: line(f.collectedMonth),
    overdue: line(f.overdue),
    new_leads: String(f.newLeads),
    reminders_due: String(f.remindersDue),
  };
}
