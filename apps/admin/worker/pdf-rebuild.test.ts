// Rebuild PDF, the admin half (JOB-PDF-02, ADM-AUD-01, ADM-INV-07, ADM-PROP-05, ADM-PAY-09; run file docs/runs/rebuild-pdf.md; owner Q1 = B, 2026-11-07): the
// Owner's POST checks the stored file and writes one guarded request and one audit row; the frozen row never changes; once the jobs Worker has written its
// result and object, every download serves the rebuilt file. The shared fixture is packages/testing/src/pdf-rebuild.ts (the jobs half uses it too).
// Invented data only.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { REBUILD_HASH_MAX_BYTES, repairKey } from "@techaust/core/pdf-repair";
import { RESULT_INSERT_SQL } from "@techaust/db/pdf-repairs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DAMAGED_PDF,
  ORIGINAL_PDF,
  putWithSha,
  REBUILT_PDF,
  sha256Hex,
  wholeRow,
} from "../../../packages/testing/src/pdf-rebuild.ts";
import { checkStored } from "./pdf-rebuild.ts";
import { issueReceipt } from "./receipt-issue.ts";
import { insert, mkContact } from "./test-clients.ts";
import { finalisedDeed } from "./test-deeds.ts";
import { call, countOf, one, sessionFor, type TestSession, withEnv } from "./test-helpers.ts";
import {
  codeOf,
  issueInvoice,
  json,
  mkInvoice,
  mkInvoiceClient,
  putBank,
  putCompany,
} from "./test-invoices.ts";
import { recordBody, recorded } from "./test-payments.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeAll(async () => {
  await putCompany();
  await putBank();
});
afterEach(() => vi.useRealTimers());

type Q = { sent: unknown[]; env: Env };
function pdfQueue(fail = false): Q {
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

let seq = 0;
const nextKey = (type: string) => `docs/${type}/2026-27/${String(9000 + ++seq)}-v1.pdf`;

/** An issued tax invoice through the real routes, with its PDF stored the way the jobs Worker stores it (checksum recorded). */
async function storedInvoice(o: TestSession) {
  const made = await mkInvoice(o);
  expect((await issueInvoice(o, made.id)).status).toBe(200);
  const key = nextKey("tax_invoice");
  const sha = await putWithSha(env.DOCS, key, ORIGINAL_PDF);
  await env.DB.prepare("UPDATE documents SET pdf_r2_key = ?2, pdf_sha256 = ?3 WHERE id = ?1")
    .bind(made.id, key, sha)
    .run();
  return { id: made.id as string, clientId: made.clientId as string, key, sha };
}

/** A sent proposal with its PDF; valid until `validUntil` (default: long past, so the client can no longer accept it). */
async function storedOffer(opts: { validUntil?: string; status?: string } = {}) {
  const c = await mkInvoiceClient();
  const id = uuidv7();
  const key = nextKey("proposal");
  const sha = await putWithSha(env.DOCS, key, ORIGINAL_PDF);
  await insert("documents", {
    id,
    type: "proposal",
    client_id: c.clientId,
    currency: "INR",
    version_group_id: id,
    version: 1,
    status: opts.status ?? "sent",
    series: "proposal",
    fy: "2627",
    number: 9000 + seq,
    number_display: `TP/${9000 + seq}`,
    frozen_at: Date.now() - 1_000,
    sent_at: Date.now() - 1_000,
    valid_until: opts.validUntil ?? "2020-01-01",
    pdf_r2_key: key,
    pdf_sha256: sha,
  });
  return { id, clientId: c.clientId, key, sha };
}

const post = (s: TestSession, path: string, e?: Env) => call(path, { cookie: s.cookie, body: {} }, e);
const repairsOf = (subject: string) =>
  env.DB.prepare("SELECT * FROM pdf_repairs WHERE subject_id = ?1 ORDER BY n").bind(subject).all<{
    id: string;
    n: number;
    old_key: string;
    new_key: string;
    found: string;
    original_key: string;
  }>();
/** What the jobs Worker does at the end of a rebuild: the object at the new key, then the `rebuilt` result. */
async function completeRebuild(repairId: string, newKey: string) {
  const sha = await putWithSha(env.DOCS, newKey, REBUILT_PDF);
  const r = await env.DB.prepare(RESULT_INSERT_SQL)
    .bind(repairId, "rebuilt", null, sha, REBUILT_PDF.byteLength, Date.now())
    .run();
  expect(r.meta.changes).toBeGreaterThan(0);
  return sha;
}

describe("the done-test, admin half [JOB-PDF-02]", () => {
  for (const kind of ["invoice", "offer"] as const) {
    it(`${kind}: POST 202, one request and one audit row, the frozen row unchanged; after the result, the download serves the new file with its ETag`, async () => {
      const o = await owner();
      const s = kind === "invoice" ? await storedInvoice(o) : await storedOffer();
      const base = kind === "invoice" ? `/invoices/${s.id}/pdf` : `/documents/${s.id}/pdf`;
      const before = await wholeRow(env.DB, "documents", "id", s.id);
      await env.DOCS.delete(s.key);
      const q = pdfQueue();
      const res = await post(o, `${base}/rebuild`, q.env);
      expect(res.status, await res.clone().text()).toBe(202);
      const answer = await json(res);
      expect(answer.repair).toMatchObject({ n: 1, found: "missing", state: "rebuilding" });
      const reqs = (await repairsOf(s.id)).results;
      expect(reqs).toHaveLength(1);
      expect(reqs[0]).toMatchObject({
        id: answer.repair.id,
        n: 1,
        original_key: s.key,
        old_key: s.key,
        new_key: repairKey(s.key, 1),
      });
      expect(q.sent).toEqual([{ v: 1, kind: "pdf.rebuild", repairId: answer.repair.id, hop: 0 }]);
      expect(await countOf("audit_log", "action = 'pdf.rebuild' AND entity_id = ?1", s.id)).toBe(1);
      const audit = await one<{ summary: string; entity_type: string }>(
        "SELECT summary, entity_type FROM audit_log WHERE action = 'pdf.rebuild' AND entity_id = ?1",
        s.id,
      );
      expect(audit?.entity_type).toBe("document");
      expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({
        repairId: answer.repair.id,
        kind,
        n: 1,
        found: "missing",
      });

      // In progress: the GET says so; nothing is served yet (the original is gone).
      const mid = await json(await call(`${base}/rebuilds`, { cookie: o.cookie }));
      expect(mid).toMatchObject({ rebuilding: true, rebuiltAt: null, served: null });
      expect((await call(base, { cookie: o.cookie })).status).toBe(409);

      const newSha = await completeRebuild(answer.repair.id, repairKey(s.key, 1));
      const dl = await call(base, { cookie: o.cookie });
      expect(dl.status).toBe(200);
      expect(dl.headers.get("ETag")).toBe(`"${newSha}"`);
      expect(new Uint8Array(await dl.arrayBuffer())).toEqual(REBUILT_PDF);
      const done = await json(await call(`${base}/rebuilds`, { cookie: o.cookie }));
      expect(done).toMatchObject({ rebuilding: false, served: { sha256: newSha } });
      expect(typeof done.rebuiltAt).toBe("number");
      expect(done.history).toEqual([
        expect.objectContaining({ n: 1, found: "missing", outcome: "rebuilt", code: null }),
      ]);
      expect(await wholeRow(env.DB, "documents", "id", s.id)).toBe(before);
    });
  }
});

describe("the check and the refusals", () => {
  it("an intact file is 409 nothing_to_rebuild and writes nothing, through R2's checksum and through a hash", async () => {
    const o = await owner();
    const s = await storedInvoice(o);
    const audits = await countOf("audit_log");
    const res = await post(o, `/invoices/${s.id}/pdf/rebuild`);
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({
      error: {
        code: "nothing_to_rebuild",
        message: "The stored PDF is complete and matches its fingerprint, so there's nothing to rebuild.",
      },
    });
    // Stored without a checksum: the bytes are hashed.
    await env.DOCS.put(s.key, ORIGINAL_PDF);
    expect(await codeOf(await post(o, `/invoices/${s.id}/pdf/rebuild`))).toBe("nothing_to_rebuild");
    expect((await repairsOf(s.id)).results).toHaveLength(0);
    expect(await countOf("audit_log")).toBe(audits);
  });

  it("damaged bytes under the key (a put without onlyIf) are 202 found: damaged", async () => {
    const o = await owner();
    const s = await storedInvoice(o);
    await env.DOCS.put(s.key, DAMAGED_PDF);
    const res = await post(o, `/invoices/${s.id}/pdf/rebuild`, pdfQueue().env);
    expect(res.status).toBe(202);
    expect((await json(res)).repair.found).toBe("damaged");
    expect((await repairsOf(s.id)).results[0]).toMatchObject({ found: "damaged" });
    // R2's checksum of the damaged bytes is compared too (put with its own sha256).
    const t = await storedInvoice(o);
    await putWithSha(env.DOCS, t.key, DAMAGED_PDF);
    expect((await json(await post(o, `/invoices/${t.id}/pdf/rebuild`, pdfQueue().env))).repair.found).toBe(
      "damaged",
    );
  });

  it("an anonymised client is 409 client_gone; a redacted offer is 409 pdf_erased; a draft or another type is 404; no PDF yet is pdf_pending", async () => {
    const o = await owner();
    const s = await storedInvoice(o);
    await env.DOCS.delete(s.key);
    await env.DB.prepare("UPDATE clients SET anonymised_at = 9 WHERE id = ?").bind(s.clientId).run();
    const gone = await post(o, `/invoices/${s.id}/pdf/rebuild`);
    expect(gone.status).toBe(409);
    expect(await json(gone)).toMatchObject({
      error: {
        code: "client_gone",
        message: "This client's details were erased, so no PDF can be made for them.",
      },
    });
    const off = await storedOffer();
    await env.DB.prepare(
      "UPDATE documents SET recipient = json_object('legalName', 'Anonymised client', 'country', 'IN'), title = 'Anonymised client', redacted_at = ?2, updated_at = updated_at + 1 WHERE id = ?1",
    )
      .bind(off.id, Date.now())
      .run();
    expect(await codeOf(await post(o, `/documents/${off.id}/pdf/rebuild`))).toBe("pdf_erased");
    expect((await post(o, `/documents/${s.id}/pdf/rebuild`)).status).toBe(404);
    expect((await post(o, `/invoices/${off.id}/pdf/rebuild`)).status).toBe(404);
    expect((await post(o, "/invoices/nope/pdf/rebuild")).status).toBe(404);
    const draft = await mkInvoice(o);
    expect((await post(o, `/invoices/${draft.id}/pdf/rebuild`)).status).toBe(404);
    const issued = await mkInvoice(o);
    expect((await issueInvoice(o, issued.id)).status).toBe(200);
    expect(await codeOf(await post(o, `/invoices/${issued.id}/pdf/rebuild`))).toBe("pdf_pending");
  });

  it("Q1 = B: an offer the client can still accept is 409 offer_open with nothing written; expired or accepted, it is rebuilt", async () => {
    const o = await owner();
    const open = await storedOffer({ validUntil: "2099-12-31" });
    await env.DOCS.delete(open.key);
    const audits = await countOf("audit_log", "action = 'pdf.rebuild'");
    const refused = await post(o, `/documents/${open.id}/pdf/rebuild`, pdfQueue().env);
    expect(refused.status).toBe(409);
    expect(await json(refused)).toMatchObject({
      error: { code: "offer_open", message: "This offer can still be accepted. Send a new version instead." },
    });
    expect((await repairsOf(open.id)).results).toHaveLength(0);
    expect(await countOf("audit_log", "action = 'pdf.rebuild'")).toBe(audits);

    const expired = await storedOffer({ validUntil: "2020-01-01" });
    await env.DOCS.delete(expired.key);
    expect((await post(o, `/documents/${expired.id}/pdf/rebuild`, pdfQueue().env)).status).toBe(202);

    const accepted = await storedOffer({ validUntil: "2099-12-31", status: "accepted" });
    await env.DOCS.delete(accepted.key);
    expect((await post(o, `/documents/${accepted.id}/pdf/rebuild`, pdfQueue().env)).status).toBe(202);
  });

  it("an open request is 409 rebuild_in_progress; with a result and under 5 minutes 429 too_soon; after 5 minutes n = 2 from r1 to r2", async () => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    const o = await owner();
    const s = await storedInvoice(o);
    await env.DOCS.delete(s.key);
    const first = await json(await post(o, `/invoices/${s.id}/pdf/rebuild`, pdfQueue().env));
    const again = await post(o, `/invoices/${s.id}/pdf/rebuild`, pdfQueue().env);
    expect(again.status).toBe(409);
    expect(await json(again)).toMatchObject({
      error: { code: "rebuild_in_progress", message: "This PDF is already being rebuilt." },
    });
    await completeRebuild(first.repair.id, repairKey(s.key, 1));
    await env.DOCS.delete(repairKey(s.key, 1));
    const soon = await post(o, `/invoices/${s.id}/pdf/rebuild`, pdfQueue().env);
    expect(soon.status).toBe(429);
    expect(await json(soon)).toMatchObject({
      error: {
        code: "too_soon",
        message: "A rebuild was asked for less than 5 minutes ago. Try again later.",
      },
    });
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1_000);
    const second = await post(o, `/invoices/${s.id}/pdf/rebuild`, pdfQueue().env);
    expect(second.status, await second.clone().text()).toBe(202);
    const reqs = (await repairsOf(s.id)).results;
    expect(reqs[1]).toMatchObject({ n: 2, old_key: repairKey(s.key, 1), new_key: repairKey(s.key, 2) });
  });

  it("Staff, the Accountant and Sales are 403; the Owner without a fresh code is step_up_required", async () => {
    const o = await owner();
    const s = await storedInvoice(o);
    await env.DOCS.delete(s.key);
    for (const role of ["staff", "accountant", "sales"] as const) {
      const res = await post(await sessionFor(role), `/invoices/${s.id}/pdf/rebuild`);
      expect(res.status, role).toBe(403);
      expect(await codeOf(res)).toBe("forbidden");
    }
    const plain = await sessionFor("owner");
    const res = await post(plain, `/invoices/${s.id}/pdf/rebuild`);
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("step_up_required");
    expect((await repairsOf(s.id)).results).toHaveLength(0);
  });

  it("a failed queue send is 503 queue_unavailable and closes the request as failed", async () => {
    const o = await owner();
    const s = await storedInvoice(o);
    await env.DOCS.delete(s.key);
    const res = await post(o, `/invoices/${s.id}/pdf/rebuild`, pdfQueue(true).env);
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({
      error: {
        code: "queue_unavailable",
        message: "The rebuild couldn't be started. Try again in a minute.",
      },
    });
    const r = await one<{ outcome: string; code: string }>(
      "SELECT r.outcome, r.code FROM pdf_repair_results r JOIN pdf_repairs p ON p.id = r.repair_id WHERE p.subject_id = ?1",
      s.id,
    );
    expect(r).toEqual({ outcome: "failed", code: "queue_unavailable" });
    // Early check change 2: "Try again in a minute" works at once (a message never sent holds no window): 202 with n = 2, from the original again.
    const retry = await post(o, `/invoices/${s.id}/pdf/rebuild`, pdfQueue().env);
    expect(retry.status, await retry.clone().text()).toBe(202);
    expect((await json(retry)).repair).toMatchObject({ n: 2, found: "missing" });
    const reqs = (await repairsOf(s.id)).results;
    expect(reqs[1]).toMatchObject({ n: 2, old_key: s.key, new_key: repairKey(s.key, 2) });
    // ...and that request (sent) holds the window as usual
    expect(await codeOf(await post(o, `/invoices/${s.id}/pdf/rebuild`, pdfQueue().env))).toBe(
      "rebuild_in_progress",
    );
  });

  it("change 7: a failed queue send whose result insert throws still answers 503 (the request stays open)", async () => {
    const o = await owner();
    const s = await storedInvoice(o);
    await env.DOCS.delete(s.key);
    const q = pdfQueue(true);
    const real = env.DB;
    const db = new Proxy(real, {
      get: (t, k) => {
        if (k === "prepare")
          return (sql: string) =>
            sql === RESULT_INSERT_SQL
              ? {
                  bind: () => ({
                    run: async () => {
                      throw new Error("d1 down");
                    },
                  }),
                }
              : t.prepare(sql);
        const v = Reflect.get(t, k);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await post(o, `/invoices/${s.id}/pdf/rebuild`, withEnv(q.env, { DB: db }));
    expect(res.status).toBe(503);
    expect(await codeOf(res)).toBe("queue_unavailable");
    const logged = errors.mock.calls.map((a) => String(a[0]));
    expect(logged.some((l) => l.includes("pdf.rebuild failed result not written"))).toBe(true);
    expect(logged.some((l) => l.includes(s.key))).toBe(false);
    errors.mockRestore();
    expect(
      await countOf(
        "pdf_repair_results r JOIN pdf_repairs p ON p.id = r.repair_id",
        "p.subject_id = ?1",
        s.id,
      ),
    ).toBe(0);
    expect(await codeOf(await post(o, `/invoices/${s.id}/pdf/rebuild`, pdfQueue().env))).toBe(
      "rebuild_in_progress",
    );
  });

  it("change 5: an object over 2 MB is damaged without being hashed, even when its bytes match", async () => {
    const big = new Uint8Array(REBUILD_HASH_MAX_BYTES + 1).fill(7);
    await env.DOCS.put("docs/probe/big-v1.pdf", big);
    const sha = await sha256Hex(big);
    expect(await checkStored(env.DOCS, "docs/probe/big-v1.pdf", sha)).toEqual({
      verdict: "damaged",
      sha256: sha,
    });
    const small = new Uint8Array(REBUILD_HASH_MAX_BYTES).fill(7);
    await env.DOCS.put("docs/probe/small-v1.pdf", small);
    expect((await checkStored(env.DOCS, "docs/probe/small-v1.pdf", await sha256Hex(small))).verdict).toBe(
      "intact",
    );
  });

  it("change 1: a recorded rebuild whose object is gone serves the original (the row's ETag), logged with the request id only", async () => {
    const o = await owner();
    const s = await storedInvoice(o);
    await env.DOCS.delete(s.key);
    const first = await json(await post(o, `/invoices/${s.id}/pdf/rebuild`, pdfQueue().env));
    await completeRebuild(first.repair.id, repairKey(s.key, 1));
    await env.DOCS.delete(repairKey(s.key, 1));
    await putWithSha(env.DOCS, s.key, ORIGINAL_PDF);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dl = await call(`/invoices/${s.id}/pdf`, { cookie: o.cookie });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("ETag")).toBe(`"${s.sha}"`);
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(ORIGINAL_PDF);
    const logged = errors.mock.calls.map((a) => String(a[0]));
    errors.mockRestore();
    expect(logged.filter((l) => l.includes("rebuilt pdf object missing"))).toHaveLength(1);
    expect(logged.some((l) => l.includes(s.key) || l.includes(repairKey(s.key, 1)))).toBe(false);
  });

  it("change 1: the supplier copy whose rebuilt object is gone serves the stored copy, never a 202 forever", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const n = await one<{ fy: string; number: number }>(
      "SELECT fy, number FROM documents WHERE id = ?1",
      made.id,
    );
    const key = `docs/tax_invoice/20${n?.fy.slice(0, 2)}-${n?.fy.slice(2)}/${String(n?.number).padStart(4, "0")}-v1.pdf`;
    const sha = await putWithSha(env.DOCS, key, ORIGINAL_PDF);
    await env.DB.prepare("UPDATE documents SET pdf_r2_key = ?2, pdf_sha256 = ?3 WHERE id = ?1")
      .bind(made.id, key, sha)
      .run();
    const copyKey = key.replace(/\.pdf$/, "-supplier.pdf");
    const res = await post(o, `/invoices/${made.id}/pdf/supplier/rebuild`, pdfQueue().env);
    expect(res.status, await res.clone().text()).toBe(202);
    await completeRebuild((await json(res)).repair.id, repairKey(copyKey, 1));
    await env.DOCS.delete(repairKey(copyKey, 1));
    // the copy was re-made under its own key meanwhile (the download's self-heal)
    await putWithSha(env.DOCS, copyKey, DAMAGED_PDF);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dl = await call(`/invoices/${made.id}/pdf/supplier`, { cookie: o.cookie });
    errors.mockRestore();
    expect(dl.status).toBe(200);
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(DAMAGED_PDF);
  });

  it("the state GET is the reader's: Staff reads an invoice's, Sales none; a strict empty body only", async () => {
    const o = await owner();
    const s = await storedInvoice(o);
    expect(
      (await call(`/invoices/${s.id}/pdf/rebuilds`, { cookie: (await sessionFor("staff")).cookie })).status,
    ).toBe(200);
    expect(
      (await call(`/invoices/${s.id}/pdf/rebuilds`, { cookie: (await sessionFor("sales")).cookie })).status,
    ).toBe(403);
    expect((await call(`/invoices/nope/pdf/rebuilds`, { cookie: o.cookie })).status).toBe(404);
    expect((await call(`/invoices/${s.id}/pdf/rebuild`, { cookie: o.cookie, body: { x: 1 } })).status).toBe(
      400,
    );
  });
});

describe("every kind: the GET and the download serve the rebuilt file", () => {
  /** Missing original → 202; the result and object → the download serves the rebuilt bytes and the state GET names it. */
  async function rebuildAndServe(
    o: TestSession,
    base: string,
    download: string,
    originalKey: string,
    subject: string,
  ) {
    await env.DOCS.delete(originalKey);
    const res = await post(o, `${base}/rebuild`, pdfQueue().env);
    expect(res.status, await res.clone().text()).toBe(202);
    const req = await one<{ id: string; original_key: string; new_key: string }>(
      "SELECT id, original_key, new_key FROM pdf_repairs WHERE subject_id = ?1 ORDER BY n DESC LIMIT 1",
      subject,
    );
    expect(req?.original_key).toBe(originalKey);
    const sha = await completeRebuild(req?.id as string, req?.new_key as string);
    const dl = await call(download, { cookie: o.cookie });
    expect(dl.status, download).toBe(200);
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(REBUILT_PDF);
    expect((await json(await call(`${base}/rebuilds`, { cookie: o.cookie }))).served).toEqual({
      sha256: sha,
    });
  }

  it("the supplier copy (no hash column: R2's checksum of the stored copy)", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    // The download reads the copy by `supplierPdfKey` of the row's number, so the original sits at its `pdfKeys` key (as the jobs Worker stores it).
    const n = await one<{ fy: string; number: number }>(
      "SELECT fy, number FROM documents WHERE id = ?1",
      made.id,
    );
    const key = `docs/tax_invoice/20${n?.fy.slice(0, 2)}-${n?.fy.slice(2)}/${String(n?.number).padStart(4, "0")}-v1.pdf`;
    const sha = await putWithSha(env.DOCS, key, ORIGINAL_PDF);
    await env.DB.prepare("UPDATE documents SET pdf_r2_key = ?2, pdf_sha256 = ?3 WHERE id = ?1")
      .bind(made.id, key, sha)
      .run();
    const copyKey = key.replace(/\.pdf$/, "-supplier.pdf");
    await putWithSha(env.DOCS, copyKey, ORIGINAL_PDF);
    // intact (R2's checksum matches the bytes): nothing to rebuild
    expect(await codeOf(await post(o, `/invoices/${made.id}/pdf/supplier/rebuild`))).toBe(
      "nothing_to_rebuild",
    );
    await rebuildAndServe(
      o,
      `/invoices/${made.id}/pdf/supplier`,
      `/invoices/${made.id}/pdf/supplier`,
      copyKey,
      made.id,
    );
  });

  it("the acceptance certificate (the route takes the document id; the subject is the acceptance)", async () => {
    const o = await owner();
    const off = await storedOffer({ status: "accepted", validUntil: "2099-12-31" });
    const contact = await mkContact(off.clientId);
    const acc = uuidv7();
    await insert("acceptances", {
      id: acc,
      document_id: off.id,
      contact_id: contact.id,
      typed_name: "A Person",
      email: contact.email,
      accepted_at: Date.now(),
      pdf_sha256: off.sha,
      via: "session",
      certificate_r2_key: off.key.replace(/\.pdf$/, "-certificate.pdf"),
    });
    const certKey = off.key.replace(/\.pdf$/, "-certificate.pdf");
    const certSha = await putWithSha(env.DOCS, certKey, ORIGINAL_PDF);
    await insert("acceptance_certificates", {
      acceptance_id: acc,
      r2_key: certKey,
      sha256: certSha,
      rendered_at: Date.now(),
    });
    await rebuildAndServe(
      o,
      `/documents/${off.id}/certificate`,
      `/documents/${off.id}/certificate`,
      certKey,
      acc,
    );
  });

  it("a receipt", async () => {
    const o = await owner();
    const clientId = (await mkInvoiceClient()).clientId;
    const p = await recorded(o, recordBody(clientId, 2_000));
    const r = await issueReceipt(env, p.id as string);
    expect(r.result).toBe("issued");
    const rc = await one<{ id: string }>(
      "SELECT id FROM documents WHERE type = 'receipt' AND number_display = ?1",
      r.number,
    );
    const rid = rc?.id as string;
    const key = nextKey("receipt");
    const sha = await putWithSha(env.DOCS, key, ORIGINAL_PDF);
    await env.DB.prepare("UPDATE documents SET pdf_r2_key = ?2, pdf_sha256 = ?3 WHERE id = ?1")
      .bind(rid, key, sha)
      .run();
    await rebuildAndServe(o, `/receipts/${rid}/pdf`, `/receipts/${rid}/pdf`, key, rid);
  });

  it("a void receipt (its payment withdrawn) is rebuilt too (early check change 8)", async () => {
    const o = await owner();
    const clientId = (await mkInvoiceClient()).clientId;
    const p = await recorded(o, recordBody(clientId, 2_500));
    const r = await issueReceipt(env, p.id as string);
    expect(r.result).toBe("issued");
    const rid = `rct_${p.id}`;
    const key = nextKey("receipt");
    const sha = await putWithSha(env.DOCS, key, ORIGINAL_PDF);
    await env.DB.prepare("UPDATE documents SET pdf_r2_key = ?2, pdf_sha256 = ?3 WHERE id = ?1")
      .bind(rid, key, sha)
      .run();
    const w = await call(`/payments/${p.id}/withdraw`, {
      cookie: o.cookie,
      body: { reason: "Entered twice" },
    });
    expect(w.status, await w.clone().text()).toBe(200);
    expect(await one("SELECT status FROM documents WHERE id = ?1", rid)).toEqual({ status: "void" });
    const before = await wholeRow(env.DB, "documents", "id", rid);
    await rebuildAndServe(o, `/receipts/${rid}/pdf`, `/receipts/${rid}/pdf`, key, rid);
    expect(await wholeRow(env.DB, "documents", "id", rid)).toBe(before);
  });

  it("a deed's unsigned PDF (Staff reads its state; the audit row names the deed)", async () => {
    const o = await owner();
    const f = await finalisedDeed(o);
    const key = `deeds/${f.deedId}/unsigned-${await sha256Hex(ORIGINAL_PDF)}.pdf`;
    const sha = await putWithSha(env.DOCS, key, ORIGINAL_PDF);
    await env.DB.prepare("UPDATE deeds SET unsigned_r2_key = ?2, unsigned_sha256 = ?3 WHERE id = ?1")
      .bind(f.deedId, key, sha)
      .run();
    const before = await wholeRow(env.DB, "deeds", "id", f.deedId);
    await rebuildAndServe(o, `/deeds/${f.deedId}/pdf`, `/deeds/${f.deedId}/pdf/unsigned`, key, f.deedId);
    expect(
      await countOf(
        "audit_log",
        "action = 'pdf.rebuild' AND entity_type = 'deed' AND entity_id = ?1",
        f.deedId,
      ),
    ).toBe(1);
    expect(
      (await call(`/deeds/${f.deedId}/pdf/rebuilds`, { cookie: (await sessionFor("staff")).cookie })).status,
    ).toBe(200);
    expect(await wholeRow(env.DB, "deeds", "id", f.deedId)).toBe(before);
  });
});

describe("R2's stored checksum (the head shortcut)", () => {
  it("workerd returns checksums.sha256 on head after a put with sha256; none after a plain put", async () => {
    const hexOf = (b: ArrayBuffer | undefined) =>
      b ? Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("") : null;
    const sha = await putWithSha(env.DOCS, "docs/probe/0001-v1.pdf", ORIGINAL_PDF);
    expect(hexOf((await env.DOCS.head("docs/probe/0001-v1.pdf"))?.checksums.sha256)).toBe(sha);
    await env.DOCS.put("docs/probe/0002-v1.pdf", ORIGINAL_PDF);
    expect(hexOf((await env.DOCS.head("docs/probe/0002-v1.pdf"))?.checksums.sha256)).toBeNull();
  });
});
