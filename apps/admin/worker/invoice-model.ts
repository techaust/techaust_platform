import { type CalendarDate, istDate } from "@techaust/core/dates";
import { contentHash, type DraftContent } from "@techaust/core/documents";
import { uuidv7 } from "@techaust/core/ids";
import { INVOICE_FLOW_TYPES, type IssueFacts } from "@techaust/core/invoices";
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
  MAX_GROUPS,
  splitInclusive,
  type TaxContext,
  type TaxIssue,
} from "@techaust/core/tax";
import type { DocumentBundle, TermsRef } from "@techaust/db/documents";
import type { InvoiceBankBlock, InvoiceIssuerSnapshot, RecipientSnapshot } from "@techaust/db/issue";
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
export const SERIES_FULL = e("series_full", "This numbering series has no numbers left this year");
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
export const VOID_BLOCKED = e("void_blocked", "This invoice can't be voided");
export const INVOICE_APPROVAL_EXPIRED = e(
  "approval_expired",
  "The invoice changed after the request, so the request expired",
);

// ---- constants -----------------------------------------------------------------------------------------------------------------------

/** The types the invoice routes read: the invoice flow (a receipt or a voucher has no screen before M6). */
export const INVOICE_TYPES_SQL = INVOICE_FLOW_TYPES.map((t) => `'${t}'`).join(", ");

// ---- settings, bank, terms ----------------------------------------------------------------------------------------------------------------

/** Every settings row an invoice reads: the four of the quote model, plus the email identities (the sender printed on the invoice). */
export const INVOICE_SETTINGS_READ =
  "SELECT key, value, version FROM settings WHERE key IN ('company', 'tax', 'payment_terms', 'numbering', 'email')";
/** The newest invoice footer notes (a pin, no text); none is allowed (M5.1). */
export const NEWEST_INVOICE_TERMS =
  "SELECT id, kind, version, sha256 FROM terms_versions WHERE kind = 'invoice' ORDER BY version DESC LIMIT 1";
/** The active bank accounts (at most one per kind). */
export const BANK_READ =
  "SELECT kind, account_name, account_no, ifsc, bank_name, branch, updated_at FROM bank_accounts WHERE active = 1";

export type BankRow = {
  kind: string;
  account_name: string;
  account_no: string;
  ifsc: string | null;
  bank_name: string;
  branch: string | null;
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

/** The INR block an invoice prints (the SWIFT block is M5.2's); null when no INR account is saved. */
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

// ---- the frozen blocks ---------------------------------------------------------------------------------------------------------------------

export type ContactFacts = { id: string; name: string; email: string; anonymised_at: number | null };

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
    ...(contact && contact.anonymised_at === null
      ? { email: contact.email, contactId: contact.id, contactName: contact.name }
      : {}),
  };
}

/** The supplier block: the company as saved, the INR bank block, the signature as a reference (LD11), and the sender (the billing address and who issued it). */
export function issuerOf(
  s: InvoiceSettings,
  bank: readonly BankRow[],
  who: { id: string; name: string },
): InvoiceIssuerSnapshot {
  const c = s.company;
  const sig = c.signature;
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
    },
    bank: { inr: inrBankOf(bank) },
    signature: sig ? { key: sig.key, sha256: sig.sha256, mime: sig.mime } : null,
    sender: { staffId: who.id, name: who.name, email: s.email.senders.billing },
  };
}

// ---- the state of a draft ---------------------------------------------------------------------------------------------------------------------

export type InvoiceState = {
  id: string;
  type: string;
  clientId: string;
  contactId: string | null;
  currency: "INR" | "USD";
  discountKind: "fixed" | "percent" | null;
  discountValue: number | null;
  exportMode: string | null;
  lines: LineState[];
};

/** The invoice's state from the rows `loadStatements` read (its lines are the quote model's lines). */
export function invoiceStateOf(b: DocumentBundle<TermsRef>): InvoiceState {
  const q = stateOfBundle(b);
  return {
    id: q.id,
    type: b.document.type,
    clientId: q.clientId,
    contactId: q.contactId,
    currency: q.currency,
    discountKind: q.discountKind,
    discountValue: q.discountValue,
    exportMode: q.exportMode,
    lines: q.lines,
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
      },
      ctx,
    );
  } else {
    const supply = determineSupply(taxInputOf(client), ctx, {
      documentDate: today,
      currency: state.currency,
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
  amount_minor: number | null;
  pct_bp: number | null;
  status: string;
  document_id: string | null;
  delivered_at: number | null;
  client_id: string;
  budget_minor: number | null;
  source_document_id: string | null;
  source_computed: string | null;
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
      // [Placeholder, 07-R] the line's words: the milestone's title, with the group when there are several.
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

// ---- what stops an issue ----------------------------------------------------------------------------------------------------------------------

/** The facts `issueBlockers` (core) judges, from what the route has read. */
export function issueFactsOf(
  state: InvoiceState,
  client: ClientRow,
  settings: InvoiceSettings,
  c: InvoiceComputation,
): IssueFacts {
  const addr = client.billing_address ? (JSON.parse(client.billing_address) as { line1?: string }) : null;
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
    },
    lines: state.lines.map((l) => ({ sac: l.sac, description: l.description })),
    taxErrorCount: c.errors.length,
    totalMinor: c.computed?.totalMinor ?? null,
    reverseChargeText: settings.tax.reverseChargeText,
  };
}

export { taxContext, taxInputOf };
