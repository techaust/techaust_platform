// 07-ZU's lines (AU45; ADM-CLI-04, JOB-PDF-01): the statement's "refund came back" label (U1) and its note (U2), through one gate. Approved by the main session
// under the owner's delegation, 2026-11-07, so no line carries the "[Placeholder] " mark; while the gate is off every line carries it exactly.
import { describe, expect, it } from "vitest";
import {
  APPROVED_07ZU,
  STATEMENT_REFUND_RETURNED_NOTE,
  STATEMENT_REFUND_RETURNED_WORD,
  zuAllText,
} from "../src/copy-zu.ts";

describe("07-ZU statement lines [ADM-CLI-04]", () => {
  it("are approved word for word (2026-11-07): the gate is on and no line is marked", () => {
    expect(APPROVED_07ZU).toBe(true);
    expect(STATEMENT_REFUND_RETURNED_WORD).toBe("Refund came back");
    expect(STATEMENT_REFUND_RETURNED_NOTE).toBe(
      "A refund that came back is one the bank or card network returned to us. The amount is your credit again.",
    );
    for (const line of zuAllText()) expect(line).not.toContain("[Placeholder");
  });

  it("every line carries the mark exactly while the gate is off, and none uses '&' or a timing promise", () => {
    expect(zuAllText()).toEqual([STATEMENT_REFUND_RETURNED_WORD, STATEMENT_REFUND_RETURNED_NOTE]);
    for (const line of zuAllText()) {
      expect(line.startsWith("[Placeholder] ")).toBe(!APPROVED_07ZU);
      expect(line).not.toMatch(/&|within \d|days?\b/i);
    }
  });
});
