// Sample data for Settings > Email "Send a test" (ADM-SET-07): one made-up data set per template, so a test shows the
// real layout and wording without any real name, number or link (07-H section 1: "it uses sample data"). Addresses are on
// example.test, links point nowhere real. Pure: no I/O.

import type { EmailTemplate } from "@techaust/core/email-templates";
import { firstNameOf } from "@techaust/core/offers";

/** The names people see in Settings and in the test email's subject ("Test: Lead alert"). */
export const TEMPLATE_NAMES: Record<EmailTemplate, string> = {
  "lead.acknowledgement": "Lead acknowledgement",
  "lead.alert": "Lead alert",
  "portal.magic_link": "Client sign-in link",
  "staff.new_device": "New sign-in alert",
  "staff.2fa_change": "Two-step change alert",
  "staff.lockout": "Account locked",
  "staff.lockout_owner": "Account locked (to owners)",
  "staff.invite": "Staff invite",
  "lead.reply": "Lead reply",
  "offer.sent": "Proposal or estimate sent",
  "offer.accepted.client": "Acceptance confirmation (client)",
  "offer.accepted.staff": "Acceptance notice (team)",
  "offer.declined.staff": "Decline notice (team)",
  "approval.requested": "Approval requested",
  "approval.decided": "Approval decided",
  // M5.4 (names as the Settings list shows them; the words of the emails are 07-U's)
  "invoice.sent": "Invoice sent",
  "proforma.sent": "Proforma sent",
  "credit_note.sent": "Credit note sent",
  "debit_note.sent": "Debit note sent",
  "reminder.sent": "Payment reminder",
  "alert.unbilled": "Unbilled work alert (team)",
  "alert.proforma_due": "Proforma for delivered work alert (team)",
  "lut.reminder": "LUT reminder (team)",
  // M5.5b (names as the Settings list shows them; the words are 07-V's)
  "edf.reminder": "EDF reminder (team)",
  "realisation.alert": "Export realisation alert (team)",
};

const SAMPLE = "https://example.test/sample";

/** The data a template renders with. `time` is the moment of the test, in IST, as the real alerts write it. */
export function sampleData(
  template: EmailTemplate,
  who: { name: string; role: string },
  time: string,
): Record<string, string> {
  const first_name = firstNameOf(who.name);
  const person = { name: who.name, first_name };
  switch (template) {
    case "lead.acknowledgement":
      return { first_name, service_name: "Workflow Automation", ref: "L-23456", cal_link: "" };
    case "lead.alert":
      return {
        ref: "L-23456",
        service_name: "Workflow Automation",
        budget_band: "₹1,00,000 to ₹3,00,000",
        country: "India",
        name: "Sample Person",
        email: "sample.person@example.test",
        phone: "",
        company: "Sample Company",
        timeline: "As soon as possible",
        currency: "INR",
        tools: "Tally, Excel or Google Sheets",
        call_window: "",
        message: "A made-up enquiry that shows how a lead alert reads.",
        source_page: "/get-a-quote",
        type: "",
        plan: "",
        admin_url: SAMPLE,
        failed_queue: "",
      };
    case "portal.magic_link":
      return {
        url: `${SAMPLE}/sign-in`,
        org_name: "Sample Company",
        expires_at: "15 minutes",
        accounts: "1",
      };
    case "staff.new_device":
      return { ...person, time, device: "Chrome on Windows", location: "Kolkata, India", role: who.role };
    case "staff.2fa_change":
      return { ...person, time, change: "recovery_codes_regenerated", role: who.role };
    case "staff.lockout":
      return { ...person, time, role: who.role };
    case "staff.lockout_owner":
      return { ...person, time, member_name: "Sample Member", admin_url: SAMPLE };
    case "staff.invite":
      return { inviter_name: who.name, role: "Staff", url: `${SAMPLE}/invite` };
    case "offer.sent":
      return {
        first_name,
        kind: "proposal",
        title: "Sample website rebuild",
        number: "TH/PRP/2627/0001",
        version: "1",
        valid_until: "30 Nov 2026",
        total: "₹1,00,000.00",
        url: `${SAMPLE}/offer`,
        attached: "1",
        sender_name: who.name,
      };
    case "offer.accepted.client":
    case "offer.accepted.staff":
      return {
        typed_name: "Sample Person",
        accepted_at_ist: time,
        title: "Sample website rebuild",
        number: "TH/PRP/2627/0001",
        version: "1",
        url: `${SAMPLE}/offer`,
        next_step: "we'll confirm the start date with you",
      };
    case "offer.declined.staff":
      return {
        name: "Sample Person",
        title: "Sample website rebuild",
        number: "TH/PRP/2627/0001",
        version: "1",
        reason: "The timing doesn't work for us",
        note: "",
        url: `${SAMPLE}/offer`,
      };
    case "approval.requested":
      return {
        requester_name: "Sample Member",
        request_reason: "a 15 % discount",
        title: "Sample website rebuild",
        version: "1",
        amount: "₹85,000.00",
        admin_url: SAMPLE,
      };
    case "approval.decided":
      return {
        decision: "Approved",
        approver_name: who.name,
        title: "Sample website rebuild",
        version: "1",
        decision_note: "Fine for this client",
        admin_url: SAMPLE,
      };
    case "invoice.sent":
    case "proforma.sent":
    case "credit_note.sent":
    case "debit_note.sent":
    case "reminder.sent": {
      const document = {
        first_name,
        number: "TH/INV/2627/0001",
        issue_date: "5 Nov 2026",
        due_date: "12 Nov 2026",
        total: "₹23,600.00",
        balance: "₹23,600.00",
        url: `${SAMPLE}/invoice`,
        attached: "1",
        parent_number:
          template === "credit_note.sent" || template === "debit_note.sent" ? "TH/INV/2627/0001" : "",
        sender_name: who.name,
        reason: template === "credit_note.sent" || template === "debit_note.sent" ? "Price correction" : "",
        parent_balance: template === "credit_note.sent" ? "₹10,000.00" : "",
      };
      return template === "reminder.sent"
        ? { ...document, offset_days: "3", when: "after", kind: "invoice" }
        : document;
    }
    case "alert.unbilled":
      return {
        owner_first_name: first_name,
        client_name: "Sample Company",
        admin_url: SAMPLE,
        milestone_title: "Sample milestone",
        delivered_date: "1 Oct 2026",
        days_since: "25",
      };
    case "alert.proforma_due":
      return {
        owner_first_name: first_name,
        client_name: "Sample Company",
        admin_url: SAMPLE,
        milestone_title: "Sample milestone",
        delivered_date: "1 Oct 2026",
        days_since: "25",
        proforma_number: "TH/PI/2627/0001",
        balance: "₹23,600.00",
      };
    case "lut.reminder":
      return { owner_first_name: first_name, fy_label: "2027-28", state: "due", admin_url: SAMPLE };
    case "edf.reminder":
      return {
        owner_first_name: first_name,
        month_label: "October 2026",
        count: "3",
        due_date: "30 Nov 2026",
        link: SAMPLE,
      };
    case "realisation.alert":
      return {
        owner_first_name: first_name,
        stage: "fema_approaching",
        number: "TH/EXP/2627/0001",
        client: "Sample Company",
        currency: "USD",
        outstanding: "$1,000.00",
        due_date: "3 Aug 2027",
        link: SAMPLE,
      };
    case "lead.reply":
      return {
        subject: "Re: your enquiry (L-23456)",
        body: `Hi Sample, a made-up reply that shows how a reply from the lead page reads.

Regards, ${who.name}, TecHaust Technologies`,
      };
  }
}
