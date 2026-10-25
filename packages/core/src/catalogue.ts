// The service catalogue, pure (M4.1, ADM-CAT-01..05, WEB-G-07, WEB-SVC-05): the create and edit schemas, the price history rows, the
// public snapshot built from catalogue rows, its `zod/mini` twin (the admin Worker may not carry classic zod: scripts/worker-budget.mjs),
// canonical JSON and the SHA-256 that makes publishing idempotent, and the template placeholders. No I/O.
// Prices are integer minor units; rates are basis points; quantities are milli-units.
import * as z from "zod/mini";
import { SCHEDULE_TRIGGERS } from "./schedule-text.ts";

export const CATALOGUE_CATEGORIES = ["advise", "build", "automate", "connect", "run"] as const;
export const CATALOGUE_UNITS = [
  "fixed",
  "milestone",
  "month",
  "hour",
  "workflow",
  "connector",
  "document",
] as const;
/** The units the public snapshot may carry (hour and document items never appear on the site). */
export const SNAPSHOT_UNIT_VALUES = ["fixed", "milestone", "month", "workflow", "connector"] as const;

const minor = z.int().check(z.gte(0));
const bp = z.int().check(z.gte(0), z.lte(10_000));
const label = z.string().check(z.minLength(1));
const slugText = z.string().check(z.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), z.maxLength(80));
const addsTo100 = { error: "The schedule must add up to 100 %" };
const sumsTo100 = (s: readonly { pctBp: number }[]) => s.reduce((a, x) => a + x.pctBp, 0) === 10_000;

// ---- the create and edit schemas (ADM-CAT-02) -------------------------------------------------------------------------------

const shortText = (max: number) => z.string().check(z.trim(), z.minLength(1), z.maxLength(max));
const longText = (max: number) => z.nullable(z.string().check(z.trim(), z.maxLength(max)));

export const entryScheduleStep = z.strictObject({
  label: shortText(80),
  pctBp: bp,
  trigger: z.enum(SCHEDULE_TRIGGERS),
});
export const entryLine = z.strictObject({
  description: shortText(200),
  unit: z.enum(CATALOGUE_UNITS),
  qtyMilli: z.int().check(z.gt(0)),
  rateInrMinor: z.nullable(minor),
  rateUsdMinor: z.nullable(minor),
});

const scheduleField = z
  .array(entryScheduleStep)
  .check(z.minLength(1), z.maxLength(12), z.refine(sumsTo100, addsTo100));
const linesField = z.array(entryLine).check(
  z.maxLength(30),
  z.refine((l) => new Set(l.map((x) => x.description)).size === l.length, {
    error: "Two default lines have the same description",
  }),
);

const fields = {
  name: shortText(120),
  category: z.enum(CATALOGUE_CATEGORIES),
  short: shortText(400),
  longMd: z.optional(longText(2500)),
  unit: z.enum(CATALOGUE_UNITS),
  priceInrMinor: z.nullable(minor),
  priceUsdMinor: z.nullable(minor),
  sac: z.string().check(z.regex(/^\d{6}$/)),
  gstRateBp: z.nullable(bp),
  defaultLines: z.nullable(linesField),
  deliverablesMd: z.optional(longText(2500)),
  assumptionsMd: z.optional(longText(2500)),
  exclusionsMd: z.optional(longText(2500)),
  schedule: scheduleField,
  slug: z.nullable(slugText),
  showOnSite: z.boolean(),
};

/** A catalogue code: `S` and a number. The public snapshot's own schema needs it, so every item has one. */
export const catalogueCode = z.string().check(z.regex(/^S\d{1,4}$/));

export const createEntry = z.strictObject({
  code: catalogueCode,
  ...fields,
  active: z.optional(z.boolean()),
});

/** Every field of an edit is optional; the code is not one of them (it never changes). */
export const patchEntry = z.strictObject({
  expectedUpdatedAt: z.int(),
  name: z.optional(fields.name),
  category: z.optional(fields.category),
  short: z.optional(fields.short),
  longMd: fields.longMd,
  unit: z.optional(fields.unit),
  priceInrMinor: z.optional(fields.priceInrMinor),
  priceUsdMinor: z.optional(fields.priceUsdMinor),
  sac: z.optional(fields.sac),
  gstRateBp: z.optional(fields.gstRateBp),
  defaultLines: z.optional(fields.defaultLines),
  deliverablesMd: fields.deliverablesMd,
  assumptionsMd: fields.assumptionsMd,
  exclusionsMd: fields.exclusionsMd,
  schedule: z.optional(fields.schedule),
  slug: z.optional(fields.slug),
  showOnSite: z.optional(fields.showOnSite),
});

export type CreateEntry = z.infer<typeof createEntry>;
export type PatchEntry = z.infer<typeof patchEntry>;

// ---- price history (ADM-CAT-04) ---------------------------------------------------------------------------------------------

export type PricedEntry = {
  priceInrMinor: number | null;
  priceUsdMinor: number | null;
  defaultLines:
    | readonly { description: string; rateInrMinor: number | null; rateUsdMinor: number | null }[]
    | null;
};
export type PriceChange = { field: string; oldMinor: number | null; newMinor: number | null };

/**
 * The history rows for a change: the INR and USD headline prices and, for every default line (matched by its description, which is
 * unique within an item), its INR and USD rate. A field is listed only when its value differs; a line that is added or removed is
 * listed with a null on the side where it does not exist. Field names: `price_inr_minor`, `price_usd_minor`,
 * `line:<description>:rate_inr_minor`, `line:<description>:rate_usd_minor`.
 */
export function priceChanges(before: PricedEntry, after: PricedEntry): PriceChange[] {
  const out: PriceChange[] = [];
  const note = (field: string, oldMinor: number | null, newMinor: number | null) => {
    if (oldMinor !== newMinor) out.push({ field, oldMinor, newMinor });
  };
  note("price_inr_minor", before.priceInrMinor, after.priceInrMinor);
  note("price_usd_minor", before.priceUsdMinor, after.priceUsdMinor);
  const oldLines = new Map((before.defaultLines ?? []).map((l) => [l.description, l]));
  const newLines = new Map((after.defaultLines ?? []).map((l) => [l.description, l]));
  for (const d of new Set([...oldLines.keys(), ...newLines.keys()])) {
    const o = oldLines.get(d);
    const n = newLines.get(d);
    note(`line:${d}:rate_inr_minor`, o?.rateInrMinor ?? null, n?.rateInrMinor ?? null);
    note(`line:${d}:rate_usd_minor`, o?.rateUsdMinor ?? null, n?.rateUsdMinor ?? null);
  }
  return out;
}

// ---- the public snapshot, the mini twin (ADM-CAT-05) -----------------------------------------------------------------------

const snapshotUnit = z.enum(SNAPSHOT_UNIT_VALUES);

const sScheduleStep = z.strictObject({ label, pctBp: bp, trigger: z.enum(SCHEDULE_TRIGGERS) });
const sLine = z.strictObject({
  description: label,
  unit: snapshotUnit,
  qtyMilli: z.int().check(z.gt(0)),
  rateInrMinor: z.nullable(minor),
  rateUsdMinor: z.nullable(minor),
});
const sItem = z.strictObject({
  code: z.string().check(z.regex(/^S\d+$/)),
  name: label,
  slug: z.nullable(z.string().check(z.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))),
  category: z.enum(CATALOGUE_CATEGORIES),
  showOnSite: z.boolean(),
  unit: snapshotUnit,
  priceInrMinor: z.nullable(minor),
  priceUsdMinor: z.nullable(minor),
  schedule: z.array(sScheduleStep).check(z.minLength(1), z.refine(sumsTo100, addsTo100)),
  defaultLines: z.array(sLine),
});
const sPaymentTerms = z.strictObject({
  dueDays: z.int().check(z.gte(0), z.lte(90)),
  proposalValidityDays: z.int().check(z.gte(1), z.lte(90)),
  buildSchedule: z
    .array(z.strictObject({ label, pctBp: bp }))
    .check(z.minLength(1), z.refine(sumsTo100, addsTo100)),
  smallJobThreshold: z.strictObject({ INR: minor, USD: minor }),
});

/** The twin of `catalogueSnapshot` (classic zod, in `schemas/catalogue-snapshot.ts`); test/catalogue.test.ts proves they agree. */
export const catalogueSnapshotMini = z.strictObject({
  version: z.literal(1),
  items: z.array(sItem).check(z.minLength(1)),
  paymentTerms: sPaymentTerms,
});
export type SnapshotShape = z.infer<typeof catalogueSnapshotMini>;

export type ParsedSnapshot = { ok: true; data: SnapshotShape } | { ok: false; paths: string[] };

/** Validates a snapshot with the mini twin: the schema plus "no duplicate code". Failure paths only, never values. */
export function parseSnapshot(value: unknown): ParsedSnapshot {
  const r = catalogueSnapshotMini.safeParse(value);
  if (!r.success) return { ok: false, paths: r.error.issues.map((i) => i.path.join(".") || "(root)") };
  const codes = r.data.items.map((i) => i.code);
  if (new Set(codes).size !== codes.length) return { ok: false, paths: ["items"] };
  return { ok: true, data: r.data };
}

/** A catalogue row as D1 returns it (the JSON columns are still text). */
export type CatalogueRow = {
  code: string;
  name: string;
  slug: string | null;
  category: string;
  unit: string;
  price_inr_minor: number | null;
  price_usd_minor: number | null;
  schedule: string;
  default_lines: string | null;
  show_on_site: number;
  active: number;
};

/** The payment-terms setting as stored (only the public subset is copied; reminder offsets and send windows stay behind). */
export type PaymentTermsValue = {
  dueDays?: unknown;
  proposalValidityDays?: unknown;
  buildSchedule?: unknown;
  smallJobThreshold?: unknown;
};

const codeNumber = (code: string) => Number.parseInt(code.slice(1), 10);
const pick = <T extends Record<string, unknown>>(
  o: unknown,
  keys: readonly (keyof T)[],
): Record<string, unknown> => {
  const src = (o ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k as string] = src[k as string];
  return out;
};
const arrayOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const parseJson = (s: string | null): unknown => {
  if (s === null) return [];
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/**
 * The public snapshot, built from the items that are both on the site and active, with only the fields the snapshot allows (so a
 * SAC code, a GST rate, deliverables, assumptions, exclusions, ids and timestamps cannot get in, whatever the row holds). Items are
 * in code order. Not validated: the caller runs `parseSnapshot` (a bad row makes the publish fail, not a bad file).
 */
export function snapshotFromRows(rows: readonly CatalogueRow[], paymentTerms: PaymentTermsValue | null) {
  const items = rows
    .filter((r) => r.show_on_site === 1 && r.active === 1)
    .toSorted((a, b) => codeNumber(a.code) - codeNumber(b.code))
    .map((r) => ({
      code: r.code,
      name: r.name,
      slug: r.slug,
      category: r.category,
      showOnSite: true,
      unit: r.unit,
      priceInrMinor: r.price_inr_minor,
      priceUsdMinor: r.price_usd_minor,
      schedule: arrayOf(parseJson(r.schedule)).map((s) =>
        pick<{ label: string; pctBp: number; trigger: string }>(s, ["label", "pctBp", "trigger"]),
      ),
      defaultLines: arrayOf(parseJson(r.default_lines)).map((l) =>
        pick<{
          description: string;
          unit: string;
          qtyMilli: number;
          rateInrMinor: number;
          rateUsdMinor: number;
        }>(l, ["description", "unit", "qtyMilli", "rateInrMinor", "rateUsdMinor"]),
      ),
    }));
  const t = paymentTerms ?? {};
  return {
    version: 1,
    items,
    paymentTerms: {
      dueDays: t.dueDays,
      proposalValidityDays: t.proposalValidityDays,
      buildSchedule: arrayOf(t.buildSchedule).map((s) =>
        pick<{ label: string; pctBp: number }>(s, ["label", "pctBp"]),
      ),
      smallJobThreshold: pick<{ INR: number; USD: number }>(t.smallJobThreshold, ["INR", "USD"]),
    },
  };
}

/** JSON with sorted keys and no spaces: the same data always gives the same text, so the same SHA-256. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

/** Lower-case hex SHA-256 of a string. */
export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- templates (ADM-CAT-03) -------------------------------------------------------------------------------------------------

/** The admin API reads a request body of at most 16 KB, so a template body stays well under it (a longer proposal needs its own limit). */
const BODY_TOTAL = 12_000;

export const TEMPLATE_KIND_VALUES = ["proposal", "estimate", "care_block", "terms_block"] as const;

/** Every placeholder a template may use, and where its value comes from. A name outside this list is refused when a version is saved. */
export const TEMPLATE_PLACEHOLDERS = [
  "client.name",
  "client.contact",
  "company.name",
  "proposal.validity_days",
  "service.code",
  "service.name",
  "service.short",
  "service.deliverables",
  "service.assumptions",
  "service.exclusions",
  "service.schedule",
] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

const PLACEHOLDER_RE = /\{\{\s*([a-z_]+(?:\.[a-z_]+)*)\s*\}\}/g;

/** The distinct placeholder names in a text, in order of first use. */
export function placeholdersOf(body: string): string[] {
  return [...new Set([...body.matchAll(PLACEHOLDER_RE)].map((m) => m[1] as string))];
}

/**
 * Fills the placeholders from `data` (a flat map of `client.name`-style keys). A placeholder with no value (missing, null or empty)
 * stays in the text exactly as written and is listed in `unresolved`, so the caller can refuse to send it.
 */
export function renderTemplate(
  body: string,
  data: Readonly<Record<string, string | number | null | undefined>>,
): { text: string; unresolved: string[] } {
  const unresolved = new Set<string>();
  const text = body.replace(PLACEHOLDER_RE, (whole, name: string) => {
    const v = data[name];
    if (v === undefined || v === null || v === "") {
      unresolved.add(name);
      return whole;
    }
    return String(v);
  });
  return { text, unresolved: [...unresolved] };
}

/** A template body: ordered sections, each a heading and a text that may hold placeholders. */
export const templateBody = z.strictObject({
  sections: z
    .array(
      z.strictObject({
        key: z.string().check(z.regex(/^[a-z0-9_]{1,40}$/)),
        heading: shortText(120),
        body: z.string().check(z.maxLength(2000)),
      }),
    )
    .check(
      z.minLength(1),
      z.maxLength(14),
      z.refine((s) => s.reduce((a, x) => a + x.body.length, 0) <= BODY_TOTAL, {
        error: "The template is too long",
      }),
    ),
});
export type TemplateBody = z.infer<typeof templateBody>;

export const createTemplate = z.strictObject({
  kind: z.enum(TEMPLATE_KIND_VALUES),
  category: z.nullable(z.enum(CATALOGUE_CATEGORIES)),
  body: templateBody,
});

/** The placeholders in a template body that are not on the list (empty when the body is fine). */
export function unknownPlaceholders(body: TemplateBody): string[] {
  const known = new Set<string>(TEMPLATE_PLACEHOLDERS);
  return [...new Set(body.sections.flatMap((s) => placeholdersOf(`${s.heading}\n${s.body}`)))].filter(
    (p) => !known.has(p),
  );
}

/** Renders every section; the unresolved placeholders of all sections are collected. */
export function renderTemplateBody(
  body: TemplateBody,
  data: Readonly<Record<string, string | number | null | undefined>>,
): { sections: { key: string; heading: string; text: string }[]; unresolved: string[] } {
  const unresolved = new Set<string>();
  const sections = body.sections.map((s) => {
    const h = renderTemplate(s.heading, data);
    const b = renderTemplate(s.body, data);
    for (const u of [...h.unresolved, ...b.unresolved]) unresolved.add(u);
    return { key: s.key, heading: h.text, text: b.text };
  });
  return { sections, unresolved: [...unresolved] };
}

// ---- start-up warm-up ---------------------------------------------------------------------------------------------------------

/**
 * Parses one made-up sample of each schema (the first parse of a zod schema is the costly one on the Free plan), called from the
 * admin Worker's `warm.ts`. Pure: nothing is stored or logged, a failure is swallowed, and the number of samples that parsed is
 * returned so a test notices a sample that a schema change has made invalid.
 */
export function warmCatalogue(): number {
  try {
    const steps = [{ label: "On acceptance", pctBp: 10_000, trigger: "on_accept" as const }];
    const entry = {
      code: "S99",
      name: "Warm up",
      category: "build" as const,
      short: "A made-up sample",
      unit: "fixed" as const,
      priceInrMinor: 100,
      priceUsdMinor: null,
      sac: "998314",
      gstRateBp: null,
      defaultLines: null,
      schedule: steps,
      slug: "warm-up",
      showOnSite: true,
    };
    const snapshot = snapshotFromRows(
      [
        {
          code: "S99",
          name: "Warm up",
          slug: "warm-up",
          category: "build",
          unit: "fixed",
          price_inr_minor: 100,
          price_usd_minor: null,
          schedule: JSON.stringify(steps),
          default_lines: "[]",
          show_on_site: 1,
          active: 1,
        },
      ],
      {
        dueDays: 7,
        proposalValidityDays: 15,
        buildSchedule: [{ label: "On acceptance", pctBp: 10_000 }],
        smallJobThreshold: { INR: 1, USD: 1 },
      },
    );
    const template = { sections: [{ key: "scope", heading: "Scope", body: "{{service.name}}" }] };
    return (
      Number(createEntry.safeParse(entry).success) +
      Number(patchEntry.safeParse({ expectedUpdatedAt: 1, name: "Warm up" }).success) +
      Number(parseSnapshot(snapshot).ok) +
      Number(createTemplate.safeParse({ kind: "proposal", category: "build", body: template }).success)
    );
  } catch {
    return 0;
  }
}
