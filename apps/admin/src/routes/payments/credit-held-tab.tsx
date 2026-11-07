// M6.5 review part 1, finding 3 (RA-41; ADM-PAY-08): Payments › Credit at period end, for the Owner and the Accountant (`reports.finance`). The confirmed
// payments whose credit at a GST period's end may be an advance (on no invoice, or more than ₹1,000 over its invoices), by client, with the credit then and
// the day it has been held since, so the Owner refunds it, uses it or records it in GSTR-1 Table 11 for that period. A period picker (the latest ended period
// first, then the seven before it, by Settings › Tax's filing frequency), the existing `DataTable`, keyset "Show more". Figures are the server's; nothing is
// added up here. Settled by the lead on the safest reading, 2026-11-03 (08-C RA-41).
import "../../refunds.css";
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
import { CHECKING_OLDER_LINE, readPastEmptyPages, showsEmpty } from "../../lib/keyset-pages.ts";
import { amountText, payErrorText } from "../../lib/payments.ts";
import { type CreditHeldRow, periodsFrom, refundsApi } from "../../lib/refunds-api.ts";
import { day } from "./parts.tsx";

export function CreditHeldTab(_props: { role: Role }) {
  const toast = useToast();
  const [period, setPeriod] = useState<string | undefined>(undefined);
  // M6–M7 audit AU32: a page of the bounded scan can hold no row and still name a next one: read on by itself (with the line), never stop there.
  const [checking, setChecking] = useState(false);
  const list = useLoad(async () => {
    try {
      const first = await refundsApi.creditHeld(period ? { period } : {});
      return await readPastEmptyPages(
        (c) =>
          c === undefined
            ? Promise.resolve(first)
            : refundsApi.creditHeld({ period: first.period, cursor: c }),
        undefined,
        { onEmpty: () => setChecking(true) },
      );
    } finally {
      setChecking(false);
    }
  }, period ?? "");
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
      const r = await readPastEmptyPages(
        (c) => refundsApi.creditHeld({ period: shown, cursor: c as string }),
        cursor,
        {
          onEmpty: () => setChecking(true),
        },
      );
      setMore((m) => [...m, ...r.items.filter((x) => !m.some((y) => y.paymentId === x.paymentId))]);
      // AU32: the server's `next` whatever the page held (an empty page is not the end)
      setNext(r.next);
    } catch (e) {
      toast("error", payErrorText(e));
    } finally {
      setLoading(false);
      setChecking(false);
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
        <span className="rf-state">
          <Link to={`/payments/${encodeURIComponent(r.paymentId)}`} className="tnum">
            {day(r.receivedOn)}
          </Link>
          {/* second review, M1 (L48): on this period's list by the day the money arrived, confirmed later */}
          {r.confirmedAfter && <span className="pay-lines__meta">{ZO_UI.creditHeldConfirmedAfter}</span>}
        </span>
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
      <p className="hint rf-tab__lede">{ZO_UI.creditHeldLede}</p>
      {options.length > 0 && (
        <div className="rf-tab__period">
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
        </div>
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
              // AU32: only when no next page is left; otherwise the table stays with "Show more" below
              showsEmpty(rows.length, cursor) ? (
                <EmptyState icon={<Wallet />} title={ZO_UI.creditHeldEmpty.replace(/\.$/, "")}>
                  {null}
                </EmptyState>
              ) : undefined
            }
          />
        </div>
      )}
      {checking && (
        <p className="hint" role="status">
          {CHECKING_OLDER_LINE}
        </p>
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
