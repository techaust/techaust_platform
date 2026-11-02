// Start-up warm-up of the admin finance Worker (M6.1 stage A, ADM-PAY-01; same idea as warm-api.ts): run from the module's top level, so the first-use costs
// are paid while the isolate starts, not inside the first request the Free plan's 10 ms CPU limit applies to. Since the fourth admin Worker (2026-11-03,
// ADM-G-02) the finance Worker is the payments side; the invoice, note and approval samples moved to warm-invoices.ts with their routes:
//  - the settings schemas, each parsed once on its defaults (the ledger and gateway paths read settings too: payment terms, the gateways' modes);
//  - the payment request bodies (`warmPayments`, nine samples, M6.1);
//  - the gateway code (`warmGateway`, M6.2 CPU diagnosis lead decision 3).
// Pure of `env`, nothing stored or logged.
import { warmPayments } from "@techaust/core/payment-schemas";
import { warmSettings } from "@techaust/core/settings";
import { warmGateway } from "./gateway/warm.ts";

/** The number of samples that ran (warm-split.test.ts pins it): the settings (8), the payment bodies (9) and the gateway steps (GATEWAY_WARM_STEPS). */
export const financeWarm: number = warmSettings() + warmPayments() + warmGateway();
