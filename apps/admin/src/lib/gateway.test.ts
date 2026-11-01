// "Needs review" reads its reason from the stored facts [ADM-PAY-07, ADM-PAY-12; M6.2 fix round 3 item 2]: a `document_not_payable` item's reason code and an
// `amount_mismatch` item's link amount, in the shapes the finance Worker stores (`reviewFactsOf` in worker/gateway/settle.ts; codes and amounts only, L8).
import { formatMoney, money } from "@techaust/core/money";
import { describe, expect, it } from "vitest";
import advanceSource from "../../worker/gateway/advance.ts?raw";
import {
  ADVANCE_BLOCKER_WORDS,
  ADVANCE_OTHER_CHECK,
  advanceBlockersText,
} from "../../worker/gateway/reasons.ts";
import { advanceBlockerLine, itemReason } from "./gateway.ts";

const inr = (m: number) => formatMoney(money(m, "INR"));
const base = { linkId: "plink_X", paymentId: "pay_X", currency: "INR", method: "card" };

// M6.2 review finding 4: the automatic tax invoice's blockers in words, in the bell, the banner, the list and the toast; never a code.
describe("the gateway advance's blockers in words [ADM-INV-10]", () => {
  it("every code advance.ts can produce has its words", () => {
    const codes = [...advanceSource.matchAll(/blocked\(env, p, [^,]+, \["([a-z_]+)"\]\)/g)].map(
      (m) => m[1] as string,
    );
    expect(new Set(codes)).toEqual(new Set(Object.keys(ADVANCE_BLOCKER_WORDS)));
  });
  it("the list, the banner and the bell read words; an invoice check keeps its own line (the bell, its general words)", () => {
    const reason = itemReason({
      kind: "advance_blocked",
      facts: { blockers: ["issuer_not_owner", "signature_missing"] },
      amount_minor: 100,
    });
    expect(reason).toContain("the owner who issued the proforma is no longer an active owner");
    expect(reason).toContain("Add the signature in Settings › Company");
    expect(reason).not.toMatch(/issuer_not_owner|signature_missing/);
    expect(advanceBlockersText(["issuer_not_owner", "signature_missing", "recipient_gstin"])).toBe(
      `${ADVANCE_BLOCKER_WORDS.issuer_not_owner}; ${ADVANCE_OTHER_CHECK}`,
    );
    expect(advanceBlockersText([])).toBeNull();
    for (const code of Object.keys(ADVANCE_BLOCKER_WORDS)) {
      const line = advanceBlockerLine(code);
      expect(line).toMatch(/^[A-Z].*\.$/);
      expect(line).not.toContain(code);
    }
  });
});

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
