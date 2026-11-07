// M7.1's SQL twins of `@techaust/core/portal` [run file B, I "Notices", "Doc tokens", "db"; L8, L10, L12] and the read paths of the new indexes: every reason of
// `noticeRefusalSql` equals core `noticeAllowed`'s, `paidNoticeVerdictSql` equals `paidNoticeVerdict`, `viewPayLiveSql` equals `viewPayLive` (29 days served, 31
// days not, a refund reopens), `REQUESTS_TODAY_SQL` counts the IST day as core does, and the portal-shared statements stay inside the client and use the M7.1
// indexes with no temporary sort (EXPLAIN). All names, ids and amounts are invented test data.
import { env } from "cloudflare:workers";
import { fromIst, istDate, uuidv7 } from "@techaust/core";
import {
  NOTICE_OPEN_STATUSES,
  NOTICE_PROFORMA_STATUSES,
  NOTICE_TYPES,
  noticeAllowed,
  paidNoticeVerdict,
  VIEW_PAY_GRACE_MS,
  viewPayLive,
} from "@techaust/core/portal";
import { describe, expect, it } from "vitest";
import {
  SHARED_FILE_SQL,
  sharedFileFor,
  sharedFilesFor,
  sharedFilesForProject,
  sharedNotesFor,
  sharedNotesForProject,
} from "../src/portal-shared.ts";
import {
  istDayStartSql,
  NOTICE_OPEN_STATUSES_SQL,
  NOTICE_PROFORMA_STATUSES_SQL,
  NOTICE_TYPES_SQL,
  noticeRefusalSql,
  paidNoticeVerdictSql,
  REQUESTS_TODAY_SQL,
  settledAtSql,
  VIEW_PAY_GRACE_MS_SQL,
  viewPayLiveSql,
  withdrawnSql,
} from "../src/sql-rules.ts";
import { mkClientRow, mkContact, mkIssued, mkMember, mkSend } from "./billing-helpers.ts";
import { all, first, REQUEST_CLOCK_COLS, requestClockOf, run } from "./helpers.ts";

const DAY = 86_400_000;
const plan = async (sql: string, ...p: unknown[]) =>
  (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...p)).map((r) => r.detail).join(" | ");

describe("the pinned lists", () => {
  it("NOTICE_TYPES_SQL, NOTICE_OPEN_STATUSES_SQL and the 30 days equal core's", () => {
    const q = (xs: readonly string[]) => `(${xs.map((x) => `'${x}'`).join(", ")})`;
    expect(NOTICE_TYPES_SQL).toBe(q(NOTICE_TYPES));
    expect(NOTICE_OPEN_STATUSES_SQL).toBe(q(NOTICE_OPEN_STATUSES));
    expect(NOTICE_PROFORMA_STATUSES_SQL).toBe(q(NOTICE_PROFORMA_STATUSES));
    expect(VIEW_PAY_GRACE_MS_SQL).toBe(VIEW_PAY_GRACE_MS);
  });
});

describe("noticeRefusalSql is core noticeAllowed [L10]", () => {
  it("for every type, status, balance and delivery of a document", async () => {
    // The document as a derived row (the columns the two helpers read), so a void, viewed proforma needs no trip through the void and view triggers; a
    // delivery by a send row is shown on a real document below.
    const types = ["tax_invoice", "export_invoice", "debit_note", "proforma", "credit_note", "proposal"];
    const statuses = [
      "issued",
      "partially_paid",
      "partially_credited",
      "paid",
      "credited",
      "converted",
      "void",
      "draft",
    ];
    let checked = 0;
    for (const type of types)
      for (const status of statuses)
        for (const balance of [0, 500])
          for (const delivered of [false, true]) {
            const row = await first<{ reason: string | null; withdrawn: number }>(
              `SELECT ${noticeRefusalSql("d")} AS reason, ${withdrawnSql("d")} AS withdrawn
               FROM (SELECT 'no-such-id' AS id, ?1 AS type, ?2 AS status, ?3 AS balance_minor, ?4 AS viewed_at) d`,
              type,
              status,
              balance,
              delivered ? 1 : null,
            );
            const core = noticeAllowed({
              type,
              status,
              balanceMinor: balance,
              withdrawn: row?.withdrawn === 1,
            });
            expect(row?.reason ?? null, `${type} ${status} ${balance} ${delivered}`).toBe(
              core.ok ? null : core.reason,
            );
            checked++;
          }
    expect(checked).toBe(types.length * statuses.length * 4);
  });

  it("on real rows: an open invoice takes one; an emailed (send row) issued proforma takes one; a paid one does not", async () => {
    const client = await mkClientRow();
    const contact = await mkContact(client);
    const owner = await mkMember("owner");
    const reason = async (id: string) =>
      (
        await first<{ r: string | null }>(
          `SELECT ${noticeRefusalSql("d")} AS r FROM documents d WHERE d.id = ?1`,
          id,
        )
      )?.r ?? null;
    expect(await reason(await mkIssued(client))).toBeNull();
    const proforma = await mkIssued(client, { type: "proforma" });
    await mkSend(proforma, client, contact, { createdBy: owner });
    expect(await reason(proforma)).toBeNull();
    expect(await reason(await mkIssued(client, { status: "paid", balance: 0 }))).toBe("paid");
    // Early check 1 finding 1: a proforma stays `converted` with a balance after its first advance invoice, and still takes a notice; with nothing left it
    // doesn't.
    expect(
      await reason(await mkIssued(client, { type: "proforma", status: "converted", balance: 50_000 })),
    ).toBeNull();
    expect(await reason(await mkIssued(client, { type: "proforma", status: "converted", balance: 0 }))).toBe(
      "no_balance",
    );
  });
});

describe("paidNoticeVerdictSql is core paidNoticeVerdict [C15]", () => {
  it("on every combination of amounts around the balance and days around the issue day and today", async () => {
    const days = ["2026-10-31", "2026-11-01", "2026-11-02"];
    const samples = [];
    for (const amountMinor of [1, 99, 100, 101])
      for (const paidOn of days)
        for (const issueDate of days)
          for (const todayIst of days)
            samples.push({ amountMinor, balanceMinor: 100, paidOn, issueDate, todayIst });
    expect(samples).toHaveLength(108);
    for (const v of samples) {
      const row = await first<{ v: string }>(
        `SELECT ${paidNoticeVerdictSql("?1", "?2", "?3", "?4", "?5")} AS v`,
        v.amountMinor,
        v.balanceMinor,
        v.paidOn,
        v.issueDate,
        v.todayIst,
      );
      expect(row?.v, JSON.stringify(v)).toBe(paidNoticeVerdict(v));
    }
    // A missing issue day refuses (fails closed).
    expect(
      (
        await first<{ v: string }>(
          `SELECT ${paidNoticeVerdictSql("1", "5", "'2026-11-01'", "NULL", "'2026-11-02'")} AS v`,
        )
      )?.v,
    ).toBe("date_before_issue");
    // Early check 1 finding 7: a NULL amount or day paid fails closed, as core does with a broken number or day.
    type Args = [string, string, string, string, string];
    const nullCases: [Args, { amountMinor: number; paidOn: string }][] = [
      [
        ["NULL", "5", "'2026-11-01'", "'2026-10-01'", "'2026-11-02'"],
        { amountMinor: Number.NaN, paidOn: "2026-11-01" },
      ],
      [
        ["1", "5", "NULL", "'2026-10-01'", "'2026-11-02'"],
        { amountMinor: 1, paidOn: null as unknown as string },
      ],
    ];
    for (const [args, c] of nullCases) {
      const row = await first<{ v: string }>(`SELECT ${paidNoticeVerdictSql(...args)} AS v`);
      expect(row?.v).toBe(
        paidNoticeVerdict({ ...c, balanceMinor: 5, issueDate: "2026-10-01", todayIst: "2026-11-02" }),
      );
    }
    const want = ["amount_above_balance", "date_in_future"];
    for (const [i, [args]] of nullCases.entries())
      expect((await first<{ v: string }>(`SELECT ${paidNoticeVerdictSql(...args)} AS v`))?.v).toBe(want[i]);
  });
});

describe("viewPayLiveSql is core viewPayLive [L12]", () => {
  /** An issued invoice with a confirmed payment of `amount` allocated at `at` (the allocation's `created_at` is the settlement time). */
  async function allocated(at: number, amount: number) {
    const client = await mkClientRow();
    const owner = await mkMember("owner");
    const doc = await mkIssued(client, { status: "issued", balance: 118_000 });
    const pay = uuidv7();
    await run(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at, verified_by, verified_at)
       VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'INR', ?3, '2026-10-28', 'neft', ?4, 1000, ?4, 1000)`,
      pay,
      client,
      amount,
      owner,
    );
    await run(
      "INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_by, created_at) VALUES (?1, ?2, ?3, ?4, 'allocate', ?5, ?6)",
      uuidv7(),
      pay,
      doc,
      amount,
      owner,
      at,
    );
    return doc;
  }
  const live = async (doc: string, now: number) =>
    (await first<{ live: number; settled: number; status: string }>(
      `SELECT ${viewPayLiveSql("d", "?2")} AS live, ${settledAtSql("d")} AS settled, d.status FROM documents d WHERE d.id = ?1`,
      doc,
      now,
    )) ?? { live: -1, settled: -1, status: "" };

  it("a document still owed is always live", async () => {
    const client = await mkClientRow();
    const doc = await mkIssued(client, { status: "partially_paid", balance: 10 });
    const r = await live(doc, 10 ** 13);
    expect(r.live).toBe(1);
    expect(viewPayLive(null, 10 ** 13)).toBe(true);
  });

  it("29 days after the last allocation served, 31 days not, the same as core; a credit note's freeze counts too", async () => {
    const client = await mkClientRow();
    const doc = await mkIssued(client, { status: "credited", balance: 0 });
    const t = 1_870_000_000_000;
    await mkIssued(client, { type: "credit_note", parentId: doc, frozenAt: t });
    for (const [now, want] of [
      [t + 29 * DAY, 1],
      [t + 30 * DAY - 1, 1],
      [t + 30 * DAY, 0],
      [t + 31 * DAY, 0],
    ] as const) {
      const r = await live(doc, now);
      expect(r.settled).toBe(t);
      expect(r.live).toBe(want);
      expect(viewPayLive(r.settled, now)).toBe(want === 1);
    }
  });

  it("a paid document: the allocation is the settlement time, 29 days served, 31 not, as core", async () => {
    const t = 1_870_000_000_000;
    const doc = await allocated(t, 118_000);
    await run(
      "UPDATE documents SET status = 'paid', paid_minor = 118000, balance_minor = 0 WHERE id = ?1",
      doc,
    );
    for (const [now, want] of [
      [t + 29 * DAY, 1],
      [t + 31 * DAY, 0],
    ] as const) {
      const r = await live(doc, now);
      expect(r).toEqual({ live: want, settled: t, status: "paid" });
      expect(viewPayLive(r.settled, now)).toBe(want === 1);
    }
  });

  it("a refunded document reopens: once the status leaves paid (M6.5 L1 releases the allocation), an old allocation no longer ends the link", async () => {
    const t = 1_870_000_000_000;
    const doc = await allocated(t, 50_000);
    await run(
      "UPDATE documents SET status = 'partially_paid', paid_minor = 50000, balance_minor = 68000 WHERE id = ?1",
      doc,
    );
    const r = await live(doc, t + 365 * DAY);
    expect(r).toEqual({ live: 1, settled: t, status: "partially_paid" });
    expect(viewPayLive(null, t + 365 * DAY)).toBe(true);
  });

  it("a proforma settled through its tax invoices (finding 2): converted with nothing left ends 30 days after the last child invoice; part-paid stays live", async () => {
    const client = await mkClientRow();
    const t = 1_870_000_000_000;
    const settled = await mkIssued(client, { type: "proforma", status: "converted", balance: 0 });
    await mkIssued(client, { type: "tax_invoice", parentId: settled, frozenAt: t - 5 * DAY });
    await mkIssued(client, { type: "tax_invoice", parentId: settled, frozenAt: t });
    for (const [now, want] of [
      [t + 29 * DAY, 1],
      [t + 30 * DAY - 1, 1],
      [t + 30 * DAY, 0],
      [t + 31 * DAY, 0],
    ] as const) {
      const r = await live(settled, now);
      expect(r.settled).toBe(t);
      expect(r.live).toBe(want);
      expect(viewPayLive(r.settled, now)).toBe(want === 1);
    }
    const partPaid = await mkIssued(client, { type: "proforma", status: "converted", balance: 10_000 });
    await mkIssued(client, { type: "tax_invoice", parentId: partPaid, frozenAt: t });
    const r = await live(partPaid, t + 365 * DAY);
    expect(r.live).toBe(1);
    expect(viewPayLive(null, t + 365 * DAY)).toBe(true);
  });

  it("B2: a settled document with no allocation, credit note or child invoice is settled at its own freeze (30 days from issue, never at once)", async () => {
    const client = await mkClientRow();
    const t = 1_870_000_000_000;
    const doc = await mkIssued(client, { status: "paid", balance: 0, frozenAt: t });
    for (const [now, want] of [
      [t + 29 * DAY, 1],
      [t + 31 * DAY, 0],
    ] as const) {
      const r = await live(doc, now);
      expect(r.settled).toBe(t);
      expect(r.live).toBe(want);
      expect(viewPayLive(r.settled, now)).toBe(want === 1);
    }
  });

  it("reads the allocation and credit-note indexes it names", async () => {
    const p = await plan(`SELECT ${viewPayLiveSql("d", "?2")} FROM documents d WHERE d.id = ?1`, "x", 1);
    expect(p).toMatch(/payment_allocations_document/);
    expect(p).toMatch(/documents_parent/);
  });
});

describe("REQUESTS_TODAY_SQL counts the IST day [L8]", () => {
  it("istDayStartSql is core fromIst(istDate(now))", async () => {
    // Around IST midnight (18:30 UTC) and at spread-out moments.
    const midnight = fromIst({ year: 2026, month: 11, day: 4 });
    const moments = [midnight - 1, midnight, midnight + 1, midnight + DAY - 1, midnight + DAY];
    for (let i = 0; i < 60; i++) moments.push(1_700_000_000_000 + i * 4_166_666_667);
    for (const now of moments) {
      const row = await first<{ s: number }>(`SELECT ${istDayStartSql("?1")} AS s`, now);
      expect(row?.s).toBe(fromIst(istDate(now)));
    }
  });

  it("counts only this contact's requests since 00:00 IST, on client_requests_contact", async () => {
    const client = await mkClientRow();
    const contact = await mkContact(client);
    const other = await mkContact(client);
    const dayStart = fromIst({ year: 2026, month: 11, day: 4 });
    const kinds = ["contact_change", "data_access", "data_correction", "data_erasure", "grievance"];
    const at = [dayStart - 1, dayStart, dayStart + 1000, dayStart + DAY - 1, dayStart + 5];
    for (const [i, kind] of kinds.entries())
      await run(
        `INSERT INTO client_requests (id, client_id, contact_id, contact_ref, kind, details, created_at, updated_at, ${REQUEST_CLOCK_COLS}) VALUES (?1, ?2, ?3, ?3, ?4, 'x', ?5, ?5, ${requestClockOf("?5")})`,
        uuidv7(),
        client,
        i === 4 ? other : contact,
        kind,
        at[i],
      );
    const count = async (now: number) =>
      (await first<{ n: number }>(`SELECT ${REQUESTS_TODAY_SQL("?1", "?2")} AS n`, contact, now))?.n;
    expect(await count(dayStart + 2 * 3_600_000)).toBe(3); // 00:00, 00:00:01 and 23:59:59.999 of the 4th; not the 3rd's last millisecond, not the other contact
    expect(await count(dayStart - 1)).toBe(4); // still the 3rd: every row from its 00:00
    expect(await plan(`SELECT ${REQUESTS_TODAY_SQL("?1", "?2")}`, contact, dayStart)).toMatch(
      /client_requests_contact/,
    );
  });
});

describe("portal-shared [POR-04, POR-08]: inside the client, on the M7.1 indexes", () => {
  async function fixtures() {
    const a = await mkClientRow();
    const b = await mkClientRow();
    const pa = uuidv7();
    const pb = uuidv7();
    for (const [id, client] of [
      [pa, a],
      [pb, b],
    ] as const)
      await run(
        "INSERT INTO projects (id, code, client_id, name, currency) VALUES (?1, ?2, ?3, 'Site', 'INR')",
        id,
        `P-${id.slice(-8)}`,
        client,
      );
    const note = async (client: string, project: string | null, visibility: string, at: number) => {
      const id = uuidv7();
      await run(
        "INSERT INTO notes (id, client_id, project_id, visibility, body_md, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'body', ?5, ?5)",
        id,
        client,
        project,
        visibility,
        at,
      );
      return id;
    };
    const file = async (client: string, project: string | null, shared: number, at: number) => {
      const id = uuidv7();
      await run(
        "INSERT INTO files (id, client_id, project_id, r2_key, filename, mime, size, sha256, shared, created_at) VALUES (?1, ?2, ?3, ?4, 'a.pdf', 'application/pdf', 10, ?5, ?6, ?7)",
        id,
        client,
        project,
        `k/${id}`,
        "a".repeat(64),
        shared,
        at,
      );
      return id;
    };
    return { a, b, pa, pb, note, file };
  }

  it("project pages give only the client's shared items in its own project, newest first, by keyset", async () => {
    const { a, b, pa, pb, note, file } = await fixtures();
    const n1 = await note(a, pa, "shared", 100);
    const n2 = await note(a, pa, "shared", 200);
    const n3 = await note(a, pa, "shared", 200);
    await note(a, pa, "internal", 300);
    await note(a, null, "shared", 400);
    await note(b, pb, "shared", 500);
    const ids = async (stmt: D1PreparedStatement) =>
      (await stmt.all<{ id: string }>()).results.map((r) => r.id);
    const newestTwo = [n2, n3].sort().reverse();
    expect(await ids(sharedNotesForProject(env.DB, a, pa, 2))).toEqual(newestTwo);
    expect(
      await ids(sharedNotesForProject(env.DB, a, pa, 2, { createdAt: 200, id: newestTwo[1] as string })),
    ).toEqual([n1]);
    // Another client's project, and a's project read as b: nothing.
    expect(await ids(sharedNotesForProject(env.DB, a, pb))).toEqual([]);
    expect(await ids(sharedNotesForProject(env.DB, b, pa))).toEqual([]);
    const f1 = await file(a, pa, 1, 100);
    await file(a, pa, 0, 200);
    await file(b, pb, 1, 300);
    expect(await ids(sharedFilesForProject(env.DB, a, pa))).toEqual([f1]);
    expect(await ids(sharedFilesForProject(env.DB, b, pa))).toEqual([]);
    const row = (await sharedFilesForProject(env.DB, a, pa).first()) as Record<string, unknown>;
    expect(Object.keys(row)).not.toContain("r2_key");
  });

  it("sharedFileFor binds the client as ?1 (the forClient shape)", async () => {
    const { a, b, pa, file } = await fixtures();
    const f = await file(a, pa, 1, 100);
    const hidden = await file(a, pa, 0, 100);
    expect(SHARED_FILE_SQL).toMatch(/\bclient_id = \?1\b/);
    expect((await sharedFileFor(env.DB, a, f).first<{ r2_key: string }>())?.r2_key).toBe(`k/${f}`);
    expect(await sharedFileFor(env.DB, b, f).first()).toBeNull();
    expect(await sharedFileFor(env.DB, a, hidden).first()).toBeNull();
  });

  it("every list uses its M7.1 index with no temporary sort, where the older index needs one", async () => {
    const statements = [
      sharedNotesFor(env.DB, "c", 25, { createdAt: 1, id: "x" }),
      sharedFilesFor(env.DB, "c", 25, { createdAt: 1, id: "x" }),
      sharedNotesForProject(env.DB, "c", "p", 25, { createdAt: 1, id: "x" }),
      sharedFilesForProject(env.DB, "c", "p", 25, { createdAt: 1, id: "x" }),
    ];
    const wanted = [
      "notes_shared_client",
      "files_shared_client",
      "notes_shared_project",
      "files_shared_project",
    ];
    for (const [i, s] of statements.entries()) {
      // A D1PreparedStatement keeps its text and values; EXPLAIN the same SQL.
      const { statement, params } = s as unknown as { statement: string; params: unknown[] };
      const p = await plan(statement, ...params);
      expect(p, p).toMatch(new RegExp(wanted[i] as string));
      expect(p, p).not.toMatch(/TEMP B-TREE/);
    }
    const old = await plan(
      "SELECT id FROM notes INDEXED BY notes_client_visibility WHERE client_id = ?1 AND visibility = 'shared' AND (created_at, id) < (?2, ?3) ORDER BY created_at DESC, id DESC LIMIT 25",
      "c",
      1,
      "x",
    );
    expect(old).toMatch(/TEMP B-TREE/);
  });

  it("the admin and portal lists of the new tables read their indexes", async () => {
    expect(
      await plan("SELECT id FROM client_requests WHERE status = 'open' ORDER BY created_at, id LIMIT 50"),
    ).toMatch(/client_requests_status/);
    expect(
      await plan(
        "SELECT id FROM client_requests WHERE client_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 50",
        "c",
      ),
    ).toMatch(/client_requests_client/);
    expect(
      await plan(
        "SELECT 1 FROM client_requests WHERE contact_id = ?1 AND kind = ?2 AND status = 'open'",
        "c",
        "grievance",
      ),
    ).toMatch(/client_requests_open_kind|client_requests_contact/);
    expect(
      await plan("SELECT count(*) FROM payment_notices WHERE document_id = ?1 AND status = 'open'", "d"),
    ).toMatch(/payment_notices_document|payment_notices_open_reference/);
    expect(
      await plan("SELECT id FROM payment_notices WHERE status = 'open' ORDER BY created_at, id LIMIT 50"),
    ).toMatch(/payment_notices_status/);
    // Early check 1 finding 6: the client and contact keysets end in the id, so the order by (created_at, id) needs no temporary sort.
    for (const [sql, index] of [
      [
        "SELECT id FROM payment_notices WHERE client_id = ?1 AND (created_at, id) < (?2, ?3) ORDER BY created_at DESC, id DESC LIMIT 50",
        /payment_notices_client/,
      ],
      [
        "SELECT id FROM client_requests WHERE contact_id = ?1 AND (created_at, id) < (?2, ?3) ORDER BY created_at DESC, id DESC LIMIT 50",
        /client_requests_contact/,
      ],
      // B2: a client's projects and its receipts and credit notes (the portal lists), on the two indexes 0071 adds for them.
      [
        "SELECT id FROM projects WHERE client_id = ?1 AND (created_at, id) < (?2, ?3) ORDER BY created_at DESC, id DESC LIMIT 50",
        /projects_client_created/,
      ],
      [
        "SELECT id FROM documents WHERE client_id = ?1 AND frozen_at IS NOT NULL AND type IN ('receipt', 'credit_note') AND (issue_date, id) < (?2, ?3) ORDER BY issue_date DESC, id DESC LIMIT 50",
        /documents_client_receipts/,
      ],
    ] as const) {
      const p = await plan(sql, "c", 1, "x");
      expect(p, p).toMatch(index);
      expect(p, p).not.toMatch(/TEMP B-TREE/);
    }
    expect(await plan("UPDATE client_requests SET lead_id = NULL WHERE lead_id = ?1", "l")).toMatch(
      /client_requests_lead/,
    );
    expect(
      await plan("UPDATE payment_notices SET note = NULL WHERE contact_id = ?1 AND note IS NOT NULL", "c"),
    ).toMatch(/payment_notices_contact/);
  });
});
