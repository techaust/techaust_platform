// Proposals and estimates: create, read, list, save, discard, revise [ADM-PROP-01, -02, -03, -05, ADM-EST-01, ADM-CAT-03, ADM-G-02, ADM-G-03].
// The tests drive the routes as the SPA would. Every figure that is checked by hand is typed with its arithmetic beside it.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { mkItem, putPaymentTerms } from "./test-catalogue.ts";
import { insert, mkClient, mkContact, mkLead } from "./test-clients.ts";
import { barrierDb, call, countOf, one, rows, sessionFor, withDb } from "./test-helpers.ts";
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

const create = (cookie: string, body: Record<string, unknown>) => call("/documents", { cookie, body });

// ---------------------------------------------------------------------------------------------------------------
describe("permissions [ADM-G-02]", () => {
  it("every role reads the list and a document; owner, staff and sales draft; the accountant cannot write", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    for (const role of ["owner", "staff", "sales", "accountant"] as const) {
      const s = await sessionFor(role);
      expect((await call("/documents", { cookie: s.cookie })).status, role).toBe(200);
      expect((await call(`/documents/${made.id}`, { cookie: s.cookie })).status, role).toBe(200);
      expect((await call(`/clients/${made.clientId}/documents`, { cookie: s.cookie })).status, role).toBe(200);
    }
    for (const role of ["staff", "sales"] as const) {
      const s = await sessionFor(role);
      expect((await mkDraft(s)).id, role).toBeTruthy();
    }
    const acc = await sessionFor("accountant", { stepUp: true });
    const client = await mkQuoteClient();
    const item = await mkService();
    const body = { type: "proposal", clientId: client.clientId, services: [{ catalogueItemId: item.id }] };
    expect((await create(acc.cookie, body)).status).toBe(403);
    expect((await patchDoc(acc, made.id, { expectedUpdatedAt: made.updatedAt })).status).toBe(403);
    expect((await call(`/documents/${made.id}`, { method: "DELETE", cookie: acc.cookie })).status).toBe(403);
    expect((await call("/documents", { body })).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("create [ADM-PROP-01]", () => {
  it("a draft of one service: server-built lines, the catalogue's SAC and rate, a schedule, terms pinned, the validity", async () => {
    const o = await owner();
    const terms = await mkTerms(); // the newest at this moment
    const client = await mkQuoteClient();
    const item = await mkService(250_000, {
      sac: "998313",
      gst_rate_bp: 1200,
      schedule: JSON.stringify([
        { label: "On acceptance", pctBp: 5000, trigger: "on_accept" },
        { label: "On delivery", pctBp: 5000, trigger: "delivery" },
      ]),
    });
    const res = await create(o.cookie, {
      type: "proposal",
      clientId: client.clientId,
      services: [{ catalogueItemId: item.id }],
    });
    expect(res.status).toBe(201);
    const made = await json(res);
    expect(made.versionGroupId).toBe(made.id);
    const doc = await getDoc(o, made.id);
    expect(doc).toMatchObject({
      type: "proposal",
      status: "draft",
      version: 1,
      number: null,
      currency: "INR",
      validityDays: 15,
      frozen: false,
      contact: { id: client.contactId },
    });
    expect(doc.title).toMatch(/^Test service/);
    expect(doc.terms.id).toBe(terms);
    expect(doc.lines).toHaveLength(1);
    // The line is the catalogue's: SAC and GST rate from the item, the rate as typed (here the catalogue price), the reference kept.
    expect(doc.lines[0]).toMatchObject({
      catalogueItemId: item.id,
      sac: "998313",
      gstRateBp: 1200,
      qtyMilli: 1000,
      rateMinor: 250_000,
      catalogueRateMinor: 250_000,
    });
    // 12 % intra-state: 250,000 + 2 x 15,000 (6 % each) = 280,000.
    expect(doc.totals).toMatchObject({ taxableMinor: 250_000, cgstMinor: 15_000, sgstMinor: 15_000, totalMinor: 280_000 });
    expect(doc.schedule.map((s: J) => [s.pctBp, s.amountMinor])).toEqual([
      [5000, 140_000],
      [5000, 140_000],
    ]);
    expect(doc.supply).toMatchObject({ type: "intra", placeOfSupplyCode: "19" });
    expect(doc.guard).toMatchObject({ discountBp: 0, needsApproval: false });
    expect(doc.approval.state).toBe("none");
    expect(doc.needsResave).toBe(false);
    const audit = await one<{ summary: string; actor_id: string }>(
      "SELECT summary, actor_id FROM audit_log WHERE action = 'document.create' AND entity_id = ?",
      made.id,
    );
    expect(audit?.actor_id).toBe(o.id);
    expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({ type: "proposal", lines: 1, clientId: client.clientId });
  });

  it("an estimate is the same path with its own type", async () => {
    const o = await owner();
    const made = await mkDraft(o, { type: "estimate" });
    expect(await getDoc(o, made.id)).toMatchObject({ type: "estimate", version: 1 });
    expect(await one("SELECT type, version_group_id FROM documents WHERE id = ?", made.id)).toEqual({
      type: "estimate",
      version_group_id: made.id,
    });
  });

  it("the template of the service's category is rendered; a placeholder with no value stays and blocks the send", async () => {
    const o = await owner();
    const client = await mkQuoteClient();
    const item = await mkService(100_000, {
      category: "connect",
      deliverables_md: "Three connectors",
      short: "Connect the shop",
    });
    await insert("templates", {
      id: crypto.randomUUID(),
      kind: "proposal",
      category: "connect",
      version: 41,
      body: JSON.stringify({
        sections: [
          { key: "summary", heading: "Summary", body: "For {{client.name}} by {{company.name}}, valid {{proposal.validity_days}} days." },
          { key: "scope", heading: "Scope", body: "{{service.short}}" },
          { key: "deliverables", heading: "Deliverables", body: "{{service.deliverables}}" },
          { key: "assumptions_exclusions", heading: "Assumptions", body: "{{service.assumptions}}" },
        ],
      }),
    });
    const res = await create(o.cookie, {
      type: "proposal",
      clientId: client.clientId,
      services: [{ catalogueItemId: item.id }],
    });
    const doc = await getDoc(o, (await json(res)).id);
    const by = (kind: string) => doc.sections.find((s: J) => s.kind === kind);
    expect(by("summary").bodyMd).toMatch(/^For Test Co \d+ by TecHaust Technologies, valid 15 days\.$/);
    expect(by("scope").bodyMd).toBe("Connect the shop");
    expect(by("deliverables").bodyMd).toBe("Three connectors");
    expect(by("assumptions_exclusions").bodyMd).toBe("{{service.assumptions}}");
    // The three always-present sections were added to a template that lacked them.
    expect(doc.sections.slice(-3).map((s: J) => s.kind)).toEqual(["estimate", "terms", "acceptance"]);
    expect(doc.canSend).toBe(false);
    expect(doc.blockers).toContainEqual({ code: "unresolved_placeholders", names: ["service.assumptions"] });
  });

  it("several services: all their lines, the schedule of the largest, their texts under their names", async () => {
    const o = await owner();
    const client = await mkQuoteClient();
    const small = await mkService(100_000, { name: "Small thing", category: "advise", deliverables_md: "Small output" });
    const big = await mkService(900_000, {
      name: "Big thing",
      category: "advise",
      deliverables_md: "Big output",
      schedule: JSON.stringify([
        { label: "Start", pctBp: 4000, trigger: "on_accept" },
        { label: "Finish", pctBp: 6000, trigger: "delivery" },
      ]),
    });
    await insert("templates", {
      id: crypto.randomUUID(),
      kind: "proposal",
      category: "advise",
      version: 99,
      body: JSON.stringify({ sections: [{ key: "deliverables", heading: "Deliverables", body: "{{service.deliverables}}" }] }),
    });
    const res = await create(o.cookie, {
      type: "proposal",
      clientId: client.clientId,
      services: [{ catalogueItemId: small.id }, { catalogueItemId: big.id }],
    });
    const doc = await getDoc(o, (await json(res)).id);
    expect(doc.lines.map((l: J) => l.rateMinor)).toEqual([100_000, 900_000]);
    expect(doc.schedule.map((s: J) => [s.label, s.pctBp])).toEqual([
      ["Start", 4000],
      ["Finish", 6000],
    ]);
    // The first service's text is the template's; the second adds its own under its name.
    expect(doc.sections.find((s: J) => s.kind === "deliverables").bodyMd).toBe("Small output\n\n**Big thing**\nBig output");
  });

  it("a service with default lines needs the lines chosen, and prices them in the client's currency", async () => {
    const o = await owner();
    const client = await mkQuoteClient();
    const tiers = [
      { description: "Essential", unit: "month", qtyMilli: 1000, rateInrMinor: 999_900, rateUsdMinor: 29_900 },
      { description: "Growth", unit: "month", qtyMilli: 1000, rateInrMinor: 2_499_900, rateUsdMinor: null },
    ];
    const item = await mkService(999_900, { default_lines: JSON.stringify(tiers) });
    const base = { type: "estimate", clientId: client.clientId };
    expect(await codeOf(await create(o.cookie, { ...base, services: [{ catalogueItemId: item.id }] }))).toBe("choose_default_lines");
    expect(await codeOf(await create(o.cookie, { ...base, services: [{ catalogueItemId: item.id, defaultLines: ["Nope"] }] }))).toBe("default_line_unknown");
    const ok = await create(o.cookie, { ...base, services: [{ catalogueItemId: item.id, defaultLines: ["Essential", "Growth"] }] });
    expect(ok.status).toBe(201);
    const doc = await getDoc(o, (await json(ok)).id);
    expect(doc.lines.map((l: J) => [l.description, l.rateMinor, l.catalogueRateMinor])).toEqual([
      ["Essential", 999_900, 999_900],
      ["Growth", 2_499_900, 2_499_900],
    ]);
    // A USD client: Growth has no USD price, so it is not offered.
    const usd = await mkQuoteClient({ currency: "USD", gst_status: "overseas", country: "US", state_code: null });
    const res = await create(o.cookie, { ...base, clientId: usd.clientId, services: [{ catalogueItemId: item.id, defaultLines: ["Growth"] }] });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("service_not_priced");
    const essential = await create(o.cookie, { ...base, clientId: usd.clientId, services: [{ catalogueItemId: item.id, defaultLines: ["Essential"] }] });
    expect((await getDoc(o, (await json(essential)).id)).lines[0]).toMatchObject({ rateMinor: 29_900 });
  });

  it("refuses an inactive, an unknown and an unpriced service, an anonymised client and another client's contact", async () => {
    const o = await owner();
    const client = await mkQuoteClient();
    const body = (itemId: string, over: Record<string, unknown> = {}) => ({
      type: "proposal",
      clientId: client.clientId,
      services: [{ catalogueItemId: itemId }],
      ...over,
    });
    const inactive = await mkService(100_000, { active: 0 });
    const unpriced = await mkService(100_000, { price_inr_minor: null });
    const before = await countOf("documents");
    expect(await codeOf(await create(o.cookie, body(inactive.id)))).toBe("service_inactive");
    expect(await codeOf(await create(o.cookie, body(unpriced.id)))).toBe("service_not_priced");
    expect(await codeOf(await create(o.cookie, body("no-such-item")))).toBe("service_unknown");
    const ok = await mkService();
    const other = await mkContact(await mkClient());
    expect(await codeOf(await create(o.cookie, body(ok.id, { contactId: other.id })))).toBe("contact_invalid");
    expect((await create(o.cookie, { ...body(ok.id), clientId: "no-such-client" })).status).toBe(404);
    const gone = await mkQuoteClient({ type: "individual", anonymised_at: Date.now() });
    expect(await codeOf(await create(o.cookie, body(ok.id, { clientId: gone.clientId })))).toBe("client_anonymised");
    expect(await countOf("documents")).toBe(before);
    expect((await create(o.cookie, { ...body(ok.id), services: [] })).status).toBe(400);
    expect((await create(o.cookie, { ...body(ok.id), extra: 1 })).status).toBe(400);
  });

  it("a lead is linked once, only to its own client", async () => {
    const o = await owner();
    const client = await mkQuoteClient();
    const item = await mkService();
    const lead = await mkLead("link@example.com", { client_id: client.clientId });
    const other = await mkLead("other@example.com", { client_id: await mkClient() });
    const none = await mkLead("none@example.com");
    const body = { type: "proposal", clientId: client.clientId, services: [{ catalogueItemId: item.id }] };
    expect(await codeOf(await create(o.cookie, { ...body, leadId: other }))).toBe("lead_client_mismatch");
    expect(await codeOf(await create(o.cookie, { ...body, leadId: none }))).toBe("lead_client_mismatch");
    const ok = await create(o.cookie, { ...body, leadId: lead });
    expect(ok.status).toBe(201);
    const id = (await json(ok)).id;
    expect(await one("SELECT proposal_id FROM leads WHERE id = ?", lead)).toEqual({ proposal_id: id });
    expect(await codeOf(await create(o.cookie, { ...body, leadId: lead }))).toBe("lead_has_proposal");
    expect(await countOf("documents", "client_id = ?", client.clientId)).toBe(1);
  });

  it("is atomic: a failure in the middle of the batch leaves no draft and no children", async () => {
    const o = await owner();
    const client = await mkQuoteClient();
    const item = await mkService(100_000, {
      schedule: JSON.stringify([{ label: "FAIL-LABEL", pctBp: 10_000, trigger: "on_accept" }]),
    });
    await env.DB.exec(
      "CREATE TRIGGER t_fail_schedule BEFORE INSERT ON payment_schedules WHEN NEW.label = 'FAIL-LABEL' BEGIN SELECT RAISE(ABORT, 'forced failure'); END",
    );
    const before = await countOf("documents");
    const lines = await countOf("document_lines");
    try {
      const res = await create(o.cookie, { type: "proposal", clientId: client.clientId, services: [{ catalogueItemId: item.id }] });
      expect(res.status).toBe(500);
    } finally {
      await env.DB.exec("DROP TRIGGER t_fail_schedule");
    }
    expect(await countOf("documents")).toBe(before);
    expect(await countOf("document_lines")).toBe(lines);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the list [ADM-G-03]", () => {
  it("shows the latest version of each document, newest first, keyset-paged, with the derived approval state", async () => {
    const o = await owner();
    const client = await mkQuoteClient();
    const made = [];
    for (let i = 0; i < 3; i++) made.push(await mkDraft(o, { clientId: client.clientId, contactId: client.contactId }));
    const est = await mkDraft(o, { type: "estimate", clientId: client.clientId, contactId: client.contactId });
    const all = await json(await call(`/clients/${client.clientId}/documents?limit=25`, { cookie: o.cookie }));
    expect(all.documents).toHaveLength(4);
    const created = all.documents.map((d: J) => d.createdAt);
    expect([...created].sort((a: number, b: number) => b - a)).toEqual(created);
    const proposals = await json(await call(`/documents?type=proposal&clientId=${client.clientId}`, { cookie: o.cookie }));
    expect(proposals.documents.map((d: J) => d.id).sort()).toEqual(made.map((m) => m.id).sort());
    expect((await json(await call(`/documents?type=estimate&clientId=${client.clientId}`, { cookie: o.cookie }))).documents[0].id).toBe(est.id);
    expect((await json(await call(`/documents?status=sent&clientId=${client.clientId}`, { cookie: o.cookie }))).documents).toEqual([]);
    // paging with a cursor of one: three pages for three proposals; a made-up cursor is a 400
    const seen: string[] = [];
    let after: string | null = null;
    for (let page = 0; page < 5; page++) {
      const res: J = await json(
        await call(`/documents?type=proposal&clientId=${client.clientId}&limit=25${after ? `&after=${after}` : ""}`, { cookie: o.cookie }),
      );
      seen.push(...res.documents.map((d: J) => d.id));
      after = res.next;
      if (!after) break;
    }
    expect(seen).toHaveLength(3);
    expect((await call("/documents?after=not-a-cursor", { cookie: o.cookie })).status).toBe(400);
    // a revised document appears once, as its latest version
    await sendOk(o, made[0]?.id as string);
    const revised = await call(`/documents/${made[0]?.id}/revise`, { cookie: o.cookie, body: {} });
    expect(revised.status, await revised.clone().text()).toBe(201);
    const again = await json(await call(`/documents?type=proposal&clientId=${client.clientId}`, { cookie: o.cookie }));
    expect(again.documents).toHaveLength(3);
    expect(again.documents.some((d: J) => d.version === 2)).toBe(true);
    expect(again.documents.some((d: J) => d.id === made[0]?.id)).toBe(false);
  });

  it("a pending approval is shown from the approvals row, never stored as a status", async () => {
    const o = await owner();
    const sales = await sessionFor("sales");
    const made = await mkDraft(sales, { price: 20_000_000 });
    await discount(sales, made.id, "fixed", 5_000_000);
    const cur = await getDoc(sales, made.id);
    expect(cur.guard.needsApproval).toBe(true);
    const req = await call(`/documents/${made.id}/approval-request`, { cookie: sales.cookie, body: { expectedUpdatedAt: cur.updatedAt } });
    expect(req.status, await req.clone().text()).toBe(201);
    const list = await json(await call(`/documents?clientId=${made.clientId}`, { cookie: o.cookie }));
    expect(list.documents[0]).toMatchObject({ status: "draft", approval: "pending" });
    expect(await one("SELECT status FROM documents WHERE id = ?", made.id)).toEqual({ status: "draft" });
  });
});

async function sendOk(s: { cookie: string }, id: string) {
  const doc = await json(await call(`/documents/${id}`, { cookie: s.cookie }));
  const res = await call(`/documents/${id}/send`, { cookie: s.cookie, body: { expectedUpdatedAt: doc.updatedAt } });
  expect(res.status, await res.clone().text()).toBe(200);
  return json(res);
}

// ---------------------------------------------------------------------------------------------------------------
describe("saving a draft [ADM-PROP-02, -03, ADM-APR-02]", () => {
  it("parts not sent are kept; the same save twice gives the same hash; a change gives another [lead decision 4, 7]", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    const lineIds = doc.lines.map((l: J) => l.id);
    const sectionIds = doc.sections.map((s: J) => s.id);
    const first = await json(await patchDoc(o, made.id, { expectedUpdatedAt: doc.updatedAt, fields: { title: "A new title" } }));
    expect(first.title).toBe("A new title");
    expect(first.lines.map((l: J) => l.id)).toEqual(lineIds);
    expect(first.sections.map((s: J) => s.id)).toEqual(sectionIds);
    expect(first.contentSha256).not.toBe(doc.contentSha256);
    // the same content again: the hash does not move (ids are not part of it)
    const same = await json(await patchDoc(o, made.id, { expectedUpdatedAt: first.updatedAt, fields: { title: "A new title" } }));
    expect(same.contentSha256).toBe(first.contentSha256);
    expect(same.updatedAt).toBeGreaterThan(first.updatedAt);
    // a description in a line changes it; going back gives the first hash again (no memory of past content)
    const line = first.lines[0];
    const edit = (description: string, v: J) =>
      patchDoc(o, made.id, {
        expectedUpdatedAt: v.updatedAt,
        lines: [{ id: line.id, description, qtyMilli: line.qtyMilli, unit: line.unit, rateMinor: line.rateMinor }],
      });
    const changed = await json(await edit("Another description", same));
    expect(changed.contentSha256).not.toBe(first.contentSha256);
    const back = await json(await edit(line.description, changed));
    expect(back.contentSha256).toBe(first.contentSha256);
    // the stored hash is the one the view reports
    expect((await one<{ content_sha256: string }>("SELECT content_sha256 FROM documents WHERE id = ?", made.id))?.content_sha256).toBe(back.contentSha256);
  });

  it("a stale save changes nothing, and every child row stays as it was [guarded side statements]", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    const state = async () =>
      JSON.stringify([
        await rows("SELECT * FROM document_lines WHERE document_id = ? ORDER BY position", made.id),
        await rows("SELECT * FROM document_sections WHERE document_id = ? ORDER BY position", made.id),
        await rows("SELECT * FROM payment_schedules WHERE document_id = ? ORDER BY position", made.id),
        await rows("SELECT * FROM documents WHERE id = ?", made.id),
        await rows("SELECT * FROM approvals WHERE document_id = ?", made.id),
      ]);
    const before = await state();
    const res = await patchDoc(o, made.id, {
      expectedUpdatedAt: doc.updatedAt - 1,
      fields: { title: "Stale" },
      lines: [{ description: "Lost", qtyMilli: 1000, unit: "fixed", rateMinor: 5 }],
      sections: [
        { kind: "estimate", title: "E", bodyMd: "lost" },
        { kind: "terms" },
        { kind: "acceptance" },
      ],
      schedule: [{ label: "All", trigger: "on_accept", pctBp: 10_000 }],
    });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("stale_version");
    expect(await state()).toBe(before);
  });

  it("a save racing another one: the second is refused whole (one wins, nothing is half written)", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    const body = (title: string) => ({
      expectedUpdatedAt: doc.updatedAt,
      fields: { title },
      lines: [{ description: title, qtyMilli: 1000, unit: "fixed", rateMinor: 700 }],
    });
    // Both read the document before either writes.
    const gate = barrierDb(env.DB, 2);
    const results = await Promise.all([
      call(`/documents/${made.id}`, { method: "PATCH", cookie: o.cookie, body: body("one") }, withDb(gate)),
      call(`/documents/${made.id}`, { method: "PATCH", cookie: o.cookie, body: body("two") }, withDb(gate)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const title = (await one<{ title: string }>("SELECT title FROM documents WHERE id = ?", made.id))?.title;
    const lines = await rows<{ description: string }>("SELECT description FROM document_lines WHERE document_id = ?", made.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.description).toBe(title);
  });

  it("refuses what a request must never carry: the catalogue reference, trusted rates, a target total, a number, a status, a hash", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    const line = doc.lines[0];
    const base = { expectedUpdatedAt: doc.updatedAt };
    const withLine = (extra: J) => ({
      ...base,
      lines: [{ id: line.id, description: "x", qtyMilli: 1000, unit: "fixed", rateMinor: 1, ...extra }],
    });
    for (const body of [
      withLine({ catalogueRateMinor: 1 }),
      withLine({ trustRates: true }),
      { ...base, trustRates: true },
      { ...base, targetTotalMinor: 100 },
      { ...base, fields: { targetTotalMinor: 100 } },
      { ...base, fields: { status: "sent" } },
      { ...base, number: "TH/PRP/2627/0001" },
      { ...base, contentSha256: "x" },
      { ...base, computed: {} },
      { ...base, fields: { catalogueRateMinor: 1 } },
    ]) {
      expect((await patchDoc(o, made.id, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await one("SELECT catalogue_rate_minor FROM document_lines WHERE id = ?", line.id)).toEqual({ catalogue_rate_minor: 100_000 });
  });

  it("line rules: the service of a line never changes, a catalogue line's SAC and rate are fixed, an inactive service cannot be added", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    const line = doc.lines[0];
    const keep = { id: line.id, description: "x", qtyMilli: 1000, unit: "fixed", rateMinor: 90_000 };
    const other = await mkService();
    const at = (lines: J[]) => patchDoc(o, made.id, { expectedUpdatedAt: doc.updatedAt, lines });
    expect(await codeOf(await at([{ ...keep, catalogueItemId: other.id }]))).toBe("line_catalogue_changed");
    expect(await codeOf(await at([{ ...keep, catalogueItemId: null }]))).toBe("line_catalogue_changed");
    expect(await codeOf(await at([{ ...keep, sac: "998313" }]))).toBe("line_tax_fixed");
    expect(await codeOf(await at([{ ...keep, gstRateBp: 500 }]))).toBe("line_tax_fixed");
    expect(await codeOf(await at([{ ...keep, id: "no-such-line" }]))).toBe("line_unknown");
    expect(await codeOf(await at([keep, keep]))).toBe("line_unknown"); // the same line twice
    const inactive = await mkService(100_000, { active: 0 });
    const res = await at([keep, { catalogueItemId: inactive.id, description: "n", qtyMilli: 1000, unit: "fixed" }]);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("service_inactive");
    expect(await codeOf(await at([keep, { catalogueItemId: "no-such-item", description: "n", qtyMilli: 1000, unit: "fixed" }]))).toBe("service_unknown");
    expect(await codeOf(await at([keep, { description: "custom without a rate", qtyMilli: 1000, unit: "fixed" }]))).toBe("rate_required");
    // a new line from the catalogue takes its SAC, rate and reference; a typed rate below it is a discount the guard sees
    const ok = await mkService(400_000, { sac: "998313" });
    const saved = await json(await at([keep, { catalogueItemId: ok.id, description: "Added", qtyMilli: 1000, unit: "fixed", rateMinor: 300_000 }]));
    expect(saved.lines[1]).toMatchObject({ catalogueItemId: ok.id, sac: "998313", catalogueRateMinor: 400_000, rateMinor: 300_000 });
    // Reference 100,000 + 400,000 = 500,000; typed 90,000 + 300,000 = 390,000 (plus the line's own change): D = 110,000, 2200 bp.
    expect(saved.guard).toMatchObject({ referenceMinor: 500_000, taxableMinor: 390_000, discountMinor: 110_000, discountBp: 2200, needsApproval: true });
    // an existing line keeps its reference even when its rate is edited, and a custom line has none
    const custom = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: saved.updatedAt,
        lines: [
          { id: line.id, description: "x", qtyMilli: 1000, unit: "fixed", rateMinor: 100_000 },
          { description: "Custom work", qtyMilli: 2000, unit: "hour", rateMinor: 7_500, sac: "998314", gstRateBp: 500 },
        ],
      }),
    );
    expect(custom.lines[0].catalogueRateMinor).toBe(100_000);
    expect(custom.lines[1]).toMatchObject({ catalogueItemId: null, catalogueRateMinor: null, sac: "998314", gstRateBp: 500 });
  });

  it("an existing line whose service was deactivated later still saves and sends", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    await env.DB.prepare("UPDATE catalogue_items SET active = 0 WHERE id = ?").bind(made.itemId).run();
    const doc = await getDoc(o, made.id);
    const line = doc.lines[0];
    const saved = await patchDoc(o, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      lines: [{ id: line.id, description: "Still here", qtyMilli: 1000, unit: "fixed", rateMinor: 100_000 }],
    });
    expect(saved.status).toBe(200);
    const view = await json(saved);
    expect((await sendDoc(o, made.id, view.updatedAt)).status).toBe(200);
  });

  it("101 lines is a 400; a body over 96 KB is a 413; a cap-sized save of 100 lines passes", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    const line = (i: number) => ({
      description: `Line ${i} ${"d".repeat(110)}`,
      detail: "x".repeat(200),
      qtyMilli: 1000,
      unit: "fixed",
      rateMinor: 1_000 + i,
      sac: "998314",
    });
    const hundred = Array.from({ length: 100 }, (_, i) => line(i));
    const sections = [
      { kind: "estimate", title: "Estimate", bodyMd: "e".repeat(5_000) },
      { kind: "terms", title: "Terms", bodyMd: "t".repeat(5_000) },
      { kind: "acceptance", title: "Acceptance", bodyMd: "a".repeat(5_000) },
      { kind: "summary", title: "Summary", bodyMd: "s".repeat(5_000) },
      { kind: "scope", title: "Scope", bodyMd: "c".repeat(5_000) },
      { kind: "team", title: "Team", bodyMd: "m".repeat(5_000) },
    ]; // 30,000 characters: the cap
    expect((await patchDoc(o, made.id, { expectedUpdatedAt: doc.updatedAt, lines: [...hundred, line(100)] })).status).toBe(400);
    const huge = await patchDoc(o, made.id, { expectedUpdatedAt: doc.updatedAt, sections: [{ kind: "estimate", bodyMd: "z".repeat(100_000) }] });
    expect(huge.status).toBe(413);
    const res = await patchDoc(o, made.id, { expectedUpdatedAt: doc.updatedAt, lines: hundred, sections });
    expect(res.status, (await res.clone().text()).slice(0, 300)).toBe(200);
    const saved = await json(res);
    expect(saved.lines).toHaveLength(100);
    expect(await countOf("document_lines", "document_id = ?", made.id)).toBe(100);
    expect(saved.schedule.reduce((a: number, s: J) => a + s.amountMinor, 0)).toBe(saved.totals.totalMinor);
  });

  it("sections: the rules come back as codes; a rejected save writes nothing", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    const save = (sections: J[]) => patchDoc(o, made.id, { expectedUpdatedAt: doc.updatedAt, sections });
    const all3 = [{ kind: "estimate" }, { kind: "terms" }, { kind: "acceptance" }];
    const missing = await save([{ kind: "estimate" }, { kind: "terms" }]);
    expect(missing.status).toBe(400);
    expect(((await json(missing)) as J).codes).toEqual(["required_missing"]);
    expect(((await json(await save([{ kind: "estimate", hidden: true }, { kind: "terms" }, { kind: "acceptance" }]))) as J).codes).toEqual(["required_hidden"]);
    expect(((await json(await save([...all3, { kind: "scope" }, { kind: "scope" }]))) as J).codes).toEqual(["section_duplicate"]);
    expect((await save([...all3, { kind: "pricing" }])).status).toBe(400);
    expect(((await json(await save([...all3, ...Array.from({ length: 4 }, () => ({ kind: "custom" }))]))) as J).codes).toEqual(["custom_limit"]);
    expect(((await json(await save([{ kind: "estimate", bodyMd: "x".repeat(6_001) }, { kind: "terms" }, { kind: "acceptance" }]))) as J).codes).toEqual(["section_too_long"]);
    // reordering is allowed, and so is hiding a section that is not required
    const ok = await json(await save([{ kind: "acceptance" }, { kind: "scope", hidden: true, title: "Hidden" }, { kind: "terms" }, { kind: "estimate" }]));
    expect(ok.sections.map((s: J) => s.kind)).toEqual(["acceptance", "scope", "terms", "estimate"]);
    expect(ok.sections[1].hidden).toBe(true);
  });

  it("engine errors are saved and returned (a draft may be incomplete): no lines, a bad schedule, a discount over the subtotal", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    const none = await json(await patchDoc(o, made.id, { expectedUpdatedAt: doc.updatedAt, lines: [] }));
    expect(none.totals).toBeNull();
    expect(none.errors).toContainEqual({ code: "no_lines", path: ["lines"] });
    expect(none.canSend).toBe(false);
    expect(none.blockers.map((b: J) => b.code)).toContain("no_lines");
    expect(await one("SELECT total_minor, computed FROM documents WHERE id = ?", made.id)).toEqual({ total_minor: 0, computed: null });
    const line = { description: "Back", qtyMilli: 1000, unit: "fixed", rateMinor: 10_000 };
    const bad = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: none.updatedAt,
        lines: [line],
        schedule: [
          { label: "Half", trigger: "on_accept", pctBp: 5000 },
          { label: "Another half minus", trigger: "delivery", pctBp: 4000 },
        ],
      }),
    );
    expect(bad.errors.map((e: J) => e.code)).toContain("schedule_pct_sum");
    expect(bad.canSend).toBe(false);
    const over = await json(await patchDoc(o, made.id, { expectedUpdatedAt: bad.updatedAt, fields: { discount: { kind: "fixed", value: 99_999_999 } } }));
    expect(over.errors.map((e: J) => e.code)).toContain("document_discount_exceeds_subtotal");
    expect(over.totals).toBeNull();
  });

  it("the instalments always add up to the total, whatever the split and the amounts [ADM-PROP-03]", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    let view = await getDoc(o, made.id);
    let seed = 20_261_025;
    const rand = (n: number) => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 25; round++) {
      const steps = 2 + rand(4);
      const cuts = Array.from({ length: steps - 1 }, () => 1 + rand(9_998)).sort((a, b) => a - b);
      const pcts = [...cuts, 10_000].map((c, i) => c - (cuts[i - 1] ?? 0)).filter((p) => p > 0);
      const lines = Array.from({ length: 1 + rand(5) }, (_, i) => ({
        description: `L${i}`,
        qtyMilli: 1 + rand(5_000),
        unit: "fixed",
        rateMinor: rand(5_000_000),
        ...(rand(3) === 0 ? { discount: { kind: "percent", value: rand(2_000) } } : {}),
      }));
      const res = await patchDoc(o, made.id, {
        expectedUpdatedAt: view.updatedAt,
        lines,
        schedule: pcts.map((pctBp, i) => ({ label: `Step ${i}`, trigger: i === 0 ? "on_accept" : "milestone", pctBp })),
      });
      expect(res.status).toBe(200);
      view = await json(res);
      if (!view.totals) continue; // a zero or odd total can be refused by the engine; the sum property is about the ones that compute
      expect(view.schedule.reduce((a: number, s: J) => a + s.amountMinor, 0), `round ${round}`).toBe(view.totals.totalMinor);
      const stored = await rows<{ amount_minor: number }>("SELECT amount_minor FROM payment_schedules WHERE document_id = ?", made.id);
      expect(stored.reduce((a, r) => a + r.amount_minor, 0)).toBe(view.totals.totalMinor);
    }
  });

  it("a document discount moves every line's share, so the stored lines follow even when only the discount was sent", async () => {
    const o = await owner();
    const made = await mkDraft(o, { price: 1_000_000 });
    const before = await one<{ taxable_minor: number }>("SELECT taxable_minor FROM document_lines WHERE document_id = ?", made.id);
    expect(before?.taxable_minor).toBe(1_000_000);
    await discount(o, made.id, "percent", 1000);
    expect(await one("SELECT taxable_minor, line_total_minor FROM document_lines WHERE document_id = ?", made.id)).toEqual({
      taxable_minor: 900_000,
      line_total_minor: 1_062_000, // 900,000 + 18 % = 162,000
    });
    expect(await one("SELECT total_minor FROM documents WHERE id = ?", made.id)).toEqual({ total_minor: 1_062_000 });
    expect((await one<{ amount_minor: number }>("SELECT amount_minor FROM payment_schedules WHERE document_id = ?", made.id))?.amount_minor).toBe(1_062_000);
  });

  it("contact, validity and terms: a contact of another client is refused, null clears it, the newest terms can be adopted", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    const other = await mkContact(await mkClient());
    expect(await codeOf(await patchDoc(o, made.id, { expectedUpdatedAt: doc.updatedAt, fields: { contactId: other.id } }))).toBe("contact_invalid");
    const cleared = await json(await patchDoc(o, made.id, { expectedUpdatedAt: doc.updatedAt, fields: { contactId: null, validityDays: 30 } }));
    expect(cleared.contact).toBeNull();
    expect(cleared.validityDays).toBe(30);
    expect((await patchDoc(o, made.id, { expectedUpdatedAt: cleared.updatedAt, fields: { validityDays: 91 } })).status).toBe(400);
    expect(cleared.termsOutdated).toBe(false);
    const newer = await mkTerms();
    const stale = await getDoc(o, made.id);
    expect(stale.termsOutdated).toBe(true);
    const adopted = await json(await patchDoc(o, made.id, { expectedUpdatedAt: stale.updatedAt, fields: { refreshTerms: true } }));
    expect(adopted.terms.id).toBe(newer);
    expect(adopted.termsOutdated).toBe(false);
  });

  it("a monthly line in a proposal raises a warning; an estimate does not [owner O-Q3]", async () => {
    const o = await owner();
    const proposal = await mkDraft(o);
    const estimate = await mkDraft(o, { type: "estimate" });
    for (const [made, warned] of [
      [proposal, true],
      [estimate, false],
    ] as const) {
      const doc = await getDoc(o, made.id);
      const view = await json(
        await patchDoc(o, made.id, {
          expectedUpdatedAt: doc.updatedAt,
          lines: [{ description: "Monthly care", qtyMilli: 1000, unit: "month", rateMinor: 50_000 }],
        }),
      );
      expect(view.warnings.some((w: J) => w.code === "monthly_line_in_proposal")).toBe(warned);
    }
  });

  it("a sent version cannot be saved, and the database refuses the same change in raw SQL", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const sent = await sendOk(o, made.id);
    const res = await patchDoc(o, made.id, { expectedUpdatedAt: sent.updatedAt, fields: { title: "Late" } });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("frozen");
    await expect(env.DB.prepare("UPDATE documents SET title = 'Late' WHERE id = ?").bind(made.id).run()).rejects.toThrow(/frozen/);
    await expect(env.DB.prepare("DELETE FROM document_lines WHERE document_id = ?").bind(made.id).run()).rejects.toThrow(/cannot change/);
  });

  it("a save re-works the draft from the client's current record: a changed GST state moves the tax, and an empty save brings the hash up to date", async () => {
    const o = await owner();
    const made = await mkDraft(o, { price: 1_000_000 });
    expect((await getDoc(o, made.id)).totals).toMatchObject({ cgstMinor: 90_000, sgstMinor: 90_000, igstMinor: 0 });
    await env.DB.prepare("UPDATE clients SET state_code = '27' WHERE id = ?").bind(made.clientId).run();
    const view = await getDoc(o, made.id);
    expect(view.totals).toMatchObject({ cgstMinor: 0, igstMinor: 180_000 }); // inter-state: IGST 18 %
    expect(view.needsResave).toBe(true);
    const saved = await json(await patchDoc(o, made.id, { expectedUpdatedAt: view.updatedAt }));
    expect(saved.needsResave).toBe(false);
    expect(await one("SELECT igst_minor, cgst_minor, supply_type FROM documents WHERE id = ?", made.id)).toEqual({ igst_minor: 180_000, cgst_minor: 0, supply_type: "inter" });
    expect(await one("SELECT igst_minor FROM document_lines WHERE document_id = ?", made.id)).toEqual({ igst_minor: 180_000 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("discarding and revising [ADM-PROP-05]", () => {
  it("a draft is discarded with its approvals, and the lead's link is cleared; a sent version cannot be", async () => {
    const o = await owner();
    const client = await mkQuoteClient();
    const item = await mkService(20_000_000);
    const lead = await mkLead("discard@example.com", { client_id: client.clientId });
    const res = await create(o.cookie, { type: "proposal", clientId: client.clientId, leadId: lead, services: [{ catalogueItemId: item.id }] });
    const id = (await json(res)).id as string;
    const v = await discount(o, id, "fixed", 5_000_000);
    await call(`/documents/${id}/approval-request`, { cookie: o.cookie, body: { expectedUpdatedAt: v.updatedAt } });
    expect(await countOf("approvals", "document_id = ?", id)).toBe(1);
    const stale = await call(`/documents/${id}?expectedUpdatedAt=1`, { method: "DELETE", cookie: o.cookie });
    expect(stale.status).toBe(409);
    expect(await countOf("documents", "id = ?", id)).toBe(1);
    expect(await countOf("approvals", "document_id = ?", id)).toBe(1); // the guarded deletes did not run
    expect((await call(`/documents/${id}`, { method: "DELETE", cookie: o.cookie })).status).toBe(400);
    const gone = await call(`/documents/${id}?expectedUpdatedAt=${v.updatedAt}`, { method: "DELETE", cookie: o.cookie });
    expect(gone.status, await gone.clone().text()).toBe(200);
    expect(await countOf("documents", "id = ?", id)).toBe(0);
    expect(await countOf("approvals", "document_id = ?", id)).toBe(0);
    expect(await countOf("document_lines", "document_id = ?", id)).toBe(0);
    expect(await one("SELECT proposal_id FROM leads WHERE id = ?", lead)).toEqual({ proposal_id: null });
    expect((await call(`/documents/${id}?expectedUpdatedAt=${v.updatedAt}`, { method: "DELETE", cookie: o.cookie })).status).toBe(404);

    const made = await mkDraft(o);
    const sent = await sendOk(o, made.id);
    const frozen = await call(`/documents/${made.id}?expectedUpdatedAt=${sent.updatedAt}`, { method: "DELETE", cookie: o.cookie });
    expect(frozen.status).toBe(409);
    expect(await codeOf(frozen)).toBe("frozen");
    expect(await countOf("documents", "id = ?", made.id)).toBe(1);
  });

  it("revise: a new draft from the latest sent version, with new ids, the same catalogue rates and the newest terms", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const v1 = await sendOk(o, made.id);
    expect(v1.version).toBe(1);
    const newer = await mkTerms();
    const res = await call(`/documents/${made.id}/revise`, { cookie: o.cookie, body: {} });
    expect(res.status, await res.clone().text()).toBe(201);
    const v2 = await json(res);
    expect(v2.version).toBe(2);
    expect(v2.versionGroupId).toBe(made.id);
    const doc = await getDoc(o, v2.id);
    const first = await getDoc(o, made.id);
    expect(doc).toMatchObject({ status: "draft", version: 2, number: null, frozen: false });
    expect(doc.terms.id).toBe(newer);
    expect(first.terms.id).not.toBe(newer);
    expect(doc.lines[0].id).not.toBe(first.lines[0].id);
    expect(doc.lines[0].catalogueRateMinor).toBe(first.lines[0].catalogueRateMinor);
    expect(doc.versions.map((v: J) => [v.version, v.status])).toEqual([
      [1, "sent"],
      [2, "draft"],
    ]);
    expect(first.status).toBe("sent"); // still acceptable until v2 is sent
  });

  it("revise is refused: a draft, a second draft, a version that is not the latest, an accepted group", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const draftRevise = await call(`/documents/${made.id}/revise`, { cookie: o.cookie, body: {} });
    expect(draftRevise.status).toBe(409);
    expect(await codeOf(draftRevise)).toBe("not_sent");
    await sendOk(o, made.id);
    const v2 = await json(await call(`/documents/${made.id}/revise`, { cookie: o.cookie, body: {} }));
    const again = await call(`/documents/${made.id}/revise`, { cookie: o.cookie, body: {} });
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("draft_exists");
    expect(await codeOf(await call(`/documents/${v2.id}/revise`, { cookie: o.cookie, body: {} }))).toBe("not_sent"); // v2 is a draft
    await sendOk(o, v2.id);
    expect(await codeOf(await call(`/documents/${made.id}/revise`, { cookie: o.cookie, body: {} }))).toBe("not_latest");
    // a group with an accepted version (acceptance itself arrives with M4.5; the test sets it)
    await env.DB.prepare("UPDATE documents SET status = 'accepted' WHERE id = ?").bind(v2.id).run();
    expect(await codeOf(await call(`/documents/${v2.id}/revise`, { cookie: o.cookie, body: {} }))).toBe("already_accepted");
    expect((await call("/documents/no-such-id/revise", { cookie: o.cookie, body: {} })).status).toBe(404);
    // two revisions racing: one draft, one 409
    const racing = await mkDraft(o);
    await sendOk(o, racing.id);
    const results = await Promise.all([
      call(`/documents/${racing.id}/revise`, { cookie: o.cookie, body: {} }),
      call(`/documents/${racing.id}/revise`, { cookie: o.cookie, body: {} }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await countOf("documents", "version_group_id = ? AND frozen_at IS NULL", racing.id)).toBe(1);
  });
});

void mkItem;
