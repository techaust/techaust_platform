// Q37 (owner 2026-10-28; Researched 2026-10-28, Rule 96A, 08-C RA-19): the tax invoice for a payment received is judged by the LUT of the FY of the day the
// payment arrived. No LUT for that FY: 409 `advance_lut_missing` (with the FY in `details`) and nothing written; the Owner may ask for the IGST route
// (`route: "igst"`), which prints the 07-S section 9 line when the proforma was under LUT. The freeze WHERE holds the same rule in SQL.

import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, one, rows } from "./test-helpers.ts";
import {
  ENDORSEMENT,
  LUT_ARN,
  lutOf,
  mkProforma,
  putSwiftBank,
  putTax,
  renew,
  sealCheck,
  typesRow,
} from "./test-invoice-types.ts";
import {
  auditCount,
  codeOf,
  farSession,
  getInvoice,
  invoiceCounter,
  issueInvoice,
  type J,
  json,
  mkInvoiceClient,
  mkOverseasClient,
  patchInvoice,
  putBank,
  putCompany,
} from "./test-invoices.ts";
import { beforeBatchHolding } from "./test-quotes.ts";

type Owner = Awaited<ReturnType<typeof farSession>>;

/** 2030-03-20 06:00 UTC (IST noon is later): FY 2029-30, token "2930". */
const MARCH = Date.UTC(2030, 2, 20, 6, 0, 0);
/** 2030-04-02: FY 2030-31, token "3031". */
const APRIL = Date.UTC(2030, 3, 2, 6, 0, 0);

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  vi.useFakeTimers({ toFake: ["Date"], now: MARCH });
  await putTax({ luts: [lutOf("2930")] });
});
afterEach(() => vi.useRealTimers());

async function issuedOverseasProforma(o: Owner, mode?: "igst_paid") {
  const made = await mkProforma(o, { client: mkOverseasClient, price: 1_000_000 });
  if (mode) {
    const doc = await getInvoice(o, made.id);
    const patched = await patchInvoice(o, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      fields: { exportMode: mode },
    });
    expect(patched.status).toBe(200);
  }
  const res = await issueInvoice(o, made.id);
  expect(res.status, await res.clone().text()).toBe(200);
  return { ...made, number: (await json(res)).number as string };
}

const usd = (date: string, over: Record<string, unknown> = {}) => ({
  fx: { rate: "83.1234", date, source: "FBIL" },
  ...over,
});

let refSeq = 0;
async function advance(o: Owner, proformaId: string, receivedOn: string, over: Record<string, unknown> = {}) {
  const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", proformaId);
  return call(`/invoices/${proformaId}/advance-invoice`, {
    cookie: o.cookie,
    body: {
      expectedProformaUpdatedAt: row?.updated_at,
      amountMinor: 50_000,
      receivedOn,
      reference: `UTR LUT ${++refSeq}`,
      ...usd(receivedOn),
      ...over,
    },
  });
}

async function snapshot(proformaId: string) {
  return {
    invoiceCounter: await invoiceCounter(),
    proforma: await typesRow(proformaId),
    receipts: await rows("SELECT id FROM advance_receipts WHERE proforma_id = ?", proformaId),
    audits: await auditCount("invoice.advance_issue"),
    children: await rows("SELECT id FROM documents WHERE parent_id = ?", proformaId),
  };
}

const taxOf = (id: string) =>
  one<{ igst_minor: number; total_minor: number; export_mode: string | null }>(
    "SELECT igst_minor, total_minor, export_mode FROM documents WHERE id = ?",
    id,
  );

describe("the LUT of the FY of the receipt day [Q37, RA-19]", () => {
  it("a payment received on 1 April with no LUT for the new FY is refused on the LUT route, with the FY, and nothing is written", async () => {
    const o = await farSession();
    const pf = await issuedOverseasProforma(o);
    vi.setSystemTime(APRIL);
    await renew(o);
    const before = await snapshot(pf.id);
    const res = await advance(o, pf.id, "2030-04-02");
    expect(res.status, await res.clone().text()).toBe(409);
    const b = await json(res);
    expect((b.error as J).code).toBe("advance_lut_missing");
    expect((b.error as J).details).toEqual({ fy: "2030-31" });
    expect((b.error as J).message).toBe(
      "There's no LUT saved for FY 2030-31, when this payment was received, so this tax invoice can't be issued without IGST. Save that year's LUT ARN in Settings › Tax first, or issue it with IGST.",
    );
    expect(await snapshot(pf.id)).toEqual(before);
  });

  it("a payment received on 31 March is judged by the old FY even when the invoice is issued in April: the old LUT is used", async () => {
    const o = await farSession();
    const pf = await issuedOverseasProforma(o);
    vi.setSystemTime(APRIL);
    await renew(o);
    const res = await advance(o, pf.id, "2030-03-31");
    expect(res.status, await res.clone().text()).toBe(201);
    const b = await json(res);
    expect(b.warnings).toEqual(["advance_previous_period"]);
    expect(await taxOf(b.id)).toMatchObject({ igst_minor: 0, export_mode: "lut" });
    const check = await sealCheck(b.id, {
      export: {
        mode: "lut",
        endorsement: ENDORSEMENT.lut,
        lut: { fy: "2930", arn: LUT_ARN },
        countryCode: "US",
        countryName: "United States",
        declarationRef: null,
      },
      advance: {
        proformaId: pf.id,
        proformaNumber: pf.number,
        proformaIssueDate: "2030-03-20",
        receivedOn: "2030-03-31",
        receiptId: b.receiptId,
      },
    });
    expect(check).toEqual({ content: true, snapshot: true });
  });

  it("route igst on an LUT proforma charges IGST at 18 % and seals the FY in the header (the PDF line of 07-S section 9)", async () => {
    const o = await farSession();
    const pf = await issuedOverseasProforma(o);
    vi.setSystemTime(APRIL);
    await renew(o);
    const res = await advance(o, pf.id, "2030-04-02", { route: "igst" });
    expect(res.status, await res.clone().text()).toBe(201);
    const b = await json(res);
    const row = await taxOf(b.id);
    expect(row?.export_mode).toBe("igst_paid");
    expect(row?.igst_minor).toBeGreaterThan(0);
    // 50,000 inclusive at 18 %: the IGST is 18/118 of the total, to the paisa
    expect(row?.igst_minor).toBe(Math.round((50_000 * 18) / 118));
    const check = await sealCheck(b.id, {
      export: {
        mode: "igst_paid",
        endorsement: ENDORSEMENT.igst_paid,
        lut: null,
        countryCode: "US",
        countryName: "United States",
        declarationRef: null,
      },
      advance: {
        proformaId: pf.id,
        proformaNumber: pf.number,
        proformaIssueDate: "2030-03-20",
        receivedOn: "2030-04-02",
        receiptId: b.receiptId,
        igstNoLutFy: "2030-31",
      },
    });
    expect(check).toEqual({ content: true, snapshot: true });
  });

  it("route igst while an LUT IS in place charges IGST but does not say that no LUT was in place", async () => {
    const o = await farSession();
    const pf = await issuedOverseasProforma(o);
    const res = await advance(o, pf.id, "2030-03-20", { route: "igst" });
    expect(res.status, await res.clone().text()).toBe(201);
    const b = await json(res);
    expect((await taxOf(b.id))?.export_mode).toBe("igst_paid");
    const extras = await one<{ header_extras: string }>(
      "SELECT header_extras FROM documents WHERE id = ?",
      b.id,
    );
    expect(JSON.parse(extras?.header_extras ?? "{}").advance.igstNoLutFy).toBeUndefined();
  });

  it("route lut with the LUT in place, and an omitted route, give the proforma's own route", async () => {
    const o = await farSession();
    const pf = await issuedOverseasProforma(o);
    const first = await advance(o, pf.id, "2030-03-20", { route: "lut", amountMinor: 10_000 });
    expect(first.status, await first.clone().text()).toBe(201);
    expect((await taxOf((await json(first)).id))?.export_mode).toBe("lut");
    const second = await advance(o, pf.id, "2030-03-20", { amountMinor: 10_000 });
    expect(second.status, await second.clone().text()).toBe(201);
    expect((await taxOf((await json(second)).id))?.export_mode).toBe("lut");
  });

  it("an IGST proforma cannot be paid on the LUT route (400), and a domestic client takes no route (400)", async () => {
    const o = await farSession();
    const pf = await issuedOverseasProforma(o, "igst_paid");
    const before = await snapshot(pf.id);
    const res = await advance(o, pf.id, "2030-03-20", { route: "lut" });
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("bad_request");
    expect(await snapshot(pf.id)).toEqual(before);
    const dom = await mkProforma(o, { client: mkInvoiceClient });
    expect((await issueInvoice(o, dom.id)).status).toBe(200);
    const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", dom.id);
    const refused = await call(`/invoices/${dom.id}/advance-invoice`, {
      cookie: o.cookie,
      body: {
        expectedProformaUpdatedAt: row?.updated_at,
        amountMinor: 59_000,
        receivedOn: "2030-03-20",
        reference: "UTR DOM ROUTE",
        route: "igst",
      },
    });
    expect(refused.status).toBe(400);
    expect(await codeOf(refused)).toBe("bad_request");
  });

  it("the freeze WHERE holds the rule in SQL: a LUT that disappears from the stored setting (no version change) between the read and the batch refuses it, and nothing is written", async () => {
    const o = await farSession();
    const pf = await issuedOverseasProforma(o);
    const before = await snapshot(pf.id);
    const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", pf.id);
    const res = await call(
      `/invoices/${pf.id}/advance-invoice`,
      {
        cookie: o.cookie,
        body: {
          expectedProformaUpdatedAt: row?.updated_at,
          amountMinor: 50_000,
          receivedOn: "2030-03-20",
          reference: "UTR RACE",
          ...usd("2030-03-20"),
        },
      },
      beforeBatchHolding("issue_guard", async () => {
        // the stored value loses its letters but the version is NOT bumped: only the SQL LUT clause can refuse this
        await env.DB.prepare(
          "UPDATE settings SET value = json_set(value, '$.luts', json('[]')) WHERE key = 'tax'",
        ).run();
      }),
    );
    expect(res.status, await res.clone().text()).toBe(409);
    expect(await snapshot(pf.id)).toEqual(before);
  });
});
