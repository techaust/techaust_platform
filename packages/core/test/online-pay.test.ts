// Online payment rules [ADM-PAY-02, ADM-SET-05, POR-06; M6.2 run file B and H]: which documents may be paid online (every refusal reason, overseas refused: owner
// Q3 A) and which amounts (property-tested against a plain restatement of the rule), plus the review kinds' twin.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ONLINE_MAX_USD_MINOR,
  DEFAULT_PART_FLOOR_MINOR,
  DEFAULT_USD_PART_FLOOR_MINOR,
  GATEWAY_MIN_MINOR,
  isOnlineProvider,
  NOT_PAYABLE_REASONS,
  ONLINE_PAYABLE_TYPES,
  ONLINE_PROVIDERS,
  ONLINE_RULES,
  onlineMinimumOf,
  type PayableClient,
  type PayableDoc,
  payAmountVerdict,
  payableOnline,
  REVIEW_KINDS,
  storedFloorOf,
} from "../src/online-pay.ts";
import { SETTINGS_DEFAULTS } from "../src/schemas/settings.ts";
import { STRIPE_MIN_AMOUNT_MINOR } from "../src/stripe.ts";

const doc: PayableDoc = {
  type: "tax_invoice",
  currency: "INR",
  frozen: true,
  status: "issued",
  withdrawn: false,
  balanceMinor: 118_000,
};
const client: PayableClient = { country: "IN", gstStatus: "registered", anonymised: false };

describe("payableOnline [POR-06, Q3 A]", () => {
  it("a tax invoice, a debit note and a proforma of a domestic INR client, issued, with something due", () => {
    expect(payableOnline(doc, client, "razorpay")).toEqual({ ok: true });
    expect(
      payableOnline({ ...doc, type: "debit_note", status: "partially_paid" }, client, "razorpay"),
    ).toEqual({
      ok: true,
    });
    expect(
      payableOnline({ ...doc, type: "proforma" }, { ...client, gstStatus: "unregistered" }, "razorpay"),
    ).toEqual({
      ok: true,
    });
    expect(
      payableOnline(
        { ...doc, type: "proforma", status: "converted", balanceMinor: 50_000 },
        client,
        "razorpay",
      ),
    ).toEqual({
      ok: true,
    });
  });

  it.each([
    ["type_not_payable", { type: "export_invoice" }, {}],
    ["type_not_payable", { type: "credit_note" }, {}],
    ["type_not_payable", { type: "proposal" }, {}],
    ["client_anonymised", {}, { anonymised: true }],
    ["client_overseas", {}, { country: "US", gstStatus: "overseas" }],
    ["client_overseas", {}, { gstStatus: "overseas" }],
    ["client_overseas", {}, { country: "AE" }],
    ["not_inr", { currency: "USD" }, {}],
    ["not_issued", { frozen: false, status: "draft" }, {}],
    ["withdrawn", { type: "proforma", status: "void", withdrawn: true }, {}],
    ["void", { status: "void" }, {}],
    ["nothing_due", { status: "paid", balanceMinor: 0 }, {}],
    ["nothing_due", { balanceMinor: -5 }, {}],
    ["below_gateway_minimum", { balanceMinor: 99 }, {}],
    ["target_not_whole_unit", { type: "proforma", balanceMinor: 118_050 }, {}],
    // Early check 1, finding 5: a frozen proforma that is neither issued nor converted (a status the flow should never give it) is not payable.
    ["not_issued", { type: "proforma", status: "paid" }, {}],
    // M6.3 (generic, reviewer X1): a gateway payment still waiting on the document.
    ["payment_pending", { type: "proforma", paymentPending: true }, {}],
  ] as const)("refuses %s", (reason, d, c) => {
    expect(payableOnline({ ...doc, ...d }, { ...client, ...c }, "razorpay")).toEqual({
      ok: false,
      code: "not_payable_online",
      reason,
    });
  });

  it("every reason is listed once", () => {
    expect(new Set(NOT_PAYABLE_REASONS).size).toBe(NOT_PAYABLE_REASONS.length);
    expect(GATEWAY_MIN_MINOR).toBe(100);
  });
});

describe("payAmountVerdict [07-ZI lines 4 to 7, RB-39]", () => {
  it("the examples: full, part above the floor, below the floor, above the balance, paise on a proforma", () => {
    const f = { balanceMinor: 5_000_000, floorMinor: 1_000_000, wholeRupees: false };
    expect(payAmountVerdict({ ...f, amountMinor: 5_000_000 })).toEqual({ ok: true });
    expect(payAmountVerdict({ ...f, amountMinor: 1_000_000 })).toEqual({ ok: true });
    expect(payAmountVerdict({ ...f, amountMinor: 999_999 })).toEqual({
      ok: false,
      code: "amount_below_minimum",
      minimumMinor: 1_000_000,
    });
    expect(payAmountVerdict({ ...f, amountMinor: 5_000_001 })).toEqual({
      ok: false,
      code: "amount_above_balance",
      balanceMinor: 5_000_000,
    });
    expect(payAmountVerdict({ ...f, amountMinor: 1_000_050, wholeRupees: true })).toEqual({
      ok: false,
      code: "amount_not_whole_rupee",
    });
    // A balance under the floor: the minimum is the whole balance.
    expect(payAmountVerdict({ ...f, balanceMinor: 300_000, amountMinor: 299_999 })).toEqual({
      ok: false,
      code: "amount_below_minimum",
      minimumMinor: 300_000,
    });
    expect(payAmountVerdict({ ...f, amountMinor: 0 })).toMatchObject({ code: "amount_below_minimum" });
    expect(payAmountVerdict({ ...f, amountMinor: 1.5 })).toMatchObject({ code: "amount_below_minimum" });
    expect(onlineMinimumOf(1_000_000, 300_000)).toBe(300_000);
    // Early check 1, finding 4: a floor under ₹1 (or 0) never lets 1 to 99 paise through.
    expect(onlineMinimumOf(0, 300_000)).toBe(100);
    expect(onlineMinimumOf(50, 300_000)).toBe(100);
    expect(onlineMinimumOf(0, 100)).toBe(100);
    expect(
      payAmountVerdict({ amountMinor: 99, balanceMinor: 300_000, floorMinor: 0, wholeRupees: false }),
    ).toEqual({
      ok: false,
      code: "amount_below_minimum",
      minimumMinor: 100,
    });
  });

  it("agrees with the rule restated, for any amounts", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10, max: 20_000_000 }),
        fc.integer({ min: 1, max: 20_000_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.boolean(),
        (amountMinor, balanceMinor, floorMinor, wholeRupees) => {
          const v = payAmountVerdict({ amountMinor, balanceMinor, floorMinor, wholeRupees });
          const min = Math.min(Math.max(floorMinor, 100), balanceMinor);
          const ok =
            amountMinor > 0 &&
            amountMinor <= balanceMinor &&
            amountMinor >= min &&
            (!wholeRupees || amountMinor % 100 === 0);
          expect(v.ok).toBe(ok);
          if (!v.ok && v.code === "amount_above_balance") expect(amountMinor).toBeGreaterThan(balanceMinor);
          if (!v.ok && v.code === "amount_below_minimum") expect(v.minimumMinor).toBe(min);
        },
      ),
    );
  });

  it("the full balance is always accepted (whole rupees on a payable proforma)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 100, max: 5_000_000 }),
        (rupees, floor) => {
          expect(
            payAmountVerdict({
              amountMinor: rupees * 100,
              balanceMinor: rupees * 100,
              floorMinor: floor,
              wholeRupees: true,
            }),
          ).toEqual({ ok: true });
        },
      ),
    );
  });
});

describe("the review kinds (07-ZI line 20)", () => {
  it("are listed once each", () => {
    expect(new Set(REVIEW_KINDS).size).toBe(REVIEW_KINDS.length);
    expect(REVIEW_KINDS).toContain("advance_blocked");
  });
});

// ---- M6.3: the rule table and Stripe's row [ADM-PAY-01, POR-06, L1, L9, L14, Q1 A, Q2 A; m6.3 run file B, I] -----------------------------------------------

const usdDoc: PayableDoc = { ...doc, type: "export_invoice", currency: "USD", balanceMinor: 500_00 };
const overseas: PayableClient = { country: "US", gstStatus: "overseas", anonymised: false };

describe("ONLINE_RULES and payableOnline for Stripe [L1, L14]", () => {
  it("the table: Razorpay INR domestic, Stripe USD overseas; the providers are listed once", () => {
    expect(ONLINE_RULES.razorpay).toMatchObject({ currency: "INR", clients: "domestic", minMinor: 100 });
    expect([...ONLINE_RULES.razorpay.types]).toEqual([...ONLINE_PAYABLE_TYPES]);
    expect(ONLINE_RULES.stripe).toEqual({
      currency: "USD",
      clients: "overseas",
      types: ["export_invoice", "debit_note", "proforma"],
      minMinor: 50,
      wholeUnitsOnProforma: false,
    });
    expect(ONLINE_RULES.stripe.minMinor).toBe(STRIPE_MIN_AMOUNT_MINOR);
    expect(new Set(ONLINE_PROVIDERS).size).toBe(ONLINE_PROVIDERS.length);
    expect(isOnlineProvider("stripe")).toBe(true);
    expect(isOnlineProvider("paypal")).toBe(false);
  });

  it("an export invoice, a USD debit note and a USD proforma (cents allowed) of an overseas client", () => {
    expect(payableOnline(usdDoc, overseas, "stripe")).toEqual({ ok: true });
    expect(payableOnline({ ...usdDoc, type: "debit_note" }, overseas, "stripe")).toEqual({ ok: true });
    expect(payableOnline({ ...usdDoc, type: "proforma", balanceMinor: 123_463 }, overseas, "stripe")).toEqual(
      { ok: true },
    );
    // An Indian-registered client with an `overseas` GST status is overseas (the exact complement of domestic).
    expect(payableOnline(usdDoc, { ...overseas, country: "IN" }, "stripe")).toEqual({ ok: true });
  });

  it.each([
    ["type_not_payable", { type: "tax_invoice" }, {}],
    ["client_domestic", {}, { country: "IN", gstStatus: "registered" }],
    ["not_usd", { currency: "INR" }, {}],
    ["client_anonymised", {}, { anonymised: true }],
    ["payment_pending", { type: "proforma", paymentPending: true }, {}],
    ["below_gateway_minimum", { balanceMinor: 49 }, {}],
    ["nothing_due", { balanceMinor: 0 }, {}],
  ] as const)("Stripe refuses %s", (reason, d, c) => {
    expect(payableOnline({ ...usdDoc, ...d }, { ...overseas, ...c }, "stripe")).toEqual({
      ok: false,
      code: "not_payable_online",
      reason,
    });
  });

  it("Razorpay refuses a USD document of an overseas client, and an unknown provider takes nothing", () => {
    expect(payableOnline(usdDoc, overseas, "razorpay")).toMatchObject({ reason: "type_not_payable" });
    expect(payableOnline({ ...usdDoc, type: "debit_note" }, overseas, "razorpay")).toMatchObject({
      reason: "client_overseas",
    });
    expect(payableOnline(doc, client, "paypal" as never)).toMatchObject({ reason: "type_not_payable" });
  });

  it("with limits: refused only when even the minimum is above the online maximum", () => {
    const limits = { floorMinor: DEFAULT_USD_PART_FLOOR_MINOR, maxMinor: DEFAULT_ONLINE_MAX_USD_MINOR };
    expect(payableOnline({ ...usdDoc, balanceMinor: 90_000_00 }, overseas, "stripe", limits)).toEqual({
      ok: true,
    });
    expect(payableOnline(usdDoc, overseas, "stripe", { floorMinor: 300_00, maxMinor: 200_00 })).toMatchObject(
      { reason: "above_gateway_maximum" },
    );
    // The balance below the floor: the minimum is the balance, under the maximum.
    expect(payableOnline(usdDoc, overseas, "stripe", { floorMinor: 900_00, maxMinor: 600_00 })).toEqual({
      ok: true,
    });
    expect(payableOnline(usdDoc, overseas, "stripe", { floorMinor: 300_00, maxMinor: null })).toEqual({
      ok: true,
    });
  });

  it("agrees with the table restated, for any document, client and provider", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ONLINE_PROVIDERS),
        fc.constantFrom("tax_invoice", "export_invoice", "debit_note", "proforma", "credit_note"),
        fc.constantFrom("INR", "USD"),
        fc.constantFrom("issued", "partially_paid", "converted", "paid", "void"),
        fc.integer({ min: -5, max: 2_000_000 }),
        fc.constantFrom("IN", "US", "AE"),
        fc.constantFrom("registered", "unregistered", "overseas"),
        fc.boolean(),
        fc.boolean(),
        (provider, type, currency, status, balanceMinor, country, gstStatus, anonymised, pending) => {
          const r = payableOnline(
            { type, currency, frozen: true, status, withdrawn: false, balanceMinor, paymentPending: pending },
            { country, gstStatus, anonymised },
            provider,
          );
          const rule = ONLINE_RULES[provider];
          const domestic = country === "IN" && gstStatus !== "overseas";
          const ok =
            rule.types.includes(type) &&
            !anonymised &&
            domestic === (rule.clients === "domestic") &&
            currency === rule.currency &&
            status !== "void" &&
            (type !== "proforma" || status === "issued" || status === "converted") &&
            !pending &&
            balanceMinor >= rule.minMinor &&
            (!rule.wholeUnitsOnProforma || type !== "proforma" || balanceMinor % 100 === 0);
          expect(r.ok).toBe(ok);
        },
      ),
    );
  });
});

describe("payAmountVerdict's online maximum [L9, Q2 A]", () => {
  const f = { balanceMinor: 90_000_00, floorMinor: DEFAULT_USD_PART_FLOOR_MINOR, wholeRupees: false };
  it("refuses above the maximum with the limit, and keeps the floor and cents", () => {
    expect(payAmountVerdict({ ...f, amountMinor: 25_000_00, maxMinor: 25_000_00 })).toEqual({ ok: true });
    expect(payAmountVerdict({ ...f, amountMinor: 25_000_01, maxMinor: 25_000_00 })).toEqual({
      ok: false,
      code: "amount_above_maximum",
      maximumMinor: 25_000_00,
    });
    expect(payAmountVerdict({ ...f, amountMinor: 99_99, maxMinor: 25_000_00 })).toEqual({
      ok: false,
      code: "amount_below_minimum",
      minimumMinor: 100_00,
    });
    expect(payAmountVerdict({ ...f, amountMinor: 123_45, maxMinor: 25_000_00 })).toEqual({ ok: true });
    // Above the balance is said first; a null maximum is no maximum.
    expect(payAmountVerdict({ ...f, amountMinor: 90_000_01, maxMinor: 25_000_00 })).toMatchObject({
      code: "amount_above_balance",
    });
    expect(payAmountVerdict({ ...f, amountMinor: 80_000_00, maxMinor: null })).toEqual({ ok: true });
  });

  it("the defaults: USD 100 and USD 25,000, the settings' own", () => {
    expect(DEFAULT_USD_PART_FLOOR_MINOR).toBe(SETTINGS_DEFAULTS.payment_terms.onlineMinPartialUsdMinor);
    expect(DEFAULT_ONLINE_MAX_USD_MINOR).toBe(SETTINGS_DEFAULTS.payment_terms.overseasOnlineMaxUsdMinor);
    expect(DEFAULT_USD_PART_FLOOR_MINOR).toBe(10_000);
    expect(DEFAULT_ONLINE_MAX_USD_MINOR).toBe(2_500_000);
  });
});

describe("storedFloorOf [ADM-SET-05; fix round 3 item 1]", () => {
  it("is the settings default when never saved, the stored whole number otherwise, null when unreadable", () => {
    expect(DEFAULT_PART_FLOOR_MINOR).toBe(SETTINGS_DEFAULTS.payment_terms.razorpayMinPartialInrMinor);
    expect(storedFloorOf(null)).toBe(DEFAULT_PART_FLOOR_MINOR);
    expect(storedFloorOf(undefined)).toBe(DEFAULT_PART_FLOOR_MINOR);
    expect(storedFloorOf(0)).toBe(0);
    expect(storedFloorOf(250_000)).toBe(250_000);
    for (const bad of [-1, 1.5, "1000", Number.NaN, 2 ** 60, true, {}]) expect(storedFloorOf(bad)).toBeNull();
  });
});
