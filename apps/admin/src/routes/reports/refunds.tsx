// The refunds register (M6.5, B4; ADM-PAY-08, L9): one financial year of the refunds that went out, read page by page from GET /reports/refunds (a fresh code
// on every page, as the GST registers: `request` opens the step-up dialog when the server asks and sends the same page again) and built into one `refunds-v1`
// CSV in the browser (core `refundsRegisterCsv`). The payments register's screen and parts, no new design: the FY picker, "Show", the count, the download.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { EmptyState } from "../../components/display.tsx";
import { Download, FileText } from "../../components/icons.tsx";
import { Notice } from "../../components/ui.tsx";
import { fyChoices, PAY_UI, payErrorText } from "../../lib/payments.ts";
import { REFUNDS_REPORT_COPY as C, GST_COPY } from "../../lib/reports.ts";
import { csvBlob, type RefundsRegisterApiRow, reportsApi, saveFile } from "../../lib/reports-api.ts";
import { buildRefundsRegister } from "../../lib/reports-build.ts";
import { ReportFrame } from "./frame.tsx";
import { ProblemList, Progress } from "./parts.tsx";

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; count: number }
  | { kind: "done"; rows: RefundsRegisterApiRow[]; fy: string }
  | { kind: "failed"; text: string };

export function RefundsRegister() {
  const choices = fyChoices();
  const [fy, setFy] = useState(choices[0]?.token ?? "");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const run = useRef(0);
  const results = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );

  async function show(e: FormEvent) {
    e.preventDefault();
    const n = ++run.current;
    const stopped = () => n !== run.current;
    setPhase({ kind: "reading", count: 0 });
    try {
      const rows: RefundsRegisterApiRow[] = [];
      let after: string | undefined;
      do {
        const p = await reportsApi.refunds(fy, after);
        if (stopped()) return;
        rows.push(...p.rows);
        setPhase({ kind: "reading", count: rows.length });
        after = p.next ?? undefined;
      } while (after);
      setPhase({ kind: "done", rows, fy });
      requestAnimationFrame(() => results.current?.querySelector<HTMLElement>("[tabindex='-1']")?.focus());
    } catch (err) {
      if (!stopped()) setPhase({ kind: "failed", text: payErrorText(err) });
    }
  }

  return (
    <ReportFrame title={C.title} lede={C.lede}>
      <div className="report-controls">
        <form className="range-form" onSubmit={show} noValidate>
          <div className="range-form__fields">
            <div className="field">
              <div className="field__head">
                <label htmlFor="refunds-fy">{PAY_UI.fy}</label>
              </div>
              <div className="field__body">
                <select id="refunds-fy" value={fy} onChange={(e) => setFy(e.target.value)}>
                  {choices.map((c) => (
                    <option key={c.token} value={c.token}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="range-form__go">
              <button
                type="submit"
                className="btn btn--primary"
                disabled={phase.kind === "reading"}
                aria-busy={phase.kind === "reading" || undefined}
              >
                {PAY_UI.read}
              </button>
            </div>
          </div>
        </form>
      </div>
      <div ref={results} className="report-results">
        {phase.kind === "reading" && <Progress text={C.done(phase.count)} />}
        {phase.kind === "failed" && <Notice tone="error">{phase.text}</Notice>}
        {phase.kind === "done" && <Results rows={phase.rows} fy={phase.fy} />}
      </div>
    </ReportFrame>
  );
}

function Results({ rows, fy }: { rows: RefundsRegisterApiRow[]; fy: string }) {
  if (rows.length === 0)
    return (
      <div tabIndex={-1} className="report-empty">
        <EmptyState icon={<FileText />} title={C.empty.replace(/\.$/, "")}>
          {null}
        </EmptyState>
      </div>
    );
  const built = buildRefundsRegister(rows);
  if (!built.ok)
    return (
      <ProblemList
        id="refunds-problems"
        problems={built.problems}
        heading={GST_COPY.errorsHeading(built.problems.length)}
      />
    );
  const label = `20${fy.slice(0, 2)}-${fy.slice(2)}`;
  return (
    <>
      <h2 className="report-done" tabIndex={-1}>
        <span>{C.done(built.count)}</span>
      </h2>
      <div className="report-downloads">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => saveFile(csvBlob(built.csv), `refunds_register-FY${label}.csv`)}
        >
          <Download size={20} />
          {C.download}
        </button>
      </div>
    </>
  );
}
