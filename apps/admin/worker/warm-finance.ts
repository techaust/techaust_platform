// Start-up warm-up of the admin finance Worker (M6.1 stage A, ADM-PAY-01; same idea as warm-api.ts): run from the module's top level, so the first-use costs
// are paid while the isolate starts, not inside the first request the Free plan's 10 ms CPU limit applies to. Since the fourth admin Worker (2026-11-03,
// ADM-G-02) the finance Worker is the payments side; the invoice, note and approval samples moved to warm-invoices.ts with their routes:
//  - the settings schemas, each parsed once on its defaults (the ledger and gateway paths read settings too: payment terms, the gateways' modes);
//  - the payment request bodies (`warmPayments`, nine samples, M6.1);
//  - the gateway code (`warmGateway`, M6.2 CPU diagnosis lead decision 3).
// Pure of `env`, nothing stored or logged.
import { warmPayments, warmRefundBodies } from "@techaust/core/payment-schemas";
import { warmRecon } from "@techaust/core/recon";
import { warmRefundReaders } from "@techaust/core/refund-gateways";
import { planRefund } from "@techaust/core/refunds";
import { warmSettings } from "@techaust/core/settings";
import { warmGateway } from "./gateway/warm.ts";

/**
 * M6.5 (run file J `warmRefunds`): the refund, bank match, recon fetch and reduction bodies (5), `planRefund` on made-up figures (1), the three gateways' refund
 * readers and two refund events (5), and one made-up recon page (1). Never throws; 12 when everything ran.
 */
export function warmRefunds(): number {
  try {
    const plan = planRefund({
      payment: {
        id: "warm",
        clientId: "warm",
        currency: "INR",
        kind: "payment",
        status: "confirmed",
        provider: "manual",
        amountMinor: 2_000,
        netAllocatedMinor: 1_000,
        refundedMinor: 0,
        receivedOn: "2026-11-01",
        hasOpenRefund: false,
      },
      from: "credit",
      via: "manual",
      amountMinor: 1_000,
      paidTo: "original",
      today: "2026-11-03",
    });
    return warmRefundBodies() + (plan.ok ? 1 : 0) + warmRefundReaders() + warmRecon();
  } catch {
    return 0;
  }
}

/**
 * The number of samples that ran (warm-split.test.ts pins it): the settings (8), the payment bodies (9), the gateway steps (GATEWAY_WARM_STEPS) and M6.5's
 * refund samples (12).
 */
export const financeWarm: number = warmSettings() + warmPayments() + warmGateway() + warmRefunds();
