// PayPal, pure [ADM-PAY-01, -03, -04, -07, -11, -12, JOB-HOOK-01..03, POR-06; m6.4 run file B, I and "Step 0 results"]: the live guard and the origins, the money
// text both ways, the order request, the readers (a whitelist: no payer data), the judge with RA-38's country rule, the capture errors of Step 0.4 row 10, the
// event reader and its facts, the offline signature (CRC32, the signed text, the certificate URL allow-list, a certificate built here with a generated RSA key and
// read by the pure DER reader), and the payment-row mapping. No test calls PayPal: the bodies are fixtures shaped like PayPal's Orders v2 spec. All names,
// ids and amounts are invented test data.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "../src/ids.ts";
import { REVIEW_KINDS, type ReviewKind } from "../src/online-pay.ts";
import { checkProviderContract, type PaymentProvider, PROVIDER_EVENT_TYPES } from "../src/payments.ts";
import {
  CAPTURE_ERRORS,
  captureErrorOf,
  certParts,
  certValidAt,
  crc32,
  importPayPalCertKey,
  invoiceIdCheckoutTail,
  isPayPalApproveUrl,
  isPayPalCertUrl,
  isPayPalWebhookId,
  judgePayPalCapture,
  orderRequestOf,
  PAYPAL_API_ORIGINS,
  PAYPAL_BRAND_NAME,
  PAYPAL_CAPTURE_GRACE_MS,
  PAYPAL_CLAIM_STALE_MS,
  PAYPAL_EVENT_TYPES,
  PAYPAL_INVOICE_ID_FACT,
  PAYPAL_JUDGE_VERDICTS,
  PAYPAL_ORDER_LIFETIME_MS,
  type PayPalCapture,
  type PayPalCheckoutRow,
  type PayPalOrder,
  type PayPalReviewVerdict,
  parsePayPalEvent,
  payPalCaptureRequestId,
  payPalDescriptionOf,
  payPalEventFacts,
  payPalEventIdOf,
  payPalEventOwnership,
  payPalExportReceipt,
  payPalFeeFactsOf,
  payPalModeOf,
  payPalModeOfOrigin,
  payPalOrderRequestId,
  payPalPaymentRowId,
  payPalReceivedOn,
  payPalReferenceNorm,
  payPalReturnMarkers,
  payPalSignedMessage,
  paypalOriginFor,
  pemToDer,
  readPayPalCapture,
  readPayPalOrder,
  SIMULATOR_WEBHOOK_ID,
  usdMinorToValue,
  valueToUsdMinor,
  verifyPayPalSignature,
} from "../src/paypal.ts";

const enc = new TextEncoder();
const CHECKOUT = uuidv7(Date.UTC(2026, 10, 2, 6));
const ORDER = "5O190127TN364715T";
const CAPTURE = "2GG279541U471931P";

// ---- origins and the live guard ---------------------------------------------------------------------------------------------------------------------

describe("the origins and the live guard [ADM-PAY-11, CLAUDE.md rule 7]", () => {
  it("test mode is the sandbox; live only with the go-live flag exactly true; anything else is null (zero fetches)", () => {
    expect(paypalOriginFor("test", false)).toBe("https://api-m.sandbox.paypal.com");
    expect(paypalOriginFor("live", false)).toBeNull();
    expect(paypalOriginFor("live", "false")).toBeNull();
    expect(paypalOriginFor("live", undefined)).toBeNull();
    expect(paypalOriginFor("live", "true")).toBe(PAYPAL_API_ORIGINS.live);
    expect(paypalOriginFor("off", true)).toBeNull();
    expect(paypalOriginFor(undefined, true)).toBeNull();
    expect(payPalModeOfOrigin(PAYPAL_API_ORIGINS.test)).toBe("test");
    expect(payPalModeOfOrigin(PAYPAL_API_ORIGINS.live)).toBe("live");
    expect(payPalModeOfOrigin("https://api-m.paypal.com.evil")).toBeNull();
  });

  it("a provider built on the guard passes the contract with live blocked and makes no fetch", async () => {
    let fetches = 0;
    const call = async <T>(mode: string, v: T) => {
      const origin = paypalOriginFor(mode, false);
      if (!origin) return { ok: false, code: "live_not_allowed" } as const;
      fetches += 1;
      return { ok: true, value: v } as const;
    };
    const provider: PaymentProvider = {
      name: "paypal",
      mode: "live",
      createCheckout: () => call("live", { providerRef: ORDER, redirectUrl: "x", expiresAt: 1 }),
      verifyWebhook: async () => ({ ok: false, code: "invalid_signature" }),
      parseEvent: () => ({ ok: false, code: "invalid_event" }),
      fetchStatus: () => call("live", null as never),
      fetchCheckout: () => call("live", null as never),
      cancelCheckout: () => call("live", true as const),
      refund: async () => ({ ok: false, code: "unsupported" }),
    };
    expect(await checkProviderContract(provider, { liveAllowed: false })).toEqual([]);
    expect(fetches).toBe(0);
  });
});

// ---- money ------------------------------------------------------------------------------------------------------------------------------------------

describe("money as PayPal's value text, integers only", () => {
  it("minor units to text and back (fast-check round trip)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9_999_999_999_999 }), (n) => {
        const v = usdMinorToValue(n);
        expect(v).toMatch(/^\d+\.\d{2}$/);
        expect(valueToUsdMinor(v)).toBe(n);
      }),
    );
    expect(usdMinorToValue(1)).toBe("0.01");
    expect(usdMinorToValue(1234)).toBe("12.34");
    expect(usdMinorToValue(1205)).toBe("12.05");
    expect(usdMinorToValue(250_000_00)).toBe("250000.00");
  });

  it("refuses what isn't a positive whole number of cents", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(usdMinorToValue(bad)).toBeNull();
  });

  it("pads to two decimals and refuses signs, exponents, spaces, 3+ decimals, empty and 33 characters", () => {
    expect(valueToUsdMinor("10")).toBe(1000);
    expect(valueToUsdMinor("10.5")).toBe(1050);
    expect(valueToUsdMinor("0.01")).toBe(1);
    expect(valueToUsdMinor("0")).toBe(0);
    for (const bad of [
      "1.234",
      "-1.00",
      "1e2",
      "+1",
      " 1.00",
      "",
      "01.00",
      ".5",
      "1.",
      "1".repeat(33),
      100,
      null,
    ])
      expect(valueToUsdMinor(bad), String(bad)).toBeNull();
  });
});

// ---- the order request ----------------------------------------------------------------------------------------------------------------------------------

const RETURN = `https://portal.example.test/invoices/doc1?pay=paypal&c=${CHECKOUT}`;
const CANCEL = `https://portal.example.test/invoices/doc1?pay=paypal-cancel&c=${CHECKOUT}`;
const input = {
  checkoutId: CHECKOUT,
  amountMinor: 1234_56,
  documentNumber: "TH/EX/2627/7",
  documentType: "export_invoice" as const,
  returnUrl: RETURN,
  cancelUrl: CANCEL,
  brandName: PAYPAL_BRAND_NAME,
};

describe("orderRequestOf [L3, L10, L19; 07-ZN line 15]", () => {
  it("one USD purchase unit marked with our checkout id, PayPal's hosted page, no payer or shipping field", () => {
    const r = orderRequestOf(input);
    if (!r.ok) throw new Error(r.code);
    expect(r.requestId).toBe(`ord-${CHECKOUT}`);
    expect(payPalOrderRequestId(CHECKOUT)).toBe(r.requestId);
    expect(r.body).toEqual({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: CHECKOUT,
          custom_id: CHECKOUT,
          invoice_id: `TH/EX/2627/7-${CHECKOUT.slice(-12)}`,
          description: "Invoice TH/EX/2627/7",
          amount: { currency_code: "USD", value: "1234.56" },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "TecHaust Technologies",
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            landing_page: "NO_PREFERENCE",
            payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
            return_url: RETURN,
            cancel_url: CANCEL,
          },
        },
      },
    });
    const text = JSON.stringify(r.body);
    for (const field of ["payer", "shipping", "customer", "vault", "email", "address"])
      expect(text).not.toContain(`"${field}":`);
    expect(r.body.purchase_units[0].invoice_id.length).toBeLessThanOrEqual(127);
  });

  it("the page's words: Invoice, Proforma invoice, Debit note (07-ZN line 15)", () => {
    expect(payPalDescriptionOf("export_invoice", "A1")).toBe("Invoice A1");
    expect(payPalDescriptionOf("proforma", "A1")).toBe("Proforma invoice A1");
    expect(payPalDescriptionOf("debit_note", "A1")).toBe("Debit note A1");
    const p = orderRequestOf({ ...input, documentType: "proforma" });
    expect(p.ok && p.body.purchase_units[0].description).toBe("Proforma invoice TH/EX/2627/7");
  });

  it("the emailed link's return and cancel pages are accepted too (L19)", () => {
    const m = payPalReturnMarkers(CHECKOUT);
    const ok = orderRequestOf({
      ...input,
      returnUrl: `https://portal.example.test/pay/return${m.return[1]}`,
      cancelUrl: `https://portal.example.test/pay/return${m.cancel[1]}`,
    });
    expect(ok.ok).toBe(true);
    expect(orderRequestOf({ ...input, returnUrl: `http://localhost:5174/x${m.return[0]}` }).ok).toBe(true);
  });

  it("refusals: the amount, the references, the brand, the URLs", () => {
    const code = (o: Partial<typeof input>) => {
      const r = orderRequestOf({ ...input, ...o });
      return r.ok ? "ok" : r.code;
    };
    expect(code({ amountMinor: 0 })).toBe("amount_invalid");
    expect(code({ amountMinor: 1.5 })).toBe("amount_invalid");
    expect(code({ amountMinor: 1 })).toBe("ok");
    expect(code({ checkoutId: "not-a-uuid" })).toBe("reference_invalid");
    expect(code({ checkoutId: "019a0000-0000-4000-8000-000000000001" })).toBe("reference_invalid");
    expect(code({ documentNumber: "TH/EX/2627/7|x" })).toBe("reference_invalid");
    expect(code({ documentNumber: "A".repeat(17) })).toBe("reference_invalid");
    expect(code({ documentType: "tax_invoice" as never })).toBe("reference_invalid");
    expect(code({ brandName: " " })).toBe("brand_invalid");
    expect(code({ brandName: "B".repeat(128) })).toBe("brand_invalid");
    for (const bad of [
      `http://portal.example.test/invoices/doc1?pay=paypal&c=${CHECKOUT}`,
      `https://u:p@portal.example.test/invoices/doc1?pay=paypal&c=${CHECKOUT}`,
      `https://portal.example.test/invoices/doc1?pay=paypal&c=${CHECKOUT}#x`,
      "https://portal.example.test/invoices/doc1?pay=paypal",
      `https://portal.example.test/invoices/doc1?pay=paypal&c=${uuidv7()}`,
      `https://portal.example.test/invoices/doc1?pay=paypal&c=${CHECKOUT}&token=x`,
      "not a url",
      `https://portal.example.test/${"x".repeat(2000)}?pay=paypal&c=${CHECKOUT}`,
    ])
      expect(code({ returnUrl: bad }), bad.slice(0, 60)).toBe("url_invalid");
    expect(code({ cancelUrl: RETURN })).toBe("url_invalid");
  });

  it("the request ids: one per create, one per capture claim, both under 108 characters", () => {
    expect(payPalCaptureRequestId(CHECKOUT, 1_793_600_000_000)).toBe(`cap-${CHECKOUT}-1793600000000`);
    expect(payPalCaptureRequestId(CHECKOUT, 1_793_600_000_000).length).toBeLessThanOrEqual(108);
    expect(PAYPAL_ORDER_LIFETIME_MS).toBe(9_000_000);
    expect(PAYPAL_ORDER_LIFETIME_MS + PAYPAL_CAPTURE_GRACE_MS).toBe(3 * 3_600_000);
    expect(PAYPAL_CLAIM_STALE_MS).toBe(120_000);
  });
});

describe("isPayPalApproveUrl [L17]", () => {
  it("PayPal's checkout page on the two www hosts only, with this order's token", () => {
    const ok = `https://www.sandbox.paypal.com/checkoutnow?token=${ORDER}`;
    expect(isPayPalApproveUrl(ok)).toBe(true);
    expect(isPayPalApproveUrl(ok, ORDER)).toBe(true);
    expect(isPayPalApproveUrl(ok, "OTHER1")).toBe(false);
    expect(isPayPalApproveUrl(`https://www.paypal.com/checkoutnow?token=${ORDER}`, ORDER)).toBe(true);
    for (const bad of [
      `https://paypal.com/checkoutnow?token=${ORDER}`,
      `https://www.paypal.com.evil.test/checkoutnow?token=${ORDER}`,
      `https://www.paypal.com:8443/checkoutnow?token=${ORDER}`,
      `http://www.paypal.com/checkoutnow?token=${ORDER}`,
      `https://www.paypal.com/signin?token=${ORDER}`,
      `https://www.paypal.com/checkoutnow?token=${ORDER}#x`,
      `https://a@www.paypal.com/checkoutnow?token=${ORDER}`,
      `https://www.paypal.com/checkoutnow?token=${"A".repeat(200)}`,
      "nope",
      null,
    ])
      expect(isPayPalApproveUrl(bad), String(bad).slice(0, 60)).toBe(false);
  });
});

// ---- readers -------------------------------------------------------------------------------------------------------------------------------------------

const captureJson = (o: Record<string, unknown> = {}) => ({
  id: CAPTURE,
  status: "COMPLETED",
  amount: { currency_code: "USD", value: "1234.56" },
  final_capture: true,
  seller_receivable_breakdown: {
    gross_amount: { currency_code: "USD", value: "1234.56" },
    paypal_fee: { currency_code: "USD", value: "54.12" },
    net_amount: { currency_code: "USD", value: "1180.44" },
    receivable_amount: { currency_code: "INR", value: "98000.00" },
    exchange_rate: { source_currency: "USD", target_currency: "INR", value: "83.0219" },
  },
  invoice_id: `TH/EX/2627/7-${CHECKOUT.slice(-12)}`,
  custom_id: CHECKOUT,
  create_time: "2026-11-02T18:45:00Z",
  update_time: "2026-11-02T18:45:00Z",
  supplementary_data: { related_ids: { order_id: ORDER } },
  links: [{ href: `https://api.sandbox.paypal.com/v2/payments/captures/${CAPTURE}`, rel: "self" }],
  ...o,
});

const orderJson = (o: Record<string, unknown> = {}, capture: Record<string, unknown> = {}) => ({
  id: ORDER,
  intent: "CAPTURE",
  status: "COMPLETED",
  payment_source: {
    paypal: {
      email_address: "buyer@example.test",
      account_id: "QYR5Z8XDVJNXQ",
      name: { given_name: "Ada", surname: "Example" },
      address: { country_code: "US" },
    },
  },
  purchase_units: [
    {
      reference_id: CHECKOUT,
      custom_id: CHECKOUT,
      invoice_id: `TH/EX/2627/7-${CHECKOUT.slice(-12)}`,
      amount: { currency_code: "USD", value: "1234.56" },
      shipping: {
        name: { full_name: "Ada Example" },
        address: { address_line_1: "1 Example Road", country_code: "US" },
      },
      payments: { captures: [captureJson(capture)] },
    },
  ],
  payer: {
    name: { given_name: "Ada", surname: "Example" },
    email_address: "buyer@example.test",
    payer_id: "QYR5Z8XDVJNXQ",
    address: { country_code: "US" },
  },
  links: [
    { href: `https://www.sandbox.paypal.com/checkoutnow?token=${ORDER}`, rel: "payer-action", method: "GET" },
  ],
  ...o,
});

describe("the readers whitelist [ADM-PAY-12, L7]", () => {
  it("an order: its id, status, marks, amount, approval link, funding source, countries and captures; never payer data", () => {
    const o = readPayPalOrder(orderJson());
    expect(o).toEqual({
      id: ORDER,
      status: "COMPLETED",
      referenceId: CHECKOUT,
      customId: CHECKOUT,
      invoiceId: `TH/EX/2627/7-${CHECKOUT.slice(-12)}`,
      currency: "USD",
      amountMinor: 1234_56,
      payerActionUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${ORDER}`,
      fundingSource: "paypal",
      countries: ["US", "US"],
      captures: [readPayPalCapture(captureJson())],
    });
    const text = JSON.stringify(o);
    for (const personal of ["buyer@example.test", "Ada", "Example Road", "QYR5Z8XDVJNXQ", "83.0219"])
      expect(text).not.toContain(personal);
  });

  it("a capture: amounts, fee, net and receivable by currency, reason, final, created, marks, the order; no exchange rate", () => {
    const c = readPayPalCapture(captureJson({ status: "PENDING", status_details: { reason: "ECHECK" } }));
    expect(c).toEqual({
      id: CAPTURE,
      status: "PENDING",
      reason: "ECHECK",
      currency: "USD",
      amountMinor: 1234_56,
      finalCapture: true,
      createdAt: Date.UTC(2026, 10, 2, 18, 45),
      customId: CHECKOUT,
      invoiceId: `TH/EX/2627/7-${CHECKOUT.slice(-12)}`,
      orderId: ORDER,
      fee: { currency: "USD", minor: 54_12 },
      net: { currency: "USD", minor: 1180_44 },
      receivable: { currency: "INR", minor: 98_000_00 },
    });
  });

  it("the minimal create answer (no purchase unit) reads, with its approval link", () => {
    const o = readPayPalOrder({
      id: ORDER,
      status: "PAYER_ACTION_REQUIRED",
      links: [
        { href: `https://api.sandbox.paypal.com/v2/checkout/orders/${ORDER}`, rel: "self" },
        { href: `https://www.sandbox.paypal.com/checkoutnow?token=${ORDER}`, rel: "payer-action" },
      ],
    });
    expect(o).toMatchObject({ id: ORDER, customId: null, amountMinor: null, captures: [], countries: [] });
    expect(o?.payerActionUrl).toContain("checkoutnow");
    expect(o?.fundingSource).toBeNull();
    // An approval link on another host, or for another order, is not taken.
    const evil = readPayPalOrder({
      id: ORDER,
      status: "CREATED",
      links: [
        { href: `https://www.paypal.com.evil.test/checkoutnow?token=${ORDER}`, rel: "approve" },
        { href: "https://www.paypal.com/checkoutnow?token=OTHER", rel: "approve" },
      ],
    });
    expect(evil?.payerActionUrl).toBeNull();
  });

  it("a guest card and another source are told apart; a card's billing country is read; INR fee and amounts", () => {
    const card = readPayPalOrder(
      orderJson({
        payer: undefined,
        payment_source: { card: { last_digits: "1111", billing_address: { country_code: "GB" } } },
      }),
    );
    expect(card?.fundingSource).toBe("card");
    expect(card?.countries).toEqual(["GB"]);
    expect(JSON.stringify(card)).not.toContain("1111");
    // The card's issuing country (RA-38 fact (1), early check 1 finding 2): an India-issued card with a foreign billing address is held.
    const inCard = readPayPalOrder(
      orderJson({
        payer: undefined,
        payment_source: {
          card: {
            billing_address: { country_code: "GB" },
            bin_details: { bin_country_code: "IN", bin: "411111" },
          },
        },
      }),
    );
    expect(inCard?.countries).toEqual(["GB", "IN"]);
    expect(payPalExportReceipt(inCard?.countries ?? [])).toBe(false);
    expect(JSON.stringify(inCard)).not.toContain("411111");
    expect(readPayPalOrder(orderJson({ payment_source: { venmo: {} } }))?.fundingSource).toBe("other");
    expect(readPayPalOrder(orderJson({ payment_source: {} }))?.fundingSource).toBeNull();
    const eur = readPayPalCapture(captureJson({ amount: { currency_code: "EUR", value: "10.00" } }));
    expect(eur).toMatchObject({ currency: "EUR", amountMinor: null });
  });

  it("refuses a malformed answer rather than guess", () => {
    for (const bad of [
      null,
      [],
      {},
      { ...orderJson(), id: "lower" },
      { ...orderJson(), status: "UNKNOWN" },
      { ...orderJson(), purchase_units: [] },
      { ...orderJson(), purchase_units: [{}, {}] },
      { ...orderJson(), purchase_units: [{ amount: { currency_code: "USD", value: "1.234" } }] },
      { ...orderJson(), purchase_units: [{ payments: "x" }] },
      { ...orderJson(), purchase_units: [{ payments: { captures: "x" } }] },
      { ...orderJson(), purchase_units: [{ payments: { captures: [{}] } }] },
    ])
      expect(readPayPalOrder(bad)).toBeNull();
    for (const bad of [
      null,
      captureJson({ id: "lower" }),
      captureJson({ status: "VOIDED" }),
      captureJson({ amount: undefined }),
      captureJson({ create_time: "yesterday" }),
      captureJson({ final_capture: "yes" }),
      captureJson({ seller_receivable_breakdown: "x" }),
      captureJson({ seller_receivable_breakdown: { paypal_fee: { currency_code: "USD", value: "-1" } } }),
    ])
      expect(readPayPalCapture(bad)).toBeNull();
    // Absent extras are not errors.
    const plain = readPayPalCapture(
      captureJson({
        seller_receivable_breakdown: undefined,
        supplementary_data: undefined,
        final_capture: undefined,
      }),
    );
    expect(plain).toMatchObject({
      fee: null,
      net: null,
      receivable: null,
      orderId: null,
      finalCapture: null,
    });
  });
});

// ---- the judge ---------------------------------------------------------------------------------------------------------------------------------------

const row: PayPalCheckoutRow = { id: CHECKOUT, providerLinkId: ORDER, currency: "USD", amountMinor: 1234_56 };
const order = () => readPayPalOrder(orderJson()) as PayPalOrder;
const capture = (o: Record<string, unknown> = {}) => readPayPalCapture(captureJson(o)) as PayPalCapture;
const orderWith = (o: Record<string, unknown> = {}, c: Record<string, unknown> = {}) =>
  readPayPalOrder(orderJson(o, c)) as PayPalOrder;

describe("judgePayPalCapture [ADM-PAY-04, run file C steps 4 to 8; 08-C RA-38]", () => {
  it("ok when the capture, its order and our row agree", () => {
    expect(judgePayPalCapture(row, order(), capture())).toEqual({ ok: true });
  });

  it("every verdict, in order", () => {
    const v = (o: PayPalOrder | null, c: PayPalCapture, r: PayPalCheckoutRow = row) => {
      const j = judgePayPalCapture(r, o, c);
      return j.ok ? "ok" : j.verdict;
    };
    expect(v(order(), capture({ custom_id: uuidv7() }))).toBe("reference_mismatch");
    // A capture with no mark of its own is not refused when the order is the row's, carries our mark and lists it (early check 1 finding 1) …
    expect(v(orderWith({}, { custom_id: undefined }), capture({ custom_id: undefined }))).toBe("ok");
    // … but without the order, with an order that has no mark, or with an order that doesn't list it, it is a mismatch; both marks missing is one too.
    expect(v(null, capture({ custom_id: undefined }))).toBe("reference_mismatch");
    expect(
      v(
        orderWith({
          purchase_units: [
            {
              amount: { currency_code: "USD", value: "1234.56" },
              payments: { captures: [captureJson({ custom_id: undefined })] },
            },
          ],
        }),
        capture({ custom_id: undefined }),
      ),
    ).toBe("reference_mismatch");
    expect(
      v(orderWith({}, { id: "9XX00000000000000", custom_id: undefined }), capture({ custom_id: undefined })),
    ).toBe("reference_mismatch");
    expect(v(order(), capture({ supplementary_data: { related_ids: { order_id: "OTHER1" } } }))).toBe(
      "reference_mismatch",
    );
    expect(v(order(), capture(), { ...row, providerLinkId: null })).toBe("reference_mismatch");
    expect(v(order(), capture(), { ...row, providerLinkId: "OTHER1" })).toBe("reference_mismatch");
    expect(
      v(
        orderWith({
          purchase_units: [{ custom_id: uuidv7(), amount: { currency_code: "USD", value: "1234.56" } }],
        }),
        capture(),
      ),
    ).toBe("reference_mismatch");
    expect(v(orderWith({}, { id: "9XX00000000000000" }), capture())).toBe("order_mismatch");
    expect(v(order(), capture({ status: "PENDING" }))).toBe("capture_pending");
    expect(v(order(), capture({ status: "DECLINED" }))).toBe("capture_denied");
    expect(v(order(), capture({ status: "FAILED" }))).toBe("capture_denied");
    expect(v(order(), capture({ status: "REFUNDED" }))).toBe("capture_refunded");
    // M6–M7 audit AU6 (B1 M1): refunded in part before we first settled it, after RA-38's country test.
    expect(v(order(), capture({ status: "PARTIALLY_REFUNDED" }))).toBe("partly_refunded");
    expect(
      v(orderWith({ payer: { address: { country_code: "IN" } } }), capture({ status: "PARTIALLY_REFUNDED" })),
    ).toBe("not_export_receipt");
    expect(v(order(), capture({ final_capture: false }))).toBe("not_final");
    expect(v(orderWith({ payer: { address: { country_code: "IN" } } }), capture())).toBe(
      "not_export_receipt",
    );
    expect(v(orderWith({ payer: undefined, payment_source: { paypal: {} } }), capture())).toBe(
      "not_export_receipt",
    );
    // No order: no country is known, so the payment is held (the event path re-fetches the order).
    expect(v(null, capture())).toBe("not_export_receipt");
    expect(v(order(), capture(), { ...row, currency: "INR" })).toBe("currency_mismatch");
    expect(v(order(), capture({ amount: { currency_code: "EUR", value: "1234.56" } }))).toBe(
      "currency_mismatch",
    );
    expect(
      v(
        orderWith({
          purchase_units: [
            {
              custom_id: CHECKOUT,
              amount: { currency_code: "INR", value: "1234.56" },
              payments: { captures: [captureJson()] },
            },
          ],
        }),
        capture(),
      ),
    ).toBe("currency_mismatch");
    expect(v(order(), capture({ amount: { currency_code: "USD", value: "1234.55" } }))).toBe(
      "amount_mismatch",
    );
    expect(v(order(), capture(), { ...row, amountMinor: 1 })).toBe("amount_mismatch");
    expect(
      v(
        orderWith({
          purchase_units: [
            {
              custom_id: CHECKOUT,
              amount: { currency_code: "USD", value: "9.00" },
              payments: { captures: [captureJson()] },
            },
          ],
        }),
        capture(),
      ),
    ).toBe("amount_mismatch");
    expect(new Set(PAYPAL_JUDGE_VERDICTS).size).toBe(PAYPAL_JUDGE_VERDICTS.length);
  });

  it("RA-38: an export receipt needs a reported country and none of them India", () => {
    expect(payPalExportReceipt(["US"])).toBe(true);
    expect(payPalExportReceipt(["US", "GB"])).toBe(true);
    expect(payPalExportReceipt([])).toBe(false);
    expect(payPalExportReceipt(["IN"])).toBe(false);
    expect(payPalExportReceipt(["US", "IN"])).toBe(false);
  });

  it("review part 1, finding 1: every verdict but `capture_refunded` is a stored review kind (`not_final` included)", () => {
    // Compile time: a review verdict is a review kind.
    const asKind = (v: PayPalReviewVerdict): ReviewKind => v;
    const stored = PAYPAL_JUDGE_VERDICTS.filter((v) => v !== "capture_refunded" && v !== "partly_refunded");
    for (const v of stored) expect(REVIEW_KINDS).toContain(asKind(v));
    expect(REVIEW_KINDS).toContain("not_final");
    expect(REVIEW_KINDS).not.toContain("capture_refunded");
  });
});

// ---- capture errors -----------------------------------------------------------------------------------------------------------------------------------

const err = (name: string, issue?: string) => ({
  name,
  message: "x",
  debug_id: "abc",
  details: issue ? [{ issue, description: "y" }] : [],
});

describe("captureErrorOf [Step 0.4 row 10]", () => {
  it("success is null", () => {
    expect(captureErrorOf(201, {})).toBeNull();
    expect(captureErrorOf(200, {})).toBeNull();
  });

  it("every code", () => {
    const k = (s: number, b: unknown) => captureErrorOf(s, b)?.kind;
    expect(k(422, err("UNPROCESSABLE_ENTITY", "ORDER_ALREADY_CAPTURED"))).toBe("already_captured");
    for (const issue of [
      "INSTRUMENT_DECLINED",
      "PAYER_ACTION_REQUIRED",
      "REDIRECT_PAYER_FOR_ALTERNATE_FUNDING",
    ])
      expect(k(422, err("UNPROCESSABLE_ENTITY", issue)), issue).toBe("instrument_declined");
    expect(k(422, err("UNPROCESSABLE_ENTITY", "ORDER_NOT_APPROVED"))).toBe("not_approved");
    expect(k(404, err("RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID"))).toBe("not_found");
    expect(k(409, err("RESOURCE_CONFLICT", "PREVIOUS_REQUEST_IN_PROGRESS"))).toBe("in_progress");
    expect(k(202, {})).toBe("in_progress");
    expect(k(422, err("UNPROCESSABLE_ENTITY", "ORDER_COMPLETION_IN_PROGRESS"))).toBe("in_progress");
    expect(k(400, err("INVALID_REQUEST", "PREVIOUS_REQUEST_IN_PROGRESS"))).toBe("in_progress");
    for (const s of [0, -1, 429, 500, 502, 503, 1.5]) expect(k(s, null), String(s)).toBe("retry");
    for (const issue of [
      "DUPLICATE_INVOICE_ID",
      "TRANSACTION_REFUSED",
      "PAYMENT_DENIED",
      "MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED",
      "SOMETHING_NEW",
    ])
      expect(k(422, err("UNPROCESSABLE_ENTITY", issue)), issue).toBe("refused");
    expect(k(400, err("INVALID_REQUEST"))).toBe("refused");
    expect(k(401, "not json")).toBe("refused");
    expect(k(403, { details: "x" })).toBe("refused");
    expect(new Set(CAPTURE_ERRORS).size).toBe(CAPTURE_ERRORS.length);
  });

  it("keeps PayPal's code (issue, else name) only when it is a plain code", () => {
    expect(captureErrorOf(422, err("UNPROCESSABLE_ENTITY", "INSTRUMENT_DECLINED"))?.issue).toBe(
      "INSTRUMENT_DECLINED",
    );
    expect(captureErrorOf(400, err("INVALID_REQUEST"))?.issue).toBe("INVALID_REQUEST");
    expect(captureErrorOf(422, err("<script>", "a b"))?.issue).toBeNull();
  });
});

// ---- mapping a capture to a payment ---------------------------------------------------------------------------------------------------------------------

describe("the payment row of a capture [L8, L9, L22; 08-C RA-29, RA-37]", () => {
  it("ids, the reference, the mode and the IST day", async () => {
    expect(payPalPaymentRowId(CAPTURE)).toBe(`ppl_${CAPTURE}`);
    expect(await payPalReferenceNorm(CAPTURE)).toBe(`PPL-${CAPTURE}`);
    const long = "A".repeat(64);
    const n = await payPalReferenceNorm(long);
    expect(n).toMatch(/^PPL-A{40}-[0-9A-F]{12}$/);
    expect(n?.length).toBe(57);
    expect(await payPalReferenceNorm("lower-case")).toBeNull();
    expect(payPalModeOf("paypal")).toBe("wallet");
    expect(payPalModeOf("card")).toBe("card");
    expect(payPalModeOf("other")).toBe("other");
    expect(payPalModeOf(null)).toBe("other");
    // 18:45 UTC on 2 November is 00:15 IST on 3 November.
    expect(payPalReceivedOn(Date.UTC(2026, 10, 2, 18, 45))).toBe("2026-11-03");
  });

  it("the fee goes in the column of its own currency; the INR receivable only when INR and positive", () => {
    expect(payPalFeeFactsOf(capture())).toEqual({
      chargesMinor: 54_12,
      gatewayFeeInrMinor: null,
      inrReceivedMinor: 98_000_00,
    });
    expect(
      payPalFeeFactsOf({
        fee: { currency: "INR", minor: 4500_00 },
        receivable: { currency: "USD", minor: 1180_44 },
      }),
    ).toEqual({ chargesMinor: 0, gatewayFeeInrMinor: 4500_00, inrReceivedMinor: null });
    expect(payPalFeeFactsOf({ fee: null, receivable: null })).toEqual({
      chargesMinor: 0,
      gatewayFeeInrMinor: null,
      inrReceivedMinor: null,
    });
    expect(
      payPalFeeFactsOf({ fee: { currency: "EUR", minor: null }, receivable: { currency: "INR", minor: 0 } }),
    ).toEqual({ chargesMinor: 0, gatewayFeeInrMinor: null, inrReceivedMinor: null });
  });
});

// ---- events ----------------------------------------------------------------------------------------------------------------------------------------------

const event = (event_type: string, resource: unknown, o: Record<string, unknown> = {}) => ({
  id: "WH-58D329510W468432D-8HN650336L201105X",
  event_version: "1.0",
  create_time: "2026-11-02T18:45:03.123Z",
  resource_type: "capture",
  resource_version: "2.0",
  event_type,
  summary: "x",
  resource,
  ...o,
});

describe("parsePayPalEvent, its facts and ownership [JOB-HOOK-02, L13, L15]", () => {
  it("the seven subscribed names and the v1 one map to ours; anything else is other", () => {
    expect(Object.keys(PAYPAL_EVENT_TYPES)).toEqual([
      "CHECKOUT.ORDER.APPROVED",
      "CHECKOUT.PAYMENT-APPROVAL.REVERSED",
      "PAYMENT.CAPTURE.COMPLETED",
      "PAYMENT.CAPTURE.PENDING",
      "PAYMENT.CAPTURE.DECLINED",
      "PAYMENT.CAPTURE.DENIED",
      "PAYMENT.CAPTURE.REFUNDED",
      "PAYMENT.CAPTURE.REVERSED",
    ]);
    for (const t of Object.values(PAYPAL_EVENT_TYPES)) expect(PROVIDER_EVENT_TYPES).toContain(t);
  });

  it("an order approved: the order from resource.id, the mark and amount from its first purchase unit", () => {
    const r = parsePayPalEvent(event("CHECKOUT.ORDER.APPROVED", orderJson({ status: "APPROVED" })));
    if (!r.ok) throw new Error("invalid");
    expect(r.value).toEqual({
      id: "WH-58D329510W468432D-8HN650336L201105X",
      type: "checkout.approved",
      name: "CHECKOUT.ORDER.APPROVED",
      occurredAt: Date.parse("2026-11-02T18:45:03.123Z"),
      orderRef: ORDER,
      captureRef: null,
      refundRef: null,
      customId: CHECKOUT,
      invoiceId: `TH/EX/2627/7-${CHECKOUT.slice(-12)}`,
      status: "APPROVED",
      currency: "USD",
      amountMinor: 1234_56,
    });
    expect(payPalEventOwnership(r.value)).toBe("ours");
    const facts = payPalEventFacts(r.value);
    expect(facts).toEqual({
      event: "CHECKOUT.ORDER.APPROVED",
      linkId: ORDER,
      amountMinor: 1234_56,
      currency: "USD",
      status: "APPROVED",
      checkoutId: CHECKOUT,
      invoiceId: `TH/EX/2627/7-${CHECKOUT.slice(-12)}`,
    });
    expect(JSON.stringify(facts)).not.toContain("buyer@example.test");
    const rev = parsePayPalEvent(event("CHECKOUT.PAYMENT-APPROVAL.REVERSED", { id: ORDER }));
    expect(rev.ok && rev.value.type).toBe("checkout.approval_reversed");
  });

  it("capture events: the capture and its order (related_ids) are required", () => {
    for (const [name, type] of [
      ["PAYMENT.CAPTURE.COMPLETED", "payment.captured"],
      ["PAYMENT.CAPTURE.PENDING", "payment.pending"],
      ["PAYMENT.CAPTURE.DECLINED", "payment.failed"],
      ["PAYMENT.CAPTURE.DENIED", "payment.failed"],
    ] as const) {
      const r = parsePayPalEvent(event(name, captureJson()));
      expect(r.ok && r.value.type, name).toBe(type);
      expect(r.ok && r.value.captureRef).toBe(CAPTURE);
      expect(r.ok && r.value.orderRef).toBe(ORDER);
      expect(r.ok && payPalEventFacts(r.value)).toMatchObject({ linkId: ORDER, paymentId: CAPTURE });
    }
    expect(
      parsePayPalEvent(event("PAYMENT.CAPTURE.COMPLETED", captureJson({ supplementary_data: {} }))),
    ).toEqual({
      ok: false,
      code: "invalid_event",
    });
    expect(parsePayPalEvent(event("PAYMENT.CAPTURE.COMPLETED", captureJson({ id: "x y" }))).ok).toBe(false);
  });

  it("a refund or reversal: the capture from the up link (no custom_id needed: by_capture), or the resource itself", () => {
    const refund = {
      id: "1JU08902781691411",
      status: "COMPLETED",
      amount: { currency_code: "USD", value: "10.00" },
      invoice_id: `TH/EX/2627/7-${CHECKOUT.slice(-12)}`,
      links: [
        { href: "https://api.sandbox.paypal.com/v2/payments/refunds/1JU08902781691411", rel: "self" },
        { href: `https://api.sandbox.paypal.com/v2/payments/captures/${CAPTURE}`, rel: "up" },
      ],
    };
    const r = parsePayPalEvent(event("PAYMENT.CAPTURE.REFUNDED", refund));
    if (!r.ok) throw new Error("invalid");
    expect(r.value).toMatchObject({
      type: "refund.processed",
      captureRef: CAPTURE,
      refundRef: "1JU08902781691411",
      orderRef: null,
    });
    expect(payPalEventOwnership(r.value)).toBe("by_capture");
    expect(invoiceIdCheckoutTail(r.value.invoiceId)).toBe(CHECKOUT.slice(-12));
    expect(payPalEventFacts(r.value)).toMatchObject({ paymentId: CAPTURE, refundId: "1JU08902781691411" });
    // Review part 1, finding 4: the refund's `invoice_id` is kept for the finance Worker's match, only in a safe shape (at most 127 of [A-Za-z0-9/_-]).
    expect(payPalEventFacts(r.value).invoiceId).toBe(`TH/EX/2627/7-${CHECKOUT.slice(-12)}`);
    for (const invoice_id of ["a b", "x".repeat(128), "TH/EX<script>"]) {
      const odd = parsePayPalEvent(event("PAYMENT.CAPTURE.REFUNDED", { ...refund, invoice_id }));
      expect(odd.ok && payPalEventFacts(odd.value).invoiceId, invoice_id).toBeUndefined();
    }
    expect(PAYPAL_INVOICE_ID_FACT.test("x".repeat(127))).toBe(true);
    const reversed = parsePayPalEvent(event("PAYMENT.CAPTURE.REVERSED", captureJson({ status: "REVERSED" })));
    expect(reversed.ok && reversed.value).toMatchObject({
      type: "payment.reversed",
      captureRef: CAPTURE,
      orderRef: ORDER,
    });
    expect(reversed.ok && payPalEventOwnership(reversed.value)).toBe("ours");
    expect(parsePayPalEvent(event("PAYMENT.CAPTURE.REFUNDED", { ...refund, links: [] })).ok).toBe(false);
  });

  it("other events, foreign marks, ids and malformed bodies", () => {
    const other = parsePayPalEvent(
      event("BILLING.SUBSCRIPTION.CREATED", { id: "I-1", custom_id: "someone-else" }),
    );
    if (!other.ok) throw new Error("invalid");
    expect(other.value.type).toBe("other");
    expect(payPalEventOwnership(other.value)).toBe("not_ours");
    const foreign = parsePayPalEvent(
      event("CHECKOUT.ORDER.APPROVED", orderJson({ purchase_units: [{ custom_id: "shop-42" }] })),
    );
    expect(foreign.ok && payPalEventOwnership(foreign.value)).toBe("not_ours");
    expect(foreign.ok && payPalEventFacts(foreign.value).checkoutId).toBeUndefined();
    const noId = parsePayPalEvent(
      event("CHECKOUT.ORDER.APPROVED", orderJson(), { id: "evt_1", create_time: "x" }),
    );
    expect(noId.ok && noId.value.id).toBeNull();
    expect(noId.ok && noId.value.occurredAt).toBeNull();
    expect(payPalEventIdOf("WH-1")).toBe("WH-1");
    for (const bad of ["WH-", "wh-1", `WH-${"A".repeat(62)}`, 5, null])
      expect(payPalEventIdOf(bad)).toBeNull();
    for (const bad of [
      null,
      [],
      {},
      event("lower.case", {}),
      event("CHECKOUT.ORDER.APPROVED", "x"),
      event("CHECKOUT.ORDER.APPROVED", {}),
    ])
      expect(parsePayPalEvent(bad).ok).toBe(false);
    expect(invoiceIdCheckoutTail(null)).toBeNull();
    expect(invoiceIdCheckoutTail("A-1")).toBeNull();
  });
});

// ---- the offline signature -----------------------------------------------------------------------------------------------------------------------------

/** DER encoding, just enough to build a certificate around a generated key. */
const cat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const der = (tag: number, ...parts: Uint8Array[]) => {
  const body = cat(parts);
  const n = body.length;
  const len = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
  return cat([Uint8Array.of(tag, ...len), body]);
};
const ascii = (s: string) => enc.encode(s);
const SHA256_RSA = Uint8Array.of(0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b);
const name = der(
  0x30,
  der(0x31, der(0x30, Uint8Array.of(0x06, 0x03, 0x55, 0x04, 0x03), der(0x0c, ascii("test")))),
);
const certificate = (spki: Uint8Array, notBefore: Uint8Array, notAfter: Uint8Array, version = true) =>
  der(
    0x30,
    der(
      0x30,
      ...(version ? [der(0xa0, der(0x02, Uint8Array.of(2)))] : []),
      der(0x02, Uint8Array.of(0x01, 0x23)),
      der(0x30, SHA256_RSA, Uint8Array.of(0x05, 0x00)),
      name,
      der(0x30, notBefore, notAfter),
      name,
      spki,
    ),
    der(0x30, SHA256_RSA, Uint8Array.of(0x05, 0x00)),
    der(0x03, Uint8Array.of(0, 1, 2, 3)),
  );
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const pem = (d: Uint8Array) =>
  `-----BEGIN CERTIFICATE-----\n${(b64(d).match(/.{1,64}/g) ?? []).join("\n")}\n-----END CERTIFICATE-----\n`;
const utc = (s: string) => der(0x17, ascii(s));
const gen = (s: string) => der(0x18, ascii(s));

const WEBHOOK = "8PT597110X687430LKGECATA";
const CERT_URL = "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-ab66f33d";
const NOW = Date.UTC(2026, 10, 2, 12);
let keys: {
  publicKey: Parameters<typeof crypto.subtle.verify>[1];
  privateKey: Parameters<typeof crypto.subtle.sign>[1];
};
let spki: Uint8Array;
let certPem: string;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: Uint8Array.of(1, 0, 1),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as typeof keys;
  keys = pair;
  spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey as never));
  certPem = pem(certificate(spki, utc("260101000000Z"), utc("270101000000Z")));
});

const body = enc.encode(JSON.stringify(event("PAYMENT.CAPTURE.COMPLETED", captureJson())));
const TX = "69cd13f0-d67a-11e5-baa3-778b53f4ae55";
const TIME = "2026-11-02T18:45:03Z";
const sign = async (bytes: Uint8Array, webhookId = WEBHOOK, tx = TX, time = TIME) =>
  b64(
    new Uint8Array(
      await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        keys.privateKey,
        enc.encode(payPalSignedMessage(tx, time, webhookId, crc32(bytes))),
      ),
    ),
  );
const headers = (sig: string, o: Record<string, string | undefined> = {}) => ({
  "paypal-transmission-id": TX,
  "paypal-transmission-time": TIME,
  "paypal-transmission-sig": sig,
  "paypal-cert-url": CERT_URL,
  "paypal-auth-algo": "SHA256withRSA",
  ...o,
});

describe("the offline signature [L1, L20; Step 0.4 rows 17 and 21]", () => {
  it("CRC32 known vectors, as unsigned decimal", () => {
    expect(crc32(ascii("123456789"))).toBe(3_421_780_262);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(ascii("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
    expect(payPalSignedMessage("a", "b", "c", 3_421_780_262)).toBe("a|b|c|3421780262");
  });

  it("the certificate URL allow-list", () => {
    expect(isPayPalCertUrl(CERT_URL)).toBe(true);
    expect(
      isPayPalCertUrl("https://api.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-ab66f33d"),
    ).toBe(true);
    for (const bad of [
      "https://api.paypal.com.evil.test/v1/notifications/certs/CERT-1",
      "http://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1?x=1",
      "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1#x",
      "https://api.sandbox.paypal.com:8443/v1/notifications/certs/CERT-1",
      "https://u:p@api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      "https://www.paypal.com/v1/notifications/certs/CERT-1",
      "https://api.sandbox.paypal.com/v1/notifications/certs/../../x",
      "https://api.sandbox.paypal.com/v1/other/CERT-1",
      `https://api.sandbox.paypal.com/v1/notifications/certs/CERT-${"a".repeat(500)}`,
      "http://localhost:8790/__paypal-test-cert",
      "not a url",
      null,
    ])
      expect(isPayPalCertUrl(bad), String(bad).slice(0, 70)).toBe(false);
    expect(isPayPalCertUrl("http://localhost:8790/__paypal-test-cert", { local: true })).toBe(true);
    expect(isPayPalCertUrl("http://localhost:8790/other", { local: true })).toBe(false);
    expect(isPayPalCertUrl("http://example.test:8790/__paypal-test-cert", { local: true })).toBe(false);
  });

  it("our webhook id: letters and digits, at most 50, never the simulator's literal", () => {
    expect(isPayPalWebhookId(WEBHOOK)).toBe(true);
    for (const bad of [SIMULATOR_WEBHOOK_ID, "WEBHOOK-ID", "", "A".repeat(51), null])
      expect(isPayPalWebhookId(bad)).toBe(false);
  });

  it("the DER reader: validity (UTCTime and GeneralizedTime) and the RSA key, with or without a version", async () => {
    const d = pemToDer(certPem);
    expect(d).not.toBeNull();
    const parts = certParts(d as Uint8Array);
    expect(parts?.notBefore).toBe(Date.UTC(2026, 0, 1));
    expect(parts?.notAfter).toBe(Date.UTC(2027, 0, 1));
    expect(parts?.spki).toEqual(spki);
    expect(certValidAt(parts as never, NOW)).toBe(true);
    expect(certValidAt(parts as never, Date.UTC(2027, 0, 2))).toBe(false);
    const g = certParts(certificate(spki, gen("20500101000000Z"), gen("20510101000000Z"), false));
    expect(g?.notBefore).toBe(Date.UTC(2050, 0, 1));
    // UTCTime years 50 to 99 are 19YY: 1999 → 2000 reads; 2049 → 1950 has notAfter before notBefore.
    expect(certParts(certificate(spki, utc("990101000000Z"), utc("000101000000Z")))?.notBefore).toBe(
      Date.UTC(1999, 0, 1),
    );
    expect(certParts(certificate(spki, utc("490101000000Z"), utc("500101000000Z")))).toBeNull();
    const imported = await importPayPalCertKey(certPem, NOW);
    // The key comes with its certificate's notAfter, so a cache entry never outlives it (early check 1 finding 3).
    expect(imported?.notAfter).toBe(Date.UTC(2027, 0, 1));
    expect(imported?.key.type).toBe("public");
  });

  it("the DER reader refuses what isn't an RSA certificate", async () => {
    const ecSpki = der(
      0x30,
      der(0x30, Uint8Array.of(0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01)),
      der(0x03, Uint8Array.of(0, 4)),
    );
    const good = certificate(spki, utc("260101000000Z"), utc("270101000000Z"));
    for (const bad of [
      new Uint8Array(0),
      Uint8Array.of(0x30),
      Uint8Array.of(0x30, 0x85, 1, 2, 3, 4, 5),
      Uint8Array.of(0x1f, 0x01, 0x00),
      cat([good, Uint8Array.of(0)]),
      good.slice(0, good.length - 1),
      certificate(ecSpki, utc("260101000000Z"), utc("270101000000Z")),
      certificate(spki, utc("261301000000Z"), utc("270101000000Z")),
      certificate(spki, ascii("x"), utc("270101000000Z")),
      certificate(spki, der(0x17, ascii("2601010000Z")), utc("270101000000Z")),
      der(0x30, der(0x30, der(0x02, Uint8Array.of(1)))),
      new Uint8Array(20_000),
    ])
      expect(certParts(bad)).toBeNull();
    for (const bad of [
      null,
      "",
      "-----BEGIN CERTIFICATE-----\n!!!!\n-----END CERTIFICATE-----",
      "-----BEGIN CERTIFICATE-----\nQQ\n-----END CERTIFICATE-----",
      "x".repeat(20_000),
    ])
      expect(pemToDer(bad)).toBeNull();
    expect(await importPayPalCertKey(certPem, Date.UTC(2028, 0, 1))).toBeNull(); // expired
    expect(await importPayPalCertKey("nope", NOW)).toBeNull();
  });

  it("a valid signature verifies; a changed byte, transmission id or webhook id doesn't", async () => {
    const key = (await importPayPalCertKey(certPem, NOW))?.key ?? null;
    const keyFor = async (u: string) => (u === CERT_URL ? key : null);
    const sig = await sign(body);
    const v = (o: Partial<Parameters<typeof verifyPayPalSignature>[0]>) =>
      verifyPayPalSignature({ bytes: body, headers: headers(sig), webhookId: WEBHOOK, keyFor, ...o });
    expect(await v({})).toBe("ok");
    const changed = body.slice();
    changed[10] = (changed[10] as number) ^ 1;
    expect(await v({ bytes: changed })).toBe("signature_invalid");
    expect(
      await v({
        headers: headers(sig, { "paypal-transmission-id": "69cd13f0-d67a-11e5-baa3-778b53f4ae56" }),
      }),
    ).toBe("signature_invalid");
    expect(await v({ headers: headers(sig, { "paypal-transmission-time": "2026-11-02T18:45:04Z" }) })).toBe(
      "signature_invalid",
    );
    expect(await v({ webhookId: "8PT597110X687430LKGECATB" })).toBe("signature_invalid");
    // The simulator signs with the literal WEBHOOK_ID: never ours, never accepted.
    const simulated = await sign(body, SIMULATOR_WEBHOOK_ID);
    expect(await v({ headers: headers(simulated) })).toBe("signature_invalid");
    expect(await v({ headers: headers(simulated), webhookId: SIMULATOR_WEBHOOK_ID })).toBe(
      "webhook_id_invalid",
    );
    // The algorithm header may be absent (we fix the algorithm); present, it must be SHA256withRSA.
    expect(await v({ headers: headers(sig, { "paypal-auth-algo": undefined }) })).toBe("ok");
    expect(await v({ headers: headers(sig, { "paypal-auth-algo": "SHA1withRSA" }) })).toBe(
      "signature_missing",
    );
  });

  it("missing or malformed headers, a refused cert URL, no key, no webhook id", async () => {
    const key = (await importPayPalCertKey(certPem, NOW))?.key ?? null;
    const sig = await sign(body);
    const v = (
      h: Record<string, string | undefined>,
      o: Partial<Parameters<typeof verifyPayPalSignature>[0]> = {},
    ) =>
      verifyPayPalSignature({
        bytes: body,
        headers: headers(sig, h),
        webhookId: WEBHOOK,
        keyFor: async () => key,
        ...o,
      });
    for (const h of [
      { "paypal-transmission-id": undefined },
      { "paypal-transmission-id": "a|b" },
      { "paypal-transmission-id": "a".repeat(51) },
      { "paypal-transmission-time": undefined },
      { "paypal-transmission-time": "yesterday" },
      { "paypal-transmission-sig": undefined },
      { "paypal-transmission-sig": "not base64!" },
      { "paypal-transmission-sig": "QQ=" },
      { "paypal-transmission-sig": "A".repeat(504) },
      { "paypal-cert-url": undefined },
    ])
      expect(await v(h), JSON.stringify(h)).toBe("signature_missing");
    // Review part 1, finding 12: the other four headers sent and well formed, only the certificate URL refused: counted (`cert_url_refused`); without the
    // optional algorithm header it stays `signature_missing`.
    for (const url of [
      "https://api.paypal.com.evil.test/v1/notifications/certs/CERT-1",
      "http://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      `${CERT_URL}?x=1`,
      "https://api.sandbox.paypal.com:444/v1/notifications/certs/CERT-1",
      "https://api-m.paypal.com/v1/notifications/certs/CERT-1",
    ]) {
      expect(await v({ "paypal-cert-url": url }), url).toBe("cert_url_refused");
      expect(await v({ "paypal-cert-url": url, "paypal-auth-algo": undefined }), url).toBe(
        "signature_missing",
      );
    }
    // A malformed signature with a refused URL is still only `signature_missing`.
    expect(
      await v({ "paypal-cert-url": "https://api-m.paypal.com/v1/x", "paypal-transmission-sig": "QQ=" }),
    ).toBe("signature_missing");
    expect(await v({}, { keyFor: async () => null })).toBe("cert_unavailable");
    expect(
      await v(
        {},
        {
          keyFor: async () => {
            throw new Error("network");
          },
        },
      ),
    ).toBe("cert_unavailable");
    expect(await v({}, { webhookId: undefined })).toBe("webhook_id_invalid");
    expect(await v({}, { webhookId: "bad id" })).toBe("webhook_id_invalid");
    // A key of another algorithm makes verify throw: refused, not thrown.
    const hmac = await crypto.subtle.importKey(
      "raw",
      enc.encode("k"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    expect(await v({}, { keyFor: async () => hmac })).toBe("signature_invalid");
    // The local simulator's certificate URL only when local.
    const local = "http://localhost:8790/__paypal-test-cert";
    expect(await v({ "paypal-cert-url": local })).toBe("cert_url_refused");
    expect(await v({ "paypal-cert-url": local }, { local: true })).toBe("ok");
  });
});

// Early check 2 finding 7: the owner's key script stores PayPal's API keys only on the admin finance Worker and the webhook ID only on jobs, checked before any
// value is read (the script is parsed in the fix round, never run here).
describe("tools/set-gateway-keys.ps1 PayPal targets", () => {
  it("each PayPal mode takes exactly one config, checked before any prompt", () => {
    const ps1 = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "tools", "set-gateway-keys.ps1"),
      "utf8",
    );
    const guard =
      '$onlyConfig = @{ "paypal" = "apps\\admin\\wrangler.finance.jsonc"; "paypal-webhook" = "apps\\jobs\\wrangler.jsonc" }';
    expect(ps1).toContain(guard);
    expect(ps1).toContain("if ($given.Count -ne 1 -or $given[0] -ine $onlyConfig[$Gateway])");
    const at = ps1.indexOf(guard);
    expect(at).toBeLessThan(ps1.indexOf('Read-Hidden "PayPal sandbox Client ID"'));
    expect(at).toBeLessThan(ps1.indexOf('Read-Hidden "PayPal sandbox Webhook ID"'));
  });

  it("review part 1, finding 13: a webhook without CHECKOUT.PAYMENT-APPROVAL.REVERSED is a warning, never a stop; every other handled event is required", () => {
    const ps1 = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "tools", "set-gateway-keys.ps1"),
      "utf8",
    );
    const need = /\$need = @\(([^)]*)\)/.exec(ps1)?.[1] ?? "";
    const optional = /\$optional = @\(([^)]*)\)/.exec(ps1)?.[1] ?? "";
    const names = (list: string) => [...list.matchAll(/"([A-Z.-]+)"/g)].map((m) => m[1]);
    expect(names(optional)).toEqual(["CHECKOUT.PAYMENT-APPROVAL.REVERSED"]);
    // Every event type the finance Worker handles is required, except the optional one.
    expect(names(need).sort()).toEqual(
      Object.keys(PAYPAL_EVENT_TYPES)
        .filter((n) => n !== "CHECKOUT.PAYMENT-APPROVAL.REVERSED" && n !== "PAYMENT.CAPTURE.DENIED")
        .sort(),
    );
    expect(ps1).toContain('if ($notOffered.Count -gt 0) { Write-Host "WARNING:');
  });
});
