import { env } from "cloudflare:workers";
import { defaultFormat, financialYear, formatDocumentNumber, sqlPrintfPattern, uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { frozenDocumentColumns, MUTABLE_AFTER_FREEZE, SET_ONCE_AFTER_FREEZE } from "../src/triggers.ts";
import { all, first, insertClient, insertDraftInvoice, issueBatch, rejects, run } from "./helpers.ts";

const FY = financialYear(2026).token;
const PATTERN = sqlPrintfPattern(defaultFormat("invoice")).pattern;

async function issuedInvoice() {
  const clientId = await insertClient(`C-${crypto.randomUUID().slice(0, 8)}`);
  const id = await insertDraftInvoice(clientId);
  await issueBatch(id, "invoice", FY, PATTERN);
  return id;
}

describe("frozen documents (ADM-INV-07, ADM-PROP-05)", () => {
  it("the installed trigger covers every content column of documents", async () => {
    const trigger = await first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'documents_frozen_update'",
    );
    for (const column of [...frozenDocumentColumns(), ...SET_ONCE_AFTER_FREEZE]) {
      expect(trigger?.sql, column).toContain(`OLD.\`${column}\``);
    }
    for (const column of MUTABLE_AFTER_FREEZE) expect(trigger?.sql).not.toContain(`OLD.\`${column}\``);
  });

  it("drafts can be edited freely", async () => {
    const clientId = await insertClient("C-DRAFT");
    const id = await insertDraftInvoice(clientId);
    await run("UPDATE documents SET total_minor = 200000 WHERE id = ?", id);
    await run("UPDATE document_lines SET rate_minor = 1 WHERE document_id = ?", id);
    await run("DELETE FROM documents WHERE id = ?", id);
  });

  it("updating a frozen document's content aborts", async () => {
    const id = await issuedInvoice();
    for (const change of [
      "total_minor = total_minor + 1",
      "client_id = client_id || 'x'",
      "number = number + 1",
      "number_display = 'TH/INV/2627/0099'",
      "frozen_at = NULL",
      "recipient = '{}'",
      "issue_date = '2026-10-07'",
    ]) {
      await rejects(run(`UPDATE documents SET ${change} WHERE id = ?`, id), /issued document is frozen/);
    }
  });

  it("ledger, status, e-invoice and set-once fields can still change", async () => {
    const id = await issuedInvoice();
    await run(
      "UPDATE documents SET status = 'partially_paid', paid_minor = 50000, balance_minor = 68000, updated_at = 1, irn = 'x' WHERE id = ?",
      id,
    );
    await run("UPDATE documents SET pdf_r2_key = 'docs/a.pdf', pdf_sha256 = 'abc' WHERE id = ?", id);
    await rejects(run("UPDATE documents SET pdf_r2_key = 'docs/b.pdf' WHERE id = ?", id), /frozen/);
    await run(
      "UPDATE documents SET status = 'void', voided_at = 1, void_reason = 'Duplicate' WHERE id = ?",
      id,
    );
    await rejects(
      run("UPDATE documents SET voided_at = NULL, void_reason = NULL WHERE id = ?", id),
      /frozen/,
    );
  });

  it("frozen documents and their lines, sections and schedules can't be deleted or changed", async () => {
    const id = await issuedInvoice();
    await rejects(run("DELETE FROM documents WHERE id = ?", id), /cannot be deleted/);
    await rejects(
      run("UPDATE document_lines SET rate_minor = 1 WHERE document_id = ?", id),
      /issued document/,
    );
    await rejects(run("DELETE FROM document_lines WHERE document_id = ?", id), /issued document/);
    await rejects(
      run(
        "INSERT INTO document_lines (id, document_id, position, description, qty_milli, unit, rate_minor, taxable_minor, line_total_minor) VALUES (?, ?, 2, 'Extra', 1000, 'fixed', 1, 1, 1)",
        uuidv7(),
        id,
      ),
      /issued document/,
    );
    await rejects(
      run(
        "INSERT INTO document_sections (id, document_id, kind, position) VALUES (?, ?, 'scope', 1)",
        uuidv7(),
        id,
      ),
      /issued document/,
    );
    await rejects(
      run(
        "INSERT INTO payment_schedules (id, document_id, position, label, trigger, pct_bp, amount_minor) VALUES (?, ?, 1, 'All', 'on_accept', 10000, 118000)",
        uuidv7(),
        id,
      ),
      /issued document/,
    );
  });
});

describe("append-only tables", () => {
  it("audit_log refuses UPDATE and DELETE", async () => {
    await run(
      "INSERT INTO audit_log (id, actor_type, action, entity_type) VALUES ('a1', 'system', 'seed', 'settings')",
    );
    await rejects(run("UPDATE audit_log SET action = 'x' WHERE id = 'a1'"), /audit_log is append-only/);
    await rejects(run("DELETE FROM audit_log WHERE id = 'a1'"), /audit_log is append-only/);
    expect((await all("SELECT id FROM audit_log")).length).toBe(1);
  });

  it("acceptances and catalogue price history refuse UPDATE and DELETE", async () => {
    const docId = await issuedInvoice();
    const doc = await first<{ client_id: string }>("SELECT client_id FROM documents WHERE id = ?", docId);
    await run(
      "INSERT INTO contacts (id, client_id, name, email) VALUES ('ct1', ?, 'A', 'a@example.com')",
      doc?.client_id,
    );
    await run(
      "INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, pdf_sha256) VALUES ('acc1', ?, 'ct1', 'A', 'a@example.com', 1, 'h')",
      docId,
    );
    await rejects(run("UPDATE acceptances SET typed_name = 'B'"), /append-only/);
    await rejects(run("DELETE FROM acceptances"), /append-only/);
    await rejects(
      run(
        "INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, pdf_sha256) VALUES ('acc2', ?, 'ct1', 'A', 'a@example.com', 2, 'h')",
        docId,
      ),
      /UNIQUE/,
    );
    await run(
      "INSERT INTO catalogue_items (id, code, name, category, short, unit, sac, schedule) VALUES ('ci', 'SX', 'X', 'build', 'x', 'fixed', '998314', '[]')",
    );
    await run(
      "INSERT INTO catalogue_price_history (id, item_id, field, old_minor, new_minor) VALUES ('ph', 'ci', 'price_inr_minor', 1, 2)",
    );
    await rejects(run("DELETE FROM catalogue_price_history"), /append-only/);
  });
});

describe("gap-free numbering (docs/05 §5.4, ADM-INV-03)", () => {
  it("formats the number in SQL exactly as core does", async () => {
    const id = await issuedInvoice();
    const doc = await first<{ number: number; number_display: string }>(
      "SELECT number, number_display FROM documents WHERE id = ?",
      id,
    );
    expect(doc?.number_display).toBe(
      formatDocumentNumber(defaultFormat("invoice"), financialYear(2026), doc?.number ?? 0),
    );
  });

  it("20 issues in parallel get 20 consecutive numbers, none duplicated", async () => {
    const clientId = await insertClient("C-PAR");
    const ids = await Promise.all(Array.from({ length: 20 }, () => insertDraftInvoice(clientId)));
    await Promise.all(ids.map((id) => issueBatch(id, "invoice", "2728", PATTERN)));
    const numbers = await all<{ number: number; number_display: string }>(
      "SELECT number, number_display FROM documents WHERE fy = '2728' ORDER BY number",
    );
    expect(numbers.map((n) => n.number)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(numbers.at(-1)?.number_display).toBe("TH/INV/2728/0020");
  });

  it("issuing a document that isn't a draft fails and consumes no number", async () => {
    const id = await issuedInvoice();
    const before = await first<{ next_no: number }>(
      "SELECT next_no FROM doc_counters WHERE series = 'invoice' AND fy = ?",
      FY,
    );
    await rejects(issueBatch(id, "invoice", FY, PATTERN), /not an issuable draft/);
    await rejects(issueBatch(uuidv7(), "invoice", FY, PATTERN), /not an issuable draft/);
    const after = await first<{ next_no: number }>(
      "SELECT next_no FROM doc_counters WHERE series = 'invoice' AND fy = ?",
      FY,
    );
    expect(after?.next_no).toBe(before?.next_no);
  });

  it("each FY has its own counter, and counters never go down or disappear", async () => {
    const clientId = await insertClient("C-FY");
    const a = await insertDraftInvoice(clientId);
    const b = await insertDraftInvoice(clientId);
    await issueBatch(a, "invoice", "2829", PATTERN);
    await issueBatch(b, "invoice", "2930", PATTERN);
    const rows = await all<{ fy: string; number: number }>(
      "SELECT fy, number FROM documents WHERE id IN (?, ?) ORDER BY fy",
      a,
      b,
    );
    expect(rows).toEqual([
      { fy: "2829", number: 1 },
      { fy: "2930", number: 1 },
    ]);
    await rejects(run("UPDATE doc_counters SET next_no = 1 WHERE fy = '2829'"), /only move forward/);
    await rejects(run("DELETE FROM doc_counters WHERE fy = '2829'"), /cannot be deleted/);
    await run("UPDATE doc_counters SET next_no = 50 WHERE fy = '2829'"); // raising is allowed (ADM-SET-04)
    expect(env.DB).toBeDefined();
  });

  it("a number longer than 16 characters is rejected by the database too", async () => {
    const clientId = await insertClient("C-LONG");
    const id = await insertDraftInvoice(clientId);
    await rejects(issueBatch(id, "invoice", FY, "TECHAUST/INV/%s/%04d"), /documents_number_length/);
    const doc = await first<{ status: string }>("SELECT status FROM documents WHERE id = ?", id);
    expect(doc?.status).toBe("draft");
  });
});

describe("staff-auth triggers (0004; ADM-AUTH-07, ADM-G-06, NFR-9)", () => {
  const staff = (id: string, role: string, status = "active") =>
    run(
      "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?1 || '@example.com', ?1, ?2, ?3)",
      id,
      role,
      status,
    );

  it("the last active owner can't be demoted, deactivated or reset to invited", async () => {
    await staff("owner-a", "owner");
    await staff("staff-a", "staff");
    await rejects(
      run("UPDATE staff_users SET role = 'staff' WHERE id = 'owner-a'"),
      /at least one active owner/,
    );
    await rejects(
      run("UPDATE staff_users SET status = 'deactivated' WHERE id = 'owner-a'"),
      /at least one active owner/,
    );
    await rejects(
      run("UPDATE staff_users SET status = 'invited', totp_secret_enc = NULL WHERE id = 'owner-a'"),
      /at least one active owner/,
    );
    const owner = await first<{ role: string; status: string }>(
      "SELECT role, status FROM staff_users WHERE id = 'owner-a'",
    );
    expect(owner).toEqual({ role: "owner", status: "active" });
  });

  it("with two active owners either can go, but then the other is protected", async () => {
    await staff("owner-b", "owner");
    await run("UPDATE staff_users SET status = 'deactivated' WHERE id = 'owner-b'");
    await rejects(
      run("UPDATE staff_users SET role = 'sales' WHERE id = 'owner-a'"),
      /at least one active owner/,
    );
  });

  it("other changes are untouched: promote, edit columns, deactivate a non-owner, delete a user", async () => {
    await run("UPDATE staff_users SET role = 'owner' WHERE id = 'staff-a'");
    await run("UPDATE staff_users SET name = 'Renamed', totp_last_step = 5 WHERE id = 'owner-a'");
    await run("UPDATE staff_users SET role = 'sales' WHERE id = 'staff-a'"); // owner-a is still active
    await run("UPDATE staff_users SET status = 'deactivated' WHERE id = 'staff-a'");
    await staff("temp", "staff");
    await run("DELETE FROM staff_users WHERE id = 'temp'"); // no delete trigger: the benchmark relies on it
  });

  it("an invited owner can be activated (the first-owner bootstrap)", async () => {
    await staff("boot", "owner", "invited");
    await run("UPDATE staff_users SET status = 'active', totp_enabled_at = 1 WHERE id = 'boot'");
  });

  it("access_log refuses UPDATE", async () => {
    await run(
      "INSERT INTO access_log (id, realm, method, route, status) VALUES ('al1', 'admin', 'GET', '/v1/auth/me', 200)",
    );
    await rejects(run("UPDATE access_log SET status = 500 WHERE id = 'al1'"), /access_log is append-only/);
    expect((await first<{ status: number }>("SELECT status FROM access_log WHERE id = 'al1'"))?.status).toBe(
      200,
    );
  });

  it("staff_known_devices: one row per user and device, removed with the user", async () => {
    await staff("dev-user", "staff");
    await run("INSERT INTO staff_known_devices (user_id, device_hash) VALUES ('dev-user', 'h1')");
    await rejects(
      run("INSERT INTO staff_known_devices (user_id, device_hash) VALUES ('dev-user', 'h1')"),
      /UNIQUE|PRIMARY/,
    );
    await run("DELETE FROM staff_users WHERE id = 'dev-user'");
    expect(await all("SELECT 1 FROM staff_known_devices WHERE user_id = 'dev-user'")).toEqual([]);
  });
});
