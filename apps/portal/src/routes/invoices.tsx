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
import { PayWays } from "../components/pay/pay-now.tsx";
import { type PayPhase, PayStatus } from "../components/pay/pay-status.tsx";
import { PageTitle, TokenShell } from "../components/shell/portal-shell.tsx";
import { COPY } from "../copy.ts";
import { N } from "../copy-documents.ts";
import { INV } from "../copy-invoices.ts";
import { capturedInvoiceToken, invoicePdfName, pdfFailure } from "../lib/invoices.ts";
import { saveDownload } from "../lib/offers.ts";
import {
  forgetPay,
  PAYPAL_POLL_FOR_MS,
  PAYPAL_POLL_MS,
  type PayGateway,
  type PayReturn,
  POLL_FOR_MS,
  POLL_MS,
  payPalPhaseOf,
  payPalReturnOf,
  payWaysOf,
  REFRESH_AT_MS,
  recalledPay,
  receivedAfter,
  takePayReturn,
  waitingGatewayOf,
} from "../lib/pay.ts";
import { MoreButton, NotFoundScreen, ScreenSkeleton } from "../screens/home.tsx";
import { InvoicePage, InvoicesScreen } from "../screens/invoices.tsx";
import { useMe } from "../session.tsx";

type Source = {
  load: () => Promise<{ document: InvoiceSummary }>;
  pdf: () => ReturnType<typeof invoicesApi.pdf>;
  /** M6.2, M6.3, M6.4: makes the gateway's page for this document (Razorpay, Stripe or PayPal, as the button pressed). */
  pay: (amountMinor: number, provider: PayGateway) => Promise<PayLink>;
  /** M6.2: the document again, the server checking the open link with Razorpay first (signed in only). */
  refresh?: () => Promise<{ document: InvoiceSummary }>;
  /** M6.4: back from PayPal (signed in only): the document again, the server first capturing THAT checkout; the answer carries `online.payPalReturn`. */
  payPalReturn?: (checkoutId: string) => Promise<{ document: InvoiceSummary }>;
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
   * Stripe's page without paying (`?pay=cancel`, 07-ZM line 5); M6.4: `paypal` with our checkout id (`?pay=paypal&c=…`), `paypal-cancel` (07-ZN line 7).
   */
  returned?: PayReturn | null;
}) {
  const { source } = props;
  const [state, setState] = useState<State>({ phase: "loading" });
  const [downloading, setDownloading] = useState(false);
  const [pdfProblem, setPdfProblem] = useState<string | null>(null);
  const alive = useRef(true);
  const returnKind = props.returned?.kind ?? null;
  // M6.4 (run file G2): back from PayPal, the page's reads name our checkout (`GET /invoices/:id?c=…`) while PayPal's answer is still `processing`, so the
  // server captures THAT one and answers its state (`online.payPalReturn`); any other answer ends it, and later reads are plain.
  const payPalMode = returnKind === "paypal";
  const payPalCheckout = payPalMode && source.payPalReturn ? (props.returned?.checkoutId ?? null) : null;
  const askPayPal = useRef(payPalCheckout !== null);

  // M6.2 (run file G5): back from Razorpay, the page asks every 3 s for up to a minute, once at 20 s with the server checking Razorpay (`?refresh=1`), until
  // it shows a payment newer than the newest one it showed when "Continue to Razorpay" was pressed in this tab (review finding 5). Without a remembered press
  // it ends on 07-ZI line 13, never "received". Never marked paid here. M6.4: PayPal's return starts on 07-ZN line 4 and moves by the server's answer.
  const [payState, setPayState] = useState<PayPhase | null>(
    returnKind === "return" || returnKind === "paypal"
      ? { phase: "checking" }
      : returnKind === "cancel" || returnKind === "paypal-cancel"
        ? { phase: "left" }
        : null,
  );

  /** One read of the document: while PayPal's answer is open, the read that names the checkout, and its state becomes the page's (07-ZN lines 4 to 11). */
  const read = useCallback(async (): Promise<{ document: InvoiceSummary }> => {
    if (!(askPayPal.current && payPalCheckout && source.payPalReturn)) return source.load();
    const r = await source.payPalReturn(payPalCheckout);
    const phase = payPalPhaseOf(payPalReturnOf(r.document.online?.payPalReturn), r.document);
    if (alive.current) {
      if (phase?.phase !== "checking") askPayPal.current = false;
      if (phase?.phase === "received") forgetPay();
      setPayState(phase);
    }
    return r;
  }, [source, payPalCheckout]);

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const r = await read();
      if (alive.current) setState({ phase: "ready", doc: r.document });
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof RequestError && e.status === 404) setState({ phase: "missing" });
      else setState({ phase: "failed", error: e });
    }
  }, [read]);

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

  const docId = state.phase === "ready" ? state.doc.id : null;
  const press = useMemo(
    () => (returnKind === "return" && docId ? recalledPay(docId) : null),
    [returnKind, docId],
  );
  const checking = payState?.phase === "checking";
  useEffect(() => {
    if (payPalMode || !checking || state.phase !== "ready") return;
    const got = receivedAfter(state.doc.online?.lastPaid, press);
    if (got) {
      setPayState({
        phase: "received",
        amountMinor: got.amountMinor,
        proforma: state.doc.type === "proforma",
      });
      forgetPay();
    }
  }, [payPalMode, checking, state, press]);
  useEffect(() => {
    if (payPalMode || !checking) return;
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
  }, [payPalMode, checking, source]);
  // M6.4 (early check 2, "Designer must know" 2): while PayPal's answer is `processing`, ask again every 30 s (each ask may capture, and shares the `p:pay:`
  // quota), for 5 minutes at most; then stop, still on 07-ZN line 4 (the invoice shows the payment once it's confirmed). A failed ask keeps the page as it is.
  const ready = state.phase === "ready";
  useEffect(() => {
    if (!payPalMode || !checking || !ready) return;
    const started = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped || !askPayPal.current) return;
      try {
        const r = await read();
        if (!stopped && alive.current) setState({ phase: "ready", doc: r.document });
      } catch {
        /* the page stays on line 4; the next ask may answer */
      }
      if (!stopped && askPayPal.current && Date.now() - started + PAYPAL_POLL_MS <= PAYPAL_POLL_FOR_MS)
        timer = setTimeout(tick, PAYPAL_POLL_MS);
    };
    timer = setTimeout(tick, PAYPAL_POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // Armed once the first answer is in (`checking` and the page ready); each answer swaps the document in place, which doesn't restart it.
  }, [payPalMode, checking, ready, read]);

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
  // M6.3: the gateway of the document's currency (an older API sends none: rupees through Razorpay). M6.4: a USD document has two ways, in the server's order.
  const provider: PayGateway = doc.provider ?? (doc.currency === "USD" ? "stripe" : "razorpay");
  const ways = payWaysOf(doc);
  // M6.3 (run file E): a gateway payment still waits on the document; Pay is hidden and 07-ZM line 4 (07-ZI line 13 for Razorpay; M6.4: 07-ZN line 10 when
  // PayPal holds it, early check 2 finding 5) says why. A proforma's waiting payment has its own line instead (07-ZM line 8, 07-ZI line 16, 07-ZN line 14),
  // under the slip.
  const waiting = doc.online?.paymentPending === true && !doc.online.proformaPending;
  const canPay =
    doc.payOnline === true &&
    !doc.online?.proformaPending &&
    !doc.online?.paymentPending &&
    doc.balanceMinor !== null &&
    doc.balanceMinor > 0 &&
    // while it checks, after 07-ZI line 13 ("There's no need to pay again") and while PayPal holds the payment (07-ZN line 10), the page offers no second
    // payment until it is opened again
    !checking &&
    payState?.phase !== "not_yet" &&
    payState?.phase !== "held";
  return (
    <InvoicePage
      pay={
        canPay ? (
          <PayWays
            ways={ways}
            documentId={doc.id}
            proforma={doc.type === "proforma"}
            balanceMinor={doc.balanceMinor as number}
            minimumMinor={doc.online?.minimumMinor ?? null}
            maximumMinor={doc.online?.maximumMinor ?? null}
            wholeRupees={doc.wholeRupees === true}
            lastPaidAt={doc.online?.lastPaid?.at ?? null}
            pay={source.pay}
            onProcessing={refresh}
          />
        ) : null
      }
      payStatus={
        payState ? (
          <PayStatus
            state={payState}
            provider={returnKind === "paypal" || returnKind === "paypal-cancel" ? "paypal" : provider}
          />
        ) : waiting ? (
          // PayPal's waiting payment is the return's Pending state (07-ZN line 10, the clock); the others say their "not yet" line
          waitingGatewayOf(doc.online, provider) === "paypal" ? (
            <PayStatus state={{ phase: "held" }} provider="paypal" />
          ) : (
            <PayStatus state={{ phase: "not_yet" }} provider={waitingGatewayOf(doc.online, provider)} />
          )
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
            pay: (amountMinor: number, provider: PayGateway) =>
              invoiceLinkApi.pay(token, amountMinor, provider),
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
      pay: (amountMinor: number, provider: PayGateway) => invoicesApi.pay(id, amountMinor, provider),
      refresh: () => invoicesApi.getRefreshed(id),
      payPalReturn: (checkoutId: string) => invoicesApi.getPayPalReturn(id, checkoutId),
    }),
    [id],
  );
  // M6.2, M6.3, M6.4: read once per page load (main.tsx took it from the address before the first render): `return`, `cancel`, PayPal's return (with our
  // checkout id) or cancel, or null.
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
