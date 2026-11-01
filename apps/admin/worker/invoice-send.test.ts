// Sending an issued invoice, revoking its links and pausing its reminders [ADM-INV-15, ADM-INV-13, POR-06, LD55, LD56, LD60, Q42, M5.4]. Failure paths first.
import { env } from "cloudflare:workers";
import { toIsoDate, toIst } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import { describe, expect, it, vi } from "vitest";
import { cancelUnlinkedSendsSql } from "./invoice-send.ts";
import { insert, mkClient, mkContact } from "./test-clients.ts";
import { call, captureQueue, one, rows, sessionFor } from "./test-helpers.ts";
import {
  codeOf,
  farSession,
  getInvoice,
  issueInvoice,
  json,
  mkInvoice,
  putBank,
  putCompany,
  voidInvoice,
} from "./test-invoices.ts";

const owner = () => sessionFor("owner", { stepUp: true });

/** An issued invoice (the owner issued it) and its client's contacts with portal access. */
async function issued(contacts = 2) {
  const s = await owner();
  await putCompany();
  await putBank();
  const made = await mkInvoice(s);
  expect((await issueInvoice(s, made.id)).status).toBe(200);
  const ids: string[] = [];
  for (let i = 0; i < contacts; i++)
    ids.push((await mkContact(made.clientId, { portal_access: 1, can_see_finance: 1 })).id);
  return { s, made, ids };
}
const send = (s: { cookie: string }, id: string, body: unknown, e: Env = env) =>
  call(`/invoices/${id}/send`, { cookie: s.cookie, body }, e);
const sendsOf = (id: string) =>
  rows<{
    id: string;
    kind: string;
    contact_id: string;
    email: string;
    version_group_id: string;
    queued_at: number | null;
    attach_pdf: number;
    created_by: string;
  }>(
    "SELECT id, kind, contact_id, email, version_group_id, queued_at, attach_pdf, created_by FROM document_sends WHERE document_id = ? ORDER BY id",
    id,
  );
const remindersOf = (id: string) =>
  rows<{ offset_days: number; due_at: number; sent_at: number | null; skipped_reason: string | null }>(
    "SELECT offset_days, due_at, sent_at, skipped_reason FROM reminders WHERE document_id = ? ORDER BY offset_days",
    id,
  );

describe("the send refuses what it must [ADM-INV-15]", () => {
  it("a draft, a void invoice, an anonymised client and a document that is not an invoice", async () => {
    const s = await owner();
    await putCompany();
    const draft = await mkInvoice(s);
    const to = await mkContact(draft.clientId, { portal_access: 1, can_see_finance: 1 });
    const r1 = await send(s, draft.id, { contactIds: [to.id] });
    expect(r1.status).toBe(409);
    expect(await codeOf(r1)).toBe("not_issued");

    const v = await issued(1);
    expect((await voidInvoice(v.s, v.made.id)).status).toBe(200);
    const r2 = await send(v.s, v.made.id, { contactIds: v.ids });
    expect(r2.status).toBe(409);
    expect(await codeOf(r2)).toBe("invoice_void");

    const g = await issued(1);
    await env.DB.prepare("UPDATE clients SET anonymised_at = 5 WHERE id = ?").bind(g.made.clientId).run();
    expect(await codeOf(await send(g.s, g.made.id, { contactIds: g.ids }))).toBe("client_anonymised");

    const proposal = uuidv7();
    await insert("documents", {
      id: proposal,
      type: "proposal",
      client_id: g.made.clientId,
      currency: "INR",
      version_group_id: proposal,
    });
    expect((await send(g.s, proposal, { contactIds: g.ids })).status).toBe(404);
    expect((await send(g.s, "no-such-id", { contactIds: g.ids })).status).toBe(404);
    expect(await sendsOf(g.made.id)).toEqual([]);
    expect(await remindersOf(g.made.id)).toEqual([]);
  });

  it("the recipients: none, more than five, a repeat, no portal access, another client's contact; nothing is written", async () => {
    const { s, made, ids } = await issued(1);
    const r0 = await send(s, made.id, { contactIds: [] });
    expect([r0.status, await codeOf(r0)]).toEqual([400, "recipients_required"]);
    const six = Array.from({ length: 6 }, (_, i) => `c${i}`);
    const r6 = await send(s, made.id, { contactIds: six });
    expect([r6.status, await codeOf(r6)]).toEqual([400, "recipients_too_many"]);
    const dup = await send(s, made.id, { contactIds: [ids[0], ids[0]] });
    expect([dup.status, await codeOf(dup)]).toEqual([409, "recipient_invalid"]);
    const off = await mkContact(made.clientId, { portal_access: 0 });
    // POR-03: a contact who may not see finance is refused too (the portal would answer 404 to their link). Researched 2026-10-28, DPDP Act s.8(7) and s.12(3) (08-C RB-11) (DPDP).
    const noFinance = await mkContact(made.clientId, { portal_access: 1, can_see_finance: 0 });
    const other = await mkContact(await mkClient(), { portal_access: 1, can_see_finance: 1 });
    for (const bad of [off.id, noFinance.id, other.id, "unknown"]) {
      const r = await send(s, made.id, { contactIds: [ids[0], bad] });
      expect(r.status, bad).toBe(409);
      expect(await json(r)).toMatchObject({ error: { code: "recipient_invalid" }, contactIds: [bad] });
    }
    expect((await send(s, made.id, { contactIds: ids, extra: 1 })).status).toBe(400); // strict body
    expect(await sendsOf(made.id)).toEqual([]);
    expect(await remindersOf(made.id)).toEqual([]);
  });

  it("Owner and Staff may send (Q42); Sales and the Accountant may not; no session is 401", async () => {
    const { made, ids } = await issued(1);
    for (const role of ["sales", "accountant"] as const) {
      const r = await send(await sessionFor(role), made.id, { contactIds: ids });
      expect(r.status, role).toBe(403);
    }
    expect((await call(`/invoices/${made.id}/send`, { body: { contactIds: ids } })).status).toBe(401);
    const staff = await sessionFor("staff");
    expect((await send(staff, made.id, { contactIds: ids })).status).toBe(200);
    const row = (await sendsOf(made.id))[0];
    expect(row?.created_by).toBe(staff.id);
  });
});

describe("the first send [ADM-INV-15, ADM-INV-13]", () => {
  it("writes one waiting row per recipient (group = the invoice) and one reminder per future offset at 09:00 IST on the exact day", async () => {
    const { s, made, ids } = await issued(2);
    const res = await send(s, made.id, { contactIds: ids });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      ok: true,
      kind: "send",
      sends: 2,
      reminders: 5,
      waitingForPdf: true,
      remindersPaused: false,
    });
    const sends = await sendsOf(made.id);
    expect(sends).toHaveLength(2);
    for (const r of sends) {
      expect(r).toMatchObject({ kind: "send", version_group_id: made.id, queued_at: null, created_by: s.id });
      expect(r.email).toBe(r.email.toLowerCase());
    }
    const due = (await one<{ due_date: string }>("SELECT due_date FROM documents WHERE id = ?", made.id))
      ?.due_date as string;
    const rem = await remindersOf(made.id);
    expect(rem.map((r) => r.offset_days)).toEqual([-3, 0, 3, 7, 14]);
    for (const r of rem) {
      const ist = toIst(r.due_at);
      expect(ist).toMatchObject({ hour: 9, minute: 0, second: 0 });
      const expected = new Date(`${due}T00:00:00Z`);
      expected.setUTCDate(expected.getUTCDate() + r.offset_days);
      expect(toIsoDate(ist)).toBe(expected.toISOString().slice(0, 10));
      expect(r).toMatchObject({ sent_at: null, skipped_reason: null });
    }
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'invoice.send' AND entity_id = ?",
      made.id,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({ kind: "send", recipients: 2, reminders: 5 });
    expect(audit?.summary).not.toMatch(/@example\.test/);
  });

  it("the client's own offsets replace the settings'; a client with reminders off gets none", async () => {
    const a = await issued(1);
    await env.DB.prepare("UPDATE clients SET reminder_policy = ? WHERE id = ?")
      .bind(JSON.stringify({ enabled: true, offsetsDays: [5, 9] }), a.made.clientId)
      .run();
    await send(a.s, a.made.id, { contactIds: a.ids });
    expect((await remindersOf(a.made.id)).map((r) => r.offset_days)).toEqual([5, 9]);
    const b = await issued(1);
    await env.DB.prepare("UPDATE clients SET reminder_policy = ? WHERE id = ?")
      .bind(JSON.stringify({ enabled: false }), b.made.clientId)
      .run();
    const res = await send(b.s, b.made.id, { contactIds: b.ids });
    expect((await json(res)).reminders).toBe(0);
    expect(await remindersOf(b.made.id)).toEqual([]);
  });

  it("attachPdf: the client's setting by default, the request's when given", async () => {
    const a = await issued(2);
    await env.DB.prepare("UPDATE clients SET attach_pdf = 1 WHERE id = ?").bind(a.made.clientId).run();
    await send(a.s, a.made.id, { contactIds: [a.ids[0]] });
    await send(a.s, a.made.id, { contactIds: [a.ids[1]], attachPdf: false });
    const rowsOf = (await sendsOf(a.made.id)).map((r) => [r.kind, r.attach_pdf]);
    expect(rowsOf.sort()).toEqual(
      [
        ["resend", 0],
        ["send", 1],
      ].sort(),
    );
  });

  it("with the PDF stored the emails are queued at once as invoice.send (never offer.send); without it nothing is queued and the render step does it", async () => {
    const a = await issued(2);
    const q = captureQueue();
    const waiting = await send(a.s, a.made.id, { contactIds: a.ids }, q.env);
    expect((await json(waiting)).waitingForPdf).toBe(true);
    expect(q.sent).toEqual([]);

    const b = await issued(2);
    await env.DB.prepare(
      "UPDATE documents SET pdf_sha256 = ?, pdf_r2_key = 'docs/x.pdf', snapshot_r2_key = 'docs/x.json' WHERE id = ?",
    )
      .bind("p".repeat(64), b.made.id)
      .run();
    const q2 = captureQueue();
    const res = await send(b.s, b.made.id, { contactIds: b.ids }, q2.env);
    expect((await json(res)).waitingForPdf).toBe(false);
    const ids = (await sendsOf(b.made.id)).map((r) => r.id).sort();
    expect((q2.sent as { kind: string; sendId: string }[]).map((m) => m.sendId).sort()).toEqual(ids);
    for (const m of q2.sent as { kind: string }[]) expect(m.kind).toBe("invoice.send");
    expect(q2.batches).toBe(1);
  });

  it("a queue that fails never fails the send (the rows are written; the sweep picks them up)", async () => {
    const b = await issued(1);
    await env.DB.prepare(
      "UPDATE documents SET pdf_sha256 = ?, pdf_r2_key = 'docs/y.pdf', snapshot_r2_key = 'docs/y.json' WHERE id = ?",
    )
      .bind("p".repeat(64), b.made.id)
      .run();
    const failing = captureQueue(env, () => {
      throw new Error("queue down");
    });
    const res = await send(b.s, b.made.id, { contactIds: b.ids }, failing.env);
    expect(res.status).toBe(200);
    expect(await sendsOf(b.made.id)).toHaveLength(1);
  });
});

describe("sending again [ADM-INV-15]", () => {
  it("a second send is a resend, writes no reminders, and the first rows stay", async () => {
    const { s, made, ids } = await issued(2);
    await send(s, made.id, { contactIds: [ids[0]] });
    const before = await remindersOf(made.id);
    const res = await send(s, made.id, { contactIds: [ids[1]] });
    expect(await json(res)).toEqual({
      ok: true,
      kind: "resend",
      sends: 1,
      reminders: 0,
      waitingForPdf: true,
      remindersPaused: false,
    });
    expect((await sendsOf(made.id)).map((r) => r.kind).sort()).toEqual(["resend", "send"]);
    expect(await remindersOf(made.id)).toEqual(before);
  });

  it("an invoice first sent after some of its days have passed creates only the offsets still ahead (fake clock)", async () => {
    const s = await farSession();
    await putCompany();
    const made = await mkInvoice(s);
    expect((await issueInvoice(s, made.id)).status).toBe(200);
    const to = await mkContact(made.clientId, { portal_access: 1, can_see_finance: 1 });
    const due = (await one<{ due_date: string }>("SELECT due_date FROM documents WHERE id = ?", made.id))
      ?.due_date as string;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // 10:00 IST on the due date itself: the offsets of that day and before are gone, +3 +7 +14 remain
      vi.setSystemTime(Date.parse(`${due}T04:30:00Z`));
      const res = await send(s, made.id, { contactIds: [to.id] });
      expect(res.status).toBe(200);
      expect((await json(res)).reminders).toBe(3);
      expect((await remindersOf(made.id)).map((r) => r.offset_days)).toEqual([3, 7, 14]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the wall clock of the send (local; the staging reading is the gate)", () => {
  it("a send to five recipients with reminders is one request", async () => {
    const { s, made, ids } = await issued(5);
    const t0 = performance.now();
    const res = await send(s, made.id, { contactIds: ids });
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    expect(res.status).toBe(200);
    expect((await sendsOf(made.id)).length).toBe(5);
    expect(ms, `[M5.4 wall clock] send x5: ${ms} ms`).toBeLessThan(2_000);
    console.info(`[M5.4 wall clock ms] send x5: ${ms}`);
  });
});

describe("the view after a send [ADM-INV-15]", () => {
  it("lists the sends with their email status, the live links, the reminders and actions.send", async () => {
    const { s, made, ids } = await issued(2);
    const before = await getInvoice(s, made.id);
    expect(before.sends).toEqual([]);
    expect(before.reminders).toEqual({
      started: false,
      paused: false,
      window: { from: "09:00", to: "19:00" },
      rows: [],
    });
    expect(before.links).toEqual({ live: 0 });
    expect(before.actions.send).toEqual({ allowed: true, reasons: [] });
    await send(s, made.id, { contactIds: ids });
    const sendRow = (await sendsOf(made.id))[0];
    await insert("email_log", {
      id: uuidv7(),
      to_email: "x@example.test",
      template: "invoice.sent",
      entity_type: "document_send",
      entity_id: sendRow?.id,
      status: "sent",
    });
    const v = await getInvoice(s, made.id);
    expect(v.sends).toHaveLength(2);
    expect(Object.keys(v.sends[0]).sort()).toEqual([
      "cancelledAt",
      "contactName",
      "createdAt",
      "email",
      "emailStatus",
      "id",
      "kind",
      "queuedAt",
      "sentByName",
    ]);
    expect(v.sends.find((r: { id: string }) => r.id === sendRow?.id).emailStatus).toBe("sent");
    expect(v.reminders.started).toBe(true);
    expect(v.reminders.rows).toHaveLength(5);
    expect(Object.keys(v.reminders.rows[0]).sort()).toEqual(["dueAt", "offset", "sentAt", "skippedReason"]);
  });

  it("each send names the staff member who made it; an automatic send names nobody (Q5)", async () => {
    const s = await sessionFor("owner", { stepUp: true, name: "Rupak Sarkar" });
    const { made, ids } = await issued(2);
    // the invoice above belongs to its own session: send again as the named member (so a name taken from the issuer or creator fails here)
    await send(s, made.id, { contactIds: ids });
    const mine = (await sendsOf(made.id)).filter((r) => r.created_by === s.id);
    expect(mine).toHaveLength(2);
    // an automatic send is written by the Owner who turned the switch on, yet names nobody
    const auto = uuidv7();
    await insert("document_sends", {
      id: auto,
      document_id: made.id,
      version_group_id: made.id,
      client_id: made.clientId,
      contact_id: ids[0],
      email: "auto@example.test",
      attach_pdf: 0,
      kind: "auto",
      created_by: s.id,
      created_at: Date.now() + 1000,
    });
    const v = await getInvoice(s, made.id);
    const byId = new Map<string, { sentByName: string | null }>(
      v.sends.map((r: { id: string; sentByName: string | null }) => [r.id, r]),
    );
    expect(byId.get(auto)?.sentByName).toBeNull();
    expect(byId.get(mine[0]?.id as string)?.sentByName).toBe("Rupak Sarkar");
    expect(byId.get(mine[1]?.id as string)?.sentByName).toBe("Rupak Sarkar");
  });

  it("actions.send says why not: a draft, a void invoice, a role that cannot", async () => {
    const s = await owner();
    await putCompany();
    const draft = await mkInvoice(s);
    expect((await getInvoice(s, draft.id)).actions.send).toEqual({ allowed: false, reasons: ["not_issued"] });
    const v = await issued(1);
    await voidInvoice(v.s, v.made.id);
    expect((await getInvoice(v.s, v.made.id)).actions.send.reasons).toEqual(["invoice_void"]);
    const accountant = await sessionFor("accountant");
    const other = await issued(1);
    expect((await getInvoice(accountant, other.made.id)).actions.send.reasons).toEqual(["forbidden"]);
  });

  it("after a send the invoice can no longer be voided (the M5.1 rule: already emailed)", async () => {
    const { s, made, ids } = await issued(1);
    await send(s, made.id, { contactIds: ids });
    const res = await voidInvoice(s, made.id);
    expect(res.status).toBe(409);
    expect(JSON.stringify(await json(res))).toContain("already_emailed");
  });
});

/** A live link for a send, bound to the contact (the jobs Worker mints these in stage B). */
async function mintLink(documentId: string, sendId: string, token: string) {
  const sendRow = await one<{ contact_id: string; client_id: string; email: string }>(
    "SELECT contact_id, client_id, email FROM document_sends WHERE id = ?",
    sendId,
  );
  await env.DB.prepare(
    "INSERT INTO doc_access_tokens (token_hash, document_id, purpose, expires_at, contact_id, client_id, email, send_id) VALUES (?1, ?2, 'view_pay', ?3, ?4, ?5, ?6, ?7)",
  )
    .bind(
      token,
      documentId,
      Date.now() + 86_400_000,
      sendRow?.contact_id,
      sendRow?.client_id,
      sendRow?.email,
      sendId,
    )
    .run();
}

describe("revoking the links [POR-06, LD60]", () => {
  it("in one batch: the sends with no link yet are cancelled, every live link is revoked, the waiting reminders are paused", async () => {
    const { s, made, ids } = await issued(2);
    await send(s, made.id, { contactIds: ids });
    const [first, second] = await sendsOf(made.id);
    await mintLink(made.id, first?.id as string, "rev-1");
    const res = await call(`/invoices/${made.id}/links/revoke`, { cookie: s.cookie, body: {} });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, revoked: 1, cancelled: 1, paused: 5 });
    expect(
      (
        await one<{ r: number | null }>(
          "SELECT revoked_at AS r FROM doc_access_tokens WHERE token_hash = 'rev-1'",
        )
      )?.r,
    ).not.toBeNull();
    const cancelled = await rows<{ id: string; cancelled_at: number | null }>(
      "SELECT id, cancelled_at FROM document_sends WHERE document_id = ? ORDER BY id",
      made.id,
    );
    expect(cancelled.find((r) => r.id === second?.id)?.cancelled_at).not.toBeNull();
    expect((await remindersOf(made.id)).every((r) => r.skipped_reason === "paused")).toBe(true);
    // the view shows no live link and the reminders paused
    const v = await getInvoice(s, made.id);
    expect(v.links.live).toBe(0);
    expect(v.reminders.paused).toBe(true);
    // a repeat changes nothing but is still a 200
    expect(
      await json(await call(`/invoices/${made.id}/links/revoke`, { cookie: s.cookie, body: {} })),
    ).toEqual({ ok: true, revoked: 0, cancelled: 0, paused: 0 });
    expect((await call(`/invoices/${uuidv7()}/links/revoke`, { cookie: s.cookie, body: {} })).status).toBe(
      404,
    );
  });

  it("the cancel's link lookup names the document, so it SEARCHes doc_access_tokens by its document index, never a SCAN (test-hardening item 5)", async () => {
    const plan = (
      await rows<{ detail: string }>(
        `EXPLAIN QUERY PLAN ${cancelUnlinkedSendsSql("EXISTS (SELECT 1 FROM audit_log WHERE id = ?3)")}`,
        "doc-x",
        1,
        "audit-x",
      )
    )
      .map((r) => r.detail)
      .join("\n");
    expect(plan).not.toMatch(/SCAN (t|doc_access_tokens)\b/);
    expect(plan).toMatch(/SEARCH t USING (COVERING )?INDEX doc_access_tokens_document/);
  });

  it("a draft has nothing to revoke (409 not_issued); Sales may not", async () => {
    const s = await owner();
    await putCompany();
    const draft = await mkInvoice(s);
    expect(
      await codeOf(await call(`/invoices/${draft.id}/links/revoke`, { cookie: s.cookie, body: {} })),
    ).toBe("not_issued");
    const { made } = await issued(1);
    expect(
      (
        await call(`/invoices/${made.id}/links/revoke`, {
          cookie: (await sessionFor("sales")).cookie,
          body: {},
        })
      ).status,
    ).toBe(403);
  });
});

describe("sending again after a revoke [early check finding 5]", () => {
  it("the answer says the reminders are paused (and nothing resumes them); a plain resend says false", async () => {
    const { s, made, ids } = await issued(3);
    expect((await json(await send(s, made.id, { contactIds: [ids[0]] }))).remindersPaused).toBe(false);
    expect((await json(await send(s, made.id, { contactIds: [ids[1]] }))).remindersPaused).toBe(false);
    await call(`/invoices/${made.id}/links/revoke`, { cookie: s.cookie, body: {} });
    const after = await json(await send(s, made.id, { contactIds: [ids[2]] }));
    expect(after).toMatchObject({ kind: "resend", remindersPaused: true });
    expect((await remindersOf(made.id)).every((r) => r.skipped_reason === "paused")).toBe(true);
    await call(`/invoices/${made.id}/reminders/resume`, { cookie: s.cookie, body: {} });
    expect((await json(await send(s, made.id, { contactIds: [ids[0]] }))).remindersPaused).toBe(false);
  });
});

describe("pausing and resuming the reminders [ADM-INV-13, LD60]", () => {
  it("before any send there is nothing to pause or resume: 409 reminders_not_started", async () => {
    const { s, made } = await issued(1);
    for (const what of ["pause", "resume"])
      expect(
        await codeOf(await call(`/invoices/${made.id}/reminders/${what}`, { cookie: s.cookie, body: {} })),
        what,
      ).toBe("reminders_not_started");
  });

  it("pause stops the waiting rows; resume brings back only the ones still in the future", async () => {
    const s = await farSession();
    await putCompany();
    const made = await mkInvoice(s);
    expect((await issueInvoice(s, made.id)).status).toBe(200);
    const to = await mkContact(made.clientId, { portal_access: 1, can_see_finance: 1 });
    await send(s, made.id, { contactIds: [to.id] });
    expect(
      await json(await call(`/invoices/${made.id}/reminders/pause`, { cookie: s.cookie, body: {} })),
    ).toEqual({ ok: true, paused: 5 });
    // pausing twice changes nothing
    expect(
      await json(await call(`/invoices/${made.id}/reminders/pause`, { cookie: s.cookie, body: {} })),
    ).toEqual({ ok: true, paused: 0 });
    const due = (await one<{ due_date: string }>("SELECT due_date FROM documents WHERE id = ?", made.id))
      ?.due_date as string;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // the day of the due date at noon IST: the -3 and 0 rows passed while paused and must not come back; +3 +7 +14 resume
      vi.setSystemTime(Date.parse(`${due}T06:30:00Z`));
      const res = await call(`/invoices/${made.id}/reminders/resume`, { cookie: s.cookie, body: {} });
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ ok: true, resumed: 3 });
    } finally {
      vi.useRealTimers();
    }
    const rem = await remindersOf(made.id);
    expect(rem.map((r) => [r.offset_days, r.skipped_reason])).toEqual([
      [-3, "paused"],
      [0, "paused"],
      [3, null],
      [7, null],
      [14, null],
    ]);
  });

  it("the view: paused only while a paused row is still ahead; a paused row whose day passed shows missed_while_paused; the window comes from the settings [review M2, L2]", async () => {
    const s = await farSession();
    await putCompany();
    await putBank();
    const made = await mkInvoice(s);
    expect((await issueInvoice(s, made.id)).status).toBe(200);
    await env.DB.prepare("UPDATE clients SET reminder_policy = ? WHERE id = ?")
      .bind(JSON.stringify({ offsetsDays: [0, 1] }), made.clientId)
      .run();
    const to = await mkContact(made.clientId, { portal_access: 1, can_see_finance: 1 });
    await send(s, made.id, { contactIds: [to.id] });
    await call(`/invoices/${made.id}/reminders/pause`, { cookie: s.cookie, body: {} });
    const due = (await one<{ due_date: string }>("SELECT due_date FROM documents WHERE id = ?", made.id))
      ?.due_date as string;
    type Rem = { offset: number; skippedReason: string };
    const rowsOf = (v: unknown) =>
      (v as { reminders: { rows: Rem[] } }).reminders.rows.map((r) => [r.offset, r.skippedReason]);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.parse(`${due}T06:30:00Z`)); // offset 0 has passed (09:00 IST); offset 1 is ahead
      const mid = await getInvoice(s, made.id);
      expect(mid.reminders.paused).toBe(true);
      expect(mid.reminders.window).toEqual({ from: "09:00", to: "19:00" });
      expect(rowsOf(mid)).toEqual([
        [0, "missed_while_paused"],
        [1, "paused"],
      ]);
      vi.setSystemTime(Date.parse(`${due}T06:30:00Z`) + 2 * 86_400_000); // every day has passed
      const late = await getInvoice(await farSession(), made.id); // a session made at this clock
      expect(late.reminders.paused).toBe(false);
      expect(rowsOf(late)).toEqual([
        [0, "missed_while_paused"],
        [1, "missed_while_paused"],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a row already sent or given up is left alone by pause and resume", async () => {
    const { s, made, ids } = await issued(1);
    await send(s, made.id, { contactIds: ids });
    await env.DB.prepare("UPDATE reminders SET sent_at = 5 WHERE document_id = ? AND offset_days = 0")
      .bind(made.id)
      .run();
    await env.DB.prepare(
      "UPDATE reminders SET skipped_reason = 'void' WHERE document_id = ? AND offset_days = 3",
    )
      .bind(made.id)
      .run();
    expect(
      (await json(await call(`/invoices/${made.id}/reminders/pause`, { cookie: s.cookie, body: {} }))).paused,
    ).toBe(3);
    const rem = await remindersOf(made.id);
    expect(rem.find((r) => r.offset_days === 0)).toMatchObject({ sent_at: 5, skipped_reason: null });
    expect(rem.find((r) => r.offset_days === 3)?.skipped_reason).toBe("void");
  });
});
