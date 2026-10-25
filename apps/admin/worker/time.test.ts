// Time logs API [ADM-TIME-01, -02, -03]: the 24-hour day, the target, the plan being active on the work date, the 7-day lock, who sees whose
// entries, the timesheet week, and audit hygiene. The pure date and lock rules are in packages/core/test/time.test.ts; the database
// triggers are in packages/db/test/care-time.test.ts.
import { env } from "cloudflare:workers";
import { addDays, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROUTES } from "./guard.ts";
import { longSession, mkLog, mkOpenProject, mkPlan, today } from "./test-care.ts";
import { mkClient } from "./test-clients.ts";
import { bodyOf, call, countOf, one, rows, sessionFor } from "./test-helpers.ts";
import { listSql } from "./time-logs.ts";

// biome-ignore lint/suspicious/noExplicitAny: response bodies in tests are read loosely
type J = Record<string, any>;
const json = async (res: Response): Promise<J> => (await res.json()) as J;
const code = async (res: Response) => ((await bodyOf(res)) as { error: { code: string } }).error.code;
const back = (days: number, from = today()) => toIsoDate(addDays(parseIsoDate(from) as never, -days));
const DAY = 86_400_000;

afterEach(() => vi.restoreAllMocks());

const post = (cookie: string, body: Record<string, unknown>) => call("/time", { cookie, body });
const entry = (project: string, over: Record<string, unknown> = {}) => ({
  workDate: today(),
  minutes: 60,
  projectId: project,
  billable: true,
  ...over,
});
const created = async (cookie: string, project: string, over: Record<string, unknown> = {}) => {
  const res = await post(cookie, entry(project, over));
  expect(res.status, await res.clone().text()).toBe(201);
  return json(res);
};
const clock = (utc: string) => vi.spyOn(Date, "now").mockReturnValue(Date.parse(utc));

describe("POST /time [ADM-TIME-01]", () => {
  it("writes one entry for the member, with one audit row that holds ids, the date and minutes but not the note", async () => {
    const s = await sessionFor("staff");
    const p = await mkOpenProject();
    const made = await created(s.cookie, p.id, {
      minutes: 90,
      billable: false,
      note: "Secret client detail",
    });
    expect(
      await one(
        "SELECT user_id, work_date, minutes, project_id, care_plan_id, note, billable, created_at, updated_at FROM time_logs WHERE id = ?",
        made.id,
      ),
    ).toEqual({
      user_id: s.id,
      work_date: today(),
      minutes: 90,
      project_id: p.id,
      care_plan_id: null,
      note: "Secret client detail",
      billable: 0,
      created_at: made.createdAt,
      updated_at: made.createdAt,
    });
    const audit = await rows<{ action: string; entity_type: string; entity_id: string; summary: string }>(
      "SELECT action, entity_type, entity_id, summary FROM audit_log WHERE entity_id = ?",
      made.id,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "time.create", entity_type: "time_log" });
    expect(JSON.parse(audit[0]?.summary ?? "{}")).toEqual({
      timeLogId: made.id,
      userId: s.id,
      workDate: today(),
      minutes: 90,
      billable: 0,
      projectId: p.id,
      carePlanId: null,
    });
    expect(JSON.stringify(await rows("SELECT summary FROM audit_log"))).not.toContain("Secret client detail");
  });

  it("minutes: 0, 10, 1445, 1455 and non-integers are 400; 15 and 1440 are accepted", async () => {
    const s = await sessionFor("staff");
    const p = await mkOpenProject();
    const before = await countOf("time_logs");
    for (const minutes of [0, 10, 1_445, 1_455, 7.5, -15, "60", null])
      expect((await post(s.cookie, entry(p.id, { minutes }))).status, String(minutes)).toBe(400);
    expect(await countOf("time_logs")).toBe(before);
    await created(s.cookie, p.id, { minutes: 15, workDate: back(1) });
    await created(s.cookie, p.id, { minutes: 1_440, workDate: back(2) });
  });

  it("needs exactly one target, a real date, a short note and no extra fields", async () => {
    const s = await sessionFor("staff");
    const p = await mkOpenProject();
    const plan = await mkPlan(s.id);
    const before = await countOf("time_logs");
    const bad: Record<string, unknown>[] = [
      { projectId: undefined },
      { projectId: p.id, carePlanId: plan.id },
      { projectId: null, carePlanId: null },
      { workDate: "2026-02-30" },
      { workDate: "yesterday" },
      { note: "x".repeat(1_001) },
      { billable: "yes" },
      { billable: undefined },
      { createdAt: 5 },
      { id: "mine" },
    ];
    for (const over of bad)
      expect((await post(s.cookie, entry(p.id, over))).status, JSON.stringify(over)).toBe(400);
    expect(await countOf("time_logs")).toBe(before);
    await created(s.cookie, p.id, { note: "x".repeat(1_000) });
  });

  it("refuses 1,440 minutes already logged plus 15 with 409 day_cap, and a second person's day is their own", async () => {
    const a = await sessionFor("staff");
    const b = await sessionFor("sales");
    const p = await mkOpenProject();
    await created(a.cookie, p.id, { minutes: 1_440 });
    const res = await post(a.cookie, entry(p.id, { minutes: 15 }));
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("day_cap");
    await created(b.cookie, p.id, { minutes: 1_440 });
    expect(await countOf("time_logs", "user_id = ?", a.id)).toBe(1);
    expect(await countOf("audit_log", "action = 'time.create' AND actor_id = ?", a.id)).toBe(1);
  });

  it("10 parallel 180-minute entries on one day: exactly 8 succeed", async () => {
    const s = await sessionFor("staff");
    const p = await mkOpenProject();
    const day = back(3);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => post(s.cookie, entry(p.id, { minutes: 180, workDate: day }))),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(8);
    const refused = results.filter((r) => r.status !== 201);
    expect(refused).toHaveLength(2);
    for (const r of refused) expect(await code(r)).toBe("day_cap");
    expect(
      (
        await one<{ n: number }>(
          "SELECT sum(minutes) AS n FROM time_logs WHERE user_id = ? AND work_date = ?",
          s.id,
          day,
        )
      )?.n,
    ).toBe(1_440);
    expect(await countOf("audit_log", "action = 'time.create' AND actor_id = ?", s.id)).toBe(8);
  });

  it("a cancelled project is 409 project_closed; planned, active, on hold and completed ones take time", async () => {
    const s = await sessionFor("staff");
    for (const status of ["planned", "active", "on_hold", "completed"]) {
      const p = await mkOpenProject(status);
      await created(s.cookie, p.id, { minutes: 15, workDate: back(5) });
    }
    const dead = await mkOpenProject("cancelled");
    const res = await post(s.cookie, entry(dead.id));
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("project_closed");
    expect((await post(s.cookie, entry("no-such-project"))).status).toBe(404);
    expect(
      (await post(s.cookie, { ...entry("x"), projectId: null, carePlanId: "no-such-plan" })).status,
    ).toBe(404);
  });

  it("an anonymised individual's project or plan takes no new time", async () => {
    const s = await sessionFor("staff");
    const p = await mkOpenProject();
    const plan = await mkPlan(s.id);
    for (const client of [p.clientId, plan.client])
      await env.DB.prepare("UPDATE clients SET anonymised_at = ?2 WHERE id = ?1")
        .bind(client, Date.now())
        .run();
    const a = await post(s.cookie, entry(p.id));
    expect(await code(a)).toBe("client_anonymised");
    const b = await post(s.cookie, { workDate: today(), minutes: 60, carePlanId: plan.id, billable: true });
    expect(await code(b)).toBe("client_anonymised");
  });

  it("a care-plan entry needs the plan active on the work date: the day before a pause is accepted, the pause day is not", async () => {
    const o = await sessionFor("owner");
    const plan = await mkPlan(o.id, { start: back(30) });
    const onPlan = (date: string) =>
      post(o.cookie, { workDate: date, minutes: 60, carePlanId: plan.id, billable: true });
    expect((await onPlan(back(29))).status).toBe(201);
    expect((await onPlan(back(31))).status).toBe(409); // before the start
    expect(await code(await onPlan(back(31)))).toBe("plan_not_active");
    // paused from 5 days back, resumed 2 days back (history rows, as the status route would write them)
    const row = async (status: string, on: string, ms: number) => {
      await env.DB.prepare(
        "INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), plan.id, status, on, o.id, ms)
        .run();
    };
    await row("paused", back(5), Date.now() + 1);
    await row("active", back(2), Date.now() + 2);
    expect((await onPlan(back(6))).status).toBe(201);
    for (const d of [back(5), back(4), back(3)])
      expect(await code(await onPlan(d)), d).toBe("plan_not_active");
    expect((await onPlan(back(2))).status).toBe(201);
    // pause and resume the same day: that day is active
    await row("paused", back(1), Date.now() + 3);
    await row("active", back(1), Date.now() + 4);
    expect((await onPlan(back(1))).status).toBe(201);
    // moving an entry onto a paused date is refused; moving it to an active date is not
    const moved = await json(await onPlan(back(7)));
    const into = await call(`/time/${moved.id}`, {
      cookie: o.cookie,
      method: "PATCH",
      body: { expectedUpdatedAt: moved.updatedAt, workDate: back(4) },
    });
    expect(into.status).toBe(409);
    expect(await code(into)).toBe("plan_not_active");
    expect(
      (
        await call(`/time/${moved.id}`, {
          cookie: o.cookie,
          method: "PATCH",
          body: { expectedUpdatedAt: moved.updatedAt, workDate: back(6) },
        })
      ).status,
    ).toBe(200);
  });

  it("a cancelled plan takes no time from the cancellation day", async () => {
    const o = await sessionFor("owner");
    const plan = await mkPlan(o.id, { start: back(30) });
    await env.DB.prepare(
      "INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at) VALUES (?, ?, 'cancelled', ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), plan.id, back(3), o.id, Date.now() + 1)
      .run();
    const onPlan = (date: string) =>
      post(o.cookie, { workDate: date, minutes: 60, carePlanId: plan.id, billable: true });
    expect((await onPlan(back(4))).status).toBe(201);
    expect(await code(await onPlan(back(3)))).toBe("plan_not_active");
    expect(await code(await onPlan(today()))).toBe("plan_not_active");
  });

  it("dates: seven days back is accepted, eight is the owner's; tomorrow is 400 for everyone", async () => {
    const staff = await sessionFor("staff");
    const sales = await sessionFor("sales");
    const owner = await sessionFor("owner");
    const p = await mkOpenProject();
    await created(staff.cookie, p.id, { workDate: back(7), minutes: 15 });
    for (const s of [staff, sales]) {
      const res = await post(s.cookie, entry(p.id, { workDate: back(8), minutes: 15 }));
      expect(res.status).toBe(403);
      expect(await code(res)).toBe("owner_only_date");
    }
    await created(owner.cookie, p.id, { workDate: back(8), minutes: 15 });
    await created(owner.cookie, p.id, { workDate: back(400), minutes: 15 });
    for (const s of [staff, owner]) {
      const res = await post(s.cookie, entry(p.id, { workDate: back(-1) }));
      expect(res.status).toBe(400);
      expect(await code(res)).toBe("future_date");
    }
  });

  it("the date is the IST date: 2026-11-30 18:29:59.999 UTC is still 30 November, 18:30:00.000 UTC is 1 December", async () => {
    const s = await longSession("staff");
    const p = await mkOpenProject();
    clock("2026-11-30T18:29:59.999Z");
    expect((await post(s.cookie, entry(p.id, { workDate: "2026-11-30", minutes: 15 }))).status).toBe(201);
    expect(await code(await post(s.cookie, entry(p.id, { workDate: "2026-12-01", minutes: 15 })))).toBe(
      "future_date",
    );
    clock("2026-11-30T18:30:00.000Z");
    expect((await post(s.cookie, entry(p.id, { workDate: "2026-12-01", minutes: 15 }))).status).toBe(201);
    expect(await code(await post(s.cookie, entry(p.id, { workDate: "2026-12-02", minutes: 15 })))).toBe(
      "future_date",
    );
    // seven days back is counted in IST days too
    expect((await post(s.cookie, entry(p.id, { workDate: "2026-11-24", minutes: 15 }))).status).toBe(201);
    expect(await code(await post(s.cookie, entry(p.id, { workDate: "2026-11-23", minutes: 15 })))).toBe(
      "owner_only_date",
    );
  });

  it("logging for someone else: Staff and Sales get 403, the Accountant 403, the Owner may, but not for an inactive member (400)", async () => {
    const owner = await sessionFor("owner");
    const staff = await sessionFor("staff");
    const sales = await sessionFor("sales");
    const acct = await sessionFor("accountant");
    const other = await sessionFor("staff");
    const p = await mkOpenProject();
    for (const s of [staff, sales])
      expect((await post(s.cookie, entry(p.id, { userId: other.id }))).status).toBe(403);
    expect((await post(acct.cookie, entry(p.id))).status).toBe(403);
    expect((await post("", entry(p.id))).status).toBe(401);
    expect((await post(staff.cookie, entry(p.id, { userId: staff.id }))).status).toBe(201); // naming yourself is fine
    const made = await created(owner.cookie, p.id, { userId: other.id, minutes: 30 });
    expect((await one("SELECT user_id FROM time_logs WHERE id = ?", made.id))?.user_id).toBe(other.id);
    expect((await one("SELECT actor_id FROM audit_log WHERE entity_id = ?", made.id))?.actor_id).toBe(
      owner.id,
    );
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?").bind(other.id).run();
    const res = await post(owner.cookie, entry(p.id, { userId: other.id }));
    expect(res.status).toBe(400);
    expect(await code(res)).toBe("bad_user");
    expect((await post(owner.cookie, entry(p.id, { userId: "no-such-member" }))).status).toBe(400);
  });
});

describe("PATCH and DELETE /time/:id [ADM-TIME-03]", () => {
  const patch = (cookie: string, id: string, body: Record<string, unknown>) =>
    call(`/time/${id}`, { cookie, method: "PATCH", body });
  const del = (cookie: string, id: string, v: number) =>
    call(`/time/${id}?expectedUpdatedAt=${v}`, { cookie, method: "DELETE" });

  it("the author edits and deletes their own entry; one audit row each; the version moves", async () => {
    const s = await sessionFor("staff");
    const p = await mkOpenProject();
    const made = await created(s.cookie, p.id, { minutes: 60, note: "first" });
    const res = await json(
      await patch(s.cookie, made.id, {
        expectedUpdatedAt: made.updatedAt,
        minutes: 90,
        note: "second",
        billable: false,
      }),
    );
    expect(res).toMatchObject({ ok: true, changed: true, lockOverride: false });
    expect(res.updatedAt).toBeGreaterThan(made.updatedAt);
    expect(await one("SELECT minutes, note, billable FROM time_logs WHERE id = ?", made.id)).toEqual({
      minutes: 90,
      note: "second",
      billable: 0,
    });
    const audit = await rows<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE entity_id = ? AND action = 'time.update'",
      made.id,
    );
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.summary ?? "{}")).toMatchObject({
      timeLogId: made.id,
      userId: s.id,
      changed: ["minutes", "note", "billable"],
      minutes: 90,
    });
    expect(audit[0]?.summary).not.toContain("second");
    expect(
      (await json(await patch(s.cookie, made.id, { expectedUpdatedAt: res.updatedAt, minutes: 90 }))).changed,
    ).toBe(false);
    const gone = await json(await del(s.cookie, made.id, res.updatedAt));
    expect(gone).toMatchObject({ ok: true, lockOverride: false });
    expect(await countOf("time_logs", "id = ?", made.id)).toBe(0);
    const delAudit = await rows<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE entity_id = ? AND action = 'time.delete'",
      made.id,
    );
    expect(delAudit).toHaveLength(1);
    expect(JSON.parse(delAudit[0]?.summary ?? "{}")).toMatchObject({ timeLogId: made.id, minutes: 90 });
    expect(delAudit[0]?.summary).not.toContain("second");
  });

  it("a stale version is 409 stale_version on PATCH and on DELETE; a made-up id is 404; DELETE needs the version", async () => {
    const s = await sessionFor("staff");
    const p = await mkOpenProject();
    const made = await created(s.cookie, p.id);
    for (const res of [
      await patch(s.cookie, made.id, { expectedUpdatedAt: made.updatedAt - 1, minutes: 30 }),
      await del(s.cookie, made.id, made.updatedAt - 1),
    ]) {
      expect(res.status).toBe(409);
      expect(await code(res)).toBe("stale_version");
    }
    expect((await patch(s.cookie, "nope", { expectedUpdatedAt: 1, minutes: 30 })).status).toBe(404);
    expect((await del(s.cookie, "nope", 1)).status).toBe(404);
    expect((await call(`/time/${made.id}`, { cookie: s.cookie, method: "DELETE" })).status).toBe(400);
    expect((await patch(s.cookie, made.id, { expectedUpdatedAt: made.updatedAt, minutes: 31 })).status).toBe(
      400,
    );
    expect((await patch(s.cookie, made.id, { expectedUpdatedAt: made.updatedAt, userId: "x" })).status).toBe(
      400,
    );
    expect(await countOf("time_logs", "id = ?", made.id)).toBe(1);
  });

  it("another person's entry is 404 for Staff and Sales (never 403), and the Accountant cannot write at all", async () => {
    const author = await sessionFor("staff");
    const p = await mkOpenProject();
    const made = await created(author.cookie, p.id);
    for (const role of ["staff", "sales"] as const) {
      const s = await sessionFor(role);
      expect(
        (await patch(s.cookie, made.id, { expectedUpdatedAt: made.updatedAt, minutes: 30 })).status,
        role,
      ).toBe(404);
      expect((await del(s.cookie, made.id, made.updatedAt)).status, role).toBe(404);
    }
    const acct = await sessionFor("accountant");
    expect(
      (await patch(acct.cookie, made.id, { expectedUpdatedAt: made.updatedAt, minutes: 30 })).status,
    ).toBe(403);
    expect((await del(acct.cookie, made.id, made.updatedAt)).status).toBe(403);
    expect(await one("SELECT minutes FROM time_logs WHERE id = ?", made.id)).toEqual({ minutes: 60 });
  });

  it("the lock: the author can edit up to 7 days from creation less a millisecond, then 403 time_locked; the owner always may, and the audit row says so", async () => {
    const author = await longSession("staff");
    const owner = await longSession("owner");
    const p = await mkOpenProject();
    const base = Date.now();
    const e = await mkLog(author.id, today(), 60, { project: p.id }, { created_at: base, updated_at: base });
    clock(new Date(base + 7 * DAY - 1).toISOString());
    const ok = await patch(author.cookie, e.id, { expectedUpdatedAt: e.updatedAt, minutes: 75 });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const v = (await json(ok)).updatedAt as number;
    clock(new Date(base + 7 * DAY).toISOString());
    for (const res of [
      await patch(author.cookie, e.id, { expectedUpdatedAt: v, minutes: 30 }),
      await del(author.cookie, e.id, v),
    ]) {
      expect(res.status).toBe(403);
      expect(await code(res)).toBe("time_locked");
    }
    expect((await one("SELECT minutes FROM time_logs WHERE id = ?", e.id))?.minutes).toBe(75);
    const over = await json(await patch(owner.cookie, e.id, { expectedUpdatedAt: v, minutes: 45 }));
    expect(over).toMatchObject({ ok: true, lockOverride: true });
    const audit = await rows<{ summary: string; actor_id: string }>(
      "SELECT summary, actor_id FROM audit_log WHERE entity_id = ? AND action = 'time.update' ORDER BY at, id",
      e.id,
    );
    expect(audit).toHaveLength(2);
    expect(JSON.parse(audit[0]?.summary ?? "{}").lockOverride).toBeUndefined();
    expect(JSON.parse(audit[1]?.summary ?? "{}")).toMatchObject({ lockOverride: true, userId: author.id });
    expect(audit[1]?.actor_id).toBe(owner.id);
    const gone = await json(await del(owner.cookie, e.id, over.updatedAt));
    expect(gone.lockOverride).toBe(true);
    expect(
      JSON.parse(
        (
          await one<{ summary: string }>(
            "SELECT summary FROM audit_log WHERE entity_id = ? AND action = 'time.delete'",
            e.id,
          )
        )?.summary ?? "{}",
      ).lockOverride,
    ).toBe(true);
  });

  it("moving an entry: the date rules apply, the new day must have room, and it can switch target", async () => {
    const s = await sessionFor("staff");
    const p = await mkOpenProject();
    const q = await mkOpenProject();
    const full = await created(s.cookie, p.id, { minutes: 1_440, workDate: back(1) });
    const e = await created(s.cookie, p.id, { minutes: 30, workDate: back(2) });
    const into = await patch(s.cookie, e.id, { expectedUpdatedAt: e.updatedAt, workDate: back(1) });
    expect(await code(into)).toBe("day_cap");
    expect(
      await code(await patch(s.cookie, e.id, { expectedUpdatedAt: e.updatedAt, workDate: back(9) })),
    ).toBe("owner_only_date");
    expect(
      await code(await patch(s.cookie, e.id, { expectedUpdatedAt: e.updatedAt, workDate: back(-1) })),
    ).toBe("future_date");
    expect(await code(await patch(s.cookie, e.id, { expectedUpdatedAt: e.updatedAt, minutes: 1_455 }))).toBe(
      "bad_request",
    );
    expect(full.id).toBeTruthy();
    const sw = await patch(s.cookie, e.id, { expectedUpdatedAt: e.updatedAt, projectId: q.id });
    expect(sw.status, await sw.clone().text()).toBe(200);
    expect(await one("SELECT project_id, care_plan_id FROM time_logs WHERE id = ?", e.id)).toEqual({
      project_id: q.id,
      care_plan_id: null,
    });
    const v = (await json(sw)).updatedAt as number;
    expect((await patch(s.cookie, e.id, { expectedUpdatedAt: v, projectId: null })).status).toBe(400); // a target is required
    expect(
      (await patch(s.cookie, e.id, { expectedUpdatedAt: v, projectId: q.id, carePlanId: "x" })).status,
    ).toBe(400);
    const dead = await mkOpenProject("cancelled");
    expect(await code(await patch(s.cookie, e.id, { expectedUpdatedAt: v, projectId: dead.id }))).toBe(
      "project_closed",
    );
  });
});

describe("a cancelled project takes no change of time, only a note [early check M1]", () => {
  const patch = (cookie: string, id: string, body: Record<string, unknown>) =>
    call(`/time/${id}`, { cookie, method: "PATCH", body });
  it("minutes, billable and date changes are 409 project_closed; a note edit and DELETE are 200", async () => {
    const s = await sessionFor("staff");
    const p = await mkOpenProject();
    const e = await created(s.cookie, p.id, { minutes: 60, note: "n" });
    await env.DB.prepare("UPDATE projects SET status = 'cancelled' WHERE id = ?").bind(p.id).run();
    const v = e.updatedAt as number;
    for (const fields of [{ minutes: 75 }, { billable: false }, { workDate: back(1) }]) {
      const res = await patch(s.cookie, e.id, { expectedUpdatedAt: v, ...fields });
      expect(res.status, JSON.stringify(fields)).toBe(409);
      expect(await code(res)).toBe("project_closed");
    }
    expect(await one("SELECT minutes, billable, work_date FROM time_logs WHERE id = ?", e.id)).toEqual({
      minutes: 60,
      billable: 1,
      work_date: today(),
    });
    const note = await patch(s.cookie, e.id, { expectedUpdatedAt: v, note: "still fine" });
    expect(note.status, await note.clone().text()).toBe(200);
    const v2 = (await json(note)).updatedAt as number;
    const del = await call(`/time/${e.id}?expectedUpdatedAt=${v2}`, { cookie: s.cookie, method: "DELETE" });
    expect(del.status, await del.clone().text()).toBe(200);
  });

  it("a plan entry: minutes change on a plan paused before its work date is 409 plan_not_active, a note edit is 200", async () => {
    const s = await sessionFor("staff");
    const plan = await mkPlan(s.id, { start: back(30) });
    const res = await post(s.cookie, { workDate: today(), minutes: 30, carePlanId: plan.id, billable: true });
    expect(res.status, await res.clone().text()).toBe(201);
    const made = await json(res);
    await env.DB.prepare(
      "INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at) VALUES (?, ?, 'paused', ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), plan.id, today(), s.id, Date.now())
      .run();
    const bad = await patch(s.cookie, made.id, { expectedUpdatedAt: made.updatedAt, minutes: 45 });
    expect(bad.status).toBe(409);
    expect(await code(bad)).toBe("plan_not_active");
    const ok = await patch(s.cookie, made.id, { expectedUpdatedAt: made.updatedAt, note: "just a note" });
    expect(ok.status, await ok.clone().text()).toBe(200);
  });
});

describe("reading time [ADM-TIME-02]", () => {
  it("Staff and Sales see only their own entries; asking for another person is 403; a deep scan finds no one else", async () => {
    const a = await sessionFor("staff", { name: "Alma Own" });
    const b = await sessionFor("staff", { name: "Bruno Other" });
    const c = await sessionFor("sales", { name: "Cleo Other" });
    const p = await mkOpenProject();
    await created(a.cookie, p.id, { minutes: 60, note: "alma note" });
    await created(b.cookie, p.id, { minutes: 45, note: "bruno secret note" });
    await created(c.cookie, p.id, { minutes: 30, note: "cleo secret note" });
    const people = [
      { who: a, name: "Alma Own", note: "alma note" },
      { who: b, name: "Bruno Other", note: "bruno secret note" },
      { who: c, name: "Cleo Other", note: "cleo secret note" },
    ];
    for (const viewer of [a, c]) {
      const parts = [
        await json(await call("/time", { cookie: viewer.cookie })),
        await json(await call("/time/week", { cookie: viewer.cookie })),
        await json(await call("/time/people", { cookie: viewer.cookie })),
        await json(await call("/time/targets", { cookie: viewer.cookie })),
        await json(await call("/dashboard", { cookie: viewer.cookie })),
      ];
      const text = JSON.stringify(parts);
      for (const other of people.filter((x) => x.who !== viewer)) {
        expect(text, `${viewer.role} sees ${other.name}`).not.toContain(other.who.id);
        expect(text).not.toContain(other.name);
        expect(text).not.toContain(other.note);
        expect((await call(`/time?userId=${other.who.id}`, { cookie: viewer.cookie })).status).toBe(403);
        expect((await call(`/time/week?userId=${other.who.id}`, { cookie: viewer.cookie })).status).toBe(403);
      }
      expect(
        (await json(await call(`/time?userId=${viewer.id}`, { cookie: viewer.cookie }))).entries,
      ).toHaveLength(1);
      const me = people.find((x) => x.who === viewer);
      expect(parts[2]?.people).toEqual([{ id: viewer.id, name: me?.name }]);
    }
  });

  it("the Owner and the Accountant read everyone's entries and can filter by person, project, plan and billable", async () => {
    const o = await sessionFor("owner");
    const a = await sessionFor("accountant");
    const s1 = await sessionFor("staff", { name: "Dev One" });
    const s2 = await sessionFor("staff", { name: "Dev Two" });
    const p = await mkOpenProject();
    const plan = await mkPlan(o.id, { start: back(60) });
    const date = back(1);
    await mkLog(s1.id, date, 60, { project: p.id });
    await mkLog(s2.id, date, 30, { plan: plan.id }, { billable: 0, note: "plan work" });
    for (const viewer of [o, a]) {
      const all = await json(await call(`/time?from=${date}&to=${date}`, { cookie: viewer.cookie }));
      const mine = all.entries.filter((e: J) => [s1.id, s2.id].includes(e.userId));
      expect(mine).toHaveLength(2);
      expect(mine.find((e: J) => e.userId === s2.id)).toMatchObject({
        userName: "Dev Two",
        carePlanId: plan.id,
        carePlanTier: "growth",
        billable: false,
        note: "plan work",
      });
      expect(mine.find((e: J) => e.userId === s1.id)).toMatchObject({
        userName: "Dev One",
        projectId: p.id,
        projectCode: expect.stringMatching(/^PRJ-/),
      });
      expect(
        (await json(await call(`/time?from=${date}&to=${date}&userId=${s1.id}`, { cookie: viewer.cookie })))
          .entries,
      ).toHaveLength(1);
      expect(
        (await json(await call(`/time?from=${date}&to=${date}&projectId=${p.id}`, { cookie: viewer.cookie })))
          .entries,
      ).toHaveLength(1);
      expect(
        (
          await json(
            await call(`/time?from=${date}&to=${date}&carePlanId=${plan.id}`, { cookie: viewer.cookie }),
          )
        ).entries,
      ).toHaveLength(1);
      expect(
        (
          await json(
            await call(`/time?from=${date}&to=${date}&billable=0&carePlanId=${plan.id}`, {
              cookie: viewer.cookie,
            }),
          )
        ).entries,
      ).toHaveLength(1);
      expect(
        (
          await json(
            await call(`/time?from=${date}&to=${date}&billable=1&carePlanId=${plan.id}`, {
              cookie: viewer.cookie,
            }),
          )
        ).entries,
      ).toHaveLength(0);
    }
    expect(
      (await json(await call("/time/people", { cookie: a.cookie }))).people.length,
    ).toBeGreaterThanOrEqual(3);
    // the accountant reads but cannot log, and has no target list
    expect((await call("/time/targets", { cookie: a.cookie })).status).toBe(403);
  });

  it("pages newest day first without a repeat or a gap; the range is 366 days at most; the default is the last 30 days", async () => {
    const s = await sessionFor("staff");
    const p = await mkOpenProject();
    for (let i = 0; i < 53; i++) await mkLog(s.id, back(i % 29), 15, { project: p.id });
    const first = await json(await call("/time?limit=50", { cookie: s.cookie }));
    expect(first.entries).toHaveLength(50);
    expect(first.range).toEqual({ from: back(29), to: today() });
    const second = await json(await call(`/time?limit=50&after=${first.next}`, { cookie: s.cookie }));
    expect(second.entries).toHaveLength(3);
    expect(second.next).toBeNull();
    const ids = [...first.entries, ...second.entries].map((e: J) => e.id);
    expect(new Set(ids).size).toBe(53);
    const dates = [...first.entries, ...second.entries].map((e: J) => e.workDate);
    expect(dates).toEqual([...dates].sort().reverse());
    const prev = await json(await call(`/time?limit=50&before=${second.prev}`, { cookie: s.cookie }));
    expect(prev.entries.map((e: J) => e.id)).toEqual(first.entries.map((e: J) => e.id));
    expect((await call(`/time?from=${back(367)}&to=${today()}`, { cookie: s.cookie })).status).toBe(400);
    expect((await call(`/time?from=${back(366)}&to=${today()}`, { cookie: s.cookie })).status).toBe(200);
    expect((await call(`/time?from=${today()}&to=${back(1)}`, { cookie: s.cookie })).status).toBe(400);
    expect((await call("/time?after=junk", { cookie: s.cookie })).status).toBe(400);
    expect((await call(`/time?after=${first.next}&before=${first.next}`, { cookie: s.cookie })).status).toBe(
      400,
    );
    expect((await call("/time?billable=maybe", { cookie: s.cookie })).status).toBe(400);
  });

  it("each entry says whether the viewer can still edit it", async () => {
    const s = await longSession("staff");
    const o = await longSession("owner");
    const p = await mkOpenProject();
    const date = back(1);
    const old = Date.now() - 8 * DAY;
    await mkLog(s.id, date, 30, { project: p.id }, { created_at: old, updated_at: old });
    await mkLog(s.id, date, 45, { project: p.id });
    const mineS = (await json(await call(`/time?from=${date}&to=${date}`, { cookie: s.cookie })))
      .entries as J[];
    expect(mineS.map((e) => [e.minutes, e.canEdit]).sort()).toEqual([
      [30, false],
      [45, true],
    ]);
    const asOwner = (
      await json(await call(`/time?from=${date}&to=${date}&userId=${s.id}`, { cookie: o.cookie }))
    ).entries as J[];
    expect(asOwner.every((e) => e.canEdit)).toBe(true);
    const acct = (
      await json(
        await call(`/time?from=${date}&to=${date}&userId=${s.id}`, {
          cookie: (await sessionFor("accountant")).cookie,
        }),
      )
    ).entries as J[];
    expect(acct.every((e) => e.canEdit === false)).toBe(true);
  });

  it("the timesheet week: Monday to Sunday, grouped by person, target and date, with day totals that add up", async () => {
    const o = await sessionFor("owner");
    const u1 = await sessionFor("staff");
    const u2 = await sessionFor("staff");
    const p = await mkOpenProject();
    const plan = await mkPlan(o.id, { start: "2026-01-01" });
    const monday = "2026-03-02"; // a Monday
    await mkLog(u1.id, "2026-03-02", 60, { project: p.id });
    await mkLog(u1.id, "2026-03-02", 30, { project: p.id }, { billable: 0 });
    await mkLog(u1.id, "2026-03-04", 120, { plan: plan.id });
    await mkLog(u2.id, "2026-03-08", 45, { project: p.id }); // Sunday
    await mkLog(u2.id, "2026-03-09", 105, { project: p.id }); // next week
    await mkLog(u2.id, "2026-02-28", 105, { project: p.id }); // last week
    const week = await json(await call(`/time/week?start=${monday}`, { cookie: o.cookie }));
    expect(week.week).toEqual({ start: monday, end: "2026-03-08" });
    const mine = week.groups.filter((g: J) => [u1.id, u2.id].includes(g.userId));
    expect(mine).toHaveLength(3);
    expect(mine.find((g: J) => g.userId === u1.id && g.workDate === "2026-03-02")).toMatchObject({
      minutes: 90,
      billableMinutes: 60,
      entries: 2,
      projectId: p.id,
    });
    expect(mine.find((g: J) => g.carePlanId === plan.id)).toMatchObject({
      minutes: 120,
      workDate: "2026-03-04",
    });
    const days = Object.fromEntries(week.dayTotals.map((d: J) => [d.workDate, d.minutes]));
    expect(days["2026-03-02"]).toBe(90);
    expect(days["2026-03-08"]).toBe(45);
    expect(days["2026-03-09"]).toBeUndefined();
    expect(week.totalMinutes).toBe(Object.values(days).reduce((a, b) => (a as number) + (b as number), 0));
    expect(week.truncated).toBe(false);
    const filtered = await json(
      await call(`/time/week?start=${monday}&userId=${u1.id}`, { cookie: o.cookie }),
    );
    expect(filtered.totalMinutes).toBe(210);
    expect((await call("/time/week?start=2026-03-03", { cookie: o.cookie })).status).toBe(400); // not a Monday
    expect((await call("/time/week?start=junk", { cookie: o.cookie })).status).toBe(400);
  });

  it("week totals equal the sum of the entries, whatever the entries are (seeded random cases; fast-check is not an admin dependency)", async () => {
    const o = await sessionFor("owner");
    const p = await mkOpenProject();
    const monday = "2026-04-06";
    let seed = 20_261_025;
    const rand = (n: number) => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0; // a small linear congruential generator: the same cases every run
      return seed % n;
    };
    for (let run = 0; run < 12; run++) {
      const u = await sessionFor("staff");
      const perDay = new Map<number, number>();
      for (let i = rand(13); i > 0; i--) {
        const day = rand(11) - 2; // two days before the week to two days after it
        const minutes = (rand(12) + 1) * 15;
        if ((perDay.get(day) ?? 0) + minutes > 1_440) continue;
        perDay.set(day, (perDay.get(day) ?? 0) + minutes);
        await mkLog(
          u.id,
          toIsoDate(addDays(parseIsoDate(monday) as never, day)),
          minutes,
          { project: p.id },
          { billable: rand(2) },
        );
      }
      const week = await json(await call(`/time/week?start=${monday}&userId=${u.id}`, { cookie: o.cookie }));
      const inWeek = [...perDay].filter(([d]) => d >= 0 && d <= 6).reduce((n, [, m]) => n + m, 0);
      expect(week.totalMinutes, `run ${run}`).toBe(inWeek);
      expect(week.groups.reduce((n: number, g: J) => n + g.minutes, 0)).toBe(inWeek);
      expect(week.dayTotals.reduce((n: number, d: J) => n + d.minutes, 0)).toBe(inWeek);
    }
  });

  it("targets: projects that are not cancelled and plans active today, found by the start of a code or a name", async () => {
    const s = await sessionFor("staff");
    const o = await sessionFor("owner");
    const client = await mkClient({ code: "ZQX1", display_name: "Zebra Quartz Exports" });
    const open = await mkOpenProject("active", client);
    const done = await mkOpenProject("completed", client);
    const dead = await mkOpenProject("cancelled", client);
    const plan = await mkPlan(o.id, { clientId: client, start: back(10) });
    const idle = await mkPlan(o.id, { start: back(10) });
    await env.DB.prepare(
      "INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at) VALUES (?, ?, 'paused', ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), idle.id, back(2), o.id, Date.now() + 1)
      .run();
    const future = await mkPlan(o.id, { start: toIsoDate(addDays(parseIsoDate(today()) as never, 10)) });
    const t = await json(await call(`/time/targets?q=zqx`, { cookie: s.cookie }));
    expect(t.carePlans.map((p: J) => p.id)).toEqual([plan.id]);
    expect(t.carePlans[0]).toMatchObject({
      clientCode: "ZQX1",
      clientName: "Zebra Quartz Exports",
      tier: "growth",
    });
    const byName = await json(await call(`/time/targets?q=Zebra`, { cookie: s.cookie }));
    expect(byName.carePlans.map((p: J) => p.id)).toEqual([plan.id]);
    const all = await json(await call("/time/targets", { cookie: s.cookie }));
    const projectIds = all.projects.map((p: J) => p.id);
    expect(projectIds).toEqual(expect.arrayContaining([open.id, done.id]));
    expect(projectIds).not.toContain(dead.id);
    const allPlans = all.carePlans.map((p: J) => p.id);
    expect(allPlans).toContain(plan.id);
    expect(allPlans).not.toContain(idle.id);
    expect(allPlans).not.toContain(future.id);
    expect(all.projects.length).toBeLessThanOrEqual(20);
    expect(all.carePlans.length).toBeLessThanOrEqual(20);
    const byCode = await json(await call(`/time/targets?q=${open.id}`, { cookie: s.cookie }));
    expect(byCode.projects).toEqual([]);
    const code = (await one<{ code: string }>("SELECT code FROM projects WHERE id = ?", open.id))?.code ?? "";
    expect(
      (await json(await call(`/time/targets?q=${code}`, { cookie: s.cookie }))).projects.map((p: J) => p.id),
    ).toEqual([open.id]);
  });
});

describe("the time routes", () => {
  it("are declared, with the audit actions of the writes", () => {
    const time = ROUTES.filter((r) => r.path.startsWith("/api/v1/time"));
    expect(
      time.map((r) => `${r.method} ${r.path.replace("/api/v1", "")} ${r.access} ${r.audit ?? ""}`.trim()),
    ).toEqual([
      "GET /time time.read",
      "GET /time/week time.read",
      "GET /time/targets time.writeOwn",
      "GET /time/people time.read",
      "POST /time time.writeOwn time.create",
      "PATCH /time/:id time.writeOwn time.update",
      "DELETE /time/:id time.writeOwn time.delete",
    ]);
  });

  it("the list is served by an index, never a scan of time_logs", async () => {
    const cases: [string[], unknown[]][] = [
      [["t.work_date BETWEEN ?1 AND ?2"], ["2026-01-01", "2026-01-31"]],
      [
        ["t.work_date BETWEEN ?1 AND ?2", "t.user_id = ?3"],
        ["2026-01-01", "2026-01-31", "u"],
      ],
      [
        ["t.work_date BETWEEN ?1 AND ?2", "t.project_id = ?3"],
        ["2026-01-01", "2026-01-31", "p"],
      ],
      [
        ["t.work_date BETWEEN ?1 AND ?2", "t.care_plan_id = ?3"],
        ["2026-01-01", "2026-01-31", "c"],
      ],
      [
        ["t.work_date BETWEEN ?1 AND ?2", "(t.work_date, t.id) < (?3, ?4)"],
        ["2026-01-01", "2026-01-31", "2026-01-15", "x"],
      ],
    ];
    for (const [where, bind] of cases) {
      const sql = listSql(where, "t.work_date DESC, t.id DESC", 25);
      const plan = (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...bind))
        .map((r) => r.detail)
        .join("\n");
      expect(plan, where.join(" AND ")).not.toMatch(/SCAN t\b/);
      expect(plan).toMatch(/SEARCH t USING (COVERING )?INDEX/);
    }
  });
});
