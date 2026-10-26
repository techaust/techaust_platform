// Document terms (ADM-SET-08, VERIFY WITH CA/LEGAL): the five blocks (standard terms, proposal terms, invoice footer
// notes, export declaration, refund-policy link), each versioned. Saving never edits a version: it adds the next one,
// and documents keep the version they were made with. "Used by N documents" exists for the proposal terms and invoice
// notes; documents don't record the other three until M5, and the page says so instead of showing a zero.

import { formatIstDateTime } from "@techaust/core";
import type { TermsBlockId } from "@techaust/core/terms";
import { type FormEvent, useState } from "react";
import { api, errorText, RequestError, type TermsBlock, type TermsVersion } from "../../api.ts";
import { Modal } from "../../components/dialog.tsx";
import { EmptyState, When } from "../../components/display.tsx";
import { FormField, VerifyNote } from "../../components/form.tsx";
import { FileText, History, Pencil, Plus } from "../../components/icons.tsx";
import { Markdown } from "../../components/markdown.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice, SkeletonRows } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import { sentence } from "../../lib/format.ts";
import { FormSkeleton, StaleNotice } from "./kit.tsx";

const HELP: Record<TermsBlockId, string> = {
  standard_terms: "The general terms every proposal and invoice refers to.",
  proposal_terms: "Printed on proposals and estimates, and accepted with them.",
  invoice_footer: "The notes at the foot of every invoice.",
  export_declaration: "The declaration printed on export invoices under LUT.",
  refund_link: "The address of the refund policy, linked from documents.",
};

const usedText = (v: TermsVersion) =>
  v.usedBy === null
    ? "documents don't record this block yet (milestone M5)"
    : v.usedBy === 0
      ? "used by no documents yet"
      : v.usedBy === 1
        ? "used by 1 document"
        : `used by ${v.usedBy} documents`;

export function DocumentTerms() {
  const loaded = useLoad(() => api.terms(), "");
  const [editing, setEditing] = useState<TermsBlockId | null>(null);
  const [history, setHistory] = useState<TermsBlock | null>(null);
  if (loaded.state === "loading") return <FormSkeleton />;
  if (loaded.state === "failed") return <LoadFailed error={loaded.error} onRetry={() => loaded.reload()} />;
  const { blocks } = loaded.data;
  return (
    <>
      <VerifyNote legal>
        The wording of these blocks is yours and your lawyer's. Confirm it with your CA and a lawyer before
        documents carry it.
      </VerifyNote>
      <p className="hint">
        Each document keeps the version it was made with. Saving a block makes a new version; earlier
        documents don't change.
      </p>
      <ul className="versioned-list">
        {blocks.map((b) => (
          <li key={b.block} className="versioned">
            <div className="versioned__head">
              <h2 className="versioned__name">{b.label}</h2>
              <p className="versioned__meta">
                {b.current ? (
                  <>
                    Version {b.current.version}, {usedText(b.current)}. Saved{" "}
                    {formatIstDateTime(b.current.createdAt)}.
                  </>
                ) : (
                  <>No version yet. {HELP[b.block]}</>
                )}
              </p>
            </div>
            {editing === b.block ? (
              <Editor
                block={b}
                onCancel={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  loaded.reload(true);
                }}
                onReload={() => {
                  setEditing(null);
                  loaded.reload();
                }}
              />
            ) : (
              <>
                {b.current && (
                  <div className="versioned__text">
                    {b.block === "refund_link" ? (
                      <p className="break">{b.current.bodyMd}</p>
                    ) : (
                      <Markdown source={b.current.bodyMd} className="terms-md" />
                    )}
                  </div>
                )}
                <div className="versioned__actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => setEditing(b.block)}
                    disabled={editing !== null}
                  >
                    {b.current ? <Pencil size={16} /> : <Plus size={16} />}
                    <span>
                      {b.current ? "Edit" : "Write the first version"}
                      <span className="visually-hidden"> of the {b.label.toLowerCase()}</span>
                    </span>
                  </button>
                  {b.current && <span className="hint">Saving makes version {b.current.version + 1}.</span>}
                  {b.current && b.current.version > 1 && (
                    <button type="button" className="btn btn--text" onClick={() => setHistory(b)}>
                      <History size={16} />
                      Earlier versions<span className="visually-hidden"> of the {b.label.toLowerCase()}</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {history && <HistoryDialog block={history} onClose={() => setHistory(null)} />}
    </>
  );
}

function Editor(props: {
  block: TermsBlock;
  onCancel: () => void;
  onSaved: () => void;
  onReload: () => void;
}) {
  const { block } = props;
  const toast = useToast();
  const start = block.current?.bodyMd ?? "";
  const [body, setBody] = useState(start);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = `terms-${block.block}`;
  const link = block.block === "refund_link";
  const next = (block.current?.version ?? 0) + 1;
  const dirty = body !== start;

  async function save(e: FormEvent) {
    e.preventDefault();
    const t = body.trim();
    if (!t) {
      setError(link ? "Enter the address of the refund policy." : "Enter the text.");
      document.getElementById(id)?.focus();
      return;
    }
    if (link && !/^https:\/\/\S+$/.test(t)) {
      setError("Enter a full https:// address.");
      document.getElementById(id)?.focus();
      return;
    }
    setError(null);
    setFailure(null);
    setBusy(true);
    try {
      const r = await api.saveTerms(block.block, t);
      toast(
        "success",
        r.changed
          ? `${block.label}: version ${r.version ?? next} saved.`
          : "No change: that's the current version.",
      );
      props.onSaved();
    } catch (err) {
      if (err instanceof RequestError && err.code === "version_clash") setStale(true);
      else if (err instanceof RequestError && err.fields.length) {
        setError(sentence(err.fields[0]?.message ?? "Check the text"));
        document.getElementById(id)?.focus();
      } else setFailure(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="versioned__edit" onSubmit={save} noValidate>
      {stale && <StaleNotice onReload={props.onReload} />}
      {failure && <Notice tone="error">{failure}</Notice>}
      <FormField
        id={id}
        label={link ? "Refund policy address" : `${block.label}, version ${next}`}
        hint={
          link ? "A full https:// address." : "Plain text. Line breaks are kept. Up to 12,000 characters."
        }
        error={error}
      >
        {(a) =>
          link ? (
            <input
              {...a}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          ) : (
            <textarea
              {...a}
              rows={10}
              maxLength={12_000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          )
        }
      </FormField>
      <div className="actions-row">
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Saving…" : `Save as version ${next}`}
        </button>
        <button type="button" className="btn btn--secondary" onClick={props.onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      <UnsavedChangesGuard dirty={dirty && !busy} what={`the ${block.label.toLowerCase()}`} />
    </form>
  );
}

function HistoryDialog({ block, onClose }: { block: TermsBlock; onClose: () => void }) {
  const loaded = useLoad(() => api.termsHistory(block.block), block.block);
  return (
    <Modal open title={`${block.label}: every version`} onClose={onClose}>
      <div className="dialog__body">
        {loaded.state === "loading" && <SkeletonRows n={2} />}
        {loaded.state === "failed" && (
          <LoadFailed error={loaded.error} onRetry={() => loaded.reload()} headingLevel={3} />
        )}
        {loaded.state === "ready" &&
          (loaded.data.versions.length === 0 ? (
            <EmptyState icon={<FileText />} title="No versions yet" headingLevel={3}>
              <p>Save the first version from the Document terms page.</p>
            </EmptyState>
          ) : (
            <ol className="versions">
              {loaded.data.versions.map((v) => (
                <li key={v.version} className="versions__item">
                  <h3 className="versions__title">Version {v.version}</h3>
                  <p className="versions__meta">
                    Saved <When ms={v.createdAt} inline />, {usedText(v)}.
                  </p>
                  {block.block === "refund_link" ? (
                    <p className="break">{v.bodyMd}</p>
                  ) : (
                    <Markdown source={v.bodyMd} className="terms-md" />
                  )}
                </li>
              ))}
            </ol>
          ))}
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
