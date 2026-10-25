// The file vault of a project or a client (M3.4, ADM-PRJ-04; docs/06 FileDrop). Owner and staff upload by dropping files on the
// panel or choosing them; each is checked here first (type and size, the 07-K words), then its SHA-256 is computed in the browser
// and it goes up as a raw body with `X-File-Name` and `X-File-Sha256` (the browser sends `Content-Length` from the File), one at a
// time, with a progress bar and Cancel. The server checks the bytes again and answers by code, shown in place on that file's row.
// Every file downloads through the session-checked Worker (an attachment, never opened in the admin). The share switch puts a
// file in the client portal (M7.1); delete asks first. Sales reads and downloads. A client's list holds its project files too.
import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  api,
  type FileView,
  fileDownloadHref,
  RequestError,
  sha256Hex,
  uploadFile,
  type VaultScope,
} from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { When } from "../../components/display.tsx";
import { Switch } from "../../components/form.tsx";
import { Download, FileText, FolderKanban, Trash, Upload, X } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { FieldError, SkeletonRows } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import {
  COPY,
  fileDeleteConfirm,
  PENDING,
  precheckFile,
  precheckText,
  projectErrorText,
  sizeText,
  TOASTS,
  typeName,
  VISIBILITY_LABELS,
} from "../../lib/projects.ts";
import { useUser } from "../../session.tsx";
import { VisibilityPill } from "./parts.tsx";

type Queued = {
  key: number;
  file: File;
  state: "waiting" | "checking" | "uploading" | "failed";
  sent: number;
  error: string | null;
  abort: AbortController;
};

export function FilesPanel(props: { scope: VaultScope; title?: string; emptyText?: string }) {
  const user = useUser();
  const toast = useToast();
  const canWrite = allowed(user.role, "projects.write");
  const key = `${props.scope.kind}:${props.scope.id}`;
  const first = useLoad(() => api.files(props.scope), key);
  const [more, setMore] = useState<{ files: FileView[]; next: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [seen, setSeen] = useState(first.data);
  if (first.data !== seen) {
    setSeen(first.data);
    setMore(null);
  }
  const [shared, setShared] = useState<Record<string, boolean>>({});
  const files = [...(first.data?.files ?? []), ...(more?.files ?? [])].map((f) =>
    f.id in shared ? { ...f, shared: shared[f.id] === true } : f,
  );
  const next = more ? more.next : (first.data?.next ?? null);
  const [deleting, setDeleting] = useState<FileView | null>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [said, setSaid] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(1);
  const running = useRef(false);
  const headingId = `files-h-${props.scope.kind}`;

  const patch = useCallback(
    (k: number, change: Partial<Queued>) =>
      setQueue((q) => q.map((u) => (u.key === k ? { ...u, ...change } : u))),
    [],
  );
  const drop = useCallback((k: number) => setQueue((q) => q.filter((u) => u.key !== k)), []);

  function add(list: FileList | null) {
    if (!list?.length) return;
    const items: Queued[] = [...list].map((file) => {
      const pre = precheckFile(file);
      return {
        key: seq.current++,
        file,
        state: pre ? "failed" : "waiting",
        sent: 0,
        error: pre ? precheckText(pre) : null,
        abort: new AbortController(),
      };
    });
    setQueue((q) => [...q, ...items]);
  }

  // One upload at a time, in the order chosen.
  useEffect(() => {
    if (running.current) return;
    const u = queue.find((x) => x.state === "waiting");
    if (!u) return;
    running.current = true;
    (async () => {
      try {
        patch(u.key, { state: "checking" });
        const sha = await sha256Hex(u.file);
        if (u.abort.signal.aborted) throw new RequestError(0, "aborted", "Cancelled");
        patch(u.key, { state: "uploading" });
        await uploadFile(props.scope, u.file, sha, (sent) => patch(u.key, { sent }), u.abort.signal);
        drop(u.key);
        toast("success", TOASTS.fileUploaded);
        first.reload(true);
      } catch (e) {
        if (e instanceof RequestError && e.code === "aborted") {
          drop(u.key);
          setSaid(`Cancelled: ${u.file.name}`);
        } else patch(u.key, { state: "failed", error: projectErrorText(e) });
      } finally {
        running.current = false;
        setQueue((q) => [...q]); // look for the next one
      }
    })();
  }, [queue, props.scope, first, toast, patch, drop]);

  async function share(f: FileView, on: boolean) {
    setShared((s) => ({ ...s, [f.id]: on }));
    try {
      await api.shareFile(f.id, on);
      if (on) toast("success", TOASTS.fileShared);
    } catch (e) {
      setShared((s) => ({ ...s, [f.id]: !on }));
      toast("error", projectErrorText(e));
    }
  }

  async function showMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const r = await api.files(props.scope, next);
      setMore((m) => ({ files: [...(m?.files ?? []), ...r.files], next: r.next }));
    } catch (e) {
      toast("error", projectErrorText(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const onDrag = (e: DragEvent<HTMLDivElement>, on: boolean) => {
    if (!canWrite || ![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    setOver(on);
  };

  return (
    <section className="lead-panel files-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="lead-panel__title">
        {props.title ?? "Files"}
      </h2>
      <p className="hint files-explainer">{COPY.filesSharedExplainer}</p>
      {canWrite && (
        // biome-ignore lint/a11y/noStaticElementInteractions: the drop area is a pointer shortcut; "Choose files" does the same
        <div
          className="dropzone"
          data-over={over || undefined}
          onDragEnter={(e) => onDrag(e, true)}
          onDragOver={(e) => onDrag(e, true)}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            if (!canWrite) return;
            e.preventDefault();
            setOver(false);
            add(e.dataTransfer.files);
          }}
        >
          <Upload size={24} />
          <div className="dropzone__text">
            <button type="button" className="btn btn--secondary" onClick={() => input.current?.click()}>
              Choose files
            </button>
            <p className="hint" id={`${headingId}-hint`}>
              {COPY.uploadHint}
            </p>
          </div>
          <input
            ref={input}
            type="file"
            multiple
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.csv,.txt,.zip"
            onChange={(e) => {
              add(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      )}
      <p className="visually-hidden" role="status">
        {said}
      </p>
      {queue.length > 0 && (
        <ul className="upload-list" aria-label="Uploads">
          {queue.map((u) => (
            <li key={u.key} className="upload" data-state={u.state}>
              <span className="upload__name break">{u.file.name}</span>
              {u.state === "failed" ? (
                <>
                  <FieldError id={`up-${u.key}-error`}>{u.error}</FieldError>
                  <button type="button" className="icon-btn upload__dismiss" onClick={() => drop(u.key)}>
                    <X size={16} />
                    <span className="visually-hidden">Dismiss {u.file.name}</span>
                  </button>
                </>
              ) : (
                <>
                  <span className="upload__progress">
                    <progress
                      className="export-progress__bar"
                      max={u.file.size || 1}
                      value={u.state === "uploading" ? u.sent : u.state === "checking" ? undefined : 0}
                      aria-label={`Uploading ${u.file.name}`}
                    />
                    <span className="upload__state tnum">
                      {u.state === "waiting"
                        ? "Waiting"
                        : u.state === "checking"
                          ? "Checking"
                          : `${Math.min(100, Math.round((u.sent / (u.file.size || 1)) * 100))} %`}
                    </span>
                  </span>
                  <button type="button" className="btn btn--text" onClick={() => u.abort.abort()}>
                    Cancel<span className="visually-hidden"> the upload of {u.file.name}</span>
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {first.state === "failed" ? (
        <LoadFailed error={first.error} onRetry={() => first.reload()} headingLevel={3} />
      ) : first.state === "loading" ? (
        <>
          <p className="visually-hidden" role="status">
            Loading the files
          </p>
          <SkeletonRows n={3} />
        </>
      ) : files.length === 0 ? (
        <p className="muted files-empty">{props.emptyText ?? PENDING.filesEmpty}</p>
      ) : (
        <ul className="file-list">
          {files.map((f) => (
            <li key={f.id} className="file">
              <FileText size={20} />
              <div className="file__who">
                <a className="file__name" href={fileDownloadHref(f.id)} download>
                  <span className="break">{f.filename}</span>
                  <Download size={16} />
                  <span className="visually-hidden"> (download)</span>
                </a>
                <p className="file__meta">
                  <span>
                    {typeName(f.mime)}, {sizeText(f.size)}
                  </span>
                  <span>{f.uploadedByName ?? "A former staff member"}</span>
                  <When ms={f.createdAt} inline />
                </p>
                {props.scope.kind === "client" && f.projectId && (
                  <p className="note__project">
                    <FolderKanban size={16} />
                    <Link to={`/projects/${f.projectId}?tab=files`}>Open the project</Link>
                  </p>
                )}
              </div>
              <div className="file__actions">
                {canWrite ? (
                  <span className="file__share">
                    <span id={`fs-${f.id}-label`} className="file__share-label">
                      {VISIBILITY_LABELS.shared}
                    </span>
                    <span id={`fs-${f.id}-name`} className="visually-hidden">
                      {f.filename}
                    </span>
                    <Switch
                      id={`fs-${f.id}`}
                      checked={f.shared}
                      onChange={(on) => share(f, on)}
                      labelledBy={`fs-${f.id}-label fs-${f.id}-name`}
                    />
                  </span>
                ) : (
                  <VisibilityPill shared={f.shared} />
                )}
                {canWrite && (
                  <button
                    type="button"
                    className="btn btn--text btn--danger-text"
                    onClick={() => setDeleting(f)}
                  >
                    <Trash size={16} />
                    Delete<span className="visually-hidden"> {f.filename}</span>
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <button
          type="button"
          className="btn btn--secondary notes__more"
          onClick={showMore}
          disabled={loadingMore}
          aria-busy={loadingMore || undefined}
        >
          {loadingMore ? "Loading…" : "Show more files"}
        </button>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete the file"
        tone="danger"
        confirmLabel="Delete file"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return undefined;
          try {
            await api.deleteFile(deleting.id);
          } catch (e) {
            throw new RequestError(0, e instanceof RequestError ? e.code : "network", projectErrorText(e));
          }
          toast("success", TOASTS.fileDeleted);
          first.reload(true);
          return undefined;
        }}
      >
        <p>{deleting ? fileDeleteConfirm(deleting.filename) : ""}</p>
      </ConfirmDialog>
    </section>
  );
}
