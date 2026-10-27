import { expireMessage } from "@techaust/core/expiry";
import { warmSesSigning } from "@techaust/email";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { enqueueHourly, HOURLY_CRON } from "./billing.ts";
import { noteInvocation } from "./log.ts";
import { enqueueSweep } from "./pdf.ts";
import { enqueueDue, PURGE_CRON } from "./purge.ts";
import { handleQueue } from "./queue.ts";
import { enqueueStats } from "./stats.ts";
import { warmConsumers } from "./warm.ts";

warmConsumers();
// Web Crypto is allowed at start-up and finishes before the first event; errors are swallowed inside (CPU tuning)
void warmSesSigning();

const app = new Hono<{ Bindings: Env }>();
app.use(secureHeaders());

// Health check: deliberately touches no database (saves D1 reads; docs/05 §13).
app.get("/healthz", (c) => c.json({ ok: true, service: "jobs", env: c.env.ENVIRONMENT }));

// Webhook routes (/razorpay, /stripe, /paypal, /ses) arrive in M6/M7.
app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));

export default {
  fetch: app.fetch,
  // Cron dispatcher: only enqueues work (docs/05 §11.3), and reads nothing from D1.
  //   `0 22 * * *` (03:30 IST, daily): the lead clean-up (M3.2), the PDF sweep (M4.4), the nightly statistics (M3.5) and the expiry of sent proposals and estimates (M4.3; one message in the
  //     statistics batch). The daily LUT check moved to the 09:00 IST alerts in M5.4 (LD61).
  //   `30 * * * *` (the top of every IST hour, M5.4, LD61): ONE `sendBatch` with the reminder scan every hour, the care-plan scan at 06:00 IST and the owners' alerts at 09:00 IST.
  // One failing does not stop the others; the run still fails so the failure is seen.
  async scheduled(controller, env, _ctx) {
    noteInvocation();
    if (controller.cron === HOURLY_CRON) {
      await enqueueHourly(env, controller.scheduledTime);
      return;
    }
    if (controller.cron !== PURGE_CRON) return;
    const done = await Promise.allSettled([
      enqueueDue(env, controller.scheduledTime),
      // M4.4: ONE sweep message on the PDF queue; the consumer picks the sent documents that still have no PDF (<= 20 a run).
      enqueueSweep(env, controller.scheduledTime),
      enqueueStats(env, controller.scheduledTime, [expireMessage(controller.scheduledTime)]),
    ]);
    const failed = done.find((d) => d.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  },
  // Queue consumers: leads and email, with their dead-letter queues (M2.4).
  queue: handleQueue,
} satisfies ExportedHandler<Env>;
