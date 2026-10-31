// The approvals queue's payment items (M6.1; ADM-APR-01, L18): the entries Staff recorded, waiting for the Owner's check or already checked. A payment is
// never decided here (`/approvals/:id/decide` answers `use_payment_verify`): each row opens the entry on Payments, where the Owner confirms or rejects it.
import { useState } from "react";
import { Link } from "react-router";
import { type PaymentApprovalItem, paymentsApi } from "../../api.ts";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { EmptyState } from "../../components/display.tsx";
import { ClipboardCheck, Search } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { amountText, PAY_COPY, PAY_UI, payErrorText } from "../../lib/payments.ts";
import { paymentHref } from "./panel.tsx";
import { day, PaymentPill } from "./parts.tsx";

export function PaymentApprovals(props: { owner: boolean; state: string | null }) {
  const filter = props.state ? { status: props.state } : {};
  const list = useLoad(() => paymentsApi.approvals(filter), props.state ?? "all");
  // Visual review (low): the queue follows `next` with line 36's "Show more payments", as /payments does.
  const [more, setMore] = useState<PaymentApprovalItem[]>([]);
  // Re-check finding 6: "a further page was read" apart from `more.length`, so an empty page never sends the button back to the first cursor.
  const [paged, setPaged] = useState(false);
  const [after, setAfter] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const toast = useToast();
  const next = paged ? after : list.state === "ready" ? list.data.next : null;
  async function showMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const r = await paymentsApi.approvals({ ...filter, after: next });
      setMore((m) => [...m, ...r.approvals.filter((a) => !m.some((x) => x.id === a.id))]);
      setPaged(true);
      // an empty page ends the list, whatever `next` it names
      setAfter(r.approvals.length > 0 ? r.next : null);
    } catch (e) {
      toast("error", payErrorText(e));
    } finally {
      setLoadingMore(false);
    }
  }
  const columns: Column<PaymentApprovalItem>[] = [
    {
      key: "date",
      header: PAY_COPY.dateReceived,
      card: "title",
      cell: (r) => (
        <Link to={paymentHref(r.payment.id)} className="tnum pay-row__link">
          {day(r.payment.receivedOn)}
        </Link>
      ),
    },
    {
      key: "client",
      header: PAY_UI.colClient,
      cell: (r) => (
        <span>
          {r.payment.clientName} <span className="docno pay-lines__code">{r.payment.clientCode}</span>
        </span>
      ),
    },
    {
      key: "amount",
      header: PAY_UI.colAmount,
      align: "end",
      cell: (r) => <span className="tnum">{amountText(r.payment.amountMinor, r.payment.currency)}</span>,
    },
    { key: "by", header: PAY_UI.recordedBy, cell: (r) => <span>{r.requesterName ?? ""}</span> },
    { key: "at", header: PAY_UI.colStatus, cell: (r) => <PaymentPill status={r.payment.status} /> },
  ];
  if (list.state === "failed") return <LoadFailed error={list.error} onRetry={() => list.reload()} />;
  return (
    <div className="clients-table pay-table">
      <DataTable
        caption={PAY_COPY.toCheck}
        columns={columns}
        rows={[...(list.data?.approvals ?? []), ...more]}
        rowKey={(r) => r.id}
        loading={list.state === "loading"}
        skeletonRows={3}
        actions={
          props.owner
            ? (r) =>
                r.payment.status === "pending_verification" ? (
                  <Link to={paymentHref(r.payment.id)} className="btn btn--secondary">
                    {PAY_COPY.confirm}
                    <span className="visually-hidden">{` ${r.payment.clientName} ${day(r.payment.receivedOn)}`}</span>
                  </Link>
                ) : null
            : undefined
        }
        empty={
          <EmptyState
            icon={props.state && props.state !== "pending" ? <Search /> : <ClipboardCheck />}
            title={PAY_UI.noneToCheck.replace(/\.$/, "")}
          >
            {null}
          </EmptyState>
        }
      />
      {next && (
        <button
          type="button"
          className="btn btn--secondary notes__more"
          onClick={() => void showMore()}
          disabled={loadingMore}
          aria-busy={loadingMore || undefined}
        >
          {loadingMore ? "Loading…" : PAY_UI.showMore}
        </button>
      )}
    </div>
  );
}
