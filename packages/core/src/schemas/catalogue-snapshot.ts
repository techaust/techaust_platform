// The public catalogue snapshot (ADM-CAT-05): what the website build reads (WEB-G-07, WEB-SVC-05). Public fields only:
// every object is strict, so a field that isn't listed here (SAC code, GST rate, internal notes, deliverables,
// assumptions, exclusions, IDs, timestamps…) makes the whole file invalid. Amounts are integer minor units.
// test/catalogue-snapshot.test.ts proves the internal fields can't pass.
import * as z from "zod";
import { SCHEDULE_TRIGGERS } from "../schedule-text.ts";

const minor = z.int().nonnegative();
const bp = z.int().min(0).max(10_000);

export const SNAPSHOT_CATEGORIES = ["advise", "build", "automate", "connect", "run"] as const;
export const SNAPSHOT_UNITS = ["fixed", "milestone", "month", "workflow", "connector"] as const;

const addsTo100 = { error: "The schedule must add up to 100 %" };

export const snapshotScheduleStep = z.strictObject({
  label: z.string().min(1),
  pctBp: bp,
  trigger: z.enum(SCHEDULE_TRIGGERS),
});

/** A default line the site shows: care-plan tiers, S11 setup and monthly (owner decision 2026-10-07). */
export const snapshotLine = z.strictObject({
  description: z.string().min(1),
  unit: z.enum(SNAPSHOT_UNITS),
  qtyMilli: z.int().positive(),
  rateInrMinor: minor.nullable(),
  rateUsdMinor: minor.nullable(),
});

export const snapshotItem = z.strictObject({
  code: z.string().regex(/^S\d+$/),
  name: z.string().min(1),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .nullable(),
  category: z.enum(SNAPSHOT_CATEGORIES),
  showOnSite: z.boolean(),
  unit: z.enum(SNAPSHOT_UNITS),
  priceInrMinor: minor.nullable(),
  priceUsdMinor: minor.nullable(),
  schedule: z
    .array(snapshotScheduleStep)
    .min(1)
    .refine((s) => s.reduce((a, x) => a + x.pctBp, 0) === 10_000, addsTo100),
  defaultLines: z.array(snapshotLine),
});

/** The published payment-terms settings (the public subset: no reminder offsets or send windows). */
export const snapshotPaymentTerms = z.strictObject({
  dueDays: z.int().min(0).max(90),
  proposalValidityDays: z.int().min(1).max(90),
  buildSchedule: z
    .array(z.strictObject({ label: z.string().min(1), pctBp: bp }))
    .min(1)
    .refine((s) => s.reduce((a, x) => a + x.pctBp, 0) === 10_000, addsTo100),
  smallJobThreshold: z.strictObject({ INR: minor, USD: minor }),
});

export const catalogueSnapshot = z
  .strictObject({
    version: z.literal(1),
    items: z.array(snapshotItem).min(1),
    paymentTerms: snapshotPaymentTerms,
  })
  .refine((s) => new Set(s.items.map((i) => i.code)).size === s.items.length, {
    error: "Duplicate catalogue code",
    path: ["items"],
  });

export type CatalogueSnapshot = z.infer<typeof catalogueSnapshot>;
export type SnapshotItem = z.infer<typeof snapshotItem>;
