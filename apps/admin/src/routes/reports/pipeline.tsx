// Pipeline and win rate (M7.3; ADM-REP-03; run file C3, G; copy C3, C14 to C16, C20, C24): the leads created in a range (at most 366 days, no earlier than
// 12 months back: leads are deleted 12 months after their last activity, RB-10, Q3 A), as stat tiles with a meter for the two rates, ranked bars for stages,
// lost reasons and sources, a one-hue histogram of the time to win, the open leads by day from the nightly counts, the pages leads came from, and the offers
// sent in the range (USD offers in USD: Q1 A). Counts and paths only; no lead's name, email or company reaches this screen (DPDP minimisation). The range is
// in the URL; "Export CSV" writes the figures on screen (L6: no code asked).
import { pipelineEarliest, type PipelineReport as Report, TIME_TO_WIN_BANDS } from "@techaust/core/reports";
import type { ReactNode } from "react";
import type { Currency } from "../../api.ts";
import { ChartFrame, ColumnChart, LineChart, RankedBars, StatTile } from "../../components/chart/index.ts";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { EmptyState } from "../../components/display.tsx";
import { Inbox } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { moneyText, STATUS_LABELS } from "../../lib/documents.ts";
import { LOST_REASON_LABELS, SOURCE_LABELS, STAGE_LABELS } from "../../lib/leads.ts";
import { m73Api } from "../../lib/m73-api.ts";
import { BAND_LABELS, M73_TITLES, PIPELINE_COPY as P, pipelineCsv, rateText } from "../../lib/m73-reports.ts";
import { todayIst } from "../../lib/payments.ts";
import { isoDayText } from "../../lib/reports.ts";
import { ReportFrame } from "./frame.tsx";
import { ExportButton, ReportSkeleton, TableView, useFilters } from "./m73-parts.tsx";
import { RangeForm } from "./parts.tsx";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const STAGE_ORDER = ["new", "qualified", "proposal_sent", "won", "lost"] as const;

/** The server's own words for a refused range (report-delivery.ts RANGE_ERRORS; the last is C15), said before asking. */
function rangeCheck(from: string, to: string, today: string): string | null {
  if (!ISO.test(from) || !ISO.test(to) || from > to) return P.rangeInvalid;
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  if (days > 366) return P.rangeTooLong;
  if (from < pipelineEarliest(today)) return P.retention;
  return null;
}

export function PipelineReport() {
  const { params, set } = useFilters();
  const today = todayIst();
  const f = params.get("from") ?? "";
  const t = params.get("to") ?? "";
  const from = ISO.test(f) ? f : `${today.slice(0, 7)}-01`;
  const to = ISO.test(t) ? t : today;
  const report = useLoad(() => m73Api.pipeline(from, to), `${from}|${to}`);
  return (
    <ReportFrame title={M73_TITLES.pipeline} lede={P.retention}>
      <div className="m73-filters m73-filters--range">
        <RangeForm
          key={`${from}|${to}`}
          idPrefix="pipe"
          from={from}
          to={to}
          max={today}
          labels={{ from: P.from, to: P.to, submit: P.show }}
          busy={report.state === "loading"}
          check={(a, b) => rangeCheck(a, b, today)}
          onSubmit={(a, b) => set({ from: a, to: b })}
        />
      </div>
      {report.state === "failed" ? (
        <LoadFailed error={report.error} onRetry={() => report.reload()} />
      ) : report.state === "loading" ? (
        <ReportSkeleton label={`Loading ${M73_TITLES.pipeline.toLowerCase()}`} />
      ) : (
        <Body r={report.data} />
      )}
    </ReportFrame>
  );
}

function Body({ r }: { r: Report }) {
  const L = r.leads;
  const O = r.offers;
  const decided = O.accepted + O.rejected + O.expired;
  const noLeads = L.created === 0;
  const csvRows = (): [string, string, string][] => [
    [P.leads, "", String(L.created)],
    [P.won, "", String(L.won)],
    [P.conversion, "", L.conversionBp === null ? "" : rateText(L.conversionBp)],
    [P.winRate, "", O.winRateBp === null ? "" : rateText(O.winRateBp)],
    [P.medianToWin, "", O.timeToWin.medianDays === null ? "" : String(O.timeToWin.medianDays)],
    ...STAGE_ORDER.map((s): [string, string, string] => [
      P.byStage,
      STAGE_LABELS[s],
      String(L.byStage[s] ?? 0),
    ]),
    ...Object.entries(L.lostByReason).map(([k, v]): [string, string, string] => [
      P.lostReasons,
      LOST_REASON_LABELS[k as keyof typeof LOST_REASON_LABELS] ?? k,
      String(v),
    ]),
    ...Object.entries(L.bySource).map(([k, v]): [string, string, string] => [
      P.bySource,
      SOURCE_LABELS[k as keyof typeof SOURCE_LABELS] ?? k,
      String(v),
    ]),
    ...L.topPaths.map((p): [string, string, string] => [
      P.topPaths,
      p.path ?? P.noPage,
      `${p.created} / ${p.won}`,
    ]),
    ...TIME_TO_WIN_BANDS.map((b): [string, string, string] => [
      P.timeToWin,
      BAND_LABELS[b],
      String(O.timeToWin.bands[b]),
    ]),
    ...O.sent.map((s): [string, string, string] => [
      P.offersSent,
      `${STATUS_LABELS[s.status as keyof typeof STATUS_LABELS] ?? s.status} (${s.currency})`,
      `${s.count} / ${moneyText(s.taxableMinor, s.currency)}`,
    ]),
    ...r.openTrend.map((p): [string, string, string] => [P.openTrend, p.date, String(p.open)]),
  ];
  return (
    <div className="m73-stack">
      <div className="m73-block__head m73-block__head--end">
        <ExportButton<[string, string, string]>
          local
          read={async () => csvRows()}
          build={pipelineCsv}
          filename={`pipeline-${r.from}-to-${r.to}.csv`}
          progress={() => ""}
        />
      </div>
      <dl className="chart-stats">
        <StatTile label={P.leads} value={L.created} />
        <StatTile label={P.won} value={L.won} />
        <StatTile
          label={P.conversion}
          value={L.conversionBp === null ? P.noConversion : rateText(L.conversionBp)}
          words={L.conversionBp === null}
          sub={L.conversionBp === null ? undefined : P.ofLeads(L.won, L.created)}
          meterBp={L.conversionBp}
        />
        <StatTile
          label={P.winRate}
          value={O.winRateBp === null ? P.noRate : rateText(O.winRateBp)}
          words={O.winRateBp === null}
          sub={O.winRateBp === null ? undefined : P.ofDecided(O.accepted, decided)}
          meterBp={O.winRateBp}
        />
        <StatTile
          label={P.medianToWin}
          words={O.timeToWin.medianDays === null}
          value={O.timeToWin.medianDays === null ? P.noMedian : P.days(O.timeToWin.medianDays)}
          sub={O.timeToWin.count > 0 ? P.wins(O.timeToWin.count) : undefined}
        />
      </dl>
      {noLeads ? (
        <div className="report-empty">
          <EmptyState icon={<Inbox />} title={P.empty.replace(/\.$/, "")} headingLevel={2}>
            {null}
          </EmptyState>
        </div>
      ) : (
        <div className="m73-grid">
          <Counted
            id="pipe-stage"
            title={P.byStage}
            empty={P.empty}
            keepOrder
            rows={STAGE_ORDER.map((s) => ({ key: s, label: STAGE_LABELS[s], n: L.byStage[s] ?? 0 }))}
          />
          <Counted
            id="pipe-lost"
            title={P.lostReasons}
            empty={P.emptyLost}
            rows={Object.entries(L.lostByReason)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => ({
                key: k,
                label: LOST_REASON_LABELS[k as keyof typeof LOST_REASON_LABELS] ?? k,
                n,
              }))}
          />
          <Counted
            id="pipe-source"
            title={P.bySource}
            empty={P.emptySources}
            rows={Object.entries(L.bySource).map(([k, n]) => ({
              key: k,
              label: SOURCE_LABELS[k as keyof typeof SOURCE_LABELS] ?? k,
              n,
            }))}
          />
          <TimeToWin r={r} />
        </div>
      )}
      <OpenTrend r={r} />
      {L.topPaths.length > 0 && <TopPaths r={r} />}
      <OffersSent r={r} />
    </div>
  );
}

type CountRow = { key: string; label: string; n: number };

/** Counts as ranked bars (or in their own order), with the same counts as a table behind "Show as a table"; `empty` says what the block lacks (finding 1). */
function Counted(props: { id: string; title: string; empty: string; rows: CountRow[]; keepOrder?: boolean }) {
  const columns: Column<CountRow>[] = [
    { key: "label", header: props.title, card: "title", cell: (r) => r.label },
    { key: "n", header: P.created, align: "end", cell: (r) => <span className="tnum">{r.n}</span> },
  ];
  return (
    <ChartFrame id={props.id} title={props.title}>
      {props.rows.length === 0 ? (
        <p className="m73-note">{props.empty}</p>
      ) : (
        <>
          <RankedBars
            label={props.title}
            valueLabel={P.created}
            keepOrder={props.keepOrder}
            data={props.rows.map((r) => ({ key: r.key, label: r.label, value: r.n, valueText: String(r.n) }))}
          />
          <TableView>
            <DataTable caption={props.title} columns={columns} rows={props.rows} rowKey={(r) => r.key} />
          </TableView>
        </>
      )}
    </ChartFrame>
  );
}

function TimeToWin({ r }: { r: Report }) {
  const t = r.offers.timeToWin;
  const rows = TIME_TO_WIN_BANDS.map((b) => ({ key: b, label: BAND_LABELS[b], n: t.bands[b] }));
  const columns: Column<CountRow>[] = [
    { key: "label", header: P.band, card: "title", cell: (x) => x.label },
    { key: "n", header: P.won, align: "end", cell: (x) => <span className="tnum">{x.n}</span> },
  ];
  return (
    <ChartFrame id="pipe-ttw" title={P.timeToWin}>
      {t.count === 0 ? (
        <p className="m73-note">{P.emptyWins}</p>
      ) : (
        <>
          <ColumnChart
            label={P.timeToWin}
            data={rows.map((x) => ({ key: x.key, label: x.label, name: x.label, values: [x.n] }))}
            series={[{ tone: "a", label: P.won }]}
            format={(v) => String(v)}
            capLabels
          />
          <TableView>
            <DataTable caption={P.timeToWin} columns={columns} rows={rows} rowKey={(x) => x.key} />
          </TableView>
        </>
      )}
    </ChartFrame>
  );
}

function OpenTrend({ r }: { r: Report }) {
  const columns: Column<{ date: string; open: number }>[] = [
    { key: "date", header: P.date, card: "title", cell: (p) => isoDayText(p.date) },
    { key: "open", header: P.open, align: "end", cell: (p) => <span className="tnum">{p.open}</span> },
  ];
  return (
    <ChartFrame id="pipe-trend" title={P.openTrend}>
      {r.openTrend.length === 0 ? (
        <p className="m73-note">{P.noTrend}</p>
      ) : (
        <>
          <LineChart
            from={r.from}
            to={r.to}
            points={r.openTrend.map((p) => ({ date: p.date, value: p.open }))}
            label={`${P.openTrend}, ${isoDayText(r.from)} to ${isoDayText(r.to)}`}
            valueLabel={P.open}
            dayText={isoDayText}
            axisDay={(d) => isoDayText(d).slice(0, 6)}
          />
          <TableView>
            <DataTable caption={P.openTrend} columns={columns} rows={r.openTrend} rowKey={(p) => p.date} />
          </TableView>
        </>
      )}
    </ChartFrame>
  );
}

function TopPaths({ r }: { r: Report }) {
  type Row = Report["leads"]["topPaths"][number];
  const columns: Column<Row>[] = [
    {
      key: "path",
      header: P.page,
      card: "title",
      cell: (p) => (p.path ? <span className="docno break">{p.path}</span> : P.noPage),
    },
    {
      key: "created",
      header: P.created,
      align: "end",
      cell: (p) => <span className="tnum">{p.created}</span>,
    },
    { key: "won", header: P.won, align: "end", cell: (p) => <span className="tnum">{p.won}</span> },
  ];
  return (
    <div className="m73-block">
      <h2 id="pipe-paths" className="report-sub">
        {P.topPaths}
      </h2>
      <div className="m73-table">
        <DataTable
          caption={P.topPaths}
          columns={columns}
          rows={r.leads.topPaths}
          rowKey={(p) => p.path ?? "-"}
        />
      </div>
    </div>
  );
}

function OffersSent({ r }: { r: Report }) {
  type Row = Report["offers"]["sent"][number] & { key: string };
  const rows: Row[] = r.offers.sent.map((s) => ({ ...s, key: `${s.status}-${s.currency}` }));
  const usd = rows.some((s) => s.currency === "USD");
  const columns: Column<Row>[] = [
    {
      key: "status",
      header: P.status,
      card: "title",
      cell: (s) => STATUS_LABELS[s.status as keyof typeof STATUS_LABELS] ?? s.status,
    },
    { key: "currency", header: P.currency, cell: (s) => <span className="docno">{s.currency}</span> },
    { key: "count", header: P.count, align: "end", cell: (s) => <span className="tnum">{s.count}</span> },
    {
      key: "value",
      header: P.value,
      align: "end",
      cell: (s) => <span className="tnum">{moneyText(s.taxableMinor, s.currency as Currency)}</span>,
    },
  ];
  return (
    <div className="m73-block">
      <h2 id="pipe-offers" className="report-sub">
        {P.offersSent}
      </h2>
      <dl className="m73-facts">
        <Fact label={P.accepted} value={r.offers.accepted} />
        <Fact label={P.declined} value={r.offers.rejected} />
        <Fact label={P.expired} value={r.offers.expired} />
      </dl>
      <div className="m73-table">
        <DataTable
          caption={P.offersSent}
          columns={columns}
          rows={rows}
          rowKey={(s) => s.key}
          empty={<p className="m73-note">{P.noOffers}</p>}
        />
      </div>
      {usd && <p className="m73-note">{P.usdNote}</p>}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="tnum m73-facts__value">{value}</dd>
    </div>
  );
}
