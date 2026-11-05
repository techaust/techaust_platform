// The typed client of the M7.3 report routes (run file C1 to C4, C6, C9; B1 and B2 reports): revenue and collections and its per-client pages, the ageing pages,
// the pipeline and care plan hours, and the two export twins (`exports.gst`: `request` opens the step-up dialog when the server asks, then sends the same page
// again). Its own module, so only the reports chunk carries it. The JSON shapes are core's (`@techaust/core/reports`), as the Workers answer them.
import type {
  AgeingRow,
  CareHoursRow,
  PipelineReport,
  RevenueByKey,
  RevenueByMonth,
  RevenueClientRow,
} from "@techaust/core/reports";
import { type Currency, qs, request } from "../api.ts";

export type RevenueView = "month" | "category" | "kind";
export type RevenueAnswer = RevenueByMonth | RevenueByKey<string>;

export type RevenueClientsPage = {
  fy: string;
  from: string;
  to: string;
  currency: Currency;
  rows: RevenueClientRow[];
  next: string | null;
};

export type AgeingTotals = { currency: Currency; buckets: AgeingRow["buckets"]; totalMinor: number };
export type AgeingPage = {
  asOf: string;
  rows: AgeingRow[];
  /** the first page only */
  totals: AgeingTotals[] | null;
  next: string | null;
};

export type CareHoursPage = { month: string; today: string; rows: CareHoursRow[]; next: string | null };

export const m73Api = {
  revenue: (fy: string, by: RevenueView) => request<RevenueAnswer>(`/reports/revenue${qs({ fy, by })}`),
  revenueClients: (fy: string, currency: Currency, after?: string) =>
    request<RevenueClientsPage>(`/reports/revenue/clients${qs({ fy, currency, after })}`),
  /** C6: the same page under `exports.gst` (a fresh code; one audit row per page). */
  revenueExport: (fy: string, currency: Currency, after?: string) =>
    request<RevenueClientsPage>(`/reports/revenue/export${qs({ fy, currency, after })}`),
  ageing: (after?: string) => request<AgeingPage>(`/reports/ageing${qs({ after })}`),
  ageingExport: (after?: string) => request<AgeingPage>(`/reports/ageing/export${qs({ after })}`),
  pipeline: (from: string, to: string) => request<PipelineReport>(`/reports/pipeline${qs({ from, to })}`),
  careHours: (month: string, after?: string) =>
    request<CareHoursPage>(`/reports/care-hours${qs({ month, after })}`),
};

/** Every page of an export, in order; `onProgress` hears the running count; `stopped` ends it quietly (the screen closed). */
export async function readPages<R, P extends { rows: R[]; next: string | null }>(
  page: (after?: string) => Promise<P>,
  onProgress: (count: number) => void,
  stopped: () => boolean = () => false,
): Promise<{ rows: R[]; first: P } | null> {
  const rows: R[] = [];
  let first: P | null = null;
  let after: string | undefined;
  do {
    const p = await page(after);
    if (stopped()) return null;
    first ??= p;
    rows.push(...p.rows);
    onProgress(rows.length);
    after = p.next ?? undefined;
  } while (after);
  return { rows, first: first as P };
}
