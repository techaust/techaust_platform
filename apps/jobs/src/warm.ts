// Start-up warm-up of the queue consumers (CPU tuning, 2026-10-23): the first lead and the first email in a fresh isolate
// pay for building schemas, loading locale data and compiling the template code. Doing it here, at module top level, moves
// that into isolate start-up instead of the first queue message (the one the Free plan's 10 ms CPU limit applies to).
// Nothing is sent, stored or logged; the sample values are made up.
import { describeUserAgent, WARM_SAMPLES, warmConsumerMessages, warmLabels } from "@techaust/core";
import { renderEmail } from "@techaust/email";
import { alertData } from "./leads.ts";

/** Returns the parses and renders that succeeded (5 + 7), so a test notices a warm-up that silently stopped working. */
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
    // M2.4b: the sign-in link and the four staff security emails, once each, so their first render in a real invocation
    // finds the code compiled. The sample data is made up.
    const who = { name: "Warm Up", first_name: "Warm" };
    const time = "23 Oct 2026, 14:05 IST";
    renderEmail(
      "portal.magic_link",
      { url: "https://warm-up.invalid/auth/callback#t=x", org_name: "Warm", expires_at: "1", accounts: "2" },
      opts,
    );
    rendered++;
    renderEmail(
      "staff.new_device",
      { ...who, time, device: "Chrome on Windows", location: "Kolkata, India" },
      opts,
    );
    rendered++;
    renderEmail("staff.2fa_change", { ...who, time, change: "recovery_code_used" }, opts);
    rendered++;
    renderEmail("staff.lockout", { ...who, time }, opts);
    rendered++;
    renderEmail(
      "staff.lockout_owner",
      { ...who, time, member_name: "Warm Member", admin_url: "https://warm-up.invalid/" },
      opts,
    );
    rendered++;
    // the user-agent reader the staff alerts use (compiles its patterns on first match)
    describeUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    );
  } catch {
    // never stop a Worker from starting
  }
  return parsed + rendered;
}
