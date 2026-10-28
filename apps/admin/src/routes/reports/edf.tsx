// EDF list (M5.5b; ADM-REP-07, Q16, Q56; Researched 2026-10-28, FEMA export regulations, 08-C RB-03): the export invoices of one month for the declaration the bank files, due 30 days after
// the month ends. The previous month by default (or the one a bell names, `?month=YYYY-MM`); the list reads as soon as the month changes (no fresh code:
// `reports.finance`). "Amount realised" stays blank until payments are recorded (M6.1), and the screen says why.
import { istDate } from "@techaust/core/dates";
import { countryName } from "@techaust/core/form-labels";
import { type EdfRow, edfMonth } from "@techaust/core/gst";
import { useId } from "react";
import { useSearchParams } from "react-router";
import { DataTable } from "../../components/data-table.tsx";
import { EmptyState } from "../../components/display.tsx";
import { Download, FileText } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { dateText, EDF_COPY, GST_COPY, monthLabel, previousMonth } from "../../lib/reports.ts";
import { csvBlob, readAll, reportsApi, saveFile } from "../../lib/reports-api.ts";
import { buildEdf } from "../../lib/reports-build.ts";
import { ReportFrame } from "./frame.tsx";
import { Amount, DocLink, ProblemList, WarningList, WideList } from "./parts.tsx";

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The months the picker offers: the last 24, newest first (an export older than that is long past its EDF date). */
function monthOptions(today: { year: number; month: number }) {
  const out: { year: number; month: number }[] = [];
  let { year, month } = today;
  for (let i = 0; i < 24; i++) {
    out.push({ year, month });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

const monthValue = (m: { year: number; month: number }) => `${m.year}-${String(m.month).padStart(2, "0")}`;

export function EdfReport() {
  const today = istDate(Date.now());
  const [params, setParams] = useSearchParams();
  const asked = MONTH_RE.exec(params.get("month") ?? "");
  const chosen = asked ? { year: Number(asked[1]), month: Number(asked[2]) } : previousMonth(today);
  const value = monthValue(chosen);
  const pickId = useId();
  const due = edfMonth(chosen.year, chosen.month);
  const dueText = due.ok ? dateText(due.value.due) : "";

  const list = useLoad(async () => {
    const read = await readAll(
      (after) => reportsApi.edf(value, after),
      () => undefined,
    );
    if (!read) throw new Error("stopped");
    return buildEdf(read.rows, read.meta, chosen.year, chosen.month);
  }, value);

  const label = monthLabel(chosen.year, chosen.month);
  const C = EDF_COPY.columns;

  return (
    <ReportFrame title={EDF_COPY.title} lede={EDF_COPY.lede(dueText)}>
      <div className="report-controls report-controls--row">
        <div className="field report-month">
          <div className="field__head">
            <label htmlFor={pickId}>{EDF_COPY.month}</label>
          </div>
          <div className="field__body">
            <select
              id={pickId}
              value={value}
              onChange={(e) =>
                setParams(
                  (p) => {
                    const n = new URLSearchParams(p);
                    n.set("month", e.target.value);
                    return n;
                  },
                  { replace: true },
                )
              }
            >
              {monthOptions(today).map((m) => (
                <option key={monthValue(m)} value={monthValue(m)}>
                  {monthLabel(m.year, m.month)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {list.state === "ready" && list.data.ok && list.data.rows.length > 0 && (
          <button
            type="button"
            className="btn btn--secondary report-controls__action"
            onClick={() => list.data.ok && saveFile(csvBlob(list.data.csv), `edf-${value}.csv`)}
          >
            <Download size={20} />
            {EDF_COPY.download}
          </button>
        )}
      </div>
      <div className="report-results">
        {list.state === "failed" ? (
          <LoadFailed error={list.error} onRetry={() => list.reload()} />
        ) : list.state === "ready" && !list.data.ok ? (
          <ProblemList
            id="edf-problems"
            problems={list.data.problems}
            heading={GST_COPY.errorsHeading(list.data.problems.length)}
          />
        ) : (
          <>
            {list.state === "ready" && list.data.ok && <WarningList warnings={list.data.warnings} />}
            <WideList label={EDF_COPY.title}>
              <DataTable<EdfRow>
                caption={`${EDF_COPY.title}, ${label}`}
                loading={list.state === "loading"}
                rows={list.state === "ready" && list.data.ok ? [...list.data.rows] : []}
                rowKey={(r) => r.id}
                empty={
                  <EmptyState icon={<FileText />} title={EDF_COPY.empty(label)}>
                    {null}
                  </EmptyState>
                }
                columns={[
                  {
                    key: "invoice",
                    header: C.invoice,
                    card: "title",
                    cell: (r) => <DocLink doc={{ id: r.id, number: r.number, kind: "export_invoice" }} />,
                  },
                  {
                    key: "date",
                    header: C.date,
                    cell: (r) => <span className="tnum">{dateText(r.issueDate)}</span>,
                  },
                  { key: "client", header: C.client, cell: (r) => r.clientName },
                  {
                    key: "country",
                    header: C.country,
                    cell: (r) => (r.countryCode ? countryName(r.countryCode) : null),
                  },
                  {
                    key: "currency",
                    header: C.currency,
                    cell: (r) => <span className="docno">{r.currency}</span>,
                  },
                  {
                    key: "amount",
                    header: C.amount,
                    align: "end",
                    cell: (r) => <Amount minor={r.totalMinor} currency={r.currency} />,
                  },
                  {
                    key: "purpose",
                    header: C.purpose,
                    cell: (r) => (r.purposeCode ? <span className="docno">{r.purposeCode}</span> : null),
                  },
                  { key: "realised", header: C.realised, align: "end", cell: () => null },
                ]}
              />
            </WideList>
            {list.state === "ready" && list.data.ok && list.data.rows.length > 0 && (
              <p className="hint report-note">{EDF_COPY.realisedNote}</p>
            )}
          </>
        )}
      </div>
    </ReportFrame>
  );
}
