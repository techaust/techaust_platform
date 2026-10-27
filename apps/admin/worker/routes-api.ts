// Every route group the API Worker answers (M5.0): all rows of ROUTES not marked `on: "front"`. No sign-in code and no secrets.
import type { App } from "./app.ts";
import { approvalRequests, approvals } from "./approvals.ts";
import { audit } from "./audit.ts";
import { carePlans } from "./care.ts";
import { catalogue, templates } from "./catalogue.ts";
import { clientTabs } from "./client-tabs.ts";
import { clients, contacts } from "./clients.ts";
import { dashboard } from "./dashboard.ts";
import { documentConvert } from "./document-convert.ts";
import { documentLinks } from "./document-links.ts";
import { documentPdf, invoicePdf } from "./document-pdf.ts";
import { documentSave } from "./document-save.ts";
import { documentSend } from "./document-send.ts";
import { documentStart } from "./document-start.ts";
import { documents } from "./documents.ts";
import { files } from "./files.ts";
import { invoiceAdvance } from "./invoice-advance.ts";
import { invoiceIssue } from "./invoice-issue.ts";
import { invoiceNotes } from "./invoice-notes.ts";
import { invoiceSend } from "./invoice-send.ts";
import { invoices } from "./invoices.ts";
import { leads } from "./leads.ts";
import { notes } from "./notes.ts";
import { notifications } from "./notifications.ts";
import { milestones, projects } from "./projects.ts";
import { reports } from "./reports.ts";
import { search } from "./search.ts";
import { settings } from "./settings.ts";
import { settingsSignature } from "./settings-signature.ts";
import { statementPdf } from "./statement-pdf.ts";
import { statements } from "./statements.ts";
import { timeLogs } from "./time-logs.ts";
import "./warm-api.ts"; // start-up warm-up of the settings, catalogue, care, document and time schemas

export function mountApi(app: App) {
  app.route("/v1/settings", settings);
  app.route("/v1/settings", settingsSignature);
  app.route("/v1/leads", leads);
  app.route("/v1/catalogue", catalogue);
  app.route("/v1/templates", templates);
  app.route("/v1/clients", clients);
  app.route("/v1/clients", clientTabs);
  // M5.5b: a client's statement and its PDF, and the reports (self-contained modules, LD85)
  app.route("/v1/clients", statements);
  app.route("/v1/clients", statementPdf);
  app.route("/v1/reports", reports);
  // Proposals and estimates (M4.3): one router per concern, all under /documents. Static paths come before `/:id` where they exist.
  app.route("/v1/documents", documents);
  app.route("/v1/documents", documentSave);
  app.route("/v1/documents", approvalRequests);
  app.route("/v1/documents", documentSend);
  app.route("/v1/documents", documentConvert);
  app.route("/v1/documents", documentPdf);
  app.route("/v1/documents", documentLinks);
  app.route("/v1/documents", documentStart);
  // Invoices (M5.1): one router per concern under /invoices.
  app.route("/v1/invoices", invoices);
  app.route("/v1/invoices", invoiceIssue);
  app.route("/v1/invoices", invoiceAdvance);
  app.route("/v1/invoices", invoiceNotes);
  app.route("/v1/invoices", invoiceSend);
  app.route("/v1/invoices", invoicePdf);
  app.route("/v1/approvals", approvals);
  app.route("/v1/projects", projects);
  app.route("/v1/milestones", milestones);
  app.route("/v1/care-plans", carePlans);
  app.route("/v1/time", timeLogs);
  app.route("/v1/dashboard", dashboard);
  app.route("/v1/notes", notes);
  app.route("/v1/files", files);
  app.route("/v1/contacts", contacts);
  app.route("/v1/notifications", notifications);
  app.route("/v1/search", search);
  app.route("/v1/audit", audit);
}
