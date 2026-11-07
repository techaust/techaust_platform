// M7.5 (A2 rows read, L19): `CREDIT_HELD_SQL` (RA-41, "Credit at period end") at 1,000 confirmed payments: the rows one page reads, against the 9,000-row
// target the dashboard and reports hold to. Its own file, so its database holds only these rows. All data is made up.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { beforeAll, describe, expect, it } from "vitest";
import { CREDIT_HELD_SQL } from "../src/refunds.ts";
import { mkClientRow, mkMember } from "./billing-helpers.ts";
import { all, run } from "./helpers.ts";

const N = 1_000;
const LOOSE = 7; // payments on no invoice: credit that may be an advance
const T = 1_880_000_000_000;
/** The period's end (an instant after every row's time) and its last day. */
const AT = T + 1_000;
const DAY = "2029-12-31";
const ROWS_TARGET = 9_000;

let clientId = "";
const loose: string[] = [];

beforeAll(async () => {
  const owner = await mkMember("owner");
  clientId = await mkClientRow();
  // 1,000 issued invoices of 1,180.00, and 1,000 confirmed payments of 1,180.00, each put on its own invoice in full: no credit is held by any of them.
  // Generated in three statements (a recursive count), received over 30 days.
  const seq = `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${N})`;
  await run(
    `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor,
       total_minor, paid_minor, balance_minor, content_sha256, updated_at)
     ${seq} SELECT 'rr-doc-' || i, 'tax_invoice', 'paid', ?1, 'INR', 'rr-a', '9999', i, 'RR/' || i, 1000, '2026-10-01', '2026-10-08', 100000, 100000,
       118000, 118000, 0, ?2, 7000 FROM n`,
    clientId,
    "h".repeat(64),
  );
  await run(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at, verified_by, verified_at)
     ${seq} SELECT 'rr-pay-' || printf('%05d', i), ?1, 'payment', 'manual', 'confirmed', 'INR', 118000, date('2026-10-01', '+' || (i % 30) || ' days'),
       'neft', ?2, ?3, ?2, ?3 FROM n`,
    clientId,
    owner,
    T,
  );
  await run(
    `INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_at)
     ${seq} SELECT 'rr-alloc-' || i, 'rr-pay-' || printf('%05d', i), 'rr-doc-' || i, 118000, 'allocate', ?1 FROM n`,
    T,
  );
  for (let i = 0; i < LOOSE; i++) {
    const id = `rr-loose-${uuidv7()}`;
    loose.push(id);
    await run(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at, verified_by, verified_at)
       VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'INR', 50000, '2026-10-15', 'neft', ?3, ?4, ?3, ?4)`,
      id,
      clientId,
      owner,
      T,
    );
  }
});

/** One page of the read, with the rows D1 says it read. */
async function page(after: [string, string]) {
  const r = await env.DB.prepare(CREDIT_HELD_SQL)
    .bind(AT, DAY, after[0], after[1], 100_000)
    .all<{ id: string; received_on: string }>();
  return { rows: r.results, rowsRead: r.meta.rows_read };
}

describe("CREDIT_HELD_SQL at 1,000 confirmed payments [L19, RA-41]", () => {
  it("finds exactly the money on no invoice, and one page reads within the 9,000-row target", async () => {
    const first = await page(["", ""]);
    console.log(
      `rows read, CREDIT_HELD_SQL first page at ${N + LOOSE} confirmed payments: ${first.rowsRead}`,
    );
    expect(first.rows.map((r) => r.id).sort()).toEqual([...loose].sort());
    expect(first.rowsRead).toBeLessThanOrEqual(ROWS_TARGET);
  });

  it("a later page (the keyset past the first loose payment) reads within the target too and loses nothing", async () => {
    const all1 = await page(["", ""]);
    const k = all1.rows[0] as { id: string; received_on: string };
    const next = await page([k.received_on, k.id]);
    console.log(`rows read, CREDIT_HELD_SQL a later page: ${next.rowsRead}`);
    expect(next.rows.map((r) => r.id)).toEqual(all1.rows.slice(1).map((r) => r.id));
    expect(next.rowsRead).toBeLessThanOrEqual(ROWS_TARGET);
  });

  it("the row counts are what they say", async () => {
    expect(
      (await all<{ n: number }>("SELECT count(*) AS n FROM payments WHERE client_id = ?1", clientId))[0]?.n,
    ).toBe(N + LOOSE);
    expect(
      (
        await all<{ n: number }>(
          "SELECT count(*) AS n FROM payment_allocations WHERE payment_id LIKE 'rr-pay-%'",
        )
      )[0]?.n,
    ).toBe(N);
  });
});
