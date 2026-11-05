// Care plan hours (M7.3; ADM-REP-05; run file C4, G; copy C4, C17 to C20): for one month, every plan active on its period's first day, with the billing
// period that STARTS in that month (L13): hours included, used (the care list's own used/available meter, with its 80 % and 100 % flags in words and icons),
// over, and whether the period is billed (its care invoice's day and number, a draft, "Not billed yet" or "Draft discarded"). Hours only: an overage is
// priced on the care invoice (C19), never here. The month is in the URL; "Show more" reads the next 50 plans; "Export CSV" writes the rows on screen.
import type { CareHoursRow } from "@techaust/core/reports";
import { useEffect, useState } from "react";
import { RequestError } from "../../api.ts";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { EmptyState } from "../../components/display.tsx";
import { LifeBuoy } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { hoursText, periodText } from "../../lib/care.ts";
import { m73Api } from "../../lib/m73-api.ts";
import {
  billedText,
  CARE_HOURS_COPY as C,
  careHoursCsv,
  M73_TITLES,
  monthChoices,
  monthName,
  REVENUE_COPY,
} from "../../lib/m73-reports.ts";
import { todayIst } from "../../lib/payments.ts";
import { isoDayText, reportErrorText } from "../../lib/reports.ts";
import { FlagPill, HoursBar, PlanName } from "../care/parts.tsx";
import { ReportFrame } from "./frame.tsx";
import { ExportButton, FilterRow, FilterSelect, ReportSkeleton, useFilters } from "./m73-parts.tsx";

export function CareHoursReport() {
  const { params, set } = useFilters();
  const today = todayIst();
  const choices = monthChoices(today);
  const m = params.get("month") ?? "";
  const month = choices.some((c) => c.value === m) ? m : (choices[0]?.value ?? today.slice(0, 7));
  const first = useLoad(() => m73Api.careHours(month), month);
  const [more, setMore] = useState<CareHoursRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new first page starts the list again
  useEffect(() => {
    setMore([]);
    setMoreError(null);
    setNext(first.state === "ready" ? first.data.next : null);
  }, [first.state, month]);
  const rows = first.state === "ready" ? [...first.data.rows, ...more] : [];
  async function showMore() {
    if (!next) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const p = await m73Api.careHours(month, next);
      setMore((x) => [...x, ...p.rows]);
      setNext(p.next);
    } catch (e) {
      setMoreError(e instanceof RequestError && e.code === "month_invalid" ? C.monthInvalid : reportErrorText(e));
    } finally {
      setLoadingMore(false);
    }
  }
  const columns: Column<CareHoursRow>[] = [
    {
      key: "plan",
      header: C.plan,
      card: "title",
      cell: (r) => <PlanName id={r.planId} title={r.client.name} code={r.client.code} />,
    },
    {
      key: "period",
      header: C.period,
      cell: (r) => <span className="m73-nowrap-dates">{periodText(r.period)}</span>,
    },
    {
      key: "included",
      header: C.included,
      align: "end",
      cell: (r) => (
        <span className="tnum">
          {hoursText(r.includedMinutes)}
          {r.rolloverInMinutes > 0 && <span className="m73-money__inr">+{hoursText(r.rolloverInMinutes)}</span>}
        </span>
      ),
    },
    {
      key: "used",
      header: C.used,
      cell: (r) => (
        <div className="m73-care-used">
          <HoursBar
            usage={{ used: r.usedMinutes, available: r.availableMinutes, flag: r.flag, overageMinutes: r.overageMinutes }}
            label={r.client.name}
          />
          <FlagPill flag={r.flag} />
        </div>
      ),
    },
    {
      key: "over",
      header: C.over,
      align: "end",
      cell: (r) => <span className="tnum">{r.overageMinutes > 0 ? hoursText(r.overageMinutes) : "–"}</span>,
    },
    {
      key: "billed",
      header: C.billedOn,
      cell: (r) => (
        <span className="m73-billed">
          <span>{billedText(r.billed, isoDayText)}</span>
          {r.overageBilled && (
            <span className="m73-money__inr">{C.overageOn(billedText(r.overageBilled, isoDayText))}</span>
          )}
        </span>
      ),
    },
  ];
  const caption = `${M73_TITLES.careHours}, ${monthName(month)}`;
  return (
    <ReportFrame title={M73_TITLES.careHours} lede={C.overageNote}>
      <FilterRow>
        <FilterSelect
          label={C.month}
          value={month}
          options={choices}
          onChange={(v) => set({ month: v === choices[0]?.value ? null : v })}
        />
        {rows.length > 0 && (
          <div className="m73-filters__end">
            <ExportButton<CareHoursRow>
              local
              read={async () => rows}
              build={(all) => careHoursCsv(all, month)}
              filename={`care-plan-hours-${month}.csv`}
              progress={() => ""}
            />
          </div>
        )}
      </FilterRow>
      {first.state === "failed" ? (
        <LoadFailed error={first.error} onRetry={() => first.reload()} />
      ) : first.state === "loading" ? (
        <ReportSkeleton label={`Loading ${M73_TITLES.careHours.toLowerCase()}`} />
      ) : (
        <div className="m73-stack">
          <div className="m73-table m73-table--wide">
            <DataTable
              caption={caption}
              columns={columns}
              rows={rows}
              rowKey={(r) => r.planId}
              empty={
                <EmptyState icon={<LifeBuoy />} title={C.empty.replace(/\.$/, "")}>
                  {null}
                </EmptyState>
              }
            />
          </div>
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
