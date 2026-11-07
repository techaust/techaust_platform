// M6–M7 audit, the jobs side of AF1 (run file docs/runs/full-audit-m6-m7.md, lead's triage AU1 and AU21) [ADM-PAY-08, ADM-MAIL-01]: the refund email leaves out
// a suppressed contact and an erased address (`h:` + keyed hash) before anything is queued or counted; the email about a refund that came back
// (`refund.reversed`) goes only for a reversed refund, to the finance contacts, held outside "local" while 07-ZT is unapproved; the queue routes it before the
// generic email path. Invented test data.
import type { EmailMessage } from "@techaust/core";
import { APPROVED_07ZT } from "@techaust/core/copy-zt";
import { uuidv7 } from "@techaust/core/ids";
import { describe, expect, it, vi } from "vitest";
import { erasureHashOf } from "../src/erasure.ts";
import { processGateway } from "../src/gateway.ts";
import {
  processRefundNotify,
  processRefundReversed,
  REFUND_REVERSED_ROW_SQL,
  refundReversedCopyGate,
} from "../src/refund-notify.ts";
import { all, fakes, makeEnv, mkClient, mkContact, mkDoc, run, staff, useFakes } from "./billing-fixtures.ts";

useFakes();

/** 11:00 IST: inside the send window. */
const IN_WINDOW = Date.parse("2026-11-05T05:30:00Z");
const env = () => makeEnv({ ENVIRONMENT: "local" });
const emailsOf = (template: string) =>
  fakes.email.map((s) => s.body as EmailMessage).filter((b) => b?.template === template);

/** A Razorpay payment for an issued invoice and an outside refund of it that succeeded; `reversed`: then came back failed (0082). */
/**
 * A Razorpay payment of ₹500 refunded in full outside the admin. AU33: the payment is confirmed (`payment: "confirmed"`, the default) or, as L33's pending source,
 * rejected by the system once the refund succeeded (`"rejected"`, through the 0070 trigger's one allowed move).
 */
async function refundOf(o: { reversed?: boolean; payment?: "confirmed" | "rejected" } = {}) {
  const now = Date.now();
  const owner = await staff("owner");
  const clientId = await mkClient();
  const doc = await mkDoc(clientId, null);
  const checkoutId = `co-af1-${uuidv7()}`;
  await run(
    `INSERT INTO checkout_sessions (id, provider, document_id, client_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at)
     VALUES (?1, 'razorpay', ?2, ?3, ?6, 'staff', 'INR', 50000, 'creating', ?4, ?5, ?5)`,
    checkoutId,
    doc.id,
    clientId,
    now + 86_400_000,
    now - 30 * 60_000,
    owner.id,
  );
  const paymentId = `rzp_pay_AF1${uuidv7().slice(-12)}`;
  await run(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, received_on, mode, reference_norm, recorded_by, recorded_at,
       provider_payment_id, checkout_id, fee_tax_minor, refetched_at)
     VALUES (?1, ?2, 'payment', 'razorpay', 'pending_verification', 'INR', 50000, 0, '2026-10-28', 'upi', ?3, NULL, ?4, ?5, ?6, 0, ?4)`,
    paymentId,
    clientId,
    `PAY-AF1${uuidv7().slice(-10)}`,
    now - 60_000,
    `pay_AF1${uuidv7().slice(-10)}`,
    checkoutId,
  );
  const confirmed = (o.payment ?? "confirmed") === "confirmed";
  if (confirmed)
    await run(
      "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
      paymentId,
      owner.id,
      now - 30_000,
    );
  const refundId = uuidv7();
  await run(
    `INSERT INTO payment_refunds (id, payment_id, client_id, provider, origin, status, paid_to, reason_code, currency, amount_minor, provider_refund_id,
       requested_by, requested_at, settled_at, settled_on, updated_at)
     VALUES (?1, ?2, ?3, 'razorpay', 'outside', 'succeeded', 'original', 'duplicate', 'INR', 50000, ?4, ?5, ?6, ?6, '2026-11-04', ?6)`,
    refundId,
    paymentId,
    clientId,
    `rfnd_${uuidv7().slice(-12)}`,
    owner.id,
    now,
  );
  if (!confirmed)
    await run(
      `UPDATE payments SET status = 'rejected', verified_at = ?2
       WHERE id = ?1 AND status = 'pending_verification' AND provider <> 'manual'`,
      paymentId,
      now - 30_000,
    );
  if (o.reversed)
    await run(
      "UPDATE payment_refunds SET status = 'failed', failure_code = 'razorpay_failed', reversed_at = ?2, updated_at = ?2 WHERE id = ?1",
      refundId,
      now + 1,
    );
  return { refundId, clientId, doc };
}

describe("AU21 (B4 L2): the refund email never counts or queues a stopped contact", () => {
  it("a suppressed contact (hard bounce) and an erased address (`h:` + keyed hash) are left out; the others get it", async () => {
    const r = await refundOf();
    const fin = await mkContact(r.clientId, { email: `fin${uuidv7().slice(-8)}@example.test` });
    const bounced = await mkContact(r.clientId, { email: `bounced${uuidv7().slice(-8)}@example.test` });
    const erased = await mkContact(r.clientId, { email: `erased${uuidv7().slice(-8)}@example.test` });
    await run(
      "INSERT INTO email_suppressions (email, reason, at) VALUES (lower(?1), 'hard_bounce', 1)",
      bounced.email,
    );
    await run(
      "INSERT INTO email_suppressions (email, reason, at) VALUES (?1, 'erased', 1)",
      `h:${await erasureHashOf(env(), erased.email)}`,
    );
    expect(await processRefundNotify(env(), { kind: "refund.notify", refundId: r.refundId }, IN_WINDOW)).toBe(
      "queued",
    );
    expect(emailsOf("refund.sent").map((m) => m.to)).toEqual([fin.email]);
  });

  it("every finance contact stopped: `none`, nothing queued", async () => {
    const r = await refundOf();
    const only = await mkContact(r.clientId, { email: `only${uuidv7().slice(-8)}@example.test` });
    await run("INSERT INTO email_suppressions (email, reason, at) VALUES (?1, 'complaint', 1)", only.email);
    expect(await processRefundNotify(env(), { kind: "refund.notify", refundId: r.refundId }, IN_WINDOW)).toBe(
      "none",
    );
    expect(fakes.email).toHaveLength(0);
  });
});

describe("AU7 L5, L6, L8 (B1): the hourly gateway sweep", () => {
  /** An open checkout of `provider` for a new issued document, live, made at `createdAt`, expiring at `expiresAt`. */
  async function checkout(provider: "razorpay" | "paypal", createdAt: number, expiresAt: number) {
    const owner = await staff("owner");
    const clientId = await mkClient();
    const doc = await mkDoc(clientId, null);
    const id = uuidv7();
    await run(
      `INSERT INTO checkout_sessions (id, provider, document_id, client_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'staff', ?6, 50000, 'creating', ?7, ?8, ?8)`,
      id,
      provider,
      doc.id,
      clientId,
      owner.id,
      provider === "razorpay" ? "INR" : "USD",
      expiresAt,
      createdAt,
    );
    const link =
      provider === "razorpay"
        ? `plink_AF1${uuidv7().slice(-12).replaceAll("-", "")}`
        : `ORDAF1${uuidv7().slice(-8)}`;
    await run(
      "UPDATE checkout_sessions SET status = 'live', provider_link_id = ?2, short_url = ?3, updated_at = ?4 WHERE id = ?1",
      id,
      link,
      provider === "razorpay"
        ? "https://rzp.io/i/af1"
        : `https://www.sandbox.paypal.com/checkoutnow?token=${link}`,
      createdAt + 1,
    );
    return id;
  }
  /** A LEADS queue that records each `sendBatch`'s size. */
  const batchQueue = () => {
    const sizes: number[] = [];
    const bodies: unknown[] = [];
    return {
      sizes,
      bodies,
      queue: {
        async send(body: unknown) {
          sizes.push(1);
          bodies.push(body);
        },
        async sendBatch(msgs: { body: unknown }[]) {
          sizes.push(msgs.length);
          bodies.push(...msgs.map((m) => m.body));
        },
      },
    };
  };

  it("L5: a Razorpay link live an hour or more and not refreshed in 6 hours is refreshed, at most 10 a run; a young one is not; L8: no sendBatch over 100", async () => {
    const now = Date.now() + 10 * 86_400_000;
    const old: string[] = [];
    for (let i = 0; i < 12; i++)
      old.push(await checkout("razorpay", now - 2 * 3_600_000 - i, now + 86_400_000));
    const young = await checkout("razorpay", now - 10 * 60_000, now + 86_400_000);
    const q = batchQueue();
    await processGateway(
      makeEnv({ LEADS_QUEUE: q.queue as never }),
      { kind: "gateway.sweep", asOf: now } as never,
      1,
      now,
    );
    const refreshed = (q.bodies as { kind: string; checkoutId?: string }[])
      .filter((b) => b.kind === "gateway.refresh")
      .map((b) => b.checkoutId);
    expect(refreshed.filter((id) => old.includes(id as string))).toHaveLength(10);
    expect(refreshed).not.toContain(young);
    expect(Math.max(...q.sizes)).toBeLessThanOrEqual(100);
  });

  it("L6: an unclaimed PayPal checkout past its grace ends with one system audit row", async () => {
    const now = Date.now() + 20 * 86_400_000;
    const id = await checkout("paypal", now - 5 * 3_600_000, now - 31 * 60_000);
    for (let i = 0; i < 5; i++)
      await processGateway(makeEnv(), { kind: "gateway.sweep", asOf: now } as never, 1, now);
    expect(
      (await all<{ status: string }>("SELECT status FROM checkout_sessions WHERE id = ?1", id))[0]?.status,
    ).toBe("expired");
    const audits = await all<{ actor_type: string; summary: string }>(
      "SELECT actor_type, summary FROM audit_log WHERE action = 'payment.link_end' AND entity_id = ?1",
      id,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor_type).toBe("system");
    expect(JSON.parse(audits[0]?.summary ?? "{}")).toMatchObject({ checkoutId: id, why: "paypal_unclaimed" });
  });
});

describe("AU1: the email about a refund that came back (`refund.reversed`, 07-ZT behind its gate)", () => {
  it("a reversed refund emails the finance contacts once by its own entity, with the invoice's portal link", async () => {
    const r = await refundOf({ reversed: true });
    const fin = await mkContact(r.clientId, { email: `rev${uuidv7().slice(-8)}@example.test` });
    await mkContact(r.clientId, { finance: false });
    expect(
      await processRefundReversed(env(), { kind: "refund.reversed", refundId: r.refundId }, IN_WINDOW),
    ).toBe("queued");
    const mails = emailsOf("refund.reversed");
    expect(mails.map((m) => m.to)).toEqual([fin.email]);
    expect(mails[0]?.entity).toEqual({ type: "refund_reversal", id: r.refundId });
    expect(mails[0]?.data).toMatchObject({
      amount: "₹500.00",
      document_number: r.doc.numberDisplay,
      url: `https://portal.example/invoices/${r.doc.id}`,
    });
  });

  it("a refund that still stands (succeeded), an unknown id or a bad body: nothing", async () => {
    const r = await refundOf();
    await mkContact(r.clientId);
    expect(
      await processRefundReversed(env(), { kind: "refund.reversed", refundId: r.refundId }, IN_WINDOW),
    ).toBe("none");
    expect(
      await processRefundReversed(env(), { kind: "refund.reversed", refundId: uuidv7() }, IN_WINDOW),
    ).toBe("none");
    expect(await processRefundReversed(env(), { kind: "refund.reversed", refundId: "" }, IN_WINDOW)).toBe(
      "invalid",
    );
    expect(emailsOf("refund.reversed")).toHaveLength(0);
  });

  it("held outside local while 07-ZT is unapproved; outside the window the same message comes back delayed", async () => {
    const r = await refundOf({ reversed: true });
    await mkContact(r.clientId);
    expect(APPROVED_07ZT).toBe(false);
    expect(
      await processRefundReversed(
        makeEnv({ ENVIRONMENT: "staging" }),
        { kind: "refund.reversed", refundId: r.refundId },
        IN_WINDOW,
      ),
    ).toBe("held");
    expect(fakes.email).toHaveLength(0);
    const gate = vi.spyOn(refundReversedCopyGate, "approved").mockReturnValue(true);
    const night = Date.parse("2026-11-05T16:00:00Z"); // 21:30 IST
    expect(
      await processRefundReversed(
        makeEnv({ ENVIRONMENT: "staging" }),
        { kind: "refund.reversed", refundId: r.refundId },
        night,
      ),
    ).toBe("delayed");
    expect(fakes.email.at(-1)?.body).toEqual({ kind: "refund.reversed", refundId: r.refundId });
    gate.mockRestore();
  });

  it("the row read holds the reversal rule in SQL (failed with reversed_at, the payment confirmed), not the succeeded one", () => {
    expect(REFUND_REVERSED_ROW_SQL).toContain(
      "r.status = 'failed' AND r.reversed_at IS NOT NULL AND p.status = 'confirmed'",
    );
    expect(REFUND_REVERSED_ROW_SQL).not.toContain("r.status = 'succeeded'");
  });

  it("AU33 (M1): a reversed refund whose payment was rejected (L33's pending source) emails nobody: it is no credit of the client's", async () => {
    const r = await refundOf({ reversed: true, payment: "rejected" });
    await mkContact(r.clientId);
    expect(
      await processRefundReversed(env(), { kind: "refund.reversed", refundId: r.refundId }, IN_WINDOW),
    ).toBe("none");
    expect(emailsOf("refund.reversed")).toHaveLength(0);
  });
});
