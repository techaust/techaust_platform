// The ledger in the database (M6.1; ADM-PAY-05, ADM-PAY-06, ADM-INV-02, ADM-INV-09, ADM-INV-16, ADM-APR-01, Q60; run file A and F): migrations 0056 and 0057,
// every trigger bound and status move, the post-condition, the back-fill, the twins of core (the status CASE, the FEMA date with an extension, the statement's
// closing balance), the statement builders of `ledger.ts` and EXPLAIN plans for the new indexes. Raw SQL where a trigger is the subject; the real builders where
// a write path is. All names and amounts are invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { type CalendarDate, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { DEFAULT_REALISATION_RULES, realisationDates } from "@techaust/core/gst";
import { LEDGER_STATUSES, ledgerStatusOf, PAYABLE_TYPES } from "@techaust/core/ledger";
import { describe, expect, it } from "vitest";
import { REMINDER_CLAIM_SQL } from "../src/billing.ts";
import {
  allocationStatements,
  CLIENT_CREDIT_SQL,
  COLLECTED_SQL,
  CREDIT_SOURCES_SQL,
  creditClaimStatement,
  DOCUMENT_HOLDINGS_SQL,
  decideApprovalStatements,
  extensionLetterStatement,
  type GuardSql,
  LEDGER_STATUSES_SQL,
  ledgerResultStatement,
  ledgerStatusCaseSql,
  PAYABLE_TYPES_SQL,
  PAYMENT_ASKS_FOR_DOCUMENT_SQL,
  PAYMENT_REFERENCE_SEEN_SQL,
  PENDING_PAYMENTS_COUNT_SQL,
  PENDING_PAYMENTS_SQL,
  paymentApprovalStatements,
  proofStatement,
  type RecordPaymentArgs,
  realisationExtensionStatement,
  recomputeStatement,
  recordPaymentStatement,
  tdsCertificateStatement,
  verifyPaymentStatement,
  withdrawPaymentStatement,
} from "../src/ledger.ts";
import { femaDueSql, gstDueSql, SCAN_BINDS } from "../src/realisation.ts";
import {
  CLIENT_FIGURES_SQL,
  PAYMENTS_REGISTER_SQL,
  PROJECT_BILLED_SQL,
  STATEMENT_LEDGER_SQL,
  STATEMENT_TOTALS_SQL,
  statementTotalsBinds,
} from "../src/reports.ts";
import {
  ALLOCATION_KINDS,
  PAYMENT_KINDS,
  PAYMENT_MODES,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  PROOF_MIME_TYPES,
} from "../src/schema/payments.ts";
import {
  MUTABLE_AFTER_FREEZE,
  PAYMENT_KINDS_0057,
  PAYMENT_MODES_0057,
  PAYMENT_PROVIDERS_0057,
  PAYMENT_STATUSES_0057,
  PROOF_MIME_TYPES_0057,
  paymentTriggerStatements,
} from "../src/triggers.ts";
import { mkClientRow, mkContact, mkIssued, mkMember, mkReminder, mkSend, next } from "./billing-helpers.ts";
import { all, first, insertDraftInvoice, rejects, run } from "./helpers.ts";

const db = () => env.DB;
const T = 1_800_000_000_000; // a fixed instant for rows written here

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

type PayOver = Partial<{
  id: string;
  kind: string;
  provider: string;
  status: string;
  currency: string;
  amount: number;
  mode: string | null;
  ref: string | null;
  requested: string | null;
  tdsSection: string | null;
  tdsRate: number | null;
  receivedOn: string;
  verifiedBy: string | null;
}>;

/** A payment row written straight in (confirmed by `owner` unless the status says otherwise). */
async function pay(clientId: string, owner: string, o: PayOver = {}): Promise<string> {
  const id = o.id ?? uuidv7();
  const status = o.status ?? "confirmed";
  const kind = o.kind ?? "payment";
  await run(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, reference_norm, requested_allocations, tds_section, tds_rate_bp,
       recorded_by, recorded_at, verified_by, verified_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`,
    id,
    clientId,
    kind,
    o.provider ?? "manual",
    status,
    o.currency ?? "INR",
    o.amount ?? 50_000,
    o.receivedOn ?? "2026-10-28",
    o.mode === undefined ? (kind === "tds" ? null : "neft") : o.mode,
    o.ref ?? null,
    o.requested ?? null,
    o.tdsSection ?? (kind === "tds" ? "as advised" : null),
    o.tdsRate ?? (kind === "tds" ? 1000 : null),
    owner,
    T,
    status === "confirmed" ? (o.verifiedBy === undefined ? owner : o.verifiedBy) : null,
    status === "confirmed" ? T : null,
  );
  return id;
}

const alloc = (
  paymentId: string,
  documentId: string,
  amount: number,
  kind: "allocate" | "release" = "allocate",
) =>
  run(
    "INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    uuidv7(),
    paymentId,
    documentId,
    amount,
    kind,
    T,
  );
const recompute = (t: { paymentIds?: string[]; documentIds?: string[] }) =>
  recomputeStatement(db(), t, Date.now()).run();
const result = (t: { paymentIds?: string[]; documentIds?: string[] }) => ledgerResultStatement(db(), t).run();
const docRow = (id: string) =>
  first<{
    status: string;
    paid_minor: number;
    tds_minor: number;
    balance_minor: number;
    credited_minor: number;
    updated_at: number;
  }>(
    "SELECT status, paid_minor, tds_minor, balance_minor, credited_minor, updated_at FROM documents WHERE id = ?",
    id,
  );

async function setup() {
  const owner = await mkMember("owner");
  const clientId = await mkClientRow();
  const inv = await mkIssued(clientId);
  return { owner, clientId, inv };
}

// ---- migrations --------------------------------------------------------------------------------------------------------------------------------------

describe("0056 and 0057: no rebuild, the pinned lists, the freeze coverage [run file A]", () => {
  it("0056 only creates tables and indexes and adds a column: no DROP, no copy, no rebuild", () => {
    const m = env.TEST_MIGRATIONS.find((x) => x.name === "0056_payments.sql");
    expect(m).toBeDefined();
    for (const q of (m?.queries ?? []).map((x) => x.replace(/^(\s|--> statement-breakpoint)+/, "")))
      expect(q.trim(), q.slice(0, 60)).toMatch(
        /^(CREATE TABLE|CREATE INDEX|CREATE UNIQUE INDEX|ALTER TABLE `documents` ADD `tds_minor`)/,
      );
    const all0056 = (m?.queries ?? []).join("\n");
    expect(all0056).not.toMatch(/DROP TABLE|__new_|INSERT INTO/);
  });

  it("the trigger lists of 0057 are the schema's lists today, and tds_minor is a ledger column that may change after the freeze", () => {
    expect(PAYMENT_KINDS_0057).toEqual(PAYMENT_KINDS);
    expect(PAYMENT_PROVIDERS_0057).toEqual(PAYMENT_PROVIDERS);
    expect(PAYMENT_STATUSES_0057).toEqual(PAYMENT_STATUSES);
    expect(PAYMENT_MODES_0057).toEqual(PAYMENT_MODES);
    expect(PROOF_MIME_TYPES_0057).toEqual(PROOF_MIME_TYPES);
    expect(ALLOCATION_KINDS).toEqual(["allocate", "release"]);
    expect(MUTABLE_AFTER_FREEZE).toContain("tds_minor");
    expect(PAYABLE_TYPES_SQL).toBe(`(${PAYABLE_TYPES.map((t) => `'${t}'`).join(", ")})`);
    expect(LEDGER_STATUSES_SQL).toBe(`(${LEDGER_STATUSES.map((t) => `'${t}'`).join(", ")})`);
  });

  it("the installed freeze trigger leaves tds_minor writable on an issued document (the identity holds it instead)", async () => {
    const t = await first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'documents_frozen_update'",
    );
    expect(t?.sql).not.toContain("tds_minor");
    const id = await first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'documents_ledger_identity'",
    );
    expect(id?.sql).toContain("NEW.tds_minor");
  });
});

// ---- payments ---------------------------------------------------------------------------------------------------------------------------------------

describe("payments: values, insert state, TDS rules, frozen columns, status moves [ADM-PAY-05, L3, L7, L8]", () => {
  it("the enumerations are held by triggers (no CHECK): an unknown kind, provider, status, mode or proof type is refused", async () => {
    const { owner, clientId } = await setup();
    for (const bad of [{ kind: "gift" }, { provider: "stripe" }, { mode: "cash" }])
      await rejects(pay(clientId, owner, bad), /payments_values_insert/);
    // an unknown status: the insert-state rule (it fires first) or the value rule refuses it
    await rejects(pay(clientId, owner, { status: "lost" }), /payments_values_insert|payments_insert_state/);
    const p = await pay(clientId, owner);
    await rejects(
      run("UPDATE payments SET proof_mime = 'text/html' WHERE id = ?", p),
      /payments_values_update|payments_fixed/,
    );
  });

  it("starts pending with no decision, or confirmed by an active Owner who recorded it; never withdrawn; Staff cannot insert a confirmed row", async () => {
    const { owner, clientId } = await setup();
    const staff = await mkMember("staff");
    await pay(clientId, staff, { status: "pending_verification" });
    await rejects(pay(clientId, staff), /payments_insert_state/);
    await rejects(pay(clientId, owner, { status: "withdrawn" }), /payments_insert_state/);
    await rejects(pay(clientId, owner, { status: "rejected" }), /payments_insert_state/);
    const other = await mkMember("owner");
    await rejects(pay(clientId, owner, { verifiedBy: other }), /payments_insert_state/);
  });

  it("a TDS row has a section, a rate of 1 to 10000 bp, no mode, INR, a client in India; a payment row has no TDS fields", async () => {
    const { owner, clientId } = await setup();
    await pay(clientId, owner, { kind: "tds" });
    await rejects(pay(clientId, owner, { kind: "tds", mode: "neft" }), /payments_tds_rules/);
    await rejects(pay(clientId, owner, { kind: "tds", tdsRate: 0 }), /payments_tds_rules/);
    await rejects(pay(clientId, owner, { kind: "tds", tdsRate: 10_001 }), /payments_tds_rules/);
    await rejects(pay(clientId, owner, { kind: "tds", tdsSection: " " }), /payments_tds_rules/);
    await rejects(pay(clientId, owner, { tdsSection: "x" }), /payments_tds_rules/);
    const usd = await mkClientRow({ currency: "USD" });
    await rejects(pay(usd, owner, { kind: "tds", currency: "USD" }), /payments_tds_rules/);
  });

  it("everything is frozen; the proof, the TDS certificate and the advance receipt are set once; no delete", async () => {
    const { owner, clientId } = await setup();
    const p = await pay(clientId, owner);
    await rejects(run("UPDATE payments SET amount_minor = 1 WHERE id = ?", p), /payments_fixed/);
    await rejects(run("UPDATE payments SET received_on = '2026-10-01' WHERE id = ?", p), /payments_fixed/);
    await run(
      "UPDATE payments SET proof_kind = 'FIRC', proof_r2_key = 'k', proof_sha256 = 's', proof_mime = 'application/pdf' WHERE id = ?",
      p,
    );
    await rejects(run("UPDATE payments SET proof_r2_key = 'k2' WHERE id = ?", p), /payments_fixed/);
    await rejects(run("UPDATE payments SET tds_certificate_no = 'X' WHERE id = ?", p), /payments_fixed/);
    const t = await pay(clientId, owner, { kind: "tds" });
    await run(
      "UPDATE payments SET tds_certificate_no = 'C1', tds_certificate_on = '2026-11-01' WHERE id = ?",
      t,
    );
    await rejects(run("UPDATE payments SET tds_certificate_no = 'C2' WHERE id = ?", t), /payments_fixed/);
    await rejects(
      run("UPDATE payments SET advance_receipt_id = NULL, note = 'x' WHERE id = ?", p),
      /payments_fixed/,
    );
    await rejects(run("DELETE FROM payments WHERE id = ?", p), /payments_no_delete/);
  });

  it("pending moves once to confirmed or rejected by an active Owner; confirmed once to withdrawn by an Owner with a reason (core canMovePayment)", async () => {
    const { owner, clientId } = await setup();
    const staff = await mkMember("staff");
    const p = await pay(clientId, staff, { status: "pending_verification" });
    await rejects(
      run(
        "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = 1 WHERE id = ?1",
        p,
        staff,
      ),
      /payments_status_flow/,
    );
    await rejects(
      run("UPDATE payments SET status = 'confirmed', verified_by = ?2 WHERE id = ?1", p, owner),
      /payments_status_flow/,
    );
    await rejects(run("UPDATE payments SET status = 'withdrawn' WHERE id = ?", p), /payments_status_flow/);
    await rejects(run("UPDATE payments SET decision_note = 'x' WHERE id = ?", p), /payments_status_flow/);
    await run(
      "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = 1 WHERE id = ?1",
      p,
      owner,
    );
    await rejects(
      run("UPDATE payments SET status = 'rejected', verified_at = 2 WHERE id = ?", p),
      /payments_status_flow/,
    );
    await rejects(
      run(
        "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = 3 WHERE id = ?1",
        p,
        owner,
      ),
      /payments_status_flow/,
    );
    await rejects(
      run(
        "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = 3, withdraw_reason = 'x' WHERE id = ?1",
        p,
        staff,
      ),
      /payments_status_flow/,
    );
    await run(
      "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = 3, withdraw_reason = 'Entered twice' WHERE id = ?1",
      p,
      owner,
    );
    await rejects(run("UPDATE payments SET status = 'confirmed' WHERE id = ?", p), /payments_status_flow/);
    const r = await pay(clientId, staff, { status: "pending_verification" });
    await run(
      "UPDATE payments SET status = 'rejected', verified_by = ?2, verified_at = 1 WHERE id = ?1",
      r,
      owner,
    );
    await rejects(
      run("UPDATE payments SET status = 'confirmed', verified_at = 2 WHERE id = ?", r),
      /payments_status_flow/,
    );
  });
});

// ---- allocations -------------------------------------------------------------------------------------------------------------------------------------

describe("payment_allocations: append-only and every bound [ADM-PAY-06, L5, L6, L8]", () => {
  it("append-only, two kinds only", async () => {
    const { owner, clientId, inv } = await setup();
    const p = await pay(clientId, owner);
    await alloc(p, inv, 100);
    await rejects(
      run("UPDATE payment_allocations SET amount_minor = 1 WHERE payment_id = ?", p),
      /payment_allocations_no_update/,
    );
    await rejects(
      run("DELETE FROM payment_allocations WHERE payment_id = ?", p),
      /payment_allocations_no_delete/,
    );
    await rejects(
      run(
        "INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind) VALUES (?1, ?2, ?3, 1, 'refund')",
        uuidv7(),
        p,
        inv,
      ),
      /payment_allocations_kind|payment_allocations_bounds/,
    );
  });

  it("only a confirmed payment, onto a frozen, live tax invoice, export invoice or debit note of its client and currency", async () => {
    const { owner, clientId, inv } = await setup();
    const staff = await mkMember("staff");
    const pending = await pay(clientId, staff, { status: "pending_verification" });
    await rejects(alloc(pending, inv, 1), /payment_allocations_bounds/);
    const p = await pay(clientId, owner);
    const otherClient = await mkClientRow();
    await rejects(alloc(p, await mkIssued(otherClient), 1), /payment_allocations_bounds/);
    for (const type of ["proforma", "credit_note"])
      await rejects(
        alloc(p, await mkIssued(clientId, type === "credit_note" ? { type, parentId: inv } : { type }), 1),
        /payment_allocations_bounds/,
      );
    await rejects(alloc(p, await mkIssued(clientId, { status: "void" }), 1), /payment_allocations_bounds/);
    await rejects(alloc(p, await insertDraftInvoice(clientId), 1), /payment_allocations_bounds/);
    await alloc(p, await mkIssued(clientId, { type: "debit_note", parentId: inv }), 1);
    await alloc(p, inv, 1);
  });

  it("allocate: at most the balance (live, from the rows: two rows in one batch cannot both take it) and never more than the payment", async () => {
    const { owner, clientId, inv } = await setup(); // total 118000
    const big = await pay(clientId, owner, { amount: 200_000 });
    await rejects(alloc(big, inv, 118_001), /payment_allocations_bounds/);
    await rejects(
      db().batch([
        ...allocationStatements(
          db(),
          [
            { id: uuidv7(), paymentId: big, documentId: inv, amountMinor: 100_000, kind: "allocate" },
            { id: uuidv7(), paymentId: big, documentId: inv, amountMinor: 18_001, kind: "allocate" },
          ],
          owner,
          T,
        ),
      ]),
      /payment_allocations_bounds/,
    );
    expect(await all("SELECT id FROM payment_allocations WHERE payment_id = ?", big)).toHaveLength(0);
    const small = await pay(clientId, owner, { amount: 1_000 });
    await rejects(alloc(small, inv, 1_001), /payment_allocations_bounds/);
    await alloc(small, inv, 600);
    await rejects(alloc(small, await mkIssued(clientId), 401), /payment_allocations_bounds/);
    // a credited invoice has less to pay
    const credited = await mkIssued(clientId);
    await run(
      "UPDATE documents SET credited_minor = 18000, balance_minor = 100000, status = 'partially_credited' WHERE id = ?",
      credited,
    );
    await rejects(alloc(big, credited, 100_001), /payment_allocations_bounds/);
  });

  it("release: at most the excess on the document and what this payment holds there; a TDS row never releases", async () => {
    const { owner, clientId, inv } = await setup();
    const p = await pay(clientId, owner, { amount: 118_000 });
    await alloc(p, inv, 118_000);
    await recompute({ documentIds: [inv] });
    await rejects(alloc(p, inv, 1, "release"), /payment_allocations_bounds/); // no excess yet
    // a credit note of 18000 lands later: 18000 of excess
    await run("UPDATE documents SET credited_minor = 18000 WHERE id = ?", inv);
    await rejects(alloc(p, inv, 18_001, "release"), /payment_allocations_bounds/);
    const q = await pay(clientId, owner, { amount: 5 });
    await rejects(alloc(q, inv, 5, "release"), /payment_allocations_bounds/); // q holds nothing there
    await alloc(p, inv, 18_000, "release");
    const t = await pay(clientId, owner, { kind: "tds", amount: 10 });
    await rejects(alloc(t, inv, 10, "release"), /payment_allocations_bounds/);
  });

  it("TDS only onto an INR tax invoice or debit note (L8; an export invoice is an overseas client's, which a TDS row can never be)", async () => {
    const owner = await mkMember("owner");
    const inr = await mkClientRow();
    const t = await pay(inr, owner, { kind: "tds", amount: 100 });
    await rejects(alloc(t, await mkIssued(inr, { type: "proforma" }), 100), /payment_allocations_bounds/);
    await alloc(t, await mkIssued(inr, { type: "debit_note", parentId: await mkIssued(inr) }), 100);
    // the trigger's own clause: a TDS row onto an export invoice is refused even if the rows were made to agree (the client test is the tds rule's)
    const sql = paymentTriggerStatements().find((x) => x.includes("payment_allocations_bounds")) ?? "";
    expect(sql).toContain(
      "p.kind = 'tds' AND NEW.kind = 'allocate' AND d.type IN ('tax_invoice', 'debit_note') AND d.currency = 'INR'",
    );
  });
});

// ---- the documents' triggers ---------------------------------------------------------------------------------------------------------------------------

describe("the ledger identity with TDS, the TDS bounds, and no void with a payment [ADM-INV-02, ADM-INV-16, L17]", () => {
  it("balance = max(0, total - paid - credited - tds), and nothing paid or deducted is negative", async () => {
    const { clientId, inv } = await setup();
    await run(
      "UPDATE documents SET tds_minor = 18000, balance_minor = 100000, status = 'partially_paid' WHERE id = ?",
      inv,
    );
    await rejects(
      run("UPDATE documents SET tds_minor = 1000 WHERE id = ?", inv),
      /documents_ledger_identity/,
    );
    await rejects(
      run("UPDATE documents SET tds_minor = -1, balance_minor = 118001 WHERE id = ?", inv),
      /documents_ledger_identity|documents_tds_bounds_update/,
    );
    await run(
      "UPDATE documents SET paid_minor = 100000, balance_minor = 0, status = 'paid' WHERE id = ?",
      inv,
    );
    const exp = await mkIssued(clientId, { type: "debit_note", parentId: inv });
    await run("UPDATE documents SET tds_minor = 100, balance_minor = 117900 WHERE id = ?", exp);
  });

  it("TDS only on an INR tax invoice or debit note", async () => {
    const { clientId } = await setup();
    const pro = await mkIssued(clientId, { type: "proforma" });
    await rejects(
      run("UPDATE documents SET tds_minor = 1, balance_minor = 117999 WHERE id = ?", pro),
      /documents_tds_bounds_update/,
    );
    const cn = await mkIssued(clientId, { type: "credit_note", parentId: await mkIssued(clientId) });
    await rejects(run("UPDATE documents SET tds_minor = 1 WHERE id = ?", cn), /documents_tds_bounds_update/);
    await rejects(
      run(
        "INSERT INTO documents (id, type, client_id, currency, tds_minor) VALUES (?1, 'proforma', ?2, 'INR', 5)",
        uuidv7(),
        clientId,
      ),
      /documents_tds_bounds_insert/,
    );
  });

  it("void is refused with TDS, with an allocation (even one released since) and while a pending payment asks for the document", async () => {
    const { owner, clientId } = await setup();
    const voidIt = (id: string) =>
      run("UPDATE documents SET status = 'void', voided_at = 1, void_reason = 'x' WHERE id = ?", id);
    const a = await mkIssued(clientId);
    await run("UPDATE documents SET tds_minor = 10, balance_minor = 117990 WHERE id = ?", a);
    await rejects(voidIt(a), /documents_void_no_payment/);
    const b = await mkIssued(clientId);
    const p = await pay(clientId, owner, { amount: 100 });
    await alloc(p, b, 100); // a row, the stored paid still 0: the allocation alone refuses the void
    await rejects(voidIt(b), /documents_void_no_payment/);
    const c = await mkIssued(clientId);
    const staff = await mkMember("staff");
    const asked = await pay(clientId, staff, {
      status: "pending_verification",
      requested: JSON.stringify([{ documentId: c, amountMinor: 100 }]),
    });
    await rejects(voidIt(c), /documents_void_no_payment/);
    expect(await first(PAYMENT_ASKS_FOR_DOCUMENT_SQL, c, clientId)).toEqual({ pending: 1, recorded: 0 });
    expect(await first(PAYMENT_ASKS_FOR_DOCUMENT_SQL, b, clientId)).toEqual({ pending: 0, recorded: 1 });
    await run(
      "UPDATE payments SET status = 'rejected', verified_by = ?2, verified_at = 1 WHERE id = ?1",
      asked,
      owner,
    );
    expect(await first(PAYMENT_ASKS_FOR_DOCUMENT_SQL, c, clientId)).toEqual({ pending: 0, recorded: 0 });
    await voidIt(c);
  });

  it("a payment_verify approval names a pending payment and no document; its payment never changes", async () => {
    const { owner, clientId, inv } = await setup();
    const staff = await mkMember("staff");
    const p = await pay(clientId, staff, { status: "pending_verification" });
    const ins = (payment: string | null, doc: string | null) =>
      run(
        "INSERT INTO approvals (id, kind, document_id, payment_id, requested_by, content_sha256) VALUES (?1, 'payment_verify', ?2, ?3, ?4, 'h')",
        uuidv7(),
        doc,
        payment,
        staff,
      );
    await rejects(ins(p, inv), /approvals_payment_verify_insert/);
    await rejects(ins(null, null), /approvals_payment_verify_insert/);
    await rejects(ins(await pay(clientId, owner), null), /approvals_payment_verify_insert/);
    await ins(p, null);
    await rejects(ins(p, null), /UNIQUE constraint failed: approvals\.payment_id/);
    await rejects(
      run("UPDATE approvals SET payment_id = 'x' WHERE payment_id = ?", p),
      /approvals_payment_fixed/,
    );
  });
});

// ---- the post-condition and the recompute -----------------------------------------------------------------------------------------------------------

describe("the recompute and ledger_result [run file A.5, A.6]", () => {
  it("the recompute writes paid, TDS, balance and status from the rows; ledger_result passes", async () => {
    const { owner, clientId, inv } = await setup();
    const p = await pay(clientId, owner, { amount: 100_000 });
    const t = await pay(clientId, owner, { kind: "tds", amount: 18_000 });
    await alloc(p, inv, 100_000);
    await alloc(t, inv, 18_000);
    const before = await docRow(inv);
    await recompute({ paymentIds: [p], documentIds: [inv] });
    const after = await docRow(inv);
    expect(after).toMatchObject({ status: "paid", paid_minor: 100_000, tds_minor: 18_000, balance_minor: 0 });
    expect(after?.updated_at).toBeGreaterThan(before?.updated_at ?? 0);
    await result({ paymentIds: [t], documentIds: [inv] });
    // a withdrawn payment no longer counts
    await run(
      "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = 1, withdraw_reason = 'x' WHERE id = ?1",
      p,
      owner,
    );
    await recompute({ paymentIds: [p] });
    expect(await docRow(inv)).toMatchObject({
      status: "partially_paid",
      paid_minor: 0,
      tds_minor: 18_000,
      balance_minor: 100_000,
    });
    await result({ paymentIds: [p] });
  });

  it("aborts on a drifted ledger (rows written, no recompute) and on a partial TDS allocation", async () => {
    const { owner, clientId, inv } = await setup();
    const p = await pay(clientId, owner, { amount: 1_000 });
    await alloc(p, inv, 1_000);
    await rejects(result({ paymentIds: [p] }), /ledger_result_check/);
    await rejects(result({ documentIds: [inv] }), /ledger_result_check/);
    await recompute({ paymentIds: [p] });
    await result({ paymentIds: [p] });
    const t = await pay(clientId, owner, { kind: "tds", amount: 100 });
    await alloc(t, inv, 50);
    await recompute({ documentIds: [inv] });
    await rejects(result({ paymentIds: [t] }), /ledger_result_check/);
    await alloc(t, inv, 50);
    await recompute({ documentIds: [inv] });
    await rejects(result({ paymentIds: [t] }), /ledger_result_check/); // two rows: not "exactly once"
  });

  it("a batch that ends in ledger_result rolls back as a whole", async () => {
    const { owner, clientId, inv } = await setup();
    const p = await pay(clientId, owner, { amount: 1_000 });
    await rejects(
      db().batch([
        ...allocationStatements(
          db(),
          [{ id: uuidv7(), paymentId: p, documentId: inv, amountMinor: 1_000, kind: "allocate" }],
          owner,
          T,
        ),
        ledgerResultStatement(db(), { paymentIds: [p] }),
      ]),
      /ledger_result_check/,
    );
    expect(await all("SELECT id FROM payment_allocations WHERE payment_id = ?", p)).toHaveLength(0);
  });

  it("the status CASE is core ledgerStatusOf, over a table of figures (the twin)", async () => {
    const figures: [number, number, number, number][] = [];
    for (const total of [0, 1, 1000])
      for (const paid of [0, 1, 500, 999, 1000, 1500])
        for (const credited of [0, 1, 500, 1000, 1200])
          for (const tds of [0, 1, 100, 1000]) figures.push([total, paid, credited, tds]);
    const rows = await all<{ i: number; s: string }>(
      `SELECT j.key AS i, ${ledgerStatusCaseSql("json_extract(j.value, '$[0]')", "(json_extract(j.value, '$[1]') + json_extract(j.value, '$[3]'))", "json_extract(j.value, '$[2]')")} AS s FROM json_each(?1) j`,
      JSON.stringify(figures),
    );
    for (const r of rows) {
      const [total, paid, credited, tds] = figures[r.i] as [number, number, number, number];
      expect(r.s, `${total}/${paid}/${credited}/${tds}`).toBe(ledgerStatusOf(total, paid, credited, tds));
    }
    expect(rows).toHaveLength(figures.length);
  });

  it("the credit-note recompute subtracts TDS: an invoice with TDS stays consistent when a credit note lands", async () => {
    const { owner, clientId, inv } = await setup();
    const t = await pay(clientId, owner, { kind: "tds", amount: 18_000 });
    await alloc(t, inv, 18_000);
    await recompute({ documentIds: [inv] });
    expect(await docRow(inv)).toMatchObject({ balance_minor: 100_000, status: "partially_paid" });
  });
});

// ---- the back-fill ----------------------------------------------------------------------------------------------------------------------------------

describe("the back-fill of the advance receipts (L4, 0057 step 0)", () => {
  it("one confirmed payment and one allocation per receipt; the recompute leaves the advance invoice's paid amount unchanged; running it again adds nothing", async () => {
    const owner = await mkMember("owner");
    const clientId = await mkClientRow();
    const pro = await mkIssued(clientId, { type: "proforma" });
    const inv = await mkIssued(clientId, { parentId: pro });
    // the advance invoice as M5.2 left it: paid in full, balance 0
    await run(
      "UPDATE documents SET paid_minor = total_minor, balance_minor = 0, status = 'paid' WHERE id = ?",
      inv,
    );
    const rid = uuidv7();
    await run(
      "INSERT INTO advance_receipts (id, proforma_id, invoice_id, client_id, currency, amount_minor, received_on, reference_norm, created_by, created_at) VALUES (?1, ?2, ?3, ?4, 'INR', 118000, '2026-10-20', ?5, ?6, ?7)",
      rid,
      pro,
      inv,
      clientId,
      `UTR-BF-${next()}`,
      owner,
      T,
    );
    const [fillPayments, fillAllocations] = paymentTriggerStatements() as [string, string];
    expect(fillPayments).toMatch(/^INSERT INTO payments/);
    expect(fillAllocations).toMatch(/^INSERT INTO payment_allocations/);
    await run(fillPayments);
    await run(fillAllocations);
    const p = await first<Record<string, unknown>>(
      "SELECT * FROM payments WHERE advance_receipt_id = ?",
      rid,
    );
    expect(p).toMatchObject({
      id: `pay_${rid}`,
      client_id: clientId,
      kind: "payment",
      provider: "manual",
      status: "confirmed",
      amount_minor: 118_000,
      mode: null,
      received_on: "2026-10-20",
      recorded_by: owner,
      verified_by: owner,
    });
    expect(
      await all(
        "SELECT id, document_id, amount_minor, kind FROM payment_allocations WHERE payment_id = ?",
        `pay_${rid}`,
      ),
    ).toEqual([{ id: `pal_${rid}`, document_id: inv, amount_minor: 118_000, kind: "allocate" }]);
    const before = await docRow(inv);
    await recompute({ paymentIds: [`pay_${rid}`] });
    const after = await docRow(inv);
    expect(after).toMatchObject({
      paid_minor: before?.paid_minor,
      balance_minor: 0,
      status: "paid",
      tds_minor: 0,
    });
    await result({ paymentIds: [`pay_${rid}`] });
    await run(fillPayments);
    await run(fillAllocations);
    expect(await all("SELECT id FROM payments WHERE advance_receipt_id = ?", rid)).toHaveLength(1);
    expect(await all("SELECT id FROM payment_allocations WHERE payment_id = ?", `pay_${rid}`)).toHaveLength(
      1,
    );
  });
});

// ---- the statement builders -------------------------------------------------------------------------------------------------------------------------

const auditGuard = (auditId: string): GuardSql => ({
  sql: (at) => `EXISTS (SELECT 1 FROM audit_log WHERE id = ?${at})`,
  params: [auditId],
});
const audit = (id: string, actor: string, changes: boolean) =>
  db()
    .prepare(
      `INSERT INTO audit_log (id, actor_type, actor_id, role, action, entity_type, entity_id) SELECT ?1, 'staff', ?2, 'owner', 'payment.test', 'payment', ?1${changes ? " WHERE changes() > 0" : ""}`,
    )
    .bind(id, actor);

const recordArgs = (
  o: { id?: string; clientId: string; owner: string; sessionId: string },
  over: Partial<RecordPaymentArgs> = {},
): RecordPaymentArgs => ({
  id: o.id ?? uuidv7(),
  clientId: o.clientId,
  kind: "payment",
  status: "confirmed",
  currency: "INR",
  amountMinor: 118_000,
  chargesMinor: 0,
  receivedOn: "2026-10-28",
  mode: "neft",
  referenceNorm: `UTR${next()}`,
  inrReceivedMinor: null,
  requestedAllocations: null,
  tds: null,
  note: null,
  recordedBy: o.owner,
  sessionId: o.sessionId,
  now: Date.now(),
  confirmDuplicate: false,
  ...over,
});

describe("record, verify, withdraw: the builders of ledger.ts in a mutate-shaped batch [run file C]", () => {
  it("the Owner records and allocates in one batch; the same id again writes nothing; a reference seen is refused unless confirmed past", async () => {
    const { owner, clientId, inv } = await setup();
    const sessionId = await session(owner);
    const a = recordArgs({ clientId, owner, sessionId });
    const run1 = async (args: RecordPaymentArgs) => {
      const auditId = uuidv7();
      const g = auditGuard(auditId);
      const res = await db().batch([
        recordPaymentStatement(db(), args),
        audit(auditId, owner, true),
        ...allocationStatements(
          db(),
          [{ id: uuidv7(), paymentId: args.id, documentId: inv, amountMinor: 18_000, kind: "allocate" }],
          owner,
          args.now,
          g,
        ),
        recomputeStatement(db(), { paymentIds: [args.id], documentIds: [inv] }, args.now, g),
        ledgerResultStatement(db(), { paymentIds: [args.id], documentIds: [inv] }),
      ]);
      return res[0]?.meta.changes ?? 0;
    };
    expect(await run1(a)).toBe(1);
    expect(await docRow(inv)).toMatchObject({
      paid_minor: 18_000,
      balance_minor: 100_000,
      status: "partially_paid",
    });
    expect(await run1(a)).toBe(0); // already recorded: nothing written, the ledger unchanged
    expect(await docRow(inv)).toMatchObject({ paid_minor: 18_000 });
    const seen = await first<{ id: string; client_id: string }>(PAYMENT_REFERENCE_SEEN_SQL, a.referenceNorm);
    expect(seen).toMatchObject({ id: a.id, client_id: clientId });
    const dup = recordArgs({ clientId, owner, sessionId }, { referenceNorm: a.referenceNorm });
    expect(await run1(dup)).toBe(0);
    expect(await run1({ ...dup, confirmDuplicate: true })).toBe(1);
    // over-allocating in the same batch rolls everything back, the payment row included
    const over = recordArgs({ clientId, owner, sessionId }, { amountMinor: 1_000 });
    await rejects(run1(over), /payment_allocations_bounds/);
    expect(await first("SELECT id FROM payments WHERE id = ?", over.id)).toBeNull();
  });

  it("the Owner without a fresh step-up, Staff confirming, an anonymised client or another currency write nothing (Q2)", async () => {
    const { owner, clientId } = await setup();
    const stale = await session(owner, false);
    const write = (args: RecordPaymentArgs) => recordPaymentStatement(db(), args).run();
    expect((await write(recordArgs({ clientId, owner, sessionId: stale }))).meta.changes).toBe(0);
    const staff = await mkMember("staff");
    const ss = await session(staff, false);
    expect((await write(recordArgs({ clientId, owner: staff, sessionId: ss }))).meta.changes).toBe(0);
    const fresh = await session(owner);
    expect(
      (await write(recordArgs({ clientId, owner, sessionId: fresh }, { currency: "USD" }))).meta.changes,
    ).toBe(0);
    expect((await write(recordArgs({ clientId, owner, sessionId: ss }))).meta.changes).toBe(0); // someone else's session
    await run("UPDATE clients SET anonymised_at = 1 WHERE id = ?", clientId);
    expect((await write(recordArgs({ clientId, owner, sessionId: fresh }))).meta.changes).toBe(0);
  });

  it("Staff records pending with an approval and a bell per Owner; the balance does not move; the Owner confirms with other allocations; a second decision changes nothing", async () => {
    const { owner, clientId, inv } = await setup();
    const owner2 = await mkMember("owner");
    const staff = await mkMember("staff");
    const ss = await session(staff, false);
    const a = recordArgs(
      { clientId, owner: staff, sessionId: ss },
      {
        status: "pending_verification",
        requestedAllocations: JSON.stringify([{ documentId: inv, amountMinor: 118_000 }]),
      },
    );
    const auditId = uuidv7();
    await db().batch([
      recordPaymentStatement(db(), a),
      audit(auditId, staff, true),
      ...paymentApprovalStatements(
        db(),
        {
          approvalId: uuidv7(),
          paymentId: a.id,
          requestedBy: staff,
          contentSha256: "h".repeat(64),
          now: a.now,
          bell: { title: "[Placeholder]", link: `/payments/${a.id}` },
        },
        auditGuard(auditId),
      ),
    ]);
    expect(await docRow(inv)).toMatchObject({ paid_minor: 0, balance_minor: 118_000 });
    expect(await all("SELECT status FROM approvals WHERE payment_id = ?", a.id)).toEqual([
      { status: "pending" },
    ]);
    const bells = await all<{ user_id: string }>(
      "SELECT user_id FROM notifications WHERE kind = 'payment.verify' AND entity_id = ?",
      a.id,
    );
    // every active Owner of the database (this file's other tests made more), never the Staff member who asked
    expect(bells.map((b) => b.user_id)).toEqual(expect.arrayContaining([owner, owner2]));
    expect(bells.map((b) => b.user_id)).not.toContain(staff);
    expect((await first<{ n: number }>(PENDING_PAYMENTS_COUNT_SQL))?.n).toBeGreaterThanOrEqual(1);
    expect((await all<{ id: string }>(PENDING_PAYMENTS_SQL, -1, "")).some((r) => r.id === a.id)).toBe(true);

    const os = await session(owner);
    const decide = async (decision: "confirmed" | "rejected", amount: number) => {
      const id = uuidv7();
      const g = auditGuard(id);
      const now = Date.now();
      const res = await db().batch([
        verifyPaymentStatement(db(), {
          paymentId: a.id,
          decision,
          now,
          sessionId: os,
          note: null,
          expectedRecordedAt: a.now,
        }),
        audit(id, owner, true),
        ...allocationStatements(
          db(),
          [{ id: uuidv7(), paymentId: a.id, documentId: inv, amountMinor: amount, kind: "allocate" }],
          owner,
          now,
          g,
        ),
        recomputeStatement(db(), { paymentIds: [a.id], documentIds: [inv] }, now, g),
        ...decideApprovalStatements(
          db(),
          {
            paymentId: a.id,
            decidedBy: owner,
            now,
            note: null,
            bell: { title: "[Placeholder]", link: "/payments" },
          },
          g,
        ),
        ledgerResultStatement(db(), { paymentIds: [a.id], documentIds: [inv] }),
      ]);
      return res[0]?.meta.changes ?? 0;
    };
    expect(await decide("confirmed", 100_000)).toBe(1); // the Owner changed what Staff asked for (L6)
    expect(await docRow(inv)).toMatchObject({
      paid_minor: 100_000,
      balance_minor: 18_000,
      status: "partially_paid",
    });
    expect(await all("SELECT status, decided_by FROM approvals WHERE payment_id = ?", a.id)).toEqual([
      { status: "approved", decided_by: owner },
    ]);
    expect(
      await all("SELECT user_id FROM notifications WHERE kind = 'payment.decided' AND entity_id = ?", a.id),
    ).toEqual([{ user_id: staff }]);
    expect(await decide("confirmed", 1)).toBe(0); // payment_not_pending
    expect(await docRow(inv)).toMatchObject({ paid_minor: 100_000 });
    // the 18000 left is the client's credit
    expect(await all(CLIENT_CREDIT_SQL, clientId)).toEqual([{ currency: "INR", credit: 18_000 }]);
    expect(await all<{ id: string }>(CREDIT_SOURCES_SQL, clientId, "INR")).toEqual([
      expect.objectContaining({ id: a.id, net: 100_000 }),
    ]);
    expect(await all<{ payment_id: string; held: number }>(DOCUMENT_HOLDINGS_SQL, inv)).toEqual([
      expect.objectContaining({ payment_id: a.id, held: 100_000 }),
    ]);
  });

  it("withdraw: the Owner with a fresh code; every document the payment touched is recomputed; an advance's payment is never withdrawn here", async () => {
    const { owner, clientId, inv } = await setup();
    const inv2 = await mkIssued(clientId);
    const p = await pay(clientId, owner, { amount: 200_000 });
    await alloc(p, inv, 118_000);
    await alloc(p, inv2, 82_000);
    await recompute({ paymentIds: [p] });
    const stale = await session(owner, false);
    expect(
      (
        await withdrawPaymentStatement(db(), {
          paymentId: p,
          now: Date.now(),
          sessionId: stale,
          reason: "x",
        }).run()
      ).meta.changes,
    ).toBe(0);
    const os = await session(owner);
    const id = uuidv7();
    const now = Date.now();
    await db().batch([
      withdrawPaymentStatement(db(), { paymentId: p, now, sessionId: os, reason: "Entered twice" }),
      audit(id, owner, true),
      recomputeStatement(db(), { paymentIds: [p] }, now, auditGuard(id)),
      ledgerResultStatement(db(), { paymentIds: [p] }),
    ]);
    expect(await docRow(inv)).toMatchObject({ paid_minor: 0, balance_minor: 118_000, status: "issued" });
    expect(await docRow(inv2)).toMatchObject({ paid_minor: 0, balance_minor: 118_000, status: "issued" });
  });

  it("credit: apply first in first out onto an invoice, then release an excess back to credit", async () => {
    const { owner, clientId, inv } = await setup();
    const p1 = await pay(clientId, owner, { amount: 50_000, receivedOn: "2026-10-01" });
    const p2 = await pay(clientId, owner, { amount: 100_000, receivedOn: "2026-10-02" });
    const os = await session(owner);
    const doc = await docRow(inv);
    const apply = async (
      amount: number,
      sources: { paymentId: string; amountMinor: number }[],
      expected: number,
    ) => {
      const id = uuidv7();
      const g = auditGuard(id);
      const now = Date.now();
      const res = await db().batch([
        creditClaimStatement(db(), {
          kind: "apply",
          documentId: inv,
          expectedUpdatedAt: expected,
          now,
          sessionId: os,
          amountMinor: amount,
        }),
        audit(id, owner, true),
        ...allocationStatements(
          db(),
          sources.map((s) => ({
            id: uuidv7(),
            paymentId: s.paymentId,
            documentId: inv,
            amountMinor: s.amountMinor,
            kind: "allocate" as const,
          })),
          owner,
          now,
          g,
        ),
        recomputeStatement(db(), { documentIds: [inv] }, now, g),
        ledgerResultStatement(db(), { documentIds: [inv] }),
      ]);
      return res[0]?.meta.changes ?? 0;
    };
    expect(await apply(150_001, [], doc?.updated_at ?? 0)).toBe(0); // above the balance and the credit
    expect(
      await apply(
        60_000,
        [
          { paymentId: p1, amountMinor: 50_000 },
          { paymentId: p2, amountMinor: 10_000 },
        ],
        1,
      ),
    ).toBe(0); // stale stamp
    expect(
      await apply(
        60_000,
        [
          { paymentId: p1, amountMinor: 50_000 },
          { paymentId: p2, amountMinor: 10_000 },
        ],
        doc?.updated_at ?? 0,
      ),
    ).toBe(1);
    expect(await docRow(inv)).toMatchObject({ paid_minor: 60_000, balance_minor: 58_000 });
    expect(await all(CLIENT_CREDIT_SQL, clientId)).toEqual([{ currency: "INR", credit: 90_000 }]);
    // a credit note of 70000 makes 12000 of excess; release it to p2
    await run(
      "UPDATE documents SET credited_minor = 70000, balance_minor = 0, status = 'paid' WHERE id = ?",
      inv,
    );
    const now = await docRow(inv);
    const id = uuidv7();
    const g = auditGuard(id);
    await db().batch([
      creditClaimStatement(db(), {
        kind: "release",
        documentId: inv,
        expectedUpdatedAt: now?.updated_at ?? 0,
        now: Date.now(),
        sessionId: os,
        amountMinor: 12_000,
      }),
      audit(id, owner, true),
      ...allocationStatements(
        db(),
        [
          // p2 holds 10000 there, p1 50000: each gives back no more than it holds
          { id: uuidv7(), paymentId: p2, documentId: inv, amountMinor: 10_000, kind: "release" },
          { id: uuidv7(), paymentId: p1, documentId: inv, amountMinor: 2_000, kind: "release" },
        ],
        owner,
        Date.now(),
        g,
      ),
      recomputeStatement(db(), { documentIds: [inv] }, Date.now(), g),
      ledgerResultStatement(db(), { documentIds: [inv] }),
    ]);
    expect(await docRow(inv)).toMatchObject({ paid_minor: 48_000, balance_minor: 0, status: "paid" });
    expect(await all(CLIENT_CREDIT_SQL, clientId)).toEqual([{ currency: "INR", credit: 102_000 }]);
  });

  it("the TDS certificate and the proof are set once, by an Owner or Staff member", async () => {
    const { owner, clientId } = await setup();
    const staff = await mkMember("staff");
    const ss = await session(staff, false);
    const t = await pay(clientId, owner, { kind: "tds", amount: 100 });
    const cert = (no: string) =>
      tdsCertificateStatement(db(), {
        paymentId: t,
        certificateNo: no,
        certificateOn: "2026-11-15",
        sessionId: ss,
        now: Date.now(),
      }).run();
    expect((await cert("16A-1")).meta.changes).toBe(1);
    expect((await cert("16A-2")).meta.changes).toBe(0);
    const p = await pay(clientId, owner);
    const proof = (key: string) =>
      proofStatement(db(), {
        paymentId: p,
        kind: "FIRC",
        ref: null,
        r2Key: key,
        sha256: "a".repeat(64),
        mime: "application/pdf",
        sessionId: ss,
        now: Date.now(),
      }).run();
    expect((await proof(`payments/${p}/proof-1`)).meta.changes).toBe(1);
    expect((await proof(`payments/${p}/proof-2`)).meta.changes).toBe(0);
  });
});

// ---- realisation extensions (Q60) ------------------------------------------------------------------------------------------------------------------

describe("realisation extensions and femaDueSql [Q60, L14; 08-C RB-04, RA-20]", () => {
  const usdExport = async () => {
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
    return id;
  };

  it("an extension is for an issued export invoice, later than its FEMA date and any earlier extension; append-only; the letter set once", async () => {
    const owner = await mkMember("owner");
    const os = await session(owner, false);
    const doc = await usdExport();
    const ext = (to: string, id = uuidv7()) =>
      realisationExtensionStatement(db(), {
        id,
        documentId: doc,
        extendedTo: to,
        bankRef: "AD/EXT/1",
        recordedBy: owner,
        now: Date.now(),
        sessionId: os,
      }).run();
    expect((await ext("2027-08-03")).meta.changes).toBe(0); // the standard FEMA date itself (9 months): not later
    const id1 = uuidv7();
    expect((await ext("2027-12-31", id1)).meta.changes).toBe(1);
    expect((await ext("2027-11-30")).meta.changes).toBe(0); // before the current (extended) date
    await rejects(
      run(
        "INSERT INTO realisation_extensions (id, document_id, extended_to, bank_ref, recorded_by) VALUES (?1, ?2, '2027-12-01', 'x', ?3)",
        uuidv7(),
        doc,
        owner,
      ),
      /realisation_extensions_scope_insert/,
    );
    await rejects(
      run("UPDATE realisation_extensions SET extended_to = '2028-01-01' WHERE id = ?", id1),
      /realisation_extensions_fixed/,
    );
    const letter = (key: string) =>
      extensionLetterStatement(db(), {
        id: id1,
        documentId: doc,
        r2Key: key,
        sha256: "b".repeat(64),
        mime: "image/png",
        sessionId: os,
        now: Date.now(),
      }).run();
    expect((await letter(`extensions/${id1}/letter-1`)).meta.changes).toBe(1);
    expect((await letter(`extensions/${id1}/letter-2`)).meta.changes).toBe(0);
    await rejects(
      run("DELETE FROM realisation_extensions WHERE id = ?", id1),
      /realisation_extensions_no_delete/,
    );
    const inr = await mkIssued(await mkClientRow());
    await rejects(
      run(
        "INSERT INTO realisation_extensions (id, document_id, extended_to, bank_ref, recorded_by) VALUES (?1, ?2, '2030-01-01', 'x', ?3)",
        uuidv7(),
        inr,
        owner,
      ),
      /realisation_extensions_scope_insert/,
    );
  });

  it("femaDueSql takes the latest extension, as core realisationDates with extendedTo does (the twin), and the GST date follows", async () => {
    const owner = await mkMember("owner");
    const doc = await usdExport();
    const p = { ...SCAN_BINDS, today: "'2027-01-01'" };
    const rules = DEFAULT_REALISATION_RULES;
    const read = async () =>
      first<{ fema: string; gst: string }>(
        `SELECT ${femaDueSql("d", p)} AS fema, ${gstDueSql("d", p)} AS gst FROM documents d WHERE d.id = ?1`,
        doc,
        rules.femaMonthsForeign,
        rules.femaMonthsInr,
        rules.gstMonths,
        rules.gstExtraDays,
      );
    const core = (extendedTo?: string) => {
      const r = realisationDates({
        invoiceDate: parseIsoDate("2026-11-03") as CalendarDate,
        currency: "USD",
        supplyType: "export_lut",
        extendedTo: extendedTo ? (parseIsoDate(extendedTo) as CalendarDate) : undefined,
      });
      if (!r.ok) throw new Error("dates");
      return { fema: toIsoDate(r.value.femaDue), gst: toIsoDate(r.value.gstDue) };
    };
    expect(await read()).toEqual(core());
    for (const to of ["2027-09-30", "2028-02-29", "2028-06-30"]) {
      await run(
        "INSERT INTO realisation_extensions (id, document_id, extended_to, bank_ref, recorded_by) VALUES (?1, ?2, ?3, 'AD', ?4)",
        uuidv7(),
        doc,
        to,
        owner,
      );
      expect(await read(), to).toEqual(core(to));
    }
  });
});

// ---- the statement and the figures ----------------------------------------------------------------------------------------------------------------

describe("the statement's closing balance is its ledger check, with payments, TDS, credit and an excess [ADM-CLI-04, run file B]", () => {
  it("debits − credit notes − receipts − TDS = Σ(total − paid − credited − tds) − credit", async () => {
    const { owner, clientId, inv } = await setup();
    const inv2 = await mkIssued(clientId);
    const p = await pay(clientId, owner, { amount: 150_000 }); // 32000 left as credit after the two allocations below
    const t = await pay(clientId, owner, { kind: "tds", amount: 10_000 });
    await alloc(p, inv, 100_000);
    await alloc(p, inv2, 18_000);
    await alloc(t, inv2, 10_000);
    await recompute({ paymentIds: [p] });
    await recompute({ paymentIds: [t] });
    // a credit note on inv of 30000 makes an excess of 12000 there (the balance stops at zero)
    await run(
      "UPDATE documents SET credited_minor = 30000, balance_minor = 0, status = 'paid' WHERE id = ?",
      inv,
    );
    await recompute({ documentIds: [inv] });
    const range = ["2026-04-01", "2027-03-31"] as const;
    const tot = await first<{ debit: number; credit: number; n: number }>(
      STATEMENT_TOTALS_SQL,
      ...statementTotalsBinds(clientId, "INR", ...range),
    );
    // mkIssued writes no credit-note document, so the totals see the invoices and the payments only: add the 30000 credit note by hand to the credit side
    const closing = (tot?.debit ?? 0) - (tot?.credit ?? 0) - 30_000;
    const ledger = await first<{ balance: number }>(STATEMENT_LEDGER_SQL, clientId, "INR");
    expect(tot?.debit).toBe(236_000);
    expect(tot?.credit).toBe(160_000);
    expect(ledger?.balance).toBe(closing);
    // Early check A4: the client's figures keep `balance` as what is owed and add `excess`; balance − excess − credit is what the statement closes at.
    const fig = await first<{ balance: number; excess: number; credit: number }>(
      CLIENT_FIGURES_SQL,
      clientId,
      "2026-10-31",
    );
    expect(fig?.excess).toBe(12_000);
    expect(fig?.credit).toBe(32_000);
    expect((fig?.balance ?? 0) - (fig?.excess ?? 0) - (fig?.credit ?? 0)).toBe(ledger?.balance);
  });

  it("collected, credit and TDS on the client's figures; paid and TDS on a project's; the register lists confirmed payments only", async () => {
    const { owner, clientId, inv } = await setup();
    const p = await pay(clientId, owner, { amount: 120_000, receivedOn: "2026-10-28" });
    await alloc(p, inv, 118_000);
    await recompute({ paymentIds: [p] });
    const staff = await mkMember("staff");
    await pay(clientId, staff, { status: "pending_verification", amount: 7 });
    const rows = await all(COLLECTED_SQL, "2026-10-01", "2026-10-31");
    expect(rows.some((r) => (r as { collected: number }).collected >= 120_000)).toBe(true);
    const reg = await all<{ id: string; allocations: string }>(
      PAYMENTS_REGISTER_SQL(false),
      "2026-10-28",
      "2026-10-28",
    );
    const mine = reg.find((r) => r.id === p);
    expect(JSON.parse(mine?.allocations ?? "[]")).toEqual([
      expect.objectContaining({ documentId: inv, kind: "allocate", amountMinor: 118_000 }),
    ]);
    expect(reg.some((r) => r.id === p)).toBe(true);
    // the client's figures: 120000 collected, 2000 of it held as credit; the pending 7 counts nowhere
    expect(await first(CLIENT_FIGURES_SQL, clientId, "2026-10-31")).toMatchObject({
      currency: "INR",
      billed: 118_000,
      balance: 0,
      tds: 0,
      collected: 120_000,
      credit: 2_000,
    });
    // a project's paid and TDS
    const projectId = uuidv7();
    await run(
      "INSERT INTO projects (id, code, client_id, name, currency) VALUES (?1, ?2, ?3, 'P', 'INR')",
      projectId,
      `PRJ-L-${next()}`,
      clientId,
    );
    const pdoc = uuidv7();
    const n = next();
    await run(
      `INSERT INTO documents (id, type, status, client_id, project_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, total_minor, balance_minor)
       VALUES (?1, 'tax_invoice', 'issued', ?2, ?3, 'INR', 'inv-l', '9999', ?4, ?5, 1000, '2026-10-28', '2026-11-04', 10000, 10000)`,
      pdoc,
      clientId,
      projectId,
      n,
      `L/${n}`,
    );
    const t = await pay(clientId, owner, { kind: "tds", amount: 1_000 });
    await alloc(p, pdoc, 2_000);
    await alloc(t, pdoc, 1_000);
    await recompute({ documentIds: [pdoc] });
    expect(await first(PROJECT_BILLED_SQL, projectId)).toMatchObject({
      billed: 10_000,
      paid: 2_000,
      tds: 1_000,
    });
    expect(await first(CLIENT_FIGURES_SQL, clientId, "2026-10-31")).toMatchObject({
      collected: 120_000,
      credit: 0,
      tds: 1_000,
    });
  });

  it("the client's figures read its own documents once: the payment aggregates run once, never per document (rows read, as FX-3)", async () => {
    const owner = await mkMember("owner");
    const clientId = await mkClientRow();
    for (let i = 0; i < 60; i++) await mkIssued(clientId);
    await pay(clientId, owner, { amount: 10 });
    const res = await db().prepare(CLIENT_FIGURES_SQL).bind(clientId, "2026-10-31").all();
    // 60 documents through the index (two rows each), the client row, and a handful of payment rows: never 60 more per aggregate
    expect(res.meta.rows_read).toBeLessThanOrEqual(2 * 60 + 10);
    const p = (
      await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${CLIENT_FIGURES_SQL}`, clientId, "2026-10-31")
    )
      .map((r) => r.detail)
      .join("\n");
    expect(p).not.toMatch(/CORRELATED/);
  });
});

// ---- reminders stop ------------------------------------------------------------------------------------------------------------------------------

describe("a confirmed payment stops the invoice's reminders [ADM-INV-13, run file F]", () => {
  it("the claim changes nothing once the recompute leaves no balance", async () => {
    const owner = await mkMember("owner");
    const clientId = await mkClientRow();
    const inv = await mkIssued(clientId);
    const contact = await mkContact(clientId, { finance: true });
    await mkSend(inv, clientId, contact, { createdBy: owner });
    const now = Date.now();
    const r1 = await mkReminder(inv, 1, now - 1_000);
    const p = await pay(clientId, owner, { amount: 118_000 });
    await alloc(p, inv, 118_000);
    await recompute({ paymentIds: [p] });
    expect(await all(REMINDER_CLAIM_SQL, r1, now)).toHaveLength(0);
    // withdrawn: the balance is back, and the reminder is due again
    await run(
      "UPDATE payments SET status = 'withdrawn', withdrawn_by = ?2, withdrawn_at = 1, withdraw_reason = 'x' WHERE id = ?1",
      p,
      owner,
    );
    await recompute({ paymentIds: [p] });
    expect(await all(REMINDER_CLAIM_SQL, r1, now)).toHaveLength(1);
  });
});

// ---- EXPLAIN ---------------------------------------------------------------------------------------------------------------------------------------

describe("every new read is served by its index [run file A.2, A.3, F]", () => {
  const plan = async (sql: string, ...binds: unknown[]) =>
    (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...binds)).map((r) => r.detail).join("\n");
  it("the pending list and count, the register and collected, the reference check, the credit, the holdings and the void facts", async () => {
    expect(await plan(PENDING_PAYMENTS_SQL, -1, "")).toContain("payments_pending");
    expect(await plan(PENDING_PAYMENTS_COUNT_SQL)).toContain("payments_pending");
    expect(await plan(PAYMENTS_REGISTER_SQL(true), "2026-04-01", "2027-03-31", "2026-05-01", "x")).toContain(
      "payments_confirmed",
    );
    expect(await plan(COLLECTED_SQL, "2026-10-01", "2026-10-31")).toContain("payments_confirmed");
    expect(await plan(PAYMENT_REFERENCE_SEEN_SQL, "UTR1")).toContain("payments_reference");
    expect(await plan(CLIENT_CREDIT_SQL, "c")).toContain("payments_client");
    expect(await plan(CREDIT_SOURCES_SQL, "c", "INR")).toContain("payments_client");
    const h = await plan(DOCUMENT_HOLDINGS_SQL, "d");
    expect(h).toContain("payment_allocations_document");
    expect(await plan(PAYMENT_ASKS_FOR_DOCUMENT_SQL, "d", "c")).toContain("payment_allocations_document");
    expect(await plan(STATEMENT_LEDGER_SQL, "c", "INR")).toContain("payments_client");
    for (const p of [await plan(PENDING_PAYMENTS_SQL, -1, ""), await plan(CREDIT_SOURCES_SQL, "c", "INR")])
      expect(p).not.toMatch(/SCAN p\b(?! USING)/);
  });

  it("the recompute and the allocation bound seek the allocations by document and by payment", async () => {
    const r = await plan(
      "SELECT coalesce(sum(lpa.amount_minor), 0) FROM payment_allocations lpa JOIN payments lpp ON lpp.id = lpa.payment_id WHERE lpa.document_id = ?1 AND lpp.status = 'confirmed'",
      "d",
    );
    expect(r).toContain("payment_allocations_document");
    expect(
      await plan("SELECT sum(pna.amount_minor) FROM payment_allocations pna WHERE pna.payment_id = ?1", "p"),
    ).toContain("payment_allocations_payment");
  });
});

// ---- the INSERT OR IGNORE bells never duplicate ------------------------------------------------------------------------------------------------------

describe("a guard that did not pass writes nothing (the audit row missing)", () => {
  it("side statements guarded on a missing audit row change nothing", async () => {
    const { owner, clientId, inv } = await setup();
    const p = await pay(clientId, owner, { amount: 100 });
    const g = auditGuard("no-such-audit");
    const res = await db().batch([
      ...allocationStatements(
        db(),
        [{ id: uuidv7(), paymentId: p, documentId: inv, amountMinor: 100, kind: "allocate" }],
        owner,
        T,
        g,
      ),
      recomputeStatement(db(), { paymentIds: [p], documentIds: [inv] }, Date.now(), g),
      ledgerResultStatement(db(), { paymentIds: [p], documentIds: [inv] }),
    ]);
    expect(res[0]?.meta.changes).toBe(0);
    expect(await docRow(inv)).toMatchObject({ paid_minor: 0, balance_minor: 118_000 });
  });
});
