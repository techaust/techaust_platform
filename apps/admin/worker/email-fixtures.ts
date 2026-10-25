// Sample data for Settings > Email "Send a test" (ADM-SET-07): one made-up data set per template, so a test shows the
// real layout and wording without any real name, number or link (07-H section 1: "it uses sample data"). Addresses are on
// example.test, links point nowhere real. Pure: no I/O.
import type { EmailTemplate } from "@techaust/core/email-templates";

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
  "approval.requested": "Approval requested",
  "approval.decided": "Approval decided",
};

const SAMPLE = "https://example.test/sample";

/** The data a template renders with. `time` is the moment of the test, in IST, as the real alerts write it. */
export function sampleData(
  template: EmailTemplate,
  who: { name: string; role: string },
  time: string,
): Record<string, string> {
  const first_name = who.name.split(/\s+/)[0] ?? who.name;
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
    case "lead.reply":
      return {
        subject: "Re: your enquiry (L-23456)",
        body: `Hi Sample, a made-up reply that shows how a reply from the lead page reads.

Regards, ${who.name}, TecHaust Technologies`,
      };
  }
}
