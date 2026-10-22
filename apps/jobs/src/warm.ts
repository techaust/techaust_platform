// Start-up warm-up of the queue consumers (CPU tuning, 2026-10-23): the first lead and the first email in a fresh isolate
// pay for building schemas, loading locale data and compiling the template code. Doing it here, at module top level, moves
// that into isolate start-up instead of the first queue message (the one the Free plan's 10 ms CPU limit applies to).
// Nothing is sent, stored or logged; the sample values are made up.
import { warmFormSchemas, warmLabels } from "@techaust/core";
import { renderEmail } from "@techaust/email";

export function warmConsumers(): void {
  warmFormSchemas();
  warmLabels();
  try {
    const opts = { assetBase: "https://warm-up.invalid/" };
    renderEmail("lead.acknowledgement", { first_name: "Warm", service_name: "Warm", ref: "L-23456" }, opts);
    renderEmail("lead.alert", { ref: "L-23456", admin_url: "https://warm-up.invalid/" }, opts);
  } catch {
    // never stop a Worker from starting
  }
}
