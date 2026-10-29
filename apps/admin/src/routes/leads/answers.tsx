// A manual lead's quote answers (FX-3, A3 8; ADM-LEAD-01): currency, budget and timeline, in the quote form's own words (core
// `form-labels`: `budgetBandOptions`, `TIMELINE_LABELS`), on the New lead form and on a manual lead's Enquiry panel. A budget band
// belongs to its currency, so the Budget list shows the chosen currency's bands and a new currency drops a band it doesn't have
// (the API checks the values the lead ends up with). A website lead's answers are the visitor's own and are never offered here.

import { budgetBandOptions, isBudgetBand, TIMELINE_LABELS } from "@techaust/core/form-labels";
import type { Currency, LeadPatch } from "../../api.ts";
import { FormField } from "../../components/form.tsx";
import { CURRENCY_LABELS } from "../../lib/clients.ts";
import { Y } from "../../lib/copy-y.ts";
import { FIELD_LABELS } from "../../lib/leads.ts";

export type Answers = { currency: "" | Currency; band: string; timeline: string };
export const NO_ANSWERS: Answers = { currency: "", band: "", timeline: "" };

/** 07-Y (FX-3): the lines the answers needed. */
export const ANSWERS_COPY = {
  chooseCurrencyFirst: Y("Choose a currency first."),
  /** A website lead's answers changed by a request the screen never makes (409 `lead_answers_fixed`, a race only). */
  answersFixed: Y("These answers came from the website form and can't be changed."),
} as const;

/** A new currency keeps the band only when that currency has it ("Not sure" is in both). */
export function withCurrency(a: Answers, currency: Answers["currency"]): Answers {
  const band = currency && a.band && isBudgetBand(currency, a.band) ? a.band : "";
  return { ...a, currency, band };
}

/** What a save sends: only the answers that changed; a changed currency always carries the band it ends with. */
export function answersPatch(base: Answers, value: Answers): Omit<LeadPatch, "expectedUpdatedAt"> {
  const patch: Omit<LeadPatch, "expectedUpdatedAt"> = {};
  if (value.currency !== base.currency) {
    patch.currency = value.currency || null;
    patch.budgetBand = value.band || null;
  } else if (value.band !== base.band) patch.budgetBand = value.band || null;
  if (value.timeline !== base.timeline) patch.timeline = value.timeline || null;
  return patch;
}

export function AnswersFields(props: { idPrefix: string; value: Answers; onChange: (a: Answers) => void }) {
  const { idPrefix: p, value: a } = props;
  return (
    <div className="form-grid">
      <FormField id={`${p}-currency`} label={FIELD_LABELS.currency ?? "Currency"} optional>
        {(x) => (
          <select
            {...x}
            value={a.currency}
            onChange={(e) => props.onChange(withCurrency(a, e.target.value as Answers["currency"]))}
          >
            <option value="">Not given</option>
            {(["INR", "USD"] as const).map((c) => (
              <option key={c} value={c}>
                {CURRENCY_LABELS[c]}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField
        id={`${p}-budget`}
        label={FIELD_LABELS.budget_band ?? "Budget"}
        optional
        hint={a.currency ? undefined : ANSWERS_COPY.chooseCurrencyFirst}
      >
        {(x) => (
          <select
            {...x}
            value={a.band}
            disabled={!a.currency}
            onChange={(e) => props.onChange({ ...a, band: e.target.value })}
          >
            <option value="">Not given</option>
            {a.currency &&
              budgetBandOptions(a.currency).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </select>
        )}
      </FormField>
      <FormField id={`${p}-timeline`} label={FIELD_LABELS.timeline ?? "Timeline"} optional>
        {(x) => (
          <select
            {...x}
            value={a.timeline}
            onChange={(e) => props.onChange({ ...a, timeline: e.target.value })}
          >
            <option value="">Not given</option>
            {Object.entries(TIMELINE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        )}
      </FormField>
    </div>
  );
}
