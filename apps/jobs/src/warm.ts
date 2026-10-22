// Start-up warm-up of the queue consumers (CPU tuning, 2026-10-23): the first lead and the first email in a fresh isolate
// pay for building schemas, loading locale data and compiling the template code. Doing it here, at module top level, moves
// that into isolate start-up instead of the first queue message (the one the Free plan's 10 ms CPU limit applies to).
// Nothing is sent, stored or logged; the sample values are made up.
import { WARM_SAMPLES, warmConsumerMessages, warmLabels } from "@techaust/core";
import { renderEmail } from "@techaust/email";
import { alertData } from "./leads.ts";

/** Returns the parses and renders that succeeded (3 + 2), so a test notices a warm-up that silently stopped working. */
export function warmConsumers(): number {
  const parsed = warmConsumerMessages();
  warmLabels();
  let rendered = 0;
  try {
    const opts = { assetBase: "https://warm-up.invalid/" };
    renderEmail("lead.acknowledgement", { first_name: "Warm", service_name: "Warm", ref: "L-23456" }, opts);
    rendered++;
    // a full quote alert, so the row building and escaping run as they do for a real lead
    renderEmail(
      "lead.alert",
      alertData({ ADMIN_URL: "https://warm-up.invalid/" }, WARM_SAMPLES.quoteLead, "L-23456"),
      opts,
    );
    rendered++;
  } catch {
    // never stop a Worker from starting
  }
  return parsed + rendered;
}
