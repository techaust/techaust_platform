// Export realisation (M5.5b; ADM-INV-17, Q15, Q53, LD75; VERIFY WITH CA/LEGAL): the export invoices not yet fully paid, most urgent first, each with
// its stage as a status pill (the reserved status colours, always with the icon and the words) and the date it is due by. The stages are core's
// (`realisationRows`, as of the server's today, with the stored settings); "Show realised" adds the paid ones (`?show=all`). A bell about one
// invoice lands here with that invoice marked and in view (`?doc=<id>`). Before M6 only an advance invoice records a payment (LD17), so an export
// paid by wire still shows as outstanding: the extension note says where that will be recorded.
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { DataTable } from "../../components/data-table.tsx";
import { EmptyState, StatusPill } from "../../components/display.tsx";
import { CheckCircle } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import {
  byUrgency,
  dateText,
  dueOf,
  GST_COPY,
  REALISATION_COPY,
  STAGE_LABELS,
  STAGE_PILLS,
} from "../../lib/reports.ts";
import { readAll, reportsApi } from "../../lib/reports-api.ts";
import { buildRealisation, type RealisationList } from "../../lib/reports-build.ts";
import { ReportFrame } from "./frame.tsx";
import { Amount, DocLink, ProblemList, WideList } from "./parts.tsx";

type Row = Extract<RealisationList, { ok: true }>["rows"][number];

export function RealisationReport() {
  const [params, setParams] = useSearchParams();
  const showAll = params.get("show") === "all";
  const marked = params.get("doc");
  const list = useLoad(
    async () => {
      const read = await readAll(
        (after) => reportsApi.realisation(showAll ? "all" : "open", after),
        () => undefined,
      );
      if (!read) throw new Error("stopped");
      return buildRealisation(read.rows, read.meta);
    },
    showAll ? "all" : "open",
  );

  // A bell's invoice: once the list is there, bring its row into view and put focus on its link.
  useEffect(() => {
    if (list.state !== "ready" || !marked) return;
    const el = document.getElementById(`real-${marked}`);
    el?.scrollIntoView({ block: "center" });
    el?.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
  }, [list.state, marked]);

  const rows = list.state === "ready" && list.data.ok ? byUrgency(list.data.rows) : [];
  const C = REALISATION_COPY.columns;

  return (
    <ReportFrame title={REALISATION_COPY.title} lede={REALISATION_COPY.lede}>
      <div className="report-controls report-controls--row">
        <label className="check-row">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) =>
              setParams(
                (p) => {
                  const n = new URLSearchParams(p);
                  if (e.target.checked) n.set("show", "all");
                  else n.delete("show");
                  n.delete("doc");
                  return n;
                },
                { replace: true },
              )
            }
          />
          <span>{REALISATION_COPY.showRealised}</span>
        </label>
      </div>
      <div className="report-results">
        {list.state === "failed" ? (
          <LoadFailed error={list.error} onRetry={() => list.reload()} />
        ) : list.state === "ready" && !list.data.ok ? (
          <ProblemList
            id="real-problems"
            problems={list.data.problems}
            heading={GST_COPY.errorsHeading(list.data.problems.length)}
          />
        ) : (
          <WideList label={REALISATION_COPY.title}>
            <DataTable<Row>
              caption={REALISATION_COPY.title}
              loading={list.state === "loading"}
              rows={rows}
              rowKey={(r) => r.id}
              empty={
                <EmptyState
                  icon={<CheckCircle />}
                  title={showAll ? REALISATION_COPY.emptyAll : REALISATION_COPY.empty}
                >
                  {null}
                </EmptyState>
              }
              columns={[
                {
                  key: "invoice",
                  header: C.invoice,
                  card: "title",
                  cell: (r) => (
                    <span
                      id={`real-${r.id}`}
                      className="real-invoice"
                      data-marked={r.id === marked || undefined}
                    >
                      <DocLink doc={{ id: r.id, number: r.number, kind: "export_invoice" }} />
                      {r.beforeFema && (
                        <span className="real-invoice__note">{REALISATION_COPY.beforeFema}</span>
                      )}
                    </span>
                  ),
                },
                { key: "client", header: C.client, cell: (r) => r.clientName },
                {
                  key: "issued",
                  header: C.issued,
                  cell: (r) => <span className="tnum">{dateText(r.issueDate)}</span>,
                },
                {
                  key: "outstanding",
                  header: C.outstanding,
                  align: "end",
                  cell: (r) => <Amount minor={r.outstandingMinor} currency={r.currency} />,
                },
                {
                  key: "stage",
                  header: C.stage,
                  cell: (r) => {
                    const p = STAGE_PILLS[r.stage];
                    return (
                      <span className="real-stage">
                        <StatusPill tone={p.tone} icon={p.icon} outline={p.outline}>
                          {STAGE_LABELS[r.stage]}
                        </StatusPill>
                      </span>
                    );
                  },
                },
                {
                  key: "due",
                  header: C.dueBy,
                  cell: (r) =>
                    r.stage === "realised" ? null : <span className="tnum">{dateText(dueOf(r))}</span>,
                },
              ]}
            />
          </WideList>
        )}
        {list.state === "ready" && list.data.ok && (
          <div className="report-notes">
            <p className="hint report-note">{REALISATION_COPY.igstNote}</p>
            <p className="hint report-note">{REALISATION_COPY.extensionNote}</p>
          </div>
        )}
      </div>
    </ReportFrame>
  );
}
