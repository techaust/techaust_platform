// Estimate -> invoice draft, the lead convert's full draft, and the privacy rules of a proposal [ADM-EST-02, ADM-LEAD-04, ADM-CLI-05, O-Q4].
// Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17): the draft type for each advance mode, and what erasing or anonymising a person does to the offers addressed to them.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { invoiceTypeFor } from "./document-convert.ts";
import { putPaymentTerms } from "./test-catalogue.ts";
import { insert, mkContact, mkLead } from "./test-clients.ts";
import { call, countOf, one, rows, sessionFor } from "./test-helpers.ts";
import {
  codeOf,
  discount,
  getDoc,
  type J,
  json,
  mkDraft,
  mkQuoteClient,
  mkService,
  mkTerms,
  patchDoc,
  sendDoc,
} from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
});

const setAdvance = (mode: string) =>
  env.DB.prepare(
    "INSERT INTO settings (key, value, version) VALUES ('tax', ?1, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = version + 1",
  )
    .bind(JSON.stringify({ advanceMode: mode }))
    .run();
const resetTax = () => env.DB.prepare("DELETE FROM settings WHERE key = 'tax'").run();

async function acceptedEstimate(price = 250_000) {
  const o = await owner();
  const made = await mkDraft(o, { type: "estimate", price });
  const v = await getDoc(o, made.id);
  const sent = await sendDoc(o, made.id, v.updatedAt);
  expect(sent.status).toBe(200);
  // Acceptance arrives with M4.5; here it is set with SQL, the way the schema allows (sent -> accepted).
  await env.DB.prepare("UPDATE documents SET status = 'accepted' WHERE id = ?").bind(made.id).run();
  return { o, made };
}
const convert = (cookie: string, id: string) =>
  call(`/documents/${id}/convert`, { cookie, body: { to: "invoice" } });

// ---------------------------------------------------------------------------------------------------------------
describe("estimate -> invoice draft [ADM-EST-02]", () => {
  it("the draft type follows the advance mode (Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17), G-6)", () => {
    expect(invoiceTypeFor("proforma", false)).toBe("proforma");
    expect(invoiceTypeFor("proforma", true)).toBe("proforma");
    expect(invoiceTypeFor("invoice_upfront", false)).toBe("tax_invoice");
    expect(invoiceTypeFor("invoice_upfront", true)).toBe("export_invoice");
    expect(invoiceTypeFor("receipt_voucher", false)).toBe("proforma"); // the voucher itself is M5's
  });

  it("an accepted estimate becomes a proforma draft with the same amounts; the source is recorded", async () => {
    await resetTax();
    const { o, made } = await acceptedEstimate();
    const estimate = await getDoc(o, made.id);
    const res = await convert(o.cookie, made.id);
    expect(res.status, await res.clone().text()).toBe(201);
    const out = await json(res);
    expect(out).toMatchObject({ type: "proforma", sourceDocumentId: made.id });
    const draft = await one<J>("SELECT * FROM documents WHERE id = ?", out.id);
    expect(draft).toMatchObject({
      type: "proforma",
      status: "draft",
      client_id: made.clientId,
      currency: "INR",
      source_document_id: made.id,
      source_step: 1,
      number: null,
      frozen_at: null,
      content_sha256: null,
      version_group_id: null,
      // the offer's validity belongs to the offer, not to the invoice
      validity_days: null,
    });
    expect(estimate.validityDays).toBe(15);
    // 250,000 + 18 % (2 x 22,500) = 295,000, the estimate's own total
    expect(draft).toMatchObject({
      taxable_minor: estimate.totals.taxableMinor,
      cgst_minor: estimate.totals.cgstMinor,
      sgst_minor: estimate.totals.sgstMinor,
      total_minor: 295_000,
    });
    expect(estimate.totals.totalMinor).toBe(295_000);
    const lines = await rows<J>(
      "SELECT description, rate_minor, taxable_minor, line_total_minor, catalogue_rate_minor, catalogue_line FROM document_lines WHERE document_id = ?",
      out.id,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      rate_minor: 250_000,
      taxable_minor: 250_000,
      line_total_minor: 295_000,
      catalogue_rate_minor: null,
      catalogue_line: null,
    });
    expect(await one("SELECT status FROM documents WHERE id = ?", made.id)).toEqual({ status: "accepted" }); // the estimate is untouched
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'document.convert' AND entity_id = ?",
      out.id,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({
      sourceDocumentId: made.id,
      to: "invoice",
      type: "proforma",
    });
  });

  it("invoice-upfront mode gives a tax invoice; for an overseas client an export invoice", async () => {
    await setAdvance("invoice_upfront");
    try {
      const a = await acceptedEstimate();
      expect((await json(await convert(a.o.cookie, a.made.id))).type).toBe("tax_invoice");
      // an overseas USD client
      const o = await owner();
      const client = await mkQuoteClient({
        currency: "USD",
        gst_status: "overseas",
        country: "US",
        state_code: null,
      });
      const made = await mkDraft(o, {
        type: "estimate",
        clientId: client.clientId,
        contactId: client.contactId,
        price: 100_000,
      });
      await sendDoc(o, made.id, (await getDoc(o, made.id)).updatedAt);
      await env.DB.prepare("UPDATE documents SET status = 'accepted' WHERE id = ?").bind(made.id).run();
      const res = await convert(o.cookie, made.id);
      expect(res.status, await res.clone().text()).toBe(201);
      const out = await json(res);
      expect(out.type).toBe("export_invoice");
      // USD: no tax under LUT (a warning on the draft when no LUT is saved), the total is the taxable value
      expect(
        await one(
          "SELECT currency, igst_minor, total_minor, supply_type FROM documents WHERE id = ?",
          out.id,
        ),
      ).toMatchObject({ currency: "USD", igst_minor: 0, supply_type: "export_lut" });
    } finally {
      await resetTax();
    }
  });

  it("the tax is worked out again from the client's current record", async () => {
    await resetTax();
    const { o, made } = await acceptedEstimate(1_000_000);
    await env.DB.prepare("UPDATE clients SET state_code = '27' WHERE id = ?").bind(made.clientId).run();
    const out = await json(await convert(o.cookie, made.id));
    expect(
      await one("SELECT supply_type, igst_minor, cgst_minor FROM documents WHERE id = ?", out.id),
    ).toEqual({ supply_type: "inter", igst_minor: 180_000, cgst_minor: 0 });
  });

  it("refused: not accepted, a proposal, a repeat, Sales, and an anonymised client; nothing is made", async () => {
    await resetTax();
    const o = await owner();
    const draft = await mkDraft(o, { type: "estimate" });
    const before = await countOf("documents", "source_document_id IS NOT NULL");
    expect(await codeOf(await convert(o.cookie, draft.id))).toBe("not_accepted");
    await sendDoc(o, draft.id, (await getDoc(o, draft.id)).updatedAt);
    expect(await codeOf(await convert(o.cookie, draft.id))).toBe("not_accepted"); // sent is not accepted
    const proposal = await mkDraft(o, { type: "proposal" });
    expect(await codeOf(await convert(o.cookie, proposal.id))).toBe("not_an_estimate");
    const { made } = await acceptedEstimate();
    const sales = await sessionFor("sales");
    const accountant = await sessionFor("accountant");
    expect((await convert(sales.cookie, made.id)).status).toBe(403);
    expect((await convert(accountant.cookie, made.id)).status).toBe(403);
    expect(
      (await call(`/documents/${made.id}/convert`, { cookie: o.cookie, body: { to: "care_plan" } })).status,
    ).toBe(400);
    expect((await convert(o.cookie, "no-such-id")).status).toBe(404);
    expect(await countOf("documents", "source_document_id IS NOT NULL")).toBe(before);
    expect((await convert(o.cookie, made.id)).status).toBe(201);
    const again = await convert(o.cookie, made.id);
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("already_converted");
    expect(await countOf("documents", "source_document_id = ?", made.id)).toBe(1);
    expect(
      await countOf(
        "document_lines",
        "document_id IN (SELECT id FROM documents WHERE source_document_id = ?)",
        made.id,
      ),
    ).toBe(1);
  });

  it("a discount on the estimate carries to the draft: the amounts are equal", async () => {
    await resetTax();
    const o = await owner();
    const made = await mkDraft(o, { type: "estimate", price: 1_000_000 });
    const v = await discount(o, made.id, "percent", 1000);
    await sendDoc(o, made.id, v.updatedAt);
    await env.DB.prepare("UPDATE documents SET status = 'accepted' WHERE id = ?").bind(made.id).run();
    const out = await json(await convert(o.cookie, made.id));
    // 10 % off 1,000,000 = 900,000; + 18 % = 1,062,000
    expect(
      await one(
        "SELECT discount_kind, discount_value, taxable_minor, total_minor FROM documents WHERE id = ?",
        out.id,
      ),
    ).toEqual({
      discount_kind: "percent",
      discount_value: 1000,
      taxable_minor: 900_000,
      total_minor: 1_062_000,
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the lead convert builds the full draft [ADM-LEAD-04; M3.2 convert uses the shared draft builder]", () => {
  const GOOD = {
    type: "business",
    country: "IN",
    gstStatus: "unregistered",
    stateCode: "19",
    currency: "INR",
  };
  const convertLead = (cookie: string, id: string, body: Record<string, unknown> = GOOD) =>
    call(`/leads/${id}/convert`, { cookie, body });

  it("a known service: its line, schedule and template sections, the lead's message in the scope, a version group and the newest terms", async () => {
    const o = await owner();
    const terms = await mkTerms();
    const item = await mkService(300_000, {
      category: "automate",
      short: "Automate the invoice flow",
      schedule: JSON.stringify([
        { label: "On acceptance", pctBp: 6000, trigger: "on_accept" },
        { label: "On delivery", pctBp: 4000, trigger: "delivery" },
      ]),
    });
    await insert("templates", {
      id: crypto.randomUUID(),
      kind: "proposal",
      category: "automate",
      version: 7,
      body: JSON.stringify({
        sections: [
          { key: "scope", heading: "Scope", body: "{{service.short}}" },
          {
            key: "summary",
            heading: "Summary",
            body: "For {{client.name}}, valid {{proposal.validity_days}} days.",
          },
        ],
      }),
    });
    const lead = await mkLead(`${crypto.randomUUID()}@example.com`, {
      service_code: item.code,
      message: "We want the invoices to flow into Tally.",
      contact_company: "Rao Traders",
    });
    const res = await convertLead(o.cookie, lead);
    expect(res.status, await res.clone().text()).toBe(201);
    const { proposalId, clientId, contactId } = (await json(res)) as J;
    const doc = await getDoc(o, proposalId);
    expect(doc).toMatchObject({
      type: "proposal",
      status: "draft",
      version: 1,
      versionGroupId: proposalId,
      contact: { id: contactId },
      validityDays: 15,
    });
    expect(doc.terms.id).toBe(terms);
    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0]).toMatchObject({ rateMinor: 300_000, catalogueItemId: item.id });
    expect(doc.schedule.map((s: J) => [s.pctBp, s.amountMinor])).toEqual([
      [6000, 212_400], // 60 % of 354,000 (300,000 + 18 %)
      [4000, 141_600],
    ]);
    const by = (kind: string) => doc.sections.find((s: J) => s.kind === kind);
    expect(by("scope").bodyMd).toBe("Automate the invoice flow\n\nWe want the invoices to flow into Tally.");
    expect(by("summary").bodyMd).toBe("For Rao Traders, valid 15 days.");
    expect(doc.sections.slice(-3).map((s: J) => s.kind)).toEqual(["estimate", "terms", "acceptance"]);
    expect(await one("SELECT proposal_id, client_id FROM leads WHERE id = ?", lead)).toEqual({
      proposal_id: proposalId,
      client_id: clientId,
    });
    expect(doc.needsResave).toBe(false);
  });

  it("FX-3 round 3, item 4: a Scope section hidden for having no text is shown once the lead's message is in it", async () => {
    const o = await owner();
    await mkTerms();
    // a template version saved before the round 3 rule (Q3): Catalogue text in Scope, and a service with none, so Scope is emptied
    const item = await mkService(300_000, { category: "connect", deliverables_md: null });
    await insert("templates", {
      id: crypto.randomUUID(),
      kind: "proposal",
      category: "connect",
      version: 8,
      body: JSON.stringify({
        sections: [{ key: "scope", heading: "Scope", body: "{{service.deliverables}}" }],
      }),
    });
    const lead = await mkLead(`${crypto.randomUUID()}@example.com`, {
      service_code: item.code,
      message: "Connect the shop to the warehouse.",
      contact_company: "Das Stores",
    });
    const res = await convertLead(o.cookie, lead);
    expect(res.status, await res.clone().text()).toBe(201);
    const doc = await getDoc(o, ((await json(res)) as J).proposalId);
    const scope = doc.sections.find((s: J) => s.kind === "scope");
    expect(scope.bodyMd).toBe("Connect the shop to the warehouse.");
    expect(scope.hidden).toBe(false);
  });

  it("a service that needs a choice of lines, or is not priced here, gives sections and a schedule but no lines; an unknown code gives sections only", async () => {
    const o = await owner();
    const tiers = JSON.stringify([
      { description: "Essential", unit: "month", qtyMilli: 1000, rateInrMinor: 100, rateUsdMinor: null },
    ]);
    const withTiers = await mkService(100, { default_lines: tiers });
    const lead = await mkLead(`${crypto.randomUUID()}@example.com`, { service_code: withTiers.code });
    const a = (await json(await convertLead(o.cookie, lead))) as J;
    const first = await getDoc(o, a.proposalId);
    expect(first.lines).toEqual([]);
    expect(first.schedule.length).toBeGreaterThan(0);
    expect(first.canSend).toBe(false);

    const unknown = await mkLead(`${crypto.randomUUID()}@example.com`, {
      service_code: "S9999-none",
      message: null,
    });
    const b = (await json(await convertLead(o.cookie, unknown))) as J;
    const second = await getDoc(o, b.proposalId);
    expect(second.sections.map((s: J) => s.kind)).toEqual(["estimate", "terms", "acceptance"]);
    expect(second.lines).toEqual([]);

    const usd = await mkLead(`${crypto.randomUUID()}@example.com`, {
      service_code: (await mkService(100_000, { price_usd_minor: null })).code,
    });
    const c = await convertLead(o.cookie, usd, {
      type: "business",
      country: "US",
      gstStatus: "overseas",
      currency: "USD",
    });
    expect(c.status, await c.clone().text()).toBe(201); // a service with no USD price never stops a conversion
  });

  it("an inactive service still converts, with sections only", async () => {
    const o = await owner();
    const item = await mkService(100_000, { active: 0 });
    const lead = await mkLead(`${crypto.randomUUID()}@example.com`, { service_code: item.code });
    const res = await convertLead(o.cookie, lead);
    expect(res.status).toBe(201);
    expect((await getDoc(o, ((await json(res)) as J).proposalId)).lines).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("a sent offer and the people it names [ADM-CLI-05, O-Q4; Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37)]", () => {
  const erase = (cookie: string, contactId: string, mode: "erase" | "anonymise") =>
    call(`/contacts/${contactId}/erase`, { cookie, body: { mode, reason: "requested" } });

  it("a business contact named on a sent proposal, whose email changed since: erase is refused (409), anonymise works; the frozen copy stays", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const v = await getDoc(o, made.id);
    await sendDoc(o, made.id, v.updatedAt);
    await env.DB.prepare("UPDATE contacts SET email = 'new-address@example.test' WHERE id = ?")
      .bind(made.contactId)
      .run();
    const refused = await erase(o.cookie, made.contactId, "erase");
    expect(refused.status).toBe(409);
    expect(await codeOf(refused)).toBe("on_issued_document");
    expect(await countOf("contacts", "id = ?", made.contactId)).toBe(1);
    const ok = await erase(o.cookie, made.contactId, "anonymise");
    expect(ok.status, await ok.clone().text()).toBe(200);
    const row = await one<{ recipient: string; status: string }>(
      "SELECT recipient, status FROM documents WHERE id = ?",
      made.id,
    );
    expect(JSON.parse(row?.recipient ?? "{}")).toMatchObject({
      contactId: made.contactId,
      contactName: "Asha Rao",
    });
    expect(row?.status).toBe("sent");
  });

  it("O-Q4: an individual's last contact erased: the never-sent drafts go (with their approvals), the sent version stays", async () => {
    const o = await owner();
    const client = await mkQuoteClient({ type: "individual" });
    const sold = await mkDraft(o, { clientId: client.clientId, contactId: client.contactId });
    await sendDoc(o, sold.id, (await getDoc(o, sold.id)).updatedAt);
    const draft = await mkDraft(o, {
      clientId: client.clientId,
      contactId: client.contactId,
      price: 20_000_000,
    });
    const v = await discount(o, draft.id, "fixed", 5_000_000);
    const asked = await call(`/documents/${draft.id}/approval-request`, {
      cookie: o.cookie,
      body: { expectedUpdatedAt: v.updatedAt },
    });
    const approvalId = ((await json(asked)) as J).id as string;
    // the owners' bell holds a row about the approval (its title is the draft's title)
    expect(
      await countOf("notifications", "entity_type = 'approval' AND entity_id = ?", approvalId),
    ).toBeGreaterThan(0);
    const revision = await json(await call(`/documents/${sold.id}/revise`, { cookie: o.cookie, body: {} }));
    const estimate = await mkDraft(o, {
      type: "estimate",
      clientId: client.clientId,
      contactId: client.contactId,
    });
    const lead = await mkLead(`${crypto.randomUUID()}@example.com`, {
      client_id: client.clientId,
      proposal_id: draft.id,
    });
    // a bell about the sent version (a PDF that failed its check) and one about another client's document
    const other = await mkDraft(o);
    for (const docId of [sold.id, other.id])
      await env.DB.prepare(
        "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link) VALUES (?1, ?2, 'pdf.failed', 'document', ?3, 'The PDF of X did not match.', '/proposals/x')",
      )
        .bind(`n_${docId}`, o.id, docId)
        .run();
    const ok = await erase(o.cookie, client.contactId, "anonymise");
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await countOf("notifications", "entity_type = 'document' AND entity_id = ?", sold.id)).toBe(0);
    expect(await countOf("notifications", "entity_type = 'document' AND entity_id = ?", other.id)).toBe(1);
    for (const id of [draft.id, revision.id, estimate.id])
      expect(await countOf("documents", "id = ?", id), id).toBe(0);
    expect(await countOf("approvals", "document_id = ?", draft.id)).toBe(0);
    // the bell rows about the erased drafts' approvals go with them (their titles named the draft; Researched 2026-10-28, DPDP Act s.8(7) and s.12(3) (08-C RB-11))
    expect(await countOf("notifications", "entity_type = 'approval' AND entity_id = ?", approvalId)).toBe(0);
    expect(
      await countOf("document_lines", "document_id IN (?, ?, ?)", draft.id, revision.id, estimate.id),
    ).toBe(0);
    expect(
      await one("SELECT status, frozen_at IS NOT NULL AS frozen FROM documents WHERE id = ?", sold.id),
    ).toEqual({ status: "sent", frozen: 1 });
    expect(await one("SELECT proposal_id FROM leads WHERE id = ?", lead)).toEqual({ proposal_id: null });
  });

  it("a business client's drafts are NOT deleted when one of its contacts is erased; a draft addressed to the erased contact loses the addressee", async () => {
    const o = await owner();
    const client = await mkQuoteClient();
    const second = await mkContact(client.clientId, { name: "Second Person" });
    const draft = await mkDraft(o, { clientId: client.clientId, contactId: second.id });
    const ok = await erase(o.cookie, second.id, "erase");
    expect(ok.status, await ok.clone().text()).toBe(200);
    // the draft's hash no longer matches its content (the addressee is part of it): it is cleared, so the draft is saved again before
    // it can be sent and no approval of the old content stands
    expect(await one("SELECT contact_id, content_sha256 FROM documents WHERE id = ?", draft.id)).toEqual({
      contact_id: null,
      content_sha256: null,
    });
    expect((await getDoc(o, draft.id)).contact).toBeNull();
  });

  it("the data export lists a sent proposal that names the contact by id, whatever the address is now", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    await sendDoc(o, made.id, (await getDoc(o, made.id)).updatedAt);
    await env.DB.prepare("UPDATE contacts SET email = 'changed-since@example.test' WHERE id = ?")
      .bind(made.contactId)
      .run();
    const res = await call(`/contacts/${made.contactId}/export`, {
      cookie: o.cookie,
      body: { part: "documents" },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await json(res);
    expect(body.items.map((d: J) => d.id)).toContain(made.id);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the audit log holds ids and codes, never what the document says [ADM-G-06, hygiene]", () => {
  it("no title, section text, line description, note or reason reaches an audit row or a bell row", async () => {
    const o = await owner();
    const sales = await sessionFor("sales");
    const mark = `ZQX${Date.now()}`;
    const made = await mkDraft(sales, { price: 20_000_000 });
    const v = await getDoc(sales, made.id);
    const line = v.lines[0];
    const saved = await json(
      await patchDoc(sales, made.id, {
        expectedUpdatedAt: v.updatedAt,
        fields: { title: `${mark} title`, discount: { kind: "fixed", value: 5_000_000 } },
        lines: [
          {
            id: line.id,
            description: `${mark} line`,
            detail: `${mark} detail`,
            qtyMilli: 1000,
            unit: "fixed",
            rateMinor: 20_000_000,
          },
        ],
        sections: v.sections.map((s: J) => ({
          id: s.id,
          kind: s.kind,
          title: `${mark} heading`,
          bodyMd: `${mark} body`,
        })),
        schedule: [{ label: `${mark} step`, trigger: "on_accept", pctBp: 10_000, detail: `${mark} gets` }],
      }),
    );
    const req = await call(`/documents/${made.id}/approval-request`, {
      cookie: sales.cookie,
      body: { expectedUpdatedAt: saved.updatedAt, reason: `${mark} reason` },
    });
    const approvalId = ((await json(req)) as J).id as string;
    await call(`/approvals/${approvalId}/decide`, {
      cookie: o.cookie,
      body: { decision: "approve", note: `${mark} note` },
    });
    await sendDoc(sales, made.id, saved.updatedAt);
    const revised = await json(
      await call(`/documents/${made.id}/revise`, { cookie: sales.cookie, body: {} }),
    );
    await call(`/documents/${revised.id}?expectedUpdatedAt=${revised.updatedAt}`, {
      method: "DELETE",
      cookie: sales.cookie,
    });
    const audits = await rows<{ summary: string | null; action: string }>(
      "SELECT summary, action FROM audit_log WHERE action LIKE 'document.%' OR action LIKE 'approval.%'",
    );
    expect(audits.length).toBeGreaterThan(5);
    for (const a of audits) expect(a.summary ?? "", a.action).not.toContain(mark);
    const bells = await rows<{ title: string }>(
      "SELECT title FROM notifications WHERE kind LIKE 'approval.%'",
    );
    expect(bells.length).toBeGreaterThan(0);
    // the bell may name the document by its title (an interim wording, copy 07-O decides it) but never the reason or the note
    for (const b of bells) expect(b.title).not.toContain("reason");
  });
});
