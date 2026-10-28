// The signature image on Settings, Company (M4.4; ADM-SET-01): upload, replace, or remove it (with a confirmation). It saves on its own,
// outside the company form: each change answers the company settings' new version, which the form takes on (`adopt`). The preview is the
// way it prints: on white paper, above the line "Authorised signatory" (from M5.2, on tax invoices only; optional on an electronic invoice: Researched 2026-10-28, 08-C RA-06). The
// file is checked here first (PNG or JPEG, up to 256 KB) and again by the server by its bytes. Wording: 07-P §3–§4 and 07-R §7.
import type { SignatureRef } from "@techaust/core/settings";
import { useEffect, useId, useRef, useState } from "react";
import { errorText, RequestError, signatureApi, signatureSrc } from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { Upload } from "../../components/icons.tsx";
import { FieldError } from "../../components/ui.tsx";
import {
  SIGNATURE_ACCEPT,
  SIGNATURE_COPY,
  signatureErrorIsWrongFile,
  signatureFileOk,
} from "../../lib/pdf.ts";

/** "Remove the signature? Invoices issued already keep theirs.": the question is the dialog's title, the rest its body. */
const [REMOVE_TITLE, REMOVE_BODY] = (() => {
  const at = SIGNATURE_COPY.removeQuestion.indexOf("?") + 1;
  return [SIGNATURE_COPY.removeQuestion.slice(0, at), SIGNATURE_COPY.removeQuestion.slice(at).trim()];
})();

/** The line printed under the signature, as 07-P's hint names it. */
const SIGNATORY = "Authorised signatory";

export function SignatureControl(props: { initial: SignatureRef | null; adopt: (next: number) => void }) {
  const [sig, setSig] = useState<SignatureRef | null>(props.initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [broken, setBroken] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const firstButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  // After an upload or a removal the buttons change: the first one takes the focus, so the keyboard stays in the control. After a
  // removal, only once the dialog has closed (the page behind a modal dialog can't take focus; the dialog's own effect closes it first).
  useEffect(() => {
    if (refocus.current && !asking) {
      refocus.current = false;
      firstButton.current?.focus();
    }
  });

  async function upload(file: File) {
    setError(null);
    if (!signatureFileOk(file)) {
      setError(SIGNATURE_COPY.wrongFile);
      return;
    }
    setBusy(true);
    try {
      const r = await signatureApi.put(file);
      props.adopt(r.version);
      setSig(r.signature);
      setBroken(false);
      refocus.current = true;
    } catch (e) {
      setError(
        e instanceof RequestError && signatureErrorIsWrongFile(e.code)
          ? SIGNATURE_COPY.wrongFile
          : errorText(e),
      );
    } finally {
      setBusy(false);
    }
  }

  const described = [hintId, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <section className="form-section signature" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="signature__title">
        {SIGNATURE_COPY.heading}
      </h2>
      <p id={hintId} className="hint signature__hint">
        {SIGNATURE_COPY.hint}
      </p>
      <div className="signature__body">
        <figure className="signature__paper">
          <div className="signature__ink">
            {sig && !broken ? (
              <img
                key={sig.sha256}
                src={signatureSrc(sig.sha256)}
                alt={SIGNATURE_COPY.heading}
                className="signature__img"
                onError={() => setBroken(true)}
              />
            ) : null}
          </div>
          <figcaption className="signature__line">{SIGNATORY}</figcaption>
        </figure>
        <div className="signature__actions">
          <input
            ref={input}
            type="file"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            accept={SIGNATURE_ACCEPT}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
          <button
            ref={firstButton}
            type="button"
            className={sig ? "btn btn--secondary" : "btn btn--primary"}
            aria-describedby={described}
            aria-busy={busy || undefined}
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Upload size={20} />
            {sig ? SIGNATURE_COPY.replace : SIGNATURE_COPY.upload}
          </button>
          {sig && (
            <button
              type="button"
              className="btn btn--danger-outline"
              disabled={busy}
              onClick={() => {
                setError(null);
                setAsking(true);
              }}
            >
              {SIGNATURE_COPY.remove}
            </button>
          )}
        </div>
      </div>
      <div className="signature__alert" role="alert">
        {error && <FieldError id={errorId}>{error}</FieldError>}
      </div>

      <ConfirmDialog
        open={asking}
        title={REMOVE_TITLE}
        tone="danger"
        confirmLabel={SIGNATURE_COPY.remove}
        onClose={() => setAsking(false)}
        onConfirm={async () => {
          const r = await signatureApi.remove();
          props.adopt(r.version);
          setSig(null);
          refocus.current = true;
          return undefined;
        }}
      >
        <p>{REMOVE_BODY}</p>
      </ConfirmDialog>
    </section>
  );
}
