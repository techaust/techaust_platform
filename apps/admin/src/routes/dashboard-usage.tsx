// The dashboard's Free-plan usage tile (M7.5 G, Q4 A; Owner and Accountant only, `usage.read`, docs/04 §9 row L40; the API refuses any other role).
// Each daily Free limit is a row: the newest day's figure against its limit, its share in words (and a status pill with an icon at 50 %, 80 % and the limit,
// the alert lines the 09:00 bells use), and a 30-day strip on a fixed 0-to-limit scale, so the rows read as small multiples of headroom. Under them, the
// requests Cloudflare stopped at a limit that day. The whole window is one table away (the strips' figures, every day). The tile loads on its own after the
// page (it never holds the dashboard back) and has its own loading, empty (no reading yet: before the first nightly run, or no analytics token) and error
// states. Days are UTC days, written as the admin writes dates. Words: 07-ZS (lib/usage.ts).
import "./dashboard-usage.css";
import { EXCEEDED_METRIC } from "@techaust/core/usage";
import { type ReactNode, useId, useState } from "react";
import { api, type UsageDay } from "../api.ts";
import { LimitStrip } from "../components/chart/index.ts";
import { type Column, DataTable } from "../components/data-table.tsx";
import { Skeleton, StatusPill } from "../components/display.tsx";
import { BarChart, RefreshCw } from "../components/icons.tsx";
import { useLoad } from "../components/states.tsx";
import {
  levelOf,
  shareText,
  stripLabel,
  USAGE_COPY as U,
  USAGE_THRESHOLDS,
  type UsageRow,
  type UsageView,
  usageCount,
  usageDayText,
  usageView,
} from "../lib/usage.ts";

export function UsageTile() {
  const page = useLoad(() => api.dashboardUsage(), "");
  const view = page.state === "ready" ? usageView(page.data, Date.now()) : null;
  const empty = page.state === "ready" && view === null;
  return (
    <section
      className={`lead-panel tile tile--usage${empty ? " tile--quiet" : ""}`}
      aria-labelledby="tile-usage"
      aria-busy={page.state === "loading" || undefined}
    >
      {page.state === "loading" ? (
        <>
          <Head />
          <p className="visually-hidden" role="status">
            {U.loading}
          </p>
          <div className="usage-rows" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="usage-row usage-row--skeleton">
                <span className="usage-row__name">
                  <Skeleton width="60%" />
                  <Skeleton width="40%" />
                </span>
                <span className="usage-row__strip">
                  <Skeleton width="100%" />
                </span>
              </div>
            ))}
          </div>
        </>
      ) : page.state === "failed" ? (
        <>
          <Head />
          <div className="usage-failed" role="alert">
            <p>{U.failed}</p>
            <button type="button" className="btn btn--secondary" onClick={() => page.reload()}>
              <RefreshCw />
              {U.retry}
            </button>
          </div>
        </>
      ) : view === null ? (
        <>
          <Head />
          <p className="panel-empty">
            <BarChart size={20} />
            <span>{U.empty}</span>
          </p>
        </>
      ) : (
        <Ready view={view} />
      )}
    </section>
  );
}

function Head(props: { intro?: string; action?: ReactNode }) {
  return (
    <div className="lead-panel__head tile__head usage-head">
      <div className="usage-head__text">
        <h2 id="tile-usage" className="lead-panel__title">
          {U.title}
        </h2>
        {props.intro && <p className="usage-head__intro">{props.intro}</p>}
      </div>
      {props.action}
    </div>
  );
}

function Ready({ view }: { view: UsageView }) {
  const [table, setTable] = useState(false);
  const tableId = useId();
  const day = usageDayText(view.newest);
  return (
    <>
      <Head
        intro={view.stale ? U.stale(day) : U.intro(day)}
        action={
          <button
            type="button"
            className="btn btn--text usage-head__toggle"
            aria-expanded={table}
            aria-controls={tableId}
            onClick={() => setTable((t) => !t)}
          >
            {table ? U.hideTable : U.showTable}
          </button>
        }
      />
      <ul className="usage-rows">
        {view.rows.map((r) => (
          <Row key={r.metric} row={r} view={view} />
        ))}
      </ul>
      {view.stopped !== null && (
        <dl className="mini-facts usage-stopped">
          <div data-alert={view.stopped > 0 || undefined}>
            <dt>{U.stopped}</dt>
            <dd className="tnum">{usageCount(view.stopped)}</dd>
          </div>
        </dl>
      )}
      <div id={tableId} hidden={!table}>
        {table && <UsageTable view={view} />}
      </div>
    </>
  );
}

function Row({ row, view }: { row: UsageRow; view: UsageView }) {
  const level = row.latest === null ? null : levelOf(row.metric, row.latest);
  return (
    <li className="usage-row">
      <span className="usage-row__name">
        <span className="usage-row__label">{row.label}</span>
        <span className="usage-row__figure tnum">
          {row.latest === null ? U.notRead : U.ofLimit(usageCount(row.latest), usageCount(row.limit))}
        </span>
      </span>
      <span className="usage-row__strip">
        <LimitStrip
          from={view.from}
          to={view.to}
          points={row.points}
          limit={row.limit}
          marks={USAGE_THRESHOLDS}
          markText={U.mark}
          label={stripLabel(row)}
          dayText={usageDayText}
          valueText={usageCount}
          shareText={(v) => U.ofTheLimit(shareText(v, row.limit))}
        />
      </span>
      <span className="usage-row__share">
        {row.latest !== null && (
          <span className="usage-row__pct tnum">{shareText(row.latest, row.limit)}</span>
        )}
        {level !== null && (
          <StatusPill tone={level === "limit" ? "danger" : level === 80 ? "warning" : "info"} icon="flag">
            {U.reached[level]}
          </StatusPill>
        )}
      </span>
    </li>
  );
}

/** Every day of the window that has a reading, newest first: the strips' figures in full. */
function UsageTable({ view }: { view: UsageView }) {
  const cell = (d: UsageDay, metric: string) => {
    const v = d.values[metric];
    return typeof v === "number" ? (
      <span className="tnum">{usageCount(v)}</span>
    ) : (
      <span className="muted">{U.notRead}</span>
    );
  };
  const columns: Column<UsageDay>[] = [
    {
      key: "date",
      header: U.dayColumn,
      card: "title",
      cell: (d) => <time dateTime={d.date}>{usageDayText(d.date)}</time>,
    },
    ...view.rows.map(
      (r): Column<UsageDay> => ({
        key: r.metric,
        header: r.label,
        align: "end",
        cell: (d) => cell(d, r.metric),
      }),
    ),
    { key: "stopped", header: U.stoppedColumn, align: "end", cell: (d) => cell(d, EXCEEDED_METRIC) },
  ];
  return (
    <div className="usage-table">
      <DataTable caption={U.tableCaption} columns={columns} rows={view.days} rowKey={(d) => d.date} />
    </div>
  );
}
