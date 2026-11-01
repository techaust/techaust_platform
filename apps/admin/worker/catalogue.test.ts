// Catalogue, templates and publishing API [ADM-CAT-01..05, WEB-G-07, WEB-SVC-05]: permissions, validation, price history, retiring,
// template versions, and the published snapshot (public fields only, one row per SHA, validated by the mini twin).
import { env } from "cloudflare:workers";
import { catalogueSnapshot } from "@techaust/core";
import { canonicalJson, sha256Hex } from "@techaust/core/catalogue";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { SITE_REFERENCES } from "@techaust/core/site-references";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CATALOGUE_SEARCH_SQL } from "./catalogue.ts";
import { CATALOGUE_SQL } from "./search.ts";
import { entryBody, mkItem, putPaymentTerms, retireAll, siteItems, UPFRONT } from "./test-catalogue.ts";
import { beforeBatch } from "./test-clients.ts";
import { bodyOf, call, countOf, one, rows, sessionFor } from "./test-helpers.ts";

// biome-ignore lint/suspicious/noExplicitAny: response bodies in tests are read loosely
type J = Record<string, any>;
const json = async (res: Response): Promise<J> => (await res.json()) as J;
const owner = () => sessionFor("owner", { stepUp: true });
const code = async (res: Response) => ((await bodyOf(res)) as { error: { code: string } }).error.code;
const SAMPLE_TEMPLATE = {
  kind: "proposal",
  category: "build",
  body: { sections: [{ key: "scope", heading: "Scope", body: "{{service.short}}" }] },
};

beforeAll(async () => {
  await putPaymentTerms();
});

// ---------------------------------------------------------------------------------------------------------------
describe("permissions [ADM-CAT-02, ADM-G-02]", () => {
  it("every role reads the catalogue, the templates and the snapshots", async () => {
    const item = await mkItem();
    for (const role of ["owner", "staff", "sales", "accountant"] as const) {
      const s = await sessionFor(role);
      for (const path of ["/catalogue", `/catalogue/${item.id}`, "/catalogue/snapshots", "/templates"])
        expect((await call(path, { cookie: s.cookie })).status, `${role} ${path}`).toBe(200);
    }
  });

  it("staff, sales and accountant cannot write or publish; signed out is 401", async () => {
    const item = await mkItem();
    const tpl = await call("/templates", { body: SAMPLE_TEMPLATE, cookie: (await owner()).cookie });
    const tplId = (await json(tpl)).id as string;
    const requests: [string, string, unknown][] = [
      ["POST", "/catalogue", entryBody()],
      ["PATCH", `/catalogue/${item.id}`, { expectedUpdatedAt: item.updatedAt, name: "x" }],
      ["POST", `/catalogue/${item.id}/active`, { active: false }],
      ["POST", "/templates", SAMPLE_TEMPLATE],
      ["POST", "/catalogue/publish", undefined],
    ];
    for (const role of ["staff", "sales", "accountant"] as const) {
      const s = await sessionFor(role, { stepUp: true });
      for (const [method, path, body] of requests)
        expect(
          (await call(path, { method, body, cookie: s.cookie })).status,
          `${role} ${method} ${path}`,
        ).toBe(403);
      expect((await call(`/templates/${tplId}`, { cookie: s.cookie })).status).toBe(200);
    }
    for (const [method, path, body] of requests)
      expect((await call(path, { method, body })).status, `signed out ${method} ${path}`).toBe(401);
    expect(
      (await one<{ name: string }>("SELECT name FROM catalogue_items WHERE id = ?", item.id))?.name,
    ).toMatch(/^Test service/);
  });

  it("there is no delete route: an item is retired, never removed", async () => {
    const item = await mkItem();
    const o = await owner();
    expect((await call(`/catalogue/${item.id}`, { method: "DELETE", cookie: o.cookie })).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("create and validate [ADM-CAT-02]", () => {
  it("creates an item, audits it, and keeps the audit row free of names", async () => {
    const o = await owner();
    const body = entryBody({ name: "Quite Secret Name" });
    const res = await call("/catalogue", { body, cookie: o.cookie });
    expect(res.status, await res.clone().text()).toBe(201);
    const { id } = await json(res);
    const page = await json(await call(`/catalogue/${id}`, { cookie: o.cookie }));
    expect(page.item).toMatchObject({
      code: body.code,
      name: "Quite Secret Name",
      sac: "998314",
      active: true,
    });
    const audit = await one<{ action: string; summary: string }>(
      "SELECT action, summary FROM audit_log WHERE entity_id = ?",
      id,
    );
    expect(audit?.action).toBe("catalogue.create");
    expect(audit?.summary).not.toContain("Secret");
    expect(JSON.parse(audit?.summary ?? "{}")).toEqual({ itemId: id, itemCode: body.code });
  });

  it.each([
    ["a SAC that is not six digits", { sac: "12345" }],
    ["a negative price", { priceInrMinor: -1 }],
    ["a price with a fraction", { priceUsdMinor: 10.5 }],
    ["a GST rate over 100 %", { gstRateBp: 10_001 }],
    [
      "a schedule that does not add up to 100 %",
      { schedule: [{ label: "x", pctBp: 9_000, trigger: "on_accept" }] },
    ],
    ["a bad slug", { slug: "Not A Slug" }],
    ["a bad code", { code: "Service1" }],
    ["an unknown field", { notes: "x" }],
  ])("refuses %s", async (_name, over) => {
    const o = await owner();
    const before = await countOf("catalogue_items");
    const res = await call("/catalogue", { body: entryBody(over), cookie: o.cookie });
    expect(res.status).toBe(400);
    expect(await countOf("catalogue_items")).toBe(before);
  });

  it("answers 409 for a duplicate slug and a duplicate code, and writes no audit row", async () => {
    const o = await owner();
    const first = entryBody();
    expect((await call("/catalogue", { body: first, cookie: o.cookie })).status).toBe(201);
    const audits = await countOf("audit_log", "action = 'catalogue.create'");
    const dupSlug = await call("/catalogue", { body: entryBody({ slug: first.slug }), cookie: o.cookie });
    expect(dupSlug.status).toBe(409);
    expect(await code(dupSlug)).toBe("slug_in_use");
    const dupCode = await call("/catalogue", { body: entryBody({ code: first.code }), cookie: o.cookie });
    expect(dupCode.status).toBe(409);
    expect(await code(dupCode)).toBe("code_in_use");
    expect(await countOf("audit_log", "action = 'catalogue.create'")).toBe(audits);
  });

  it("an edit cannot change the code", async () => {
    const o = await owner();
    const item = await mkItem();
    const res = await call(`/catalogue/${item.id}`, {
      method: "PATCH",
      body: { expectedUpdatedAt: item.updatedAt, code: "S1" },
      cookie: o.cookie,
    });
    expect(res.status).toBe(400);
    expect(
      (await one<{ code: string }>("SELECT code FROM catalogue_items WHERE id = ?", item.id))?.code,
    ).toBe(item.code);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the list [ADM-G-03]", () => {
  it("filters, searches by the start of the code or name, and pages by keyset in code order", async () => {
    const o = await owner();
    const made = [];
    for (let i = 0; i < 27; i++)
      made.push(
        await mkItem({
          name: `ZZPage item ${i}`,
          category: i % 2 ? "run" : "advise",
          active: i === 0 ? 0 : 1,
        }),
      );
    const list = async (qs: string) => json(await call(`/catalogue?${qs}`, { cookie: o.cookie }));
    const p1 = await list("q=zzpage");
    expect(p1.items).toHaveLength(25);
    expect(p1.next).toBeTruthy();
    expect(p1.prev).toBeNull();
    const p2 = await list(`q=zzpage&after=${p1.next}`);
    expect(p2.items).toHaveLength(2);
    expect(p2.next).toBeNull();
    expect(p2.prev).toBeTruthy();
    const back = await list(`q=zzpage&before=${p2.prev}`);
    expect(back.items.map((i: J) => i.id)).toEqual(p1.items.map((i: J) => i.id));
    const codes = [...p1.items, ...p2.items].map((i: J) => Number.parseInt(i.code.slice(1), 10));
    expect(codes).toEqual([...codes].sort((a, b) => a - b));
    expect((await list("q=zzpage&limit=50")).items).toHaveLength(27);
    expect((await list("q=zzpage&active=0&limit=50")).items).toHaveLength(1);
    expect((await list("q=zzpage&category=run&limit=50")).items).toHaveLength(13);
    expect((await list(`q=${made[3]?.code}`)).items.map((i: J) => i.code)).toContain(made[3]?.code);
    expect((await call("/catalogue?after=junk", { cookie: o.cookie })).status).toBe(400);
    expect((await call("/catalogue?limit=51", { cookie: o.cookie })).status).toBe(400);
  });

  it("filters by on-site", async () => {
    const o = await owner();
    await mkItem({ name: "YYSite off", show_on_site: 0 });
    await mkItem({ name: "YYSite on", show_on_site: 1 });
    const on = await json(await call("/catalogue?q=yysite&onSite=1", { cookie: o.cookie }));
    const off = await json(await call("/catalogue?q=yysite&onSite=0", { cookie: o.cookie }));
    expect(on.items.map((i: J) => i.name)).toEqual(["YYSite on"]);
    expect(off.items.map((i: J) => i.name)).toEqual(["YYSite off"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("every filter uses an index (no table scan of a growing table)", () => {
  const plan = async (sql: string, ...p: unknown[]) =>
    (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...p)).map((r) => r.detail).join(" | ");
  it("the search, the history and the snapshot list", async () => {
    const search = await plan(
      `SELECT id FROM catalogue_items WHERE ${CATALOGUE_SEARCH_SQL(1)}`,
      "S",
      "S~",
      "a",
      "a~",
    );
    expect(search).toContain("catalogue_items_code");
    expect(search).toContain("catalogue_items_name_nocase");
    expect(await plan(CATALOGUE_SQL, "S", "S~", "a", "a~")).toContain("catalogue_items_name_nocase");
    expect(
      await plan(
        "SELECT id FROM catalogue_price_history WHERE item_id = ?1 ORDER BY created_at DESC, id DESC",
        "x",
      ),
    ).toContain("catalogue_price_history_item");
    expect(await plan("SELECT id FROM site_snapshots ORDER BY created_at DESC, id DESC LIMIT 20")).toContain(
      "site_snapshots_published",
    );
    // No query filters by SHA (publish compares with the newest row only), so there is no index on it (review finding 8).
    const idx = await rows<{ name: string }>("SELECT name FROM pragma_index_list('site_snapshots')");
    expect(idx.map((i) => i.name)).not.toContain("site_snapshots_sha256");
  });
});

describe("edit and price history [ADM-CAT-04]", () => {
  const patch = (id: string, cookie: string, body: unknown, e?: Env) =>
    call(`/catalogue/${id}`, { method: "PATCH", body, cookie }, e);
  const history = (id: string) =>
    rows<{ field: string; old_minor: number | null; new_minor: number | null; changed_by: string }>(
      "SELECT field, old_minor, new_minor, changed_by FROM catalogue_price_history WHERE item_id = ? ORDER BY field",
      id,
    );

  it("writes one history row per changed price, with the old and new value and the actor", async () => {
    const o = await owner();
    const item = await mkItem({
      price_usd_minor: 5_000,
      default_lines: JSON.stringify([
        { description: "Setup", unit: "fixed", qtyMilli: 1_000, rateInrMinor: 10_000, rateUsdMinor: 100 },
      ]),
    });
    const res = await patch(item.id, o.cookie, {
      expectedUpdatedAt: item.updatedAt,
      priceInrMinor: 150_000,
      defaultLines: [
        { description: "Setup", unit: "fixed", qtyMilli: 1_000, rateInrMinor: 12_000, rateUsdMinor: 100 },
      ],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await history(item.id)).toEqual([
      { field: "line:Setup:rate_inr_minor", old_minor: 10_000, new_minor: 12_000, changed_by: o.id },
      { field: "price_inr_minor", old_minor: 100_000, new_minor: 150_000, changed_by: o.id },
    ]);
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE entity_id = ? AND action = 'catalogue.update'",
      item.id,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toEqual({
      itemId: item.id,
      itemCode: item.code,
      changed: ["priceInrMinor", "defaultLines"],
      priceChanges: 2,
    });
    const page = await json(await call(`/catalogue/${item.id}`, { cookie: o.cookie }));
    expect(page.history.items).toHaveLength(2);
    expect(page.history.items[0]).toMatchObject({ changedBy: o.id, changedByName: o.email });
  });

  it("writes no history when nothing about the prices changed, and none when nothing changed", async () => {
    const o = await owner();
    const item = await mkItem();
    const named = await json(
      await patch(item.id, o.cookie, { expectedUpdatedAt: item.updatedAt, name: "Renamed" }),
    );
    expect(named).toMatchObject({ ok: true, changed: true });
    expect(await history(item.id)).toEqual([]);
    const audits = await countOf("audit_log", "entity_id = ?", item.id);
    const nothing = await json(
      await patch(item.id, o.cookie, {
        expectedUpdatedAt: named.updatedAt,
        name: "Renamed",
        priceInrMinor: 100_000,
      }),
    );
    expect(nothing).toMatchObject({ ok: true, changed: false });
    expect(await countOf("audit_log", "entity_id = ?", item.id)).toBe(audits);
  });

  it("a save in the same millisecond as the item's last write moves updated_at past it, so a second save from that page is 409 (test-hardening E)", async () => {
    const o = await owner();
    const item = await mkItem();
    try {
      vi.useFakeTimers({ toFake: ["Date"], now: item.updatedAt });
      const first = await patch(item.id, o.cookie, { expectedUpdatedAt: item.updatedAt, name: "First" });
      expect(await json(first)).toMatchObject({ ok: true, changed: true, updatedAt: item.updatedAt + 1 });
      const second = await patch(item.id, o.cookie, { expectedUpdatedAt: item.updatedAt, name: "Second" });
      expect(second.status).toBe(409);
      expect(await code(second)).toBe("stale_version");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a stale version is 409 and writes nothing; an item that is gone is 404", async () => {
    const o = await owner();
    const item = await mkItem();
    const res = await patch(item.id, o.cookie, { expectedUpdatedAt: item.updatedAt - 1, priceInrMinor: 5 });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("stale_version");
    expect(await history(item.id)).toEqual([]);
    expect((await patch("no-such-item", o.cookie, { expectedUpdatedAt: 1, name: "x" })).status).toBe(404);
  });

  it("a change that lands between the read and the batch writes no history (one batch)", async () => {
    const o = await owner();
    const item = await mkItem();
    const e = beforeBatch(async () => {
      await env.DB.prepare("UPDATE catalogue_items SET updated_at = updated_at + 5 WHERE id = ?")
        .bind(item.id)
        .run();
    });
    const res = await patch(item.id, o.cookie, { expectedUpdatedAt: item.updatedAt, priceInrMinor: 999 }, e);
    expect(res.status).toBe(409);
    expect(await history(item.id)).toEqual([]);
    expect(
      (
        await one<{ price_inr_minor: number }>(
          "SELECT price_inr_minor FROM catalogue_items WHERE id = ?",
          item.id,
        )
      )?.price_inr_minor,
    ).toBe(100_000);
    expect(await countOf("audit_log", "entity_id = ?", item.id)).toBe(0);
  });

  it("an update the database refuses (a slug in use) rolls back the history too", async () => {
    const o = await owner();
    const other = await mkItem();
    const item = await mkItem();
    const slug = (await one<{ slug: string }>("SELECT slug FROM catalogue_items WHERE id = ?", other.id))
      ?.slug;
    const res = await patch(item.id, o.cookie, {
      expectedUpdatedAt: item.updatedAt,
      priceInrMinor: 777,
      slug,
    });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("slug_in_use");
    expect(await history(item.id)).toEqual([]);
    expect(await countOf("audit_log", "entity_id = ?", item.id)).toBe(0);
  });

  it("clears an optional text with an empty string and a price with null", async () => {
    const o = await owner();
    const item = await mkItem({ long_md: "Long text", price_usd_minor: 500 });
    await patch(item.id, o.cookie, { expectedUpdatedAt: item.updatedAt, longMd: "  ", priceUsdMinor: null });
    const row = await one<{ long_md: string | null; price_usd_minor: number | null }>(
      "SELECT long_md, price_usd_minor FROM catalogue_items WHERE id = ?",
      item.id,
    );
    expect(row).toEqual({ long_md: null, price_usd_minor: null });
    expect(await history(item.id)).toEqual([
      { field: "price_usd_minor", old_minor: 500, new_minor: null, changed_by: o.id },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("retiring an item [ADM-CAT-02]", () => {
  it("deactivates and reactivates, never deletes, and audits each with its own action", async () => {
    const o = await owner();
    const item = await mkItem();
    const off = await call(`/catalogue/${item.id}/active`, { body: { active: false }, cookie: o.cookie });
    expect(await json(off)).toMatchObject({ ok: true, changed: true });
    expect(
      (await one<{ active: number }>("SELECT active FROM catalogue_items WHERE id = ?", item.id))?.active,
    ).toBe(0);
    const again = await call(`/catalogue/${item.id}/active`, { body: { active: false }, cookie: o.cookie });
    expect(await json(again)).toMatchObject({ ok: true, changed: false });
    await call(`/catalogue/${item.id}/active`, { body: { active: true }, cookie: o.cookie });
    const actions = await rows<{ action: string }>(
      "SELECT action FROM audit_log WHERE entity_id = ? ORDER BY at, rowid",
      item.id,
    );
    expect(actions.map((a) => a.action)).toEqual(["catalogue.deactivate", "catalogue.activate"]);
    expect(
      (await call("/catalogue/no-such/active", { body: { active: true }, cookie: o.cookie })).status,
    ).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("templates [ADM-CAT-03]", () => {
  it("a new version keeps the old one; the list shows the newest, the history shows all", async () => {
    const o = await owner();
    const body = (text: string) => ({
      kind: "estimate",
      category: "connect",
      body: { sections: [{ key: "estimate", heading: "Estimate", body: text }] },
    });
    const v1 = await json(await call("/templates", { body: body("{{client.name}}"), cookie: o.cookie }));
    const v2 = await json(await call("/templates", { body: body("{{service.name}}"), cookie: o.cookie }));
    expect([v1.version, v2.version]).toEqual([1, 2]);
    const old = await json(await call(`/templates/${v1.id}`, { cookie: o.cookie }));
    expect(old.template.body.sections[0].body).toBe("{{client.name}}");
    expect(old.versions.map((v: J) => v.version)).toEqual([2, 1]);
    const latest = await json(await call("/templates?kind=estimate&category=connect", { cookie: o.cookie }));
    expect(latest.templates.map((t: J) => t.version)).toEqual([2]);
    const all = await json(
      await call("/templates?kind=estimate&category=connect&history=1", { cookie: o.cookie }),
    );
    expect(all.templates.map((t: J) => t.version).sort()).toEqual([1, 2]);
    expect(
      await countOf("audit_log", "action = 'template.version' AND entity_id IN (?, ?)", v1.id, v2.id),
    ).toBe(2);
  });

  it("each version names who saved it (from its own audit row); a version without one has none", async () => {
    const o = await sessionFor("owner", { stepUp: true, name: "Sample Owner (sample)" });
    const body = {
      kind: "estimate",
      category: "advise",
      body: { sections: [{ key: "estimate", heading: "Estimate", body: "{{service.name}}" }] },
    };
    const saved = await json(await call("/templates", { body, cookie: o.cookie }));
    const page = await json(await call(`/templates/${saved.id}`, { cookie: o.cookie }));
    expect(page.template.savedByName).toBe("Sample Owner (sample)");
    expect(page.versions[0]).toMatchObject({ id: saved.id, savedByName: "Sample Owner (sample)" });
    const list = await json(await call("/templates?kind=estimate&category=advise", { cookie: o.cookie }));
    expect(list.templates[0]).toMatchObject({ id: saved.id, savedByName: "Sample Owner (sample)" });
    // A version written without the API (as the seed does) has no audit row, so no name.
    const seeded = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO templates (id, category, kind, version, body) VALUES (?1, 'advise', 'proposal', 900, ?2)",
    )
      .bind(seeded, JSON.stringify(body.body))
      .run();
    expect(
      (await json(await call(`/templates/${seeded}`, { cookie: o.cookie }))).template.savedByName,
    ).toBeNull();
  });

  it("blocks have no category and versions count up per kind", async () => {
    const o = await owner();
    const block = {
      kind: "care_block",
      category: null,
      body: { sections: [{ key: "c", heading: "Care", body: "" }] },
    };
    const a = await json(await call("/templates", { body: block, cookie: o.cookie }));
    const b = await json(await call("/templates", { body: block, cookie: o.cookie }));
    expect(b.version).toBe(a.version + 1);
  });

  it("refuses an unknown placeholder, a category on a block, and none on a proposal", async () => {
    const o = await owner();
    const section = (body: string) => ({ sections: [{ key: "s", heading: "H", body }] });
    const bad = await call("/templates", {
      body: { ...SAMPLE_TEMPLATE, body: section("{{client.nope}}") },
      cookie: o.cookie,
    });
    expect(bad.status).toBe(400);
    expect(await code(bad)).toBe("unknown_placeholder");
    const withCat = await call("/templates", {
      body: { kind: "terms_block", category: "build", body: section("") },
      cookie: o.cookie,
    });
    expect(await code(withCat)).toBe("template_category");
    const noCat = await call("/templates", {
      body: { kind: "proposal", category: null, body: section("") },
      cookie: o.cookie,
    });
    expect(await code(noCat)).toBe("template_category");
    expect(
      (await call("/templates", { body: { ...SAMPLE_TEMPLATE, body: { sections: [] } }, cookie: o.cookie }))
        .status,
    ).toBe(400);
  });

  it("a template is never changed or deleted through the database", async () => {
    const o = await owner();
    const { id } = await json(await call("/templates", { body: SAMPLE_TEMPLATE, cookie: o.cookie }));
    await expect(
      env.DB.prepare("UPDATE templates SET body = '{}' WHERE id = ?").bind(id).run(),
    ).rejects.toThrow(/append-only/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("publish [ADM-CAT-05, WEB-G-07]", () => {
  beforeAll(async () => {
    await putPaymentTerms();
  });

  const publish = (cookie: string) => call("/catalogue/publish", { method: "POST", cookie });
  const newest = () =>
    one<{ id: string; sha256: string; json: string; published_by: string }>(
      "SELECT id, sha256, json, published_by FROM site_snapshots ORDER BY created_at DESC, id DESC LIMIT 1",
    );

  // Changed on purpose (review finding 2): publishing now needs the services the website uses (SITE_REFERENCES), so each test that
  // publishes successfully starts from `siteItems()` and finds its own item among them.
  const SITE_CODES = SITE_REFERENCES.map((n) => n.code);
  const itemOf = (snap: J, c: string): J => (snap.items as J[]).find((i) => i.code === c) as J;

  it("stores a snapshot with public fields only, its SHA is the SHA of its text, and both schemas accept it", async () => {
    await siteItems();
    const o = await owner();
    const item = await mkItem({
      name: "Published service",
      sac: "998313",
      gst_rate_bp: 1800,
      deliverables_md: "SECRET DELIVERABLE",
      assumptions_md: "SECRET ASSUMPTION",
      exclusions_md: "SECRET EXCLUSION",
      default_lines: JSON.stringify([
        { description: "Setup", unit: "fixed", qtyMilli: 1_000, rateInrMinor: 12_345, rateUsdMinor: 678 },
      ]),
    });
    const res = await publish(o.cookie);
    expect(res.status, await res.clone().text()).toBe(201);
    const out = await json(res);
    const stored = await newest();
    expect(stored?.sha256).toBe(out.sha256);
    expect(await sha256Hex(stored?.json ?? "")).toBe(out.sha256);
    expect(stored?.published_by).toBe(o.id);
    const snap = JSON.parse(stored?.json ?? "{}");
    expect(snap.items).toHaveLength(SITE_CODES.length + 1);
    const mine = itemOf(snap, item.code);
    expect(mine).toMatchObject({ code: item.code, name: "Published service", priceInrMinor: 100_000 });
    expect(mine.defaultLines).toEqual([
      { description: "Setup", unit: "fixed", qtyMilli: 1_000, rateInrMinor: 12_345, rateUsdMinor: 678 },
    ]);
    expect(stored?.json).toBe(canonicalJson(snap));
    // The forbidden words are looked for in the test item's own part (the website's fixtures hold numbers of their own).
    const mineText = JSON.stringify(mine);
    for (const word of [
      "998313",
      "1800",
      "SECRET",
      "sac",
      "gstRate",
      "deliverables",
      "assumptions",
      "exclusions",
      item.id,
    ]) {
      expect(mineText, word).not.toContain(word);
    }
    expect(stored?.json).not.toContain("SECRET");
    expect(catalogueSnapshot.safeParse(snap).success).toBe(true);
    const audit = await one<{ action: string; summary: string }>(
      "SELECT action, summary FROM audit_log WHERE entity_id = ?",
      out.id,
    );
    expect(audit?.action).toBe("catalogue.publish");
    expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({
      sha256: out.sha256,
      items: SITE_CODES.length + 1,
    });
  });

  it("publishing the same data twice stores one row and answers unchanged", async () => {
    await siteItems();
    const o = await owner();
    await mkItem();
    const first = await publish(o.cookie);
    expect(first.status).toBe(201);
    const before = await countOf("site_snapshots");
    const audits = await countOf("audit_log", "action = 'catalogue.publish'");
    const second = await publish(o.cookie);
    expect(second.status).toBe(200);
    expect(await json(second)).toEqual({ sha256: (await json(first)).sha256, unchanged: true });
    expect(await countOf("site_snapshots")).toBe(before);
    expect(await countOf("audit_log", "action = 'catalogue.publish'")).toBe(audits);
  });

  it("leaves out inactive and off-site items, and a price change makes a new snapshot with the new price", async () => {
    await siteItems();
    const o = await owner();
    const live = await mkItem();
    const hidden = await mkItem({ show_on_site: 0 });
    const retired = await mkItem({ active: 0 });
    const a = await json(await publish(o.cookie));
    const codes = (JSON.parse((await newest())?.json ?? "{}").items as J[]).map((i) => i.code);
    expect(codes).toEqual([...SITE_CODES, live.code]);
    expect(codes).not.toContain(hidden.code);
    expect(codes).not.toContain(retired.code);
    const edit = await call(`/catalogue/${live.id}`, {
      method: "PATCH",
      body: { expectedUpdatedAt: live.updatedAt, priceInrMinor: 200_000 },
      cookie: o.cookie,
    });
    expect(edit.status).toBe(200);
    const b = await json(await publish(o.cookie));
    expect(b.sha256).not.toBe(a.sha256);
    expect(b.unchanged).toBe(false);
    expect(itemOf(JSON.parse((await newest())?.json ?? "{}"), live.code).priceInrMinor).toBe(200_000);
    // Going back to the old prices gives the old SHA; it isn't the newest, so it is stored again and becomes the newest.
    const backEdit = await call(`/catalogue/${live.id}`, {
      method: "PATCH",
      body: { expectedUpdatedAt: (await json(edit)).updatedAt, priceInrMinor: 100_000 },
      cookie: o.cookie,
    });
    expect(backEdit.status).toBe(200);
    const back = await publish(o.cookie);
    expect(back.status).toBe(201);
    expect((await json(back)).sha256).toBe(a.sha256);
    expect((await newest())?.sha256).toBe(a.sha256);
    expect(itemOf(JSON.parse((await newest())?.json ?? "{}"), live.code).priceInrMinor).toBe(100_000);
    // Publishing the same again is unchanged.
    expect(await json(await publish(o.cookie))).toMatchObject({ sha256: a.sha256, unchanged: true });
  });

  it("refuses an item the site cannot show (an hourly unit) and stores nothing", async () => {
    await retireAll();
    const o = await owner();
    const bad = await mkItem({ unit: "hour" });
    const before = await countOf("site_snapshots");
    const res = await publish(o.cookie);
    expect(res.status).toBe(422);
    const out = await json(res);
    expect(out.error.code).toBe("snapshot_invalid");
    expect(out.paths.join(" ")).toContain("items.0.unit");
    expect(JSON.stringify(out)).not.toContain(bad.code);
    expect(await countOf("site_snapshots")).toBe(before);
  });

  it("refuses website text with '&', a banned phrase or a typed amount: 400 naming each field and rule, nothing stored [A2-2]", async () => {
    await siteItems();
    const o = await owner();
    const amp = await mkItem({ name: "Audit & fix" });
    const banned = await mkItem({
      name: "Rescue",
      default_lines: JSON.stringify([
        {
          description: "Guaranteed real-time sync",
          unit: "fixed",
          qtyMilli: 1_000,
          rateInrMinor: 100,
          rateUsdMinor: null,
        },
        {
          description: "Setup for ₹5,000",
          unit: "fixed",
          qtyMilli: 1_000,
          rateInrMinor: 100,
          rateUsdMinor: null,
        },
      ]),
    });
    const before = await countOf("site_snapshots");
    const audits = await countOf("audit_log", "action = 'catalogue.publish'");
    const res = await publish(o.cookie);
    expect(res.status).toBe(400);
    const out = await json(res);
    expect(out.error.code).toBe("public_text_refused");
    expect(out.fields).toEqual([
      { path: `items.${amp.code}.name`, issues: [{ rule: "ampersand" }] },
      {
        path: `items.${banned.code}.defaultLines.0.description`,
        issues: [
          { rule: "banned_phrase", phrase: "guarantee" },
          { rule: "banned_phrase", phrase: "real-time" },
        ],
      },
      { path: `items.${banned.code}.defaultLines.1.description`, issues: [{ rule: "typed_amount" }] },
    ]);
    // The answer names fields and rules, never the text itself.
    expect(JSON.stringify(out)).not.toContain("Guaranteed");
    expect(JSON.stringify(out)).not.toContain("5,000");
    expect(await countOf("site_snapshots")).toBe(before);
    expect(await countOf("audit_log", "action = 'catalogue.publish'")).toBe(audits);
  });

  it("checks the payment terms' schedule labels too", async () => {
    await siteItems();
    const o = await owner();
    const terms = SETTINGS_DEFAULTS.payment_terms;
    await putPaymentTerms({
      ...terms,
      buildSchedule: terms.buildSchedule.map((s, i) => (i === 0 ? { ...s, label: "Kick-off & design" } : s)),
    });
    const res = await publish(o.cookie);
    expect(res.status).toBe(400);
    expect((await json(res)).fields).toEqual([
      { path: "paymentTerms.buildSchedule.0.label", issues: [{ rule: "ampersand" }] },
    ]);
    // Back to the default terms; not published here, so the next test's first successful publish is still a new row.
    await putPaymentTerms();
  });

  it("refuses when nothing is on the site, and when the payment terms are missing", async () => {
    await retireAll();
    const o = await owner();
    expect((await publish(o.cookie)).status).toBe(422);
    await siteItems();
    await env.DB.prepare("DELETE FROM settings WHERE key = 'payment_terms'").run();
    expect((await publish(o.cookie)).status).toBe(422);
    await putPaymentTerms({ ...SETTINGS_DEFAULTS.payment_terms, dueDays: 7 });
    expect((await publish(o.cookie)).status).toBe(201);
  });

  it("lists the last snapshots, newest first, and the snapshots are append-only", async () => {
    const o = await owner();
    const list = await json(await call("/catalogue/snapshots", { cookie: o.cookie }));
    expect(list.snapshots.length).toBeGreaterThan(1);
    expect(list.snapshots.length).toBeLessThanOrEqual(20);
    expect(list.snapshots[0].latest).toBe(true);
    expect(list.snapshots[0].sha256).toBe((await newest())?.sha256);
    expect(list.snapshots[0].publishedByName).toBeTruthy();
    for (const s of list.snapshots) expect(s).not.toHaveProperty("json");
    await expect(env.DB.prepare("UPDATE site_snapshots SET json = '{}'").run()).rejects.toThrow(
      /append-only/,
    );
    await expect(env.DB.prepare("DELETE FROM site_snapshots").run()).rejects.toThrow(/append-only/);
  });

  it("the default lines of S11-style items reach the snapshot (care-plan prices)", async () => {
    await siteItems();
    const o = await owner();
    const care = await mkItem({
      unit: "month",
      default_lines: JSON.stringify([
        {
          description: "Monthly management",
          unit: "month",
          qtyMilli: 1_000,
          rateInrMinor: 999_900,
          rateUsdMinor: null,
        },
      ]),
      schedule: JSON.stringify([{ label: "Monthly in advance", pctBp: 10_000, trigger: "monthly" }]),
    });
    expect((await publish(o.cookie)).status).toBe(201);
    expect(itemOf(JSON.parse((await newest())?.json ?? "{}"), care.code).defaultLines[0].rateInrMinor).toBe(
      999_900,
    );
    expect(UPFRONT).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
/** The needs without the service ids the screen links with (checked once on their own). */
const withoutIds = (needs: J[]) => needs.map(({ id: _id, ...n }) => n);

describe("publish refuses a snapshot the website cannot be built from [ADM-CAT-05; review finding 2]", () => {
  beforeAll(async () => {
    await putPaymentTerms();
  });
  const publish = (cookie: string) => call("/catalogue/publish", { method: "POST", cookie });
  const patch = (id: string, cookie: string, body: unknown) =>
    call(`/catalogue/${id}`, { method: "PATCH", body, cookie });
  const refused = async (cookie: string) => {
    const before = await countOf("site_snapshots");
    const res = await publish(cookie);
    expect(res.status, await res.clone().text()).toBe(422);
    const out = await json(res);
    expect(out.error.code).toBe("snapshot_invalid");
    // Nothing is stored, and the answer carries codes and field names, never a value.
    expect(await countOf("site_snapshots")).toBe(before);
    return out;
  };

  it("the services the website needs publish fine (the control for the cases below)", async () => {
    await siteItems();
    const o = await owner();
    const res = await publish(o.cookie);
    expect(res.status, await res.clone().text()).toBe(201);
  });

  it("a retired service the website uses stops the publish and names it by code", async () => {
    const site = await siteItems();
    const o = await owner();
    const s7 = site.get("S7");
    expect(
      (await call(`/catalogue/${s7?.id}/active`, { body: { active: false }, cookie: o.cookie })).status,
    ).toBe(200);
    const out = await refused(o.cookie);
    expect(out.paths).toEqual(["items.S7"]);
    expect(withoutIds(out.needs)).toEqual([{ code: "S7", missing: "service" }]);
    expect(typeof out.needs[0].id).toBe("string"); // the retired service still exists: the screen links to it
    // Bringing it back lets the publish through.
    await call(`/catalogue/${s7?.id}/active`, { body: { active: true }, cookie: o.cookie });
    // The same list as the one published by the control test above, so it answers "unchanged" (200), not 422.
    expect([200, 201]).toContain((await publish(o.cookie)).status);
  });

  it("clearing a service's rupee price stops the publish (its USD price may stay empty)", async () => {
    const site = await siteItems();
    const o = await owner();
    const s5 = site.get("S5");
    const edit = await patch(s5?.id ?? "", o.cookie, {
      expectedUpdatedAt: s5?.updatedAt,
      priceInrMinor: null,
    });
    expect(edit.status).toBe(200);
    const out = await refused(o.cookie);
    expect(out.paths).toEqual(["items.S5.priceInrMinor"]);
    expect(withoutIds(out.needs)).toEqual([{ code: "S5", missing: "price", currency: "inr" }]);
    expect(JSON.stringify(out)).not.toContain("5000000");
  });

  it("taking a service off the website stops the publish", async () => {
    const site = await siteItems();
    const o = await owner();
    const s9 = site.get("S9");
    const edit = await patch(s9?.id ?? "", o.cookie, { expectedUpdatedAt: s9?.updatedAt, showOnSite: false });
    expect(edit.status).toBe(200);
    const out = await refused(o.cookie);
    expect(out.paths).toEqual(["items.S9"]);
    expect(withoutIds(out.needs)).toEqual([{ code: "S9", missing: "service" }]);
  });

  it("renaming a default line the website reads by its first word stops the publish", async () => {
    const site = await siteItems();
    const o = await owner();
    const s11 = site.get("S11");
    const line = (description: string) => ({
      description,
      unit: "fixed",
      qtyMilli: 1_000,
      rateInrMinor: 50_000,
      rateUsdMinor: null,
    });
    const edit = await patch(s11?.id ?? "", o.cookie, {
      expectedUpdatedAt: s11?.updatedAt,
      defaultLines: [line("Initial fee"), line("Monthly thing")],
    });
    expect(edit.status).toBe(200);
    const out = await refused(o.cookie);
    expect(out.paths).toEqual(["items.S11.lines.setup"]);
    expect(withoutIds(out.needs)).toEqual([
      { code: "S11", missing: "line", line: "setup", currency: null, ambiguous: false },
    ]);
  });

  it("clearing the rupee rate of a care-plan tier, and two lines starting with the same word, stop it too", async () => {
    const site = await siteItems();
    const o = await owner();
    const s16 = site.get("S16");
    const line = (description: string, rate: number | null) => ({
      description,
      unit: "fixed",
      qtyMilli: 1_000,
      rateInrMinor: rate,
      rateUsdMinor: null,
    });
    const cleared = await patch(s16?.id ?? "", o.cookie, {
      expectedUpdatedAt: s16?.updatedAt,
      defaultLines: [line("Essential thing", 1_000), line("Growth thing", null), line("Scale thing", 1_000)],
    });
    expect(cleared.status).toBe(200);
    const a = await refused(o.cookie);
    expect(a.paths).toEqual(["items.S16.lines.growth"]);
    expect(withoutIds(a.needs)).toEqual([
      { code: "S16", missing: "line", line: "growth", currency: "inr", ambiguous: false },
    ]);
    const twice = await patch(s16?.id ?? "", o.cookie, {
      expectedUpdatedAt: (await json(cleared)).updatedAt,
      defaultLines: [
        line("Essential thing", 1_000),
        line("Essential extra", 1_000),
        line("Growth thing", 1_000),
        line("Scale thing", 1_000),
      ],
    });
    expect(twice.status).toBe(200);
    const b = await refused(o.cookie);
    expect(withoutIds(b.needs)).toEqual([
      { code: "S16", missing: "line", line: "essential", currency: null, ambiguous: true },
    ]);
  });

  it("lists every gap, not only the first", async () => {
    const site = await siteItems();
    const o = await owner();
    await call(`/catalogue/${site.get("S1")?.id}/active`, { body: { active: false }, cookie: o.cookie });
    await call(`/catalogue/${site.get("S2")?.id}/active`, { body: { active: false }, cookie: o.cookie });
    const out = await refused(o.cookie);
    expect(out.paths).toEqual(["items.S1", "items.S2"]);
  });

  it("a service the website does not use can be retired or hidden without stopping the publish", async () => {
    const site = await siteItems();
    const o = await owner();
    const extra = await mkItem();
    expect((await publish(o.cookie)).status).toBe(201);
    await call(`/catalogue/${extra.id}/active`, { body: { active: false }, cookie: o.cookie });
    // The snapshot lost the extra item, so it is a new list, and it publishes.
    const again = await publish(o.cookie);
    expect(again.status).toBe(201);
    expect((await json(again)).items).toBe(site.size);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the body limit of the catalogue saves [review finding 4]", () => {
  const long = (n: number, tag: string) => `${tag}`.repeat(Math.ceil(n / tag.length)).slice(0, n);
  /** A service that passes every field cap: four 2,500-character texts and thirty 200-character lines. */
  const lines = (rate: number) =>
    Array.from({ length: 30 }, (_, i) => ({
      description: `Line ${i} ${long(180, "x")}`,
      unit: "fixed",
      qtyMilli: 1_000,
      rateInrMinor: rate,
      rateUsdMinor: 1_200,
    }));
  const fullEntry = () =>
    entryBody({
      longMd: long(2500, "Long text. "),
      deliverablesMd: long(2500, "Deliverable. "),
      assumptionsMd: long(2500, "Assumption. "),
      exclusionsMd: long(2500, "Exclusion. "),
      defaultLines: lines(100_000),
    });

  it("a valid service of about 19 KB is saved (it would not fit the 16 KB limit of other routes)", async () => {
    const o = await owner();
    const body = fullEntry();
    const size = JSON.stringify(body).length;
    expect(size).toBeGreaterThan(17 * 1024);
    expect(size).toBeLessThan(32 * 1024);
    const res = await call("/catalogue", { body, cookie: o.cookie });
    expect(res.status, await res.clone().text()).toBe(201);
    const { id } = await json(res);
    // The same on an edit.
    const row = await one<{ updated_at: number }>("SELECT updated_at FROM catalogue_items WHERE id = ?", id);
    const edit = await call(`/catalogue/${id}`, {
      method: "PATCH",
      body: {
        expectedUpdatedAt: row?.updated_at,
        deliverablesMd: long(2400, "Changed. "),
        defaultLines: lines(200_000),
      },
      cookie: o.cookie,
    });
    expect(edit.status, await edit.clone().text()).toBe(200);
  });

  it("over 32 KB answers 413 on a create and on an edit, and nothing is written", async () => {
    const o = await owner();
    const item = await mkItem();
    const before = await countOf("catalogue_items");
    const create = await call("/catalogue", {
      body: entryBody({ short: "x".repeat(33 * 1024) }),
      cookie: o.cookie,
    });
    expect(create.status).toBe(413);
    expect(await code(create)).toBe("bad_request");
    const edit = await call(`/catalogue/${item.id}`, {
      method: "PATCH",
      body: { expectedUpdatedAt: item.updatedAt, name: "x".repeat(33 * 1024) },
      cookie: o.cookie,
    });
    expect(edit.status).toBe(413);
    expect(await countOf("catalogue_items")).toBe(before);
  });

  it("a template save also reads up to 32 KB (12,000 characters with multi-byte ones pass 16 KB)", async () => {
    const o = await owner();
    const body = {
      kind: "estimate",
      category: "advise",
      body: {
        sections: [
          { key: "scope", heading: "Scope", body: "₹".repeat(1_900) },
          { key: "price", heading: "Price", body: "₹".repeat(1_900) },
          { key: "terms", heading: "Terms", body: "₹".repeat(1_900) },
        ],
      },
    };
    expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeGreaterThan(16 * 1024);
    const res = await call("/templates", { body, cookie: o.cookie });
    expect(res.status, await res.clone().text()).toBe(201);
  });

  it("every other route keeps the 16 KB limit", async () => {
    const o = await owner();
    for (const [path, method] of [
      ["/leads", "POST"],
      ["/clients", "POST"],
    ] as const) {
      const res = await call(path, { method, body: { name: "x".repeat(17 * 1024) }, cookie: o.cookie });
      expect(res.status, path).toBe(413);
    }
  });
});
