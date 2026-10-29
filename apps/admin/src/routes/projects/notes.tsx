// Notes on a project or a client (M3.4, ADM-PRJ-03): newest first, 25 at a time, each drawn from the Markdown subset's AST as
// React elements (components/markdown.tsx, never HTML). A note is Internal (staff only) or Shared with client (the portal shows
// it, M7.1); sharing, when a note is written or later, asks first with the 07-K words. The author and the owner may edit or
// delete a note (the API answers 403 to anyone else); Sales reads. A client's list holds its project notes too, each linked to
// its project.
import { formatIstDateTime } from "@techaust/core";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { api, type NoteView, type NoteVisibility, RequestError, type VaultScope } from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { When } from "../../components/display.tsx";
import { FolderKanban, Pencil, Trash } from "../../components/icons.tsx";
import { Markdown } from "../../components/markdown.tsx";
import { MenuButton } from "../../components/popover.tsx";
import { LoadFailed, StaleNotice, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { FieldError, Notice, SkeletonRows } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import {
  COPY,
  PENDING,
  projectErrorText,
  shareConfirm,
  TOASTS,
  VISIBILITY_LABELS,
} from "../../lib/projects.ts";
import { useUser } from "../../session.tsx";
import { VisibilityPill } from "./parts.tsx";

const NOTE_MAX = 10_000;

export function NotesPanel(props: {
  scope: VaultScope;
  /** Named in the share confirmation. */
  clientName: string;
  /** The client is an anonymised individual: the panel is read-only (client_anonymised). */
  readOnly?: boolean;
  /** The panel heading's level and words (the client overview nests it under its own h2s). */
  title?: string;
}) {
  const user = useUser();
  const toast = useToast();
  const canWrite = allowed(user.role, "projects.write") && !props.readOnly;
  const key = `${props.scope.kind}:${props.scope.id}`;
  const first = useLoad(() => api.notes(props.scope), key);
  // Who "you" are, for the author's own edit and delete (the owner may touch any note).
  const me = useLoad(() => (canWrite ? api.leadAssignees() : Promise.resolve(null)), "");
  const [more, setMore] = useState<{ notes: NoteView[]; next: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [seen, setSeen] = useState(first.data);
  if (first.data !== seen) {
    setSeen(first.data);
    setMore(null);
  }
  const notes = [...(first.data?.notes ?? []), ...(more?.notes ?? [])];
  const next = more ? more.next : (first.data?.next ?? null);
  const [deleting, setDeleting] = useState<NoteView | null>(null);
  const headingId = `notes-h-${props.scope.kind}`;

  const mayTouch = (n: NoteView) =>
    canWrite && (user.role === "owner" || (me.data?.me !== undefined && n.authorId === me.data.me));

  async function showMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const r = await api.notes(props.scope, next);
      setMore((m) => ({ notes: [...(m?.notes ?? []), ...r.notes], next: r.next }));
    } catch (e) {
      toast("error", projectErrorText(e));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="lead-panel notes-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="lead-panel__title">
        {props.title ?? "Notes"}
      </h2>
      {canWrite && (
        <NoteEditor scope={props.scope} clientName={props.clientName} onAdded={() => first.reload(true)} />
      )}
      {first.state === "failed" ? (
        <LoadFailed error={first.error} onRetry={() => first.reload()} headingLevel={3} />
      ) : first.state === "loading" ? (
        <>
          <p className="visually-hidden" role="status">
            Loading the notes
          </p>
          <SkeletonRows n={3} />
        </>
      ) : notes.length === 0 ? (
        <p className="muted notes-empty">
          {props.scope.kind === "client" ? PENDING.clientNotesEmpty : PENDING.notesEmpty}
        </p>
      ) : (
        <ul className="note-list">
          {notes.map((n) => (
            <NoteItem
              key={`${n.id}:${n.updatedAt}`}
              note={n}
              scope={props.scope}
              clientName={props.clientName}
              mayTouch={mayTouch(n)}
              onChanged={() => first.reload(true)}
              onDelete={() => setDeleting(n)}
            />
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
          {loadingMore ? "Loading…" : "Show more notes"}
        </button>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete the note"
        tone="danger"
        confirmLabel="Delete note"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return undefined;
          try {
            await api.deleteNote(deleting.id);
          } catch (e) {
            throw new RequestError(0, e instanceof RequestError ? e.code : "network", projectErrorText(e));
          }
          toast("success", PENDING.noteDeleted);
          first.reload(true);
          return undefined;
        }}
      >
        <p>{COPY.noteDelete}</p>
      </ConfirmDialog>
    </section>
  );
}

/** Internal or shared, with the 07-K explainer under the choice. */
function VisibilityChoice(props: {
  name: string;
  value: NoteVisibility;
  onChange: (v: NoteVisibility) => void;
}) {
  return (
    <fieldset className="radios note-visibility" aria-describedby={`${props.name}-explainer`}>
      <legend>Visibility</legend>
      <div className="segmented">
        {(["internal", "shared"] as const).map((v) => (
          <label key={v} className="segmented__opt">
            <input
              type="radio"
              name={props.name}
              value={v}
              checked={props.value === v}
              onChange={() => props.onChange(v)}
            />
            {VISIBILITY_LABELS[v]}
          </label>
        ))}
      </div>
      <p className="hint" id={`${props.name}-explainer`}>
        {COPY.sharingExplainer}
      </p>
    </fieldset>
  );
}

function NoteEditor(props: { scope: VaultScope; clientName: string; onAdded: () => void }) {
  const toast = useToast();
  const id = `note-new-${props.scope.kind}`;
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<NoteVisibility>("internal");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  async function add() {
    setBusy(true);
    setFailure(null);
    try {
      await api.addNote(props.scope, body.trim(), visibility);
      toast("success", TOASTS.noteAdded);
      setBody("");
      setVisibility("internal");
      props.onAdded();
    } catch (e) {
      setFailure(projectErrorText(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) {
      setError(PENDING.enterNote);
      document.getElementById(id)?.focus();
      return;
    }
    setError(null);
    if (visibility === "shared") setAsking(true);
    else add().catch(() => {});
  }

  return (
    <form className="note-editor" onSubmit={submit} noValidate>
      {failure && <Notice tone="error">{failure}</Notice>}
      <div className="field">
        <label htmlFor={id}>New note</label>
        <p className="hint" id={`${id}-hint`}>
          {COPY.noteFormattingHint}
        </p>
        <textarea
          id={id}
          rows={4}
          maxLength={NOTE_MAX}
          value={body}
          aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setBody(e.target.value)}
        />
        {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
      </div>
      <VisibilityChoice name={`${id}-vis`} value={visibility} onChange={setVisibility} />
      <div className="lead-panel__actions">
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Adding…" : "Add note"}
        </button>
      </div>
      <ConfirmDialog
        open={asking}
        title="Share the note"
        confirmLabel="Share note"
        onClose={() => setAsking(false)}
        onConfirm={async () => {
          try {
            await add();
          } catch (e) {
            throw new RequestError(0, e instanceof RequestError ? e.code : "network", projectErrorText(e));
          }
          return undefined;
        }}
      >
        <p>{shareConfirm(props.clientName)}</p>
      </ConfirmDialog>
    </form>
  );
}

function NoteItem(props: {
  note: NoteView;
  scope: VaultScope;
  clientName: string;
  mayTouch: boolean;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const n = props.note;
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(n.bodyMd);
  const [visibility, setVisibility] = useState<NoteVisibility>(n.visibility);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const id = `note-${n.id}`;

  async function save() {
    setBusy(true);
    setFailure(null);
    try {
      const patch: { bodyMd?: string; visibility?: NoteVisibility } = {};
      if (body.trim() !== n.bodyMd) patch.bodyMd = body.trim();
      if (visibility !== n.visibility) patch.visibility = visibility;
      if (Object.keys(patch).length) {
        await api.updateNote(n.id, { ...patch, expectedUpdatedAt: n.updatedAt });
        toast("success", patch.visibility === "shared" ? TOASTS.noteShared : TOASTS.noteSaved);
      }
      setEditing(false);
      props.onChanged();
    } catch (e) {
      if (e instanceof RequestError && e.code === "stale_version") setStale(true);
      else setFailure(projectErrorText(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) {
      setError(PENDING.enterNote);
      document.getElementById(`${id}-body`)?.focus();
      return;
    }
    setError(null);
    if (visibility === "shared" && n.visibility !== "shared") setAsking(true);
    else save().catch(() => {});
  }

  return (
    <li className="note" data-editing={editing || undefined}>
      <div className="note__head">
        <p className="note__meta">
          <span className="note__author">{n.authorName ?? "A former staff member"}</span>
          <When ms={n.createdAt} inline />
          <VisibilityPill shared={n.visibility === "shared"} />
          {props.scope.kind === "client" && n.projectId && (
            <span className="note__project">
              <FolderKanban size={16} />
              <Link to={`/projects/${n.projectId}?tab=notes`}>Open the project</Link>
            </span>
          )}
        </p>
        {props.mayTouch && !editing && (
          <MenuButton
            label={`Actions for the note by ${n.authorName ?? "a former staff member"}, ${formatIstDateTime(n.createdAt)}`}
            items={[
              {
                label: "Edit",
                icon: <Pencil size={16} />,
                onSelect: () => {
                  setBody(n.bodyMd);
                  setVisibility(n.visibility);
                  setEditing(true);
                  requestAnimationFrame(() => document.getElementById(`${id}-body`)?.focus());
                },
              },
              { label: "Delete", icon: <Trash size={16} />, tone: "danger", onSelect: props.onDelete },
            ]}
          />
        )}
      </div>
      {stale && (
        <StaleNotice
          title={PENDING.staleNote}
          onReload={() => {
            setStale(false);
            setEditing(false);
            props.onChanged();
          }}
        />
      )}
      {editing ? (
        <form className="note-editor note-editor--edit" onSubmit={submit} noValidate>
          {failure && <Notice tone="error">{failure}</Notice>}
          <div className="field">
            <label htmlFor={`${id}-body`}>Note</label>
            <p className="hint" id={`${id}-hint`}>
              {COPY.noteFormattingHint}
            </p>
            <textarea
              id={`${id}-body`}
              rows={5}
              maxLength={NOTE_MAX}
              value={body}
              aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setBody(e.target.value)}
            />
            {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
          </div>
          <VisibilityChoice name={`${id}-vis`} value={visibility} onChange={setVisibility} />
          <div className="lead-panel__actions">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || stale}
              aria-busy={busy || undefined}
            >
              {busy ? "Saving…" : "Save note"}
            </button>
          </div>
          <ConfirmDialog
            open={asking}
            title="Share the note"
            confirmLabel="Share note"
            onClose={() => setAsking(false)}
            onConfirm={async () => {
              try {
                await save();
              } catch (e) {
                throw new RequestError(
                  0,
                  e instanceof RequestError ? e.code : "network",
                  projectErrorText(e),
                );
              }
              return undefined;
            }}
          >
            <p>{shareConfirm(props.clientName)}</p>
          </ConfirmDialog>
        </form>
      ) : (
        <Markdown source={n.bodyMd} className="note__body" headings />
      )}
    </li>
  );
}
