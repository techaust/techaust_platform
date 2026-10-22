// Start-up warm-up of the queue consumers (CPU tuning, 2026-10-23): the first lead and the first email in a fresh isolate
// pay for building schemas, loading locale data and compiling the template code. Doing it here, at module top level, moves
// that into isolate start-up instead of the first queue message (the one the Free plan's 10 ms CPU limit applies to).
// Nothing is sent, stored or logged; the sample values are made up.
import { WARM_SAMPLES, warmConsumerMessages, warmLabels } from "@techaust/core";
import { renderEmail } from "@techaust/email";
import { alertData } from "./leads.ts";

export function warmConsumers(): void {
  warmConsumerMessages();
  warmLabels();
  try {
    const opts = { assetBase: "https://warm-up.invalid/" };
    renderEmail("lead.acknowledgement", { first_name: "Warm", service_name: "Warm", ref: "L-23456" }, opts);
    // a full quote alert, so the row building and escaping run as they do for a real lead
    const env = { ADMIN_URL: "https://warm-up.invalid/" } as unknown as Env; // alertData reads only ADMIN_URL
    renderEmail("lead.alert", alertData(env, WARM_SAMPLES.quoteLead, "L-23456"), opts);
  } catch {
    // never stop a Worker from starting
  }
}
