// The catalogue tables (M4.1, migrations 0024 and 0025): append-only templates, snapshots and price history, items never deleted,
// one snapshot row per SHA, the seed's templates and its snapshot, and that the seed never reverts an edit.
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

  it("site_snapshots refuse UPDATE and DELETE and a second row with the same SHA", async () => {
    await run("INSERT INTO site_snapshots (id, sha256, json) VALUES ('s1', 'aa', '{}')");
    await rejects(run("UPDATE site_snapshots SET json = '[]'"), /site_snapshots is append-only/);
    await rejects(run("DELETE FROM site_snapshots"), /site_snapshots is append-only/);
    await rejects(run("INSERT INTO site_snapshots (id, sha256, json) VALUES ('s2', 'aa', '{}')"), /UNIQUE/);
    await run("INSERT INTO site_snapshots (id, sha256, json) VALUES ('s3', 'bb', '{}')");
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
      "INSERT INTO templates (id, kind, category, version, body) VALUES ('v2', 'proposal', 'advise', 2, '{}')",
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
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it("seeds one template per kind and category, and each renders with test data and leaves nothing unresolved", async () => {
    await seed();
    const rows = await all<{ kind: string; category: string | null; version: number; body: string }>(
      "SELECT kind, category, version, body FROM templates WHERE version = 1 ORDER BY kind, category",
    );
    expect(rows).toHaveLength(SEED_TEMPLATES.length);
    expect(new Set(rows.map((r) => `${r.kind}:${r.category}`)).size).toBe(rows.length);
    const data = Object.fromEntries(TEMPLATE_PLACEHOLDERS.map((p) => [p, `<${p}>`]));
    for (const r of rows) {
      const body = templateBody.parse(JSON.parse(r.body));
      expect(unknownPlaceholders(body), `${r.kind}/${r.category}`).toEqual([]);
      expect(renderTemplateBody(body, data).unresolved, `${r.kind}/${r.category}`).toEqual([]);
    }
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
