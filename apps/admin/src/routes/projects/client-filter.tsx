// The Projects list's client filter (M3.4 review): the same search as New project (the start of a client code or name, GET /clients,
// asked for after a short pause in typing), instead of a menu of the newest 50 clients. The chosen client lives in the URL
// (`?client=`), shows as a removable chip, and its name is read from GET /clients/:id, so a link to the list always shows it.
import { useEffect, useState } from "react";
import { api, errorText } from "../../api.ts";
import { Search, X } from "../../components/icons.tsx";
import { useLoad } from "../../components/states.tsx";
import { PENDING } from "../../lib/projects.ts";

/** A value that follows `value` after `ms` of quiet. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ClientFilter(props: { clientId: string; onChange: (id: string | null) => void }) {
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim().length >= 2 ? q.trim() : "");
  const found = useLoad(() => (term ? api.clients({ q: term }) : Promise.resolve(null)), term);
  const chosen = useLoad(
    () => (props.clientId ? api.client(props.clientId) : Promise.resolve(null)),
    props.clientId,
  );

  if (props.clientId) {
    const c = chosen.data?.client;
    return (
      <div className="client-filter">
        <span className="chips__label" id="project-client-label">
          Client
        </span>
        <span className="client-filter__chosen">
          <span className="client-filter__name">{c ? c.displayName : "This client"}</span>
          {c && <span className="docno">{c.code}</span>}
          <button
            type="button"
            className="client-filter__remove"
            onClick={() => {
              setQ("");
              props.onChange(null);
              requestAnimationFrame(() => document.getElementById("project-client-q")?.focus());
            }}
          >
            <X size={16} />
            <span className="visually-hidden">Show projects of all clients</span>
          </button>
        </span>
      </div>
    );
  }

  const rows = found.state === "ready" ? (found.data?.clients ?? []) : [];
  return (
    <div className="client-filter">
      <label className="chips__label" htmlFor="project-client-q">
        Client
      </label>
      <div className="client-filter__search">
        <div className="field-icon">
          <Search size={20} />
          <input
            id="project-client-q"
            type="search"
            autoComplete="off"
            placeholder="Start of a code or name"
            aria-describedby="project-client-status"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <p id="project-client-status" className="visually-hidden" role="status">
          {found.state === "loading" && term
            ? "Loading…"
            : term && rows.length === 0 && found.state === "ready"
              ? PENDING.noClientMatch
              : term && found.state === "ready"
                ? `${rows.length} clients found`
                : ""}
        </p>
        {term && found.state === "failed" && <p className="hint">{errorText(found.error)}</p>}
        {term && found.state === "ready" && rows.length === 0 && (
          <p className="hint">{PENDING.noClientMatch}</p>
        )}
        {rows.length > 0 && (
          <ul className="client-filter__results">
            {rows.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => props.onChange(c.id)}>
                  <span className="client-filter__name">{c.displayName}</span>
                  <span className="docno">{c.code}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
