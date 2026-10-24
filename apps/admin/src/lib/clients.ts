// How the Clients screens read and write (M3.3, ADM-CLI-01..05): the labels, addresses and tags as form text and back,
// the two edit forms of a client page (details and billing) as drafts of plain text, the patches that send only what the
// person changed (the M3.2 drafts rule), where an API refusal lands, the activity in words and the data export file.
// Pure, so the rules are tested without a browser. GST treatment and data-subject items: VERIFY WITH CA/LEGAL.
import { ERASE_REASONS, type EraseReason } from "@techaust/core/clients";
import { countryName } from "@techaust/core/form-labels";
import { isStateCode, STATE_CODES, validateGstin } from "@techaust/core/gstin";
import type {
  Address,
  BillingPatch,
  ClientActivity,
  ClientPatch,
  ClientType,
  ClientView,
  ContactView,
  Currency,
  ExportPart,
  ExportSummary,
  GstStatus,
} from "../api.ts";
import { type Draft, rebase } from "../routes/leads/drafts.ts";

export const GST_STATUS_LABELS: Record<GstStatus, string> = {
  registered: "Registered",
  unregistered: "Unregistered",
  overseas: "Overseas",
};
export const GST_STATUSES = Object.keys(GST_STATUS_LABELS) as GstStatus[];
export const TYPE_LABELS = { business: "Business", individual: "Individual" } as const;
export const CURRENCY_LABELS: Record<Currency, string> = {
  INR: "Indian rupee (INR)",
  USD: "US dollar (USD)",
};

/** The reasons, in the words of 07-J (approved). */
export const ERASE_REASON_LABELS: Record<EraseReason, string> = {
  requested: "They asked to be erased",
  consent_withdrawn: "They withdrew consent",
  not_needed: "No longer needed",
  other: "Other",
};
export { ERASE_REASONS };

/** "West Bengal (19)"; an unknown code as it is. */
export const stateText = (code: string | null | undefined) =>
  code ? (isStateCode(code) ? `${STATE_CODES[code].name} (${code})` : code) : "";

/** An address as its printed lines (empty parts left out; the country by name). */
export function addressLines(a: Address | null | undefined): string[] {
  if (!a) return [];
  const place = [a.city, [a.state, a.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.line1, a.line2 ?? "", place, countryName(a.country)].filter((l) => l && l.trim() !== "");
}

// ---- forms as text ----------------------------------------------------------------------------------------------------

export type AddressForm = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};
export const addressForm = (a: Address | null | undefined, country: string): AddressForm => ({
  line1: a?.line1 ?? "",
  line2: a?.line2 ?? "",
  city: a?.city ?? "",
  state: a?.state ?? "",
  postalCode: a?.postalCode ?? "",
  country: a?.country ?? country,
});

const t = (v: string) => v.trim();

/** null when nothing was typed (the country alone doesn't make an address). */
export function toAddress(f: AddressForm): Address | null {
  if (![f.line1, f.line2, f.city, f.state, f.postalCode].some((v) => t(v))) return null;
  const a: Address = { line1: t(f.line1), city: t(f.city), country: f.country };
  if (t(f.line2)) a.line2 = t(f.line2);
  if (t(f.state)) a.state = t(f.state);
  if (t(f.postalCode)) a.postalCode = t(f.postalCode);
  return a;
}

/** The two lines an address needs once anything is typed: the first line and the city. */
export function addressErrors(f: AddressForm, prefix: string): Record<string, string> {
  const e: Record<string, string> = {};
  if (!toAddress(f)) return e;
  if (!t(f.line1)) e[`${prefix}-line1`] = "Enter the first line of the address.";
  if (!t(f.city)) e[`${prefix}-city`] = "Enter the town or city.";
  return e;
}

/** "design, retainer" → ["design", "retainer"]: trimmed, no empties, no repeats (any case), at most 20 of 40 characters. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const tag = raw.trim().slice(0, 40);
    if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, 20);
}
export const tagsText = (tags: string[] | null | undefined) => (tags ?? []).join(", ");

/** "-3, 0, 7" → [-3, 0, 7] (−60 to 365 days, at most 10, sorted, no repeats); null when a value isn't a whole number. */
export function parseOffsets(text: string): number[] | null {
  const parts = text
    .replaceAll("−", "-")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    if (!/^-?\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < -60 || n > 365) return null;
    if (!out.includes(n)) out.push(n);
  }
  if (out.length > 10) return null;
  return out.sort((a, b) => a - b);
}
export const offsetsText = (o: number[] | undefined) => (o ?? []).join(", ");

// ---- the details draft (PATCH /clients/:id) ------------------------------------------------------------------------

export type DetailsForm = {
  legalName: string;
  displayName: string;
  type: string;
  tags: string;
  notes: string;
} & { [K in keyof AddressForm as `svc_${K}`]: string };

const prefixed = <P extends string>(p: P, a: AddressForm) =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [`${p}_${k}`, v])) as {
    [K in keyof AddressForm as `${P}_${K}`]: string;
  };
const unprefixed = (p: string, f: Record<string, string>): AddressForm => ({
  line1: f[`${p}_line1`] ?? "",
  line2: f[`${p}_line2`] ?? "",
  city: f[`${p}_city`] ?? "",
  state: f[`${p}_state`] ?? "",
  postalCode: f[`${p}_postalCode`] ?? "",
  country: f[`${p}_country`] ?? "",
});
export const serviceAddressOf = (f: DetailsForm) => unprefixed("svc", f);

export const detailsOf = (c: ClientView): DetailsForm => ({
  legalName: c.legalName,
  displayName: c.displayName,
  type: c.type,
  tags: tagsText(c.tags),
  notes: c.notes ?? "",
  ...prefixed("svc", addressForm(c.serviceAddress, c.country)),
});

const ADDRESS_KEYS = ["line1", "line2", "city", "state", "postalCode", "country"] as const;
const addressChanged = (p: string, d: Draft<Record<string, string>>) =>
  ADDRESS_KEYS.some((k) => d.value[`${p}_${k}`] !== d.base[`${p}_${k}`]);

/** Only the fields that differ from the draft's base (re-check R1 of M3.2): another person's change is never sent back. */
export function detailsPatch(d: Draft<DetailsForm>): Omit<ClientPatch, "expectedUpdatedAt"> {
  const p: Omit<ClientPatch, "expectedUpdatedAt"> = {};
  const { base, value } = d;
  if (t(value.legalName) !== base.legalName) p.legalName = t(value.legalName);
  if (t(value.displayName) !== base.displayName) p.displayName = t(value.displayName) || t(value.legalName);
  if (value.type !== base.type) p.type = value.type as ClientType;
  if (value.tags !== base.tags) {
    const tags = parseTags(value.tags);
    p.tags = tags.length ? tags : null;
  }
  if (t(value.notes) !== t(base.notes)) p.notes = t(value.notes) || null;
  if (addressChanged("svc", d as unknown as Draft<Record<string, string>>))
    p.serviceAddress = toAddress(serviceAddressOf(value));
  return p;
}

// ---- the billing draft (PATCH /clients/:id/billing, clients.finance.write) -------------------------------------------

export type ReminderChoice = "default" | "on" | "off";
export type BillingForm = {
  country: string;
  gstStatus: string;
  gstin: string;
  stateCode: string;
  currency: string;
  terms: string;
  reminders: string;
  offsets: string;
  careAutoIssue: string;
  attachPdf: string;
} & { [K in keyof AddressForm as `bill_${K}`]: string };

export const billingAddressOf = (f: BillingForm) => unprefixed("bill", f);

export const billingOf = (c: ClientView): BillingForm => ({
  country: c.country,
  gstStatus: c.gstStatus,
  gstin: c.gstin ?? "",
  stateCode: c.stateCode ?? "",
  currency: c.currency,
  terms: c.paymentTermsDays === null || c.paymentTermsDays === undefined ? "" : String(c.paymentTermsDays),
  reminders: c.reminderPolicy ? (c.reminderPolicy.enabled ? "on" : "off") : "default",
  offsets: offsetsText(c.reminderPolicy?.offsetsDays),
  careAutoIssue: c.careAutoIssue ? "on" : "off",
  attachPdf: c.attachPdf ? "on" : "off",
  ...prefixed("bill", addressForm(c.billingAddress, c.country)),
});

/** The days typed for payment terms: "" is the default (null), else a whole number 0 to 365; undefined when invalid. */
export function termsDays(text: string): number | null | undefined {
  const v = text.trim();
  if (v === "") return null;
  if (!/^\d{1,3}$/.test(v)) return undefined;
  const n = Number(v);
  return n <= 365 ? n : undefined;
}

/**
 * What a billing save sends: the fields that differ from the base. The tax identity goes as one piece when any of it
 * changed (status, GSTIN and state decide each other, and the API checks them together); a status without a GSTIN or a
 * state sends them as null.
 */
export function billingPatch(d: Draft<BillingForm>): Omit<BillingPatch, "expectedUpdatedAt"> {
  const p: Omit<BillingPatch, "expectedUpdatedAt"> = {};
  const { base, value } = d;
  const status = value.gstStatus as GstStatus;
  if (value.country !== base.country) p.country = value.country;
  const gstin = status === "registered" ? value.gstin.replace(/\s/g, "").toUpperCase() : "";
  const state = status === "overseas" ? "" : value.stateCode;
  const taxChanged =
    value.gstStatus !== base.gstStatus ||
    gstin !== base.gstin ||
    state !== base.stateCode ||
    value.country !== base.country;
  if (taxChanged) {
    if (value.gstStatus !== base.gstStatus) p.gstStatus = status;
    p.gstin = gstin || null;
    p.stateCode = state || null;
  }
  if (value.currency !== base.currency) p.currency = value.currency as Currency;
  if (addressChanged("bill", d as unknown as Draft<Record<string, string>>))
    p.billingAddress = toAddress(billingAddressOf(value));
  if (value.terms.trim() !== base.terms) {
    const days = termsDays(value.terms);
    if (days !== undefined) p.paymentTermsDays = days;
  }
  if (value.reminders !== base.reminders || (value.reminders === "on" && value.offsets !== base.offsets)) {
    const offsets = parseOffsets(value.offsets) ?? [];
    p.reminderPolicy =
      value.reminders === "default"
        ? null
        : value.reminders === "on"
          ? offsets.length
            ? { enabled: true, offsetsDays: offsets }
            : { enabled: true }
          : { enabled: false };
  }
  if (value.careAutoIssue !== base.careAutoIssue) p.careAutoIssue = value.careAutoIssue === "on";
  if (value.attachPdf !== base.attachPdf) p.attachPdf = value.attachPdf === "on";
  return p;
}

// ---- where an API refusal lands --------------------------------------------------------------------------------------

/** The field (by its form key) an API error code is about, or null for a page-level notice. */
export function fieldOfError(code: string): string | null {
  switch (code) {
    case "country_mismatch":
      return "country";
    case "gstin_invalid":
    case "gstin_not_allowed":
    case "gstin_in_use":
      return "gstin";
    case "state_required":
    case "state_invalid":
    case "state_not_allowed":
      return "stateCode";
    case "currency_locked":
      return "currency";
    case "type_locked":
      return "type";
    case "email_in_use":
      return "email";
    default:
      return null;
  }
}

// ---- the activity tab -------------------------------------------------------------------------------------------------

/** Field names the API writes in `changed`, in words. */
export const CLIENT_FIELD_LABELS: Record<string, string> = {
  legalName: "Legal name",
  displayName: "Display name",
  type: "Type",
  serviceAddress: "Service address",
  tags: "Tags",
  notes: "Notes",
  country: "Country",
  gstStatus: "GST status",
  gstin: "GSTIN",
  stateCode: "State",
  billingAddress: "Billing address",
  currency: "Currency",
  paymentTermsDays: "Payment terms",
  reminderPolicy: "Reminders",
  careAutoIssue: "Care plan auto-issue",
  attachPdf: "Attach PDF",
  name: "Name",
  email: "Email",
  phone: "Phone",
  title: "Role or title",
  isPrimary: "Primary contact",
  isBilling: "Billing contact",
  portalAccess: "Portal access",
  canSeeFinance: "Can see finance",
  marketingConsent: "Marketing consent",
};
const fieldWords = (keys: unknown) =>
  Array.isArray(keys)
    ? keys.map((k) => (CLIENT_FIELD_LABELS[String(k)] ?? String(k)).toLowerCase()).join(", ")
    : "";

const ACTIVITY_VERBS: Record<string, string> = {
  "client.create": "added the client",
  "client.update": "changed the client's details",
  "client.billing_update": "changed the billing details",
  "contact.create": "added a contact",
  "contact.update": "changed a contact",
  "contact.export": "exported a contact's data",
  "contact.erase": "erased a contact",
  "contact.anonymise": "anonymised a contact",
};
export const isEraseAction = (a: string) => a === "contact.erase" || a === "contact.anonymise";

/** One activity entry in words: what happened, the fields it changed, and which contact it was about. */
export function readClientActivity(
  e: Pick<ClientActivity, "action" | "summary">,
  contacts: ReadonlyMap<string, Pick<ContactView, "name" | "anonymisedAt">>,
): { what: string; fields: string; contact: string | null; reason: EraseReason | null } {
  const s = e.summary ?? {};
  const cid = typeof s.contactId === "string" ? s.contactId : null;
  const known = cid ? contacts.get(cid) : undefined;
  // An erased contact is gone from the list; an anonymised one reads as its tombstone name.
  const contact = cid ? (known ? known.name : null) : null;
  const reason =
    typeof s.reason === "string" && (ERASE_REASONS as readonly string[]).includes(s.reason)
      ? (s.reason as EraseReason)
      : null;
  return {
    what: ACTIVITY_VERBS[e.action] ?? e.action,
    fields: fieldWords(s.changed),
    contact,
    reason,
  };
}

// ---- the data-subject export file (ADM-CLI-05) ------------------------------------------------------------------------

/** The file the browser assembles from the summary and every part's pages; nothing is sent anywhere. */
export function exportFile(
  summary: ExportSummary,
  parts: Partial<Record<ExportPart, Record<string, unknown>[]>>,
  at: number,
) {
  return {
    exportedAt: new Date(at).toISOString(),
    contact: summary.contact,
    client: summary.client,
    suppression: summary.suppression,
    parts: Object.fromEntries(summary.manifest.map((p) => [p, parts[p] ?? []])),
  };
}

/** "techaust-data-export-<contact id>-2026-10-25.json" (the IST day is the caller's). */
export const exportFileName = (contactId: string, isoDay: string) =>
  `techaust-data-export-${contactId}-${isoDay}.json`;

/** The part names as people read them, for the progress line. */
export const EXPORT_PART_LABELS: Record<ExportPart, string> = {
  leads: "Enquiries",
  lead_activities: "Enquiry history",
  sessions: "Portal sign-ins",
  magic_links: "Sign-in links",
  acceptances: "Acceptances",
  documents: "Issued documents",
  email_log: "Emails sent",
  audit_log: "Activity",
  access_log: "Portal requests",
};

// ---- the page's drafts (held above every reload, as on the lead page) ------------------------------------------------

export type ClientDrafts = {
  /** The details form while it is open; null when the details are shown read-only. */
  details: Draft<DetailsForm> | null;
  billing: Draft<BillingForm> | null;
  /** A reload found someone else's change in a field a draft held; that field's edit was dropped (M3.2 re-check 2). */
  conflict: { details: boolean; billing: boolean };
};
export const NO_CLIENT_DRAFTS: ClientDrafts = {
  details: null,
  billing: null,
  conflict: { details: false, billing: false },
};
export type ClientDraftAction =
  | { type: "details"; value: DetailsForm | null; base: DetailsForm }
  | { type: "billing"; value: BillingForm | null; base: BillingForm }
  | { type: "loaded"; details: DetailsForm; billing: BillingForm }
  | { type: "reloaded-latest" };

const open = <T>(cur: Draft<T> | null, value: T | null, base: T): Draft<T> | null =>
  value === null ? null : { base: cur?.base ?? base, value };

export function clientDrafts(s: ClientDrafts, a: ClientDraftAction): ClientDrafts {
  switch (a.type) {
    case "details":
      return {
        ...s,
        details: open(s.details, a.value, a.base),
        conflict: a.value === null ? { ...s.conflict, details: false } : s.conflict,
      };
    case "billing":
      return {
        ...s,
        billing: open(s.billing, a.value, a.base),
        conflict: a.value === null ? { ...s.conflict, billing: false } : s.conflict,
      };
    case "loaded": {
      const d = rebase(s.details, a.details);
      const b = rebase(s.billing, a.billing);
      return {
        details: d.draft,
        billing: b.draft,
        conflict: { details: s.conflict.details || d.conflict, billing: s.conflict.billing || b.conflict },
      };
    }
    case "reloaded-latest":
      return NO_CLIENT_DRAFTS;
  }
}

// ---- the tax identity in a form (new client, billing, the lead conversion) ------------------------------------------

/** The GSTIN state warning (07-J, approved). Never a block: the person checks it before saving. */
export const stateWarning = (gstinState: string) =>
  `The state you chose differs from the GSTIN's state (${gstinState}). Check it before saving.`;

export type Tax = { country: string; gstStatus: string; gstin: string; stateCode: string };
export type TaxErrors = Partial<
  Record<"country" | "gstStatus" | "gstin" | "stateCode", string | null | undefined>
>;

/** What a new country brings: its usual GST status (both stay changeable), as in the convert dialog. */
export function withCountry(t: Tax, country: string): Partial<Tax> {
  const gstStatus =
    country === "IN" ? (t.gstStatus === "overseas" ? "unregistered" : t.gstStatus) : "overseas";
  return { country, gstStatus, ...(gstStatus === "overseas" ? { gstin: "", stateCode: "" } : {}) };
}

/**
 * A GSTIN typed in: once it is valid, the state follows it unless the person had picked a different one on purpose
 * (an empty state, or the old GSTIN's state, follows).
 */
export function withGstin(t: Tax, raw: string): { gstin: string; stateCode?: string } {
  const gstin = raw.toUpperCase();
  const was = validateGstin(t.gstin);
  const now = validateGstin(gstin);
  const follows = !t.stateCode || (was.ok && was.stateCode === t.stateCode);
  return now.ok && follows ? { gstin, stateCode: now.stateCode } : { gstin };
}

/** The client-side twin of the API's tax rule (core `clientTaxCheck` runs again on the server): errors by field. */
export function taxFieldErrors(v: Tax, p: string): Record<string, string> {
  const e: Record<string, string> = {};
  if (v.gstStatus === "registered") {
    const g = validateGstin(v.gstin);
    if (!v.gstin.trim()) e[`${p}-gstin`] = "Enter the GSTIN.";
    else if (!g.ok) e[`${p}-gstin`] = `${g.error}.`;
  }
  if (v.gstStatus !== "overseas" && !v.stateCode) e[`${p}-stateCode`] = "Choose the client's state.";
  if ((v.gstStatus === "overseas") === (v.country === "IN"))
    e[`${p}-country`] = "Registered and unregistered clients are in India (IN); overseas clients are not.";
  return e;
}
