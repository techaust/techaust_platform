// "New proposal or estimate" (M4.3, ADM-PROP-01, ADM-EST-01): for a client or for a lead that was converted to one, the type, and the
// services (1 to 10). A service with default lines asks which lines to offer. The server builds the draft from the matching template
// (sections, lines, payment schedule) in one batch; the dialog then opens the draft. Native radios and checkboxes, so arrow keys and
// Space work; every choice is labelled; errors sit next to what they are about and the first one takes focus.
import { useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api, type CatalogueEntry, type ClientView, catalogueApi, type LeadItem } from "../../api.ts";
import { Modal } from "../../components/dialog.tsx";
import { Search } from "../../components/icons.tsx";
import { useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { CATEGORY_LABELS } from "../../lib/catalogue.ts";
import {
  chooseDefaultLines,
  DOC_COPY,
  DOC_PENDING,
  DOC_TOASTS,
  docErrorText,
  moneyText,
  TYPE_LABELS,
} from "../../lib/documents.ts";
import { documentsApi, type QuoteType } from "../../lib/documents-api.ts";
import { useDebounced } from "../projects/client-filter.tsx";
import { ClientPicker } from "../projects/new.tsx";
import { docHref } from "./parts.tsx";

const MAX_SERVICES = 10;
const P = "nd";

export function NewDocumentDialog(props: {
  open: boolean;
  type: QuoteType;
  /** The client page and a filtered list open the dialog for one client. */
  clientId?: string | undefined;
  onClose: () => void;
}) {
  return (
    <Modal open={props.open} title={DOC_COPY.createTitle} onClose={props.onClose} wide>
      {props.open && <NewDocumentForm {...props} />}
    </Modal>
  );
}

type Errors = Partial<Record<"who" | "services" | "lines" | "form", string | undefined>>;

function NewDocumentForm(props: { type: QuoteType; clientId?: string | undefined; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [mode, setMode] = useState<"client" | "lead">("client");
  const [type, setType] = useState<QuoteType>(props.type);
  const [client, setClient] = useState<ClientView | null>(null);
  const [changing, setChanging] = useState(!props.clientId);
  const [lead, setLead] = useState<LeadItem | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [lines, setLines] = useState<Record<string, string[]>>({});
  const [entries, setEntries] = useState<Record<string, CatalogueEntry | "loading" | "failed">>({});
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const preset = useLoad(
    () => (props.clientId ? api.client(props.clientId) : Promise.resolve(null)),
    props.clientId ?? "",
  );
  useEffect(() => {
    if (preset.state === "ready" && preset.data && !client) setClient(preset.data.client);
  }, [preset, client]);
  const services = useLoad(() => catalogueApi.list({ active: "1", limit: "50" }), "");
  const items = services.state === "ready" ? services.data.items : [];
  const currency = mode === "lead" ? null : (client?.currency ?? null);

  function toggle(id: string, on: boolean) {
    setErrors((e) => ({ ...e, services: undefined, lines: undefined }));
    if (!on) {
      setChosen((c) => c.filter((x) => x !== id));
      return;
    }
    if (chosen.length >= MAX_SERVICES) return;
    setChosen((c) => [...c, id]);
    if (!entries[id]) {
      setEntries((m) => ({ ...m, [id]: "loading" }));
      catalogueApi.item(id).then(
        (r) => setEntries((m) => ({ ...m, [id]: r.item })),
        () => setEntries((m) => ({ ...m, [id]: "failed" })),
      );
    }
  }

  async function submit() {
    const e: Errors = {};
    const clientId = mode === "lead" ? lead?.clientId : client?.id;
    if (mode === "lead" && !lead) e.who = DOC_PENDING.pickLead;
    else if (mode === "lead" && lead && !lead.clientId) e.who = DOC_PENDING.leadNoClient;
    else if (!clientId) e.who = DOC_PENDING.pickClient;
    if (chosen.length === 0) e.services = DOC_PENDING.pickServices;
    const missing = chosen.find((id) => {
      const it = entries[id];
      return typeof it === "object" && (it.defaultLines?.length ?? 0) > 0 && (lines[id]?.length ?? 0) === 0;
    });
    if (missing) {
      const it = entries[missing] as CatalogueEntry;
      e.lines = `${chooseDefaultLines(it.name)}.`;
    }
    setErrors(e);
    const first = e.who
      ? `${P}-who`
      : e.services
        ? `${P}-services`
        : e.lines
          ? `${P}-lines-${missing}`
          : null;
    if (first) {
      requestAnimationFrame(() => document.getElementById(first)?.focus());
      return;
    }
    setBusy(true);
    try {
      const made = await documentsApi.create({
        type,
        clientId: clientId as string,
        ...(mode === "lead" && lead ? { leadId: lead.id } : {}),
        services: chosen.map((id) => {
          const it = entries[id];
          const picked = lines[id] ?? [];
          return typeof it === "object" && (it.defaultLines?.length ?? 0) > 0
            ? { catalogueItemId: id, defaultLines: picked }
            : { catalogueItemId: id };
        }),
      });
      toast("success", DOC_TOASTS.created);
      props.onClose();
      navigate(docHref({ id: made.id, type }));
    } catch (err) {
      const svc = items.find((i) => chosen.includes(i.id));
      setErrors({ form: docErrorText(err, { service: svc?.name, currency: client?.currency }) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="new-doc"
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        submit();
      }}
    >
      <div className="dialog__body new-doc__body">
        <p className="hint">{DOC_COPY.createHint}</p>

        <fieldset className="radios seg">
          <legend className="visually-hidden">
            {DOC_COPY.forClient} or {DOC_COPY.forLead.toLowerCase()}
          </legend>
          <div className="seg__row">
            {(["client", "lead"] as const).map((m) => (
              <label key={m} className="radio seg__opt">
                <input
                  type="radio"
                  name={`${P}-mode`}
                  checked={mode === m}
                  onChange={() => {
                    setMode(m);
                    setErrors({});
                  }}
                />
                {m === "client" ? DOC_COPY.forClient : DOC_COPY.forLead}
              </label>
            ))}
          </div>
        </fieldset>

        <div id={`${P}-who`} tabIndex={-1} className="new-doc__who">
          {mode === "client" ? (
            client && !changing ? (
              <div className="chosen-client">
                <p className="chosen-client__name">
                  {client.displayName}
                  <span className="docno">{client.code}</span>
                  <span className="docno">{client.currency}</span>
                </p>
                <button type="button" className="btn btn--text" onClick={() => setChanging(true)}>
                  Change<span className="visually-hidden"> the client</span>
                </button>
              </div>
            ) : (
              <ClientPicker
                prefix={P}
                chosen={client}
                error={undefined}
                onChoose={(c) => {
                  setClient(c);
                  setChanging(false);
                  setErrors((e) => ({ ...e, who: undefined }));
                }}
              />
            )
          ) : (
            <LeadPicker
              chosen={lead}
              onChoose={(l) => {
                setLead(l);
                setErrors((e) => ({ ...e, who: undefined }));
              }}
            />
          )}
          {errors.who && <FieldError id={`${P}-who-error`}>{errors.who}</FieldError>}
        </div>

        <fieldset className="radios">
          <legend>{DOC_COPY.type}</legend>
          <div className="seg__row">
            {(["proposal", "estimate"] as const).map((t) => (
              <label key={t} className="radio seg__opt">
                <input type="radio" name={`${P}-type`} checked={type === t} onChange={() => setType(t)} />
                {TYPE_LABELS[t]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset
          className="radios svc-pick"
          id={`${P}-services`}
          tabIndex={-1}
          aria-describedby={errors.services ? `${P}-services-error` : undefined}
        >
          <legend>{DOC_COPY.services}</legend>
          {services.state === "loading" && (
            <p className="hint" role="status">
              Loading…
            </p>
          )}
          {services.state === "failed" && <Notice tone="error">{docErrorText(services.error)}</Notice>}
          <ul className="svc-pick__list">
            {items.map((it) => {
              const on = chosen.includes(it.id);
              const entry = entries[it.id];
              const price =
                currency === "USD" ? it.priceUsdMinor : currency === "INR" ? it.priceInrMinor : null;
              return (
                <li key={it.id} className={on ? "svc-pick__item svc-pick__item--on" : "svc-pick__item"}>
                  <label className="check svc-pick__check">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!on && chosen.length >= MAX_SERVICES}
                      onChange={(ev) => toggle(it.id, ev.target.checked)}
                    />
                    <span className="svc-pick__text">
                      <span className="svc-pick__name">{it.name}</span>
                      <span className="svc-pick__meta">
                        <span className="docno">{it.code}</span>
                        <span>{CATEGORY_LABELS[it.category]}</span>
                        {price !== null && currency && (
                          <span className="tnum">{moneyText(price, currency)}</span>
                        )}
                      </span>
                    </span>
                  </label>
                  {on && entry === "loading" && (
                    <p className="hint svc-pick__lines" role="status">
                      Loading…
                    </p>
                  )}
                  {on && entry === "failed" && (
                    <p className="hint svc-pick__lines">{DOC_PENDING.linesLoadFailed}</p>
                  )}
                  {on && typeof entry === "object" && (entry.defaultLines?.length ?? 0) > 0 && (
                    <DefaultLines
                      entry={entry}
                      currency={currency}
                      picked={lines[it.id] ?? []}
                      error={errors.lines?.includes(entry.name) ? errors.lines : undefined}
                      onChange={(picked) => {
                        setLines((m) => ({ ...m, [it.id]: picked }));
                        setErrors((e) => ({ ...e, lines: undefined }));
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {errors.services && <FieldError id={`${P}-services-error`}>{errors.services}</FieldError>}
        </fieldset>
        {errors.form && <Notice tone="error">{errors.form}</Notice>}
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Working…" : DOC_COPY.createButton}
        </button>
      </div>
    </form>
  );
}

function DefaultLines(props: {
  entry: CatalogueEntry;
  currency: "INR" | "USD" | null;
  picked: string[];
  error: string | undefined;
  onChange: (picked: string[]) => void;
}) {
  const id = `${P}-lines-${props.entry.id}`;
  return (
    <fieldset
      className="radios svc-pick__lines"
      id={id}
      tabIndex={-1}
      aria-describedby={props.error ? `${id}-error` : undefined}
    >
      <legend>{chooseDefaultLines(props.entry.name)}</legend>
      {(props.entry.defaultLines ?? []).map((l) => {
        const rate =
          props.currency === "USD" ? l.rateUsdMinor : props.currency === "INR" ? l.rateInrMinor : null;
        const on = props.picked.includes(l.description);
        return (
          <label key={l.description} className="check svc-pick__line">
            <input
              type="checkbox"
              checked={on}
              onChange={(ev) =>
                props.onChange(
                  ev.target.checked
                    ? [...props.picked, l.description]
                    : props.picked.filter((x) => x !== l.description),
                )
              }
            />
            <span>{l.description}</span>
            {rate !== null && rate !== undefined && props.currency && (
              <span className="tnum svc-pick__rate">{moneyText(rate, props.currency)}</span>
            )}
          </label>
        );
      })}
      {props.error && <FieldError id={`${id}-error`}>{props.error}</FieldError>}
    </fieldset>
  );
}

/** A lead converted to a client: the start of its reference or email (GET /leads, the list's own search). */
function LeadPicker(props: { chosen: LeadItem | null; onChoose: (l: LeadItem) => void }) {
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim().length >= 2 ? q.trim() : "");
  const found = useLoad(() => api.leads({ q: term || undefined }), term);
  const rows = useMemo(() => (found.state === "ready" ? found.data.leads : []), [found]);
  const qId = useId();
  return (
    <div className="client-picker">
      <div className="field field-icon-wrap">
        <label htmlFor={qId}>{DOC_PENDING.chooseLead}</label>
        <div className="field-icon">
          <Search size={20} />
          <input id={qId} type="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <fieldset className="radios client-picker__list" aria-busy={found.state === "loading" || undefined}>
        <legend className="visually-hidden">{DOC_COPY.forLead}</legend>
        {found.state === "loading" ? (
          <p className="hint" role="status">
            Loading…
          </p>
        ) : (
          rows.map((l) => (
            <label key={l.id} className="radio client-option">
              <input
                type="radio"
                name={`${P}-lead`}
                value={l.id}
                checked={props.chosen?.id === l.id}
                onChange={() => props.onChoose(l)}
              />
              <span className="client-option__text">
                <span className="client-option__name">{l.company ?? l.name}</span>
                <span className="client-option__meta">
                  <span className="docno">{l.ref}</span>
                  {l.serviceName && <span>{l.serviceName}</span>}
                  {!l.clientId && <span className="muted">{DOC_PENDING.leadNoClient}</span>}
                </span>
              </span>
            </label>
          ))
        )}
      </fieldset>
    </div>
  );
}
