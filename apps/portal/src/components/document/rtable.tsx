// A data table that stays a real <table> (caption, th scope) from md up, and becomes one labelled card per row on phones
// (docs/06 §5.3 DataTable, §8: "mobile card variants keep the labels"). Both are rendered and CSS shows one: changing a
// table's display would strip its table semantics in some browsers. Money and number columns are right-aligned and
// tabular.
import type { ReactNode } from "react";

export type Column<R> = {
  key: string;
  label: ReactNode;
  cell: (row: R) => ReactNode;
  num?: boolean | undefined;
  /** The column that heads each card on phones (one per table). */
  lead?: boolean | undefined;
  /** Left out of the phone card (another column's card value carries it). */
  hideOnCard?: boolean | undefined;
  /** What the phone card shows, when it differs from the table cell (e.g. "2 months" for Qty and Unit). */
  cardCell?: ((row: R) => ReactNode) | undefined;
};

export function RTable<R>(props: {
  caption: ReactNode;
  className?: string | undefined;
  /** Show the caption to everyone (default: for screen readers only, when a heading above already says it). */
  showCaption?: boolean | undefined;
  columns: Column<R>[];
  rows: R[];
  rowKey: (row: R) => string;
  /** Rows under the body (totals), as label and value; aligned with the last column. */
  foot?: { label: ReactNode; value: ReactNode; strong?: boolean | undefined }[] | undefined;
}) {
  const { columns, rows, rowKey } = props;
  const lead = columns.find((c) => c.lead) ?? columns[0];
  return (
    <div className={props.className ? `rtable ${props.className}` : "rtable"}>
      <div className="rtable__wide">
        <table>
          <caption className={props.showCaption ? "rtable__caption" : "visually-hidden"}>
            {props.caption}
          </caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={c.num ? "num" : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) =>
                  c === lead ? (
                    <th key={c.key} scope="row" className={c.num ? "num" : undefined}>
                      {c.cell(r)}
                    </th>
                  ) : (
                    <td key={c.key} className={c.num ? "num" : undefined}>
                      {c.cell(r)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
          {props.foot && (
            <tfoot>
              {props.foot.map((f, i) => (
                <tr key={String(i)} className={f.strong ? "is-strong" : undefined}>
                  <th scope="row" colSpan={columns.length - 1}>
                    {f.label}
                  </th>
                  <td className="num">{f.value}</td>
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
      <div className="rtable__cards">
        {props.showCaption && (
          <p className="rtable__caption" aria-hidden="true">
            {props.caption}
          </p>
        )}
        <ul aria-label={typeof props.caption === "string" ? props.caption : undefined}>
          {rows.map((r) => (
            <li key={rowKey(r)} className="rcard">
              <div className="rcard__lead">{lead?.cell(r)}</div>
              <dl>
                {columns
                  .filter((c) => c !== lead && !c.hideOnCard)
                  .map((c) => (
                    <div key={c.key} className={c.num ? "num" : undefined}>
                      <dt>{c.label}</dt>
                      <dd>{(c.cardCell ?? c.cell)(r)}</dd>
                    </div>
                  ))}
              </dl>
            </li>
          ))}
        </ul>
        {props.foot && (
          <dl className="rcard-foot">
            {props.foot.map((f, i) => (
              <div key={String(i)} className={f.strong ? "is-strong" : undefined}>
                <dt>{f.label}</dt>
                <dd className="num">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
