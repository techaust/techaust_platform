// The invoice routes (M5.4; POR-06, Q49): the signed-in list (`/invoices`) and page (`/invoices/:id`), and the emailed link (`/i#t=…`), which shows that
// one document without signing in, with an offer to sign in for the rest. A bad, revoked, expired or ended link is 07-U §3's "This link no longer works"
// (the API answers one 404 for all of them, so the page can't tell which; nothing more is said). A contact without "can see finance" gets the plain
// "Page not found" for the signed-in routes, as the API answers.
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { type InvoiceItem, type InvoiceSummary, invoiceLinkApi, invoicesApi, RequestError } from "../api.ts";
import { LogIn } from "../components/icons.tsx";
import { PageTitle, TokenShell } from "../components/shell/portal-shell.tsx";
import { Notice } from "../components/ui.tsx";
import { COPY } from "../copy.ts";
import { N } from "../copy-documents.ts";
import { INV } from "../copy-invoices.ts";
import { capturedInvoiceToken, invoicePdfName } from "../lib/invoices.ts";
import { saveDownload } from "../lib/offers.ts";
import { MoreButton, NotFoundScreen, ScreenSkeleton } from "../screens/home.tsx";
import { InvoicePage, InvoicesScreen } from "../screens/invoices.tsx";
import { useMe } from "../session.tsx";

type Source = {
  load: () => Promise<{ document: InvoiceSummary }>;
  pdf: () => ReturnType<typeof invoicesApi.pdf>;
};

type State =
  | { phase: "loading" }
  | { phase: "ready"; doc: InvoiceSummary }
  | { phase: "missing" }
  | { phase: "failed"; error: unknown };

/** The words of a failed request: the network, or our side. */
const problemText = (e: unknown) =>
  e instanceof RequestError && e.code !== "network" ? COPY.server : COPY.network;

function DocumentScreen(props: {
  source: Source;
  loadKey: string;
  /** The emailed link: a 404 is "this link no longer works" (not "page not found"), with the way to sign in. */
  link: boolean;
  notices?: ReactNode;
}) {
  const { source } = props;
  const [state, setState] = useState<State>({ phase: "loading" });
  const [downloading, setDownloading] = useState(false);
  const [pdfProblem, setPdfProblem] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const r = await source.load();
      if (alive.current) setState({ phase: "ready", doc: r.document });
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof RequestError && e.status === 404) setState({ phase: "missing" });
      else setState({ phase: "failed", error: e });
    }
  }, [source]);

  useEffect(() => {
    alive.current = true;
    void props.loadKey;
    load();
    return () => {
      alive.current = false;
    };
  }, [load, props.loadKey]);

  if (state.phase === "loading") return <ScreenSkeleton label={COPY.loading} />;
  if (state.phase === "missing") return props.link ? <LinkEnded /> : <NotFoundScreen homeHref="/" />;
  if (state.phase === "failed")
    return (
      <div className="screen">
        <Notice tone="error">{problemText(state.error)}</Notice>
        <button type="button" className="btn btn--secondary" onClick={load}>
          {COPY.reload}
        </button>
      </div>
    );
  const doc = state.doc;
  return (
    <InvoicePage
      doc={doc}
      notices={props.notices}
      downloading={downloading}
      pdfProblem={pdfProblem}
      onPdf={async () => {
        setDownloading(true);
        setPdfProblem(null);
        try {
          saveDownload(await source.pdf(), invoicePdfName(doc.numberDisplay));
        } catch (e) {
          setPdfProblem(
            e instanceof RequestError && e.code === "pdf_pending"
              ? INV.pdfNotReady
              : e instanceof RequestError && e.status === 404
                ? INV.linkEnded
                : problemText(e),
          );
        } finally {
          setDownloading(false);
        }
      }}
    />
  );
}

/** 07-U §3: the link has ended (expired, revoked, the contact's access off, or never valid). */
function LinkEnded() {
  return (
    <div className="screen screen--narrow">
      <header className="screen__head">
        <PageTitle text={INV.title} className="screen__title">
          {INV.title}
        </PageTitle>
      </header>
      <p>{INV.linkEnded}</p>
      <Link to="/" className="btn btn--secondary">
        <LogIn size={20} />
        {INV.signIn}
      </Link>
    </div>
  );
}

/** `/i#t=…`: one document from its email, no session needed. */
export function InvoiceLinkRoute() {
  const token = capturedInvoiceToken();
  const source = useMemo<Source | null>(
    () => (token ? { load: () => invoiceLinkApi.open(token), pdf: () => invoiceLinkApi.pdf(token) } : null),
    [token],
  );
  return (
    <TokenShell>
      {source ? (
        <DocumentScreen
          source={source}
          loadKey="link"
          link
          notices={
            <div className="notice notice--info notice--action" role="note">
              <LogIn size={20} />
              <div>
                <p>{INV.signInHint}</p>
                <Link to="/" className="btn btn--secondary">
                  {N.signIn}
                </Link>
              </div>
            </div>
          }
        />
      ) : (
        <LinkEnded />
      )}
    </TokenShell>
  );
}

/** `/invoices/:id`: the same page for a signed-in contact. */
export function InvoiceRoute() {
  const me = useMe();
  const { id = "" } = useParams();
  const source = useMemo<Source>(
    () => ({ load: () => invoicesApi.get(id), pdf: () => invoicesApi.pdf(id) }),
    [id],
  );
  if (!me.canSeeFinance) return <NotFoundScreen homeHref="/" />;
  return <DocumentScreen source={source} loadKey={id} link={false} />;
}

/** The organisation's invoices, page by page (50 a page). */
export function useInvoices(enabled: boolean) {
  const [items, setItems] = useState<InvoiceItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const page = useCallback(async (after?: string) => {
    setBusy(true);
    try {
      const r = await invoicesApi.list(after);
      setItems((was) => (after && was ? [...was, ...r.invoices] : r.invoices));
      setNext(r.next);
      setError(null);
    } catch (e) {
      if (!(e instanceof RequestError && e.status === 401)) setError(e);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (enabled) page();
  }, [page, enabled]);
  return {
    items,
    next,
    error,
    busy,
    problem: error ? problemText(error) : null,
    more: () => next && page(next),
    retry: () => page(),
  };
}

/** `/invoices`. */
export function InvoicesRoute() {
  const me = useMe();
  const list = useInvoices(me.canSeeFinance);
  if (!me.canSeeFinance) return <NotFoundScreen homeHref="/" />;
  if (list.error && !list.items)
    return (
      <div className="screen">
        <Notice tone="error">{problemText(list.error)}</Notice>
        <button type="button" className="btn btn--secondary" onClick={list.retry}>
          {COPY.reload}
        </button>
      </div>
    );
  if (!list.items) return <ScreenSkeleton label={COPY.loading} />;
  return (
    <InvoicesScreen
      items={list.items}
      more={list.next ? <MoreButton onMore={() => list.more()} busy={list.busy} /> : null}
    />
  );
}
