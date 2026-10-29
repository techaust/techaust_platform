// The research round of 2026-10-28 on notes [ADM-INV-11; Researched 2026-10-28, 08-C RA-02, RA-22; owner Q35]: "Discount after sale" only for notes dated from 1 November 2026 (IST),
// and the debit note "Tax charged too low" (taxable value zero, tax only).

import { env } from "cloudflare:workers";
import {
  type DocumentBundle,
  invoiceSealOf,
  invoiceSealPartsOfBundle,
  loadDocument,
  type TermsRef,
  verifyInvoiceSealed,
} from "@techaust/db/documents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentFy, lutOf, putSwiftBank, putTax, renew, todayIso } from "./test-invoice-types.ts";
import {
  codeOf,
  farSession,
  getInvoice,
  issueInvoice,
  json,
  mkOverseasClient,
  patchInvoice,
  putBank,
  putCompany,
} from "./test-invoices.ts";
import {
  draftCredit,
  draftDebit,
  issueCredit,
  issueDebit,
  mkIssuedInvoice,
  noteRow,
  parentRow,
} from "./test-notes.ts";

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
});
afterEach(() => vi.useRealTimers());

const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
};

describe("Discount after sale: notes dated from 1 November 2026 (IST) [RA-02]", () => {
  it("a draft on 31 October 23:59:59.999 IST is 400 discount_reason_not_in_force and writes nothing; from 1 November 00:00 IST it is made and issues", async () => {
    const o = await farSession("owner");
    at("2026-10-31T12:00:00.000+05:30");
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const before = await env.DB.prepare("SELECT count(*) AS c FROM documents").first<{ c: number }>();
    at("2026-10-31T23:59:59.999+05:30");
    await renew(o);
    const refused = await draftCredit(o, inv.id, { mode: "full", reasonCode: "discount_after_sale" });
    expect(refused.status).toBe(400);
    const b = await json(refused);
    expect(b.error.code).toBe("discount_reason_not_in_force");
    expect(b.error.message).toBe(
      "A credit note for a discount after sale can be dated from 1 November 2026.",
    );
    expect((await env.DB.prepare("SELECT count(*) AS c FROM documents").first<{ c: number }>())?.c).toBe(
      before?.c,
    );
    // the other reasons are not limited by the date
    expect(
      (await draftCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 100 }] })).status,
    ).toBe(201);
  });

  it("from the first instant of 1 November (IST) the reason is accepted, as a draft, as a save and at the issue", async () => {
    const o = await farSession("owner");
    at("2026-10-31T12:00:00.000+05:30");
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    at("2026-11-01T00:00:00.000+05:30");
    await renew(o);
    const ok = await draftCredit(o, inv.id, {
      mode: "lines",
      lines: [{ line: 0, taxableMinor: 10_000 }],
      reasonCode: "discount_after_sale",
    });
    expect(ok.status, await ok.clone().text()).toBe(201);
    const { id } = await json(ok);
    const issued = await issueInvoice(o, id);
    expect(issued.status, await issued.clone().text()).toBe(200);
    expect((await noteRow(id))?.status).toBe("issued");
    expect((await noteRow(id))?.issue_date).toBe("2026-11-01");
  });

  it("a save of a draft to that reason before the day is refused", async () => {
    const o = await farSession("owner");
    at("2026-10-30T12:00:00.000+05:30");
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const made = await json(await draftCredit(o, inv.id, { mode: "full" }));
    const doc = await getInvoice(o, made.id);
    const res = await patchInvoice(o, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      fields: { note: { mode: "full", reasonCode: "discount_after_sale" } },
    });
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("discount_reason_not_in_force");
  });
});

describe("the debit note 'Tax charged too low' [Q35, RA-22]", () => {
  const taxOnly = (taxAmountMinor: number, over: Record<string, unknown> = {}) => ({
    reasonCode: "tax_charged_too_low",
    taxAmountMinor,
    ...over,
  });

  it("a draft with taxable value zero and the tax split over the invoice's heads; it issues as its own payable and the invoice is untouched", async () => {
    const o = await farSession("owner");
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const res = await draftDebit(o, inv.id, taxOnly(1_800));
    expect(res.status, await res.clone().text()).toBe(201);
    const b = await json(res);
    expect(b.request).toEqual({ mode: "lines", taxMinor: 1_800, takes: [{ line: 0, taxableMinor: 0 }] });
    expect(b.preview.totals).toMatchObject({
      taxableMinor: 0,
      cgstMinor: 900,
      sgstMinor: 900,
      igstMinor: 0,
      totalMinor: 1_800,
    });
    const view = await getInvoice(o, b.id);
    expect(view.blockers ?? []).toEqual([]);
    const issued = await issueInvoice(o, b.id);
    expect(issued.status, await issued.clone().text()).toBe(200);
    const row = await noteRow(b.id);
    expect(row).toMatchObject({
      type: "debit_note",
      status: "issued",
      taxable_minor: 0,
      cgst_minor: 900,
      sgst_minor: 900,
      igst_minor: 0,
      total_minor: 1_800,
      balance_minor: 1_800,
    });
    // the invoice's balance is not moved by a debit note (Q63)
    expect(await parentRow(inv.id)).toMatchObject({
      credited_minor: 0,
      balance_minor: inv.total,
      status: "issued",
    });
    // sealed with its request (the tax amount is part of the header)
    const bundle = (await loadDocument(env.DB, b.id)) as DocumentBundle<TermsRef>;
    expect(await verifyInvoiceSealed(bundle)).toEqual({ content: true, snapshot: true });
    const parts = invoiceSealPartsOfBundle(bundle);
    expect(parts?.noteOf?.request.taxMinor).toBe(1_800);
    expect(parts && (await invoiceSealOf(parts)).snapshotSha256).toBe(bundle.document.snapshot_sha256);
  });

  it("a bad shape is 400 debit_tax_only_invalid and writes nothing: lines with it, no amount, zero, negative, an odd amount on an intra-state invoice", async () => {
    const o = await farSession("owner");
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const docs = async () =>
      (await env.DB.prepare("SELECT count(*) AS c FROM documents").first<{ c: number }>())?.c;
    const before = await docs();
    for (const body of [
      taxOnly(1_800, { lines: [{ line: 0, taxableMinor: 100 }] }),
      { reasonCode: "tax_charged_too_low" },
      taxOnly(0),
      taxOnly(-5),
      taxOnly(1_801),
    ]) {
      const res = await draftDebit(o, inv.id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      const err = (await json(res)).error;
      expect(err.code).toBe("debit_tax_only_invalid");
      expect(err.message).toBe('Enter tax only: the taxable value of a "Tax charged too low" note is zero.');
      // only the odd amount on an intra-state invoice says why (07-W 5.9): the screen shows its own line for `details.reason`
      if ((body as Record<string, unknown>).taxAmountMinor === 1_801)
        expect(err.details).toEqual({ reason: "odd_amount" });
      else expect(err.details).toBeUndefined();
    }
    expect(await docs()).toBe(before);
  });

  it("the other reasons keep their shape: lines required, no tax amount (plain 400)", async () => {
    const o = await farSession("owner");
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const withTax = await draftDebit(o, inv.id, {
      reasonCode: "price_correction",
      lines: [{ line: 0, taxableMinor: 100 }],
      taxAmountMinor: 18,
    });
    expect(withTax.status).toBe(400);
    expect(await codeOf(withTax)).toBe("bad_request");
    const none = await draftDebit(o, inv.id, { reasonCode: "other", reasonText: "why" });
    expect(none.status).toBe(400);
    expect(await codeOf(none)).toBe("bad_request");
    const ok = await draftDebit(o, inv.id, {
      reasonCode: "price_correction",
      lines: [{ line: 0, taxableMinor: 100 }],
    });
    expect(ok.status, await ok.clone().text()).toBe(201);
  });

  it("an export under LUT has no tax to add: 400 debit_tax_only_invalid", async () => {
    const o = await farSession("owner");
    const inv = await mkIssuedInvoice(o, { prices: [100_000], client: mkOverseasClient });
    const res = await draftDebit(o, inv.id, taxOnly(1_800));
    expect(res.status, await res.clone().text()).toBe(400);
    expect(await codeOf(res)).toBe("debit_tax_only_invalid");
  });

  it("an export with IGST paid: the tax is IGST, in USD, with the INR view at the invoice's rate; it issues and is reported", async () => {
    const o = await farSession("owner");
    const inv = await mkIssuedInvoice(o, {
      prices: [100_000],
      client: mkOverseasClient,
      fields: { exportMode: "igst_paid" },
    });
    const res = await draftDebit(o, inv.id, taxOnly(1_800));
    expect(res.status, await res.clone().text()).toBe(201);
    const b = await json(res);
    expect(b.preview.totals).toMatchObject({ taxableMinor: 0, igstMinor: 1_800, totalMinor: 1_800 });
    expect(b.preview.totals.totalInrMinor).toBeGreaterThan(0);
    const issued = await issueInvoice(o, b.id);
    expect(issued.status, await issued.clone().text()).toBe(200);
    expect(await noteRow(b.id)).toMatchObject({ taxable_minor: 0, igst_minor: 1_800, total_minor: 1_800 });
  });

  it("a note copies the parent's no-rate statement with the day it covers: the note's own fx columns and seal are the parent's (review 2026-10-28, finding 6)", async () => {
    const o = await farSession("owner");
    const day = (n: number) =>
      new Date(Date.parse(`${todayIso()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const inv = await mkIssuedInvoice(o, {
      prices: [100_000],
      client: mkOverseasClient,
      fields: {
        exportMode: "igst_paid",
        fx: { rate: "83.1234", date: day(-3), source: "FBIL", noRateThatDay: true },
      },
    });
    const parentFx = await env.DB.prepare("SELECT fx_date, fx_no_rate_day FROM documents WHERE id = ?")
      .bind(inv.id)
      .first<{ fx_date: string; fx_no_rate_day: string }>();
    expect(parentFx).toEqual({ fx_date: day(-3), fx_no_rate_day: day(0) });
    const debit = await issueDebit(o, inv.id, taxOnly(1_800));
    const credit = await issueCredit(o, inv.id, {
      mode: "lines",
      lines: [{ line: 0, taxableMinor: 10_000 }],
    });
    for (const id of [debit.id, credit.id]) {
      const row = await env.DB.prepare("SELECT fx_date, fx_no_rate_day FROM documents WHERE id = ?")
        .bind(id)
        .first();
      expect(row).toEqual({ fx_date: day(-3), fx_no_rate_day: day(0) });
      const bundle = (await loadDocument(env.DB, id)) as DocumentBundle<TermsRef>;
      expect(await verifyInvoiceSealed(bundle)).toEqual({ content: true, snapshot: true });
      expect(invoiceSealPartsOfBundle(bundle)?.fx).toMatchObject({ noRateDay: day(0) });
    }
  });

  it("a save changes the amount, or turns the note into a price correction (and back), always from the invoice as it is now", async () => {
    const o = await farSession("owner");
    const inv = await mkIssuedInvoice(o, { prices: [100_000, 50_000] });
    const made = await json(await draftDebit(o, inv.id, taxOnly(2_700)));
    // two lines at 18 %: the tax follows the tax each line carries
    expect(made.request.takes).toEqual([
      { line: 0, taxableMinor: 0 },
      { line: 1, taxableMinor: 0 },
    ]);
    expect(made.preview.totals.cgstMinor).toBe(1_350);
    const doc = await getInvoice(o, made.id);
    const more = await patchInvoice(o, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      fields: { note: { mode: "lines", reasonCode: "tax_charged_too_low", taxAmountMinor: 5_400 } },
    });
    expect(more.status, await more.clone().text()).toBe(200);
    expect((await json(more)).totalMinor).toBe(5_400);
    // a save with an odd amount says why too (07-W 5.9)
    const doc1 = await getInvoice(o, made.id);
    const odd = await patchInvoice(o, made.id, {
      expectedUpdatedAt: doc1.updatedAt,
      fields: { note: { mode: "lines", reasonCode: "tax_charged_too_low", taxAmountMinor: 5_401 } },
    });
    expect(odd.status).toBe(400);
    const oddBody = await json(odd);
    expect(oddBody.error.code).toBe("debit_tax_only_invalid");
    expect(oddBody.error.details).toEqual({ reason: "odd_amount" });
    const doc2 = await getInvoice(o, made.id);
    const price = await patchInvoice(o, made.id, {
      expectedUpdatedAt: doc2.updatedAt,
      fields: {
        note: { mode: "lines", reasonCode: "price_correction", lines: [{ line: 0, taxableMinor: 1_000 }] },
      },
    });
    expect(price.status, await price.clone().text()).toBe(200);
    expect((await json(price)).request).toEqual({ mode: "lines", takes: [{ line: 0, taxableMinor: 1_000 }] });
    const doc3 = await getInvoice(o, made.id);
    const wrong = await patchInvoice(o, made.id, {
      expectedUpdatedAt: doc3.updatedAt,
      fields: {
        note: { mode: "lines", reasonCode: "tax_charged_too_low", lines: [{ line: 0, taxableMinor: 1 }] },
      },
    });
    // lines and a tax-only reason cannot be asked together: the schema refuses the pairing of a tax amount with lines, the route the rest
    expect(wrong.status).toBe(400);
  });

  it("not capped by what was credited, and refused on an invoice credited in full (07-T §9 line)", async () => {
    const o = await farSession("owner");
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    await issueCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 50_000 }] });
    const ok = await draftDebit(o, inv.id, taxOnly(1_800));
    expect(ok.status, await ok.clone().text()).toBe(201);
    const { id } = await json(ok);
    expect((await issueInvoice(o, id)).status).toBe(200);
    await issueCredit(o, inv.id, { mode: "full" });
    const full = await draftDebit(o, inv.id, taxOnly(1_800));
    expect(full.status).toBe(409);
    const b = await json(full);
    expect(b.error.code).toBe("debit_parent_fully_credited");
    expect(b.error.message).toBe(
      "This invoice has been credited in full, so a debit note can't be issued against it. Issue a new invoice instead.",
    );
  });
});
