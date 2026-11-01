// "Needs review" reads its reason from the stored facts [ADM-PAY-07, ADM-PAY-12; M6.2 fix round 3 item 2]: a `document_not_payable` item's reason code and an
// `amount_mismatch` item's link amount, in the shapes the finance Worker stores (`reviewFactsOf` in worker/gateway/settle.ts; codes and amounts only, L8).
import { formatMoney, money } from "@techaust/core/money";
import { describe, expect, it } from "vitest";
import { itemReason } from "./gateway.ts";

const inr = (m: number) => formatMoney(money(m, "INR"));
const base = { linkId: "plink_X", paymentId: "pay_X", currency: "INR", method: "card" };

describe("itemReason [07-ZI S20]", () => {
  it("names the link's amount of an amount_mismatch", () => {
    expect(
      itemReason({
        kind: "amount_mismatch",
        facts: { ...base, amountMinor: 117_900, expectedMinor: 118_000 },
        amount_minor: 117_900,
      }),
    ).toBe(`The amount paid (${inr(117_900)}) doesn't match the link (${inr(118_000)}).`);
  });

  it("names document_not_payable's reason in words", () => {
    const words = (reason: string) =>
      itemReason({
        kind: "document_not_payable",
        facts: { ...base, amountMinor: 100, reason },
        amount_minor: 100,
      });
    expect(words("void")).toBe(
      "The invoice could no longer be paid when the money arrived (it was voided). The money waits for your decision.",
    );
    expect(words("nothing_due")).toContain("(nothing was due on it)");
    expect(words("withdrawn")).toContain("(it was withdrawn)");
    // The race fallbacks and an unknown code read as "it changed", never as the code.
    expect(words("changed")).toContain("(it changed)");
    expect(words("link_not_live")).toContain("(it changed)");
  });

  it("an item stored before the facts carried them keeps S20's fallbacks", () => {
    expect(
      itemReason({ kind: "amount_mismatch", facts: { ...base, amountMinor: 100 }, amount_minor: 100 }),
    ).toBe(`The amount paid (${inr(100)}) doesn't match the link (the amount).`);
    expect(itemReason({ kind: "document_not_payable", facts: null, amount_minor: 100 })).toContain(
      "(it changed)",
    );
  });
});
