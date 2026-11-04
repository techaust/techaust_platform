// The owners' weekly digest's figures (M7.2; JOB-CRON-03, ADM-DASH-02; run file docs/runs/m7.2-notifications.md B, D, L7). Aggregates only, every statement the
// dashboard's own (one source; M7.3's dashboard v2 builds on this module): the pipeline (moved here from the admin dashboard), invoiced, collected and overdue
// (the finance tile's `INVOICED_SQL`, `COLLECTED_TILE_SQL`, `OWED_SQL`), new leads (the leads tile's last-7-days count) and the payment reminders due in the next 7
// days. The jobs consumer runs them in its one read batch with the owners and their switches (B2); a parity test holds them to the dashboard's answer.

import { fyOfDate, istDate, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import type { CurrencyFigure, DigestFigures } from "@techaust/core/digest";
import type { Currency } from "@techaust/core/money";
import { COLLECTED_TILE_SQL } from "./ledger.ts";
import { INVOICED_SQL, OWED_SQL } from "./reports.ts";

const DAY_MS = 86_400_000;

/**
 * The pipeline value (M4.3, ADM-DASH-01, a lead call: before tax): the offers out and still acceptable, by currency. A document is out while it is
 * `sent` or `viewed` and its `valid_until` (IST date) is today or later. No "latest version" probe is needed: sending version n moves the sent
 * versions before it to `revised` in the same batch, so at most one version of a group is ever sent or viewed. Both offer types count. The
 * index is `documents_status_valid_until`; the unary plus keeps the type test from tempting the planner away from it. (Moved here from
 * `apps/admin/worker/dashboard.ts` in M7.2; the dashboard imports it.)
 */
export const PIPELINE_SQL =
  "SELECT currency, count(*) AS n, coalesce(sum(taxable_minor), 0) AS taxable FROM documents INDEXED BY documents_status_valid_until WHERE status IN ('sent', 'viewed') AND valid_until >= ?1 AND +type IN ('proposal', 'estimate') GROUP BY currency ORDER BY currency";

/** Leads created since `?1` (the dashboard's "new in the last 7 days"; index `leads_created`). */
export const NEW_LEADS_SQL = "SELECT count(*) AS n FROM leads WHERE created_at >= ?1";

/** Payment reminders still waiting (not sent, not skipped) and due in `[?1, ?2)` (the partial index `reminders_pending`). */
export const REMINDERS_DUE_SQL =
  "SELECT count(*) AS n FROM reminders INDEXED BY reminders_pending WHERE sent_at IS NULL AND skipped_reason IS NULL AND due_at >= ?1 AND due_at < ?2";

/** The digest's dates, as the dashboard computes them for the same moment: today (IST), this FY and this IST month. */
export type DigestWindow = { now: number; today: string; fyFrom: string; fyTo: string; monthFrom: string };

export function digestWindowOf(now: number): DigestWindow {
  const today = toIsoDate(istDate(now));
  const fy = fyOfDate(parseIsoDate(today) as NonNullable<ReturnType<typeof parseIsoDate>>);
  return {
    now,
    today,
    fyFrom: `${fy.startYear}-04-01`,
    fyTo: `${fy.startYear + 1}-03-31`,
    monthFrom: `${today.slice(0, 7)}-01`,
  };
}

/** The digest's six reads, in this order (`digestFiguresOf` reads them back). */
export function digestStatements(db: Pick<D1Database, "prepare">, w: DigestWindow): D1PreparedStatement[] {
  return [
    db.prepare(PIPELINE_SQL).bind(w.today),
    db.prepare(INVOICED_SQL).bind(w.fyFrom, w.fyTo, w.monthFrom),
    db.prepare(COLLECTED_TILE_SQL).bind(w.fyFrom, w.fyTo, w.monthFrom, w.today),
    db.prepare(OWED_SQL).bind(w.today),
    db.prepare(NEW_LEADS_SQL).bind(w.now - 7 * DAY_MS),
    db.prepare(REMINDERS_DUE_SQL).bind(w.now, w.now + 7 * DAY_MS),
  ];
}
export const DIGEST_STATEMENTS = 6;

type Rows = { results?: unknown[] } | undefined;
const rowsOf = <T>(r: Rows): T[] => (r?.results ?? []) as T[];
const fig = (currency: string, count: number, amountMinor: number | null): CurrencyFigure => ({
  currency: currency as Currency,
  count,
  amountMinor: amountMinor ?? 0,
});

/** The figures from the six results (`results` from index `at`): the same row reading the dashboard does for its tiles. */
export function digestFiguresOf(results: readonly Rows[], at = 0): DigestFigures {
  const r = (i: number) => results[at + i];
  return {
    pipeline: rowsOf<{ currency: string; n: number; taxable: number }>(r(0)).map((x) =>
      fig(x.currency, x.n, x.taxable),
    ),
    invoicedMonth: rowsOf<{ currency: string; month_documents: number; month_total: number }>(r(1))
      .filter((x) => x.month_documents > 0)
      .map((x) => fig(x.currency, x.month_documents, x.month_total)),
    collectedMonth: rowsOf<{ currency: string; month_n: number; month_collected: number }>(r(2))
      .filter((x) => x.month_n > 0)
      .map((x) => fig(x.currency, x.month_n, x.month_collected)),
    overdue: rowsOf<{ currency: string; overdue_n: number; overdue_balance: number }>(r(3))
      .filter((x) => x.overdue_n > 0)
      .map((x) => fig(x.currency, x.overdue_n, x.overdue_balance)),
    newLeads: rowsOf<{ n: number }>(r(4))[0]?.n ?? 0,
    remindersDue: rowsOf<{ n: number }>(r(5))[0]?.n ?? 0,
  };
}
