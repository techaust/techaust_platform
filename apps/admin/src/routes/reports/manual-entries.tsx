// FX-4 (full audit A5 1; early check L2, L3): the tax-only notes whose tax the GSTR-1 files leave out (Settled by the lead on the safest reading, 2026-10-30 (08-C RA-32, RA-23): entered by hand in the GST portal's Table 9B; a test import of each CSV before the first GSTR-1). They are the
// blocking warnings: the files are made, but they are not complete for filing until the person enters each note's tax by hand. Each note keeps the
// builder's sentence (07-Y, marked) and gets a small ledger of what to enter, one row per GST rate (`manual.byRate`), with only the heads that carry tax
// and a total row when there is more than one rate. Amounts come from core (`moneyText` through `Amount`); nothing here adds them up.
// Its own module (not ./parts.tsx): it needs the gst core's `formatRate`, and the client statement tab imports ./parts.tsx without the gst core.
import { formatRate } from "@techaust/core/gst";
import { Link } from "react-router";
import { AlertTriangle } from "../../components/icons.tsx";
import { documentHref, GST_COPY, SALES_COPY } from "../../lib/reports.ts";
import type { WarningLine } from "../../lib/reports-build.ts";
import { Amount } from "./parts.tsx";

const HEADS = [
  { key: "igstMinor", label: GST_COPY.columns.igst },
  { key: "cgstMinor", label: GST_COPY.columns.cgst },
  { key: "sgstMinor", label: GST_COPY.columns.sgst },
] as const;

/** The blocking lines of an export, each with what to enter by hand; nothing when there are none. */
export function ManualEntries({ lines, id }: { lines: readonly WarningLine[]; id: string }) {
  const blocking = lines.filter((l) => l.blocking);
  if (blocking.length === 0) return null;
  return (
    <ol className="manual-entries" aria-labelledby={id}>
      {blocking.map((l, i) => {
        const m = l.manual;
        const textId = `${id}-${i}`;
        // A head appears only when the note carries tax under it (an inter-state note has IGST only; an intra-state one CGST and SGST).
        const heads = m ? HEADS.filter((h) => m[h.key] > 0) : [];
        return (
          <li key={l.key} className="manual-entry">
            <AlertTriangle size={20} />
            <div className="manual-entry__body">
              <p id={textId} className="manual-entry__text">
                {l.text}
              </p>
              {m && heads.length > 0 && (
                <div className="manual-entry__figures">
                  {/* named by the note's number: the sentence above says the rest */}
                  <table className="rledger manual-entry__table" aria-label={m.number}>
                    <thead>
                      <tr>
                        <th scope="col">{SALES_COPY.columns.rate}</th>
                        {heads.map((h) => (
                          <th key={h.key} scope="col" className="num">
                            {h.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {m.byRate.map((r) => (
                        <tr key={r.rateBp}>
                          <th scope="row" className="tnum">
                            {formatRate(r.rateBp)} %
                          </th>
                          {heads.map((h) => (
                            <td key={h.key} className="num">
                              <Amount minor={r[h.key]} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {m.byRate.length > 1 && (
                      <tfoot>
                        <tr className="rledger__total">
                          <th scope="row">{GST_COPY.table13Columns.total}</th>
                          {heads.map((h) => (
                            <td key={h.key} className="num">
                              <Amount minor={m[h.key]} />
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
              {l.doc && (
                <Link to={documentHref(l.doc.id)} className="btn btn--text manual-entry__open">
                  {GST_COPY.openDocument}
                  <span className="visually-hidden"> {l.doc.number}</span>
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
