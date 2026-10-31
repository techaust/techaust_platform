// The session behind a refused finance batch (M6.1; early check 2, quality note): one helper for the payment routes (`payments.ts`) and the ledger routes
// (`payment-ledger.ts`), which each had their own copy. A batch whose WHERE holds the authority in SQL refuses silently when the session ended or its fresh
// code lapsed between the guard and the write; one read here says which, so a person is told to sign in only when that is the cause.
import { actor, type Ctx, err, STEP_UP_REQUIRED, UNAUTHENTICATED } from "./context.ts";

/**
 * Signed out, idle or past the absolute limit (401 `unauthenticated`); no fresh code when `needsStepUp` (403 `step_up_required`); else null, and the caller
 * answers with its own cause (`stale_version`, `ledger_changed`, ...). Never a bare 401 for a cause that is not the session.
 */
export async function sessionRefusal(c: Ctx, needsStepUp: boolean): Promise<Response | null> {
  const t = Date.now();
  const s = await c.env.DB.prepare(
    "SELECT (idle_expires_at > ?2 AND abs_expires_at > ?2) AS live, step_up_until FROM staff_sessions WHERE id = ?1 AND revoked_at IS NULL",
  )
    .bind(actor(c).sessionId, t)
    .first<{ live: number; step_up_until: number | null }>();
  if (s?.live !== 1) return err(c, UNAUTHENTICATED, 401);
  if (needsStepUp && (s.step_up_until === null || s.step_up_until <= t)) return err(c, STEP_UP_REQUIRED, 403);
  return null;
}
