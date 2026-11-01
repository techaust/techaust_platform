// 07-ZM (POR-06, M6.3): the portal's client lines 1 to 8 word for word with docs/07-content-appendix/ZM-m6.3-stripe.md (read here, so a change to the page that
// isn't made in the code fails), and lines 11 and 12 as the finance Worker sends them to Stripe. Lines 4 and 6 as the portal Worker answers them are held to
// the same literal words by worker/pay.test.ts.
import { DISPLAY_NAME, STATEMENT_SUFFIX } from "@techaust/core/stripe";
import { describe, expect, it } from "vitest";
import zmPage from "../../../docs/07-content-appendix/ZM-m6.3-stripe.md?raw";
import { APPROVED_07ZM, PAY_ZM } from "./copy-zm.ts";

/** The quoted texts of 07-ZM's numbered client line `n` (before the staff section). */
function quoted(n: number): string[] {
  const client = zmPage.split("## Staff lines")[0] as string;
  const line = client.split("\n").find((l) => l.startsWith(`${n}. `));
  if (!line) throw new Error(`07-ZM has no line ${n}`);
  return [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

describe("07-ZM client lines [POR-06, M6.3]", () => {
  it("are approved by the owner, and the switch says so", () => {
    expect(zmPage).toContain("client lines C1–C12 APPROVED by the owner, 2026-11-01");
    expect(APPROVED_07ZM).toBe(true);
  });

  it("1 to 8, word for word", () => {
    expect([PAY_ZM.payByCard]).toEqual(quoted(1));
    expect([PAY_ZM.continue]).toEqual(quoted(2));
    expect([PAY_ZM.howItWorks]).toEqual(quoted(3));
    expect([PAY_ZM.notYet]).toEqual(quoted(4));
    expect([PAY_ZM.cancelled]).toEqual(quoted(5));
    expect([PAY_ZM.maximum("{maximum}")]).toEqual(quoted(6));
    expect([PAY_ZM.receivedProforma("{amount}")]).toEqual(quoted(7));
    expect([PAY_ZM.proformaPaid("{date}")]).toEqual(quoted(8));
  });

  it("lines 11 and 12 are the constants sent to Stripe", () => {
    expect(quoted(11)).toEqual([STATEMENT_SUFFIX]);
    expect(quoted(12)).toEqual([DISPLAY_NAME]);
  });
});
