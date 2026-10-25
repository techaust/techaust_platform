// M3.3 review fixes [ADM-CLI-01, ADM-CLI-02, ADM-CLI-05, ADM-LEAD-04]: a converted lead stays linked to its contact (erase,
// anonymise, hold, export), the email-log export is scoped to the client, billing saves, the contact page cursor and live count.
import { env } from "cloudflare:workers";
import { ANONYMISED_CONTACT } from "@techaust/core/clients";
import { uuidv7 } from "@techaust/core/ids";
import { describe, expect, it } from "vitest";
import { beforeBatch, insert, mkClient, mkContact, mkDoc, mkLead, snapshot } from "./test-clients.ts";
import { bodyOf, call, one, rows, sessionFor } from "./test-helpers.ts";

// biome-ignore lint/suspicious/noExplicitAny: response bodies in tests are read loosely
type J = Record<string, any>;
const json = async (res: Response): Promise<J> => (await res.json()) as J;
const owner = () => sessionFor("owner", { stepUp: true });
const code = async (res: Response) => ((await bodyOf(res)) as { error: { code: string } }).error.code;
const erase = (cookie: string, id: string, mode: "erase" | "anonymise") =>
  call(`/contacts/${id}/erase`, { cookie, body: { mode, reason: "requested" } });

/** A lead converted through the API, then the contact's email changed (as staff would). */
async function convertedThenRenamed(email: string, newEmail: string) {
  const o = await owner();
  const lead = await mkLead(email);
  const res = await call(`/leads/${lead}/convert`, {
    body: { type: "business", country: "IN", gstStatus: "unregistered", stateCode: "19", currency: "INR" },
    cookie: o.cookie,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const out = (await res.json()) as { clientId: string; contactId: string };
  await env.DB.prepare("UPDATE contacts SET email = ?2 WHERE id = ?1").bind(out.contactId, newEmail).run();
  return { o, lead, ...out };
}

describe("leads.contact_id keeps the link after the contact's email changes [ADM-CLI-05, ADM-LEAD-04]", () => {
  it("the convert batch sets contact_id", async () => {
    const x = await convertedThenRenamed("conv1@example.test", "conv1.new@example.test");
    expect(await one("SELECT contact_id, client_id FROM leads WHERE id = ?", x.lead)).toEqual({
      contact_id: x.contactId,
      client_id: x.clientId,
    });
  });

  it.each(["erase", "anonymise"] as const)(
    "%s finds the converted lead by contact_id after an email change and strips its personal details",
    async (mode) => {
      const x = await convertedThenRenamed(`conv-${mode}@example.test`, `conv-${mode}.new@example.test`);
      expect((await erase(x.o.cookie, x.contactId, mode)).status).toBe(200);
      expect(
        await one(
          "SELECT contact_name, contact_phone, message, contact_company FROM leads WHERE id = ?",
          x.lead,
        ),
      ).toEqual({
        contact_name: ANONYMISED_CONTACT,
        contact_phone: null,
        message: null,
        contact_company: null,
      });
      expect(
        await rows("SELECT body FROM lead_activities WHERE lead_id = ? AND body IS NOT NULL", x.lead),
      ).toEqual([]);
    },
  );

  it.each(["erase", "anonymise"] as const)(
    "a legal hold on the converted lead stops %s after an email change: 409 and nothing written",
    async (mode) => {
      const x = await convertedThenRenamed(`hold-${mode}@example.test`, `hold-${mode}.new@example.test`);
      await env.DB.prepare("UPDATE leads SET legal_hold = 1 WHERE id = ?").bind(x.lead).run();
      const before = await snapshot();
      const res = await erase(x.o.cookie, x.contactId, mode);
      expect(res.status).toBe(409);
      expect(await code(res)).toBe("legal_hold");
      expect(await snapshot()).toBe(before);
    },
  );

  it("the export's leads part finds the converted lead after an email change", async () => {
    const x = await convertedThenRenamed("exp1@example.test", "exp1.new@example.test");
    const res = await call(`/contacts/${x.contactId}/export`, {
      cookie: x.o.cookie,
      body: { part: "leads" },
    });
    expect(((await json(res)).items as J[]).map((r) => r.id)).toEqual([x.lead]);
  });
});

describe("the email-log export keeps only this client's lead and document mail [ADM-CLI-05]", () => {
  it("a shared address lists no other client's rows or entity ids", async () => {
    const o = await owner();
    const email = "shared@example.test";
    const A = await mkClient();
    const B = await mkClient();
    const a = await mkContact(A, { email });
    await mkContact(B, { email });
    const leadA = await mkLead(email, { client_id: A });
    const leadB = await mkLead(email, { client_id: B });
    const leadNone = await mkLead(email);
    const docA = await mkDoc(A, "proposal");
    const docB = await mkDoc(B, "proposal");
    const log = (entity_type: string | null, entity_id: string | null, template: string) =>
      insert("email_log", {
        id: uuidv7(),
        to_email: email,
        template,
        entity_type,
        entity_id,
        status: "sent",
      });
    // As the Workers log them: lead emails by the lead's ref (jobs), staff replies by the reply activity's id (admin).
    const ref = async (id: string) =>
      (await rows<{ ref: string }>("SELECT ref FROM leads WHERE id = ?", id))[0]?.ref ?? "";
    const replyOf = async (leadId: string) => {
      const rid = uuidv7();
      await insert("lead_activities", { id: rid, lead_id: leadId, kind: "reply", body: "Re: your enquiry" });
      return rid;
    };
    await log("lead", await ref(leadA), "t.leadA");
    await log("lead", await ref(leadB), "t.leadB");
    await log("lead", await ref(leadNone), "t.leadNone");
    await log("lead_reply", await replyOf(leadA), "t.replyA");
    await log("lead_reply", await replyOf(leadB), "t.replyB");
    await log("document", docA, "t.docA");
    await log("document", docB, "t.docB");
    await log("lead", "missing-lead", "t.leadGone");
    await log("document", "missing-doc", "t.docGone");
    await log("magic_link", "tokenhash", "t.link");
    await log(null, null, "t.plain");
    const res = await call(`/contacts/${a.id}/export`, { cookie: o.cookie, body: { part: "email_log" } });
    const got = ((await json(res)).items as J[]).map((r) => r.template).sort();
    expect(got).toEqual([
      "t.docA",
      "t.docGone",
      "t.leadA",
      "t.leadGone",
      "t.leadNone",
      "t.link",
      "t.plain",
      "t.replyA",
    ]);
  });
});

describe("billing saves [ADM-CLI-01]", () => {
  const billing = (cookie: string, id: string, body: Record<string, unknown>, e: Env = env) =>
    call(`/clients/${id}/billing`, { method: "PATCH", cookie, body }, e);
  const updatedAt = async (cookie: string, id: string) =>
    ((await json(await call(`/clients/${id}`, { cookie }))).client as J).updatedAt as number;

  it("a save that does not touch the currency answers stale_version, never currency_locked, when it loses a race", async () => {
    const o = await owner();
    const id = await mkClient();
    const expected = await updatedAt(o.cookie, id);
    const racing = beforeBatch(async () => {
      await env.DB.prepare("UPDATE clients SET updated_at = updated_at + 5 WHERE id = ?").bind(id).run();
    });
    const res = await billing(o.cookie, id, { expectedUpdatedAt: expected, paymentTermsDays: 21 }, racing);
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("stale_version");
  });

  it("a terms-only save on an old client with no state works; touching the tax identity still needs the state", async () => {
    const o = await owner();
    const id = await mkClient();
    // An old row from before the state rule: the insert trigger is dropped for the setup only.
    const trig = await one<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'clients_state_check_update'",
    );
    await env.DB.prepare("DROP TRIGGER clients_state_check_update").run();
    try {
      await env.DB.prepare("UPDATE clients SET state_code = NULL WHERE id = ?").bind(id).run();
    } finally {
      await env.DB.prepare((trig as { sql: string }).sql).run();
    }
    const ok = await billing(o.cookie, id, {
      expectedUpdatedAt: await updatedAt(o.cookie, id),
      paymentTermsDays: 45,
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await one("SELECT payment_terms_days FROM clients WHERE id = ?", id)).toEqual({
      payment_terms_days: 45,
    });
    const bad = await billing(o.cookie, id, {
      expectedUpdatedAt: await updatedAt(o.cookie, id),
      gstStatus: "unregistered",
    });
    expect(bad.status).toBe(400);
    expect(await code(bad)).toBe("state_required");
  });
});

describe("the client page's contact cursor and live count [ADM-CLI-02]", () => {
  it("returns contactsNext after the 100th row, GET /contacts?after= continues from it, and the count skips anonymised contacts", async () => {
    const o = await owner();
    const id = await mkClient();
    const made: string[] = [];
    for (let i = 0; i < 102; i++)
      made.push((await mkContact(id, { email: `bulk${String(i).padStart(3, "0")}@example.test` })).id);
    await env.DB.prepare("UPDATE contacts SET anonymised_at = 1 WHERE id = ?").bind(made[3]).run();
    const page = await json(await call(`/clients/${id}`, { cookie: o.cookie }));
    expect(page.contacts).toHaveLength(100);
    expect(page.moreContacts).toBe(true);
    expect(typeof page.contactsNext).toBe("string");
    expect(page.liveContactCount).toBe(101);
    const rest = await json(
      await call(`/clients/${id}/contacts?after=${encodeURIComponent(page.contactsNext)}`, {
        cookie: o.cookie,
      }),
    );
    expect(rest.contacts.map((c: J) => c.email)).toEqual(["bulk100@example.test", "bulk101@example.test"]);
    expect(rest.next).toBeNull();

    const small = await mkClient();
    await mkContact(small);
    const s = await json(await call(`/clients/${small}`, { cookie: o.cookie }));
    expect(s.contactsNext).toBeNull();
    expect(s.liveContactCount).toBe(1);
  });
});
