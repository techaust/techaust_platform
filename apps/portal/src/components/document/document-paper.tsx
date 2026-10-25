// The HTML view of a sent proposal or estimate (POR-05), section for section as the PDF (docs/06 §7.4): the cover, then
// summary, goals, scope, deliverables, timeline, investment (lines, tax summary by SAC and rate, totals), the payment
// schedule, assumptions, terms, the validity line and the acceptance block. Set as one sheet of "paper" on the page: a
// verdigris rule along its top edge and the mark's 45° cut on its top-right corner. Every figure is the frozen
// snapshot's, computed by the M4.2 engine on the server; this file only formats.
import logoColor from "@techaust/ui/brand/logo-primary-color.svg?url";
import logoDark from "@techaust/ui/brand/logo-primary-dark.svg?url";
import { formatDate, formatMoney, money, negate, percentFromBp } from "@techaust/core";
import type { ComputedLine, ScheduleInstalment, SummaryRow } from "@techaust/core/tax";
import type { ReactNode } from "react";
import { PENDING, WORDS } from "../../copy-documents.ts";
import { amount, type DocumentView, type LineText, type Milestone } from "../../lib/document-view.ts";
import { Check, Download } from "../icons.tsx";
import { PageTitle } from "../shell/portal-shell.tsx";
import { type Column, RTable } from "./rtable.tsx";

const W = WORDS.doc;

/** The sections in order, for the contents list beside the document. */
export const SECTIONS = [
  { id: "summary", label: W.summary },
  { id: "goals", label: W.goals },
  { id: "scope", label: W.scope },
  { id: "deliverables", label: W.deliverables },
  { id: "timeline", label: W.timeline },
  { id: "investment", label: W.investment },
  { id: "schedule", label: W.schedule },
  { id: "assumptions", label: W.assumptions },
  { id: "terms", label: W.terms },
  { id: "acceptance", label: W.acceptance },
] as const;

const pct = (bp: number) => `${percentFromBp(bp)} %`;

// The trigger in words, as core's schedule-text says it on the website (on acceptance, at the ‹milestone›, on delivery).
function triggerText(s: ScheduleInstalment): string {
  switch (s.trigger) {
    case "on_accept":
      return "On acceptance";
    case "delivery":
      return "On delivery";
    case "monthly":
      return "Monthly in advance";
    default:
      return `At the ${s.label.charAt(0).toLowerCase()}${s.label.slice(1)}`;
  }
}

function Section(props: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="dsec" id={props.id} aria-labelledby={`${props.id}-h`}>
      <h2 id={`${props.id}-h`} className="dsec__title">
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

function Facts(props: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={`facts ${props.className ?? ""}`}>
      {props.rows.map(([k, v], i) => (
        <div key={String(i)}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DocumentPaper(props: {
  doc: DocumentView;
  /** The acceptance block's content (the decision panel, or a notice). */
  decision: ReactNode;
  onDownload: () => void;
}) {
  const { doc } = props;
  const c = doc.computed;
  const cur = doc.currency;
  const m = (minor: number) => amount(minor, cur);
  const intra = c.supply.type === "intra";
  const lut = c.supply.type === "export_lut";
  type Row = { text: LineText; line: ComputedLine };
  const rows: Row[] = c.lines.map((line, i) => ({ line, text: doc.lines[i] as LineText }));

  const lineCols: Column<Row>[] = [
    { key: "no", label: W.lineNo, cell: (r) => r.line.index + 1, hideOnCard: true },
    {
      key: "desc",
      label: W.description,
      lead: true,
      cell: (r) => (
        <span className="lcell">
          <span className="lcell__desc">{r.text.description}</span>
          {r.text.detail && <span className="lcell__detail">{r.text.detail}</span>}
          {r.line.sac && (
            <span className="lcell__sac">
              {W.sac} {r.line.sac}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "qty",
      label: W.qty,
      num: true,
      cell: (r) => r.text.qty,
      cardCell: (r) => `${r.text.qty} ${r.text.unit}`,
    },
    { key: "unit", label: W.unit, cell: (r) => r.text.unit, hideOnCard: true },
    { key: "rate", label: W.rate, num: true, cell: (r) => m(r.text.rateMinor) },
    {
      key: "disc",
      label: W.discount,
      num: true,
      cell: (r) => (r.line.discountMinor ? formatMoney(negate(money(r.line.discountMinor, cur))) : "–"),
    },
    { key: "taxable", label: W.taxable, num: true, cell: (r) => m(r.line.taxableMinor) },
    {
      key: "gst",
      label: W.gstPct,
      num: true,
      cell: (r) => (lut ? W.zeroRated : pct(r.line.effectiveRateBp)),
    },
  ];

  const sumCols: Column<SummaryRow>[] = [
    { key: "sac", label: W.sac, lead: true, cell: (s) => s.sac ?? "–" },
    { key: "rate", label: W.gstPct, num: true, cell: (s) => (lut ? W.zeroRated : pct(s.effectiveRateBp)) },
    { key: "taxable", label: W.taxable, num: true, cell: (s) => m(s.taxableMinor) },
    ...(intra
      ? [
          { key: "cgst", label: W.cgst, num: true, cell: (s: SummaryRow) => m(s.cgstMinor) },
          { key: "sgst", label: W.sgst, num: true, cell: (s: SummaryRow) => m(s.sgstMinor) },
        ]
      : [{ key: "igst", label: W.igst, num: true, cell: (s: SummaryRow) => m(s.igstMinor) }]),
  ];

  const milestoneCols: Column<Milestone>[] = [
    { key: "name", label: W.milestone, lead: true, cell: (r) => r.name },
    { key: "what", label: W.whatYouGet, cell: (r) => r.what },
    { key: "date", label: W.targetDate, cell: (r) => formatDate(r.target) },
    { key: "pct", label: W.paymentPct, num: true, cell: (r) => pct(r.pctBp) },
  ];

  const scheduleCols: Column<ScheduleInstalment>[] = [
    { key: "label", label: W.instalment, lead: true, cell: (s) => s.label },
    { key: "when", label: W.trigger, cell: triggerText },
    { key: "pct", label: W.pct, num: true, cell: (s) => pct(s.pctBp) },
    { key: "amount", label: W.amount, num: true, cell: (s) => m(s.amountMinor) },
  ];

  const totals: { label: ReactNode; value: ReactNode; strong?: boolean }[] = [
    { label: W.subtotal, value: m(c.subtotalMinor) },
    ...(c.discountMinor
      ? [{ label: W.discount, value: formatMoney(negate(money(c.discountMinor, cur))) }]
      : []),
    { label: W.taxable, value: m(c.taxableMinor) },
    ...(intra
      ? [
          { label: W.cgst, value: m(c.cgstMinor) },
          { label: W.sgst, value: m(c.sgstMinor) },
        ]
      : [{ label: lut ? `${W.igst}, ${W.zeroRated}` : W.igst, value: m(c.igstMinor) }]),
    ...(c.roundOffMinor ? [{ label: W.roundOff, value: m(c.roundOffMinor) }] : []),
    { label: W.total, value: m(c.totalMinor), strong: true },
  ];

  return (
    <article className="paper" aria-labelledby="doc-title">
      <div className="paper__sheet">
        <header className="cover">
          <div className="cover__top">
            <picture>
              <source srcSet={logoDark} media="(prefers-color-scheme: dark)" />
              <img
                src={logoColor}
                alt="TecHaust Technologies"
                className="cover__logo"
                width="200"
                height="28"
              />
            </picture>
            <p className="cover__kind">{WORDS.kind[doc.kind]}</p>
          </div>
          <PageTitle text={doc.title} className="cover__title" id="doc-title">
            {doc.title}
          </PageTitle>
          <p className="cover__for">
            {W.preparedFor} <strong>{doc.client.name}</strong>
          </p>
          <Facts
            className="cover__facts"
            rows={[
              [
                W.number,
                <span key="n" className="nowrap">
                  {doc.number}
                </span>,
              ],
              [W.version, doc.version],
              [PENDING.date, formatDate(doc.sentOn)],
              [W.validUntil, formatDate(doc.validUntil)],
              [
                PENDING.contactAtTecHaust,
                <span key="c">
                  {doc.contact.name}
                  <br />
                  <a href={`mailto:${doc.contact.email}`}>{doc.contact.email}</a>
                </span>,
              ],
            ]}
          />
        </header>

        <Section id="summary" title={W.summary}>
          <p className="prose">{doc.summary.outcome}</p>
          <div className="headline">
            <div>
              <p className="headline__label">{W.total}</p>
              <p className="headline__value">{m(c.totalMinor)}</p>
            </div>
            <div>
              <p className="headline__label">{W.timeline}</p>
              <p className="headline__value headline__value--text">{doc.summary.timeline}</p>
            </div>
          </div>
        </Section>

        <Section id="goals" title={W.goals}>
          <p className="prose">{doc.goals.intro}</p>
          <ul className="prose-list">
            {doc.goals.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Section>

        <Section id="scope" title={W.scope}>
          <div className="scope">
            <div>
              <h3 className="dsub">{PENDING.inScope}</h3>
              <ul className="ticks">
                {doc.scope.inScope.map((p) => (
                  <li key={p}>
                    <Check size={20} />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="dsub">{PENDING.outOfScope}</h3>
              <ul className="dashes">
                {doc.scope.outOfScope.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        <Section id="deliverables" title={W.deliverables}>
          <ul className="ticks">
            {doc.deliverables.map((p) => (
              <li key={p}>
                <Check size={20} />
                {p}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="timeline" title={W.timeline}>
          <RTable caption={W.timeline} columns={milestoneCols} rows={doc.milestones} rowKey={(r) => r.name} />
        </Section>

        <Section id="investment" title={W.investment}>
          <Facts
            className="party"
            rows={[
              [
                W.preparedFor,
                <span key="p">
                  <strong>{doc.client.name}</strong>
                  {doc.client.addressLines.map((l) => (
                    <span key={l} className="line">
                      {l}
                    </span>
                  ))}
                </span>,
              ],
              [W.gstin, doc.client.gstin ?? "–"],
              [W.placeOfSupply, doc.client.placeOfSupply],
            ]}
          />
          <RTable
            className="rtable--lines"
            caption={W.investment}
            columns={lineCols}
            rows={rows}
            rowKey={(r) => String(r.line.index)}
          />
          <h3 className="dsub">{W.taxSummary}</h3>
          <RTable
            caption={W.taxSummary}
            columns={sumCols}
            rows={[...c.summary]}
            rowKey={(s) => `${s.sac}-${s.gstRateBp}`}
          />
          <dl className="totals">
            {totals.map((t, i) => (
              <div key={String(i)} className={t.strong ? "is-strong" : undefined}>
                <dt>{t.label}</dt>
                <dd className="num">{t.value}</dd>
              </div>
            ))}
          </dl>
          <p className="words">
            <span className="words__label">{PENDING.inWords}</span> {c.words}
          </p>
          {doc.kind === "estimate" && <p className="muted">{W.estimateNote}</p>}
        </Section>

        <Section id="schedule" title={W.schedule}>
          <RTable caption={W.schedule} columns={scheduleCols} rows={doc.schedule} rowKey={(s) => s.label} />
        </Section>

        <Section id="assumptions" title={W.assumptions}>
          <ul className="prose-list">
            {doc.assumptions.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Section>

        <Section id="terms" title={W.terms}>
          <p className="muted terms__version">{doc.terms.version}</p>
          {doc.terms.paragraphs.map((p) => (
            <p key={p} className="prose">
              {p}
            </p>
          ))}
        </Section>

        <div className="validity">
          <p className="validity__line">
            {W.validUntil} <strong className="nowrap">{formatDate(doc.validUntil)}</strong>
          </p>
          <button type="button" className="btn btn--secondary" onClick={props.onDownload}>
            <Download size={20} />
            {WORDS.downloadPdf}
          </button>
        </div>

        <section className="dsec dsec--decision" id="acceptance" aria-labelledby="acceptance-h">
          <h2 id="acceptance-h" className="dsec__title">
            {W.acceptance}
          </h2>
          {props.decision}
        </section>

        <footer className="paper__foot">
          <p>
            Document ID <span className="nowrap">{doc.documentId}</span> · Content fingerprint{" "}
            <span className="nowrap">{doc.fingerprint}</span>
          </p>
        </footer>
      </div>
    </article>
  );
}
