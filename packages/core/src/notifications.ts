// Staff notification emails (M7.2; ADM-G-09; run file docs/runs/m7.2-notifications.md B, D, L9, L10, L11; owner's answers Q1 A and Q2 A, 2026-11-01). Pure.
// A bell row of an emailed kind becomes one email to its member when that member's switch for the kind's group is on. The emails are expanded in jobs from a
// `staff.notify` message that carries ids only (the M2.4b rule: never an address, a name or a title), and today's emails stay as they are (L10).
import * as z from "zod/mini";

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

/**
 * The `staff.notify` message on the email queue (L9): the bell's kind and the entity id its rows carry (`notifications.entity_id`), nothing else. Strict, so a
 * producer that adds an address or a title is refused by the consumer.
 */
export const staffNotifyMessage = z.strictObject({
  kind: z.literal("staff.notify"),
  bell: z.enum(EMAILED_BELL_KINDS),
  entityId: z.string().check(z.minLength(1), z.maxLength(128)),
});
export type StaffNotifyMessage = z.infer<typeof staffNotifyMessage>;

/** Builds the message (the shape the consumer parses). */
export const staffNotify = (bell: EmailedBell, entityId: string): StaffNotifyMessage => ({
  kind: "staff.notify",
  bell,
  entityId,
});

export const isStaffNotifyKind = (body: unknown): boolean =>
  typeof body === "object" && body !== null && (body as { kind?: unknown }).kind === "staff.notify";
