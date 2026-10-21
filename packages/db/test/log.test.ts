import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { accessStmt, auditStmt } from "../src/log.ts";
import { all, run } from "./helpers.ts";

const info = { requestId: "rid-1", ip: "203.0.113.5", ua: "test-agent" };

async function session(id: string, contactId: string) {
  await run(
    "INSERT INTO client_sessions (id, contact_id, client_id, last_seen_at, idle_expires_at, abs_expires_at) VALUES (?1, ?2, 'client-1', 1, 2, 3)",
    id,
    contactId,
  );
}

describe("portal log rows [NFR-9, POR-02]", () => {
  it("the { clientSessionId } guard writes the row only while that portal session exists", async () => {
    await session("cs-live", "contact-live");
    await env.DB.batch([
      auditStmt(
        env.DB,
        {
          ...info,
          actorType: "contact",
          actorId: "contact-live",
          role: null,
          action: "t.live",
          entityType: "x",
          entityId: null,
        },
        { clientSessionId: "cs-live" },
      ),
      auditStmt(
        env.DB,
        {
          ...info,
          actorType: "contact",
          actorId: "contact-x",
          role: null,
          action: "t.gone",
          entityType: "x",
          entityId: null,
        },
        { clientSessionId: "cs-missing" },
      ),
      accessStmt(
        env.DB,
        { ...info, realm: "portal", actorId: "contact-live", method: "GET", route: "/v1/me", status: 200 },
        { clientSessionId: "cs-live" },
      ),
      accessStmt(
        env.DB,
        { ...info, realm: "portal", actorId: "contact-x", method: "GET", route: "/v1/gone", status: 200 },
        { clientSessionId: "cs-missing" },
      ),
    ]);
    const audits = await all<{ action: string; actor_type: string; role: string | null }>(
      "SELECT action, actor_type, role FROM audit_log WHERE action LIKE 't.%'",
    );
    expect(audits).toEqual([{ action: "t.live", actor_type: "contact", role: null }]);
    const access = await all<{ route: string; realm: string }>(
      "SELECT route, realm FROM access_log WHERE route IN ('/v1/me', '/v1/gone')",
    );
    expect(access).toEqual([{ route: "/v1/me", realm: "portal" }]);
  });

  it("actorFromClientSession takes the actor from the session row (NULL when there is none)", async () => {
    await session("cs-actor", "contact-actor");
    await env.DB.batch([
      auditStmt(
        env.DB,
        {
          ...info,
          actorType: "contact",
          actorId: null,
          actorFromClientSession: "cs-actor",
          role: null,
          action: "t.from_session",
          entityType: "contact",
          entityId: null,
        },
        { clientSessionId: "cs-actor" },
      ),
      accessStmt(env.DB, {
        ...info,
        realm: "portal",
        actorId: null,
        actorFromClientSession: "cs-actor",
        method: "POST",
        route: "/v1/from-session",
        status: 200,
      }),
      accessStmt(env.DB, {
        ...info,
        realm: "portal",
        actorId: null,
        actorFromClientSession: "cs-nobody",
        method: "POST",
        route: "/v1/no-session",
        status: 204,
      }),
    ]);
    const audit = await all<{ actor_id: string; ip: string; user_agent: string; request_id: string }>(
      "SELECT actor_id, ip, user_agent, request_id FROM audit_log WHERE action = 't.from_session'",
    );
    expect(audit).toEqual([
      { actor_id: "contact-actor", ip: info.ip, user_agent: info.ua, request_id: info.requestId },
    ]);
    const access = await all<{ route: string; actor_id: string | null; status: number }>(
      "SELECT route, actor_id, status FROM access_log WHERE route IN ('/v1/from-session', '/v1/no-session') ORDER BY route",
    );
    expect(access).toEqual([
      { route: "/v1/from-session", actor_id: "contact-actor", status: 200 },
      { route: "/v1/no-session", actor_id: null, status: 204 },
    ]);
  });

  it("the staff guards and plain rows are unchanged", async () => {
    await env.DB.batch([
      accessStmt(env.DB, { ...info, actorId: null, method: "GET", route: "/v1/plain", status: 200 }),
      accessStmt(
        env.DB,
        { ...info, actorId: null, method: "GET", route: "/v1/staff-guarded", status: 200 },
        "no-such-staff-session",
      ),
    ]);
    const rows = await all<{ route: string; realm: string }>(
      "SELECT route, realm FROM access_log WHERE route IN ('/v1/plain', '/v1/staff-guarded')",
    );
    expect(rows).toEqual([{ route: "/v1/plain", realm: "admin" }]);
  });
});
