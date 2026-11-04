// SES email events (M7.2; ADM-MAIL-02, JOB-HOOK-01..03; run file docs/runs/m7.2-notifications.md B, C.3, L2, L4, L15). Pure: no zod, no I/O, so the jobs hook
// pays for no schema building (the M6.2 readers' pattern; the hook's CPU target is 5 ms p99, JOB-HOOK-03).
//
// How the events arrive (L1; docs/05 §11.1, ADR 0007): an SES configuration set publishes to the EventBridge DEFAULT bus (CONFIRMED, SES API v2
// `EventBridgeDestination.EventBusArn`: "Only the default bus is supported"); a rule sends them through an API destination to jobs `POST /ses`, with the
// connection's API-key header. The body is the EventBridge envelope: `version`, `id`, `detail-type`, `source` (`aws.ses`), `account`, `time`, `region`,
// `resources`, `detail` (CONFIRMED, SES Developer Guide "Monitoring SES events using Amazon EventBridge", its full "Email Rendering Failed" example). `detail` is
// the event-publishing record: `eventType`, `mail` (`messageId`, `tags` as name → list of values) and `bounce` / `complaint` / `delivery` (CONFIRMED for the
// Firehose and SNS records, SES Developer Guide "Contents of event data"; that the EventBridge `detail` of Delivered, Bounced and Complaint Received carries the
// same `eventType` names is UNCONFIRMED: the guide shows only the Rendering Failed `detail`, so a mismatch is refused, never guessed: see `parseSesEvent`).
//
// Only these fields are read; never a header, a subject, a diagnostic code or an address other than the bounced or complained recipients, which are lower-cased
// and used only to match our own `email_log` row inside the batch, never stored in `email_events` (Settled by the lead on the safest reading, 2026-11-01
// (08-C RB-40)).

/** The EventBridge `source` of SES events (CONFIRMED, SES Developer Guide, SES email sending status schema). */
export const SES_EVENT_SOURCE = "aws.ses";

/** At most this many recipients on a bounce or complaint (our emails have one; more is not an email we sent and is refused). */
export const SES_RECIPIENTS_MAX = 50;

export type EmailEventType = "delivery" | "bounce" | "complaint" | "other";
export type BounceKind = "permanent" | "transient" | "undetermined";

/**
 * The `detail-type` of each handled event (CONFIRMED, SES Developer Guide, "SES email sending events" table) and the `detail.eventType` it carries (UNCONFIRMED
 * for EventBridge, CONFIRMED for event publishing records: `Delivery`, `Bounce`, `Complaint`).
 */
export const SES_HANDLED = {
  "Email Delivered": { eventType: "Delivery", type: "delivery" },
  "Email Bounced": { eventType: "Bounce", type: "bounce" },
  "Email Complaint Received": { eventType: "Complaint", type: "complaint" },
} as const satisfies Record<string, { eventType: string; type: Exclude<EmailEventType, "other"> }>;

const BOUNCE_KINDS: Record<string, BounceKind> = {
  Permanent: "permanent",
  Transient: "transient",
  Undetermined: "undetermined",
};

export type SesEvent = {
  /** The EventBridge envelope `id` (`email_events.id`). */
  readonly eventId: string;
  /** The envelope `source`; anything but `aws.ses` is answered 200 and stored `wrong_env`. */
  readonly source: string;
  readonly type: EmailEventType;
  /** `detail.mail.messageId`, SES's message id (`email_log.ses_message_id`). */
  readonly messageId: string;
  /** Our `env` message tag (`detail.mail.tags.env`, one value), or null when absent or not one plain value. */
  readonly env: string | null;
  /** The envelope `time` in ms, or null when absent or unreadable (early check finding 3: a fresh event for a message we can't match yet is held). */
  readonly timeMs?: number | null;
  readonly bounce?: {
    readonly kind: BounceKind;
    readonly subType: string | null;
    readonly recipients: readonly string[];
  };
  readonly complaint?: { readonly recipients: readonly string[] };
};

/** Why an event was refused (the hook logs the reason code, never the body). */
export type SesEventProblem =
  | "not_object"
  | "event_id"
  | "source"
  | "detail_type"
  | "detail"
  | "event_type"
  | "type_mismatch"
  | "message_id"
  | "bounce"
  | "complaint"
  | "recipients";

export type ParsedSesEvent =
  | { ok: true; value: SesEvent }
  | { ok: false; error: "invalid_event"; reason: SesEventProblem };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (reason: SesEventProblem): ParsedSesEvent => ({ ok: false, error: "invalid_event", reason });

/** The EventBridge event id: a UUID in every example (CONFIRMED shape); any printable id of 1 to 128 of these characters is taken. */
const EVENT_ID = /^[A-Za-z0-9._:-]{1,128}$/;
/** SES message ids are printable ASCII without spaces (e.g. `0109018f…-000000`); at most 128 characters (`email_events.ses_message_id`). */
const MESSAGE_ID = /^[\x21-\x7e]{1,128}$/;
/** Our tag values: ASCII letters, digits, `_` and `-` (CONFIRMED, SES API v2 `MessageTag.Value`). */
const TAG_VALUE = /^[A-Za-z0-9_-]{1,32}$/;
/** A bounce sub-type such as `General` or `OnAccountSuppressionList` (CONFIRMED list, SES Developer Guide "Bounce types"); kept as received, at most 64. */
const SUB_TYPE = /^[A-Za-z0-9 _-]{1,64}$/;
/** An address we could have sent to (the transport's own rule is stricter; anything else can never match an `email_log` row and is skipped). */
const ADDRESS = /^[^\s@<>",;:()[\]\\]+@[^\s@<>",;:()[\]\\]+$/;

/**
 * The recipients of a bounce or complaint: an array of at most 50 objects with an `emailAddress` string. Addresses are lower-cased and de-duplicated; one that is
 * not an address shape is skipped (it can never match a row we sent; e.g. `Permanent/NoEmail`, "It was not possible to retrieve the recipient email address").
 */
function recipientsOf(list: unknown): string[] | null {
  if (!Array.isArray(list) || list.length > SES_RECIPIENTS_MAX) return null;
  const out = new Set<string>();
  for (const r of list) {
    if (!isObj(r) || typeof r.emailAddress !== "string") return null;
    const a = r.emailAddress.trim().toLowerCase();
    if (a.length <= 254 && ADDRESS.test(a)) out.add(a);
  }
  return [...out];
}

/** The `env` message tag: exactly one plain value, else null (an event without it is never applied: L4, L6). */
function envOf(mail: Obj): string | null {
  const tags = mail.tags;
  if (!isObj(tags)) return null;
  const v = tags.env;
  if (!Array.isArray(v) || v.length !== 1 || typeof v[0] !== "string" || !TAG_VALUE.test(v[0])) return null;
  return v[0];
}

/**
 * The envelope (already `JSON.parse`d, after the token check) to an event, else `invalid_event` with a reason code. A `detail-type` we handle must carry its own
 * `eventType` (`Email Bounced` with `Bounce`, and so on): a pair that disagrees is refused, so an unconfirmed shape is never read as another (Step 0.3). Any other
 * `detail-type` is `other` (stored `ignored_type`), with only the id and message id read. A bounce needs a known `bounceType`; both a bounce and a complaint need
 * their recipient list (at most 50).
 */
export function parseSesEvent(obj: unknown): ParsedSesEvent {
  if (!isObj(obj)) return bad("not_object");
  const eventId = obj.id;
  if (typeof eventId !== "string" || !EVENT_ID.test(eventId)) return bad("event_id");
  const source = obj.source;
  if (typeof source !== "string" || source === "" || source.length > 64) return bad("source");
  const detailType = obj["detail-type"];
  if (typeof detailType !== "string" || detailType === "" || detailType.length > 128)
    return bad("detail_type");
  const detail = obj.detail;
  if (!isObj(detail)) return bad("detail");
  const eventType = detail.eventType;
  if (typeof eventType !== "string" || eventType === "" || eventType.length > 64) return bad("event_type");
  const mail = detail.mail;
  if (!isObj(mail)) return bad("detail");
  const messageId = mail.messageId;
  if (typeof messageId !== "string" || !MESSAGE_ID.test(messageId)) return bad("message_id");
  const env = envOf(mail);
  const handled = Object.hasOwn(SES_HANDLED, detailType)
    ? SES_HANDLED[detailType as keyof typeof SES_HANDLED]
    : undefined;
  const byEventType = Object.values(SES_HANDLED).find((h) => h.eventType === eventType);
  // A handled detail-type with another eventType, or a handled eventType under another detail-type: a shape we have not confirmed (refused, never guessed).
  if ((handled && handled.eventType !== eventType) || (!handled && byEventType)) return bad("type_mismatch");
  const time = typeof obj.time === "string" && obj.time.length <= 40 ? Date.parse(obj.time) : Number.NaN;
  const base = { eventId, source, messageId, env, timeMs: Number.isFinite(time) ? time : null };
  if (!handled) return { ok: true, value: { ...base, type: "other" } };
  if (handled.type === "delivery") return { ok: true, value: { ...base, type: "delivery" } };
  if (handled.type === "bounce") {
    const b = detail.bounce;
    if (!isObj(b) || typeof b.bounceType !== "string" || !Object.hasOwn(BOUNCE_KINDS, b.bounceType))
      return bad("bounce");
    const sub = b.bounceSubType;
    if (sub !== undefined && sub !== null && (typeof sub !== "string" || !SUB_TYPE.test(sub)))
      return bad("bounce");
    const recipients = recipientsOf(b.bouncedRecipients);
    if (!recipients) return bad("recipients");
    const kind = BOUNCE_KINDS[b.bounceType] as BounceKind;
    return {
      ok: true,
      value: {
        ...base,
        type: "bounce",
        bounce: { kind, subType: typeof sub === "string" ? sub : null, recipients },
      },
    };
  }
  const c = detail.complaint;
  if (!isObj(c)) return bad("complaint");
  const recipients = recipientsOf(c.complainedRecipients);
  if (!recipients) return bad("recipients");
  return { ok: true, value: { ...base, type: "complaint", complaint: { recipients } } };
}

/**
 * What the hook does with a parsed event (C.3 step 8): an event not from `aws.ses`, or whose `env` tag is not this Worker's `ENVIRONMENT`, is `wrong_env` (one
 * AWS account sends for staging and production, hence the mandatory tag, L4, L6); a type we don't handle is `ignored_type`; else `apply`. Both are stored
 * (idempotency) and answered 200, with nothing else written.
 */
export function sesEventDisposition(
  ev: SesEvent,
  environment: string,
): "wrong_env" | "ignored_type" | "apply" {
  if (ev.source !== SES_EVENT_SOURCE || ev.env === null || ev.env !== environment) return "wrong_env";
  if (ev.type === "other") return "ignored_type";
  return "apply";
}

/** The event statuses of `email_log` by rank (L15; trigger `email_log_event_flow` and `EMAIL_EVENT_RANK_0074` in the db package, twin-tested). */
export const EMAIL_EVENT_RANK = { sent: 1, delivered: 2, bounced: 3, complained: 4 } as const;
export type EmailEventStatus = keyof typeof EMAIL_EVENT_RANK;

/** The status each handled event moves a row to. */
export const EVENT_STATUS = { delivery: "delivered", bounce: "bounced", complaint: "complained" } as const;

const rankOf = (status: string): number =>
  Object.hasOwn(EMAIL_EVENT_RANK, status) ? EMAIL_EVENT_RANK[status as EmailEventStatus] : 0;

/**
 * The row's new status for an event, or null when the event changes nothing: only a row already sent (rank ≥ 1) moves, and only up (a delivery after a bounce stays
 * bounced; a complaint after a delivery moves to complained). A row not yet sent (queued, sending), failed or skipped never takes an event.
 */
export function nextEmailStatus(old: string, type: EmailEventType): EmailEventStatus | null {
  if (type === "other") return null;
  const now = rankOf(old);
  const target = EVENT_STATUS[type];
  return now >= 1 && EMAIL_EVENT_RANK[target] > now ? target : null;
}

/**
 * The event's outcome against the row it names (the SQL CASE of `sesEventStatements` is its twin): `applied` when it moves the row up, or when a Permanent bounce
 * follows a Transient or Undetermined one on a bounced row (the row keeps `bounced` and takes the Permanent type); else `stale`. (`unknown_message`, no row with
 * that message id, is decided in SQL.)
 */
export function emailEventMove(
  old: { status: string; bounceType: string | null },
  ev: { type: EmailEventType; bounceKind?: BounceKind | null },
): "applied" | "stale" {
  if (nextEmailStatus(old.status, ev.type)) return "applied";
  if (
    ev.type === "bounce" &&
    ev.bounceKind === "permanent" &&
    old.status === "bounced" &&
    old.bounceType !== "permanent"
  )
    return "applied";
  return "stale";
}

/**
 * Whether an event stops the address (L4): a Permanent bounce is `hard_bounce`, a complaint is `complaint`; Transient and Undetermined bounces and deliveries never
 * suppress. The batch suppresses only an address that matches the `email_log` row of the event's message id (a forged event for an address we never emailed
 * suppresses nothing).
 */
export function suppressionOf(ev: Pick<SesEvent, "type" | "bounce">): "hard_bounce" | "complaint" | null {
  if (ev.type === "complaint") return "complaint";
  if (ev.type === "bounce" && ev.bounce?.kind === "permanent") return "hard_bounce";
  return null;
}

/** The recipients an event names (a bounce's or a complaint's), else none. */
export const recipientsOfEvent = (ev: Pick<SesEvent, "bounce" | "complaint">): readonly string[] =>
  ev.bounce?.recipients ?? ev.complaint?.recipients ?? [];

/**
 * The owners' bell lines of the hook (run file H, S9 to S11: staff words, drafted by the lead under the owner's delegation; `{client_code}` is filled in SQL with
 * the client's code, never a name or an address).
 */
export const SES_BELLS = {
  "email.bounced": "An email to a contact at {client_code} bounced. Emails to that address are stopped.",
  "email.complaint":
    "A contact at {client_code} marked an email as spam. Emails to that address are stopped.",
  "email.hook_token": "Email delivery updates were refused 5 times this hour (wrong token).",
} as const;
export type SesBellKind = keyof typeof SES_BELLS;

/**
 * The same bells for an address that isn't a live client contact (a lead's, a staff member's): early check answer 2, lines drafted by the lead under the
 * owner's delegation (run file, "Lead triage of the early check"). Chosen in SQL by `CASE WHEN code IS NULL`.
 */
export const SES_BELLS_NOT_CONTACT = {
  "email.bounced":
    "An email to an address that isn't a client contact bounced. Emails to that address are stopped.",
  "email.complaint":
    "Someone marked an email to an address that isn't a client contact as spam. Emails to that address are stopped.",
} as const;

/**
 * Early check finding 3: an event for a message id we can't match yet (SES can answer before our `email_log` row has its message id, e.g. an
 * `OnAccountSuppressionList` bounce, or after a failed status write) is HELD while its envelope `time` is within this of now: nothing is written and the hook
 * answers 409, which EventBridge retries (CONFIRMED at the early check, EventBridge User Guide "API destination error codes": 401, 407, 409, 429 and 5xx are
 * retried). Older, or with no readable time, it is stored `unknown_message`.
 */
export const SES_UNKNOWN_HOLD_MS = 15 * 60_000;

/** Whether an event of this time is still young enough to be held (either side of now, for a skewed clock). */
export const holdsUnknown = (ev: Pick<SesEvent, "timeMs">, now: number): boolean =>
  typeof ev.timeMs === "number" && Math.abs(now - ev.timeMs) < SES_UNKNOWN_HOLD_MS;

/**
 * The words of a suppression's reason (S13; early check finding 7): the three reasons trigger 0074 allows, and one generic label for anything older or unknown (a
 * row written before 0074 may say `bounce`). Staff words drafted by the builder for the lead ("[Placeholder]" until approved; the designer places them).
 */
export const SUPPRESSION_REASON_LABELS = {
  hard_bounce: "[Placeholder] The address bounced",
  complaint: "[Placeholder] Marked as spam",
  manual: "[Placeholder] Stopped by hand",
} as const;
export const SUPPRESSION_REASON_OTHER = "[Placeholder] Emails stopped";
export const suppressionReasonLabel = (reason: string | null | undefined): string =>
  typeof reason === "string" && Object.hasOwn(SUPPRESSION_REASON_LABELS, reason)
    ? SUPPRESSION_REASON_LABELS[reason as keyof typeof SUPPRESSION_REASON_LABELS]
    : SUPPRESSION_REASON_OTHER;
