// The request bodies of M7.4's admin routes (ADM-SET-09, ADM-CLI-05, POR-11, FRM-05; run file docs/runs/m7.4-data-protection.md C): staff logging a request
// that came by email, post, phone or in person, its two steps, its close, the erased-address lift, the real-deletion switch and the lead's erase. zod/mini
// only (the admin API Worker carries no classic zod; namespace import, `zod-import.test.ts`); built at module top level, `warmDataProtectionSchemas` parses one
// sample of each at start-up. Codes only: a refusal is a zod issue whose `message` is a code (the screens hold the words). Subpath export
// `@techaust/core/dp-schemas`.
import * as z from "zod/mini";
import { ERASE_REASONS } from "../clients.ts";
import { parseIsoDate } from "../dates.ts";
import { DECLINE_REASONS, REQUEST_KINDS, STAFF_CHANNELS } from "../dsr.ts";
import { REQUEST_CLOSE_NOTE_MAX, REQUEST_DETAILS_MAX, REQUEST_OUTCOMES } from "../portal.ts";

// C0 and C1 control characters: a single-line field allows none; a multi-line one only tab and line feed (a carriage return is folded into a line feed first).
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL_EXCEPT_TAB_LF = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

const noControl = z.refine<string>((v) => !CONTROL.test(v), { message: "control_characters" });
const line = (max: number) => z.string().check(noControl, z.trim(), z.minLength(1), z.maxLength(max));
const lines = (max: number) =>
  z.string().check(
    z.overwrite((v) => v.replace(/\r\n?/g, "\n").trim()),
    z.refine((v) => !CONTROL_EXCEPT_TAB_LF.test(v), { message: "control_characters" }),
    z.minLength(1),
    z.maxLength(max),
  );
const blank = (v: string | null | undefined) => v == null || v.trim() === "";
const id = z.string().check(z.regex(/^[A-Za-z0-9_-]{1,64}$/));
/** An address as stored: trimmed, lower-cased, at most 254 characters, a valid address. */
export const storedEmail = z.pipe(z.string().check(z.trim(), z.toLowerCase(), z.maxLength(254)), z.email());
const detailsText = lines(REQUEST_DETAILS_MAX);
const closeNote = line(REQUEST_CLOSE_NOTE_MAX);
const isoDate = z.string().check(z.refine((v) => parseIsoDate(v) !== null, { message: "date_invalid" }));

/**
 * `POST /client-requests` (C.2, `requests.log`): a request that reached us by email, post, phone or in person. Exactly one subject: a contact (its client is
 * taken from the contact; a `clientId` sent with it must be that client's), a lead, an address, or a client alone. A `data_erasure` request names a contact, a
 * lead or an address (L28: an address-only one closes only as declined); a client alone can't be erased against. `details` as M7.1's (required for a contact
 * change, a correction and a grievance).
 */
export const requestLogBody = z
  .strictObject({
    kind: z.enum(REQUEST_KINDS),
    channel: z.enum(STAFF_CHANNELS),
    receivedOn: isoDate,
    clientId: z.optional(id),
    contactId: z.optional(id),
    leadId: z.optional(id),
    requesterEmail: z.optional(storedEmail),
    details: z.optional(z.nullable(z.string())),
  })
  .check(
    z.refine((v) => blank(v.details) || detailsText.safeParse(v.details).success, {
      message: "details_invalid",
      path: ["details"],
    }),
    z.refine(
      (v) => !["contact_change", "data_correction", "grievance"].includes(v.kind) || !blank(v.details),
      { message: "details_required", path: ["details"] },
    ),
    // Exactly one subject (a contact may carry its client's id; nothing else rides with another subject).
    z.refine(
      (v) =>
        [v.contactId, v.leadId, v.requesterEmail].filter((x) => x !== undefined).length +
          (v.contactId === undefined && v.clientId !== undefined ? 1 : 0) ===
          1 &&
        (v.clientId === undefined || v.leadId === undefined) &&
        (v.clientId === undefined || v.requesterEmail === undefined),
      { message: "one_subject" },
    ),
    // Round 5 and L28: an erasure is against a contact, a lead or an address, never a client alone.
    z.refine(
      (v) =>
        v.kind !== "data_erasure" ||
        v.contactId !== undefined ||
        v.leadId !== undefined ||
        v.requesterEmail !== undefined,
      { message: "erasure_subject_required" },
    ),
  );
export type RequestLogInput = z.infer<typeof requestLogBody>;

/** The details as stored: folded, trimmed, or null when there are none. Call only on a body `requestLogBody` accepted. */
export const loggedDetailsOf = (v: RequestLogInput): string | null =>
  blank(v.details) ? null : detailsText.parse(v.details);

/** The two steps of a request (C.3), each set once. */
export const REQUEST_STEPS = ["acknowledged", "identity_checked"] as const;
export type RequestStep = (typeof REQUEST_STEPS)[number];
export const requestStepBody = z.strictObject({ step: z.enum(REQUEST_STEPS) });

const optionalNote = z
  .optional(z.nullable(z.string()))
  .check(z.refine((v) => blank(v) || closeNote.safeParse(v).success, { message: "note_invalid" }));

/**
 * `POST /client-requests/:id/close` (C.4): M7.1's outcome and note, plus the decline reason, the audit row of the erase or anonymise that fulfilled an erasure
 * request, and when a done access request's export was emailed (Q2 A). Core `closeVerdict` then checks which go together.
 */
export const requestCloseBody = z.strictObject({
  outcome: z.enum(REQUEST_OUTCOMES),
  note: optionalNote,
  declineReason: z.optional(z.nullable(z.enum(DECLINE_REASONS))),
  actionAuditId: z.optional(z.nullable(id)),
  exportSentAt: z.optional(z.nullable(z.int().check(z.gte(0)))),
});
export type RequestCloseBody = z.infer<typeof requestCloseBody>;
export const requestCloseNoteOf = (note: string | null | undefined): string | null =>
  blank(note) ? null : closeNote.parse(note);

/** `POST /suppressions/lift` (C.6, L20): the address of a person who asked to hear from us again. */
export const suppressionLiftBody = z.strictObject({ email: storedEmail });

/** `POST /retention/live` (C.7, Q1 A): real deletion on or off. */
export const retentionLiveBody = z.strictObject({ on: z.boolean() });

/** `POST /leads/:id/erase` (C.8): the reason, as a contact's erase (`ERASE_REASONS`). */
export const leadEraseBody = z.strictObject({ reason: z.enum(ERASE_REASONS) });

/** Parses one sample of each schema at start-up (the warm-up keeps schema building out of the metered request). Returns how many parsed. */
export function warmDataProtectionSchemas(): number {
  let ok = 0;
  try {
    if (
      requestLogBody.safeParse({
        kind: "data_access",
        channel: "email",
        receivedOn: "2026-11-06",
        requesterEmail: "Person@Example.test",
        details: "Copy of my data",
      }).success
    )
      ok++;
    if (requestStepBody.safeParse({ step: "acknowledged" }).success) ok++;
    if (
      requestCloseBody.safeParse({ outcome: "declined", note: "Not ours", declineReason: "not_on_record" })
        .success
    )
      ok++;
    if (suppressionLiftBody.safeParse({ email: "a@example.test" }).success) ok++;
    if (retentionLiveBody.safeParse({ on: false }).success) ok++;
    if (leadEraseBody.safeParse({ reason: "requested" }).success) ok++;
    if (
      loggedDetailsOf({
        kind: "grievance",
        channel: "post",
        receivedOn: "2026-11-06",
        clientId: "x",
        details: " a ",
      }) === "a"
    )
      ok++;
  } catch {
    return ok;
  }
  return ok;
}
