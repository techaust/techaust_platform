// The PDF of a sent proposal or estimate (M4.4; ADM-PROP-05, JOB-PDF-01): ready to download, still being made, or taking longer than
// usual with "Try again". The jobs Worker makes it a few seconds after the send; while it waits, this panel asks the API again every
// 10 seconds for 5 minutes (from the send, or from the last "Try again"), then stops and offers the retry. Errors while asking are
// ignored: the next ask, or the retry, says what is true. The download is a plain same-origin link: the API answers an attachment.
// Wording: 07-P §3–§4 (PENDING the owner's word-for-word approval).
import { useEffect, useRef, useState } from "react";
import { documentPdfHref, errorText, RequestError } from "../../api.ts";
import { Download, RotateCcw } from "../../components/icons.tsx";
import { useToast } from "../../components/toast.tsx";
import { documentsApi, type PdfState } from "../../lib/documents-api.ts";
import { PDF_COPY, PDF_POLL_MS, type PdfPhase, pdfPhase, pdfRetryText } from "../../lib/pdf.ts";

const HEADING: Record<Exclude<PdfPhase, "none">, string> = {
  ready: PDF_COPY.ready,
  making: PDF_COPY.making,
  slow: PDF_COPY.slow,
};

export function PdfPanel(props: {
  id: string;
  /** When the version was sent: the wait for its PDF starts there. */
  sentAt: number | null;
  initial: PdfState;
  /** "Try again" needs the right to send (`proposals.send`); everyone who can read the document can download its PDF. */
  canRetry: boolean;
}) {
  const toast = useToast();
  const [pdf, setPdf] = useState<PdfState>(props.initial);
  const [since, setSince] = useState<number | null>(props.sentAt);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const phase = pdfPhase(pdf.state, since, now);

  // Ask again while the PDF is being made; stop once it is ready or the 5 minutes are over.
  useEffect(() => {
    if (phase !== "making") return;
    let alive = true;
    const timer = window.setInterval(async () => {
      setNow(Date.now());
      try {
        const v = await documentsApi.get(props.id);
        if (alive && v.pdf) setPdf(v.pdf);
      } catch {
        // A failed ask changes nothing: the next one, or "Try again", tells.
      }
    }, PDF_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [phase, props.id]);

  // After "Try again" the button is gone: the heading takes the focus, so the new state is read next.
  useEffect(() => {
    if (moved.current) {
      moved.current = false;
      heading.current?.focus();
    }
  });

  if (phase === "none") return null;

  async function retry() {
    if (busy) return;
    setBusy(true);
    try {
      await documentsApi.retryPdf(props.id);
      const t = Date.now();
      setPdf((p) => ({ ...p, state: "pending" }));
      setSince(t);
      setNow(t);
      moved.current = true;
      toast("success", PDF_COPY.retried);
    } catch (e) {
      const code = e instanceof RequestError ? e.code : "";
      if (code === "pdf_done") {
        // Made in the meantime: show it as ready.
        try {
          const v = await documentsApi.get(props.id);
          if (v.pdf) {
            setPdf(v.pdf);
            moved.current = true;
          }
        } catch {
          // The toast below still says it.
        }
      }
      toast("error", pdfRetryText(code) ?? errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="lead-panel pdf-panel" data-phase={phase} aria-labelledby="pdf-h">
      <PageGlyph />
      <div className="pdf-panel__text" aria-live="polite">
        <h2 id="pdf-h" ref={heading} tabIndex={-1} className="pdf-panel__title">
          {HEADING[phase]}
        </h2>
        {phase === "ready" && pdf.fingerprint && (
          <p className="pdf-panel__meta">
            <span className="docno">{PDF_COPY.fingerprint(pdf.fingerprint)}</span>
          </p>
        )}
      </div>
      {phase === "ready" && (
        <a
          className="btn btn--primary btn--block pdf-panel__action"
          href={documentPdfHref(props.id)}
          download
        >
          <Download size={20} />
          {PDF_COPY.download}
        </a>
      )}
      {phase === "slow" && props.canRetry && (
        <button
          type="button"
          className="btn btn--secondary btn--block pdf-panel__action"
          onClick={retry}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          <RotateCcw size={20} />
          {PDF_COPY.tryAgain}
        </button>
      )}
    </section>
  );
}

/** A small A4 sheet (1 : 1.414) with the document's verdigris header rule and the 45° cut on its top corner; the lines are dashed while
 * the PDF is being made. Decoration only. */
function PageGlyph() {
  return (
    <span className="pdf-glyph" aria-hidden="true">
      <span className="pdf-glyph__rule" />
      <span className="pdf-glyph__line" />
      <span className="pdf-glyph__line" />
      <span className="pdf-glyph__line pdf-glyph__line--short" />
    </span>
  );
}
