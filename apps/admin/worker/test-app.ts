// Test-only: the three Workers' route groups in one app, as the admin Worker was before M5.0. The existing API tests call this app
// directly (the front's forwarders and the real split are proved in split.test.ts). Never imported by a Worker entry.
import { type App, createApp as createBase } from "./app.ts";
import { mountApi } from "./routes-api.ts";
import { mountFinance } from "./routes-finance.ts";
import { mountFront } from "./routes-front.ts";

const mountAll = (app: App) => {
  mountFront(app);
  mountApi(app);
  mountFinance(app);
};

/** A fresh combined app. A factory so a test can add a route the table does not declare. */
export const createApp = () => createBase(mountAll);

const app = createApp();
export default app satisfies ExportedHandler<Env>;
