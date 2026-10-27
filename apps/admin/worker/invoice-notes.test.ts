// M5.3 over the API [ADM-INV-11, ADM-INV-01 "Debit Note", ADM-APR-01/02; LD38..LD54; VERIFY WITH CA/LEGAL for every rule]: credit and debit note drafts against an issued invoice, their issue
// through the M5.1 pipeline (Owner with a fresh code, Staff asks, Owner approves), the creditable cap, the deadline, the parent's ledger in the same batch, the seal, the IMS answer, void,
// roles and the anonymised client.
import { env } from "cloudflare:workers";
import {
  type DocumentBundle,
  invoiceContentHashOfBundle,
  loadDocument,
  type TermsRef,
  verifyInvoiceSealed,
} from "@techaust/db/documents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, one, sessionFor } from "./test-helpers.ts";
import { currentFy, lutOf, putSwiftBank, putTax, todayIso } from "./test-invoice-types.ts";
import {
  auditCount,
  codeOf,
  decideApproval,
  getInvoice,
  invoiceCounter,
  issueInvoice,
  type J,
  json,
  mkInvoiceClient,
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

const owner = () => sessionFor("owner", { stepUp: true });

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
});
afterEach(() => vi.useRealTimers());

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
    const issued = await issueInvoice(o, made.id);
    expect(issued.status, await issued.clone().text()).toBe(200);
    const b = await json(issued);
    expect(b.number).toMatch(/^TH\/CN\/\d{4}\/\d{4}$/);
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
    expect(b.parent).toMatchObject({ id: inv.id, status: "partially_credited" });
    const bundle = (await loadDocument(env.DB, made.id)) as DocumentBundle<TermsRef>;
    expect(await verifyInvoiceSealed(bundle)).toEqual({ content: true, snapshot: true });
    expect(await invoiceContentHashOfBundle(bundle)).toBe(row?.content_sha256);
  });
});
