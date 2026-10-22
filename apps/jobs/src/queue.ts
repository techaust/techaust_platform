// The queue entry point: routes a batch to its consumer by queue name (`techaust-<env>-leads`, `-leads-dlq`, `-email`,
// `-email-dlq`). Each message is acknowledged on success and retried when its consumer throws or asks for a retry;
// after 5 tries the queue moves it to the dead-letter queue (wrangler.jsonc).
import { processDeadLetter, processEmail } from "./email.ts";
import { processLead } from "./leads.ts";
import { logEvent } from "./log.ts";

export async function handleQueue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  const queue = batch.queue;
  for (const message of batch.messages) {
    try {
      if (queue.endsWith("-leads-dlq") || queue.endsWith("-email-dlq")) {
        if (await processDeadLetter(env, queue)) message.ack();
        else message.retry({ delaySeconds: 60 });
      } else if (queue.endsWith("-leads")) {
        await processLead(env, message.body);
        message.ack();
      } else if (queue.endsWith("-email")) {
        if ((await processEmail(env, message.body)) === "retry") message.retry({ delaySeconds: 30 });
        else message.ack();
      } else {
        logEvent("queue.unknown", { queue });
        message.ack();
      }
    } catch (e) {
      // A database or network error: let the queue redeliver. The error text may carry values, so only its type is logged.
      logEvent("queue.error", {
        queue,
        attempts: message.attempts,
        error: e instanceof Error ? e.name : "unknown",
      });
      message.retry({ delaySeconds: Math.min(300, 10 * 2 ** message.attempts) });
    }
  }
}
