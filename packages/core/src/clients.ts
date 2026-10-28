// Client rules shared by the admin Worker and the database tests (M3.3, ADM-CLI-01..05). Pure: no I/O.
// GST treatment, retention and data-subject items: Researched 2026-10-28, DPDP Act s.8(7) and s.12(3) (08-C RB-11).
import { isCountryCode } from "./countries.ts";
import { isStateCode, STATE_CODES, type StateCode, validateGstin } from "./gstin.ts";

/**
 * The billing fields of a client: tax identity, address and billing terms, plus the country (it decides what a GST status may
 * be). They are written after creation ONLY through the billing route (`clients.finance.write`). The PRD hides the finance
 * tabs, not the tax identity (lead call, 2026-10-25), so every role that reads clients reads most of these. A test ties this
 * list to the billing request schema and the `clients` table columns.
 */
export const CLIENT_BILLING_FIELDS = [
  "country",
  "gstStatus",
  "gstin",
  "stateCode",
  "billingAddress",
  "currency",
  "paymentTermsDays",
  "reminderPolicy",
  "careAutoIssue",
  "attachPdf",
] as const;
export type ClientBillingField = (typeof CLIENT_BILLING_FIELDS)[number];

/**
 * The fields only a role with `clients.finance.read` is shown (the finance tab's facts): payment terms and reminder settings,
 * the invoicing switches, and whether the currency is locked. `clientView` drops them for Sales; a test scans every response
 * Sales gets for these keys.
 */
export const CLIENT_FINANCE_READ_FIELDS = [
  "paymentTermsDays",
  "reminderPolicy",
  "careAutoIssue",
  "attachPdf",
  "currencyLocked",
  // M5.4: who turned the automatic issue of the care invoice on, and whether that Owner is still active
  "careAutoIssueBy",
] as const;

/** The 409 text when a client's type is locked by an issued (frozen) document. */
// pending owner approval (07-J)
export const CLIENT_TYPE_LOCKED_MESSAGE =
  "The client type can't change once this client has an issued document.";

/**
 * The document types that fix a client's currency once one exists (any status): everything except the quotes. A proposal or
 * an estimate alone does not lock it (ADM-CLI-01). `QUOTE_DOCUMENT_TYPES` and this list together are every document type
 * (a database test checks it), so a new type has to be placed on purpose.
 */
export const INVOICE_FAMILY = [
  "proforma",
  "tax_invoice",
  "export_invoice",
  "credit_note",
  "debit_note",
  "receipt",
  "receipt_voucher",
  "refund_voucher",
] as const;
export const QUOTE_DOCUMENT_TYPES = ["proposal", "estimate"] as const;

/** `'a', 'b'` for an SQL `IN (...)` (the values are code constants, never input). */
export const INVOICE_FAMILY_SQL = INVOICE_FAMILY.map((t) => `'${t}'`).join(", ");

/** The names shown on records whose person was anonymised (07-J, approved). */
export const ANONYMISED_CONTACT = "Removed contact";
export const ANONYMISED_CLIENT = "Anonymised client";
/** The placeholder address of an anonymised contact: unique per contact, never deliverable (`.invalid`), lower case. */
export const anonymisedEmail = (contactId: string): string => `anonymised+${contactId.toLowerCase()}@invalid`;

/** Why a person's data is erased or anonymised (07-J). Codes are stored in the audit row; the words are the screen's. */
export const ERASE_REASONS = ["requested", "consent_withdrawn", "not_needed", "other"] as const;
export type EraseReason = (typeof ERASE_REASONS)[number];

export type TaxInput = {
  gstStatus: "registered" | "unregistered" | "overseas";
  country: string;
  gstin?: string | null | undefined;
  stateCode?: string | null | undefined;
};
export type TaxErrorCode =
  | "country_mismatch"
  | "gstin_invalid"
  | "gstin_not_allowed"
  | "state_required"
  | "state_invalid"
  | "state_not_allowed";
export type TaxWarning = { code: "gstin_state_mismatch"; gstinState: string };
export type TaxCheck =
  | { ok: true; gstin: string | null; stateCode: StateCode | null; warnings: TaxWarning[] }
  | { ok: false; code: TaxErrorCode; message: string };

const fail = (code: TaxErrorCode, message: string): TaxCheck => ({ ok: false, code, message });

/**
 * The tax identity of a client as one rule (ADM-CLI-01, owner answer Q1 of 2026-10-25), VERIFY WITH CA/LEGAL:
 * - registered: India, a valid GSTIN; the state defaults to the GSTIN's, a different one is a warning (never a block);
 * - unregistered: India and a state code (the place of supply for a client without a GSTIN);
 * - overseas: a country other than India, no GSTIN, no state.
 * The database trigger `clients_state_check` backs the state rules up.
 */
export function clientTaxCheck(input: TaxInput): TaxCheck {
  const { gstStatus, country } = input;
  const gstin = input.gstin ? input.gstin : null;
  const state = input.stateCode ? input.stateCode : null;
  if (!isCountryCode(country) || (gstStatus === "overseas") === (country === "IN"))
    return fail(
      "country_mismatch",
      "Registered and unregistered clients are in India (IN); overseas clients are not",
    );
  if (gstStatus === "overseas") {
    if (gstin) return fail("gstin_not_allowed", "An overseas client has no GSTIN");
    if (state) return fail("state_not_allowed", "An overseas client has no state");
    return { ok: true, gstin: null, stateCode: null, warnings: [] };
  }
  if (state !== null && !isStateCode(state)) return fail("state_invalid", `Unknown state code ${state}`);
  if (gstStatus === "unregistered") {
    if (gstin) return fail("gstin_not_allowed", "An unregistered client has no GSTIN");
    if (state === null) return fail("state_required", "Choose the client's state");
    return { ok: true, gstin: null, stateCode: state as StateCode, warnings: [] };
  }
  const g = validateGstin(gstin ?? "");
  if (!g.ok) return fail("gstin_invalid", g.error);
  const chosen = (state ?? g.stateCode) as StateCode;
  return {
    ok: true,
    gstin: g.gstin,
    stateCode: chosen,
    warnings:
      chosen === g.stateCode
        ? []
        : [{ code: "gstin_state_mismatch", gstinState: STATE_CODES[g.stateCode].name }],
  };
}
