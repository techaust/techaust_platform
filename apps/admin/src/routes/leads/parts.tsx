// Pieces the Leads screens share (M3.2): the stage pill, the "Move to…" menu, the Lost dialog that asks for the reason,
// the lead's name cell, the next-action line and the access check. The styles are in leads.css, loaded with these.
import "../../leads.css";
import { formatDate, istDate } from "@techaust/core/dates";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { api, errorText, type LeadItem, type LeadStage, type LostReason } from "../../api.ts";
import { Modal } from "../../components/dialog.tsx";
import { StatusPill } from "../../components/display.tsx";
import { ChevronDown, Clock } from "../../components/icons.tsx";
import { MenuButton } from "../../components/popover.tsx";
import { NoAccess } from "../../components/states.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import { LOST_REASON_LABELS, LOST_REASONS, STAGE_LABELS, STAGE_PILL, STAGES } from "../../lib/leads.ts";
import { useUser } from "../../session.tsx";

export const CRUMBS = [{ label: "Leads", to: "/leads" }];

/** The Leads screens for a role that may read leads; the 403 page otherwise. */
export function LeadsGate({ children }: { children: ReactNode }) {
  const user = useUser();
  return allowed(user.role, "leads.read") ? children : <NoAccess what="Leads" />;
}

export function StagePill({ stage, reason }: { stage: LeadStage; reason?: LostReason | null }) {
  const p = STAGE_PILL[stage];
  return (
    <StatusPill tone={p.tone} icon={p.icon}>
      {STAGE_LABELS[stage]}
      {stage === "lost" && reason ? `: ${LOST_REASON_LABELS[reason]}` : ""}
    </StatusPill>
  );
}

/** The day a next action is due, and "Overdue" beside it once that day has passed (ADM-LEAD-03). */
export function NextAction({ lead, withNote }: { lead: LeadItem; withNote?: boolean }) {
  if (lead.nextActionAt === null) return <span className="muted">None</span>;
  return (
    <span className={lead.nextActionOverdue ? "next-action next-action--overdue" : "next-action"}>
      <span className="next-action__date">
        <time dateTime={new Date(lead.nextActionAt).toISOString()}>
          {formatDate(istDate(lead.nextActionAt))}
        </time>
        {lead.nextActionOverdue && (
          <StatusPill tone="danger" icon="clock">
            Overdue
          </StatusPill>
        )}
      </span>
      {withNote && lead.nextActionNote && <span className="next-action__note">{lead.nextActionNote}</span>}
    </span>
  );
}

/** Name, then company (or email); a repeat enquiry links to the earlier lead (FRM-04: linked, never merged). */
export function LeadName({ lead, link = true }: { lead: LeadItem; link?: boolean }) {
  return (
    <span className="person lead-name">
      {link ? (
        <Link className="person__name lead-name__link" to={`/leads/${lead.id}`}>
          {lead.name}
        </Link>
      ) : (
        <span className="person__name">{lead.name}</span>
      )}
      <span className="person__email">{lead.company ?? lead.email}</span>
      {lead.duplicateOf && (
        <Link className="lead-name__dup" to={`/leads/${lead.duplicateOf}`}>
          <Clock size={16} />
          Earlier lead, same email
        </Link>
      )}
    </span>
  );
}

/** The keyboard and screen-reader way to move a lead (docs/06 Kanban): every other stage, in pipeline order. */
export function MoveMenu(props: { lead: LeadItem; onMove: (to: LeadStage) => void; compact?: boolean }) {
  return (
    <MenuButton
      label={`Move ${props.lead.name} to`}
      text="Move to…"
      buttonClass={props.compact ? "btn btn--text move-btn" : "btn btn--secondary move-btn"}
      icon={<ChevronDown size={16} />}
      items={STAGES.filter((s) => s !== props.lead.stage).map((s) => ({
        label: STAGE_LABELS[s],
        onSelect: () => props.onMove(s),
      }))}
    />
  );
}

/**
 * Moving a lead to Lost asks why (ADM-LEAD-02: the reason is required). Resolves the move itself so the caller only
 * hears about a saved change; an error stays in the dialog.
 */
export function LostDialog(props: {
  lead: { id: string; name: string } | null;
  onClose: () => void;
  onMoved: (reason: LostReason) => void;
}) {
  const [reason, setReason] = useState<LostReason | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const lead = props.lead;
  if ((lead?.id ?? null) !== shown) {
    setShown(lead?.id ?? null);
    setReason(null);
    setMissing(false);
    setError(null);
  }

  async function confirm() {
    if (!lead) return;
    if (!reason) {
      setMissing(true);
      document.getElementById("lost-reason-0")?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setLeadStage(lead.id, "lost", reason);
      props.onMoved(reason);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!lead} title={lead ? `Move ${lead.name} to Lost` : ""} onClose={props.onClose} busy={busy}>
      <div className="dialog__body">
        <fieldset
          className="radios lost-reasons"
          aria-describedby={missing ? "lost-reason-error" : undefined}
          aria-invalid={missing || undefined}
        >
          <legend>Lost reason</legend>
          {LOST_REASONS.map((r, i) => (
            <label key={r} className="radio">
              <input
                id={`lost-reason-${i}`}
                type="radio"
                name="lost-reason"
                value={r}
                checked={reason === r}
                onChange={() => {
                  setReason(r);
                  setMissing(false);
                }}
              />
              {LOST_REASON_LABELS[r]}
            </label>
          ))}
        </fieldset>
        {missing && <FieldError id="lost-reason-error">Choose why the lead was lost.</FieldError>}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={confirm}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? "Moving…" : "Move to Lost"}
        </button>
      </div>
    </Modal>
  );
}
