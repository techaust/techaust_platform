// M6.5 in the jobs Worker [ADM-PAY-08, -09, -10, JOB-HOOK-01, JOB-PDF-01; run file D, L3, L34, L37]: the receipt messages on the PDF queue (`receipt.issue` to
// BillingJobs over RPC, the sweep), the refund family on the leads queue (`refund.check` and `recon.fetch` over RPC, the next page, the refund sweep), and a dead
// `refund.check` that becomes a `refund_stuck` item. The RPC entrypoints are fakes; no gateway is reached. Invented test data.
import { env as realEnv } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { handleQueue } from "../src/queue.ts";
import { processReceipt } from "../src/receipts.ts";
import { processRefundDeadLetter, processRefundFamily } from "../src/refunds.ts";
import { fakes, logs, makeEnv, mkClient, mkDoc, staff, useFakes } from "./billing-fixtures.ts";

useFakes();

describe("early check 2, finding 4: a void receipt is never rendered or emailed [L10]", () => {
  it("a receipt voided (its payment withdrawn) before its PDF: the render is skipped, nothing stored or sent, and the sweep never lists it", async () => {
    const now = Date.now();
    const owner = await staff("owner");
    const clientId = await mkClient();
    const paymentId = uuidv7();
    await realEnv.DB.prepare(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, reference_norm, recorded_by, recorded_at, verified_by, verified_at)
       VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'INR', 70000, '2026-11-01', 'neft', ?3, ?4, ?5, ?4, ?5)`,
    )
      .bind(paymentId, clientId, `UTRVOID${now}`, owner.id, now - 60_000)
      .run();
    const receiptId = `rct_${paymentId}`;
    const n = String((now % 9_000) + 1).padStart(4, "0");
    await realEnv.DB.prepare(
      `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, subtotal_minor, taxable_minor, total_minor,
         balance_minor, content_sha256, updated_at)
       VALUES (?1, 'receipt', 'issued', ?2, 'INR', 'receipt', '9998', ?3, ?4, ?5, '2026-11-01', 70000, 0, 70000, 0, ?6, ?5)`,
    )
      .bind(receiptId, clientId, Number(n), `TH/RCT/9998/${n}`, now - 30_000, "h".repeat(64))
      .run();
    await realEnv.DB.prepare(
      "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = ?3, withdraw_reason = 'Entered twice' WHERE id = ?1",
    )
      .bind(paymentId, owner.id, now - 20_000)
      .run();
    await realEnv.DB.prepare(
      "UPDATE documents SET status = 'void', voided_at = ?2, void_reason = 'payment_withdrawn', updated_at = updated_at + 1 WHERE id = ?1",
    )
      .bind(receiptId, now - 10_000)
      .run();
    const env = makeEnv();
    expect(await processReceipt(env, { v: 1, kind: "receipt.render", receiptId, hop: 0 })).toBe("skipped");
    expect(logs.some((l) => l.includes("receipt.render_skipped") && l.includes("not_issued"))).toBe(true);
    expect(fakes.email).toEqual([]);
    expect(await processReceipt(env, { v: 1, kind: "receipt.sweep", asOf: now })).toBe("swept");
    expect(JSON.stringify(fakes.pdf)).not.toContain(receiptId);
  });
});

const batchOf = (queue: string, body: unknown) => {
  const acks: string[] = [];
  return {
    acks,
    batch: {
      queue,
      messages: [
        {
          id: "m1",
          body,
          attempts: 1,
          timestamp: new Date(),
          ack: () => acks.push("ack"),
          retry: (o?: { delaySeconds?: number }) => acks.push(`retry:${o?.delaySeconds ?? 0}`),
        },
      ],
      ackAll: () => undefined,
      retryAll: () => undefined,
    } as unknown as MessageBatch<unknown>,
  };
};

describe("receipts on the PDF queue [L3, L34]", () => {
  it("receipt.issue calls BillingJobs.issueReceipt with the payment's id; a malformed body never reaches the RPC", async () => {
    const seen: unknown[] = [];
    const env = makeEnv({
      ADMIN_JOBS: {
        draftCarePlan: async () => ({}),
        issueCareDraft: async () => ({}),
        issueReceipt: async (a: unknown) => {
          seen.push(a);
          return { result: "issued", number: "TH/RCT/2627/0001" };
        },
      },
    } as never);
    const { acks, batch } = batchOf("techaust-local-pdf", {
      v: 1,
      kind: "receipt.issue",
      paymentId: "pay-1",
    });
    await handleQueue(batch, env);
    expect(acks).toEqual(["ack"]);
    expect(seen).toEqual([{ paymentId: "pay-1" }]);
    expect(await processReceipt(env, { v: 1, kind: "receipt.issue", paymentId: "" })).toBe("skipped");
    expect(seen).toHaveLength(1);
  });

  it("receipt.sweep reads D1 in the consumer and queues issues and renders on the PDF queue (none here: nothing is due)", async () => {
    const env = makeEnv();
    expect(await processReceipt(env, { v: 1, kind: "receipt.sweep", asOf: Date.now() })).toBe("swept");
    expect(fakes.pdf).toEqual([]);
  });
});

describe("refunds and settlements on the leads queue [L37, L11]", () => {
  it("refund.check asks GatewayEvents.checkRefund; a retry answer comes back later; recon.fetch queues the next page", async () => {
    const asked: unknown[] = [];
    let check = { result: "retry" };
    const env = makeEnv({
      ADMIN_GATEWAY: {
        processEvent: async () => ({ result: "processed" }),
        checkRefund: async (a: unknown) => {
          asked.push(a);
          return check;
        },
        fetchSettlements: async (a: unknown) => {
          asked.push(a);
          return { result: "stored", next: { skip: 100 } };
        },
      },
    } as never);
    const refundId = uuidv7();
    expect(await processRefundFamily(env, { kind: "refund.check", refundId } as never, 1)).toEqual({
      retry: 60,
    });
    check = { result: "succeeded" };
    expect(await processRefundFamily(env, { kind: "refund.check", refundId } as never, 2)).toBe("ack");
    expect(
      await processRefundFamily(
        env,
        { kind: "recon.fetch", provider: "razorpay", day: "2026-11-02", skip: 0 } as never,
        1,
      ),
    ).toBe("ack");
    expect(asked).toEqual([{ refundId }, { refundId }, { provider: "razorpay", day: "2026-11-02", skip: 0 }]);
    expect(fakes.leads.map((s) => s.body)).toEqual([
      { kind: "recon.fetch", provider: "razorpay", day: "2026-11-02", skip: 100 },
    ]);
    // routed before the lead fall-through: a refund body never becomes a lead
    const { acks, batch } = batchOf("techaust-local-leads", { kind: "refund.check", refundId });
    await handleQueue(batch, env);
    expect(acks).toEqual(["ack"]);
  });

  it("refund.sweep queues one check per idle open refund (none in an empty database); a dead check of an unknown refund only logs", async () => {
    const env = makeEnv();
    expect(await processRefundFamily(env, { kind: "refund.sweep", asOf: Date.now() } as never, 1)).toBe(
      "ack",
    );
    await processRefundDeadLetter(
      { DB: realEnv.DB } as never,
      { kind: "refund.check", refundId: uuidv7() } as never,
    );
    expect(
      await realEnv.DB.prepare("SELECT count(*) AS n FROM review_items WHERE kind = 'refund_stuck'").first<{
        n: number;
      }>(),
    ).toEqual({ n: 0 });
  });

  it("early check 2, finding 2: a refund still pending answers unchanged and is acknowledged; dead checks of one refund open ONE refund_stuck item and one bell", async () => {
    const env = makeEnv({
      ADMIN_GATEWAY: {
        processEvent: async () => ({ result: "processed" }),
        checkRefund: async () => ({ result: "unchanged" }),
      },
    } as never);
    expect(await processRefundFamily(env, { kind: "refund.check", refundId: uuidv7() } as never, 1)).toBe(
      "ack",
    );
    // an open Razorpay refund (L33: a pending payment refunded in full through its gateway), written straight in
    const now = Date.now();
    const owner = await staff("owner");
    const clientId = await mkClient();
    const doc = await mkDoc(clientId, null);
    const checkoutId = `co-dlq-${now}`;
    await realEnv.DB.prepare(
      `INSERT INTO checkout_sessions (id, provider, document_id, client_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at)
       VALUES (?1, 'razorpay', ?2, ?3, ?6, 'staff', 'INR', 50000, 'creating', ?4, ?5, ?5)`,
    )
      .bind(checkoutId, doc.id, clientId, now + 86_400_000, now - 30 * 60_000, owner.id)
      .run();
    await realEnv.DB.prepare(
      "UPDATE checkout_sessions SET status = 'live', provider_link_id = ?2, short_url = 'https://rzp.io/i/x', updated_at = ?3 WHERE id = ?1",
    )
      .bind(checkoutId, `plink_DLQ${now}`, now - 29 * 60_000)
      .run();
    const paymentId = `rzp_pay_DLQ${now}`;
    await realEnv.DB.prepare(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, received_on, mode, reference_norm, recorded_by, recorded_at,
         provider_payment_id, checkout_id, fee_tax_minor, refetched_at)
       VALUES (?1, ?2, 'payment', 'razorpay', 'pending_verification', 'INR', 50000, 0, '2026-10-28', 'upi', ?3, NULL, ?4, ?5, ?6, 0, ?4)`,
    )
      .bind(paymentId, clientId, `PAY-DLQ${now}`, now - 60_000, `pay_DLQ${now}`, checkoutId)
      .run();
    const refundId = uuidv7();
    await realEnv.DB.prepare(
      `INSERT INTO payment_refunds (id, payment_id, client_id, provider, origin, status, paid_to, reason_code, currency, amount_minor, requested_by, requested_at, updated_at)
       VALUES (?1, ?2, ?3, 'razorpay', 'owner', 'requested', 'original', 'duplicate', 'INR', 50000, ?4, ?5, ?5)`,
    )
      .bind(refundId, paymentId, clientId, owner.id, now)
      .run();
    for (let i = 0; i < 3; i++)
      await processRefundDeadLetter({ DB: realEnv.DB } as never, { kind: "refund.check", refundId } as never);
    expect(
      await realEnv.DB.prepare(
        "SELECT count(*) AS n FROM review_items WHERE kind = 'refund_stuck' AND json_extract(facts, '$.refundId') = ?1",
      )
        .bind(refundId)
        .first<{ n: number }>(),
    ).toEqual({ n: 1 });
    const item = await realEnv.DB.prepare(
      "SELECT id FROM review_items WHERE kind = 'refund_stuck' AND json_extract(facts, '$.refundId') = ?1",
    )
      .bind(refundId)
      .first<{ id: string }>();
    expect(
      await realEnv.DB.prepare(
        "SELECT count(*) AS n FROM notifications WHERE entity_type = 'review_item' AND entity_id = ?1 AND user_id = ?2",
      )
        .bind(item?.id, owner.id)
        .first<{ n: number }>(),
    ).toEqual({ n: 1 });
  });
});
