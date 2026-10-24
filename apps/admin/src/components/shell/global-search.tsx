// Global search (ADM-G-05): the WAI-ARIA combobox with a grouped listbox. Arrow keys move through the results,
// Enter opens one, Escape closes the list (a second Escape clears the field). "/" anywhere outside a field jumps
// here. Below md the field folds into a search button that opens it across the top bar.
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Search, X } from "../icons.tsx";

export type SearchResult = { id: string; title: string; sub: string; href: string };
export type SearchGroup = { label: string; icon: ReactNode; results: SearchResult[] };

export function GlobalSearch(props: { search: (q: string) => SearchGroup[]; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [unfolded, setUnfolded] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const navigate = useNavigate();

  const term = q.trim();
  const groups = useMemo(
    () => (term.length >= 2 ? props.search(term).filter((g) => g.results.length) : []),
    [term, props.search],
  );
  const flat = groups.flatMap((g) => g.results);
  const count = flat.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      setUnfolded(true);
      requestAnimationFrame(() => input.current?.focus());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function go(r: SearchResult) {
    setOpen(false);
    setQ("");
    setUnfolded(false);
    navigate(r.href);
  }

  function fold() {
    setOpen(false);
    setUnfolded(false);
    opener.current?.focus();
  }

  return (
    <div className="gsearch" data-unfolded={unfolded || undefined} ref={wrap}>
      <button
        ref={opener}
        type="button"
        className="icon-btn gsearch__open"
        aria-label="Search"
        onClick={() => {
          setUnfolded(true);
          requestAnimationFrame(() => input.current?.focus());
        }}
      >
        <Search />
      </button>
      <div className="gsearch__field">
        <label htmlFor="gsearch-input" className="visually-hidden">
          Search
        </label>
        <Search size={20} />
        <input
          ref={input}
          id="gsearch-input"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          aria-describedby="gsearch-hint"
          placeholder={props.placeholder ?? "Search leads, clients, projects, documents"}
          autoComplete="off"
          spellCheck={false}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => (count ? (i + 1) % count : -1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (count ? (i <= 0 ? count - 1 : i - 1) : -1));
            } else if (e.key === "Enter") {
              const r = flat[active] ?? (count === 1 ? flat[0] : undefined);
              if (r) {
                e.preventDefault();
                go(r);
              }
            } else if (e.key === "Escape") {
              if (open && term) setOpen(false);
              else if (q) setQ("");
              else if (unfolded) fold();
            } else if (e.key === "Tab") setOpen(false);
          }}
        />
        <span className="gsearch__key" aria-hidden="true">
          /
        </span>
        <button type="button" className="icon-btn gsearch__fold" aria-label="Close search" onClick={fold}>
          <X />
        </button>
        <span id="gsearch-hint" className="visually-hidden">
          Type at least 2 characters. Press slash to come back here from anywhere.
        </span>
      </div>
      <div className="gsearch__panel" hidden={!open}>
        <div id={listId} role="listbox" aria-label="Search results" className="gsearch__list">
          {groups.map((g) => {
            const gid = `${listId}-g-${g.label}`;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a group inside a listbox (WAI-ARIA combobox pattern)
              <div key={g.label} role="group" aria-labelledby={gid} className="gsearch__group">
                <div id={gid} role="presentation" className="gsearch__group-label">
                  {g.label}
                </div>
                {g.results.map((r) => {
                  const i = flat.indexOf(r);
                  return (
                    <div
                      key={r.id}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      className="gsearch__option"
                      tabIndex={-1}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => go(r)}
                      onKeyDown={() => undefined}
                      onMouseMove={() => setActive(i)}
                    >
                      <span className="gsearch__icon">{g.icon}</span>
                      <span className="gsearch__text">
                        <span className="gsearch__title">{r.title}</span>
                        <span className="gsearch__sub">{r.sub}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {term.length < 2 && (
          <p className="gsearch__msg">Search leads, clients, contacts, projects and documents by number.</p>
        )}
        {term.length >= 2 && count === 0 && <p className="gsearch__msg">Nothing matches “{term}”.</p>}
      </div>
      <p className="visually-hidden" role="status">
        {open && term.length >= 2 ? (count === 1 ? "1 result" : `${count} results`) : ""}
      </p>
    </div>
  );
}
