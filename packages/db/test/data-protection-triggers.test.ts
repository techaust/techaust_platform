// M7.4 data-protection tooling in the database [ADM-SET-09, ADM-CLI-05, FRM-05, NFR-9, ADM-AUD-03; run file docs/runs/m7.4-data-protection.md A, I "Triggers",
// L23–L36]: 0078 only creates and adds; 0079 regenerates byte for byte and its lists equal core's; every rule of `data_protection_triggers` accepts and refuses,
// and the triggers that write (legal hold mirror, outbox, erasure stop, receipts' hash and end, the request clock) write exactly what they should. Raw SQL on
// purpose: the triggers are the subject. Every name, address, id and amount is invented test data. Times are relative to now: the triggers read the clock.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { CONSENT_EVENTS, CONSENT_SOURCES, PURPOSES } from "@techaust/core/consent";
import {
  CHANNELS,
  DECLINE_REASONS,
  EMAIL_ONLY_DECLINE_REASONS,
  ERASURE_ACTIONS,
  IDENTITY_CHECKED_KINDS,
  REQUEST_KINDS,
  requestDueAt,
} from "@techaust/core/dsr";
import { LEGAL_HOLD_ACTIONS, LEGAL_HOLD_ENTITY_TYPES } from "@techaust/core/legal-hold";
import { pdfKeys } from "@techaust/core/pdf-jobs";
import { FLOORED_FAMILIES, RETENTION_FAMILIES, RETENTION_MODES } from "@techaust/core/retention";
import { describe, expect, it } from "vitest";
import { HELD_LEAD_SQL } from "../src/contact-access.ts";
import { triggerMigrationSql } from "../src/triggers.ts";
import {
  CHANNELS_0079,
  CONSENT_EVENTS_0079,
  CONSENT_SOURCES_0079,
  DECLINE_REASONS_0079,
  dataProtectionBackfill,
  dataProtectionTriggerStatements,
  EMAIL_ONLY_DECLINE_REASONS_0079,
  ERASURE_ACTIONS_0079,
  IDENTITY_CHECKED_KINDS_0079,
  LEGAL_HOLD_ACTIONS_0079,
  LEGAL_HOLD_ENTITY_TYPES_0079,
  PDF_STEM_SQL,
  PURPOSES_0079,
  REQUEST_KINDS_0079,
  RETENTION_FAMILIES_0079,
  RETENTION_MODES_0079,
} from "../src/triggers-data-protection.ts";
import { mkClientRow, mkContact, mkMember } from "./billing-helpers.ts";
import { all, first, REQUEST_CLOCK_COLS, rejects, requestClockOf, run } from "./helpers.ts";
import { mkQuote, send } from "./quotes.ts";

const DAY = 86_400_000;
const ago = (days: number) => Date.now() - days * DAY;
const H = (c: string) => c.repeat(64);
const migration = (name: string) => env.TEST_MIGRATIONS.find((m) => m.name === name);
const statementsOf = (name: string) =>
  (migration(name)?.queries ?? []).map((q) => q.replace(/^--[^\n]*\n?/gm, "").trim()).filter((q) => q !== "");
const count = async (sql: string, ...p: unknown[]) => (await first<{ n: number }>(sql, ...p))?.n ?? -1;

async function mkLead(
  over: { email?: string; clientId?: string | null; held?: boolean } = {},
): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO leads (id, ref, source, contact_name, contact_email, client_id, legal_hold) VALUES (?1, ?2, 'web', 'Pat', ?3, ?4, ?5)",
    id,
    `L-${id.slice(-8)}`,
    over.email ?? `${id}@example.test`,
    over.clientId ?? null,
    over.held ? 1 : 0,
  );
  return id;
}
const receipt = (o: {
  leadId?: string | null;
  contactId?: string | null;
  hash?: string | null;
  at?: number;
  event?: string;
  source?: string;
}) =>
  run(
    `INSERT INTO consent_receipts (id, subject_hash, lead_id, contact_id, event, source, notice_version, purposes, marketing, ip_hash, at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, '1.0', '["respond_to_enquiry"]', 0, NULL, ?7)`,
    uuidv7(),
    o.hash ?? null,
    o.leadId ?? null,
    o.contactId ?? null,
    o.event ?? "grant",
    o.source ?? "web_form",
    o.at ?? ago(1),
  );
const suppress = (email: string, reason = "hard_bounce") =>
  run("INSERT INTO email_suppressions (email, reason, at) VALUES (?1, ?2, 1)", email, reason);
const stops = () =>
  all<{ email: string; reason: string }>("SELECT email, reason FROM email_suppressions ORDER BY email");
const hold = (owner: string, entityType: string, entityId: string, action: "set" | "clear") =>
  run(
    "INSERT INTO legal_holds (id, entity_type, entity_id, action, reason, by) VALUES (?1, ?2, ?3, ?4, 'GST notice', ?5)",
    uuidv7(),
    entityType,
    entityId,
    action,
    owner,
  );

describe("0078 and 0079 [run file A, I]", () => {
  it("0078 only creates tables and indexes and adds columns (no referenced table rebuilt, nothing dropped)", () => {
    for (const q of statementsOf("0078_data_protection.sql"))
      expect(q).toMatch(/^(CREATE TABLE `|CREATE (UNIQUE )?INDEX `|ALTER TABLE `[a-z_]+` ADD `)/);
  });
  it("0079 regenerates byte for byte from the generator", () => {
    const m = migration("0079_data_protection_triggers.sql");
    expect(m).toBeDefined();
    const generated = triggerMigrationSql("data_protection_triggers")
      .split("\n--> statement-breakpoint\n")
      .map((q) => q.replace(/^--[^\n]*\n?/gm, "").trim());
    // readD1Migrations may drop a statement's final semicolon; the text is otherwise the generator's.
    const norm = (xs: string[]) => xs.map((q) => q.replace(/\s+/g, " ").trim().replace(/;$/, ""));
    const applied = norm(statementsOf("0079_data_protection_triggers.sql"));
    const want = norm(generated.filter((q) => q !== ""));
    expect(applied.length).toBe(want.length);
    for (let i = 0; i < want.length; i++) expect(applied[i], `statement ${i}`).toBe(want[i]);
  });
  it("the frozen lists equal core's", () => {
    expect(REQUEST_KINDS_0079).toEqual(REQUEST_KINDS);
    expect(CHANNELS_0079).toEqual(CHANNELS);
    expect(DECLINE_REASONS_0079).toEqual(DECLINE_REASONS);
    expect(EMAIL_ONLY_DECLINE_REASONS_0079).toEqual(EMAIL_ONLY_DECLINE_REASONS);
    expect(ERASURE_ACTIONS_0079).toEqual(ERASURE_ACTIONS);
    expect(IDENTITY_CHECKED_KINDS_0079).toEqual(IDENTITY_CHECKED_KINDS);
    expect(LEGAL_HOLD_ENTITY_TYPES_0079).toEqual(LEGAL_HOLD_ENTITY_TYPES);
    expect(LEGAL_HOLD_ACTIONS_0079).toEqual(LEGAL_HOLD_ACTIONS);
    expect(CONSENT_EVENTS_0079).toEqual(CONSENT_EVENTS);
    expect(CONSENT_SOURCES_0079).toEqual(CONSENT_SOURCES);
    expect(PURPOSES_0079).toEqual(PURPOSES);
    expect(RETENTION_FAMILIES_0079).toEqual(RETENTION_FAMILIES);
    expect(RETENTION_MODES_0079).toEqual(RETENTION_MODES);
  });
  it("every floor trigger core names is installed; every trigger name of the set is new", async () => {
    const installed = new Set(
      (await all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger'")).map(
        (r) => r.name,
      ),
    );
    for (const names of Object.values(FLOORED_FAMILIES))
      for (const n of names) expect(installed.has(n), n).toBe(true);
    const created = dataProtectionTriggerStatements()
      .map((s) => /^CREATE TRIGGER `([^`]+)`/.exec(s)?.[1])
      .filter((n): n is string => n !== undefined);
    expect(new Set(created).size).toBe(created.length);
    for (const n of created) expect(installed.has(n), n).toBe(true);
  });
});

describe("floors no setting can cross (366 days, L34)", () => {
  it("access_log, email_log, email_events: refused at 365 days, allowed at 367", async () => {
    for (const [days, ok] of [
      [365, false],
      [367, true],
    ] as const) {
      const a = uuidv7(ago(days));
      await run(
        "INSERT INTO access_log (id, at, realm, method, route, status) VALUES (?1, ?2, 'admin', 'GET', '/x', 200)",
        a,
        ago(days),
      );
      const e = uuidv7();
      await run(
        "INSERT INTO email_log (id, to_email, template, created_at, updated_at) VALUES (?1, 'x@example.test', 'lead.ack', ?2, ?2)",
        e,
        ago(days),
      );
      const v = uuidv7();
      await run(
        "INSERT INTO email_events (id, ses_message_id, type, outcome, received_at) VALUES (?1, 'm', 'delivery', 'applied', ?2)",
        v,
        ago(days),
      );
      const del = [
        run("DELETE FROM access_log WHERE id = ?1", a),
        run("DELETE FROM email_log WHERE id = ?1", e),
        run("DELETE FROM email_events WHERE id = ?1", v),
      ];
      if (ok) await Promise.all(del);
      else {
        await rejects(del[0] as Promise<unknown>, /access_log_delete_floor/);
        await rejects(del[1] as Promise<unknown>, /email_log_delete_floor/);
        await rejects(del[2] as Promise<unknown>, /email_events_delete_floor/);
      }
    }
  });
  it("an old email row changed within the year is kept (max of created and updated)", async () => {
    const e = uuidv7();
    await run(
      "INSERT INTO email_log (id, to_email, template, created_at, updated_at) VALUES (?1, 'x@example.test', 'lead.ack', ?2, ?3)",
      e,
      ago(400),
      ago(10),
    );
    await rejects(run("DELETE FROM email_log WHERE id = ?1", e), /email_log_delete_floor/);
  });
  it("client_requests: an open request is never deleted; a closed one only 366 days after it closed", async () => {
    const owner = await mkMember("owner");
    const client = await mkClientRow();
    const mk = async (closedDaysAgo: number | null) => {
      const id = uuidv7();
      await run(
        `INSERT INTO client_requests (id, client_id, kind, details, created_at, updated_at, ${REQUEST_CLOCK_COLS}) VALUES (?1, ?2, 'grievance', 'x', ?3, ?3, ${requestClockOf("?3")})`,
        id,
        client,
        ago(800),
      );
      if (closedDaysAgo !== null)
        await run(
          "UPDATE client_requests SET status = 'closed', outcome = 'done', closed_by = ?2, closed_at = ?3, updated_at = ?3 WHERE id = ?1",
          id,
          owner,
          ago(closedDaysAgo),
        );
      return id;
    };
    await rejects(
      run("DELETE FROM client_requests WHERE id = ?1", await mk(null)),
      /client_requests_delete_guard/,
    );
    await rejects(
      run("DELETE FROM client_requests WHERE id = ?1", await mk(365)),
      /client_requests_delete_guard/,
    );
    await run("DELETE FROM client_requests WHERE id = ?1", await mk(367));
  });
});

describe("legal hold (A.2, L3, L6)", () => {
  it("the history mirrors the flag; set only by an active Owner, only when the state changes; never changed or deleted", async () => {
    const owner = await mkMember("owner");
    const staff = await mkMember("staff");
    const client = await mkClientRow();
    await rejects(hold(staff, "client", client, "set"), /legal_holds_values/);
    await rejects(hold(owner, "client", client, "clear"), /legal_holds_values/);
    await rejects(hold(owner, "project", client, "set"), /legal_holds_values/);
    await rejects(hold(owner, "client", "no-such-id", "set"), /legal_holds_values/);
    await hold(owner, "client", client, "set");
    expect((await first("SELECT legal_hold FROM clients WHERE id = ?1", client))?.legal_hold).toBe(1);
    await rejects(hold(owner, "client", client, "set"), /legal_holds_values/);
    await hold(owner, "client", client, "clear");
    expect((await first("SELECT legal_hold FROM clients WHERE id = ?1", client))?.legal_hold).toBe(0);
    await rejects(run("UPDATE legal_holds SET reason = 'x'"), /legal_holds_no_update/);
    await rejects(run("DELETE FROM legal_holds"), /legal_holds_no_delete/);
    const anon = await mkContact(client, { anonymised: true });
    await rejects(hold(owner, "contact", anon, "set"), /legal_holds_values/);
  });

  it("a held contact (itself, its client or a lead of the person) is neither erased nor anonymised; clearing the hold allows both", async () => {
    const owner = await mkMember("owner");
    const client = await mkClientRow();
    const c = await mkContact(client, { email: "held@example.test" });
    const anonymise = () => run("UPDATE contacts SET anonymised_at = 9 WHERE id = ?1", c);
    for (const [type, id] of [
      ["contact", c],
      ["client", client],
    ] as const) {
      await hold(owner, type, id, "set");
      await rejects(run("DELETE FROM contacts WHERE id = ?1", c), /contacts_held_no_delete/);
      await rejects(anonymise(), /contacts_held_no_anonymise/);
      await hold(owner, type, id, "clear");
    }
    const lead = await mkLead({ email: "held@example.test" });
    await hold(owner, "lead", lead, "set");
    await rejects(anonymise(), /contacts_held_no_anonymise/);
    await rejects(run("DELETE FROM leads WHERE id = ?1", lead), /leads_held_no_delete/);
    await hold(owner, "lead", lead, "clear");
    await run("DELETE FROM leads WHERE id = ?1", lead);
    await anonymise();
  });

  it("a held client is not anonymised, and its files and notes are not deleted (L6)", async () => {
    const owner = await mkMember("owner");
    const client = await mkClientRow();
    const file = uuidv7();
    await run(
      "INSERT INTO files (id, client_id, r2_key, filename, mime, size, sha256) VALUES (?1, ?2, ?3, 'a.pdf', 'application/pdf', 1, ?4)",
      file,
      client,
      `files/${file}`,
      H("a"),
    );
    const note = uuidv7();
    await run("INSERT INTO notes (id, client_id, body_md) VALUES (?1, ?2, 'Call notes')", note, client);
    await hold(owner, "client", client, "set");
    await rejects(
      run("UPDATE clients SET anonymised_at = 9 WHERE id = ?1", client),
      /clients_held_no_anonymise/,
    );
    await rejects(run("DELETE FROM files WHERE id = ?1", file), /files_held_no_delete/);
    await rejects(run("DELETE FROM notes WHERE id = ?1", note), /notes_held_no_delete/);
    await hold(owner, "client", client, "clear");
    await run("DELETE FROM files WHERE id = ?1", file);
    await run("DELETE FROM notes WHERE id = ?1", note);
  });

  it("an offer of a held client is not redacted; clearing the hold allows it", async () => {
    const owner = await mkMember("owner");
    const q = await mkQuote({ type: "proposal" });
    await send(q);
    const redact = () =>
      run(
        "UPDATE documents SET title = 'Website for Anonymised client', redacted_at = ?2, updated_at = updated_at + 1 WHERE id = ?1",
        q.id,
        Date.now(),
      );
    await hold(owner, "client", q.clientId, "set");
    await rejects(redact(), /documents_held_no_redact/);
    await hold(owner, "client", q.clientId, "clear");
    await redact();
  });

  it("early check 1 M2: an offer whose contact has a held lead (its address in another case) is not redacted; a held lead is never marked erased", async () => {
    const owner = await mkMember("owner");
    const q = await mkQuote({ type: "proposal" });
    const contact = await mkContact(q.clientId, { email: "mixed.case@example.test" });
    await run("UPDATE documents SET contact_id = ?2 WHERE id = ?1", q.id, contact);
    await send(q);
    const redact = () =>
      run(
        "UPDATE documents SET title = 'Website for Anonymised client', redacted_at = ?2, updated_at = updated_at + 1 WHERE id = ?1",
        q.id,
        Date.now(),
      );
    const lead = await mkLead({ email: "Mixed.Case@Example.TEST" });
    await hold(owner, "lead", lead, "set");
    await rejects(redact(), /documents_held_no_redact/);
    await rejects(
      run("UPDATE leads SET erased_hash = ?2 WHERE id = ?1", lead, H("e")),
      /leads_held_no_erase/,
    );
    // writing the column without changing it is not an erasure (the anonymise's matched-leads UPDATE binds NULL for another address)
    await run("UPDATE leads SET erased_hash = NULL WHERE id = ?1", lead);
    await hold(owner, "lead", lead, "clear");
    await run("UPDATE leads SET erased_hash = ?2 WHERE id = ?1", lead, H("e"));
    await redact();
  });

  it("early check 1 M1: a lead held under its address in capitals holds the contact (erase and anonymise), and HELD_LEAD_SQL sees it", async () => {
    const owner = await mkMember("owner");
    const client = await mkClientRow();
    const c = await mkContact(client, { email: "capitals@example.test" });
    const lead = await mkLead({ email: "Capitals@Example.Test" });
    const held = () =>
      first<{ held: number }>(`SELECT ${HELD_LEAD_SQL} AS held FROM contacts c WHERE c.id = ?1`, c).then(
        (r) => r?.held,
      );
    expect(await held()).toBe(0);
    await hold(owner, "lead", lead, "set");
    expect(await held()).toBe(1);
    await rejects(run("DELETE FROM contacts WHERE id = ?1", c), /contacts_held_no_delete/);
    await rejects(
      run("UPDATE contacts SET anonymised_at = 9 WHERE id = ?1", c),
      /contacts_held_no_anonymise/,
    );
    await hold(owner, "lead", lead, "clear");
    expect(await held()).toBe(0);
    // a held lead converted to another client, under the same address in capitals, does not hold this contact
    const other = await mkLead({ email: "CAPITALS@example.test", clientId: await mkClientRow(), held: true });
    expect(await held()).toBe(0);
    expect(
      (await first<{ legal_hold: number }>("SELECT legal_hold FROM leads WHERE id = ?1", other))?.legal_hold,
    ).toBe(1);
    await run("DELETE FROM contacts WHERE id = ?1", c);
  });

  it("early check 1 M1: HELD_LEAD_SQL reads leads_contact and leads_contact_email_lower (EXPLAIN; the trigger's check has the same shape)", async () => {
    const plan = (
      await all<{ detail: string }>(
        `EXPLAIN QUERY PLAN SELECT ${HELD_LEAD_SQL} FROM contacts c WHERE c.id = ?1`,
        "x",
      )
    )
      .map((r) => r.detail)
      .join(" | ");
    expect(plan).toMatch(/leads_contact_email_lower/);
    expect(plan).toMatch(/USING INDEX leads_contact\b/);
    expect(plan).not.toMatch(/SCAN l\b|SCAN leads\b/);
  });
});

describe("the anonymised lock (A.3; never on payments, review fix 20)", () => {
  it("an anonymised client takes no project, note, file, contact or document; a payment still goes in", async () => {
    const client = await mkClientRow();
    await run("UPDATE clients SET anonymised_at = 9 WHERE id = ?1", client);
    await rejects(
      run(
        "INSERT INTO projects (id, code, client_id, name, currency) VALUES (?1, 'P-1', ?2, 'Site', 'INR')",
        uuidv7(),
        client,
      ),
      /projects_anonymised_lock/,
    );
    await rejects(
      run("INSERT INTO notes (id, client_id, body_md) VALUES (?1, ?2, 'x')", uuidv7(), client),
      /notes_anonymised_lock/,
    );
    await rejects(
      run(
        "INSERT INTO files (id, client_id, r2_key, filename, mime, size, sha256) VALUES (?1, ?2, ?3, 'a.pdf', 'application/pdf', 1, ?4)",
        uuidv7(),
        client,
        `files/${uuidv7()}`,
        H("b"),
      ),
      /files_anonymised_lock/,
    );
    await rejects(mkContact(client), /contacts_anonymised_lock/);
    await rejects(
      run(
        "INSERT INTO documents (id, type, status, client_id, currency, series, content_sha256) VALUES (?1, 'tax_invoice', 'draft', ?2, 'INR', 'inv', ?3)",
        uuidv7(),
        client,
        H("c"),
      ),
      /documents_anonymised_lock/,
    );
    const owner = await mkMember("owner");
    await run(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at)
       VALUES (?1, ?2, 'payment', 'manual', 'pending_verification', 'INR', 1000, '2026-11-04', 'neft', ?3, 1000)`,
      uuidv7(),
      client,
      owner,
    );
    const installed = await all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%_anonymised_lock' ORDER BY name",
    );
    expect(installed.map((r) => r.name)).toEqual(
      ["care_plans", "contacts", "documents", "files", "milestones", "notes", "projects", "time_logs"].map(
        (t) => `${t}_anonymised_lock`,
      ),
    );
  });

  it("an anonymised client keeps its removed details removed (the GSTIN step: the next test)", async () => {
    const client = await mkClientRow();
    await run("UPDATE clients SET legal_name = 'Anonymised client', anonymised_at = 9 WHERE id = ?1", client);
    await rejects(
      run("UPDATE clients SET legal_name = 'Back' WHERE id = ?1", client),
      /clients_anonymised_frozen/,
    );
    await rejects(run("UPDATE clients SET notes = 'x' WHERE id = ?1", client), /clients_anonymised_frozen/);
    await rejects(
      run("UPDATE clients SET anonymised_at = NULL WHERE id = ?1", client),
      /clients_anonymised_frozen/,
    );
    await run("UPDATE clients SET updated_at = updated_at + 1 WHERE id = ?1", client);
  });

  it("early check 1 L3 (Step 0.3(b)): the GSTIN step is allowed for an anonymised individual only; a business keeps its GSTIN", async () => {
    const registered = async (type: "individual" | "business", gstin: string) => {
      const id = uuidv7();
      await run(
        `INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, gstin, state_code, currency)
         VALUES (?1, ?2, 'Legal', 'Display', ?3, 'IN', 'registered', ?4, '19', 'INR')`,
        id,
        `C-G${id.slice(-6)}`,
        type,
        gstin,
      );
      await run("UPDATE clients SET legal_name = 'Anonymised client', anonymised_at = 9 WHERE id = ?1", id);
      return id;
    };
    const clear = (id: string) =>
      run("UPDATE clients SET gstin = NULL, gst_status = 'unregistered' WHERE id = ?1", id);
    const business = await registered("business", "19ABCDE1234F1Z5");
    await rejects(clear(business), /clients_anonymised_frozen/);
    const person = await registered("individual", "19AAACT2727Q1ZA");
    await clear(person);
    expect(await first("SELECT gstin, gst_status FROM clients WHERE id = ?1", person)).toEqual({
      gstin: null,
      gst_status: "unregistered",
    });
  });
});

describe("the R2 outbox (A.4; T7 F2)", () => {
  it("a deleted file queues its key once", async () => {
    const client = await mkClientRow();
    const id = uuidv7();
    await run(
      "INSERT INTO files (id, client_id, r2_key, filename, mime, size, sha256) VALUES (?1, ?2, ?3, 'a.pdf', 'application/pdf', 1, ?4)",
      id,
      client,
      `files/${id}`,
      H("d"),
    );
    await run("DELETE FROM files WHERE id = ?1", id);
    expect(
      await all("SELECT bucket, key, reason, attempts FROM r2_deletions WHERE key = ?1", `files/${id}`),
    ).toEqual([{ bucket: "files", key: `files/${id}`, reason: "row_deleted", attempts: 0 }]);
  });

  it("early check 1 L8: a key already queued is skipped; a key that can't fit (over 512) aborts the delete instead of losing the object", async () => {
    const client = await mkClientRow();
    const file = async (key: string) => {
      const id = uuidv7();
      await run(
        "INSERT INTO files (id, client_id, r2_key, filename, mime, size, sha256) VALUES (?1, ?2, ?3, 'a.pdf', 'application/pdf', 1, ?4)",
        id,
        client,
        key,
        H("f"),
      );
      return id;
    };
    const queued = `files/${uuidv7()}`;
    await run("INSERT INTO r2_deletions (bucket, key, reason) VALUES ('files', ?1, 'orphan')", queued);
    await run("DELETE FROM files WHERE id = ?1", await file(queued));
    expect(await all("SELECT reason FROM r2_deletions WHERE key = ?1", queued)).toEqual([
      { reason: "orphan" },
    ]);
    const long = await file(`files/${"x".repeat(520)}`);
    await rejects(run("DELETE FROM files WHERE id = ?1", long), /r2_deletions_key_length|CHECK/);
    expect(await count("SELECT count(*) AS n FROM files WHERE id = ?1", long)).toBe(1);
    // the longest key the redaction derives is far under 512
    const longest = await first<{ n: number }>(
      `SELECT length(${PDF_STEM_SQL("d")} || '.json') AS n FROM (SELECT 'abcdefghijklmnopqrstuvwx' AS type, '9900' AS fy, 999999999 AS number, 999 AS version) d`,
    );
    expect(longest?.n).toBeLessThan(80);
  });

  it("a redacted offer queues its stored keys and the keys pdfKeys derives (the SQL twin)", async () => {
    const q = await mkQuote({ type: "proposal" });
    await send(q);
    const d = await first<{ type: string; fy: string; number: number; version: number }>(
      "SELECT type, fy, number, version FROM documents WHERE id = ?1",
      q.id,
    );
    if (!d) throw new Error("no offer");
    await run("UPDATE documents SET snapshot_r2_key = 'docs/stored.json' WHERE id = ?1", q.id);
    await run(
      "UPDATE documents SET title = 'Website for Anonymised client', redacted_at = ?2, updated_at = updated_at + 1 WHERE id = ?1",
      q.id,
      Date.now(),
    );
    const keys = (
      await all<{ key: string }>(
        "SELECT key FROM r2_deletions WHERE bucket = 'docs' AND reason = 'redacted' ORDER BY key",
      )
    ).map((r) => r.key);
    const k = pdfKeys({
      type: d.type,
      fy: `20${d.fy.slice(0, 2)}-${d.fy.slice(2)}`,
      number: d.number,
      version: d.version,
    });
    expect(keys).toEqual(expect.arrayContaining(["docs/stored.json", k.snapshot, k.pdf]));
  });

  it("PDF_STEM_SQL equals core pdfKeys, and is NULL for a row without a valid number or FY", async () => {
    for (const [type, fy, number, version] of [
      ["proposal", "2627", 3, 1],
      ["estimate", "9900", 12345, 12],
      ["tax_invoice", "2930", 1, 1],
    ] as const) {
      const row = await first<{ stem: string }>(
        `SELECT ${PDF_STEM_SQL("d")} AS stem FROM (SELECT ?1 AS type, ?2 AS fy, ?3 AS number, ?4 AS version) d`,
        type,
        fy,
        number,
        version,
      );
      const k = pdfKeys({
        type,
        fy: `${fy === "9900" ? "2099" : `20${fy.slice(0, 2)}`}-${fy.slice(2)}`,
        number,
        version,
      });
      expect(`${row?.stem}.pdf`).toBe(k.pdf);
    }
    for (const [fy, number] of [
      ["2628", 3],
      [null, 3],
      ["2627", null],
      ["26-7", 3],
    ] as const) {
      const row = await first<{ stem: string | null }>(
        `SELECT ${PDF_STEM_SQL("d")} AS stem FROM (SELECT 'proposal' AS type, ?1 AS fy, ?2 AS number, 1 AS version) d`,
        fy,
        number,
      );
      expect(row?.stem).toBeNull();
    }
  });
});

describe("the erasure stop (A.5; RB-46; L20, L24, L26, L27, round 5)", () => {
  it("a contact erase (hash, then delete): one h: row, the plain bounce row gone, the receipts stamped and ended, then unlinked", async () => {
    const client = await mkClientRow();
    const c = await mkContact(client, { email: "gone@example.test" });
    await suppress("gone@example.test");
    await receipt({ contactId: c, source: "staff" });
    await run("UPDATE contacts SET erased_hash = ?2 WHERE id = ?1", c, H("1"));
    await run("DELETE FROM contacts WHERE id = ?1", c);
    expect(await stops()).toEqual([{ email: `h:${H("1")}`, reason: "erased" }]);
    const rs = await all<{ subject_hash: string; contact_id: string | null; event: string; source: string }>(
      "SELECT subject_hash, contact_id, event, source FROM consent_receipts WHERE subject_hash = ?1 ORDER BY event",
      H("1"),
    );
    expect(rs).toEqual([
      { subject_hash: H("1"), contact_id: null, event: "ended", source: "erasure" },
      { subject_hash: H("1"), contact_id: null, event: "grant", source: "staff" },
    ]);
  });

  it("walk (c): a contact at client A erased while the same address is live at client B writes no stop and keeps the plain row", async () => {
    const a = await mkClientRow();
    const b = await mkClientRow();
    const ca = await mkContact(a, { email: "both@example.test" });
    await mkContact(b, { email: "both@example.test" });
    await suppress("both@example.test");
    await run("UPDATE contacts SET erased_hash = ?2 WHERE id = ?1", ca, H("2"));
    await run("DELETE FROM contacts WHERE id = ?1", ca);
    expect(await stops()).toEqual(
      expect.arrayContaining([{ email: "both@example.test", reason: "hard_bounce" }]),
    );
    expect((await stops()).some((s) => s.email === `h:${H("2")}`)).toBe(false);
  });

  it("walk (b): a contact erase with one unconverted matched lead gives exactly one h: row and no plain row (L26: the lead's address in another case)", async () => {
    const client = await mkClientRow();
    const c = await mkContact(client, { email: "walk@example.test" });
    const lead = await mkLead({ email: "Walk@Example.test" });
    await receipt({ leadId: lead });
    await suppress("walk@example.test", "complaint");
    // the batch order of clients.ts: matched leads first (address replaced, hash bound), then the contact
    await run(
      "UPDATE leads SET contact_email = 'anon@example.invalid', erased_hash = ?2 WHERE id = ?1",
      lead,
      H("3"),
    );
    await run("UPDATE contacts SET erased_hash = ?2 WHERE id = ?1", c, H("3"));
    await run("DELETE FROM contacts WHERE id = ?1", c);
    expect((await stops()).filter((s) => s.email.includes("walk") || s.email === `h:${H("3")}`)).toEqual([
      { email: `h:${H("3")}`, reason: "erased" },
    ]);
    expect(
      await count(
        "SELECT count(*) AS n FROM consent_receipts WHERE lead_id = ?1 AND subject_hash = ?2",
        lead,
        H("3"),
      ),
    ).toBe(2);
  });

  it("round 5: two leads of one person erased in one statement write exactly one h: row and leave no plain row", async () => {
    const l1 = await mkLead({ email: "two@example.test" });
    const l2 = await mkLead({ email: "two@example.test" });
    await suppress("two@example.test");
    await run("UPDATE leads SET erased_hash = ?3 WHERE id IN (?1, ?2)", l1, l2, H("4"));
    expect((await stops()).filter((s) => s.email.includes("two") || s.email === `h:${H("4")}`)).toEqual([
      { email: `h:${H("4")}`, reason: "erased" },
    ]);
  });

  it("a lead erase with a live contact at the same address writes no stop and keeps the contact's bounce row", async () => {
    const client = await mkClientRow();
    await mkContact(client, { email: "live@example.test" });
    const lead = await mkLead({ email: "live@example.test" });
    await suppress("live@example.test");
    await run("UPDATE leads SET erased_hash = ?2 WHERE id = ?1", lead, H("5"));
    await run("DELETE FROM leads WHERE id = ?1", lead);
    const s = await stops();
    expect(s).toEqual(expect.arrayContaining([{ email: "live@example.test", reason: "hard_bounce" }]));
    expect(s.some((x) => x.email === `h:${H("5")}`)).toBe(false);
  });

  it("the routine purge (a delete with no hash) writes no stop, and the receipts lose only their link", async () => {
    const lead = await mkLead({ email: "aged@example.test" });
    await receipt({ leadId: lead });
    const before = await stops();
    await run("DELETE FROM leads WHERE id = ?1", lead);
    expect(await stops()).toEqual(before);
    expect(
      await count(
        "SELECT count(*) AS n FROM consent_receipts WHERE lead_id IS NULL AND subject_hash IS NULL",
      ),
    ).toBeGreaterThan(0);
  });

  it("an erased hash is 64 hex characters, set once; the stop list holds an h: row only as erased, and never a plain address as erased", async () => {
    const lead = await mkLead();
    await rejects(run("UPDATE leads SET erased_hash = 'short' WHERE id = ?1", lead), /leads_erased_hash/);
    await run("UPDATE leads SET erased_hash = ?2 WHERE id = ?1", lead, H("6"));
    await rejects(run("UPDATE leads SET erased_hash = ?2 WHERE id = ?1", lead, H("7")), /leads_erased_hash/);
    await rejects(suppress("someone@example.test", "erased"), /email_suppressions_reason/);
    await rejects(suppress(`h:${H("8")}`, "manual"), /email_suppressions_reason/);
    await rejects(suppress("h:ABC", "erased"), /email_suppressions_reason/);
  });
});

describe("client_requests: kinds, clock, steps and close (A.1, A.6, L28; RB-47)", () => {
  it("a portal request is refused without its clock, or with one not from its created_at", async () => {
    const client = await mkClientRow();
    const at = Date.UTC(2027, 0, 31, 4, 30);
    await rejects(
      run(
        "INSERT INTO client_requests (id, client_id, kind, details, created_at, updated_at) VALUES (?1, ?2, 'grievance', 'x', ?3, ?3)",
        uuidv7(),
        client,
        at,
      ),
      /client_requests_clock_insert/,
    );
    await rejects(
      run(
        `INSERT INTO client_requests (id, client_id, kind, details, created_at, updated_at, ${REQUEST_CLOCK_COLS}) VALUES (?1, ?2, 'grievance', 'x', ?3, ?3, ${requestClockOf("?4")})`,
        uuidv7(),
        client,
        at,
        at - DAY,
      ),
      /client_requests_clock_insert/,
    );
  });

  it("a portal request writes its clock from created_at (core requestDueAt, 48 hours)", async () => {
    const client = await mkClientRow();
    const id = uuidv7();
    const at = Date.UTC(2026, 0, 31, 4, 30); // a past day: a request never arrives in the future
    await run(
      `INSERT INTO client_requests (id, client_id, kind, details, created_at, updated_at, ${REQUEST_CLOCK_COLS}) VALUES (?1, ?2, 'consent_withdrawal', NULL, ?3, ?3, ${requestClockOf("?3")})`,
      id,
      client,
      at,
    );
    expect(
      await first("SELECT received_at, due_at, ack_due_at, channel FROM client_requests WHERE id = ?1", id),
    ).toEqual({
      received_at: at,
      due_at: requestDueAt(at),
      ack_due_at: at + 48 * 3_600_000,
      channel: "portal",
    });
  });

  it("the SQL twin equals core requestDueAt across month ends, leap days and the IST day boundary", async () => {
    const times = [
      Date.UTC(2027, 0, 30, 18, 29),
      Date.UTC(2027, 0, 30, 18, 31),
      Date.UTC(2028, 0, 29, 20, 0),
      Date.UTC(2026, 5, 30, 20, 30),
      Date.UTC(2026, 11, 31, 10, 0),
      Date.UTC(2027, 2, 31, 10, 0),
    ];
    for (let i = 0; i < 60; i++) times.push(Date.UTC(2026, 0, 1) + i * 6 * DAY + i * 3_600_000);
    const { requestDueAtSql } = await import("@techaust/core/dsr");
    for (const t of times) {
      const row = await first<{ due: number }>(`SELECT ${requestDueAtSql("?1")} AS due`, t);
      expect(row?.due, new Date(t).toISOString()).toBe(requestDueAt(t));
    }
  });

  it("staff log a request with its clock and their id; the clock is checked; an erasure names a subject; a converted lead is never one", async () => {
    const staff = await mkMember("staff");
    const client = await mkClientRow();
    const ins = (o: {
      channel?: string;
      by?: string | null;
      kind?: string;
      received?: number;
      due?: number;
      ack?: number;
      clientId?: string | null;
      email?: string | null;
      leadId?: string | null;
    }) => {
      const received = o.received ?? ago(3);
      return run(
        `INSERT INTO client_requests (id, client_id, lead_id, lead_ref, requester_email, kind, details, channel, logged_by, received_at, due_at, ack_due_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`,
        uuidv7(),
        o.clientId === undefined ? client : o.clientId,
        o.leadId ?? null,
        o.email ?? null,
        o.kind ?? "data_access",
        o.channel ?? "email",
        o.by === undefined ? staff : o.by,
        received,
        o.due ?? requestDueAt(received),
        o.ack ?? received + 48 * 3_600_000,
        Date.now(),
      );
    };
    await ins({});
    await rejects(ins({ by: null }), /client_requests_clock_insert/);
    await rejects(ins({ channel: "portal" }), /client_requests_clock_insert/);
    await rejects(ins({ channel: "fax" }), /client_requests_clock_insert/);
    await rejects(ins({ due: requestDueAt(ago(3)) + 1 }), /client_requests_clock_insert/);
    await rejects(ins({ ack: ago(3) }), /client_requests_clock_insert/);
    await rejects(ins({ received: Date.now() + 2 * DAY }), /client_requests_clock_insert/);
    await rejects(ins({ kind: "data_erasure" }), /client_requests_clock_insert/);
    await ins({ kind: "data_erasure", clientId: null, email: "someone@example.test" });
    const converted = await mkLead({ clientId: client });
    await rejects(
      ins({ clientId: null, leadId: converted, kind: "data_access" }),
      /client_requests_clock_insert/,
    );
    await ins({ clientId: null, leadId: await mkLead(), kind: "data_erasure" });
  });

  it("steps are set once; the clock and the channel never change; close details only with the close", async () => {
    const staff = await mkMember("staff");
    const client = await mkClientRow();
    const id = uuidv7();
    await run(
      `INSERT INTO client_requests (id, client_id, kind, details, created_at, updated_at, ${REQUEST_CLOCK_COLS}) VALUES (?1, ?2, 'grievance', 'x', ?3, ?3, ${requestClockOf("?3")})`,
      id,
      client,
      Date.now(),
    );
    const up = (sql: string, ...p: unknown[]) =>
      run(`UPDATE client_requests SET ${sql} WHERE id = ?1`, id, ...p);
    await up("acknowledged_at = ?2", Date.now());
    await rejects(up("acknowledged_at = ?2", Date.now() + 5), /client_requests_steps/);
    // L42: with no staff member, only the portal sign-in's check (at the time the request arrived)
    await rejects(up("identity_checked_at = received_at + 5"), /client_requests_steps/);
    await rejects(up("identity_checked_by = ?2", staff), /client_requests_steps/);
    await up("identity_checked_at = ?2, identity_checked_by = ?3", Date.now(), staff);
    await rejects(up("identity_checked_by = NULL, identity_checked_at = NULL"), /client_requests_steps/);
    await rejects(up("due_at = due_at + 1"), /client_requests_steps/);
    await rejects(up("channel = 'email'"), /client_requests_steps/);
    await rejects(up("decline_reason = 'other'"), /client_requests_steps/);
  });

  it("L42: a portal request may start checked by its sign-in (when it arrived, no staff member); a staff-logged one never; the check then stays", async () => {
    const staff = await mkMember("staff");
    const client = await mkClientRow();
    const at = Date.now();
    const portal = (checkedAt: number | null, by: string | null = null) =>
      run(
        `INSERT INTO client_requests (id, client_id, kind, details, created_at, updated_at, ${REQUEST_CLOCK_COLS}, identity_checked_at, identity_checked_by)
         VALUES (?1, ?2, 'data_access', NULL, ?3, ?3, ${requestClockOf("?3")}, ?4, ?5)`,
        uuidv7(),
        client,
        at,
        checkedAt,
        by,
      );
    await rejects(portal(at + 1), /client_requests_clock_insert/);
    await rejects(portal(at, staff), /client_requests_clock_insert/);
    await portal(null);
    await portal(at);
    const checked = await first<{ id: string }>(
      "SELECT id FROM client_requests WHERE client_id = ?1 AND identity_checked_at IS NOT NULL",
      client,
    );
    if (!checked) throw new Error("no checked portal request");
    // the sign-in's check is never taken over by a staff member, nor removed
    await rejects(
      run("UPDATE client_requests SET identity_checked_by = ?2 WHERE id = ?1", checked.id, staff),
      /client_requests_steps/,
    );
    await rejects(
      run("UPDATE client_requests SET identity_checked_at = NULL WHERE id = ?1", checked.id),
      /client_requests_steps/,
    );
    // a staff-logged request is never checked "by the sign-in", at insert or later
    const received = ago(2);
    const logged = (checkedAt: number | null) =>
      run(
        `INSERT INTO client_requests (id, client_id, kind, details, channel, logged_by, received_at, due_at, ack_due_at, created_at, updated_at, identity_checked_at)
         VALUES (?1, ?2, 'data_access', NULL, 'email', ?3, ?4, ?5, ?6, ?7, ?7, ?8)`,
        uuidv7(),
        client,
        staff,
        received,
        requestDueAt(received),
        received + 48 * 3_600_000,
        Date.now(),
        checkedAt,
      );
    await rejects(logged(received), /client_requests_clock_insert/);
    await logged(null);
    await rejects(
      run(
        "UPDATE client_requests SET identity_checked_at = received_at WHERE client_id = ?1 AND channel = 'email'",
        client,
      ),
      /client_requests_steps/,
    );
  });

  it("L42: done on access, correction, erasure and nomination needs the identity check; declined does not; other kinds never", async () => {
    const owner = await mkMember("owner");
    const staff = await mkMember("staff");
    const client = await mkClientRow();
    const contact = await mkContact(client);
    const mk = async (kind: string, checked: boolean) => {
      const id = uuidv7();
      const at = Date.now();
      await run(
        `INSERT INTO client_requests (id, client_id, contact_id, contact_ref, kind, details, created_at, updated_at, ${REQUEST_CLOCK_COLS}, identity_checked_at)
         VALUES (?1, ?2, ?3, ?3, ?4, NULL, ?5, ?5, ${requestClockOf("?5")}, ?6)`,
        id,
        client,
        contact,
        kind,
        at,
        checked ? at : null,
      );
      return id;
    };
    const close = (id: string, set: string) =>
      run(
        `UPDATE client_requests SET status = 'closed', closed_by = ?2, closed_at = ?3, ${set} WHERE id = ?1`,
        id,
        owner,
        Date.now(),
      );
    for (const kind of ["data_access", "data_correction", "nomination"]) {
      const unchecked = await mk(kind, false);
      await rejects(close(unchecked, "outcome = 'done'"), /client_requests_close_rules/);
      // a staff member checks, then it closes
      await run(
        "UPDATE client_requests SET identity_checked_at = ?2, identity_checked_by = ?3 WHERE id = ?1",
        unchecked,
        Date.now(),
        staff,
      );
      await close(unchecked, "outcome = 'done'");
      await close(await mk(kind, true), "outcome = 'done'");
      await close(await mk(kind, false), "outcome = 'declined', decline_reason = 'identity_not_confirmed'");
    }
    const erase = await mk("data_erasure", false);
    const auditId = uuidv7();
    await run(
      "INSERT INTO audit_log (id, at, actor_type, actor_id, role, action, entity_type, entity_id, summary) VALUES (?1, ?2, 'staff', ?3, 'owner', 'contact.anonymise', 'client', ?4, ?5)",
      auditId,
      Date.now() + 1_000,
      owner,
      client,
      JSON.stringify({ contactId: contact }),
    );
    await rejects(
      close(erase, `outcome = 'done', action_audit_id = '${auditId}'`),
      /client_requests_close_rules/,
    );
    for (const kind of ["grievance", "contact_change", "consent_withdrawal"])
      await close(await mk(kind, false), "outcome = 'done'");
  });

  it("back-fill (L42): an existing portal request counts as checked by its sign-in, when it arrived", () => {
    expect(dataProtectionBackfill()).toContain(
      "UPDATE client_requests SET identity_checked_at = received_at WHERE channel = 'portal' AND identity_checked_at IS NULL;",
    );
  });

  it("close: a declined request names a known reason; an address-only erasure only declines, for an L28 reason; 'Export sent' only on a done access request", async () => {
    const owner = await mkMember("owner");
    const client = await mkClientRow();
    const mk = async (kind: string, email: string | null = null) => {
      const id = uuidv7();
      await run(
        `INSERT INTO client_requests (id, client_id, requester_email, kind, details, created_at, updated_at, ${REQUEST_CLOCK_COLS}, identity_checked_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?5, ${requestClockOf("?5")}, ?5)`,
        id,
        email ? null : client,
        email,
        kind,
        Date.now(),
      );
      return id;
    };
    const close = (id: string, set: string, ...p: unknown[]) =>
      run(
        `UPDATE client_requests SET status = 'closed', closed_by = ?2, closed_at = ?3, ${set} WHERE id = ?1`,
        id,
        owner,
        Date.now(),
        ...p,
      );
    await rejects(close(await mk("grievance"), "outcome = 'declined'"), /client_requests_close_rules/);
    await rejects(
      close(await mk("grievance"), "outcome = 'declined', decline_reason = 'busy'"),
      /client_requests_close_rules/,
    );
    await rejects(
      close(await mk("grievance"), "outcome = 'done', decline_reason = 'other'"),
      /client_requests_close_rules/,
    );
    await close(await mk("grievance"), "outcome = 'declined', decline_reason = 'duplicate'");
    const e1 = await mk("data_erasure", "a@example.test");
    await rejects(
      close(e1, "outcome = 'declined', decline_reason = 'legal_hold'"),
      /client_requests_close_rules/,
    );
    await rejects(close(e1, "outcome = 'done'"), /client_requests_close_rules/);
    await close(e1, "outcome = 'declined', decline_reason = 'not_on_record'");
    await rejects(
      close(await mk("data_correction"), "outcome = 'done', export_sent_at = 5"),
      /client_requests_close_rules/,
    );
    await close(await mk("data_access"), "outcome = 'done', export_sent_at = ?4", Date.now());
  });

  it("close: a done erasure names the erase of its own contact or lead, made after the request arrived (round 4, round 6)", async () => {
    const owner = await mkMember("owner");
    const client = await mkClientRow();
    const x = await mkContact(client);
    const y = await mkContact(client);
    const lead = await mkLead();
    const audit = async (
      action: string,
      entityType: string,
      entityId: string | null,
      summary: Record<string, unknown>,
      at: number,
    ) => {
      const id = uuidv7();
      await run(
        "INSERT INTO audit_log (id, at, actor_type, actor_id, role, action, entity_type, entity_id, summary) VALUES (?1, ?2, 'staff', ?3, 'owner', ?4, ?5, ?6, ?7)",
        id,
        at,
        owner,
        action,
        entityType,
        entityId,
        JSON.stringify(summary),
      );
      return id;
    };
    const req = async (o: { contactId?: string; leadId?: string }) => {
      const id = uuidv7();
      await run(
        `INSERT INTO client_requests (id, client_id, contact_id, contact_ref, lead_id, lead_ref, kind, details, created_at, updated_at, ${REQUEST_CLOCK_COLS}, identity_checked_at) VALUES (?1, ?2, ?3, ?3, ?4, ?4, 'data_erasure', NULL, ?5, ?5, ${requestClockOf("?5")}, ?5)`,
        id,
        o.contactId ? client : null,
        o.contactId ?? null,
        o.leadId ?? null,
        Date.now(),
      );
      return id;
    };
    const done = (id: string, auditId: string) =>
      run(
        "UPDATE client_requests SET status = 'closed', outcome = 'done', action_audit_id = ?3, closed_by = ?2, closed_at = ?4 WHERE id = ?1",
        id,
        owner,
        auditId,
        Date.now(),
      );
    const later = Date.now() + 1_000;
    const ofX = await audit("contact.anonymise", "client", client, { contactId: x }, later);
    const rY = await req({ contactId: y });
    await rejects(done(rY, ofX), /client_requests_close_rules/);
    await rejects(
      run(
        "UPDATE client_requests SET status = 'closed', outcome = 'done', closed_by = ?2, closed_at = 5 WHERE id = ?1",
        rY,
        owner,
      ),
      /client_requests_close_rules/,
    );
    await done(await req({ contactId: x }), ofX);
    const early = await audit("contact.erase", "client", client, { contactId: y }, 1);
    await rejects(done(rY, early), /client_requests_close_rules/);
    const ofLead = await audit("lead.erase", "lead", lead, { leadId: lead }, later);
    const purge = await audit("lead.purge", "lead", lead, { ref: "L" }, later);
    await rejects(done(await req({ leadId: lead }), purge), /client_requests_close_rules/);
    await done(await req({ leadId: lead }), ofLead);
  });
});

describe("consent receipts (A.3, A.7, L30)", () => {
  it("values: known event, source and purposes, a hash or a link; an end only from an erasure or the clean-up", async () => {
    const lead = await mkLead();
    await receipt({ leadId: lead });
    await rejects(receipt({ leadId: lead, event: "revoke" }), /consent_receipts_values/);
    await rejects(receipt({ leadId: lead, source: "portal" }), /consent_receipts_values/);
    await rejects(receipt({}), /consent_receipts_values/);
    await rejects(receipt({ hash: "abc" }), /consent_receipts_values/);
    await rejects(receipt({ leadId: lead, event: "ended", source: "staff" }), /consent_receipts_values/);
    await rejects(receipt({ leadId: lead, event: "grant", source: "erasure" }), /consent_receipts_values/);
    await receipt({ hash: H("9"), event: "ended", source: "retention" });
    await rejects(
      run(
        `INSERT INTO consent_receipts (id, lead_id, event, source, purposes, at) VALUES (?1, ?2, 'grant', 'web_form', '["spam"]', 1)`,
        uuidv7(),
        lead,
      ),
      /consent_receipts_values/,
    );
  });

  it("no update but the hash once and the unlink; no delete within 366 days of the person's newest receipt", async () => {
    const lead = await mkLead();
    await receipt({ leadId: lead, at: ago(800) });
    const id = (await first<{ id: string }>("SELECT id FROM consent_receipts WHERE lead_id = ?1", lead))
      ?.id as string;
    await rejects(run("UPDATE consent_receipts SET at = 5 WHERE id = ?1", id), /consent_receipts_no_update/);
    await run("UPDATE consent_receipts SET subject_hash = ?2 WHERE id = ?1", id, H("a"));
    await rejects(
      run("UPDATE consent_receipts SET subject_hash = ?2 WHERE id = ?1", id, H("b")),
      /consent_receipts_no_update/,
    );
    await receipt({ hash: H("a"), at: ago(10), event: "ended", source: "retention" });
    await rejects(run("DELETE FROM consent_receipts WHERE id = ?1", id), /consent_receipts_no_delete/);
    await run("DELETE FROM leads WHERE id = ?1", lead);
    expect((await first("SELECT lead_id FROM consent_receipts WHERE id = ?1", id))?.lead_id).toBeNull();
  });

  it("back-fill: the clock of every existing request is set (0079 ran over an empty table here; the statement is the twin's)", async () => {
    const rows = await count(
      "SELECT count(*) AS n FROM client_requests WHERE received_at IS NULL OR due_at IS NULL OR ack_due_at IS NULL",
    );
    expect(rows).toBe(0);
  });
});

describe("the audit scrub (Q3 A, L33; RB-48)", () => {
  const put = async (o: {
    at: number;
    action?: string;
    entityType?: string;
    entityId?: string | null;
    summary?: string;
  }) => {
    const id = uuidv7();
    await run(
      "INSERT INTO audit_log (id, at, actor_type, action, entity_type, entity_id, summary, ip, user_agent) VALUES (?1, ?2, 'system', ?3, ?4, ?5, ?6, '203.0.113.9', 'Firefox')",
      id,
      o.at,
      o.action ?? "lead.create",
      o.entityType ?? "lead",
      o.entityId ?? null,
      o.summary ?? null,
    );
    return id;
  };
  const SCRUB =
    "UPDATE audit_log SET ip = NULL, user_agent = NULL, summary = CASE WHEN action IN ('alert.new_device', 'alert.2fa_change', 'alert.lockout') AND json_valid(summary) THEN json_remove(summary, '$.ua', '$.city', '$.country') ELSE summary END WHERE id = ?1";
  it("allowed at 367 days (ip, browser, the alert keys; `change` kept), refused at 365 days and for any other change", async () => {
    const young = await put({ at: ago(365) });
    await rejects(run(SCRUB, young), /audit_log_no_update/);
    const old = await put({
      at: ago(367),
      action: "alert.2fa_change",
      entityType: "staff_user",
      summary: JSON.stringify({ change: "enrolled", ua: "Firefox", city: "Kolkata", country: "IN" }),
    });
    await run(SCRUB, old);
    expect(await first("SELECT ip, user_agent, summary FROM audit_log WHERE id = ?1", old)).toEqual({
      ip: null,
      user_agent: null,
      summary: JSON.stringify({ change: "enrolled" }),
    });
    const other = await put({ at: ago(400), summary: JSON.stringify({ ua: "x" }) });
    await rejects(run("UPDATE audit_log SET summary = '{}' WHERE id = ?1", other), /audit_log_no_update/);
    await rejects(
      run("UPDATE audit_log SET action = 'x', ip = NULL WHERE id = ?1", other),
      /audit_log_no_update/,
    );
    await rejects(
      run("UPDATE audit_log SET ip = '198.51.100.1' WHERE id = ?1", other),
      /audit_log_no_update/,
    );
    await rejects(run("DELETE FROM audit_log WHERE id = ?1", other), /audit_log is append-only/);
  });
  it("a held subject's rows keep them", async () => {
    const owner = await mkMember("owner");
    const lead = await mkLead();
    const row = await put({ at: ago(400), entityType: "lead", entityId: lead });
    await hold(owner, "lead", lead, "set");
    await rejects(run(SCRUB, row), /audit_log_no_update/);
    await hold(owner, "lead", lead, "clear");
    await run(SCRUB, row);
  });
});

describe("retention runs and the outbox values", () => {
  it("modes, families and moves", async () => {
    const run1 = uuidv7();
    await rejects(
      run("INSERT INTO retention_runs (id, as_of, mode, families) VALUES (?1, 1, 'maybe', 11)", run1),
      /retention_runs_values/,
    );
    await run("INSERT INTO retention_runs (id, as_of, mode, families) VALUES (?1, 1, 'dry_run', 11)", run1);
    await rejects(
      run("INSERT INTO retention_run_counts (run_id, family) VALUES (?1, 'documents')", run1),
      /retention_run_counts_values/,
    );
    await run("INSERT INTO retention_run_counts (run_id, family, done) VALUES (?1, 'bells', 1)", run1);
    await rejects(
      run("UPDATE retention_run_counts SET done = 0 WHERE run_id = ?1", run1),
      /retention_run_counts_fixed/,
    );
    await run("UPDATE retention_runs SET finished_at = 5 WHERE id = ?1", run1);
    await rejects(
      run("UPDATE retention_runs SET finished_at = 6 WHERE id = ?1", run1),
      /retention_runs_fixed/,
    );
    await rejects(run("UPDATE retention_runs SET mode = 'live' WHERE id = ?1", run1), /retention_runs_fixed/);
    await run("DELETE FROM retention_runs WHERE id = ?1", run1);
    expect(await count("SELECT count(*) AS n FROM retention_run_counts WHERE run_id = ?1", run1)).toBe(0);
    await rejects(
      run("INSERT INTO r2_deletions (bucket, key, reason) VALUES ('other', 'k', 'orphan')"),
      /r2_deletions_values/,
    );
    await rejects(
      run("INSERT INTO r2_deletions (bucket, key, reason) VALUES ('files', 'k', 'because')"),
      /r2_deletions_values/,
    );
    await run("INSERT INTO r2_deletions (bucket, key, reason) VALUES ('files', 'k1', 'orphan')");
    await run("UPDATE r2_deletions SET attempts = attempts + 1 WHERE key = 'k1'");
    await rejects(run("UPDATE r2_deletions SET attempts = 0 WHERE key = 'k1'"), /r2_deletions_fixed/);
    await rejects(run("UPDATE r2_deletions SET key = 'k2' WHERE key = 'k1'"), /r2_deletions_fixed/);
  });
});
