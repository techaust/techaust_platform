// Every route group the finance Worker answers (M6.1 stage A, ADM-PAY-01): the ROUTES rows marked `on: "finance"`. Since the fourth admin Worker (2026-11-03,
// ADM-G-02) it is the payments side: payment links, "Needs review" and the gateways' status, remittance advices, manual payments and TDS, a client's credit, an
// invoice's Payments panel, credit moves and FEMA extensions. The invoice, note, statement, report, approval and dashboard routes moved to routes-invoices.ts
// (the invoices Worker). No sign-in code; the gateway keys are this Worker's only secrets.

import { advices } from "./advices.ts";
import type { App } from "./app.ts";
import { gatewayPayments, invoicePaymentLinks } from "./gateway/routes.ts";
import { clientCredit, invoiceLedger } from "./payment-ledger.ts";
import { payments } from "./payments.ts";
import { reconciliation } from "./recon.ts";
import { reductions } from "./reductions.ts";
import { refunds, refundsTab } from "./refunds.ts";
import "./warm-finance.ts"; // start-up warm-up of the settings, payment and gateway schemas

export function mountFinance(app: App) {
  // M6.2: payment links, "Needs review" and the gateways' status (before `payments`, whose `/:id` would match `/review` and `/gateways`).
  app.route("/v1/invoices", invoicePaymentLinks);
  app.route("/v1/payments", gatewayPayments);
  // M6.4 (ADM-INV-17, L12): remittance advices and the "Without advice" list, also before `payments` (its `/:id`).
  app.route("/v1/payments", advices);
  // M6.5: a payment's refunds (before `payments`, whose `/:id` would not match `/:id/refunds` but keeps the order plain), the Refunds tab, reconciliation and
  // FEMA reductions.
  app.route("/v1/payments", refunds);
  app.route("/v1/refunds", refundsTab);
  app.route("/v1/reconciliation", reconciliation);
  app.route("/v1/invoices", reductions);
  // M6.1: manual payments and TDS, a client's credit, an invoice's Payments panel, credit moves and FEMA extensions.
  app.route("/v1/payments", payments);
  app.route("/v1/clients", clientCredit);
  app.route("/v1/invoices", invoiceLedger);
}
