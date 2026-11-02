// CPU warm-up (b)3 (2026-11-02): GET /invoices/:id reads in ONE D1 batch (the note reads joined the first batch). The answer must be byte for byte what the two
// batches gave: for an issued invoice with an issued credit note and a debit note draft, the credit note, the debit draft, an export invoice, a draft, a
// proforma and a void invoice, the route's body equals the old read path's (the six detail statements in the first batch, the note statements in a second
// one for a note or an issued tax or export invoice) at the same instant.
import { env } from "cloudflare:workers";
import { isNoteType } from "@techaust/core/invoices";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARE_OF_SQL } from "./care-blockers.ts";
import { NEWEST_EXPORT_DECLARATION } from "./invoice-model.ts";
import { LIVE_LINKS_SQL, REMINDERS_OF_SQL, SENDS_OF_SQL } from "./invoice-send.ts";
import { CHILDREN_OF_SQL } from "./invoice-view.ts";
import { invoiceDetailView, readInvoice, readInvoiceDetail } from "./invoices.ts";
import { isNoteParentType, NOTE_PARENT_READS, parentStatements } from "./note-model.ts";
import { NOTES_VIEW_READS } from "./note-view.ts";
import { call, sessionFor } from "./test-helpers.ts";
import { currentFy, lutOf, mkProforma, putSwiftBank, putTax } from "./test-invoice-types.ts";
import { mkInvoice, mkOverseasClient, putBank, putCompany, voidInvoice } from "./test-invoices.ts";
import { draftDebit, issueCredit, mkIssuedInvoice } from "./test-notes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
});
afterEach(() => vi.useRealTimers());

/** The read path before (b)3: the detail's six statements with `readInvoice`, then a second batch with the note reads when the type needs them. */
async function twoBatchRead(id: string) {
  const db = env.DB;
  const ctx = await readInvoice({ env }, id, [
    db.prepare(NEWEST_EXPORT_DECLARATION),
    db.prepare(CHILDREN_OF_SQL).bind(id),
    db.prepare(SENDS_OF_SQL).bind(id),
    db.prepare(LIVE_LINKS_SQL).bind(id, Date.now()),
    db.prepare(REMINDERS_OF_SQL).bind(id),
    db.prepare(CARE_OF_SQL).bind(id),
  ]);
  if (!ctx) return null;
  const d = ctx.bundle.document;
  const isNote = isNoteType(d.type);
  const isParent = !isNote && isNoteParentType(d.type) && d.frozen_at !== null;
  const noteExtra: D1Result[] = isNote
    ? await db.batch(parentStatements(db, NOTE_PARENT_READS, id))
    : isParent
      ? await db.batch(NOTES_VIEW_READS.map((sql) => db.prepare(sql).bind(id)))
      : [];
  return { ctx, isNote, isParent, noteExtra };
}

describe("the invoice detail in one batch [CPU warm-up (b)3]", () => {
  it("answers byte for byte as the two batches did, for every kind of document", async () => {
    const o = await owner();
    const parent = await mkIssuedInvoice(o, { prices: [100_000, 50_000] });
    const credit = await issueCredit(o, parent.id, {
      mode: "lines",
      lines: [{ line: 0, taxableMinor: 10_000 }],
    });
    const debitRes = await draftDebit(o, parent.id, { lines: [{ line: 1, taxableMinor: 5_000 }] });
    expect(debitRes.status).toBe(201);
    const debit = ((await debitRes.json()) as { id: string }).id;
    const exported = await mkIssuedInvoice(o, { client: mkOverseasClient });
    const draft = await mkInvoice(o);
    const proforma = await mkProforma(o);
    const voided = await mkIssuedInvoice(o);
    expect((await voidInvoice(o, voided.id)).status).toBe(200);

    const ids = [parent.id, credit.id, debit, exported.id, draft.id, proforma.id, voided.id];
    for (const id of ids) {
      // One instant for both reads: the live-link check and the dates of the view use it.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now());
      const res = await call(`/invoices/${id}`, { cookie: o.cookie });
      expect(res.status, id).toBe(200);
      const routeBody = await res.text();
      const old = await twoBatchRead(id);
      if (!old) throw new Error(`no document ${id}`);
      const oldBody = JSON.stringify(await invoiceDetailView(old, "owner", Date.now()));
      expect(routeBody, id).toBe(oldBody);
      // And the new read builds the same view from its one batch.
      const one = await readInvoiceDetail({ env }, id);
      if (!one) throw new Error(`no document ${id}`);
      expect(JSON.stringify(await invoiceDetailView(one, "owner", Date.now())), id).toBe(oldBody);
      vi.useRealTimers();
    }
  });

  it("an issued invoice's detail is one D1 batch, and a missing id is still a 404", async () => {
    const o = await owner();
    const parent = await mkIssuedInvoice(o);
    const batch = vi.spyOn(env.DB, "batch");
    expect((await call(`/invoices/${parent.id}`, { cookie: o.cookie })).status).toBe(200);
    expect(batch).toHaveBeenCalledTimes(1);
    batch.mockRestore();
    expect((await call("/invoices/no-such-invoice", { cookie: o.cookie })).status).toBe(404);
  });
});
