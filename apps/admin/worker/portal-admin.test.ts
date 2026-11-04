// M7.1 in the admin [ADM-PAY-05, POR-09, POR-11, ADM-CLI-05; run file C, I, L8, L10, L23]: the clients' "I've paid" notices (the list by status and by client,
// the dismiss once, recording a payment from one in the same batch, a notice of another client refused, the open notices on the invoice's Payments panel) and
// the portal requests (the list and its filters, Staff closing a data-rights request refused in the handler, the UPDATE and the trigger, the Owner closing it,
// a closed one 409), and the contact's export with both. Invented data only.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { REQUEST_CLOSE_SQL } from "./client-requests.ts";
import { noticeRecordStatement } from "./payments.ts";
import { bodyOf, call, countOf, one, sessionFor } from "./test-helpers.ts";
import { recordBody } from "./test-payments.ts";
import { mkNotice, mkPortalBell, mkPortalClient, mkPortalDocument, mkRequest } from "./test-portal.ts";

const owner = () => sessionFor("owner", { stepUp: true });

describe(`"I've paid" notices [ADM-PAY-05, L10]`, () => {
  it("the Notices tab lists open notices oldest first, filters by client, and counts the open ones; a bad filter is 400", async () => {
    const s = await sessionFor("staff");
    const p = await mkPortalClient();
    const other = await mkPortalClient();
    const a = await mkNotice(p);
    const b = await mkNotice(p);
    const theirs = await mkNotice(other);
    const all = (await (await call("/payments/notices", { cookie: s.cookie })).json()) as {
      items: { id: string }[];
      openCount: number;
    };
    const ids = all.items.map((i) => i.id);
    expect(ids.indexOf(a)).toBeLessThan(ids.indexOf(b));
    expect(ids).toContain(theirs);
    expect(all.openCount).toBeGreaterThanOrEqual(3);
    const mine = (await (
      await call(`/payments/notices?client=${p.clientId}`, { cookie: s.cookie })
    ).json()) as {
      items: { id: string; client: { id: string }; document: { id: string }; reference: string }[];
    };
    expect(mine.items.map((i) => i.id)).toEqual([a, b]);
    expect(mine.items[0]).toMatchObject({ client: { id: p.clientId }, document: { id: p.invoiceId } });
    for (const q of ["status=maybe", "client=a%20b", "after=x"])
      expect((await call(`/payments/notices?${q}`, { cookie: s.cookie })).status, q).toBe(400);
  });

  it("a dismiss closes it once, with the note; a second is 409; an unknown one 404; the audit row holds no words", async () => {
    const s = await sessionFor("staff");
    const id = await mkNotice(await mkPortalClient());
    const close = () =>
      call(`/payments/notices/${id}/close`, {
        cookie: s.cookie,
        body: { outcome: "dismissed", note: " Duplicate of NEFT 9 " },
      });
    expect((await close()).status).toBe(200);
    expect(await one("SELECT status, close_note, closed_by FROM payment_notices WHERE id = ?1", id)).toEqual({
      status: "dismissed",
      close_note: "Duplicate of NEFT 9",
      closed_by: s.id,
    });
    const again = await close();
    expect(again.status).toBe(409);
    expect(((await bodyOf(again)).error as { code: string }).code).toBe("notice_closed");
    expect(
      (
        await call(`/payments/notices/${uuidv7()}/close`, {
          cookie: s.cookie,
          body: { outcome: "dismissed" },
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(`/payments/notices/${id}/close`, { cookie: s.cookie, body: { outcome: "recorded" } }))
        .status,
    ).toBe(400);
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'payment.notice_close' AND entity_id = ?1",
      id,
    );
    expect(audit?.summary).not.toContain("NEFT");
  });

  it("a payment recorded from a notice moves it to recorded with the payment in the same batch (Staff: pending); a notice of another client is 409 and nothing is written", async () => {
    const s = await sessionFor("staff");
    const p = await mkPortalClient();
    const id = await mkNotice(p);
    const body = recordBody(p.clientId, 118_000, [{ documentId: p.invoiceId, amountMinor: 118_000 }], {
      noticeId: id,
    });
    const res = await call("/payments", { cookie: s.cookie, body });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { notice: unknown }).notice).toEqual({ id, recorded: true });
    expect(await one("SELECT status, payment_id FROM payment_notices WHERE id = ?1", id)).toEqual({
      status: "recorded",
      payment_id: body.id,
    });
    // A closed notice can't be recorded from again; another client's notice is refused before anything is written.
    const again = await call("/payments", {
      cookie: s.cookie,
      body: recordBody(p.clientId, 1000, [], { noticeId: id }),
    });
    expect(again.status).toBe(409);
    expect(((await bodyOf(again)).error as { code: string }).code).toBe("notice_closed");
    const other = await mkPortalClient();
    const theirs = await mkNotice(other);
    const before = await countOf("payments");
    const wrong = await call("/payments", {
      cookie: s.cookie,
      body: recordBody(p.clientId, 1000, [], { noticeId: theirs }),
    });
    expect(wrong.status).toBe(409);
    expect(((await bodyOf(wrong)).error as { code: string }).code).toBe("notice_mismatch");
    expect(await countOf("payments")).toBe(before);
    // TDS is never recorded from a notice (the schema).
    expect(
      (
        await call("/payments", {
          cookie: s.cookie,
          body: { ...recordBody(p.clientId, 1000), kind: "tds", noticeId: theirs },
        })
      ).status,
    ).toBe(400);
  });

  it("early check 2, finding 1: a notice on invoice A recorded by a payment put only on B (or kept as credit) is 409 notice_mismatch (reason document) and writes nothing; the batch statement needs A among the documents too", async () => {
    const s = await sessionFor("staff");
    const p = await mkPortalClient();
    const b = await mkPortalDocument(p, "tax_invoice");
    const id = await mkNotice(p);
    const before = { payments: await countOf("payments"), approvals: await countOf("approvals") };
    for (const allocations of [[{ documentId: b, amountMinor: 59_000 }], []]) {
      const res = await call("/payments", {
        cookie: s.cookie,
        body: recordBody(p.clientId, 59_000, allocations, { noticeId: id }),
      });
      expect(res.status).toBe(409);
      expect((await bodyOf(res)).error).toMatchObject({
        code: "notice_mismatch",
        details: { reason: "document", documentId: p.invoiceId },
      });
    }
    expect({ payments: await countOf("payments"), approvals: await countOf("approvals") }).toEqual(before);
    expect(await one("SELECT status, payment_id FROM payment_notices WHERE id = ?1", id)).toEqual({
      status: "open",
      payment_id: null,
    });
    // The batch twin: with a payment of this client on B, the statement moves the notice only when A is among the documents.
    const onB = recordBody(p.clientId, 59_000, [{ documentId: b, amountMinor: 59_000 }]);
    expect((await call("/payments", { cookie: s.cookie, body: onB })).status).toBe(201);
    const pass = { sql: () => "1 = 1", params: [] as const };
    const stmt = (documentIds: string[]) =>
      noticeRecordStatement(
        env.DB,
        { noticeId: id, paymentId: onB.id, by: s.id, now: Date.now(), clientId: p.clientId, documentIds },
        pass,
      ).run();
    expect((await stmt([b])).meta.changes).toBe(0);
    expect(
      (await one<{ status: string }>("SELECT status FROM payment_notices WHERE id = ?1", id))?.status,
    ).toBe("open");
    expect((await stmt([b, p.invoiceId])).meta.changes).toBe(1);
  });

  it("early check 2, finding 1 (L25): a proforma notice is recorded only by Staff's whole-amount proforma ask; the Owner's entry is 409 use_advance_invoice and the notice stays open; no ask is 409", async () => {
    const s = await sessionFor("staff");
    const o = await owner();
    const p = await mkPortalClient();
    const pf = await mkPortalDocument(p, "proforma");
    const id = await mkNotice(p, { documentId: pf, amountMinor: 59_000 });
    const ask = [{ documentId: pf, amountMinor: 59_000 }];
    // The Owner's confirmed entry may not ask for a proforma (L5): refused, and the notice stays open.
    const own = await call("/payments", {
      cookie: o.cookie,
      body: recordBody(p.clientId, 59_000, ask, { noticeId: id }),
    });
    expect(own.status).toBe(409);
    expect(((await bodyOf(own)).error as { code: string }).code).toBe("use_advance_invoice");
    // No proforma ask (kept as credit, or put on the invoice): refused as another document.
    for (const allocations of [[], [{ documentId: p.invoiceId, amountMinor: 59_000 }]]) {
      const res = await call("/payments", {
        cookie: s.cookie,
        body: recordBody(p.clientId, 59_000, allocations, { noticeId: id }),
      });
      expect(res.status).toBe(409);
      expect((await bodyOf(res)).error).toMatchObject({
        code: "notice_mismatch",
        details: { reason: "document" },
      });
    }
    expect(
      (await one<{ status: string }>("SELECT status FROM payment_notices WHERE id = ?1", id))?.status,
    ).toBe("open");
    // Staff's pending entry with the whole-amount proforma ask records it.
    const body = recordBody(p.clientId, 59_000, ask, { noticeId: id });
    const res = await call("/payments", { cookie: s.cookie, body });
    expect(res.status).toBe(201);
    expect((await res.json()) as { status: string; notice: unknown }).toMatchObject({
      status: "pending_verification",
      notice: { id, recorded: true },
    });
    expect(await one("SELECT status, payment_id FROM payment_notices WHERE id = ?1", id)).toEqual({
      status: "recorded",
      payment_id: body.id,
    });
  });

  it("the invoice's Payments panel lists its open notices (a warning on void and withdraw, never a block)", async () => {
    const s = await sessionFor("staff");
    const p = await mkPortalClient();
    const id = await mkNotice(p, { amountMinor: 5000 });
    const res = await call(`/invoices/${p.invoiceId}/payments`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { notices: unknown[] }).notices).toEqual([
      expect.objectContaining({ id, amountMinor: 5000, currency: "INR", paidOn: "2026-11-03" }),
    ]);
  });
});

describe("portal requests [POR-09, POR-11, L8]", () => {
  it("lists by status (oldest first) with a kind filter, and a client's (newest first); canClose follows the member's role and the kind", async () => {
    const staff = await sessionFor("staff");
    const p = await mkPortalClient();
    const access = await mkRequest(p, "data_access");
    const change = await mkRequest(p, "contact_change", "Add Ravi");
    const list = (await (
      await call("/client-requests?kind=data_access", { cookie: staff.cookie })
    ).json()) as {
      items: { id: string; kind: string; canClose: boolean }[];
      openCount: number;
    };
    expect(list.items.every((i) => i.kind === "data_access")).toBe(true);
    expect(list.items.find((i) => i.id === access)?.canClose).toBe(false);
    const mine = (await (
      await call(`/client-requests?client=${p.clientId}`, { cookie: staff.cookie })
    ).json()) as {
      items: { id: string; canClose: boolean }[];
    };
    expect(mine.items.map((i) => i.id)).toEqual([change, access]);
    expect(mine.items[0]?.canClose).toBe(true);
    for (const q of ["status=pending", "kind=nomination", "client=%20"])
      expect((await call(`/client-requests?${q}`, { cookie: staff.cookie })).status, q).toBe(400);
  });

  it("Staff close a contact change or a grievance; a data-rights request is 403 for Staff and closes for the Owner; a closed one is 409", async () => {
    const staff = await sessionFor("staff");
    const o = await owner();
    const p = await mkPortalClient();
    const change = await mkRequest(p, "contact_change", "Add Ravi");
    const erase = await mkRequest(p, "data_erasure");
    const close = (s: { cookie: string }, id: string, outcome = "done") =>
      call(`/client-requests/${id}/close`, { cookie: s.cookie, body: { outcome, note: "Handled" } });
    expect((await close(staff, change)).status).toBe(200);
    const refused = await close(staff, erase);
    expect(refused.status).toBe(403);
    expect(await one("SELECT status FROM client_requests WHERE id = ?1", erase)).toEqual({ status: "open" });
    expect((await close(o, erase, "declined")).status).toBe(200);
    expect(
      await one("SELECT status, outcome, closed_by, close_note FROM client_requests WHERE id = ?1", erase),
    ).toEqual({
      status: "closed",
      outcome: "declined",
      closed_by: o.id,
      close_note: "Handled",
    });
    const again = await close(o, erase);
    expect(again.status).toBe(409);
    expect(((await bodyOf(again)).error as { code: string }).code).toBe("request_closed");
    expect(await countOf("audit_log", `action = 'client_request.close' AND entity_id = '${erase}'`)).toBe(1);
  });

  it("the close UPDATE's own WHERE refuses Staff on a data-rights kind even when the handler is passed (finding 3, the second of three places)", async () => {
    const staff = await sessionFor("staff");
    const p = await mkPortalClient();
    const id = await mkRequest(p, "data_access");
    const r = await env.DB.prepare(REQUEST_CLOSE_SQL)
      .bind(id, "done", staff.id, Date.now(), null, "staff")
      .run();
    expect(r.meta.changes).toBe(0);
    // And with the role forged as owner, the trigger refuses a Staff member as the closer.
    await expect(
      env.DB.prepare(REQUEST_CLOSE_SQL).bind(id, "done", staff.id, Date.now(), null, "owner").run(),
    ).rejects.toThrow(/client_requests_owner_close/);
  });
});

describe("the contact's export [ADM-CLI-05, RB-36]", () => {
  it("lists the parts client_requests and payment_notices, with this contact's rows only", async () => {
    const o = await owner();
    const p = await mkPortalClient();
    const req = await mkRequest(p, "grievance", "My concern");
    const notice = await mkNotice(p);
    const other = await mkPortalClient();
    await mkRequest(other, "grievance", "Theirs");
    const summary = (await (
      await call(`/contacts/${p.contactId}/export`, { cookie: o.cookie, body: {} })
    ).json()) as {
      manifest: string[];
    };
    expect(summary.manifest).toEqual(expect.arrayContaining(["client_requests", "payment_notices"]));
    for (const [part, id] of [
      ["client_requests", req],
      ["payment_notices", notice],
    ] as const) {
      const page = (await (
        await call(`/contacts/${p.contactId}/export`, { cookie: o.cookie, body: { part } })
      ).json()) as {
        items: { id: string }[];
      };
      expect(
        page.items.map((i) => i.id),
        part,
      ).toEqual([id]);
    }
  });

  it("early check 2, finding 5 (RB-36): both parts carry the staff's close note", async () => {
    const o = await owner();
    const p = await mkPortalClient();
    const req = await mkRequest(p, "grievance", "My concern");
    const notice = await mkNotice(p);
    expect(
      (
        await call(`/client-requests/${req}/close`, {
          cookie: o.cookie,
          body: { outcome: "done", note: "Answered by phone" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`/payments/notices/${notice}/close`, {
          cookie: o.cookie,
          body: { outcome: "dismissed", note: "Not received yet" },
        })
      ).status,
    ).toBe(200);
    for (const [part, id, note] of [
      ["client_requests", req, "Answered by phone"],
      ["payment_notices", notice, "Not received yet"],
    ] as const) {
      const page = (await (
        await call(`/contacts/${p.contactId}/export`, { cookie: o.cookie, body: { part } })
      ).json()) as { items: { id: string; close_note: string | null; closed_at: number | null }[] };
      expect(page.items, part).toEqual([expect.objectContaining({ id, close_note: note })]);
      expect(page.items[0]?.closed_at, part).toEqual(expect.any(Number));
    }
  });
});

describe("early check 2, finding 2: an erase or anonymise removes the portal bells that name the person [RB-11]", () => {
  // An individual with an issued document (a notice is always about one) can only be anonymised (CONTACT_ON_ISSUED_DOCUMENT_SQL), so the erase runs on the
  // business contact alone, and the anonymise on both.
  for (const mode of ["erase", "anonymise"] as const)
    it(`${mode}: a business contact's request bells go and its client's notice bells stay; ${mode === "anonymise" ? "an individual's last contact takes both; " : ""}another client's stay`, async () => {
      const o = await owner();
      const business = await mkPortalClient();
      const individual = await mkPortalClient(mode === "anonymise" ? "individual" : "business");
      const other = await mkPortalClient();
      const bell = async (p: Awaited<ReturnType<typeof mkPortalClient>>) => ({
        request: await mkPortalBell(o.id, "client_request", await mkRequest(p, "grievance", "Named")),
        notice: await mkPortalBell(o.id, "payment_notice", await mkNotice(p)),
      });
      const b = await bell(business);
      const i = await bell(individual);
      const x = await bell(other);
      const left = async (ids: string[]) =>
        (
          await env.DB.prepare(
            `SELECT id FROM notifications WHERE id IN (${ids.map((_, k) => `?${k + 1}`).join(", ")})`,
          )
            .bind(...ids)
            .all<{ id: string }>()
        ).results.map((r) => r.id);
      for (const p of mode === "anonymise" ? [business, individual] : [business]) {
        const res = await call(`/contacts/${p.contactId}/erase`, {
          cookie: o.cookie,
          body: { mode, reason: "requested" },
        });
        expect(res.status, await res.clone().text()).toBe(200);
      }
      const gone = mode === "anonymise" ? [b.request, i.request, i.notice] : [b.request];
      const kept = [b.notice, x.request, x.notice, ...(mode === "anonymise" ? [] : [i.request, i.notice])];
      expect(await left(gone)).toEqual([]);
      expect((await left(kept)).sort()).toEqual(kept.sort());
    });
});
