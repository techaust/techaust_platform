// M7.4 B.4: legal hold [ADM-CLI-05] (run file docs/runs/m7.4-data-protection.md A.2, C.5).
import { describe, expect, it } from "vitest";
import {
  holdActionOf,
  holdVerdict,
  LEGAL_HOLD_ACTIONS,
  LEGAL_HOLD_ENTITY_TYPES,
  LEGAL_HOLD_REASON_MAX,
  legalHoldQuery,
  legalHoldRequest,
  warmLegalHoldSchemas,
} from "../src/legal-hold.ts";

describe("enumerations (pinned to the M7.4 triggers in A)", () => {
  it("entity types and actions", () => {
    expect(LEGAL_HOLD_ENTITY_TYPES).toEqual(["client", "contact", "lead"]);
    expect(LEGAL_HOLD_ACTIONS).toEqual(["set", "clear"]);
    expect(holdActionOf(true)).toBe("set");
    expect(holdActionOf(false)).toBe("clear");
  });
});

describe("legalHoldRequest", () => {
  const ok = {
    entityType: "contact",
    entityId: "c1",
    on: true,
    reason: "  GST notice 12/2026\r\nfrom the officer ",
  };
  it("takes a reason, trimmed, line endings folded", () => {
    const r = legalHoldRequest.safeParse(ok);
    expect(r.success).toBe(true);
    expect(r.data?.reason).toBe("GST notice 12/2026\nfrom the officer");
  });
  it("refuses no reason, a blank one, a long one, control characters, an unknown type and extra keys", () => {
    expect(legalHoldRequest.safeParse({ ...ok, reason: undefined }).success).toBe(false);
    expect(legalHoldRequest.safeParse({ ...ok, reason: "   " }).success).toBe(false);
    expect(legalHoldRequest.safeParse({ ...ok, reason: "x".repeat(LEGAL_HOLD_REASON_MAX + 1) }).success).toBe(
      false,
    );
    expect(legalHoldRequest.safeParse({ ...ok, reason: "x".repeat(LEGAL_HOLD_REASON_MAX) }).success).toBe(
      true,
    );
    expect(legalHoldRequest.safeParse({ ...ok, reason: "bad\u0007" }).success).toBe(false);
    expect(legalHoldRequest.safeParse({ ...ok, entityType: "project" }).success).toBe(false);
    expect(legalHoldRequest.safeParse({ ...ok, entityId: "" }).success).toBe(false);
    expect(legalHoldRequest.safeParse({ ...ok, on: "yes" }).success).toBe(false);
    expect(legalHoldRequest.safeParse({ ...ok, by: "x" }).success).toBe(false);
  });
  it("the history query", () => {
    expect(legalHoldQuery.safeParse({ entityType: "lead", entityId: "l1" }).success).toBe(true);
    expect(legalHoldQuery.safeParse({ entityType: "lead" }).success).toBe(false);
  });
  it("warms both schemas", () => {
    expect(warmLegalHoldSchemas()).toBe(2);
  });
});

describe("holdVerdict (C.5)", () => {
  it("set and clear", () => {
    expect(holdVerdict({ held: false, anonymised: false }, "client", true)).toEqual({
      ok: true,
      action: "set",
    });
    expect(holdVerdict({ held: true, anonymised: false }, "lead", false)).toEqual({
      ok: true,
      action: "clear",
    });
  });
  it("no record, no change, an anonymised contact", () => {
    expect(holdVerdict(null, "client", true)).toEqual({ ok: false, code: "not_found" });
    expect(holdVerdict({ held: true, anonymised: false }, "client", true)).toEqual({
      ok: false,
      code: "hold_unchanged",
    });
    expect(holdVerdict({ held: false, anonymised: false }, "contact", false)).toEqual({
      ok: false,
      code: "hold_unchanged",
    });
    expect(holdVerdict({ held: false, anonymised: true }, "contact", true)).toEqual({
      ok: false,
      code: "anonymised",
    });
  });
  it("an anonymised client can be held", () => {
    expect(holdVerdict({ held: false, anonymised: true }, "client", true)).toEqual({
      ok: true,
      action: "set",
    });
  });
});
