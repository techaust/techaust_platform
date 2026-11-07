// Rebuild PDF, the jobs half (JOB-PDF-02, JOB-PDF-01's recorded exception; run file docs/runs/rebuild-pdf.md "Done-test" and "Jobs"): an issued document
// whose stored PDF is gone is rebuilt from its sealed envelope under `<original>-r1.pdf`; the frozen row never changes; readers' lookup returns the new key.
// Every kind through the first render's own plan; refusals, skips, adoption, the delay and the dead letter. Documents are issued through the real issue
// and send statements; Browser Run is a fake binding. Shared fixture: packages/testing/src/pdf-rebuild.ts. Invented data only.
import { env as realEnv } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { type DeedSnapshot, deedSnapshotJson } from "@techaust/core/deeds";
import { canonicalJson, sha256Hex } from "@techaust/core/hash";
import { pdfKeys, supplierPdfKey } from "@techaust/core/pdf-jobs";
import { type RepairKind, repairKey } from "@techaust/core/pdf-repair";
import { receiptHeaderOf } from "@techaust/core/receipts";
import { REQUEST_INSERT_SQL, requestBinds, SERVED_PDF_SQL } from "@techaust/db/pdf-repairs";
import { describe, expect, it } from "vitest";
import {
  sha256Hex as bytesSha,
  ORIGINAL_PDF,
  putWithSha,
  wholeRow,
} from "../../../packages/testing/src/pdf-rebuild.ts";
import { stubPdf } from "../src/browser.ts";
import { processDeedPdf } from "../src/deed-pdf.ts";
import { attachmentFor } from "../src/email.ts";
import type { Clock } from "../src/pacer.ts";
import {
  certificatePlan,
  processCertificate,
  processRender,
  processSnapshot,
  processSupplierCopy,
} from "../src/pdf.ts";
import { processRebuild, processRebuildDeadLetter, storedVerdict } from "../src/pdf-rebuild.ts";
import { handleQueue } from "../src/queue.ts";
import { processReceipt } from "../src/receipts.ts";
import {
  fakes,
  logs,
  makeEnv,
  mkClient,
  mkContact,
  mkDoc,
  one,
  run,
  staff,
  useFakes,
} from "./billing-fixtures.ts";
import { seedIssuedInvoice } from "./pdf-invoice-seed.ts";
import { seedSent } from "./pdf-seed.ts";

useFakes();

const NOW = Date.UTC(2026, 10, 7, 6, 0, 0);
const clock: Clock = { now: () => NOW, sleep: async () => undefined };
/** An offer sent in June: long expired by now, so the client can no longer accept it (owner Q1 = B: only such an offer is rebuilt). */
const JUNE = Date.UTC(2026, 5, 10, 6, 0, 0);

type Browser = { pages: string[]; binding: unknown };
function browser(answer: () => Response = () => pdf()): Browser {
  const pages: string[] = [];
  return {
    pages,
    binding: {
      quickAction: async (_a: "pdf", options: { html: string }) => {
        pages.push(options.html);
        return answer();
      },
    },
  };
}
const pdf = () =>
  new Response(stubPdf(), {
    status: 200,
    headers: { "content-type": "application/pdf", "x-browser-ms-used": "900" },
  });
const mkEnv = (b: Browser = browser(), over: Record<string, unknown> = {}) =>
  makeEnv({
    DOCS: realEnv.DOCS,
    PDF_RENDERER: "browser",
    PDF_MIN_SPACING_MS: "0",
    BROWSER: b.binding,
    ...over,
  });

let owner = "";
/** A request as the admin route writes it (`REQUEST_INSERT_SQL`), for the key the subject records; returns its id. */
async function request(kind: RepairKind, subjectId: string, originalKey: string, at = Date.now()) {
  owner ||= (await staff("owner")).id;
  const id = uuidv7();
  const r = await realEnv.DB.prepare(REQUEST_INSERT_SQL[kind])
    .bind(
      ...requestBinds({
        id,
        kind,
        subjectId,
        originalKey,
        checkedKey: originalKey,
        checkedSha: null,
        found: "missing",
        by: owner,
        now: at,
      }),
    )
    .run();
  expect(r.meta.changes, `request ${kind}`).toBe(1);
  return id;
}
const msg = (repairId: string, hop = 0) => ({ v: 1 as const, kind: "pdf.rebuild" as const, repairId, hop });
const resultOf = (repairId: string) =>
  one<{
    outcome: string;
    code: string | null;
    new_key: string | null;
    new_sha256: string | null;
    bytes: number | null;
  }>(
    "SELECT outcome, code, new_key, new_sha256, bytes FROM pdf_repair_results WHERE repair_id = ?1",
    repairId,
  );
const bellsOf = (repairId: string) =>
  realEnv.DB.prepare(
    "SELECT DISTINCT kind, title FROM notifications WHERE entity_type = 'pdf_repair' AND entity_id = ?1",
  )
    .bind(repairId)
    .all<{ kind: string; title: string }>();
const hexOf = (b: ArrayBuffer | undefined) =>
  b ? Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("") : null;

/** An issued tax invoice with its envelope and its first PDF made by the real steps. */
async function renderedInvoice() {
  const s = await seedIssuedInvoice();
  const env = mkEnv();
  expect(await processSnapshot(env, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" })).toBe(
    "queued",
  );
  expect(await processRender(env, { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 }, NOW, clock)).toBe(
    "rendered",
  );
  const key = pdfKeys({ type: "tax_invoice", fy: "2026-27", number: s.number, version: 1 }).pdf;
  return { ...s, key };
}
/** A sent (expired) proposal with its envelope and its first PDF. */
async function renderedOffer() {
  const s = await seedSent({ now: JUNE });
  const env = mkEnv();
  expect(await processSnapshot(env, { v: 1, kind: "pdf.snapshot", documentId: s.id, reason: "send" })).toBe(
    "queued",
  );
  expect(await processRender(env, { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 }, NOW, clock)).toBe(
    "rendered",
  );
  const row = await one<{ pdf_r2_key: string }>("SELECT pdf_r2_key FROM documents WHERE id = ?1", s.id);
  return { ...s, key: row?.pdf_r2_key as string };
}

describe("the done-test, jobs half [JOB-PDF-02]", () => {
  for (const kind of ["invoice", "offer"] as const) {
    it(`${kind}: the PDF deleted, the request, processRebuild: the object at -r1 (put with its SHA-256), a rebuilt result, the frozen row unchanged, the readers' lookup`, async () => {
      const s = kind === "invoice" ? await renderedInvoice() : await renderedOffer();
      const before = await wholeRow(realEnv.DB, "documents", "id", s.id);
      await realEnv.DOCS.delete(s.key);
      const repairId = await request(kind, s.id, s.key);
      const b = browser();
      expect(await processRebuild(mkEnv(b), msg(repairId), NOW, clock)).toBe("rebuilt");
      expect(b.pages).toHaveLength(1);
      const newKey = repairKey(s.key, 1);
      const head = await realEnv.DOCS.head(newKey);
      expect(head).not.toBeNull();
      const stored = new Uint8Array(await ((await realEnv.DOCS.get(newKey)) as R2ObjectBody).arrayBuffer());
      const sha = await bytesSha(stored);
      // put with its SHA-256: R2 recorded the checksum
      expect(hexOf(head?.checksums.sha256)).toBe(sha);
      expect(await resultOf(repairId)).toEqual({
        outcome: "rebuilt",
        code: null,
        new_key: newKey,
        new_sha256: sha,
        bytes: stored.byteLength,
      });
      expect(await wholeRow(realEnv.DB, "documents", "id", s.id)).toBe(before);
      expect(await one(SERVED_PDF_SQL, s.key)).toMatchObject({ new_key: newKey, new_sha256: sha });
      // the original key stays empty: never written again
      expect(await realEnv.DOCS.head(s.key)).toBeNull();
      expect((await bellsOf(repairId)).results).toEqual([
        { kind: "pdf.rebuilt", title: `The PDF of ${s.numberDisplay} was rebuilt.` },
      ]);
      expect(
        await one<{ value: number }>(
          "SELECT value FROM stats_daily WHERE metric = 'pdf.rebuilds' AND date = ?1 AND dimension = ''",
          "2026-11-07",
        ),
      ).toMatchObject({ value: expect.any(Number) });
    });
  }
});

describe("every kind through its plan", () => {
  it("the supplier copy: rendered from the same envelope with the supplier's mark", async () => {
    const s = await renderedInvoice();
    expect(
      await processSupplierCopy(
        mkEnv(),
        { v: 1, kind: "pdf.supplier", documentId: s.id, hop: 0 },
        NOW,
        clock,
      ),
    ).toBe("rendered");
    const copyKey = supplierPdfKey({ type: "tax_invoice", fy: "2026-27", number: s.number, version: 1 });
    await realEnv.DOCS.delete(copyKey);
    const repairId = await request("supplier", s.id, copyKey);
    const b = browser();
    expect(await processRebuild(mkEnv(b), msg(repairId), NOW, clock)).toBe("rebuilt");
    expect(b.pages[0]).toContain("DUPLICATE FOR SUPPLIER");
    expect(await realEnv.DOCS.head(repairKey(copyKey, 1))).not.toBeNull();
  });

  it("the acceptance certificate: from the evidence row, never the live client name", async () => {
    const s = await renderedOffer();
    const contact = await mkContact(s.clientId);
    const acc = uuidv7();
    const certKey = s.key.replace(/\.pdf$/, "-certificate.pdf");
    await run(
      "INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, pdf_sha256, via, snapshot_sha256, certificate_r2_key) VALUES (?1, ?2, ?3, 'A Person', ?4, ?5, 'pdfsha', 'session', 'snapsha', ?6)",
      acc,
      s.id,
      contact.id,
      contact.email,
      JUNE + 1_000,
      certKey,
    );
    expect(
      await processCertificate(
        mkEnv(),
        { v: 1, kind: "pdf.certificate", acceptanceId: acc, hop: 0 },
        NOW,
        clock,
      ),
    ).toBe("rendered");
    await realEnv.DOCS.delete(certKey);
    const repairId = await request("certificate", acc, certKey);
    const b = browser();
    expect(await processRebuild(mkEnv(b), msg(repairId), NOW, clock)).toBe("rebuilt");
    expect(b.pages[0]).toContain("A Person");
    expect(await realEnv.DOCS.head(repairKey(certKey, 1))).not.toBeNull();
    // the plan refuses a certificate whose name is not sealed in the document (the rebuild asks for it; the first render does not)
    const view = { view: {} as never, nameSealed: false };
    expect(certificatePlan(view, { sealedName: true })).toEqual({ ok: false, code: "certificate_unsealed" });
    expect(certificatePlan(view, { sealedName: false }).ok).toBe(true);
  });

  it("a receipt and a deed's unsigned PDF, each through its own plan", async () => {
    const o = await staff("owner");
    const clientId = await mkClient();
    const paymentId = uuidv7();
    await run(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, reference_norm, recorded_by, recorded_at, verified_by, verified_at)
       VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'INR', 42000, '2026-11-01', 'neft', ?3, ?4, ?5, ?4, ?5)`,
      paymentId,
      clientId,
      `UTRRB${Date.now()}`,
      o.id,
      Date.now() - 60_000,
    );
    const header = receiptHeaderOf({
      payment: {
        id: paymentId,
        currency: "INR",
        amountMinor: 42_000,
        receivedOn: "2026-11-01",
        provider: "manual",
        mode: "neft",
        referenceNorm: "UTR12345",
        refundedMinor: 0,
      },
      allocations: [],
      client: { name: "Sample Client Pvt Ltd", gstin: null },
      issuer: {
        tradeName: "Sample Trade",
        legalName: "Sample Legal",
        address: "1 Sample Road, Sample Town",
        gstin: "19ABCDE1234F1Z5",
        email: "billing@example.test",
      },
      issuedOn: "2026-11-03",
    });
    if (!header.ok) throw new Error(header.code);
    const receiptOf = header.value;
    const rid = `rct_${paymentId}`;
    await run(
      `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, subtotal_minor, taxable_minor, total_minor,
         balance_minor, content_sha256, snapshot_sha256, header_extras, updated_at)
       VALUES (?1, 'receipt', 'issued', ?2, 'INR', 'receipt', '2627', 7001, 'TH/RCT/2627/7001', ?3, '2026-11-01', 42000, 0, 42000, 0, ?4, ?5, ?6, ?3)`,
      rid,
      clientId,
      Date.now() - 30_000,
      "h".repeat(64),
      await sha256Hex(canonicalJson(receiptOf)),
      JSON.stringify({ receiptOf }),
    );
    await run("UPDATE payments SET receipt_document_id = ?2 WHERE id = ?1", paymentId, rid);
    expect(
      await processReceipt(mkEnv(), { v: 1, kind: "receipt.render", receiptId: rid, hop: 0 }, NOW, clock),
    ).toBe("rendered");
    const rkey = (await one<{ pdf_r2_key: string }>("SELECT pdf_r2_key FROM documents WHERE id = ?1", rid))
      ?.pdf_r2_key as string;
    await realEnv.DOCS.delete(rkey);
    const r1 = await request("receipt", rid, rkey);
    expect(await processRebuild(mkEnv(), msg(r1), NOW, clock)).toBe("rebuilt");
    expect(await realEnv.DOCS.head(repairKey(rkey, 1))).not.toBeNull();

    // the deed
    const proposal = await mkDoc(clientId, null, { type: "proposal", status: "accepted" });
    const projectId = uuidv7();
    await run(
      "INSERT INTO projects (id, code, client_id, name, status, currency, source_document_id) VALUES (?1, ?2, ?3, 'Website', 'completed', 'INR', ?4)",
      projectId,
      `PRJ-RB${Date.now() % 100000}`,
      clientId,
      proposal.id,
    );
    const deedId = `deed_${uuidv7().replaceAll("-", "")}`;
    await run(
      "INSERT INTO deeds (id, client_id, project_id, source_document_id, status) VALUES (?1, ?2, ?3, ?4, 'draft')",
      deedId,
      clientId,
      projectId,
      proposal.id,
    );
    const snapshot = deedSnapshotJson(DEED);
    await run(
      `UPDATE deeds SET status = 'final', fy = '2627', number = 77, number_display = 'TH/DA/2627/0077', made_on = '2026-11-01', snapshot = ?2, snapshot_sha256 = ?3,
         finalised_at = 1, finalised_by = ?4, sched_deliverables = 'a', sched_location = 'b', sched_delivered_dates = 'c', sched_tools = 'None', sched_third_party = 'e'
       WHERE id = ?1`,
      deedId,
      snapshot,
      await sha256Hex(snapshot),
      o.id,
    );
    expect(await processDeedPdf(mkEnv(), { v: 1, kind: "pdf.deed", deedId, hop: 0 }, NOW, clock)).toBe(
      "rendered",
    );
    const dkey = (
      await one<{ unsigned_r2_key: string }>("SELECT unsigned_r2_key FROM deeds WHERE id = ?1", deedId)
    )?.unsigned_r2_key as string;
    const deedBefore = await wholeRow(realEnv.DB, "deeds", "id", deedId);
    await realEnv.DOCS.delete(dkey);
    const d1 = await request("deed", deedId, dkey);
    const b = browser();
    expect(await processRebuild(mkEnv(b), msg(d1), NOW, clock)).toBe("rebuilt");
    expect(b.pages[0]).toContain("TH/DA/2627/0077");
    expect(await realEnv.DOCS.head(repairKey(dkey, 1))).not.toBeNull();
    expect(await wholeRow(realEnv.DB, "deeds", "id", deedId)).toBe(deedBefore);
  });
});

const DEED: DeedSnapshot = {
  layout: "deed-v1",
  madeOn: "2026-11-01",
  supplier: { address: "1 Sample Road, Balurghat", gstin: "19ABCDE1234F1Z5" },
  client: { legalName: "Sample Traders Pvt Ltd", address: "4 Sample Street, Kolkata, India", reg: null },
  offer: { docType: "proposal", number: "TH/PRP/2627/0077", version: 1, acceptedOn: "2026-10-05" },
  payment: { invoiceNumbers: ["TH/INV/2627/0077"], amountPaidMinor: 118_000, currency: "INR" },
  schedule1: { deliverables: "Website source", location: "Git repository", deliveredDates: "28 Oct 2026" },
  schedule2: { tools: "None", thirdParty: "Astro (MIT licence)" },
};

describe("refusals, skips and the queue", () => {
  it("a tampered envelope (JSON edited in DOCS) is refused: no render, no object at the new key, a bell, no pdf_failures row", async () => {
    const s = await renderedInvoice();
    const envKey = s.key.replace(/\.pdf$/, ".json");
    const text = await ((await realEnv.DOCS.get(envKey)) as R2ObjectBody).text();
    const tampered = text.replace('"description":"', '"description":"X');
    expect(tampered).not.toBe(text);
    await realEnv.DOCS.put(envKey, tampered);
    await realEnv.DOCS.delete(s.key);
    const repairId = await request("invoice", s.id, s.key);
    const b = browser();
    expect(await processRebuild(mkEnv(b), msg(repairId), NOW, clock)).toBe("refused");
    expect(b.pages).toHaveLength(0);
    expect(await realEnv.DOCS.head(repairKey(s.key, 1))).toBeNull();
    expect(await resultOf(repairId)).toMatchObject({ outcome: "refused", new_key: null });
    expect((await bellsOf(repairId)).results).toEqual([
      {
        kind: "pdf.refused",
        title: `The PDF of ${s.numberDisplay} couldn't be rebuilt because its saved record didn't match. A developer needs to look at it.`,
      },
    ]);
    expect(await one("SELECT refused_at FROM pdf_failures WHERE document_id = ?1", s.id)).toBeNull();
  });

  it("a missing envelope is failed / envelope_missing with its own bell, 07-ZV line 22 (never re-made from the rows)", async () => {
    const s = await renderedInvoice();
    await realEnv.DOCS.delete(s.key.replace(/\.pdf$/, ".json"));
    await realEnv.DOCS.delete(s.key);
    const repairId = await request("invoice", s.id, s.key);
    expect(await processRebuild(mkEnv(), msg(repairId), NOW, clock)).toBe("failed");
    expect(await resultOf(repairId)).toMatchObject({ outcome: "failed", code: "envelope_missing" });
    expect((await bellsOf(repairId)).results).toEqual([
      {
        kind: "pdf.failed",
        title: `The PDF of ${s.numberDisplay} couldn't be rebuilt because its saved record is missing. A developer needs to look at it.`,
      },
    ]);
  });

  it("change 3: the original came back after a put whose result never ran: intact, and the stray object at the new key is deleted", async () => {
    const s = await renderedInvoice();
    const repairId = await request("invoice", s.id, s.key);
    await putWithSha(realEnv.DOCS, repairKey(s.key, 1), ORIGINAL_PDF);
    expect(await processRebuild(mkEnv(), msg(repairId), NOW, clock)).toBe("intact");
    expect(await realEnv.DOCS.head(repairKey(s.key, 1))).toBeNull();
    expect(await resultOf(repairId)).toMatchObject({ outcome: "intact", new_key: null });
  });

  it("change 3: redacted after a put whose result never ran: skipped, and the stray object is deleted (it would survive erasure)", async () => {
    const s = await renderedOffer();
    await realEnv.DOCS.delete(s.key);
    const repairId = await request("offer", s.id, s.key);
    await putWithSha(realEnv.DOCS, repairKey(s.key, 1), ORIGINAL_PDF);
    await run(
      "UPDATE documents SET recipient = json_object('legalName', 'Anonymised client', 'country', 'IN'), title = 'Anonymised client', redacted_at = ?2, updated_at = updated_at + 1 WHERE id = ?1",
      s.id,
      Date.now(),
    );
    expect(await processRebuild(mkEnv(), msg(repairId), NOW, clock)).toBe("skipped");
    expect(await realEnv.DOCS.head(repairKey(s.key, 1))).toBeNull();
    expect(await resultOf(repairId)).toMatchObject({ outcome: "skipped", code: "redacted" });
  });

  it("change 3: the dead letter adopts a stored object while the subject may be rebuilt; otherwise deletes it with the failed result", async () => {
    const s = await renderedInvoice();
    await realEnv.DOCS.delete(s.key);
    const live = await request("invoice", s.id, s.key);
    const sha = await putWithSha(realEnv.DOCS, repairKey(s.key, 1), ORIGINAL_PDF);
    expect(await processRebuildDeadLetter(mkEnv(), msg(live), NOW)).toBe("adopted");
    expect(await resultOf(live)).toMatchObject({ outcome: "rebuilt", new_sha256: sha });
    expect((await bellsOf(live)).results).toEqual([
      { kind: "pdf.rebuilt", title: `The PDF of ${s.numberDisplay} was rebuilt.` },
    ]);

    const t = await renderedInvoice();
    await realEnv.DOCS.delete(t.key);
    const gone = await request("invoice", t.id, t.key);
    await putWithSha(realEnv.DOCS, repairKey(t.key, 1), ORIGINAL_PDF);
    await run("UPDATE clients SET anonymised_at = 5 WHERE id = ?1", t.clientId);
    expect(await processRebuildDeadLetter(mkEnv(), msg(gone), NOW)).toBe("failed");
    expect(await realEnv.DOCS.head(repairKey(t.key, 1))).toBeNull();
    expect(await resultOf(gone)).toMatchObject({ outcome: "failed", code: "dead_letter", new_key: null });
  });

  it("change 8: the daily quota sends a delayed copy with the next hop, counts the hit and rings the pdf.quota bell", async () => {
    const s = await renderedInvoice();
    await realEnv.DOCS.delete(s.key);
    const repairId = await request("invoice", s.id, s.key);
    const quota = browser(() => new Response("Browser time limit exceeded for today", { status: 429 }));
    expect(await processRebuild(mkEnv(quota), msg(repairId, 2), NOW, clock)).toBe("delayed");
    expect(fakes.pdf.at(-1)).toMatchObject({ body: msg(repairId, 3) });
    expect(await resultOf(repairId)).toBeNull();
    expect(
      await one<{ kind: string }>(
        "SELECT kind FROM notifications WHERE kind = 'pdf.quota' AND entity_id = ?1 LIMIT 1",
        new Date(NOW).toISOString().slice(0, 10),
      ),
    ).toEqual({ kind: "pdf.quota" });
    expect(
      (await one<{ value: number }>("SELECT value FROM stats_daily WHERE metric = 'pdf.quota_hits' LIMIT 1"))
        ?.value,
    ).toBeGreaterThan(0);
  });

  it("attachmentFor serves the rebuilt file for the original key, and the original again when the rebuilt object is gone", async () => {
    const s = await renderedOffer();
    await realEnv.DOCS.delete(s.key);
    const repairId = await request("offer", s.id, s.key);
    const env = mkEnv();
    expect(await processRebuild(env, msg(repairId), NOW, clock)).toBe("rebuilt");
    const rebuilt = new Uint8Array(
      await ((await realEnv.DOCS.get(repairKey(s.key, 1))) as R2ObjectBody).arrayBuffer(),
    );
    const file = await attachmentFor(env, { key: s.key, filename: "x-v1.pdf" });
    expect(file?.bytes).toEqual(rebuilt);
    // the rebuilt object lost: the original (put back) is attached, logged without the key
    await realEnv.DOCS.delete(repairKey(s.key, 1));
    await putWithSha(realEnv.DOCS, s.key, ORIGINAL_PDF);
    const back = await attachmentFor(env, { key: s.key, filename: "x-v1.pdf" });
    expect(back?.bytes).toEqual(ORIGINAL_PDF);
    expect(logs.some((l) => l.includes("email.attachment_rebuilt_missing"))).toBe(true);
    expect(logs.some((l) => l.includes(s.key))).toBe(false);
    // no repair at all: the original
    const plain = await renderedInvoice();
    const orig = new Uint8Array(await ((await realEnv.DOCS.get(plain.key)) as R2ObjectBody).arrayBuffer());
    expect((await attachmentFor(env, { key: plain.key, filename: "y-v1.pdf" }))?.bytes).toEqual(orig);
  });

  it("the original came back: intact / original_present, no render; a result already there: no render", async () => {
    const s = await renderedInvoice();
    const repairId = await request("invoice", s.id, s.key);
    const b = browser();
    expect(await processRebuild(mkEnv(b), msg(repairId), NOW, clock)).toBe("intact");
    expect(await resultOf(repairId)).toMatchObject({ outcome: "intact", code: "original_present" });
    expect(await processRebuild(mkEnv(b), msg(repairId), NOW, clock)).toBe("done");
    expect(b.pages).toHaveLength(0);
  });

  it("a redelivery after the put adopts the stored object once, without a render", async () => {
    const s = await renderedInvoice();
    await realEnv.DOCS.delete(s.key);
    const repairId = await request("invoice", s.id, s.key);
    const sha = await putWithSha(realEnv.DOCS, repairKey(s.key, 1), ORIGINAL_PDF);
    const b = browser();
    expect(await processRebuild(mkEnv(b), msg(repairId), NOW, clock)).toBe("adopted");
    expect(b.pages).toHaveLength(0);
    expect(await resultOf(repairId)).toMatchObject({ outcome: "rebuilt", new_sha256: sha });
    expect(await processRebuild(mkEnv(b), msg(repairId), NOW, clock)).toBe("done");
  });

  it("anonymised between the request and the render: skipped / client_gone, no render", async () => {
    const s = await renderedInvoice();
    await realEnv.DOCS.delete(s.key);
    const repairId = await request("invoice", s.id, s.key);
    await run("UPDATE clients SET anonymised_at = 5 WHERE id = ?1", s.clientId);
    const b = browser();
    expect(await processRebuild(mkEnv(b), msg(repairId), NOW, clock)).toBe("skipped");
    expect(b.pages).toHaveLength(0);
    expect(await resultOf(repairId)).toMatchObject({ outcome: "skipped", code: "client_gone" });
  });

  it("redacted after the put: the object just stored is deleted and the result is skipped", async () => {
    const s = await renderedOffer();
    await realEnv.DOCS.delete(s.key);
    const repairId = await request("offer", s.id, s.key);
    // the browser answers, then the offer is redacted before the result batch
    const env = mkEnv(browser());
    const real = realEnv.DOCS;
    const docs = {
      head: (k: string) => real.head(k),
      get: (k: string) => real.get(k),
      delete: (k: string) => real.delete(k),
      put: async (...a: Parameters<R2Bucket["put"]>) => {
        const r = await real.put(...a);
        await run(
          "UPDATE documents SET recipient = json_object('legalName', 'Anonymised client', 'country', 'IN'), title = 'Anonymised client', redacted_at = ?2, updated_at = updated_at + 1 WHERE id = ?1",
          s.id,
          Date.now(),
        );
        return r;
      },
    } as unknown as R2Bucket;
    (env as unknown as { DOCS: R2Bucket }).DOCS = docs;
    expect(await processRebuild(env, msg(repairId), NOW, clock)).toBe("skipped");
    expect(await realEnv.DOCS.head(repairKey(s.key, 1))).toBeNull();
    expect(await resultOf(repairId)).toMatchObject({ outcome: "skipped", code: "redacted" });
  });

  it("a rate limit sends a delayed copy with the next hop (the shared `failed`); any other failure throws for the retry", async () => {
    const s = await renderedInvoice();
    await realEnv.DOCS.delete(s.key);
    const repairId = await request("invoice", s.id, s.key);
    const rate = browser(() => new Response("slow down", { status: 429, headers: { "retry-after": "30" } }));
    expect(await processRebuild(mkEnv(rate), msg(repairId), NOW, clock)).toBe("delayed");
    expect(fakes.pdf.at(-1)).toMatchObject({ body: msg(repairId, 1) });
    const broken = browser(() => new Response("boom", { status: 500 }));
    await expect(processRebuild(mkEnv(broken), msg(repairId), NOW, clock)).rejects.toThrow();
    expect(await resultOf(repairId)).toBeNull();
  });

  it("the dead letter ends the request failed / dead_letter with one bell; the queue routes pdf.rebuild to the consumer and its dead letter", async () => {
    const s = await renderedInvoice();
    await realEnv.DOCS.delete(s.key);
    const repairId = await request("invoice", s.id, s.key);
    await processRebuildDeadLetter(mkEnv(), msg(repairId), NOW);
    expect(await resultOf(repairId)).toMatchObject({ outcome: "failed", code: "dead_letter" });
    expect((await bellsOf(repairId)).results).toHaveLength(1);

    const t = await renderedInvoice();
    await realEnv.DOCS.delete(t.key);
    const viaQueue = await request("invoice", t.id, t.key);
    const acks: string[] = [];
    const batch = (queue: string, body: unknown) =>
      ({
        queue,
        messages: [
          {
            id: "m1",
            body,
            attempts: 1,
            ack: () => void acks.push(queue),
            retry: () => void acks.push(`retry ${queue}`),
          },
        ],
      }) as unknown as MessageBatch<unknown>;
    await handleQueue(batch("techaust-local-pdf", msg(viaQueue)), mkEnv());
    expect(await resultOf(viaQueue)).toMatchObject({ outcome: "rebuilt" });
    const dead = await renderedInvoice();
    await realEnv.DOCS.delete(dead.key);
    const deadId = await request("invoice", dead.id, dead.key);
    await handleQueue(batch("techaust-local-pdf-dlq", msg(deadId)), mkEnv());
    expect(await resultOf(deadId)).toMatchObject({ outcome: "failed", code: "dead_letter" });
    expect(acks).toEqual(["techaust-local-pdf", "techaust-local-pdf-dlq"]);
    expect(logs.some((l) => l.includes("pdf.rebuild_misrouted"))).toBe(false);
  });

  it("storedVerdict: workerd keeps checksums.sha256 after a put with sha256, so the head decides; a plain put is hashed", async () => {
    const key = `docs/probe/${uuidv7()}.pdf`;
    const sha = await putWithSha(realEnv.DOCS, key, ORIGINAL_PDF);
    expect(hexOf((await realEnv.DOCS.head(key))?.checksums.sha256)).toBe(sha);
    expect(await storedVerdict(realEnv.DOCS, key, sha)).toBe("intact");
    expect(await storedVerdict(realEnv.DOCS, key, "0".repeat(64))).toBe("damaged");
    await realEnv.DOCS.put(key, ORIGINAL_PDF);
    expect((await realEnv.DOCS.head(key))?.checksums.sha256).toBeUndefined();
    expect(await storedVerdict(realEnv.DOCS, key, sha)).toBe("intact");
    expect(await storedVerdict(realEnv.DOCS, key, null)).toBe("intact");
    expect(await storedVerdict(realEnv.DOCS, `${key}.gone`, sha)).toBe("missing");
  });
});
