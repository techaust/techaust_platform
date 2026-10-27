// The M5.1 review fixes (code) [ADM-INV-01..04, ADM-INV-07, ADM-APR-01, ADM-PRJ-02, ADM-SET-04; VERIFY WITH CA/LEGAL, DPDP]: one describe per finding of the
// run file's review (1 contact, 4 numbering read, 5 pending milestone, 6 names, 8 approval by id, 9 erase, 10 emails, 13 session, 14 helpers).
import { env } from "cloudflare:workers";
import { SETTINGS_DEFAULTS } from "@techaust/core";
import { bundleOf, loadStatements, type TermsRow } from "@techaust/db/documents";
import { invoiceEnvelopeOfBundle, verifyInvoiceEnvelope } from "@techaust/pdf";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkContact, mkDoc } from "./test-clients.ts";
import { call, captureQueue, countOf, one, rows, sessionFor } from "./test-helpers.ts";
import {
  auditCount,
  codeOf,
  decideApproval,
  farSession,
  getInvoice,
  invoiceCounter,
  invoiceRow,
  issueBodyOf,
  issueInvoice,
  type J,
  json,
  mkInvoice,
  mkInvoiceClient,
  mkReadyMilestone,
  patchInvoice,
  putBank,
  putCompany,
  requestIssue,
  voidInvoice,
} from "./test-invoices.ts";
import { mkMilestone, mkProject } from "./test-projects.ts";
import { beforeBatchHolding } from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeAll(async () => {
  await putCompany();
  await putBank();
});
afterEach(() => vi.useRealTimers());

/** What a refusal must leave as it was. */
async function state(id: string) {
  return {
    counter: await invoiceCounter(),
    issueAudits: await auditCount("invoice.issue"),
    approvals: await countOf("approvals"),
    row: await invoiceRow(id),
  };
}

/** The envelope of an issued invoice read back the way the jobs Worker reads it, and what verifying it says. */
async function envelopeCheck(id: string) {
  const bundle = bundleOf<TermsRow>(await env.DB.batch(loadStatements(env.DB, id)));
  if (!bundle) throw new Error("no bundle");
  const made = await invoiceEnvelopeOfBundle(bundle);
  if (!made.ok) return { made: made.code, verdict: null };
  return { made: "ok", verdict: await verifyInvoiceEnvelope(made.envelope) };
}

const anonymise = (s: Awaited<ReturnType<typeof owner>>, contactId: string) =>
  call(`/contacts/${contactId}/erase`, {
    cookie: s.cookie,
    body: { mode: "anonymise", reason: "requested" },
  });

describe("review 1: a draft's contact that was anonymised can never be frozen into an invoice whose PDF refuses [high]", () => {
  it("a draft that still names an anonymised contact (an older row) is 409 contact_anonymised on issue and on the issue request, and nothing is written", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const made = await mkInvoice(o);
    // The older shape: the contact was anonymised without the draft being touched.
    await env.DB.prepare("UPDATE contacts SET name = 'Erased', anonymised_at = 5 WHERE id = ?")
      .bind(made.contactId)
      .run();
    const before = await state(made.id);
    const res = await issueInvoice(o, made.id);
    expect(res.status, await res.clone().text()).toBe(409);
    const body = await json(res);
    expect(body.error.code).toBe("contact_anonymised");
    expect(body.error.message).toBe(
      "This draft's contact has been anonymised. Choose another contact, then save the draft.",
    );
    const req = await requestIssue(staff, made.id);
    expect(req.status).toBe(409);
    expect(await codeOf(req)).toBe("contact_anonymised");
    expect(await state(made.id)).toEqual(before);
    // the way out: choose another contact and save; then it issues and its PDF verifies
    const other = await mkContact(made.clientId, { name: "Second Person" });
    const draft = await getInvoice(o, made.id);
    const save = await patchInvoice(o, made.id, {
      expectedUpdatedAt: draft.updatedAt,
      fields: { contactId: other.id },
    });
    expect(save.status, await save.clone().text()).toBe(200);
    const ok = await issueInvoice(o, made.id);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await envelopeCheck(made.id)).toEqual({ made: "ok", verdict: { ok: true } });
  });

  it("anonymising a contact through the API takes it off the client's drafts and clears their saved hash, so the draft is saved again before it is issued", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    const second = await mkContact(made.clientId, { name: "Second Person" });
    const sentDraft = await mkDoc(made.clientId, "proposal");
    await env.DB.prepare("UPDATE documents SET contact_id = ?2 WHERE id = ?1")
      .bind(sentDraft, made.contactId)
      .run();
    expect((await anonymise(o, made.contactId)).status).toBe(200);
    expect(await invoiceRow(made.id)).toMatchObject({ content_sha256: null });
    expect(await one("SELECT contact_id FROM documents WHERE id = ?", made.id)).toEqual({ contact_id: null });
    // the proposal draft of the same client loses it too (the same statement as the erase)
    expect(await one("SELECT contact_id, content_sha256 FROM documents WHERE id = ?", sentDraft)).toEqual({
      contact_id: null,
      content_sha256: null,
    });
    // saving the draft again with a live contact makes it issuable, and the PDF check passes
    const draft = await getInvoice(o, made.id);
    expect(draft.contact).toBeNull();
    const save = await patchInvoice(o, made.id, {
      expectedUpdatedAt: draft.updatedAt,
      fields: { contactId: second.id },
    });
    expect(save.status, await save.clone().text()).toBe(200);
    const ok = await issueInvoice(o, made.id);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await envelopeCheck(made.id)).toEqual({ made: "ok", verdict: { ok: true } });
  });

  it("re-check low 2: anonymising the contact expires the draft's waiting issue request and moves updated_at, so a stale save is 409", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const made = await mkInvoice(o);
    const req = await requestIssue(staff, made.id);
    expect(req.status, await req.clone().text()).toBe(201);
    const before = await getInvoice(o, made.id);
    expect(await countOf("approvals", "document_id = ? AND status = 'pending'", made.id)).toBe(1);
    expect((await anonymise(o, made.contactId)).status).toBe(200);
    expect(await countOf("approvals", "document_id = ? AND status = 'pending'", made.id)).toBe(0);
    expect(await one("SELECT status FROM approvals WHERE document_id = ?", made.id)).toEqual({
      status: "expired",
    });
    // M5.1 L2: one `approval.expire` audit row per request expired, by the person who anonymised: ids and the cause, nothing else
    const approvalId = (await one<{ id: string }>("SELECT id FROM approvals WHERE document_id = ?", made.id))
      ?.id;
    const audits = await rows<{ entity_id: string; actor_id: string; role: string; summary: string }>(
      "SELECT entity_id, actor_id, role, summary FROM audit_log WHERE action = 'approval.expire' AND entity_id = ?",
      approvalId,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entity_id: approvalId, role: "owner" });
    expect(JSON.parse(audits[0]?.summary ?? "{}")).toEqual({
      approvalId,
      documentId: made.id,
      cause: "contact_anonymised",
    });
    const after = await getInvoice(o, made.id);
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    const stale = await patchInvoice(o, made.id, {
      expectedUpdatedAt: before.updatedAt,
      fields: { contactId: null },
    });
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe("stale_version");
  });

  it("an issue with no contact at all also round-trips: the issue, the envelope, the verification", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    const draft = await getInvoice(o, made.id);
    expect(
      (await patchInvoice(o, made.id, { expectedUpdatedAt: draft.updatedAt, fields: { contactId: null } }))
        .status,
    ).toBe(200);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    expect(await envelopeCheck(made.id)).toEqual({ made: "ok", verdict: { ok: true } });
  });

  it("one real issue to envelope to verification round trip, and a contact anonymised AFTER the issue leaves the issued invoice and its PDF check as they were", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    const res = await issueInvoice(o, made.id);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await envelopeCheck(made.id)).toEqual({ made: "ok", verdict: { ok: true } });
    expect((await anonymise(o, made.contactId)).status).toBe(200);
    // the frozen invoice is untouched by the anonymise (it keeps its recipient block and the draft's contact id)
    expect(await envelopeCheck(made.id)).toEqual({ made: "ok", verdict: { ok: true } });
  });
});

describe("review 4: the numbering first-character rule is for saving; a stored format still reads [LD18; VERIFY WITH CA/LEGAL]", () => {
  it("a stored {N}/{FY} row (valid before M5.1) does not turn the invoice routes into a 500: the draft reads and issues, and the Settings page opens; a save that CHANGES a series to such a format is refused, while the stored one never blocks another series", async () => {
    const o = await owner();
    const stored = { ...SETTINGS_DEFAULTS.numbering, invoice: { template: "{N}/{FY}", padding: 4 } };
    await env.DB.prepare("DELETE FROM settings WHERE key = 'numbering'").run();
    await env.DB.prepare("INSERT INTO settings (key, value, version) VALUES ('numbering', ?, 1)")
      .bind(JSON.stringify(stored))
      .run();
    try {
      const made = await mkInvoice(o);
      expect((await call(`/invoices/${made.id}`, { cookie: o.cookie })).status).toBe(200);
      expect((await call("/invoices", { cookie: o.cookie })).status).toBe(200);
      expect((await call("/settings/groups/numbering", { cookie: o.cookie })).status).toBe(200);
      const res = await issueInvoice(o, made.id);
      expect(res.status, await res.clone().text()).toBe(200);
      expect((await json(res)).number).toMatch(/^\d{4}\/\d{4}$/);
      // the rule is for what a save CHANGES: moving that series to another format that breaks it is refused, with the reason
      const refused = await call("/settings/groups/numbering", {
        method: "PUT",
        cookie: o.cookie,
        body: { version: 1, value: { ...stored, estimate: { template: "-{N}/{FY}", padding: 4 } } },
      });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(await json(refused))).toContain('"path":"estimate"');
      // ... but the stored format of ANOTHER series no longer blocks every numbering save: changing a valid series saves, the stored one is kept as it is
      const saved = await call("/settings/groups/numbering", {
        method: "PUT",
        cookie: o.cookie,
        body: { version: 1, value: { ...stored, estimate: { template: "TH/Q/{FY}/{N}", padding: 4 } } },
      });
      expect(saved.status, await saved.clone().text()).toBe(200);
      const after = await json(await call("/settings/groups/numbering", { cookie: o.cookie }));
      expect(after.value.invoice).toEqual({ template: "{N}/{FY}", padding: 4 });
      expect(after.value.estimate).toEqual({ template: "TH/Q/{FY}/{N}", padding: 4 });
      // saving the stored format unchanged is a no-op, not a refusal
      const same = await call("/settings/groups/numbering", {
        method: "PUT",
        cookie: o.cookie,
        body: { version: after.version, value: after.value },
      });
      expect(same.status, await same.clone().text()).toBe(200);
      expect((await json(same)).changed).toBe(false);
    } finally {
      await env.DB.prepare("DELETE FROM settings WHERE key = 'numbering'").run();
    }
  });

  it("what was never valid still fails to read (a corrupt row is a 500, never a silent default)", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    const bad = {
      ...SETTINGS_DEFAULTS.numbering,
      invoice: { template: "TH/INVOICE/LONG/{FY}/{N}", padding: 4 },
    };
    await env.DB.prepare("DELETE FROM settings WHERE key = 'numbering'").run();
    await env.DB.prepare("INSERT INTO settings (key, value, version) VALUES ('numbering', ?, 1)")
      .bind(JSON.stringify(bad))
      .run();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await call(`/invoices/${made.id}`, { cookie: o.cookie })).status).toBe(500);
    } finally {
      errors.mockRestore();
      await env.DB.prepare("DELETE FROM settings WHERE key = 'numbering'").run();
    }
  });
});

describe("review 5: the first instalment can be billed again after its invoice was voided [ADM-PRJ-02]", () => {
  /** A project started from an accepted proposal (it names its source), with its first milestone still pending. */
  async function startedProject(clientId: string, over: Record<string, unknown> = {}) {
    const source = await mkDoc(clientId, "proposal");
    const project = await mkProject(clientId, { budget_minor: 1_000_000_00, source_document_id: source });
    const m = await mkMilestone(project.id, {
      position: 1,
      is_advance: 1,
      status: "pending",
      amount_minor: 118_000,
      title: "Start",
      ...over,
    });
    return { project, m };
  }
  const create = (s: Awaited<ReturnType<typeof owner>>, clientId: string, fromMilestoneId: string) =>
    call("/invoices", { cookie: s.cookie, body: { clientId, fromMilestoneId } });

  it("a pending FIRST milestone of a started project drafts an invoice; issue, void and draft it again", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const { m } = await startedProject(c.clientId);
    const first = await create(o, c.clientId, m.id);
    expect(first.status, await first.clone().text()).toBe(201);
    const id = (await json(first)).id as string;
    expect(await one("SELECT status, document_id FROM milestones WHERE id = ?", m.id)).toEqual({
      status: "pending",
      document_id: id,
    });
    // SAC and a description, then issue: the milestone is invoiced and its delivery time stays unset
    const doc = await getInvoice(o, id);
    expect(
      (
        await patchInvoice(o, id, {
          expectedUpdatedAt: doc.updatedAt,
          lines: [
            {
              id: doc.lines[0].id,
              description: "Start",
              sac: "998314",
              qtyMilli: 1000,
              unit: "fixed",
              rateMinor: doc.lines[0].rateMinor,
            },
          ],
        })
      ).status,
    ).toBe(200);
    expect((await issueInvoice(o, id)).status).toBe(200);
    expect(await one("SELECT status, delivered_at FROM milestones WHERE id = ?", m.id)).toEqual({
      status: "invoiced",
      delivered_at: null,
    });
    // void: back to pending, and the advance can be billed again from the milestone
    expect((await voidInvoice(o, id)).status).toBe(200);
    expect(await one("SELECT status, document_id FROM milestones WHERE id = ?", m.id)).toEqual({
      status: "pending",
      document_id: null,
    });
    const again = await create(o, c.clientId, m.id);
    expect(again.status, await again.clone().text()).toBe(201);
    expect(await one("SELECT document_id FROM milestones WHERE id = ?", m.id)).toEqual({
      document_id: (await json(again)).id,
    });
  });

  it("every other pending milestone is still refused: a later one of a started project, and one of a project that names no source proposal", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const { project } = await startedProject(c.clientId);
    const second = await mkMilestone(project.id, { position: 2, status: "pending", amount_minor: 118_000 });
    expect(await codeOf(await create(o, c.clientId, second.id))).toBe("milestone_not_ready");
    const plain = await mkReadyMilestone(c.clientId, 118_000, { status: "pending", position: 1 });
    expect(await codeOf(await create(o, c.clientId, plain.id))).toBe("milestone_not_ready");
    // and the milestone already holding a draft is "has an invoice"
    const { m } = await startedProject(c.clientId);
    expect((await create(o, c.clientId, m.id)).status).toBe(201);
    expect(await codeOf(await create(o, c.clientId, m.id))).toBe("milestone_has_invoice");
  });

  it("re-check A: reordering moves the position, not the advance: the moved pending milestone is refused and the advance is still billable", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const { project, m } = await startedProject(c.clientId);
    const second = await mkMilestone(project.id, { position: 2, status: "pending", amount_minor: 118_000 });
    const order = await call(`/projects/${project.id}/milestones/order`, {
      cookie: o.cookie,
      body: { ids: [second.id, m.id] },
    });
    expect(order.status).toBe(200);
    expect(await one("SELECT position FROM milestones WHERE id = ?", second.id)).toEqual({ position: 1 });
    expect(await codeOf(await create(o, c.clientId, second.id))).toBe("milestone_not_ready");
    const ok = await create(o, c.clientId, m.id);
    expect(ok.status, await ok.clone().text()).toBe(201);
  });

  it("re-check A: deleting the first milestone does not make the next one billable", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const { project, m } = await startedProject(c.clientId);
    const second = await mkMilestone(project.id, { position: 2, status: "pending", amount_minor: 118_000 });
    const gone = await call(`/milestones/${m.id}`, { method: "DELETE", cookie: o.cookie });
    expect(gone.status).toBe(200);
    // the second may move to position 1 by a reorder of the remaining list: still not the advance
    expect(
      (
        await call(`/projects/${project.id}/milestones/order`, {
          cookie: o.cookie,
          body: { ids: [second.id] },
        })
      ).status,
    ).toBe(200);
    expect(await codeOf(await create(o, c.clientId, second.id))).toBe("milestone_not_ready");
  });

  it("a milestone that moves out of billable between the read and the batch writes nothing (the guard is in the statement)", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const { m } = await startedProject(c.clientId);
    const before = await countOf("documents");
    const res = await call(
      "/invoices",
      { cookie: o.cookie, body: { clientId: c.clientId, fromMilestoneId: m.id } },
      beforeBatchHolding("INSERT INTO documents", async () => {
        await env.DB.prepare("UPDATE milestones SET is_advance = 0 WHERE id = ?").bind(m.id).run();
      }),
    );
    expect(res.status).toBe(409);
    expect(await countOf("documents")).toBe(before);
  });
});

describe("review 6: the void names who voided it, and the milestone names its project [API]", () => {
  it("a void invoice carries voidedByName from the invoice.void audit row; an invoice that is not void carries null", async () => {
    const o = await sessionFor("owner", { stepUp: true, name: "Rupak Sarkar" });
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    expect((await getInvoice(o, made.id)).void.voidedByName).toBeNull();
    expect((await voidInvoice(o, made.id)).status).toBe(200);
    const view = await getInvoice(o, made.id);
    expect(view.void).toMatchObject({ voidedByName: "Rupak Sarkar", reason: "Issued in error" });
    // another role that may read invoices sees the same name
    const accountant = await sessionFor("accountant");
    const seen = await json(await call(`/invoices/${made.id}`, { cookie: accountant.cookie }));
    expect(seen.void.voidedByName).toBe("Rupak Sarkar");
  });

  it("milestone.projectName is the project's name for a role without projects.read (the accountant), with no other project field", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const m = await mkReadyMilestone(c.clientId, 118_000);
    await env.DB.prepare("UPDATE projects SET name = 'Shop rebuild' WHERE id = ?").bind(m.projectId).run();
    const made = await json(
      await call("/invoices", { cookie: o.cookie, body: { clientId: c.clientId, fromMilestoneId: m.id } }),
    );
    const accountant = await sessionFor("accountant");
    const view = await json(await call(`/invoices/${made.id}`, { cookie: accountant.cookie }));
    expect(view.milestone).toEqual({
      id: m.id,
      title: "Design",
      projectId: m.projectId,
      projectName: "Shop rebuild",
      status: "ready_to_bill",
    });
  });
});

describe("review 8: the bell links the request, and the list opens one request by id [ADM-APR-01]", () => {
  it("the owners' bell for an issue request links /approvals/{id}?kind=issue", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const made = await mkInvoice(staff);
    const req = (await json(await requestIssue(staff, made.id))).id as string;
    const bell = await one<{ link: string }>(
      "SELECT link FROM notifications WHERE entity_id = ? AND kind = 'approval.requested' LIMIT 1",
      req,
    );
    expect(bell?.link).toBe(`/approvals/${req}?kind=issue`);
    // the screen opens that link by asking the list for the id
    const linked = new URL(bell?.link ?? "", "https://admin.example");
    const id = linked.pathname.split("/").at(-1);
    const list = await json(
      await call(`/approvals?kind=${linked.searchParams.get("kind")}&id=${id}`, { cookie: o.cookie }),
    );
    expect(list.approvals.map((a: J) => a.id)).toEqual([req]);
  });

  it("GET /approvals?kind=issue&id= returns that one request, however many newer ones there are; Staff only their own; another id is empty", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const other = await sessionFor("staff");
    const c = await mkInvoiceClient();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const made = await mkInvoice(i === 3 ? other : staff, { clientId: c.clientId });
      ids.push((await json(await requestIssue(i === 3 ? other : staff, made.id))).id as string);
    }
    const oldest = ids[0] as string;
    const one1 = await json(await call(`/approvals?kind=issue&id=${oldest}&limit=25`, { cookie: o.cookie }));
    expect(one1.approvals.map((a: J) => a.id)).toEqual([oldest]);
    expect(one1.approvals[0]).toMatchObject({
      kind: "issue",
      state: "pending",
      document: { status: "draft" },
    });
    // the same request, narrowed by a status it is not in, is not there
    const none = await json(
      await call(`/approvals?kind=issue&id=${oldest}&status=approved`, { cookie: o.cookie }),
    );
    expect(none.approvals).toEqual([]);
    // Staff see their own request by id, and not another member's
    const mine = await json(await call(`/approvals?kind=issue&id=${oldest}`, { cookie: staff.cookie }));
    expect(mine.approvals.map((a: J) => a.id)).toEqual([oldest]);
    const theirs = await json(await call(`/approvals?kind=issue&id=${ids[3]}`, { cookie: staff.cookie }));
    expect(theirs.approvals).toEqual([]);
    // an unknown id, and a discount-kind list asked for an issue id, are empty
    expect((await json(await call("/approvals?kind=issue&id=nope", { cookie: o.cookie }))).approvals).toEqual(
      [],
    );
    expect((await json(await call(`/approvals?id=${oldest}`, { cookie: o.cookie }))).approvals).toEqual([]);
    // with a cursor and a status together the parameters still line up
    const page = await json(
      await call(`/approvals?kind=issue&status=pending&limit=25`, { cookie: o.cookie }),
    );
    const next = page.next as string | null;
    expect(next).toBeNull();
    expect(
      (
        await json(
          await call(`/approvals?kind=issue&status=pending&id=${oldest}&limit=25`, { cookie: o.cookie }),
        )
      ).approvals,
    ).toHaveLength(1);
  });
});

describe("review 9: erasing an individual also deletes their unissued invoice drafts and clears issue-request text [DPDP; VERIFY WITH CA/LEGAL]", () => {
  it("anonymising the last contact deletes the drafts and the approvals asked for them, frees their milestone, keeps the issued invoice, and clears its request's reason and note", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const c = await mkInvoiceClient({ type: "individual" });
    // a draft with a pending request, a draft made from a milestone, and an invoice issued from an approved request
    const askedDraft = await mkInvoice(staff, { clientId: c.clientId });
    const askedId = (await json(await requestIssue(staff, askedDraft.id, "Pay-by-Friday, Mrs Rao")))
      .id as string;
    const m = await mkReadyMilestone(c.clientId, 118_000);
    const fromMilestone = (
      await json(
        await call("/invoices", { cookie: o.cookie, body: { clientId: c.clientId, fromMilestoneId: m.id } }),
      )
    ).id as string;
    const issuedInv = await mkInvoice(staff, { clientId: c.clientId });
    const issuedReq = (await json(await requestIssue(staff, issuedInv.id, "Mrs Rao asked for it")))
      .id as string;
    expect((await decideApproval(o, issuedReq, "approve", "Fine, Mrs Rao")).status).toBe(200);
    expect(await countOf("documents", "id IN (?, ?)", askedDraft.id, fromMilestone)).toBe(2);

    expect((await anonymise(o, c.contactId)).status).toBe(200);

    expect(await countOf("documents", "id IN (?, ?)", askedDraft.id, fromMilestone)).toBe(0);
    expect(await countOf("approvals", "id = ?", askedId)).toBe(0);
    expect(await countOf("document_lines", "document_id IN (?, ?)", askedDraft.id, fromMilestone)).toBe(0);
    expect(await one("SELECT status, document_id FROM milestones WHERE id = ?", m.id)).toEqual({
      status: "ready_to_bill",
      document_id: null,
    });
    // the issued invoice stays (the law keeps it), with its request, minus the free text
    expect(await invoiceRow(issuedInv.id)).toMatchObject({ status: "issued" });
    expect(await one("SELECT status, reason, note FROM approvals WHERE id = ?", issuedReq)).toEqual({
      status: "approved",
      reason: null,
      note: null,
    });
  });

  it("a business client's drafts and requests are not touched, and neither is another individual's", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const business = await mkInvoiceClient();
    const bDraft = await mkInvoice(staff, { clientId: business.clientId });
    const bReq = (await json(await requestIssue(staff, bDraft.id, "Needs it"))).id as string;
    const bSecond = await mkContact(business.clientId, { name: "Second" });
    expect(bSecond).toBeTruthy();
    expect((await anonymise(o, business.contactId)).status).toBe(200);
    expect(await countOf("documents", "id = ?", bDraft.id)).toBe(1);
    expect(await one("SELECT reason FROM approvals WHERE id = ?", bReq)).toEqual({ reason: "Needs it" });

    const other = await mkInvoiceClient({ type: "individual" });
    const otherDraft = await mkInvoice(staff, { clientId: other.clientId });
    const mine = await mkInvoiceClient({ type: "individual" });
    expect((await anonymise(o, mine.contactId)).status).toBe(200);
    expect(await countOf("documents", "id = ?", otherDraft.id)).toBe(1);
  });
});

describe("review 10: the issue request and its decision are emailed (07-R §3)", () => {
  const issueMessages = (q: ReturnType<typeof captureQueue>) =>
    q.sent.filter((m) => (m as J).kind === "approval.notify") as J[];

  it("a request queues one approval.notify (ids only); approving and rejecting each queue the decided one", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const q = captureQueue();
    const made = await mkInvoice(staff);
    const req = await call(
      `/invoices/${made.id}/issue-request`,
      { cookie: staff.cookie, body: { expectedUpdatedAt: (await issueBodyOf(made.id)).expectedUpdatedAt } },
      q.env,
    );
    expect(req.status).toBe(201);
    const approvalId = (await json(req)).id as string;
    expect(issueMessages(q)).toEqual([{ kind: "approval.notify", approvalId, event: "requested" }]);
    const approve = await call(
      `/approvals/${approvalId}/decide`,
      { cookie: o.cookie, body: { decision: "approve" } },
      q.env,
    );
    expect(approve.status, await approve.clone().text()).toBe(200);
    expect(issueMessages(q).at(-1)).toEqual({ kind: "approval.notify", approvalId, event: "decided" });
    // a rejection
    const made2 = await mkInvoice(staff);
    const req2 = await call(
      `/invoices/${made2.id}/issue-request`,
      { cookie: staff.cookie, body: { expectedUpdatedAt: (await issueBodyOf(made2.id)).expectedUpdatedAt } },
      q.env,
    );
    const approvalId2 = (await json(req2)).id as string;
    const reject = await call(
      `/approvals/${approvalId2}/decide`,
      { cookie: o.cookie, body: { decision: "reject" } },
      q.env,
    );
    expect(reject.status).toBe(200);
    expect(issueMessages(q)).toHaveLength(4);
    expect(issueMessages(q).at(-1)).toEqual({
      kind: "approval.notify",
      approvalId: approvalId2,
      event: "decided",
    });
    // the message holds no address, no name and no reason
    expect(JSON.stringify(q.sent)).not.toMatch(/@|Asha/);
  });

  it("the Owner issues directly while a Staff request waits: the request closes as approved and the requester gets the decided email; with no request waiting, none [M5.1 item]", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const q = captureQueue();
    const made = await mkInvoice(staff);
    const req = await call(
      `/invoices/${made.id}/issue-request`,
      { cookie: staff.cookie, body: { expectedUpdatedAt: (await issueBodyOf(made.id)).expectedUpdatedAt } },
      q.env,
    );
    expect(req.status, await req.clone().text()).toBe(201);
    const approvalId = (await json(req)).id as string;
    expect(issueMessages(q)).toHaveLength(1); // the "requested" one
    const issued = await call(
      `/invoices/${made.id}/issue`,
      { cookie: o.cookie, body: await issueBodyOf(made.id) },
      q.env,
    );
    expect(issued.status, await issued.clone().text()).toBe(200);
    expect(await one("SELECT status FROM approvals WHERE id = ?", approvalId)).toEqual({
      status: "approved",
    });
    expect(issueMessages(q).at(-1)).toEqual({ kind: "approval.notify", approvalId, event: "decided" });
    expect(issueMessages(q)).toHaveLength(2);
    // an issue with nothing waiting sends no approval email
    const plain = await mkInvoice(o);
    const q2 = captureQueue();
    const direct = await call(
      `/invoices/${plain.id}/issue`,
      { cookie: o.cookie, body: await issueBodyOf(plain.id) },
      q2.env,
    );
    expect(direct.status, await direct.clone().text()).toBe(200);
    expect(issueMessages(q2)).toEqual([]);
  });

  it("a refused request (stale) queues nothing, and a queue that is down never fails the request", async () => {
    const staff = await sessionFor("staff");
    const q = captureQueue();
    const made = await mkInvoice(staff);
    const stale = await call(
      `/invoices/${made.id}/issue-request`,
      { cookie: staff.cookie, body: { expectedUpdatedAt: 1 } },
      q.env,
    );
    expect(stale.status).toBe(409);
    expect(issueMessages(q)).toEqual([]);
    const down = captureQueue(env, () => new Error("queue down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = await call(
      `/invoices/${made.id}/issue-request`,
      { cookie: staff.cookie, body: { expectedUpdatedAt: (await issueBodyOf(made.id)).expectedUpdatedAt } },
      down.env,
    );
    expect(ok.status).toBe(201);
    errors.mockRestore();
  });
});

describe("review 13: a session that ended between the read and the batch is a sign-in, not a reload", () => {
  it("issue: an idle-expired, an absolutely expired and a revoked session are 401 unauthenticated and nothing is written", async () => {
    for (const change of [
      "UPDATE staff_sessions SET idle_expires_at = 1 WHERE id = ?1",
      "UPDATE staff_sessions SET abs_expires_at = 1 WHERE id = ?1",
      "UPDATE staff_sessions SET revoked_at = 5 WHERE id = ?1",
    ]) {
      const o = await owner();
      const made = await mkInvoice(o);
      const before = await state(made.id);
      const res = await call(
        `/invoices/${made.id}/issue`,
        { cookie: o.cookie, body: await issueBodyOf(made.id) },
        beforeBatchHolding("issue_guard", async () => {
          await env.DB.prepare(change).bind(o.sessionId).run();
        }),
      );
      expect(res.status, change).toBe(401);
      expect(await codeOf(res), change).toBe("unauthenticated");
      expect(await state(made.id)).toEqual(before);
    }
  });

  it("re-check low 1: the reread judges the session at the batch's own clock, not a later Date.now()", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    // A draft stamped ahead of the wall clock makes the batch's `now` (updated_at + 1) later than Date.now(); the session ends in between.
    const ahead = Date.now() + 3_600_000;
    await env.DB.prepare("UPDATE documents SET updated_at = ?2 WHERE id = ?1").bind(made.id, ahead).run();
    await env.DB.prepare("UPDATE staff_sessions SET idle_expires_at = ?2 WHERE id = ?1")
      .bind(o.sessionId, Date.now() + 600_000)
      .run();
    const before = await state(made.id);
    const res = await call(`/invoices/${made.id}/issue`, {
      cookie: o.cookie,
      body: await issueBodyOf(made.id),
    });
    expect(res.status, await res.clone().text()).toBe(401);
    expect(await codeOf(res)).toBe("unauthenticated");
    expect(await state(made.id)).toEqual(before);
  });

  it("void: the same, and a live session that only lost its step-up still gets step_up_required", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const before = await invoiceRow(made.id);
    const gone = await call(
      `/invoices/${made.id}/void`,
      { cookie: o.cookie, body: { expectedUpdatedAt: (before as J).updated_at, reason: "Error" } },
      beforeBatchHolding("status = 'void'", async () => {
        await env.DB.prepare("UPDATE staff_sessions SET idle_expires_at = 1 WHERE id = ?")
          .bind(o.sessionId)
          .run();
      }),
    );
    expect(gone.status).toBe(401);
    expect(await invoiceRow(made.id)).toEqual(before);
    const o2 = await owner();
    const stepped = await call(
      `/invoices/${made.id}/void`,
      { cookie: o2.cookie, body: { expectedUpdatedAt: (before as J).updated_at, reason: "Error" } },
      beforeBatchHolding("status = 'void'", async () => {
        await env.DB.prepare("UPDATE staff_sessions SET step_up_until = 1 WHERE id = ?")
          .bind(o2.sessionId)
          .run();
      }),
    );
    expect(stepped.status).toBe(403);
    expect(await codeOf(stepped)).toBe("step_up_required");
    expect(await invoiceRow(made.id)).toEqual(before);
  });
});

describe("review 14: one helper for the IST day, one list of invoice types", () => {
  it("the list's overdue test and the issue date use the same IST day (23:59 IST on the last day, 00:00 IST the next)", async () => {
    const o = await farSession();
    const c = await mkInvoiceClient();
    const made = await mkInvoice(o, { clientId: c.clientId });
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const due = (await invoiceRow(made.id)) as J;
    // the due date is day 7 (Net 7); at 23:59:59 IST on that day it is not overdue, at 00:00:00 IST the next it is
    const [y, mo, d] = (due.due_date as string).split("-").map(Number) as [number, number, number];
    const endOfDueDay = Date.UTC(y, mo - 1, d, 18, 29, 59, 999); // 23:59:59.999 IST
    vi.useFakeTimers({ toFake: ["Date"], now: endOfDueDay });
    const dueDay = await json(await call("/invoices?status=overdue", { cookie: o.cookie }));
    expect(dueDay.invoices.map((r: J) => r.id)).not.toContain(made.id);
    vi.setSystemTime(endOfDueDay + 1);
    const next = await json(await call("/invoices?status=overdue", { cookie: o.cookie }));
    expect(next.invoices.map((r: J) => r.id)).toContain(made.id);
  });

  it("the client's Invoices tab takes every invoice-flow type and no other", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    for (const type of ["proforma", "tax_invoice", "export_invoice", "credit_note", "debit_note"]) {
      const res = await call(`/clients/${c.clientId}/invoices?type=${type}`, { cookie: o.cookie });
      expect(res.status, type).toBe(200);
    }
    expect((await call(`/clients/${c.clientId}/invoices?type=proposal`, { cookie: o.cookie })).status).toBe(
      400,
    );
  });
});
