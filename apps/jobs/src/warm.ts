// Start-up warm-up of the queue consumers (CPU tuning, 2026-10-23): the first lead and the first email in a fresh isolate
// pay for building schemas, loading locale data and compiling the template code. Doing it here, at module top level, moves
// that into isolate start-up instead of the first queue message (the one the Free plan's 10 ms CPU limit applies to).
// Nothing is sent, stored or logged; the sample values are made up.
import {
  describeUserAgent,
  WARM_SAMPLES,
  warmBillingMessages,
  warmConsumerMessages,
  warmGatewayMessages,
  warmLabels,
  warmOfferMessages,
  warmReportMessages,
} from "@techaust/core";
import { canonicalJson } from "@techaust/core/hash";
import {
  eventFacts,
  fallbackEventId,
  parseRazorpayEvent,
  razorpayEventIdOf,
  verifyRazorpaySignature,
} from "@techaust/core/razorpay";
import { type StatementKind, statementEntries } from "@techaust/core/statement";
import { renderEmail } from "@techaust/email";
import {
  renderCertificateHtml,
  renderStatementHtml,
  STATEMENT_LAYOUT_ID,
  statementView,
  warmInvoicePdf,
  warmPdf,
} from "@techaust/pdf";
import { buildCertificateView } from "./certificate.ts";
import { alertData } from "./leads.ts";

/**
 * One made-up statement of `count` lines through the same steps the `pdf.statement` consumer takes before Browser Run: `statementEntries`, the view, the canonical JSON the
 * view hash is made of (the SHA-256 itself is async and left out of start-up) and `renderStatementHtml`. Returns the HTML length (0 on failure: it never stops a Worker from starting).
 */
export function warmStatement(count = 3): number {
  try {
    const kinds: StatementKind[] = ["tax_invoice", "credit_note", "export_invoice", "receipt"];
    const rows = Array.from({ length: count }, (_, i) => {
      const kind = kinds[i % kinds.length] as StatementKind;
      return {
        id: `warm-${i}`,
        kind,
        date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
        number: `TH/INV/2627/${String(i + 1).padStart(4, "0")}`,
        amountMinor: 118_000 + i,
        againstNumber: kind === "credit_note" ? "TH/INV/2627/0001" : null,
      };
    });
    const done = statementEntries(rows, 500_000);
    if (!done.ok) return 0;
    const view = statementView({
      company: {
        tradeName: "Warm",
        legalName: "Warm",
        address: "Warm",
        gstin: null,
        stateCode: "19",
        logo: "",
      },
      client: {
        code: "C-WARM",
        legalName: "Warm Client",
        address: { line1: "1 Warm Road", city: "Kolkata" },
        gstin: null,
      },
      currency: "INR",
      from: "2026-10-01",
      to: "2026-10-31",
      openingMinor: 500_000,
      entries: done.entries.map((e) => ({ ...e, againstNumber: e.againstNumber ?? null })),
      debitMinor: done.totals.debitMinor,
      creditMinor: done.totals.creditMinor,
      closingMinor: done.closingMinor,
      billingEmail: "billing@warm-up.invalid",
      generatedOn: "2026-10-31",
    });
    canonicalJson({ layout: STATEMENT_LAYOUT_ID, ...view });
    return renderStatementHtml(view).length;
  } catch {
    return 0;
  }
}

/** Returns the parses and renders that succeeded (33 today, counted in `warm.test.ts`), so a test notices a warm-up that silently stopped working. */
export function warmConsumers(): number {
  const parsed = warmConsumerMessages() + warmReportMessages();
  warmLabels();
  let rendered = 0;
  let statementOk = 0;
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
    // M5.4: an invoice email, a payment reminder and an owners' alert, so the billing layouts are compiled before the first `invoice.send`,
    // `reminder.send` or `alerts.daily` message (the keys are core's `INVOICE_EMAIL_DATA`; the values are made up).
    const doc = {
      first_name: "Warm",
      number: "TH/INV/2627/0001",
      issue_date: "5 Nov 2026",
      due_date: "12 Nov 2026",
      total: "₹23,600.00",
      balance: "₹23,600.00",
      url: "https://warm-up.invalid/i#t=x",
      attached: "1",
      parent_number: "",
      sender_name: "Warm",
      reason: "",
      parent_balance: "",
    };
    renderEmail("invoice.sent", doc, opts);
    rendered++;
    renderEmail(
      "reminder.sent",
      { ...doc, attached: "", offset_days: "3", when: "after", kind: "invoice" },
      opts,
    );
    rendered++;
    renderEmail(
      "alert.unbilled",
      {
        owner_first_name: "Warm",
        client_name: "Warm",
        admin_url: "https://warm-up.invalid/",
        milestone_title: "Warm",
        delivered_date: "1 Oct 2026",
        days_since: "25",
      },
      opts,
    );
    rendered++;
    // The other invoice-family templates (proforma, credit note, debit note), the proforma-due alert and the LUT reminder, so none of them compiles in its first message (review L3).
    for (const template of ["proforma.sent", "credit_note.sent", "debit_note.sent"] as const) {
      renderEmail(
        template,
        { ...doc, parent_number: "TH/INV/2627/0001", reason: "Warm", parent_balance: "₹0.00" },
        opts,
      );
      rendered++;
    }
    renderEmail(
      "alert.proforma_due",
      {
        owner_first_name: "Warm",
        client_name: "Warm",
        admin_url: "https://warm-up.invalid/",
        milestone_title: "Warm",
        delivered_date: "1 Oct 2026",
        days_since: "25",
        proforma_number: "TH/PRO/2627/0001",
        balance: "₹23,600.00",
      },
      opts,
    );
    rendered++;
    renderEmail(
      "lut.reminder",
      {
        owner_first_name: "Warm",
        fy_label: "2026-27",
        state: "missing",
        admin_url: "https://warm-up.invalid/",
      },
      opts,
    );
    rendered++;
    // M5.5b: the realisation alert (one stage) and the monthly EDF reminder, the two owner emails of the reports
    renderEmail(
      "realisation.alert",
      {
        owner_first_name: "Warm",
        stage: "fema_overdue",
        number: "TH/EXP/2627/0001",
        client: "Warm",
        currency: "USD",
        outstanding: "$1,000.00",
        due_date: "1 Nov 2026",
        link: "https://warm-up.invalid/reports/realisation",
      },
      opts,
    );
    rendered++;
    renderEmail(
      "edf.reminder",
      {
        owner_first_name: "Warm",
        month_label: "October 2026",
        count: "2",
        due_date: "30 Nov 2026",
        link: "https://warm-up.invalid/reports/edf",
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
  // M5.1: one made-up invoice through the invoice view and the plain skeleton (the same render message, an invoice's code path).
  warmInvoicePdf();
  // M5.5b: one made-up statement through the entries, the view, the hash input and the HTML (counted in `warm.test.ts`).
  if (warmStatement() > 0) statementOk = 1;
  // M4.5: the four expansion messages of the email queue, and one made-up acceptance certificate through the view and the HTML.
  warmOfferMessages();
  // M5.4: the invoice send, reminder, care, alert and reminder-scan messages (schemas built at start-up, not in the first message).
  warmBillingMessages();
  // M6.2: the three gateway messages of the leads queue.
  warmGatewayMessages();
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
  return parsed + rendered + statementOk;
}

/**
 * M6.2 (CPU diagnosis, lead decision 3): the Razorpay webhook's first run, paid at start-up: an HMAC key imported and a signature made with a MADE-UP secret
 * over a sample body, the constant-time verify, the event-id reader and the fallback hash, one parse of a sample event and its whitelisted facts. Nothing is
 * stored, sent or logged; the real secret's key is imported on the first webhook and then kept per isolate. Returns the steps that succeeded (5; `warm.test.ts`).
 */
export async function warmRazorpayHook(): Promise<number> {
  let ok = 0;
  try {
    const secret = "warm-up-secret-not-a-real-one";
    const body = JSON.stringify({
      entity: "event",
      event: "payment_link.paid",
      created_at: 1_790_000_000,
      payload: {
        payment_link: { entity: { id: "plink_WARMUP0000001", amount: 100, currency: "INR", status: "paid" } },
        payment: { entity: { id: "pay_WARMUP0000001", amount: 100, currency: "INR", method: "upi" } },
      },
    });
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    ok++;
    if (await verifyRazorpaySignature(enc.encode(body), sig, [secret])) ok++;
    if (razorpayEventIdOf("evt_WARMUP0000001") !== null) ok++;
    if ((await fallbackEventId(body)).startsWith("sha256:")) ok++;
    const parsed = parseRazorpayEvent(JSON.parse(body), "evt_WARMUP0000001");
    if (parsed.ok && Object.keys(eventFacts(parsed.value)).length > 0) ok++;
  } catch {
    // never stop a Worker from starting
  }
  return ok;
}
