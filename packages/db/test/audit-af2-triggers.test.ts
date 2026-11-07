// The full audit of M6–M7, fix round AF2, in the database [run file docs/runs/full-audit-m6-m7.md AU9, AU10, AU20, AU25, AU26; ADM-SET-09, ADM-CLI-05,
// FRM-05, JOB-PDF-01, ADM-MAIL-03]: 0083 only adds columns; 0084 regenerates byte for byte; every rule of `audit_af2_triggers` accepts and refuses. Raw SQL on
// purpose: the triggers are the subject. Every name, address and id is invented test data. Times are relative to now.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { CONSENT_WITHDRAW_ACTION_SQL } from "../src/dp-shared.ts";
import { HELD_EMAIL_SQL } from "../src/retention.ts";
import { triggerMigrationSql } from "../src/triggers.ts";
import { auditAf2Backfill, CONSENT_ACTION_AF2, HELD_EMAIL_AF2 } from "../src/triggers-audit-af2.ts";
import { mkClientRow, mkContact, mkMember } from "./billing-helpers.ts";
import {
  first,
  insertClient,
  insertDraftInvoice,
  REQUEST_CLOCK_COLS,
  rejects,
  requestClockOf,
  run,
} from "./helpers.ts";
import { mkQuote, send } from "./quotes.ts";

const H = (c: string) => c.repeat(64);
const migration = (name: string) => env.TEST_MIGRATIONS.find((m) => m.name === name);
const statementsOf = (name: string) =>
  (migration(name)?.queries ?? []).map((q) => q.replace(/^--[^\n]*\n?/gm, "").trim()).filter((q) => q !== "");
const hold = (owner: string, entityType: string, entityId: string, action: "set" | "clear") =>
  run(
    "INSERT INTO legal_holds (id, entity_type, entity_id, action, reason, by) VALUES (?1, ?2, ?3, ?4, 'GST notice', ?5)",
    uuidv7(),
    entityType,
    entityId,
    action,
    owner,
  );
async function mkLead(email: string): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO leads (id, ref, source, contact_name, contact_email) VALUES (?1, ?2, 'web', 'Pat', ?3)",
    id,
    `L-${id.slice(-8)}`,
    email,
  );
  return id;
}

describe("0083 and 0084", () => {
  it("0083 only adds columns (no table rebuilt, nothing dropped)", () => {
    const qs = statementsOf("0083_audit_af2.sql");
    expect(qs.length).toBe(4);
    for (const q of qs) expect(q).toMatch(/^ALTER TABLE `[a-z_]+` ADD `[a-z_]+` integer/);
  });
  it("0084 regenerates from the generator", () => {
    const generated = triggerMigrationSql("audit_af2_triggers")
      .split("\n--> statement-breakpoint\n")
      .map((q) => q.replace(/^--[^\n]*\n?/gm, "").trim())
      .filter((q) => q !== "");
    const norm = (xs: string[]) => xs.map((q) => q.replace(/\s+/g, " ").trim().replace(/;$/, ""));
    expect(norm(statementsOf("0084_audit_af2_triggers.sql"))).toEqual(norm(generated));
  });
  it("the frozen held-address rule equals the runtime one (the clean-up's and the lead erase's)", () => {
    expect(HELD_EMAIL_AF2("x.e")).toBe(HELD_EMAIL_SQL("x.e"));
  });
  it("the frozen consent-withdrawal proof equals the close route's (AU26)", () => {
    expect(CONSENT_ACTION_AF2).toBe(CONSENT_WITHDRAW_ACTION_SQL("NEW.", "NEW.action_audit_id"));
  });
});

describe("AU10: a PDF refusal kept outside the bells", () => {
  it("the back-fill gives a document with a pdf.refused bell its refusal time (the first bell's), once; refused_at is set once", async () => {
    const owner = await mkMember("owner");
    const client = await insertClient(`C-${uuidv7().slice(-6)}`);
    const doc = await insertDraftInvoice(client);
    const other = await insertDraftInvoice(client);
    await run(
      "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link, created_at) VALUES (?1, ?2, 'pdf.refused', 'document', ?3, 't', '/', 5000)",
      uuidv7(),
      owner,
      doc,
    );
    await run(
      "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link, created_at) VALUES (?1, ?2, 'pdf.ready', 'document', ?3, 't', '/', 5000)",
      uuidv7(),
      owner,
      other,
    );
    for (const q of auditAf2Backfill()) await run(q);
    expect(await first("SELECT nights, refused_at FROM pdf_failures WHERE document_id = ?1", doc)).toEqual({
      nights: 0,
      refused_at: 5000,
    });
    expect(await first("SELECT 1 AS x FROM pdf_failures WHERE document_id = ?1", other)).toBeNull();
    // a second run changes nothing
    for (const q of auditAf2Backfill()) await run(q);
    expect(await first("SELECT refused_at FROM pdf_failures WHERE document_id = ?1", doc)).toEqual({
      refused_at: 5000,
    });
    await rejects(
      run("UPDATE pdf_failures SET refused_at = 6000 WHERE document_id = ?1", doc),
      /pdf_failures_refused_once/,
    );
    await rejects(
      run("UPDATE pdf_failures SET refused_at = NULL WHERE document_id = ?1", doc),
      /pdf_failures_refused_once/,
    );
    await run("UPDATE pdf_failures SET nights = 2 WHERE document_id = ?1", doc);
  });
});

describe("AU9: the clean-up's page budget columns", () => {
  it("pages are whole and only go up; the flags are 0 or 1; more tomorrow only on a done family, kept once set", async () => {
    const runId = `rr_af2_${uuidv7()}`;
    await run(
      "INSERT INTO retention_runs (id, as_of, mode, started_at, families) VALUES (?1, 1, 'live', 1, 11)",
      runId,
    );
    const ins = (family: string, cols: string, vals: string) =>
      run(`INSERT INTO retention_run_counts (run_id, family${cols}) VALUES (?1, ?2${vals})`, runId, family);
    await rejects(ins("bells", ", pages", ", -1"), /retention_run_counts_af2_insert/);
    await rejects(ins("bells", ", capped", ", 2"), /retention_run_counts_af2_insert/);
    await rejects(ins("bells", ", more_tomorrow, done", ", 1, 0"), /retention_run_counts_af2_insert/);
    await ins("bells", ", pages", ", 3");
    const set = (sql: string) =>
      run(`UPDATE retention_run_counts SET ${sql} WHERE run_id = ?1 AND family = 'bells'`, runId);
    await rejects(set("pages = 2"), /retention_run_counts_af2_update/);
    await rejects(set("more_tomorrow = 1"), /retention_run_counts_af2_update/);
    await set("pages = 20, done = 1, more_tomorrow = 1");
    await rejects(set("more_tomorrow = 0"), /retention_run_counts_af2_update/);
    await ins("email_log", ", capped, done", ", 1, 1");
  });
});

describe("AU25 L1: a lead whose address is held", () => {
  it("is neither erased nor deleted while a contact with the address, its client, or a lead with it is held; after the hold, it is", async () => {
    const owner = await mkMember("owner");
    const client = await mkClientRow();
    const contact = await mkContact(client, { email: "held.person@example.test" });
    for (const [type, id] of [
      ["contact", contact],
      ["client", client],
    ] as const) {
      const lead = await mkLead("Held.Person@Example.TEST");
      await hold(owner, type, id, "set");
      await rejects(
        run("UPDATE leads SET erased_hash = ?2 WHERE id = ?1", lead, H("a")),
        /leads_held_no_erase/,
      );
      await rejects(run("DELETE FROM leads WHERE id = ?1", lead), /leads_held_no_delete/);
      await hold(owner, type, id, "clear");
      await run("UPDATE leads SET erased_hash = ?2 WHERE id = ?1", lead, H("a"));
      await run("DELETE FROM leads WHERE id = ?1", lead);
    }
    // another held lead with the same address holds this one too
    const heldLead = await mkLead("twin@example.test");
    const twin = await mkLead("TWIN@example.test");
    await hold(owner, "lead", heldLead, "set");
    await rejects(run("DELETE FROM leads WHERE id = ?1", twin), /leads_held_no_delete/);
    await hold(owner, "lead", heldLead, "clear");
    await run("DELETE FROM leads WHERE id = ?1", twin);
    // an address nobody holds goes as before
    await run("DELETE FROM leads WHERE id = ?1", await mkLead("free@example.test"));
  });
});

describe("AU25 L2: the redaction hold fires on every redaction", () => {
  it("an offer redacted once is not redacted again while its client is held", async () => {
    const owner = await mkMember("owner");
    const q = await mkQuote({ type: "proposal" });
    await send(q);
    const redact = (at: number) =>
      run(
        "UPDATE documents SET title = 'Website for Anonymised client', redacted_at = ?2, updated_at = updated_at + 1 WHERE id = ?1",
        q.id,
        at,
      );
    const t = Date.now();
    await redact(t);
    await hold(owner, "client", q.clientId, "set");
    await rejects(redact(t + 1_000), /documents_held_no_redact/);
    await hold(owner, "client", q.clientId, "clear");
    await redact(t + 2_000);
  });
});

describe("AU25 L3 and AU26: a request's close", () => {
  const audit = async (
    owner: string,
    action: string,
    type: string,
    id: string | null,
    summary: unknown,
    at: number,
  ) => {
    const auditId = uuidv7();
    await run(
      "INSERT INTO audit_log (id, at, actor_type, actor_id, role, action, entity_type, entity_id, summary) VALUES (?1, ?2, 'staff', ?3, 'owner', ?4, ?5, ?6, ?7)",
      auditId,
      at,
      owner,
      action,
      type,
      id,
      JSON.stringify(summary),
    );
    return auditId;
  };
  const req = async (kind: string, o: { client?: string; contact?: string; lead?: string; at: number }) => {
    const id = uuidv7();
    await run(
      `INSERT INTO client_requests (id, client_id, contact_id, contact_ref, lead_id, lead_ref, kind, details, created_at, updated_at, ${REQUEST_CLOCK_COLS}, identity_checked_at)
       VALUES (?1, ?2, ?3, ?3, ?4, ?4, ?5, NULL, ?6, ?6, ${requestClockOf("?6")}, ?6)`,
      id,
      o.client ?? null,
      o.contact ?? null,
      o.lead ?? null,
      kind,
      o.at,
    );
    return id;
  };
  const close = (owner: string, id: string, set: string, ...p: unknown[]) =>
    run(
      `UPDATE client_requests SET status = 'closed', closed_by = ?2, closed_at = ?3, ${set} WHERE id = ?1`,
      id,
      owner,
      Date.now(),
      ...p,
    );

  it("L3: a done access request's export date is never before the request arrived", async () => {
    const owner = await mkMember("owner");
    const client = await mkClientRow();
    const at = Date.now() - 60_000;
    await rejects(
      close(owner, await req("data_access", { client, at }), "outcome = 'done', export_sent_at = ?4", at - 1),
      /client_requests_close_rules/,
    );
    await close(owner, await req("data_access", { client, at }), "outcome = 'done', export_sent_at = ?4", at);
  });

  it("AU26: a done consent withdrawal names its own lead's withdrawal, made after the request arrived", async () => {
    const owner = await mkMember("owner");
    const lead = await mkLead(`w-${uuidv7()}@example.test`);
    const otherLead = await mkLead(`o-${uuidv7()}@example.test`);
    const at = Date.now() - 60_000;
    const r = () => req("consent_withdrawal", { lead, at });
    // no proof: refused; declined with a reason: fine
    await rejects(close(owner, await r(), "outcome = 'done'"), /client_requests_close_rules/);
    await close(owner, await r(), "outcome = 'declined', decline_reason = 'other'");
    const ofOther = await audit(owner, "lead.consent_withdraw", "lead", otherLead, { ref: "L" }, at + 1);
    await rejects(close(owner, await r(), "outcome = 'done', action_audit_id = ?4", ofOther), /close_rules/);
    const early = await audit(owner, "lead.consent_withdraw", "lead", lead, { ref: "L" }, at - 1);
    await rejects(close(owner, await r(), "outcome = 'done', action_audit_id = ?4", early), /close_rules/);
    const erase = await audit(owner, "lead.erase", "lead", lead, { ref: "L" }, at + 1);
    await rejects(close(owner, await r(), "outcome = 'done', action_audit_id = ?4", erase), /close_rules/);
    const ok = await audit(owner, "lead.consent_withdraw", "lead", lead, { ref: "L" }, at + 1);
    await close(owner, await r(), "outcome = 'done', action_audit_id = ?4", ok);
  });

  it("AU26: a contact's withdrawal needs the consent change and its withdraw receipt, both after the request arrived", async () => {
    const owner = await mkMember("owner");
    const client = await mkClientRow();
    const contact = await mkContact(client);
    const at = Date.now() - 60_000;
    const r = () => req("consent_withdrawal", { client, contact, at });
    const change = (changed: string[], when: number) =>
      audit(owner, "contact.update", "client", client, { contactId: contact, changed }, when);
    const nameOnly = await change(["name"], at + 1);
    const consent = await change(["marketingConsent"], at + 1);
    // one open withdrawal per contact (the unique open request): a refused close leaves it open for the next try
    const rid = await r();
    // the consent changed, but no withdraw receipt (a grant): refused
    await run(
      `INSERT INTO consent_receipts (id, contact_id, event, source, purposes, marketing, at) VALUES (?1, ?2, 'grant', 'staff', '["marketing_updates"]', 1, ?3)`,
      uuidv7(),
      contact,
      at + 1,
    );
    await rejects(close(owner, rid, "outcome = 'done', action_audit_id = ?4", consent), /close_rules/);
    await run(
      `INSERT INTO consent_receipts (id, contact_id, event, source, purposes, marketing, at) VALUES (?1, ?2, 'withdraw', 'staff', '["marketing_updates"]', 0, ?3)`,
      uuidv7(),
      contact,
      at + 2,
    );
    await rejects(close(owner, rid, "outcome = 'done', action_audit_id = ?4", nameOnly), /close_rules/);
    await close(owner, rid, "outcome = 'done', action_audit_id = ?4", consent);
  });
});

describe("AU20: the digest switched off by a spam report", () => {
  it("complaint is a known way, only while the digest is off", async () => {
    const member = await mkMember("owner");
    await rejects(
      run(
        "INSERT INTO staff_notification_prefs (user_id, digest_weekly, digest_off_via, updated_at) VALUES (?1, 1, 'complaint', 1)",
        member,
      ),
      /staff_notification_prefs_values/,
    );
    await rejects(
      run(
        "INSERT INTO staff_notification_prefs (user_id, digest_weekly, digest_off_via, updated_at) VALUES (?1, 0, 'spam', 1)",
        member,
      ),
      /staff_notification_prefs_values/,
    );
    await run(
      "INSERT INTO staff_notification_prefs (user_id, digest_weekly, digest_off_via, updated_at) VALUES (?1, 0, 'complaint', 1)",
      member,
    );
  });
});
