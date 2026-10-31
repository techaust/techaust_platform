// The payments and TDS register (M6.1, 07-ZH line 20; ADM-PAY-06, ADM-INV-16): one financial year of confirmed payments and TDS entries, read page by page
// from GET /reports/payments, built into one CSV in the browser (money rows first, then the TDS rows apart for Form 26AS and AIS matching), and the TDS
// entries still waiting for their certificate (L19), so the Owner can chase them. Pending, rejected and withdrawn entries are not in it (L23.6).
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { type PaymentsRegisterRow, paymentsApi } from "../../api.ts";
import { EmptyState } from "../../components/display.tsx";
import { CheckCircle, Download, FileText } from "../../components/icons.tsx";
import { Notice } from "../../components/ui.tsx";
import { amountText, fyChoices, PAY_COPY, PAY_UI, payErrorText, registerCsv } from "../../lib/payments.ts";
import { csvBlob, saveFile } from "../../lib/reports-api.ts";
import { bpToPercent } from "../../lib/settings-form.ts";
import { paymentHref } from "../payments/panel.tsx";
import { day } from "../payments/parts.tsx";
import { ReportFrame } from "./frame.tsx";
import { Progress, ReportBlock, WideList } from "./parts.tsx";

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; count: number }
  | { kind: "done"; rows: PaymentsRegisterRow[]; fy: string }
  | { kind: "failed"; text: string };

export function PaymentsRegister() {
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
      const rows: PaymentsRegisterRow[] = [];
      let after: string | undefined;
      do {
        const p = await paymentsApi.register(fy, after);
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
    <ReportFrame title={PAY_COPY.register} lede={PAY_UI.registerLede}>
      <div className="report-controls">
        <form className="range-form" onSubmit={show} noValidate>
          <div className="range-form__fields">
            <div className="field">
              <div className="field__head">
                <label htmlFor="pay-fy">{PAY_UI.fy}</label>
              </div>
              <div className="field__body">
                <select id="pay-fy" value={fy} onChange={(e) => setFy(e.target.value)}>
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
        {phase.kind === "reading" && <Progress text={PAY_UI.registerDone(phase.count)} />}
        {phase.kind === "failed" && <Notice tone="error">{phase.text}</Notice>}
        {phase.kind === "done" && <Results rows={phase.rows} fy={phase.fy} />}
      </div>
    </ReportFrame>
  );
}

function Results({ rows, fy }: { rows: PaymentsRegisterRow[]; fy: string }) {
  if (rows.length === 0)
    return (
      <div tabIndex={-1} className="report-empty">
        <EmptyState icon={<FileText />} title={PAY_UI.registerEmpty.replace(/\.$/, "")}>
          {null}
        </EmptyState>
      </div>
    );
  const awaiting = rows.filter((r) => r.kind === "tds" && r.tds?.certificateAwaited);
  const label = choicesLabel(fy);
  return (
    <>
      <h2 className="report-done" tabIndex={-1}>
        <span>{PAY_UI.registerDone(rows.length)}</span>
      </h2>
      <div className="report-downloads">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => saveFile(csvBlob(registerCsv(rows)), `payments_and_tds_register-FY${label}.csv`)}
        >
          <Download size={20} />
          {PAY_UI.download}
        </button>
      </div>
      <ReportBlock id="pay-awaiting" title={PAY_UI.awaitingHeading}>
        {awaiting.length === 0 ? (
          <p className="panel-empty">
            <CheckCircle size={20} />
            <span>{PAY_UI.awaitingNone}</span>
          </p>
        ) : (
          <WideList className="rledger-scroll" label={PAY_UI.awaitingHeading}>
            <table className="rledger rledger--plain">
              <caption className="visually-hidden">{PAY_UI.awaitingHeading}</caption>
              <thead>
                <tr>
                  <th scope="col">{PAY_COPY.dateReceived}</th>
                  <th scope="col">{PAY_UI.colClient}</th>
                  <th scope="col">{PAY_UI.allocInvoice}</th>
                  <th scope="col">{PAY_COPY.tdsSection}</th>
                  <th scope="col" className="num">
                    {PAY_COPY.tdsRate}
                  </th>
                  <th scope="col" className="num">
                    {PAY_COPY.tdsAmount}
                  </th>
                </tr>
              </thead>
              <tbody>
                {awaiting.map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className="tnum">
                      <Link to={paymentHref(r.id)} className="pay-row__link">
                        {day(r.receivedOn)}
                      </Link>
                    </th>
                    <td>
                      {r.client.name} <span className="docno">{r.client.code}</span>
                    </td>
                    <td className="docno">
                      {r.allocations
                        .filter((a) => a.kind === "allocate")
                        .map((a) => a.number)
                        .join(", ")}
                    </td>
                    <td>{r.tds?.section}</td>
                    <td className="num tnum">
                      {r.tds?.rateBp != null ? `${bpToPercent(r.tds.rateBp)} %` : ""}
                    </td>
                    <td className="num tnum">{amountText(r.amountMinor, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </WideList>
        )}
      </ReportBlock>
    </>
  );
}

const choicesLabel = (token: string) => `20${token.slice(0, 2)}-${token.slice(2)}`;
