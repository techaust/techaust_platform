// The request bodies of the full client portal's writes (M7.1; POR-06, POR-09, POR-11, ADM-PAY-05; run file docs/runs/m7.1-portal.md B), zod/mini only (the
// portal Worker must not carry classic zod; namespace import, `zod-import.test.ts`). Codes only: a refusal is a zod issue whose `message` is a code (the screens
// hold the words). The routes check in SQL whatever needs the database (the balance, the issue day, the open request, the daily cap, the stale save). Schemas
// are built at module top level (a Worker's start-up, never the metered request); `warmPortalSchemas` parses one sample of each. Subpath export
// `@techaust/core/portal-schemas`.
import * as z from "zod/mini";
import { parseIsoDate } from "../dates.ts";
import { REQUEST_KINDS as DSR_REQUEST_KINDS } from "../dsr.ts";
import { normaliseReference } from "../export-invoice.ts";
import {
  detailsRequired,
  NOTICE_CLOSE_NOTE_MAX,
  NOTICE_NOTE_MAX,
  NOTICE_REFERENCE_MAX,
  REQUEST_CLOSE_NOTE_MAX,
  REQUEST_DETAILS_MAX,
  REQUEST_OUTCOMES,
  type RequestKind,
} from "../portal.ts";

// C0 and C1 control characters: a single-line field allows none; a multi-line one only tab and line feed (a carriage return is folded into a line feed first).
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL_EXCEPT_TAB_LF = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

const noControl = z.refine<string>((v) => !CONTROL.test(v), { message: "control_characters" });
/** A trimmed single-line text of 1 to `max` characters. */
const line = (max: number) => z.string().check(noControl, z.trim(), z.minLength(1), z.maxLength(max));
/** A trimmed multi-line text of 1 to `max` characters, line endings folded to "\n". */
const lines = (max: number) =>
  z.string().check(
    z.overwrite((v) => v.replace(/\r\n?/g, "\n").trim()),
    z.refine((v) => !CONTROL_EXCEPT_TAB_LF.test(v), { message: "control_characters" }),
    z.minLength(1),
    z.maxLength(max),
  );
/** A request's details as stored (built once, at start-up). */
const detailsText = lines(REQUEST_DETAILS_MAX);
const blank = (v: string | null | undefined) => v == null || v.trim() === "";
const isoDate = z.string().check(z.refine((v) => parseIsoDate(v) !== null, { message: "date_invalid" }));
const positive = z.int().check(z.gt(0));

/** M3.3's contact rules (the admin's `patchContact`: name 1 to 100, phone at most 40, trimmed), plus no control characters: a client types these. */
export const CONTACT_NAME_MAX = 100;
export const CONTACT_PHONE_MAX = 40;

/**
 * `POST /profile` (Q1 = A, owner 2026-11-01): a contact changes its own name and phone. Strict: the email (and anything else) is refused, 400 (C16: "To change
 * it, send us a request below"). `phone: null` or a blank phone removes it. `expectedUpdatedAt` is the row's `updated_at` as read (409 `stale_version`).
 */
export const profileUpdate = z.strictObject({
  name: line(CONTACT_NAME_MAX),
  phone: z.nullable(z.string().check(noControl, z.trim(), z.maxLength(CONTACT_PHONE_MAX))),
  expectedUpdatedAt: z.int().check(z.gte(0)),
});
export type ProfileUpdate = z.infer<typeof profileUpdate>;
/** The phone as stored: the parsed (trimmed) text, or null for none or a blank one. */
export const storedPhone = (phone: string | null): string | null =>
  phone === null || phone === "" ? null : phone;

/**
 * `POST /requests` (L8): one of the five kinds; `details` up to 1,000 characters, required for a contact change, a correction and a grievance (where it says what
 * is needed), optional otherwise (absent, null or blank is no details).
 */
export const clientRequest = z
  .strictObject({
    // M7.4 (E, L9): M7.1's five kinds and the two 07-A §6 promises, consent withdrawal and nomination (07-ZR C5, C6).
    kind: z.enum(DSR_REQUEST_KINDS),
    details: z.optional(z.nullable(z.string())),
  })
  .check(
    z.refine((v) => blank(v.details) || detailsText.safeParse(v.details).success, {
      message: "details_invalid",
      path: ["details"],
    }),
    z.refine((v) => !detailsRequired(v.kind as RequestKind) || !blank(v.details), {
      message: "details_required",
      path: ["details"],
    }),
  );
export type ClientRequestInput = z.infer<typeof clientRequest>;

/** The details as stored: folded, trimmed, or null when there are none. Call only on a body `clientRequest` accepted (else it throws). */
export function requestDetailsOf(v: ClientRequestInput): string | null {
  return blank(v.details) ? null : detailsText.parse(v.details);
}

/**
 * An optional note (lead triage of early check 1, item 9): absent, null or blank is no note; anything else must be valid for `valid` (a `line` or `lines`
 * text). Read the stored value with the field's `…NoteOf`. A refusal is `note_invalid` on the `note` path.
 */
const optionalNote = (valid: z.ZodMiniString<string>) =>
  z
    .optional(z.nullable(z.string()))
    .check(z.refine((v) => blank(v) || valid.safeParse(v).success, { message: "note_invalid" }));
/**
 * The "I've paid" note (review 1, M1): several lines, like a request's details (the screen is a textarea): CRLF and CR folded to a line feed, trimmed, 1 to 300
 * characters, no control character other than tab and line feed. The DB CHECK `payment_notices_note_length` (0071) limits only the length.
 */
const noticeNote = lines(NOTICE_NOTE_MAX);
const requestCloseNote = line(REQUEST_CLOSE_NOTE_MAX);
const noticeCloseNote = line(NOTICE_CLOSE_NOTE_MAX);

const reference = line(NOTICE_REFERENCE_MAX).check(
  z.refine((v) => normaliseReference(v) !== null, { message: "reference_invalid" }),
);
const noticeFields = {
  amountMinor: positive,
  paidOn: isoDate,
  /** The transaction reference (UTR or similar), stored as typed and as `normaliseReference` of it. Never a card or account number (C13's hint; RB-07). */
  reference,
  /** Optional, several lines; blank or null is none (item 9, review 1 M1). */
  note: optionalNote(noticeNote),
};

/** `POST /invoices/:id/paid-notice` (signed in, finance): what the client says it paid (L10). The amount, the days and the document are checked by the route. */
export const paidNotice = z.strictObject(noticeFields);
export type PaidNoticeInput = z.infer<typeof paidNotice>;

/** `POST /t/document/paid-notice` (the emailed link): the same, plus the link's token, only ever in the body (as `POST /t/document/pay`). */
export const tokenPaidNotice = z.strictObject({ ...noticeFields, token: z.string().check(z.maxLength(256)) });
export type TokenPaidNoticeInput = z.infer<typeof tokenPaidNotice>;

/** A notice's note as stored: line endings folded to line feeds, trimmed, or null for none or a blank one. Call only on a body the schema accepted. */
export const noticeNoteOf = (note: string | null | undefined): string | null =>
  blank(note) ? null : noticeNote.parse(note);

/**
 * Admin `POST /client-requests/:id/close` (`requests.close`): the outcome and an optional note (at most 500 characters; blank or null is none). The close
 * dialog's hint asks for no personal data (staff line S6); the note is kept as the record of how the request was handled (lead triage, item 5).
 */
export const requestCloseBody = z.strictObject({
  outcome: z.enum(REQUEST_OUTCOMES),
  note: optionalNote(requestCloseNote),
});
export type RequestCloseInput = z.infer<typeof requestCloseBody>;
export const requestCloseNoteOf = (note: string | null | undefined): string | null =>
  blank(note) ? null : requestCloseNote.parse(note);

/** Admin `POST /payments/notices/:id/close` (`payments.notices`): a dismiss only (a notice is recorded through `POST /payments` with `noticeId`, L23). */
export const noticeCloseBody = z.strictObject({
  outcome: z.literal("dismissed"),
  note: optionalNote(noticeCloseNote),
});
export type NoticeCloseInput = z.infer<typeof noticeCloseBody>;
export const noticeCloseNoteOf = (note: string | null | undefined): string | null =>
  blank(note) ? null : noticeCloseNote.parse(note);

/** The start-up warm-up (M6.2 CPU diagnosis): one sample parse of each schema, so their first real use in a request is not their first run. Never throws. */
export function warmPortalSchemas(): number {
  let ok = 0;
  try {
    if (profileUpdate.safeParse({ name: "Asha Rao", phone: "+91 98765 43210", expectedUpdatedAt: 1 }).success)
      ok++;
    const req = clientRequest.safeParse({
      kind: "data_correction",
      details: "My title is wrong.\r\nIt should be Director.",
    });
    if (req.success && requestDetailsOf(req.data) !== null) ok++;
    const note = "Sent by NEFT.\r\nPart of two.";
    if (paidNotice.safeParse({ amountMinor: 100, paidOn: "2026-11-04", reference: "UTR 1234", note }).success)
      ok++;
    if (
      tokenPaidNotice.safeParse({ amountMinor: 100, paidOn: "2026-11-04", reference: "UTR1234", token: "t" })
        .success
    )
      ok++;
    if (requestCloseBody.safeParse({ outcome: "done", note: "Sent by email" }).success) ok++;
    if (
      noticeCloseBody.safeParse({ outcome: "dismissed", note: "" }).success &&
      noticeNoteOf(` ${note} `) === "Sent by NEFT.\nPart of two."
    )
      ok++;
  } catch {
    return ok;
  }
  return ok;
}
