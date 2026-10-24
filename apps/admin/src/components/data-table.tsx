// Lists (docs/06 §5.3 DataTable and FilterBar; ADM-G-03). A plain <table> with a caption, `scope` headers and
// sortable columns (`aria-sort` on the header, a button inside it); below `md` the same rows render as cards that
// keep every label. Paging is keyset ("Previous" / "Next" from a cursor; no page numbers, no total count). Filters
// are chips that toggle (aria-pressed) and live in the URL, so a filtered list can be bookmarked and shared.
import { type ReactNode, useId, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  X,
} from "./icons.tsx";

export type SortDir = "asc" | "desc";
export type Sort = { key: string; dir: SortDir };

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean | undefined;
  align?: "end" | undefined;
  /** In the card layout (below md): the card's title, or hidden (shown elsewhere in the card). Default: a fact. */
  card?: "title" | "hidden" | undefined;
  width?: string | undefined;
};

export function DataTable<T>(props: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: Sort | undefined;
  onSort?: ((key: string) => void) | undefined;
  loading?: boolean | undefined;
  skeletonRows?: number | undefined;
  /** Shown instead of the table when there are no rows (and not loading). */
  empty?: ReactNode | undefined;
  actions?: ((row: T) => ReactNode) | undefined;
  /** A short line under each card title (e.g. the email under a name). */
  cardSub?: ((row: T) => ReactNode) | undefined;
}) {
  const { columns, rows, loading } = props;
  if (!loading && rows.length === 0 && props.empty) return <>{props.empty}</>;
  const n = props.skeletonRows ?? 5;
  const title = columns.find((c) => c.card === "title") ?? columns[0];
  const facts = columns.filter((c) => c !== title && c.card !== "hidden");

  return (
    <div className="dtable" aria-busy={loading || undefined}>
      {loading && (
        <p className="visually-hidden" role="status">
          Loading {props.caption.toLowerCase()}
        </p>
      )}
      <table className="dtable__table">
        <caption className="visually-hidden">{props.caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const sorted = props.sort?.key === c.key ? props.sort.dir : null;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={c.align === "end" ? "num" : undefined}
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={
                    c.sortable
                      ? sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : "none"
                      : undefined
                  }
                >
                  {c.sortable && props.onSort ? (
                    <button type="button" className="dtable__sort" onClick={() => props.onSort?.(c.key)}>
                      {c.header}
                      {sorted === "asc" ? (
                        <ArrowUp size={16} />
                      ) : sorted === "desc" ? (
                        <ArrowDown size={16} />
                      ) : (
                        <span className="dtable__sort-idle">
                          <ArrowUpDown size={16} />
                        </span>
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
            {props.actions && (
              <th scope="col" className="dtable__actions-h">
                <span className="visually-hidden">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: n }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
                // biome-ignore lint/a11y/noAriaHiddenOnFocusable: placeholder rows hold nothing focusable or readable
                <tr key={i} aria-hidden="true" className="dtable__skeleton">
                  {columns.map((c, j) => (
                    <td key={c.key}>
                      <span className="skeleton" style={{ width: `${[62, 38, 46, 54][(i + j) % 4]}%` }} />
                    </td>
                  ))}
                  {props.actions && <td />}
                </tr>
              ))
            : rows.map((r) => (
                <tr key={props.rowKey(r)}>
                  {columns.map((c, j) =>
                    j === 0 ? (
                      <th key={c.key} scope="row" className={c.align === "end" ? "num" : undefined}>
                        {c.cell(r)}
                      </th>
                    ) : (
                      <td key={c.key} className={c.align === "end" ? "num" : undefined}>
                        {c.cell(r)}
                      </td>
                    ),
                  )}
                  {props.actions && <td className="dtable__actions">{props.actions(r)}</td>}
                </tr>
              ))}
        </tbody>
      </table>

      {/* Below md: the same rows as cards, every value with its label. */}
      <ul className="dcards" aria-label={props.caption}>
        {loading
          ? Array.from({ length: Math.min(n, 3) }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
              <li key={i} className="dcard" aria-hidden="true">
                <span className="skeleton" style={{ width: "55%" }} />
                <span className="skeleton" style={{ width: "80%" }} />
                <span className="skeleton" style={{ width: "40%" }} />
              </li>
            ))
          : rows.map((r) => (
              <li key={props.rowKey(r)} className="dcard">
                <div className="dcard__head">
                  <div className="dcard__title">
                    {title?.cell(r)}
                    {props.cardSub && <div className="dcard__sub">{props.cardSub(r)}</div>}
                  </div>
                  {props.actions && <div className="dcard__actions">{props.actions(r)}</div>}
                </div>
                <dl className="dcard__facts">
                  {facts.map((c) => (
                    <div key={c.key}>
                      <dt>{c.header}</dt>
                      <dd>{c.cell(r)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
      </ul>
    </div>
  );
}

/** Keyset paging: where you are, Previous / Next, and the page size (25 or 50, ADM-G-03). */
export function Pager(props: {
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  pageSize: number;
  onPageSize: (n: number) => void;
  noun: string;
}) {
  return (
    <nav className="pager" aria-label="Pages">
      <p className="pager__where">
        {props.to === 0
          ? `No ${props.noun}`
          : `${props.noun[0]?.toUpperCase()}${props.noun.slice(1)} ${props.from}–${props.to}`}
      </p>
      <div className="pager__size">
        <label htmlFor="page-size">Rows per page</label>
        <select
          id="page-size"
          value={props.pageSize}
          onChange={(e) => props.onPageSize(Number(e.target.value))}
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
      </div>
      <div className="pager__buttons">
        <button type="button" className="btn btn--secondary" disabled={!props.hasPrev} onClick={props.onPrev}>
          <ChevronLeft size={20} />
          Previous
        </button>
        <button type="button" className="btn btn--secondary" disabled={!props.hasNext} onClick={props.onNext}>
          Next
          <ChevronRight size={20} />
        </button>
      </div>
    </nav>
  );
}

export type ChipGroup = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
};

/** Search plus chip groups. Every chip is a toggle button; "Clear filters" appears when anything is set. */
export function FilterBar(props: {
  searchLabel: string;
  query: string;
  onQuery: (q: string) => void;
  groups: ChipGroup[];
  onToggle: (group: string, value: string) => void;
  onClear: () => void;
  /** "4 users match", read out politely when it changes. */
  result: string;
  /** Filters that aren't chips (a select with many options), drawn after the chip groups and folded with them on phones. */
  extra?: ReactNode | undefined;
  /** How many of the `extra` filters are set (for "Clear filters" and the phone button's count). */
  extraOn?: number | undefined;
}) {
  const extraOn = props.extraOn ?? 0;
  const active = props.query !== "" || props.groups.some((g) => g.selected.length > 0) || extraOn > 0;
  const on = props.groups.reduce((n, g) => n + g.selected.length, 0) + extraOn;
  const [open, setOpen] = useState(false);
  const groupsId = useId();
  return (
    <section className="filters" aria-label="Filters" data-open={open || undefined} id={groupsId}>
      <div className="filters__search">
        <label htmlFor="filter-q">{props.searchLabel}</label>
        <div className="field-icon">
          <Search size={20} />
          <input
            id="filter-q"
            type="search"
            value={props.query}
            onChange={(e) => props.onQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
      <button
        type="button"
        className="btn btn--secondary filters__toggle"
        aria-expanded={open}
        aria-controls={groupsId}
        onClick={() => setOpen((o) => !o)}
      >
        <Filter size={20} />
        {on ? `Filters (${on} on)` : "Filters"}
      </button>
      {props.groups.map((g) => (
        // biome-ignore lint/a11y/useSemanticElements: a set of toggle buttons, not form controls in a fieldset
        <div key={g.key} className="chips" role="group" aria-labelledby={`chips-${g.key}`}>
          <span className="chips__label" id={`chips-${g.key}`}>
            {g.label}
          </span>
          <div className="chips__row">
            {g.options.map((o) => {
              const on = g.selected.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  onClick={() => props.onToggle(g.key, o.value)}
                >
                  {on && <Check size={16} />}
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {props.extra}
      <div className="filters__foot">
        <p className="filters__result" role="status">
          {props.result}
        </p>
        {active && (
          <button type="button" className="btn btn--text" onClick={props.onClear}>
            <X size={16} />
            Clear filters
          </button>
        )}
      </div>
    </section>
  );
}
