import { type CalendarDate, formatDate, istDate, parseIsoDate } from "@techaust/core/dates";
import { contentHash, type DraftContent } from "@techaust/core/documents";
import { isCountryCode } from "@techaust/core/form-labels";
import { uuidv7 } from "@techaust/core/ids";
import {
  EXPORT_ENDORSEMENT,
  type ExportRoute,
  type IssueBlocker,
  type IssueFacts,
  issueBlockers,
  lutFor,
  PROFORMA_NOTICE,
  signatureRequired,
  udyamPrintedOn,
} from "@techaust/core/invoices";
import { milestoneTotals } from "@techaust/core/projects";
import { percentFromBp } from "@techaust/core/schedule-text";
import { resolveSetting, type Settings } from "@techaust/core/settings";
import {
  type ComputedDocument,
  computeDocument,
  determineSupply,
  groupsOf,
  type InclusiveGroup,
  type LineInput,
  lutsOf,
  MAX_GROUPS,
  splitInclusive,
  type TaxContext,
  type TaxIssue,
} from "@techaust/core/tax";
import {
  type DocumentBundle,
  fxOfRow,
  type InvoiceHeaderExtras,
  noteContentOf,
  type TermsRef,
} from "@techaust/db/documents";
import type {
  InvoiceBankBlock,
  InvoiceIssuerSnapshot,
  InvoiceSwiftBlock,
  RecipientSnapshot,
} from "@techaust/db/issue";
import type { ApiError } from "./context.ts";
import {
  type ClientRow,
  discountOf,
  type LineState,
  lineDiscountOf,
  readSettings,
  stateOfBundle,
  taxContext,
  taxInputOf,
  type Warning,
} from "./quote-model.ts";
import { mergeByRate } from "./start-project-plan.ts";

// ---- errors --------------------------------------------------------------------------------------------------------------------------

const e = (code: string, message: string): ApiError => ({ code, message });
// Interim wording where 07-R has no line yet (the screens' words are the designer's, copy 07-R decides): a code is what a client depends on.
export const TYPE_NOT_ISSUABLE = e("type_not_issuable", "This kind of invoice can't be issued yet");
export const ALREADY_ISSUED = e("already_issued", "This invoice was already issued");
export const ISSUE_BLOCKED = e("issue_blocked", "This invoice can't be issued yet");
export const SETTINGS_CHANGED = e("settings_changed", "A setting changed while this was issued. Try again");
export const CLIENT_CHANGED = e("client_changed", "The client changed while this was issued. Try again");
/** The contact named on the invoice was edited or anonymised while it was issued (07-R's line, pending the owner's approval). */
export const CONTACT_CHANGED = e("contact_changed", "The contact's details changed a moment ago. Try again.");
/** The draft names a contact that was anonymised (or is gone): the owner picks another one and saves (07-R). The recipient frozen at issue would not match the draft's hash. */
export const CONTACT_ANONYMISED = e(
  "contact_anonymised",
  "This draft's contact has been anonymised. Choose another contact, then save the draft.",
);
export const ISSUE_APPROVAL_REQUIRED = e(
  "approval_required",
  "Issuing an invoice needs the owner's approval",
);
export const ISSUE_DIRECTLY = e("issue_directly", "The owner issues an invoice directly");
export const NOT_A_DRAFT = e("not_draft", "Only a draft can be changed");
export const NOT_AN_INVOICE = e("not_an_invoice", "That is not an invoice");
export const MILESTONE_NOT_READY = e("milestone_not_ready", "That milestone is not ready to bill");
export const MILESTONE_HAS_INVOICE = e("milestone_has_invoice", "That milestone already has an invoice");
export const MILESTONE_NOT_FOUND = e("milestone_not_found", "That milestone does not belong to this client");
export const MILESTONE_NO_AMOUNT = e("milestone_no_amount", "That milestone has no amount yet");
export const MILESTONE_EXCLUSIVE = e("milestone_exclusive", "Choose a milestone or services, not both");
export const VOID_NOT_ALLOWED = e("void_not_allowed", "This invoice can't be voided");
export const ALREADY_VOID = e("already_void", "This invoice is already void");
/** Q23 (OPEN (08-C RA-10): may a tax invoice issued in error and never delivered be shown as cancelled in GSTR-1 Table 13 with no credit note?): the lead's line, 07-R's wording pending the owner's approval. */
export const RETURN_PERIOD_CLOSED = e(
  "return_period_closed",
  "This invoice's GST return period has ended, so it can't be voided. Use a credit note instead.",
);
/**
 * FX-5 (owner decision 2026-10-30, docs/13; 08-C RA-10): the client opened the document in the portal (`viewed_at` set), so a credit note is the
 * correction, never a void. The SPA shows its own line (07-Z, pending the owner); these are the API's words.
 */
export const VIEWED_BY_CLIENT = e(
  "viewed_by_client",
  "The client has opened this invoice in the portal, so it can't be voided. Use a credit note instead.",
);
/** The same refusal for a proforma: it has no credit note, so it stays until converted (lead, 2026-10-30, docs/13; 07-Z §1's proforma line). */
export const VIEWED_BY_CLIENT_PROFORMA = e(
  "viewed_by_client",
  "The client has opened this proforma in the portal, so it can't be voided.",
);
export const INVOICE_APPROVAL_EXPIRED = e(
  "approval_expired",
  "The invoice changed after the request, so the request expired",
);

// ---- constants -----------------------------------------------------------------------------------------------------------------------

// `INVOICE_TYPES_SQL` and `SERIES_FULL` live in invoice-consts.ts (M6.1 stage A), so the admin API Worker can use them without this module.
export { INVOICE_TYPES_SQL, SERIES_FULL } from "./invoice-consts.ts";

// ---- settings, bank, terms ----------------------------------------------------------------------------------------------------------------

/** Every settings row an invoice reads: the four of the quote model, plus the email identities (the sender printed on the invoice). */
export const INVOICE_SETTINGS_READ =
  "SELECT key, value, version FROM settings WHERE key IN ('company', 'tax', 'payment_terms', 'numbering', 'email')";
/** The newest invoice footer notes (a pin, no text); none is allowed (M5.1). */
export const NEWEST_INVOICE_TERMS =
  "SELECT id, kind, version, sha256 FROM terms_versions WHERE kind = 'invoice' ORDER BY version DESC LIMIT 1";
/** The active bank accounts (at most one per kind). M5.2: the SWIFT block's columns and the purpose code come with them. */
export const BANK_READ =
  "SELECT kind, account_name, account_no, ifsc, swift, bank_name, branch, bank_address, intermediary, purpose_code, updated_at FROM bank_accounts WHERE active = 1";
/** The newest optional export-declaration note (LD23): its pin and its text (the text is frozen into `header_extras` at issue). */
export const NEWEST_EXPORT_DECLARATION =
  "SELECT id, kind, version, sha256, body_md FROM terms_blocks WHERE kind = 'export_declaration' ORDER BY version DESC LIMIT 1";

export type BankRow = {
  kind: string;
  account_name: string;
  account_no: string;
  ifsc: string | null;
  swift: string | null;
  bank_name: string;
  branch: string | null;
  bank_address: string | null;
  intermediary: string | null;
  purpose_code: string | null;
  updated_at: number;
};
type SettingRow = { key: string; value: string; version: number };

export type InvoiceSettings = ReturnType<typeof readSettings> & {
  email: Settings["email"];
  /** The stored `version` of each row the issue batch guards (null: never saved). */
  versions: {
    numbering: number | null;
    company: number | null;
    tax: number | null;
    paymentTerms: number | null;
  };
};

export function readInvoiceSettings(rows: readonly SettingRow[]): InvoiceSettings {
  const by = new Map(rows.map((r) => [r.key, r]));
  const email = by.get("email");
  return {
    ...readSettings(rows),
    email: resolveSetting("email", email ? JSON.parse(email.value) : undefined),
    versions: {
      numbering: by.get("numbering")?.version ?? null,
      company: by.get("company")?.version ?? null,
      tax: by.get("tax")?.version ?? null,
      paymentTerms: by.get("payment_terms")?.version ?? null,
    },
  };
}

/** `max(updated_at)` of the active bank rows: what the issue batch compares (null: none). */
export const bankStampOf = (rows: readonly BankRow[]): number | null =>
  rows.length === 0 ? null : Math.max(...rows.map((r) => r.updated_at));

/** The INR block an invoice prints; null when no INR account is saved. */
export function inrBankOf(rows: readonly BankRow[]): InvoiceBankBlock | null {
  const r = rows.find((x) => x.kind === "INR");
  return r
    ? {
        accountName: r.account_name,
        accountNo: r.account_no,
        ifsc: r.ifsc,
        bankName: r.bank_name,
        branch: r.branch,
      }
    : null;
}

/**
 * M5.2 (LD30): the SWIFT block of a USD invoice, with the RBI purpose code; null when no USD account is saved (or it has no SWIFT code, which
 * Settings refuses to save). Frozen with the invoice.
 */
export function swiftBankOf(rows: readonly BankRow[]): InvoiceSwiftBlock | null {
  const r = rows.find((x) => x.kind === "USD_SWIFT");
  if (!r?.swift) return null;
  return {
    accountName: r.account_name,
    accountNo: r.account_no,
    swift: r.swift,
    bankName: r.bank_name,
    branch: r.branch,
    bankAddress: r.bank_address,
    intermediary: r.intermediary,
    purposeCode: r.purpose_code,
  };
}

// ---- the country of an export (LD32) -------------------------------------------------------------------------------------------------------------

/**
 * The ICU region names, made ONCE per isolate (a constructor per request would cost CPU on the Free plan). `Intl.DisplayNames` is probed in workerd by a
 * test (NOT VERIFIED on staging); if the runtime lacked it, the constructor failure is swallowed so the Worker still starts, and every export then answers
 * `country_missing` instead of printing a wrong name.
 */
const REGION_NAMES: Intl.DisplayNames | null = (() => {
  try {
    return new Intl.DisplayNames(["en-GB"], { type: "region" });
  } catch {
    return null;
  }
})();

/** The English name of an ISO 3166-1 country (frozen at issue); null for anything that is not an assigned code or that ICU only answers with the code. */
export function countryNameOf(code: string): string | null {
  if (!REGION_NAMES || !isCountryCode(code)) return null;
  try {
    const name = REGION_NAMES.of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

// ---- the frozen blocks ---------------------------------------------------------------------------------------------------------------------

export type ContactFacts = {
  id: string;
  name: string;
  email: string;
  anonymised_at: number | null;
  updated_at: number;
};

/** Everything an invoice says about the recipient, frozen with it (a later change of the client's record never changes an issued invoice). */
export function recipientOf(client: ClientRow, contact: ContactFacts | null): RecipientSnapshot {
  return {
    legalName: client.legal_name,
    displayName: client.display_name,
    country: client.country,
    clientType: client.type,
    gstStatus: client.gst_status,
    ...(client.gstin ? { gstin: client.gstin } : {}),
    ...(client.state_code ? { stateCode: client.state_code } : {}),
    ...(client.billing_address ? { address: JSON.parse(client.billing_address) } : {}),
    // M5.2 (LD36, Rule 46(o); Researched 2026-10-28, s.2(6) IGST Act, Rule 46 (08-C RA-18)): the address of delivery, when the client has a service address.
    ...(client.service_address ? { deliveryAddress: JSON.parse(client.service_address) } : {}),
    ...(contact && contact.anonymised_at === null
      ? { email: contact.email, contactId: contact.id, contactName: contact.name }
      : {}),
  };
}

/** What the issuer block depends on besides the settings (L2): the document type, and whether it is the tax or export invoice for a payment received. */
export type IssuerKind = { readonly type: string; readonly advance: boolean };

/**
 * The supplier block: the company as saved, the INR bank block (and, on a USD document, the SWIFT block, M5.2), the signature as a reference (LD11),
 * and the sender (the billing address and who issued it). An INR document's block has no `swift` key, so it is the M5.1 block unchanged.
 * T4 (rt2, L2): a credit or debit note and an invoice for a payment received always freeze the signature reference and never `signatory: false` (core
 * `signatureRequired`; Researched 2026-10-30, Rule 53(1A) CGST Rules (08-C RA-22); s.31(3)(d) CGST Act and Rule 50 CGST Rules (08-C RA-17)): the checklist's switch is
 * ignored for them. T10: a tax invoice issued while a Udyam number is saved freezes it as `company.udyam` (owner, 2026-10-31; Researched 2026-10-30, MSMED ss.15-16
 * (08-C RB-39(a))). Neither key is written when absent (never `undefined` or `null`, L6), so every other block, and every earlier seal, is unchanged.
 */
export function issuerOf(
  s: InvoiceSettings,
  bank: readonly BankRow[],
  who: { id: string; name: string },
  currency: string,
  kind: IssuerKind,
): InvoiceIssuerSnapshot {
  const c = s.company;
  const sig = c.signature;
  const signatoryOff =
    !signatureRequired(kind.type, kind.advance) && s.tax.invoiceChecklist.signatory === false;
  const udyam =
    udyamPrintedOn(kind.type) && c.udyam ? { number: c.udyam.number, category: c.udyam.category } : null;
  return {
    company: {
      tradeName: c.tradeName,
      legalName: c.legalName,
      address: c.address,
      gstin: c.gstin,
      stateCode: c.stateCode,
      logo: c.logoLight,
      ...(c.documentsEmail ? { email: c.documentsEmail } : {}),
      ...(c.documentsPhone ? { phone: c.documentsPhone } : {}),
      ...(c.principalPlace ? { principalPlace: c.principalPlace } : {}),
      ...(udyam ? { udyam } : {}),
    },
    bank: { inr: inrBankOf(bank), ...(currency === "USD" ? { swift: swiftBankOf(bank) } : {}) },
    // 07-W 5.6 (08-C RA-06): with the checklist's signatory item off, the choice is frozen here, so the PDF leaves the block out and a later settings change never alters it.
    signature: sig && !signatoryOff ? { key: sig.key, sha256: sig.sha256, mime: sig.mime } : null,
    ...(signatoryOff ? { signatory: false as const } : {}),
    reverseChargeText: s.tax.reverseChargeText,
    sender: { staffId: who.id, name: who.name, email: s.email.senders.billing },
  };
}

/**
 * Every number taken in one series (`?1`), void or not, in number order: the input of core `documentsIssuedSummary` (GSTR-1 Table 13; M5.5 adds the
 * return period and pages it). A voided document keeps its number and counts as cancelled.
 */
export const ISSUED_DOCUMENTS_SQL =
  "SELECT series, fy, number, number_display, status FROM documents WHERE series = ?1 AND frozen_at IS NOT NULL AND number IS NOT NULL ORDER BY fy, number";

// ---- the state of a draft ---------------------------------------------------------------------------------------------------------------------

/** M5.2: the exchange rate typed on a USD draft: INR micros per USD, the rate's own date, its source as it is printed (`fxSourceLabel`). */
/** `noRateDay` (Q24, 08-C RA-21): the DAY the Owner's statement "no rate was published that day" covers (an ISO date); stored with the rate (`fx_no_rate_day`), frozen and sealed with it. It counts only at an issue on that day. */
export type FxState = { rateMicros: number; date: string; source: string; noRateDay?: string };

export type InvoiceState = {
  id: string;
  type: string;
  clientId: string;
  contactId: string | null;
  currency: "INR" | "USD";
  discountKind: "fixed" | "percent" | null;
  discountValue: number | null;
  exportMode: string | null;
  /** M5.2 (LD24): part of the draft's content hash (a draft with no rate has no `fx` key in it). */
  fx: FxState | null;
  /** M5.2 (LD29): the day the service was completed: not hashed, not sealed, not printed. */
  serviceCompletedOn: string | null;
  /** M5.2 (LD23): the `export_declaration` block the draft asked to pin (the newest at the time; issue pins the newest then); null: none. */
  exportDeclarationId: string | null;
  lines: LineState[];
  /** M5.3 (LD39): a credit or debit note's request (hashed with the draft); absent on every other invoice. */
  note?: DraftContent["note"];
};

/** The invoice's state from the rows `loadStatements` read (its lines are the quote model's lines). */
export function invoiceStateOf(b: DocumentBundle<TermsRef>): InvoiceState {
  const q = stateOfBundle(b);
  const d = b.document;
  const note = noteContentOf(d);
  return {
    id: q.id,
    type: d.type,
    clientId: q.clientId,
    contactId: q.contactId,
    currency: q.currency,
    discountKind: q.discountKind,
    discountValue: q.discountValue,
    exportMode: q.exportMode,
    fx: fxOfRow(d),
    serviceCompletedOn: d.service_completed_on ?? null,
    exportDeclarationId: d.export_declaration_id ?? null,
    lines: q.lines,
    ...(note ? { note } : {}),
  };
}

/** An invoice's lines carry no catalogue reference (that belongs to the offer's discount guard): the service stays, the reference goes. */
export const withoutReference = (lines: readonly LineState[]): LineState[] =>
  lines.map((l) => ({ ...l, catalogueRateMinor: null, catalogueLine: null }));

/** The draft content the hash is made from: the same function a verifier uses over the rows (`invoiceDraftOfBundle`). */
export const invoiceDraftOf = (s: InvoiceState): DraftContent => ({
  type: s.type,
  clientId: s.clientId,
  contactId: s.contactId,
  title: null,
  currency: s.currency,
  validityDays: null,
  termsVersionId: null,
  discountKind: s.discountKind,
  discountValue: s.discountValue,
  exportMode: s.exportMode,
  lines: s.lines.map((l) => ({
    catalogueItemId: l.catalogueItemId,
    description: l.description,
    detail: l.detail,
    sac: l.sac,
    qtyMilli: l.qtyMilli,
    unit: l.unit,
    rateMinor: l.rateMinor,
    discountKind: l.discountKind,
    discountValue: l.discountValue,
    gstRateBp: l.gstRateBp,
    catalogueRateMinor: l.catalogueRateMinor,
    catalogueLine: l.catalogueLine,
  })),
  sections: [],
  schedule: [],
  fx: s.fx,
  // M5.3: a note's request is part of its content hash (absent on every other invoice: its hash does not move).
  ...(s.note ? { note: s.note } : {}),
});

// ---- computing a draft ---------------------------------------------------------------------------------------------------------------------

export type InvoiceComputation = {
  draft: DraftContent;
  computed: ComputedDocument | null;
  errors: TaxIssue[];
  warnings: Warning[];
  hash: string;
};

/** The IST calendar date of an instant (the date the tax engine judges a draft by). */
export const todayOf = (now = Date.now()): CalendarDate => istDate(now);

/**
 * Works a draft out with the SHARED engine, from the client's current record. Never throws for any state; a draft that cannot compute yet comes
 * back with `errors`, a null `computed` and still a hash, so it can be saved and finished later. `targetTotalMinor` is the ONE exception to
 * "nothing from the request": a draft made from a milestone (LD13) is worked out with its fixed supply, the lines' own rates and the total set
 * to the milestone's stored amount, exactly as the inclusive split made it; it comes from the milestone row, never from a request.
 */
export async function computeInvoice(
  state: InvoiceState,
  client: ClientRow,
  ctx: TaxContext,
  today: CalendarDate,
  targetTotalMinor: number | null,
): Promise<InvoiceComputation> {
  const lines: LineInput[] = state.lines.map((l) => ({
    sac: l.sac,
    qtyMilli: l.qtyMilli,
    rateMinor: l.rateMinor,
    gstRateBp: l.gstRateBp,
    discount: lineDiscountOf(l),
  }));
  const documentDiscount = discountOf(state);
  let result: ReturnType<typeof computeDocument>;
  if (targetTotalMinor === null) {
    result = computeDocument(
      {
        currency: state.currency,
        documentDate: today,
        recipient: taxInputOf(client),
        lines,
        documentDiscount,
        exportMode:
          state.exportMode === "lut" || state.exportMode === "igst_paid" ? state.exportMode : undefined,
        fx: state.fx ? { rateMicros: state.fx.rateMicros } : null,
      },
      ctx,
    );
  } else {
    // The route of an export (M5.2: the advance invoice keeps its proforma's); a draft made from a milestone has none, so it follows the settings as before.
    const supply = determineSupply(taxInputOf(client), ctx, {
      documentDate: today,
      currency: state.currency,
      exportMode:
        client.gst_status === "overseas" && (state.exportMode === "lut" || state.exportMode === "igst_paid")
          ? state.exportMode
          : undefined,
    });
    result = supply.ok
      ? computeDocument(
          {
            currency: state.currency,
            documentDate: today,
            supply: supply.value,
            recipientStatus: client.gst_status,
            trustRates: true,
            targetTotalMinor,
            lines,
            documentDiscount,
            fx: state.fx ? { rateMicros: state.fx.rateMicros } : null,
          },
          ctx,
        )
      : { ok: false, errors: supply.errors };
  }
  const draft = invoiceDraftOf(state);
  const computed = result.ok ? result.value : null;
  return {
    draft,
    computed,
    errors: result.ok ? [] : [...result.errors],
    warnings: result.ok ? [...result.warnings] : [],
    hash: await contentHash(draft, computed),
  };
}

/** The `documents` columns a save writes (everything that depends on the content). An invoice has no title, validity, terms pin or discount reference. */
export function invoiceColumns(s: InvoiceState, c: InvoiceComputation) {
  const k = c.computed;
  return {
    contact_id: s.contactId,
    discount_kind: s.discountKind,
    discount_value: s.discountValue,
    export_mode: s.exportMode,
    fx_rate_micros: s.fx?.rateMicros ?? null,
    fx_date: s.fx?.date ?? null,
    fx_source: s.fx?.source ?? null,
    fx_no_rate_day: s.fx?.noRateDay ?? null,
    service_completed_on: s.serviceCompletedOn,
    export_declaration_id: s.exportDeclarationId,
    subtotal_minor: k?.subtotalMinor ?? 0,
    discount_minor: k?.discountMinor ?? 0,
    taxable_minor: k?.taxableMinor ?? 0,
    cgst_minor: k?.cgstMinor ?? 0,
    sgst_minor: k?.sgstMinor ?? 0,
    igst_minor: k?.igstMinor ?? 0,
    round_off_minor: k?.roundOffMinor ?? 0,
    total_minor: k?.totalMinor ?? 0,
    total_inr_minor: k?.inr?.totalMinor ?? null,
    supply_type: k?.supply.type ?? null,
    place_of_supply_code: k?.supply.placeOfSupplyCode ?? null,
    computed: k ? JSON.stringify(k) : null,
    content_sha256: c.hash,
  };
}

// ---- a draft from a milestone (LD13) ------------------------------------------------------------------------------------------------------------

export type MilestoneFacts = {
  id: string;
  title: string;
  project_id: string;
  position?: number;
  /** 1 for the advance (read when a draft is made from the milestone). */
  is_advance?: number;
  amount_minor: number | null;
  pct_bp: number | null;
  status: string;
  document_id: string | null;
  delivered_at: number | null;
  client_id: string;
  budget_minor: number | null;
  source_document_id: string | null;
  /** The project's name (read with the invoice's milestone). */
  project_name?: string | null;
  /** The source proposal's result: read only when a draft is made from the milestone (the read of a draft leaves it out). */
  source_computed?: string | null;
};

/** The milestone's amount, tax included: a fixed amount, else its share of the project's budget (half up). Null when it has neither. */
export function milestoneAmountOf(
  m: Pick<MilestoneFacts, "amount_minor" | "pct_bp" | "budget_minor">,
): number | null {
  if (m.amount_minor !== null) return m.amount_minor;
  if (m.pct_bp === null || m.budget_minor === null) return null;
  return milestoneTotals(m.budget_minor, [{ amountMinor: null, pctBp: m.pct_bp }]).totalMinor;
}

export type MilestoneDraft =
  | { ok: true; lines: LineState[]; amountMinor: number; computed: ComputedDocument }
  | { ok: false; errors: TaxIssue[] };

/**
 * The lines of an invoice for one milestone, by the inclusive split (the amount already includes tax, as M4.5 made it): one line per
 * (SAC, rate) group of the source proposal's summary, else ONE group at the default rate with no SAC, which then blocks the issue (`sac_missing`).
 * Groups over the engine's cap merge by rate. The split's supply is the client's CURRENT record. The caller stores the lines; the total is the
 * milestone's amount to the paisa.
 */
export function milestoneDraft(input: {
  title: string;
  amountMinor: number;
  currency: "INR" | "USD";
  client: ClientRow;
  settings: InvoiceSettings;
  sourceComputed: ComputedDocument | null;
  today: CalendarDate;
}): MilestoneDraft {
  const { client, settings, today } = input;
  const ctx = taxContext(settings);
  const supply = determineSupply(taxInputOf(client), ctx, { documentDate: today, currency: input.currency });
  if (!supply.ok) return { ok: false, errors: supply.errors };
  let groups: InclusiveGroup[] = input.sourceComputed
    ? groupsOf(input.sourceComputed.summary)
    : [{ sac: null, gstRateBp: settings.tax.defaultRateBp, weightMinor: 1 }];
  if (groups.length === 0) groups = [{ sac: null, gstRateBp: settings.tax.defaultRateBp, weightMinor: 1 }];
  if (groups.length > MAX_GROUPS) groups = mergeByRate(groups).groups;
  const split = splitInclusive(input.amountMinor, groups, supply.value, input.currency, null, ctx, {
    documentDate: today,
    recipientStatus: client.gst_status,
  });
  if (!split.ok) return { ok: false, errors: split.errors };
  const many = split.value.lines.length > 1;
  const lines: LineState[] = split.value.lines.map((l, i) => {
    const cl = split.value.document.lines[i];
    const rateBp = cl?.gstRateBp ?? l.gstRateBp ?? 0;
    return {
      id: uuidv7(),
      catalogueItemId: null,
      catalogueRateMinor: null,
      catalogueLine: null,
      // 07-R §7 (invoice line from a milestone): the line's words are the milestone's title, with "(SAC {code}, {rate}%)" after it when there is more than one tax group.
      description: many
        ? `${input.title} (${l.sac ? `SAC ${l.sac}, ` : ""}${percentFromBp(rateBp)}%)`
        : input.title,
      detail: null,
      sac: l.sac,
      qtyMilli: l.qtyMilli,
      unit: "fixed",
      rateMinor: l.rateMinor,
      discountKind: null,
      discountValue: null,
      gstRateBp: rateBp,
    };
  });
  return { ok: true, lines, amountMinor: input.amountMinor, computed: split.value.document };
}

// ---- the invoice for money received against a proforma (M5.2, Q9, LD22) -----------------------------------------------------------------------

/** 07-S §8: the description of every line of the invoice made for money received (Rule 46 needs a description of the service). */
export const advanceLineDescription = (proformaNumber: string) =>
  `Payment received against proforma ${proformaNumber}`;

/**
 * The export route of the document made for money received against a proforma (review 1): the proforma's own pick; when it had none, the route the
 * engine computed it under (`export_lut` gives `lut`, `export_igst` gives `igst_paid`), NEVER the live Settings, which may have moved since the
 * proforma was issued (the proforma said 0 % under LUT; the invoice for the money must not turn into an IGST split because the setting changed).
 * A proforma that was not an export has no route (null). Researched 2026-10-28, Rule 96A CGST Rules (08-C RA-19): one LUT per FY, furnished before the first export of that FY.
 * OPEN (08-C RA-19, Q37): must the tax invoice for a payment received after the LUT lapsed charge IGST, or does the earlier FY's LUT cover it? The code refuses the LUT route and lets the Owner choose.
 */
export function proformaRouteOf(
  exportMode: string | null,
  computed: Pick<ComputedDocument, "supply"> | null,
): ExportRoute | null {
  if (exportMode === "lut" || exportMode === "igst_paid") return exportMode;
  if (computed?.supply.type === "export_lut") return "lut";
  if (computed?.supply.type === "export_igst") return "igst_paid";
  return null;
}

/**
 * The lines of the tax invoice made for an amount received: the amount (tax included) is split over the (SAC, rate) groups of the PROFORMA's own tax
 * summary by the inclusive split (the SAME engine as a milestone, LD13), under the client's CURRENT supply and the proforma's export route. More than
 * the engine's cap of groups merge by rate. An INR amount with paise is refused by the engine (`gross_not_whole_unit`, LD28). The description is the
 * 07-S §8 line with the proforma's number.
 */
export function advanceDraft(input: {
  amountMinor: number;
  currency: "INR" | "USD";
  client: ClientRow;
  settings: InvoiceSettings;
  proformaComputed: ComputedDocument;
  /** The proforma's number: the line says what the payment was for (07-S §8). */
  proformaNumber: string;
  exportMode: string | null;
  fx: FxState | null;
  today: CalendarDate;
}): MilestoneDraft {
  const { client, settings, today } = input;
  const ctx = taxContext(settings);
  const supply = determineSupply(taxInputOf(client), ctx, {
    documentDate: today,
    currency: input.currency,
    exportMode:
      client.gst_status === "overseas" && (input.exportMode === "lut" || input.exportMode === "igst_paid")
        ? input.exportMode
        : undefined,
  });
  if (!supply.ok) return { ok: false, errors: supply.errors };
  let groups: InclusiveGroup[] = groupsOf(input.proformaComputed.summary);
  if (groups.length === 0) groups = [{ sac: null, gstRateBp: settings.tax.defaultRateBp, weightMinor: 1 }];
  if (groups.length > MAX_GROUPS) groups = mergeByRate(groups).groups;
  const split = splitInclusive(
    input.amountMinor,
    groups,
    supply.value,
    input.currency,
    input.fx ? { rateMicros: input.fx.rateMicros } : null,
    ctx,
    { documentDate: today, recipientStatus: client.gst_status },
  );
  if (!split.ok) return { ok: false, errors: split.errors };
  const lines: LineState[] = split.value.lines.map((l, i) => {
    const cl = split.value.document.lines[i];
    return {
      id: uuidv7(),
      catalogueItemId: null,
      catalogueRateMinor: null,
      catalogueLine: null,
      description: advanceLineDescription(input.proformaNumber),
      detail: null,
      sac: l.sac,
      qtyMilli: l.qtyMilli,
      unit: "fixed",
      rateMinor: l.rateMinor,
      discountKind: null,
      discountValue: null,
      gstRateBp: cl?.gstRateBp ?? l.gstRateBp ?? 0,
    };
  });
  return { ok: true, lines, amountMinor: input.amountMinor, computed: split.value.document };
}

// ---- what stops an issue ----------------------------------------------------------------------------------------------------------------------

/** What the blockers need beyond the draft: the bank rows, the IST day of the issue and its FY, and the day the exchange rate is judged against. */
export type IssueContext = {
  bank: readonly BankRow[];
  /** The IST day (ISO) of the issue and the FY token it falls in: the LUT of THIS year is the one that is needed. */
  issueDate: string;
  fy: string;
  /** The issue day, or for the advance invoice the day the money arrived (Q9, LD24). */
  fxRefDate: string;
  /** The tax invoice for money already received: paid, so it has no bank block to check. */
  advance?: boolean;
};

/** The facts `issueBlockers` (core) judges, from what the route has read. */
export function issueFactsOf(
  state: InvoiceState,
  client: ClientRow,
  settings: InvoiceSettings,
  c: InvoiceComputation,
  x: IssueContext,
): IssueFacts {
  const addr = client.billing_address ? (JSON.parse(client.billing_address) as { line1?: string }) : null;
  const overseas = client.gst_status === "overseas";
  const mode: ExportRoute =
    state.exportMode === "lut" || state.exportMode === "igst_paid"
      ? state.exportMode
      : settings.tax.exportMode;
  const computed = c.computed;
  return {
    type: state.type,
    currency: state.currency,
    clientCurrency: client.currency,
    supplier: {
      legalName: settings.company.legalName,
      tradeName: settings.company.tradeName,
      address: settings.company.address,
      gstin: settings.company.gstin,
      stateCode: settings.company.stateCode,
    },
    recipient: {
      legalName: client.legal_name,
      addressLine1: addr?.line1 ?? null,
      gstStatus: client.gst_status,
      gstin: client.gstin,
      stateCode: client.state_code,
      countryName: overseas ? countryNameOf(client.country) : null,
    },
    lines: state.lines.map((l) => ({ sac: l.sac, description: l.description })),
    taxErrorCount: c.errors.length,
    totalMinor: computed?.totalMinor ?? null,
    totalInrMinor: computed
      ? computed.currency === "INR"
        ? computed.totalMinor
        : (computed.inr?.totalMinor ?? null)
      : null,
    reverseChargeText: settings.tax.reverseChargeText,
    fx: { value: state.fx, refDate: x.fxRefDate, maxAgeDays: settings.tax.fxMaxAgeDays },
    export: state.type === "export_invoice" ? { mode, issueFy: x.fy, luts: lutsOf(settings.tax) } : null,
    bank: {
      inr: x.bank.some((r) => r.kind === "INR"),
      swift: swiftBankOf(x.bank) !== null,
    },
    advance: x.advance === true,
    b2cThresholdInrMinor: settings.tax.b2cDetailsThresholdInrMinor,
    // T4: judged only where core `signatureRequired` says so (the advance invoice here)
    signatureSaved: settings.company.signature != null,
  };
}

/** Every blocker of a draft under the Owner's checklist (the issue, the issue request and the view all ask this one question). */
export function blockersOf(
  state: InvoiceState,
  client: ClientRow,
  settings: InvoiceSettings,
  c: InvoiceComputation,
  x: IssueContext,
): IssueBlocker[] {
  return issueBlockers(issueFactsOf(state, client, settings, c, x), settings.tax.invoiceChecklist);
}

/** An export invoice in INR needs the Owner's explicit confirmation (Q8; Researched 2026-10-28, s.2(6) IGST Act, Rule 46 (08-C RA-18), s.2(6) IGST Act). */
export const needsInrConfirm = (type: string, currency: string): boolean =>
  type === "export_invoice" && currency === "INR";

export const EXPORT_CURRENCY_CONFIRM = e(
  "export_currency_confirm",
  "Confirm that this export invoice should be in INR.",
);
export const FX_NOT_APPLICABLE = e("fx_not_applicable", "An exchange rate is only needed for USD invoices.");
/** 07-S §8 gives these three codes one shared line. */
const NOT_APPLICABLE_LINE = "This doesn't apply to this type of invoice.";
export const EXPORT_MODE_NOT_APPLICABLE = e("export_mode_not_applicable", NOT_APPLICABLE_LINE);
export const SERVICE_DATE_NOT_APPLICABLE = e("service_date_not_applicable", NOT_APPLICABLE_LINE);
export const EXPORT_DECLARATION_NOT_APPLICABLE = e("export_declaration_not_applicable", NOT_APPLICABLE_LINE);
export const EXPORT_DECLARATION_MISSING = e(
  "export_declaration_missing",
  "The export note in Settings › Terms was removed. Choose again.",
);
export const SERVICE_DATE_FUTURE = e(
  "service_date_future",
  "The service completion date can't be in the future.",
);
/** The words are 07-S §8. */
export const ALREADY_SET = e(
  "already_set",
  "The service completion date is already set and can't be changed.",
);
/** The service date of a void invoice. */
export const INVOICE_VOID = e("invoice_void", "This invoice is void.");
/** The extra export note the draft pinned is no longer the newest one: the person must look at the new text and choose again. */
export const EXPORT_DECLARATION_CHANGED = e(
  "export_declaration_changed",
  "The export note in Settings › Terms changed since this draft was saved. Save the draft again.",
);
/** The newest export note's text does not match its stored SHA-256: nothing is sealed from it (07-S has no line yet). */
export const EXPORT_DECLARATION_TAMPERED = e(
  "export_declaration_tampered",
  "The export note in Settings › Terms doesn't match its saved copy, so the invoice wasn't issued. A developer needs to look at it.",
);
export const NOT_A_PROFORMA = e("not_a_proforma", "That is not a proforma");
export const PROFORMA_NOT_ISSUED = e("proforma_not_issued", "Only an issued proforma can be converted.");
export const ADVANCE_REFERENCE_USED = e(
  "advance_reference_used",
  "This payment reference was already used for this proforma.",
);
export const ADVANCE_EXCEEDS_BALANCE = e(
  "advance_exceeds_balance",
  "The amount can't be more than the proforma's balance.",
);
/**
 * Researched 2026-10-28, Rule 96A CGST Rules (08-C RA-19) (which supply applies, batch Q37's neighbour): a proforma sealed for an overseas client (an export supply) and a client who is no longer
 * overseas, or the reverse. The tax on the payment can't be worked out from the proforma, so the advance route refuses (07-S §8).
 */
export const proformaSupplyChanged = (
  proformaComputed: { supply: { type: string } } | null,
  clientGstStatus: string,
): boolean => {
  if (!proformaComputed) return false;
  const wasExport =
    proformaComputed.supply.type === "export_lut" || proformaComputed.supply.type === "export_igst";
  return wasExport !== (clientGstStatus === "overseas");
};
export const ADVANCE_SUPPLY_CHANGED = e(
  "advance_supply_changed",
  "The client's GST details changed after this proforma was issued, so the tax on this payment can't be worked out from it. Check the client's details with your CA before recording the payment.",
);
/** Q37 (07-S section 9): the message carries the FY as people read it ("2027-28"); the same FY is in the error's `details`. */
export const advanceLutMissing = (fyLabel: string): ApiError =>
  e(
    "advance_lut_missing",
    `There's no LUT saved for FY ${fyLabel}, when this payment was received, so this tax invoice can't be issued without IGST. Save that year's LUT ARN in Settings › Tax first, or issue it with IGST.`,
  );
export const ADVANCE_DATE_INVALID = e(
  "advance_date_invalid",
  "The date received can't be before the proforma's date or in the future.",
);
export const ADVANCE_REFERENCE_INVALID = e(
  "advance_reference_invalid",
  "Enter the payment reference: letters, digits, / and -, up to 60 characters",
);

// ---- the header keys of the seal (LD25) -----------------------------------------------------------------------------------------------------------

/**
 * The M5.2 keys of an invoice's sealed header, each only on the types that need it so an M5.1 seal stays byte-identical:
 * `export` (an export invoice: the endorsement as it is NOW, the LUT of the issue FY on the LUT route, the country, the pinned note),
 * `fx` (a USD tax or export invoice), `proforma` (the notice and, from FX-4, the GST estimate marker), `advance` (the tax invoice made for money received).
 */
export function headerExtrasOf(a: {
  state: InvoiceState;
  settings: InvoiceSettings;
  client: ClientRow;
  issueFy: string;
  /** The route of an export invoice: the draft's own, else the settings'. */
  mode: ExportRoute;
  declaration: (TermsRef & { body_md?: string }) | null;
  advance?: NonNullable<InvoiceHeaderExtras["advance"]> | null;
}): InvoiceHeaderExtras {
  const { state } = a;
  const out: {
    export?: InvoiceHeaderExtras["export"];
    fx?: InvoiceHeaderExtras["fx"];
    proforma?: InvoiceHeaderExtras["proforma"];
    advance?: InvoiceHeaderExtras["advance"];
  } = {};
  if (state.type === "export_invoice") {
    const lut = a.mode === "lut" ? lutFor(a.issueFy, lutsOf(a.settings.tax)) : null;
    out.export = {
      mode: a.mode,
      endorsement: EXPORT_ENDORSEMENT[a.mode],
      lut,
      countryCode: a.client.country,
      countryName: countryNameOf(a.client.country) ?? "",
      declarationRef: a.declaration
        ? { id: a.declaration.id, version: a.declaration.version, sha256: a.declaration.sha256 }
        : null,
      ...(a.declaration?.body_md !== undefined ? { declarationText: a.declaration.body_md } : {}),
    };
  }
  if ((state.type === "tax_invoice" || state.type === "export_invoice") && state.fx)
    out.fx = {
      rateMicros: state.fx.rateMicros,
      date: state.fx.date,
      source: state.fx.source,
      ...(state.fx.noRateDay ? { noRateDay: state.fx.noRateDay } : {}),
    };
  // FX-4 (A5 5): every proforma issued from now on seals the estimate marker with its notice, so its tax heads print "(estimate)"; one sealed before
  // has none and prints as it was (Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28): a proforma's GST is shown as an estimate).
  if (state.type === "proforma") out.proforma = { notice: PROFORMA_NOTICE, gstEstimate: true };
  if (a.advance) out.advance = a.advance;
  return out;
}

// ---- the exchange rate of the day of supply (research round 2026-10-28, Q24; Researched 2026-10-28, 08-C RA-21; 07-S §8) -----------------------------------------------------

const dayWords = (iso: string): string => {
  const d = parseIsoDate(iso);
  return d ? formatDate(d) : iso;
};
/** 400 for the tax invoice of a payment received (07-S §8): the rate is older than the limit, of a later day, or not a date; the line names the day the money arrived and the limit. */
export const fxDateInvalidFor = (receivedOn: string, days: number): ApiError =>
  e(
    "fx_date_invalid",
    `Use the rate published on ${dayWords(receivedOn)}. If none was published that day, use the last one published before it, at most ${days} days earlier.`,
  );
/** 400 (07-S §8): a rate of an earlier day was typed without saying that none was published on the day. */
export const fxSameDayExistsFor = (receivedOn: string): ApiError =>
  e("fx_same_day_exists", `A rate was published on ${dayWords(receivedOn)}, so use that day's rate.`);

export { taxContext, taxInputOf };
