// B4 (L44, L46; run file item 1): when "Try again" and Cancel open, from the refund view's `requestedAt` and `lastAttemptAt`, counted as the finance Worker's
// `refundIdleAt` counts (apps/admin/worker/refund-flow.ts): REFUND_SWEEP_IDLE_MS after the later of the two, one constant from `@techaust/core/gateway-rpc`.
// The table of the last case is the one `worker/refunds.test.ts` holds `refundIdleAt` to (the SPA's tsconfig can't compile Worker code, so each side is pinned
// to the same values).
import { REFUND_SWEEP_IDLE_MS } from "@techaust/core/gateway-rpc";
import { describe, expect, it } from "vitest";
import { defaultRefundMode, periodsFrom, refundOpensAt } from "./refunds-api.ts";

describe("periodsFrom [RA-41; review part 1, finding 3]", () => {
  it("the period and the ones before it, newest first, by the filing frequency", () => {
    expect(periodsFrom("2026-Q3", "quarterly", 4)).toEqual(["2026-Q3", "2026-Q2", "2026-Q1", "2025-Q4"]);
    expect(periodsFrom("2026-02", "monthly", 3)).toEqual(["2026-02", "2026-01", "2025-12"]);
    expect(periodsFrom("nonsense", "monthly")).toEqual(["nonsense"]);
  });
});

describe("refundOpensAt [ADM-PAY-08; L44, L46]", () => {
  it("never tried: the request plus the idle time", () => {
    expect(refundOpensAt({ requestedAt: 1_000_000, lastAttemptAt: null })).toBe(
      1_000_000 + REFUND_SWEEP_IDLE_MS,
    );
  });

  it("checked since: the last check plus the idle time", () => {
    expect(refundOpensAt({ requestedAt: 1_000_000, lastAttemptAt: 1_600_000 })).toBe(
      1_600_000 + REFUND_SWEEP_IDLE_MS,
    );
  });

  it("a check stamped before the request (clock skew) never opens it early", () => {
    expect(refundOpensAt({ requestedAt: 2_000_000, lastAttemptAt: 1_500_000 })).toBe(
      2_000_000 + REFUND_SWEEP_IDLE_MS,
    );
  });

  it("the shared table (the server's refundIdleAt gives the same, worker/refunds.test.ts)", () => {
    for (const [requestedAt, lastAttemptAt, opens] of [
      [5, null, 5 + 900_000],
      [5, 4, 5 + 900_000],
      [5, 6, 6 + 900_000],
      [1_762_000_000_000, 1_762_000_900_000, 1_762_001_800_000],
    ] as const) {
      expect(REFUND_SWEEP_IDLE_MS).toBe(900_000);
      expect(refundOpensAt({ requestedAt, lastAttemptAt })).toBe(opens);
    }
  });
});

describe("defaultRefundMode [second review, L6]", () => {
  it("SWIFT for US dollars to a client outside India; NEFT otherwise", () => {
    expect(defaultRefundMode("USD", true)).toBe("swift");
    expect(defaultRefundMode("USD", false)).toBe("neft");
    expect(defaultRefundMode("INR", true)).toBe("neft");
    expect(defaultRefundMode("INR", false)).toBe("neft");
  });
});
