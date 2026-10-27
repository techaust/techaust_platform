// M5.3 through the advance invoice and through random sequences [Q9, Q32, docs/09 :106; VERIFY WITH CA/LEGAL]: the supply FY of an invoice made for money already received, and
// note sequences (lines, amount, full) that never exceed the invoice and add up to it exactly.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, one, sessionFor } from "./test-helpers.ts";
import { currentFy, lutOf, mkProforma, putSwiftBank, putTax, renew } from "./test-invoice-types.ts";
import {
  farSession,
  getInvoice,
  issueInvoice,
  type J,
  json,
  mkInvoiceClient,
  putBank,
  putCompany,
} from "./test-invoices.ts";
import { draftCredit, issueCredit, mkIssuedInvoice, noteRow, parentRow } from "./test-notes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
});
afterEach(() => vi.useRealTimers());

describe("the supply FY of an invoice for money already received [Q9, Q32; VERIFY WITH CA/LEGAL]", () => {
  it("money received on 28 March and the invoice made on 2 April: the credit deadline is the year of the money, 30 November of the same calendar year", async () => {
    const o = await farSession("owner");
    const c = await mkInvoiceClient();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-28T11:00:00.000+05:30"));
    const pf = await mkProforma(o, { clientId: c.clientId, price: 100_000 });
    expect((await issueInvoice(o, pf.id)).status).toBe(200);
    vi.setSystemTime(new Date("2027-04-02T11:00:00.000+05:30"));
    await renew(o);
    const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", pf.id);
    const res = await call(`/invoices/${pf.id}/advance-invoice`, {
      cookie: o.cookie,
      body: {
        expectedProformaUpdatedAt: row?.updated_at,
        amountMinor: 59_000,
        receivedOn: "2027-03-28",
        reference: "UTR Q32",
      },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const made = await json(res);
    const view = await getInvoice(o, made.id);
    // the invoice is dated 2 April 2027 (FY 2027-28) but the supply was in FY 2026-27
    expect(view.fy).toBe("2728");
    expect(view.creditDeadline).toMatchObject({ supplyFy: "2627", date: "2027-11-30", basis: "cutoff" });
    // the paid invoice takes a credit note: it stays paid, a refund is due
    const cn = await issueCredit(o, made.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 10_000 }] });
    expect(await parentRow(made.id)).toMatchObject({ status: "paid", balance_minor: 0 });
    expect((await getInvoice(o, made.id)).refundDueMinor).toBe(Number((await noteRow(cn.id))?.total_minor));
  });
});

describe("random sequences through the API never exceed the invoice [docs/09 :106]", () => {
  // A small deterministic generator (the property over 1 to 100 lines and the USD cases is in packages/core/test/notes.test.ts; this one goes through the routes).
  const rng = (start: number) => {
    let seed = start;
    return () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
  };

  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: lines, amount and full notes in turn; the credited total, every line and every head stay within the invoice, and the last note adds up exactly`, async () => {
      const next = rng(seed);
      const o = await owner();
      const prices = Array.from(
        { length: 2 + Math.floor(next() * 4) },
        () => 10_000 + Math.floor(next() * 400_000),
      );
      const inv = await mkIssuedInvoice(o, {
        prices,
        client: seed === 3 ? () => mkInvoiceClient({ state_code: "27" }) : mkInvoiceClient,
      });
      let creditedTotal = 0;
      for (let step = 0; step < 6; step++) {
        const view = await getInvoice(o, inv.id);
        if (view.creditable.totalLeftMinor <= 0) break;
        const left = view.creditable.lines.filter((l: J) => l.taxableLeftMinor > 0);
        const pick = next();
        let body: Record<string, unknown>;
        if (pick < 0.4) {
          const l = left[Math.floor(next() * left.length)] as J;
          body = {
            mode: "lines",
            lines: [
              {
                line: l.line,
                taxableMinor: Math.max(1, Math.floor(l.taxableLeftMinor * (0.1 + next() * 0.8))),
              },
            ],
          };
        } else if (pick < 0.8) {
          body = {
            mode: "amount",
            grossMinor: Math.max(200, Math.floor(view.creditable.totalLeftMinor * (0.1 + next() * 0.7))),
          };
        } else body = { mode: "full" };
        const res = await draftCredit(o, inv.id, body);
        if (res.status === 400) continue; // an amount too small to credit anything
        expect(res.status, JSON.stringify(body) + (await res.clone().text())).toBe(201);
        const draft = await json(res);
        const issued = await issueInvoice(o, draft.id);
        expect(issued.status, await issued.clone().text()).toBe(200);
        creditedTotal += draft.totalMinor;
        const after = await parentRow(inv.id);
        expect(after?.credited_minor).toBe(creditedTotal);
        expect(creditedTotal).toBeLessThanOrEqual(inv.total);
        expect(after?.balance_minor).toBe(inv.total - creditedTotal);
      }
      // what is left, in one final note: the notes add up to the invoice exactly, per head
      const view = await getInvoice(o, inv.id);
      if (view.creditable.totalLeftMinor > 0) await issueCredit(o, inv.id, { mode: "full" });
      expect(await parentRow(inv.id)).toMatchObject({
        status: "credited",
        credited_minor: inv.total,
        balance_minor: 0,
      });
      const sums = await one<Record<string, number>>(
        "SELECT sum(total_minor) AS t, sum(taxable_minor) AS x, sum(cgst_minor) AS c, sum(sgst_minor) AS s, sum(igst_minor) AS i FROM documents WHERE parent_id = ? AND type = 'credit_note' AND frozen_at IS NOT NULL",
        inv.id,
      );
      const parent = await one<Record<string, number>>(
        "SELECT total_minor AS t, taxable_minor AS x, cgst_minor AS c, sgst_minor AS s, igst_minor AS i FROM documents WHERE id = ?",
        inv.id,
      );
      expect(sums).toEqual(parent);
    }, 120_000);
  }
});
