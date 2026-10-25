// A project added by hand (M3.4, ADM-PRJ-01): the client (chosen from a search of clients, or set by the client page's link
// `?client=`), the name, an owner, the start and target dates and an optional budget in the client's currency (shown, not
// chosen: a project uses its client's currency). The code (PRJ-0001 ...) is the server's, given on save. A project made from
// an accepted proposal arrives with proposals (M4.5). On success the project's page opens.
import { type FormEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api, type ClientView, errorText, RequestError } from "../../api.ts";
import { PageHeader } from "../../components/display.tsx";
import { ErrorSummary, FormField, type SummaryError } from "../../components/form.tsx";
import { Lock, Search } from "../../components/icons.tsx";
import { NoAccess, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import { allowed } from "../../lib/access.ts";
import { type DetailsForm, detailsErrors, PENDING, projectErrorText, TOASTS } from "../../lib/projects.ts";
import { moneyFrom } from "../../lib/settings-form.ts";
import { useUser } from "../../session.tsx";
import { CRUMBS, MoneyIn, ProjectsGate } from "./parts.tsx";

export function Component() {
  const user = useUser();
  return (
    <ProjectsGate>
      {allowed(user.role, "projects.write") ? (
        <NewProject />
      ) : (
        <NoAccess what="New project" crumbs={CRUMBS} />
      )}
    </ProjectsGate>
  );
}

const P = "np";
const EMPTY: DetailsForm = { name: "", ownerId: "", startDate: "", targetDate: "", budget: "" };
const FIELD_OF: Record<string, keyof DetailsForm> = { dates_order: "targetDate", bad_owner: "ownerId" };

function NewProject() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const preset = params.get("client");
  const [client, setClient] = useState<ClientView | null>(null);
  const [picking, setPicking] = useState(!preset);
  const [f, setF] = useState<DetailsForm>(EMPTY);
  const [errors, setErrors] = useState<SummaryError[]>([]);
  const [submits, setSubmits] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const people = useLoad(() => api.leadAssignees(), "");
  // A client named by the link (the client page's "New project"): loaded once, then shown as chosen.
  const presetLoad = useLoad(() => (preset ? api.client(preset) : Promise.resolve(null)), preset ?? "");
  const [presetSeen, setPresetSeen] = useState(false);
  if (!presetSeen && presetLoad.state === "ready") {
    setPresetSeen(true);
    if (presetLoad.data) setClient(presetLoad.data.client);
    else setPicking(true);
  }
  if (!presetSeen && presetLoad.state === "failed") {
    setPresetSeen(true);
    setPicking(true);
  }

  const set = (patch: Partial<DetailsForm>) => setF((x) => ({ ...x, ...patch }));
  const dirty = !saved && (client !== null || JSON.stringify(f) !== JSON.stringify(EMPTY));
  const errorOf = (id: string) => errors.find((e) => e.id === id)?.text;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const list: SummaryError[] = [];
    if (!client) list.push({ id: `${P}-client-q`, text: PENDING.chooseClient });
    const errs = client ? detailsErrors(f, client.currency) : detailsErrors(f, "INR");
    for (const [k, v] of Object.entries(errs)) if (v) list.push({ id: `${P}-${k}`, text: v });
    setErrors(list);
    setSubmits((n) => n + 1);
    if (list.length || !client) return;
    setBusy(true);
    setFailure(null);
    const budget = f.budget.trim() ? moneyFrom(f.budget, client.currency) : null;
    try {
      const r = await api.createProject({
        clientId: client.id,
        name: f.name.trim(),
        ...(f.ownerId ? { ownerId: f.ownerId } : {}),
        ...(f.startDate ? { startDate: f.startDate } : {}),
        ...(f.targetDate ? { targetDate: f.targetDate } : {}),
        ...(budget?.ok ? { budgetMinor: budget.minor } : {}),
      });
      toast("success", TOASTS.projectAdded);
      setSaved(true);
      navigate(`/projects/${r.id}`, { replace: true });
    } catch (err) {
      const field = err instanceof RequestError ? FIELD_OF[err.code] : undefined;
      if (field) {
        setErrors([{ id: `${P}-${field}`, text: projectErrorText(err) }]);
        setSubmits((n) => n + 1);
      } else setFailure(err instanceof RequestError ? projectErrorText(err) : errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <UnsavedChangesGuard dirty={dirty} what="this project" />
      <PageHeader title="New project" crumbs={CRUMBS} />
      <form className="settings-form client-new project-new" onSubmit={submit} noValidate>
        <p className="hint form-intro">All fields are needed unless marked optional.</p>
        <ErrorSummary errors={errors} focusKey={submits} />
        {failure && <Notice tone="error">{failure}</Notice>}

        <fieldset className="form-section">
          <legend>Client</legend>
          {client && !picking ? (
            <div className="chosen-client">
              <p className="chosen-client__name">
                <span>{client.displayName}</span>
                <span className="docno client-code">{client.code}</span>
              </p>
              <button
                type="button"
                className="btn btn--text"
                onClick={() => {
                  setPicking(true);
                  requestAnimationFrame(() => document.getElementById(`${P}-client-q`)?.focus());
                }}
              >
                Change<span className="visually-hidden"> the client</span>
              </button>
            </div>
          ) : (
            <ClientPicker
              chosen={client}
              error={errorOf(`${P}-client-q`)}
              onChoose={(c) => {
                setClient(c);
                setErrors((x) => x.filter((e) => e.id !== `${P}-client-q`));
              }}
            />
          )}
          <div className="field">
            <span className="label-like" id={`${P}-currency-label`}>
              Currency
            </span>
            <p className="locked-value">
              {client ? (
                <span className="locked-inline">
                  <Lock size={16} />
                  <span className="docno">{client.currency}</span>
                </span>
              ) : (
                <span className="muted">Set by the client</span>
              )}
            </p>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Project</legend>
          <FormField id={`${P}-name`} label="Name" error={errorOf(`${P}-name`)}>
            {(a) => (
              <input
                {...a}
                autoComplete="off"
                maxLength={200}
                value={f.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            )}
          </FormField>
          <div className="form-grid">
            <FormField id={`${P}-ownerId`} label="Owner" optional error={errorOf(`${P}-ownerId`)}>
              {(a) => (
                <select {...a} value={f.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
                  <option value="">No owner</option>
                  {(people.data?.assignees ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === people.data?.me
                        ? `${p.name || "Name not set yet"} (you)`
                        : p.name || "Name not set yet"}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField id={`${P}-budget`} label="Budget" optional error={errorOf(`${P}-budget`)}>
              {(a) => (
                <MoneyIn
                  a11y={a}
                  currency={client?.currency ?? "INR"}
                  value={f.budget}
                  onChange={(v) => set({ budget: v })}
                />
              )}
            </FormField>
            <FormField id={`${P}-startDate`} label="Start date" optional error={errorOf(`${P}-startDate`)}>
              {(a) => (
                <input
                  {...a}
                  type="date"
                  value={f.startDate}
                  onChange={(e) => set({ startDate: e.target.value })}
                />
              )}
            </FormField>
            <FormField id={`${P}-targetDate`} label="Target date" optional error={errorOf(`${P}-targetDate`)}>
              {(a) => (
                <input
                  {...a}
                  type="date"
                  value={f.targetDate}
                  min={f.startDate || undefined}
                  onChange={(e) => set({ targetDate: e.target.value })}
                />
              )}
            </FormField>
          </div>
        </fieldset>

        <div className="actions-row client-new__actions">
          <button type="button" className="btn btn--secondary" onClick={() => navigate(-1)} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Adding…" : "Add project"}
          </button>
        </div>
      </form>
    </>
  );
}

/**
 * The client, chosen from the newest clients or a search by the start of a code or name (GET /clients, the list's own search):
 * native radios, so arrow keys move through the results and the choice is one field in the form.
 */
function ClientPicker(props: {
  chosen: ClientView | null;
  error: string | undefined;
  onChoose: (c: ClientView) => void;
}) {
  const [q, setQ] = useState("");
  const term = q.trim().length >= 2 ? q.trim() : "";
  const found = useLoad(() => api.clients({ q: term || undefined }), term);
  const rows = found.state === "ready" ? found.data.clients : [];
  return (
    <div className="client-picker">
      <FormField
        id={`${P}-client-q`}
        label="Search by the start of a client code or name"
        error={props.error}
        className="field-icon-wrap"
      >
        {(a) => (
          <div className="field-icon">
            <Search size={20} />
            <input {...a} type="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
      </FormField>
      <fieldset className="radios client-picker__list" aria-busy={found.state === "loading" || undefined}>
        <legend className="visually-hidden">Client</legend>
        {found.state === "failed" ? (
          <Notice tone="error">{errorText(found.error)}</Notice>
        ) : found.state === "loading" ? (
          <p className="hint" role="status">
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="hint" role="status">
            {PENDING.noClientMatch}
          </p>
        ) : (
          rows.map((c) => (
            <label key={c.id} className="client-option">
              <input
                type="radio"
                name={`${P}-client`}
                value={c.id}
                checked={props.chosen?.id === c.id}
                onChange={() => props.onChoose(c)}
              />
              <span className="client-option__text">
                <span className="client-option__name">{c.displayName}</span>
                <span className="client-option__meta">
                  <span className="docno">{c.code}</span>
                  <span className="docno">{c.currency}</span>
                </span>
              </span>
            </label>
          ))
        )}
      </fieldset>
    </div>
  );
}
