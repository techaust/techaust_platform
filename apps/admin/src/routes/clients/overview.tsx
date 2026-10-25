// The client page's Overview tab (M3.3, ADM-CLI-01, -03): the details (names, type, service address, tags, notes; edited
// through PATCH /clients/:id by roles with clients.write) and the tax and billing panel (the tax identity every role
// reads; the money settings only for roles with clients.finance.read; edited through PATCH /clients/:id/billing by roles
// with clients.finance.write). Each edit sends only the fields the person changed and the `updatedAt` it was loaded
// with; a 409 `stale_version` or a reload that clashes with a draft shows the shared notice (M3.2 pattern). The side
// column: the balance (07-J line until invoicing, finance roles only), the primary contact and the source lead.
// GST treatment: VERIFY WITH CA/LEGAL.
import { countryName } from "@techaust/core/form-labels";
import { type Dispatch, type FormEvent, type ReactNode, useState } from "react";
import { Link } from "react-router";
import { api, type ClientPage, errorText, RequestError } from "../../api.ts";
import { FormField, NumberUnit, Switch, VerifyNote } from "../../components/form.tsx";
import { Inbox, Lock, Pencil, Receipt, User } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import {
  addressErrors,
  addressLines,
  type BillingForm,
  billingAddressOf,
  billingOf,
  billingPatch,
  type ClientDraftAction,
  type ClientDrafts,
  CURRENCY_LABELS,
  contactCountText,
  type DetailsForm,
  detailsOf,
  detailsPatch,
  fieldOfError,
  GST_STATUS_LABELS,
  parseOffsets,
  serviceAddressOf,
  stateText,
  TYPE_LABELS,
  termsDays,
} from "../../lib/clients.ts";
import { sentence } from "../../lib/format.ts";
import { useUser } from "../../session.tsx";
import { AddressFields, type Tax, TaxFields, taxFieldErrors } from "./parts.tsx";

/** 07-J (approved): the lines until invoicing exists. */
export const INVOICES_LINE = "Invoices and payments arrive with invoicing.";
export const CURRENCY_LOCKED_LINE = "The currency can't change once this client has an invoice.";

type Errors = Record<string, string>;

export function Overview(props: {
  data: ClientPage;
  drafts: ClientDrafts;
  draft: Dispatch<ClientDraftAction>;
  /** `stale`: the person asked for the latest after a 409 (their drafts are dropped). */
  reload: (cause?: "own" | "stale") => void;
  onStale: () => void;
  onContacts: () => void;
}) {
  const user = useUser();
  const { client } = props.data;
  const canWrite = allowed(user.role, "clients.write");
  const canFinance = allowed(user.role, "clients.finance.read");
  const canBilling = allowed(user.role, "clients.finance.write");
  const primary = props.data.contacts.find((c) => c.isPrimary && c.anonymisedAt === null) ?? null;
  return (
    <div className="lead-page client-overview">
      <div className="lead-page__main">
        <Details {...props} canWrite={canWrite} />
        <Billing {...props} canFinance={canFinance} canBilling={canBilling} />
      </div>
      <aside className="lead-page__side" aria-label="Summary">
        {canFinance && <Balance id={client.id} />}
        <section className="lead-panel" aria-labelledby="primary-h">
          <h2 id="primary-h" className="lead-panel__title">
            Primary contact
          </h2>
          {primary ? (
            <dl className="facts">
              <Fact label="Name">{primary.name}</Fact>
              <Fact label="Email">
                <a href={`mailto:${primary.email}`} className="break">
                  {primary.email}
                </a>
              </Fact>
              {primary.phone && <Fact label="Phone">{primary.phone}</Fact>}
            </dl>
          ) : (
            <p className="muted">
              {props.data.contacts.length ? "No primary contact yet." : "No contact yet."}
            </p>
          )}
          <button type="button" className="btn btn--text panel-link" onClick={props.onContacts}>
            <User size={16} />
            {contactCountText(props.data)}
          </button>
        </section>
        {props.data.sourceLead && (
          <section className="lead-panel" aria-labelledby="linked-h">
            <h2 id="linked-h" className="lead-panel__title">
              Linked records
            </h2>
            <ul className="lead-links">
              <li>
                <Inbox size={20} />
                <span>
                  <span className="lead-links__label">Source lead</span>
                  <Link to={`/leads/${props.data.sourceLead.id}`}>
                    <span className="docno">{props.data.sourceLead.ref}</span>
                  </Link>
                </span>
              </li>
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const none = (text = "Not given") => <span className="muted">{text}</span>;

/** Overview (balance, overdue, lifetime billed) until invoicing: GET /finance answers `{available:false}`. */
function Balance({ id }: { id: string }) {
  const fin = useLoad(() => api.clientFinance(id), id);
  return (
    <section className="lead-panel" aria-labelledby="balance-h">
      <h2 id="balance-h" className="lead-panel__title">
        Balance
      </h2>
      {fin.state === "failed" ? (
        <LoadFailed error={fin.error} onRetry={() => fin.reload()} headingLevel={3} />
      ) : (
        <p className="panel-empty">
          <Receipt size={20} />
          <span>{INVOICES_LINE}</span>
        </p>
      )}
    </section>
  );
}

// ---- details ----------------------------------------------------------------------------------------------------------

function Details(props: Parameters<typeof Overview>[0] & { canWrite: boolean }) {
  const toast = useToast();
  const { client } = props.data;
  const stored = detailsOf(client);
  const d = props.drafts.details;
  const editing = d !== null;
  const f = d?.value ?? stored;
  const setF = (value: DetailsForm | null) => props.draft({ type: "details", value, base: stored });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!d) return;
    const errs: Errors = { ...addressErrors(serviceAddressOf(f), "cd-svc") };
    if (!f.legalName.trim()) errs["cd-legalName"] = "Enter the legal name.";
    setErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) {
      document.getElementById(first)?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const r = await api.updateClient(client.id, {
        ...detailsPatch(d),
        expectedUpdatedAt: client.updatedAt,
      });
      toast("success", r.changed ? "Saved." : "No change: that's already saved.");
      setF(null);
      props.reload();
    } catch (err) {
      if (err instanceof RequestError && err.code === "stale_version") props.onStale();
      else if (err instanceof RequestError && fieldOfError(err.code) === "type") {
        setErrors({ "cd-type": sentence(err.message) });
        document.getElementById("cd-type")?.focus();
      } else setFailure(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const svc = serviceAddressOf(f);
  return (
    <section className="lead-panel" aria-labelledby="details-h">
      <div className="lead-panel__head">
        <h2 id="details-h" className="lead-panel__title">
          Details
        </h2>
        {props.canWrite && !editing && (
          <button type="button" className="btn btn--text" onClick={() => setF(stored)}>
            <Pencil size={16} />
            Edit<span className="visually-hidden"> details</span>
          </button>
        )}
      </div>
      {editing ? (
        <form onSubmit={save} noValidate className="panel-form">
          {failure && <Notice tone="error">{failure}</Notice>}
          <fieldset
            className="radios field-set"
            id="cd-type"
            tabIndex={-1}
            aria-describedby={errors["cd-type"] ? "cd-type-error" : undefined}
          >
            <legend>Type</legend>
            <div className="segmented">
              {(["business", "individual"] as const).map((t) => (
                <label key={t} className="segmented__opt">
                  <input
                    type="radio"
                    name="cd-type"
                    value={t}
                    checked={f.type === t}
                    onChange={() => setF({ ...f, type: t })}
                  />
                  {TYPE_LABELS[t]}
                </label>
              ))}
            </div>
            {errors["cd-type"] && <FieldError id="cd-type-error">{errors["cd-type"]}</FieldError>}
          </fieldset>
          <div className="form-grid">
            <FormField id="cd-legalName" label="Legal name" error={errors["cd-legalName"]}>
              {(a) => (
                <input
                  {...a}
                  autoComplete="off"
                  maxLength={200}
                  value={f.legalName}
                  onChange={(e) => setF({ ...f, legalName: e.target.value })}
                />
              )}
            </FormField>
            <FormField id="cd-displayName" label="Display name" optional>
              {(a) => (
                <input
                  {...a}
                  autoComplete="off"
                  maxLength={120}
                  value={f.displayName}
                  onChange={(e) => setF({ ...f, displayName: e.target.value })}
                />
              )}
            </FormField>
          </div>
          <h3 className="lead-panel__sub">
            Service address<span className="field__optional"> (optional)</span>
          </h3>
          <AddressFields
            prefix="cd-svc"
            value={svc}
            onChange={(patch) => {
              const next = { ...svc, ...patch };
              setF({
                ...f,
                svc_line1: next.line1,
                svc_line2: next.line2,
                svc_city: next.city,
                svc_state: next.state,
                svc_postalCode: next.postalCode,
                svc_country: next.country,
              });
            }}
            error={(id) => errors[id]}
          />
          <FormField id="cd-tags" label="Tags" optional hint="Separate tags with commas.">
            {(a) => (
              <input
                {...a}
                autoComplete="off"
                value={f.tags}
                onChange={(e) => setF({ ...f, tags: e.target.value })}
              />
            )}
          </FormField>
          <FormField id="cd-notes" label="Notes" optional>
            {(a) => (
              <textarea
                {...a}
                rows={4}
                maxLength={4000}
                value={f.notes}
                onChange={(e) => setF({ ...f, notes: e.target.value })}
              />
            )}
          </FormField>
          <div className="lead-panel__actions">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => {
                setF(null);
                setErrors({});
                setFailure(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
              {busy ? "Saving…" : "Save details"}
            </button>
          </div>
        </form>
      ) : (
        <dl className="facts facts--two">
          <Fact label="Legal name">{client.legalName}</Fact>
          <Fact label="Display name">{client.displayName}</Fact>
          <Fact label="Type">{TYPE_LABELS[client.type]}</Fact>
          <Fact label="Country">{countryName(client.country)}</Fact>
          <Fact label="Service address">
            {client.serviceAddress ? <AddressText lines={addressLines(client.serviceAddress)} /> : none()}
          </Fact>
          <Fact label="Tags">
            {client.tags?.length ? (
              <ul className="tag-list">
                {client.tags.map((t) => (
                  <li key={t} className="tag">
                    {t}
                  </li>
                ))}
              </ul>
            ) : (
              none("None")
            )}
          </Fact>
          <Fact label="Notes">
            {client.notes ? <span className="prewrap">{client.notes}</span> : none("None")}
          </Fact>
        </dl>
      )}
    </section>
  );
}

export function AddressText({ lines }: { lines: string[] }) {
  return (
    <span className="address">
      {lines.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </span>
  );
}

// ---- tax and billing ----------------------------------------------------------------------------------------------

function reminderText(r: { enabled: boolean; offsetsDays?: number[] } | null | undefined) {
  if (!r) return "As in settings";
  if (!r.enabled) return "Off";
  return r.offsetsDays?.length ? `On, at ${r.offsetsDays.join(", ")} days from the due date` : "On";
}

function Billing(props: Parameters<typeof Overview>[0] & { canFinance: boolean; canBilling: boolean }) {
  const toast = useToast();
  const { client } = props.data;
  const locked = props.data.currencyLocked === true;
  const stored = billingOf(client);
  const d = props.drafts.billing;
  const editing = d !== null;
  const f = d?.value ?? stored;
  const setF = (value: BillingForm | null) => props.draft({ type: "billing", value, base: stored });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [checked, setChecked] = useState(true);
  const tax: Tax = { country: f.country, gstStatus: f.gstStatus, gstin: f.gstin, stateCode: f.stateCode };
  const bill = billingAddressOf(f);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!d) return;
    const errs: Errors = { ...taxFieldErrors(tax, "cb"), ...addressErrors(bill, "cb-bill") };
    if (termsDays(f.terms) === undefined)
      errs["cb-terms"] = "Enter a whole number of days from 0 to 365, or leave it empty.";
    if (f.reminders === "on" && parseOffsets(f.offsets) === null)
      errs["cb-offsets"] = "Enter whole numbers of days from -60 to 365, separated by commas (at most 10).";
    setErrors(errs);
    setChecked(true);
    const first = Object.keys(errs)[0];
    if (first) {
      document.getElementById(first)?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const r = await api.updateBilling(client.id, {
        ...billingPatch(d),
        expectedUpdatedAt: client.updatedAt,
      });
      toast("success", r.changed ? "Saved." : "No change: that's already saved.");
      setF(null);
      props.reload();
    } catch (err) {
      const field = err instanceof RequestError ? fieldOfError(err.code) : null;
      if (err instanceof RequestError && err.code === "stale_version") props.onStale();
      else if (err instanceof RequestError && field) {
        setErrors({ [`cb-${field}`]: sentence(err.message) });
        document.getElementById(`cb-${field}`)?.focus();
      } else setFailure(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="lead-panel" aria-labelledby="billing-h">
      <div className="lead-panel__head">
        <h2 id="billing-h" className="lead-panel__title">
          Tax and billing
        </h2>
        {props.canBilling && !editing && (
          <button type="button" className="btn btn--text" onClick={() => setF(stored)}>
            <Pencil size={16} />
            Edit<span className="visually-hidden"> tax and billing</span>
          </button>
        )}
      </div>
      {editing ? (
        <form onSubmit={save} noValidate className="panel-form">
          {failure && <Notice tone="error">{failure}</Notice>}
          <div className="form-grid tax-grid">
            <TaxFields
              prefix="cb"
              value={tax}
              onChange={(patch) => {
                setF({ ...f, ...patch });
                setErrors((x) => {
                  const { "cb-gstin": _g, "cb-stateCode": _s, "cb-country": _c, ...rest } = x;
                  return rest;
                });
              }}
              errors={{
                country: errors["cb-country"],
                gstin: errors["cb-gstin"],
                stateCode: errors["cb-stateCode"],
              }}
              checked={checked}
              onChecked={setChecked}
            />
          </div>
          {locked ? (
            <div className="field">
              <span className="label-like">Currency</span>
              <p className="locked-value">
                <span className="docno">{client.currency}</span>
                <span className="locked-note">
                  <Lock size={16} />
                  {CURRENCY_LOCKED_LINE}
                </span>
              </p>
            </div>
          ) : (
            <fieldset
              className="radios field-set"
              id="cb-currency"
              tabIndex={-1}
              aria-describedby={errors["cb-currency"] ? "cb-currency-error" : "cb-currency-hint"}
            >
              <legend>Currency</legend>
              <div className="segmented">
                {(["INR", "USD"] as const).map((c) => (
                  <label key={c} className="segmented__opt">
                    <input
                      type="radio"
                      name="cb-currency"
                      value={c}
                      checked={f.currency === c}
                      onChange={() => setF({ ...f, currency: c })}
                    />
                    {CURRENCY_LABELS[c]}
                  </label>
                ))}
              </div>
              {errors["cb-currency"] ? (
                <FieldError id="cb-currency-error">{errors["cb-currency"]}</FieldError>
              ) : (
                <p className="hint" id="cb-currency-hint">
                  {CURRENCY_LOCKED_LINE}
                </p>
              )}
            </fieldset>
          )}
          <VerifyNote legal>The GST treatment is confirmed on the proposal and the invoice.</VerifyNote>
          <h3 className="lead-panel__sub">
            Billing address<span className="field__optional"> (optional)</span>
          </h3>
          <AddressFields
            prefix="cb-bill"
            value={bill}
            onChange={(patch) => {
              const n = { ...bill, ...patch };
              setF({
                ...f,
                bill_line1: n.line1,
                bill_line2: n.line2,
                bill_city: n.city,
                bill_state: n.state,
                bill_postalCode: n.postalCode,
                bill_country: n.country,
              });
            }}
            error={(id) => errors[id]}
          />
          <h3 className="lead-panel__sub">Invoicing</h3>
          <FormField
            id="cb-terms"
            label="Payment due"
            optional
            hint="Days after the invoice date. Leave it empty to use the default in Settings."
            error={errors["cb-terms"]}
          >
            {(a) => (
              <NumberUnit a11y={a} value={f.terms} onChange={(v) => setF({ ...f, terms: v })} unit="days" />
            )}
          </FormField>
          <fieldset className="radios">
            <legend>Reminders</legend>
            <div className="segmented">
              {(
                [
                  ["default", "As in settings"],
                  ["on", "On"],
                  ["off", "Off"],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="segmented__opt">
                  <input
                    type="radio"
                    name="cb-reminders"
                    value={v}
                    checked={f.reminders === v}
                    onChange={() => setF({ ...f, reminders: v })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          {f.reminders === "on" && (
            <FormField
              id="cb-offsets"
              label="Reminder days"
              optional
              hint="Days from the due date, separated by commas; a minus sign means before it, for example -3, 0, 7. Empty uses the days in Settings."
              error={errors["cb-offsets"]}
            >
              {(a) => (
                <input
                  {...a}
                  autoComplete="off"
                  inputMode="text"
                  value={f.offsets}
                  onChange={(e) => setF({ ...f, offsets: e.target.value })}
                />
              )}
            </FormField>
          )}
          <SwitchRow
            id="cb-care"
            label="Care plan auto-issue"
            hint="Care plan invoices are issued and sent on the billing day instead of waiting as drafts."
            checked={f.careAutoIssue === "on"}
            onChange={(on) => setF({ ...f, careAutoIssue: on ? "on" : "off" })}
          />
          <SwitchRow
            id="cb-pdf"
            label="Attach PDF"
            checked={f.attachPdf === "on"}
            onChange={(on) => setF({ ...f, attachPdf: on ? "on" : "off" })}
          />
          <div className="lead-panel__actions">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => {
                setF(null);
                setErrors({});
                setFailure(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
              {busy ? "Saving…" : "Save tax and billing"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <dl className="facts facts--two">
            <Fact label="GST status">{GST_STATUS_LABELS[client.gstStatus]}</Fact>
            {client.gstStatus === "registered" && (
              <Fact label="GSTIN">
                {client.gstin ? <span className="docno">{client.gstin}</span> : none()}
              </Fact>
            )}
            {client.gstStatus !== "overseas" && (
              <Fact label="State and code">
                {client.stateCode ? stateText(client.stateCode) : <span className="muted">Not set yet</span>}
              </Fact>
            )}
            <Fact label="Currency">
              <span className="currency-fact">
                <span className="docno">{client.currency}</span>
                {locked && (
                  <span className="locked-inline">
                    <Lock size={16} />
                    {CURRENCY_LOCKED_LINE}
                  </span>
                )}
              </span>
            </Fact>
            <Fact label="Billing address">
              {client.billingAddress ? <AddressText lines={addressLines(client.billingAddress)} /> : none()}
            </Fact>
          </dl>
          {props.canFinance && (
            <>
              <h3 className="lead-panel__sub">Invoicing</h3>
              <dl className="facts facts--two">
                <Fact label="Payment due">
                  {client.paymentTermsDays === null || client.paymentTermsDays === undefined
                    ? "As in settings"
                    : client.paymentTermsDays === 1
                      ? "1 day after the invoice date"
                      : `${client.paymentTermsDays} days after the invoice date`}
                </Fact>
                <Fact label="Reminders">{reminderText(client.reminderPolicy)}</Fact>
                <Fact label="Care plan auto-issue">{client.careAutoIssue ? "On" : "Off"}</Fact>
                <Fact label="Attach PDF">{client.attachPdf ? "On" : "Off"}</Fact>
              </dl>
            </>
          )}
        </>
      )}
    </section>
  );
}

function SwitchRow(props: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="switch-row">
      <div className="switch-row__text">
        <span id={`${props.id}-label`} className="switch-row__label">
          {props.label}
        </span>
        {props.hint && (
          <p className="hint" id={`${props.id}-desc`}>
            {props.hint}
          </p>
        )}
      </div>
      <Switch
        id={props.id}
        checked={props.checked}
        onChange={props.onChange}
        labelledBy={`${props.id}-label`}
        describedBy={props.hint ? `${props.id}-desc` : undefined}
      />
    </div>
  );
}
