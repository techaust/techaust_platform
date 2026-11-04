// M7.1's routes, failure paths first [POR-04, POR-06, POR-07, POR-08, POR-09, POR-11, ADM-PAY-05; run file C, I, J]: shared files (headers, streamed, unshare
// between list and download, an R2 miss), the lists' keyset pages, Home and the project page in one batch each, the receipts and credit-notes list, the
// Profile page (a stale save, an email in the body, the colleagues by name and title only, one audit row), requests (the open kind, the daily cap, the details
// rule, one `portal.alert` each) and "I've paid" (every refusal in SQL, the open limit, the duplicate, the link path and its counter). Invented test data.
import { env } from "cloudflare:workers";
import { docTokenStmt, portalFailKey } from "@techaust/auth";
import { uuidv7 } from "@techaust/core";
import { NOTICES_OPEN_MAX, REQUESTS_PER_DAY } from "@techaust/core/portal";
import { describe, expect, it, vi } from "vitest";
import { fixtures } from "./fixtures.ts";
import { SESSION_READ } from "./guard.ts";
import {
  attemptsRow,
  bodyOf,
  call,
  captureQueue,
  counted,
  countOf,
  extraContact,
  one,
  rows,
  sessionFor,
  spyConsole,
  withEnv,
} from "./test-helpers.ts";

const DAY = 86_400_000;
const istDay = (ms: number) => new Date(ms + 19_800_000).toISOString().slice(0, 10);
const today = () => istDay(Date.now());
let seq = 0;

/** A frozen, issued document of an organisation with an issue day and a balance (a notice's subject). */
async function payableDoc(
  clientId: string,
  o: {
    type?: string;
    status?: string;
    balance?: number;
    issueDate?: string;
    voided?: boolean;
    viewed?: boolean;
  } = {},
) {
  const id = uuidv7();
  const n = ++seq + 7000;
  await env.DB.prepare(
    "INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor, voided_at, void_reason, viewed_at) VALUES (?1, ?2, ?3, ?4, 'INR', 'inv-m71', '2627', ?5, ?6, ?7, ?8, '2026-12-31', 100000, 100000, 118000, ?9, ?10, ?11, ?12)",
  )
    .bind(
      id,
      o.type ?? "tax_invoice",
      o.status ?? "issued",
      clientId,
      n,
      `TH/M/${n}`,
      Date.now() - DAY,
      o.issueDate ?? "2026-11-01",
      o.balance ?? 118000,
      o.voided ? Date.now() : null,
      o.voided ? "Test" : null,
      o.viewed ? Date.now() - DAY : null,
    )
    .run();
  return id;
}
const notice = (body: Record<string, unknown>) => ({
  amountMinor: 1000,
  paidOn: today(),
  reference: `UTR${++seq}`,
  ...body,
});

describe("shared files [POR-08, ADM-PRJ-04, L5]", () => {
  it("a download is the bytes, streamed, as an attachment, never cached, never sniffed; one access row, no audit row", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    const audit = await countOf("audit_log");
    const res = await call(`/files/${f.a.portal.sharedFile}/download`, {
      cookie: s.cookie,
      headers: { "cf-ray": "ray-dl" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(ReadableStream);
    expect(await res.text()).toBe(f.a.portal.fileBytes);
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="Brief CL-A\.pdf"/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(await countOf("access_log", "request_id = 'ray-dl'")).toBe(1);
    expect(await countOf("audit_log")).toBe(audit);
  });

  it("a file unshared between the list and the click is the plain 404; R2 is not read", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    const fid = uuidv7();
    const key = `files/${f.a.id}/${fid}`;
    await env.FILES.put(key, "x");
    await env.DB.prepare(
      "INSERT INTO files (id, client_id, project_id, r2_key, filename, mime, size, sha256, shared) VALUES (?1, ?2, ?3, ?4, 'a.pdf', 'application/pdf', 1, ?5, 1)",
    )
      .bind(fid, f.a.id, f.a.portal.project, key, "b".repeat(64))
      .run();
    const list = (await (
      await call(`/files?project=${f.a.portal.project}`, { cookie: s.cookie })
    ).json()) as {
      files: { id: string }[];
    };
    expect(list.files.map((x) => x.id)).toContain(fid);
    await env.DB.prepare("UPDATE files SET shared = 0 WHERE id = ?1").bind(fid).run();
    const get = vi.spyOn(env.FILES, "get");
    try {
      const res = await call(`/files/${fid}/download`, { cookie: s.cookie });
      expect(res.status).toBe(404);
      expect(get).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
    }
  });

  it("a shared file whose object is missing is the plain 404 and one error line with no name or key", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    const spy = spyConsole();
    let res: Response;
    try {
      res = await call(`/files/${f.a.portal.missingFile}/download`, { cookie: s.cookie });
    } finally {
      spy.stop();
    }
    expect(res.status).toBe(404);
    const errors = spy.lines.filter((l) => l.includes("shared file missing in storage"));
    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toContain("Brief");
    expect(errors[0]).not.toContain(`files/${f.a.id}`); // the R2 key
  });
});

describe("lists are keyset pages of at most 50 [POR-08, NFR-9]", () => {
  it("projects: newest first, every status, one per page with limit=1, then the next", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    const first = (await (await call("/projects?limit=1", { cookie: s.cookie })).json()) as {
      projects: { id: string; status: string }[];
      next: string | null;
    };
    expect(first.projects.map((p) => p.id)).toEqual([f.a.portal.project]);
    expect(first.next).not.toBeNull();
    const second = (await (
      await call(`/projects?limit=1&after=${encodeURIComponent(first.next as string)}`, { cookie: s.cookie })
    ).json()) as { projects: { id: string; status: string }[] };
    expect(second.projects).toEqual([
      expect.objectContaining({ id: f.a.portal.doneProject, status: "completed" }),
    ]);
    for (const bad of ["limit=500", "limit=x", "after=1:a;b", "after=nope"])
      expect((await call(`/projects?${bad}`, { cookie: s.cookie })).status, bad).toBe(400);
  });

  it("notes and files: shared only; a project filter that is not an id is a 400", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    const notes = (await (await call("/notes", { cookie: s.cookie })).json()) as { notes: { id: string }[] };
    expect(notes.notes.map((n) => n.id).sort()).toEqual(
      [f.a.portal.sharedNote, f.a.portal.clientNote].sort(),
    );
    expect((await call("/notes?project=a%20b", { cookie: s.cookie })).status).toBe(400);
    const files = (await (await call("/files", { cookie: s.cookie })).json()) as {
      files: Record<string, unknown>[];
    };
    expect(files.files.map((x) => x.id)).not.toContain(f.a.portal.unsharedFile);
    for (const x of files.files) expect(Object.keys(x)).not.toContain("r2Key");
  });
});

describe("Home and the project page: one batch each [run file J]", () => {
  const statementsOf = (seen: { sql: string }[]) =>
    seen.filter(
      (x) => x.sql !== SESSION_READ && !/^INSERT INTO access_log|^UPDATE client_sessions/.test(x.sql),
    );

  it("Home is one batch of 6 statements for a finance contact and 4 without finance, each at most 5 rows", async () => {
    const f = await fixtures();
    for (const [who, n] of [
      [f.a.finance, 6],
      [f.a.plain, 4],
    ] as const) {
      const s = await sessionFor(who);
      const c = counted();
      const res = await call("/home", { cookie: s.cookie }, c.env);
      expect(res.status).toBe(200);
      expect(statementsOf(c.seen)).toHaveLength(n);
      for (const st of statementsOf(c.seen)) expect(st.sql).toMatch(/LIMIT (5|\?\d)\b|LIMIT 5$/);
    }
  });

  it("the project page is one batch of 4 statements", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const c = counted();
    const res = await call(`/projects/${f.a.portal.project}`, { cookie: s.cookie }, c.env);
    expect(res.status).toBe(200);
    expect(statementsOf(c.seen)).toHaveLength(4);
    const body = (await res.json()) as { notes: { id: string }[]; files: { id: string }[] };
    expect(body.notes.map((n) => n.id)).toEqual([f.a.portal.sharedNote]);
    expect(body.files.map((x) => x.id)).toContain(f.a.portal.sharedFile);
  });
});

describe("receipts and credit notes [POR-07, L20]", () => {
  it("lists the organisation's issued receipts and credit notes, with what each is for and whether its PDF is ready", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const res = await call("/receipts", { cookie: s.cookie });
    expect(res.status).toBe(200);
    const items = ((await res.json()) as { items: Record<string, unknown>[] }).items;
    const ids = items.map((i) => i.id);
    expect(ids).toContain(f.a.portal.receipt);
    expect(ids).toContain(f.a.portal.creditNote);
    expect(ids).not.toContain(f.b.portal.receipt);
    expect(items.find((i) => i.id === f.a.portal.receipt)).toMatchObject({
      kind: "receipt",
      amountMinor: 50000,
      pdfReady: true,
      for: { numbers: ["TH/INV/2627/0001"], more: 0 },
    });
    expect(items.find((i) => i.id === f.a.portal.creditNote)).toMatchObject({
      kind: "credit_note",
      for: { invoiceId: f.a.portal.payable },
    });
  });
});

describe("Profile [POR-09, Q1 = A, L15]", () => {
  it("the colleagues are names and titles of live contacts with portal access only: no email, no phone, no id", async () => {
    const f = await fixtures();
    await env.DB.prepare("UPDATE contacts SET phone = '+91 90000 00000', title = 'Director' WHERE id = ?1")
      .bind(f.a.finance.id)
      .run();
    const s = await sessionFor(f.a.plain);
    const body = (await (await call("/profile", { cookie: s.cookie })).json()) as {
      me: Record<string, unknown>;
      colleagues: Record<string, unknown>[];
    };
    expect(body.me).toMatchObject({ name: f.a.plain.name, email: f.a.plain.email });
    const names = body.colleagues.map((c) => c.name);
    expect(names).toContain(f.a.finance.name);
    expect(names).not.toContain(f.a.noAccess.name);
    expect(names).not.toContain(f.a.anonymised.name);
    for (const c of body.colleagues) expect(Object.keys(c).sort()).toEqual(["name", "title", "you"]);
    expect(JSON.stringify(body.colleagues)).not.toContain("+91");
    expect(JSON.stringify(body.colleagues)).not.toContain("@");
    expect(body.colleagues.find((c) => c.name === f.a.plain.name)?.you).toBe(true);
  });

  it("a save changes the name and phone with one audit row (field names only); a stale save is 409; an email in the body is 400", async () => {
    const f = await fixtures();
    const who = await extraContact(f.a.id);
    const s = await sessionFor(who);
    const read = async () =>
      ((await (await call("/profile", { cookie: s.cookie })).json()) as { me: { updatedAt: number } }).me;
    const before = await read();
    const save = (body: Record<string, unknown>) => call("/profile", { cookie: s.cookie, body });
    expect(
      (
        await save({
          name: "New Name",
          phone: null,
          expectedUpdatedAt: before.updatedAt,
          email: "x@example.test",
        })
      ).status,
    ).toBe(400);
    const ok = await save({
      name: " New Name ",
      phone: " +91 98765 43210 ",
      expectedUpdatedAt: before.updatedAt,
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { me: Record<string, unknown> }).me).toMatchObject({
      name: "New Name",
      phone: "+91 98765 43210",
      email: who.email,
    });
    const audit = await rows<{ actor_type: string; summary: string }>(
      "SELECT actor_type, summary FROM audit_log WHERE action = 'contact.self_update' AND entity_id = ?1",
      who.id,
    );
    expect(audit).toEqual([
      { actor_type: "contact", summary: JSON.stringify({ fields: ["name", "phone"] }) },
    ]);
    const stale = await save({ name: "Again", phone: null, expectedUpdatedAt: before.updatedAt });
    expect(stale.status).toBe(409);
    expect(((await bodyOf(stale)).error as { code: string }).code).toBe("stale_version");
    expect(await countOf("audit_log", `action = 'contact.self_update' AND entity_id = '${who.id}'`)).toBe(1);
  });

  it("an anonymised contact, or one moved away from portal access, is signed out (401) before anything is read", async () => {
    const f = await fixtures();
    for (const change of ["portal_access = 0", "anonymised_at = 1"]) {
      const who = await extraContact(f.a.id);
      const s = await sessionFor(who);
      await env.DB.prepare(`UPDATE contacts SET ${change} WHERE id = ?1`).bind(who.id).run();
      expect((await call("/profile", { cookie: s.cookie })).status, change).toBe(401);
      expect(
        (await call("/profile", { cookie: s.cookie, body: { name: "X", phone: null, expectedUpdatedAt: 1 } }))
          .status,
        change,
      ).toBe(401);
    }
  });
});

describe("requests [POR-09, POR-11, L8, L9]", () => {
  it("a request is written from the session (client, contact, contact_ref), audited, and one portal.alert is queued", async () => {
    const f = await fixtures();
    const who = await extraContact(f.a.id);
    const s = await sessionFor(who);
    const q = captureQueue();
    const res = await call(
      "/requests",
      {
        cookie: s.cookie,
        body: { kind: "data_correction", details: "My title is wrong.\r\nIt is Director." },
      },
      q.env,
    );
    expect(res.status).toBe(201);
    const id = ((await res.json()) as { request: { id: string } }).request.id;
    expect(
      await one(
        "SELECT client_id, contact_id, contact_ref, kind, details, status FROM client_requests WHERE id = ?1",
        id,
      ),
    ).toEqual({
      client_id: f.a.id,
      contact_id: who.id,
      contact_ref: who.id,
      kind: "data_correction",
      details: "My title is wrong.\nIt is Director.",
      status: "open",
    });
    const audit = await one<{ id: string; summary: string }>(
      "SELECT id, summary FROM audit_log WHERE action = 'portal.request' AND entity_id = ?1",
      id,
    );
    expect(audit?.summary).toBe(JSON.stringify({ kind: "data_correction" }));
    expect(q.sent).toEqual([{ kind: "portal.alert", auditId: audit?.id }]);
  });

  it("an open request of the same kind is 409; the details rule per kind is 400; nothing is written", async () => {
    const f = await fixtures();
    const who = await extraContact(f.a.id);
    const s = await sessionFor(who);
    expect(
      (await call("/requests", { cookie: s.cookie, body: { kind: "grievance", details: "Concern" } })).status,
    ).toBe(201);
    const again = await call("/requests", {
      cookie: s.cookie,
      body: { kind: "grievance", details: "Again" },
    });
    expect(again.status).toBe(409);
    expect(((await bodyOf(again)).error as { code: string }).code).toBe("request_open");
    for (const kind of ["contact_change", "data_correction", "grievance"])
      expect((await call("/requests", { cookie: s.cookie, body: { kind } })).status, kind).toBe(400);
    expect(
      (await call("/requests", { cookie: s.cookie, body: { kind: "data_access", clientId: f.b.id } })).status,
    ).toBe(400);
    expect(await countOf("client_requests", `contact_id = '${who.id}'`)).toBe(1);
  });

  it(`the ${REQUESTS_PER_DAY + 1}th request of an IST day is 429 too_many_requests`, async () => {
    const f = await fixtures();
    const who = await extraContact(f.a.id);
    const s = await sessionFor(who);
    const owner = uuidv7();
    await env.DB.prepare(
      "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, 'Owner', 'owner', 'active')",
    )
      .bind(owner, `${owner}@example.test`)
      .run();
    const kinds = ["contact_change", "data_access", "data_correction", "data_erasure", "grievance"];
    for (const kind of kinds)
      expect(
        (await call("/requests", { cookie: s.cookie, body: { kind, details: "Words" } })).status,
        kind,
      ).toBe(201);
    // Free one kind by closing it (an Owner closes any kind), so only the daily cap refuses the next.
    await env.DB.prepare(
      "UPDATE client_requests SET status = 'closed', outcome = 'done', closed_by = ?2, closed_at = ?3, updated_at = ?3 WHERE contact_id = ?1 AND kind = 'grievance'",
    )
      .bind(who.id, owner, Date.now())
      .run();
    const sixth = await call("/requests", {
      cookie: s.cookie,
      body: { kind: "grievance", details: "Words" },
    });
    expect(sixth.status).toBe(429);
    expect(((await bodyOf(sixth)).error as { code: string }).code).toBe("too_many_requests");
    expect(await countOf("client_requests", `contact_id = '${who.id}'`)).toBe(REQUESTS_PER_DAY);
  });
});

describe(`"I've paid" [L10, ADM-PAY-05, C15]`, () => {
  it("a notice is written for the session's contact, audited and queued; the summary offers it", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const doc = await payableDoc(f.a.id);
    const q = captureQueue();
    const summary = (await (await call(`/invoices/${doc}`, { cookie: s.cookie }, q.env)).json()) as {
      document: { paidNotice: unknown };
    };
    expect(summary.document.paidNotice).toEqual({ allowed: true, reason: null });
    const res = await call(
      `/invoices/${doc}/paid-notice`,
      { cookie: s.cookie, body: notice({ reference: " utr 55/ab ", note: "  " }) },
      q.env,
    );
    expect(res.status).toBe(201);
    const id = ((await res.json()) as { notice: { id: string } }).notice.id;
    expect(
      await one(
        "SELECT client_id, contact_id, via, currency, reference, reference_norm, note, status FROM payment_notices WHERE id = ?1",
        id,
      ),
    ).toEqual({
      client_id: f.a.id,
      contact_id: f.a.finance.id,
      via: "portal",
      currency: "INR",
      reference: "utr 55/ab",
      reference_norm: "UTR55/AB",
      note: null,
      status: "open",
    });
    const audit = await one<{ id: string }>(
      "SELECT id FROM audit_log WHERE action = 'payment.notice' AND entity_id = ?1",
      id,
    );
    expect(q.sent).toEqual([{ kind: "portal.alert", auditId: audit?.id }]);
  });

  it("refuses, in SQL: above the balance (400 with the balance), a day in the future (IST) or before the issue day (400), a duplicate reference and the 4th open notice (409)", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const doc = await payableDoc(f.a.id, { balance: 5000, issueDate: "2026-11-01" });
    const post = (b: Record<string, unknown>) =>
      call(`/invoices/${doc}/paid-notice`, { cookie: s.cookie, body: notice(b) });
    const codeOf = async (r: Response) => ({ status: r.status, ...(await bodyOf(r)) });
    expect(await codeOf(await post({ amountMinor: 5001 }))).toMatchObject({
      status: 400,
      error: { code: "amount_above_balance" },
      balanceMinor: 5000,
    });
    expect(await codeOf(await post({ paidOn: istDay(Date.now() + DAY) }))).toMatchObject({
      status: 400,
      error: { code: "date_in_future" },
    });
    expect(await codeOf(await post({ paidOn: "2026-10-31" }))).toMatchObject({
      status: 400,
      error: { code: "date_before_issue" },
    });
    expect((await post({ reference: "DUP1" })).status).toBe(201);
    expect(await codeOf(await post({ reference: "dup 1" }))).toMatchObject({
      status: 409,
      error: { code: "notice_duplicate" },
    });
    for (let i = 1; i < NOTICES_OPEN_MAX; i++) expect((await post({})).status).toBe(201);
    expect(await codeOf(await post({}))).toMatchObject({ status: 409, error: { code: "notice_open_limit" } });
    expect(await countOf("payment_notices", `document_id = '${doc}'`)).toBe(NOTICES_OPEN_MAX);
  });

  it("a paid, void or credited document, a credit note and a withdrawn proforma are 409 not_payable with the reason; a draft is the 404", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    // A withdrawn proforma: void after it reached the client (viewed), which the client still sees as withdrawn (ADM-INV-10).
    const withdrawn = await payableDoc(f.a.id, {
      type: "proforma",
      status: "void",
      voided: true,
      viewed: true,
    });
    const cases = [
      [withdrawn, "withdrawn"],
      [await payableDoc(f.a.id, { status: "paid", balance: 0 }), "paid"],
      [await payableDoc(f.a.id, { status: "credited", balance: 0 }), "not_open"],
      [f.a.portal.creditNote, "credit_note"],
    ] as const;
    for (const [doc, reason] of cases) {
      const res = await call(`/invoices/${doc}/paid-notice`, { cookie: s.cookie, body: notice({}) });
      expect(res.status, reason).toBe(409);
      expect(await bodyOf(res), reason).toMatchObject({ error: { code: "not_payable" }, reason });
    }
    const voidDoc = await payableDoc(f.a.id, { status: "void", voided: true });
    expect(
      (await call(`/invoices/${voidDoc}/paid-notice`, { cookie: s.cookie, body: notice({}) })).status,
    ).toBe(404);
    expect(
      (await call(`/invoices/${f.a.docs.draft}/paid-notice`, { cookie: s.cookie, body: notice({}) })).status,
    ).toBe(404);
  });

  it("a part-paid converted proforma takes a notice (early check 1 finding 1)", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const doc = await payableDoc(f.a.id, { type: "proforma", status: "converted", balance: 20_000 });
    expect((await call(`/invoices/${doc}/paid-notice`, { cookie: s.cookie, body: notice({}) })).status).toBe(
      201,
    );
  });
});

describe(`"I've paid" from the emailed link [POR-06, L10]`, () => {
  async function linkFor(contact: { id: string; clientId: string; email: string }, documentId: string) {
    const { token, stmt } = await docTokenStmt(env.DB, {
      documentId,
      purpose: "view_pay",
      expiresAt: Date.now() + DAY,
      contactId: contact.id,
      clientId: contact.clientId,
      email: contact.email,
      sendId: null,
    });
    await stmt.run();
    return token;
  }

  it("the link's contact and document, never the body's: via 'link', the actor the link's contact; a document id in the body is a 400", async () => {
    const f = await fixtures();
    const doc = await payableDoc(f.a.id);
    const token = await linkFor(f.a.finance, doc);
    expect(
      (
        await call("/t/document/paid-notice", {
          body: { ...notice({}), token, documentId: f.a.portal.payable },
        })
      ).status,
    ).toBe(400);
    const res = await call("/t/document/paid-notice", {
      body: { ...notice({}), token },
      headers: { "cf-ray": "ray-link-notice" },
    });
    expect(res.status).toBe(201);
    const id = ((await res.json()) as { notice: { id: string } }).notice.id;
    expect(await one("SELECT document_id, contact_id, via FROM payment_notices WHERE id = ?1", id)).toEqual({
      document_id: doc,
      contact_id: f.a.finance.id,
      via: "link",
    });
    expect(
      await rows(
        "SELECT actor_type, actor_id FROM audit_log WHERE action = 'payment.notice' AND entity_id = ?1",
        id,
      ),
    ).toEqual([{ actor_type: "contact", actor_id: f.a.finance.id }]);
    expect(await rows("SELECT status FROM access_log WHERE request_id = 'ray-link-notice'")).toEqual([
      { status: 201 },
    ]);
  });

  it("a wrong token is the 404 and counts on p:fail:; a blocked address is 429 with nothing written; a contact who lost finance is the 404", async () => {
    const f = await fixtures();
    const ip = "192.0.2.191";
    const failKey = await portalFailKey(env.PORTAL_KEY_PEPPER, ip);
    const wrong = await call("/t/document/paid-notice", {
      body: { ...notice({}), token: "w".repeat(43) },
      ip,
    });
    expect(wrong.status).toBe(404);
    expect((await attemptsRow(failKey))?.failures).toBe(1);
    await env.DB.prepare("UPDATE auth_attempts SET locked_until = ?2 WHERE key = ?1")
      .bind(failKey, Date.now() + 60_000)
      .run();
    const doc = await payableDoc(f.a.id);
    const token = await linkFor(f.a.finance, doc);
    const before = { notices: await countOf("payment_notices"), access: await countOf("access_log") };
    const blocked = await call("/t/document/paid-notice", { body: { ...notice({}), token }, ip });
    expect(blocked.status).toBe(429);
    expect(await countOf("payment_notices")).toBe(before.notices);
    expect(await countOf("access_log")).toBe(before.access);
    const who = await extraContact(f.a.id, { finance: true });
    const t2 = await linkFor(who, doc);
    await env.DB.prepare("UPDATE contacts SET can_see_finance = 0 WHERE id = ?1").bind(who.id).run();
    expect((await call("/t/document/paid-notice", { body: { ...notice({}), token: t2 } })).status).toBe(404);
  });
});

describe("the queue is optional where it is not bound (production until Phase 7)", () => {
  it("a request without EMAIL_QUEUE is still written; no throw", async () => {
    const f = await fixtures();
    const who = await extraContact(f.a.id);
    const s = await sessionFor(who);
    const res = await call(
      "/requests",
      { cookie: s.cookie, body: { kind: "data_access" } },
      withEnv(env, { EMAIL_QUEUE: undefined }),
    );
    expect(res.status).toBe(201);
  });
});
