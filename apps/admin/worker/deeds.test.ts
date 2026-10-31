// The deed of assignment in the admin API (T11; run file docs/runs/t11-deed.md, L2 to L8; 08-C RB-38(a), RB-21; ADM-PRJ-01, ADM-PRJ-04): L3 from each batch (the
// project completed first then paid, paid first then completed, a Staff entry confirmed by the Owner, idempotent), the project's deed read, permissions and the
// fresh code, the Schedules (stale 409), finalise (the number, the sealed values), the signed upload (sniffing, size, write-once), cancel, check again, the
// warning after a credit note, and the erase rule (L7). All names, references and amounts are invented test data.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { mkContact } from "./test-clients.ts";
import {
  DEED_TOTAL,
  deedRowOf,
  deedStamp,
  draftDeed,
  finaliseDeed,
  finalisedDeed,
  mkDeedProject,
  payAll,
  putSchedules,
  putSigned,
  SCHEDULES,
} from "./test-deeds.ts";
import { call, countOf, one, sessionFor, type TestSession } from "./test-helpers.ts";
import { codeOf, type J, json, putCompany, voidInvoice } from "./test-invoices.ts";
import { record, recordBody, recorded, today, verify } from "./test-payments.ts";
import { PDF_BYTES, PNG_BYTES } from "./test-projects.ts";
import { addDoc } from "./test-reports.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeEach(async () => {
  await putCompany();
});

const getDeed = (s: TestSession, projectId: string) =>
  call(`/projects/${projectId}/deed`, { cookie: s.cookie });
const complete = (s: TestSession, projectId: string) =>
  call(`/projects/${projectId}/status`, { cookie: s.cookie, body: { to: "completed" } });
const recheck = (s: TestSession, projectId: string) =>
  call(`/projects/${projectId}/deed/recheck`, { cookie: s.cookie, body: {} });
const cancel = async (s: TestSession, deedId: string, reason: string) =>
  call(`/deeds/${deedId}/cancel`, {
    cookie: s.cookie,
    body: { expectedUpdatedAt: await deedStamp(deedId), reason },
  });
const erase = (s: TestSession, contactId: string) =>
  call(`/contacts/${contactId}/erase`, {
    cookie: s.cookie,
    body: { mode: "anonymise", reason: "requested" },
  });

// ---- L3 --------------------------------------------------------------------------------------------------------------------------------------------------

describe("L3: the draft is made by the batch that completes the project or pays it in full [RB-38(a)]", () => {
  it("completed first, then paid: the payment's batch makes the draft and the Owner's bell; a further payment changes nothing", async () => {
    const o = await owner();
    const f = await mkDeedProject();
    expect((await complete(o, f.projectId)).status).toBe(200);
    expect(await deedRowOf(f.projectId)).toBeNull();
    await payAll(o, f.clientId, f.inv.id);
    const d = await deedRowOf(f.projectId);
    expect(d).toMatchObject({ status: "draft", client_id: f.clientId, source_document_id: f.proposalId });
    const bell = "kind = 'deed.draft' AND entity_id = ? AND user_id = ?";
    expect(await countOf("notifications", bell, d?.id, o.id)).toBe(1);
    await recorded(o, recordBody(f.clientId, 5_000));
    expect(await countOf("deeds", "project_id = ?", f.projectId)).toBe(1);
    expect(await countOf("notifications", bell, d?.id, o.id)).toBe(1);
  });

  it("paid first, then completed: the completion's batch makes the draft", async () => {
    const o = await owner();
    const f = await mkDeedProject();
    await payAll(o, f.clientId, f.inv.id);
    expect(await deedRowOf(f.projectId)).toBeNull();
    expect((await complete(o, f.projectId)).status).toBe(200);
    expect((await deedRowOf(f.projectId))?.status).toBe("draft");
  });

  it("a Staff entry makes no deed until the Owner confirms it", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const f = await mkDeedProject({ status: "completed" });
    const made = await recorded(
      staff,
      recordBody(f.clientId, DEED_TOTAL, [{ documentId: f.inv.id, amountMinor: DEED_TOTAL }]),
    );
    expect(await deedRowOf(f.projectId)).toBeNull();
    expect((await verify(o, made.id as string, "confirm")).status).toBe(200);
    expect((await deedRowOf(f.projectId))?.status).toBe("draft");
  });

  it("a part payment makes none; a refused payment batch makes none", async () => {
    const o = await owner();
    const f = await mkDeedProject({ status: "completed" });
    await recorded(o, recordBody(f.clientId, 50_000, [{ documentId: f.inv.id, amountMinor: 50_000 }]));
    expect(await deedRowOf(f.projectId)).toBeNull();
    const noCode = await sessionFor("owner");
    const res = await record(
      noCode,
      recordBody(f.clientId, 68_000, [{ documentId: f.inv.id, amountMinor: 68_000 }]),
    );
    expect(res.status).toBe(403);
    expect(await deedRowOf(f.projectId)).toBeNull();
  });

  it("Check again (Owner): makes the draft of a project completed and paid before T11, once", async () => {
    const o = await owner();
    const f = await mkDeedProject({ status: "completed" });
    // Paid before T11: the ledger columns written straight in, so no L3 ran.
    await env.DB.prepare(
      "UPDATE documents SET paid_minor = total_minor, balance_minor = 0, status = 'paid' WHERE id = ?",
    )
      .bind(f.inv.id)
      .run();
    expect(await deedRowOf(f.projectId)).toBeNull();
    expect((await recheck(await sessionFor("staff"), f.projectId)).status).toBe(403);
    expect(await json(await recheck(o, f.projectId))).toMatchObject({
      created: true,
      deed: { status: "draft" },
    });
    expect((await json(await recheck(o, f.projectId))).created).toBe(false);
    expect(await countOf("deeds", "project_id = ?", f.projectId)).toBe(1);
    // Its own audit action (early check 10): one deed.recheck by the Owner, one system deed.draft for the deed.
    expect(await countOf("audit_log", "action = 'deed.recheck' AND entity_id = ?", f.projectId)).toBe(1);
    const d = (await deedRowOf(f.projectId)) as { id: string };
    expect(await countOf("audit_log", "action = 'deed.draft' AND entity_id = ?", d.id)).toBe(1);
  });

  it("a discount by credit note lowers the target (owner, 2026-11-01): the rest paid makes the draft; the view shows the target and the counted documents", async () => {
    const o = await owner();
    const f = await mkDeedProject({ status: "completed" });
    // The parent's ledger as the M5.3 credit-note batch leaves it: 18,000 credited, nothing paid yet.
    await env.DB.prepare(
      "UPDATE documents SET credited_minor = 18000, balance_minor = total_minor - 18000, status = 'partially_credited', updated_at = updated_at + 1 WHERE id = ?",
    )
      .bind(f.inv.id)
      .run();
    await recorded(
      o,
      recordBody(f.clientId, DEED_TOTAL - 18_000, [
        { documentId: f.inv.id, amountMinor: DEED_TOTAL - 18_000 },
      ]),
    );
    expect((await deedRowOf(f.projectId))?.status).toBe("draft");
    const view = await json(await getDeed(o, f.projectId));
    expect(view.eligibility).toMatchObject({
      eligible: true,
      settledMinor: DEED_TOTAL - 18_000,
      creditedMinor: 18_000,
      acceptedTotalMinor: DEED_TOTAL,
      targetMinor: DEED_TOTAL - 18_000,
      shortfallMinor: 0,
    });
    expect(view.documents).toEqual([
      expect.objectContaining({
        id: f.inv.id,
        number: f.inv.number,
        counted: true,
        creditedMinor: 18_000,
        balanceMinor: 0,
        settledMinor: DEED_TOTAL - 18_000,
      }),
    ]);
  });

  it("voiding the only unpaid invoice of a completed, otherwise paid project makes the draft (early check 4)", async () => {
    const o = await owner();
    const g = await mkDeedProject({ status: "completed" });
    // A duplicate invoice issued today, never sent: it blocks the deed until it is voided.
    const dup = await addDoc({ clientId: g.clientId, issueDate: today(), over: { project_id: g.projectId } });
    await payAll(o, g.clientId, g.inv.id);
    expect(await deedRowOf(g.projectId)).toBeNull();
    expect((await json(await getDeed(o, g.projectId))).eligibility.blockers).toEqual(["balance_due"]);
    const res = await voidInvoice(o, dup.id);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await deedRowOf(g.projectId))?.status).toBe("draft");
  });
});

// ---- reads and permissions ---------------------------------------------------------------------------------------------------------------------------

describe("GET /projects/:id/deed [L6, L8]", () => {
  it("Owner and Staff read it; Sales and Accountant get 403 (decision (c)); the blockers before, the draft with its preview after", async () => {
    const o = await owner();
    const f = await mkDeedProject();
    const before = await json(await getDeed(o, f.projectId));
    expect(before.deed).toBeNull();
    expect(before.eligibility).toMatchObject({
      eligible: false,
      blockers: ["not_completed", "balance_due", "short_paid", "nothing_paid"],
      targetMinor: DEED_TOTAL,
      shortfallMinor: DEED_TOTAL,
      creditedMinor: 0,
    });
    expect(before.documents).toEqual([
      expect.objectContaining({ id: f.inv.id, counted: true, balanceMinor: DEED_TOTAL, settledMinor: 0 }),
    ]);
    expect(before.history).toEqual([]);
    expect(before.can).toMatchObject({ recheck: true, renderPdf: false });
    await complete(o, f.projectId);
    await payAll(o, f.clientId, f.inv.id);
    expect((await getDeed(await sessionFor("staff"), f.projectId)).status).toBe(200);
    for (const role of ["sales", "accountant"] as const)
      expect((await getDeed(await sessionFor(role), f.projectId)).status, role).toBe(403);
    const view = await json(await getDeed(o, f.projectId));
    expect(view.deed).toMatchObject({
      status: "draft",
      number: null,
      blankSchedules: ["deliverables", "location", "deliveredDates", "tools", "thirdParty"],
      preview: { ok: false, problems: ["schedules_blank"] },
    });
    expect(view.can).toMatchObject({
      editSchedules: true,
      finalise: true,
      uploadSigned: false,
      cancel: true,
      recheck: false,
    });
    const staffView = await json(await getDeed(await sessionFor("staff"), f.projectId));
    expect(staffView.can).toMatchObject({ editSchedules: true, finalise: false, cancel: false });
  });

  it("an unknown project is 404", async () => {
    expect((await getDeed(await owner(), "no-such-project")).status).toBe(404);
  });
});

describe("the Schedules [L4, L6]", () => {
  it("Owner and Staff save them at the version read; a stale save is 409; Sales and Accountant cannot; the audit row has no words", async () => {
    const o = await owner();
    const f = await draftDeed(o);
    const saved = await putSchedules(await sessionFor("staff"), f.deedId, { tools: "", thirdParty: null });
    expect(saved.status).toBe(200);
    expect(await json(saved)).toMatchObject({ blankSchedules: ["tools", "thirdParty"] });
    const stale = await call(`/deeds/${f.deedId}/schedules`, {
      cookie: o.cookie,
      method: "PUT",
      body: { expectedUpdatedAt: 1, ...SCHEDULES },
    });
    expect(stale.status).toBe(409);
    expect(await codeOf(stale)).toBe("stale_version");
    for (const role of ["sales", "accountant"] as const)
      expect((await putSchedules(await sessionFor(role), f.deedId)).status, role).toBe(403);
    const view = await json(await getDeed(o, f.projectId));
    expect(view.deed.schedules).toMatchObject({ deliverables: SCHEDULES.deliverables, tools: null });
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'deed.edit' AND entity_id = ? ORDER BY at DESC LIMIT 1",
      f.deedId,
    );
    expect(audit?.summary).not.toContain("Website source code");
  });
});

describe("finalise [L1, L4, L6]", () => {
  it("needs the Owner's fresh code and filled Schedules; numbers it, seals the values, and the text reads 07-ZE's words", async () => {
    const o = await owner();
    const f = await draftDeed(o);
    expect((await finaliseDeed(await sessionFor("owner"), f.deedId)).status).toBe(403);
    expect((await finaliseDeed(await sessionFor("staff", { stepUp: true }), f.deedId)).status).toBe(403);
    const blank = await finaliseDeed(o, f.deedId);
    expect(blank.status).toBe(409);
    expect(await json(blank)).toMatchObject({
      error: { code: "deed_values_missing", details: { problems: ["schedules_blank"] } },
    });
    await putSchedules(o, f.deedId);
    const res = await finaliseDeed(o, f.deedId);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.number).toMatch(/^TH\/DA\/\d{4}\/\d{4}$/);
    expect(await deedRowOf(f.projectId)).toMatchObject({
      status: "final",
      number_display: body.number,
      snapshot_sha256: body.snapshotSha256,
    });
    const view = await json(await getDeed(o, f.projectId));
    expect(view.deed.text.title).toBe(`Deed of assignment of copyright · No. ${body.number}`);
    expect(view.deed.text.footer).toBe(
      "Stamp duty: Not stamped at signing. Any stamp duty due will be paid before this deed is produced as evidence.",
    );
    expect(view.deed.text.clauses[1].body).toContain(`(${f.inv.number}, total ₹1,180.00)`);
    expect(view.deed.sealed).toEqual({ ok: true, sha256: body.snapshotSha256 });
    expect(view.deed.notFullyPaid).toBe(false);
    expect(view.can).toMatchObject({
      editSchedules: false,
      finalise: false,
      uploadSigned: true,
      cancel: false,
    });
    expect((await putSchedules(o, f.deedId)).status).toBe(409);
    expect(await countOf("audit_log", "action = 'deed.finalise' AND entity_id = ?", f.deedId)).toBe(1);
  });

  it("refused when the company's GSTIN is missing (never guessed)", async () => {
    const o = await owner();
    const f = await draftDeed(o);
    await putSchedules(o, f.deedId);
    await putCompany({ gstin: null });
    expect(await json(await finaliseDeed(o, f.deedId))).toMatchObject({
      error: { code: "deed_values_missing", details: { problems: ["company_gstin_missing"] } },
    });
    expect((await deedRowOf(f.projectId))?.status).toBe("draft");
  });

  it("a credit note after finalising lowers the target: no warning; a payment withdrawn: the screen warns, nothing changes on its own", async () => {
    const o = await owner();
    const f = await finalisedDeed(o);
    await env.DB.prepare("UPDATE documents SET credited_minor = 10000 WHERE id = ?").bind(f.inv.id).run();
    expect((await json(await getDeed(o, f.projectId))).deed).toMatchObject({
      status: "final",
      notFullyPaid: false,
    });
    const paid = (await one<{ payment_id: string }>(
      "SELECT payment_id FROM payment_allocations WHERE document_id = ?",
      f.inv.id,
    )) as { payment_id: string };
    const w = await call(`/payments/${paid.payment_id}/withdraw`, {
      cookie: o.cookie,
      body: { reason: "x" },
    });
    expect(w.status, await w.clone().text()).toBe(200);
    expect((await json(await getDeed(o, f.projectId))).deed).toMatchObject({
      status: "final",
      notFullyPaid: true,
    });
    expect((await deedRowOf(f.projectId))?.status).toBe("final");
  });

  it("refused when the principal place is missing from Settings › Company (triage 4: the supplier address)", async () => {
    const o = await owner();
    const f = await draftDeed(o);
    await putSchedules(o, f.deedId);
    await putCompany({ principalPlace: null });
    expect(await json(await finaliseDeed(o, f.deedId))).toMatchObject({
      error: { code: "deed_values_missing", details: { problems: ["company_principal_place_missing"] } },
    });
    await putCompany({ principalPlace: "1 Example Road,\nBalurghat, West Bengal 733101" });
    expect((await finaliseDeed(o, f.deedId)).status).toBe(200);
    const parties = ((await json(await getDeed(o, f.projectId))).deed.text.parties as J[])
      .map((r) => r.text)
      .join("");
    expect(parties).toContain(
      "trading as TecHaust Technologies, 1 Example Road, Balurghat, West Bengal 733101, GSTIN ",
    );
  });
});

describe("the signed copy [L4, L5]", () => {
  it("Owner with a fresh code; a PDF of at most 10 MB; the eSign moment and transaction; then signed and never replaced", async () => {
    const o = await owner();
    const f = await finalisedDeed(o);
    expect((await putSigned(await sessionFor("staff", { stepUp: true }), f.deedId)).status).toBe(403);
    expect((await putSigned(await sessionFor("owner"), f.deedId)).status).toBe(403);
    expect((await putSigned(o, f.deedId, PNG_BYTES, { name: "signed.png" })).status).toBe(415);
    expect((await putSigned(o, f.deedId, PNG_BYTES, { name: "signed.pdf" })).status).toBe(415);
    expect((await putSigned(o, f.deedId, PDF_BYTES, { length: String(10 * 1024 * 1024 + 1) })).status).toBe(
      413,
    );
    const future = await putSigned(o, f.deedId, PDF_BYTES, { at: "2099-01-01T10:00" });
    expect(future.status).toBe(400);
    expect(await codeOf(future)).toBe("esign_invalid");
    expect((await putSigned(o, f.deedId, PDF_BYTES, { txn: " " })).status).toBe(400);
    expect((await deedRowOf(f.projectId))?.status).toBe("final");
    const ok = await putSigned(o, f.deedId);
    expect(ok.status, await ok.clone().text()).toBe(200);
    const row = (await deedRowOf(f.projectId)) as Record<string, unknown>;
    expect(row).toMatchObject({
      status: "signed",
      esign_txn: "ESIGN-TXN-0042",
      signed_size: PDF_BYTES.byteLength,
    });
    expect(String(row.signed_r2_key)).toMatch(new RegExp(`^deeds/${f.deedId}/signed-[0-9a-f]{64}$`));
    const view = await json(await getDeed(o, f.projectId));
    expect(view.deed.signed.signatureLine).toMatch(
      /^Signed by the assignor with an Aadhaar-based electronic signature \(eSign\): Rupak Sarkar, sole proprietor, TecHaust Technologies · \d{2} \w{3} \d{4}, \d{2}:\d{2} IST · ESIGN-TXN-0042\.$/,
    );
    const again = await putSigned(o, f.deedId);
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("deed_not_final");
    expect(
      (await call(`/deeds/${f.deedId}/pdf/signed`, { cookie: (await sessionFor("accountant")).cookie }))
        .status,
    ).toBe(403);
    const pdf = await call(`/deeds/${f.deedId}/pdf/signed`, {
      cookie: (await sessionFor("staff")).cookie,
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    expect(new Uint8Array(await pdf.arrayBuffer())).toEqual(PDF_BYTES);
    expect(await countOf("audit_log", "action = 'deed.sign' AND entity_id = ?", f.deedId)).toBe(1);
  });

  it("no signed copy on a draft; the unsigned PDF is 'not ready' until the jobs Worker renders it", async () => {
    const o = await owner();
    const f = await draftDeed(o);
    const res = await putSigned(o, f.deedId);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("deed_not_final");
    const unsigned = await call(`/deeds/${f.deedId}/pdf/unsigned`, { cookie: o.cookie });
    expect(unsigned.status).toBe(404);
    expect(await codeOf(unsigned)).toBe("pdf_not_ready");
  });
});

describe("cancel [L4]", () => {
  it("the Owner cancels a draft with a reason; Staff cannot; the reason stays out of the audit row; only Check again redrafts (decision (b))", async () => {
    const o = await owner();
    const f = await draftDeed(o);
    expect((await cancel(await sessionFor("staff"), f.deedId, "x")).status).toBe(403);
    expect((await cancel(o, f.deedId, " ")).status).toBe(400);
    expect((await cancel(o, f.deedId, "The client asked for none")).status).toBe(200);
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'deed.cancel' AND entity_id = ?",
      f.deedId,
    );
    expect(audit?.summary).not.toContain("asked");
    const cancelled = await json(await getDeed(o, f.projectId));
    expect(cancelled.deed.status).toBe("cancelled");
    expect(cancelled.can.recheck).toBe(true);
    expect(cancelled.history).toEqual([
      expect.objectContaining({
        id: f.deedId,
        reason: "The client asked for none",
        cancelledByName: expect.any(String),
      }),
    ]);
    // An automatic hook (a further payment's batch) never undoes the cancel.
    await recorded(o, recordBody(f.clientId, 5_000));
    await complete(o, f.projectId);
    expect(await countOf("deeds", "project_id = ?", f.projectId)).toBe(1);
    // The Owner's Check again makes a fresh draft; the cancelled one stays as history.
    const again = await json(await recheck(o, f.projectId));
    expect(again).toMatchObject({ created: true, deed: { status: "draft" }, can: { recheck: false } });
    expect(again.deed.id).not.toBe(f.deedId);
    expect(again.history).toHaveLength(1);
    expect((await json(await recheck(o, f.projectId))).created).toBe(false);
    expect(await countOf("deeds", "project_id = ?", f.projectId)).toBe(2);
  });
});

describe("erase (L7)", () => {
  it("anonymising an individual client deletes its draft deed; a final deed stays and shows Anonymised client", async () => {
    const o = await owner();
    const draft = await mkDeedProject({ status: "completed", clientOver: { type: "individual" } });
    const person = await mkContact(draft.clientId, { name: "Asha Rao", is_primary: 1 });
    await payAll(o, draft.clientId, draft.inv.id);
    expect((await deedRowOf(draft.projectId))?.status).toBe("draft");
    const res = await erase(o, person.id);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await deedRowOf(draft.projectId)).toBeNull();

    const kept = await mkDeedProject({
      status: "completed",
      clientOver: { type: "individual", legal_name: "Asha Rao" },
    });
    const person2 = await mkContact(kept.clientId, { name: "Asha Rao", is_primary: 1 });
    await payAll(o, kept.clientId, kept.inv.id);
    const d = (await deedRowOf(kept.projectId)) as { id: string };
    await putSchedules(o, d.id);
    expect((await finaliseDeed(o, d.id)).status).toBe(200);
    expect((await erase(o, person2.id)).status).toBe(200);
    const view = await json(await getDeed(o, kept.projectId));
    expect(view.clientAnonymised).toBe(true);
    expect(view.deed.status).toBe("final");
    const parties = (view.deed.text.parties as J[]).map((r) => r.text).join("");
    expect(parties).toContain("in favour of Anonymised client (the assignee)");
    expect(parties).not.toContain("Asha Rao");
    expect(view.can.uploadSigned).toBe(false);
  });
});
