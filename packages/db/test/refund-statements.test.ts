// M6.5's statements and their twins [ADM-PAY-08, -09, -10, ADM-INV-09, -17, ADM-SET-04; run file A, C, I, L1 to L5, L9 to L11, L33 to L39]: the refund batch (credit,
// document, pending; manual, gateway, outside) with every guard in its WHERE and the post-condition last; the gateway's word; the pending payment rejected; the
// withdraw's receipt void; the receipt's issue batch (idempotent, consecutive numbers, a new FY, refused payments, the post-condition); the settlement page; bank
// matches; FEMA reductions; and the twins: free money vs core, the RA-41 line vs core, the stage with M6.5's facts vs core, and the readers with refunds (credit,
// client figures, collected, the statement) and with receipts present. The real statement builders; invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { DEFAULT_REALISATION_RULES, realisationStatus } from "@techaust/core/gst";
import { freeOf } from "@techaust/core/ledger";
import { receiptHeaderOf, receiptIdOf, receiptSealOf } from "@techaust/core/receipts";
import { overpaymentAdvanceLine, refundableOf } from "@techaust/core/refunds";
import { describe, expect, it } from "vitest";
import {
  CLIENT_CREDIT_SQL,
  COLLECTED_SQL,
  COLLECTED_TILE_SQL,
  CREDIT_DRAW_SQL,
  CREDIT_SOURCES_SQL,
  withdrawPaymentStatement,
} from "../src/ledger.ts";
import { auditStmt, guardSql } from "../src/log.ts";
import { settingsBinds, stageSql } from "../src/realisation.ts";
import {
  RECEIPT_ALLOCATIONS_SQL,
  RECEIPT_PAYMENT_SQL,
  RECEIPT_PDF_PENDING_SQL,
  RECEIPTS_DUE_SQL,
  receiptIssueStatements,
} from "../src/receipts.ts";
import {
  bankMatchRemoveStatement,
  bankMatchStatement,
  PAYMENT_REFUNDS_SQL,
  pendingRefundedRejectStatement,
  REFUND_BY_PROVIDER_REF_SQL,
  REFUNDS_IDLE_SQL,
  REFUNDS_LIST_BY_STATUS_SQL,
  REFUNDS_LIST_SQL,
  type RefundInsertArgs,
  realisationReductionStatement,
  receiptVoidStatement,
  refundAttemptStatement,
  refundBatchResult,
  refundCancelStatement,
  refundInsertStatement,
  refundMoveStatement,
  refundResultStatement,
  refundSideStatements,
  SETTLEMENTS_SQL,
  settlementPageStatements,
  UNMATCHED_ITEMS_SQL,
} from "../src/refunds.ts";
import {
  CLIENT_FIGURES_SQL,
  EXPORT_STAGE_COUNTS_GROUPED_SQL,
  EXPORT_STAGE_COUNTS_SQL,
  INVOICED_SQL,
  OWED_SQL,
  REALISATION_PAGE_SQL,
  REFUNDS_REGISTER_SQL,
  REGISTER_PAGE_SQL,
  STATEMENT_LEDGER_SQL,
  STATEMENT_TOTALS_SQL,
  statementTotalsBinds,
} from "../src/reports.ts";
import { overpaymentAdvanceSql, paymentFreeSql } from "../src/sql-rules.ts";
import { mkClientRow, mkIssued, mkMember, mkReceipt, next } from "./billing-helpers.ts";
import { all, first, rejects, run } from "./helpers.ts";

const db = () => env.DB;
const T = 1_880_000_000_000;

async function session(userId: string, stepUp = true): Promise<string> {
  const id = `sess-${uuidv7()}`;
  const now = Date.now();
  await run(
    "INSERT INTO staff_sessions (id, user_id, last_seen_at, idle_expires_at, abs_expires_at, step_up_until) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    id,
    userId,
    now,
    now + 3_600_000,
    now + 3_600_000,
    stepUp ? now + 600_000 : null,
  );
  return id;
}

async function pay(
  clientId: string,
  owner: string,
  o: { amount?: number; status?: string; kind?: string; currency?: string; receivedOn?: string } = {},
) {
  const id = uuidv7();
  const status = o.status ?? "confirmed";
  const kind = o.kind ?? "payment";
  await run(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, tds_section, tds_rate_bp, recorded_by, recorded_at, verified_by, verified_at)
     VALUES (?1, ?2, ?3, 'manual', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    id,
    clientId,
    kind,
    status,
    o.currency ?? "INR",
    o.amount ?? 150_000,
    o.receivedOn ?? "2026-11-01",
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
const alloc = (p: string, d: string, amount: number, kind: "allocate" | "release" = "allocate") =>
  run(
    "INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    uuidv7(),
    p,
    d,
    amount,
    kind,
    T,
  );
const recompute = (docId: string) =>
  run(
    `UPDATE documents SET paid_minor = (SELECT coalesce(sum(CASE a.kind WHEN 'allocate' THEN a.amount_minor ELSE -a.amount_minor END), 0) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE a.document_id = documents.id AND p.status = 'confirmed' AND p.kind = 'payment'),
       balance_minor = max(0, total_minor - (SELECT coalesce(sum(CASE a.kind WHEN 'allocate' THEN a.amount_minor ELSE -a.amount_minor END), 0) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE a.document_id = documents.id AND p.status = 'confirmed' AND p.kind = 'payment') - credited_minor - tds_minor),
       status = 'paid' WHERE id = ?1`,
    docId,
  );

/** The refund batch as the finance route runs it (`mutate`'s shape): main, the audit row on `changes()`, the side statements on the audit row, the result last. */
async function refundBatch(a: RefundInsertArgs, owner: string): Promise<boolean> {
  const auditId = uuidv7();
  const releaseId = uuidv7();
  const g = guardSql({ auditId });
  const docId = a.from === "document" ? a.documentId : null;
  await db().batch([
    refundInsertStatement(db(), a),
    auditStmt(
      db(),
      {
        id: auditId,
        actorId: owner,
        role: "owner",
        action: "refund.issue",
        entityType: "refund",
        entityId: a.id,
        requestId: null,
        ip: null,
        ua: null,
      },
      "changes",
    ),
    ...refundSideStatements(
      db(),
      {
        refundId: a.id,
        paymentId: a.paymentId,
        documentId: docId,
        amountMinor: a.amountMinor,
        releaseId,
        now: a.now,
      },
      g,
    ),
    ...refundBatchResult(db(), { paymentId: a.paymentId, documentId: docId, refundId: a.id }),
  ]);
  return (await first("SELECT id FROM payment_refunds WHERE id = ?", a.id)) !== null;
}

const args = (
  o: Partial<RefundInsertArgs> & Pick<RefundInsertArgs, "paymentId" | "sessionId">,
): RefundInsertArgs => ({
  id: uuidv7(),
  from: "credit",
  documentId: null,
  creditNoteId: null,
  amountMinor: 1_000,
  reasonCode: "overpayment",
  note: null,
  way: {
    kind: "manual",
    mode: "neft",
    referenceNorm: `UTR${next()}`,
    paidOn: "2026-11-03",
    paidTo: "own_account",
  },
  now: Date.now(),
  today: "2026-11-03",
  ...o,
});

async function setup() {
  const owner = await mkMember("owner");
  const sess = await session(owner);
  const clientId = await mkClientRow();
  return { owner, sess, clientId };
}

// ---- the refund batch ------------------------------------------------------------------------------------------------------------------------------------

describe("the refund batch: main statement guards, side statements, post-condition [C step 2, L2]", () => {
  it("from credit: a manual refund up to the free money; above it, an open refund or no step-up writes nothing", async () => {
    const { owner, sess, clientId } = await setup();
    const inv = await mkIssued(clientId);
    const p = await pay(clientId, owner);
    await alloc(p, inv, 118_000);
    await recompute(inv);
    expect(await refundBatch(args({ paymentId: p, sessionId: sess, amountMinor: 32_001 }), owner)).toBe(
      false,
    );
    expect(
      await refundBatch(
        args({ paymentId: p, sessionId: await session(owner, false), amountMinor: 1_000 }),
        owner,
      ),
    ).toBe(false);
    const staff = await mkMember("staff");
    expect(
      await refundBatch(args({ paymentId: p, sessionId: await session(staff), amountMinor: 1_000 }), owner),
    ).toBe(false);
    expect(await refundBatch(args({ paymentId: p, sessionId: sess, amountMinor: 32_000 }), owner)).toBe(true);
    const row = await first<Record<string, unknown>>(
      "SELECT status, provider, settled_on, requested_by, audit FROM (SELECT r.*, (SELECT count(*) FROM audit_log a WHERE a.entity_id = r.id) AS audit FROM payment_refunds r WHERE r.payment_id = ?)",
      p,
    );
    expect(row).toMatchObject({
      status: "succeeded",
      provider: "manual",
      settled_on: "2026-11-03",
      requested_by: owner,
      audit: 1,
    });
    expect((await first<{ credit: number }>(CLIENT_CREDIT_SQL, clientId))?.credit).toBe(0);
    // nothing left: another refund writes nothing
    expect(await refundBatch(args({ paymentId: p, sessionId: sess, amountMinor: 1 }), owner)).toBe(false);
  });

  it("from a document's excess: the refund row, then the release of exactly the amount, the link, the recompute, then ledger_result", async () => {
    const { owner, sess, clientId } = await setup();
    const inv = await mkIssued(clientId);
    const p = await pay(clientId, owner, { amount: 118_000 });
    await alloc(p, inv, 118_000);
    await recompute(inv);
    await run(
      "UPDATE documents SET credited_minor = 18000, balance_minor = 0, updated_at = updated_at + 1 WHERE id = ?",
      inv,
    );
    const base = {
      paymentId: p,
      sessionId: sess,
      from: "document" as const,
      documentId: inv,
      reasonCode: "credit_note",
    };
    expect(await refundBatch(args({ ...base, amountMinor: 18_001 }), owner)).toBe(false);
    const a = args({ ...base, amountMinor: 18_000 });
    expect(await refundBatch(a, owner)).toBe(true);
    const r = await first<{ release_allocation_id: string | null }>(
      "SELECT release_allocation_id FROM payment_refunds WHERE id = ?",
      a.id,
    );
    expect(r?.release_allocation_id).toBeTruthy();
    expect(
      await first(
        "SELECT kind, amount_minor FROM payment_allocations WHERE id = ?",
        r?.release_allocation_id,
      ),
    ).toEqual({ kind: "release", amount_minor: 18_000 });
    expect(await first("SELECT paid_minor, balance_minor, status FROM documents WHERE id = ?", inv)).toEqual({
      paid_minor: 100_000,
      balance_minor: 0,
      status: "paid",
    });
    // the client's credit is unchanged by the pair (released, then refunded): 0
    expect((await first<{ credit: number }>(CLIENT_CREDIT_SQL, clientId))?.credit).toBe(0);
  });

  it("through the gateway: requested, then the gateway's word moves it once; a failure leaves the money as credit; a cancel only before the gateway has it", async () => {
    const { owner, sess, clientId } = await setup();
    // a confirmed gateway payment of 50,000 on nothing (all credit)
    const p = await razorpayPayment(clientId, owner, "confirmed");
    const a = args({ paymentId: p, sessionId: sess, amountMinor: 20_000, way: { kind: "gateway" } });
    expect(await refundBatch(a, owner)).toBe(true);
    expect((await first<{ credit: number }>(CLIENT_CREDIT_SQL, clientId))?.credit).toBe(30_000);
    // a second refund while one is open: nothing (L8)
    expect(
      await refundBatch(
        args({ paymentId: p, sessionId: sess, amountMinor: 1, way: { kind: "gateway" } }),
        owner,
      ),
    ).toBe(false);
    await refundAttemptStatement(db(), { refundId: a.id, now: Date.now() }).run();
    const move = (to: "processing" | "succeeded" | "failed", ref: string | null = "rfnd_A") =>
      refundMoveStatement(db(), {
        refundId: a.id,
        to,
        providerRefundId: ref,
        providerStatus: to,
        failureCode: to === "failed" ? "BAD_REQUEST_ERROR" : null,
        now: Date.now(),
        today: "2026-11-03",
      }).run();
    expect((await move("processing")).meta.changes).toBe(1);
    expect((await move("processing")).meta.changes).toBe(0); // a replay
    expect((await move("failed", "rfnd_OTHER")).meta.changes).toBe(0); // another gateway id never lands
    expect((await move("failed")).meta.changes).toBe(1);
    expect(
      await first(
        "SELECT status, failure_code, attempts, settled_on FROM payment_refunds WHERE id = ?",
        a.id,
      ),
    ).toEqual({
      status: "failed",
      failure_code: "BAD_REQUEST_ERROR",
      attempts: 3,
      settled_on: null,
    });
    expect((await first<{ credit: number }>(CLIENT_CREDIT_SQL, clientId))?.credit).toBe(50_000);
    expect(await all(REFUND_BY_PROVIDER_REF_SQL, "razorpay", "rfnd_A")).toHaveLength(1);
    // cancel: only `requested`, with no gateway id, by the Owner with step-up
    const b = args({ paymentId: p, sessionId: sess, amountMinor: 5_000, way: { kind: "gateway" } });
    expect(await refundBatch(b, owner)).toBe(true);
    expect(
      (
        await refundCancelStatement(db(), {
          refundId: b.id,
          now: Date.now(),
          sessionId: await session(owner, false),
        }).run()
      ).meta.changes,
    ).toBe(0);
    expect(
      (await refundCancelStatement(db(), { refundId: b.id, now: Date.now(), sessionId: sess }).run()).meta
        .changes,
    ).toBe(1);
    expect(await first("SELECT status, failure_code FROM payment_refunds WHERE id = ?", b.id)).toEqual({
      status: "failed",
      failure_code: "cancelled",
    });
    // the lists
    expect((await all<{ id: string }>(PAYMENT_REFUNDS_SQL, p)).map((x) => x.id).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    expect(
      (await all(REFUNDS_LIST_BY_STATUS_SQL, "failed", Number.MAX_SAFE_INTEGER, "")).some(
        (x) => x.id === a.id,
      ),
    ).toBe(true);
    expect(await all(REFUNDS_IDLE_SQL, Date.now() + 1)).not.toContainEqual({ id: a.id });
  });

  it("an outside refund is recorded succeeded with the gateway's id; a chargeback needs its reason", async () => {
    const { owner, sess, clientId } = await setup();
    const p = await razorpayPayment(clientId, owner, "confirmed");
    const out = args({
      paymentId: p,
      sessionId: sess,
      amountMinor: 2_000,
      reasonCode: "other",
      way: { kind: "outside", origin: "outside", providerRefundId: "rfnd_OUT", settledOn: "2026-11-02" },
    });
    expect(await refundBatch(out, owner)).toBe(true);
    expect(
      await first("SELECT provider, origin, status, settled_on FROM payment_refunds WHERE id = ?", out.id),
    ).toEqual({
      provider: "razorpay",
      origin: "outside",
      status: "succeeded",
      settled_on: "2026-11-02",
    });
    await rejects(
      refundBatch(
        args({
          paymentId: p,
          sessionId: sess,
          amountMinor: 1,
          reasonCode: "other",
          way: { kind: "outside", origin: "chargeback", providerRefundId: "dp_1", settledOn: "2026-11-02" },
        }),
        owner,
      ),
      /payment_refunds_insert_state/,
    );
  });

  it("L33: a pending gateway payment refunded in full, then rejected by the system; never a partial or a manual refund of it", async () => {
    const { owner, sess, clientId } = await setup();
    const p = await razorpayPayment(clientId, owner, "pending_verification");
    expect(
      await refundBatch(
        args({
          paymentId: p,
          sessionId: sess,
          from: "pending",
          amountMinor: 49_999,
          way: { kind: "gateway" },
        }),
        owner,
      ),
    ).toBe(false);
    expect(
      await refundBatch(args({ paymentId: p, sessionId: sess, from: "pending", amountMinor: 50_000 }), owner),
    ).toBe(false);
    const a = args({
      paymentId: p,
      sessionId: sess,
      from: "pending",
      amountMinor: 50_000,
      way: { kind: "gateway" },
    });
    expect(await refundBatch(a, owner)).toBe(true);
    const now = Date.now();
    expect((await pendingRefundedRejectStatement(db(), { refundId: a.id, now }).run()).meta.changes).toBe(0); // not succeeded yet
    await db().batch([
      refundMoveStatement(db(), {
        refundId: a.id,
        to: "succeeded",
        providerRefundId: "rfnd_P",
        providerStatus: "processed",
        failureCode: null,
        now,
        today: "2026-11-03",
      }),
      pendingRefundedRejectStatement(db(), { refundId: a.id, now }),
    ]);
    expect(await first("SELECT status, verified_by FROM payments WHERE id = ?", p)).toEqual({
      status: "rejected",
      verified_by: null,
    });
    // never collected, never subtracted
    const collected = await all<{ currency: string; collected: number }>(
      COLLECTED_SQL,
      "2026-11-01",
      "2026-11-30",
    );
    expect(collected.find((c) => c.currency === "INR")?.collected ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("the withdraw refuses a payment with a live refund (NO_LIVE_REFUND_SQL); a withdrawn payment's receipt is voided in its batch", async () => {
    const { owner, sess, clientId } = await setup();
    const p = await pay(clientId, owner, { amount: 5_000 });
    expect(await refundBatch(args({ paymentId: p, sessionId: sess, amountMinor: 1_000 }), owner)).toBe(true);
    const w = await withdrawPaymentStatement(db(), {
      paymentId: p,
      now: Date.now(),
      sessionId: sess,
      reason: "Error",
    }).run();
    expect(w.meta.changes).toBe(0);
    const { paymentId, receiptId } = await mkReceipt(clientId);
    const sess2 = await session(owner);
    const auditId = uuidv7();
    await db().batch([
      withdrawPaymentStatement(db(), {
        paymentId,
        now: Date.now(),
        sessionId: sess2,
        reason: "Recorded twice",
      }),
      auditStmt(
        db(),
        {
          id: auditId,
          actorId: owner,
          role: "owner",
          action: "payment.withdraw",
          entityType: "payment",
          entityId: paymentId,
          requestId: null,
          ip: null,
          ua: null,
        },
        "changes",
      ),
      receiptVoidStatement(db(), { paymentId, now: Date.now() }, guardSql({ auditId })),
    ]);
    expect(await first("SELECT status, void_reason FROM documents WHERE id = ?", receiptId)).toEqual({
      status: "void",
      void_reason: "payment_withdrawn",
    });
  });
});

async function razorpayPayment(
  clientId: string,
  owner: string,
  status: "confirmed" | "pending_verification",
  amount = 50_000,
  fees: readonly [number, number | null] = [236, 36],
): Promise<string> {
  const doc = await mkIssued(clientId);
  const staff = await mkMember("staff");
  const ck = uuidv7();
  await run(
    `INSERT INTO checkout_sessions (id, provider, document_id, client_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at)
     VALUES (?1, 'razorpay', ?2, ?3, ?4, 'staff', 'INR', ?5, 'creating', ?6, ?7, ?7)`,
    ck,
    doc,
    clientId,
    staff,
    amount,
    T + 86_400_000,
    T,
  );
  await run(
    "UPDATE checkout_sessions SET status = 'live', provider_link_id = ?2, short_url = 'https://rzp.io/i/x', updated_at = ?3 WHERE id = ?1",
    ck,
    `plink_${next()}`,
    T + 1,
  );
  const id = uuidv7();
  const ref = `pay_${next()}`;
  await run(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, fee_tax_minor, received_on, mode, reference_norm, recorded_at, provider_payment_id, checkout_id, refetched_at)
     VALUES (?1, ?2, 'payment', 'razorpay', 'pending_verification', 'INR', ?3, ?7, ?8, '2026-11-01', 'upi', ?4, ?5, ?4, ?6, ?5)`,
    id,
    clientId,
    amount,
    ref,
    T,
    ck,
    fees[0],
    fees[1],
  );
  if (status === "confirmed")
    await run(
      "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
      id,
      owner,
      T + 5,
    );
  return id;
}

// ---- receipts ------------------------------------------------------------------------------------------------------------------------------------------

describe("the receipt's issue batch (gap-free TH/RCT numbers; L3 to L5, L39)", () => {
  const PATTERN = "TH/RCT/%s/%04d";
  async function issue(
    paymentId: string,
    fy: string,
    opts: { amount?: number; numberingVersion?: number | null } = {},
  ) {
    const p = await first<{
      client_id: string;
      currency: "INR" | "USD";
      amount_minor: number;
      received_on: string;
      mode: string | null;
      reference_norm: string | null;
      provider: string;
      refunded_minor: number;
      client_name: string;
      client_gstin: string | null;
    }>(RECEIPT_PAYMENT_SQL, paymentId);
    if (!p) throw new Error("no payment");
    const allocations = await all<{
      document_id: string;
      number_display: string;
      type: string;
      held: number;
    }>(RECEIPT_ALLOCATIONS_SQL, paymentId);
    const h = receiptHeaderOf({
      payment: {
        id: paymentId,
        currency: p.currency,
        amountMinor: p.amount_minor,
        receivedOn: p.received_on,
        provider: p.provider,
        mode: p.mode,
        referenceNorm: p.reference_norm,
        refundedMinor: p.refunded_minor,
      },
      allocations: allocations.map((x) => ({
        documentId: x.document_id,
        number: x.number_display,
        type: x.type,
        amountMinor: x.held,
      })),
      client: { name: p.client_name, gstin: p.client_gstin },
      issuer: { tradeName: "Supplier", legalName: null, address: null, gstin: null, email: null },
      issuedOn: "2026-11-03",
    });
    if (!h.ok) throw new Error(h.code);
    const now = Date.now() + next();
    const s = receiptIssueStatements(db(), {
      paymentId,
      receiptId: receiptIdOf(paymentId),
      fy,
      pattern: PATTERN,
      argOrder: ["fy", "n"],
      maxNumber: 9999,
      numberingVersion: opts.numberingVersion === undefined ? null : opts.numberingVersion,
      issueDate: "2026-11-03",
      headerExtras: JSON.stringify({ receiptOf: h.value }),
      sealSha256: await receiptSealOf(h.value),
      amountMinor: opts.amount ?? p.amount_minor,
      currency: p.currency,
      clientId: p.client_id,
      now,
    });
    await db().batch([...s.main, ...s.postAudit]);
  }
  const counter = (fy: string) =>
    first<{ next_no: number }>("SELECT next_no FROM doc_counters WHERE series = 'receipt' AND fy = ?", fy);

  it("issues a frozen receipt with the next number and links the payment; a second issue aborts and burns no number", async () => {
    const { owner, clientId } = await setup();
    const fy = "8601";
    const inv = await mkIssued(clientId);
    const p = await pay(clientId, owner);
    await alloc(p, inv, 118_000);
    await recompute(inv);
    await issue(p, fy);
    const r = await first<Record<string, unknown>>(
      "SELECT type, status, series, fy, number, number_display, total_minor, parent_id, json_extract(header_extras, '$.receiptOf.heldAsCreditMinor') AS held FROM documents WHERE id = ?",
      `rct_${p}`,
    );
    expect(r).toEqual({
      type: "receipt",
      status: "issued",
      series: "receipt",
      fy,
      number: 1,
      number_display: `TH/RCT/${fy}/0001`,
      total_minor: 150_000,
      parent_id: null,
      held: 32_000,
    });
    expect(await first("SELECT receipt_document_id FROM payments WHERE id = ?", p)).toEqual({
      receipt_document_id: `rct_${p}`,
    });
    await rejects(issue(p, fy), /issue did not freeze|issue_result/);
    expect((await counter(fy))?.next_no).toBe(2);
    expect(await all(RECEIPTS_DUE_SQL, Number.MAX_SAFE_INTEGER)).toEqual(
      expect.not.arrayContaining([{ id: p }]),
    );
  });

  it("20 receipts in a row take 20 consecutive numbers; a new FY starts at 1", async () => {
    const { owner, clientId } = await setup();
    const fy = "8602";
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await pay(clientId, owner, { amount: 1_000 + i }));
    for (const id of ids) await issue(id, fy);
    const numbers = (
      await all<{ number: number }>(
        "SELECT number FROM documents WHERE series = 'receipt' AND fy = ? ORDER BY number",
        fy,
      )
    ).map((x) => x.number);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const later = await pay(clientId, owner);
    await issue(later, "8703");
    expect(await first("SELECT number, number_display FROM documents WHERE id = ?", `rct_${later}`)).toEqual({
      number: 1,
      number_display: "TH/RCT/8703/0001",
    });
  });

  it("refuses a pending, TDS or withdrawn payment, a stale amount and a changed numbering row: the batch aborts, no number taken", async () => {
    const { owner, clientId } = await setup();
    const fy = "8604";
    const pending = await pay(clientId, owner, { status: "pending_verification" });
    await rejects(issue(pending, fy), /issue did not freeze/);
    const tds = await pay(clientId, owner, { kind: "tds", amount: 1_000 });
    await rejects(issue(tds, fy), /issue did not freeze/);
    const p = await pay(clientId, owner);
    await rejects(issue(p, fy, { amount: 1 }), /issue did not freeze/);
    await rejects(issue(p, fy, { numberingVersion: 99 }), /issue did not freeze/);
    expect(await counter(fy)).toBeNull();
    await run(
      "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = 9, withdraw_reason = 'Error' WHERE id = ?1",
      p,
      owner,
    );
    await rejects(issue(p, fy), /issue did not freeze/);
  });

  it("every reader stays as it was with receipts present: registers, owed, invoiced, the statement and the client's figures", async () => {
    const { clientId } = await setup();
    const { receiptId } = await mkReceipt(clientId);
    const reg = await all<{ id: string }>(REGISTER_PAGE_SQL(false), "2026-10-01", "2026-11-30");
    expect(reg.map((x) => x.id)).not.toContain(receiptId);
    const owed = await all<{ currency: string; n: number }>(OWED_SQL, "2026-11-03");
    const invoiced = await all(INVOICED_SQL, "2026-04-01", "2027-03-31", "2026-11-01");
    expect(JSON.stringify(owed)).not.toContain(receiptId);
    expect(invoiced.every((r) => (r as { fy_documents: number }).fy_documents >= 0)).toBe(true);
    // the statement: the receipt's payment is one receipt line; the receipt document itself is no line
    const totals = await first<{ debit: number; credit: number; n: number }>(
      STATEMENT_TOTALS_SQL,
      ...statementTotalsBinds(clientId, "INR", "2026-01-01", "2026-12-31"),
    );
    expect(totals).toEqual({ debit: 0, credit: 118_000, n: 1 });
    const fig = await all(CLIENT_FIGURES_SQL, clientId, "2026-11-03");
    expect(fig).toEqual([]);
  });

  it("early check 2, finding 5: 21 due payments of an anonymised client never fill the sweep; the 22nd, a live client's, is listed", async () => {
    const { owner } = await setup();
    const gone = await mkClientRow();
    const live = await mkClientRow();
    // verified long before every other test's payment (T), so these lead the oldest-first sweep
    const at = async (clientId: string, verifiedAt: number) => {
      const id = uuidv7();
      await run(
        `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at, verified_by, verified_at)
         VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'INR', 1000, '2026-11-01', 'neft', ?3, ?4, ?3, ?4)`,
        id,
        clientId,
        owner,
        verifiedAt,
      );
      return id;
    };
    const erased: string[] = [];
    for (let i = 0; i < 21; i++) erased.push(await at(gone, 1_000 + i));
    const fresh = await at(live, 2_000);
    await run("UPDATE clients SET anonymised_at = 5 WHERE id = ?1", gone);
    const due = (await all<{ id: string }>(RECEIPTS_DUE_SQL, 3_000)).map((r) => r.id);
    // (another test of this file may leave an older due payment; none of the erased client's is listed, and the live one is)
    expect(due).toContain(fresh);
    expect(due.filter((id) => erased.includes(id))).toEqual([]);
    expect(due.length).toBeLessThan(20);
  });

  it("early check 2, findings 4 and 5: a void receipt and an anonymised client's receipt never wait for a PDF; an issued one does", async () => {
    const { owner, clientId } = await setup();
    const fy = "8605";
    const kept = await pay(clientId, owner);
    const voided = await pay(clientId, owner);
    await issue(kept, fy);
    await issue(voided, fy);
    await run(
      "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = 9, withdraw_reason = 'Error' WHERE id = ?1",
      voided,
      owner,
    );
    await run(
      "UPDATE documents SET status = 'void', voided_at = 10, void_reason = 'payment_withdrawn', updated_at = updated_at + 1 WHERE id = ?1",
      `rct_${voided}`,
    );
    const other = await setup();
    const erased = await pay(other.clientId, other.owner);
    await issue(erased, fy);
    await run("UPDATE clients SET anonymised_at = 5 WHERE id = ?1", other.clientId);
    // every pending row (the file's other receipts too), not just the first 20
    const pending = (
      await all<{ id: string }>(RECEIPT_PDF_PENDING_SQL.replace("LIMIT 20", "LIMIT 1000"))
    ).map((r) => r.id);
    expect(pending).toContain(`rct_${kept}`);
    expect(pending).not.toContain(`rct_${voided}`);
    expect(pending).not.toContain(`rct_${erased}`);
  });
});

// ---- the twins and the readers with refunds ------------------------------------------------------------------------------------------------------------

describe("twins: free money, the RA-41 line, the stage with M6.5's facts [L35, RA-41, RB-43, RA-38]", () => {
  it("paymentFreeSql equals core refundableOf / freeOf; overpaymentAdvanceSql equals core overpaymentAdvanceLine", async () => {
    const { owner, sess, clientId } = await setup();
    const cases: { amount: number; alloc: number; refund: number }[] = [
      { amount: 150_000, alloc: 118_000, refund: 0 },
      { amount: 150_000, alloc: 118_000, refund: 30_000 },
      { amount: 118_050, alloc: 118_000, refund: 0 },
      { amount: 5_000, alloc: 0, refund: 1_000 },
      { amount: 118_000, alloc: 0, refund: 0 },
    ];
    for (const c of cases) {
      const p = await pay(clientId, owner, { amount: c.amount });
      if (c.alloc > 0) {
        const inv = await mkIssued(clientId);
        await alloc(p, inv, c.alloc);
        await recompute(inv);
      }
      if (c.refund > 0)
        expect(await refundBatch(args({ paymentId: p, sessionId: sess, amountMinor: c.refund }), owner)).toBe(
          true,
        );
      const row = await first<{ free: number; line: number; net: number; refunded: number }>(
        `SELECT ${paymentFreeSql("p")} AS free, ${overpaymentAdvanceSql("p", "100000")} AS line,
           (SELECT coalesce(sum(CASE a.kind WHEN 'allocate' THEN a.amount_minor ELSE -a.amount_minor END), 0) FROM payment_allocations a WHERE a.payment_id = p.id) AS net,
           (SELECT coalesce(sum(r.amount_minor), 0) FROM payment_refunds r WHERE r.payment_id = p.id AND r.status <> 'failed') AS refunded
         FROM payments p WHERE p.id = ?`,
        p,
      );
      if (!row) throw new Error("row");
      expect(row.free).toBe(
        refundableOf({ amountMinor: c.amount, netAllocatedMinor: row.net, refundedMinor: row.refunded }),
      );
      expect(row.free).toBe(
        freeOf({
          id: p,
          kind: "payment",
          status: "confirmed",
          receivedOn: "2026-11-01",
          amountMinor: c.amount,
          netAllocatedMinor: row.net,
          refundedMinor: row.refunded,
        }),
      );
      const core = overpaymentAdvanceLine({
        currency: "INR",
        creditMinor: row.free,
        allocatedAny: row.net > 0,
        excessProvisoMinor: 100_000,
      });
      expect(row.line === 1, JSON.stringify(c)).toBe(core !== null);
    }
  });

  it("stageSql equals core stageOf with the facts: reduction pending, the proof rule, the reductions, the counts never show realised", async () => {
    const { owner, sess } = await setup();
    const usd = await mkClientRow({ currency: "USD" });
    const exp = async (
      supply: "export_lut" | "export_igst",
      total: number,
      paid: number,
      credited: number,
    ) => {
      const id = uuidv7();
      const n = next();
      await run(
        `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, supply_type, total_minor, paid_minor, credited_minor, balance_minor, updated_at)
         VALUES (?1, 'export_invoice', 'issued', ?2, 'USD', 'exp-r', '9999', ?3, ?4, 1000, '2026-11-01', ?5, ?6, ?7, ?8, ?9, 7000)`,
        id,
        usd,
        n,
        `E/${n}`,
        supply,
        total,
        paid,
        credited,
        Math.max(0, total - paid - credited),
      );
      return id;
    };
    const today = "2026-12-01";
    const stage = async (id: string) =>
      (
        await first<{ stage: string }>(
          `SELECT ${stageSql("d", settingsBinds("?2"))} AS stage FROM documents d WHERE d.id = ?1`,
          id,
          today,
        )
      )?.stage;
    const core = async (id: string) => {
      const r = await first<{
        total_minor: number;
        paid_minor: number;
        balance_minor: number;
        supply_type: "export_lut" | "export_igst";
        red: number;
      }>(
        "SELECT total_minor, paid_minor, balance_minor, supply_type, (SELECT coalesce(sum(amount_minor), 0) FROM realisation_reductions WHERE document_id = d.id) AS red FROM documents d WHERE id = ?",
        id,
      );
      if (!r) throw new Error("doc");
      const s = realisationStatus(
        {
          invoiceDate: { year: 2026, month: 11, day: 1 },
          currency: "USD",
          supplyType: r.supply_type,
          outstandingMinor: r.balance_minor,
          facts: {
            paidMinor: r.paid_minor,
            totalMinor: r.total_minor,
            reductionsMinor: r.red,
            proofMissing: false,
          },
        },
        { year: 2026, month: 12, day: 1 },
        DEFAULT_REALISATION_RULES,
      );
      return s.ok ? s.value.stage : "error";
    };
    const short = await exp("export_lut", 10_000, 6_000, 4_000); // credited, paid less: reduction pending
    const full = await exp("export_lut", 10_000, 10_000, 0); // realised
    const open = await exp("export_igst", 10_000, 0, 0); // ok
    for (const id of [short, full, open]) expect(await stage(id)).toBe(await core(id));
    expect(await stage(short)).toBe("reduction_pending");
    expect(await stage(full)).toBe("realised");
    await realisationReductionStatement(db(), {
      id: uuidv7(),
      documentId: short,
      amountMinor: 4_000,
      approvedOn: "2026-11-20",
      bankRef: "ADB/1",
      declaration: true,
      note: null,
      sessionId: sess,
      now: Date.now(),
    }).run();
    expect(await stage(short)).toBe("realised");
    expect(await stage(short)).toBe(await core(short));
    // a reduction above what is left of the total writes nothing
    expect(
      (
        await realisationReductionStatement(db(), {
          id: uuidv7(),
          documentId: short,
          amountMinor: 6_001,
          approvedOn: "2026-11-20",
          bankRef: "ADB/2",
          declaration: false,
          note: null,
          sessionId: sess,
          now: Date.now(),
        }).run()
      ).meta.changes,
    ).toBe(0);
    // RA-38: a confirmed card payment on an LUT export with no proof keeps it out of "realised"
    const card = uuidv7();
    await run(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, received_on, mode, reference_norm, recorded_at, verified_by, verified_at, provider_payment_id, checkout_id, refetched_at)
       VALUES (?1, ?2, 'payment', 'stripe', 'pending_verification', 'USD', 10000, 0, '2026-11-01', 'card', ?3, ?4, NULL, NULL, ?3, ?5, ?4)`,
      card,
      usd,
      `pi_${next()}`,
      T,
      await stripeCheckout(full, usd),
    );
    await run(
      "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
      card,
      owner,
      T + 9,
    );
    await alloc(card, full, 10_000);
    expect(await stage(full)).toBe("ok");
    // the realisation list's "open" view (no stage in its SQL): the unproven LUT export is open, the reduced one and the open IGST one as their stages say
    const openIds = async () =>
      (await all<{ id: string }>(REALISATION_PAGE_SQL("open", false))).map((r) => r.id);
    expect(await openIds()).toEqual(expect.arrayContaining([full, open]));
    expect(await openIds()).not.toContain(short);
    const counts = await all<{ stage: string; n: number }>(EXPORT_STAGE_COUNTS_SQL, today);
    const grouped = await all<{ stage: string; n: number }>(EXPORT_STAGE_COUNTS_GROUPED_SQL, today);
    expect(counts.map((c) => c.stage)).not.toContain("realised");
    expect([...counts].sort((a, b) => a.stage.localeCompare(b.stage))).toEqual(
      [...grouped].sort((a, b) => a.stage.localeCompare(b.stage)),
    );
    await run(
      "UPDATE payments SET proof_kind = 'advice', proof_r2_key = 'k', proof_sha256 = ?2, proof_mime = 'application/pdf' WHERE id = ?1",
      card,
      "a".repeat(64),
    );
    expect(await stage(full)).toBe("realised");
    expect(await openIds()).not.toContain(full);
    const page = await all<{
      id: string;
      reductions_minor: number;
      proof_missing: number;
      reduction_ref: string | null;
    }>(REALISATION_PAGE_SQL("all", false));
    expect(page.find((r) => r.id === short)).toMatchObject({
      reductions_minor: 4_000,
      proof_missing: 0,
      reduction_ref: "ADB/1",
    });
  });
});

async function stripeCheckout(documentId: string, clientId: string): Promise<string> {
  const staff = await mkMember("staff");
  const id = uuidv7();
  await run(
    `INSERT INTO checkout_sessions (id, provider, document_id, client_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at)
     VALUES (?1, 'stripe', ?2, ?3, ?4, 'staff', 'USD', 10000, 'creating', ?5, ?6, ?6)`,
    id,
    documentId,
    clientId,
    staff,
    T + 86_400_000,
    T,
  );
  return id;
}

describe("the readers with refunds: credit, client figures, collected, the statement [L9, L35]", () => {
  it("credit sources and the draw skip refunded money; figures, collected and the statement count only refunds that went out", async () => {
    const { owner, sess, clientId } = await setup();
    const inv = await mkIssued(clientId);
    const p = await pay(clientId, owner, { amount: 150_000, receivedOn: "2026-11-02" });
    await alloc(p, inv, 118_000);
    await recompute(inv);
    expect(await refundBatch(args({ paymentId: p, sessionId: sess, amountMinor: 12_000 }), owner)).toBe(true);
    const src = await all<{ id: string; net: number; refunded: number }>(CREDIT_SOURCES_SQL, clientId, "INR");
    expect(src).toEqual([expect.objectContaining({ id: p, net: 118_000, refunded: 12_000 })]);
    expect(await all(CREDIT_DRAW_SQL, clientId, "INR", 20_000)).toEqual([
      expect.objectContaining({ id: p, refunded: 12_000 }),
    ]);
    const fig = await first<{ collected: number; credit: number; balance: number; excess: number }>(
      CLIENT_FIGURES_SQL,
      clientId,
      "2026-11-03",
    );
    expect(fig).toMatchObject({ collected: 138_000, credit: 20_000, balance: 0, excess: 0 });
    const ledger = await first<{ balance: number }>(STATEMENT_LEDGER_SQL, clientId, "INR");
    const totals = await first<{ debit: number; credit: number; n: number }>(
      STATEMENT_TOTALS_SQL,
      ...statementTotalsBinds(clientId, "INR", "2026-01-01", "2026-12-31"),
    );
    // debits: the invoice 118,000 + the refund 12,000; credits: the receipt 150,000
    expect(totals).toEqual({ debit: 130_000, credit: 150_000, n: 3 });
    expect(ledger?.balance).toBe((totals?.debit ?? 0) - (totals?.credit ?? 0));
    expect((fig?.balance ?? 0) - (fig?.excess ?? 0) - (fig?.credit ?? 0)).toBe(ledger?.balance);
    // a refund still with the gateway: no line, no credit; the statement closes above the figures by exactly it
    const g = await razorpayPayment(clientId, owner, "confirmed", 10_000);
    expect(
      await refundBatch(
        args({ paymentId: g, sessionId: sess, amountMinor: 4_000, way: { kind: "gateway" } }),
        owner,
      ),
    ).toBe(true);
    const fig2 = await first<{ collected: number; credit: number; balance: number; excess: number }>(
      CLIENT_FIGURES_SQL,
      clientId,
      "2026-11-03",
    );
    const ledger2 = await first<{ balance: number }>(STATEMENT_LEDGER_SQL, clientId, "INR");
    expect((fig2?.balance ?? 0) - (fig2?.excess ?? 0) - (fig2?.credit ?? 0) - 4_000).toBe(ledger2?.balance);
    // collected: the payments received less the refunds that succeeded in the range; the tile equals its twin
    const twin = await all<{ currency: string; collected: number; n: number }>(
      COLLECTED_SQL,
      "2026-11-01",
      "2026-11-30",
    );
    const tile = await all<{ currency: string; fy_collected: number; fy_n: number }>(
      COLLECTED_TILE_SQL,
      "2026-11-01",
      "2026-11-30",
      "2026-11-01",
      "2026-11-30",
    );
    expect(tile.map((t) => [t.currency, t.fy_collected, t.fy_n])).toEqual(
      twin.map((t) => [t.currency, t.collected, t.n]),
    );
    const reg = await all<{ id: string; amount_minor: number }>(
      REFUNDS_REGISTER_SQL(false),
      "2026-11-01",
      "2026-11-30",
    );
    expect(reg.some((r) => r.amount_minor === 12_000)).toBe(true);
  });
});

// ---- settlements and bank matches ------------------------------------------------------------------------------------------------------------------------

describe("a settlement page, matching and bank matches [ADM-PAY-10, L11]", () => {
  it("stores the page once, matches our payment (fee flagged) and refund by gateway id and amount, leaves a wrong amount unmatched", async () => {
    const { owner, sess, clientId } = await setup();
    const p = await razorpayPayment(clientId, owner, "confirmed", 10_000);
    const ref = (
      await first<{ provider_payment_id: string }>("SELECT provider_payment_id FROM payments WHERE id = ?", p)
    )?.provider_payment_id as string;
    const odd = await razorpayPayment(clientId, owner, "confirmed", 7_000);
    const oddRef = (
      await first<{ provider_payment_id: string }>(
        "SELECT provider_payment_id FROM payments WHERE id = ?",
        odd,
      )
    )?.provider_payment_id as string;
    const r = args({ paymentId: p, sessionId: sess, amountMinor: 1_000, way: { kind: "gateway" } });
    expect(await refundBatch(r, owner)).toBe(true);
    await refundMoveStatement(db(), {
      refundId: r.id,
      to: "succeeded",
      providerRefundId: "rfnd_S1",
      providerStatus: "processed",
      failureCode: null,
      now: Date.now(),
      today: "2026-11-03",
    }).run();
    const setl = `setl_${next()}`;
    const page = {
      provider: "razorpay" as const,
      settlements: [
        {
          id: uuidv7(),
          settlementId: setl,
          utr: "UTRSET1",
          amountMinor: 15_528,
          feesMinor: 400,
          taxMinor: 72,
          settledAt: T,
          settledOn: "2026-11-02",
          status: "processed",
        },
      ],
      items: [
        {
          id: uuidv7(),
          entityType: "payment",
          entityId: ref,
          direction: "credit" as const,
          amountMinor: 10_000,
          feeMinor: 200,
          taxMinor: 36,
          settlementId: setl,
        },
        {
          id: uuidv7(),
          entityType: "payment",
          entityId: oddRef,
          direction: "credit" as const,
          amountMinor: 7_001,
          feeMinor: 236,
          taxMinor: 36,
          settlementId: setl,
        },
        {
          id: uuidv7(),
          entityType: "refund",
          entityId: "rfnd_S1",
          direction: "debit" as const,
          amountMinor: 1_000,
          feeMinor: 0,
          taxMinor: 0,
          settlementId: setl,
        },
        {
          id: uuidv7(),
          entityType: "adjustment",
          entityId: `adj_${next()}`,
          direction: "debit" as const,
          amountMinor: 5,
          feeMinor: 0,
          taxMinor: 0,
          settlementId: null,
        },
      ],
      now: Date.now(),
    };
    await db().batch(settlementPageStatements(db(), page));
    // a replay of the same page changes nothing
    await db().batch(
      settlementPageStatements(db(), {
        ...page,
        settlements: page.settlements.map((s) => ({ ...s, id: uuidv7() })),
        items: page.items.map((i) => ({ ...i, id: uuidv7() })),
      }),
    );
    const items = await all<{
      entity_id: string;
      match: string;
      payment_id: string | null;
      refund_id: string | null;
      fee_mismatch: number;
      settlement_id: string | null;
    }>(
      'SELECT entity_id, "match", payment_id, refund_id, fee_mismatch, settlement_id FROM settlement_items WHERE entity_id IN (?1, ?2, ?3)',
      ref,
      oddRef,
      "rfnd_S1",
    );
    expect(items).toHaveLength(3);
    expect(items.find((i) => i.entity_id === ref)).toMatchObject({
      match: "matched",
      payment_id: p,
      fee_mismatch: 1,
    });
    expect(items.find((i) => i.entity_id === oddRef)).toMatchObject({ match: "unmatched", payment_id: null });
    expect(items.find((i) => i.entity_id === "rfnd_S1")).toMatchObject({ match: "matched", refund_id: r.id });
    expect(items.every((i) => i.settlement_id !== null)).toBe(true);
    expect((await all("SELECT id FROM settlements WHERE settlement_id = ?", setl)).length).toBe(1);
    const list = await all<{ settlement_id: string; items: number; matched: number }>(
      SETTLEMENTS_SQL,
      "9999-12-31",
      "",
    );
    expect(list.find((s) => s.settlement_id === setl)).toMatchObject({ items: 3, matched: 2 });
    expect((await all<{ entity_id: string }>(UNMATCHED_ITEMS_SQL, -1, "")).map((i) => i.entity_id)).toEqual(
      expect.arrayContaining([oddRef]),
    );
    // bank matches: one live per target, by the Owner; undone with a reason; matched again
    const sId = (await first<{ id: string }>("SELECT id FROM settlements WHERE settlement_id = ?", setl))
      ?.id as string;
    const m = uuidv7();
    expect(
      (
        await bankMatchStatement(db(), {
          id: m,
          kind: "settlement",
          targetId: sId,
          statementOn: "2026-11-03",
          statementRef: null,
          sessionId: sess,
          now: Date.now(),
        }).run()
      ).meta.changes,
    ).toBe(1);
    expect(
      (
        await bankMatchStatement(db(), {
          id: uuidv7(),
          kind: "settlement",
          targetId: sId,
          statementOn: "2026-11-03",
          statementRef: null,
          sessionId: sess,
          now: Date.now(),
        }).run()
      ).meta.changes,
    ).toBe(0);
    const staff = await mkMember("staff");
    expect(
      (
        await bankMatchStatement(db(), {
          id: uuidv7(),
          kind: "payment",
          targetId: p,
          statementOn: "2026-11-03",
          statementRef: null,
          sessionId: await session(staff),
          now: Date.now(),
        }).run()
      ).meta.changes,
    ).toBe(0);
    expect(
      (
        await bankMatchRemoveStatement(db(), {
          id: m,
          reason: "Wrong line",
          sessionId: sess,
          now: Date.now(),
        }).run()
      ).meta.changes,
    ).toBe(1);
    expect(
      (
        await bankMatchRemoveStatement(db(), {
          id: m,
          reason: "Again",
          sessionId: sess,
          now: Date.now(),
        }).run()
      ).meta.changes,
    ).toBe(0);
    expect(
      (
        await bankMatchStatement(db(), {
          id: uuidv7(),
          kind: "settlement",
          targetId: sId,
          statementOn: "2026-11-03",
          statementRef: "L12",
          sessionId: sess,
          now: Date.now(),
        }).run()
      ).meta.changes,
    ).toBe(1);
  });
});

// ---- early check 1 (findings 1 to 3, 5 to 10) --------------------------------------------------------------------------------------------------------------

describe("early check 1: the statements [findings 1 to 3, 5 to 10; L40]", () => {
  it("finding 1: the insert refuses a second full refund of a pending payment once one succeeded", async () => {
    const { owner, sess, clientId } = await setup();
    const p = await razorpayPayment(clientId, owner, "pending_verification");
    const a = args({
      paymentId: p,
      sessionId: sess,
      from: "pending",
      amountMinor: 50_000,
      way: { kind: "gateway" },
    });
    expect(await refundBatch(a, owner)).toBe(true);
    await refundMoveStatement(db(), {
      refundId: a.id,
      to: "succeeded",
      providerRefundId: `rfnd_${next()}`,
      providerStatus: "processed",
      failureCode: null,
      now: Date.now(),
      today: "2026-11-03",
    }).run();
    // the reject was missed: the payment is still pending, and a second full refund writes nothing
    expect(
      await refundBatch(
        args({
          paymentId: p,
          sessionId: sess,
          from: "pending",
          amountMinor: 50_000,
          way: { kind: "gateway" },
        }),
        owner,
      ),
    ).toBe(false);
  });

  it("finding 4 + L33: an outside full refund of a pending payment is recorded and the payment rejected in the same batch", async () => {
    const { owner, sess, clientId } = await setup();
    const p = await razorpayPayment(clientId, owner, "pending_verification");
    const a = args({
      paymentId: p,
      sessionId: sess,
      from: "pending",
      amountMinor: 50_000,
      reasonCode: "other",
      way: {
        kind: "outside",
        origin: "outside",
        providerRefundId: `rfnd_${next()}`,
        settledOn: "2026-11-02",
      },
    });
    const auditId = uuidv7();
    await db().batch([
      refundInsertStatement(db(), a),
      auditStmt(
        db(),
        {
          id: auditId,
          actorId: owner,
          role: "owner",
          action: "refund.record",
          entityType: "refund",
          entityId: a.id,
          requestId: null,
          ip: null,
          ua: null,
        },
        "changes",
      ),
      pendingRefundedRejectStatement(db(), { refundId: a.id, now: Date.now() }, guardSql({ auditId })),
      ...refundBatchResult(db(), { paymentId: p, documentId: null, refundId: a.id }),
    ]);
    expect(await first("SELECT status FROM payments WHERE id = ?", p)).toEqual({ status: "rejected" });
    expect(await first("SELECT status, settled_on FROM payment_refunds WHERE id = ?", a.id)).toEqual({
      status: "succeeded",
      settled_on: "2026-11-02",
    });
  });

  it("finding 3: a refund never tried is idle only once it was requested before the cut-off", async () => {
    const { owner, sess, clientId } = await setup();
    const p = await razorpayPayment(clientId, owner, "confirmed");
    const now = Date.now();
    const a = args({ paymentId: p, sessionId: sess, amountMinor: 1_000, way: { kind: "gateway" }, now });
    expect(await refundBatch(a, owner)).toBe(true);
    const ids = async (cut: number) => (await all<{ id: string }>(REFUNDS_IDLE_SQL, cut)).map((r) => r.id);
    expect(await ids(now - 15 * 60_000)).not.toContain(a.id); // still in its route's call
    expect(await ids(now + 1)).toContain(a.id); // requested before the cut-off, never tried
    await refundAttemptStatement(db(), { refundId: a.id, now: now + 10 }).run();
    expect(await ids(now + 5)).not.toContain(a.id); // tried after the cut-off
    expect(await ids(now + 11)).toContain(a.id);
  });

  it("L40 (finding 5): a chargeback recorded on a fully paid invoice reopens its balance and lowers what was collected; an Owner's refund there needs a credit note", async () => {
    const { owner, sess, clientId } = await setup();
    const p = await razorpayPayment(clientId, owner, "confirmed", 118_000);
    const inv = await mkIssued(clientId);
    await alloc(p, inv, 118_000);
    await recompute(inv);
    const base = { paymentId: p, sessionId: sess, from: "document" as const, documentId: inv };
    // an Owner's gateway refund from a document with no excess writes nothing
    expect(
      await refundBatch(
        args({ ...base, amountMinor: 10_000, reasonCode: "other", way: { kind: "gateway" } }),
        owner,
      ),
    ).toBe(false);
    const cb = args({
      ...base,
      amountMinor: 10_000,
      reasonCode: "chargeback",
      way: {
        kind: "outside",
        origin: "chargeback",
        providerRefundId: `disp_${next()}`,
        settledOn: "2026-11-03",
      },
    });
    expect(await refundBatch(cb, owner)).toBe(true);
    expect(await first("SELECT paid_minor, balance_minor, status FROM documents WHERE id = ?", inv)).toEqual({
      paid_minor: 108_000,
      balance_minor: 10_000,
      status: "partially_paid",
    });
    expect((await first<{ credit: number }>(CLIENT_CREDIT_SQL, clientId))?.credit).toBe(0);
    // above what the payment holds there: nothing
    expect(
      await refundBatch(
        args({
          ...base,
          amountMinor: 108_001,
          reasonCode: "chargeback",
          way: {
            kind: "outside",
            origin: "chargeback",
            providerRefundId: `disp_${next()}`,
            settledOn: "2026-11-03",
          },
        }),
        owner,
      ),
    ).toBe(false);
  });

  it("finding 9: a manual refund settles on its paid-on day", async () => {
    const { owner, sess, clientId } = await setup();
    const p = await pay(clientId, owner, { amount: 5_000 });
    const a = args({
      paymentId: p,
      sessionId: sess,
      amountMinor: 1_000,
      way: {
        kind: "manual",
        mode: "neft",
        referenceNorm: `UTR${next()}`,
        paidOn: "2026-10-30",
        paidTo: "original",
      },
    });
    expect(await refundBatch(a, owner)).toBe(true);
    expect(await first("SELECT settled_on, paid_on FROM payment_refunds WHERE id = ?", a.id)).toEqual({
      settled_on: "2026-10-30",
      paid_on: "2026-10-30",
    });
  });

  it("finding 10: the Refunds tab lists all statuses and one status through their own indexes, newest first", async () => {
    const { owner, sess, clientId } = await setup();
    const p = await pay(clientId, owner, { amount: 9_000 });
    const made: string[] = [];
    for (let i = 0; i < 3; i++) {
      const a = args({ paymentId: p, sessionId: sess, amountMinor: 1_000, now: Date.now() + i });
      expect(await refundBatch(a, owner)).toBe(true);
      made.push(a.id);
    }
    const allIds = (await all<{ id: string }>(REFUNDS_LIST_SQL, Number.MAX_SAFE_INTEGER, "")).map(
      (r) => r.id,
    );
    expect(allIds.filter((x) => made.includes(x))).toEqual([...made].reverse());
    const ok = (
      await all<{ id: string }>(REFUNDS_LIST_BY_STATUS_SQL, "succeeded", Number.MAX_SAFE_INTEGER, "")
    ).map((r) => r.id);
    expect(ok).toEqual(expect.arrayContaining(made));
    const planAll = await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${REFUNDS_LIST_SQL}`, 1, "");
    const planOne = await all<{ detail: string }>(
      `EXPLAIN QUERY PLAN ${REFUNDS_LIST_BY_STATUS_SQL}`,
      "failed",
      1,
      "",
    );
    expect(planAll.map((r) => r.detail).join("\n")).toMatch(/payment_refunds_list/);
    expect(planOne.map((r) => r.detail).join("\n")).toMatch(/payment_refunds_status_list/);
    expect(
      planAll
        .concat(planOne)
        .map((r) => r.detail)
        .join("\n"),
    ).not.toMatch(/TEMP B-TREE/);
  });

  it("findings 6 and 7: a payment with no fee tax on record is never fee-flagged; a re-fetch sets a missing UTR once; a row without its day aborts the page", async () => {
    const { owner, clientId } = await setup();
    const p = await razorpayPayment(clientId, owner, "confirmed", 12_000, [0, null]);
    const ref = (
      await first<{ provider_payment_id: string }>("SELECT provider_payment_id FROM payments WHERE id = ?", p)
    )?.provider_payment_id as string;
    const setl = `setl_${next()}`;
    const settlement = {
      id: uuidv7(),
      settlementId: setl,
      utr: null as string | null,
      amountMinor: 11_700,
      feesMinor: 254,
      taxMinor: 46,
      settledAt: T,
      settledOn: "2026-11-02",
      status: "processed",
    };
    const item = {
      id: uuidv7(),
      entityType: "payment",
      entityId: ref,
      direction: "credit" as const,
      amountMinor: 12_000,
      feeMinor: 254,
      taxMinor: 46,
      settlementId: setl,
    };
    await db().batch(
      settlementPageStatements(db(), {
        provider: "razorpay",
        settlements: [settlement],
        items: [item],
        now: Date.now(),
      }),
    );
    expect(
      await first('SELECT "match", fee_mismatch FROM settlement_items WHERE entity_id = ?', ref),
    ).toEqual({ match: "matched", fee_mismatch: 0 });
    expect(await first("SELECT utr FROM settlements WHERE settlement_id = ?", setl)).toEqual({ utr: null });
    // a later fetch knows the UTR: set once; a different one never replaces it
    await db().batch(
      settlementPageStatements(db(), {
        provider: "razorpay",
        settlements: [{ ...settlement, id: uuidv7(), utr: "UTRLATE1" }],
        items: [],
        now: Date.now(),
      }),
    );
    await db().batch(
      settlementPageStatements(db(), {
        provider: "razorpay",
        settlements: [{ ...settlement, id: uuidv7(), utr: "UTROTHER" }],
        items: [],
        now: Date.now(),
      }),
    );
    expect(await first("SELECT utr FROM settlements WHERE settlement_id = ?", setl)).toEqual({
      utr: "UTRLATE1",
    });
    // a settlement without its day, or an item with a negative amount, aborts the whole page (never silently dropped)
    const before = (await first<{ n: number }>("SELECT count(*) AS n FROM settlement_items"))?.n;
    await rejects(
      db().batch(
        settlementPageStatements(db(), {
          provider: "razorpay",
          settlements: [
            {
              ...settlement,
              id: uuidv7(),
              settlementId: `setl_${next()}`,
              settledOn: null as unknown as string,
            },
          ],
          items: [{ ...item, id: uuidv7(), entityId: `pay_${next()}` }],
          now: Date.now(),
        }),
      ),
      /NOT NULL|constraint/i,
    );
    await rejects(
      db().batch(
        settlementPageStatements(db(), {
          provider: "razorpay",
          settlements: [],
          items: [{ ...item, id: uuidv7(), entityId: `pay_${next()}`, amountMinor: -1 }],
          now: Date.now(),
        }),
      ),
      /CHECK|constraint/i,
    );
    expect((await first<{ n: number }>("SELECT count(*) AS n FROM settlement_items"))?.n).toBe(before);
  });

  it("finding 8: the batch's last statements refuse a refund from a document whose release went missing", async () => {
    const { owner, sess, clientId } = await setup();
    const inv = await mkIssued(clientId);
    const p = await pay(clientId, owner, { amount: 118_000 });
    await alloc(p, inv, 118_000);
    await recompute(inv);
    await run(
      "UPDATE documents SET credited_minor = 18000, balance_minor = 0, updated_at = updated_at + 1 WHERE id = ?",
      inv,
    );
    const a = args({
      paymentId: p,
      sessionId: sess,
      from: "document",
      documentId: inv,
      reasonCode: "credit_note",
      amountMinor: 5_000,
    });
    // the refund row without its side statements: the post-conditions abort the batch
    await rejects(
      db().batch([refundInsertStatement(db(), a), refundResultStatement(db(), [a.id])]),
      /refund_result_check/,
    );
    expect(await first("SELECT id FROM payment_refunds WHERE id = ?", a.id)).toBeNull();
    await refundResultStatement(db(), []).run();
  });

  it("finding 2: an LUT export settled by a credit note with an unproven card payment shows its GST stage, never reduction_pending (core twin)", async () => {
    const { owner } = await setup();
    const usd = await mkClientRow({ currency: "USD" });
    const id = uuidv7();
    const n = next();
    await run(
      `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, supply_type, total_minor, paid_minor, credited_minor, balance_minor, updated_at)
       VALUES (?1, 'export_invoice', 'issued', ?2, 'USD', 'exp-r', '9999', ?3, ?4, 1000, '2025-06-01', 'export_lut', 10000, 6000, 4000, 0, 7000)`,
      id,
      usd,
      n,
      `E/${n}`,
    );
    const card = uuidv7();
    await run(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, received_on, mode, reference_norm, recorded_at, provider_payment_id, checkout_id, refetched_at)
       VALUES (?1, ?2, 'payment', 'stripe', 'pending_verification', 'USD', 6000, 0, '2025-06-02', 'card', ?3, ?4, ?3, ?5, ?4)`,
      card,
      usd,
      `pi_${next()}`,
      T,
      await stripeCheckout(id, usd),
    );
    await run(
      "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
      card,
      owner,
      T + 9,
    );
    await alloc(card, id, 6_000);
    for (const today of ["2025-07-01", "2026-12-01"]) {
      const sqlStage = (
        await first<{ stage: string }>(
          `SELECT ${stageSql("d", settingsBinds("?2"))} AS stage FROM documents d WHERE d.id = ?1`,
          id,
          today,
        )
      )?.stage;
      const [y, m, d] = today.split("-").map(Number) as [number, number, number];
      const s = realisationStatus(
        {
          invoiceDate: { year: 2025, month: 6, day: 1 },
          currency: "USD",
          supplyType: "export_lut",
          outstandingMinor: 0,
          facts: { paidMinor: 6_000, totalMinor: 10_000, reductionsMinor: 0, proofMissing: true },
        },
        { year: y, month: m, day: d },
        DEFAULT_REALISATION_RULES,
      );
      expect(sqlStage).toBe(s.ok ? s.value.stage : "error");
      expect(sqlStage).not.toBe("reduction_pending");
    }
    // once the proof is on file, the reduction shows
    await run(
      "UPDATE payments SET proof_kind = 'advice', proof_r2_key = 'k', proof_sha256 = ?2, proof_mime = 'application/pdf' WHERE id = ?1",
      card,
      "b".repeat(64),
    );
    expect(
      (
        await first<{ stage: string }>(
          `SELECT ${stageSql("d", settingsBinds("?2"))} AS stage FROM documents d WHERE d.id = ?1`,
          id,
          "2026-12-01",
        )
      )?.stage,
    ).toBe("reduction_pending");
  });
});
