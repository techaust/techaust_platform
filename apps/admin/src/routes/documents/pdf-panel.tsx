// The PDF of a sent proposal or estimate (M4.4; ADM-PROP-05, JOB-PDF-01): ready to download, still being made, or taking longer than
// usual with "Try again". The jobs Worker makes it a few seconds after the send; while it waits, this panel asks the API again every
// 10 seconds for 5 minutes (from the send, or from the last "Try again"), then stops and offers the retry. Errors while asking are
// ignored: the next ask, or the retry, says what is true. The download is a plain same-origin link: the API answers an attachment.
// Once the PDF turns ready while the page is open, `onReady` tells the page, so the emails that waited for it are read again (finding 10).
// Wording: 07-P §3–§4 (approved by the owner with 07-Q, 2026-10-26).
import { type ReactNode, useEffect, useRef, useState } from "react";
import { documentPdfHref, errorText, RequestError } from "../../api.ts";
import { Download, RotateCcw } from "../../components/icons.tsx";
import { useToast } from "../../components/toast.tsx";
import { documentsApi, type PdfState } from "../../lib/documents-api.ts";
import { PDF_COPY, PDF_POLL_MS, pdfPhase, pdfRetryText } from "../../lib/pdf.ts";

/** The panel's words: 07-P's for proposals and estimates; an invoice passes 07-R's. */
export type PdfWords = { ready: string; making: string; slow: string; download: string; tryAgain: string };
const OFFER_WORDS: PdfWords = {
  ready: PDF_COPY.ready,
  making: PDF_COPY.making,
  slow: PDF_COPY.slow,
  download: PDF_COPY.download,
  tryAgain: PDF_COPY.tryAgain,
};

/** Where the panel reads, retries and downloads: the documents API unless an invoice passes its own (M5.1). */
export type PdfSource = {
  load: (id: string) => Promise<{ pdf?: PdfState | null | undefined }>;
  retry: (id: string) => Promise<unknown>;
  href: (id: string) => string;
};
const DOCUMENT_SOURCE: PdfSource = {
  load: (id) => documentsApi.get(id),
  retry: (id) => documentsApi.retryPdf(id),
  href: documentPdfHref,
};

export function PdfPanel(props: {
  id: string;
  /** When the version was sent: the wait for its PDF starts there. */
  sentAt: number | null;
  initial: PdfState;
  /** "Try again" needs the right to send (`proposals.send`); everyone who can read the document can download its PDF. */
  canRetry: boolean;
  words?: PdfWords | undefined;
  source?: PdfSource | undefined;
  /** Shown under the download once the PDF is ready (an invoice's supplier copy, 07-R §7). */
  extra?: ReactNode;
  /** The PDF became ready while this page was open (it was not ready when the page loaded). */
  onReady?: (() => void) | undefined;
}) {
  const words = props.words ?? OFFER_WORDS;
  const source = props.source ?? DOCUMENT_SOURCE;
  const toast = useToast();
  const [pdf, setPdf] = useState<PdfState>(props.initial);
  const [since, setSince] = useState<number | null>(props.sentAt);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const phase = pdfPhase(pdf.state, since, now);
  // Tell the page once, when the state moves to ready here (not when it was ready from the start).
  const wasReady = useRef(props.initial.state === "ready");
  const onReady = props.onReady;
  useEffect(() => {
    if (pdf.state !== "ready" || wasReady.current) return;
    wasReady.current = true;
    onReady?.();
  }, [pdf.state, onReady]);

  // Ask again while the PDF is being made; stop once it is ready or the 5 minutes are over.
  useEffect(() => {
    if (phase !== "making") return;
    let alive = true;
    const timer = window.setInterval(async () => {
      setNow(Date.now());
      try {
        const v = await source.load(props.id);
        if (alive && v.pdf) setPdf(v.pdf);
      } catch {
        // A failed ask changes nothing: the next one, or "Try again", tells.
      }
    }, PDF_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [phase, props.id, source]);

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
      await source.retry(props.id);
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
          const v = await source.load(props.id);
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
          {words[phase]}
        </h2>
        {phase === "ready" && pdf.fingerprint && (
          <p className="pdf-panel__meta">
            {PDF_COPY.fingerprintLabel} <span className="docno">{pdf.fingerprint}</span>
          </p>
        )}
      </div>
      {phase === "ready" && (
        <a className="btn btn--secondary btn--block pdf-panel__action" href={source.href(props.id)} download>
          <Download size={20} />
          {words.download}
        </a>
      )}
      {phase === "ready" && props.extra}
      {phase === "slow" && props.canRetry && (
        <button
          type="button"
          className="btn btn--secondary btn--block pdf-panel__action"
          onClick={retry}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          <RotateCcw size={20} />
          {words.tryAgain}
        </button>
      )}
    </section>
  );
}

/** How long after the PDF is ready the page keeps reading the emails that waited for it (the jobs Worker sends them a moment later). */
const MAIL_AFTER_PDF_MS = 60_000;

/**
 * Sweep finding 10: once the PDF is ready, emails that waited for it go out a few seconds later. While the page still shows one waiting,
 * it reads the page again every 10 seconds, for a minute at most, so the Emails panel moves on without a manual reload.
 */
export function useMailAfterPdf(waiting: boolean, reload: () => void) {
  const since = useRef<number | null>(null);
  useEffect(() => {
    if (!waiting) {
      since.current = null;
      return;
    }
    since.current ??= Date.now();
    if (Date.now() - since.current > MAIL_AFTER_PDF_MS) return;
    const t = window.setTimeout(reload, PDF_POLL_MS);
    return () => window.clearTimeout(t);
  });
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
