// Stripe, pure [ADM-PAY-01, -03, -07, -11, -12, JOB-HOOK-01..03, POR-06; m6.3 run file B and I]: the webhook signature (stripe-node's algorithm, plus our refusal of
// future timestamps), the event reader and its whitelisted facts, the session request, the re-fetched session reader, the judge, the payment-row mapping and the
// restricted-key guard. No test calls Stripe: the bodies are fixtures shaped like Stripe's `fixtures3.json`. All names and amounts are invented test data.
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { uuidv7 } from "../src/ids.ts";
import { PROVIDER_EVENT_TYPES } from "../src/payments.ts";
import {
  DESCRIPTION_MAX,
  DISPLAY_NAME,
  formBody,
  inrFactsOf,
  judgeStripeSession,
  LABEL_MAX,
  parseStripeEvent,
  readStripeSession,
  receivedOnOf,
  SESSION_LIFETIME_MS,
  STATEMENT_SUFFIX,
  STRIPE_API_VERSION,
  STRIPE_EVENT_TYPES,
  STRIPE_JUDGE_VERDICTS,
  type StripeCheckoutRow,
  type StripeSession,
  SUFFIX_MAX,
  sessionRequestOf,
  stripeAllowed,
  stripeEventFacts,
  stripeKeyModeOf,
  stripeModeOf,
  stripePaymentRowId,
  stripeReferenceNorm,
  stripeTestHeader,
  verifyStripeSignature,
} from "../src/stripe.ts";

const SECRET = "whsec_testSecretAbc123";
const OLD_SECRET = "whsec_previousSecretXyz789";
const NOW = 1_900_000_000_000;
const T = NOW / 1000;
const BODY = '{"id":"evt_1Abc","object":"event","type":"checkout.session.completed"}';
/** An independent vector: node's own HMAC over `${t}.${body}`, keyed with the secret's UTF-8 bytes (`whsec_` included, never base64-decoded). */
const nodeSig = (body: string, secret: string, t: number) =>
  createHmac("sha256", Buffer.from(secret, "utf8")).update(`${t}.${body}`, "utf8").digest("hex");

describe("verifyStripeSignature [JOB-HOOK-01, V6, L2]", () => {
  it("a valid header passes; the test-header helper matches node's own HMAC", async () => {
    const header = `t=${T},v1=${nodeSig(BODY, SECRET, T)}`;
    expect(await stripeTestHeader(BODY, SECRET, T)).toBe(header);
    expect(await verifyStripeSignature(BODY, header, [SECRET], NOW)).toBe("ok");
    // Raw bytes work the same as the text.
    expect(await verifyStripeSignature(new TextEncoder().encode(BODY), header, [SECRET], NOW)).toBe("ok");
  });

  it("the secret is keyed as its UTF-8 bytes, whsec_ included (a base64-decoded key fails)", async () => {
    const decodedKey = Buffer.from(SECRET.slice(6), "base64");
    const wrong = createHmac("sha256", decodedKey).update(`${T}.${BODY}`).digest("hex");
    expect(await verifyStripeSignature(BODY, `t=${T},v1=${wrong}`, [SECRET], NOW)).toBe("signature_invalid");
  });

  it("refuses a wrong secret, a changed body byte and re-serialised JSON", async () => {
    const header = await stripeTestHeader(BODY, SECRET, T);
    expect(await verifyStripeSignature(BODY, header, ["whsec_other"], NOW)).toBe("signature_invalid");
    expect(await verifyStripeSignature(BODY.replace("1Abc", "1Abd"), header, [SECRET], NOW)).toBe(
      "signature_invalid",
    );
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 1);
    expect(await verifyStripeSignature(reserialised, header, [SECRET], NOW)).toBe("signature_invalid");
  });

  it("several v1 candidates, one valid, pass; other schemes are ignored; the previous secret passes", async () => {
    const good = nodeSig(BODY, SECRET, T);
    const header = `t=${T},v1=${"0".repeat(64)},v0=${good},v1=${good}`;
    expect(await verifyStripeSignature(BODY, header, [SECRET], NOW)).toBe("ok");
    const old = `t=${T},v1=${nodeSig(BODY, OLD_SECRET, T)}`;
    expect(await verifyStripeSignature(BODY, old, [SECRET, OLD_SECRET], NOW)).toBe("ok");
    expect(await verifyStripeSignature(BODY, old, [SECRET, null, "", undefined], NOW)).toBe(
      "signature_invalid",
    );
    // Upper-case hex decodes to the same bytes.
    expect(await verifyStripeSignature(BODY, `t=${T},v1=${good.toUpperCase()}`, [SECRET], NOW)).toBe("ok");
  });

  it("a header is read as stripe-node reads it: no trimming, t of 1 to 12 digits, at least one v1", async () => {
    const good = nodeSig(BODY, SECRET, T);
    expect(await verifyStripeSignature(BODY, `t=${T}, v1=${good}`, [SECRET], NOW)).toBe(
      "signature_malformed",
    );
    expect(await verifyStripeSignature(BODY, ` t=${T},v1=${good}`, [SECRET], NOW)).toBe(
      "signature_malformed",
    );
    expect(await verifyStripeSignature(BODY, `v1=${good}`, [SECRET], NOW)).toBe("signature_malformed");
    expect(await verifyStripeSignature(BODY, `t=abc,v1=${good}`, [SECRET], NOW)).toBe("signature_malformed");
    expect(await verifyStripeSignature(BODY, `t=1234567890123,v1=${good}`, [SECRET], NOW)).toBe(
      "signature_malformed",
    );
    expect(await verifyStripeSignature(BODY, `t=${T}`, [SECRET], NOW)).toBe("signature_malformed");
    expect(await verifyStripeSignature(BODY, `t=${T},v0=${good}`, [SECRET], NOW)).toBe("signature_malformed");
    expect(await verifyStripeSignature(BODY, `t=${T},junk,v1=${good}`, [SECRET], NOW)).toBe("ok");
    // A non-hex or short candidate is skipped, never compared.
    expect(await verifyStripeSignature(BODY, `t=${T},v1=xyz`, [SECRET], NOW)).toBe("signature_invalid");
    expect(await verifyStripeSignature(BODY, `t=${T},v1=${good.slice(2)}`, [SECRET], NOW)).toBe(
      "signature_invalid",
    );
  });

  it("a missing header, and no secret at all", async () => {
    expect(await verifyStripeSignature(BODY, null, [SECRET], NOW)).toBe("signature_missing");
    expect(await verifyStripeSignature(BODY, "", [SECRET], NOW)).toBe("signature_missing");
    expect(await verifyStripeSignature(BODY, undefined, [SECRET], NOW)).toBe("signature_missing");
    const header = await stripeTestHeader(BODY, SECRET, T);
    expect(await verifyStripeSignature(BODY, header, [], NOW)).toBe("signature_invalid");
    expect(await verifyStripeSignature(42 as never, header, [SECRET], NOW)).toBe("signature_malformed");
  });

  it("the timestamp, after the signature: 299 s either way passes, 301 s old or ahead is refused (our departure from stripe-node)", async () => {
    for (const [dt, verdict] of [
      [-299, "ok"],
      [299, "ok"],
      [-300, "ok"],
      [-301, "timestamp_out_of_tolerance"],
      [301, "timestamp_out_of_tolerance"],
    ] as const) {
      const t = T + dt;
      expect(await verifyStripeSignature(BODY, `t=${t},v1=${nodeSig(BODY, SECRET, t)}`, [SECRET], NOW)).toBe(
        verdict,
      );
    }
    // A bad signature with an old timestamp is a bad signature (checked first).
    expect(await verifyStripeSignature(BODY, `t=${T - 900},v1=${"a".repeat(64)}`, [SECRET], NOW)).toBe(
      "signature_invalid",
    );
    // A custom tolerance.
    const t = T - 60;
    expect(
      await verifyStripeSignature(BODY, `t=${t},v1=${nodeSig(BODY, SECRET, t)}`, [SECRET], NOW, 30),
    ).toBe("timestamp_out_of_tolerance");
  });
});

// ---- events ---------------------------------------------------------------------------------------------------------------------------------------------------

const CHECKOUT_ID = uuidv7(NOW - 60_000);
const DOC_ID = uuidv7(NOW - 600_000);
const SESSION_ID = `cs_test_a1${"B".repeat(62)}`; // 66 characters, as Stripe's fixture
const PI = "pi_3QabcDEF123";
const marks = {
  app: "techaust",
  techaust_checkout_id: CHECKOUT_ID,
  techaust_document_id: DOC_ID,
  techaust_env: "staging",
};

function event(type: string, over: Record<string, unknown> = {}, session: Record<string, unknown> = {}) {
  return {
    id: "evt_1QxyzABC",
    object: "event",
    type,
    livemode: false,
    created: T,
    api_version: STRIPE_API_VERSION,
    data: {
      object: {
        id: SESSION_ID,
        object: "checkout.session",
        amount_total: 500_00,
        currency: "usd",
        payment_intent: PI,
        payment_status: "paid",
        status: "complete",
        metadata: marks,
        customer_details: { name: "Jane Payer", email: "jane@example.test", address: { country: "US" } },
        ...session,
      },
    },
    ...over,
  };
}

describe("parseStripeEvent and stripeEventFacts [JOB-HOOK-01, -02, L5, ADM-PAY-12]", () => {
  it.each([
    ["checkout.session.completed", "checkout.paid"],
    ["checkout.session.async_payment_succeeded", "checkout.paid"],
    ["checkout.session.async_payment_failed", "checkout.failed"],
    ["checkout.session.expired", "checkout.expired"],
  ] as const)("%s → %s, ours", (name, type) => {
    const r = parseStripeEvent(event(name));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      id: "evt_1QxyzABC",
      type,
      name,
      livemode: false,
      created: NOW,
      sessionId: SESSION_ID,
      paymentIntentId: PI,
      amountTotal: 500_00,
      currency: "usd",
      paymentStatus: "paid",
      status: "complete",
      techaust: { checkoutId: CHECKOUT_ID, documentId: DOC_ID, env: "staging" },
    });
  });

  it("every mapped type is a provider event type", () => {
    for (const t of Object.values(STRIPE_EVENT_TYPES)) expect(PROVIDER_EVENT_TYPES).toContain(t);
  });

  it("an unknown type is `other` with nothing read from its object", () => {
    const r = parseStripeEvent(event("charge.refunded", {}, { object: "charge" }));
    expect(r).toMatchObject({ ok: true, value: { type: "other", sessionId: null, techaust: null } });
  });

  it("the other domain's session (no or wrong marks) is not ours", () => {
    for (const metadata of [
      {},
      null,
      { ...marks, app: "other" },
      { ...marks, techaust_checkout_id: "not-a-uuid" },
      { ...marks, techaust_checkout_id: "01890000-0000-4000-8000-000000000000" },
      { ...marks, techaust_env: "Staging!" },
      { ...marks, techaust_document_id: "" },
    ]) {
      const r = parseStripeEvent(event("checkout.session.completed", {}, { metadata }));
      expect(r).toMatchObject({ ok: true, value: { techaust: null } });
    }
  });

  it("refuses what is not a well-formed event", () => {
    for (const bad of [
      null,
      "x",
      [],
      event("checkout.session.completed", { id: "ev_1" }),
      event("checkout.session.completed", { livemode: "false" }),
      event("checkout.session.completed", { created: -1 }),
      event("checkout.session.completed", { created: 1.5 }),
      event("checkout.session.completed", { type: "Checkout Session" }),
      event("checkout.session.completed", {}, { object: "payment_intent" }),
      event("checkout.session.completed", {}, { id: "pi_1" }),
      event("checkout.session.completed", {}, { amount_total: 2 ** 60 }),
      event("checkout.session.completed", {}, { amount_total: -1 }),
      event("checkout.session.completed", {}, { amount_total: "500" }),
      { ...event("checkout.session.completed"), data: null },
    ])
      expect(parseStripeEvent(bad)).toEqual({ ok: false, code: "invalid_event" });
  });

  it("a session with no amount yet, an unknown status and a payment intent that is not an id", () => {
    const r = parseStripeEvent(
      event(
        "checkout.session.expired",
        {},
        { amount_total: null, payment_intent: null, status: "x", payment_status: 1 },
      ),
    );
    expect(r).toMatchObject({
      ok: true,
      value: { amountTotal: null, paymentIntentId: null, status: null, paymentStatus: null },
    });
  });

  it("facts are a whitelist: ids, amount, currency, states and our checkout id; never the payer's details", () => {
    const r = parseStripeEvent(event("checkout.session.completed"));
    if (!r.ok) throw new Error("parse");
    const facts = stripeEventFacts(r.value);
    expect(facts).toEqual({
      event: "checkout.session.completed",
      livemode: 0,
      linkId: SESSION_ID,
      paymentId: PI,
      amountMinor: 500_00,
      currency: "USD",
      paymentStatus: "paid",
      checkoutId: CHECKOUT_ID,
    });
    const text = JSON.stringify(facts);
    for (const word of ["Jane", "example.test", "customer", "address"]) expect(text).not.toContain(word);
    // A foreign or odd-currency event keeps fewer facts.
    const other = parseStripeEvent(
      event("checkout.session.completed", { livemode: true }, { currency: "eur", metadata: {} }),
    );
    if (!other.ok) throw new Error("parse");
    expect(stripeEventFacts(other.value)).toEqual({
      event: "checkout.session.completed",
      livemode: 1,
      linkId: SESSION_ID,
      paymentId: PI,
      paymentStatus: "paid",
    });
    const bare = parseStripeEvent(event("customer.created"));
    if (!bare.ok) throw new Error("parse");
    expect(stripeEventFacts(bare.value)).toEqual({ event: "customer.created", livemode: 0 });
  });
});

// ---- the session request -------------------------------------------------------------------------------------------------------------------------------------

const input = {
  checkoutId: CHECKOUT_ID,
  documentId: DOC_ID,
  env: "staging",
  amountMinor: 500_00,
  documentLabel: "Invoice TH/EX/2026-27/7",
  description: "TecHaust Technologies: software and IT services, invoice TH/EX/2026-27/7",
  expiresAt: NOW + SESSION_LIFETIME_MS,
  successUrl: `https://portal.example.test/invoices/${DOC_ID}?pay=return`,
  cancelUrl: `https://portal.example.test/invoices/${DOC_ID}?pay=cancel`,
  now: NOW,
};

describe("sessionRequestOf [ADM-PAY-07, POR-06, L4, L8; V1, V4, V15]", () => {
  it("the exact pairs, in order", () => {
    const r = sessionRequestOf(input);
    if (!r.ok) throw new Error(r.code);
    expect(r.pairs).toEqual([
      ["mode", "payment"],
      ["line_items[0][price_data][currency]", "usd"],
      ["line_items[0][price_data][unit_amount]", "50000"],
      ["line_items[0][price_data][product_data][name]", input.documentLabel],
      ["line_items[0][quantity]", "1"],
      ["client_reference_id", CHECKOUT_ID],
      ["metadata[app]", "techaust"],
      ["metadata[techaust_checkout_id]", CHECKOUT_ID],
      ["metadata[techaust_document_id]", DOC_ID],
      ["metadata[techaust_env]", "staging"],
      ["payment_intent_data[metadata][app]", "techaust"],
      ["payment_intent_data[metadata][techaust_checkout_id]", CHECKOUT_ID],
      ["payment_intent_data[metadata][techaust_document_id]", DOC_ID],
      ["payment_intent_data[metadata][techaust_env]", "staging"],
      ["payment_intent_data[description]", input.description],
      ["payment_intent_data[statement_descriptor_suffix]", "TECHAUST"],
      ["allowed_payment_method_types[0]", "card"],
      ["billing_address_collection", "required"],
      ["adaptive_pricing[enabled]", "false"],
      ["branding_settings[display_name]", "TecHaust Technologies"],
      ["submit_type", "pay"],
      ["locale", "auto"],
      ["expires_at", String(T + 3600)],
      ["success_url", input.successUrl],
      ["cancel_url", input.cancelUrl],
    ]);
    const keys = r.pairs.map(([k]) => k).join(" ");
    for (const banned of [
      "statement_descriptor]",
      "customer",
      "invoice_creation",
      "payment_method_types[",
      "{CHECKOUT",
    ])
      expect(keys.replace("allowed_payment_method_types", "")).not.toContain(banned);
    expect(STATEMENT_SUFFIX.length).toBeLessThanOrEqual(SUFFIX_MAX);
    expect(DISPLAY_NAME).toBe("TecHaust Technologies");
    expect(formBody(r.pairs)).toContain("metadata%5Bapp%5D=techaust");
    expect(formBody([["a b", "c&d"]])).toBe("a+b=c%26d");
  });

  it("the emailed link's return page and localhost are accepted", () => {
    expect(
      sessionRequestOf({
        ...input,
        successUrl: "https://portal.example.test/pay/return",
        cancelUrl: "https://portal.example.test/pay/return?pay=cancel",
      }).ok,
    ).toBe(true);
    expect(
      sessionRequestOf({
        ...input,
        successUrl: "http://localhost:5174/pay/return",
        cancelUrl: "http://localhost:5174/pay/return?pay=cancel",
      }).ok,
    ).toBe(true);
  });

  it.each([
    ["amount_invalid", { amountMinor: 0 }],
    ["amount_invalid", { amountMinor: 12.5 }],
    ["amount_below_gateway_minimum", { amountMinor: 49 }],
    ["expiry_out_of_range", { expiresAt: NOW + 30 * 60_000 - 1 }],
    ["expiry_out_of_range", { expiresAt: NOW + 24 * 3_600_000 + 1 }],
    ["expiry_out_of_range", { now: Number.NaN }],
    ["reference_invalid", { checkoutId: "not-a-uuid" }],
    ["reference_invalid", { documentId: "" }],
    ["reference_invalid", { env: "Staging" }],
    ["label_too_long", { documentLabel: "x".repeat(LABEL_MAX + 1) }],
    ["label_too_long", { documentLabel: "  " }],
    ["description_too_long", { description: "x".repeat(DESCRIPTION_MAX + 1) }],
    ["description_too_long", { description: "" }],
    [
      "url_invalid",
      {
        successUrl: `https://portal.example.test/invoices/${DOC_ID}?pay=return&session_id={CHECKOUT_SESSION_ID}`,
      },
    ],
    ["url_invalid", { successUrl: "https://portal.example.test/o?t=secret" }],
    ["url_invalid", { successUrl: "https://portal.example.test/o#t=secret" }],
    ["url_invalid", { successUrl: "http://portal.example.test/pay/return" }],
    ["url_invalid", { successUrl: "https://user:pw@portal.example.test/pay/return" }],
    ["url_invalid", { successUrl: "not a url" }],
    ["url_invalid", { cancelUrl: "https://portal.example.test/pay/return?pay=return" }],
    ["url_invalid", { cancelUrl: `https://portal.example.test/${"x".repeat(2000)}` }],
  ] as const)("refuses %s", (code, over) => {
    expect(sessionRequestOf({ ...input, ...over })).toEqual({ ok: false, code });
  });

  it("the bounds themselves are accepted: 30 minutes and 24 hours ahead, 50 cents, 1000 characters", () => {
    expect(sessionRequestOf({ ...input, expiresAt: NOW + 30 * 60_000 }).ok).toBe(true);
    expect(sessionRequestOf({ ...input, expiresAt: NOW + 24 * 3_600_000 }).ok).toBe(true);
    expect(sessionRequestOf({ ...input, amountMinor: 50 }).ok).toBe(true);
    expect(sessionRequestOf({ ...input, description: "x".repeat(DESCRIPTION_MAX) }).ok).toBe(true);
  });
});

// ---- the re-fetched session and the judge ---------------------------------------------------------------------------------------------------------------------

function fetched(
  over: Record<string, unknown> = {},
  pi: Record<string, unknown> = {},
  charge: Record<string, unknown> = {},
  bt: unknown = undefined,
) {
  return {
    id: SESSION_ID,
    object: "checkout.session",
    status: "complete",
    payment_status: "paid",
    livemode: false,
    client_reference_id: CHECKOUT_ID,
    metadata: marks,
    currency: "usd",
    amount_total: 500_00,
    customer_details: { name: "Jane Payer", email: "jane@example.test" },
    payment_intent: {
      id: PI,
      object: "payment_intent",
      status: "succeeded",
      amount_received: 500_00,
      currency: "usd",
      metadata: marks,
      latest_charge: {
        id: "ch_3Qabc",
        object: "charge",
        created: T,
        status: "succeeded",
        captured: true,
        payment_method_details: { type: "card", card: { last4: "4242", brand: "visa" } },
        billing_details: { name: "Jane Payer" },
        balance_transaction:
          bt === undefined
            ? {
                id: "txn_1",
                object: "balance_transaction",
                amount: 41_500_00,
                currency: "inr",
                fee: 1_800_00,
                fee_details: [
                  { amount: 1_525_42, currency: "inr", type: "stripe_fee" },
                  { amount: 274_58, currency: "inr", type: "tax" },
                ],
              }
            : bt,
        ...charge,
      },
      ...pi,
    },
    ...over,
  };
}

const row: StripeCheckoutRow = {
  id: CHECKOUT_ID,
  documentId: DOC_ID,
  providerLinkId: SESSION_ID,
  currency: "USD",
  amountMinor: 500_00,
  env: "staging",
};

const read = (o: unknown): StripeSession => {
  const s = readStripeSession(o);
  if (!s) throw new Error("unreadable");
  return s;
};

describe("readStripeSession [ADR 0008, L10]", () => {
  it("reads the expanded session, its intent, charge and balance transaction; nothing personal", () => {
    const s = read(fetched());
    expect(s).toEqual({
      id: SESSION_ID,
      status: "complete",
      paymentStatus: "paid",
      livemode: false,
      clientReferenceId: CHECKOUT_ID,
      metadata: { checkoutId: CHECKOUT_ID, documentId: DOC_ID, env: "staging" },
      currency: "usd",
      amountTotal: 500_00,
      pi: {
        id: PI,
        status: "succeeded",
        amountReceived: 500_00,
        currency: "usd",
        metadata: { checkoutId: CHECKOUT_ID, documentId: DOC_ID, env: "staging" },
      },
      charge: { created: NOW, status: "succeeded", captured: true, methodType: "card" },
      bt: { currency: "inr", amount: 41_500_00, fee: 1_800_00, feeTax: 274_58 },
    });
    expect(JSON.stringify(s)).not.toMatch(/Jane|4242|visa|example\.test/);
  });

  it("an open session has no intent; a charge with no balance transaction yet; no fee details", () => {
    expect(
      read(
        fetched({
          status: "open",
          payment_status: "unpaid",
          payment_intent: null,
          client_reference_id: null,
        }),
      ),
    ).toMatchObject({
      pi: null,
      charge: null,
      bt: null,
      clientReferenceId: null,
    });
    expect(read(fetched({}, {}, {}, null)).bt).toBeNull();
    expect(read(fetched({}, { latest_charge: null })).charge).toBeNull();
    expect(read(fetched({}, {}, { payment_method_details: null })).charge?.methodType).toBeNull();
    expect(read(fetched({}, {}, {}, { amount: 100, currency: "inr", fee: 3 })).bt).toEqual({
      currency: "inr",
      amount: 100,
      fee: 3,
      feeTax: 0,
    });
  });

  it("refuses an unexpanded id, a missing field or an unsafe amount", () => {
    for (const bad of [
      null,
      fetched({ object: "payment_intent" }),
      fetched({ id: "pi_1" }),
      fetched({ status: "done" }),
      fetched({ payment_status: "maybe" }),
      fetched({ livemode: "no" }),
      fetched({ currency: "US" }),
      fetched({ amount_total: 2 ** 60 }),
      fetched({ client_reference_id: 5 }),
      fetched({ payment_intent: PI }),
      fetched({}, { id: "ch_1" }),
      fetched({}, { amount_received: -1 }),
      fetched({}, { latest_charge: "ch_3Qabc" }),
      fetched({}, {}, { created: "now" }),
      fetched({}, {}, { captured: "yes" }),
      fetched({}, {}, {}, "txn_1"),
      fetched({}, {}, {}, { amount: 1.5, currency: "inr", fee: 0 }),
      fetched({}, {}, {}, { amount: 100, currency: "inr", fee: -1 }),
      fetched({}, {}, {}, { amount: 100, currency: "inr", fee: 3, fee_details: "x" }),
      fetched({}, {}, {}, { amount: 100, currency: "inr", fee: 3, fee_details: [null] }),
      fetched(
        {},
        {},
        {},
        { amount: 100, currency: "inr", fee: 3, fee_details: [{ type: "tax", amount: 2 ** 60 }] },
      ),
    ])
      expect(readStripeSession(bad)).toBeNull();
  });
});

describe("judgeStripeSession [ADR 0008, L5, L6; every verdict]", () => {
  it("ok when everything matches", () => {
    expect(judgeStripeSession(row, read(fetched()), false)).toEqual({ ok: true });
  });

  it.each([
    ["livemode_mismatch", fetched({ livemode: true }), row],
    ["reference_mismatch", fetched({ id: `cs_test_other${"C".repeat(40)}` }), row],
    ["reference_mismatch", fetched({ client_reference_id: uuidv7() }), row],
    ["reference_mismatch", fetched({ metadata: { ...marks, techaust_document_id: "other" } }), row],
    ["reference_mismatch", fetched({ metadata: {} }), row],
    ["reference_mismatch", fetched({}, { metadata: { ...marks, techaust_checkout_id: uuidv7() } }), row],
    ["reference_mismatch", fetched(), { ...row, env: "local" }],
    ["reference_mismatch", fetched(), { ...row, providerLinkId: null }],
    ["checkout_expired", fetched({ status: "expired", payment_status: "unpaid", payment_intent: null }), row],
    ["checkout_open", fetched({ status: "open", payment_status: "unpaid", payment_intent: null }), row],
    ["not_paid", fetched({ payment_status: "unpaid" }, { status: "processing" }), row],
    ["not_captured", fetched({ payment_status: "no_payment_required" }), row],
    ["not_captured", fetched({ payment_intent: null }), row],
    ["not_captured", fetched({}, { status: "requires_capture" }), row],
    ["not_captured", fetched({}, { latest_charge: null }), row],
    ["not_captured", fetched({}, {}, { status: "pending" }), row],
    ["not_captured", fetched({}, {}, { captured: false }), row],
    ["currency_mismatch", fetched({ currency: "eur" }), row],
    ["currency_mismatch", fetched({}, { currency: "inr" }), row],
    ["currency_mismatch", fetched(), { ...row, currency: "INR" }],
    ["amount_mismatch", fetched({ amount_total: 499_99 }), row],
    ["amount_mismatch", fetched({}, { amount_received: 499_00 }), row],
  ] as const)("%s", (verdict, session, r) => {
    expect(judgeStripeSession(r, read(session), false)).toEqual({ ok: false, verdict });
  });

  it("the verdicts are listed once each", () => {
    expect(new Set(STRIPE_JUDGE_VERDICTS).size).toBe(STRIPE_JUDGE_VERDICTS.length);
  });
});

// ---- mapping, keys --------------------------------------------------------------------------------------------------------------------------------------------

describe("the payment row's fields [ADM-PAY-03, L10, L11; 08-C RA-37]", () => {
  it("the row id, the mode and the received day (IST)", () => {
    expect(stripePaymentRowId(PI)).toBe(`stp_${PI}`);
    expect(stripeModeOf("card")).toBe("card");
    expect(stripeModeOf("link")).toBe("other");
    expect(stripeModeOf(null)).toBe("other");
    // 2026-10-31 20:00 UTC is 1 November in IST.
    expect(receivedOnOf(Date.UTC(2026, 9, 31, 20, 0))).toBe("2026-11-01");
    expect(receivedOnOf(Date.UTC(2026, 9, 31, 18, 0))).toBe("2026-10-31");
  });

  it("the reference: the id in the stored form, at most 60 characters (a 255-character id hashed)", async () => {
    expect(await stripeReferenceNorm(PI)).toBe("PI-3QABCDEF123");
    expect(await stripeReferenceNorm("ch_1")).toBeNull();
    expect(await stripeReferenceNorm("pi_bad id")).toBeNull();
    const sixty = `pi_${"a".repeat(57)}`;
    expect(await stripeReferenceNorm(sixty)).toBe(sixty.replace("_", "-").toUpperCase());
    for (const id of [`pi_${"a".repeat(58)}`, `pi_${"Z9_".repeat(84)}`]) {
      const n = await stripeReferenceNorm(id);
      const h = createHash("sha256").update(id).digest("hex").slice(0, 12).toUpperCase();
      expect(n).toBe(`${id.replaceAll("_", "-").toUpperCase().slice(0, 44)}-${h}`);
      expect(n).toMatch(/^[A-Z0-9/-]{57}$/);
    }
    expect(`pi_${"Z9_".repeat(84)}`.length).toBe(255);
  });

  it("the INR facts only from an INR balance transaction; a fee tax above the fee is dropped", () => {
    expect(inrFactsOf({ currency: "inr", amount: 41_500_00, fee: 1_800_00, feeTax: 274_58 })).toEqual({
      inrReceivedMinor: 41_500_00,
      gatewayFeeInrMinor: 1_800_00,
      gatewayFeeTaxInrMinor: 274_58,
    });
    const none = { inrReceivedMinor: null, gatewayFeeInrMinor: null, gatewayFeeTaxInrMinor: null };
    expect(inrFactsOf({ currency: "usd", amount: 500_00, fee: 20_00, feeTax: 0 })).toEqual(none);
    expect(inrFactsOf(null)).toEqual(none);
    expect(inrFactsOf({ currency: "inr", amount: 0, fee: 5, feeTax: 9 })).toEqual({
      inrReceivedMinor: null,
      gatewayFeeInrMinor: 5,
      gatewayFeeTaxInrMinor: null,
    });
  });
});

describe("the key guard [ADM-PAY-11, L3, CLAUDE.md rule 7]", () => {
  it("restricted keys only; live only with Settings live and the flag exactly true", () => {
    expect(stripeKeyModeOf("rk_test_abc123")).toBe("test");
    expect(stripeKeyModeOf("rk_live_abc123")).toBe("live");
    for (const k of [
      "sk_test_abc",
      "sk_live_abc",
      "pk_test_abc",
      "rk_test_",
      "rk_test_a-b",
      5,
      null,
      `rk_test_${"a".repeat(250)}`,
    ])
      expect(stripeKeyModeOf(k)).toBeNull();
    expect(stripeAllowed("rk_test_abc", "test", "false")).toBe(true);
    expect(stripeAllowed("rk_test_abc", "live", "true")).toBe(false);
    expect(stripeAllowed("sk_test_abc", "test", "false")).toBe(false);
    expect(stripeAllowed("rk_live_abc", "live", "false")).toBe(false);
    expect(stripeAllowed("rk_live_abc", "live", undefined)).toBe(false);
    expect(stripeAllowed("rk_live_abc", "test", "true")).toBe(false);
    expect(stripeAllowed("rk_live_abc", "live", "true")).toBe(true);
    expect(stripeAllowed(undefined, "test", "false")).toBe(false);
  });

  it("the API version is pinned", () => {
    expect(STRIPE_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.[a-z]+$/);
  });
});
