// M6.5 code review part 1, the fixes at route level [ADM-PAY-08, -10, ADM-INV-17; run file "Code review part 1" findings 2, 3, 6, 8, 9, 10 and the screen review's
// P2-4, P2-10, P2-13]: the ₹10 lakh declaration cap per invoice, RA-41's facts on every confirm answer and the credit-held list, the refund's credit note, the
// bank's INR figure for a USD refund, the written request with "own account", every settlement of a recon day, each payment's own gateway on the panel, and the
// ₹25 lakh line from the balance still payable. No test reaches a gateway: the stub transports answer. Invented test data.
import { uuidv7 } from "@techaust/core/ids";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStubTransport } from "./gateway/config.ts";
import { stub } from "./test-gateway.ts";
import { call, one, sessionFor } from "./test-helpers.ts";
import { todayIso } from "./test-invoice-types.ts";
import { type J, json, putCompany } from "./test-invoices.ts";
import { addDoc, line, mkReportClient } from "./test-reports.ts";

const owner = () => sessionFor("owner", { stepUp: true });
beforeEach(async () => {
  await putCompany();
  stub();
});
afterEach(() => {
  setStubTransport(null);
});

describe("finding 2: the ₹10 lakh declaration cap is per invoice [RB-43]", () => {
  it("$9,000 declared, then $9,000 more on the same invoice: 409 declaration_too_large, nothing written; the bank's own approval still goes in", async () => {
    const o = await owner();
    const clientId = await mkReportClient("USD");
    // $50,000 at ₹83.1234: $9,000 is ₹7,48,110.60
    const inv = await addDoc({
      clientId,
      currency: "USD",
      issueDate: "2026-10-05",
      lines: [line(5_000_000)],
    });
    const reduce = (amountMinor: number, declaration: boolean) =>
      call(`/invoices/${inv.id}/realisation-reductions`, {
        cookie: o.cookie,
        body: {
          id: uuidv7(),
          amountMinor,
          approvedOn: todayIso(),
          bankRef: `ADB-${amountMinor}`,
          declaration,
        },
      });
    expect((await reduce(900_000, true)).status).toBe(200);
    const second = await reduce(900_000, true);
    expect(second.status).toBe(409);
    const e = ((await json(second)) as J).error;
    expect(e.code).toBe("declaration_too_large");
    expect(e.details.declaredMinor).toBe(900_000);
    expect(
      await one<{ n: number }>(
        "SELECT count(*) AS n FROM realisation_reductions WHERE document_id = ?1",
        inv.id,
      ),
    ).toEqual({ n: 1 });
    expect((await reduce(900_000, false)).status).toBe(200);
    // a future day (IST) is refused
    const later = await call(`/invoices/${inv.id}/realisation-reductions`, {
      cookie: o.cookie,
      body: {
        id: uuidv7(),
        amountMinor: 1_000,
        approvedOn: "2099-01-01",
        bankRef: "ADB-F",
        declaration: false,
      },
    });
    expect(later.status).toBe(400);
  });
});
