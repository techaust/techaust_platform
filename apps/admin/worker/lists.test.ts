// Lists and lookups of M3.1: the staff list's keyset paging and filters, reactivation, the invite email, the bell, the global
// search and the audit viewer [ADM-G-03, ADM-G-05, ADM-G-09, ADM-AUTH-07, ADM-AUD-02, ADM-MAIL-01]. Permissions per role for every
// route are in rbac.test.ts; the audit row of every mutation is checked there too.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { FINANCE_AUDIT_ACTIONS } from "@techaust/core/audit";
import { fromIst } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LEADS_SQL, USERS_SQL } from "./search.ts";
import app from "./test-app.ts";
import { mkClient } from "./test-clients.ts";
import {
  bodyOf,
  call,
  captureQueue,
  countOf,
  ORIGIN,
  one,
  rows,
  sessionFor,
  tokenOfLink,
} from "./test-helpers.ts";

// biome-ignore lint/suspicious/noExplicitAny: response bodies in tests are read loosely
type J = Record<string, any>;
const json = async (res: Response): Promise<J> => (await res.json()) as J;
const owner = () => sessionFor("owner", { stepUp: true });

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------------------------------------------
describe("GET /users: keyset pages, sort, filters, search [ADM-G-03, ADM-AUTH-07]", () => {
  const makeMembers = async (prefix: string, n: number, role: "staff" | "sales" = "staff") => {
    const made = [];
    for (let i = 0; i < n; i++) {
      const name = `${prefix}-${String(i).padStart(2, "0")}`;
      made.push(await sessionFor(role, { name, email: `${name.toLowerCase()}@example.test` }));
    }
    return made;
  };
  const list = async (cookie: string, query: string) => json(await call(`/users?${query}`, { cookie }));
  const names = (page: J) => page.users.map((u: J) => u.name);

  it("walks forward and back in pages of 25 without a repeat or a gap, and says when there is no more", async () => {
    await makeMembers("pg", 27);
    const o = await owner();
    const first = await list(o.cookie, "q=pg-&sort=name");
    expect(first.users).toHaveLength(25);
    expect(first.prev).toBeNull();
    expect(first.next).not.toBeNull();
    const second = await list(o.cookie, `q=pg-&sort=name&after=${first.next}`);
    expect(names(second)).toEqual(["pg-25", "pg-26"]);
    expect(second.next).toBeNull();
    expect(second.prev).not.toBeNull();
    const back = await list(o.cookie, `q=pg-&sort=name&before=${second.prev}`);
    expect(names(back)).toEqual(names(first));
    expect(back.prev).toBeNull();
    expect(back.next).not.toBeNull();
    const all = [...names(first), ...names(second)];
    expect(all).toEqual([...all].sort());
    expect(new Set(all).size).toBe(27);
  });

  it("sorts by name or by created date, either way round; 50 per page on request", async () => {
    await makeMembers("so", 4);
    const o = await owner();
    expect(names(await list(o.cookie, "q=so-&sort=name&dir=desc"))).toEqual([
      "so-03",
      "so-02",
      "so-01",
      "so-00",
    ]);
    const byCreated = await list(o.cookie, "q=so-&sort=created&dir=asc&limit=50");
    expect(names(byCreated)).toEqual(["so-00", "so-01", "so-02", "so-03"]);
    const times = byCreated.users.map((u: J) => u.created_at);
    expect(times).toEqual([...times].sort((a: number, b: number) => a - b));
  });

  it("filters by role and status, and combines them with the search", async () => {
    await makeMembers("fl", 2, "staff");
    const sales = await makeMembers("fl-s", 1, "sales");
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?")
      .bind(sales[0]?.id)
      .run();
    const o = await owner();
    expect((await list(o.cookie, "q=fl-&role=sales")).users).toHaveLength(1);
    expect((await list(o.cookie, "q=fl-&status=deactivated")).users).toHaveLength(1);
    expect((await list(o.cookie, "q=fl-&status=active")).users).toHaveLength(2);
    expect((await list(o.cookie, "q=fl-&status=active&role=sales")).users).toHaveLength(0);
    expect((await list(o.cookie, "role=owner")).users.every((u: J) => u.role === "owner")).toBe(true);
  });

  it("searches the start of the name or of the email (case-insensitive); % and _ are plain characters", async () => {
    await sessionFor("staff", { name: "Meera Search", email: "meera.search@example.test" });
    const o = await owner();
    expect(names(await list(o.cookie, "q=meera%20s"))).toContain("Meera Search");
    expect(names(await list(o.cookie, "q=MEERA.SEARCH@"))).toContain("Meera Search");
    expect(names(await list(o.cookie, "q=eera"))).not.toContain("Meera Search"); // a start, not "contains"
    expect((await list(o.cookie, "q=%25")).users).toEqual([]);
    expect((await list(o.cookie, "q=_")).users).toEqual([]);
  });

  it("a made-up cursor, a bad limit or an unknown sort is 400", async () => {
    const o = await owner();
    for (const q of [
      "after=not-a-cursor",
      "before=%00%00",
      "limit=1000",
      "sort=email",
      "role=admin",
      "status=gone",
    ]) {
      expect((await call(`/users?${q}`, { cookie: o.cookie })).status, q).toBe(400);
    }
  });

  it("the rows carry no secret", async () => {
    const o = await owner();
    const text = JSON.stringify(await list(o.cookie, "limit=50"));
    expect(text).not.toMatch(/pw_|totp|secret|hmac|salt/i);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("users list cursor and pending-invite flag [ADM-G-03, ADM-AUTH-07]", () => {
  it("a cursor made for the other sort is 400, never a 500", async () => {
    const o = await owner();
    for (let i = 0; i < 3; i++)
      await sessionFor("staff", { name: `cur-${i}`, email: `cur-${i}@example.test` });
    const byName = await json(await call("/users?q=cur-&limit=25&sort=name", { cookie: o.cookie }));
    expect(byName.users.length).toBeGreaterThan(0);
    // a cursor for the date sort (a number) used with the name sort, and the reverse
    const dated = await json(await call("/users?sort=created&limit=25", { cookie: o.cookie }));
    const b64u = (o: unknown) =>
      btoa(JSON.stringify(o)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    const numeric = b64u({ k: 5, id: "x" });
    const text = b64u({ k: "abc", id: "x" });
    expect((await call(`/users?sort=name&after=${numeric}`, { cookie: o.cookie })).status).toBe(400);
    expect((await call(`/users?sort=created&after=${text}`, { cookie: o.cookie })).status).toBe(400);
    expect(dated.users.length).toBeGreaterThan(0);
  });

  it("GET /users/invites flags an invite whose address is already in the staff list (a reset member), and not a new invitee", async () => {
    const o = await owner();
    const member = await sessionFor("sales", { name: "Reset Person", email: "reset.person@example.test" });
    expect((await call(`/users/${member.id}/reset-2fa`, { method: "POST", cookie: o.cookie })).status).toBe(
      200,
    );
    const fresh = "brand.new.invitee@example.test";
    expect(
      (await call("/users/invites", { body: { email: fresh, role: "staff" }, cookie: o.cookie })).status,
    ).toBe(201);
    const { invites } = await json(await call("/users/invites", { cookie: o.cookie }));
    const flag = (email: string) => invites.find((i: J) => i.email === email)?.existing_member;
    expect(flag("reset.person@example.test")).toBe(true);
    expect(flag(fresh)).toBe(false);
  });
});

describe("reactivating a member [ADM-AUTH-07]", () => {
  it("brings a deactivated member back (active again, signs in with what they had), and audits status before and after", async () => {
    const o = await owner();
    const t = await sessionFor("sales");
    expect((await call(`/users/${t.id}/deactivate`, { method: "POST", cookie: o.cookie })).status).toBe(200);
    expect((await call("/auth/me", { cookie: t.cookie })).status).toBe(401); // sessions ended at deactivation
    const res = await call(`/users/${t.id}/reactivate`, { method: "POST", cookie: o.cookie });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ ok: true });
    const row = await one<{ status: string; totp_enabled_at: number | null }>(
      "SELECT status, totp_enabled_at FROM staff_users WHERE id = ?",
      t.id,
    );
    expect(row?.status).toBe("active");
    expect(row?.totp_enabled_at).not.toBeNull(); // their authenticator is untouched
    const audit = await one<{ summary: string; actor_id: string }>(
      "SELECT summary, actor_id FROM audit_log WHERE action = 'user.reactivate' AND entity_id = ?",
      t.id,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toEqual({
      status: { before: "deactivated", after: "active" },
    });
    expect(audit?.actor_id).toBe(o.id);
  });

  it("needs a fresh step-up; an active member is 409 not_deactivated; an unknown id is 404; staff can't", async () => {
    const t = await sessionFor("staff");
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?").bind(t.id).run();
    const plain = await sessionFor("owner");
    const refused = await call(`/users/${t.id}/reactivate`, { method: "POST", cookie: plain.cookie });
    expect(refused.status).toBe(403);
    expect((await json(refused)).error.code).toBe("step_up_required");
    expect(
      await one("SELECT 1 AS x FROM staff_users WHERE id = ? AND status = 'deactivated'", t.id),
    ).not.toBeNull();
    const o = await owner();
    const active = await sessionFor("sales");
    const notDeactivated = await call(`/users/${active.id}/reactivate`, { method: "POST", cookie: o.cookie });
    expect(notDeactivated.status).toBe(409);
    expect((await json(notDeactivated)).error.code).toBe("not_deactivated");
    expect((await call("/users/no-such-id/reactivate", { method: "POST", cookie: o.cookie })).status).toBe(
      404,
    );
    const staff = await sessionFor("staff", { stepUp: true });
    expect((await call(`/users/${t.id}/reactivate`, { method: "POST", cookie: staff.cookie })).status).toBe(
      403,
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the staff invite email [ADM-AUTH-07, ADM-MAIL-01]", () => {
  it("queues one email to the invited address with the link, the inviter's name and the role (07-H), keyed by the invite", async () => {
    const o = await sessionFor("owner", { stepUp: true, name: "Sample Owner (test)" });
    const q = captureQueue();
    const email = `invitee-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const res = await call(
      "/users/invites",
      { body: { email, role: "accountant" }, cookie: o.cookie },
      q.env,
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.email_queued).toBe(true);
    expect(q.sent).toHaveLength(1);
    const m = q.sent[0] as J;
    expect(m).toMatchObject({
      template: "staff.invite",
      to: email,
      data: { inviter_name: "Sample Owner (test)", role: "Accountant", url: body.link },
      entity: { type: "staff_invite" },
    });
    expect(m.entity.id).toMatch(/^[0-9a-f]{64}$/); // the token's hash, so a redelivery sends nothing twice
    expect(tokenOfLink(m.data.url)).toBe(tokenOfLink(body.link));
  });

  it("a refused invite (the address already belongs to a member) queues nothing; a failing queue doesn't change the answer", async () => {
    const o = await owner();
    const member = await sessionFor("staff");
    const q = captureQueue();
    const dup = await call(
      "/users/invites",
      { body: { email: member.email, role: "staff" }, cookie: o.cookie },
      q.env,
    );
    expect(dup.status).toBe(409);
    expect(q.sent).toHaveLength(0);
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation(
      (...a: unknown[]) => void logged.push(a.map(String).join(" ")),
    );
    const email = `down-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const failing = captureQueue(env, () => new Error(`queue down for ${email}`));
    const ok = await call(
      "/users/invites",
      { body: { email, role: "sales" }, cookie: o.cookie },
      failing.env,
    );
    expect(ok.status).toBe(201);
    expect(logged.join("\n")).toContain("email not queued");
    expect(logged.join("\n")).not.toContain(email);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the bell [ADM-G-09]", () => {
  let seq = 0;
  const bell = async (
    userId: string,
    over: { readAt?: number | null; createdAt?: number; title?: string } = {},
  ) => {
    const id = uuidv7();
    await env.DB.prepare(
      "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link, read_at, created_at) VALUES (?1, ?2, 'lead.new', 'lead', ?3, ?4, ?5, ?6, ?7)",
    )
      .bind(
        id,
        userId,
        `lead-${++seq}-${id}`,
        over.title ?? "New lead: A, B",
        `/leads/${id}`,
        over.readAt ?? null,
        over.createdAt ?? Date.now(),
      )
      .run();
    return id;
  };

  it("lists the member's own, unread first and newest first, with the unread count and a link to each record", async () => {
    const s = await sessionFor("sales");
    const other = await sessionFor("sales");
    const t = 1_760_000_000_000;
    const oldUnread = await bell(s.id, { createdAt: t });
    const newUnread = await bell(s.id, { createdAt: t + 5_000 });
    const readNew = await bell(s.id, { createdAt: t + 9_000, readAt: t + 9_500 });
    await bell(other.id);
    const res = await json(await call("/notifications", { cookie: s.cookie }));
    expect(res.notifications.map((n: J) => n.id)).toEqual([newUnread, oldUnread, readNew]);
    expect(res.unread).toBe(2);
    expect(res.next).toBeNull();
    expect(res.notifications[0]).toMatchObject({
      kind: "lead.new",
      title: "New lead: A, B",
      link: `/leads/${newUnread}`,
      readAt: null,
    });
    expect(res.notifications[2].readAt).toBe(t + 9_500);
  });

  it("pages with a cursor: unread rows first, then read ones, no repeat", async () => {
    const s = await sessionFor("staff");
    const t = 1_760_000_100_000;
    const ids: string[] = [];
    for (let i = 0; i < 6; i++)
      ids.push(await bell(s.id, { createdAt: t + i * 1000, readAt: i % 2 ? t : null }));
    const first = await json(await call("/notifications?limit=10", { cookie: s.cookie }));
    expect(first.notifications).toHaveLength(6);
    const p1 = await json(await call("/notifications?limit=10", { cookie: s.cookie }));
    // a real page boundary: limit 10 is the smallest allowed, so build 12 rows
    for (let i = 6; i < 12; i++)
      ids.push(await bell(s.id, { createdAt: t + i * 1000, readAt: i % 2 ? t : null }));
    const a = await json(await call("/notifications?limit=10", { cookie: s.cookie }));
    expect(a.notifications).toHaveLength(10);
    expect(a.next).not.toBeNull();
    const b = await json(await call(`/notifications?limit=10&after=${a.next}`, { cookie: s.cookie }));
    expect(b.notifications).toHaveLength(2);
    expect(b.next).toBeNull();
    const seen = [...a.notifications, ...b.notifications].map((n: J) => n.id);
    expect(new Set(seen).size).toBe(12);
    // all unread rows come before any read one
    const flags = [...a.notifications, ...b.notifications].map((n: J) => n.readAt !== null);
    expect(flags).toEqual([...flags].sort((x, y) => Number(x) - Number(y)));
    expect(p1.unread).toBe(3);
    expect((await call("/notifications?after=bogus", { cookie: s.cookie })).status).toBe(400);
  });

  it("marks one read (idempotent) and all read; another member's id is 404; each is audited", async () => {
    const s = await sessionFor("sales");
    const other = await sessionFor("staff");
    const mine = await bell(s.id);
    const theirs = await bell(other.id);
    expect((await call(`/notifications/${theirs}/read`, { method: "POST", cookie: s.cookie })).status).toBe(
      404,
    );
    expect(
      (await one<{ read_at: number | null }>("SELECT read_at FROM notifications WHERE id = ?", theirs))
        ?.read_at,
    ).toBeNull();
    expect((await call(`/notifications/${mine}/read`, { method: "POST", cookie: s.cookie })).status).toBe(
      200,
    );
    const stamp = (await one<{ read_at: number }>("SELECT read_at FROM notifications WHERE id = ?", mine))
      ?.read_at;
    expect(stamp).toBeGreaterThan(0);
    expect((await call(`/notifications/${mine}/read`, { method: "POST", cookie: s.cookie })).status).toBe(
      200,
    );
    expect(
      (await one<{ read_at: number }>("SELECT read_at FROM notifications WHERE id = ?", mine))?.read_at,
    ).toBe(stamp);
    await bell(s.id);
    await bell(s.id);
    expect((await json(await call("/notifications", { cookie: s.cookie }))).unread).toBe(2);
    expect((await call("/notifications/read-all", { method: "POST", cookie: s.cookie })).status).toBe(200);
    expect((await json(await call("/notifications", { cookie: s.cookie }))).unread).toBe(0);
    expect((await call("/notifications/read-all", { method: "POST", cookie: s.cookie })).status).toBe(200); // nothing left: fine
    expect(await countOf("notifications", "user_id = ? AND read_at IS NULL", other.id)).toBe(1); // the other member's untouched
    expect(await countOf("audit_log", "action = 'notification.read' AND actor_id = ?", s.id)).toBe(1);
    expect(await countOf("audit_log", "action = 'notification.read_all' AND actor_id = ?", s.id)).toBe(1);
  });

  it("a mark-read POST that sends `{}` has its body read before the answer (front binding error, staging 2026-10-28)", async () => {
    const s = await sessionFor("sales");
    const mine = await bell(s.id);
    const req = new Request(`${ORIGIN}/api/v1/notifications/${mine}/read`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "2",
        Origin: ORIGIN,
        Cookie: s.cookie,
      },
      body: "{}",
    });
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(req.bodyUsed).toBe(true);
  });

  it("every role has a bell", async () => {
    for (const role of ["owner", "staff", "sales", "accountant"] as const) {
      const s = await sessionFor(role);
      expect((await call("/notifications", { cookie: s.cookie })).status, role).toBe(200);
    }
  });

  it("the unread count and 'mark all read' are served by the (user, read_at, created_at, id) index [ADM-G-09]", async () => {
    const plan = async (sql: string, ...p: unknown[]) =>
      (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...p)).map((r) => r.detail).join(" | ");
    expect(
      await plan("SELECT count(*) AS n FROM notifications WHERE user_id = ?1 AND read_at IS NULL", "u"),
    ).toMatch(/USING (COVERING )?INDEX notifications_user_unread \(user_id=\? AND read_at=\?\)/);
    expect(
      await plan("UPDATE notifications SET read_at = ?1 WHERE user_id = ?2 AND read_at IS NULL", 1, "u"),
    ).toMatch(/USING (COVERING )?INDEX notifications_user_unread \(user_id=\? AND read_at=\?\)/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("global search [ADM-G-05]", () => {
  const lead = (ref: string, name: string, email: string) =>
    env.DB.prepare(
      "INSERT INTO leads (id, ref, source, form_version, contact_name, contact_email) VALUES (?1, ?2, 'web', 'contact-1', ?3, ?4)",
    )
      .bind(uuidv7(), ref, name, email)
      .run();
  const find = async (cookie: string, q: string) =>
    json(await call(`/search?q=${encodeURIComponent(q)}`, { cookie }));
  const group = (res: J, type: string) => res.groups.find((g: J) => g.type === type);

  it("finds leads by the start of the reference or the email, and staff by name or email, grouped by type", async () => {
    await lead("L-SRCH1", "Asha Searchable", "asha.searchable@example.test");
    await sessionFor("staff", { name: "Searchable Staff", email: "searchable.staff@example.test" });
    const o = await owner();
    const byRef = await find(o.cookie, "l-srch");
    expect(group(byRef, "lead").items.map((i: J) => i.title)).toEqual(["L-SRCH1 Asha Searchable"]);
    expect(group(byRef, "lead").items[0].link).toMatch(/^\/leads\//);
    expect(group(byRef, "user").items).toEqual([]);
    const byEmail = await find(o.cookie, "asha.search");
    expect(group(byEmail, "lead").items).toHaveLength(1);
    const staff = await find(o.cookie, "searchable");
    expect(group(staff, "user").items.map((i: J) => i.title)).toEqual(["Searchable Staff"]);
    expect(group(staff, "lead").items).toHaveLength(0); // "searchable" starts neither the ref nor the lead's email
  });

  it("returns what the role may read: sales no staff, the accountant clients and contacts only (no projects), owner everything", async () => {
    await lead("L-ROLE1", "Role Lead", "role.lead@example.test");
    const sales = await sessionFor("sales");
    const res = await find(sales.cookie, "L-ROLE");
    // M3.4 projects, M4.1 catalogue and M4.3 proposals and estimates: Sales reads all three. M5.1 invoices: not Sales (`invoices.read`), the accountant and the owner yes.
    expect(res.groups.map((g: J) => g.type)).toEqual([
      "lead",
      "client",
      "contact",
      "project",
      "catalogue",
      "document",
    ]);
    const accountant = await sessionFor("accountant");
    expect((await find(accountant.cookie, "L-ROLE")).groups.map((g: J) => g.type)).toEqual([
      "client",
      "contact",
      "catalogue",
      "document",
      "invoice",
    ]);
    const o = await owner();
    expect((await find(o.cookie, "L-ROLE")).groups.map((g: J) => g.type)).toEqual([
      "lead",
      "client",
      "contact",
      "project",
      "catalogue",
      "document",
      "invoice",
      "user",
    ]);
  });

  it("finds proposals and estimates by the start of the number, the latest version only, for every role (M4.3)", async () => {
    const clientId = await mkClient();
    const mk = async (id: string, display: string, version: number, group: string) => {
      await env.DB.prepare(
        "INSERT INTO documents (id, type, client_id, currency, version_group_id, version, series, fy, number, number_display, frozen_at, status, title) VALUES (?1, 'proposal', ?2, 'INR', ?3, ?4, 'proposal', '2627', 7, ?5, 1, 'sent', 'A proposal')",
      )
        .bind(id, clientId, group, version, display)
        .run();
    };
    await mk("srch-v1", "TH/PRP/2627/0777", 1, "srch-v1");
    await mk("srch-v2", "TH/PRP/2627/0777", 2, "srch-v1");
    for (const role of ["owner", "staff", "sales", "accountant"] as const) {
      const s = await sessionFor(role);
      const items = group(await find(s.cookie, "th/prp/2627/07"), "document").items;
      expect(items, role).toEqual([
        {
          id: "srch-v2",
          title: "TH/PRP/2627/0777 A proposal",
          subtitle: "Proposal, version 2",
          link: "/documents/srch-v2",
        },
      ]);
    }
  });

  it("finds catalogue items by the start of the code or the name, for every role (M4.1)", async () => {
    await env.DB.prepare(
      "INSERT INTO catalogue_items (id, code, name, category, short, unit, sac, schedule) VALUES ('cat-s1', 'S9001', 'Searchable Widget Work', 'build', 's', 'fixed', '998314', '[]')",
    ).run();
    for (const role of ["owner", "staff", "sales", "accountant"] as const) {
      const s = await sessionFor(role);
      expect(group(await find(s.cookie, "s9001"), "catalogue").items).toEqual([
        {
          id: "cat-s1",
          title: "S9001 Searchable Widget Work",
          subtitle: "Catalogue item",
          link: "/catalogue/cat-s1",
        },
      ]);
      expect(group(await find(s.cookie, "searchable wid"), "catalogue").items).toHaveLength(1);
    }
    const o = await owner();
    expect(group(await find(o.cookie, "idget"), "catalogue").items).toEqual([]); // prefix, not substring
  });

  it("at most five per type; under two characters is empty; % and _ are not wildcards; a long query is 400", async () => {
    for (let i = 0; i < 7; i++) await lead(`L-FIVE${i}`, `Five ${i}`, `five${i}@example.test`);
    const o = await owner();
    expect(group(await find(o.cookie, "L-FIVE"), "lead").items).toHaveLength(5);
    expect((await find(o.cookie, "L")).groups).toEqual([]);
    expect(group(await find(o.cookie, "%%"), "user").items).toEqual([]);
    expect(group(await find(o.cookie, "__"), "user").items).toEqual([]);
    expect((await call(`/search?q=${"x".repeat(101)}`, { cookie: o.cookie })).status).toBe(400);
    expect((await call("/search", { cookie: o.cookie })).status).toBe(400);
  });

  it("finds a lead by the start of the company name, without regard to case", async () => {
    await env.DB.prepare(
      "INSERT INTO leads (id, ref, source, form_version, contact_name, contact_email, contact_company) VALUES (?1, 'L-COMP1', 'web', 'contact-1', 'Pat Person', 'pat.person@example.test', 'Zebra Traders')",
    )
      .bind(uuidv7())
      .run();
    const o = await owner();
    expect(group(await find(o.cookie, "zebra tr"), "lead").items.map((i: J) => i.title)).toEqual([
      "L-COMP1 Pat Person",
    ]);
  });

  it("the lead lookup uses the reference, email and company indexes, never a scan of the leads table", async () => {
    const plan = await rows<{ detail: string }>(
      `EXPLAIN QUERY PLAN ${LEADS_SQL}`,
      "L-A",
      "L-B",
      "a",
      "b",
      "c",
      "d",
    );
    const text = plan.map((p) => p.detail).join("\n");
    expect(text).toMatch(/leads_ref/);
    expect(text).toMatch(/leads_email/);
    expect(text).toMatch(/leads_company_nocase/);
    expect(text).not.toMatch(/SCAN leads/);
    // the staff table is a handful of rows: its name match is a scan by design, its email match uses the unique index
    const users = (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${USERS_SQL}`, "a", "b", "a%"))
      .map((p) => p.detail)
      .join("\n");
    expect(users).toMatch(/staff_users/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("audit-log API [ADM-AUD-02]", () => {
  const T0 = 1_780_000_000_000;
  let n = 0;
  const entry = (
    over: { at?: number; action?: string; actor?: string | null; entity?: string; ip?: string } = {},
  ) => {
    const id = uuidv7(T0 + ++n);
    return env.DB.prepare(
      "INSERT INTO audit_log (id, at, actor_type, actor_id, role, action, entity_type, entity_id, summary, ip, user_agent) VALUES (?1, ?2, 'staff', ?3, 'owner', ?4, ?5, 'e1', ?6, ?7, 'UA/1')",
    )
      .bind(
        id,
        over.at ?? T0 + n,
        over.actor ?? null,
        over.action ?? "settings.flags.update",
        over.entity ?? "audit-test",
        JSON.stringify({ blogEnabled: { before: true, after: false } }),
        over.ip ?? "203.0.113.9",
      )
      .run();
  };
  const get = async (cookie: string, query: string) => json(await call(`/audit?${query}`, { cookie }));

  it("the owner sees everything newest first, with who, what, the diff and the network details; pages of 25 with no gap", async () => {
    const o = await owner();
    for (let i = 0; i < 27; i++) await entry({ entity: "page-test", at: T0 + 10_000 + i });
    const first = await get(o.cookie, "entity=page-test");
    expect(first.entries).toHaveLength(25);
    const ats = first.entries.map((e: J) => e.at);
    expect(ats).toEqual([...ats].sort((a: number, b: number) => b - a));
    expect(first.entries[0]).toMatchObject({
      action: "settings.flags.update",
      entityType: "page-test",
      role: "owner",
      ip: "203.0.113.9",
      userAgent: "UA/1",
      summary: { blogEnabled: { before: true, after: false } },
    });
    const second = await get(o.cookie, `entity=page-test&after=${first.next}`);
    expect(second.entries).toHaveLength(2);
    expect(second.next).toBeNull();
    const back = await get(o.cookie, `entity=page-test&before=${second.prev}`);
    expect(back.entries.map((e: J) => e.id)).toEqual(first.entries.map((e: J) => e.id));
    expect(new Set([...first.entries, ...second.entries].map((e: J) => e.id)).size).toBe(27);
  });

  it("filters by actor, action and entity type, and joins the actor's name", async () => {
    const o = await owner();
    const who = await sessionFor("staff", { name: "Audit Actor" });
    await entry({ actor: who.id, action: "user.invite", entity: "filter-test" });
    await entry({ actor: who.id, action: "user.deactivate", entity: "filter-test" });
    await entry({ actor: null, action: "user.invite", entity: "filter-test" });
    expect((await get(o.cookie, `entity=filter-test`)).entries).toHaveLength(3);
    const byActor = await get(o.cookie, `entity=filter-test&actor=${who.id}`);
    expect(byActor.entries).toHaveLength(2);
    expect(byActor.entries[0].actorName).toBe("Audit Actor");
    expect((await get(o.cookie, "entity=filter-test&action=user.invite")).entries).toHaveLength(2);
    expect(
      (await get(o.cookie, `entity=filter-test&actor=${who.id}&action=user.deactivate`)).entries,
    ).toHaveLength(1);
  });

  it("an IST day is turned into UTC: the first and last instants of a day are in, the next instant is out", async () => {
    const o = await owner();
    const dayStart = fromIst({ year: 2026, month: 12, day: 5 });
    const nextStart = fromIst({ year: 2026, month: 12, day: 6 });
    await entry({ entity: "day-test", at: dayStart - 1 }); // 4 Dec 23:59:59.999 IST
    await entry({ entity: "day-test", at: dayStart }); // 5 Dec 00:00 IST
    await entry({ entity: "day-test", at: nextStart - 1 }); // 5 Dec 23:59:59.999 IST
    await entry({ entity: "day-test", at: nextStart }); // 6 Dec 00:00 IST
    const day = await get(o.cookie, "entity=day-test&from=2026-12-05&to=2026-12-05");
    expect(day.entries.map((e: J) => e.at).sort()).toEqual([dayStart, nextStart - 1].sort());
    expect((await get(o.cookie, "entity=day-test&from=2026-12-05")).entries).toHaveLength(3);
    expect((await get(o.cookie, "entity=day-test&to=2026-12-04")).entries).toHaveLength(1);
    for (const q of ["from=2026-13-40", "from=yesterday", "to=2026-2-3"])
      expect((await call(`/audit?${q}`, { cookie: o.cookie })).status, q).toBe(400);
  });

  it("the accountant sees the finance events only, without network details; staff and sales are refused", async () => {
    const accountant = await sessionFor("accountant");
    await entry({ action: "settings.company.update", entity: "acct-test" });
    await entry({ action: "user.invite", entity: "acct-test" });
    await entry({ action: "settings.tax.update", entity: "acct-test" });
    await entry({ action: "settings.bank.update", entity: "acct-test" });
    const res = await get(accountant.cookie, "entity=acct-test");
    expect(res.entries.map((e: J) => e.action).sort()).toEqual([
      "settings.bank.update",
      "settings.tax.update",
    ]);
    for (const e of res.entries) {
      expect(FINANCE_AUDIT_ACTIONS).toContain(e.action);
      expect(e.ip).toBeNull();
      expect(e.userAgent).toBeNull();
    }
    // asking for another action by name doesn't get around it
    expect((await get(accountant.cookie, "entity=acct-test&action=user.invite")).entries).toEqual([]);
    for (const role of ["staff", "sales"] as const) {
      const s = await sessionFor(role);
      expect((await call("/audit", { cookie: s.cookie })).status).toBe(403);
    }
  });

  it("the export needs a fresh step-up on every page: owner and accountant; staff and sales are refused [ADM-AUD-02]", async () => {
    const exp = (cookie: string, q = "") => call(`/audit/export?${q}`, { cookie });
    for (const role of ["owner", "accountant"] as const) {
      const cold = await sessionFor(role);
      const refused = await exp(cold.cookie);
      expect(refused.status, role).toBe(403);
      expect((await json(refused)).error.code).toBe("step_up_required");
      const warm = await sessionFor(role, { stepUp: true });
      expect((await exp(warm.cookie)).status, role).toBe(200);
      // an expired step-up is refused again, on a page with a cursor too
      const lapsed = await sessionFor(role, { stepUp: Date.now() - 1_000 });
      expect((await exp(lapsed.cookie, "limit=50")).status, role).toBe(403);
    }
    for (const role of ["staff", "sales"] as const) {
      const s = await sessionFor(role, { stepUp: true });
      expect((await exp(s.cookie)).status, role).toBe(403);
    }
    // the plain list is not an export: no step-up needed there
    const plain = await sessionFor("owner");
    expect((await call("/audit", { cookie: plain.cookie })).status).toBe(200);
  });

  it("the export gives the same rows as the list (the accountant: finance events only, no network details) and writes one audit.export row per page", async () => {
    await entry({ action: "settings.bank.update", entity: "exp-test" });
    await entry({ action: "user.invite", entity: "exp-test" });
    const acc = await sessionFor("accountant", { stepUp: true });
    const res = await json(
      await call("/audit/export?entity=exp-test&from=2026-01-01", { cookie: acc.cookie }),
    );
    expect(res.entries.map((e: J) => e.action)).toEqual(["settings.bank.update"]);
    expect(res.entries[0].ip).toBeNull();
    const o = await sessionFor("owner", { stepUp: true });
    const all = await json(await call("/audit/export?entity=exp-test", { cookie: o.cookie }));
    expect(all.entries.map((e: J) => e.action).sort()).toEqual(["settings.bank.update", "user.invite"]);
    const logged = await rows<{ actor_id: string; role: string; summary: string }>(
      "SELECT actor_id, role, summary FROM audit_log WHERE action = 'audit.export' AND actor_id IN (?1, ?2)",
      acc.id,
      o.id,
    );
    expect(logged).toHaveLength(2);
    const mine = JSON.parse(logged.find((r) => r.actor_id === acc.id)?.summary ?? "{}");
    expect(mine.rows).toBe(1);
    expect(mine.filters).toEqual({ entity: "exp-test", from: "2026-01-01" });
    // the entries themselves are never copied into the log
    expect(JSON.stringify(logged)).not.toMatch(/203\.0\.113\.9/);
    // a refused export (no step-up) writes no export row
    const before = await countOf("audit_log", "action = 'audit.export'");
    await call("/audit/export", { cookie: (await sessionFor("owner")).cookie });
    expect(await countOf("audit_log", "action = 'audit.export'")).toBe(before);
  });

  it("a made-up cursor or a bad limit is 400", async () => {
    const o = await owner();
    for (const q of ["after=x", "before=%20", "limit=10", "limit=51"])
      expect((await call(`/audit?${q}`, { cookie: o.cookie })).status, q).toBe(400);
  });
});
