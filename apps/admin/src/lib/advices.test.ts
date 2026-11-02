// M6.4 PayPal on the admin screens [ADM-PAY-01, ADM-PAY-07, ADM-INV-17; run file G3 to G5]: the "Add advice" form's checks, "Link payments"' limit of 50, the
// advice refusals' words, and the PayPal lines of the Payments panel and "Needs review" (S1, S2, S3, S5), all pure, so tested without a browser.
import { formatMoney, money } from "@techaust/core/money";
import { describe, expect, it } from "vitest";
import advicesRoutes from "../../worker/advices.ts?raw";
import { RequestError } from "../api.ts";
import {
  ADVICE_LINK_MAX,
  type AdviceForm,
  adviceErrorText,
  firstAdviceError,
  KINDS_FOR,
  periodText,
  readAdviceForm,
  toggled,
  withAll,
  withoutProviderOf,
} from "./advices.ts";
import { ADVICE_KIND_LABELS, ZN, ZN_UI } from "./copy-zn.ts";
import { DATE_INVALID } from "./date-field.ts";
import { feeCurrencyOf, gatewayLine, gatewayName, itemReason, LINK_CHIPS, payPalChip } from "./gateway.ts";

const TODAY = "2026-11-02";
const form = (patch: Partial<AdviceForm> = {}): AdviceForm => ({
  provider: "paypal",
  kind: "fira",
  ref: "FIRA-SAMPLE-0001",
  issuedOn: "2026-10-31",
  periodFrom: "",
  periodTo: "",
  inrTotal: "",
  note: "",
  ...patch,
});

describe("Add advice: the form's checks [ADM-INV-17]", () => {
  it("a full form reads as the route's body, optional parts as null", () => {
    const r = readAdviceForm(
      form({ ref: "  FIRA-1 ", periodFrom: "2026-10-01", periodTo: "2026-10-07", inrTotal: "84,512.40" }),
      {},
      TODAY,
    );
    expect(r).toEqual({
      ok: true,
      body: {
        provider: "paypal",
        kind: "fira",
        adviceRef: "FIRA-1",
        issuedOn: "2026-10-31",
        periodFrom: "2026-10-01",
        periodTo: "2026-10-07",
        inrTotalMinor: 8_451_240,
        note: null,
      },
    });
    const bare = readAdviceForm(form(), {}, TODAY);
    expect(bare.ok && bare.body).toMatchObject({
      periodFrom: null,
      periodTo: null,
      inrTotalMinor: null,
      note: null,
    });
  });

  it("the reference and the issue day are needed; the day is never after today", () => {
    const r = readAdviceForm(form({ ref: "   ", issuedOn: "" }), {}, TODAY);
    expect(r).toEqual({ ok: false, errors: { ref: ZN_UI.refMissing, issuedOn: ZN_UI.issuedMissing } });
    expect(readAdviceForm(form({ issuedOn: "2026-11-03" }), {}, TODAY)).toEqual({
      ok: false,
      errors: { issuedOn: ZN_UI.issuedFuture },
    });
    expect(readAdviceForm(form({ issuedOn: TODAY }), {}, TODAY).ok).toBe(true);
  });

  it("a date the field can't read is its own error first (the owner's line), whatever the value", () => {
    const r = readAdviceForm(form(), { issuedOn: true, periodTo: true }, TODAY);
    expect(r).toEqual({ ok: false, errors: { issuedOn: DATE_INVALID, periodTo: DATE_INVALID } });
  });

  it("the period is in order when both ends are set; one end alone is allowed", () => {
    expect(readAdviceForm(form({ periodFrom: "2026-10-07", periodTo: "2026-10-01" }), {}, TODAY)).toEqual({
      ok: false,
      errors: { periodTo: ZN_UI.periodOrder },
    });
    expect(readAdviceForm(form({ periodFrom: "2026-10-07" }), {}, TODAY).ok).toBe(true);
    expect(readAdviceForm(form({ periodTo: "2026-10-07" }), {}, TODAY).ok).toBe(true);
  });

  it("the INR total is optional and above zero when given", () => {
    expect(readAdviceForm(form({ inrTotal: "0" }), {}, TODAY)).toEqual({
      ok: false,
      errors: { inrTotal: ZN_UI.inrTotalZero },
    });
    const bad = readAdviceForm(form({ inrTotal: "12.345" }), {}, TODAY);
    expect(bad.ok).toBe(false);
  });

  it("focus goes to the first field in error, in the form's order", () => {
    expect(firstAdviceError({ inrTotal: "x", ref: "y" })).toBe("ref");
    expect(firstAdviceError({ periodTo: "x" })).toBe("periodTo");
    expect(firstAdviceError({})).toBeNull();
  });

  it("every issuer offers its kinds, each with its printed name", () => {
    for (const kinds of Object.values(KINDS_FOR))
      for (const k of kinds) expect(ADVICE_KIND_LABELS[k]).toBeTruthy();
    expect(KINDS_FOR.paypal[0]).toBe("fira");
    expect(KINDS_FOR.bank[0]).toBe("firc");
  });

  it("the kinds and issuers are the route's own lists", () => {
    expect(advicesRoutes).toContain(`ADVICE_PROVIDERS = ["paypal", "stripe", "bank"]`);
    expect(advicesRoutes).toContain(
      `ADVICE_KINDS = ["efira", "fira", "firc", "brc", "settlement_report", "other"]`,
    );
    expect(Object.keys(ADVICE_KIND_LABELS)).toEqual([
      "efira",
      "fira",
      "firc",
      "brc",
      "settlement_report",
      "other",
    ]);
  });
});

describe("Link payments: at most 50, the advice's own payments [ADM-INV-17, L30]", () => {
  it("a bank advice lists the bank transfers from abroad; a gateway's its own", () => {
    expect(withoutProviderOf("bank")).toBe("manual");
    expect(withoutProviderOf("paypal")).toBe("paypal");
    expect(withoutProviderOf("stripe")).toBe("stripe");
  });

  it("a tick past the limit is refused and said; untick always works", () => {
    const full = Array.from({ length: ADVICE_LINK_MAX }, (_, i) => `p${i}`);
    expect(toggled(full, "extra")).toEqual({ picked: full, refused: true });
    expect(toggled(full, "p3").picked).toHaveLength(ADVICE_LINK_MAX - 1);
    expect(toggled([], "a")).toEqual({ picked: ["a"], refused: false });
    expect(ADVICE_LINK_MAX).toBe(50);
    expect(advicesRoutes).toContain("z.maxLength(ADVICE_LINK_MAX)");
  });

  it("Select all shown adds the rest in order, never past the limit", () => {
    expect(withAll(["b"], ["a", "b", "c"])).toEqual(["b", "a", "c"]);
    const shown = Array.from({ length: 60 }, (_, i) => `s${i}`);
    expect(withAll([], shown)).toHaveLength(ADVICE_LINK_MAX);
  });

  it("the period reads in words, one end alone too", () => {
    const d = (iso: string) => `[${iso}]`;
    expect(periodText("2026-10-01", "2026-10-07", d)).toBe("[2026-10-01] to [2026-10-07]");
    expect(periodText("2026-10-01", null, d)).toBe("From [2026-10-01]");
    expect(periodText(null, "2026-10-07", d)).toBe("To [2026-10-07]");
    expect(periodText(null, null, d)).toBeNull();
  });
});

describe("the advice refusals say the server's words (S11) [ADM-INV-17]", () => {
  it("each advice code shows its message; others fall back to the payment screens' words", () => {
    for (const code of [
      "advice_ref_exists",
      "file_already_set",
      "payment_not_confirmed",
      "wrong_provider",
      "already_linked",
      "client_anonymised",
      "link_not_on",
    ])
      expect(adviceErrorText(new RequestError(409, code, `Server says ${code}.`, null))).toBe(
        `Server says ${code}.`,
      );
    expect(adviceErrorText(new RequestError(0, "network", "x", null))).not.toBe("x");
  });
});

describe("PayPal on the Payments panel and in Needs review (S1, S2, S3, S5) [ADM-PAY-01, ADM-PAY-07]", () => {
  it("S1: a PayPal payment's line names its capture; its fee is in dollars", () => {
    expect(gatewayLine("paypal", "paypal", "5TY05013RG002845M")).toBe("PayPal · 5TY05013RG002845M");
    expect(gatewayLine("paypal", "card", null)).toBe("PayPal");
    expect(gatewayName("paypal")).toBe("PayPal");
    expect(feeCurrencyOf("paypal")).toBe("USD");
    expect(feeCurrencyOf("razorpay")).toBe("INR");
  });

  it("S2: the checkout chips, with Awaiting PayPal and Failed", () => {
    expect(payPalChip("capture_pending")).toMatchObject({ label: "Awaiting PayPal", tone: "warning" });
    expect(LINK_CHIPS.capture_pending.label).toBe("Awaiting PayPal");
    expect(payPalChip("failed")).toMatchObject({ label: "Failed", tone: "danger" });
    expect(payPalChip("live").label).toBe("Live");
    expect(payPalChip("stale").label).toBe("Replaced");
    expect(payPalChip("paid").label).toBe("Paid");
    expect(payPalChip("expired").label).toBe("Expired");
    expect(payPalChip("cancelled").label).toBe("Cancelled");
    expect(ZN.checkNow).toBe("Check now");
  });

  it("S3 and S5 carry PayPal's own code from the item's facts", () => {
    const held = itemReason({
      kind: "capture_pending",
      provider: "paypal",
      currency: "USD",
      amount_minor: 120_000,
      facts: { code: "PENDING_REVIEW" },
    });
    expect(held).toContain("PENDING_REVIEW");
    const refused = itemReason({
      kind: "capture_refused",
      provider: "paypal",
      currency: "USD",
      amount_minor: null,
      facts: { code: "TRANSACTION_REFUSED" },
    });
    expect(refused).toContain("TRANSACTION_REFUSED");
  });

  it("S6 names the amount in dollars; every new kind has its own line, never the fallback", () => {
    const reversed = itemReason({
      kind: "reversed_after_confirm",
      provider: "paypal",
      currency: "USD",
      amount_minor: 120_000,
      facts: { paidMinor: 120_000 },
    });
    expect(reversed).toContain(formatMoney(money(120_000, "USD")));
    for (const kind of [
      "capture_pending",
      "capture_denied",
      "capture_refused",
      "reversed_after_confirm",
      "refunded_outside",
      "late_capture",
    ])
      expect(
        itemReason({ kind, provider: "paypal", currency: "USD", amount_minor: 100, facts: {} }),
      ).not.toBe("Check this payment.");
  });
});
