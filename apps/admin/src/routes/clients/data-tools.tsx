// The owner's data-subject tools for one contact (M3.3, ADM-CLI-05; owner answer Q4: owner only, with step-up).
// What is erased, anonymised and kept follows the owner's answers Q2 and Q3 of 2026-10-25: Researched 2026-10-28, s.36 CGST and Rules 56, 57
// (08-C RA-25) for the tax records kept, and DPDP s.8(7), s.12(3) (08-C RB-11) for keeping them while the person is anonymised.
// - Export: the 07-J explainer, a fresh authenticator code (unless a step-up is still open), then the summary and every
//   part of the manifest, page by page (≤ 50 rows each, one audit row per call), assembled into one JSON file in the
//   browser and downloaded. Progress is shown and announced; Cancel stops before the next call and downloads nothing.
// - Erase or anonymise: the mode, the 07-J confirmation for it, a reason (07-J), and the code. A 409 lands in place:
//   `on_issued_document` offers Anonymise instead; `legal_hold` says the hold stops both; `too_many_offers` (T7) offers "Anonymise in parts" (M7.4 G.5,
//   F5): 10 offers at a time, with progress and Stop, then the contact itself. Its line replaces 07-ZG line 3 ("ask your developer"), which predates the
//   parts route.
import { istDate, toIsoDate } from "@techaust/core/dates";
import { useEffect, useRef, useState } from "react";
import {
  api,
  type ContactView,
  type EraseMode,
  type ExportPage,
  type ExportPart,
  type ExportSummary,
  errorText,
  RequestError,
  stepUpActive,
} from "../../api.ts";
import { Modal } from "../../components/dialog.tsx";
import { VerifyNote } from "../../components/form.tsx";
import { Download } from "../../components/icons.tsx";
import { useToast } from "../../components/toast.tsx";
import { CodeField, FieldError, Notice, useFieldError } from "../../components/ui.tsx";
import {
  ERASE_REASON_LABELS,
  ERASE_REASONS,
  EXPORT_PART_LABELS,
  exportFile,
  exportFileName,
} from "../../lib/clients.ts";
import { ZN_UI } from "../../lib/copy-zn.ts";
import { ZR_PARTS } from "../../lib/copy-zr.ts";
import { sentence } from "../../lib/format.ts";
import { m74Api } from "../../lib/m74-api.ts";
import { lastContactLine } from "../../lib/projects.ts";
import { isWrongCode, withCode } from "../../lib/step-up.ts";

/** 07-J (approved), word for word. */
export const EXPORT_EXPLAINER =
  "Download everything we hold about this person as a file, to answer their data request: contact details, enquiries, sign-ins, emails sent and activity.";
export const eraseConfirmation = (name: string) =>
  `Erase ${name}? This deletes their contact details, their client portal access and the personal details on their enquiries. Records the law requires us to keep, such as issued invoices, stay. This can't be undone.`;
export const anonymiseConfirmation = (name: string) =>
  `Anonymise ${name}? Their name, email and phone are replaced with 'Removed contact' wherever we can, and their client portal access ends. Issued invoices and acceptances keep the details the law requires. This can't be undone.`;

/** Owner-approved 2026-10-25: shown in both dialogs. */
export const DATA_TOOLS_VERIFY = "Check your obligations before you export or erase someone's data.";

const CODE_MISSING = "Enter the 6-digit code from your authenticator app.";

type Progress = { part: ExportPart | "summary"; index: number; total: number; rows: number };
type ExportState =
  | { step: "ready" }
  | { step: "running"; progress: Progress }
  | { step: "done"; url: string; name: string; rows: number }
  | { step: "cancelled" }
  | { step: "failed"; error: string };

export function ExportDialog(props: { contact: ContactView | null; onClose: () => void }) {
  const c = props.contact;
  const [state, setState] = useState<ExportState>({ step: "ready" });
  const [code, setCode] = useState("");
  const [codeError, setCodeError, codeErrorKey] = useFieldError();
  const [shown, setShown] = useState<string | null>(null);
  const cancelled = useRef(false);
  if ((c?.id ?? null) !== shown) {
    setShown(c?.id ?? null);
    setState({ step: "ready" });
    setCode("");
    setCodeError(null);
  }
  // A finished file's address is released when the dialog closes or a new export starts.
  const url = state.step === "done" ? state.url : null;
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  const needsCode = !stepUpActive();
  const running = state.step === "running";

  async function run() {
    if (!c) return;
    if (needsCode && code.length !== 6) {
      setCodeError(CODE_MISSING);
      document.getElementById("export-code")?.focus();
      return;
    }
    setCodeError(null);
    cancelled.current = false;
    try {
      const summary = await withCode<ExportSummary>(needsCode ? code : undefined, () =>
        api.exportSummary(c.id),
      );
      const total = summary.manifest.length;
      const parts: Partial<Record<ExportPart, Record<string, unknown>[]>> = {};
      let rows = 1;
      for (const [i, part] of summary.manifest.entries()) {
        let after: string | undefined;
        const items: Record<string, unknown>[] = [];
        do {
          if (cancelled.current) {
            setState({ step: "cancelled" });
            return;
          }
          setState({ step: "running", progress: { part, index: i + 1, total, rows } });
          const page: ExportPage = await api.exportPart(c.id, part, after);
          items.push(...page.items);
          rows += page.items.length;
          after = page.next ?? undefined;
        } while (after);
        parts[part] = items;
      }
      const now = Date.now();
      const file = JSON.stringify(exportFile(summary, parts, now), null, 2);
      const blobUrl = URL.createObjectURL(new Blob([file], { type: "application/json" }));
      const name = exportFileName(c.id, toIsoDate(istDate(now)));
      setState({ step: "done", url: blobUrl, name, rows });
      download(blobUrl, name);
    } catch (e) {
      if (isWrongCode(e)) {
        setCode("");
        setCodeError(e.message);
        setState({ step: "ready" });
        document.getElementById("export-code")?.focus();
      } else setState({ step: "failed", error: errorText(e) });
    }
  }

  const p = state.step === "running" ? state.progress : null;
  return (
    <Modal
      open={!!c}
      title={c ? `Export ${c.name}'s data` : ""}
      onClose={() => {
        if (running) cancelled.current = true;
        props.onClose();
      }}
      busy={running}
    >
      <div className="dialog__body data-tool">
        <p>{EXPORT_EXPLAINER}</p>
        <VerifyNote>{DATA_TOOLS_VERIFY}</VerifyNote>
        {state.step === "ready" && needsCode && (
          <CodeField
            id="export-code"
            label="Authenticator code"
            hint="A fresh code from your authenticator app confirms it's you."
            value={code}
            onChange={setCode}
            error={codeError}
            errorKey={codeErrorKey}
          />
        )}
        {p && (
          <div className="export-progress">
            <progress
              className="export-progress__bar"
              max={p.total}
              value={p.index - 1}
              aria-labelledby="export-progress-text"
            />
            <p className="export-progress__text" id="export-progress-text" role="status">
              {`Part ${p.index} of ${p.total}: ${EXPORT_PART_LABELS[p.part as ExportPart] ?? p.part}. ${p.rows === 1 ? "1 record" : `${p.rows} records`} so far.`}
            </p>
          </div>
        )}
        {state.step === "cancelled" && <Notice tone="info">Export cancelled. Nothing was downloaded.</Notice>}
        {state.step === "failed" && (
          <Notice tone="error">{`The export stopped. ${sentence(state.error)}`}</Notice>
        )}
        {state.step === "done" && (
          <Notice tone="success">
            <p>
              {`Downloaded ${state.name}, with ${state.rows === 1 ? "1 record" : `${state.rows} records`}.`}
            </p>
            <a className="btn btn--text" href={state.url} download={state.name}>
              <Download size={16} />
              Download again
            </a>
          </Notice>
        )}
      </div>
      <div className="dialog__actions">
        {running ? (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              cancelled.current = true;
            }}
          >
            Cancel export
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--secondary" onClick={props.onClose}>
              {state.step === "done" ? "Close" : "Cancel"}
            </button>
            {state.step !== "done" && (
              <button type="button" className="btn btn--primary" onClick={run}>
                <Download />
                {state.step === "ready" ? "Export data" : "Try again"}
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** Starts the download of a ready file (the browser's own save, nothing is sent anywhere). */
function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
}

export function EraseDialog(props: {
  contact: ContactView | null;
  /** The individual client whose last live contact this is (its notes and files go too; 07-K), or null. */
  lastContactOf?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const c = props.contact;
  const [mode, setMode] = useState<EraseMode>("erase");
  const [reason, setReason] = useState<string | null>(null);
  const [reasonMissing, setReasonMissing] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError, codeErrorKey] = useFieldError();
  const [blocked, setBlocked] = useState<{ code: string; text: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  if ((c?.id ?? null) !== shown) {
    setShown(c?.id ?? null);
    setMode("erase");
    setReason(null);
    setReasonMissing(false);
    setCode("");
    setCodeError(null);
    setBlocked(null);
    setFailure(null);
  }
  const needsCode = !stepUpActive();
  const held = blocked?.code === "legal_hold";
  // M7.4 (G.5, F5): more than 10 offers name the person: anonymised in parts, 10 offers at a time, then the contact. `n` offers done so far.
  const [parts, setParts] = useState<
    | { step: "offer" }
    | { step: "running"; n: number; finishing: boolean }
    | { step: "stopped" | "failed"; n: number }
    | null
  >(null);
  const stop = useRef(false);
  if ((c?.id ?? null) !== shown && parts !== null) setParts(null);

  function pick(m: EraseMode) {
    setMode(m);
    if (blocked?.code === "on_issued_document" || blocked?.code === "too_many_offers") setBlocked(null);
    setParts(null);
    setFailure(null);
  }

  async function runParts(from: number) {
    if (!c || !reason) return;
    if (needsCode && code.length !== 6) {
      setCodeError(CODE_MISSING);
      document.getElementById("erase-code")?.focus();
      return;
    }
    setCodeError(null);
    setFailure(null);
    setBusy(true);
    stop.current = false;
    let n = from;
    setParts({ step: "running", n, finishing: false });
    try {
      let more = true;
      // the code (when one is needed) opens the step-up once; every later part runs inside it
      await withCode(needsCode ? code : undefined, async () => {
        while (more) {
          if (stop.current) return;
          try {
            const r = await m74Api.redactOffersPart(c.id, reason);
            n += r.redacted;
            more = r.more;
          } catch (e) {
            // nothing left to redact (another part, or a person's offers accepted meanwhile): straight to the contact
            if (e instanceof RequestError && e.code === "nothing_to_redact") more = false;
            else throw e;
          }
          setParts({ step: "running", n, finishing: !more });
        }
      });
      if (stop.current) {
        setParts({ step: "stopped", n });
        return;
      }
      await api.eraseContact(c.id, "anonymise", reason);
      toast("success", "Contact anonymised.");
      props.onDone();
    } catch (e) {
      if (isWrongCode(e)) {
        setCode("");
        setCodeError(e.message);
        setParts({ step: "offer" });
        document.getElementById("erase-code")?.focus();
      } else {
        setParts({ step: "failed", n });
        setFailure(errorText(e));
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!c) return;
    if (!reason) {
      setReasonMissing(true);
      document.getElementById("erase-reason-0")?.focus();
      return;
    }
    if (needsCode && code.length !== 6) {
      setCodeError(CODE_MISSING);
      document.getElementById("erase-code")?.focus();
      return;
    }
    setCodeError(null);
    setBusy(true);
    setFailure(null);
    try {
      await withCode(needsCode ? code : undefined, () => api.eraseContact(c.id, mode, reason));
      toast("success", mode === "erase" ? "Contact erased." : "Contact anonymised.");
      props.onDone();
    } catch (e) {
      if (
        e instanceof RequestError &&
        (e.code === "on_issued_document" || e.code === "legal_hold" || e.code === "too_many_offers")
      ) {
        // M7.4 (F5): too many offers is no longer a dead end: the dialog offers "Anonymise in parts" (ZR_PARTS), nothing changed yet
        if (e.code === "too_many_offers") setParts({ step: "offer" });
        setBlocked({
          code: e.code,
          text: e.code === "too_many_offers" ? ZR_PARTS.explain : sentence(e.message),
        });
      } else if (isWrongCode(e)) {
        setCode("");
        setCodeError(e.message);
        document.getElementById("erase-code")?.focus();
      } else setFailure(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!c}
      title={c ? `Erase or anonymise ${c.name}` : ""}
      onClose={props.onClose}
      busy={busy}
      tone="danger"
    >
      <div className="dialog__body data-tool">
        <fieldset className="radios">
          <legend>What to do</legend>
          <div className="segmented">
            {(["erase", "anonymise"] as const).map((m) => (
              <label key={m} className="segmented__opt">
                <input
                  type="radio"
                  name="erase-mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => pick(m)}
                />
                {m === "erase" ? "Erase" : "Anonymise"}
              </label>
            ))}
          </div>
        </fieldset>
        {c && (
          <p className="data-tool__confirm" id="erase-confirm" tabIndex={-1}>
            {mode === "erase" ? eraseConfirmation(c.name) : anonymiseConfirmation(c.name)}
          </p>
        )}
        {/* M6.4 (08-C RB-40 note, lead 2026-11-02): remittance advice files are kept as the proof of export realisation, in either mode */}
        {c && <p className="data-tool__also">{ZN_UI.eraseKeepsAdvices}</p>}
        {c && props.lastContactOf && (
          <p className="data-tool__also">{lastContactLine(props.lastContactOf)}</p>
        )}
        <VerifyNote>{DATA_TOOLS_VERIFY}</VerifyNote>
        {parts && (
          <div className="dp-parts" role="status">
            <p>
              {parts.step === "offer"
                ? ZR_PARTS.explain
                : parts.step === "running"
                  ? parts.finishing
                    ? ZR_PARTS.finishing
                    : ZR_PARTS.progress(parts.n)
                  : parts.step === "stopped"
                    ? ZR_PARTS.stopped(parts.n)
                    : ZR_PARTS.failed(parts.n)}
            </p>
            {parts.step === "running" && <progress className="dp-parts__bar" aria-hidden="true" />}
          </div>
        )}
        {blocked && !parts && (
          <Notice tone="error">
            <p>{blocked.text}</p>
            {blocked.code === "on_issued_document" && (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  pick("anonymise");
                  document.getElementById("erase-confirm")?.focus();
                }}
              >
                Anonymise instead
              </button>
            )}
          </Notice>
        )}
        <fieldset
          className="radios"
          aria-describedby={reasonMissing ? "erase-reason-error" : undefined}
          aria-invalid={reasonMissing || undefined}
        >
          <legend>Reason</legend>
          {ERASE_REASONS.map((r, i) => (
            <label key={r} className="radio">
              <input
                id={`erase-reason-${i}`}
                type="radio"
                name="erase-reason"
                value={r}
                checked={reason === r}
                onChange={() => {
                  setReason(r);
                  setReasonMissing(false);
                }}
              />
              {ERASE_REASON_LABELS[r]}
            </label>
          ))}
        </fieldset>
        {reasonMissing && <FieldError id="erase-reason-error">Choose a reason.</FieldError>}
        {needsCode && (
          <CodeField
            id="erase-code"
            label="Authenticator code"
            hint="A fresh code from your authenticator app confirms it's you."
            value={code}
            onChange={setCode}
            error={codeError}
            errorKey={codeErrorKey}
          />
        )}
        {failure && <Notice tone="error">{failure}</Notice>}
      </div>
      <div className="dialog__actions">
        {parts?.step === "running" ? (
          // one part is one request: Stop takes effect before the next part, and the contact is left as it is
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              stop.current = true;
            }}
            disabled={parts.finishing}
          >
            {ZR_PARTS.stop}
          </button>
        ) : (
          <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
        )}
        {parts ? (
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => void runParts(parts.step === "offer" ? 0 : "n" in parts ? parts.n : 0)}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? "Working…" : parts.step === "offer" ? ZR_PARTS.start : ZR_PARTS.continue}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--danger"
            onClick={confirm}
            disabled={busy || held || blocked?.code === "on_issued_document"}
            aria-busy={busy || undefined}
          >
            {busy ? "Working…" : mode === "erase" ? "Erase contact" : "Anonymise contact"}
          </button>
        )}
      </div>
    </Modal>
  );
}
