// M5.2 over the API [ADM-INV-01, -06, -08, -10, -18, ADM-SET-02, -03; LD22-LD36; VERIFY WITH CA/LEGAL for every rule]: the export invoice and the proforma issue; the
// mandatory-field checklist and every blocker a route can reach; the exchange rate; the letters of undertaking and the FY of issue; the INR export
// confirmation; the sealed header (the endorsement and the notice are literals here); the service date; the purpose code; the view the screens read.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkDoc } from "./test-clients.ts";
import { call, one, sessionFor } from "./test-helpers.ts";
import {
  currentFy,
  deactivateBank,
  ENDORSEMENT,
  frozenBlocks,
  LUT_ARN,
  lutOf,
  mkExportDraft,
  mkProforma,
  PROFORMA_NOTICE_LITERAL,
  patchFields,
  putOldTax,
  putSwiftBank,
  putTax,
  renew,
  sealCheck,
  sealCheckWith,
  setFx,
  todayIso,
  typesRow,
} from "./test-invoice-types.ts";
import {
  auditCount,
  codeOf,
  decideApproval,
  farSession,
  getInvoice,
  invoiceCounter,
  issueInvoice,
  type J,
  json,
  mkInvoice,
  mkInvoiceClient,
  mkOverseasClient,
  mkReadyMilestone,
  patchInvoice,
  putBank,
  putCompany,
  requestIssue,
  voidInvoice,
} from "./test-invoices.ts";
import { beforeBatchHolding } from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
});
afterEach(() => vi.useRealTimers());

const blockersOf = async (res: Response) => ((await json(res)).blockers ?? []) as J[];

/** An export draft with its rate typed: ready to issue under LUT. */
async function readyExport(s: Awaited<ReturnType<typeof owner>>) {
  const made = await mkExportDraft(s);
  expect((await setFx(s, made.id)).status).toBe(200);
  return made;
}

// ---- issuing an export invoice --------------------------------------------------------------------------------------------------------------------

describe("an export invoice issues [ADM-INV-01, ADM-INV-08, ADM-INV-18, G-8]", () => {
  it("is blocked without the exchange rate (fx_missing with the day), and issues once the rate is typed: its own series, the rate columns, the INR figures", async () => {
    const o = await owner();
    const made = await mkExportDraft(o);
    const blocked = await issueInvoice(o, made.id);
    expect(blocked.status).toBe(409);
    expect(await blockersOf(blocked)).toEqual([{ code: "fx_missing", date: todayIso() }]);
    expect(await typesRow(made.id)).toMatchObject({ status: "draft", number_display: null });

    expect((await setFx(o, made.id)).status).toBe(200);
    const res = await issueInvoice(o, made.id);
    expect(res.status, await res.clone().text()).toBe(200);
    const b = await json(res);
    expect(b.number).toMatch(/^TH\/EXP\/\d{4}\/\d{4}$/);
    const row = await typesRow(made.id);
    expect(row).toMatchObject({
      type: "export_invoice",
      status: "issued",
      series: "export",
      fx_rate_micros: 83_123_400,
      fx_date: todayIso(),
      fx_source: "FBIL reference rate",
      balance_minor: row?.total_minor,
    });
    // the INR view the engine made at the typed rate (the document is under LUT: no IGST, so the INR total is the value at that rate)
    expect(Number(row?.total_inr_minor)).toBeGreaterThan(0);
    const view = await getInvoice(o, made.id);
    expect(view.fx.inr.totalMinor).toBe(row?.total_inr_minor);
    expect(view.fx.value).toEqual({
      rate: "83.1234",
      rateMicros: 83_123_400,
      date: todayIso(),
      source: "FBIL reference rate",
    });
  });

  it("the frozen header carries the LUT endorsement word for word, the LUT of the FY, the country and the rate: the seal verifies with those literals and with nothing else", async () => {
    const o = await owner();
    const made = await readyExport(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const header = {
      mode: "lut" as const,
      endorsement: ENDORSEMENT.lut,
      lut: { fy: currentFy(), arn: LUT_ARN },
      countryCode: "US",
      countryName: "United States",
      declarationRef: null,
    };
    expect(await sealCheck(made.id, { export: header })).toEqual({ content: true, snapshot: true });
    // one character of the endorsement, the ARN, the country, the route: each is sealed
    for (const changed of [
      { ...header, endorsement: ENDORSEMENT.lut.replace("UNDER BOND", "UNDER BOND.") },
      { ...header, endorsement: ENDORSEMENT.igst_paid },
      { ...header, lut: { fy: currentFy(), arn: `${LUT_ARN}X` } },
      { ...header, countryName: "USA" },
      { ...header, mode: "igst_paid" as const },
    ])
      expect((await sealCheckWith(made.id, { export: changed }))?.snapshot).toBe(false);
    // a header with no export part at all is not the seal either
    expect((await sealCheckWith(made.id, {}))?.snapshot).toBe(false);
  });

  it("the IGST route needs no LUT and seals the IGST endorsement; the LUT in the header is then null", async () => {
    await putTax({ luts: [] });
    const o = await owner();
    const made = await readyExport(o);
    // under LUT (the settings' route) it is blocked: no letter for this FY
    const blocked = await issueInvoice(o, made.id);
    expect(await blockersOf(blocked)).toEqual([{ code: "lut_missing", fy: currentFy() }]);
    expect((await patchFields(o, made.id, { exportMode: "igst_paid" })).status).toBe(200);
    const res = await issueInvoice(o, made.id);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await typesRow(made.id)).toMatchObject({ export_mode: "igst_paid" });
    const header = {
      mode: "igst_paid" as const,
      endorsement: ENDORSEMENT.igst_paid,
      lut: null,
      countryCode: "US",
      countryName: "United States",
      declarationRef: null,
    };
    expect(await sealCheck(made.id, { export: header })).toEqual({ content: true, snapshot: true });
    expect(
      (await sealCheckWith(made.id, { export: { ...header, endorsement: ENDORSEMENT.lut } }))?.snapshot,
    ).toBe(false);
  });

  it("an M5.1 domestic tax invoice keeps its seal: no new header key, so it verifies with no extras", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    expect(await sealCheck(made.id)).toEqual({ content: true, snapshot: true });
    const { issuer } = await frozenBlocks(made.id);
    expect(Object.keys(issuer.bank)).toEqual(["inr"]); // an INR document has no `swift` key
  });

  it("an INR tax invoice never needs a rate, a country or a LUT (the new blockers do not touch it)", async () => {
    await putTax({ luts: [] });
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
  });
});

// ---- the letters of undertaking ------------------------------------------------------------------------------------------------------------------

describe("the LUT of the FY of issue [ADM-INV-18, G-8, docs/09: LUT without an ARN is blocked]", () => {
  it("no letter: 409 lut_missing with the FY; only last year's letter does not cover this year; a saved letter issues and is sealed", async () => {
    await putTax({ luts: [] });
    const o = await owner();
    const made = await readyExport(o);
    const none = await issueInvoice(o, made.id);
    expect(none.status).toBe(409);
    expect(await blockersOf(none)).toEqual([{ code: "lut_missing", fy: currentFy() }]);
    await putTax({ luts: [lutOf("2526")] });
    expect(await blockersOf(await issueInvoice(o, made.id))).toEqual([
      { code: "lut_missing", fy: currentFy() },
    ]);
    await putTax({ luts: [lutOf("2526"), lutOf(currentFy(), "AD0000000000077")] });
    const ok = await issueInvoice(o, made.id);
    expect(ok.status, await ok.clone().text()).toBe(200);
    const check = await sealCheck(made.id, {
      export: {
        mode: "lut",
        endorsement: ENDORSEMENT.lut,
        lut: { fy: currentFy(), arn: "AD0000000000077" },
        countryCode: "US",
        countryName: "United States",
        declarationRef: null,
      },
    });
    expect(check).toEqual({ content: true, snapshot: true });
  });

  it("a stored pre-M5.2 row with the single legacy `lut` reads as a list entry (a saved letter never vanishes)", async () => {
    await putOldTax({ arn: LUT_ARN, fy: currentFy() });
    const o = await owner();
    const made = await readyExport(o);
    const res = await issueInvoice(o, made.id);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(
      await sealCheck(made.id, {
        export: {
          mode: "lut",
          endorsement: ENDORSEMENT.lut,
          lut: { fy: currentFy(), arn: LUT_ARN },
          countryCode: "US",
          countryName: "United States",
          declarationRef: null,
        },
      }),
    ).toEqual({ content: true, snapshot: true });
    // and a legacy row with no letter at all is "none"
    await putOldTax({ arn: null, fy: null });
    const again = await readyExport(o);
    expect(await blockersOf(await issueInvoice(o, again.id))).toEqual([
      { code: "lut_missing", fy: currentFy() },
    ]);
  });

  it("the letter removed between the read and the batch: 409 settings_changed and nothing is written", async () => {
    const o = await owner();
    const made = await readyExport(o);
    const counter = await invoiceCounter();
    const audits = await auditCount("invoice.issue");
    const res = await call(
      `/invoices/${made.id}/issue`,
      { cookie: o.cookie, body: { ...(await bodyFor(made.id)) } },
      beforeBatchHolding("issue_guard", async () => {
        await putTax({ luts: [] });
      }),
    );
    expect(res.status, await res.clone().text()).toBe(409);
    expect(await codeOf(res)).toBe("settings_changed");
    expect(await typesRow(made.id)).toMatchObject({ status: "draft", number_display: null });
    expect(await invoiceCounter()).toBe(counter);
    expect(await auditCount("invoice.issue")).toBe(audits);
  });

  it("drafted on 31 March and issued at 00:00 IST on 1 April, an export under LUT needs the NEW year's letter; the rate is judged on the issue day", async () => {
    const o = await farSession();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2027, 2, 31, 12, 0, 0, 0) }); // 31 March 2027, 17:30 IST
    await putTax({ luts: [lutOf("2627")] });
    const made = await mkExportDraft(o);
    expect((await setFx(o, made.id, { date: "2027-03-31" })).status).toBe(200);
    vi.setSystemTime(Date.UTC(2027, 2, 31, 18, 30, 0, 0)); // 1 April 2027, 00:00:00.000 IST
    await renew(o);
    const blocked = await issueInvoice(o, made.id);
    expect(blocked.status).toBe(409);
    expect(await blockersOf(blocked)).toEqual([{ code: "lut_missing", fy: "2728" }]);
    await putTax({ luts: [lutOf("2627"), lutOf("2728", "AD0000000000028")] });
    const ok = await issueInvoice(o, made.id);
    expect(ok.status, await ok.clone().text()).toBe(200);
    const b = await json(ok);
    expect(b.number).toMatch(/^TH\/EXP\/2728\/\d{4}$/);
    expect(await typesRow(made.id)).toMatchObject({ issue_date: "2027-04-01", fy: "2728" });
    expect(
      await sealCheck(made.id, {
        export: {
          mode: "lut",
          endorsement: ENDORSEMENT.lut,
          lut: { fy: "2728", arn: "AD0000000000028" },
          countryCode: "US",
          countryName: "United States",
          declarationRef: null,
        },
      }),
    ).toEqual({ content: true, snapshot: true });
  });
});

/** The issue body of what is stored now. */
async function bodyFor(id: string) {
  const row = await one<{ updated_at: number; content_sha256: string }>(
    "SELECT updated_at, content_sha256 FROM documents WHERE id = ?",
    id,
  );
  return { expectedUpdatedAt: row?.updated_at, expectedContentSha256: row?.content_sha256 };
}

// ---- the exchange rate ---------------------------------------------------------------------------------------------------------------------------

describe("the exchange rate [ADM-INV-08, Q7, Q24, LD24]", () => {
  it("'83.1234' is stored as 83,123,400 micros; the source is printed as its label, or the person's own words for Other", async () => {
    const o = await owner();
    const made = await mkExportDraft(o);
    expect((await setFx(o, made.id, { source: "RBI" })).status).toBe(200);
    expect(await typesRow(made.id)).toMatchObject({
      fx_rate_micros: 83_123_400,
      fx_source: "RBI reference rate",
    });
    expect((await setFx(o, made.id, { source: "OTHER", sourceNote: "  Bank rate of the day " })).status).toBe(
      200,
    );
    expect(await typesRow(made.id)).toMatchObject({ fx_source: "Bank rate of the day" });
    // Other without words, or with too many, is refused
    expect((await setFx(o, made.id, { source: "OTHER" })).status).toBe(400);
    expect((await setFx(o, made.id, { source: "OTHER", sourceNote: "x".repeat(61) })).status).toBe(400);
    // it can be cleared
    const doc = await getInvoice(o, made.id);
    expect(
      (await patchInvoice(o, made.id, { expectedUpdatedAt: doc.updatedAt, fields: { fx: null } })).status,
    ).toBe(200);
    expect(await typesRow(made.id)).toMatchObject({ fx_rate_micros: null, fx_date: null, fx_source: null });
  });

  it("five decimals, zero, a negative, text and an exponent are 400; a rate on an INR document is 400 fx_not_applicable", async () => {
    const o = await owner();
    const made = await mkExportDraft(o);
    for (const rate of ["83.12345", "0", "0.0000", "-83", "abc", "1e2", "83,5", "", "1000.0001"])
      expect((await setFx(o, made.id, { rate })).status, rate).toBe(400);
    const inr = await mkInvoice(o);
    const res = await setFx(o, inr.id);
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("fx_not_applicable");
    // and not on a proforma either (a proforma has no rate, LD28)
    const pf = await mkProforma(o, { client: mkOverseasClient });
    const r2 = await setFx(o, pf.id);
    expect(r2.status).toBe(400);
    expect(await codeOf(r2)).toBe("fx_not_applicable");
  });

  it("the rate's day: today and up to four days before are accepted; tomorrow and five days ago are fx_date_invalid (carrying the day it was judged against)", async () => {
    const o = await owner();
    const made = await mkExportDraft(o);
    const day = (n: number) =>
      new Date(Date.parse(`${todayIso()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    for (const date of [day(1), day(-5)]) {
      expect((await setFx(o, made.id, { date })).status).toBe(200);
      const res = await issueInvoice(o, made.id);
      expect(res.status, date).toBe(409);
      expect(await blockersOf(res), date).toEqual([{ code: "fx_date_invalid", date: todayIso() }]);
    }
    // four days before is the oldest rate accepted (Q24)
    expect((await setFx(o, made.id, { date: day(-4) })).status).toBe(200);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const today = await mkExportDraft(o);
    expect((await setFx(o, today.id, { date: day(0) })).status).toBe(200);
    expect((await issueInvoice(o, today.id)).status).toBe(200);
  });

  it("the age allowed is a setting: with 0 days only the issue day counts", async () => {
    await putTax({ luts: [lutOf(currentFy())], fxMaxAgeDays: 0 });
    const o = await owner();
    const made = await mkExportDraft(o);
    const yesterday = new Date(Date.parse(`${todayIso()}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    expect((await setFx(o, made.id, { date: yesterday })).status).toBe(200);
    expect(await blockersOf(await issueInvoice(o, made.id))).toEqual([
      { code: "fx_date_invalid", date: todayIso() },
    ]);
    expect((await setFx(o, made.id)).status).toBe(200);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
  });

  it("a domestic tax invoice for a USD client needs the rate too", async () => {
    const o = await owner();
    const c = await mkInvoiceClient({ currency: "USD" });
    const made = await mkInvoice(o, { clientId: c.clientId, contactId: c.contactId });
    expect(await blockersOf(await issueInvoice(o, made.id))).toEqual([
      { code: "fx_missing", date: todayIso() },
    ]);
    expect((await setFx(o, made.id)).status).toBe(200);
    const res = await issueInvoice(o, made.id);
    expect(res.status, await res.clone().text()).toBe(200);
    const { issuer } = await frozenBlocks(made.id);
    expect(issuer.bank.swift).toMatchObject({ swift: "SAMPINBBXXX", purposeCode: "P0802" });
  });

  it("the hash and the seal cover the rate: another rate is another content hash; the issued document's rate is what its seal holds", async () => {
    const o = await owner();
    const made = await mkExportDraft(o);
    expect((await setFx(o, made.id)).status).toBe(200);
    const a = (await getInvoice(o, made.id)).contentSha256 as string;
    expect((await setFx(o, made.id, { rate: "83.1235" })).status).toBe(200);
    const b = (await getInvoice(o, made.id)).contentSha256 as string;
    expect(b).not.toBe(a);
    for (const change of [
      { date: new Date(Date.parse(`${todayIso()}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) },
      { source: "RBI" as const },
    ]) {
      expect((await setFx(o, made.id, { rate: "83.1235", ...change })).status).toBe(200);
      expect((await getInvoice(o, made.id)).contentSha256).not.toBe(b);
    }
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    expect(await sealCheck(made.id, headerOfLut())).toEqual({ content: true, snapshot: true });
  });

  it("changing the rate after a Staff member asked to issue ends the request (the content changed)", async () => {
    const staff = await sessionFor("staff", { stepUp: true });
    const made = await mkExportDraft(staff);
    expect((await setFx(staff, made.id)).status).toBe(200);
    const asked = await requestIssue(staff, made.id);
    expect(asked.status, await asked.clone().text()).toBe(201);
    expect((await getInvoice(staff, made.id)).issue.approval.state).toBe("pending");
    expect((await setFx(staff, made.id, { rate: "84" })).status).toBe(200);
    expect((await getInvoice(staff, made.id)).issue.approval.state).toBe("expired");
  });
});

const headerOfLut = () => ({
  export: {
    mode: "lut" as const,
    endorsement: ENDORSEMENT.lut,
    lut: { fy: currentFy(), arn: LUT_ARN },
    countryCode: "US",
    countryName: "United States",
    declarationRef: null,
  },
});

// ---- the INR export confirmation (Q8) ------------------------------------------------------------------------------------------------------------

describe("an export invoice in INR needs the Owner's yes [Q8; VERIFY WITH CA/LEGAL, s.2(6) IGST Act]", () => {
  const mkInrExportClient = () =>
    mkInvoiceClient({
      country: "US",
      gst_status: "overseas",
      state_code: null,
      currency: "INR",
      billing_address: JSON.stringify({ line1: "1 Main St", city: "Austin", country: "US" }),
    });

  it("without it 409 export_currency_confirm and nothing is written; with it 200, and the audit row records the confirmation", async () => {
    const o = await owner();
    const made = await mkInvoice(o, { client: mkInrExportClient });
    expect((await getInvoice(o, made.id)).needsInrConfirm).toBe(true);
    const counter = await invoiceCounter();
    const refused = await issueInvoice(o, made.id);
    expect(refused.status).toBe(409);
    expect(await codeOf(refused)).toBe("export_currency_confirm");
    expect(await typesRow(made.id)).toMatchObject({ status: "draft" });
    expect(await auditCount("invoice.issue", made.id)).toBe(0);
    expect(await invoiceCounter()).toBe(counter);
    // `false` and other values are not a confirmation: the body only takes `true`
    expect(
      (await issueInvoice(o, made.id, { ...(await bodyFor(made.id)), confirmInrExport: false })).status,
    ).toBe(400);
    const ok = await issueInvoice(o, made.id, { ...(await bodyFor(made.id)), confirmInrExport: true });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await typesRow(made.id)).toMatchObject({ type: "export_invoice", status: "issued" });
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'invoice.issue' AND entity_id = ?",
      made.id,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({ inrExportConfirmed: true });
  });

  it("an ordinary issue records no such flag", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'invoice.issue' AND entity_id = ?",
      made.id,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).not.toHaveProperty("inrExportConfirmed");
  });

  it("the same rule on approval: the approver must confirm too", async () => {
    const staff = await sessionFor("staff", { stepUp: true });
    const o = await owner();
    const made = await mkInvoice(staff, { client: mkInrExportClient });
    const asked = await requestIssue(staff, made.id);
    expect(asked.status, await asked.clone().text()).toBe(201);
    const approvalId = (await json(asked)).id as string;
    const refused = await decideApproval(o, approvalId, "approve");
    expect(refused.status).toBe(409);
    expect(await codeOf(refused)).toBe("export_currency_confirm");
    expect(await typesRow(made.id)).toMatchObject({ status: "draft" });
    expect(
      (await one<{ status: string }>("SELECT status FROM approvals WHERE id = ?", approvalId))?.status,
    ).toBe("pending");
    const ok = await call(`/approvals/${approvalId}/decide`, {
      cookie: o.cookie,
      body: { decision: "approve", confirmInrExport: true },
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await typesRow(made.id)).toMatchObject({ status: "issued" });
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'invoice.issue' AND entity_id = ?",
      made.id,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({ inrExportConfirmed: true });
  });
});

// ---- the checklist: every blocker a route can reach -----------------------------------------------------------------------------------------------

describe("the mandatory-field checklist over the API [ADM-INV-06, Q10, docs/09: a missing-field block per field]", () => {
  it("country_missing: an overseas client whose country is not an assigned code", async () => {
    const o = await owner();
    const made = await mkExportDraft(o, {
      client: () =>
        mkInvoiceClient({ country: "XX", gst_status: "overseas", state_code: null, currency: "USD" }),
    });
    expect((await setFx(o, made.id)).status).toBe(200);
    // (the engine cannot place such a client either, so `computed_errors` rides with it)
    expect((await blockersOf(await issueInvoice(o, made.id))).map((b) => b.code)).toContain(
      "country_missing",
    );
  });

  it("bank_missing and swift_missing; the switch (bankDetails off) silences both; the locked lines cannot be silenced", async () => {
    const o = await owner();
    const inr = await mkInvoice(o);
    const usd = await readyExport(o);
    await deactivateBank("INR");
    await deactivateBank("USD_SWIFT");
    expect((await blockersOf(await issueInvoice(o, inr.id))).map((b) => b.code)).toEqual(["bank_missing"]);
    expect((await blockersOf(await issueInvoice(o, usd.id))).map((b) => b.code)).toEqual(["swift_missing"]);
    const view = await getInvoice(o, inr.id);
    expect(view.blockers.map((b: J) => b.code)).toEqual(["bank_missing"]);
    // the Owner switches the bank line off: both issue (the INR invoice has no bank block, the export has a null SWIFT block)
    await putTax({
      luts: [lutOf(currentFy())],
      invoiceChecklist: { bankDetails: false, paymentLink: false },
    });
    expect((await issueInvoice(o, inr.id)).status).toBe(200);
    expect((await issueInvoice(o, usd.id)).status).toBe(200);
    const { issuer } = await frozenBlocks(usd.id);
    expect(issuer.bank.inr).toBeNull();
    expect(issuer.bank.swift).toBeNull();
  });

  it("a locked line stays on whatever is stored: with the bank line off an invoice with no lines is still blocked", async () => {
    await putTax({
      luts: [lutOf(currentFy())],
      invoiceChecklist: { bankDetails: false, paymentLink: false },
    });
    const o = await owner();
    const c = await mkInvoiceClient();
    const empty = (await json(await call("/invoices", { cookie: o.cookie, body: { clientId: c.clientId } })))
      .id as string;
    expect((await blockersOf(await issueInvoice(o, empty))).map((b) => b.code)).toContain("no_lines");
  });

  it("unregistered_high_value: an unregistered client at ₹50,000 or more (the total including GST) with a missing address; below it the new line is not raised", async () => {
    const o = await owner();
    const noAddress = () => mkInvoiceClient({ billing_address: null });
    const big = await mkInvoice(o, { client: noAddress, price: 6_000_000 }); // ₹60,000 + GST
    const codes = (await blockersOf(await issueInvoice(o, big.id))).map((b) => b.code);
    expect(codes).toContain("unregistered_high_value");
    expect(codes).toContain("recipient_address");
    const small = await mkInvoice(o, { client: noAddress, price: 1_000_000 }); // ₹10,000 + GST
    const codes2 = (await blockersOf(await issueInvoice(o, small.id))).map((b) => b.code);
    expect(codes2).not.toContain("unregistered_high_value");
    expect(codes2).toContain("recipient_address");
    // the threshold is a setting, and it compares the total including GST: ₹50,000 of value is ₹59,000 with GST
    const edge = await mkInvoice(o, { client: noAddress, price: 5_000_000 });
    expect((await blockersOf(await issueInvoice(o, edge.id))).map((b) => b.code)).toContain(
      "unregistered_high_value",
    );
  });

  it("the checklist and the blockers are in the view: every line with on, locked, available, applies and its codes; fy and date ride on the blockers", async () => {
    await putTax({ luts: [] });
    const o = await owner();
    const made = await mkExportDraft(o);
    const view = await getInvoice(o, made.id);
    expect(view.checklist.items).toHaveLength(18);
    expect(view.checklist.settings).toEqual({ bankDetails: true, paymentLink: false });
    expect(view.checklist.switchable).toEqual(["bankDetails"]);
    const item = (id: string) => view.checklist.items.find((i: J) => i.id === id);
    expect(item("bankDetails")).toMatchObject({ locked: false, available: true, on: true, applies: true });
    expect(item("paymentLink")).toMatchObject({ locked: false, available: false, on: false });
    expect(item("exportDeclaration")).toMatchObject({ locked: true, on: true, applies: true });
    expect(item("unregisteredHighValue")).toMatchObject({ applies: false });
    expect(view.blockers).toEqual(
      expect.arrayContaining([
        { code: "fx_missing", date: todayIso() },
        { code: "lut_missing", fy: currentFy() },
      ]),
    );
    expect(view.export).toMatchObject({
      mode: "lut",
      lutRequired: true,
      lut: null,
      endorsement: ENDORSEMENT.lut,
      countryCode: "US",
      countryName: "United States",
    });
    expect(view.fx).toMatchObject({ applies: true, value: null, refDate: todayIso(), maxAgeDays: 4 });
    expect(view.lutStatus).toMatchObject({ currentFy: currentFy(), currentMissing: true });
    expect(view.needsInrConfirm).toBe(false);
    expect(view.serviceCompletedOn).toBeNull();
    // a domestic invoice has no export or proforma block
    const tax = await mkInvoice(o);
    const tview = await getInvoice(o, tax.id);
    expect(tview.export).toBeNull();
    expect(tview.proforma).toBeNull();
    expect(tview.fx.applies).toBe(false);
  });

  it("a locked line is refused in a Settings save, the payment link cannot be turned on, and a stored pre-M5.2 row resolves", async () => {
    const o = await owner();
    const get = async () => json(await call("/settings/groups/tax", { cookie: o.cookie }));
    await putOldTax({ arn: null, fy: null });
    const before = await get();
    expect(before.value.luts).toEqual([]);
    expect(before.value.invoiceChecklist).toEqual({ bankDetails: true, paymentLink: false });
    expect(before.value.fxMaxAgeDays).toBe(4);
    const put = (value: unknown) =>
      call("/settings/groups/tax", {
        method: "PUT",
        cookie: o.cookie,
        body: { version: before.version, value },
      });
    const bad = async (invoiceChecklist: unknown) => {
      const res = await put({ ...before.value, invoiceChecklist });
      expect(res.status, JSON.stringify(invoiceChecklist)).toBe(400);
    };
    await bad({ bankDetails: true, paymentLink: true });
    await bad({ bankDetails: true, paymentLink: false, companyNames: false });
    await bad({ bankDetails: true, paymentLink: false, reverseCharge: false });
    await bad({ paymentLink: false });
    const ok = await put({ ...before.value, invoiceChecklist: { bankDetails: false, paymentLink: false } });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect((await get()).value.invoiceChecklist).toEqual({ bankDetails: false, paymentLink: false });
  });

  it("the letters in Settings: one per year (the message names the row), a bad ARN or year is refused, the legacy `lut` still saves, and the list is read back", async () => {
    const o = await owner();
    await putTax({ luts: [] });
    const cur = await json(await call("/settings/groups/tax", { cookie: o.cookie }));
    const put = (value: unknown, version = cur.version) =>
      call("/settings/groups/tax", { method: "PUT", cookie: o.cookie, body: { version, value } });
    const dup = await put({ ...cur.value, luts: [lutOf("2627"), lutOf("2627", "AD0000000000002")] });
    expect(dup.status).toBe(400);
    expect((await json(dup)).fields).toEqual([
      { path: "luts.1.fy", message: "This year already has an LUT." },
    ]);
    for (const l of [
      { fy: "2628", arn: "A1", filedOn: null },
      { fy: "2627", arn: "", filedOn: null },
      { fy: "2627", arn: "A-1", filedOn: null },
      { fy: "2627", arn: "A1", filedOn: "2026-02-30" },
    ])
      expect((await put({ ...cur.value, luts: [l] })).status, JSON.stringify(l)).toBe(400);
    const ok = await put({
      ...cur.value,
      luts: [{ fy: "2627", arn: " ad 0000 0000 00001", filedOn: "2026-03-20" }],
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const back = await json(await call("/settings/groups/tax", { cookie: o.cookie }));
    expect(back.value.luts).toEqual([{ fy: "2627", arn: "AD0000000000001", filedOn: "2026-03-20" }]);
    // the current screen still saves the single letter (it spreads the value it read and sets `lut`)
    const legacy = await put({ ...back.value, lut: { arn: "OLDARN1", fy: "2526" } }, back.version);
    expect(legacy.status, await legacy.clone().text()).toBe(200);
  });

  it("the banner data is derived and unstored: from 1 March the next FY's missing letter is due; from 1 April the running FY's is missing until saved", async () => {
    const o = await farSession();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2027, 1, 28, 6, 0, 0) });
    await putTax({ luts: [lutOf("2627")] });
    const at = async () => {
      await renew(o);
      const res = await call("/settings/groups/tax", { cookie: o.cookie });
      return (await json(res)).meta.lutStatus;
    };
    expect(await at()).toMatchObject({
      due: false,
      nextFy: "2728",
      nextFyLabel: "2027-28",
      currentMissing: false,
    });
    vi.setSystemTime(Date.UTC(2027, 2, 1, 6, 0, 0)); // 1 March
    expect(await at()).toMatchObject({ due: true, nextFy: "2728" });
    vi.setSystemTime(Date.UTC(2027, 3, 1, 6, 0, 0)); // 1 April: the new year has no letter yet
    expect(await at()).toMatchObject({ due: false, currentFy: "2728", currentMissing: true });
    await putTax({ luts: [lutOf("2627"), lutOf("2728")] });
    expect(await at()).toMatchObject({ currentMissing: false });
    // the overview's attention line follows the running FY's letter
    await putTax({ luts: [] });
    await renew(o);
    const groups = (await json(await call("/settings", { cookie: o.cookie }))).groups as J[];
    expect(groups.find((g) => g.group === "tax")?.attention).toEqual(["LUT ARN missing"]);
  });
});

// ---- the proforma ---------------------------------------------------------------------------------------------------------------------------------

describe("a proforma [ADM-INV-01, ADM-INV-10, LD28, G-6]", () => {
  it("any client may have one: a domestic one and an overseas one are drafts of type proforma; a service date or a rate is refused on it", async () => {
    const o = await owner();
    const dom = await mkProforma(o);
    const ovs = await mkProforma(o, { client: mkOverseasClient });
    expect((await typesRow(dom.id))?.type).toBe("proforma");
    expect((await typesRow(ovs.id))?.type).toBe("proforma");
    const r = await patchFields(o, dom.id, { serviceCompletedOn: "2026-10-01" });
    expect(r.status).toBe(400);
    expect(await codeOf(r)).toBe("service_date_not_applicable");
    const m = await patchFields(o, dom.id, { exportMode: "lut" });
    expect(m.status).toBe(400);
    expect(await codeOf(m)).toBe("export_mode_not_applicable");
    // an overseas proforma may carry the route (it decides the advance invoice's)
    expect((await patchFields(o, ovs.id, { exportMode: "igst_paid" })).status).toBe(200);
  });

  it("issues as TH/PI in its own series with its notice sealed, a valid-until equal to its due date, the balance at the total; no rate, no LUT, no country needed", async () => {
    await putTax({ luts: [] });
    const o = await owner();
    const counter = await invoiceCounter();
    const made = await mkProforma(o, { client: mkOverseasClient });
    const res = await issueInvoice(o, made.id);
    expect(res.status, await res.clone().text()).toBe(200);
    const b = await json(res);
    expect(b.number).toMatch(/^TH\/PI\/\d{4}\/\d{4}$/);
    const row = await typesRow(made.id);
    expect(row).toMatchObject({
      type: "proforma",
      status: "issued",
      series: "proforma",
      valid_until: row?.due_date,
      paid_minor: 0,
      balance_minor: row?.total_minor,
    });
    expect(await invoiceCounter()).toBe(counter); // the INV counter did not move
    expect(await sealCheck(made.id, { proforma: { notice: PROFORMA_NOTICE_LITERAL } })).toEqual({
      content: true,
      snapshot: true,
    });
    expect(
      (await sealCheckWith(made.id, { proforma: { notice: `${PROFORMA_NOTICE_LITERAL}.` } }))?.snapshot,
    ).toBe(false);
    expect((await sealCheckWith(made.id, {}))?.snapshot).toBe(false);
    // the SWIFT block of its (USD) bank details is frozen with it, and no LUT or rate exists on it
    const { issuer } = await frozenBlocks(made.id);
    expect(issuer.bank.swift).toMatchObject({ purposeCode: "P0802" });
    expect(row).toMatchObject({ fx_rate_micros: null, export_mode: null });
  });

  it("its milestone is NOT moved at issue (the work is unbilled until a tax invoice exists); a void frees the link and leaves the status", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const m = await mkReadyMilestone(c.clientId, 11_800_00, { delivered_at: 4242 });
    const made = await mkProforma(o, { clientId: c.clientId, milestoneId: m.id });
    expect(await one("SELECT document_id, status FROM milestones WHERE id = ?", m.id)).toEqual({
      document_id: made.id,
      status: "ready_to_bill",
    });
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    expect(await one("SELECT status, delivered_at, document_id FROM milestones WHERE id = ?", m.id)).toEqual({
      status: "ready_to_bill",
      delivered_at: 4242,
      document_id: made.id,
    });
    expect((await voidInvoice(o, made.id)).status).toBe(200);
    expect(await one("SELECT status, delivered_at, document_id FROM milestones WHERE id = ?", m.id)).toEqual({
      status: "ready_to_bill",
      delivered_at: 4242,
      document_id: null,
    });
  });

  it("a proforma can be voided after its month (no Q23 rule), a tax invoice cannot", async () => {
    const o = await farSession();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2030, 5, 10, 6, 0, 0) });
    const pf = await mkProforma(o);
    const tax = await mkInvoice(o);
    expect((await issueInvoice(o, pf.id)).status).toBe(200);
    expect((await issueInvoice(o, tax.id)).status).toBe(200);
    vi.setSystemTime(Date.UTC(2030, 6, 20, 6, 0, 0)); // the next month
    await renew(o);
    const view = await getInvoice(o, pf.id);
    expect(view.void.blockers).toEqual([]);
    expect(view.void.canVoid).toBe(true);
    expect((await voidInvoice(o, pf.id)).status).toBe(200);
    const closed = await voidInvoice(o, tax.id);
    expect(closed.status).toBe(409);
    expect(await codeOf(closed)).toBe("return_period_closed");
  });

  it("its view carries the notice, what is left and the 25-day data of delivered work; the tax invoice made from it is listed in the advance tests", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const m = await mkReadyMilestone(c.clientId, 11_800_00, {
      delivered_at: Date.UTC(2026, 9, 28, 18, 0, 0),
    });
    const made = await mkProforma(o, { clientId: c.clientId, milestoneId: m.id });
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const view = await getInvoice(o, made.id);
    expect(view.proforma).toMatchObject({
      notice: PROFORMA_NOTICE_LITERAL,
      paidMinor: 0,
      balanceMinor: view.totals.totalMinor,
      canAdvance: true,
      children: [],
      warnDate: "2026-11-22",
      warnAt: Date.UTC(2026, 10, 21, 18, 30, 0),
    });
    expect(view.milestone.projectName).toBeTruthy();
    // the accountant reads it but cannot record a payment
    const acc = await sessionFor("accountant", { stepUp: true });
    expect((await getInvoice(acc, made.id)).proforma.canAdvance).toBe(false);
  });
});

// ---- the service date ----------------------------------------------------------------------------------------------------------------------------

describe("the service date [LD29, Rule 47]", () => {
  const post = (s: Awaited<ReturnType<typeof owner>>, id: string, body: unknown) =>
    call(`/invoices/${id}/service-completed`, { cookie: s.cookie, body });
  const stampOf = async (id: string) => (await typesRow(id))?.updated_at as number;

  it("is set once on an issued tax or export invoice, then 409 already_set; it is audited with the date and nothing else", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const first = await post(o, made.id, { expectedUpdatedAt: await stampOf(made.id), date: "2026-10-01" });
    expect(first.status, await first.clone().text()).toBe(200);
    expect(await typesRow(made.id)).toMatchObject({ service_completed_on: "2026-10-01" });
    expect((await getInvoice(o, made.id)).serviceCompletedOn).toBe("2026-10-01");
    const again = await post(o, made.id, { expectedUpdatedAt: await stampOf(made.id), date: "2026-10-02" });
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("already_set");
    expect(await typesRow(made.id)).toMatchObject({ service_completed_on: "2026-10-01" });
    expect(await auditCount("invoice.service_completed", made.id)).toBe(1);
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'invoice.service_completed' AND entity_id = ?",
      made.id,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toEqual({
      documentId: made.id,
      number: expect.any(String),
      type: "tax_invoice",
      date: "2026-10-01",
    });
    // the seal does not hold it: the invoice still verifies
    expect(await sealCheck(made.id)).toEqual({ content: true, snapshot: true });
    // an export invoice too
    const exp = await readyExport(o);
    expect((await issueInvoice(o, exp.id)).status).toBe(200);
    expect(
      (await post(o, exp.id, { expectedUpdatedAt: await stampOf(exp.id), date: todayIso() })).status,
    ).toBe(200);
  });

  it("not in the future (IST), not on a proforma or a quote, a stale stamp is 409, a bad date is 400, an unknown id is 404, Sales and the accountant are 403", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const tomorrow = new Date(Date.parse(`${todayIso()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const future = await post(o, made.id, { expectedUpdatedAt: await stampOf(made.id), date: tomorrow });
    expect(future.status).toBe(400);
    expect(await codeOf(future)).toBe("service_date_future");
    expect(
      (await post(o, made.id, { expectedUpdatedAt: await stampOf(made.id), date: "2026-02-30" })).status,
    ).toBe(400);
    const stale = await post(o, made.id, {
      expectedUpdatedAt: (await stampOf(made.id)) - 1,
      date: "2026-10-01",
    });
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe("stale_version");
    const pf = await mkProforma(o);
    expect((await issueInvoice(o, pf.id)).status).toBe(200);
    const notFor = await post(o, pf.id, { expectedUpdatedAt: await stampOf(pf.id), date: "2026-10-01" });
    expect(notFor.status).toBe(400);
    expect(await codeOf(notFor)).toBe("service_date_not_applicable");
    expect((await post(o, "no-such-id", { expectedUpdatedAt: 1, date: "2026-10-01" })).status).toBe(404);
    for (const role of ["sales", "accountant"] as const) {
      const s = await sessionFor(role, { stepUp: true });
      expect(
        (await post(s, made.id, { expectedUpdatedAt: await stampOf(made.id), date: "2026-10-01" })).status,
        role,
      ).toBe(403);
    }
    expect(await typesRow(made.id)).toMatchObject({ service_completed_on: null });
  });

  it("a draft can carry it (PATCH), and it does not move the content hash", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    const hash = (await getInvoice(o, made.id)).contentSha256;
    expect((await patchFields(o, made.id, { serviceCompletedOn: "2026-10-01" })).status).toBe(200);
    expect(await typesRow(made.id)).toMatchObject({ service_completed_on: "2026-10-01" });
    expect((await getInvoice(o, made.id)).contentSha256).toBe(hash);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    // once issued, the date set on the draft is the one date it will have
    const doc = await typesRow(made.id);
    const again = await post(o, made.id, { expectedUpdatedAt: doc?.updated_at, date: "2026-10-02" });
    expect(await codeOf(again)).toBe("already_set");
  });
});

// ---- the purpose code and the SWIFT block ---------------------------------------------------------------------------------------------------------

describe("the purpose code on the USD account [LD30, ADM-SET-02]", () => {
  const putBankUsd = async (s: Awaited<ReturnType<typeof owner>>, over: Record<string, unknown>) => {
    const cur = await json(await call("/settings/bank", { cookie: s.cookie }));
    const acct = (cur.accounts as J[]).find((a) => a.kind === "USD_SWIFT") as J;
    return call("/settings/bank/USD_SWIFT", {
      method: "PUT",
      cookie: s.cookie,
      body: {
        accountName: acct.accountName,
        swift: acct.swift,
        bankName: acct.bankName,
        branch: acct.branch,
        bankAddress: acct.bankAddress,
        intermediary: acct.intermediary,
        purposeCode: acct.purposeCode,
        expectedUpdatedAt: acct.updatedAt,
        ...over,
      },
    });
  };

  it("accepts P and four digits (upper-cased) or none; refuses anything else; the INR account has none", async () => {
    const o = await owner();
    const ok = await putBankUsd(o, { purposeCode: " p0807 " });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const acct = ((await json(await call("/settings/bank", { cookie: o.cookie }))).accounts as J[]).find(
      (a) => a.kind === "USD_SWIFT",
    ) as J;
    expect(acct.purposeCode).toBe("P0807");
    for (const bad of ["0802", "P080", "P08022", "PX802", "P 0802 1"]) {
      const res = await putBankUsd(o, { purposeCode: bad });
      expect(res.status, bad).toBe(400);
      expect(((await json(res)).fields as J[]).map((f) => f.path)).toEqual(["purposeCode"]);
    }
    expect((await putBankUsd(o, { purposeCode: null })).status).toBe(200);
    const inr = ((await json(await call("/settings/bank", { cookie: o.cookie }))).accounts as J[]).find(
      (a) => a.kind === "INR",
    ) as J;
    const res = await call("/settings/bank/INR", {
      method: "PUT",
      cookie: o.cookie,
      body: {
        accountName: "X",
        accountNo: "SAMPLEBANK0001",
        accountNoAgain: "SAMPLEBANK0001",
        ifsc: "SAMP0000001",
        bankName: "B",
        purposeCode: "P0802",
        expectedUpdatedAt: inr.updatedAt,
      },
    });
    expect(res.status).toBe(400);
  });

  it("a USD export invoice's frozen SWIFT block carries the purpose code (and the intermediary), exactly as saved at issue", async () => {
    await putSwiftBank({ purpose_code: "P0807", intermediary: "Intermediary Bank, New York" });
    const o = await owner();
    const made = await readyExport(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const { issuer } = await frozenBlocks(made.id);
    expect(issuer.bank.swift).toEqual({
      accountName: "TecHaust Technologies",
      accountNo: "SAMPLEUSD0001",
      swift: "SAMPINBBXXX",
      bankName: "SAMPLE BANK",
      branch: "Sample branch",
      bankAddress: "1 Sample Street, Mumbai",
      intermediary: "Intermediary Bank, New York",
      purposeCode: "P0807",
    });
    // changing the account later does not change the issued invoice (frozen), and the seal still verifies
    await putSwiftBank({ purpose_code: "P0802" });
    expect((await frozenBlocks(made.id)).issuer.bank.swift.purposeCode).toBe("P0807");
    expect(await sealCheck(made.id, headerOfLut())).toEqual({ content: true, snapshot: true });
  });
});

// ---- who and what else is frozen ------------------------------------------------------------------------------------------------------------------

describe("the address of delivery and the optional export note [LD36, LD23, Rule 46(o)]", () => {
  it("the client's service address is frozen into the recipient (and absent when the client has none)", async () => {
    const o = await owner();
    const service = { line1: "9 Site Road", city: "Pune", country: "IN" };
    const c = await mkInvoiceClient({ service_address: JSON.stringify(service) });
    const made = await mkInvoice(o, { clientId: c.clientId, contactId: c.contactId });
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    expect((await frozenBlocks(made.id)).recipient.deliveryAddress).toEqual(service);
    const plain = await mkInvoice(o);
    expect((await issueInvoice(o, plain.id)).status).toBe(200);
    expect((await frozenBlocks(plain.id)).recipient).not.toHaveProperty("deliveryAddress");
  });

  it("the extra export note is pinned at issue when it was asked for and one exists: the newest block, frozen, in the header; asking when none exists is 409", async () => {
    const o = await owner();
    const made = await readyExport(o);
    const none = await patchFields(o, made.id, { exportDeclaration: true });
    expect(none.status).toBe(409);
    expect(await codeOf(none)).toBe("export_declaration_missing");
    const v1 = "00000000-0000-7000-8000-0000000000d1";
    const v2 = "00000000-0000-7000-8000-0000000000d2";
    await env.DB.prepare(
      "INSERT INTO terms_blocks (id, kind, version, body_md, sha256) VALUES (?1, 'export_declaration', 1, 'Old note', ?2)",
    )
      .bind(v1, "1".repeat(64))
      .run();
    expect((await patchFields(o, made.id, { exportDeclaration: true })).status).toBe(200);
    expect(await typesRow(made.id)).toMatchObject({ export_declaration_id: v1 });
    // a newer version appears before issue: the note the draft pinned (the one the requester and the approver saw) is no longer the newest, so the
    // issue is refused with its own code and nothing is written (the person looks at the new text and pins it again)
    await env.DB.prepare(
      "INSERT INTO terms_blocks (id, kind, version, body_md, sha256) VALUES (?1, 'export_declaration', 2, 'New note', ?2)",
    )
      .bind(v2, "2".repeat(64))
      .run();
    const counter = await invoiceCounter();
    const changed = await issueInvoice(o, made.id);
    expect(changed.status).toBe(409);
    expect(await codeOf(changed)).toBe("export_declaration_changed");
    expect(await typesRow(made.id)).toMatchObject({ status: "draft", export_declaration_id: v1 });
    expect(await invoiceCounter()).toBe(counter);
    expect(await auditCount("invoice.issue", made.id)).toBe(0);
    // pinned again, it is the newest
    expect((await patchFields(o, made.id, { exportDeclaration: true })).status).toBe(200);
    expect(await typesRow(made.id)).toMatchObject({ export_declaration_id: v2 });
    const res = await issueInvoice(o, made.id);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await typesRow(made.id)).toMatchObject({ export_declaration_id: v2 });
    const header = {
      ...headerOfLut().export,
      declarationRef: { id: v2, version: 2, sha256: "2".repeat(64) },
    };
    expect(await sealCheck(made.id, { export: header })).toEqual({ content: true, snapshot: true });
    // never on a domestic or INR draft
    const tax = await mkInvoice(o);
    const r = await patchFields(o, tax.id, { exportDeclaration: true });
    expect(r.status).toBe(400);
    expect(await codeOf(r)).toBe("export_declaration_not_applicable");
  });

  it("changing the extra note ends a waiting issue request even though the content hash does not move", async () => {
    const staff = await sessionFor("staff", { stepUp: true });
    const id = "00000000-0000-7000-8000-0000000000d3";
    await env.DB.prepare(
      "INSERT INTO terms_blocks (id, kind, version, body_md, sha256) VALUES (?1, 'export_declaration', 3, 'Note', ?2)",
    )
      .bind(id, "3".repeat(64))
      .run();
    const made = await mkExportDraft(staff);
    expect((await setFx(staff, made.id)).status).toBe(200);
    expect((await requestIssue(staff, made.id)).status).toBe(201);
    const hash = (await getInvoice(staff, made.id)).contentSha256;
    expect((await patchFields(staff, made.id, { exportDeclaration: true })).status).toBe(200);
    const view = await getInvoice(staff, made.id);
    expect(view.contentSha256).toBe(hash);
    expect(view.issue.approval.state).toBe("expired");
  });
});

// ---- types and roles ------------------------------------------------------------------------------------------------------------------------------

describe("what stays closed", () => {
  it("a credit note and a debit note are still type_not_issuable (M5.3)", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    for (const type of ["credit_note", "debit_note"]) {
      const id = await mkDoc(c.clientId, type);
      const res = await issueInvoice(o, id, { expectedUpdatedAt: 1, expectedContentSha256: "a".repeat(64) });
      expect(res.status).toBe(409);
      expect(await codeOf(res)).toBe("type_not_issuable");
    }
  });

  it("Staff may draft a proforma and ask to issue it; only the Owner issues", async () => {
    const staff = await sessionFor("staff", { stepUp: true });
    const made = await mkProforma(staff);
    const direct = await issueInvoice(staff, made.id);
    expect(direct.status).toBe(403);
    expect(await codeOf(direct)).toBe("approval_required");
    expect((await requestIssue(staff, made.id)).status).toBe(201);
  });
});

// ---- the frozen header is the record (LD37) and the early check's fixes ------------------------------------------------------------------------------

describe("the frozen header extras [LD37]: what was sealed is what is shown, whatever Settings say afterwards", () => {
  it("a letter, a route and a country edited after issue change neither the frozen view nor the seal; the column holds the sealed keys and cannot be edited", async () => {
    const o = await owner();
    const made = await readyExport(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const sealed = {
      mode: "lut" as const,
      endorsement: ENDORSEMENT.lut,
      lut: { fy: currentFy(), arn: LUT_ARN },
      countryCode: "US",
      countryName: "United States",
      declarationRef: null,
    };
    expect((await getInvoice(o, made.id)).export).toMatchObject({
      endorsement: ENDORSEMENT.lut,
      lut: { fy: currentFy(), arn: LUT_ARN },
      countryCode: "US",
      countryName: "United States",
    });
    const stored = await one<{ header_extras: string }>(
      "SELECT header_extras FROM documents WHERE id = ?",
      made.id,
    );
    expect(JSON.parse(stored?.header_extras ?? "null")).toEqual({ export: sealed });
    // the owner changes the letter's ARN, the default route and the client's country
    await putTax({ luts: [lutOf(currentFy(), "AD0000000000099")], exportMode: "igst_paid" });
    await env.DB.prepare(
      "UPDATE clients SET country = 'DE' WHERE id = (SELECT client_id FROM documents WHERE id = ?1)",
    )
      .bind(made.id)
      .run();
    const after = await getInvoice(o, made.id);
    expect(after.export).toMatchObject({
      endorsement: ENDORSEMENT.lut,
      lut: { fy: currentFy(), arn: LUT_ARN },
      countryCode: "US",
      countryName: "United States",
    });
    expect(await sealCheck(made.id, { export: sealed })).toEqual({ content: true, snapshot: true });
    await expect(
      env.DB.prepare("UPDATE documents SET header_extras = NULL WHERE id = ?1").bind(made.id).run(),
    ).rejects.toThrow(/issued document is frozen/);
  });

  it("an M5.1-shaped tax invoice stores no extras (NULL) and keeps its seal; a proforma stores its notice only", async () => {
    const o = await owner();
    const tax = await mkInvoice(o);
    expect((await issueInvoice(o, tax.id)).status).toBe(200);
    expect(
      (
        await one<{ header_extras: string | null }>(
          "SELECT header_extras FROM documents WHERE id = ?",
          tax.id,
        )
      )?.header_extras,
    ).toBeNull();
    expect(await sealCheck(tax.id)).toEqual({ content: true, snapshot: true });
    const pf = await mkProforma(o);
    expect((await issueInvoice(o, pf.id)).status).toBe(200);
    expect(await sealCheck(pf.id, { proforma: { notice: PROFORMA_NOTICE_LITERAL } })).toEqual({
      content: true,
      snapshot: true,
    });
    expect((await getInvoice(o, pf.id)).proforma.notice).toBe(PROFORMA_NOTICE_LITERAL);
  });
});

describe("a letter deleted from the list cannot come back from the legacy key [analyst early check 3; VERIFY WITH CA/LEGAL]", () => {
  const put = (s: Awaited<ReturnType<typeof owner>>, version: number, value: unknown) =>
    call("/settings/groups/tax", { method: "PUT", cookie: s.cookie, body: { version, value } });
  const get = async (s: Awaited<ReturnType<typeof owner>>) =>
    json(await call("/settings/groups/tax", { cookie: s.cookie }));

  it("read: the old single letter is shown as a list entry and the old key is empty; deleting it from the list is final, and the issue is blocked", async () => {
    const o = await owner();
    await putOldTax({ arn: "OLDARN1", fy: currentFy() });
    const first = await get(o);
    expect(first.value.luts).toEqual([{ fy: currentFy(), arn: "OLDARN1", filedOn: null }]);
    expect(first.value.lut).toEqual({ arn: null, fy: null });
    const gone = await put(o, first.version, { ...first.value, luts: [] });
    expect(gone.status, await gone.clone().text()).toBe(200);
    const after = await get(o);
    expect(after.value.luts).toEqual([]);
    expect(after.value.lut).toEqual({ arn: null, fy: null });
    const made = await readyExport(o);
    expect(await blockersOf(await issueInvoice(o, made.id))).toEqual([
      { code: "lut_missing", fy: currentFy() },
    ]);
  });

  it("save: an old screen that still sends the single `lut` has it folded into the list (unless that year is listed) and cleared in the stored row", async () => {
    const o = await owner();
    await putTax({ luts: [lutOf("2526", "AD0000000000025")] });
    const cur = await get(o);
    const ok = await put(o, cur.version, { ...cur.value, lut: { arn: "OLDARN1", fy: currentFy() } });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const stored = JSON.parse(
      (await one<{ value: string }>("SELECT value FROM settings WHERE key = 'tax'"))?.value ?? "{}",
    );
    expect(stored.lut).toEqual({ arn: null, fy: null });
    expect(stored.luts).toEqual([
      { fy: "2526", arn: "AD0000000000025", filedOn: null },
      { fy: currentFy(), arn: "OLDARN1", filedOn: null },
    ]);
    // the same year in the list wins: the old key is dropped
    const again = await get(o);
    const win = await put(o, again.version, {
      ...again.value,
      luts: [lutOf(currentFy(), "AD0000000000077")],
      lut: { arn: "OLDARN9", fy: currentFy() },
    });
    expect(win.status, await win.clone().text()).toBe(200);
    const stored2 = JSON.parse(
      (await one<{ value: string }>("SELECT value FROM settings WHERE key = 'tax'"))?.value ?? "{}",
    );
    expect(stored2.luts).toEqual([{ fy: currentFy(), arn: "AD0000000000077", filedOn: null }]);
    expect(stored2.lut).toEqual({ arn: null, fy: null });
  });
});

describe("the service date of a void invoice [early check, optional]", () => {
  it("is 409 invoice_void (its own code), not a stale save, and nothing is written", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    expect((await voidInvoice(o, made.id)).status).toBe(200);
    const stamp = (await typesRow(made.id))?.updated_at as number;
    const res = await call(`/invoices/${made.id}/service-completed`, {
      cookie: o.cookie,
      body: { expectedUpdatedAt: stamp, date: "2026-10-01" },
    });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("invoice_void");
    expect(await typesRow(made.id)).toMatchObject({ service_completed_on: null });
  });
});
