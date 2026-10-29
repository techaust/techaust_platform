// Pure helpers of the catalogue screens (M4.1, ADM-CAT-01..05): the labels, the 07-L copy, the form of an entry and its
// conversions (money in minor units through @techaust/core, percentages in basis points, quantities in milli-units, never
// floats), what an edit sends (only the fields the person changed), the price history in words, the publish answer mapped to
// the services to fix, and the template placeholders. Copy comes word for word from 07-L (approved with 07-Q); any
// sentence 07-L lacked is in `PENDING`, in its 07-Q words (no tag). Labels (buttons, columns,
// field names) come from the PRD (ADM-CAT-02) and the existing screens.
import {
  type Currency,
  formatMoney,
  money,
  SCHEDULE_TRIGGERS,
  type ScheduleTrigger,
  scheduleText,
} from "@techaust/core";
import {
  CATALOGUE_CATEGORIES,
  CATALOGUE_UNITS,
  placeholdersOf,
  TEMPLATE_PLACEHOLDERS,
} from "@techaust/core/catalogue";
import { joinedPastLimit, misplacedTextTokens, TEXT_TOKEN_KINDS } from "@techaust/core/documents";
import type {
  CatalogueCategory,
  CatalogueEntry,
  CatalogueListItem,
  CatalogueUnit,
  CreateEntry,
  PatchEntry,
  SiteNeedAnswer,
  TemplateKind,
  TemplateMeta,
} from "../api.ts";
import type { Draft } from "../routes/leads/drafts.ts";
import { Y } from "./copy-y.ts";
import { bpToPercent, moneyFrom, moneyInput, percentToBp } from "./settings-form.ts";

// ---- labels (07-L) -------------------------------------------------------------------------------------------------------------

export const CATEGORIES: readonly CatalogueCategory[] = CATALOGUE_CATEGORIES;
export const UNITS: readonly CatalogueUnit[] = CATALOGUE_UNITS;

export const CATEGORY_LABELS: Record<CatalogueCategory, string> = {
  advise: "Advise",
  build: "Build",
  automate: "Automate",
  connect: "Connect",
  run: "Run",
};

export const UNIT_LABELS: Record<CatalogueUnit, string> = {
  fixed: "Fixed price",
  milestone: "Per milestone",
  month: "Per month",
  hour: "Per hour",
  workflow: "Per workflow",
  connector: "Per connector",
  document: "Per document",
};

export const STATUS_LABELS = {
  active: "Active",
  retired: "Retired",
  onSite: "On the website",
  offSite: "Not on the website",
} as const;

/** When a step is paid: the words of core's `scheduleText` (the website's own sentence), as a choice. */
export const TRIGGERS: readonly ScheduleTrigger[] = SCHEDULE_TRIGGERS;
export const TRIGGER_LABELS: Record<ScheduleTrigger, string> = {
  on_accept: "On acceptance",
  milestone: "At a milestone",
  delivery: "On delivery",
  monthly: "Monthly in advance",
};

/** Template kinds, as 07-L names them ("proposals and estimates … plus the care plan and terms blocks"). */
export const KIND_LABELS: Record<TemplateKind, string> = {
  proposal: "Proposal",
  estimate: "Estimate",
  care_block: "Care plan block",
  terms_block: "Terms block",
};

// ---- 07-L copy, word for word ------------------------------------------------------------------------------------------------

export const COPY = {
  listIntro:
    "Your services, their prices and what each one includes. Proposals and estimates start from these, and the website shows the ones marked for it.",
  nothingMatches: "Try fewer filters, or search for the start of a service code or name.",
  sacHint: "The six-digit service code printed on invoices.",
  gstHint: "Leave empty to use the rate in Settings › Tax.",
  fromHint: "The starting price shown on the website. Leave a currency empty if you don't offer it there.",
  linesHint:
    "The lines a proposal starts with when this service is chosen. Each needs a different description.",
  scheduleHint: "How this service is usually paid. The steps must add up to 100 %.",
  /** The hint's second sentence, also the error when the steps don't add up. */
  scheduleRule: "The steps must add up to 100 %.",
  onSiteHint: "Turning this off removes the service's page from the website at the next publish.",
  retire: (code: string, name: string) =>
    `Retire ${code} ${name}? It can't be added to new proposals or estimates. Documents that already include it don't change.`,
  reactivate: (code: string, name: string) =>
    `Make ${code} ${name} active again? It can be added to new proposals and estimates.`,
  codeLocked: "The code can't change once the service is saved.",
  historyHeading: "Price history",
  historyRow: (field: string, from: string, to: string, person: string) =>
    `${field} changed from ${from} to ${to} by ${person}`,
  historyEmpty: "No price changes yet.",
  templatesIntro:
    "The starting wording for proposals and estimates in each category, plus the care plan and terms blocks. Saving creates a new version; documents keep the version they were made with.",
  placeholdersHint:
    "Use placeholders such as {{client.name}} or {{service.deliverables}}. They're filled in when a proposal is made.",
  versionLine: (n: number, person: string | null, date: string) =>
    person === null ? `Version ${n}, saved on ${date}` : `Version ${n}, saved by ${person} on ${date}`,
  templatesEmpty: "No templates for this category yet.",
  publishIntro:
    "Publishing sends the current prices of every active service marked for the website to the staging website. The staging website picks them up within 30 minutes. The live website changes only with the next approved deploy.",
  publishButton: "Publish prices",
  published: "Published. The staging website shows these prices within 30 minutes.",
  unchanged: "No change: these prices are already the newest published.",
  republished:
    "Published. These are the same prices as an earlier list; the staging website goes back to them within 30 minutes.",
  publishedHeading: "Published price lists",
  publishedRow: (person: string, date: string) => `Published by ${person} on ${date}`,
  publishedEmpty: "Nothing published yet. The website uses the starting prices until you publish.",
  /** Added after the review (07-L): shown when retiring a service, or taking it off the website, that the website uses. */
  siteUsesService:
    "The website shows this service. Retiring it, or taking it off the website, stops the next publish until the website no longer needs it.",
  /** A save that is longer than the server reads (413). */
  tooLong: "This is too long. Shorten the longest texts and save again.",
} as const;

/** 07-L errors by API code. */
export const ERRORS = {
  code_in_use: "Another service already has this code.",
  slug_in_use: "Another service already uses this website address.",
  unknown_placeholder: (p: string) => `This template uses a placeholder that doesn't exist: ${p}.`,
  template_category:
    "This template's category doesn't fit its kind. Proposal and estimate templates need a category; the care plan and terms blocks don't.",
  snapshot_invalid: "The prices can't be published yet. Fix the services listed below.",
  conflict: "Someone else saved at the same moment. Reload and try again.",
  /** `snapshot_invalid` for a service the website needs (added after the review, 07-L). */
  siteNeeds: (code: string, what: string) => `The website needs ${code}: ${what}.`,
} as const;

export const TOASTS = {
  added: "Service added.",
  saved: "Service saved.",
  retired: "Service retired.",
  active: "Service active again.",
  templateSaved: (n: number) => `Template saved as version ${n}.`,
  published: "Prices published.",
} as const;

/** Reused from 07-K (the M3.4 notes use the same Markdown subset). */
export const FORMATTING_HINT = "You can use **bold**, *italic*, lists and links.";

// ---- lines 07-L lacked, approved word for word in 07-Q (2026-10-26) --------------------------------------------------

export const PENDING = {
  emptyTitle: "No services yet",
  emptyBody: "Add the first service, or load the seed catalogue.",
  noMatchTitle: "No services match these filters",
  staleService: "Someone else changed this service.",
  staleServiceDraft: "Someone else changed this service while you were editing it.",
  enterCode: "Enter a code: S and up to four digits, for example S19.",
  enterName: "Enter the service name.",
  enterShort: "Enter a short description.",
  enterSac: "Enter the six-digit SAC.",
  enterGst: "Enter a rate from 0 to 100 %, with at most 2 decimals, or leave it empty.",
  enterSlug: "Use lower-case letters, digits and single hyphens, for example cloud-migration.",
  enterLine: (n: number) => `Describe line ${n}.`,
  sameLine: (n: number) => `Line ${n} has the same description as another line.`,
  enterQty: (n: number) => `Enter the quantity of line ${n}: more than 0, with at most 3 decimals.`,
  enterStep: (n: number) => `Name step ${n}.`,
  enterPct: (n: number) => `Enter a percentage for step ${n}.`,
  oneStep: "Keep at least one step.",
  emptySections: "A section needs a heading.",
  otherFix: "Something outside the services can't be published. Check the payment terms.",
  noneOnSite: "No active service is marked for the website, or two share a code.",
  latestVersion: (n: number) => `This is an older version. Version ${n} is the newest.`,
} as const;

// ---- money and numbers ---------------------------------------------------------------------------------------------------

/** A money field's error: its label and the core parser's message (the Settings › Payment terms pattern). */
const moneyError = (what: string, error: string) => `${what}: ${error}`;

/** "₹60,000" or "$1,000" (whole amounts without ".00"); null prices are not offered. */
export const priceText = (minor: number, currency: Currency) =>
  formatMoney(money(minor, currency), { wholeUnits: true });

/** "1", "2.5", "0.125" → 1000, 2500, 125 milli-units; null unless more than 0 with at most 3 decimals. No floats. */
export function qtyToMilli(input: string): number | null {
  const m = /^(\d{1,7})(?:\.(\d{1,3}))?$/.exec(input.trim());
  if (!m) return null;
  const milli = Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0"));
  return milli > 0 ? milli : null;
}

/** 1000 → "1", 2500 → "2.5". */
export function milliToQty(milli: number): string {
  const whole = Math.trunc(milli / 1000);
  const frac = String(milli % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

// ---- the entry form ------------------------------------------------------------------------------------------------------------

export type LineForm = {
  uid: string;
  description: string;
  unit: CatalogueUnit;
  qty: string;
  rateInr: string;
  rateUsd: string;
};
export type StepForm = { uid: string; label: string; pct: string; trigger: ScheduleTrigger };
export type EntryForm = {
  code: string;
  name: string;
  category: CatalogueCategory;
  unit: CatalogueUnit;
  short: string;
  longMd: string;
  priceInr: string;
  priceUsd: string;
  sac: string;
  gstRate: string;
  lines: LineForm[];
  schedule: StepForm[];
  deliverablesMd: string;
  assumptionsMd: string;
  exclusionsMd: string;
  slug: string;
  showOnSite: boolean;
};

/** Rows of the two lists need a stable key while they are edited (never saved). */
let rows = 0;
export const rowId = () => `r${++rows}`;

export const newLine = (unit: CatalogueUnit = "fixed"): LineForm => ({
  uid: rowId(),
  description: "",
  unit,
  qty: "1",
  rateInr: "",
  rateUsd: "",
});
export const newStep = (): StepForm => ({ uid: rowId(), label: "", pct: "", trigger: "milestone" });

/** A blank entry for "New service": one step paid in full on acceptance, as the seed's small jobs are. */
export function blankForm(): EntryForm {
  return {
    code: "",
    name: "",
    category: "build",
    unit: "fixed",
    short: "",
    longMd: "",
    priceInr: "",
    priceUsd: "",
    sac: "",
    gstRate: "",
    lines: [],
    schedule: [{ uid: rowId(), label: "On acceptance", pct: "100", trigger: "on_accept" }],
    deliverablesMd: "",
    assumptionsMd: "",
    exclusionsMd: "",
    slug: "",
    showOnSite: false,
  };
}

const moneyOr = (minor: number | null, currency: Currency) =>
  minor === null ? "" : moneyInput(minor, currency);

export function formOf(e: CatalogueEntry): EntryForm {
  return {
    code: e.code,
    name: e.name,
    category: e.category,
    unit: e.unit,
    short: e.short,
    longMd: e.longMd ?? "",
    priceInr: moneyOr(e.priceInrMinor, "INR"),
    priceUsd: moneyOr(e.priceUsdMinor, "USD"),
    sac: e.sac,
    gstRate: e.gstRateBp === null ? "" : bpToPercent(e.gstRateBp),
    lines: (e.defaultLines ?? []).map((l) => ({
      uid: rowId(),
      description: l.description,
      unit: l.unit,
      qty: milliToQty(l.qtyMilli),
      rateInr: moneyOr(l.rateInrMinor, "INR"),
      rateUsd: moneyOr(l.rateUsdMinor, "USD"),
    })),
    schedule: e.schedule.map((s) => ({
      uid: rowId(),
      label: s.label,
      pct: bpToPercent(s.pctBp),
      trigger: s.trigger,
    })),
    deliverablesMd: e.deliverablesMd ?? "",
    assumptionsMd: e.assumptionsMd ?? "",
    exclusionsMd: e.exclusionsMd ?? "",
    slug: e.slug ?? "",
    showOnSite: e.showOnSite,
  };
}

/** The schedule's total in basis points, or null while a share isn't a valid percentage. */
export function scheduleTotal(steps: readonly Pick<StepForm, "pct">[]): number | null {
  let total = 0;
  for (const s of steps) {
    const bp = percentToBp(s.pct);
    if (bp === null) return null;
    total += bp;
  }
  return total;
}

/** The schedule as the website words it (core's `scheduleText`), or null while it doesn't add up. */
export function scheduleWords(steps: readonly { label: string; pctBp: number; trigger: ScheduleTrigger }[]) {
  if (!steps.length || steps.reduce((a, s) => a + s.pctBp, 0) !== 10_000) return null;
  return scheduleText(steps);
}

export type FieldErrors = Record<string, string>;
/** Every field of an entry, as the API takes it (the code too: `create` needs it). */
export type EntryValue = Omit<CreateEntry, "active">;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const blankToNull = (s: string) => (s.trim() === "" ? null : s.trim());

/**
 * The form's own checks, in the order the fields appear (ids are the screen's field ids), and the value to save when there
 * are none. The API checks again with the shared schema (`createEntry` / `patchEntry` in @techaust/core).
 */
export function buildEntry(f: EntryForm): { value: EntryValue } | { errors: FieldErrors } {
  const e: FieldErrors = {};
  const code = f.code.trim().toUpperCase();
  if (!/^S\d{1,4}$/.test(code)) e["ce-code"] = PENDING.enterCode;
  if (!f.name.trim()) e["ce-name"] = PENDING.enterName;
  if (!f.short.trim()) e["ce-short"] = PENDING.enterShort;
  const inr = f.priceInr.trim() ? moneyFrom(f.priceInr, "INR") : null;
  if (inr && !inr.ok) e["ce-priceInr"] = moneyError("From price in rupees", inr.error);
  const usd = f.priceUsd.trim() ? moneyFrom(f.priceUsd, "USD") : null;
  if (usd && !usd.ok) e["ce-priceUsd"] = moneyError("From price in US dollars", usd.error);
  if (!/^\d{6}$/.test(f.sac.trim())) e["ce-sac"] = PENDING.enterSac;
  const gst = f.gstRate.trim() ? percentToBp(f.gstRate) : null;
  if (f.gstRate.trim() && gst === null) e["ce-gstRate"] = PENDING.enterGst;

  const seen = new Set<string>();
  const lines = f.lines.map((l, i) => {
    const n = i + 1;
    const d = l.description.trim();
    if (!d) e[`ce-line-${i}-description`] = PENDING.enterLine(n);
    else if (seen.has(d)) e[`ce-line-${i}-description`] = PENDING.sameLine(n);
    seen.add(d);
    const qty = qtyToMilli(l.qty);
    if (qty === null) e[`ce-line-${i}-qty`] = PENDING.enterQty(n);
    const ri = l.rateInr.trim() ? moneyFrom(l.rateInr, "INR") : null;
    if (ri && !ri.ok) e[`ce-line-${i}-rateInr`] = moneyError(`Line ${n} rate in rupees`, ri.error);
    const ru = l.rateUsd.trim() ? moneyFrom(l.rateUsd, "USD") : null;
    if (ru && !ru.ok) e[`ce-line-${i}-rateUsd`] = moneyError(`Line ${n} rate in US dollars`, ru.error);
    return {
      description: d,
      unit: l.unit,
      qtyMilli: qty ?? 0,
      rateInrMinor: ri?.ok ? ri.minor : null,
      rateUsdMinor: ru?.ok ? ru.minor : null,
    };
  });

  const schedule = f.schedule.map((s, i) => {
    if (!s.label.trim()) e[`ce-step-${i}-label`] = PENDING.enterStep(i + 1);
    const bp = percentToBp(s.pct);
    if (bp === null) e[`ce-step-${i}-pct`] = PENDING.enterPct(i + 1);
    return { label: s.label.trim(), pctBp: bp ?? 0, trigger: s.trigger };
  });
  const total = scheduleTotal(f.schedule);
  if (!f.schedule.length) e["ce-schedule"] = PENDING.oneStep;
  else if (total !== null && total !== 10_000) e["ce-schedule"] = COPY.scheduleRule;

  const slug = f.slug.trim().toLowerCase();
  if (slug && !SLUG.test(slug)) e["ce-slug"] = PENDING.enterSlug;

  if (Object.keys(e).length) return { errors: e };
  return {
    value: {
      code,
      name: f.name.trim(),
      category: f.category,
      short: f.short.trim(),
      longMd: blankToNull(f.longMd),
      unit: f.unit,
      priceInrMinor: inr?.ok ? inr.minor : null,
      priceUsdMinor: usd?.ok ? usd.minor : null,
      sac: f.sac.trim(),
      gstRateBp: gst,
      defaultLines: lines.length ? lines : null,
      deliverablesMd: blankToNull(f.deliverablesMd),
      assumptionsMd: blankToNull(f.assumptionsMd),
      exclusionsMd: blankToNull(f.exclusionsMd),
      schedule,
      slug: slug || null,
      showOnSite: f.showOnSite,
    },
  };
}

/** Two values of one form field are the same (the lists compare without their row keys). */
const noUid = (v: unknown) => JSON.stringify(v, (k, x) => (k === "uid" ? undefined : (x as unknown)), 0);
const same = (a: unknown, b: unknown) => noUid(a) === noUid(b);

const FORM_KEYS = [
  "name",
  "category",
  "unit",
  "short",
  "longMd",
  "priceInr",
  "priceUsd",
  "sac",
  "gstRate",
  "lines",
  "schedule",
  "deliverablesMd",
  "assumptionsMd",
  "exclusionsMd",
  "slug",
  "showOnSite",
] as const satisfies readonly (keyof EntryForm)[];
type FormKey = (typeof FORM_KEYS)[number];

/** The form fields a draft changed from its base. */
export const changedKeys = (d: Draft<EntryForm>): FormKey[] =>
  FORM_KEYS.filter((k) => !same(d.value[k], d.base[k]));

/** Which API field each form field writes. */
const API_FIELD: Record<FormKey, keyof EntryValue> = {
  name: "name",
  category: "category",
  unit: "unit",
  short: "short",
  longMd: "longMd",
  priceInr: "priceInrMinor",
  priceUsd: "priceUsdMinor",
  sac: "sac",
  gstRate: "gstRateBp",
  lines: "defaultLines",
  schedule: "schedule",
  deliverablesMd: "deliverablesMd",
  assumptionsMd: "assumptionsMd",
  exclusionsMd: "exclusionsMd",
  slug: "slug",
  showOnSite: "showOnSite",
};

/**
 * What an edit sends: only the fields the person changed from what the draft started from, so a field they didn't touch is
 * never sent back over someone else's change (the M3.2 drafts pattern). The code is never sent.
 */
export function entryPatch(d: Draft<EntryForm>, value: EntryValue, expectedUpdatedAt: number): PatchEntry {
  const patch: Record<string, unknown> = { expectedUpdatedAt };
  for (const k of changedKeys(d)) {
    const field = API_FIELD[k];
    // An emptied Markdown field is sent as "" (the API stores it as none); every other field as built.
    const v = value[field];
    patch[field] = v === null && field.endsWith("Md") ? "" : v;
  }
  return patch as PatchEntry;
}

/**
 * Carries a draft onto a fresh copy of the entry: untouched fields take the stored value; a changed field keeps the person's
 * value unless someone else changed it too (then that field alone takes the stored value and `conflict` is set).
 */
export function rebaseEntry(
  d: Draft<EntryForm> | null,
  now: EntryForm,
): { draft: Draft<EntryForm> | null; conflict: boolean } {
  if (d === null) return { draft: null, conflict: false };
  const changed = changedKeys(d);
  const clash = changed.filter((k) => !same(now[k], d.base[k]) && !same(now[k], d.value[k]));
  const value: EntryForm = { ...now };
  for (const k of changed) if (!clash.includes(k)) (value as Record<string, unknown>)[k] = d.value[k];
  return { draft: { base: now, value }, conflict: clash.length > 0 };
}

/** An API refusal that belongs to one field: its id on the screen. */
export function fieldOfCode(code: string): string | null {
  if (code === "code_in_use") return "ce-code";
  if (code === "slug_in_use") return "ce-slug";
  return null;
}

/**
 * True when the server refused a save for its size: 413 (the body is over what it reads; the API answers `bad_request` for it, as
 * for any other malformed body, so the status is what tells them apart).
 */
export const isTooLong = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { status?: unknown }).status === 413;

/** The service pages' own message for a failed save: the 07-L "too long" line for a 413, else the caller's words. */
export const saveFailureText = (e: unknown, otherwise: (e: unknown) => string): string =>
  isTooLong(e) ? COPY.tooLong : otherwise(e);

// ---- price history ---------------------------------------------------------------------------------------------------------

const LINE_FIELD = /^line:(.*):rate_(inr|usd)_minor$/;

/** The field of a history row, in words, and the currency of its values. */
export function historyField(field: string): { label: string; currency: Currency } {
  if (field === "price_inr_minor") return { label: "From price in rupees", currency: "INR" };
  if (field === "price_usd_minor") return { label: "From price in US dollars", currency: "USD" };
  const m = LINE_FIELD.exec(field);
  if (m) {
    const currency: Currency = m[2] === "inr" ? "INR" : "USD";
    return {
      label: `${m[1]}, rate in ${currency === "INR" ? "rupees" : "US dollars"}`,
      currency,
    };
  }
  return { label: field, currency: "INR" };
}

export const NOT_SET = "Not set";

/** "From price in rupees changed from ₹50,000 to ₹60,000 by Asha" (07-L row). */
export function historyText(
  h: { field: string; oldMinor: number | null; newMinor: number | null; changedByName: string | null },
  formerStaff = "A former staff member",
): string {
  const f = historyField(h.field);
  const v = (m: number | null) => (m === null ? NOT_SET : priceText(m, f.currency));
  return COPY.historyRow(f.label, v(h.oldMinor), v(h.newMinor), h.changedByName ?? formerStaff);
}

// ---- publish -------------------------------------------------------------------------------------------------------------------

/** The snapshot's field names, in the words of the entry form. */
const SNAPSHOT_FIELDS: Record<string, string> = {
  code: "Code",
  name: "Name",
  slug: "Website address",
  category: "Category",
  unit: "Unit",
  priceInrMinor: "From price in rupees",
  priceUsdMinor: "From price in US dollars",
  schedule: "Payment schedule",
  defaultLines: "Default lines",
};

export type PublishProblem =
  | {
      kind: "service";
      item: Pick<CatalogueListItem, "id" | "code" | "name"> | null;
      index: number;
      fields: string[];
    }
  | { kind: "terms" }
  | { kind: "items" }
  /** The website needs this service and the snapshot lacks it (or a price or default line of it): `what` is the missing piece. */
  | { kind: "site"; code: string; id: string | null; what: string };

/** What the website lacks, after "The website needs {code}:" (07-L, draft pending the owner). */
export const NEED_WORDS = {
  needService: "this service, active and on the website",
  needPrice: (currency: "inr" | "usd") => `a from price in ${currency === "inr" ? "rupees" : "US dollars"}`,
  needLine: (word: string, currency: "inr" | "usd" | null, ambiguous: boolean) =>
    ambiguous
      ? `only one default line that starts with "${word}"`
      : currency === null
        ? `a default line that starts with "${word}"`
        : `a rate in ${currency === "inr" ? "rupees" : "US dollars"} on the default line that starts with "${word}"`,
} as const;

/** What the website lacks, in words (after "The website needs S7:"). */
export function siteNeedText(n: SiteNeedAnswer): string {
  if (n.missing === "service") return NEED_WORDS.needService;
  if (n.missing === "price") return NEED_WORDS.needPrice(n.currency);
  return NEED_WORDS.needLine(n.line, n.currency, n.ambiguous);
}

/**
 * 422 `snapshot_invalid` answers with paths like "items.3.unit" (never values). The snapshot holds the active services marked
 * for the website in code order, which is the order of GET /catalogue?active=1&onSite=1, so `onSite` (that list) turns an index
 * into the service to fix. Paths outside the items are the payment terms (Settings) or the item list itself. A service the
 * website needs but the snapshot lacks has a path by CODE ("items.S7", "items.S11.lines.setup"): those come with `needs`, which
 * says what is missing, and are listed first, one line each.
 */
export function publishProblems(
  paths: readonly string[],
  onSite: readonly Pick<CatalogueListItem, "id" | "code" | "name">[],
  needs: readonly SiteNeedAnswer[] = [],
): PublishProblem[] {
  const services = new Map<number, Set<string>>();
  let terms = false;
  let items = false;
  for (const p of paths) {
    const parts = p.split(".");
    // A path by code is a website need: `needs` carries it.
    if (parts[0] === "items" && /^S\d+$/.test(parts[1] ?? "")) continue;
    if (parts[0] === "paymentTerms") terms = true;
    else if (parts[0] === "items" && parts[1] !== undefined && /^\d+$/.test(parts[1])) {
      const i = Number(parts[1]);
      const field = parts[2] ? (SNAPSHOT_FIELDS[parts[2]] ?? parts[2]) : null;
      const set = services.get(i) ?? new Set<string>();
      if (field) set.add(field);
      services.set(i, set);
    } else items = true;
  }
  const out: PublishProblem[] = needs.map((n) => ({
    kind: "site",
    code: n.code,
    id: n.id ?? null,
    what: siteNeedText(n),
  }));
  out.push(
    ...[...services.entries()]
      .sort(([a], [b]) => a - b)
      .map(
        ([index, fields]): PublishProblem => ({
          kind: "service",
          item: onSite[index] ?? null,
          index,
          fields: [...fields],
        }),
      ),
  );
  if (terms) out.push({ kind: "terms" });
  if (items) out.push({ kind: "items" });
  return out;
}

/** The highest snapshot item index the paths name (how far down the on-site list the screen must read), or -1. */
export function maxItemIndex(paths: readonly string[]): number {
  let max = -1;
  for (const p of paths) {
    const m = /^items\.(\d+)/.exec(p);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

// ---- templates -------------------------------------------------------------------------------------------------------------

export const PLACEHOLDERS: readonly string[] = TEMPLATE_PLACEHOLDERS;
const KNOWN = new Set<string>(TEMPLATE_PLACEHOLDERS);

/** The placeholders in a text that aren't on the list, in order of first use. */
export const unknownIn = (text: string) => placeholdersOf(text).filter((p) => !KNOWN.has(p));

/**
 * 07-Y lines (FX-3 round 3, pending the owner) for the template rules the API also holds (`template_text_token_place`,
 * `template_joined_too_long`): shown under each section the rule names.
 */
export const TEMPLATE_RULES = {
  /** Q3: a Catalogue-text placeholder in a heading. */
  textInHeading: (placeholder: string) =>
    Y(`${placeholder} can't go in a heading. Put it in the text of its own section.`),
  /** Q3: a Catalogue-text placeholder in the text of another section; `section` is where it belongs. */
  textElsewhere: (placeholder: string, section: string) =>
    Y(`${placeholder} can only go in the text of the ${section} section.`),
  joinedTooLong: Y(
    "A proposal or estimate has room for 3 sections of your own. This one and the ones after the third are joined into one, which would pass 6,000 characters. Shorten them or remove some.",
  ),
  /** FX-3 (designer): the newest version, saved before these rules, breaks one; shown above its sections when the page opens. */
  storedBreaks: Y(
    "This version was saved before the template rules below. Drafts made from it may not save. Edit it and save a new version.",
  ),
  /** The line under a section in the read view and in the summary: "Section 4: …". */
  section: (n: number, line: string) => `Section ${n}: ${line}`,
} as const;

/** The section each Catalogue-text placeholder belongs in, by the heading the seeded templates give it. */
const TEXT_HOME: Record<string, string> = {
  deliverables: "Deliverables",
  assumptions_exclusions: "Assumptions and exclusions",
};

/**
 * The template rules a save is refused for, by section (0-based), with the 07-Y lines for each (joined by a space), so the editor shows
 * them before it sends (the API answers the same sections): Catalogue-text placeholders outside their own section's text (every kind),
 * and custom sections joined past 6,000 characters (proposal and estimate templates only: the care plan and terms blocks are never
 * joined).
 */
export function templateRuleErrors(
  kind: TemplateKind,
  sections: readonly { key: string; heading: string; body: string }[],
): Record<number, string> {
  const fields = templateRuleFields(kind, sections);
  const out: Record<number, string> = {};
  sections.forEach((_, i) => {
    const line = [fields[i]?.heading, fields[i]?.body].filter(Boolean).join(" ");
    if (line) out[i] = line;
  });
  return out;
}

/**
 * The same rules by field (FX-3 review 5): a Catalogue-text placeholder in a heading belongs to the heading input (`tpl-s{i}-heading`,
 * its own `aria-invalid` and summary link); one in another section's text and a joined section's length belong to the text.
 */
export function templateRuleFields(
  kind: TemplateKind,
  sections: readonly { key: string; heading: string; body: string }[],
): Record<number, { heading?: string; body?: string }> {
  const lines = new Map<number, { heading: string[]; body: string[] }>();
  const add = (n: number, part: "heading" | "body", line: string) => {
    const at = lines.get(n) ?? { heading: [], body: [] };
    at[part].push(line);
    lines.set(n, at);
  };
  for (const m of misplacedTextTokens(sections)) {
    const placeholder = `{{${m.name}}}`;
    if (m.part === "heading") add(m.index, "heading", TEMPLATE_RULES.textInHeading(placeholder));
    else
      add(
        m.index,
        "body",
        TEMPLATE_RULES.textElsewhere(placeholder, TEXT_HOME[TEXT_TOKEN_KINDS[m.name] ?? ""] ?? ""),
      );
  }
  if (kind === "proposal" || kind === "estimate")
    for (const n of joinedPastLimit(sections)) add(n, "body", TEMPLATE_RULES.joinedTooLong);
  return Object.fromEntries(
    [...lines].map(([n, l]) => [
      n,
      {
        ...(l.heading.length ? { heading: l.heading.join(" ") } : {}),
        ...(l.body.length ? { body: l.body.join(" ") } : {}),
      },
    ]),
  );
}

/** "Build proposal", "Care plan block". */
export function templateTitle(t: Pick<TemplateMeta, "kind" | "category">): string {
  if (!t.category) return KIND_LABELS[t.kind];
  return `${CATEGORY_LABELS[t.category]} ${KIND_LABELS[t.kind].toLowerCase()}`;
}

/** The text split into plain runs and placeholders, so a placeholder can be drawn as a token. */
export function splitPlaceholders(text: string): { text: string; placeholder: boolean }[] {
  const out: { text: string; placeholder: boolean }[] = [];
  const re = /\{\{\s*([a-z_]+(?:\.[a-z_]+)*)\s*\}\}/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), placeholder: false });
    out.push({ text: m[0], placeholder: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), placeholder: false });
  return out;
}

/** Inserts `{{name}}` at the caret (or over the selection) of a text; returns the text and where the caret goes. */
export function insertPlaceholder(
  text: string,
  name: string,
  start: number,
  end: number,
): { text: string; caret: number } {
  const token = `{{${name}}}`;
  const a = Math.max(0, Math.min(start, text.length));
  const b = Math.max(a, Math.min(end, text.length));
  return { text: `${text.slice(0, a)}${token}${text.slice(b)}`, caret: a + token.length };
}
