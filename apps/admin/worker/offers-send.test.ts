// M4.5 stage B on the admin Worker [ADM-PROP-07..10, ADM-APR-01, ADM-CLI-05]: the send takes its recipients, writes its send rows in the same batch (or refuses
// the whole send), the document page tells the offer's story, the approvals email, and erase / anonymise / access-off clean up the offer links.
// Failure paths first. Figures and ids are made up (@example.test).
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { beforeAll, describe, expect, it } from "vitest";
import { ACCEPTANCE_SQL, DECISION_SQL, DELIVERY_SQL, PROJECT_SQL } from "./document-offer.ts";
import { putPaymentTerms } from "./test-catalogue.ts";
import { insert, mkClient, mkContact } from "./test-clients.ts";
import { call, countOf, one, rows, sessionFor, withEnv } from "./test-helpers.ts";
import {
  beforeSendBatch,
  codeOf,
  counter,
  discount,
  getDoc,
  type J,
  json,
  mkDraft,
  mkTerms,
} from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
});

/** Both queues recorded: what the Worker hands to the jobs Worker. */
function queues(failEmail = false) {
  const email: unknown[] = [];
  const pdf: unknown[] = [];
  const q = (into: unknown[], fail = false) => ({
    send: async (m: unknown) => {
      if (fail) throw new Error("queue down");
      into.push(m);
    },
    sendBatch: async (ms: { body: unknown }[]) => {
      if (fail) throw new Error("queue down");
      for (const m of ms) into.push(m.body);
    },
  });
  return { env: withEnv(env, { EMAIL_QUEUE: q(email, failEmail), PDF_QUEUE: q(pdf) }), email, pdf };
}

const send = (cookie: string, id: string, body: unknown, e: Env = env) =>
  call(`/documents/${id}/send`, { cookie, body }, e);

/** A draft of a fresh client with two contacts that have portal access. */
async function draft() {
  const s = await owner();
  const made = await mkDraft(s);
  const v = await getDoc(s, made.id);
  const a = await mkContact(made.clientId, {
    portal_access: 1,
    name: "Asha Rao",
    email: "asha.rao@example.test",
  });
  const b = await mkContact(made.clientId, { portal_access: 1, name: "Bala Sen" });
  return { s, made, v, a, b };
}

/** What a refused send must leave behind: nothing. */
async function untouched(id: string, counterBefore: number) {
  expect((await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", id))?.status).toBe(
    "draft",
  );
  expect(await counter()).toBe(counterBefore);
  expect(await countOf("document_sends", "document_id = ?", id)).toBe(0);
  expect(await countOf("audit_log", "action = 'document.send' AND entity_id = ?", id)).toBe(0);
}

// ---- the recipients ------------------------------------------------------------------------------------------------------------

describe("the send takes 1 to 5 recipients; anything else changes nothing [ADM-PROP-07]", () => {
  it("a body without contactIds, or with a free-text message, is a 400", async () => {
    const { s, made, v } = await draft();
    const before = await counter();
    expect((await send(s.cookie, made.id, { expectedUpdatedAt: v.updatedAt })).status).toBe(400);
    expect(
      (await send(s.cookie, made.id, { expectedUpdatedAt: v.updatedAt, contactIds: ["x"], message: "hi" }))
        .status,
    ).toBe(400);
    expect((await send(s.cookie, made.id, { expectedUpdatedAt: v.updatedAt, contactIds: "x" })).status).toBe(
      400,
    );
    await untouched(made.id, before);
  });

  it("none is 400 recipients_required; six is 400 recipients_too_many", async () => {
    const { s, made, v } = await draft();
    const before = await counter();
    const none = await send(s.cookie, made.id, { expectedUpdatedAt: v.updatedAt, contactIds: [] });
    expect(none.status).toBe(400);
    expect(await codeOf(none)).toBe("recipients_required");
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push((await mkContact(made.clientId, { portal_access: 1 })).id);
    const many = await send(s.cookie, made.id, { expectedUpdatedAt: v.updatedAt, contactIds: ids });
    expect(many.status).toBe(400);
    expect(await codeOf(many)).toBe("recipients_too_many");
    await untouched(made.id, before);
  });

  it("the same contact twice is 409 recipient_invalid and names it", async () => {
    const { s, made, v, a } = await draft();
    const before = await counter();
    const res = await send(s.cookie, made.id, { expectedUpdatedAt: v.updatedAt, contactIds: [a.id, a.id] });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error.code).toBe("recipient_invalid");
    expect(body.contactIds).toEqual([a.id]);
    await untouched(made.id, before);
  });

  it("another client's contact, one without portal access, an anonymised one and an unknown one: 409 recipient_invalid, named, nothing burned", async () => {
    const { s, made, v, a } = await draft();
    const other = await mkContact(await mkClient(), { portal_access: 1 });
    const noAccess = await mkContact(made.clientId, { portal_access: 0 });
    const gone = await mkContact(made.clientId, { portal_access: 1, anonymised_at: Date.now() });
    const before = await counter();
    for (const bad of [other.id, noAccess.id, gone.id, "no-such-contact"]) {
      const res = await send(s.cookie, made.id, { expectedUpdatedAt: v.updatedAt, contactIds: [a.id, bad] });
      expect(res.status, bad).toBe(409);
      const body = await json(res);
      expect(body.error.code).toBe("recipient_invalid");
      expect(body.contactIds).toEqual([bad]);
    }
    await untouched(made.id, before);
  });

  it("a recipient who loses portal access between the read and the batch refuses the WHOLE send: no number, no rows, no audit row", async () => {
    const { s, made, v, a, b } = await draft();
    const before = await counter();
    const e = beforeSendBatch(async () => {
      await env.DB.prepare("UPDATE contacts SET portal_access = 0 WHERE id = ?").bind(b.id).run();
    });
    const res = await send(
      s.cookie,
      made.id,
      { expectedUpdatedAt: v.updatedAt, contactIds: [a.id, b.id] },
      e,
    );
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error.code).toBe("recipient_invalid");
    expect(body.contactIds).toEqual([b.id]);
    await untouched(made.id, before);
    // the same send without the lost contact goes through
    const again = await send(s.cookie, made.id, { expectedUpdatedAt: v.updatedAt, contactIds: [a.id] });
    expect(again.status, await again.clone().text()).toBe(200);
  });

  it("a recipient anonymised between the read and the batch refuses the whole send too", async () => {
    const { s, made, v, a } = await draft();
    const before = await counter();
    const e = beforeSendBatch(async () => {
      await env.DB.prepare("UPDATE contacts SET anonymised_at = ?, name = 'Removed contact' WHERE id = ?")
        .bind(Date.now(), a.id)
        .run();
    });
    const res = await send(s.cookie, made.id, { expectedUpdatedAt: v.updatedAt, contactIds: [a.id] }, e);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("recipient_invalid");
    await untouched(made.id, before);
  });
});

// ---- the send rows ------------------------------------------------------------------------------------------------------------

describe("a send writes one row per recipient in its own batch, waiting for the PDF [ADM-PROP-07]", () => {
  it("rows: kind send, address as stored, no queued stamp; the PDF is requested and NO email is queued yet", async () => {
    const { s, made, v, a, b } = await draft();
    const q = queues();
    const res = await send(
      s.cookie,
      made.id,
      { expectedUpdatedAt: v.updatedAt, contactIds: [a.id, b.id] },
      q.env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const sends = await rows<J>(
      "SELECT contact_id, email, attach_pdf, kind, queued_at, created_by, version_group_id, client_id FROM document_sends WHERE document_id = ? ORDER BY email",
      made.id,
    );
    expect(sends).toHaveLength(2);
    expect(sends[0]).toMatchObject({
      contact_id: a.id,
      email: "asha.rao@example.test",
      kind: "send",
      queued_at: null,
      created_by: s.id,
      client_id: made.clientId,
    });
    expect(sends[0]?.version_group_id).toBe(made.id);
    expect(q.email).toEqual([]); // the email follows the PDF (onRendered in the jobs Worker)
    expect(q.pdf).toEqual([{ v: 1, kind: "pdf.snapshot", documentId: made.id, reason: "send" }]);
    expect(await countOf("audit_log", "action = 'document.send' AND entity_id = ?", made.id)).toBe(1);
  });

  it("attachPdf follows the client's setting unless the request says otherwise", async () => {
    const one1 = await draft();
    await env.DB.prepare("UPDATE clients SET attach_pdf = 1 WHERE id = ?").bind(one1.made.clientId).run();
    expect(
      (
        await send(one1.s.cookie, one1.made.id, {
          expectedUpdatedAt: one1.v.updatedAt,
          contactIds: [one1.a.id],
        })
      ).status,
    ).toBe(200);
    expect(
      (await one<J>("SELECT attach_pdf FROM document_sends WHERE document_id = ?", one1.made.id))?.attach_pdf,
    ).toBe(1);
    const two = await draft();
    await env.DB.prepare("UPDATE clients SET attach_pdf = 1 WHERE id = ?").bind(two.made.clientId).run();
    expect(
      (
        await send(two.s.cookie, two.made.id, {
          expectedUpdatedAt: two.v.updatedAt,
          contactIds: [two.a.id],
          attachPdf: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (await one<J>("SELECT attach_pdf FROM document_sends WHERE document_id = ?", two.made.id))?.attach_pdf,
    ).toBe(0);
    const three = await draft();
    expect(
      (
        await send(three.s.cookie, three.made.id, {
          expectedUpdatedAt: three.v.updatedAt,
          contactIds: [three.a.id],
          attachPdf: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (await one<J>("SELECT attach_pdf FROM document_sends WHERE document_id = ?", three.made.id))
        ?.attach_pdf,
    ).toBe(1);
  });

  it("a send that fails for another reason (stale version) writes no rows", async () => {
    const { s, made, v, a } = await draft();
    const before = await counter();
    const res = await send(s.cookie, made.id, { expectedUpdatedAt: v.updatedAt - 1, contactIds: [a.id] });
    expect(res.status).toBe(409);
    await untouched(made.id, before);
  });

  it("the send rows cannot be changed afterwards except the stamp, once (the database says so)", async () => {
    const { s, made, v, a } = await draft();
    await send(s.cookie, made.id, { expectedUpdatedAt: v.updatedAt, contactIds: [a.id] });
    const row = await one<{ id: string }>("SELECT id FROM document_sends WHERE document_id = ?", made.id);
    await expect(
      env.DB.prepare("UPDATE document_sends SET attach_pdf = 1 - attach_pdf WHERE id = ?")
        .bind(row?.id)
        .run(),
    ).rejects.toThrow(/document_sends_fixed/);
    await env.DB.prepare("UPDATE document_sends SET queued_at = 5 WHERE id = ?").bind(row?.id).run();
    await expect(
      env.DB.prepare("UPDATE document_sends SET queued_at = 6 WHERE id = ?").bind(row?.id).run(),
    ).rejects.toThrow(/document_sends_fixed/);
  });
});

// ---- the page ------------------------------------------------------------------------------------------------------------------

/** A sent proposal with one recipient, the accepting contact's evidence, and whatever the test adds. */
async function sentOffer() {
  const d = await draft();
  expect(
    (await send(d.s.cookie, d.made.id, { expectedUpdatedAt: d.v.updatedAt, contactIds: [d.a.id] })).status,
  ).toBe(200);
  return d;
}
const accept = async (docId: string, contactId: string) => {
  const id = uuidv7();
  await insert("acceptances", {
    id,
    document_id: docId,
    contact_id: contactId,
    typed_name: "Asha Rao",
    email: "asha.rao@example.test",
    accepted_at: Date.now(),
    ip: "203.0.113.9",
    user_agent: "UA/1",
    country: "IN",
    pdf_sha256: "p".repeat(64),
    snapshot_sha256: "s".repeat(64),
    via: "link",
    certificate_r2_key: "docs/proposal/2026-27/0001-v1-certificate.pdf",
  });
  await env.DB.prepare(
    "UPDATE documents SET status = 'accepted', decided_at = ?2, decided_contact_id = ?3 WHERE id = ?1",
  )
    .bind(docId, Date.now(), contactId)
    .run();
  return id;
};

describe("GET /documents/:id tells the offer's story [ADM-PROP-07, ADM-PROP-08]", () => {
  it("delivery: waiting for the PDF, then what the email log says; the address as stored", async () => {
    const { s, made } = await sentOffer();
    const first = await getDoc(s, made.id);
    expect(first.delivery).toHaveLength(1);
    expect(first.delivery[0]).toMatchObject({
      version: 1,
      kind: "send",
      state: "waiting_pdf",
      attachPdf: false,
      contactName: "Asha Rao",
      email: "asha.rao@example.test",
    });
    const sendId = first.delivery[0].id as string;
    await env.DB.prepare("UPDATE document_sends SET queued_at = ? WHERE id = ?")
      .bind(Date.now(), sendId)
      .run();
    expect((await getDoc(s, made.id)).delivery[0].state).toBe("queued");
    await insert("email_log", {
      id: uuidv7(),
      to_email: "asha.rao@example.test",
      template: "offer.sent",
      entity_type: "document_send",
      entity_id: sendId,
      status: "sent",
    });
    expect((await getDoc(s, made.id)).delivery[0].state).toBe("sent");
    expect(first.acceptance).toBeNull();
    expect(first.decision).toBeNull();
    expect(first.certificate).toEqual({ state: "none" });
    expect(first.startProject).toBeNull();
  });

  it("acceptance: the owner sees the IP address and browser; everyone else does not; the certificate state follows its row", async () => {
    const { s, made, a } = await sentOffer();
    await accept(made.id, a.id);
    const asOwner = await getDoc(s, made.id);
    expect(asOwner.acceptance).toMatchObject({
      typedName: "Asha Rao",
      via: "link",
      country: "IN",
      ip: "203.0.113.9",
      userAgent: "UA/1",
      contactName: "Asha Rao",
    });
    expect(asOwner.certificate).toEqual({ state: "pending" });
    const staff = await sessionFor("staff");
    const asStaff = await getDoc(staff, made.id);
    expect(asStaff.acceptance).toMatchObject({ typedName: "Asha Rao", via: "link" });
    expect(Object.keys(asStaff.acceptance)).not.toContain("ip");
    expect(Object.keys(asStaff.acceptance)).not.toContain("userAgent");
    const accId = (await one<{ id: string }>("SELECT id FROM acceptances WHERE document_id = ?", made.id))
      ?.id;
    await insert("acceptance_certificates", {
      acceptance_id: accId,
      r2_key: "k",
      sha256: "c",
      rendered_at: Date.now(),
    });
    expect((await getDoc(s, made.id)).certificate).toEqual({ state: "ready" });
  });

  it("decision: the reason, the note and who declined", async () => {
    const { s, made, a } = await sentOffer();
    await env.DB.prepare(
      "UPDATE documents SET status = 'rejected', decided_at = ?2, decided_contact_id = ?3, decision_reason = 'price', decision_note = 'Too high' WHERE id = ?1",
    )
      .bind(made.id, 1_790_000_000_000, a.id)
      .run();
    const doc = await getDoc(s, made.id);
    expect(doc.decision).toEqual({
      status: "rejected",
      at: 1_790_000_000_000,
      reason: "price",
      note: "Too high",
      contactName: "Asha Rao",
    });
    expect(doc.acceptance).toBeNull();
  });

  it("start project: the dialog's numbers are exactly what the route writes", async () => {
    const { s, made, a } = await sentOffer();
    await accept(made.id, a.id);
    const page = await getDoc(s, made.id);
    expect(page.startProject.project).toBeNull();
    expect(page.startProject.milestones).toBeGreaterThan(0);
    const res = await call(`/documents/${made.id}/start-project`, { cookie: s.cookie, body: {} });
    expect(res.status, await res.clone().text()).toBe(201);
    const created = await json(res);
    const milestones = await countOf("milestones", "project_id = ?", created.projectId);
    expect(milestones).toBe(page.startProject.milestones);
    if (page.startProject.firstInstalment) {
      const draftDoc = await one<{ total_minor: number; type: string }>(
        "SELECT total_minor, type FROM documents WHERE source_document_id = ? AND source_step = 1",
        made.id,
      );
      expect(draftDoc?.total_minor).toBe(page.startProject.firstInstalment.amountMinor);
      expect(draftDoc?.type).toBe(page.startProject.firstInstalment.type);
    }
    const after = await getDoc(s, made.id);
    expect(after.startProject.project).toEqual({ id: created.projectId, code: created.code });
  });

  it("an estimate or a draft has no start-project numbers", async () => {
    const s = await owner();
    const made = await mkDraft(s);
    const page = await getDoc(s, made.id);
    expect(page.startProject).toBeNull();
    expect(page.delivery).toEqual([]);
    expect(page.certificate).toEqual({ state: "none" });
  });
});

describe("every filter of the offer history is indexed [Free plan: index every filter]", () => {
  it("EXPLAIN: each statement reaches its rows by an index, never a scan", async () => {
    const plan = async (sql: string) =>
      (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, "no-such-id"))
        .map((r) => r.detail)
        .join(" | ");
    const delivery = await plan(DELIVERY_SQL);
    for (const index of ["documents_version", "document_sends_document", "email_log_entity"])
      expect(delivery).toContain(index);
    expect(await plan(ACCEPTANCE_SQL)).toContain("acceptances_document");
    expect(await plan(DECISION_SQL)).toContain("documents_version");
    expect(await plan(PROJECT_SQL)).toContain("projects_source_document");
    for (const sql of [DELIVERY_SQL, ACCEPTANCE_SQL, DECISION_SQL, PROJECT_SQL]) {
      expect(await plan(sql), sql).not.toContain("SCAN ");
    }
  });
});

// ---- the approval emails ----------------------------------------------------------------------------------------------------

describe("the two approval emails are queued after the answer, ids only [ADM-APR-01]", () => {
  async function pending() {
    const sales = await sessionFor("sales");
    const made = await mkDraft(sales, { price: 20_000_000 });
    const v = await discount(sales, made.id, "fixed", 5_000_000);
    return { sales, made, v };
  }

  it("a request queues approval.notify requested; the decision queues decided; a queue that is down never fails the request", async () => {
    const { sales, made, v } = await pending();
    const q = queues();
    const req = await call(
      `/documents/${made.id}/approval-request`,
      { cookie: sales.cookie, body: { expectedUpdatedAt: v.updatedAt } },
      q.env,
    );
    expect(req.status).toBe(201);
    const { id } = await json(req);
    expect(q.email).toEqual([{ kind: "approval.notify", approvalId: id, event: "requested" }]);

    const o = await owner();
    const q2 = queues();
    const decided = await call(
      `/approvals/${id}/decide`,
      { cookie: o.cookie, body: { decision: "approve" } },
      q2.env,
    );
    expect(decided.status).toBe(200);
    expect(q2.email).toEqual([{ kind: "approval.notify", approvalId: id, event: "decided" }]);
    // a second decision is refused and queues nothing
    const q3 = queues();
    expect(
      (await call(`/approvals/${id}/decide`, { cookie: o.cookie, body: { decision: "reject" } }, q3.env))
        .status,
    ).toBe(409);
    expect(q3.email).toEqual([]);
  });

  it("with the email queue down the request is still created (the bell rang in the same batch)", async () => {
    const { sales, made, v } = await pending();
    const q = queues(true);
    const req = await call(
      `/documents/${made.id}/approval-request`,
      { cookie: sales.cookie, body: { expectedUpdatedAt: v.updatedAt } },
      q.env,
    );
    expect(req.status).toBe(201);
    const { id } = await json(req);
    expect(
      await countOf("notifications", "kind = 'approval.requested' AND entity_id = ?", id),
    ).toBeGreaterThan(0);
  });
});

// ---- erase, anonymise, access off, export --------------------------------------------------------------------------------------

/** An offer link of `contact` on the document, plus its send row. */
async function linkFor(docId: string, contactId: string, clientId: string) {
  const sendId =
    (
      await one<{ id: string }>(
        "SELECT id FROM document_sends WHERE document_id = ? AND contact_id = ?",
        docId,
        contactId,
      )
    )?.id ?? null;
  const token = `tok-${uuidv7()}`;
  await insert("offer_links", {
    token_hash: token,
    send_id: sendId,
    document_id: docId,
    version_group_id: docId,
    client_id: clientId,
    contact_id: contactId,
    email: "person@example.test",
    purpose: "offer",
    expires_at: Date.now() + 86_400_000,
  });
  return { token, sendId };
}

describe("a contact's offer links and send rows follow the contact [ADM-CLI-02, ADM-CLI-05]", () => {
  const eraseBody = (mode: "erase" | "anonymise") => ({ mode, reason: "requested" });

  it("portal access off ends every live offer link of the contact (revoked, not deleted), and no one else's", async () => {
    const { s, made, a, b } = await sentOffer();
    const la = await linkFor(made.id, a.id, made.clientId);
    const lb = await linkFor(made.id, b.id, made.clientId);
    const at = (await json(await call(`/clients/${made.clientId}`, { cookie: s.cookie }))).contacts.find(
      (c: J) => c.id === a.id,
    ).updatedAt;
    const res = await call(`/contacts/${a.id}`, {
      method: "PATCH",
      cookie: s.cookie,
      body: { expectedUpdatedAt: at, portalAccess: false },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(
      (await one<J>("SELECT revoked_at FROM offer_links WHERE token_hash = ?", la.token))?.revoked_at,
    ).not.toBeNull();
    expect(
      (await one<J>("SELECT revoked_at FROM offer_links WHERE token_hash = ?", lb.token))?.revoked_at,
    ).toBeNull();
  });

  it("erase: the contact's links are deleted and their send rows keep existing without a contact or an address", async () => {
    const { s, made, a } = await sentOffer();
    await env.DB.prepare("UPDATE documents SET status = 'revised' WHERE id = ?").bind(made.id).run();
    const l = await linkFor(made.id, a.id, made.clientId);
    const spare = await mkContact(made.clientId, { portal_access: 1 });
    await env.DB.prepare("DELETE FROM document_sends WHERE contact_id = ?").bind(spare.id).run();
    // `a` is the document's addressee? no: the draft's own contact is `made.contactId`; `a` is a plain recipient
    const res = await call(`/contacts/${a.id}/erase`, { cookie: s.cookie, body: eraseBody("erase") });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await countOf("offer_links", "token_hash = ?", l.token)).toBe(0);
    const row = await one<J>("SELECT contact_id, email FROM document_sends WHERE id = ?", l.sendId);
    expect(row).toEqual({ contact_id: null, email: null });
    expect(await countOf("contacts", "id = ?", a.id)).toBe(0);
  });

  it("a contact who declined is on an issued document: erase is refused, anonymise works and removes the links", async () => {
    const { s, made, b } = await sentOffer();
    const sendB = uuidv7();
    await insert("document_sends", {
      id: sendB,
      document_id: made.id,
      version_group_id: made.id,
      client_id: made.clientId,
      contact_id: b.id,
      email: "bala@example.test",
      attach_pdf: 0,
      kind: "resend",
      created_by: s.id,
    });
    const l = await linkFor(made.id, b.id, made.clientId);
    await env.DB.prepare(
      "UPDATE documents SET status = 'rejected', decided_at = ?2, decided_contact_id = ?3, decision_reason = 'price' WHERE id = ?1",
    )
      .bind(made.id, Date.now(), b.id)
      .run();
    const refused = await call(`/contacts/${b.id}/erase`, { cookie: s.cookie, body: eraseBody("erase") });
    expect(refused.status).toBe(409);
    expect(await codeOf(refused)).toBe("on_issued_document");
    expect(await countOf("offer_links", "token_hash = ?", l.token)).toBe(1);
    const anon = await call(`/contacts/${b.id}/erase`, { cookie: s.cookie, body: eraseBody("anonymise") });
    expect(anon.status, await anon.clone().text()).toBe(200);
    expect(await countOf("offer_links", "token_hash = ?", l.token)).toBe(0);
    expect(await one<J>("SELECT contact_id, email FROM document_sends WHERE id = ?", sendB)).toEqual({
      contact_id: null,
      email: null,
    });
    // the decision stays on the document
    expect(await one<J>("SELECT status, decision_reason FROM documents WHERE id = ?", made.id)).toEqual({
      status: "rejected",
      decision_reason: "price",
    });
  });

  it("the data export lists the decisions and the sends of the contact, and nobody else's", async () => {
    const { s, made, a, b } = await sentOffer();
    await env.DB.prepare(
      "UPDATE documents SET status = 'rejected', decided_at = ?2, decided_contact_id = ?3, decision_reason = 'timing', decision_note = 'Later' WHERE id = ?1",
    )
      .bind(made.id, Date.now(), a.id)
      .run();
    const o = await owner();
    const first = await json(await call(`/contacts/${a.id}/export`, { cookie: o.cookie, body: {} }));
    expect(first.manifest).toEqual(expect.arrayContaining(["decisions", "document_sends", "acceptances"]));
    const decisions = await json(
      await call(`/contacts/${a.id}/export`, { cookie: o.cookie, body: { part: "decisions" } }),
    );
    expect(decisions.items).toHaveLength(1);
    expect(decisions.items[0]).toMatchObject({
      id: made.id,
      decision_reason: "timing",
      decision_note: "Later",
    });
    const sends = await json(
      await call(`/contacts/${a.id}/export`, { cookie: o.cookie, body: { part: "document_sends" } }),
    );
    expect(sends.items).toHaveLength(1);
    const none = await json(
      await call(`/contacts/${b.id}/export`, { cookie: o.cookie, body: { part: "decisions" } }),
    );
    expect(none.items).toEqual([]);
    expect(s.id).toBeTruthy();
  });
});
