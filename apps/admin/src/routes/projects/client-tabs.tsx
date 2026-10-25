// The client page's Projects tab (M3.4, ADM-CLI-03): the client's projects, newest first (GET /clients/:id/projects, 25 at a
// time), with "New project" for owner and staff, which opens the new project form with this client chosen. The Files tab is the
// vault panel on the client (files.tsx); the client's notes sit on its Overview (notes.tsx).
import { useState } from "react";
import { Link } from "react-router";
import { api, type ProjectView } from "../../api.ts";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { EmptyState } from "../../components/display.tsx";
import { FolderKanban, Plus } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { allowed } from "../../lib/access.ts";
import { COPY, moneyText, projectErrorText } from "../../lib/projects.ts";
import { useUser } from "../../session.tsx";
import { Day, ProjectName, ProjectPill } from "./parts.tsx";

export function ClientProjects({ clientId, readOnly }: { clientId: string; readOnly?: boolean }) {
  const user = useUser();
  const toast = useToast();
  const canWrite = allowed(user.role, "projects.write") && !readOnly;
  const first = useLoad(() => api.clientProjects(clientId), clientId);
  const [more, setMore] = useState<{ projects: ProjectView[]; next: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = [...(first.data?.projects ?? []), ...(more?.projects ?? [])];
  const next = more ? more.next : (first.data?.next ?? null);
  const newLink = `/projects/new?client=${encodeURIComponent(clientId)}`;

  async function showMore() {
    if (!next) return;
    setBusy(true);
    try {
      const r = await api.clientProjects(clientId, next);
      setMore((m) => ({ projects: [...(m?.projects ?? []), ...r.projects], next: r.next }));
    } catch (e) {
      toast("error", projectErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<ProjectView>[] = [
    { key: "name", header: "Project", card: "title", width: "34%", cell: (r) => <ProjectName project={r} /> },
    { key: "status", header: "Status", cell: (r) => <ProjectPill status={r.status} /> },
    { key: "owner", header: "Owner", cell: (r) => r.ownerName ?? <span className="muted">No owner</span> },
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

  if (first.state === "failed") return <LoadFailed error={first.error} onRetry={() => first.reload()} />;
  return (
    <section className="lead-panel client-projects" aria-labelledby="client-projects-h">
      <div className="lead-panel__head">
        <h2 id="client-projects-h" className="lead-panel__title">
          Projects
        </h2>
        {canWrite && rows.length > 0 && (
          <Link to={newLink} className="btn btn--secondary">
            <Plus size={20} />
            New project
          </Link>
        )}
      </div>
      <div className="clients-table projects-table">
        <DataTable
          caption="Projects of this client"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={first.state === "loading"}
          skeletonRows={3}
          empty={
            <EmptyState
              icon={<FolderKanban />}
              title={COPY.clientProjectsEmptyTitle}
              headingLevel={3}
              action={
                canWrite ? (
                  <Link to={newLink} className="btn btn--primary">
                    <Plus />
                    New project
                  </Link>
                ) : undefined
              }
            >
              {null}
            </EmptyState>
          }
        />
      </div>
      {next && (
        <button
          type="button"
          className="btn btn--secondary notes__more"
          onClick={showMore}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? "Loading…" : "Show more projects"}
        </button>
      )}
    </section>
  );
}
