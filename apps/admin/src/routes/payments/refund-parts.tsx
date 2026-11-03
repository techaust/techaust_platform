// M6.5 shared parts of the refund and receipt screens [ADM-PAY-08, ADM-PAY-09, ADM-PAY-13; run file G1, L44–L46]: the refund's status chip, the refund rows (the
// Payments panel's, the payment's and the Refunds tab's ledger lines: asked on, how, reason, amount, state, then the Owner's "Try again" and "Cancel refund"),
// a payment's receipt cell, and the ₹25 lakh line of a USD document.
// Design: a refund reads as a ledger line in the same table as the payments it came from (`.pay-lines`, cards below md through the same markup), its state one
// chip (icon and words, never colour alone; docs/06 §5.5). A refund's state stays on its row whatever happened to its "Needs review" item (L45). "Try again"
// and "Cancel refund" wait 15 minutes after the request or the last check (L44, L46; `refundOpensAt` from the row's `requestedAt` and `lastAttemptAt`): they are drawn disabled with the time they open, and a `too_soon`
// answer moves that time to the server's `retryAfterS`. Amounts are formatted by core; nothing is added up here.
import "../../refunds.css";
import { REFUND_SWEEP_IDLE_MS } from "@techaust/core/gateway-rpc";
import type { Role } from "@techaust/core/permissions";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { RequestError } from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { Modal, useRefusalFocus } from "../../components/dialog.tsx";
import { StatusPill } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import { Alert, FileText, RefreshCw } from "../../components/icons.tsx";
import { useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import { periodText, REFUND_PILLS, ZO_UI } from "../../lib/copy-zo.ts";
import { INV_COPY } from "../../lib/invoices.ts";
import { amountText, payErrorText } from "../../lib/payments.ts";
import {
  type PaCbVerdict,
  type PanelReceipt,
  type RefundView,
  refundOpensAt,
  refundsApi,
} from "../../lib/refunds-api.ts";
import { moneyFrom } from "../../lib/settings-form.ts";
import { day } from "./parts.tsx";

/** A refund row as the screens draw it (the panel's rows lack the gateway's id: such a row can't say whether it can be cancelled, so it doesn't offer it). */
export type RefundRowData = Pick<
  RefundView,
  | "id"
  | "provider"
  | "origin"
  | "status"
  | "reasonCode"
  | "currency"
  | "amountMinor"
  | "requestedAt"
  | "lastAttemptAt"
  | "settledOn"
  | "failureCode"
> &
  Partial<
    Pick<RefundView, "providerRefundId" | "clientName" | "clientCode" | "paymentId" | "inrRefundedMinor">
  >;

/** Review part 1, finding 9 (L9): a refund in another currency that went out, whose INR figure the Owner hasn't recorded yet. */
export const needsInr = (r: RefundRowData) =>
  r.status === "succeeded" && r.currency !== "INR" && (r.inrRefundedMinor ?? null) === null;

export function RefundPill({ status }: { status: RefundView["status"] }) {
  const p = REFUND_PILLS[status];
  return (
    <StatusPill tone={p.tone} icon={p.icon}>
      {ZO_UI.status[status]}
    </StatusPill>
  );
}

/** "14:05" IST, for the time a button opens. */
const istTime = (ms: number) => new Date(ms + 19_800_000).toISOString().slice(11, 16);

/** The current time, every 30 seconds while `on` (so a waiting button opens by itself). */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [on]);
  return now;
}

export const isOpen = (s: RefundView["status"]) => s === "requested" || s === "processing";

/** The Owner's two actions on an open refund, with their 15-minute wait (L44, L46). */
export function RefundActions(props: { row: RefundRowData; onChanged: (toast: string) => void }) {
  const r = props.row;
  const [opensAt, setOpensAt] = useState(() => refundOpensAt(r));
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const now = useNow(true);
  const waiting = now < opensAt;
  // Cancel only for a refund the gateway never acknowledged (still `requested`, no gateway id; the panel's rows don't carry the id, so the server decides).
  const cancellable = r.status === "requested" && !r.providerRefundId;
  const hidden = <span className="visually-hidden">{` ${amountText(r.amountMinor, r.currency)}`}</span>;
  /** A `too_soon` answer moves the opening time to the server's (L44). The step-up dialog opens by itself on 403 `step_up_required` (`request`). */
  const tooSoon = (e: unknown) => {
    if (e instanceof RequestError && e.code === "too_soon") {
      const s = Number(e.extra.details?.retryAfterS);
      if (Number.isFinite(s) && s > 0) setOpensAt(Date.now() + s * 1000);
    }
  };
  async function retry() {
    setBusy(true);
    setFailure(null);
    try {
      await refundsApi.retry(r.id);
      setOpensAt(Date.now() + REFUND_SWEEP_IDLE_MS);
      props.onChanged(ZO_UI.retried);
    } catch (e) {
      tooSoon(e);
      setFailure(payErrorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="rf-acts">
      <span className="rf-acts__buttons">
        <button
          type="button"
          className="btn btn--secondary"
          disabled={waiting || busy}
          aria-busy={busy || undefined}
          onClick={() => void retry()}
        >
          <RefreshCw size={16} />
          {ZO_UI.tryAgain}
          {hidden}
        </button>
        {cancellable && (
          <button
            type="button"
            className="btn btn--text"
            disabled={waiting || busy}
            onClick={() => setConfirming(true)}
          >
            {ZO_UI.cancelRefund}
            {hidden}
          </button>
        )}
      </span>
      {/* review part 2, P2-13: a refund with the gateway has no Cancel, so its line names only "Try again" */}
      {waiting && (
        <span className="pay-lines__meta">
          {cancellable ? ZO_UI.waitUntil(istTime(opensAt)) : ZO_UI.waitRetry(istTime(opensAt))}
        </span>
      )}
      {failure && (
        <span className="rf-acts__error" role="alert">
          <Alert size={16} />
          {failure}
        </span>
      )}
      {confirming && (
        <ConfirmDialog
          open
          title={ZO_UI.cancelRefund}
          confirmLabel={ZO_UI.cancelRefund}
          cancelLabel={ZO_UI.keepRefund}
          tone="danger"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            try {
              await refundsApi.cancel(r.id);
            } catch (e) {
              tooSoon(e);
              throw e;
            }
            setConfirming(false);
            props.onChanged(ZO_UI.cancelled);
            return undefined;
          }}
        >
          <p>{ZO_UI.cancelConfirm}</p>
        </ConfirmDialog>
      )}
    </span>
  );
}

/** A refund's state: its chip, the day it went out, or the gateway's failure code. */
export function RefundState({ row: r }: { row: RefundRowData }) {
  return (
    <span className="rf-state">
      <RefundPill status={r.status} />
      {r.status === "succeeded" && r.settledOn && (
        <span className="pay-lines__meta">
          {`${ZO_UI.colRefunded} `}
          {/* second review, M4: the day never breaks inside itself ("03 Nov" / "2026") */}
          <span className="pay-lines__nowrap">{day(r.settledOn)}</span>
        </span>
      )}
      {typeof r.inrRefundedMinor === "number" && r.currency !== "INR" && (
        <span className="pay-lines__meta">{ZO_UI.inrDebited(amountText(r.inrRefundedMinor, "INR"))}</span>
      )}
      {r.status === "failed" && r.failureCode && (
        <span className="pay-lines__meta">{ZO_UI.failureCode(r.failureCode)}</span>
      )}
    </span>
  );
}

/**
 * The refunds as ledger lines: asked on, how, reason, amount, state (with the gateway's failure code), and for the Owner, on an open refund, its two actions.
 * `client` adds the client's name (the Refunds tab).
 */
export function RefundRows(props: {
  rows: readonly RefundRowData[];
  role: Role;
  caption: string;
  client?: boolean;
  /** False on the payment's own page: its refunds' days would link to the page they are on (review part 2, P2-13). */
  linkPayments?: boolean;
  onChanged: (toast: string) => void;
}) {
  const owner = allowed(props.role, "refunds.issue");
  const linked = props.linkPayments !== false;
  const acts = owner && props.rows.some((r) => isOpen(r.status) || needsInr(r));
  return (
    <table className="pay-lines rf-lines">
      <caption className="visually-hidden">{props.caption}</caption>
      <thead>
        <tr>
          <th scope="col">{ZO_UI.colRequested}</th>
          {props.client && <th scope="col">{ZO_UI.colClient}</th>}
          <th scope="col">{ZO_UI.colWay}</th>
          <th scope="col">{ZO_UI.colReason}</th>
          <th scope="col" className="num">
            {ZO_UI.colAmount}
          </th>
          <th scope="col">{ZO_UI.colStatus}</th>
          {acts && (
            <th scope="col">
              <span className="visually-hidden">{ZO_UI.tryAgain}</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r) => (
          <tr key={r.id}>
            <th scope="row" className="tnum">
              {r.paymentId && linked ? (
                <Link to={`/payments/${encodeURIComponent(r.paymentId)}`} className="pay-row__link">
                  {day(new Date(r.requestedAt + 19_800_000).toISOString().slice(0, 10))}
                </Link>
              ) : (
                day(new Date(r.requestedAt + 19_800_000).toISOString().slice(0, 10))
              )}
            </th>
            {props.client && (
              <td data-label={ZO_UI.colClient}>
                {r.clientName ?? ""} {r.clientCode && <span className="docno">{r.clientCode}</span>}
              </td>
            )}
            <td data-label={ZO_UI.colWay}>{ZO_UI.origin(r.origin, r.provider)}</td>
            <td data-label={ZO_UI.colReason}>{ZO_UI.reason[r.reasonCode]}</td>
            <td className="num tnum" data-label={ZO_UI.colAmount}>
              {amountText(r.amountMinor, r.currency)}
            </td>
            <td data-label={ZO_UI.colStatus}>
              <RefundState row={r} />
            </td>
            {acts && (
              <td className="rf-lines__acts">
                {isOpen(r.status) ? (
                  <RefundActions row={r} onChanged={props.onChanged} />
                ) : needsInr(r) ? (
                  <RefundInrButton row={r} onChanged={props.onChanged} />
                ) : null}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A payment's receipt (S1–S4): its number with the PDF link; "PDF being made" (and, for a role that may ask, "Make the PDF again") while the PDF isn't stored;
 * "Receipt being prepared" while the receipt isn't issued yet; a void receipt says so.
 */
export function ReceiptCell(props: { receipt: PanelReceipt | undefined; role: Role; status?: string }) {
  const toast = useToast();
  const [asked, setAsked] = useState(false);
  const r = props.receipt;
  if (props.status && props.status !== "confirmed")
    return <span className="pay-lines__meta pay-lines__nowrap">{"–"}</span>;
  if (!r?.receiptId || !r.number)
    return <span className="pay-lines__meta rf-receipt__wait">{ZO_UI.receiptPreparing}</span>;
  if (r.status === "void")
    return (
      <span className="rf-receipt">
        <span className="docno">{r.number}</span>
        <span className="pay-lines__meta">{ZO_UI.receiptVoid}</span>
      </span>
    );
  if (r.hasPdf)
    return (
      <a href={refundsApi.receiptPdfHref(r.receiptId)} className="pay-proof-link rf-receipt__link">
        <FileText size={16} />
        <span className="docno">{r.number}</span>
        <span className="visually-hidden">{` ${ZO_UI.receiptOpen}`}</span>
      </a>
    );
  const canAsk = allowed(props.role, "invoices.draft") && !asked;
  const id = r.receiptId;
  return (
    <span className="rf-receipt">
      <span className="docno">{r.number}</span>
      <span className="pay-lines__meta">{ZO_UI.receiptPdfMaking}</span>
      {canAsk && (
        <button
          type="button"
          className="btn btn--text"
          onClick={async () => {
            try {
              await refundsApi.receiptRemake(id);
              setAsked(true);
              toast("success", ZO_UI.receiptRemakeAsked);
            } catch (e) {
              toast("error", payErrorText(e));
            }
          }}
        >
          {ZO_UI.receiptRemake}
          <span className="visually-hidden">{` ${r.number}`}</span>
        </button>
      )}
    </span>
  );
}

/**
 * The payment's own receipt and refunds (the entry dialog, `/payments/:id`): its receipt as on the Payments panel, then its refunds as ledger lines (only for
 * a role that reads refunds). A failed read is one quiet line (the payment's facts above it still stand).
 */
export function PaymentReceiptAndRefunds(props: {
  paymentId: string;
  kind: string;
  status: string;
  role: Role;
  onChanged: (toast: string) => void;
}) {
  const wantsReceipt =
    props.kind === "payment" && (props.status === "confirmed" || props.status === "withdrawn");
  const receipt = useLoad(
    () => (wantsReceipt ? refundsApi.receiptOf(props.paymentId) : Promise.resolve(null)),
    `${props.paymentId}:${wantsReceipt}`,
  );
  const readsRefunds = allowed(props.role, "refunds.read") && props.kind === "payment";
  const [tick, setTick] = useState(0);
  const refunds = useLoad(
    () => (readsRefunds ? refundsApi.ofPayment(props.paymentId) : Promise.resolve(null)),
    `${props.paymentId}:${readsRefunds}:${tick}`,
  );
  const r = receipt.state === "ready" ? receipt.data?.receipt : undefined;
  const rows = refunds.state === "ready" ? (refunds.data?.items ?? []) : [];
  return (
    <>
      {wantsReceipt && (
        <dl className="inv-facts rf-entry-receipt">
          <div>
            <dt>{ZO_UI.receipt}</dt>
            <dd>
              {receipt.state === "loading" ? (
                <span className="skeleton" style={{ width: "8rem" }} />
              ) : receipt.state === "failed" ? (
                <span className="pay-lines__meta">{ZO_UI.receiptPreparing}</span>
              ) : (
                <ReceiptCell
                  role={props.role}
                  receipt={
                    r
                      ? {
                          receiptId: r.id,
                          number: r.number,
                          issueDate: r.issueDate,
                          status: r.status,
                          hasPdf: r.hasPdf,
                          freeMinor: 0,
                        }
                      : undefined
                  }
                />
              )}
            </dd>
          </div>
        </dl>
      )}
      {rows.length > 0 && (
        <div className="rf-block">
          <h3 className="pay-sub">{ZO_UI.refundsHeading}</h3>
          <RefundRows
            rows={rows}
            role={props.role}
            caption={ZO_UI.refundsHeading}
            linkPayments={false}
            onChanged={(t) => {
              setTick((n) => n + 1);
              props.onChanged(t);
            }}
          />
        </div>
      )}
    </>
  );
}

/** The ₹25 lakh line on a USD document (ADM-PAY-13, L12): a warning, never a block; shown only when a gateway's check is above the cap or can't be made. */
export function PaCbNotice({
  paCb,
}: {
  paCb: { paypal: PaCbVerdict; stripe: PaCbVerdict } | null | undefined;
}) {
  if (!paCb) return null;
  const v = [paCb.paypal, paCb.stripe].find((x) => !x.ok && x.code === "above_pa_cb_cap") as
    | { ok: false; code: "above_pa_cb_cap"; inrMinor: number }
    | undefined;
  const unknown = !v && [paCb.paypal, paCb.stripe].some((x) => !x.ok && x.code === "rate_unknown");
  if (!v && !unknown) return null;
  return (
    <div className="pay-seen pay-warn rf-pacb" role="note">
      <Alert size={20} />
      <p>{v ? ZO_UI.paCbOver(amountText(v.inrMinor, "INR")) : ZO_UI.paCbRateUnknown}</p>
    </div>
  );
}

/**
 * RA-41 on the Payments panel (review part 1, finding 3): one line per GST period in which a payment holding money here arrived whose credit may be an advance
 * (on no invoice, or more than ₹1,000 over one; the server's `ra41` facts). The approved refund-dialog line without its "is refunded in" clause.
 */
export function Ra41Notice({ receipts }: { receipts: Record<string, PanelReceipt> | undefined }) {
  const periods = [
    ...new Set(
      Object.values(receipts ?? {})
        .map((r) => r.ra41)
        .filter((f): f is NonNullable<typeof f> => f?.advanceLine === "credit_may_be_advance")
        .map((f) => f.receivedPeriod),
    ),
  ].sort();
  if (periods.length === 0) return null;
  return (
    <>
      {periods.map((p) => (
        <div key={p} className="pay-seen pay-warn rf-pacb" role="note">
          <Alert size={20} />
          <p>{ZO_UI.ra41HeldLine(periodText(p))}</p>
        </div>
      ))}
    </>
  );
}

/** Review part 1, finding 9 (L9): "Record INR amount" on a refund in another currency that went out, and its one-field dialog (the Owner, fresh code). */
export function RefundInrButton(props: { row: RefundRowData; onChanged: (toast: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn--secondary" onClick={() => setOpen(true)}>
        {ZO_UI.inrRecord}
        <span className="visually-hidden">{` ${amountText(props.row.amountMinor, props.row.currency)}`}</span>
      </button>
      {open && (
        <RefundInrDialog
          row={props.row}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            props.onChanged(ZO_UI.inrSaved);
          }}
        />
      )}
    </>
  );
}

function RefundInrDialog(props: { row: RefundRowData; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = useRefusalFocus();
  async function submit() {
    const m = moneyFrom(amount, "INR");
    const e = !m.ok ? m.error : m.minor <= 0 ? "Enter an amount above zero." : undefined;
    setError(e);
    if (e || !m.ok) {
      document.getElementById("rf-inr")?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await refundsApi.recordInr(props.row.id, m.minor);
      props.onDone();
    } catch (err) {
      setFailure(payErrorText(err));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={ZO_UI.inrRecord} onClose={props.onClose} busy={busy}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="dialog__body pay-form">
          {/* review part 2, item 12: the refund's facts as the other refund dialogs show them, then the one field */}
          <dl className="inv-facts rf-facts">
            <div>
              <dt>{ZO_UI.colAmount}</dt>
              <dd className="tnum">{amountText(props.row.amountMinor, props.row.currency)}</dd>
            </div>
            {props.row.settledOn && (
              <div>
                <dt>{ZO_UI.colRefunded}</dt>
                <dd className="tnum">{day(props.row.settledOn)}</dd>
              </div>
            )}
          </dl>
          <FormField id="rf-inr" label={ZO_UI.inrLabel} hint={ZO_UI.inrHint} error={error}>
            {(a) => (
              <div className="money-in">
                <span aria-hidden="true">₹</span>
                <input
                  {...a}
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
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
            {busy ? "Working…" : ZO_UI.inrRecord}
          </button>
        </div>
      </form>
    </Modal>
  );
}
