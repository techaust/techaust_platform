// The figures of a proposal or estimate as the server worked them out (ADM-PROP-03, docs/06 §5.3 TaxBreakdown): the tax preview (place of
// supply, CGST and SGST or IGST, round-off, total, total in words), and the read-only lines and schedule tables of a sent version.
// Every amount is the server's, formatted through core; nothing is added or rounded here.
import type { Currency } from "../../api.ts";
import { Markdown } from "../../components/markdown.tsx";
import { milliToQty, TRIGGER_LABELS, UNIT_LABELS } from "../../lib/catalogue.ts";
import {
  DOC_COPY,
  DOC_PENDING,
  dayText,
  discountRowLabel,
  inWords,
  lineColumns,
  lineTaxText,
  moneyText,
  placeOfSupplyLabel,
  placeOfSupplyText,
  taxLinesOf,
} from "../../lib/documents.ts";
import type { LineFigures, Supply, Totals, ViewLine, ViewStep } from "../../lib/documents-api.ts";
import { bpToPercent } from "../../lib/settings-form.ts";

/** The totals block: what the document comes to, and why. */
export function TaxPreview(props: {
  totals: Totals | null;
  supply: Supply | null;
  currency: Currency;
  /** A sent version shows the figures as frozen, without the "preview" line. */
  frozen?: boolean;
  busy?: boolean;
  /** FX-4 (A5 3): where the discount comes from (`discountSources`, `draftDiscountSources`), so the row is named for it. */
  discounts?: { lines: boolean; document: boolean } | undefined;
}) {
  const { totals: t, supply, currency } = props;
  if (!t) return null;
  const kinds = taxLinesOf(supply);
  return (
    <div className="tax-preview" aria-busy={props.busy || undefined}>
      {supply && (
        <p className="tax-preview__pos">{placeOfSupplyText(placeOfSupplyLabel(supply.placeOfSupplyCode))}</p>
      )}
      <dl className="totals">
        {t.discountMinor > 0 && (
          <div className="totals__row">
            <dt>{discountRowLabel(props.discounts ?? { lines: false, document: true })}</dt>
            <dd className="tnum">{moneyText(t.discountMinor, currency)}</dd>
          </div>
        )}
        <div className="totals__row">
          <dt>{lineColumns.taxable}</dt>
          <dd className="tnum">{moneyText(t.taxableMinor, currency)}</dd>
        </div>
        {kinds.map((k) => (
          <div className="totals__row" key={k}>
            <dt>{DOC_COPY[k]}</dt>
            <dd className="tnum">
              {moneyText(k === "cgst" ? t.cgstMinor : k === "sgst" ? t.sgstMinor : t.igstMinor, currency)}
            </dd>
          </div>
        ))}
        {t.roundOffMinor !== 0 && (
          <div className="totals__row">
            <dt>{DOC_COPY.roundOff}</dt>
            <dd className="tnum">{moneyText(t.roundOffMinor, currency)}</dd>
          </div>
        )}
        <div className="totals__row totals__row--total">
          <dt>{DOC_COPY.total}</dt>
          <dd className="tnum">{moneyText(t.totalMinor, currency)}</dd>
        </div>
      </dl>
      <p className="tax-preview__words">{inWords(t.words)}</p>
      {!props.frozen && <p className="hint tax-preview__note">{DOC_COPY.previewNote}</p>}
    </div>
  );
}

const discountText = (l: ViewLine, currency: Currency) =>
  !l.discount
    ? ""
    : l.discount.kind === "percent"
      ? `${bpToPercent(l.discount.value)} %`
      : moneyText(l.discount.value, currency);

/** A sent version's lines: a plain table (scrolls sideways inside its box on a phone). */
export function LinesTable(props: { lines: ViewLine[]; currency: Currency; supply: Supply | null }) {
  const { currency } = props;
  return (
    // A box that may scroll sideways on a phone is a Tab stop of its own, so keyboard users can scroll it (WCAG 2.1.1).
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable
    <section className="read-lines" aria-label="Lines" tabIndex={0}>
      <table>
        <caption className="visually-hidden">Lines</caption>
        <thead>
          <tr>
            <th scope="col">{lineColumns.description}</th>
            <th scope="col" className="num">
              {lineColumns.quantity}
            </th>
            <th scope="col" className="num">
              {lineColumns.rate}
            </th>
            <th scope="col" className="num">
              {lineColumns.taxable}
            </th>
            <th scope="col" className="num">
              {lineColumns.tax}
            </th>
            <th scope="col" className="num">
              {lineColumns.amount}
            </th>
          </tr>
        </thead>
        <tbody>
          {props.lines.map((l) => {
            const f: LineFigures = l;
            return (
              <tr key={l.id}>
                <th scope="row">
                  <span className="read-lines__desc">{l.description}</span>
                  {l.detail && <span className="read-lines__detail">{l.detail}</span>}
                  {l.catalogueItemId === null && (
                    <span className="read-lines__custom">{DOC_COPY.customLine}</span>
                  )}
                </th>
                <td className="num">
                  {milliToQty(l.qtyMilli)}
                  <span className="read-lines__unit">
                    {UNIT_LABELS[l.unit as keyof typeof UNIT_LABELS] ?? l.unit}
                  </span>
                </td>
                <td className="num">
                  {moneyText(l.rateMinor, currency)}
                  {l.discount && (
                    <span className="read-lines__unit">
                      {lineColumns.discount} {discountText(l, currency)}
                    </span>
                  )}
                </td>
                <td className="num">{f.taxableMinor === null ? "" : moneyText(f.taxableMinor, currency)}</td>
                <td className="num">
                  {/* CGST and SGST one under the other, so the column stays narrow. */}
                  {lineTaxText(f, currency, props.supply)
                    .split(" + ")
                    .map((part, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: CGST then SGST, a fixed pair that never reorders (equal amounts)
                      <span key={i} className="read-lines__tax">
                        {part}
                      </span>
                    ))}
                </td>
                <td className="num">
                  {f.lineTotalMinor === null ? "" : moneyText(f.lineTotalMinor, currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** A sent version's payment schedule (docs/06 §7.4: instalment, trigger, share, amount; what you get and the target date). */
export function ScheduleTable(props: { steps: ViewStep[]; currency: Currency }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable
    <section className="read-lines read-lines--schedule" aria-label="Payment schedule" tabIndex={0}>
      <table>
        <caption className="visually-hidden">Payment schedule</caption>
        <thead>
          <tr>
            <th scope="col">{DOC_COPY.instalment}</th>
            <th scope="col">{DOC_COPY.when}</th>
            <th scope="col" className="num">
              {DOC_COPY.share}
            </th>
            <th scope="col" className="num">
              {DOC_COPY.amount}
            </th>
            <th scope="col">{DOC_COPY.whatYouGet}</th>
            <th scope="col">{DOC_COPY.targetDate}</th>
          </tr>
        </thead>
        <tbody>
          {props.steps.map((s) => (
            <tr key={s.id}>
              <th scope="row">{s.label}</th>
              <td>{TRIGGER_LABELS[s.trigger]}</td>
              <td className="num">{bpToPercent(s.pctBp)} %</td>
              <td className="num">
                {s.amountMinor === null ? "" : moneyText(s.amountMinor, props.currency)}
              </td>
              <td>{s.detail ?? ""}</td>
              <td>{dayText(s.targetDate) ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** A section's body as the document shows it (the notes Markdown subset), or the "write it or hide it" line when it is empty. */
export function SectionBody({ bodyMd, cover }: { bodyMd: string | null; cover?: boolean }) {
  if (!bodyMd || bodyMd.trim() === "") return <p className="muted">{DOC_COPY.writtenPerProposal}</p>;
  // The cover is a stack of lines (client, service, …) as the PDF sets it, one per line; Markdown would join them into one sentence.
  if (cover)
    return (
      <div className="doc-md doc-cover">
        {bodyMd
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed lines of a frozen text, never reordered
            <Markdown key={i} source={l} className="doc-cover__line" />
          ))}
      </div>
    );
  return <Markdown source={bodyMd} className="doc-md" />;
}

export const untitledOr = (t: string | null) => t ?? DOC_PENDING.untitled;
