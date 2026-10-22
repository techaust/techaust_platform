// The referenced-table rebuild guard (scripts/migration-guard.mjs, run by `pnpm check` and CI): a migration after
// 0006 that drops or rebuilds a table other tables reference must fail unless it is allow-listed with a reason.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findRebuildViolations, loadMigrations, referencedBy } from "../../../scripts/migration-guard.mjs";

type Migration = { name: string; sql: string };
const violations = (
  migrations: Migration[],
  allow: { migration: string; table: string; reason: string }[] = [],
): string[] => findRebuildViolations(migrations, allow);

const BASE: Migration = {
  name: "0000_init.sql",
  sql: [
    "CREATE TABLE `clients` (`id` text PRIMARY KEY NOT NULL);",
    "CREATE TABLE `documents` (`id` text PRIMARY KEY NOT NULL, `client_id` text NOT NULL, `parent_id` text, FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action, FOREIGN KEY (`parent_id`) REFERENCES `documents`(`id`));",
    "CREATE TABLE `lines` (`id` text PRIMARY KEY NOT NULL, `document_id` text NOT NULL, FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE cascade);",
    "CREATE TABLE `invites` (`token` text PRIMARY KEY NOT NULL);",
  ].join("\n--> statement-breakpoint\n"),
};

// What drizzle-kit writes to change a column of `documents` (the table `lines` references).
const REBUILD_DOCUMENTS: Migration = {
  name: "0007_rebuild_documents.sql",
  sql: [
    "PRAGMA foreign_keys=OFF;",
    "CREATE TABLE `__new_documents` (`id` text PRIMARY KEY NOT NULL, `client_id` text NOT NULL, FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`));",
    "INSERT INTO `__new_documents`(`id`, `client_id`) SELECT `id`, `client_id` FROM `documents`;",
    "DROP TABLE `documents`;",
    "ALTER TABLE `__new_documents` RENAME TO `documents`;",
    "PRAGMA foreign_keys=ON;",
  ].join("--> statement-breakpoint\n"),
};

describe("referenced-table rebuild guard", () => {
  it("fails a drizzle-style rebuild of a table other tables reference", () => {
    const found = violations([BASE, REBUILD_DOCUMENTS]);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("0007_rebuild_documents.sql");
    expect(found[0]).toContain("`documents`");
    expect(found[0]).toContain("`lines`");
  });

  it("fails a plain DROP TABLE of a referenced table too", () => {
    const drop = { name: "0007_drop.sql", sql: "DROP TABLE `clients`;" };
    expect(violations([BASE, drop])).toHaveLength(1);
    expect(violations([BASE, { name: "0007_drop.sql", sql: "DROP TABLE IF EXISTS clients;" }])).toHaveLength(
      1,
    );
  });

  it("allows rebuilding a table nothing references, and a self-reference alone doesn't count", () => {
    const rebuildInvites: Migration = {
      name: "0007_invites.sql",
      sql: "CREATE TABLE `__new_invites` (`token` text);\n--> statement-breakpoint\nINSERT INTO `__new_invites` SELECT * FROM `invites`;\n--> statement-breakpoint\nDROP TABLE `invites`;\n--> statement-breakpoint\nALTER TABLE `__new_invites` RENAME TO `invites`;",
    };
    expect(violations([BASE, rebuildInvites])).toEqual([]);
    const selfOnly: Migration = {
      name: "0000_init.sql",
      sql: "CREATE TABLE `nodes` (`id` text PRIMARY KEY, `parent_id` text REFERENCES `nodes`(`id`));",
    };
    expect(violations([selfOnly, { name: "0007_x.sql", sql: "DROP TABLE `nodes`;" }])).toEqual([]);
  });

  it("allows additive changes: new tables, indexes, ADD COLUMN", () => {
    const additive: Migration = {
      name: "0007_additive.sql",
      sql: "CREATE TABLE `notes` (`id` text, `document_id` text REFERENCES `documents`(`id`));\n--> statement-breakpoint\nCREATE INDEX `notes_doc` ON `notes` (`document_id`);\n--> statement-breakpoint\nALTER TABLE `documents` ADD `memo` text;",
    };
    expect(violations([BASE, additive])).toEqual([]);
  });

  it("only checks migrations after 0006 (earlier ones were applied before the guard)", () => {
    const old = { ...REBUILD_DOCUMENTS, name: "0006_rebuild_documents.sql" };
    expect(violations([BASE, old])).toEqual([]);
  });

  it("counts references added later with ALTER TABLE ADD ... REFERENCES", () => {
    const alter: Migration = {
      name: "0003_fk.sql",
      sql: "ALTER TABLE `invites` ADD `owner_id` text REFERENCES `clients`(`id`);",
    };
    const drop = { name: "0007_x.sql", sql: "DROP TABLE `clients`;" };
    expect(referencedBy([BASE, alter]).get("clients")?.has("invites")).toBe(true);
    expect(violations([BASE, alter, drop])).toHaveLength(1);
  });

  it("an allow-list entry needs the exact migration, table and a reason", () => {
    const entry = {
      migration: "0007_rebuild_documents.sql",
      table: "documents",
      reason: "Analyst checked: children copied first",
    };
    expect(violations([BASE, REBUILD_DOCUMENTS], [entry])).toEqual([]);
    expect(violations([BASE, REBUILD_DOCUMENTS], [{ ...entry, reason: " " }])).toHaveLength(1);
    expect(violations([BASE, REBUILD_DOCUMENTS], [{ ...entry, table: "clients" }])).toHaveLength(1);
    expect(violations([BASE, REBUILD_DOCUMENTS], [{ ...entry, migration: "0008_other.sql" }])).toHaveLength(
      1,
    );
  });

  it("sees two statements on one line", () => {
    const sneaky: Migration = {
      name: "0007_oneline.sql",
      sql: "ALTER TABLE `lines` ADD `note` text; DROP TABLE `clients`;",
    };
    expect(violations([BASE, sneaky])).toHaveLength(1);
  });

  it("sees a DROP after a trailing comment, and ignores a DROP that is only inside a comment", () => {
    const afterComment: Migration = {
      name: "0007_comment.sql",
      sql: "ALTER TABLE `lines` ADD `note` text; -- harmless; really\nDROP TABLE `clients`;",
    };
    expect(violations([BASE, afterComment])).toHaveLength(1);
    const onlyComment: Migration = {
      name: "0007_commented.sql",
      sql: "-- DROP TABLE `clients`;\nALTER TABLE `lines` ADD `note` text;",
    };
    expect(violations([BASE, onlyComment])).toEqual([]);
  });

  it("matches a DROP anywhere in the statement, not only at its start", () => {
    const wrapped: Migration = { name: "0007_wrapped.sql", sql: "BEGIN DROP TABLE `clients`" };
    expect(violations([BASE, wrapped])).toHaveLength(1);
  });

  it("the repository's real migrations pass", () => {
    const dir = join(import.meta.dirname, "..", "..", "db", "migrations");
    const allowFile = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "scripts",
      "migration-rebuild-allowlist.json",
    );
    const allow = JSON.parse(readFileSync(allowFile, "utf8"));
    expect(violations(loadMigrations(dir), allow)).toEqual([]);
  });
});
