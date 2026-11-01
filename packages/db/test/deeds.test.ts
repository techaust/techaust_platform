// The deed of assignment in the database (T11; run file docs/runs/t11-deed.md, L1 to L8; 08-C RB-38(a)): migrations 0061 and 0062, every trigger of the
// `deed_triggers` set, L3's `deedDraftStatements` (eligibility, idempotence, the bell and the system audit row, each target shape), the finalise batch (gap-free
// numbers), sign and cancel, and the erase rule (L7). Raw SQL where a trigger is the subject; the real builders where a write path is. All names and amounts are
// invented test data.
import { env } from "cloudflare:workers";
import { defaultFormat, maxNumber, sqlPrintfPattern, uuidv7 } from "@techaust/core";
import {
  DEED_SCHEDULE_LIMITS as DEED_SCHEDULE_LIMITS_CORE,
  type DeedDocFact,
  deedEligibility,
  isLivePayable,
} from "@techaust/core/deeds";
import { describe, expect, it } from "vitest";
import {
  cancelDeedStatement,
  DEED_COLS,
  DEED_DOCS_STAMP_SQL,
  type DeedDocsStamp,
  type DeedRow,
  deedCounterRowStatement,
  deedCounterTakeStatement,
  deedDraftStatements,
  deedEligibleSql,
  deedFactsSql,
  deedSchedulesStatement,
  finaliseDeedStatement,
  signDeedStatement,
} from "../src/deeds.ts";
import { recomputeStatement } from "../src/ledger.ts";
import type { GuardSql } from "../src/log.ts";
import { DEED_STATUSES, DEED_SCHEDULE_LIMITS as SCHEDULE_LIMITS_DB } from "../src/schema/deeds.ts";
import { DEED_FROZEN_0062, DEED_SET_ONCE_0062 } from "../src/triggers.ts";
import { mkClientRow, mkMember, next } from "./billing-helpers.ts";
import { all, first, rejects, run } from "./helpers.ts";
import { mkQuote, send } from "./quotes.ts";

const db = () => env.DB;
const T = 1_800_000_000_000;
const PATTERN = sqlPrintfPattern(defaultFormat("deed"));
const MAX = maxNumber(defaultFormat("deed"));
const ALWAYS: GuardSql = { sql: () => "1 = 1", params: [] };

async function session(userId: string, stepUp = true): Promise<string> {
  const id = `sess-${uuidv7()}`;
  const now = Date.now();
  await run(
    "INSERT INTO staff_sessions (id, user_id, last_seen_at, idle_expires_at, abs_expires_at, step_up_until) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    id,
    userId,
    now,
    now + 3_600_000,
    now + 3_600_000,
    stepUp ? now + 600_000 : null,
  );
  return id;
}

type DocOver = {
  type?: string;
  currency?: "INR" | "USD";
  total?: number;
  paid?: number;
  credited?: number;
  tds?: number;
  voided?: boolean;
  frozen?: boolean;
  carePlanId?: string | null;
  parentId?: string | null;
  projectId?: string | null;
};

/** An issued document of `clientId` on project `projectId`, its ledger columns consistent (`balance = max(0, total - paid - credited - tds)`). */
async function mkDoc(clientId: string, projectId: string | null, o: DocOver = {}): Promise<string> {
  const id = uuidv7();
  const n = next();
  const total = o.total ?? 100_000;
  const paid = o.paid ?? 0;
  const credited = o.credited ?? 0;
  const tds = o.tds ?? 0;
  const frozen = o.frozen !== false;
  const balance = Math.max(0, total - paid - credited - tds);
  const status = o.voided
    ? "void"
    : !frozen
      ? "draft"
      : credited >= total
        ? "credited"
        : paid + tds > 0 && balance === 0
          ? "paid"
          : paid + tds > 0
            ? "partially_paid"
            : credited > 0
              ? "partially_credited"
              : "issued";
  await run(
    `INSERT INTO documents (id, type, status, client_id, project_id, care_plan_id, parent_id, currency, series, fy, number, number_display, frozen_at, issue_date,
       subtotal_minor, taxable_minor, total_minor, paid_minor, credited_minor, tds_minor, balance_minor, content_sha256, updated_at, voided_at, void_reason)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '2627', ?10, ?11, ?12, '2026-10-28', ?13, ?13, ?13, ?14, ?15, ?16, ?17, ?18, 7000, ?19, ?20)`,
    id,
    o.type ?? "tax_invoice",
    status,
    clientId,
    o.projectId === undefined ? projectId : o.projectId,
    o.carePlanId ?? null,
    o.parentId ?? null,
    o.currency ?? "INR",
    frozen ? "inv-d" : null,
    frozen ? n : null,
    frozen ? `D/${n}` : null,
    frozen ? 1_000 : null,
    total,
    paid,
    credited,
    tds,
    frozen ? balance : total,
    "h".repeat(64),
    o.voided ? 5 : null,
    o.voided ? "x" : null,
  );
  return id;
}

type Fixture = { owner: string; clientId: string; quoteId: string; projectId: string };

/** An owner, a client, an ACCEPTED proposal of `total` and a project made from it (status `status`). */
async function mkProject(
  o: { total?: number; currency?: "INR" | "USD"; status?: string; type?: "proposal" | "estimate" } = {},
): Promise<Fixture> {
  const owner = await mkMember("owner");
  const clientId = await mkClientRow({ currency: o.currency ?? "INR" });
  const q = await mkQuote({ clientId, type: o.type ?? "proposal", currency: o.currency ?? "INR" });
  await run(
    "UPDATE documents SET total_minor = ?2, subtotal_minor = ?2, taxable_minor = ?2 WHERE id = ?1",
    q.id,
    o.total ?? 100_000,
  );
  await send(q);
  await run("UPDATE documents SET status = 'accepted', decided_at = 2000 WHERE id = ?", q.id);
  const projectId = uuidv7();
  await run(
    "INSERT INTO projects (id, code, client_id, name, status, currency, source_document_id) VALUES (?1, ?2, ?3, 'Website', ?4, ?5, ?6)",
    projectId,
    `PRJ-${String(next()).padStart(5, "0")}`,
    clientId,
    o.status ?? "completed",
    o.currency ?? "INR",
    q.id,
  );
  return { owner, clientId, quoteId: q.id, projectId };
}

const draft = (target: Parameters<typeof deedDraftStatements>[1]["target"], now = T, g?: GuardSql) =>
  db().batch(deedDraftStatements(db(), { target, now }, g));
const deedOf = (projectId: string) =>
  first<DeedRow>(`SELECT ${DEED_COLS} FROM deeds d WHERE d.project_id = ?1`, projectId);

/** A draft deed made straight through L3 for a fully paid fixture. */
async function draftDeed(f?: Fixture): Promise<Fixture & { deed: DeedRow }> {
  const fx = f ?? (await mkProject());
  if (!f) await mkDoc(fx.clientId, fx.projectId, { paid: 100_000 });
  await draft({ projectId: fx.projectId });
  const deed = await deedOf(fx.projectId);
  if (!deed) throw new Error("no deed was made");
  return { ...fx, deed };
}

const SCHEDULES = {
  deliverables: "Website source code and designs",
  location: "Git repository handed over",
  deliveredDates: "28 Oct 2026",
  tools: "None",
  thirdParty: "Astro (MIT)",
};

async function fillSchedules(deed: DeedRow, owner: string): Promise<number> {
  const s = await session(owner);
  const now = Date.now();
  await deedSchedulesStatement(db(), {
    deedId: deed.id,
    expectedUpdatedAt: deed.updated_at,
    now,
    sessionId: s,
    schedules: SCHEDULES,
  }).run();
  const row = await first<{ updated_at: number }>("SELECT updated_at FROM deeds WHERE id = ?", deed.id);
  return row?.updated_at ?? 0;
}

const docsStamp = async (projectId: string): Promise<DeedDocsStamp> =>
  (await first<DeedDocsStamp>(DEED_DOCS_STAMP_SQL, projectId)) ?? { n: 0, at: null };

async function finalise(
  fx: Fixture & { deed: DeedRow },
  o: { stepUp?: boolean; fy?: string; docs?: DeedDocsStamp; beforeBatch?: () => Promise<void> } = {},
) {
  const updatedAt = await fillSchedules(fx.deed, fx.owner);
  const s = await session(fx.owner, o.stepUp ?? true);
  const client = await first<{ updated_at: number }>(
    "SELECT updated_at FROM clients WHERE id = ?",
    fx.clientId,
  );
  const docs = o.docs ?? (await docsStamp(fx.projectId));
  await o.beforeBatch?.();
  const fy = o.fy ?? "2627";
  const res = await db().batch([
    deedCounterRowStatement(db(), fy),
    finaliseDeedStatement(db(), {
      deedId: fx.deed.id,
      expectedUpdatedAt: updatedAt,
      now: Date.now(),
      sessionId: s,
      memberId: fx.owner,
      fy,
      pattern: PATTERN.pattern,
      argOrder: PATTERN.argOrder,
      maxNumber: MAX,
      madeOn: "2026-11-01",
      snapshotJson: '{"layout":"deed-v1"}',
      snapshotSha256: "s".repeat(64),
      numberingVersion: null,
      companyVersion: null,
      clientUpdatedAt: client?.updated_at ?? 0,
      docs,
    }),
    deedCounterTakeStatement(db(), { deedId: fx.deed.id, fy }, { sql: () => "changes() > 0", params: [] }),
  ]);
  return { changed: res[1]?.meta.changes ?? 0, row: await deedOf(fx.projectId) };
}

// ---- migrations --------------------------------------------------------------------------------------------------------------------------------------------

describe("0061 and 0062 [run file, Data]", () => {
  it("0061 only creates the deeds table and its indexes: no DROP, no copy, no rebuild of a referenced table", () => {
    const m = env.TEST_MIGRATIONS.find((x) => x.name === "0061_deeds.sql");
    expect(m).toBeDefined();
    for (const q of (m?.queries ?? []).map((x) => x.replace(/^(\s|--> statement-breakpoint)+/, "")))
      expect(q.trim(), q.slice(0, 60)).toMatch(/^(CREATE TABLE `deeds`|CREATE INDEX|CREATE UNIQUE INDEX)/);
    expect((m?.queries ?? []).join("\n")).not.toMatch(/DROP TABLE|__new_|INSERT INTO/);
  });

  it("the statuses are the four of the brief, and the frozen and set-once lists cover every column a draft does not own", () => {
    expect(DEED_STATUSES).toEqual(["draft", "final", "signed", "cancelled"]);
    expect(DEED_FROZEN_0062).toContain("snapshot_sha256");
    expect(DEED_SET_ONCE_0062).toContain("signed_r2_key");
  });
});

// ---- L3: the draft --------------------------------------------------------------------------------------------------------------------------------------

describe("deedDraftStatements: L2 and L3 [RB-38(a), ADM-PRJ-04]", () => {
  it("a completed, fully paid project gets one draft, one system audit row and one bell per active Owner; a second run adds nothing", async () => {
    const fx = await mkProject();
    const second = await mkMember("owner");
    await mkMember("owner", "deactivated");
    await mkDoc(fx.clientId, fx.projectId, { paid: 100_000 });
    await draft({ projectId: fx.projectId });
    const d = await deedOf(fx.projectId);
    expect(d).toMatchObject({
      status: "draft",
      client_id: fx.clientId,
      source_document_id: fx.quoteId,
      number: null,
      created_at: T,
    });
    const bells = await all<{ user_id: string; title: string; link: string }>(
      "SELECT user_id, title, link FROM notifications WHERE kind = 'deed.draft' AND entity_id = ?",
      d?.id,
    );
    expect(bells.map((b) => b.user_id).sort()).toEqual([fx.owner, second].sort());
    // 07-ZJ line 31 (approved 2026-11-01)
    expect(bells[0]?.title).toMatch(/^Draft deed ready for PRJ-.*: fill in the Schedules\.$/);
    expect(bells[0]?.link).toBe(`/projects/${fx.projectId}?tab=deed`);
    const audit = await all<{ actor_type: string; summary: string }>(
      "SELECT actor_type, summary FROM audit_log WHERE action = 'deed.draft' AND entity_id = ?",
      d?.id,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor_type).toBe("system");
    expect(JSON.parse(audit[0]?.summary ?? "{}")).toEqual({
      deedId: d?.id,
      projectId: fx.projectId,
      sourceDocumentId: fx.quoteId,
    });
    await draft({ projectId: fx.projectId }, T + 5);
    expect((await all("SELECT id FROM deeds WHERE project_id = ?", fx.projectId)).length).toBe(1);
    expect(
      (await all("SELECT id FROM notifications WHERE kind = 'deed.draft' AND entity_id = ?", d?.id)).length,
    ).toBe(2);
    expect(
      (await all("SELECT id FROM audit_log WHERE action = 'deed.draft' AND entity_id = ?", d?.id)).length,
    ).toBe(1);
  });

  it("refuses while not completed, partly paid, with an unpaid debit note, with no invoice, or short of the accepted total", async () => {
    const cases: [string, (f: Fixture) => Promise<void>][] = [
      [
        "active",
        async (f) => {
          await run("UPDATE projects SET status = 'active' WHERE id = ?", f.projectId);
          await mkDoc(f.clientId, f.projectId, { paid: 100_000 });
        },
      ],
      [
        "partial",
        async (f) => {
          await mkDoc(f.clientId, f.projectId, { paid: 60_000 });
        },
      ],
      [
        "debit note due",
        async (f) => {
          const inv = await mkDoc(f.clientId, f.projectId, { paid: 100_000 });
          await mkDoc(f.clientId, f.projectId, { type: "debit_note", total: 5_000, parentId: inv });
        },
      ],
      ["none", async () => {}],
      [
        "short",
        async (f) => {
          await mkDoc(f.clientId, f.projectId, { total: 80_000, paid: 80_000 });
        },
      ],
    ];
    for (const [name, setup] of cases) {
      const f = await mkProject();
      await setup(f);
      await draft({ projectId: f.projectId });
      expect(await deedOf(f.projectId), name).toBeNull();
    }
  });

  it("a credit note lowers the target (owner, 2026-11-01); a project credited in full gets none (decision (a)); TDS counts as settled money", async () => {
    // A discount by credit note, the rest paid: a deed.
    const discount = await mkProject();
    await mkDoc(discount.clientId, discount.projectId, { paid: 80_000, credited: 20_000 });
    await draft({ projectId: discount.projectId });
    expect((await deedOf(discount.projectId))?.status).toBe("draft");
    expect(await first(deedFactsSql("?1"), discount.projectId)).toMatchObject({
      settled: 80_000,
      credited: 20_000,
    });

    // Short of the lowered target: none.
    const short = await mkProject();
    await mkDoc(short.clientId, short.projectId, { paid: 70_000, credited: 20_000 });
    await draft({ projectId: short.projectId });
    expect(await deedOf(short.projectId)).toBeNull();

    // Credited in full, nothing paid: none.
    const full = await mkProject();
    await mkDoc(full.clientId, full.projectId, { credited: 100_000 });
    await draft({ projectId: full.projectId });
    expect(await deedOf(full.projectId)).toBeNull();

    const tds = await mkProject();
    await mkDoc(tds.clientId, tds.projectId, { paid: 90_000, tds: 10_000 });
    await draft({ projectId: tds.projectId });
    expect((await deedOf(tds.projectId))?.status).toBe("draft");
  });

  it("ignores a proforma (its paid amount is the advance batch's) and a voided invoice, and counts every advance invoice's own money once", async () => {
    const f = await mkProject();
    // The proforma of the whole price, converted with all of it received: never counted (not payable).
    const proforma = await mkDoc(f.clientId, f.projectId, { type: "proforma", paid: 100_000 });
    // Two advance invoices against it (parent = the proforma), each settled by its own confirmed payment.
    const owner = f.owner;
    for (const amount of [40_000, 60_000]) {
      const inv = await mkDoc(f.clientId, f.projectId, { total: amount, parentId: proforma });
      const pay = uuidv7();
      await run(
        `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, recorded_by, recorded_at, verified_by, verified_at)
         VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'INR', ?3, '2026-10-28', ?4, ?5, ?4, ?5)`,
        pay,
        f.clientId,
        amount,
        owner,
        T,
      );
      await run(
        "INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_at) VALUES (?1, ?2, ?3, ?4, 'allocate', ?5)",
        uuidv7(),
        pay,
        inv,
        amount,
        T,
      );
      await recomputeStatement(db(), { documentIds: [inv] }, Date.now()).run();
    }
    // A voided invoice of the project with a balance never blocks.
    await mkDoc(f.clientId, f.projectId, { total: 50_000, voided: true });
    const facts = await first<{ payables: number; settled: number; unpaid: number }>(
      deedFactsSql("?1"),
      f.projectId,
    );
    expect(facts).toMatchObject({ payables: 2, settled: 100_000, unpaid: 0 });
    await draft({ projectId: f.projectId });
    expect((await deedOf(f.projectId))?.status).toBe("draft");
  });

  it("USD: only documents in the accepted version's currency count towards its total", async () => {
    const f = await mkProject({ currency: "USD", total: 2_000_00 });
    await mkDoc(f.clientId, f.projectId, {
      currency: "USD",
      total: 2_000_00,
      paid: 2_000_00,
      type: "export_invoice",
    });
    await draft({ projectId: f.projectId });
    expect((await deedOf(f.projectId))?.status).toBe("draft");
  });

  it("never for a care-plan project or an anonymised client", async () => {
    const care = await mkProject({ type: "estimate" });
    await run(
      "INSERT INTO care_plans (id, client_id, tier, currency, price_minor, included_minutes, start_date, billing_day, status, rollover, source_document_id) VALUES (?1, ?2, 'growth', 'INR', 100, 60, '2026-01-05', 5, 'active', 'none', ?3)",
      uuidv7(),
      care.clientId,
      care.quoteId,
    );
    await mkDoc(care.clientId, care.projectId, { paid: 100_000 });
    await draft({ projectId: care.projectId });
    expect(await deedOf(care.projectId)).toBeNull();

    const gone = await mkProject();
    await mkDoc(gone.clientId, gone.projectId, { paid: 100_000 });
    await run("UPDATE clients SET anonymised_at = 9 WHERE id = ?", gone.clientId);
    await draft({ projectId: gone.projectId });
    expect(await deedOf(gone.projectId)).toBeNull();
  });

  it("finds the project through the documents or the payments a ledger batch names, and writes nothing when its guard fails", async () => {
    const byDoc = await mkProject();
    const inv = await mkDoc(byDoc.clientId, byDoc.projectId, { paid: 100_000 });
    await draft({ documentIds: [inv] }, T, { sql: (at) => `?${at} = 0`, params: [1] });
    expect(await deedOf(byDoc.projectId)).toBeNull();
    await draft({ documentIds: [inv] }, T, ALWAYS);
    expect((await deedOf(byDoc.projectId))?.status).toBe("draft");

    const byPay = await mkProject();
    const inv2 = await mkDoc(byPay.clientId, byPay.projectId, { total: 50_000 });
    const pay = uuidv7();
    await run(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, recorded_by, recorded_at, verified_by, verified_at)
       VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'INR', 50000, '2026-10-28', ?3, ?4, ?3, ?4)`,
      pay,
      byPay.clientId,
      byPay.owner,
      T,
    );
    // Short of the accepted 100,000: nothing yet.
    await run(
      "INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_at) VALUES (?1, ?2, ?3, 50000, 'allocate', ?4)",
      uuidv7(),
      pay,
      inv2,
      T,
    );
    await recomputeStatement(db(), { paymentIds: [pay] }, Date.now()).run();
    await draft({ paymentIds: [pay] });
    expect(await deedOf(byPay.projectId)).toBeNull();
    // The rest arrives on a second invoice: the payment named finds the project.
    const inv3 = await mkDoc(byPay.clientId, byPay.projectId, { total: 50_000, paid: 50_000 });
    expect(inv3).toBeTruthy();
    await draft({ paymentIds: [pay] });
    expect((await deedOf(byPay.projectId))?.status).toBe("draft");
  });

  it("after a cancel the automatic hooks make nothing; the Owner's redraft makes one fresh draft (decision (b)); one open deed per project", async () => {
    const fx = await draftDeed();
    const s = await session(fx.owner);
    await cancelDeedStatement(db(), {
      deedId: fx.deed.id,
      expectedUpdatedAt: fx.deed.updated_at,
      now: Date.now(),
      sessionId: s,
      memberId: fx.owner,
      reason: "Not needed",
    }).run();
    await draft({ projectId: fx.projectId }, T + 100);
    const statuses = async () =>
      (
        await all<{ status: string }>(
          "SELECT status FROM deeds WHERE project_id = ? ORDER BY created_at",
          fx.projectId,
        )
      ).map((r) => r.status);
    expect(await statuses()).toEqual(["cancelled"]);
    const redraft = (now: number) =>
      db().batch(deedDraftStatements(db(), { target: { projectId: fx.projectId }, now, redraft: true }));
    await redraft(T + 200);
    expect(await statuses()).toEqual(["cancelled", "draft"]);
    // The fresh draft has its own system audit row and bell.
    const fresh = await first<{ id: string }>(
      "SELECT id FROM deeds WHERE project_id = ? AND status = 'draft'",
      fx.projectId,
    );
    expect(
      (await all("SELECT id FROM audit_log WHERE action = 'deed.draft' AND entity_id = ?", fresh?.id)).length,
    ).toBe(1);
    expect(
      (
        await all(
          "SELECT id FROM notifications WHERE kind = 'deed.draft' AND entity_id = ? AND user_id = ?",
          fresh?.id,
          fx.owner,
        )
      ).length,
    ).toBe(1);
    // A second redraft finds the open draft: nothing new.
    await redraft(T + 300);
    expect(await statuses()).toEqual(["cancelled", "draft"]);
    // The partial unique index holds one open deed per project even against a raw insert.
    await rejects(
      run(
        "INSERT INTO deeds (id, client_id, project_id, source_document_id, status) VALUES (?1, ?2, ?3, ?4, 'draft')",
        uuidv7(),
        fx.clientId,
        fx.projectId,
        fx.quoteId,
      ),
      /UNIQUE|deeds_project_open/,
    );
  });
});

// ---- the triggers ---------------------------------------------------------------------------------------------------------------------------------------

describe("deed_triggers (0062) [L4, L7]", () => {
  it("a deed is born a draft, for its project's accepted source, while the client is live", async () => {
    const fx = await mkProject({ status: "active" });
    const ins = (o: { status?: string; source?: string; client?: string; number?: number | null }) =>
      run(
        "INSERT INTO deeds (id, client_id, project_id, source_document_id, status, number) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        uuidv7(),
        o.client ?? fx.clientId,
        fx.projectId,
        o.source ?? fx.quoteId,
        o.status ?? "draft",
        o.number ?? null,
      );
    await rejects(ins({ status: "final" }), /deeds_insert|deeds_finalised/);
    await rejects(ins({ number: 3 }), /deeds_insert/);
    const other = await mkQuote({ clientId: fx.clientId });
    await rejects(ins({ source: other.id }), /deeds_insert/);
    await rejects(ins({ client: await mkClientRow() }), /deeds_insert/);
    await run("UPDATE clients SET anonymised_at = 9 WHERE id = ?", fx.clientId);
    await rejects(ins({}), /deeds_insert/);
  });

  it("draft to final needs both Schedules filled in; the flow never goes back; signed only from final", async () => {
    const fx = await draftDeed();
    await rejects(run("UPDATE deeds SET status = 'signed' WHERE id = ?", fx.deed.id), /deeds_status_flow/);
    // A blank Schedule refuses the finalise (trigger), even with every other column right.
    await rejects(
      run(
        "UPDATE deeds SET status = 'final', fy = '2627', number = 1, number_display = 'TH/DA/2627/0001', made_on = '2026-11-01', snapshot = '{}', snapshot_sha256 = 'x', finalised_at = 1, finalised_by = ?2, sched_deliverables = 'a', sched_location = 'b', sched_delivered_dates = 'c', sched_tools = '  ', sched_third_party = 'e' WHERE id = ?1",
        fx.deed.id,
        fx.owner,
      ),
      /deeds_finalise_ready/,
    );
    const { changed, row } = await finalise(fx);
    expect(changed).toBe(1);
    expect(row).toMatchObject({
      status: "final",
      number: 1,
      number_display: "TH/DA/2627/0001",
      made_on: "2026-11-01",
    });
    await rejects(run("UPDATE deeds SET status = 'draft' WHERE id = ?", fx.deed.id), /deeds_status_flow/);
    await rejects(
      run(
        "UPDATE deeds SET status = 'cancelled', cancelled_at = 1, cancelled_by = ?2, cancel_reason = 'x' WHERE id = ?1",
        fx.deed.id,
        fx.owner,
      ),
      /deeds_status_flow|deeds_frozen/,
    );
  });

  it("a final deed keeps every frozen column; the PDFs are set once; nothing changes the parties", async () => {
    const fx = await draftDeed();
    await finalise(fx);
    for (const [col, v] of [
      ["sched_tools", "Changed"],
      ["snapshot", '{"a":1}'],
      ["snapshot_sha256", "y"],
      ["number_display", "TH/DA/2627/0009"],
      ["made_on", "2026-11-02"],
    ] as const)
      await rejects(run(`UPDATE deeds SET ${col} = ?2 WHERE id = ?1`, fx.deed.id, v), /deeds_frozen/);
    await rejects(
      run("UPDATE deeds SET project_id = ?2 WHERE id = ?1", fx.deed.id, uuidv7()),
      /deeds_identity_fixed|FOREIGN KEY/,
    );
    await run(
      "UPDATE deeds SET unsigned_r2_key = 'deeds/x/unsigned.pdf', unsigned_sha256 = 'u' WHERE id = ?",
      fx.deed.id,
    );
    await rejects(
      run("UPDATE deeds SET unsigned_r2_key = 'deeds/x/other.pdf' WHERE id = ?", fx.deed.id),
      /deeds_set_once/,
    );
    // The signed copy's columns are written only in the move to signed.
    await rejects(
      run("UPDATE deeds SET signed_r2_key = 'k' WHERE id = ?", fx.deed.id),
      /deeds_set_once|deeds_signed/,
    );
  });

  it("an unsigned PDF is never set on a draft", async () => {
    const fx = await draftDeed();
    await rejects(
      run("UPDATE deeds SET unsigned_r2_key = 'k', unsigned_sha256 = 'u' WHERE id = ?", fx.deed.id),
      /deeds_set_once/,
    );
  });

  it("sign: final to signed with the copy and the eSign details, by an Owner with a fresh code; never twice", async () => {
    const fx = await draftDeed();
    const { row } = await finalise(fx);
    const staff = await mkMember("staff");
    const args = (sessionId: string, memberId: string, expected = row?.updated_at ?? 0) => ({
      deedId: fx.deed.id,
      expectedUpdatedAt: expected,
      now: Date.now() + 1,
      sessionId,
      memberId,
      r2Key: `deeds/${fx.deed.id}/signed-${"a".repeat(64)}`,
      sha256: "a".repeat(64),
      size: 1234,
      esignAt: T,
      esignTxn: "TXN-123",
    });
    expect((await signDeedStatement(db(), args(await session(staff), staff)).run()).meta.changes).toBe(0);
    expect(
      (await signDeedStatement(db(), args(await session(fx.owner, false), fx.owner)).run()).meta.changes,
    ).toBe(0);
    expect(
      (await signDeedStatement(db(), args(await session(fx.owner), fx.owner, 1)).run()).meta.changes,
    ).toBe(0);
    expect((await signDeedStatement(db(), args(await session(fx.owner), fx.owner)).run()).meta.changes).toBe(
      1,
    );
    const signed = await deedOf(fx.projectId);
    expect(signed).toMatchObject({
      status: "signed",
      esign_txn: "TXN-123",
      esign_at: T,
      signed_by: fx.owner,
      signed_size: 1234,
    });
    await rejects(run("UPDATE deeds SET esign_txn = 'OTHER' WHERE id = ?", fx.deed.id), /deeds_set_once/);
    await rejects(run("UPDATE deeds SET status = 'final' WHERE id = ?", fx.deed.id), /deeds_status_flow/);
  });

  it("delete: only a draft or cancelled deed of an anonymised client (L7, early check 5); a final or signed deed stays", async () => {
    const fx = await draftDeed();
    await rejects(run("DELETE FROM deeds WHERE id = ?", fx.deed.id), /deeds_no_delete/);
    // Anonymising the client deletes the draft (the trigger clients_anonymised_draft_deeds runs the allowed delete).
    await run("UPDATE clients SET anonymised_at = 9 WHERE id = ?", fx.clientId);
    expect(await deedOf(fx.projectId)).toBeNull();

    // A cancelled deed holds the Owner's typed reason: it goes too.
    const cancelled = await draftDeed();
    await cancelDeedStatement(db(), {
      deedId: cancelled.deed.id,
      expectedUpdatedAt: cancelled.deed.updated_at,
      now: Date.now(),
      sessionId: await session(cancelled.owner),
      memberId: cancelled.owner,
      reason: "The client asked for none",
    }).run();
    await rejects(run("DELETE FROM deeds WHERE id = ?", cancelled.deed.id), /deeds_no_delete/);
    await run("UPDATE clients SET anonymised_at = 9 WHERE id = ?", cancelled.clientId);
    expect(await all("SELECT id FROM deeds WHERE project_id = ?", cancelled.projectId)).toEqual([]);

    const kept = await draftDeed();
    await finalise(kept);
    await run("UPDATE clients SET anonymised_at = 9 WHERE id = ?", kept.clientId);
    expect((await deedOf(kept.projectId))?.status).toBe("final");
    await rejects(run("DELETE FROM deeds WHERE id = ?", kept.deed.id), /deeds_no_delete/);
  });

  it("anonymising a client deletes its drafts in the same statement (clients_anonymised_draft_deeds); a draft is never finalised for an anonymised client", async () => {
    const fx = await draftDeed();
    await fillSchedules(fx.deed, fx.owner);
    await run("UPDATE clients SET anonymised_at = 9 WHERE id = ?", fx.clientId);
    expect(await deedOf(fx.projectId)).toBeNull();
    // The finalise trigger refuses it even if a draft were left (the delete trigger dropped for this check only).
    const again = await draftDeed();
    await fillSchedules(again.deed, again.owner);
    await run("DROP TRIGGER clients_anonymised_draft_deeds");
    await run("UPDATE clients SET anonymised_at = 9 WHERE id = ?", again.clientId);
    fx.deed = again.deed;
    await rejects(
      run(
        "UPDATE deeds SET status = 'final', fy = '2627', number = 1, number_display = 'TH/DA/2627/0001', made_on = '2026-11-01', snapshot = '{}', snapshot_sha256 = 'x', finalised_at = 1, finalised_by = ?2 WHERE id = ?1",
        fx.deed.id,
        fx.owner,
      ),
      /deeds_finalise_ready/,
    );
  });
});

// ---- finalise, Schedules, cancel ----------------------------------------------------------------------------------------------------------------------

describe("the Owner's and Staff's moves [L1, L4]", () => {
  it("finalise numbers gap-free per FY; a refused finalise takes no number", async () => {
    const a = await draftDeed();
    // No fresh code: nothing written, the counter does not move.
    const refused = await finalise(a, { stepUp: false, fy: "2728" });
    expect(refused.changed).toBe(0);
    expect(refused.row?.status).toBe("draft");
    const counter = await first<{ next_no: number }>(
      "SELECT next_no FROM doc_counters WHERE series = 'deed' AND fy = '2728'",
    );
    expect(counter?.next_no).toBe(1);
    const fresh = await first<DeedRow>(`SELECT ${DEED_COLS} FROM deeds d WHERE d.id = ?1`, a.deed.id);
    const ok = await finalise({ ...a, deed: fresh as DeedRow }, { fy: "2728" });
    expect(ok.row?.number_display).toBe("TH/DA/2728/0001");
    const b = await draftDeed();
    const ok2 = await finalise(b, { fy: "2728" });
    expect(ok2.row?.number_display).toBe("TH/DA/2728/0002");
    expect(
      (
        await first<{ next_no: number }>(
          "SELECT next_no FROM doc_counters WHERE series = 'deed' AND fy = '2728'",
        )
      )?.next_no,
    ).toBe(3);
  });

  it("finalise re-checks full payment: a payment withdrawn since refuses it", async () => {
    const fx = await mkProject();
    const inv = await mkDoc(fx.clientId, fx.projectId, { paid: 100_000 });
    const d = await draftDeed(fx);
    await run(
      "UPDATE documents SET paid_minor = 50000, balance_minor = 50000, status = 'partially_paid' WHERE id = ?",
      inv,
    );
    const res = await finalise(d);
    expect(res.changed).toBe(0);
    expect(res.row?.status).toBe("draft");
  });

  it("early check 7: a document of the project moved between the read and the batch refuses the finalise (the sealed figures would be stale)", async () => {
    const fx = await mkProject();
    const inv = await mkDoc(fx.clientId, fx.projectId, { paid: 100_000 });
    const d = await draftDeed(fx);
    // A credit note lands in between (still eligible: the target drops with it), but the seal was read before it.
    const moved = await finalise(d, {
      beforeBatch: async () => {
        await run(
          "UPDATE documents SET credited_minor = 10000, updated_at = updated_at + 1 WHERE id = ?",
          inv,
        );
      },
    });
    expect(moved.changed).toBe(0);
    expect(moved.row?.status).toBe("draft");
    // A new frozen document of the project (a further invoice issued) moves the count.
    const fresh = await first<DeedRow>(`SELECT ${DEED_COLS} FROM deeds d WHERE d.id = ?1`, d.deed.id);
    const stamp = await docsStamp(fx.projectId);
    const counted = await finalise(
      { ...d, deed: fresh as DeedRow },
      {
        docs: stamp,
        beforeBatch: async () => {
          await mkDoc(fx.clientId, fx.projectId, { total: 1_000, paid: 1_000 });
        },
      },
    );
    expect(counted.changed).toBe(0);
    // Read at the current stamp: it goes through.
    const again = await first<DeedRow>(`SELECT ${DEED_COLS} FROM deeds d WHERE d.id = ?1`, d.deed.id);
    const ok = await finalise({ ...d, deed: again as DeedRow });
    expect(ok.changed).toBe(1);
  });

  it("Schedules: Owner or Staff, a draft only, at the version read", async () => {
    const fx = await draftDeed();
    const sales = await mkMember("staff");
    await run("UPDATE staff_users SET role = 'sales' WHERE id = ?", sales);
    const s = await session(sales);
    const r1 = await deedSchedulesStatement(db(), {
      deedId: fx.deed.id,
      expectedUpdatedAt: fx.deed.updated_at,
      now: Date.now(),
      sessionId: s,
      schedules: SCHEDULES,
    }).run();
    expect(r1.meta.changes).toBe(0);
    const staff = await mkMember("staff");
    const s2 = await session(staff);
    const stale = await deedSchedulesStatement(db(), {
      deedId: fx.deed.id,
      expectedUpdatedAt: 1,
      now: Date.now(),
      sessionId: s2,
      schedules: SCHEDULES,
    }).run();
    expect(stale.meta.changes).toBe(0);
    const ok = await deedSchedulesStatement(db(), {
      deedId: fx.deed.id,
      expectedUpdatedAt: fx.deed.updated_at,
      now: Date.now(),
      sessionId: s2,
      schedules: SCHEDULES,
    }).run();
    expect(ok.meta.changes).toBe(1);
  });

  it("cancel: an Owner, a draft, a reason", async () => {
    const fx = await draftDeed();
    const staff = await mkMember("staff");
    const r = await cancelDeedStatement(db(), {
      deedId: fx.deed.id,
      expectedUpdatedAt: fx.deed.updated_at,
      now: Date.now(),
      sessionId: await session(staff),
      memberId: staff,
      reason: "x",
    }).run();
    expect(r.meta.changes).toBe(0);
    await rejects(
      cancelDeedStatement(db(), {
        deedId: fx.deed.id,
        expectedUpdatedAt: fx.deed.updated_at,
        now: Date.now(),
        sessionId: await session(fx.owner),
        memberId: fx.owner,
        reason: "  ",
      }).run(),
      /deeds_cancel_reason|deeds_cancelled/,
    );
    const ok = await cancelDeedStatement(db(), {
      deedId: fx.deed.id,
      expectedUpdatedAt: fx.deed.updated_at,
      now: Date.now(),
      sessionId: await session(fx.owner),
      memberId: fx.owner,
      reason: "Client asked for none",
    }).run();
    expect(ok.meta.changes).toBe(1);
    await rejects(run("UPDATE deeds SET sched_tools = 'x' WHERE id = ?", fx.deed.id), /deeds_frozen/);
  });

  it("the facts read and the project lookups use the indexes", async () => {
    const plan = await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${deedFactsSql("?1")}`, "x");
    expect(plan.map((p) => p.detail).join("\n")).toMatch(/documents_project/);
    const portal = await all<{ detail: string }>(
      "EXPLAIN QUERY PLAN SELECT id FROM deeds WHERE client_id = ?1 AND source_document_id = ?2 AND status = 'signed'",
      "c",
      "s",
    );
    expect(portal.map((p) => p.detail).join("\n")).toMatch(/deeds_client_source/);
    const byProject = await all<{ detail: string }>(
      "EXPLAIN QUERY PLAN SELECT id FROM deeds WHERE project_id = ?1 ORDER BY created_at DESC LIMIT 11",
      "p",
    );
    expect(byProject.map((p) => p.detail).join("\n")).toMatch(/deeds_project_created/);
    const stamp = await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${DEED_DOCS_STAMP_SQL}`, "p");
    expect(stamp.map((p) => p.detail).join("\n")).toMatch(/documents_project/);
  });
});

// ---- the twin of core (L2) --------------------------------------------------------------------------------------------------------------------------------

describe("deedEligibleSql and deedFactsSql are core deedEligibility's twin [L2]", () => {
  it("the Schedule limits are core's", () => {
    expect(SCHEDULE_LIMITS_DB).toEqual(DEED_SCHEDULE_LIMITS_CORE);
  });

  it("over 40 random projects (seeded), SQL and core agree on eligibility, the settled sum and the counts", async () => {
    let seed = 20261101;
    const rnd = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    // An INR client in India: tax invoices (an export invoice needs an overseas client: the USD test covers it), debit notes, proformas, credit notes.
    const types = ["tax_invoice", "tax_invoice", "debit_note", "proforma", "credit_note"] as const;
    const seen = { yes: 0, no: 0, credited: 0 };
    for (let k = 0; k < 40; k++) {
      // Half the projects have a small accepted total, so a fully paid invoice can reach it (both outcomes are exercised).
      const total = rnd(2) === 0 ? 5_000 + rnd(10_000) : 50_000 + rnd(100_000);
      const fx = await mkProject({ total, status: rnd(5) === 0 ? "active" : "completed" });
      const docs: DeedDocFact[] = [];
      let parent: string | null = null;
      const n = 1 + rnd(3);
      for (let j = 0; j < n; j++) {
        const type = types[rnd(types.length)] as (typeof types)[number];
        const t = 10_000 + rnd(90_000);
        const paid = rnd(2) === 0 ? t : rnd(3) === 0 ? 0 : rnd(t + 1);
        const credited = rnd(7) < 2 ? 1 + rnd(Math.max(1, t - paid)) : 0;
        const tds =
          type === "tax_invoice" && rnd(5) === 0 ? Math.min(t - Math.min(t, paid + credited), rnd(5_000)) : 0;
        const voided = paid === 0 && credited === 0 && tds === 0 && rnd(6) === 0;
        const needsParent = type === "credit_note" || type === "debit_note";
        if (needsParent && parent === null) continue;
        const id = await mkDoc(fx.clientId, fx.projectId, {
          type,
          total: t,
          paid: type === "credit_note" ? 0 : paid,
          credited: type === "credit_note" ? 0 : credited,
          tds,
          voided,
          parentId: needsParent ? parent : null,
        });
        if (type === "tax_invoice" && !voided) parent = id;
        const row = await first<DeedDocFact>(
          "SELECT type, frozen_at IS NOT NULL AS frozen, status, currency, total_minor AS totalMinor, paid_minor AS paidMinor, credited_minor AS creditedMinor, tds_minor AS tdsMinor, balance_minor AS balanceMinor, care_plan_id IS NOT NULL AS carePlan FROM documents WHERE id = ?",
          id,
        );
        if (row) docs.push({ ...row, frozen: Boolean(row.frozen), carePlan: Boolean(row.carePlan) });
      }
      const status =
        (await first<{ status: string }>("SELECT status FROM projects WHERE id = ?", fx.projectId))?.status ??
        "";
      const core = deedEligibility({
        projectStatus: status,
        source: {
          type: "proposal",
          status: "accepted",
          frozen: true,
          sameClient: true,
          currency: "INR",
          totalMinor: total,
        },
        clientAnonymised: false,
        carePlanFromSource: false,
        documents: docs,
      });
      const sqlRow = await first<{ ok: number }>(
        `SELECT ${deedEligibleSql("p")} AS ok FROM projects p WHERE p.id = ?1`,
        fx.projectId,
      );
      const facts = await first<{ settled: number; credited: number; payables: number; unpaid: number }>(
        deedFactsSql("?1"),
        fx.projectId,
      );
      expect(Boolean(sqlRow?.ok), `case ${k}`).toBe(core.eligible);
      seen[core.eligible ? "yes" : "no"]++;
      if (core.creditedMinor > 0) seen.credited++;
      expect(facts?.settled, `case ${k}`).toBe(core.settledMinor);
      expect(facts?.credited, `case ${k}`).toBe(core.creditedMinor);
      expect(facts?.payables).toBe(docs.filter(isLivePayable).length);
      expect(facts?.unpaid).toBe(docs.filter((d) => isLivePayable(d) && d.balanceMinor !== 0).length);
    }
    expect(seen.yes, "some random projects are eligible").toBeGreaterThan(0);
    expect(seen.no).toBeGreaterThan(0);
    expect(seen.credited, "some random projects carry credit notes").toBeGreaterThan(0);
  });
});
