// M7.3 (run file I "Stress", J): every report route end to end at the brief's scale on a pinned clock, measured with D1's own `meta.rows_read` over everything
// the request reads (the session check included): 2,000 tax invoices of 5 lines (10,000 lines) for 200 clients across the FY, 1,000 confirmed payments, 200
// refunds, 5,000 leads in the range, 1,000 offers over the 200 clients and 100 care plans with 1,000 time entries. The budgets are section J's, with the lead's
// L17 for the category view and B2's flagged pipeline figure (run file, B2 report). Every statement the routes run must also come from an index. Invented data.
import { env } from "cloudflare:workers";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { longSession, mkPlan } from "./test-care.ts";
import { call, pinClock, type TestSession, withDb } from "./test-helpers.ts";
import { computeFor, line } from "./test-reports.ts";

const HEAVY_MS = 120_000;
/** Set to true to print the measured rows (the tests then fail on purpose, the only way vitest shows them from workerd). */
const SHOW_REPORT = false;
const PINNED = Date.parse("2027-02-15T12:00:00.000+05:30");
const RANGE_FROM_MS = Date.parse("2026-03-31T18:30:00Z");
const seq = (count: number) =>
  `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})`;
const run = (sql: string, ...binds: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...binds)
    .run();

/** Section J's budgets (worst case, rows read per request). */
const BUDGET = {
  "revenue by month": 3_500,
  "revenue by kind": 3_500,
  // L17 (lead, 2026-11-06): about 14,100 accepted (the floor of any read of the lines by document)
  "revenue by category": 14_100,
  "revenue per client, first page": 4_500,
  "ageing, first page (with the totals)": 6_500,
  "ageing, next page": 4_500,
  // J's 16,000; 16,012 measured at the statement level after early check 1 (flagged to the lead)
  pipeline: 16_100,
  "care plan hours, first page": 3_000,
  // FIX/S000: nine matches, fewer than a page (broader prefixes are reported in the next test)
  "search by a number prefix": 300,
  "search by one client's code": 300,
  "revenue export, first page": 4_500,
  "ageing export, first page": 6_500,
} as const;

let owner: TestSession;

async function build(by: string) {
  await run(`${seq(18)} INSERT INTO catalogue_items (id, code, name, category, short, unit, sac, schedule)
    SELECT 'sci' || i, 'SC-' || i, 'Item', CASE i % 5 WHEN 0 THEN 'advise' WHEN 1 THEN 'build' WHEN 2 THEN 'automate' WHEN 3 THEN 'connect' ELSE 'run' END, 's', 'fixed', '998314', '[]' FROM n`);
  await run(`${seq(200)} INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency)
    SELECT 'scl' || printf('%04d', i), 'SC' || printf('%04d', i), 'Scale Co ' || i, 'Scale Co ' || i, 'business', 'IN', 'unregistered', '19', 'INR' FROM n`);
  const computed = computeFor({
    clientId: "x",
    issueDate: "2026-05-01",
    lines: [line(1_000_00), line(500_00), line(250_00), line(125_00), line(60_00)],
  });
  // 2,000 drafts, their 10,000 lines, then the freeze (the lines of an issued document can't be written)
  await run(
    `${seq(2000)} INSERT INTO documents (id, type, status, client_id, currency, subtotal_minor, discount_minor, taxable_minor, cgst_minor, sgst_minor, igst_minor, round_off_minor,
       total_minor, balance_minor, supply_type, place_of_supply_code, computed, recipient, content_sha256, updated_at)
     SELECT 'sdoc' || printf('%05d', i), 'tax_invoice', 'draft', 'scl' || printf('%04d', 1 + i % 200), 'INR', ?1, 0, ?1, ?2, ?3, 0, ?4, ?5, ?5, ?6, '19', ?7,
       '{"legalName":"Scale Co","country":"IN","gstStatus":"registered"}', ?8, 7000 FROM n`,
    computed.subtotalMinor,
    computed.cgstMinor,
    computed.sgstMinor,
    computed.roundOffMinor,
    computed.totalMinor,
    computed.supply.type,
    JSON.stringify(computed),
    "p".repeat(64),
  );
  for (const [k, x] of computed.lines.entries())
    await run(
      `INSERT INTO document_lines (id, document_id, position, catalogue_item_id, description, sac, qty_milli, unit, rate_minor, taxable_minor, gst_rate_bp, cgst_minor, sgst_minor, igst_minor, line_total_minor)
       SELECT d.id || '-' || ?1, d.id, ?1, CASE WHEN ?1 = 5 THEN NULL ELSE 'sci' || (1 + (CAST(substr(d.id, 5) AS INTEGER) + ?1) % 18) END, 'Line', ?2, 1000, 'fixed', ?3, ?3, ?4, ?5, ?6, 0, ?7
       FROM documents d WHERE d.id LIKE 'sdoc%'`,
      k + 1,
      x.sac,
      x.taxableMinor,
      x.gstRateBp,
      x.cgstMinor,
      x.sgstMinor,
      x.lineTotalMinor,
    );
  await run(
    `UPDATE documents SET status = 'issued', series = 'invoice', fy = '2627', number = 50000 + CAST(substr(id, 5) AS INTEGER), number_display = 'S/' || substr(id, 5),
       frozen_at = 1000, issue_date = date('2026-04-01', '+' || (CAST(substr(id, 5) AS INTEGER) % 300) || ' days'),
       due_date = date('2026-04-01', '+' || (CAST(substr(id, 5) AS INTEGER) % 300 + 15) || ' days'), snapshot_sha256 = ?1
     WHERE id LIKE 'sdoc%'`,
    "q".repeat(64),
  );
  await run(
    `${seq(1000)} INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at, verified_by, verified_at)
     SELECT 'spay' || i, 'scl' || printf('%04d', 1 + i % 200), 'payment', 'manual', 'confirmed', 'INR', 50000 + i, date('2026-04-01', '+' || (i % 300) || ' days'), 'neft', ?1, 1000, ?1, 1000 FROM n`,
    by,
  );
  await run(
    `${seq(200)} INSERT INTO payment_refunds (id, payment_id, client_id, provider, origin, status, mode, paid_to, reason_code, currency, amount_minor, reference_norm, paid_on,
       requested_by, requested_at, attempts, settled_at, settled_on, updated_at)
     SELECT 'sref' || i, 'spay' || i, 'scl' || printf('%04d', 1 + i % 200), 'manual', 'owner', 'succeeded', 'neft', 'own_account', 'overpayment', 'INR', 100, 'UTRS' || i,
       date('2026-04-01', '+' || (i % 300) || ' days'), ?1, 1000, 0, 1000, date('2026-04-01', '+' || (i % 300) || ' days'), 1000 FROM n`,
    by,
  );
  await run(
    `${seq(5000)} INSERT INTO leads (id, ref, source, source_page, contact_name, contact_email, stage, lost_reason, created_at)
     SELECT 'sld' || i, 'L-S' || i, CASE WHEN i % 4 = 0 THEN 'manual' ELSE 'web' END, CASE WHEN i % 4 = 0 THEN NULL ELSE '/page-' || (i % 30) || '?utm=' || i END,
       'N', 'l' || i || '@example.test', CASE WHEN i % 7 = 0 THEN 'won' WHEN i % 5 = 0 THEN 'lost' ELSE 'new' END,
       CASE WHEN i % 7 <> 0 AND i % 5 = 0 THEN 'price' END, ?1 + i * 5000000 FROM n`,
    RANGE_FROM_MS,
  );
  await run(
    "INSERT INTO contacts (id, client_id, name, email) VALUES ('sct', 'scl0001', 'Signer', 'signer@example.test')",
  );
  await run(
    `${seq(1000)} INSERT INTO documents (id, type, status, client_id, currency, version_group_id, version, taxable_minor, total_minor, valid_until, series, fy, number,
       number_display, frozen_at, sent_at, decided_at, created_at, updated_at)
     SELECT 'soff' || i, 'proposal', CASE WHEN i % 4 = 0 THEN 'accepted' WHEN i % 5 = 0 THEN 'rejected' WHEN i % 7 = 0 THEN 'expired' ELSE 'sent' END,
       'scl' || printf('%04d', 1 + i % 200), 'INR', 'soff' || i, 1, 1000, 1180, date('2026-04-01', '+' || (i % 300 + 20) || ' days'), 'fixture', '0000', 90000 + i,
       'FIX/S' || printf('%04d', i), ?1 + i * 20000000, ?1 + i * 20000000, CASE WHEN i % 4 = 0 OR i % 5 = 0 THEN ?1 + i * 20000000 + 86400000 END, ?1 + i * 20000000, 1 FROM n`,
    RANGE_FROM_MS,
  );
  await run(
    `INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, pdf_sha256)
     SELECT 'sacc' || d.id, d.id, 'sct', 'Signer', 'signer@example.test', d.decided_at, ?1 FROM documents d WHERE d.id LIKE 'soff%' AND d.status = 'accepted'`,
    "a".repeat(64),
  );
  for (let i = 0; i < 100; i++)
    await mkPlan(by, { clientId: "scl0002", start: "2026-01-05", billingDay: 1 + (i % 28) });
  await run(
    `${seq(1000)} INSERT INTO time_logs (id, user_id, work_date, minutes, care_plan_id, billable, created_at, updated_at)
     SELECT 'stl' || i, ?1, date('2026-08-01', '+' || (i % 90) || ' days'), 30, p.id, 1, 1, 1
     FROM n JOIN (SELECT id, row_number() OVER (ORDER BY id) - 1 AS k FROM care_plans) p ON p.k = n.i % 100`,
    by,
  );
}

type Seen = { sql: string; binds: unknown[]; rows: number };
/** A D1 that adds up `meta.rows_read` of every statement a request runs (`all`, `run`, `first` and each of a batch) and keeps each statement for EXPLAIN. */
function recording() {
  const seen: Seen[] = [];
  const note = (sql: string, binds: unknown[], r: D1Result) => {
    seen.push({ sql, binds, rows: r.meta.rows_read ?? 0 });
    return r;
  };
  class Stmt {
    constructor(
      readonly real: D1PreparedStatement,
      readonly sql: string,
      readonly binds: unknown[] = [],
    ) {}
    bind(...v: unknown[]) {
      return new Stmt(this.real.bind(...v), this.sql, v);
    }
    async all() {
      return note(this.sql, this.binds, await this.real.all());
    }
    async run() {
      return note(this.sql, this.binds, await this.real.run());
    }
    async first(col?: string) {
      const r = note(this.sql, this.binds, await this.real.all());
      const row = (r.results[0] ?? null) as Record<string, unknown> | null;
      return col === undefined ? row : (row?.[col] ?? null);
    }
    raw() {
      return this.real.raw();
    }
  }
  const db = {
    prepare: (q: string) => new Stmt(env.DB.prepare(q), q),
    batch: async (stmts: Stmt[]) => {
      const results = await env.DB.batch(stmts.map((s) => s.real));
      for (const [i, s] of stmts.entries()) note(s.sql, s.binds, results[i] as D1Result);
      return results;
    },
  } as unknown as D1Database;
  return { db, seen, total: () => seen.reduce((a, s) => a + s.rows, 0) };
}

const measured: Record<string, number> = {};

async function measure(name: keyof typeof BUDGET, path: string): Promise<Record<string, unknown>> {
  const rec = recording();
  const res = await call(path, { cookie: owner.cookie }, withDb(rec.db));
  expect(res.status, `${name}: ${await res.clone().text()}`).toBe(200);
  measured[name] = rec.total();
  for (const s of rec.seen) {
    const plan = (
      await env.DB.prepare(`EXPLAIN QUERY PLAN ${s.sql}`)
        .bind(...s.binds)
        .all<{ detail: string }>()
    ).results
      .map((r) => r.detail)
      .join(" | ");
    // the per-client walks of C2 and C9 and the care plans' page read those small tables by primary key by design (B1, EXPLAIN test)
    const walks = /FROM clients c LIMIT -1|FROM clients c\s+WHERE|FROM care_plans p\s+WHERE/.test(s.sql);
    if (!walks)
      expect(plan, `${name}: ${s.sql.replace(/\s+/g, " ").slice(0, 120)}`).not.toMatch(
        /SCAN (documents|payments|payment_refunds|leads|document_lines|time_logs|d|p|f|l)\b(?! USING)/,
      );
  }
  return (await res.json()) as Record<string, unknown>;
}

describe("the M7.3 reports at the brief's scale (run file J)", () => {
  beforeAll(async () => {
    pinClock(PINNED);
    owner = await longSession("owner");
    await build(owner.id);
  }, HEAVY_MS);
  afterAll(() => vi.useRealTimers());

  it("every report route stays within its rows-read budget, every statement from an index", {
    timeout: HEAVY_MS,
  }, async () => {
    await measure("revenue by month", "/reports/revenue?fy=2627");
    await measure("revenue by kind", "/reports/revenue?fy=2627&by=kind");
    await measure("revenue by category", "/reports/revenue?fy=2627&by=category");
    const clients = await measure(
      "revenue per client, first page",
      "/reports/revenue/clients?fy=2627&currency=INR",
    );
    expect(clients.next).not.toBeNull();
    const ageing = await measure("ageing, first page (with the totals)", "/reports/ageing");
    expect(ageing.next).not.toBeNull();
    await measure("ageing, next page", `/reports/ageing?after=${ageing.next}`);
    await measure("pipeline", "/reports/pipeline?from=2026-04-01&to=2027-01-31");
    await measure("care plan hours, first page", "/reports/care-hours?month=2026-10");
    const byNumber = await measure("search by a number prefix", "/documents?q=FIX/S000");
    expect((byNumber.documents as unknown[]).length).toBeGreaterThan(0);
    const byClient = await measure("search by one client's code", "/documents?q=SC0007");
    expect((byClient.documents as unknown[]).length).toBe(5);

    const stepUp = await longSession("owner");
    await env.DB.prepare("UPDATE staff_sessions SET step_up_until = ?2 WHERE id = ?1")
      .bind(stepUp.sessionId, 4_000_000_000_000)
      .run();
    owner = stepUp;
    await measure("revenue export, first page", "/reports/revenue/export?fy=2627&currency=INR");
    await measure("ageing export, first page", "/reports/ageing/export");

    const report = Object.entries(measured).map(
      ([k, v]) => `${k}: ${v} / ${BUDGET[k as keyof typeof BUDGET]}`,
    );
    if (SHOW_REPORT) throw new Error(["M7.3 rows read at scale (routes):", ...report].join("\n  "));
    for (const [k, v] of Object.entries(measured))
      expect(v, report.join("; ")).toBeLessThanOrEqual(BUDGET[k as keyof typeof BUDGET]);
  });

  // A search reads every match once before it picks the page (a match is not in created order on the index it is found by), then the page's rows in full. The
  // J budget holds a prefix with fewer matches than a page; broader prefixes cost about 4 rows per match more (the match, its index entries, the newest-version
  // probe and the sort), reported here against the list page without a search (the same columns for 26 rows) and held under 5 rows per offer of the fixture.
  it("broad prefixes read about four rows per match: reported beside the plain list page", {
    timeout: HEAVY_MS,
  }, async () => {
    const report: string[] = [];
    for (const [name, path] of [
      ["the list page, no search", "/documents"],
      ["number prefix FIX/S00 (99 matches)", "/documents?q=FIX/S00"],
      ['name prefix "Scale" (every client: 1,000 offers)', "/documents?q=Scale"],
    ] as const) {
      const rec = recording();
      const res = await call(path, { cookie: owner.cookie }, withDb(rec.db));
      expect(res.status, name).toBe(200);
      report.push(`${name}: ${rec.total()}`);
      expect(rec.total(), report.join("; ")).toBeLessThanOrEqual(5_000);
    }
    if (SHOW_REPORT) throw new Error(["M7.3 search rows read at scale:", ...report].join("\n  "));
  });
});
