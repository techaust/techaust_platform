// Staff notification emails (M7.2; ADM-G-09; run file docs/runs/m7.2-notifications.md B, D, L9, L10, L11; owner's answers Q1 A and Q2 A, 2026-11-01). Pure.
// A bell row of an emailed kind becomes one email to its member when that member's switch for the kind's group is on. The emails are expanded in jobs from a
// `staff.notify` message that carries ids only (the M2.4b rule: never an address, a name or a title), and today's emails stay as they are (L10).

/** The switch groups, each a column of `staff_notification_prefs` (the Notifications page's toggles). */
export const PREF_GROUPS = ["offerViewed", "paymentReceived", "approvals", "hookFailed"] as const;
export type PrefGroup = (typeof PREF_GROUPS)[number];

/**
 * The bell kinds that are also emailed, by group (B): a client opened a proposal or estimate (Q2 A: off unless switched on), an online payment arrived, a payment
 * waits for the Owner's check, and a payment or email connection failed (Q1 A). Any other bell is never emailed by `staff.notify`.
 */
export const EMAILED_BELLS = {
  "offer.viewed": "offerViewed",
  "payment.online": "paymentReceived",
  "payment.verify": "approvals",
  "payment.review": "hookFailed",
  "payment.hook_signature": "hookFailed",
  "email.hook_token": "hookFailed",
} as const satisfies Record<string, PrefGroup>;
export type EmailedBell = keyof typeof EMAILED_BELLS;
export const EMAILED_BELL_KINDS = Object.keys(EMAILED_BELLS) as [EmailedBell, ...EmailedBell[]];

export const isEmailedBell = (kind: unknown): kind is EmailedBell =>
  typeof kind === "string" && Object.hasOwn(EMAILED_BELLS, kind);

/** A member's switches as the db row holds them (0/1), or null when the member has no row yet. */
export type PrefsRow = {
  digest_weekly: number;
  email_offer_viewed: number;
  email_payment_received: number;
  email_approvals: number;
  email_hook_failed: number;
};

export type Prefs = { digestWeekly: boolean } & Record<PrefGroup, boolean>;

/** The defaults of a missing row (Q1 A, Q2 A): the digest on, "a client opened" off, the rest on. The column defaults of 0073 are the same (db test). */
export const PREF_DEFAULTS: PrefsRow = {
  digest_weekly: 1,
  email_offer_viewed: 0,
  email_payment_received: 1,
  email_approvals: 1,
  email_hook_failed: 1,
};

/**
 * A member's switches. A missing row reads as the defaults. The weekly digest goes to owners only (L7), so it reads off for every other role whatever the row
 * says (a member whose role changed keeps the row; the admin refuses turning it on with 403 `digest_owner_only`).
 */
export function prefsOf(row: PrefsRow | null, role: string): Prefs {
  const r = row ?? PREF_DEFAULTS;
  return {
    digestWeekly: role === "owner" && r.digest_weekly === 1,
    offerViewed: r.email_offer_viewed === 1,
    paymentReceived: r.email_payment_received === 1,
    approvals: r.email_approvals === 1,
    hookFailed: r.email_hook_failed === 1,
  };
}

/** Whether a member with these switches gets the email of a bell of `kind`. */
export const wantsEmail = (prefs: Prefs, kind: string): boolean =>
  isEmailedBell(kind) && prefs[EMAILED_BELLS[kind]];

/** The `staff.notify` message on the email queue (L9): the bell's kind and the entity id its rows carry (`notifications.entity_id`), nothing else. */
export type StaffNotifyMessage = { kind: "staff.notify"; bell: EmailedBell; entityId: string };

/**
 * The consumer's reader of a `staff.notify` body: exactly the three keys, an emailed bell kind and an entity id of 1 to 128 characters, else null (a producer that
 * adds an address or a title is refused). A plain reader, not a zod schema: the jobs Worker carries classic zod only, and `zod/mini` would add about 100 KB and
 * 35 ms of start-up to it (measured at the M7.2 early check; worker-budget).
 */
export function parseStaffNotify(body: unknown): StaffNotifyMessage | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 3 || !keys.every((k) => k === "kind" || k === "bell" || k === "entityId")) return null;
  if (o.kind !== "staff.notify" || !isEmailedBell(o.bell)) return null;
  if (typeof o.entityId !== "string" || o.entityId.length < 1 || o.entityId.length > 128) return null;
  return { kind: "staff.notify", bell: o.bell, entityId: o.entityId };
}

/** Builds the message (the shape the consumer parses). */
export const staffNotify = (bell: EmailedBell, entityId: string): StaffNotifyMessage => ({
  kind: "staff.notify",
  bell,
  entityId,
});

export const isStaffNotifyKind = (body: unknown): boolean =>
  typeof body === "object" && body !== null && (body as { kind?: unknown }).kind === "staff.notify";

/**
 * The `notifications.entity_type` each emailed bell is written with (so the expansion reads its rows on the index `notifications_entity (entity_type,
 * entity_id)`): the producers' own values (db `gateway.ts`, `ledger.ts`, `email-events.ts`; portal `offer-sql.ts`).
 */
export const BELL_ENTITY_TYPES = {
  "offer.viewed": "document",
  "payment.online": "payment",
  "payment.verify": "payment",
  "payment.review": "review_item",
  "payment.hook_signature": "hook_window",
  "email.hook_token": "hook_window",
} as const satisfies Record<EmailedBell, string>;

/** The admin page of a member's switches (Your account › Notifications; the designer's route; the emails' "Change notification settings" link). */
export const NOTIFICATIONS_PATH = "/account/notifications";

const exactKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => {
  const k = Object.keys(o);
  return k.length === keys.length && k.every((x) => keys.includes(x));
};
const objOf = (body: unknown): Record<string, unknown> | null =>
  typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
const isMs = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Q3 A: the hourly tick's scan of unfinished staff sign-ins (`asOf` the tick's time). Plain reader (no zod in the jobs bundle's hot path). */
export type SigninUnfinishedMessage = { v: 1; kind: "signin.unfinished"; asOf: number };
export function parseSigninUnfinished(body: unknown): SigninUnfinishedMessage | null {
  const o = objOf(body);
  if (
    !o ||
    !exactKeys(o, ["v", "kind", "asOf"]) ||
    o.v !== 1 ||
    o.kind !== "signin.unfinished" ||
    !isMs(o.asOf)
  )
    return null;
  return { v: 1, kind: "signin.unfinished", asOf: o.asOf };
}
export const isSigninUnfinishedKind = (body: unknown): boolean => objOf(body)?.kind === "signin.unfinished";

/**
 * The hourly safety net of the staff notification emails: the emailed bells written since `since` (any producer: a lost `waitUntil`, a portal capture, a hook
 * failure) are expanded again; the email log's entity (the bell row and the recipient) makes a repeat send nothing twice.
 */
export type BellsSweepMessage = { v: 1; kind: "bells.sweep"; since: number };
export function parseBellsSweep(body: unknown): BellsSweepMessage | null {
  const o = objOf(body);
  if (!o || !exactKeys(o, ["v", "kind", "since"]) || o.v !== 1 || o.kind !== "bells.sweep" || !isMs(o.since))
    return null;
  return { v: 1, kind: "bells.sweep", since: o.since };
}
export const isBellsSweepKind = (body: unknown): boolean => objOf(body)?.kind === "bells.sweep";

/** Q4 A (run file D, "Refund email"): a refund that reached `succeeded`; ids only. */
export type RefundNotifyMessage = { kind: "refund.notify"; refundId: string };
export function parseRefundNotify(body: unknown): RefundNotifyMessage | null {
  const o = objOf(body);
  if (!o || !exactKeys(o, ["kind", "refundId"]) || o.kind !== "refund.notify") return null;
  if (typeof o.refundId !== "string" || o.refundId.length < 1 || o.refundId.length > 64) return null;
  return { kind: "refund.notify", refundId: o.refundId };
}
export const refundNotify = (refundId: string): RefundNotifyMessage => ({ kind: "refund.notify", refundId });
export const isRefundNotifyKind = (body: unknown): boolean => objOf(body)?.kind === "refund.notify";
