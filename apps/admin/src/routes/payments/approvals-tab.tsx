// The approvals queue's payment items (M6.1; ADM-APR-01, L18): the entries Staff recorded, waiting for the Owner's check or already checked. A payment is
// never decided here (`/approvals/:id/decide` answers `use_payment_verify`): each row opens the entry on Payments, where the Owner confirms or rejects it.
import { Link } from "react-router";
import { type PaymentApprovalItem, paymentsApi } from "../../api.ts";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { EmptyState } from "../../components/display.tsx";
import { ClipboardCheck, Search } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { amountText, PAY_COPY, PAY_UI } from "../../lib/payments.ts";
import { paymentHref } from "./panel.tsx";
import { day, PaymentPill } from "./parts.tsx";

export function PaymentApprovals(props: { owner: boolean; state: string | null }) {
  const list = useLoad(
    () => paymentsApi.approvals(props.state ? { status: props.state } : {}),
    props.state ?? "all",
  );
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
        rows={list.data?.approvals ?? []}
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
    </div>
  );
}
