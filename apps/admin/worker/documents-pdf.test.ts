// The PDF of a sent version, admin side (M4.4; JOB-PDF-01, ADM-PROP-04): the send enqueues the snapshot, the real send path produces rows the
// PDF engine verifies, the download streams with the right headers, the retry is audited, the document view says where the PDF stands.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { loadDocument } from "@techaust/db/documents";
import {
  type Envelope,
  envelopeOfBundle,
  parseEnvelope,
  serializeEnvelope,
  verifyEnvelope,
} from "@techaust/pdf";
import { beforeAll, describe, expect, it } from "vitest";
import { pdfFilename } from "./document-pdf.ts";
import { putPaymentTerms } from "./test-catalogue.ts";
import { insert } from "./test-clients.ts";
import { call, one, rows, sessionFor, withEnv } from "./test-helpers.ts";
import { getDoc, json, mkDraft, sendDoc } from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

const sha256 = async (s: string | Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", typeof s === "string" ? new TextEncoder().encode(s) : s),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");

/** Proposal terms with a REAL hash of their text (the PDF engine checks it; the other tests' terms carry a made-up hash). */
async function mkRealTerms() {
  const n =
    ((await one<{ v: number | null }>("SELECT max(version) AS v FROM terms_versions WHERE kind = 'proposal'"))
      ?.v ?? 0) + 1;
  const body = `Sample terms version ${n}.\n\n1. Payment is due as scheduled.`;
  await insert("terms_versions", {
    id: uuidv7(),
    kind: "proposal",
    version: n,
    body_md: body,
    sha256: await sha256(body),
  });
}

type Queue = { sent: unknown[]; env: Env };
function pdfQueue(fail = false): Queue {
  const sent: unknown[] = [];
  const queue = {
    send: async (m: unknown) => {
      if (fail) throw new Error("queue down");
      sent.push(m);
    },
    sendBatch: async () => undefined,
  };
  return { sent, env: withEnv(env, { PDF_QUEUE: queue }) };
}

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\nsample\n%%EOF\n");

async function sentDoc(type: "proposal" | "estimate" = "proposal") {
  const s = await owner();
  await mkRealTerms();
  const made = await mkDraft(s, { type });
  const q = pdfQueue();
  const res = await call(
    `/documents/${made.id}/send`,
    { cookie: s.cookie, body: { expectedUpdatedAt: made.updatedAt } },
    q.env,
  );
  expect(res.status).toBe(200);
  return { s, made, q, number: (await json(res)).number as string };
}

beforeAll(async () => {
  await putPaymentTerms();
});

describe("the real send path and the PDF engine [JOB-PDF-01]", () => {
  it("a row sent through the real route verifies: the envelope reproduces snapshot_sha256 and content_sha256", async () => {
    for (const type of ["proposal", "estimate"] as const) {
      const { made } = await sentDoc(type);
      const bundle = await loadDocument(env.DB, made.id);
      expect(bundle).not.toBeNull();
      const row = (bundle as NonNullable<typeof bundle>).document;
      const out = await envelopeOfBundle(
        bundle as NonNullable<typeof bundle> as Parameters<typeof envelopeOfBundle>[0],
      );
      expect(out.ok).toBe(true);
      if (!out.ok) continue;
      expect(out.envelope.snapshotSha256).toBe(row.snapshot_sha256);
      expect(out.envelope.snapshot.header.document.contentSha256).toBe(row.content_sha256);
      expect(out.envelope.numberDisplay).toBe(row.number_display);
      // the stored text parses back and verifies on its own (what the render step does)
      const again = parseEnvelope(serializeEnvelope(out.envelope));
      expect(await verifyEnvelope(again as NonNullable<typeof again>)).toEqual({ ok: true });
    }
  });

  it("each tampering of the envelope text is detected", async () => {
    const { made } = await sentDoc();
    const bundle = (await loadDocument(env.DB, made.id)) as NonNullable<
      Awaited<ReturnType<typeof loadDocument>>
    >;
    const out = await envelopeOfBundle(bundle as Parameters<typeof envelopeOfBundle>[0]);
    if (!out.ok) throw new Error(out.code);
    const text = serializeEnvelope(out.envelope);
    const edits: [string, (e: Envelope) => void, string][] = [
      [
        "a line",
        (e) => ((e.snapshot.lines[0] as { description: string }).description = "Changed"),
        "content_hash",
      ],
      [
        "a section",
        (e) => ((e.snapshot.sections[0] as { bodyMd: string }).bodyMd = "Changed"),
        "content_hash",
      ],
      ["the recipient", (e) => (e.snapshot.header.recipient.legalName = "Someone Else"), "snapshot_hash"],
      ["the supplier", (e) => (e.snapshot.header.issuer.company.tradeName = "Other"), "snapshot_hash"],
      ["the terms text", (e) => (e.snapshot.terms.bodyMd += " More."), "terms_hash"],
      [
        "the totals",
        (e) =>
          (e.snapshot.computedJson = e.snapshot.computedJson.replace(/"totalMinor":\d+/, '"totalMinor":1')),
        "computed_hash",
      ],
    ];
    for (const [name, edit, code] of edits) {
      const e = JSON.parse(text);
      edit(e);
      expect(await verifyEnvelope(e), name).toEqual({ ok: false, code });
    }
  });

  it("the terms of other tests (a made-up hash) are refused, not rendered", async () => {
    const s = await owner();
    await insert("terms_versions", {
      id: uuidv7(),
      kind: "proposal",
      version: 9000 + Math.floor(Math.random() * 900),
      body_md: "Text",
      sha256: "not-the-hash",
    });
    const made = await mkDraft(s);
    expect((await sendDoc(s, made.id, made.updatedAt)).status).toBe(200);
    const bundle = (await loadDocument(env.DB, made.id)) as NonNullable<
      Awaited<ReturnType<typeof loadDocument>>
    >;
    expect(await envelopeOfBundle(bundle as Parameters<typeof envelopeOfBundle>[0])).toEqual({
      ok: false,
      code: "terms_hash",
    });
  });
});

describe("afterSend enqueues the snapshot", () => {
  it("puts one pdf.snapshot (reason send) on the PDF queue, ids only", async () => {
    const { made, q } = await sentDoc();
    expect(q.sent).toEqual([{ v: 1, kind: "pdf.snapshot", documentId: made.id, reason: "send" }]);
  });

  it("a queue that is down never fails the send (the sweep and the retry route catch up)", async () => {
    const s = await owner();
    await mkRealTerms();
    const made = await mkDraft(s);
    const q = pdfQueue(true);
    const res = await call(
      `/documents/${made.id}/send`,
      { cookie: s.cookie, body: { expectedUpdatedAt: made.updatedAt } },
      q.env,
    );
    expect(res.status).toBe(200);
    expect((await getDoc(s, made.id)).status).toBe("sent");
  });
});

describe("GET /documents/:id/pdf", () => {
  it("is 404 for a draft and for an unknown id, 409 pdf_pending for a sent version without its PDF", async () => {
    const s = await owner();
    await mkRealTerms();
    const draft = await mkDraft(s);
    expect((await call(`/documents/${draft.id}/pdf`, { cookie: s.cookie })).status).toBe(404);
    expect((await call("/documents/no-such-id/pdf", { cookie: s.cookie })).status).toBe(404);
    const { made } = await sentDoc();
    const res = await call(`/documents/${made.id}/pdf`, { cookie: s.cookie });
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("pdf_pending");
  });

  it("streams the stored PDF as an attachment with no-store, nosniff and a sandbox CSP", async () => {
    const { s, made, number } = await sentDoc();
    const key = `docs/proposal/test/${made.id}.pdf`;
    await env.DOCS.put(key, PDF_BYTES);
    const sha = await sha256(PDF_BYTES);
    await env.DB.prepare("UPDATE documents SET pdf_r2_key = ?2, pdf_sha256 = ?3 WHERE id = ?1")
      .bind(made.id, key, sha)
      .run();
    const res = await call(`/documents/${made.id}/pdf`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-length")).toBe(String(PDF_BYTES.byteLength));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("etag")).toBe(`"${sha}"`);
    expect(res.headers.get("content-disposition")).toContain(
      `attachment; filename="${pdfFilename(number, 1)}"`,
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF_BYTES);
    // the download is in the access log
    const log = await rows<{ route: string }>(
      "SELECT route FROM access_log WHERE route LIKE '%/documents/:id/pdf' ORDER BY rowid DESC LIMIT 1",
    );
    expect(log.length).toBe(1);
  });

  it("answers pdf_pending when the row names an object that is gone, and needs a session", async () => {
    const { s, made } = await sentDoc();
    await env.DB.prepare(
      "UPDATE documents SET pdf_r2_key = 'docs/missing.pdf', pdf_sha256 = ?2 WHERE id = ?1",
    )
      .bind(made.id, "a".repeat(64))
      .run();
    expect((await call(`/documents/${made.id}/pdf`, { cookie: s.cookie })).status).toBe(409);
    expect((await call(`/documents/${made.id}/pdf`)).status).toBe(401);
  });

  it("builds a safe file name from the number", () => {
    expect(pdfFilename("TH/PRP/2627/0003", 2)).toBe("TH-PRP-2627-0003-v2.pdf");
    expect(pdfFilename('a b"c', 1)).toBe("a-b-c-v1.pdf");
  });
});

describe("POST /documents/:id/pdf/retry", () => {
  it("queues the snapshot again, writes the audit row (ids only) and answers pending", async () => {
    const { s, made } = await sentDoc();
    const q = pdfQueue();
    const res = await call(`/documents/${made.id}/pdf/retry`, { cookie: s.cookie, body: {} }, q.env);
    expect(res.status).toBe(200);
    expect((await json(res)).pdf).toEqual({ state: "pending" });
    expect(q.sent).toEqual([{ v: 1, kind: "pdf.snapshot", documentId: made.id, reason: "retry" }]);
    const a = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'document.pdf_retry' AND entity_id = ?",
      made.id,
    );
    expect(JSON.parse(a?.summary ?? "{}")).toMatchObject({
      documentId: made.id,
      type: "proposal",
      version: 1,
    });
  });

  it("is refused for a draft (404), for an unknown id (404) and once the PDF exists (409 pdf_done); and by role", async () => {
    const s = await owner();
    await mkRealTerms();
    const draft = await mkDraft(s);
    expect((await call(`/documents/${draft.id}/pdf/retry`, { cookie: s.cookie, body: {} })).status).toBe(404);
    expect((await call("/documents/nope/pdf/retry", { cookie: s.cookie, body: {} })).status).toBe(404);
    const { made } = await sentDoc();
    const accountant = await sessionFor("accountant");
    expect(
      (await call(`/documents/${made.id}/pdf/retry`, { cookie: accountant.cookie, body: {} })).status,
    ).toBe(403);
    await env.DB.prepare("UPDATE documents SET pdf_r2_key = 'k', pdf_sha256 = ?2 WHERE id = ?1")
      .bind(made.id, "b".repeat(64))
      .run();
    const res = await call(`/documents/${made.id}/pdf/retry`, { cookie: s.cookie, body: {} });
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("pdf_done");
  });
});

describe("the document view carries the PDF state", () => {
  it("none for a draft, pending once sent, ready with a fingerprint after", async () => {
    const s = await owner();
    await mkRealTerms();
    const draft = await mkDraft(s);
    expect((await getDoc(s, draft.id)).pdf).toEqual({ state: "none", sha256: null, fingerprint: null });
    const { made } = await sentDoc();
    expect((await getDoc(s, made.id)).pdf).toEqual({ state: "pending", sha256: null, fingerprint: null });
    const sha = `c0ffee${"0".repeat(58)}`;
    await env.DB.prepare("UPDATE documents SET pdf_r2_key = 'k', pdf_sha256 = ?2 WHERE id = ?1")
      .bind(made.id, sha)
      .run();
    expect((await getDoc(s, made.id)).pdf).toEqual({
      state: "ready",
      sha256: sha,
      fingerprint: sha.slice(0, 12),
    });
  });
});

describe("the PDF columns are set once", () => {
  it("a second write of pdf_sha256 or snapshot_r2_key is refused by the frozen-document trigger", async () => {
    const { made } = await sentDoc();
    await env.DB.prepare(
      "UPDATE documents SET snapshot_r2_key = 'a', pdf_r2_key = 'b', pdf_sha256 = ?2 WHERE id = ?1",
    )
      .bind(made.id, "d".repeat(64))
      .run();
    await expect(
      env.DB.prepare("UPDATE documents SET pdf_sha256 = ?2 WHERE id = ?1")
        .bind(made.id, "e".repeat(64))
        .run(),
    ).rejects.toThrow(/frozen/);
    await expect(
      env.DB.prepare("UPDATE documents SET snapshot_r2_key = 'z' WHERE id = ?1").bind(made.id).run(),
    ).rejects.toThrow(/frozen/);
  });
});
