// The two M5.5b owner emails, as plain `[Placeholder]` stubs (LD88): the words are 07-V's, which the lead has not drafted yet, so nothing here is invented. A test send and the jobs
// Worker's tests need a template that renders; the designer replaces these with the approved copy and the four stage variants of the realisation alert. The data keys are
// `INVOICE_EMAIL_DATA["edf.reminder"]` and `["realisation.alert"]` in `@techaust/core/invoice-email`.
import { headerValue } from "./headers.ts";
import { type LayoutOptions, para, type Rendered, securityEmail } from "./templates.ts";

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

const PLACEHOLDER = "[Placeholder]";

/** `edf.reminder`: the monthly Export Declaration Form reminder (ADM-REP-07, Q55). */
export function edfReminder(d: EdfReminderData, opts: LayoutOptions): Rendered {
  return securityEmail(headerValue(`${PLACEHOLDER} ${d.month_label}`), opts, {
    before: [para(`${PLACEHOLDER} ${d.count} export invoices, due ${d.due_date}.`)],
    action: { label: PLACEHOLDER, url: d.link },
  });
}

/** `realisation.alert`: one export invoice reached a stage (`d.stage`: FEMA or GST, approaching or overdue; ADM-REP-07, Q54). */
export function realisationAlert(d: RealisationAlertData, opts: LayoutOptions): Rendered {
  return securityEmail(headerValue(`${PLACEHOLDER} ${d.number}`), opts, {
    before: [
      para(
        `${PLACEHOLDER} ${d.stage}: ${d.number}, ${d.client}, ${d.currency} ${d.outstanding}, due ${d.due_date}.`,
      ),
    ],
    action: { label: PLACEHOLDER, url: d.link },
  });
}
