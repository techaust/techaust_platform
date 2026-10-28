// M5.4 admin words and rules (lib/invoice-send.ts): the marks on 07-U lines, the email states, the reminder schedule, the errors, why a care draft
// wasn't issued, and the dialog's email preview, which must say what the real template says (the template is rendered here by path and compared).
import { describe, expect, it } from "vitest";
import { RequestError } from "../api.ts";
import {
  CARE_COPY,
  documentWord,
  draftedBecause,
  hasReminders,
  invoiceRecipientChoices,
  PLAN_BILLING_COPY,
  planAutoLines,
  previewBody,
  previewFacts,
  previewSubject,
  REMINDER_COPY,
  type ReminderRowView,
  reminderActions,
  reminderDayLabel,
  reminderState,
  reminderStateText,
  remindersOf,
  SEND_COPY,
  sendErrorText,
  sendState,
  sendStateLabel,
} from "./invoice-send.ts";
import { blockerLine, blockerTarget } from "./invoices.ts";
import { sendActionOf } from "./invoices-api.ts";

/** 07-U and 07-W were approved on 2026-10-28 (research and wording): no line carries a mark. */
const M = "";

describe("07-U is approved word for word", () => {
  it("no 07-U or 07-W line carries [Placeholder]", () => {
    for (const line of [
      SEND_COPY.emailToClient,
      SEND_COPY.emailAgain,
      SEND_COPY.sendTo,
      SEND_COPY.attach,
      SEND_COPY.revoke,
      SEND_COPY.queued,
      REMINDER_COPY.heading,
      REMINDER_COPY.window("09:00", "19:00"),
      CARE_COPY.toggle,
      CARE_COPY.ownerOnly,
    ])
      expect(line.includes("[Placeholder")).toBe(false);
    for (const line of [
      SEND_COPY.sendToHint,
      SEND_COPY.waitingForPdf,
      CARE_COPY.toggleHint,
      CARE_COPY.notInEffect,
    ])
      expect(line.includes("[Placeholder")).toBe(false);
    // 07-W §2 replaces 07-U §4's and §6's hints
    expect(SEND_COPY.sendToHint).toBe(
      'Only contacts with portal access and "Can see finance" turned on can receive invoices and notes.',
    );
    expect(CARE_COPY.toggleHint).toBe(
      "On the billing day, the invoice is issued and emailed to the client's billing contacts who have portal access and can see finance. Only an owner can turn this on; an owner or a staff member can turn it off.",
    );
    // the M4.5 dialog's approved words
    expect(SEND_COPY.chooseOne).toBe("Choose at least one contact.");
    expect(SEND_COPY.noPortal.includes("[Placeholder")).toBe(false);
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
      `${M}Skipped: superseded`,
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

describe("review round: who can receive a finance document [POR-03, H1]", () => {
  const c = (id: string, o: Partial<Parameters<typeof invoiceRecipientChoices>[0][number]> = {}) => ({
    id,
    portalAccess: true,
    canSeeFinance: true as boolean | undefined,
    isBilling: false,
    anonymisedAt: null as number | null,
    isPrimary: false,
    ...o,
  });
  it("a contact with portal access but no finance can't be chosen, says why, and isn't ticked", () => {
    const r = invoiceRecipientChoices([
      c("nofin", { isBilling: true, canSeeFinance: false }),
      c("bill", { isBilling: true }),
      c("noportal", { portalAccess: false, isBilling: true }),
      c("gone", { anonymisedAt: 1 }),
    ]);
    expect(r.choices.map((x) => [x.id, x.block])).toEqual([
      ["bill", null],
      ["nofin", "no_finance"],
      ["noportal", "no_portal"],
    ]);
    expect(r.ticked).toEqual(["bill"]);
  });
  it("the primary contact when no billing contact can receive it; nobody when the primary can't see finance", () => {
    expect(
      invoiceRecipientChoices([
        c("p", { isPrimary: true }),
        c("b", { isBilling: true, canSeeFinance: false }),
      ]).ticked,
    ).toEqual(["p"]);
    expect(invoiceRecipientChoices([c("p", { isPrimary: true, canSeeFinance: false })]).ticked).toEqual([]);
  });
  it("an older API without canSeeFinance reads as allowed (the server still checks)", () => {
    expect(invoiceRecipientChoices([c("a", { canSeeFinance: undefined, isBilling: true })]).ticked).toEqual([
      "a",
    ]);
  });
  it("the new lines are marked and the toggle hint names Owner and Staff", () => {
    for (const line of [
      SEND_COPY.sendToHint,
      SEND_COPY.noFinance,
      SEND_COPY.noneWithFinance,
      SEND_COPY.revokePauses,
      SEND_COPY.waitingForPdf,
    ])
      expect(line.startsWith(M)).toBe(true);
    expect(CARE_COPY.toggleHint).toContain("an owner or a staff member can turn it off");
    expect(CARE_COPY.toggleHint).not.toContain("anyone");
  });
});

describe("review round: reminders paused, missed and the window [M2, L2]", () => {
  const now = Date.UTC(2026, 10, 10, 6, 0);
  const row = (offset: number, dueAt: number, skippedReason: string | null) => ({
    offset,
    dueAt,
    sentAt: null,
    skippedReason,
  });
  it("a paused reminder whose day passed reads as missed while paused; the banner only while one is ahead", () => {
    const r = remindersOf(
      { started: true, paused: true, rows: [row(-3, now - 1, "paused"), row(0, now + 1, "paused")] },
      now,
    );
    expect(r.rows.map((x) => x.skippedReason)).toEqual(["missed_while_paused", "paused"]);
    expect(r.paused).toBe(true);
    // After Resume: the passed one stays missed, the banner goes (also from an older API that still says paused).
    const after = remindersOf(
      { started: true, paused: true, rows: [row(-3, now - 1, "paused"), row(0, now + 1, null)] },
      now,
    );
    expect(after.paused).toBe(false);
    expect(reminderStateText(after.rows[0] as ReminderRowView)).toBe(
      "Skipped: missed while reminders were paused",
    );
    expect(reminderState(after.rows[0] as ReminderRowView)).toBe("skipped");
    // The new API's own word reads the same.
    expect(
      remindersOf({ started: true, paused: false, rows: [row(-3, now - 1, "missed_while_paused")] }, now)
        .rows[0]?.skippedReason,
    ).toBe("missed_while_paused");
  });
  it("the window comes from the view, and is left out when an older API doesn't send it", () => {
    expect(
      remindersOf({ started: true, paused: false, rows: [], window: { from: "10:00", to: "18:30" } }, now)
        .window,
    ).toEqual({ from: "10:00", to: "18:30" });
    expect(remindersOf({ started: true, paused: false, rows: [] }, now).window).toBeNull();
    expect(REMINDER_COPY.window("10:00", "18:30")).toBe(`${M}Reminders go out between 10:00 and 18:30 IST.`);
    expect(remindersOf(undefined, now)).toEqual({ started: false, paused: false, rows: [], window: null });
  });
  it("a send not queued yet waits for the PDF [L1]", () => {
    expect(sendState({ cancelledAt: null, emailStatus: null, queuedAt: null })).toBe("waiting");
    expect(sendState({ cancelledAt: null, emailStatus: null, queuedAt: 5 })).toBe("queued");
    expect(sendState({ cancelledAt: 1, emailStatus: null, queuedAt: null })).toBe("cancelled");
    // re-check finding 1: the PDF is ready but the consumer hasn't queued the email yet (or an automatic send waits for the window)
    expect(sendState({ cancelledAt: null, emailStatus: null, queuedAt: null, pdfReady: true })).toBe(
      "queued",
    );
    expect(sendState({ cancelledAt: null, emailStatus: null, queuedAt: null, pdfReady: false })).toBe(
      "waiting",
    );
    expect(sendStateLabel("waiting")).toBe("Waiting for the PDF");
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
      `${M}Drafted, not issued automatically, because something_new.`,
    );
  });

  it("the switch's words", () => {
    expect(CARE_COPY.onBy("Sample Owner")).toBe(`${M}On, turned on by Sample Owner`);
    expect(CARE_COPY.onBy("Sample Owner", null)).toBe(`${M}On, turned on by Sample Owner`);
    // 2026-11-04 20:00 UTC is 05 Nov 2026 in IST: the date is the day in India
    expect(CARE_COPY.onBy("Sample Owner", Date.UTC(2026, 10, 4, 20, 0))).toBe(
      `${M}On, turned on by Sample Owner on 05 Nov 2026`,
    );
    expect(CARE_COPY.notInEffect).toBe("Not in effect");
  });
});

describe("the blocker line of a placeholder line (early check finding 4)", () => {
  it("has its own 07-W line and leads to the line's description", () => {
    const line = blockerLine({ code: "line_text_placeholder", line: 2 }, "INR");
    expect(line).toBe("Line 2: a line's wording isn't approved yet.");
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
        if (note) expect(body.paragraphs.join(" ")).toContain("Reason: Price correction (rate typed wrong).");
        if (type === "credit_note")
          expect(body.paragraphs.join(" ")).toContain("The amount due on the invoice is now ₹11,800.00.");
        expect(r.text).toContain(`${body.button}: https://portal.example.test/i#t=SAMPLE`);
        expect(r.text).toContain(body.closing);
        expect(`${r.from.name} <${r.from.address}>`).toBe("TecHaust Technologies <billing@techaust.com>");
      });
    }
  }
});

describe("the care plan's billing section [ADM-CARE-02, ADM-INV-12]", () => {
  it("every label is 07-W §2's, unmarked", () => {
    for (const line of Object.values(PLAN_BILLING_COPY)) expect(line.includes("[Placeholder")).toBe(false);
    expect(PLAN_BILLING_COPY.heading).toBe("Billing");
    expect(PLAN_BILLING_COPY.openDraft).toBe("Open the draft");
  });

  it("no auto part without a draft not yet issued", () => {
    expect(planAutoLines(null)).toBeNull();
  });

  it("not eligible: 07-U's reasons, and the pointer to the draft's own checklist", () => {
    const l = planAutoLines({
      eligible: false,
      reasons: ["toggle_off", "overage_present"],
      blockersChecked: false,
    });
    expect(l?.tone).toBe("pending");
    expect(l?.text).toBe(draftedBecause(["toggle_off", "overage_present"]));
    expect(l?.pointer).toBe(PLAN_BILLING_COPY.checkDraft);
  });

  it("eligible: never says the draft is ready (blockers are not checked here), and still points to the draft", () => {
    const l = planAutoLines({ eligible: true, reasons: [], blockersChecked: false });
    expect(l?.tone).toBe("info");
    expect(l?.text).toBe(PLAN_BILLING_COPY.autoAllowed);
    expect(l?.text).not.toMatch(/ready|will be issued/i);
    expect(l?.pointer).toBe(PLAN_BILLING_COPY.checkDraft);
  });
});
