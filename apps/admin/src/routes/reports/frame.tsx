// The frame every report shares (M5.5b): the title and lede under the "Reports" crumb, then the section's own index of the reports the role may read.
// M7.3: the index holds the management reports (C1 to C4) and, for the Owner and the Accountant, the registers and files after them; the two groups sit apart
// on a wide screen (a hairline between them), and a role with a single report gets no index at all (a one-link index says nothing).
import { type ReactNode, useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router";
import { PageHeader } from "../../components/display.tsx";
import { allowed } from "../../lib/access.ts";
import { REPORTS, REPORTS_COPY, revealScrollLeft } from "../../lib/reports.ts";
import { useUser } from "../../session.tsx";

export const CRUMBS = [{ label: REPORTS_COPY.group, to: "/reports" }];

/**
 * Scroll the index row (never the page) so `link` sits fully in view, clear of the faded edges: their width is the row's `scroll-padding-inline` (reports.css).
 * Nothing to do while the row doesn't overflow (from a tablet up it wraps).
 */
function reveal(row: HTMLElement, link: HTMLElement) {
  if (row.scrollWidth <= row.clientWidth) return;
  const left = link.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
  const inset = Number.parseFloat(getComputedStyle(row).scrollPaddingLeft) || 0;
  row.scrollLeft = revealScrollLeft(row.scrollLeft, row.clientWidth, left, link.offsetWidth, inset);
}

/** The page frame of one report: the title and lede, then the section's index of reports. */
export function ReportFrame(props: { title: string; lede: ReactNode; children: ReactNode }) {
  const nav = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const user = useUser();
  const mine = REPORTS.filter((r) => allowed(user.role, r.action));
  const groups = (["management", "registers"] as const)
    .map((g) => mine.filter((r) => r.group === g))
    .filter((g) => g.length > 0);
  // On a narrow screen the index scrolls sideways: bring the open report into view (only the row moves, never the page). Runs again when the
  // report changes, which is why `pathname` is a dependency.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the effect reads the DOM, which changes with the path
  useEffect(() => {
    const row = nav.current;
    const link = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (row && link) reveal(row, link);
  }, [pathname]);
  // AU61 (review L5): a link reached with Tab is brought fully into view too, clear of the faded edges (the browser's own focus scroll stops at the edge,
  // under the fade).
  useEffect(() => {
    const row = nav.current;
    if (!row) return;
    const focused = (e: FocusEvent) => {
      const link =
        e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(".report-nav__link") : null;
      if (link) reveal(row, link);
    };
    row.addEventListener("focusin", focused);
    return () => row.removeEventListener("focusin", focused);
  }, []);
  // AU22 (B4 L4): which edges of a scrolling index hide more reports (`data-more`, the CSS fades those edges); none once the index wraps (no overflow).
  useEffect(() => {
    const row = nav.current;
    if (!row) return;
    const update = () => {
      const start = row.scrollLeft > 1;
      const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
      const more = start && end ? "both" : start ? "start" : end ? "end" : "";
      if (more) row.dataset.more = more;
      else delete row.dataset.more;
    };
    update();
    row.addEventListener("scroll", update, { passive: true });
    const sized = new ResizeObserver(update);
    sized.observe(row);
    return () => {
      row.removeEventListener("scroll", update);
      sized.disconnect();
    };
  }, []);
  return (
    <div className="report">
      <PageHeader title={props.title} crumbs={CRUMBS} lede={props.lede} />
      {mine.length > 1 && (
        <nav ref={nav} className="report-nav" aria-label={REPORTS_COPY.group}>
          {groups.map((g) => (
            <ul key={g[0]?.group} className="report-nav__group">
              {g.map((r) => (
                <li key={r.key}>
                  <NavLink to={r.path} className="report-nav__link">
                    {r.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          ))}
        </nav>
      )}
      {props.children}
    </div>
  );
}
