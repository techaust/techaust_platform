// Projects (M3.4, ADM-PRJ-01): keyset pages of GET /projects, newest first, with search (the start of a code or a name) and the
// status, owner and client filters, all in the URL; cards below md (DataTable). Owner and staff add projects by hand; Sales reads.
import { Link, useSearchParams } from "react-router";
import { api, type ProjectStatus, type ProjectsQuery, type ProjectView } from "../api.ts";
import { type Column, DataTable, FilterBar, Pager } from "../components/data-table.tsx";
import { EmptyState, PageHeader } from "../components/display.tsx";
import { FolderKanban, Plus, Search } from "../components/icons.tsx";
import { LoadFailed, useLoad } from "../components/states.tsx";
import { allowed } from "../lib/access.ts";
import { COPY, moneyText, PROJECT_STATUS_LABELS, PROJECT_STATUSES } from "../lib/projects.ts";
import { useUser } from "../session.tsx";
import { ClientFilter } from "./projects/client-filter.tsx";
import { Day, ProjectName, ProjectPill, ProjectsGate } from "./projects/parts.tsx";

export function Component() {
  return (
    <ProjectsGate>
      <Projects />
    </ProjectsGate>
  );
}

const isStatus = (v: string | null): v is ProjectStatus => PROJECT_STATUSES.includes(v as ProjectStatus);

function Projects() {
  const user = useUser();
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
  const q = params.get("q") ?? "";
  const statusP = params.get("status");
  const status = isStatus(statusP) ? statusP : null;
  const owner = params.get("owner") ?? "";
  const client = params.get("client") ?? "";
  const size = params.get("size") === "50" ? 50 : 25;
  const pageNo = Math.max(1, Number(params.get("page")) || 1);
  const searching = q.trim().length >= 2;
  const filtered = searching || !!status || !!owner || !!client;
  const canWrite = allowed(user.role, "projects.write");

  const query: ProjectsQuery = {
    limit: size === 50 ? "50" : undefined,
    q: searching ? q.trim() : undefined,
    status: status ?? undefined,
    ownerId: owner || undefined,
    clientId: client || undefined,
    after: params.get("after") ?? undefined,
    before: params.get("before") ?? undefined,
  };
  const list = useLoad(() => api.projects(query), JSON.stringify(query));
  const people = useLoad(() => api.leadAssignees(), "");
  const rows = list.state === "ready" ? list.data.projects : [];
  const loading = list.state === "loading";
  const offset = (pageNo - 1) * size;
  const clear = () => set({ q: null, status: null, owner: null, client: null });

  const me = people.data?.me;
  const others = (people.data?.assignees ?? []).filter((a) => a.id !== me);

  const columns: Column<ProjectView>[] = [
    { key: "name", header: "Project", card: "title", width: "28%", cell: (r) => <ProjectName project={r} /> },
    {
      key: "client",
      header: "Client",
      cell: (r) => (
        <span className="person project-client">
          <Link className="client-name__link" to={`/clients/${r.clientId}?tab=projects`}>
            {r.clientName}
          </Link>
          <span className="client-name__code">
            <span className="visually-hidden">Code </span>
            <span className="docno">{r.clientCode}</span>
          </span>
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (r) => <ProjectPill status={r.status} /> },
    {
      key: "owner",
      header: "Owner",
      cell: (r) => r.ownerName ?? <span className="muted">No owner</span>,
    },
    { key: "target", header: "Target date", cell: (r) => <Day iso={r.targetDate} /> },
    {
      key: "budget",
      header: "Budget",
      align: "end",
      cell: (r) =>
        r.budgetMinor === null ? (
          <span className="muted">Not set</span>
        ) : (
          <span className="tnum">{moneyText(r.budgetMinor, r.currency)}</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Projects"
        lede={LEDE}
        action={
          canWrite ? (
            <Link
              to={client ? `/projects/new?client=${encodeURIComponent(client)}` : "/projects/new"}
              className="btn btn--primary"
            >
              <Plus />
              New project
            </Link>
          ) : undefined
        }
      />
      <FilterBar
        className="filters--clients filters--projects"
        searchLabel="Search by the start of a project code or name"
        query={q}
        onQuery={(v) => set({ q: v })}
        groups={[
          {
            key: "status",
            label: "Status",
            selected: status ? [status] : [],
            options: PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] })),
          },
          {
            key: "owner",
            label: "Owner",
            selected: owner ? [owner] : [],
            options: [
              ...(me ? [{ value: me, label: "Mine" }] : []),
              ...others.map((a) => ({ value: a.id, label: a.name || "Name not set yet" })),
            ],
          },
        ].filter((g) => g.options.length > 0)}
        onToggle={(group, value) => {
          const cur = { status, owner }[group as "status" | "owner"];
          set({ [group]: cur === value ? null : value });
        }}
        extra={<ClientFilter clientId={client} onChange={(id) => set({ client: id })} />}
        extraOn={client ? 1 : 0}
        onClear={clear}
        result={
          loading
            ? "Loading…"
            : list.state === "ready"
              ? rows.length === 0
                ? ""
                : `${rows.length === 1 ? "1 project" : `${rows.length} projects`} on this page${q.trim().length === 1 ? ". Search starts at 2 characters" : ""}`
              : ""
        }
      />

      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="clients-table projects-table">
          <DataTable
            caption="Projects"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={loading}
            skeletonRows={6}
            empty={
              <EmptyState
                icon={filtered ? <Search /> : <FolderKanban />}
                title={filtered ? "No projects match these filters" : COPY.projectsEmptyTitle}
                action={
                  filtered ? (
                    <button type="button" className="btn btn--secondary" onClick={clear}>
                      Clear filters
                    </button>
                  ) : canWrite ? (
                    <Link to="/projects/new" className="btn btn--primary">
                      <Plus />
                      New project
                    </Link>
                  ) : undefined
                }
              >
                <p>{filtered ? COPY.projectsNoMatch : COPY.projectsEmptyBody}</p>
              </EmptyState>
            }
          />
        </div>
      )}

      {list.state === "ready" && rows.length > 0 && (
        <Pager
          noun="projects"
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

/** The section's own description (the rail's "coming soon" text from M3.1, now true). */
const LEDE = "Projects with milestones, notes and files, shared with the client or kept internal.";
