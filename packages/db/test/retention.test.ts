// M7.4 retention in the database [ADM-SET-09, NFR-9, JOB-CRON-01, JOB-BKP-01; run file docs/runs/m7.4-data-protection.md A.6, B.5–B.7, I "db, per matrix table"]:
// every table is in the matrix and in the backup scope; for every family the dry-run count equals the set a live run removes (the same predicate, L5), held
// rows stay, every financial table is untouched, and a second live run removes nothing. Raw SQL; invented test data; times relative to now.
import { uuidv7 } from "@techaust/core";
import { cutoffsOf, RETENTION_FAMILIES, type RetentionFamily } from "@techaust/core/retention";
import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { AUDIT_EXPORT_COLUMNS, BACKUP_SCOPE, monthlyExportSql } from "../src/backup-scope.ts";
import { DRAIN_PAGE_SQL, ORPHAN_FILES_SQL, SIGNATURES_IN_USE_SQL } from "../src/r2-sweep.ts";
import {
  bindsOf,
  dryRunSql,
  FAMILY_TABLES,
  highestPlaceholder,
  livePageSql,
  RETENTION_MATRIX,
  retentionStatements,
  uuidv7Floor,
} from "../src/retention.ts";
import * as schema from "../src/schema/index.ts";
import { mkClientRow, mkContact, mkIssued, mkMember } from "./billing-helpers.ts";
import { all, db, first, REQUEST_CLOCK_COLS, requestClockOf, run } from "./helpers.ts";

const DAY = 86_400_000;
const ago = (days: number) => Date.now() - days * DAY;
const figures = { emailLogMonths: 13, securityLogMonths: 13, requestsMonths: 36, consentProofMonths: 36 };

const tables = (Object.values(schema) as unknown[])
  .filter((v): v is SQLiteTable => is(v, SQLiteTable))
  .map((t) => getTableConfig(t).name)
  .sort();

describe("the matrix and the backup scope cover every table (A.6, B.6)", () => {
  it("RETENTION_MATRIX names every table of the schema, and only those", () => {
    expect(Object.keys(RETENTION_MATRIX).sort()).toEqual(tables);
  });
  it("BACKUP_SCOPE names every table; the monthly copy never holds leads, contacts or other personal tables", () => {
    expect(Object.keys(BACKUP_SCOPE).sort()).toEqual(tables);
    for (const t of [
      "leads",
      "contacts",
      "clients",
      "consent_receipts",
      "email_log",
      "access_log",
      "client_requests",
    ])
      expect(BACKUP_SCOPE[t], t).toBe("rolling_only");
  });
  it("L35: the audit export has no IP or browser and removes the alert keys; documents only the invoice family", () => {
    expect(AUDIT_EXPORT_COLUMNS).not.toContain("ip");
    expect(AUDIT_EXPORT_COLUMNS).not.toContain("user_agent");
    const sql = monthlyExportSql("audit_log");
    expect(sql).not.toMatch(/\bip\b|user_agent|SELECT \*/);
    expect(sql).toContain("json_remove(summary, '$.ua', '$.city', '$.country')");
    expect(monthlyExportSql("documents")).toContain("type IN ('proforma', 'tax_invoice'");
    expect(monthlyExportSql("documents")).not.toContain("'proposal'");
    expect(() => monthlyExportSql("leads")).toThrow(RangeError);
  });
  it("every monthly export statement runs", async () => {
    for (const [t, scope] of Object.entries(BACKUP_SCOPE))
      if (scope === "finance_monthly") await db().prepare(monthlyExportSql(t)).all();
  });
  it("every family's tables are in the matrix under that family", () => {
    for (const family of RETENTION_FAMILIES)
      for (const t of FAMILY_TABLES[family]) {
        const row = RETENTION_MATRIX[t.table];
        expect(row?.kind === "family" && row.family === family, `${family}: ${t.table}`).toBe(true);
      }
  });
});

describe("uuidv7Floor and the bindings", () => {
  it("sorts before every id made at or after the time, after every id made before", () => {
    for (const ms of [1, Date.UTC(2026, 0, 1), Date.UTC(2040, 5, 1, 12)]) {
      const f = uuidv7Floor(ms);
      expect(uuidv7(ms) > f).toBe(true);
      expect(uuidv7(ms - 1) < f).toBe(true);
    }
    expect(() => uuidv7Floor(-1)).toThrow(RangeError);
  });
  it("binds each statement only up to the highest placeholder it names", () => {
    expect(highestPlaceholder("SELECT ?1, ?12")).toBe(12);
    expect(highestPlaceholder("SELECT 1")).toBe(0);
    for (const f of RETENTION_FAMILIES) {
      expect(highestPlaceholder(dryRunSql(f))).toBe(4);
      for (const s of livePageSql(f).slice(1)) expect(highestPlaceholder(s)).toBeLessThanOrEqual(2);
    }
    const c = cutoffsOf(figures, Date.UTC(2027, 5, 15));
    expect(bindsOf("stats", c.stats, 0)[0]).toBe("2025-06-15");
    expect(bindsOf("bells", c.bells, 0)).toEqual([c.bells.before, c.bells.readBefore]);
  });
});

/** Seeds, for every family, rows that are due, young and held, and returns the ids per table that should go. */
async function seed() {
  const owner = await mkMember("owner");
  const free = await mkClientRow();
  const heldClient = await mkClientRow();
  const live = await mkContact(free, { email: "live@example.test" });
  const held = await mkContact(heldClient, { email: "held@example.test" });
  await run(
    "INSERT INTO legal_holds (id, entity_type, entity_id, action, reason, by) VALUES (?1, 'client', ?2, 'set', 'GST notice', ?3)",
    uuidv7(),
    heldClient,
    owner,
  );
  const old = ago(800);
  const young = ago(30);
  // email_log: old to a free address (due), old to a held address (held), young
  for (const [to, at] of [
    ["live@example.test", old],
    ["held@example.test", old],
    ["live@example.test", young],
  ] as const)
    await run(
      "INSERT INTO email_log (id, to_email, template, created_at, updated_at) VALUES (?1, ?2, 'lead.ack', ?3, ?3)",
      uuidv7(),
      to,
      at,
    );
  for (const at of [old, young])
    await run(
      "INSERT INTO email_events (id, ses_message_id, type, outcome, received_at) VALUES (?1, 'm', 'delivery', 'applied', ?2)",
      uuidv7(),
      at,
    );
  // access_log: old portal rows of the free and the held contact, a young one
  for (const [actor, at] of [
    [live, old],
    [held, old],
    [live, young],
  ] as const)
    await run(
      "INSERT INTO access_log (id, at, realm, actor_id, method, route, status) VALUES (?1, ?2, 'portal', ?3, 'GET', '/x', 200)",
      uuidv7(at),
      at,
      actor,
    );
  // audit rows with IP: old (free), old of the held client, young
  for (const [entity, at] of [
    [free, old],
    [heldClient, old],
    [free, young],
  ] as const)
    await run(
      "INSERT INTO audit_log (id, at, actor_type, action, entity_type, entity_id, ip, user_agent) VALUES (?1, ?2, 'system', 'client.update', 'client', ?3, '203.0.113.9', 'Firefox')",
      uuidv7(at),
      at,
      entity,
    );
  // sessions and links: 31 days past their end (due), 29 (young)
  for (const end of [ago(31), ago(29)]) {
    await run(
      "INSERT INTO staff_sessions (id, user_id, last_seen_at, idle_expires_at, abs_expires_at) VALUES (?1, ?2, 1, 1, ?3)",
      uuidv7(),
      owner,
      end,
    );
    await run(
      "INSERT INTO client_sessions (id, contact_id, client_id, last_seen_at, idle_expires_at, abs_expires_at) VALUES (?1, ?2, ?3, 1, 1, ?4)",
      uuidv7(),
      live,
      free,
      end,
    );
    await run(
      "INSERT INTO magic_link_tokens (token_hash, contact_id, expires_at) VALUES (?1, ?2, ?3)",
      uuidv7(),
      live,
      end,
    );
  }
  // counters: 3 days (due), a locked one, 1 day (young)
  await run("INSERT INTO auth_attempts (key, window_start) VALUES (?1, ?2)", `t:${uuidv7()}`, ago(3));
  await run(
    "INSERT INTO auth_attempts (key, window_start, locked_until) VALUES (?1, ?2, ?3)",
    `t:${uuidv7()}`,
    ago(3),
    Date.now() + DAY,
  );
  await run("INSERT INTO auth_attempts (key, window_start) VALUES (?1, ?2)", `t:${uuidv7()}`, ago(1));
  await run("INSERT INTO pdf_asks (key, asked_at) VALUES (?1, ?2)", uuidv7(), ago(3));
  await run("INSERT INTO hook_failures (key, window_start) VALUES (?1, ?2)", uuidv7(), ago(3));
  // bells: read 100 days ago (due), unread 100 days (kept), any 400 days (due), read 10 days (kept)
  for (const [at, read] of [
    [ago(100), 1],
    [ago(100), null],
    [ago(400), null],
    [ago(10), 1],
  ] as const)
    await run(
      "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link, read_at, created_at) VALUES (?1, ?2, 'x', 'lead', ?5, 't', '/', ?3, ?4)",
      uuidv7(),
      owner,
      read,
      at,
      uuidv7(),
    );
  // stats: a per-plan row of 3 years ago (due), an aggregate one (kept), a young per-plan one
  await run(
    "INSERT INTO stats_daily (date, metric, dimension, value) VALUES ('2023-01-01', 'care.used_minutes', 'p1', 5)",
  );
  await run(
    "INSERT INTO stats_daily (date, metric, dimension, value) VALUES ('2023-01-01', 'leads.open', 'new', 5)",
  );
  await run(
    "INSERT INTO stats_daily (date, metric, dimension, value) VALUES ('2099-01-01', 'care.used_minutes', 'p1', 5)",
  );
  // requests: closed 4 years ago (due), of the held client (held), open
  for (const [client, closed] of [
    [free, true],
    [heldClient, true],
    [free, false],
  ] as const) {
    const id = uuidv7();
    await run(
      `INSERT INTO client_requests (id, client_id, kind, details, created_at, updated_at, ${REQUEST_CLOCK_COLS}) VALUES (?1, ?2, 'grievance', 'x', ?3, ?3, ${requestClockOf("?3")})`,
      id,
      client,
      ago(1600),
    );
    if (closed)
      await run(
        "UPDATE client_requests SET status = 'closed', outcome = 'done', closed_by = ?2, closed_at = ?3, updated_at = ?3 WHERE id = ?1",
        id,
        owner,
        ago(1500),
      );
  }
  // consent: an ended subject 4 years old (due, with its erased stop), an ended subject with a young receipt (kept), a live linked lead (kept)
  const gone = "1".repeat(64);
  const recent = "2".repeat(64);
  const receipt = (
    hash: string | null,
    event: string,
    source: string,
    at: number,
    leadId: string | null = null,
  ) =>
    run(
      `INSERT INTO consent_receipts (id, subject_hash, lead_id, event, source, purposes, at) VALUES (?1, ?2, ?3, ?4, ?5, '[]', ?6)`,
      uuidv7(),
      hash,
      leadId,
      event,
      source,
      at,
    );
  await receipt(gone, "grant", "web_form", ago(1500));
  await receipt(gone, "ended", "erasure", ago(1500));
  await run(
    "INSERT INTO email_suppressions (email, reason, at) VALUES (?1, 'erased', ?2)",
    `h:${gone}`,
    ago(1500),
  );
  await receipt(recent, "grant", "web_form", ago(1500));
  await receipt(recent, "ended", "erasure", ago(30));
  await run(
    "INSERT INTO email_suppressions (email, reason, at) VALUES (?1, 'erased', ?2)",
    `h:${recent}`,
    ago(1500),
  );
  await run(
    "INSERT INTO email_suppressions (email, reason, at) VALUES ('bounced@example.test', 'hard_bounce', 1)",
  );
  const lead = uuidv7();
  await run(
    "INSERT INTO leads (id, ref, source, contact_name, contact_email) VALUES (?1, 'L-RET', 'web', 'Pat', 'p@example.test')",
    lead,
  );
  await receipt(null, "grant", "web_form", ago(1500), lead);
  // runs: one 14 months old (due), the run under test
  await run(
    "INSERT INTO retention_runs (id, as_of, mode, started_at, families) VALUES (?1, 1, 'dry_run', ?2, 11)",
    uuidv7(),
    ago(430),
  );
  // financial rows older than every cut-off
  await mkIssued(free, { frozenAt: ago(4000) });
  return { owner };
}

const FINANCIAL = Object.entries(RETENTION_MATRIX)
  .filter(([, r]) => r.kind === "never" || r.kind === "no_age_rule" || r.kind === "staff_account")
  .map(([t]) => t);
const countAll = async (names: string[]) => {
  const out: Record<string, number> = {};
  for (const t of names) out[t] = (await first<{ n: number }>(`SELECT count(*) AS n FROM ${t}`))?.n ?? -1;
  return out;
};

describe("dry run and live (L5): the same rows, only those, held kept, financial untouched, a second run removes nothing", () => {
  it("per family", async () => {
    await seed();
    const asOf = Date.now();
    const cut = cutoffsOf(figures, asOf);
    const dryId = uuidv7();
    const liveId = uuidv7();
    for (const [id, mode] of [
      [dryId, "dry_run"],
      [liveId, "live"],
    ] as const)
      await run(
        "INSERT INTO retention_runs (id, as_of, mode, families) VALUES (?1, ?2, ?3, 11)",
        id,
        asOf,
        mode,
      );
    const allTables = Object.keys(RETENTION_MATRIX);
    const before = await countAll(allTables);
    // dry run: one batch per family, nothing but the counts written
    for (const family of RETENTION_FAMILIES)
      await db().batch(retentionStatements(db(), family, "dry_run", cut[family], asOf, dryId));
    const afterDry = await countAll(allTables);
    expect({ ...afterDry, retention_run_counts: 0 }).toEqual({ ...before, retention_run_counts: 0 });
    const counts = Object.fromEntries(
      (
        await all<{ family: string; due: number; held_skipped: number }>(
          "SELECT family, due, held_skipped FROM retention_run_counts WHERE run_id = ?1",
          dryId,
        )
      ).map((r) => [r.family, r]),
    );
    // the rows each family's predicate selects, read before the live run
    const selected: Record<string, number> = {};
    for (const family of RETENTION_FAMILIES)
      for (const t of FAMILY_TABLES[family]) {
        const [p1, p2] = bindsOf(family, cut[family], asOf);
        const where = t.held ? `(${t.age}) AND NOT ${t.held}` : `(${t.age})`;
        selected[family] =
          (selected[family] ?? 0) +
          ((
            await first<{ n: number }>(
              `SELECT count(*) AS n FROM ${t.table} WHERE ${where}`,
              ...[p1, p2].slice(0, highestPlaceholder(where)),
            )
          )?.n ?? 0);
      }
    // live: pages until done
    for (const family of RETENTION_FAMILIES) {
      for (let page = 0; page < 5; page++) {
        await db().batch(retentionStatements(db(), family, "live", cut[family], asOf, liveId));
        const r = await first<{ done: number }>(
          "SELECT done FROM retention_run_counts WHERE run_id = ?1 AND family = ?2",
          liveId,
          family,
        );
        if (r?.done === 1) break;
      }
    }
    const live = Object.fromEntries(
      (
        await all<{ family: string; due: number }>(
          "SELECT family, due FROM retention_run_counts WHERE run_id = ?1",
          liveId,
        )
      ).map((r) => [r.family, r.due]),
    );
    for (const family of RETENTION_FAMILIES) {
      expect(counts[family]?.due, `${family} dry`).toBe(selected[family]);
      expect(live[family], `${family} live`).toBe(selected[family]);
    }
    // what each family should have found in the seed
    expect(selected).toMatchObject({
      email_log: 1,
      email_events: 1,
      access_log: 1,
      audit_ip: 1,
      sessions: 3,
      counters: 3,
      bells: 2,
      stats: 1,
      requests: 1,
      consent: 3,
      runs: 1,
    });
    for (const f of ["email_log", "access_log", "audit_ip", "requests"])
      expect(counts[f]?.held_skipped, f).toBe(1);
    // financial, record and account tables untouched
    const after = await countAll(FINANCIAL);
    for (const t of FINANCIAL) expect(after[t], t).toBe(before[t]);
    // held rows stay; the bounce row stays; the audit row keeps its other columns
    expect(
      (await first<{ n: number }>("SELECT count(*) AS n FROM email_log WHERE to_email = 'held@example.test'"))
        ?.n,
    ).toBe(1);
    expect(
      (
        await first<{ n: number }>(
          "SELECT count(*) AS n FROM email_suppressions WHERE email = 'bounced@example.test'",
        )
      )?.n,
    ).toBe(1);
    expect(
      (
        await first<{ n: number }>(
          "SELECT count(*) AS n FROM audit_log WHERE ip IS NULL AND action = 'client.update'",
        )
      )?.n,
    ).toBe(1);
    // a second live run removes nothing
    const second = uuidv7();
    await run(
      "INSERT INTO retention_runs (id, as_of, mode, families) VALUES (?1, ?2, 'live', 11)",
      second,
      asOf,
    );
    for (const family of RETENTION_FAMILIES)
      await db().batch(retentionStatements(db(), family, "live", cut[family], asOf, second));
    const again = await all<{ due: number }>(
      "SELECT due FROM retention_run_counts WHERE run_id = ?1",
      second,
    );
    expect(again.every((r) => r.due === 0)).toBe(true);
  });
});

describe("indexes (EXPLAIN)", () => {
  const plan = async (sql: string, ...p: unknown[]) =>
    (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...p)).map((r) => r.detail).join(" | ");
  it("each family's select uses its index", async () => {
    const asOf = Date.now();
    const cut = cutoffsOf(figures, asOf);
    const want: Partial<Record<RetentionFamily, RegExp>> = {
      email_log: /email_log_created/,
      email_events: /email_events_received/,
      access_log: /PRIMARY KEY|sqlite_autoindex_access_log/,
      audit_ip: /audit_log_at/,
      bells: /notifications_created/,
      stats: /stats_daily_metric/,
      runs: /retention_runs_started/,
    };
    for (const [family, re] of Object.entries(want) as [RetentionFamily, RegExp][]) {
      const t = FAMILY_TABLES[family][0];
      if (!t) throw new Error(family);
      const [p1, p2] = bindsOf(family, cut[family], asOf);
      expect(
        await plan(
          `SELECT rowid FROM ${t.table} WHERE ${t.age} ORDER BY ${t.order} LIMIT 500`,
          ...[p1, p2].slice(0, highestPlaceholder(t.age)),
        ),
        family,
      ).toMatch(re);
    }
    expect(await plan("SELECT 1 FROM staff_sessions WHERE abs_expires_at < ?1", 1)).toMatch(
      /staff_sessions_abs/,
    );
    expect(await plan("SELECT 1 FROM client_sessions WHERE abs_expires_at < ?1", 1)).toMatch(
      /client_sessions_abs/,
    );
    expect(await plan("SELECT 1 FROM magic_link_tokens WHERE expires_at < ?1", 1)).toMatch(
      /magic_link_tokens_expires/,
    );
    expect(await plan("SELECT 1 FROM auth_attempts WHERE window_start < ?1", 1)).toMatch(
      /auth_attempts_window/,
    );
    expect(
      await plan(
        "SELECT 1 FROM client_requests WHERE lead_ref = ?1 AND kind = 'data_erasure' AND status = 'open'",
        "x",
      ),
    ).toMatch(/client_requests_open_erasure/);
    expect(
      await plan(
        // The planner prefers client_requests_status for this shape, so the C.1 filter names the index (INDEXED BY fails if it cannot be used).
        "SELECT 1 FROM client_requests INDEXED BY client_requests_due WHERE status = 'open' AND due_at <= ?1 ORDER BY due_at, id",
        1,
      ),
    ).toMatch(/client_requests_due/);
    expect(await plan("SELECT 1 FROM leads WHERE lower(contact_email) = ?1", "x")).toMatch(
      /leads_contact_email_lower/,
    );
    expect(await plan("SELECT 1 FROM contacts WHERE email = lower(?1)", "x")).toMatch(/contacts_email/);
    expect(await plan(ORPHAN_FILES_SQL, "[]")).toMatch(/files_r2_key/);
    expect(await plan(DRAIN_PAGE_SQL)).toMatch(/r2_deletions_created/);
    expect(await plan("SELECT 1 FROM consent_receipts WHERE subject_hash = ?1 AND at >= ?2", "x", 1)).toMatch(
      /consent_receipts_subject/,
    );
  });
});

describe("the R2 sweep's SQL (B.7)", () => {
  it("orphans are the keys no files row names; signatures in use are the settings one and the sealed issuers'", async () => {
    const client = await mkClientRow();
    const id = uuidv7();
    await run(
      "INSERT INTO files (id, client_id, r2_key, filename, mime, size, sha256) VALUES (?1, ?2, 'files/kept', 'a.pdf', 'application/pdf', 1, ?3)",
      id,
      client,
      "e".repeat(64),
    );
    const rows = await all<{ key: string }>(ORPHAN_FILES_SQL, JSON.stringify(["files/kept", "files/orphan"]));
    expect(rows.map((r) => r.key)).toEqual(["files/orphan"]);
    await run(
      "INSERT OR REPLACE INTO settings (key, value, version) VALUES ('company', json_object('signature', json_object('key', 'settings/signature-aaaa.png')), 1)",
    );
    const keys = (await all<{ key: string }>(SIGNATURES_IN_USE_SQL)).map((r) => r.key);
    expect(keys).toContain("settings/signature-aaaa.png");
  });
});
