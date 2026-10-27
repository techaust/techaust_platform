// The frame every report shares (M5.5b): the title and lede under the "Reports" crumb, then the section's own index of the four reports.
import { type ReactNode, useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router";
import { PageHeader } from "../../components/display.tsx";
import { nearestScrollLeft, REPORTS, REPORTS_COPY } from "../../lib/reports.ts";

export const CRUMBS = [{ label: REPORTS_COPY.group, to: "/reports" }];

/** The page frame of one report: the title and lede, then the section's index of reports. */
export function ReportFrame(props: { title: string; lede: ReactNode; children: ReactNode }) {
  const nav = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  // On a narrow screen the index scrolls sideways: bring the open report into view (only the row moves, never the page). Runs again when the
  // report changes, which is why `pathname` is a dependency.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the effect reads the DOM, which changes with the path
  useEffect(() => {
    const row = nav.current;
    const link = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !link || row.scrollWidth <= row.clientWidth) return;
    const left = link.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
    row.scrollLeft = nearestScrollLeft(row.scrollLeft, row.clientWidth, left, link.offsetWidth);
  }, [pathname]);
  return (
    <div className="report">
      <PageHeader title={props.title} crumbs={CRUMBS} lede={props.lede} />
      <nav ref={nav} className="report-nav" aria-label={REPORTS_COPY.group}>
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
