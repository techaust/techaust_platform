// Every route group the finance Worker answers (M6.1 stage A, ADM-PAY-01): the ROUTES rows marked `on: "finance"`. Invoices, credit and
// debit notes, their sends and PDFs, a client's invoices and statement, the reports, the approval queue and decision, and the dashboard.
// No sign-in code and no secrets.
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
import { clientCredit, invoiceLedger } from "./payment-ledger.ts";
import { payments } from "./payments.ts";
import { reports } from "./reports.ts";
import { statementPdf } from "./statement-pdf.ts";
import { statements } from "./statements.ts";
import "./warm-finance.ts"; // start-up warm-up of the settings, invoice and approval decision schemas

export function mountFinance(app: App) {
  // A client's invoices (M5.1) and statement with its PDF (M5.5b), under /clients like the other client tabs.
  app.route("/v1/clients", clientInvoices);
  app.route("/v1/clients", statements);
  app.route("/v1/clients", statementPdf);
  app.route("/v1/reports", reports);
  // Invoices (M5.1): one router per concern under /invoices.
  app.route("/v1/invoices", invoices);
  app.route("/v1/invoices", invoiceIssue);
  app.route("/v1/invoices", invoiceAdvance);
  app.route("/v1/invoices", invoiceWithdraw);
  app.route("/v1/invoices", invoiceNotes);
  app.route("/v1/invoices", invoiceSend);
  app.route("/v1/invoices", invoicePdf);
  app.route("/v1/invoices", invoiceSupplierPdf);
  app.route("/v1/approvals", approvals);
  app.route("/v1/dashboard", dashboard);
  // M6.1: manual payments and TDS, a client's credit, an invoice's Payments panel, credit moves and FEMA extensions.
  app.route("/v1/payments", payments);
  app.route("/v1/clients", clientCredit);
  app.route("/v1/invoices", invoiceLedger);
}
