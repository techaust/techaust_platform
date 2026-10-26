// The side of a proposal or estimate (M4.3): the send panel (where the draft stands, what still stops it, the discount guard and the
// approval, and the one button that sends or asks the owner) and the versions panel. The discount guard is this section's one drawn
// element: a thin GUARD RULE, the share off the catalogue prices as a fill, with a fine mark at 10 %, where the owner's approval begins.
// The words beside it carry the figure; the rule is a picture of them (hidden from screen readers), calm verdigris up to the mark and
// the warning colour past it, always with the sentence that says what it means.
import type { Role } from "@techaust/core/permissions";
import { Link } from "react-router";
import { Alert, CheckCircle, Clock, Send } from "../../components/icons.tsx";
import {
  approvalLine,
  blockerText,
  DOC_COPY,
  DOC_PENDING,
  emptySectionsOf,
  formatIstDay,
  guardLine,
  type SaveStatus,
  SECTION_EMPTY_AROUND,
  type SectionDraft,
  STATUS_LABELS,
  sectionName,
  versionLine,
} from "../../lib/documents.ts";
import type { ApprovalInfo, Blocker, Guard, QuoteType, VersionRow } from "../../lib/documents-api.ts";
import { docHref } from "./parts.tsx";

const OWNER_MARK_BP = 1000;

/** The guard rule and its sentence. Nothing to show when no line comes from the catalogue. */
export function GuardRule({ guard, owner }: { guard: Guard | null; owner: boolean }) {
  if (!guard || guard.referenceMinor === 0) return null;
  // The scale runs to 20 %, or a little past the discount when it is larger, so the 10 % mark always sits inside it.
  const scale = Math.max(2 * OWNER_MARK_BP, guard.discountBp + 500);
  const fill = Math.min(100, (guard.discountBp / scale) * 100);
  const mark = (OWNER_MARK_BP / scale) * 100;
  return (
    <div className="guard" data-over={guard.needsApproval || undefined}>
      <p className="guard__line">
        <span className="guard__pct tnum">{guardLine(guard.discountBp)}</span>
      </p>
      <span className="guard__track" aria-hidden="true">
        <span className="guard__fill" style={{ width: `${fill}%` }} />
        <span className="guard__mark" style={{ left: `${mark}%` }} />
      </span>
      {guard.needsApproval && (
        <p className="guard__over">{owner ? DOC_COPY.overTenOwner : DOC_COPY.overTen}</p>
      )}
      {guard.customLines.length > 0 && (
        <p className="hint guard__custom">
          {DOC_PENDING.customLinesCount(guard.customLines.length)}. {DOC_PENDING.customLinesHint}
        </p>
      )}
    </div>
  );
}

export function SendPanel(props: {
  role: Role;
  guard: Guard | null;
  approval: ApprovalInfo;
  blockers: Blocker[];
  canSend: boolean;
  saveStatus: SaveStatus;
  saveLine: string | null;
  dirty: boolean;
  canWrite: boolean;
  canSendRole: boolean;
  onSend: () => void;
  onRequest: () => void;
  /** The draft's sections, for `section_empty`'s list; each name opens its section. */
  sections: SectionDraft[];
  onOpenSection: (uid: string) => void;
}) {
  const needs = !!props.guard?.needsApproval && props.role !== "owner";
  const approved = props.approval.state === "approved";
  const askable =
    needs &&
    props.canWrite &&
    (props.approval.state === "none" ||
      props.approval.state === "expired" ||
      props.approval.state === "rejected");
  const blocked = props.saveStatus === "stale" || props.saveStatus === "frozen";
  const sendable = props.canSendRole && props.canSend && !blocked && (!needs || approved);
  const line =
    needs || props.approval.state !== "none" ? approvalLine(props.approval, DOC_PENDING.theOwner) : null;
  return (
    <section className="lead-panel send-panel" aria-labelledby="send-h" id="doc-send">
      <div className="lead-panel__head">
        <h2 id="send-h" className="lead-panel__title">
          {DOC_COPY.send}
        </h2>
        {props.saveLine && (
          <p className="save-state" data-state={props.saveStatus} role="status">
            {props.saveStatus === "saved" ? (
              <CheckCircle size={16} />
            ) : props.saveStatus === "error" ? (
              <Alert size={16} />
            ) : null}
            {props.saveLine}
          </p>
        )}
      </div>
      {props.blockers.length > 0 ? (
        <ul className="blockers">
          {props.blockers.map((b) => (
            <li key={b.code} className="blockers__item">
              <Alert size={16} />
              {b.code === "section_empty" ? (
                <SectionEmpty sections={emptySectionsOf(b, props.sections)} onOpen={props.onOpenSection} />
              ) : (
                <span>{blockerText(b)}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <GuardRule guard={props.guard} owner={props.role === "owner"} />
      {line && (
        <p className="approval-line" data-state={props.approval.state}>
          {props.approval.state === "pending" ? (
            <Clock size={16} />
          ) : props.approval.state === "approved" ? (
            <CheckCircle size={16} />
          ) : (
            <Alert size={16} />
          )}
          <span>{line}</span>
        </p>
      )}
      <div className="send-panel__actions">
        {askable && (
          <button type="button" className="btn btn--secondary btn--block" onClick={props.onRequest}>
            {DOC_COPY.requestTitle}
          </button>
        )}
        {props.canSendRole && (
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={props.onSend}
            disabled={!sendable}
          >
            <Send size={20} />
            {DOC_COPY.send}
          </button>
        )}
      </div>
    </section>
  );
}

/** 07-O §10 `section_empty`: the sentence with each section's name as a link that opens the section's text. */
function SectionEmpty(props: { sections: SectionDraft[]; onOpen: (uid: string) => void }) {
  return (
    <span>
      {SECTION_EMPTY_AROUND[0]}
      {props.sections.map((s, i) => (
        <span key={s.uid}>
          <a
            href={`#sec-${s.uid}-toggle`}
            className="blockers__link"
            onClick={(e) => {
              e.preventDefault();
              props.onOpen(s.uid);
            }}
          >
            {sectionName(s)}
          </a>
          {i < props.sections.length - 1 ? ", " : ""}
        </span>
      ))}
      {SECTION_EMPTY_AROUND[1]}
    </span>
  );
}

export function VersionsPanel(props: { versions: VersionRow[]; type: QuoteType }) {
  return (
    <section className="lead-panel versions" aria-labelledby="versions-h">
      <h2 id="versions-h" className="lead-panel__title">
        {DOC_COPY.versionsHeading}
      </h2>
      <ol className="versions__list">
        {[...props.versions].reverse().map((v) => {
          const text = versionLine(
            v.version,
            STATUS_LABELS[v.status],
            v.sentAt ? formatIstDay(v.sentAt) : null,
          );
          return (
            <li key={v.id} className="versions__item" data-current={v.current || undefined}>
              {v.current ? (
                <span aria-current="page" className="versions__here">
                  {text}
                </span>
              ) : (
                <Link to={docHref({ id: v.id, type: props.type })}>{text}</Link>
              )}
              {v.number && <span className="docno">{v.number}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
