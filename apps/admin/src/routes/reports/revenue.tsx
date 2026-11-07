// Revenue and collections (M7.3; ADM-REP-01, -06; run file C1, C2, C6, G; copy C1, C5 to C11, C20, C21): one financial year, by month (invoiced against
// collected, paired columns of one hue in two steps), by service category (ranked bars, invoiced only: Q2 A) or by kind of work (one segmented bar), always
// for one currency (never rupees and dollars together; "Total in INR" only from frozen INR values, L4), then the clients of that year and currency with
// "Show more" and "Export CSV" (a fresh code, one audited request per page). Every chart has its table below it. The filters sit in one row above, in the URL.
import { formatMoney, money } from "@techaust/core";
import { REVENUE_KINDS } from "@techaust/core/reports";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { Currency } from "../../api.ts";
import {
  ChartFrame,
  ColumnChart,
  Legend,
  RankedBars,
  SegmentedBar,
  type Tone,
} from "../../components/chart/index.ts";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { EmptyState } from "../../components/display.tsx";
import { BarChart, Receipt } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { CATEGORY_LABELS } from "../../lib/catalogue.ts";
import { moneyText } from "../../lib/documents.ts";
import {
  m73Api,
  type RevenueByKey,
  type RevenueByMonth,
  type RevenueClientRow,
  type RevenueView,
  readPages,
} from "../../lib/m73-api.ts";
import {
  CATEGORY_ORDER,
  categoryLabel,
  collectedOf,
  fyLabel,
  type Invoiced,
  invoicedOf,
  KIND_LABELS,
  M73_TITLES,
  monthName,
  monthShort,
  REVENUE_COPY as R,
  revenueClientsCsv,
  sumMinor,
  yearInInr,
} from "../../lib/m73-reports.ts";
import { fyChoices, PAY_UI } from "../../lib/payments.ts";
import { reportErrorText } from "../../lib/reports.ts";
import { ReportFrame } from "./frame.tsx";
import {
  ExportButton,
  FilterRow,
  FilterSelect,
  FilterSwitch,
  Money,
  ReportSkeleton,
  useFilters,
} from "./m73-parts.tsx";

const VIEWS: readonly RevenueView[] = ["month", "category", "kind"];
/** An axis figure in whole units (the ticks are whole units: `minStep` 100), through core. */
const whole = (currency: Currency) => (v: number) => formatMoney(money(v, currency), { wholeUnits: true });

export function RevenueReport() {
  const { params, set } = useFilters();
  const choices = fyChoices();
  const fyParam = params.get("fy") ?? "";
  const fy = choices.some((c) => c.token === fyParam) ? fyParam : (choices[0]?.token ?? "");
  const byParam = params.get("by");
  const view: RevenueView = VIEWS.includes(byParam as RevenueView) ? (byParam as RevenueView) : "month";
  const report = useLoad(() => m73Api.revenue(fy, view), `${fy}|${view}`);
  const present = report.state === "ready" ? currenciesOf(report.data) : [];
  const curParam = params.get("currency");
  const currency: Currency =
    curParam === "USD" || curParam === "INR"
      ? curParam
      : present.includes("INR") || present.length === 0
        ? "INR"
        : "USD";
  const both = present.length > 1 || curParam === "USD";

  return (
    <ReportFrame title={M73_TITLES.revenue} lede={R.lede}>
      <FilterRow>
        <FilterSelect
          label={PAY_UI.fy}
          value={fy}
          options={choices.map((c) => ({ value: c.token, label: c.label }))}
          onChange={(v) => set({ fy: v })}
        />
        <FilterSwitch
          legend={R.view}
          value={view}
          options={[
            { value: "month", label: R.byMonth },
            { value: "category", label: R.byCategory },
            { value: "kind", label: R.byKind },
          ]}
          onChange={(v) => set({ by: v === "month" ? null : v })}
        />
        {both && (
          <FilterSwitch<Currency>
            legend={R.currency}
            value={currency}
            options={[
              { value: "INR", label: "INR" },
              { value: "USD", label: "USD" },
            ]}
            onChange={(v) => set({ currency: v === "INR" ? null : v })}
          />
        )}
      </FilterRow>
      {report.state === "failed" ? (
        <LoadFailed error={report.error} onRetry={() => report.reload()} />
      ) : report.state === "loading" ? (
        <ReportSkeleton label={`Loading ${M73_TITLES.revenue.toLowerCase()}`} />
      ) : present.length === 0 ? (
        <div className="report-empty">
          <EmptyState icon={<Receipt />} title={R.empty(fyLabel(fy)).replace(/\.$/, "")}>
            <p>{R.lede}</p>
          </EmptyState>
        </div>
      ) : (
        <div className="m73-stack">
          {report.data.by === "month" ? (
            <MonthsView data={report.data as RevenueByMonth} currency={currency} fy={fy} />
          ) : report.data.by === "category" ? (
            <CategoryView data={report.data as RevenueByKey} currency={currency} fy={fy} />
          ) : (
            <KindView data={report.data as RevenueByKey} currency={currency} fy={fy} />
          )}
          <ClientsBlock fy={fy} currency={currency} />
        </div>
      )}
    </ReportFrame>
  );
}

/** The currencies the year has any figure in, INR first. */
function currenciesOf(d: RevenueByMonth | RevenueByKey): Currency[] {
  const set = new Set<Currency>();
  if (d.by === "month")
    for (const m of (d as RevenueByMonth).months) {
      for (const i of m.invoiced) set.add(i.currency);
      for (const c of m.collected) set.add(c.currency);
    }
  else for (const r of (d as RevenueByKey).rows) for (const i of r.invoiced) set.add(i.currency);
  return (["INR", "USD"] as const).filter((c) => set.has(c));
}

function NothingIn({ currency, fy }: { currency: Currency; fy: string }) {
  return (
    <div className="report-empty">
      <EmptyState
        icon={<Receipt />}
        title={R.emptyCurrency(currency, fyLabel(fy)).replace(/\.$/, "")}
        headingLevel={2}
      >
        {null}
      </EmptyState>
    </div>
  );
}

// ---- by month --------------------------------------------------------------------------------------------------------------------------------------------

type MonthRow = {
  key: string;
  label: string;
  inv: Invoiced;
  col: ReturnType<typeof collectedOf>;
};

function MonthsView({ data, currency, fy }: { data: RevenueByMonth; currency: Currency; fy: string }) {
  const rows: MonthRow[] = data.months.map((m) => ({
    key: m.month,
    label: monthName(m.month),
    inv: invoicedOf(m.invoiced, currency),
    col: collectedOf(m.collected, currency),
  }));
  // a currency with only a refund in the year still has a figure to show (review 1, finding 9)
  const any = rows.some(
    (r) => r.inv.count > 0 || r.col.payments > 0 || r.col.tdsMinor !== 0 || r.col.refundedMinor !== 0,
  );
  if (!any) return <NothingIn currency={currency} fy={fy} />;
  const usd = currency === "USD";
  const s = (pick: (r: MonthRow) => number) => sumMinor(rows.map(pick), currency);
  const inrOf = (pick: (r: MonthRow) => number | null) => {
    const v = rows.map(pick);
    return v.some((x) => x === null) ? null : sumMinor(v as number[], "INR");
  };
  const total: MonthRow = {
    key: "total",
    label: R.fyTotal(fyLabel(fy)),
    inv: {
      currency,
      count: rows.reduce((n, r) => n + r.inv.count, 0),
      taxableMinor: s((r) => r.inv.taxableMinor),
      totalMinor: s((r) => r.inv.totalMinor),
      inrTaxableMinor: inrOf((r) => r.inv.inrTaxableMinor),
      inrTotalMinor: inrOf((r) => r.inv.inrTotalMinor),
      inrMissing: rows.reduce((n, r) => n + r.inv.inrMissing, 0),
    },
    col: {
      currency,
      payments: rows.reduce((n, r) => n + r.col.payments, 0),
      receivedMinor: s((r) => r.col.receivedMinor),
      refundedMinor: s((r) => r.col.refundedMinor),
      collectedMinor: s((r) => r.col.collectedMinor),
      tdsMinor: s((r) => r.col.tdsMinor),
      inrCollectedMinor: inrOf((r) => r.col.inrCollectedMinor),
      inrMissing: rows.reduce((n, r) => n + r.col.inrMissing, 0),
    },
  };
  const columns: Column<MonthRow>[] = [
    { key: "month", header: R.month, card: "title", cell: (r) => r.label },
    {
      key: "before",
      header: R.invoicedBefore,
      align: "end",
      cell: (r) => (
        <Money minor={r.inv.taxableMinor} currency={currency} inr={usd ? r.inv.inrTaxableMinor : null} />
      ),
    },
    {
      key: "with",
      header: R.invoicedWith,
      align: "end",
      cell: (r) => (
        <Money minor={r.inv.totalMinor} currency={currency} inr={usd ? r.inv.inrTotalMinor : null} />
      ),
    },
    {
      key: "collected",
      header: R.collected,
      align: "end",
      cell: (r) => (
        <Money minor={r.col.collectedMinor} currency={currency} inr={usd ? r.col.inrCollectedMinor : null} />
      ),
    },
    {
      key: "tds",
      header: R.tds,
      align: "end",
      cell: (r) => <Money minor={r.col.tdsMinor} currency={currency} />,
    },
    {
      key: "refunded",
      header: R.refunded,
      align: "end",
      cell: (r) => <Money minor={r.col.refundedMinor} currency={currency} />,
    },
  ];
  const title = R.chartMonths(currency);
  return (
    <>
      <ChartFrame
        id="rev-months"
        title={title}
        legend={
          <Legend
            items={[
              { tone: "a", label: R.invoicedWith },
              { tone: "b", label: R.collected },
            ]}
          />
        }
      >
        <ColumnChart
          label={title}
          data={rows.map((r) => ({
            key: r.key,
            label: monthShort(r.key),
            name: r.label,
            values: [r.inv.totalMinor, r.col.collectedMinor],
          }))}
          series={[
            { tone: "a", label: R.invoicedWith },
            { tone: "b", label: R.collected },
          ]}
          format={(v) => moneyText(v, currency)}
          tickFormat={whole(currency)}
          minStep={100}
        />
      </ChartFrame>
      <div className="m73-table m73-table--cards">
        <DataTable caption={title} columns={columns} rows={rows} rowKey={(r) => r.key} totals={[total]} />
      </div>
      <InrLines data={data} currency={currency} />
    </>
  );
}

/**
 * Under the months: C6 (what the INR equivalents are) in the USD view, and "Total in INR" across both currencies when the year has both: each figure shown only
 * when every USD figure has its INR value; otherwise its line says how many lack one (invoices: the lead's Q3 line from `inrMissing`; payments and refunds: C7).
 */
function InrLines({ data, currency }: { data: RevenueByMonth; currency: Currency }) {
  const t = yearInInr(data.months);
  if (!t.usd) return null;
  const { invInr, colInr, invMissing, missing } = t;
  return (
    <div className="m73-inr">
      {t.inr && (invInr !== null || colInr !== null) && (
        <div className="m73-inr__figures">
          <p className="m73-inr__head" id="rev-inr-h">
            {R.totalInInr}
          </p>
          <dl className="m73-inr__list" aria-labelledby="rev-inr-h">
            {invInr !== null && (
              <div>
                <dt>{R.invoicedWith}</dt>
                <dd className="tnum m73-inr__value">{moneyText(invInr, "INR")}</dd>
              </div>
            )}
            {colInr !== null && (
              <div>
                <dt>{R.collected}</dt>
                <dd className="tnum m73-inr__value">{moneyText(colInr, "INR")}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
      {invMissing > 0 && <p className="m73-note">{R.invoicedInrMissing(invMissing)}</p>}
      {missing > 0 && <p className="m73-note">{R.inrMissing(missing)}</p>}
      {(currency === "USD" || t.inr) && <p className="m73-note">{R.inrNote}</p>}
    </div>
  );
}

// ---- by category -----------------------------------------------------------------------------------------------------------------------------------------

type KeyRow = { key: string; label: string; inv: Invoiced; round?: boolean };

function keyedRows(
  data: RevenueByKey,
  currency: Currency,
  label: (k: string) => string,
  order: readonly string[],
) {
  return data.rows
    .map((r) => ({ key: r.key, label: label(r.key), inv: invoicedOf(r.invoiced, currency) }))
    .filter((r) => r.inv.count > 0)
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

function totalOf(rows: readonly KeyRow[], currency: Currency, label: string, extra = 0): KeyRow {
  return {
    key: "total",
    label,
    inv: {
      currency,
      count: rows.reduce((n, r) => n + r.inv.count, 0),
      taxableMinor: sumMinor(
        rows.map((r) => r.inv.taxableMinor),
        currency,
      ),
      totalMinor: sumMinor([...rows.map((r) => r.inv.totalMinor), extra], currency),
      // The total row never prints an INR figure (an INR total comes only through the "Total in INR" line), so its INR stays null whatever the
      // rows hold; `inrMissing` carries the rows' count for that line (re-check low 2: a deliberate exception to core's rule).
      inrTaxableMinor: null,
      inrTotalMinor: null,
      inrMissing: rows.reduce((n, r) => n + r.inv.inrMissing, 0),
    },
  };
}

function keyColumns(first: string, countHeader: string, currency: Currency): Column<KeyRow>[] {
  const usd = currency === "USD";
  return [
    { key: "key", header: first, card: "title", cell: (r) => r.label },
    {
      key: "count",
      header: countHeader,
      align: "end",
      cell: (r) =>
        r.round ? (
          <span className="m73-zero" aria-hidden="true">
            –
          </span>
        ) : (
          <span className="tnum">{r.inv.count}</span>
        ),
    },
    {
      key: "before",
      header: R.invoicedBefore,
      align: "end",
      cell: (r) =>
        r.round ? (
          <span className="m73-zero" aria-hidden="true">
            –
          </span>
        ) : (
          <Money minor={r.inv.taxableMinor} currency={currency} inr={usd ? r.inv.inrTaxableMinor : null} />
        ),
    },
    {
      key: "with",
      header: R.invoicedWith,
      align: "end",
      cell: (r) => (
        <Money minor={r.inv.totalMinor} currency={currency} inr={usd ? r.inv.inrTotalMinor : null} />
      ),
    },
  ];
}

function CategoryView({ data, currency, fy }: { data: RevenueByKey; currency: Currency; fy: string }) {
  const rows = keyedRows(data, currency, (k) => categoryLabel(k, CATEGORY_LABELS), CATEGORY_ORDER);
  if (rows.length === 0) return <NothingIn currency={currency} fy={fy} />;
  const round = data.roundOff?.find((r) => r.currency === currency);
  const roundRow: KeyRow | null =
    round && round.roundOffMinor !== 0
      ? {
          key: "round-off",
          label: R.roundOff,
          round: true,
          inv: {
            currency,
            count: 0,
            taxableMinor: 0,
            totalMinor: round.roundOffMinor,
            inrTaxableMinor: null,
            inrTotalMinor: round.inrRoundOffMinor,
            // core's rule: above 0 exactly when an INR figure is null (re-check low 2)
            inrMissing: round.inrRoundOffMinor === null ? 1 : 0,
          },
        }
      : null;
  const title = R.chartCategories(currency);
  return (
    <>
      <ChartFrame id="rev-categories" title={title} note={R.categoryNote}>
        <RankedBars
          label={title}
          valueLabel={R.invoicedBefore}
          data={rows.map((r) => ({
            key: r.key,
            label: r.label,
            value: r.inv.taxableMinor,
            valueText: moneyText(r.inv.taxableMinor, currency),
            more: [{ value: String(r.inv.count), label: R.lines.toLowerCase() }],
          }))}
        />
      </ChartFrame>
      <div className="m73-table m73-table--cards">
        <DataTable
          caption={title}
          columns={keyColumns(R.category, R.lines, currency)}
          rows={roundRow ? [...rows, roundRow] : rows}
          rowKey={(r) => r.key}
          totals={[totalOf(rows, currency, R.fyTotal(fyLabel(fy)), round?.roundOffMinor ?? 0)]}
        />
      </div>
    </>
  );
}

// ---- by kind of work --------------------------------------------------------------------------------------------------------------------------------------

const KIND_TONES: Record<string, Tone> = { recurring: "k1", project: "k2", other: "k3" };

function KindView({ data, currency, fy }: { data: RevenueByKey; currency: Currency; fy: string }) {
  const rows = keyedRows(
    data,
    currency,
    (k) => KIND_LABELS[k as keyof typeof KIND_LABELS] ?? k,
    REVENUE_KINDS,
  );
  if (rows.length === 0) return <NothingIn currency={currency} fy={fy} />;
  const title = R.chartKinds(currency);
  const negative = rows.some((r) => r.inv.taxableMinor < 0);
  return (
    <>
      <ChartFrame
        id="rev-kinds"
        title={title}
        legend={
          <Legend
            items={rows
              .filter((r) => r.inv.taxableMinor > 0)
              .map((r) => ({ tone: KIND_TONES[r.key] ?? "n", label: r.label }))}
          />
        }
      >
        {!negative && (
          <SegmentedBar
            size="tall"
            label={title}
            parts={rows.map((r) => ({
              key: r.key,
              label: r.label,
              tone: KIND_TONES[r.key] ?? "n",
              value: r.inv.taxableMinor,
              valueText: moneyText(r.inv.taxableMinor, currency),
            }))}
          />
        )}
      </ChartFrame>
      <div className="m73-table m73-table--cards">
        <DataTable
          caption={title}
          columns={keyColumns(R.kind, R.documents, currency)}
          rows={rows}
          rowKey={(r) => r.key}
          totals={[totalOf(rows, currency, R.fyTotal(fyLabel(fy)))]}
        />
      </div>
    </>
  );
}

// ---- by client (C2) ---------------------------------------------------------------------------------------------------------------------------------------

function ClientsBlock({ fy, currency }: { fy: string; currency: Currency }) {
  const first = useLoad(() => m73Api.revenueClients(fy, currency), `${fy}|${currency}`);
  const [more, setMore] = useState<RevenueClientRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  // A "Show more" answer belongs to the list it was asked for: a change of year or currency starts a new list, and a late page of the old one is dropped
  // (review 1, finding 13).
  const listRun = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new first page starts the list again
  useEffect(() => {
    listRun.current++;
    setMore([]);
    setMoreError(null);
    setLoadingMore(false);
    setNext(first.state === "ready" ? first.data.next : null);
  }, [first.state, fy, currency]);
  const rows = first.state === "ready" ? [...first.data.rows, ...more] : [];
  const usd = currency === "USD";
  async function showMore() {
    if (!next) return;
    const run = listRun.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const p = await m73Api.revenueClients(fy, currency, next);
      if (run !== listRun.current) return;
      setMore((m) => [...m, ...p.rows]);
      setNext(p.next);
    } catch (e) {
      if (run === listRun.current) setMoreError(reportErrorText(e));
    } finally {
      if (run === listRun.current) setLoadingMore(false);
    }
  }
  const columns: Column<RevenueClientRow>[] = [
    {
      key: "client",
      header: R.client,
      card: "title",
      cell: (r) => (
        <span className="m73-client">
          <Link to={`/clients/${encodeURIComponent(r.client.id)}`} className="m73-client__link">
            {r.client.name}
          </Link>
          <span className="docno m73-client__code">{r.client.code}</span>
        </span>
      ),
    },
    {
      key: "before",
      header: R.invoicedBefore,
      align: "end",
      cell: (r) => (
        <Money
          minor={r.invoiced.taxableMinor}
          currency={currency}
          inr={usd ? r.invoiced.inrTaxableMinor : null}
        />
      ),
    },
    {
      key: "with",
      header: R.invoicedWith,
      align: "end",
      cell: (r) => (
        <Money
          minor={r.invoiced.totalMinor}
          currency={currency}
          inr={usd ? r.invoiced.inrTotalMinor : null}
        />
      ),
    },
    {
      key: "collected",
      header: R.collected,
      align: "end",
      cell: (r) => (
        <Money
          minor={r.collected.collectedMinor}
          currency={currency}
          inr={usd ? r.collected.inrCollectedMinor : null}
        />
      ),
    },
    {
      key: "tds",
      header: R.tds,
      align: "end",
      cell: (r) => <Money minor={r.collected.tdsMinor} currency={currency} />,
    },
    {
      key: "refunded",
      header: R.refunded,
      align: "end",
      cell: (r) => <Money minor={r.collected.refundedMinor} currency={currency} />,
    },
  ];
  const caption = `${R.perClient}, ${currency}`;
  return (
    <div className="m73-block">
      <div className="m73-block__head">
        <h2 id="rev-clients-h" className="report-sub">
          {caption}
        </h2>
        {rows.length > 0 && (
          <ExportButton<RevenueClientRow>
            read={async (onProgress, stopped) => {
              const r = await readPages(
                (after) => m73Api.revenueExport(fy, currency, after),
                onProgress,
                stopped,
              );
              return r ? r.rows : null;
            }}
            build={(all) => revenueClientsCsv(all, currency)}
            filename={`revenue-by-client-FY${fyLabel(fy)}-${currency}.csv`}
            progress={R.exporting}
          />
        )}
      </div>
      {first.state === "failed" ? (
        <LoadFailed error={first.error} onRetry={() => first.reload()} headingLevel={3} />
      ) : (
        <div className="m73-table m73-table--cards">
          <DataTable
            caption={caption}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.client.id}
            loading={first.state === "loading"}
            skeletonRows={3}
            empty={
              <EmptyState
                icon={<BarChart />}
                title={R.empty(fyLabel(fy)).replace(/\.$/, "")}
                headingLevel={3}
              >
                {null}
              </EmptyState>
            }
          />
        </div>
      )}
      {next && (
        <div className="m73-more">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={showMore}
            disabled={loadingMore}
            aria-busy={loadingMore || undefined}
          >
            {R.showMore}
          </button>
        </div>
      )}
      {moreError && (
        <p className="m73-note m73-note--error" role="alert">
          {moreError}
        </p>
      )}
    </div>
  );
}
