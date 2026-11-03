// M6.5 review part 1, finding 3 (RA-41; ADM-PAY-08): Payments › Credit at period end, for the Owner and the Accountant (`reports.finance`). The confirmed
// payments whose credit at a GST period's end may be an advance (on no invoice, or more than ₹1,000 over its invoices), by client, with the credit then and
// the day it has been held since, so the Owner refunds it, uses it or records it in GSTR-1 Table 11 for that period. A period picker (the latest ended period
// first, then the seven before it, by Settings › Tax's filing frequency), the existing `DataTable`, keyset "Show more". Figures are the server's; nothing is
// added up here. Settled by the lead on the safest reading, 2026-11-03 (08-C RA-41).
import type { Role } from "@techaust/core/permissions";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { EmptyState } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import { Wallet } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { periodText, ZO_UI } from "../../lib/copy-zo.ts";
import { amountText, payErrorText } from "../../lib/payments.ts";
import { type CreditHeldRow, periodsFrom, refundsApi } from "../../lib/refunds-api.ts";
import { day } from "./parts.tsx";

export function CreditHeldTab(_props: { role: Role }) {
  const toast = useToast();
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const list = useLoad(() => refundsApi.creditHeld(period ? { period } : {}), period ?? "");
  const [more, setMore] = useState<CreditHeldRow[]>([]);
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const rows = [...(list.data?.items ?? []), ...more];
  const cursor = next === undefined ? (list.data?.next ?? null) : next;
  const shown = list.data?.period;
  // the picker's periods start from the latest ended one the server named first (picking an older one keeps them all)
  const [base, setBase] = useState<{ period: string; frequency: "monthly" | "quarterly" } | null>(null);
  useEffect(() => {
    if (!base && list.data) setBase({ period: list.data.period, frequency: list.data.frequency });
  }, [base, list.data]);
  const options = base ? periodsFrom(base.period, base.frequency) : [];

  async function showMore() {
    if (!cursor || !shown) return;
    setLoading(true);
    try {
      const r = await refundsApi.creditHeld({ period: shown, cursor });
      setMore((m) => [...m, ...r.items.filter((x) => !m.some((y) => y.paymentId === x.paymentId))]);
      setNext(r.items.length > 0 ? r.next : null);
    } catch (e) {
      toast("error", payErrorText(e));
    } finally {
      setLoading(false);
    }
  }

  const columns: Column<CreditHeldRow>[] = [
    {
      key: "client",
      header: ZO_UI.creditHeldColClient,
      card: "title",
      cell: (r) => (
        <span>
          {r.clientName} <span className="docno">{r.clientCode}</span>
        </span>
      ),
    },
    {
      key: "received",
      header: ZO_UI.creditHeldColReceived,
      cell: (r) => (
        <Link to={`/payments/${encodeURIComponent(r.paymentId)}`} className="tnum">
          {day(r.receivedOn)}
        </Link>
      ),
    },
    {
      key: "since",
      header: ZO_UI.creditHeldColSince,
      cell: (r) => <span className="tnum">{day(r.heldSince)}</span>,
    },
    {
      key: "invoice",
      header: ZO_UI.creditHeldColOnInvoice,
      cell: (r) => ZO_UI.creditHeldOnInvoice(r.onInvoice),
    },
    {
      key: "credit",
      header: ZO_UI.creditHeldColCredit,
      align: "end",
      cell: (r) => <span className="tnum pay-lines__nowrap">{amountText(r.creditMinor, r.currency)}</span>,
    },
  ];

  return (
    <div className="rf-tab">
      <p className="hint">{ZO_UI.creditHeldLede}</p>
      {options.length > 0 && (
        <FormField id="ch-period" label={ZO_UI.creditHeldPeriod}>
          {(a) => (
            <select
              {...a}
              value={period ?? shown}
              onChange={(e) => {
                setMore([]);
                setNext(undefined);
                setPeriod(e.target.value);
              }}
            >
              {options.map((o) => (
                <option key={o} value={o}>
                  {periodText(o)}
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}
      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="clients-table pay-table rf-tab__table">
          <DataTable
            caption={ZO_UI.creditHeldTab}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.paymentId}
            loading={list.state === "loading"}
            skeletonRows={4}
            empty={
              <EmptyState icon={<Wallet />} title={ZO_UI.creditHeldEmpty}>
                {null}
              </EmptyState>
            }
          />
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
