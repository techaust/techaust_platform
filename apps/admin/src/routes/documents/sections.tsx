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
import { type Dispatch, memo, useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Eye,
  Info,
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
  GAP_COPY,
  GAP_HIDDEN,
  type GapGroup,
  gapLine,
  gapNowLine,
  isEmptyOptional,
  isRequiredSection,
  moved,
  placeholdersIn,
  type SectionDraft,
  sectionHolesLine,
  sectionLabel,
  sectionTextName,
  sectionTitleName,
  uid,
} from "../../lib/documents.ts";
import { COPY as PROJECT_COPY } from "../../lib/projects.ts";

/** The names of the placeholders still in a text, without their braces (for the words of 07-X §2). */
const holeNames = (text: string) => placeholdersIn(text).map((n) => n.slice(2, -2));

export const SectionsPanel = memo(function SectionsPanel(props: {
  sections: SectionDraft[];
  dispatch: Dispatch<EditorAction>;
  current: () => SectionDraft[];
  /** A request to open one section and put the cursor in its text (from the send panel's `section_empty` links). */
  openRequest: { uid: string; n: number } | null;
  /** The Catalogue gaps by section (07-X §3): each shows as a note on its section's row. */
  gaps: GapGroup[];
  /** "Use Catalogue text" (B2's route) for one section; the section being filled, while it runs. */
  onFill: (sectionId: string) => void;
  filling: string | null;
}) {
  const { dispatch, current, openRequest } = props;
  // Open at first: the sections that still need words (a placeholder, or empty and not hidden).
  const [open, setOpen] = useState<Set<string>>(
    () =>
      new Set(
        props.sections
          .filter((s) => placeholdersIn(`${s.title} ${s.bodyMd}`).length > 0 || isEmptyOptional(s))
          .map((s) => s.uid),
      ),
  );
  const openAndFocus = useCallback((u: string) => {
    setOpen((o) => new Set(o).add(u));
    requestAnimationFrame(() => {
      const body = document.getElementById(`sec-${u}-body`);
      body?.scrollIntoView({ block: "center" });
      body?.focus({ preventScroll: true });
    });
  }, []);
  useEffect(() => {
    if (openRequest) openAndFocus(openRequest.uid);
  }, [openRequest, openAndFocus]);
  // "Write it here" on a hidden section's note: show it in the document, open it and put the cursor in its text.
  const writeHere = useCallback(
    (u: string) => {
      dispatch({ type: "section", uid: u, patch: { hidden: false } });
      openAndFocus(u);
    },
    [dispatch, openAndFocus],
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
            gap={props.gaps.find((g) => g.uid === s.uid)}
            onWriteHere={writeHere}
            onFill={props.onFill}
            filling={props.filling}
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
});

const SectionRow = memo(function SectionRow(p: {
  s: SectionDraft;
  n: number;
  count: number;
  open: boolean;
  onToggle: (uid: string) => void;
  onEdit: (uid: string, patch: Partial<SectionDraft>) => void;
  onMove: (uid: string, by: -1 | 1) => void;
  onRemove: (uid: string) => void;
  gap: GapGroup | undefined;
  onWriteHere: (uid: string) => void;
  onFill: (sectionId: string) => void;
  filling: string | null;
}) {
  const { s } = p;
  // While "Use Catalogue text" fills this section its text, title and visibility are read-only (review round 3, finding 4): an edit made
  // meanwhile would keep the filled text off the screen, and the next save would write over it.
  const busy = p.filling !== null && p.filling === s.id;
  const required = isRequiredSection(s.kind);
  const holes = holeNames(`${s.title}\n${s.bodyMd}`);
  const empty = s.bodyMd.trim() === "";
  const name = s.title.trim() || sectionLabel(s.kind);
  // The section's kind names its title field; custom sections (up to three) add their place in the reading order.
  const kindName = s.kind === "custom" ? `${sectionLabel(s.kind)} ${p.n}` : sectionLabel(s.kind);
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
    <li
      className="section-row"
      data-hidden={s.hidden || undefined}
      data-open={p.open || undefined}
      aria-busy={busy || undefined}
    >
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
          {/* The name (and the kind under a custom title) may wrap; the chevron stays beside them, never on a line of its own. */}
          <span className="section-row__label">
            <span className="section-row__name">{name}</span>
            {s.title.trim() && s.title.trim() !== sectionLabel(s.kind) && (
              <span className="section-row__kind">{sectionLabel(s.kind)}</span>
            )}
          </span>
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
              <span className="visually-hidden"> {sectionHolesLine(holes)}</span>
            </span>
          )}
          {s.hidden && <span className="section-row__flag section-row__flag--hidden">Hidden</span>}
        </span>
        <span className="section-row__ctl">
          {!required && (
            <label className="section-row__hide">
              <input
                type="checkbox"
                className="section-row__check"
                checked={!s.hidden}
                disabled={busy}
                onChange={(e) => p.onEdit(s.uid, { hidden: !e.target.checked })}
                aria-label={`Show ${name} in the document`}
              />
              <Eye size={16} />
            </label>
          )}
          {items.length > 0 && <MenuButton label={`Actions for ${name}`} items={items} align="end" />}
        </span>
      </div>
      {p.gap && <GapNote gap={p.gap} onWriteHere={p.onWriteHere} onFill={p.onFill} filling={p.filling} />}
      {p.open && (
        <div className="section-row__body" id={panel}>
          {holes.length > 0 && (
            <p className="section-row__holes">
              <AlertTriangle size={16} />
              <span>{sectionHolesLine(holes)}</span>
            </p>
          )}
          {!required && empty && !s.hidden && <p className="hint">{DOC_COPY.writtenPerProposal}</p>}
          <div className="field">
            {/* 07-O §10: the name says whose title it is (several sections are open at once); the visible word stays "Title". */}
            <label htmlFor={`sec-${s.uid}-title`}>Title</label>
            <input
              id={`sec-${s.uid}-title`}
              aria-label={sectionTitleName(kindName)}
              autoComplete="off"
              maxLength={SECTION_TITLE_MAX}
              readOnly={busy}
              value={s.title}
              onChange={(e) => p.onEdit(s.uid, { title: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`sec-${s.uid}-body`}>Text</label>
            <p className="hint" id={`sec-${s.uid}-body-hint`}>
              {PROJECT_COPY.formattingHint}
            </p>
            {/* Finding 6: several sections are open at once, so each text box's name says whose text it is; the visible word stays "Text". */}
            <textarea
              id={`sec-${s.uid}-body`}
              aria-label={sectionTextName(kindName)}
              aria-describedby={`sec-${s.uid}-body-hint`}
              rows={Math.min(14, Math.max(4, s.bodyMd.split("\n").length + 1))}
              maxLength={SECTION_BODY_MAX}
              readOnly={busy}
              value={s.bodyMd}
              onChange={(e) => p.onEdit(s.uid, { bodyMd: e.target.value })}
            />
          </div>
        </div>
      )}
    </li>
  );
});

/**
 * 07-X §3 on the section itself: a margin note under its name, open or closed, saying which service has no text in Catalogue (and that the
 * section is hidden until it has some), with the way to Catalogue, "Write it here" for a hidden section, and "Use Catalogue text" once
 * Catalogue has it.
 */
function GapNote(props: {
  gap: GapGroup;
  onWriteHere: (uid: string) => void;
  onFill: (sectionId: string) => void;
  filling: string | null;
}) {
  const { gap } = props;
  const uidOf = gap.uid;
  const sectionId = gap.sectionId;
  return (
    <div className="gap-note" role="note">
      <Info size={16} />
      <div className="gap-note__body">
        {gap.hidden && <p className="gap-note__hidden">{GAP_HIDDEN}</p>}
        {gap.services.map((s) => (
          <p key={s.id}>
            {s.missing.length > 0 && <span>{gapLine(s.name, s.missing)} </span>}
            {s.now.length > 0 && <span>{gapNowLine(s.name, s.now)}</span>}
          </p>
        ))}
        <div className="gap-note__acts">
          {gap.services
            .filter((s) => s.missing.length > 0)
            .map((s) => (
              <Link
                key={s.id}
                to={`/catalogue/${encodeURIComponent(s.id)}`}
                className="btn btn--text gap-note__act"
                aria-label={`${GAP_COPY.addInCatalogue}: ${s.name}`}
              >
                {GAP_COPY.addInCatalogue}
              </Link>
            ))}
          {gap.hidden && uidOf && (
            <button
              type="button"
              className="btn btn--text gap-note__act"
              onClick={() => props.onWriteHere(uidOf)}
              disabled={props.filling !== null}
            >
              {GAP_COPY.writeHere}
            </button>
          )}
          {gap.canFill && sectionId && (
            <button
              type="button"
              className="btn btn--secondary gap-note__fill"
              onClick={() => props.onFill(sectionId)}
              disabled={props.filling !== null}
              aria-busy={props.filling === sectionId || undefined}
            >
              {GAP_COPY.useCatalogue}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
