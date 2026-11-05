// M7.2 the builder's four plain templates [ADM-MAIL-01; run file G, H, I "Templates"]: each renders from its fixture with its sender; the digest alone carries
// S2 and S3 (the non-transactional footer) and the switch-off link to the admin; the refund email names its credit note only when one exists; every variable is
// escaped. The designer finishes their look (section G); these pin the data contract.
import { describe, expect, it } from "vitest";
import { sampleData, TEMPLATE_NAMES } from "../src/fixtures.ts";
import { renderEmail } from "../src/index.ts";

const opts = { assetBase: "https://assets.example.test/brand/" };
const who = { name: "Asha Rao", role: "owner" };
const S2 = "Why you're receiving this: you're an owner of TecHaust admin and the weekly digest is on.";
const S3 = "Switch off the weekly digest";

describe("the M7.2 templates", () => {
  it("each renders from its fixture, with a Settings name and the right sender", () => {
    const senders = {
      "digest.weekly": "no-reply@techaust.com",
      "staff.notification": "no-reply@techaust.com",
      "refund.sent": "billing@techaust.com",
      "staff.signin_unfinished": "no-reply@techaust.com",
    } as const;
    for (const [t, from] of Object.entries(senders) as [keyof typeof senders, string][]) {
      const r = renderEmail(t, sampleData(t, who, "5 Nov 2026, 10:00 IST"), opts);
      expect(r.from.address, t).toBe(from);
      expect(r.subject.length, t).toBeGreaterThan(5);
      expect(r.html, t).toContain("<html");
      expect(TEMPLATE_NAMES[t], t).toBeTruthy();
    }
  });

  it("only the digest is non-transactional and carries S2 and S3 (the switch-off link to the admin)", () => {
    const d = renderEmail("digest.weekly", sampleData("digest.weekly", who, "x"), opts);
    expect(d.nonTransactional).toBe(true);
    expect(d.text).toContain(S2);
    expect(d.text).toContain(`${S3}: https://example.test/sample`);
    expect(d.subject).toBe("Your week at TecHaust: 2 Nov 2026");
    for (const t of ["staff.notification", "refund.sent", "staff.signin_unfinished"] as const) {
      const r = renderEmail(t, sampleData(t, who, "x"), opts);
      expect(r.nonTransactional, t).toBe(false);
      expect(r.text, t).not.toContain(S2);
      expect(r.text, t).not.toContain(S3);
    }
  });

  it("the refund email names the credit note only when one records the refund; values are escaped", () => {
    const base = sampleData("refund.sent", who, "x");
    expect(renderEmail("refund.sent", base, opts).text).toContain("TH/CN/2627/0001");
    expect(renderEmail("refund.sent", { ...base, credit_note_number: "" }, opts).text).not.toContain(
      "Credit note",
    );
    const html = renderEmail("refund.sent", { ...base, first_name: "<b>x</b>" }, opts).html;
    expect(html).not.toContain("<b>x</b>");
  });

  it("a staff notification's subject is the bell's title, header-safe", () => {
    const d = sampleData("staff.notification", who, "x");
    const r = renderEmail("staff.notification", { ...d, title: "Line one\r\nBcc: x@y.z" }, opts);
    expect(r.subject).not.toMatch(/[\r\n]/);
  });

  it("the unfinished sign-in email gives one instruction, the lead's advice, and no 07-G \"Not you?\" block for any role (review 1, finding 2)", () => {
    const advice =
      "If this wasn't you, someone else may know your password: ask an owner to reset it under Settings › Users (if you are the only owner, follow the break-glass steps in the security runbook). If it was you, for example a code page you closed, you can ignore this email.";
    for (const role of ["owner", "staff", "accountant"]) {
      const d = sampleData("staff.signin_unfinished", { name: "Asha Rao", role }, "5 Nov 2026, 10:00 IST");
      const r = renderEmail("staff.signin_unfinished", { ...d, role }, opts);
      expect(r.subject).toBe("Your TecHaust admin password was used");
      expect(r.text, role).toContain(advice);
      expect(r.text, role).not.toContain("Not you?");
      expect(r.html, role).not.toContain("Not you?");
      expect(r.text, role).not.toContain("change your password");
      expect(r.text, role).not.toContain("[Placeholder]");
    }
  });

  it("the staff lines are approved and placed unmarked; only the client's refund lines keep the mark", () => {
    for (const t of ["digest.weekly", "staff.notification", "staff.signin_unfinished"] as const) {
      const r = renderEmail(t, sampleData(t, who, "x"), opts);
      expect(`${r.subject}
${r.text}
${r.html}`, t).not.toContain("[Placeholder");
    }
    for (const name of Object.values(TEMPLATE_NAMES)) expect(name).not.toContain("[Placeholder");
    expect(renderEmail("refund.sent", sampleData("refund.sent", who, "x"), opts).subject).toMatch(/^\[Placeholder\] /);
  });
});
