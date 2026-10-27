// Which section a document or note belongs to [ADM-REP-04, ADM-INV-17]: the B2CL threshold is strictly "more than", an
// export is always exp, a note follows its parent.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ClassifyInput,
  classifyInvoice,
  classifyNote,
  DEFAULT_B2CL_THRESHOLD_INR_MINOR,
  type NoteParent,
  type RecipientStatus,
  type SupplyType,
} from "../../src/gst/index.ts";
import { d, GSTIN_27 } from "./fixtures.ts";

const T = DEFAULT_B2CL_THRESHOLD_INR_MINOR;
const input = (over: Partial<ClassifyInput> = {}): ClassifyInput => ({
  supplyType: "inter",
  recipientStatus: "unregistered",
  gstin: null,
  totalInrMinor: 100,
  ...over,
});
const section = (i: ClassifyInput, t = T) => {
  const r = classifyInvoice(i, t);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};

describe("classifyInvoice", () => {
  it("the default threshold is Rs 1,00,000.00", () => {
    expect(T).toBe(10_000_000);
  });

  it("exports are exp, with LUT or with IGST, in INR or not", () => {
    expect(section(input({ supplyType: "export_lut", recipientStatus: "overseas" }))).toBe("exp");
    expect(section(input({ supplyType: "export_igst", recipientStatus: "overseas" }))).toBe("exp");
    expect(
      section(input({ supplyType: "export_lut", recipientStatus: "overseas", totalInrMinor: 10 ** 11 })),
    ).toBe("exp");
  });

  it("a registered recipient is b2b whatever the value or the supply, and needs a valid GSTIN", () => {
    for (const supplyType of ["intra", "inter"] as const) {
      expect(
        section(
          input({ supplyType, recipientStatus: "registered", gstin: GSTIN_27, totalInrMinor: 10 ** 11 }),
        ),
      ).toBe("b2b");
    }
    expect(classifyInvoice(input({ recipientStatus: "registered", gstin: null }), T, ["r1"])).toEqual({
      ok: false,
      errors: [{ code: "gstin_missing", path: ["r1"] }],
    });
    expect(classifyInvoice(input({ recipientStatus: "registered", gstin: "" }), T)).toEqual({
      ok: false,
      errors: [{ code: "gstin_missing", path: [] }],
    });
    expect(
      classifyInvoice(input({ recipientStatus: "registered", gstin: "27ABCDE1234F1Z1" }), T, ["r2"]),
    ).toEqual({
      ok: false,
      errors: [{ code: "gstin_invalid", path: ["r2"] }],
    });
  });

  it("the limit is strictly more: exactly Rs 1,00,000.00 is b2cs, one paisa more is b2cl", () => {
    expect(section(input({ totalInrMinor: T }))).toBe("b2cs");
    expect(section(input({ totalInrMinor: T + 1 }))).toBe("b2cl");
    expect(section(input({ totalInrMinor: T - 1 }))).toBe("b2cs");
  });

  it("an unregistered recipient within the state is b2cs however large", () => {
    expect(section(input({ supplyType: "intra", totalInrMinor: 10 ** 12 }))).toBe("b2cs");
  });

  it("a threshold that is negative or not a whole number is threshold_invalid", () => {
    for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
      expect(classifyInvoice(input(), bad)).toEqual({
        ok: false,
        errors: [{ code: "threshold_invalid", path: ["params", "b2clThresholdInrMinor"] }],
      });
    }
    expect(section(input({ totalInrMinor: 1 }), 0)).toBe("b2cl");
  });

  it("overseas with a domestic supply type falls to b2cs", () => {
    expect(section(input({ recipientStatus: "overseas", supplyType: "inter", totalInrMinor: T * 2 }))).toBe(
      "b2cs",
    );
  });
});

const STATUSES: RecipientStatus[] = ["registered", "unregistered", "overseas"];
const SUPPLIES: SupplyType[] = ["intra", "inter", "export_lut", "export_igst"];
const classifyArb = fc.record({
  supplyType: fc.constantFrom(...SUPPLIES),
  recipientStatus: fc.constantFrom(...STATUSES),
  gstin: fc.constant<string | null>(GSTIN_27),
  totalInrMinor: fc.oneof(fc.integer({ min: 0, max: 30_000_000 }), fc.constantFrom(T - 1, T, T + 1)),
});

describe("classifyInvoice (properties)", () => {
  it("b2cl exactly when unregistered, inter-state and above the threshold", () => {
    fc.assert(
      fc.property(classifyArb, fc.integer({ min: 0, max: 30_000_000 }), (i, t) => {
        const got = section(i, t);
        const expected =
          i.supplyType === "export_lut" || i.supplyType === "export_igst"
            ? "exp"
            : i.recipientStatus === "registered"
              ? "b2b"
              : i.recipientStatus === "unregistered" && i.supplyType === "inter" && i.totalInrMinor > t
                ? "b2cl"
                : "b2cs";
        expect(got).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  it("raising the threshold never moves a document from b2cs to b2cl", () => {
    fc.assert(
      fc.property(
        classifyArb,
        fc.integer({ min: 0, max: 30_000_000 }),
        fc.integer({ min: 0, max: 30_000_000 }),
        (i, a, b) => {
          const [low, high] = a <= b ? [a, b] : [b, a];
          if (section(i, low) === "b2cs") expect(section(i, high)).not.toBe("b2cl");
          if (section(i, high) === "b2cl") expect(section(i, low)).toBe("b2cl");
        },
      ),
      { numRuns: 500 },
    );
  });
});

const parent = (over: Partial<NoteParent> = {}): NoteParent => ({
  number: "P1",
  issueDate: d(2026, 10, 1),
  supplyType: "inter",
  recipientStatus: "unregistered",
  placeOfSupplyCode: "29",
  totalInrMinor: 100,
  ...over,
});
const noteClass = (gstin: string | null, noteOf: NoteParent | null, t = T) =>
  classifyNote({ gstin, noteOf }, t, ["n1"]);

describe("classifyNote", () => {
  it("follows the parent's section", () => {
    expect(noteClass(GSTIN_27, parent({ recipientStatus: "registered" }))).toEqual({
      ok: true,
      value: { section: "cdnr", urType: null },
      warnings: [],
    });
    expect(noteClass(null, parent({ totalInrMinor: T + 1 }))).toEqual({
      ok: true,
      value: { section: "cdnur", urType: "B2CL" },
      warnings: [],
    });
    expect(
      noteClass(
        null,
        parent({ supplyType: "export_lut", recipientStatus: "overseas", placeOfSupplyCode: "96" }),
      ),
    ).toEqual({
      ok: true,
      value: { section: "cdnur", urType: "EXPWOP" },
      warnings: [],
    });
    expect(
      noteClass(
        null,
        parent({ supplyType: "export_igst", recipientStatus: "overseas", placeOfSupplyCode: "96" }),
      ),
    ).toEqual({
      ok: true,
      value: { section: "cdnur", urType: "EXPWP" },
      warnings: [],
    });
    expect(noteClass(null, parent())).toEqual({
      ok: true,
      value: { section: "b2cs", urType: null },
      warnings: [],
    });
    expect(noteClass(null, parent({ totalInrMinor: T }))).toEqual({
      ok: true,
      value: { section: "b2cs", urType: null },
      warnings: [],
    });
  });

  it("a note with no parent is parent_missing; a B2B parent needs the note's recipient GSTIN", () => {
    expect(noteClass(null, null)).toEqual({ ok: false, errors: [{ code: "parent_missing", path: ["n1"] }] });
    expect(noteClass(null, parent({ recipientStatus: "registered" }))).toEqual({
      ok: false,
      errors: [{ code: "gstin_missing", path: ["n1"] }],
    });
    expect(noteClass(GSTIN_27, parent(), -5)).toEqual({
      ok: false,
      errors: [{ code: "threshold_invalid", path: ["params", "b2clThresholdInrMinor"] }],
    });
  });

  it("a note always follows its parent's section (property)", () => {
    fc.assert(
      fc.property(classifyArb, (p) => {
        const parentSection = section(p);
        const r = classifyNote(
          {
            gstin: p.gstin,
            noteOf: {
              ...parent(),
              supplyType: p.supplyType,
              recipientStatus: p.recipientStatus,
              totalInrMinor: p.totalInrMinor,
            },
          },
          T,
        );
        if (!r.ok) throw new Error("unexpected");
        const map = { b2b: "cdnr", b2cl: "cdnur", exp: "cdnur", b2cs: "b2cs" } as const;
        expect(r.value.section).toBe(map[parentSection]);
      }),
      { numRuns: 300 },
    );
  });
});
