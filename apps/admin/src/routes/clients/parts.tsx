// Pieces the Clients screens share (M3.3): the access gate, the breadcrumbs, the tax identity fields (country, GST status,
// the GSTIN with its live check, the state with the 07-J mismatch warning), the address fields, and the small name and
// flag cells. The styles are clients.css (with the M3.2 panels from leads.css), loaded with these screens only.
// GST treatment: VERIFY WITH CA/LEGAL (the state and place of supply are confirmed on proposals and invoices).
import "../../leads.css";
import "../../clients.css";
import { selectableStates, validateGstin } from "@techaust/core/gstin";
import type { ReactNode } from "react";
import type { GstStatus } from "../../api.ts";
import { StatusPill } from "../../components/display.tsx";
import { FormField, Switch } from "../../components/form.tsx";
import { AlertTriangle } from "../../components/icons.tsx";
import { NoAccess } from "../../components/states.tsx";
import { FieldError } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import {
  type AddressForm,
  GST_STATUS_LABELS,
  GST_STATUSES,
  stateWarning,
  type Tax,
  type TaxErrors,
  withCountry,
  withGstin,
} from "../../lib/clients.ts";
import { countryOptions } from "../../lib/leads.ts";
import { useUser } from "../../session.tsx";

export const CRUMBS = [{ label: "Clients", to: "/clients" }];

/** The Clients screens for a role that may read clients; the 403 page otherwise. */
export function ClientsGate({ children }: { children: ReactNode }) {
  const user = useUser();
  return allowed(user.role, "clients.read") ? children : <NoAccess what="Clients" />;
}

/**
 * Country, GST status, GSTIN (live check as in Settings › Company and the convert dialog) and the state (required for
 * registered and unregistered Indian clients, owner answer Q1). `prefix` keeps the ids unique per form; `locked`
 * explains a field the person can't change here (none today, kept for the billing form's read-only view).
 */
export { stateWarning, type Tax, taxFieldErrors, withCountry, withGstin } from "../../lib/clients.ts";

export function TaxFields(props: {
  prefix: string;
  value: Tax;
  onChange: (patch: Partial<Tax>) => void;
  errors: TaxErrors;
  /** The GSTIN check runs once it is complete or the field is left. */
  checked: boolean;
  onChecked: (on: boolean) => void;
}) {
  const { prefix: p, value: v, errors } = props;
  const registered = v.gstStatus === "registered";
  const india = v.gstStatus !== "overseas";
  const gst = registered && v.gstin.trim() ? validateGstin(v.gstin) : null;
  const liveError = props.checked && gst && !gst.ok ? `${gst.error}.` : null;
  const mismatch = gst?.ok && v.stateCode && v.stateCode !== gst.stateCode ? gst.state : null;
  return (
    <>
      <FormField id={`${p}-country`} label="Country" error={errors.country}>
        {(a) => (
          <select {...a} value={v.country} onChange={(e) => props.onChange(withCountry(v, e.target.value))}>
            {countryOptions().map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <fieldset
        className="radios field-set"
        id={`${p}-gstStatus`}
        tabIndex={-1}
        aria-describedby={errors.gstStatus ? `${p}-gstStatus-error` : undefined}
      >
        <legend>GST status</legend>
        <div className="segmented">
          {GST_STATUSES.map((s: GstStatus) => (
            <label key={s} className="segmented__opt">
              <input
                type="radio"
                name={`${p}-gst`}
                value={s}
                checked={v.gstStatus === s}
                onChange={() =>
                  props.onChange({
                    gstStatus: s,
                    ...(s !== "registered" ? { gstin: "" } : {}),
                    ...(s === "overseas" ? { stateCode: "" } : {}),
                  })
                }
              />
              {GST_STATUS_LABELS[s]}
            </label>
          ))}
        </div>
        {errors.gstStatus && <FieldError id={`${p}-gstStatus-error`}>{errors.gstStatus}</FieldError>}
      </fieldset>
      {registered && (
        <FormField
          id={`${p}-gstin`}
          label="GSTIN"
          className="field--gstin"
          hint="15 characters, checked when you finish typing."
          error={errors.gstin ?? liveError}
          status={
            gst?.ok ? (
              <>
                <StatusPill tone="success" icon="check">
                  Valid
                </StatusPill>
                <span>
                  Registered in {gst.state} ({gst.stateCode})
                </span>
              </>
            ) : undefined
          }
        >
          {(a) => (
            <input
              {...a}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="characters"
              maxLength={18}
              value={v.gstin}
              onChange={(e) => {
                props.onChange(withGstin(v, e.target.value));
                props.onChecked(e.target.value.replace(/\s/g, "").length >= 15);
              }}
              onBlur={() => props.onChecked(true)}
            />
          )}
        </FormField>
      )}
      {india && (
        <FormField
          id={`${p}-stateCode`}
          label="State and code"
          hint={registered ? "Set from the GSTIN; change it only if the place of supply differs." : undefined}
          error={errors.stateCode}
          status={
            mismatch ? (
              <span className="field-warning">
                <AlertTriangle size={16} />
                {stateWarning(mismatch)}
              </span>
            ) : undefined
          }
        >
          {(a) => (
            <select
              {...a}
              value={v.stateCode}
              onChange={(e) => props.onChange({ stateCode: e.target.value })}
            >
              <option value="">Choose a state</option>
              {selectableStates().map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}
    </>
  );
}

/** The address as five fields and its country. The first line and the city are needed once anything is typed. */
export function AddressFields(props: {
  prefix: string;
  value: AddressForm;
  onChange: (patch: Partial<AddressForm>) => void;
  error: (id: string) => string | undefined;
}) {
  const { prefix: p, value: v } = props;
  const text = (key: "line1" | "line2" | "city" | "state" | "postalCode", label: string, max: number) => (
    <FormField
      id={`${p}-${key}`}
      label={label}
      optional={key !== "line1" && key !== "city"}
      error={props.error(`${p}-${key}`)}
    >
      {(a) => (
        <input
          {...a}
          autoComplete="off"
          maxLength={max}
          value={v[key]}
          onChange={(e) => props.onChange({ [key]: e.target.value })}
        />
      )}
    </FormField>
  );
  return (
    <div className="form-grid address-grid">
      {text("line1", "Address line 1", 200)}
      {text("line2", "Address line 2", 200)}
      {text("city", "Town or city", 100)}
      {text("state", "State or region", 100)}
      {text("postalCode", "Postal code", 20)}
      <FormField id={`${p}-country`} label="Country">
        {(a) => (
          <select {...a} value={v.country} onChange={(e) => props.onChange({ country: e.target.value })}>
            {countryOptions().map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </FormField>
    </div>
  );
}

/** Contact flags as pills: icon and text, never colour alone. */
export function ContactFlags(props: {
  isPrimary: boolean;
  isBilling: boolean;
  portalAccess: boolean;
  canSeeFinance: boolean;
}) {
  return (
    <ul className="flag-list" aria-label="Flags">
      {props.isPrimary && (
        <li>
          <StatusPill tone="info" icon="flag">
            Primary
          </StatusPill>
        </li>
      )}
      {props.isBilling && (
        <li>
          <StatusPill tone="neutral" icon="inbox">
            Billing
          </StatusPill>
        </li>
      )}
      {props.portalAccess && (
        <li>
          <StatusPill tone="success" icon="check">
            Portal access
          </StatusPill>
        </li>
      )}
      {props.canSeeFinance && (
        <li>
          <StatusPill tone="neutral" icon="lock">
            Can see finance
          </StatusPill>
        </li>
      )}
    </ul>
  );
}

/** The contact switches (ADM-CLI-02): billing, portal access (07-J line), can see finance (follows billing until set), marketing. */
export function ContactSwitches(props: {
  prefix: string;
  isBilling: boolean;
  portalAccess: boolean;
  canSeeFinance: boolean;
  marketingConsent: boolean;
  onChange: (patch: {
    isBilling?: boolean;
    portalAccess?: boolean;
    canSeeFinance?: boolean;
    marketingConsent?: boolean;
  }) => void;
}) {
  const p = props.prefix;
  const row = (
    key: "isBilling" | "portalAccess" | "canSeeFinance" | "marketingConsent",
    label: string,
    hint?: string,
  ) => (
    <div className="switch-row">
      <div className="switch-row__text">
        <span id={`${p}-${key}-label`} className="switch-row__label">
          {label}
        </span>
        {hint && (
          <p className="hint" id={`${p}-${key}-desc`}>
            {hint}
          </p>
        )}
      </div>
      <Switch
        id={`${p}-${key}`}
        checked={props[key]}
        onChange={(on) => props.onChange({ [key]: on })}
        labelledBy={`${p}-${key}-label`}
        describedBy={hint ? `${p}-${key}-desc` : undefined}
      />
    </div>
  );
  return (
    <div className="switch-rows">
      {row("isBilling", "Billing contact")}
      {row(
        "portalAccess",
        "Portal access",
        "Turning this off signs them out of the client portal and cancels any sign-in links they haven't used.",
      )}
      {row("canSeeFinance", "Can see finance", "On for billing contacts unless you change it.")}
      {row("marketingConsent", "Marketing consent")}
    </div>
  );
}
