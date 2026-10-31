// The early check of stage B1 (M6.1, run file "Early check", CHANGE A1 to A8; ADM-PAY-05, ADM-PAY-06, Q60): the void rule counts only PENDING requests, a
// statement line's number is never NULL, the register rows carry an export's extension (twin of `femaDueSql`), the letter needs a live client, a pending entry
// is a Staff member's only, and the post-condition covers every source payment. All names and amounts are invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { DEFAULT_REALISATION_RULES, realisationDates } from "@techaust/core/gst";
import { describe, expect, it } from "vitest";
import {
  extensionLetterStatement,
  ledgerResultStatement,
  PAYMENT_ASKS_FOR_DOCUMENT_SQL,
  paymentBlocksVoidSql,
  paymentPendingForSql,
  paymentRecordedSql,
  recomputeStatement,
  recordPaymentStatement,
} from "../src/ledger.ts";
import { femaDueSql, gstDueSql, SCAN_BINDS } from "../src/realisation.ts";
import { REALISATION_PAGE_SQL, REGISTER_PAGE_SQL, STATEMENT_PAGE_SQL } from "../src/reports.ts";
import { mkClientRow, mkIssued, mkMember, next } from "./billing-helpers.ts";
import { first, rejects, run } from "./helpers.ts";

const T = 1_800_000_000_000;

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
  who: string,
  o: { status?: string; amount?: number; ref?: string | null; requested?: string | null } = {},
) {
  const id = uuidv7();
  const status = o.status ?? "confirmed";
  await run(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, reference_norm, requested_allocations, recorded_by, recorded_at, verified_by, verified_at)
     VALUES (?1, ?2, 'payment', 'manual', ?3, 'INR', ?4, '2026-10-28', 'neft', ?5, ?6, ?7, ?8, ?9, ?10)`,
    id,
    clientId,
    status,
    o.amount ?? 50_000,
    o.ref === undefined ? null : o.ref,
    o.requested ?? null,
    who,
    T,
    status === "confirmed" ? who : null,
    status === "confirmed" ? T : null,
  );
  return id;
}

/** An issued USD export invoice under LUT (the shape of the extension tests in ledger.test.ts). */
async function usdExport(): Promise<{ id: string; clientId: string }> {
  const clientId = await mkClientRow({ currency: "USD" });
  const id = uuidv7();
  const n = next();
  await run(
    `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, total_minor, balance_minor, supply_type)
     VALUES (?1, 'export_invoice', 'issued', ?2, 'USD', 'export', '9999', ?3, ?4, 1000, '2026-11-03', 100000, 100000, 'export_lut')`,
    id,
    clientId,
    n,
    `E/${n}`,
  );
  return { id, clientId };
}

const alloc = (paymentId: string, documentId: string, amount: number) =>
  run(
    "INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_at) VALUES (?1, ?2, ?3, ?4, 'allocate', ?5)",
    uuidv7(),
    paymentId,
    documentId,
    amount,
    T,
  );
const voidIt = (id: string) =>
  run("UPDATE documents SET status = 'void', voided_at = 1, void_reason = 'x' WHERE id = ?", id);
/** The void facts (L17, L32): a pending payment asks for the document, and an allocation row names it, as two separate answers. */
const asks = async (doc: string, client: string) =>
  await first<{ pending: number; recorded: number }>(PAYMENT_ASKS_FOR_DOCUMENT_SQL, doc, client);

describe("A2: only a PENDING request blocks a void; allocation rows always do", () => {
  it("a payment that asked for A but was confirmed onto B no longer blocks voiding A; a withdrawn one's request does not either; a pending one does", async () => {
    const owner = await mkMember("owner");
    const staff = await mkMember("staff");
    const clientId = await mkClientRow();
    const a = await mkIssued(clientId);
    const b = await mkIssued(clientId);
    // Staff asked for A; the Owner confirmed it onto B instead.
    const p = await pay(clientId, staff, {
      status: "pending_verification",
      amount: 100,
      requested: JSON.stringify([{ documentId: a, amountMinor: 100 }]),
    });
    expect(await asks(a, clientId)).toEqual({ pending: 1, recorded: 0 });
    await rejects(voidIt(a), /documents_void_no_payment/);
    await run(
      "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = 1 WHERE id = ?1",
      p,
      owner,
    );
    await alloc(p, b, 100);
    await recomputeStatement(env.DB, { paymentIds: [p] }, Date.now()).run();
    expect(await asks(a, clientId)).toEqual({ pending: 0, recorded: 0 });
    await voidIt(a);
    // B holds an allocation row: refused, also after the payment is withdrawn (the row stays).
    await rejects(voidIt(b), /documents_void_no_payment/);
    await run(
      "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = 2, withdraw_reason = 'twice' WHERE id = ?1",
      p,
      owner,
    );
    await recomputeStatement(env.DB, { paymentIds: [p] }, Date.now()).run();
    expect(await asks(b, clientId)).toEqual({ pending: 0, recorded: 1 });
    await rejects(voidIt(b), /documents_void_no_payment/);
    // A withdrawn payment's request (it asked for C, was confirmed with no allocation, then withdrawn) blocks nothing.
    const c = await mkIssued(clientId);
    const q = await pay(clientId, staff, {
      status: "pending_verification",
      amount: 100,
      requested: JSON.stringify([{ documentId: c, amountMinor: 100 }]),
    });
    await run(
      "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = 1 WHERE id = ?1",
      q,
      owner,
    );
    await run(
      "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = 2, withdraw_reason = 'twice' WHERE id = ?1",
      q,
      owner,
    );
    expect(await asks(c, clientId)).toEqual({ pending: 0, recorded: 0 });
    await voidIt(c);
  });
});

describe("A1: a statement line's number is never NULL", () => {
  it("a confirmed payment without a reference or an advance invoice reads '' as its number", async () => {
    const owner = await mkMember("owner");
    const clientId = await mkClientRow();
    const p = await pay(clientId, owner, { ref: null, amount: 700 });
    const row = await first<{ number: string | null; kind: string }>(
      `SELECT u.number, u.kind FROM (${STATEMENT_PAGE_SQL(false)}) u WHERE u.id = ?7`,
      clientId,
      "INR",
      "2026-04-01",
      "2027-03-31",
      null,
      null,
      p,
    );
    expect(row).toEqual({ number: "", kind: "receipt" });
  });
});

describe("A3: the register rows carry an export's extension, twin of femaDueSql", () => {
  it("extended_to is the latest extension, and core's dates with it equal the SQL's", async () => {
    const { id: doc } = await usdExport();
    const owner = await mkMember("owner");
    for (const day of ["2027-09-30", "2027-12-31"])
      await run(
        "INSERT INTO realisation_extensions (id, document_id, extended_to, bank_ref, recorded_by, created_at) VALUES (?1, ?2, ?3, 'BANK-1', ?4, ?5)",
        uuidv7(),
        doc,
        day,
        owner,
        T,
      );
    const row = await first<{ extended_to: string | null; issue_date: string }>(
      `SELECT r.extended_to, r.issue_date FROM (${REALISATION_PAGE_SQL("all", false)}) r WHERE r.id = ?3`,
      null,
      null,
      doc,
    );
    expect(row?.extended_to).toBe("2027-12-31");
    const sql = await first<{ fema: string; gst: string }>(
      `SELECT ${femaDueSql("d", SCAN_BINDS)} AS fema, ${gstDueSql("d", SCAN_BINDS)} AS gst FROM documents d WHERE d.id = ?7`,
      "2026-10-31",
      DEFAULT_REALISATION_RULES.femaMonthsForeign,
      DEFAULT_REALISATION_RULES.femaMonthsInr,
      DEFAULT_REALISATION_RULES.gstMonths,
      DEFAULT_REALISATION_RULES.gstExtraDays,
      DEFAULT_REALISATION_RULES.approachingDays,
      doc,
    );
    const core = realisationDates({
      invoiceDate: parseIsoDate(row?.issue_date ?? "") as NonNullable<ReturnType<typeof parseIsoDate>>,
      currency: "USD",
      supplyType: "export_lut",
      extendedTo: parseIsoDate(row?.extended_to ?? "") ?? undefined,
    });
    expect(core.ok).toBe(true);
    if (core.ok) {
      expect(toIsoDate(core.value.femaDue)).toBe(sql?.fema);
      expect(toIsoDate(core.value.gstDue)).toBe(sql?.gst);
    }
    // A tax invoice's register row has none (the column is only worked out for an export invoice).
    const tax = await mkIssued(await mkClientRow());
    const taxRow = await first<{ extended_to: string | null }>(
      `SELECT r.extended_to FROM (${REGISTER_PAGE_SQL(false)}) r WHERE r.id = ?3`,
      "2026-10-01",
      "2026-10-31",
      tax,
    );
    expect(taxRow).toEqual({ extended_to: null });
  });
});

describe("A5, A6, A8", () => {
  it("A5: the bank's letter needs a live client", async () => {
    const owner = await mkMember("owner");
    const s = await session(owner);
    const { id: doc, clientId } = await usdExport();
    const ext = uuidv7();
    await run(
      "INSERT INTO realisation_extensions (id, document_id, extended_to, bank_ref, recorded_by, created_at) VALUES (?1, ?2, '2027-12-31', 'BANK-2', ?3, ?4)",
      ext,
      doc,
      owner,
      T,
    );
    await run("UPDATE clients SET anonymised_at = 1 WHERE id = ?", clientId);
    const r = await extensionLetterStatement(env.DB, {
      id: ext,
      documentId: doc,
      r2Key: `extensions/${ext}/letter-${"a".repeat(64)}`,
      sha256: "a".repeat(64),
      mime: "application/pdf",
      sessionId: s,
      now: Date.now(),
    }).run();
    expect(r.meta.changes).toBe(0);
  });

  it("A6: an Owner's session never records a pending entry; a Staff member's does", async () => {
    const owner = await mkMember("owner");
    const staff = await mkMember("staff");
    const clientId = await mkClientRow();
    const base = {
      clientId,
      kind: "payment" as const,
      status: "pending_verification" as const,
      currency: "INR" as const,
      amountMinor: 100,
      chargesMinor: 0,
      receivedOn: "2026-10-28",
      mode: "neft",
      referenceNorm: null,
      inrReceivedMinor: null,
      requestedAllocations: null,
      tds: null,
      note: null,
      now: Date.now(),
      confirmDuplicate: false,
    };
    const byOwner = await recordPaymentStatement(env.DB, {
      ...base,
      id: uuidv7(),
      recordedBy: owner,
      sessionId: await session(owner),
    }).run();
    expect(byOwner.meta.changes).toBe(0);
    const byStaff = await recordPaymentStatement(env.DB, {
      ...base,
      id: uuidv7(),
      recordedBy: staff,
      sessionId: await session(staff, false),
    }).run();
    expect(byStaff.meta.changes).toBe(1);
  });

  it("A8: the post-condition covers every payment listed: a partly allocated TDS entry among them aborts it", async () => {
    const owner = await mkMember("owner");
    const clientId = await mkClientRow();
    await run("UPDATE clients SET country = 'IN', gst_status = 'unregistered' WHERE id = ?", clientId);
    const inv = await mkIssued(clientId);
    const p1 = await pay(clientId, owner, { amount: 1_000 });
    await alloc(p1, inv, 1_000);
    const t = uuidv7();
    await run(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, tds_section, tds_rate_bp, recorded_by, recorded_at, verified_by, verified_at)
       VALUES (?1, ?2, 'tds', 'manual', 'confirmed', 'INR', 500, '2026-10-28', 'as advised', 1000, ?3, ?4, ?3, ?4)`,
      t,
      clientId,
      owner,
      T,
    );
    await alloc(t, inv, 300); // not the whole TDS amount
    await recomputeStatement(env.DB, { paymentIds: [p1, t] }, Date.now()).run();
    await ledgerResultStatement(env.DB, { paymentIds: [p1] }).run();
    await rejects(ledgerResultStatement(env.DB, { paymentIds: [p1, t] }).run(), /ledger_result_check/);
  });
});

describe("early check 2 (stage B2): the void fragment as a builder, and the erase of a payment's free text", () => {
  it("finding 10: paymentBlocksVoidSql runs on its own, for a document and its client as SQL expressions, and agrees with the facts read", async () => {
    const owner = await mkMember("owner");
    const staff = await mkMember("staff");
    const clientId = await mkClientRow();
    const free = await mkIssued(clientId);
    const held = await mkIssued(clientId);
    const asked = await mkIssued(clientId);
    const p = await pay(clientId, owner, { amount: 100 });
    await alloc(p, held, 100);
    await pay(clientId, staff, {
      status: "pending_verification",
      amount: 100,
      requested: JSON.stringify([{ documentId: asked, amountMinor: 100 }]),
    });
    const blocks = async (doc: string) =>
      await first<{ b: number; recorded: number; pending: number }>(
        `SELECT ${paymentBlocksVoidSql("d.id", "d.client_id")} AS b, ${paymentRecordedSql("d.id")} AS recorded, ${paymentPendingForSql("d.id", "d.client_id")} AS pending FROM documents d WHERE d.id = ?1`,
        doc,
      );
    expect(await blocks(free)).toEqual({ b: 0, recorded: 0, pending: 0 });
    expect(await blocks(held)).toEqual({ b: 1, recorded: 1, pending: 0 });
    expect(await blocks(asked)).toEqual({ b: 1, recorded: 0, pending: 1 });
    // as the void statement uses it: the row it updates, `documents.id` / `documents.client_id`
    const voidStmt = (doc: string) =>
      run(
        `UPDATE documents SET status = 'void', voided_at = 1, void_reason = 'x' WHERE id = ?1 AND NOT ${paymentBlocksVoidSql("documents.id", "documents.client_id")}`,
        doc,
      );
    for (const doc of [held, asked]) {
      await voidStmt(doc);
      expect(
        (await first<{ status: string }>("SELECT status FROM documents WHERE id = ?", doc))?.status,
      ).toBe("issued");
    }
    await voidStmt(free);
    expect((await first<{ status: string }>("SELECT status FROM documents WHERE id = ?", free))?.status).toBe(
      "void",
    );
    // the facts read gives the same two answers apart (L32)
    expect(await asks(held, clientId)).toEqual({ pending: 0, recorded: 1 });
    expect(await asks(asked, clientId)).toEqual({ pending: 1, recorded: 0 });
  });

  it("finding 4: note, decision_note and withdraw_reason become NULL only once the client is anonymised; nothing else changes then either", async () => {
    const owner = await mkMember("owner");
    const clientId = await mkClientRow();
    const p = await pay(clientId, owner, { amount: 700, ref: "UTRERASE1" });
    await rejects(run("UPDATE payments SET note = 'typed later' WHERE id = ?", p), /payments_fixed/);
    const noted = uuidv7();
    await run(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, reference_norm, note, recorded_by, recorded_at, verified_by, verified_at)
       VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'INR', 300, '2026-10-28', 'neft', 'UTRERASE2', 'paid by a named relative', ?3, ?4, ?3, ?4)`,
      noted,
      clientId,
      owner,
      T,
    );
    await run(
      "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = 2, withdraw_reason = 'entered for the wrong person' WHERE id = ?1",
      p,
      owner,
    );
    // a live client: the free text is frozen like everything else
    await rejects(run("UPDATE payments SET withdraw_reason = NULL WHERE id = ?", p), /payments_status_flow/);
    await rejects(run("UPDATE payments SET note = NULL WHERE id = ?", noted), /payments_fixed/);
    await run("UPDATE clients SET anonymised_at = 5 WHERE id = ?", clientId);
    // anonymised: only to NULL, never to other words, never with a status move, and money and references stay frozen
    await rejects(
      run("UPDATE payments SET withdraw_reason = 'other words' WHERE id = ?", p),
      /payments_status_flow/,
    );
    await rejects(run("UPDATE payments SET note = 'other words' WHERE id = ?", p), /payments_fixed/);
    await rejects(run("UPDATE payments SET amount_minor = 1 WHERE id = ?", p), /payments_fixed/);
    await rejects(run("UPDATE payments SET reference_norm = NULL WHERE id = ?", p), /payments_fixed/);
    await run(
      "UPDATE payments SET note = NULL, decision_note = NULL, withdraw_reason = NULL WHERE id = ?",
      p,
    );
    await run("UPDATE payments SET note = NULL WHERE id = ?", noted);
    expect(await first("SELECT note, amount_minor FROM payments WHERE id = ?", noted)).toEqual({
      note: null,
      amount_minor: 300,
    });
    expect(
      await first(
        "SELECT status, amount_minor, reference_norm, note, decision_note, withdraw_reason FROM payments WHERE id = ?",
        p,
      ),
    ).toEqual({
      status: "withdrawn",
      amount_minor: 700,
      reference_norm: "UTRERASE1",
      note: null,
      decision_note: null,
      withdraw_reason: null,
    });
  });
});
