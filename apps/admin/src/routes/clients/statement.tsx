// The client's statement of account (M5.5b; ADM-CLI-04, LD78, LD79, Q19, Q57, Q59; finance roles): a range (this financial year to date by default)
// and one currency (the client's by default), the opening and closing balances, every invoice, export invoice, debit note, credit note and payment
// received in the range with a running balance, 50 at a time. The CSV is built in the browser from every page (core `statementCsv`, `statement-v1`,
// fetched only when asked: the gst core is SPA only and lazy); the PDF is made by the jobs Worker on request ("Make PDF", then the tab asks again until
// it is ready; a bell rings too, and its link brings the person back here with the PDF's id, `?pdf=`). Proformas are never listed (LD22, LD78).
import "../../reports.css";
import { fyOf, istDate, toIsoDate } from "@techaust/core/dates";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api, type Currency, type StatementEntryView, type StatementPage } from "../../api.ts";
import { DataTable } from "../../components/data-table.tsx";
import { EmptyState } from "../../components/display.tsx";
import { Download, FileText } from "../../components/icons.tsx";
import { LoadFailed } from "../../components/states.tsx";
import { Notice } from "../../components/ui.tsx";
import {
  documentHref,
  GST_ERRORS,
  isoDayText,
  STATEMENT_COPY,
  STATEMENT_POLL_MS,
  STATEMENT_WAIT_MS,
  statementDetailsText,
  statementErrorText,
} from "../../lib/reports.ts";
import { csvBlob, pollStatementPdf, saveFile } from "../../lib/reports-api.ts";
import { Amount, RangeForm, WideList } from "../reports/parts.tsx";

type Query = { from: string; to: string; currency: Currency };
type Loaded =
  | { state: "loading" }
  | { state: "failed"; error: unknown }
  | {
      state: "ready";
      first: StatementPage;
      entries: StatementEntryView[];
      next: string | null;
      more: boolean;
    };

type Pdf =
  | { state: "idle" }
  | { state: "asking" }
  | { state: "making"; sid: string; since: number }
  | { state: "ready"; blob: Blob; filename: string }
  | { state: "failed"; text: string };

export function StatementTab(props: {
  clientId: string;
  clientCode: string;
  currency: Currency;
  anonymised: boolean;
}) {
  const now = Date.now();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState<Query>({
    from: toIsoDate(istDate(fyOf(now).startMs)),
    to: toIsoDate(istDate(now)),
    currency: props.currency,
  });
  const [currency, setCurrency] = useState<Currency>(props.currency);
  const [page, setPage] = useState<Loaded>({ state: "loading" });
  const [csv, setCsv] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [pdf, setPdf] = useState<Pdf>({ state: "idle" });
  const seq = useRef(0);

  const load = useCallback(
    (q: Query) => {
      const n = ++seq.current;
      setPage({ state: "loading" });
      api.clientStatement(props.clientId, q).then(
        (first) => {
          if (n === seq.current)
            setPage({ state: "ready", first, entries: first.entries, next: first.next, more: false });
        },
        (error) => {
          if (n === seq.current) setPage({ state: "failed", error });
        },
      );
    },
    [props.clientId],
  );

  useEffect(() => {
    load(query);
    return () => {
      seq.current++;
    };
  }, [load, query]);

  function more() {
    if (page.state !== "ready" || !page.next) return;
    const n = seq.current;
    setPage({ ...page, more: true });
    api.clientStatement(props.clientId, { ...query, after: page.next }).then(
      (p) => {
        if (n === seq.current)
          setPage({ ...page, entries: [...page.entries, ...p.entries], next: p.next, more: false });
      },
      (error) => {
        if (n === seq.current) setPage({ state: "failed", error });
      },
    );
  }

  // ---- the PDF: ask, then look again until it is there (or say it is taking long; the bell rings when it is ready) ----
  const watch = useRef(0);
  const follow = useCallback(
    (sid: string, since: number) => {
      const n = ++watch.current;
      setPdf({ state: "making", sid, since });
      const tick = async () => {
        if (n !== watch.current) return;
        try {
          const r = await pollStatementPdf(props.clientId, sid);
          if (n !== watch.current) return;
          if (r.state === "ready") setPdf({ state: "ready", blob: r.blob, filename: r.filename });
          else if (r.state === "failed") setPdf({ state: "failed", text: statementErrorText(r.error) });
          else if (Date.now() - since < STATEMENT_WAIT_MS) setTimeout(tick, STATEMENT_POLL_MS);
          // after the wait the line stays "Making the PDF…": the bell says when it is ready, and the link brings the person back
        } catch (e) {
          if (n === watch.current) setPdf({ state: "failed", text: statementErrorText(e) });
        }
      };
      setTimeout(tick, STATEMENT_POLL_MS);
    },
    [props.clientId],
  );

  useEffect(
    () => () => {
      watch.current++;
    },
    [],
  );

  // A bell's link (`?tab=statement&pdf=<id>`): pick that PDF up.
  const asked = params.get("pdf");
  useEffect(() => {
    if (!asked) return;
    follow(asked, Date.now());
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete("pdf");
        return n;
      },
      { replace: true },
    );
  }, [asked, follow, setParams]);

  async function makePdf() {
    setPdf({ state: "asking" });
    try {
      const r = await api.clientStatementPdf(props.clientId, query);
      follow(r.id, Date.now());
    } catch (e) {
      setPdf({ state: "failed", text: statementErrorText(e) });
    }
  }

  async function downloadCsv() {
    if (page.state !== "ready") return;
    setCsv({ busy: true, error: null });
    try {
      const entries = [...page.entries];
      let after = page.next ?? undefined;
      while (after) {
        const p = await api.clientStatement(props.clientId, { ...query, after });
        entries.push(...p.entries);
        after = p.next ?? undefined;
      }
      // The gst core arrives only now (SPA only, LD16).
      const { statementCsvText } = await import("../../lib/reports-build.ts");
      const text = statementCsvText({
        from: query.from,
        to: query.to,
        openingMinor: page.first.range.openingMinor,
        closingMinor: page.first.range.closingMinor,
        entries,
      });
      if (text === null) throw new Error(GST_ERRORS.internal_error);
      saveFile(
        csvBlob(text),
        `statement-${props.clientCode}-${query.currency}-${query.from}-to-${query.to}.csv`,
      );
      setCsv({ busy: false, error: null });
    } catch (e) {
      setCsv({ busy: false, error: statementErrorText(e) });
    }
  }

  const C = STATEMENT_COPY.columns;
  const cur = query.currency;
  return (
    <div className="statement">
      <div className="statement-controls">
        <RangeForm
          idPrefix="stmt"
          from={query.from}
          to={query.to}
          labels={{ from: STATEMENT_COPY.from, to: STATEMENT_COPY.to, submit: STATEMENT_COPY.show }}
          busy={page.state === "loading"}
          check={(f, t) => (f && t && f <= t ? null : STATEMENT_COPY.periodInvalid)}
          onSubmit={(from, to) => {
            setPdf({ state: "idle" });
            watch.current++;
            setQuery({ from, to, currency });
          }}
        >
          <div className="field">
            <div className="field__head">
              <label htmlFor="stmt-currency">{STATEMENT_COPY.currency}</label>
            </div>
            <div className="field__body">
              <select
                id="stmt-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
              >
                <option value="INR">INR</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>
        </RangeForm>
        <p className="hint">{STATEMENT_COPY.defaultRange}</p>
      </div>

      {page.state === "failed" ? (
        <LoadFailed error={page.error} onRetry={() => load(query)} headingLevel={3} />
      ) : (
        <>
          {page.state === "ready" && (
            <dl className="statement-balances">
              <div>
                <dt>{STATEMENT_COPY.openingLabel(isoDayText(page.first.from))}</dt>
                <dd>
                  <Amount minor={page.first.range.openingMinor} currency={cur} />
                </dd>
              </div>
              <div>
                <dt>{STATEMENT_COPY.debits}</dt>
                <dd>
                  <Amount minor={page.first.range.debitMinor} currency={cur} />
                </dd>
              </div>
              <div>
                <dt>{STATEMENT_COPY.credits}</dt>
                <dd>
                  <Amount minor={page.first.range.creditMinor} currency={cur} />
                </dd>
              </div>
              <div className="statement-balances__closing">
                <dt>{STATEMENT_COPY.closingLabel(isoDayText(page.first.to))}</dt>
                <dd>
                  <Amount minor={page.first.range.closingMinor} currency={cur} />
                </dd>
              </div>
            </dl>
          )}

          <WideList label={STATEMENT_COPY.caption}>
            <DataTable<StatementEntryView>
              caption={STATEMENT_COPY.caption}
              loading={page.state === "loading"}
              rows={page.state === "ready" ? page.entries : []}
              rowKey={(r) => `${r.kind}-${r.id}`}
              empty={
                <EmptyState icon={<FileText />} title={STATEMENT_COPY.empty} headingLevel={3}>
                  {null}
                </EmptyState>
              }
              columns={[
                {
                  key: "date",
                  header: C.date,
                  cell: (r) => <span className="tnum">{isoDayText(r.date)}</span>,
                },
                {
                  key: "document",
                  header: C.document,
                  card: "title",
                  cell: (r) =>
                    r.kind === "receipt" ? (
                      <span className="docno">{r.number}</span>
                    ) : (
                      <Link to={documentHref(r.id)} className="docno report-doclink">
                        {r.number}
                      </Link>
                    ),
                },
                { key: "details", header: C.details, cell: (r) => statementDetailsText(r) },
                {
                  key: "debit",
                  header: C.debit,
                  align: "end",
                  cell: (r) => (r.debitMinor === 0 ? null : <Amount minor={r.debitMinor} currency={cur} />),
                },
                {
                  key: "credit",
                  header: C.credit,
                  align: "end",
                  cell: (r) => (r.creditMinor === 0 ? null : <Amount minor={r.creditMinor} currency={cur} />),
                },
                {
                  key: "balance",
                  header: C.balance,
                  align: "end",
                  cell: (r) => <Amount minor={r.balanceMinor} currency={cur} />,
                },
              ]}
            />
          </WideList>
          {page.state === "ready" && page.next && (
            <button
              type="button"
              className="btn btn--secondary statement-more"
              onClick={more}
              disabled={page.more}
              aria-busy={page.more || undefined}
            >
              {STATEMENT_COPY.more}
            </button>
          )}
          {page.state === "ready" && (
            <div className="report-notes">
              <p className="hint report-note">{STATEMENT_COPY.proformasNote}</p>
              <p className="hint report-note">{STATEMENT_COPY.paymentsNote}</p>
            </div>
          )}

          {page.state === "ready" && page.entries.length > 0 && (
            <div className="statement-actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={downloadCsv}
                disabled={csv.busy}
                aria-busy={csv.busy || undefined}
              >
                <Download size={20} />
                {STATEMENT_COPY.downloadCsv}
              </button>
              {props.anonymised ? (
                <p className="hint">{STATEMENT_COPY.anonymised}</p>
              ) : pdf.state === "ready" ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => saveFile(pdf.blob, pdf.filename)}
                >
                  <Download size={20} />
                  {STATEMENT_COPY.downloadPdf}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={makePdf}
                  disabled={pdf.state === "asking" || pdf.state === "making"}
                  aria-busy={pdf.state === "asking" || pdf.state === "making" || undefined}
                >
                  <FileText size={20} />
                  {pdf.state === "asking" || pdf.state === "making"
                    ? STATEMENT_COPY.making
                    : STATEMENT_COPY.makePdf}
                </button>
              )}
              <p className="hint statement-actions__kept">{STATEMENT_COPY.kept}</p>
            </div>
          )}
          <div aria-live="polite" className="statement-live">
            {(pdf.state === "making" || pdf.state === "asking") && (
              <span className="visually-hidden">{STATEMENT_COPY.making}</span>
            )}
            {pdf.state === "ready" && <span className="visually-hidden">{STATEMENT_COPY.downloadPdf}</span>}
          </div>
          {pdf.state === "failed" && <Notice tone="error">{pdf.text}</Notice>}
          {csv.error && <Notice tone="error">{csv.error}</Notice>}
        </>
      )}
    </div>
  );
}
