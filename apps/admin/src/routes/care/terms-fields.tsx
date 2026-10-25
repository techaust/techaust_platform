// The terms of a care plan as form fields (M3.5, ADM-CARE-01), shared by the new plan form and the owner's terms change: the tier,
// the price per month, the included hours (whole hours and a quarter, so they are always 15-minute steps), the AI Ops add-on, the
// overage rate and the rollover rule. The amounts are typed in the plan's currency (the client's), never chosen here.
import { useEffect, useRef } from "react";
import type { Currency } from "../../api.ts";
import { FormField } from "../../components/form.tsx";
import { FieldError } from "../../components/ui.tsx";
import {
  CARE_COPY,
  CARE_TIERS,
  type DurationForm,
  type PlanErrors,
  QUARTERS,
  ROLLOVER_LABELS,
  type TermsForm,
  TIER_LABELS,
} from "../../lib/care.ts";
import { MoneyIn } from "../projects/parts.tsx";

/** Hours and a quarter, side by side, in one fieldset (the legend names both). */
export function DurationFields(props: {
  id: string;
  legend: string;
  hint: string;
  value: DurationForm;
  onChange: (v: DurationForm) => void;
  error?: string | undefined;
  optional?: boolean | undefined;
  /** The hour field's upper bound for the browser's own hint (the form checks again). */
  maxHours: number;
}) {
  const described = [`${props.id}-hint`, props.error ? `${props.id}-error` : null].filter(Boolean).join(" ");
  return (
    <fieldset className="field duration" aria-describedby={described}>
      <legend>
        {props.legend}
        {props.optional && <span className="field__optional"> (optional)</span>}
      </legend>
      <p className="hint" id={`${props.id}-hint`}>
        {props.hint}
      </p>
      <div className="duration__row">
        <div className="duration__part">
          <label htmlFor={props.id} className="duration__label">
            Hours
          </label>
          <input
            id={props.id}
            inputMode="numeric"
            autoComplete="off"
            maxLength={String(props.maxHours).length}
            aria-invalid={props.error ? true : undefined}
            aria-describedby={props.error ? `${props.id}-error` : undefined}
            value={props.value.hours}
            onChange={(e) => props.onChange({ ...props.value, hours: e.target.value })}
          />
        </div>
        <div className="duration__part">
          <label htmlFor={`${props.id}-min`} className="duration__label">
            Minutes
          </label>
          <select
            id={`${props.id}-min`}
            value={props.value.minutes}
            onChange={(e) => props.onChange({ ...props.value, minutes: e.target.value })}
          >
            {QUARTERS.map((q) => (
              <option key={q} value={q}>
                {q === "0" ? "00" : q}
              </option>
            ))}
          </select>
        </div>
      </div>
      {props.error && <FieldError id={`${props.id}-error`}>{props.error}</FieldError>}
    </fieldset>
  );
}

export function TermsFields(props: {
  prefix: string;
  value: TermsForm;
  onChange: (patch: Partial<TermsForm>) => void;
  /** A new tier: the new plan form refills the tier's catalogue prefill; the terms change keeps what is typed. */
  onTier?: ((tier: TermsForm["tier"]) => void) | undefined;
  currency: Currency;
  errors: PlanErrors;
  /** In a dialog: on open, focus the checked tier (the browser would pick the first radio, which may be unchecked). */
  focusTier?: boolean | undefined;
}) {
  const { prefix: P, value: f, errors } = props;
  const checked = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!props.focusTier) return;
    const id = requestAnimationFrame(() => checked.current?.focus()); // after the dialog has opened
    return () => cancelAnimationFrame(id);
  }, [props.focusTier]);
  return (
    <>
      <fieldset className="radios tier-radios">
        <legend>Tier</legend>
        <div className="tier-radios__row">
          {CARE_TIERS.map((t) => (
            <label key={t} className="radio tier-radio">
              <input
                type="radio"
                name={`${P}-tier`}
                value={t}
                ref={f.tier === t ? checked : undefined}
                checked={f.tier === t}
                onChange={() => (props.onTier ? props.onTier(t) : props.onChange({ tier: t }))}
              />
              <span>{TIER_LABELS[t]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="form-grid">
        <FormField id={`${P}-price`} label="Price per month" error={errors.price}>
          {(a) => (
            <MoneyIn
              a11y={a}
              currency={props.currency}
              value={f.price}
              onChange={(v) => props.onChange({ price: v })}
            />
          )}
        </FormField>
        <FormField
          id={`${P}-overageRate`}
          label="Overage rate per hour"
          optional
          hint={CARE_COPY.overageRateHint}
          error={errors.overageRate}
        >
          {(a) => (
            <MoneyIn
              a11y={a}
              currency={props.currency}
              value={f.overageRate}
              onChange={(v) => props.onChange({ overageRate: v })}
            />
          )}
        </FormField>
      </div>
      <DurationFields
        id={`${P}-included`}
        legend="Included hours"
        hint={CARE_COPY.includedHint}
        optional
        maxHours={2000}
        value={f.included}
        onChange={(v) => props.onChange({ included: v })}
        error={errors.included}
      />
      <fieldset className="radios">
        <legend>Rollover</legend>
        <p className="hint" id={`${P}-rollover-hint`}>
          {CARE_COPY.rolloverHint}
        </p>
        {(["none", "one_month"] as const).map((r) => (
          <label key={r} className="radio">
            <input
              type="radio"
              name={`${P}-rollover`}
              value={r}
              checked={f.rollover === r}
              aria-describedby={`${P}-rollover-hint`}
              onChange={() => props.onChange({ rollover: r })}
            />
            <span>{ROLLOVER_LABELS[r]}</span>
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input
          type="checkbox"
          checked={f.aiOps}
          onChange={(e) => props.onChange({ aiOps: e.target.checked })}
        />
        <span>AI Ops add-on</span>
      </label>
      {f.aiOps && (
        <FormField id={`${P}-aiOpsPrice`} label="AI Ops add-on price per month" error={errors.aiOpsPrice}>
          {(a) => (
            <MoneyIn
              a11y={a}
              currency={props.currency}
              value={f.aiOpsPrice}
              onChange={(v) => props.onChange({ aiOpsPrice: v })}
            />
          )}
        </FormField>
      )}
    </>
  );
}
