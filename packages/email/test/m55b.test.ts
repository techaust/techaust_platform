// M5.5b emails: the owners' EDF reminder and the export realisation alert in its four stages (07-V §10, approved by the lead on 2026-10-28; no mark:
// ). The data is exactly core's `INVOICE_EMAIL_DATA` keys; values are pre-formatted by the jobs Worker. [ADM-REP-07, ADM-INV-17]
import { INVOICE_EMAIL_DATA } from "@techaust/core/invoice-email";
import { describe, expect, it } from "vitest";
import {
  isRealisationAlertStage,
  NO_REPLY_REPLY_TO,
  REALISATION_ALERT_STAGES,
  realisationSubject,
  renderEmail,
  SENDERS,
} from "../src/index.ts";

const opts = { assetBase: "https://assets.example.test/brand/" };
/** No line carries a placeholder mark any more (07-V approved by the lead on 2026-10-28). */
const M = "";

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

const edf = {
  owner_first_name: "Rupa",
  month_label: "October 2026",
  count: "3",
  due_date: "30 Nov 2026",
  link: "https://admin.example.test/reports/edf?month=2026-10",
};

const alert = (stage: string) => ({
  owner_first_name: "Rupa",
  stage,
  number: "TH/EXP/2627/0001",
  client: "Sample client B (fake)",
  currency: "USD",
  outstanding: "$1,000.00",
  due_date: "10 Oct 2026",
  link: "https://admin.example.test/reports/realisation?doc=SAMPLE",
});

describe("07-V is approved: no mark and no switch", () => {
  it("the emails carry no placeholder and no 'VERIFY WITH' note, in the subject, the text or the HTML", () => {
    const rendered = [renderEmail("edf.reminder", edf, opts)];
    for (const stage of REALISATION_ALERT_STAGES)
      rendered.push(renderEmail("realisation.alert", alert(stage), opts));
    for (const r of rendered)
      for (const part of [r.subject, r.text, r.html]) {
        expect(part).not.toContain("Placeholder");
        expect(part).not.toContain("VERIFY WITH");
        expect(part).not.toContain("refund date");
      }
  });
});

describe("edf.reminder [ADM-REP-07, Q55]", () => {
  it("07-V §10 word for word, from no-reply@ with replies to contact@, the button to the EDF list", () => {
    const r = renderEmail("edf.reminder", edf, opts);
    expect(r.from).toEqual(SENDERS.noReply);
    expect(r.replyTo).toBe(NO_REPLY_REPLY_TO);
    expect(r.subject).toBe(`${M}EDF list for October 2026: 3 export invoices`);
    expect(flat(r.text)).toContain(
      `${M}3 export invoices were issued in October 2026. The EDF list is ready for your bank, due by 30 Nov 2026.`,
    );
    expect(r.html).toContain(edf.link);
    expect(r.html).toContain('<strong style="font-weight:600;white-space:nowrap;">30 Nov 2026</strong>');
    // no greeting: 07-V §10 has none
    expect(r.text).not.toContain("Hi Rupa");
  });
});

describe("realisation.alert, four stages [ADM-INV-17, Q54]", () => {
  const sentences = {
    fema_approaching: ["FEMA date in 30 days", "Its FEMA realisation date is 10 Oct 2026."],
    fema_overdue: ["past the FEMA date", "Its FEMA realisation date was 10 Oct 2026."],
    gst_approaching: [
      "GST date in 30 days",
      "Its GST date (12 months and 15 days, Rule 96A) is 10 Oct 2026.",
    ],
    gst_overdue: ["past the GST date", "Its GST date (12 months and 15 days, Rule 96A) was 10 Oct 2026."],
  } as const;

  for (const stage of REALISATION_ALERT_STAGES) {
    it(`${stage}: its subject and stage sentence inside the 07-V body; the text twin says what the HTML says`, () => {
      const r = renderEmail("realisation.alert", alert(stage), opts);
      const [subject, sentence] = sentences[stage];
      expect(r.subject).toBe(`${M}TH/EXP/2627/0001: ${subject}`);
      expect(flat(r.text)).toContain(
        `${M}Export invoice TH/EXP/2627/0001 to Sample client B (fake) still shows $1,000.00 outstanding. ${sentence} If the payment has arrived, record it when payments are available; if your bank extended the date, keep its letter.`,
      );
      expect(r.text).toContain(`${M}Open export realisation`);
      const html = words(r.html);
      for (const p of r.text.split("\n\n").map(flat).filter(Boolean)) {
        const shown = p.includes(": https://") ? p.slice(0, p.indexOf(": https://")) : p;
        expect(html).toContain(shown);
      }
    });
  }

  it("an unknown stage is never guessed: just the number, no stage sentence", () => {
    expect(isRealisationAlertStage("ok")).toBe(false);
    const r = renderEmail("realisation.alert", alert("ok"), opts);
    expect(r.subject).toBe(`${M}TH/EXP/2627/0001`);
    expect(r.text).not.toContain("Its FEMA");
    expect(r.text).not.toContain("Its GST");
    expect(realisationSubject("gst_overdue", "N1")).toBe(`${M}N1: past the GST date`);
  });

  it("every value is escaped and a subject never carries a line break", () => {
    const keys = INVOICE_EMAIL_DATA["realisation.alert"];
    const hostile = Object.fromEntries(
      keys.map((k) => [k, k === "link" ? "https://admin.example.test/" : `<b>${k}</b>`]),
    );
    const r = renderEmail("realisation.alert", { ...hostile, stage: "fema_overdue" }, opts);
    expect(r.html).not.toMatch(/<b>[a-z_]+<\/b>/);
    const s = renderEmail(
      "realisation.alert",
      { ...alert("fema_overdue"), number: "TH/EXP\r\nBcc: x@example.test" },
      opts,
    );
    expect(s.subject).not.toMatch(/[\r\n]/);
  });
});
