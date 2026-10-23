// Staff security alerts to emails (ADM-AUTH-06, ADM-AUTH-09, ADM-MAIL-01, M2.4b). The admin Worker writes an alert as an audit
// row and puts only `{ kind: "staff.alert", auditId }` on the email queue; no address, name or device text leaves it. This
// consumer expands that message here, in ONE unit of work:
//   read the audit row, the member and (for a lockout) every active owner in ONE D1 batch
//   -> work out who is told what -> put ordinary `EmailMessage`s on the email queue (`sendBatch`) -> ack.
// Each email then goes through the normal email consumer (claim, suppression, staging allow-list, render, send), whose
// `email_log` row per (template, entity, recipient) makes a redelivered alert send each email once.
//
// Who is told: new device and 2FA change -> the member (active or just invited). Lockout -> the member (active or invited)
// and every active owner, each address once; a deactivated member gets none, an owner's copy still goes. Lockout emails
// are at most one an hour per person: the entity is `<user id>:<hour>`, and the alert row of a second lock stays.
import {
  countryName,
  describeUserAgent,
  type EmailMessage,
  formatIstDateTime,
  staffAlertMessage,
} from "@techaust/core";
import { logEvent } from "./log.ts";

export type StaffAlertResult = "queued" | "none" | "missing" | "ignored" | "invalid";

type AuditRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  at: number;
  summary: string | null;
};
type Member = { id: string; email: string; name: string; role: string; status: string };

const HOUR_MS = 3_600_000;
const ACTIONS = ["alert.new_device", "alert.2fa_change", "alert.lockout"] as const;
const CHANGES = ["recovery_code_used", "recovery_codes_regenerated", "reset_by_owner"] as const;
type Summary = { ua?: unknown; country?: unknown; city?: unknown; change?: unknown };

const text = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** "Kolkata, India", "India", "Kolkata" or the fallback when the request carried no location. */
function placeOf(s: Summary): string {
  const city = text(s.city);
  const country = text(s.country);
  return [city, country ? countryName(country) : undefined].filter(Boolean).join(", ") || "Unknown location";
}

export async function processStaffAlert(env: Env, body: unknown): Promise<StaffAlertResult> {
  const parsed = staffAlertMessage.safeParse(body);
  if (!parsed.success) {
    logEvent("staff_alert.invalid_message", { issues: parsed.error.issues.length });
    return "invalid";
  }
  const { auditId } = parsed.data;
  // One call: the alert row, the member it is about (read through the row's own entity_id) and, only for a lockout, the
  // active owners.
  const [audit, memberRead, ownerRead] = await env.DB.batch([
    env.DB.prepare(
      "SELECT id, action, entity_type, entity_id, at, summary FROM audit_log WHERE id = ?1",
    ).bind(auditId),
    env.DB.prepare(
      "SELECT id, email, name, role, status FROM staff_users WHERE id = (SELECT entity_id FROM audit_log WHERE id = ?1)",
    ).bind(auditId),
    env.DB.prepare(
      "SELECT id, email, name, role, status FROM staff_users WHERE role = 'owner' AND status = 'active' AND (SELECT action FROM audit_log WHERE id = ?1) = 'alert.lockout' ORDER BY id",
    ).bind(auditId),
  ]);
  const row = audit?.results[0] as AuditRow | undefined;
  if (!row) {
    logEvent("staff_alert.missing"); // acked: a row that is not there now will not be there on a retry either
    return "missing";
  }
  const action = ACTIONS.find((a) => a === row.action);
  const member = memberRead?.results[0] as Member | undefined;
  if (!action || row.entity_type !== "staff_user" || !member) {
    logEvent("staff_alert.ignored", { why: !action ? "action" : !member ? "no_member" : "entity" });
    return "ignored";
  }

  let summary: Summary = {};
  try {
    const raw: unknown = row.summary ? JSON.parse(row.summary) : {};
    if (raw && typeof raw === "object") summary = raw as Summary;
  } catch {
    // a summary that is not JSON still gives an email, without device and place
  }
  const facts = {
    time: formatIstDateTime(row.at),
    device: describeUserAgent(text(summary.ua)),
    location: placeOf(summary),
    admin_url: env.ADMIN_URL,
  };
  const live = member.status === "active" || member.status === "invited";
  const messages: EmailMessage[] = [];
  const told = new Set<string>();
  const add = (
    to: string,
    template: EmailMessage["template"],
    data: Record<string, string>,
    entity: EmailMessage["entity"],
  ) => {
    const key = to.toLowerCase();
    if (told.has(key)) return;
    told.add(key);
    messages.push({ template, to, data, entity });
  };

  if (action === "alert.new_device" && live)
    add(
      member.email,
      "staff.new_device",
      { name: member.name, ...facts },
      { type: "audit_log", id: auditId },
    );
  if (action === "alert.2fa_change" && live) {
    const change = CHANGES.find((c) => c === summary.change);
    add(
      member.email,
      "staff.2fa_change",
      { name: member.name, change: change ?? "", ...facts },
      { type: "audit_log", id: auditId },
    );
  }
  if (action === "alert.lockout") {
    const entity = { type: "staff_lockout", id: `${member.id}:${Math.floor(row.at / HOUR_MS)}` };
    if (live) add(member.email, "staff.lockout", { name: member.name, ...facts }, entity);
    for (const owner of (ownerRead?.results ?? []) as Member[])
      add(
        owner.email,
        "staff.lockout_owner",
        {
          name: owner.name,
          member_name: member.name,
          member_email: member.email,
          member_role: member.role,
          ...facts,
        },
        entity,
      );
  }

  if (messages.length === 0) {
    logEvent("staff_alert.nobody", { action });
    return "none";
  }
  await env.EMAIL_QUEUE.sendBatch(messages.map((body) => ({ body })));
  logEvent("staff_alert.queued", { action, emails: messages.length });
  return "queued";
}
