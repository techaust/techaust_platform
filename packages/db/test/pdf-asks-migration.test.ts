// Migration 0048 (review 2026-10-28, finding 8) only ADDS one table, the throttle of a request for a stored PDF (`pdf_asks`): nothing is rebuilt, dropped, altered or moved, so the migration guard
// (`scripts/check-migrations.mjs`) has nothing to check. No triggers on purpose: it is a throttle, not a record.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { all } from "./helpers.ts";

type Migration = { name: string; queries: string[] };

describe("0048_pdf_asks", () => {
  const migration = (env.TEST_MIGRATIONS as unknown as Migration[]).find(
    (m) => m.name === "0048_pdf_asks.sql",
  );

  it("is one CREATE TABLE and nothing else", () => {
    expect(migration).toBeDefined();
    const statements = (migration?.queries ?? [])
      .map((q) => q.replace(/^--> statement-breakpoints*/gm, "").trim())
      .filter((q) => q !== "");
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^CREATE TABLE `pdf_asks`/);
    expect(statements[0]).not.toContain("__new_");
  });

  it("the table has a key and a time, no foreign keys and no triggers", async () => {
    const cols = await all<{ name: string; not_null: number; pk: number }>(
      "SELECT name, [notnull] AS not_null, pk FROM pragma_table_info('pdf_asks')",
    );
    expect(cols.map((c) => c.name).sort()).toEqual(["asked_at", "key"]);
    expect(cols.find((c) => c.name === "key")?.pk).toBe(1);
    expect(cols.find((c) => c.name === "asked_at")?.not_null).toBe(1);
    expect(await all("SELECT 1 FROM pragma_foreign_key_list('pdf_asks')")).toEqual([]);
    expect(
      await all("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'pdf_asks'"),
    ).toEqual([]);
  });
});
