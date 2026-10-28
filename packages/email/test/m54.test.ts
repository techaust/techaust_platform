// M5.4 emails: the four client document emails (attached and link only), the payment reminder (invoice, payment request and debit note, every stage),
// and the three staff alerts. Words: 07-U (approved by the lead on 2026-10-28; no placeholder mark), 07 §8 and 07-T §2 subjects
// (approved, unmarked), 07-S §5 (the LUT email). The data is exactly core's `INVOICE_EMAIL_DATA`.
import { EMAIL_TEMPLATES } from "@techaust/core/email-templates";
import { INVOICE_EMAIL_DATA } from "@techaust/core/invoice-email";
import { describe, expect, it } from "vitest";
import { NO_REPLY_REPLY_TO, reminderStage, renderEmail, SENDERS } from "../src/index.ts";

const opts = { assetBase: "https://assets.example.test/brand/" };
/** No line carries a placeholder mark any more (07-U approved by the lead on 2026-10-28): kept as the empty prefix the expectations below were written with. */
const M = "";

const doc = {
  first_name: "Asha",
  number: "TH/INV/2627/0007",
  issue_date: "5 Nov 2026",
  due_date: "12 Nov 2026",
  total: "₹23,600.00",
  balance: "₹23,600.00",
  url: "https://portal.example.test/i#t=SAMPLE",
  attached: "1",
  parent_number: "",
  sender_name: "Sample Owner",
  reason: "",
  parent_balance: "",
};

/** The words of the HTML body, tags and entities out, spaces collapsed (to compare with the text twin). */
const words = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?strong[^>]*>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("07-U is approved: no placeholder mark and no switch", () => {
  it("the document email and the reminder render without a placeholder or a 'VERIFY WITH' note in their subject, text or HTML (the other emails' tests below say the same words exactly)", () => {
    const rendered = [
      renderEmail("invoice.sent", doc, opts),
      renderEmail(
        "reminder.sent",
        { ...doc, attached: "", kind: "invoice", when: "due", offset_days: "0" },
        opts,
      ),
    ];
    for (const r of rendered)
      for (const part of [r.subject, r.text, r.html]) {
        expect(part).not.toContain("Placeholder");
        expect(part).not.toContain("VERIFY WITH");
      }
  });
});

describe("invoice.sent and the other document emails [ADM-INV-15, POR-06]", () => {
  it("an invoice: the 07 §8 subject (approved), the 07-U body marked, View invoice, the attached sentence; from billing@, replies to billing@", () => {
    const r = renderEmail("invoice.sent", doc, opts);
    expect(r.from).toEqual(SENDERS.billing);
    expect(r.from.address).toBe("billing@techaust.com");
    expect(r.replyTo).toBe("billing@techaust.com");
    expect(r.subject).toBe("Invoice TH/INV/2627/0007 from TecHaust Technologies: ₹23,600.00 due 12 Nov 2026");
    expect(r.text).toContain(
      `${M}Hi Asha, please find invoice TH/INV/2627/0007 for ₹23,600.00, issued on 5 Nov 2026 and due on 12 Nov 2026. You can pay by bank transfer; the bank details are on the invoice.`,
    );
    expect(r.text).toContain(`${M}View invoice: https://portal.example.test/i#t=SAMPLE`);
    expect(r.text).toContain(`${M}The invoice is attached as a PDF, and it's also in your client portal.`);
    // the closing sentence ends the body (07-U §1), the button comes under it ("with the button below")
    expect(r.text.indexOf("is attached as a PDF")).toBeLessThan(r.text.indexOf("View invoice:"));
    expect(r.html).toContain('href="https://portal.example.test/i#t=SAMPLE"');
    // the number and the amount are bold in HTML (presentation only)
    expect(r.html).toContain('<strong style="font-weight:600;white-space:nowrap;">₹23,600.00</strong>');
  });

  it("link only: the other closing sentence", () => {
    const r = renderEmail("invoice.sent", { ...doc, attached: "" }, opts);
    expect(r.text).toContain(
      `${M}You can view and download it with the button below or in your client portal.`,
    );
    expect(r.text).not.toContain("attached as a PDF");
  });

  it("a payment request (proforma): the 07 §8 subject, the 07-U body, View payment request", () => {
    const r = renderEmail("proforma.sent", { ...doc, number: "TH/PRO/2627/0002", attached: "" }, opts);
    expect(r.from).toEqual(SENDERS.billing);
    expect(r.subject).toBe("Payment request TH/PRO/2627/0002: ₹23,600.00");
    expect(r.text).toContain(
      `${M}Hi Asha, please find payment request TH/PRO/2627/0002 for ₹23,600.00, valid until 12 Nov 2026. You can pay by bank transfer; the bank details are on the payment request. A tax invoice will be issued when payment is received.`,
    );
    expect(r.text).toContain(`${M}View payment request: `);
    const attached = renderEmail("proforma.sent", { ...doc, attached: "1" }, opts);
    expect(attached.text).toContain(
      `${M}The payment request is attached as a PDF, and it's also in your client portal.`,
    );
  });

  it("a credit note: the 07-T §2 subject, the reason and the invoice's new balance (07-U §1)", () => {
    const r = renderEmail(
      "credit_note.sent",
      {
        ...doc,
        number: "TH/CN/2627/0001",
        due_date: "",
        balance: "",
        parent_number: "TH/INV/2627/0007",
        reason: "Price correction: rate typed wrong",
        parent_balance: "₹11,800.00",
      },
      opts,
    );
    expect(r.subject).toBe("Credit note TH/CN/2627/0001 for invoice TH/INV/2627/0007");
    expect(r.text).toContain(
      `${M}Hi Asha, we've issued credit note TH/CN/2627/0001 for ₹23,600.00 against invoice TH/INV/2627/0007.`,
    );
    expect(r.text).toContain(`${M}Reason: Price correction: rate typed wrong.`);
    expect(r.text).toContain(`${M}The amount due on the invoice is now ₹11,800.00.`);
    expect(r.html).toContain("Reason: Price correction: rate typed wrong.");
    expect(r.text).toContain(`${M}View credit note: `);
    expect(r.text).toContain(`${M}The credit note is attached as a PDF`);
    // the order of 07-U §1: opening, reason, new balance, closing
    const at = (t: string) => r.text.indexOf(t);
    expect(at("we've issued")).toBeLessThan(at("Reason:"));
    expect(at("Reason:")).toBeLessThan(at("The amount due"));
    expect(at("The amount due")).toBeLessThan(at("The credit note is attached"));
  });

  it("a credit note queued without the two values (an older message): those sentences are left out, never guessed", () => {
    const r = renderEmail(
      "credit_note.sent",
      { ...doc, number: "TH/CN/2627/0001", balance: "", parent_number: "TH/INV/2627/0007" },
      opts,
    );
    expect(r.text).not.toContain("Reason:");
    expect(r.text).not.toContain("The amount due on the invoice is now");
  });

  it("a reason that ends with its own full stop is not doubled", () => {
    const r = renderEmail(
      "credit_note.sent",
      { ...doc, parent_number: "TH/INV/2627/0007", reason: "Discount agreed on the call." },
      opts,
    );
    expect(r.text).toMatch(/Reason: Discount agreed on the call\.$/m);
    expect(r.text).not.toContain("call..");
  });

  it("a debit note: the reason, then its own amount and due date (Q63), not the invoice's balance", () => {
    const r = renderEmail(
      "debit_note.sent",
      {
        ...doc,
        number: "TH/DN/2627/0001",
        total: "₹1,180.00",
        parent_number: "TH/INV/2627/0007",
        attached: "",
        reason: "Price correction",
      },
      opts,
    );
    expect(r.subject).toBe("Debit note TH/DN/2627/0001 for invoice TH/INV/2627/0007");
    expect(r.text).toContain(
      `${M}Hi Asha, we've issued debit note TH/DN/2627/0001 for ₹1,180.00 against invoice TH/INV/2627/0007, because the invoice amount needed correcting upwards.`,
    );
    expect(r.text).toContain(`${M}Reason: Price correction.`);
    expect(r.text).toContain(`${M}Please pay ₹1,180.00 by 12 Nov 2026.`);
    expect(r.text.indexOf("Reason:")).toBeLessThan(r.text.indexOf("Please pay"));
    expect(r.text).not.toContain("The amount due on the invoice is now");
    expect(r.text).toContain(`${M}View debit note: `);
  });

  it("no first name: 'Hi, ' rather than 'Hi , '", () => {
    const r = renderEmail("invoice.sent", { ...doc, first_name: "" }, opts);
    expect(r.text).toContain(`${M}Hi, please find invoice`);
  });
});

describe("reminder.sent [ADM-INV-13, Q47, Q48, Q50]", () => {
  const rem = (kind: string, when: string, offset: string) =>
    renderEmail("reminder.sent", { ...doc, attached: "", kind, when, offset_days: offset }, opts);

  it("the stage follows the table's default days; other days take the nearest row at or below", () => {
    expect(reminderStage("before", 3)).toBe("before");
    expect(reminderStage("before", 10)).toBe("before");
    expect(reminderStage("on", 0)).toBe("on");
    expect(reminderStage("after", 1)).toBe("after");
    expect(reminderStage("after", 3)).toBe("after");
    expect(reminderStage("after", 6)).toBe("after");
    expect(reminderStage("after", 7)).toBe("second");
    expect(reminderStage("after", 13)).toBe("second");
    expect(reminderStage("after", 14)).toBe("final");
    expect(reminderStage("after", 30)).toBe("final");
    expect(reminderStage("nonsense", 3)).toBe("on");
  });

  it("an invoice at every default day: the 07 §8 subjects unmarked, the 07-U bodies marked, link only, the 'already paid' line", () => {
    const before = rem("invoice", "before", "3");
    expect(before.subject).toBe("Invoice TH/INV/2627/0007 is due on 12 Nov 2026");
    expect(before.text).toContain(
      `${M}Hi Asha, a friendly reminder that invoice TH/INV/2627/0007 (₹23,600.00) is due in 3 days, on 12 Nov 2026.`,
    );
    const on = rem("invoice", "on", "0");
    expect(on.subject).toBe("Invoice TH/INV/2627/0007 is due today");
    expect(on.text).toContain(
      `${M}Hi Asha, a friendly reminder that invoice TH/INV/2627/0007 (₹23,600.00) is due today.`,
    );
    const after = rem("invoice", "after", "3");
    expect(after.subject).toBe("Invoice TH/INV/2627/0007 is now overdue");
    expect(after.text).toContain(
      `${M}Hi Asha, invoice TH/INV/2627/0007 was due on 12 Nov 2026 and shows ₹23,600.00 outstanding. If there's a problem with the invoice, reply to this email and we'll sort it out.`,
    );
    const second = rem("invoice", "after", "7");
    expect(second.subject).toBe("Second reminder: invoice TH/INV/2627/0007");
    expect(second.text).toContain(
      `${M}Hi Asha, invoice TH/INV/2627/0007 was due on 12 Nov 2026 and ₹23,600.00 is still outstanding. Could you let us know when we can expect payment? If it would help to talk it through, reply and we'll arrange a call.`,
    );
    const final = rem("invoice", "after", "14");
    expect(final.subject).toBe("Action needed: invoice TH/INV/2627/0007 is 14 days overdue");
    expect(final.text).toContain(
      "You can also contact Rupak Sarkar, the owner, directly at contact@techaust.com.",
    );
    for (const r of [before, on, after, second, final]) {
      expect(r.from).toEqual(SENDERS.billing);
      expect(r.replyTo).toBe("billing@techaust.com");
      expect(r.text).toContain(`${M}View invoice: `);
      expect(r.text).toContain(
        `${M}You can view and download it with the button below or in your client portal.`,
      );
      // 07 §8: approved, no mark; it is the last paragraph
      expect(r.text).toContain("\n\nIf you've already paid, thank you, and please ignore this.\n\n");
      expect(r.text).not.toContain("attached as a PDF");
    }
  });

  it("a payment request: 'payment request' everywhere, 'was requested by' after the date, the subjects marked (07-U only)", () => {
    const before = rem("proforma", "before", "3");
    expect(before.subject).toBe(`${M}Payment request TH/INV/2627/0007 is due on 12 Nov 2026`);
    expect(before.text).toContain("a friendly reminder that payment request TH/INV/2627/0007");
    expect(before.text).toContain(`${M}View payment request: `);
    const after = rem("proforma", "after", "3");
    expect(after.text).toContain(
      `${M}Hi Asha, payment request TH/INV/2627/0007 was requested by 12 Nov 2026 and shows ₹23,600.00 outstanding. If there's a problem with the payment request, reply to this email and we'll sort it out.`,
    );
    expect(rem("proforma", "after", "7").text).toContain(
      "was requested by 12 Nov 2026 and ₹23,600.00 is still",
    );
    expect(rem("proforma", "after", "14").subject).toBe(
      `${M}Action needed: payment request TH/INV/2627/0007 is 14 days overdue`,
    );
    // "is due" stays on the two before and on the date (07-U: only the bodies after the date change)
    expect(rem("proforma", "on", "0").text).toContain(
      "payment request TH/INV/2627/0007 (₹23,600.00) is due today.",
    );
  });

  it("a debit note: 'debit note' everywhere, otherwise the invoice's words", () => {
    const r = rem("debit_note", "after", "7");
    expect(r.subject).toBe(`${M}Second reminder: debit note TH/INV/2627/0007`);
    expect(r.text).toContain("Hi Asha, debit note TH/INV/2627/0007 was due on 12 Nov 2026 and");
    expect(r.text).toContain(`${M}View debit note: `);
  });

  it("a client's own days: the number of days is the data's, with 1 day singular", () => {
    expect(rem("invoice", "before", "1").text).toContain("is due in 1 day, on 12 Nov 2026.");
    expect(rem("invoice", "after", "30").subject).toBe(
      "Action needed: invoice TH/INV/2627/0007 is 30 days overdue",
    );
  });
});

describe("the staff alerts, to the owners from no-reply@ [ADM-INV-19, ADM-INV-10, ADM-INV-18]", () => {
  const alert = {
    owner_first_name: "Rupa",
    client_name: "Kestrel Distributors (sample)",
    admin_url: "https://admin.example.test/projects/prj_sample",
    milestone_title: "Phase 1 delivery",
    delivered_date: "1 Oct 2026",
    days_since: "25",
  };

  it("alert.unbilled", () => {
    const r = renderEmail("alert.unbilled", alert, opts);
    expect(r.from).toEqual(SENDERS.noReply);
    expect(r.replyTo).toBe(NO_REPLY_REPLY_TO);
    expect(r.subject).toBe(`${M}Not invoiced yet: Phase 1 delivery for Kestrel Distributors (sample)`);
    expect(r.text).toContain(
      `${M}Hi Rupa, Phase 1 delivery for Kestrel Distributors (sample) was delivered on 1 Oct 2026, 25 days ago, and has no invoice yet.`,
    );
    expect(r.text).toContain("Open in admin: https://admin.example.test/projects/prj_sample");
  });

  it("alert.proforma_due", () => {
    const r = renderEmail(
      "alert.proforma_due",
      { ...alert, proforma_number: "TH/PRO/2627/0002", balance: "₹11,800.00" },
      opts,
    );
    expect(r.from).toEqual(SENDERS.noReply);
    expect(r.subject).toBe(`${M}Payment request TH/PRO/2627/0002 still unpaid after delivery`);
    expect(r.text).toContain(
      `${M}Hi Rupa, Phase 1 delivery for Kestrel Distributors (sample) was delivered on 1 Oct 2026, 25 days ago, and payment request TH/PRO/2627/0002 still shows ₹11,800.00 unpaid. A tax invoice is due within 30 days of delivery even if payment hasn't arrived.`,
    );
  });

  it("lut.reminder: next year's letter due (07-S §5) and the running year without one (07-U §8)", () => {
    const due = renderEmail(
      "lut.reminder",
      {
        owner_first_name: "Rupa",
        fy_label: "2027-28",
        state: "next_fy_due",
        admin_url: "https://admin.example.test/settings/tax",
      },
      opts,
    );
    expect(due.from).toEqual(SENDERS.noReply);
    expect(due.subject).toBe("File the LUT for FY 2027-28");
    expect(due.text).toContain(
      "Export invoices without IGST from 1 April need a letter of undertaking for FY 2027-28. File it on the GST portal (Services, User Services, Furnish Letter of Undertaking) and save the ARN in Settings › Tax. We'll remind you each week until it's saved.",
    );
    expect(due.text).not.toContain("Placeholder");
    const missing = renderEmail(
      "lut.reminder",
      {
        owner_first_name: "Rupa",
        fy_label: "2026-27",
        state: "current_missing",
        admin_url: "https://admin.example.test/settings/tax",
      },
      opts,
    );
    expect(missing.subject).toBe(`${M}No LUT saved for FY 2026-27`);
    expect(missing.text).toContain(
      `${M}Hi Rupa, there's no letter of undertaking saved for FY 2026-27, so export invoices without IGST are blocked.`,
    );
  });
});

describe("every M5.4 template, with exactly the data the jobs Worker queues", () => {
  const sample: Record<string, string> = {
    ...doc,
    offset_days: "3",
    when: "after",
    kind: "invoice",
    owner_first_name: "Rupa",
    client_name: "Sample client",
    admin_url: "https://admin.example.test/",
    milestone_title: "Sample milestone",
    delivered_date: "1 Oct 2026",
    days_since: "25",
    proforma_number: "TH/PRO/2627/0002",
    reason: "Price correction",
    parent_balance: "₹11,800.00",
    fy_label: "2027-28",
    state: "next_fy_due",
    // M5.5b (added on purpose, the two stubs of LD88): the keys of `edf.reminder` and `realisation.alert`
    month_label: "October 2026",
    count: "3",
    due_date: "30 Nov 2026",
    link: "https://admin.example.test/reports/edf",
    stage: "fema_approaching",
    number: "TH/EXP/2627/0001",
    client: "Sample client",
    currency: "USD",
    outstanding: "$1,000.00",
  };

  for (const [template, keys] of Object.entries(INVOICE_EMAIL_DATA)) {
    it(`${template}: renders, every value escaped, the text twin says what the HTML says`, () => {
      const data = Object.fromEntries(keys.map((k) => [k, sample[k] ?? ""]));
      const r = renderEmail(template, data, opts);
      expect(EMAIL_TEMPLATES).toContain(template);
      expect(r.text).not.toContain("undefined");
      expect(r.html).not.toContain("undefined");
      expect(
        r.text.endsWith("TecHaust Technologies · Balurghat, West Bengal, India · contact@techaust.com\n"),
      ).toBe(true);
      // every paragraph of the text (bar the button lines, which print the address) is in the HTML's words
      const html = words(r.html);
      for (const p of r.text.split("\n\n").map(flat).filter(Boolean)) {
        const shown = p.includes(": https://") ? p.slice(0, p.indexOf(": https://")) : p;
        expect(html, `${template}: ${shown}`).toContain(shown);
      }
      // a value with markup is escaped
      const hostile = Object.fromEntries(
        keys.map((k) => [k, k === "url" || k === "admin_url" ? (sample[k] ?? "") : `<b>${k}</b>`]),
      );
      const h = renderEmail(template, hostile, opts);
      expect(h.html).not.toMatch(/<b>[a-z_]+<\/b>/);
    });
  }

  it("a subject never carries a line break from the data", () => {
    const r = renderEmail("invoice.sent", { ...doc, number: "TH/INV\r\nBcc: x@example.test" }, opts);
    expect(r.subject).not.toMatch(/[\r\n]/);
  });
});
