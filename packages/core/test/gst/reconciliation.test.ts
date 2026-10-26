// The reconciliation property [ADM-REP-04 "totals match the invoices"]: over generated registers (four kinds, three recipient
// statuses, random places of supply, rates 0 to 40 %, amounts up to 10^11 paise, notes to generated parents, some voided, some
// out of the period), the section totals are the signed sum of the register, the two HSN tables add up to the same, every
// reported document is in exactly one section, and voided or out-of-period documents never contribute.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isValidDate } from "../../src/dates.ts";
import {
  classifyInvoice,
  classifyNote,
  type GstDocKind,
  type GstPeriod,
  gstPeriod,
  gstr1Sections,
  inPeriod,
  type RecipientStatus,
  type RegisterRow,
  type StateCode,
  type SupplyType,
} from "../../src/gst/index.ts";
import { d, GSTIN_19, GSTIN_27, GSTIN_29, PARAMS, parentOf, rate, row } from "./fixtures.ts";

const POS_CODES: StateCode[] = ["07", "19", "27", "29", "33", "37"];
const SACS = ["998313", "998314", "998315"];
const RATES = [0, 500, 1200, 1800, 2800, 4000];
const GSTINS = [GSTIN_19, GSTIN_27, GSTIN_29];

const dateArb = fc
  .record({
    year: fc.constantFrom(2026, 2027),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 31 }),
  })
  .filter(isValidDate)
  .map((x) => d(x.year, x.month, x.day));

const ratesArb = (supply: SupplyType) =>
  fc
    .array(
      fc.record({
        sac: fc.constantFrom(...SACS),
        bp: fc.constantFrom(...RATES),
        taxable: fc.oneof(fc.integer({ min: 0, max: 100_000 }), fc.integer({ min: 0, max: 100_000_000_000 })),
      }),
      { minLength: 1, maxLength: 3 },
    )
    .map((xs) => xs.map((x) => rate(x.sac, x.bp, x.taxable, supply)));

type Seed = {
  kind: GstDocKind;
  status: RecipientStatus;
  intra: boolean;
  exportKind: "export_lut" | "export_igst";
  pos: StateCode;
  gstin: string;
  date: ReturnType<typeof d>;
  roundOff: number;
  rateSeed: number;
  parentValue: number;
};

const seedArb: fc.Arbitrary<Seed> = fc.record({
  kind: fc.constantFrom<GstDocKind>("tax_invoice", "export_invoice", "credit_note", "debit_note"),
  status: fc.constantFrom<RecipientStatus>("registered", "unregistered", "overseas"),
  intra: fc.boolean(),
  exportKind: fc.constantFrom<"export_lut" | "export_igst">("export_lut", "export_igst"),
  pos: fc.constantFrom(...POS_CODES),
  gstin: fc.constantFrom(...GSTINS),
  date: dateArb,
  roundOff: fc.integer({ min: -50, max: 50 }),
  rateSeed: fc.nat(),
  parentValue: fc.oneof(
    fc.integer({ min: 0, max: 20_000_000 }),
    fc.constantFrom(9_999_999, 10_000_000, 10_000_001),
  ),
});

function build(
  seeds: readonly (Seed & { rates: ReturnType<typeof rate>[]; voided: boolean })[],
): RegisterRow[] {
  return seeds.map((s, i) => {
    const overseas = s.status === "overseas";
    const supply: SupplyType = overseas ? s.exportKind : s.intra ? "intra" : "inter";
    const pos = overseas ? "96" : s.intra ? "19" : s.pos === "19" ? "27" : s.pos;
    const status: RecipientStatus = s.status;
    const noteLike = s.kind === "credit_note" || s.kind === "debit_note";
    const sum = s.rates.reduce((t, r) => t + r.taxableMinor + r.igstMinor + r.cgstMinor + r.sgstMinor, 0);
    const base = row({
      id: `r${i}`,
      number: `N${i}`,
      kind: s.kind,
      date: s.date,
      voided: s.voided,
      supply,
      pos,
      status,
      gstin: status === "registered" ? s.gstin : null,
      rates: s.rates,
      roundOff: Math.max(s.roundOff, -sum),
    });
    if (!noteLike) return base;
    // A note's parent shares the note's recipient; the parent's size is generated on its own.
    return {
      ...base,
      noteOf: { ...parentOf(base), totalInrMinor: s.parentValue, issueDate: d(2026, 9, 1), number: `P${i}` },
    };
  });
}

const registerArb = fc.array(seedArb, { minLength: 1, maxLength: 24 }).chain((seeds) =>
  fc
    .tuple(
      fc.array(fc.boolean(), { minLength: seeds.length, maxLength: seeds.length }),
      ...seeds.map((s) => ratesArb(s.status === "overseas" ? s.exportKind : s.intra ? "intra" : "inter")),
    )
    .map(([voids, ...rates]) =>
      build(
        seeds.map((s, i) => ({
          ...s,
          rates: rates[i] as ReturnType<typeof rate>[],
          voided: voids[i] as boolean,
        })),
      ),
    ),
);

const periodArb: fc.Arbitrary<GstPeriod> = fc.oneof(
  fc
    .integer({ min: 1, max: 12 })
    .chain((month) => fc.constantFrom(2026, 2027).map((year) => ({ kind: "month", year, month }) as const)),
  fc
    .integer({ min: 1, max: 4 })
    .map((q) => ({ kind: "quarter", fyStartYear: 2026, quarter: q as 1 | 2 | 3 | 4 }) as const),
);

const signOf = (r: RegisterRow) => (r.kind === "credit_note" ? -1 : 1);
const sum = (rows: readonly RegisterRow[], pick: (r: RegisterRow) => number) =>
  rows.reduce((t, r) => t + signOf(r) * pick(r), 0);
const ofRates = (key: "taxableMinor" | "igstMinor" | "cgstMinor" | "sgstMinor") => (r: RegisterRow) =>
  r.rates.reduce((t, x) => t + x[key], 0);

describe("GSTR-1 reconciliation (property)", () => {
  it("totals, HSN, sections and filters agree with an independent sum of the register", () => {
    fc.assert(
      fc.property(registerArb, periodArb, (register, period) => {
        const range = gstPeriod(period);
        if (!range.ok) throw new Error("period");
        const result = gstr1Sections(register, period, PARAMS);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
        const { totals } = result.value;
        const reported = register.filter((r) => !r.voided && inPeriod(r.issueDate, range.value));

        // the whole return: the signed sum of the reported rows, field by field
        expect(totals.overall.documents).toBe(reported.length);
        expect(totals.overall.taxableMinor).toBe(sum(reported, ofRates("taxableMinor")));
        expect(totals.overall.igstMinor).toBe(sum(reported, ofRates("igstMinor")));
        expect(totals.overall.cgstMinor).toBe(sum(reported, ofRates("cgstMinor")));
        expect(totals.overall.sgstMinor).toBe(sum(reported, ofRates("sgstMinor")));
        expect(totals.overall.documentValueMinor).toBe(sum(reported, (r) => r.totalInrMinor));
        expect(totals.overall.valueMinor).toBe(
          totals.overall.taxableMinor +
            totals.overall.igstMinor +
            totals.overall.cgstMinor +
            totals.overall.sgstMinor,
        );

        // the sections add up to the whole; so do the two HSN tables
        const parts = [totals.b2b, totals.b2cl, totals.b2cs, totals.exp, totals.cdnr, totals.cdnur];
        for (const key of [
          "documents",
          "taxableMinor",
          "igstMinor",
          "cgstMinor",
          "sgstMinor",
          "valueMinor",
          "documentValueMinor",
        ] as const) {
          expect(parts.reduce((t, x) => t + x[key], 0)).toBe(totals.overall[key]);
          expect(totals.hsnB2b[key] + totals.hsnB2c[key]).toBe(totals.overall[key]);
        }

        // the rows say what the totals say
        const v = result.value;
        const rowSum = (
          rows: readonly { taxableMinor: number; igstMinor: number; cgstMinor: number; sgstMinor: number }[],
          signs?: (i: number) => number,
        ) =>
          rows.reduce(
            (t, r, i) => t + (signs?.(i) ?? 1) * (r.taxableMinor + r.igstMinor + r.cgstMinor + r.sgstMinor),
            0,
          );
        expect(rowSum(v.b2b)).toBe(totals.b2b.valueMinor);
        expect(rowSum(v.b2cl)).toBe(totals.b2cl.valueMinor);
        expect(rowSum(v.exp)).toBe(totals.exp.valueMinor);
        expect(rowSum(v.b2cs)).toBe(totals.b2cs.valueMinor);
        expect(rowSum(v.cdnr, (i) => (v.cdnr[i]?.noteType === "C" ? -1 : 1))).toBe(totals.cdnr.valueMinor);
        expect(rowSum(v.cdnur, (i) => (v.cdnur[i]?.noteType === "C" ? -1 : 1))).toBe(totals.cdnur.valueMinor);
        expect(rowSum(v.hsnB2b)).toBe(totals.hsnB2b.valueMinor);
        expect(rowSum(v.hsnB2c)).toBe(totals.hsnB2c.valueMinor);
        for (const h of [...v.hsnB2b, ...v.hsnB2c]) {
          expect(h.totalValueMinor).toBe(h.taxableMinor + h.igstMinor + h.cgstMinor + h.sgstMinor);
        }

        // every reported document is in exactly one section (b2cs rows carry no document, so it is counted instead)
        const inTables = new Map<string, string[]>();
        for (const [name, rows] of [
          ["b2b", v.b2b],
          ["b2cl", v.b2cl],
          ["exp", v.exp],
          ["cdnr", v.cdnr],
          ["cdnur", v.cdnur],
        ] as const) {
          for (const r of rows) inTables.set(r.docId, [...new Set([...(inTables.get(r.docId) ?? []), name])]);
        }
        for (const names of inTables.values()) expect(names).toHaveLength(1);
        const inB2cs = reported.filter((r) => !inTables.has(r.id));
        expect(inB2cs.length).toBe(totals.b2cs.documents);

        // the section of each document is the one the classifier gives
        for (const r of reported) {
          const got = inTables.get(r.id)?.[0] ?? "b2cs";
          if (r.kind === "tax_invoice" || r.kind === "export_invoice") {
            const c = classifyInvoice(
              {
                supplyType: r.supplyType,
                recipientStatus: r.recipient.status,
                gstin: r.recipient.gstin,
                totalInrMinor: r.totalInrMinor,
              },
              PARAMS.b2clThresholdInrMinor,
            );
            expect(c.ok && c.value).toBe(got);
          } else {
            const c = classifyNote(
              { gstin: r.recipient.gstin, noteOf: r.noteOf },
              PARAMS.b2clThresholdInrMinor,
            );
            expect(c.ok && c.value.section).toBe(got);
          }
        }

        // rows of b2b, b2cl and exp are the (invoice, rate) pairs
        for (const r of reported) {
          const rows = [...v.b2b, ...v.b2cl, ...v.exp, ...v.cdnr, ...v.cdnur].filter((x) => x.docId === r.id);
          if (rows.length > 0) {
            expect(rows.length).toBe(new Set(r.rates.map((x) => x.rateBp)).size);
            expect(rows.every((x) => x.valueInrMinor === r.totalInrMinor)).toBe(true);
          }
        }

        // voided and out-of-period documents never appear
        const excluded = new Set(
          register.filter((r) => r.voided || !inPeriod(r.issueDate, range.value)).map((r) => r.id),
        );
        for (const id of inTables.keys()) expect(excluded.has(id)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("the output does not depend on the order of the register", () => {
    fc.assert(
      fc.property(registerArb, periodArb, (register, period) => {
        const a = gstr1Sections(register, period, PARAMS);
        const b = gstr1Sections([...register].reverse(), period, PARAMS);
        expect(b).toEqual(a);
      }),
      { numRuns: 100 },
    );
  });
});
