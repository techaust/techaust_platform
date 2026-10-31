// The dashboard's finance figures in one pass [ADM-DASH-01, ADM-PAY-06; M6.1, L33; Researched 2026-10-28, s.34(2) CGST Act (08-C RA-03) for what counts as
// invoiced]: `INVOICED_SQL`, `OWED_SQL`, `PROFORMAS_AWAITING_SQL` and `EXPORT_STAGE_COUNTS_SQL` give exactly what their grouped twins of M5.5b give (same rows,
// columns, values and order) on varied data: both currencies, credit and debit notes, voided documents and drafts, TDS, part-paid and part-credited ones, a
// USD document without its INR view, the FY's first and last days and the IST month's edges; every one reads its index with no GROUP BY b-tree; and the
// currency and stage lists they are built from are pinned to the schema, the installed CHECK constraints, `stageSql` and core's stage type.
// All names and amounts are invented test data.
import type { RealisationStage } from "@techaust/core/gst";
import { describe, expect, it } from "vitest";
import { COLLECTED_CURRENCIES } from "../src/ledger.ts";
import { EXPORT_STAGES, settingsBinds, stageSql } from "../src/realisation.ts";
import {
  EXPORT_STAGE_COUNTS_GROUPED_SQL,
  EXPORT_STAGE_COUNTS_SQL,
  INVOICED_GROUPED_SQL,
  INVOICED_SQL,
  OWED_GROUPED_SQL,
  OWED_SQL,
  PROFORMAS_AWAITING_GROUPED_SQL,
  PROFORMAS_AWAITING_SQL,
} from "../src/reports.ts";
import { CURRENCY_CODES } from "../src/schema/common.ts";
import { SQL_CURRENCIES } from "../src/sql-rules.ts";
import { all, first, run } from "./helpers.ts";
import { addDoc, computeFor, line, mkOwner, mkReportClient } from "./reports-helpers.ts";

const plan = async (sql: string, ...binds: unknown[]): Promise<string> =>
  (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...binds)).map((r) => r.detail).join("\n");
/** A table scan of the documents (an index walk, `SCAN d USING INDEX x`, is fine). */
const scansDocuments = (p: string): boolean => /SCAN (documents|d)\b(?! USING)/.test(p);

/** A small deterministic generator (mulberry32), so the "random" fixture is the same on every run. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Days around the FY 2026-27 and its months, the edges included. */
const DAYS = [
  "2026-03-01",
  "2026-03-31",
  "2026-04-01",
  "2026-04-02",
  "2026-09-30",
  "2026-10-01",
  "2026-10-15",
  "2026-10-31",
  "2026-11-01",
  "2027-02-28",
  "2027-03-01",
  "2027-03-31",
  "2027-04-01",
  "2027-04-30",
];
const DUES = [null, "2026-10-30", "2026-10-31", "2026-11-01", "2027-01-15", "2025-12-31", "2027-12-31"];

/** The bind sets of the invoiced figure: a FY and the first day of one of its months (the dashboard's), and FYs on either side and an empty one. */
const INVOICED_BINDS: [string, string, string][] = [
  ["2026-04-01", "2027-03-31", "2026-04-01"],
  ["2026-04-01", "2027-03-31", "2026-10-01"],
  ["2026-04-01", "2027-03-31", "2026-11-01"],
  ["2026-04-01", "2027-03-31", "2027-03-01"],
  ["2025-04-01", "2026-03-31", "2026-03-01"],
  ["2027-04-01", "2028-03-31", "2027-04-01"],
  ["2040-04-01", "2041-03-31", "2040-10-01"],
];
/** The `today` binds of the owed figure and of the export stages: on and around due dates, before everything and after everything. */
const TODAYS = [
  "2026-10-30",
  "2026-10-31",
  "2026-11-01",
  "2027-01-15",
  "2027-06-01",
  "2027-12-01",
  "2028-02-01",
  "2020-01-01",
  "2035-01-01",
];

async function twins(): Promise<{
  invoicedRows: number;
  owedRows: number;
  proformaRows: number;
  stageRows: number;
}> {
  let invoicedRows = 0;
  let owedRows = 0;
  let stageRows = 0;
  for (const b of INVOICED_BINDS) {
    const one = await all(INVOICED_SQL, ...b);
    expect(one, JSON.stringify(b)).toEqual(await all(INVOICED_GROUPED_SQL, ...b));
    invoicedRows += one.length;
  }
  for (const today of TODAYS) {
    const owed = await all(OWED_SQL, today);
    expect(owed, today).toEqual(await all(OWED_GROUPED_SQL, today));
    owedRows += owed.length;
    const stages = await all(EXPORT_STAGE_COUNTS_SQL, today);
    expect(stages, today).toEqual(await all(EXPORT_STAGE_COUNTS_GROUPED_SQL, today));
    stageRows += stages.length;
  }
  const pro = await all(PROFORMAS_AWAITING_SQL);
  expect(pro).toEqual(await all(PROFORMAS_AWAITING_GROUPED_SQL));
  return { invoicedRows, owedRows, proformaRows: pro.length, stageRows };
}

describe("L33: the one-pass figures equal their grouped twins", () => {
  it("an empty ledger: no rows from either form", async () => {
    // (this test runs first in the file: the database has no issued document yet)
    expect(await twins()).toEqual({ invoicedRows: 0, owedRows: 0, proformaRows: 0, stageRows: 0 });
  });

  it("a fixture of known cases: the values, then the twins", async () => {
    const inr = await mkReportClient("INR");
    const usd = await mkReportClient("USD");
    // INR: an invoice on the FY's first day, one in the month, a credit note against the first, a debit note with TDS, a voided one and a draft
    const a = await addDoc({
      clientId: inr,
      issueDate: "2026-04-01",
      lines: [line(2_000_00)],
      dueDate: "2026-10-30",
    });
    const b = await addDoc({
      clientId: inr,
      issueDate: "2026-10-01",
      lines: [line(1_000_00)],
      dueDate: "2026-11-01",
    });
    const cn = await addDoc({
      type: "credit_note",
      clientId: inr,
      issueDate: "2026-10-31",
      parentId: a.id,
      lines: [line(300_00)],
      dueDate: null,
    });
    const dnComputed = computeFor({ clientId: inr, issueDate: "2026-10-15", lines: [line(100_00)] });
    const dn = await addDoc({
      type: "debit_note",
      clientId: inr,
      issueDate: "2026-10-15",
      parentId: a.id,
      computed: dnComputed,
      dueDate: "2026-10-30",
      status: "partially_paid",
      over: { tds_minor: 10_00, balance_minor: dnComputed.totalMinor - 10_00 },
    });
    await addDoc({ clientId: inr, issueDate: "2026-10-02", voided: true, dueDate: "2026-10-01" });
    await addDoc({ clientId: inr, issueDate: "2026-10-02", frozen: false });
    // the credit note lowers its parent's balance, as the issue batch does
    await run(
      "UPDATE documents SET balance_minor = balance_minor - ?1, credited_minor = credited_minor + ?1, status = 'partially_credited' WHERE id = ?2",
      cn.computed.totalMinor,
      a.id,
    );
    // USD: an export in the month, one in the previous FY (outside), and one without its INR view (the INR figure is then NULL, never a silent zero)
    const e = await addDoc({
      clientId: usd,
      currency: "USD",
      issueDate: "2026-10-31",
      lines: [line(500_00)],
      dueDate: "2026-11-15",
    });
    await addDoc({
      clientId: usd,
      currency: "USD",
      issueDate: "2026-03-31",
      lines: [line(700_00)],
      dueDate: "2026-05-01",
    });
    const noInr = computeFor({
      clientId: usd,
      currency: "USD",
      issueDate: "2026-06-01",
      lines: [line(50_00)],
    });
    const noInrDoc = await addDoc({
      clientId: usd,
      currency: "USD",
      issueDate: "2026-06-01",
      computed: noInr,
      dueDate: "2026-07-01",
      over: { computed: JSON.stringify({ ...noInr, inr: undefined }) },
    });
    // proformas: one issued with a balance, one part-paid (converted), one fully advanced (nothing waits), one voided; a USD one
    await addDoc({
      type: "proforma",
      clientId: inr,
      issueDate: "2026-10-05",
      status: "issued",
      lines: [line(400_00)],
    });
    const partConv = computeFor({ clientId: inr, issueDate: "2026-10-05", lines: [line(800_00)] });
    await addDoc({
      type: "proforma",
      clientId: inr,
      issueDate: "2026-10-05",
      status: "converted",
      computed: partConv,
      over: { paid_minor: 300_00, balance_minor: partConv.totalMinor - 300_00 },
    });
    await addDoc({
      type: "proforma",
      clientId: inr,
      issueDate: "2026-10-05",
      status: "converted",
      over: { balance_minor: 0, paid_minor: 1 },
    });
    await addDoc({ type: "proforma", clientId: inr, issueDate: "2026-10-05", voided: true });
    const pu = await addDoc({
      type: "proforma",
      clientId: usd,
      currency: "USD",
      issueDate: "2026-10-06",
      status: "issued",
      lines: [line(90_00)],
    });

    const neg = (n: number) => -n;
    const inrFy = [a, b, dn].reduce((s, d) => s + d.computed.taxableMinor, 0) + neg(cn.computed.taxableMinor);
    const inrMonth = [b, dn].reduce((s, d) => s + d.computed.taxableMinor, 0) + neg(cn.computed.taxableMinor);
    expect(await all(INVOICED_SQL, "2026-04-01", "2027-03-31", "2026-10-01")).toEqual([
      {
        currency: "INR",
        fy_documents: 4,
        fy_taxable: inrFy,
        fy_total:
          a.computed.totalMinor + b.computed.totalMinor + dn.computed.totalMinor - cn.computed.totalMinor,
        fy_inr_taxable: inrFy,
        month_documents: 3,
        month_taxable: inrMonth,
        month_total: b.computed.totalMinor + dn.computed.totalMinor - cn.computed.totalMinor,
        month_inr_taxable: inrMonth,
      },
      {
        currency: "USD",
        fy_documents: 2,
        fy_taxable: e.computed.taxableMinor + noInrDoc.computed.taxableMinor,
        fy_total: e.computed.totalMinor + noInrDoc.computed.totalMinor,
        fy_inr_taxable: null,
        month_documents: 1,
        month_taxable: e.computed.taxableMinor,
        month_total: e.computed.totalMinor,
        month_inr_taxable: e.computed.inr?.taxableMinor,
      },
    ]);
    // owed on 2026-10-31: a (due 10-30, overdue), b (due 11-01), dn (due 10-30, overdue, less its TDS); the USD exports (the 2026-03-31 one is owed too)
    const owed = await all(OWED_SQL, "2026-10-31");
    const aBal = a.computed.totalMinor - cn.computed.totalMinor;
    const dnBal = dn.computed.totalMinor - 10_00;
    expect(owed[0]).toEqual({
      currency: "INR",
      n: 3,
      balance: aBal + b.computed.totalMinor + dnBal,
      overdue_n: 2,
      overdue_balance: aBal + dnBal,
    });
    expect(owed[1]).toMatchObject({ currency: "USD", n: 3, overdue_n: 2 });
    expect(await all(PROFORMAS_AWAITING_SQL)).toEqual([
      {
        currency: "INR",
        n: 2,
        balance:
          computeFor({ clientId: inr, issueDate: "x", lines: [line(400_00)] }).totalMinor +
          partConv.totalMinor -
          300_00,
      },
      { currency: "USD", n: 1, balance: pu.computed.totalMinor },
    ]);
    const r = await twins();
    expect(r.invoicedRows).toBeGreaterThan(0);
    expect(r.owedRows).toBeGreaterThan(0);
    expect(r.proformaRows).toBe(2);
    expect(r.stageRows).toBeGreaterThan(0);
  });

  it("200 more documents of every kind, status, date and currency (a fixed seed): the twins hold over every FY, month and day", async () => {
    const next = rng(20261031);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
    const { ownerId } = await mkOwner();
    const clients = {
      INR: [await mkReportClient("INR"), await mkReportClient("INR")],
      USD: [await mkReportClient("USD"), await mkReportClient("USD")],
    } as const;
    const parents: { id: string; clientId: string; currency: "INR" | "USD" }[] = [];
    const exports: string[] = [];
    for (let i = 0; i < 200; i++) {
      const currency = next() < 0.65 ? "INR" : "USD";
      const clientId = pick(clients[currency]);
      const r = next();
      const kind =
        r < 0.5 || parents.filter((p) => p.clientId === clientId).length === 0
          ? "invoice"
          : r < 0.65
            ? "credit_note"
            : r < 0.78
              ? "debit_note"
              : r < 0.9
                ? "proforma"
                : "draft";
      const type =
        kind === "invoice" || kind === "draft"
          ? currency === "USD"
            ? "export_invoice"
            : "tax_invoice"
          : kind;
      const computed = computeFor({
        clientId,
        currency,
        issueDate: "x",
        lines: [line(Math.floor(next() * 5_000_00) + 1_00)],
        exportMode: next() < 0.5 ? "lut" : "igst_paid",
      });
      const total = computed.totalMinor;
      const voided = kind !== "draft" && kind !== "credit_note" && kind !== "debit_note" && next() < 0.12;
      const paid = next() < 0.3 ? Math.floor(total / 3) : next() < 0.15 ? total : 0;
      const tds =
        currency === "INR" && (type === "tax_invoice" || type === "debit_note") && next() < 0.25
          ? Math.min(5_00, total - paid)
          : 0;
      const balance = Math.max(0, total - paid - tds);
      const status = voided
        ? "void"
        : kind === "proforma"
          ? pick(["issued", "converted", "converted"])
          : balance === 0
            ? "paid"
            : paid > 0
              ? "partially_paid"
              : pick(["issued", "issued", "partially_credited", "sent"]);
      const parent =
        kind === "credit_note" || kind === "debit_note"
          ? pick(parents.filter((p) => p.clientId === clientId))
          : undefined;
      const noInr = currency === "USD" && next() < 0.1;
      const doc = await addDoc({
        type,
        clientId,
        currency,
        issueDate: pick(DAYS),
        computed,
        voided,
        frozen: kind !== "draft",
        status,
        dueDate: kind === "credit_note" ? null : pick(DUES),
        parentId: parent?.id ?? null,
        over: {
          paid_minor: paid,
          tds_minor: tds,
          balance_minor: kind === "proforma" && status === "converted" && next() < 0.4 ? 0 : balance,
          ...(noInr ? { computed: JSON.stringify({ ...computed, inr: undefined }) } : {}),
        },
      });
      if (kind === "invoice" && !voided) parents.push({ id: doc.id, clientId, currency });
      if (type === "export_invoice" && kind === "invoice" && !voided) exports.push(doc.id);
    }
    // an AD bank's extension on two exports, so a stage moves by it in both forms
    for (const [i, to] of [
      [0, "2028-06-30"],
      [1, "2027-01-31"],
    ] as const) {
      const id = exports[i];
      if (id === undefined) continue;
      await run(
        "INSERT INTO realisation_extensions (id, document_id, extended_to, bank_ref, recorded_by) VALUES (?1, ?2, ?3, ?4, ?5)",
        `rx-${i}`,
        id,
        to,
        `BANK-${i}`,
        ownerId,
      );
    }
    // the fixture has what the twins must cover: both currencies, notes, voids, TDS, a USD document without its INR view, several export stages
    const facts = await first<Record<string, number>>(
      `SELECT count(DISTINCT currency) AS currencies, sum(type = 'credit_note') AS credits, sum(type = 'debit_note') AS debits, sum(voided_at IS NOT NULL) AS voids,
              sum(tds_minor > 0) AS tds, sum(currency = 'USD' AND json_extract(computed, '$.inr') IS NULL AND frozen_at IS NOT NULL) AS no_inr
       FROM documents`,
    );
    for (const k of ["credits", "debits", "voids", "tds", "no_inr"]) expect(facts?.[k], k).toBeGreaterThan(0);
    expect(facts?.currencies).toBe(2);
    const r = await twins();
    expect(r.invoicedRows).toBeGreaterThanOrEqual(8);
    expect(r.owedRows).toBeGreaterThanOrEqual(8);
    expect(r.proformaRows).toBe(2);
    const stagesSeen = new Set<string>();
    for (const today of TODAYS)
      for (const s of await all<{ stage: string }>(EXPORT_STAGE_COUNTS_SQL, today)) stagesSeen.add(s.stage);
    expect(stagesSeen.size, [...stagesSeen].join(",")).toBeGreaterThanOrEqual(3);
  });
});

describe("L33: how the one-pass figures read", () => {
  it("each reads its index once, with no GROUP BY b-tree and no table scan; the export stage is worked out once per export", async () => {
    for (const [sql, index, binds] of [
      [INVOICED_SQL, "documents_issued_on", ["2026-04-01", "2027-03-31", "2026-10-01"]],
      [OWED_SQL, "documents_status_due", ["2026-10-31"]],
      [PROFORMAS_AWAITING_SQL, "documents_type_status_created", []],
      [EXPORT_STAGE_COUNTS_SQL, "documents_export_issued", ["2026-10-31"]],
    ] as const) {
      const p = await plan(sql, ...binds);
      expect(p, p).toContain(`USING INDEX ${index}`);
      expect(p, p).not.toContain("GROUP BY");
      expect(scansDocuments(p), p).toBe(false);
      // the documents are read in one place only
      expect(p.match(/\bd USING INDEX/g)?.length, p).toBe(1);
    }
    // the stage subquery is not flattened into the aggregate (which would copy the stage expression, and its extension seeks, into each stage's column)
    const st = await plan(EXPORT_STAGE_COUNTS_SQL, "2026-10-31");
    expect(st, st).toMatch(/(CO-ROUTINE|MATERIALIZE) sg\b/);
    expect(st.match(/realisation_extensions/g)?.length ?? 0, st).toBeLessThanOrEqual(
      (await plan(EXPORT_STAGE_COUNTS_GROUPED_SQL, "2026-10-31")).match(/realisation_extensions/g)?.length ??
        0,
    );
  });
});

describe("L33: the lists the one-pass figures are built from", () => {
  it("the currencies are the schema's and the installed CHECK constraints' (documents and payments), and the ledger's", async () => {
    expect([...SQL_CURRENCIES]).toEqual([...CURRENCY_CODES]);
    expect(COLLECTED_CURRENCIES).toBe(SQL_CURRENCIES);
    for (const [table, check] of [
      ["documents", "documents_currency"],
      ["payments", "payments_currency"],
    ] as const) {
      const ddl =
        (
          await first<{ sql: string }>(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
            table,
          )
        )?.sql ?? "";
      const body = new RegExp(`CONSTRAINT "${check}" CHECK\\(([^)]*)\\)`).exec(ddl)?.[1];
      expect(body, `${table}: ${check}`).toBeDefined();
      expect([...(body ?? "").matchAll(/'([A-Z]{3})'/g)].map((m) => m[1]).sort(), check).toEqual(
        [...SQL_CURRENCIES].sort(),
      );
    }
  });

  it("the stages are every stage `stageSql` gives, in its order, and core's stage type", () => {
    const sql = stageSql("d", settingsBinds("?1"));
    const given = [...sql.matchAll(/(?:THEN|ELSE) '([a-z_]+)'/g)].map((m) => m[1]);
    expect(given).toEqual([...EXPORT_STAGES]);
    // core's type and the list name the same stages (a compile-time check both ways)
    const asCore: readonly RealisationStage[] = EXPORT_STAGES;
    const missing: Exclude<RealisationStage, (typeof EXPORT_STAGES)[number]> extends never ? true : false =
      true;
    expect(asCore).toHaveLength(6);
    expect(missing).toBe(true);
  });
});
