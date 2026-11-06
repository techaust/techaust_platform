import { expireMessage } from "@techaust/core/expiry";
import { usageMessageOf } from "@techaust/core/usage";
import { warmSesSigning } from "@techaust/email";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { cronBranchOf, enqueueHourly, HOURLY_CRON } from "./billing.ts";
import { payPalHook } from "./hooks/paypal.ts";
import { razorpayHook } from "./hooks/razorpay.ts";
import { sesHook, warmSesHook } from "./hooks/ses.ts";
import { stripeHook } from "./hooks/stripe.ts";
import { firstRun, logEvent, noteInvocation } from "./log.ts";
import { enqueueSweep } from "./pdf.ts";
import { enqueueStatementPurge, PURGE_CRON, purgeScanMessage } from "./purge.ts";
import { handleQueue } from "./queue.ts";
import { nightlyDpMessages } from "./retention.ts";
import { enqueueStats } from "./stats.ts";
import { unsubscribeGet, unsubscribePost } from "./unsubscribe.ts";
import { warmConsumers, warmRazorpayHook } from "./warm.ts";
import { warmPayPalHookAtStartup } from "./warm-paypal.ts";

/** M7.5 L11: the answer of every jobs route is JSON or one line of text, never a page: nothing may load and nothing may frame it. (Not exported: a named
 * export of an entry is an entrypoint.) */
const API_CSP = "default-src 'none'; frame-ancestors 'none'";

warmConsumers();
// Web Crypto is allowed at start-up and finishes before the first event; errors are swallowed inside (CPU tuning)
void warmSesSigning();
// M6.2 (CPU diagnosis, lead decision 3): the webhook's first run paid at start-up (the HMAC with a made-up secret, the readers, one parse).
void warmRazorpayHook();
// M6.4 (L31, early check 2 finding 4): the PayPal webhook's path dry-run at start-up on a made-up event and certificate (warm-paypal.ts); nothing kept or sent.
void warmPayPalHookAtStartup();
// M7.2 (run file J): the SES hook's first run paid at start-up (digests and the constant-time compare with a made-up token, one parse, the statements built
// over a stand-in; nothing reaches D1).
void warmSesHook();

const app = new Hono<{ Bindings: Env }>();
// M7.5 L11 (jobs part, A2: Hono's defaults gave HSTS for 180 days, no CSP and no Permissions-Policy): the website Worker's options (apps/web/src/worker.ts).
app.use(
  secureHeaders({
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "strict-origin-when-cross-origin",
    crossOriginOpenerPolicy: "same-origin",
    permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [], usb: [] },
  }),
);
// The API CSP, set only when the handler set none (A2's trap: secureHeaders' own CSP option would overwrite a handler's). Nothing here is a page.
app.use(async (c, next) => {
  await next();
  if (c.res.headers.has("Content-Security-Policy")) return;
  try {
    c.res.headers.set("Content-Security-Policy", API_CSP);
  } catch {
    // Immutable headers (a response passed through as is): copy it once, then set.
    c.res = new Response(c.res.body, c.res);
    c.res.headers.set("Content-Security-Policy", API_CSP);
  }
});

// Health check: deliberately touches no database (saves D1 reads; docs/05 §13).
app.get("/healthz", (c) => c.json({ ok: true, service: "jobs", env: c.env.ENVIRONMENT }));

// M6.2: the Razorpay webhook, `POST /razorpay` only (any other method on it, or `/razorpay/*`, is the 404 below and touches no database).
app.post("/razorpay", (c) => razorpayHook(c.req.raw, c.env));
// M7.2: the SES events hook, `POST /ses` only, checked by the EventBridge connection's header token (any other method, or `/ses/*`, is the 404 below and
// touches no database).
app.post("/ses", (c) => sesHook(c.req.raw, c.env));
// M6.3: the Stripe webhook, `POST /stripe` only (any other method, or `/stripe/*`, is the 404 below and touches no database).
app.post("/stripe", (c) => stripeHook(c.req.raw, c.env));
// M6.4: the PayPal webhook, `POST /paypal` only, verified offline (any other method, or `/paypal/*`, is the 404 below and touches no database).
app.post("/paypal", (c) => payPalHook(c.req.raw, c.env));
// M7.2 (C.5, L8): the weekly digest's RFC 8058 one-click unsubscribe, `POST /u?t=` switches one member's digest off; `GET /u` only answers one line and
// never changes anything (a link scanner can't unsubscribe). Access bypass on path `u` (H1); the token rides in the query string, which Workers Logs redact.
app.post("/u", (c) => unsubscribePost(c.req.raw, c.env));
app.get("/u", () => unsubscribeGet());
app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));
// M6.4 (L31): the router's matcher is built on its first match; matching the webhook paths while the module loads moves that out of the first metered
// webhook (as the admin Workers' `warmRouter`). Pure: no Request, no env, no I/O; never throws.
try {
  for (const path of ["/paypal", "/razorpay", "/ses", "/stripe", "/u"]) app.router.match("POST", path);
  app.router.match("GET", "/healthz");
} catch {
  // never stop a Worker from starting
}

export default {
  fetch: app.fetch,
  // Cron dispatcher: only enqueues work (docs/05 §11.3), and reads nothing from D1.
  //   `0 22 * * *` (03:30 IST, daily): the lead clean-up (M3.2; its first scan is a queued message since FX-1), the PDF sweep (M4.4), the nightly statistics (M3.5), the expiry of sent proposals and estimates (M4.3; one message in the
  //     statistics batch) and the statement PDF clean-up (M5.5b). The daily LUT check moved to the 09:00 IST alerts in M5.4 (LD61).
  //   `30 * * * *` (the top of every IST hour, M5.4, LD61): ONE `sendBatch` with the reminder scan every hour, the care-plan scan at 06:00 IST (again at 07:00 and 08:00, FX-1), the owners' alerts at 09:00 IST (again at 10:00 and 11:00), and at 09:00 IST the export realisation scan and (IST days 5 to 7) the EDF reminder (M5.5b).
  // One failing does not stop the others; the run still fails so the failure is seen.
  async scheduled(controller, env, _ctx) {
    noteInvocation();
    // M7.5 L20: one line per tick with its branch and `f: 1` on the branch's first run in this isolate (the route inventory's four cron rows).
    const b = cronBranchOf(controller.cron, controller.scheduledTime, PURGE_CRON);
    logEvent("cron", { b, f: firstRun(`cron ${b}`) });
    if (controller.cron === HOURLY_CRON) {
      await enqueueHourly(env, controller.scheduledTime);
      return;
    }
    if (controller.cron !== PURGE_CRON) return;
    const done = await Promise.allSettled([
      // M4.4: ONE sweep message on the PDF queue; the consumer picks the sent documents that still have no PDF (<= 20 a run).
      enqueueSweep(env, controller.scheduledTime),
      // The statistics, the expiry and (FX-1, A6 6) the lead clean-up's first scan: one `sendBatch` on the leads queue. The scan reads D1 in its consumer, never here.
      enqueueStats(env, controller.scheduledTime, [
        expireMessage(controller.scheduledTime),
        purgeScanMessage(controller.scheduledTime),
        // M7.4 (D.1): the clean-up's start, and on IST Sundays the vault sweep, on the IST 1st the signature sweep (nothing read here).
        ...nightlyDpMessages(controller.scheduledTime),
        // M7.5 D1 (Q4 A): yesterday's (UTC) Free-plan usage, one message; its consumer makes the one GraphQL fetch (usage.ts).
        usageMessageOf(controller.scheduledTime),
      ]),
      // M5.5b: ONE message to clean the statement PDF cache (30 days, and anonymised clients); nothing read here.
      enqueueStatementPurge(env, controller.scheduledTime),
    ]);
    const failed = done.find((d) => d.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  },
  // Queue consumers: leads and email, with their dead-letter queues (M2.4).
  queue: handleQueue,
} satisfies ExportedHandler<Env>;
