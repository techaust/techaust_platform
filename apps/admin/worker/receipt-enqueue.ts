// M6.5 (L3, L5; ADM-PAY-09; run file C "Every path that confirms money enqueues the receipt"): after a batch that confirmed money received, `receipt.issue
// {paymentId}` goes on `PDF_QUEUE`; the jobs consumer calls the invoices Worker's `BillingJobs.issueReceipt` (its own batch, never inside the confirm batch, so
// those batches gain no statements). Best effort: a missing binding or a failed send is logged by code only, and the hourly `receipt.sweep` issues the receipt of
// every confirmed payment still without one 10 minutes after its confirmation. The binding is read by name (the finance and invoices Workers bind PDF_QUEUE; the
// start-up dry run's made-up env does not), never cast.
import type { ReceiptIssueMessage } from "@techaust/core/pdf-jobs";

/** Sends `receipt.issue` for `paymentId`; answers whether it was sent. */
export async function enqueueReceipt(env: object, paymentId: string): Promise<boolean> {
  const queue: unknown = Reflect.get(env, "PDF_QUEUE");
  const send: unknown = typeof queue === "object" && queue !== null ? Reflect.get(queue, "send") : undefined;
  if (typeof send !== "function" || paymentId.length < 1 || paymentId.length > 60) {
    console.log(JSON.stringify({ ev: "receipt", m: "not_enqueued", code: "no_queue" }));
    return false;
  }
  try {
    await Reflect.apply(send, queue, [
      { v: 1, kind: "receipt.issue", paymentId } satisfies ReceiptIssueMessage,
    ]);
    return true;
  } catch {
    console.log(JSON.stringify({ ev: "receipt", m: "not_enqueued", code: "send_failed" }));
    return false;
  }
}
