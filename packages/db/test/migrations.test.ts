import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "../src/schema/index.ts";
import { all, first, rejects, run } from "./helpers.ts";

const tables = (Object.values(schema) as unknown[]).filter((v): v is SQLiteTable => is(v, SQLiteTable));

describe("migrations apply cleanly to a fresh D1", () => {
  it("creates every table in the Drizzle schema, with every column", async () => {
    expect(tables.length).toBe(50);
    for (const table of tables) {
      const { name, columns } = getTableConfig(table);
      const live = await all<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, name);
      expect(live.map((c) => c.name).sort(), name).toEqual(columns.map((c) => c.name).sort());
    }
  });

  it("records every migration", async () => {
    const applied = await all<{ name: string }>("SELECT name FROM d1_migrations ORDER BY id");
    expect(applied.map((m) => m.name)).toEqual([
      "0000_init.sql",
      "0001_triggers.sql",
      "0002_invites_bootstrap.sql",
      "0003_staff_known_devices.sql",
      "0004_auth_triggers.sql",
      "0005_drop_access_log_at.sql",
      "0006_portal_triggers.sql",
      "0007_issue_guard.sql",
      "0008_indexes_fk_lookups.sql",
      "0009_email_log.sql",
      "0010_leads_request_type_plan.sql",
      "0011_terms_blocks.sql",
      "0012_terms_triggers.sql",
      "0013_documents_terms_version_index.sql",
      "0014_notifications_and_indexes.sql",
      "0015_bank_active_kind_notifications_unread.sql",
      "0016_leads_duplicate_proposal_retention.sql",
      "0017_drop_unused_lead_indexes.sql",
      "0018_clients_contacts_indexes.sql",
      "0019_client_triggers.sql",
      "0020_clients_filter_indexes.sql",
      "0021_leads_contact_id.sql",
      "0022_leads_contact_backfill.sql",
      "0023_client_type_lock.sql",
      "0024_project_indexes.sql",
      "0025_project_triggers.sql",
      "0026_catalogue_indexes.sql",
      "0027_catalogue_triggers.sql",
      "0028_care_time.sql",
      "0029_time_triggers.sql",
      "0030_drop_time_logs_care_plan_date.sql",
      "0031_documents_quotes.sql",
      "0032_document_triggers.sql",
      "0033_documents_pdf_pending.sql",
      "0034_offers.sql",
      "0035_offer_triggers.sql",
      "0036_anonymised_client_name.sql",
      "0037_invoice_indexes.sql",
      "0038_invoice_triggers.sql",
      "0039_invoice_types.sql",
      "0040_invoice_type_triggers.sql",
      "0041_note_ims.sql",
      "0042_note_triggers.sql",
      "0043_billing.sql",
      "0044_billing_triggers.sql",
      "0045_reports.sql",
    ]);
  });

  it("the two unused lead indexes are gone and the ones the screens use remain (0017, M3.2)", async () => {
    const idx = (await all<{ name: string }>("SELECT name FROM pragma_index_list('leads')")).map(
      (i) => i.name,
    );
    expect(idx).not.toContain("leads_stage");
    expect(idx).not.toContain("leads_delete_after");
    expect(idx).toEqual(expect.arrayContaining(["leads_stage_activity", "leads_delete_due"]));
  });

  it("email_log has its indexes and only known statuses; email_suppressions is keyed by address (0009, M2.4)", async () => {
    const idx = await all<{ name: string }>("SELECT name FROM pragma_index_list('email_log')");
    expect(idx.map((i) => i.name)).toEqual(expect.arrayContaining(["email_log_entity", "email_log_status"]));
    const base = ["x", "a@example.com", "lead.alert"] as const;
    await rejects(
      run("INSERT INTO email_log (id, to_email, template, status) VALUES (?, ?, ?, 'bogus')", ...base),
      /CHECK constraint failed: email_log_status/,
    );
    await run("INSERT INTO email_log (id, to_email, template, status) VALUES (?, ?, ?, 'skipped')", ...base);
    await run("UPDATE email_log SET status = 'sending' WHERE id = 'x'");
    const cols = await all<{ name: string }>("SELECT name FROM pragma_table_info('leads')");
    expect(cols.map((c) => c.name)).toEqual(expect.arrayContaining(["request_type", "plan"]));
    await run("INSERT INTO email_suppressions (email, reason, at) VALUES ('a@example.com', 'bounce', 1)");
    await rejects(
      run("INSERT INTO email_suppressions (email, reason, at) VALUES ('a@example.com', 'complaint', 2)"),
      /UNIQUE/,
    );
  });

  it("foreign keys that the API filters or joins on are indexed (0008)", async () => {
    const wanted: Record<string, string> = {
      documents: "project_id care_plan_id",
      approvals: "document_id",
      acceptances: "contact_id",
      leads: "client_id",
      projects: "owner_id",
      milestones: "document_id",
      document_sends: "document_id contact_id",
      offer_links: "contact_id document_id send_id version_group_id",
    };
    for (const [table, columns] of Object.entries(wanted)) {
      for (const column of columns.split(" ")) {
        const hit = await all(
          `SELECT i.name FROM pragma_index_list(?1) i JOIN pragma_index_info(i.name) c WHERE c.seqno = 0 AND c.name = ?2`,
          table,
          column,
        );
        expect(hit.length, `${table}.${column} has an index starting with it`).toBeGreaterThan(0);
      }
    }
  });

  it("access_log has no index on `at` (M1.6, LD19: 3 rows written per access row instead of 4)", async () => {
    const indexes = await all<{ name: string }>(
      "SELECT name FROM pragma_index_list('access_log') WHERE origin = 'c'",
    );
    expect(indexes.map((i) => i.name)).toEqual(["access_log_actor"]);
  });

  it("an access row writes 3 rows (the row, its primary-key index and the actor index): 4 before M1.6 (local meta only)", async () => {
    const r = await run(
      "INSERT INTO access_log (id, realm, method, route, status) VALUES ('rows-written-probe', 'portal', 'GET', '/v1/me', 200)",
    );
    expect(r.meta.rows_written).toBe(3);
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
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES ('x', 'C-X', 'X', 'X', 'business', 'IN', 'unregistered', '19', 'INR')",
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
      state_code: "19",
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
    // M3.5: an entry needs exactly one target (a trigger that runs before the CHECK), so this one names a project.
    await run(
      "INSERT INTO projects (id, code, client_id, name, currency) VALUES ('pj', 'PRJ-MIG', 'cp-client', 'P', 'INR')",
    );
    await rejects(
      run(
        "INSERT INTO time_logs (id, user_id, work_date, minutes, project_id) VALUES ('t1', 'u3', '2026-10-06', 20, 'pj')",
      ),
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

describe("0002: bootstrap invites", () => {
  it("allows an invite without an inviter, and still checks the role", async () => {
    await run(
      "INSERT INTO staff_invites (token_hash, email, role, expires_at) VALUES ('h1', 'owner@example.com', 'owner', 1)",
    );
    await rejects(
      run(
        "INSERT INTO staff_invites (token_hash, email, role, expires_at) VALUES ('h2', 'x@example.com', 'root', 1)",
      ),
      /staff_invites_role/,
    );
    await rejects(
      run(
        "INSERT INTO staff_invites (token_hash, email, role, invited_by, expires_at) VALUES ('h3', 'x@example.com', 'staff', 'nobody', 1)",
      ),
      /FOREIGN KEY/i,
    );
  });
});
