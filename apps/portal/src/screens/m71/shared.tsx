// The pieces the M7.1 screens share (POR-04, POR-07, POR-08): a download button with its own message, the shared files as a table (a card each on
// phones), a shared note, and a project's status pill. Every word is copy-zp.ts (07-ZP, owner-approved; G11's size words still marked) or an approved line.
import "./m71.css";
import { type ReactNode, useCallback, useState } from "react";
import { Link } from "react-router";
import { type Download as DownloadFile, RequestError, type SharedFile, type SharedNote } from "../../api.ts";
import { NoteMarkdown } from "../../components/document/markdown.tsx";
import { RTable } from "../../components/document/rtable.tsx";
import {
  Archive,
  CheckCircle,
  Clock,
  Download,
  FolderKanban,
  NotebookPen,
  Paperclip,
  XCircle,
} from "../../components/icons.tsx";
import { INV } from "../../copy-invoices.ts";
import { GAP, ZP } from "../../copy-zp.ts";
import { istDayText, plainProblem, sizeText } from "../../lib/m71.ts";
import { saveDownload } from "../../lib/offers.ts";

/** One download at a time on a screen: which row is busy, and a row's own message (its file is gone, or its PDF isn't ready). */
export function useDownloads() {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const run = useCallback(
    async (id: string, get: () => Promise<DownloadFile>, fallbackName: string, gone: string) => {
      setBusy(id);
      setProblem(null);
      try {
        saveDownload(await get(), fallbackName);
      } catch (e) {
        const text =
          e instanceof RequestError && e.code === "pdf_pending"
            ? INV.pdfNotReady
            : e instanceof RequestError && e.status === 404
              ? gone
              : plainProblem(e);
        setProblem({ id, text });
      } finally {
        setBusy(null);
      }
    },
    [],
  );
  return { busy, problem, run };
}
export type Downloads = ReturnType<typeof useDownloads>;

/** A row's Download button and, under it, that row's message (read out as it appears). */
export function DownloadButton(props: {
  id: string;
  label: string;
  /** Said after the label to a screen reader, so every row's button has its own name (the file or the number). */
  what: string;
  downloads: Downloads;
  onPress: () => void;
  primary?: boolean;
}) {
  const busy = props.downloads.busy === props.id;
  const problem = props.downloads.problem?.id === props.id ? props.downloads.problem.text : null;
  return (
    <span className="m71-dl">
      <button
        type="button"
        className={props.primary ? "btn btn--primary" : "btn btn--secondary"}
        onClick={props.onPress}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        <Download size={20} />
        {props.label}
        <span className="visually-hidden">{` ${props.what}`}</span>
      </button>
      {problem && (
        <span className="m71-dl__note" role="status">
          {problem}
        </span>
      )}
    </span>
  );
}

/** The shared files (C10): Name, Size, Added and Download; a file no longer shared says so on its row. */
export function FilesTable(props: {
  files: SharedFile[];
  downloads: Downloads;
  onDownload: (f: SharedFile) => void;
  caption: string;
}) {
  return (
    <RTable
      caption={props.caption}
      className="m71-files"
      rowKey={(f) => f.id}
      rows={props.files}
      columns={[
        {
          key: "name",
          label: ZP.fileName,
          lead: true,
          cell: (f) => (
            <span className="m71-files__name">
              <Paperclip size={16} />
              <span>{f.filename}</span>
            </span>
          ),
        },
        {
          key: "size",
          label: ZP.fileSize,
          num: true,
          // G11 (review L4): the size words have no approved client line yet, so they carry the mark until the owner words them
          cell: (f) => <span className="nowrap">{GAP.fileSize(sizeText(f.size))}</span>,
        },
        {
          key: "added",
          label: ZP.fileAdded,
          cell: (f) => <span className="nowrap">{istDayText(f.createdAt)}</span>,
        },
        {
          key: "download",
          label: <span className="visually-hidden">{ZP.download}</span>,
          cell: (f) => (
            <DownloadButton
              id={f.id}
              label={ZP.download}
              what={f.filename}
              downloads={props.downloads}
              onPress={() => props.onDownload(f)}
            />
          ),
        },
      ]}
    />
  );
}

/**
 * A shared note (C9, L6): "From TecHaust, {date}" (author "TecHaust": no staff names reach the portal), "Updated {date}" when it changed, then the note
 * through `parseNoteMarkdown`. `clamp`: on Home a project's note shows its first lines and the way to its project, where it is whole.
 */
export function NoteCard(props: {
  note: SharedNote;
  clamp?: boolean | undefined;
  project?: { href: string; name: string } | null | undefined;
  headingLevel?: 3 | 4;
}) {
  const n = props.note;
  const H = props.headingLevel === 4 ? "h4" : "h3";
  const changed = n.updatedAt > n.createdAt && istDayText(n.updatedAt) !== istDayText(n.createdAt);
  return (
    <article className="m71-note" data-clamp={props.clamp || undefined}>
      <header className="m71-note__head">
        <span className="m71-note__icon" aria-hidden="true">
          <NotebookPen size={16} />
        </span>
        <H className="m71-note__by">{ZP.fromTecHaust(istDayText(n.createdAt))}</H>
        {changed && <span className="m71-note__updated">{ZP.updated(istDayText(n.updatedAt))}</span>}
      </header>
      <NoteMarkdown source={n.bodyMd} className="m71-note__body" />
      {props.project && (
        <p className="m71-note__project">
          <FolderKanban size={16} />
          <Link to={props.project.href} className="textlink">
            {props.project.name}
          </Link>
        </p>
      )}
    </article>
  );
}

const PROJECT_LOOK: Record<string, { tone: string; Icon: (p: { size?: 16 }) => ReactNode }> = {
  planned: { tone: "info spill--outline", Icon: Clock },
  active: { tone: "info", Icon: FolderKanban },
  on_hold: { tone: "warning", Icon: Clock },
  completed: { tone: "success", Icon: CheckCircle },
  cancelled: { tone: "muted", Icon: XCircle },
};

/** A project's status (C6): icon, words and tone, never colour alone (docs/06 §5.5). */
export function ProjectPill({ status }: { status: string }) {
  const look = PROJECT_LOOK[status] ?? { tone: "muted", Icon: Archive };
  const { Icon } = look;
  return (
    <span className={`spill spill--${look.tone}`}>
      <Icon size={16} />
      {ZP.projectStatus[status] ?? status}
    </span>
  );
}

export const projectHref = (id: string) => `/projects/${encodeURIComponent(id)}`;

/** A section's empty line in the M4.5 pattern: the icon square and one muted line. */
export function EmptyLine(props: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="empty m71-empty">
      <span className="empty__icon">{props.icon}</span>
      <p className="muted">{props.children}</p>
    </div>
  );
}
