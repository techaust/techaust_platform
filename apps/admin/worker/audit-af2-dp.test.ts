// Full audit M6–M7, fix round AF2, data protection through the admin API [run file docs/runs/full-audit-m6-m7.md AU23–AU26; ADM-CLI-05, ADM-SET-09, FRM-05;
// Researched 2026-10-29, DPDP s.11(1) (08-C RB-36); RA-25 legal hold]: a held client's note or file delete is 409 `legal_hold` (never the trigger's 500);
// the lead export carries the processors and the lead's own requests; a lead whose address a contact's hold protects is not erased; a done access request's
// export date is never before it arrived; a done consent withdrawal names its own withdrawal. Failure paths first. Invented test data.
import { env } from "cloudflare:workers";
import { requestDueAtSql } from "@techaust/core/dsr";
import { uuidv7 } from "@techaust/core/ids";
import { PROCESSORS } from "@techaust/core/processors";
import { describe, expect, it } from "vitest";
import { insert, mkClient, mkContact, mkLead } from "./test-clients.ts";
import { bodyOf, call, countOf, one, sessionFor } from "./test-helpers.ts";
import { mkPortalClient, mkRequest } from "./test-portal.ts";

const owner = () => sessionFor("owner", { stepUp: true });
const code = async (res: Response) => ((await bodyOf(res)).error as { code: string } | undefined)?.code;
const S1 =
  "Legal hold is on. Nothing about this record can be erased, anonymised or deleted until the hold is lifted.";
const holdOn = async (by: string, entityType: string, entityId: string) =>
  insert("legal_holds", {
    id: uuidv7(),
    entity_type: entityType,
    entity_id: entityId,
    action: "set",
    reason: "GST notice",
    by,
  });
const holdOff = async (by: string, entityType: string, entityId: string) =>
  insert("legal_holds", {
    id: uuidv7(),
    entity_type: entityType,
    entity_id: entityId,
    action: "clear",
    reason: "Done",
    by,
  });

describe("AU23: a held client's notes and files", () => {
  it("a note or file delete under a legal hold is 409 legal_hold in the S1 words, nothing deleted, no audit row; after the hold, it goes", async () => {
    const o = await owner();
    const client = await mkClient();
    const note = uuidv7();
    await insert("notes", { id: note, client_id: client, body_md: "Call notes", author_id: o.id });
    const file = uuidv7();
    await insert("files", {
      id: file,
      client_id: client,
      r2_key: `files/${file}`,
      filename: "a.pdf",
      mime: "application/pdf",
      size: 1,
      sha256: "a".repeat(64),
    });
    await holdOn(o.id, "client", client);
    for (const [path, table, id] of [
      [`/notes/${note}`, "notes", note],
      [`/files/${file}`, "files", file],
    ] as const) {
      const res = await call(path, { method: "DELETE", cookie: o.cookie });
      expect(res.status, path).toBe(409);
      expect((await bodyOf(res)).error).toEqual({ code: "legal_hold", message: S1 });
      expect(await countOf(table, "id = ?", id)).toBe(1);
    }
    expect(
      await countOf(
        "audit_log",
        "action IN ('note.delete', 'file.delete') AND entity_id IN (?, ?)",
        note,
        file,
      ),
    ).toBe(0);
    // the project page says so (the screens hide Delete)
    await holdOff(o.id, "client", client);
    expect((await call(`/notes/${note}`, { method: "DELETE", cookie: o.cookie })).status).toBe(200);
    expect(await countOf("notes", "id = ?", note)).toBe(0);
    // an unknown note is still the 404
    expect((await call(`/notes/${uuidv7()}`, { method: "DELETE", cookie: o.cookie })).status).toBe(404);
  });

  it("the project page carries the client's legal hold", async () => {
    const o = await owner();
    const client = await mkClient();
    const project = uuidv7();
    await insert("projects", {
      id: project,
      code: `PRJ-AF2-${project.slice(-6)}`,
      client_id: client,
      name: "Site",
      currency: "INR",
    });
    const page = async () =>
      (await bodyOf(await call(`/projects/${project}`, { cookie: o.cookie }))) as {
        clientLegalHold: boolean;
      };
    expect((await page()).clientLegalHold).toBe(false);
    await holdOn(o.id, "client", client);
    expect((await page()).clientLegalHold).toBe(true);
  });
});

describe("AU24: the lead export", () => {
  it("the summary names the processors; the lead's own requests are a part, paged, never another lead's", async () => {
    const o = await owner();
    const email = `af2-ex-${uuidv7()}@example.test`;
    const lead = await mkLead(email);
    const other = await mkLead(`af2-ot-${uuidv7()}@example.test`);
    const reqOf = async (leadId: string, kind: string) => {
      const rid = uuidv7();
      await env.DB.prepare(
        `INSERT INTO client_requests (id, lead_id, lead_ref, kind, details, created_at, updated_at, received_at, due_at, ack_due_at, channel, logged_by)
         VALUES (?1, ?2, ?2, ?3, 'Their words', ?4, ?4, ?4, ${requestDueAtSql("?4")}, ?4 + 172800000, 'email', ?5)`,
      )
        .bind(rid, leadId, kind, Date.now(), o.id)
        .run();
      return rid;
    };
    const mine = await reqOf(lead, "data_access");
    await reqOf(other, "data_access");
    const summary = (await bodyOf(await call(`/leads/${lead}/export`, { cookie: o.cookie, body: {} }))) as {
      processors: { processors: unknown[] };
      manifest: string[];
    };
    expect(summary.manifest).toContain("client_requests");
    expect(JSON.stringify(summary.processors)).toContain(PROCESSORS[0]?.[0] ?? "none");
    const part = (await bodyOf(
      await call(`/leads/${lead}/export`, { cookie: o.cookie, body: { part: "client_requests" } }),
    )) as { items: { id: string; details: string }[]; next: string | null };
    expect(part.items.map((x) => x.id)).toEqual([mine]);
    expect(part.items[0]?.details).toBe("Their words");
    expect(part.next).toBeNull();
  });
});

describe("AU25 L1: a lead whose address a hold protects", () => {
  it("is not erased while a contact with its address (or that contact's client) is held: 409 legal_hold, nothing written; after the hold, it is", async () => {
    const o = await owner();
    const client = await mkClient();
    const email = `af2-held-${uuidv7()}@example.test`;
    const contact = await mkContact(client, { email });
    const lead = await mkLead(email.toUpperCase());
    await holdOn(o.id, "contact", contact.id);
    const erase = () => call(`/leads/${lead}/erase`, { cookie: o.cookie, body: { reason: "requested" } });
    expect(await code(await erase())).toBe("legal_hold");
    expect(await countOf("leads", "id = ?", lead)).toBe(1);
    expect(await countOf("audit_log", "action = 'lead.erase' AND entity_id = ?", lead)).toBe(0);
    await holdOff(o.id, "contact", contact.id);
    await holdOn(o.id, "client", client);
    expect(await code(await erase())).toBe("legal_hold");
    await holdOff(o.id, "client", client);
    expect((await erase()).status).toBe(200);
    expect(await countOf("leads", "id = ?", lead)).toBe(0);
  });
});

describe("AU25 L3 and AU26: a request's close", () => {
  const close = (cookie: string, rid: string, b: Record<string, unknown>) =>
    call(`/client-requests/${rid}/close`, { cookie, body: b });

  it("L3: a done access request's export date before the IST day it arrived is 409 export_before_received; the same day is stored as its arrival", async () => {
    const o = await owner();
    const p = await mkPortalClient();
    const rid = await mkRequest(p, "data_access");
    const arrived = (
      await one<{ received_at: number }>("SELECT received_at FROM client_requests WHERE id = ?", rid)
    )?.received_at as number;
    const early = await close(o.cookie, rid, { outcome: "done", exportSentAt: arrived - 2 * 86_400_000 });
    expect(early.status).toBe(409);
    expect(await code(early)).toBe("export_before_received");
    expect(await one("SELECT status FROM client_requests WHERE id = ?", rid)).toEqual({ status: "open" });
    // the start of the same IST day (what the screen sends for "today") is taken and stored no earlier than the arrival
    const dayStart = Math.floor((arrived + 19_800_000) / 86_400_000) * 86_400_000 - 19_800_000;
    expect((await close(o.cookie, rid, { outcome: "done", exportSentAt: dayStart })).status).toBe(200);
    expect(await one("SELECT export_sent_at FROM client_requests WHERE id = ?", rid)).toEqual({
      export_sent_at: arrived,
    });
  });

  it("AU26: done without a withdrawal is 409 withdrawal_required; another contact's consent change is refused; its own (with the withdraw receipt) closes it", async () => {
    const o = await owner();
    const p = await mkPortalClient();
    const rid = await mkRequest(p, "consent_withdrawal");
    expect(await code(await close(o.cookie, rid, { outcome: "done" }))).toBe("withdrawal_required");
    const audit = async (contactId: string, changed: string[]) => {
      const aid = uuidv7();
      await insert("audit_log", {
        id: aid,
        at: Date.now() + 1_000,
        actor_type: "staff",
        actor_id: o.id,
        role: "owner",
        action: "contact.update",
        entity_type: "client",
        entity_id: p.clientId,
        summary: JSON.stringify({ contactId, changed }),
      });
      return aid;
    };
    const otherContact = await mkContact(p.clientId);
    const notMine = await audit(otherContact.id, ["marketingConsent"]);
    const res = await close(o.cookie, rid, { outcome: "done", actionAuditId: notMine });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("withdrawal_required");
    const mine = await audit(p.contactId, ["marketingConsent"]);
    // the change alone, without the withdraw receipt, is not proof
    expect(await code(await close(o.cookie, rid, { outcome: "done", actionAuditId: mine }))).toBe(
      "withdrawal_required",
    );
    await insert("consent_receipts", {
      id: uuidv7(),
      contact_id: p.contactId,
      event: "withdraw",
      source: "staff",
      purposes: '["marketing_updates"]',
      marketing: 0,
      at: Date.now() + 1_000,
    });
    expect((await close(o.cookie, rid, { outcome: "done", actionAuditId: mine })).status).toBe(200);
    expect(await one("SELECT outcome, action_audit_id FROM client_requests WHERE id = ?", rid)).toEqual({
      outcome: "done",
      action_audit_id: mine,
    });
    // declined with a reason is always open to the Owner
    const rid2 = await mkRequest(await mkPortalClient(), "consent_withdrawal");
    expect((await close(o.cookie, rid2, { outcome: "declined", declineReason: "other" })).status).toBe(200);
  });
});
