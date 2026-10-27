// registerRatesOf [ADM-REP-04]: the INR rates of a computed document, checked against the tax engine's own output: on every
// document the engine's golden cases compute (collected by wrapping `computeDocument`), on generated INR and USD documents, and
// on a few hand-built ones. If the engine ever stops guaranteeing "sum of the INR lines = the INR totals", this fails loudly:
// registerRatesOf never patches around it.
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { registerRatesOf } from "../../src/gst/index.ts";
import type { ComputedDocument, LineInput } from "../../src/tax/index.ts";
import { computeDocument } from "../../src/tax/index.ts";
import {
  DATE,
  EXPORT_IGST,
  good,
  inrDoc,
  line,
  makeCtx,
  OVERSEAS_US,
  REG_MH,
  REG_WB,
  registered,
  unregistered,
  WITH_LUT,
} from "../tax/fixtures.ts";

const seen = vi.hoisted(() => [] as unknown[]);
vi.mock("../../src/tax/index.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/tax/index.ts")>();
  return {
    ...real,
    computeDocument: (...args: Parameters<typeof real.computeDocument>) => {
      const result = real.computeDocument(...args);
      if (result.ok) seen.push(result.value);
      return result;
    },
  };
});

/** The figures a document must add up to in INR: its own for an INR document, the INR view for USD. */
const target = (c: ComputedDocument) => (c.currency === "INR" ? c : c.inr);

function check(c: ComputedDocument) {
  const r = registerRatesOf(c);
  const t = target(c);
  if (t === null) {
    expect(r).toEqual({ ok: false, errors: [{ code: "fx_missing", path: [] }] });
    return;
  }
  if (!r.ok) throw new Error(`registerRatesOf failed: ${JSON.stringify(r.errors)}`);
  const sum = (key: "taxableMinor" | "igstMinor" | "cgstMinor" | "sgstMinor") =>
    r.value.reduce((s, x) => s + x[key], 0);
  expect(sum("taxableMinor")).toBe(t.taxableMinor);
  expect(sum("igstMinor")).toBe(t.igstMinor);
  expect(sum("cgstMinor")).toBe(t.cgstMinor);
  expect(sum("sgstMinor")).toBe(t.sgstMinor);
  // grouped by (SAC, effective rate), sorted
  const keys = r.value.map((x) => `${x.sac ?? ""}|${x.rateBp}`);
  expect(new Set(keys).size).toBe(keys.length);
  expect(r.value.map((x) => [x.sac ?? "", x.rateBp])).toEqual(
    [...r.value]
      .map((x) => [x.sac ?? "", x.rateBp])
      .sort((a, b) =>
        a[0] === b[0] ? (a[1] as number) - (b[1] as number) : (a[0] as string) < (b[0] as string) ? -1 : 1,
      ),
  );
}

describe("on the documents of the engine's golden cases", () => {
  it("every computed document's rates add up to its INR totals", async () => {
    const { GOLDEN } = await import("../tax/golden-cases.ts");
    seen.length = 0;
    for (const c of GOLDEN) c.check();
    expect(seen.length).toBeGreaterThanOrEqual(50);
    let withFx = 0;
    for (const doc of seen as ComputedDocument[]) {
      check(doc);
      if (doc.currency === "USD" && doc.inr !== null) withFx += 1;
    }
    expect(withFx).toBeGreaterThan(0);
  });
});

describe("hand-built documents", () => {
  it("an INR document with two rates and two lines at one rate, one SAC missing", () => {
    const c = good(
      inrDoc(REG_WB, [
        line(1_000_000),
        line(500_000, { gstRateBp: 500 }),
        line(250_000),
        line(100_000, { sac: null, gstRateBp: 500 }),
      ]),
    );
    const r = registerRatesOf(c);
    expect(r.ok && r.value).toEqual([
      { sac: null, rateBp: 500, taxableMinor: 100_000, igstMinor: 0, cgstMinor: 2_500, sgstMinor: 2_500 },
      {
        sac: "998314",
        rateBp: 500,
        taxableMinor: 500_000,
        igstMinor: 0,
        cgstMinor: 12_500,
        sgstMinor: 12_500,
      },
      {
        sac: "998314",
        rateBp: 1800,
        taxableMinor: 1_250_000,
        igstMinor: 0,
        cgstMinor: 112_500,
        sgstMinor: 112_500,
      },
    ]);
    check(c);
  });

  it("a USD document uses the INR view of each line (US$ 1,000.00 x 83.5 = Rs 83,500.00, under LUT: no tax, rate 0)", () => {
    const c = good(
      computeDocument(
        {
          currency: "USD",
          documentDate: DATE,
          recipient: OVERSEAS_US,
          lines: [line(100_000)],
          fx: { rateMicros: 83_500_000 },
        },
        WITH_LUT,
      ),
    );
    expect(registerRatesOf(c)).toEqual({
      ok: true,
      value: [
        { sac: "998314", rateBp: 0, taxableMinor: 8_350_000, igstMinor: 0, cgstMinor: 0, sgstMinor: 0 },
      ],
      warnings: [],
    });
  });

  it("a USD export with IGST paid keeps the rate", () => {
    const c = good(
      computeDocument(
        {
          currency: "USD",
          documentDate: DATE,
          recipient: OVERSEAS_US,
          lines: [line(50_000)],
          fx: { rateMicros: 84_000_000 },
        },
        EXPORT_IGST,
      ),
    );
    expect(registerRatesOf(c)).toEqual({
      ok: true,
      value: [
        {
          sac: "998314",
          rateBp: 1800,
          taxableMinor: 4_200_000,
          igstMinor: 756_000,
          cgstMinor: 0,
          sgstMinor: 0,
        },
      ],
      warnings: [],
    });
  });

  it("a USD document without an exchange rate is fx_missing", () => {
    const c = good(
      computeDocument(
        { currency: "USD", documentDate: DATE, recipient: OVERSEAS_US, lines: [line(100_000)] },
        WITH_LUT,
      ),
    );
    expect(c.inr).toBeNull();
    expect(registerRatesOf(c)).toEqual({ ok: false, errors: [{ code: "fx_missing", path: [] }] });
  });

  it("a line with no INR view is fx_missing at that line", () => {
    const c = good(
      computeDocument(
        {
          currency: "USD",
          documentDate: DATE,
          recipient: OVERSEAS_US,
          lines: [line(100_000), line(50_000)],
          fx: { rateMicros: 83_500_000 },
        },
        WITH_LUT,
      ),
    );
    const broken = {
      ...c,
      lines: [
        c.lines[0] as ComputedDocument["lines"][number],
        { ...(c.lines[1] as ComputedDocument["lines"][number]), inr: null },
      ],
    };
    expect(registerRatesOf(broken)).toEqual({
      ok: false,
      errors: [{ code: "fx_missing", path: ["lines", 1] }],
    });
  });

  it("a document whose lines do not add up to the totals is rates_sum_mismatch (never patched)", () => {
    const c = good(inrDoc(REG_WB, [line(1_000_000), line(500_000)]));
    for (const key of ["taxableMinor", "igstMinor", "cgstMinor", "sgstMinor"] as const) {
      expect(registerRatesOf({ ...c, [key]: c[key] + 1 })).toEqual({
        ok: false,
        errors: [{ code: "rates_sum_mismatch", path: [] }],
      });
    }
  });

  it("never throws on a broken document", () => {
    expect(registerRatesOf(null as never)).toEqual({
      ok: false,
      errors: [{ code: "internal_error", path: [] }],
    });
  });
});

// ---- generated documents -------------------------------------------------------------------------------------------------------
const rawLine = fc.record({
  sac: fc.constantFrom<string | null>("998314", "998313", "998315", null),
  rate: fc.integer({ min: 0, max: 200_000_000 }),
  qty: fc.integer({ min: 1, max: 20_000 }),
  bp: fc.constantFrom<number | undefined>(undefined, 0, 500, 1200, 1800, 2800, 4000),
  discBp: fc.integer({ min: 0, max: 10_000 }),
});
const recipients = [
  REG_WB,
  REG_MH,
  registered("29ABCDE1234F1ZW"),
  unregistered("19"),
  unregistered("33"),
  OVERSEAS_US,
];
const scenario = fc.record({
  supplier: fc.constantFrom("19", "27", "29"),
  recipient: fc.constantFrom(...recipients),
  currency: fc.constantFrom<"INR" | "USD">("INR", "USD"),
  mode: fc.constantFrom<"lut" | "igst_paid">("lut", "igst_paid"),
  lines: fc.array(rawLine, { minLength: 1, maxLength: 8 }),
  docDiscBp: fc.integer({ min: 0, max: 5_000 }),
  fx: fc.integer({ min: 1, max: 200_000_000 }),
  withFx: fc.boolean(),
});

describe("on generated INR and USD documents (the engine's guarantee, as a property)", () => {
  it("the rates add up to the INR totals, for any lines, discounts, supply and exchange rate", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const lines: LineInput[] = s.lines.map((l) => ({
          sac: l.sac,
          qtyMilli: l.qty,
          rateMinor: l.rate,
          gstRateBp: l.bp,
          discount: { kind: "percent", bp: l.discBp },
        }));
        const ctx = makeCtx({ supplier: s.supplier as "19", tax: { exportMode: s.mode } });
        const r = computeDocument(
          {
            currency: s.currency,
            documentDate: DATE,
            recipient: s.recipient,
            lines,
            documentDiscount: { kind: "percent", bp: s.docDiscBp },
            fx: s.currency === "USD" && s.withFx ? { rateMicros: s.fx } : null,
          },
          ctx,
        );
        if (!r.ok) return; // the engine refused this input: nothing to report
        check(r.value);
      }),
      { numRuns: 500 },
    );
  });
});
