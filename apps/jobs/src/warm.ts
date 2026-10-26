// Start-up warm-up of the queue consumers (CPU tuning, 2026-10-23): the first lead and the first email in a fresh isolate
// pay for building schemas, loading locale data and compiling the template code. Doing it here, at module top level, moves
// that into isolate start-up instead of the first queue message (the one the Free plan's 10 ms CPU limit applies to).
// Nothing is sent, stored or logged; the sample values are made up.
import {
  describeUserAgent,
  WARM_SAMPLES,
  warmConsumerMessages,
  warmLabels,
  warmOfferMessages,
} from "@techaust/core";
import { renderEmail } from "@techaust/email";
import { renderCertificateHtml, warmPdf } from "@techaust/pdf";
import { buildCertificateView } from "./certificate.ts";
import { alertData } from "./leads.ts";

/** Returns the parses and renders that succeeded (5 + 10), so a test notices a warm-up that silently stopped working. */
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
    // every `change` the alert can carry, with a role (the real data has one; it picks the "Not you?" line): the owner's line
    // for each change, then the member's line once
    for (const change of ["recovery_code_used", "recovery_codes_regenerated", "reset_by_owner"]) {
      renderEmail("staff.2fa_change", { ...who, time, change, role: "owner" }, opts);
      rendered++;
    }
    renderEmail("staff.2fa_change", { ...who, time, change: "recovery_code_used", role: "staff" }, opts);
    rendered++;
    renderEmail("staff.lockout", { ...who, time }, opts);
    rendered++;
    renderEmail(
      "staff.lockout_owner",
      { ...who, time, member_name: "Warm Member", admin_url: "https://warm-up.invalid/" },
      opts,
    );
    rendered++;
    // M3.1: the staff invite, and the same email as a Settings test send (subject and first line)
    renderEmail(
      "staff.invite",
      { inviter_name: "Warm Owner", role: "staff", url: "https://warm-up.invalid/invite#t=x" },
      opts,
    );
    rendered++;
    renderEmail(
      "staff.invite",
      {
        inviter_name: "Warm Owner",
        role: "staff",
        url: "https://warm-up.invalid/invite#t=x",
        test_name: "Staff invite",
      },
      opts,
    );
    rendered++;
    // M3.2: a reply from the lead page (escaping and paragraphs)
    renderEmail(
      "lead.reply",
      { subject: "Re: your enquiry (L-23456)", body: "Hi Warm, thanks.\n\nRegards, Warm" },
      opts,
    );
    rendered++;
    // M4.5: the decline notice to TecHaust (the only offer email the consumer renders that the other warm-ups don't cover)
    renderEmail(
      "offer.declined.staff",
      {
        name: "Warm Up",
        title: "Warm",
        number: "TH/PRP/2627/0001",
        version: "1",
        reason: "Other",
        note: "Warm",
        url: "https://warm-up.invalid/",
      },
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
  // M4.4: one sample document through the view, Markdown and HTML code (the render message's CPU, JOB-PDF-01). Returns 0 on failure.
  warmPdf();
  // M4.5: the four expansion messages of the email queue, and one made-up acceptance certificate through the view and the HTML.
  warmOfferMessages();
  try {
    renderCertificateHtml(
      buildCertificateView({
        number_display: "TH/PRP/2627/0001",
        version: 1,
        type: "proposal",
        title: "Warm-up",
        total_minor: 29_500_000,
        currency: "INR",
        client_legal_name: "Warm Client",
        typed_name: "Warm Person",
        email: "warm-up@example.invalid",
        accepted_at: 1_790_000_000_000,
        ip: "203.0.113.7",
        user_agent: "Mozilla/5.0 (Warm-up)",
        country: "IN",
        via: "session",
        pdf_sha256: "0".repeat(64),
        snapshot_sha256: "1".repeat(64),
        terms_version: 1,
        terms_sha256: "2".repeat(64),
        certificate_r2_key: "docs/proposal/2026-27/0001-v1-certificate.pdf",
        rendered_at: null,
      }),
    );
  } catch {
    // never stop a Worker from starting
  }
  return parsed + rendered;
}
