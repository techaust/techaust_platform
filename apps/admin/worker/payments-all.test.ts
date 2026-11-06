// M7.3 C8 (ADM-PAY-01; run file I "Payments", L16): `GET /payments` with no status and no client is "All payments", newest received first, through
// `payments_received (received_on, id)` from 0077; the cursor is the last row's (received_on, id), stable across ties; a rowid cursor of the old list is refused.
// Invented test data only.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { beforeAll, describe, expect, it } from "vitest";
import { encodeCursor } from "./keyset.ts";
import { paymentListSql } from "./payments.ts";
import { insert, mkClient } from "./test-clients.ts";
import { call, sessionFor, type TestSession } from "./test-helpers.ts";
import type { J } from "./test-invoices.ts";

let owner: TestSession;

beforeAll(async () => {
  owner = await sessionFor("owner");
  const client = await mkClient();
  // 56 entries over 10 days (ties on every day), in every status a list can show
  for (let i = 0; i < 56; i++) {
    const status = i % 7 === 0 ? "pending_verification" : i % 11 === 0 ? "rejected" : "confirmed";
    const confirmed = status === "confirmed";
    const id = uuidv7();
    // a manual entry starts pending (the Owner's decision rejects it) or confirmed by the Owner who recorded it
    await insert("payments", {
      id,
      client_id: client,
      kind: "payment",
      provider: "manual",
      status: confirmed ? "confirmed" : "pending_verification",
      currency: "INR",
      amount_minor: 1_000 + i,
      received_on: `2026-10-${String(1 + (i % 10)).padStart(2, "0")}`,
      mode: "neft",
      recorded_by: owner.id,
      recorded_at: 1_000 + i,
      verified_by: confirmed ? owner.id : null,
      verified_at: confirmed ? 2_000 : null,
    });
    if (status === "rejected")
      await env.DB.prepare(
        "UPDATE payments SET status = 'rejected', verified_by = ?2, verified_at = 2000, decision_note = 'Not ours' WHERE id = ?1",
      )
        .bind(id, owner.id)
        .run();
  }
});

describe("GET /payments, All payments (C8) [ADM-PAY-01]", () => {
  it("newest received first, ties by id, every status; the keyset pages are stable and complete", async () => {
    const p1 = (await (await call("/payments", { cookie: owner.cookie })).json()) as {
      payments: J[];
      next: string | null;
    };
    expect(p1.payments).toHaveLength(50);
    expect(p1.next).not.toBeNull();
    const p2 = (await (await call(`/payments?after=${p1.next}`, { cookie: owner.cookie })).json()) as {
      payments: J[];
      next: string | null;
    };
    expect(p2.next).toBeNull();
    const all = [...p1.payments, ...p2.payments];
    const db = (
      await env.DB.prepare("SELECT id, received_on FROM payments ORDER BY received_on DESC, id DESC").all<{
        id: string;
      }>()
    ).results.map((r) => r.id);
    expect(all.map((p) => p.id)).toEqual(db);
    expect(new Set(all.map((p) => p.status))).toEqual(
      new Set(["pending_verification", "rejected", "confirmed"]),
    );
  });

  it("a rowid cursor of the old list, or one that is not ours, is 400", async () => {
    for (const after of [encodeCursor({ k: 12, id: "x" }), "not-a-cursor"])
      expect((await call(`/payments?after=${after}`, { cookie: owner.cookie })).status, after).toBe(400);
  });

  it("the statement reads `payments_received` backwards, with no sort and no table scan (EXPLAIN)", async () => {
    for (const cursor of [false, true]) {
      const v = paymentListSql({ client: false, status: undefined, from: false, to: false, cursor });
      expect(v.key).toBe("received_on");
      const plan = (
        await env.DB.prepare(`EXPLAIN QUERY PLAN ${v.sql}`)
          .bind(...(cursor ? ["2026-10-05", "x"] : []))
          .all<{ detail: string }>()
      ).results
        .map((r) => r.detail)
        .join(" | ");
      expect(plan).toMatch(/payments_received/);
      // a walk of the index from its newest end stops at the 51st row (LIMIT); a table scan or a sort would read every payment
      expect(plan).not.toMatch(/TEMP B-TREE|SCAN p\b(?! USING (COVERING )?INDEX payments_received)/);
    }
  });
});
