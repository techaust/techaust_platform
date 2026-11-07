// M7.5 (A2 rows read, L19) and the M6–M7 audit (AU2, B0 2): `CREDIT_HELD_SQL` (RA-41, "Credit at period end") at 2,000 and then 5,000 confirmed payments: the
// rows one page reads, against the 9,000-row target the dashboard and reports hold to, and the same answer at both sizes. Its own file, so its database holds
// only these rows. All data is made up.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CREDIT_HELD_SCAN,
  CREDIT_HELD_SQL,
  CREDIT_HELD_SQL_UNBOUNDED,
  type CreditHeldScanRow,
  creditHeldPage,
  creditHeldSql,
} from "../src/refunds.ts";
import { mkClientRow, mkMember } from "./billing-helpers.ts";
import { all, run } from "./helpers.ts";

const LOOSE = 7; // payments on no invoice: credit that may be an advance
const T = 1_880_000_000_000;
/** The period's end (an instant after every row's time) and its last day. */
const AT = T + 1_000;
const DAY = "2029-12-31";
const ROWS_TARGET = 9_000;

let clientId = "";
let owner = "";
const loose: string[] = [];

/** `from`..`to` more issued invoices of 1,180.00, each paid in full by its own confirmed payment received over 30 days (no credit held by any). */
async function seed(from: number, to: number) {
  const seq = `WITH RECURSIVE n(i) AS (SELECT ${from} UNION ALL SELECT i + 1 FROM n WHERE i < ${to})`;
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
}

beforeAll(async () => {
  owner = await mkMember("owner");
  clientId = await mkClientRow();
  await seed(1, 2_000);
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

type Held = CreditHeldScanRow & { credit: number; net: number };

/** Every page of `sql` (the route's paging, `creditHeldPage` with `scan`), with the most rows D1 read for one page. */
async function every(sql: string, scan: number) {
  const ids: string[] = [];
  let most = 0;
  let pages = 0;
  for (let k = "", id = ""; pages < 200; ) {
    const r = await env.DB.prepare(sql).bind(AT, DAY, k, id, 100_000).all<Held>();
    pages++;
    most = Math.max(most, r.meta.rows_read);
    const p = creditHeldPage(r.results, scan);
    ids.push(...p.items.map((x) => x.id));
    if (!p.next) break;
    k = p.next.k;
    id = p.next.id;
  }
  return { ids, most, pages };
}

/** The unbounded read's pages (its own paging: a page of 50 and whether there is more). */
async function everyUnbounded() {
  const ids: string[] = [];
  for (let k = "", id = "", n = 0; n < 200; n++) {
    const r = (
      await env.DB.prepare(CREDIT_HELD_SQL_UNBOUNDED).bind(AT, DAY, k, id, 100_000).all<{ id: string; received_on: string }>()
    ).results;
    ids.push(...r.slice(0, 50).map((x) => x.id));
    const last = r[49];
    if (r.length <= 50 || !last) break;
    k = last.received_on;
    id = last.id;
  }
  return ids;
}

describe("CREDIT_HELD_SQL at 2,000 and 5,000 confirmed payments [L19, AU2, RA-41]", () => {
  it("at 2,000: finds exactly the money on no invoice, every page within the 9,000-row target, as the unbounded read", async () => {
    const r = await every(CREDIT_HELD_SQL, CREDIT_HELD_SCAN);
    console.log(`rows read, CREDIT_HELD_SQL at ${2_000 + LOOSE} confirmed payments: at most ${r.most} a page, ${r.pages} pages`);
    expect(r.ids.sort()).toEqual([...loose].sort());
    expect(r.most).toBeLessThanOrEqual(ROWS_TARGET);
    expect((await everyUnbounded()).sort()).toEqual(r.ids);
  });

  it("at 5,000: the same answer, every page still within the 9,000-row target (the unbounded read was over it)", async () => {
    await seed(2_001, 5_000);
    expect(
      (await all<{ n: number }>("SELECT count(*) AS n FROM payments WHERE client_id = ?1", clientId))[0]?.n,
    ).toBe(5_000 + LOOSE);
    const r = await every(CREDIT_HELD_SQL, CREDIT_HELD_SCAN);
    console.log(`rows read, CREDIT_HELD_SQL at ${5_000 + LOOSE} confirmed payments: at most ${r.most} a page, ${r.pages} pages`);
    expect(r.ids.sort()).toEqual([...loose].sort());
    expect(r.most).toBeLessThanOrEqual(ROWS_TARGET);
    expect((await everyUnbounded()).sort()).toEqual(r.ids);
  });

  it("the twin: a small window (50 payments, so most pages end empty) pages to exactly the unbounded answer", async () => {
    const small = await every(creditHeldSql(50), 50);
    expect(small.pages).toBeGreaterThan(100);
    expect(small.ids.sort()).toEqual((await everyUnbounded()).sort());
  });
});
