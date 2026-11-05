// M7.2's screen rules (run file G2 to G5): the email log's status chips, record links and IST day filter, the stopped addresses in both send pickers, the
// Emails panels' new states, and every refusal worded from its code.
import { EMAIL_STATUS_LABELS } from "@techaust/core/copy-zq";
import { describe, expect, it } from "vitest";
import { RequestError } from "../api.ts";
import { sentenceStart, ZQ_ERRORS, ZQ_UI, zqErrorText } from "./copy-zq.ts";
import { emailRecordHref, emailStatusLook, isAddress, logCrumbs, sinceOf } from "./emails.ts";
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
      "recipient_invalid",
    ])
      expect(zqErrorText(new RequestError(409, code, "server words"))).toBe(ZQ_ERRORS[code]);
    expect(zqErrorText(new RequestError(403, "forbidden_x", ""))).toBe(ZQ_ERRORS.forbidden);
    expect(zqErrorText(new RequestError(500, "boom", "The server broke"))).toBe("The server broke.");
    expect(zqErrorText(new Error("x"))).toMatch(/Try again/);
  });

  it("starts a group name with a capital, keeping a draft's mark", () => {
    expect(sentenceStart("online payment")).toBe("Online payment");
    expect(sentenceStart("[Placeholder] online payment")).toBe("[Placeholder] Online payment");
  });

  it("counts the receipt sends", () => {
    expect(ZQ_UI.sendReceiptSent(1)).toBe("Receipt sent again to 1 contact.");
    expect(ZQ_UI.sendReceiptSent(3)).toBe("Receipt sent again to 3 contacts.");
  });
});
