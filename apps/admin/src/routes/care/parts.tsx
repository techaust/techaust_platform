// Pieces the care plan, time and dashboard screens share (M3.5): the access gate, the breadcrumbs, the status and flag pills, the
// hours bar and the plan's name cell. Styles: the M3.2 panels (leads.css), the M3.3 strip (clients.css), the M3.4 list parts
// (projects.css) and care.css, loaded with these screens only.
import "../../leads.css";
import "../../clients.css";
import "../../projects.css";
import "../../care.css";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { CareStatus, CareTier, CareUsage } from "../../api.ts";
import { StatusPill } from "../../components/display.tsx";
import { NoAccess } from "../../components/states.tsx";
import { allowed } from "../../lib/access.ts";
import {
  CARE_PILLS,
  CARE_STATUS_LABELS,
  flagText,
  hoursBar,
  hoursText,
  TIER_LABELS,
} from "../../lib/care.ts";
import { useUser } from "../../session.tsx";

export const CARE_CRUMBS = [{ label: "Care plans", to: "/care-plans" }];

/** The care plan screens for a role that may read them (all four roles); the 403 page otherwise. */
export function CareGate({ children }: { children: ReactNode }) {
  const user = useUser();
  return allowed(user.role, "carePlans.read") ? children : <NoAccess what="Care plans" />;
}

export function CarePill({ status }: { status: CareStatus }) {
  const p = CARE_PILLS[status];
  return (
    <StatusPill tone={p.tone} icon={p.icon}>
      {CARE_STATUS_LABELS[status]}
    </StatusPill>
  );
}

/** "Near the limit" (warning) or "Limit reached" (danger), with an icon; nothing when there is no flag. */
export function FlagPill({ flag }: { flag: CareUsage["flag"] }) {
  const text = flagText(flag);
  if (!text) return null;
  return (
    <StatusPill tone={flag === "reached" ? "danger" : "warning"} icon="flag">
      {text}
    </StatusPill>
  );
}

/**
 * Hours used against hours available, as words and a calm bar (the words carry everything; the bar is a picture of them and is
 * hidden from screen readers). The thin mark at 80 % is where "Near the limit" starts. `size` "lg" is the plan page's card.
 */
export function HoursBar({
  usage,
  size,
  label,
}: {
  usage: Pick<CareUsage, "used" | "available" | "flag" | "overageMinutes">;
  size?: "lg";
  /** Words before the figures for a screen reader (e.g. the plan's client), so a list of bars reads apart. */
  label?: string;
}) {
  const bar = hoursBar(usage);
  return (
    <div className={`hours${size === "lg" ? " hours--lg" : ""}`}>
      <p className="hours__nums">
        {label && <span className="visually-hidden">{label}: </span>}
        <span className="hours__used tnum">{hoursText(usage.used)}</span>
        <span className="hours__of">
          {" "}
          of <span className="tnum">{hoursText(usage.available)}</span>
        </span>
      </p>
      <span className="hours__track" aria-hidden="true" data-tone={bar.tone}>
        <span className="hours__fill" style={{ width: `${bar.pct}%` }} />
        {usage.available > 0 && <span className="hours__tick" />}
      </span>
    </div>
  );
}

export const tierText = (tier: CareTier | null | undefined) => (tier ? TIER_LABELS[tier] : "Care plan");
/** The tier in force (or, before the start, the one booked for it). */
export const tierOf = (r: { terms: { current: { tier: CareTier } | null; pending: { tier: CareTier } | null } }) =>
  r.terms.current?.tier ?? r.terms.pending?.tier ?? null;

/** How a plan is named in lists: a link to the plan (the client's name, or the tier on the client's own page), its code and tier. */
export function PlanName(props: { id: string; title: string; code?: string | undefined; sub?: string | undefined }) {
  return (
    <span className="person client-name">
      <Link className="person__name client-name__link" to={`/care-plans/${props.id}`}>
        {props.title}
      </Link>
      {(props.code || props.sub) && (
        <span className="client-name__code plan-name__meta">
          {props.code && (
            <>
              <span className="visually-hidden">Code </span>
              <span className="docno">{props.code}</span>
            </>
          )}
          {props.sub && <span>{props.sub}</span>}
        </span>
      )}
    </span>
  );
}
