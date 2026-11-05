// M7.2 the admin routes [ADM-G-09, ADM-MAIL-01, ADM-MAIL-02, ADM-PAY-08, ADM-PAY-09; run file C.1, C.2, D, I "Admin routes", "Scoping"]: the member's own
// notification switches (defaults per role, `digest_owner_only`, `stale_version`, `digest_off_via`), the email log (Sales and Accountant 403; events read by
// message id, finding 5; the generic label, finding 7), the two unsuppress routes (Owner only; a staff address, finding 1), "Send receipt again" (Tier A
// scoping: another client's contact, no finance access, no portal access, voided, anonymised), and the refund email's route producer.
import { env } from "cloudflare:workers";
import { CHALLENGE_TTL_MS } from "@techaust/auth";
import { uuidv7 } from "@techaust/core/ids";
import { SIGNIN_CHALLENGE_TTL_MS } from "@techaust/db/signin-pending";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELIVERY_SQL } from "./document-offer.ts";
import { clearBouncedSql, emailListStatement } from "./emails.ts";
import { setStubTransport } from "./gateway/config.ts";
import { issueReceipt } from "./receipt-issue.ts";
import { mkClient, mkContact } from "./test-clients.ts";
import { stub } from "./test-gateway.ts";
import { call, captureQueue, one, sessionFor } from "./test-helpers.ts";
import { todayIso } from "./test-invoice-types.ts";
import { putCompany } from "./test-invoices.ts";
import { recordBody, recorded } from "./test-payments.ts";
import { mkReportClient } from "./test-reports.ts";

type J = Record<string, unknown> & { error?: { code: string } };
const json = async (r: Response) => (await r.json()) as J;

describe("the Q3 marker's lifetime is the challenge's", () => {
  it("the jobs scan's TTL equals @techaust/auth's CHALLENGE_TTL_MS", () => {
    expect(SIGNIN_CHALLENGE_TTL_MS).toBe(CHALLENGE_TTL_MS);
  });
});

describe("GET and PUT /notifications/prefs (Q1 A, Q2 A)", () => {
  it("a missing row reads as the defaults; the digest only for owners", async () => {
    const o = await sessionFor("owner");
    const s = await sessionFor("staff");
    expect(await json(await call("/notifications/prefs", { cookie: o.cookie }))).toEqual({
      prefs: {
        digestWeekly: true,
        offerViewed: false,
        paymentReceived: true,
        approvals: true,
        hookFailed: true,
      },
      digestAvailable: true,
      digestOffVia: null,
      updatedAt: null,
    });
    expect((await json(await call("/notifications/prefs", { cookie: s.cookie }))).prefs).toMatchObject({
      digestWeekly: false,
      offerViewed: false,
    });
  });

  it("a save upserts, moves the version, records digest_off_via; a stale version is 409; a non-owner can't switch the digest on", async () => {
    const o = await sessionFor("owner");
    const put = (body: unknown, cookie = o.cookie) =>
      call("/notifications/prefs", { method: "PUT", cookie, body });
    const first = await put({ offerViewed: true, digestWeekly: false, expectedUpdatedAt: null });
    expect(first.status).toBe(200);
    const a = await json(first);
    expect(a.prefs).toMatchObject({ offerViewed: true, digestWeekly: false });
    expect(a.digestOffVia).toBe("settings");
    expect(typeof a.updatedAt).toBe("number");
    expect((await put({ digestWeekly: true, expectedUpdatedAt: null })).status).toBe(409);
    const second = await json(await put({ digestWeekly: true, expectedUpdatedAt: a.updatedAt }));
    expect(second.prefs).toMatchObject({ digestWeekly: true, offerViewed: true });
    expect(second.digestOffVia).toBeNull();
    expect(second.updatedAt as number).toBeGreaterThan(a.updatedAt as number);
    expect(
      await one(
        "SELECT count(*) AS n FROM audit_log WHERE action = 'notification.prefs' AND entity_id = ?1",
        o.id,
      ),
    ).toEqual({ n: 2 });
    const s = await sessionFor("staff");
    const denied = await put({ digestWeekly: true, expectedUpdatedAt: null }, s.cookie);
    expect(denied.status).toBe(403);
    expect((await json(denied)).error?.code).toBe("digest_owner_only");
    expect((await put({ approvals: false, expectedUpdatedAt: null }, s.cookie)).status).toBe(200);
  });
});

/** An email log row (as the consumer writes it) and, optionally, its suppression and an event. */
async function logRow(to: string, o: { suppressed?: string; event?: boolean; status?: string } = {}) {
  const id = `log-${uuidv7()}`;
  const mid = `mid-${uuidv7()}`;
  await env.DB.prepare(
    "INSERT INTO email_log (id, to_email, template, entity_type, entity_id, status, ses_message_id, created_at, updated_at) VALUES (?1, ?2, 'invoice.sent', 'document_send', ?1, ?3, ?4, ?5, ?5)",
  )
    .bind(id, to, o.status ?? "bounced", mid, Date.now())
    .run();
  if (o.suppressed)
    await env.DB.prepare("INSERT OR IGNORE INTO email_suppressions (email, reason, at) VALUES (?1, ?2, 1)")
      .bind(to, o.suppressed)
      .run();
  if (o.event)
    // stored before the row was linked: no email_log_id (finding 5)
    await env.DB.prepare(
      "INSERT INTO email_events (id, ses_message_id, type, bounce_type, bounce_sub_type, email_log_id, outcome, received_at) VALUES (?1, ?2, 'bounce', 'permanent', 'General', NULL, 'unknown_message', 2)",
    )
      .bind(`ev-${uuidv7()}`, mid)
      .run();
  return id;
}

describe("the email log (emails.read: Owner and Staff)", () => {
  it("Sales and Accountant are 403; Owner and Staff read pages and filters", async () => {
    for (const role of ["sales", "accountant"] as const) {
      const s = await sessionFor(role);
      expect((await call("/emails", { cookie: s.cookie })).status, role).toBe(403);
    }
    const to = `log-${uuidv7().slice(-8)}@example.test`;
    const id = await logRow(to);
    const st = await sessionFor("staff");
    const list = await json(await call(`/emails?to=${encodeURIComponent(to)}`, { cookie: st.cookie }));
    expect((list.emails as { id: string }[]).map((e) => e.id)).toEqual([id]);
    for (const q of ["status=bounced", "template=invoice.sent", "since=0", ""]) {
      const r = await call(`/emails?${q}`, { cookie: st.cookie });
      expect(r.status, q).toBe(200);
    }
    expect((await call("/emails?status=nope", { cookie: st.cookie })).status).toBe(400);
  });

  it("each filter reaches its rows by its own index, the template filter by email_log_template_created (finding 4); M4.5's delivery read stays on its entity index", async () => {
    const plan = async (sql: string, binds: unknown[]) =>
      (
        await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
          .bind(...binds)
          .all<{ detail: string }>()
      ).results
        .map((r) => r.detail)
        .join(" | ");
    const cases: [Parameters<typeof emailListStatement>[0], RegExp][] = [
      [{ template: "invoice.sent" }, /SEARCH email_log USING INDEX email_log_template_created \(template=\?/],
      [
        { template: "invoice.sent", since: "5" },
        /SEARCH email_log USING INDEX email_log_template_created \(template=\?/,
      ],
      [
        { status: "bounced", template: "invoice.sent" },
        /SEARCH email_log USING INDEX email_log_status_created \(status=\?/,
      ],
      [
        { to: "a@example.test", template: "invoice.sent" },
        /SEARCH email_log USING INDEX email_log_to \(to_email=\?/,
      ],
      [{}, /email_log USING INDEX email_log_created/],
    ];
    for (const [q, re] of cases) {
      const s = emailListStatement(q, { k: 9, id: "z" });
      const p = await plan(s.sql, s.binds);
      expect(p, JSON.stringify(q)).toMatch(re);
      expect(p, JSON.stringify(q)).not.toMatch(/USE TEMP B-TREE/);
    }
    const delivery = await plan(DELIVERY_SQL, ["no-such-id"]);
    expect(delivery).toContain("email_log_entity");
    expect(delivery).not.toContain("email_log_template_created");
    // the template filter returns that template's rows only
    const o = await sessionFor("owner");
    const id = await logRow(`tpl-${uuidv7().slice(-8)}@example.test`, { status: "sent" });
    await env.DB.prepare(
      "INSERT INTO email_log (id, to_email, template, entity_type, entity_id, status, created_at, updated_at) VALUES (?1, 'tpl@example.test', 'receipt.sent', 'receipt', ?1, 'sent', ?2, ?2)",
    )
      .bind(`log-${uuidv7()}`, Date.now())
      .run();
    const listed = (await json(await call("/emails?template=invoice.sent", { cookie: o.cookie }))).emails as {
      id: string;
      template: string;
    }[];
    expect(listed.map((e) => e.id)).toContain(id);
    expect(new Set(listed.map((e) => e.template))).toEqual(new Set(["invoice.sent"]));
  });

  it("Allow emails again clears the contacts by the contacts_email index, never a scan of every contact (finding 10)", async () => {
    for (const address of [
      "(SELECT to_email FROM email_log WHERE id = ?1)",
      "(SELECT email FROM contacts WHERE id = ?1)",
    ]) {
      const plan = (
        await env.DB.prepare(`EXPLAIN QUERY PLAN ${clearBouncedSql(address, "1")}`)
          .bind("x")
          .all<{ detail: string }>()
      ).results
        .map((r) => r.detail)
        .join(" | ");
      expect(plan, address).toMatch(/SEARCH contacts USING INDEX contacts_email \(email=\?\)/);
      expect(plan, address).not.toMatch(/SCAN contacts/);
    }
  });

  it("a page holds at most 50, with a cursor to the next", async () => {
    const o = await sessionFor("owner");
    for (let i = 0; i < 52; i++)
      await logRow(`page-${i}-${uuidv7().slice(-6)}@example.test`, { status: "sent" });
    const first = await json(await call("/emails?status=sent", { cookie: o.cookie }));
    expect((first.emails as unknown[]).length).toBe(50);
    expect(typeof first.next).toBe("string");
    const second = await json(
      await call(`/emails?status=sent&after=${encodeURIComponent(first.next as string)}`, {
        cookie: o.cookie,
      }),
    );
    expect((second.emails as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it("the detail reads its events by SES message id (finding 5) and labels an old reason generically (finding 7)", async () => {
    const o = await sessionFor("owner");
    const to = `old-${uuidv7().slice(-8)}@example.test`;
    // a row written before 0074's reason trigger may say 'bounce': inserted with the trigger out of the way is not possible here, so the label is shown on a
    // known reason, and core's own test covers the unknown one
    const id = await logRow(to, { suppressed: "hard_bounce", event: true });
    const d = await json(await call(`/emails/${id}`, { cookie: o.cookie }));
    expect((d.events as { outcome: string }[]).map((e) => e.outcome)).toEqual(["unknown_message"]);
    expect(d.suppression).toMatchObject({ reason: "hard_bounce", at: 1 });
    expect((await call(`/emails/${"x".repeat(20)}`, { cookie: o.cookie })).status).toBe(404);
  });
});

describe("unsuppress (emails.unsuppress: Owner only)", () => {
  it("POST /emails/:id/unsuppress clears a staff member's (or lead's) address from the row, never by an address in the path (finding 1)", async () => {
    const o = await sessionFor("owner");
    const s = await sessionFor("staff");
    const to = s.email.toLowerCase();
    const id = await logRow(to, { suppressed: "complaint" });
    expect((await call(`/emails/${id}/unsuppress`, { cookie: s.cookie, body: {} })).status).toBe(403);
    // review 1, finding 11: the body is an empty object; a version it would never read is refused, not ignored
    expect(
      (await call(`/emails/${id}/unsuppress`, { cookie: o.cookie, body: { expectedUpdatedAt: 1 } })).status,
    ).toBe(400);
    expect((await call(`/emails/${id}/unsuppress`, { cookie: o.cookie, body: {} })).status).toBe(200);
    expect(await one("SELECT 1 AS x FROM email_suppressions WHERE email = ?1", to)).toBeNull();
    const again = await call(`/emails/${id}/unsuppress`, { cookie: o.cookie, body: {} });
    expect(again.status).toBe(409);
    expect((await json(again)).error?.code).toBe("not_suppressed");
    expect(
      await one(
        "SELECT count(*) AS n FROM audit_log WHERE action = 'email.unsuppress' AND entity_id = ?1",
        id,
      ),
    ).toEqual({ n: 1 });
  });

  it("POST /contacts/:id/unsuppress: stale version, not suppressed, an anonymised client; success clears bounced_at with updated_at untouched", async () => {
    const o = await sessionFor("owner");
    const clientId = await mkClient();
    const email = `bounced-${uuidv7().slice(-8)}@example.test`;
    const ct = await mkContact(clientId, { email, bounced_at: 5 });
    const before = await one<{ updated_at: number }>("SELECT updated_at FROM contacts WHERE id = ?1", ct.id);
    const go = (expectedUpdatedAt: number, cookie = o.cookie) =>
      call(`/contacts/${ct.id}/unsuppress`, { cookie, body: { expectedUpdatedAt } });
    expect((await json(await go(before?.updated_at as number))).error?.code).toBe("not_suppressed");
    await env.DB.prepare("INSERT INTO email_suppressions (email, reason, at) VALUES (?1, 'hard_bounce', 1)")
      .bind(email)
      .run();
    expect((await json(await go((before?.updated_at as number) - 1))).error?.code).toBe("stale_version");
    const s = await sessionFor("staff");
    expect((await go(before?.updated_at as number, s.cookie)).status).toBe(403);
    expect((await go(before?.updated_at as number)).status).toBe(200);
    expect(await one("SELECT bounced_at, updated_at FROM contacts WHERE id = ?1", ct.id)).toEqual({
      bounced_at: null,
      updated_at: before?.updated_at,
    });
    expect(await one("SELECT 1 AS x FROM email_suppressions WHERE email = ?1", email)).toBeNull();
    const gone = await mkClient({ anonymised_at: 5 });
    const g = await mkContact(gone, { email: `gone-${uuidv7().slice(-6)}@example.test` });
    const r = await call(`/contacts/${g.id}/unsuppress`, {
      cookie: o.cookie,
      body: { expectedUpdatedAt: 0 },
    });
    expect((await json(r)).error?.code).toBe("client_anonymised");
  });

  it("the contact's suppression shows on its view (the badge and the send pickers)", async () => {
    const o = await sessionFor("owner");
    const clientId = await mkClient();
    const email = `pick-${uuidv7().slice(-8)}@example.test`;
    await mkContact(clientId, { email });
    await env.DB.prepare("INSERT INTO email_suppressions (email, reason, at) VALUES (?1, 'complaint', 7)")
      .bind(email)
      .run();
    const list = await json(await call(`/clients/${clientId}/contacts`, { cookie: o.cookie }));
    expect((list.contacts as { suppression: unknown }[])[0]?.suppression).toMatchObject({
      reason: "complaint",
      at: 7,
    });
  });
});

describe("Send receipt again (C.2; Tier A scoping) and the refund email's route producer (D)", () => {
  beforeEach(async () => {
    await putCompany();
    stub();
  });
  afterEach(() => setStubTransport(null));
  const ownerSession = () => sessionFor("owner", { stepUp: true });

  it("only the receipt's client's contacts with portal access AND finance access; another client's is refused; an anonymised client is refused", async () => {
    const o = await ownerSession();
    const clientId = await mkReportClient("INR");
    const p = await recorded(o, recordBody(clientId, 2_000));
    const r = await issueReceipt(env, p.id as string);
    expect(r.result).toBe("issued");
    const receipt = await one<{ id: string }>(
      "SELECT id FROM documents WHERE type = 'receipt' AND number_display = ?1",
      r.number,
    );
    const rid = receipt?.id as string;
    const ok = await mkContact(clientId, {
      email: `fin-${uuidv7().slice(-6)}@example.test`,
      portal_access: 1,
      can_see_finance: 1,
    });
    const noFin = await mkContact(clientId, { portal_access: 1, can_see_finance: 0 });
    const noPortal = await mkContact(clientId, { portal_access: 0, can_see_finance: 1 });
    const other = await mkContact(await mkClient(), { portal_access: 1, can_see_finance: 1 });
    const q = captureQueue();
    const send = (contactIds: string[]) =>
      call(`/receipts/${rid}/send`, { cookie: o.cookie, body: { contactIds } }, q.env);
    for (const bad of [noFin.id, noPortal.id, other.id]) {
      const res = await send([ok.id, bad]);
      expect(res.status).toBe(409);
      expect(await json(res)).toMatchObject({ error: { code: "recipient_invalid" } });
    }
    expect(q.sent).toHaveLength(0);
    const res = await send([ok.id]);
    expect(res.status).toBe(202);
    expect(q.sent).toEqual([
      expect.objectContaining({
        template: "receipt.sent",
        to: ok.email,
        entity: expect.objectContaining({ type: "document_send" }),
      }),
    ]);
    expect(await one("SELECT kind, contact_id FROM document_sends WHERE document_id = ?1", rid)).toEqual({
      kind: "resend",
      contact_id: ok.id,
    });
    expect((await send([])).status).toBe(400);
    expect((await send(["a", "b", "c", "d", "e", "f"])).status).toBe(400);
    const s = await sessionFor("sales");
    expect(
      (await call(`/receipts/${rid}/send`, { cookie: s.cookie, body: { contactIds: [ok.id] } })).status,
    ).toBe(403);
    expect(
      (await call(`/receipts/${"rct_none"}/send`, { cookie: o.cookie, body: { contactIds: [ok.id] } }))
        .status,
    ).toBe(404);
    // An anonymised client: refused, nothing written or queued.
    const before = q.sent.length;
    await env.DB.prepare("UPDATE clients SET anonymised_at = ?2 WHERE id = ?1")
      .bind(clientId, Date.now())
      .run();
    const gone = await send([ok.id]);
    expect(gone.status).toBe(409);
    expect((await json(gone)).error?.code).toBe("client_anonymised");
    expect(q.sent).toHaveLength(before);
  });

  it("a payment refunded in full: 409 receipt_refunded, nothing written or queued; a partly refunded one still sends (finding 5)", async () => {
    const o = await ownerSession();
    const clientId = await mkReportClient("INR");
    const ok = await mkContact(clientId, {
      email: `rf-${uuidv7().slice(-6)}@example.test`,
      portal_access: 1,
      can_see_finance: 1,
    });
    const refund = (paymentId: string, amountMinor: number) =>
      call(`/payments/${paymentId}/refunds`, {
        cookie: o.cookie,
        body: {
          id: uuidv7(),
          amountMinor,
          from: "credit",
          reasonCode: "overpayment",
          manual: {
            mode: "neft",
            reference: `UTRR${uuidv7().slice(-10).toUpperCase()}`,
            paidOn: todayIso(),
            paidTo: "original",
          },
        },
      });
    const receiptOf = async (amount: number) => {
      const p = await recorded(o, recordBody(clientId, amount));
      const r = await issueReceipt(env, p.id as string);
      expect(r.result).toBe("issued");
      const d = await one<{ id: string }>(
        "SELECT id FROM documents WHERE type = 'receipt' AND number_display = ?1",
        r.number,
      );
      return { paymentId: p.id as string, rid: d?.id as string };
    };
    const full = await receiptOf(2_000);
    expect((await refund(full.paymentId, 2_000)).status).toBe(200);
    const q = captureQueue();
    const res = await call(
      `/receipts/${full.rid}/send`,
      { cookie: o.cookie, body: { contactIds: [ok.id] } },
      q.env,
    );
    expect(res.status).toBe(409);
    expect((await json(res)).error?.code).toBe("receipt_refunded");
    expect(q.sent).toHaveLength(0);
    expect(await one("SELECT count(*) AS n FROM document_sends WHERE document_id = ?1", full.rid)).toEqual({
      n: 0,
    });
    // the entry's receipt read says so, for the screen to hide the button
    const read = async (paymentId: string) =>
      ((await json(await call(`/payments/${paymentId}/receipt`, { cookie: o.cookie }))).receipt as J)
        .refundedInFull;
    expect(await read(full.paymentId)).toBe(true);
    const part = await receiptOf(3_000);
    expect((await refund(part.paymentId, 1_000)).status).toBe(200);
    const sent = await call(
      `/receipts/${part.rid}/send`,
      { cookie: o.cookie, body: { contactIds: [ok.id] } },
      q.env,
    );
    expect(sent.status).toBe(202);
    expect(q.sent).toHaveLength(1);
    expect(await read(part.paymentId)).toBe(false);
  });

  it("a manual refund recorded succeeded queues refund.notify (ids only) from the route", async () => {
    const o = await ownerSession();
    const clientId = await mkReportClient("INR");
    const p = await recorded(o, recordBody(clientId, 3_000));
    const q = captureQueue();
    const res = await call(
      `/payments/${p.id}/refunds`,
      {
        cookie: o.cookie,
        body: {
          id: uuidv7(),
          amountMinor: 1_000,
          from: "credit",
          reasonCode: "overpayment",
          manual: {
            mode: "neft",
            reference: `UTRM${Date.now().toString(36).toUpperCase()}`,
            paidOn: todayIso(),
            paidTo: "original",
          },
        },
      },
      q.env,
    );
    expect(res.status).toBe(200);
    const refund = (await json(res)).refund as { id: string; status: string };
    expect(refund.status).toBe("succeeded");
    expect(q.sent).toContainEqual({ kind: "refund.notify", refundId: refund.id });
  });

  it("an entry that waits for the Owner's check queues staff.notify payment.verify", async () => {
    const st = await sessionFor("staff", { stepUp: true });
    const clientId = await mkReportClient("INR");
    const q = captureQueue();
    const b = recordBody(clientId, 1_500);
    const res = await call("/payments", { cookie: st.cookie, body: b }, q.env);
    expect(res.status).toBe(201);
    expect(q.sent).toContainEqual({ kind: "staff.notify", bell: "payment.verify", entityId: b.id });
  });
});
