// The owners' weekly digest (M7.2; JOB-CRON-03, ADM-DASH-02; run file docs/runs/m7.2-notifications.md D, L7, L8). On the leads queue, routed before the lead
// fall-through. The hourly tick queues `digest.weekly {weekStart}` on IST Mondays at 09:00, 10:00 and 11:00 (the FX-1 repeat pattern) and reads nothing; this
// consumer is ONE unit of work:
//   ONE batch: the active owners whose digest is on (a missing prefs row is on), and `digestStatements` (the dashboard's own SQL, aggregates only)
//   -> one `digest.weekly` email per owner, entity `{type: "digest", id: "<userId>:<weekStart>"}`, so a repeat tick sends nothing twice
//   -> one `EMAIL_QUEUE` send (chunked).
// The email goes from no-reply@ (Reply-To contact@) on `SES_MARKETING_CONFIGURATION_SET` with the RFC 8058 headers (the consumer adds both for the
// non-transactional template only, C.4), inside 09:00 to 19:00 IST by construction. A week whose Monday isn't the message's is skipped (a very late message).
import type { EmailMessage } from "@techaust/core";
import { formatDate, parseIsoDate } from "@techaust/core/dates";
import { digestDataOf, digestWeekOf, parseDigestMessage } from "@techaust/core/digest";
import { NOTIFICATIONS_PATH } from "@techaust/core/notifications";
import { digestFiguresOf, digestStatements, digestWindowOf } from "@techaust/db/digest";
import { logEvent } from "./log.ts";
import { sendChunked } from "./send-batch.ts";
import { unsubscribeToken, unsubscribeUrl } from "./unsubscribe.ts";

/** The owners the digest goes to: active, role owner, the switch on or no row yet (the default is on). At most 20 (a handful in practice). */
export const DIGEST_OWNERS_SQL = `SELECT u.id, u.email FROM staff_users u
   LEFT JOIN staff_notification_prefs p ON p.user_id = u.id
   WHERE u.role = 'owner' AND u.status = 'active' AND coalesce(p.digest_weekly, 1) = 1
   ORDER BY u.id LIMIT 20`;

export type DigestResult = "queued" | "none" | "invalid" | "stale_week";

type DigestEnv = Pick<Env, "DB" | "EMAIL_QUEUE" | "ADMIN_URL" | "PUBLIC_HOOKS_URL"> & {
  UNSUBSCRIBE_KEY?: string;
};

export async function processDigest(env: DigestEnv, body: unknown, now = Date.now()): Promise<DigestResult> {
  const m = parseDigestMessage(body);
  if (!m) {
    logEvent("digest.invalid_message");
    return "invalid";
  }
  if (digestWeekOf(now).weekStart !== m.weekStart) {
    logEvent("digest.stale_week");
    return "stale_week";
  }
  const [owners, ...figures] = await env.DB.batch([
    env.DB.prepare(DIGEST_OWNERS_SQL),
    ...digestStatements(env.DB, digestWindowOf(now)),
  ]);
  const list = (owners?.results ?? []) as { id: string; email: string }[];
  if (list.length === 0) {
    logEvent("digest.nobody");
    return "none";
  }
  const monday = parseIsoDate(m.weekStart);
  const data = digestDataOf(digestFiguresOf(figures), {
    label: monday ? formatDate(monday) : m.weekStart,
  });
  const admin = env.ADMIN_URL.replace(/\/+$/, "");
  const secret =
    typeof env.UNSUBSCRIBE_KEY === "string" && env.UNSUBSCRIBE_KEY !== "" ? env.UNSUBSCRIBE_KEY : null;
  // Without the key the email still goes, with the footer's switch-off link but no one-click header (logged; the config guard requires the key on staging).
  if (!secret) logEvent("digest.no_unsubscribe_key");
  const messages: EmailMessage[] = [];
  for (const o of list) {
    const token = secret ? await unsubscribeToken(secret, o.id) : null;
    messages.push({
      template: "digest.weekly",
      to: o.email,
      data: {
        ...data,
        dashboard_url: `${admin}/`,
        settings_url: `${admin}${NOTIFICATIONS_PATH}`,
        unsubscribe_url: token ? unsubscribeUrl(env.PUBLIC_HOOKS_URL, token) : "",
      },
      entity: { type: "digest", id: `${o.id}:${m.weekStart}` },
    });
  }
  await sendChunked(env.EMAIL_QUEUE, messages);
  logEvent("digest.queued", { emails: messages.length });
  return "queued";
}
