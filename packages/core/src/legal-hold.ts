// Legal hold (M7.4 B.4; ADM-CLI-05; run file docs/runs/m7.4-data-protection.md A.2, C.5, L3, L6). A hold on a client, contact or lead stops every erase,
// anonymisation and deletion of it (and, for a client, of its files and notes) until it is lifted, for a GST proceeding or another legal duty (RA-25's open
// point is answered by building it: Researched 2026-10-28, s.36 CGST Act (08-C RA-25)). The flags (`clients.legal_hold`, `contacts.legal_hold`,
// `leads.legal_hold`) are set only by the `legal_holds` history's trigger; the route writes the audit row and the history row in one batch (Owner, step-up).
// zod/mini only (the admin API Worker carries no classic zod); built at module top level.
import * as z from "zod/mini";

/** The records a hold can be on (`legal_holds.entity_type`; pinned to the M7.4 trigger). */
export const LEGAL_HOLD_ENTITY_TYPES = ["client", "contact", "lead"] as const;
export type LegalHoldEntityType = (typeof LEGAL_HOLD_ENTITY_TYPES)[number];
/** What a history row does (`legal_holds.action`; pinned to the M7.4 trigger). */
export const LEGAL_HOLD_ACTIONS = ["set", "clear"] as const;
export type LegalHoldAction = (typeof LEGAL_HOLD_ACTIONS)[number];
/** The reason a person types (1 to 500 characters, trimmed). */
export const LEGAL_HOLD_REASON_MAX = 500;

// C0 and C1 control characters except tab and line feed (a carriage return is folded into a line feed first).
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL_EXCEPT_TAB_LF = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

const reasonText = z.string().check(
  z.overwrite((v) => v.replace(/\r\n?/g, "\n").trim()),
  z.refine((v) => !CONTROL_EXCEPT_TAB_LF.test(v), { message: "control_characters" }),
  z.minLength(1),
  z.maxLength(LEGAL_HOLD_REASON_MAX),
);
const entityId = z.string().check(z.minLength(1), z.maxLength(64));

/** `POST /legal-holds` (C.5): turn a hold on or off, with a reason either way. */
export const legalHoldRequest = z.strictObject({
  entityType: z.enum(LEGAL_HOLD_ENTITY_TYPES),
  entityId,
  on: z.boolean(),
  reason: reasonText,
});
export type LegalHoldRequest = z.infer<typeof legalHoldRequest>;

/** `GET /legal-holds?entityType=&entityId=` (C.5): the history of one record. */
export const legalHoldQuery = z.strictObject({
  entityType: z.enum(LEGAL_HOLD_ENTITY_TYPES),
  entityId,
});
export type LegalHoldQuery = z.infer<typeof legalHoldQuery>;

/** The history row's action for a request. */
export const holdActionOf = (on: boolean): LegalHoldAction => (on ? "set" : "clear");

/** The record as the route reads it: whether it is held, and (a contact) whether it was anonymised. Null: no such record. */
export type HoldTarget = { readonly held: boolean; readonly anonymised: boolean } | null;

export type HoldRefusal = "not_found" | "hold_unchanged" | "anonymised";

/**
 * Whether a hold change may go ahead (C.5; the route's SQL checks the same in its WHERE): the record exists (404), the hold actually changes (409
 * `hold_unchanged`), and it isn't an anonymised contact (409; such a row can't change at all, `contacts_anonymised_frozen`). An anonymised client can still be
 * held: its financial records stay, and a proceeding about them is what a hold is for.
 */
export function holdVerdict(
  target: HoldTarget,
  entityType: LegalHoldEntityType,
  on: boolean,
): { ok: true; action: LegalHoldAction } | { ok: false; code: HoldRefusal } {
  if (target === null) return { ok: false, code: "not_found" };
  if (entityType === "contact" && target.anonymised) return { ok: false, code: "anonymised" };
  if (target.held === on) return { ok: false, code: "hold_unchanged" };
  return { ok: true, action: holdActionOf(on) };
}

/** Parses one sample of each schema at start-up (the warm-up keeps schema building out of the metered request). Returns how many parsed. */
export function warmLegalHoldSchemas(): number {
  let ok = 0;
  if (
    legalHoldRequest.safeParse({ entityType: "client", entityId: "x", on: true, reason: "GST notice" })
      .success
  )
    ok++;
  if (legalHoldQuery.safeParse({ entityType: "lead", entityId: "x" }).success) ok++;
  return ok;
}
