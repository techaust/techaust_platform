// Security alerts, stubbed as audit rows until M2.4 sends the emails (LD4, ADM-AUTH-09). An alert row says who it is
// about (`entity_id` = the staff member) and where it came from; its summary is exactly `{ ua, country, city }`:
// never a secret, a code, a token or an IP address (the IP is in the row's own `ip` column, like every audit row).
import { auditStmt, type Guard } from "@techaust/db/log";
import { type Ctx, geo, requestInfo } from "./context.ts";

export type AlertKind = "alert.new_device" | "alert.2fa_change" | "alert.lockout";

type Who = {
  /** The member the alert is about. */
  userId: string;
  role: "owner" | "staff" | "sales" | "accountant" | null;
  /** 'system' for a lockout caused by someone typing (nobody is signed in), else the person acting. */
  actor?: { type: "staff" | "system"; id: string | null };
};

export const alertStmt = (c: Ctx, kind: AlertKind, who: Who, guard?: Guard) =>
  auditStmt(
    c.env.DB,
    {
      ...requestInfo(c),
      actorType: who.actor?.type ?? "staff",
      actorId: who.actor ? who.actor.id : who.userId,
      role: who.role,
      action: kind,
      entityType: "staff_user",
      entityId: who.userId,
      summary: { ua: c.var.ua, ...geo(c) },
    },
    guard,
  );

/** An alert for a lock that has just started on a real account (never written for unknown emails). */
export const lockoutAlert = (c: Ctx, userId: string, role: Who["role"]) =>
  alertStmt(c, "alert.lockout", { userId, role, actor: { type: "system", id: null } });
