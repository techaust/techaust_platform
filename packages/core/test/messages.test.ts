import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { stripCrLf } from "../src/header.ts";
import { generateLeadRef, LEAD_REF } from "../src/lead-ref.ts";
import { emailMessage, formMeta, leadMessage } from "../src/schemas/messages.ts";

const base = {
  ref: "L-7K3Q9",
  ipHash: "a".repeat(64),
  formVersion: "contact-1",
  noticeVersion: "0.1",
  utm: {},
  submittedAt: 1_760_000_000_000,
};
const contact = { name: "Asha", email: "asha@example.com", message: "We need invoices in Tally, please." };

describe("lead reference [FRM-06]", () => {
  it("has the L- + 5 Crockford characters format, without I, L, O, U", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 5, maxLength: 5 }), (bytes) => {
        const ref = generateLeadRef(bytes);
        expect(ref).toMatch(LEAD_REF);
        expect(ref.slice(2)).not.toMatch(/[ILOU]/);
      }),
    );
  });

  it("is random and does not collide in a large sample", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5_000; i++) seen.add(generateLeadRef());
    // 33.5 million possible values: 5,000 draws expect about 0.4 clashes (that is why the consumer handles a clash);
    // five or more would mean the generator is not random.
    expect(seen.size).toBeGreaterThan(4_995);
  });

  it("refuses too few random bytes and rejects other shapes", () => {
    expect(() => generateLeadRef(new Uint8Array(2))).toThrow(RangeError);
    for (const bad of ["L-7K3QI", "l-7K3Q9", "L-7K3Q", "L-7K3Q99", "X-7K3Q9", ""])
      expect(LEAD_REF.test(bad)).toBe(false);
  });
});

describe("header values [FRM-03]", () => {
  it("removes CR, LF and other control characters", () => {
    expect(stripCrLf("Asha\r\nBcc: evil@example.com")).toBe("Asha Bcc: evil@example.com");
    expect(stripCrLf("a\u0000b c")).toBe("a b c");
    fc.assert(
      fc.property(fc.string(), (s) => [...stripCrLf(s)].every((ch) => (ch.codePointAt(0) as number) > 0x1f)),
    );
  });
});

describe("queue messages", () => {
  it("accepts a contact message and a quote message", () => {
    expect(leadMessage.safeParse({ kind: "contact", payload: contact, ...base }).success).toBe(true);
    const quote = {
      service: "S5",
      goals: "Replace the spreadsheet we use today.",
      tools: ["tally"],
      currency: "INR",
      budget: "1l-3l",
      timeline: "asap",
      name: "Asha",
      email: "asha@example.com",
      country: "in",
    };
    const r = leadMessage.safeParse({ kind: "quote", payload: quote, ...base, formVersion: "quote-1" });
    expect(r.success).toBe(true);
  });

  it("rejects a bad ref, a raw-looking ip hash, a missing kind and an invalid payload", () => {
    const ok = { kind: "contact", payload: contact, ...base };
    expect(leadMessage.safeParse({ ...ok, ref: "nope" }).success).toBe(false);
    expect(leadMessage.safeParse({ ...ok, ipHash: "203.0.113.9" }).success).toBe(false);
    expect(leadMessage.safeParse({ ...base, payload: contact }).success).toBe(false);
    expect(leadMessage.safeParse({ ...ok, payload: { ...contact, message: "short" } }).success).toBe(false);
  });

  it("validates email messages", () => {
    const ok = {
      template: "lead.alert",
      to: "owner@example.com",
      data: { ref: "L-7K3Q9" },
      entity: { type: "lead", id: "x" },
    };
    expect(emailMessage.safeParse(ok).success).toBe(true);
    expect(emailMessage.safeParse({ ...ok, template: "other" }).success).toBe(false);
    expect(emailMessage.safeParse({ ...ok, to: "not an address" }).success).toBe(false);
    expect(emailMessage.safeParse({ ...ok, data: { n: 5 } }).success).toBe(false);
  });
});

describe("form meta [FRM-05, FRM-06]", () => {
  it("carries type and plan as lower-case slugs, drops empty ones and rejects the rest", () => {
    const ok = formMeta.parse({ noticeVersion: "0.1", type: "pilot", plan: "care-plus" });
    expect(ok).toMatchObject({ type: "pilot", plan: "care-plus" });
    expect(formMeta.parse({ noticeVersion: "0.1", type: "", plan: "" })).toMatchObject({ type: undefined });
    for (const bad of ["Pilot", "a b", "x".repeat(31), "a\r\nb"])
      expect(formMeta.safeParse({ noticeVersion: "0.1", plan: bad }).success).toBe(false);
  });

  it("treats empty fields as missing and requires the notice version", () => {
    const r = formMeta.parse({
      noticeVersion: "0.1",
      sourcePage: "",
      referrerHost: "",
      currency: "",
      utm: {},
    });
    expect(r.sourcePage).toBeUndefined();
    expect(formMeta.safeParse({}).success).toBe(false);
  });

  it("rejects odd paths, hosts and control characters in UTM values", () => {
    expect(formMeta.safeParse({ noticeVersion: "0.1", sourcePage: "javascript:x" }).success).toBe(false);
    expect(formMeta.safeParse({ noticeVersion: "0.1", referrerHost: "a b" }).success).toBe(false);
    expect(formMeta.safeParse({ noticeVersion: "0.1", utm: { source: "a\r\nb" } }).success).toBe(false);
    expect(formMeta.safeParse({ noticeVersion: "0.1", utm: { source: "newsletter" } }).success).toBe(true);
  });
});
