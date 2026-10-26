// The dashboard [ADM-DASH-01]: which tiles each role gets (a tile it may not see is absent), what the figures say against a known
// fixture, the activity feed per role, and that nothing sensitive is in the answer. The stress run (rows read, plans) is in
// dashboard-stress.test.ts.
import { env } from "cloudflare:workers";
import { FINANCE_AUDIT_ACTIONS } from "@techaust/core/audit";
import { ACTIVITY_ACTIONS } from "@techaust/core/dashboard";
import { addDays, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { ROLES } from "@techaust/core/permissions";
import { SETTINGS_SCHEMAS } from "@techaust/core/settings";
import { describe, expect, it } from "vitest";
import { ROUTES } from "./guard.ts";
import { mkLog, mkPlan, today } from "./test-care.ts";
import { insert, keysDeep, mkClient } from "./test-clients.ts";
import { call, countOf, sessionFor } from "./test-helpers.ts";
import { mkMilestone, mkProject } from "./test-projects.ts";

// biome-ignore lint/suspicious/noExplicitAny: response bodies in tests are read loosely
type J = Record<string, any>;
const json = async (res: Response): Promise<J> => (await res.json()) as J;
const dash = async (cookie: string) => {
  const res = await call("/dashboard", { cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return json(res);
};
const plus = (days: number) => toIsoDate(addDays(parseIsoDate(today()) as never, days));
const HOUR = 3_600_000;
let n = 0;

async function audit(
  action: string,
  actor: string | null,
  at: number,
  entity: [string, string | null] = ["client", null],
) {
  await insert("audit_log", {
    id: `a-${++n}-${crypto.randomUUID()}`,
    actor_type: actor ? "staff" : "system",
    actor_id: actor,
    role: actor ? "owner" : null,
    action,
    entity_type: entity[0],
    entity_id: entity[1],
    summary: JSON.stringify({ secret: "never-shown" }),
    ip: "203.0.113.77",
    user_agent: "Hidden/9.9",
    at,
  });
}

describe("GET /dashboard: tiles by role [ADM-DASH-01]", () => {
  const expected: Record<string, string[]> = {
    owner: ["leads", "pipelineValue", "finance", "projects", "milestones", "careBurn", "myTime", "activity"],
    staff: ["projects", "milestones", "careBurn", "myTime", "activity"],
    sales: ["leads", "pipelineValue", "activity"],
    accountant: ["finance", "activity"],
  };

  it("gives each role exactly its tiles, and a tile it may not see is absent, never an 'unavailable' stub", async () => {
    for (const role of ROLES) {
      const s = await sessionFor(role);
      const body = await dash(s.cookie);
      expect(Object.keys(body.tiles).sort(), role).toEqual([...(expected[role] as string[])].sort());
      expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof body.asOf).toBe("number");
    }
    expect((await call("/dashboard")).status).toBe(401);
  });

  it("the finance stub says what it waits for (the pipeline value is live since M4.3: dashboard-pipeline.test.ts)", async () => {
    const o = await dash((await sessionFor("owner")).cookie);
    expect(o.tiles.finance.available).toBe(false);
    expect(Object.keys(o.tiles.finance.arrivesWith)).toEqual([
      "invoicedAndCollected",
      "overdueInvoices",
      "paymentsToVerify",
    ]);
  });

  it("no role sees the audit summary, the address or the user agent; Sales sees no finance, care or billing action", async () => {
    const o = await sessionFor("owner");
    await audit("client.billing_update", o.id, Date.now() - 1000);
    await audit("lead.update", o.id, Date.now() - 2000);
    await audit("care_plan.terms", o.id, Date.now() - 3000);
    for (const role of ROLES) {
      const s = await sessionFor(role);
      const body = await dash(s.cookie);
      const text = JSON.stringify(body);
      expect(text, role).not.toContain("never-shown");
      expect(text).not.toContain("203.0.113.77");
      expect(text).not.toContain("Hidden/9.9");
      const keys = keysDeep(body);
      for (const forbidden of ["summary", "ip", "userAgent", "user_agent"])
        expect(keys, `${role} ${forbidden}`).not.toContain(forbidden);
    }
    const sales = await dash((await sessionFor("sales")).cookie);
    const actions = sales.tiles.activity.items.map((i: J) => i.action);
    expect(actions).toContain("lead.update");
    for (const a of actions) {
      expect(a).not.toBe("client.billing_update");
      expect(a).not.toMatch(/^care_plan\./);
      expect(FINANCE_AUDIT_ACTIONS as readonly string[]).not.toContain(a);
    }
  });
});

describe("the activity lists", () => {
  it("every action is an audit name of a route, or a known system action", () => {
    const routeNames = new Set<string>();
    for (const r of ROUTES) {
      if (!r.audit) continue;
      if (r.audit === "settings.<group>.update")
        for (const k of Object.keys(SETTINGS_SCHEMAS)) routeNames.add(`settings.${k}.update`);
      else routeNames.add(r.audit);
    }
    // written by something other than the route's own name: the erase route writes `contact.anonymise` in anonymise mode, the jobs
    // Worker writes `lead.purge`; the finance names arrive with M4 to M6 (document.*, payment.*, refund.*, export.*)
    const known = new Set([
      "contact.anonymise",
      "lead.purge",
      "document.expire", // written by the jobs Worker (M4.3)
      "approval.expire", // written by the decide route when it finds the content changed (M4.3)
      ...FINANCE_AUDIT_ACTIONS.filter((a) => /^(document|payment|refund|export)\./.test(a)),
    ]);
    for (const role of ROLES)
      for (const a of ACTIVITY_ACTIONS[role])
        expect(routeNames.has(a) || known.has(a), `${role} ${a}`).toBe(true);
    // a lower role never sees what the owner does not
    for (const role of ROLES)
      for (const a of ACTIVITY_ACTIONS[role]) expect(ACTIVITY_ACTIONS.owner).toContain(a);
  });

  it("the feed is the last 20 of the role's actions in the last 30 days, with the actor's name or 'System' and a reference", async () => {
    const o = await sessionFor("owner", { name: "Olive Owner" });
    const a = await sessionFor("staff", { name: "Stan Staff" });
    const b = await sessionFor("staff", { name: "Sue Other" });
    const sales = await sessionFor("sales", { name: "Sally Sales" });
    const acct = await sessionFor("accountant");
    const client = await mkClient();
    const clientCode = (
      await env.DB.prepare("SELECT code FROM clients WHERE id = ?").bind(client).first<{ code: string }>()
    )?.code;
    const now = Date.now();
    const lead = crypto.randomUUID();
    await insert("leads", {
      id: lead,
      ref: "L-FEED1",
      stage: "won",
      created_at: 1,
      source: "manual",
      contact_name: "Feed Person",
      contact_email: "feed@example.test",
    });
    await audit("auth.login", o.id, now - 1000);
    await audit("notification.read", a.id, now - 2000);
    await audit("lead.update", o.id, now - 3000, ["lead", lead]);
    await audit("client.update", a.id, now - 4000, ["client", client]);
    await audit("client.billing_update", o.id, now - 5000, ["client", client]);
    await audit("care_plan.terms", o.id, now - 6000, ["care_plan", "none"]);
    await audit("time.create", a.id, now - 7000, ["time_log", "t1"]);
    await audit("time.create", b.id, now - 8000, ["time_log", "t2"]);
    await audit("time.create", sales.id, now - 9000, ["time_log", "t3"]);
    await audit("lead.purge", null, now - 10_000, ["lead", "gone"]);
    await audit("lead.update", o.id, now - 40 * 24 * HOUR, ["lead", lead]); // too old
    await audit("project.create", o.id, now + 5000, ["project", "future-id"]); // a little ahead of this clock (skew): listed first
    const items = async (cookie: string) => (await dash(cookie)).tiles.activity.items as J[];
    const ownerItems = await items(o.cookie);
    expect(ownerItems.map((i) => i.action)).not.toContain("auth.login");
    expect(ownerItems.map((i) => i.action)).not.toContain("notification.read");
    expect(ownerItems.filter((i) => i.action === "lead.update" && i.entityId === lead)).toHaveLength(1); // the old one is out
    expect(ownerItems.find((i) => i.action === "lead.update" && i.entityId === lead)).toMatchObject({
      actor: "Olive Owner",
      entityType: "lead",
      ref: "L-FEED1",
    });
    expect(ownerItems.find((i) => i.action === "client.update")).toMatchObject({
      actor: "Stan Staff",
      ref: clientCode,
    });
    expect(ownerItems.find((i) => i.action === "lead.purge")).toMatchObject({ actor: "System", ref: null });
    expect(ownerItems.filter((i) => i.action === "time.create")).toHaveLength(3);
    const staffItems = await items(a.cookie);
    expect(staffItems.filter((i) => i.action === "time.create").map((i) => i.entityId)).toEqual(["t1"]); // only their own
    expect(staffItems.map((i) => i.action)).toContain("care_plan.terms");
    expect(staffItems.map((i) => i.action)).not.toContain("client.billing_update");
    const salesItems = await items(sales.cookie);
    expect(salesItems.filter((i) => i.action === "time.create").map((i) => i.entityId)).toEqual(["t3"]);
    expect(salesItems.map((i) => i.action)).not.toContain("care_plan.terms");
    expect(salesItems.map((i) => i.action)).not.toContain("client.billing_update");
    const acctItems = await items(acct.cookie);
    expect([...new Set(acctItems.map((i) => i.action))].sort()).toEqual([
      "care_plan.terms",
      "client.billing_update",
    ]);
    // newest first
    const at = ownerItems.map((i) => i.at);
    expect(at).toEqual([...at].sort((x, y) => y - x));
  });

  it("is capped at 20 rows", async () => {
    const o = await sessionFor("owner");
    const now = Date.now();
    for (let i = 0; i < 25; i++) await audit("lead.note", o.id, now - 100_000 - i);
    expect((await dash(o.cookie)).tiles.activity.items).toHaveLength(20);
  });
});

describe("the figures against a fixture", () => {
  it("leads: open by stage, new in the last 7 days, overdue next actions with the oldest five", async () => {
    const s = await sessionFor("sales");
    const now = Date.now();
    const mk = (i: number, stage: string, over: Record<string, unknown> = {}) =>
      insert("leads", {
        id: `lead-fig-${i}`,
        ref: `L-FIG${String(i).padStart(2, "0")}`,
        stage,
        lost_reason: stage === "lost" ? "price" : null,
        source: "manual",
        contact_name: `Person ${i}`,
        contact_email: `fig${i}@example.test`,
        created_at: now - 30 * 24 * HOUR,
        ...over,
      });
    await mk(1, "new", { created_at: now - HOUR });
    await mk(2, "new", { created_at: now - 3 * 24 * HOUR, next_action_at: now - 10 * HOUR });
    await mk(3, "new", { next_action_at: now + 10 * HOUR });
    await mk(4, "qualified", { next_action_at: now - 50 * HOUR });
    await mk(5, "proposal_sent", { next_action_at: now - 30 * HOUR });
    await mk(6, "won", { next_action_at: now - 70 * HOUR, created_at: now - HOUR });
    await mk(7, "lost", { next_action_at: now - 80 * HOUR });
    for (let i = 8; i <= 12; i++) await mk(i, "qualified", { next_action_at: now - (100 + i) * HOUR });
    const t = (await dash(s.cookie)).tiles.leads;
    expect(t.openByStage).toEqual({ new: 3, qualified: 6, proposal_sent: 1 });
    expect(t.open).toBe(10);
    expect(t.newLast7Days).toBe(3); // leads 1, 2 and 6: every lead created in the last 7 days, whatever its stage
    expect(t.overdue.count).toBe(8); // 2, 4, 5 and 8 to 12; not 3 (future), 6 (won), 7 (lost)
    expect(t.overdue.oldest.map((r: J) => r.ref)).toEqual([
      "L-FIG12",
      "L-FIG11",
      "L-FIG10",
      "L-FIG09",
      "L-FIG08",
    ]);
    expect(t.overdue.oldest[0]).toEqual({
      id: "lead-fig-12",
      ref: "L-FIG12",
      contactName: "Person 12",
      dueAt: expect.any(Number),
    });
  });

  it("projects and milestones", async () => {
    const o = await sessionFor("owner");
    const client = await mkClient();
    const mkP = (status: string) => mkProject(client, { status });
    const a = await mkP("active");
    await mkP("active");
    await mkP("on_hold");
    await mkP("planned");
    await mkP("completed");
    await mkP("cancelled");
    const ms = async (due: string | null, status: string, project = a.id) =>
      (await mkMilestone(project, { due_date: due, status })).id;
    const inWindow = [
      await ms(plus(0), "pending"),
      await ms(plus(3), "ready_to_bill"),
      await ms(plus(14), "pending"),
    ];
    await ms(plus(-1), "pending"); // yesterday
    await ms(plus(15), "pending"); // too far
    await ms(plus(2), "invoiced"); // already billed
    await ms(null, "pending"); // no date
    const body = await dash(o.cookie);
    expect(body.tiles.projects).toEqual({ active: 2, onHold: 1 });
    expect(body.tiles.milestones.windowDays).toBe(14);
    expect(body.tiles.milestones.count).toBe(3);
    expect(body.tiles.milestones.next.map((m: J) => m.id)).toEqual(inWindow);
    expect(body.tiles.milestones.next[0]).toMatchObject({
      projectId: a.id,
      projectCode: expect.stringMatching(/^PRJ-/),
      dueDate: plus(0),
      status: "pending",
    });
    // the first ten only
    for (let i = 0; i < 12; i++) await ms(plus(5), "pending");
    const more = (await dash(o.cookie)).tiles.milestones;
    expect(more.count).toBe(15);
    expect(more.next).toHaveLength(10);
  });

  it("my time: this week and today, billable apart, and only my own entries", async () => {
    const s = await sessionFor("staff");
    const other = await sessionFor("staff");
    const client = await mkClient();
    const p = await mkProject(client, { status: "active" });
    await mkLog(s.id, today(), 60, { project: p.id });
    await mkLog(s.id, today(), 30, { project: p.id }, { billable: 0 });
    await mkLog(other.id, today(), 120, { project: p.id });
    const t = (await dash(s.cookie)).tiles.myTime;
    expect(t.today).toEqual({ minutes: 90, billableMinutes: 60, date: today() });
    expect(t.week.minutes).toBe(90);
    expect(t.week.billableMinutes).toBe(60);
    expect(t.week.start <= today() && today() <= t.week.end).toBe(true);
    expect((await dash((await sessionFor("sales")).cookie)).tiles.myTime).toBeUndefined();
  });

  it("a plan that has not started is counted apart, not as active, and has no row [early check L3]", async () => {
    const o = await sessionFor("owner");
    const before = (await dash(o.cookie)).tiles.careBurn;
    await mkPlan(o.id, { start: plus(20), included: 600 });
    const after = (await dash(o.cookie)).tiles.careBurn;
    expect(after.counts.active).toBe(before.counts.active);
    expect(after.counts.notStarted).toBe(before.counts.notStarted + 1);
    expect(after.rows).toHaveLength(before.rows.length);
  });

  it("care-plan burn: counts, the rows by burn descending, equal to the plan page; stopped plans are not in it", async () => {
    const o = await sessionFor("owner");
    const staff = await sessionFor("staff");
    const mk = async (used: number, extra: Record<string, unknown> = {}) => {
      const plan = await mkPlan(o.id, { start: "2026-01-01", included: 600, ...extra });
      if (used) await mkLog((await sessionFor("staff")).id, today(), used, { plan: plan.id }); // one person per plan: a day holds 24 hours
      return plan;
    };
    const none = await mk(120);
    const near = await mk(495);
    const reached = await mk(600);
    const over = await mk(660);
    const nohours = await mk(60, { included: 0 }); // overage with no hours available: reached, sorted with the reached plans [review fix 4]
    const idle = await mk(0);
    const paused = await mk(300);
    await env.DB.prepare(
      "INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at) VALUES (?, ?, 'paused', ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), paused.id, plus(1), o.id, Date.now() + 5)
      .run();
    await env.DB.prepare("UPDATE care_plans SET status = 'paused' WHERE id = ?").bind(paused.id).run();
    const tile = (await dash(staff.cookie)).tiles.careBurn;
    expect(tile.counts).toMatchObject({ near: 1, reached: 3 });
    expect(tile.counts.active).toBeGreaterThanOrEqual(6);
    expect(tile.truncated).toBe(false);
    const ids = tile.rows.map((r: J) => r.planId);
    expect(ids).not.toContain(paused.id);
    const order = [over.id, reached.id, nohours.id, near.id, none.id, idle.id].filter((id) =>
      ids.includes(id),
    );
    expect(order).toHaveLength(6);
    expect(ids.filter((id: string) => order.includes(id))).toEqual(order);
    expect(tile.rows.find((r: J) => r.planId === over.id)).toMatchObject({
      used: 660,
      available: 600,
      burnBp: 11_000,
      flag: "reached",
      overageMinutes: 60,
    });
    for (const r of tile.rows as J[]) {
      const page = await json(await call(`/care-plans/${r.planId}`, { cookie: o.cookie }));
      expect(page.usage).toMatchObject({
        used: r.used,
        available: r.available,
        burnBp: r.burnBp,
        flag: r.flag,
        overageMinutes: r.overageMinutes,
      });
      expect(r.clientCode).toBeTruthy();
    }
  });

  it("the Accountant's dashboard has no care, lead or project data at all", async () => {
    const body = await dash((await sessionFor("accountant")).cookie);
    expect(JSON.stringify(body)).not.toMatch(/careBurn|openByStage|milestones|onHold/);
  });

  it("makes one D1 call for the whole dashboard", async () => {
    const { counted } = await import("./test-helpers.ts");
    const c = counted();
    const s = await sessionFor("owner");
    const before = c.calls();
    const res = await call("/dashboard", { cookie: s.cookie }, c.env);
    expect(res.status).toBe(200);
    // the session read, the batch of every tile, and the access-log write
    expect(c.calls() - before).toBe(3);
    expect(await countOf("access_log", "route = '/api/v1/dashboard'")).toBeGreaterThan(0);
  });
});
