// M5.3 over the API [ADM-INV-11, ADM-INV-01 "Debit Note", ADM-APR-01/02; LD38..LD54; Researched 2026-10-28, s.34(3) CGST Act, Rule 53 (08-C RA-22) for every rule]: credit and debit note drafts against an issued invoice, their issue
// through the M5.1 pipeline (Owner with a fresh code, Staff asks, Owner approves), the creditable cap, the deadline, the parent's ledger in the same batch, the seal, the IMS answer, void,
// roles and the anonymised client.
import { env } from "cloudflare:workers";
import { fyOf } from "@techaust/core/dates";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import {
  type DocumentBundle,
  invoiceContentHashOfBundle,
  invoiceSealOf,
  invoiceSealPartsOfBundle,
  loadDocument,
  type TermsRef,
  verifyInvoiceSealed,
} from "@techaust/db/documents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, one, sessionFor } from "./test-helpers.ts";
import { currentFy, lutOf, mkProforma, putSwiftBank, putTax } from "./test-invoice-types.ts";
import {
  auditCount,
  codeOf,
  decideApproval,
  farSession,
  getInvoice,
  invoiceCounter,
  issueInvoice,
  type J,
  json,
  mkInvoice,
  mkInvoiceClient,
  mkOverseasClient,
  putBank,
  putCompany,
  requestIssue,
  voidInvoice,
} from "./test-invoices.ts";
import {
  creditNoteCounter,
  docCount,
  draftCredit,
  draftDebit,
  issueCredit,
  issueDebit,
  mkIssuedInvoice,
  mkRegisteredClient,
  noteRow,
  parentRow,
  stampOf,
} from "./test-notes.ts";
import { beforeBatchHolding } from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });
const ctxOf = () => ({ tax: SETTINGS_DEFAULTS.tax, supplierStateCode: "19" as const, luts: [] });
void ctxOf;

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
});
afterEach(() => vi.useRealTimers());

const blockersOf = async (res: Response) => ((await json(res)).blockers ?? []) as J[];
const sealOf = async (id: string) => {
  const bundle = (await loadDocument(env.DB, id)) as DocumentBundle<TermsRef>;
  return { bundle, check: await verifyInvoiceSealed(bundle) };
};

// ---- a credit note: draft, issue, ledger -----------------------------------------------------------------------------------------------------------

describe("a credit note: draft, issue, ledger [ADM-INV-11, LD38, LD41]", () => {
  it("lines mode: the draft, the issue, the numbering, the parent's ledger, the seal", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000, 50_000] });
    const res = await draftCredit(o, inv.id, {
      mode: "lines",
      lines: [{ line: 0, taxableMinor: 30_000 }],
      reasonCode: "price_correction",
      reasonText: "Agreed discount",
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const made = await json(res);
    expect(made.type).toBe("credit_note");
    expect(made.preview.totals.taxableMinor).toBe(30_000);
    const draft = await noteRow(made.id);
    expect(draft).toMatchObject({
      type: "credit_note",
      status: "draft",
      parent_id: inv.id,
      number_display: null,
    });
    const view = await getInvoice(o, made.id);
    expect(view.blockers).toEqual([]);
    expect(view.issue.canIssue).toBe(true);
    expect(view.noteOf.request.takes).toEqual([{ line: 0, taxableMinor: 30_000 }]);
    expect(view.noteOf.reason).toEqual({ code: "price_correction", text: "Agreed discount" });
    expect(view.parentLink).toMatchObject({ id: inv.id, number: inv.number });
    // the invoice's facts as M5.5 reads them (LD53): its frozen recipient always carries the GST status (recipientOf writes it on every invoice)
    expect(view.noteOf.parent).toMatchObject({
      id: inv.id,
      type: "tax_invoice",
      number: inv.number,
      recipientStatus: "unregistered",
      supplyType: "intra",
      placeOfSupplyCode: "19",
      totalMinor: inv.total,
      totalInrMinor: inv.total,
    });
    expect(view.dueDatePreview).toBeNull();
    const issued = await issueInvoice(o, made.id);
    expect(issued.status, await issued.clone().text()).toBe(200);
    const b = await json(issued);
    expect(b.number).toMatch(/^TH\/CN\/\d{4}\/\d{4}$/);
    expect(b.dueDate).toBeNull();
    const row = await noteRow(made.id);
    expect(row).toMatchObject({
      status: "issued",
      balance_minor: 0,
      due_date: null,
      ims_status: "not_applicable",
    });
    const parent = await parentRow(inv.id);
    expect(parent).toMatchObject({ status: "partially_credited", credited_minor: row?.total_minor });
    expect(parent?.balance_minor).toBe(inv.total - Number(row?.total_minor));
    expect(b.parent).toMatchObject({
      id: inv.id,
      status: "partially_credited",
      creditedMinor: row?.total_minor,
    });
    const { bundle, check } = await sealOf(made.id);
    expect(check).toEqual({ content: true, snapshot: true });
    expect(await invoiceContentHashOfBundle(bundle)).toBe(row?.content_sha256);
    expect(await auditCount("invoice.note_create", made.id)).toBe(1);
    expect(await auditCount("invoice.issue", made.id)).toBe(1);
    // the audit rows hold no reason text
    const audits = await env.DB.prepare("SELECT summary FROM audit_log WHERE entity_id = ?")
      .bind(made.id)
      .all<{ summary: string }>();
    for (const a of audits.results) expect(a.summary).not.toContain("Agreed discount");
  });

  it("the invoice view lists the notes, what can still be credited, the deadline and the actions", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000, 50_000] });
    const before = await getInvoice(o, inv.id);
    expect(before.creditable.totalLeftMinor).toBe(inv.total);
    expect(before.creditable.lines.map((l: J) => [l.line, l.position, l.taxableLeftMinor])).toEqual([
      [0, 1, 100_000],
      [1, 2, 50_000],
    ]);
    expect(before.creditable.lines[0].grossLeftMinor).toBe(118_000);
    expect(before.actions).toEqual({
      credit: { allowed: true, reasons: [] },
      debit: { allowed: true, reasons: [] },
      // M5.4 (added on purpose): the send action joins the note actions
      send: { allowed: true, reasons: [] },
    });
    expect(before.creditDeadline).toMatchObject({ basis: "cutoff", passed: false });
    expect(before.creditDeadline.date).toMatch(/^\d{4}-11-30$/);
    const cn = await issueCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 10_000 }] });
    const dn = await issueDebit(o, inv.id, { lines: [{ line: 1, taxableMinor: 5_000 }] });
    const draft = await draftCredit(o, inv.id, { mode: "full" });
    const after = await getInvoice(o, inv.id);
    expect(after.notes.credit.map((r: J) => r.id)).toEqual([cn.id]);
    expect(after.notes.debit.map((r: J) => r.id)).toEqual([dn.id]);
    expect(after.notes.drafts).toEqual({ credit: (await json(draft)).id, debit: null });
    expect(after.actions.credit).toEqual({ allowed: false, reasons: ["note_draft_exists"] });
    expect(after.creditable.lines[0].taxableLeftMinor).toBe(90_000);
    expect(after.refundDueMinor).toBe(0);
  });

  it("amount mode is GST included: the note's total is at most what was typed, within one rupee, and the takes are stored", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000, 50_000] });
    expect(inv.total).toBe(177_000);
    for (const gross of [59_000, 100, 12_345, 176_999]) {
      const res = await draftCredit(o, inv.id, { mode: "amount", grossMinor: gross });
      expect(res.status, `${gross}: ${await res.clone().text()}`).toBe(201);
      const b = await json(res);
      expect(b.totalMinor).toBeLessThanOrEqual(gross);
      expect(gross - b.totalMinor).toBeLessThanOrEqual(100);
      expect(b.request.mode).toBe("amount");
      expect(b.request.grossMinor).toBe(gross);
      expect(b.request.takes.length).toBeGreaterThan(0);
      // discard the draft (one open draft per invoice and kind)
      const doc = await getInvoice(o, b.id);
      expect(
        (
          await call(`/invoices/${b.id}?expectedUpdatedAt=${doc.updatedAt}`, {
            method: "DELETE",
            cookie: o.cookie,
          })
        ).status,
      ).toBe(200);
    }
  });

  it("full mode takes everything that is left: the total equals the invoice's, the invoice ends credited", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000, 50_000] });
    const first = await issueCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 40_000 }] });
    const rest = await issueCredit(o, inv.id, { mode: "full" });
    const a = await noteRow(first.id);
    const b = await noteRow(rest.id);
    expect(Number(a?.total_minor) + Number(b?.total_minor)).toBe(inv.total);
    expect(await parentRow(inv.id)).toMatchObject({
      status: "credited",
      credited_minor: inv.total,
      balance_minor: 0,
    });
    expect((await draftCredit(o, inv.id, { mode: "full" })).status).toBe(409);
    expect(await codeOf(await draftCredit(o, inv.id, { mode: "full" }))).toBe("parent_fully_credited");
    // a debit note on it has its own code (its wording is the owner's: a placeholder until then)
    const debit = await draftDebit(o, inv.id, { lines: [{ line: 0, taxableMinor: 100 }] });
    expect(debit.status).toBe(409);
    expect(await codeOf(debit)).toBe("debit_parent_fully_credited");
    expect((await getInvoice(o, inv.id)).actions.debit.reasons).toContain("debit_parent_fully_credited");
  });
});

// ---- the cap ---------------------------------------------------------------------------------------------------------------------------------------

describe("the creditable amount cannot be exceeded [docs/09 :106, LD40]", () => {
  it("one line above its remainder is line_credit_exceeds with the remainder; more than the invoice is credit_exceeds_remaining; nothing is written", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000, 50_000] });
    const rows = await docCount();
    const audits = await auditCount("invoice.note_create");
    const line = await draftCredit(o, inv.id, { mode: "lines", lines: [{ line: 1, taxableMinor: 50_001 }] });
    expect(line.status).toBe(409);
    const lb = await json(line);
    expect(lb.error.code).toBe("line_credit_exceeds");
    expect(lb.line).toBe(1);
    expect(lb.remaining).toBe(50_000);
    const over = await draftCredit(o, inv.id, { mode: "amount", grossMinor: inv.total + 1 });
    expect(over.status).toBe(409);
    const ob = await json(over);
    expect(ob.error.code).toBe("credit_exceeds_remaining");
    expect(ob.remaining).toBe(inv.total);
    expect(await docCount()).toBe(rows);
    expect(await auditCount("invoice.note_create")).toBe(audits);
    // after 60 % is credited, the remainders follow
    await issueCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 60_000 }] });
    const left = await draftCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 40_001 }] });
    expect((await json(left)).remaining).toBe(40_000);
    const stillOver = await draftCredit(o, inv.id, { mode: "amount", grossMinor: inv.total });
    expect((await json(stillOver)).remaining).toBe(
      inv.total - Number((await noteRowOfParent(inv.id))?.total_minor),
    );
  });

  it("nothing chosen, an amount too small to credit, a line the invoice does not have: 400", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    expect((await draftCredit(o, inv.id, { mode: "lines", lines: [] })).status).toBe(400);
    expect((await draftCredit(o, inv.id, { mode: "amount", grossMinor: 0 })).status).toBe(400);
    expect(await codeOf(await draftCredit(o, inv.id, { mode: "amount", grossMinor: 1 }))).toBe(
      "credit_amount_unfit",
    );
    expect(
      (await draftCredit(o, inv.id, { mode: "lines", lines: [{ line: 7, taxableMinor: 5 }] })).status,
    ).toBe(400);
    expect(
      (
        await draftCredit(o, inv.id, {
          mode: "lines",
          lines: [
            { line: 0, taxableMinor: 5 },
            { line: 0, taxableMinor: 6 },
          ],
        })
      ).status,
    ).toBe(400);
    // the mode names what it needs
    expect(
      (await draftCredit(o, inv.id, { mode: "amount", lines: [{ line: 0, taxableMinor: 5 }] })).status,
    ).toBe(400);
    expect((await draftCredit(o, inv.id, { mode: "full", grossMinor: 5 })).status).toBe(400);
    // never in a request: a type, a status, a hash, trustRates, the supply
    for (const extra of [
      { type: "tax_invoice" },
      { status: "issued" },
      { trustRates: true },
      { supply: {} },
      { contentSha256: "a" },
    ]) {
      expect((await draftCredit(o, inv.id, { mode: "full", ...extra })).status, JSON.stringify(extra)).toBe(
        400,
      );
    }
  });

  it("a note for a line the invoice does not exceed, issued when another note took part of it meanwhile: refused as content_changed (the figures are worked out again)", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const a = await draftCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 60_000 }] });
    const aId = (await json(a)).id as string;
    // another credit note takes 60 % by SQL (a second one issued elsewhere): the parent moved
    await env.DB.prepare(
      "UPDATE documents SET credited_minor = 70800, balance_minor = balance_minor - 70800, updated_at = updated_at + 1 WHERE id = ?",
    )
      .bind(inv.id)
      .run();
    const res = await issueInvoice(o, aId);
    expect(res.status).toBe(409);
    expect((await noteRow(aId))?.status).toBe("draft");
  });

  it("another note issued between the read and the batch: 409 parent_changed; the counter, the audit log and the invoice are unchanged", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const a = await json(
      await draftCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 60_000 }] }),
    );
    const stamp = await parentRow(inv.id);
    const counter = await creditNoteCounter(
      inv.id ? ((await one<{ fy: string }>("SELECT fy FROM documents WHERE id = ?", inv.id))?.fy ?? "") : "",
    );
    const audits = await auditCount("invoice.issue");
    const res = await call(
      `/invoices/${a.id}/issue`,
      { cookie: o.cookie, body: await issueBodyOfNote(a.id) },
      beforeBatchHolding("issue_guard", async () => {
        // a credit note issued by SQL meanwhile: the invoice's ledger moved
        await env.DB.prepare(
          "UPDATE documents SET credited_minor = 5, balance_minor = balance_minor - 5, updated_at = updated_at + 1 WHERE id = ?",
        )
          .bind(inv.id)
          .run();
      }),
    );
    expect(res.status, await res.clone().text()).toBe(409);
    expect(await codeOf(res)).toBe("parent_changed");
    expect((await noteRow(a.id))?.status).toBe("draft");
    expect(await auditCount("invoice.issue")).toBe(audits);
    const fy = (await one<{ fy: string }>("SELECT fy FROM documents WHERE id = ?", inv.id))?.fy ?? "";
    expect(await creditNoteCounter(fy)).toBe(counter);
    expect((await parentRow(inv.id))?.credited_minor).toBe(5);
    expect(stamp?.status).toBe("issued");
  });

  it("two parallel issues of one draft: exactly one issues, one number is taken", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const a = await json(await draftCredit(o, inv.id, { mode: "full" }));
    const body = await issueBodyOfNote(a.id);
    const fy = (await one<{ fy: string }>("SELECT fy FROM documents WHERE id = ?", inv.id))?.fy ?? "";
    const before = (await creditNoteCounter(fy)) ?? 1;
    const [r1, r2] = await Promise.all([
      call(`/invoices/${a.id}/issue`, { cookie: o.cookie, body }),
      call(`/invoices/${a.id}/issue`, { cookie: o.cookie, body }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await creditNoteCounter(fy)).toBe(before + 1);
  });

  it("the 21st note of a kind is 409 notes_limit", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000_000] });
    for (let i = 0; i < 20; i++)
      await issueCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 1_000 }] });
    const res = await draftCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 1_000 }] });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("notes_limit");
    const view = await getInvoice(o, inv.id);
    expect(view.actions.credit.reasons).toContain("notes_limit");
    expect(view.notes.credit.length).toBe(20);
    // the other kind has its own limit
    expect((await draftDebit(o, inv.id, { lines: [{ line: 0, taxableMinor: 1_000 }] })).status).toBe(201);
  }, 120_000);

  it("one open draft per invoice and kind: a second is 409 note_draft_exists with the draft's id; the other kind is separate; after the issue the slot is free", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const a = await json(await draftCredit(o, inv.id, { mode: "full" }));
    const again = await draftCredit(o, inv.id, { mode: "full" });
    expect(again.status).toBe(409);
    const ab = await json(again);
    expect(ab.error.code).toBe("note_draft_exists");
    expect(ab.draftId).toBe(a.id);
    expect((await draftDebit(o, inv.id, { lines: [{ line: 0, taxableMinor: 100 }] })).status).toBe(201);
    expect((await issueInvoice(o, a.id)).status).toBe(200);
  });
});

async function noteRowOfParent(parentId: string) {
  return one<{ total_minor: number }>(
    "SELECT total_minor FROM documents WHERE parent_id = ? AND type = 'credit_note' AND frozen_at IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    parentId,
  );
}
async function issueBodyOfNote(id: string) {
  const r = await one<{ updated_at: number; content_sha256: string }>(
    "SELECT updated_at, content_sha256 FROM documents WHERE id = ?",
    id,
  );
  return { expectedUpdatedAt: r?.updated_at, expectedContentSha256: r?.content_sha256 };
}

// ---- the deadline ----------------------------------------------------------------------------------------------------------------------------------

describe("the deadline of a credit note [s.34(2), Q32, Q33; Researched 2026-10-28, s.34(2) CGST Act (08-C RA-03)]", () => {
  /** The calendar year the supply FY of an invoice ends in: the deadline is 30 November of it. */
  const deadlineYear = async (id: string) =>
    2000 +
    Number(((await one<{ fy: string }>("SELECT fy FROM documents WHERE id = ?", id))?.fy ?? "").slice(2));

  it("the last instant of the deadline day (IST) issues; the first instant after it is 409 credit_deadline_passed with the date; nothing changes", async () => {
    const o = await farSession("owner");
    const inv = await mkIssuedInvoice(o, { prices: [100_000, 50_000] });
    const year = await deadlineYear(inv.id);
    const a = await json(
      await draftCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 10_000 }] }),
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${year}-12-01T00:00:00.000+05:30`));
    const late = await issueInvoice(o, a.id);
    expect(late.status, await late.clone().text()).toBe(409);
    const lb = await json(late);
    expect(lb.blockers).toEqual([{ code: "credit_deadline_passed", date: `${year}-11-30` }]);
    expect((await noteRow(a.id))?.status).toBe("draft");
    // a draft past the deadline is refused too
    vi.setSystemTime(new Date(`${year}-12-01T00:00:00.000+05:30`));
    await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(a.id).run();
    const refused = await draftCredit(o, inv.id, { mode: "full" });
    expect(refused.status).toBe(409);
    const rb = await json(refused);
    expect(rb.error.code).toBe("credit_deadline_passed");
    expect(rb.date).toBe(`${year}-11-30`);
    // the draft is made at noon and issued at the last millisecond of the day (an issue is never stamped before its draft: `now` is at least the draft's stamp + 1)
    vi.setSystemTime(new Date(`${year}-11-30T12:00:00.000+05:30`));
    const ok = await draftCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 10_000 }] });
    expect(ok.status, await ok.clone().text()).toBe(201);
    vi.setSystemTime(new Date(`${year}-11-30T23:59:59.999+05:30`));
    const issued = await issueInvoice(o, (await json(ok)).id);
    expect(issued.status, await issued.clone().text()).toBe(200);
    // the view says so
    const view = await getInvoice(o, inv.id);
    expect(view.creditDeadline).toMatchObject({
      date: `${year}-11-30`,
      passed: false,
      daysLeft: 0,
      // RA-31 (07-T §4): the banner warns from 1 October of the deadline year and advises 31 October; the block is unchanged
      deadlineWarnFrom: `${year}-10-01`,
      adviseIssueBy: `${year}-10-31`,
    });
    vi.setSystemTime(new Date(`${year}-12-01T00:00:00.000+05:30`));
    const after = await getInvoice(o, inv.id);
    expect(after.creditDeadline).toMatchObject({ passed: true });
    expect(after.actions.credit.reasons).toContain("credit_deadline_passed");
    // a debit note has no deadline
    expect((await draftDebit(o, inv.id, { lines: [{ line: 0, taxableMinor: 500 }] })).status).toBe(201);
  });

  it("the annual return (Q33): the day before it was filed issues, the day it was filed is refused; a return saved between the read and the batch is 409 settings_changed", async () => {
    const o = await farSession("owner");
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const year = await deadlineYear(inv.id);
    const fy = (await one<{ fy: string }>("SELECT fy FROM documents WHERE id = ?", inv.id))?.fy ?? "";
    const a = await json(
      await draftCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 10_000 }] }),
    );
    await putTax({ luts: [lutOf(currentFy())], annualReturnsFiled: [{ fy, filedOn: `${year}-09-20` }] });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${year}-09-20T00:00:00.000+05:30`));
    const filedDay = await issueInvoice(o, a.id);
    expect(filedDay.status).toBe(409);
    expect(await blockersOf(filedDay)).toEqual([{ code: "credit_deadline_passed", date: `${year}-09-19` }]);
    vi.setSystemTime(new Date(`${year}-09-19T12:00:00.000+05:30`));
    // saved between the read and the batch
    const changed = await call(
      `/invoices/${a.id}/issue`,
      { cookie: o.cookie, body: await issueBodyOfNote(a.id) },
      beforeBatchHolding("issue_guard", async () => {
        await putTax({ luts: [lutOf(currentFy())], annualReturnsFiled: [{ fy, filedOn: `${year}-09-19` }] });
      }),
    );
    expect(await codeOf(changed)).toBe("settings_changed");
    await putTax({ luts: [lutOf(currentFy())], annualReturnsFiled: [{ fy, filedOn: `${year}-09-20` }] });
    expect((await issueInvoice(o, a.id)).status).toBe(200);
  });

  it("the advice dates follow the cutoff setting and an earlier annual return (review 2026-10-28, finding 7)", async () => {
    const o = await owner();
    await putTax({ luts: [lutOf(currentFy())], creditNoteCutoff: { month: 6, day: 30 } });
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const year = await deadlineYear(inv.id);
    // a 30 June cutoff: the warning from 1 May, the advice 31 May
    expect((await getInvoice(o, inv.id)).creditDeadline).toMatchObject({
      date: `${year}-06-30`,
      deadlineWarnFrom: `${year}-05-01`,
      adviseIssueBy: `${year}-05-31`,
    });
    // an annual return filed on 20 May: nothing is advised for after the day before it
    const fy = (await one<{ fy: string }>("SELECT fy FROM documents WHERE id = ?", inv.id))?.fy ?? "";
    await putTax({
      luts: [lutOf(currentFy())],
      creditNoteCutoff: { month: 6, day: 30 },
      annualReturnsFiled: [{ fy, filedOn: `${year}-05-20` }],
    });
    expect((await getInvoice(o, inv.id)).creditDeadline).toMatchObject({
      lastDay: `${year}-05-19`,
      deadlineWarnFrom: `${year}-05-01`,
      adviseIssueBy: `${year}-05-19`,
    });
  });

  it("the cutoff is a setting and a day past the month's end is clamped; the service date moves the supply FY earlier (Q32)", async () => {
    const o = await owner();
    await putTax({ luts: [lutOf(currentFy())], creditNoteCutoff: { month: 11, day: 31 } });
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const year = await deadlineYear(inv.id);
    expect((await getInvoice(o, inv.id)).creditDeadline).toMatchObject({ date: `${year}-11-30` });
    // a service completed more than 30 days before the invoice: the supply is in the earlier FY, and so is the deadline
    const doc = await getInvoice(o, inv.id);
    const done = await call(`/invoices/${inv.id}/service-completed`, {
      method: "POST",
      cookie: o.cookie,
      body: { expectedUpdatedAt: doc.updatedAt, date: `${year - 2}-01-10` },
    });
    expect(done.status, await done.clone().text()).toBe(200);
    const moved = (await getInvoice(o, inv.id)).creditDeadline;
    expect(moved.supplyFy).toBe(`${String(year - 3).slice(2)}${String(year - 2).slice(2)}`);
    expect(moved.date).toBe(`${year - 2}-11-30`);
    expect(moved.passed).toBe(true);
    expect(await codeOf(await draftCredit(o, inv.id, { mode: "full" }))).toBe("credit_deadline_passed");
  });

  it("the tax setting: annual_return_future is 400; a past day saves and is read back", async () => {
    const o = await owner();
    const get = await json(await call("/settings/groups/tax", { cookie: o.cookie }));
    const future = `${new Date().getUTCFullYear() + 2}-09-20`;
    const fy = currentFy();
    const bad = await call("/settings/groups/tax", {
      method: "PUT",
      cookie: o.cookie,
      body: {
        version: get.version,
        value: { ...get.value, annualReturnsFiled: [{ fy: "2526", filedOn: future }] },
      },
    });
    expect(bad.status).toBe(400);
    expect(await codeOf(bad)).toBe("annual_return_future");
    const ok = await call("/settings/groups/tax", {
      method: "PUT",
      cookie: o.cookie,
      body: {
        version: get.version,
        value: { ...get.value, annualReturnsFiled: [{ fy: "2526", filedOn: "2026-06-30" }] },
      },
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(
      (await json(await call("/settings/groups/tax", { cookie: o.cookie }))).value.annualReturnsFiled,
    ).toEqual([{ fy: "2526", filedOn: "2026-06-30" }]);
    void fy;
  });
});

// ---- ledger ----------------------------------------------------------------------------------------------------------------------------------------

describe("the ledger moves in the same batch [LD41]", () => {
  it("a paid invoice: a partial credit note keeps it paid with balance 0 and a refund due; the full one makes it credited", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    await env.DB.prepare(
      "UPDATE documents SET status = 'paid', paid_minor = total_minor, balance_minor = 0 WHERE id = ?",
    )
      .bind(inv.id)
      .run();
    const a = await issueCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 30_000 }] });
    const row = await noteRow(a.id);
    expect(await parentRow(inv.id)).toMatchObject({
      status: "paid",
      balance_minor: 0,
      credited_minor: row?.total_minor,
    });
    expect((await getInvoice(o, inv.id)).refundDueMinor).toBe(row?.total_minor);
    await issueCredit(o, inv.id, { mode: "full" });
    expect(await parentRow(inv.id)).toMatchObject({
      status: "credited",
      balance_minor: 0,
      credited_minor: inv.total,
    });
    expect((await getInvoice(o, inv.id)).refundDueMinor).toBe(inv.total);
  });

  it("a failing statement after the freeze rolls everything back (500), and the next issue gets the same number", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const a = await json(
      await draftCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 20_000 }] }),
    );
    const fy = (await one<{ fy: string }>("SELECT fy FROM documents WHERE id = ?", inv.id))?.fy ?? "";
    const counter = await creditNoteCounter(fy);
    const audits = await auditCount("invoice.issue");
    await env.DB.prepare(
      "CREATE TRIGGER zz_fail_ledger BEFORE UPDATE OF credited_minor ON documents BEGIN SELECT RAISE(ABORT, 'zz_fail_ledger: injected'); END",
    ).run();
    let failed: Response;
    try {
      failed = await issueInvoice(o, a.id);
    } finally {
      await env.DB.prepare("DROP TRIGGER zz_fail_ledger").run();
    }
    expect(failed.status).toBe(500);
    expect((await noteRow(a.id))?.status).toBe("draft");
    expect(await parentRow(inv.id)).toMatchObject({ status: "issued", credited_minor: 0 });
    expect(await creditNoteCounter(fy)).toBe(counter);
    expect(await auditCount("invoice.issue")).toBe(audits);
    const ok = await issueInvoice(o, a.id);
    expect(ok.status).toBe(200);
    // the same number the failed issue would have taken: no gap
    expect((await json(ok)).number).toBe(`TH/CN/${fy}/${String(counter ?? 1).padStart(4, "0")}`);
  });
});

// ---- series and FY ---------------------------------------------------------------------------------------------------------------------------------

describe("series and FY [ADM-SET-04, ADM-INV-03]", () => {
  it("TH/CN/{FY}/{N}: the credit note series moves, the invoice series does not; 20 concurrent issues on 20 invoices give consecutive numbers", async () => {
    const o = await owner();
    const fy = currentFy();
    const before = await creditNoteCounter(fy);
    const invoices: string[] = [];
    for (let i = 0; i < 20; i++) invoices.push((await mkIssuedInvoice(o, { prices: [10_000 + i] })).id);
    const invoiceCounterAfterIssues = await invoiceCounter();
    const drafts: string[] = [];
    for (const id of invoices) drafts.push((await json(await draftCredit(o, id, { mode: "full" }))).id);
    const results = await Promise.all(drafts.map(async (id) => issueInvoice(o, id)));
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(200));
    const numbers = (await Promise.all(results.map(async (r) => (await json(r)).number as string))).sort();
    const start = before ?? 1;
    expect(numbers).toEqual(
      Array.from({ length: 20 }, (_, i) => `TH/CN/${fy}/${String(start + i).padStart(4, "0")}`),
    );
    expect(await invoiceCounter()).toBe(invoiceCounterAfterIssues);
    expect(await creditNoteCounter(fy)).toBe(start + 20);
  }, 120_000);

  it("the FY of the number follows the IST day of the issue: 31 March 23:59:59.999 is the old year, 1 April 00:00 the new one", async () => {
    const o = await farSession("owner");
    const a = await mkIssuedInvoice(o, { prices: [100_000] });
    const b = await mkIssuedInvoice(o, { prices: [100_000] });
    const da = await json(await draftCredit(o, a.id, { mode: "full" }));
    const db = await json(await draftCredit(o, b.id, { mode: "full" }));
    const startYear = fyOf(Date.now()).startYear;
    const nextToken = `${String(startYear + 1).slice(2)}${String(startYear + 2).slice(2)}`;
    const nextBefore = (await creditNoteCounter(nextToken)) ?? 1;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${startYear + 1}-03-31T23:59:59.999+05:30`));
    const old = await json(await issueInvoice(o, da.id));
    vi.setSystemTime(new Date(`${startYear + 1}-04-01T00:00:00.000+05:30`));
    const next = await json(await issueInvoice(o, db.id));
    const token = (y: number) => `${String(y).slice(2)}${String(y + 1).slice(2)}`;
    expect(old.fy).toBe(token(startYear));
    expect(old.number).toContain(`TH/CN/${token(startYear)}/`);
    expect(next.fy).toBe(token(startYear + 1));
    expect(next.number).toBe(`TH/CN/${token(startYear + 1)}/${String(nextBefore).padStart(4, "0")}`);
  });
});

// ---- export ----------------------------------------------------------------------------------------------------------------------------------------

describe("export invoices [LD43, LD49; Researched 2026-10-28, s.2(6) IGST Act, Rule 46 (08-C RA-18)]", () => {
  it("a USD invoice under LUT: the credit note has no IGST, the invoice's rate and INR view, and the notes add up exactly in USD and in INR", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000, 50_000], client: mkOverseasClient }); // (a USD price is a tenth of the INR price here: 10,000 and 5,000 cents)
    const parent = await noteRow(inv.id);
    // (no route typed on the draft: the settings' route applies; the column stays empty and the note copies it)
    expect(parent).toMatchObject({ export_mode: null, supply_type: "export_lut" });
    const a = await issueCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 3_333 }] });
    const ra = await noteRow(a.id);
    expect(ra).toMatchObject({
      igst_minor: 0,
      fx_rate_micros: parent?.fx_rate_micros,
      supply_type: "export_lut",
      export_mode: null,
      ims_status: "not_applicable",
    });
    expect(Number(ra?.total_inr_minor)).toBeGreaterThan(0);
    const b = await issueCredit(o, inv.id, { mode: "full" });
    const rb = await noteRow(b.id);
    expect(Number(ra?.total_minor) + Number(rb?.total_minor)).toBe(inv.total);
    const parentRowNow = await one<{ total_inr_minor: number }>(
      "SELECT total_inr_minor FROM documents WHERE id = ?",
      inv.id,
    );
    expect(Number(ra?.total_inr_minor) + Number(rb?.total_inr_minor)).toBe(parentRowNow?.total_inr_minor);
    // the header carries the rate, the seal verifies, the parent is credited
    const { check, bundle } = await sealOf(b.id);
    expect(check).toEqual({ content: true, snapshot: true });
    expect(invoiceSealPartsOfBundle(bundle)?.fx).toMatchObject({ rateMicros: parent?.fx_rate_micros });
    expect(await parentRow(inv.id)).toMatchObject({ status: "credited" });
    // the invoice's LUT is carried on the note (LD53)
    const noteOf = JSON.parse(String(rb?.header_extras)).noteOf;
    expect(noteOf.parent.lut).toMatchObject({ fy: currentFy() });
    expect(noteOf.parent.recipientStatus).toBe("overseas");
  });

  it("IGST paid: a credit note reverses IGST in proportion; a debit note uses the invoice's route and rate", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, {
      prices: [100_000],
      client: mkOverseasClient,
      fields: { exportMode: "igst_paid" },
    });
    const a = await issueCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 4_000 }] });
    const ra = await noteRow(a.id);
    expect(Number(ra?.igst_minor)).toBe(720);
    expect(ra).toMatchObject({ supply_type: "export_igst" });
    const d = await issueDebit(o, inv.id, { lines: [{ line: 0, taxableMinor: 1_000 }] });
    const rd = await noteRow(d.id);
    expect(rd).toMatchObject({
      supply_type: "export_igst",
      igst_minor: 180,
      fx_rate_micros: (await noteRow(inv.id))?.fx_rate_micros,
      export_mode: "igst_paid",
    });
    expect(Number(rd?.total_inr_minor)).toBeGreaterThan(0);
  });
});

// ---- the debit note --------------------------------------------------------------------------------------------------------------------------------

describe("a debit note [LD42, LD43, Q30, s.34(3)]", () => {
  it("TH/DN/…: its own payable (balance = total, due by the client's terms), the invoice unchanged, the invoice's supply and rate", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, {
      prices: [100_000],
      client: () => mkInvoiceClient({ state_code: "27" }),
    });
    const before = await parentRow(inv.id);
    const dn = await issueDebit(o, inv.id, {
      lines: [{ line: 0, taxableMinor: 20_000 }],
      reasonCode: "other",
      reasonText: "Extra work agreed",
    });
    const row = await noteRow(dn.id);
    expect(dn.issued.number).toMatch(/^TH\/DN\/\d{4}\/\d{4}$/);
    expect(row).toMatchObject({
      status: "issued",
      balance_minor: row?.total_minor,
      ims_status: null,
      igst_minor: 3_600,
      cgst_minor: 0,
      supply_type: "inter",
    });
    expect(row?.due_date).toBe(dn.issued.dueDate);
    expect(typeof dn.issued.dueDate).toBe("string");
    expect(await parentRow(inv.id)).toEqual(before);
    const { check } = await sealOf(dn.id);
    expect(check).toEqual({ content: true, snapshot: true });
    // overdue after its due date
    const list = await json(await call("/invoices?type=debit_note", { cookie: o.cookie }));
    expect(list.invoices.find((r: J) => r.id === dn.id)).toMatchObject({
      overdue: false,
      balanceMinor: row?.total_minor,
    });
  });

  it("a hostile body cannot carry trustRates, a rate, a supply or a total; a debit note on a draft, a void or a proforma invoice is refused", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    for (const extra of [
      { trustRates: true },
      { gstRateBp: 0 },
      { supply: { type: "export_lut" } },
      { totalMinor: 1 },
      { mode: "full" },
    ]) {
      expect(
        (await draftDebit(o, inv.id, { lines: [{ line: 0, taxableMinor: 100 }], ...extra })).status,
        JSON.stringify(extra),
      ).toBe(400);
    }
    expect((await draftDebit(o, inv.id, { lines: [{ line: 3, taxableMinor: 100 }] })).status).toBe(400);
    expect(
      (
        await draftDebit(o, inv.id, {
          lines: [{ line: 0, taxableMinor: 100 }],
          reasonCode: "service_deficient",
        })
      ).status,
    ).toBe(400);
    expect(
      await codeOf(
        await draftDebit(o, inv.id, { lines: [{ line: 0, taxableMinor: 100 }], reasonCode: "other" }),
      ),
    ).toBe("note_reason_required");
    // a draft invoice
    const draft = await mkInvoice(o, { clientId: inv.clientId, contactId: inv.contactId });
    expect(await codeOf(await draftDebit(o, draft.id, { lines: [{ line: 0, taxableMinor: 100 }] }))).toBe(
      "parent_not_issued",
    );
    // a void invoice
    const v = await mkIssuedInvoice(o, { prices: [100_000] });
    expect((await voidInvoice(o, v.id)).status).toBe(200);
    expect(await codeOf(await draftDebit(o, v.id, { lines: [{ line: 0, taxableMinor: 100 }] }))).toBe(
      "parent_void",
    );
    expect(await codeOf(await draftCredit(o, v.id, { mode: "full" }))).toBe("parent_void");
    // a proforma is not an invoice a note can be against
    const pf = await mkProforma(o, { clientId: inv.clientId });
    expect((await draftDebit(o, pf.id, { lines: [{ line: 0, taxableMinor: 100 }] })).status).toBe(404);
    expect((await draftCredit(o, "no-such-invoice", { mode: "full" })).status).toBe(404);
  });
});

// ---- void ------------------------------------------------------------------------------------------------------------------------------------------

describe("void [Q1, Q31, LD47]", () => {
  it("an invoice with an issued credit or debit note cannot be voided; a note is never voided; the trigger agrees", async () => {
    const o = await owner();
    const withCredit = await mkIssuedInvoice(o, { prices: [100_000] });
    const cn = await issueCredit(o, withCredit.id, {
      mode: "lines",
      lines: [{ line: 0, taxableMinor: 1_000 }],
    });
    const r1 = await voidInvoice(o, withCredit.id);
    expect(r1.status).toBe(409);
    expect((await json(r1)).reasons).toEqual(expect.arrayContaining(["has_credit", "has_child_document"]));
    const withDebit = await mkIssuedInvoice(o, { prices: [100_000] });
    await issueDebit(o, withDebit.id, { lines: [{ line: 0, taxableMinor: 1_000 }] });
    const r2 = await voidInvoice(o, withDebit.id);
    expect(r2.status).toBe(409);
    expect((await json(r2)).reasons).toEqual(["has_child_document"]);
    const r3 = await voidInvoice(o, cn.id);
    expect(r3.status).toBe(409);
    expect(await codeOf(r3)).toBe("note_not_voidable");
    expect((await getInvoice(o, cn.id)).void).toMatchObject({
      canVoid: false,
      blockers: ["note_not_voidable"],
    });
    await expect(
      env.DB.prepare("UPDATE documents SET status = 'void', voided_at = 9, void_reason = 'r' WHERE id = ?")
        .bind(cn.id)
        .run(),
    ).rejects.toThrow(/documents_note_no_void/);
  });

  it("voiding an invoice deletes its open note drafts, their requests and their bells; a draft whose invoice went void meanwhile is refused at the issue as parent_void", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const d = await json(await draftCredit(staff, inv.id, { mode: "full" }));
    const asked = await requestIssue(staff, d.id, "please");
    expect(asked.status, await asked.clone().text()).toBe(201);
    const approvalId = (await json(asked)).id as string;
    const bells = async () =>
      (await one<{ c: number }>("SELECT count(*) AS c FROM notifications WHERE entity_id = ?", approvalId))
        ?.c;
    expect(await bells()).toBeGreaterThan(0);
    const voided = await voidInvoice(o, inv.id);
    expect(voided.status, await voided.clone().text()).toBe(200);
    expect(await noteRow(d.id)).toBeNull();
    expect(await one("SELECT id FROM approvals WHERE id = ?", approvalId)).toBeNull();
    expect(await bells()).toBe(0);
    // the other path: voided by SQL (past the batch), the draft still there
    const inv2 = await mkIssuedInvoice(o, { prices: [100_000] });
    const d2 = await json(await draftCredit(o, inv2.id, { mode: "full" }));
    await env.DB.prepare(
      "UPDATE documents SET status = 'void', voided_at = 9, void_reason = 'r' WHERE id = ?",
    )
      .bind(inv2.id)
      .run();
    const res = await issueInvoice(o, d2.id);
    expect(res.status).toBe(409);
    expect(await blockersOf(res)).toEqual([{ code: "parent_void" }]);
  });
});

// ---- IMS -------------------------------------------------------------------------------------------------------------------------------------------

describe("IMS status [Q14, Q36, LD46; Researched 2026-10-28, s.34(2) proviso CGST Act (08-C RA-04)]", () => {
  it("a registered client's credit note is pending; an unregistered or overseas client's is not applicable", async () => {
    const o = await owner();
    const reg = await mkIssuedInvoice(o, { prices: [100_000], client: mkRegisteredClient });
    const unreg = await mkIssuedInvoice(o, { prices: [100_000] });
    const exp = await mkIssuedInvoice(o, { prices: [10_000], client: mkOverseasClient });
    expect((await noteRow((await issueCredit(o, reg.id, { mode: "full" })).id))?.ims_status).toBe("pending");
    expect((await noteRow((await issueCredit(o, unreg.id, { mode: "full" })).id))?.ims_status).toBe(
      "not_applicable",
    );
    expect((await noteRow((await issueCredit(o, exp.id, { mode: "full" })).id))?.ims_status).toBe(
      "not_applicable",
    );
  });

  it("pending moves once to accepted or rejected, by the Owner only; a debit note, a draft, a not-applicable note and a stale stamp are refused", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const accountant = await sessionFor("accountant");
    const inv = await mkIssuedInvoice(o, { prices: [100_000], client: mkRegisteredClient });
    const cn = await issueCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 10_000 }] });
    const stamp = (await noteRow(cn.id))?.updated_at;
    const set = (s: typeof o, id: string, status: string, expectedUpdatedAt?: unknown) =>
      call(`/invoices/${id}/ims-status`, {
        cookie: s.cookie,
        body: { expectedUpdatedAt: expectedUpdatedAt ?? stamp, status },
      });
    expect((await set(staff, cn.id, "accepted")).status).toBe(403);
    expect((await set(accountant, cn.id, "accepted")).status).toBe(403);
    expect((await set(o, cn.id, "accepted", 1)).status).toBe(409);
    expect(await codeOf(await set(o, cn.id, "accepted", 1))).toBe("stale_version");
    const view = await getInvoice(o, cn.id);
    expect(view.ims).toEqual({ status: "pending", canSet: true });
    const ok = await set(o, cn.id, "accepted");
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect((await noteRow(cn.id))?.ims_status).toBe("accepted");
    expect((await getInvoice(o, cn.id)).ims).toEqual({ status: "accepted", canSet: false });
    const again = await set(o, cn.id, "rejected", (await noteRow(cn.id))?.updated_at);
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("ims_not_pending");
    expect(await auditCount("invoice.ims_status", cn.id)).toBe(1);
    // a debit note, a draft credit note, a not-applicable one, an invoice
    const dn = await issueDebit(o, inv.id, { lines: [{ line: 0, taxableMinor: 100 }] });
    expect(await codeOf(await set(o, dn.id, "accepted", (await noteRow(dn.id))?.updated_at))).toBe(
      "ims_not_applicable",
    );
    const draft = await json(await draftCredit(o, inv.id, { mode: "full" }));
    expect(await codeOf(await set(o, draft.id, "accepted", 1))).toBe("ims_not_applicable");
    const unreg = await mkIssuedInvoice(o, { prices: [100_000] });
    const na = await issueCredit(o, unreg.id, { mode: "full" });
    expect(await codeOf(await set(o, na.id, "accepted", (await noteRow(na.id))?.updated_at))).toBe(
      "ims_not_applicable",
    );
    expect(await codeOf(await set(o, inv.id, "accepted", 1))).toBe("ims_not_applicable");
    expect((await set(o, "no-such-note", "accepted")).status).toBe(404);
  });

  it("the list filters the credit notes that wait for an answer", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000], client: mkRegisteredClient });
    const cn = await issueCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 1_000 }] });
    const other = await issueCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 2_000 }] });
    await call(`/invoices/${other.id}/ims-status`, {
      cookie: o.cookie,
      body: { expectedUpdatedAt: (await noteRow(other.id))?.updated_at, status: "rejected" },
    });
    const list = await json(await call("/invoices?ims=pending", { cookie: o.cookie }));
    expect(list.invoices.map((r: J) => r.id)).toContain(cn.id);
    expect(list.invoices.map((r: J) => r.id)).not.toContain(other.id);
    for (const r of list.invoices) expect(r.type).toBe("credit_note");
    expect(
      (await json(await call("/invoices?ims=pending&type=tax_invoice", { cookie: o.cookie }))).invoices,
    ).toEqual([]);
  });
});

// ---- roles and approvals ---------------------------------------------------------------------------------------------------------------------------

describe("roles and the approval of a note [ADM-APR-01/02, LD38]", () => {
  it("Staff drafts and asks, the Owner approves with a fresh code: issued and the invoice moved in one batch; editing after the request expires it", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const inv = await mkIssuedInvoice(o, { prices: [100_000, 50_000] });
    const d = await json(
      await draftCredit(staff, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 20_000 }] }),
    );
    // Staff cannot issue, may ask
    expect((await issueInvoice(staff, d.id)).status).toBe(403);
    const asked = await requestIssue(staff, d.id, "Client agreed");
    expect(asked.status, await asked.clone().text()).toBe(201);
    const approvalId = (await json(asked)).id as string;
    // an owner bell names the document type in 07-T §8's words
    const bell = await one<{ title: string }>(
      "SELECT title FROM notifications WHERE entity_id = ? AND kind = 'approval.requested' LIMIT 1",
      approvalId,
    );
    expect(bell?.title).toMatch(/^.+ asked you to issue a credit note for .+\.$/);
    expect(bell?.title).not.toContain("[Placeholder]");
    // editing expires the request
    const doc = await getInvoice(staff, d.id);
    const edited = await call(`/invoices/${d.id}`, {
      method: "PATCH",
      cookie: staff.cookie,
      body: {
        expectedUpdatedAt: doc.updatedAt,
        fields: {
          note: { mode: "lines", lines: [{ line: 0, taxableMinor: 25_000 }], reasonCode: "price_correction" },
        },
      },
    });
    expect(edited.status, await edited.clone().text()).toBe(200);
    expect(
      (await one<{ status: string }>("SELECT status FROM approvals WHERE id = ?", approvalId))?.status,
    ).toBe("expired");
    expect((await json(edited)).preview.totals.taxableMinor).toBe(25_000);
    // a new request, approved by the Owner
    const asked2 = await json(await requestIssue(staff, d.id));
    const approved = await decideApproval(o, asked2.id, "approve");
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(await noteRow(d.id)).toMatchObject({ status: "issued" });
    const row = await noteRow(d.id);
    expect(await parentRow(inv.id)).toMatchObject({
      status: "partially_credited",
      credited_minor: row?.total_minor,
    });
    // the requester's bell says what was issued
    const decided = await one<{ title: string }>(
      "SELECT title FROM notifications WHERE entity_id = ? AND kind = 'approval.decided' LIMIT 1",
      asked2.id,
    );
    expect(decided?.title).toContain("credit note");
    expect(decided?.title).toContain(String(row?.number_display));
  });

  it("an approver's request past the deadline, or one the invoice moved under, is refused at the approval", async () => {
    const o = await farSession("owner");
    const staff = await sessionFor("staff");
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const d = await json(
      await draftCredit(staff, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 20_000 }] }),
    );
    const asked = await json(await requestIssue(staff, d.id));
    const year =
      2000 +
      Number(
        ((await one<{ fy: string }>("SELECT fy FROM documents WHERE id = ?", inv.id))?.fy ?? "").slice(2),
      );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${year}-12-01T09:00:00.000+05:30`));
    const late = await decideApproval(o, asked.id, "approve");
    expect(late.status).toBe(409);
    expect((await json(late)).blockers).toEqual([{ code: "credit_deadline_passed", date: `${year}-11-30` }]);
    expect((await noteRow(d.id))?.status).toBe("draft");
    vi.useRealTimers();
    // rejected: the draft stays, the requester is told in the note's words
    const rej = await decideApproval(o, asked.id, "reject", "No");
    expect(rej.status).toBe(200);
    const bell = await one<{ title: string }>(
      "SELECT title FROM notifications WHERE entity_id = ? AND kind = 'approval.decided' LIMIT 1",
      asked.id,
    );
    expect(bell?.title).toContain("credit note");
  });

  it("the Owner needs a fresh code to issue; Sales has no access at all; the accountant reads but cannot draft", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const d = await json(await draftCredit(o, inv.id, { mode: "full" }));
    const noCode = await sessionFor("owner");
    const res = await issueInvoice(noCode, d.id, await issueBodyOfNote(d.id));
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("step_up_required");
    const sales = await sessionFor("sales");
    const accountant = await sessionFor("accountant");
    expect((await draftCredit(sales, inv.id, { mode: "full" })).status).toBe(403);
    expect((await call(`/invoices/${d.id}`, { cookie: sales.cookie })).status).toBe(403);
    expect((await draftCredit(accountant, inv.id, { mode: "full" })).status).toBe(403);
    expect((await draftDebit(accountant, inv.id, { lines: [{ line: 0, taxableMinor: 1 }] })).status).toBe(
      403,
    );
    expect((await call(`/invoices/${d.id}`, { cookie: accountant.cookie })).status).toBe(200);
  });
});

// ---- the anonymised client -------------------------------------------------------------------------------------------------------------------------

describe("an anonymised client takes no new note [Q34, LD48; Researched 2026-10-28, DPDP Act s.8(7) and s.12(3) (08-C RB-11)]", () => {
  it("creating or issuing a note for it is 409 client_anonymised; nothing is written", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const d = await json(await draftCredit(o, inv.id, { mode: "full" }));
    await env.DB.prepare("UPDATE clients SET anonymised_at = 5 WHERE id = ?").bind(inv.clientId).run();
    expect(await codeOf(await draftCredit(o, inv.id, { mode: "full" }))).toBe("client_anonymised");
    expect(await codeOf(await draftDebit(o, inv.id, { lines: [{ line: 0, taxableMinor: 1 }] }))).toBe(
      "client_anonymised",
    );
    const res = await issueInvoice(o, d.id);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("client_anonymised");
    expect((await noteRow(d.id))?.status).toBe("draft");
    const view = await getInvoice(o, inv.id);
    expect(view.actions.credit.reasons).toContain("client_anonymised");
    // the IMS answer is a write too
  });

  it("erasing an individual's last contact deletes the open note drafts (their reason text with them) and keeps the issued notes", async () => {
    const o = await owner();
    const c = await mkInvoiceClient({ type: "individual" });
    const inv = await mkIssuedInvoice(o, { prices: [100_000, 50_000], client: async () => c });
    const issued = await issueCredit(o, inv.id, {
      mode: "lines",
      lines: [{ line: 0, taxableMinor: 1_000 }],
      reasonCode: "other",
      reasonText: "Mrs Rao asked",
    });
    const draft = await json(
      await draftCredit(o, inv.id, {
        mode: "lines",
        lines: [{ line: 1, taxableMinor: 2_000 }],
        reasonCode: "other",
        reasonText: "Private detail about Mrs Rao",
      }),
    );
    const res = await call(`/contacts/${c.contactId}/erase`, {
      cookie: o.cookie,
      body: { mode: "anonymise", reason: "requested" },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await noteRow(draft.id)).toBeNull();
    expect(await one("SELECT id FROM document_lines WHERE document_id = ?", draft.id)).toBeNull();
    expect(await noteRow(issued.id)).toMatchObject({ status: "issued" });
  });
});

// ---- seal and hash ---------------------------------------------------------------------------------------------------------------------------------

describe("the seal and the content hash of a note [LD25, LD39]", () => {
  it("noteOf and the reason move the hash and the seal; header_extras is frozen after the issue", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000, 50_000] });
    const a = await json(
      await draftCredit(o, inv.id, {
        mode: "lines",
        lines: [{ line: 0, taxableMinor: 10_000 }],
        reasonCode: "price_correction",
      }),
    );
    const b = await json(
      await draftDebit(o, inv.id, {
        lines: [{ line: 0, taxableMinor: 10_000 }],
        reasonCode: "price_correction",
      }),
    );
    expect(a.contentSha256).not.toBe(b.contentSha256);
    // the reason alone changes the hash (a save), and expires nothing here
    const doc = await getInvoice(o, a.id);
    const changed = await json(
      await call(`/invoices/${a.id}`, {
        method: "PATCH",
        cookie: o.cookie,
        body: {
          expectedUpdatedAt: doc.updatedAt,
          fields: {
            note: {
              mode: "lines",
              lines: [{ line: 0, taxableMinor: 10_000 }],
              reasonCode: "other",
              reasonText: "Scope reduced",
            },
          },
        },
      }),
    );
    expect(changed.contentSha256).not.toBe(a.contentSha256);
    expect((await issueInvoice(o, a.id)).status).toBe(200);
    const { bundle, check } = await sealOf(a.id);
    expect(check).toEqual({ content: true, snapshot: true });
    const parts = invoiceSealPartsOfBundle(bundle);
    if (!parts) throw new Error("not sealed");
    // a different reason or request gives another seal
    expect(
      (
        await invoiceSealOf({
          ...parts,
          noteOf: { ...parts.noteOf, reason: { code: "other", text: "x" } } as never,
        })
      ).snapshotSha256,
    ).not.toBe(bundle.document.snapshot_sha256);
    const { noteOf: _n, ...without } = parts;
    expect((await invoiceSealOf(without)).snapshotSha256).not.toBe(bundle.document.snapshot_sha256);
    await expect(
      env.DB.prepare("UPDATE documents SET header_extras = 'x' WHERE id = ?").bind(a.id).run(),
    ).rejects.toThrow(/frozen/);
    // an invoice sealed without a note is still sealed without one (its seal has no noteOf)
    expect((await sealOf(inv.id)).check).toEqual({ content: true, snapshot: true });
    expect(invoiceSealPartsOfBundle((await sealOf(inv.id)).bundle)?.noteOf).toBeUndefined();
  });

  it("a note draft cannot be saved with lines, or with the invoice's own fields; the kind's reasons only", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const a = await json(await draftCredit(o, inv.id, { mode: "full" }));
    const doc = await getInvoice(o, a.id);
    const patch = (body: Record<string, unknown>) =>
      call(`/invoices/${a.id}`, {
        method: "PATCH",
        cookie: o.cookie,
        body: { expectedUpdatedAt: doc.updatedAt, ...body },
      });
    const lines = await patch({
      lines: [{ description: "x", qtyMilli: 1000, unit: "fixed", rateMinor: 1, sac: "998314" }],
    });
    expect(lines.status).toBe(400);
    expect(await codeOf(lines)).toBe("note_lines_derived");
    expect((await patch({ fields: { discount: { kind: "fixed", value: 1 } } })).status).toBe(400);
    expect((await patch({ fields: { fx: { rate: "1", date: "2026-10-01", source: "FBIL" } } })).status).toBe(
      400,
    );
    expect((await patch({ fields: { note: { mode: "full", reasonCode: "other" } } })).status).toBe(400);
    expect((await patch({ fields: { note: { mode: "full", reasonCode: "bogus" } } })).status).toBe(400);
    // a debit reason on a credit note is refused; a stale stamp too
    expect((await patch({ fields: { note: { mode: "full", reasonCode: "price_correction" } } })).status).toBe(
      200,
    );
    expect((await patch({ fields: { note: { mode: "full", reasonCode: "price_correction" } } })).status).toBe(
      409,
    );
    // an invoice has no note request
    const invoiceDoc = await getInvoice(o, inv.id);
    expect(
      (
        await call(`/invoices/${inv.id}`, {
          method: "PATCH",
          cookie: o.cookie,
          body: {
            expectedUpdatedAt: invoiceDoc.updatedAt,
            fields: { note: { mode: "full", reasonCode: "other" } },
          },
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
  });

  // 30 s: issues an invoice and a note first; the 5 s default times out under a whole-repo parallel run (FX-1 review).
  it("discarding a note draft is the invoice DELETE; an issued note cannot be discarded", {
    timeout: 30_000,
  }, async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const a = await json(await draftCredit(o, inv.id, { mode: "full" }));
    const doc = await getInvoice(o, a.id);
    expect(
      (
        await call(`/invoices/${a.id}?expectedUpdatedAt=${doc.updatedAt}`, {
          method: "DELETE",
          cookie: o.cookie,
        })
      ).status,
    ).toBe(200);
    expect(await noteRow(a.id)).toBeNull();
    const cn = await issueCredit(o, inv.id, { mode: "full" });
    expect(
      (
        await call(`/invoices/${cn.id}?expectedUpdatedAt=${(await noteRow(cn.id))?.updated_at}`, {
          method: "DELETE",
          cookie: o.cookie,
        })
      ).status,
    ).toBe(409);
    void stampOf;
  });
});
