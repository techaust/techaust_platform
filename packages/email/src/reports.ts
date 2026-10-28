// M5.5b: the two owner emails of the reports (ADM-REP-07, ADM-INV-17; Q54, Q55, LD67, LD76): the monthly EDF reminder and the export realisation alert
// (four stages: the FEMA date in 30 days or past, the GST date in 30 days or past), in the brand layout of every staff alert (the subject as the heading,
// the sentences, the 48 px verdigris button with the plain address under it, light and dark), each with its plain-text twin saying the same words.
//
// Words: docs/07-content-appendix/V-m5.5b-reports-statements.md §10 (07-V), word for word, approved by the lead on 2026-10-28 (the FEMA and GST lines: Researched 2026-10-28,
// 08-C RB-01, RB-03, RB-04, RA-20). 07-V §10 has no greeting, so none is added.
//
// The data is exactly `INVOICE_EMAIL_DATA["edf.reminder"]` and `["realisation.alert"]` (@techaust/core/invoice-email): every value a string, money and
// dates already formatted by the jobs Worker (nothing is added up or worked out here). An unknown stage is never guessed: the subject is just
// and the number, and the stage sentence is left out. Presentation only: the number, the amounts and the dates are bold in HTML (kept on one line); every
// variable is escaped.
import { escapeHtml, headerValue } from "./headers.ts";
import { type LayoutOptions, type Para, type Rendered, securityEmail } from "./templates.ts";

export type EdfReminderData = {
  owner_first_name: string;
  month_label: string;
  count: string;
  due_date: string;
  link: string;
};

export type RealisationAlertData = {
  owner_first_name: string;
  stage: string;
  number: string;
  client: string;
  currency: string;
  outstanding: string;
  due_date: string;
  link: string;
};

type Piece = string | { b: string };
const B = (v: string): Piece => ({ b: v });

/** A 07-V sentence from its pieces: the values bold in HTML; the text twin says the same words. */
function line(pieces: Piece[]): Para {
  const text = pieces.map((p) => (typeof p === "string" ? p : p.b)).join("");
  const html = pieces
    .map((p) =>
      typeof p === "string"
        ? escapeHtml(p)
        : `<strong style="font-weight:600;white-space:nowrap;">${escapeHtml(p.b)}</strong>`,
    )
    .join("");
  return { text, html };
}

// ---- EDF reminder (07-V §10) ---------------------------------------------------------------------------------------------------------------------

/** `edf.reminder`: the monthly Export Declaration Form reminder (ADM-REP-07, Q55; VERIFY WITH CA/LEGAL). */
export function edfReminder(d: EdfReminderData, opts: LayoutOptions): Rendered {
  return securityEmail(headerValue(`EDF list for ${d.month_label}: ${d.count} export invoices`), opts, {
    before: [
      line([
        B(d.count),
        ` export invoices were issued in ${d.month_label}. The EDF list is ready for your bank, due by `,
        B(d.due_date),
        ".",
      ]),
    ],
    action: { label: "Open EDF list", url: d.link },
  });
}

// ---- Realisation alert (07-V §10, four stages) -----------------------------------------------------------------------------------------------------

export const REALISATION_ALERT_STAGES = [
  "fema_approaching",
  "fema_overdue",
  "gst_approaching",
  "gst_overdue",
] as const;
export type RealisationAlertStage = (typeof REALISATION_ALERT_STAGES)[number];
export const isRealisationAlertStage = (s: string): s is RealisationAlertStage =>
  (REALISATION_ALERT_STAGES as readonly string[]).includes(s);

/** 07-V §10: the subject of each stage. */
export function realisationSubject(stage: string, number: string): string {
  switch (stage) {
    case "fema_approaching":
      return `${number}: FEMA date in 30 days`;
    case "fema_overdue":
      return `${number}: past the FEMA date`;
    case "gst_approaching":
      return `${number}: GST date in 30 days`;
    case "gst_overdue":
      return `${number}: past the GST date`;
    default:
      return number;
  }
}

/** 07-V §10: the stage sentence, the date bold ("is" before the date, "was" after it); none for a stage it doesn't name. */
function stageSentence(stage: string, date: string): Piece[] {
  switch (stage) {
    case "fema_approaching":
      return ["Its FEMA realisation date is ", B(date), "."];
    case "fema_overdue":
      return ["Its FEMA realisation date was ", B(date), "."];
    case "gst_approaching":
      return ["Its GST date (12 months and 15 days, Rule 96A) is ", B(date), "."];
    case "gst_overdue":
      return ["Its GST date (12 months and 15 days, Rule 96A) was ", B(date), "."];
    default:
      return [];
  }
}

/** `realisation.alert`: one export invoice reached a stage (FEMA or GST, approaching or past; ADM-INV-17, Q54; VERIFY WITH CA/LEGAL). */
export function realisationAlert(d: RealisationAlertData, opts: LayoutOptions): Rendered {
  const stage = stageSentence(d.stage, d.due_date);
  return securityEmail(headerValue(realisationSubject(d.stage, d.number)), opts, {
    before: [
      line([
        "Export invoice ",
        B(d.number),
        ` to ${d.client} still shows `,
        B(d.outstanding),
        " outstanding.",
        ...(stage.length > 0 ? [" ", ...stage] : []),
        " If the payment has arrived, record it when payments are available; if your bank extended the date, keep its letter.",
      ]),
    ],
    action: { label: "Open export realisation", url: d.link },
  });
}
