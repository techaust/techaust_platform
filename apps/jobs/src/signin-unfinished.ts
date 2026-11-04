// The unfinished staff sign-in alert (M7.2, Q3 A, owner 2026-11-01; run file docs/runs/m7.2-notifications.md, "Lead triage of the early check"). Tier A ground
// (staff auth). The hourly tick queues `signin.unfinished {asOf}` and reads nothing; this consumer, on the leads queue before the lead fall-through, is ONE unit:
//   ONE batch: at most 50 `staff_signin_pending` rows not yet notified and older than the challenge's lifetime (so a sign-in that can still be finished is never
//   reported), with their members; and the delete of notified rows older than a day
//   -> per ACTIVE member, one `staff.signin_unfinished` email, entity `signin_unfinished:<userId>:<IST hour>` (at most one an hour per member, however many
//      unfinished attempts the hour saw)
//   -> the emails queued FIRST, then ONE batch: the owners' bells under the same key, and the rows marked notified (an inactive member's rows too: no email,
//      no bell, never read again). A failure after the send retries the message; the email log's entity and the bells' unique key make the repeat send nothing twice.
import type { EmailMessage } from "@techaust/core";
import { SIGNIN_UNFINISHED_COPY } from "@techaust/core/copy-zq";
import { formatIstDateTime } from "@techaust/core/dates";
import { parseSigninUnfinished } from "@techaust/core/notifications";
import { firstNameOf } from "@techaust/core/offers";
import {
  SIGNIN_CHALLENGE_TTL_MS,
  type SigninPendingRow,
  signinNotifiedStatements,
  signinScanStatements,
} from "@techaust/db/signin-pending";
import { logEvent } from "./log.ts";
import { sendChunked } from "./send-batch.ts";

const IST_OFFSET_MS = 330 * 60_000;
/** The IST clock hour of `ms` as `YYYY-MM-DDTHH` (the email's and the bell's key). */
export const istHourKey = (ms: number): string => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 13);

export type SigninUnfinishedResult = "queued" | "none" | "invalid";

export async function processSigninUnfinished(
  env: Pick<Env, "DB" | "EMAIL_QUEUE">,
  body: unknown,
  now = Date.now(),
): Promise<SigninUnfinishedResult> {
  const m = parseSigninUnfinished(body);
  if (!m) {
    logEvent("signin_unfinished.invalid_message");
    return "invalid";
  }
  const [read] = await env.DB.batch(signinScanStatements(env.DB, now, SIGNIN_CHALLENGE_TTL_MS));
  const rows = (read?.results ?? []) as SigninPendingRow[];
  if (rows.length === 0) return "none";
  const hour = istHourKey(now);
  const byMember = new Map<string, SigninPendingRow>();
  for (const r of rows) if (r.status === "active" && !byMember.has(r.user_id)) byMember.set(r.user_id, r);
  const messages: EmailMessage[] = [...byMember.values()].map((r) => ({
    template: "staff.signin_unfinished",
    to: r.email,
    data: { first_name: firstNameOf(r.name), time: formatIstDateTime(r.at), role: r.role },
    entity: { type: "signin_unfinished", id: `${r.user_id}:${hour}` },
  }));
  // Enqueue first, then mark (the lead's triage): a lost mark repeats the send, which the email log makes a no-op; a lost send is never marked done.
  if (messages.length > 0) await sendChunked(env.EMAIL_QUEUE, messages);
  await env.DB.batch(
    signinNotifiedStatements(
      env.DB,
      now,
      rows.map((r) => r.id),
      [...byMember.values()].map((r) => ({
        key: `${r.user_id}:${hour}`,
        title: SIGNIN_UNFINISHED_COPY.bell(r.name),
      })),
    ),
  );
  logEvent("signin_unfinished.queued", { rows: rows.length, emails: messages.length });
  return messages.length > 0 ? "queued" : "none";
}
