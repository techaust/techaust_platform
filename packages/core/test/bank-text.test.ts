// The shared bank-detail shapes and the LIKE escape [ADM-SET-02, ADM-G-05]; ROLE_LABELS for people-facing text.
import { describe, expect, it } from "vitest";
import { ACCOUNT_NO, cleanAccountNo, IFSC, SWIFT } from "../src/bank.ts";
import { ROLE_LABELS, ROLES } from "../src/permissions.ts";
import { escapeLike } from "../src/text.ts";

describe("bank shapes", () => {
  it("accepts and refuses the published shapes", () => {
    expect(ACCOUNT_NO.test("55501234567")).toBe(true);
    expect(ACCOUNT_NO.test("1234")).toBe(false);
    expect(ACCOUNT_NO.test("12 34 56")).toBe(false);
    expect(IFSC.test("HDFC0001234")).toBe(true);
    expect(IFSC.test("HDFC1001234")).toBe(false);
    expect(SWIFT.test("SMPLINBB")).toBe(true);
    expect(SWIFT.test("SMPLINBBXXX")).toBe(true);
    expect(SWIFT.test("SMPLINB")).toBe(false);
  });

  it("cleans spaces and hyphens and upper-cases", () => {
    expect(cleanAccountNo(" ab-12 34 ")).toBe("AB1234");
    expect(cleanAccountNo("")).toBe("");
  });
});

describe("escapeLike", () => {
  it("turns wildcard characters into plain ones", () => {
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
    expect(escapeLike("plain")).toBe("plain");
  });
});

describe("ROLE_LABELS", () => {
  it("has a label for every role, never the code", () => {
    for (const r of ROLES) expect(ROLE_LABELS[r]).not.toBe(r);
    expect(ROLE_LABELS.accountant).toBe("Accountant");
  });
});
