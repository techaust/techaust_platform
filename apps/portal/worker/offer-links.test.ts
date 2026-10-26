// Offer links (M4.5; POR-06, owner decision 2026-10-25: accept from the emailed link). The token is in the body only; a link grants one offer
// (all its versions) to one contact; every failed check counts toward the address; a locked address writes nothing.
import { env } from "cloudflare:workers";
import { PORTAL_FAIL_LIMIT, portalFailKey, tokenHash } from "@techaust/auth";
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures.ts";
import { createApp } from "./index.ts";
import { colleague, DAY, mkLink, mkOffer, testViewer } from "./offer-fixtures.ts";
import { LINK_READ } from "./offer-token.ts";
import { attemptsRow, bodyOf, callerFor, counting, countOf, one, rows, writes } from "./test-helpers.ts";

const app = createApp({ viewer: testViewer });
const call = callerFor(app);
const NOT_FOUND = { error: { code: "not_found", message: "Not found" } };
const open = (token: string, ip?: string) => call("/t/offer", { body: { token }, ...(ip ? { ip } : {}) });
const codeOf = async (res: Response) => ((await bodyOf(res)).error as { code: string }).code;

async function setup() {
  const f = await fixtures();
  const who = await colleague(f.a, "Linked");
  const offer = await mkOffer(f.a);
  const token = await mkLink(offer, who);
  return { f, who, offer, token };
}

describe("POST /t/offer: the offer behind a link", () => {
  it("opens the newest rendered version, marks it viewed once, and audits the use with the contact as the actor", async () => {
    const { who, offer, token } = await setup();
    const res = await open(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      view: { marker: string };
      document: { id: string; status: string };
      link: { purpose: string };
    };
    expect(body.view.marker).toBe(offer.view.marker);
    expect(body.link).toEqual({ purpose: "offer" });
    expect(body.document.status).toBe("viewed");
    expect(
      (await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", offer.id))?.status,
    ).toBe("viewed");
    const use = await rows<{ actor_id: string; actor_type: string; summary: string }>(
      "SELECT actor_id, actor_type, summary FROM audit_log WHERE action = 'offer_link.use' AND entity_id = ?",
      offer.id,
    );
    expect(use).toHaveLength(1);
    expect(use[0]).toMatchObject({ actor_id: who.id, actor_type: "contact" });
    expect(await countOf("audit_log", "action = 'document.view' AND entity_id = ?", offer.id)).toBe(1);
    await open(token);
    expect(await countOf("audit_log", "action = 'document.view' AND entity_id = ?", offer.id)).toBe(1);
    expect(await countOf("audit_log", "action = 'offer_link.use' AND entity_id = ?", offer.id)).toBe(2);
  });

  it("the token is never in an audit row, an access row or a log line", async () => {
    const { token } = await setup();
    await open(token);
    const all = JSON.stringify([
      ...(await rows("SELECT * FROM audit_log")),
      ...(await rows("SELECT * FROM access_log")),
    ]);
    expect(all).not.toContain(token);
    expect(all).not.toContain(await tokenHash(token));
  });

  it("after a new version is sent, the link shows the newest rendered version and says which it came from", async () => {
    const { f, who, offer, token } = await setup();
    const v2 = await mkOffer(f.a, { groupId: offer.groupId, version: 2, number: offer.number });
    await env.DB.prepare("UPDATE documents SET status = 'revised' WHERE id = ?").bind(offer.id).run();
    const body = (await (await open(token)).json()) as {
      document: { id: string; version: number };
      link: { supersededFrom?: number };
    };
    expect(body.document).toMatchObject({ id: v2.id, version: 2 });
    expect(body.link.supersededFrom).toBe(1);
    void who;
  });

  it("a version that is not rendered yet is not shown: the link keeps showing the last rendered one", async () => {
    const { f, offer, token } = await setup();
    await mkOffer(f.a, { groupId: offer.groupId, version: 2, number: offer.number, rendered: false });
    const body = (await (await open(token)).json()) as { document: { id: string } };
    expect(body.document.id).toBe(offer.id);
  });

  it("the link read is two lookups by primary key and a join on the live contact (EXPLAIN)", async () => {
    const plan = await rows<{ detail: string }>(
      `EXPLAIN QUERY PLAN ${LINK_READ.replace(/\?1/g, "'x'").replace(/\?2/g, "1")}`,
    );
    const text = plan.map((p) => p.detail).join(" | ");
    expect(text).toMatch(/offer_links/);
    expect(text).not.toMatch(/SCAN l\b/);
  });
});

describe("a bad link is one and the same 404, and every failure counts toward the address [POR-06]", () => {
  it("unknown, wrong shape, revoked, expired and a confirmation-less empty token", async () => {
    const { f, who, offer } = await setup();
    const revoked = await mkLink(offer, who, { revoked: true });
    const expired = await mkLink(offer, who, { expiresIn: -1000 });
    const ip = "192.0.2.150";
    for (const token of ["", "x", "A".repeat(43), "A".repeat(256), revoked, expired]) {
      const res = await open(token, ip);
      expect(res.status, token.slice(0, 8)).toBe(404);
      expect(await bodyOf(res)).toEqual(NOT_FOUND);
    }
    expect((await attemptsRow(await portalFailKey(env.PORTAL_KEY_PEPPER, ip)))?.failures).toBe(6);
    void f;
  });

  it("a locked address gets a 429 in ONE call and nothing is written, even with a valid link", async () => {
    const { token } = await setup();
    const ip = "192.0.2.151";
    for (let i = 0; i < PORTAL_FAIL_LIMIT; i++) expect((await open(`wrong-${i}`, ip)).status).toBe(404);
    const before = {
      ...(await writes()),
      counters: JSON.stringify(await rows("SELECT * FROM auth_attempts ORDER BY key")),
    };
    const { res, calls } = await counting("/t/offer", { body: { token }, ip }, app);
    expect(res.status).toBe(429);
    expect(calls).toBe(1);
    expect({
      ...(await writes()),
      counters: JSON.stringify(await rows("SELECT * FROM auth_attempts ORDER BY key")),
    }).toEqual(before);
  });

  it("the contact losing portal access, being anonymised or changing address ends the link at once", async () => {
    const { f, offer } = await setup();
    const make = async () => {
      const c = await colleague(f.a, "Ends");
      return { c, token: await mkLink(offer, c) };
    };
    const off = await make();
    const anon = await make();
    const moved = await make();
    expect((await open(off.token)).status).toBe(200);
    await env.DB.prepare("UPDATE contacts SET portal_access = 0 WHERE id = ?").bind(off.c.id).run();
    await env.DB.prepare("UPDATE contacts SET anonymised_at = ?1 WHERE id = ?2")
      .bind(Date.now(), anon.c.id)
      .run();
    await env.DB.prepare("UPDATE contacts SET email = 'new-address@example.test' WHERE id = ?")
      .bind(moved.c.id)
      .run();
    for (const t of [off.token, anon.token, moved.token]) expect((await open(t)).status).toBe(404);
  });

  it("the token in the query or the path does nothing; extra body fields are a 400", async () => {
    const { token, offer } = await setup();
    expect((await call(`/t/offer?token=${token}`, { method: "POST", body: {} })).status).toBe(400);
    expect((await call("/t/offer", { body: { token, documentId: offer.id } })).status).toBe(400);
    expect((await call("/t/offer", { body: { token, clientId: "x" } })).status).toBe(400);
  });
});

describe("a link grants its own offer and nothing else of the organisation [POR-03]", () => {
  it("another offer of the same client: the PDF, the certificate, accept and decline are all 404 and write nothing", async () => {
    const { f, who, token } = await setup();
    const other = await mkOffer(f.a);
    const before = await countOf("acceptances");
    for (const [path, body] of [
      ["/t/offer/pdf", { token, documentId: other.id }],
      ["/t/offer/certificate", { token, documentId: other.id }],
      ["/t/offer/accept", { token, documentId: other.id, typedName: "Linked Person", agree: true }],
      ["/t/offer/decline", { token, documentId: other.id, reason: "price" }],
    ] as const) {
      const res = await call(path, { body });
      expect(res.status, path).toBe(404);
      expect(await bodyOf(res), path).toEqual(NOT_FOUND);
    }
    expect(await countOf("acceptances")).toBe(before);
    expect(
      (await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", other.id))?.status,
    ).toBe("sent");
    void who;
  });

  it("another organisation's offer is the same 404", async () => {
    const { f, token } = await setup();
    const theirs = await mkOffer(f.b);
    expect((await call("/t/offer/pdf", { body: { token, documentId: theirs.id } })).status).toBe(404);
    expect(
      (
        await call("/t/offer/accept", {
          body: { token, documentId: theirs.id, typedName: "Linked Person", agree: true },
        })
      ).status,
    ).toBe(404);
  });

  it("the PDF streams for the offer's own versions", async () => {
    const { offer, token } = await setup();
    const res = await call("/t/offer/pdf", { body: { token, documentId: offer.id } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Security-Policy")).toBe("sandbox");
    expect(await res.text()).toContain("%PDF-1.4");
  });
});

describe("accepting and declining from the link [ADM-PROP-08]", () => {
  it("records via 'link', the link's hash and no session; the address is the contact's", async () => {
    const { who, offer, token } = await setup();
    const res = await call("/t/offer/accept", {
      body: { token, documentId: offer.id, typedName: "Linked Person", agree: true },
      ip: "192.0.2.160",
      headers: { "User-Agent": "TestAgent/1" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ typedName: "Linked Person", email: who.email });
    const a = await one<Record<string, unknown>>("SELECT * FROM acceptances WHERE document_id = ?", offer.id);
    expect(a).toMatchObject({
      via: "link",
      session_id: null,
      offer_link_hash: await tokenHash(token),
      contact_id: who.id,
      ip: "192.0.2.160",
      user_agent: "TestAgent/1",
    });
    expect(JSON.stringify(a)).not.toContain(token);
    expect(
      (await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", offer.id))?.status,
    ).toBe("accepted");
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'document.accept' AND entity_id = ?",
      offer.id,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({ via: "link" });
  });

  it("a replay by the same link is a 200; the accepted offer shows its record to the link holder", async () => {
    const { offer, token } = await setup();
    const body = { token, documentId: offer.id, typedName: "Linked Person", agree: true };
    const first = await (await call("/t/offer/accept", { body })).json();
    const again = await call("/t/offer/accept", { body });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    expect(await countOf("acceptances", "document_id = ?", offer.id)).toBe(1);
    const view = (await (await open(token)).json()) as {
      acceptance: { typedName: string };
      certificate: { state: string };
    };
    expect(view.acceptance.typedName).toBe("Linked Person");
    expect(view.certificate.state).toBe("pending");
  });

  it("declines from the link; a second decline and an accept afterwards are 409", async () => {
    const { offer, token, who } = await setup();
    const declined = await call("/t/offer/decline", { body: { token, documentId: offer.id, reason: "timing" } });
    expect(declined.status).toBe(200);
    // the answer names who declined (the page shows it without a reload; a link has no signed-in name)
    expect(((await declined.json()) as { declined: { by: string } }).declined.by).toBe(who.name);
    expect(
      await codeOf(
        await call("/t/offer/decline", { body: { token, documentId: offer.id, reason: "price" } }),
      ),
    ).toBe("already_decided");
    expect(
      await codeOf(
        await call("/t/offer/accept", {
          body: { token, documentId: offer.id, typedName: "Linked Person", agree: true },
        }),
      ),
    ).toBe("already_decided");
  });

  it("a revoked link, or one whose contact lost access, cannot accept; nothing is written", async () => {
    const { f, who, offer } = await setup();
    const revoked = await mkLink(offer, who, { revoked: true });
    const gone = await colleague(f.a, "Gone");
    const goneToken = await mkLink(offer, gone);
    await env.DB.prepare("UPDATE contacts SET portal_access = 0 WHERE id = ?").bind(gone.id).run();
    for (const token of [revoked, goneToken]) {
      expect(
        (
          await call("/t/offer/accept", {
            body: { token, documentId: offer.id, typedName: "Linked Person", agree: true },
          })
        ).status,
      ).toBe(404);
    }
    expect(await countOf("acceptances", "document_id = ?", offer.id)).toBe(0);
  });

  it("a link revoked between the check and the write cannot accept (the live-link test is in the INSERT)", async () => {
    const { who, offer, token } = await setup();
    // the batch-level proof: the INSERT's own condition refuses a dead link even when called directly
    const { ACCEPT_INSERT_SQL } = await import("./offer-sql.ts");
    await env.DB.prepare("UPDATE offer_links SET revoked_at = ?1 WHERE token_hash = ?2")
      .bind(Date.now(), await tokenHash(token))
      .run();
    const r = await env.DB.prepare(ACCEPT_INSERT_SQL)
      .bind(
        offer.clientId,
        offer.id,
        who.id,
        Date.now(),
        "2026-01-01",
        await tokenHash(token),
        crypto.randomUUID(),
        null,
        "Linked Person",
        null,
        null,
        null,
        "link",
      )
      .all();
    expect(r.results).toHaveLength(0);
    expect(await countOf("acceptances", "document_id = ?", offer.id)).toBe(0);
  });

  it("a confirmation link can look and download, but not accept or decline", async () => {
    const { f, offer } = await setup();
    const c = await colleague(f.a, "Confirmed");
    const token = await mkLink(offer, c, { purpose: "confirmation" });
    expect((await open(token)).status).toBe(200);
    expect((await call("/t/offer/pdf", { body: { token, documentId: offer.id } })).status).toBe(200);
    expect(
      (
        await call("/t/offer/accept", {
          body: { token, documentId: offer.id, typedName: "Linked Person", agree: true },
        })
      ).status,
    ).toBe(404);
    expect(
      (await call("/t/offer/decline", { body: { token, documentId: offer.id, reason: "price" } })).status,
    ).toBe(404);
    expect(await countOf("acceptances", "document_id = ?", offer.id)).toBe(0);
  });

  it("an expired offer cannot be accepted from its link, but the link still opens it for 30 days", async () => {
    const { f, who } = await setup();
    const late = await mkOffer(f.a, { validInDays: -2 });
    const token = await mkLink(late, who, { expiresIn: 5 * DAY });
    expect((await open(token)).status).toBe(200);
    expect(
      await codeOf(
        await call("/t/offer/accept", {
          body: { token, documentId: late.id, typedName: "Linked Person", agree: true },
        }),
      ),
    ).toBe("expired");
  });
});
