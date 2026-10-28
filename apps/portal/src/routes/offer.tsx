// One proposal or estimate, live (POR-05, POR-06, ADM-PROP-08, ADM-PROP-10): loaded from the API, accepted or declined, its PDF and
// certificate downloaded. The same screen serves a signed-in contact (`/proposals/:id`, the session) and an email link (`/o`, the
// link's token in each request body); `OfferSource` is the only difference. Every figure and word of the document is the server's
// `PdfView`; the record after a decision is the server's answer.
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  type AcceptRecord,
  type DeclineAnswer,
  type Download,
  type OfferPage,
  type OfferSuperseded,
  RequestError,
} from "../api.ts";
import type { DecisionModel } from "../components/decision/decision-panel.tsx";
import type { DeclineReason } from "../components/decision/decline-dialog.tsx";
import { Alert } from "../components/icons.tsx";
import { PageTitle } from "../components/shell/portal-shell.tsx";
import { COPY } from "../copy.ts";
import { N } from "../copy-documents.ts";
import { errorText, pdfName, saveDownload } from "../lib/offers.ts";
import { DocumentPage } from "../screens/document-page.tsx";
import { NotFoundScreen, ScreenSkeleton } from "../screens/home.tsx";

/** Where an offer comes from and how to act on it: the session's routes or the link's. */
export type OfferSource = {
  load: () => Promise<OfferPage | OfferSuperseded>;
  accept: (documentId: string, typedName: string) => Promise<AcceptRecord>;
  decline: (documentId: string, reason: string, note: string | null) => Promise<DeclineAnswer>;
  pdf: (documentId: string) => Promise<Download>;
  certificate: (documentId: string) => Promise<Download>;
};

type State =
  | { phase: "loading" }
  | { phase: "ready"; page: OfferPage }
  | { phase: "missing" }
  | { phase: "failed"; error: unknown };

/** The refusals that end the decision: the page reloads to show what is true now, and says why (07-N §7). */
const FINAL = new Set(["already_accepted", "already_decided", "superseded", "expired"]);

export function OfferScreen(props: {
  source: OfferSource;
  /** Re-runs the load when it changes (the document id). */
  loadKey: string;
  backHref: string | null;
  homeHref: string;
  /** The signed-in contact (null on a link): whose acceptance is "yours", and the email on the record. */
  me: { name: string; email: string } | null;
  /** A version replaced by a newer one was asked for (the session route moved here from the old id). */
  replaced: boolean;
  /**
   * The API answered "superseded": go to the latest version. The session route navigates there (true); a link always opens its
   * offer's newest version, so it answers false and the page reloads in place with the 07-N line.
   */
  onSuperseded: (latestId: string) => boolean;
  notices?: ReactNode | undefined;
  /** What a 404 shows: "Page not found" in the portal; the emailed link says it has ended, with the way to sign in (finding 7). */
  missing?: ReactNode | undefined;
}) {
  const { source, onSuperseded } = props;
  const [state, setState] = useState<State>({ phase: "loading" });
  const [acceptedHere, setAcceptedHere] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [alert, setAlert] = useState<{ at: "top" | "sheet"; text: string } | null>(null);
  const [downloading, setDownloading] = useState<"pdf" | "accepted" | "certificate" | null>(null);
  const alive = useRef(true);

  const load = useCallback(
    async (quiet: boolean) => {
      if (!quiet) setState({ phase: "loading" });
      try {
        const r = await source.load();
        if (!alive.current) return;
        if ("superseded" in r) {
          if (!(r.superseded.latestId && onSuperseded(r.superseded.latestId))) setState({ phase: "missing" });
          return;
        }
        setState({ phase: "ready", page: r });
      } catch (e) {
        if (!alive.current) return;
        if (e instanceof RequestError && e.status === 404) setState({ phase: "missing" });
        else if (e instanceof RequestError && e.status === 401)
          return; // the session provider shows sign-in
        else setState({ phase: "failed", error: e });
      }
    },
    [source, onSuperseded],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: loads again only for another document (loadKey)
  useEffect(() => {
    alive.current = true;
    setProblem(null);
    setAlert(null);
    setAcceptedHere(false);
    load(false);
    return () => {
      alive.current = false;
    };
  }, [props.loadKey]);

  if (state.phase === "loading") return <ScreenSkeleton label={COPY.loading} />;
  if (state.phase === "missing") return props.missing ?? <NotFoundScreen homeHref={props.homeHref} />;
  if (state.phase === "failed") {
    const e = state.error;
    if (e instanceof RequestError && e.status === 429)
      return <ProblemScreen title={COPY.failed.title} text={errorText(e)} onRetry={() => load(false)} />;
    return (
      <ProblemScreen title={COPY.unreachableTitle} text={COPY.unreachableBody} onRetry={() => load(false)} />
    );
  }

  const page = state.page;
  const doc = page.document;
  const view = page.view;
  const total = view.totals.find((t) => t.strong)?.value ?? "";
  const mine =
    acceptedHere ||
    (!!props.me && !!page.acceptance && page.acceptance.email.toLowerCase() === props.me.email.toLowerCase());
  const model: DecisionModel = {
    kind: doc.kind,
    title: view.documentTitle ?? `${view.docLabel} ${view.numberDisplay}`,
    numberDisplay: view.numberDisplay,
    version: doc.version,
    total,
    status: page.acceptance ? "accepted" : doc.status,
    validUntil: view.validUntil,
    acceptance: page.acceptance
      ? {
          typedName: page.acceptance.typedName,
          email: page.acceptance.email,
          acceptedAt: page.acceptance.acceptedAt,
          fingerprint: doc.fingerprint,
        }
      : null,
    acceptedByMe: mine,
    decline: page.decline ?? null,
    myEmail: props.me?.email ?? null,
  };

  function update(next: OfferPage) {
    setState({ phase: "ready", page: next });
  }

  /** A refusal that ends the decision: say why, show what is true now. A newer version moves the page to it. */
  async function refused(e: RequestError) {
    if (e.code === "superseded" && typeof e.extra.latestId === "string" && onSuperseded(e.extra.latestId))
      return;
    setProblem(errorText(e));
    await load(true);
  }

  async function onAccept(typedName: string) {
    try {
      const r = await source.accept(doc.id, typedName);
      setProblem(null);
      setAcceptedHere(true);
      update({
        ...page,
        document: { ...doc, status: "accepted", fingerprint: r.fingerprint },
        acceptance: { typedName: r.typedName, email: r.email, acceptedAt: r.acceptedAt, via: null },
        certificate: { state: page.certificate.state === "ready" ? "ready" : "pending" },
      });
    } catch (e) {
      if (e instanceof RequestError && FINAL.has(e.code)) return refused(e);
      throw new Error(errorText(e));
    }
  }

  async function onDecline(reason: DeclineReason, note: string | null) {
    try {
      const r = await source.decline(doc.id, reason, note);
      setProblem(null);
      update({
        ...page,
        document: { ...doc, status: "declined" },
        decline: { reason: r.declined.reason, note, at: r.declined.at, by: r.declined.by },
      });
    } catch (e) {
      if (e instanceof RequestError && FINAL.has(e.code)) return refused(e);
      throw new Error(errorText(e));
    }
  }

  /** A download; a failure is said next to the button that asked (the summary at the top, or the acceptance block). */
  async function download(what: "pdf" | "accepted" | "certificate", at: "top" | "sheet") {
    if (downloading) return;
    setDownloading(what);
    setAlert(null);
    try {
      const d = what === "certificate" ? await source.certificate(doc.id) : await source.pdf(doc.id);
      saveDownload(d, pdfName(doc.numberDisplay, doc.version, what === "certificate" ? "-certificate" : ""));
    } catch (e) {
      setAlert({
        at,
        text: e instanceof RequestError && e.code === "pdf_pending" ? N.pdfPreparing : errorText(e),
      });
    } finally {
      setDownloading(null);
    }
  }

  return (
    <DocumentPage
      view={view}
      model={model}
      backHref={props.backHref}
      replacedBy={props.replaced || page.link?.supersededFrom ? doc.version : null}
      notices={
        <>
          {props.notices}
          {alert?.at === "top" && <AlertLine text={alert.text} />}
        </>
      }
      problem={problem}
      sheetAlert={alert?.at === "sheet" ? <AlertLine text={alert.text} /> : null}
      downloading={downloading}
      onAccept={onAccept}
      onDecline={onDecline}
      onDownload={(what) => download(what, "sheet")}
      onDownloadPdf={() => download("pdf", "top")}
      onDownloadPdfInSheet={() => download("pdf", "sheet")}
    />
  );
}

function AlertLine({ text }: { text: string }) {
  return (
    <div className="notice notice--error" role="alert">
      <Alert size={20} />
      <div>{text}</div>
    </div>
  );
}

/** The document didn't load: the server couldn't be reached, or the link view is refused for a while (429). */
function ProblemScreen(props: { title: string; text: string; onRetry: () => void }) {
  return (
    <div className="screen screen--narrow">
      <header className="screen__head">
        <PageTitle text={props.title} className="screen__title">
          {props.title}
        </PageTitle>
      </header>
      <p>{props.text}</p>
      <button type="button" className="btn btn--secondary" onClick={props.onRetry}>
        {COPY.reload}
      </button>
    </div>
  );
}
