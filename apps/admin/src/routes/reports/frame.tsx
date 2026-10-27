// The frame every report shares (M5.5b): the title and lede under the "Reports" crumb, then the section's own index of the four reports.
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { PageHeader } from "../../components/display.tsx";
import { REPORTS, REPORTS_COPY } from "../../lib/reports.ts";

export const CRUMBS = [{ label: REPORTS_COPY.group, to: "/reports" }];

/** The page frame of one report: the title and lede, then the section's index of reports. */
export function ReportFrame(props: { title: string; lede: ReactNode; children: ReactNode }) {
  return (
    <div className="report">
      <PageHeader title={props.title} crumbs={CRUMBS} lede={props.lede} />
      <nav className="report-nav" aria-label={REPORTS_COPY.group}>
        <ul>
          {REPORTS.map((r) => (
            <li key={r.key}>
              <NavLink to={r.path} className="report-nav__link">
                {r.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      {props.children}
    </div>
  );
}
