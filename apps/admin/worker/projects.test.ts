// Projects, milestones and notes API [ADM-PRJ-01..03, -05, ADM-G-05, ADM-CLI-03]: codes, the status machines, milestone rules, notes
// and who may touch them, the role matrix, audit hygiene and the plans of the lists. Files are in vault.test.ts.
import { env } from "cloudflare:workers";
import { decide, ROLES } from "@techaust/core/permissions";
import { PROJECT_STATUSES, PROJECT_TRANSITIONS } from "@techaust/core/projects";
import { describe, expect, it } from "vitest";
import { ROUTES } from "./guard.ts";
import { noteListSql } from "./notes.ts";
import { projectListSql } from "./projects.ts";
import { PROJECTS_SQL } from "./search.ts";
import { mkClient } from "./test-clients.ts";
import { bodyOf, call, countOf, one, rows, sessionFor } from "./test-helpers.ts";
import { mkFile, mkMilestone, mkNote, mkProject } from "./test-projects.ts";

// biome-ignore lint/suspicious/noExplicitAny: response bodies in tests are read loosely
type J = Record<string, any>;
const json = async (res: Response): Promise<J> => (await res.json()) as J;
const owner = () => sessionFor("owner", { stepUp: true });
const code = async (res: Response) => ((await bodyOf(res)) as { error: { code: string } }).error.code;
const create = async (cookie: string, body: Record<string, unknown>) => {
  const res = await call("/projects", { cookie, body });
  expect(res.status, await res.clone().text()).toBe(201);
  return json(res);
};

// ---------------------------------------------------------------------------------------------------------------
describe("POST /projects [ADM-PRJ-01]", () => {
  it("creates a planned project in the client's currency with the next code, and one audit row", async () => {
    const o = await owner();
    const clientId = await mkClient({
      currency: "USD",
      gst_status: "overseas",
      state_code: null,
      country: "US",
    });
    const made = await create(o.cookie, { clientId, name: "Site rebuild", budgetMinor: 500_000 });
    expect(made.code).toMatch(/^PRJ-\d{4,}$/);
    const row = await one(
      "SELECT code, client_id, name, status, currency, budget_minor, source_document_id FROM projects WHERE id = ?",
      made.id,
    );
    expect(row).toEqual({
      code: made.code,
      client_id: clientId,
      name: "Site rebuild",
      status: "planned",
      currency: "USD",
      budget_minor: 500_000,
      source_document_id: null,
    });
    const audit = await rows<{ action: string; entity_type: string; entity_id: string; summary: string }>(
      "SELECT action, entity_type, entity_id, summary FROM audit_log WHERE entity_id = ?",
      made.id,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "project.create", entity_type: "project" });
    expect(JSON.parse(audit[0]?.summary ?? "{}")).toEqual({ projectId: made.id, clientId });
  });

  it("refuses a currency that is not the client's, an unknown client, an unknown owner, dates out of order and extra fields", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const before = await countOf("projects");
    const post = (body: Record<string, unknown>) => call("/projects", { cookie: o.cookie, body });
    expect(await code(await post({ clientId, name: "P", currency: "USD" }))).toBe("currency_mismatch");
    expect((await post({ clientId: "no-such-client", name: "P" })).status).toBe(404);
    expect(await code(await post({ clientId, name: "P", ownerId: "no-such-user" }))).toBe("bad_owner");
    const gone = await sessionFor("staff");
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?").bind(gone.id).run();
    expect(await code(await post({ clientId, name: "P", ownerId: gone.id }))).toBe("bad_owner");
    expect(
      await code(await post({ clientId, name: "P", startDate: "2026-12-01", targetDate: "2026-11-01" })),
    ).toBe("dates_order");
    expect((await post({ clientId, name: "P", status: "active" })).status).toBe(400);
    expect((await post({ clientId, name: "P", code: "PRJ-9" })).status).toBe(400);
    expect((await post({ clientId, name: "P", budgetMinor: -1 })).status).toBe(400);
    expect((await post({ clientId, name: "P", startDate: "2026-02-30" })).status).toBe(400);
    expect((await post({ clientId, name: "   " })).status).toBe(400);
    expect(await countOf("projects")).toBe(before);
  });

  it("20 parallel creates get 20 distinct, consecutive codes", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const made = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        call("/projects", { cookie: o.cookie, body: { clientId, name: `Parallel ${i}` } }),
      ),
    );
    expect(made.map((r) => r.status)).toEqual(Array(20).fill(201));
    const nums = (await Promise.all(made.map(async (r) => Number((await json(r)).code.slice(4))))).sort(
      (a, b) => a - b,
    );
    expect(new Set(nums).size).toBe(20);
    expect(nums.at(-1)).toBe((nums[0] as number) + 19);
  });

  it("after PRJ-0999 comes PRJ-1000", async () => {
    const o = await owner();
    const clientId = await mkClient();
    await mkProject(clientId, { code: "PRJ-0999" });
    expect((await create(o.cookie, { clientId, name: "Next" })).code).toBe("PRJ-1000");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("GET /projects and /clients/:id/projects [ADM-PRJ-01, ADM-CLI-03]", () => {
  it("lists newest first in pages of 25 or 50 with next and previous cursors, and filters by status, client, owner and a prefix", async () => {
    const o = await owner();
    const clientA = await mkClient({ display_name: "Zeta Listing Co" });
    const clientB = await mkClient();
    const t0 = 1_800_000_000_000;
    const ids: string[] = [];
    for (let i = 0; i < 30; i++)
      ids.push(
        (
          await mkProject(clientA, {
            name: `Listing ${String(i).padStart(2, "0")}`,
            created_at: t0 + i * 1000,
            updated_at: t0 + i * 1000,
            status: i % 2 ? "active" : "planned",
          })
        ).id,
      );
    await mkProject(clientB, { name: "Other client", created_at: t0 - 5000, owner_id: o.id });
    const first = await json(await call(`/clients/${clientA}/projects`, { cookie: o.cookie }));
    expect(first.projects).toHaveLength(25);
    expect(first.projects[0].id).toBe(ids[29]);
    expect(first.projects[0]).toMatchObject({ clientId: clientA, clientName: "Zeta Listing Co" });
    expect(first.next).toBeTruthy();
    const second = await json(
      await call(`/clients/${clientA}/projects?after=${first.next}`, { cookie: o.cookie }),
    );
    expect(second.projects.map((p: J) => p.id)).toEqual(ids.slice(0, 5).reverse());
    expect(second.next).toBeNull();
    const big = await json(await call(`/projects?clientId=${clientA}&limit=50`, { cookie: o.cookie }));
    expect(big.projects).toHaveLength(30);
    const back = await json(
      await call(
        `/projects?clientId=${clientA}&before=${(await json(await call(`/projects?clientId=${clientA}`, { cookie: o.cookie }))).next}`,
        { cookie: o.cookie },
      ),
    );
    expect(back.projects.length).toBeGreaterThan(0);
    const active = await json(
      await call(`/projects?clientId=${clientA}&status=active&limit=50`, { cookie: o.cookie }),
    );
    expect(active.projects).toHaveLength(15);
    expect((await json(await call(`/projects?ownerId=${o.id}`, { cookie: o.cookie }))).projects).toHaveLength(
      1,
    );
    const byName = await json(await call("/projects?q=listing 1&limit=50", { cookie: o.cookie }));
    expect(byName.projects.map((p: J) => p.name).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `Listing 1${i}`),
    );
    const projectCode = (first.projects[0] as J).code as string;
    const byCode = await json(await call(`/projects?q=${projectCode.toLowerCase()}`, { cookie: o.cookie }));
    expect(byCode.projects.map((p: J) => p.code)).toContain(projectCode);
  });

  it("answers 400 to a bad cursor, filter or limit, and 404 to the projects of a client that does not exist", async () => {
    const o = await owner();
    expect((await call("/projects?after=garbage", { cookie: o.cookie })).status).toBe(400);
    expect((await call("/projects?status=nope", { cookie: o.cookie })).status).toBe(400);
    expect((await call("/projects?limit=10", { cookie: o.cookie })).status).toBe(400);
    expect((await call("/clients/no-such-client/projects", { cookie: o.cookie })).status).toBe(404);
    expect(
      (await json(await call(`/clients/${await mkClient()}/projects`, { cookie: o.cookie }))).projects,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("GET /projects/:id [ADM-PRJ-05]", () => {
  it("returns the project, the client, milestones with totals, five recent notes and files, and the figures that arrive later", async () => {
    const o = await owner();
    const clientId = await mkClient({ display_name: "Detail Co" });
    const p = await mkProject(clientId, { budget_minor: 1_000_00 });
    await mkMilestone(p.id, { position: 2, title: "Second", amount_minor: null, pct_bp: 4000 });
    await mkMilestone(p.id, { position: 1, title: "First", amount_minor: 600_00 });
    for (let i = 0; i < 7; i++) {
      await mkNote(clientId, { project_id: p.id, created_at: 1_000 + i });
      await mkFile(clientId, { projectId: p.id });
    }
    await mkNote(clientId, { body_md: "client-level only" });
    const res = await json(await call(`/projects/${p.id}`, { cookie: o.cookie }));
    expect(res.project).toMatchObject({ id: p.id, clientName: "Detail Co", budgetMinor: 100_000 });
    expect(res.milestones.map((m: J) => [m.title, m.position, m.resolvedMinor])).toEqual([
      ["First", 1, 60_000],
      ["Second", 2, 40_000],
    ]);
    expect(res.milestoneTotals).toEqual({ totalMinor: 100_000, mismatch: false });
    expect(res.recentNotes).toHaveLength(5);
    expect(res.recentNotes[0].createdAt).toBe(1_006);
    expect(res.recentFiles).toHaveLength(5);
    expect(JSON.stringify(res)).not.toContain("r2_key");
    expect(JSON.stringify(res)).not.toContain("r2Key");
    expect(res.figures).toEqual({
      billedVsPaid: { available: false, arrivesWith: "invoicing" },
      hours: { available: false, arrivesWith: "time_logs" },
    });
    expect((await call("/projects/no-such-project", { cookie: o.cookie })).status).toBe(404);
  });

  it("warns when the milestones do not add up to the budget", async () => {
    const o = await owner();
    const p = await mkProject(await mkClient(), { budget_minor: 1_000_00 });
    await mkMilestone(p.id, { position: 1, amount_minor: 300_00 });
    const res = await json(await call(`/projects/${p.id}`, { cookie: o.cookie }));
    expect(res.milestoneTotals).toEqual({ totalMinor: 30_000, mismatch: true });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("PATCH /projects/:id and POST /projects/:id/status [ADM-PRJ-01]", () => {
  it("edits fields once, refuses a stale version, and never changes the client or the code", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const p = await mkProject(clientId);
    const patch = (body: Record<string, unknown>) =>
      call(`/projects/${p.id}`, { method: "PATCH", cookie: o.cookie, body });
    const ok = await patch({
      expectedUpdatedAt: p.updatedAt,
      name: "Renamed",
      budgetMinor: 123_00,
      ownerId: o.id,
    });
    expect(ok.status).toBe(200);
    const { updatedAt } = await json(ok);
    expect(updatedAt).toBeGreaterThan(p.updatedAt);
    expect(await code(await patch({ expectedUpdatedAt: p.updatedAt, name: "Stale" }))).toBe("stale_version");
    expect(await one("SELECT name, budget_minor, owner_id FROM projects WHERE id = ?", p.id)).toEqual({
      name: "Renamed",
      budget_minor: 12_300,
      owner_id: o.id,
    });
    expect((await patch({ expectedUpdatedAt: updatedAt, clientId: await mkClient() })).status).toBe(400);
    expect((await patch({ expectedUpdatedAt: updatedAt, code: "PRJ-0001" })).status).toBe(400);
    expect((await patch({ expectedUpdatedAt: updatedAt, status: "completed" })).status).toBe(400);
    expect((await patch({ expectedUpdatedAt: updatedAt, currency: "USD" })).status).toBe(400);
    expect(await json(await patch({ expectedUpdatedAt: updatedAt, name: "Renamed" }))).toMatchObject({
      changed: false,
    });
    expect(await code(await patch({ expectedUpdatedAt: updatedAt, ownerId: "no-such-user" }))).toBe(
      "bad_owner",
    );
    expect(
      await code(
        await patch({ expectedUpdatedAt: updatedAt, startDate: "2026-05-02", targetDate: "2026-05-01" }),
      ),
    ).toBe("dates_order");
    expect(
      (await call("/projects/no-such", { method: "PATCH", cookie: o.cookie, body: { expectedUpdatedAt: 1 } }))
        .status,
    ).toBe(404);
    const row = await one<{ client_id: string }>("SELECT client_id FROM projects WHERE id = ?", p.id);
    expect(row?.client_id).toBe(clientId);
  });

  it("follows the status machine: every other move is a 409 invalid_transition, and completed and cancelled are terminal", async () => {
    const o = await owner();
    for (const from of PROJECT_STATUSES) {
      for (const to of PROJECT_STATUSES) {
        const p = await mkProject(await mkClient(), { status: from });
        const res = await call(`/projects/${p.id}/status`, { cookie: o.cookie, body: { to } });
        if ((PROJECT_TRANSITIONS[from] as readonly string[]).includes(to)) {
          expect(res.status, `${from}>${to}`).toBe(200);
          expect(await one("SELECT status FROM projects WHERE id = ?", p.id)).toEqual({ status: to });
        } else {
          expect(res.status, `${from}>${to}`).toBe(409);
          expect(await code(res)).toBe("invalid_transition");
          expect(await one("SELECT status FROM projects WHERE id = ?", p.id)).toEqual({ status: from });
        }
      }
    }
    expect(
      (await call("/projects/no-such/status", { cookie: o.cookie, body: { to: "active" } })).status,
    ).toBe(404);
    expect((await call("/projects/x/status", { cookie: o.cookie, body: { to: "bogus" } })).status).toBe(400);
  });

  it("two racing moves out of the same status: one wins, the other is a 409", async () => {
    const o = await owner();
    const p = await mkProject(await mkClient(), { status: "active" });
    const [a, b] = await Promise.all([
      call(`/projects/${p.id}/status`, { cookie: o.cookie, body: { to: "completed" } }),
      call(`/projects/${p.id}/status`, { cookie: o.cookie, body: { to: "on_hold" } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await countOf("audit_log", "action = 'project.status' AND entity_id = ?", p.id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("milestones [ADM-PRJ-02]", () => {
  const post = (cookie: string, projectId: string, body: Record<string, unknown>) =>
    call(`/projects/${projectId}/milestones`, { cookie, body });

  it("creates a line with an amount or a percentage, never both or neither, at the next position", async () => {
    const o = await owner();
    const p = await mkProject(await mkClient(), { budget_minor: 100_000 });
    expect((await post(o.cookie, p.id, { title: "A", amountMinor: 100 })).status).toBe(201);
    expect((await post(o.cookie, p.id, { title: "B", pctBp: 2500, dueDate: "2026-12-31" })).status).toBe(201);
    expect((await post(o.cookie, p.id, { title: "C", amountMinor: 0 })).status).toBe(201);
    for (const bad of [
      { title: "X" },
      { title: "X", amountMinor: 1, pctBp: 1 },
      { title: "X", amountMinor: null, pctBp: null },
      { title: "X", amountMinor: -1 },
      { title: "X", pctBp: 10_001 },
      { title: "X", amountMinor: 1.5 },
      { title: "X", amountMinor: 1, status: "paid" },
      { title: "X", amountMinor: 1, dueDate: "31-12-2026" },
    ])
      expect((await post(o.cookie, p.id, bad)).status, JSON.stringify(bad)).toBe(400);
    expect((await post(o.cookie, "no-such", { title: "X", amountMinor: 1 })).status).toBe(404);
    expect(
      await rows<{ title: string; position: number; status: string }>(
        "SELECT title, position, status FROM milestones WHERE project_id = ? ORDER BY position",
        p.id,
      ),
    ).toEqual([
      { title: "A", position: 1, status: "pending" },
      { title: "B", position: 2, status: "pending" },
      { title: "C", position: 3, status: "pending" },
    ]);
  });

  it("stops at 100 milestones", async () => {
    const o = await owner();
    const p = await mkProject(await mkClient());
    await env.DB.batch(
      Array.from({ length: 100 }, (_, i) =>
        env.DB.prepare(
          "INSERT INTO milestones (id, project_id, position, title, amount_minor) VALUES (?1, ?2, ?3, 'M', 1)",
        ).bind(`m-${p.id}-${i}`, p.id, i + 1),
      ),
    );
    const res = await post(o.cookie, p.id, { title: "One too many", amountMinor: 1 });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("milestone_limit");
    expect(await countOf("milestones", "project_id = ?", p.id)).toBe(100);
  });

  it("edits a line: an amount and a percentage replace each other, a stale version is refused, an invoiced or paid line is locked", async () => {
    const o = await owner();
    const p = await mkProject(await mkClient());
    const m = await mkMilestone(p.id, { position: 1, amount_minor: 500 });
    const patch = (id: string, body: Record<string, unknown>) =>
      call(`/milestones/${id}`, { method: "PATCH", cookie: o.cookie, body });
    const ok = await patch(m.id, {
      expectedUpdatedAt: m.updatedAt,
      pctBp: 2500,
      title: "Quarter",
      dueDate: "2027-01-31",
    });
    expect(ok.status).toBe(200);
    expect(
      await one("SELECT title, amount_minor, pct_bp, due_date FROM milestones WHERE id = ?", m.id),
    ).toEqual({
      title: "Quarter",
      amount_minor: null,
      pct_bp: 2500,
      due_date: "2027-01-31",
    });
    const t = (await json(ok)).updatedAt as number;
    expect(await code(await patch(m.id, { expectedUpdatedAt: m.updatedAt, title: "Stale" }))).toBe(
      "stale_version",
    );
    expect((await patch(m.id, { expectedUpdatedAt: t, amountMinor: 900 })).status).toBe(200);
    expect(await one("SELECT amount_minor, pct_bp FROM milestones WHERE id = ?", m.id)).toEqual({
      amount_minor: 900,
      pct_bp: null,
    });
    const t2 = (await one<{ updated_at: number }>("SELECT updated_at FROM milestones WHERE id = ?", m.id))
      ?.updated_at as number;
    expect((await patch(m.id, { expectedUpdatedAt: t2, amountMinor: 1, pctBp: 1 })).status).toBe(400);
    expect((await patch(m.id, { expectedUpdatedAt: t2, amountMinor: null })).status).toBe(400);
    expect((await patch(m.id, { expectedUpdatedAt: t2, status: "paid" })).status).toBe(400);
    expect(await json(await patch(m.id, { expectedUpdatedAt: t2, title: "Quarter" }))).toMatchObject({
      changed: false,
    });
    for (const locked of [{ status: "invoiced" }, { status: "paid" }, { document_id: "doc-1" }]) {
      const l = await mkMilestone(p.id, locked);
      const res = await patch(l.id, { expectedUpdatedAt: l.updatedAt, title: "Nope" });
      expect(res.status, JSON.stringify(locked)).toBe(409);
      expect(await code(res)).toBe("milestone_locked");
    }
    expect((await patch("no-such", { expectedUpdatedAt: 1, title: "x" })).status).toBe(404);
  });

  it("moves between pending and ready to bill only; invoiced and paid say they arrive with invoicing", async () => {
    const o = await owner();
    const p = await mkProject(await mkClient());
    const m = await mkMilestone(p.id);
    const status = (id: string, to: string) =>
      call(`/milestones/${id}/status`, { cookie: o.cookie, body: { to } });
    expect((await status(m.id, "ready_to_bill")).status).toBe(200);
    expect(await code(await status(m.id, "ready_to_bill"))).toBe("milestone_invalid_transition");
    for (const to of ["invoiced", "paid"]) {
      const res = await status(m.id, to);
      expect(res.status).toBe(409);
      expect(await code(res)).toBe("arrives_with_invoicing");
    }
    expect((await status(m.id, "pending")).status).toBe(200);
    expect(await one("SELECT status FROM milestones WHERE id = ?", m.id)).toEqual({ status: "pending" });
    const inv = await mkMilestone(p.id, { status: "invoiced" });
    expect(await code(await status(inv.id, "pending"))).toBe("milestone_invalid_transition");
    expect(await code(await status(inv.id, "ready_to_bill"))).toBe("milestone_invalid_transition");
    expect((await status("no-such", "pending")).status).toBe(404);
    expect((await status(m.id, "bogus")).status).toBe(400);
  });

  it("deletes only a pending line that is on no document", async () => {
    const o = await owner();
    const p = await mkProject(await mkClient());
    const del = (id: string) => call(`/milestones/${id}`, { method: "DELETE", cookie: o.cookie });
    const ok = await mkMilestone(p.id);
    expect((await del(ok.id)).status).toBe(200);
    expect(await countOf("milestones", "id = ?", ok.id)).toBe(0);
    for (const locked of [{ status: "ready_to_bill" }, { status: "invoiced" }, { document_id: "doc-9" }]) {
      const m = await mkMilestone(p.id, locked);
      const res = await del(m.id);
      expect(res.status, JSON.stringify(locked)).toBe(409);
      expect(await code(res)).toBe("milestone_locked");
      expect(await countOf("milestones", "id = ?", m.id)).toBe(1);
    }
    expect((await del("no-such")).status).toBe(404);
  });

  it("reorders in one atomic move; a list that is not exactly the project's milestones changes nothing", async () => {
    const o = await owner();
    const p = await mkProject(await mkClient());
    const other = await mkProject(await mkClient());
    const ms = [];
    for (let i = 1; i <= 4; i++) ms.push((await mkMilestone(p.id, { position: i, title: `M${i}` })).id);
    const foreign = (await mkMilestone(other.id, { position: 1 })).id;
    const order = (ids: string[]) =>
      call(`/projects/${p.id}/milestones/order`, { cookie: o.cookie, body: { ids } });
    const positions = () =>
      rows<{ title: string; position: number }>(
        "SELECT title, position FROM milestones WHERE project_id = ? ORDER BY position",
        p.id,
      );
    const before = await positions();
    for (const bad of [ms.slice(1), [...ms, foreign], [...ms.slice(0, 3), foreign], [ms[0] as string, ...ms]])
      expect((await order(bad)).status).toBeGreaterThanOrEqual(400);
    expect(await positions()).toEqual(before);
    expect(await countOf("audit_log", "action = 'milestone.reorder' AND entity_id = ?", p.id)).toBe(0);
    expect((await order([ms[3], ms[1], ms[0], ms[2]] as string[])).status).toBe(200);
    expect(await positions()).toEqual([
      { title: "M4", position: 1 },
      { title: "M2", position: 2 },
      { title: "M1", position: 3 },
      { title: "M3", position: 4 },
    ]);
    expect(await countOf("milestones", "project_id = ?", other.id)).toBe(1);
    expect(
      (await call("/projects/no-such/milestones/order", { cookie: o.cookie, body: { ids: ["a"] } })).status,
    ).toBe(409);
    expect((await order([])).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("notes [ADM-PRJ-03]", () => {
  it("creates a project note and a client note (the client comes from the project), lists them, and filters by visibility", async () => {
    const o = await owner();
    const clientId = await mkClient();
    const p = await mkProject(clientId);
    const a = await json(
      await call(`/projects/${p.id}/notes`, { cookie: o.cookie, body: { bodyMd: "**Internal** thought" } }),
    );
    const b = await json(
      await call(`/projects/${p.id}/notes`, {
        cookie: o.cookie,
        body: { bodyMd: "For the client", visibility: "shared" },
      }),
    );
    const c = await json(
      await call(`/clients/${clientId}/notes`, { cookie: o.cookie, body: { bodyMd: "Client level" } }),
    );
    expect(
      await one("SELECT client_id, project_id, visibility, author_id FROM notes WHERE id = ?", a.id),
    ).toEqual({
      client_id: clientId,
      project_id: p.id,
      visibility: "internal",
      author_id: o.id,
    });
    const project = await json(await call(`/projects/${p.id}/notes`, { cookie: o.cookie }));
    expect(project.notes.map((n: J) => n.id).sort()).toEqual([a.id, b.id].sort());
    expect(project.notes[0]).toMatchObject({ clientId, projectId: p.id, authorId: o.id });
    const client = await json(await call(`/clients/${clientId}/notes`, { cookie: o.cookie }));
    expect(client.notes.map((n: J) => n.id).sort()).toEqual([a.id, b.id, c.id].sort());
    const shared = await json(
      await call(`/clients/${clientId}/notes?visibility=shared`, { cookie: o.cookie }),
    );
    expect(shared.notes.map((n: J) => n.id)).toEqual([b.id]);
    expect((await call(`/clients/${clientId}/notes?visibility=nope`, { cookie: o.cookie })).status).toBe(400);
    expect((await call("/projects/no-such/notes", { cookie: o.cookie })).status).toBe(404);
    expect((await call("/clients/no-such/notes", { cookie: o.cookie })).status).toBe(404);
    for (const bad of [
      {},
      { bodyMd: "" },
      { bodyMd: "   " },
      { bodyMd: "x".repeat(10_001) },
      { bodyMd: "x", visibility: "public" },
      { bodyMd: "x", clientId },
    ])
      expect(
        (await call(`/projects/${p.id}/notes`, { cookie: o.cookie, body: bad })).status,
        JSON.stringify(bad).slice(0, 50),
      ).toBe(400);
    expect((await call("/projects/no-such/notes", { cookie: o.cookie, body: { bodyMd: "x" } })).status).toBe(
      404,
    );
  });

  it("pages in 25s newest first", async () => {
    const o = await owner();
    const clientId = await mkClient();
    for (let i = 0; i < 30; i++) await mkNote(clientId, { created_at: 2_000_000 + i });
    const first = await json(await call(`/clients/${clientId}/notes`, { cookie: o.cookie }));
    expect(first.notes).toHaveLength(25);
    expect(first.notes[0].createdAt).toBe(2_000_029);
    const second = await json(
      await call(`/clients/${clientId}/notes?after=${first.next}`, { cookie: o.cookie }),
    );
    expect(second.notes).toHaveLength(5);
    expect(second.next).toBeNull();
  });

  it("only the author or the owner may edit or delete; sharing is audited as note.share; a stale version is refused", async () => {
    const clientId = await mkClient();
    const author = await sessionFor("staff");
    const other = await sessionFor("staff");
    const o = await owner();
    const made = await json(
      await call(`/clients/${clientId}/notes`, { cookie: author.cookie, body: { bodyMd: "Mine" } }),
    );
    const updatedAt = (
      await one<{ updated_at: number }>("SELECT updated_at FROM notes WHERE id = ?", made.id)
    )?.updated_at as number;
    const patch = (cookie: string, body: Record<string, unknown>) =>
      call(`/notes/${made.id}`, { method: "PATCH", cookie, body: { expectedUpdatedAt: updatedAt, ...body } });
    expect((await patch(other.cookie, { bodyMd: "Hijack" })).status).toBe(403);
    expect((await call(`/notes/${made.id}`, { method: "DELETE", cookie: other.cookie })).status).toBe(403);
    expect(await one("SELECT body_md FROM notes WHERE id = ?", made.id)).toEqual({ body_md: "Mine" });
    const edited = await patch(author.cookie, { bodyMd: "Edited" });
    expect(edited.status).toBe(200);
    expect(await code(await patch(author.cookie, { bodyMd: "Stale" }))).toBe("stale_version");
    const t = (await json(edited)).updatedAt as number;
    const share = await call(`/notes/${made.id}`, {
      method: "PATCH",
      cookie: o.cookie,
      body: { expectedUpdatedAt: t, visibility: "shared" },
    });
    expect(share.status).toBe(200);
    const audit = await rows<{ action: string; actor_id: string; summary: string }>(
      "SELECT action, actor_id, summary FROM audit_log WHERE entity_id = ? ORDER BY at, id",
      made.id,
    );
    expect(audit.map((a) => a.action)).toEqual(["note.create", "note.update", "note.share"]);
    expect(audit[2]?.actor_id).toBe(o.id);
    expect(JSON.parse(audit[2]?.summary ?? "{}")).toMatchObject({
      visibility: "shared",
      changed: ["visibility"],
    });
    expect(
      await json(
        await call(`/notes/${made.id}`, {
          method: "PATCH",
          cookie: o.cookie,
          body: {
            expectedUpdatedAt: share.status === 200 ? (await json(share)).updatedAt : 0,
            visibility: "shared",
          },
        }),
      ),
    ).toMatchObject({ changed: false });
    expect((await call(`/notes/${made.id}`, { method: "DELETE", cookie: o.cookie })).status).toBe(200);
    expect(await countOf("notes", "id = ?", made.id)).toBe(0);
    expect(await countOf("audit_log", "action = 'note.delete' AND entity_id = ?", made.id)).toBe(1);
    expect((await call(`/notes/${made.id}`, { method: "DELETE", cookie: o.cookie })).status).toBe(404);
    expect((await patch(o.cookie, { bodyMd: "x" })).status).toBe(404);
    expect(
      (
        await call("/notes/x", {
          method: "PATCH",
          cookie: o.cookie,
          body: { expectedUpdatedAt: 1, clientId: "y" },
        })
      ).status,
    ).toBe(400);
  });

  it("a note with no author (the author was removed) can be changed by the owner only", async () => {
    const clientId = await mkClient();
    const n = await mkNote(clientId, { author_id: null });
    const staff = await sessionFor("staff");
    const o = await owner();
    const patch = (cookie: string) =>
      call(`/notes/${n.id}`, {
        method: "PATCH",
        cookie,
        body: { expectedUpdatedAt: n.updatedAt, bodyMd: "x" },
      });
    expect((await patch(staff.cookie)).status).toBe(403);
    expect((await patch(o.cookie)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the role matrix [ADM-PRJ, docs/04 §9]", () => {
  const PRJ = ROUTES.filter((r) => r.access === "projects.read" || r.access === "projects.write");
  const sample = (r: (typeof PRJ)[number]) => ({
    path: r.path.replace("/api/v1", "").replace(":id", "no-such-id"),
    init:
      r.method === "GET" || r.method === "DELETE"
        ? { method: r.method }
        : r.body === "upload"
          ? { method: r.method, raw: new Uint8Array([1]) }
          : { method: r.method, body: {} },
  });

  it("every projects route follows decide(): Sales reads but never writes, the Accountant is denied everywhere", async () => {
    expect(PRJ.length).toBeGreaterThanOrEqual(24);
    for (const role of ROLES) {
      const s = await sessionFor(role, { stepUp: true });
      for (const r of PRJ) {
        const { path, init } = sample(r);
        const res = await call(path, { ...init, cookie: s.cookie });
        const denied = decide(role, r.access as never) === "deny";
        expect(res.status === 403, `${role} ${r.method} ${r.path}`).toBe(denied);
        if (role === "accountant") expect(res.status, `${role} ${r.method} ${r.path}`).toBe(403);
        if (role === "sales" && r.access === "projects.write") expect(res.status).toBe(403);
      }
    }
  });

  it("Sales denied a write changes nothing and writes no audit row", async () => {
    const s = await sessionFor("sales");
    const clientId = await mkClient();
    const p = await mkProject(clientId);
    const before = await countOf("audit_log");
    for (const [path, body] of [
      ["/projects", { clientId, name: "No" }],
      [`/projects/${p.id}/notes`, { bodyMd: "no" }],
      [`/projects/${p.id}/status`, { to: "active" }],
    ] as const)
      expect((await call(path, { cookie: s.cookie, body })).status).toBe(403);
    expect(await countOf("audit_log")).toBe(before);
    expect(await one("SELECT status FROM projects WHERE id = ?", p.id)).toEqual({ status: "planned" });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("search finds projects by code and name prefix [ADM-G-05]", () => {
  it("owner, staff and Sales see a Projects group; the Accountant does not", async () => {
    const clientId = await mkClient();
    const p = await mkProject(clientId, { name: "Zinnia Dashboard", code: "PRJ-S0001" });
    for (const role of ["owner", "staff", "sales"] as const) {
      const s = await sessionFor(role);
      const res = await json(await call("/search?q=zinnia", { cookie: s.cookie }));
      const group = res.groups.find((g: J) => g.type === "project");
      expect(group.items).toEqual([
        { id: p.id, title: "PRJ-S0001 Zinnia Dashboard", subtitle: "Project", link: `/projects/${p.id}` },
      ]);
      expect(
        (await json(await call("/search?q=prj-s000", { cookie: s.cookie }))).groups.find(
          (g: J) => g.type === "project",
        ).items,
      ).toHaveLength(1);
    }
    const acc = await sessionFor("accountant");
    expect(
      (await json(await call("/search?q=zinnia", { cookie: acc.cookie }))).groups.map((g: J) => g.type),
    ).not.toContain("project");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("audit and access rows never hold names, notes or file contents", () => {
  it("a full round of changes leaves none of the distinctive text in audit_log, access_log or the console", async () => {
    const logs: string[] = [];
    const spy = (...a: unknown[]) => logs.push(a.map(String).join(" "));
    const orig = [console.log, console.error];
    console.log = spy;
    console.error = spy;
    try {
      const o = await owner();
      const clientId = await mkClient();
      const made = await create(o.cookie, { clientId, name: "ZZ-SECRET-PROJECT-NAME" });
      await call(`/projects/${made.id}`, {
        method: "PATCH",
        cookie: o.cookie,
        body: { expectedUpdatedAt: made.updatedAt, name: "ZZ-SECRET-RENAMED" },
      });
      const m = await json(
        await call(`/projects/${made.id}/milestones`, {
          cookie: o.cookie,
          body: { title: "ZZ-SECRET-MILESTONE", amountMinor: 5 },
        }),
      );
      await call(`/milestones/${m.id}`, { method: "DELETE", cookie: o.cookie });
      const n = await json(
        await call(`/projects/${made.id}/notes`, {
          cookie: o.cookie,
          body: { bodyMd: "ZZ-SECRET-NOTE-BODY" },
        }),
      );
      await call(`/notes/${n.id}`, { method: "DELETE", cookie: o.cookie });
      await call(`/projects/${made.id}/status`, { cookie: o.cookie, body: { to: "active" } });
    } finally {
      [console.log, console.error] = orig as [typeof console.log, typeof console.error];
    }
    const dump = JSON.stringify([
      await rows("SELECT * FROM audit_log"),
      await rows("SELECT * FROM access_log"),
      logs,
    ]);
    expect(dump).not.toMatch(/ZZ-SECRET/);
    expect(
      await countOf(
        "audit_log",
        "action LIKE 'project.%' OR action LIKE 'milestone.%' OR action LIKE 'note.%'",
      ),
    ).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the lists run on indexes, never a scan of a growing table [docs/05 §5, NFR]", () => {
  const plan = async (sql: string, ...p: unknown[]) =>
    (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...p)).map((r) => r.detail);
  const noScan = (lines: string[]) => {
    for (const l of lines) if (/^SCAN /.test(l)) expect(l, l).toMatch(/USING (COVERING )?INDEX/);
  };

  it("the project list, with every filter and a cursor", async () => {
    const cases: [Parameters<typeof projectListSql>[0], boolean][] = [
      [{}, false],
      [{}, true],
      [{ status: "active" }, true],
      [{ clientId: "c" }, true],
      [{ ownerId: "u" }, false],
      [{ q: "prj" }, true],
      [{ status: "active", clientId: "c", ownerId: "u", q: "ab" }, true],
    ];
    for (const [f, cursor] of cases) {
      const { sql, bind } = projectListSql(f, cursor ? { k: 1, id: "x" } : null, "after", 25);
      const lines = await plan(sql, ...bind);
      noScan(lines);
      expect(lines.join("\n"), JSON.stringify(f)).toMatch(/INDEX/);
    }
    const byStatus = projectListSql({ status: "active" }, { k: 1, id: "x" }, "after", 25);
    expect((await plan(byStatus.sql, ...byStatus.bind)).join("\n")).toMatch(/projects_status_created/);
    const { sql, bind } = projectListSql({ q: "ab" }, null, "after", 25);
    const text = (await plan(sql, ...bind)).join("\n");
    expect(text).toMatch(/projects_code/);
    expect(text).toMatch(/projects_name_nocase/);
  });

  it("the client's notes (all and shared only) and the project's notes", async () => {
    for (const [scope, vis, cursor] of [
      ["client", false, false],
      ["client", true, true],
      ["project", false, true],
    ] as const) {
      const lines = await plan(
        noteListSql(scope, vis, cursor, 25),
        "id",
        ...(vis ? ["shared"] : []),
        ...(cursor ? [1, "x"] : []),
      );
      noScan(lines);
      expect(lines.join("\n")).toMatch(/notes_(client|project|client_visibility)/);
    }
    expect((await plan(noteListSql("client", true, false, 25), "id", "shared")).join("\n")).toMatch(
      /notes_client_visibility/,
    );
  });

  it("the search, the milestones of a project and the project's recent files", async () => {
    const s = (await plan(PROJECTS_SQL, "A", "B", "a", "b")).join("\n");
    expect(s).toMatch(/projects_code/);
    expect(s).toMatch(/projects_name_nocase/);
    const m = await plan("SELECT id FROM milestones WHERE project_id = ?1 ORDER BY position LIMIT 100", "p");
    noScan(m);
    const f = await plan(
      "SELECT id FROM files WHERE project_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 5",
      "p",
    );
    noScan(f);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("notes and files do not mix clients [ADM-PRJ-03, -04]", () => {
  it("the database refuses a note for another client's project, and a project cannot change client", async () => {
    const a = await mkClient();
    const b = await mkClient();
    const p = await mkProject(a);
    await expect(mkNote(b, { project_id: p.id })).rejects.toThrow(/project must belong/);
    await expect(
      env.DB.prepare("UPDATE projects SET client_id = ? WHERE id = ?").bind(b, p.id).run(),
    ).rejects.toThrow(/client of a project cannot change/);
    await expect(mkFile(b, { projectId: p.id })).rejects.toThrow(/project must belong/);
  });
});
