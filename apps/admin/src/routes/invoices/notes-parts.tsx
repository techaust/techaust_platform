// The credit and debit note pieces of the invoice screens (M5.3; ADM-INV-11, ADM-INV-01 "Debit Note"; words 07-T, VERIFY WITH CA/LEGAL):
// - on an issued tax or export invoice, the notes section: the credit deadline, the notes as a short ledger closed by the balance line under a double
//   rule (the one thing drawn here: the invoice's arithmetic, its total corrected note by note, as an accountant closes a column), the refund due, an
//   open draft, and the two actions;
// - on a note, what it is against and why: the invoice (a link), the reason in the same band the PDF prints it in, the effect line, the rate of a USD
//   note; the client's IMS answer on a credit note; its lines, each with the invoice line it is against, and its totals.
// Every amount is the server's, formatted through core; nothing is added or rounded here.
import "../../notes.css";
import type { Role } from "@techaust/core/permissions";
import { useState } from "react";
import { Link } from "react-router";
import type { Currency } from "../../api.ts";
import { Calendar, Plus, RotateCcw } from "../../components/icons.tsx";
import { useToast } from "../../components/toast.tsx";
import { allowed } from "../../lib/access.ts";
import { DOC_COPY, dayText, inWords, lineColumns, lineTaxText } from "../../lib/documents.ts";
import { badgeOf, INV_COPY, INV_ERRORS, moneyText } from "../../lib/invoices.ts";
import {
  againstLine,
  balanceLine,
  deadlineBanner,
  effectLine,
  IMS_LABELS,
  NOTE_COPY,
  NOTE_ERRORS,
  noteErrorText,
  notesLimit,
  rateLine,
  reasonLine,
  reasonText,
  refundLine,
  splitDraftLine,
  totalLabel,
} from "../../lib/notes.ts";
import {
  type CreditDeadlineView,
  type InvoiceWithNotes,
  type NoteKind,
  type NoteRow,
  notesApi,
} from "../../lib/notes-api.ts";
import { InvoiceBadge, invoiceHref } from "./parts.tsx";
import { StatutoryBand } from "./types-parts.tsx";

export const isNoteView = (v: { type: string }) => v.type === "credit_note" || v.type === "debit_note";
export const noteKindOfView = (v: { type: string }): NoteKind =>
  v.type === "credit_note" ? "credit" : "debit";

// ---- the deadline (07-T §4) ---------------------------------------------------------------------------------------------------------------------

/** The credit deadline of an invoice: a dated line in the tone of how close it is (info, then warning within 30 days, then danger once passed). */
export function DeadlineNotice({ deadline, fy }: { deadline: CreditDeadlineView; fy: string | null }) {
  const b = deadlineBanner(deadline, fy);
  return (
    <div className={`notes-deadline notes-deadline--${b.tone}`} role="status">
      <Calendar size={20} />
      <div>
        {b.lines.map((l, i) => (
          <p key={l} className={i === 0 ? "notes-deadline__main" : "notes-deadline__more"}>
            {l}
          </p>
        ))}
      </div>
    </div>
  );
}

// ---- the notes section of an issued invoice (07-T §3, §6, §8) -----------------------------------------------------------------------------------

/** Why an action is not offered, as one line (null: the reason is said elsewhere on the page, or the role cannot draft at all). */
function reasonNotOffered(kind: NoteKind, reasons: readonly string[]): string | null {
  // the deadline has its own banner, an open draft its own row; a role that may not draft sees no action and no reason
  const rest = reasons.filter(
    (r) => r !== "credit_deadline_passed" && r !== "note_draft_exists" && r !== "forbidden",
  );
  if (reasons.includes("forbidden") || rest.length === 0) return null;
  const r = rest[0] as string;
  if (r === "notes_limit") return notesLimit(kind);
  if (r === "client_anonymised") return INV_ERRORS.client_anonymised;
  return (NOTE_ERRORS as Record<string, string>)[r] ?? null;
}

function NoteLedgerRow({ row, currency }: { row: NoteRow; currency: Currency }) {
  const date = dayText(row.issueDate) ?? "";
  return (
    <li className="notes-row">
      <Link className="notes-row__number" to={invoiceHref(row.id)}>
        <span className="docno">{row.number}</span>
      </Link>
      <span className="notes-row__date">{date}</span>
      <span className="notes-row__total tnum">{moneyText(row.totalMinor, currency)}</span>
      <span className="notes-row__status">
        <InvoiceBadge badge={badgeOf({ status: row.status, overdue: false })} />
      </span>
    </li>
  );
}

function DraftRow({ kind, id }: { kind: NoteKind; id: string }) {
  const [before, link] = splitDraftLine(kind);
  return (
    <li className="notes-row notes-row--draft">
      <span className="inv-slot" aria-hidden="true" />
      <p className="notes-row__draft">
        {before}
        <Link to={invoiceHref(id)}>{link}</Link>
      </p>
    </li>
  );
}

/**
 * The notes section of an issued tax or export invoice. `onIssue` opens the dialog of a kind (null: no dialog, the role cannot draft). The actions are
 * offered when the server allows them; otherwise one line says why (the deadline and an open draft say it in their own places).
 */
export function NotesPanel(props: { view: InvoiceWithNotes; role: Role; onIssue: (kind: NoteKind) => void }) {
  const v = props.view;
  const notes = v.notes;
  if (!notes || !v.actions) return null;
  const isVoid = v.status === "void";
  const rows = [...notes.credit, ...notes.debit].sort((a, b) =>
    (a.issueDate ?? "").localeCompare(b.issueDate ?? ""),
  );
  const nothing = rows.length === 0 && !notes.drafts.credit && !notes.drafts.debit;
  // A void invoice has no notes (a note blocks the void) and gets none: the section says nothing there.
  if (isVoid && nothing) return null;
  const canDraft = allowed(props.role, "invoices.draft") && !v.client.anonymised;
  const credit = v.actions.credit;
  const debit = v.actions.debit;
  // An open draft is not a reason to stop: the action opens the dialog on that draft (the only one of its kind the invoice may have).
  const offered = (a: { allowed: boolean; reasons: readonly string[] }) =>
    a.allowed || (a.reasons.length > 0 && a.reasons.every((r) => r === "note_draft_exists"));
  const offerCredit = offered(credit);
  const offerDebit = offered(debit);
  const why = [
    canDraft && !credit.allowed ? reasonNotOffered("credit", credit.reasons) : null,
    canDraft && !debit.allowed ? reasonNotOffered("debit", debit.reasons) : null,
  ].filter((l, i, all): l is string => l !== null && all.indexOf(l) === i);
  const deadline = v.creditDeadline;
  // the deadline matters while something is left to credit
  const showDeadline = deadline !== null && !isVoid && !credit.reasons.includes("parent_fully_credited");
  const credited = notes.credit.length;
  return (
    <section className="lead-panel notes-panel" aria-labelledby="notes-h">
      <div className="lead-panel__head notes-panel__head">
        <h2 id="notes-h" className="lead-panel__title">
          {NOTE_COPY.notesHeading}
        </h2>
        {canDraft && (offerCredit || offerDebit) && (
          <div className="notes-panel__actions">
            {offerCredit && (
              <button type="button" className="btn btn--secondary" onClick={() => props.onIssue("credit")}>
                <RotateCcw size={16} />
                {NOTE_COPY.issueCredit}
              </button>
            )}
            {offerDebit && (
              <button type="button" className="btn btn--secondary" onClick={() => props.onIssue("debit")}>
                <Plus size={16} />
                {NOTE_COPY.issueDebit}
              </button>
            )}
          </div>
        )}
      </div>
      {showDeadline && deadline && <DeadlineNotice deadline={deadline} fy={v.fy} />}
      {why.map((l) => (
        <p key={l} className="notes-panel__why">
          {l}
        </p>
      ))}
      {(rows.length > 0 || notes.drafts.credit || notes.drafts.debit) && (
        <ul className="notes-ledger">
          {rows.map((r) => (
            <NoteLedgerRow key={r.id} row={r} currency={v.currency} />
          ))}
          {notes.drafts.credit && <DraftRow kind="credit" id={notes.drafts.credit} />}
          {notes.drafts.debit && <DraftRow kind="debit" id={notes.drafts.debit} />}
        </ul>
      )}
      {credited > 0 && (
        <p className="notes-balance tnum">{balanceLine(moneyText(v.balanceMinor, v.currency), credited)}</p>
      )}
      {v.refundDueMinor !== null && v.refundDueMinor !== undefined && v.refundDueMinor > 0 && (
        <p className="notes-refund">{refundLine(moneyText(v.refundDueMinor, v.currency))}</p>
      )}
    </section>
  );
}

// ---- a note (issued or draft) ---------------------------------------------------------------------------------------------------------------------

/** A note's own facts: the reason in the band the PDF prints it in, the effect on its invoice, the rate of a USD note. */
export function NoteFacts({ view }: { view: InvoiceWithNotes }) {
  const n = view.noteOf;
  if (!n) return null;
  const kind = n.kind;
  const total = view.totals ? moneyText(view.totals.totalMinor, view.currency) : null;
  // An issued note's rate is in its "Value in INR" facts (the M5.2 panel, with its source and date); a draft's page has no such panel, so it says it here.
  const rate = view.currency === "USD" && !view.frozen ? (view.fx?.value?.rate ?? null) : null;
  return (
    <section className="lead-panel notes-facts" aria-labelledby="note-facts-h">
      <h2 id="note-facts-h" className="visually-hidden">
        {NOTE_COPY.againstInvoice}
      </h2>
      <StatutoryBand line={reasonLine(reasonText(n.reason))} />
      {total && <p className="notes-facts__effect">{effectLine(kind, n.parent.number, total)}</p>}
      {rate && <p className="notes-facts__rate tnum">{rateLine(rate, n.parent.number)}</p>}
    </section>
  );
}

/** "Against invoice": the invoice a note corrects, as a link (the strip's fact). */
export function AgainstInvoice({ view }: { view: InvoiceWithNotes }) {
  const p = view.parentLink;
  const number = p?.number ?? view.noteOf?.parent.number ?? null;
  if (!p || !number) return null;
  return (
    <div className="client-strip__fact">
      <dt>{NOTE_COPY.againstInvoice}</dt>
      <dd>
        <Link to={invoiceHref(p.id)} className="docno">
          {number}
        </Link>
      </dd>
    </div>
  );
}

/**
 * The client's answer in the GST portal's IMS (07-T §5, Q14; VERIFY WITH CA/LEGAL) on an issued credit note. The Owner records it once, while it is
 * pending (Accepted or Rejected); everyone else, and every answer once given, reads it.
 */
export function ImsPanel({ view, onSaved }: { view: InvoiceWithNotes; onSaved: () => void }) {
  const toast = useToast();
  const ims = view.ims;
  const [choice, setChoice] = useState<"accepted" | "rejected" | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!view.frozen || view.type !== "credit_note" || !ims || ims.status === null) return null;
  const status = ims.status;

  async function save() {
    if (choice === "") return;
    setBusy(true);
    setError(null);
    try {
      await notesApi.ims(view.id, view.updatedAt, choice);
      toast("success", NOTE_COPY.imsSaved);
      onSaved();
    } catch (e) {
      setError(noteErrorText(e, "credit", view.currency));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="lead-panel notes-ims" aria-labelledby="ims-h">
      {/* the answer as it stands, beside the field's name: "Client's response in IMS  Pending" */}
      <div className="notes-ims__head">
        <h2 id="ims-h" className="lead-panel__title">
          {NOTE_COPY.imsLabel}
        </h2>
        <p className={`notes-ims__value notes-ims__value--${status}`} id="ims-now">
          {IMS_LABELS[status]}
        </p>
      </div>
      <p className="hint notes-ims__hint" id="ims-hint">
        {NOTE_COPY.imsHint}
      </p>
      {ims.canSet ? (
        <form
          className="notes-ims__form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset
            className="radios"
            aria-describedby={error ? "ims-now ims-error ims-hint" : "ims-now ims-hint"}
          >
            <legend className="visually-hidden">{NOTE_COPY.imsLabel}</legend>
            <div className="segmented">
              {(["accepted", "rejected"] as const).map((s) => (
                <label key={s} className="segmented__opt">
                  <input
                    id={`ims-${s}`}
                    type="radio"
                    name="ims"
                    value={s}
                    checked={choice === s}
                    onChange={() => {
                      setChoice(s);
                      setError(null);
                    }}
                    disabled={busy}
                  />
                  {IMS_LABELS[s]}
                </label>
              ))}
            </div>
          </fieldset>
          {/* "Save" is the admin's word for it (07-T has none); it waits for a choice, so nothing is recorded by mistake */}
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || choice === ""}
            aria-busy={busy || undefined}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {error && (
            <p className="field-error notes-ims__error" id="ims-error" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : null}
    </section>
  );
}

/** A note's lines: each with the invoice line it is against (07-T §8), its taxable value, tax and amount; read from the note as saved or frozen. */
export function NoteLinesTable({ view }: { view: InvoiceWithNotes }) {
  const takes = view.noteOf?.request.takes ?? [];
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a box that may scroll sideways on a phone is a Tab stop of its own (WCAG 2.1.1)
    <section className="read-lines notes-lines" aria-label={INV_COPY.lines} tabIndex={0}>
      <table>
        <caption className="visually-hidden">{INV_COPY.lines}</caption>
        <thead>
          <tr>
            <th scope="col">{lineColumns.description}</th>
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
          {view.lines.map((l, i) => {
            const take = takes[i];
            return (
              <tr key={l.id}>
                <th scope="row">
                  <span className="read-lines__desc">{l.description}</span>
                  {take && <span className="read-lines__detail tnum">{againstLine(take.line + 1)}</span>}
                </th>
                <td className="num">
                  {l.taxableMinor === null ? "" : moneyText(l.taxableMinor, view.currency)}
                </td>
                <td className="num">
                  {lineTaxText(l, view.currency, view.supply)
                    .split(" + ")
                    .map((part, k) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: CGST then SGST, a fixed pair
                      <span key={k} className="read-lines__tax">
                        {part}
                      </span>
                    ))}
                </td>
                <td className="num">
                  {l.lineTotalMinor === null ? "" : moneyText(l.lineTotalMinor, view.currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** A note's totals (or a preview's): taxable value, each tax head the supply uses, round-off, then "Total credited" or "Total added" and the words. */
export function NoteTotals(props: {
  kind: NoteKind;
  currency: Currency;
  supplyType: string | null;
  totals: {
    taxableMinor: number;
    cgstMinor: number;
    sgstMinor: number;
    igstMinor: number;
    roundOffMinor: number;
    totalMinor: number;
    words: string;
  };
}) {
  const t = props.totals;
  const intra = props.supplyType === "intra";
  const row = (label: string, minor: number) => (
    <div className="totals__row" key={label}>
      <dt>{label}</dt>
      <dd className="tnum">{moneyText(minor, props.currency)}</dd>
    </div>
  );
  return (
    <div className="tax-preview notes-totals">
      <dl className="totals">
        {row(lineColumns.taxable, t.taxableMinor)}
        {intra
          ? [row(DOC_COPY.cgst, t.cgstMinor), row(DOC_COPY.sgst, t.sgstMinor)]
          : row(DOC_COPY.igst, t.igstMinor)}
        {t.roundOffMinor !== 0 && row(DOC_COPY.roundOff, t.roundOffMinor)}
        <div className="totals__row totals__row--total">
          <dt>{totalLabel(props.kind)}</dt>
          <dd className="tnum">{moneyText(t.totalMinor, props.currency)}</dd>
        </div>
      </dl>
      <p className="tax-preview__words">{inWords(t.words)}</p>
    </div>
  );
}
