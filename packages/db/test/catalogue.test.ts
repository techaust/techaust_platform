// The catalogue tables (M4.1, migrations 0024 and 0025): append-only templates, snapshots and price history, items never deleted,
// an older snapshot may be stored again as a new row (no unique SHA), the seed's templates and its snapshot, and that the seed never reverts an edit.
import { env } from "cloudflare:workers";
import { catalogueSnapshot, SETTINGS_DEFAULTS } from "@techaust/core";
import {
  type CatalogueRow,
  canonicalJson,
  catalogueCode,
  parseSnapshot,
  renderTemplateBody,
  snapshotFromRows,
  TEMPLATE_PLACEHOLDERS,
  templateBody,
  unknownPlaceholders,
} from "@techaust/core/catalogue";
import { describe, expect, it } from "vitest";
import { seedStatements } from "../src/seed/index.ts";
import { SEED_TEMPLATES } from "../src/seed/templates.ts";
import { all, first, rejects, run } from "./helpers.ts";

const seed = () => env.DB.batch(seedStatements().map((s) => env.DB.prepare(s)));

describe("append-only catalogue tables (0025; ADM-CAT-03, -04, -05)", () => {
  it("templates refuse UPDATE and DELETE; a new version is a new row; a category-less kind keeps one row per version", async () => {
    await run(
      "INSERT INTO templates (id, kind, category, version, body) VALUES ('t1', 'proposal', 'build', 90, '{}')",
    );
    await run(
      "INSERT INTO templates (id, kind, category, version, body) VALUES ('t2', 'proposal', 'build', 91, '{}')",
    );
    await rejects(run("UPDATE templates SET body = '{\"x\":1}' WHERE id = 't1'"), /templates is append-only/);
    await rejects(run("DELETE FROM templates WHERE id = 't1'"), /templates is append-only/);
    await rejects(
      run(
        "INSERT INTO templates (id, kind, category, version, body) VALUES ('t3', 'proposal', 'build', 91, '{}')",
      ),
      /UNIQUE/,
    );
    await run(
      "INSERT INTO templates (id, kind, category, version, body) VALUES ('t4', 'care_block', NULL, 90, '{}')",
    );
    await rejects(
      run(
        "INSERT INTO templates (id, kind, category, version, body) VALUES ('t5', 'care_block', NULL, 90, '{}')",
      ),
      /UNIQUE/,
    );
  });

  it("site_snapshots refuse UPDATE and DELETE; an older SHA may be stored again (a revert)", async () => {
    await run("INSERT INTO site_snapshots (id, sha256, json) VALUES ('s1', 'aa', '{}')");
    await rejects(run("UPDATE site_snapshots SET json = '[]'"), /site_snapshots is append-only/);
    await rejects(run("DELETE FROM site_snapshots"), /site_snapshots is append-only/);
    await run("INSERT INTO site_snapshots (id, sha256, json) VALUES ('s3', 'bb', '{}')");
    await run("INSERT INTO site_snapshots (id, sha256, json) VALUES ('s4', 'aa', '{}')");
  });

  it("price history is append-only and a catalogue item is never deleted", async () => {
    await seed();
    const item = await first<{ id: string }>("SELECT id FROM catalogue_items WHERE code = 'S1'");
    await run(
      "INSERT INTO catalogue_price_history (id, item_id, field, old_minor, new_minor) VALUES ('h1', ?, 'price_inr_minor', 1, 2)",
      item?.id,
    );
    await rejects(run("UPDATE catalogue_price_history SET new_minor = 3"), /append-only/);
    await rejects(run("DELETE FROM catalogue_price_history"), /append-only/);
    await rejects(run("DELETE FROM catalogue_items WHERE code = 'S1'"), /deactivating it, never deleted/);
    await run("UPDATE catalogue_items SET active = 0 WHERE code = 'S1'"); // retiring is allowed
    expect(await first("SELECT active FROM catalogue_items WHERE code = 'S1'")).toEqual({ active: 0 });
  });
});

describe("the seed (ADM-CAT-01, ADM-CAT-03)", () => {
  it("never reverts an edited item or a new template version", async () => {
    await seed();
    await run("UPDATE catalogue_items SET name = 'Renamed', price_inr_minor = 1234500 WHERE code = 'S2'");
    await run(
      "INSERT INTO templates (id, kind, category, version, body) VALUES ('v3', 'proposal', 'advise', 3, '{}')",
    );
    await seed();
    await seed();
    expect(await first("SELECT name, price_inr_minor FROM catalogue_items WHERE code = 'S2'")).toEqual({
      name: "Renamed",
      price_inr_minor: 1_234_500,
    });
    const versions = await all<{ version: number }>(
      "SELECT version FROM templates WHERE kind = 'proposal' AND category = 'advise' ORDER BY version",
    );
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it("seeds versions 1, 2 and 3 (the care block's, 07-U §9) of one template per kind and category, and each renders with test data and leaves nothing unresolved", async () => {
    await seed();
    const rows = await all<{ kind: string; category: string | null; version: number; body: string }>(
      "SELECT kind, category, version, body FROM templates WHERE version IN (1, 2) OR (version = 3 AND kind = 'care_block') ORDER BY kind, category, version",
    );
    expect(rows).toHaveLength(SEED_TEMPLATES.length);
    expect(new Set(rows.map((r) => `${r.kind}:${r.category}:${r.version}`)).size).toBe(rows.length);
    const data = Object.fromEntries(TEMPLATE_PLACEHOLDERS.map((p) => [p, `<${p}>`]));
    for (const r of rows) {
      const body = templateBody.parse(JSON.parse(r.body));
      expect(unknownPlaceholders(body), `${r.kind}/${r.category}/${r.version}`).toEqual([]);
      expect(renderTemplateBody(body, data).unresolved, `${r.kind}/${r.category}/${r.version}`).toEqual([]);
    }
  });

  it("the care block's version 3 is version 2 with the 07-U §9 sentence added, as a new version (Researched 2026-10-28, 08-C RA-24)", async () => {
    await seed();
    const body = async (v: number) =>
      (
        JSON.parse(
          (
            await first<{ body: string }>(
              "SELECT body FROM templates WHERE kind = 'care_block' AND version = ?",
              v,
            )
          )?.body ?? "{}",
        ) as { sections: { key: string; body: string }[] }
      ).sections;
    const [v2, v3] = [await body(2), await body(3)];
    expect(v3.map((s) => s.key)).toEqual(v2.map((s) => s.key));
    const sentence = "Extra hours are invoiced on the next monthly invoice and are due with it.";
    expect(v2[0]?.body).not.toContain(sentence);
    expect(v3[0]?.body).toContain(sentence);
    expect(v3[0]?.body.replace(` ${sentence}`, "")).toBe(v2[0]?.body);
  });

  it("version 2 keeps every section key and carries the 07-O wording (M4.3 review fix 7)", async () => {
    await seed();
    type T = { kind: string; category: string | null; version: number; body: string };
    const rows = await all<T>(
      "SELECT kind, category, version, body FROM templates WHERE version IN (1, 2) ORDER BY kind, category, version",
    );
    const keys = (r: T) => (JSON.parse(r.body) as { sections: { key: string }[] }).sections.map((s) => s.key);
    for (const v2 of rows.filter((r) => r.version === 2)) {
      const v1 = rows.find((r) => r.version === 1 && r.kind === v2.kind && r.category === v2.category);
      expect(keys(v2), `${v2.kind}/${v2.category}`).toEqual(keys(v1 as T));
    }
    const section = (kind: string, category: string | null, key: string) =>
      (
        JSON.parse(
          rows.find((r) => r.version === 2 && r.kind === kind && r.category === category)?.body ?? "{}",
        ) as {
          sections: { key: string; heading: string; body: string }[];
        }
      ).sections.find((s) => s.key === key);
    // the first line of the Summary differs by category
    expect(section("proposal", "advise", "summary")?.body).toBe(
      "{{client.name}} asked us for {{service.name}}. This proposal sets out what we'll look at, what you'll receive and what it costs.",
    );
    expect(section("proposal", "run", "summary")?.body).toBe(
      "This proposal covers {{service.name}} for {{client.name}}: the support we'll provide each month and the monthly price.",
    );
    expect(section("proposal", "build", "cover")?.body).toBe(
      "{{client.name}}\n{{service.name}}\nProposal from {{company.name}}",
    );
    expect(section("proposal", "connect", "estimate")?.body).toBe("Payment schedule: {{service.schedule}}");
    expect(section("proposal", "automate", "acceptance")?.body).toContain(
      'tick "I have read and agree to the terms". This proposal is valid for {{proposal.validity_days}} days from the date it\'s sent.',
    );
    // written per proposal, and the terms sentence is filled by the screen: all empty here
    for (const key of ["problem_goals", "timeline", "team", "terms"])
      expect(section("proposal", "build", key)?.body, key).toBe("");
    // the estimate's second section is Validity (the key is unchanged)
    expect(section("estimate", "build", "schedule")).toMatchObject({
      heading: "Validity",
      body: "This estimate is valid for {{proposal.validity_days}} days from the date it's sent.",
    });
    expect(section("estimate", "advise", "estimate")?.body).toContain(
      "This is an estimate, not a tax invoice.",
    );
    expect(section("care_block", null, "care_plan")?.body).toMatch(
      /^Care plans are paid monthly in advance\./,
    );
    expect(section("terms_block", null, "terms")?.body).toBe(
      "These terms are part of the proposal from {{company.name}}.",
    );
  });

  it("builds a snapshot from the seeded rows that both schemas accept, with the section headings only in templates", async () => {
    await seed();
    const rows = await all<CatalogueRow>(
      "SELECT code, name, slug, category, unit, price_inr_minor, price_usd_minor, schedule, default_lines, show_on_site, active FROM catalogue_items",
    );
    const terms = SETTINGS_DEFAULTS.payment_terms;
    const built = snapshotFromRows(rows, terms);
    const parsed = parseSnapshot(built);
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    expect(catalogueSnapshot.safeParse(built).success).toBe(true);
    // S3 is off the site in the seed (Q-B12), so it is not published.
    expect(built.items.map((i) => i.code)).not.toContain("S3");
    expect(built.items.length).toBe(rows.filter((r) => r.show_on_site === 1 && r.active === 1).length);
    expect(canonicalJson(built)).not.toMatch(/sac|gstRate|deliverables/);
  });

  it("the code pattern accepts the seed's codes", async () => {
    const codes = await all<{ code: string }>("SELECT code FROM catalogue_items");
    for (const c of codes) expect(catalogueCode.safeParse(c.code).success).toBe(true);
  });
});
