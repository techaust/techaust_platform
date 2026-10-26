// A lead entered by hand (M3.2, ADM-LEAD-01): a call, an email or a meeting becomes a lead with source "Added by hand".
// Name and email are required, every other field is marked optional (owner decision 2026-10-24). The API links it to
// an earlier lead with the same email within 30 days (FRM-04) and tells the others through the bell. On success the
// new lead's page opens.
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api, errorText, RequestError } from "../../api.ts";
import { DateField, useUnreadDates } from "../../components/date-field.tsx";
import { PageHeader } from "../../components/display.tsx";
import { ErrorSummary, FormField, type SummaryError } from "../../components/form.tsx";
import { useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import { dateError } from "../../lib/date-field.ts";
import { countryOptions, dateToMs, SERVICE_OPTIONS } from "../../lib/leads.ts";
import { CRUMBS, LeadsGate } from "./parts.tsx";

export function Component() {
  return (
    <LeadsGate>
      <NewLead />
    </LeadsGate>
  );
}

const EMPTY = {
  name: "",
  email: "",
  phone: "",
  company: "",
  country: "",
  serviceCode: "",
  message: "",
  ownerId: "",
  date: "",
  note: "",
};
type Form = typeof EMPTY;
const opt = (v: string) => (v.trim() ? v.trim() : null);

function NewLead() {
  const navigate = useNavigate();
  const toast = useToast();
  const people = useLoad(() => api.leadAssignees(), "");
  const [f, setF] = useState<Form>(EMPTY);
  const dates = useUnreadDates<"date">();
  const [errors, setErrors] = useState<SummaryError[]>([]);
  const [submits, setSubmits] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const dirty = !saved && (dates.any || JSON.stringify(f) !== JSON.stringify(EMPTY));
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));
  const errorOf = (id: string) => errors.find((e) => e.id === id)?.text;
  // Open the new lead once the form no longer counts as unsaved (the leave-without-saving guard has seen it).
  useEffect(() => {
    if (saved) navigate(`/leads/${saved}`, { replace: true });
  }, [saved, navigate]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: SummaryError[] = [];
    if (!f.name.trim()) errs.push({ id: "nl-name", text: "Enter the contact's name." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()))
      errs.push({ id: "nl-email", text: "Enter an email address, like name@example.com." });
    const dateErr = dateError(dates.unread.date);
    if (dateErr) errs.push({ id: "nl-date", text: dateErr });
    setErrors(errs);
    setSubmits((n) => n + 1);
    if (errs.length) return;
    setBusy(true);
    setFailure(null);
    try {
      const r = await api.createLead({
        name: f.name.trim(),
        email: f.email.trim(),
        phone: opt(f.phone),
        company: opt(f.company),
        country: f.country || null,
        serviceCode: f.serviceCode || null,
        message: opt(f.message),
        ownerId: f.ownerId || null,
        nextActionAt: f.date ? dateToMs(f.date) : null,
        nextActionNote: opt(f.note),
      });
      toast("success", `Added lead ${r.ref}.`);
      setSaved(r.id);
    } catch (err) {
      setFailure(
        err instanceof RequestError && err.code === "owner_invalid" ? `${err.message}.` : errorText(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <UnsavedChangesGuard dirty={dirty} what="this lead" />
      <PageHeader title="New lead" crumbs={CRUMBS} />
      <form className="settings-form lead-new" onSubmit={submit} noValidate>
        <ErrorSummary errors={errors} focusKey={submits} />
        {failure && <Notice tone="error">{failure}</Notice>}
        <fieldset className="form-section">
          <legend>Contact</legend>
          <div className="form-grid">
            <FormField id="nl-name" label="Name" error={errorOf("nl-name")}>
              {(a) => (
                <input
                  {...a}
                  autoComplete="off"
                  maxLength={100}
                  value={f.name}
                  onChange={(e) => set({ name: e.target.value })}
                />
              )}
            </FormField>
            <FormField id="nl-email" label="Email" error={errorOf("nl-email")}>
              {(a) => (
                <input
                  {...a}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                  value={f.email}
                  onChange={(e) => set({ email: e.target.value })}
                />
              )}
            </FormField>
            <FormField id="nl-phone" label="Phone" optional>
              {(a) => (
                <input
                  {...a}
                  type="tel"
                  autoComplete="off"
                  maxLength={40}
                  value={f.phone}
                  onChange={(e) => set({ phone: e.target.value })}
                />
              )}
            </FormField>
            <FormField id="nl-company" label="Company" optional>
              {(a) => (
                <input
                  {...a}
                  autoComplete="off"
                  maxLength={120}
                  value={f.company}
                  onChange={(e) => set({ company: e.target.value })}
                />
              )}
            </FormField>
            <FormField id="nl-country" label="Country" optional>
              {(a) => (
                <select {...a} value={f.country} onChange={(e) => set({ country: e.target.value })}>
                  <option value="">Not given</option>
                  {countryOptions().map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Enquiry</legend>
          <div className="form-grid">
            <FormField id="nl-service" label="Service" optional>
              {(a) => (
                <select {...a} value={f.serviceCode} onChange={(e) => set({ serviceCode: e.target.value })}>
                  <option value="">General enquiry</option>
                  {SERVICE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          </div>
          <FormField id="nl-message" label="Message" optional>
            {(a) => (
              <textarea
                {...a}
                rows={5}
                maxLength={2000}
                value={f.message}
                onChange={(e) => set({ message: e.target.value })}
              />
            )}
          </FormField>
        </fieldset>

        <fieldset className="form-section">
          <legend>Pipeline</legend>
          <div className="form-grid">
            <FormField id="nl-owner" label="Owner" optional>
              {(a) => (
                <select {...a} value={f.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
                  <option value="">Unassigned</option>
                  {(people.data?.assignees ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || "Name not set yet"}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField id="nl-date" label="Next action" optional error={errorOf("nl-date")}>
              {(a) => (
                <DateField {...a} {...dates.bind("date")} value={f.date} onChange={(v) => set({ date: v })} />
              )}
            </FormField>
          </div>
          <FormField id="nl-note" label="Next action note" optional>
            {(a) => (
              <textarea
                {...a}
                rows={2}
                maxLength={500}
                value={f.note}
                onChange={(e) => set({ note: e.target.value })}
              />
            )}
          </FormField>
        </fieldset>

        <div className="actions-row lead-new__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => navigate("/leads")}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Adding…" : "Add lead"}
          </button>
        </div>
      </form>
    </>
  );
}
