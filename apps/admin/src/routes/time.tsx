// Time (M3.5, ADM-TIME-01..03): the weekly timesheet, Monday to Sunday in IST, from GET /time/week (one row per person and target,
// the days across, the API's day totals underneath), the person and target filters in the URL, and the week's entries from GET /time
// (50 at a time) with edit and delete under the 7-day lock. Owner, staff and Sales log their own time (the owner also for others);
// the accountant reads everyone's. The CSV export is built in the browser from GET /time pages (export.tsx).
import "./care/parts.tsx";
import { istDate, toIsoDate } from "@techaust/core/dates";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { api, RequestError, type TimeEntry, type TimeWeek } from "../api.ts";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { type Column, DataTable } from "../components/data-table.tsx";
import { EmptyState, PageHeader, Skeleton, StatusPill } from "../components/display.tsx";
import { ChevronLeft, ChevronRight, Clock, Lock, Pencil, Plus, Trash } from "../components/icons.tsx";
import { LoadFailed, NoAccess, StaleNotice, useLoad } from "../components/states.tsx";
import { useToast } from "../components/toast.tsx";
import { Notice } from "../components/ui.tsx";
import { allowed } from "../lib/access.ts";
import { careErrorText, clockText, dayText, hoursText } from "../lib/care.ts";
import {
  dayHead,
  lockState,
  nextWeek,
  previousWeek,
  rowTotal,
  type SheetRow,
  sheetRows,
  TIME_COPY,
  TIME_PENDING,
  TIME_TOASTS,
  targetOf,
  weekDays,
  weekHeading,
  weekOf,
  weekStartFrom,
} from "../lib/time.ts";
import { useUser } from "../session.tsx";
import { EntryDialog } from "./time/entry-dialog.tsx";
import { ExportButton } from "./time/export.tsx";

export function Component() {
  const user = useUser();
  return allowed(user.role, "time.readOwn") || allowed(user.role, "time.readAll") ? (
    <TimeScreen />
  ) : (
    <NoAccess what="Time" />
  );
}

const istToday = () => toIsoDate(istDate(Date.now()));

/** The target filter in the URL: `p:<id>` for a project, `c:<id>` for a care plan. */
function parseTarget(v: string | null): { projectId?: string; carePlanId?: string } {
  if (v?.startsWith("p:")) return { projectId: v.slice(2) };
  if (v?.startsWith("c:")) return { carePlanId: v.slice(2) };
  return {};
}

function TimeScreen() {
  const user = useUser();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const today = istToday();
  const week = weekStartFrom(params.get("week"), today);
  const person = params.get("person") ?? "";
  const target = params.get("target");
  const targetLabel = params.get("tl") ?? "";
  const t = parseTarget(target);
  const canLog = allowed(user.role, "time.writeOwn");
  const canWriteAny = allowed(user.role, "time.writeAny");
  const readAll = allowed(user.role, "time.readAll");
  const set = (changes: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null || v === "") n.delete(k);
          else n.set(k, v);
        }
        return n;
      },
      { replace: true },
    );

  const people = useLoad(() => api.timePeople(), "");
  // The owner logs for others: their own id (for "(you)" in "Log time for") comes from the lead assignees list, as on Projects.
  const self = useLoad(
    () => (canWriteAny ? api.leadAssignees() : Promise.resolve(null)),
    canWriteAny ? "self" : "",
  );
  const filters = { userId: person || undefined, ...t };
  const sheet = useLoad(() => api.timeWeek({ start: week, ...filters }), JSON.stringify([week, filters]));
  // The target menu lists what this week holds for the person chosen: the same answer when no target is set.
  const unfiltered = useLoad(
    () => (target ? api.timeWeek({ start: week, userId: person || undefined }) : Promise.resolve(null)),
    target ? JSON.stringify([week, person]) : "",
  );
  const optionsFrom: TimeWeek | null = target ? (unfiltered.data ?? null) : (sheet.data ?? null);

  const [editing, setEditing] = useState<{ entry: TimeEntry | null; override: boolean } | null>(
    params.get("log") === "1" && canLog ? { entry: null, override: false } : null,
  );
  const [deleting, setDeleting] = useState<TimeEntry | null>(null);
  const [stale, setStale] = useState(false);
  const [entriesKey, setEntriesKey] = useState(0);

  function reloadAll() {
    sheet.reload(true);
    unfiltered.reload(true);
    setEntriesKey((k) => k + 1);
  }

  const showPeople = readAll && !person;
  const myId = self.data?.me ?? "";
  const viewer = { canWriteOwn: canLog, canWriteAny };
  const targetOptions = targetMenu(optionsFrom, target, targetLabel);

  return (
    <>
      <PageHeader
        title="Time"
        action={
          canLog ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                if (params.get("log")) set({ log: null });
                setEditing({ entry: null, override: false });
              }}
            >
              <Plus />
              Log time
            </button>
          ) : undefined
        }
      />

      <section className="filters filters--time" aria-label="Filters">
        {(people.data?.people.length ?? 0) > 1 && (
          <div className="field">
            <label htmlFor="time-person">Person</label>
            <select id="time-person" value={person} onChange={(e) => set({ person: e.target.value })}>
              {readAll && <option value="">Everyone</option>}
              {(people.data?.people ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || "Name not set yet"}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="time-target">Project or care plan</label>
          <select
            id="time-target"
            value={target ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              set({ target: v, tl: targetOptions.find((o) => o.value === v)?.label ?? null });
            }}
          >
            <option value="">All projects and care plans</option>
            {targetOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="filters__foot time-export">
          <ExportButton from={week} to={weekOf(week).end} filters={filters} />
        </div>
      </section>

      {stale && (
        <StaleNotice
          title={TIME_PENDING.staleEntry}
          onReload={() => {
            setStale(false);
            reloadAll();
          }}
        />
      )}

      <section className="lead-panel timesheet-panel" aria-labelledby="week-h">
        <div className="week-nav">
          <h2 id="week-h" className="week-nav__title">
            {weekHeading(week)}
          </h2>
          <div className="week-nav__buttons">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => set({ week: previousWeek(week) })}
            >
              <ChevronLeft size={20} />
              Previous week
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={week === weekOf(today).start}
              onClick={() => set({ week: null })}
            >
              This week
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={week >= weekOf(today).start}
              onClick={() => set({ week: nextWeek(week) })}
            >
              Next week
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
        {sheet.state === "failed" ? (
          <LoadFailed error={sheet.error} onRetry={() => sheet.reload()} headingLevel={3} />
        ) : sheet.state === "loading" ? (
          <div className="stack-sm">
            <p className="visually-hidden" role="status">
              Loading the timesheet
            </p>
            <Skeleton width="40%" />
            <Skeleton width="100%" />
            <Skeleton width="100%" />
            <Skeleton width="70%" />
          </div>
        ) : (
          <Timesheet data={sheet.data} today={today} showPeople={showPeople} />
        )}
      </section>

      <Entries
        key={`${week}|${person}|${target ?? ""}|${entriesKey}`}
        from={week}
        to={weekOf(week).end}
        filters={filters}
        viewer={viewer}
        showPeople={readAll && !person}
        onEdit={(entry) => setEditing({ entry, override: lockState(entry, viewer) === "override" })}
        onDelete={setDeleting}
      />

      <EntryDialog
        open={editing !== null}
        entry={editing?.entry ?? null}
        override={editing?.override ?? false}
        today={today}
        me={{ id: myId, name: user.name }}
        canWriteAny={canWriteAny}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reloadAll();
        }}
        onStale={() => {
          setEditing(null);
          setStale(true);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete time entry"
        tone="danger"
        confirmLabel="Delete entry"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return undefined;
          try {
            await api.deleteTime(deleting.id, deleting.updatedAt);
          } catch (e) {
            if (e instanceof RequestError && e.code === "stale_version") {
              setStale(true);
              return undefined;
            }
            throw new RequestError(
              e instanceof RequestError ? e.status : 0,
              e instanceof RequestError ? e.code : "network",
              careErrorText(e),
            );
          }
          toast("success", TIME_TOASTS.deleted);
          reloadAll();
          return undefined;
        }}
      >
        <p>{TIME_PENDING.deleteConfirm}</p>
        {deleting && lockState(deleting, viewer) === "override" && (
          <Notice tone="info">{TIME_COPY.ownerOverride}</Notice>
        )}
      </ConfirmDialog>
    </>
  );
}

/** The target menu: what the week holds (projects first, then plans), plus the filter in the URL if this week holds none of it. */
function targetMenu(week: TimeWeek | null, current: string | null, currentLabel: string) {
  const seen = new Map<string, string>();
  for (const g of week?.groups ?? []) {
    const ref = targetOf(g);
    if (!ref) continue;
    seen.set(`${ref.kind === "project" ? "p" : "c"}:${ref.id}`, ref.label);
  }
  if (current && !seen.has(current)) seen.set(current, currentLabel || "The chosen project or care plan");
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.value[0]?.localeCompare(b.value[0] ?? "") || a.label.localeCompare(b.label));
}

// ---- the timesheet grid ---------------------------------------------------------------------------------------------------------

function TargetCell({ row }: { row: SheetRow }) {
  const t = row.target;
  if (!t) return <span className="muted">Not set</span>;
  return t.kind === "project" ? (
    <span className="sheet-target">
      <span className="docno">{t.code}</span>
      <span className="sheet-target__kind">Project</span>
    </span>
  ) : (
    <span className="sheet-target">
      <span className="docno">{t.code}</span>
      <span className="sheet-target__kind">Care plan</span>
    </span>
  );
}

function Timesheet({ data, today, showPeople }: { data: TimeWeek; today: string; showPeople: boolean }) {
  const days = weekDays(data.week.start);
  const rows = sheetRows(data.groups);
  const totals = new Map(data.dayTotals.map((d) => [d.workDate, d]));
  const billable = data.dayTotals.reduce((n, d) => n + d.billableMinutes, 0);
  if (data.totalMinutes === 0)
    return (
      <EmptyState icon={<Clock />} title={TIME_COPY.emptyWeek.replace(/\.$/, "")} headingLevel={3}>
        {null}
      </EmptyState>
    );
  return (
    <>
      <dl className="week-totals">
        <div>
          <dt>{TIME_COPY.total}</dt>
          <dd className="tnum">{hoursText(data.totalMinutes)}</dd>
        </div>
        <div>
          <dt>{TIME_COPY.billable}</dt>
          <dd className="tnum">{hoursText(billable)}</dd>
        </div>
        <div>
          <dt>{TIME_COPY.nonBillable}</dt>
          <dd className="tnum">{hoursText(data.totalMinutes - billable)}</dd>
        </div>
      </dl>
      {data.truncated && <Notice tone="info">{TIME_PENDING.truncated}</Notice>}

      {/* md and up: the week as a grid */}
      <div className="sheet-wrap">
        <table className="sheet">
          <caption className="visually-hidden">{weekHeading(data.week.start)}</caption>
          <thead>
            <tr>
              {showPeople && <th scope="col">Person</th>}
              <th scope="col">Project or care plan</th>
              {days.map((d, i) => {
                const h = dayHead(d, i);
                return (
                  <th key={d} scope="col" className="num" data-today={d === today || undefined}>
                    <span aria-hidden="true">{h.short}</span>
                    <span className="visually-hidden">{h.long}</span>
                  </th>
                );
              })}
              <th scope="col" className="num">
                {TIME_COPY.total}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                {showPeople && <td className="sheet__person">{r.userName ?? "A former staff member"}</td>}
                <th scope="row">
                  <TargetCell row={r} />
                </th>
                {days.map((d) => {
                  const m = r.days[d] ?? 0;
                  return (
                    <td
                      key={d}
                      className="num tnum"
                      data-today={d === today || undefined}
                      data-empty={!m || undefined}
                    >
                      {m ? (
                        <>
                          <span aria-hidden="true">{clockText(m)}</span>
                          <span className="visually-hidden">{hoursText(m)}</span>
                        </>
                      ) : (
                        <span className="sheet__none">
                          <span aria-hidden="true">–</span>
                          <span className="visually-hidden">None</span>
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="num tnum sheet__rowtotal">{hoursText(rowTotal(r))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={showPeople ? 2 : 1}>
                {TIME_COPY.total}
              </th>
              {days.map((d) => (
                <td key={d} className="num tnum" data-today={d === today || undefined}>
                  {hoursText(totals.get(d)?.minutes ?? 0)}
                </td>
              ))}
              <td className="num tnum sheet__rowtotal">{hoursText(data.totalMinutes)}</td>
            </tr>
            <tr className="sheet__billable">
              <th scope="row" colSpan={showPeople ? 2 : 1}>
                {TIME_COPY.billable}
              </th>
              {days.map((d) => (
                <td key={d} className="num tnum" data-today={d === today || undefined}>
                  {hoursText(totals.get(d)?.billableMinutes ?? 0)}
                </td>
              ))}
              <td className="num tnum sheet__rowtotal">{hoursText(billable)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* below md: the week as days */}
      <ol className="sheet-days">
        {days.map((d, i) => {
          const tot = totals.get(d);
          const dayRows = rows.filter((r) => (r.days[d] ?? 0) > 0);
          return (
            <li key={d} className="sheet-day" data-today={d === today || undefined}>
              <p className="sheet-day__head">
                <span>{dayHead(d, i).long}</span>
                <span className="tnum">{hoursText(tot?.minutes ?? 0)}</span>
              </p>
              {dayRows.length > 0 && (
                <ul className="sheet-day__rows">
                  {dayRows.map((r) => (
                    <li key={r.key}>
                      <span>
                        <TargetCell row={r} />
                        {showPeople && (
                          <span className="sheet-day__who">{r.userName ?? "A former staff member"}</span>
                        )}
                      </span>
                      <span className="tnum">{hoursText(r.days[d] ?? 0)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

// ---- the week's entries -----------------------------------------------------------------------------------------------------

function Entries(props: {
  from: string;
  to: string;
  filters: { userId?: string | undefined; projectId?: string; carePlanId?: string };
  viewer: { canWriteOwn: boolean; canWriteAny: boolean };
  showPeople: boolean;
  onEdit: (e: TimeEntry) => void;
  onDelete: (e: TimeEntry) => void;
}) {
  const toast = useToast();
  const first = useLoad(
    () => api.timeEntries({ from: props.from, to: props.to, limit: "50", ...props.filters }),
    "first",
  );
  const [more, setMore] = useState<{ entries: TimeEntry[]; next: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = [...(first.data?.entries ?? []), ...(more?.entries ?? [])];
  const next = more ? more.next : (first.data?.next ?? null);
  const anyLocked = rows.some((e) => lockState(e, props.viewer) === "locked");

  async function showMore() {
    if (!next) return;
    setBusy(true);
    try {
      const r = await api.timeEntries({
        from: props.from,
        to: props.to,
        limit: "50",
        after: next,
        ...props.filters,
      });
      setMore((m) => ({ entries: [...(m?.entries ?? []), ...r.entries], next: r.next }));
    } catch (e) {
      toast("error", careErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<TimeEntry>[] = [
    {
      key: "date",
      header: "Date",
      card: "title",
      cell: (e) => <time dateTime={e.workDate}>{dayText(e.workDate)}</time>,
    },
    ...(props.showPeople
      ? [{ key: "who", header: "Person", cell: (e: TimeEntry) => e.userName ?? "A former staff member" }]
      : []),
    {
      key: "target",
      header: "Project or care plan",
      cell: (e) => {
        const t = targetOf(e);
        return t ? <span className="docno-label">{t.label}</span> : <span className="muted">Not set</span>;
      },
    },
    {
      key: "time",
      header: "Time",
      align: "end",
      cell: (e) => <span className="tnum">{hoursText(e.minutes)}</span>,
    },
    {
      key: "billable",
      header: "Billable",
      cell: (e) =>
        e.billable ? (
          <StatusPill tone="neutral" icon="check">
            {TIME_COPY.billable}
          </StatusPill>
        ) : (
          <span className="muted">{TIME_COPY.nonBillable}</span>
        ),
    },
    {
      key: "note",
      header: "Note",
      width: "30%",
      cell: (e) =>
        e.note ? <span className="entry-note">{e.note}</span> : <span className="muted">None</span>,
    },
  ];

  return (
    <section className="lead-panel entries-panel" aria-labelledby="entries-h">
      <h2 id="entries-h" className="lead-panel__title">
        Entries
      </h2>
      {anyLocked && (
        <p className="panel-empty entries-lock">
          <Lock size={20} />
          <span>{TIME_COPY.locked}</span>
        </p>
      )}
      {first.state === "failed" ? (
        <LoadFailed error={first.error} onRetry={() => first.reload()} headingLevel={3} />
      ) : (
        <div className="clients-table entries-table">
          <DataTable
            caption="Time entries this week"
            columns={columns}
            rows={rows}
            rowKey={(e) => e.id}
            loading={first.state === "loading"}
            skeletonRows={3}
            empty={<p className="muted">{TIME_COPY.emptyWeek}</p>}
            actions={(e) => {
              const s = lockState(e, props.viewer);
              if (s === "locked")
                return (
                  <StatusPill tone="muted" icon="lock">
                    Locked
                  </StatusPill>
                );
              if (s === "readonly") return null;
              return (
                <span className="entry-actions">
                  <button type="button" className="btn btn--text" onClick={() => props.onEdit(e)}>
                    <Pencil size={16} />
                    Edit<span className="visually-hidden"> the entry of {dayText(e.workDate)}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--text btn--danger-text"
                    onClick={() => props.onDelete(e)}
                  >
                    <Trash size={16} />
                    Delete<span className="visually-hidden"> the entry of {dayText(e.workDate)}</span>
                  </button>
                </span>
              );
            }}
          />
        </div>
      )}
      {next && (
        <button
          type="button"
          className="btn btn--secondary notes__more"
          onClick={showMore}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? "Loading…" : "Show more entries"}
        </button>
      )}
    </section>
  );
}
