// M7.1 full client portal in the database [POR-09, POR-11, ADM-PAY-05; run file A, I "db", L8, L10]: 0071 creates and adds only, 0072's lists equal core's, and
// every rule of `client_portal_triggers` accepts and refuses. Each guard is also shown to be what refuses: the trigger is dropped, the same write then passes, and
// the trigger is re-created from the generator (`withoutTrigger`). The writing triggers unlink a deleted lead or contact and clear the person's words on an erase
// or an anonymise. Raw SQL on purpose: the triggers are the subject. All names, ids and amounts are invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import {
  NOTICE_STATUSES,
  NOTICE_VIAS,
  REQUEST_KINDS,
  REQUEST_OUTCOMES,
  REQUEST_STATUSES,
  STAFF_CLOSE_KINDS,
} from "@techaust/core/portal";
import { describe, expect, it } from "vitest";
import {
  clientPortalTriggerStatements,
  NOTICE_STATUSES_0072,
  NOTICE_VIAS_0072,
  REQUEST_KINDS_0072,
  REQUEST_OUTCOMES_0072,
  REQUEST_STATUSES_0072,
  STAFF_CLOSE_KINDS_0072,
} from "../src/triggers.ts";
import { mkClientRow, mkContact, mkIssued, mkMember } from "./billing-helpers.ts";
import { all, first, insertDraftInvoice, rejects, run } from "./helpers.ts";

const migration = (name: string) => env.TEST_MIGRATIONS.find((m) => m.name === name);
/** A migration's statements without their comment lines and breakpoints. */
const statementsOf = (name: string) =>
  (migration(name)?.queries ?? []).map((q) => q.replace(/^--[^\n]*\n?/gm, "").trim()).filter((q) => q !== "");

/** Runs `fn` with trigger `name` dropped, then re-creates it exactly as 0072 does. */
async function withoutTrigger(name: string, fn: () => Promise<unknown>): Promise<void> {
  const create = clientPortalTriggerStatements().find((s) => s.startsWith(`CREATE TRIGGER \`${name}\``));
  if (!create) throw new Error(`no trigger ${name}`);
  await run(`DROP TRIGGER \`${name}\``);
  try {
    await fn();
  } finally {
    await run(create);
  }
}

async function mkLead(clientId: string | null = null): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO leads (id, ref, source, contact_name, contact_email, client_id) VALUES (?1, ?2, 'web', 'Pat', ?3, ?4)",
    id,
    `L-${id.slice(-6)}`,
    `${id}@example.test`,
    clientId,
  );
  return id;
}

type Req = {
  id?: string;
  clientId?: string | null;
  contactId?: string | null;
  contactRef?: string | null;
  leadId?: string | null;
  leadRef?: string | null;
  email?: string | null;
  kind?: string;
  details?: string | null;
  status?: string;
  outcome?: string | null;
};
function insertRequest(r: Req) {
  const contactId = r.contactId ?? null;
  const leadId = r.leadId ?? null;
  return run(
    `INSERT INTO client_requests (id, client_id, contact_id, contact_ref, lead_id, lead_ref, requester_email, kind, details, status, outcome, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1000, 1000)`,
    r.id ?? uuidv7(),
    r.clientId === undefined ? null : r.clientId,
    contactId,
    r.contactRef === undefined ? contactId : r.contactRef,
    leadId,
    r.leadRef === undefined ? leadId : r.leadRef,
    r.email ?? null,
    r.kind ?? "data_access",
    r.details === undefined ? "Please send my data." : r.details,
    r.status ?? "open",
    r.outcome ?? null,
  );
}

type Notice = {
  id?: string;
  clientId: string;
  documentId: string;
  contactId?: string | null;
  via?: string;
  currency?: string;
  reference?: string;
  status?: string;
  amount?: number;
};
function insertNotice(n: Notice) {
  const reference = n.reference ?? "UTR1234";
  return run(
    `INSERT INTO payment_notices (id, client_id, document_id, contact_id, via, amount_minor, currency, paid_on, reference, reference_norm, note, status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '2026-11-04', ?8, ?9, 'Paid by NEFT', ?10)`,
    n.id ?? uuidv7(),
    n.clientId,
    n.documentId,
    n.contactId === undefined ? null : n.contactId,
    n.via ?? "portal",
    n.amount ?? 1000,
    n.currency ?? "INR",
    reference,
    reference.replace(/\s+/g, "").toUpperCase(),
    n.status ?? "open",
  );
}

async function manualPayment(clientId: string, currency = "INR"): Promise<string> {
  const owner = await mkMember("owner");
  const id = uuidv7();
  await run(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at)
     VALUES (?1, ?2, 'payment', 'manual', 'pending_verification', ?3, 1000, '2026-11-04', 'neft', ?4, 1000)`,
    id,
    clientId,
    currency,
    owner,
  );
  return id;
}

describe("0071 and 0072 [run file A]", () => {
  it("0071 only creates (two tables and indexes, nothing dropped, altered or rebuilt)", () => {
    const sql = (migration("0071_portal.sql")?.queries ?? []).join("\n");
    expect(sql).toMatch(/CREATE TABLE `client_requests`/);
    expect(sql).toMatch(/CREATE TABLE `payment_notices`/);
    expect(sql).not.toMatch(/DROP |ALTER TABLE|__new_|INSERT INTO/i);
    for (const q of statementsOf("0071_portal.sql")) expect(q).toMatch(/^CREATE (UNIQUE )?(TABLE|INDEX) /);
  });

  it("0072 only creates triggers", () => {
    const qs = statementsOf("0072_client_portal_triggers.sql");
    expect(qs.length).toBe(clientPortalTriggerStatements().length);
    for (const q of qs) expect(q).toMatch(/^CREATE TRIGGER `/);
  });

  it("the frozen lists equal core's, and the installed kind trigger lists exactly core's kinds", async () => {
    expect(REQUEST_KINDS_0072).toEqual(REQUEST_KINDS);
    expect(REQUEST_STATUSES_0072).toEqual(REQUEST_STATUSES);
    expect(REQUEST_OUTCOMES_0072).toEqual(REQUEST_OUTCOMES);
    expect(NOTICE_VIAS_0072).toEqual(NOTICE_VIAS);
    expect(NOTICE_STATUSES_0072).toEqual(NOTICE_STATUSES);
    expect(STAFF_CLOSE_KINDS_0072).toEqual(STAFF_CLOSE_KINDS);
    const row = await first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'client_requests_kind'",
    );
    const list = /NOT IN \(([^)]*)\)/.exec(row?.sql ?? "")?.[1] ?? "";
    expect(list.split(",").map((s) => s.trim().replaceAll("'", ""))).toEqual([...REQUEST_KINDS]);
  });

  it("no name clashes: every 0072 trigger is new, and M6.2's contacts trigger is still there", async () => {
    const names = clientPortalTriggerStatements().map((s) => /^CREATE TRIGGER `([^`]+)`/.exec(s)?.[1]);
    expect(new Set(names).size).toBe(names.length);
    const onContacts = await all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'contacts' ORDER BY name",
    );
    expect(onContacts.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        "checkout_sessions_unlink_contact",
        "client_requests_erase_details",
        "client_requests_unlink_contact",
        "contacts_anonymised_frozen",
        "payment_notices_erase_note",
        "payment_notices_unlink_contact",
      ]),
    );
  });
});

describe("client_requests [L8]", () => {
  it("a portal request (client, contact, refs from the session) and a lead-only or address-only request (M7.4) are taken", async () => {
    const client = await mkClientRow();
    const contact = await mkContact(client);
    await insertRequest({ clientId: client, contactId: contact });
    const lead = await mkLead();
    await insertRequest({ leadId: lead, kind: "data_erasure" });
    await insertRequest({ email: "someone@example.test" });
  });

  it("CHECK: a request names a subject", async () => {
    await rejects(insertRequest({}), /client_requests_subject/);
  });

  it("an unknown kind or status is refused (and passes without the rule)", async () => {
    const client = await mkClientRow();
    await rejects(insertRequest({ clientId: client, kind: "nomination" }), /client_requests_kind/);
    await withoutTrigger("client_requests_kind", () =>
      insertRequest({ clientId: client, kind: "nomination" }),
    );
    // An unknown status or outcome also breaks the insert state, so the values rule is shown alone with that one dropped.
    await rejects(
      insertRequest({ clientId: client, status: "pending" }),
      /client_requests_(values_insert|insert_state)/,
    );
    await withoutTrigger("client_requests_insert_state", async () => {
      await rejects(insertRequest({ clientId: client, status: "pending" }), /client_requests_values_insert/);
      await rejects(
        insertRequest({ clientId: client, status: "closed", outcome: "maybe" }),
        /client_requests_values_insert/,
      );
    });
  });

  it("insert state: open, nothing closed, refs equal to the links (NULL-safe), the contact one of the client", async () => {
    const client = await mkClientRow();
    const other = await mkClientRow();
    const contact = await mkContact(client);
    const theirs = await mkContact(other);
    const lead = await mkLead();
    await rejects(
      insertRequest({ clientId: client, status: "closed", outcome: "done" }),
      /client_requests_insert_state/,
    );
    await rejects(
      insertRequest({ clientId: client, contactId: contact, contactRef: "someone-else" }),
      /client_requests_insert_state/,
    );
    await rejects(
      insertRequest({ clientId: client, contactId: contact, contactRef: null }),
      /client_requests_insert_state/,
    );
    await rejects(insertRequest({ clientId: client, contactRef: contact }), /client_requests_insert_state/);
    await rejects(insertRequest({ leadId: lead, leadRef: "another-lead" }), /client_requests_insert_state/);
    await rejects(insertRequest({ leadRef: lead }), /client_requests_insert_state/);
    await rejects(insertRequest({ clientId: client, contactId: theirs }), /client_requests_insert_state/);
    await withoutTrigger("client_requests_insert_state", () =>
      insertRequest({ clientId: client, contactId: theirs }),
    );
  });

  it("one open request per kind per contact; a closed one frees the kind", async () => {
    const client = await mkClientRow();
    const contact = await mkContact(client);
    const staff = await mkMember("staff");
    const id = uuidv7();
    await insertRequest({ id, clientId: client, contactId: contact, kind: "grievance" });
    await rejects(insertRequest({ clientId: client, contactId: contact, kind: "grievance" }), /UNIQUE/);
    await insertRequest({ clientId: client, contactId: contact, kind: "data_access" });
    await run(
      "UPDATE client_requests SET status = 'closed', outcome = 'done', closed_by = ?2, closed_at = 2000 WHERE id = ?1",
      id,
      staff,
    );
    await insertRequest({ clientId: client, contactId: contact, kind: "grievance" });
  });

  it("status flow: closed once, with outcome, who and when; never reopened; an open request has no close fields", async () => {
    const client = await mkClientRow();
    const staff = await mkMember("staff");
    const id = uuidv7();
    await insertRequest({ id, clientId: client, kind: "grievance" });
    const close = (sql: string, ...p: unknown[]) =>
      run(`UPDATE client_requests SET ${sql} WHERE id = ?1`, id, ...p);
    await rejects(
      close("status = 'closed', closed_by = ?2, closed_at = 2000", staff),
      /client_requests_status_flow/,
    );
    await rejects(
      close("status = 'closed', outcome = 'done', closed_at = 2000"),
      /client_requests_status_flow/,
    );
    await rejects(close("outcome = 'done'"), /client_requests_status_flow/);
    await rejects(close("close_note = 'x'"), /client_requests_status_flow/);
    await withoutTrigger("client_requests_status_flow", () => close("close_note = 'x'"));
    await close("close_note = NULL");
    await close(
      "status = 'closed', outcome = 'declined', closed_by = ?2, closed_at = 2000, close_note = 'Not ours', updated_at = 2000",
      staff,
    );
    await rejects(
      close("status = 'open', outcome = NULL, closed_by = NULL, closed_at = NULL, close_note = NULL"),
      /client_requests_status_flow/,
    );
    await rejects(close("outcome = 'done'"), /client_requests_fixed/);
    await rejects(close("close_note = 'changed'"), /client_requests_fixed/);
    // Early check 1 finding 5: after the close the note only becomes empty (as `details`); without the rule it could be rewritten.
    await withoutTrigger("client_requests_fixed", async () => {
      await close("close_note = 'rewritten'");
      await close("close_note = 'Not ours'");
    });
    await close("close_note = NULL");
    expect((await first("SELECT close_note FROM client_requests WHERE id = ?1", id))?.close_note).toBeNull();
    await rejects(close("close_note = 'back again'"), /client_requests_fixed/);
  });

  it("only an active Owner closes a data-rights request (or any kind outside Staff's list); Staff close a contact change or a grievance (finding 3)", async () => {
    const client = await mkClientRow();
    const staff = await mkMember("staff");
    const owner = await mkMember("owner");
    const pastOwner = await mkMember("owner", "deactivated");
    const closeBy = (id: string, by: string) =>
      run(
        "UPDATE client_requests SET status = 'closed', outcome = 'done', closed_by = ?2, closed_at = 2000, updated_at = 2000 WHERE id = ?1",
        id,
        by,
      );
    const mk = async (kind: string) => {
      const id = uuidv7();
      await insertRequest({ id, clientId: client, kind });
      return id;
    };
    for (const kind of ["data_access", "data_correction", "data_erasure"]) {
      await rejects(closeBy(await mk(kind), staff), /client_requests_owner_close/);
      await rejects(closeBy(await mk(kind), pastOwner), /client_requests_owner_close/);
      await closeBy(await mk(kind), owner);
    }
    for (const kind of STAFF_CLOSE_KINDS) {
      await closeBy(await mk(kind), staff);
      await closeBy(await mk(kind), owner);
    }
    // The trigger is the rule: without it Staff's close of a data request goes through.
    const data = await mk("data_erasure");
    await withoutTrigger("client_requests_owner_close", () => closeBy(data, staff));
  });

  it("fixed: client, kind, refs, address and time never change; lead, contact and details only become empty", async () => {
    const client = await mkClientRow();
    const other = await mkClientRow();
    const contact = await mkContact(client);
    const contact2 = await mkContact(client);
    const lead = await mkLead();
    const lead2 = await mkLead();
    const id = uuidv7();
    await insertRequest({ id, clientId: client, contactId: contact, leadId: lead, kind: "grievance" });
    const set = (sql: string, ...p: unknown[]) =>
      run(`UPDATE client_requests SET ${sql} WHERE id = ?1`, id, ...p);
    for (const [sql, p] of [
      ["client_id = ?2", other],
      ["kind = 'data_access'", undefined],
      ["lead_ref = ?2", lead2],
      ["contact_ref = ?2", contact2],
      ["requester_email = 'x@example.test'", undefined],
      ["created_at = 5", undefined],
      ["lead_id = ?2", lead2],
      ["contact_id = ?2", contact2],
      ["details = 'New words'", undefined],
      ["updated_at = 1", undefined],
    ] as const)
      await rejects(p === undefined ? set(sql) : set(sql, p), /client_requests_fixed/);
    await withoutTrigger("client_requests_fixed", async () => {
      await set("contact_id = ?2, contact_ref = ?2", contact2);
      await set("contact_id = ?2, contact_ref = ?2", contact);
    });
    await set("lead_id = NULL, contact_id = NULL, details = NULL, updated_at = 3000");
    const row = await first(
      "SELECT lead_id, lead_ref, contact_id, contact_ref, details FROM client_requests WHERE id = ?1",
      id,
    );
    expect(row).toEqual({
      lead_id: null,
      lead_ref: lead,
      contact_id: null,
      contact_ref: contact,
      details: null,
    });
  });

  it("never deleted", async () => {
    const client = await mkClientRow();
    const id = uuidv7();
    await insertRequest({ id, clientId: client });
    await rejects(run("DELETE FROM client_requests WHERE id = ?1", id), /client_requests_no_delete/);
    await withoutTrigger("client_requests_no_delete", async () => {
      await run("DELETE FROM client_requests WHERE id = ?1", id);
      await insertRequest({ id, clientId: client });
    });
  });
});

describe("payment_notices [L10, ADM-PAY-05]", () => {
  async function setup() {
    const client = await mkClientRow();
    const contact = await mkContact(client);
    const doc = await mkIssued(client);
    return { client, contact, doc };
  }

  it("a notice from a contact about the client's document in its currency is taken; a second open one with the same reference is not", async () => {
    const { client, contact, doc } = await setup();
    await insertNotice({ clientId: client, documentId: doc, contactId: contact });
    await rejects(
      insertNotice({ clientId: client, documentId: doc, contactId: contact, reference: "utr 1234" }),
      /UNIQUE/,
    );
    await insertNotice({
      clientId: client,
      documentId: doc,
      contactId: contact,
      via: "link",
      reference: "UTR9",
    });
  });

  it("CHECK: amount above 0, a real day, the reference lengths", async () => {
    const { client, contact, doc } = await setup();
    await rejects(
      insertNotice({ clientId: client, documentId: doc, contactId: contact, amount: 0 }),
      /payment_notices_amount/,
    );
    await rejects(
      run(
        `INSERT INTO payment_notices (id, client_id, document_id, contact_id, via, amount_minor, currency, paid_on, reference, reference_norm)
         VALUES (?1, ?2, ?3, ?4, 'portal', 1, 'INR', '2026-02-30', 'R', 'R')`,
        uuidv7(),
        client,
        doc,
        contact,
      ),
      /payment_notices_paid_on/,
    );
    await rejects(
      insertNotice({ clientId: client, documentId: doc, contactId: contact, reference: "R".repeat(65) }),
      /payment_notices_reference_length/,
    );
  });

  it("values and insert state: known channel and status, open, from a contact, nothing closed", async () => {
    const { client, contact, doc } = await setup();
    await rejects(
      insertNotice({ clientId: client, documentId: doc, contactId: contact, via: "email" }),
      /payment_notices_values_insert/,
    );
    await rejects(
      insertNotice({ clientId: client, documentId: doc, contactId: contact, status: "maybe" }),
      /payment_notices_(values_insert|insert_state)/,
    );
    await withoutTrigger("payment_notices_insert_state", () =>
      rejects(
        insertNotice({ clientId: client, documentId: doc, contactId: contact, status: "maybe" }),
        /payment_notices_values_insert/,
      ),
    );
    await withoutTrigger("payment_notices_values_insert", () =>
      insertNotice({ clientId: client, documentId: doc, contactId: contact, via: "email", reference: "VIA" }),
    );
    await rejects(
      insertNotice({ clientId: client, documentId: doc, contactId: contact, status: "recorded" }),
      /payment_notices_insert_state/,
    );
    await rejects(
      insertNotice({ clientId: client, documentId: doc, contactId: null }),
      /payment_notices_insert_state/,
    );
    await withoutTrigger("payment_notices_insert_state", () =>
      insertNotice({ clientId: client, documentId: doc, contactId: null, reference: "NOC" }),
    );
  });

  it("the document is the client's and in its currency, the contact the client's", async () => {
    const { client, contact, doc } = await setup();
    const other = await mkClientRow();
    const otherDoc = await mkIssued(other);
    const theirs = await mkContact(other);
    await rejects(
      insertNotice({ clientId: client, documentId: otherDoc, contactId: contact }),
      /payment_notices_document/,
    );
    await rejects(
      insertNotice({ clientId: client, documentId: doc, contactId: contact, currency: "USD" }),
      /payment_notices_document/,
    );
    await rejects(
      insertNotice({ clientId: client, documentId: doc, contactId: theirs }),
      /payment_notices_document/,
    );
    await withoutTrigger("payment_notices_document", () =>
      insertNotice({ clientId: client, documentId: otherDoc, contactId: contact }),
    );
  });

  it("the document is issued: a draft (never frozen) takes no notice (finding 8)", async () => {
    const { client, contact } = await setup();
    const draft = await insertDraftInvoice(client);
    await rejects(
      insertNotice({ clientId: client, documentId: draft, contactId: contact, reference: "DRAFT1" }),
      /payment_notices_document/,
    );
    await withoutTrigger("payment_notices_document", () =>
      insertNotice({ clientId: client, documentId: draft, contactId: contact, reference: "DRAFT1" }),
    );
  });

  it("a close note only on a dismiss, never at insert, frozen after (finding 5)", async () => {
    const { client, contact, doc } = await setup();
    const staff = await mkMember("staff");
    const pay = await manualPayment(client);
    await rejects(
      run(
        `INSERT INTO payment_notices (id, client_id, document_id, contact_id, via, amount_minor, currency, paid_on, reference, reference_norm, close_note)
         VALUES (?1, ?2, ?3, ?4, 'portal', 1, 'INR', '2026-11-04', 'CN0', 'CN0', 'early')`,
        uuidv7(),
        client,
        doc,
        contact,
      ),
      /payment_notices_insert_state/,
    );
    // The length CHECK runs after the triggers, so it is shown with the insert-state rule dropped.
    await withoutTrigger("payment_notices_insert_state", () =>
      rejects(
        run(
          `INSERT INTO payment_notices (id, client_id, document_id, contact_id, via, amount_minor, currency, paid_on, reference, reference_norm, close_note)
           VALUES (?1, ?2, ?3, ?4, 'portal', 1, 'INR', '2026-11-04', 'CN0', 'CN0', '')`,
          uuidv7(),
          client,
          doc,
          contact,
        ),
        /payment_notices_close_note_length/,
      ),
    );
    const rec = uuidv7();
    await insertNotice({ id: rec, clientId: client, documentId: doc, contactId: contact, reference: "CN1" });
    const recordWithNote = () =>
      run(
        "UPDATE payment_notices SET status = 'recorded', payment_id = ?2, closed_by = ?3, closed_at = 2000, close_note = 'x' WHERE id = ?1",
        rec,
        pay,
        staff,
      );
    await rejects(recordWithNote(), /payment_notices_status_flow/);
    await withoutTrigger("payment_notices_status_flow", async () => {
      const demo = uuidv7();
      await insertNotice({
        id: demo,
        clientId: client,
        documentId: doc,
        contactId: contact,
        reference: "CN9",
      });
      await run(
        "UPDATE payment_notices SET status = 'recorded', payment_id = ?2, closed_by = ?3, closed_at = 2000, close_note = 'x' WHERE id = ?1",
        demo,
        pay,
        staff,
      );
    });
    const dis = uuidv7();
    await insertNotice({ id: dis, clientId: client, documentId: doc, contactId: contact, reference: "CN2" });
    await run(
      "UPDATE payment_notices SET status = 'dismissed', closed_by = ?2, closed_at = 2000, close_note = 'Duplicate of an earlier notice' WHERE id = ?1",
      dis,
      staff,
    );
    for (const sql of ["close_note = 'other'", "close_note = NULL"])
      await rejects(run(`UPDATE payment_notices SET ${sql} WHERE id = ?1`, dis), /payment_notices_fixed/);
    await withoutTrigger("payment_notices_fixed", () =>
      run("UPDATE payment_notices SET close_note = 'other' WHERE id = ?1", dis),
    );
  });

  it("status flow: recorded once with a payment of the client and currency, or dismissed once, with who and when", async () => {
    const { client, contact, doc } = await setup();
    const staff = await mkMember("staff");
    const pay = await manualPayment(client);
    const usdPay = await manualPayment(client, "USD");
    const theirPay = await manualPayment(await mkClientRow());
    const id = uuidv7();
    await insertNotice({ id, clientId: client, documentId: doc, contactId: contact, reference: "FLOW1" });
    const set = (sql: string, ...p: unknown[]) =>
      run(`UPDATE payment_notices SET ${sql} WHERE id = ?1`, id, ...p);
    await rejects(
      set("status = 'recorded', closed_by = ?2, closed_at = 2000", staff),
      /payment_notices_status_flow/,
    );
    await rejects(
      set("status = 'recorded', payment_id = ?2, closed_by = ?3, closed_at = 2000", theirPay, staff),
      /payment_notices_status_flow/,
    );
    await rejects(
      set("status = 'recorded', payment_id = ?2, closed_by = ?3, closed_at = 2000", usdPay, staff),
      /payment_notices_status_flow/,
    );
    await rejects(set("status = 'recorded', payment_id = ?2", pay), /payment_notices_status_flow/);
    await rejects(
      set("status = 'dismissed', payment_id = ?2, closed_by = ?3, closed_at = 2000", pay, staff),
      /payment_notices_status_flow/,
    );
    await rejects(set("closed_at = 2000"), /payment_notices_status_flow/);
    const demo = uuidv7();
    await insertNotice({
      id: demo,
      clientId: client,
      documentId: doc,
      contactId: contact,
      reference: "FLOW0",
    });
    await withoutTrigger("payment_notices_status_flow", () =>
      run(
        "UPDATE payment_notices SET status = 'recorded', closed_by = ?2, closed_at = 2000 WHERE id = ?1",
        demo,
        staff,
      ),
    );
    await set("status = 'recorded', payment_id = ?2, closed_by = ?3, closed_at = 2000", pay, staff);
    await rejects(
      set("status = 'dismissed', payment_id = NULL"),
      /payment_notices_status_flow|payment_notices_fixed/,
    );
    await rejects(set("closed_at = 3000"), /payment_notices_fixed/);
    // A dismissed one is frozen too, and its reference is free again.
    const d = uuidv7();
    await insertNotice({ id: d, clientId: client, documentId: doc, contactId: contact, reference: "FLOW2" });
    await run(
      "UPDATE payment_notices SET status = 'dismissed', closed_by = ?2, closed_at = 2000 WHERE id = ?1",
      d,
      staff,
    );
    await rejects(
      run("UPDATE payment_notices SET status = 'open' WHERE id = ?1", d),
      /payment_notices_status_flow|payment_notices_fixed/,
    );
    await insertNotice({ clientId: client, documentId: doc, contactId: contact, reference: "FLOW2" });
  });

  it("fixed: the facts never change; contact and note only become empty; never deleted", async () => {
    const { client, contact, doc } = await setup();
    const id = uuidv7();
    await insertNotice({ id, clientId: client, documentId: doc, contactId: contact, reference: "FIX1" });
    const set = (sql: string) => run(`UPDATE payment_notices SET ${sql} WHERE id = ?1`, id);
    for (const sql of [
      "amount_minor = 2",
      "paid_on = '2026-11-03'",
      "reference = 'FIX2'",
      "reference_norm = 'FIX2'",
      "via = 'link'",
      "created_at = 1",
      "note = 'other words'",
    ])
      await rejects(set(sql), /payment_notices_fixed/);
    await withoutTrigger("payment_notices_fixed", async () => {
      await set("amount_minor = 2");
      await set("amount_minor = 1000");
    });
    await set("note = NULL, contact_id = NULL");
    await rejects(run("DELETE FROM payment_notices WHERE id = ?1", id), /payment_notices_no_delete/);
  });
});

describe("the writing triggers [run file A; the M6.2 pattern]", () => {
  it("a purged lead's request keeps its lead_ref, loses its lead_id, and the delete goes through (the brief's db test)", async () => {
    const lead = await mkLead();
    const id = uuidv7();
    await insertRequest({ id, leadId: lead, kind: "data_erasure", details: "Words of the enquirer" });
    await run("DELETE FROM leads WHERE id = ?1", lead);
    // Early check 1 finding 4: the person's words go with the lead, as with a contact.
    expect(
      await first("SELECT lead_id, lead_ref, details, status FROM client_requests WHERE id = ?1", id),
    ).toEqual({
      lead_id: null,
      lead_ref: lead,
      details: null,
      status: "open",
    });
    // Without the unlink the purge would fail on the foreign key.
    const lead2 = await mkLead();
    await insertRequest({ leadId: lead2 });
    await withoutTrigger("client_requests_unlink_lead", () =>
      rejects(run("DELETE FROM leads WHERE id = ?1", lead2), /FOREIGN KEY/),
    );
  });

  it("an erased contact (DELETE): its requests and notices lose the contact and the person's words, keep contact_ref and every fact", async () => {
    const client = await mkClientRow();
    const contact = await mkContact(client);
    const doc = await mkIssued(client);
    const staff = await mkMember("owner");
    const open = uuidv7();
    const closed = uuidv7();
    const notice = uuidv7();
    await insertRequest({
      id: open,
      clientId: client,
      contactId: contact,
      kind: "grievance",
      details: "My words",
    });
    await insertRequest({
      id: closed,
      clientId: client,
      contactId: contact,
      kind: "data_access",
      details: "More words",
    });
    await run(
      "UPDATE client_requests SET status = 'closed', outcome = 'done', closed_by = ?2, closed_at = 2000 WHERE id = ?1",
      closed,
      staff,
    );
    await insertNotice({
      id: notice,
      clientId: client,
      documentId: doc,
      contactId: contact,
      reference: "ERASE1",
    });
    await run("DELETE FROM contacts WHERE id = ?1", contact);
    const rows = await all(
      "SELECT id, contact_id, contact_ref, details, status, kind FROM client_requests WHERE id IN (?1, ?2) ORDER BY kind",
      open,
      closed,
    );
    expect(rows).toEqual([
      {
        id: closed,
        contact_id: null,
        contact_ref: contact,
        details: null,
        status: "closed",
        kind: "data_access",
      },
      { id: open, contact_id: null, contact_ref: contact, details: null, status: "open", kind: "grievance" },
    ]);
    expect(
      await first(
        "SELECT contact_id, note, amount_minor, reference, status FROM payment_notices WHERE id = ?1",
        notice,
      ),
    ).toEqual({
      contact_id: null,
      note: null,
      amount_minor: 1000,
      reference: "ERASE1",
      status: "open",
    });
  });

  it("each unlink trigger is what lets the contact go", async () => {
    const client = await mkClientRow();
    const doc = await mkIssued(client);
    const a = await mkContact(client);
    await insertRequest({ clientId: client, contactId: a });
    await withoutTrigger("client_requests_unlink_contact", () =>
      rejects(run("DELETE FROM contacts WHERE id = ?1", a), /FOREIGN KEY/),
    );
    const b = await mkContact(client);
    await insertNotice({ clientId: client, documentId: doc, contactId: b, reference: "UNLINK" });
    await withoutTrigger("payment_notices_unlink_contact", () =>
      rejects(run("DELETE FROM contacts WHERE id = ?1", b), /FOREIGN KEY/),
    );
  });

  it("an anonymised contact: the words are cleared, the links and facts stay; another contact's words are untouched", async () => {
    const client = await mkClientRow();
    const contact = await mkContact(client);
    const other = await mkContact(client);
    const doc = await mkIssued(client);
    const mine = uuidv7();
    const theirs = uuidv7();
    const notice = uuidv7();
    await insertRequest({
      id: mine,
      clientId: client,
      contactId: contact,
      kind: "grievance",
      details: "Mine",
    });
    await insertRequest({
      id: theirs,
      clientId: client,
      contactId: other,
      kind: "grievance",
      details: "Theirs",
    });
    await insertNotice({
      id: notice,
      clientId: client,
      documentId: doc,
      contactId: contact,
      reference: "ANON1",
    });
    await run(
      "UPDATE contacts SET name = 'Removed contact', anonymised_at = 9000, updated_at = 9000 WHERE id = ?1",
      contact,
    );
    expect(await first("SELECT contact_id, details FROM client_requests WHERE id = ?1", mine)).toEqual({
      contact_id: contact,
      details: null,
    });
    expect(await first("SELECT details FROM client_requests WHERE id = ?1", theirs)).toEqual({
      details: "Theirs",
    });
    expect(await first("SELECT contact_id, note FROM payment_notices WHERE id = ?1", notice)).toEqual({
      contact_id: contact,
      note: null,
    });
  });

  it("without the erase triggers the anonymise leaves the words (each trigger is the rule)", async () => {
    const client = await mkClientRow();
    const contact = await mkContact(client);
    const doc = await mkIssued(client);
    const req = uuidv7();
    const notice = uuidv7();
    await insertRequest({
      id: req,
      clientId: client,
      contactId: contact,
      kind: "grievance",
      details: "Kept?",
    });
    await insertNotice({
      id: notice,
      clientId: client,
      documentId: doc,
      contactId: contact,
      reference: "ANON2",
    });
    await withoutTrigger("client_requests_erase_details", () =>
      withoutTrigger("payment_notices_erase_note", () =>
        run("UPDATE contacts SET anonymised_at = 9000, updated_at = 9000 WHERE id = ?1", contact),
      ),
    );
    expect(await first("SELECT details FROM client_requests WHERE id = ?1", req)).toEqual({
      details: "Kept?",
    });
    expect(await first("SELECT note FROM payment_notices WHERE id = ?1", notice)).toEqual({
      note: "Paid by NEFT",
    });
  });
});
