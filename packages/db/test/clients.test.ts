// M3.3 database rules: the client and contact triggers, the new indexes and column, and the contact-access statements.
import { uuidv7 } from "@techaust/core";
import { CLIENT_BILLING_FIELDS, INVOICE_FAMILY, QUOTE_DOCUMENT_TYPES } from "@techaust/core/clients";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CONTACT_ON_ISSUED_DOCUMENT_SQL,
  deleteContactAccess,
  revokeContactAccess,
} from "../src/contact-access.ts";
import { guardSql } from "../src/log.ts";
import { clients, DOCUMENT_TYPES } from "../src/schema/index.ts";
import { clientTriggerStatements } from "../src/triggers.ts";
import { all, db, first, insertClient, rejects, run } from "./helpers.ts";

const newClient = (fields: Record<string, unknown> = {}) => {
  const row: Record<string, unknown> = {
    id: uuidv7(),
    code: `C-${crypto.randomUUID().slice(0, 8)}`,
    legal_name: "L",
    display_name: "D",
    type: "business",
    country: "IN",
    gst_status: "unregistered",
    state_code: "19",
    currency: "INR",
    ...fields,
  };
  const cols = Object.keys(row);
  return {
    id: row.id as string,
    insert: () =>
      run(
        `INSERT INTO clients (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        ...Object.values(row),
      ),
  };
};

const addDoc = (clientId: string, type: string, extra: Record<string, unknown> = {}) => {
  const id = uuidv7();
  // M4.3: a proposal or estimate is its own version group (document_triggers).
  const group = type === "proposal" || type === "estimate" ? { version_group_id: id } : {};
  const row: Record<string, unknown> = { id, type, client_id: clientId, currency: "INR", ...group, ...extra };
  const cols = Object.keys(row);
  return run(
    `INSERT INTO documents (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    ...Object.values(row),
  ).then(() => id);
};

const addContact = async (clientId: string, email: string, extra: Record<string, unknown> = {}) => {
  const id = uuidv7();
  const row: Record<string, unknown> = { id, client_id: clientId, name: "A", email, ...extra };
  const cols = Object.keys(row);
  await run(
    `INSERT INTO contacts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    ...Object.values(row),
  );
  return id;
};

describe("0018/0019: what M3.3 added", () => {
  it("contacts.legal_hold is off by default; clients, contacts and email_log have their new indexes", async () => {
    const c = await insertClient("C-M33-A");
    const contactId = await addContact(c, "a@example.com");
    expect(await first("SELECT legal_hold FROM contacts WHERE id = ?", contactId)).toEqual({ legal_hold: 0 });
    for (const [table, names] of [
      [
        "clients",
        ["clients_created", "clients_name_nocase", "clients_gst_status_created", "clients_currency_created"],
      ],
      ["contacts", ["contacts_one_primary"]],
      ["email_log", ["email_log_to"]],
    ] as const) {
      const idx = (await all<{ name: string }>(`SELECT name FROM pragma_index_list('${table}')`)).map(
        (i) => i.name,
      );
      expect(idx).toEqual(expect.arrayContaining([...names]));
    }
  });

  it("the client triggers are installed, one per statement of the set", async () => {
    const live = (await all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger'")).map(
      (t) => t.name,
    );
    expect(live).toEqual(
      expect.arrayContaining([
        "clients_currency_locked",
        "contacts_anonymised_frozen",
        "clients_state_check_insert",
        "clients_state_check_update",
      ]),
    );
    expect(clientTriggerStatements()).toHaveLength(4);
  });

  it("the invoice family and the quotes together are every document type", () => {
    expect([...INVOICE_FAMILY, ...QUOTE_DOCUMENT_TYPES].sort()).toEqual([...DOCUMENT_TYPES].sort());
  });

  it("every billing field is a column of the clients table", () => {
    const columns = Object.keys(getTableColumns(clients));
    for (const f of CLIENT_BILLING_FIELDS) expect(columns, f).toContain(f);
  });
});

describe("clients_currency_locked [ADM-CLI-01]", () => {
  it("a client without an invoice can change currency; a proposal or an estimate alone does not lock it", async () => {
    const c = await insertClient("C-M33-CUR1");
    await addDoc(c, "proposal");
    await addDoc(c, "estimate");
    await run("UPDATE clients SET currency = 'USD' WHERE id = ?", c);
    expect(await first("SELECT currency FROM clients WHERE id = ?", c)).toEqual({ currency: "USD" });
  });

  it.each(INVOICE_FAMILY)("a %s of any status locks the currency", async (type) => {
    const c = await insertClient(`C-M33-${type}`.slice(0, 15));
    await addDoc(c, type, { status: "draft" });
    await rejects(run("UPDATE clients SET currency = 'USD' WHERE id = ?", c), /currency is locked/);
    // Writing the same currency, or another field, is fine.
    await run("UPDATE clients SET currency = 'INR', notes = 'x' WHERE id = ?", c);
  });

  it("another client's invoice does not lock this one", async () => {
    const a = await insertClient("C-M33-CURA");
    const b = await insertClient("C-M33-CURB");
    await addDoc(a, "tax_invoice");
    await run("UPDATE clients SET currency = 'USD' WHERE id = ?", b);
  });
});

describe("clients_state_check [owner Q1, VERIFY WITH CA/LEGAL]", () => {
  it("registered and unregistered clients need a two-digit state code on insert", async () => {
    await rejects(newClient({ state_code: null }).insert(), /needs a state code/);
    await rejects(newClient({ state_code: "WB" }).insert(), /needs a state code/);
    await rejects(newClient({ state_code: "9" }).insert(), /needs a state code/);
    await rejects(
      newClient({ gst_status: "registered", gstin: "19AAACT2727Q1ZA", state_code: null }).insert(),
      /needs a state code/,
    );
    await newClient({ gst_status: "registered", gstin: "19AAACT2727Q1ZB", state_code: "19" }).insert();
  });

  it("an overseas client has no state code", async () => {
    await rejects(
      newClient({ gst_status: "overseas", country: "US", state_code: "19" }).insert(),
      /overseas client has none/,
    );
    await newClient({ gst_status: "overseas", country: "US", state_code: null }).insert();
  });

  it("changing the status or the state is checked; changing anything else on an old row is not", async () => {
    const c = newClient();
    await c.insert();
    await rejects(run("UPDATE clients SET state_code = NULL WHERE id = ?", c.id), /needs a state code/);
    await rejects(run("UPDATE clients SET gst_status = 'overseas' WHERE id = ?", c.id), /overseas/);
    await run("UPDATE clients SET gst_status = 'overseas', state_code = NULL WHERE id = ?", c.id);
    await rejects(
      run("UPDATE clients SET gst_status = 'unregistered' WHERE id = ?", c.id),
      /needs a state code/,
    );
    // A row from before the rule (no state) can still have its name changed.
    const old = newClient();
    await old.insert();
    await run("DROP TRIGGER clients_state_check_update");
    await run("UPDATE clients SET state_code = NULL WHERE id = ?", old.id);
    await run(clientTriggerStatements()[3] as string);
    await run("UPDATE clients SET display_name = 'Renamed' WHERE id = ?", old.id);
  });
});

describe("contacts: one primary, frozen tombstones", () => {
  it("a client has at most one primary contact (the unique partial index)", async () => {
    const c = await insertClient("C-M33-PRI");
    await addContact(c, "one@example.com", { is_primary: 1 });
    await addContact(c, "two@example.com", { is_primary: 0 });
    await rejects(addContact(c, "three@example.com", { is_primary: 1 }), /UNIQUE/);
    // Another client has its own.
    const d = await insertClient("C-M33-PRI2");
    await addContact(d, "one@example.com", { is_primary: 1 });
  });

  it("an anonymised contact cannot be updated (the tombstone is frozen)", async () => {
    const c = await insertClient("C-M33-ANON");
    const live = await addContact(c, "live@example.com");
    const gone = await addContact(c, "gone@example.com", { anonymised_at: Date.now() });
    await run("UPDATE contacts SET name = 'B' WHERE id = ?", live);
    await rejects(
      run("UPDATE contacts SET name = 'B' WHERE id = ?", gone),
      /anonymised contact cannot change/,
    );
    await rejects(run("UPDATE contacts SET anonymised_at = NULL WHERE id = ?", gone), /cannot change/);
    // Turning a live contact into a tombstone is allowed.
    await run(
      "UPDATE contacts SET anonymised_at = ?, name = 'Removed contact' WHERE id = ?",
      Date.now(),
      live,
    );
  });
});

describe("CONTACT_ON_ISSUED_DOCUMENT_SQL", () => {
  const onDoc = async (contactId: string) =>
    (
      (await first<{ x: number }>(
        `SELECT ${CONTACT_ON_ISSUED_DOCUMENT_SQL} AS x FROM contacts c JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?`,
        contactId,
      )) as { x: number }
    ).x;
  const frozen = (clientId: string, email: string | null) =>
    addDoc(clientId, "tax_invoice", {
      status: "issued",
      series: "invoice",
      fy: "2026-27",
      number: Math.floor(Math.random() * 1e9),
      number_display: `X${crypto.randomUUID().slice(0, 10)}`,
      frozen_at: Date.now(),
      recipient: email === null ? null : JSON.stringify({ legalName: "L", country: "IN", email }),
    });

  it("is true for the contact a sent proposal is addressed to (recipient.contactId), even after the email changed (M4.3)", async () => {
    const c = await insertClient("C-M43-DOC");
    const a = await addContact(c, "old@example.com");
    const b = await addContact(c, "other@example.com");
    // A sent proposal names the contact by id and by the email it had then; the email on the record has changed since.
    await addDoc(c, "proposal", {
      status: "sent",
      series: "proposal",
      fy: "2627",
      number: 1,
      number_display: "TH/PRP/2627/0001",
      frozen_at: Date.now(),
      recipient: JSON.stringify({ legalName: "L", country: "IN", email: "was@example.com", contactId: a }),
    });
    expect(await onDoc(a)).toBe(1);
    expect(await onDoc(b)).toBe(0);
  });

  it("is false with no document, with a draft, and with another contact's issued document", async () => {
    const c = await insertClient("C-M33-DOC1");
    const a = await addContact(c, "a@example.com");
    await addContact(c, "b@example.com");
    expect(await onDoc(a)).toBe(0);
    await addDoc(c, "tax_invoice", { recipient: JSON.stringify({ email: "a@example.com" }) });
    expect(await onDoc(a)).toBe(0);
    await frozen(c, "b@example.com");
    expect(await onDoc(a)).toBe(0);
  });

  it("is true when an issued document names the contact's email (any case), or the contact accepted a proposal", async () => {
    const c = await insertClient("C-M33-DOC2");
    const a = await addContact(c, "a@example.com");
    await frozen(c, "A@Example.com");
    expect(await onDoc(a)).toBe(1);

    const d = await insertClient("C-M33-DOC3");
    const e = await addContact(d, "e@example.com");
    const proposal = await addDoc(d, "proposal");
    await run(
      "INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, pdf_sha256) VALUES (?, ?, ?, 'E', 'e@example.com', ?, 'x')",
      uuidv7(),
      proposal,
      e,
      Date.now(),
    );
    expect(await onDoc(e)).toBe(1);
  });

  it("an individual client's contact is on any issued document of the client; another client's document does not count", async () => {
    const ind = await insertClient("C-M33-IND");
    await run("UPDATE clients SET type = 'individual' WHERE id = ?", ind);
    const p = await addContact(ind, "p@example.com");
    expect(await onDoc(p)).toBe(0);
    await frozen(ind, null);
    expect(await onDoc(p)).toBe(1);

    const biz = await insertClient("C-M33-BIZ");
    const q = await addContact(biz, "p@example.com");
    expect(await onDoc(q)).toBe(0);
  });
});

describe("contact access statements", () => {
  const seed = async () => {
    const c = await insertClient(`C-${crypto.randomUUID().slice(0, 8)}`);
    const contactId = await addContact(c, `${crypto.randomUUID()}@example.com`);
    const other = await addContact(c, `${crypto.randomUUID()}@example.com`);
    const t = Date.now();
    for (const [id, who] of [
      [`s-${contactId}`, contactId],
      [`s-${other}`, other],
    ] as const)
      await run(
        "INSERT INTO client_sessions (id, contact_id, client_id, last_seen_at, idle_expires_at, abs_expires_at) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        who,
        c,
        t,
        t + 1000,
        t + 1000,
      );
    for (const [hash, who, used] of [
      [`fresh-${contactId}`, contactId, null],
      [`used-${contactId}`, contactId, t],
      [`other-${other}`, other, null],
    ] as const)
      await run(
        "INSERT INTO magic_link_tokens (token_hash, contact_id, expires_at, used_at) VALUES (?, ?, ?, ?)",
        hash,
        who,
        t + 1000,
        used,
      );
    return { contactId, other };
  };
  const live = guardSql({ sql: () => "1 = 1", params: [] });
  const dead = guardSql({ sql: () => "1 = 0", params: [] });

  it("revoke: the contact's live sessions are revoked and its unused links deleted, nobody else's; a failing guard does nothing", async () => {
    const { contactId, other } = await seed();
    await db().batch(revokeContactAccess(db(), contactId, 123, dead));
    expect(
      await first("SELECT count(*) AS n FROM magic_link_tokens WHERE contact_id = ?", contactId),
    ).toEqual({
      n: 2,
    });
    await db().batch(revokeContactAccess(db(), contactId, 123, live));
    expect(await first("SELECT revoked_at FROM client_sessions WHERE contact_id = ?", contactId)).toEqual({
      revoked_at: 123,
    });
    expect(await first("SELECT revoked_at FROM client_sessions WHERE contact_id = ?", other)).toEqual({
      revoked_at: null,
    });
    // The used link stays as a record; the unused one is gone; the other contact's is untouched.
    expect(await all("SELECT token_hash FROM magic_link_tokens WHERE contact_id = ?", contactId)).toEqual([
      { token_hash: `used-${contactId}` },
    ]);
    expect(await first("SELECT count(*) AS n FROM magic_link_tokens WHERE contact_id = ?", other)).toEqual({
      n: 1,
    });
  });

  it("delete: every session and link of the contact goes, nobody else's", async () => {
    const { contactId, other } = await seed();
    await db().batch(deleteContactAccess(db(), contactId, dead));
    expect(await first("SELECT count(*) AS n FROM client_sessions WHERE contact_id = ?", contactId)).toEqual({
      n: 1,
    });
    await db().batch(deleteContactAccess(db(), contactId, live));
    expect(await first("SELECT count(*) AS n FROM client_sessions WHERE contact_id = ?", contactId)).toEqual({
      n: 0,
    });
    expect(
      await first("SELECT count(*) AS n FROM magic_link_tokens WHERE contact_id = ?", contactId),
    ).toEqual({
      n: 0,
    });
    expect(await first("SELECT count(*) AS n FROM client_sessions WHERE contact_id = ?", other)).toEqual({
      n: 1,
    });
  });
});
