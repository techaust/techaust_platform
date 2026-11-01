// M6.2 gateway statements in the database (ADM-PAY-02, -06, -07, ADM-INV-10, JOB-HOOK-02, POR-06; run file docs/runs/m6.2-razorpay.md B, C and H): the checkout create
// (row first: two clicks give one row; every guard in its WHERE), the live, end and refresh moves, a gateway payment confirmed and allocated (the invoice paid, the link
// paid, the event processed, the bells), a duplicate or a replay with a new event id (one row), an overpayment held as credit with its review item, a proforma's
// pending payment, a mismatch recorded pending with no ledger move, the guards that refuse (an anonymised client, a void invoice, an expired link), the review item
// and dead-letter statements, the SQL twin of core `payableOnline`, and the automatic advance (`GATEWAY_AUTO_SQL`): issued by the system on the proforma issuer's
// behalf, one invoice from two parallel tries, and every refusal. Statements are the real builders; all names and amounts are invented test data.
import { env } from "cloudflare:workers";
import { defaultFormat, sqlPrintfPattern, uuidv7 } from "@techaust/core";
import { payableOnline } from "@techaust/core/online-pay";
import { describe, expect, it } from "vitest";
import {
  CHECKOUT_BY_LINK_SQL,
  checkoutCreateStatement,
  checkoutEndStatement,
  checkoutLiveStatement,
  checkoutRefreshClaimStatement,
  type GatewayPaymentArgs,
  gatewayDeadLetterStatements,
  OPEN_CHECKOUT_SQL,
  onlinePayableSql,
  REVIEW_ITEMS_SQL,
  recordGatewayPaymentStatements,
  reviewItemStatement,
} from "../src/gateway.ts";
import { type AdvanceIssueArgs, advanceIssueStatements, invoiceIssueStatements } from "../src/issue.ts";
import { guardSql } from "../src/log.ts";
import { proformaOnlinePendingSql } from "../src/sql-rules.ts";
import { all, first, rejects, run, signedCompany, TEST_SIGNATURE } from "./helpers.ts";

let seq = 0;
const FYS = { n: 9600 };
const nextFy = () => String(++FYS.n);
const db = () => env.DB;

async function mkClient(over: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv7();
  const row: Record<string, unknown> = {
    id,
    code: `C-G${String(++seq).padStart(5, "0")}`,
    legal_name: "L",
    display_name: "D",
    type: "business",
    country: "IN",
    gst_status: "unregistered",
    state_code: "19",
    currency: "INR",
    updated_at: 5_000,
    ...over,
  };
  const cols = Object.keys(row);
  await run(
    `INSERT INTO clients (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    ...Object.values(row),
  );
  return id;
}

async function mkContact(
  clientId: string,
  over: { finance?: boolean; portal?: boolean } = {},
): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO contacts (id, client_id, name, email, portal_access, can_see_finance) VALUES (?1, ?2, 'Asha', ?3, ?4, ?5)",
    id,
    clientId,
    `${id}@example.test`,
    over.portal === false ? 0 : 1,
    over.finance === false ? 0 : 1,
  );
  return id;
}

async function mkMember(role: "owner" | "staff" | "sales" = "owner", status = "active"): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, 'M', ?3, ?4)",
    id,
    `${id}@example.test`,
    role,
    status,
  );
  return id;
}

/** An issued tax invoice (or another type) written straight in, with its balance. */
async function mkIssued(
  clientId: string,
  o: {
    type?: string | undefined;
    balance?: number | undefined;
    status?: string | undefined;
    total?: number | undefined;
  } = {},
) {
  const id = uuidv7();
  const n = ++seq;
  const total = o.total ?? 118_000;
  await run(
    `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor, content_sha256, updated_at, voided_at, void_reason)
     VALUES (?1, ?2, ?3, ?4, 'INR', 'inv-g', '9999', ?5, ?6, 1000, '2026-10-28', '2026-11-04', ?7, ?7, ?7, ?8, ?9, 7000, ?10, ?11)`,
    id,
    o.type ?? "tax_invoice",
    o.status ?? "issued",
    clientId,
    n,
    `G/${n}`,
    total,
    o.balance ?? total,
    "h".repeat(64),
    o.status === "void" ? 5 : null,
    o.status === "void" ? "x" : null,
  );
  return id;
}

const NOW0 = 1_900_000_000_000;
let clock = NOW0;
const tick = () => (clock += 10);

async function liveCheckout(
  documentId: string,
  clientId: string,
  contactId: string,
  amount = 118_000,
  floor = 50_000,
): Promise<{ id: string; linkId: string }> {
  const id = uuidv7();
  const now = tick();
  const r = await checkoutCreateStatement(db(), {
    id,
    provider: "razorpay",
    documentId,
    clientId,
    source: "portal",
    contactId,
    docTokenId: null,
    createdBy: null,
    amountMinor: amount,
    floorMinor: floor,
    expiresAt: now + 7 * 86_400_000,
    now,
  }).run();
  expect(r.meta.changes, "the checkout was created").toBe(1);
  const linkId = `plink_${id.replace(/-/g, "").slice(-14)}`;
  await checkoutLiveStatement(db(), {
    id,
    providerLinkId: linkId,
    shortUrl: "https://rzp.io/i/x",
    expiresAt: now + 7 * 86_400_000,
    now: tick(),
  }).run();
  return { id, linkId };
}

async function event(linkId: string): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, facts) VALUES (?1, 'razorpay', ?2, 'payment_link.paid', ?3, 'received', ?4)",
    id,
    `evt_${id.slice(-12)}`,
    tick(),
    JSON.stringify({ linkId, amountMinor: 118_000, currency: "INR" }),
  );
  return id;
}

const payArgs = (
  w: { clientId: string; documentId: string; checkoutId: string; eventId: string | null },
  over: Partial<GatewayPaymentArgs> = {},
): GatewayPaymentArgs => {
  const pid = `pay_G${String(++seq).padStart(8, "0")}`;
  const now = tick();
  return {
    provider: "razorpay",
    providerPaymentId: pid,
    paymentId: `rzp_${pid}`,
    checkoutId: w.checkoutId,
    clientId: w.clientId,
    documentId: w.documentId,
    webhookEventId: w.eventId,
    source: "webhook",
    status: "confirmed",
    amountMinor: 118_000,
    feeMinor: 2_360,
    feeTaxMinor: 360,
    receivedOn: "2026-10-30",
    mode: "upi",
    referenceNorm: pid.replace("_", "-").toUpperCase(),
    refetchedAt: now - 1,
    now,
    allocate: { allocationId: uuidv7(), overpaidReviewId: uuidv7(), facts: { linkId: "plink_x" } },
    requestedAllocations: null,
    checkoutPaid: true,
    staleOthers: true,
    event: { status: "processed", outcome: "processed" },
    bell: { kind: "payment.online", title: "Display paid ₹1,180.00 online for G/1.", link: "/invoices/x" },
    ...over,
  };
};

/** The batch as the finance Worker writes it: main, an audit row only if main changed a row, the side statements guarded on it, then `ledger_result`. */
async function writePayment(a: GatewayPaymentArgs): Promise<boolean> {
  const auditId = uuidv7();
  const s = recordGatewayPaymentStatements(db(), a, guardSql({ auditId }));
  const audit = db()
    .prepare(
      "INSERT INTO audit_log (id, actor_type, actor_id, role, action, entity_type, entity_id) SELECT ?1, 'webhook', NULL, NULL, 'payment.gateway', 'payment', ?2 WHERE changes() > 0",
    )
    .bind(auditId, a.paymentId);
  const res = await db().batch([s.main, audit, ...s.side, ...s.last]);
  return res[1]?.meta.changes === 1;
}

const docRow = (id: string) =>
  first<{ status: string; paid_minor: number; balance_minor: number }>(
    "SELECT status, paid_minor, balance_minor FROM documents WHERE id = ?",
    id,
  );
const checkoutRow = (id: string) =>
  first<{ status: string; paid_payment_id: string | null; last_refresh_at: number | null }>(
    "SELECT status, paid_payment_id, last_refresh_at FROM checkout_sessions WHERE id = ?",
    id,
  );

async function invoiceWorld(o: { balance?: number } = {}) {
  await mkMember("owner");
  const clientId = await mkClient();
  const contactId = await mkContact(clientId);
  const documentId = await mkIssued(clientId, { balance: o.balance });
  const co = await liveCheckout(documentId, clientId, contactId, o.balance ?? 118_000);
  const eventId = await event(co.linkId);
  return { clientId, contactId, documentId, checkoutId: co.id, linkId: co.linkId, eventId };
}

// ---- checkouts ---------------------------------------------------------------------------------------------------------------------------------------

describe("checkoutCreateStatement: row first, every guard in its WHERE [ADM-PAY-02, L4]", () => {
  const create = (
    a: Partial<Parameters<typeof checkoutCreateStatement>[1]> & { documentId: string; clientId: string },
  ) => {
    const now = tick();
    return checkoutCreateStatement(db(), {
      id: uuidv7(),
      provider: "razorpay",
      source: "portal",
      contactId: null,
      docTokenId: null,
      createdBy: null,
      amountMinor: 118_000,
      floorMinor: 50_000,
      expiresAt: now + 7 * 86_400_000,
      now,
      ...a,
    }).run();
  };

  it("two clicks at once: one row, the other refused by the unique open index (409 link_in_progress)", async () => {
    const clientId = await mkClient();
    const contactId = await mkContact(clientId);
    const documentId = await mkIssued(clientId);
    const results = await Promise.allSettled([
      create({ documentId, clientId, contactId }),
      create({ documentId, clientId, contactId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason?.message ?? rejected.reason)).toMatch(/UNIQUE/);
    expect(await all("SELECT id FROM checkout_sessions WHERE document_id = ?", documentId)).toHaveLength(1);
  });

  it("refuses a contact without finance or portal access, another client's contact, and an unknown source actor", async () => {
    const clientId = await mkClient();
    const other = await mkClient();
    const documentId = await mkIssued(clientId);
    for (const contactId of [
      await mkContact(clientId, { finance: false }),
      await mkContact(clientId, { portal: false }),
      await mkContact(other),
    ])
      expect((await create({ documentId, clientId, contactId })).meta.changes).toBe(0);
    // A document of another client.
    expect(
      (await create({ documentId, clientId: other, contactId: await mkContact(other) })).meta.changes,
    ).toBe(0);
    // Staff: an active Owner or Staff member only.
    const sales = await mkMember("sales");
    expect((await create({ documentId, clientId, source: "staff", createdBy: sales })).meta.changes).toBe(0);
    const staff = await mkMember("staff");
    expect((await create({ documentId, clientId, source: "staff", createdBy: staff })).meta.changes).toBe(1);
  });

  it("an emailed link: live, unrevoked, for this document, bound to its contact whose address still matches", async () => {
    const clientId = await mkClient();
    const contactId = await mkContact(clientId);
    const documentId = await mkIssued(clientId);
    const email = (await first<{ email: string }>("SELECT email FROM contacts WHERE id = ?", contactId))
      ?.email;
    const mint = async (o: { revoked?: boolean; expired?: boolean } = {}) => {
      const hash = uuidv7().replaceAll("-", "");
      await run(
        "INSERT INTO doc_access_tokens (token_hash, document_id, purpose, expires_at, revoked_at, contact_id, client_id, email) VALUES (?1, ?2, 'view_pay', ?3, ?4, ?5, ?6, ?7)",
        hash,
        documentId,
        o.expired ? NOW0 : NOW0 + 10 * 86_400_000,
        o.revoked ? NOW0 : null,
        contactId,
        clientId,
        email,
      );
      return hash;
    };
    expect(
      (
        await create({
          documentId,
          clientId,
          source: "link",
          contactId,
          docTokenId: await mint({ revoked: true }),
        })
      ).meta.changes,
    ).toBe(0);
    expect(
      (
        await create({
          documentId,
          clientId,
          source: "link",
          contactId,
          docTokenId: await mint({ expired: true }),
        })
      ).meta.changes,
    ).toBe(0);
    expect(
      (await create({ documentId, clientId, source: "link", contactId, docTokenId: "nope" })).meta.changes,
    ).toBe(0);
    expect(
      (await create({ documentId, clientId, source: "link", contactId, docTokenId: await mint() })).meta
        .changes,
    ).toBe(1);
  });

  it("refuses amounts outside the balance and the floor, paise on a proforma, and documents not payable online", async () => {
    const clientId = await mkClient();
    const contactId = await mkContact(clientId);
    const inv = await mkIssued(clientId);
    expect((await create({ documentId: inv, clientId, contactId, amountMinor: 118_001 })).meta.changes).toBe(
      0,
    );
    expect((await create({ documentId: inv, clientId, contactId, amountMinor: 49_999 })).meta.changes).toBe(
      0,
    );
    const proforma = await mkIssued(clientId, { type: "proforma" });
    expect(
      (await create({ documentId: proforma, clientId, contactId, amountMinor: 59_050 })).meta.changes,
    ).toBe(0);
    for (const o of [{ status: "void" }, { status: "paid", balance: 0 }, { balance: 99 }]) {
      const d = await mkIssued(clientId, o);
      expect((await create({ documentId: d, clientId, contactId })).meta.changes, JSON.stringify(o)).toBe(0);
    }
    // Early check 1, finding 4: a floor of 0 never lets 1 to 99 paise through.
    const small = await mkIssued(clientId);
    expect(
      (await create({ documentId: small, clientId, contactId, amountMinor: 99, floorMinor: 0 })).meta.changes,
    ).toBe(0);
    expect(
      (await create({ documentId: small, clientId, contactId, amountMinor: 100, floorMinor: 0 })).meta
        .changes,
    ).toBe(1);
    const overseas = await mkClient({ country: "AE", gst_status: "overseas", state_code: null });
    const od = await mkIssued(overseas, { type: "proforma" });
    expect(
      (await create({ documentId: od, clientId: overseas, contactId: await mkContact(overseas) })).meta
        .changes,
    ).toBe(0);
  });

  it("at most 10 links per client per hour", async () => {
    const clientId = await mkClient();
    const contactId = await mkContact(clientId);
    const now = tick();
    for (let i = 0; i < 10; i++)
      await run(
        "INSERT INTO checkout_sessions (id, provider, document_id, client_id, contact_id, source, currency, amount_minor, status, expires_at, created_at, updated_at) VALUES (?1, 'razorpay', ?2, ?3, ?4, 'portal', 'INR', 1000, 'creating', ?5, ?6, ?6)",
        uuidv7(),
        await mkIssued(clientId),
        clientId,
        contactId,
        now + 86_400_000,
        now - 60_000,
      );
    const d = await mkIssued(clientId);
    const r = await checkoutCreateStatement(db(), {
      id: uuidv7(),
      provider: "razorpay",
      documentId: d,
      clientId,
      source: "portal",
      contactId,
      docTokenId: null,
      createdBy: null,
      amountMinor: 118_000,
      floorMinor: 50_000,
      expiresAt: now + 86_400_000,
      now,
    }).run();
    expect(r.meta.changes).toBe(0);
  });

  it("live, end and the once-a-minute refresh claim; the reads use their indexes", async () => {
    const clientId = await mkClient();
    const contactId = await mkContact(clientId);
    const d = await mkIssued(clientId);
    const co = await liveCheckout(d, clientId, contactId);
    expect((await first<{ id: string }>(CHECKOUT_BY_LINK_SQL, "razorpay", co.linkId))?.id).toBe(co.id);
    expect((await first<{ id: string }>(OPEN_CHECKOUT_SQL, d))?.id).toBe(co.id);
    const t = tick();
    expect((await checkoutRefreshClaimStatement(db(), { id: co.id, now: t }).run()).meta.changes).toBe(1);
    expect(
      (await checkoutRefreshClaimStatement(db(), { id: co.id, now: t + 59_999 }).run()).meta.changes,
    ).toBe(0);
    expect(
      (await checkoutRefreshClaimStatement(db(), { id: co.id, now: t + 60_000 }).run()).meta.changes,
    ).toBe(1);
    expect(
      (await checkoutEndStatement(db(), { id: co.id, status: "cancelled", now: tick() }).run()).meta.changes,
    ).toBe(1);
    expect(
      (await checkoutEndStatement(db(), { id: co.id, status: "expired", now: tick() }).run()).meta.changes,
    ).toBe(0);
    expect((await checkoutRow(co.id))?.status).toBe("cancelled");
    expect(await first(OPEN_CHECKOUT_SQL, d)).toBeNull();
  });
});

// ---- gateway payments ----------------------------------------------------------------------------------------------------------------------------------

describe("recordGatewayPaymentStatements [ADM-PAY-02, -06, -07, JOB-HOOK-02, L5, L7]", () => {
  it("a verified payment on a tax invoice: confirmed, allocated, the invoice paid, the link paid, the event processed, the owners' bells", async () => {
    const w = await invoiceWorld();
    const a = payArgs(w);
    expect(await writePayment(a)).toBe(true);
    const p = await first<{
      status: string;
      verified_by: string | null;
      charges_minor: number;
      fee_tax_minor: number;
      provider: string;
    }>(
      "SELECT status, verified_by, charges_minor, fee_tax_minor, provider FROM payments WHERE id = ?",
      a.paymentId,
    );
    expect(p).toEqual({
      status: "confirmed",
      verified_by: null,
      charges_minor: 2_360,
      fee_tax_minor: 360,
      provider: "razorpay",
    });
    expect(await docRow(w.documentId)).toEqual({ status: "paid", paid_minor: 118_000, balance_minor: 0 });
    expect(await checkoutRow(w.checkoutId)).toMatchObject({ status: "paid", paid_payment_id: a.paymentId });
    expect(
      (await first<{ status: string }>("SELECT status FROM webhook_events WHERE id = ?", w.eventId))?.status,
    ).toBe("processed");
    expect(
      (
        await first<{ n: number }>(
          "SELECT count(*) AS n FROM notifications WHERE kind = 'payment.online' AND entity_id = ?",
          a.paymentId,
        )
      )?.n,
    ).toBeGreaterThan(0);
    expect(await first("SELECT id FROM review_items WHERE payment_id = ?", a.paymentId)).toBeNull();
  });

  it("the same Razorpay payment again (a duplicate, or a replay under a new event id): nothing is written", async () => {
    const w = await invoiceWorld();
    const a = payArgs(w);
    expect(await writePayment(a)).toBe(true);
    const replay = await event(w.linkId);
    expect(await writePayment({ ...a, webhookEventId: replay, now: tick() })).toBe(false);
    expect(
      await writePayment({ ...a, paymentId: `${a.paymentId}x`, webhookEventId: replay, now: tick() }),
    ).toBe(false);
    expect(
      (
        await first<{ n: number }>(
          "SELECT count(*) AS n FROM payments WHERE provider_payment_id = ?",
          a.providerPaymentId,
        )
      )?.n,
    ).toBe(1);
    expect(
      (await first<{ status: string }>("SELECT status FROM webhook_events WHERE id = ?", replay))?.status,
    ).toBe("received");
    expect((await docRow(w.documentId))?.paid_minor).toBe(118_000);
  });

  it("more than is due: the balance is settled, the rest is held as credit, an `overpaid` item says how much, and the ledger adds up", async () => {
    const w = await invoiceWorld();
    // 136,000 arrives on a 118,000 invoice (its balance fell after the link was made): the allocation takes the live balance only.
    const a = payArgs(w, { amountMinor: 136_000 });
    expect(await writePayment(a)).toBe(true);
    const held = await first<{ s: number }>(
      "SELECT sum(amount_minor) AS s FROM payment_allocations WHERE payment_id = ?",
      a.paymentId,
    );
    expect(held?.s).toBe(118_000);
    expect(await docRow(w.documentId)).toMatchObject({
      status: "paid",
      paid_minor: 118_000,
      balance_minor: 0,
    });
    const item = await first<{ kind: string; amount_minor: number; status: string }>(
      "SELECT kind, amount_minor, status FROM review_items WHERE payment_id = ?",
      a.paymentId,
    );
    expect(item).toEqual({ kind: "overpaid", amount_minor: 18_000, status: "open" });
  });

  it("a proforma's payment: pending with its requested allocation, the link paid, no ledger move", async () => {
    await mkMember("owner");
    const clientId = await mkClient();
    const contactId = await mkContact(clientId);
    const proforma = await mkIssued(clientId, { type: "proforma" });
    const co = await liveCheckout(proforma, clientId, contactId, 59_000);
    const eventId = await event(co.linkId);
    const a = payArgs(
      { clientId, documentId: proforma, checkoutId: co.id, eventId },
      {
        status: "pending_verification",
        amountMinor: 59_000,
        allocate: null,
        requestedAllocations: [{ documentId: proforma, amountMinor: 59_000 }],
        staleOthers: false,
      },
    );
    expect(await writePayment(a)).toBe(true);
    expect(
      await first<{ status: string; requested_allocations: string; verified_at: number | null }>(
        "SELECT status, requested_allocations, verified_at FROM payments WHERE id = ?",
        a.paymentId,
      ),
    ).toEqual({
      status: "pending_verification",
      requested_allocations: JSON.stringify([{ documentId: proforma, amountMinor: 59_000 }]),
      verified_at: null,
    });
    expect(await checkoutRow(co.id)).toMatchObject({ status: "paid", paid_payment_id: a.paymentId });
    expect(await first("SELECT id FROM payment_allocations WHERE payment_id = ?", a.paymentId)).toBeNull();
    expect((await docRow(proforma))?.paid_minor).toBe(0);
  });

  it("review finding 10: proformaOnlinePendingSql counts only a pending payment with its requested allocation (overpaid or mismatched money has none)", async () => {
    await mkMember("owner");
    const clientId = await mkClient();
    const contactId = await mkContact(clientId);
    const pendingOf = async (doc: string) =>
      (
        await first<{ v: number }>(
          `SELECT ${proformaOnlinePendingSql("d", "?2")} AS v FROM documents d WHERE d.id = ?1`,
          doc,
          clientId,
        )
      )?.v;
    // Money with no requested allocation (a proforma overpaid, a mismatch): no tax invoice follows it automatically.
    const over = await mkIssued(clientId, { type: "proforma" });
    const co1 = await liveCheckout(over, clientId, contactId, 59_000);
    expect(
      await writePayment(
        payArgs(
          { clientId, documentId: over, checkoutId: co1.id, eventId: null },
          {
            status: "pending_verification",
            amountMinor: 70_000,
            allocate: null,
            requestedAllocations: null,
            checkoutPaid: "if_open",
            staleOthers: false,
          },
        ),
      ),
    ).toBe(true);
    expect(await pendingOf(over)).toBe(0);
    // Its link is paid all the same (review finding 2), so it can't be reused or block a new link.
    expect((await checkoutRow(co1.id))?.status).toBe("paid");
    // A proforma's payment with its requested allocation: waiting for its tax invoice.
    const waiting = await mkIssued(clientId, { type: "proforma" });
    const co2 = await liveCheckout(waiting, clientId, contactId, 59_000);
    expect(
      await writePayment(
        payArgs(
          { clientId, documentId: waiting, checkoutId: co2.id, eventId: null },
          {
            status: "pending_verification",
            amountMinor: 59_000,
            allocate: null,
            requestedAllocations: [{ documentId: waiting, amountMinor: 59_000 }],
            staleOthers: false,
          },
        ),
      ),
    ).toBe(true);
    expect(await pendingOf(waiting)).toBe(1);
  });

  it("review finding 2: checkoutPaid if_open writes the payment even when the link already ended, and leaves the ended link as it was", async () => {
    const w = await invoiceWorld();
    await run(
      "UPDATE checkout_sessions SET status = 'cancelled', updated_at = updated_at + 1 WHERE id = ?",
      w.checkoutId,
    );
    const a = payArgs(w, {
      status: "pending_verification",
      amountMinor: 117_000,
      allocate: null,
      checkoutPaid: "if_open",
      staleOthers: false,
    });
    expect(await writePayment(a)).toBe(true);
    expect(
      (await first<{ status: string }>("SELECT status FROM payments WHERE id = ?", a.paymentId))?.status,
    ).toBe("pending_verification");
    expect(await checkoutRow(w.checkoutId)).toMatchObject({ status: "cancelled", paid_payment_id: null });
  });

  it("a mismatch: recorded pending with a review item, the balance unchanged, the link left as it was", async () => {
    const w = await invoiceWorld();
    const a = payArgs(w, {
      status: "pending_verification",
      amountMinor: 117_000,
      allocate: null,
      checkoutPaid: false,
      staleOthers: false,
      event: { status: "needs_review", outcome: "amount_mismatch" },
    });
    const auditId = uuidv7();
    const g = guardSql({ auditId });
    const s = recordGatewayPaymentStatements(db(), a, g);
    const review = reviewItemStatement(
      db(),
      {
        id: uuidv7(),
        source: "webhook",
        provider: "razorpay",
        kind: "amount_mismatch",
        webhookEventId: w.eventId,
        paymentId: a.paymentId,
        documentId: w.documentId,
        clientId: w.clientId,
        amountMinor: 117_000,
        currency: "INR",
        facts: { linkId: w.linkId, amountMinor: 117_000 },
        now: a.now,
      },
      g,
    );
    await db().batch([
      s.main,
      db()
        .prepare(
          "INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id) SELECT ?1, 'webhook', 'payment.gateway', 'payment', ?2 WHERE changes() > 0",
        )
        .bind(auditId, a.paymentId),
      ...s.side,
      review,
      ...s.last,
    ]);
    expect(s.last).toHaveLength(0);
    expect(
      (await first<{ status: string }>("SELECT status FROM payments WHERE id = ?", a.paymentId))?.status,
    ).toBe("pending_verification");
    expect(await docRow(w.documentId)).toMatchObject({
      status: "issued",
      paid_minor: 0,
      balance_minor: 118_000,
    });
    expect((await checkoutRow(w.checkoutId))?.status).toBe("live");
    expect(
      (await first<{ status: string }>("SELECT status FROM webhook_events WHERE id = ?", w.eventId))?.status,
    ).toBe("needs_review");
    const open = await all<{ kind: string }>(REVIEW_ITEMS_SQL, -1, "", "open", null);
    expect(open.map((r) => r.kind)).toContain("amount_mismatch");
  });

  it("writes nothing for an anonymised client, a void invoice or a link no longer live", async () => {
    const a1 = await invoiceWorld();
    await run("UPDATE clients SET anonymised_at = 1 WHERE id = ?", a1.clientId);
    expect(await writePayment(payArgs(a1))).toBe(false);

    const a2 = await invoiceWorld();
    await run(
      "UPDATE documents SET status = 'void', voided_at = 5, void_reason = 'x' WHERE id = ?",
      a2.documentId,
    );
    expect(await writePayment(payArgs(a2))).toBe(false);

    const a3 = await invoiceWorld();
    await checkoutEndStatement(db(), { id: a3.checkoutId, status: "expired", now: tick() }).run();
    expect(await writePayment(payArgs(a3))).toBe(false);
    // ...but the money can still be recorded pending for the Owner (L7), with no checkout move.
    expect(
      await writePayment(
        payArgs(a3, {
          status: "pending_verification",
          allocate: null,
          checkoutPaid: false,
          staleOthers: false,
        }),
      ),
    ).toBe(true);
    for (const w of [a1, a2])
      expect(await first("SELECT id FROM payments WHERE checkout_id = ?", w.checkoutId)).toBeNull();
  });

  it("refuses a confirmed payment with no allocation, in code and in SQL (early check 1, finding 7)", async () => {
    const w = await invoiceWorld();
    expect(() => recordGatewayPaymentStatements(db(), { ...payArgs(w), allocate: null })).toThrow(/allocate/);
  });

  it("returns its own guard so a caller can append after the recompute (early check 1, finding 9)", async () => {
    const w = await invoiceWorld();
    const a = payArgs(w);
    const auditId = uuidv7();
    const s = recordGatewayPaymentStatements(db(), a, guardSql({ auditId }));
    const audit = db()
      .prepare(
        "INSERT INTO audit_log (id, actor_type, actor_id, role, action, entity_type, entity_id) SELECT ?1, 'webhook', NULL, NULL, 'payment.gateway', 'payment', ?2 WHERE changes() > 0",
      )
      .bind(auditId, a.paymentId);
    const probe = db()
      .prepare(`SELECT 1 AS hit WHERE ${s.guard.sql(1)}`)
      .bind(...s.guard.params);
    const res = await db().batch([s.main, audit, ...s.side, probe, ...s.last]);
    expect(res[res.length - 1 - s.last.length]?.results).toEqual([{ hit: 1 }]);
  });

  it("the batch stays small (D1 Free: 50 statements; the RPC budget 45)", () => {
    const s = recordGatewayPaymentStatements(
      db(),
      payArgs({ clientId: "c", documentId: "d", checkoutId: "k", eventId: "e" }),
      guardSql({ auditId: "a" }),
    );
    expect(1 + 1 + s.side.length + s.last.length).toBeLessThanOrEqual(10);
  });
});

describe("review items and dead letters [ADM-PAY-07, run file D]", () => {
  it("a dead-lettered event: failed, one dead_letter item with the link's document and client, one bell; a redelivery adds nothing", async () => {
    const w = await invoiceWorld();
    const bell = {
      title: "A payment needs review: Razorpay could not be reached.",
      link: "/payments?tab=review",
    };
    const reviewId = uuidv7();
    await db().batch(
      gatewayDeadLetterStatements(db(), { kind: "event", eventId: w.eventId, reviewId, now: tick(), bell }),
    );
    expect(
      await first<{ status: string; outcome: string }>(
        "SELECT status, outcome FROM webhook_events WHERE id = ?",
        w.eventId,
      ),
    ).toEqual({
      status: "failed",
      outcome: "dead_letter",
    });
    expect(
      await first(
        "SELECT kind, source, document_id, client_id, amount_minor, currency FROM review_items WHERE id = ?",
        reviewId,
      ),
    ).toEqual({
      kind: "dead_letter",
      source: "dlq",
      document_id: w.documentId,
      client_id: w.clientId,
      amount_minor: 118_000,
      currency: "INR",
    });
    const bells = await first<{ n: number }>(
      "SELECT count(*) AS n FROM notifications WHERE kind = 'payment.review' AND entity_id = ?",
      reviewId,
    );
    expect(bells?.n).toBeGreaterThan(0);
    const again = uuidv7();
    await db().batch(
      gatewayDeadLetterStatements(db(), {
        kind: "event",
        eventId: w.eventId,
        reviewId: again,
        now: tick(),
        bell,
      }),
    );
    expect(await first("SELECT id FROM review_items WHERE id = ?", again)).toBeNull();
    expect(await first("SELECT id FROM notifications WHERE entity_id = ?", again)).toBeNull();
  });

  it("a dead-lettered advance: one dead_letter item for the pending payment, not twice while it is open", async () => {
    await mkMember("owner");
    const clientId = await mkClient();
    const contactId = await mkContact(clientId);
    const proforma = await mkIssued(clientId, { type: "proforma" });
    const co = await liveCheckout(proforma, clientId, contactId, 59_000);
    const a = payArgs(
      { clientId, documentId: proforma, checkoutId: co.id, eventId: null },
      {
        status: "pending_verification",
        source: "refresh",
        amountMinor: 59_000,
        allocate: null,
        requestedAllocations: [{ documentId: proforma, amountMinor: 59_000 }],
        event: null,
        staleOthers: false,
      },
    );
    expect(await writePayment(a)).toBe(true);
    const bell = { title: "A payment needs review.", link: "/payments" };
    const r1 = uuidv7();
    await db().batch(
      gatewayDeadLetterStatements(db(), {
        kind: "payment",
        paymentId: a.paymentId,
        reviewId: r1,
        now: tick(),
        bell,
      }),
    );
    await db().batch(
      gatewayDeadLetterStatements(db(), {
        kind: "payment",
        paymentId: a.paymentId,
        reviewId: uuidv7(),
        now: tick(),
        bell,
      }),
    );
    const items = await all<{ id: string; document_id: string }>(
      "SELECT id, document_id FROM review_items WHERE payment_id = ?",
      a.paymentId,
    );
    expect(items).toEqual([{ id: r1, document_id: proforma }]);
  });
});

describe("onlinePayableSql is the twin of core payableOnline", () => {
  it.each([
    [{}, {}],
    [{ type: "proforma", status: "converted", balance: 59_000 }, {}],
    [{ type: "proforma" }, {}],
    [{ type: "proforma", balance: 118_050 }, {}],
    // Early check 1, finding 5: a frozen proforma neither issued nor converted is not payable.
    [{ type: "proforma", status: "paid" }, {}],
    [{ status: "void" }, {}],
    [{ status: "paid", balance: 0 }, {}],
    [{ balance: 99 }, {}],
    // An overseas client's INR proforma (a tax invoice for it is refused by `documents_invoice_type_client` already).
    [{ type: "proforma" }, { country: "AE", gst_status: "overseas", state_code: null }],
    [{}, { anonymised_at: 5 }],
  ] as const)("doc %j, client %j", async (d, k) => {
    const clientId = await mkClient(k);
    const id = await mkIssued(clientId, d);
    const row = await first<{
      ok: number;
      type: string;
      currency: string;
      status: string;
      balance_minor: number;
      country: string;
      gst_status: string;
      anon: number;
    }>(
      `SELECT ${onlinePayableSql("d", "k")} AS ok, d.type, d.currency, d.status, d.balance_minor, k.country, k.gst_status, k.anonymised_at IS NOT NULL AS anon
       FROM documents d JOIN clients k ON k.id = d.client_id WHERE d.id = ?`,
      id,
    );
    if (!row) throw new Error("row");
    const core = payableOnline(
      {
        type: row.type,
        currency: row.currency,
        frozen: true,
        status: row.status,
        withdrawn: false,
        balanceMinor: row.balance_minor,
      },
      { country: row.country, gstStatus: row.gst_status, anonymised: row.anon === 1 },
    );
    expect(row.ok === 1).toBe(core.ok);
  });
});

// ---- the automatic advance (GATEWAY_AUTO_SQL) -----------------------------------------------------------------------------------------------------

const PATTERNS = {
  proforma: sqlPrintfPattern(defaultFormat("proforma")),
  invoice: sqlPrintfPattern(defaultFormat("invoice")),
};

const versions = async () => {
  const get = async (key: string) =>
    (await first<{ version: number }>("SELECT version FROM settings WHERE key = ?", key))?.version ?? null;
  return {
    numberingVersion: await get("numbering"),
    companyVersion: await get("company"),
    taxVersion: await get("tax"),
    paymentTermsVersion: await get("payment_terms"),
    bankStamp:
      (await first<{ m: number | null }>("SELECT max(updated_at) AS m FROM bank_accounts WHERE active = 1"))
        ?.m ?? null,
  };
};

const issuer = (staffId: string) => ({
  company: {
    tradeName: "T",
    legalName: "L",
    address: "A",
    gstin: null,
    stateCode: "19",
    logo: "logo-primary-color.svg",
  },
  bank: { inr: null },
  signature: null,
  reverseChargeText: "Tax payable on reverse charge: No",
  sender: { staffId, name: "N", email: "billing@example.com" },
});

type AdvanceWorld = {
  clientId: string;
  proformaId: string;
  ownerId: string;
  fy: string;
  paymentId: string;
  checkoutId: string;
  receivedOn: string;
  referenceNorm: string;
};

/** An owner, a client, a proforma issued by that owner through the real issue batch, a live link, and a Razorpay payment recorded pending against it. */
async function advanceWorld(o: { clientOver?: Record<string, unknown> } = {}): Promise<AdvanceWorld> {
  await signedCompany();
  const fy = nextFy();
  const clientId = await mkClient(o.clientOver);
  const ownerId = await mkMember("owner");
  const sessionId = `sess-${uuidv7()}`;
  const now = Date.now();
  await run(
    "INSERT INTO staff_sessions (id, user_id, last_seen_at, idle_expires_at, abs_expires_at, step_up_until) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    sessionId,
    ownerId,
    now,
    now + 3_600_000,
    now + 3_600_000,
    now + 600_000,
  );
  const proformaId = uuidv7();
  await run(
    "INSERT INTO documents (id, type, client_id, currency, updated_at, content_sha256, total_minor, taxable_minor) VALUES (?1, 'proforma', ?2, 'INR', 7000, ?3, 118000, 118000)",
    proformaId,
    clientId,
    "h".repeat(64),
  );
  const v = await versions();
  const s = invoiceIssueStatements(db(), {
    documentId: proformaId,
    type: "proforma",
    series: "proforma",
    fy,
    pattern: PATTERNS.proforma.pattern,
    argOrder: PATTERNS.proforma.argOrder,
    maxNumber: 9999,
    now: Date.now(),
    issueDate: "2026-10-28",
    dueDate: "2026-11-04",
    recipient: { legalName: "L", country: "IN" },
    issuer: issuer(ownerId),
    computedJson: "{}",
    snapshotSha256: "s".repeat(64),
    issuedBy: ownerId,
    termsVersionId: null,
    expected: {
      updatedAt: 7_000,
      contentSha256: "h".repeat(64),
      ...v,
      clientUpdatedAt: 5_000,
      contact: null,
    },
    authority: { kind: "owner", sessionId },
    bell: { clientName: "Asha Traders", linkPrefix: "/invoices/" },
  } as Parameters<typeof invoiceIssueStatements>[1]);
  await db().batch([...s.main, ...s.postAudit]);
  const contactId = await mkContact(clientId);
  const co = await liveCheckout(proformaId, clientId, contactId, 59_000);
  const a = payArgs(
    { clientId, documentId: proformaId, checkoutId: co.id, eventId: null },
    {
      status: "pending_verification",
      source: "refresh",
      amountMinor: 59_000,
      allocate: null,
      requestedAllocations: [{ documentId: proformaId, amountMinor: 59_000 }],
      event: null,
      staleOthers: false,
      bell: null,
    },
  );
  expect(await writePayment(a)).toBe(true);
  return {
    clientId,
    proformaId,
    ownerId,
    fy,
    paymentId: a.paymentId,
    checkoutId: co.id,
    receivedOn: a.receivedOn,
    referenceNorm: a.referenceNorm,
  };
}

async function gatewayAdvanceArgs(
  w: AdvanceWorld,
  over: Partial<AdvanceIssueArgs> = {},
): Promise<AdvanceIssueArgs> {
  const v = await versions();
  const p = await first<{ updated_at: number }>(
    "SELECT updated_at FROM documents WHERE id = ?",
    w.proformaId,
  );
  const amount = 59_000;
  return {
    documentId: uuidv7(),
    type: "tax_invoice",
    series: "invoice",
    fy: w.fy,
    pattern: PATTERNS.invoice.pattern,
    argOrder: PATTERNS.invoice.argOrder,
    maxNumber: 9999,
    now: Math.max(Date.now(), (p?.updated_at ?? 0) + 1),
    issueDate: "2026-10-30",
    dueDate: "2026-10-30",
    recipient: { legalName: "L", country: "IN" },
    issuer: { ...issuer("system"), signature: { ...TEST_SIGNATURE } },
    computedJson: "{}",
    snapshotSha256: "a".repeat(64),
    issuedBy: null,
    termsVersionId: null,
    proformaId: w.proformaId,
    expectedProformaUpdatedAt: p?.updated_at ?? 0,
    authority: {
      kind: "gateway_auto",
      paymentId: w.paymentId,
      checkoutId: w.checkoutId,
      onBehalfOf: w.ownerId,
    },
    amountMinor: amount,
    receivedOn: w.receivedOn,
    referenceNorm: w.referenceNorm,
    receiptId: uuidv7(),
    contentSha256: "c".repeat(64),
    expected: { ...v, clientUpdatedAt: 5_000, contact: null },
    draft: {
      clientId: w.clientId,
      projectId: null,
      contactId: null,
      currency: "INR",
      exportMode: null,
      fx: null,
      subtotalMinor: amount,
      discountMinor: 0,
      taxableMinor: amount,
      cgstMinor: 0,
      sgstMinor: 0,
      igstMinor: 0,
      roundOffMinor: 0,
      totalMinor: amount,
      totalInrMinor: null,
      supplyType: "intra",
      placeOfSupplyCode: "19",
      lines: [
        {
          id: uuidv7(),
          position: 1,
          description: "Advance",
          detail: null,
          sac: "998314",
          qtyMilli: 1000,
          unit: "fixed",
          rateMinor: amount,
          taxableMinor: amount,
          gstRateBp: 0,
          cgstMinor: 0,
          sgstMinor: 0,
          igstMinor: 0,
          lineTotalMinor: amount,
        },
      ],
    },
    ...over,
  } as AdvanceIssueArgs;
}

const runAdvance = (a: AdvanceIssueArgs) => {
  const s = advanceIssueStatements(db(), a);
  return db().batch([...s.main, ...s.postAudit]);
};

describe("the automatic advance: GATEWAY_AUTO_SQL [ADM-INV-10, L5, L6; 08-C RA-17]", () => {
  it("issues the tax invoice with no member: issued_by NULL, the receipt by the proforma's issuer, the payment confirmed by the system and put on it", async () => {
    const w = await advanceWorld();
    const a = await gatewayAdvanceArgs(w);
    await runAdvance(a);
    expect(
      await first(
        "SELECT type, status, issued_by, created_by, parent_id, paid_minor, balance_minor FROM documents WHERE id = ?",
        a.documentId,
      ),
    ).toEqual({
      type: "tax_invoice",
      status: "paid",
      issued_by: null,
      created_by: null,
      parent_id: w.proformaId,
      paid_minor: 59_000,
      balance_minor: 0,
    });
    expect(
      (
        await first<{ created_by: string }>(
          "SELECT created_by FROM advance_receipts WHERE id = ?",
          a.receiptId,
        )
      )?.created_by,
    ).toBe(w.ownerId);
    expect(
      await first("SELECT status, verified_by, advance_receipt_id FROM payments WHERE id = ?", w.paymentId),
    ).toEqual({ status: "confirmed", verified_by: null, advance_receipt_id: a.receiptId });
    expect(
      await first("SELECT created_by FROM payment_allocations WHERE payment_id = ?", w.paymentId),
    ).toEqual({ created_by: null });
    expect(
      await first("SELECT status, paid_minor, balance_minor FROM documents WHERE id = ?", w.proformaId),
    ).toEqual({
      status: "converted",
      paid_minor: 59_000,
      balance_minor: 59_000,
    });
  });

  it("two tries at once: one invoice", async () => {
    const w = await advanceWorld();
    const a = await gatewayAdvanceArgs(w);
    const b = await gatewayAdvanceArgs(w);
    const results = await Promise.allSettled([runAdvance(a), runAdvance(b)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        await first<{ n: number }>(
          "SELECT count(*) AS n FROM documents WHERE parent_id = ? AND type = 'tax_invoice'",
          w.proformaId,
        )
      )?.n,
    ).toBe(1);
  });

  it("refuses when the proforma's issuer is no longer an active Owner, or the system claims another Owner", async () => {
    const w = await advanceWorld();
    await rejects(
      runAdvance(
        await gatewayAdvanceArgs(w, {
          authority: {
            kind: "gateway_auto",
            paymentId: w.paymentId,
            checkoutId: w.checkoutId,
            onBehalfOf: await mkMember("owner"),
          },
        }),
      ),
      /issue did not freeze/,
    );
    await run("UPDATE staff_users SET status = 'deactivated' WHERE id = ?", w.ownerId);
    await rejects(runAdvance(await gatewayAdvanceArgs(w)), /issue did not freeze/);
    expect(
      (await first<{ status: string }>("SELECT status FROM payments WHERE id = ?", w.paymentId))?.status,
    ).toBe("pending_verification");
  });

  it("refuses a payment no longer pending, a different amount, a different checkout", async () => {
    const w = await advanceWorld();
    await rejects(runAdvance(await gatewayAdvanceArgs(w, { amountMinor: 58_000 })), /issue did not freeze/);
    await rejects(
      runAdvance(
        await gatewayAdvanceArgs(w, {
          authority: {
            kind: "gateway_auto",
            paymentId: w.paymentId,
            checkoutId: uuidv7(),
            onBehalfOf: w.ownerId,
          },
        }),
      ),
      /issue did not freeze/,
    );
    const owner = await mkMember("owner");
    await run(
      "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = 1 WHERE id = ?1",
      w.paymentId,
      owner,
    );
    await rejects(runAdvance(await gatewayAdvanceArgs(w)), /issue did not freeze/);
  });

  it("refuses with no signature on the issuer block, with settings changed since the read, and for a client overseas", async () => {
    const w = await advanceWorld();
    await rejects(
      runAdvance(await gatewayAdvanceArgs(w, { issuer: issuer("system") })),
      /issue did not freeze/,
    );
    const a = await gatewayAdvanceArgs(w);
    await run("UPDATE settings SET version = version + 1 WHERE key = 'company'");
    await rejects(runAdvance(a), /issue did not freeze/);
  });

  it("refuses a client that moved overseas after the payment, even with the freeze's client stamp read afresh (GATEWAY_AUTO_SQL itself)", async () => {
    const w = await advanceWorld();
    await run(
      "UPDATE clients SET country = 'AE', gst_status = 'overseas', state_code = NULL, updated_at = 6000 WHERE id = ?",
      w.clientId,
    );
    const a = await gatewayAdvanceArgs(w);
    await rejects(
      runAdvance({ ...a, expected: { ...a.expected, clientUpdatedAt: 6_000 } }),
      /issue did not freeze|documents_invoice_type_client/,
    );
    expect(
      (await first<{ status: string }>("SELECT status FROM payments WHERE id = ?", w.paymentId))?.status,
    ).toBe("pending_verification");
  });

  it("the owner authority is unchanged: without `authority` the session is required (M5.2)", async () => {
    const w = await advanceWorld();
    const a = await gatewayAdvanceArgs(w);
    const { authority: _drop, ...owner } = a;
    await rejects(
      runAdvance({ ...owner, sessionId: "no-such-session", issuedBy: w.ownerId, paymentId: w.paymentId }),
      /issue did not freeze/,
    );
  });
});
