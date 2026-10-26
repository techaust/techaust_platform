// The model of proposals and estimates in the admin Worker (M4.3; ADM-PROP-01..07, ADM-EST-01). One code path for both types: the state of a
// draft, how a request changes it, how it is computed (the shared tax engine), hashed and written. No route lives here; the route files
// (documents, document-save, document-send, approvals, document-convert) use it. Money is integer minor units, bigint inside the engine.
// VERIFY WITH CA/LEGAL: every tax rule is the engine's (M4.2); this file adds none.
import type { TaxInput } from "@techaust/core/clients";
import { type CalendarDate, istDate } from "@techaust/core/dates";
import {
  catalogueGuard,
  checkSections,
  contentHash,
  type DraftContent,
  type GuardLine,
  type GuardResult,
  type QuoteType,
  REQUIRED_SECTIONS,
  type SectionDraft,
  unresolvedIn,
} from "@techaust/core/documents";
import { uuidv7 } from "@techaust/core/ids";
import { SCHEDULE_TRIGGERS, type ScheduleTrigger, scheduleText } from "@techaust/core/schedule-text";
import { resolveSetting, type Settings } from "@techaust/core/settings";
import {
  type ComputedDocument,
  computeDocument,
  computeSchedule,
  type Discount,
  type LineInput,
  lutsOf,
  type ScheduleInstalment,
  type TaxContext,
  type TaxIssue,
  type TaxWarning,
} from "@techaust/core/tax";
import type { DocumentBundle, TermsRef } from "@techaust/db/documents";
import type { ApiError } from "./context.ts";

// ---- errors ------------------------------------------------------------------------------------------------------------------

const e = (code: string, message: string): ApiError => ({ code, message });
export const FROZEN = e("frozen", "This version has been sent and can't be changed");
export const NOT_DRAFT = e("not_draft", "Only a draft can be changed");
export const NOT_A_QUOTE = e("not_a_quote", "That is not a proposal or an estimate");
export const CLIENT_GONE = e("client_anonymised", "This client's personal details were removed");
export const SERVICE_INACTIVE = e("service_inactive", "That service is not on offer any more");
export const SERVICE_UNKNOWN = e("service_unknown", "That service does not exist");
export const SERVICE_NOT_PRICED = e(
  "service_not_priced",
  "That service has no price in the client's currency",
);
export const CHOOSE_DEFAULT_LINES = e("choose_default_lines", "Choose which lines of the service to offer");
export const DEFAULT_LINE_UNKNOWN = e("default_line_unknown", "That service has no such line");
export const TOO_MANY_LINES = e("too_many_lines", "A document can have at most 100 lines");
export const SERVICE_DUPLICATE = e("service_duplicate", "Each service can be added once");
export const DEFAULT_LINE_DUPLICATE = e(
  "default_line_duplicate",
  "Each line of a service can be chosen once",
);
export const LINE_UNKNOWN = e("line_unknown", "That line is not on this document");
export const LINE_CATALOGUE_CHANGED = e(
  "line_catalogue_changed",
  "A line's catalogue service can't be changed",
);
export const LINE_TAX_FIXED = e("line_tax_fixed", "The SAC code and GST rate of a catalogue line are fixed");
export const RATE_REQUIRED = e("rate_required", "Give the rate of this line");
export const CONTACT_INVALID = e("contact_invalid", "That contact does not belong to this client");
export const CONTACT_GONE = e("contact_anonymised", "That contact was anonymised");
export const SECTIONS_INVALID = e("sections_invalid", "The sections don't follow the rules");
export const SCHEDULE_INVALID = e("schedule_invalid", "The payment schedule is not valid");
export const CONTENT_CHANGED = e(
  "content_changed",
  "The document changed since it was last saved. Save it again first",
);
export const APPROVAL_REQUIRED = e(
  "approval_required",
  "This discount needs the owner's approval for this version",
);
export const APPROVAL_NOT_NEEDED = e("approval_not_needed", "The discount is within what you can send");
export const APPROVAL_EXISTS = e(
  "approval_exists",
  "This exact version is already approved. Send it, or change it first",
);
export const APPROVAL_PENDING = e("approval_pending", "An approval is already waiting for the owner");
export const APPROVAL_EXPIRED = e(
  "approval_expired",
  "The document changed after the request, so the approval expired",
);
export const NUMBERING_CHANGED = e("numbering_changed", "The numbering settings changed. Try again");
export const APPROVAL_REJECTED = e(
  "approval_rejected",
  "The owner rejected this version. Change it before asking again",
);
export const ALREADY_ACCEPTED = e("already_accepted", "A version of this document was already accepted");
export const NOT_LATEST = e("not_latest", "Only the latest sent version can be revised");
export const DRAFT_EXISTS = e("draft_exists", "A newer draft of this document already exists");
export const NOT_SENT = e("not_sent", "Only a sent version can be revised");
export const TERMS_MISSING = e(
  "terms_missing",
  "There are no proposal terms yet. Add them in Settings first",
);

// ---- constants ---------------------------------------------------------------------------------------------------------------

export const QUOTE_TYPES_SQL = "'proposal', 'estimate'";
/** Lines per document: the engine's own cap (core `MAX_LINES`). */
export const LINES_MAX = 100;
export const SCHEDULE_STEPS_MAX = 24;
export const SECTIONS_PARSE_MAX = 32;

// ---- settings ----------------------------------------------------------------------------------------------------------------

export const SETTINGS_READ =
  "SELECT key, value, version FROM settings WHERE key IN ('company', 'tax', 'payment_terms', 'numbering')";

export type QuoteSettings = {
  company: Settings["company"];
  tax: Settings["tax"];
  paymentTerms: Settings["payment_terms"];
  numbering: Settings["numbering"];
  /** The `version` of the stored numbering row (null: never saved). The send batch refuses if it moved. */
  numberingVersion: number | null;
};

/** The stored settings as the app reads them: the defaults under the stored value, validated. A corrupted row throws (a 500). */
export function readSettings(
  rows: readonly { key: string; value: string; version: number }[],
): QuoteSettings {
  const by = new Map(rows.map((r) => [r.key, r]));
  const get = (key: string) => {
    const r = by.get(key);
    return r ? JSON.parse(r.value) : undefined;
  };
  return {
    company: resolveSetting("company", get("company")),
    tax: resolveSetting("tax", get("tax")),
    paymentTerms: resolveSetting("payment_terms", get("payment_terms")),
    numbering: resolveSetting("numbering", get("numbering")),
    numberingVersion: by.get("numbering")?.version ?? null,
  };
}

export const taxContext = (s: QuoteSettings): TaxContext => ({
  tax: s.tax,
  supplierStateCode: s.company.stateCode,
  luts: lutsOf(s.tax),
});

// ---- rows ---------------------------------------------------------------------------------------------------------------------

export const CLIENT_COLS =
  "id, code, legal_name, display_name, type, country, gst_status, gstin, state_code, billing_address, currency, attach_pdf, anonymised_at";
export const CLIENT_READ = `SELECT ${CLIENT_COLS} FROM clients WHERE id = ?1`;
export type ClientRow = {
  id: string;
  code: string;
  legal_name: string;
  display_name: string;
  type: "business" | "individual";
  country: string;
  gst_status: "registered" | "unregistered" | "overseas";
  gstin: string | null;
  state_code: string | null;
  billing_address: string | null;
  currency: "INR" | "USD";
  attach_pdf: number;
  anonymised_at: number | null;
};
export const taxInputOf = (c: ClientRow): TaxInput => ({
  gstStatus: c.gst_status,
  country: c.country,
  gstin: c.gstin,
  stateCode: c.state_code,
});

export const ITEM_COLS =
  "id, code, name, category, short, unit, sac, gst_rate_bp, price_inr_minor, price_usd_minor, default_lines, schedule, deliverables_md, assumptions_md, exclusions_md, active";
export type ItemRow = {
  id: string;
  code: string;
  name: string;
  category: string;
  short: string;
  unit: string;
  sac: string;
  gst_rate_bp: number | null;
  price_inr_minor: number | null;
  price_usd_minor: number | null;
  default_lines: string | null;
  schedule: string;
  deliverables_md: string | null;
  assumptions_md: string | null;
  exclusions_md: string | null;
  active: number;
};
/** Items by id, for a request that names services: `json_each` keeps it to one bound value, whatever the count. */
export const ITEMS_BY_ID = `SELECT ${ITEM_COLS} FROM catalogue_items WHERE id IN (SELECT value FROM json_each(?1))`;
/** The newest proposal terms (the one a new draft pins), without the text: no admin route reads it. Version numbers only go up. */
export const NEWEST_TERMS =
  "SELECT id, kind, version, sha256 FROM terms_versions WHERE kind = 'proposal' ORDER BY version DESC LIMIT 1";

// ---- the state of a draft ------------------------------------------------------------------------------------------------------

export type LineState = {
  id: string;
  catalogueItemId: string | null;
  /** Server-only. Copied from the catalogue when the line was added; kept across saves and revisions; never read from a request. */
  catalogueRateMinor: number | null;
  /** Server-only, like the rate: the name of the catalogue default line this line was made from (a care tier, say), or null. */
  catalogueLine: string | null;
  description: string;
  detail: string | null;
  sac: string | null;
  qtyMilli: number;
  unit: string;
  rateMinor: number;
  discountKind: "fixed" | "percent" | null;
  discountValue: number | null;
  gstRateBp: number;
};
export type SectionState = SectionDraft & { id: string };
export type StepState = {
  id: string;
  label: string;
  trigger: ScheduleTrigger;
  pctBp: number;
  detail: string | null;
  targetDate: string | null;
};
export type DocState = {
  id: string;
  type: QuoteType;
  clientId: string;
  contactId: string | null;
  title: string | null;
  currency: "INR" | "USD";
  validityDays: number | null;
  termsVersionId: string | null;
  discountKind: "fixed" | "percent" | null;
  discountValue: number | null;
  exportMode: string | null;
  lines: LineState[];
  sections: SectionState[];
  schedule: StepState[];
};

const kindOf = (v: string | null): "fixed" | "percent" | null =>
  v === "fixed" || v === "percent" ? v : null;
const stepTrigger = (v: string): ScheduleTrigger => SCHEDULE_TRIGGERS.find((t) => t === v) ?? "on_accept";

/** The editor's state of a draft (or of a sent version, to copy it) from the rows `loadDocument` read. */
export function stateOfBundle(b: DocumentBundle<TermsRef>): DocState {
  const d = b.document;
  return {
    id: d.id,
    type: d.type === "estimate" ? "estimate" : "proposal",
    clientId: d.client_id,
    contactId: d.contact_id,
    title: d.title,
    currency: d.currency === "USD" ? "USD" : "INR",
    validityDays: d.validity_days,
    termsVersionId: d.terms_version_id,
    discountKind: kindOf(d.discount_kind),
    discountValue: d.discount_value,
    exportMode: d.export_mode,
    lines: b.lines.map((r) => ({
      id: r.id,
      catalogueItemId: r.catalogue_item_id,
      catalogueRateMinor: r.catalogue_rate_minor,
      catalogueLine: r.catalogue_line,
      description: r.description,
      detail: r.detail,
      sac: r.sac,
      qtyMilli: r.qty_milli,
      unit: r.unit,
      rateMinor: r.rate_minor,
      discountKind: kindOf(r.discount_kind),
      discountValue: r.discount_value,
      gstRateBp: r.gst_rate_bp,
    })),
    sections: b.sections.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      bodyMd: r.body_md,
      hidden: r.hidden === 1,
    })),
    schedule: b.schedule.map((r) => ({
      id: r.id,
      label: r.label,
      trigger: stepTrigger(r.trigger),
      pctBp: r.pct_bp,
      detail: r.detail,
      targetDate: r.target_date,
    })),
  };
}

// ---- request parts (strict objects are in the route files; these are the shapes they produce) -------------------------------------------

export type LineIn = {
  id?: string | undefined;
  catalogueItemId?: string | null | undefined;
  defaultLine?: string | undefined;
  description: string;
  detail?: string | null | undefined;
  sac?: string | null | undefined;
  gstRateBp?: number | undefined;
  qtyMilli: number;
  unit: string;
  rateMinor?: number | undefined;
  discount?: { kind: "fixed" | "percent"; value: number } | null | undefined;
};
export type SectionIn = {
  id?: string | undefined;
  kind: string;
  title?: string | null | undefined;
  bodyMd?: string | null | undefined;
  hidden?: boolean | undefined;
};
export type StepIn = {
  id?: string | undefined;
  label: string;
  trigger: ScheduleTrigger;
  pctBp: number;
  detail?: string | null | undefined;
  targetDate?: string | null | undefined;
};

export type Refusal = { error: ApiError; status: 400 | 409 };
const refuse = (error: ApiError, status: 400 | 409 = 400): { ok: false } & Refusal => ({
  ok: false,
  error,
  status,
});

type DefaultLineJson = {
  description: string;
  unit: string;
  qtyMilli: number;
  rateInrMinor: number | null;
  rateUsdMinor: number | null;
};
const parseJson = <T>(s: string | null, fallback: T): T => {
  if (s === null) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

/** The name of a service as a line says it: "and", never "&" (the content rule). */
export const lineName = (name: string): string => name.replaceAll(" & ", " and ");

/**
 * The lines a service gives a draft, priced in the client's currency. A service with default lines needs the ones to offer chosen;
 * one without gives a single line at its headline price. The catalogue rate is the line's own rate here (it is the reference of the
 * discount guard). SAC and GST rate come from the catalogue (the rate from the settings when the item has none).
 */
export function itemLines(
  item: ItemRow,
  currency: "INR" | "USD",
  chosen: readonly string[] | undefined,
  defaultRateBp: number,
): { ok: true; lines: LineState[] } | ({ ok: false } & Refusal) {
  const defaults = parseJson<DefaultLineJson[]>(item.default_lines, []);
  const rate = (inr: number | null, usd: number | null) => (currency === "INR" ? inr : usd);
  const make = (
    description: string,
    unit: string,
    qtyMilli: number,
    rateMinor: number,
    catalogueLine: string | null,
  ): LineState => ({
    id: uuidv7(),
    catalogueItemId: item.id,
    catalogueRateMinor: rateMinor,
    catalogueLine,
    description,
    detail: null,
    sac: item.sac,
    qtyMilli,
    unit,
    rateMinor,
    discountKind: null,
    discountValue: null,
    gstRateBp: item.gst_rate_bp ?? defaultRateBp,
  });
  if (defaults.length > 0) {
    if (!chosen || chosen.length === 0) return refuse(CHOOSE_DEFAULT_LINES);
    const lines: LineState[] = [];
    for (const name of chosen) {
      const d = defaults.find((x) => x.description === name);
      if (!d) return refuse(DEFAULT_LINE_UNKNOWN);
      const r = rate(d.rateInrMinor, d.rateUsdMinor);
      if (r === null) return refuse(SERVICE_NOT_PRICED, 409);
      lines.push(make(d.description, d.unit, d.qtyMilli, r, d.description));
    }
    return { ok: true, lines };
  }
  if (chosen && chosen.length > 0) return refuse(DEFAULT_LINE_UNKNOWN);
  const r = rate(item.price_inr_minor, item.price_usd_minor);
  if (r === null) return refuse(SERVICE_NOT_PRICED, 409);
  return { ok: true, lines: [make(lineName(item.name), item.unit, 1000, r, null)] };
}

/**
 * Applies a request's lines to the stored ones. The request is the whole list. An existing line (by id) keeps its catalogue service,
 * its catalogue rate and, for a catalogue line, its SAC and GST rate: asking to change them is a 400. A new catalogue line takes all
 * of those from the catalogue (an inactive service is a 409). `catalogueRateMinor` is never taken from a request.
 */
export function resolveLines(
  input: readonly LineIn[],
  existing: readonly LineState[],
  items: ReadonlyMap<string, ItemRow>,
  currency: "INR" | "USD",
  defaultRateBp: number,
): { ok: true; lines: LineState[] } | ({ ok: false } & Refusal) {
  const byId = new Map(existing.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const out: LineState[] = [];
  for (const l of input) {
    const discountKind = l.discount ? l.discount.kind : null;
    const discountValue = l.discount ? l.discount.value : null;
    if (l.id !== undefined) {
      const old = byId.get(l.id);
      if (!old || seen.has(l.id)) return refuse(LINE_UNKNOWN);
      seen.add(l.id);
      if (l.catalogueItemId !== undefined && l.catalogueItemId !== old.catalogueItemId)
        return refuse(LINE_CATALOGUE_CHANGED);
      const fromCatalogue = old.catalogueItemId !== null;
      if (
        fromCatalogue &&
        ((l.sac !== undefined && l.sac !== old.sac) ||
          (l.gstRateBp !== undefined && l.gstRateBp !== old.gstRateBp))
      )
        return refuse(LINE_TAX_FIXED);
      if (l.rateMinor === undefined) return refuse(RATE_REQUIRED);
      out.push({
        id: old.id,
        catalogueItemId: old.catalogueItemId,
        catalogueRateMinor: old.catalogueRateMinor,
        catalogueLine: old.catalogueLine,
        description: l.description,
        detail: l.detail ?? null,
        sac: fromCatalogue ? old.sac : l.sac !== undefined ? l.sac : old.sac,
        qtyMilli: l.qtyMilli,
        unit: l.unit,
        rateMinor: l.rateMinor,
        discountKind,
        discountValue,
        gstRateBp: fromCatalogue ? old.gstRateBp : (l.gstRateBp ?? old.gstRateBp),
      });
      continue;
    }
    if (l.catalogueItemId) {
      const item = items.get(l.catalogueItemId);
      if (!item) return refuse(SERVICE_UNKNOWN);
      if (item.active !== 1) return refuse(SERVICE_INACTIVE, 409);
      const made = itemLines(
        item,
        currency,
        l.defaultLine === undefined ? undefined : [l.defaultLine],
        defaultRateBp,
      );
      if (!made.ok) return made;
      const base = made.lines[0] as LineState;
      if (
        (l.sac !== undefined && l.sac !== base.sac) ||
        (l.gstRateBp !== undefined && l.gstRateBp !== base.gstRateBp)
      )
        return refuse(LINE_TAX_FIXED);
      out.push({
        ...base,
        description: l.description,
        detail: l.detail ?? null,
        qtyMilli: l.qtyMilli,
        unit: l.unit,
        rateMinor: l.rateMinor ?? base.rateMinor,
        discountKind,
        discountValue,
      });
      continue;
    }
    if (l.rateMinor === undefined) return refuse(RATE_REQUIRED);
    out.push({
      id: uuidv7(),
      catalogueItemId: null,
      catalogueRateMinor: null,
      catalogueLine: null,
      description: l.description,
      detail: l.detail ?? null,
      sac: l.sac ?? null,
      qtyMilli: l.qtyMilli,
      unit: l.unit,
      rateMinor: l.rateMinor,
      discountKind,
      discountValue,
      gstRateBp: l.gstRateBp ?? defaultRateBp,
    });
  }
  return { ok: true, lines: out };
}

/** The request's sections or schedule steps, with ids kept where they exist and made where they do not. */
export function resolveSections(
  input: readonly SectionIn[],
  existing: readonly SectionState[],
): SectionState[] {
  const known = new Set(existing.map((s) => s.id));
  const used = new Set<string>();
  return input.map((s) => {
    const id = s.id !== undefined && known.has(s.id) && !used.has(s.id) ? s.id : uuidv7();
    used.add(id);
    return { id, kind: s.kind, title: s.title ?? null, bodyMd: s.bodyMd ?? null, hidden: s.hidden === true };
  });
}
export function resolveSteps(input: readonly StepIn[], existing: readonly StepState[]): StepState[] {
  const known = new Set(existing.map((s) => s.id));
  const used = new Set<string>();
  return input.map((s) => {
    const id = s.id !== undefined && known.has(s.id) && !used.has(s.id) ? s.id : uuidv7();
    used.add(id);
    return {
      id,
      label: s.label,
      trigger: s.trigger,
      pctBp: s.pctBp,
      detail: s.detail ?? null,
      targetDate: s.targetDate ?? null,
    };
  });
}

// ---- computing a draft --------------------------------------------------------------------------------------------------------------

export type Warning = { code: string; path: readonly (string | number)[] };

export type Computation = {
  draft: DraftContent;
  computed: ComputedDocument | null;
  errors: TaxIssue[];
  warnings: Warning[];
  /** One per schedule step, in order; null when the document or the schedule did not compute. */
  instalments: ScheduleInstalment[] | null;
  guard: GuardResult;
  hash: string;
};

const discountOf = (s: DocState): Discount | null => {
  if (s.discountKind === null || s.discountValue === null) return null;
  return s.discountKind === "fixed"
    ? { kind: "fixed", minor: s.discountValue }
    : { kind: "percent", bp: s.discountValue };
};

const lineDiscountOf = (l: LineState): Discount | null => {
  if (l.discountValue === null) return null;
  if (l.discountKind === "fixed") return { kind: "fixed", minor: l.discountValue };
  return l.discountKind === "percent" ? { kind: "percent", bp: l.discountValue } : null;
};

export const draftContentOf = (s: DocState): DraftContent => ({
  type: s.type,
  clientId: s.clientId,
  contactId: s.contactId,
  title: s.title,
  currency: s.currency,
  validityDays: s.validityDays,
  termsVersionId: s.termsVersionId,
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
  sections: s.sections.map((x) => ({ kind: x.kind, title: x.title, bodyMd: x.bodyMd, hidden: x.hidden })),
  schedule: s.schedule.map((x) => ({
    label: x.label,
    trigger: x.trigger,
    pctBp: x.pctBp,
    detail: x.detail,
    targetDate: x.targetDate,
  })),
});

/** The IST calendar date of an instant (the date the tax engine judges a draft by). */
export const todayIst = (now = Date.now()): CalendarDate => istDate(now);

/**
 * Works a draft out: the tax (the engine, from the client's current record), the instalments, the discount guard and the content
 * hash. Never throws for any state; a draft that cannot compute yet (no lines, a client without a state) comes back with `errors`,
 * a null `computed` and still a hash, so it can be saved and finished later. M4.3 passes neither `trustRates` nor
 * `targetTotalMinor` to the engine.
 */
export async function computeQuote(
  state: DocState,
  recipient: TaxInput,
  ctx: TaxContext,
  today: CalendarDate,
): Promise<Computation> {
  const lines: LineInput[] = state.lines.map((l) => ({
    sac: l.sac,
    qtyMilli: l.qtyMilli,
    rateMinor: l.rateMinor,
    gstRateBp: l.gstRateBp,
    discount: lineDiscountOf(l),
  }));
  const result = computeDocument(
    {
      currency: state.currency,
      documentDate: today,
      recipient,
      lines,
      documentDiscount: discountOf(state),
      exportMode:
        state.exportMode === "lut" || state.exportMode === "igst_paid" ? state.exportMode : undefined,
    },
    ctx,
  );
  const errors: TaxIssue[] = result.ok ? [] : [...result.errors];
  const warnings: Warning[] = result.ok ? [...result.warnings] : [];
  const computed = result.ok ? result.value : null;
  let instalments: ScheduleInstalment[] | null = null;
  if (computed && state.schedule.length > 0) {
    const s = computeSchedule(
      computed.totalMinor,
      state.currency,
      state.schedule.map((x) => ({ label: x.label, trigger: x.trigger, pctBp: x.pctBp })),
      ctx,
    );
    if (s.ok) {
      instalments = s.value;
      warnings.push(...s.warnings);
    } else errors.push(...s.errors);
  }
  if (state.type === "proposal") {
    state.lines.forEach((l, i) => {
      if (l.unit === "month") warnings.push({ code: "monthly_line_in_proposal", path: ["lines", i] });
    });
  }
  const guardLines: GuardLine[] = state.lines.map((l) => ({
    catalogueItemId: l.catalogueItemId,
    catalogueRateMinor: l.catalogueRateMinor,
    qtyMilli: l.qtyMilli,
  }));
  const guard = computed
    ? catalogueGuard(guardLines, computed)
    : { referenceMinor: 0, taxableMinor: 0, discountMinor: 0, discountBp: 0, needsApproval: false };
  const draft = draftContentOf(state);
  return { draft, computed, errors, warnings, instalments, guard, hash: await contentHash(draft, computed) };
}

// ---- writing a draft --------------------------------------------------------------------------------------------------------------------

/** The `documents` columns a save writes (everything that depends on the content), in the order of `DOC_SAVE_SET`. */
export function documentColumns(s: DocState, c: Computation) {
  const k = c.computed;
  return {
    terms_version_id: s.termsVersionId,
    title: s.title,
    contact_id: s.contactId,
    validity_days: s.validityDays,
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
    catalogue_reference_minor: c.guard.referenceMinor,
    content_sha256: c.hash,
  };
}

/** The lines as rows for `INSERT ... SELECT ... FROM json_each(?)`: keys are the column names. */
export function lineRows(s: DocState, c: Computation) {
  return s.lines.map((l, i) => {
    const k = c.computed?.lines[i];
    return {
      id: l.id,
      position: i + 1,
      catalogue_item_id: l.catalogueItemId,
      description: l.description,
      detail: l.detail,
      sac: l.sac,
      qty_milli: l.qtyMilli,
      unit: l.unit,
      rate_minor: l.rateMinor,
      discount_kind: l.discountKind,
      discount_value: l.discountValue,
      taxable_minor: k?.taxableMinor ?? 0,
      gst_rate_bp: k?.gstRateBp ?? l.gstRateBp,
      cgst_minor: k?.cgstMinor ?? 0,
      sgst_minor: k?.sgstMinor ?? 0,
      igst_minor: k?.igstMinor ?? 0,
      line_total_minor: k?.lineTotalMinor ?? 0,
      catalogue_rate_minor: l.catalogueRateMinor,
      catalogue_line: l.catalogueLine,
    };
  });
}
export const sectionRows = (s: DocState) =>
  s.sections.map((x, i) => ({
    id: x.id,
    position: i + 1,
    kind: x.kind,
    hidden: x.hidden ? 1 : 0,
    title: x.title,
    body_md: x.bodyMd,
  }));
export const scheduleRows = (s: DocState, c: Computation) =>
  s.schedule.map((x, i) => ({
    id: x.id,
    position: i + 1,
    label: x.label,
    trigger: x.trigger,
    pct_bp: x.pctBp,
    amount_minor: c.instalments?.[i]?.amountMinor ?? 0,
    detail: x.detail,
    target_date: x.targetDate,
  }));

type ChildTable = "document_lines" | "document_sections" | "payment_schedules";

const CHILD_COLUMNS: Record<ChildTable, readonly string[]> = {
  document_lines: [
    "id",
    "position",
    "catalogue_item_id",
    "description",
    "detail",
    "sac",
    "qty_milli",
    "unit",
    "rate_minor",
    "discount_kind",
    "discount_value",
    "taxable_minor",
    "gst_rate_bp",
    "cgst_minor",
    "sgst_minor",
    "igst_minor",
    "line_total_minor",
    "catalogue_rate_minor",
    "catalogue_line",
  ],
  document_sections: ["id", "position", "kind", "hidden", "title", "body_md"],
  payment_schedules: [
    "id",
    "position",
    "label",
    "trigger",
    "pct_bp",
    "amount_minor",
    "detail",
    "target_date",
  ],
};

type Guarded = { sql: (at: number) => string; params: readonly unknown[] };
type ChildRow = Readonly<Record<string, unknown>>;

/** `INSERT ... SELECT ... FROM json_each(?2)`: one statement and one bound value, whatever the number of rows (D1 allows 100 bound values). */
function insertStatement(
  db: D1Database,
  table: ChildTable,
  documentId: string,
  rows: readonly ChildRow[],
  g: Guarded,
): D1PreparedStatement {
  const keys = CHILD_COLUMNS[table];
  const exprs = ["document_id", ...keys].map((k) =>
    k === "document_id" ? "?1" : `json_extract(value, '$.${k}')`,
  );
  return db
    .prepare(
      `INSERT INTO ${table} (document_id, ${keys.join(", ")}) SELECT ${exprs.join(", ")} FROM json_each(?2) WHERE ${g.sql(3)}`,
    )
    .bind(documentId, JSON.stringify(rows), ...g.params);
}

const sameValue = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/**
 * Brings the stored child rows of a draft to `rows` by DIFF (M4.3 review fix 2): rows whose columns did not change cost nothing, so a
 * one-line edit writes one line row and not the whole part. Rows are matched by id; the caller read `stored` in the same batch as the
 * document's `updated_at`, and every statement is guarded (the request's audit row), so a racing save leaves them untouched.
 *
 * Order (the `(document_id, position)` indexes are unique and checked row by row):
 * 1. DELETE the removed rows (frees their positions);
 * 2. only when a moved row targets the old position of another moved row, park the rows whose old position is a target at the negative
 *    of it (they are moved on in step 3; a swap or a block that shifts would otherwise collide);
 * 3. UPDATE the changed rows, only the columns that changed in at least one of them (one `UPDATE ... FROM json_each`);
 * 4. INSERT the new rows (their positions are free by now).
 */
export function diffChildren(
  db: D1Database,
  table: ChildTable,
  documentId: string,
  stored: readonly ChildRow[],
  rows: readonly ChildRow[],
  g: Guarded,
): D1PreparedStatement[] {
  const keys = CHILD_COLUMNS[table];
  const was = new Map(stored.map((r) => [r.id as string, r]));
  const now = new Set(rows.map((r) => r.id as string));
  const removed = stored.filter((r) => !now.has(r.id as string)).map((r) => r.id as string);
  const added = rows.filter((r) => !was.has(r.id as string));
  const changed: { row: ChildRow; cols: string[] }[] = [];
  for (const r of rows) {
    const old = was.get(r.id as string);
    if (!old) continue;
    const cols = keys.filter((k) => k !== "id" && !sameValue(old[k], r[k]));
    if (cols.length > 0) changed.push({ row: r, cols });
  }
  const out: D1PreparedStatement[] = [];
  if (removed.length > 0)
    out.push(
      db
        .prepare(
          `DELETE FROM ${table} WHERE document_id = ?1 AND id IN (SELECT value FROM json_each(?2)) AND ${g.sql(3)}`,
        )
        .bind(documentId, JSON.stringify(removed), ...g.params),
    );
  const moved = changed.filter((x) => x.cols.includes("position"));
  const targets = new Set(moved.map((x) => x.row.position as number));
  const parked = moved.filter((x) => targets.has(was.get(x.row.id as string)?.position as number));
  // A row only needs parking when its old position is a target of a move; a pure append or a replacement of a deleted row needs none.
  if (parked.length > 0)
    out.push(
      db
        .prepare(
          `UPDATE ${table} SET position = -position WHERE document_id = ?1 AND id IN (SELECT value FROM json_each(?2)) AND ${g.sql(3)}`,
        )
        .bind(documentId, JSON.stringify(parked.map((x) => x.row.id)), ...g.params),
    );
  if (changed.length > 0) {
    const cols = keys.filter((k) => changed.some((x) => x.cols.includes(k)));
    const payload = changed.map((x) => {
      const o: Record<string, unknown> = { id: x.row.id };
      for (const k of cols) o[k] = x.row[k] ?? null;
      return o;
    });
    out.push(
      db
        .prepare(
          `UPDATE ${table} SET ${cols.map((k) => `${k} = json_extract(j.value, '$.${k}')`).join(", ")} FROM json_each(?2) AS j WHERE ${table}.document_id = ?1 AND ${table}.id = json_extract(j.value, '$.id') AND ${g.sql(3)}`,
        )
        .bind(documentId, JSON.stringify(payload), ...g.params),
    );
  }
  if (added.length > 0) out.push(insertStatement(db, table, documentId, added, g));
  return out;
}

/** Insert only (a new document has no rows to replace). */
export function insertChildren(
  db: D1Database,
  table: ChildTable,
  documentId: string,
  rows: readonly ChildRow[],
  g: Guarded,
): D1PreparedStatement[] {
  return rows.length === 0 ? [] : [insertStatement(db, table, documentId, rows, g)];
}

/** `INSERT INTO documents (cols) SELECT values WHERE <guard>`: the row is written only while the guard holds. Column names are code constants. */
export function insertDocument(
  db: D1Database,
  columns: Readonly<Record<string, unknown>>,
  guard: Guarded,
): D1PreparedStatement {
  const keys = Object.keys(columns);
  return db
    .prepare(
      `INSERT INTO documents (${keys.join(", ")}) SELECT ${keys.map((_, i) => `?${i + 1}`).join(", ")} WHERE ${guard.sql(keys.length + 1)}`,
    )
    .bind(...Object.values(columns), ...guard.params);
}

/** The `documents` columns of a new draft (the version, the group and who made it come from the caller). */
export function draftColumns(
  s: DocState,
  c: Computation,
  meta: { groupId: string; version: number; createdBy: string; now: number },
): Record<string, unknown> {
  return {
    id: s.id,
    type: s.type,
    status: "draft",
    client_id: s.clientId,
    version_group_id: meta.groupId,
    version: meta.version,
    currency: s.currency,
    created_by: meta.createdBy,
    created_at: meta.now,
    updated_at: meta.now,
    ...documentColumns(s, c),
  };
}

// ---- what stops a send (also shown on the draft) ---------------------------------------------------------------------------------------

export type Blocker = {
  code: string;
  /** `unresolved_placeholders`: the names still in the text. */
  names?: string[];
  /** `sections_invalid`: which rules. */
  codes?: string[];
  /** `tax_errors`: the engine's issues (codes and paths, never values). */
  issues?: readonly TaxIssue[];
  /** `section_empty`: the visible optional sections with no text, in order: their ids, and their kinds (same order). */
  sections?: string[];
  kinds?: string[];
};

/** Everything that stops a draft being sent, as codes. Empty means it can be sent (the discount approval is a separate 403). */
export function sendBlockers(
  s: DocState,
  c: Computation,
  facts: { clientGone: boolean; contactGone: boolean },
): Blocker[] {
  const out: Blocker[] = [];
  if (facts.clientGone) out.push({ code: CLIENT_GONE.code });
  if (facts.contactGone) out.push({ code: CONTACT_GONE.code });
  if (!s.title || s.title.trim() === "") out.push({ code: "title_required" });
  if (s.lines.length === 0) out.push({ code: "no_lines" });
  const issues = c.errors.filter((i) => i.code !== "no_lines");
  if (issues.length > 0) out.push({ code: "tax_errors", issues });
  const sectionIssues = checkSections(s.sections);
  if (sectionIssues.length > 0) out.push({ code: SECTIONS_INVALID.code, codes: sectionIssues });
  // A visible optional section with no text would be frozen and sent as a bare heading: staff write it or hide it (M4.3 review 8).
  const empty = s.sections.filter(
    (x) => !x.hidden && !REQUIRED_SECTIONS.some((k) => k === x.kind) && (x.bodyMd ?? "").trim() === "",
  );
  if (empty.length > 0)
    out.push({ code: "section_empty", sections: empty.map((x) => x.id), kinds: empty.map((x) => x.kind) });
  if (s.schedule.length === 0) out.push({ code: "schedule_missing" });
  const names = unresolvedIn([
    s.title,
    ...s.lines.flatMap((l) => [l.description, l.detail]),
    ...s.sections.flatMap((x) => [x.title, x.bodyMd]),
    ...s.schedule.flatMap((x) => [x.label, x.detail]),
  ]);
  if (names.length > 0) out.push({ code: "unresolved_placeholders", names });
  if (s.termsVersionId === null) out.push({ code: TERMS_MISSING.code });
  return out;
}

// ---- views ---------------------------------------------------------------------------------------------------------------------------

export const scheduleSentence = (
  steps: readonly { label: string; pctBp: number; trigger?: ScheduleTrigger }[],
): string | null => {
  try {
    return scheduleText(steps);
  } catch {
    return null;
  }
};

export type { TaxWarning };
