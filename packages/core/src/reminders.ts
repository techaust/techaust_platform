// Payment reminders, pure (M5.4; ADM-INV-13, ADM-SET-05, LD60, LD64; VERIFY WITH CA/LEGAL for which documents are chased). No I/O, no zod, no floats.
//
// A reminder is one row per (invoice, offset in days from the due date), created when the invoice is first sent, for the days AFTER the send day only, due at the
// window's opening hour (IST). It is sent only inside the window (default 09:00 to 19:00 IST, "from" inclusive, "to" exclusive). The claim that sends one is a single
// SQL UPDATE with every stop rule in its WHERE (`REMINDER_CLAIM_SQL`, packages/db/src/billing.ts); `skipReasonOf` below is its twin, and a db test proves the two
// agree on every fact combination.
import { addDays, fromIst, istDate, parseIsoDate, toIsoDate, toIst } from "./dates.ts";

/** The documents that are chased: a tax or export invoice, a proforma (Q47) and a debit note (it is its own payable, Q30). A credit note is never chased. */
export const REMINDER_TYPES = ["tax_invoice", "export_invoice", "proforma", "debit_note"] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];
export const isReminderType = (v: unknown): v is ReminderType =>
  typeof v === "string" && (REMINDER_TYPES as readonly string[]).includes(v);

/** The statuses of a document that still owes money and can be chased. */
export const REMINDER_LIVE_STATUSES = ["issued", "partially_paid", "partially_credited"] as const;

export type ReminderWindow = { readonly fromHour: number; readonly toHour: number };
export type ReminderPolicy = {
  readonly enabled: boolean;
  /** Days from the due date, ascending, distinct. */
  readonly offsets: readonly number[];
  readonly window: ReminderWindow;
};

/** The settings' part of the policy (`payment_terms`). */
export type ReminderSettings = {
  readonly reminderOffsetsDays: readonly number[];
  readonly reminderWindowIst: ReminderWindow;
};
/** The client's own policy (`clients.reminder_policy`): `enabled` false stops every reminder, `offsetsDays` replaces the settings' offsets. */
export type ClientReminderPolicy = {
  readonly enabled?: boolean;
  readonly offsetsDays?: readonly number[];
} | null;

const distinctAscending = (xs: readonly number[]): number[] => [...new Set(xs)].sort((a, b) => a - b);

/** The policy in force for a client: the settings' offsets unless the client has its own; on unless the client turned it off. */
export function reminderPolicy(settings: ReminderSettings, client: ClientReminderPolicy): ReminderPolicy {
  const own = client?.offsetsDays;
  return {
    enabled: client?.enabled !== false,
    offsets: distinctAscending(own && own.length > 0 ? own : settings.reminderOffsetsDays),
    window: settings.reminderWindowIst,
  };
}

export type ReminderRow = { readonly offset: number; readonly dueAt: number };

/**
 * The rows to create when an invoice is first sent: one per offset whose day (the due date plus the offset, an IST calendar day) is AFTER the send day,
 * due at `fromHour` IST that day. An offset whose day is today or earlier gets no row (so an invoice sent on its due date is chased only for its later days).
 * Calendar-day arithmetic, so 31 January plus 3 is 3 February and 31 March plus 3 is 3 April.
 */
export function reminderRows(
  dueDate: string,
  offsets: readonly number[],
  fromHour: number,
  sentDayIst: string,
): ReminderRow[] {
  const due = parseIsoDate(dueDate);
  const sent = parseIsoDate(sentDayIst);
  if (!due || !sent) throw new RangeError("reminderRows: not a date");
  if (!Number.isInteger(fromHour) || fromHour < 0 || fromHour > 23)
    throw new RangeError("reminderRows: the window opens at an hour from 0 to 23");
  const out: ReminderRow[] = [];
  for (const offset of distinctAscending(offsets)) {
    const day = addDays(due, offset);
    if (toIsoDate(day) <= toIsoDate(sent)) continue;
    out.push({ offset, dueAt: fromIst(day, fromHour) });
  }
  return out;
}

/** The IST hour (0 to 23) of an instant. */
export const istHourOf = (ms: number): number => toIst(ms).hour;

/** True from the window's opening hour (inclusive) up to its closing hour (exclusive), IST. */
export function inWindow(nowMs: number, window: ReminderWindow): boolean {
  const hour = istHourOf(nowMs);
  return hour >= window.fromHour && hour < window.toHour;
}

/** `nowMs` itself while inside the window; else the next instant the window opens (today at `fromHour` if that is still ahead, else tomorrow's). */
export function nextWindowStart(nowMs: number, window: ReminderWindow): number {
  if (inWindow(nowMs, window)) return nowMs;
  const today = istDate(nowMs);
  const opening = fromIst(today, window.fromHour);
  return opening > nowMs ? opening : fromIst(addDays(today, 1), window.fromHour);
}

// ---- the stop rules, in TypeScript ---------------------------------------------------------------------------------------------------------

/** Everything the claim reads about a reminder, its document and its client. */
export type ReminderFacts = {
  readonly sentAt: number | null;
  /** The row's own skip reason (null: none, `paused`, or a final one). */
  readonly skippedReason: string | null;
  readonly dueAt: number;
  readonly frozen: boolean;
  readonly type: string;
  readonly status: string;
  readonly balanceMinor: number;
  readonly voided: boolean;
  readonly clientAnonymised: boolean;
  /** `clients.reminder_policy.enabled` is not false. */
  readonly policyEnabled: boolean;
  /** At least one live recipient: a send of the document, not cancelled, to a contact who still has portal access and is not anonymised. */
  readonly hasRecipient: boolean;
  /** A later offset of the same document is also pending and already due (the later one is the one to send). */
  readonly laterDue: boolean;
};

/**
 * Why the claim would refuse this reminder at `nowMs`, or null when it would send. The twin of `REMINDER_CLAIM_SQL` (a db test runs both over a table of facts).
 * Final reasons (everything but `paused`) are written to the row by the consumer so the scan never reads it again.
 */
export type ReminderSkipReason =
  | "sent"
  | "paused"
  | "not_due"
  | "not_issued"
  | "type"
  | "void"
  | "paid"
  | "credited"
  | "converted"
  | "status"
  | "anonymised"
  | "policy_off"
  | "no_recipient"
  | "superseded"
  | string;

export function skipReasonOf(f: ReminderFacts, nowMs: number): ReminderSkipReason | null {
  if (f.sentAt !== null) return "sent";
  if (f.skippedReason !== null) return f.skippedReason;
  if (f.dueAt > nowMs) return "not_due";
  if (!f.frozen) return "not_issued";
  if (f.voided || f.status === "void") return "void";
  if (!isReminderType(f.type)) return "type";
  if (!(REMINDER_LIVE_STATUSES as readonly string[]).includes(f.status)) {
    if (f.status === "paid") return "paid";
    if (f.status === "credited") return "credited";
    if (f.status === "converted") return "converted";
    return "status";
  }
  if (f.balanceMinor <= 0) return "paid";
  if (f.clientAnonymised) return "anonymised";
  if (!f.policyEnabled) return "policy_off";
  if (!f.hasRecipient) return "no_recipient";
  if (f.laterDue) return "superseded";
  return null;
}

/** A skip reason the consumer writes to the row (final). `sent`, `not_due` and `paused` are states, not reasons to give a row up. */
export const isFinalSkip = (reason: string | null): reason is string =>
  reason !== null && reason !== "sent" && reason !== "not_due" && reason !== "paused";
