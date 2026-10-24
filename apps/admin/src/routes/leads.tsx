// Leads (M3.2, ADM-LEAD-02, -03, -05): three views of one section, chosen with the switch under the header and kept in
// the URL (`?view=`):
// - the list: keyset pages of GET /leads with sort, the filters (stage, owner, source, service, next action overdue) and
//   search, all in the URL; overdue next actions and repeat enquiries marked; cards below md (DataTable)
// - the board: five stages with their counts, drag a card or use its "Move to…" menu (routes/leads/board.tsx)
// - scheduled for deletion: the leads the retention clean-up may delete in the next 14 days, soonest first
// List or board is remembered on this device; the deletion view is somewhere you go, never the default.
import { formatDate, istDate } from "@techaust/core/dates";
import { LEAD_PURGE_NOTICE_DAYS } from "@techaust/core/lead-lifecycle";
import { type ReactNode, useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { api, type LeadItem, type LeadsQuery } from "../api.ts";
import { type Column, DataTable, FilterBar, Pager, type Sort } from "../components/data-table.tsx";
import { EmptyState, PageHeader } from "../components/display.tsx";
import { FolderKanban, Inbox, List, Plus, Search, Trash } from "../components/icons.tsx";
import { LoadFailed, useLoad } from "../components/states.tsx";
import { allowed } from "../lib/access.ts";
import { relative } from "../lib/format.ts";
import {
  daysUntil,
  isStage,
  type LeadsView,
  SERVICE_OPTIONS,
  SOURCE_LABELS,
  STAGE_LABELS,
  STAGES,
  storedView,
  storeView,
} from "../lib/leads.ts";
import { useUser } from "../session.tsx";
import { Board } from "./leads/board.tsx";
import { LeadName, LeadsGate, NextAction, StagePill } from "./leads/parts.tsx";

/** The section's own description (the rail's "coming soon" text from M3.1, now true). */
const LEDE =
  "Enquiries from the website's contact and quote forms, as a list and a board, each with its timeline and a way to turn it into a client.";

export function Component() {
  return (
    <LeadsGate>
      <Leads />
    </LeadsGate>
  );
}

const VIEWS: { key: LeadsView; label: string; icon: ReactNode }[] = [
  { key: "list", label: "List", icon: <List /> },
  { key: "board", label: "Board", icon: <FolderKanban /> },
  { key: "deletion", label: "Scheduled for deletion", icon: <Trash /> },
];

function Leads() {
  const user = useUser();
  const [params] = useSearchParams();
  const asked = params.get("view");
  const view: LeadsView =
    asked === "board" || asked === "list" || asked === "deletion" ? asked : storedView();
  useEffect(() => {
    if (view !== "deletion") storeView(view);
  }, [view]);
  const canWrite = allowed(user.role, "leads.write");

  return (
    <>
      <PageHeader
        title={view === "deletion" ? "Scheduled for deletion" : "Leads"}
        crumbs={view === "deletion" ? [{ label: "Leads", to: "/leads?view=list" }] : undefined}
        lede={
          view === "deletion"
            ? `Leads that haven't become clients are deleted when their retention period ends. These are the ones due in the next ${LEAD_PURGE_NOTICE_DAYS} days, soonest first. A new note, reply or change moves a lead's date on.`
            : LEDE
        }
        action={
          canWrite && view !== "deletion" ? (
            <Link to="/leads/new" className="btn btn--primary">
              <Plus />
              New lead
            </Link>
          ) : undefined
        }
      />
      <nav className="view-switch" aria-label="Views">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            to={`/leads?view=${v.key}`}
            className="view-switch__opt"
            aria-current={v.key === view ? "page" : undefined}
            replace
          >
            {v.icon}
            {v.label}
          </Link>
        ))}
      </nav>
      {view === "board" ? <Board /> : view === "deletion" ? <Deletion /> : <LeadList />}
    </>
  );
}

// ---- the list ---------------------------------------------------------------------------------------------------------

const SORTS = ["created", "activity", "next_action"] as const;
type SortKey = (typeof SORTS)[number];
const isSort = (v: string | null): v is SortKey => SORTS.includes(v as SortKey);

/** Set some query values (empty removes), and start again at the first page unless told otherwise. */
function useParamsSetter() {
  const [params, setParams] = useSearchParams();
  const set = (changes: Record<string, string | null>, keepCursor = false) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null || v === "") n.delete(k);
          else n.set(k, v);
        }
        if (!keepCursor) {
          n.delete("after");
          n.delete("before");
          n.delete("page");
        }
        return n;
      },
      { replace: true },
    );
  return [params, set] as const;
}

function LeadList() {
  const [params, set] = useParamsSetter();
  const user = useUser();
  const q = params.get("q") ?? "";
  const stageP = params.get("stage");
  const stage = isStage(stageP) ? stageP : null;
  const owner = params.get("owner") ?? "";
  const sourceP = params.get("source");
  const source = sourceP === "web" || sourceP === "manual" ? sourceP : null;
  const service = SERVICE_OPTIONS.some((o) => o.value === params.get("service"))
    ? (params.get("service") ?? "")
    : "";
  const overdue = params.get("overdue") === "1";
  const sortP = params.get("sort");
  const sortKey: SortKey = isSort(sortP) ? sortP : "created";
  const defaultDir = sortKey === "next_action" ? "asc" : "desc";
  const dirP = params.get("dir");
  const dir = dirP === "asc" || dirP === "desc" ? dirP : defaultDir;
  const size = params.get("size") === "50" ? 50 : 25;
  const pageNo = Math.max(1, Number(params.get("page")) || 1);
  const filtered = q.trim().length >= 2 || !!stage || !!owner || !!source || !!service || overdue;

  const query: LeadsQuery = {
    limit: size === 50 ? "50" : undefined,
    stage: stage ?? undefined,
    owner: owner || undefined,
    source: source ?? undefined,
    service: service || undefined,
    overdue: overdue ? "1" : undefined,
    sort: sortKey === "created" ? undefined : sortKey,
    dir: dir === defaultDir ? undefined : dir,
    q: q.trim().length >= 2 ? q.trim() : undefined,
    after: params.get("after") ?? undefined,
    before: params.get("before") ?? undefined,
  };
  const list = useLoad(() => api.leads(query), JSON.stringify(query));
  const people = useLoad(() => api.leadAssignees(), "");
  const rows = list.state === "ready" ? list.data.leads : [];
  const loading = list.state === "loading";
  const offset = (pageNo - 1) * size;
  const clear = () => set({ q: null, stage: null, owner: null, source: null, service: null, overdue: null });

  const others = (people.data?.assignees ?? []).filter((a) => a.id !== people.data?.me);
  const columns: Column<LeadItem>[] = [
    { key: "name", header: "Lead", card: "title", width: "30%", cell: (r) => <LeadName lead={r} /> },
    { key: "stage", header: "Stage", cell: (r) => <StagePill stage={r.stage} reason={r.lostReason} /> },
    {
      key: "service",
      header: "Service",
      cell: (r) => r.serviceName ?? <span className="muted">General enquiry</span>,
    },
    {
      key: "owner",
      header: "Owner",
      cell: (r) => r.ownerName ?? <span className="muted">Unassigned</span>,
    },
    { key: "next_action", header: "Next action", sortable: true, cell: (r) => <NextAction lead={r} /> },
    {
      key: "activity",
      header: "Last activity",
      sortable: true,
      cell: (r) =>
        r.lastActivityAt === null ? (
          <span className="muted">None</span>
        ) : (
          <time
            dateTime={new Date(r.lastActivityAt).toISOString()}
            title={formatDate(istDate(r.lastActivityAt))}
          >
            {relative(r.lastActivityAt)}
          </time>
        ),
    },
    {
      key: "created",
      header: "Created",
      sortable: true,
      cell: (r) => (
        <time dateTime={new Date(r.createdAt).toISOString()}>{formatDate(istDate(r.createdAt))}</time>
      ),
    },
  ];
  const sort: Sort = { key: sortKey, dir };

  return (
    <>
      <FilterBar
        className="filters--leads"
        searchLabel="Search by the start of a name, email, company or reference"
        query={q}
        onQuery={(v) => set({ q: v })}
        groups={[
          {
            key: "stage",
            label: "Stage",
            selected: stage ? [stage] : [],
            options: STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] })),
          },
          {
            key: "owner",
            label: "Owner",
            selected: owner ? [owner] : [],
            options: [
              { value: "me", label: "Mine" },
              { value: "none", label: "Unassigned" },
              ...others.map((a) => ({ value: a.id, label: a.name || "Name not set yet" })),
            ],
          },
          {
            key: "source",
            label: "Source",
            selected: source ? [source] : [],
            options: [
              { value: "web", label: SOURCE_LABELS.web },
              { value: "manual", label: SOURCE_LABELS.manual },
            ],
          },
          {
            key: "overdue",
            label: "Next action",
            selected: overdue ? ["1"] : [],
            options: [{ value: "1", label: "Overdue" }],
          },
        ]}
        onToggle={(group, value) => {
          const cur = { stage, owner, source, overdue: overdue ? "1" : null }[group];
          set({ [group]: cur === value ? null : value });
        }}
        extra={
          <div className="chips filters__select">
            <label className="chips__label" htmlFor="lead-service">
              Service
            </label>
            <select id="lead-service" value={service} onChange={(e) => set({ service: e.target.value })}>
              <option value="">All services</option>
              {SERVICE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        }
        extraOn={service ? 1 : 0}
        onClear={clear}
        result={
          loading
            ? "Loading…"
            : list.state === "ready"
              ? `${rows.length === 1 ? "1 lead" : `${rows.length} leads`} on this page${q.trim().length === 1 ? ". Search starts at 2 characters" : ""}`
              : ""
        }
      />

      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="leads-table">
          <DataTable
            caption="Leads"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            sort={sort}
            onSort={(k) => {
              const key = isSort(k) ? k : "created";
              const base = key === "next_action" ? "asc" : "desc";
              const nextDir = sortKey === key ? (dir === "asc" ? "desc" : "asc") : base;
              set({ sort: key === "created" ? null : key, dir: nextDir === base ? null : nextDir });
            }}
            loading={loading}
            skeletonRows={6}
            empty={
              <EmptyState
                icon={filtered ? <Search /> : <Inbox />}
                title={filtered ? "No leads match these filters" : "No leads yet"}
                action={
                  filtered ? (
                    <button type="button" className="btn btn--secondary" onClick={clear}>
                      Clear filters
                    </button>
                  ) : allowed(user.role, "leads.write") ? (
                    <Link to="/leads/new" className="btn btn--primary">
                      <Plus />
                      New lead
                    </Link>
                  ) : undefined
                }
              >
                <p>
                  {filtered
                    ? "Try fewer filters, or search for the start of a name or an email address."
                    : "Enquiries from the website's forms appear here as they arrive. Add one by hand for a call or an email."}
                </p>
              </EmptyState>
            }
          />
        </div>
      )}

      {list.state === "ready" && rows.length > 0 && (
        <Pager
          noun="leads"
          from={offset + 1}
          to={offset + rows.length}
          hasPrev={list.data.prev !== null}
          hasNext={list.data.next !== null}
          onPrev={() =>
            pageNo <= 2
              ? set({})
              : set({ before: list.data.prev, after: null, page: String(pageNo - 1) }, true)
          }
          onNext={() => set({ after: list.data.next, before: null, page: String(pageNo + 1) }, true)}
          pageSize={size}
          onPageSize={(n) => set({ size: n === 50 ? "50" : null })}
        />
      )}
    </>
  );
}

// ---- scheduled for deletion (ADM-LEAD-05) ------------------------------------------------------------------------------

function Deletion() {
  const [params, set] = useParamsSetter();
  const size = params.get("size") === "50" ? 50 : 25;
  const pageNo = Math.max(1, Number(params.get("page")) || 1);
  const query: LeadsQuery = {
    deletion: "1",
    limit: size === 50 ? "50" : undefined,
    after: params.get("after") ?? undefined,
    before: params.get("before") ?? undefined,
  };
  const list = useLoad(() => api.leads(query), JSON.stringify(query));
  const rows = list.state === "ready" ? list.data.leads : [];
  const offset = (pageNo - 1) * size;
  const now = Date.now();

  const columns: Column<LeadItem>[] = [
    { key: "name", header: "Lead", card: "title", width: "30%", cell: (r) => <LeadName lead={r} /> },
    {
      key: "activity",
      header: "Last activity",
      cell: (r) =>
        r.lastActivityAt === null ? (
          <span className="muted">None</span>
        ) : (
          <time dateTime={new Date(r.lastActivityAt).toISOString()}>
            {formatDate(istDate(r.lastActivityAt))}
          </time>
        ),
    },
    {
      key: "delete",
      header: "Deletion date",
      cell: (r) =>
        r.deleteAfter === null ? null : (
          <span className="when when--inline">
            <time dateTime={new Date(r.deleteAfter).toISOString()}>{formatDate(istDate(r.deleteAfter))}</time>
            <span className="when__rel">
              {r.deleteAfter <= now
                ? "due now"
                : daysUntil(r.deleteAfter, now) === 1
                  ? "in 1 day"
                  : `in ${daysUntil(r.deleteAfter, now)} days`}
            </span>
          </span>
        ),
    },
    { key: "stage", header: "Stage", cell: (r) => <StagePill stage={r.stage} reason={r.lostReason} /> },
  ];

  return (
    <>
      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="leads-table leads-table--short">
          <DataTable
            caption="Leads scheduled for deletion"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={list.state === "loading"}
            skeletonRows={4}
            empty={
              <EmptyState icon={<Trash />} title="Nothing scheduled for deletion">
                <p>No lead is due for deletion in the next {LEAD_PURGE_NOTICE_DAYS} days.</p>
              </EmptyState>
            }
          />
        </div>
      )}
      {list.state === "ready" && rows.length > 0 && (
        <Pager
          noun="leads"
          from={offset + 1}
          to={offset + rows.length}
          hasPrev={list.data.prev !== null}
          hasNext={list.data.next !== null}
          onPrev={() =>
            pageNo <= 2
              ? set({})
              : set({ before: list.data.prev, after: null, page: String(pageNo - 1) }, true)
          }
          onNext={() => set({ after: list.data.next, before: null, page: String(pageNo + 1) }, true)}
          pageSize={size}
          onPageSize={(n) => set({ size: n === 50 ? "50" : null })}
        />
      )}
    </>
  );
}
