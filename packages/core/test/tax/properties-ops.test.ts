// Property tests of schedules, the inclusive split, credit-note sequences and the "never throws" rule [ADM-PROP-03,
// ADM-INV-10, ADM-INV-11; docs/05 §10]. 300 runs each.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ComputedDocument,
  type CreditedSoFar,
  type CreditRequest,
  computeDocument,
  computeSchedule,
  creditNote,
  determineSupply,
  type InclusiveGroup,
  type ScheduleStep,
  type Supply,
  splitInclusive,
  type TaxResult,
} from "../../src/tax/index.ts";
import {
  DATE,
  DEFAULTS,
  EXPORT_IGST_SUPPLY,
  EXPORT_LUT_SUPPLY,
  good,
  INTER_27_SUPPLY,
  INTRA_SUPPLY,
  inrDoc,
  line,
  OVERSEAS_US,
  REG_MH,
  REG_WB,
  unregistered,
} from "./fixtures.ts";

const RUNS = { numRuns: 300 } as const;

// ---------------------------------------------------------------------------------------------- schedules
/** k shares of 10,000 bp from k-1 cut points. */
const sharesArb = fc
  .array(fc.integer({ min: 0, max: 10_000 }), { minLength: 0, maxLength: 11 })
  .map((cuts) => {
    const sorted = [...cuts].sort((a, b) => a - b);
    const points = [0, ...sorted, 10_000];
    return points.slice(1).map((p, i) => p - (points[i] as number));
  });

describe("property: schedules", () => {
  it("percent steps: instalments add up to the total, are >= 0, whole units, and each (but the last) is at most its exact share", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"INR" | "USD">("INR", "USD"),
        fc.integer({ min: 0, max: 5_000_000_000 }),
        sharesArb,
        (currency, base, shares) => {
          // A last step at 0 % is refused (schedule_step_invalid): the property is about the valid schedules.
          fc.pre((shares[shares.length - 1] as number) > 0);
          const total = currency === "INR" ? base * 100 : base;
          const unit = currency === "INR" ? 100 : 1;
          const steps: ScheduleStep[] = shares.map((pctBp, i) => ({
            label: `Step ${i}`,
            trigger: "milestone",
            pctBp,
          }));
          const out = good(computeSchedule(total, currency, steps, DEFAULTS));
          expect(out.reduce((a, i) => a + i.amountMinor, 0)).toBe(total);
          out.forEach((inst, i) => {
            expect(inst.amountMinor).toBeGreaterThanOrEqual(0);
            expect(inst.amountMinor % unit).toBe(0);
            expect(inst.pctBp).toBe(shares[i]);
            if (i < out.length - 1)
              expect(BigInt(inst.amountMinor) * 10_000n <= BigInt(total) * BigInt(inst.pctBp)).toBe(true);
          });
        },
      ),
      RUNS,
    );
  });

  it("amount steps: the typed amounts are kept, the last is the rest, and the shown shares add up to exactly 100 %", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"INR" | "USD">("INR", "USD"),
        fc.integer({ min: 0, max: 900_000_000 }),
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 0, maxLength: 10 }),
        (currency, base, fractions) => {
          const unit = currency === "INR" ? 100 : 1;
          const total = base * unit;
          // typed amounts, each a unit multiple, never more than what is left
          let left = total;
          const typed = fractions.map((f) => {
            const amount = Math.floor((Math.floor(left / unit) * f) / 100) * unit;
            left -= amount;
            return amount;
          });
          const steps: ScheduleStep[] = [
            ...typed.map((amountMinor, i) => ({
              label: `Step ${i}`,
              trigger: "milestone" as const,
              amountMinor,
            })),
            { label: "Last", trigger: "delivery" },
          ];
          const out = good(computeSchedule(total, currency, steps, DEFAULTS));
          expect(out.map((i) => i.amountMinor).slice(0, -1)).toEqual(typed);
          expect(out.reduce((a, i) => a + i.amountMinor, 0)).toBe(total);
          expect(out.reduce((a, i) => a + i.pctBp, 0)).toBe(10_000);
          for (const inst of out) {
            expect(inst.amountMinor).toBeGreaterThanOrEqual(0);
            expect(inst.pctBp).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------------------------- inclusive split
const supplies: Supply[] = [INTRA_SUPPLY, INTER_27_SUPPLY, EXPORT_IGST_SUPPLY, EXPORT_LUT_SUPPLY];

describe("property: the inclusive split", () => {
  it("the total is exactly the gross; the residual is 0 to 2 per group; tax never exceeds the gross; INR lines compute back to the gross", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"INR" | "USD">("INR", "USD"),
        fc.integer({ min: 0, max: 900_000_000 }),
        fc.constantFrom(...supplies),
        fc.array(
          fc.record({
            rate: fc.constantFrom(0, 500, 1200, 1800, 2800),
            weight: fc.integer({ min: 0, max: 5_000_000 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (currency, base, supply, raw) => {
          const gross = currency === "INR" ? base * 100 : base;
          const groups: InclusiveGroup[] = raw.map((g, i) => ({
            sac: "998314",
            gstRateBp: g.rate,
            weightMinor: i === 0 ? g.weight + 1 : g.weight, // never all zero
          }));
          const { lines, document: d } = good(
            splitInclusive(gross, groups, supply, currency, null, DEFAULTS, { documentDate: DATE }),
          );
          expect(d.totalMinor).toBe(gross);
          expect(d.roundOffMinor).toBeGreaterThanOrEqual(0);
          expect(d.roundOffMinor).toBeLessThanOrEqual(2 * groups.length);
          expect(d.taxableMinor + d.cgstMinor + d.sgstMinor + d.igstMinor).toBeLessThanOrEqual(gross);
          expect(lines).toHaveLength(groups.length);
          if (currency === "INR") {
            const again = good(computeDocument({ currency, documentDate: DATE, supply, lines }, DEFAULTS));
            expect(again.totalMinor).toBe(gross);
            expect(again.taxableMinor).toBe(d.taxableMinor);
          }
        },
      ),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------------------------- credit notes
const zeroCredit = { taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0 };

/** What the notes issued so far took from an invoice, checked after every note. */
function ledgerOf(original: ComputedDocument) {
  const credited = original.lines.map(() => ({ ...zeroCredit }));
  const inrCredited = original.inr ? original.lines.map(() => ({ ...zeroCredit })) : null;
  let creditedTotal = 0;
  let inrTotal = 0;
  const left = (i: number) =>
    (original.lines[i]?.taxableMinor as number) - (credited[i]?.taxableMinor as number);
  const add = (c: typeof zeroCredit, l: typeof zeroCredit) => ({
    taxableMinor: c.taxableMinor + l.taxableMinor,
    cgstMinor: c.cgstMinor + l.cgstMinor,
    sgstMinor: c.sgstMinor + l.sgstMinor,
    igstMinor: c.igstMinor + l.igstMinor,
  });
  const within = (c: typeof zeroCredit, o: typeof zeroCredit) => {
    expect(c.taxableMinor).toBeLessThanOrEqual(o.taxableMinor);
    expect(c.cgstMinor).toBeLessThanOrEqual(o.cgstMinor);
    expect(c.sgstMinor).toBeLessThanOrEqual(o.sgstMinor);
    expect(c.igstMinor).toBeLessThanOrEqual(o.igstMinor);
  };
  return {
    left,
    remaining: () => original.lines.reduce((a, _, i) => a + left(i), 0),
    soFar(): CreditedSoFar {
      return {
        lines: credited,
        creditedTotalMinor: creditedTotal,
        ...(inrCredited ? { inr: { lines: inrCredited, totalMinor: inrTotal } } : {}),
      };
    },
    apply(cn: ComputedDocument) {
      for (const l of cn.lines) {
        credited[l.index] = add(credited[l.index] as typeof zeroCredit, l);
        if (inrCredited && l.inr) {
          inrCredited[l.index] = add(inrCredited[l.index] as typeof zeroCredit, l.inr);
        }
      }
      creditedTotal += cn.totalMinor;
      inrTotal += cn.inr?.totalMinor ?? 0;
      // after every note: never above the original on any line or head, and the notes never add up to more than the invoice
      original.lines.forEach((o, i) => {
        within(credited[i] as typeof zeroCredit, o);
        if (inrCredited && o.inr) within(inrCredited[i] as typeof zeroCredit, o.inr);
      });
      expect(creditedTotal).toBeLessThanOrEqual(original.totalMinor);
      if (original.inr) expect(inrTotal).toBeLessThanOrEqual(original.inr.totalMinor);
    },
    /** Nothing is left: the notes add up to the original, per line, per head and in total (and in INR the same). */
    expectComplete() {
      expect(creditedTotal).toBe(original.totalMinor);
      original.lines.forEach((o, i) => {
        expect(credited[i]).toEqual({
          taxableMinor: o.taxableMinor,
          cgstMinor: o.cgstMinor,
          sgstMinor: o.sgstMinor,
          igstMinor: o.igstMinor,
        });
        if (inrCredited && o.inr) {
          expect(inrCredited[i]).toEqual({
            taxableMinor: o.inr.taxableMinor,
            cgstMinor: o.inr.cgstMinor,
            sgstMinor: o.inr.sgstMinor,
            igstMinor: o.inr.igstMinor,
          });
        }
      });
      if (original.inr) expect(inrTotal).toBe(original.inr.totalMinor);
    },
  };
}

describe("property: credit-note sequences", () => {
  it("never take more than the original on any line or head, never add up to more than the invoice, and once nothing is left add up to the original exactly (USD invoices: also in INR)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(REG_WB, REG_MH, unregistered("33"), OVERSEAS_US),
        fc.array(
          fc.record({
            rate: fc.integer({ min: 100_000, max: 90_000_000 }),
            bp: fc.constantFrom(0, 500, 1800, 2800),
          }),
          {
            minLength: 1,
            maxLength: 5,
          },
        ),
        fc.array(
          fc.record({
            kind: fc.constantFrom("amount", "line"),
            pick: fc.integer({ min: 0, max: 4 }),
            // a share of what is left, 1 % to 80 %, so a real remainder stays for the final note
            share: fc.integer({ min: 1, max: 80 }),
          }),
          { minLength: 0, maxLength: 4 },
        ),
        fc.integer({ min: 1_000_000, max: 200_000_000 }),
        (recipient, rawLines, steps, fxMicros) => {
          const isExport = recipient.gstStatus === "overseas";
          const lines = rawLines.map((l) => line(l.rate, { gstRateBp: l.bp }));
          const original = good(
            isExport
              ? computeDocument(
                  {
                    currency: "USD",
                    documentDate: DATE,
                    recipient,
                    exportMode: "igst_paid",
                    lines,
                    fx: { rateMicros: fxMicros },
                  },
                  DEFAULTS,
                )
              : inrDoc(recipient, lines),
          );
          const ledger = ledgerOf(original);
          for (const step of steps) {
            const remaining = ledger.remaining();
            if (remaining === 0) break;
            let request: CreditRequest;
            if (step.kind === "amount") {
              const amount = Math.floor((remaining * step.share) / 100);
              if (amount === 0) continue;
              request = { kind: "amount", taxableMinor: amount };
            } else {
              const i = step.pick % original.lines.length;
              const part = Math.floor((ledger.left(i) * step.share) / 100);
              if (part === 0) continue;
              request = { kind: "lines", lines: [{ line: i, taxableMinor: part }] };
            }
            ledger.apply(good(creditNote(original, ledger.soFar(), request, DEFAULTS)));
          }
          if (ledger.remaining() > 0) {
            ledger.apply(good(creditNote(original, ledger.soFar(), { kind: "full" }, DEFAULTS)));
          }
          ledger.expectComplete();
        },
      ),
      RUNS,
    );
  });

  it("tiny remainders: 1 to 3 minor units of taxable value left for the final note (INR and USD with FX)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(REG_WB, REG_MH, OVERSEAS_US),
        fc.array(fc.integer({ min: 1, max: 5_000_000 }), { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 99 }),
        fc.integer({ min: 1_000_000, max: 200_000_000 }),
        (recipient, rates, tiny, firstShare, fxMicros) => {
          const lines = rates.map((r) => line(r));
          const original = good(
            recipient.gstStatus === "overseas"
              ? computeDocument(
                  {
                    currency: "USD",
                    documentDate: DATE,
                    recipient,
                    exportMode: "igst_paid",
                    lines,
                    fx: { rateMicros: fxMicros },
                  },
                  DEFAULTS,
                )
              : inrDoc(recipient, lines),
          );
          const ledger = ledgerOf(original);
          const all = ledger.remaining();
          if (all <= tiny + 1) return; // nothing to leave behind
          // a first note for part of the document, then a second that leaves only `tiny` behind, then the final note
          const first = Math.max(1, Math.floor(((all - tiny) * firstShare) / 100));
          ledger.apply(
            good(creditNote(original, ledger.soFar(), { kind: "amount", taxableMinor: first }, DEFAULTS)),
          );
          const rest = ledger.remaining() - tiny;
          if (rest > 0) {
            ledger.apply(
              good(creditNote(original, ledger.soFar(), { kind: "amount", taxableMinor: rest }, DEFAULTS)),
            );
          }
          ledger.apply(good(creditNote(original, ledger.soFar(), { kind: "full" }, DEFAULTS)));
          ledger.expectComplete();
        },
      ),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------------------------- never throws
const weird = fc.oneof(
  fc.integer({ min: -5, max: 5 }),
  fc.integer(),
  fc.double({ noDefaultInfinity: false, noNaN: false }),
  fc.constantFrom(
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    2 ** 53,
    -(2 ** 53),
    Number.MAX_SAFE_INTEGER,
    1e300,
    0.5,
    -0,
  ),
);
/** A result of the declared shape that is not a swallowed defect (`internal_error`). */
const sound = (r: TaxResult<unknown>) =>
  typeof r.ok === "boolean" && (r.ok || !r.errors.some((e) => e.code === "internal_error"));

describe("property: nothing throws, whatever the numbers (NaN, infinity, unsafe, negative, fractional)", () => {
  it("computeDocument", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            qty: weird,
            rate: weird,
            bp: fc.option(weird, { nil: undefined }),
            disc: fc.option(
              fc.oneof(
                fc.record({ kind: fc.constant("fixed" as const), minor: weird }),
                fc.record({ kind: fc.constant("percent" as const), bp: weird }),
              ),
              { nil: null },
            ),
          }),
          { minLength: 0, maxLength: 4 },
        ),
        fc.option(fc.record({ kind: fc.constant("percent" as const), bp: weird }), { nil: null }),
        fc.option(weird, { nil: undefined }),
        fc.constantFrom("INR", "USD") as fc.Arbitrary<"INR" | "USD">,
        fc.record({ year: weird, month: weird, day: weird }),
        fc.constantFrom(REG_WB, REG_MH, OVERSEAS_US, unregistered("27")),
        (lines, documentDiscount, fx, currency, documentDate, recipient) => {
          const run = () =>
            computeDocument(
              {
                currency,
                documentDate,
                recipient,
                lines: lines.map((l) => ({
                  sac: "998314",
                  qtyMilli: l.qty,
                  rateMinor: l.rate,
                  gstRateBp: l.bp,
                  discount: l.disc,
                })),
                documentDiscount,
                fx: fx === undefined ? null : { rateMicros: fx },
              },
              DEFAULTS,
            );
          expect(run).not.toThrow();
          expect(sound(run())).toBe(true);
        },
      ),
      RUNS,
    );
  });

  it("computeSchedule", () => {
    fc.assert(
      fc.property(
        weird,
        fc.array(
          fc.record({
            pct: fc.option(weird, { nil: undefined }),
            amount: fc.option(weird, { nil: undefined }),
          }),
          { maxLength: 4 },
        ),
        (total, raw) => {
          const steps = raw.map((s, i) =>
            s.pct !== undefined
              ? { label: `S${i}`, trigger: "milestone" as const, pctBp: s.pct }
              : { label: `S${i}`, trigger: "milestone" as const, amountMinor: s.amount },
          );
          const run = () => computeSchedule(total, "INR", steps, DEFAULTS);
          expect(run).not.toThrow();
          expect(sound(run())).toBe(true);
        },
      ),
      RUNS,
    );
  });

  it("splitInclusive", () => {
    fc.assert(
      fc.property(
        weird,
        fc.array(fc.record({ rate: weird, weight: weird }), { maxLength: 4 }),
        fc.constantFrom(...supplies),
        fc.option(weird, { nil: undefined }),
        (gross, raw, supply, fx) => {
          const groups = raw.map((g) => ({ sac: "998314", gstRateBp: g.rate, weightMinor: g.weight }));
          const run = () =>
            splitInclusive(
              gross,
              groups,
              supply,
              "USD",
              fx === undefined ? null : { rateMicros: fx },
              DEFAULTS,
              { documentDate: DATE },
            );
          expect(run).not.toThrow();
          expect(sound(run())).toBe(true);
        },
      ),
      RUNS,
    );
  });

  it("creditNote", () => {
    const original = good(inrDoc(REG_WB, [line(1_000_000), line(250_000)]));
    fc.assert(
      fc.property(
        fc.array(fc.record({ t: weird, c: weird, s: weird, i: weird }), { maxLength: 3 }),
        weird,
        weird,
        weird,
        fc.constantFrom("full", "lines", "amount"),
        (credited, total, amount, lineNo, kind) => {
          const request: CreditRequest =
            kind === "full"
              ? { kind: "full" }
              : kind === "lines"
                ? { kind: "lines", lines: [{ line: lineNo, taxableMinor: amount }] }
                : { kind: "amount", taxableMinor: amount };
          const run = () =>
            creditNote(
              original,
              {
                lines: credited.map((c) => ({
                  taxableMinor: c.t,
                  cgstMinor: c.c,
                  sgstMinor: c.s,
                  igstMinor: c.i,
                })),
                creditedTotalMinor: total,
              },
              request,
              DEFAULTS,
            );
          expect(run).not.toThrow();
          expect(sound(run())).toBe(true);
        },
      ),
      RUNS,
    );
  });

  it("creditNote with a hostile original (consistent array lengths, arbitrary values)", () => {
    const usd = good(
      computeDocument(
        {
          currency: "USD",
          documentDate: DATE,
          recipient: OVERSEAS_US,
          lines: [line(1_000_000), line(250_000)],
          fx: { rateMicros: 83_000_000 },
        },
        DEFAULTS,
      ),
    );
    const zero = { taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0 };
    // Mostly the real value, sometimes an arbitrary one, so deep paths are reached as well as the early refusals
    const maybe = <T>(real: T) =>
      fc.oneof(
        { weight: 3, arbitrary: fc.constant<unknown>(real) },
        { weight: 1, arbitrary: weird as fc.Arbitrary<unknown> },
      );
    const lineArb = fc.record({
      index: maybe(0),
      gstRateBp: maybe(1800),
      effectiveRateBp: maybe(0),
      taxableMinor: maybe(1_000_000),
      cgstMinor: maybe(0),
      sgstMinor: maybe(0),
      igstMinor: maybe(0),
      inr: fc.oneof(
        fc.constant(null),
        fc.record({
          taxableMinor: maybe(83_000_000),
          cgstMinor: maybe(0),
          sgstMinor: maybe(0),
          igstMinor: maybe(0),
        }),
      ),
    });
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 2, maxLength: 2 }),
        maybe(usd.totalMinor),
        maybe(83_000_000),
        fc.oneof(fc.constant(null), maybe(usd.inr?.totalMinor)),
        fc.constantFrom("USD", "INR", "EUR"),
        fc.constantFrom("full", "amount"),
        weird,
        (lines, total, fx, inrTotal, currency, kind, amount) => {
          const hostile = {
            ...usd,
            currency,
            totalMinor: total,
            fxRateMicros: fx,
            inr: inrTotal === null ? null : { ...usd.inr, totalMinor: inrTotal },
            lines: lines.map((l) => ({ ...(usd.lines[0] as object), ...l })),
          } as unknown as ComputedDocument;
          const request: CreditRequest =
            kind === "full" ? { kind: "full" } : { kind: "amount", taxableMinor: amount };
          const run = () =>
            creditNote(
              hostile,
              { lines: [zero, zero], creditedTotalMinor: 0, inr: { lines: [zero, zero], totalMinor: 0 } },
              request,
              DEFAULTS,
            );
          expect(run).not.toThrow();
          expect(sound(run())).toBe(true);
        },
      ),
      RUNS,
    );
  });

  it("determineSupply with a hostile date", () => {
    fc.assert(
      fc.property(fc.record({ year: weird, month: weird, day: weird }), (documentDate) => {
        const run = () => determineSupply(OVERSEAS_US, DEFAULTS, { documentDate, currency: "USD" });
        expect(run).not.toThrow();
        expect(sound(run())).toBe(true);
      }),
      RUNS,
    );
  });
});
