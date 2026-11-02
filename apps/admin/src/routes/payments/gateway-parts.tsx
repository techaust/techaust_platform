// M6.2 Razorpay on the invoice's Payments panel (run file G1; ADM-PAY-02, ADM-PAY-06, ADM-PAY-07, ADM-INV-10): the Payment link card (07-ZI S17), the payments
// that came in online and still wait (S18), and what on this document waits in "Needs review" (S19, S20). One device: the link card is a counterfoil, a slip
// with a perforated line between what the link asks for and the link itself, because that is what it is: the part of the invoice the client tears off and pays.
// Figures are the server's, formatted by core; nothing here adds up an amount.
// M6.3 Stripe (run file G1; ADM-PAY-01, ADM-INV-17): a USD document has no staff-made link (L7), so its slip is "Card payments" (07-ZM S13): the same slip
// with no perforation, because there is nothing to tear off: the status of the client's last card page, its expiry, and "Copy portal link". A Stripe payment
// reads S14's line with the INR Stripe credited and its fee as facts, and its proof slot (S15).
import { formatIstMoment } from "@techaust/core/dates";
import type { Role } from "@techaust/core/permissions";
import { useId, useState } from "react";
import { Link } from "react-router";
import {
  type GatewayPaymentRow,
  type InvoicePaymentsPanel,
  type PaymentLinkRow,
  paymentsApi,
  RequestError,
  type ReviewItem,
} from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { Modal, useRefusalFocus } from "../../components/dialog.tsx";
import { StatusPill } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import {
  Alert,
  Clock,
  Copy,
  CreditCard,
  FileText,
  Plus,
  RefreshCw,
  Wallet,
} from "../../components/icons.tsx";
import { useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import { CARD_ZM } from "../../lib/copy-zm.ts";
import { ZN, ZN_UI } from "../../lib/copy-zn.ts";
import {
  cardBodyText,
  feeCurrencyOf,
  GW,
  GW_UI,
  gatewayLine,
  gwErrorText,
  itemReason,
  LINK_CHIPS,
  linkHint,
  payPalChip,
  portalInvoiceUrl,
  portalLinkOffered,
  stripeFacts,
} from "../../lib/gateway.ts";
import { INVT_COPY } from "../../lib/invoice-types.ts";
import { INV_COPY } from "../../lib/invoices.ts";
import type { InvoiceView } from "../../lib/invoices-api.ts";
import { amountText, PAY_UI, plainAmount } from "../../lib/payments.ts";
import { moneyFrom } from "../../lib/settings-form.ts";
import { day, PaymentPill } from "./parts.tsx";

type Panel = InvoicePaymentsPanel;
const ONLINE_TYPES: readonly string[] = ["tax_invoice", "debit_note", "proforma"];
const paymentHref = (id: string) => `/payments/${encodeURIComponent(id)}`;

/** The moment a link ends, in IST (S17 "Expires {date}"). */
const expiresText = (ms: number) => GW.expires(formatIstMoment(ms));

/**
 * Whether this document can carry a payment link at all (the server re-checks everything, run file C): an issued INR tax invoice, debit note or proforma of a
 * client in India (owner Q3 A), not void or erased, with the role's `payments.link`.
 */
export function linkable(v: InvoiceView, role: Role): boolean {
  return (
    allowed(role, "payments.link") &&
    ONLINE_TYPES.includes(v.type) &&
    v.currency === "INR" &&
    v.status !== "void" &&
    v.status !== "draft" &&
    !v.client.anonymised &&
    v.client.country === "IN" &&
    v.client.gstStatus !== "overseas"
  );
}

/** The types a client pays by card on a USD document (M6.3, core's Stripe row: an export invoice, its debit note, a proforma). */
const CARD_TYPES: readonly string[] = ["export_invoice", "debit_note", "proforma"];

/**
 * Whether this document is one a client can pay by card (M6.3; the server re-checks everything): an issued USD export invoice, debit note or proforma of a client
 * outside India, not void or erased. Staff never make its link (L7); the slip only says where the client pays and copies the portal link.
 */
export function cardable(v: InvoiceView): boolean {
  return (
    CARD_TYPES.includes(v.type) &&
    v.currency === "USD" &&
    v.status !== "void" &&
    v.status !== "draft" &&
    !v.client.anonymised &&
    (v.client.country !== "IN" || v.client.gstStatus === "overseas")
  );
}

/** A Razorpay link (the Payment link card), a Stripe card page (Card payments) or a PayPal checkout (the PayPal slip); an older API sends no provider: Razorpay. */
const isStripe = (l: PaymentLinkRow) => l.provider === "stripe";
const isPayPal = (l: PaymentLinkRow) => l.provider === "paypal";
const isRazorpay = (l: PaymentLinkRow) => !isStripe(l) && !isPayPal(l);

/** The gateway row of a payment on this document, when it came in online. */
export const gatewayOf = (panel: Panel, paymentId: string): GatewayPaymentRow | undefined =>
  panel.gateway?.payments.find((g) => g.paymentId === paymentId);

/**
 * "Paid online" with the gateway's line under it: Razorpay's S18 and its fee; Stripe's S14, then (M6.3, L10) the INR Stripe credited with the rate it implies
 * ("not the GST rate") and Stripe's fee with its GST, as facts.
 */
const longId = (provider: string) => provider === "stripe" || provider === "paypal";

export function OnlineMode({ row }: { row: GatewayPaymentRow }) {
  const facts = stripeFacts(row);
  return (
    <span className="pay-online">
      <span className="pay-online__what">
        <CreditCard size={16} />
        {GW_UI.paidOnline}
      </span>
      {/* a Stripe or PayPal id is long and the row's Payment ID column shows it already: S14's first two parts, or S1's "PayPal", here */}
      <span className="pay-lines__meta break">
        {gatewayLine(row.provider, row.mode, longId(row.provider) ? null : row.providerPaymentId)}
      </span>
      {/* M6.4 S1: PayPal's fee is in the capture's currency (dollars), Razorpay's in rupees */}
      {row.provider !== "stripe" && row.feeMinor > 0 && (
        <span className="pay-lines__meta">
          {GW.feeAbsorbed(amountText(row.feeMinor, feeCurrencyOf(row.provider)))}
        </span>
      )}
      {facts.map((f) => (
        <span key={f} className="pay-lines__meta pay-online__fact">
          {f}
        </span>
      ))}
    </span>
  );
}

/**
 * The proof slot of a Stripe payment (M6.3, S15; L11): the proof once attached, else "Proof awaited" (the quiet tag of "Certificate awaited") with "Attach
 * proof" for a role that may attach one. Razorpay's own record stays its proof (M6.2).
 */
export function CardProof(props: {
  paymentId: string;
  hasProof: boolean;
  /** M6.4: the payment is on a remittance advice, which proves it as well (Step 0.2 item 6). */
  onAdvice?: boolean;
  canAttach: boolean;
  onAttach: (paymentId: string) => void;
}) {
  if (props.onAdvice && !props.hasProof)
    return (
      <Link to="/payments/advices" className="pay-proof-link">
        <FileText size={16} />
        {ZN_UI.adviceLabel}
      </Link>
    );
  if (props.hasProof)
    return (
      <a href={paymentsApi.proofHref(props.paymentId)} className="pay-proof-link">
        <FileText size={16} />
        {PAY_UI.openProof}
      </a>
    );
  return (
    <span className="pay-await">
      <span className="pay-badge pay-badge--wrap">
        <Clock size={16} />
        {CARD_ZM.proofAwaited}
      </span>
      {props.canAttach && (
        <button type="button" className="btn btn--text" onClick={() => props.onAttach(props.paymentId)}>
          {PAY_UI.attachProof}
        </button>
      )}
    </span>
  );
}

/**
 * The open review items of one document, read from the "Needs review" list (open items, oldest first; the first page holds every one a small business has).
 * Only asked when the panel says there are some.
 */
export function useDocReview(documentId: string, count: number) {
  const r = useLoad(
    () => (count > 0 ? paymentsApi.review({ status: "open" }) : Promise.resolve(null)),
    `${documentId}:${count}`,
  );
  const items: ReviewItem[] =
    r.state === "ready" && r.data ? r.data.items.filter((i) => i.document_id === documentId) : [];
  return { items, ready: r.state !== "loading" };
}

/** What on this document waits in "Needs review": each reason (S20), and the way to the tab. */
export function DocReviewNotice({ items, count }: { items: ReviewItem[]; count: number }) {
  if (count === 0) return null;
  return (
    <div className="pay-review-note" role="note">
      <Alert size={20} />
      <div className="pay-review-note__body">
        <p className="pay-review-note__title">{GW_UI.reviewOnDoc(count)}</p>
        {items.length > 0 && (
          <ul className="pay-review-note__list">
            {items.map((i) => (
              <li key={i.id}>{itemReason(i)}</li>
            ))}
          </ul>
        )}
        <Link to="/payments?tab=review" className="btn btn--secondary">
          {GW_UI.openReview}
        </Link>
      </div>
    </div>
  );
}

/** The payments that came in online and wait for the Owner's check (a mismatch, a document no longer payable): each opens on Payments. */
export function OnlineWaiting({
  rows,
  currency,
}: {
  rows: GatewayPaymentRow[];
  currency: Panel["currency"];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="pay-waiting">
      <h3 className="pay-sub">{GW_UI.paidOnline}</h3>
      <ul className="pay-waiting__list">
        {rows.map((w) => (
          <li key={w.paymentId} className="pay-waiting__row">
            <span className="pay-waiting__what">
              <Link to={paymentHref(w.paymentId)} className="tnum pay-row__link">
                {day(w.receivedOn)}
              </Link>
              <span className="pay-lines__meta break">
                {gatewayLine(w.provider, w.mode, w.providerPaymentId)}
              </span>
            </span>
            <span className="tnum pay-waiting__amount">{amountText(w.amountMinor, currency)}</span>
            <PaymentPill status={w.status} />
            <Link to={paymentHref(w.paymentId)} className="btn btn--secondary pay-waiting__go">
              {GW.openPayment}
              <span className="visually-hidden">{` ${day(w.receivedOn)} ${amountText(w.amountMinor, currency)}`}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Payment link card (S17): the live link (amount, expiry, the address with Copy link and Cancel link) or Create payment link, and the earlier links folded
 * away with their chips. Shown while the document can take a link, or once it has had one.
 */
export function LinkCard(props: { view: InvoiceView; panel: Panel; role: Role; onChanged: () => void }) {
  const { view: v, panel: p, role } = props;
  const toast = useToast();
  const [dialog, setDialog] = useState<"create" | "cancel" | null>(null);
  const headId = useId();
  // M6.3: Stripe's card pages are the Card payments slip's (no staff link, L7)
  const links = (p.gateway?.links ?? []).filter(isRazorpay);
  const can = linkable(v, role);
  if (!p.gateway || (!can && links.length === 0)) return null;
  const live = links.find((l) => l.status === "live" && l.shortUrl) ?? null;
  const making = links.find((l) => l.status === "creating") ?? null;
  const earlier = links.filter((l) => l !== live && l !== making);
  // A proforma whose online payment waits for its tax invoice still shows its balance: no second link until that invoice is issued (the client paid already).
  const waitingInvoice = p.gateway.payments.some((g) => g.proformaPending);
  const canCreate = can && !live && !making && !waitingInvoice && p.balanceMinor > 0;

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast("success", GW_UI.linkCopied);
    } catch {
      toast("error", GW_UI.copyFailed);
    }
  }

  return (
    <section className="pay-link" aria-labelledby={headId}>
      <div className="pay-link__head">
        <h3 id={headId} className="pay-link__title">
          {GW.link}
        </h3>
        {live ? <LinkChip status="live" /> : making ? <LinkChip status="creating" /> : null}
      </div>
      {live ? (
        <>
          <div className="pay-link__ask">
            <span className="pay-link__amount tnum">{amountText(live.amountMinor, "INR")}</span>
            <span className="pay-lines__meta">{expiresText(live.expiresAt)}</span>
          </div>
          <div className="pay-link__perf" aria-hidden="true" />
          <div className="pay-link__url">
            <a
              href={live.shortUrl as string}
              className="pay-link__address docno"
              target="_blank"
              rel="noopener noreferrer"
            >
              {(live.shortUrl as string).replace(/^https:\/\//, "")}
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
            <div className="pay-link__acts">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => void copy(live.shortUrl as string)}
              >
                <Copy size={20} />
                {GW.copyLink}
              </button>
              {can && (
                <button
                  type="button"
                  className="btn btn--text pay-link__cancel"
                  onClick={() => setDialog("cancel")}
                >
                  {GW.cancelLink}
                </button>
              )}
            </div>
          </div>
        </>
      ) : making ? (
        <p className="pay-lines__meta">{amountText(making.amountMinor, "INR")}</p>
      ) : earlier.length > 0 && !canCreate ? null : (
        <div className="pay-link__none">
          {earlier.length === 0 && <p className="pay-lines__meta">{GW_UI.noLink}</p>}
          {canCreate && (
            <button type="button" className="btn btn--secondary" onClick={() => setDialog("create")}>
              <Plus size={20} />
              {GW.createLink}
            </button>
          )}
        </div>
      )}
      {earlier.length > 0 && (
        <details className="pay-link__earlier">
          <summary>
            {GW_UI.earlierLinks} <span className="tnum">({earlier.length})</span>
          </summary>
          <ul className="pay-link__list">
            {earlier.map((l) => (
              <li key={l.checkoutId}>
                <span className="tnum">{amountText(l.amountMinor, "INR")}</span>
                <span className="pay-lines__meta tnum">{formatIstMoment(l.createdAt)}</span>
                <LinkChip status={l.status} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {dialog === "create" && (
        <LinkDialog
          view={v}
          panel={p}
          role={role}
          onClose={() => setDialog(null)}
          onDone={(reused) => {
            setDialog(null);
            toast("success", reused ? GW_UI.linkReused : GW_UI.linkMade);
            props.onChanged();
          }}
        />
      )}
      {dialog === "cancel" && live && (
        <ConfirmDialog
          open
          title={GW_UI.cancelTitle}
          confirmLabel={GW.cancelLink}
          cancelLabel={GW_UI.keepLink}
          tone="danger"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            // a refusal shows the server's S24 words (ConfirmDialog's error line)
            await paymentsApi.cancelLink(v.id, live.checkoutId);
            toast("success", GW_UI.linkCancelled);
            props.onChanged();
            return undefined;
          }}
        >
          <p>{GW_UI.cancelBody}</p>
          <p className="tnum">
            {amountText(live.amountMinor, "INR")}{" "}
            <span className="pay-lines__meta">{expiresText(live.expiresAt)}</span>
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

/**
 * "Card payments" (M6.3, 07-ZM S13): on a USD document, where the client pays by card from the portal or the emailed invoice link. No link is made or copied
 * here (each card page lasts an hour, L7): the slip says so, shows the status of the client's last card page (its chip, amount and expiry while it is open),
 * and copies the client's portal page for the invoice. Shown while the document can be paid by card, or once it has had a card page.
 */
export function CardPayments(props: { view: InvoiceView; panel: Panel }) {
  const { view: v, panel: p } = props;
  const toast = useToast();
  const headId = useId();
  const sessions = (p.gateway?.links ?? []).filter(isStripe);
  const can = cardable(v);
  if (!p.gateway || (!can && sessions.length === 0)) return null;
  // The server lists them newest first; the open one, if any, is the one that matters.
  const last = sessions.find((l) => l.status === "live" || l.status === "creating") ?? sessions[0] ?? null;
  // The portal link is worth sending only while something can still be paid by card (a converted proforma, a settled invoice or a proforma whose card payment
  // waits for the Owner's rate has nothing left to pay online).
  const portal =
    can && portalLinkOffered(v.status, p.balanceMinor, p.gateway.payments) ? portalInvoiceUrl(v.id) : null;

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast("success", GW_UI.linkCopied);
    } catch {
      toast("error", GW_UI.copyFailed);
    }
  }

  return (
    <section className="pay-link pay-link--card" aria-labelledby={headId}>
      <div className="pay-link__head">
        <h3 id={headId} className="pay-link__title">
          <CreditCard size={20} />
          {CARD_ZM.cardTitle}
        </h3>
        {last && <LinkChip status={last.status} />}
      </div>
      <p className="pay-link__body">{cardBodyText(portal)}</p>
      {last && (
        <div className="pay-link__ask">
          <span className="pay-link__amount pay-link__amount--sm tnum">
            {amountText(last.amountMinor, "USD")}
          </span>
          <span className="pay-lines__meta tnum">
            {last.status === "live" ? expiresText(last.expiresAt) : formatIstMoment(last.createdAt)}
          </span>
        </div>
      )}
      {portal && (
        <div className="pay-link__acts">
          <button type="button" className="btn btn--secondary" onClick={() => void copy(portal)}>
            <Copy size={20} />
            {CARD_ZM.copyPortalLink}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * M6.4 (run file G3; S1, S2): the PayPal slip on a USD document, once the client has started a PayPal payment (staff never make a PayPal checkout: orders are
 * made on demand from the portal, L4). The same slip as Card payments, no perforation: the newest checkout's chip (S2, "Awaiting PayPal" while PayPal holds the
 * capture), its amount and when it ends, "Check now" (the capture or its re-fetch, as the member) and "Cancel checkout" (a local end; 409 `payment_processing`
 * while a capture is in flight), and the earlier checkouts folded away. Shown only once the document has a PayPal checkout: before that, Card payments already
 * says where the client pays.
 */
export function PayPalPayments(props: {
  view: InvoiceView;
  panel: Panel;
  role: Role;
  onChanged: () => void;
}) {
  const { view: v, panel: p } = props;
  const toast = useToast();
  const headId = useId();
  const [checking, setChecking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const checkouts = (p.gateway?.links ?? []).filter(isPayPal);
  // The server lists them newest first; an open one (being made, live, held by PayPal) is the one that matters.
  const last =
    checkouts.find((l) => l.status === "live" || l.status === "creating" || l.status === "capture_pending") ??
    checkouts[0];
  if (!p.gateway || !last) return null;
  const earlier = checkouts.filter((l) => l !== last);
  const can = allowed(props.role, "payments.link") && !v.client.anonymised;
  const canCheck =
    can && (last.status === "live" || last.status === "stale" || last.status === "capture_pending");
  const canCancel = can && (last.status === "live" || last.status === "stale");
  const id = last.checkoutId;

  async function check() {
    setChecking(true);
    try {
      const r = await paymentsApi.refreshLink(id);
      toast(r.result === "retry" ? "error" : "success", ZN_UI.checked[r.result] ?? ZN_UI.checkedOther);
      props.onChanged();
    } catch (e) {
      // 409 `payment_processing` (a capture in flight) and 502 come with the server's own words (S11)
      toast("error", gwErrorText(e));
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="pay-link pay-link--card" aria-labelledby={headId}>
      <div className="pay-link__head">
        <h3 id={headId} className="pay-link__title">
          <Wallet size={20} />
          {ZN_UI.payPalTitle}
        </h3>
        <PayPalChip status={last.status} />
      </div>
      <p className="pay-link__body">{ZN_UI.payPalBody}</p>
      <div className="pay-link__ask">
        <span className="pay-link__amount pay-link__amount--sm tnum">
          {amountText(last.amountMinor, "USD")}
        </span>
        <span className="pay-lines__meta tnum">
          {last.status === "live" ? expiresText(last.expiresAt) : formatIstMoment(last.createdAt)}
        </span>
      </div>
      {(canCheck || canCancel) && (
        <div className="pay-link__acts">
          {canCheck && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => void check()}
              disabled={checking}
              aria-busy={checking || undefined}
            >
              <RefreshCw size={20} />
              {checking ? ZN_UI.checking : ZN.checkNow}
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              className="btn btn--text pay-link__cancel"
              onClick={() => setCancelling(true)}
              disabled={checking}
            >
              {ZN_UI.cancelCheckout}
            </button>
          )}
        </div>
      )}
      {earlier.length > 0 && (
        <details className="pay-link__earlier">
          <summary>
            {ZN_UI.earlier} <span className="tnum">({earlier.length})</span>
          </summary>
          <ul className="pay-link__list">
            {earlier.map((l) => (
              <li key={l.checkoutId}>
                <span className="tnum">{amountText(l.amountMinor, "USD")}</span>
                <span className="pay-lines__meta tnum">{formatIstMoment(l.createdAt)}</span>
                <PayPalChip status={l.status} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {cancelling && (
        <ConfirmDialog
          open
          title={ZN_UI.cancelTitle}
          confirmLabel={ZN_UI.cancelCheckout}
          cancelLabel={ZN_UI.keepCheckout}
          tone="danger"
          onClose={() => setCancelling(false)}
          onConfirm={async () => {
            // a refusal (409 `payment_processing`, `link_not_live`) shows the server's words in the dialog (ConfirmDialog's error line)
            await paymentsApi.cancelLink(v.id, id);
            toast("success", ZN_UI.cancelled);
            props.onChanged();
            return undefined;
          }}
        >
          <p>{ZN_UI.cancelBody}</p>
          <p className="tnum">
            {amountText(last.amountMinor, "USD")}{" "}
            <span className="pay-lines__meta">{expiresText(last.expiresAt)}</span>
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

/** S2's chips for a PayPal checkout ("Failed" for a declined capture; "Awaiting PayPal" while PayPal holds it). */
function PayPalChip({ status }: { status: PaymentLinkRow["status"] }) {
  const c = payPalChip(status);
  return (
    <StatusPill tone={c.tone} icon={c.icon}>
      {c.label}
    </StatusPill>
  );
}

export function LinkChip({ status }: { status: PaymentLinkRow["status"] }) {
  const c = LINK_CHIPS[status] ?? LINK_CHIPS.failed;
  return (
    <StatusPill tone={c.tone} icon={c.icon}>
      {c.label}
    </StatusPill>
  );
}

/**
 * "Create payment link": one amount, the balance prefilled. The hint gives the range from the panel's `minimumMinor` (fix round 3 item 4: the server works it
 * out from Settings › Payment terms for every role, so a Staff member, who can't read the settings, sees it too); without it (an older API) the balance only.
 */
function LinkDialog(props: {
  view: InvoiceView;
  panel: Panel;
  role: Role;
  onClose: () => void;
  onDone: (reused: boolean) => void;
}) {
  const { view: v, panel: p } = props;
  const proforma = v.type === "proforma";
  // `linkHint` takes a floor; the minimum is one (`onlineMinimumOf(minimum, balance)` is the minimum itself).
  const floor = p.gateway?.minimumMinor ?? null;
  const [text, setText] = useState(plainAmount(p.balanceMinor, "INR"));
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = useRefusalFocus();

  async function submit() {
    const m = moneyFrom(text, "INR");
    const e = !m.ok ? m.error : m.minor <= 0 ? INVT_COPY.amountZero : null;
    setError(e);
    setFailure(null);
    if (e || !m.ok) {
      document.getElementById("pay-link-amount")?.focus();
      return;
    }
    setBusy(true);
    try {
      const r = await paymentsApi.createLink(v.id, { amountMinor: m.minor, expectedUpdatedAt: p.updatedAt });
      props.onDone(r.reused);
    } catch (err) {
      // The amount's own refusals (S24, the server's words with the minimum or the balance) go under the field; anything else above the actions.
      if (err instanceof RequestError && err.status === 400 && err.code.startsWith("amount_")) {
        setError(gwErrorText(err));
        document.getElementById("pay-link-amount")?.focus();
        return;
      }
      setFailure(gwErrorText(err));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={GW.createLink} onClose={props.onClose} busy={busy}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="dialog__body pay-form">
          <p>{GW_UI.createLede}</p>
          <FormField
            id="pay-link-amount"
            label={GW_UI.linkAmount}
            hint={linkHint(p.balanceMinor, floor, proforma)}
            error={error}
          >
            {(a) => (
              <div className="money-in">
                <span aria-hidden="true">₹</span>
                <input
                  {...a}
                  inputMode={proforma ? "numeric" : "decimal"}
                  autoComplete="off"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
            )}
          </FormField>
        </div>
        {failure && (
          <Notice tone="error" ref={refusal.ref}>
            {failure}
          </Notice>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
            {INV_COPY.cancel}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Working…" : GW.createLink}
          </button>
        </div>
      </form>
    </Modal>
  );
}
