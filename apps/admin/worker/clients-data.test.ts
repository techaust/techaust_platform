// Contacts and personal data [ADM-CLI-02, ADM-CLI-05, POR-01]: portal access follows the contact's flags in the same batch, the
// data-subject export (step-up, paged, scoped to one client) and erase / anonymise (owner, step-up, legal hold, issued documents).
import { env } from "cloudflare:workers";
import { ANONYMISED_CLIENT, ANONYMISED_CONTACT, anonymisedEmail } from "@techaust/core/clients";
import { uuidv7 } from "@techaust/core/ids";
import { describe, expect, it } from "vitest";
import { EXPORT_PARTS } from "./clients.ts";
import {
  beforeBatch,
  insert,
  mkAccess,
  mkClient,
  mkContact,
  mkDoc,
  mkLead,
  snapshot,
} from "./test-clients.ts";
import { bodyOf, call, countOf, one, rows, sessionFor } from "./test-helpers.ts";

// biome-ignore lint/suspicious/noExplicitAny: response bodies in tests are read loosely
type J = Record<string, any>;
const json = async (res: Response): Promise<J> => (await res.json()) as J;
const owner = () => sessionFor("owner", { stepUp: true });
const code = async (res: Response) => ((await bodyOf(res)) as { error: { code: string } }).error.code;
const erase = (cookie: string, id: string, body: Record<string, unknown> = {}, e: Env = env) =>
  call(`/contacts/${id}/erase`, { cookie, body: { mode: "erase", reason: "requested", ...body } }, e);
const exportPart = (cookie: string, id: string, body: Record<string, unknown> = {}) =>
  call(`/contacts/${id}/export`, { cookie, body });
const updatedAtOf = async (cookie: string, clientId: string, contactId: string) =>
  (await json(await call(`/clients/${clientId}`, { cookie }))).contacts.find((c: J) => c.id === contactId)
    .updatedAt as number;
const accessOf = async (contactId: string) => ({
  sessions: await rows<{ revoked_at: number | null }>(
    "SELECT revoked_at FROM client_sessions WHERE contact_id = ?",
    contactId,
  ),
  tokens: await countOf("magic_link_tokens", "contact_id = ?", contactId),
});

// ---------------------------------------------------------------------------------------------------------------
describe("portal access follows the contact's flags in the same batch [ADM-CLI-02, POR-01]", () => {
  it("portal access off: live sessions are revoked and unused sign-in links deleted; others are untouched", async () => {
    const s = await sessionFor("sales");
    const client = await mkClient();
    const a = await mkContact(client, { portal_access: 1 });
    const b = await mkContact(client, { portal_access: 1 });
    await mkAccess(a.id, client);
    await mkAccess(b.id, client);
    const res = await call(`/contacts/${a.id}`, {
      method: "PATCH",
      cookie: s.cookie,
      body: { expectedUpdatedAt: await updatedAtOf(s.cookie, client, a.id), portalAccess: false },
    });
    expect(res.status).toBe(200);
    const after = await accessOf(a.id);
    expect(after.sessions.every((x) => x.revoked_at !== null)).toBe(true);
    expect(after.tokens).toBe(0);
    const other = await accessOf(b.id);
    expect(other.sessions.every((x) => x.revoked_at === null)).toBe(true);
    expect(other.tokens).toBe(1);
  });

  it("a changed email does the same; turning access back on does not revive an old session", async () => {
    const s = await sessionFor("staff");
    const client = await mkClient();
    const a = await mkContact(client, { portal_access: 1 });
    const { session } = await mkAccess(a.id, client);
    const mail = await call(`/contacts/${a.id}`, {
      method: "PATCH",
      cookie: s.cookie,
      body: {
        expectedUpdatedAt: await updatedAtOf(s.cookie, client, a.id),
        email: "new.address@example.test",
      },
    });
    expect(mail.status).toBe(200);
    expect((await accessOf(a.id)).sessions[0]?.revoked_at).not.toBeNull();
    expect((await accessOf(a.id)).tokens).toBe(0);

    const off = await call(`/contacts/${a.id}`, {
      method: "PATCH",
      cookie: s.cookie,
      body: { expectedUpdatedAt: await updatedAtOf(s.cookie, client, a.id), portalAccess: false },
    });
    expect(off.status).toBe(200);
    const on = await call(`/contacts/${a.id}`, {
      method: "PATCH",
      cookie: s.cookie,
      body: { expectedUpdatedAt: await updatedAtOf(s.cookie, client, a.id), portalAccess: true },
    });
    expect(on.status).toBe(200);
    const row = await one<{ revoked_at: number | null }>(
      "SELECT revoked_at FROM client_sessions WHERE id = ?",
      session,
    );
    expect(row?.revoked_at).not.toBeNull(); // still revoked
    // The database says so too: a revoked session cannot be revived.
    await expect(
      env.DB.prepare("UPDATE client_sessions SET revoked_at = NULL WHERE id = ?").bind(session).run(),
    ).rejects.toThrow();
  });

  it("changing something else leaves the sessions and links alone", async () => {
    const s = await sessionFor("sales");
    const client = await mkClient();
    const a = await mkContact(client, { portal_access: 1 });
    await mkAccess(a.id, client);
    await call(`/contacts/${a.id}`, {
      method: "PATCH",
      cookie: s.cookie,
      body: { expectedUpdatedAt: await updatedAtOf(s.cookie, client, a.id), title: "Buyer", isBilling: true },
    });
    const now = await accessOf(a.id);
    expect(now.sessions.every((x) => x.revoked_at === null)).toBe(true);
    expect(now.tokens).toBe(1);
  });

  it("a refused change (stale, duplicate address) ends no access", async () => {
    const s = await sessionFor("sales");
    const client = await mkClient();
    const a = await mkContact(client, { portal_access: 1 });
    const b = await mkContact(client);
    await mkAccess(a.id, client);
    const stale = await call(`/contacts/${a.id}`, {
      method: "PATCH",
      cookie: s.cookie,
      body: { expectedUpdatedAt: 1, portalAccess: false },
    });
    expect(stale.status).toBe(409);
    const dup = await call(`/contacts/${a.id}`, {
      method: "PATCH",
      cookie: s.cookie,
      body: { expectedUpdatedAt: await updatedAtOf(s.cookie, client, a.id), email: b.email },
    });
    expect(dup.status).toBe(409);
    const now = await accessOf(a.id);
    expect(now.sessions.every((x) => x.revoked_at === null)).toBe(true);
    expect(now.tokens).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("POST /contacts/:id/export [ADM-CLI-05]", () => {
  it("needs a fresh step-up and the owner; staff, sales and the accountant are refused", async () => {
    const client = await mkClient();
    const c = await mkContact(client);
    const noStepUp = await sessionFor("owner");
    const res = await exportPart(noStepUp.cookie, c.id);
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("step_up_required");
    for (const role of ["staff", "sales", "accountant"] as const) {
      const s = await sessionFor(role, { stepUp: true });
      expect((await exportPart(s.cookie, c.id)).status, role).toBe(403);
    }
    expect(await countOf("audit_log", "action = 'contact.export' AND entity_id = ?", client)).toBe(0);
  });

  it("the first call returns the contact, the client, the suppression entry and the manifest", async () => {
    const o = await owner();
    const biz = await mkClient();
    const c = await mkContact(biz, { phone: "+91 90000 44444", portal_access: 1 });
    await insert("email_suppressions", { email: c.email, reason: "bounce", at: 5 });
    const out = await json(await exportPart(o.cookie, c.id));
    expect(out.contact).toMatchObject({
      id: c.id,
      email: c.email,
      phone: "+91 90000 44444",
      portal_access: 1,
    });
    expect(Object.keys(out.client).sort()).toEqual(["code", "display_name"]); // a business client: code and name only
    expect(out.suppression).toMatchObject({ email: c.email, reason: "bounce" });
    expect(out.manifest).toEqual(Object.keys(EXPORT_PARTS));
    // An individual client's own record is the person's data: the full row.
    const ind = await mkClient({
      type: "individual",
      notes: "Allergic to meetings",
      billing_address: JSON.stringify({ line1: "9 Lane", city: "Pune", country: "IN" }),
    });
    const p = await mkContact(ind);
    const full = await json(await exportPart(o.cookie, p.id));
    expect(full.client).toMatchObject({ notes: "Allergic to meetings", type: "individual" });
    expect(full.client.billing_address).toContain("9 Lane");
  });

  it("every part returns this person's rows and none of another client's (the same email at clients A and B)", async () => {
    const o = await owner();
    const email = "twin@example.test";
    const A = await mkClient();
    const B = await mkClient();
    const a = await mkContact(A, { email, portal_access: 1 });
    const b = await mkContact(B, { email, portal_access: 1 });
    const leadFree = await mkLead(email);
    const leadA = await mkLead(email, { client_id: A });
    const leadB = await mkLead(email, { client_id: B });
    await mkLead("someone.else@example.test");
    const accA = await mkAccess(a.id, A);
    await mkAccess(b.id, B);
    const docA = await mkDoc(A, "tax_invoice", { frozen: true, recipientEmail: "TWIN@example.test" });
    await mkDoc(A, "tax_invoice", { frozen: true, recipientEmail: "nobody@example.test" });
    await mkDoc(A, "tax_invoice", { recipientEmail: email }); // a draft: not issued
    await mkDoc(B, "tax_invoice", { frozen: true, recipientEmail: email });
    const propA = await mkDoc(A, "proposal");
    const propB = await mkDoc(B, "proposal");
    for (const [prop, who] of [
      [propA, a.id],
      [propB, b.id],
    ] as const)
      await insert("acceptances", {
        id: uuidv7(),
        document_id: prop,
        contact_id: who,
        typed_name: "T",
        email,
        accepted_at: 9,
        ip: "203.0.113.4",
        pdf_sha256: "x",
      });
    await insert("email_log", { id: uuidv7(), to_email: email, template: "portal.link", status: "sent" });
    await insert("audit_log", {
      id: uuidv7(),
      actor_type: "contact",
      actor_id: a.id,
      action: "portal.login",
      entity_type: "contact",
      entity_id: a.id,
      ip: "203.0.113.4",
    });
    await insert("audit_log", {
      id: uuidv7(),
      actor_type: "contact",
      actor_id: b.id,
      action: "portal.login",
      entity_type: "contact",
      entity_id: b.id,
    });
    await insert("access_log", {
      id: uuidv7(),
      realm: "portal",
      actor_id: a.id,
      method: "GET",
      route: "/v1/me",
      status: 200,
      ip: "203.0.113.4",
    });
    await insert("access_log", {
      id: uuidv7(),
      realm: "portal",
      actor_id: b.id,
      method: "GET",
      route: "/v1/me",
      status: 200,
    });

    const part = async (name: string) =>
      (await json(await exportPart(o.cookie, a.id, { part: name }))).items as J[];
    expect((await part("leads")).map((r) => r.id).sort()).toEqual([leadFree, leadA].sort());
    expect(leadB).toBeTruthy();
    expect((await part("lead_activities")).map((r) => r.lead_id).sort()).toEqual([leadFree, leadA].sort());
    const sessions = await part("sessions");
    expect(sessions).toHaveLength(1);
    expect(JSON.stringify(sessions)).not.toContain(accA.session); // no token hash
    expect(sessions[0]).toMatchObject({ ip: "203.0.113.9", user_agent: "Test/1.0" });
    const links = await part("magic_links");
    expect(links).toHaveLength(1);
    expect(Object.keys(links[0] as J).sort()).toEqual(["created_at", "expires_at", "id", "used_at"]);
    expect(JSON.stringify(links)).not.toContain(accA.link);
    expect((await part("acceptances")).map((r) => r.document_id)).toEqual([propA]);
    expect((await part("documents")).map((r) => r.id)).toEqual([docA]);
    expect((await part("email_log")).map((r) => r.template)).toEqual(["portal.link"]);
    // The person's own actions; staff rows about them (this request's earlier exports) come with the audit part too.
    expect(
      (await part("audit_log")).filter((r) => r.actor_type === "contact").map((r) => r.actor_id),
    ).toEqual([a.id]);
    expect((await part("access_log")).map((r) => r.actor_id)).toEqual([a.id]);
    // An individual client's contact gets every issued document of the client.
    const ind = await mkClient({ type: "individual" });
    const p = await mkContact(ind);
    const d1 = await mkDoc(ind, "tax_invoice", { frozen: true });
    await mkDoc(ind, "tax_invoice");
    expect(
      (await json(await exportPart(o.cookie, p.id, { part: "documents" }))).items.map((r: J) => r.id),
    ).toEqual([d1]);
  });

  it("pages of at most 50: a cursor continues, the last page has no next, and the cursor is not the person's data", async () => {
    const o = await owner();
    const client = await mkClient();
    const c = await mkContact(client);
    for (let i = 0; i < 51; i++)
      await insert("email_log", {
        id: uuidv7(),
        to_email: c.email,
        template: "t",
        status: "sent",
        created_at: 1_800_000_000_000 + i,
      });
    const first = await json(await exportPart(o.cookie, c.id, { part: "email_log" }));
    expect(first.items).toHaveLength(50);
    expect(first.next).toEqual(expect.any(String));
    const second = await json(await exportPart(o.cookie, c.id, { part: "email_log", after: first.next }));
    expect(second.items).toHaveLength(1);
    expect(second.next).toBeNull();
    expect(new Set([...first.items, ...second.items].map((r: J) => r.id)).size).toBe(51);
    // Id-ordered and rowid-ordered parts page the same way.
    for (let i = 0; i < 52; i++) await mkAccess(c.id, client);
    const s1 = await json(await exportPart(o.cookie, c.id, { part: "sessions" }));
    expect(s1.items).toHaveLength(50);
    const s2 = await json(await exportPart(o.cookie, c.id, { part: "sessions", after: s1.next }));
    expect(s2.items).toHaveLength(2);
    expect(s2.next).toBeNull();
    expect((await exportPart(o.cookie, c.id, { part: "email_log", after: "garbage" })).status).toBe(400);
    expect((await exportPart(o.cookie, c.id, { part: "nope" })).status).toBe(400);
  });

  it("writes one audit row per call with ids and counts only; an anonymised or unknown contact is refused; a client id is a 400", async () => {
    const o = await owner();
    const client = await mkClient();
    const c = await mkContact(client, { name: "Hidden Export Person" });
    await exportPart(o.cookie, c.id);
    await exportPart(o.cookie, c.id, { part: "leads" });
    await exportPart(o.cookie, c.id, { part: "audit_log" });
    const audit = await rows<{ summary: string; entity_type: string }>(
      "SELECT summary, entity_type FROM audit_log WHERE action = 'contact.export' AND entity_id = ? ORDER BY at, id",
      client,
    );
    expect(audit).toHaveLength(3);
    expect(audit.map((a) => JSON.parse(a.summary).part).sort()).toEqual(["audit_log", "leads", "summary"]);
    for (const a of audit) {
      expect(a.entity_type).toBe("client");
      expect(a.summary).not.toMatch(/@|Hidden/);
    }
    const gone = await mkContact(client, { anonymised_at: Date.now() });
    const res = await exportPart(o.cookie, gone.id);
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("contact_anonymised");
    expect((await exportPart(o.cookie, "nope")).status).toBe(404);
    expect((await exportPart(o.cookie, c.id, { clientId: client })).status).toBe(400);
    expect(await countOf("audit_log", "action = 'contact.export' AND entity_id = ?", client)).toBe(3);
  });

  it("the audit part holds what staff did about this person, shows an address only for the person's own actions, and is bounded by the entity index", async () => {
    const o = await owner();
    const client = await mkClient();
    const c = await mkContact(client);
    const other = await mkContact(client);
    await insert("audit_log", {
      id: uuidv7(),
      actor_type: "contact",
      actor_id: c.id,
      action: "portal.login",
      entity_type: "contact",
      entity_id: c.id,
      ip: "203.0.113.4",
      user_agent: "ContactAgent/1",
    });
    const staffHeaders = { "CF-Connecting-IP": "203.0.113.77", "User-Agent": "StaffAgent/1" };
    for (const who of [c, other]) {
      const res = await call(`/contacts/${who.id}`, {
        method: "PATCH",
        cookie: o.cookie,
        headers: staffHeaders,
        body: { expectedUpdatedAt: await updatedAtOf(o.cookie, client, who.id), title: "Buyer" },
      });
      expect(res.status).toBe(200);
    }
    const items = (await json(await exportPart(o.cookie, c.id, { part: "audit_log" }))).items as J[];
    const staffRows = items.filter((r) => r.actor_type === "staff");
    expect(items.some((r) => r.action === "portal.login")).toBe(true);
    expect(staffRows.map((r) => r.action)).toEqual(["contact.update"]); // this person's, not the other contact's
    expect(JSON.parse(staffRows[0]?.summary).contactId).toBe(c.id);
    expect(staffRows.every((r) => r.ip === null && r.user_agent === null)).toBe(true);
    expect(items.find((r) => r.action === "portal.login")).toMatchObject({
      ip: "203.0.113.4",
      user_agent: "ContactAgent/1",
    });
    expect(JSON.stringify(items)).not.toMatch(/203\.0\.113\.77|StaffAgent/);
    // The export's own audit row about this person is there too, still without the staff address.
    const again = (await json(await exportPart(o.cookie, c.id, { part: "audit_log" }))).items as J[];
    expect(again.some((r) => r.action === "contact.export" && r.ip === null)).toBe(true);
    // The third arm is read through the entity index (entity type, entity id), never a scan.
    const detail = (
      await rows<{ detail: string }>(
        `EXPLAIN QUERY PLAN ${EXPORT_PARTS.audit_log?.sql(false)}`,
        "c",
        "e@example.test",
        "k",
      )
    )
      .map((r) => r.detail)
      .join("\n");
    expect(detail).toContain("audit_log_entity");
  });

  it("every part reads through an index, never a scan of its table", async () => {
    const plan = async (sql: string, n: number) =>
      (
        await rows<{ detail: string }>(
          `EXPLAIN QUERY PLAN ${sql}`,
          ...["c", "e@example.test", "k", 1, "z"].slice(0, n),
        )
      )
        .map((r) => r.detail)
        .join("\n");
    const tables =
      "leads|lead_activities|client_sessions|magic_link_tokens|acceptances|documents|email_log|audit_log|access_log|clients|contacts";
    for (const [name, part] of Object.entries(EXPORT_PARTS)) {
      for (const cur of [false, true]) {
        const sql = part.sql(cur);
        const top = Math.max(...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
        const detail = await plan(sql, top);
        expect(detail, `${name} ${cur}`).not.toMatch(new RegExp(`^SCAN (${tables})(?! USING)`, "m"));
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("POST /contacts/:id/erase: erase and anonymise [ADM-CLI-05; owner answers 2026-10-25, VERIFY WITH CA/LEGAL]", () => {
  it("only the owner, with a fresh step-up", async () => {
    const client = await mkClient();
    const c = await mkContact(client);
    const before = await snapshot();
    const noStepUp = await sessionFor("owner");
    const res = await erase(noStepUp.cookie, c.id);
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("step_up_required");
    for (const role of ["staff", "sales", "accountant"] as const)
      expect((await erase((await sessionFor(role, { stepUp: true })).cookie, c.id)).status, role).toBe(403);
    expect(await snapshot()).toBe(before);
  });

  it("erase removes the contact, its portal access and the personal details on its leads, and keeps the logs; another client's contact of the same email is untouched", async () => {
    const o = await owner();
    const email = "shared.person@example.test";
    const A = await mkClient();
    const B = await mkClient();
    const a = await mkContact(A, {
      email,
      name: "Shared Person",
      is_primary: 1,
      portal_access: 1,
      marketing_consent: JSON.stringify({ granted: true, at: 1, source: "admin" }),
    });
    const b = await mkContact(B, { email, name: "Shared Person", portal_access: 1 });
    await mkAccess(a.id, A);
    await mkAccess(b.id, B);
    const leadFree = await mkLead(email, {}, o.id);
    const leadA = await mkLead(email, { client_id: A });
    const leadB = await mkLead(email, { client_id: B });
    const other = await mkLead("unrelated@example.test");
    await insert("email_suppressions", { email, reason: "bounce", at: 3 });
    await insert("email_log", { id: uuidv7(), to_email: email, template: "portal.link", status: "sent" });
    const keep = async () => ({
      untouched: JSON.stringify([
        await rows("SELECT * FROM leads WHERE id IN (?, ?)", leadB, other),
        await rows("SELECT * FROM lead_activities WHERE lead_id IN (?, ?)", leadB, other),
        await rows("SELECT * FROM contacts WHERE id = ?", b.id),
        await rows("SELECT * FROM client_sessions WHERE contact_id = ?", b.id),
        await rows("SELECT * FROM magic_link_tokens WHERE contact_id = ?", b.id),
        await rows("SELECT * FROM clients WHERE id IN (?, ?)", A, B),
      ]),
      kept: JSON.stringify([
        await rows("SELECT * FROM email_log WHERE to_email = ?", email),
        await rows("SELECT * FROM email_suppressions WHERE email = ?", email),
      ]),
    });
    const before = await keep();
    const accessBefore = await countOf("access_log");
    const bellBefore = await countOf("notifications", "entity_id = ?", leadFree);
    expect(bellBefore).toBe(1);

    const res = await erase(o.cookie, a.id, { reason: "consent_withdrawn" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await json(res)).toEqual({ ok: true, mode: "erase" });

    expect(await countOf("contacts", "id = ?", a.id)).toBe(0);
    expect(await accessOf(a.id)).toEqual({ sessions: [], tokens: 0 });
    for (const id of [leadFree, leadA]) {
      const lead = await one<J>("SELECT * FROM leads WHERE id = ?", id);
      expect(lead).toMatchObject({
        contact_name: ANONYMISED_CONTACT,
        contact_email: anonymisedEmail(a.id),
        contact_phone: null,
        contact_company: null,
        message: null,
        call_window: null,
        utm: null,
        source_page: null,
        referrer_host: null,
        next_action_note: null,
      });
      const consent = JSON.parse(lead?.consent as string);
      expect(consent.ipHash).toBeUndefined();
      expect(consent.noticeVersion).toBe("v1"); // the rest of the receipt stays
      expect(await rows("SELECT body FROM lead_activities WHERE lead_id = ?", id)).toEqual([{ body: null }]);
    }
    expect(await countOf("notifications", "entity_id = ?", leadFree)).toBe(0);
    const after = await keep();
    expect(after.untouched).toBe(before.untouched);
    expect(after.kept).toBe(before.kept); // the email log and the suppression entry stay
    expect(await countOf("access_log")).toBeGreaterThanOrEqual(accessBefore); // the access log is never touched

    // One audit row on the client, with ids and codes only.
    const audit = await rows<{
      action: string;
      entity_type: string;
      entity_id: string;
      summary: string;
      actor_type: string;
    }>(
      "SELECT action, entity_type, entity_id, summary, actor_type FROM audit_log WHERE action IN ('contact.erase', 'contact.anonymise') AND entity_id = ?",
      A,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "contact.erase", entity_type: "client", actor_type: "staff" });
    expect(JSON.parse(audit[0]?.summary ?? "{}")).toEqual({
      contactId: a.id,
      mode: "erase",
      reason: "consent_withdrawn",
    });
    expect(audit[0]?.summary).not.toMatch(/@|Shared/);
    // ...which still shows in the client's activity after the contact is gone.
    const activity = await json(await call(`/clients/${A}/activity?limit=50`, { cookie: o.cookie }));
    expect(activity.entries.map((e: J) => e.action)).toContain("contact.erase");
  });

  it("anonymise keeps the row as a tombstone: the 07-J name, the placeholder address, every flag cleared, access gone", async () => {
    const o = await owner();
    const A = await mkClient();
    const c = await mkContact(A, {
      name: "Rao Person",
      phone: "+91 1",
      title: "CTO",
      is_primary: 1,
      is_billing: 1,
      portal_access: 1,
      can_see_finance: 1,
      bounced_at: 5,
      marketing_consent: JSON.stringify({ granted: true, at: 1, source: "admin" }),
    });
    const second = await mkContact(A);
    await mkAccess(c.id, A);
    const res = await erase(o.cookie, c.id, { mode: "anonymise", reason: "not_needed" });
    expect(await json(res)).toEqual({ ok: true, mode: "anonymise" });
    expect(await one("SELECT * FROM contacts WHERE id = ?", c.id)).toMatchObject({
      name: ANONYMISED_CONTACT,
      email: anonymisedEmail(c.id),
      phone: null,
      title: null,
      is_primary: 0,
      is_billing: 0,
      portal_access: 0,
      can_see_finance: 0,
      marketing_consent: null,
      bounced_at: null,
    });
    expect(
      (await one<J>("SELECT anonymised_at FROM contacts WHERE id = ?", c.id))?.anonymised_at,
    ).toBeGreaterThan(0);
    expect(await accessOf(c.id)).toEqual({ sessions: [], tokens: 0 });
    expect(await countOf("contacts", "id = ?", second.id)).toBe(1);
    // Done once: the tombstone is frozen, and a second go is a 409.
    const again = await erase(o.cookie, c.id, { mode: "anonymise" });
    expect(again.status).toBe(409);
    expect(await code(again)).toBe("contact_anonymised");
    expect((await erase(o.cookie, c.id)).status).toBe(409);
    expect(await code(await erase(o.cookie, "nope"))).toBe("not_found");
    expect(
      await one("SELECT action FROM audit_log WHERE action = 'contact.anonymise' AND entity_id = ?", A),
    ).toEqual({ action: "contact.anonymise" });
  });

  it("an individual client's record is anonymised with its last live contact, in both modes (owner Q2); a business client's never is", async () => {
    const o = await owner();
    for (const mode of ["erase", "anonymise"] as const) {
      const ind = await mkClient({
        type: "individual",
        legal_name: "Pat Private",
        display_name: "Pat Private",
        notes: "n",
        tags: '["vip"]',
        billing_address: JSON.stringify({ line1: "x", city: "y", country: "IN" }),
        service_address: JSON.stringify({ line1: "x", city: "y", country: "IN" }),
      });
      const one1 = await mkContact(ind);
      const two = await mkContact(ind);
      expect((await erase(o.cookie, one1.id, { mode })).status).toBe(200);
      expect(await one("SELECT display_name FROM clients WHERE id = ?", ind)).toEqual({
        display_name: "Pat Private",
      }); // not the last
      expect((await erase(o.cookie, two.id, { mode })).status).toBe(200);
      expect(
        await one(
          "SELECT legal_name, display_name, notes, tags, billing_address, service_address, type, state_code FROM clients WHERE id = ?",
          ind,
        ),
      ).toEqual({
        legal_name: ANONYMISED_CLIENT,
        display_name: ANONYMISED_CLIENT,
        notes: null,
        tags: null,
        billing_address: null,
        service_address: null,
        type: "individual",
        state_code: "19", // the tax identity needed by the issued documents stays
      });
    }
    const biz = await mkClient({ display_name: "Plain Business", notes: "keep" });
    const only = await mkContact(biz);
    expect((await erase(o.cookie, only.id)).status).toBe(200);
    expect(await one("SELECT display_name, notes FROM clients WHERE id = ?", biz)).toEqual({
      display_name: "Plain Business",
      notes: "keep",
    });
  });

  it("erase is blocked when the person is on something the law keeps: nothing at all is written; anonymise still works", async () => {
    const o = await owner();
    // a) an issued document names their email
    const A = await mkClient();
    const onDoc = await mkContact(A, { email: "on.invoice@example.test" });
    const docId = await mkDoc(A, "tax_invoice", { frozen: true, recipientEmail: "ON.INVOICE@example.test" });
    // b) they accepted a proposal
    const B = await mkClient();
    const accepted = await mkContact(B);
    await insert("acceptances", {
      id: uuidv7(),
      document_id: await mkDoc(B, "proposal"),
      contact_id: accepted.id,
      typed_name: "T",
      email: accepted.email,
      accepted_at: 5,
      pdf_sha256: "x",
    });
    // c) an individual client with any issued document
    const C = await mkClient({ type: "individual" });
    const person = await mkContact(C);
    await mkDoc(C, "tax_invoice", { frozen: true });
    for (const [name, id, why] of [
      ["document", onDoc.id, "on_issued_document"],
      ["acceptance", accepted.id, "on_issued_document"],
      ["individual", person.id, "on_issued_document"],
    ] as const) {
      await mkLead((await one<J>("SELECT email FROM contacts WHERE id = ?", id))?.email);
      const before = await snapshot();
      const res = await erase(o.cookie, id);
      expect(res.status, name).toBe(409);
      expect(await code(res), name).toBe(why);
      expect(await snapshot(), name).toBe(before);
    }
    // Anonymise is allowed there, and the issued document keeps its snapshot.
    const frozenBefore = JSON.stringify(await rows("SELECT * FROM documents WHERE id = ?", docId));
    const res = await erase(o.cookie, onDoc.id, { mode: "anonymise" });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await rows("SELECT * FROM documents WHERE id = ?", docId))).toBe(frozenBefore);
    expect((await erase(o.cookie, accepted.id, { mode: "anonymise" })).status).toBe(200);
    expect(await countOf("acceptances", "contact_id = ?", accepted.id)).toBe(1); // evidence stays
    expect((await erase(o.cookie, person.id, { mode: "anonymise" })).status).toBe(200);
    expect((await one<J>("SELECT display_name FROM clients WHERE id = ?", C))?.display_name).toBe(
      ANONYMISED_CLIENT,
    );
  });

  it("a document frozen after the request began but before its batch still blocks the erase", async () => {
    const o = await owner();
    const A = await mkClient();
    const c = await mkContact(A, { email: "late.invoice@example.test" });
    const res = await erase(
      o.cookie,
      c.id,
      {},
      beforeBatch(async () => {
        await mkDoc(A, "tax_invoice", { frozen: true, recipientEmail: "late.invoice@example.test" });
      }),
    );
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("on_issued_document");
    expect(await countOf("contacts", "id = ?", c.id)).toBe(1);
    expect(await countOf("audit_log", "action = 'contact.erase' AND entity_id = ?", A)).toBe(0);
  });

  it("a legal hold on the contact, its client or one of their leads stops both modes: nothing is written", async () => {
    const o = await owner();
    const cases: [string, () => Promise<string>][] = [
      ["contact", async () => (await mkContact(await mkClient(), { legal_hold: 1 })).id],
      ["client", async () => (await mkContact(await mkClient({ legal_hold: 1 }))).id],
      [
        "lead",
        async () => {
          const c = await mkContact(await mkClient());
          await mkLead(c.email, { legal_hold: 1 });
          return c.id;
        },
      ],
    ];
    for (const [name, make] of cases) {
      const id = await make();
      for (const mode of ["erase", "anonymise"] as const) {
        const before = await snapshot();
        const res = await erase(o.cookie, id, { mode });
        expect(res.status, `${name} ${mode}`).toBe(409);
        expect(await code(res), `${name} ${mode}`).toBe("legal_hold");
        expect(await snapshot(), `${name} ${mode}`).toBe(before);
      }
    }
  });

  it("one failing statement undoes the whole erase (the audit row, the leads, the access, the contact)", async () => {
    const o = await owner();
    const A = await mkClient();
    const c = await mkContact(A, { name: "Boom Person", portal_access: 1 });
    await mkAccess(c.id, A);
    await mkLead(c.email, {}, o.id);
    const before = await snapshot();
    await env.DB.prepare(
      "CREATE TRIGGER test_boom BEFORE DELETE ON contacts WHEN OLD.name = 'Boom Person' BEGIN SELECT RAISE(ABORT, 'boom'); END",
    ).run();
    try {
      const res = await erase(o.cookie, c.id);
      expect(res.status).toBe(500);
      expect(await snapshot()).toBe(before);
    } finally {
      await env.DB.prepare("DROP TRIGGER test_boom").run();
    }
    expect((await erase(o.cookie, c.id)).status).toBe(200);
  });

  it("rejects bad bodies: unknown mode or reason, a client id, nothing; unknown contacts are 404", async () => {
    const o = await owner();
    const c = await mkContact(await mkClient());
    for (const body of [
      {},
      { mode: "erase" },
      { mode: "delete", reason: "other" },
      { mode: "erase", reason: "because" },
      { mode: "erase", reason: "other", clientId: "x" },
      { mode: "erase", reason: "other", note: "free text" },
    ])
      expect(
        (await call(`/contacts/${c.id}/erase`, { cookie: o.cookie, body })).status,
        JSON.stringify(body),
      ).toBe(400);
    expect(await countOf("contacts", "id = ?", c.id)).toBe(1);
    expect((await erase(o.cookie, "no-such-contact")).status).toBe(404);
    for (const reason of ["requested", "consent_withdrawn", "not_needed", "other"]) {
      const x = await mkContact(await mkClient());
      expect((await erase(o.cookie, x.id, { reason })).status, reason).toBe(200);
    }
  });

  it("no client or contact audit row holds an address, a name or a phone number", async () => {
    const rowsAll = await rows<{ action: string; summary: string | null }>(
      "SELECT action, summary FROM audit_log WHERE action LIKE 'client.%' OR action LIKE 'contact.%'",
    );
    expect(rowsAll.length).toBeGreaterThan(5);
    for (const r of rowsAll) expect(r.summary ?? "", r.action).not.toMatch(/@|\+91|Person|Test Co|Road|Lane/);
  });
});
