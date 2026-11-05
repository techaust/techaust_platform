// The dashboard's finance tiles (M5.5b; ADM-DASH-01, LD80, Q52; Owner and Accountant): invoiced (this month and this financial year, before GST),
// outstanding, overdue (the five oldest), payment requests awaiting payment, and exports nearing a deadline (counts by stage and the next five). Stat
// tiles, not charts (dataviz: a handful of headline figures per currency is a number's job, and rupees and dollars are never added together); the
// figures are the API's, formatted through core, in text colours; a stage carries its reserved status colour only with its icon and words. The page
// asks once when it opens (no polling; reload to refresh). Collected figures arrive with payments (M6).
// M7.3 (C5, dashboard v2): the Invoiced and Collected tiles say how this month compares with the previous IST month in words (C22, per currency, the difference
// made in SQL); the Overdue tile draws each currency's overdue buckets as a thin segmented bar (the ageing report's form, with its legend) and links to the
// report when the role may read it.
import "./dashboard-finance.css";
import type { DashboardReportLinks } from "@techaust/core/reports";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { AgeingByCurrency, Currency, FinanceTile, OwedByCurrency } from "../api.ts";
import { Legend, SegmentedBar } from "../components/chart/index.ts";
import { StatusPill } from "../components/display.tsx";
import { AlertTriangle, CheckCircle, Clock, FileText, Receipt, Wallet } from "../components/icons.tsx";
import { DASH_COPY } from "../lib/dashboard.ts";
import { moneyText } from "../lib/documents.ts";
import { AGEING_LABELS, deltaText, M73_TITLES, monthName } from "../lib/m73-reports.ts";
import { PAY_COPY, PAY_UI } from "../lib/payments.ts";
import {
  documentHref,
  FINANCE_COPY as F,
  isoDayText,
  isStage,
  STAGE_LABELS,
  STAGE_PILLS,
} from "../lib/reports.ts";

/** The previous IST month's name ("October 2026"), the period of C22's comparison; null for an answer before v2. */
const periodOf = (tile: FinanceTile) => (tile.previousMonth ? monthName(tile.previousMonth.from) : null);

/** One currency's amount in display figures, with its code beside it when the tile holds more than one currency. */
function Money(props: { minor: number; currency: Currency; showCode: boolean; size?: "lg" }) {
  return (
    <span className={`fin-money${props.size ? ` fin-money--${props.size}` : ""}`}>
      <span className="fin-money__value">{moneyText(props.minor, props.currency)}</span>
      {props.showCode && <span className="fin-money__code docno">{props.currency}</span>}
    </span>
  );
}

function FinTile(props: {
  id: string;
  title: string;
  empty: boolean;
  emptyText: string;
  icon: ReactNode;
  link?: { to: string; text: string } | undefined;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`lead-panel tile fin-tile${props.empty ? " tile--quiet fin-tile--empty" : ""}${props.className ? ` ${props.className}` : ""}`}
      aria-labelledby={`tile-${props.id}`}
    >
      <div className="lead-panel__head tile__head">
        <h2 id={`tile-${props.id}`} className="lead-panel__title">
          {props.title}
        </h2>
      </div>
      {props.empty ? (
        <p className="panel-empty">
          {props.icon}
          <span>{props.emptyText}</span>
        </p>
      ) : (
        props.children
      )}
      {/* The way on sits under the figures: a third-width tile has no room for it beside its title. */}
      {props.link && !props.empty && (
        <Link to={props.link.to} className="tile__link fin-tile__link">
          {props.link.text}
        </Link>
      )}
    </section>
  );
}

/** "Outstanding", "Overdue", "Payment requests": one figure per currency with its count line. */
function OwedFigures({ rows, countText }: { rows: OwedByCurrency[]; countText: (n: number) => string }) {
  const many = rows.length > 1;
  return (
    <ul className="fin-figures">
      {rows.map((r) => (
        <li key={r.currency} className="fin-figure">
          <Money minor={r.balanceMinor} currency={r.currency} showCode={many} size="lg" />
          <span className="fin-figure__sub">{countText(r.count)}</span>
        </li>
      ))}
    </ul>
  );
}

/** C22: this month against the previous IST month, in words under a figure (never an arrow alone); nothing when the API sent no comparison. */
function Delta({
  minor,
  currency,
  period,
}: {
  minor: number | undefined;
  currency: Currency;
  period: string | null;
}) {
  if (minor === undefined || period === null) return null;
  return <span className="fin-figure__sub fin-delta">{deltaText(minor, currency, period)}</span>;
}

/** The overdue buckets of one currency (C5 (a)) as a thin segmented bar: the ageing report's form, in the Overdue tile. */
const OVERDUE_BUCKETS = ["d1_30", "d31_60", "d61_90", "d90_plus"] as const;
function OverdueBar({ ageing, currency }: { ageing: AgeingByCurrency | undefined; currency: Currency }) {
  if (!ageing) return null;
  return (
    <SegmentedBar
      size="thin"
      label={`${F.overdue}, ${currency}`}
      parts={OVERDUE_BUCKETS.map((b) => ({
        key: b,
        label: AGEING_LABELS[b],
        tone: OVERDUE_TONES[b],
        value: ageing.buckets[b].balanceMinor,
        valueText: moneyText(ageing.buckets[b].balanceMinor, currency),
      }))}
    />
  );
}
const OVERDUE_TONES = { d1_30: "s1", d31_60: "s2", d61_90: "s3", d90_plus: "s4" } as const;

export function FinanceTiles({
  tile,
  reports,
}: {
  tile: FinanceTile;
  reports?: DashboardReportLinks | undefined;
}) {
  const exportsOk = "counts" in tile.exports;
  const ageing = new Map((tile.overdue.ageing ?? []).map((a) => [a.currency, a]));
  const overdueShown = tile.overdue.byCurrency.filter((r) => ageing.get(r.currency));
  const many = tile.overdue.byCurrency.length > 1;
  return (
    <div className="dash__finance">
      <InvoicedTile tile={tile} />
      <FinTile
        id="fin-outstanding"
        title={F.outstanding}
        empty={tile.outstanding.length === 0}
        emptyText={F.noneOutstanding}
        icon={<Receipt size={20} />}
        link={{ to: "/invoices", text: F.openInvoices }}
      >
        <OwedFigures rows={tile.outstanding} countText={F.documents} />
      </FinTile>
      <FinTile
        id="fin-overdue"
        title={F.overdue}
        empty={tile.overdue.byCurrency.length === 0}
        emptyText={F.noneOverdue}
        icon={<CheckCircle size={20} />}
        className="fin-tile--overdue"
        link={reports?.ageing ? { to: "/reports/ageing", text: M73_TITLES.ageing } : undefined}
      >
        <ul className="fin-figures">
          {tile.overdue.byCurrency.map((r) => (
            <li key={r.currency} className="fin-figure">
              <Money minor={r.balanceMinor} currency={r.currency} showCode={many} size="lg" />
              <span className="fin-figure__sub">{F.documents(r.count)}</span>
              <OverdueBar ageing={ageing.get(r.currency)} currency={r.currency} />
            </li>
          ))}
        </ul>
        {overdueShown.length > 0 && (
          <div className="fin-ageing-legend">
            <Legend
              items={OVERDUE_BUCKETS.filter((b) =>
                overdueShown.some((r) => (ageing.get(r.currency)?.buckets[b].balanceMinor ?? 0) > 0),
              ).map((b) => ({ tone: OVERDUE_TONES[b], label: AGEING_LABELS[b] }))}
            />
          </div>
        )}
        {tile.overdue.oldest.length > 0 && (
          <div className="fin-list">
            <h3 className="fin-list__h">{F.oldest}</h3>
            <ol className="tile-list tile-list--compact">
              {tile.overdue.oldest.map((o) => (
                <li key={o.id} className="fin-list__row">
                  <Link to={documentHref(o.id)} className="fin-list__main">
                    {F.overdueRow(o.number, o.clientName, o.daysOverdue)}
                  </Link>
                  <span className="fin-list__amount">{moneyText(o.balanceMinor, o.currency)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </FinTile>
      <FinTile
        id="fin-proformas"
        title={F.proformas}
        empty={tile.proformasAwaiting.length === 0}
        emptyText={F.noneProformas}
        icon={<FileText size={20} />}
      >
        <OwedFigures rows={tile.proformasAwaiting} countText={F.open} />
      </FinTile>
      {exportsOk ? (
        <ExportsTile exports={tile.exports as Extract<FinanceTile["exports"], { counts: unknown }>} />
      ) : (
        <FinTile
          id="fin-exports"
          title={F.exports}
          empty
          emptyText={F.exportsSettings}
          icon={<AlertTriangle size={20} />}
        >
          {null}
        </FinTile>
      )}
      {tile.collected.available ? (
        <CollectedTile collected={tile.collected} period={periodOf(tile)} />
      ) : (
        <p className="panel-empty fin-arrives">
          <Wallet size={20} />
          <span>{DASH_COPY.footLine}</span>
        </p>
      )}
      {tile.paymentsToVerify.available && <ToCheckTile count={tile.paymentsToVerify.count} />}
    </div>
  );
}

/**
 * M6.1 (07-ZH line 16): "Collected this month", confirmed payments received this IST month, one figure per currency (rupees and dollars are never added
 * together), the count under it and this financial year beside it, as the Invoiced tile reads.
 */
function CollectedTile({
  collected,
  period,
}: {
  collected: Extract<FinanceTile["collected"], { available: true }>;
  period: string | null;
}) {
  const fy = new Map(collected.fy.map((r) => [r.currency, r]));
  const change = new Map((collected.change ?? []).map((r) => [r.currency, r.collectedMinor]));
  const many = collected.month.length > 1;
  return (
    <FinTile
      id="fin-collected"
      title={PAY_COPY.collectedMonth}
      empty={collected.month.length === 0}
      emptyText={PAY_UI.noneCollected}
      icon={<Wallet size={20} />}
      link={{ to: "/payments?tab=all", text: PAY_COPY.heading }}
    >
      <ul className="fin-figures">
        {collected.month.map((r) => {
          const y = fy.get(r.currency);
          return (
            <li key={r.currency} className="fin-figure">
              <Money minor={r.collectedMinor} currency={r.currency} showCode={many} size="lg" />
              <span className="fin-figure__sub">{PAY_UI.paymentsCount(r.count)}</span>
              <Delta minor={change.get(r.currency)} currency={r.currency} period={period} />
              {y && (
                <span className="fin-figure__sub">{`${F.thisFy}: ${moneyText(y.collectedMinor, r.currency)}`}</span>
              )}
            </li>
          );
        })}
      </ul>
    </FinTile>
  );
}

/** M6.1 (07-ZH line 16; the Owner only): "Payments to check", the entries Staff recorded that wait for the Owner, with the way to them. */
function ToCheckTile({ count }: { count: number }) {
  return (
    <FinTile
      id="fin-to-check"
      title={PAY_COPY.toCheck}
      empty={count === 0}
      emptyText={PAY_UI.nothingToCheck}
      icon={<CheckCircle size={20} />}
      link={{ to: "/payments", text: PAY_UI.openToCheck }}
      className="fin-tile--check"
    >
      <p className="fin-figure">
        <span className="fin-money__value fin-money--lg tnum">{count}</span>
      </p>
    </FinTile>
  );
}

/** Invoiced, before GST (Q52): this month and this financial year side by side, per currency; a USD figure says its INR equivalent under it. */
function InvoicedTile({ tile }: { tile: FinanceTile }) {
  const fy = tile.invoiced.fy;
  const month = new Map(tile.invoiced.month.map((m) => [m.currency, m]));
  const change = new Map((tile.invoiced.change ?? []).map((c) => [c.currency, c.taxableMinor]));
  const period = periodOf(tile);
  const many = fy.length > 1;
  return (
    <FinTile
      id="fin-invoiced"
      title={F.invoiced}
      empty={fy.length === 0}
      emptyText={F.noneInvoiced}
      icon={<Receipt size={20} />}
      className="fin-tile--invoiced"
    >
      <p className="fin-hint">{F.beforeGst}</p>
      <table className="fin-invoiced">
        <caption className="visually-hidden">{F.invoiced}</caption>
        <thead>
          <tr>
            {many && <td />}
            <th scope="col">{F.thisMonth}</th>
            <th scope="col">{F.thisFy}</th>
          </tr>
        </thead>
        <tbody>
          {fy.map((r) => {
            const m = month.get(r.currency);
            return (
              <tr key={r.currency}>
                {many && (
                  <th scope="row" className="docno fin-invoiced__cur">
                    {r.currency}
                  </th>
                )}
                <td>
                  <span className="fin-money__value fin-money--lg">
                    {moneyText(m?.taxableMinor ?? 0, r.currency)}
                  </span>
                  {r.currency !== "INR" && m && m.inrTaxableMinor !== null && (
                    <span className="fin-figure__sub">
                      {F.inrEquivalent(moneyText(m.inrTaxableMinor, "INR"))}
                    </span>
                  )}
                  <Delta minor={change.get(r.currency)} currency={r.currency} period={period} />
                </td>
                <td>
                  <span className="fin-money__value fin-money--lg">
                    {moneyText(r.taxableMinor, r.currency)}
                  </span>
                  {r.currency !== "INR" && r.inrTaxableMinor !== null && (
                    <span className="fin-figure__sub">
                      {F.inrEquivalent(moneyText(r.inrTaxableMinor, "INR"))}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </FinTile>
  );
}

const COUNT_KEYS = ["femaApproaching", "femaOverdue", "gstApproaching", "gstOverdue"] as const;
const COUNT_STAGE = {
  femaApproaching: "fema_approaching",
  femaOverdue: "fema_overdue",
  gstApproaching: "gst_approaching",
  gstOverdue: "gst_overdue",
} as const;

function ExportsTile({ exports }: { exports: Extract<FinanceTile["exports"], { counts: unknown }> }) {
  const c = exports.counts;
  const any = COUNT_KEYS.some((k) => c[k] > 0) || exports.next.length > 0;
  return (
    <FinTile
      id="fin-exports"
      title={F.exports}
      empty={!any}
      emptyText={F.noneExports}
      icon={<Clock size={20} />}
      link={{ to: "/reports/realisation", text: F.openRealisation }}
      className="fin-tile--exports"
    >
      <dl className="mini-facts mini-facts--row fin-counts">
        {COUNT_KEYS.map((k) => {
          const p = STAGE_PILLS[COUNT_STAGE[k]];
          return (
            <div key={k} data-stage={c[k] > 0 ? p.tone : undefined}>
              <dt>{F.counts[k]}</dt>
              <dd className="tnum">{c[k]}</dd>
            </div>
          );
        })}
      </dl>
      {exports.next.length > 0 && (
        <div className="fin-list">
          <h3 className="fin-list__h">{F.next}</h3>
          <ol className="tile-list tile-list--compact">
            {exports.next.map((n) => {
              const stage = isStage(n.stage) ? n.stage : null;
              const p = stage ? STAGE_PILLS[stage] : null;
              return (
                <li key={n.id} className="fin-list__row fin-list__row--export">
                  <span className="fin-list__text">
                    <Link
                      to={`/reports/realisation?doc=${encodeURIComponent(n.id)}`}
                      className="fin-list__main docno"
                    >
                      {n.number}
                    </Link>
                    <span className="fin-list__meta">
                      <span className="docno">{n.clientCode}</span>
                      <time dateTime={n.dueDate}>{isoDayText(n.dueDate)}</time>
                    </span>
                  </span>
                  {stage && p && (
                    <StatusPill tone={p.tone} icon={p.icon} outline={p.outline}>
                      {STAGE_LABELS[stage]}
                    </StatusPill>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </FinTile>
  );
}
