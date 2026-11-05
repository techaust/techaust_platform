// M7.2 core: the new message readers (strict: exactly their keys) and 07-ZQ's lines [ADM-G-09, ADM-PAY-08, JOB-CRON-03; run file B, D, H].
import { describe, expect, it } from "vitest";
import {
  APPROVED_07ZQ,
  DIGEST_COPY,
  DIGEST_LABEL,
  EMAIL_STATUS_LABELS,
  jobFailedTitle,
  M72_TEMPLATE_NAMES,
  NOTIFICATION_COPY,
  offerViewedTitle,
  PREF_GROUP_LABELS,
  REFUND_EMAIL_COPY,
  SIGNIN_UNFINISHED_COPY,
  UNSUBSCRIBE_DONE_LINE,
  UNSUBSCRIBE_GET_LINE,
} from "../src/copy-zq.ts";
import { SUPPRESSION_REASON_LABELS, SUPPRESSION_REASON_OTHER } from "../src/email-events.ts";
import { EMAIL_TEMPLATES, NON_TRANSACTIONAL_TEMPLATES } from "../src/email-templates.ts";
import {
  BELL_ENTITY_TYPES,
  EMAILED_BELL_KINDS,
  isBellsSweepKind,
  isRefundNotifyKind,
  isSigninUnfinishedKind,
  NOTIFICATIONS_PATH,
  parseBellsSweep,
  parseRefundNotify,
  parseSigninUnfinished,
  refundNotify,
} from "../src/notifications.ts";

describe("the M7.2 message readers", () => {
  it("signin.unfinished: exactly v, kind and a non-negative integer asOf", () => {
    expect(parseSigninUnfinished({ v: 1, kind: "signin.unfinished", asOf: 5 })).toEqual({
      v: 1,
      kind: "signin.unfinished",
      asOf: 5,
    });
    for (const bad of [
      null,
      [],
      { v: 2, kind: "signin.unfinished", asOf: 5 },
      { v: 1, kind: "signin.unfinished", asOf: -1 },
      { v: 1, kind: "signin.unfinished", asOf: 1.5 },
      { v: 1, kind: "signin.unfinished", asOf: 5, userId: "x" },
      { v: 1, kind: "other", asOf: 5 },
    ])
      expect(parseSigninUnfinished(bad)).toBeNull();
    expect(isSigninUnfinishedKind({ kind: "signin.unfinished" })).toBe(true);
    expect(isSigninUnfinishedKind("signin.unfinished")).toBe(false);
  });

  it("bells.sweep: exactly v, kind and since", () => {
    expect(parseBellsSweep({ v: 1, kind: "bells.sweep", since: 0 })).toEqual({
      v: 1,
      kind: "bells.sweep",
      since: 0,
    });
    for (const bad of [
      { v: 1, kind: "bells.sweep" },
      { v: 1, kind: "bells.sweep", since: "0" },
      { v: 1, kind: "bells.sweep", since: 0, x: 1 },
    ])
      expect(parseBellsSweep(bad)).toBeNull();
    expect(isBellsSweepKind({ kind: "bells.sweep" })).toBe(true);
  });

  it("refund.notify: ids only (an address or a name is refused)", () => {
    expect(parseRefundNotify(refundNotify("rf_1"))).toEqual({ kind: "refund.notify", refundId: "rf_1" });
    for (const bad of [
      { kind: "refund.notify", refundId: "" },
      { kind: "refund.notify", refundId: "x".repeat(65) },
      { kind: "refund.notify", refundId: "rf_1", to: "a@b.co" },
      { kind: "refund.check", refundId: "rf_1" },
    ])
      expect(parseRefundNotify(bad)).toBeNull();
    expect(isRefundNotifyKind({ kind: "refund.notify" })).toBe(true);
  });

  it("every emailed bell kind has its entity type; the Notifications page path is an admin path", () => {
    expect(Object.keys(BELL_ENTITY_TYPES).sort()).toEqual([...EMAILED_BELL_KINDS].sort());
    expect(NOTIFICATIONS_PATH).toMatch(/^\/account\//);
  });
});

describe("07-ZQ (H)", () => {
  it("the client lines are marked until the owner approves them; the brief's staff lines are word for word", () => {
    expect(APPROVED_07ZQ).toBe(false);
    expect(REFUND_EMAIL_COPY.subject("₹1.00", "TH/INV/2627/0001")).toBe(
      "[Placeholder] Refund of ₹1.00 for TH/INV/2627/0001",
    );
    expect(REFUND_EMAIL_COPY.body("Asha", "₹1.00", "TH/INV/2627/0001", "4 Nov 2026")).toBe(
      "[Placeholder] Hi Asha, we've refunded ₹1.00 for TH/INV/2627/0001 on 4 Nov 2026. Banks and card networks may take longer to show it.",
    );
    expect(REFUND_EMAIL_COPY.creditNote("TH/CN/2627/0001")).toBe(
      "[Placeholder] Credit note TH/CN/2627/0001 records this refund.",
    );
    expect(REFUND_EMAIL_COPY.button).toBe("View invoice");
    expect(DIGEST_COPY.subject("02 Nov 2026")).toBe("Your week at TecHaust: 02 Nov 2026");
    expect(DIGEST_COPY.why).toBe(
      "Why you're receiving this: you're an owner of TecHaust admin and the weekly digest is on.",
    );
    expect(DIGEST_COPY.switchOff).toBe("Switch off the weekly digest");
    expect(NOTIFICATION_COPY.footer("online payment")).toBe(
      "You get this email because online payment emails are on in your notification settings.",
    );
    expect(NOTIFICATION_COPY.settingsLink).toBe("Change notification settings");
    expect(UNSUBSCRIBE_GET_LINE).toBe("To change your email settings, open Notifications in TecHaust admin.");
    expect(offerViewedTitle("TH/PRP/2627/0001")).toBe("TH/PRP/2627/0001 was opened by the client");
    expect(offerViewedTitle(null)).toBe("Untitled was opened by the client");
    expect(offerViewedTitle("")).toBe("Untitled was opened by the client");
    expect(jobFailedTitle("techaust-staging-email-dlq")).toBe(
      "A background job ran out of tries (techaust-staging-email-dlq). The details are in the alert email.",
    );
    expect(Object.values(EMAIL_STATUS_LABELS)).toEqual([
      "Queued",
      "Sending",
      "Sent",
      "Delivered",
      "Bounced",
      "Marked as spam",
      "Failed",
      "Not sent",
    ]);
  });

  it("the staff lines are approved by the lead and placed word for word, unmarked (review 1 triage)", () => {
    expect(PREF_GROUP_LABELS).toEqual({
      offerViewed: "proposal and estimate opened",
      paymentReceived: "online payment",
      approvals: "payment check",
      hookFailed: "connection failure",
    });
    expect(DIGEST_LABEL).toBe("weekly digest");
    expect(M72_TEMPLATE_NAMES).toEqual({
      "digest.weekly": "Weekly digest (team)",
      "staff.notification": "Notification email (team)",
      "refund.sent": "Refund sent (client)",
      "staff.signin_unfinished": "Unfinished sign-in alert",
    });
    expect(UNSUBSCRIBE_DONE_LINE).toBe("The weekly digest is switched off.");
    expect(DIGEST_COPY.invoiced).toBe("Invoiced this month");
    expect(DIGEST_COPY.overdue).toBe("Overdue invoices");
    expect(DIGEST_COPY.newLeads).toBe("New leads (last 7 days)");
    expect(DIGEST_COPY.remindersDue).toBe("Reminders due (next 7 days)");
    expect(SIGNIN_UNFINISHED_COPY.subject).toBe("Your TecHaust admin password was used");
    expect(SIGNIN_UNFINISHED_COPY.body("Asha", "5 Nov 2026, 10:00 IST")).toBe(
      "Hi Asha, your TecHaust admin password was used to start a sign-in on 5 Nov 2026, 10:00 IST, but the 6-digit code was never entered, so the sign-in wasn't finished.",
    );
    expect(SIGNIN_UNFINISHED_COPY.advice).toBe(
      "If this wasn't you, someone else may know your password: ask an owner to reset it under Settings › Users (if you are the only owner, follow the break-glass steps in the security runbook). If it was you, for example a code page you closed, you can ignore this email.",
    );
    expect(SIGNIN_UNFINISHED_COPY.bell("Asha Rao")).toBe(
      "Asha Rao's password was used, but the sign-in wasn't finished.",
    );
    expect(SUPPRESSION_REASON_LABELS).toEqual({
      hard_bounce: "The address bounced",
      complaint: "Marked as spam",
      manual: "Stopped by hand",
    });
    expect(SUPPRESSION_REASON_OTHER).toBe("Emails stopped");
  });

  it("the designer placed the approved words where they exist (S1 from the dashboard, the house emails' button)", () => {
    expect(DIGEST_COPY.pipeline).toBe("Pipeline");
    expect(DIGEST_COPY.collected).toBe("Collected this month");
    expect(NOTIFICATION_COPY.button).toBe("Open in admin");
    expect(DIGEST_COPY.intro).toBe(
      "Pipeline, invoiced and collected, overdue invoices, new leads and upcoming reminders.",
    );
  });

  it("the four templates are known; only the digest is non-transactional", () => {
    for (const t of Object.keys(M72_TEMPLATE_NAMES)) expect(EMAIL_TEMPLATES).toContain(t);
    expect(NON_TRANSACTIONAL_TEMPLATES).toEqual(["digest.weekly"]);
  });
});
