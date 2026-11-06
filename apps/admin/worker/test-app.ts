// Test-only: the four Workers' route groups in one app, as the admin Worker was before M5.0. The existing API tests call this app directly (the front's
// forwarders and the real split are proved in split.test.ts). The invoices routes are mounted before the finance routes (the fourth admin Worker, 2026-11-03),
// so the in-process order is the one routes-finance.ts had when it held both. Never imported by a Worker entry.
import { type App, createApp as createBase } from "./app.ts";
import { sessionLimit } from "./rate-limit.ts";
import { mountApi } from "./routes-api.ts";
import { mountFinance } from "./routes-finance.ts";
import { mountFront } from "./routes-front.ts";
import { mountInvoices } from "./routes-invoices.ts";

const mountAll = (app: App) => {
  mountFront(app);
  mountApi(app);
  mountInvoices(app);
  mountFinance(app);
};

/** A fresh combined app. A factory so a test can add a route the table does not declare. */
export const createApp = () => createBase(mountAll, undefined, { sessionLimit });

const app = createApp();
export default app satisfies ExportedHandler<Env>;
