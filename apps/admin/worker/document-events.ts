// What happens AFTER a version is sent and its database work is committed (M4.3 decision 8).
// - M4.4: the PDF. The send route enqueues `pdf.snapshot` here (through `waitUntil`, after the batch); the jobs Worker writes the R2 envelope,
//   renders the PDF and sets `snapshot_r2_key`, `pdf_r2_key` and `pdf_sha256` once (they may be filled in once after the freeze). A queue
//   that cannot be reached never fails the send: the daily sweep and the "make the PDF again" route (document-pdf.ts) pick the document up.
// - M4.5: the email to the chosen contacts goes through the SAME send route (no second send path), but not from here: the send writes its
//   `document_sends` rows in its own batch, and the jobs Worker queues each `offer.send` once the PDF is stored (`onRendered`), so no email
//   ever goes out before the PDF exists. The approval emails are `notifyApproval` below.
// The send route calls this after the batch has committed, never before.
import type { PdfSnapshotMessage, PdfSnapshotReason } from "@techaust/core/pdf-jobs";
import type { Ctx } from "./context.ts";

export type SendEvent = { documentId: string; groupId: string; version: number };

/** Puts one `pdf.snapshot` message on the PDF queue. Never throws: a failure is logged (ids only) and the sweep catches up. */
export async function enqueuePdf(
  env: Pick<Env, "PDF_QUEUE">,
  documentId: string,
  reason: PdfSnapshotReason,
): Promise<boolean> {
  try {
    await env.PDF_QUEUE.send({ v: 1, kind: "pdf.snapshot", documentId, reason } satisfies PdfSnapshotMessage);
    return true;
  } catch (e) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "pdf enqueue failed",
        cause: e instanceof Error ? e.name : "unknown",
      }),
    );
    return false;
  }
}

export function afterSend(c: Ctx, event: SendEvent): void {
  c.executionCtx.waitUntil(enqueuePdf(c.env, event.documentId, "send"));
}

/**
 * M5.1: after an invoice is issued and its batch is committed, the PDF is requested the same way (`pdf.snapshot` through `waitUntil`; the reason is
 * "send", the label a message already validates, so the queue consumer needs no change to accept it). A queue that cannot be reached never fails
 * the issue: the daily sweep and the "make the PDF again" route pick the document up.
 */
export function afterIssue(c: Ctx, event: { documentId: string }): void {
  c.executionCtx.waitUntil(enqueuePdf(c.env, event.documentId, "send"));
}

/**
 * The two approval emails of 07 §8 (M4.5, ADM-APR-01): the owners are told of a request, the requester of the decision. ONE message with the
 * approval's id only (no address, name or reason leaves this Worker); the jobs Worker reads the rows and queues the emails. After the answer,
 * through `waitUntil`: a queue that fails is logged and never fails the request (the bell, written in the same batch, still rings).
 */
export function notifyApproval(c: Ctx, approvalId: string, event: "requested" | "decided"): void {
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await c.env.EMAIL_QUEUE.send({ kind: "approval.notify", approvalId, event });
      } catch (e) {
        console.error(
          JSON.stringify({
            level: "error",
            message: "approval email not queued",
            cause: e instanceof Error ? e.name : "unknown",
          }),
        );
      }
    })(),
  );
}
