// The early-check fixes of M4.5 in the portal [POR-04, POR-05, ADM-PROP-08, ADM-PROP-10, ADM-LEAD-02]: a decline moves the lead to lost (M4),
// a lost race on the acceptance's unique rule is a clean answer (L4), the list and the downloads follow the latest RENDERED version (L5, L8),
// and an expired offer is not marked viewed (L9). Failure paths first.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures.ts";
import { createApp } from "./index.ts";
import { colleague, mkLink, mkOffer, testViewer } from "./offer-fixtures.ts";
import { bodyOf, callerFor, countOf, one, rows, sessionFor, withEnv } from "./test-helpers.ts";

const app = createApp({ viewer: testViewer });
const call = callerFor(app);
const sign = async (c: Awaited<ReturnType<typeof fixtures>>["a"]["finance"]) => (await sessionFor(c)).cookie;
const decline = (id: string, cookie: string, body: unknown, e: Env = env) =>
  call(`/offers/${id}/decline`, { body, cookie }, e);
const accept = (id: string, cookie: string, e: Env = env) =>
  call(`/offers/${id}/accept`, { body: { typedName: "Asha Rao", agree: true }, cookie }, e);

let seq = 0;
/** A lead linked to the proposal group, at `stage` (a lost lead carries a reason, as the table's CHECK demands). */
async function leadFor(groupId: string, clientId: string, stage: string) {
  const id = crypto.randomUUID();
  const n = ++seq;
  await env.DB.prepare(
    "INSERT INTO leads (id, ref, source, contact_name, contact_email, stage, lost_reason, proposal_id, client_id) VALUES (?1, ?2, 'manual', 'Pat', ?3, ?4, ?5, ?6, ?7)",
  )
    .bind(
      id,
      `LF-${n}-${id.slice(-4).toUpperCase()}`,
      `${id}@example.test`,
      stage,
      stage === "lost" ? "price" : null,
      groupId,
      clientId,
    )
    .run();
  return id;
}
const leadOf = (id: string) =>
  one<{ stage: string; lost_reason: string | null }>("SELECT stage, lost_reason FROM leads WHERE id = ?", id);

describe("a decline moves the lead to lost (M4, owner decision 2026-10-26) [ADM-LEAD-02, ADM-PROP-10]", () => {
  it("proposal_sent becomes lost with the mapped reason, and the timeline says why; a refused decline moves nothing", async () => {
    const f = await fixtures();
    const cookie = await sign(f.a.finance);
    const refused = await mkOffer(f.a, { validInDays: -3 });
    const stuck = await leadFor(refused.groupId, f.a.id, "proposal_sent");
    expect((await decline(refused.id, cookie, { reason: "price" })).status).toBe(409); // expired
    expect(await leadOf(stuck)).toEqual({ stage: "proposal_sent", lost_reason: null });

    const reasons: [string, string][] = [
      ["price", "price"],
      ["timing", "timing"],
      ["other_option", "competitor"],
      ["not_needed", "scope_fit"],
    ];
    for (const [reason, lost] of reasons) {
      const o = await mkOffer(f.a);
      const lead = await leadFor(o.groupId, f.a.id, "proposal_sent");
      expect((await decline(o.id, cookie, { reason })).status, reason).toBe(200);
      expect(await leadOf(lead), reason).toEqual({ stage: "lost", lost_reason: lost });
    }
    const o = await mkOffer(f.a);
    const lead = await leadFor(o.groupId, f.a.id, "proposal_sent");
    expect((await decline(o.id, cookie, { reason: "other", note: "Not now" })).status).toBe(200);
    expect(await leadOf(lead)).toEqual({ stage: "lost", lost_reason: "other" });
    const timeline = await rows<{ kind: string; body: string; actor_id: string | null }>(
      "SELECT kind, body, actor_id FROM lead_activities WHERE lead_id = ?",
      lead,
    );
    expect(timeline).toEqual([
      { kind: "stage", body: "Stage set to lost (proposal declined)", actor_id: null },
    ]);
  });

  it("a won, qualified, new or already lost lead is left alone (only a lead waiting on the proposal moves)", async () => {
    const f = await fixtures();
    const cookie = await sign(f.a.finance);
    for (const stage of ["won", "qualified", "new", "lost"]) {
      const o = await mkOffer(f.a);
      const lead = await leadFor(o.groupId, f.a.id, stage);
      expect((await decline(o.id, cookie, { reason: "timing" })).status, stage).toBe(200);
      expect(await leadOf(lead), stage).toEqual({
        stage,
        lost_reason: stage === "lost" ? "price" : null,
      });
      expect(await countOf("lead_activities", "lead_id = ?", lead), stage).toBe(0);
    }
  });

  it("it works the same on a link, and a second decline or an accept after it changes nothing more", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a, { contactId: f.a.finance.id });
    const lead = await leadFor(o.groupId, f.a.id, "proposal_sent");
    const token = await mkLink(o, f.a.finance);
    const res = await call("/t/offer/decline", { body: { token, documentId: o.id, reason: "price" } });
    expect(res.status).toBe(200);
    expect(await leadOf(lead)).toEqual({ stage: "lost", lost_reason: "price" });
    // Staff move it back by hand; a repeated decline (refused) must not send it to lost again.
    await env.DB.prepare("UPDATE leads SET stage = 'proposal_sent', lost_reason = NULL WHERE id = ?")
      .bind(lead)
      .run();
    const again = await decline(o.id, await sign(f.a.finance), { reason: "price" });
    expect(again.status).toBe(409);
    expect(await leadOf(lead)).toEqual({ stage: "proposal_sent", lost_reason: null });
  });
});

describe("an acceptance that loses the unique rule is a clean answer (L4) [ADM-PROP-08]", () => {
  /** The database for one call: right before the accept's batch, another contact's acceptance for the same document appears. */
  function racing(documentId: string, otherContact: string, email: string) {
    return withEnv(env, {
      DB: {
        prepare: (sql: string) => env.DB.prepare(sql),
        batch: async (stmts: D1PreparedStatement[]) => {
          await env.DB.prepare(
            "INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, pdf_sha256, via) SELECT ?1, d.id, ?3, 'Winner Name', ?4, ?5, d.pdf_sha256, 'session' FROM documents d WHERE d.id = ?2",
          )
            .bind(crypto.randomUUID(), documentId, otherContact, email, Date.now())
            .run();
          return env.DB.batch(stmts);
        },
      },
    });
  }

  it("another contact's acceptance arrived first: 409 already_accepted with their name, nothing half-written", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const other = await colleague(f.a, "First");
    const res = await accept(o.id, await sign(f.a.finance), racing(o.id, other.id, other.email));
    expect(res.status).toBe(409);
    const body = (await bodyOf(res)) as { error: { code: string }; name?: string };
    expect(body.error.code).toBe("already_accepted");
    expect(body.name).toBe("Winner Name");
    expect(await countOf("acceptances", "document_id = ?", o.id)).toBe(1);
    expect(await countOf("audit_log", "action = 'document.accept' AND entity_id = ?", o.id)).toBe(0);
    expect((await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", o.id))?.status).toBe(
      "sent",
    );
  });

  it("the same contact's acceptance arrived first (a double click): a 200 replay of the stored record", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const res = await accept(o.id, await sign(f.a.finance), racing(o.id, f.a.finance.id, f.a.finance.email));
    expect(res.status).toBe(200);
    expect(await countOf("acceptances", "document_id = ?", o.id)).toBe(1);
  });
});

describe("the list and the downloads follow the latest RENDERED version (L5, L8) [POR-04, POR-05]", () => {
  it("while the next version is still being rendered the offer stays listed on its latest rendered version", async () => {
    const f = await fixtures();
    const cookie = await sign(f.a.finance);
    const v1 = await mkOffer(f.a, { status: "revised", title: "Keeps showing" });
    const v2 = await mkOffer(f.a, { groupId: v1.groupId, version: 2, number: v1.number, rendered: false });
    const ids = async () =>
      ((await (await call("/offers", { cookie })).json()) as { offers: { id: string; status: string }[] })
        .offers;
    expect((await ids()).find((x) => x.id === v1.id)).toMatchObject({ status: "revised" });
    expect((await ids()).map((x) => x.id)).not.toContain(v2.id);
  });

  it("an old, revised version's PDF is a 404 once the newer one is rendered; the latest and an accepted one download", async () => {
    const f = await fixtures();
    const cookie = await sign(f.a.finance);
    const v1 = await mkOffer(f.a, { status: "revised" });
    const v2 = await mkOffer(f.a, { groupId: v1.groupId, version: 2, number: v1.number });
    expect((await call(`/offers/${v1.id}/pdf`, { cookie })).status).toBe(404);
    expect((await call(`/offers/${v2.id}/pdf`, { cookie })).status).toBe(200);
    const done = await mkOffer(f.a, { status: "accepted" });
    expect((await call(`/offers/${done.id}/pdf`, { cookie })).status).toBe(200);
  });

  it("while the newer version is not rendered the old one is still downloadable", async () => {
    const f = await fixtures();
    const cookie = await sign(f.a.finance);
    const v1 = await mkOffer(f.a, { status: "revised" });
    await mkOffer(f.a, { groupId: v1.groupId, version: 2, number: v1.number, rendered: false });
    expect((await call(`/offers/${v1.id}/pdf`, { cookie })).status).toBe(200);
  });
});

describe("an expired offer is not marked viewed (L9) [POR-05]", () => {
  it("a sent offer past its last valid day reads as expired on a view and stays sent, with no view audit row", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a, { validInDays: -2 });
    const res = await call(`/offers/${o.id}`, { cookie: await sign(f.a.finance) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { document: { status: string } }).document.status).toBe("expired");
    expect(
      await one<{ status: string; viewed_at: number | null }>(
        "SELECT status, viewed_at FROM documents WHERE id = ?",
        o.id,
      ),
    ).toEqual({ status: "sent", viewed_at: null });
    expect(await countOf("audit_log", "action = 'document.view' AND entity_id = ?", o.id)).toBe(0);
  });

  it("the last valid day itself is still a first view", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a, { validInDays: 0 });
    await call(`/offers/${o.id}`, { cookie: await sign(f.a.finance) });
    expect((await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", o.id))?.status).toBe(
      "viewed",
    );
  });
});
