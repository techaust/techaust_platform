// The early-check fixes of M4.5 on the admin Worker [ADM-PROP-07, ADM-PROP-09, ADM-PROP-10, ADM-LEAD-02, ADM-CLI-05]: "Revoke links" stops waiting and
// queued sends (M1), the lead's page carries the client's decision (M4), a send that never goes out reads "not sent" (L7), the export lists the offer
// links without their token hash (L10), and a refused first instalment names the empty client field (L11). Failure paths first.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { beforeAll, describe, expect, it } from "vitest";
import { deliveryState } from "./document-offer.ts";
import { putPaymentTerms } from "./test-catalogue.ts";
import { insert, mkContact } from "./test-clients.ts";
import { call, countOf, one, sessionFor } from "./test-helpers.ts";
import { codeOf, getDoc, type J, json, mkDraft, mkTerms } from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
});

const send = (cookie: string, id: string, body: unknown) => call(`/documents/${id}/send`, { cookie, body });
const revoke = (cookie: string, id: string) => call(`/documents/${id}/links/revoke`, { cookie, body: {} });

/** A sent proposal with one recipient who has portal access (its send row waits for the PDF). */
async function sentOffer() {
  const s = await owner();
  const made = await mkDraft(s);
  const v = await getDoc(s, made.id);
  const a = await mkContact(made.clientId, { portal_access: 1, name: "Asha Rao" });
  const res = await send(s.cookie, made.id, { expectedUpdatedAt: v.updatedAt, contactIds: [a.id] });
  expect(res.status, await res.clone().text()).toBe(200);
  const sendId = (await one<{ id: string }>("SELECT id FROM document_sends WHERE document_id = ?", made.id))
    ?.id as string;
  return { s, made, a, sendId };
}
const cancelledAt = async (sendId: string) =>
  (await one<{ cancelled_at: number | null }>("SELECT cancelled_at FROM document_sends WHERE id = ?", sendId))
    ?.cancelled_at;
const link = (docId: string, clientId: string, contactId: string, sendId: string | null) =>
  env.DB.prepare(
    "INSERT INTO offer_links (token_hash, send_id, document_id, version_group_id, client_id, contact_id, email, purpose, expires_at) VALUES (?1, ?2, ?3, ?3, ?4, ?5, 'x@example.test', 'offer', ?6)",
  )
    .bind(`h-${uuidv7()}`, sendId, docId, clientId, contactId, Date.now() + 86_400_000)
    .run();

describe("POST /documents/:id/links/revoke stops the sends that have no link yet (M1) [ADM-PROP-07]", () => {
  it("revoke BEFORE the PDF: the waiting send is cancelled, so the render step and the sweep skip it", async () => {
    const { s, made, sendId } = await sentOffer();
    expect(await cancelledAt(sendId)).toBeNull();
    const res = await revoke(s.cookie, made.id);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, revoked: 0, cancelled: 1 });
    expect(await cancelledAt(sendId)).toBeGreaterThan(0);
    // The row the jobs Worker looks for is no longer a candidate.
    expect(
      await countOf(
        "document_sends",
        "id = ? AND queued_at IS NULL AND cancelled_at IS NULL AND contact_id IS NOT NULL",
        sendId,
      ),
    ).toBe(0);
    expect(await countOf("audit_log", "action = 'document.links_revoke' AND entity_id = ?", made.id)).toBe(1);
  });

  it("revoke AFTER the message was queued but before it was processed (no link yet): cancelled as well", async () => {
    const { s, made, sendId } = await sentOffer();
    await env.DB.prepare("UPDATE document_sends SET queued_at = ? WHERE id = ?")
      .bind(Date.now(), sendId)
      .run();
    const res = await revoke(s.cookie, made.id);
    expect(await json(res)).toMatchObject({ cancelled: 1 });
    expect(await cancelledAt(sendId)).toBeGreaterThan(0);
  });

  it("a send that already has its link is not cancelled (it went out); the link is revoked", async () => {
    const { s, made, a, sendId } = await sentOffer();
    await env.DB.prepare("UPDATE document_sends SET queued_at = ? WHERE id = ?")
      .bind(Date.now(), sendId)
      .run();
    await link(made.id, made.clientId, a.id, sendId);
    const res = await revoke(s.cookie, made.id);
    expect(await json(res)).toMatchObject({ revoked: 1, cancelled: 0 });
    expect(await cancelledAt(sendId)).toBeNull();
    expect(await countOf("offer_links", "send_id = ? AND revoked_at IS NOT NULL", sendId)).toBe(1);
  });

  it("another offer's sends are untouched, and a second revoke cancels nothing more", async () => {
    const one1 = await sentOffer();
    const two = await sentOffer();
    await revoke(one1.s.cookie, one1.made.id);
    expect(await cancelledAt(two.sendId)).toBeNull();
    expect(await json(await revoke(one1.s.cookie, one1.made.id))).toMatchObject({ revoked: 0, cancelled: 0 });
  });

  it("a draft or an unknown document is still a 404 and writes nothing", async () => {
    const s = await owner();
    const draft = await mkDraft(s);
    expect((await revoke(s.cookie, draft.id)).status).toBe(404);
    expect(await countOf("audit_log", "action = 'document.links_revoke' AND entity_id = ?", draft.id)).toBe(
      0,
    );
  });
});

describe("a send that never goes out reads 'not sent' (L7) [ADM-PROP-07]", () => {
  it("the state is pure: cancelled without an email is not_sent; an email's own status wins; waiting and queued are unchanged", () => {
    expect(deliveryState(null, null, null)).toBe("waiting_pdf");
    expect(deliveryState(5, null, null)).toBe("queued");
    expect(deliveryState(5, null, 9)).toBe("not_sent");
    expect(deliveryState(null, null, 9)).toBe("not_sent");
    expect(deliveryState(5, "sent", 9)).toBe("sent");
  });

  it("the document page shows it", async () => {
    const { s, made, sendId } = await sentOffer();
    await revoke(s.cookie, made.id);
    const page = await getDoc(s, made.id);
    expect(page.delivery.find((d: J) => d.id === sendId)?.state).toBe("not_sent");
  });
});

describe("GET /leads/:id carries the client's decision (M4) [ADM-LEAD-02, ADM-PROP-10]", () => {
  it("null until the client answers; then status, reason, note, time and the contact's name", async () => {
    const { s, made, a } = await sentOffer();
    const lead = await mkLeadFor(made.id, made.clientId);
    const before = await json(await call(`/leads/${lead}`, { cookie: s.cookie }));
    expect(before.decision).toBeNull();
    await env.DB.prepare(
      "UPDATE documents SET status = 'rejected', decided_at = ?2, decision_reason = 'price', decision_note = 'Too dear', decided_contact_id = ?3 WHERE id = ?1",
    )
      .bind(made.id, 1_800_000_000_000, a.id)
      .run();
    const after = await json(await call(`/leads/${lead}`, { cookie: s.cookie }));
    expect(after.decision).toEqual({
      status: "rejected",
      at: 1_800_000_000_000,
      reason: "price",
      note: "Too dear",
      contactName: "Asha Rao",
    });
    // The rest of the response is as before (additive).
    expect(after.lead.id).toBe(lead);
    expect(after.proposal).toMatchObject({ id: made.id });
  });

  it("a lead without a proposal has no decision", async () => {
    const s = await owner();
    const plain = await mkLeadFor(null, null);
    expect((await json(await call(`/leads/${plain}`, { cookie: s.cookie }))).decision).toBeNull();
  });
});

async function mkLeadFor(proposalId: string | null, clientId: string | null) {
  const id = uuidv7();
  await insert("leads", {
    id,
    ref: `LX-${id.slice(-6).toUpperCase()}`,
    source: "manual",
    contact_name: "Pat",
    contact_email: `${id}@example.test`,
    stage: "proposal_sent",
    proposal_id: proposalId,
    client_id: clientId,
  });
  return id;
}

describe("the export lists the offer links without their token hash (L10) [ADM-CLI-05]", () => {
  it("part offer_links: purpose, dates, revoked; never the hash; paged by rowid", async () => {
    const { made, a, sendId } = await sentOffer();
    await link(made.id, made.clientId, a.id, sendId);
    await link(made.id, made.clientId, a.id, null);
    const o = await owner();
    const first = await json(await call(`/contacts/${a.id}/export`, { cookie: o.cookie, body: {} }));
    expect(first.manifest).toContain("offer_links");
    const page = await json(
      await call(`/contacts/${a.id}/export`, { cookie: o.cookie, body: { part: "offer_links" } }),
    );
    expect(page.items).toHaveLength(2);
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(
        [
          "acceptance_id",
          "created_at",
          "document_id",
          "expires_at",
          "id",
          "purpose",
          "revoked_at",
          "send_id",
        ].sort(),
      );
      expect(JSON.stringify(item)).not.toContain("h-");
    }
    expect(page.next).toBeNull();
    // Another person's links are not in it.
    const other = await mkContact(made.clientId, { portal_access: 1 });
    const none = await json(
      await call(`/contacts/${other.id}/export`, { cookie: o.cookie, body: { part: "offer_links" } }),
    );
    expect(none.items).toEqual([]);
  });

  it("an unknown part is still a 400", async () => {
    const { a } = await sentOffer();
    const o = await owner();
    expect(
      (await call(`/contacts/${a.id}/export`, { cookie: o.cookie, body: { part: "tokens" } })).status,
    ).toBe(400);
  });
});

describe("a refused first instalment names the client field it lacks (L11) [ADM-PROP-09]", () => {
  it("a client whose country no longer fits its GST status: 409 instalment_failed, 'missing: country', the message says so, and nothing is created", async () => {
    const s = await owner();
    const made = await mkDraft(s, { type: "proposal", price: 250_000 });
    const v = await getDoc(s, made.id);
    const a = await mkContact(made.clientId, { portal_access: 1 });
    expect(
      (await send(s.cookie, made.id, { expectedUpdatedAt: v.updatedAt, contactIds: [a.id] })).status,
    ).toBe(200);
    await env.DB.prepare(
      "UPDATE documents SET status = 'accepted', decided_at = ?2, decided_contact_id = ?3 WHERE id = ?1",
    )
      .bind(made.id, Date.now(), a.id)
      .run();
    // The state rules are backed by a trigger; the country is not, so it is the way a record drifts out of line with its GST status.
    await env.DB.prepare("UPDATE clients SET country = 'US' WHERE id = ?").bind(made.clientId).run();
    const res = await call(`/documents/${made.id}/start-project`, { cookie: s.cookie, body: {} });
    expect(res.status).toBe(409);
    const body = (await res.clone().json()) as {
      error: { code: string; message: string };
      missing: string[];
    };
    expect(await codeOf(res)).toBe("instalment_failed");
    expect(body.missing).toEqual(["country"]);
    expect(body.error.message).toContain("check the client's country");
    expect(await countOf("projects", "source_document_id = ?", made.id)).toBe(0);
    expect(await countOf("documents", "source_document_id = ?", made.id)).toBe(0);
    // The document page carries the same facts for the dialog.
    const page = await getDoc(s, made.id);
    expect(page.startProject).toMatchObject({ reason: "instalment_failed", missing: ["country"] });
  });
});
