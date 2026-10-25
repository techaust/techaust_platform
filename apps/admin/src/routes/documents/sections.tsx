// The sections of a draft (M4.3, ADM-PROP-02): in the order the document reads, each one a row that opens to its title and body. Rows
// move up and down and can be hidden, except the estimate, terms and acceptance sections, which are always included (they can move).
// Bodies use the notes Markdown subset (M3.4). A section whose text still holds a placeholder ({{client.name}}) says so on its row, and a
// section the template leaves for this client says "write it or hide it". Numbers mark the reading order, because it is one.

import {
  MAX_CUSTOM_SECTIONS,
  MAX_SECTIONS,
  SECTION_BODY_MAX,
  SECTION_TITLE_MAX,
} from "@techaust/core/documents";
import { type Dispatch, memo, useCallback, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Eye,
  Lock,
  Plus,
  Trash,
} from "../../components/icons.tsx";
import { MenuButton } from "../../components/popover.tsx";
import {
  ADDABLE_KINDS,
  DOC_COPY,
  DOC_PENDING,
  type EditorAction,
  isRequiredSection,
  moved,
  placeholdersIn,
  type SectionDraft,
  sectionLabel,
  uid,
} from "../../lib/documents.ts";
import { COPY as PROJECT_COPY } from "../../lib/projects.ts";

export function SectionsPanel(props: {
  sections: SectionDraft[];
  dispatch: Dispatch<EditorAction>;
  current: () => SectionDraft[];
}) {
  const { dispatch, current } = props;
  // Open at first: the sections that still need words (a placeholder, or empty and not hidden).
  const [open, setOpen] = useState<Set<string>>(
    () =>
      new Set(
        props.sections
          .filter(
            (s) =>
              placeholdersIn(`${s.title} ${s.bodyMd}`).length > 0 ||
              (!s.hidden && s.bodyMd.trim() === "" && !isRequiredSection(s.kind)),
          )
          .map((s) => s.uid),
      ),
  );
  const toggle = useCallback(
    (u: string) =>
      setOpen((o) => {
        const n = new Set(o);
        if (n.has(u)) n.delete(u);
        else n.add(u);
        return n;
      }),
    [],
  );
  const edit = useCallback(
    (u: string, patch: Partial<SectionDraft>) => dispatch({ type: "section", uid: u, patch }),
    [dispatch],
  );
  const move = useCallback(
    (u: string, by: -1 | 1) => {
      const list = current();
      dispatch({
        type: "sections",
        sections: moved(
          list,
          list.findIndex((s) => s.uid === u),
          by,
        ),
      });
      requestAnimationFrame(() => document.getElementById(`sec-${u}-toggle`)?.focus());
    },
    [dispatch, current],
  );
  const remove = useCallback(
    (u: string) => {
      const list = current();
      dispatch({ type: "sections", sections: list.filter((s) => s.uid !== u) });
      requestAnimationFrame(() => document.getElementById("doc-sections-h")?.focus());
    },
    [dispatch, current],
  );

  const used = new Set(props.sections.map((s) => s.kind));
  const custom = props.sections.filter((s) => s.kind === "custom").length;
  const addable = [
    ...ADDABLE_KINDS.filter((k) => !used.has(k)),
    ...(custom < MAX_CUSTOM_SECTIONS ? (["custom"] as const) : []),
  ];
  const full = props.sections.length >= MAX_SECTIONS;

  function add(kind: string) {
    const s: SectionDraft = {
      uid: uid("s"),
      id: null,
      kind,
      title: kind === "custom" ? "" : sectionLabel(kind),
      bodyMd: "",
      hidden: false,
    };
    dispatch({ type: "sections", sections: [...current(), s] });
    setOpen((o) => new Set(o).add(s.uid));
    requestAnimationFrame(() => document.getElementById(`sec-${s.uid}-title`)?.focus());
  }

  return (
    <section className="lead-panel doc-sections" aria-labelledby="doc-sections-h">
      <div className="lead-panel__head">
        <h2 id="doc-sections-h" className="lead-panel__title" tabIndex={-1}>
          Sections
        </h2>
      </div>
      <p className="hint doc-sections__rule">
        <Lock size={16} />
        {DOC_COPY.alwaysIncluded}
      </p>
      <ol className="sections">
        {props.sections.map((s, i) => (
          <SectionRow
            key={s.uid}
            s={s}
            n={i + 1}
            count={props.sections.length}
            open={open.has(s.uid)}
            onToggle={toggle}
            onEdit={edit}
            onMove={move}
            onRemove={remove}
          />
        ))}
      </ol>
      {!full && addable.length > 0 && (
        <div className="doc-sections__add">
          <MenuButton
            label={DOC_PENDING.addSection}
            text={DOC_PENDING.addSection}
            icon={<Plus size={16} />}
            buttonClass="btn btn--text"
            items={addable.map((k) => ({ label: sectionLabel(k), onSelect: () => add(k) }))}
          />
        </div>
      )}
    </section>
  );
}

const SectionRow = memo(function SectionRow(p: {
  s: SectionDraft;
  n: number;
  count: number;
  open: boolean;
  onToggle: (uid: string) => void;
  onEdit: (uid: string, patch: Partial<SectionDraft>) => void;
  onMove: (uid: string, by: -1 | 1) => void;
  onRemove: (uid: string) => void;
}) {
  const { s } = p;
  const required = isRequiredSection(s.kind);
  const holes = placeholdersIn(`${s.title}\n${s.bodyMd}`);
  const empty = s.bodyMd.trim() === "";
  const name = s.title.trim() || sectionLabel(s.kind);
  const panel = `sec-${s.uid}-panel`;
  const items = [
    ...(p.n > 1
      ? [{ label: "Move up", icon: <ArrowUp size={16} />, onSelect: () => p.onMove(s.uid, -1) }]
      : []),
    ...(p.n < p.count
      ? [{ label: "Move down", icon: <ArrowDown size={16} />, onSelect: () => p.onMove(s.uid, 1) }]
      : []),
    ...(s.kind === "custom"
      ? [
          {
            label: "Remove",
            icon: <Trash size={16} />,
            tone: "danger" as const,
            onSelect: () => p.onRemove(s.uid),
          },
        ]
      : []),
  ];
  return (
    <li className="section-row" data-hidden={s.hidden || undefined} data-open={p.open || undefined}>
      <div className="section-row__head">
        <span className="section-row__n tnum" aria-hidden="true">
          {String(p.n).padStart(2, "0")}
        </span>
        <button
          type="button"
          id={`sec-${s.uid}-toggle`}
          className="section-row__toggle"
          aria-expanded={p.open}
          aria-controls={panel}
          onClick={() => p.onToggle(s.uid)}
        >
          <span className="section-row__name">{name}</span>
          {s.title.trim() && s.title.trim() !== sectionLabel(s.kind) && (
            <span className="section-row__kind">{sectionLabel(s.kind)}</span>
          )}
          <ChevronDown size={16} />
        </button>
        <span className="section-row__flags">
          {required && (
            <span className="section-row__flag">
              <Lock size={16} />
              <span className="visually-hidden">{DOC_COPY.alwaysIncluded}</span>
            </span>
          )}
          {holes.length > 0 && (
            <span className="section-row__flag section-row__flag--warn">
              <AlertTriangle size={16} />
              <span className="tnum">{holes.length}</span>
              <span className="visually-hidden"> {holes.join(", ")}</span>
            </span>
          )}
          {s.hidden && <span className="section-row__flag">Hidden</span>}
        </span>
        <span className="section-row__ctl">
          {!required && (
            <label className="section-row__hide">
              <input
                type="checkbox"
                className="section-row__check"
                checked={!s.hidden}
                onChange={(e) => p.onEdit(s.uid, { hidden: !e.target.checked })}
                aria-label={`Show ${name} in the document`}
              />
              <Eye size={16} />
            </label>
          )}
          {items.length > 0 && <MenuButton label={`Actions for ${name}`} items={items} align="end" />}
        </span>
      </div>
      {p.open && (
        <div className="section-row__body" id={panel}>
          {holes.length > 0 && <p className="section-row__holes">{holes.join(", ")}</p>}
          {!required && empty && !s.hidden && <p className="hint">{DOC_COPY.writtenPerProposal}</p>}
          <div className="field">
            <label htmlFor={`sec-${s.uid}-title`}>Title</label>
            <input
              id={`sec-${s.uid}-title`}
              autoComplete="off"
              maxLength={SECTION_TITLE_MAX}
              value={s.title}
              onChange={(e) => p.onEdit(s.uid, { title: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`sec-${s.uid}-body`}>Text</label>
            <p className="hint" id={`sec-${s.uid}-body-hint`}>
              {PROJECT_COPY.formattingHint}
            </p>
            <textarea
              id={`sec-${s.uid}-body`}
              aria-describedby={`sec-${s.uid}-body-hint`}
              rows={Math.min(14, Math.max(4, s.bodyMd.split("\n").length + 1))}
              maxLength={SECTION_BODY_MAX}
              value={s.bodyMd}
              onChange={(e) => p.onEdit(s.uid, { bodyMd: e.target.value })}
            />
          </div>
        </div>
      )}
    </li>
  );
});
