// The merge of T11 into M6.2 [RB-38(a), ADM-PAY-02, ADM-INV-10]: the gateway batches that move money append T11's deed hook (L3). A Razorpay payment confirmed on
// the last open invoice of a completed project makes its draft deed in the same batch; a proforma paid online (a pending payment) makes none until the automatic
// tax invoice for the payment received is issued, whose batch makes it. One anonymise fires both writing triggers on `clients` (M6.2's
// `review_items_erase_notes`, T11's `clients_anonymised_draft_deeds`). The worst-path D1 statement counts are logged. Razorpay is never called; all names,
// references and amounts are invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueGatewayAdvance } from "./gateway/advance.ts";
import { setStubTransport } from "./gateway/config.ts";
import { processEvent } from "./gateway/events.ts";
import { mkContact } from "./test-clients.ts";
import { DEED_TOTAL, deedRowOf, mkDeedProject, payAll } from "./test-deeds.ts";
import { countingEnv, eventRow, linkFor, owner, paymentOf, stub } from "./test-gateway.ts";
import { call, countOf, one } from "./test-helpers.ts";
import { mkProforma, putSwiftBank, putTax } from "./test-invoice-types.ts";
import { issueInvoice, putBank, putCompany } from "./test-invoices.ts";
import { mkMilestone } from "./test-projects.ts";

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({});
  stub();
});
afterEach(() => setStubTransport(null));

const docOf = async (id: string) => {
  const d = await one<{ updated_at: number; total_minor: number }>(
    "SELECT updated_at, total_minor FROM documents WHERE id = ?1",
    id,
  );
  return { id, updatedAt: d?.updated_at ?? 0, total: d?.total_minor ?? 0 };
};
/** A domestic client the proforma can be issued to (mkInvoiceClient's address and state). */
const ADDRESSED = {
  gst_status: "unregistered",
  state_code: "19",
  billing_address: JSON.stringify({
    line1: "5 Market Street",
    city: "Kolkata",
    state: "West Bengal",
    stateCode: "19",
    postalCode: "700001",
    country: "IN",
  }),
};
const deedAudits = (deedId: unknown) =>
  countOf("audit_log", "entity_type = 'deed' AND entity_id = ? AND action = 'deed.draft'", deedId);

describe("T11 x M6.2: the gateway batches make the draft deed [RB-38(a) L3]", () => {
  it("a Razorpay payment confirmed on a completed project's last open invoice makes its draft deed, its audit row and the Owner's bell in the confirm batch", async () => {
    const o = await owner();
    const f = await mkDeedProject({ status: "completed" });
    const l = await linkFor(o, await docOf(f.inv.id));
    expect(await deedRowOf(f.projectId)).toBeNull();
    const c = countingEnv();
    expect((await processEvent(c.env, await eventRow(l.linkId, l.paymentId))).result).toBe("processed");
    console.log(`D1 statements, processEvent (invoice) with the deed hook: ${c.counter.n}`);
    expect(c.counter.n).toBeLessThanOrEqual(45);
    expect((await paymentOf(l.paymentId))?.status).toBe("confirmed");
    const d = await deedRowOf(f.projectId);
    expect(d).toMatchObject({ status: "draft", client_id: f.clientId, source_document_id: f.proposalId });
    expect(await deedAudits(d?.id)).toBe(1);
    expect(
      await countOf("notifications", "kind = 'deed.draft' AND entity_id = ? AND user_id = ?", d?.id, o.id),
    ).toBe(1);
  });

  it("a project still short of its accepted total gets no deed from a confirmed online payment", async () => {
    const o = await owner();
    const f = await mkDeedProject({ status: "completed", total: DEED_TOTAL + 1 });
    const l = await linkFor(o, await docOf(f.inv.id));
    expect((await processEvent(env, await eventRow(l.linkId, l.paymentId))).result).toBe("processed");
    expect((await paymentOf(l.paymentId))?.status).toBe("confirmed");
    expect(await deedRowOf(f.projectId)).toBeNull();
  });

  it("a proforma paid online makes no deed while its payment is pending; the automatic tax invoice for the payment received makes it in its own batch", async () => {
    const o = await owner();
    // The accepted total is one paisa more than the project's first invoice, so only the advance's money completes it.
    const f = await mkDeedProject({ status: "completed", total: DEED_TOTAL + 1, clientOver: ADDRESSED });
    await payAll(o, f.clientId, f.inv.id);
    expect(await deedRowOf(f.projectId)).toBeNull();
    const m = await mkMilestone(f.projectId, {
      amount_minor: 100_000,
      status: "ready_to_bill",
      title: "Design",
    });
    const pf = await mkProforma(o, { clientId: f.clientId, milestoneId: m.id });
    const issued = await issueInvoice(o, pf.id);
    expect(issued.status, await issued.clone().text()).toBe(200);
    const l = await linkFor(o, await docOf(pf.id));
    const r = await processEvent(env, await eventRow(l.linkId, l.paymentId));
    expect(r.next?.kind).toBe("gateway.advance");
    expect((await paymentOf(l.paymentId))?.status).toBe("pending_verification");
    expect(await deedRowOf(f.projectId)).toBeNull();
    const c = countingEnv();
    expect((await issueGatewayAdvance(c.env, r.next?.paymentId as string)).result).toBe("issued");
    console.log(`D1 statements, issueGatewayAdvance (issued) with the deed hook: ${c.counter.n}`);
    expect(c.counter.n).toBeLessThanOrEqual(45);
    expect((await paymentOf(l.paymentId))?.status).toBe("confirmed");
    const d = await deedRowOf(f.projectId);
    expect(d).toMatchObject({ status: "draft", client_id: f.clientId, source_document_id: f.proposalId });
    expect(await deedAudits(d?.id)).toBe(1);
  });
});

describe("one anonymise fires both writing triggers on clients [RB-38(a) L7; 08-C RB-11]", () => {
  it("erasing an individual client's contact deletes its draft deed (clients_anonymised_draft_deeds) and clears its review items' notes (review_items_erase_notes)", async () => {
    const o = await owner();
    const f = await mkDeedProject({ status: "completed", clientOver: { type: "individual" } });
    const person = await mkContact(f.clientId, { name: "Asha Rao", is_primary: 1 });
    await payAll(o, f.clientId, f.inv.id);
    expect((await deedRowOf(f.projectId))?.status).toBe("draft");
    // A review item of the client, resolved by the Owner with a note (the only time a note is written).
    const itemId = uuidv7();
    await env.DB.prepare(
      "INSERT INTO review_items (id, source, provider, kind, status, client_id, amount_minor, currency, facts, created_at) VALUES (?1, 'webhook', 'razorpay', 'amount_mismatch', 'open', ?2, 1000, 'INR', '{}', ?3)",
    )
      .bind(itemId, f.clientId, Date.now())
      .run();
    await env.DB.prepare(
      "UPDATE review_items SET status = 'resolved', resolved_by = ?2, resolved_at = ?3, resolution = 'dismissed', note = 'Asha Rao phoned about it' WHERE id = ?1",
    )
      .bind(itemId, o.id, Date.now())
      .run();
    const res = await call(`/contacts/${person.id}/erase`, {
      cookie: o.cookie,
      body: { mode: "anonymise", reason: "requested" },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(
      await one("SELECT anonymised_at IS NOT NULL AS gone FROM clients WHERE id = ?1", f.clientId),
    ).toEqual({
      gone: 1,
    });
    expect(await deedRowOf(f.projectId)).toBeNull();
    expect(await one("SELECT status, resolution, note FROM review_items WHERE id = ?1", itemId)).toEqual({
      status: "resolved",
      resolution: "dismissed",
      note: null,
    });
  });
});
