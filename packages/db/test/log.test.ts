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

describe("the staff statements keep their exact SQL (the admin's M1.5 behaviour is pinned) [ADM-G-06, NFR-9]", () => {
  /** A D1 stand-in that records what is prepared and bound, and runs nothing. */
  const fake = () => {
    const seen: { sql: string; values: unknown[] }[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            seen.push({ sql, values });
            return {};
          },
        };
      },
    } as unknown as D1Database;
    return { db, seen };
  };
  const audit = (extra: object = {}) => ({
    requestId: "r",
    ip: "i",
    ua: "u",
    actorId: "a",
    role: "owner" as const,
    action: "x.y",
    entityType: "e",
    entityId: "1",
    ...extra,
  });
  const AUDIT_COLS =
    "id, actor_type, actor_id, role, action, entity_type, entity_id, summary, ip, user_agent, request_id";
  const ACCESS_COLS = "id, realm, actor_id, method, route, status, ip, user_agent, request_id";
  const access = {
    requestId: "r",
    ip: "i",
    ua: "u",
    actorId: "a",
    method: "GET",
    route: "/v1/x",
    status: 200,
  };

  it("an unguarded audit row and an unguarded access row are plain VALUES inserts", () => {
    const { db, seen } = fake();
    auditStmt(db, audit());
    accessStmt(db, access);
    expect(seen[0]?.sql).toBe(
      `INSERT INTO audit_log (${AUDIT_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    );
    expect(seen[0]?.values).toHaveLength(11);
    expect(seen[0]?.values[1]).toBe("staff"); // the default actor type
    expect(seen[1]?.sql).toBe(
      `INSERT INTO access_log (${ACCESS_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    );
    expect(seen[1]?.values).toHaveLength(9);
    expect(seen[1]?.values[1]).toBe("admin"); // the default realm
  });

  it("a staff-session guard, an audit-id guard and 'changes' are SELECT ... WHERE inserts with the same numbering", () => {
    const { db, seen } = fake();
    auditStmt(db, audit(), "sess-1");
    auditStmt(db, audit(), { sessionId: "sess-2" });
    accessStmt(db, access, { auditId: "audit-1" });
    auditStmt(db, audit(), "changes");
    expect(seen[0]?.sql).toBe(
      `INSERT INTO audit_log (${AUDIT_COLS}) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 WHERE EXISTS (SELECT 1 FROM staff_sessions WHERE id = ?12)`,
    );
    expect(seen[0]?.values.at(-1)).toBe("sess-1");
    expect(seen[1]?.sql).toBe(seen[0]?.sql);
    expect(seen[1]?.values.at(-1)).toBe("sess-2");
    expect(seen[2]?.sql).toBe(
      `INSERT INTO access_log (${ACCESS_COLS}) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE EXISTS (SELECT 1 FROM audit_log WHERE id = ?10)`,
    );
    expect(seen[2]?.values.at(-1)).toBe("audit-1");
    expect(seen[3]?.sql).toBe(
      `INSERT INTO audit_log (${AUDIT_COLS}) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 WHERE changes() > 0`,
    );
    expect(seen[3]?.values).toHaveLength(11);
  });
});
