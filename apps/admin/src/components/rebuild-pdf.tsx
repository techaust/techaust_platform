// Rebuild PDF beside a stored PDF (JOB-PDF-02, ADM-PROP-05, ADM-INV-07; run file docs/runs/rebuild-pdf.md "Screens"; owner Q1 = B, Q2 = A): a quiet text action
// under the download, for the Owner only (`pdfs.rebuild`, with a fresh code), and the rebuild's state for everyone who reads the document. The words are
// 07-ZV's (lib/pdf-repairs.ts). The confirm dialog is the admin's own (ConfirmDialog, with its step-up slot); a step-up that lapses on the way is asked for by
// `request` and the same request is sent once more. While a rebuild runs, the state is read again every 10 seconds (and not while the tab is hidden).
// Shown only once the PDF is ready: before that, the panel's own "Making the PDF…" and "Try again" are the way.
import { formatDate, istDate } from "@techaust/core/dates";
import type { RepairKind } from "@techaust/core/pdf-repair";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { RequestError, stepUpActive } from "../api.ts";
import { allowed } from "../lib/access.ts";
import { PDF_POLL_MS } from "../lib/pdf.ts";
import {
  FINGERPRINT_CHARS,
  numberLabel,
  REREAD_AFTER,
  type RebuildState,
  rebuildLines,
  refusalLine,
  startedState,
  ZV,
} from "../lib/pdf-repairs.ts";
import { pdfRepairsApi } from "../lib/pdf-repairs-api.ts";
import { withCode } from "../lib/step-up.ts";
import { useUser } from "../session.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { AlertTriangle, Clock, RefreshCw } from "./icons.tsx";
import { useToast } from "./toast.tsx";

const day = (ms: number) => formatDate(istDate(ms));

/** Line 11 as written, with its 12 characters set in the document face (as the panel's own "Fingerprint" line sets them). */
function withCodeFace(fact: string, sha: string | undefined): ReactNode {
  const fp = sha?.slice(0, FINGERPRINT_CHARS);
  const at = fp ? fact.lastIndexOf(fp) : -1;
  if (!fp || at < 0) return fact;
  return (
    <>
      {fact.slice(0, at)}
      <span className="docno">{fp}</span>
      {fact.slice(at + fp.length)}
    </>
  );
}

export function RebuildPdf(props: {
  kind: RepairKind;
  /** The document's id (the certificate's: its document; the deed's own id; the receipt's own id). */
  id: string;
  /** The number the dialog names ("Untitled" when there is none). */
  number: string | null;
  /** The stored PDF is ready (the download is offered). Nothing is drawn, and nothing read, before that. */
  ready: boolean;
}) {
  const { kind, id, ready } = props;
  const owner = allowed(useUser().role, "pdfs.rebuild");
  const toast = useToast();
  const [state, setState] = useState<RebuildState | null>(null);
  // The code is asked for in the dialog only when no step-up is active as it opens (the server still decides).
  const [asking, setAsking] = useState<{ code: boolean } | null>(null);
  const lines = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  const read = useCallback(async () => {
    try {
      return await pdfRepairsApi.state(kind, id);
    } catch {
      // A failed read shows nothing: the download above still stands, and the next read (or a rebuild) tells.
      return null;
    }
  }, [kind, id]);

  // The first read, and again for another document.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    setState(null);
    void read().then((s) => {
      if (alive && s) setState(s);
    });
    return () => {
      alive = false;
    };
  }, [ready, read]);

  // While a rebuild runs: read again every 10 seconds until it has a result.
  const rebuilding = state?.rebuilding === true;
  useEffect(() => {
    if (!rebuilding) return;
    let alive = true;
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      const s = await read();
      if (alive && s) setState(s);
    }, PDF_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [rebuilding, read]);

  // After the start the button is gone: the state takes the focus, so "Being rebuilt…" is read next (WCAG 2.4.3).
  useEffect(() => {
    if (moved.current && !asking) {
      moved.current = false;
      lines.current?.focus({ preventScroll: true });
    }
  });

  if (!ready) return null;
  const { fact, status } = rebuildLines(state, { owner, day });

  async function rebuild(code?: string) {
    try {
      const r = await withCode(code, () => pdfRepairsApi.rebuild(kind, id));
      setState((s) => startedState(s, r.repair, Date.now()));
      moved.current = true;
      toast("success", ZV.started);
      return undefined;
    } catch (e) {
      if (!(e instanceof RequestError)) throw e;
      if (REREAD_AFTER.has(e.code))
        void read().then((s) => {
          if (s) setState(s);
        });
      if (e.code === "nothing_to_rebuild") {
        // Good news, not a fault: the dialog closes and says so once.
        toast("success", ZV.nothingToRebuild);
        return undefined;
      }
      const line = refusalLine(e.code);
      if (line) throw new RequestError(e.status, e.code, line, e.requestId);
      throw e;
    }
  }

  return (
    <div className="pdf-rebuild" data-kind={kind}>
      {/* polite and always in the tree (empty, it takes no room), so a line that appears or changes is read */}
      <div className="pdf-rebuild__lines" ref={lines} tabIndex={-1} aria-live="polite">
        {fact && <p className="pdf-rebuild__fact">{withCodeFace(fact, state?.served?.sha256)}</p>}
        {status && (
          <p className="pdf-rebuild__status" data-tone={status.tone}>
            {status.tone === "busy" ? (
              <Clock size={16} />
            ) : status.tone === "problem" ? (
              <AlertTriangle size={16} />
            ) : null}
            <span>{status.text}</span>
          </p>
        )}
      </div>
      {owner && !rebuilding && (
        <button
          type="button"
          className="btn btn--text pdf-rebuild__action"
          onClick={() => setAsking({ code: !stepUpActive() })}
        >
          <RefreshCw size={16} />
          {ZV.button[kind]}
        </button>
      )}
      {owner && (
        <ConfirmDialog
          open={asking !== null}
          title={ZV.title(numberLabel(props.number))}
          confirmLabel={ZV.confirm}
          cancelLabel={ZV.cancel}
          stepUp={asking?.code}
          onClose={() => setAsking(null)}
          onConfirm={rebuild}
        >
          <p>{ZV.body}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
