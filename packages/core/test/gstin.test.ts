import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  gstinCheckChar,
  isStateCode,
  STATE_CODES,
  SUPPLIER_STATE_CODE,
  selectableStates,
  validateGstin,
} from "../src/gstin.ts";

// Published GSTINs whose check characters were computed independently of this code: the GST portal's
// documentation example, and a worked example from an independent validator write-up (both checked 2026-10-06).
const VECTORS = [
  { gstin: "27AAPFU0939F1ZV", state: "Maharashtra", pan: "AAPFU0939F" },
  { gstin: "29AAGCB7383J1Z4", state: "Karnataka", pan: "AAGCB7383J" },
];
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

describe("GSTIN check character [ADM-SET-01]", () => {
  it.each(VECTORS)("$gstin is valid, in $state", ({ gstin, state, pan }) => {
    expect(validateGstin(gstin)).toEqual({
      ok: true,
      gstin,
      stateCode: gstin.slice(0, 2),
      state,
      pan,
      legacyState: false,
    });
  });

  it("normalises case and spaces", () => {
    expect(validateGstin(" 27aapfu0939f1zv ")).toMatchObject({ ok: true, gstin: "27AAPFU0939F1ZV" });
    expect(validateGstin("27AAP FU093 9F1ZV")).toMatchObject({ ok: true });
  });

  it("property: changing any single character is always caught", () => {
    const { gstin } = VECTORS[0] as { gstin: string };
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 14 }), fc.constantFrom(...ALPHABET), (i, ch) => {
        fc.pre(gstin[i] !== ch);
        const changed = gstin.slice(0, i) + ch + gstin.slice(i + 1);
        expect(validateGstin(changed).ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it("property: a correct check character makes any well-shaped GSTIN valid", () => {
    const letters = fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    const digit = fc.constantFrom(..."0123456789");
    const state = fc.constantFrom(...Object.keys(STATE_CODES));
    const body = fc
      .tuple(
        state,
        fc.array(letters, { minLength: 5, maxLength: 5 }),
        fc.array(digit, { minLength: 4, maxLength: 4 }),
        letters,
        fc.constantFrom(..."123456789ABC"),
      )
      .map(([s, a, d, l, e]) => `${s}${a.join("")}${d.join("")}${l}${e}Z`);
    fc.assert(
      fc.property(body, (b) => {
        expect(validateGstin(b + gstinCheckChar(b)).ok).toBe(true);
      }),
    );
  });

  it("explains what's wrong", () => {
    expect(validateGstin("27AAPFU0939F1Z")).toEqual({ ok: false, error: "A GSTIN has 15 characters" });
    expect(validateGstin("27AAPFU0939F0ZV")).toMatchObject({
      ok: false,
      error: expect.stringContaining("look like"),
    });
    expect(validateGstin("2AAAPFU0939F1ZV")).toMatchObject({
      ok: false,
      error: expect.stringContaining("look like"),
    });
    expect(validateGstin("40AAPFU0939F1ZV")).toEqual({ ok: false, error: "Unknown state code 40" });
    expect(validateGstin("27AAPFU0939F1ZX")).toMatchObject({
      ok: false,
      error: expect.stringContaining("typo"),
    });
    expect(() => gstinCheckChar("short")).toThrow(RangeError);
  });

  it("flags legacy state codes instead of rejecting them (VERIFY WITH CA)", () => {
    const body = "25AAPFU0939F1Z";
    expect(validateGstin(body + gstinCheckChar(body))).toMatchObject({
      ok: true,
      legacyState: true,
      state: "Daman and Diu",
    });
  });
});

describe("state codes (e-way bill master)", () => {
  it("has 01–38 and 97, with West Bengal as the supplier state", () => {
    const codes = Object.keys(STATE_CODES).sort();
    expect(codes).toHaveLength(39);
    expect(codes.slice(0, 38)).toEqual(Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, "0")));
    expect(STATE_CODES[SUPPLIER_STATE_CODE].name).toBe("West Bengal");
    expect(isStateCode("97")).toBe(true);
    expect(isStateCode("96")).toBe(false);
    expect(isStateCode("hasOwnProperty")).toBe(false);
  });

  it("pickers show only current codes", () => {
    const states = selectableStates();
    expect(states.map((s) => s.code)).not.toContain("25");
    expect(states.map((s) => s.code)).not.toContain("28");
    expect(states).toContainEqual({ code: "38", name: "Ladakh" });
    expect(states).toHaveLength(37);
    expect(states.slice(0, 2).map((s) => s.code)).toEqual(["01", "02"]);
    expect(states.at(-1)?.code).toBe("97");
  });
});
