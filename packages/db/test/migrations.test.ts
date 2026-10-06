import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "../src/schema/index.ts";
import { all, first, rejects, run } from "./helpers.ts";

const tables = (Object.values(schema) as unknown[]).filter((v): v is SQLiteTable => is(v, SQLiteTable));

describe("migrations apply cleanly to a fresh D1", () => {
  it("creates every table in the Drizzle schema, with every column", async () => {
    expect(tables.length).toBe(36);
    for (const table of tables) {
      const { name, columns } = getTableConfig(table);
      const live = await all<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, name);
      expect(live.map((c) => c.name).sort(), name).toEqual(columns.map((c) => c.name).sort());
    }
  });

  it("records both migrations", async () => {
    const applied = await all<{ name: string }>("SELECT name FROM d1_migrations ORDER BY id");
    expect(applied.map((m) => m.name)).toEqual(["0000_init.sql", "0001_triggers.sql"]);
  });

  it("enforces foreign keys", async () => {
    await rejects(
      run(
        "INSERT INTO contacts (id, client_id, name, email) VALUES ('c1', 'no-such-client', 'A', 'a@example.com')",
      ),
      /FOREIGN KEY/i,
    );
  });

  it("fills created_at/updated_at with the current time in UTC ms", async () => {
    const before = Date.now();
    await run(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, currency) VALUES ('x', 'C-X', 'X', 'X', 'business', 'IN', 'unregistered', 'INR')",
    );
    const row = await first<{ created_at: number; updated_at: number }>(
      "SELECT created_at, updated_at FROM clients WHERE id = 'x'",
    );
    expect(row?.created_at).toBeGreaterThanOrEqual(before - 1_000);
    expect(row?.created_at).toBeLessThanOrEqual(Date.now() + 1_000);
    expect(Number.isInteger(row?.created_at)).toBe(true);
  });
});

describe("CHECK constraints", () => {
  const client = (fields: Record<string, unknown>) => {
    const row = {
      id: crypto.randomUUID(),
      code: `C-${crypto.randomUUID()}`,
      legal_name: "L",
      display_name: "D",
      type: "business",
      country: "IN",
      gst_status: "unregistered",
      currency: "INR",
      ...fields,
    };
    const cols = Object.keys(row);
    return run(
      `INSERT INTO clients (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      ...Object.values(row),
    );
  };

  it("rejects unknown currencies and enum values", async () => {
    await rejects(client({ currency: "EUR" }), /CHECK constraint failed: clients_currency/);
    await rejects(client({ type: "robot" }), /clients_type/);
  });

  it("a registered client needs a GSTIN, an unregistered one has none", async () => {
    await rejects(client({ gst_status: "registered" }), /clients_gstin_registered/);
    await rejects(client({ gstin: "27AAPFU0939F1ZV" }), /clients_gstin_registered/);
    await client({ gst_status: "registered", gstin: "27AAPFU0939F1ZV" });
    await rejects(client({ gst_status: "registered", gstin: "27AAPFU0939F1ZV" }), /UNIQUE/);
  });

  it("emails are stored lower-case; care-plan billing day is 1–28; time is in 15-minute steps", async () => {
    await rejects(
      run("INSERT INTO staff_users (id, email, name, role) VALUES ('u1', 'Owner@Example.com', 'O', 'owner')"),
      /staff_users_email_lower/,
    );
    await rejects(
      run("INSERT INTO staff_users (id, email, name, role) VALUES ('u2', 'a@b.co', 'O', 'admin')"),
      /staff_users_role/,
    );
    await client({ id: "cp-client" });
    await rejects(
      run(
        "INSERT INTO care_plans (id, client_id, tier, currency, price_minor, start_date, billing_day) VALUES ('cp', 'cp-client', 'growth', 'INR', 2499900, '2026-10-01', 29)",
      ),
      /care_plans_billing_day/,
    );
    await run(
      "INSERT INTO staff_users (id, email, name, role) VALUES ('u3', 'staff@example.com', 'S', 'staff')",
    );
    await rejects(
      run("INSERT INTO time_logs (id, user_id, work_date, minutes) VALUES ('t1', 'u3', '2026-10-06', 20)"),
      /time_logs_minutes/,
    );
  });

  it("a lost lead needs a reason, and only lost leads have one", async () => {
    const lead = (stage: string, reason: string | null) =>
      run(
        "INSERT INTO leads (id, ref, stage, lost_reason, source, contact_name, contact_email) VALUES (?, ?, ?, ?, 'web', 'A', 'a@b.co')",
        crypto.randomUUID(),
        `L-${crypto.randomUUID().slice(0, 5)}`,
        stage,
        reason,
      );
    await rejects(lead("lost", null), /leads_lost_reason/);
    await rejects(lead("new", "price"), /leads_lost_reason/);
    await lead("lost", "price");
  });
});
