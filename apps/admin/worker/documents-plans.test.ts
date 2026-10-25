// Every filter of the proposal and estimate routes reads through an index, and the cost of a save [NFR, docs/05 §10, free-plan budget].
// EXPLAIN QUERY PLAN has no table SCAN of documents, document_lines, approvals or clients for the lists, the queue, the search, the guard
// sums and the send batch. The rows-written figures are what a typical save costs on D1's Free plan (about 100,000 rows a day).
import { env } from "cloudflare:workers";
import { LOAD_DOCUMENT_SQL } from "@techaust/db/documents";
import { sendStatements } from "@techaust/db/issue";
import { beforeAll, describe, expect, it } from "vitest";
import { APPROVALS_SQL } from "./approvals.ts";
import { LIST_SQL } from "./documents.ts";
import { DOCUMENTS_SQL } from "./search.ts";
import { putPaymentTerms } from "./test-catalogue.ts";
import { call, sessionFor, withDb } from "./test-helpers.ts";
import { getDoc, type J, json, mkDraft, mkTerms } from "./test-quotes.ts";

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
});

/** The plan of a statement, with every numbered placeholder bound to NULL. */
async function plan(sql: string): Promise<string[]> {
  const top = Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...Array(top).fill(null))
    .all<{ detail: string }>();
  return results.map((r) => r.detail);
}
// A SCAN is fine only when it walks an index in the order the queue needs and stops at the LIMIT (no filter at all); a table scan is not.
const SCANS =
  /^SCAN (d|documents|n|l|a|approvals|cl|clients|document_lines|document_sections|payment_schedules)\b(?! USING (COVERING )?INDEX approvals_created)/;
const noScan = (name: string, p: string[]) =>
  expect(
    p.filter((d) => SCANS.test(d)),
    `${name}: ${p.join(" | ")}`,
  ).toEqual([]);

describe("EXPLAIN: no table scan on the lists, the queue, the search and the send batch", () => {
  it("the document list, for every combination of filters", async () => {
    for (const status of [false, true])
      for (const client of [false, true])
        for (const cursor of [false, true]) {
          const sql = `${LIST_SQL({ status, client, cursor })} 26`;
          const p = await plan(sql);
          noScan(`list status=${status} client=${client} cursor=${cursor}`, p);
          // The newer-version probe goes through documents_version.
          expect(p.join(" | ")).toMatch(/documents_version/);
          // Without a client filter the order itself comes from an index: no temp b-tree for the sort of the list (the latest approval
          // of each row, a few rows, is sorted in its own subquery after it).
          if (!client) {
            const main = p.slice(
              0,
              p.findIndex((d) => /CORRELATED SCALAR SUBQUERY 1/.test(d)),
            );
            expect(main.join(" | "), JSON.stringify({ status, cursor })).not.toMatch(
              /USE TEMP B-TREE FOR ORDER BY/,
            );
          }
        }
  });

  it("the approvals queue, for every combination of filters", async () => {
    for (const status of [false, true])
      for (const own of [false, true])
        for (const cursor of [false, true]) {
          const p = await plan(`${APPROVALS_SQL({ status, own, cursor })} 26`);
          noScan(`approvals status=${status} own=${own} cursor=${cursor}`, p);
        }
  });

  it("the search by number, the loader, and the guard sums read through indexes", async () => {
    noScan("search", await plan(DOCUMENTS_SQL));
    expect((await plan(DOCUMENTS_SQL)).join(" | ")).toMatch(/documents_number_display/);
    for (const [name, sql] of Object.entries(LOAD_DOCUMENT_SQL)) noScan(`load ${name}`, await plan(sql));
  });

  it("every statement of the send batch is found by id or by an index", async () => {
    const seen: string[] = [];
    const spy = {
      prepare: (q: string) => {
        seen.push(q);
        return env.DB.prepare(q);
      },
    } as unknown as D1Database;
    for (const isFirstVersion of [true, false]) {
      seen.length = 0;
      sendStatements(spy, {
        documentId: "d",
        series: "proposal",
        fy: "2627",
        pattern: "TH/PRP/%s/%04d",
        argOrder: ["fy", "n"],
        isFirstVersion,
        groupId: "g",
        version: isFirstVersion ? 1 : 2,
        now: 1,
        issueDate: "2026-10-25",
        validUntil: "2026-11-09",
        recipient: { legalName: "x", country: "IN" },
        issuer: {
          company: { tradeName: "t", legalName: null, address: null, gstin: null, stateCode: "19" },
          sender: { staffId: "s", name: "n", email: "e" },
        },
        computedJson: "{}",
        snapshotSha256: "s",
        issuedBy: "u",
        expected: { updatedAt: 1, contentSha256: "h", numberingVersion: null, approvalNeeded: true },
      });
      expect(seen.length).toBeGreaterThanOrEqual(isFirstVersion ? 5 : 3);
      for (const sql of seen.filter(
        (s) =>
          /^(UPDATE|INSERT|DELETE|SELECT)/.test(s) &&
          !/^INSERT INTO (issue_guard|issue_result)/.test(s) &&
          !/^INSERT INTO doc_counters/.test(s),
      ))
        noScan(`send(${isFirstVersion}) ${sql.slice(0, 40)}`, await plan(sql));
    }
  });

  it("the save statements, the delete and the approval request are found by id or by an index", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    const seen: string[] = [];
    const spy = {
      prepare: (q: string) => {
        seen.push(q);
        return env.DB.prepare(q);
      },
      batch: (stmts: D1PreparedStatement[]) => env.DB.batch(stmts),
    } as unknown as D1Database;
    const res = await call(
      `/documents/${made.id}`,
      {
        method: "PATCH",
        cookie: o.cookie,
        body: {
          expectedUpdatedAt: doc.updatedAt,
          fields: { title: "Plan" },
          lines: [{ description: "x", qtyMilli: 1000, unit: "fixed", rateMinor: 5 }],
        },
      },
      withDb(spy),
    );
    expect(res.status).toBe(200);
    const writes = seen.filter(
      (s) =>
        /^(UPDATE|DELETE)/.test(s) || /^INSERT INTO document_/.test(s) || /^INSERT INTO payment_/.test(s),
    );
    expect(writes.length).toBeGreaterThanOrEqual(5);
    for (const sql of writes) noScan(sql.slice(0, 50), await plan(sql));
    void json;
  });
});

describe("the cost of a typical save on D1's free plan (rows written; reported, with a loose ceiling)", () => {
  /** Runs a request with a DB that sums `meta.rows_written` over every batch (the route's writes ride in batches). */
  async function written(run: (e: Env) => Promise<Response>) {
    let rows = 0;
    let statements = 0;
    let calls = 0;
    const db = {
      prepare: (q: string) => env.DB.prepare(q),
      batch: async (stmts: D1PreparedStatement[]) => {
        const r = await env.DB.batch(stmts);
        calls++;
        statements += stmts.length;
        rows += r.reduce((a, x) => a + (x.meta.rows_written ?? 0), 0);
        return r;
      },
    } as unknown as D1Database;
    const res = await run(withDb(db));
    return { res, rows, statements, calls };
  }

  it("a title-only save, a one-line save and a 100-line save", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const made = await mkDraft(o);
    let doc = await getDoc(o, made.id);
    const report: string[] = [];
    const one = async (name: string, body: J) => {
      const r = await written((e) =>
        call(
          `/documents/${made.id}`,
          { method: "PATCH", cookie: o.cookie, body: { expectedUpdatedAt: doc.updatedAt, ...body } },
          e,
        ),
      );
      expect(r.res.status, name).toBe(200);
      doc = await json(r.res);
      report.push(`${name}: ${r.rows} rows written, ${r.statements} statements in ${r.calls} batch(es)`);
      return r.rows;
    };
    const title = await one("title only", { fields: { title: "Only the title" } });
    const lines1 = await one("one line", {
      lines: [{ description: "One", qtyMilli: 1000, unit: "fixed", rateMinor: 100 }],
    });
    const lines100 = await one("100 lines", {
      lines: Array.from({ length: 100 }, (_, i) => ({
        description: `Line ${i}`,
        qtyMilli: 1000,
        unit: "fixed",
        rateMinor: 100 + i,
      })),
    });
    // To read the figures, compare report.join(" | ") with "" and read the failure. On the local D1 (staging may count differently):
    // title only 12 rows, one line 20 rows, 100 lines 317 rows, in 17 to 21 statements and 4 calls.
    expect(report).toHaveLength(3);
    // A save that sends only the title does not rewrite the lines.
    expect(title).toBeLessThan(lines1 * 3);
    expect(lines100).toBeGreaterThan(lines1);
    expect(lines100).toBeLessThan(1_500);
  });
});
