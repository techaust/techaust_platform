// Migration 0045 (M5.5b, LD81) only ADDS: one new table (a cache, with no triggers) and five indexes. Nothing is rebuilt, dropped, altered, moved or deleted, so the code
// of M5.4 runs against the new schema unchanged and the migration guard (`scripts/check-migrations.mjs`, empty allow-list) has nothing to check.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { all } from "./helpers.ts";
import { addDoc, mkReportClient } from "./reports-helpers.ts";

type Migration = { name: string; queries: string[] };

describe("0045_reports", () => {
  const migration = (env.TEST_MIGRATIONS as unknown as Migration[]).find(
    (m) => m.name === "0045_reports.sql",
  );

  it("exists, and every statement of it is a CREATE TABLE or a CREATE INDEX", () => {
    expect(migration).toBeDefined();
    const statements = (migration?.queries ?? [])
      .map((q) => q.replace(/^--> statement-breakpoints*/gm, "").trim())
      .filter((q) => q !== "");
    expect(statements).toHaveLength(7);
    for (const q of statements) expect(q, q).toMatch(/^CREATE (TABLE|INDEX) /);
    const all = statements.join("\n");
    expect(statements.filter((q) => /^(DROP|ALTER|INSERT|UPDATE|DELETE|PRAGMA)\b/i.test(q))).toEqual([]);
    expect(all).not.toContain("__new_");
    expect(statements.filter((q) => q.startsWith("CREATE TABLE"))).toHaveLength(1);
    expect(all).toContain("CREATE TABLE `statement_pdfs`");
    for (const index of [
      "statement_pdfs_client",
      "statement_pdfs_created",
      "advance_receipts_client_received",
      "documents_issued_on",
      "documents_export_issued",
      "documents_client_issued",
    ]) {
      expect(all, index).toContain(`CREATE INDEX \`${index}\``);
    }
  });

  it("the new table has no triggers (a cache, not a record), and the three document indexes are partial", async () => {
    const triggers = await all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'statement_pdfs'",
    );
    expect(triggers).toEqual([]);
    for (const name of ["documents_issued_on", "documents_export_issued", "documents_client_issued"]) {
      const row = await all<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
        name,
      );
      expect(row[0]?.sql, name).toMatch(/WHERE .*frozen_at.* is not null/i);
    }
  });

  it("documents are written and read as before: the new indexes change no behaviour", async () => {
    const c = await mkReportClient("INR");
    const d = await addDoc({ clientId: c, issueDate: "2027-08-01" });
    const read = await all<{ id: string; status: string }>(
      "SELECT id, status FROM documents WHERE id = ?",
      d.id,
    );
    expect(read).toEqual([{ id: d.id, status: "issued" }]);
  });
});
