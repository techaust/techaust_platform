// Emails the admin queues itself (M3.1): the staff invite and the Settings test send. Same path as the sign-in emails of
// M2.4b: the message goes on EMAIL_QUEUE from the request's `waitUntil` (the response does not wait), after the audit row is
// written; the jobs Worker renders and sends it (once, by its entity). A failed send never changes the answer; it writes
// one log line with the error class only (no address, no link, no ID).
import type { EmailMessage } from "@techaust/core"; // type only: the zod schema stays out of this bundle
import type { Ctx } from "./context.ts";

export function queueEmail(c: Ctx, message: EmailMessage): void {
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await c.env.EMAIL_QUEUE.send(message);
      } catch (e) {
        console.error(
          JSON.stringify({
            level: "error",
            route: c.var.route?.path ?? "other",
            message: "email not queued",
            template: message.template,
            rid: c.var.rid,
            cause: e instanceof Error ? e.name : "unknown",
          }),
        );
      }
    })(),
  );
}
