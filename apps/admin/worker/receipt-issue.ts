// The payment receipt (M6.5; ADM-PAY-09, ADM-SET-04, JOB-PDF-01; run file C `issueReceipt`, L3 to L5, L34, L39), in the invoices Worker: `BillingJobs.issueReceipt`
// (jobs' `receipt.issue`, from every path that confirms money and from the hourly sweep) and the receipt routes:
//   GET  /payments/:id/receipt          the payment's receipt (number, day, status, PDF state; `payments.read`);
//   GET  /receipts/:id/pdf              its PDF, streamed from DOCS (`payments.read`);
//   POST /receipts/:id/pdf/retry        ask for the PDF again (`invoices.draft`, Owner and Staff; audit `receipt.pdf_retry`).
// The issue is its own batch (L3), the M5.1 issue shape with every guard in the main statement (`receiptIssueStatements`): read first (an existing `rct_` row
// answers `already_issued`), then the counter row, its take and the frozen INSERT (the number from `doc_counters`), the audit row by the system, `issue_result`
// unguarded (a refused INSERT burns no number) and the payment's set-once link. A race aborts on the primary key or `issue_result`: re-read, `already_issued`.
// After the batch the receipt's PDF is queued (`receipt.render`). A receipt is not a GST document and is never titled a voucher (Researched 2026-11-03, s.31(3)(d)
// CGST Act and Rule 50 CGST Rules (08-C RA-39)); it makes no stamp or signature claim (OPEN (08-C RB-21): is an emailed, computer-generated payment receipt above
// ₹5,000 chargeable under Schedule I Art. 53 Indian Stamp Act 1899?).
import type { IssueReceiptResult } from "@techaust/core/care-billing";
import { downloadHeaders } from "@techaust/core/file-types";
import { issueDateOf, issueFyOf } from "@techaust/core/invoices";
import { maxNumber, sqlPrintfPattern } from "@techaust/core/numbering";
import type { ReceiptRenderMessage } from "@techaust/core/pdf-jobs";
import { receiptHeaderOf, receiptIdOf, receiptSealOf } from "@techaust/core/receipts";
import {
  RECEIPT_ALLOCATIONS_SQL,
  RECEIPT_PAYMENT_SQL,
  RECEIPT_SERIES_SQL,
  receiptFailureStatements,
  receiptIssueStatements,
} from "@techaust/db/receipts";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql, storedPdfRefusal } from "./anonymised.ts";
import { type AppEnv, err, mutate, NOT_FOUND } from "./context.ts";
import { SUPPLIER_ASK_SQL, SUPPLIER_ASK_WINDOW_MS } from "./document-events.ts";
import { body, idParam, param } from "./http.ts";
import { cachedSetting } from "./settings-cache.ts";
import { mutateSystem } from "./system.ts";

type PayRow = {
  id: string;
  client_id: string;
  kind: string;
  status: string;
  provider: string;
  currency: "INR" | "USD";
  amount_minor: number;
  received_on: string;
  mode: string | null;
  reference_norm: string | null;
  verified_at: number | null;
  receipt_document_id: string | null;
  client_name: string;
  client_gstin: string | null;
  anonymised_at: number | null;
  refunded_minor: number;
  receipt_exists: number | null;
};

/**
 * M6–M7 audit AU3: the owners' bells when the sweep leaves a payment out after RECEIPT_ISSUE_MAX_FAILURES refused issues (staff lines, the lead's under the owner's
 * delegation; drafted in docs/07-content-appendix/ZT-audit-money.md lines 4 and 5).
 */
export const RECEIPT_SERIES_FULL_BELL =
  "Receipts can't be numbered: the receipt series is full for this year. Widen its format in Settings › Numbering.";
export const RECEIPT_BLOCKED_BELL = "A payment's receipt couldn't be issued after 3 tries. Open the payment to check it.";

const numberOf = async (db: D1Database, receiptId: string) =>
  (
    await db
      .prepare("SELECT number_display FROM documents WHERE id = ?1")
      .bind(receiptId)
      .first<{ number_display: string | null }>()
  )?.number_display ?? undefined;

/** Queues the receipt's PDF (best effort: the jobs sweep finds a receipt without one). */
export async function enqueueReceiptPdf(env: object, receiptId: string): Promise<boolean> {
  const queue: unknown = Reflect.get(env, "PDF_QUEUE");
  const send: unknown = typeof queue === "object" && queue !== null ? Reflect.get(queue, "send") : undefined;
  if (typeof send !== "function") return false;
  try {
    await Reflect.apply(send, queue, [
      { v: 1, kind: "receipt.render", receiptId, hop: 0 } satisfies ReceiptRenderMessage,
    ]);
    return true;
  } catch {
    console.log(JSON.stringify({ ev: "receipt", m: "pdf_not_enqueued" }));
    return false;
  }
}

/** `BillingJobs.issueReceipt`: one receipt, its own batch (L3). Never throws for a refusal; throws only for what a retry can fix (D1 unreachable). */
export async function issueReceipt(
  env: { DB: D1Database },
  paymentId: string,
  now = Date.now(),
): Promise<IssueReceiptResult> {
  const db = env.DB;
  const receiptId = receiptIdOf(paymentId);
  const [payR, allocR, numR, coR] = await db.batch([
    db.prepare(RECEIPT_PAYMENT_SQL).bind(paymentId),
    db.prepare(RECEIPT_ALLOCATIONS_SQL).bind(paymentId),
    db.prepare("SELECT value, version FROM settings WHERE key = 'numbering'"),
    db.prepare("SELECT value, version FROM settings WHERE key = 'company'"),
  ]);
  const p = payR?.results[0] as PayRow | undefined;
  if (!p) return { result: "not_eligible", why: "not_found" };
  if (p.receipt_exists === 1)
    return {
      result: "already_issued",
      ...(await numberOf(db, receiptId).then((n) => (n ? { number: n } : {}))),
    };
  if (p.kind !== "payment") return { result: "not_eligible", why: "tds" };
  if (p.status !== "confirmed") return { result: "not_eligible", why: "not_confirmed" };
  if (p.anonymised_at !== null) return { result: "not_eligible", why: "client_anonymised" };
  const numRow = numR?.results[0] as { value: string; version: number } | undefined;
  const format = cachedSetting("numbering", numRow).receipt;
  const company = cachedSetting("company", coR?.results[0] as { value: string; version: number } | undefined);
  const issuedOn = issueDateOf(now);
  const header = receiptHeaderOf({
    payment: {
      id: p.id,
      currency: p.currency,
      amountMinor: p.amount_minor,
      receivedOn: p.received_on,
      provider: p.provider,
      mode: p.mode,
      referenceNorm: p.reference_norm,
      refundedMinor: p.refunded_minor,
    },
    allocations: (
      (allocR?.results ?? []) as {
        document_id: string;
        number_display: string | null;
        type: string;
        held: number;
      }[]
    ).map((a) => ({
      documentId: a.document_id,
      number: a.number_display ?? "",
      type: a.type,
      amountMinor: a.held,
    })),
    client: { name: p.client_name, gstin: p.client_gstin },
    issuer: {
      tradeName: company.tradeName,
      legalName: company.legalName,
      address: company.address,
      gstin: company.gstin,
      email: company.documentsEmail ?? null,
    },
    issuedOn,
  });
  const numberingVersion = numRow?.version ?? null;
  // M6–M7 audit AU3 (B0 7, B6 L4): a refusal of a payment that is due is counted, so the sweep tries it after the others and leaves it out after
  // RECEIPT_ISSUE_MAX_FAILURES (one owners' bell then); `series_full` has its own reason and line.
  const refused = async (why: string): Promise<IssueReceiptResult> => {
    await db.batch(
      receiptFailureStatements(db, {
        paymentId,
        reason: why,
        numberingVersion,
        now,
        bellTitle: why === "series_full" ? RECEIPT_SERIES_FULL_BELL : RECEIPT_BLOCKED_BELL,
        link: "/payments",
      }),
    );
    return { result: "not_eligible", why };
  };
  if (!header.ok) return refused(header.code);
  const pattern = sqlPrintfPattern(format);
  const st = receiptIssueStatements(db, {
    paymentId,
    receiptId,
    fy: issueFyOf(now),
    pattern: pattern.pattern,
    argOrder: pattern.argOrder,
    maxNumber: maxNumber(format),
    numberingVersion,
    issueDate: issuedOn,
    headerExtras: JSON.stringify({ receiptOf: header.value }),
    sealSha256: await receiptSealOf(header.value),
    amountMinor: p.amount_minor,
    currency: p.currency,
    clientId: p.client_id,
    now,
  });
  let done = false;
  try {
    done = await mutateSystem(env, {
      main: st.main,
      action: "receipt.issue",
      entityType: "document",
      entityId: receiptId,
      summary: { receiptId, paymentId, currency: p.currency, amountMinor: p.amount_minor },
      side: () => st.postAudit,
    });
  } catch (e) {
    // A race (the primary key) or a refused freeze (`issue_result`): nothing was written, no number burned. Re-read.
    if (!/UNIQUE|issue_result|documents_receipt|PRIMARY/.test(String(e) + String((e as Error)?.cause ?? "")))
      throw e;
  }
  const number = await numberOf(db, receiptId);
  if (!done) {
    if (number) return { result: "already_issued", number };
    // The INSERT's WHERE refused it: a series with no room left (`series_full`), else something it was read from changed in between (`changed`).
    const counter = await db
      .prepare("SELECT next_no FROM doc_counters WHERE series = ?1 AND fy = ?2")
      .bind(RECEIPT_SERIES_SQL, issueFyOf(now))
      .first<{ next_no: number }>();
    return refused(counter && counter.next_no > maxNumber(format) ? "series_full" : "changed");
  }
  await enqueueReceiptPdf(env, receiptId);
  return number ? { result: "issued", number } : { result: "issued" };
}

// ---- the routes -----------------------------------------------------------------------------------------------------------------------------------------

const PDF_ROW_SQL = `SELECT id, number_display, status, frozen_at, pdf_r2_key, pdf_sha256, ${clientGoneSql("client_id")} AS gone FROM documents WHERE id = ?1 AND type = 'receipt'`;
const PDF_PENDING = { code: "pdf_pending", message: "The PDF isn't ready yet. Try again in a minute." };
const PDF_DONE = { code: "pdf_done", message: "This receipt already has its PDF" };
/** Early check 2, finding 8 (builder's draft for the lead, staff-only): at most one re-render ask per receipt in `SUPPLIER_ASK_WINDOW_MS` (the brief's throttle). */
const PDF_ASKED = {
  code: "too_soon",
  message: "A new PDF was asked for less than 5 minutes ago. It is on its way.",
};
/** The key of a receipt's re-render claim in `pdf_asks` (an id only). */
export const receiptAskKey = (receiptId: string): string => `receipt:${receiptId}`;
const CLIENT_GONE = { code: "client_gone", message: "This client's details were erased" };

/** `TH-RCT-2627-0001.pdf`: the number with its slashes changed. */
export const receiptFilename = (numberDisplay: string): string =>
  `${numberDisplay.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;

/** `/receipts/:id/pdf` and its retry. */
export const receiptPdf = new Hono<AppEnv>()
  .get("/:id/pdf", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const row = await c.env.DB.prepare(PDF_ROW_SQL).bind(id).first<{
      id: string;
      number_display: string | null;
      pdf_r2_key: string | null;
      pdf_sha256: string | null;
      frozen_at: number | null;
      gone: number;
    }>();
    if (!row || row.frozen_at === null || !row.number_display) return err(c, NOT_FOUND, 404);
    // M7.4 (Q4 A): an anonymised client's stored receipt is the Owner's and the Accountant's only.
    const refused = storedPdfRefusal(c, row.gone);
    if (refused) return refused;
    if (!row.pdf_r2_key || !row.pdf_sha256) return err(c, PDF_PENDING, 409);
    const obj = await c.env.DOCS.get(row.pdf_r2_key);
    if (!obj) return err(c, PDF_PENDING, 409);
    return new Response(obj.body, {
      headers: downloadHeaders({
        contentType: "application/pdf",
        size: obj.size,
        filename: receiptFilename(row.number_display),
        etag: row.pdf_sha256,
      }),
    });
  })
  .post("/:id/pdf/retry", param(idParam), body(z.strictObject({})), async (c) => {
    const { id } = c.req.valid("param");
    const row = await c.env.DB.prepare(PDF_ROW_SQL).bind(id).first<{
      number_display: string | null;
      pdf_sha256: string | null;
      frozen_at: number | null;
      gone: number;
    }>();
    if (!row || row.frozen_at === null) return err(c, NOT_FOUND, 404);
    if (row.pdf_sha256 !== null) return err(c, PDF_DONE, 409);
    if (row.gone === 1) return err(c, CLIENT_GONE, 409);
    // Early check 2, finding 8: the ask is claimed in `pdf_asks` (the supplier copy's claim, 0048) as the main statement, so repeated presses within 5 minutes
    // write no audit row and enqueue nothing.
    const now = Date.now();
    const done = await mutate(c, {
      main: c.env.DB.prepare(SUPPLIER_ASK_SQL).bind(receiptAskKey(id), now, now - SUPPLIER_ASK_WINDOW_MS),
      action: "receipt.pdf_retry",
      entityType: "document",
      entityId: id,
      summary: { documentId: id, number: row.number_display },
    });
    if (!done) return err(c, PDF_ASKED, 429);
    c.executionCtx.waitUntil(enqueueReceiptPdf(c.env, id));
    return c.json({ ok: true, pdf: { state: "pending" } });
  });
