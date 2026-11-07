// M7.3 (ADM-REP-01, -02, -03, -05; run file docs/runs/m7.3-reports.md I): the report statements against their grouped twins and against the ledger's own figures.
// Σ by month = by kind = by category (+ round-off) = `INVOICED_SQL` for the FY; collected = `COLLECTED_SQL` = the dashboard tile; ageing Σ buckets = `OWED_SQL`;
// every SQL twin equals its core rule; every statement is served by an index and stays inside D1's limits (it runs). Invented test data only.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import {
  LEAD_STAGES as CORE_LEAD_STAGES,
  LOST_REASONS as CORE_LOST_REASONS,
} from "@techaust/core/lead-lifecycle";
import {
  AGEING_BUCKETS,
  ageingBucket,
  carePeriodDays,
  NO_CATEGORY,
  previousMonthOf,
  REVENUE_KINDS,
  revenueKind,
  SOURCE_PATH_MAX,
  sourcePath,
} from "@techaust/core/reports";
import { describe, expect, it } from "vitest";
import { COLLECTED_SQL, COLLECTED_TILE_SQL, clientCreditSql } from "../src/ledger.ts";
import {
  AGEING_GROUPED_SQL,
  AGEING_PAGE_SQL,
  AGEING_TOTALS_SQL,
  type AgeingSqlRow,
  type AgeingTotalsSqlRow,
  ageingBucketSql,
  type CategorySqlRow,
  INVOICED_SQL,
  type KeyedSqlRow,
  OWED_SQL,
  PAYMENTS_REGISTER_SQL,
  REFUNDS_REGISTER_SQL,
  REVENUE_CATEGORY_GROUPED_SQL,
  REVENUE_CATEGORY_SQL,
  REVENUE_CLIENTS_SQL,
  REVENUE_KIND_GROUPED_SQL,
  REVENUE_KIND_SQL,
  REVENUE_MONTHS_GROUPED_SQL,
  REVENUE_MONTHS_SQL,
  REVENUE_ROUND_OFF_GROUPED_SQL,
  type RevenueClientSqlRow,
  type RevenueMonthSqlRow,
  revenueClientsBinds,
  revenueKindSql,
  SQL_AGEING_BUCKETS,
  SQL_CATEGORY_KEYS,
  SQL_REVENUE_KINDS,
} from "../src/reports.ts";
import {
  CARE_HOURS_BILLED_SQL,
  CARE_HOURS_PAGE_SQL,
  COHORT_COUNT_NAMES,
  carePeriodDaySql,
  carePeriodFirstDaySql,
  LEAD_COHORT_SQL,
  OFFERS_DECIDED_SQL,
  OFFERS_SENT_GROUPED_SQL,
  OFFERS_SENT_SQL,
  OPEN_TREND_SQL,
  SQL_LEAD_SOURCES,
  SQL_LEAD_STAGES,
  SQL_LOST_REASONS,
  SQL_SOURCE_PATH_MAX,
  sourcePathSql,
  TIME_TO_WIN_MEDIAN_SQL,
} from "../src/reports-delivery.ts";
import { CATEGORIES, LEAD_SOURCES, LEAD_STAGES, LOST_REASONS } from "../src/schema/index.ts";
import { mkCarePlan, mkMember } from "./billing-helpers.ts";
import { all, first, run, TEST_SIGNATURE } from "./helpers.ts";
import { addDoc, computeFor, line, mkClient, type Spec } from "./reports-helpers.ts";

const FY = { from: "2026-04-01", to: "2027-03-31" };
const T = 1_700_000_000_000;

const plan = async (sql: string, ...binds: unknown[]): Promise<string> =>
  (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...binds)).map((r) => r.detail).join("\n");
/**
 * A table scan (a SEARCH is fine): any of the tables these statements read, by name or alias. M6–M7 audit AU37: the walk of a CO-ROUTINE (a FROM subquery
 * whose own reads are listed above it, e.g. `refundsOutSql`'s two index SEARCHes) is no table scan, so a `SCAN <name>` of a co-routine of the plan is left out.
 */
const scansTable = (p: string) => {
  const coroutines = new Set([...p.matchAll(/CO-ROUTINE (\w+)/g)].map((m) => m[1]));
  return p.split("\n").some((line) => {
    const m =
      /SCAN (documents|payments|payment_refunds|leads|clients|care_plans|d|p|f|l|c|n)\b(?! USING)/.exec(line);
    return m !== null && !coroutines.has(m[1]);
  });
};
const rowsRead = async (sql: string, ...binds: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...binds)
      .all()
  ).meta.rows_read;

// ---- fixture ---------------------------------------------------------------------------------------------------------------------------------------------

async function catalogueItem(category: string): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO catalogue_items (id, code, name, category, short, unit, sac, schedule) VALUES (?1, ?2, 'Item', ?3, 's', 'fixed', '998314', '[]')",
    id,
    `T-${id.slice(-8)}`,
    category,
  );
  return id;
}

let docSeq = 600;
/**
 * A frozen document with its lines (positions 1..n, `lineRows`' rule), each with its catalogue item (or none): inserted as a draft, its lines added, then frozen
 * (the lines of an issued document can't be written).
 */
async function doc(spec: Spec, items: (string | null)[] = []) {
  const { voided, ...draftSpec } = spec;
  const d = await addDoc({ ...draftSpec, frozen: false });
  const computed = d.computed;
  const type = spec.type ?? (computed.currency === "USD" ? "export_invoice" : "tax_invoice");
  const series = {
    tax_invoice: "invoice",
    export_invoice: "export",
    credit_note: "creditNote",
    debit_note: "debitNote",
    proforma: "proforma",
  }[type];
  for (const [i, l] of computed.lines.entries()) {
    await run(
      `INSERT INTO document_lines (id, document_id, position, catalogue_item_id, description, sac, qty_milli, unit, rate_minor, taxable_minor, gst_rate_bp, cgst_minor, sgst_minor, igst_minor, line_total_minor)
       VALUES (?1, ?2, ?3, ?4, 'Line', ?5, 1000, 'fixed', ?6, ?6, ?7, ?8, ?9, ?10, ?11)`,
      uuidv7(),
      d.id,
      i + 1,
      items[i] ?? null,
      l.sac,
      l.taxableMinor,
      l.gstRateBp,
      l.cgstMinor,
      l.sgstMinor,
      l.igstMinor,
      l.lineTotalMinor,
    );
  }
  const n = ++docSeq;
  await run(
    `UPDATE documents SET status = ?2, series = ?3, fy = '2627', number = ?4, number_display = ?5, frozen_at = 1000, issue_date = ?6, snapshot_sha256 = ?7,
       voided_at = ?8, void_reason = ?9, ims_status = CASE type WHEN 'credit_note' THEN 'not_applicable' END WHERE id = ?1`,
    d.id,
    spec.status ?? "issued",
    series,
    n,
    `${series.slice(0, 1).toUpperCase()}/R${n}`,
    spec.issueDate,
    "q".repeat(64),
    null,
    null,
  );
  // a draft can't be voided: issue it, then void it
  if (voided)
    await run("UPDATE documents SET status = 'void', voided_at = 5, void_reason = 'x' WHERE id = ?1", d.id);
  return d;
}

async function pay(o: {
  clientId: string;
  owner: string;
  kind?: "payment" | "tds";
  status?: "confirmed" | "pending_verification" | "rejected";
  currency?: "INR" | "USD";
  amount: number;
  on: string;
  inr?: number | null;
}): Promise<string> {
  const id = uuidv7();
  const kind = o.kind ?? "payment";
  if (o.status === "rejected") {
    // a manual payment starts pending; the Owner's decision rejects it
    const p = await pay({ ...o, status: "pending_verification" });
    await run(
      "UPDATE payments SET status = 'rejected', verified_by = ?2, verified_at = ?3, decision_note = 'Not ours' WHERE id = ?1",
      p,
      o.owner,
      T + 1,
    );
    return p;
  }
  const status = o.status ?? "confirmed";
  await run(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, tds_section, tds_rate_bp, inr_received_minor, recorded_by, recorded_at, verified_by, verified_at)
     VALUES (?1, ?2, ?3, 'manual', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
    id,
    o.clientId,
    kind,
    status,
    o.currency ?? "INR",
    o.amount,
    o.on,
    kind === "tds" ? null : o.currency === "USD" ? "swift" : "neft",
    kind === "tds" ? "194J" : null,
    kind === "tds" ? 1000 : null,
    o.inr ?? null,
    o.owner,
    T,
    status === "pending_verification" ? null : o.owner,
    status === "pending_verification" ? null : T,
  );
  return id;
}

async function refund(o: {
  paymentId: string;
  clientId: string;
  owner: string;
  currency?: "INR" | "USD";
  amount: number;
  on: string;
  inr?: number | null;
}) {
  const id = uuidv7();
  await run(
    `INSERT INTO payment_refunds (id, payment_id, client_id, provider, origin, status, mode, paid_to, reason_code, currency, amount_minor, inr_refunded_minor, reference_norm,
       paid_on, requested_by, requested_at, attempts, settled_at, settled_on, updated_at)
     VALUES (?1, ?2, ?3, 'manual', 'owner', 'succeeded', 'neft', 'own_account', 'overpayment', ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, ?10, ?8, ?10)`,
    id,
    o.paymentId,
    o.clientId,
    o.currency ?? "INR",
    o.amount,
    o.inr ?? null,
    `UTR${id.slice(-10)}`,
    o.on,
    o.owner,
    T,
  );
  return id;
}

const noteExtras = (takes: { line: number; taxableMinor: number }[]) => ({
  noteOf: { request: { mode: "lines", takes } },
});

type Fixture = Awaited<ReturnType<typeof build>>;
let built: Promise<Fixture> | null = null;
const fixture = () => {
  built ??= build();
  return built;
};

async function build() {
  const owner = await mkMember("owner");
  const catBuild = await catalogueItem("build");
  const catRun = await catalogueItem("run");
  const inr = await mkClient();
  const usd = await mkClient({ currency: "USD", country: "US", gst_status: "overseas", state_code: null });
  const projectId = uuidv7();
  await run(
    "INSERT INTO projects (id, code, client_id, name, currency) VALUES (?1, ?2, ?3, 'P', 'INR')",
    projectId,
    `P-${projectId.slice(-6)}`,
    inr,
  );
  const care = await mkCarePlan(inr, owner);

  const inv1 = await doc(
    {
      clientId: inr,
      issueDate: "2026-05-10",
      lines: [line(1_000_00), line(500_01, { sac: "998313" })],
      dueDate: "2026-06-10",
      over: { project_id: projectId },
    },
    [catBuild, catRun],
  );
  const inv2 = await doc(
    {
      clientId: inr,
      issueDate: "2026-06-15",
      lines: [line(2_000_00)],
      dueDate: "2026-12-01",
      over: { care_plan_id: care.planId },
    },
    [null],
  );
  // a credit note on inv1's second line (category "run" through its parent) and a debit note on its first ("build")
  const cn = await doc({
    type: "credit_note",
    clientId: inr,
    issueDate: "2026-06-20",
    parentId: inv1.id,
    lines: [line(300_00, { sac: "998313" })],
    dueDate: null,
    headerExtras: noteExtras([{ line: 1, taxableMinor: 300_00 }]),
    issuer: { signature: TEST_SIGNATURE },
  });
  const dn = await doc({
    type: "debit_note",
    clientId: inr,
    issueDate: "2026-07-01",
    parentId: inv1.id,
    lines: [line(100_00)],
    dueDate: "2026-07-15",
    headerExtras: noteExtras([{ line: 0, taxableMinor: 100_00 }]),
    issuer: { signature: TEST_SIGNATURE },
  });
  // never counted, each with a "build" line so a leak into the category view shows (early check 4): a voided invoice, a proforma, an invoice of the FY before
  await doc({ clientId: inr, issueDate: "2026-05-11", voided: true, lines: [line(9_999_00)] }, [catBuild]);
  await doc({ type: "proforma", clientId: inr, issueDate: "2026-05-12", lines: [line(7_777_00)] }, [
    catBuild,
  ]);
  await doc({ clientId: inr, issueDate: "2026-03-31", lines: [line(4_444_00)] }, [catBuild]);
  const exp1 = await doc(
    {
      currency: "USD",
      clientId: usd,
      issueDate: "2026-08-05",
      lines: [line(1_000_00), line(250_00)],
      dueDate: "2026-09-05",
    },
    [catBuild, null],
  );
  // a USD document with no INR view: its month's INR figure is NULL, never 0
  const bare = computeFor({ currency: "USD", clientId: usd, issueDate: "2026-09-02", lines: [line(400_00)] });
  const exp2 = await doc(
    {
      currency: "USD",
      clientId: usd,
      issueDate: "2026-09-02",
      dueDate: "2026-12-30",
      computed: { ...bare, inr: null, lines: bare.lines.map((l) => ({ ...l, inr: null })) },
      over: { total_inr_minor: null },
    },
    [catRun],
  );

  const p1 = await pay({ clientId: inr, owner, amount: 1_000_00, on: "2026-05-20" });
  await pay({ clientId: inr, owner, kind: "tds", amount: 20_00, on: "2026-05-21" });
  await pay({ clientId: inr, owner, status: "pending_verification", amount: 55_00, on: "2026-05-22" });
  await pay({ clientId: inr, owner, status: "rejected", amount: 66_00, on: "2026-05-23" });
  await pay({ clientId: usd, owner, currency: "USD", amount: 500_00, on: "2026-08-20", inr: 41_000_00 });
  await pay({ clientId: usd, owner, currency: "USD", amount: 100_00, on: "2026-09-01" }); // no INR advised
  await refund({ paymentId: p1, clientId: inr, owner, amount: 100_00, on: "2026-06-02" });
  return { owner, inr, usd, inv1, inv2, cn, dn, exp1, exp2, care, projectId, catBuild, catRun };
}

// ---- the twins of core ------------------------------------------------------------------------------------------------------------------------------------

describe("the SQL twins equal their core rules", () => {
  it("lists: buckets, kinds, categories, lead stages, reasons and sources match core and the schema", () => {
    expect([...SQL_AGEING_BUCKETS]).toEqual([...AGEING_BUCKETS]);
    expect([...SQL_REVENUE_KINDS]).toEqual([...REVENUE_KINDS]);
    expect([...SQL_CATEGORY_KEYS]).toEqual([...CATEGORIES, NO_CATEGORY]);
    expect([...SQL_LEAD_STAGES]).toEqual([...LEAD_STAGES]);
    expect([...SQL_LEAD_STAGES]).toEqual([...CORE_LEAD_STAGES]);
    expect([...SQL_LOST_REASONS]).toEqual([...LOST_REASONS]);
    expect([...SQL_LOST_REASONS]).toEqual([...CORE_LOST_REASONS]);
    expect([...SQL_LEAD_SOURCES]).toEqual([...LEAD_SOURCES]);
  });

  it("ageingBucketSql = ageingBucket for every due day around today, leap years and no due date included", async () => {
    for (const today of ["2026-10-15", "2028-03-30", "2027-04-01", "2028-02-29"]) {
      const t = new Date(`${today}T00:00:00Z`).getTime();
      const dues: (string | null)[] = [null];
      for (let k = -5; k <= 400; k++) dues.push(new Date(t - k * 86_400_000).toISOString().slice(0, 10));
      const got = await all<{ due: string | null; b: string }>(
        `SELECT j.value AS due, ${ageingBucketSql("j.value", "?2")} AS b FROM json_each(?1) j ORDER BY j.key`,
        JSON.stringify(dues),
        today,
      );
      expect(got.map((r) => r.b)).toEqual(dues.map((d) => ageingBucket(d, today)));
    }
  });

  it("sourcePathSql = sourcePath (query strings, fragments, unicode, empty)", async () => {
    const pages = [
      "/a?b#c",
      "/x#y?z",
      "?",
      "#",
      "",
      "/",
      "/plain",
      "/q?",
      "/h#",
      "/ünï?cødé#x",
      "/emoji-\u{1F600}?a",
      "/two??marks",
      "/a/b/c?d=e&f=g",
      "#frag?x",
      "/tab\tchar?y",
      `/${"a".repeat(200)}?x=1`,
      `/${"b".repeat(119)}`,
      `/${"\u{1F600}".repeat(130)}#y`,
    ];
    const got = await all<{ p: string | null }>(
      `SELECT ${sourcePathSql("j.value")} AS p FROM json_each(?1) j ORDER BY j.key`,
      JSON.stringify(pages),
    );
    expect(got.map((r) => r.p)).toEqual(pages.map((x) => sourcePath(x)));
    expect(await first(`SELECT ${sourcePathSql("NULL")} AS p`)).toEqual({ p: null });
    expect(SQL_SOURCE_PATH_MAX).toBe(SOURCE_PATH_MAX);
  });

  it("the dashboard's previous month in SQL (`date(?3, '-1 month')` over the month's first day) = core previousMonthOf, every month of 2026 to 2029", async () => {
    const firsts = Array.from(
      { length: 48 },
      (_, i) => `${2026 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`,
    );
    const got = await all<{ from: string; to: string }>(
      "SELECT date(j.value, '-1 month') AS \"from\", date(j.value, '-1 day') AS \"to\" FROM json_each(?1) j ORDER BY j.key",
      JSON.stringify(firsts),
    );
    expect(got).toEqual(firsts.map((f) => previousMonthOf(f)));
  });

  it("carePeriodFirstDaySql + carePeriodDaySql = carePeriodDays for every billing day and start dates around the month (review 1 finding 2)", async () => {
    const starts = [
      "2025-12-31",
      "2026-09-30",
      "2026-10-01",
      "2026-10-04",
      "2026-10-05",
      "2026-10-17",
      "2026-10-28",
      "2026-10-31",
      "2026-11-01",
    ];
    for (const [month, last] of [
      ["2026-10", "2026-10-31"],
      ["2027-02", "2027-02-28"],
    ] as const)
      for (const start of [...starts, "2027-02-01", "2027-02-27"])
        for (let b = 1; b <= 28; b++) {
          const r = await first<{ a: string | null; b: string }>(
            `SELECT ${carePeriodFirstDaySql("?1", "p")} AS a, ${carePeriodDaySql("?1", "p")} AS b FROM (SELECT ?2 AS billing_day, ?3 AS start_date) p`,
            month,
            b,
            start,
          );
          // the page statement keeps a day when it is not NULL and not after the month's last day
          const got = [r?.a ?? null, r?.b ?? null].filter((d): d is string => d !== null && d <= last);
          expect(got, `${month} ${b} ${start}`).toEqual(carePeriodDays(month, b, start));
        }
  });

  it("revenueKindSql = revenueKind for each document of the fixture (a note follows its parent)", async () => {
    const f = await fixture();
    for (const d of [f.inv1, f.inv2, f.cn, f.dn, f.exp1]) {
      const r = await first<{ k: string; care: string | null; pcare: string | null; project: string | null }>(
        `SELECT ${revenueKindSql("d")} AS k, d.care_plan_id AS care, (SELECT x.care_plan_id FROM documents x WHERE x.id = d.parent_id) AS pcare, d.project_id AS project FROM documents d WHERE d.id = ?1`,
        d.id,
      );
      expect(r?.k).toBe(
        revenueKind({
          carePlanId: r?.care ?? null,
          parentCarePlanId: r?.pcare ?? null,
          projectId: r?.project ?? null,
        }),
      );
    }
  });
});

// ---- revenue ------------------------------------------------------------------------------------------------------------------------------------------------

type Grouped = Record<string, number | string | null>;
const keyOf = (r: { month?: unknown; key?: unknown; currency: unknown }) =>
  `${r.month ?? r.key}|${r.currency}`;

describe("C1 revenue: each aggregate equals its grouped twin and the FY figures [ADM-REP-01]", () => {
  it("by month: invoiced, collected, TDS and refunds per month and currency; voided, proformas, other FYs, pending and rejected payments never", async () => {
    await fixture();
    const rows = await all<RevenueMonthSqlRow>(REVENUE_MONTHS_SQL, FY.from);
    const inv = new Map(
      (await all<Grouped>(REVENUE_MONTHS_GROUPED_SQL.invoiced, FY.from, FY.to)).map((r) => [
        keyOf(r as never),
        r,
      ]),
    );
    const col = new Map(
      (await all<Grouped>(REVENUE_MONTHS_GROUPED_SQL.collected, FY.from, FY.to)).map((r) => [
        keyOf(r as never),
        r,
      ]),
    );
    const ref = new Map(
      (await all<Grouped>(REVENUE_MONTHS_GROUPED_SQL.refunded, FY.from, FY.to)).map((r) => [
        keyOf(r as never),
        r,
      ]),
    );
    const keys = new Set([...inv.keys(), ...col.keys(), ...ref.keys()]);
    expect(rows.map(keyOf).sort()).toEqual([...keys].sort());
    for (const r of rows) {
      const k = keyOf(r);
      const i = inv.get(k);
      expect(r.documents, k).toBe(i?.documents ?? 0);
      expect(r.taxable, k).toBe(i?.taxable ?? 0);
      expect(r.total, k).toBe(i?.total ?? 0);
      if (i) {
        expect(r.inr_taxable, k).toBe(i.inr_taxable);
        expect(r.inr_total, k).toBe(i.inr_total);
      }
      // review 1 finding 4: the documents without an INR value, = the grouped twin's count; INR figures null exactly when it is above 0
      expect(r.documents_inr_missing, k).toBe(i?.documents_inr_missing ?? 0);
      expect(r.inr_taxable === null, k).toBe(r.documents_inr_missing > 0);
      expect(r.payments, k).toBe(col.get(k)?.payments ?? 0);
      expect(r.received, k).toBe(col.get(k)?.received ?? 0);
      expect(r.tds, k).toBe(col.get(k)?.tds ?? 0);
      expect(r.refunds, k).toBe(ref.get(k)?.refunds ?? 0);
      expect(r.refunded, k).toBe(ref.get(k)?.refunded ?? 0);
    }
    const may = rows.find((r) => r.month === "2026-05" && r.currency === "INR");
    expect(may).toMatchObject({
      documents: 1,
      payments: 1,
      received: 1_000_00,
      tds: 20_00,
      tds_n: 1,
      refunded: 0,
    });
    const june = rows.find((r) => r.month === "2026-06" && r.currency === "INR");
    expect(june).toMatchObject({ documents: 2, refunds: 1, refunded: 100_00 });
    expect(june?.taxable).toBe(2_000_00 - 300_00); // the credit note subtracts
    // a USD month with its INR view, and one where a document and a payment lack it
    const aug = rows.find((r) => r.month === "2026-08" && r.currency === "USD");
    expect(aug?.inr_taxable).not.toBeNull();
    expect(aug).toMatchObject({ inr_missing: 0, inr_collected: 41_000_00, documents_inr_missing: 0 });
    const sep = rows.find((r) => r.month === "2026-09" && r.currency === "USD");
    expect(sep).toMatchObject({
      inr_taxable: null,
      inr_total: null,
      inr_missing: 1,
      inr_collected: null,
      documents: 1,
      documents_inr_missing: 1, // exp2
    });
    expect(rows.filter((r) => r.currency === "INR").every((r) => r.documents_inr_missing === 0)).toBe(true);
    // nothing of March 2026 (the FY before), and every month is in the FY
    expect(rows.every((r) => r.month >= "2026-04" && r.month <= "2027-03")).toBe(true);
  });

  it("Σ months = INVOICED_SQL's FY and Σ (received − refunded) = COLLECTED_SQL = the dashboard tile", async () => {
    await fixture();
    const rows = await all<RevenueMonthSqlRow>(REVENUE_MONTHS_SQL, FY.from);
    const invoiced = await all<{
      currency: string;
      fy_taxable: number;
      fy_total: number;
      fy_inr_taxable: number | null;
      fy_documents: number;
    }>(INVOICED_SQL, FY.from, FY.to, "2026-10-01");
    const collected = await all<{ currency: string; collected: number }>(COLLECTED_SQL, FY.from, FY.to);
    const tile = await all<{ currency: string; fy_collected: number }>(
      COLLECTED_TILE_SQL,
      FY.from,
      FY.to,
      "2026-10-01",
      "2026-10-31",
    );
    for (const cur of ["INR", "USD"]) {
      const of = rows.filter((r) => r.currency === cur);
      const sum = (f: (r: RevenueMonthSqlRow) => number) => of.reduce((a, r) => a + f(r), 0);
      const i = invoiced.find((x) => x.currency === cur);
      expect(
        sum((r) => r.documents),
        cur,
      ).toBe(i?.fy_documents ?? 0);
      expect(
        sum((r) => r.taxable),
        cur,
      ).toBe(i?.fy_taxable ?? 0);
      expect(
        sum((r) => r.total),
        cur,
      ).toBe(i?.fy_total ?? 0);
      const inrs = of.filter((r) => r.documents > 0).map((r) => r.inr_taxable);
      expect(inrs.includes(null) ? null : inrs.reduce((a, b) => (a as number) + (b as number), 0), cur).toBe(
        i?.fy_inr_taxable ?? null,
      );
      const net = sum((r) => r.received - r.refunded);
      expect(net, cur).toBe(collected.find((x) => x.currency === cur)?.collected ?? 0);
      expect(net, cur).toBe(tile.find((x) => x.currency === cur)?.fy_collected ?? 0);
    }
  });

  it("by kind = its grouped twin, and Σ kinds = the FY (recurring: own or parent's care plan; project; other)", async () => {
    const f = await fixture();
    const rows = await all<KeyedSqlRow>(REVENUE_KIND_SQL, FY.from, FY.to);
    const twin = await all<Grouped>(REVENUE_KIND_GROUPED_SQL, FY.from, FY.to);
    expect(rows.map(keyOf).sort()).toEqual(twin.map((r) => keyOf(r as never)).sort());
    for (const t of twin) {
      const r = rows.find((x) => keyOf(x) === keyOf(t as never));
      expect({ d: r?.documents, x: r?.taxable, t: r?.total, m: r?.documents_inr_missing }).toEqual({
        d: t.documents,
        x: t.taxable,
        t: t.total,
        m: t.documents_inr_missing,
      });
    }
    const inrKinds = Object.fromEntries(
      rows.filter((r) => r.currency === "INR").map((r) => [r.key, r.taxable]),
    );
    expect(inrKinds.recurring).toBe(f.inv2.computed.taxableMinor);
    expect(inrKinds.other).toBe(f.cn.computed.taxableMinor * -1 + f.dn.computed.taxableMinor); // notes follow a parent with no care plan; no project on them
    const invoiced = await all<{ currency: string; fy_taxable: number; fy_total: number }>(
      INVOICED_SQL,
      FY.from,
      FY.to,
      "2026-10-01",
    );
    for (const cur of ["INR", "USD"]) {
      const of = rows.filter((r) => r.currency === cur);
      expect(of.reduce((a, r) => a + r.taxable, 0)).toBe(
        invoiced.find((x) => x.currency === cur)?.fy_taxable ?? 0,
      );
      expect(of.reduce((a, r) => a + r.total, 0)).toBe(
        invoiced.find((x) => x.currency === cur)?.fy_total ?? 0,
      );
    }
  });

  it("by category = its grouped twin; a note's line takes its parent line's category; Σ taxable = the FY, Σ totals + round-off = the FY total", async () => {
    const f = await fixture();
    const rows = await all<CategorySqlRow>(REVENUE_CATEGORY_SQL, FY.from, FY.to);
    const twin = await all<Grouped>(REVENUE_CATEGORY_GROUPED_SQL, FY.from, FY.to);
    expect(rows.map(keyOf).sort()).toEqual(twin.map((r) => keyOf(r as never)).sort());
    for (const t of twin) {
      const r = rows.find((x) => keyOf(x) === keyOf(t as never));
      expect({ d: r?.documents, x: r?.taxable, t: r?.total, m: r?.documents_inr_missing }).toEqual({
        d: t.documents,
        x: t.taxable,
        t: t.total,
        m: t.documents_inr_missing,
      });
    }
    const get = (k: string, c: string) => rows.find((r) => r.key === k && r.currency === c);
    // INR: build = inv1 line 1 + the debit note; run = inv1 line 2 − the credit note; none = inv2 (no catalogue item)
    expect(get("build", "INR")?.taxable).toBe(1_000_00 + 100_00);
    expect(get("run", "INR")?.taxable).toBe(500_01 - 300_00);
    expect(get("none", "INR")?.taxable).toBe(2_000_00);
    expect(get("build", "USD")?.inr_taxable).toBe(f.exp1.computed.lines[0]?.inr?.taxableMinor);
    expect(get("run", "USD")?.inr_taxable).toBeNull(); // exp2 has no INR view
    expect(get("run", "USD")?.documents_inr_missing).toBe(1); // its one line
    expect(get("build", "USD")?.documents_inr_missing).toBe(0);
    const round = await all<{ currency: string; round_off: number; inr_round_off: number | null }>(
      REVENUE_ROUND_OFF_GROUPED_SQL,
      FY.from,
      FY.to,
    );
    // the round-off on every row of a currency = the reference twin's
    for (const r of rows) {
      const g = round.find((x) => x.currency === r.currency);
      expect({ ro: r.round_off, iro: r.inr_round_off }, r.currency).toEqual({
        ro: g?.round_off,
        iro: g?.inr_round_off,
      });
    }
    const invoiced = await all<{ currency: string; fy_taxable: number; fy_total: number }>(
      INVOICED_SQL,
      FY.from,
      FY.to,
      "2026-10-01",
    );
    for (const cur of ["INR", "USD"]) {
      const of = rows.filter((r) => r.currency === cur);
      const i = invoiced.find((x) => x.currency === cur);
      expect(
        of.reduce((a, r) => a + r.taxable, 0),
        cur,
      ).toBe(i?.fy_taxable);
      expect(
        of.reduce((a, r) => a + r.total, 0) + (round.find((x) => x.currency === cur)?.round_off ?? 0),
        cur,
      ).toBe(i?.fy_total);
    }
    expect(round.find((x) => x.currency === "USD")?.inr_round_off).toBeNull();
  });

  it("per client: Σ clients = the FY's invoiced and collected, by invoiced total then id, keyset pages stable", async () => {
    const f = await fixture();
    const inr = await all<RevenueClientSqlRow>(
      REVENUE_CLIENTS_SQL(false),
      ...revenueClientsBinds(FY.from, FY.to, "INR"),
    );
    const months = await all<RevenueMonthSqlRow>(REVENUE_MONTHS_SQL, FY.from);
    const sum = (rs: { taxable: number; total: number; received: number; refunded: number; tds: number }[]) =>
      rs.reduce(
        (a, r) => ({
          x: a.x + r.taxable,
          t: a.t + r.total,
          c: a.c + r.received - r.refunded,
          s: a.s + r.tds,
        }),
        { x: 0, t: 0, c: 0, s: 0 },
      );
    for (const cur of ["INR", "USD"] as const) {
      const clients = await all<RevenueClientSqlRow>(
        REVENUE_CLIENTS_SQL(false),
        ...revenueClientsBinds(FY.from, FY.to, cur),
      );
      // other test files' clients share nothing with this one (the database is per file), so the sums hold over every client
      expect(sum(clients), cur).toEqual(sum(months.filter((m) => m.currency === cur)));
      for (let i = 1; i < clients.length; i++) {
        const a = clients[i - 1] as RevenueClientSqlRow;
        const b = clients[i] as RevenueClientSqlRow;
        expect(a.k > b.k || (a.k === b.k && a.client_id < b.client_id)).toBe(true);
      }
    }
    // the USD client: exp1 has its INR view, exp2 none (review 1 finding 4)
    const usdRows = await all<RevenueClientSqlRow>(
      REVENUE_CLIENTS_SQL(false),
      ...revenueClientsBinds(FY.from, FY.to, "USD"),
    );
    expect(usdRows.find((r) => r.client_id === f.usd)).toMatchObject({
      documents: 2,
      documents_inr_missing: 1,
      inr_taxable: null,
      inr_total: null,
    });
    expect(inr.every((r) => r.documents_inr_missing === 0)).toBe(true);
    const mine = inr.find((r) => r.client_id === f.inr);
    expect(mine).toMatchObject({
      currency: "INR",
      payments: 1,
      received: 1_000_00,
      refunded: 100_00,
      tds: 20_00,
    });
    // a next page from the first row continues after it
    const first1 = inr[0] as RevenueClientSqlRow;
    const after = await all<RevenueClientSqlRow>(
      REVENUE_CLIENTS_SQL(true),
      ...revenueClientsBinds(FY.from, FY.to, "INR", { k: first1.k, id: first1.client_id }),
    );
    expect(after.map((r) => r.client_id)).toEqual(inr.slice(1).map((r) => r.client_id));
  });
});

// ---- ageing ------------------------------------------------------------------------------------------------------------------------------------------------

describe("C1 collected = the payments register less the refunds register (M6.1, M6.5) [ADM-REP-01, ADM-PAY-08]", () => {
  it("Σ months' money received = the register's payment rows, TDS = its TDS rows, refunded = the refunds register, per currency", async () => {
    await fixture();
    const months = await all<RevenueMonthSqlRow>(REVENUE_MONTHS_SQL, FY.from);
    const register = await all<{ kind: string; currency: string; amount_minor: number }>(
      PAYMENTS_REGISTER_SQL(false),
      FY.from,
      FY.to,
    );
    const refunds = await all<{ currency: string; amount_minor: number }>(
      REFUNDS_REGISTER_SQL(false),
      FY.from,
      FY.to,
    );
    expect(register.length).toBeLessThan(51); // one page holds the fixture
    for (const cur of ["INR", "USD"]) {
      const m = months.filter((r) => r.currency === cur);
      const sum = <T>(rs: T[], f: (r: T) => number) => rs.reduce((a, r) => a + f(r), 0);
      expect(
        sum(m, (r) => r.received),
        cur,
      ).toBe(
        sum(
          register.filter((r) => r.currency === cur && r.kind === "payment"),
          (r) => r.amount_minor,
        ),
      );
      expect(
        sum(m, (r) => r.tds),
        cur,
      ).toBe(
        sum(
          register.filter((r) => r.currency === cur && r.kind === "tds"),
          (r) => r.amount_minor,
        ),
      );
      expect(
        sum(m, (r) => r.refunded),
        cur,
      ).toBe(
        sum(
          refunds.filter((r) => r.currency === cur),
          (r) => r.amount_minor,
        ),
      );
      expect(
        sum(m, (r) => r.collected),
        cur,
      ).toBe(sum(m, (r) => r.received) - sum(m, (r) => r.refunded));
    }
  });
});

describe("C9 ageing: Σ buckets = OWED_SQL, the overdue buckets = its overdue figure, credit apart [ADM-REP-02]", () => {
  it("totals = the grouped twin and the dashboard's owed figures, as at several days", async () => {
    await fixture();
    for (const today of ["2026-06-01", "2026-07-20", "2026-12-15", "2027-03-31"]) {
      const totals = await all<AgeingTotalsSqlRow>(AGEING_TOTALS_SQL, today);
      const twin = await all<{ currency: string; bucket: string; n: number; balance: number }>(
        AGEING_GROUPED_SQL,
        today,
      );
      const owed = await all<{
        currency: string;
        n: number;
        balance: number;
        overdue_n: number;
        overdue_balance: number;
      }>(OWED_SQL, today);
      for (const t of totals) {
        for (const b of SQL_AGEING_BUCKETS) {
          const g = twin.find((x) => x.currency === t.currency && x.bucket === b);
          expect(t[`n_${b}`], `${today} ${t.currency} ${b}`).toBe(g?.n ?? 0);
          expect(t[`b_${b}`], `${today} ${t.currency} ${b}`).toBe(g?.balance ?? 0);
        }
        const o = owed.find((x) => x.currency === t.currency);
        const all5 = SQL_AGEING_BUCKETS.reduce((a, b) => a + t[`b_${b}`], 0);
        const overdue = SQL_AGEING_BUCKETS.filter((b) => b !== "not_due").reduce(
          (a, b) => a + t[`b_${b}`],
          0,
        );
        const overdueN = SQL_AGEING_BUCKETS.filter((b) => b !== "not_due").reduce(
          (a, b) => a + t[`n_${b}`],
          0,
        );
        expect(all5).toBe(o?.balance);
        expect(overdue).toBe(o?.overdue_balance);
        expect(overdueN).toBe(o?.overdue_n);
      }
      expect(totals.map((t) => t.currency)).toEqual(owed.map((o) => o.currency));
    }
  });

  it("pages: Σ over every page = the totals; credit held is the client's credit, never taken off", async () => {
    const f = await fixture();
    const today = "2026-12-15";
    const pages: AgeingSqlRow[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const page: AgeingSqlRow[] = await all<AgeingSqlRow>(
        AGEING_PAGE_SQL(cursor !== null),
        ...(cursor ? [today, cursor] : [today]),
      );
      const clientIds = [...new Set(page.map((r) => r.client_id))];
      pages.push(...page.filter((r) => clientIds.indexOf(r.client_id) < 50));
      if (clientIds.length <= 50) break;
      cursor = clientIds[49] as string;
    }
    const totals = await all<AgeingTotalsSqlRow>(AGEING_TOTALS_SQL, today);
    for (const t of totals)
      for (const b of SQL_AGEING_BUCKETS)
        expect(pages.filter((r) => r.currency === t.currency).reduce((a, r) => a + r[`b_${b}`], 0)).toBe(
          t[`b_${b}`],
        );
    const mine = pages.find((r) => r.client_id === f.inr && r.currency === "INR");
    const credit = await first<{ credit: number }>(clientCreditSql("?1"), f.inr);
    expect(mine?.credit).toBe(credit?.credit ?? 0);
    expect(mine?.credit).toBeGreaterThan(0); // p1 is not allocated: 1,000 received, 100 refunded
    expect(mine?.b_d90_plus ?? 0).toBeGreaterThan(0); // inv1 due 2026-06-10
  });
});

// ---- EXPLAIN and D1's limits -------------------------------------------------------------------------------------------------------------------------------

describe("every new statement runs, is served by its index, and reads no table end to end", () => {
  const cases: [string, string, unknown[], RegExp[]][] = [
    [
      "months",
      REVENUE_MONTHS_SQL,
      [FY.from],
      [/documents_issued_on/, /payments_confirmed/, /payment_refunds_settled/],
    ],
    ["kind", REVENUE_KIND_SQL, [FY.from, FY.to], [/documents_issued_on/]],
    ["category", REVENUE_CATEGORY_SQL, [FY.from, FY.to], [/documents_issued_on/, /document_lines_position/]],
    [
      "clients",
      REVENUE_CLIENTS_SQL(true),
      [FY.from, FY.to, "INR", 5, "x"],
      [/documents_client_issued/, /payments_client/, /payment_refunds_client/],
    ],
    [
      "ageing page",
      AGEING_PAGE_SQL(true),
      ["2026-12-15", "x"],
      [/documents_client_type_status/, /payments_client/],
    ],
    ["ageing totals", AGEING_TOTALS_SQL, ["2026-12-15"], [/documents_status_due/]],
    ["cohort", LEAD_COHORT_SQL, [0, T], [/leads_created/]],
    ["trend", OPEN_TREND_SQL, ["2026-01-01", "2026-12-31"], [/stats_daily_metric/]],
    ["offers sent", OFFERS_SENT_SQL, [0, T], [/documents_offer_sent/, /documents_version/]],
    [
      "offers decided",
      OFFERS_DECIDED_SQL,
      [0, T, "2026-01-01", "2026-12-31"],
      [/documents_offer_decided/, /documents_status_valid_until/, /acceptances_document/],
    ],
    ["median", TIME_TO_WIN_MEDIAN_SQL, [0, T], [/documents_offer_decided/]],
    ["care page", CARE_HOURS_PAGE_SQL(false), ["2026-10", "2026-10-31"], [/care_plan_status_log_plan/]],
    [
      "care next page",
      CARE_HOURS_PAGE_SQL(true),
      ["2026-10", "2026-10-31", "x", "2026-10-05"],
      [/care_plan_status_log_plan/],
    ],
    ["care billed", CARE_HOURS_BILLED_SQL, ["[]", "2026-09-01", "2026-12-31"], [/care_invoices/]],
  ];
  for (const [name, sql, binds, indexes] of cases)
    it(name, async () => {
      await fixture();
      await env.DB.prepare(sql)
        .bind(...binds)
        .all(); // D1's 100 result columns and 32 function arguments: a statement past them fails here
      const p = await plan(sql, ...binds);
      for (const i of indexes) expect(p, name).toMatch(i);
      // the client walks of C2 and C9 and the care plans' page read their tables by primary key, by design (one seek of the documents per row)
      const allowed = name === "clients" || name.startsWith("ageing page") || name.startsWith("care");
      if (!allowed) expect(scansTable(p), p).toBe(false);
    });
});

// ---- the pipeline statements against their twins -------------------------------------------------------------------------------------------------------

describe("C3 pipeline statements [ADM-REP-03]", () => {
  it("the cohort's totals are its grouped figures; paths come without query strings; offers sent = the grouped twin", async () => {
    const f = await fixture();
    const base = T - 10 * 86_400_000;
    const leads: [string, string | null, string, string | null][] = [
      ["web", "/contact?email=x@example.test", "won", null],
      ["web", "/contact#form", "lost", "price"],
      ["web", "/services/web", "new", null],
      ["manual", null, "lost", "timing"],
    ];
    for (const [i, [source, page, stage, reason]] of leads.entries())
      await run(
        "INSERT INTO leads (id, ref, source, source_page, contact_name, contact_email, stage, lost_reason, created_at) VALUES (?1, ?2, ?3, ?4, 'N', ?5, ?6, ?7, ?8)",
        uuidv7(),
        `L-R${i}${Date.now() % 100_000}`,
        source,
        page,
        `l${i}@example.test`,
        stage,
        reason,
        base + i,
      );
    const rows = await all<Record<string, number | string | null>>(LEAD_COHORT_SQL, base, base + 100);
    const top = rows[0] as Record<string, number | string | null>;
    expect(top).toMatchObject({
      path: "/contact",
      created: 2,
      won: 1,
      all_created: 4,
      all_st_won: 1,
      all_st_lost: 2,
      all_lr_price: 1,
      all_lr_timing: 1,
      all_src_web: 3,
      all_src_manual: 1,
    });
    expect(rows.map((r) => r.path)).toEqual(["/contact", null, "/services/web"]);
    for (const n of COHORT_COUNT_NAMES)
      expect(rows.every((r) => r[`all_${n}`] === top[`all_${n}`])).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/example\.test|N'/);

    // offers: a group with v1 sent then v2 sent (only v2 counts), a USD estimate, and a group sent after the range (not counted)
    const offer = async (o: {
      group?: string;
      version?: number;
      type?: string;
      currency?: string;
      status: string;
      sentAt: number;
      taxable: number;
    }) => {
      const id = uuidv7();
      await run(
        `INSERT INTO documents (id, type, status, client_id, currency, version_group_id, version, series, fy, number, number_display, frozen_at, sent_at, taxable_minor, total_minor, valid_until, content_sha256, snapshot_sha256, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, '2627', ?9, ?10, ?11, ?11, ?12, ?12, '2027-01-01', ?13, ?13, 1)`,
        id,
        o.type ?? "proposal",
        o.status,
        o.currency === "USD" ? f.usd : f.inr,
        o.currency ?? "INR",
        o.group ?? id,
        o.version ?? 1,
        o.type === "estimate" ? "estimate" : "proposal",
        Number(id.slice(-6).replace(/\D/g, "").slice(0, 5) || 7),
        `PR/${id.slice(-8)}`,
        o.sentAt,
        o.taxable,
        "c".repeat(64),
      );
      return id;
    };
    const g = await offer({ status: "revised", sentAt: base + 1, taxable: 1_000 });
    await offer({ group: g, version: 2, status: "viewed", sentAt: base + 2, taxable: 1_200 });
    await offer({ type: "estimate", currency: "USD", status: "sent", sentAt: base + 3, taxable: 300 });
    const late = await offer({ status: "revised", sentAt: base + 4, taxable: 50 });
    await offer({ group: late, version: 2, status: "sent", sentAt: base + 500, taxable: 60 });
    const sent = await all<{ status: string; currency: string; n: number; taxable: number }>(
      OFFERS_SENT_SQL,
      base,
      base + 100,
    );
    const twin = await all<{ status: string; currency: string; n: number; taxable: number }>(
      OFFERS_SENT_GROUPED_SQL,
      base,
      base + 100,
    );
    expect(sent.map((r) => `${r.status}|${r.currency}|${r.n}|${r.taxable}`).sort()).toEqual(
      twin.map((r) => `${r.status}|${r.currency}|${r.n}|${r.taxable}`).sort(),
    );
    expect(sent.find((r) => r.status === "viewed")).toMatchObject({ n: 1, taxable: 1_200 });
    expect(sent.find((r) => r.status === "revised")).toMatchObject({ n: 1, taxable: 50 }); // its v2 was sent after the range
    expect(sent.find((r) => r.currency === "USD")).toMatchObject({ status: "sent", n: 1, taxable: 300 });
  });

  it("a version group counts once in the win rate, by its outcome: a rejected or expired version a later sent version replaced is not counted (early check 1)", async () => {
    const f = await fixture();
    const contact = uuidv7();
    await run(
      "INSERT INTO contacts (id, client_id, name, email) VALUES (?1, ?2, 'Signer', 'signer-w@example.test')",
      contact,
      f.inr,
    );
    // a range of its own (February 2031) so the other tests' offers never fall in it
    const from = Date.parse("2031-01-31T18:30:00Z");
    const to = Date.parse("2031-02-28T18:30:00Z");
    const day = (n: number) => from + n * 86_400_000;
    let n = 0;
    const offer = async (o: {
      group?: string;
      version?: number;
      status: string;
      sentAt: number | null;
      decidedAt?: number | null;
      validUntil?: string;
    }) => {
      const id = uuidv7();
      const draft = o.status === "draft";
      n++;
      await run(
        `INSERT INTO documents (id, type, status, client_id, currency, version_group_id, version, series, fy, number, number_display, frozen_at, sent_at, decided_at,
           taxable_minor, total_minor, valid_until, created_at, content_sha256, snapshot_sha256, updated_at)
         VALUES (?1, 'proposal', ?2, ?3, 'INR', ?4, ?5, CASE WHEN ?6 IS NULL THEN NULL ELSE 'fixture' END, CASE WHEN ?6 IS NULL THEN NULL ELSE '0000' END, ?6, ?7, ?8, ?9, ?10,
           100, 100, ?11, coalesce(?8, ?13), ?12, CASE WHEN ?6 IS NULL THEN NULL ELSE ?12 END, 1)`,
        id,
        o.status,
        f.inr,
        o.group ?? id,
        o.version ?? 1,
        draft ? null : 880_000 + n,
        draft ? null : `FIX/W${n}`,
        draft ? null : (o.sentAt ?? day(0)),
        o.sentAt,
        o.decidedAt ?? null,
        o.validUntil ?? "2031-03-31",
        "c".repeat(64),
        day(0),
      );
      return id;
    };
    // A: rejected v1, then v2 accepted: one win, no loss
    const a = await offer({ status: "rejected", sentAt: day(1), decidedAt: day(2) });
    const a2 = await offer({ group: a, version: 2, status: "accepted", sentAt: day(3), decidedAt: day(5) });
    await run(
      "INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, pdf_sha256) VALUES (?1, ?2, ?3, 'Signer', 'signer-w@example.test', ?4, ?5)",
      uuidv7(),
      a2,
      contact,
      day(5),
      "a".repeat(64),
    );
    // B: expired v1 (in the range), then v2 rejected: one loss (the rejection), not two
    const b = await offer({ status: "expired", sentAt: day(1), validUntil: "2031-02-10" });
    await offer({ group: b, version: 2, status: "rejected", sentAt: day(11), decidedAt: day(12) });
    // C: rejected v1, then v2 sent after the range and still open: no outcome yet, so nothing counts (the group is never a loss here and a win later)
    const cg = await offer({ status: "rejected", sentAt: day(1), decidedAt: day(3) });
    await offer({ group: cg, version: 2, status: "sent", sentAt: to + 86_400_000 });
    // D: rejected v1 with a later draft (never sent): the rejection is the outcome
    const dg = await offer({ status: "rejected", sentAt: day(1), decidedAt: day(4) });
    await offer({ group: dg, version: 2, status: "draft", sentAt: null });
    // E: a lone expired offer
    await offer({ status: "expired", sentAt: day(2), validUntil: "2031-02-20" });
    const r = await first<{ accepted: number; rejected: number; expired: number }>(
      OFFERS_DECIDED_SQL,
      from,
      to,
      "2031-02-01",
      "2031-02-28",
    );
    // accepted: A's v2; rejected: B's v2 and D's v1; expired: E (B's v1 and A's, C's v1 are replaced)
    expect(r).toMatchObject({ accepted: 1, rejected: 2, expired: 1 });
  });
});

describe("rows read, measured on the fixture (section J's budgets are measured at scale by B2's stress test)", () => {
  it("each statement reads about the rows it should", async () => {
    await fixture();
    const report: string[] = [];
    for (const [name, sql, binds] of [
      ["months", REVENUE_MONTHS_SQL, [FY.from]],
      ["kind", REVENUE_KIND_SQL, [FY.from, FY.to]],
      ["category", REVENUE_CATEGORY_SQL, [FY.from, FY.to]],
      ["clients", REVENUE_CLIENTS_SQL(false), [FY.from, FY.to, "INR"]],
      ["ageing page", AGEING_PAGE_SQL(false), ["2026-12-15"]],
      ["ageing totals", AGEING_TOTALS_SQL, ["2026-12-15"]],
    ] as const) {
      const n = await rowsRead(sql, ...binds);
      report.push(`${name}: ${n}`);
      expect(n, name).toBeLessThan(400);
    }
    console.log(`M7.3 rows read on the fixture: ${report.join(", ")}`);
  });
});
