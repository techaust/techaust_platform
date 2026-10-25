// Pieces the Projects screens share (M3.4): the access gate, the breadcrumbs, the status pills, the code chip and the project
// name cell. The styles: the M3.2 panels (leads.css), the M3.3 strip and rows (clients.css) and projects.css, loaded with these
// screens only.
import "../../leads.css";
import "../../clients.css";
import "../../projects.css";
import { formatDate, parseIsoDate } from "@techaust/core/dates";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Currency, MilestoneStatus, ProjectStatus, ProjectView } from "../../api.ts";
import { StatusPill } from "../../components/display.tsx";
import type { FieldA11y } from "../../components/form.tsx";
import { NoAccess } from "../../components/states.tsx";
import { allowed } from "../../lib/access.ts";
import {
  MILESTONE_PILLS,
  MILESTONE_STATUS_LABELS,
  PROJECT_PILLS,
  PROJECT_STATUS_LABELS,
  VISIBILITY_LABELS,
} from "../../lib/projects.ts";
import { useUser } from "../../session.tsx";

export const CRUMBS = [{ label: "Projects", to: "/projects" }];

/** The Projects screens for a role that may read projects (owner, staff, sales); the 403 page otherwise. */
export function ProjectsGate({ children }: { children: ReactNode }) {
  const user = useUser();
  return allowed(user.role, "projects.read") ? children : <NoAccess what="Projects" />;
}

export function ProjectPill({ status }: { status: ProjectStatus }) {
  const p = PROJECT_PILLS[status];
  return (
    <StatusPill tone={p.tone} icon={p.icon}>
      {PROJECT_STATUS_LABELS[status]}
    </StatusPill>
  );
}

export function MilestonePill({ status }: { status: MilestoneStatus }) {
  const p = MILESTONE_PILLS[status];
  return (
    <StatusPill tone={p.tone} icon={p.icon} outline={status === "invoiced"}>
      {MILESTONE_STATUS_LABELS[status]}
    </StatusPill>
  );
}

/** Internal or shared with the client (07-K labels), for notes and files. */
export function VisibilityPill({ shared }: { shared: boolean }) {
  return shared ? (
    <StatusPill tone="info" icon="send" outline>
      {VISIBILITY_LABELS.shared}
    </StatusPill>
  ) : (
    <StatusPill tone="neutral" icon="lock" outline>
      {VISIBILITY_LABELS.internal}
    </StatusPill>
  );
}

/** The project's name (a link) with its code underneath. */
export function ProjectName({ project }: { project: Pick<ProjectView, "id" | "name" | "code"> }) {
  return (
    <span className="person client-name">
      <Link className="person__name client-name__link" to={`/projects/${project.id}`}>
        {project.name}
      </Link>
      <span className="client-name__code">
        <span className="visually-hidden">Code </span>
        <span className="docno">{project.code}</span>
      </span>
    </span>
  );
}

/** A money amount typed in rupees or dollars (the settings kit's field): the currency is the project's and can't change here. */
export function MoneyIn(props: {
  a11y: FieldA11y;
  currency: Currency;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
}) {
  return (
    <div className="money-in">
      <span aria-hidden="true">{props.currency === "INR" ? "₹" : "$"}</span>
      <input
        {...props.a11y}
        inputMode="decimal"
        autoComplete="off"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={props.onBlur}
      />
    </div>
  );
}

/** A date as stored (an IST day, YYYY-MM-DD) as the other lists show dates: 05 Nov 2026. */
export function Day({ iso, none }: { iso: string | null; none?: string }) {
  const d = iso ? parseIsoDate(iso) : null;
  if (!iso || !d) return <span className="muted">{none ?? "Not set"}</span>;
  return <time dateTime={iso}>{formatDate(d)}</time>;
}
