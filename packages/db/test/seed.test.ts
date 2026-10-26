import { env } from "cloudflare:workers";
import { SETTINGS_DEFAULTS } from "@techaust/core";
import { sha256Hex } from "@techaust/core/hash";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/client.ts";
import { catalogueItems, settings } from "../src/schema/index.ts";
import { CATALOGUE } from "../src/seed/catalogue.ts";
import { literal, seedSql, seedStatements } from "../src/seed/index.ts";
import {
  PROPOSAL_TERMS_V1,
  PROPOSAL_TERMS_V1_OWNER_CONFIRMS,
  PROPOSAL_TERMS_V1_SHA256,
} from "../src/seed/terms.ts";
import { all, first, run } from "./helpers.ts";

const seed = () => env.DB.batch(seedStatements().map((s) => env.DB.prepare(s)));

describe("seed [ADM-CAT-01]", () => {
  it("loads the catalogue S1–S18 and the settings defaults", async () => {
    await seed();
    const items = await all<{ code: string }>("SELECT code FROM catalogue_items ORDER BY rowid");
    expect(items.map((i) => i.code)).toEqual(Array.from({ length: 18 }, (_, i) => `S${i + 1}`));
    const keys = await all<{ key: string }>("SELECT key FROM settings ORDER BY key");
    expect(keys.map((k) => k.key)).toEqual([
      "company",
      "email",
      "flags",
      "gateways",
      "numbering",
      "payment_terms",
      "retention",
      "tax",
    ]);
  });

  it("is idempotent: running it again changes nothing", async () => {
    await seed();
    const snapshot = async () => ({
      items: await all("SELECT * FROM catalogue_items ORDER BY code"),
      settings: await all("SELECT * FROM settings ORDER BY key"),
    });
    const once = await snapshot();
    await seed();
    await seed();
    expect(await snapshot()).toEqual(once);
  });

  it("never overwrites the Owner's edits", async () => {
    await seed();
    await run("UPDATE catalogue_items SET price_inr_minor = 4500000 WHERE code = 'S1'");
    await run(
      "UPDATE settings SET value = json_set(value, '$.defaultRateBp', 1200), version = 2 WHERE key = 'tax'",
    );
    await seed();
    expect(await first("SELECT price_inr_minor FROM catalogue_items WHERE code = 'S1'")).toEqual({
      price_inr_minor: 4_500_000,
    });
    expect(
      await first(
        "SELECT json_extract(value, '$.defaultRateBp') AS r, version FROM settings WHERE key = 'tax'",
      ),
    ).toEqual({
      r: 1200,
      version: 2,
    });
  });

  it("reads back through Drizzle with typed JSON", async () => {
    await seed();
    const db = createDb(env.DB);
    const [s16] = await db.select().from(catalogueItems).where(eq(catalogueItems.code, "S16"));
    expect(s16?.defaultLines?.map((l) => l.description)).toEqual(["Essential", "Growth", "Scale"]);
    expect(s16?.schedule).toEqual([{ label: "Monthly in advance", pctBp: 10_000, trigger: "monthly" }]);
    expect(s16?.active).toBe(true);
    // (Tests in one file share a database; "tax" was edited above, so read an untouched key.)
    const [numbering] = await db.select().from(settings).where(eq(settings.key, "numbering"));
    expect(numbering?.value).toEqual(SETTINGS_DEFAULTS.numbering);
  });

  it("matches the approved catalogue (docs/02 §4.1, Q-P3-6, docs/08 G-2)", () => {
    const byCode = Object.fromEntries(CATALOGUE.map((c) => [c.code, c]));
    expect(byCode.S1).toMatchObject({ priceInr: 40_000_00, priceUsd: 2_000_00, slug: "discovery-sprint" });
    expect(byCode.S5).toMatchObject({ priceInr: 3_00_000_00, priceUsd: 12_000_00 });
    expect(byCode.S18).toMatchObject({ priceInr: 1_75_000_00, priceUsd: 2_900_00 });
    expect(byCode.S3).toMatchObject({ priceUsd: null, showOnSite: false });
    for (const item of CATALOGUE) {
      expect(
        item.schedule.reduce((a, s) => a + s.pctBp, 0),
        item.code,
      ).toBe(10_000);
      expect(item.sac, item.code).toMatch(/^99831[3-6]$/);
      // Q-P3-6: jobs under ₹1 L are 100 % upfront; monthly services are billed monthly in advance.
      const expected =
        item.unit === "month"
          ? "monthly"
          : (item.priceInr ?? 0) < SETTINGS_DEFAULTS.payment_terms.smallJobThreshold.INR
            ? "upfront"
            : "build";
      const actual =
        item.schedule[0]?.trigger === "monthly"
          ? "monthly"
          : item.schedule.length === 1
            ? "upfront"
            : "build";
      expect(actual, item.code).toBe(expected);
    }
  });

  it("a changed code or a reused slug skips that row; it never fails the seed", async () => {
    await seed();
    // The Owner renamed S1's code: the stable id still exists, so the re-run skips it (it used to fail on the id).
    await run("UPDATE catalogue_items SET code = 'S1-OLD' WHERE code = 'S1'");
    // S2's row is gone and its slug is now used by another item: the re-run's insert hits the slug index.
    const s2 = await first<{ slug: string }>("SELECT slug FROM catalogue_items WHERE code = 'S2'");
    // M4.1: the no-delete trigger is off for this one simulation (an item is never deleted any more), then back on.
    const noDelete = await first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE name = 'catalogue_items_no_delete'",
    );
    await run("DROP TRIGGER catalogue_items_no_delete");
    await run("DELETE FROM catalogue_items WHERE code = 'S2'");
    await run(noDelete?.sql ?? "");
    await run("UPDATE catalogue_items SET slug = ? WHERE code = 'S4'", s2?.slug);
    await seed();
    expect(await all("SELECT code FROM catalogue_items WHERE code IN ('S1', 'S2')")).toEqual([]);
    expect((await first<{ slug: string }>("SELECT slug FROM catalogue_items WHERE code = 'S4'"))?.slug).toBe(
      s2?.slug,
    );
    expect(await first("SELECT code FROM catalogue_items WHERE code = 'S1-OLD'")).toEqual({ code: "S1-OLD" });
  });

  it("loads the first proposal terms (07-O section 2): version 1, the hash of its text, insert-only, never over a later version [ADM-SET-08]", async () => {
    await seed();
    await seed();
    const v1 = await first<{ id: string; body_md: string; sha256: string }>(
      "SELECT id, body_md, sha256 FROM terms_versions WHERE kind = 'proposal' AND version = 1",
    );
    expect(v1?.body_md).toBe(PROPOSAL_TERMS_V1);
    expect(v1?.sha256).toBe(await sha256Hex(PROPOSAL_TERMS_V1));
    expect(PROPOSAL_TERMS_V1_SHA256).toBe(await sha256Hex(PROPOSAL_TERMS_V1));
    expect(await first("SELECT count(*) AS n FROM terms_versions WHERE kind = 'proposal'")).toEqual({ n: 1 });
    // six numbered terms, no placeholders, the warranty line is the one the owner still has to confirm
    expect(PROPOSAL_TERMS_V1.split("\n\n")).toHaveLength(6);
    expect(PROPOSAL_TERMS_V1).not.toMatch(/\{\{/);
    expect(PROPOSAL_TERMS_V1).toContain(
      "4. **Warranty.** Defects in what we delivered are fixed free for 30 days after launch.",
    );
    expect(PROPOSAL_TERMS_V1_OWNER_CONFIRMS).toBe("warranty");
    // the owner writes version 2; the seed leaves it, and does not add anything
    await run(
      "INSERT INTO terms_versions (id, kind, version, body_md, sha256) VALUES ('owner-terms-2', 'proposal', 2, 'Owner text', 'h2')",
    );
    await seed();
    expect(
      await all("SELECT version, body_md FROM terms_versions WHERE kind = 'proposal' ORDER BY version"),
    ).toEqual([
      { version: 1, body_md: PROPOSAL_TERMS_V1 },
      { version: 2, body_md: "Owner text" },
    ]);
  });

  it("produces SQL for wrangler d1 execute, with safe literals", () => {
    expect(seedSql()).toMatch(/^-- Generated by .*\nINSERT INTO `settings`/);
    expect(literal("it's")).toBe("'it''s'");
    expect(literal(null)).toBe("NULL");
    expect(literal(true)).toBe("1");
    expect(literal({ a: "b'c" })).toBe(`'{"a":"b''c"}'`);
    expect(() => literal(1.5)).toThrow(RangeError);
  });
});
