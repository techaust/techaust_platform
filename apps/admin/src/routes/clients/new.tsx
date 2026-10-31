// A client added by hand (M3.3, ADM-CLI-01): who the client is, its tax identity (the GSTIN live check, the state that
// registered and unregistered Indian clients need, the 07-J mismatch warning), its currency, and optionally a service
// address, tags, notes and a first contact, which becomes the primary contact in the same request. The billing address
// and the money settings are set afterwards on the client's page (owner and staff). Optional fields are marked (owner
// decision 2026-10-24). On success the client's page opens. GST treatment: Researched 2026-10-28, s.12 IGST and Rule 46 CGST (08-C RA-12, RA-05).
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api, type ContactInput, errorText, type NewClientInput, RequestError } from "../../api.ts";
import { PageHeader } from "../../components/display.tsx";
import { ErrorSummary, FormField, type SummaryError, VerifyNote } from "../../components/form.tsx";
import { NoAccess } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import { allowed } from "../../lib/access.ts";
import {
  type AddressForm,
  addressErrors,
  addressForm,
  CURRENCY_LABELS,
  fieldOfError,
  parseTags,
  TYPE_LABELS,
  toAddress,
} from "../../lib/clients.ts";
import { sentence } from "../../lib/format.ts";
import { useUser } from "../../session.tsx";
import {
  AddressFields,
  ClientsGate,
  ContactSwitches,
  CRUMBS,
  type Tax,
  TaxFields,
  taxFieldErrors,
} from "./parts.tsx";

export function Component() {
  const user = useUser();
  return (
    <ClientsGate>
      {allowed(user.role, "clients.write") ? <NewClient /> : <NoAccess what="New client" crumbs={CRUMBS} />}
    </ClientsGate>
  );
}

type Form = {
  type: "business" | "individual";
  legalName: string;
  displayName: string;
  tax: Tax;
  currency: "INR" | "USD";
  svc: AddressForm;
  tags: string;
  notes: string;
  contact: {
    name: string;
    email: string;
    phone: string;
    title: string;
    isBilling: boolean;
    portalAccess: boolean;
    canSeeFinance: boolean | null;
    marketingConsent: boolean;
  };
};

const EMPTY: Form = {
  type: "business",
  legalName: "",
  displayName: "",
  tax: { country: "IN", gstStatus: "unregistered", gstin: "", stateCode: "" },
  currency: "INR",
  svc: addressForm(null, "IN"),
  tags: "",
  notes: "",
  contact: {
    name: "",
    email: "",
    phone: "",
    title: "",
    isBilling: false,
    portalAccess: false,
    canSeeFinance: null,
    marketingConsent: false,
  },
};

const P = "nc";
const opt = (v: string) => (v.trim() ? v.trim() : null);
const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

function NewClient() {
  const navigate = useNavigate();
  const toast = useToast();
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<SummaryError[]>([]);
  const [submits, setSubmits] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const dirty = !saved && JSON.stringify(f) !== JSON.stringify(EMPTY);
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));
  const setContact = (patch: Partial<Form["contact"]>) =>
    setF((x) => ({ ...x, contact: { ...x.contact, ...patch } }));
  const errorOf = (id: string) => errors.find((e) => e.id === id)?.text;
  const c = f.contact;
  const contactStarted = [c.name, c.email, c.phone, c.title].some((v) => v.trim() !== "");
  const canSeeFinance = c.canSeeFinance ?? c.isBilling;

  useEffect(() => {
    if (saved) navigate(`/clients/${saved}`, { replace: true });
  }, [saved, navigate]);

  function validate(): SummaryError[] {
    const e: Record<string, string> = {};
    if (!f.legalName.trim()) e[`${P}-legalName`] = "Enter the legal name.";
    Object.assign(e, taxFieldErrors(f.tax, P));
    Object.assign(e, addressErrors(f.svc, `${P}-svc`));
    if (contactStarted) {
      if (!c.name.trim()) e[`${P}-c-name`] = "Enter the contact's name.";
      if (!looksLikeEmail(c.email)) e[`${P}-c-email`] = "Enter an email address, like name@example.com.";
    }
    // In the order the fields appear.
    const order = [
      `${P}-legalName`,
      `${P}-country`,
      `${P}-gstin`,
      `${P}-stateCode`,
      `${P}-svc-line1`,
      `${P}-svc-city`,
      `${P}-c-name`,
      `${P}-c-email`,
    ];
    return order.filter((id) => e[id]).map((id) => ({ id, text: e[id] as string }));
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const errs = validate();
    setErrors(errs);
    setSubmits((n) => n + 1);
    setChecked(true);
    if (errs.length) return;
    setBusy(true);
    setFailure(null);
    const registered = f.tax.gstStatus === "registered";
    const svc = toAddress(f.svc);
    const tags = parseTags(f.tags);
    const contact: ContactInput | undefined = contactStarted
      ? {
          name: c.name.trim(),
          email: c.email.trim(),
          phone: opt(c.phone),
          title: opt(c.title),
          isBilling: c.isBilling,
          portalAccess: c.portalAccess,
          canSeeFinance,
          marketingConsent: c.marketingConsent,
        }
      : undefined;
    const body: NewClientInput = {
      type: f.type,
      legalName: f.legalName.trim(),
      ...(f.displayName.trim() ? { displayName: f.displayName.trim() } : {}),
      country: f.tax.country,
      gstStatus: f.tax.gstStatus as NewClientInput["gstStatus"],
      ...(registered ? { gstin: f.tax.gstin.replace(/\s/g, "").toUpperCase() } : {}),
      ...(f.tax.gstStatus !== "overseas" && f.tax.stateCode ? { stateCode: f.tax.stateCode } : {}),
      currency: f.currency,
      ...(svc ? { serviceAddress: svc } : {}),
      ...(tags.length ? { tags } : {}),
      ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
      ...(contact ? { contact } : {}),
    };
    try {
      const r = await api.createClient(body);
      toast("success", `Added client ${r.code}.`);
      setSaved(r.id);
    } catch (err) {
      const field = err instanceof RequestError ? fieldOfError(err.code) : null;
      if (err instanceof RequestError && field) {
        const id = field === "email" ? `${P}-c-email` : `${P}-${field}`;
        setErrors([{ id, text: sentence(err.message) }]);
        setSubmits((n) => n + 1);
      } else setFailure(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <UnsavedChangesGuard dirty={dirty} what="this client" />
      <PageHeader title="New client" crumbs={CRUMBS} />
      <form className="settings-form client-new" onSubmit={submit} noValidate>
        <p className="hint form-intro">All fields are needed unless marked optional.</p>
        <ErrorSummary errors={errors} focusKey={submits} />
        {failure && <Notice tone="error">{failure}</Notice>}

        <fieldset className="form-section">
          <legend>Client</legend>
          <fieldset className="radios">
            <legend>Type</legend>
            <div className="segmented">
              {(["business", "individual"] as const).map((t) => (
                <label key={t} className="segmented__opt">
                  <input
                    type="radio"
                    name={`${P}-type`}
                    value={t}
                    checked={f.type === t}
                    onChange={() => set({ type: t })}
                  />
                  {TYPE_LABELS[t]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="form-grid">
            <FormField id={`${P}-legalName`} label="Legal name" error={errorOf(`${P}-legalName`)}>
              {(a) => (
                <input
                  {...a}
                  autoComplete="off"
                  maxLength={200}
                  value={f.legalName}
                  onChange={(e) => set({ legalName: e.target.value })}
                />
              )}
            </FormField>
            <FormField id={`${P}-displayName`} label="Display name" optional>
              {(a) => (
                <input
                  {...a}
                  autoComplete="off"
                  maxLength={120}
                  value={f.displayName}
                  onChange={(e) => set({ displayName: e.target.value })}
                />
              )}
            </FormField>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Tax and currency</legend>
          <div className="form-grid tax-grid">
            <TaxFields
              prefix={P}
              value={f.tax}
              onChange={(patch) => {
                const tax = { ...f.tax, ...patch };
                // A new country brings its usual currency (still changeable), as in the convert dialog.
                set({
                  tax,
                  ...(patch.country && patch.country !== f.tax.country
                    ? {
                        currency: patch.country === "IN" ? "INR" : "USD",
                        svc: { ...f.svc, country: patch.country },
                      }
                    : {}),
                });
                setErrors((x) =>
                  x.filter((e) => !e.id.startsWith(`${P}-gstin`) && !e.id.startsWith(`${P}-state`)),
                );
              }}
              errors={{
                country: errorOf(`${P}-country`),
                gstin: errorOf(`${P}-gstin`),
                stateCode: errorOf(`${P}-stateCode`),
              }}
              checked={checked}
              onChecked={setChecked}
            />
          </div>
          <fieldset className="radios" id={`${P}-currency`} tabIndex={-1}>
            <legend>Currency</legend>
            <div className="segmented">
              {(["INR", "USD"] as const).map((cur) => (
                <label key={cur} className="segmented__opt">
                  <input
                    type="radio"
                    name={`${P}-currency`}
                    value={cur}
                    checked={f.currency === cur}
                    onChange={() => set({ currency: cur })}
                  />
                  {CURRENCY_LABELS[cur]}
                </label>
              ))}
            </div>
            <p className="hint">The currency can't change once this client has an invoice or a payment.</p>
          </fieldset>
          <VerifyNote>The GST treatment is confirmed on the proposal and the invoice.</VerifyNote>
        </fieldset>

        <fieldset className="form-section">
          <legend>
            Service address<span className="field__optional"> (optional)</span>
          </legend>
          <AddressFields
            prefix={`${P}-svc`}
            value={f.svc}
            onChange={(patch) => set({ svc: { ...f.svc, ...patch } })}
            error={errorOf}
          />
        </fieldset>

        <fieldset className="form-section">
          <legend>Tags and notes</legend>
          <FormField id={`${P}-tags`} label="Tags" optional hint="Separate tags with commas.">
            {(a) => (
              <input
                {...a}
                autoComplete="off"
                value={f.tags}
                onChange={(e) => set({ tags: e.target.value })}
              />
            )}
          </FormField>
          <FormField id={`${P}-notes`} label="Notes" optional>
            {(a) => (
              <textarea
                {...a}
                rows={4}
                maxLength={4000}
                value={f.notes}
                onChange={(e) => set({ notes: e.target.value })}
              />
            )}
          </FormField>
        </fieldset>

        <fieldset className="form-section">
          <legend>
            First contact<span className="field__optional"> (optional)</span>
          </legend>
          <p className="hint">The first contact becomes the client's primary contact.</p>
          <div className="form-grid">
            <FormField id={`${P}-c-name`} label="Name" error={errorOf(`${P}-c-name`)}>
              {(a) => (
                <input
                  {...a}
                  autoComplete="off"
                  maxLength={100}
                  value={c.name}
                  onChange={(e) => setContact({ name: e.target.value })}
                />
              )}
            </FormField>
            <FormField id={`${P}-c-email`} label="Email" error={errorOf(`${P}-c-email`)}>
              {(a) => (
                <input
                  {...a}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                  value={c.email}
                  onChange={(e) => setContact({ email: e.target.value })}
                />
              )}
            </FormField>
            <FormField id={`${P}-c-phone`} label="Phone" optional>
              {(a) => (
                <input
                  {...a}
                  type="tel"
                  autoComplete="off"
                  maxLength={40}
                  value={c.phone}
                  onChange={(e) => setContact({ phone: e.target.value })}
                />
              )}
            </FormField>
            <FormField id={`${P}-c-title`} label="Role or title" optional>
              {(a) => (
                <input
                  {...a}
                  autoComplete="off"
                  maxLength={80}
                  value={c.title}
                  onChange={(e) => setContact({ title: e.target.value })}
                />
              )}
            </FormField>
          </div>
          <ContactSwitches
            prefix={`${P}-c`}
            isBilling={c.isBilling}
            portalAccess={c.portalAccess}
            canSeeFinance={canSeeFinance}
            marketingConsent={c.marketingConsent}
            onChange={(patch) => setContact(patch)}
          />
        </fieldset>

        <div className="actions-row client-new__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => navigate("/clients")}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Adding…" : "Add client"}
          </button>
        </div>
      </form>
    </>
  );
}
