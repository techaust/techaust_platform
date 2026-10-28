// The M3.4 review fixes [ADM-PRJ-01, -02, -03, -04, ADM-CLI-05]: the budget lock, the project version, the export of an individual
// client's notes and files, the anonymised individual taking nothing new, and the erase renaming projects and milestones.
// Researched 2026-10-28, DPDP Act s.8(7) and s.12(3) (08-C RB-11): the erase, export and anonymised-client rules.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { mkClient, mkContact } from "./test-clients.ts";
import { bodyOf, call, countOf, one, rows, sessionFor } from "./test-helpers.ts";
import { mkFile, mkMilestone, mkNote, mkProject, PDF_BYTES, upload } from "./test-projects.ts";

// biome-ignore lint/suspicious/noExplicitAny: response bodies in tests are read loosely
type J = Record<string, any>;
const json = async (res: Response): Promise<J> => (await res.json()) as J;
const owner = () => sessionFor("owner", { stepUp: true });
const code = async (res: Response) => ((await bodyOf(res)) as { error: { code: string } }).error.code;
const erase = (cookie: string, id: string, mode: "erase" | "anonymise" = "anonymise") =>
  call(`/contacts/${id}/erase`, { cookie, body: { mode, reason: "requested" } });
const exportPart = (cookie: string, id: string, body: Record<string, unknown> = {}) =>
  call(`/contacts/${id}/export`, { cookie, body });

/** An individual client with one contact, a project (with budget) and two milestones, a note and a file. */
async function individual() {
  const clientId = await mkClient({
    type: "individual",
    legal_name: "Pat Private",
    display_name: "Pat Private",
  });
  const contact = await mkContact(clientId);
  const p = await mkProject(clientId, { name: "Pat's kitchen site", budget_minor: 1_000_00 });
  const m1 = await mkMilestone(p.id, { position: 1, title: "Pat sign-off", amount_minor: 100 });
  const m2 = await mkMilestone(p.id, {
    position: 4,
    title: "Deliver to Pat",
    amount_minor: null,
    pct_bp: 5000,
  });
  return { clientId, contact, p, m1, m2 };
}

// ---------------------------------------------------------------------------------------------------------------
describe("the budget lock [ADM-PRJ-02]", () => {
  it("refuses a budget change while a percentage milestone is invoiced, paid or on a document; other edits and amount milestones don't lock", async () => {
    const o = await owner();
    const patch = (id: string, expectedUpdatedAt: number, body: Record<string, unknown>) =>
      call(`/projects/${id}`, { method: "PATCH", cookie: o.cookie, body: { expectedUpdatedAt, ...body } });
    for (const status of ["invoiced", "paid"]) {
      const p = await mkProject(await mkClient(), { budget_minor: 5000 });
      await mkMilestone(p.id, { position: 1, amount_minor: null, pct_bp: 2500, status });
      const res = await patch(p.id, p.updatedAt, { budgetMinor: 6000 });
      expect(res.status).toBe(409);
      expect(await code(res)).toBe("budget_locked");
      expect(await one("SELECT budget_minor FROM projects WHERE id = ?", p.id)).toEqual({
        budget_minor: 5000,
      });
      // the same budget, and other fields, still go through
      expect((await patch(p.id, p.updatedAt, { budgetMinor: 5000, name: "Renamed" })).status).toBe(200);
    }
    // a fixed-amount milestone, even invoiced, does not depend on the budget
    const fixed = await mkProject(await mkClient(), { budget_minor: 5000 });
    await mkMilestone(fixed.id, { position: 1, amount_minor: 100, status: "invoiced" });
    expect((await patch(fixed.id, fixed.updatedAt, { budgetMinor: 6000 })).status).toBe(200);
    // a pending percentage milestone can still follow a new budget
    const open = await mkProject(await mkClient(), { budget_minor: 5000 });
    await mkMilestone(open.id, { position: 1, amount_minor: null, pct_bp: 2500, status: "ready_to_bill" });
    expect((await patch(open.id, open.updatedAt, { budgetMinor: 7000 })).status).toBe(200);
  });

  it("is part of the write: a milestone invoiced after the read still stops the change", async () => {
    const o = await owner();
    const p = await mkProject(await mkClient(), { budget_minor: 5000 });
    const m = await mkMilestone(p.id, { position: 1, amount_minor: null, pct_bp: 2500 });
    await env.DB.prepare("UPDATE milestones SET status = 'invoiced' WHERE id = ?").bind(m.id).run();
    const res = await call(`/projects/${p.id}`, {
      method: "PATCH",
      cookie: o.cookie,
      body: { expectedUpdatedAt: p.updatedAt, budgetMinor: 1 },
    });
    expect(await code(res)).toBe("budget_locked");
    expect(await countOf("audit_log", "action = 'project.update' AND entity_id = ?", p.id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the project version always moves [ADM-PRJ-01]", () => {
  it("a status move in the same millisecond as the last change still moves updated_at", async () => {
    const o = await owner();
    const future = Date.now() + 60_000;
    const p = await mkProject(await mkClient(), { status: "planned", updated_at: future });
    const res = await call(`/projects/${p.id}/status`, { cookie: o.cookie, body: { to: "active" } });
    expect(res.status).toBe(200);
    const stored = ((await one("SELECT updated_at FROM projects WHERE id = ?", p.id)) as J).updated_at;
    expect(stored).toBeGreaterThan(future);
    // the version the response carries is the stored one (re-check L4)
    expect((await json(res)).updatedAt).toBe(stored);
    // a second move in the same instant moves it again
    const again = await call(`/projects/${p.id}/status`, { cookie: o.cookie, body: { to: "on_hold" } });
    expect(again.status).toBe(200);
    const returned = (await json(again)).updatedAt;
    expect(returned).toBe(
      ((await one("SELECT updated_at FROM projects WHERE id = ?", p.id)) as J).updated_at,
    );
    expect(returned).toBeGreaterThan(stored);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the data-subject export has the client's notes and files for an individual's last contact [ADM-CLI-05]", () => {
  it("lists notes and files (metadata only) in the manifest and returns them paged, never another client's", async () => {
    const o = await owner();
    const { clientId, contact, p } = await individual();
    for (let i = 0; i < 52; i++)
      await mkNote(clientId, { body_md: `Note body ${i}`, project_id: i === 0 ? p.id : null });
    const f = await mkFile(clientId, { projectId: p.id, filename: "brief.pdf" });
    const other = await mkClient({ type: "individual" });
    await mkNote(other, { body_md: "OTHER CLIENT NOTE" });
    await mkFile(other, { filename: "other.pdf" });

    const summary = await json(await exportPart(o.cookie, contact.id));
    expect(summary.manifest).toEqual(expect.arrayContaining(["notes", "files"]));

    const first = await json(await exportPart(o.cookie, contact.id, { part: "notes" }));
    expect(first.items).toHaveLength(50);
    expect(first.next).not.toBeNull();
    const second = await json(await exportPart(o.cookie, contact.id, { part: "notes", after: first.next }));
    expect(second.items).toHaveLength(2);
    const all = [...first.items, ...second.items];
    expect(new Set(all.map((n: J) => n.id)).size).toBe(52);
    expect(JSON.stringify(all)).not.toContain("OTHER CLIENT NOTE");
    expect(Object.keys(all[0]).sort()).toEqual(["body", "created_at", "id", "project_code", "visibility"]);
    expect(all.filter((n: J) => n.project_code !== null)).toHaveLength(1);

    const files = await json(await exportPart(o.cookie, contact.id, { part: "files" }));
    expect(files.items).toHaveLength(1);
    expect(files.items[0]).toMatchObject({ id: f.id, filename: "brief.pdf", shared: 0 });
    expect(Object.keys(files.items[0]).sort()).toEqual([
      "created_at",
      "filename",
      "id",
      "mime",
      "project_code",
      "sha256",
      "shared",
      "size",
    ]);
    expect(JSON.stringify(files)).not.toMatch(/r2_key|files\//);
  });

  it("is absent for a business client and for an individual's contact that is not the last live one", async () => {
    const o = await owner();
    const biz = await mkClient();
    const bc = await mkContact(biz);
    await mkNote(biz, { body_md: "business note" });
    expect((await json(await exportPart(o.cookie, bc.id))).manifest).not.toContain("notes");
    expect((await json(await exportPart(o.cookie, bc.id))).manifest).not.toContain("files");
    expect((await exportPart(o.cookie, bc.id, { part: "notes" })).status).toBe(400);
    expect((await exportPart(o.cookie, bc.id, { part: "files" })).status).toBe(400);

    const ind = await mkClient({ type: "individual" });
    const a = await mkContact(ind);
    await mkContact(ind);
    await mkNote(ind, { body_md: "shared household note" });
    expect((await json(await exportPart(o.cookie, a.id))).manifest).not.toContain("notes");
    expect((await exportPart(o.cookie, a.id, { part: "notes" })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("an anonymised individual client takes nothing new [ADM-PRJ-01..04; Researched 2026-10-28, DPDP Act s.8(7) and s.12(3) (08-C RB-11)]", () => {
  it("refuses notes, files, projects and milestone writes with 409 client_anonymised, and says so in the detail responses", async () => {
    const o = await owner();
    const { clientId, contact, p, m1, m2 } = await individual();
    const before = {
      notes: await countOf("notes"),
      files: await countOf("files"),
      projects: await countOf("projects"),
      milestones: await countOf("milestones"),
    };
    // alive: everything works and nothing is flagged
    expect((await json(await call(`/clients/${clientId}`, { cookie: o.cookie }))).anonymised).toBe(false);
    expect((await json(await call(`/projects/${p.id}`, { cookie: o.cookie }))).clientAnonymised).toBe(false);

    expect((await erase(o.cookie, contact.id)).status).toBe(200);
    expect((await json(await call(`/clients/${clientId}`, { cookie: o.cookie }))).anonymised).toBe(true);
    expect((await json(await call(`/projects/${p.id}`, { cookie: o.cookie }))).clientAnonymised).toBe(true);

    const refused = async (res: Response) => {
      expect(res.status, await res.clone().text()).toBe(409);
      expect(await code(res)).toBe("client_anonymised");
    };
    await refused(await call(`/clients/${clientId}/notes`, { cookie: o.cookie, body: { bodyMd: "x" } }));
    await refused(await call(`/projects/${p.id}/notes`, { cookie: o.cookie, body: { bodyMd: "x" } }));
    await refused(await upload(`/clients/${clientId}/files`, PDF_BYTES, { cookie: o.cookie }));
    await refused(await upload(`/projects/${p.id}/files`, PDF_BYTES, { cookie: o.cookie }));
    await refused(await call("/projects", { cookie: o.cookie, body: { clientId, name: "New" } }));
    await refused(
      await call(`/projects/${p.id}`, {
        method: "PATCH",
        cookie: o.cookie,
        body: {
          expectedUpdatedAt: ((await one("SELECT updated_at FROM projects WHERE id = ?", p.id)) as J)
            .updated_at,
          name: "Z",
        },
      }),
    );
    await refused(
      await call(`/projects/${p.id}/milestones`, { cookie: o.cookie, body: { title: "M", amountMinor: 5 } }),
    );
    await refused(
      await call(`/milestones/${m1.id}`, {
        method: "PATCH",
        cookie: o.cookie,
        body: {
          expectedUpdatedAt: ((await one("SELECT updated_at FROM milestones WHERE id = ?", m1.id)) as J)
            .updated_at,
          title: "Z",
        },
      }),
    );
    await refused(
      await call(`/milestones/${m1.id}/status`, { cookie: o.cookie, body: { to: "ready_to_bill" } }),
    );
    await refused(
      await call(`/projects/${p.id}/milestones/order`, { cookie: o.cookie, body: { ids: [m2.id, m1.id] } }),
    );

    // the status move and the milestone delete are guarded too (re-check M2)
    await refused(await call(`/projects/${p.id}/status`, { cookie: o.cookie, body: { to: "cancelled" } }));
    await refused(await call(`/milestones/${m1.id}`, { method: "DELETE", cookie: o.cookie }));
    // and so are the client's own edits and a new contact (re-check M1)
    const stamp = async () =>
      ((await one("SELECT updated_at FROM clients WHERE id = ?", clientId)) as J).updated_at;
    await refused(
      await call(`/clients/${clientId}`, {
        method: "PATCH",
        cookie: o.cookie,
        body: { expectedUpdatedAt: await stamp(), displayName: "Pat Private again" },
      }),
    );
    await refused(
      await call(`/clients/${clientId}/billing`, {
        method: "PATCH",
        cookie: o.cookie,
        body: { expectedUpdatedAt: await stamp(), paymentTermsDays: 30 },
      }),
    );
    await refused(
      await call(`/clients/${clientId}/contacts`, {
        cookie: o.cookie,
        body: { name: "Someone New", email: "new.person@example.test" },
      }),
    );
    expect(await countOf("contacts", "client_id = ? AND anonymised_at IS NULL", clientId)).toBe(0);

    expect(await countOf("notes")).toBe(before.notes);
    expect(await countOf("files")).toBe(before.files);
    expect(await countOf("projects")).toBe(before.projects);
    expect(await countOf("milestones")).toBe(before.milestones);
    expect(await one("SELECT status FROM milestones WHERE id = ?", m1.id)).toEqual({ status: "pending" });
  });

  it("is stored, so a renamed, retyped or re-contacted client stays locked, and a client merely named 'Removed client' is not", async () => {
    const o = await owner();
    const { clientId, contact } = await individual();
    expect((await erase(o.cookie, contact.id)).status).toBe(200);
    expect(
      ((await one("SELECT anonymised_at FROM clients WHERE id = ?", clientId)) as J).anonymised_at,
    ).not.toBeNull();
    // any later change to the row (here straight in the database) cannot unlock it
    await env.DB.prepare("UPDATE clients SET display_name = 'Acme Ltd', type = 'business' WHERE id = ?")
      .bind(clientId)
      .run();
    await mkContact(clientId);
    const res = await call(`/clients/${clientId}/notes`, { cookie: o.cookie, body: { bodyMd: "x" } });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("client_anonymised");
    expect((await json(await call(`/clients/${clientId}`, { cookie: o.cookie }))).anonymised).toBe(true);

    // only the stored state counts: a client with that name and no contacts stays writable
    for (const type of ["individual", "business"]) {
      const named = await mkClient({ type, legal_name: "Removed client", display_name: "Removed client" });
      expect((await json(await call(`/clients/${named}`, { cookie: o.cookie }))).anonymised).toBe(false);
      expect(
        (await call(`/clients/${named}/notes`, { cookie: o.cookie, body: { bodyMd: "fine" } })).status,
      ).toBe(201);
      expect(
        (await call("/projects", { cookie: o.cookie, body: { clientId: named, name: "P" } })).status,
      ).toBe(201);
    }
  });

  it("never affects a business client, an individual with a live contact, or an individual that has no contact yet", async () => {
    const o = await owner();
    const biz = await mkClient();
    const only = await mkContact(biz);
    expect((await erase(o.cookie, only.id)).status).toBe(200); // the business has no live contact now
    expect(
      (await call(`/clients/${biz}/notes`, { cookie: o.cookie, body: { bodyMd: "still fine" } })).status,
    ).toBe(201);
    expect((await call("/projects", { cookie: o.cookie, body: { clientId: biz, name: "P" } })).status).toBe(
      201,
    );
    expect((await json(await call(`/clients/${biz}`, { cookie: o.cookie }))).anonymised).toBe(false);

    const ind = await mkClient({ type: "individual" });
    await mkContact(ind);
    expect((await call(`/clients/${ind}/notes`, { cookie: o.cookie, body: { bodyMd: "ok" } })).status).toBe(
      201,
    );
    const bare = await mkClient({ type: "individual" });
    expect((await call("/projects", { cookie: o.cookie, body: { clientId: bare, name: "P" } })).status).toBe(
      201,
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the erase renames an individual client's projects and milestones [ADM-CLI-05; owner 2026-10-25, Researched 2026-10-28, DPDP Act s.8(7) and s.12(3) (08-C RB-11)]", () => {
  it("in both modes: projects take their code, milestones become Milestone 1, 2... in order; amounts, dates and statuses stay", async () => {
    const o = await owner();
    for (const mode of ["erase", "anonymise"] as const) {
      const { contact, p, m1, m2 } = await individual();
      await env.DB.prepare(
        "UPDATE milestones SET due_date = '2027-01-31', status = 'ready_to_bill' WHERE id = ?",
      )
        .bind(m2.id)
        .run();
      const code0 = ((await one("SELECT code FROM projects WHERE id = ?", p.id)) as J).code;
      expect((await erase(o.cookie, contact.id, mode)).status).toBe(200);
      expect(await one("SELECT name, status, budget_minor FROM projects WHERE id = ?", p.id)).toEqual({
        name: code0,
        status: "planned",
        budget_minor: 1_000_00,
      });
      const ms = await rows(
        "SELECT id, title, amount_minor, pct_bp, due_date, status FROM milestones WHERE project_id = ? ORDER BY position",
        p.id,
      );
      expect(ms).toEqual([
        {
          id: m1.id,
          title: "Milestone 1",
          amount_minor: 100,
          pct_bp: null,
          due_date: null,
          status: "pending",
        },
        {
          id: m2.id,
          title: "Milestone 2",
          amount_minor: null,
          pct_bp: 5000,
          due_date: "2027-01-31",
          status: "ready_to_bill",
        },
      ]);
    }
  });

  it("a business client's projects, a client with another live contact, and a client under legal hold are untouched", async () => {
    const o = await owner();
    const biz = await mkClient();
    const bc = await mkContact(biz);
    const bp = await mkProject(biz, { name: "Business project" });
    await mkMilestone(bp.id, { position: 1, title: "Business milestone" });
    expect((await erase(o.cookie, bc.id)).status).toBe(200);
    expect(await one("SELECT name FROM projects WHERE id = ?", bp.id)).toEqual({ name: "Business project" });
    expect(await one("SELECT title FROM milestones WHERE project_id = ?", bp.id)).toEqual({
      title: "Business milestone",
    });

    const { clientId, contact, p } = await individual();
    await mkContact(clientId);
    expect((await erase(o.cookie, contact.id)).status).toBe(200);
    expect(await one("SELECT name FROM projects WHERE id = ?", p.id)).toEqual({ name: "Pat's kitchen site" });

    const held = await individual();
    await env.DB.prepare("UPDATE clients SET legal_hold = 1 WHERE id = ?").bind(held.clientId).run();
    const res = await erase(o.cookie, held.contact.id);
    expect(res.status).toBe(409);
    expect(await one("SELECT name FROM projects WHERE id = ?", held.p.id)).toEqual({
      name: "Pat's kitchen site",
    });
    expect(await one("SELECT title FROM milestones WHERE id = ?", held.m1.id)).toEqual({
      title: "Pat sign-off",
    });
  });
});
