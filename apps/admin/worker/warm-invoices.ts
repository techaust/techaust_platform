// Start-up warm-up of the admin invoices Worker (the fourth admin Worker, 2026-11-03, ADM-G-02; split from warm-finance.ts, same idea as warm-api.ts): run from
// the module's top level, so the first-use costs are paid while the isolate starts, not inside the first request the Free plan's 10 ms CPU limit applies to:
//  - the settings schemas (the invoice paths read the settings through them), each parsed once on its defaults;
//  - the invoice and note request schemas and one credit note worked out (invoice-warm.ts, M5.1 to M5.3);
//  - the approval decision body (it moved to the finance Worker with the approvals routes in M6.1, and here with them now).
// Pure of `env`, nothing stored or logged.
import { warmSettings } from "@techaust/core/settings";
import { decideBody } from "./approvals.ts";
import { warmInvoices } from "./invoice-warm.ts";

/** The approval decision body parsed once on a made-up sample: 1 when it parsed. Never throws. */
export function warmApprovals(): number {
  try {
    return decideBody.safeParse({ decision: "approve", note: "n" }).success ? 1 : 0;
  } catch {
    return 0; // never stop a Worker from starting
  }
}

/** The number of samples that parsed (warm-split.test.ts pins it): the settings (8), the invoices and notes (19) and the approval decision (1). */
export const invoicesWarm: number = warmSettings() + warmInvoices() + warmApprovals();
