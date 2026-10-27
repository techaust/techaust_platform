// M5.4 admin words and rules (lib/invoice-send.ts): the marks on 07-U lines, the email states, the reminder schedule, the errors, why a care draft
// wasn't issued, and the dialog's email preview, which must say what the real template says (the template is rendered here by path and compared).
import { describe, expect, it } from "vitest";
import { RequestError } from "../api.ts";
import {
  APPROVED_07U,
  CARE_COPY,
  documentWord,
  draftedBecause,
  hasReminders,
  previewBody,
  previewFacts,
  previewSubject,
  REMINDER_COPY,
  reminderActions,
  reminderDayLabel,
  reminderState,
  reminderStateText,
  SEND_COPY,
  sendErrorText,
  sendState,
  sendStateLabel,
  U,
} from "./invoice-send.ts";
import { blockerLine, blockerTarget, INV_PLACEHOLDER } from "./invoices.ts";
import { sendActionOf } from "./invoices-api.ts";

const M = `${INV_PLACEHOLDER} `;

describe("07-U is marked until the owner approves it", () => {
  it("every 07-U line carries [Placeholder]; approved lines don't", () => {
    expect(APPROVED_07U).toBe(false);
    expect(U("Send")).toBe("[Placeholder] Send");
    for (const line of [
      SEND_COPY.emailToClient,
      SEND_COPY.emailAgain,
      SEND_COPY.sendTo,
      SEND_COPY.attach,
      SEND_COPY.revoke,
      SEND_COPY.queued,
      REMINDER_COPY.heading,
      REMINDER_COPY.window,
      CARE_COPY.toggle,
      CARE_COPY.ownerOnly,
    ])
      expect(line.startsWith(M)).toBe(true);
    // the M4.5 dialog's approved words
    expect(SEND_COPY.chooseOne).toBe("Choose at least one contact.");
    expect(SEND_COPY.noPortal.startsWith(M)).toBe(false);
  });

  it("07-U §4 words with the document's own name", () => {
    expect(SEND_COPY.dialogTitle("tax_invoice", "TH/INV/2627/0007")).toBe(
      `${M}Email invoice TH/INV/2627/0007`,
    );
    expect(SEND_COPY.dialogTitle("proforma", "TH/PRO/2627/0001")).toBe(
      `${M}Email payment request TH/PRO/2627/0001`,
    );
    expect(SEND_COPY.sendTo).toBe(`${M}Send to (up to 5)`);
    expect(SEND_COPY.sent(1)).toBe(`${M}Sent to 1 contact.`);
    expect(SEND_COPY.sent(3)).toBe(`${M}Sent to 3 contacts.`);
    expect(SEND_COPY.locked("tax_invoice")).toBe(
      `${M}Emailed, so this invoice can no longer be voided. Corrections are made with a credit note or a debit note.`,
    );
    expect(SEND_COPY.revokeTitle("TH/INV/2627/0007")).toBe(`${M}Revoke every link to TH/INV/2627/0007?`);
    expect(documentWord("export_invoice")).toBe("invoice");
    expect(documentWord("credit_note")).toBe("credit note");
    expect(documentWord("debit_note")).toBe("debit note");
  });
});

describe("emails and their status [ADM-INV-15]", () => {
  it("maps the send row and the email log to 07-U §4's five statuses", () => {
    expect(sendState({ cancelledAt: 1, emailStatus: "sent" })).toBe("cancelled");
    expect(sendState({ cancelledAt: null, emailStatus: null })).toBe("queued");
    expect(sendState({ cancelledAt: null, emailStatus: "queued" })).toBe("queued");
    expect(sendState({ cancelledAt: null, emailStatus: "sending" })).toBe("queued");
    expect(sendState({ cancelledAt: null, emailStatus: "sent" })).toBe("sent");
    expect(sendState({ cancelledAt: null, emailStatus: "delivered" })).toBe("delivered");
    for (const s of ["failed", "bounced", "complained"])
      expect(sendState({ cancelledAt: null, emailStatus: s })).toBe("failed");
    expect(sendState({ cancelledAt: null, emailStatus: "skipped" })).toBe("cancelled");
    expect(sendStateLabel("delivered")).toBe(`${M}Delivered`);
  });

  it("reads actions.send beside the note actions, and tolerates an older API", () => {
    expect(sendActionOf({ actions: { credit: {}, send: { allowed: true, reasons: [] } } })).toEqual({
      allowed: true,
      reasons: [],
    });
    expect(sendActionOf({ actions: null })).toBeNull();
    expect(sendActionOf({})).toBeNull();
  });
});

describe("reminders [ADM-INV-13, Q47, Q48, Q50]", () => {
  const now = Date.UTC(2026, 10, 10, 6, 0);
  it("labels each day by its signed offset", () => {
    expect(reminderDayLabel(-3)).toBe(`${M}3 days before the due date`);
    expect(reminderDayLabel(0)).toBe(`${M}On the due date`);
    expect(reminderDayLabel(7)).toBe(`${M}7 days after the due date`);
    expect(reminderDayLabel(1)).toBe(`${M}1 day after the due date`);
  });

  it("says Sent, Due or Skipped with 07-U's reasons; a reason 07-U doesn't name is the plain placeholder", () => {
    const due = Date.UTC(2026, 10, 12, 3, 30); // 09:00 IST, 12 Nov
    expect(reminderStateText({ offset: 0, dueAt: due, sentAt: due, skippedReason: null })).toBe(
      `${M}Sent 12 Nov 2026`,
    );
    expect(reminderStateText({ offset: 0, dueAt: due, sentAt: null, skippedReason: null })).toBe(
      `${M}Due 12 Nov 2026`,
    );
    expect(reminderStateText({ offset: 3, dueAt: due, sentAt: null, skippedReason: "credited" })).toBe(
      `${M}Skipped: credited in full`,
    );
    expect(reminderStateText({ offset: 3, dueAt: due, sentAt: null, skippedReason: "no_recipient" })).toBe(
      `${M}Skipped: no contact with portal access`,
    );
    expect(reminderStateText({ offset: 3, dueAt: due, sentAt: null, skippedReason: "superseded" })).toBe(
      `${M}Skipped: ${INV_PLACEHOLDER}`,
    );
    expect(reminderState({ offset: 3, dueAt: due, sentAt: null, skippedReason: "paused" })).toBe("paused");
  });

  it("offers pause while one waits, resume while a paused one is still ahead (the server resumes only those)", () => {
    const past = now - 1;
    const ahead = now + 1;
    expect(reminderActions([{ offset: 0, dueAt: ahead, sentAt: null, skippedReason: null }], now)).toEqual({
      canPause: true,
      canResume: false,
    });
    expect(
      reminderActions(
        [
          { offset: -3, dueAt: past, sentAt: null, skippedReason: "paused" },
          { offset: 3, dueAt: ahead, sentAt: null, skippedReason: "paused" },
        ],
        now,
      ),
    ).toEqual({ canPause: false, canResume: true });
    expect(
      reminderActions([{ offset: -3, dueAt: past, sentAt: null, skippedReason: "paused" }], now).canResume,
    ).toBe(false);
  });

  it("only invoices, payment requests and debit notes have reminders (never a credit note)", () => {
    expect(hasReminders("tax_invoice")).toBe(true);
    expect(hasReminders("export_invoice")).toBe(true);
    expect(hasReminders("proforma")).toBe(true);
    expect(hasReminders("debit_note")).toBe(true);
    expect(hasReminders("credit_note")).toBe(false);
  });

  it("names each error by its code, 07-U first", () => {
    const e = (code: string) => new RequestError(409, code, "server words");
    expect(sendErrorText(e("reminders_not_started"), "proforma")).toBe(
      `${M}Reminders haven't started: email the payment request first.`,
    );
    expect(sendErrorText(e("invoice_void"), "tax_invoice")).toBe(
      `${M}This invoice is void, so it can't be emailed.`,
    );
    expect(sendErrorText(e("owner_only"), "tax_invoice")).toBe(`${M}Only an owner can do this.`);
    expect(sendErrorText(e("send_refused"), "tax_invoice")).toBe(
      `${M}This can't be sent right now. Reload the page and try again.`,
    );
  });
});

describe("care invoices [ADM-CARE-02, Q43]", () => {
  it("says why a draft wasn't issued by itself, every reason, joined with 'and'", () => {
    expect(draftedBecause([])).toBeNull();
    expect(draftedBecause(["toggle_off"])).toBe(
      `${M}Drafted, not issued automatically, because automatic issuing is off for this client.`,
    );
    expect(draftedBecause(["terms_not_owner", "usd_needs_fx", "blockers"])).toBe(
      `${M}Drafted, not issued automatically, because the plan's current price wasn't set by an owner, a US dollar invoice needs the exchange rate entered and the invoice has a missing field (see the checklist).`,
    );
    expect(draftedBecause(["something_new"])).toBe(
      `${M}Drafted, not issued automatically, because ${INV_PLACEHOLDER}.`,
    );
  });

  it("the switch's words", () => {
    expect(CARE_COPY.onBy("Sample Owner")).toBe(`${M}On, turned on by Sample Owner`);
    expect(CARE_COPY.notInEffect).toBe(`${INV_PLACEHOLDER} Not in effect`);
  });
});

describe("the blocker line of a placeholder line (early check finding 4)", () => {
  it("has its own marked line, not the bare placeholder, and leads to the line's description", () => {
    const line = blockerLine({ code: "line_text_placeholder", line: 2 }, "INR");
    expect(line).not.toBe(INV_PLACEHOLDER);
    expect(line).toBe(`${INV_PLACEHOLDER} Line 2: a line's wording isn't approved yet.`);
    expect(blockerTarget({ code: "line_text_placeholder", line: 2 }, "c1")).toEqual({
      kind: "line",
      n: 2,
      field: "description",
    });
  });
});

describe("the dialog's email preview says what the template says", () => {
  const view = {
    number: "TH/INV/2627/0007",
    issueDate: "2026-11-05",
    dueDate: "2026-11-12",
    totalMinor: 2_360_000,
    currency: "INR" as const,
  };

  for (const [type, template, parent] of [
    ["tax_invoice", "invoice.sent", null],
    ["proforma", "proforma.sent", null],
    ["credit_note", "credit_note.sent", "TH/INV/2627/0001"],
    ["debit_note", "debit_note.sent", "TH/INV/2627/0001"],
  ] as const) {
    for (const attached of [true, false]) {
      it(`${template}, ${attached ? "attached" : "link only"}`, async () => {
        const { renderEmail } = await import("../../../../packages/email/src/index.ts");
        const note = type === "credit_note" || type === "debit_note";
        const f = previewFacts({
          ...view,
          type,
          parentNumber: parent,
          reason: note ? { code: "price_correction", text: "rate typed wrong" } : null,
          parentBalanceMinor: type === "credit_note" ? 1_180_000 : null,
        });
        const body = previewBody(f, "Asha", attached);
        const r = renderEmail(
          template,
          {
            first_name: "Asha",
            number: f.number,
            issue_date: f.issueDate,
            due_date: f.dueDate,
            total: f.total,
            balance: type === "credit_note" ? "" : f.total,
            url: "https://portal.example.test/i#t=SAMPLE",
            attached: attached ? "1" : "",
            parent_number: parent ?? "",
            sender_name: "Sample",
            reason: f.reason,
            parent_balance: f.parentBalance,
          },
          { assetBase: "https://assets.example.test/brand/" },
        );
        expect(previewSubject(f)).toBe(r.subject);
        for (const p of body.paragraphs) expect(r.text).toContain(p);
        if (note) expect(body.paragraphs.join(" ")).toContain("Reason: Price correction: rate typed wrong.");
        if (type === "credit_note")
          expect(body.paragraphs.join(" ")).toContain("The amount due on the invoice is now ₹11,800.00.");
        expect(r.text).toContain(`${body.button}: https://portal.example.test/i#t=SAMPLE`);
        expect(r.text).toContain(body.closing);
        expect(`${r.from.name} <${r.from.address}>`).toBe("TecHaust Technologies <billing@techaust.com>");
      });
    }
  }
});
