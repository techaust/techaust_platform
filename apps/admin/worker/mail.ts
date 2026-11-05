// Emails the admin queues itself (M3.1): the staff invite and the Settings test send. Same path as the sign-in emails of
// M2.4b: the message goes on EMAIL_QUEUE from the request's `waitUntil` (the response does not wait), after the audit row is
// written; the jobs Worker renders and sends it (once, by its entity). A failed send never changes the answer; it writes
// one log line with the error class only (no address, no link, no ID).
import type { EmailMessage } from "@techaust/core"; // type only: the zod schema stays out of this bundle
import type { RefundNotifyMessage, StaffNotifyMessage } from "@techaust/core/notifications";
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

/**
 * M7.2 (L9, Q4 A): an ids-only expansion message for the jobs Worker (`staff.notify` for a bell's staff emails, `refund.notify` for a refund's client email), from
 * the request's `waitUntil` after the batch that wrote it. A failed send never changes the answer (one log line, the kind only); the hourly `bells.sweep` catches a
 * lost `staff.notify` (a lost `refund.notify` on a route path has no sweep: "Send refund email again" is a follow-up).
 */
export function queueNotify(c: Ctx, message: StaffNotifyMessage | RefundNotifyMessage): void {
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await c.env.EMAIL_QUEUE.send(message);
      } catch (e) {
        console.error(
          JSON.stringify({
            level: "error",
            route: c.var.route?.path ?? "other",
            message: "notify not queued",
            kind: message.kind,
            rid: c.var.rid,
            cause: e instanceof Error ? e.name : "unknown",
          }),
        );
      }
    })(),
  );
}
