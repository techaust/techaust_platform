// 0036 (batch review fix, 07-Q Q2): "Removed client" becomes "Anonymised client" on clients already anonymised, and nothing else changes.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { dataProtectionTriggerStatements } from "../src/triggers-data-protection.ts";
import { all, run } from "./helpers.ts";

const put = (key: string, name: string, anonymisedAt: number | null) =>
  run(
    "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency, anonymised_at) VALUES (?1, ?2, ?3, ?3, 'individual', 'IN', 'unregistered', '19', 'INR', ?4)",
    `an-${key}`,
    `C-an-${key}`,
    name,
    anonymisedAt,
  );

describe("0036_anonymised_client_name", () => {
  it("renames only anonymised clients that carry the old label; a client merely named so is left alone", async () => {
    await put("a", "Removed client", 5);
    await put("b", "Removed client", null);
    await put("c", "Somebody", 5);
    const m = env.TEST_MIGRATIONS.find((x) => x.name === "0036_anonymised_client_name.sql");
    expect(m).toBeDefined();
    // 0036 ran long before M7.4's `clients_anonymised_frozen` (0079), which now refuses any rename of an anonymised client: the historical migration is
    // replayed without it, and the trigger is put back exactly as 0079 creates it.
    const frozen = dataProtectionTriggerStatements().find((s) =>
      s.startsWith("CREATE TRIGGER `clients_anonymised_frozen`"),
    );
    expect(frozen).toBeDefined();
    await run("DROP TRIGGER `clients_anonymised_frozen`");
    try {
      for (const q of m?.queries ?? []) await run(q);
    } finally {
      await run(frozen as string);
    }
    const rows = await all<{ id: string; display_name: string; legal_name: string }>(
      "SELECT id, display_name, legal_name FROM clients WHERE id LIKE 'an-%' ORDER BY id",
    );
    expect(rows).toEqual([
      { id: "an-a", display_name: "Anonymised client", legal_name: "Anonymised client" },
      { id: "an-b", display_name: "Removed client", legal_name: "Removed client" },
      { id: "an-c", display_name: "Somebody", legal_name: "Somebody" },
    ]);
  });
});
