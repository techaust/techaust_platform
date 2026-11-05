// Outstanding and ageing (M7.3; ADM-REP-02, -06; run file C9, C6, G; copy C2, C12, C13, C20, C21): what is owed as at today (IST), by client and currency,
// in the five buckets of days past due (L7: overdue means strictly before today), each client's credit held beside it and never taken off (RA-36), and a link
// to the client's statement. Above each currency's table, a thin segmented bar of its totals (the first page's `totals`): "not yet due" in the neutral grey,
// the overdue buckets on one hue darkening with age. Proformas and receipts are not here (LD78). "Show more" reads the next 50 clients; "Export CSV" asks for
// a fresh code and reads every page through the audited export twin.
import type { AgeingRow } from "@techaust/core/reports";
import { AGEING_BUCKETS, type AgeingBucket } from "@techaust/core/reports";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Currency } from "../../api.ts";
import { ChartFrame, Legend, SegmentedBar, type Tone } from "../../components/chart/index.ts";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { EmptyState } from "../../components/display.tsx";
import { CheckCircle } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { moneyText } from "../../lib/documents.ts";
import { type AgeingTotals, m73Api, readPages } from "../../lib/m73-api.ts";
import {
  AGEING_COPY as A,
  AGEING_LABELS,
  ageingCsv,
  M73_TITLES,
  REVENUE_COPY,
} from "../../lib/m73-reports.ts";
import { todayIst } from "../../lib/payments.ts";
import { isoDayText, reportErrorText } from "../../lib/reports.ts";
import { ReportFrame } from "./frame.tsx";
import { ExportButton, Money, ReportSkeleton } from "./m73-parts.tsx";

export const AGEING_TONES: Record<AgeingBucket, Tone> = {
  not_due: "n",
  d1_30: "s1",
  d31_60: "s2",
  d61_90: "s3",
  d90_plus: "s4",
};

export function AgeingReport() {
  const first = useLoad(() => m73Api.ageing(), "ageing");
  const [more, setMore] = useState<AgeingRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new first page starts the list again
  useEffect(() => {
    setMore([]);
    setNext(first.state === "ready" ? first.data.next : null);
  }, [first.state]);
  async function showMore() {
    if (!next) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const p = await m73Api.ageing(next);
      setMore((m) => [...m, ...p.rows]);
      setNext(p.next);
    } catch (e) {
      setMoreError(reportErrorText(e));
    } finally {
      setLoadingMore(false);
    }
  }
  const asOf = first.state === "ready" ? first.data.asOf : null;
  const rows = first.state === "ready" ? [...first.data.rows, ...more] : [];
  const totals = first.state === "ready" ? (first.data.totals ?? []) : [];
  const currencies = (["INR", "USD"] as const).filter(
    (c) => totals.some((t) => t.currency === c && t.totalMinor !== 0) || rows.some((r) => r.currency === c),
  );
  return (
    <ReportFrame title={M73_TITLES.ageing} lede={A.lede(isoDayText(asOf ?? todayIst()))}>
      {first.state === "failed" ? (
        <LoadFailed error={first.error} onRetry={() => first.reload()} />
      ) : first.state === "loading" ? (
        <ReportSkeleton label={`Loading ${M73_TITLES.ageing.toLowerCase()}`} />
      ) : currencies.length === 0 ? (
        <div className="report-empty">
          <EmptyState icon={<CheckCircle />} title={A.empty.replace(/\.$/, "")}>
            {null}
          </EmptyState>
        </div>
      ) : (
        <div className="m73-stack">
          <div className="m73-block__head m73-block__head--end">
            <ExportButton<AgeingRow>
              read={async (onProgress, stopped) => {
                const r = await readPages((after) => m73Api.ageingExport(after), onProgress, stopped);
                return r ? r.rows : null;
              }}
              build={(all) => ageingCsv(all, asOf ?? "", AGEING_BUCKETS)}
              filename={`outstanding-and-ageing-${asOf ?? "today"}.csv`}
              progress={REVENUE_COPY.exporting}
            />
          </div>
          {currencies.map((c) => (
            <CurrencyBlock
              key={c}
              currency={c}
              rows={rows.filter((r) => r.currency === c)}
              total={totals.find((t) => t.currency === c)}
            />
          ))}
          {next && (
            <div className="m73-more">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={showMore}
                disabled={loadingMore}
                aria-busy={loadingMore || undefined}
              >
                {REVENUE_COPY.showMore}
              </button>
            </div>
          )}
          {moreError && (
            <p className="m73-note m73-note--error" role="alert">
              {moreError}
            </p>
          )}
        </div>
      )}
    </ReportFrame>
  );
}

type Row = AgeingRow & { key: string; isTotal?: boolean };

function CurrencyBlock(props: { currency: Currency; rows: AgeingRow[]; total: AgeingTotals | undefined }) {
  const { currency, total } = props;
  const title = A.owedIn(currency);
  const parts = AGEING_BUCKETS.map((b) => ({
    key: b,
    label: AGEING_LABELS[b],
    tone: AGEING_TONES[b],
    value: total?.buckets[b].balanceMinor ?? 0,
    valueText: moneyText(total?.buckets[b].balanceMinor ?? 0, currency),
  }));
  const columns: Column<Row>[] = [
    {
      key: "client",
      header: A.client,
      card: "title",
      cell: (r) =>
        r.isTotal ? (
          A.allClients
        ) : (
          <span className="m73-client">
            <Link to={`/clients/${encodeURIComponent(r.client.id)}`} className="m73-client__link">
              {r.client.name}
            </Link>
            <span className="docno m73-client__code">{r.client.code}</span>
          </span>
        ),
    },
    ...AGEING_BUCKETS.map(
      (b): Column<Row> => ({
        key: b,
        header: AGEING_LABELS[b],
        align: "end",
        cell: (r) =>
          r.buckets[b].balanceMinor === 0 ? (
            <span className="m73-zero">{moneyText(0, currency)}</span>
          ) : (
            <Money minor={r.buckets[b].balanceMinor} currency={currency} />
          ),
      }),
    ),
    {
      key: "total",
      header: A.total,
      align: "end",
      cell: (r) => <Money minor={r.totalMinor} currency={currency} />,
    },
    {
      key: "credit",
      header: A.creditHeld,
      align: "end",
      cell: (r) =>
        r.isTotal ? (
          <span className="m73-zero" aria-hidden="true">
            –
          </span>
        ) : r.creditHeldMinor === 0 ? (
          <span className="m73-zero">{moneyText(0, currency)}</span>
        ) : (
          <Money minor={r.creditHeldMinor} currency={currency} />
        ),
    },
    {
      key: "statement",
      header: A.statement,
      cell: (r) =>
        r.isTotal ? (
          <span className="m73-zero" aria-hidden="true">
            –
          </span>
        ) : (
          <Link to={`/clients/${encodeURIComponent(r.client.id)}?tab=statement`} className="m73-statement">
            {A.openStatement}
            <span className="visually-hidden">: {r.client.name}</span>
          </Link>
        ),
    },
  ];
  const totalRow: Row | null = total
    ? {
        key: "total",
        isTotal: true,
        client: { id: "", code: "", name: A.allClients },
        currency,
        buckets: total.buckets,
        totalMinor: total.totalMinor,
        creditHeldMinor: 0,
      }
    : null;
  return (
    <div className="m73-block">
      <ChartFrame
        id={`age-${currency}`}
        title={title}
        className="chart--ageing"
        legend={
          <Legend items={parts.filter((p) => p.value > 0).map((p) => ({ tone: p.tone, label: p.label }))} />
        }
      >
        <p className="m73-ageing__total">
          <span className="m73-ageing__figure">{moneyText(total?.totalMinor ?? 0, currency)}</span>
        </p>
        <SegmentedBar size="thin" label={title} parts={parts} />
      </ChartFrame>
      <div className="m73-table m73-table--wide">
        <DataTable
          caption={title}
          columns={columns}
          rows={props.rows.map((r) => ({ ...r, key: `${r.client.id}-${r.currency}` }))}
          rowKey={(r) => r.key}
          totals={totalRow ? [totalRow] : []}
        />
      </div>
    </div>
  );
}
