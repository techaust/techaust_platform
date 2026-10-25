// One project (M3.4, ADM-PRJ-01..05): the header (code chip, status pill and the allowed status moves, with the 07-K
// confirmations for complete and cancel), the project strip (client, owner, dates, budget, currency) and the tabs, kept in the
// URL as `?tab=`: Overview (the dashboard: details, the milestones timeline, figures, recent notes and files), Milestones,
// Notes and Files. Owner and staff change things; Sales reads and downloads. The details draft lives above every reload (the
// M3.2 drafts pattern), so a status move or a milestone save never wipes a half-made edit.
import { type ReactNode, useReducer, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { api, type ProjectPage, type ProjectStatus, RequestError } from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { PageHeader, Skeleton } from "../../components/display.tsx";
import { ChevronDown } from "../../components/icons.tsx";
import { MenuButton } from "../../components/popover.tsx";
import { LoadFailed, NotFound, StaleNotice, useLoad } from "../../components/states.tsx";
import { type TabItem, Tabs } from "../../components/tabs.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import { allowed } from "../../lib/access.ts";
import {
  cancelConfirm,
  completeConfirm,
  detailsOf,
  moneyText,
  NO_PROJECT_DRAFTS,
  needsConfirm,
  PENDING,
  PROJECT_STATUS_LABELS,
  projectDrafts,
  projectErrorText,
  projectMoves,
} from "../../lib/projects.ts";
import { useUser } from "../../session.tsx";
import { FilesPanel } from "./files.tsx";
import { Milestones } from "./milestones.tsx";
import { NotesPanel } from "./notes.tsx";
import { Overview } from "./overview.tsx";
import { CRUMBS, Day, ProjectPill, ProjectsGate } from "./parts.tsx";

export function Component() {
  const { id = "" } = useParams();
  return (
    <ProjectsGate>
      <ProjectScreen key={id} id={id} />
    </ProjectsGate>
  );
}

export type TabKey = "overview" | "milestones" | "notes" | "files";
const TABS: TabItem<TabKey>[] = [
  { key: "overview", label: "Overview" },
  { key: "milestones", label: "Milestones" },
  { key: "notes", label: "Notes" },
  { key: "files", label: "Files" },
];

function ProjectScreen({ id }: { id: string }) {
  const page = useLoad(() => api.project(id), id);
  const [drafts, draft] = useReducer(projectDrafts, NO_PROJECT_DRAFTS);
  const [seen, setSeen] = useState<ProjectPage | null>(null);
  if (page.state === "ready" && page.data !== seen) {
    setSeen(page.data);
    draft({ type: "loaded", details: detailsOf(page.data.project) });
  }
  if (page.state === "failed") {
    if (page.error instanceof RequestError && page.error.status === 404) return <NotFound />;
    return (
      <>
        <PageHeader title="Project" crumbs={CRUMBS} />
        <LoadFailed error={page.error} onRetry={() => page.reload()} />
      </>
    );
  }
  if (page.state === "loading") return <ProjectSkeleton />;
  return (
    <ProjectView
      data={page.data}
      drafts={drafts}
      draft={draft}
      reload={(cause = "own") => {
        if (cause === "stale") draft({ type: "reloaded-latest" });
        page.reload(true);
      }}
    />
  );
}

export type Reload = (cause?: "own" | "stale") => void;

function ProjectView(props: {
  data: ProjectPage;
  drafts: ReturnType<typeof projectDrafts>;
  draft: Parameters<typeof Overview>[0]["draft"];
  reload: Reload;
}) {
  const user = useUser();
  const { project } = props.data;
  const canWrite = allowed(user.role, "projects.write") && !props.data.clientAnonymised;
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === asked) ? (asked as TabKey) : "overview";
  const select = (k: TabKey) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (k === "overview") n.delete("tab");
        else n.set("tab", k);
        return n;
      },
      { replace: true },
    );
  const [saveStale, setSaveStale] = useState(false);
  const [moveFailure, setMoveFailure] = useState<string | null>(null);
  const d = props.drafts.details;
  const dirty = d !== null && JSON.stringify(d.value) !== JSON.stringify(d.base);
  const scope = { kind: "project", id: project.id } as const;

  return (
    <>
      <UnsavedChangesGuard dirty={dirty && !saveStale} what="this project" />
      <PageHeader
        title={project.name}
        crumbs={CRUMBS}
        status={
          <>
            {/* After an erase the name is the code itself: no second copy. */}
            {project.name !== project.code && <span className="client-code docno">{project.code}</span>}
            <ProjectPill status={project.status} />
          </>
        }
        action={
          canWrite ? (
            <StatusMoves data={props.data} reload={props.reload} onFailure={setMoveFailure} />
          ) : undefined
        }
      />
      <ProjectStrip data={props.data} />
      {moveFailure && <Notice tone="error">{moveFailure}</Notice>}
      {props.data.clientAnonymised && <Notice tone="info">{PENDING.clientAnonymised}</Notice>}
      {(saveStale || props.drafts.conflict) &&
        (saveStale ? (
          <StaleNotice
            title={PENDING.staleProject}
            onReload={() => {
              setSaveStale(false);
              props.reload("stale");
            }}
          />
        ) : (
          <StaleNotice
            title={PENDING.staleProjectDraft}
            body="Your unsaved changes to those fields were set aside so theirs aren't overwritten; anything you had already saved is kept. Reload to see the latest, then make your change again."
            onReload={() => props.reload("stale")}
          />
        ))}
      <Tabs label="Project sections" tabs={TABS} selected={tab} onSelect={select}>
        {tab === "overview" ? (
          <Overview
            data={props.data}
            drafts={props.drafts}
            draft={props.draft}
            reload={props.reload}
            onStale={() => setSaveStale(true)}
            onTab={select}
          />
        ) : tab === "milestones" ? (
          <Milestones data={props.data} reload={props.reload} />
        ) : tab === "notes" ? (
          <NotesPanel scope={scope} clientName={project.clientName} readOnly={props.data.clientAnonymised} />
        ) : (
          <FilesPanel scope={scope} readOnly={props.data.clientAnonymised} />
        )}
      </Tabs>
    </>
  );
}

/** The project at a glance, the same for every role (the M3.3 identity strip). */
function ProjectStrip({ data }: { data: ProjectPage }) {
  const p = data.project;
  const facts: [string, ReactNode][] = [
    [
      "Client",
      <span key="c" className="strip-client">
        <Link to={`/clients/${p.clientId}`}>{p.clientName}</Link>
        <span className="docno strip-client__code">{p.clientCode}</span>
      </span>,
    ],
    ["Owner", p.ownerName ?? <span className="muted">No owner</span>],
    ["Start date", <Day key="s" iso={p.startDate} />],
    ["Target date", <Day key="t" iso={p.targetDate} />],
    [
      "Budget",
      p.budgetMinor === null ? (
        <span key="b" className="muted">
          Not set
        </span>
      ) : (
        <span key="b" className="tnum">
          {moneyText(p.budgetMinor, p.currency)}
        </span>
      ),
    ],
    [
      "Currency",
      <span key="cur" className="docno">
        {p.currency}
      </span>,
    ],
  ];
  return (
    <dl className="client-strip project-strip">
      {facts.map(([label, v]) => (
        <div key={label} className="client-strip__fact">
          <dt>{label}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The allowed status moves (core's list, the API's rule); completing and cancelling ask first, with the 07-K words. */
function StatusMoves({
  data,
  reload,
  onFailure,
}: {
  data: ProjectPage;
  reload: Reload;
  /** A failed move is said where it happened (under the strip), never only in a toast. */
  onFailure: (text: string | null) => void;
}) {
  const toast = useToast();
  const p = data.project;
  const moves = projectMoves(p.status);
  const [asking, setAsking] = useState<ProjectStatus | null>(null);

  async function move(to: ProjectStatus) {
    try {
      await api.setProjectStatus(p.id, to);
    } catch (e) {
      throw new RequestError(
        e instanceof RequestError ? e.status : 0,
        e instanceof RequestError ? e.code : "network",
        projectErrorText(e, { from: p.status, to }),
      );
    }
    onFailure(null);
    toast("success", PENDING.statusChanged(PROJECT_STATUS_LABELS[to]));
    reload();
  }

  if (!moves.length) return null;
  return (
    <>
      <MenuButton
        label={`Change the status of ${p.name}`}
        text="Change status"
        icon={<ChevronDown size={16} />}
        items={moves.map((to) => ({
          label: PROJECT_STATUS_LABELS[to],
          tone: to === "cancelled" ? ("danger" as const) : undefined,
          onSelect: () => {
            if (needsConfirm(to)) setAsking(to);
            else
              move(to).catch((e: Error) => {
                onFailure(e.message);
                toast("error", e.message);
              });
          },
        }))}
      />
      <ConfirmDialog
        open={asking !== null}
        title={asking === "cancelled" ? "Cancel the project" : "Mark as completed"}
        tone={asking === "cancelled" ? "danger" : "default"}
        confirmLabel={asking === "cancelled" ? "Cancel the project" : "Mark as completed"}
        onClose={() => setAsking(null)}
        onConfirm={async () => {
          if (asking) await move(asking);
          return undefined;
        }}
      >
        <p>{asking === "cancelled" ? cancelConfirm(p.name) : completeConfirm(p.name)}</p>
      </ConfirmDialog>
    </>
  );
}

function ProjectSkeleton() {
  return (
    <>
      <PageHeader title="Project" crumbs={CRUMBS} />
      <p className="visually-hidden" role="status">
        Loading the project
      </p>
      <div className="client-strip client-strip--skeleton" aria-hidden="true">
        <Skeleton width="60%" />
      </div>
      <div className="lead-page" aria-hidden="true">
        <div className="lead-page__main">
          <div className="lead-panel stack-sm">
            <Skeleton width="30%" />
            <Skeleton width="80%" />
            <Skeleton width="65%" />
          </div>
          <div className="lead-panel stack-sm">
            <Skeleton width="25%" />
            <Skeleton width="90%" />
            <Skeleton width="90%" />
          </div>
        </div>
        <div className="lead-page__side">
          <div className="lead-panel stack-sm">
            <Skeleton width="40%" />
            <Skeleton width="70%" />
          </div>
        </div>
      </div>
    </>
  );
}
