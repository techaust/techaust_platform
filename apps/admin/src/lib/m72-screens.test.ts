// M7.2's screen rules (run file G2 to G5): the email log's status chips, record links and IST day filter, the stopped addresses in both send pickers, the
// Emails panels' new states, and every refusal worded from its code.
import { DIGEST_LABEL, EMAIL_STATUS_LABELS, PREF_GROUP_LABELS } from "@techaust/core/copy-zq";
import { SUPPRESSION_REASON_LABELS, SUPPRESSION_REASON_OTHER } from "@techaust/core/email-events";
import { EMAIL_TEMPLATES } from "@techaust/core/email-templates";
import { TEMPLATE_NAMES } from "@techaust/email/fixtures";
import { describe, expect, it } from "vitest";
import { RequestError } from "../api.ts";
import { ACTION_LABELS } from "./audit.ts";
import { sentenceStart, ZQ_ERRORS, ZQ_UI, zqErrorText } from "./copy-zq.ts";
import {
  emailRecordHref,
  emailStatusLook,
  isAddress,
  logCrumbs,
  receiptResendable,
  sentShown,
  sinceOf,
} from "./emails.ts";
import { invoiceRecipientChoices } from "./invoice-send.ts";
import { recipientChoices } from "./offers.ts";

const contact = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  portalAccess: true,
  canSeeFinance: true,
  isBilling: true,
  isPrimary: false,
  anonymisedAt: null,
  ...o,
});
const STOPPED = { suppression: { reason: "hard_bounce", label: "The address bounced", at: 1 } };

describe("the email log", () => {
  it("gives every S12 status a chip with an icon, the refusals in red", () => {
    for (const s of Object.keys(EMAIL_STATUS_LABELS)) expect(emailStatusLook(s).icon).toBeTruthy();
    expect(emailStatusLook("delivered").tone).toBe("success");
    for (const s of ["bounced", "complained", "failed"]) expect(emailStatusLook(s).tone).toBe("danger");
    expect(emailStatusLook("skipped").tone).toBe("muted");
    expect(emailStatusLook("anything else").tone).toBe("muted");
  });

  it("shows a send time only once the email left: 'Queued' before, nothing for one that never left (review 1, finding 15)", () => {
    for (const s of ["sent", "delivered", "bounced", "complained"]) expect(sentShown(s), s).toBe("time");
    for (const s of ["queued", "sending"]) expect(sentShown(s), s).toBe("queued");
    for (const s of ["failed", "skipped", "anything else"]) expect(sentShown(s), s).toBe("none");
    // the lists above name every S12 status, so a new status is a choice made here
    expect(Object.keys(EMAIL_STATUS_LABELS).sort()).toEqual(
      ["sent", "delivered", "bounced", "complained", "queued", "sending", "failed", "skipped"].sort(),
    );
  });

  it("offers Send receipt again only on an issued, numbered receipt whose payment wasn't refunded in full, to a role that sends (finding 5)", () => {
    const issued = { status: "issued", number: "TH/RCT/2627/0001" };
    expect(receiptResendable(issued, true)).toBe(true);
    expect(receiptResendable({ ...issued, refundedInFull: false }, true)).toBe(true);
    expect(receiptResendable({ ...issued, refundedInFull: true }, true)).toBe(false);
    expect(receiptResendable(issued, false)).toBe(false);
    expect(receiptResendable({ ...issued, status: "void" }, true)).toBe(false);
    expect(receiptResendable({ ...issued, number: null }, true)).toBe(false);
    expect(receiptResendable(null, true)).toBe(false);
    expect(zqErrorText(new RequestError(409, "receipt_refunded", "server words"))).toBe(
      "This payment was refunded in full, so its receipt can't be sent again.",
    );
  });

  it("links an approval and an offer's document, nothing else", () => {
    expect(emailRecordHref("approval.requested", { type: "approval", id: "a/1" })).toBe("/approvals/a%2F1");
    expect(emailRecordHref("offer.sent", { type: "document", id: "d1" })).toBe("/documents/d1");
    expect(emailRecordHref("invoice.sent", { type: "document", id: "d1" })).toBeNull();
    expect(emailRecordHref("reminder.sent", { type: "reminder", id: "r1" })).toBeNull();
    expect(emailRecordHref("offer.sent", { type: "document", id: "" })).toBeNull();
  });

  it("starts 'Sent on or after' at IST midnight and takes only full addresses", () => {
    // 5 Nov 2026 00:00 IST = 4 Nov 2026 18:30 UTC
    expect(sinceOf("2026-11-05")).toBe(String(Date.UTC(2026, 10, 4, 18, 30)));
    expect(sinceOf("")).toBe("");
    expect(sinceOf("05/11/2026")).toBe("");
    expect(isAddress(" name@example.com ")).toBe(true);
    for (const bad of ["name", "name@", "@example.com", "a b@example.com", "name@example"])
      expect(isAddress(bad), bad).toBe(false);
  });

  it("shows Settings › Email in the breadcrumbs only to a role that can open them", () => {
    expect(logCrumbs(true).map((c) => c.label)).toEqual(["Settings", "Email"]);
    expect(logCrumbs(false)).toEqual([]);
  });
});

describe("the send pickers (G4)", () => {
  it("lists a stopped address after those who can receive it, never ticked", () => {
    const r = invoiceRecipientChoices([
      contact("s", STOPPED),
      contact("ok"),
      contact("np", { portalAccess: false }),
    ]);
    expect(r.choices.map((c) => [c.id, c.block])).toEqual([
      ["ok", null],
      ["s", "stopped"],
      ["np", "no_portal"],
    ]);
    expect(r.ticked).toEqual(["ok"]);
  });

  it("the offer picker never ticks a stopped address, not even the draft's own contact", () => {
    const r = recipientChoices(
      [contact("s", STOPPED), contact("ok", { isBilling: false, isPrimary: true })],
      "s",
    );
    expect(r.ticked).toEqual(["ok"]);
    expect(r.choices.map((c) => c.id)).toEqual(["ok", "s"]);
  });
});

describe("the words", () => {
  it("words every refusal of the M7.2 routes from its code", () => {
    for (const code of [
      "stale_version",
      "digest_owner_only",
      "not_suppressed",
      "client_anonymised",
      "receipt_void",
      "receipt_refunded",
      "recipient_invalid",
    ])
      expect(zqErrorText(new RequestError(409, code, "server words"))).toBe(ZQ_ERRORS[code]);
    expect(zqErrorText(new RequestError(403, "forbidden_x", ""))).toBe(ZQ_ERRORS.forbidden);
    expect(zqErrorText(new RequestError(500, "boom", "The server broke"))).toBe("The server broke.");
    expect(zqErrorText(new Error("x"))).toMatch(/Try again/);
  });

  it("starts a group name with a capital", () => {
    expect(sentenceStart("online payment")).toBe("Online payment");
  });

  it("shows every lead-approved staff line unmarked: S6 names, S12 statuses, S13 reasons, the template names, the audit lines (review 1, finding 3)", () => {
    const shown: string[] = [
      ...Object.values(PREF_GROUP_LABELS),
      DIGEST_LABEL,
      ...Object.values(EMAIL_STATUS_LABELS),
      ...Object.values(SUPPRESSION_REASON_LABELS),
      SUPPRESSION_REASON_OTHER,
      ...EMAIL_TEMPLATES.map((t) => TEMPLATE_NAMES[t]),
      ...[
        "notification.prefs",
        "notification.unsubscribe",
        "email.unsuppress",
        "contact.unsuppress",
        "receipt.send",
      ].map((a) => ACTION_LABELS[a] ?? ""),
      ...Object.values(ZQ_UI as Record<string, unknown>).filter((v): v is string => typeof v === "string"),
      ...Object.values(ZQ_UI.prefsHint),
      ...Object.values(ZQ_ERRORS),
    ];
    for (const line of shown) {
      expect(line.length, "a line is missing").toBeGreaterThan(0);
      expect(line, line).not.toContain("[Placeholder");
    }
  });

  it("counts the receipt sends", () => {
    expect(ZQ_UI.sendReceiptSent(1)).toBe("Receipt sent again to 1 contact.");
    expect(ZQ_UI.sendReceiptSent(3)).toBe("Receipt sent again to 3 contacts.");
  });
});
