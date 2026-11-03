// M6.5 on a client's Overview (run file G3; early check 2 "Refund in progress {amount}" by Credit; RA-41): the client's refunds still with the gateway, one row
// each under the credit they came out of ("Refund in progress" and that refund's own amount, as the server holds it, never added up here), and the Owner's
// "Refund credit", which opens the refund dialog on the client's credit sources (the payment picked first; the RA-41 line shows when the credit crossed a GST
// period).
import "../../refunds.css";
import { Link } from "react-router";
import { type Currency, paymentsApi } from "../../api.ts";
import { Modal } from "../../components/dialog.tsx";
import { RotateCcw } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { ZO_UI } from "../../lib/copy-zo.ts";
import { amountText } from "../../lib/payments.ts";
import { type RefundView, refundsApi } from "../../lib/refunds-api.ts";
import { RefundDialog } from "./refund-dialog.tsx";

/** Every page of one client's refunds in one state (`GET /refunds?clientId=&status=`; open refunds are few: one per payment at most). */
async function clientRefundsIn(clientId: string, status: "requested" | "processing"): Promise<RefundView[]> {
  const out: RefundView[] = [];
  let cursor: string | undefined;
  do {
    const p = await refundsApi.list({ clientId, status, ...(cursor ? { cursor } : {}) });
    out.push(...p.items);
    cursor = p.next ?? undefined;
  } while (cursor);
  return out;
}

/** The client's open refunds (requested or with the gateway), read by the client (B4: exact, never a first page of everyone's). */
export function useOpenRefunds(clientId: string, on: boolean, refreshKey: string): RefundView[] {
  const open = useLoad(
    () =>
      on
        ? Promise.all([clientRefundsIn(clientId, "requested"), clientRefundsIn(clientId, "processing")]).then(
            ([a, b]) => [...a, ...b].filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i),
          )
        : Promise.resolve([] as RefundView[]),
    `${clientId}:${on}:${refreshKey}`,
  );
  return open.state === "ready" ? open.data : [];
}

/** The figures' rows for one currency's open refunds: "Refund in progress" and each refund's own amount (a link to its payment). */
export function RefundsInProgress(props: { rows: readonly RefundView[] }) {
  return (
    <>
      {props.rows.map((r) => (
        <div key={r.id} className="acct__row rf-inflight">
          <dt>
            <span className="rf-inflight__label">
              <RotateCcw size={16} />
              {ZO_UI.refundInProgressLabel}
            </span>
            <span className="acct__sub">{ZO_UI.refundInProgressHint}</span>
          </dt>
          <dd>
            <Link
              to={`/payments/${encodeURIComponent(r.paymentId)}`}
              className="acct__amount rf-inflight__amount"
            >
              {amountText(r.amountMinor, r.currency)}
            </Link>
          </dd>
        </div>
      ))}
    </>
  );
}

/** "Refund credit" (the Owner): the client's credit sources, then the refund dialog on the one picked. */
export function ClientRefundDialog(props: {
  clientId: string;
  currency: Currency;
  onClose: () => void;
  onDone: (toast: string) => void;
}) {
  const credit = useLoad(() => paymentsApi.clientCredit(props.clientId), props.clientId);
  const sources = credit.state === "ready" ? credit.data.sources.filter((s) => s.availableMinor > 0) : [];
  if (credit.state !== "ready" || sources.length === 0)
    return (
      <Modal open title={ZO_UI.dialogTitle} onClose={props.onClose}>
        {credit.state === "loading" ? (
          <div className="dialog__body" aria-busy="true">
            <span className="skeleton" style={{ width: "60%" }} />
            <span className="skeleton" style={{ width: "80%" }} />
          </div>
        ) : credit.state === "failed" ? (
          <LoadFailed error={credit.error} onRetry={() => credit.reload()} />
        ) : (
          <div className="dialog__body">
            <p>{ZO_UI.noCredit}</p>
          </div>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onClose}>
            {ZO_UI.close}
          </button>
        </div>
      </Modal>
    );
  return (
    <RefundDialog
      mode="refund"
      payments={sources.map((s) => ({
        id: s.paymentId,
        receivedOn: s.receivedOn,
        currency: props.currency,
        freeMinor: s.availableMinor,
      }))}
      onClose={props.onClose}
      onDone={props.onDone}
    />
  );
}
