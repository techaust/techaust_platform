// M6.5 receipts, refunds and reconciliation in the database [ADM-PAY-08, -09, -10, ADM-INV-09, -17; run file A, I, L33 to L39]: 0069 creates and adds only, 0070
// recreates exactly its triggers and adds the new ones, the pinned lists equal the schema's; then every new trigger accepts and refuses: the refund's insert state
// and bounds (from credit, from an invoice's excess, from a pending gateway payment), one open refund per payment, the status flow and the fixed columns, the
// ledger with refunds (allocation bound, post-condition, failed refund back to credit), the pending payment rejected once refunded in full, the withdraw and
// anonymise refusals, the full void rule (pending checkout payments and PayPal captures, the trigger alone), receipts, settlements, bank matches and FEMA
// reductions. Raw SQL on purpose: the triggers are the subject. All names, ids and amounts are invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { ledgerResultStatement, paymentBlocksVoidSql, recomputeStatement } from "../src/ledger.ts";
import {
  BANK_MATCH_TARGETS,
  REFUND_MODES,
  REFUND_ORIGINS,
  REFUND_PAID_TO,
  REFUND_PROVIDERS,
  REFUND_REASONS,
  REFUND_STATUSES,
  REVIEW_KINDS,
  SETTLEMENT_DIRECTIONS,
  SETTLEMENT_ENTITY_TYPES,
  SETTLEMENT_MATCHES,
  SETTLEMENT_PROVIDERS,
} from "../src/schema/payments.ts";
import {
  BANK_MATCH_TARGETS_0070,
  paymentBlocksVoidTriggerSql,
  REFUND_MODES_0070,
  REFUND_NEW_0070,
  REFUND_ORIGINS_0070,
  REFUND_PAID_TO_0070,
  REFUND_PROVIDERS_0070,
  REFUND_REASONS_0070,
  REFUND_RECREATED_GATEWAY_0070,
  REFUND_RECREATED_LEDGER_0070,
  REFUND_STATUSES_0070,
  REVIEW_KINDS_0070,
  SETTLEMENT_DIRECTIONS_0070,
  SETTLEMENT_ENTITY_TYPES_0070,
  SETTLEMENT_MATCHES_0070,
  SETTLEMENT_PROVIDERS_0070,
} from "../src/triggers.ts";
import { mkClientRow, mkIssued, mkMember, next } from "./billing-helpers.ts";
import { all, first, rejects, run } from "./helpers.ts";

const T = 1_870_000_000_000;
const db = () => env.DB;

// ---- fixtures -------------------------------------------------------------------------------------------------------------------------------------------

/** A confirmed (or pending) manual payment of the client, recorded and confirmed by `owner`. */
async function pay(
  clientId: string,
  owner: string,
  o: { amount?: number; status?: string; currency?: string; kind?: string } = {},
): Promise<string> {
  const id = uuidv7();
  const status = o.status ?? "confirmed";
  const kind = o.kind ?? "payment";
  await run(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, tds_section, tds_rate_bp, recorded_by, recorded_at, verified_by, verified_at)
     VALUES (?1, ?2, ?3, 'manual', ?4, ?5, ?6, '2026-11-01', ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    id,
    clientId,
    kind,
    status,
    o.currency ?? "INR",
    o.amount ?? 150_000,
    kind === "tds" ? null : "neft",
    kind === "tds" ? "as advised" : null,
    kind === "tds" ? 1000 : null,
    owner,
    T,
    status === "confirmed" ? owner : null,
    status === "confirmed" ? T : null,
  );
  return id;
}

const alloc = (
  paymentId: string,
  documentId: string,
  amount: number,
  kind: "allocate" | "release" = "allocate",
  id = uuidv7(),
) =>
  run(
    "INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    id,
    paymentId,
    documentId,
    amount,
    kind,
    T,
  );
const recompute = (t: { paymentIds?: string[]; documentIds?: string[] }) =>
  recomputeStatement(db(), t, Date.now()).run();
const result = (t: { paymentIds?: string[]; documentIds?: string[] }) => ledgerResultStatement(db(), t).run();

type RefundOver = Partial<{
  id: string;
  documentId: string | null;
  creditNoteId: string | null;
  provider: string;
  origin: string;
  status: string;
  mode: string | null;
  paidTo: string | null;
  reason: string;
  currency: string;
  amount: number;
  ref: string | null;
  paidOn: string | null;
  providerRefundId: string | null;
  requestedBy: string;
  settled: boolean;
  attempts: number;
}>;

/** A refund row written straight in: a manual refund (succeeded) by default. */
async function refund(
  paymentId: string,
  clientId: string,
  owner: string,
  o: RefundOver = {},
): Promise<string> {
  const id = o.id ?? uuidv7();
  const provider = o.provider ?? "manual";
  const status = o.status ?? (provider === "manual" ? "succeeded" : "requested");
  const manual = provider === "manual";
  const settled = o.settled ?? status === "succeeded";
  await run(
    `INSERT INTO payment_refunds (id, payment_id, client_id, document_id, credit_note_id, provider, origin, status, mode, paid_to, reason_code, currency, amount_minor,
       reference_norm, paid_on, provider_refund_id, requested_by, requested_at, attempts, settled_at, settled_on, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?18)`,
    id,
    paymentId,
    clientId,
    o.documentId ?? null,
    o.creditNoteId ?? null,
    provider,
    o.origin ?? "owner",
    status,
    o.mode === undefined ? (manual ? "neft" : null) : o.mode,
    o.paidTo === undefined ? (manual ? "own_account" : "original") : o.paidTo,
    o.reason ?? "overpayment",
    o.currency ?? "INR",
    o.amount ?? 10_000,
    o.ref === undefined ? (manual ? `UTR${next()}` : null) : o.ref,
    o.paidOn === undefined ? (manual ? "2026-11-02" : null) : o.paidOn,
    o.providerRefundId ?? null,
    o.requestedBy ?? owner,
    T,
    o.attempts ?? 0,
    settled ? T : null,
    settled ? "2026-11-02" : null,
  );
  return id;
}

const credit = async (clientId: string) =>
  (
    await first<{ credit: number }>(
      "SELECT coalesce(sum(p.amount_minor - (SELECT coalesce(sum(CASE a.kind WHEN 'allocate' THEN a.amount_minor ELSE -a.amount_minor END), 0) FROM payment_allocations a WHERE a.payment_id = p.id) - (SELECT coalesce(sum(r.amount_minor), 0) FROM payment_refunds r WHERE r.payment_id = p.id AND r.status <> 'failed')), 0) AS credit FROM payments p WHERE p.client_id = ? AND p.status = 'confirmed' AND p.kind = 'payment'",
      clientId,
    )
  )?.credit;

async function setup(o: { currency?: "INR" | "USD" } = {}) {
  const owner = await mkMember("owner");
  const clientId = await mkClientRow(o.currency ? { currency: o.currency } : {});
  return { owner, clientId };
}

// ---- gateway payments (pending) -------------------------------------------------------------------------------------------------------------------------

/** A checkout of document `documentId` made by staff member `by`, live with a link (or `capture_pending` for PayPal). */
async function checkout(
  documentId: string,
  clientId: string,
  by: string,
  provider: string,
  status = "live",
): Promise<string> {
  const id = uuidv7();
  const cur = provider === "razorpay" ? "INR" : "USD";
  await run(
    `INSERT INTO checkout_sessions (id, provider, document_id, client_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'staff', ?6, 50000, 'creating', ?7, ?8, ?8)`,
    id,
    provider,
    documentId,
    clientId,
    by,
    cur,
    T + 86_400_000,
    T,
  );
  const link = `lnk_${next()}`;
  await run(
    "UPDATE checkout_sessions SET status = 'live', provider_link_id = ?2, short_url = ?3, updated_at = ?4 WHERE id = ?1",
    id,
    link,
    provider === "paypal"
      ? `https://www.sandbox.paypal.com/checkoutnow?token=${link}`
      : `https://rzp.io/i/${link}`,
    T + 1,
  );
  if (status === "capture_pending")
    await run(
      "UPDATE checkout_sessions SET status = 'capture_pending', provider_capture_id = ?2, updated_at = ?3 WHERE id = ?1",
      id,
      `CAP${next()}`,
      T + 2,
    );
  if (status === "claimed")
    await run("UPDATE checkout_sessions SET capture_started_at = ?2 WHERE id = ?1", id, T + 3);
  return id;
}

/** A pending gateway payment that came through checkout `checkoutId` (no request: an online payment waiting for the Owner). */
async function gatewayPay(
  clientId: string,
  checkoutId: string,
  provider: "razorpay" | "stripe",
  amount = 50_000,
): Promise<string> {
  const id = uuidv7();
  const ref = `${provider === "razorpay" ? "pay_" : "pi_"}${next()}`;
  await run(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, received_on, mode, reference_norm, recorded_at, provider_payment_id, checkout_id, refetched_at)
     VALUES (?1, ?2, 'payment', ?3, 'pending_verification', ?4, ?5, 0, '2026-11-01', ?6, ?7, ?8, ?7, ?9, ?8)`,
    id,
    clientId,
    provider,
    provider === "razorpay" ? "INR" : "USD",
    amount,
    provider === "razorpay" ? "upi" : "card",
    ref,
    T,
    checkoutId,
  );
  return id;
}

// ---- migrations and lists -------------------------------------------------------------------------------------------------------------------------------

describe("0069 and 0070: no rebuild, the pinned lists, the recreated set [run file A]", () => {
  it("0069 only creates tables and indexes and adds one column: no DROP, no copy, no rebuild", () => {
    const m = env.TEST_MIGRATIONS.find((x) => x.name === "0069_receipts_refunds.sql");
    expect(m).toBeDefined();
    for (const q of (m?.queries ?? []).map((x) => x.replace(/^(\s|--> statement-breakpoint)+/, "")))
      expect(q.trim(), q.slice(0, 60)).toMatch(
        /^(CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|ALTER TABLE `payments` ADD `receipt_document_id` text REFERENCES documents\(id\))/,
      );
    expect((m?.queries ?? []).join("\n")).not.toMatch(
      /DROP TABLE|__new_|INSERT INTO|CHECK\(.*receipt_document_id/,
    );
  });

  it("0070 drops only what it creates again, and the lists are the schema's", () => {
    const m = env.TEST_MIGRATIONS.find((x) => x.name === "0070_refund_triggers.sql");
    const text = (m?.queries ?? []).join("\n");
    const dropped = [...text.matchAll(/DROP TRIGGER `(\w+)`/g)].map((x) => x[1]);
    expect(dropped).toEqual([...REFUND_RECREATED_GATEWAY_0070, ...REFUND_RECREATED_LEDGER_0070]);
    const created = [...text.matchAll(/CREATE TRIGGER `(\w+)`/g)].map((x) => x[1]);
    expect(created).toEqual([
      ...REFUND_RECREATED_GATEWAY_0070,
      ...REFUND_RECREATED_LEDGER_0070,
      ...REFUND_NEW_0070,
    ]);
    expect(text).not.toMatch(/DROP TABLE|__new_|INDEXED BY/);
    expect(REVIEW_KINDS_0070).toEqual(REVIEW_KINDS);
    expect(REFUND_PROVIDERS_0070).toEqual(REFUND_PROVIDERS);
    expect(REFUND_ORIGINS_0070).toEqual(REFUND_ORIGINS);
    expect(REFUND_STATUSES_0070).toEqual(REFUND_STATUSES);
    expect(REFUND_MODES_0070).toEqual(REFUND_MODES);
    expect(REFUND_PAID_TO_0070).toEqual(REFUND_PAID_TO);
    expect(REFUND_REASONS_0070).toEqual(REFUND_REASONS);
    expect(SETTLEMENT_PROVIDERS_0070).toEqual(SETTLEMENT_PROVIDERS);
    expect(SETTLEMENT_ENTITY_TYPES_0070).toEqual(SETTLEMENT_ENTITY_TYPES);
    expect(SETTLEMENT_DIRECTIONS_0070).toEqual(SETTLEMENT_DIRECTIONS);
    expect(SETTLEMENT_MATCHES_0070).toEqual(SETTLEMENT_MATCHES);
    expect(BANK_MATCH_TARGETS_0070).toEqual(BANK_MATCH_TARGETS);
  });

  it("the trigger's void rule is exactly the WHERE helper without its INDEXED BY hints (L39)", () => {
    const helper = paymentBlocksVoidSql("OLD.id", "OLD.client_id");
    expect(helper).toMatch(/INDEXED BY/);
    expect(paymentBlocksVoidTriggerSql("OLD.id", "OLD.client_id")).toBe(
      helper.replace(/ INDEXED BY \w+/g, ""),
    );
    expect(paymentBlocksVoidTriggerSql("OLD.id", "OLD.client_id")).not.toMatch(/INDEXED BY/);
  });
});

// ---- refunds: insert state and bounds --------------------------------------------------------------------------------------------------------------------

describe("payment_refunds: values, insert state and bounds [ADM-PAY-08, L1, L2, L33]", () => {
  it("a manual refund from credit up to the free money; above it refused at the trigger; failed money returns to credit", async () => {
    const { owner, clientId } = await setup();
    const inv = await mkIssued(clientId);
    const p = await pay(clientId, owner, { amount: 150_000 });
    await alloc(p, inv, 118_000);
    await recompute({ paymentIds: [p] });
    expect(await credit(clientId)).toBe(32_000);
    await rejects(refund(p, clientId, owner, { amount: 32_001 }), /payment_refunds_bounds/);
    await refund(p, clientId, owner, { amount: 20_000 });
    expect(await credit(clientId)).toBe(12_000);
    // a gateway-style refund on a manual payment is refused (the source's own gateway only)
    await rejects(
      refund(p, clientId, owner, { provider: "razorpay", amount: 1_000 }),
      /payment_refunds_insert_state/,
    );
    // a requested refund holds money; a failed one gives it back to credit, never to the invoice
    const g = await pay(clientId, owner, { amount: 5_000 });
    const r = await refund(g, clientId, owner, { amount: 5_000, status: "succeeded" });
    expect(r).toBeTruthy();
    expect(await credit(clientId)).toBe(12_000);
  });

  it("refuses unknown values, a manual refund without its bank fields, a member who is not an active Owner, an anonymised client", async () => {
    const { owner, clientId } = await setup();
    const p = await pay(clientId, owner);
    await rejects(refund(p, clientId, owner, { reason: "gift" }), /payment_refunds_values_insert/);
    await rejects(refund(p, clientId, owner, { mode: "card" }), /payment_refunds_values_insert/);
    await rejects(refund(p, clientId, owner, { ref: null }), /payment_refunds_insert_state/);
    await rejects(refund(p, clientId, owner, { paidOn: null }), /payment_refunds_insert_state/);
    await rejects(refund(p, clientId, owner, { paidTo: null }), /payment_refunds_insert_state/);
    await rejects(
      refund(p, clientId, owner, { status: "requested", settled: false }),
      /payment_refunds_insert_state/,
    );
    await rejects(refund(p, clientId, owner, { reason: "chargeback" }), /payment_refunds_insert_state/);
    const staff = await mkMember("staff");
    await rejects(refund(p, clientId, owner, { requestedBy: staff }), /payment_refunds_insert_state/);
    await rejects(refund(p, clientId, owner, { attempts: 1 }), /payment_refunds_insert_state/);
    // another client's payment, or another currency
    const other = await mkClientRow();
    await rejects(refund(p, other, owner), /payment_refunds_bounds/);
    await rejects(
      refund(p, clientId, owner, { currency: "USD" }),
      /payment_refunds_bounds|payment_refunds_inr/,
    );
    await run("UPDATE clients SET anonymised_at = 5 WHERE id = ?", clientId);
    await rejects(refund(p, clientId, owner), /payment_refunds_bounds/);
  });

  it("from an invoice's excess: at most the excess and what this payment holds there; the release of exactly the amount follows and is linked once", async () => {
    const { owner, clientId } = await setup();
    const inv = await mkIssued(clientId);
    const p = await pay(clientId, owner, { amount: 118_000 });
    await alloc(p, inv, 118_000);
    await recompute({ paymentIds: [p] });
    // no excess yet: refused
    await rejects(refund(p, clientId, owner, { documentId: inv, amount: 1_000 }), /payment_refunds_bounds/);
    // a credit note of 18,000 makes an excess of 18,000 (credited written straight in, as the note recompute leaves it)
    await run(
      "UPDATE documents SET credited_minor = 18000, balance_minor = 0, status = 'paid', updated_at = updated_at + 1 WHERE id = ?",
      inv,
    );
    await rejects(refund(p, clientId, owner, { documentId: inv, amount: 18_001 }), /payment_refunds_bounds/);
    const id = uuidv7();
    const rel = uuidv7();
    await db().batch([
      db()
        .prepare(
          `INSERT INTO payment_refunds (id, payment_id, client_id, document_id, provider, origin, status, mode, paid_to, reason_code, currency, amount_minor, reference_norm, paid_on, requested_by, requested_at, settled_at, settled_on, updated_at)
           VALUES (?1, ?2, ?3, ?4, 'manual', 'owner', 'succeeded', 'neft', 'original', 'credit_note', 'INR', 18000, 'UTRDOC1', '2026-11-02', ?5, ?6, ?6, '2026-11-02', ?6)`,
        )
        .bind(id, p, clientId, inv, owner, T),
      db()
        .prepare(
          "INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_at) VALUES (?1, ?2, ?3, 18000, 'release', ?4)",
        )
        .bind(rel, p, inv, T),
      db()
        .prepare(
          "UPDATE payment_refunds SET release_allocation_id = ?2 WHERE id = ?1 AND release_allocation_id IS NULL",
        )
        .bind(id, rel),
      recomputeStatement(db(), { paymentIds: [p] }, Date.now()),
      ledgerResultStatement(db(), { paymentIds: [p] }),
    ]);
    expect(await first("SELECT paid_minor, balance_minor, status FROM documents WHERE id = ?", inv)).toEqual({
      paid_minor: 100_000,
      balance_minor: 0,
      status: "paid",
    });
    expect(await credit(clientId)).toBe(0);
    // the link is set once, and only to a release of this payment, document and amount
    await rejects(
      run("UPDATE payment_refunds SET release_allocation_id = NULL WHERE id = ?", id),
      /payment_refunds_fixed/,
    );
    const other = await refund(await pay(clientId, owner, { amount: 500 }), clientId, owner, { amount: 500 });
    await rejects(
      run("UPDATE payment_refunds SET release_allocation_id = ?2 WHERE id = ?1", other, rel),
      /payment_refunds_fixed/,
    );
  });

  it("a refund then an allocation that would over-draw is aborted (payment_allocations_bounds); ledger_result counts refunds", async () => {
    const { owner, clientId } = await setup();
    const inv = await mkIssued(clientId);
    const p = await pay(clientId, owner, { amount: 118_000 });
    await refund(p, clientId, owner, { amount: 100_000 });
    await rejects(alloc(p, inv, 18_001), /payment_allocations_bounds/);
    await alloc(p, inv, 18_000);
    await recompute({ paymentIds: [p] });
    await result({ paymentIds: [p] });
    // a release of 1,000 and a refund of the same 1,000 from no document would over-commit only if the release is missing: the post-condition holds here
    expect(await credit(clientId)).toBe(0);
  });

  it("two open refunds on one payment: the second is refused by the unique open index (L8)", async () => {
    const { owner, clientId } = await setup({ currency: "INR" });
    const doc = await mkIssued(clientId, { type: "tax_invoice" });
    const staff = await mkMember("staff");
    const ck = await checkout(doc, clientId, staff, "razorpay");
    const p = await gatewayPay(clientId, ck, "razorpay");
    await run(
      "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
      p,
      owner,
      T + 5,
    );
    await refund(p, clientId, owner, { provider: "razorpay", amount: 1_000 });
    await rejects(
      refund(p, clientId, owner, { provider: "razorpay", amount: 1_000 }),
      /UNIQUE constraint failed: payment_refunds\.payment_id/,
    );
  });
});

describe("payment_refunds: status flow, fixed columns, no delete, the erase [ADM-PAY-08, L8, L15]", () => {
  it("requested → processing → succeeded with its settled day; terminal states never move", async () => {
    const { owner, clientId } = await setup();
    const doc = await mkIssued(clientId);
    const staff = await mkMember("staff");
    const p = await gatewayPay(clientId, await checkout(doc, clientId, staff, "razorpay"), "razorpay");
    await run(
      "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
      p,
      owner,
      T + 5,
    );
    const r = await refund(p, clientId, owner, { provider: "razorpay", amount: 2_000 });
    await rejects(
      run("UPDATE payment_refunds SET status = 'succeeded' WHERE id = ?", r),
      /payment_refunds_status_flow/,
    );
    await run(
      "UPDATE payment_refunds SET status = 'processing', provider_refund_id = 'rfnd_1', attempts = 1, updated_at = ?2 WHERE id = ?1",
      r,
      T + 6,
    );
    await rejects(
      run("UPDATE payment_refunds SET provider_refund_id = 'rfnd_2' WHERE id = ?", r),
      /payment_refunds_fixed/,
    );
    await rejects(
      run("UPDATE payment_refunds SET status = 'requested' WHERE id = ?", r),
      /payment_refunds_status_flow/,
    );
    await rejects(
      run("UPDATE payment_refunds SET amount_minor = 1 WHERE id = ?", r),
      /payment_refunds_fixed/,
    );
    await rejects(run("UPDATE payment_refunds SET attempts = 0 WHERE id = ?", r), /payment_refunds_fixed/);
    await run(
      "UPDATE payment_refunds SET status = 'succeeded', settled_at = ?2, settled_on = '2026-11-03', updated_at = ?2 WHERE id = ?1",
      r,
      T + 7,
    );
    await rejects(
      run("UPDATE payment_refunds SET status = 'failed' WHERE id = ?", r),
      /payment_refunds_status_flow/,
    );
    await rejects(run("DELETE FROM payment_refunds WHERE id = ?", r), /payment_refunds_no_delete/);
    // a failed one has no settled day
    const p2 = await pay(clientId, owner, { amount: 900 });
    expect(p2).toBeTruthy();
  });

  it("a payment with a refund not failed is never withdrawn; anonymising waits for an open refund; then the notes are cleared", async () => {
    const { owner, clientId } = await setup();
    const doc = await mkIssued(clientId);
    const staff = await mkMember("staff");
    const p = await gatewayPay(clientId, await checkout(doc, clientId, staff, "razorpay"), "razorpay");
    await run(
      "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
      p,
      owner,
      T + 5,
    );
    const r = await refund(p, clientId, owner, { provider: "razorpay", amount: 2_000 });
    const m = await pay(clientId, owner, { amount: 3_000 });
    await refund(m, clientId, owner, { amount: 1_000 });
    await rejects(
      run(
        "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = 9, withdraw_reason = 'Error' WHERE id = ?1",
        m,
        owner,
      ),
      /payments_withdraw_no_refunds/,
    );
    await rejects(
      run("UPDATE clients SET anonymised_at = 9 WHERE id = ?", clientId),
      /clients_anonymise_no_open_refund/,
    );
    await run(
      "UPDATE payment_refunds SET status = 'failed', failure_code = 'BAD_REQUEST', updated_at = ?2 WHERE id = ?1",
      r,
      T + 8,
    );
    await run("UPDATE clients SET anonymised_at = 9 WHERE id = ?", clientId);
    expect(
      await all("SELECT note FROM payment_refunds WHERE client_id = ? AND note IS NOT NULL", clientId),
    ).toEqual([]);
  });

  it("the note is written only at insert and cleared only once the client is anonymised", async () => {
    const { owner, clientId } = await setup();
    const p = await pay(clientId, owner);
    const id = uuidv7();
    await run(
      `INSERT INTO payment_refunds (id, payment_id, client_id, provider, origin, status, mode, paid_to, reason_code, currency, amount_minor, reference_norm, paid_on, note, requested_by, requested_at, settled_at, settled_on, updated_at)
       VALUES (?1, ?2, ?3, 'manual', 'owner', 'succeeded', 'imps', 'own_account', 'duplicate', 'INR', 700, 'UTRNOTE', '2026-11-02', 'Paid twice', ?4, ?5, ?5, '2026-11-02', ?5)`,
      id,
      p,
      clientId,
      owner,
      T,
    );
    await rejects(run("UPDATE payment_refunds SET note = NULL WHERE id = ?", id), /payment_refunds_fixed/);
    await run("UPDATE clients SET anonymised_at = 9 WHERE id = ?", clientId);
    expect(await first("SELECT note FROM payment_refunds WHERE id = ?", id)).toEqual({ note: null });
  });
});

// ---- L33: a pending gateway payment refunded in full --------------------------------------------------------------------------------------------------

describe("L33: a pending gateway payment is refunded in full, then rejected by the system; never confirmed while it is", () => {
  it("full amount only, through its own gateway; confirm refused while the refund lives; rejected once it succeeded", async () => {
    const { owner, clientId } = await setup();
    const doc = await mkIssued(clientId);
    const staff = await mkMember("staff");
    const p = await gatewayPay(
      clientId,
      await checkout(doc, clientId, staff, "razorpay"),
      "razorpay",
      50_000,
    );
    await rejects(
      refund(p, clientId, owner, { provider: "razorpay", amount: 49_999 }),
      /payment_refunds_bounds/,
    );
    await rejects(
      refund(p, clientId, owner, { provider: "razorpay", amount: 50_000, documentId: doc }),
      /payment_refunds_bounds/,
    );
    // a gateway payment is never rejected while no refund succeeded
    await rejects(
      run("UPDATE payments SET status = 'rejected', verified_at = 9 WHERE id = ?", p),
      /payments_status_flow/,
    );
    const r = await refund(p, clientId, owner, { provider: "razorpay", amount: 50_000 });
    await rejects(
      run(
        "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = 9 WHERE id = ?1",
        p,
        owner,
      ),
      /payments_refund_no_confirm/,
    );
    await rejects(
      run("UPDATE payments SET status = 'rejected', verified_at = 9 WHERE id = ?", p),
      /payments_status_flow/,
    );
    await run(
      "UPDATE payment_refunds SET status = 'succeeded', provider_refund_id = 'rfnd_full', settled_at = 10, settled_on = '2026-11-03', updated_at = ?2 WHERE id = ?1",
      r,
      T + 9,
    );
    // an Owner's reject is still refused for a gateway payment; the system's (no member) is allowed now
    await rejects(
      run(
        "UPDATE payments SET status = 'rejected', verified_by = ?2, verified_at = 11 WHERE id = ?1",
        p,
        owner,
      ),
      /payments_status_flow/,
    );
    await run("UPDATE payments SET status = 'rejected', verified_at = 11 WHERE id = ?", p);
    expect(await first("SELECT status FROM payments WHERE id = ?", p)).toEqual({ status: "rejected" });
  });
});

// ---- the void rule (L39) ---------------------------------------------------------------------------------------------------------------------------------

describe("documents_void_no_payment, rebuilt: the trigger alone refuses a void or withdraw with money on its way [ADM-INV-10, L39]", () => {
  const voidIt = (id: string) =>
    run(
      "UPDATE documents SET status = 'void', voided_at = 9, void_reason = 'x', updated_at = 9000 WHERE id = ?",
      id,
    );

  it("a pending Razorpay payment through the document's checkout (no request) blocks the void", async () => {
    const { clientId } = await setup();
    const staff = await mkMember("staff");
    const doc = await mkIssued(clientId);
    await gatewayPay(clientId, await checkout(doc, clientId, staff, "razorpay"), "razorpay");
    await rejects(voidIt(doc), /documents_void_no_payment/);
  });

  it("a pending Stripe payment through a proforma's checkout blocks the withdraw (a proforma's void)", async () => {
    const { clientId } = await setup({ currency: "USD" });
    const staff = await mkMember("staff");
    const pro = await mkUsdDoc(clientId, "proforma");
    await gatewayPay(clientId, await checkout(pro, clientId, staff, "stripe"), "stripe");
    await rejects(voidIt(pro), /documents_void_no_payment/);
  });

  it("a PayPal capture PayPal holds, or a claimed checkout, blocks both; an expired one does not", async () => {
    const { clientId } = await setup({ currency: "USD" });
    const staff = await mkMember("staff");
    const held = await mkUsdDoc(clientId, "export_invoice");
    await checkout(held, clientId, staff, "paypal", "capture_pending");
    await rejects(voidIt(held), /documents_void_no_payment/);
    const claimed = await mkUsdDoc(clientId, "proforma");
    await checkout(claimed, clientId, staff, "paypal", "claimed");
    await rejects(voidIt(claimed), /documents_void_no_payment/);
    const free = await mkUsdDoc(clientId, "proforma");
    await checkout(free, clientId, staff, "paypal");
    await voidIt(free);
  });
});

async function mkUsdDoc(clientId: string, type: string): Promise<string> {
  const id = uuidv7();
  const n = next();
  await run(
    `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor, content_sha256, updated_at)
     VALUES (?1, ?2, 'issued', ?3, 'USD', 'usd-r', '9999', ?4, ?5, 1000, '2026-10-28', '2026-11-04', 50000, 50000, 50000, 50000, ?6, 7000)`,
    id,
    type,
    clientId,
    n,
    `U/${n}`,
    "h".repeat(64),
  );
  return id;
}

// ---- receipts (L4, L39; 08-C RA-39) --------------------------------------------------------------------------------------------------------------------

describe("receipts: inserted issued for a confirmed payment, linked once, voided only with a withdrawn payment [ADM-PAY-09, L4, L10]", () => {
  const insertReceipt = (paymentId: string, clientId: string, o: Record<string, unknown> = {}) => {
    const n = next();
    const row: Record<string, unknown> = {
      id: `rct_${paymentId}`,
      type: "receipt",
      status: "issued",
      client_id: clientId,
      currency: "INR",
      series: "receipt",
      fy: "2627",
      number: n,
      number_display: `TH/RCT/2627/${String(n).padStart(4, "0")}`,
      frozen_at: T,
      issue_date: "2026-11-03",
      total_minor: 150_000,
      ...o,
    };
    const cols = Object.keys(row);
    return run(
      `INSERT INTO documents (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      ...Object.values(row),
    );
  };

  it("refuses a receipt of a pending, TDS or other client's payment, a wrong amount, a parent, a draft or a tax line", async () => {
    const { owner, clientId } = await setup();
    const pending = await pay(clientId, owner, { status: "pending_verification" });
    await rejects(insertReceipt(pending, clientId), /documents_receipt_insert/);
    const p = await pay(clientId, owner);
    await rejects(insertReceipt(p, clientId, { total_minor: 149_999 }), /documents_receipt_insert/);
    await rejects(insertReceipt(p, await mkClientRow()), /documents_receipt_insert/);
    await rejects(insertReceipt(p, clientId, { igst_minor: 1 }), /documents_receipt_insert/);
    await rejects(insertReceipt(p, clientId, { series: "invoice" }), /documents_receipt_insert/);
    await rejects(
      insertReceipt(p, clientId, { status: "draft", frozen_at: null, number: null, number_display: null }),
      /documents_receipt_insert/,
    );
    await rejects(insertReceipt(p, clientId, { id: `rcx_${p}` }), /documents_receipt_insert/);
    const inv = await mkIssued(clientId);
    await rejects(insertReceipt(p, clientId, { parent_id: inv }), /documents_receipt_insert/);
    const tds = await pay(clientId, owner, { kind: "tds", amount: 1_000 });
    await rejects(insertReceipt(tds, clientId, { total_minor: 1_000 }), /documents_receipt_insert/);
    await insertReceipt(p, clientId);
    // one receipt per payment: the primary key
    await rejects(insertReceipt(p, clientId), /UNIQUE constraint failed: documents\.id/);
  });

  it("the payment's link is set once, to its own issued receipt; a receipt is voided only once its payment is withdrawn", async () => {
    const { owner, clientId } = await setup();
    const p = await pay(clientId, owner);
    const q = await pay(clientId, owner);
    await rejects(
      run("UPDATE payments SET receipt_document_id = ?2 WHERE id = ?1", p, `rct_${p}`),
      /FOREIGN KEY|payments_receipt_link/,
    );
    await insertReceipt(p, clientId);
    await insertReceipt(q, clientId);
    await rejects(
      run("UPDATE payments SET receipt_document_id = ?2 WHERE id = ?1", p, `rct_${q}`),
      /payments_receipt_link/,
    );
    await run("UPDATE payments SET receipt_document_id = ?2 WHERE id = ?1", p, `rct_${p}`);
    await rejects(
      run("UPDATE payments SET receipt_document_id = NULL WHERE id = ?", p),
      /payments_receipt_link/,
    );
    const voidReceipt = () =>
      run(
        "UPDATE documents SET status = 'void', voided_at = 9, void_reason = 'payment_withdrawn', updated_at = 9000 WHERE id = ?",
        `rct_${p}`,
      );
    await rejects(voidReceipt(), /documents_receipt_status/);
    await rejects(
      run("UPDATE documents SET status = 'paid' WHERE id = ?", `rct_${p}`),
      /documents_receipt_status/,
    );
    await run(
      "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = 9, withdraw_reason = 'Error' WHERE id = ?1",
      p,
      owner,
    );
    await voidReceipt();
    expect(await first("SELECT status FROM documents WHERE id = ?", `rct_${p}`)).toEqual({ status: "void" });
  });
});

// ---- settlements, items, bank matches, reductions ---------------------------------------------------------------------------------------------------

describe("settlements, settlement items and bank matches (ADM-PAY-10, L11)", () => {
  it("facts frozen, the UTR once, items move once with the link their type names, bank matches one target by an active Owner, undone once", async () => {
    const { owner, clientId } = await setup();
    const s = uuidv7();
    await rejects(
      run(
        "INSERT INTO settlements (id, provider, settlement_id, currency, amount_minor, settled_on, fetched_at) VALUES (?1, 'stripe', 'setl_1', 'INR', 100, '2026-11-02', 1)",
        s,
      ),
      /settlements_insert/,
    );
    await run(
      "INSERT INTO settlements (id, provider, settlement_id, currency, amount_minor, fees_minor, tax_minor, settled_on, fetched_at) VALUES (?1, 'razorpay', 'setl_A', 'INR', 9764, 200, 36, '2026-11-02', 1)",
      s,
    );
    await run("UPDATE settlements SET utr = 'UTR1', status = 'processed', fetched_at = 2 WHERE id = ?", s);
    await rejects(run("UPDATE settlements SET utr = 'UTR2' WHERE id = ?", s), /settlements_fixed/);
    await rejects(run("UPDATE settlements SET amount_minor = 1 WHERE id = ?", s), /settlements_fixed/);
    await rejects(run("DELETE FROM settlements WHERE id = ?", s), /settlements_no_delete/);
    const p = await pay(clientId, owner, { amount: 10_000 });
    const item = uuidv7();
    await rejects(
      run(
        "INSERT INTO settlement_items (id, settlement_id, provider, entity_type, entity_id, direction, amount_minor, match) VALUES (?1, ?2, 'razorpay', 'payment', 'pay_X', 'credit', 10000, 'matched')",
        item,
        s,
      ),
      /settlement_items_insert/,
    );
    await run(
      "INSERT INTO settlement_items (id, settlement_id, provider, entity_type, entity_id, direction, amount_minor, fee_minor, tax_minor, match) VALUES (?1, ?2, 'razorpay', 'payment', 'pay_X', 'credit', 10000, 200, 36, 'unmatched')",
      item,
      s,
    );
    await rejects(
      run("UPDATE settlement_items SET match = 'matched' WHERE id = ?", item),
      /settlement_items_update/,
    );
    await rejects(
      run(
        "UPDATE settlement_items SET match = 'matched', refund_id = NULL, payment_id = NULL WHERE id = ?",
        item,
      ),
      /settlement_items_update/,
    );
    await run(
      "UPDATE settlement_items SET match = 'matched', payment_id = ?2, fee_mismatch = 1 WHERE id = ?1",
      item,
      p,
    );
    await rejects(
      run("UPDATE settlement_items SET match = 'ignored' WHERE id = ?", item),
      /settlement_items_update/,
    );
    await rejects(
      run("UPDATE settlement_items SET amount_minor = 1 WHERE id = ?", item),
      /settlement_items_update/,
    );
    await rejects(run("DELETE FROM settlement_items WHERE id = ?", item), /settlement_items_no_delete/);
    // bank matches
    const staff = await mkMember("staff");
    const bm = (target: string, cols: Record<string, unknown>, by = owner) =>
      run(
        `INSERT INTO bank_matches (id, target_kind, payment_id, settlement_id, refund_id, statement_on, matched_by, matched_at) VALUES (?1, ?2, ?3, ?4, ?5, '2026-11-03', ?6, 1)`,
        uuidv7(),
        target,
        cols.payment_id ?? null,
        cols.settlement_id ?? null,
        cols.refund_id ?? null,
        by,
      );
    await rejects(bm("payment", { payment_id: p }, staff), /bank_matches_insert/);
    await rejects(bm("payment", { settlement_id: s }), /bank_matches_insert/);
    await rejects(bm("payment", { payment_id: p, settlement_id: s }), /bank_matches_insert/);
    const pending = await pay(clientId, owner, { status: "pending_verification" });
    await rejects(bm("payment", { payment_id: pending }), /bank_matches_insert/);
    await bm("payment", { payment_id: p });
    await rejects(bm("payment", { payment_id: p }), /UNIQUE constraint failed: bank_matches\.payment_id/);
    await bm("settlement", { settlement_id: s });
    const r = await refund(p, clientId, owner, { amount: 100 });
    await bm("refund", { refund_id: r });
    const row = await first<{ id: string }>("SELECT id FROM bank_matches WHERE payment_id = ?", p);
    const id = row?.id as string;
    await rejects(
      run(
        "UPDATE bank_matches SET removed_by = ?2, removed_at = 5, remove_reason = 'Wrong line' WHERE id = ?1",
        id,
        staff,
      ),
      /bank_matches_update/,
    );
    await rejects(
      run("UPDATE bank_matches SET statement_on = '2026-11-04' WHERE id = ?", id),
      /bank_matches_update/,
    );
    await run(
      "UPDATE bank_matches SET removed_by = ?2, removed_at = 5, remove_reason = 'Wrong line' WHERE id = ?1",
      id,
      owner,
    );
    await rejects(
      run("UPDATE bank_matches SET remove_reason = 'Other' WHERE id = ?", id),
      /bank_matches_update/,
    );
    await rejects(run("DELETE FROM bank_matches WHERE id = ?", id), /bank_matches_no_delete/);
    // undone: a new match of the same payment is allowed
    await bm("payment", { payment_id: p });
  });
});

describe("realisation_reductions (RB-43)", () => {
  it("for an issued live export invoice in its currency, by an active Owner, never above its total; the letter once; never deleted", async () => {
    const { owner, clientId } = await setup({ currency: "USD" });
    const exp = await mkUsdDoc(clientId, "export_invoice");
    const add = (amount: number, o: { by?: string; currency?: string; doc?: string } = {}) =>
      run(
        "INSERT INTO realisation_reductions (id, document_id, currency, amount_minor, approved_on, bank_ref, recorded_by) VALUES (?1, ?2, ?3, ?4, '2026-11-03', 'ADB/REG6/1', ?5)",
        uuidv7(),
        o.doc ?? exp,
        o.currency ?? "USD",
        amount,
        o.by ?? owner,
      );
    await rejects(add(1_000, { by: await mkMember("staff") }), /realisation_reductions_insert/);
    await rejects(add(1_000, { currency: "INR" }), /realisation_reductions_insert/);
    await rejects(add(1_000, { doc: await mkUsdDoc(clientId, "proforma") }), /realisation_reductions_insert/);
    await add(30_000);
    await rejects(add(20_001), /realisation_reductions_insert/);
    await add(20_000);
    const id = (
      await first<{ id: string }>(
        "SELECT id FROM realisation_reductions WHERE document_id = ? AND amount_minor = 30000",
        exp,
      )
    )?.id as string;
    await rejects(
      run(
        "UPDATE realisation_reductions SET letter_r2_key = 'k', letter_sha256 = ?2, letter_mime = 'text/plain' WHERE id = ?1",
        id,
        "a".repeat(64),
      ),
      /realisation_reductions_fixed/,
    );
    await run(
      "UPDATE realisation_reductions SET letter_r2_key = 'k', letter_sha256 = ?2, letter_mime = 'application/pdf' WHERE id = ?1",
      id,
      "a".repeat(64),
    );
    await rejects(
      run("UPDATE realisation_reductions SET letter_r2_key = 'k2' WHERE id = ?", id),
      /realisation_reductions_fixed/,
    );
    await rejects(
      run("UPDATE realisation_reductions SET amount_minor = 1 WHERE id = ?", id),
      /realisation_reductions_fixed/,
    );
    await rejects(
      run("DELETE FROM realisation_reductions WHERE id = ?", id),
      /realisation_reductions_no_delete/,
    );
  });
});
