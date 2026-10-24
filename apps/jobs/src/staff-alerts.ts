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
// are at most one per person per clock hour (UTC): the entity is `<user id>:<hour>`, and the alert row of a second lock stays.
import {
  countryName,
  describeUserAgent,
  type EmailMessage,
  formatIstDateTime,
  staffAlertMessage,
} from "@techaust/core";
import { primeSesSigning } from "@techaust/email";
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
  // A 2FA alert must say WHAT changed (07-G has one body per change): an unknown or missing `change` is not guessed at.
  const change = CHANGES.find((c) => c === summary.change);
  if (action === "alert.2fa_change" && !change) {
    logEvent("staff_alert.ignored", { why: "change" });
    return "ignored";
  }
  const time = formatIstDateTime(row.at);
  const who = (m: Member) => ({ name: m.name, first_name: m.name.trim().split(/\s+/)[0] ?? m.name });
  // The member's own emails also carry their role: it picks 07-G's "Not you?" line (an owner gets the owner line, since
  // "Contact the owner" can't help them; everyone else the member line). The owners' lockout copy has no such line.
  const reader = (m: Member) => ({ ...who(m), role: m.role });
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

  // Only the facts each email prints. Where and on what device only for a new sign-in; a 2FA change or a lock names the time
  // alone (for an owner's reset the device in the row is the owner's, so it must never be shown to the member). The admin
  // link only in the owner's lockout email ("[Open in admin]").
  if (action === "alert.new_device" && live)
    add(
      member.email,
      "staff.new_device",
      {
        ...reader(member),
        time,
        device: describeUserAgent(text(summary.ua)),
        location: placeOf(summary),
      },
      { type: "audit_log", id: auditId },
    );
  if (action === "alert.2fa_change" && live)
    add(
      member.email,
      "staff.2fa_change",
      { ...reader(member), time, change: change ?? "" },
      { type: "audit_log", id: auditId },
    );
  if (action === "alert.lockout") {
    // One lockout email per person per CLOCK hour (UTC): the entity is `<user id>:<hours since the epoch>`, so a second lock
    // in the same clock hour sends nothing new (its audit row stays). Two locks minutes apart that straddle an hour boundary
    // are two emails: at most two in any 60 minutes.
    const entity = { type: "staff_lockout", id: `${member.id}:${Math.floor(row.at / HOUR_MS)}` };
    if (live) add(member.email, "staff.lockout", { ...reader(member), time }, entity);
    for (const owner of (ownerRead?.results ?? []) as Member[])
      add(
        owner.email,
        "staff.lockout_owner",
        { ...who(owner), member_name: member.name, time, admin_url: env.ADMIN_URL },
        entity,
      );
  }

  if (messages.length === 0) {
    logEvent("staff_alert.nobody", { action });
    return "none";
  }
  // The emails usually follow in this isolate, and the first one pays for the SES signing key: derive it now, while this unit
  // of work has room (CPU tuning 4). Not guaranteed: with `max_concurrency` above 1 a send can land in another isolate and
  // stay cold. Only when mail really goes to SES; nothing is sent.
  if (env.EMAIL_TRANSPORT === "ses")
    await primeSesSigning({
      accessKeyId: env.SES_ACCESS_KEY_ID,
      secretAccessKey: env.SES_SECRET_ACCESS_KEY,
      region: env.SES_REGION,
    });
  await env.EMAIL_QUEUE.sendBatch(messages.map((body) => ({ body })));
  logEvent("staff_alert.queued", { action, emails: messages.length });
  return "queued";
}
