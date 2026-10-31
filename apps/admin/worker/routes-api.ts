// Every route group the API Worker answers (M5.0): the rows of ROUTES not marked `on: "front"` or `on: "finance"`. No sign-in code and no
// secrets. Since M6.1 stage A (ADM-PAY-01) the invoice, statement, report, approval-queue and dashboard routes are in the finance Worker
// (routes-finance.ts); no module here may import the invoice chain (scripts/worker-budget.mjs `INVOICE_CODE`).
import type { App } from "./app.ts";
import { approvalRequests } from "./approval-requests.ts";
import { audit } from "./audit.ts";
import { carePlans } from "./care.ts";
import { catalogue, templates } from "./catalogue.ts";
import { clientTabs } from "./client-tabs.ts";
import { clients, contacts } from "./clients.ts";
import { documentConvert } from "./document-convert.ts";
import { documentFill } from "./document-fill.ts";
import { documentLinks } from "./document-links.ts";
import { documentPdf } from "./document-pdf.ts";
import { documentSave } from "./document-save.ts";
import { documentSend } from "./document-send.ts";
import { documentStart } from "./document-start.ts";
import { documents } from "./documents.ts";
import { files } from "./files.ts";
import { leads } from "./leads.ts";
import { notes } from "./notes.ts";
import { notifications } from "./notifications.ts";
import { milestones, projects } from "./projects.ts";
import { search } from "./search.ts";
import { settings } from "./settings.ts";
import { settingsSignature } from "./settings-signature.ts";
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
  // Proposals and estimates (M4.3): one router per concern, all under /documents. Static paths come before `/:id` where they exist.
  app.route("/v1/documents", documents);
  app.route("/v1/documents", documentSave);
  app.route("/v1/documents", documentFill);
  app.route("/v1/documents", approvalRequests);
  app.route("/v1/documents", documentSend);
  app.route("/v1/documents", documentConvert);
  app.route("/v1/documents", documentPdf);
  app.route("/v1/documents", documentLinks);
  app.route("/v1/documents", documentStart);
  app.route("/v1/projects", projects);
  app.route("/v1/milestones", milestones);
  app.route("/v1/care-plans", carePlans);
  app.route("/v1/time", timeLogs);
  app.route("/v1/notes", notes);
  app.route("/v1/files", files);
  app.route("/v1/contacts", contacts);
  app.route("/v1/notifications", notifications);
  app.route("/v1/search", search);
  app.route("/v1/audit", audit);
}
