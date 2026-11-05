// Every email template in one suite (ADM-MAIL-01; M7.2 run file G and I "Templates"): each `EMAIL_TEMPLATES` entry and its variants (the five reminder
// stages, the three two-step changes, both currencies of a document email) rendered from the shared fixtures (`@techaust/email/fixtures`, made-up data on
// example.test) to file snapshots of the HTML and the plain text, so a reviewer can open any of them. Then the rules every email keeps in real mail clients
// (`emailClientProblems`), and the non-transactional footer: the digest alone carries S2 and S3; no transactional email does.
import { EMAIL_TEMPLATES, type EmailTemplate } from "@techaust/core/email-templates";
import { describe, expect, it } from "vitest";
import { sampleData } from "../src/fixtures.ts";
import { renderEmail } from "../src/index.ts";
import { emailClientProblems } from "./client-problems.ts";

const OPTS = { assetBase: "https://assets.example.test/brand/" };
const WHO = { name: "Sample Owner", role: "owner" };
const TIME = "5 Nov 2026, 10:00 IST";
const S2 = "Why you're receiving this: you're an owner of TecHaust admin and the weekly digest is on.";
const S3 = "Switch off the weekly digest";

type Case = { name: string; template: EmailTemplate; data: Record<string, string> };

/** The variants: a template's own fixture, plus the shapes a template branches on. */
function cases(): Case[] {
  const out: Case[] = [];
  for (const t of EMAIL_TEMPLATES) {
    const base = sampleData(t, WHO, TIME);
    out.push({ name: t, template: t, data: base });
    if (t === "reminder.sent") {
      const stages: [string, string, string][] = [
        ["before", "before", "3"],
        ["on", "on", "0"],
        ["second", "after", "7"],
        ["final", "after", "14"],
      ];
      for (const [stage, when, offset] of stages)
        out.push({ name: `${t}.${stage}`, template: t, data: { ...base, when, offset_days: offset } });
    }
    if (t === "staff.2fa_change")
      for (const change of ["recovery_code_used", "reset_by_owner"])
        out.push({ name: `${t}.${change}`, template: t, data: { ...base, change } });
    if (t === "invoice.sent")
      out.push({
        name: `${t}.usd`,
        template: t,
        data: { ...base, total: "$1,200.00", balance: "$1,200.00", number: "TH/EXP/2627/0001" },
      });
    if (t === "staff.signin_unfinished")
      out.push({ name: `${t}.member`, template: t, data: { ...base, role: "staff" } });
    if (t === "refund.sent")
      out.push({ name: `${t}.no-note`, template: t, data: { ...base, credit_note_number: "" } });
  }
  return out;
}

const file = (name: string, ext: "html" | "txt") => `./__snapshots__/all/${name.replaceAll(".", "-")}.${ext}`;

describe("every email template (ADM-MAIL-01)", () => {
  const all = cases();

  it("has a fixture for every template (a template without one fails here)", () => {
    for (const t of EMAIL_TEMPLATES)
      expect(Object.keys(sampleData(t, WHO, TIME)).length, t).toBeGreaterThan(0);
    // 5 reminder stages (the fixture's "after" plus four), 3 two-step changes
    expect(all.filter((c) => c.template === "reminder.sent")).toHaveLength(5);
    expect(all.filter((c) => c.template === "staff.2fa_change")).toHaveLength(3);
  });

  for (const c of all) {
    it(`${c.name}: HTML and text snapshots, and the mail-client rules`, async () => {
      const r = renderEmail(c.template, c.data, OPTS);
      await expect(r.html).toMatchFileSnapshot(file(c.name, "html"));
      await expect(r.text).toMatchFileSnapshot(file(c.name, "txt"));
      expect(emailClientProblems(r.html, r.text), c.name).toEqual([]);
    });
  }

  it("only the weekly digest is non-transactional; it alone carries S2 and the S3 switch-off link, in the footer", () => {
    for (const c of all) {
      const r = renderEmail(c.template, c.data, OPTS);
      if (c.template === "digest.weekly") {
        expect(r.nonTransactional).toBe(true);
        const footer = r.html.slice(r.html.lastIndexOf('class="ln" style="border-top'));
        expect(footer).toContain("Why you&#39;re receiving this");
        expect(footer).toContain(`>${S3}</a>`);
        expect(r.text).toContain(S2);
        expect(r.text).toContain(`${S3}: `);
      } else {
        expect(r.nonTransactional, c.name).toBe(false);
        expect(r.text, c.name).not.toContain(S2);
        expect(r.text, c.name).not.toContain(S3);
      }
    }
  });

  it("a staff notification says its title once (subject and heading), with S4 in the footer", () => {
    const r = renderEmail("staff.notification", sampleData("staff.notification", WHO, TIME), OPTS);
    const title = "TH/PRP/2627/0001 was opened by the client";
    expect(r.subject).toBe(title);
    expect(r.html.split(title).length - 1).toBe(2); // the <title> and the heading
    const footer = r.html.slice(r.html.lastIndexOf('class="ln" style="border-top'));
    expect(footer).toContain("notification settings");
  });

  it("the digest sets one line per currency and keeps every figure as given", () => {
    const d = sampleData("digest.weekly", WHO, TIME);
    const r = renderEmail("digest.weekly", d, OPTS);
    expect(r.html).toContain("₹4,50,000.00");
    expect(r.html).toContain("$2,000.00");
    expect(r.text).toContain(`Pipeline: ${d.pipeline}`);
    expect(r.html).toContain("font-variant-numeric:tabular-nums");
  });
});
