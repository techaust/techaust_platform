// The schema warm-ups of the invoices and finance Workers (the fourth admin Worker, 2026-11-03, ADM-G-02; brief A.7): warm-finance.ts was split by the rule
// (invoices: the invoice, note, approval decision and settings samples; finance: the payment bodies, the gateway steps and the settings samples), and each
// keeps returning a count pinned here, so a warm-up that silently stopped working, or a sample moved between them, is noticed.
import { describe, expect, it } from "vitest";
import { GATEWAY_WARM_STEPS } from "./gateway/warm.ts";
import { financeWarm } from "./warm-finance.ts";
import { invoicesWarm } from "./warm-invoices.ts";

describe("the invoices and finance schema warm-ups [brief A.7]", () => {
  it("the invoices Worker: the settings (8), the invoices and notes (19) and the approval decision (1)", () => {
    expect(invoicesWarm).toBe(8 + 19 + 1);
  });

  it("the finance Worker: the settings (8), the payment bodies (9) and the gateway steps", () => {
    expect(financeWarm).toBe(8 + 9 + GATEWAY_WARM_STEPS);
  });
});
