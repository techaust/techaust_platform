// M5.3 review items (the analyst's early check and the lead's answers to stop 1, 2026-10-27): the 07-T §8 lines word for word, the IMS list's query plan, the amount typed
// that moves the hash, a debit note's save, "Against line {n}", and the finance audit list. Every rule is VERIFY WITH CA/LEGAL where it is a tax or legal one.
import { FINANCE_AUDIT_ACTIONS } from "@techaust/core/audit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTES } from "./guard.ts";
import { INVOICE_LIST_SQL } from "./invoices.ts";
import * as model from "./note-model.ts";
import { call, one, rows, sessionFor } from "./test-helpers.ts";
import { currentFy, lutOf, putSwiftBank, putTax } from "./test-invoice-types.ts";
import {
  getInvoice,
  issueInvoice,
  type J,
  json,
  putBank,
  putCompany,
  requestIssue,
} from "./test-invoices.ts";
import {
  draftCredit,
  draftDebit,
  issueCredit,
  mkIssuedInvoice,
  mkRegisteredClient,
  noteRow,
} from "./test-notes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
});
afterEach(() => vi.useRealTimers());

describe("the 07-T §8 lines are the API's words, word for word", () => {
  it.each([
    [model.PARENT_FULLY_CREDITED, "parent_fully_credited", "This invoice has already been credited in full."],
    [
      model.PARENT_CHANGED,
      "parent_changed",
      "Another credit or debit note was issued on this invoice a moment ago. Open it again to see what's left.",
    ],
    [
      model.noteDraftExists("credit"),
      "note_draft_exists",
      "There's already a draft credit note for this invoice. Open it to continue.",
    ],
    [
      model.noteDraftExists("debit"),
      "note_draft_exists",
      "There's already a draft debit note for this invoice. Open it to continue.",
    ],
    [
      model.notesLimit("credit"),
      "notes_limit",
      "This invoice already has 20 credit notes, the most it can have.",
    ],
    [
      model.notesLimit("debit"),
      "notes_limit",
      "This invoice already has 20 debit notes, the most it can have.",
    ],
    [
      model.NOTE_LINES_DERIVED,
      "note_lines_derived",
      "A note's lines come from its invoice and can't be edited directly.",
    ],
    [
      model.NOTE_NOT_VOIDABLE,
      "note_not_voidable",
      "Credit and debit notes can't be voided. Correct a credit note with a debit note, or a debit note with a credit note.",
    ],
    [model.IMS_NOT_PENDING, "ims_not_pending", "The client's IMS response is already recorded."],
    [model.ANNUAL_RETURN_FUTURE, "annual_return_future", "The filing date can't be in the future."],
    [
      model.CREDIT_DATA_DAMAGED,
      "credit_shape_mismatch",
      "This credit note doesn't match its invoice any more. Start again from the invoice.",
    ],
    [
      model.creditAmountUnfit(312_245_610, "USD"),
      "credit_amount_unfit",
      "Because of rounding, the nearest amount this credit note can be is $3,122,456.10. Use that amount instead?",
    ],
    [
      model.creditAmountUnfit(177_000, "INR"),
      "credit_amount_unfit",
      "Because of rounding, the nearest amount this credit note can be is ₹1,770.00. Use that amount instead?",
    ],
  ])("%#: %s", (made, code, message) => {
    expect(made.code).toBe(code);
    expect(made.message).toBe(message);
  });

  it("no code of the notes is still a placeholder", () => {
    const made = [
      ...Object.values(model).filter(
        (v): v is { code: string; message: string } =>
          typeof v === "object" && v !== null && "message" in v && "code" in v,
      ),
      model.noteDraftExists("credit"),
      model.notesLimit("debit"),
      model.creditAmountUnfit(1_000, "INR"),
    ];
    expect(made.filter((m) => m.message.includes("[Placeholder]")).map((m) => m.code)).toEqual([]);
  });

  it("the routes answer in those words (a second draft, the limit's wording by kind)", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    expect((await draftDebit(o, inv.id, { lines: [{ line: 0, taxableMinor: 100 }] })).status).toBe(201);
    const again = await draftDebit(o, inv.id, { lines: [{ line: 0, taxableMinor: 100 }] });
    expect(again.status).toBe(409);
    const body = await json(again);
    expect(body.error).toEqual({
      code: "note_draft_exists",
      message: "There's already a draft debit note for this invoice. Open it to continue.",
    });
    expect(typeof body.draftId).toBe("string");
  });

  it("a requested note bell and the issued bell use 07-T §8's sentences, without a mark", async () => {
    const o = await owner();
    const staff = await sessionFor("staff", { name: "Asha" });
    const inv = await mkIssuedInvoice(o, { prices: [100_000], client: mkRegisteredClient });
    const d = await json(await draftCredit(staff, inv.id, { mode: "full" }));
    const asked = await requestIssue(staff, d.id, "ok");
    expect(asked.status, await asked.clone().text()).toBe(201);
    const approvalId = (await json(asked)).id as string;
    const bell = await one<{ title: string }>(
      "SELECT title FROM notifications WHERE entity_id = ? AND kind = 'approval.requested' LIMIT 1",
      approvalId,
    );
    expect(bell?.title).toMatch(/^Asha asked you to issue a credit note for .+\.$/);
    expect(bell?.title).not.toContain("[Placeholder]");
  });
});

describe("the IMS list uses its index (analyst item 4)", () => {
  it("`ims=pending` is a range of documents_note_ims, never a scan of the documents table", async () => {
    const sql = `${INVOICE_LIST_SQL({ status: null, client: false, cursor: false, ims: true })} 51`;
    const plan = await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, "credit_note");
    const text = plan.map((p) => p.detail).join(" | ");
    expect(text).toMatch(/documents_note_ims/);
    expect(text).not.toMatch(/SCAN d(ocuments)?(?! USING)/);
  });
});

describe("the amount typed is part of what is hashed (analyst item 2)", () => {
  it("an amount-mode draft stores the amount, a changed amount moves the hash, and the issue (which recomputes from the stored request, amount included) accepts it", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000, 50_000] });
    const a = await json(await draftCredit(o, inv.id, { mode: "amount", grossMinor: 59_000 }));
    const doc = await getInvoice(o, a.id);
    const saved = await call(`/invoices/${a.id}`, {
      method: "PATCH",
      cookie: o.cookie,
      body: {
        expectedUpdatedAt: doc.updatedAt,
        fields: { note: { mode: "amount", grossMinor: 59_050, reasonCode: "price_correction" } },
      },
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const b = await json(saved);
    expect(b.request.grossMinor).toBe(59_050);
    expect(b.contentSha256).not.toBe(a.contentSha256);
    // the issue recomputes the hash from the stored `noteOf` (its `grossMinor` included): a mismatch would be `content_changed`
    const issued = await issueInvoice(o, a.id);
    expect(issued.status, await issued.clone().text()).toBe(200);
  });
});

describe("a debit note's save and the preview (optional items)", () => {
  it("a debit note draft saved with an amount or the whole invoice is 400 bad_request; with lines it is saved", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const d = await json(await draftDebit(o, inv.id, { lines: [{ line: 0, taxableMinor: 1_000 }] }));
    const stamp = async () => (await getInvoice(o, d.id)).updatedAt as number;
    const patch = async (note: J) =>
      call(`/invoices/${d.id}`, {
        method: "PATCH",
        cookie: o.cookie,
        body: { expectedUpdatedAt: await stamp(), fields: { note } },
      });
    const amount = await patch({ mode: "amount", grossMinor: 1_180, reasonCode: "price_correction" });
    expect(amount.status).toBe(400);
    expect((await json(amount)).error.code).toBe("bad_request");
    const full = await patch({ mode: "full", reasonCode: "price_correction" });
    expect(full.status).toBe(400);
    expect((await json(full)).error.code).toBe("bad_request");
    expect(
      (
        await patch({
          mode: "lines",
          lines: [{ line: 0, taxableMinor: 2_000 }],
          reasonCode: "price_correction",
        })
      ).status,
    ).toBe(200);
  });

  it("the preview numbers the invoice line the way the invoice does (1-based `againstLine`) and keeps the request's key in `line`", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000, 50_000, 20_000] });
    const res = await draftCredit(o, inv.id, {
      mode: "lines",
      lines: [
        { line: 1, taxableMinor: 5_000 },
        { line: 2, taxableMinor: 1_000 },
      ],
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const b = await json(res);
    expect(b.preview.lines.map((l: J) => [l.againstLine, l.line])).toEqual([
      [2, 1],
      [3, 2],
    ]);
    const view = await getInvoice(o, inv.id);
    for (const l of view.creditable.lines) expect(l.position).toBe(l.line + 1);
  });
});

describe("the finance audit list holds every invoice action (the lead's answer to stop 1)", () => {
  it("every invoice audit name of a route is in FINANCE_AUDIT_ACTIONS", () => {
    const invoiceActions = new Set(ROUTES.map((r) => r.audit).filter((a) => a?.startsWith("invoice.")));
    expect(invoiceActions.size).toBeGreaterThanOrEqual(10);
    for (const a of invoiceActions)
      expect(FINANCE_AUDIT_ACTIONS as readonly (string | undefined)[]).toContain(a);
  });

  it("the accountant's audit view shows a note draft, a note's issue and an IMS answer", async () => {
    const o = await owner();
    const accountant = await sessionFor("accountant");
    const inv = await mkIssuedInvoice(o, { prices: [100_000], client: mkRegisteredClient });
    const cn = await issueCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 10_000 }] });
    await call(`/invoices/${cn.id}/ims-status`, {
      cookie: o.cookie,
      body: { expectedUpdatedAt: (await noteRow(cn.id))?.updated_at, status: "accepted" },
    });
    const seen = async (action: string, entity: string) =>
      (
        (await json(await call(`/audit?action=${action}&entity=${entity}`, { cookie: accountant.cookie })))
          .entries as J[]
      ).filter((e) => e.entityId === cn.id);
    expect((await seen("invoice.note_create", "document")).length).toBeGreaterThanOrEqual(1);
    expect((await seen("invoice.issue", "document")).length).toBeGreaterThanOrEqual(1);
    expect((await seen("invoice.ims_status", "document")).length).toBe(1);
    // never the words of the reason, wherever it was typed
    const raw = await one<{ n: number }>(
      "SELECT count(*) AS n FROM audit_log WHERE entity_id = ? AND summary LIKE '%reasonText%'",
      cn.id,
    );
    expect(raw?.n).toBe(0);
  });
});
