// Security alerts (ADM-AUTH-06, ADM-AUTH-09, ADM-MAIL-01). An alert is an audit row: it says who it is about (`entity_id` =
// the staff member) and where it came from. Since M2.4b it is also an email: after the row is written the Worker puts
// `{ kind: "staff.alert", auditId }` on the email queue, and the jobs Worker reads the row, the member and (for a lockout)
// the owners and sends the emails. No address, name or device text leaves this Worker, and the sign-in paths gain no D1
// read. The row's summary is `{ ua, country, city }` (a 2FA change adds `change`): never a secret, a code, a token or an IP
// address (the IP is in the row's own `ip` column, like every audit row).

import type { StaffAlertMessage } from "@techaust/core"; // types only: the zod schema stays out of this bundle
import { uuidv7 } from "@techaust/core/ids";
import { auditStmt, type Guard } from "@techaust/db/log";
import { type Ctx, geo, requestInfo } from "./context.ts";

export type AlertKind = "alert.new_device" | "alert.2fa_change" | "alert.lockout";

/** What changed on the account, for a 2FA alert. */
export type TwoFaChange = "recovery_code_used" | "recovery_codes_regenerated" | "reset_by_owner";

type Who = {
  /** The member the alert is about. */
  userId: string;
  role: "owner" | "staff" | "sales" | "accountant" | null;
  /** 'system' for a lockout caused by someone typing (nobody is signed in), else the person acting. */
  actor?: { type: "staff" | "system"; id: string | null };
  /** Only for `alert.2fa_change`. */
  change?: TwoFaChange;
};

/** An alert statement and its audit row ID (made before the batch, so the queue message can carry it). */
export type Alert = { stmt: D1PreparedStatement; id: string };

export const alertStmt = (c: Ctx, kind: AlertKind, who: Who, guard?: Guard): Alert => {
  const id = uuidv7();
  return {
    id,
    stmt: auditStmt(
      c.env.DB,
      {
        ...requestInfo(c),
        id,
        actorType: who.actor?.type ?? "staff",
        actorId: who.actor ? who.actor.id : who.userId,
        role: who.role,
        action: kind,
        entityType: "staff_user",
        entityId: who.userId,
        summary: { ua: c.var.ua, ...geo(c), ...(who.change ? { change: who.change } : {}) },
      },
      guard,
    ),
  };
};

/** An alert for a lock that has just started on a real account (never written for unknown emails). */
export const lockoutAlert = (c: Ctx, userId: string, role: Who["role"]) =>
  alertStmt(c, "alert.lockout", { userId, role, actor: { type: "system", id: null } });

/**
 * Puts one `staff.alert` message per audit ID on the email queue (one `sendBatch`), AFTER the alert rows are written and without making the
 * response wait: the send rides one `ctx.waitUntil`. A failed send never changes the answer; it writes one line with the
 * error class only (no address, no ID). The alert row stays either way (it is the security log).
 */
export function queueAlerts(c: Ctx, ids: string[]): void {
  if (!ids.length) return;
  const batch = ids.map((auditId) => ({ body: { kind: "staff.alert", auditId } satisfies StaffAlertMessage }));
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await c.env.EMAIL_QUEUE.sendBatch(batch);
      } catch (e) {
        console.error(
          JSON.stringify({
            level: "error",
            route: c.var.route?.path ?? "other",
            message: "staff alert not queued",
            rid: c.var.rid,
            cause: e instanceof Error ? e.name : "unknown",
          }),
        );
      }
    })(),
  );
}
