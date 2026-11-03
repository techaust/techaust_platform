// B4 (L44, L46; run file item 1): when "Try again" and Cancel open, from the refund view's `requestedAt` and `lastAttemptAt`, counted as the finance Worker's
// `refundIdleAt` counts (apps/admin/worker/refund-flow.ts): REFUND_SWEEP_IDLE_MS after the later of the two, one constant from `@techaust/core/gateway-rpc`.
import { REFUND_SWEEP_IDLE_MS } from "@techaust/core/gateway-rpc";
import { describe, expect, it } from "vitest";
import { refundIdleAt } from "../../worker/refund-flow.ts";
import { refundOpensAt } from "./refunds-api.ts";

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

  it("agrees with the server's refundIdleAt on every case", () => {
    for (const [requestedAt, lastAttemptAt] of [
      [5, null],
      [5, 4],
      [5, 6],
      [1_762_000_000_000, 1_762_000_900_000],
    ] as const) {
      expect(refundOpensAt({ requestedAt, lastAttemptAt })).toBe(
        refundIdleAt({ requested_at: requestedAt, last_attempt_at: lastAttemptAt }),
      );
    }
  });
});
