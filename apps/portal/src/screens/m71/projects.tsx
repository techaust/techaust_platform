// Projects (M7.1; POR-08, ADM-PRJ-03/-04 portal side; run file G.3, L6, L7): the organisation's projects in every status, newest first, 50 a page; and one
// project's page: its status and dates, the milestones in order (amounts and the invoice link only for a contact who can see finance: the API leaves the keys
// out otherwise, RB-31), the notes shared with the client (through `parseNoteMarkdown`, author "TecHaust") and the shared files with Download. Another
// organisation's project, or an id with nothing at it, is the plain "Page not found" (POR-03). Words: copy-zp.ts C4, C6 to C10 (marked until approved).
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import {
  type Milestone,
  type ProjectItem,
  type ProjectPage,
  portalApi,
  RequestError,
  type SharedFile,
  type SharedNote,
} from "../../api.ts";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Clock,
  FolderKanban,
  NotebookPen,
  Paperclip,
  Receipt,
} from "../../components/icons.tsx";
import { LoadProblemScreen } from "../../components/load-problem.tsx";
import { PageTitle } from "../../components/shell/portal-shell.tsx";
import { COPY } from "../../copy.ts";
import { N, WORDS } from "../../copy-documents.ts";
import { GAP, ZP } from "../../copy-zp.ts";
import { formatMoneyOf, plainProblem } from "../../lib/m71.ts";
import { dateText } from "../../lib/offers.ts";
import { MoreButton, NotFoundScreen, ScreenSkeleton } from "../home.tsx";
import { invoiceHref } from "../invoices.tsx";
import { EmptyLine, FilesTable, NoteCard, ProjectPill, projectHref, useDownloads } from "./shared.tsx";

/** A list read page by page: the rows so far, the next cursor, a failed first read or a failed later page. */
function usePaged<T>(read: (after?: string) => Promise<{ rows: T[]; next: string | null }>) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [moreProblem, setMoreProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const page = useCallback(
    async (after?: string) => {
      setBusy(true);
      setMoreProblem(null);
      try {
        const r = await read(after);
        setRows((was) => (after && was ? [...was, ...r.rows] : r.rows));
        setNext(r.next);
        setError(null);
      } catch (e) {
        if (e instanceof RequestError && e.status === 401) return;
        if (after) setMoreProblem(plainProblem(e));
        else setError(e);
      } finally {
        setBusy(false);
      }
    },
    [read],
  );
  return { rows, next, error, busy, moreProblem, page };
}

/** "Show more" under a list with another page, and the line that says why a page didn't load. */
function More(props: { next: string | null; busy: boolean; problem: string | null; onMore: () => void }) {
  if (!props.next) return null;
  return (
    <>
      <MoreButton onMore={props.onMore} busy={props.busy} />
      {props.problem && (
        <p className="m71-more-problem" role="status">
          {props.problem}
        </p>
      )}
    </>
  );
}

const readProjects = async (after?: string) => {
  const r = await portalApi.projects(after);
  return { rows: r.projects, next: r.next };
};

/** `/projects`. */
export function ProjectsRoute() {
  const list = usePaged(readProjects);
  const { page } = list;
  useEffect(() => {
    page();
  }, [page]);
  if (list.error && !list.rows)
    return <LoadProblemScreen title={WORDS.nav.projects} error={list.error} onRetry={() => page()} />;
  if (!list.rows) return <ScreenSkeleton label={COPY.loading} />;
  return (
    <ProjectsScreen
      projects={list.rows}
      more={
        <More
          next={list.next}
          busy={list.busy}
          problem={list.moreProblem}
          onMore={() => list.next && page(list.next)}
        />
      }
    />
  );
}

export function ProjectsScreen(props: { projects: ProjectItem[]; more?: ReactNode }) {
  return (
    <div className="screen">
      <header className="screen__head">
        <PageTitle text={WORDS.nav.projects} className="screen__title">
          {WORDS.nav.projects}
        </PageTitle>
      </header>
      {props.projects.length === 0 ? (
        <EmptyLine icon={<FolderKanban size={24} />}>{N.soon.projects}</EmptyLine>
      ) : (
        <ul className="drows m71-plist">
          {props.projects.map((p) => (
            <li key={p.id}>
              <Link to={projectHref(p.id)} className="drow m71-plist__row">
                <span className="drow__main">
                  <span className="drow__title">{p.name}</span>
                  {p.code && <span className="drow__meta docno">{p.code}</span>}
                </span>
                <span className="drow__status">
                  <ProjectPill status={p.status} />
                </span>
                <span className="m71-plist__dates">
                  {p.startDate && <span>{ZP.started(dateText(p.startDate))}</span>}
                  {p.targetDate && <span>{ZP.target(dateText(p.targetDate))}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {props.more}
    </div>
  );
}

type PageState =
  | { phase: "loading" }
  | { phase: "ready"; page: ProjectPage }
  | { phase: "missing" }
  | { phase: "failed"; error: unknown };

/** `/projects/:id`. */
export function ProjectRoute() {
  const { id = "" } = useParams();
  const [state, setState] = useState<PageState>({ phase: "loading" });
  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      setState({ phase: "ready", page: await portalApi.project(id) });
    } catch (e) {
      if (e instanceof RequestError && e.status === 404) setState({ phase: "missing" });
      else if (!(e instanceof RequestError && e.status === 401)) setState({ phase: "failed", error: e });
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);
  if (state.phase === "loading") return <ScreenSkeleton label={COPY.loading} />;
  if (state.phase === "missing") return <NotFoundScreen homeHref="/" />;
  if (state.phase === "failed")
    return <LoadProblemScreen title={WORDS.nav.projects} error={state.error} onRetry={load} />;
  return <ProjectScreen key={id} page={state.page} />;
}

export function ProjectScreen(props: { page: ProjectPage }) {
  const p = props.page.project;
  const downloads = useDownloads();
  const [milestones, setMilestones] = useState<Milestone[]>(props.page.milestones);
  const [msNext, setMsNext] = useState<string | null>(props.page.milestonesNext ?? null);
  const [notes, setNotes] = useState<SharedNote[]>(props.page.notes);
  const [notesNext, setNotesNext] = useState<string | null>(props.page.notesNext);
  const [files, setFiles] = useState<SharedFile[]>(props.page.files);
  const [filesNext, setFilesNext] = useState<string | null>(props.page.filesNext);
  const [busy, setBusy] = useState<"ms" | "notes" | "files" | null>(null);
  const [problem, setProblem] = useState<{ part: "ms" | "notes" | "files"; text: string } | null>(null);

  async function more(part: "ms" | "notes" | "files") {
    setBusy(part);
    setProblem(null);
    try {
      if (part === "ms" && msNext) {
        const r = await portalApi.milestones(p.id, msNext);
        setMilestones((was) => [...was, ...r.milestones.filter((m) => !was.some((x) => x.id === m.id))]);
        setMsNext(r.milestonesNext ?? null);
      } else if (part === "notes" && notesNext) {
        const r = await portalApi.notes(p.id, notesNext);
        setNotes((was) => [...was, ...r.notes]);
        setNotesNext(r.next);
      } else if (part === "files" && filesNext) {
        const r = await portalApi.files(p.id, filesNext);
        setFiles((was) => [...was, ...r.files]);
        setFilesNext(r.next);
      }
    } catch (e) {
      setProblem({ part, text: plainProblem(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="screen m71-project">
      <Link to="/projects" className="back">
        <ArrowLeft size={16} />
        {WORDS.nav.projects}
      </Link>
      <header className="screen__head m71-project__head">
        <p className="dcard__kind">
          <FolderKanban size={20} />
          {p.code ? <span className="docno">{p.code}</span> : WORDS.nav.projects}
        </p>
        <PageTitle text={p.name} className="screen__title">
          {p.name}
        </PageTitle>
        <div className="m71-project__meta">
          <ProjectPill status={p.status} />
          {p.startDate && <span>{ZP.started(dateText(p.startDate))}</span>}
          {p.targetDate && <span>{ZP.target(dateText(p.targetDate))}</span>}
        </div>
      </header>

      <section className="block" aria-labelledby="ms-h">
        <h2 id="ms-h" className="block__title">
          {ZP.milestones}
          {milestones.length > 0 && <span className="count">{milestones.length}</span>}
        </h2>
        {milestones.length === 0 ? (
          <p className="muted">{GAP.milestonesEmpty}</p>
        ) : (
          <ol className="m71-track">
            {milestones.map((m) => (
              <MilestoneRow key={m.id} m={m} />
            ))}
          </ol>
        )}
        <More
          next={msNext}
          busy={busy === "ms"}
          problem={problem?.part === "ms" ? problem.text : null}
          onMore={() => more("ms")}
        />
      </section>

      <section className="block" aria-labelledby="notes-h">
        <h2 id="notes-h" className="block__title">
          <NotebookPen size={20} />
          {ZP.notes}
        </h2>
        {notes.length === 0 ? (
          <p className="muted">{ZP.notesEmpty}</p>
        ) : (
          <ul className="m71-notes m71-notes--page">
            {notes.map((n) => (
              <li key={n.id}>
                <NoteCard note={n} />
              </li>
            ))}
          </ul>
        )}
        <More
          next={notesNext}
          busy={busy === "notes"}
          problem={problem?.part === "notes" ? problem.text : null}
          onMore={() => more("notes")}
        />
      </section>

      <section className="block" aria-labelledby="files-h">
        <h2 id="files-h" className="block__title">
          <Paperclip size={20} />
          {ZP.files}
        </h2>
        {files.length === 0 ? (
          <p className="muted">{ZP.filesEmpty}</p>
        ) : (
          <FilesTable
            caption={ZP.files}
            files={files}
            downloads={downloads}
            onDownload={(f) => downloads.run(f.id, () => portalApi.file(f.id), f.filename, ZP.fileGone)}
          />
        )}
        <More
          next={filesNext}
          busy={busy === "files"}
          problem={problem?.part === "files" ? problem.text : null}
          onMore={() => more("files")}
        />
      </section>
    </div>
  );
}

const MS_LOOK: Record<string, { tone: string; Icon: (p: { size?: 16 }) => ReactNode; done: boolean }> = {
  pending: { tone: "muted spill--outline", Icon: Clock, done: false },
  ready_to_bill: { tone: "info", Icon: CheckCircle, done: true },
  invoiced: { tone: "info", Icon: Receipt, done: true },
  paid: { tone: "success", Icon: CheckCircle, done: true },
};

/**
 * One milestone of the track (C7, C8): its place in the sequence, title, status and due date; for a finance contact its amount (none for a percentage
 * milestone) and "View invoice" when the invoice is one the client may open.
 */
function MilestoneRow({ m }: { m: Milestone }) {
  const look = MS_LOOK[m.status] ?? { tone: "muted", Icon: Clock, done: false };
  const { Icon } = look;
  const finance = "amountMinor" in m;
  return (
    <li className="m71-ms" data-done={look.done || undefined}>
      <span className="m71-ms__pos" aria-hidden="true">
        {m.position}
      </span>
      <div className="m71-ms__body">
        <h3 className="m71-ms__title">{m.title}</h3>
        <p className="m71-ms__meta">
          <span className={`spill spill--${look.tone}`}>
            <Icon size={16} />
            {ZP.milestoneStatus[m.status] ?? m.status}
          </span>
          {m.dueDate && <span className="nowrap">{ZP.due(dateText(m.dueDate))}</span>}
        </p>
      </div>
      {finance && (m.amountMinor != null || m.invoice) && (
        <div className="m71-ms__money">
          {m.amountMinor != null && m.currency && (
            <span className="m71-ms__amount">{formatMoneyOf(m.amountMinor, m.currency)}</span>
          )}
          {m.invoice && (
            <Link to={invoiceHref(m.invoice.id)} className="textlink">
              {ZP.viewInvoice}
              <span className="visually-hidden">{` ${m.invoice.numberDisplay}`}</span>
              <ArrowRight size={16} />
            </Link>
          )}
        </div>
      )}
    </li>
  );
}
