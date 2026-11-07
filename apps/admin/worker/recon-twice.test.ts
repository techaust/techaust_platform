// Full audit M6–M7 AU11 (B6 L5) [ADM-PAY-10, L11]: storing one day's Razorpay settlements twice is a no-op, which is what lets the 09:00 IST tick fetch the day
// before yesterday as well as yesterday (`apps/jobs/src/billing.ts`). No test reaches a gateway: Razorpay answers from the stub. Invented test data.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStubTransport } from "./gateway/config.ts";
import { fetchSettlements } from "./recon.ts";
import { stub } from "./test-gateway.ts";
import { one } from "./test-helpers.ts";
import { putCompany } from "./test-invoices.ts";

beforeEach(async () => {
  await putCompany();
  stub();
});
afterEach(() => setStubTransport(null));

describe("one day stored twice [AU11]", () => {
  it("the second fetch of the same day adds no settlement and no line, and changes neither", async () => {
    const setl = `setl_TW${Date.now()}`;
    const line = (entity: string) => ({
      entity_id: entity,
      type: "payment",
      amount: 5_000,
      fee: 100,
      tax: 18,
      credit: 4_882,
      debit: 0,
      currency: "INR",
      settlement_id: setl,
      settled_at: 1_793_000_000,
    });
    const items = [line(`pay_TW1${Date.now()}`), line(`pay_TW2${Date.now()}`)];
    stub((path) => {
      if (path === "/v1/settlements/recon/combined") return Response.json({ count: 2, items });
      if (path === `/v1/settlements/${setl}`)
        return Response.json({
          id: setl,
          entity: "settlement",
          amount: 9_764,
          fees: 200,
          tax: 36,
          utr: "UTRTWICE1",
          status: "processed",
          created_at: 1_793_000_000,
        });
      return null;
    });
    const counts = async () => ({
      settlements: (
        await one<{ n: number }>("SELECT count(*) AS n FROM settlements WHERE settlement_id = ?", setl)
      )?.n,
      lines: (
        await one<{ n: number }>(
          "SELECT count(*) AS n FROM settlement_items WHERE settlement_id IN (SELECT id FROM settlements WHERE settlement_id = ?)",
          setl,
        )
      )?.n,
      rows: await one(
        "SELECT utr, amount_minor, fees_minor, tax_minor, settled_on FROM settlements WHERE settlement_id = ?",
        setl,
      ),
    });
    expect(await fetchSettlements(env, { provider: "razorpay", day: "2026-11-04", skip: 0 })).toEqual({
      result: "stored",
    });
    const first = await counts();
    expect(first.settlements).toBe(1);
    expect(first.lines).toBe(2);
    // the next morning's tick fetches the same day again (as "the day before yesterday")
    expect(await fetchSettlements(env, { provider: "razorpay", day: "2026-11-04", skip: 0 })).toEqual({
      result: "stored",
    });
    expect(await counts()).toEqual(first);
  });
});
