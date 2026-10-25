// M3.3 review fixes: the client type lock trigger and the leads.contact_id column with its backfill (0021-0023).

import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { all, first, insertClient, rejects, run } from "./helpers.ts";

const addContact = async (clientId: string, email: string) => {
  const id = uuidv7();
  await run("INSERT INTO contacts (id, client_id, name, email) VALUES (?, ?, 'A', ?)", id, clientId, email);
  return id;
};

const addLead = (id: string, email: string, clientId: string | null, contactId: string | null = null) =>
  run(
    "INSERT INTO leads (id, ref, source, contact_name, contact_email, client_id, contact_id) VALUES (?, ?, 'web', 'N', ?, ?, ?)",
    id,
    id.toUpperCase(),
    email,
    clientId,
    contactId,
  );

const frozenDoc = (clientId: string) =>
  run(
    "INSERT INTO documents (id, type, client_id, currency, status, series, fy, number, number_display, frozen_at) VALUES (?, 'tax_invoice', ?, 'INR', 'issued', 'invoice', '2026-27', ?, ?, 1)",
    uuidv7(),
    clientId,
    9000 + Math.floor(Math.random() * 100000),
    `TL/${crypto.randomUUID().slice(0, 8)}`,
  );

describe("clients_type_locked (0023) [ADM-CLI-01]", () => {
  it("the type changes freely until an issued document exists, then it is locked at the database", async () => {
    const c = await insertClient("C-M33-TYP1");
    const draft = uuidv7();
    await run(
      "INSERT INTO documents (id, type, client_id, currency, version_group_id) VALUES (?1, 'proposal', ?2, 'INR', ?1)",
      draft,
      c,
    );
    await run("UPDATE clients SET type = 'individual' WHERE id = ?", c);
    await frozenDoc(c);
    await rejects(run("UPDATE clients SET type = 'business' WHERE id = ?", c), /client type is locked/);
    // The same type, or another field, is fine; another client is unaffected.
    await run("UPDATE clients SET type = 'individual', notes = 'x' WHERE id = ?", c);
    const other = await insertClient("C-M33-TYP2");
    await run("UPDATE clients SET type = 'individual' WHERE id = ?", other);
  });
});

describe("leads.contact_id (0021, 0022) [ADM-CLI-05, ADM-LEAD-05]", () => {
  it("is indexed and goes to NULL when the contact is deleted", async () => {
    const c = await insertClient("C-M33-LCID");
    const contactId = await addContact(c, "lcid@example.com");
    const idx = (await all<{ name: string }>("SELECT name FROM pragma_index_list('leads')")).map(
      (i) => i.name,
    );
    expect(idx).toContain("leads_contact");
    await addLead("l-cid", "lcid@example.com", c, contactId);
    await run("DELETE FROM contacts WHERE id = ?", contactId);
    expect(await first("SELECT contact_id FROM leads WHERE id = 'l-cid'")).toEqual({ contact_id: null });
  });

  it("the backfill links converted leads by address (case aside) and leaves the rest alone", async () => {
    const a = await insertClient("C-M33-BF1");
    const b = await insertClient("C-M33-BF2");
    const ca = await addContact(a, "bf@example.com");
    await addLead("l-bf1", "BF@Example.com", a);
    await addLead("l-bf2", "bf@example.com", b);
    await addLead("l-bf3", "bf@example.com", null);
    const file = env.TEST_MIGRATIONS.find((m) => m.name === "0022_leads_contact_backfill.sql");
    expect(file).toBeDefined();
    for (const q of file?.queries ?? []) await run(q.replace(/^--.*\n/gm, ""));
    expect(await first("SELECT contact_id FROM leads WHERE id = 'l-bf1'")).toEqual({ contact_id: ca });
    expect(await first("SELECT contact_id FROM leads WHERE id = 'l-bf2'")).toEqual({ contact_id: null });
    expect(await first("SELECT contact_id FROM leads WHERE id = 'l-bf3'")).toEqual({ contact_id: null });
  });
});
