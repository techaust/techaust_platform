// The M5.5b report routes [ADM-REP-04, ADM-REP-07, ADM-CLI-04, ADM-DASH-01; LD71, LD74, LD78, LD79, LD85, LD86; VERIFY WITH CA/LEGAL]: who may call each (every role), the fresh step-up on every
// register page and one audit row per page (never row contents), the period rules, keyset paging, the settings the pages depend on, the EDF month, the realisation list, a client's
// statement and its PDF (the cache row, the queue message, the stream, every refusal).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ROUTES } from "./guard.ts";
import { call, one, rows, sessionFor, withEnv } from "./test-helpers.ts";
import { putTax } from "./test-invoice-types.ts";
import { type J, json, putCompany } from "./test-invoices.ts";
import { addDoc, addReceipt, computeFor, line, mkReportClient } from "./test-reports.ts";

const ROLES = ["owner", "staff", "sales", "accountant"] as const;
const RANGE = "from=2026-10-01&to=2026-10-31";
const registers = (cookie: string, q = RANGE) => call(`/reports/registers?${q}`, { cookie });
const auditRows = (action: string) =>
  rows<{ summary: string }>("SELECT summary FROM audit_log WHERE action = ? ORDER BY at, rowid", action);
/** The audit rows an action has written since `before` (rows are append-only, so a test counts from where it started). */
const since = async (action: string, before: number) => (await auditRows(action)).slice(before);
const countOfAudit = async (action: string) => (await auditRows(action)).length;

beforeEach(async () => {
  await putCompany();
  await putTax();
});

describe("the route table", () => {
  it("has a row for every M5.5b route, with the action the brief names", () => {
    const want: [string, string, string][] = [
      ["GET", "/api/v1/reports/registers", "exports.gst"],
      ["GET", "/api/v1/reports/edf", "reports.finance"],
      ["GET", "/api/v1/reports/realisation", "reports.finance"],
      ["GET", "/api/v1/clients/:id/statement", "clients.finance.read"],
      ["POST", "/api/v1/clients/:id/statement/pdf", "clients.finance.read"],
      ["GET", "/api/v1/clients/:id/statement/pdf/:sid", "clients.finance.read"],
    ];
    for (const [method, path, access] of want) {
      const r = ROUTES.find((x) => x.method === method && x.path === path);
      expect(r?.access, `${method} ${path}`).toBe(access);
      expect(r?.on, `${method} ${path} is an API route`).toBeUndefined();
    }
    expect(ROUTES.find((r) => r.path === "/api/v1/reports/registers")?.audit).toBe("report.export");
    expect(ROUTES.find((r) => r.path === "/api/v1/clients/:id/statement/pdf")?.audit).toBe(
      "client.statement_pdf",
    );
  });
});

describe("who may call what (every role)", () => {
  it("the register: Owner and Accountant with a fresh code, nobody else; a missing code is step_up_required", async () => {
    const got: Record<string, number> = {};
    for (const role of ROLES) {
      const s = await sessionFor(role, { stepUp: true });
      got[role] = (await registers(s.cookie)).status;
    }
    expect(got).toEqual({ owner: 200, staff: 403, sales: 403, accountant: 200 });
    for (const role of ["owner", "accountant"] as const) {
      const stale = await sessionFor(role); // no step-up
      const res = await registers(stale.cookie);
      expect(res.status, role).toBe(403);
      expect(((await json(res)) as J).error.code).toBe("step_up_required");
    }
  });

  it("the EDF and the realisation list: Owner and Accountant, no fresh code; Staff and Sales 403", async () => {
    for (const path of ["/reports/edf?month=2026-10", "/reports/realisation"]) {
      const got: Record<string, number> = {};
      for (const role of ROLES)
        got[role] = (await call(path, { cookie: (await sessionFor(role)).cookie })).status;
      expect(got, path).toEqual({ owner: 200, staff: 403, sales: 403, accountant: 200 });
    }
  });

  it("the statement and its PDF: Owner, Staff and Accountant; Sales 403 (the API, not just the screen)", async () => {
    const c = await mkReportClient();
    await addDoc({ clientId: c, issueDate: "2026-10-05" });
    for (const [method, path, body] of [
      ["GET", `/clients/${c}/statement?${RANGE}`, undefined],
      ["POST", `/clients/${c}/statement/pdf`, { from: "2026-10-01", to: "2026-10-31" }],
      ["GET", `/clients/${c}/statement/pdf/none`, undefined],
    ] as const) {
      const got: Record<string, number> = {};
      for (const role of ROLES) {
        const s = await sessionFor(role);
        got[role] = (
          await call(
            path,
            { method, cookie: s.cookie, ...(body ? { body } : {}) },
            withEnv(env, { PDF_QUEUE: { send: async () => undefined } }),
          )
        ).status;
      }
      expect(got.sales, `${method} ${path}`).toBe(403);
      for (const role of ["owner", "staff", "accountant"])
        expect(got[role], `${role} ${method} ${path}`).not.toBe(403);
    }
  });

  it("nothing is open without a session", async () => {
    for (const path of [
      "/reports/registers?" + RANGE,
      "/reports/edf?month=2026-10",
      "/reports/realisation",
      "/clients/x/statement?" + RANGE,
    ]) {
      expect((await call(path)).status, path).toBe(401);
    }
  });
});

describe("the register page", () => {
  it("a good request is one audit row with the range, the number of rows and firstPage; never a number, a name or an amount", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const c = await mkReportClient();
    const d = await addDoc({ clientId: c, issueDate: "2026-10-05" });
    const before = await countOfAudit("report.export");
    const res = await registers(o.cookie);
    expect(res.status).toBe(200);
    const b = (await json(res)) as J;
    expect(b.rows.map((r: J) => r.id)).toContain(d.id);
    expect(b.next).toBeNull();
    const a = await since("report.export", before);
    expect(a).toHaveLength(1);
    expect(JSON.parse(a[0]?.summary as string)).toEqual({
      report: "registers",
      from: "2026-10-01",
      to: "2026-10-31",
      rows: b.rows.length,
      firstPage: true,
    });
    expect(a[0]?.summary).not.toContain(d.number);
    expect(a[0]?.summary).not.toContain("Client");
  });

  it("refuses a bad range with period_invalid or 400 and writes no audit row", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const before = await countOfAudit("report.export");
    for (const q of [
      "from=2026-10-31&to=2026-10-01",
      "from=2026-04-01&to=2027-04-01", // 367 days
      "from=2026-03-01&to=2026-04-30", // two financial years
      "from=2025-04-01&to=2027-03-31",
    ]) {
      const res = await registers(o.cookie, q);
      expect(res.status, q).toBe(400);
      expect(((await json(res)) as J).error.code, q).toBe("period_invalid");
    }
    for (const q of [
      "",
      "from=2026-10-01",
      "from=2026-13-01&to=2026-13-02",
      "from=x&to=y",
      `${RANGE}&after=not-a-cursor`,
    ]) {
      expect((await registers(o.cookie, q)).status, q).toBe(400);
    }
    expect(await since("report.export", before)).toHaveLength(0);
    // exactly one financial year of 366 days is allowed (FY 2027-28 holds 29 February 2028)
    expect((await registers(o.cookie, "from=2027-04-01&to=2028-03-31")).status).toBe(200);
  });

  it("pages of 50: the 51st row makes a cursor, the second page has the rest, each page is one audit row", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const c = await mkReportClient();
    for (let i = 0; i < 52; i++)
      await addDoc({ clientId: c, issueDate: "2026-11-20", lines: [line(100_00)] });
    const q = "from=2026-11-01&to=2026-11-30";
    const before = await countOfAudit("report.export");
    const p1 = (await json(await registers(o.cookie, q))) as J;
    expect(p1.rows).toHaveLength(50);
    expect(typeof p1.next).toBe("string");
    const p2 = (await json(await registers(o.cookie, `${q}&after=${p1.next}`))) as J;
    expect(p2.rows).toHaveLength(2);
    expect(p2.next).toBeNull();
    const ids = [...p1.rows, ...p2.rows].map((r: J) => r.id);
    expect(new Set(ids).size).toBe(52);
    const a = (await since("report.export", before)).map((r) => JSON.parse(r.summary));
    expect(a.map((x) => x.firstPage)).toEqual([true, false]);
    expect(a.map((x) => x.rows)).toEqual([50, 2]);
  });

  it("carries the four kinds, voided ones included, never a proforma; the rows have core's shape", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const c = await mkReportClient();
    const u = await mkReportClient("USD");
    const inv = await addDoc({
      clientId: c,
      issueDate: "2026-12-05",
      lines: [line(1_000_00), line(500_00, { sac: "998313", gstRateBp: 500 })],
    });
    const gone = await addDoc({ clientId: c, issueDate: "2026-12-06", voided: true });
    const exp = await addDoc({ clientId: u, currency: "USD", issueDate: "2026-12-07" });
    await addDoc({ type: "proforma", clientId: c, issueDate: "2026-12-08", status: "issued" });
    const b = (await json(await registers(o.cookie, "from=2026-12-01&to=2026-12-31"))) as J;
    expect(b.rows.map((r: J) => r.id).sort()).toEqual([inv.id, gone.id, exp.id].sort());
    const row = b.rows.find((r: J) => r.id === inv.id);
    expect(row).toMatchObject({
      kind: "tax_invoice",
      voided: false,
      number: inv.number,
      issueDate: { year: 2026, month: 12, day: 5 },
      currency: "INR",
      totalInrMinor: inv.computed.totalMinor,
      reverseCharge: false,
      series: "invoice",
      fy: "2627",
      clientId: c,
    });
    expect(row.recipient).toMatchObject({ status: "registered", name: expect.stringContaining("Client") });
    expect(row.rates.map((r: J) => [r.sac, r.rateBp])).toEqual([
      ["998313", 500],
      ["998314", 1800],
    ]);
    expect(b.rows.find((r: J) => r.id === gone.id).voided).toBe(true);
    const usd = b.rows.find((r: J) => r.id === exp.id);
    expect(usd).toMatchObject({
      currency: "USD",
      fxRateMicros: 83_123_400,
      totalInrMinor: exp.computed.inr?.totalMinor,
    });
    expect(usd.rates).toEqual([
      expect.objectContaining({ sac: "998314", rateBp: 0, taxableMinor: exp.computed.inr?.taxableMinor }),
    ]);
  });

  it("meta carries today, the supplier's state, the threshold and the realisation rules; an invalid tax row is 409 settings_invalid", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const b = (await json(await registers(o.cookie))) as J;
    expect(b.meta).toMatchObject({
      supplierStateCode: "19",
      b2clThresholdInrMinor: 1_00_000_00,
      realisation: { warnMonths: 9, inrMonths: 12, escalateMonths: 12, escalateExtraDays: 15 },
    });
    expect(b.meta.today).toEqual({
      year: expect.any(Number),
      month: expect.any(Number),
      day: expect.any(Number),
    });
    await putTax({ b2clThresholdInrMinor: 0 });
    const bad = await registers(o.cookie);
    expect(bad.status).toBe(409);
    expect(((await json(bad)) as J).error.code).toBe("settings_invalid");
    await putTax({ realisation: { warnMonths: 0, escalateMonths: 12, escalateExtraDays: 15 } });
    expect((await registers(o.cookie)).status).toBe(409);
    // a stored row without the two new keys still serves, with the defaults
    await putTax({ realisation: { warnMonths: 9, escalateMonths: 12, escalateExtraDays: 15 } });
    const old = (await json(await registers(o.cookie))) as J;
    expect(old.meta.realisation.inrMonths).toBe(12);
    expect(old.meta.b2clThresholdInrMinor).toBe(1_00_000_00);
  });

  it("a USD document without its INR view is passed on as it is, so core refuses it (never a silent zero)", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const u = await mkReportClient("USD");
    const computed = JSON.parse(
      JSON.stringify(computeFor({ clientId: u, currency: "USD", issueDate: "2027-01-05" })),
    );
    computed.lines[0].inr = null;
    await addDoc({
      clientId: u,
      currency: "USD",
      issueDate: "2027-01-05",
      over: { computed: JSON.stringify(computed) },
    });
    const b = (await json(await registers(o.cookie, "from=2027-01-01&to=2027-01-31"))) as J;
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0].rates[0]).toMatchObject({ taxableMinor: null, igstMinor: null });
  });
});

describe("the EDF month and the realisation list", () => {
  it("the EDF lists the month's non-voided export invoices and says when it is due (the last day plus 30 days)", async () => {
    const o = await sessionFor("accountant");
    const u = await mkReportClient("USD");
    const c = await mkReportClient("INR");
    const a = await addDoc({ clientId: u, currency: "USD", issueDate: "2027-02-10" });
    await addDoc({ clientId: u, currency: "USD", issueDate: "2027-02-11", voided: true });
    await addDoc({ clientId: u, currency: "USD", issueDate: "2027-03-01" });
    await addDoc({ clientId: c, issueDate: "2027-02-12" });
    const b = (await json(await call("/reports/edf?month=2027-02", { cookie: o.cookie }))) as J;
    expect(b.rows.map((r: J) => r.id)).toEqual([a.id]);
    expect(b.meta.edfDue).toEqual({ year: 2027, month: 3, day: 30 });
    const dec = (await json(await call("/reports/edf?month=2026-12", { cookie: o.cookie }))) as J;
    expect(dec.meta.edfDue).toEqual({ year: 2027, month: 1, day: 30 });
    for (const q of ["", "?month=2027-13", "?month=2027-2", "?month=x", "?month=2027-02&after=bad"]) {
      expect((await call(`/reports/edf${q}`, { cookie: o.cookie })).status, q).toBe(400);
    }
  });

  it("the realisation list is open exports by default, all with show=all; paged by 50 with a cursor", async () => {
    const o = await sessionFor("owner");
    const u = await mkReportClient("USD");
    const open = await addDoc({ clientId: u, currency: "USD", issueDate: "2027-05-10" });
    const paid = await addDoc({ clientId: u, currency: "USD", issueDate: "2027-05-11", balance: 0 });
    const voided = await addDoc({ clientId: u, currency: "USD", issueDate: "2027-05-12", voided: true });
    const got = async (q: string) =>
      ((await json(await call(`/reports/realisation${q}`, { cookie: o.cookie }))) as J).rows.map(
        (r: J) => r.id,
      ) as string[];
    const openIds = await got("");
    expect(openIds).toContain(open.id);
    expect(openIds).not.toContain(paid.id);
    expect(openIds).not.toContain(voided.id);
    const allIds = await got("?show=all");
    expect(allIds).toContain(paid.id);
    expect(allIds).not.toContain(voided.id);
    for (const q of ["?show=nope", "?after=bad"])
      expect((await call(`/reports/realisation${q}`, { cookie: o.cookie })).status, q).toBe(400);
    for (let i = 0; i < 51; i++) await addDoc({ clientId: u, currency: "USD", issueDate: "2027-06-01" });
    const p1 = (await json(await call("/reports/realisation?show=all", { cookie: o.cookie }))) as J;
    expect(p1.rows).toHaveLength(50);
    const p2 = (await json(
      await call(`/reports/realisation?show=all&after=${p1.next}`, { cookie: o.cookie }),
    )) as J;
    expect(new Set([...p1.rows, ...p2.rows].map((r: J) => r.id)).size).toBe(p1.rows.length + p2.rows.length);
    expect(p2.rows.length).toBeGreaterThanOrEqual(3);
  });
});

describe("a client's statement", () => {
  it("lists debits and credits with a running balance, closes at the ledger and leaves out proformas", async () => {
    const o = await sessionFor("owner");
    const c = await mkReportClient();
    const inv1 = await addDoc({ clientId: c, issueDate: "2026-04-10", lines: [line(1_000_00)] });
    const inv2 = await addDoc({ clientId: c, issueDate: "2026-05-10", lines: [line(2_000_00)] });
    const cn = await addDoc({
      type: "credit_note",
      clientId: c,
      issueDate: "2026-06-01",
      parentId: inv1.id,
      lines: [line(500_00)],
    });
    await env.DB.prepare(
      "UPDATE documents SET balance_minor = balance_minor - ?1, credited_minor = ?1, status = 'partially_credited' WHERE id = ?2",
    )
      .bind(cn.computed.totalMinor, inv1.id)
      .run();
    const dn = await addDoc({
      type: "debit_note",
      clientId: c,
      issueDate: "2026-06-15",
      parentId: inv2.id,
      lines: [line(100_00)],
    });
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
      createdBy: o.id,
    });
    const b = (await json(
      await call(`/clients/${c}/statement?from=2026-04-01&to=2027-03-31`, { cookie: o.cookie }),
    )) as J;
    expect(b.currency).toBe("INR");
    expect(b.entries.map((e: J) => e.kind)).toEqual([
      "tax_invoice",
      "tax_invoice",
      "credit_note",
      "debit_note",
      "tax_invoice",
      "receipt",
    ]);
    expect(b.entries.map((e: J) => e.number)).toEqual([
      inv1.number,
      inv2.number,
      cn.number,
      dn.number,
      adv.number,
      adv.number,
    ]);
    const debits =
      inv1.computed.totalMinor + inv2.computed.totalMinor + dn.computed.totalMinor + adv.computed.totalMinor;
    const credits = cn.computed.totalMinor + adv.computed.totalMinor;
    expect(b.range).toEqual({
      openingMinor: 0,
      debitMinor: debits,
      creditMinor: credits,
      closingMinor: debits - credits,
    });
    expect(b.entries.at(-1).balanceMinor).toBe(debits - credits);
    expect(b.balanceBeforeMinor).toBe(0);
    const ledger = await one<{ s: number }>(
      "SELECT sum(balance_minor) AS s FROM documents WHERE client_id = ? AND type IN ('tax_invoice', 'export_invoice', 'debit_note') AND status <> 'void'",
      c,
    );
    expect(b.range.closingMinor).toBe(ledger?.s);
    expect(b.next).toBeNull();
    // the same range from June: the opening balance is what came before
    const jun = (await json(
      await call(`/clients/${c}/statement?from=2026-06-01&to=2027-03-31`, { cookie: o.cookie }),
    )) as J;
    expect(jun.range.openingMinor).toBe(inv1.computed.totalMinor + inv2.computed.totalMinor);
    expect(jun.balanceBeforeMinor).toBe(jun.range.openingMinor);
    expect(jun.range.closingMinor).toBe(b.range.closingMinor);
  });

  it("pages of 50: a later page starts from the balance before it, the range's opening stays the same", async () => {
    const o = await sessionFor("owner");
    const c = await mkReportClient();
    for (let i = 0; i < 52; i++)
      await addDoc({ clientId: c, issueDate: "2026-08-10", lines: [line(100_00)] });
    const q = "from=2026-08-01&to=2026-08-31";
    const p1 = (await json(await call(`/clients/${c}/statement?${q}`, { cookie: o.cookie }))) as J;
    expect(p1.entries).toHaveLength(50);
    expect(typeof p1.next).toBe("string");
    const p2 = (await json(
      await call(`/clients/${c}/statement?${q}&after=${p1.next}`, { cookie: o.cookie }),
    )) as J;
    expect(p2.entries).toHaveLength(2);
    expect(p2.balanceBeforeMinor).toBe(p1.entries.at(-1).balanceMinor);
    expect(p2.range).toEqual(p1.range);
    expect(p2.entries.at(-1).balanceMinor).toBe(p1.range.closingMinor);
    expect(p2.next).toBeNull();
  });

  it("is in the client's own currency unless another is asked for; unknown clients are 404; bad dates and cursors are 400", async () => {
    const o = await sessionFor("owner");
    const u = await mkReportClient("USD");
    await addDoc({ clientId: u, currency: "USD", issueDate: "2026-10-05" });
    const usd = (await json(await call(`/clients/${u}/statement?${RANGE}`, { cookie: o.cookie }))) as J;
    expect(usd.currency).toBe("USD");
    expect(usd.entries).toHaveLength(1);
    const inr = (await json(
      await call(`/clients/${u}/statement?${RANGE}&currency=INR`, { cookie: o.cookie }),
    )) as J;
    expect(inr.entries).toEqual([]);
    expect((await call(`/clients/nope/statement?${RANGE}`, { cookie: o.cookie })).status).toBe(404);
    // L7: with a currency named, the existence check rides in the one batch and an unknown client is still 404
    expect((await call(`/clients/nope/statement?${RANGE}&currency=USD`, { cookie: o.cookie })).status).toBe(
      404,
    );
    for (const q of [
      "",
      "from=2026-05-01&to=2026-04-01",
      "from=x&to=y",
      `${RANGE}&currency=EUR`,
      `${RANGE}&after=bad`,
    ]) {
      expect((await call(`/clients/${u}/statement?${q}`, { cookie: o.cookie })).status, q).toBe(400);
    }
  });
});

describe("the statement PDF", () => {
  const queue = (fail = false) => {
    const sent: unknown[] = [];
    return {
      sent,
      env: withEnv(env, {
        PDF_QUEUE: {
          send: async (m: unknown) => {
            if (fail) throw new Error("queue down");
            sent.push(m);
          },
        },
      }),
    };
  };
  const ask = (cookie: string, clientId: string, body: Record<string, unknown>, e: Env) =>
    call(`/clients/${clientId}/statement/pdf`, { cookie, body }, e);

  it("a request makes one cache row, one audit row and one pdf.statement message; 202 with the row's id", async () => {
    const o = await sessionFor("owner");
    const c = await mkReportClient();
    await addDoc({ clientId: c, issueDate: "2026-10-05" });
    const q = queue();
    const before = await countOfAudit("client.statement_pdf");
    const res = await ask(o.cookie, c, { from: "2026-10-01", to: "2026-10-31" }, q.env);
    expect(res.status).toBe(202);
    const { id } = (await json(res)) as J;
    expect(q.sent).toEqual([{ v: 1, kind: "pdf.statement", statementId: id, hop: 0 }]);
    const row = await one<J>("SELECT * FROM statement_pdfs WHERE id = ?", id);
    expect(row).toMatchObject({
      client_id: c,
      currency: "INR",
      from_date: "2026-10-01",
      to_date: "2026-10-31",
      requested_by: o.id,
      pdf_r2_key: null,
      failed_at: null,
    });
    const issuer = JSON.parse(row?.issuer as string);
    expect(Object.keys(issuer)).toEqual(["company"]);
    expect(issuer.company).toMatchObject({
      tradeName: expect.any(String),
      stateCode: "19",
      logo: expect.stringMatching(/\.svg$/),
    });
    expect(issuer.company).not.toHaveProperty("bank");
    const a = await since("client.statement_pdf", before);
    expect(a).toHaveLength(1);
    expect(JSON.parse(a[0]?.summary as string)).toMatchObject({
      statementId: id,
      from: "2026-10-01",
      to: "2026-10-31",
      currency: "INR",
      entries: 1,
    });
  });

  it("refuses an empty range, more than 200 lines, an anonymised client and a bad range, and writes nothing", async () => {
    const o = await sessionFor("owner");
    const q = queue();
    const c = await mkReportClient();
    const before = await countOfAudit("client.statement_pdf");
    const rowsBefore = (await one<{ n: number }>("SELECT count(*) AS n FROM statement_pdfs"))?.n;
    const code = async (res: Response) => ((await json(res)) as J).error.code;
    const empty = await ask(o.cookie, c, { from: "2026-10-01", to: "2026-10-31" }, q.env);
    expect([empty.status, await code(empty)]).toEqual([409, "statement_empty"]);
    for (let i = 0; i < 201; i++)
      await addDoc({ clientId: c, issueDate: "2026-09-10", lines: [line(100_00)] });
    const long = await ask(o.cookie, c, { from: "2026-09-01", to: "2026-09-30" }, q.env);
    expect([long.status, await code(long)]).toEqual([409, "statement_too_long"]);
    const gone = await mkReportClient();
    await addDoc({ clientId: gone, issueDate: "2026-10-05" });
    await env.DB.prepare("UPDATE clients SET anonymised_at = ? WHERE id = ?").bind(Date.now(), gone).run();
    const anon = await ask(o.cookie, gone, { from: "2026-10-01", to: "2026-10-31" }, q.env);
    expect([anon.status, await code(anon)]).toEqual([409, "client_anonymised"]);
    for (const body of [
      { from: "2026-10-31", to: "2026-10-01" },
      { from: "x", to: "y" },
      { from: "2026-10-01" },
      { from: "2026-10-01", to: "2026-10-31", extra: 1 },
    ]) {
      expect((await ask(o.cookie, c, body, q.env)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await ask(o.cookie, "nope", { from: "2026-10-01", to: "2026-10-31" }, q.env)).status).toBe(404);
    expect(q.sent).toEqual([]);
    expect((await one<{ n: number }>("SELECT count(*) AS n FROM statement_pdfs"))?.n).toBe(rowsBefore);
    expect(await since("client.statement_pdf", before)).toHaveLength(0);
  });

  it("the same range asked again while the first is pending gives that row's id and no second job, audit row or cache row (L6); a changed range, a failed or a finished one is a new request", async () => {
    const o = await sessionFor("owner");
    const c = await mkReportClient();
    await addDoc({ clientId: c, issueDate: "2026-10-05" });
    const q = queue();
    const first = (await json(await ask(o.cookie, c, { from: "2026-10-01", to: "2026-10-31" }, q.env))) as J;
    const before = await countOfAudit("client.statement_pdf");
    const rowsBefore = (await one<{ n: number }>("SELECT count(*) AS n FROM statement_pdfs"))?.n;
    const again = await ask(o.cookie, c, { from: "2026-10-01", to: "2026-10-31", currency: "INR" }, q.env);
    expect(again.status).toBe(202);
    expect(((await json(again)) as J).id).toBe(first.id);
    expect(q.sent).toHaveLength(1);
    expect(await since("client.statement_pdf", before)).toHaveLength(0);
    expect((await one<{ n: number }>("SELECT count(*) AS n FROM statement_pdfs"))?.n).toBe(rowsBefore);
    // another range: a new row and a new job
    const other = (await json(await ask(o.cookie, c, { from: "2026-10-01", to: "2026-10-30" }, q.env))) as J;
    expect(other.id).not.toBe(first.id);
    expect(q.sent).toHaveLength(2);
    // older than five minutes: a new request
    await env.DB.prepare("UPDATE statement_pdfs SET created_at = ?1 WHERE id = ?2")
      .bind(Date.now() - 6 * 60_000, first.id)
      .run();
    const late = (await json(await ask(o.cookie, c, { from: "2026-10-01", to: "2026-10-31" }, q.env))) as J;
    expect(late.id).not.toBe(first.id);
    // a failed one is not reused
    await env.DB.prepare("UPDATE statement_pdfs SET failed_at = 1, fail_code = 'render' WHERE id = ?1")
      .bind(late.id)
      .run();
    const afterFail = (await json(
      await ask(o.cookie, c, { from: "2026-10-01", to: "2026-10-31" }, q.env),
    )) as J;
    expect(afterFail.id).not.toBe(late.id);
    // a finished one is not reused either
    await env.DB.prepare(
      "UPDATE statement_pdfs SET pdf_r2_key = 'k', pdf_sha256 = ?2, rendered_at = 1 WHERE id = ?1",
    )
      .bind(afterFail.id, "b".repeat(64))
      .run();
    const afterDone = (await json(
      await ask(o.cookie, c, { from: "2026-10-01", to: "2026-10-31" }, q.env),
    )) as J;
    expect(afterDone.id).not.toBe(afterFail.id);
  });

  it("a queue that fails is told to the person: 503, the row marked failed with the code queue", async () => {
    const o = await sessionFor("owner");
    const c = await mkReportClient();
    await addDoc({ clientId: c, issueDate: "2026-10-05" });
    const res = await ask(o.cookie, c, { from: "2026-10-01", to: "2026-10-31" }, queue(true).env);
    expect(res.status).toBe(503);
    expect(((await json(res)) as J).error.code).toBe("queue_unavailable");
    const row = await one<J>("SELECT failed_at, fail_code FROM statement_pdfs WHERE client_id = ?", c);
    expect(row?.fail_code).toBe("queue");
    expect(row?.failed_at).toEqual(expect.any(Number));
  });

  it("the download: pending 202, failed 409, ready streamed with the safe headers, another client's id 404", async () => {
    const o = await sessionFor("owner");
    const c = await mkReportClient();
    const other = await mkReportClient();
    await addDoc({ clientId: c, issueDate: "2026-10-05" });
    const q = queue();
    const { id } = (await json(await ask(o.cookie, c, { from: "2026-10-01", to: "2026-10-31" }, q.env))) as J;
    const get = (cid: string, sid: string) =>
      call(`/clients/${cid}/statement/pdf/${sid}`, { cookie: o.cookie });
    const pending = await get(c, id);
    expect([pending.status, await json(pending)]).toEqual([202, { status: "pending" }]);
    const key = `statements/${c}/${"a".repeat(64)}.pdf`;
    await env.DOCS.put(key, new Uint8Array([37, 80, 68, 70, 45]));
    await env.DB.prepare(
      "UPDATE statement_pdfs SET pdf_r2_key = ?1, pdf_sha256 = ?2, rendered_at = ?3 WHERE id = ?4",
    )
      .bind(key, "a".repeat(64), Date.now(), id)
      .run();
    const ready = await get(c, id);
    expect(ready.status).toBe(200);
    expect(ready.headers.get("Content-Type")).toBe("application/pdf");
    expect(ready.headers.get("Cache-Control")).toBe("no-store");
    expect(ready.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(ready.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(ready.headers.get("Content-Disposition")).toMatch(
      /attachment.*statement-T\d{4}-2026-10-01-to-2026-10-31\.pdf/,
    );
    expect(Array.from(new Uint8Array(await ready.arrayBuffer()))).toEqual([37, 80, 68, 70, 45]);
    // M2: an anonymised client's PDF is not served even while the object is still there (409 before R2), and comes back once it is not anonymised
    await env.DB.prepare("UPDATE clients SET anonymised_at = ?1 WHERE id = ?2").bind(Date.now(), c).run();
    const anon = await get(c, id);
    expect([anon.status, ((await json(anon)) as J).error.code]).toEqual([409, "client_anonymised"]);
    await env.DB.prepare("UPDATE clients SET anonymised_at = NULL WHERE id = ?1").bind(c).run();
    expect((await get(c, id)).status).toBe(200);
    // M2: the key is set but the object is gone from R2 (purged): a 409 `statement_failed`, never "pending" for ever and never a 500
    await env.DOCS.delete(key);
    const gone = await get(c, id);
    expect([gone.status, ((await json(gone)) as J).error.code]).toEqual([409, "statement_failed"]);
    expect((await get(other, id)).status).toBe(404);
    expect((await get(c, "nope")).status).toBe(404);
    await env.DB.prepare("UPDATE statement_pdfs SET failed_at = ?1, fail_code = 'render' WHERE id = ?2")
      .bind(Date.now(), id)
      .run();
    const failed = await get(c, id);
    expect([failed.status, ((await json(failed)) as J).error.code]).toEqual([409, "statement_failed"]);
  });
});
