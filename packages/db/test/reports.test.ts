// The report statements [ADM-REP-04, ADM-REP-06, ADM-REP-07, ADM-CLI-04, ADM-DASH-01; M5.5b, LD71 to LD81; Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28)]: every statement is EXPLAINed
// (the new partial indexes are used, no table scan), the register page reads what it should in the order it should, the SQL rates are a twin of core's
// `registerRatesOf`, and the statement closes at the sum of the open debit documents' balances.
import { registerRatesOf } from "@techaust/core/gst";
import type { ComputedDocument, LineInput } from "@techaust/core/tax";
import { describe, expect, it } from "vitest";
import { goldenDocuments } from "../../core/test/tax/golden-cases.ts";
import {
  CLIENT_FIGURES_SQL,
  EDF_COUNT_SQL,
  EDF_MONTH_SQL,
  EXPORT_NEXT_SQL,
  EXPORT_STAGE_COUNTS_SQL,
  INVOICED_SQL,
  OVERDUE_OLDEST_SQL,
  OWED_SQL,
  PROFORMAS_AWAITING_SQL,
  PROJECT_BILLED_SQL,
  REALISATION_BELLS_SQL,
  REALISATION_PAGE_SQL,
  REALISATION_SCAN_SQL,
  REGISTER_PAGE_SQL,
  REPORT_PAGE_SIZE,
  type RegisterSqlRow,
  realisationScanBinds,
  STATEMENT_BALANCE_BEFORE_SQL,
  STATEMENT_COUNT_SQL,
  STATEMENT_ENTRIES_SQL,
  STATEMENT_LEDGER_SQL,
  STATEMENT_PAGE_SQL,
  STATEMENT_TOTALS_SQL,
  statementBalanceBeforeBinds,
  statementPageBinds,
  statementTotalsBinds,
} from "../src/reports.ts";
import { all, first, run } from "./helpers.ts";
import {
  addDoc,
  addReceipt,
  computeFor,
  line,
  mkOwner,
  mkReportClient,
  type Spec,
} from "./reports-helpers.ts";

const plan = async (sql: string, ...binds: unknown[]): Promise<string> => {
  const rows = await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...binds);
  return rows.map((r) => r.detail).join("\n");
};
/**
 * A table scan (a SEARCH is fine; the bare word SCAN is not): the table names and every alias the statements use (`d` documents, `r` receipts, `inv` the
 * invoice behind a receipt, `c` clients, `n` notifications), so an aliased scan cannot slip through (M4). A walk of a partial index (`SCAN d USING INDEX x`) is
 * not a table scan: the realisation list and the two dashboard export statements walk the export index by design (it holds exports only, and the list is
 * ordered by it and ends at 51 rows); each of those is asserted by name below.
 */
const scansTable = (p: string): boolean =>
  /SCAN (documents|advance_receipts|d|r|inv|c|n)\b(?! USING)/.test(p);

describe("the page size is one constant", () => {
  it("is 50, and every page statement reads one more row to know there is a next page", () => {
    expect(REPORT_PAGE_SIZE).toBe(50);
    for (const sql of [
      REGISTER_PAGE_SQL(false),
      REGISTER_PAGE_SQL(true),
      EDF_MONTH_SQL(true),
      REALISATION_PAGE_SQL("open", false),
      REALISATION_SCAN_SQL(false),
      STATEMENT_PAGE_SQL(true),
    ]) {
      expect(sql).toMatch(new RegExp(`LIMIT ${REPORT_PAGE_SIZE + 1}$`));
    }
  });
});

describe("EXPLAIN: every report statement uses an index", () => {
  it("the register page, with and without a cursor, reads `documents_issued_on`", async () => {
    for (const [sql, binds] of [
      [REGISTER_PAGE_SQL(false), ["2026-04-01", "2027-03-31"]],
      [REGISTER_PAGE_SQL(true), ["2026-04-01", "2027-03-31", "2026-10-05", "x"]],
    ] as const) {
      const p = await plan(sql, ...binds);
      expect(p).toMatch(/USING INDEX documents_issued_on/);
      expect(scansTable(p), p).toBe(false);
    }
  });

  it("the EDF month and the realisation list read `documents_export_issued`", async () => {
    for (const [sql, binds] of [
      [EDF_MONTH_SQL(false), ["2026-10-01", "2026-10-31"]],
      [EDF_MONTH_SQL(true), ["2026-10-01", "2026-10-31", "2026-10-05", "x"]],
      [REALISATION_PAGE_SQL("open", false), []],
      [REALISATION_PAGE_SQL("all", true), ["2026-10-05", "x"]],
      [
        REALISATION_SCAN_SQL(false),
        [
          ...realisationScanBinds("2028-03-01", {
            femaMonthsForeign: 9,
            femaMonthsInr: 12,
            gstMonths: 12,
            gstExtraDays: 15,
            approachingDays: 30,
          }),
        ],
      ],
      [
        REALISATION_SCAN_SQL(true),
        [
          ...realisationScanBinds(
            "2028-03-01",
            { femaMonthsForeign: 9, femaMonthsInr: 12, gstMonths: 12, gstExtraDays: 15, approachingDays: 30 },
            { d: "2026-10-05", id: "x" },
          ),
        ],
      ],
      [EXPORT_STAGE_COUNTS_SQL, ["2028-03-01"]],
      [EXPORT_NEXT_SQL, ["2028-03-01"]],
    ] as const) {
      const p = await plan(sql, ...binds);
      expect(p).toMatch(/USING INDEX documents_export_issued/);
      expect(scansTable(p), p).toBe(false);
    }
  });

  it("the EDF month and the alert scan SEARCH the export index on the date range; the list and the dashboard walk it in order (M4)", async () => {
    const rules = {
      femaMonthsForeign: 9,
      femaMonthsInr: 12,
      gstMonths: 12,
      gstExtraDays: 15,
      approachingDays: 30,
    };
    const edf = await plan(EDF_MONTH_SQL(false), "2026-10-01", "2026-10-31");
    expect(edf).toMatch(/SEARCH d USING INDEX documents_export_issued \(issue_date>\? AND issue_date<\?\)/);
    const scan = await plan(REALISATION_SCAN_SQL(false), ...realisationScanBinds("2028-03-01", rules));
    expect(scan).toMatch(/SEARCH d USING INDEX documents_export_issued \(issue_date<\?\)/);
    for (const [sql, binds] of [
      [REALISATION_PAGE_SQL("open", false), []],
      [EXPORT_STAGE_COUNTS_SQL, ["2028-03-01"]],
      [EXPORT_NEXT_SQL, ["2028-03-01"]],
    ] as const) {
      expect(await plan(sql, ...binds)).toMatch(/SCAN d USING INDEX documents_export_issued/);
    }
  });

  it("the statement reads `documents_client_issued` and `advance_receipts_client_received`", async () => {
    const cursor = { sk: "2026-10-05|1", id: "x" };
    for (const [sql, binds] of [
      [STATEMENT_PAGE_SQL(false), statementPageBinds("c", "INR", "2026-04-01", "2027-03-31")],
      [STATEMENT_PAGE_SQL(true), statementPageBinds("c", "INR", "2026-04-01", "2027-03-31", cursor)],
      [STATEMENT_BALANCE_BEFORE_SQL(false), statementBalanceBeforeBinds("c", "INR", "2026-04-01")],
      [STATEMENT_BALANCE_BEFORE_SQL(true), statementBalanceBeforeBinds("c", "INR", "2026-04-01", cursor)],
      [STATEMENT_TOTALS_SQL, statementTotalsBinds("c", "INR", "2026-04-01", "2027-03-31")],
      [STATEMENT_COUNT_SQL, statementTotalsBinds("c", "INR", "2026-04-01", "2027-03-31")],
    ] as const) {
      const p = await plan(sql, ...binds);
      expect(p).toMatch(/USING INDEX documents_client_issued/);
      expect(p).toMatch(/USING (COVERING )?INDEX advance_receipts_client_received/);
      expect(scansTable(p), p).toBe(false);
    }
  });

  it("the ledger sum reads the client's documents by an index", async () => {
    const p = await plan(STATEMENT_LEDGER_SQL, "c", "INR");
    expect(scansTable(p), p).toBe(false);
  });

  it("FX-3: a client's Overview figures seek the client in `documents_client_issued`; a project's billed figure seeks `documents_project`", async () => {
    const cl = await plan(CLIENT_FIGURES_SQL, "c", "2026-10-29");
    expect(cl).toMatch(/SEARCH d USING INDEX documents_client_issued \(client_id=\?\)/);
    expect(scansTable(cl), cl).toBe(false);
    const pr = await plan(PROJECT_BILLED_SQL, "p");
    expect(pr).toMatch(/SEARCH d USING INDEX documents_project \(project_id=\?\)/);
    expect(scansTable(pr), pr).toBe(false);
    // FX-3 fix round (item 7): the anonymised check is a one-off lookup by key (a plain SCALAR SUBQUERY, never a correlated one run per document)
    for (const p of [cl, pr]) {
      expect(p).not.toMatch(/CORRELATED/);
      expect(p).toMatch(/SEARCH z USING (INDEX sqlite_autoindex_clients_1|PRIMARY KEY) \(id=\?\)/);
      expect(p).not.toMatch(/SCAN (z|zp)\b(?! USING)/);
    }
  });

  it("the dashboard's invoiced figure reads `documents_issued_on`; what clients owe and the oldest overdue read `documents_status_due`", async () => {
    const inv = await plan(INVOICED_SQL, "2026-04-01", "2027-03-31", "2026-10-01");
    expect(inv).toMatch(/USING INDEX documents_issued_on/);
    expect(scansTable(inv), inv).toBe(false);
    for (const [sql, binds] of [
      [OWED_SQL, ["2026-10-30"]],
      [OVERDUE_OLDEST_SQL, ["2026-10-30"]],
    ] as const) {
      const p = await plan(sql, ...binds);
      expect(p).toMatch(/USING INDEX documents_status_due/);
      expect(scansTable(p), p).toBe(false);
    }
  });

  it("the proformas awaiting payment read the type and status index, never the ledger of invoices", async () => {
    const p = await plan(PROFORMAS_AWAITING_SQL);
    expect(p).toMatch(/USING INDEX documents_type_status_created/);
    expect(scansTable(p), p).toBe(false);
  });

  it("the bells lookup is a seek on the entity (M3)", async () => {
    const p = await plan(REALISATION_BELLS_SQL, "[]");
    expect(p).toMatch(/SEARCH n USING INDEX notifications_entity \(entity_type=\? AND entity_id=\?\)/);
    expect(scansTable(p), p).toBe(false);
  });

  it("the scan regex sees an aliased scan (M4): a statement that scans `d` fails it", async () => {
    const bad = await plan("SELECT count(*) FROM documents d WHERE d.currency = 'INR'");
    expect(bad).toMatch(/SCAN d\b/);
    expect(scansTable(bad)).toBe(true);
    expect(scansTable("SEARCH d USING INDEX documents_issued_on (issue_date>? AND issue_date<?)")).toBe(
      false,
    );
  });

  it("the range plans are SEARCHes on the range, not only mentions of the index (M4)", async () => {
    const reg = await plan(REGISTER_PAGE_SQL(false), "2026-04-01", "2027-03-31");
    expect(reg).toMatch(/SEARCH d USING INDEX documents_issued_on \(issue_date>\? AND issue_date<\?\)/);
    const cursor = { sk: "2026-10-05|1", id: "x" };
    const st = await plan(
      STATEMENT_PAGE_SQL(false),
      ...statementPageBinds("c", "INR", "2026-04-01", "2027-03-31"),
    );
    expect(st).toMatch(
      /SEARCH d USING INDEX documents_client_issued \(client_id=\? AND issue_date>\? AND issue_date<\?\)/,
    );
    expect(st).toMatch(
      /SEARCH r USING (COVERING )?INDEX advance_receipts_client_received \(client_id=\? AND received_on>\? AND received_on<\?\)/,
    );
    const before = await plan(
      STATEMENT_BALANCE_BEFORE_SQL(true),
      ...statementBalanceBeforeBinds("c", "INR", "2026-04-01", cursor),
    );
    expect(before).toMatch(/SEARCH d USING INDEX documents_client_issued \(client_id=\?\)/);
    const ledger = await plan(STATEMENT_LEDGER_SQL, "c", "INR");
    expect(ledger).toMatch(/SEARCH d USING INDEX documents_client_issued \(client_id=\?\)/);
  });
});

/** The register page for a range, all pages. */
async function registerPages(from: string, to: string): Promise<RegisterSqlRow[]> {
  const out: RegisterSqlRow[] = [];
  let cursor: { d: string; id: string } | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const page = cursor
      ? await all<RegisterSqlRow>(REGISTER_PAGE_SQL(true), from, to, cursor.d, cursor.id)
      : await all<RegisterSqlRow>(REGISTER_PAGE_SQL(false), from, to);
    out.push(...page.slice(0, 50));
    if (page.length <= 50) return out;
    const last = page[49] as RegisterSqlRow;
    cursor = { d: last.issue_date, id: last.id };
  }
  throw new Error("too many pages");
}

describe("the register page", () => {
  it("lists the four kinds, voided ones included, by (issue date, id); never a proforma, a draft or another range", async () => {
    const c = await mkReportClient("INR");
    const u = await mkReportClient("USD");
    const a = await addDoc({ clientId: c, issueDate: "2026-10-05" });
    const b = await addDoc({ clientId: c, issueDate: "2026-10-05" });
    const v = await addDoc({ clientId: c, issueDate: "2026-10-06", voided: true });
    const x = await addDoc({ clientId: u, currency: "USD", issueDate: "2026-10-07" });
    const cn = await addDoc({
      type: "credit_note",
      clientId: c,
      issueDate: "2026-10-08",
      parentId: a.id,
      lines: [line(100_00)],
    });
    const dn = await addDoc({
      type: "debit_note",
      clientId: c,
      issueDate: "2026-10-09",
      parentId: a.id,
      lines: [line(50_00)],
    });
    await addDoc({ type: "proforma", clientId: c, issueDate: "2026-10-10", status: "issued" });
    await addDoc({ clientId: c, issueDate: "2026-10-11", frozen: false });
    await addDoc({ clientId: c, issueDate: "2026-09-30" });
    await addDoc({ clientId: c, issueDate: "2026-11-01" });
    const rows = await registerPages("2026-10-01", "2026-10-31");
    const ids = [a.id, b.id].sort();
    expect(rows.map((r) => r.id)).toEqual([...ids, v.id, x.id, cn.id, dn.id]);
    expect(rows.find((r) => r.id === v.id)?.voided_at).not.toBeNull();
    // the INR columns: an INR document's own, a USD document's INR view
    const inr = rows.find((r) => r.id === a.id) as RegisterSqlRow;
    expect(inr).toMatchObject({
      type: "tax_invoice",
      series: "invoice",
      fy: "2627",
      currency: "INR",
      client_id: c,
    });
    expect(inr.total_inr_minor).toBe(inr.total_minor);
    const usd = rows.find((r) => r.id === x.id) as RegisterSqlRow;
    expect(usd).toMatchObject({ currency: "USD", fx_rate_micros: 83_123_400 });
    expect(usd.total_inr_minor).toBe(x.computed.inr?.totalMinor);
    expect(usd.round_off_inr_minor).toBe(x.computed.inr?.roundOffMinor);
    expect(inr.round_off_inr_minor).toBe(a.computed.roundOffMinor);
  });

  it("pages of exactly 50 and 51 rows: the 51st row says there is another page, and no row is read twice or lost", async () => {
    const c = await mkReportClient("INR");
    const made: string[] = [];
    for (let i = 0; i < 101; i++) {
      made.push(
        (
          await addDoc({
            clientId: c,
            issueDate: `2027-01-${String(1 + (i % 28)).padStart(2, "0")}`,
            lines: [line(100_00)],
          })
        ).id,
      );
    }
    const first51 = await all<RegisterSqlRow>(REGISTER_PAGE_SQL(false), "2027-01-01", "2027-01-31");
    expect(first51).toHaveLength(51);
    const everything = await registerPages("2027-01-01", "2027-01-31");
    expect(everything).toHaveLength(101);
    expect(new Set(everything.map((r) => r.id)).size).toBe(101);
    expect(everything.map((r) => r.id).sort()).toEqual([...made].sort());
    // sorted by (issue_date, id)
    const keys = everything.map((r) => `${r.issue_date}|${r.id}`);
    expect(keys).toEqual([...keys].sort());
    // a range of exactly 50 rows has no 51st
    const fifty = await all<RegisterSqlRow>(REGISTER_PAGE_SQL(false), "2027-01-01", "2027-01-01");
    expect(fifty.length).toBeLessThanOrEqual(50);
  });

  it("carries the recipient snapshot, the note's parent block and the purpose code from the stored JSON", async () => {
    const c = await mkReportClient("INR");
    const parent = await addDoc({ clientId: c, issueDate: "2027-02-01" });
    const noteOf = { kind: "credit", parent: { number: parent.number } };
    const cn = await addDoc({
      type: "credit_note",
      clientId: c,
      issueDate: "2027-02-02",
      parentId: parent.id,
      lines: [line(10_00)],
      headerExtras: { noteOf },
      recipientSnapshot: {
        legalName: "Frozen Name",
        gstStatus: "registered",
        gstin: "19ABCDE1234F1ZX",
        stateCode: "19",
        country: "IN",
        address: { line1: "1 Test Road", city: "Testville", country: "IN" },
      },
    });
    const u = await mkReportClient("USD");
    const ex = await addDoc({
      clientId: u,
      currency: "USD",
      issueDate: "2027-02-03",
      issuer: { bank: { swift: { purposeCode: "P0802" } } },
    });
    const rows = await all<RegisterSqlRow>(REGISTER_PAGE_SQL(false), "2027-02-01", "2027-02-28");
    const note = rows.find((r) => r.id === cn.id) as RegisterSqlRow;
    expect(note).toMatchObject({
      r_name: "Frozen Name",
      r_status: "registered",
      r_gstin: "19ABCDE1234F1ZX",
      r_state: "19",
      r_country: "IN",
    });
    expect(JSON.parse(note.r_address as string)).toEqual({
      line1: "1 Test Road",
      city: "Testville",
      country: "IN",
    });
    expect(JSON.parse(note.note_of as string)).toEqual(noteOf);
    expect(rows.find((r) => r.id === ex.id)?.purpose_code).toBe("P0802");
    expect(rows.find((r) => r.id === parent.id)?.note_of).toBeNull();
  });

  it("the recipient name is the snapshot's legal name; a snapshot without one gives its own display name, and with neither, NULL (L3)", async () => {
    const c = await mkReportClient("INR");
    const both = await addDoc({
      clientId: c,
      issueDate: "2027-03-02",
      recipientSnapshot: { legalName: "Legal Ltd", displayName: "Display", gstStatus: "registered" },
    });
    const display = await addDoc({
      clientId: c,
      issueDate: "2027-03-02",
      recipientSnapshot: { displayName: "Display", gstStatus: "registered" },
    });
    const none = await addDoc({
      clientId: c,
      issueDate: "2027-03-02",
      recipientSnapshot: { gstStatus: "registered" },
    });
    const rows = await all<RegisterSqlRow>(REGISTER_PAGE_SQL(false), "2027-03-02", "2027-03-02");
    const name = (id: string) => rows.find((r) => r.id === id)?.r_name;
    expect(name(both.id)).toBe("Legal Ltd");
    expect(name(display.id)).toBe("Display");
    expect(name(none.id)).toBeNull();
  });
});

type Rates = {
  sac: string | null;
  rateBp: number;
  taxableMinor: number | null;
  igstMinor: number | null;
  cgstMinor: number | null;
  sgstMinor: number | null;
}[];

/** The rates the page returns for a document, parsed. */
async function sqlRatesOf(id: string, issueDate: string): Promise<Rates> {
  const rows = await all<RegisterSqlRow>(REGISTER_PAGE_SQL(false), issueDate, issueDate);
  const r = rows.find((x) => x.id === id) as RegisterSqlRow;
  return JSON.parse(r.rates as string) as Rates;
}

describe("the SQL rates are a twin of core's registerRatesOf", () => {
  const twin = async (spec: Omit<Spec, "issueDate">, issueDate: string) => {
    const doc = await addDoc({ ...spec, issueDate });
    const core = registerRatesOf(doc.computed);
    if (!core.ok) throw new Error(JSON.stringify(core.errors));
    expect(await sqlRatesOf(doc.id, issueDate), JSON.stringify(spec)).toEqual(core.value);
    return doc;
  };

  it("an INR document with two rates, two lines at one rate and a missing SAC", async () => {
    const c = await mkReportClient("INR");
    await twin(
      {
        clientId: c,
        lines: [
          line(1_000_00),
          line(500_00, { gstRateBp: 500 }),
          line(250_00),
          line(100_00, { sac: null, gstRateBp: 500 }),
        ],
      },
      "2027-03-01",
    );
  });

  it("an inter-state INR document (IGST) and an unregistered one", async () => {
    const c = await mkReportClient("INR", { state_code: "29" });
    await twin(
      {
        clientId: c,
        stateCode: "29",
        lines: [line(1_000_00), line(300_00, { sac: "998313", gstRateBp: 500 })],
      },
      "2027-03-02",
    );
    await twin(
      { clientId: c, recipient: "unregistered", stateCode: "29", lines: [line(77_77)] },
      "2027-03-03",
    );
  });

  it("a USD export under LUT (rate 0) and with IGST paid use the INR view of each line", async () => {
    const u = await mkReportClient("USD");
    await twin(
      {
        clientId: u,
        currency: "USD",
        fx: 83_500_000,
        lines: [line(100_000), line(33_333, { sac: "998313" })],
      },
      "2027-03-04",
    );
    await twin(
      {
        clientId: u,
        currency: "USD",
        exportMode: "igst_paid",
        fx: 84_123_456,
        lines: [line(50_000), line(1_001)],
      },
      "2027-03-05",
    );
  });

  it("a USD line without its INR view gives NULL amounts, never a zero (core refuses it)", async () => {
    const u = await mkReportClient("USD");
    const spec: Spec = {
      clientId: u,
      currency: "USD",
      issueDate: "2027-03-06",
      lines: [line(100_000), line(50_000, { sac: "998313" })],
    };
    const computed = computeFor(spec);
    const broken: ComputedDocument = {
      ...computed,
      lines: computed.lines.map((l, i) => (i === 0 ? { ...l, inr: null } : l)),
    };
    const doc = await addDoc({ ...spec, over: { computed: JSON.stringify(broken) } });
    const rates = await sqlRatesOf(doc.id, "2027-03-06");
    const bad = rates.find((r) => r.sac === "998314");
    expect(bad).toMatchObject({ taxableMinor: null, igstMinor: null, cgstMinor: null, sgstMinor: null });
    const ok = rates.find((r) => r.sac === "998313");
    expect(ok?.taxableMinor).toBeGreaterThan(0);
    expect(registerRatesOf(broken).ok).toBe(false);
  });

  it("generated documents: INR and USD, random lines, rates and discounts (60 from a fixed seed)", async () => {
    const c = await mkReportClient("INR");
    const u = await mkReportClient("USD");
    // a small deterministic generator (the package has no property-test library): a linear congruential sequence
    let state = 20_261_028;
    const next = (n: number): number => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state % n;
    };
    const SACS = ["998313", "998314", "998315", null] as const;
    const RATES = [0, 500, 1200, 1800, 2800] as const;
    let made = 0;
    for (let i = 0; i < 60; i++) {
      const count = 1 + next(6);
      const lines: LineInput[] = Array.from({ length: count }, () =>
        line(1 + next(5_000_000), {
          sac: SACS[next(SACS.length)] ?? null,
          gstRateBp: RATES[next(RATES.length)] as number,
        }),
      );
      const usd = next(2) === 1;
      const day = `2027-04-${String(1 + (i % 28)).padStart(2, "0")}`;
      const spec: Spec = usd
        ? { clientId: u, currency: "USD", fx: 1 + next(200_000_000), lines, issueDate: day }
        : { clientId: c, lines, issueDate: day };
      try {
        computeFor(spec);
      } catch {
        continue; // a combination the engine refuses is not a document
      }
      const doc = await addDoc(spec);
      const core = registerRatesOf(doc.computed);
      if (!core.ok) throw new Error(JSON.stringify(core.errors));
      expect(await sqlRatesOf(doc.id, day), JSON.stringify(spec)).toEqual(core.value);
      made++;
    }
    expect(made).toBeGreaterThan(40);
  });

  it("the tax engine's own golden documents (hand-computed, INR and USD, every supply, discounts, several rates), stored as issued documents", async () => {
    // the golden table computes each case once with the recorder on (no mock): the documents come out exactly as the engine made them
    const documents = goldenDocuments();
    expect(documents.length).toBeGreaterThan(40);
    const c = await mkReportClient("INR");
    const u = await mkReportClient("USD");
    let refused = 0;
    const start = Date.UTC(2027, 5, 1);
    for (const [i, computed] of documents.entries()) {
      const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      const doc = await addDoc({ clientId: computed.currency === "USD" ? u : c, issueDate: day, computed });
      const core = registerRatesOf(computed);
      const sql = await sqlRatesOf(doc.id, day);
      if (core.ok) {
        expect(sql, `golden document ${i}`).toEqual(core.value);
      } else {
        // core refuses (a USD line without its INR view): the SQL sums are NULL, never zero
        refused++;
        expect(
          sql.some((r) => r.taxableMinor === null),
          `golden document ${i}`,
        ).toBe(true);
      }
    }
    expect(refused).toBeLessThan(documents.length / 4);
  });
});

describe("the statement lines carry the number of the invoice a credit note is against, and the PDF read is the same lines", () => {
  it("parent only for a credit note; STATEMENT_ENTRIES_SQL(limit) gives the same order and stops at the limit", async () => {
    const c = await mkReportClient("INR");
    const inv = await addDoc({ clientId: c, issueDate: "2026-09-02", lines: [line(100_00)] });
    const dn = await addDoc({
      type: "debit_note",
      clientId: c,
      issueDate: "2026-09-03",
      parentId: inv.id,
      lines: [line(10_00)],
    });
    const cn = await addDoc({
      type: "credit_note",
      clientId: c,
      issueDate: "2026-09-03",
      parentId: inv.id,
      lines: [line(20_00)],
    });
    const binds = statementPageBinds(c, "INR", "2026-09-01", "2026-09-30");
    const page = await all<{ id: string; kind: string; parent: string | null }>(
      STATEMENT_PAGE_SQL(false),
      ...binds,
    );
    expect(page.map((r) => [r.id, r.kind, r.parent])).toEqual([
      [inv.id, "tax_invoice", null],
      [dn.id, "debit_note", null],
      [cn.id, "credit_note", inv.number],
    ]);
    const all3 = await all<{ id: string; parent: string | null }>(STATEMENT_ENTRIES_SQL(201), ...binds);
    expect(all3.map((r) => r.id)).toEqual(page.map((r) => r.id));
    expect(all3.at(-1)?.parent).toBe(inv.number);
    expect(await all(STATEMENT_ENTRIES_SQL(2), ...binds)).toHaveLength(2);
    const p = await plan(STATEMENT_ENTRIES_SQL(201), ...binds);
    expect(p).toMatch(/SEARCH d USING INDEX documents_client_issued/);
    expect(scansTable(p), p).toBe(false);
  });

  it("the EDF count is the month's non-voided exports", async () => {
    const u = await mkReportClient("USD");
    await addDoc({ clientId: u, currency: "USD", issueDate: "2028-02-02" });
    await addDoc({ clientId: u, currency: "USD", issueDate: "2028-02-29" });
    await addDoc({ clientId: u, currency: "USD", issueDate: "2028-02-15", voided: true });
    await addDoc({ clientId: u, currency: "USD", issueDate: "2028-03-01" });
    await addDoc({ clientId: await mkReportClient("INR"), issueDate: "2028-02-10" });
    const n = await first<{ n: number }>(EDF_COUNT_SQL, "2028-02-01", "2028-02-29");
    expect(n?.n).toBe(2);
    expect(await plan(EDF_COUNT_SQL, "2028-02-01", "2028-02-29")).toMatch(/documents_export_issued/);
  });
});

describe("a statement closes at the ledger", () => {
  it("Σ balance of the open debit documents = opening + debits - credits; the advance invoice nets to zero with its receipt; proformas are absent", async () => {
    const { ownerId } = await mkOwner();
    const c = await mkReportClient("INR");
    const other = await mkReportClient("INR");
    const inv1 = await addDoc({ clientId: c, issueDate: "2026-04-10", lines: [line(1_000_00)] });
    const inv2 = await addDoc({ clientId: c, issueDate: "2026-05-10", lines: [line(2_000_00)] });
    // a credit note against inv1 takes 500.00 + GST off its balance (ledger columns are the ledger's, set here as M5.3 would)
    const cn = await addDoc({
      type: "credit_note",
      clientId: c,
      issueDate: "2026-06-01",
      parentId: inv1.id,
      lines: [line(500_00)],
    });
    await run(
      "UPDATE documents SET balance_minor = balance_minor - ?1, credited_minor = ?1, status = 'partially_credited' WHERE id = ?2",
      cn.computed.totalMinor,
      inv1.id,
    );
    const dn = await addDoc({
      type: "debit_note",
      clientId: c,
      issueDate: "2026-06-15",
      parentId: inv2.id,
      lines: [line(100_00)],
    });
    // the Q9 pair: a proforma, its tax invoice for money received (settled: balance 0) and the receipt
    const pro = await addDoc({ type: "proforma", clientId: c, issueDate: "2026-07-01", status: "issued" });
    const adv = await addDoc({
      clientId: c,
      issueDate: "2026-07-05",
      lines: [line(300_00)],
      balance: 0,
      status: "paid",
      parentId: pro.id,
    });
    await addReceipt({
      clientId: c,
      proformaId: pro.id,
      invoiceId: adv.id,
      currency: "INR",
      amountMinor: adv.computed.totalMinor,
      receivedOn: "2026-07-05",
      ownerId,
    });
    // another client's and another currency's documents never appear
    await addDoc({ clientId: other, issueDate: "2026-04-11" });
    const usd = await mkReportClient("USD");
    await addDoc({ clientId: usd, currency: "USD", issueDate: "2026-04-12" });

    const range = ["2026-04-01", "2027-03-31"] as const;
    const t = await first<{ debit: number; credit: number; n: number }>(
      STATEMENT_TOTALS_SQL,
      ...statementTotalsBinds(c, "INR", ...range),
    );
    const debits =
      inv1.computed.totalMinor + inv2.computed.totalMinor + dn.computed.totalMinor + adv.computed.totalMinor;
    const credits = cn.computed.totalMinor + adv.computed.totalMinor;
    expect(t).toEqual({ debit: debits, credit: credits, n: 6 });
    const ledger = await first<{ balance: number }>(STATEMENT_LEDGER_SQL, c, "INR");
    const opening = await first<{ balance: number }>(
      STATEMENT_BALANCE_BEFORE_SQL(false),
      ...statementBalanceBeforeBinds(c, "INR", range[0]),
    );
    expect(opening?.balance).toBe(0);
    expect((opening?.balance ?? 0) + debits - credits).toBe(ledger?.balance);

    // the lines, in order: by date, a debit document before a credit note before a receipt on one day
    const page = await all<{ id: string; kind: string; date: string; number: string; amount: number }>(
      STATEMENT_PAGE_SQL(false),
      ...statementPageBinds(c, "INR", ...range),
    );
    expect(page.map((r) => r.kind)).toEqual([
      "tax_invoice",
      "tax_invoice",
      "credit_note",
      "debit_note",
      "tax_invoice",
      "receipt",
    ]);
    expect(page.at(-1)).toMatchObject({
      number: adv.number,
      amount: adv.computed.totalMinor,
      date: "2026-07-05",
    });
    expect(page.some((r) => r.id === pro.id)).toBe(false);
    // the range's opening: everything before 2026-06-01 is inv1 + inv2
    const before = await first<{ balance: number }>(
      STATEMENT_BALANCE_BEFORE_SQL(false),
      ...statementBalanceBeforeBinds(c, "INR", "2026-06-01"),
    );
    expect(before?.balance).toBe(inv1.computed.totalMinor + inv2.computed.totalMinor);
    // the balance before a page's cursor includes the cursor row itself
    const second = page[1] as { id: string; date: string; kind: string };
    const cursor = { sk: `${second.date}|1`, id: second.id };
    const upTo = await first<{ balance: number }>(
      STATEMENT_BALANCE_BEFORE_SQL(true),
      ...statementBalanceBeforeBinds(c, "INR", range[0], cursor),
    );
    expect(upTo?.balance).toBe(inv1.computed.totalMinor + inv2.computed.totalMinor);
    const rest = await all<{ id: string }>(
      STATEMENT_PAGE_SQL(true),
      ...statementPageBinds(c, "INR", ...range, cursor),
    );
    expect(rest.map((r) => r.id)).toEqual(page.slice(2).map((r) => r.id));
  });

  it("pages of 50 and 51 lines, with several kinds on one day", async () => {
    const { ownerId } = await mkOwner();
    const c = await mkReportClient("INR");
    const pro = await addDoc({ type: "proforma", clientId: c, issueDate: "2026-08-01", status: "issued" });
    const ids: string[] = [];
    for (let i = 0; i < 50; i++)
      ids.push((await addDoc({ clientId: c, issueDate: "2026-08-10", lines: [line(100_00)] })).id);
    const note = await addDoc({
      type: "credit_note",
      clientId: c,
      issueDate: "2026-08-10",
      parentId: ids[0] as string,
      lines: [line(10_00)],
    });
    const adv = await addDoc({
      clientId: c,
      issueDate: "2026-08-10",
      lines: [line(5_00)],
      balance: 0,
      parentId: pro.id,
    });
    await addReceipt({
      clientId: c,
      proformaId: pro.id,
      invoiceId: adv.id,
      currency: "INR",
      amountMinor: adv.computed.totalMinor,
      receivedOn: "2026-08-10",
      ownerId,
    });
    const binds = statementPageBinds(c, "INR", "2026-08-01", "2026-08-31");
    const p1 = await all<{ id: string; kind: string; sk: string }>(STATEMENT_PAGE_SQL(false), ...binds);
    expect(p1).toHaveLength(51); // 50 debit documents + adv, the credit note and the receipt = 53 lines
    const last = p1[49] as { sk: string; id: string };
    const p2 = await all<{ id: string; kind: string }>(
      STATEMENT_PAGE_SQL(true),
      ...statementPageBinds(c, "INR", "2026-08-01", "2026-08-31", { sk: last.sk, id: last.id }),
    );
    expect([...p1.slice(0, 50), ...p2].map((r) => r.id)).toHaveLength(53);
    expect(new Set([...p1.slice(0, 50), ...p2].map((r) => r.id)).size).toBe(53);
    expect(p2.at(-1)?.kind).toBe("receipt");
    expect(p2.some((r) => r.id === note.id)).toBe(true);
    const n = await first<{ n: number }>(
      STATEMENT_COUNT_SQL,
      ...statementTotalsBinds(c, "INR", "2026-08-01", "2026-08-31"),
    );
    expect(n?.n).toBe(53);
  });
});
