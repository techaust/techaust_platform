// M6.5 rows read at 2,000 documents (early check 2, "B2's not done": `stageOpenSql` in the jobs realisation scan, and the Payments panel's new reads) [NFR-2,
// ADM-PAY-08, ADM-PAY-09, ADM-INV-17]. D1 charges for rows read; the M5.5 target is at most 9,000 rows for the dashboard's finance tile at 2,000 documents, and
// the per-invoice reads must not grow with the table. The fixture is the worst case for `stageOpenSql`: 2,000 USD exports under LUT spread over two years, every
// one paid in full (balance 0), so each stays "open" only through `supply_type = 'export_lut'` (RA-38's proof) and the reduction check (RB-43); 500 of their
// payments also left credit that was partly refunded (manual refunds that succeeded). The figures are printed (`m65.rows_read`) for the run file and held under
// measured bounds, so a lost index or a new scan fails here. Local workerd, not the Free plan's metered CPU. Invented test data.
import { env } from "cloudflare:workers";
import { addDays, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { issueDateOf } from "@techaust/core/invoices";
import { REFUNDS_IDLE_SQL } from "@techaust/db/refunds";
import { REALISATION_SCAN_SQL, realisationScanBinds } from "@techaust/db/reports";
import { describe, expect, it } from "vitest";
import { PANEL_RECEIPTS_SQL, PANEL_REFUNDS_SQL } from "./payment-ledger.ts";
import { call, sessionFor, withDb } from "./test-helpers.ts";
import { addDoc, mkReportClient } from "./test-reports.ts";

const HEAVY_MS = 120_000;
/** Set to true to print the figures (the test then fails on purpose, which is the only way the workerd pool shows them). */
const SHOW_REPORT = false;
const RULES = {
  femaMonthsForeign: 9,
  femaMonthsInr: 12,
  gstMonths: 12,
  gstExtraDays: 15,
  approachingDays: 30,
};

/** A D1 that sums `meta.rows_read` of every statement it runs (batches and single statements). */
function rowsReadDb() {
  const total = { n: 0, batches: [] as number[][] };
  const add = (r: unknown) => {
    const m = (r as { meta?: { rows_read?: number } } | null)?.meta;
    total.n += m?.rows_read ?? 0;
  };
  const real = env.DB;
  const unwrap = new WeakMap<object, D1PreparedStatement>();
  const wrap = (st: D1PreparedStatement): D1PreparedStatement => {
    const w = new Proxy(st, {
      get(ts, k) {
        if (k === "bind") return (...v: unknown[]) => wrap(ts.bind(...v));
        if (k === "run" || k === "all")
          return async (...a: unknown[]) => {
            const r = await (Reflect.get(ts, k) as (...x: unknown[]) => Promise<unknown>).apply(ts, a);
            add(r);
            return r;
          };
        const v = Reflect.get(ts, k);
        return typeof v === "function" ? v.bind(ts) : v;
      },
    });
    unwrap.set(w, st);
    return w;
  };
  const db = new Proxy(real, {
    get(t, k) {
      if (k === "prepare") return (q: string) => wrap(t.prepare(q));
      if (k === "batch")
        return async (stmts: D1PreparedStatement[]) => {
          const rs = await t.batch(stmts.map((s) => unwrap.get(s) ?? s));
          for (const r of rs) add(r);
          total.batches.push(rs.map((r) => (r as { meta?: { rows_read?: number } }).meta?.rows_read ?? 0));
          return rs;
        };
      const v = Reflect.get(t, k);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  return { db, total };
}

describe("M6.5 rows read at 2,000 documents [NFR-2]", () => {
  it(
    "the realisation scan with stageOpenSql, the Payments panel's receipts and refunds, the refund sweep",
    async () => {
      const today = issueDateOf(Date.now());
      const usd = await mkReportClient("USD");
      const o = await sessionFor("owner");
      const day = parseIsoDate(today) as NonNullable<ReturnType<typeof parseIsoDate>>;
      for (let i = 0; i < 2_000; i++)
        await addDoc({
          clientId: usd,
          currency: "USD",
          issueDate: toIsoDate(addDays(day, -(1 + (i % 700)))),
        });
      // every export paid in full by one confirmed bank payment (balance 0): open only through stageOpenSql's LUT and reduction tests; 500 of the payments
      // brought USD 10.00 more (held as credit), and USD 1.00 of each went back by a manual refund that succeeded
      await env.DB.prepare(
        `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at, verified_by, verified_at)
         SELECT 'pf-' || d.id, d.client_id, 'payment', 'manual', 'confirmed', 'USD',
           d.total_minor + CASE WHEN d.id IN (SELECT x.id FROM documents x WHERE x.client_id = ?2 ORDER BY x.id LIMIT 500) THEN 1000 ELSE 0 END,
           d.issue_date, 'swift', ?1, 1, ?1, 1
         FROM documents d WHERE d.client_id = ?2`,
      )
        .bind(o.id, usd)
        .run();
      await env.DB.prepare(
        `INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_by, created_at)
         SELECT 'af-' || d.id, 'pf-' || d.id, d.id, d.total_minor, 'allocate', ?1, 1 FROM documents d WHERE d.client_id = ?2`,
      )
        .bind(o.id, usd)
        .run();
      await env.DB.prepare(
        "UPDATE documents SET paid_minor = total_minor, balance_minor = 0, status = 'paid' WHERE client_id = ?1",
      )
        .bind(usd)
        .run();
      await env.DB.prepare(
        `INSERT INTO payment_refunds (id, payment_id, client_id, provider, origin, status, mode, paid_to, reason_code, currency, amount_minor, reference_norm, paid_on,
           requested_by, requested_at, settled_at, settled_on, updated_at)
         SELECT 'rf-' || p.id, p.id, p.client_id, 'manual', 'owner', 'succeeded', 'swift', 'own_account', 'overpayment', 'USD', 100, 'SWIFTRF' || substr(p.id, -12),
           ?2, ?1, 2, 2, ?2, 2 FROM payments p WHERE p.id LIKE 'pf-%' AND p.client_id = ?3 AND p.amount_minor > (SELECT d.total_minor FROM documents d WHERE d.id = substr(p.id, 4))`,
      )
        .bind(o.id, today, usd)
        .run();
      const n = await env.DB.prepare("SELECT count(*) AS n FROM payment_refunds WHERE id LIKE 'rf-%'").first<{
        n: number;
      }>();
      expect(n?.n).toBe(500);

      const readOf = async (sql: string, ...binds: unknown[]) => {
        const r = await env.DB.prepare(sql)
          .bind(...binds)
          .all();
        return { rows: r.results.length, read: r.meta.rows_read as number };
      };
      // (1) the jobs realisation scan (one page of at most 51), today's binds
      const scan = await readOf(REALISATION_SCAN_SQL(false), ...realisationScanBinds(today, RULES));
      // (2) the Payments panel's two M6.5 reads for one export whose payment has a refund (the worst document)
      const docId = (
        await env.DB.prepare(
          "SELECT d.id FROM documents d WHERE d.client_id = ?1 AND EXISTS (SELECT 1 FROM payment_allocations a WHERE a.document_id = d.id AND EXISTS (SELECT 1 FROM payment_refunds rr WHERE rr.payment_id = a.payment_id)) LIMIT 1",
        )
          .bind(usd)
          .first<{ id: string }>()
      )?.id as string;
      const receipts = await readOf(PANEL_RECEIPTS_SQL, docId);
      const refunds = await readOf(PANEL_REFUNDS_SQL, docId);
      const refundsPlan = (
        await env.DB.prepare(`EXPLAIN QUERY PLAN ${PANEL_REFUNDS_SQL}`).bind(docId).all<{ detail: string }>()
      ).results
        .map((r) => r.detail)
        .join(" | ");
      // (3) the whole panel route, every statement of its batch
      const counted = rowsReadDb();
      const res = await call(`/invoices/${docId}/payments`, { cookie: o.cookie }, withDb(counted.db));
      expect(res.status, await res.clone().text()).toBe(200);
      const panel = counted.total.n;
      // (4) the hourly refund sweep (no open refund here: the partial index holds none)
      const sweep = await readOf(REFUNDS_IDLE_SQL, Date.now());
      const report = `m65.rows_read ${JSON.stringify({ scan, receipts, refunds, panelRoute: panel, panelBatches: counted.total.batches, refundSweep: sweep, refundsPlan })}`;
      // the workerd pool shows no console output of a passing test: set SHOW_REPORT to see the figures (the test then fails on purpose, as dashboard-stress)
      expect(SHOW_REPORT ? report : "", report).toBe("");
      // Bounds (measured 2026-11-03, Builder B3): the scan 2,717 rows for 0 alerts (every LUT export is walked: under the 9,000-row target, but it grows with the
      // history, a follow-up); the panel's receipts 8 and refunds 7 (MULTI-INDEX OR, no scan of payment_refunds); the whole panel route 7,027, of which 6,999 are
      // the client's credit (one pass over the client's 2,000 confirmed payments, M6.1's read with M6.5's refunds subtracted) and 1 the waiting entries
      // (2,002 through `payments_client` before B3 moved it to `payments_pending`); the refund sweep 1.
      expect(scan.read, JSON.stringify(scan)).toBeLessThanOrEqual(9_000);
      expect(receipts.read, JSON.stringify(receipts)).toBeLessThanOrEqual(30);
      expect(refunds.read, JSON.stringify(refunds)).toBeLessThanOrEqual(30);
      expect(refundsPlan).not.toMatch(/SCAN r\b/);
      expect(panel, JSON.stringify(counted.total.batches)).toBeLessThanOrEqual(7_500);
      expect(sweep.read).toBeLessThanOrEqual(5);
    },
    HEAVY_MS,
  );
});
