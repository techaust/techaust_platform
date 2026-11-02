// The invoice routes (M5.4; POR-06, Q49): the signed-in list (`/invoices`) and page (`/invoices/:id`), and the emailed link (`/i#t=…`), which shows that
// one document without signing in, with an offer to sign in for the rest. A bad, revoked, expired or ended link is 07-U §3's "This link no longer works"
// (the API answers one 404 for all of them, so the page can't tell which; nothing more is said). A contact without "can see finance" gets the plain
// "Page not found" for the signed-in routes, as the API answers.
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import {
  type InvoiceItem,
  type InvoiceSummary,
  invoiceLinkApi,
  invoicesApi,
  type PayLink,
  RequestError,
} from "../api.ts";
import { LogIn } from "../components/icons.tsx";
import { LoadProblemScreen, problemText } from "../components/load-problem.tsx";
import { PayNow } from "../components/pay/pay-now.tsx";
import { type PayPhase, PayStatus } from "../components/pay/pay-status.tsx";
import { PageTitle, TokenShell } from "../components/shell/portal-shell.tsx";
import { COPY } from "../copy.ts";
import { N } from "../copy-documents.ts";
import { INV } from "../copy-invoices.ts";
import { capturedInvoiceToken, invoicePdfName, pdfFailure } from "../lib/invoices.ts";
import { saveDownload } from "../lib/offers.ts";
import {
  forgetPay,
  type PayGateway,
  type PayReturnKind,
  POLL_FOR_MS,
  POLL_MS,
  REFRESH_AT_MS,
  recalledPay,
  receivedAfter,
  takePayReturn,
} from "../lib/pay.ts";
import { MoreButton, NotFoundScreen, ScreenSkeleton } from "../screens/home.tsx";
import { InvoicePage, InvoicesScreen } from "../screens/invoices.tsx";
import { useMe } from "../session.tsx";

type Source = {
  load: () => Promise<{ document: InvoiceSummary }>;
  pdf: () => ReturnType<typeof invoicesApi.pdf>;
  /** M6.2, M6.3: makes the gateway's page for this document (Pay now through Razorpay, Pay by card through Stripe). */
  pay: (amountMinor: number) => Promise<PayLink>;
  /** M6.2: the document again, the server checking the open link with Razorpay first (signed in only). */
  refresh?: () => Promise<{ document: InvoiceSummary }>;
};

type State =
  | { phase: "loading" }
  | { phase: "ready"; doc: InvoiceSummary }
  | { phase: "missing" }
  | { phase: "failed"; error: unknown };

function DocumentScreen(props: {
  source: Source;
  loadKey: string;
  /** The emailed link: a 404 is "this link no longer works" (not "page not found"), with the way to sign in. */
  link: boolean;
  notices?: ReactNode;
  /**
   * M6.2: this page load came back from the gateway (signed in: `/invoices/:id?pay=return`, the query already stripped); M6.3: `cancel` when the client left
   * Stripe's page without paying (`?pay=cancel`, 07-ZM line 5).
   */
  returned?: PayReturnKind | null;
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

  // The document again without the loading screen (review L3): the page swaps its view in place and keeps the download's message; a failed
  // reload keeps the page as it was, and the message says why.
  const refresh = useCallback(async () => {
    try {
      const r = await source.load();
      if (alive.current) setState({ phase: "ready", doc: r.document });
    } catch {
      /* the page stays; its message stands */
    }
  }, [source]);

  // M6.2 (run file G5): back from Razorpay, the page asks every 3 s for up to a minute, once at 20 s with the server checking Razorpay (`?refresh=1`), until
  // it shows a payment newer than the newest one it showed when "Continue to Razorpay" was pressed in this tab (review finding 5). Without a remembered press
  // it ends on 07-ZI line 13, never "received". Never marked paid here.
  const [payState, setPayState] = useState<PayPhase | null>(
    props.returned === "return"
      ? { phase: "checking" }
      : props.returned === "cancel"
        ? { phase: "left" }
        : null,
  );
  const docId = state.phase === "ready" ? state.doc.id : null;
  const press = useMemo(
    () => (props.returned === "return" && docId ? recalledPay(docId) : null),
    [props.returned, docId],
  );
  const checking = payState?.phase === "checking";
  useEffect(() => {
    if (!checking || state.phase !== "ready") return;
    const got = receivedAfter(state.doc.online?.lastPaid, press);
    if (got) {
      setPayState({
        phase: "received",
        amountMinor: got.amountMinor,
        proforma: state.doc.type === "proforma",
      });
      forgetPay();
    }
  }, [checking, state, press]);
  useEffect(() => {
    if (!checking) return;
    const started = Date.now();
    let refreshed = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      const late = Date.now() - started >= REFRESH_AT_MS;
      try {
        const ask = late && !refreshed && source.refresh ? source.refresh : source.load;
        if (ask === source.refresh) refreshed = true;
        const r = await ask();
        if (!stopped && alive.current) setState({ phase: "ready", doc: r.document });
      } catch {
        /* the page stays; the next ask may answer */
      }
      if (stopped) return;
      if (Date.now() - started >= POLL_FOR_MS)
        setPayState((p) => (p?.phase === "checking" ? { phase: "not_yet" } : p));
      else timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [checking, source]);

  useEffect(() => {
    alive.current = true;
    void props.loadKey;
    // Re-check N2: another document (a note's parent link) starts without the previous one's download message; `refresh()` keeps it (L3).
    setPdfProblem(null);
    load();
    return () => {
      alive.current = false;
    };
  }, [load, props.loadKey]);

  if (state.phase === "loading") return <ScreenSkeleton label={COPY.loading} />;
  if (state.phase === "missing") return props.link ? <LinkEnded /> : <NotFoundScreen homeHref="/" />;
  // The number is unknown until the invoice loads, so the failed page keeps the section's title (final sweep P1).
  if (state.phase === "failed")
    return <LoadProblemScreen title={INV.title} error={state.error} onRetry={load} />;
  const doc = state.doc;
  // M6.3: the gateway of the document's currency (an older API sends none: rupees through Razorpay).
  const provider: PayGateway = doc.provider ?? (doc.currency === "USD" ? "stripe" : "razorpay");
  // M6.3 (run file E): a gateway payment still waits on the document; Pay is hidden and 07-ZM line 4 (07-ZI line 13 for Razorpay) says why. A proforma's
  // waiting payment has its own line instead (07-ZM line 8, 07-ZI line 16), under the slip.
  const waiting = doc.online?.paymentPending === true && !doc.online.proformaPending;
  const canPay =
    doc.payOnline === true &&
    !doc.online?.proformaPending &&
    !doc.online?.paymentPending &&
    doc.balanceMinor !== null &&
    doc.balanceMinor > 0 &&
    // while it checks, and after 07-ZI line 13 ("There's no need to pay again"), the page offers no second payment until it is opened again
    !checking &&
    payState?.phase !== "not_yet";
  return (
    <InvoicePage
      pay={
        canPay ? (
          <PayNow
            documentId={doc.id}
            provider={provider}
            balanceMinor={doc.balanceMinor as number}
            minimumMinor={doc.online?.minimumMinor ?? null}
            maximumMinor={doc.online?.maximumMinor ?? null}
            wholeRupees={doc.wholeRupees === true}
            lastPaidAt={doc.online?.lastPaid?.at ?? null}
            pay={source.pay}
          />
        ) : null
      }
      payStatus={
        payState ? (
          <PayStatus state={payState} provider={provider} />
        ) : waiting ? (
          <PayStatus state={{ phase: "not_yet" }} provider={provider} />
        ) : null
      }
      linkParent={!props.link}
      doc={doc}
      notices={props.notices}
      downloading={downloading}
      pdfProblem={pdfProblem}
      onPdf={async () => {
        setDownloading(true);
        setPdfProblem(null);
        let reload = false;
        try {
          saveDownload(await source.pdf(), invoicePdfName(doc.numberDisplay));
        } catch (e) {
          // ADM-INV-10: withdrawn while the page was open: 07-ZF 20, then the withdrawn view (review L3)
          const failed = pdfFailure(e, problemText);
          setPdfProblem(failed.text);
          reload = failed.reload;
        } finally {
          setDownloading(false);
        }
        if (reload) await refresh();
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
    () =>
      token
        ? {
            load: () => invoiceLinkApi.open(token),
            pdf: () => invoiceLinkApi.pdf(token),
            pay: (amountMinor: number) => invoiceLinkApi.pay(token, amountMinor),
          }
        : null,
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
    () => ({
      load: () => invoicesApi.get(id),
      pdf: () => invoicesApi.pdf(id),
      pay: (amountMinor: number) => invoicesApi.pay(id, amountMinor),
      refresh: () => invoicesApi.getRefreshed(id),
    }),
    [id],
  );
  // M6.2, M6.3: read once per page load (main.tsx took it from the address before the first render): `return`, `cancel` or null.
  const [returned] = useState(() => takePayReturn(id));
  if (!me.canSeeFinance) return <NotFoundScreen homeHref="/" />;
  return <DocumentScreen source={source} loadKey={id} link={false} returned={returned} />;
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
    return <LoadProblemScreen title={INV.title} error={list.error} onRetry={list.retry} />;
  if (!list.items) return <ScreenSkeleton label={COPY.loading} />;
  return (
    <InvoicesScreen
      items={list.items}
      more={list.next ? <MoreButton onMore={() => list.more()} busy={list.busy} /> : null}
    />
  );
}
