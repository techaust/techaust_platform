// Erase and anonymise clear the notes of time entries [owner answer Q7, 2026-10-25, VERIFY WITH CA/LEGAL]: when an individual client's last
// live contact goes, the notes on the time entries of its projects and care plans are removed; the minutes, the dates and who logged them
// stay. A business client's entries are untouched, and a legal hold writes nothing. Also: no audit row of the care and time routes holds
// note text.
import { describe, expect, it } from "vitest";
import { TIME_NOTE_CLEAR_SQL } from "./clients.ts";
import { longSession, mkLog, mkOpenProject, mkPlan, today } from "./test-care.ts";
import { mkClient, mkContact } from "./test-clients.ts";
import { bodyOf, call, countOf, one, rows, sessionFor } from "./test-helpers.ts";

const owner = () => sessionFor("owner", { stepUp: true });
const code = async (res: Response) => ((await bodyOf(res)) as { error: { code: string } }).error.code;
const erase = (cookie: string, id: string, mode: "erase" | "anonymise") =>
  call(`/contacts/${id}/erase`, { cookie, body: { mode, reason: "requested" } });
const noteOf = (id: string) =>
  one<{ note: string | null; minutes: number; work_date: string; user_id: string }>(
    "SELECT note, minutes, work_date, user_id FROM time_logs WHERE id = ?",
    id,
  );

/** An individual (or business) client with a project and a care plan, one time entry with a note on each. */
async function fixture(kind: "individual" | "business", clientOver: Record<string, unknown> = {}) {
  const by = await sessionFor("staff");
  const clientId = await mkClient({ type: kind, ...clientOver });
  const contact = await mkContact(clientId);
  const project = await mkOpenProject("active", clientId);
  const plan = await mkPlan(by.id, { clientId });
  const onProject = await mkLog(
    by.id,
    today(),
    60,
    { project: project.id },
    { note: "Called Asha about her mother's invoice" },
  );
  const onPlan = await mkLog(by.id, today(), 45, { plan: plan.id }, { note: "Reset the password for Asha" });
  return { by, clientId, contact, projectId: project.id, onProject: onProject.id, onPlan: onPlan.id };
}

describe("erase and anonymise: time-entry notes [Q7]", () => {
  for (const mode of ["erase", "anonymise"] as const) {
    it(`${mode}: an individual client's last contact clears the notes of its project and care-plan entries; minutes, dates and people stay`, async () => {
      const o = await owner();
      const f = await fixture("individual");
      const before = [await noteOf(f.onProject), await noteOf(f.onPlan)];
      expect(before.map((b) => b?.note)).toEqual([
        "Called Asha about her mother's invoice",
        "Reset the password for Asha",
      ]);
      const res = await erase(o.cookie, f.contact.id, mode);
      expect(res.status, await res.clone().text()).toBe(200);
      const after = [await noteOf(f.onProject), await noteOf(f.onPlan)];
      expect(after.map((a) => a?.note)).toEqual([null, null]);
      expect(after.map((a) => [a?.minutes, a?.work_date, a?.user_id])).toEqual(
        before.map((b) => [b?.minutes, b?.work_date, b?.user_id]),
      );
    });
  }

  it("a business client's entries keep their notes", async () => {
    const o = await owner();
    const f = await fixture("business");
    expect((await erase(o.cookie, f.contact.id, "anonymise")).status).toBe(200);
    expect((await noteOf(f.onProject))?.note).toBe("Called Asha about her mother's invoice");
    expect((await noteOf(f.onPlan))?.note).toBe("Reset the password for Asha");
  });

  it("an individual client with another live contact is not its last contact: the notes stay", async () => {
    const o = await owner();
    const f = await fixture("individual");
    await mkContact(f.clientId);
    expect((await erase(o.cookie, f.contact.id, "anonymise")).status).toBe(200);
    expect((await noteOf(f.onProject))?.note).toBe("Called Asha about her mother's invoice");
    expect((await noteOf(f.onPlan))?.note).toBe("Reset the password for Asha");
  });

  it("only that client's entries are touched: another individual's notes stay", async () => {
    const o = await owner();
    const f = await fixture("individual");
    const other = await fixture("individual");
    expect((await erase(o.cookie, f.contact.id, "erase")).status).toBe(200);
    expect((await noteOf(other.onProject))?.note).toBe("Called Asha about her mother's invoice");
    expect((await noteOf(other.onPlan))?.note).toBe("Reset the password for Asha");
  });

  it("a held client writes nothing: 409 legal_hold and every note stays", async () => {
    const o = await owner();
    const f = await fixture("individual", { legal_hold: 1 });
    const audit = await countOf("audit_log");
    const res = await erase(o.cookie, f.contact.id, "anonymise");
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("legal_hold");
    expect((await noteOf(f.onProject))?.note).toBe("Called Asha about her mother's invoice");
    expect((await noteOf(f.onPlan))?.note).toBe("Reset the password for Asha");
    expect(await countOf("audit_log")).toBe(audit);
  });

  it("entries with no note are left alone, and an entry's version moves only when a note was cleared", async () => {
    const o = await owner();
    const f = await fixture("individual");
    const quiet = await mkLog(
      f.by.id,
      today(),
      15,
      {
        project: f.projectId,
      },
      { note: null },
    );
    const before = await one<{ updated_at: number }>(
      "SELECT updated_at FROM time_logs WHERE id = ?",
      quiet.id,
    );
    expect((await erase(o.cookie, f.contact.id, "anonymise")).status).toBe(200);
    expect(
      (await one<{ updated_at: number }>("SELECT updated_at FROM time_logs WHERE id = ?", quiet.id))
        ?.updated_at,
    ).toBe(before?.updated_at);
    expect(
      (await one<{ updated_at: number }>("SELECT updated_at FROM time_logs WHERE id = ?", f.onProject))
        ?.updated_at,
    ).toBeGreaterThan(0);
  });
});

describe("the note-clearing statement uses indexes, with time_logs_care_plan_date gone [early check L5]", () => {
  it("each side of the OR is a SEARCH on time_logs (project/date and care usage), never a SCAN", async () => {
    const plan = (
      await rows<{ detail: string }>(
        `EXPLAIN QUERY PLAN ${TIME_NOTE_CLEAR_SQL("EXISTS (SELECT 1 FROM audit_log WHERE id = ?3)")}`,
        "contact-x",
        1,
        "audit-x",
      )
    )
      .map((r) => r.detail)
      .join("\n");
    expect(plan).not.toMatch(/SCAN time_logs/);
    expect(plan).toMatch(/SEARCH time_logs USING (COVERING )?INDEX time_logs_project_date/);
    expect(plan).toMatch(/SEARCH time_logs USING (COVERING )?INDEX time_logs_care_usage/);
  });
});

describe("after an erase, an entry of the client takes no new text [early check H1]", () => {
  const version = async (id: string) =>
    (await one<{ updated_at: number }>("SELECT updated_at FROM time_logs WHERE id = ?", id))?.updated_at ?? 0;
  const patch = async (cookie: string, id: string, fields: Record<string, unknown>) =>
    call(`/time/${id}`, {
      cookie,
      method: "PATCH",
      body: { expectedUpdatedAt: await version(id), ...fields },
    });

  for (const target of ["onProject", "onPlan"] as const) {
    it(`${target}: PATCH note or minutes is 409 client_anonymised (the note stays NULL, nothing is written); DELETE still works`, async () => {
      const o = await owner();
      const f = await fixture("individual");
      expect((await erase(o.cookie, f.contact.id, "anonymise")).status).toBe(200);
      const id = f[target];
      const audit = await countOf("audit_log");
      const v = await version(id);
      const noteRes = await patch(f.by.cookie, id, { note: "Asha called again about her mother" });
      expect(noteRes.status, await noteRes.clone().text()).toBe(409);
      expect(await code(noteRes)).toBe("client_anonymised");
      const minRes = await patch(f.by.cookie, id, { minutes: 90 });
      expect(minRes.status).toBe(409);
      expect(await code(minRes)).toBe("client_anonymised");
      // the owner is held to it too
      expect((await patch(o.cookie, id, { note: "owner note" })).status).toBe(409);
      expect(await noteOf(id)).toMatchObject({ note: null });
      expect(await version(id)).toBe(v);
      expect(await countOf("audit_log")).toBe(audit);
      const del = await call(`/time/${id}?expectedUpdatedAt=${v}`, { cookie: f.by.cookie, method: "DELETE" });
      expect(del.status, await del.clone().text()).toBe(200);
      expect(await noteOf(id)).toBeNull();
    });
  }

  it("a business client's entry still takes a note edit", async () => {
    const f = await fixture("business");
    const res = await patch(f.by.cookie, f.onProject, { note: "fine" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await noteOf(f.onProject))?.note).toBe("fine");
  });
});

describe("audit hygiene: no note text in any audit row", () => {
  it("create, update, delete and the plan routes write ids and field names, never the note", async () => {
    const s = await longSession("staff");
    const o = await sessionFor("owner", { stepUp: true });
    const p = await mkOpenProject();
    const SECRET = "the-note-text-nobody-should-copy";
    const made = (await (
      await call("/time", {
        cookie: s.cookie,
        body: { workDate: today(), minutes: 60, projectId: p.id, billable: true, note: SECRET },
      })
    ).json()) as { id: string; updatedAt: number };
    const upd = (await (
      await call(`/time/${made.id}`, {
        cookie: s.cookie,
        method: "PATCH",
        body: { expectedUpdatedAt: made.updatedAt, note: `${SECRET} again`, minutes: 75 },
      })
    ).json()) as { updatedAt: number };
    expect(
      (
        await call(`/time/${made.id}?expectedUpdatedAt=${upd.updatedAt}`, {
          cookie: s.cookie,
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
    const client = await mkClient();
    const plan = (await (
      await call("/care-plans", {
        cookie: o.cookie,
        body: {
          clientId: client,
          tier: "essential",
          priceMinor: 1,
          includedMinutes: 120,
          rollover: "none",
          startDate: "2026-01-01",
          billingDay: 1,
        },
      })
    ).json()) as { id: string; updatedAt: number };
    await call(`/care-plans/${plan.id}/terms`, {
      cookie: o.cookie,
      body: { expectedUpdatedAt: plan.updatedAt, priceMinor: 2 },
    });
    const text = JSON.stringify(
      await rows("SELECT summary FROM audit_log WHERE action LIKE 'time.%' OR action LIKE 'care_plan.%'"),
    );
    expect(text).not.toContain(SECRET);
    expect(text).toContain(made.id);
    // and the access log carries routes and statuses only
    expect(JSON.stringify(await rows("SELECT route, status FROM access_log"))).not.toContain(SECRET);
  });
});
