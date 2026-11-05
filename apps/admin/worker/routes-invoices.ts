// Every route group the admin invoices Worker answers (the fourth admin Worker, 2026-11-03, ADM-G-02; moved from routes-finance.ts in today's order): the
// ROUTES rows marked `on: "invoices"`. Invoices, credit and debit notes, their sends and PDFs, a client's invoices and statement, the reports, the approval
// queue and decision, and the dashboard. No sign-in code, no secrets and no gateway code (the GATEWAY_CODE budget marker).

import type { App } from "./app.ts";
import { approvals } from "./approvals.ts";
import { clientInvoices } from "./client-invoices.ts";
import { dashboard } from "./dashboard.ts";
import { invoicePdf, invoiceSupplierPdf } from "./document-pdf.ts";
import { invoiceAdvance } from "./invoice-advance.ts";
import { invoiceIssue } from "./invoice-issue.ts";
import { invoiceNotes } from "./invoice-notes.ts";
import { invoiceSend } from "./invoice-send.ts";
import { invoiceWithdraw } from "./invoice-withdraw.ts";
import { invoices } from "./invoices.ts";
import { receiptPdf } from "./receipt-issue.ts";
import { revenueReports } from "./report-revenue.ts";
import { reports } from "./reports.ts";
import { statementPdf } from "./statement-pdf.ts";
import { statements } from "./statements.ts";
import "./warm-invoices.ts"; // start-up warm-up of the settings, invoice and approval decision schemas

export function mountInvoices(app: App) {
  // A client's invoices (M5.1) and statement with its PDF (M5.5b), under /clients like the other client tabs.
  app.route("/v1/clients", clientInvoices);
  app.route("/v1/clients", statements);
  app.route("/v1/clients", statementPdf);
  app.route("/v1/reports", reports);
  // M7.3 (C1, C2, C9): revenue and collections, outstanding and ageing.
  app.route("/v1/reports", revenueReports);
  // Invoices (M5.1): one router per concern under /invoices.
  app.route("/v1/invoices", invoices);
  app.route("/v1/invoices", invoiceIssue);
  app.route("/v1/invoices", invoiceAdvance);
  app.route("/v1/invoices", invoiceWithdraw);
  app.route("/v1/invoices", invoiceNotes);
  app.route("/v1/invoices", invoiceSend);
  app.route("/v1/invoices", invoicePdf);
  app.route("/v1/invoices", invoiceSupplierPdf);
  // M6.5 (L34): the receipt PDF (an invoice-family document).
  app.route("/v1/receipts", receiptPdf);
  app.route("/v1/approvals", approvals);
  app.route("/v1/dashboard", dashboard);
}
