// M6.2 Razorpay in the database, the migrations and the triggers (ADM-PAY-01, -02, -06, -07, JOB-HOOK-01..03; run file docs/runs/m6.2-razorpay.md A and H): 0061 creates and
// adds only, 0062's pinned lists equal the schema's, manual payments behave as in M6.1, a gateway payment's shape and moves (never rejected or withdrawn; the
// `gateway_auto` confirm only with its advance receipt), the unique gateway payment id, the checkout, webhook event and review item flows, no deletes, and the
// EXPLAIN plans of the new indexes. Raw SQL: the triggers are the subject. All names and amounts are invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import {
  CHECKOUT_SOURCES,
  CHECKOUT_STATUSES,
  GATEWAY_PROVIDERS,
  PAYMENT_MODES,
  PAYMENT_PROVIDERS,
  REVIEW_KINDS,
  REVIEW_RESOLUTIONS,
  REVIEW_SOURCES,
  WEBHOOK_EVENT_STATUSES,
} from "../src/schema/payments.ts";
import {
  CHECKOUT_SOURCES_0062,
  CHECKOUT_STATUSES_0062,
  GATEWAY_PROVIDERS_0062,
  PAYMENT_MODES_0062,
  PAYMENT_PROVIDERS_0062,
  REVIEW_KINDS_0062,
  REVIEW_RESOLUTIONS_0062,
  REVIEW_SOURCES_0062,
  WEBHOOK_EVENT_STATUSES_0062,
} from "../src/triggers.ts";
import { mkClientRow, mkContact, mkIssued, mkMember } from "./billing-helpers.ts";
import { all, first, rejects, run } from "./helpers.ts";

const T = 1_800_000_000_000;

/** A checkout row as the portal path writes it (`creating`, by a contact), then optionally moved on. */
async function checkout(
  documentId: string,
  clientId: string,
  contactId: string,
  o: { status?: "live" | "paid"; amount?: number; id?: string } = {},
): Promise<string> {
  const id = o.id ?? uuidv7();
  await run(
    `INSERT INTO checkout_sessions (id, provider, document_id, client_id, contact_id, source, currency, amount_minor, status, expires_at, created_at, updated_at)
     VALUES (?1, 'razorpay', ?2, ?3, ?4, 'portal', 'INR', ?5, 'creating', ?6, ?7, ?7)`,
    id,
    documentId,
    clientId,
    contactId,
    o.amount ?? 118_000,
    T + 7 * 86_400_000,
    T,
  );
  if (o.status === "live" || o.status === "paid")
    await run(
      "UPDATE checkout_sessions SET status = 'live', provider_link_id = ?2, short_url = ?3, updated_at = ?4 WHERE id = ?1",
      id,
      `plink_${id.slice(-12)}`,
      "https://rzp.io/i/abc",
      T + 1,
    );
  return id;
}

type GwOver = Partial<{
  id: string;
  status: string;
  verifiedBy: string | null;
  verifiedAt: number | null;
  recordedBy: string | null;
  providerPaymentId: string | null;
  checkoutId: string | null;
  refetchedAt: number | null;
  currency: string;
  kind: string;
  mode: string | null;
  ref: string | null;
  requested: string | null;
}>;

/** A Razorpay payment row written straight in (confirmed by the gateway unless told otherwise). */
async function gwPay(clientId: string, checkoutId: string, o: GwOver = {}): Promise<string> {
  const id = o.id ?? `rzp_${uuidv7().slice(-14)}`;
  const status = o.status ?? "confirmed";
  await run(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, received_on, mode, reference_norm, requested_allocations,
       recorded_by, recorded_at, verified_by, verified_at, provider_payment_id, checkout_id, fee_tax_minor, refetched_at)
     VALUES (?1, ?2, ?3, 'razorpay', ?4, ?5, 118000, 2360, '2026-10-28', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 360, ?15)`,
    id,
    clientId,
    o.kind ?? "payment",
    status,
    o.currency ?? "INR",
    o.mode === undefined ? "upi" : o.mode,
    o.ref === undefined ? id.slice(4).toUpperCase() : o.ref,
    o.requested ?? null,
    o.recordedBy ?? null,
    T,
    o.verifiedBy ?? null,
    o.verifiedAt === undefined ? (status === "confirmed" ? T : null) : o.verifiedAt,
    o.providerPaymentId === undefined ? id.slice(4) : o.providerPaymentId,
    o.checkoutId === undefined ? checkoutId : o.checkoutId,
    o.refetchedAt === undefined ? T : o.refetchedAt,
  );
  return id;
}

async function setup() {
  const owner = await mkMember("owner");
  const clientId = await mkClientRow();
  const contactId = await mkContact(clientId);
  const inv = await mkIssued(clientId);
  return { owner, clientId, contactId, inv };
}

describe("0061 and 0062: no rebuild, the pinned lists [run file A]", () => {
  it("0061 only creates tables and indexes and adds payment columns: no DROP, no copy, no rebuild", () => {
    const m = env.TEST_MIGRATIONS.find((x) => x.name === "0061_gateway.sql");
    expect(m).toBeDefined();
    for (const q of (m?.queries ?? []).map((x) => x.replace(/^(\s|--> statement-breakpoint)+/, "")))
      expect(q.trim(), q.slice(0, 60)).toMatch(
        /^(CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|ALTER TABLE `payments` ADD `)/,
      );
    expect((m?.queries ?? []).join("\n")).not.toMatch(/DROP TABLE|__new_|INSERT INTO/);
  });

  it("0062 drops only payment triggers it creates again, and nothing else", () => {
    const m = env.TEST_MIGRATIONS.find((x) => x.name === "0062_gateway_triggers.sql");
    const text = (m?.queries ?? []).join("\n");
    expect(text).not.toMatch(/DROP TABLE|DROP INDEX|__new_|ALTER TABLE/);
    const dropped = [...text.matchAll(/DROP TRIGGER `([a-z_]+)`/g)].map((x) => x[1]);
    expect(dropped).toEqual([
      "payments_values_insert",
      "payments_values_update",
      "payments_insert_state",
      "payments_fixed",
      "payments_status_flow",
    ]);
    for (const name of dropped) expect(text).toContain(`CREATE TRIGGER \`${name}\``);
  });

  it("the trigger lists of 0062 are the schema's lists today", () => {
    expect(PAYMENT_PROVIDERS_0062).toEqual(PAYMENT_PROVIDERS);
    expect(PAYMENT_MODES_0062).toEqual(PAYMENT_MODES);
    expect(GATEWAY_PROVIDERS_0062).toEqual(GATEWAY_PROVIDERS);
    expect(WEBHOOK_EVENT_STATUSES_0062).toEqual(WEBHOOK_EVENT_STATUSES);
    expect(CHECKOUT_SOURCES_0062).toEqual(CHECKOUT_SOURCES);
    expect(CHECKOUT_STATUSES_0062).toEqual(CHECKOUT_STATUSES);
    expect(REVIEW_SOURCES_0062).toEqual(REVIEW_SOURCES);
    expect(REVIEW_RESOLUTIONS_0062).toEqual(REVIEW_RESOLUTIONS);
    expect(REVIEW_KINDS_0062).toEqual(REVIEW_KINDS);
  });
});

describe("manual payments are unchanged by 0062 [ADM-PAY-05, M6.1]", () => {
  it("a manual entry still needs its recorder and an Owner to confirm, and may carry none of the gateway columns", async () => {
    const { owner, clientId, contactId, inv } = await setup();
    const staff = await mkMember("staff");
    const ins = (o: { by: string | null; status: string; verifiedBy: string | null; extra?: string }) =>
      run(
        `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at, verified_by, verified_at${o.extra ? ", checkout_id" : ""})
         VALUES (?1, ?2, 'payment', 'manual', ?3, 'INR', 1000, '2026-10-28', 'neft', ?4, ?5, ?6, ?7${o.extra ? ", ?8" : ""})`,
        uuidv7(),
        clientId,
        o.status,
        o.by,
        T,
        o.verifiedBy,
        o.status === "confirmed" ? T : null,
        ...(o.extra ? [o.extra] : []),
      );
    await ins({ by: owner, status: "confirmed", verifiedBy: owner });
    await ins({ by: staff, status: "pending_verification", verifiedBy: null });
    await rejects(
      ins({ by: null, status: "pending_verification", verifiedBy: null }),
      /payments_insert_state/,
    );
    await rejects(ins({ by: staff, status: "confirmed", verifiedBy: staff }), /payments_insert_state/);
    const co = await checkout(inv, clientId, contactId);
    await rejects(
      ins({ by: owner, status: "confirmed", verifiedBy: owner, extra: co }),
      /payments_gateway_shape/,
    );
  });

  it("a manual pending entry may still be rejected, and a confirmed one withdrawn, by the Owner", async () => {
    const { owner, clientId } = await setup();
    const staff = await mkMember("staff");
    const id = uuidv7();
    await run(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at)
       VALUES (?1, ?2, 'payment', 'manual', 'pending_verification', 'INR', 1000, '2026-10-28', 'neft', ?3, ?4)`,
      id,
      clientId,
      staff,
      T,
    );
    await run(
      "UPDATE payments SET status = 'rejected', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
      id,
      owner,
      T,
    );
    const ok = uuidv7();
    await run(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at, verified_by, verified_at)
       VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'INR', 1000, '2026-10-28', 'neft', ?3, ?4, ?3, ?4)`,
      ok,
      clientId,
      owner,
      T,
    );
    await run(
      "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = ?3, withdraw_reason = 'typed twice' WHERE id = ?1",
      ok,
      owner,
      T,
    );
  });
});

describe("gateway payments: shape, insert state, moves, unique id [ADM-PAY-02, -07, L5, L6, L7]", () => {
  it("a confirmed or pending Razorpay payment with every gateway column lands; a Razorpay method is a known mode", async () => {
    const { clientId, contactId, inv } = await setup();
    const co = await checkout(inv, clientId, contactId);
    await gwPay(clientId, co, { mode: "netbanking" });
    await gwPay(clientId, co, { status: "pending_verification", mode: "card" });
    await rejects(gwPay(clientId, co, { mode: "cheque" }), /payments_values_insert/);
  });

  it("refuses a gateway payment with a member, without its gateway id, checkout or re-fetch, or confirmed by a member at insert", async () => {
    const { owner, clientId, contactId, inv } = await setup();
    const co = await checkout(inv, clientId, contactId);
    await rejects(gwPay(clientId, co, { recordedBy: owner }), /payments_insert_state/);
    await rejects(gwPay(clientId, co, { providerPaymentId: null }), /payments_insert_state/);
    await rejects(gwPay(clientId, co, { checkoutId: null }), /payments_insert_state/);
    await rejects(gwPay(clientId, co, { refetchedAt: null }), /payments_insert_state/);
    await rejects(gwPay(clientId, co, { verifiedBy: owner }), /payments_insert_state/);
    await rejects(gwPay(clientId, co, { verifiedAt: null }), /payments_insert_state/);
    await rejects(
      gwPay(clientId, co, { status: "pending_verification", verifiedAt: T }),
      /payments_insert_state/,
    );
    await rejects(gwPay(clientId, co, { status: "withdrawn" }), /payments_insert_state/);
  });

  it("refuses a gateway payment that is TDS, not INR, without a mode or reference, or with a gateway id too long", async () => {
    const { clientId, contactId, inv } = await setup();
    const co = await checkout(inv, clientId, contactId);
    await rejects(gwPay(clientId, co, { mode: null }), /payments_gateway_shape/);
    await rejects(gwPay(clientId, co, { ref: null }), /payments_gateway_shape/);
    await rejects(gwPay(clientId, co, { providerPaymentId: "x".repeat(65) }), /payments_gateway_shape/);
    await rejects(gwPay(clientId, co, { currency: "USD" }), /payments_gateway_shape/);
    await rejects(gwPay(clientId, co, { kind: "tds", mode: null }), /payments_(gateway_shape|tds_rules)/);
  });

  it("one row per gateway payment id: a second row for the same Razorpay payment is refused (payments_provider_ref)", async () => {
    const { clientId, contactId, inv } = await setup();
    const co = await checkout(inv, clientId, contactId);
    await gwPay(clientId, co, { id: "rzp_SAMEPAY0001", providerPaymentId: "pay_SAMEPAY0001" });
    await rejects(
      gwPay(clientId, co, { id: "rzp_SAMEPAY0001b", providerPaymentId: "pay_SAMEPAY0001" }),
      /UNIQUE/,
    );
  });

  it("a gateway payment is never rejected or withdrawn (refunds are M6.5), even by the Owner", async () => {
    const { owner, clientId, contactId, inv } = await setup();
    const co = await checkout(inv, clientId, contactId);
    const pending = await gwPay(clientId, co, { status: "pending_verification" });
    await rejects(
      run(
        "UPDATE payments SET status = 'rejected', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
        pending,
        owner,
        T,
      ),
      /payments_status_flow/,
    );
    const confirmed = await gwPay(clientId, co);
    await rejects(
      run(
        "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = ?3, withdraw_reason = 'x' WHERE id = ?1",
        confirmed,
        owner,
        T,
      ),
      /payments_status_flow/,
    );
  });

  it("a pending gateway payment is confirmed by an active Owner, or by the system only with its advance receipt in the same update", async () => {
    const { owner, clientId, contactId, inv } = await setup();
    const co = await checkout(inv, clientId, contactId);
    const byOwner = await gwPay(clientId, co, { status: "pending_verification" });
    await run(
      "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
      byOwner,
      owner,
      T,
    );
    const bySystem = await gwPay(clientId, co, { status: "pending_verification" });
    // No member and no advance receipt: refused.
    await rejects(
      run("UPDATE payments SET status = 'confirmed', verified_at = ?2 WHERE id = ?1", bySystem, T),
      /payments_status_flow/,
    );
    // No member, with the advance receipt (an M5.2 receipt row, as the advance batch writes it first).
    const proforma = await mkIssued(clientId, { type: "proforma" });
    const advanceInvoice = await mkIssued(clientId, { parentId: proforma });
    const receipt = uuidv7();
    await run(
      `INSERT INTO advance_receipts (id, proforma_id, invoice_id, client_id, currency, amount_minor, received_on, reference_norm, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, 'INR', 118000, '2026-10-28', 'PAYREF1', ?5, ?6)`,
      receipt,
      proforma,
      advanceInvoice,
      clientId,
      owner,
      T,
    );
    await run(
      "UPDATE payments SET status = 'confirmed', verified_at = ?2, advance_receipt_id = ?3 WHERE id = ?1",
      bySystem,
      T,
      receipt,
    );
    const row = await first<{ status: string; verified_by: string | null }>(
      "SELECT status, verified_by FROM payments WHERE id = ?",
      bySystem,
    );
    expect(row).toEqual({ status: "confirmed", verified_by: null });
    // A manual pending entry can never take the system path.
    const staff = await mkMember("staff");
    const manual = uuidv7();
    await run(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at)
       VALUES (?1, ?2, 'payment', 'manual', 'pending_verification', 'INR', 1000, '2026-10-28', 'neft', ?3, ?4)`,
      manual,
      clientId,
      staff,
      T,
    );
    await rejects(
      run("UPDATE payments SET status = 'confirmed', verified_at = ?2 WHERE id = ?1", manual, T),
      /payments_status_flow/,
    );
  });

  it("the gateway columns never change after the insert (payments_fixed)", async () => {
    const { clientId, contactId, inv } = await setup();
    const co = await checkout(inv, clientId, contactId);
    const id = await gwPay(clientId, co);
    for (const [col, v] of [
      ["provider_payment_id", "pay_other"],
      ["checkout_id", null],
      ["fee_tax_minor", 1],
      ["refetched_at", T + 5],
    ] as const)
      await rejects(run(`UPDATE payments SET ${col} = ?2 WHERE id = ?1`, id, v), /payments_fixed/);
  });
});

describe("checkout sessions [ADM-PAY-02, L3, L4]", () => {
  it("two open checkouts for one document: the second is refused (two clicks serialise on the unique index)", async () => {
    const { clientId, contactId, inv } = await setup();
    await checkout(inv, clientId, contactId);
    await rejects(checkout(inv, clientId, contactId), /UNIQUE/);
  });

  it("a checkout starts creating, by the actor of its source", async () => {
    const { owner, clientId, contactId, inv } = await setup();
    const ins = (source: string, contact: string | null, by: string | null, status = "creating") =>
      run(
        `INSERT INTO checkout_sessions (id, provider, document_id, client_id, contact_id, created_by, source, currency, amount_minor, status, expires_at, updated_at)
         VALUES (?1, 'razorpay', ?2, ?3, ?4, ?5, ?6, 'INR', 1000, ?7, ?8, ?8)`,
        uuidv7(),
        inv,
        clientId,
        contact,
        by,
        source,
        status,
        T,
      );
    await rejects(ins("portal", null, null), /checkout_sessions_insert_state/);
    await rejects(ins("staff", null, null), /checkout_sessions_insert_state/);
    await rejects(ins("link", null, null), /checkout_sessions_insert_state/);
    await rejects(ins("portal", contactId, null, "live"), /checkout_sessions_insert_state/);
    await rejects(ins("email", contactId, null), /checkout_sessions_(values_insert|insert_state)/);
    await ins("staff", null, owner);
  });

  it("follows creating → live | failed, live → paid | expired | cancelled | stale, stale → paid | expired | cancelled; nothing else", async () => {
    const { clientId, contactId } = await setup();
    const move = (id: string, status: string, extra = "") =>
      run(
        `UPDATE checkout_sessions SET status = ?2, updated_at = updated_at + 1${extra} WHERE id = ?1`,
        id,
        status,
      );
    // creating → paid, creating → live without a link: refused
    const a = await checkout(await mkIssued(clientId), clientId, contactId);
    await rejects(move(a, "paid"), /checkout_sessions_status_flow/);
    await rejects(move(a, "live"), /checkout_sessions_status_flow/);
    await move(a, "failed");
    await rejects(
      move(a, "live", ", provider_link_id = 'plink_x', short_url = 'https://rzp.io/i/x'"),
      /checkout_sessions_status_flow/,
    );
    // live → stale → expired, then nothing
    const b = await checkout(await mkIssued(clientId), clientId, contactId, { status: "live" });
    await move(b, "stale");
    await rejects(move(b, "live"), /checkout_sessions_status_flow/);
    await move(b, "expired");
    await rejects(move(b, "cancelled"), /checkout_sessions_status_flow/);
    // live → paid needs its payment, set once
    const doc = await mkIssued(clientId);
    const c = await checkout(doc, clientId, contactId, { status: "live" });
    await rejects(move(c, "paid"), /checkout_sessions_status_flow/);
    const p = await gwPay(clientId, c);
    await run(
      "UPDATE checkout_sessions SET status = 'paid', paid_payment_id = ?2, updated_at = updated_at + 1 WHERE id = ?1",
      c,
      p,
    );
    const p2 = await gwPay(clientId, c);
    await rejects(
      run("UPDATE checkout_sessions SET paid_payment_id = ?2 WHERE id = ?1", c, p2),
      /checkout_sessions_(status_flow|fixed)/,
    );
    // stale → paid is allowed (a stale link that is paid becomes credit, L4)
    const d = await checkout(await mkIssued(clientId), clientId, contactId, { status: "live" });
    await move(d, "stale");
    const p3 = await gwPay(clientId, d);
    await run(
      "UPDATE checkout_sessions SET status = 'paid', paid_payment_id = ?2, updated_at = updated_at + 1 WHERE id = ?1",
      d,
      p3,
    );
  });

  it("keeps its money, document and source; the link is set once; the expiry moves only when it goes live; never deleted", async () => {
    const { clientId, contactId, inv } = await setup();
    const id = await checkout(inv, clientId, contactId);
    await rejects(
      run("UPDATE checkout_sessions SET amount_minor = 1 WHERE id = ?1", id),
      /checkout_sessions_fixed/,
    );
    await rejects(
      run("UPDATE checkout_sessions SET expires_at = expires_at + 1 WHERE id = ?1", id),
      /checkout_sessions_fixed/,
    );
    await run(
      "UPDATE checkout_sessions SET status = 'live', provider_link_id = 'plink_A1', short_url = 'https://rzp.io/i/a', expires_at = expires_at - 5, updated_at = updated_at + 1 WHERE id = ?1",
      id,
    );
    await rejects(
      run("UPDATE checkout_sessions SET provider_link_id = 'plink_B2' WHERE id = ?1", id),
      /checkout_sessions_fixed/,
    );
    await rejects(
      run("UPDATE checkout_sessions SET updated_at = 1 WHERE id = ?1", id),
      /checkout_sessions_fixed/,
    );
    await run("UPDATE checkout_sessions SET last_refresh_at = ?2 WHERE id = ?1", id, T + 60_000);
    await rejects(run("DELETE FROM checkout_sessions WHERE id = ?1", id), /checkout_sessions_no_delete/);
  });

  it("one checkout per Razorpay link id", async () => {
    const { clientId, contactId } = await setup();
    const a = await checkout(await mkIssued(clientId), clientId, contactId);
    const b = await checkout(await mkIssued(clientId), clientId, contactId);
    const live = (id: string) =>
      run(
        "UPDATE checkout_sessions SET status = 'live', provider_link_id = 'plink_DUP', short_url = 'https://rzp.io/i/d', updated_at = updated_at + 1 WHERE id = ?1",
        id,
      );
    await live(a);
    await rejects(live(b), /UNIQUE/);
  });
});

describe("webhook events [JOB-HOOK-01, -02]", () => {
  const ins = (eventId: string, status = "received", attempts = 0) =>
    run(
      "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, attempts, facts) VALUES (?1, 'razorpay', ?2, 'payment_link.paid', ?3, ?4, ?5, ?6)",
      uuidv7(),
      eventId,
      T,
      status,
      attempts,
      JSON.stringify({ linkId: "plink_X" }),
    );

  it("one row per provider and event id; an event arrives received or ignored with no attempts", async () => {
    await ins("evt_A");
    await rejects(ins("evt_A"), /UNIQUE/);
    await ins("evt_B", "ignored");
    await rejects(ins("evt_C", "processed"), /webhook_events_values_insert/);
    await rejects(ins("evt_D", "received", 3), /webhook_events_values_insert/);
    await rejects(ins("x".repeat(65)), /CHECK constraint failed: webhook_events_event_id/);
  });

  it("received → processed | ignored | needs_review | failed, failed → received; facts and identity frozen; attempts never go down; never deleted", async () => {
    await ins("evt_flow1");
    await ins("evt_flow2");
    const id = async (e: string) =>
      (await first<{ id: string }>("SELECT id FROM webhook_events WHERE event_id = ?", e))?.id;
    const a = await id("evt_flow1");
    await run("UPDATE webhook_events SET attempts = attempts + 1 WHERE id = ?1", a);
    await rejects(
      run("UPDATE webhook_events SET attempts = 0 WHERE id = ?1", a),
      /webhook_events_status_flow/,
    );
    await run("UPDATE webhook_events SET status = 'failed' WHERE id = ?1", a);
    await run("UPDATE webhook_events SET status = 'received' WHERE id = ?1", a);
    await run(
      "UPDATE webhook_events SET status = 'processed', processed_at = ?2, outcome = 'processed' WHERE id = ?1",
      a,
      T,
    );
    await rejects(
      run("UPDATE webhook_events SET status = 'received' WHERE id = ?1", a),
      /webhook_events_status_flow/,
    );
    const b = await id("evt_flow2");
    await rejects(run("UPDATE webhook_events SET facts = '{}' WHERE id = ?1", b), /webhook_events_fixed/);
    await rejects(run("UPDATE webhook_events SET event_type = 'x' WHERE id = ?1", b), /webhook_events_fixed/);
    await rejects(
      run("UPDATE webhook_events SET status = 'bogus' WHERE id = ?1", b),
      /webhook_events_(values_update|status_flow)/,
    );
    await rejects(run("DELETE FROM webhook_events WHERE id = ?1", b), /webhook_events_no_delete/);
  });
});

describe("review items [ADM-PAY-07, L7, L8]", () => {
  async function item(clientId: string | null, kind = "amount_mismatch"): Promise<string> {
    const id = uuidv7();
    await run(
      "INSERT INTO review_items (id, source, provider, kind, status, client_id, amount_minor, currency, facts, created_at) VALUES (?1, 'webhook', 'razorpay', ?2, 'open', ?3, 1000, 'INR', '{}', ?4)",
      id,
      kind,
      clientId,
      T,
    );
    return id;
  }

  it("starts open with no decision, of a known kind; one item of a kind per event", async () => {
    await rejects(item(null, "made_up"), /review_items_values_insert/);
    await rejects(
      run(
        "INSERT INTO review_items (id, source, provider, kind, status, note) VALUES (?1, 'webhook', 'razorpay', 'overpaid', 'open', 'x')",
        uuidv7(),
      ),
      /review_items_values_insert/,
    );
    const ev = uuidv7();
    await run(
      "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status) VALUES (?1, 'razorpay', 'evt_rev', 'payment_link.paid', ?2, 'received')",
      ev,
      T,
    );
    const once = () =>
      run(
        "INSERT OR IGNORE INTO review_items (id, source, provider, kind, status, webhook_event_id) VALUES (?1, 'webhook', 'razorpay', 'overpaid', 'open', ?2)",
        uuidv7(),
        ev,
      );
    await once();
    await once();
    expect(
      (await first<{ n: number }>("SELECT count(*) AS n FROM review_items WHERE webhook_event_id = ?", ev))
        ?.n,
    ).toBe(1);
  });

  it("open → resolved once, by an active Owner, with a resolution and its note; facts frozen; never deleted", async () => {
    const { owner, clientId } = await setup();
    const staff = await mkMember("staff");
    const id = await item(clientId);
    const resolve = (by: string, resolution: string | null) =>
      run(
        "UPDATE review_items SET status = 'resolved', resolved_by = ?2, resolved_at = ?3, resolution = ?4, note = 'Checked the bank statement' WHERE id = ?1",
        id,
        by,
        T,
        resolution,
      );
    await rejects(resolve(staff, "confirmed"), /review_items_status_flow/);
    await rejects(resolve(owner, null), /review_items_status_flow/);
    await rejects(resolve(owner, "refunded"), /review_items_values_update/);
    await rejects(run("UPDATE review_items SET note = 'x' WHERE id = ?1", id), /review_items_status_flow/);
    await resolve(owner, "left_as_credit");
    await rejects(
      run("UPDATE review_items SET status = 'open' WHERE id = ?1", id),
      /review_items_status_flow/,
    );
    await rejects(
      run("UPDATE review_items SET resolution = 'dismissed' WHERE id = ?1", id),
      /review_items_status_flow/,
    );
    await rejects(run("UPDATE review_items SET facts = '{\"a\":1}' WHERE id = ?1", id), /review_items_fixed/);
    await rejects(run("UPDATE review_items SET kind = 'overpaid' WHERE id = ?1", id), /review_items_fixed/);
    // The note is cleared only once the client is anonymised (the erase, L31).
    await rejects(run("UPDATE review_items SET note = NULL WHERE id = ?1", id), /review_items_status_flow/);
    await run("UPDATE clients SET anonymised_at = ?2 WHERE id = ?1", clientId, T);
    await run("UPDATE review_items SET note = NULL WHERE id = ?1", id);
    await rejects(run("DELETE FROM review_items WHERE id = ?1", id), /review_items_no_delete/);
  });
});

describe("the new indexes are used (EXPLAIN QUERY PLAN)", () => {
  const plan = async (sql: string, ...binds: unknown[]) =>
    (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...binds)).map((r) => r.detail).join("\n");

  it.each([
    [
      "SELECT id FROM webhook_events WHERE provider = ?1 AND event_id = ?2",
      ["razorpay", "e"],
      "webhook_events_provider_event",
    ],
    [
      "SELECT id FROM webhook_events WHERE status = 'received' AND received_at < ?1 ORDER BY received_at, id LIMIT 20",
      [T],
      "webhook_events_received",
    ],
    [
      "SELECT id FROM checkout_sessions WHERE document_id = ?1 AND status IN ('creating', 'live')",
      ["d"],
      "checkout_sessions_open",
    ],
    [
      "SELECT id FROM checkout_sessions WHERE provider = ?1 AND provider_link_id = ?2",
      ["razorpay", "plink_x"],
      "checkout_sessions_provider_link",
    ],
    [
      "SELECT count(*) FROM checkout_sessions WHERE client_id = ?1 AND created_at > ?2",
      ["c", T],
      "checkout_sessions_client",
    ],
    [
      "SELECT id FROM review_items WHERE status = 'open' AND (created_at > ?1 OR (created_at = ?1 AND id > ?2)) ORDER BY created_at, id LIMIT 51",
      [0, ""],
      "review_items_open",
    ],
    ["SELECT id FROM review_items WHERE payment_id = ?1", ["p"], "review_items_payment"],
    ["SELECT id FROM review_items WHERE client_id = ?1", ["c"], "review_items_client"],
    [
      "SELECT id FROM payments WHERE provider = ?1 AND provider_payment_id = ?2",
      ["razorpay", "pay_x"],
      "payments_provider_ref",
    ],
  ] as const)("%s uses its index", async (sql, binds, index) => {
    expect(await plan(sql, ...binds)).toContain(index);
  });
});
