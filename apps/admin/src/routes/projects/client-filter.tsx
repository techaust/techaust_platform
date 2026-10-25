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

type Picked = { id: string; displayName: string; code: string };

export function ClientFilter(props: {
  clientId: string;
  onChange: (id: string | null, picked?: Picked) => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const term = useDebounced(q.trim().length >= 2 ? q.trim() : "");
  const found = useLoad(() => (term ? api.clients({ q: term }) : Promise.resolve(null)), term);
  // The chosen row comes up from the search results; the client is fetched only when the page was opened from a bare URL.
  const known = picked && picked.id === props.clientId ? picked : null;
  const chosen = useLoad(
    () => (props.clientId && !known ? api.client(props.clientId) : Promise.resolve(null)),
    known ? "" : props.clientId,
  );

  // The filter was cleared from outside (Clear filters, the chip): forget the search and its results.
  useEffect(() => {
    if (!props.clientId) {
      setQ("");
      setPicked(null);
    }
  }, [props.clientId]);

  if (props.clientId) {
    const c = known ?? chosen.data?.client;
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
            <span className="visually-hidden">{PENDING.clientFilterClear}</span>
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
            placeholder={PENDING.clientFilterHint}
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
                ? PENDING.clientsFound(rows.length)
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
                <button
                  type="button"
                  onClick={() => {
                    const row = { id: c.id, displayName: c.displayName, code: c.code };
                    setPicked(row);
                    props.onChange(c.id, row);
                  }}
                >
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
