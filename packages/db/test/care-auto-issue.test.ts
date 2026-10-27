// The `care_auto` issue authority [ADM-CARE-02, LD58; VERIFY WITH CA/LEGAL]: the system issues a care invoice with NO session, and every condition that makes that safe
// is in the freeze statement. Each refusal is the post-condition aborting the whole batch: no number burned, nothing changed, the draft left as it was.
import { env } from "cloudflare:workers";
import { defaultFormat, sqlPrintfPattern, uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { type InvoiceIssueArgs, invoiceIssueStatements } from "../src/issue.ts";
import { mkCareDraft, mkCarePlan, mkClientRow, mkMember, type PlanFixture } from "./billing-helpers.ts";
import { first, rejects, run } from "./helpers.ts";
import { nextFy, versions } from "./note-helpers.ts";

const PATTERN = sqlPrintfPattern(defaultFormat("invoice"));

type World = { owner: string; plan: PlanFixture; doc: string; fy: string; clientUpdatedAt: number };

/** An owner who turned the toggle on, a plan whose terms an owner wrote, and the untouched draft the job made for the period starting 2026-11-05. */
async function world(
  o: {
    toggleBy?: "owner" | "none";
    termsBy?: "owner" | "staff";
    draft?: Parameters<typeof mkCareDraft>[1];
    aiOps?: number | null;
    paused?: boolean;
  } = {},
): Promise<World> {
  const owner = await mkMember("owner");
  const staff = await mkMember("staff");
  const clientId = await mkClientRow({ toggleBy: o.toggleBy === "none" ? null : owner });
  const plan = await mkCarePlan(clientId, o.termsBy === "staff" ? staff : owner, {
    aiOps: o.aiOps ?? null,
    status: o.paused ? "paused" : "active",
  });
  const doc = await mkCareDraft(plan, {
    subtotal: 2_000_000 + (o.aiOps ?? 0),
    ...o.draft,
  });
  return { owner, plan, doc, fy: nextFy(), clientUpdatedAt: 5_000 };
}

async function args(w: World, over: Partial<InvoiceIssueArgs> = {}): Promise<InvoiceIssueArgs> {
  const v = await versions();
  return {
    documentId: w.doc,
    type: "tax_invoice",
    series: "invoice",
    fy: w.fy,
    pattern: PATTERN.pattern,
    argOrder: PATTERN.argOrder,
    maxNumber: 9999,
    now: Date.now(),
    issueDate: "2026-11-05",
    dueDate: "2026-11-12",
    recipient: { legalName: "L", country: "IN" },
    issuer: {
      company: {
        tradeName: "T",
        legalName: "L",
        address: "A",
        gstin: null,
        stateCode: "19",
        logo: "logo-primary-color.svg",
      },
      bank: { inr: null },
      signature: null,
      reverseChargeText: "Tax payable on reverse charge: No",
      sender: { staffId: "system", name: "T", email: "billing@example.com" },
    },
    computedJson: "{}",
    snapshotSha256: "s".repeat(64),
    issuedBy: null,
    termsVersionId: null,
    expected: {
      updatedAt: 7_000,
      contentSha256: "h".repeat(64),
      ...v,
      clientUpdatedAt: w.clientUpdatedAt,
      contact: null,
    },
    authority: {
      kind: "care_auto",
      carePlanId: w.plan.planId,
      periodStart: "2026-11-05",
      termsId: w.plan.termsId,
    },
    bell: { clientName: "D", linkPrefix: "/invoices/" },
    ...over,
  };
}

const counter = async (fy: string) =>
  (
    await first<{ next_no: number }>(
      "SELECT next_no FROM doc_counters WHERE series = 'invoice' AND fy = ?",
      fy,
    )
  )?.next_no ?? null;

async function issue(a: InvoiceIssueArgs) {
  const s = invoiceIssueStatements(env.DB, a);
  return env.DB.batch([...s.main, ...s.postAudit]);
}

/** The batch refused: the post-condition aborted it, no number was burned and the draft is exactly as it was. */
async function refused(w: World, over: Partial<InvoiceIssueArgs> = {}) {
  const before = await counter(w.fy);
  await rejects(issue(await args(w, over)), /issue did not freeze|not an issuable draft/);
  expect(await counter(w.fy)).toBe(before);
  expect(
    await first("SELECT status, frozen_at, number, issued_by FROM documents WHERE id = ?", w.doc),
  ).toEqual({
    status: "draft",
    frozen_at: null,
    number: null,
    issued_by: null,
  });
}

describe("a care invoice is issued with no session when every condition holds", () => {
  it("freezes with the next number, issued_by NULL, the balance at the total; the record of the period stays", async () => {
    const w = await world();
    const results = await issue(await args(w));
    expect(results[3]?.results[0]).toEqual({ number_display: `TH/INV/${w.fy}/0001`, number: 1 });
    expect(
      await first(
        "SELECT status, number_display, issued_by, created_by, balance_minor, total_minor, frozen_at IS NOT NULL AS frozen FROM documents WHERE id = ?",
        w.doc,
      ),
    ).toEqual({
      status: "issued",
      number_display: `TH/INV/${w.fy}/0001`,
      issued_by: null,
      created_by: null,
      balance_minor: 2_000_000,
      total_minor: 2_000_000,
      frozen: 1,
    });
    expect(
      await first(
        "SELECT period_start, document_id FROM care_invoices WHERE care_plan_id = ?",
        w.plan.planId,
      ),
    ).toEqual({ period_start: "2026-11-05", document_id: w.doc });
    expect(await counter(w.fy)).toBe(2);
  });
  it("AI Ops is part of the amount (subtotal = price + AI Ops)", async () => {
    const w = await world({ aiOps: 400_000 });
    await issue(await args(w));
    expect(
      (await first<{ status: string }>("SELECT status FROM documents WHERE id = ?", w.doc))?.status,
    ).toBe("issued");
  });
  it("a second issue of the same document is refused and burns no number", async () => {
    const w = await world();
    await issue(await args(w));
    const before = await counter(w.fy);
    await rejects(issue(await args(w)), /not an issuable draft/);
    expect(await counter(w.fy)).toBe(before);
  });
  it("the statement reads no session; the Owner's reads one (and the Owner's text is the one M5.3 shipped)", () => {
    const rec: { sql: string; values: unknown[] }[] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => {
          rec.push({ sql, values });
          return {};
        },
      }),
    } as unknown as D1Database;
    const base = {
      documentId: "d",
      type: "tax_invoice",
      series: "invoice",
      fy: "2627",
      pattern: "x",
      argOrder: ["fy", "n"],
      maxNumber: 9,
      now: 1,
      issueDate: "2026-11-05",
      dueDate: "2026-11-12",
      recipient: {},
      issuer: {},
      computedJson: "{}",
      snapshotSha256: "s",
      issuedBy: null,
      termsVersionId: null,
      expected: {
        updatedAt: 1,
        contentSha256: "h",
        numberingVersion: 1,
        companyVersion: 1,
        taxVersion: 1,
        paymentTermsVersion: 1,
        bankStamp: 1,
        clientUpdatedAt: 1,
        contact: null,
      },
      bell: { clientName: "C", linkPrefix: "/" },
    };
    invoiceIssueStatements(db, {
      ...base,
      authority: { kind: "care_auto", carePlanId: "p", periodStart: "2026-11-05", termsId: "t" },
    } as unknown as InvoiceIssueArgs);
    const care = rec.find((r) => r.sql.startsWith("UPDATE documents SET series"));
    expect(care?.sql).not.toMatch(/staff_sessions|step_up/);
    expect(care?.sql).toContain("care_auto_issue_by");
    expect(care?.values[23]).toBe("p"); // ?24 the plan
    expect(care?.values.slice(29, 31)).toEqual(["2026-11-05", "t"]); // ?30 the period, ?31 the terms
    expect(care?.values).toHaveLength(31);
    for (const r of rec)
      expect(r.values.length, r.sql.slice(0, 50)).toBe(
        Math.max(0, ...[...r.sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]))),
      );
  });
});

describe("the freeze refuses whatever the Owner did not authorise [LD58]", () => {
  it("the toggle was turned off after the draft was made", async () => {
    const w = await world();
    await run(
      "UPDATE clients SET care_auto_issue = 0, care_auto_issue_by = NULL WHERE id = ?",
      w.plan.clientId,
    );
    await refused(w);
  });
  it("the toggle names nobody (a toggle that predates M5.4): off after the backfill", async () => {
    const w = await world({ toggleBy: "none" });
    await refused(w);
  });
  it("the Owner who turned it on was deactivated or demoted since", async () => {
    const w = await world();
    await mkMember("owner"); // another owner exists, so the last-owner trigger lets this one go
    await run("UPDATE staff_users SET status = 'deactivated' WHERE id = ?", w.owner);
    await refused(w);
    await run("UPDATE staff_users SET status = 'active', role = 'staff' WHERE id = ?", w.owner);
    await refused(w);
  });
  it("Staff wrote the terms the amount comes from", async () => {
    const w = await world({ termsBy: "staff" });
    await refused(w);
  });
  it("the terms row is not the one in force at the period start (a newer row, or another plan's row)", async () => {
    const w = await world();
    await refused(w, {
      authority: {
        kind: "care_auto",
        carePlanId: w.plan.planId,
        periodStart: "2026-11-05",
        termsId: "not-the-row",
      },
    });
    const other = await world();
    await refused(w, {
      authority: {
        kind: "care_auto",
        carePlanId: w.plan.planId,
        periodStart: "2026-11-05",
        termsId: other.plan.termsId,
      },
    });
  });
  it("the plan is paused now, or was paused at the period start", async () => {
    const w = await world({ paused: true });
    await refused(w);
    const x = await world();
    await run(
      "INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at) VALUES (?, ?, 'paused', '2026-11-05', ?, 9000)",
      uuidv7(),
      x.plan.planId,
      x.owner,
    );
    await refused(x); // the mirror is still active: the status AT the period start is what counts too
  });
  it("the draft was edited after the job made it (updated_at moved), or Staff made it (created_by set)", async () => {
    const edited = await world({ draft: { updatedAt: 7_001 } });
    await refused(edited, { expected: { ...(await args(edited)).expected, updatedAt: 7_001 } });
    const staff = await mkMember("staff");
    const byStaff = await world({ draft: { createdBy: staff } });
    await refused(byStaff);
  });
  it("an approval is pending on it", async () => {
    const w = await world();
    await run(
      "INSERT INTO approvals (id, kind, document_id, requested_by, content_sha256, status) VALUES (?, 'issue', ?, ?, ?, 'pending')",
      uuidv7(),
      w.doc,
      w.owner,
      "h".repeat(64),
    );
    await refused(w);
  });
  it("the amount is not the terms' price: another subtotal, or a discount", async () => {
    await refused(await world({ draft: { subtotal: 1_999_999 } }));
    await refused(await world({ draft: { discount: 1 } }));
    await refused(await world({ aiOps: 400_000, draft: { subtotal: 2_000_000 } })); // AI Ops left out
  });
  it("the draft carries overage (a draft with overage is never issued automatically)", async () => {
    await refused(await world({ draft: { overage: 45 } }));
  });
  it("the period is not the one recorded for this document and plan, or the plan moved on to a later period", async () => {
    const w = await world();
    await refused(w, {
      authority: {
        kind: "care_auto",
        carePlanId: w.plan.planId,
        periodStart: "2026-10-05",
        termsId: w.plan.termsId,
      },
    });
    const later = await world();
    await run("UPDATE care_plans SET last_billed_period = '2026-12-05' WHERE id = ?", later.plan.planId);
    await refused(later);
  });
  it("a forged call: another plan's id, a hand-made draft with no record, or another document of the plan", async () => {
    const w = await world();
    const other = await world();
    await refused(w, {
      authority: {
        kind: "care_auto",
        carePlanId: other.plan.planId,
        periodStart: "2026-11-05",
        termsId: w.plan.termsId,
      },
    });
    // a hand-made draft on the same plan: no care_invoices row names it
    const handMade = uuidv7();
    await run(
      "INSERT INTO documents (id, type, status, client_id, care_plan_id, currency, subtotal_minor, discount_minor, taxable_minor, total_minor, content_sha256, created_at, updated_at) VALUES (?, 'tax_invoice', 'draft', ?, ?, 'INR', 2000000, 0, 2000000, 2000000, ?, 7000, 7000)",
      handMade,
      w.plan.clientId,
      w.plan.planId,
      "h".repeat(64),
    );
    const f: World = { ...w, doc: handMade };
    await refused(f);
    // a draft of another client under this plan's id
    const another = await mkClientRow();
    const foreign = uuidv7();
    await run(
      "INSERT INTO documents (id, type, status, client_id, currency, subtotal_minor, discount_minor, taxable_minor, total_minor, content_sha256, created_at, updated_at) VALUES (?, 'tax_invoice', 'draft', ?, 'INR', 2000000, 0, 2000000, 2000000, ?, 7000, 7000)",
      foreign,
      another,
      "h".repeat(64),
    );
    await refused({ ...w, doc: foreign });
  });
  it("the settings, the client or the content moved since the read (the checks every issue has)", async () => {
    const w = await world();
    const a = await args(w);
    await refused(w, { expected: { ...a.expected, contentSha256: "z".repeat(64) } });
    await refused(w, { expected: { ...a.expected, clientUpdatedAt: 1 } });
    await refused(w, { expected: { ...a.expected, updatedAt: 1 } });
    await refused(w, { type: "export_invoice" });
  });
  it("the client was anonymised in between", async () => {
    const w = await world();
    await run("UPDATE clients SET anonymised_at = 5 WHERE id = ?", w.plan.clientId);
    await refused(w, { expected: { ...(await args(w)).expected } });
  });
});

describe("the post-audit statements of an automatic issue stay no-ops", () => {
  it("no approval is decided, no bell is written for a requester, no milestone moves", async () => {
    const w = await world();
    const bells = (await first<{ n: number }>("SELECT count(*) AS n FROM notifications"))?.n;
    await issue(await args(w));
    expect((await first<{ n: number }>("SELECT count(*) AS n FROM notifications"))?.n).toBe(bells);
    expect(
      (await first<{ n: number }>("SELECT count(*) AS n FROM approvals WHERE document_id = ?", w.doc))?.n,
    ).toBe(0);
  });
});
