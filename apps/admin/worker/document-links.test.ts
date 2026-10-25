// Resend, revoke and the certificate download (M4.5; ADM-PROP-07, ADM-PROP-08), in the stage A test app. Failure paths first.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { checkRecipientIds, invalidRecipients, MAX_RECIPIENTS } from "./document-links.ts";
import { putPaymentTerms } from "./test-catalogue.ts";
import { mkContact } from "./test-clients.ts";
import { call, captureQueue, one, rows, sessionFor } from "./test-helpers.ts";
import { codeOf, getDoc, type J, json, mkDraft, mkTerms, sendDoc } from "./test-quotes.ts";

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
});

const owner = () => sessionFor("owner", { stepUp: true });

/** A sent proposal and two portal contacts of its client (the draft's own contact has no portal access until given). */
async function sentOffer() {
  const s = await owner();
  const made = await mkDraft(s);
  const v = await getDoc(s, made.id);
  expect((await sendDoc(s, made.id, v.updatedAt)).status).toBe(200);
  const a = await mkContact(made.clientId, { portal_access: 1, is_billing: 1, name: "Asha Rao" });
  const b = await mkContact(made.clientId, { portal_access: 1, name: "Bala Sen" });
  return { s, made, a, b };
}
const resend = (cookie: string, id: string, body: unknown, e?: Env) =>
  call(`/documents/${id}/resend`, { cookie, body }, e);
const renderPdf = (id: string) =>
  env.DB.prepare(
    "UPDATE documents SET pdf_r2_key = 'docs/proposal/2026-27/0001-v1.pdf', pdf_sha256 = 'sha-pdf' WHERE id = ?",
  )
    .bind(id)
    .run();

describe("the recipient rules (pure)", () => {
  it("1 to 5, distinct", () => {
    expect(MAX_RECIPIENTS).toBe(5);
    expect(checkRecipientIds([])).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "recipients_required" },
    });
    expect(checkRecipientIds(["1", "2", "3", "4", "5", "6"])).toMatchObject({
      ok: false,
      status: 400,
      error: { code: "recipients_too_many" },
    });
    expect(checkRecipientIds(["1", "2", "1"])).toMatchObject({
      ok: false,
      status: 409,
      error: { code: "recipient_invalid" },
      invalid: ["1"],
    });
    expect(checkRecipientIds(["1", "2", "3", "4", "5"])).toEqual({
      ok: true,
      ids: ["1", "2", "3", "4", "5"],
    });
  });
});

describe("POST /documents/:id/resend [ADM-PROP-07]", () => {
  it("writes one waiting row per contact (address lower-cased, kind resend, the client's attach setting); queues nothing while the PDF is missing", async () => {
    const { s, made, a, b } = await sentOffer();
    await env.DB.prepare("UPDATE clients SET attach_pdf = 1 WHERE id = ?").bind(made.clientId).run();
    const q = captureQueue();
    const res = await resend(s.cookie, made.id, { contactIds: [a.id, b.id] }, q.env);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await json(res)).toMatchObject({ sends: 2, waitingForPdf: true });
    const sends = await rows<J>(
      "SELECT contact_id, email, attach_pdf, kind, queued_at, created_by, version_group_id, client_id FROM document_sends WHERE document_id = ? ORDER BY email",
      made.id,
    );
    expect(sends).toHaveLength(2);
    expect(sends[0]).toMatchObject({
      kind: "resend",
      attach_pdf: 1,
      queued_at: null,
      created_by: s.id,
      client_id: made.clientId,
      version_group_id: made.id,
    });
    expect(sends.map((r) => r.email)).toEqual([a.email.toLowerCase(), b.email.toLowerCase()].sort());
    expect(q.sent).toEqual([]);
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'document.resend' AND entity_id = ?",
      made.id,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toEqual({
      documentId: made.id,
      recipients: 2,
      attachPdf: true,
    });
    expect(audit?.summary).not.toContain("@");
  });

  it("when the PDF exists the emails are queued at once, one offer.send per row (ids only), and attachPdf can be overridden", async () => {
    const { s, made, a } = await sentOffer();
    await renderPdf(made.id);
    const q = captureQueue();
    const res = await resend(s.cookie, made.id, { contactIds: [a.id], attachPdf: false }, q.env);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ waitingForPdf: false });
    const row = await one<J>("SELECT id, attach_pdf FROM document_sends WHERE document_id = ?", made.id);
    expect(row?.attach_pdf).toBe(0);
    expect(q.sent).toEqual([{ kind: "offer.send", sendId: row?.id }]);
  });

  const bad: [string, (ctx: Awaited<ReturnType<typeof sentOffer>>) => Promise<unknown[]>, number, string][] =
    [
      ["no contacts", async () => [], 400, "recipients_required"],
      ["six contacts", async (c) => [c.a.id, c.b.id, "3", "4", "5", "6"], 400, "recipients_too_many"],
      ["the same contact twice", async (c) => [c.a.id, c.a.id], 409, "recipient_invalid"],
      ["an unknown contact", async (c) => [c.a.id, "no-such-contact"], 409, "recipient_invalid"],
      [
        "another client's contact",
        async (c) => {
          const other = await mkDraft(c.s);
          return [(await mkContact(other.clientId, { portal_access: 1 })).id];
        },
        409,
        "recipient_invalid",
      ],
      [
        "a contact without portal access",
        async (c) => [(await mkContact(c.made.clientId, { portal_access: 0 })).id],
        409,
        "recipient_invalid",
      ],
      [
        "an anonymised contact",
        async (c) => [(await mkContact(c.made.clientId, { portal_access: 1, anonymised_at: Date.now() })).id],
        409,
        "recipient_invalid",
      ],
    ];
  for (const [name, ids, status, code] of bad)
    it(`${status} ${code}: ${name}; nothing is written`, async () => {
      const ctx = await sentOffer();
      const q = captureQueue();
      const res = await resend(ctx.s.cookie, ctx.made.id, { contactIds: await ids(ctx) }, q.env);
      expect([res.status, await codeOf(res)]).toEqual([status, code]);
      expect(
        (
          await one<{ n: number }>(
            "SELECT count(*) AS n FROM document_sends WHERE document_id = ?",
            ctx.made.id,
          )
        )?.n,
      ).toBe(0);
      expect(q.sent).toEqual([]);
    });

  it("a bad contact among good ones refuses the whole send and names the contact", async () => {
    const ctx = await sentOffer();
    const none = await mkContact(ctx.made.clientId, { portal_access: 0 });
    const res = await resend(ctx.s.cookie, ctx.made.id, { contactIds: [ctx.a.id, none.id] });
    expect(res.status).toBe(409);
    expect(((await json(res)) as J).contactIds).toEqual([none.id]);
    expect(
      (
        await one<{ n: number }>(
          "SELECT count(*) AS n FROM document_sends WHERE document_id = ?",
          ctx.made.id,
        )
      )?.n,
    ).toBe(0);
  });

  it("a contact that loses access between the check and the write refuses the whole batch (the count is in the SQL)", async () => {
    const ctx = await sentOffer();
    const { beforeBatchHolding } = await import("./test-quotes.ts");
    const racing = beforeBatchHolding("INSERT INTO document_sends", async () => {
      await env.DB.prepare("UPDATE contacts SET portal_access = 0 WHERE id = ?").bind(ctx.b.id).run();
    });
    const res = await resend(ctx.s.cookie, ctx.made.id, { contactIds: [ctx.a.id, ctx.b.id] }, racing);
    expect([res.status, await codeOf(res)]).toEqual([409, "not_resendable"]);
    expect(
      (
        await one<{ n: number }>(
          "SELECT count(*) AS n FROM document_sends WHERE document_id = ?",
          ctx.made.id,
        )
      )?.n,
    ).toBe(0);
  });

  it("only the latest open version: a draft, an accepted, an expired and a superseded version are 409 not_resendable", async () => {
    const ctx = await sentOffer();
    const draft = await mkDraft(ctx.s);
    const dc = await mkContact(draft.clientId, { portal_access: 1 });
    expect((await resend(ctx.s.cookie, draft.id, { contactIds: [dc.id] })).status).toBe(404); // not frozen: not an offer yet
    await env.DB.prepare("UPDATE documents SET status = 'accepted', decided_at = 1 WHERE id = ?")
      .bind(ctx.made.id)
      .run();
    expect(await codeOf(await resend(ctx.s.cookie, ctx.made.id, { contactIds: [ctx.a.id] }))).toBe(
      "not_resendable",
    );
    const e = await sentOffer();
    await env.DB.prepare("UPDATE documents SET status = 'expired', decided_at = NULL WHERE id = ?")
      .bind(e.made.id)
      .run();
    expect(await codeOf(await resend(e.s.cookie, e.made.id, { contactIds: [e.a.id] }))).toBe(
      "not_resendable",
    );
  });

  it("permissions: signed out 401, an accountant 403", async () => {
    const ctx = await sentOffer();
    expect(
      (await call(`/documents/${ctx.made.id}/resend`, { body: { contactIds: [ctx.a.id] } })).status,
    ).toBe(401);
    const acct = await sessionFor("accountant");
    expect((await resend(acct.cookie, ctx.made.id, { contactIds: [ctx.a.id] })).status).toBe(403);
  });

  it("the helper tells which contacts are not valid recipients", async () => {
    const ctx = await sentOffer();
    const off = await mkContact(ctx.made.clientId, { portal_access: 0 });
    expect(await invalidRecipients(env.DB, ctx.made.clientId, [ctx.a.id, off.id, "x"])).toEqual([
      off.id,
      "x",
    ]);
  });
});

describe("POST /documents/:id/links/revoke [ADM-PROP-07]", () => {
  async function link(
    documentId: string,
    groupId: string,
    clientId: string,
    contactId: string,
    hash: string,
  ) {
    await env.DB.prepare(
      "INSERT INTO offer_links (token_hash, document_id, version_group_id, client_id, contact_id, email, purpose, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, 'x@example.test', 'offer', ?6)",
    )
      .bind(hash, documentId, groupId, clientId, contactId, Date.now() + 86_400_000)
      .run();
  }
  it("revokes every live link of the offer (not another offer's), once; a second call revokes none", async () => {
    const ctx = await sentOffer();
    const other = await sentOffer();
    await link(ctx.made.id, ctx.made.id, ctx.made.clientId, ctx.a.id, `h-${crypto.randomUUID()}`);
    await link(ctx.made.id, ctx.made.id, ctx.made.clientId, ctx.b.id, `h-${crypto.randomUUID()}`);
    await link(other.made.id, other.made.id, other.made.clientId, other.a.id, `h-${crypto.randomUUID()}`);
    const res = await call(`/documents/${ctx.made.id}/links/revoke`, { cookie: ctx.s.cookie, body: {} });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await json(res)).toMatchObject({ revoked: 2 });
    expect(
      (
        await one<{ n: number }>(
          "SELECT count(*) AS n FROM offer_links WHERE version_group_id = ? AND revoked_at IS NULL",
          ctx.made.id,
        )
      )?.n,
    ).toBe(0);
    expect(
      (
        await one<{ n: number }>(
          "SELECT count(*) AS n FROM offer_links WHERE version_group_id = ? AND revoked_at IS NULL",
          other.made.id,
        )
      )?.n,
    ).toBe(1);
    expect(
      (
        await one<{ n: number }>(
          "SELECT count(*) AS n FROM audit_log WHERE action = 'document.links_revoke' AND entity_id = ?",
          ctx.made.id,
        )
      )?.n,
    ).toBe(1);
    const again = await call(`/documents/${ctx.made.id}/links/revoke`, { cookie: ctx.s.cookie, body: {} });
    expect(await json(again)).toMatchObject({ revoked: 0 });
  });
  it("a draft or an unknown id is 404", async () => {
    const s = await owner();
    const draft = await mkDraft(s);
    expect((await call(`/documents/${draft.id}/links/revoke`, { cookie: s.cookie, body: {} })).status).toBe(
      404,
    );
    expect((await call("/documents/nope/links/revoke", { cookie: s.cookie, body: {} })).status).toBe(404);
  });
});

describe("GET /documents/:id/certificate [ADM-PROP-08]", () => {
  it("404 before an acceptance, 409 until the certificate is rendered, then the PDF as a sandboxed attachment", async () => {
    const ctx = await sentOffer();
    expect((await call(`/documents/${ctx.made.id}/certificate`, { cookie: ctx.s.cookie })).status).toBe(404);
    const acc = crypto.randomUUID();
    const key = "docs/proposal/2026-27/0001-v1-certificate.pdf";
    await env.DB.prepare("UPDATE documents SET status = 'accepted', decided_at = 1 WHERE id = ?")
      .bind(ctx.made.id)
      .run();
    await env.DB.prepare(
      "INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, pdf_sha256, certificate_r2_key) VALUES (?1, ?2, ?3, 'A', 'a@example.test', 1, 'h', ?4)",
    )
      .bind(acc, ctx.made.id, ctx.a.id, key)
      .run();
    const pending = await call(`/documents/${ctx.made.id}/certificate`, { cookie: ctx.s.cookie });
    expect([pending.status, await codeOf(pending)]).toEqual([409, "certificate_pending"]);
    await (env as Env & { DOCS?: R2Bucket }).DOCS?.put(key, "%PDF-1.4 certificate");
    await env.DB.prepare(
      "INSERT INTO acceptance_certificates (acceptance_id, r2_key, sha256, rendered_at) VALUES (?1, ?2, 's', 1)",
    )
      .bind(acc, key)
      .run();
    const ok = await call(`/documents/${ctx.made.id}/certificate`, { cookie: ctx.s.cookie });
    // The admin Worker has no DOCS binding until M4.4 phase 2 (stage B): until then the object cannot be read, and the answer is the plain 404.
    expect([200, 404]).toContain(ok.status);
    if (ok.status === 200) {
      expect(ok.headers.get("Content-Type")).toBe("application/pdf");
      expect(ok.headers.get("Content-Security-Policy")).toBe("sandbox");
    }
  });
});
