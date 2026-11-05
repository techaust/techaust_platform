// Staff notification emails (M7.2; ADM-G-09; run file docs/runs/m7.2-notifications.md D, L9, L10; owner's answers Q1 A and Q2 A). Routed from queue.ts on the
// email queue BEFORE the generic path, so a body of this family (valid or not) is never sent as an email.
//   - `staff.notify {bell, entityId}` (ids only, the M2.4b rule): ONE read of that bell's rows with their members and switches (index `notifications_entity`),
//     then one `staff.notification` email per bell row whose member is active and has the kind's group on, entity `{type: "notification", id: <bell row id>}`,
//     so a redelivery or a second expansion sends nothing twice. The subject is the bell's own approved title; the button is `ADMIN_URL` + the bell's link.
//   - `bells.sweep {since}` (the hourly tick, on the leads queue): the emailed bells written since `since` and not yet expanded (at most 50 distinct bells, one
//     seek of `notifications_user_created` per active member; review 1 finding 9: a bell with an emailed row is skipped), each queued again as `staff.notify`. The safety net for a producer whose send was lost (a route's
//     `waitUntil`) or that has none (a PayPal capture on the portal's return, a hook-signature window).
//   - `notifyRecentBells`: the same read for the bells a just-finished gateway RPC wrote (jobs' gateway consumer), so a webhook's payment or review emails go at once.
// Nothing here reads an address from a message, and nothing is logged but kinds and counts.
import type { EmailMessage } from "@techaust/core";
import { PREF_GROUP_LABELS } from "@techaust/core/copy-zq";
import {
  BELL_ENTITY_TYPES,
  EMAILED_BELL_KINDS,
  EMAILED_BELLS,
  NOTIFICATIONS_PATH,
  type PrefsRow,
  parseBellsSweep,
  parseStaffNotify,
  prefsOf,
  staffNotify,
  wantsEmail,
} from "@techaust/core/notifications";
import { firstNameOf } from "@techaust/core/offers";
import { logEvent } from "./log.ts";
import { sendChunked } from "./send-batch.ts";

/** At most this many bell rows a message (one per member; a bell rings the owners and at most one sender). */
export const NOTIFY_ROWS_MAX = 50;
/** At most this many distinct bells a sweep re-queues. */
export const SWEEP_BELLS_MAX = 50;
/** The hourly sweep looks back this far (the hour plus a margin for a late tick). */
export const SWEEP_LOOKBACK_MS = 75 * 60_000;
/** A just-finished RPC's bells: those written since its start, less this margin (the D1 clock and the Worker's may differ a little). */
export const RECENT_MARGIN_MS = 60_000;

/** The bell's rows with their members (active only) and switches (a missing row reads as the defaults). */
export const NOTIFY_ROWS_SQL = `SELECT n.id, n.title, n.link, u.email, u.name, u.role,
     p.digest_weekly, p.email_offer_viewed, p.email_payment_received, p.email_approvals, p.email_hook_failed
   FROM notifications n INDEXED BY notifications_entity
   JOIN staff_users u ON u.id = n.user_id AND u.status = 'active'
   LEFT JOIN staff_notification_prefs p ON p.user_id = u.id
   WHERE n.entity_type = ?1 AND n.entity_id = ?2 AND n.kind = ?3
   ORDER BY n.id LIMIT ${NOTIFY_ROWS_MAX}`;

/**
 * The emailed bells written since `?1` (one seek of `notifications_user_created` per active member), distinct by kind and entity, that have not been expanded
 * yet (review 1, finding 9): a bell any of whose rows already has its `staff.notification` email logged (`email_log_entity`, entity `notification:<row id>`)
 * is skipped, so the hourly sweep and a gateway call's `notifyRecentBells` don't queue the same bell's `staff.notify` again and again. A bell nobody wants
 * emailed has no logged row and is listed until it leaves the window (at most two sweeps); the consumer's switches decide, and sends nothing.
 */
export const RECENT_BELLS_SQL = `SELECT DISTINCT n.kind, n.entity_id FROM staff_users u
   JOIN notifications n INDEXED BY notifications_user_created ON n.user_id = u.id AND n.created_at >= ?1
   WHERE u.status = 'active' AND n.kind IN (${EMAILED_BELL_KINDS.map((k) => `'${k}'`).join(", ")})
     AND NOT EXISTS (SELECT 1 FROM notifications n2 INDEXED BY notifications_entity
                     JOIN email_log e ON e.entity_type = 'notification' AND e.entity_id = n2.id
                     WHERE n2.entity_type = n.entity_type AND n2.entity_id = n.entity_id AND n2.kind = n.kind)
   LIMIT ${SWEEP_BELLS_MAX}`;

type NotifyRow = PrefsRow & {
  id: string;
  title: string;
  link: string;
  email: string;
  name: string;
  role: string;
};
type PrefsCols = { [K in keyof PrefsRow]: number | null };

/** The member's switches from the LEFT JOIN: null columns mean no row (the defaults). */
const prefsRowOf = (r: PrefsCols): PrefsRow | null =>
  r.digest_weekly === null
    ? null
    : {
        digest_weekly: r.digest_weekly,
        email_offer_viewed: r.email_offer_viewed ?? 0,
        email_payment_received: r.email_payment_received ?? 0,
        email_approvals: r.email_approvals ?? 0,
        email_hook_failed: r.email_hook_failed ?? 0,
      };

const adminLink = (env: Pick<Env, "ADMIN_URL">, path: string): string =>
  `${env.ADMIN_URL.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;

export type StaffNotifyResult = "queued" | "none" | "invalid";

/** One `staff.notify` message: the emails of one bell. */
export async function processStaffNotify(
  env: Pick<Env, "DB" | "EMAIL_QUEUE" | "ADMIN_URL">,
  body: unknown,
): Promise<StaffNotifyResult> {
  const m = parseStaffNotify(body);
  if (!m) {
    logEvent("staff_notify.invalid_message");
    return "invalid";
  }
  const rows = ((
    await env.DB.prepare(NOTIFY_ROWS_SQL)
      .bind(BELL_ENTITY_TYPES[m.bell], m.entityId, m.bell)
      .all<NotifyRow & PrefsCols>()
  ).results ?? []) as (NotifyRow & PrefsCols)[];
  const group = PREF_GROUP_LABELS[EMAILED_BELLS[m.bell]];
  const settings = adminLink(env, NOTIFICATIONS_PATH);
  const messages: EmailMessage[] = rows
    .filter((r) => wantsEmail(prefsOf(prefsRowOf(r), r.role), m.bell))
    .map((r) => ({
      template: "staff.notification",
      to: r.email,
      data: {
        first_name: firstNameOf(r.name),
        title: r.title,
        url: adminLink(env, r.link),
        group,
        settings_url: settings,
      },
      entity: { type: "notification", id: r.id },
    }));
  if (messages.length === 0) {
    logEvent("staff_notify.nobody", { bell: m.bell, rows: rows.length });
    return "none";
  }
  await sendChunked(env.EMAIL_QUEUE, messages);
  logEvent("staff_notify.queued", { bell: m.bell, emails: messages.length });
  return "queued";
}

/** The emailed bells written since `since`, each queued as `staff.notify` (one message each). Returns how many were queued. */
export async function notifyRecentBells(
  env: Pick<Env, "DB" | "EMAIL_QUEUE">,
  since: number,
): Promise<number> {
  const found = ((
    await env.DB.prepare(RECENT_BELLS_SQL).bind(since).all<{ kind: string; entity_id: string }>()
  ).results ?? []) as { kind: string; entity_id: string }[];
  const out = found.flatMap((b) => {
    const msg = parseStaffNotify(staffNotify(b.kind as never, b.entity_id));
    return msg ? [msg] : [];
  });
  if (out.length > 0) await sendChunked(env.EMAIL_QUEUE, out);
  return out.length;
}

/** The hourly `bells.sweep`. */
export async function processBellsSweep(env: Pick<Env, "DB" | "EMAIL_QUEUE">, body: unknown): Promise<void> {
  const m = parseBellsSweep(body);
  if (!m) {
    logEvent("bells_sweep.invalid_message");
    return;
  }
  const n = await notifyRecentBells(env, m.since);
  logEvent("bells_sweep.queued", { bells: n });
}
