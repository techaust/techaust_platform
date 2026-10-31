// Withdraw a proforma the client has received [ADM-INV-10, ADM-INV-02, ADM-INV-13, ADM-G-06, ADM-AUD-01; owner, 2026-10-30, docs/13; runs/proforma-withdraw]:
// `POST /invoices/:id/withdraw`, the Owner with a fresh code. A withdrawal is a void of a delivered (emailed or opened) proforma: the number and the record stay,
// the reason is stored, one audit row holds its length only, the milestone is freed, links and sends are left alone. An undelivered proforma is voided
// instead; a tax or export invoice never. Failure paths first. Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-17, RA-28).
import { env } from "cloudflare:workers";
import { withdrawnSql } from "@techaust/db/sql-rules";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { INVOICE_FACTS_SQL, INVOICE_LIST_SQL } from "./invoices.ts";
import { insert, mkContact } from "./test-clients.ts";
import { call, one, rows, sessionFor, type TestSession } from "./test-helpers.ts";
import {
  currentFy,
  lutOf,
  mkExportDraft,
  mkProforma,
  putSwiftBank,
  putTax,
  todayIso,
} from "./test-invoice-types.ts";
import {
  auditCount,
  codeOf,
  getInvoice,
  invoiceRow,
  issueInvoice,
  type J,
  json,
  mkInvoice,
  mkInvoiceClient,
  mkReadyMilestone,
  putBank,
  putCompany,
  voidInvoice,
} from "./test-invoices.ts";
import { draftCredit, mkIssuedInvoice } from "./test-notes.ts";
import { recordBody, recorded, verify } from "./test-payments.ts";
import { beforeBatchHolding } from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });
type S = Awaited<ReturnType<typeof owner>>;

beforeAll(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
});
afterEach(() => vi.useRealTimers());

const stamp = async (id: string) =>
  (await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", id))
    ?.updated_at as number;

const withdraw = async (
  s: { cookie: string },
  id: string,
  reason = "Sent to the wrong client",
  e: Env = env,
) =>
  call(
    `/invoices/${id}/withdraw`,
    { cookie: s.cookie, body: { expectedUpdatedAt: await stamp(id), reason } },
    e,
  );

const view = (id: string, at = Date.now()) =>
  env.DB.prepare("UPDATE documents SET viewed_at = ?2 WHERE id = ?1 AND viewed_at IS NULL")
    .bind(id, at)
    .run();

/** A send row as the send route writes it (the email itself is the jobs Worker's), to a contact with portal access and finance. */
async function email(id: string, by: string) {
  const row = await one<{ client_id: string }>("SELECT client_id FROM documents WHERE id = ?", id);
  const contact = await mkContact(row?.client_id as string, { portal_access: 1, can_see_finance: 1 });
  const sendId = `send-${crypto.randomUUID()}`;
  await insert("document_sends", {
    id: sendId,
    document_id: id,
    version_group_id: id,
    client_id: row?.client_id,
    contact_id: contact.id,
    email: contact.email,
    attach_pdf: 0,
    kind: "send",
    created_by: by,
  });
  await env.DB.prepare(
    "INSERT INTO doc_access_tokens (token_hash, document_id, purpose, expires_at, contact_id, client_id, email, send_id) VALUES (?1, ?2, 'view_pay', ?3, ?4, ?5, ?6, ?7)",
  )
    .bind(`tok-${sendId}`, id, Date.now() + 86_400_000, contact.id, row?.client_id, contact.email, sendId)
    .run();
  return sendId;
}

/** An issued proforma for a fresh client, with its milestone when asked. */
async function issuedProforma(s: S, opts: { milestone?: boolean } = {}) {
  const c = await mkInvoiceClient();
  const m = opts.milestone ? await mkReadyMilestone(c.clientId, 11_800_00, { delivered_at: 4242 }) : null;
  const made = await mkProforma(s, {
    clientId: c.clientId,
    ...(m ? { milestoneId: m.id } : { price: 100_000 }),
  });
  const res = await issueInvoice(s, made.id);
  expect(res.status, await res.clone().text()).toBe(200);
  return { ...made, milestoneId: m?.id ?? null, number: (await json(res)).number as string };
}

async function delivered(
  s: S,
  how: "emailed" | "viewed" | "both" = "viewed",
  opts: { milestone?: boolean } = {},
) {
  const pf = await issuedProforma(s, opts);
  if (how !== "viewed") await email(pf.id, s.id);
  if (how !== "emailed") await view(pf.id);
  return pf;
}

/** M6.1 (L37): a Staff member's payment entry that asks for the whole proforma; it waits for the Owner's check (pending). */
async function askFor(staff: TestSession, pf: { id: string; clientId: string }) {
  const total = (await one<{ total_minor: number }>("SELECT total_minor FROM documents WHERE id = ?", pf.id))
    ?.total_minor as number;
  const made = await recorded(
    staff,
    recordBody(pf.clientId, total, [{ documentId: pf.id, amountMinor: total }]),
  );
  expect(made.status).toBe("pending_verification");
  return made;
}

const refusal = async (res: Response) => {
  expect(res.status, await res.clone().text()).toBe(409);
  const b = await json(res);
  return { code: b.error.code as string, message: b.error.message as string, reasons: b.reasons as string[] };
};

describe("refused: who may withdraw [ADM-INV-10, Q1]", () => {
  it("Staff, Sales and the Accountant are 403; nothing is written", async () => {
    const o = await owner();
    const pf = await delivered(o);
    const before = await invoiceRow(pf.id);
    for (const role of ["staff", "sales", "accountant"] as const) {
      const s = await sessionFor(role, { stepUp: true });
      const res = await withdraw(s, pf.id);
      expect(res.status, role).toBe(403);
    }
    expect(await invoiceRow(pf.id)).toEqual(before);
    expect(await auditCount("invoice.withdraw", pf.id)).toBe(0);
  });

  it("the Owner without a fresh code, or with a lapsed one, is 403 step_up_required", async () => {
    const pf = await delivered(await owner());
    const none = await sessionFor("owner");
    const r1 = await withdraw(none, pf.id);
    expect(r1.status).toBe(403);
    expect(await codeOf(r1)).toBe("step_up_required");
    const lapsed = await sessionFor("owner", { stepUp: Date.now() - 1_000 });
    const r2 = await withdraw(lapsed, pf.id);
    expect(r2.status).toBe(403);
    expect(await codeOf(r2)).toBe("step_up_required");
    expect(await invoiceRow(pf.id)).toMatchObject({ status: "issued", voided_at: null });
  });

  it("a revoked session is 401", async () => {
    const o = await owner();
    const pf = await delivered(o);
    await env.DB.prepare("UPDATE staff_sessions SET revoked_at = 1 WHERE id = ?").bind(o.sessionId).run();
    expect((await withdraw(o, pf.id)).status).toBe(401);
    expect(await invoiceRow(pf.id)).toMatchObject({ status: "issued" });
  });

  it("a step-up that lapses between the read and the write: 403 step_up_required, nothing written", async () => {
    const o = await owner();
    const pf = await delivered(o);
    const res = await withdraw(
      o,
      pf.id,
      "Sent in error",
      beforeBatchHolding("SET status = 'void'", async () => {
        await env.DB.prepare("UPDATE staff_sessions SET step_up_until = 1 WHERE id = ?")
          .bind(o.sessionId)
          .run();
      }),
    );
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("step_up_required");
    expect(await auditCount("invoice.withdraw", pf.id)).toBe(0);
  });
});

describe("refused: bodies [ADM-INV-10]", () => {
  it("a reason is required (1 to 500 characters once trimmed); extras and a missing stamp are 400", async () => {
    const o = await owner();
    const pf = await delivered(o);
    const t = await stamp(pf.id);
    const post = (body: unknown) => call(`/invoices/${pf.id}/withdraw`, { cookie: o.cookie, body });
    for (const body of [
      { expectedUpdatedAt: t },
      { reason: "x" },
      { expectedUpdatedAt: t, reason: "" },
      { expectedUpdatedAt: t, reason: "   " },
      { expectedUpdatedAt: t, reason: "x".repeat(501) },
      { expectedUpdatedAt: t, reason: "ok", status: "void" },
      { expectedUpdatedAt: "1", reason: "ok" },
    ])
      expect((await post(body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    expect(await invoiceRow(pf.id)).toMatchObject({ status: "issued" });
    expect((await post({ expectedUpdatedAt: t, reason: "x".repeat(500) })).status).toBe(200);
  });
});

describe("refused: what can't be withdrawn [ADM-INV-10]", () => {
  it("a tax invoice, an export invoice and a credit note: 409 withdraw_proforma_only; a viewed tax invoice still can't be voided", async () => {
    const o = await owner();
    const inv = await mkInvoice(o);
    expect((await issueInvoice(o, inv.id)).status).toBe(200);
    await view(inv.id);
    const r = await refusal(await withdraw(o, inv.id));
    expect(r.code).toBe("withdraw_proforma_only");
    expect(r.message).toBe("Only an issued proforma can be withdrawn.");
    const v = await refusal(await voidInvoice(o, inv.id));
    expect(v.code).toBe("viewed_by_client");

    // the type is judged first, whatever the status: an export invoice draft, and an issued credit note
    const ex = await mkExportDraft(o);
    expect((await refusal(await withdraw(o, ex.id))).code).toBe("withdraw_proforma_only");
    const cnId = `cn-wd-${inv.id}`;
    await insert("documents", {
      id: cnId,
      type: "credit_note",
      client_id: inv.clientId,
      currency: "INR",
      parent_id: inv.id,
      status: "issued",
      frozen_at: 1,
      series: "creditNote",
      fy: "2627",
      number: 990_001,
      number_display: `CNW/${inv.id.slice(-8)}`,
    });
    expect((await refusal(await withdraw(o, cnId))).code).toBe("withdraw_proforma_only");
    expect(await auditCount("invoice.withdraw", inv.id)).toBe(0);
  });

  it("an unknown id or a proposal is 404", async () => {
    const o = await owner();
    const res = await call("/invoices/nope/withdraw", {
      cookie: o.cookie,
      body: { expectedUpdatedAt: 1, reason: "x" },
    });
    expect(res.status).toBe(404);
  });

  it("not yet delivered: 409 not_delivered (void it instead), and /void then works", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    const r = await refusal(await withdraw(o, pf.id));
    expect(r).toEqual({
      code: "not_delivered",
      message: "This proforma hasn't reached the client yet, so void it instead.",
      reasons: ["not_delivered"],
    });
    expect(await auditCount("invoice.withdraw", pf.id)).toBe(0);
    expect((await voidInvoice(o, pf.id)).status).toBe(200);
    expect((await getInvoice(o, pf.id)).void.withdrawn).toBe(false);
  });

  it("a draft: 409 not_issued with not_delivered", async () => {
    const o = await owner();
    const pf = await mkProforma(o);
    const r = await refusal(await withdraw(o, pf.id));
    expect(r.code).toBe("not_issued");
    expect(r.reasons).toEqual(["not_issued", "not_delivered"]);
    expect(r.message).toBe("Only an issued proforma can be withdrawn.");
  });

  it("a payment recorded against it: 409 proforma_paid", async () => {
    const o = await owner();
    const pf = await delivered(o, "emailed");
    await env.DB.prepare(
      "UPDATE documents SET paid_minor = 1, balance_minor = balance_minor - 1 WHERE id = ?",
    )
      .bind(pf.id)
      .run();
    const before = await invoiceRow(pf.id);
    const r = await refusal(await withdraw(o, pf.id));
    expect(r.code).toBe("proforma_paid");
    expect(r.message).toBe(
      "This proforma can't be withdrawn because a payment has been recorded against it.",
    );
    expect(await invoiceRow(pf.id)).toEqual(before);
    expect(await auditCount("invoice.withdraw", pf.id)).toBe(0);
  });

  it("converted (an invoice for money received was made from it): 409 proforma_converted, with proforma_paid", async () => {
    const o = await owner();
    const pf = await delivered(o, "viewed");
    const adv = await call(`/invoices/${pf.id}/advance-invoice`, {
      cookie: o.cookie,
      body: {
        expectedProformaUpdatedAt: await stamp(pf.id),
        amountMinor: 59_000,
        receivedOn: todayIso(),
        reference: `UTR WD ${Date.now()}`,
      },
    });
    expect(adv.status, await adv.clone().text()).toBe(201);
    const r = await refusal(await withdraw(o, pf.id));
    expect(r.code).toBe("proforma_converted");
    expect(r.message).toBe("This proforma can't be withdrawn because an invoice has been made from it.");
    expect(r.reasons).toEqual(["proforma_converted", "proforma_paid"]);
    const v = await getInvoice(o, pf.id);
    expect(v.withdraw).toEqual({ canWithdraw: false, blockers: ["proforma_converted", "proforma_paid"] });
  });

  it("already withdrawn: 409 already_withdrawn; voided before delivery: 409 already_void", async () => {
    const o = await owner();
    const pf = await delivered(o);
    expect((await withdraw(o, pf.id)).status).toBe(200);
    const r = await refusal(await withdraw(o, pf.id));
    expect(r).toEqual({
      code: "already_withdrawn",
      message: "This proforma is already withdrawn.",
      reasons: ["already_withdrawn"],
    });
    const quiet = await issuedProforma(o);
    expect((await voidInvoice(o, quiet.id)).status).toBe(200);
    const q = await refusal(await withdraw(o, quiet.id));
    expect(q.code).toBe("already_void");
    expect(q.reasons).toEqual(["already_void"]);
    expect(await auditCount("invoice.withdraw", pf.id)).toBe(1);
    expect(await auditCount("invoice.withdraw", quiet.id)).toBe(0);
  });

  it("an anonymised client is 409 client_anonymised; a stale stamp is 409 stale_version; nothing written", async () => {
    const o = await owner();
    const pf = await delivered(o);
    const stale = await call(`/invoices/${pf.id}/withdraw`, {
      cookie: o.cookie,
      body: { expectedUpdatedAt: 1, reason: "x" },
    });
    expect(await codeOf(stale)).toBe("stale_version");
    await env.DB.prepare("UPDATE clients SET anonymised_at = 3 WHERE id = ?").bind(pf.clientId).run();
    const gone = await withdraw(o, pf.id);
    expect(gone.status).toBe(409);
    expect(await codeOf(gone)).toBe("client_anonymised");
    expect(await invoiceRow(pf.id)).toMatchObject({ status: "issued" });
    expect(await auditCount("invoice.withdraw", pf.id)).toBe(0);
  });

  it("a payment landing between the read and the write: 409 proforma_paid, nothing written", async () => {
    const o = await owner();
    const pf = await delivered(o);
    const res = await withdraw(
      o,
      pf.id,
      "Sent in error",
      beforeBatchHolding("SET status = 'void'", async () => {
        await env.DB.prepare(
          "UPDATE documents SET paid_minor = 1, balance_minor = balance_minor - 1 WHERE id = ?",
        )
          .bind(pf.id)
          .run();
      }),
    );
    expect((await refusal(res)).code).toBe("proforma_paid");
    expect(await invoiceRow(pf.id)).toMatchObject({ status: "issued", voided_at: null });
    expect(await auditCount("invoice.withdraw", pf.id)).toBe(0);
  });

  // M6.1 (L37): a Staff member's payment entry waiting for the Owner's check that asks for the proforma blocks its withdrawal until it is decided.
  it("a pending payment asking for a viewed proforma: 409 payment_pending in 07-ZH line 46's words, nothing written; after a reject, 200", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const pf = await delivered(o, "viewed");
    const made = await askFor(staff, pf);
    const before = await invoiceRow(pf.id);
    const r = await refusal(await withdraw(o, pf.id));
    expect(r).toEqual({
      code: "payment_pending",
      message: "A payment recorded on it is waiting for the owner's check. Reject it first.",
      reasons: ["payment_pending"],
    });
    expect(await invoiceRow(pf.id)).toEqual(before);
    expect(await auditCount("invoice.withdraw", pf.id)).toBe(0);
    const rejected = await verify(o, made.id, "reject", { note: "Not in the bank statement" });
    expect(rejected.status, await rejected.clone().text()).toBe(200);
    const ok = await withdraw(o, pf.id);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await invoiceRow(pf.id)).toMatchObject({ status: "void" });
    expect(await auditCount("invoice.withdraw", pf.id)).toBe(1);
  });

  it("a pending payment asking for it that lands between the read and the write: 409 payment_pending, never a 500, nothing written", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const pf = await delivered(o, "both");
    const res = await withdraw(
      o,
      pf.id,
      "Sent in error",
      beforeBatchHolding("SET status = 'void'", async () => {
        await askFor(staff, pf);
      }),
    );
    const r = await refusal(res);
    expect(r.code).toBe("payment_pending");
    expect(r.reasons).toEqual(["payment_pending"]);
    expect(await invoiceRow(pf.id)).toMatchObject({ status: "issued", voided_at: null });
    expect(await auditCount("invoice.withdraw", pf.id)).toBe(0);
  });

  it("the read offers no Withdraw while a payment asks for it (canWithdraw false, payment_pending); the void of an emailed proforma names it first", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const pf = await delivered(o, "emailed");
    await askFor(staff, pf);
    const v = await getInvoice(o, pf.id);
    expect(v.withdraw).toEqual({ canWithdraw: false, blockers: ["payment_pending"] });
    const voided = await refusal(await voidInvoice(o, pf.id));
    expect(voided.reasons[0]).toBe("payment_pending");
    expect(voided.reasons).toEqual(["payment_pending", "already_emailed"]);
    expect(voided.code).toBe("void_not_allowed");
    expect(await invoiceRow(pf.id)).toMatchObject({ status: "issued" });
    expect(await auditCount("invoice.void", pf.id)).toBe(0);
  });

  it("a trigger refusal is explained (409), never a 500, and writes no audit row", async () => {
    const o = await owner();
    const pf = await delivered(o);
    await env.DB.prepare(
      `CREATE TRIGGER test_withdraw_abort BEFORE UPDATE OF status ON documents WHEN NEW.id = '${pf.id}' BEGIN SELECT RAISE(ABORT, 'documents_proforma_withdraw: test'); END`,
    ).run();
    try {
      const res = await withdraw(o, pf.id);
      expect(res.status, await res.clone().text()).toBe(409);
    } finally {
      await env.DB.prepare("DROP TRIGGER test_withdraw_abort").run();
    }
    expect(await invoiceRow(pf.id)).toMatchObject({ status: "issued" });
    expect(await auditCount("invoice.withdraw", pf.id)).toBe(0);
  });
});

describe("the void route points a delivered proforma to Withdraw [ADM-INV-10, 07-ZF 15, 16]", () => {
  it("viewed: 409 viewed_by_client in 07-ZF 15's words; emailed: void_not_allowed in 07-ZF 16's words; nothing written", async () => {
    const o = await owner();
    const seen = await delivered(o, "viewed");
    const v = await refusal(await voidInvoice(o, seen.id));
    expect(v).toEqual({
      code: "viewed_by_client",
      message:
        "The client has opened this proforma in the portal, so it can't be voided. Withdraw it instead.",
      reasons: ["viewed_by_client"],
    });
    const sent = await delivered(o, "emailed");
    const e = await refusal(await voidInvoice(o, sent.id));
    expect(e).toEqual({
      code: "void_not_allowed",
      message: "This proforma has been emailed to the client, so it can't be voided. Withdraw it instead.",
      reasons: ["already_emailed"],
    });
    expect(await auditCount("invoice.void", seen.id)).toBe(0);
    expect(await auditCount("invoice.void", sent.id)).toBe(0);
  });

  it("a send landing between the void's read and its write answers already_emailed (a proforma's words point to Withdraw)", async () => {
    const o = await owner();
    const pf = await issuedProforma(o);
    const res = await call(
      `/invoices/${pf.id}/void`,
      { cookie: o.cookie, body: { expectedUpdatedAt: await stamp(pf.id), reason: "Issued in error" } },
      beforeBatchHolding("SET status = 'void'", async () => {
        await email(pf.id, o.id);
      }),
    );
    const r = await refusal(res);
    expect(r.code).toBe("void_not_allowed");
    expect(r.reasons).toEqual(["already_emailed"]);
    expect(r.message).toContain("Withdraw it instead.");
    expect(await invoiceRow(pf.id)).toMatchObject({ status: "issued" });
  });
});

describe("withdrawn [ADM-INV-10, ADM-INV-02, ADM-AUD-01]", () => {
  it("the Owner withdraws a viewed proforma: void, number kept, reason stored, one audit row without the text, milestone freed, links and sends untouched", async () => {
    const o = await owner();
    const pf = await delivered(o, "both", { milestone: true });
    const sendsBefore = await rows("SELECT * FROM document_sends WHERE document_id = ? ORDER BY id", pf.id);
    const tokensBefore = await rows(
      "SELECT * FROM doc_access_tokens WHERE document_id = ? ORDER BY token_hash",
      pf.id,
    );
    const before = await invoiceRow(pf.id);
    // an unpaid proforma links its milestone without moving it (LD12): the withdraw frees the link for a new invoice
    expect(await one("SELECT status, document_id FROM milestones WHERE id = ?", pf.milestoneId)).toEqual({
      status: "ready_to_bill",
      document_id: pf.id,
    });
    const res = await withdraw(o, pf.id, "Client asked for a new scope");
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      ok: true,
      status: "void",
      withdrawn: true,
      number: pf.number,
      milestone: { id: pf.milestoneId, status: "ready_to_bill" },
    });
    expect(body.voidedAt).toBe(body.updatedAt);
    const after = await invoiceRow(pf.id);
    expect(after).toMatchObject({
      status: "void",
      number: before?.number,
      number_display: pf.number,
      void_reason: "Client asked for a new scope",
      frozen_at: before?.frozen_at,
      voided_at: body.voidedAt,
    });
    const audit = await rows<{ summary: string; role: string }>(
      "SELECT summary, role FROM audit_log WHERE action = 'invoice.withdraw' AND entity_id = ?",
      pf.id,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.role).toBe("owner");
    expect(JSON.parse(audit[0]?.summary ?? "{}")).toEqual({
      documentId: pf.id,
      number: pf.number,
      type: "proforma",
      totalMinor: before?.total_minor,
      reasonLength: 28,
      delivered: "both",
    });
    expect(audit[0]?.summary).not.toContain("scope");
    expect(await auditCount("invoice.void", pf.id)).toBe(0);
    expect(await one("SELECT status, document_id FROM milestones WHERE id = ?", pf.milestoneId)).toEqual({
      status: "ready_to_bill",
      document_id: null,
    });
    expect(await rows("SELECT * FROM document_sends WHERE document_id = ? ORDER BY id", pf.id)).toEqual(
      sendsBefore,
    );
    expect(
      await rows("SELECT * FROM doc_access_tokens WHERE document_id = ? ORDER BY token_hash", pf.id),
    ).toEqual(tokensBefore);
    // the read: withdrawn, by whom, and nothing more to do
    const v = await getInvoice(o, pf.id);
    expect(v.void).toMatchObject({
      withdrawn: true,
      reason: "Client asked for a new scope",
      voidedByName: expect.any(String),
      canVoid: false,
    });
    expect(v.void.voidedByName).not.toBeNull();
    expect(v.withdraw).toEqual({ canWithdraw: false, blockers: ["already_withdrawn"] });
  });

  it("emailed only, or viewed only: 200 with how it was delivered", async () => {
    const o = await owner();
    for (const how of ["emailed", "viewed"] as const) {
      const pf = await delivered(o, how);
      expect((await withdraw(o, pf.id)).status, how).toBe(200);
      const a = await one<{ summary: string }>(
        "SELECT summary FROM audit_log WHERE action = 'invoice.withdraw' AND entity_id = ?",
        pf.id,
      );
      expect(JSON.parse(a?.summary ?? "{}").delivered, how).toBe(how);
    }
  });

  it("the read offers Withdraw to the Owner only, on a delivered, open proforma; Void is not offered", async () => {
    const o = await owner();
    const pf = await delivered(o, "viewed");
    const v = await getInvoice(o, pf.id);
    expect(v.withdraw).toEqual({ canWithdraw: true, blockers: [] });
    expect(v.void).toMatchObject({ canVoid: false, withdrawn: false, blockers: ["viewed_by_client"] });
    const staff = await getInvoice(await sessionFor("staff"), pf.id);
    expect(staff.withdraw).toEqual({ canWithdraw: false, blockers: [] });
    const quiet = await issuedProforma(o);
    const q = await getInvoice(o, quiet.id);
    expect(q.withdraw).toEqual({ canWithdraw: false, blockers: ["not_delivered"] });
    expect(q.void.canVoid).toBe(true);
    const inv = await mkInvoice(o);
    expect((await getInvoice(o, inv.id)).withdraw).toEqual({
      canWithdraw: false,
      blockers: ["not_proforma"],
    });
  });

  it("review L2: an anonymised client is offered neither Withdraw nor Void (the routes refuse client_anonymised)", async () => {
    const o = await owner();
    const pf = await delivered(o, "viewed");
    const quiet = await issuedProforma(o);
    expect((await getInvoice(o, pf.id)).withdraw.canWithdraw).toBe(true);
    expect((await getInvoice(o, quiet.id)).void.canVoid).toBe(true);
    await env.DB.prepare("UPDATE clients SET anonymised_at = 3 WHERE id IN (?1, ?2)")
      .bind(pf.clientId, quiet.clientId)
      .run();
    expect((await getInvoice(o, pf.id)).withdraw).toEqual({ canWithdraw: false, blockers: [] });
    expect((await getInvoice(o, quiet.id)).void).toMatchObject({ canVoid: false, blockers: [] });
    expect((await getInvoice(o, quiet.id)).withdraw).toEqual({
      canWithdraw: false,
      blockers: ["not_delivered"],
    });
  });

  it("the list and the client's tab mark it withdrawn; an undelivered void proforma is not; the dashboard's proformas awaiting leave it out", async () => {
    const o = await owner();
    const pf = await delivered(o, "emailed");
    const quiet = await issuedProforma(o);
    const awaiting = async () => {
      const res = await call("/dashboard", { cookie: o.cookie });
      expect(res.status).toBe(200);
      const t = (await json(res)) as J;
      const inr = (t.tiles.finance.proformasAwaiting as J[]).find((r) => r.currency === "INR");
      return (inr?.count ?? 0) as number;
    };
    const n0 = await awaiting();
    expect((await withdraw(o, pf.id)).status).toBe(200);
    expect((await voidInvoice(o, quiet.id)).status).toBe(200);
    expect(await awaiting()).toBe(n0 - 2);
    const all: J[] = [];
    let next: string | null = null;
    do {
      const res = await call(`/invoices?type=proforma&status=void&limit=50${next ? `&after=${next}` : ""}`, {
        cookie: o.cookie,
      });
      expect(res.status).toBe(200);
      const b = await json(res);
      all.push(...(b.invoices as J[]));
      next = b.next as string | null;
    } while (next);
    expect(all.find((r) => r.id === pf.id)?.withdrawn).toBe(true);
    expect(all.find((r) => r.id === quiet.id)?.withdrawn).toBe(false);
    const tab = await call(`/clients/${pf.clientId}/invoices`, { cookie: o.cookie });
    expect(tab.status).toBe(200);
    const tabRow = ((await json(tab)).invoices as J[]).find((r) => r.id === pf.id);
    expect(tabRow?.withdrawn).toBe(true);
    const live = await mkInvoice(o);
    const list = await call(`/invoices?clientId=${live.clientId}`, { cookie: o.cookie });
    expect(((await json(list)).invoices as J[]).every((r) => r.withdrawn === false)).toBe(true);
  });
});

describe("the reads use the shared rule and look up the withdraw facts for a proforma only [ADM-INV-10, review L4 and note]", () => {
  it("the list's withdrawn flag is `withdrawnSql`, not a hand-written copy", () => {
    for (const status of ["plain", "overdue", null] as const)
      for (const client of [true, false])
        expect(INVOICE_LIST_SQL({ status, client, cursor: false })).toContain(
          `${withdrawnSql("d")} AS withdrawn`,
        );
  });
  it("any child and an advance receipt are read for a proforma only; a tax invoice with a draft credit note reads neither, and still answers not_proforma", async () => {
    const o = await owner();
    const facts = (id: string) =>
      one<{ emailed: number; child: number; any_child: number; advance: number }>(INVOICE_FACTS_SQL, id);
    // a tax invoice with a draft child (a credit note): the child lookup is skipped (the issued-child lookup the void needs still runs)
    const inv = await mkIssuedInvoice(o);
    const note = await draftCredit(o, inv.id, { mode: "full" });
    expect(note.status, await note.clone().text()).toBe(201);
    expect(await facts(inv.id)).toMatchObject({ child: 0, any_child: 0, advance: 0 });
    expect((await getInvoice(o, inv.id)).withdraw).toEqual({
      canWithdraw: false,
      blockers: ["not_proforma"],
    });
    // a converted proforma: both are read
    const pf = await delivered(o, "viewed");
    const adv = await call(`/invoices/${pf.id}/advance-invoice`, {
      cookie: o.cookie,
      body: {
        expectedProformaUpdatedAt: await stamp(pf.id),
        amountMinor: 59_000,
        receivedOn: todayIso(),
        reference: `UTR WD facts ${Date.now()}`,
      },
    });
    expect(adv.status, await adv.clone().text()).toBe(201);
    expect(await facts(pf.id)).toMatchObject({ child: 1, any_child: 1, advance: 1 });
    // the gate covers both lookups
    expect(INVOICE_FACTS_SQL).toMatch(
      /CASE WHEN d\.type = 'proforma' THEN EXISTS \(SELECT 1 FROM documents x WHERE x\.parent_id = \?1\) ELSE 0 END AS any_child/,
    );
    expect(INVOICE_FACTS_SQL).toMatch(
      /CASE WHEN d\.type = 'proforma' THEN EXISTS \(SELECT 1 FROM advance_receipts r WHERE r\.proforma_id = \?1\) ELSE 0 END AS advance/,
    );
  });
});
