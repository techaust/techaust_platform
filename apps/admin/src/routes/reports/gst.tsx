// GST exports (M5.5b; ADM-REP-04, LD71, LD73, LD84; Researched 2026-10-28, GSTR-1 and Table 13, 08-C RA-23, RA-10; test import before the first filing, 08-C §6): a month or a QRMP quarter (the last complete quarter by default), then
// "Make files": the register of the period is read page by page (a fresh code when the server asks, `exports.gst`; one audit row per page), the gst
// core checks every document and builds GSTR-1, Table 13 and the 3B figures in the browser, and the files are downloaded one by one or as one ZIP.
// A problem in any document stops every file (owner decision 2026-10-27): the list names each document with a link to fix it. The totals stand on
// the ledger's double rule; the HSN/SAC check sits under them and blocks the download when it fails.
import { istDate } from "@techaust/core/dates";
import { heldRowOf } from "@techaust/core/gst";
import { SERIES } from "@techaust/core/numbering";
import { useEffect, useId, useRef, useState } from "react";
import { ensureStepUp } from "../../api.ts";
import { VerifyNote } from "../../components/form.tsx";
import { AlertTriangle, Archive, Check, Download, FileText, XCircle } from "../../components/icons.tsx";
import { Notice } from "../../components/ui.tsx";
import { IMS_HELD_ROW } from "../../lib/copy-zd.ts";
import { moneyText } from "../../lib/documents.ts";
import {
  fileDownloadText,
  GST_COPY,
  iso,
  lastCompleteQuarter,
  type PeriodChoice,
  periodDates,
  periodFromValue,
  periodOpen,
  periodOptions,
  periodOptionText,
  periodValue,
  reportErrorText,
  SALES_COPY,
  sectionNameOf,
  stateText,
} from "../../lib/reports.ts";
import { csvBlob, readAll, reportsApi, saveFile } from "../../lib/reports-api.ts";
import { buildGstExport, type GstExport, TOTAL_KEYS, zipOf } from "../../lib/reports-build.ts";
import { ReportFrame } from "./frame.tsx";
import { ManualEntries } from "./manual-entries.tsx";
import {
  Amount,
  ImsHeldNotice,
  ProblemList,
  Progress,
  ReportBlock,
  WarningList,
  WideList,
} from "./parts.tsx";

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; count: number }
  | { kind: "checking"; count: number }
  | { kind: "done"; result: GstExport; period: PeriodChoice; threshold: number }
  | { kind: "failed"; text: string };

export function GstExports() {
  const today = istDate(Date.now());
  const [period, setPeriod] = useState<PeriodChoice>(() => lastCompleteQuarter(today));
  const [isDefault, setIsDefault] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const run = useRef(0);
  const resultRef = useRef<HTMLDivElement>(null);
  const kindId = useId();

  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );

  const choose = (p: PeriodChoice) => {
    run.current++;
    setPeriod(p);
    setIsDefault(false);
    setPhase({ kind: "idle" });
  };

  async function make() {
    const n = ++run.current;
    const stopped = () => n !== run.current;
    setPhase({ kind: "reading", count: 0 });
    try {
      if (!(await ensureStepUp())) {
        if (!stopped()) setPhase({ kind: "failed", text: GST_COPY.cancelled });
        return;
      }
      const { from, to } = periodDates(period);
      const read = await readAll(
        (after) => reportsApi.registers(iso(from), iso(to), after),
        (count) => !stopped() && setPhase({ kind: "reading", count }),
        stopped,
      );
      if (!read || stopped()) return;
      setPhase({ kind: "checking", count: read.rows.length });
      // Let the "Checking" line paint before the core works through the documents.
      await new Promise((r) => setTimeout(r, 0));
      if (stopped()) return;
      const result = buildGstExport(read.rows, read.meta, period);
      setPhase({ kind: "done", result, period, threshold: read.meta.b2clThresholdInrMinor });
      requestAnimationFrame(() =>
        resultRef.current?.querySelector<HTMLElement>("h2[tabindex='-1']")?.focus(),
      );
    } catch (e) {
      if (!stopped()) setPhase({ kind: "failed", text: reportErrorText(e) });
    }
  }

  const busy = phase.kind === "reading" || phase.kind === "checking";
  const options = periodOptions(today, period.kind);

  return (
    <ReportFrame title={GST_COPY.title} lede={GST_COPY.lede}>
      <div className="report-controls">
        <fieldset className="period-picker" aria-describedby={isDefault ? `${kindId}-hint` : undefined}>
          <legend className="period-picker__legend">{GST_COPY.period}</legend>
          <div className="period-picker__row">
            <div className="segmented">
              {(["quarter", "month"] as const).map((k) => (
                <label key={k} className="segmented__opt">
                  <input
                    type="radio"
                    name={`${kindId}-kind`}
                    value={k}
                    checked={period.kind === k}
                    disabled={busy}
                    onChange={() => {
                      const first = periodOptions(today, k).find((p) => !periodOpen(p, today));
                      choose(first ?? (periodOptions(today, k)[0] as PeriodChoice));
                    }}
                  />
                  {k === "month" ? GST_COPY.month : GST_COPY.quarter}
                </label>
              ))}
            </div>
            <label className="visually-hidden" htmlFor={`${kindId}-value`}>
              {period.kind === "month" ? GST_COPY.month : GST_COPY.quarter}
            </label>
            <select
              id={`${kindId}-value`}
              className="period-picker__select"
              value={periodValue(period)}
              disabled={busy}
              onChange={(e) => {
                const p = periodFromValue(e.target.value);
                if (p) choose(p);
              }}
            >
              {options.map((p) => (
                <option key={periodValue(p)} value={periodValue(p)}>
                  {periodOptionText(p)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn--primary"
              onClick={make}
              disabled={busy}
              aria-busy={busy || undefined}
            >
              <FileText size={20} />
              {GST_COPY.make}
            </button>
          </div>
          {isDefault && (
            <p id={`${kindId}-hint`} className="hint">
              {GST_COPY.defaultHint}
            </p>
          )}
        </fieldset>
        {periodOpen(period, today) && <Notice tone="info">{GST_COPY.notEnded}</Notice>}
      </div>

      <div ref={resultRef} className="report-results">
        {phase.kind === "reading" && <Progress text={GST_COPY.reading(phase.count)} />}
        {phase.kind === "checking" && <Progress text={GST_COPY.checking(phase.count)} />}
        {phase.kind === "failed" && <Notice tone="error">{phase.text}</Notice>}
        {phase.kind === "done" &&
          (phase.result.ok ? (
            <GstResults result={phase.result} period={phase.period} threshold={phase.threshold} />
          ) : (
            <ProblemList
              id="gst-problems"
              problems={phase.result.problems}
              heading={GST_COPY.errorsHeading(phase.result.problems.length)}
            />
          ))}
      </div>
    </ReportFrame>
  );
}

type Ok = Extract<GstExport, { ok: true }>;

function GstResults({ result, period, threshold }: { result: Ok; period: PeriodChoice; threshold: number }) {
  const t = result.totals;
  const thresholdText = moneyText(threshold, "INR");
  const { from, to } = periodDates(period);
  const zipName = `gst-exports-${iso(from)}-to-${iso(to)}.zip`;
  const C = GST_COPY.columns;
  return (
    <>
      {/* FX-4 (A5 1): never "No errors" while a tax-only note's tax must be entered by hand; the notes follow, each with its figures. */}
      <h2
        id="gst-done"
        className={`report-done${result.complete ? "" : " report-done--manual"}`}
        tabIndex={-1}
      >
        {result.complete ? <Check size={20} /> : <AlertTriangle size={20} />}
        <span>
          {result.complete
            ? GST_COPY.done(result.checked)
            : GST_COPY.doneManual(result.checked, result.blocking)}
        </span>
      </h2>
      <ManualEntries lines={result.warnings} id="gst-done" />
      <WarningList warnings={result.warnings.filter((w) => !w.blocking)} />
      {/* Nothing issued: no ledgers of zeros. The files stay (a period with no supplies is still filed). */}
      {result.checked === 0 && <p className="report-empty-line">{SALES_COPY.empty}</p>}

      <div className="report-grid" hidden={result.checked === 0}>
        <ReportBlock id="gst-totals" title={GST_COPY.totalsHeading}>
          <WideList className="rledger-scroll" label={GST_COPY.totalsHeading}>
            <table className="rledger">
              <caption className="visually-hidden">{GST_COPY.totalsHeading}</caption>
              <thead>
                <tr>
                  <th scope="col">{C.section}</th>
                  <th scope="col" className="num">
                    {C.documents}
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
                {TOTAL_KEYS.map((k) => (
                  <tr key={k} data-empty={t[k].documents === 0 || undefined}>
                    <th scope="row">{sectionNameOf(k, thresholdText)}</th>
                    <td className="num tnum">{t[k].documents}</td>
                    <td className="num">
                      <Amount minor={t[k].taxableMinor} />
                    </td>
                    <td className="num">
                      <Amount minor={t[k].igstMinor} />
                    </td>
                    <td className="num">
                      <Amount minor={t[k].cgstMinor} />
                    </td>
                    <td className="num">
                      <Amount minor={t[k].sgstMinor} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="rledger__total">
                  <th scope="row">{GST_COPY.overall}</th>
                  <td className="num tnum">{t.overall.documents}</td>
                  <td className="num">
                    <Amount minor={t.overall.taxableMinor} />
                  </td>
                  <td className="num">
                    <Amount minor={t.overall.igstMinor} />
                  </td>
                  <td className="num">
                    <Amount minor={t.overall.cgstMinor} />
                  </td>
                  <td className="num">
                    <Amount minor={t.overall.sgstMinor} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </WideList>
          <p className={`rledger-check${result.hsnOk ? "" : " rledger-check--bad"}`}>
            {result.hsnOk ? <Check size={16} /> : <XCircle size={16} />}
            <span>{result.hsnOk ? GST_COPY.hsnMatches : GST_COPY.hsnDiffers}</span>
          </p>
        </ReportBlock>

        <ReportBlock id="gst-3b" title={GST_COPY.gstr3bHeading}>
          <Gstr3bTable lines={result.gstr3b} held={result.imsHeld} />
          <ImsHeldNotice held={result.imsHeld} id="gst-3b-held" />
        </ReportBlock>
      </div>

      <ReportBlock id="gst-docs" title={GST_COPY.table13Heading} hidden={result.checked === 0}>
        <WideList className="rledger-scroll" label={GST_COPY.table13Heading}>
          <table className="rledger">
            <caption className="visually-hidden">{GST_COPY.table13Heading}</caption>
            <thead>
              <tr>
                <th scope="col">{GST_COPY.table13Columns.series}</th>
                <th scope="col">{GST_COPY.table13Columns.from}</th>
                <th scope="col">{GST_COPY.table13Columns.to}</th>
                <th scope="col" className="num">
                  {GST_COPY.table13Columns.total}
                </th>
                <th scope="col" className="num">
                  {GST_COPY.table13Columns.cancelled}
                </th>
              </tr>
            </thead>
            <tbody>
              {result.table13.map((d) => (
                <tr key={`${d.series}-${d.from}`}>
                  <th scope="row">{SERIES[d.series as keyof typeof SERIES]?.label ?? d.series}</th>
                  <td>
                    <span className="docno">{d.from}</span>
                  </td>
                  <td>
                    <span className="docno">{d.to}</span>
                  </td>
                  <td className="num tnum">{d.total}</td>
                  <td className="num tnum">{d.cancelled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </WideList>
      </ReportBlock>

      <ReportBlock
        id="gst-files"
        title={GST_COPY.filesHeading}
        aside={
          <button
            type="button"
            className="btn btn--primary"
            disabled={!result.hsnOk}
            onClick={() =>
              saveFile(new Blob([zipOf(result.files).slice()], { type: "application/zip" }), zipName)
            }
          >
            <Archive size={20} />
            {GST_COPY.downloadAll}
          </button>
        }
      >
        {/* One row per file: the whole row is the button (07-V's label), the file's own name beside it; the two HSN files carry B2B and B2C. */}
        <ul className="report-files">
          {result.files.map((f) => {
            const section =
              f.stem === "gstr3b_summary" ? GST_COPY.gstr3bHeading : sectionNameOf(f.stem, thresholdText);
            return (
              <li key={f.name}>
                <button
                  type="button"
                  className="report-files__btn"
                  disabled={!result.hsnOk}
                  onClick={() => saveFile(csvBlob(f.csv), f.name)}
                >
                  <Download size={20} />
                  <span className="report-files__label">{fileDownloadText(f.stem, section)}</span>
                  <span className="docno report-files__file">{f.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <VerifyNote>{GST_COPY.verify(result.layout)}</VerifyNote>
      </ReportBlock>
    </>
  );
}

/**
 * The 3B figures: 3.1(a) and 3.1(b) with every head, then 3.2 by place of supply (taxable value and IGST only). rt1 T3: while credit notes are held back
 * (not yet accepted in IMS), the row under 3.1(a) says how much 3.1(a) still carries for them, in 07-ZD line 7's words and as POSITIVE amounts (core's
 * `heldRowOf`, the 3B file's own figures; lead D8). No row when none is held.
 */
function Gstr3bTable({ lines, held }: { lines: Ok["gstr3b"]; held: Ok["imsHeld"] }) {
  const C = GST_COPY.columns;
  const a = lines.filter((l) => l.table === "3.1(a)");
  const b = lines.filter((l) => l.table === "3.1(b)");
  const pos = lines.filter((l) => l.table === "3.2");
  const heldRow = held.count > 0 ? heldRowOf(held) : null;
  const heads = (
    l: Pick<Ok["gstr3b"][number], "taxableMinor" | "igstMinor" | "cgstMinor" | "sgstMinor">,
    all: boolean,
  ) => (
    <>
      <td className="num">
        <Amount minor={l.taxableMinor} />
      </td>
      <td className="num">
        <Amount minor={l.igstMinor} />
      </td>
      <td className="num">{all ? <Amount minor={l.cgstMinor} /> : null}</td>
      <td className="num">{all ? <Amount minor={l.sgstMinor} /> : null}</td>
    </>
  );
  return (
    <WideList className="rledger-scroll" label={GST_COPY.gstr3bHeading}>
      <table className="rledger rledger--3b">
        <caption className="visually-hidden">{GST_COPY.gstr3bHeading}</caption>
        <thead>
          <tr>
            <th scope="col">{C.table}</th>
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
          {a.map((l) => (
            <tr key="a">
              <th scope="row">{GST_COPY.table31a}</th>
              {heads(l, true)}
            </tr>
          ))}
          {heldRow && (
            <tr className="rledger__sub rledger__held">
              <th scope="row" className="rledger__held-label">
                {IMS_HELD_ROW}
              </th>
              {heads(heldRow, true)}
            </tr>
          )}
          {b.map((l) => (
            <tr key="b">
              <th scope="row">{GST_COPY.table31b}</th>
              {heads(l, true)}
            </tr>
          ))}
          <tr className="rledger__group">
            <th scope="rowgroup" colSpan={5}>
              {GST_COPY.table32}
            </th>
          </tr>
          {pos.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">
                {GST_COPY.table32Empty}
              </td>
            </tr>
          ) : (
            pos.map((l) => (
              <tr key={l.posCode ?? "none"} className="rledger__sub">
                <th scope="row">{stateText(l.posCode)}</th>
                {heads(l, false)}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </WideList>
  );
}
