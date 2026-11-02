// M6.4 PayPal in the database [ADM-PAY-01, -03, -04, -06, -07, ADM-INV-10, ADM-INV-17, JOB-HOOK-02, POR-06; m6.4 run file A, I and "Step 0 results" 0.2]: 0067 creates
// and adds only, 0068 recreates exactly its triggers and adds the new ones, the lists equal the schema's; the PayPal payment shape (USD, the fee by its currency,
// never rejected or withdrawn); the checkout flow with `capture_pending`, the capture id set once, the claim held and no local end of a claimed row; the capture
// claim (one of two at once, a stale claim retaken, refused for a document that can't take the amount); the pending rule, the void and withdraw blockers (L24);
// a PayPal payment recorded from a held capture and on an ended checkout (never dropped); the sweep's statements; the advice archive; and the EXPLAIN plans.
// Raw SQL and the real statement builders; all names, ids and amounts are invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import {
  PAYPAL_CAPTURE_GRACE_MS as CORE_GRACE,
  PAYPAL_CLAIM_STALE_MS as CORE_STALE,
  PAYPAL_ORDER_LIFETIME_MS,
} from "@techaust/core/paypal";
import { describe, expect, it } from "vitest";
import {
  ADVICE_PAYMENTS_SQL,
  ADVICE_READ_SQL,
  ADVICES_SQL,
  adviceCreateStatement,
  adviceFileStatement,
  adviceLinkStatement,
  adviceUnlinkStatement,
  PAYMENT_ADVICE_SQL,
  PAYMENTS_WITHOUT_ADVICE_COUNT_SQL,
  PAYMENTS_WITHOUT_ADVICE_SQL,
} from "../src/advices.ts";
import {
  CHECKOUT_BY_CAPTURE_SQL,
  checkoutCaptureIdStatement,
  checkoutCapturePendingStatement,
  checkoutCreateStatement,
  checkoutEndStatement,
  checkoutFailStatement,
  checkoutLiveStatement,
  checkoutRefreshClaimStatement,
  type GatewayPaymentArgs,
  PAYPAL_CAPTURE_GRACE_MS,
  PAYPAL_CLAIM_STALE_MS,
  PAYPAL_HELD_CAPTURES_SQL,
  PAYPAL_STALE_CLAIMS_SQL,
  paypalAbandonStatements,
  paypalCaptureClaimStatement,
  paypalCaptureReleaseStatement,
  paypalExpireUnclaimedStatement,
  recordGatewayPaymentStatements,
} from "../src/gateway.ts";
import {
  PAYMENT_ASKS_FOR_DOCUMENT_SQL,
  PENDING_CAPTURE,
  PENDING_GATEWAY,
  paymentPendingKindsSql,
} from "../src/ledger.ts";
import { guardSql } from "../src/log.ts";
import {
  ADVICE_KINDS,
  ADVICE_PROVIDERS,
  CHECKOUT_STATUSES,
  GATEWAY_PROVIDERS,
  PAYMENT_PROVIDERS,
  REVIEW_KINDS,
} from "../src/schema/payments.ts";
import { gatewayPaymentPendingSql } from "../src/sql-rules.ts";
import {
  ADVICE_KINDS_0068,
  ADVICE_PROVIDERS_0068,
  CHECKOUT_STATUSES_0068,
  GATEWAY_PROVIDERS_0068,
  PAYMENT_PROVIDERS_0068,
  PAYPAL_NEW_0068,
  PAYPAL_RECREATED_0068,
  REVIEW_KINDS_0068,
} from "../src/triggers.ts";
import { mkClientRow, mkContact, mkMember, next } from "./billing-helpers.ts";
import { all, first, rejects, run } from "./helpers.ts";

const T = 1_860_000_000_000;
let clock = T;
const tick = () => (clock += 10);
const db = () => env.DB;
const order = () => `${String(next()).padStart(6, "0")}TN364715T`;
const captureId = () => `2GG${String(next()).padStart(8, "0")}U47193P`;

/** An issued document written straight in, in a currency, with its balance. */
async function mkDoc(
  clientId: string,
  o: { type?: string; currency?: "INR" | "USD"; balance?: number; status?: string } = {},
): Promise<string> {
  const id = uuidv7();
  const n = next();
  await run(
    `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor, content_sha256, updated_at, voided_at, void_reason)
     VALUES (?1, ?2, ?3, ?4, ?5, 'ppl-s', '9999', ?6, ?7, 1000, '2026-10-28', '2026-11-04', 50000, 50000, 50000, ?8, ?9, 7000, ?10, ?11)`,
    id,
    o.type ?? "export_invoice",
    o.status ?? "issued",
    clientId,
    o.currency ?? "USD",
    n,
    `P/${n}`,
    o.balance ?? 50_000,
    "h".repeat(64),
    o.status === "void" ? 5 : null,
    o.status === "void" ? "x" : null,
  );
  return id;
}

async function world(o: { type?: string; balance?: number } = {}) {
  const owner = await mkMember("owner");
  const clientId = await mkClientRow({ currency: "USD" });
  const contactId = await mkContact(clientId);
  const documentId = await mkDoc(clientId, o);
  return { owner, clientId, contactId, documentId };
}

/** A PayPal checkout made through the real create statement, then live with its order id and approval URL. */
async function payPalCheckout(
  w: { documentId: string; clientId: string; contactId: string },
  o: { amount?: number; live?: boolean; expiresAt?: number } = {},
): Promise<{ id: string; orderId: string; changes: number; expiresAt: number }> {
  const id = uuidv7();
  const now = tick();
  const expiresAt = o.expiresAt ?? now + PAYPAL_ORDER_LIFETIME_MS;
  const r = await checkoutCreateStatement(db(), {
    id,
    provider: "paypal",
    documentId: w.documentId,
    clientId: w.clientId,
    source: "portal",
    contactId: w.contactId,
    docTokenId: null,
    createdBy: null,
    amountMinor: o.amount ?? 50_000,
    floorMinor: 10_000,
    maxMinor: 2_500_000,
    expiresAt,
    now,
  }).run();
  const orderId = order();
  if (r.meta.changes === 1 && o.live !== false)
    await checkoutLiveStatement(db(), {
      id,
      providerLinkId: orderId,
      shortUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`,
      expiresAt,
      now: tick(),
    }).run();
  return { id, orderId, changes: r.meta.changes, expiresAt };
}

const claim = async (id: string, now = tick()) =>
  (await paypalCaptureClaimStatement(db(), { id, now }).run()).meta.changes;
const row = (id: string) =>
  first<{
    status: string;
    provider_capture_id: string | null;
    capture_started_at: number | null;
    paid_payment_id: string | null;
  }>(
    "SELECT status, provider_capture_id, capture_started_at, paid_payment_id FROM checkout_sessions WHERE id = ?",
    id,
  );

type PplRow = Partial<{
  id: string;
  status: string;
  currency: string;
  kind: string;
  mode: string | null;
  ref: string | null;
  charges: number;
  feeTax: number | null;
  inr: number | null;
  fee: number | null;
  feeTaxInr: number | null;
  ppid: string | null;
  checkoutId: string | null;
}>;

/** A PayPal payment row written straight in (confirmed by the gateway unless told otherwise). */
async function pplPay(clientId: string, checkoutId: string, o: PplRow = {}): Promise<string> {
  const cap = captureId();
  const id = o.id ?? `ppl_${cap}`;
  const status = o.status ?? "confirmed";
  await run(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, received_on, mode, reference_norm,
       recorded_by, recorded_at, verified_by, verified_at, provider_payment_id, checkout_id, fee_tax_minor, refetched_at, inr_received_minor, gateway_fee_inr_minor, gateway_fee_tax_inr_minor)
     VALUES (?1, ?2, ?3, 'paypal', ?4, ?5, 50000, ?6, '2026-11-02', ?7, ?8, NULL, ?9, NULL, ?10, ?11, ?12, ?13, ?9, ?14, ?15, ?16)`,
    id,
    clientId,
    o.kind ?? "payment",
    status,
    o.currency ?? "USD",
    o.charges ?? 2_190,
    o.mode === undefined ? "wallet" : o.mode,
    o.ref === undefined ? `PPL-${cap}` : o.ref,
    T,
    status === "confirmed" ? T : null,
    o.ppid === undefined ? cap : o.ppid,
    o.checkoutId === undefined ? checkoutId : o.checkoutId,
    o.feeTax === undefined ? null : o.feeTax,
    o.inr === undefined ? 41_500_00 : o.inr,
    o.fee === undefined ? null : o.fee,
    o.feeTaxInr === undefined ? null : o.feeTaxInr,
  );
  return id;
}

const pplArgs = (
  w: { clientId: string; documentId: string; checkoutId: string },
  over: Partial<GatewayPaymentArgs> = {},
): GatewayPaymentArgs => {
  const cap = captureId();
  const now = tick();
  return {
    provider: "paypal",
    providerPaymentId: cap,
    paymentId: `ppl_${cap}`,
    checkoutId: w.checkoutId,
    clientId: w.clientId,
    documentId: w.documentId,
    webhookEventId: null,
    source: "refresh",
    status: "confirmed",
    amountMinor: 50_000,
    feeMinor: 2_190,
    feeTaxMinor: null,
    inrReceivedMinor: 41_500_00,
    gatewayFeeInrMinor: null,
    gatewayFeeTaxInrMinor: null,
    receivedOn: "2026-11-02",
    mode: "wallet",
    referenceNorm: `PPL-${cap}`,
    refetchedAt: now - 1,
    now,
    allocate: { allocationId: uuidv7(), overpaidReviewId: uuidv7(), facts: { linkId: "x" } },
    requestedAllocations: null,
    checkoutPaid: true,
    providerCaptureId: cap,
    staleOthers: true,
    event: null,
    bell: null,
    ...over,
  };
};

async function writePayment(
  a: GatewayPaymentArgs,
  extra: (g: ReturnType<typeof guardSql>) => D1PreparedStatement[] = () => [],
) {
  const auditId = uuidv7();
  const s = recordGatewayPaymentStatements(db(), a, guardSql({ auditId }));
  const audit = db()
    .prepare(
      "INSERT INTO audit_log (id, actor_type, actor_id, role, action, entity_type, entity_id) SELECT ?1, 'contact', NULL, NULL, 'payment.gateway', 'payment', ?2 WHERE changes() > 0",
    )
    .bind(auditId, a.paymentId);
  const res = await db().batch([s.main, audit, ...s.side, ...extra(s.guard), ...s.last]);
  return res[1]?.meta.changes === 1;
}

// ---- migrations --------------------------------------------------------------------------------------------------------------------------------------------

describe("0067 and 0068: no rebuild, the pinned lists [run file A]", () => {
  it("0067 only creates the advice tables and indexes and adds the two checkout columns", () => {
    const m = env.TEST_MIGRATIONS.find((x) => x.name === "0067_paypal.sql");
    const qs = (m?.queries ?? []).map((x) => x.replace(/^(\s|--> statement-breakpoint)+/, "").trim());
    for (const q of qs)
      expect(q, q.slice(0, 70)).toMatch(
        /^(CREATE TABLE `realisation_advice|CREATE INDEX|CREATE UNIQUE INDEX|ALTER TABLE `checkout_sessions` ADD `(provider_capture_id|capture_started_at)`)/,
      );
    expect(qs.join("\n")).not.toMatch(/DROP|__new_|INSERT INTO/);
    expect(qs.filter((q) => q.startsWith("ALTER TABLE"))).toHaveLength(2);
  });

  it("0068 drops exactly the triggers it creates again, then adds the new ones, and touches nothing else", () => {
    const m = env.TEST_MIGRATIONS.find((x) => x.name === "0068_paypal_triggers.sql");
    const text = (m?.queries ?? []).join("\n");
    expect(text).not.toMatch(/DROP TABLE|DROP INDEX|__new_|ALTER TABLE|INSERT INTO|CREATE TABLE/);
    const dropped = [...text.matchAll(/DROP TRIGGER `([a-z_]+)`/g)].map((x) => x[1]);
    const created = [...text.matchAll(/CREATE TRIGGER `([a-z_]+)`/g)].map((x) => x[1]);
    expect(dropped).toEqual([...PAYPAL_RECREATED_0068]);
    expect(created).toEqual([...PAYPAL_RECREATED_0068, ...PAYPAL_NEW_0068]);
  });

  it("the lists of 0068 are the schema's lists today", () => {
    expect(PAYMENT_PROVIDERS_0068).toEqual(PAYMENT_PROVIDERS);
    expect(GATEWAY_PROVIDERS_0068).toEqual(GATEWAY_PROVIDERS);
    expect(CHECKOUT_STATUSES_0068).toEqual(CHECKOUT_STATUSES);
    expect(REVIEW_KINDS_0068).toEqual(REVIEW_KINDS);
    expect(ADVICE_PROVIDERS_0068).toEqual(ADVICE_PROVIDERS);
    expect(ADVICE_KINDS_0068).toEqual(ADVICE_KINDS);
  });

  it("the capture grace and the stale claim equal core's", () => {
    expect(PAYPAL_CAPTURE_GRACE_MS).toBe(CORE_GRACE);
    expect(PAYPAL_CLAIM_STALE_MS).toBe(CORE_STALE);
  });
});

// ---- the PayPal payment shape ------------------------------------------------------------------------------------------------------------------------------

describe("a PayPal payment's shape and moves [L8, L22; Step 0 item 5]", () => {
  it("USD money received through PayPal: wallet, card or other; the fee in the column of its own currency, never both", async () => {
    const w = await world();
    const co = await payPalCheckout(w);
    await pplPay(w.clientId, co.id);
    await pplPay(w.clientId, co.id, { mode: "card", status: "pending_verification" });
    await pplPay(w.clientId, co.id, { mode: "other", charges: 0, fee: 4_500_00, inr: null });
    await pplPay(w.clientId, co.id, { charges: 0, fee: null, inr: null });
    for (const [o, re] of [
      [{ currency: "INR", inr: null }, /payments_gateway_shape/],
      [{ kind: "tds" }, /payments_gateway_shape/],
      [{ mode: "upi" }, /payments_gateway_shape/],
      [{ mode: "neft" }, /payments_gateway_shape/],
      [{ mode: null }, /payments_gateway_shape/],
      [{ ref: null }, /payments_gateway_shape/],
      [{ ppid: "A".repeat(65) }, /payments_gateway_shape/],
      [{ feeTax: 10 }, /payments_gateway_shape/],
      [{ fee: 100, charges: 2_190 }, /payments_gateway_shape/],
      [{ fee: -1, charges: 0 }, /payments_gateway_shape/],
      [{ fee: 100, charges: 0, feeTaxInr: 18 }, /payments_gateway_shape/],
      [{ checkoutId: null }, /payments_insert_state/],
      [{ ppid: null }, /payments_insert_state/],
    ] as const)
      await rejects(pplPay(w.clientId, co.id, o as PplRow), re);
  });

  it("one row per capture (a replay with another row id is refused by the unique provider reference)", async () => {
    const w = await world();
    const co = await payPalCheckout(w);
    const cap = captureId();
    await pplPay(w.clientId, co.id, { ppid: cap });
    await rejects(pplPay(w.clientId, co.id, { ppid: cap, id: `ppl_x${cap}` }), /UNIQUE/);
  });

  it("never rejected or withdrawn; pending is confirmed only by an active Owner (the proforma path), never by the system", async () => {
    const w = await world();
    const co = await payPalCheckout(w);
    const confirmed = await pplPay(w.clientId, co.id);
    await rejects(
      run(
        "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = ?3, withdraw_reason = 'x' WHERE id = ?1",
        confirmed,
        w.owner,
        T,
      ),
      /payments_status_flow/,
    );
    const pending = await pplPay(w.clientId, co.id, { status: "pending_verification" });
    await rejects(
      run(
        "UPDATE payments SET status = 'rejected', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
        pending,
        w.owner,
        T,
      ),
      /payments_status_flow/,
    );
    await rejects(
      run("UPDATE payments SET status = 'confirmed', verified_at = ?2 WHERE id = ?1", pending, T),
      /payments_status_flow/,
    );
    await run(
      "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
      pending,
      w.owner,
      T,
    );
  });
});

// ---- the checkout flow --------------------------------------------------------------------------------------------------------------------------------

describe("the checkout flow with capture_pending, the capture id and the claim [A; re-check N1, reviewer H1]", () => {
  it("live → capture_pending with its capture id → paid with its payment; failed from capture_pending; no capture id, no move", async () => {
    const w = await world();
    const co = await payPalCheckout(w);
    await rejects(
      run("UPDATE checkout_sessions SET status = 'capture_pending' WHERE id = ?", co.id),
      /checkout_sessions_capture_update/,
    );
    const cap = captureId();
    expect(
      (await checkoutCapturePendingStatement(db(), { id: co.id, captureId: cap, now: tick() }).run()).meta
        .changes,
    ).toBe(1);
    expect(await row(co.id)).toMatchObject({ status: "capture_pending", provider_capture_id: cap });
    // Set once; never ended locally from capture_pending; paid needs its payment.
    await rejects(
      run("UPDATE checkout_sessions SET provider_capture_id = 'OTHER1' WHERE id = ?", co.id),
      /checkout_sessions_capture_update/,
    );
    await rejects(
      run("UPDATE checkout_sessions SET status = 'expired' WHERE id = ?", co.id),
      /checkout_sessions_status_flow/,
    );
    await rejects(
      run("UPDATE checkout_sessions SET status = 'live' WHERE id = ?", co.id),
      /checkout_sessions_status_flow/,
    );
    await rejects(
      run("UPDATE checkout_sessions SET status = 'paid' WHERE id = ?", co.id),
      /checkout_sessions_status_flow/,
    );
    const failing = await payPalCheckout({ ...w, documentId: await mkDoc(w.clientId) });
    await checkoutCapturePendingStatement(db(), {
      id: failing.id,
      captureId: captureId(),
      now: tick(),
    }).run();
    expect(
      (await checkoutFailStatement(db(), { id: failing.id, now: tick(), from: "open" }).run()).meta.changes,
    ).toBe(1);
    expect((await row(failing.id))?.status).toBe("failed");
  });

  it("early check 1 finding 4: a fail from 'open' never ends a row whose capture another call claimed; with its own claim, or none, it does", async () => {
    const w = await world();
    const co = await payPalCheckout(w);
    const at = tick();
    expect(await claim(co.id, at)).toBe(1);
    const fail = (claimAt?: number) =>
      checkoutFailStatement(db(), { id: co.id, now: tick(), from: "open", claim: claimAt ?? null }).run();
    expect((await fail()).meta.changes).toBe(0);
    expect((await fail(at - 1)).meta.changes).toBe(0);
    expect((await row(co.id))?.status).toBe("live");
    expect((await fail(at)).meta.changes).toBe(1);
    expect((await row(co.id))?.status).toBe("failed");
    const free = await payPalCheckout({ ...w, documentId: await mkDoc(w.clientId) });
    expect(
      (await checkoutFailStatement(db(), { id: free.id, now: tick(), from: "open" }).run()).meta.changes,
    ).toBe(1);
  });

  it("capture_pending, a capture id and a claim are PayPal's only; a new checkout has none", async () => {
    const w = await world();
    const stripe = uuidv7();
    await checkoutCreateStatement(db(), {
      id: stripe,
      provider: "stripe",
      documentId: w.documentId,
      clientId: w.clientId,
      source: "portal",
      contactId: w.contactId,
      docTokenId: null,
      createdBy: null,
      amountMinor: 50_000,
      floorMinor: 10_000,
      maxMinor: null,
      expiresAt: T + 3_600_000,
      now: tick(),
    }).run();
    await checkoutLiveStatement(db(), {
      id: stripe,
      providerLinkId: `cs_test_${uuidv7().replaceAll("-", "")}`,
      shortUrl: "https://checkout.stripe.com/c/pay/x",
      expiresAt: T + 3_600_000,
      now: tick(),
    }).run();
    await rejects(
      run("UPDATE checkout_sessions SET capture_started_at = ?2 WHERE id = ?1", stripe, tick()),
      /checkout_sessions_capture_update/,
    );
    await rejects(
      run(
        "UPDATE checkout_sessions SET status = 'capture_pending', provider_capture_id = 'X1' WHERE id = ?",
        stripe,
      ),
      /checkout_sessions_(status_flow|capture_update)/,
    );
    expect(await claim(stripe)).toBe(0);
    await rejects(
      run(
        `INSERT INTO checkout_sessions (id, provider, document_id, client_id, contact_id, source, currency, amount_minor, status, expires_at, created_at, updated_at, capture_started_at)
         VALUES (?1, 'paypal', ?2, ?3, ?4, 'portal', 'USD', 100, 'creating', ?5, ?5, ?5, ?5)`,
        uuidv7(),
        w.documentId,
        w.clientId,
        w.contactId,
        T,
      ),
      /checkout_sessions_capture_insert/,
    );
  });

  it("the claim moves forward or is released only while live or stale; a capture id never sits on an open row", async () => {
    const w = await world();
    const co = await payPalCheckout(w);
    const at = tick();
    expect(await claim(co.id, at)).toBe(1);
    await rejects(
      run("UPDATE checkout_sessions SET capture_started_at = ?2 WHERE id = ?1", co.id, at - 5),
      /checkout_sessions_capture_update/,
    );
    await rejects(
      run("UPDATE checkout_sessions SET provider_capture_id = 'X2' WHERE id = ?", co.id),
      /checkout_sessions_capture_update/,
    );
    // A release only with the claim this call took.
    expect(
      (await paypalCaptureReleaseStatement(db(), { id: co.id, claim: at - 1, now: tick() }).run()).meta
        .changes,
    ).toBe(0);
    expect(
      (await paypalCaptureReleaseStatement(db(), { id: co.id, claim: at, now: tick() }).run()).meta.changes,
    ).toBe(1);
    expect((await row(co.id))?.capture_started_at).toBeNull();
  });

  it("a claimed row is never ended locally; the abandon batch releases then ends it, and a fresh claim in between keeps it live", async () => {
    const w = await world();
    const co = await payPalCheckout(w);
    const at = tick();
    await claim(co.id, at);
    expect(
      (await checkoutEndStatement(db(), { id: co.id, status: "cancelled", now: tick() }).run()).meta.changes,
    ).toBe(0);
    await rejects(
      run("UPDATE checkout_sessions SET status = 'expired' WHERE id = ?", co.id),
      /checkout_sessions_claimed_no_end/,
    );
    await rejects(
      run("UPDATE checkout_sessions SET status = 'expired', capture_started_at = NULL WHERE id = ?", co.id),
      /checkout_sessions_(claimed_no_end|capture_update)/,
    );
    // The abandon batch with a claim that is no longer the one held ends nothing.
    await db().batch(paypalAbandonStatements(db(), { id: co.id, claim: at - 1, now: tick() }));
    expect(await row(co.id)).toMatchObject({ status: "live", capture_started_at: at });
    await db().batch(paypalAbandonStatements(db(), { id: co.id, claim: at, now: tick() }));
    expect(await row(co.id)).toMatchObject({ status: "expired", capture_started_at: null });
  });
});

// ---- the capture claim ------------------------------------------------------------------------------------------------------------------------------------

describe("paypalCaptureClaimStatement [L2, L5; run file C step 2]", () => {
  it("two claims at once: one wins; a stale claim (2 minutes) is taken again", async () => {
    const w = await world();
    const co = await payPalCheckout(w);
    const at = tick();
    const [a, b] = await db().batch([
      paypalCaptureClaimStatement(db(), { id: co.id, now: at }),
      paypalCaptureClaimStatement(db(), { id: co.id, now: at + 1 }),
    ]);
    expect([a?.meta.changes, b?.meta.changes]).toEqual([1, 0]);
    expect(await claim(co.id, at + PAYPAL_CLAIM_STALE_MS - 1)).toBe(0);
    expect(await claim(co.id, at + PAYPAL_CLAIM_STALE_MS)).toBe(1);
  });

  it("only within expires_at + 30 minutes, only for a live or stale PayPal checkout with its order", async () => {
    const w = await world();
    const co = await payPalCheckout(w);
    expect(await claim(co.id, co.expiresAt + PAYPAL_CAPTURE_GRACE_MS + 1)).toBe(0);
    expect(await claim(co.id, co.expiresAt + PAYPAL_CAPTURE_GRACE_MS)).toBe(1);
    const creating = await payPalCheckout({ ...w, documentId: await mkDoc(w.clientId) }, { live: false });
    expect(await claim(creating.id)).toBe(0);
  });

  it("refused when the document is void, the amount is above its (live) balance, the client is anonymised, or other gateway money waits", async () => {
    const w = await world();
    const co = await payPalCheckout(w, { amount: 40_000 });
    await run(
      "UPDATE documents SET status = 'void', voided_at = 9, void_reason = 'x' WHERE id = ?",
      w.documentId,
    );
    expect(await claim(co.id)).toBe(0);

    // The balance moved after the checkout was made: another payment of 20,000 was confirmed and allocated (the balance and the allocation rows both say
    // 30,000 now), so the 40,000 checkout can't be captured; a 30,000 one can.
    const w2 = await world();
    const co2 = await payPalCheckout(w2, { amount: 40_000 });
    await run("UPDATE checkout_sessions SET status = 'stale' WHERE id = ?", co2.id);
    const first20 = await payPalCheckout(w2, { amount: 20_000 });
    expect(
      await writePayment(
        pplArgs(
          { clientId: w2.clientId, documentId: w2.documentId, checkoutId: first20.id },
          { amountMinor: 20_000 },
        ),
      ),
    ).toBe(true);
    expect(
      (
        await first<{ balance_minor: number }>(
          "SELECT balance_minor FROM documents WHERE id = ?",
          w2.documentId,
        )
      )?.balance_minor,
    ).toBe(30_000);
    expect(await claim(co2.id)).toBe(0);
    const rest = await payPalCheckout(w2, { amount: 30_000 });
    expect(await claim(rest.id)).toBe(1);

    const w3 = await world();
    const co3 = await payPalCheckout(w3);
    await run("UPDATE clients SET anonymised_at = 5 WHERE id = ?", w3.clientId);
    expect(await claim(co3.id)).toBe(0);

    const w4 = await world();
    const co4 = await payPalCheckout(w4);
    await pplPay(w4.clientId, co4.id, { status: "pending_verification" });
    expect(await claim(co4.id)).toBe(0);
  });

  it("its own claim never blocks it: a stale claim is retaken", async () => {
    const w = await world();
    const co = await payPalCheckout(w);
    const at = tick();
    await claim(co.id, at);
    expect(await claim(co.id, at + PAYPAL_CLAIM_STALE_MS)).toBe(1);
  });
});

// ---- the pending rule and the void and withdraw blockers (L24) ---------------------------------------------------------------------------------------------

describe("a held or claimed PayPal capture counts as gateway money on its way [L24; Step 0.2 item 10]", () => {
  const pendingOf = async (doc: string) =>
    (
      await first<{ p: number }>(
        `SELECT ${gatewayPaymentPendingSql("d")} AS p FROM documents d WHERE d.id = ?1`,
        doc,
      )
    )?.p;
  const kindsOf = async (doc: string, client: string) =>
    (await first<{ k: number }>(`SELECT ${paymentPendingKindsSql("?1", "?2")} AS k`, doc, client))?.k;

  it("pending, the void facts and the pending kinds follow the claim and capture_pending, and a new checkout is refused", async () => {
    const w = await world();
    const co = await payPalCheckout(w);
    expect(await pendingOf(w.documentId)).toBe(0);
    expect(await kindsOf(w.documentId, w.clientId)).toBe(0);
    const at = tick();
    await claim(co.id, at);
    expect(await pendingOf(w.documentId)).toBe(1);
    // Early check 1 finding 8: its own bit (4), never the gateway payment's (2): there is no payment row to confirm.
    expect(await kindsOf(w.documentId, w.clientId)).toBe(PENDING_CAPTURE);
    expect(await first(PAYMENT_ASKS_FOR_DOCUMENT_SQL, w.documentId, w.clientId)).toEqual({
      pending: 1,
      recorded: 0,
    });
    await paypalCaptureReleaseStatement(db(), { id: co.id, claim: at, now: tick() }).run();
    expect(await pendingOf(w.documentId)).toBe(0);
    await checkoutCapturePendingStatement(db(), { id: co.id, captureId: captureId(), now: tick() }).run();
    expect(await pendingOf(w.documentId)).toBe(1);
    expect(await kindsOf(w.documentId, w.clientId)).toBe(PENDING_CAPTURE);
    // With a pending gateway payment on the same document too, both bits are set.
    await pplPay(w.clientId, co.id, {
      status: "pending_verification",
    });
    expect(await kindsOf(w.documentId, w.clientId)).toBe(PENDING_GATEWAY + PENDING_CAPTURE);
    // Pay again while PayPal holds it: no new checkout (409 payment_processing), whichever gateway.
    const again = await payPalCheckout(w);
    expect(again.changes).toBe(0);
  });
});

// ---- recording a PayPal payment --------------------------------------------------------------------------------------------------------------------------

describe("recordGatewayPaymentStatements for PayPal [ADM-PAY-03, -06; C steps 5 and 9]", () => {
  it("a confirmed capture on an export invoice: allocated, the invoice paid, the checkout paid with its capture id", async () => {
    const w = await world();
    const co = await payPalCheckout(w);
    await claim(co.id);
    const a = pplArgs({ clientId: w.clientId, documentId: w.documentId, checkoutId: co.id });
    expect(await writePayment(a)).toBe(true);
    expect(
      await first(
        "SELECT status, charges_minor, inr_received_minor, mode FROM payments WHERE id = ?",
        a.paymentId,
      ),
    ).toEqual({
      status: "confirmed",
      charges_minor: 2_190,
      inr_received_minor: 41_500_00,
      mode: "wallet",
    });
    expect(await row(co.id)).toMatchObject({
      status: "paid",
      provider_capture_id: a.providerCaptureId,
      paid_payment_id: a.paymentId,
    });
    expect(
      (await first<{ status: string }>("SELECT status FROM documents WHERE id = ?", w.documentId))?.status,
    ).toBe("paid");
    expect(await first(CHECKOUT_BY_CAPTURE_SQL, a.providerCaptureId)).toMatchObject({ id: co.id });
    // A replay with a new event id writes nothing.
    expect(await writePayment({ ...a, paymentId: `ppl_y${a.providerPaymentId}` })).toBe(false);
  });

  it("early check 1 finding 5: a PayPal paid move needs its capture id (TypeError); a row held with capture X is never paid by capture Y", async () => {
    const w = await world();
    const co = await payPalCheckout(w);
    const base = pplArgs({ clientId: w.clientId, documentId: w.documentId, checkoutId: co.id });
    expect(() => recordGatewayPaymentStatements(db(), { ...base, providerCaptureId: null })).toThrow(
      TypeError,
    );
    const x = captureId();
    await checkoutCapturePendingStatement(db(), { id: co.id, captureId: x, now: tick() }).run();
    // Capture Y, confirmed and paying the checkout: nothing is written (no payment, no allocation; the row stays held with X).
    expect(await writePayment(base)).toBe(false);
    expect(await first("SELECT id FROM payments WHERE id = ?", base.paymentId)).toBeNull();
    expect(await row(co.id)).toMatchObject({ status: "capture_pending", provider_capture_id: x });
    // The caller's "never drop" batch records Y pending, with no ledger move.
    expect(
      await writePayment({
        ...base,
        status: "pending_verification",
        allocate: null,
        checkoutPaid: false,
        staleOthers: false,
      }),
    ).toBe(true);
    expect(await first("SELECT status FROM payments WHERE id = ?", base.paymentId)).toEqual({
      status: "pending_verification",
    });
    expect(await row(co.id)).toMatchObject({ status: "capture_pending", provider_capture_id: x });
  });

  it("a capture PayPal held completes: capture_pending → paid, the same capture id kept", async () => {
    const w = await world();
    const co = await payPalCheckout(w);
    const cap = captureId();
    await checkoutCapturePendingStatement(db(), { id: co.id, captureId: cap, now: tick() }).run();
    const a = pplArgs(
      { clientId: w.clientId, documentId: w.documentId, checkoutId: co.id },
      {
        providerPaymentId: cap,
        paymentId: `ppl_${cap}`,
        referenceNorm: `PPL-${cap}`,
        providerCaptureId: cap,
      },
    );
    expect(await writePayment(a)).toBe(true);
    expect(await row(co.id)).toMatchObject({ status: "paid", provider_capture_id: cap });
  });

  it("never drop captured money: on an ended checkout the capture is recorded pending, with its capture id on the row", async () => {
    const w = await world();
    const co = await payPalCheckout(w);
    await checkoutEndStatement(db(), { id: co.id, status: "cancelled", now: tick() }).run();
    const a = pplArgs(
      { clientId: w.clientId, documentId: w.documentId, checkoutId: co.id },
      { status: "pending_verification", allocate: null, checkoutPaid: false, staleOthers: false },
    );
    // A confirmed write on an ended checkout matches nothing.
    expect(
      await writePayment({ ...a, status: "confirmed", allocate: pplArgs(a).allocate, checkoutPaid: true }),
    ).toBe(false);
    expect(
      await writePayment(a, (g) => [
        checkoutCaptureIdStatement(db(), { id: co.id, captureId: a.providerPaymentId, now: a.now }, g),
      ]),
    ).toBe(true);
    expect(await first("SELECT status FROM payments WHERE id = ?", a.paymentId)).toEqual({
      status: "pending_verification",
    });
    expect(await row(co.id)).toMatchObject({ status: "cancelled", provider_capture_id: a.providerPaymentId });
    expect(
      (
        await first<{ balance_minor: number }>(
          "SELECT balance_minor FROM documents WHERE id = ?",
          w.documentId,
        )
      )?.balance_minor,
    ).toBe(50_000);
    // Its capture id is set once.
    expect(
      (await checkoutCaptureIdStatement(db(), { id: co.id, captureId: "OTHER2", now: tick() }).run()).meta
        .changes,
    ).toBe(0);
  });

  it("a proforma's PayPal money waits for the Owner (pending, with its requested allocation)", async () => {
    const w = await world({ type: "proforma" });
    const co = await payPalCheckout(w);
    const a = pplArgs(
      { clientId: w.clientId, documentId: w.documentId, checkoutId: co.id },
      {
        status: "pending_verification",
        allocate: null,
        requestedAllocations: [{ documentId: w.documentId, amountMinor: 50_000 }],
      },
    );
    expect(await writePayment(a)).toBe(true);
    expect(await row(co.id)).toMatchObject({ status: "paid" });
    expect(await first("SELECT status FROM payments WHERE id = ?", a.paymentId)).toEqual({
      status: "pending_verification",
    });
  });
});

// ---- the sweep ----------------------------------------------------------------------------------------------------------------------------------------

describe("the PayPal sweep's statements [run file D]", () => {
  it("an unclaimed checkout past its grace expires; a claimed one is left for the refresh; held captures are read", async () => {
    const now = T + 400 * 86_400_000;
    const w = await world();
    const old = await payPalCheckout(w, { expiresAt: now - PAYPAL_CAPTURE_GRACE_MS - 1 });
    const w2 = await world();
    const claimed = await payPalCheckout(w2, { expiresAt: now - PAYPAL_CAPTURE_GRACE_MS - 1 });
    await claim(claimed.id, now - PAYPAL_CAPTURE_GRACE_MS - 10);
    const w3 = await world();
    const fresh = await payPalCheckout(w3, { expiresAt: now + 60_000 });
    // Earlier tests left older unclaimed checkouts: the sweep runs until nothing more expires (20 a run).
    for (let i = 0; i < 20 && (await paypalExpireUnclaimedStatement(db(), now).run()).meta.changes > 0; i++);
    expect((await row(old.id))?.status).toBe("expired");
    expect((await row(claimed.id))?.status).toBe("live");
    expect((await row(fresh.id))?.status).toBe("live");
    const stale = await all<{ id: string }>(
      PAYPAL_STALE_CLAIMS_SQL,
      now - PAYPAL_CLAIM_STALE_MS,
      now - 15 * 60_000,
    );
    expect(stale.map((r) => r.id)).toContain(claimed.id);
    // A refresh claim keeps it out of the next read until 15 minutes have passed.
    await checkoutRefreshClaimStatement(db(), { id: claimed.id, now }).run();
    const again = await all<{ id: string }>(
      PAYPAL_STALE_CLAIMS_SQL,
      now - PAYPAL_CLAIM_STALE_MS,
      now - 15 * 60_000,
    );
    expect(again.map((r) => r.id)).not.toContain(claimed.id);
    const w4 = await world();
    const held = await payPalCheckout(w4);
    await checkoutCapturePendingStatement(db(), { id: held.id, captureId: captureId(), now: tick() }).run();
    const heldRead = await all<{ id: string }>(PAYPAL_HELD_CAPTURES_SQL, now);
    expect(heldRead.map((r) => r.id)).toContain(held.id);
    expect((await checkoutRefreshClaimStatement(db(), { id: held.id, now }).run()).meta.changes).toBe(1);
  });
});

// ---- the advice archive -------------------------------------------------------------------------------------------------------------------------------

describe("remittance advices [L12; ADM-INV-17; 08-C RB-05]", () => {
  const mkAdvice = async (by: string, o: { provider?: "paypal" | "stripe" | "bank"; ref?: string } = {}) => {
    const id = uuidv7();
    const r = await adviceCreateStatement(db(), {
      id,
      provider: o.provider ?? "paypal",
      kind: "efira",
      adviceRef: o.ref ?? `FIRA-${next()}`,
      issuedOn: "2026-11-09",
      periodFrom: "2026-11-02",
      periodTo: "2026-11-08",
      inrTotalMinor: 83_000_00,
      note: null,
      recordedBy: by,
      now: tick(),
    }).run();
    return { id, changes: r.meta.changes };
  };
  const link = async (adviceId: string, ids: string[], by: string) =>
    (await adviceLinkStatement(db(), { adviceId, paymentIds: ids, by, now: tick() }).run()).meta.changes;

  it("create: an Owner or Staff member, one per provider, kind and reference; no file at first; the file set once", async () => {
    const owner = await mkMember("owner");
    const staff = await mkMember("staff");
    const a = await mkAdvice(staff, { ref: "FIRA-W45" });
    expect(a.changes).toBe(1);
    expect((await mkAdvice(owner, { ref: "FIRA-W45" })).changes).toBe(0);
    expect((await mkAdvice(owner, { ref: "FIRA-W45", provider: "bank" })).changes).toBe(1);
    expect((await mkAdvice(await mkMember("staff", "deactivated"))).changes).toBe(0);
    await rejects(
      run(
        "INSERT INTO realisation_advices (id, provider, kind, advice_ref, issued_on, recorded_by) VALUES (?1, 'venmo', 'efira', 'R', '2026-11-09', ?2)",
        uuidv7(),
        owner,
      ),
      /realisation_advices_insert/,
    );
    await rejects(
      run(
        "INSERT INTO realisation_advices (id, provider, kind, advice_ref, issued_on, recorded_by, file_r2_key, file_sha256, file_mime) VALUES (?1, 'paypal', 'efira', 'R2', '2026-11-09', ?2, 'k', ?3, 'application/pdf')",
        uuidv7(),
        owner,
        "a".repeat(64),
      ),
      /realisation_advices_insert/,
    );
    const file = {
      id: a.id,
      r2Key: `advices/${a.id}/file-${"b".repeat(64)}`,
      sha256: "b".repeat(64),
      mime: "application/pdf",
    };
    expect((await adviceFileStatement(db(), file).run()).meta.changes).toBe(1);
    expect((await adviceFileStatement(db(), { ...file, sha256: "c".repeat(64) }).run()).meta.changes).toBe(0);
    await rejects(
      run("UPDATE realisation_advices SET file_sha256 = ?2 WHERE id = ?1", a.id, "c".repeat(64)),
      /realisation_advices_fixed/,
    );
    await rejects(
      run("UPDATE realisation_advices SET advice_ref = 'X' WHERE id = ?", a.id),
      /realisation_advices_fixed/,
    );
    await rejects(run("DELETE FROM realisation_advices WHERE id = ?", a.id), /realisation_advices_no_delete/);
    const b = await mkAdvice(owner);
    await rejects(
      adviceFileStatement(db(), { id: b.id, r2Key: "k", sha256: "d".repeat(64), mime: "text/html" }).run(),
      /realisation_advices_fixed/,
    );
    expect(await first(ADVICE_READ_SQL, a.id)).toMatchObject({
      provider: "paypal",
      file_mime: "application/pdf",
    });
  });

  it("link: only confirmed USD PayPal payments of a live client, distinct, 1 to 50, on no other advice; all or none", async () => {
    const w = await world();
    const staff = await mkMember("staff");
    const co = await payPalCheckout(w);
    const p1 = await pplPay(w.clientId, co.id);
    const p2 = await pplPay(w.clientId, co.id);
    const pending = await pplPay(w.clientId, co.id, { status: "pending_verification" });
    const adv = await mkAdvice(staff);
    expect(await link(adv.id, [p1, pending], staff)).toBe(0);
    expect(await link(adv.id, [p1, p1], staff)).toBe(0);
    expect(await link(adv.id, [], staff)).toBe(0);
    expect(
      await link(
        adv.id,
        Array.from({ length: 51 }, () => p1),
        staff,
      ),
    ).toBe(0);
    expect(await link(adv.id, [p1, "no-such-payment"], staff)).toBe(0);
    expect(await link(adv.id, [p1, p2], await mkMember("staff", "deactivated"))).toBe(0);
    expect(await link(adv.id, [p1, p2], staff)).toBe(2);
    // Double link (here or on another advice) refused.
    expect(await link(adv.id, [p1], staff)).toBe(0);
    const other = await mkAdvice(staff);
    expect(await link(other.id, [p2], staff)).toBe(0);
    await rejects(
      run(
        "INSERT INTO realisation_advice_payments (id, advice_id, payment_id, created_by) VALUES (?1, ?2, ?3, ?4)",
        uuidv7(),
        other.id,
        p2,
        staff,
      ),
      /realisation_advice_payments_insert/,
    );
    // Another gateway's advice, or a bank advice, takes no PayPal payment.
    const stripeAdvice = await mkAdvice(staff, { provider: "stripe" });
    const p3 = await pplPay(w.clientId, co.id);
    expect(await link(stripeAdvice.id, [p3], staff)).toBe(0);
    const bank = await mkAdvice(staff, { provider: "bank" });
    expect(await link(bank.id, [p3], staff)).toBe(0);
    // A bank advice takes a confirmed manual entry.
    const manual = uuidv7();
    await run(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at, verified_by, verified_at)
       VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'USD', 1000, '2026-11-01', 'swift', ?3, ?4, ?3, ?4)`,
      manual,
      w.clientId,
      w.owner,
      T,
    );
    expect(await link(bank.id, [manual], staff)).toBe(1);
    // L30 (early check 1 finding 7): never a domestic client's manual entry, INR or USD (a FIRC or BRC proves export realisation only).
    const domestic = await mkClientRow();
    const domesticInr = uuidv7();
    await run(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at, verified_by, verified_at)
       VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'INR', 100000, '2026-11-01', 'neft', ?3, ?4, ?3, ?4)`,
      domesticInr,
      domestic,
      w.owner,
      T,
    );
    expect(await link(bank.id, [domesticInr], staff)).toBe(0);
    await rejects(
      run(
        "INSERT INTO realisation_advice_payments (id, advice_id, payment_id, created_by) VALUES (?1, ?2, ?3, ?4)",
        uuidv7(),
        bank.id,
        domesticInr,
        staff,
      ),
      /realisation_advice_payments_insert/,
    );
    const withoutManual = (
      await all<{ id: string }>(PAYMENTS_WITHOUT_ADVICE_SQL, "manual", "", "", null)
    ).map((r) => r.id);
    expect(withoutManual).not.toContain(domesticInr);
    // An overseas client's INR manual entry is taken.
    const overseasInr = uuidv7();
    await run(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at, verified_by, verified_at)
       VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'INR', 100000, '2026-11-01', 'swift', ?3, ?4, ?3, ?4)`,
      overseasInr,
      w.clientId,
      w.owner,
      T,
    );
    expect(
      (await all<{ id: string }>(PAYMENTS_WITHOUT_ADVICE_SQL, "manual", "", "", null)).map((r) => r.id),
    ).toContain(overseasInr);
    expect(await link(bank.id, [overseasInr], staff)).toBe(1);
    // An anonymised client's payment is never linked.
    const w2 = await world();
    const co2 = await payPalCheckout(w2);
    const gone = await pplPay(w2.clientId, co2.id);
    await run("UPDATE clients SET anonymised_at = 5 WHERE id = ?", w2.clientId);
    expect(await link(adv.id, [gone], staff)).toBe(0);
    expect(await first(PAYMENT_ADVICE_SQL, p1)).toMatchObject({ id: adv.id });
    const listed = await all<{ payment_id: string }>(ADVICE_PAYMENTS_SQL, adv.id, "", "");
    expect(listed.map((r) => r.payment_id).sort()).toEqual([p1, p2].sort());
    expect(
      (await all<{ id: string; linked: number }>(ADVICES_SQL, null, null)).find((r) => r.id === adv.id)
        ?.linked,
    ).toBe(2);
  });

  it("unlink: the Owner only, once, with a reason; then the payment may go on another advice; never deleted", async () => {
    const w = await world();
    const staff = await mkMember("staff");
    const co = await payPalCheckout(w);
    const p = await pplPay(w.clientId, co.id);
    const adv = await mkAdvice(staff);
    await link(adv.id, [p], staff);
    const unlink = async (by: string, reason = "Wrong week") =>
      (await adviceUnlinkStatement(db(), { adviceId: adv.id, paymentId: p, by, now: tick(), reason }).run())
        .meta.changes;
    expect(await unlink(staff)).toBe(0);
    expect(await unlink(w.owner, "   ")).toBe(0);
    await rejects(
      run(
        "UPDATE realisation_advice_payments SET removed_by = ?3, removed_at = 1, remove_reason = 'x' WHERE advice_id = ?1 AND payment_id = ?2",
        adv.id,
        p,
        staff,
      ),
      /realisation_advice_payments_update/,
    );
    expect(await unlink(w.owner)).toBe(1);
    expect(await unlink(w.owner)).toBe(0);
    await rejects(
      run(
        "UPDATE realisation_advice_payments SET remove_reason = 'changed' WHERE advice_id = ?1 AND payment_id = ?2",
        adv.id,
        p,
      ),
      /realisation_advice_payments_update/,
    );
    await rejects(
      run("DELETE FROM realisation_advice_payments WHERE advice_id = ?", adv.id),
      /realisation_advice_payments_no_delete/,
    );
    const next2 = await mkAdvice(staff);
    expect(await link(next2.id, [p], staff)).toBe(1);
    // Early check 1 finding 9: a payment taken off by mistake can go back on the same advice (a new link row with its own id).
    expect(
      (
        await adviceUnlinkStatement(db(), {
          adviceId: next2.id,
          paymentId: p,
          by: w.owner,
          now: tick(),
          reason: "Linked by mistake",
        }).run()
      ).meta.changes,
    ).toBe(1);
    expect(await link(next2.id, [p], staff)).toBe(1);
    const rows = await all<{ id: string; removed_at: number | null }>(
      "SELECT id, removed_at FROM realisation_advice_payments WHERE advice_id = ?1 AND payment_id = ?2",
      next2.id,
      p,
    );
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.removed_at === null)).toHaveLength(1);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    await rejects(
      run("UPDATE realisation_advice_payments SET id = 'x' WHERE advice_id = ?1", next2.id),
      /realisation_advice_payments_update/,
    );
  });

  it("the Without advice list and its count", async () => {
    const w = await world();
    const staff = await mkMember("staff");
    const co = await payPalCheckout(w);
    const p1 = await pplPay(w.clientId, co.id);
    const p2 = await pplPay(w.clientId, co.id);
    const adv = await mkAdvice(staff);
    await link(adv.id, [p1], staff);
    const ids = (await all<{ id: string }>(PAYMENTS_WITHOUT_ADVICE_SQL, "paypal", "", "", "USD")).map(
      (r) => r.id,
    );
    expect(ids).toContain(p2);
    expect(ids).not.toContain(p1);
    const n = (from: string, to: string) =>
      first<{ n: number }>(PAYMENTS_WITHOUT_ADVICE_COUNT_SQL, "paypal", from, to).then((r) => r?.n);
    expect(await n("2026-11-01", "2026-11-30")).toBeGreaterThanOrEqual(1);
    expect(await n("2026-12-01", "2026-12-31")).toBe(0);
  });
});

// ---- query plans --------------------------------------------------------------------------------------------------------------------------------------

describe("the new reads use their indexes", () => {
  const plan = async (sql: string, ...binds: unknown[]) =>
    (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...binds)).map((r) => r.detail).join("\n");

  it("Without advice, the advices list, the sweep's reads, the capture lookup and the capturing check", async () => {
    expect(await plan(PAYMENTS_WITHOUT_ADVICE_SQL, "paypal", "", "", null)).toContain(
      "payments_confirmed_provider",
    );
    expect(await plan(PAYMENTS_WITHOUT_ADVICE_SQL, "paypal", "", "", null)).toContain(
      "realisation_advice_payments_active",
    );
    expect(await plan(PAYMENTS_WITHOUT_ADVICE_COUNT_SQL, "paypal", "2026-11-01", "2026-11-30")).toContain(
      "payments_confirmed_provider",
    );
    expect(await plan(ADVICES_SQL, null, null)).toContain("realisation_advices_issued");
    expect(await plan(PAYPAL_STALE_CLAIMS_SQL, 1, 1)).toContain("checkout_sessions_paypal_open");
    expect(await plan(PAYPAL_HELD_CAPTURES_SQL, 1)).toContain("checkout_sessions_capture_pending");
    expect(await plan(CHECKOUT_BY_CAPTURE_SQL, "X")).toContain("checkout_sessions_capture");
    expect(
      await plan(`SELECT ${gatewayPaymentPendingSql("d")} FROM documents d WHERE d.id = ?1`, "x"),
    ).toContain("checkout_sessions_document");
  });
});
