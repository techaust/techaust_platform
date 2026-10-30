// The HTML view of a sent proposal or estimate (POR-05), drawn from the same `PdfView` that drew its PDF (packages/pdf `toPdfView`;
// the portal API never sends anything else), so the page and the PDF match by construction: the cover (a proposal), the three blocks
// (From, with TecHaust's GSTIN, proprietor and address as on the PDF; Prepared for; Document), then the sections in the document's own
// order, with the money in the Investment section, the terms, and the acceptance block. Set as one sheet of "paper": a verdigris rule
// under the masthead and the mark's 45° cut on its top-right corner. Every value arrives formatted; this file adds nothing up.
// The fixed words are the PDF's (07-P §1, `@techaust/pdf/copy`) and 07-N §2.
import { PDF_COPY as C } from "@techaust/pdf/copy";
import logoColor from "@techaust/ui/brand/logo-primary-color.svg?url";
import logoDark from "@techaust/ui/brand/logo-primary-dark.svg?url";
import { Fragment, type ReactNode } from "react";
import type { PdfView } from "../../api.ts";
import { N, WORDS } from "../../copy-documents.ts";
import { Download } from "../icons.tsx";
import { PageTitle } from "../shell/portal-shell.tsx";
import { Markdown } from "./markdown.tsx";
import { type Column, RTable } from "./rtable.tsx";

type Section = PdfView["sections"][number];
type Line = PdfView["lines"][number];
type Step = PdfView["schedule"][number];
type SummaryRow = PdfView["summary"][number];

/** A section as the sheet shows it, with its anchor. */
export type SheetSection = Section & { id: string };

/**
 * The sections after the cover, in order, each with an anchor; as on the PDF, the investment, terms and acceptance parts are added
 * at the end when the document has no such section (07-P §2 headings).
 */
export function sheetSections(view: PdfView): SheetSection[] {
  const body = view.sections.filter((s) => s.kind !== "cover");
  const kinds = new Set(body.map((s) => s.kind));
  const all: Section[] = [...body];
  if (!kinds.has("estimate")) all.push({ kind: "estimate", title: C.headings.investment, bodyMd: "" });
  if (!kinds.has("terms")) all.push({ kind: "terms", title: C.headings.terms, bodyMd: "" });
  if (!kinds.has("acceptance")) all.push({ kind: "acceptance", title: C.headings.acceptance, bodyMd: "" });
  const seen = new Map<string, number>();
  return all.map((s) => {
    const n = (seen.get(s.kind) ?? 0) + 1;
    seen.set(s.kind, n);
    // The acceptance block keeps the plain #acceptance (the "Review and accept" links point there), and terms #terms ("Read the terms").
    const id =
      n === 1 ? (s.kind === "acceptance" || s.kind === "terms" ? s.kind : `s-${s.kind}`) : `s-${s.kind}-${n}`;
    return { ...s, id };
  });
}

/** "Name, name@techaust.com" (the view's sender line) as a name and an address, when it has one. */
function contactParts(line: string): { name: string; email: string | null } {
  const at = line.lastIndexOf(", ");
  const email = at > 0 ? line.slice(at + 2) : "";
  return email.includes("@") ? { name: line.slice(0, at), email } : { name: line, email: null };
}

/** A line such as "GSTIN … · State …" wraps only between its parts (as on the PDF). */
function PartsLine({ text, className }: { text: string; className?: string }) {
  const parts = text.split(" · ");
  if (parts.length < 2) return <p className={className}>{text}</p>;
  return (
    <p className={className}>
      {parts.map((p, i) => (
        <Fragment key={p}>
          <span className="keep">{p}</span>
          {i < parts.length - 1 ? " · " : ""}
        </Fragment>
      ))}
    </p>
  );
}

function Masthead({ view }: { view: PdfView }) {
  return (
    <div className="mast">
      <picture>
        <source srcSet={logoDark} media="(prefers-color-scheme: dark)" />
        <img src={logoColor} alt="TecHaust Technologies" className="mast__logo" width="200" height="28" />
      </picture>
      <p className="mast__kind">{view.docLabel}</p>
    </div>
  );
}

function Parties({ view }: { view: PdfView }) {
  const facts: [string, string][] = [
    [C.document.number, `${view.numberDisplay} v${view.version}`],
    [C.document.date, view.issueDate],
    [C.document.validUntil, view.validUntil],
    [C.document.currency, view.currency],
  ];
  return (
    <div className="parties">
      <section className="pblock" aria-labelledby="pb-from">
        <h2 className="pblock__label" id="pb-from">
          {C.blocks.from}
        </h2>
        <p className="pblock__name">{view.supplier.name}</p>
        {view.supplier.lines.map((l) => (
          <PartsLine key={l} text={l} className="pblock__line" />
        ))}
      </section>
      <section className="pblock" aria-labelledby="pb-for">
        <h2 className="pblock__label" id="pb-for">
          {C.blocks.preparedFor}
        </h2>
        <p className="pblock__name">{view.recipient.name}</p>
        {view.recipient.lines.map((l) => (
          <PartsLine key={l} text={l} className="pblock__line" />
        ))}
        <p className="pblock__line">{C.placeOfSupply(view.placeOfSupply)}</p>
        {view.recipient.attention && <p className="pblock__line pblock__attn">{view.recipient.attention}</p>}
      </section>
      <section className="pblock pblock--doc" aria-labelledby="pb-doc">
        <h2 className="pblock__label" id="pb-doc">
          {C.blocks.document}
        </h2>
        <dl className="pfacts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="nowrap">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

/** The cover's lines, one paragraph each (final sweep P5; the same rule as `coverLines` in packages/pdf/src/layout/document.ts). */
const coverLines = (md: string): string => md.replace(/(?<!\n)\n(?!\n)/g, "\n\n");

function Cover({ view }: { view: PdfView }) {
  const cover = view.sections.find((s) => s.kind === "cover");
  const title = view.documentTitle ?? view.docLabel;
  const contact = contactParts(view.footer.contact);
  return (
    <header className="cover">
      <Masthead view={view} />
      <PageTitle text={title} className="cover__title" id="doc-title">
        {title}
      </PageTitle>
      {/* One paragraph per line of the cover, as the PDF prints it (final sweep P5). */}
      {cover?.bodyMd.trim() && <Markdown source={coverLines(cover.bodyMd)} className="cover__lede" />}
      <p className="cover__for">
        {C.cover.preparedFor} <strong>{view.recipient.name}</strong>
      </p>
      <dl className="facts cover__facts">
        <div>
          <dt>{WORDS.doc.number}</dt>
          <dd className="nowrap">{view.numberDisplay}</dd>
        </div>
        <div>
          <dt>{WORDS.doc.version}</dt>
          <dd>{view.version}</dd>
        </div>
        <div>
          <dt>{N.date}</dt>
          <dd className="nowrap">{view.issueDate}</dd>
        </div>
        <div>
          <dt>{WORDS.doc.validUntil}</dt>
          <dd className="nowrap">{view.validUntil}</dd>
        </div>
        <div className="cover__contact">
          <dt>{N.contactAtTecHaust}</dt>
          <dd>
            {contact.name}
            {contact.email && (
              <>
                <br />
                <a href={`mailto:${contact.email}`}>{contact.email}</a>
              </>
            )}
          </dd>
        </div>
      </dl>
    </header>
  );
}

/** An estimate has no cover: the masthead, its title and the notice open the sheet. */
function EstimateHead({ view }: { view: PdfView }) {
  const title = view.documentTitle ?? `${view.docLabel} ${view.numberDisplay}`;
  return (
    <header className="cover cover--estimate">
      <Masthead view={view} />
      <PageTitle text={title} className="cover__title" id="doc-title">
        {title}
      </PageTitle>
      <p className="cover__for">
        {C.cover.preparedFor} <strong>{view.recipient.name}</strong>
      </p>
      {view.notice && <p className="sheet-notice">{view.notice}</p>}
    </header>
  );
}

function LinesTable({ view }: { view: PdfView }) {
  const L = C.lines;
  const withDiscount = view.lines.some((l) => l.discount !== null);
  const cols: Column<Line>[] = [
    { key: "n", label: L.n, cell: (l) => l.n, hideOnCard: true },
    {
      key: "desc",
      label: L.description,
      lead: true,
      cell: (l) => (
        <span className="lcell">
          <span className="lcell__desc">{l.description}</span>
          {l.detail && <span className="lcell__detail">{l.detail}</span>}
          {l.sac && (
            <span className="lcell__sac">
              {L.sac} {l.sac}
            </span>
          )}
        </span>
      ),
    },
    { key: "qty", label: L.qty, num: true, cell: (l) => l.qty, cardCell: (l) => `${l.qty} ${l.unit}` },
    { key: "unit", label: L.unit, cell: (l) => l.unit, hideOnCard: true },
    { key: "rate", label: L.rate, num: true, cell: (l) => l.rate },
    ...(withDiscount
      ? [{ key: "disc", label: L.discount, num: true, cell: (l: Line) => l.discount ?? "" } as Column<Line>]
      : []),
    { key: "taxable", label: L.taxable, num: true, cell: (l) => l.taxable },
    { key: "gst", label: L.gst, num: true, cell: (l) => l.gstRate },
  ];
  return (
    <RTable
      className="rtable--lines"
      caption={WORDS.kind[view.type]}
      columns={cols}
      rows={view.lines}
      rowKey={(l) => l.n}
    />
  );
}

function Totals({ view }: { view: PdfView }) {
  return (
    <div className="money__totals">
      <dl className="totals">
        {view.totals.map((t) => (
          <div key={t.key} className={t.strong ? "is-strong" : undefined}>
            <dt>{t.label}</dt>
            <dd className="num">{t.value}</dd>
          </div>
        ))}
      </dl>
      <div className="money__notes">
        <p className="words">{C.words(view.words)}</p>
        <p className="money__note">{view.currency === "INR" ? C.inrNote : C.usdNote}</p>
        {view.inrNote && <p className="money__note">{view.inrNote}</p>}
      </div>
    </div>
  );
}

function SummaryTable({ view }: { view: PdfView }) {
  if (view.summary.length === 0) return null;
  const S = C.summary;
  const intra = view.totals.some((t) => t.key === "cgst");
  const cols: Column<SummaryRow>[] = [
    { key: "sac", label: C.lines.sac, lead: true, cell: (r) => r.sac ?? "" },
    { key: "rate", label: C.lines.gst, num: true, cell: (r) => r.rate },
    { key: "taxable", label: S.taxable, num: true, cell: (r) => r.taxable },
    ...(intra
      ? [
          { key: "cgst", label: S.cgst, num: true, cell: (r: SummaryRow) => r.cgst },
          { key: "sgst", label: S.sgst, num: true, cell: (r: SummaryRow) => r.sgst },
        ]
      : [{ key: "igst", label: S.igst, num: true, cell: (r: SummaryRow) => r.igst }]),
  ];
  return (
    <>
      <h3 className="dsub">{S.heading}</h3>
      <RTable
        caption={S.heading}
        columns={cols}
        rows={view.summary}
        rowKey={(r) => `${r.sac ?? ""}-${r.rate}`}
      />
    </>
  );
}

function ScheduleTable({ view, withDetail }: { view: PdfView; withDetail: boolean }) {
  if (view.schedule.length === 0) return null;
  const S = C.schedule;
  const cols: Column<Step>[] = [
    {
      key: "label",
      label: S.instalment,
      lead: true,
      cell: (s) => (
        <span className="lcell">
          <span className="lcell__desc">{s.label}</span>
          {withDetail && s.detail && <span className="lcell__detail">{s.detail}</span>}
        </span>
      ),
    },
    { key: "when", label: S.when, cell: (s) => (withDetail && s.date ? `${s.when} (${s.date})` : s.when) },
    { key: "share", label: S.share, num: true, cell: (s) => s.share },
    { key: "amount", label: S.amount, num: true, cell: (s) => s.amount },
  ];
  return (
    <>
      <h3 className="dsub">{S.heading}</h3>
      <RTable
        caption={S.heading}
        columns={cols}
        rows={view.schedule}
        rowKey={(s) => `${s.label}-${s.share}`}
      />
    </>
  );
}

function TimelineTable({ view }: { view: PdfView }) {
  if (view.schedule.length === 0) return null;
  const T = C.timeline;
  const cols: Column<Step>[] = [
    { key: "m", label: T.milestone, lead: true, cell: (s) => s.label },
    { key: "what", label: T.whatYouGet, cell: (s) => s.detail ?? "" },
    { key: "date", label: T.targetDate, cell: (s) => s.date ?? "" },
    { key: "pay", label: T.payment, num: true, cell: (s) => s.share },
  ];
  return (
    <RTable
      caption={T.milestone}
      columns={cols}
      rows={view.schedule}
      rowKey={(s) => `${s.label}-${s.share}`}
    />
  );
}

function SectionBlock(props: {
  s: SheetSection;
  className?: string;
  /** Leave the section's own text out (the Acceptance text once the version can no longer be accepted). */
  noBody?: boolean | undefined;
  children?: ReactNode;
}) {
  const { s } = props;
  return (
    <section
      className={props.className ? `dsec ${props.className}` : "dsec"}
      id={s.id}
      aria-labelledby={`${s.id}-h`}
    >
      <h2 id={`${s.id}-h`} className="dsec__title">
        {s.title}
      </h2>
      {!props.noBody && s.bodyMd.trim() && <Markdown source={s.bodyMd} className="prose" />}
      {props.children}
    </section>
  );
}

export function DocumentPaper(props: {
  view: PdfView;
  /** The acceptance block's content (the decision panel, a record, or a notice). */
  decision: ReactNode;
  /**
   * The version can still be accepted here. When it can't (decided, expired, or replaced), the Acceptance section's own text
   * ("To accept, open this proposal…") is left out and only the record or the notice shows (FX-3, A4 7).
   */
  acceptOpen: boolean;
  onDownload: () => void;
  downloading?: boolean | undefined;
}) {
  const { view } = props;
  const sections = sheetSections(view);
  const hasTimeline = sections.some((s) => s.kind === "timeline") && view.schedule.length > 0;

  return (
    <article className="paper" aria-labelledby="doc-title">
      <div className="paper__sheet">
        {view.type === "proposal" ? <Cover view={view} /> : <EstimateHead view={view} />}
        <Parties view={view} />
        {sections.map((s) => {
          switch (s.kind) {
            case "timeline":
              return (
                <SectionBlock key={s.id} s={s}>
                  <TimelineTable view={view} />
                </SectionBlock>
              );
            case "estimate":
              return (
                <SectionBlock key={s.id} s={s} className="dsec--money">
                  <LinesTable view={view} />
                  <Totals view={view} />
                  <SummaryTable view={view} />
                  <ScheduleTable view={view} withDetail={!hasTimeline} />
                </SectionBlock>
              );
            case "terms":
              return (
                <SectionBlock key={s.id} s={s}>
                  {!s.bodyMd.trim() && <p className="terms__version">{C.termsLine(view.terms.version)}</p>}
                  <Markdown source={view.terms.bodyMd} className="prose terms" />
                </SectionBlock>
              );
            case "acceptance":
              return (
                <SectionBlock key={s.id} s={s} className="dsec--decision" noBody={!props.acceptOpen}>
                  {/* The validity line and its PDF button serve a decision still to make: once decided (or expired, or replaced), the
                      decision block says what happened and offers its own downloads (final sweep P14). */}
                  {props.acceptOpen && (
                    <div className="validity">
                      <p className="validity__line">{view.validityNote}</p>
                      <button
                        type="button"
                        className="btn btn--secondary"
                        onClick={props.onDownload}
                        disabled={props.downloading}
                        aria-busy={props.downloading || undefined}
                      >
                        <Download size={20} />
                        {WORDS.downloadPdf}
                      </button>
                    </div>
                  )}
                  {props.decision}
                </SectionBlock>
              );
            default:
              return <SectionBlock key={s.id} s={s} />;
          }
        })}
        <footer className="paper__foot">
          <p>{view.integrity}</p>
        </footer>
      </div>
    </article>
  );
}
