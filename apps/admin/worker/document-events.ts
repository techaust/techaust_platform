// What happens AFTER a version is sent and its database work is committed (M4.3 decision 8): a hook, empty today.
// - M4.4 adds the PDF: it enqueues the render with `c.executionCtx.waitUntil(...)` and later sets `pdf_r2_key`, `pdf_sha256` and
//   `snapshot_r2_key` once (they may be filled in once after the freeze).
// - M4.5 adds the email to the chosen contacts through the SAME send route (no second send path).
// Until then the screen says so honestly (copy 07-O). The send route calls this after the batch has committed, never before.
import type { Ctx } from "./context.ts";

export type SendEvent = { documentId: string; groupId: string; version: number };

export function afterSend(_c: Ctx, _event: SendEvent): void {
  // Intentionally empty in M4.3.
}
