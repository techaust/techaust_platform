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
import stripeSettleSource from "../../worker/gateway/stripe-settle.ts?raw";
import {
  advanceBlockerLine,
  gatewayLine,
  inrPerUsdText,
  itemReason,
  portalInvoiceUrl,
  stripeFacts,
} from "./gateway.ts";

const inr = (m: number) => formatMoney(money(m, "INR"));
const base = { linkId: "plink_X", paymentId: "pay_X", currency: "INR", method: "card" };

// M6.2 review finding 4: the automatic tax invoice's blockers in words, in the bell, the banner, the list and the toast; never a code.
describe("the gateway advance's blockers in words [ADM-INV-10]", () => {
  it("every code advance.ts can produce has its words", () => {
    const codes = [...advanceSource.matchAll(/blocked\(env, p, [^,]+, \["([a-z_]+)"\]\)/g)].map(
      (m) => m[1] as string,
    );
    // M6.3: a USD proforma paid by card is blocked by the finance Worker's Stripe path with `fx_rate_needed` (S16).
    const stripe = [...stripeSettleSource.matchAll(/blockers: \["([a-z_]+)"\]/g)].map((m) => m[1] as string);
    expect(stripe).toEqual(["fx_rate_needed"]);
    expect(new Set([...codes, ...stripe])).toEqual(new Set(Object.keys(ADVANCE_BLOCKER_WORDS)));
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

  it("M6.3: a Stripe item names Stripe and its dollars", () => {
    expect(
      itemReason({
        kind: "amount_mismatch",
        facts: { linkId: "cs_test_x", expectedMinor: 50_000 },
        amount_minor: 49_000,
        provider: "stripe",
        currency: "USD",
      }),
    ).toBe("The amount paid ($490.00) doesn't match the link ($500.00).");
    expect(
      itemReason({
        kind: "refetch_failed",
        facts: null,
        amount_minor: null,
        provider: "stripe",
        currency: null,
      }),
    ).toBe("Stripe couldn't be reached to confirm this payment. Try again.");
  });
});

// M6.3 (07-ZM S13, S14; L10): Stripe's lines on the Payments panel.
describe("a Stripe payment's lines [ADM-PAY-01]", () => {
  it("the rate is the INR credited over the dollars, in bigint to the paisa, never a float", () => {
    expect(inrPerUsdText(1_00_800_00, 1_200_00)).toBe("84.00");
    // 8,412.34 rupees for 100 dollars: 84.1234, shown to the paisa, half up
    expect(inrPerUsdText(8_412_34, 100_00)).toBe("84.12");
    expect(inrPerUsdText(8_412_50, 100_00)).toBe("84.13");
    // a rate a float would get wrong (0.1 + 0.2 style): 1 rupee over 3 cents
    expect(inrPerUsdText(100, 3)).toBe("33.33");
    expect(inrPerUsdText(100, 0)).toBeNull();
    expect(inrPerUsdText(1.5, 3)).toBeNull();
  });
  it("S14's facts only for Stripe, with the fee's GST when Stripe gave it", () => {
    const row = {
      provider: "stripe",
      amountMinor: 1_200_00,
      inrReceivedMinor: 1_00_800_00,
      gatewayFeeInrMinor: 3_024_00,
      gatewayFeeTaxInrMinor: 461_28,
    };
    const facts = stripeFacts(row);
    expect(facts).toHaveLength(2);
    expect(facts[0]).toContain(
      `INR credited by Stripe ${inr(1_00_800_00)} (about ₹84.00 per USD; not the GST rate)`,
    );
    expect(facts[1]).toContain(`Stripe fee ${inr(3_024_00)} incl. GST ${inr(461_28)} (absorbed)`);
    expect(stripeFacts({ ...row, gatewayFeeTaxInrMinor: null })[1]).toBe(`Fee ${inr(3_024_00)} (absorbed)`);
    expect(stripeFacts({ ...row, inrReceivedMinor: null, gatewayFeeInrMinor: null })).toEqual([]);
    expect(stripeFacts({ ...row, provider: "razorpay" })).toEqual([]);
  });
  it("S14's line keeps the id when there is one, and Razorpay keeps its own", () => {
    expect(gatewayLine("stripe", "card", "pi_X")).toContain("Stripe · card · pi_X");
    expect(gatewayLine("stripe", "card", null)).toContain("Stripe · card");
    expect(gatewayLine("stripe", "card", null)).not.toContain("· pi");
    expect(gatewayLine("razorpay", "upi", "pay_X")).toBe("Razorpay · UPI · pay_X");
  });
  it("S13's portal link is the client's signed-in invoice page, or nothing without a portal", () => {
    expect(portalInvoiceUrl("doc 1", "https://portal.example.test")).toBe(
      "https://portal.example.test/invoices/doc%201",
    );
    expect(portalInvoiceUrl("doc", "")).toBeNull();
    expect(portalInvoiceUrl("doc", "not a url")).toBeNull();
  });
});
