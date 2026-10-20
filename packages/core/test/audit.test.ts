import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { auditSummary, MASKED } from "../src/audit.ts";

const value = fc.oneof(fc.integer(), fc.string({ maxLength: 4 }), fc.boolean(), fc.constant(null));

describe("auditSummary [ADM-G-06, ADM-AUD-01]", () => {
  it("lists only the fields that changed", () => {
    expect(auditSummary({ role: "staff", name: "A" }, { role: "sales", name: "A" })).toEqual({
      role: { before: "staff", after: "sales" },
    });
  });

  it("is empty when nothing changed", () => {
    expect(auditSummary({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } })).toEqual({});
    expect(auditSummary(null, null)).toEqual({});
    expect(auditSummary(undefined, {})).toEqual({});
  });

  it("masks sensitive fields on both sides, and still reports that they changed", () => {
    const s = auditSummary({ pw_hmac: "old-secret", name: "A" }, { pw_hmac: "new-secret", name: "B" }, [
      "pw_hmac",
    ]);
    expect(s).toEqual({
      name: { before: "A", after: "B" },
      pw_hmac: { before: MASKED, after: MASKED },
    });
    expect(JSON.stringify(s)).not.toContain("secret");
  });

  it("does not report a sensitive field that did not change, and never leaks an unchanged one", () => {
    expect(auditSummary({ totp: "x" }, { totp: "x" }, ["totp"])).toEqual({});
  });

  it("a create lists every field of after; a delete every field of before", () => {
    expect(auditSummary(null, { email: "a@b.co", token: "t" }, ["token"])).toEqual({
      email: { before: undefined, after: "a@b.co" },
      token: { before: undefined, after: MASKED },
    });
    expect(auditSummary({ email: "a@b.co", token: "t" }, undefined, ["token"])).toEqual({
      email: { before: "a@b.co", after: undefined },
      token: { before: MASKED, after: undefined },
    });
  });

  it("compares objects and arrays by content, and a key added with an undefined value still counts", () => {
    expect(auditSummary({ a: { x: 1 } }, { a: { x: 1 } })).toEqual({});
    expect(auditSummary({ a: { x: 1 } }, { a: { x: 2 } })).toEqual({
      a: { before: { x: 1 }, after: { x: 2 } },
    });
    expect(auditSummary({ a: [1] }, { a: { 0: 1 } })).toHaveProperty("a");
    expect(auditSummary({ a: [1, 2] }, { a: [1] })).toHaveProperty("a");
    expect(auditSummary({ a: { x: 1 } }, { a: { y: 1 } })).toHaveProperty("a");
    expect(auditSummary({ a: null }, { a: {} })).toHaveProperty("a");
    expect(auditSummary({}, { a: undefined })).toHaveProperty("a");
  });

  it("orders keys so the stored JSON is stable", () => {
    const keys = Object.keys(auditSummary({}, { z: 1, a: 1, m: 1 }));
    expect(keys).toEqual(["a", "m", "z"]);
  });

  it("property: a masked key never exposes its values, and unchanged keys never appear", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 4 }), value, { maxKeys: 6 }),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 4 }), value, { maxKeys: 6 }),
        (before, after) => {
          const sensitive = Object.keys(before).slice(0, 2);
          const summary = auditSummary(before, after, sensitive);
          for (const [key, change] of Object.entries(summary)) {
            if (sensitive.includes(key)) {
              expect([MASKED, undefined]).toContain(change.before);
              expect([MASKED, undefined]).toContain(change.after);
            }
          }
          for (const key of Object.keys(before)) {
            if (key in after && JSON.stringify(before[key]) === JSON.stringify(after[key]))
              expect(summary).not.toHaveProperty(key);
          }
        },
      ),
    );
  });
});
