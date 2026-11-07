// Rebuild PDF (JOB-PDF-02; run file docs/runs/rebuild-pdf.md): migrations 0087 (two new tables) and 0088 (the `pdf_repair_triggers` set), and the SQL of
// `src/pdf-repairs.ts`: the insert trigger's refusals, append-only tables, the result's shape, the redaction outbox, the twins and the readers' index.
// Owner Q1 = B (2026-11-07): an offer the client can still accept is never rebuilt. Invented data only.
import { env } from "cloudflare:workers";
import { defaultFormat, financialYear, sqlPrintfPattern, uuidv7 } from "@techaust/core";
import { todayIst } from "@techaust/core/offers";
import { supplierPdfKey } from "@techaust/core/pdf-jobs";
import { REBUILD_OPEN_MS, REBUILD_WINDOW_MS, repairKey } from "@techaust/core/pdf-repair";
import { describe, expect, it } from "vitest";
import { BACKUP_SCOPE } from "../src/backup-scope.ts";
import {
  IST_DAY_SQL,
  QUEUE_UNAVAILABLE_CODE,
  REPAIR_KEY_SQL,
  REQUEST_INSERT_SQL,
  RESULT_INSERT_SQL,
  requestBinds,
  SERVED_PDF_SQL,
  SUBJECT_SQL,
  SUPPLIER_KEY_SQL,
  subjectBinds,
} from "../src/pdf-repairs.ts";
import { RETENTION_MATRIX } from "../src/retention.ts";
import { triggerMigrationSql } from "../src/triggers.ts";
import { all, first, insertClient, insertDraftInvoice, issueBatch, rejects, run } from "./helpers.ts";
import { mkQuote, send, staffId } from "./quotes.ts";

const FY = financialYear(2026).token;
const PATTERN = sqlPrintfPattern(defaultFormat("invoice")).pattern;
const SHA = "a".repeat(64);
/** 2026-11-08 12:00 IST: the fixture offers are valid until 2026-11-09, so they are open on this day. */
const OPEN_DAY = Date.parse("2026-11-08T12:00:00+05:30");
/** 2026-11-10 12:00 IST: past the offers' last valid day. */
const EXPIRED_DAY = Date.parse("2026-11-10T12:00:00+05:30");

let seq = 0;
async function issuedInvoice() {
  const clientId = await insertClient(`C-${crypto.randomUUID().slice(0, 8)}`);
  const id = await insertDraftInvoice(clientId);
  await issueBatch(id, "invoice", FY, PATTERN);
  const key = `docs/tax_invoice/2026-27/${String(++seq).padStart(4, "0")}-v1.pdf`;
  await run("UPDATE documents SET pdf_r2_key = ?2, pdf_sha256 = ?3 WHERE id = ?1", id, key, SHA);
  return { id, clientId, key };
}

async function sentOffer() {
  const q = await mkQuote();
  await send(q);
  const key = `docs/proposal/2026-27/${String(++seq).padStart(4, "0")}-v1.pdf`;
  await run("UPDATE documents SET pdf_r2_key = ?2, pdf_sha256 = ?3 WHERE id = ?1", q.id, key, SHA);
  return { ...q, key };
}

const raw = (r: {
  id?: string;
  kind: string;
  subject: string;
  n?: number;
  original: string;
  old?: string;
  newKey?: string;
  at?: number;
}) =>
  run(
    "INSERT INTO pdf_repairs (id, subject_kind, subject_id, n, original_key, old_key, old_sha256, found, new_key, requested_by, requested_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, 'missing', ?7, ?8, ?9)",
    r.id ?? uuidv7(),
    r.kind,
    r.subject,
    r.n ?? 1,
    r.original,
    r.old ?? r.original,
    r.newKey ?? repairKey(r.original, r.n ?? 1),
    STAFF,
    r.at ?? EXPIRED_DAY,
  );
let STAFF = "";

/** The route's request statement. Returns the rows it wrote (0 or 1). */
async function request(
  kind: keyof typeof REQUEST_INSERT_SQL,
  subject: string,
  original: string,
  at: number,
  checked = original,
) {
  STAFF ||= await staffId();
  const id = uuidv7();
  const r = await env.DB.prepare(REQUEST_INSERT_SQL[kind])
    .bind(
      ...requestBinds({
        id,
        kind,
        subjectId: subject,
        originalKey: original,
        checkedKey: checked,
        checkedSha: SHA,
        found: "missing",
        by: STAFF,
        now: at,
      }),
    )
    .run();
  return { id, changes: r.meta.changes };
}
const result = (
  id: string,
  outcome: string,
  at: number,
  sha: string | null = null,
  code = "original_present",
) =>
  env.DB.prepare(RESULT_INSERT_SQL)
    .bind(id, outcome, outcome === "rebuilt" ? null : code, sha, sha ? 100 : null, at)
    .run();

describe("0087 and 0088", () => {
  it("0087 only creates the two tables and their indexes; 0088 regenerates from the generator and only creates triggers", () => {
    const of = (name: string) =>
      (env.TEST_MIGRATIONS.find((m) => m.name === name)?.queries ?? [])
        .map((q) => q.replace(/^--[^\n]*\n?/gm, "").trim())
        .filter((q) => q !== "");
    for (const q of of("0087_pdf_repairs.sql"))
      expect(q).toMatch(/^CREATE (TABLE|UNIQUE INDEX|INDEX) `pdf_repair/);
    const norm = (xs: string[]) => xs.map((q) => q.replace(/\s+/g, " ").trim().replace(/;$/, ""));
    const generated = triggerMigrationSql("pdf_repair_triggers")
      .split("\n--> statement-breakpoint\n")
      .map((q) => q.replace(/^--[^\n]*\n?/gm, "").trim())
      .filter((q) => q !== "");
    const applied = norm(of("0088_pdf_repair_triggers.sql"));
    expect(applied).toEqual(norm(generated));
    for (const q of applied) expect(q).toMatch(/^CREATE TRIGGER /);
  });

  it("retention keeps both tables for ever and the monthly copy holds both", () => {
    for (const t of ["pdf_repairs", "pdf_repair_results"]) {
      expect(RETENTION_MATRIX[t]?.kind, t).toBe("never");
      expect(BACKUP_SCOPE[t], t).toBe("finance_monthly");
    }
  });
});

describe("the twins", () => {
  it("REPAIR_KEY_SQL is core repairKey and SUPPLIER_KEY_SQL is core supplierPdfKey", async () => {
    for (const [k, n] of [
      ["docs/proposal/2026-27/0001-v1.pdf", 1],
      ["docs/tax_invoice/2026-27/0003-v1-supplier.pdf", 7],
      [`deeds/x/unsigned-${SHA}.pdf`, 99],
    ] as const) {
      const row = await first<{ k: string }>(`SELECT ${REPAIR_KEY_SQL("?1", "?2")} AS k`, k, n);
      expect(row?.k).toBe(repairKey(k, n));
    }
    const input = { type: "tax_invoice", fy: "2026-27", number: 3, version: 1 };
    const original = supplierPdfKey(input).replace("-supplier.pdf", ".pdf");
    const row = await first<{ k: string }>(`SELECT ${SUPPLIER_KEY_SQL("?1")} AS k`, original);
    expect(row?.k).toBe(supplierPdfKey(input));
  });

  it("IST_DAY_SQL is core todayIst, on both sides of the IST midnight", async () => {
    for (const iso of [
      "2026-11-07T18:29:59.999Z",
      "2026-11-07T18:30:00.000Z",
      "2026-03-31T18:30:00.000Z",
      "2026-03-31T18:29:59.000Z",
      "2026-12-31T23:59:59.000Z",
    ]) {
      const ms = Date.parse(iso);
      const row = await first<{ d: string }>(`SELECT ${IST_DAY_SQL("?1")} AS d`, ms);
      expect(row?.d, iso).toBe(todayIst(ms));
    }
  });

  it("SERVED_PDF_SQL reads the partial index", async () => {
    const plan = await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${SERVED_PDF_SQL}`, "k");
    expect(plan.map((p) => p.detail).join(" | ")).toContain("pdf_repair_results_served");
  });
});

describe("pdf_repairs_insert: the subject", () => {
  it("an issued invoice with its PDF is accepted with its own key; an unknown id, a draft, another key or another kind is refused", async () => {
    STAFF ||= await staffId();
    const inv = await issuedInvoice();
    await rejects(raw({ kind: "invoice", subject: "nope", original: inv.key }), /pdf_repairs_insert:/);
    await rejects(
      raw({ kind: "invoice", subject: inv.id, original: "docs/other/0001-v1.pdf" }),
      /pdf_repairs_insert:/,
    );
    await rejects(raw({ kind: "offer", subject: inv.id, original: inv.key }), /pdf_repairs_insert:/);
    const draft = await insertDraftInvoice(inv.clientId);
    await rejects(raw({ kind: "invoice", subject: draft, original: inv.key }), /pdf_repairs_insert:/);
    await raw({ kind: "invoice", subject: inv.id, original: inv.key });
  });

  it("a supplier copy names the original's key with -supplier; an anonymised client takes no rebuild", async () => {
    STAFF ||= await staffId();
    const inv = await issuedInvoice();
    await rejects(raw({ kind: "supplier", subject: inv.id, original: inv.key }), /pdf_repairs_insert:/);
    const supplier = inv.key.replace(/\.pdf$/, "-supplier.pdf");
    await raw({ kind: "supplier", subject: inv.id, original: supplier });
    const other = await issuedInvoice();
    await run("UPDATE clients SET anonymised_at = 1 WHERE id = ?", other.clientId);
    await rejects(raw({ kind: "invoice", subject: other.id, original: other.key }), /pdf_repairs_insert:/);
  });

  it("Q1 = B: an offer the client can still accept is refused; the same offer once expired is accepted; a redacted offer is refused", async () => {
    STAFF ||= await staffId();
    const o = await sentOffer();
    await rejects(
      raw({ kind: "offer", subject: o.id, original: o.key, at: OPEN_DAY }),
      /pdf_repairs_insert:/,
    );
    await raw({ kind: "offer", subject: o.id, original: o.key, at: EXPIRED_DAY });
    const r = await sentOffer();
    await run(
      "UPDATE documents SET recipient = json_object('legalName', 'Anonymised client', 'country', 'IN'), title = 'Anonymised client', redacted_at = ?2, updated_at = updated_at + 1 WHERE id = ?1",
      r.id,
      9,
    );
    await rejects(
      raw({ kind: "offer", subject: r.id, original: r.key, at: EXPIRED_DAY }),
      /pdf_repairs_insert:/,
    );
  });

  it("an accepted offer can be rebuilt while it is still within its validity", async () => {
    STAFF ||= await staffId();
    const o = await sentOffer();
    await run("UPDATE documents SET status = 'accepted', decided_at = 6 WHERE id = ?", o.id);
    await raw({ kind: "offer", subject: o.id, original: o.key, at: OPEN_DAY });
  });
});

describe("pdf_repairs_insert_n and _keys", () => {
  it("n is the next number, the new key is the original's -r<n>, and the old key is the newest rebuilt key, else the original", async () => {
    STAFF ||= await staffId();
    const inv = await issuedInvoice();
    await rejects(
      raw({ kind: "invoice", subject: inv.id, original: inv.key, n: 2 }),
      /pdf_repairs_insert_n:/,
    );
    await rejects(
      raw({ kind: "invoice", subject: inv.id, original: inv.key, newKey: `${inv.key}-r1.pdf` }),
      /pdf_repairs_insert_keys:/,
    );
    await rejects(
      raw({ kind: "invoice", subject: inv.id, original: inv.key, old: repairKey(inv.key, 1) }),
      /pdf_repairs_insert_keys:/,
    );
    const id = uuidv7();
    await raw({ id, kind: "invoice", subject: inv.id, original: inv.key, at: 1_000 });
    expect((await result(id, "rebuilt", 2_000, "b".repeat(64))).meta.changes).toBeGreaterThan(0);
    // the second request: n = 2, old = r1, new = r2
    await rejects(
      raw({ kind: "invoice", subject: inv.id, original: inv.key, n: 2 }),
      /pdf_repairs_insert_keys:/,
    );
    await raw({ kind: "invoice", subject: inv.id, original: inv.key, n: 2, old: repairKey(inv.key, 1) });
  });
});

describe("REQUEST_INSERT_SQL: the throttle and the guard", () => {
  it("computes n and the keys; under 5 minutes, or an open request under 26 hours, writes nothing; after a result and 5 minutes: n = 2", async () => {
    const inv = await issuedInvoice();
    const t = 1_800_000_000_000;
    const a = await request("invoice", inv.id, inv.key, t);
    expect(a.changes).toBe(1);
    expect(await first("SELECT n, old_key, new_key FROM pdf_repairs WHERE id = ?", a.id)).toEqual({
      n: 1,
      old_key: inv.key,
      new_key: repairKey(inv.key, 1),
    });
    expect((await request("invoice", inv.id, inv.key, t + REBUILD_WINDOW_MS - 1)).changes).toBe(0);
    // open (no result) under 26 hours
    expect((await request("invoice", inv.id, inv.key, t + REBUILD_WINDOW_MS + 1)).changes).toBe(0);
    // an open request older than 26 hours no longer blocks (the rebuild may still finish; the key is r2 then)
    expect((await request("invoice", inv.id, inv.key, t + REBUILD_OPEN_MS + 1)).changes).toBe(1);

    const other = await issuedInvoice();
    const b = await request("invoice", other.id, other.key, t);
    expect((await result(b.id, "rebuilt", t + 60_000, "c".repeat(64))).meta.changes).toBe(1);
    // the served key moved to r1: a request that checked the original writes nothing
    expect((await request("invoice", other.id, other.key, t + REBUILD_WINDOW_MS + 1)).changes).toBe(0);
    const c = await request(
      "invoice",
      other.id,
      other.key,
      t + REBUILD_WINDOW_MS + 1,
      repairKey(other.key, 1),
    );
    expect(c.changes).toBe(1);
    expect(await first("SELECT n, old_key, new_key FROM pdf_repairs WHERE id = ?", c.id)).toEqual({
      n: 2,
      old_key: repairKey(other.key, 1),
      new_key: repairKey(other.key, 2),
    });
  });

  it("early check change 2: a request closed queue_unavailable holds no 5-minute window; any other result does", async () => {
    const t = 1_800_000_000_000;
    const inv = await issuedInvoice();
    const a = await request("invoice", inv.id, inv.key, t);
    expect((await result(a.id, "failed", t + 1, null, QUEUE_UNAVAILABLE_CODE)).meta.changes).toBe(1);
    const b = await request("invoice", inv.id, inv.key, t + 2);
    expect(b.changes).toBe(1);
    expect(await first("SELECT n FROM pdf_repairs WHERE id = ?", b.id)).toEqual({ n: 2 });

    const other = await issuedInvoice();
    const c = await request("invoice", other.id, other.key, t);
    expect((await result(c.id, "failed", t + 1, null, "dead_letter")).meta.changes).toBe(1);
    expect((await request("invoice", other.id, other.key, t + 2)).changes).toBe(0);
  });

  it("Q1 = B in the guard: an open offer writes nothing (no abort); expired, it is written", async () => {
    const o = await sentOffer();
    expect((await request("offer", o.id, o.key, OPEN_DAY)).changes).toBe(0);
    expect((await request("offer", o.id, o.key, EXPIRED_DAY)).changes).toBe(1);
  });

  it("the kind must match the statement; an anonymised client writes nothing", async () => {
    const inv = await issuedInvoice();
    expect((await request("receipt", inv.id, inv.key, 1)).changes).toBe(0);
    await run("UPDATE clients SET anonymised_at = 1 WHERE id = ?", inv.clientId);
    expect((await request("invoice", inv.id, inv.key, 1)).changes).toBe(0);
  });

  it("SUBJECT_SQL runs for every kind", async () => {
    for (const [kind, sql] of Object.entries(SUBJECT_SQL))
      await env.DB.prepare(sql)
        .bind(...subjectBinds(kind as keyof typeof SUBJECT_SQL, "nope", "2026-11-07"))
        .all();
  });
});

describe("pdf_repair_results", () => {
  it("one result per request; rebuilt carries the request's key; the shape and the request are checked", async () => {
    const inv = await issuedInvoice();
    const a = await request("invoice", inv.id, inv.key, 1_000);
    await rejects(
      run(
        "INSERT INTO pdf_repair_results (repair_id, original_key, n, outcome, new_key, new_sha256, completed_at) VALUES (?1, ?2, 1, 'rebuilt', NULL, NULL, 5)",
        a.id,
        inv.key,
      ),
      /pdf_repair_results_insert:|CHECK constraint failed: pdf_repair_results_rebuilt/,
    );
    await rejects(
      run(
        "INSERT INTO pdf_repair_results (repair_id, original_key, n, outcome, new_key, new_sha256, completed_at) VALUES (?1, ?2, 1, 'rebuilt', 'docs/x.pdf', ?3, 5)",
        a.id,
        inv.key,
        SHA,
      ),
      /pdf_repair_results_insert:/,
    );
    await rejects(
      run(
        "INSERT INTO pdf_repair_results (repair_id, original_key, n, outcome, completed_at) VALUES (?1, ?2, 2, 'failed', 5)",
        a.id,
        inv.key,
      ),
      /pdf_repair_results_insert:/,
    );
    await rejects(
      run(
        "INSERT INTO pdf_repair_results (repair_id, original_key, n, outcome, completed_at) VALUES (?1, ?2, 1, 'failed', 5)",
        a.id,
        inv.key,
      ),
      /pdf_repair_results_insert:/,
    );
    await rejects(
      run(
        "INSERT INTO pdf_repair_results (repair_id, original_key, n, outcome, code, completed_at) VALUES (?1, ?2, 1, 'failed', 'Bad', 2000)",
        a.id,
        inv.key,
      ),
      /CHECK constraint failed: pdf_repair_results_code/,
    );
    // the statement keeps completed_at at or after the request (clock skew)
    expect((await result(a.id, "rebuilt", 500, SHA)).meta.changes).toBe(1);
    expect(
      await first("SELECT new_key, completed_at FROM pdf_repair_results WHERE repair_id = ?", a.id),
    ).toEqual({
      new_key: repairKey(inv.key, 1),
      completed_at: 1_000,
    });
    expect((await result(a.id, "failed", 3_000)).meta.changes).toBe(0);
    expect(await first(SERVED_PDF_SQL, inv.key)).toEqual({
      new_key: repairKey(inv.key, 1),
      new_sha256: SHA,
      completed_at: 1_000,
    });
  });

  it("a rebuilt result is not written once the client is anonymised; a failed one still is", async () => {
    const inv = await issuedInvoice();
    const a = await request("invoice", inv.id, inv.key, 1_000);
    await run("UPDATE clients SET anonymised_at = 1 WHERE id = ?", inv.clientId);
    expect((await result(a.id, "rebuilt", 2_000, SHA)).meta.changes).toBe(0);
    expect((await result(a.id, "skipped", 2_000)).meta.changes).toBe(1);
  });

  it("both tables are append-only", async () => {
    const inv = await issuedInvoice();
    const a = await request("invoice", inv.id, inv.key, 1_000);
    await result(a.id, "intact", 2_000);
    await rejects(
      run("UPDATE pdf_repairs SET found = 'damaged' WHERE id = ?", a.id),
      /pdf_repairs is append-only/,
    );
    await rejects(run("DELETE FROM pdf_repairs WHERE id = ?", a.id), /pdf_repairs is append-only/);
    await rejects(
      run("UPDATE pdf_repair_results SET code = 'x' WHERE repair_id = ?", a.id),
      /pdf_repair_results is append-only/,
    );
    await rejects(
      run("DELETE FROM pdf_repair_results WHERE repair_id = ?", a.id),
      /pdf_repair_results is append-only/,
    );
  });
});

describe("documents_redact_repairs_outbox", () => {
  it("redacting an offer queues its rebuilt PDFs for deletion with its other objects", async () => {
    const o = await sentOffer();
    const a = await request("offer", o.id, o.key, EXPIRED_DAY);
    expect(a.changes).toBe(1);
    await result(a.id, "rebuilt", EXPIRED_DAY + 1, SHA);
    const r = await run(
      "UPDATE documents SET recipient = json_object('legalName', 'Anonymised client', 'country', 'IN'), title = 'Anonymised client', redacted_at = ?2, updated_at = updated_at + 1 WHERE id = ?1",
      o.id,
      EXPIRED_DAY + 2,
    );
    // D1 counts trigger writes: a redaction batch reads changes() > 0, never = 1.
    expect(r.meta.changes).toBeGreaterThan(0);
    const keys = (await all<{ key: string }>("SELECT key FROM r2_deletions WHERE bucket = 'docs'")).map(
      (k) => k.key,
    );
    expect(keys).toContain(repairKey(o.key, 1));
    expect(keys).toContain(o.key);
  });
});
