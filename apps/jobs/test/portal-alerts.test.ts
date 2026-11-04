// M7.1 (run file D, L9, L16): a portal request or "I've paid" notice becomes staff bells through jobs, one unit of work, idempotent per audit row, no email.
// A request rings the active Owners (and the active Staff for a contact change); a notice rings the active Owners and Staff; a row that is not a contact's portal
// request or notice is refused. Invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it, vi } from "vitest";
import { processPortalAlert } from "../src/portal-alerts.ts";
import { handleQueue } from "../src/queue.ts";

const run = (sql: string, ...p: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...p)
    .run();
const bellsOf = async (entityId: string) =>
  (
    await env.DB.prepare(
      "SELECT n.user_id, n.kind, n.entity_type, n.title, n.link FROM notifications n WHERE n.entity_id = ?1 ORDER BY n.user_id",
    )
      .bind(entityId)
      .all<{ user_id: string; kind: string; entity_type: string; title: string; link: string }>()
  ).results;

async function member(role: string, status = "active") {
  const id = uuidv7();
  await run(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, 'Member', ?3, ?4)",
    id,
    `${id}@example.test`,
    role,
    status,
  );
  return id;
}

let seq = 0;
async function world() {
  const client = uuidv7();
  const code = `CL-PA${++seq}`;
  await run(
    "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES (?1, ?2, 'Pal Pvt Ltd', 'Pal Studio', 'business', 'IN', 'unregistered', '19', 'INR')",
    client,
    code,
  );
  const contact = uuidv7();
  await run(
    "INSERT INTO contacts (id, client_id, name, email, portal_access, can_see_finance) VALUES (?1, ?2, 'Asha Rao', ?3, 1, 1)",
    contact,
    client,
    `${contact}@example.test`,
  );
  return { client, contact };
}

async function audit(
  action: string,
  entityType: string,
  entityId: string,
  actorType = "contact",
  actor = "c",
) {
  const id = uuidv7();
  await run(
    "INSERT INTO audit_log (id, actor_type, actor_id, role, action, entity_type, entity_id) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)",
    id,
    actorType,
    actor,
    action,
    entityType,
    entityId,
  );
  return id;
}

async function request(kind: string) {
  const w = await world();
  const id = uuidv7();
  await run(
    "INSERT INTO client_requests (id, client_id, contact_id, contact_ref, kind, details) VALUES (?1, ?2, ?3, ?3, ?4, 'Words')",
    id,
    w.client,
    w.contact,
    kind,
  );
  return { ...w, id, auditId: await audit("portal.request", "client_request", id, "contact", w.contact) };
}

describe("portal.alert [L9]", () => {
  it("a data request rings every active Owner once, never Staff, a deactivated Owner or another role; a redelivery writes nothing new", async () => {
    const owner = await member("owner");
    const staff = await member("staff");
    const gone = await member("owner", "deactivated");
    const accountant = await member("accountant");
    const r = await request("data_erasure");
    expect(await processPortalAlert(env, { kind: "portal.alert", auditId: r.auditId })).toBe("belled");
    const bells = await bellsOf(r.id);
    const users = bells.map((b) => b.user_id);
    expect(users).toContain(owner);
    for (const u of [staff, gone, accountant]) expect(users).not.toContain(u);
    expect(bells.find((b) => b.user_id === owner)).toEqual({
      user_id: owner,
      kind: "portal.request",
      entity_type: "client_request",
      title: "Asha Rao at Pal Studio sent a request: erasure of their personal data",
      link: `/clients/${r.client}?tab=requests`,
    });
    const count = bells.length;
    expect(await processPortalAlert(env, { kind: "portal.alert", auditId: r.auditId })).toBe("belled");
    expect(await bellsOf(r.id)).toHaveLength(count);
  });

  it("a contact change rings Staff too; a notice rings Owners and Staff with the amount and the number", async () => {
    const owner = await member("owner");
    const staff = await member("staff");
    const r = await request("contact_change");
    await processPortalAlert(env, { kind: "portal.alert", auditId: r.auditId });
    expect((await bellsOf(r.id)).map((b) => b.user_id)).toEqual(expect.arrayContaining([owner, staff]));

    const w = await world();
    const doc = uuidv7();
    await run(
      "INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, subtotal_minor, taxable_minor, total_minor, balance_minor) VALUES (?1, 'tax_invoice', 'issued', ?2, 'INR', 'pa', '2627', ?3, 'TH/INV/2627/0042', 1000, '2026-11-01', 100000, 100000, 118000, 118000)",
      doc,
      w.client,
      ++seq + 4000,
    );
    const nid = uuidv7();
    await run(
      "INSERT INTO payment_notices (id, client_id, document_id, contact_id, via, amount_minor, currency, paid_on, reference, reference_norm) VALUES (?1, ?2, ?3, ?4, 'portal', 1180000, 'INR', '2026-11-04', 'UTR1', 'UTR1')",
      nid,
      w.client,
      doc,
      w.contact,
    );
    const auditId = await audit("payment.notice", "payment_notice", nid, "contact", w.contact);
    expect(await processPortalAlert(env, { kind: "portal.alert", auditId })).toBe("belled");
    const bells = await bellsOf(nid);
    expect(bells.map((b) => b.user_id)).toEqual(expect.arrayContaining([owner, staff]));
    expect(bells[0]?.title).toBe("Pal Studio says they paid ₹11,800.00 for TH/INV/2627/0042");
    expect(bells[0]?.link).toBe("/payments?tab=notices");
  });

  it("refuses a row that is not a contact's portal request or notice, an unknown id and a malformed message; writes no bell", async () => {
    await member("owner");
    const r = await request("grievance");
    const staffRow = await audit("portal.request", "client_request", r.id, "staff", "s");
    expect(await processPortalAlert(env, { kind: "portal.alert", auditId: staffRow })).toBe("ignored");
    const other = await audit("document.accept", "document", r.id);
    expect(await processPortalAlert(env, { kind: "portal.alert", auditId: other })).toBe("ignored");
    expect(await processPortalAlert(env, { kind: "portal.alert", auditId: uuidv7() })).toBe("missing");
    expect(await processPortalAlert(env, { kind: "portal.alert", auditId: "" })).toBe("invalid");
    expect(await processPortalAlert(env, { kind: "portal.alert" })).toBe("invalid");
    expect(await bellsOf(r.id)).toEqual([]);
  });

  it("is routed from the email queue (acknowledged, never sent as an email) and its dead letter is logged and acknowledged", async () => {
    await member("owner");
    const r = await request("data_access");
    const message = (body: unknown) => ({
      id: "1",
      timestamp: new Date(),
      body,
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    });
    const m = message({ kind: "portal.alert", auditId: r.auditId });
    await handleQueue(
      { queue: "techaust-local-email", messages: [m] } as unknown as MessageBatch<unknown>,
      env,
    );
    expect(m.ack).toHaveBeenCalled();
    expect(m.retry).not.toHaveBeenCalled();
    expect((await bellsOf(r.id)).length).toBeGreaterThan(0);
    const logs: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((l: unknown) => {
      logs.push(String(l));
    });
    try {
      const dead = message({ kind: "portal.alert", auditId: r.auditId });
      await handleQueue(
        { queue: "techaust-local-email-dlq", messages: [dead] } as unknown as MessageBatch<unknown>,
        env,
      );
      expect(dead.ack).toHaveBeenCalled();
      expect(logs.some((l) => l.includes("portal_alert.dead_letter"))).toBe(true);
      // a malformed body of the family is acknowledged, never an email
      const bad = message({ kind: "portal.alert", auditId: 5 });
      await handleQueue(
        { queue: "techaust-local-email", messages: [bad] } as unknown as MessageBatch<unknown>,
        env,
      );
      expect(bad.ack).toHaveBeenCalled();
      expect(
        await env.DB.prepare("SELECT count(*) AS n FROM email_log").first<{ n: number }>(),
      ).toMatchObject({ n: 0 });
    } finally {
      log.mockRestore();
    }
  });
});
