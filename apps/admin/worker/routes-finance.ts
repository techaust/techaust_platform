// Every route group the finance Worker answers (M6.1 stage A, ADM-PAY-01): the ROUTES rows marked `on: "finance"`. Since the fourth admin Worker (2026-11-03,
// ADM-G-02) it is the payments side: payment links, "Needs review" and the gateways' status, remittance advices, manual payments and TDS, a client's credit, an
// invoice's Payments panel, credit moves and FEMA extensions. The invoice, note, statement, report, approval and dashboard routes moved to routes-invoices.ts
// (the invoices Worker). No sign-in code; the gateway keys are this Worker's only secrets.

import { advices } from "./advices.ts";
import type { App } from "./app.ts";
import { creditHeld } from "./credit-held.ts";
import { gatewayPayments, invoicePaymentLinks } from "./gateway/routes.ts";
import { clientCredit, invoiceLedger } from "./payment-ledger.ts";
import { paymentNotices } from "./payment-notices.ts";
import { payments } from "./payments.ts";
import { paymentReceipt } from "./receipt-read.ts";
import { reconciliation } from "./recon.ts";
import { reductions } from "./reductions.ts";
import { refunds, refundsTab } from "./refunds.ts";
import "./warm-finance.ts"; // start-up warm-up of the settings, payment and gateway schemas
import { receiptSend } from "./receipt-send.ts";

export function mountFinance(app: App) {
  // M6.2: payment links, "Needs review" and the gateways' status (before `payments`, whose `/:id` would match `/review` and `/gateways`).
  app.route("/v1/invoices", invoicePaymentLinks);
  app.route("/v1/payments", gatewayPayments);
  // M6.4 (ADM-INV-17, L12): remittance advices and the "Without advice" list, also before `payments` (its `/:id`).
  app.route("/v1/payments", advices);
  // M6.5: a payment's refunds (before `payments`, whose `/:id` would not match `/:id/refunds` but keeps the order plain), the Refunds tab, reconciliation and
  // FEMA reductions.
  app.route("/v1/payments", refunds);
  app.route("/v1/payments", paymentReceipt);
  // M7.2 (C.2): "Send receipt again".
  app.route("/v1/receipts", receiptSend);
  // Review part 1, finding 3 (RA-41): credit held at a return period's end (before `payments`, whose `/:id` would match `/credit-held`).
  app.route("/v1/payments", creditHeld);
  // M7.1 (ADM-PAY-05, L10): the clients' "I've paid" notices, before `payments` (its `/:id` would match `/notices`).
  app.route("/v1/payments", paymentNotices);
  app.route("/v1/refunds", refundsTab);
  app.route("/v1/reconciliation", reconciliation);
  app.route("/v1/invoices", reductions);
  // M6.1: manual payments and TDS, a client's credit, an invoice's Payments panel, credit moves and FEMA extensions.
  app.route("/v1/payments", payments);
  app.route("/v1/clients", clientCredit);
  app.route("/v1/invoices", invoiceLedger);
}
