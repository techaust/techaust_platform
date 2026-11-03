// M6.5 (run file G4; ADM-PAY-08, L44–L46): the Refunds tab of Payments, every refund newest first with its state (a chip filter: all, or one state), the
// Owner's "Try again" and "Cancel refund" on the open ones; and the refund dialog opened from a "Needs review" item ("Record this refund" for a refund made in
// the gateway's dashboard, "Record lost dispute" for a chargeback, L7, L40), with the invoice's ledger read first so the dialog knows what the payment holds.
import "../../refunds.css";
import type { Role } from "@techaust/core/permissions";
import type { RefundStatus } from "@techaust/core/refunds";
import { useState } from "react";
import { paymentsApi, type ReviewItem } from "../../api.ts";
import { FilterBar } from "../../components/data-table.tsx";
import { EmptyState } from "../../components/display.tsx";
import { RotateCcw } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { DISPUTE_KINDS, ZO_UI } from "../../lib/copy-zo.ts";
import { payErrorText } from "../../lib/payments.ts";
import { type RefundView, refundsApi } from "../../lib/refunds-api.ts";
import { RefundDialog } from "./refund-dialog.tsx";
import { RefundRows } from "./refund-parts.tsx";

const STATES: RefundStatus[] = ["requested", "processing", "succeeded", "failed"];

export function RefundsTab(props: { role: Role }) {
  const toast = useToast();
  const [status, setStatus] = useState<RefundStatus | null>(null);
  const [tick, setTick] = useState(0);
  const list = useLoad(() => refundsApi.list(status ? { status } : {}), `${status ?? ""}:${tick}`);
  const [more, setMore] = useState<RefundView[]>([]);
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const rows = [...(list.data?.items ?? []), ...more];
  const cursor = next === undefined ? (list.data?.next ?? null) : next;

  const changed = (t: string) => {
    toast("success", t);
    setMore([]);
    setNext(undefined);
    setTick((n) => n + 1);
  };

  async function showMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const r = await refundsApi.list({ ...(status ? { status } : {}), cursor });
      setMore((m) => [...m, ...r.items.filter((x) => !m.some((y) => y.id === x.id))]);
      setNext(r.items.length > 0 ? r.next : null);
    } catch (e) {
      toast("error", payErrorText(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rf-tab">
      <FilterBar
        groups={[
          {
            key: "status",
            label: ZO_UI.colStatus,
            options: STATES.map((s) => ({ value: s, label: ZO_UI.status[s] })),
            selected: status ? [status] : [],
          },
        ]}
        onToggle={(_g, v) => {
          setMore([]);
          setNext(undefined);
          setStatus((s) => (s === v ? null : (v as RefundStatus)));
        }}
        onClear={() => {
          setMore([]);
          setNext(undefined);
          setStatus(null);
        }}
        result={
          list.state === "ready" ? `${rows.length}${cursor ? "+" : ""} ${ZO_UI.refundsTab.toLowerCase()}` : ""
        }
      />
      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : list.state === "loading" ? (
        <div className="rf-tab__loading" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading refunds
          </p>
          <span className="skeleton" style={{ width: "70%" }} />
          <span className="skeleton" style={{ width: "90%" }} />
          <span className="skeleton" style={{ width: "60%" }} />
        </div>
      ) : rows.length === 0 ? (
        <div className="dtable dtable--empty">
          <EmptyState icon={<RotateCcw />} title={status ? ZO_UI.refundsEmptyFiltered : ZO_UI.refundsEmpty}>
            {null}
          </EmptyState>
        </div>
      ) : (
        <div className="rf-tab__table">
          <RefundRows rows={rows} role={props.role} caption={ZO_UI.refundsTab} client onChanged={changed} />
        </div>
      )}
      {cursor && (
        <button
          type="button"
          className="btn btn--secondary notes__more"
          onClick={() => void showMore()}
          disabled={loading}
          aria-busy={loading || undefined}
        >
          {loading ? "Loading…" : ZO_UI.loadMore}
        </button>
      )}
    </div>
  );
}

/**
 * The refund dialog for a "Needs review" item (L7, L40): the payment is read (its gateway and amount) and, when the item names an invoice, that invoice's
 * Payments panel (its excess, what the payment holds there and can give back), so the record draws on the same money a refund would.
 */
export function ReviewRefund(props: {
  item: ReviewItem;
  onClose: () => void;
  onDone: (toast: string) => void;
}) {
  const it = props.item;
  const paymentId = it.payment_id ?? "";
  const pay = useLoad(() => paymentsApi.get(paymentId), paymentId);
  const panel = useLoad(
    () => (it.document_id ? paymentsApi.invoicePanel(it.document_id) : Promise.resolve(null)),
    it.document_id ?? "",
  );
  if (pay.state !== "ready" || panel.state !== "ready") {
    if (pay.state === "failed" || panel.state === "failed")
      return (
        <div className="rf-tab__fail">
          <LoadFailed
            error={pay.state === "failed" ? pay.error : panel.error}
            onRetry={() => {
              pay.reload();
              panel.reload();
            }}
          />
        </div>
      );
    return null;
  }
  const p = pay.data.payment;
  const doc = panel.data;
  const held = doc?.payments.find((x) => x.paymentId === p.id);
  const free = (doc as { receipts?: Record<string, { freeMinor: number }> } | null)?.receipts?.[p.id]
    ?.freeMinor;
  const dispute = DISPUTE_KINDS.includes(it.kind);
  const settledOn = new Date(it.created_at + 19_800_000).toISOString().slice(0, 10);
  return (
    <RefundDialog
      mode={dispute ? "chargeback" : "outside"}
      payments={[
        {
          id: p.id,
          receivedOn: p.receivedOn,
          currency: p.currency,
          freeMinor: free ?? 0,
          holdingMinor: held?.heldMinor,
          provider: p.provider,
          status: p.status,
          amountMinor: p.amountMinor,
        },
      ]}
      document={
        doc && it.document_id
          ? {
              id: it.document_id,
              number: it.document_number,
              type: doc.type,
              updatedAt: doc.updatedAt,
              excessMinor: doc.excessMinor,
            }
          : undefined
      }
      prefill={{
        amountMinor: it.amount_minor ?? undefined,
        providerRefundId: typeof it.facts?.refundId === "string" ? it.facts.refundId : undefined,
        settledOn,
      }}
      onClose={props.onClose}
      onDone={props.onDone}
    />
  );
}
