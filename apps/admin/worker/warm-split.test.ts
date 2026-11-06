// The schema warm-ups of the invoices and finance Workers (the fourth admin Worker, 2026-11-03, ADM-G-02; brief A.7): warm-finance.ts was split by the rule
// (invoices: the invoice, note, approval decision and settings samples; finance: the payment bodies, the gateway steps and the settings samples), and each
// keeps returning a count pinned here, so a warm-up that silently stopped working, or a sample moved between them, is noticed.
import { describe, expect, it } from "vitest";
import { GATEWAY_WARM_STEPS } from "./gateway/warm.ts";
import { warmDeliveryReports } from "./report-delivery.ts";
import { warmRevenueReports } from "./report-revenue.ts";
import { financeWarm } from "./warm-finance.ts";
import { invoicesWarm } from "./warm-invoices.ts";

describe("the invoices and finance schema warm-ups [brief A.7]", () => {
  it("the invoices Worker: the settings (8), the invoices and notes (19), the approval decision (1) and the M7.3 reports (7)", () => {
    expect(invoicesWarm).toBe(8 + 19 + 1 + 7);
    expect(warmRevenueReports()).toBe(7);
  });

  it("the API Worker's M7.3 reports: the pipeline and care plan hours samples (6)", () => {
    expect(warmDeliveryReports()).toBe(6);
  });

  it("the finance Worker: the settings (8), the payment bodies (9) and the gateway steps", () => {
    expect(financeWarm).toBe(8 + 9 + GATEWAY_WARM_STEPS + 12);
  });
});
