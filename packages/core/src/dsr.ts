// The data-request clock and close rules (M7.4 B.1; ADM-SET-09, POR-11; run file docs/runs/m7.4-data-protection.md). Pure: no clock, no I/O; every
// instant is UTC milliseconds and every day an IST calendar day. Subpath export `@techaust/core/dsr` (the portal stores the clock when a contact sends a
// request, the admin API when staff log one; both check it again in the INSERT … SELECT through `requestDueAtSql`).
//
// The reply date: the end of the IST day of the EARLIER of 30 days and one calendar month after the request arrived (the month clamped to its last day), with
// no pause and no extension. It meets the published privacy page (07-A §6 "respond within 30 days"), 07-A §7 and SPDI Rule 5(9) ("within one month"), far
// inside DPDP Rule 14(3)'s 90 days. Researched 2026-11-06, DPDP Rules 2025 r.14(3); SPDI r.5(9); privacy notice 07-A §§7–8 (08-C RB-47). No pause and no
// extension; a requester who can't be identified in time is declined `identity_not_confirmed` within the period; the 48 hours are calendar hours: Settled by
// the lead on the safest reading, 2026-11-06 (08-C RB-47).
import {
  addDays,
  addMonths,
  type CalendarDate,
  daysBetween,
  fromIst,
  istDate,
  istDayEnd,
  parseIsoDate,
} from "./dates.ts";
import { REQUEST_KINDS as PORTAL_REQUEST_KINDS } from "./portal.ts";

const HOUR_MS = 3_600_000;

/**
 * Every kind of request (M7.1's five plus L9's `consent_withdrawal` and `nomination`, which 07-A §6 promises). Pinned to the trigger `client_requests_kind`
 * once M7.4's trigger migration re-creates it (A.6; until then the installed trigger, and `REQUEST_KINDS` of `./portal.ts`, hold M7.1's five).
 */
export const REQUEST_KINDS = [...PORTAL_REQUEST_KINDS, "consent_withdrawal", "nomination"] as const;
export type DsrKind = (typeof REQUEST_KINDS)[number];

/** How a request reached us (A.1 `client_requests.channel`, default `portal`; pinned to the M7.4 trigger in A). */
export const CHANNELS = ["portal", "email", "post", "phone", "in_person"] as const;
export type Channel = (typeof CHANNELS)[number];
/** The channels staff log by hand (`POST /client-requests`): every channel but the portal, whose rows the portal writes itself. */
export const STAFF_CHANNELS = ["email", "post", "phone", "in_person"] as const satisfies readonly Channel[];

/** Why a request was declined (A.1 `client_requests.decline_reason`; pinned to the M7.4 trigger in A). */
export const DECLINE_REASONS = [
  "legal_hold",
  "law_requires_keeping",
  "identity_not_confirmed",
  "duplicate",
  "not_on_record",
  "other",
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

/**
 * L28 (lead, 2026-11-06): a `data_erasure` request that names only an address (someone not yet matched to a contact or lead) can close only as declined, and
 * only for one of these reasons; staff who find the person log a new request against that record instead. Held by the close route, its SQL and the trigger.
 */
export const EMAIL_ONLY_DECLINE_REASONS = [
  "not_on_record",
  "identity_not_confirmed",
  "duplicate",
  "other",
] as const satisfies readonly DeclineReason[];

/** The audit actions a `done` erasure request may name (`action_audit_id`; the purge never fulfils one, round 4). Pinned to the M7.4 trigger in A. */
export const ERASURE_ACTIONS = ["contact.erase", "contact.anonymise", "lead.erase"] as const;

/** The acknowledgement is due 48 hours after the request arrived (`ack_due_at`). */
export const ACK_WINDOW_MS = 48 * HOUR_MS;
/** A request is "due soon" from 5 IST days before its reply date (`request.due_soon` bell, S5). */
export const DUE_SOON_DAYS = 5;

const isKnown = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);
export const isDsrKind = (v: unknown): v is DsrKind => isKnown(REQUEST_KINDS, v);
export const isChannel = (v: unknown): v is Channel => isKnown(CHANNELS, v);
export const isDeclineReason = (v: unknown): v is DeclineReason => isKnown(DECLINE_REASONS, v);

/** The IST calendar day a request's reply is due by (the earlier of +30 days and +1 calendar month, clamped). */
export function requestDueDay(receivedAtMs: number): CalendarDate {
  const day = istDate(receivedAtMs);
  const days30 = addDays(day, 30);
  const month1 = addMonths(day, 1);
  return daysBetween(days30, month1) < 0 ? month1 : days30;
}

/** `due_at`: the last millisecond (UTC ms) of the IST day the reply is due by. */
export const requestDueAt = (receivedAtMs: number): number => istDayEnd(requestDueDay(receivedAtMs));

/** `ack_due_at`: 48 hours after the request arrived. */
export function ackDueAt(receivedAtMs: number): number {
  if (!Number.isSafeInteger(receivedAtMs)) throw new RangeError(`Expected UTC milliseconds: ${receivedAtMs}`);
  return receivedAtMs + ACK_WINDOW_MS;
}

/**
 * The SQL twin of `requestDueAt` over an expression giving `received_at` (UTC ms), for the INSERT … SELECT of a request (C.2) and the A.1 backfill. SQLite's
 * `+1 month` rolls an overflowing day into the month after (31 Jan + 1 month = 3 Mar), so the clamp is the third term: the last day of the next month. ISO
 * dates compare as text, so the scalar `min` picks the earliest. A db test holds it equal to `requestDueAt` (A).
 */
export const requestDueAtSql = (receivedAtMs: string): string => {
  const day = `date(((${receivedAtMs}) + 19800000) / 1000, 'unixepoch')`;
  const due = `min(date(${day}, '+30 days'), date(${day}, '+1 month'), date(${day}, 'start of month', '+2 months', '-1 day'))`;
  return `((CAST(strftime('%s', ${due}) AS INTEGER) + 86400 - 19800) * 1000 - 1)`;
};

/**
 * `received_at` of a request staff log by hand: the start of the IST day typed ("2026-11-06"), never a future day. Null for a malformed or future date. (The
 * portal's own requests take their `created_at`.) The start of the day keeps the 48-hour acknowledgement no later than it would have been.
 */
export function loggedReceivedAt(receivedOn: string, nowMs: number): number | null {
  const day = parseIsoDate(receivedOn);
  if (day === null) return null;
  if (daysBetween(istDate(nowMs), day) > 0) return null;
  return fromIst(day);
}

/** The states a request is shown in (the inbox badge and the `state` filter, C.1). */
export const REQUEST_STATES = ["open", "ack_overdue", "due_soon", "overdue", "closed"] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

export type ClockRow = {
  readonly status: string;
  readonly dueAt: number | null;
  readonly ackDueAt: number | null;
  readonly acknowledgedAt: number | null;
};

/** Whole IST days from today to the reply day (0 on the day itself, negative once past). */
export const daysLeft = (dueAt: number, nowMs: number): number => daysBetween(istDate(nowMs), istDate(dueAt));

/** The last `due_at` that counts as "due soon" at `nowMs` (the end of the IST day 5 days ahead): the C.1 filter's bound over `client_requests_due`. */
export const dueSoonBound = (nowMs: number): number => istDayEnd(addDays(istDate(nowMs), DUE_SOON_DAYS));

/**
 * A request's state at `nowMs`. The reply date wins over the acknowledgement (overdue, then due soon, then an acknowledgement more than 48 hours late); a
 * closed request is closed. A row with no clock (none after A's backfill) is plain open.
 */
export function requestState(row: ClockRow, nowMs: number): RequestState {
  if (row.status !== "open") return "closed";
  if (row.dueAt !== null && nowMs > row.dueAt) return "overdue";
  if (row.dueAt !== null && row.dueAt <= dueSoonBound(nowMs)) return "due_soon";
  if (row.acknowledgedAt === null && row.ackDueAt !== null && nowMs > row.ackDueAt) return "ack_overdue";
  return "open";
}

export type CloseRow = {
  readonly kind: string;
  readonly status: string;
  readonly contactRef: string | null;
  readonly leadRef: string | null;
  /** When the requester's identity was checked (a portal request: when it arrived, the sign-in being the check; L42), or null. */
  readonly identityCheckedAt: number | null;
};

/**
 * L42 (Q2 A, "after checking who they are"): the kinds that close `done` only once the requester's identity is checked (the route, its SQL and the trigger
 * `client_requests_close_rules` hold the same list). Settled by the lead on the safest reading, 2026-11-06 (08-C RB-47).
 */
export const IDENTITY_CHECKED_KINDS = [
  "data_access",
  "data_correction",
  "data_erasure",
  "nomination",
] as const satisfies readonly DsrKind[];

export type CloseInput = {
  readonly outcome: "done" | "declined";
  readonly declineReason?: string | null;
  readonly actionAuditId?: string | null;
  readonly exportSentAt?: number | null;
};

export type CloseRefusal =
  | "request_closed"
  | "decline_reason_required"
  | "decline_reason_not_allowed"
  | "action_required"
  | "action_not_allowed"
  | "export_sent_not_allowed"
  | "identity_not_checked";

/**
 * Whether a close may go ahead, before the route's SQL checks it again (C.4; the trigger holds the same rules, A.6). A declined request names a known reason
 * (and only a declined one does); a `done` erasure names the audit row of the erase or anonymise that fulfilled it (the SQL then matches that row to the exact
 * contact or lead, round 4); a request naming only an address can close only as declined, for an L28 reason; "Export sent" (Q2 A) is a `done` access request's;
 * L42: a `done` access, correction, erasure or nomination request needs its identity check (`IDENTITY_CHECKED_KINDS`).
 * Who may close (Owner only for the data-rights kinds) is `requests.close`, not this.
 */
export function closeVerdict(
  row: CloseRow,
  input: CloseInput,
): { ok: true } | { ok: false; code: CloseRefusal } {
  const no = (code: CloseRefusal) => ({ ok: false as const, code });
  if (row.status !== "open") return no("request_closed");
  const reason = input.declineReason ?? null;
  const action = input.actionAuditId ?? null;
  const exportSent = input.exportSentAt ?? null;
  const unmatched = row.contactRef === null && row.leadRef === null;
  if (input.outcome === "declined") {
    if (reason === null) return no("decline_reason_required");
    if (!isDeclineReason(reason)) return no("decline_reason_not_allowed");
    if (row.kind === "data_erasure" && unmatched && !isKnown(EMAIL_ONLY_DECLINE_REASONS, reason))
      return no("decline_reason_not_allowed");
    if (action !== null) return no("action_not_allowed");
    if (exportSent !== null) return no("export_sent_not_allowed");
    return { ok: true };
  }
  if (reason !== null) return no("decline_reason_not_allowed");
  // L42: an access, correction, erasure or nomination request is fulfilled only for a requester whose identity was checked.
  if (isKnown(IDENTITY_CHECKED_KINDS, row.kind) && row.identityCheckedAt === null)
    return no("identity_not_checked");
  if (row.kind === "data_erasure") {
    // L28: an address-only erasure request is never `done` (nothing in our records was erased against it).
    if (unmatched) return no("action_not_allowed");
    if (action === null || action.length === 0) return no("action_required");
  }
  if (
    exportSent !== null &&
    (row.kind !== "data_access" || !Number.isSafeInteger(exportSent) || exportSent < 0)
  )
    return no("export_sent_not_allowed");
  return { ok: true };
}
