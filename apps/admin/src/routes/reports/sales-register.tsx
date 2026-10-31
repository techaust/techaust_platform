// Sales register and output tax (M5.5b; ADM-REP-04, LD71, LD83; Researched 2026-10-28, GSTN advisories of June 2025 (08-C RA-23)): a range inside one financial year, read from the same register
// route as the GST files (a fresh code when the server asks, one audit row per page). The screen previews the output tax by supply and rate (the figures
// a CA checks first) and offers the three files; the 3B figures only when the range is one whole month or quarter (core's 3B is per return period).
import { fyOf, istDate, toIsoDate } from "@techaust/core/dates";
import { formatRate } from "@techaust/core/gst";
import { useEffect, useRef, useState } from "react";
import { ensureStepUp } from "../../api.ts";
import { EmptyState } from "../../components/display.tsx";
import { AlertTriangle, Download, FileText } from "../../components/icons.tsx";
import { Notice } from "../../components/ui.tsx";
import { GST_COPY, rangeOk, reportErrorText, SALES_COPY } from "../../lib/reports.ts";
import { csvBlob, readAll, reportsApi, saveFile } from "../../lib/reports-api.ts";
import { type SalesRegister as Built, buildSalesRegister } from "../../lib/reports-build.ts";
import { ReportFrame } from "./frame.tsx";
import { ManualEntries } from "./manual-entries.tsx";
import { Amount, ImsHeldNotice, ProblemList, Progress, RangeForm, ReportBlock, WideList } from "./parts.tsx";

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; count: number }
  | { kind: "done"; built: Built; from: string; to: string }
  | { kind: "failed"; text: string };

export function SalesRegister() {
  const now = Date.now();
  const today = toIsoDate(istDate(now));
  const fyStart = toIsoDate(istDate(fyOf(now).startMs));
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const run = useRef(0);
  const results = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );

  async function show(from: string, to: string) {
    const n = ++run.current;
    const stopped = () => n !== run.current;
    setPhase({ kind: "reading", count: 0 });
    try {
      if (!(await ensureStepUp())) {
        if (!stopped()) setPhase({ kind: "failed", text: GST_COPY.cancelled });
        return;
      }
      const read = await readAll(
        (after) => reportsApi.registers(from, to, after),
        (count) => !stopped() && setPhase({ kind: "reading", count }),
        stopped,
      );
      if (!read || stopped()) return;
      setPhase({ kind: "done", built: buildSalesRegister(read.rows, read.meta, from, to), from, to });
      requestAnimationFrame(() => results.current?.querySelector<HTMLElement>("[tabindex='-1']")?.focus());
    } catch (e) {
      if (!stopped()) setPhase({ kind: "failed", text: reportErrorText(e) });
    }
  }

  return (
    <ReportFrame title={SALES_COPY.title} lede={SALES_COPY.lede}>
      <div className="report-controls">
        <RangeForm
          idPrefix="sales"
          from={fyStart}
          to={today}
          labels={{ from: SALES_COPY.from, to: SALES_COPY.to, submit: SALES_COPY.show }}
          busy={phase.kind === "reading"}
          check={(f, t) => (rangeOk(f, t) ? null : SALES_COPY.rangeInvalid)}
          onSubmit={show}
        />
      </div>
      <div ref={results} className="report-results">
        {phase.kind === "reading" && <Progress text={GST_COPY.reading(phase.count)} />}
        {phase.kind === "failed" && <Notice tone="error">{phase.text}</Notice>}
        {phase.kind === "done" && <Results built={phase.built} from={phase.from} to={phase.to} />}
      </div>
    </ReportFrame>
  );
}

function Results({ built, from, to }: { built: Built; from: string; to: string }) {
  if (!built.ok)
    return (
      <ProblemList
        id="sales-problems"
        problems={built.problems}
        heading={GST_COPY.errorsHeading(built.problems.length)}
      />
    );
  if (built.count === 0)
    return (
      <div tabIndex={-1} className="report-empty">
        <EmptyState icon={<FileText />} title={SALES_COPY.empty}>
          {null}
        </EmptyState>
      </div>
    );
  const C = SALES_COPY.columns;
  const name = (stem: string) => `${stem}-${from}-to-${to}.csv`;
  return (
    <>
      {/* FX-4 (early check L3): with the 3B file on offer, the same line as the GST exports, never "No errors" while a tax-only note's tax must be entered by hand. */}
      <h2
        id="sales-done"
        className={`report-done${built.manual.length > 0 ? " report-done--manual" : ""}`}
        tabIndex={-1}
      >
        {built.manual.length > 0 && <AlertTriangle size={20} />}
        <span>
          {built.manual.length > 0
            ? GST_COPY.doneManual(built.count, built.manual.length)
            : GST_COPY.done(built.count)}
        </span>
      </h2>
      <ManualEntries lines={built.manual} id="sales-done" />
      <ReportBlock id="sales-output" title={SALES_COPY.previewHeading}>
        <WideList className="rledger-scroll" label={SALES_COPY.previewHeading}>
          <table className="rledger rledger--plain">
            <caption className="visually-hidden">{SALES_COPY.previewHeading}</caption>
            <thead>
              <tr>
                <th scope="col">{C.supply}</th>
                <th scope="col" className="num">
                  {C.rate}
                </th>
                <th scope="col" className="num">
                  {C.taxable}
                </th>
                <th scope="col" className="num">
                  {C.igst}
                </th>
                <th scope="col" className="num">
                  {C.cgst}
                </th>
                <th scope="col" className="num">
                  {C.sgst}
                </th>
              </tr>
            </thead>
            <tbody>
              {built.outputTax.map((r) => (
                <tr key={`${r.bucket}-${r.rateBp}`}>
                  <th scope="row">{SALES_COPY.supply[r.bucket]}</th>
                  <td className="num tnum">{formatRate(r.rateBp)} %</td>
                  <td className="num">
                    <Amount minor={r.taxableMinor} />
                  </td>
                  <td className="num">
                    <Amount minor={r.igstMinor} />
                  </td>
                  <td className="num">
                    <Amount minor={r.cgstMinor} />
                  </td>
                  <td className="num">
                    <Amount minor={r.sgstMinor} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </WideList>
      </ReportBlock>
      {/* rt1 T3 (07-ZD line 8): with the 3B file on offer, the same line as the GST exports when credit notes are held back until IMS acceptance. */}
      {built.imsHeld && <ImsHeldNotice held={built.imsHeld} id="sales-3b-held" />}
      <div className="report-downloads">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => saveFile(csvBlob(built.files.register), name("sales_register"))}
        >
          <Download size={20} />
          {SALES_COPY.downloadRegister}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => saveFile(csvBlob(built.files.outputTax), name("output_tax"))}
        >
          <Download size={20} />
          {SALES_COPY.downloadOutput}
        </button>
        {built.files.gstr3b !== null && (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => saveFile(csvBlob(built.files.gstr3b as string), name("gstr3b_summary"))}
          >
            <Download size={20} />
            {SALES_COPY.downloadGstr3b}
          </button>
        )}
      </div>
    </>
  );
}
