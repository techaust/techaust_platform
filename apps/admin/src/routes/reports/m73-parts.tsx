// Pieces the M7.3 reports share: the filter row (one row above the charts, every choice in the URL), a choice of a few as the shared switch, an amount with its
// INR equivalent, the export button (a fresh code, one request per page) and the loading frame.
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { type Currency, ensureStepUp } from "../../api.ts";
import { Skeleton } from "../../components/display.tsx";
import { Download } from "../../components/icons.tsx";
import { Notice } from "../../components/ui.tsx";
import { moneyText } from "../../lib/documents.ts";
import { PIPELINE_COPY, REVENUE_COPY } from "../../lib/m73-reports.ts";
import { csvBlob, saveFile } from "../../lib/reports-api.ts";
import { FINANCE_COPY, reportErrorText } from "../../lib/reports.ts";

/** The URL's filters: read one, set several (replacing the history entry, so Back leaves the report rather than undoing a filter). */
export function useFilters() {
  const [params, setParams] = useSearchParams();
  const set = (changes: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null || v === "") n.delete(k);
          else n.set(k, v);
        }
        return n;
      },
      { replace: true },
    );
  return { params, set };
}

/** The filter row: one row above everything it scopes, wrapping on a phone. */
export function FilterRow({ children }: { children: ReactNode }) {
  return <div className="m73-filters">{children}</div>;
}

/** A select in the filter row, with its label above (the shared field's head and body). */
export function FilterSelect(props: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="field m73-filters__field">
      <div className="field__head">
        <label htmlFor={id}>{props.label}</label>
      </div>
      <div className="field__body">
        <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
          {props.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** A choice of a few, as the shared switch (shell.css `.segmented`): radio buttons in a fieldset named by its legend. */
export function FilterSwitch<V extends string>(props: {
  legend: string;
  value: V;
  options: readonly { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  const name = useId();
  return (
    <fieldset className="m73-filters__switch">
      <legend className="m73-filters__legend">{props.legend}</legend>
      <div className="segmented">
        {props.options.map((o) => (
          <label key={o.value} className="segmented__opt">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={props.value === o.value}
              onChange={() => props.onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** An amount in tabular figures; a USD amount with its INR equivalent under it when known (C6: the frozen INR values, never converted here). */
export function Money(props: { minor: number; currency: Currency; inr?: number | null | undefined }) {
  return (
    <span className="m73-money">
      <span className="tnum m73-money__value">{moneyText(props.minor, props.currency)}</span>
      {props.currency !== "INR" && props.inr != null && (
        <span className="m73-money__inr">{FINANCE_COPY.inrEquivalent(moneyText(props.inr, "INR"))}</span>
      )}
    </span>
  );
}

/** A chart's figures as a table, behind a disclosure under the chart (the chart's accessible twin; the bars already print every figure in words). */
export function TableView({ children }: { children: ReactNode }) {
  return (
    <details className="m73-tableview">
      <summary className="m73-tableview__summary">{PIPELINE_COPY.asTable}</summary>
      <div className="m73-tableview__body">{children}</div>
    </details>
  );
}

/** A report block's loading frame: the chart's box and a few table rows, in skeletons (no spinner for a page load). */
export function ReportSkeleton({ label }: { label: string }) {
  return (
    <div className="m73-skeleton" aria-busy="true">
      <p className="visually-hidden" role="status">
        {label}
      </p>
      <div className="chart" aria-hidden="true">
        <Skeleton width="40%" />
        <div className="m73-skeleton__plot" />
      </div>
      <div className="m73-skeleton__rows" aria-hidden="true">
        <Skeleton width="100%" />
        <Skeleton width="100%" />
        <Skeleton width="100%" />
      </div>
    </div>
  );
}

/**
 * "Export CSV" (C21): reads every page of the export twin (a fresh code first: the step-up dialog opens; one request per page, each audited by the server),
 * then saves the CSV the caller builds. The progress line is polite; a refusal says what happened under the button. A screen closed mid-read stops it.
 */
export function ExportButton<R>(props: {
  read: (onProgress: (n: number) => void, stopped: () => boolean) => Promise<R[] | null>;
  build: (rows: R[]) => string;
  filename: string;
  progress: (n: number) => string;
  /** pipeline and care: the screen's own rows, no code asked */
  local?: boolean;
}) {
  const [phase, setPhase] = useState<
    { kind: "idle" } | { kind: "reading"; n: number } | { kind: "failed"; text: string }
  >({ kind: "idle" });
  const run = useRef(0);
  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );
  async function go() {
    const n = ++run.current;
    const stopped = () => n !== run.current;
    setPhase({ kind: "reading", n: 0 });
    try {
      if (!props.local && !(await ensureStepUp())) {
        if (!stopped()) setPhase({ kind: "failed", text: REVENUE_COPY.exportCancelled });
        return;
      }
      const rows = await props.read((k) => !stopped() && setPhase({ kind: "reading", n: k }), stopped);
      if (!rows || stopped()) return;
      saveFile(csvBlob(props.build(rows)), props.filename);
      setPhase({ kind: "idle" });
    } catch (e) {
      if (!stopped()) setPhase({ kind: "failed", text: reportErrorText(e) });
    }
  }
  const busy = phase.kind === "reading";
  return (
    <div className="m73-export">
      <button
        type="button"
        className="btn btn--secondary"
        onClick={go}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        <Download size={20} />
        {REVENUE_COPY.exportCsv}
      </button>
      {phase.kind === "reading" && !props.local && (
        <p className="m73-export__line" role="status">
          {props.progress(phase.n)}
        </p>
      )}
      {phase.kind === "failed" && <Notice tone="error">{phase.text}</Notice>}
    </div>
  );
}
