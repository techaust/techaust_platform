import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { stableId, UUID, uuidv7, uuidv7Time } from "../src/ids.ts";

describe("uuidv7", () => {
  it("has the RFC 9562 layout: version 7, variant 10, the timestamp first", () => {
    const id = uuidv7(Date.parse("2026-10-06T08:35:00Z"), new Uint8Array(10));
    expect(id).toBe("01a1105a-0f20-7000-8000-000000000000");
    expect(id).toMatch(UUID);
    expect(uuidv7Time(id)).toBe(Date.parse("2026-10-06T08:35:00Z"));
    expect(uuidv7()).toMatch(UUID);
  });

  it("property: IDs sort in time order and encode their time", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 48 - 2 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.uint8Array({ minLength: 10, maxLength: 10 }),
        fc.uint8Array({ minLength: 10, maxLength: 10 }),
        (t, dt, r1, r2) => {
          const a = uuidv7(t, r1);
          const b = uuidv7(Math.min(t + dt, 2 ** 48 - 1), r2);
          expect(a < b).toBe(true);
          expect(uuidv7Time(a)).toBe(t);
        },
      ),
    );
  });

  it("rejects bad input", () => {
    expect(() => uuidv7(-1)).toThrow(RangeError);
    expect(() => uuidv7(2 ** 48)).toThrow(RangeError);
    expect(() => uuidv7(1.5)).toThrow(RangeError);
    expect(() => uuidv7(0, new Uint8Array(9))).toThrow(RangeError);
    expect(() => uuidv7Time(stableId("x"))).toThrow(RangeError);
    expect(() => uuidv7Time("nope")).toThrow(RangeError);
  });
});

describe("stableId", () => {
  it("is deterministic, a valid version-8 UUID, and differs per key", () => {
    expect(stableId("catalogue:S1")).toBe(stableId("catalogue:S1"));
    expect(stableId("catalogue:S1")).not.toBe(stableId("catalogue:S2"));
    expect(stableId("catalogue:S1")).toMatch(UUID);
    expect(stableId("")[14]).toBe("8");
  });

  it("property: no collisions across many keys", () => {
    const ids = new Set(Array.from({ length: 10_000 }, (_, i) => stableId(`k${i}`)));
    expect(ids.size).toBe(10_000);
  });
});
