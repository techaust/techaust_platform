// Leads API [ADM-LEAD-01..03, 06]: manual leads, list and board, the lead page, edits, notes, stages and replies.
// Permissions per role for every route are in rbac.test.ts (generic loops over ROUTES); the audit row of every mutation too.
// Conversion is in leads.test.ts. Tests in one file share a database, so each makes its own leads and finds them by reference.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { deleteAfter } from "@techaust/core/lead-lifecycle";
import { beforeAll, describe, expect, it } from "vitest";
import { SEARCH_PLAN_SQL } from "./leads.ts";
import { mkItem } from "./test-catalogue.ts";
import { call, captureQueue, countOf, one, rows, sessionFor, withEnv } from "./test-helpers.ts";

// M4.1: a lead's service name is read from catalogue_items (no seed import), so the item the leads point at exists here.
beforeAll(async () => {
  await mkItem({ code: "S5", name: "Custom Web Apps & Business Portals" });
});

// biome-ignore lint/suspicious/noExplicitAny: response bodies in tests are read loosely
type J = Record<string, any>;
const json = async (res: Response): Promise<J> => (await res.json()) as J;
const DAY = 86_400_000;

let seq = 0;
/** A lead straight in the database (any column can be set), so a test controls its dates. */
async function addLead(over: Record<string, unknown> = {}) {
  const n = ++seq;
  const v: Record<string, unknown> = {
    id: uuidv7(),
    ref: `L-A${String(n).padStart(4, "0")}`,
    source: "web",
    contact_name: `Lead Person ${n}`,
    contact_email: `lead${n}@example.com`,
    created_at: Date.now() + n,
    updated_at: Date.now() + n,
    last_activity_at: Date.now() + n,
    ...over,
  };
  const cols = Object.keys(v);
  await env.DB.prepare(
    `INSERT INTO leads (${cols.join(", ")}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(", ")})`,
  )
    .bind(...Object.values(v))
    .run();
  return v as { id: string; ref: string; contact_email: string; updated_at: number };
}

const get = (path: string, cookie: string) => call(path, { cookie });
const send = (path: string, method: string, body: unknown, cookie: string, rid?: string) =>
  call(path, { method, body, cookie, ...(rid ? { headers: { "cf-ray": rid } } : {}) });

describe("POST /leads: a lead entered by hand [ADM-LEAD-01]", () => {
  it("makes a manual lead with a non-sequential reference, a timeline row and an audit row with the reference only", async () => {
    const s = await sessionFor("sales");
    const rid = `ray-${crypto.randomUUID()}`;
    const res = await send(
      "/leads",
      "POST",
      {
        name: "Meera Iyer",
        email: "  Meera@Example.COM ",
        company: "Iyer Mills",
        serviceCode: "S5",
        country: "IN",
        message: "Phone enquiry",
      },
      s.cookie,
      rid,
    );
    expect(res.status).toBe(201);
    const { id, ref } = await json(res);
    expect(ref).toMatch(/^L-[0-9A-HJKMNP-TV-Z]{5}$/);
    const lead = await one<Record<string, unknown>>("SELECT * FROM leads WHERE id = ?", id);
    expect(lead).toMatchObject({
      source: "manual",
      stage: "new",
      contact_name: "Meera Iyer",
      contact_email: "meera@example.com",
      contact_company: "Iyer Mills",
      service_code: "S5",
      contact_country: "IN",
      consent: null,
    });
    expect(lead?.delete_after).toBe(deleteAfter(lead?.last_activity_at as number, 12));
    expect(await rows("SELECT kind, actor_id FROM lead_activities WHERE lead_id = ?", id)).toEqual([
      { kind: "created", actor_id: s.id },
    ]);
    const audit = await rows<{ summary: string }>("SELECT summary FROM audit_log WHERE request_id = ?", rid);
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.summary ?? "{}")).toEqual({ ref });
  });

  it("tells everyone who may read leads except the person who made it (the bell)", async () => {
    await env.DB.prepare("DELETE FROM notifications").run();
    const maker = await sessionFor("staff");
    const owner = await sessionFor("owner");
    const sales = await sessionFor("sales");
    const accountant = await sessionFor("accountant");
    const res = await send("/leads", "POST", { name: "Bell Test", email: "bell@example.com" }, maker.cookie);
    const { id } = await json(res);
    const got = await rows<{ user_id: string; title: string; link: string }>(
      "SELECT user_id, title, link FROM notifications WHERE entity_id = ? AND kind = 'lead.new'",
      id,
    );
    const users = got.map((g) => g.user_id);
    expect(users).toContain(owner.id);
    expect(users).toContain(sales.id);
    expect(users).not.toContain(maker.id);
    expect(users).not.toContain(accountant.id);
    expect(got[0]?.title).toBe("New lead: Bell Test, General enquiry");
    expect(got[0]?.link).toBe(`/leads/${id}`);
  });

  it("links a repeat of the same email within 30 days to the earlier lead, never merging", async () => {
    const s = await sessionFor("owner");
    const first = await json(
      await send("/leads", "POST", { name: "Dup One", email: "dup@example.com" }, s.cookie),
    );
    const second = await json(
      await send("/leads", "POST", { name: "Dup Two", email: "DUP@example.com" }, s.cookie),
    );
    expect(await one("SELECT duplicate_of FROM leads WHERE id = ?", second.id)).toEqual({
      duplicate_of: first.id,
    });
    expect(await one("SELECT duplicate_of FROM leads WHERE id = ?", first.id)).toEqual({
      duplicate_of: null,
    });
    expect(await countOf("leads", "contact_email = 'dup@example.com'")).toBe(2);
  });

  it("refuses a bad body, an unknown service, a made-up country and an inactive owner", async () => {
    const s = await sessionFor("owner");
    const bad = [
      {},
      { name: "X", email: "not-an-email" },
      { name: "X", email: "x@example.com", serviceCode: "S99" },
      { name: "X", email: "x@example.com", country: "ZZ" },
      { name: "X", email: "x@example.com", ownerId: "no-such-member" },
    ];
    for (const b of bad) expect((await send("/leads", "POST", b, s.cookie)).status).toBe(400);
  });

  it("FX-3 (A3 8): carries a budget band, a timeline and a currency from the quote form's lists", async () => {
    const s = await sessionFor("sales");
    const made = async (extra: Record<string, unknown>) => {
      const res = await send(
        "/leads",
        "POST",
        { name: "Band Lead", email: `band-${crypto.randomUUID()}@example.com`, ...extra },
        s.cookie,
      );
      return { status: res.status, body: res.status === 201 ? await json(res) : null };
    };
    const inr = await made({ currency: "INR", budgetBand: "3l-7l", timeline: "1-3-months" });
    expect(inr.status).toBe(201);
    expect(await one("SELECT currency, budget_band, timeline FROM leads WHERE id = ?", inr.body?.id)).toEqual(
      { currency: "INR", budget_band: "3l-7l", timeline: "1-3-months" },
    );
    // the lead page shows them (with core's labels in the SPA)
    const page = await json(await call(`/leads/${inr.body?.id}`, { cookie: s.cookie }));
    expect(page.lead).toMatchObject({ currency: "INR", budgetBand: "3l-7l", timeline: "1-3-months" });
    const usd = await made({ currency: "USD", budgetBand: "not-sure", timeline: "exploring" });
    expect(usd.status).toBe(201);
    // each one alone, and none at all, is fine
    for (const extra of [
      { currency: "USD" },
      { timeline: "asap" },
      {},
      { currency: null, budgetBand: null, timeline: null },
    ])
      expect((await made(extra)).status, JSON.stringify(extra)).toBe(201);
    const before = await countOf("leads");
    for (const extra of [
      { budgetBand: "3l-7l" }, // a band without its currency
      { currency: "USD", budgetBand: "3l-7l" }, // a rupee band in dollars
      { currency: "INR", budgetBand: "toString" },
      { currency: "EUR" },
      { timeline: "next-year" },
      { timeline: "__proto__" },
    ])
      expect((await made(extra)).status, JSON.stringify(extra)).toBe(400);
    expect(await countOf("leads")).toBe(before);
  });

  it("refuses a retired service code and writes nothing; once it is active again the lead is made (review finding 6)", async () => {
    const s = await sessionFor("owner");
    const retired = await mkItem({ active: 0 });
    const before = await countOf("leads");
    const body = { name: "Retired Ask", email: "retired-ask@example.com", serviceCode: retired.code };
    const refused = await send("/leads", "POST", body, s.cookie);
    expect(refused.status).toBe(400);
    expect(await countOf("leads")).toBe(before);
    await env.DB.prepare("UPDATE catalogue_items SET active = 1 WHERE code = ?1").bind(retired.code).run();
    const made = await send("/leads", "POST", body, s.cookie);
    expect(made.status).toBe(201);
    expect(await countOf("leads")).toBe(before + 1);
    // 'not-sure' needs no catalogue row and is still accepted.
    const notSure = await send(
      "/leads",
      "POST",
      { name: "Not Sure", email: "not-sure-ask@example.com", serviceCode: "not-sure" },
      s.cookie,
    );
    expect(notSure.status).toBe(201);
  });
});

describe("the service name comes from the catalogue (M4.1)", () => {
  it("shows a renamed item's new name in the list, words '&' as 'and', and accepts 'not-sure'", async () => {
    const s = await sessionFor("owner");
    const lead = await addLead({ service_code: "S5" });
    const names = async () =>
      (await json(await get(`/leads?q=${lead.ref}`, s.cookie))).leads.map((l: J) => l.serviceName);
    expect(await names()).toEqual(["Custom Web Apps and Business Portals"]);
    await env.DB.prepare(
      "UPDATE catalogue_items SET name = 'Renamed Portals & Apps' WHERE code = 'S5'",
    ).run();
    expect(await names()).toEqual(["Renamed Portals and Apps"]);
    const notSure = await addLead({ service_code: "not-sure" });
    expect((await json(await get(`/leads?q=${notSure.ref}`, s.cookie))).leads[0].serviceName).toBe(
      "Not sure yet",
    );
    const made = await send(
      "/leads",
      "POST",
      { name: "X", email: "ns@example.com", serviceCode: "not-sure" },
      s.cookie,
    );
    expect(made.status).toBe(201);
    await env.DB.prepare(
      "UPDATE catalogue_items SET name = 'Custom Web Apps & Business Portals' WHERE code = 'S5'",
    ).run();
  });
});

describe("GET /leads: the list [ADM-LEAD-02]", () => {
  it("pages by keyset (25 or 50), newest first, with next and prev", async () => {
    const s = await sessionFor("owner");
    const tag = `Pager${Date.now()}`;
    for (let i = 0; i < 30; i++) await addLead({ contact_company: tag, service_code: "S77" });
    const first = await json(await get(`/leads?service=S77&limit=25`, s.cookie));
    expect(first.leads).toHaveLength(25);
    expect(first.next).toBeTruthy();
    expect(first.prev).toBeNull();
    const second = await json(await get(`/leads?service=S77&limit=25&after=${first.next}`, s.cookie));
    expect(second.leads).toHaveLength(5);
    expect(second.next).toBeNull();
    expect(second.prev).toBeTruthy();
    const back = await json(await get(`/leads?service=S77&limit=25&before=${second.prev}`, s.cookie));
    expect(back.leads.map((l: J) => l.id)).toEqual(first.leads.map((l: J) => l.id));
    const created = first.leads.map((l: J) => l.createdAt);
    expect(created).toEqual([...created].sort((a, b) => b - a));
    expect((await get(`/leads?after=junk`, s.cookie)).status).toBe(400);
    expect((await get(`/leads?limit=100`, s.cookie)).status).toBe(400);
  });

  it("filters by stage, owner, source, service and overdue next action", async () => {
    const s = await sessionFor("owner");
    const member = await sessionFor("staff");
    const code = `S${60 + (++seq % 30)}`;
    const mine = await addLead({
      service_code: code,
      owner_id: member.id,
      stage: "qualified",
      source: "manual",
    });
    const overdue = await addLead({ service_code: code, next_action_at: Date.now() - DAY, stage: "new" });
    const future = await addLead({ service_code: code, next_action_at: Date.now() + DAY, stage: "new" });
    const wonOverdue = await addLead({ service_code: code, next_action_at: Date.now() - DAY, stage: "won" });
    const ids = async (q: string) =>
      (await json(await get(`/leads?service=${code}&${q}`, s.cookie))).leads.map((l: J) => l.id);
    expect(await ids("stage=qualified")).toEqual([mine.id]);
    expect(await ids(`owner=${member.id}`)).toEqual([mine.id]);
    expect((await ids("owner=none")).sort()).toEqual([overdue.id, future.id, wonOverdue.id].sort());
    expect(await ids("source=manual")).toEqual([mine.id]);
    expect(await ids("overdue=1")).toEqual([overdue.id]); // a won lead's old date is not "overdue"
    const l = (await json(await get(`/leads?service=${code}&overdue=1`, s.cookie))).leads[0];
    expect(l.nextActionOverdue).toBe(true);
  });

  it("sorts by last activity or by next action (leads without one are not in that order)", async () => {
    const s = await sessionFor("owner");
    const code = `S${40 + (++seq % 19)}`;
    const a = await addLead({
      service_code: code,
      last_activity_at: 1000,
      next_action_at: Date.now() + 3 * DAY,
    });
    const b = await addLead({ service_code: code, last_activity_at: 3000, next_action_at: Date.now() + DAY });
    const c = await addLead({ service_code: code, last_activity_at: 2000 });
    const order = async (q: string) =>
      (await json(await get(`/leads?service=${code}&${q}`, s.cookie))).leads.map((l: J) => l.id);
    expect(await order("sort=activity")).toEqual([b.id, c.id, a.id]);
    expect(await order("sort=activity&dir=asc")).toEqual([a.id, c.id, b.id]);
    expect(await order("sort=next_action")).toEqual([b.id, a.id]); // soonest first
  });

  it("searches by the start of a name, email, company or reference, without case, on indexes", async () => {
    const s = await sessionFor("owner");
    const x = await addLead({
      contact_name: "Quentin Zeller",
      contact_email: "qz@zellermail.example",
      contact_company: "Zeller Foundry",
    });
    const find = async (q: string) =>
      (await json(await get(`/leads?q=${encodeURIComponent(q)}`, s.cookie))).leads.map((l: J) => l.id);
    expect(await find("quentin z")).toContain(x.id);
    expect(await find("ZELLER F")).toContain(x.id);
    expect(await find("qz@zeller")).toContain(x.id);
    expect(await find(x.ref.toLowerCase())).toContain(x.id);
    expect(await find("nothing-like-this")).toEqual([]);
    const { sql, bind } = SEARCH_PLAN_SQL("abc");
    const plan = (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...bind))
      .map((r) => r.detail)
      .join("\n");
    for (const index of ["leads_ref", "leads_email", "leads_name_nocase", "leads_company_nocase"])
      expect(plan).toContain(index);
    expect(plan).not.toMatch(/SCAN (leads|l)(?! USING)/);
  });

  it("the scheduled-for-deletion view (also the dry-run report) lists open leads due within 14 days, soonest first", async () => {
    const s = await sessionFor("owner");
    await env.DB.prepare(
      "INSERT OR IGNORE INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES ('c-del', 'CDEL', 'Del', 'Del', 'business', 'IN', 'unregistered', '19', 'INR')",
    ).run();
    const soon = await addLead({ delete_after: Date.now() + 2 * DAY });
    const sooner = await addLead({ delete_after: Date.now() + DAY });
    const pastDue = await addLead({ delete_after: Date.now() - DAY });
    await addLead({ delete_after: Date.now() + 30 * DAY });
    await addLead({ delete_after: Date.now() + DAY, legal_hold: 1 });
    await addLead({ delete_after: Date.now() + DAY, client_id: "c-del" });
    const res = await json(await get("/leads?deletion=1", s.cookie));
    const got = res.leads.map((l: J) => l.id);
    expect(got.indexOf(pastDue.id)).toBeLessThan(got.indexOf(sooner.id));
    expect(got.indexOf(sooner.id)).toBeLessThan(got.indexOf(soon.id));
    expect(res.leads.every((l: J) => l.scheduledForDeletion && !l.legalHold && l.clientId === null)).toBe(
      true,
    );
    // The test config's LEAD_PURGE_MODE is the wrangler.jsonc dry_run: the view says nothing is deleted yet (owner, 2026-10-24).
    expect(res.purgeMode).toBe("dry_run");
    expect((await json(await get("/leads", s.cookie))).purgeMode).toBeUndefined();
    const plan = (
      await rows<{ detail: string }>(
        "EXPLAIN QUERY PLAN SELECT l.id FROM leads AS l INDEXED BY leads_delete_due WHERE l.client_id IS NULL AND l.legal_hold = 0 AND l.delete_after <= 5 ORDER BY l.delete_after, l.id",
      )
    )
      .map((r) => r.detail)
      .join(" ");
    expect(plan).toContain("leads_delete_due");
  });
});

describe("GET /leads/board", () => {
  it("counts every stage and gives the first page of each, newest activity first", async () => {
    const s = await sessionFor("sales");
    await addLead({ stage: "qualified", last_activity_at: 5 });
    await addLead({ stage: "lost", lost_reason: "price" });
    const board = await json(await get("/leads/board", s.cookie));
    expect(board.stages.map((x: J) => x.stage)).toEqual(["new", "qualified", "proposal_sent", "won", "lost"]);
    for (const st of board.stages) {
      const real = await one<{ n: number }>("SELECT count(*) AS n FROM leads WHERE stage = ?", st.stage);
      expect(st.count).toBe(real?.n);
      expect(st.leads.length).toBeLessThanOrEqual(25);
      const times = st.leads.map((l: J) => l.lastActivityAt);
      expect(times).toEqual([...times].sort((a: number, b: number) => b - a));
    }
    const lost = board.stages.find((x: J) => x.stage === "lost");
    expect(lost.leads[0].lostReason).toBe("price");
  });
});

describe("GET /leads/:id: the lead page [ADM-LEAD-03]", () => {
  it("returns the lead, its timeline (newest first, paged), the linked duplicates, the client and the draft", async () => {
    const s = await sessionFor("sales");
    const first = await addLead({ contact_email: "page@example.com" });
    const second = await addLead({ contact_email: "page@example.com", duplicate_of: first.id });
    for (let i = 0; i < 30; i++)
      await env.DB.prepare(
        "INSERT INTO lead_activities (id, lead_id, kind, body, created_at) VALUES (?1, ?2, 'note', ?3, ?4)",
      )
        .bind(uuidv7(), second.id, `note ${i}`, 1_000 + i)
        .run();
    const page = await json(await get(`/leads/${second.id}`, s.cookie));
    expect(page.lead).toMatchObject({
      id: second.id,
      ref: second.ref,
      duplicateOf: first.id,
      updatedAt: second.updated_at,
    });
    expect(page.duplicates).toEqual([
      expect.objectContaining({ id: first.id, ref: first.ref, relation: "earlier" }),
    ]);
    expect(page.timeline.items).toHaveLength(25);
    expect(page.timeline.items[0].body).toBe("note 29");
    const more = await json(
      await get(`/leads/${second.id}/activities?after=${page.timeline.next}`, s.cookie),
    );
    expect(more.items).toHaveLength(5);
    expect(more.next).toBeNull();
    // the earlier lead sees the later one
    const back = await json(await get(`/leads/${first.id}`, s.cookie));
    expect(back.duplicates).toEqual([expect.objectContaining({ id: second.id, relation: "later" })]);
    expect(page.client).toBeNull();
    expect((await get("/leads/no-such-lead", s.cookie)).status).toBe(404);
    expect((await get("/leads/no-such-lead/activities", s.cookie)).status).toBe(404);
    expect((await get(`/leads/${first.id}/activities?after=junk`, s.cookie)).status).toBe(400);
  });
});

describe("PATCH /leads/:id [ADM-LEAD-03]", () => {
  it("FX-3 round 2 (ADM-LEAD-01): a manual lead's currency, budget band and timeline change with the creation checks; a website lead's are fixed", async () => {
    const s = await sessionFor("sales");
    const lead = await addLead({ source: "manual", currency: "INR", budget_band: "3l-7l", timeline: "asap" });
    const quote = () => one("SELECT currency, budget_band, timeline FROM leads WHERE id = ?", lead.id);
    let at = lead.updated_at;
    const patch = async (extra: Record<string, unknown>) => {
      const res = await send(`/leads/${lead.id}`, "PATCH", { expectedUpdatedAt: at, ...extra }, s.cookie);
      const out = await json(res);
      if (res.status === 200) at = out.updatedAt;
      return { status: res.status, out };
    };
    // a band of the same currency, and the timeline
    expect((await patch({ budgetBand: "7l-15l", timeline: "1-3-months" })).status).toBe(200);
    expect(await quote()).toEqual({ currency: "INR", budget_band: "7l-15l", timeline: "1-3-months" });
    // the band the lead holds must stay one of its currency's: a currency change alone is refused, both together are fine
    const before = await quote();
    for (const extra of [
      { currency: "USD" }, // the stored rupee band in dollars
      { currency: null }, // a band without its currency
      { budgetBand: "2k-5k" }, // a dollar band on a rupee lead
      { currency: "USD", budgetBand: "3l-7l" },
      { budgetBand: "toString" },
      { currency: "EUR" },
      { timeline: "next-year" },
      { timeline: "__proto__" },
    ]) {
      const r = await patch(extra);
      expect(r.status, JSON.stringify(extra)).toBe(400);
    }
    expect(await quote()).toEqual(before);
    expect((await patch({ currency: "USD", budgetBand: "2k-5k" })).status).toBe(200);
    expect(await quote()).toEqual({ currency: "USD", budget_band: "2k-5k", timeline: "1-3-months" });
    // cleared, band first (alone), then the currency
    expect((await patch({ budgetBand: null, timeline: null })).status).toBe(200);
    expect((await patch({ currency: null })).status).toBe(200);
    expect(await quote()).toEqual({ currency: null, budget_band: null, timeline: null });
    // the timeline holds the field names and values; the audit row the names only
    const changes = (
      await rows<{ body: string }>(
        "SELECT body FROM lead_activities WHERE lead_id = ? AND kind = 'updated' ORDER BY rowid",
        lead.id,
      )
    ).flatMap(
      (r) => (JSON.parse(r.body) as { changes: { field: string; from: unknown; to: unknown }[] }).changes,
    );
    expect(changes[0]).toEqual({ field: "budget_band", from: "3l-7l", to: "7l-15l" });
    expect(changes.map((c) => c.field)).toEqual([
      "budget_band",
      "timeline",
      "currency",
      "budget_band",
      "budget_band",
      "timeline",
      "currency",
    ]);
    const audits = await rows<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'lead.update' AND entity_id = ? ORDER BY rowid",
      lead.id,
    );
    expect(JSON.parse(audits[0]?.summary ?? "{}").changed).toEqual(["budget_band", "timeline"]);
    for (const a of audits) expect(a.summary).not.toMatch(/7l-15l|2k-5k|1-3-months/);

    // a website lead: the visitor's answers can't be changed (409, nothing written); sending them unchanged is no change; other fields still save
    const web = await addLead({ currency: "INR", budget_band: "1l-3l", timeline: "exploring" });
    const refused = await send(
      `/leads/${web.id}`,
      "PATCH",
      { expectedUpdatedAt: web.updated_at, budgetBand: "3l-7l", name: "Renamed" },
      s.cookie,
    );
    expect(refused.status).toBe(409);
    expect((await json(refused)).error.code).toBe("lead_answers_fixed");
    expect(
      await one("SELECT contact_name, budget_band, updated_at FROM leads WHERE id = ?", web.id),
    ).toMatchObject({
      budget_band: "1l-3l",
      updated_at: web.updated_at,
    });
    const same = await send(
      `/leads/${web.id}`,
      "PATCH",
      {
        expectedUpdatedAt: web.updated_at,
        currency: "INR",
        budgetBand: "1l-3l",
        timeline: "exploring",
        name: "Renamed",
      },
      s.cookie,
    );
    expect(same.status).toBe(200);
    expect(await one("SELECT contact_name, budget_band FROM leads WHERE id = ?", web.id)).toEqual({
      contact_name: "Renamed",
      budget_band: "1l-3l",
    });
  });

  it("FX-3 fix round (ADM-LEAD-03): stored answers are judged only when the request changes one, and a website lead's source rule comes first", async () => {
    const s = await sessionFor("sales");
    const owner = await sessionFor("owner");
    // a website lead holding a band the form no longer offers: an owner or contact edit still saves
    const old = await addLead({ currency: "INR", budget_band: "retired-band", timeline: "someday" });
    const edit = await send(
      `/leads/${old.id}`,
      "PATCH",
      { expectedUpdatedAt: old.updated_at, ownerId: owner.id, name: "New Contact", phone: "+91 22222" },
      s.cookie,
    );
    expect(edit.status).toBe(200);
    expect(
      await one(
        "SELECT owner_id, contact_name, contact_phone, budget_band, timeline FROM leads WHERE id = ?",
        old.id,
      ),
    ).toEqual({
      owner_id: owner.id,
      contact_name: "New Contact",
      contact_phone: "+91 22222",
      budget_band: "retired-band",
      timeline: "someday",
    });
    // a manual lead with an unknown stored band: a contact edit saves too (its answers aren't re-judged)
    const manual = await addLead({ source: "manual", currency: "USD", budget_band: "retired-band" });
    const manualEdit = await send(
      `/leads/${manual.id}`,
      "PATCH",
      { expectedUpdatedAt: manual.updated_at, company: "Renamed Ltd" },
      s.cookie,
    );
    expect(manualEdit.status).toBe(200);

    // a currency change on a website lead is the source rule's 409, not the band check's 400 (its rupee band isn't a dollar band)
    const web = await addLead({ currency: "INR", budget_band: "1l-3l", timeline: "exploring" });
    for (const extra of [{ currency: "USD" }, { currency: null }, { timeline: "next-year" }]) {
      const res = await send(
        `/leads/${web.id}`,
        "PATCH",
        { expectedUpdatedAt: web.updated_at, ...extra },
        s.cookie,
      );
      expect(res.status, JSON.stringify(extra)).toBe(409);
      expect((await json(res)).error.code).toBe("lead_answers_fixed");
    }
    expect(
      await one("SELECT currency, budget_band, timeline, updated_at FROM leads WHERE id = ?", web.id),
    ).toEqual({
      currency: "INR",
      budget_band: "1l-3l",
      timeline: "exploring",
      updated_at: web.updated_at,
    });
  });

  it("FX-3 fix round 2 (ADM-LEAD-03): a manual lead's band is judged only when the band or currency changes, the timeline only when it changes", async () => {
    const s = await sessionFor("sales");
    const quote = (id: string) => one("SELECT currency, budget_band, timeline FROM leads WHERE id = ?", id);
    /** One PATCH on a fresh manual lead holding `stored`; the status, the error code and the answers it ends with. */
    const tryPatch = async (stored: Record<string, unknown>, extra: Record<string, unknown>) => {
      const lead = await addLead({ source: "manual", ...stored });
      const res = await send(
        `/leads/${lead.id}`,
        "PATCH",
        { expectedUpdatedAt: lead.updated_at, ...extra },
        s.cookie,
      );
      const out = await json(res);
      return { status: res.status, code: out.error?.code as string | undefined, after: await quote(lead.id) };
    };

    // a stored band the form no longer offers never decides a timeline-only change
    expect(
      await tryPatch(
        { currency: "INR", budget_band: "retired-band", timeline: "asap" },
        { timeline: "3-6-months" },
      ),
    ).toEqual({
      status: 200,
      code: undefined,
      after: { currency: "INR", budget_band: "retired-band", timeline: "3-6-months" },
    });
    // ... nor clearing the timeline
    expect(
      (await tryPatch({ currency: "INR", budget_band: "retired-band", timeline: "asap" }, { timeline: null }))
        .after,
    ).toEqual({ currency: "INR", budget_band: "retired-band", timeline: null });
    // a stored timeline the form no longer offers never decides a band-only or currency-only change
    expect(
      await tryPatch({ currency: "INR", budget_band: "1l-3l", timeline: "someday" }, { budgetBand: "3l-7l" }),
    ).toEqual({
      status: 200,
      code: undefined,
      after: { currency: "INR", budget_band: "3l-7l", timeline: "someday" },
    });
    expect(
      (await tryPatch({ currency: "INR", budget_band: "not-sure", timeline: "someday" }, { currency: "USD" }))
        .after,
    ).toEqual({ currency: "USD", budget_band: "not-sure", timeline: "someday" });
    // a currency-only change keeps a band both currencies have ("Not sure"), and is fine with no band at all
    expect(
      (await tryPatch({ currency: "USD", budget_band: null, timeline: "asap" }, { currency: "INR" })).status,
    ).toBe(200);
    // the timeline still has to be the form's when it is the thing that changes
    expect(
      (
        await tryPatch(
          { currency: "INR", budget_band: "retired-band", timeline: "asap" },
          { timeline: "next-year" },
        )
      ).status,
    ).toBe(400);

    // a currency change that leaves the stored band outside the new currency is a 400, nothing written: a band needs its own
    // currency. A band the form no longer offers is a band of no currency, so it can't move to another one either.
    for (const [stored, extra] of [
      [{ currency: "INR", budget_band: "1l-3l" }, { currency: "USD" }],
      [{ currency: "INR", budget_band: "retired-band" }, { currency: "USD" }],
      [{ currency: "INR", budget_band: "retired-band" }, { currency: null }],
      [{ currency: "USD", budget_band: "not-sure" }, { currency: null }],
      // the band sent unchanged next to the currency is still the band the lead ends with
      [
        { currency: "INR", budget_band: "retired-band" },
        { currency: "USD", budgetBand: "retired-band" },
      ],
      // a timeline change next to it doesn't carry the bad currency change through
      [
        { currency: "INR", budget_band: "1l-3l" },
        { currency: "USD", timeline: "exploring" },
      ],
    ] as const) {
      const r = await tryPatch({ timeline: "asap", ...stored }, extra);
      expect(r.status, JSON.stringify([stored, extra])).toBe(400);
      expect(r.after, JSON.stringify([stored, extra])).toEqual({ timeline: "asap", ...stored });
    }
    // changed together with the band (or the band cleared), the currency change saves, the retired band included
    expect(
      (
        await tryPatch(
          { currency: "INR", budget_band: "retired-band", timeline: "asap" },
          { currency: "USD", budgetBand: "2k-5k" },
        )
      ).after,
    ).toEqual({ currency: "USD", budget_band: "2k-5k", timeline: "asap" });
    expect(
      (
        await tryPatch(
          { currency: "INR", budget_band: "retired-band", timeline: "asap" },
          { currency: null, budgetBand: null },
        )
      ).after,
    ).toEqual({ currency: null, budget_band: null, timeline: "asap" });

    // the source rule stays first: a website lead with a retired band is 409 lead_answers_fixed for a timeline-only change
    const web = await addLead({ currency: "INR", budget_band: "retired-band", timeline: "asap" });
    const res = await send(
      `/leads/${web.id}`,
      "PATCH",
      { expectedUpdatedAt: web.updated_at, timeline: "exploring" },
      s.cookie,
    );
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("lead_answers_fixed");
    expect(await quote(web.id)).toEqual({ currency: "INR", budget_band: "retired-band", timeline: "asap" });
  });

  it("changes only what was sent; contact values go on the timeline, NEVER in the audit row", async () => {
    const s = await sessionFor("sales");
    const member = await sessionFor("staff");
    const lead = await addLead({
      contact_name: "Old Name",
      contact_email: "old@example.com",
      contact_phone: "+91 11111",
    });
    const rid = `ray-${crypto.randomUUID()}`;
    const res = await send(
      `/leads/${lead.id}`,
      "PATCH",
      {
        expectedUpdatedAt: lead.updated_at,
        name: "New Name",
        email: "New@Example.com",
        phone: "+91 22222",
        company: "New Co",
        ownerId: member.id,
        nextActionAt: 1_900_000_000_000,
        nextActionNote: "Call back",
      },
      s.cookie,
      rid,
    );
    expect(res.status).toBe(200);
    const out = await json(res);
    expect(out).toMatchObject({ ok: true, changed: true });
    expect(
      await one(
        "SELECT contact_name, contact_email, contact_phone, contact_company, owner_id, next_action_at, next_action_note FROM leads WHERE id = ?",
        lead.id,
      ),
    ).toEqual({
      contact_name: "New Name",
      contact_email: "new@example.com",
      contact_phone: "+91 22222",
      contact_company: "New Co",
      owner_id: member.id,
      next_action_at: 1_900_000_000_000,
      next_action_note: "Call back",
    });
    // timeline: before and after
    const act = await one<{ kind: string; body: string; actor_id: string }>(
      "SELECT kind, body, actor_id FROM lead_activities WHERE lead_id = ?",
      lead.id,
    );
    expect(act?.kind).toBe("updated");
    expect(act?.actor_id).toBe(s.id);
    const changes = JSON.parse(act?.body ?? "{}").changes as { field: string; from: unknown; to: unknown }[];
    expect(changes.find((c) => c.field === "phone")).toEqual({
      field: "phone",
      from: "+91 11111",
      to: "+91 22222",
    });
    expect(changes.find((c) => c.field === "email")).toEqual({
      field: "email",
      from: "old@example.com",
      to: "new@example.com",
    });
    // audit: the reference and field names, no value at all
    const audit = await rows<{ action: string; summary: string }>(
      "SELECT action, summary FROM audit_log WHERE request_id = ?",
      rid,
    );
    expect(audit).toHaveLength(1);
    const summary = JSON.parse(audit[0]?.summary ?? "{}");
    expect(Object.keys(summary).sort()).toEqual(["changed", "ref"]);
    expect(summary.changed.sort()).toEqual([
      "company",
      "email",
      "name",
      "next_action_at",
      "next_action_note",
      "owner",
      "phone",
    ]);
    expect(audit[0]?.summary).not.toMatch(/Old Name|New Name|old@|new@|11111|22222|New Co|Call back/);
    // the activity refreshed the retention date
    const row = await one<{ last_activity_at: number; delete_after: number }>(
      "SELECT last_activity_at, delete_after FROM leads WHERE id = ?",
      lead.id,
    );
    expect(row?.delete_after).toBe(deleteAfter(row?.last_activity_at ?? 0, 12));
  });

  it("a stale page is a 409 stale_version; a save that changes nothing is changed: false", async () => {
    const s = await sessionFor("owner");
    const lead = await addLead({ contact_phone: "+91 1" });
    const stale = await send(
      `/leads/${lead.id}`,
      "PATCH",
      { expectedUpdatedAt: lead.updated_at - 5, phone: "+91 2" },
      s.cookie,
    );
    expect(stale.status).toBe(409);
    expect((await json(stale)).error.code).toBe("stale_version");
    const same = await send(
      `/leads/${lead.id}`,
      "PATCH",
      { expectedUpdatedAt: lead.updated_at, phone: "+91 1" },
      s.cookie,
    );
    expect(await json(same)).toMatchObject({ ok: true, changed: false, updatedAt: lead.updated_at });
    expect(await countOf("lead_activities", "lead_id = ?", lead.id)).toBe(0);
    // two saves from the same page: the second finds the page changed
    const a = await send(
      `/leads/${lead.id}`,
      "PATCH",
      { expectedUpdatedAt: lead.updated_at, phone: "+91 3" },
      s.cookie,
    );
    const b = await send(
      `/leads/${lead.id}`,
      "PATCH",
      { expectedUpdatedAt: lead.updated_at, phone: "+91 4" },
      s.cookie,
    );
    expect([a.status, b.status]).toEqual([200, 409]);
  });

  it("an owner must be an active member who can read leads (not an accountant)", async () => {
    const s = await sessionFor("owner");
    const acc = await sessionFor("accountant");
    const sales = await sessionFor("sales");
    const lead = await addLead();
    const v = lead.updated_at;
    const r = await send(`/leads/${lead.id}`, "PATCH", { expectedUpdatedAt: v, ownerId: acc.id }, s.cookie);
    expect(r.status).toBe(400);
    const ok = await send(
      `/leads/${lead.id}`,
      "PATCH",
      { expectedUpdatedAt: v, ownerId: sales.id },
      s.cookie,
    );
    expect(ok.status).toBe(200);
  });

  it("country must be an assigned ISO code: UN, EU, UK and ZZ are refused", async () => {
    const s = await sessionFor("owner");
    const lead = await addLead();
    for (const country of ["UN", "EU", "UK", "ZZ"])
      expect(
        (await send(`/leads/${lead.id}`, "PATCH", { expectedUpdatedAt: lead.updated_at, country }, s.cookie))
          .status,
        country,
      ).toBe(400);
  });

  it("refuses an inactive owner, a made-up country and a bad email; an unknown lead is 404", async () => {
    const s = await sessionFor("owner");
    const lead = await addLead();
    const v = lead.updated_at;
    expect(
      (await send(`/leads/${lead.id}`, "PATCH", { expectedUpdatedAt: v, ownerId: "nobody" }, s.cookie))
        .status,
    ).toBe(400);
    expect(
      (await send(`/leads/${lead.id}`, "PATCH", { expectedUpdatedAt: v, country: "ZZ" }, s.cookie)).status,
    ).toBe(400);
    expect(
      (await send(`/leads/${lead.id}`, "PATCH", { expectedUpdatedAt: v, email: "nope" }, s.cookie)).status,
    ).toBe(400);
    expect((await send(`/leads/${lead.id}`, "PATCH", { phone: "1" }, s.cookie)).status).toBe(400); // expectedUpdatedAt is required
    expect(
      (await send("/leads/no-such", "PATCH", { expectedUpdatedAt: 1, phone: "1" }, s.cookie)).status,
    ).toBe(404);
    // clearing is allowed
    const clear = await send(
      `/leads/${lead.id}`,
      "PATCH",
      { expectedUpdatedAt: v, nextActionNote: null, phone: null },
      s.cookie,
    );
    expect(clear.status).toBe(200);
  });
});

describe("POST /leads/:id/notes", () => {
  it("adds a timeline note and refreshes the retention date; the audit row has no note text", async () => {
    const s = await sessionFor("staff");
    const lead = await addLead({ last_activity_at: 1, delete_after: 2 });
    const rid = `ray-${crypto.randomUUID()}`;
    const res = await send(
      `/leads/${lead.id}/notes`,
      "POST",
      { body: "Wants a quote by Friday, mentioned a rival." },
      s.cookie,
      rid,
    );
    expect(res.status).toBe(201);
    expect(await rows("SELECT kind, body, actor_id FROM lead_activities WHERE lead_id = ?", lead.id)).toEqual(
      [{ kind: "note", body: "Wants a quote by Friday, mentioned a rival.", actor_id: s.id }],
    );
    const row = await one<{ last_activity_at: number; delete_after: number }>(
      "SELECT last_activity_at, delete_after FROM leads WHERE id = ?",
      lead.id,
    );
    expect(row?.last_activity_at).toBeGreaterThan(1);
    expect(row?.delete_after).toBe(deleteAfter(row?.last_activity_at ?? 0, 12));
    const audit = await rows<{ summary: string }>("SELECT summary FROM audit_log WHERE request_id = ?", rid);
    expect(JSON.parse(audit[0]?.summary ?? "{}")).toEqual({ ref: lead.ref });
    expect((await send(`/leads/${lead.id}/notes`, "POST", { body: "   " }, s.cookie)).status).toBe(400);
    expect((await send("/leads/no-such/notes", "POST", { body: "x" }, s.cookie)).status).toBe(404);
  });
});

describe("POST /leads/:id/stage [ADM-LEAD-02]", () => {
  it("moves a lead, with a timeline row; lost needs a reason and leaving lost clears it; won by hand is allowed", async () => {
    const s = await sessionFor("sales");
    const lead = await addLead();
    const stage = (body: unknown, rid?: string) =>
      send(`/leads/${lead.id}/stage`, "POST", body, s.cookie, rid);
    expect((await stage({ stage: "qualified" })).status).toBe(200);
    // lost: 400 first, with its own code
    const noReason = await stage({ stage: "lost" });
    expect(noReason.status).toBe(400);
    expect((await json(noReason)).error.code).toBe("lost_reason_required");
    expect((await stage({ stage: "lost", lostReason: "not-a-reason" })).status).toBe(400);
    expect((await stage({ stage: "won", lostReason: "price" })).status).toBe(400);
    expect(await one("SELECT stage, lost_reason FROM leads WHERE id = ?", lead.id)).toEqual({
      stage: "qualified",
      lost_reason: null,
    });
    const rid = `ray-${crypto.randomUUID()}`;
    expect((await stage({ stage: "lost", lostReason: "price" }, rid)).status).toBe(200);
    expect(await one("SELECT stage, lost_reason FROM leads WHERE id = ?", lead.id)).toEqual({
      stage: "lost",
      lost_reason: "price",
    });
    const audit = await rows<{ summary: string }>("SELECT summary FROM audit_log WHERE request_id = ?", rid);
    expect(JSON.parse(audit[0]?.summary ?? "{}")).toEqual({
      ref: lead.ref,
      from: "qualified",
      to: "lost",
      lostReason: "price",
    });
    // leaving lost clears the reason
    expect((await stage({ stage: "new" })).status).toBe(200);
    expect(await one("SELECT stage, lost_reason FROM leads WHERE id = ?", lead.id)).toEqual({
      stage: "new",
      lost_reason: null,
    });
    // the manual override
    expect((await stage({ stage: "won" })).status).toBe(200);
    expect(await one("SELECT stage FROM leads WHERE id = ?", lead.id)).toEqual({ stage: "won" });
    // the same stage again changes nothing
    expect(await json(await stage({ stage: "won" }))).toMatchObject({ changed: false });
    const timeline = await rows<{ body: string }>(
      "SELECT body FROM lead_activities WHERE lead_id = ? AND kind = 'stage' ORDER BY created_at, rowid",
      lead.id,
    );
    expect(timeline.map((t) => t.body)).toEqual([
      "Stage changed from new to qualified",
      "Stage changed from qualified to lost (price)",
      "Stage changed from lost to new",
      "Stage changed from new to won",
    ]);
    expect((await send("/leads/no-such/stage", "POST", { stage: "won" }, s.cookie)).status).toBe(404);
  });
});

describe("replies [ADM-LEAD-06]", () => {
  const reply = (id: string, body: unknown, cookie: string, e: Env = env, rid?: string) =>
    call(`/leads/${id}/reply`, { body, cookie, ...(rid ? { headers: { "cf-ray": rid } } : {}) }, e);

  it("lists the three approved templates filled for this lead and sender, with the gaps left in", async () => {
    const s = await sessionFor("sales", { name: "Rupak Sarkar" });
    const lead = await addLead({ contact_name: "Asha Rao", service_code: "S5" });
    const res = await json(await get(`/leads/${lead.id}/reply-templates`, s.cookie));
    expect(res.templates.map((t: J) => t.label)).toEqual([
      "Book a call",
      "A few questions first",
      "Not the right fit",
    ]);
    const book = res.templates[0];
    expect(book.subject).toBe(`Re: your enquiry (${lead.ref})`);
    expect(book.body).toContain("Hi Asha,\n\nThanks for telling us about");
    expect(book.body).toContain("Regards,\nRupak Sarkar, TecHaust Technologies");
    expect(book.body).not.toContain("{{");
    expect(res.templates[1].body).toContain("[your questions]");
    expect((await get("/leads/no-such/reply-templates", s.cookie)).status).toBe(404);
  });

  it("queues one email to the lead (from hello@ by the jobs Worker), a timeline row with the subject and an excerpt, and an audit row without the text", async () => {
    const s = await sessionFor("sales");
    const lead = await addLead({ contact_email: "asha.reply@example.com" });
    const q = captureQueue();
    const rid = `ray-${crypto.randomUUID()}`;
    const text = "Hi Asha, thanks for writing. Could you reply with two times that suit you?";
    const res = await reply(
      lead.id,
      { subject: `Re: your enquiry (${lead.ref})`, body: text, templateId: "book_a_call" },
      s.cookie,
      q.env,
      rid,
    );
    expect(res.status).toBe(202);
    const { id } = await json(res);
    expect(q.sent).toEqual([
      {
        template: "lead.reply",
        to: "asha.reply@example.com",
        data: { subject: `Re: your enquiry (${lead.ref})`, body: text },
        entity: { type: "lead_reply", id },
      },
    ]);
    const act = await one<{ kind: string; body: string }>(
      "SELECT kind, body FROM lead_activities WHERE id = ?",
      id,
    );
    expect(act?.kind).toBe("reply");
    expect(JSON.parse(act?.body ?? "{}")).toEqual({
      subject: `Re: your enquiry (${lead.ref})`,
      excerpt: text,
    });
    const audit = await rows<{ summary: string }>("SELECT summary FROM audit_log WHERE request_id = ?", rid);
    expect(JSON.parse(audit[0]?.summary ?? "{}")).toEqual({ ref: lead.ref, templateId: "book_a_call" });
    expect(audit[0]?.summary).not.toMatch(/thanks|asha/i);
  });

  it("a reply still holding a [gap] is refused with 400 unfilled_gap: nothing is queued, written or counted", async () => {
    const s = await sessionFor("sales");
    const lead = await addLead();
    const q = captureQueue();
    const before = await countOf("audit_log", "action = 'lead.reply'");
    for (const body of [
      { subject: "Re: your enquiry", body: "Hi, before we suggest a price: [your questions]. Regards" },
      { subject: "Re: [your questions]", body: "Hello there" },
      {
        subject: "Re: your enquiry",
        body: "We wish you well. [Optional: a suggestion of where to look instead.] Regards",
      },
    ]) {
      const res = await reply(lead.id, body, s.cookie, q.env);
      expect(res.status).toBe(400);
      expect((await json(res)).error.code).toBe("unfilled_gap");
    }
    expect(q.sent).toEqual([]);
    expect(await countOf("lead_activities", "lead_id = ?", lead.id)).toBe(0);
    expect(await countOf("audit_log", "action = 'lead.reply'")).toBe(before);
    // the same text with the gap filled goes
    const ok = await reply(
      lead.id,
      { subject: "Re: your enquiry", body: "Hi, before we suggest a price: what is your budget? Regards" },
      s.cookie,
      q.env,
    );
    expect(ok.status).toBe(202);
  });

  it("other square brackets are ordinary text: 'See point [1]' is sent", async () => {
    const s = await sessionFor("sales");
    const lead = await addLead();
    const q = captureQueue();
    const res = await reply(
      lead.id,
      { subject: "Re: your enquiry [1]", body: "See point [1] of our note, and [2]." },
      s.cookie,
      q.env,
    );
    expect(res.status).toBe(202);
    expect(q.sent).toHaveLength(1);
  });

  it("a lead deleted between the read and the write answers 404, not 429", async () => {
    const s = await sessionFor("sales");
    const lead = await addLead();
    const q = captureQueue();
    const real = env.DB;
    const racing = new Proxy(real, {
      get(t, k) {
        if (k !== "prepare") {
          const v = Reflect.get(t, k);
          return typeof v === "function" ? v.bind(t) : v;
        }
        return (sql: string) => {
          const st = t.prepare(sql);
          if (!sql.startsWith("SELECT ref, contact_email FROM leads")) return st;
          return new Proxy(st, {
            get(a, m) {
              if (m !== "bind") return Reflect.get(a, m);
              return (...args: unknown[]) => {
                const bound = a.bind(...args);
                return new Proxy(bound, {
                  get(b, n) {
                    if (n === "first")
                      return async () => {
                        const row = await b.first();
                        await t.prepare("DELETE FROM leads WHERE id = ?1").bind(lead.id).run();
                        return row;
                      };
                    const v = Reflect.get(b, n);
                    return typeof v === "function" ? v.bind(b) : v;
                  },
                });
              };
            },
          });
        };
      },
    });
    const res = await reply(
      lead.id,
      { subject: "Hi", body: "Hello" },
      s.cookie,
      withEnv(q.env, { DB: racing }),
    );
    expect(res.status).toBe(404);
    expect(q.sent).toEqual([]);
  });

  it("refuses a multi-line subject, an unknown template, an empty body; an unknown lead is 404", async () => {
    const s = await sessionFor("owner");
    const lead = await addLead();
    const q = captureQueue();
    expect(
      (await reply(lead.id, { subject: "Hi\r\nBcc: a@b.c", body: "Hello" }, s.cookie, q.env)).status,
    ).toBe(400);
    expect(
      (await reply(lead.id, { subject: "Hi", body: "Hello", templateId: "nope" }, s.cookie, q.env)).status,
    ).toBe(400);
    expect((await reply(lead.id, { subject: "Hi", body: " " }, s.cookie, q.env)).status).toBe(400);
    expect((await reply("no-such", { subject: "Hi", body: "Hello" }, s.cookie, q.env)).status).toBe(404);
    expect(q.sent).toEqual([]);
  });

  it("limits each member to 20 replies an hour (429), counted from the audit log", async () => {
    const s = await sessionFor("staff");
    const other = await sessionFor("staff");
    const lead = await addLead();
    const q = captureQueue();
    const stmts = Array.from({ length: 20 }, () =>
      env.DB.prepare(
        "INSERT INTO audit_log (id, actor_type, actor_id, role, action, entity_type, entity_id) VALUES (?1, 'staff', ?2, 'staff', 'lead.reply', 'lead', ?3)",
      ).bind(uuidv7(), s.id, lead.id),
    );
    await env.DB.batch(stmts);
    const refused = await reply(lead.id, { subject: "Hi", body: "Hello" }, s.cookie, q.env);
    expect(refused.status).toBe(429);
    expect((await json(refused)).error.code).toBe("rate_limited");
    expect(q.sent).toEqual([]);
    // another member is not affected
    expect((await reply(lead.id, { subject: "Hi", body: "Hello" }, other.cookie, q.env)).status).toBe(202);
  });
});

describe("GET /leads/assignees: who a lead can be assigned to [ADM-LEAD-03]", () => {
  it("lists active members whose role works leads, by name, and says which one is the caller", async () => {
    const s = await sessionFor("sales", { name: "Zara Assignee Sales" });
    const owner = await sessionFor("owner", { name: "Aaron Assignee Owner" });
    const accountant = await sessionFor("accountant", { name: "Assignee Accountant" });
    const gone = await sessionFor("staff", { name: "Assignee Deactivated" });
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?1").bind(gone.id).run();
    const res = await get("/leads/assignees", s.cookie);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.me).toBe(s.id);
    const ids = (body.assignees as { id: string; name: string }[]).map((a) => a.id);
    expect(ids).toContain(s.id);
    expect(ids).toContain(owner.id);
    expect(ids).not.toContain(accountant.id);
    expect(ids).not.toContain(gone.id);
    expect(ids.indexOf(owner.id)).toBeLessThan(ids.indexOf(s.id));
    expect(Object.keys(body.assignees[0]).sort()).toEqual(["id", "name"]);
  });
});

describe("no personal data in any lead audit row", () => {
  it("no lead.* audit summary holds an email address, a phone number or a name", async () => {
    const all = await rows<{ summary: string | null }>(
      "SELECT summary FROM audit_log WHERE action LIKE 'lead.%'",
    );
    expect(all.length).toBeGreaterThan(5);
    for (const r of all) expect(r.summary ?? "").not.toMatch(/@|\+91|Person|Iyer|Rao|Name/);
  });
});
