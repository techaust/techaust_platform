// M6.5 in the jobs Worker [ADM-PAY-08, -09, -10, JOB-HOOK-01, JOB-PDF-01; run file D, L3, L34, L37]: the receipt messages on the PDF queue (`receipt.issue` to
// BillingJobs over RPC, the sweep), the refund family on the leads queue (`refund.check` and `recon.fetch` over RPC, the next page, the refund sweep), and a dead
// `refund.check` that becomes a `refund_stuck` item. The RPC entrypoints are fakes; no gateway is reached. Invented test data.
import { env as realEnv } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { handleQueue } from "../src/queue.ts";
import { processReceipt } from "../src/receipts.ts";
import { processRefundDeadLetter, processRefundFamily } from "../src/refunds.ts";
import { fakes, makeEnv, useFakes } from "./billing-fixtures.ts";

useFakes();

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
});
