// M5.4 migrations 0043 and 0044 [ADM-CARE-02, ADM-INV-13, POR-06, LD55, LD58, LD59, LD60]: what they add (no rebuild), and every trigger of 0044 refusing the direct SQL it is
// there for. Each abort message starts with its trigger's name, so the API can map it.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { billingTriggerStatements } from "../src/triggers.ts";
import {
  mkCareDraft,
  mkCarePlan,
  mkClientRow,
  mkContact,
  mkIssued,
  mkMember,
  mkReminder,
  mkSend,
} from "./billing-helpers.ts";
import { all, first, rejects, run } from "./helpers.ts";

const sqlOf = (name: string) => (env.TEST_MIGRATIONS.find((m) => m.name === name)?.queries ?? []).join("\n");

describe("0043 adds columns, a table and indexes: no rebuild", () => {
  const sql = sqlOf("0043_billing.sql");
  it("only ALTER ADD COLUMN, CREATE TABLE care_invoices and CREATE INDEX", () => {
    expect(sql).not.toMatch(/DROP|__new_|RENAME|PRAGMA|ALTER TABLE `\w+` (DROP|RENAME|ALTER)/i);
    const alters = [...sql.matchAll(/ALTER TABLE `(\w+)` ADD `(\w+)`/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(alters).toEqual([
      "clients.care_auto_issue_by",
      "doc_access_tokens.contact_id",
      "doc_access_tokens.client_id",
      "doc_access_tokens.email",
      "doc_access_tokens.send_id",
    ]);
    expect([...sql.matchAll(/CREATE TABLE `(\w+)`/g)].map((m) => m[1])).toEqual(["care_invoices"]);
    expect([...sql.matchAll(/CREATE (?:UNIQUE )?INDEX `(\w+)`/g)].map((m) => m[1])).toEqual([
      "care_invoices_document",
      "doc_access_tokens_contact",
      "milestones_unbilled",
      "reminders_pending",
    ]);
    expect(sql).toMatch(
      /CREATE INDEX `milestones_unbilled` ON `milestones` \(`delivered_at`,`id`\) WHERE .*ready_to_bill.* and .*delivered_at.* is not null/,
    );
    expect(sql).toMatch(
      /CREATE INDEX `reminders_pending` ON `reminders` \(`due_at`,`id`\) WHERE .*sent_at.* is null and .*skipped_reason.* is null/,
    );
  });
  it("the purpose CHECK of doc_access_tokens is untouched (view_pay only)", async () => {
    const ddl = (
      await first<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'doc_access_tokens'")
    )?.sql;
    expect(ddl).toMatch(/CHECK\("doc_access_tokens"."purpose" in \('view_pay'\)\)/);
  });
  it("the columns exist with no default, and care_invoices has its primary key and its append-only record", async () => {
    const cols = await all<{ name: string; notnull: number; pk: number }>(
      "SELECT name, \"notnull\", pk FROM pragma_table_info('care_invoices')",
    );
    expect(
      cols
        .filter((c) => c.pk > 0)
        .map((c) => c.name)
        .sort(),
    ).toEqual(["care_plan_id", "period_start"]);
    expect(cols.find((c) => c.name === "document_id")?.notnull).toBe(0);
    expect(cols.find((c) => c.name === "terms_id")?.notnull).toBe(1);
    const client = await all<{ name: string }>(
      "SELECT name FROM pragma_table_info('clients') WHERE name = 'care_auto_issue_by'",
    );
    expect(client).toHaveLength(1);
  });
});

describe("0044 only creates triggers (and one backfill), and is what src/triggers.ts generates", () => {
  const sql = sqlOf("0044_billing_triggers.sql");
  it("no DROP, no ALTER, no rebuild; the nine triggers in order; every abort message starts with its name", () => {
    expect(sql).not.toMatch(/DROP|__new_|ALTER TABLE|PRAGMA/i);
    expect([...sql.matchAll(/CREATE TRIGGER `(\w+)`/g)].map((m) => m[1])).toEqual([
      "care_plans_billed_forward",
      "care_plan_terms_after_billed",
      "care_invoices_no_update",
      "care_invoices_no_delete",
      "doc_access_tokens_bound_insert",
      "doc_access_tokens_fixed",
      "clients_care_auto_issue_by_insert",
      "clients_care_auto_issue_by_update",
      "reminders_fixed",
    ]);
    for (const s of billingTriggerStatements().filter((x) => x.startsWith("CREATE TRIGGER"))) {
      const name = /CREATE TRIGGER `(\w+)`/.exec(s)?.[1];
      expect(s).toContain(`RAISE(ABORT, '${name}:`);
    }
  });
  it("the one data statement is the backfill that switches off a toggle with no Owner behind it, and it runs first", () => {
    const statements = billingTriggerStatements();
    expect(statements[0]).toBe(
      "UPDATE clients SET care_auto_issue = 0 WHERE care_auto_issue = 1 AND care_auto_issue_by IS NULL;",
    );
    expect(sql.startsWith("-- Hand-written") && sql.includes("UPDATE clients SET care_auto_issue = 0")).toBe(
      true,
    );
    expect(sql.indexOf("UPDATE clients")).toBeLessThan(sql.indexOf("CREATE TRIGGER"));
  });
});

describe("care_plans_billed_forward: the billed period only moves forward [LD59]", () => {
  it("NULL to a date, then later dates; never back, never the same, never NULL, never a non-date", async () => {
    const owner = await mkMember();
    const p = await mkCarePlan(await mkClientRow(), owner);
    await run("UPDATE care_plans SET last_billed_period = '2026-10-05' WHERE id = ?", p.planId);
    await run("UPDATE care_plans SET last_billed_period = '2026-11-05' WHERE id = ?", p.planId);
    await run("UPDATE care_plans SET last_billed_period = '2026-11-05' WHERE id = ?", p.planId); // no change is not a move
    for (const bad of ["2026-11-05x", "2026-10-05", "2026-11-04", "not a date", "2026-02-30"])
      await rejects(
        run("UPDATE care_plans SET last_billed_period = ? WHERE id = ?", bad, p.planId),
        /care_plans_billed_forward/,
      );
    await rejects(
      run("UPDATE care_plans SET last_billed_period = NULL WHERE id = ?", p.planId),
      /care_plans_billed_forward/,
    );
    expect(
      (await first<{ v: string }>("SELECT last_billed_period AS v FROM care_plans WHERE id = ?", p.planId))
        ?.v,
    ).toBe("2026-11-05");
  });
  it("a first value must be a date too", async () => {
    const owner = await mkMember();
    const p = await mkCarePlan(await mkClientRow(), owner);
    await rejects(
      run("UPDATE care_plans SET last_billed_period = 'soon' WHERE id = ?", p.planId),
      /care_plans_billed_forward/,
    );
  });
});

describe("care_plan_terms_after_billed: terms cannot start on or before a billed period [LD59]", () => {
  it("a later start is fine; the billed day or earlier is refused; a plan never billed is open", async () => {
    const owner = await mkMember();
    const p = await mkCarePlan(await mkClientRow(), owner);
    const insert = (from: string) =>
      run(
        "INSERT INTO care_plan_terms (id, care_plan_id, effective_from, tier, price_minor, included_minutes, rollover, created_by, created_at) VALUES (?1, ?2, ?3, 'growth', 5, 600, 'none', ?4, 3000)",
        `t-${from}-${Math.random()}`,
        p.planId,
        from,
        owner,
      );
    await insert("2026-03-05"); // never billed: any date
    await run("UPDATE care_plans SET last_billed_period = '2026-11-05' WHERE id = ?", p.planId);
    await insert("2026-12-05");
    for (const from of ["2026-11-05", "2026-11-04", "2026-01-05"])
      await rejects(insert(from), /care_plan_terms_after_billed/);
  });
});

describe("care_invoices: the billed-period record is append-only [LD59]", () => {
  it("one row per plan and period (primary key); the document may be cleared once; nothing else changes; no delete", async () => {
    const owner = await mkMember();
    const p = await mkCarePlan(await mkClientRow({ toggleBy: owner }), owner);
    const doc = await mkCareDraft(p);
    await rejects(
      run(
        "INSERT INTO care_invoices (care_plan_id, period_start, period_end, terms_id) VALUES (?, '2026-11-05', '2026-12-04', ?)",
        p.planId,
        p.termsId,
      ),
      /UNIQUE|PRIMARY/,
    );
    for (const [col, value] of [
      ["period_end", "2026-12-05"],
      ["period_start", "2026-12-05"],
      ["terms_id", "other"],
      ["overage_minutes", 15],
      ["overage_period_start", "2026-10-05"],
      ["created_at", 1],
    ] as const)
      await rejects(
        run(`UPDATE care_invoices SET ${col} = ? WHERE care_plan_id = ?`, value, p.planId),
        /care_invoices_no_update/,
      );
    await rejects(
      run("UPDATE care_invoices SET document_id = 'another' WHERE care_plan_id = ?", p.planId),
      /care_invoices_no_update/,
    );
    await rejects(
      run("DELETE FROM care_invoices WHERE care_plan_id = ?", p.planId),
      /care_invoices_no_delete/,
    );
    // a discarded draft: the document is deleted and the record keeps the period with no document, once
    await run("DELETE FROM documents WHERE id = ?", doc);
    await run("UPDATE care_invoices SET document_id = NULL WHERE care_plan_id = ?", p.planId);
    await run("UPDATE care_invoices SET document_id = NULL WHERE care_plan_id = ?", p.planId);
    await rejects(
      run("UPDATE care_invoices SET document_id = 'back' WHERE care_plan_id = ?", p.planId),
      /care_invoices_no_update/,
    );
    expect(
      (await first<{ n: number }>("SELECT count(*) AS n FROM care_invoices WHERE care_plan_id = ?", p.planId))
        ?.n,
    ).toBe(1);
  });
  it("one document, one period (unique where not null)", async () => {
    const owner = await mkMember();
    const p = await mkCarePlan(await mkClientRow(), owner);
    const doc = await mkCareDraft(p);
    await rejects(
      run(
        "INSERT INTO care_invoices (care_plan_id, period_start, period_end, terms_id, document_id) VALUES (?, '2026-12-05', '2027-01-04', ?, ?)",
        p.planId,
        p.termsId,
        doc,
      ),
      /UNIQUE/,
    );
  });
});

describe("doc_access_tokens: an invoice link is bound to a contact, a client and an address [POR-06, LD55]", () => {
  async function world() {
    const owner = await mkMember();
    const clientId = await mkClientRow();
    const contactId = await mkContact(clientId);
    const doc = await mkIssued(clientId);
    const sendId = await mkSend(doc, clientId, contactId, { createdBy: owner });
    return { owner, clientId, contactId, doc, sendId };
  }
  const insert = (v: {
    hash: string;
    doc: string;
    contact: string | null;
    client: string | null;
    email: string | null;
    send?: string | null;
  }) =>
    run(
      "INSERT INTO doc_access_tokens (token_hash, document_id, purpose, expires_at, contact_id, client_id, email, send_id) VALUES (?1, ?2, 'view_pay', 9999999999999, ?3, ?4, ?5, ?6)",
      v.hash,
      v.doc,
      v.contact,
      v.client,
      v.email,
      v.send ?? null,
    );
  it("a bound row is written; with the send it came from, or with none (a reminder's link)", async () => {
    const w = await world();
    await insert({
      hash: "t1",
      doc: w.doc,
      contact: w.contactId,
      client: w.clientId,
      email: "a@example.test",
      send: w.sendId,
    });
    await insert({
      hash: "t2",
      doc: w.doc,
      contact: w.contactId,
      client: w.clientId,
      email: "a@example.test",
    });
  });
  it("an unbound row, an upper-case address, a draft, another client's document, another client's contact or a foreign send is refused", async () => {
    const w = await world();
    const other = await mkClientRow();
    const otherContact = await mkContact(other);
    const otherDoc = await mkIssued(other);
    const draft = await mkCareDraft(await mkCarePlan(w.clientId, w.owner));
    const otherSend = await mkSend(otherDoc, other, otherContact, { createdBy: w.owner });
    const base = { hash: "x", doc: w.doc, contact: w.contactId, client: w.clientId, email: "a@example.test" };
    const bad: [string, { [K in keyof typeof base]?: string | null } & { send?: string }][] = [
      ["no contact", { contact: null }],
      ["no client", { client: null }],
      ["no address", { email: null }],
      ["an upper-case address", { email: "A@example.test" }],
      ["a draft", { doc: draft }],
      ["a document of another client", { doc: otherDoc }],
      ["a contact of another client", { contact: otherContact }],
      ["a send of another document", { send: otherSend }],
      ["a document that does not exist", { doc: "nope" }],
    ];
    for (const [name, over] of bad)
      await rejects(
        insert({ ...base, hash: `bad-${name}`, ...over } as Parameters<typeof insert>[0]),
        /doc_access_tokens_bound_insert/,
      );
    // and a send of the same document but to another contact is refused
    const second = await mkContact(w.clientId);
    await rejects(
      insert({ ...base, hash: "bad-send-contact", contact: second, send: w.sendId }),
      /doc_access_tokens_bound_insert/,
    );
  });
  it("only revoked_at may change, once", async () => {
    const w = await world();
    await insert({
      hash: "t3",
      doc: w.doc,
      contact: w.contactId,
      client: w.clientId,
      email: "a@example.test",
    });
    for (const [col, v] of [
      ["expires_at", 5],
      ["contact_id", "x"],
      ["client_id", "x"],
      ["email", "b@example.test"],
      ["send_id", "x"],
      ["document_id", "x"],
      ["purpose", "view_pay"],
      ["created_at", 5],
      ["token_hash", "t9"],
    ] as const) {
      if (col === "purpose") continue; // same value is not a change
      await rejects(
        run(`UPDATE doc_access_tokens SET ${col} = ? WHERE token_hash = 't3'`, v),
        /doc_access_tokens_fixed/,
      );
    }
    await run("UPDATE doc_access_tokens SET revoked_at = 10 WHERE token_hash = 't3'");
    await rejects(
      run("UPDATE doc_access_tokens SET revoked_at = 11 WHERE token_hash = 't3'"),
      /doc_access_tokens_fixed/,
    );
    await rejects(
      run("UPDATE doc_access_tokens SET revoked_at = NULL WHERE token_hash = 't3'"),
      /doc_access_tokens_fixed/,
    );
    // delete stays open (the erase of a contact removes its links)
    await run("DELETE FROM doc_access_tokens WHERE token_hash = 't3'");
  });
});

describe("clients_care_auto_issue_by: the toggle on names an active Owner [LD58, Q43]", () => {
  it("on names an Owner; off names nobody; at insert and at update", async () => {
    const owner = await mkMember("owner");
    const staff = await mkMember("staff");
    const gone = await mkMember("owner", "deactivated");
    const cols =
      "id, code, legal_name, display_name, type, country, gst_status, state_code, currency, care_auto_issue, care_auto_issue_by";
    const insert = (code: string, on: number, by: string | null) =>
      run(
        `INSERT INTO clients (${cols}) VALUES (?1, ?2, 'L', 'D', 'business', 'IN', 'unregistered', '19', 'INR', ?3, ?4)`,
        `id-${code}`,
        code,
        on,
        by,
      );
    await insert("T-1", 1, owner);
    await insert("T-2", 0, null);
    await rejects(insert("T-3", 1, null), /clients_care_auto_issue_by_insert/);
    await rejects(insert("T-4", 1, staff), /clients_care_auto_issue_by_insert/);
    await rejects(insert("T-5", 1, gone), /clients_care_auto_issue_by_insert/);
    await rejects(insert("T-6", 0, owner), /clients_care_auto_issue_by_insert/);
    // update: turning on needs both at once; Staff cannot name themselves; turning off clears the name
    await rejects(
      run("UPDATE clients SET care_auto_issue = 1 WHERE id = 'id-T-2'"),
      /clients_care_auto_issue_by_update/,
    );
    await rejects(
      run("UPDATE clients SET care_auto_issue = 1, care_auto_issue_by = ? WHERE id = 'id-T-2'", staff),
      /clients_care_auto_issue_by_update/,
    );
    await run("UPDATE clients SET care_auto_issue = 1, care_auto_issue_by = ? WHERE id = 'id-T-2'", owner);
    await rejects(
      run("UPDATE clients SET care_auto_issue = 0 WHERE id = 'id-T-2'"),
      /clients_care_auto_issue_by_update/,
    );
    await run("UPDATE clients SET care_auto_issue = 0, care_auto_issue_by = NULL WHERE id = 'id-T-2'");
    await rejects(
      run("UPDATE clients SET care_auto_issue_by = ? WHERE id = 'id-T-2'", owner),
      /clients_care_auto_issue_by_update/,
    );
  });
  it("other edits of a client never look at the toggle (the display name, the terms)", async () => {
    const owner = await mkMember();
    const c = await mkClientRow({ toggleBy: owner });
    await run("UPDATE clients SET display_name = 'New', payment_terms_days = 14 WHERE id = ?", c);
    // a toggle left on by an Owner who was deactivated later still lets the client be edited (the freeze, not this trigger, stops the issue)
    await run(
      "UPDATE staff_users SET status = 'deactivated' WHERE id = ? AND (SELECT count(*) FROM staff_users WHERE role = 'owner' AND status = 'active') > 1",
      owner,
    );
    await run("UPDATE clients SET notes = 'x' WHERE id = ?", c);
  });
});

describe("reminders_fixed: a reminder keeps its identity and moves only the allowed ways [LD60]", () => {
  async function one(over: Parameters<typeof mkReminder>[3] = {}) {
    const doc = await mkIssued(await mkClientRow());
    return mkReminder(doc, 3, 5_000, over);
  }
  it("the document, the offset and the due time never change", async () => {
    const id = await one();
    for (const [col, v] of [
      ["document_id", "other"],
      ["offset_days", 4],
      ["due_at", 6_000],
    ] as const)
      await rejects(run(`UPDATE reminders SET ${col} = ? WHERE id = ?`, v, id), /reminders_fixed/);
  });
  it("sent_at: NULL to a value once; never changed after; a give-back to NULL only while no email is recorded", async () => {
    const id = await one();
    await run("UPDATE reminders SET sent_at = 6000 WHERE id = ?", id);
    await rejects(run("UPDATE reminders SET sent_at = 7000 WHERE id = ?", id), /reminders_fixed/);
    await run("UPDATE reminders SET sent_at = NULL WHERE id = ?", id); // the give-back (email_log_id still NULL)
    await run("UPDATE reminders SET sent_at = 8000 WHERE id = ?", id);
    await run("UPDATE reminders SET email_log_id = 'log1' WHERE id = ?", id);
    await rejects(run("UPDATE reminders SET sent_at = NULL WHERE id = ?", id), /reminders_fixed/);
    await rejects(run("UPDATE reminders SET email_log_id = 'log2' WHERE id = ?", id), /reminders_fixed/);
    await rejects(run("UPDATE reminders SET email_log_id = NULL WHERE id = ?", id), /reminders_fixed/);
  });
  it("skipped_reason: empty and paused go back and forth; empty to a final value once; a final value is fixed", async () => {
    const id = await one();
    await run("UPDATE reminders SET skipped_reason = 'paused' WHERE id = ?", id);
    await run("UPDATE reminders SET skipped_reason = NULL WHERE id = ?", id);
    await run("UPDATE reminders SET skipped_reason = 'paused' WHERE id = ?", id);
    await run("UPDATE reminders SET skipped_reason = NULL WHERE id = ?", id);
    await run("UPDATE reminders SET skipped_reason = 'void' WHERE id = ?", id);
    for (const v of ["paused", "superseded", null, "void2"])
      await rejects(run("UPDATE reminders SET skipped_reason = ? WHERE id = ?", v, id), /reminders_fixed/);
  });
  it("a paused row cannot jump to a final value (it is resumed or it stays)", async () => {
    const id = await one({ skipped: "paused" });
    await rejects(run("UPDATE reminders SET skipped_reason = 'void' WHERE id = ?", id), /reminders_fixed/);
  });
  it("the one row per (document, offset) is the unique key", async () => {
    const doc = await mkIssued(await mkClientRow());
    await mkReminder(doc, 3, 5_000);
    await rejects(mkReminder(doc, 3, 6_000), /UNIQUE/);
  });
});
