// What the void route (`invoices.ts`) and the withdraw route (`invoice-withdraw.ts`) share (ADM-INV-02, ADM-INV-10; runs/proforma-withdraw early check
// B3 to B5): the reason field, the owner's step-up clause of the main statement, the milestone's release, and the triggers whose refusal each route
// explains with its re-read (409, never a 500). One copy each, so the two routes can't drift apart.

import { WITHDRAW_REASON_MAX } from "@techaust/core/invoices";
import * as z from "zod/mini";
import type { SideGuard } from "./context.ts";

/** The reason typed for a void or a withdrawal: trimmed, 1 to `WITHDRAW_REASON_MAX` (500) characters, the bound trigger 0056 holds for a proforma. */
export const voidReasonIn = z.string().check(z.trim(), z.minLength(1), z.maxLength(WITHDRAW_REASON_MAX));

/**
 * The owner's session with a live step-up, as one clause of the main statement: `?3` is the time of the write and `?5` the session id (both routes bind
 * them at those places).
 */
export const OWNER_STEP_UP_SQL =
  "EXISTS (SELECT 1 FROM staff_sessions s JOIN staff_users o ON o.id = s.user_id WHERE s.id = ?5 AND s.revoked_at IS NULL AND s.idle_expires_at > ?3 AND s.abs_expires_at > ?3 AND s.step_up_until > ?3 AND o.role = 'owner' AND o.status = 'active')";

/**
 * The milestone the document was made from is free for a new invoice again (L4 on a withdrawal, as on a void): back to ready to bill when the work was
 * delivered (the delivery time is kept), back to pending when it never was (an advance invoice on a pending milestone, LD12). Guarded on the audit row.
 */
export const milestoneReleaseStmt = (db: D1Database, g: SideGuard, documentId: string, t: number) =>
  db
    .prepare(
      `UPDATE milestones SET status = CASE WHEN status <> 'invoiced' THEN status WHEN delivered_at IS NULL THEN 'pending' ELSE 'ready_to_bill' END, document_id = NULL, updated_at = ?2 WHERE document_id = ?1 AND ${g.sql(3)}`,
    )
    .bind(documentId, t, ...g.params);

/**
 * The triggers that may refuse a void or a withdrawal when something lands between the read and the write (a send, a view, a payment, a child, a status
 * change): 0038's flow and pairing, 0056's proforma rule and its re-created viewed rule. Each route then explains the refusal with its own re-read.
 */
export const VOID_REFUSED = /documents_(proforma_withdraw|viewed_no_void|invoice_status_flow|void_pairing)/;
