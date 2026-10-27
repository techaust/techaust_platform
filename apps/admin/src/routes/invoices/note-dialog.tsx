// Issuing a credit or debit note (M5.3; ADM-INV-11, ADM-INV-01 "Debit Note", ADM-APR-01; words 07-T §3, §7, §8; VERIFY WITH CA/LEGAL). One dialog,
// two steps, the pattern of the invoice's issue:
//   1. what to credit or add: a credit note by some lines (before GST, each with what is left on it), by an amount (GST included; the largest note not
//      above it, and "Use {closest}" when rounding can't reach it exactly) or the whole invoice; a debit note by lines; the reason. Pressing the
//      issue button saves the draft (the server works the note out from the invoice as it is now; the screen never does);
//   2. the note as it will be issued: its lines ("Against line {n}"), its totals, the effect on the invoice, the final statement and, for the Owner, a
//      fresh code. Staff send it to the Owner instead ("Request issue").
// A draft left open (one per invoice and kind) is opened again here, with its request as it was saved. Every amount is the server's, through core.
import { useEffect, useId, useRef, useState } from "react";
import { RequestError, stepUpActive } from "../../api.ts";
import { Modal } from "../../components/dialog.tsx";
import { FormField } from "../../components/form.tsx";
import { Alert, Pencil } from "../../components/icons.tsx";
import { useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { CodeField, FieldError, Notice } from "../../components/ui.tsx";
import { lineColumns } from "../../lib/documents.ts";
import { INV_COPY, moneyText } from "../../lib/invoices.ts";
import { invoicesApi } from "../../lib/invoices-api.ts";
import {
  againstLine,
  amountHint,
  buildNoteFields,
  closestButton,
  DEBIT_LINE_LABEL,
  DEBIT_REASON_LABEL,
  effectLine,
  emptyNoteForm,
  firstErrorKey,
  issueLabel,
  lineHint,
  NOTE_COPY,
  type NoteBlockerIn,
  type NoteForm,
  type NoteFormErrors,
  noteBlockerLine,
  noteDialogTitle,
  noteErrorText,
  noteFormOf,
  noteIssuedToast,
  rateLine,
  reasonsOf,
} from "../../lib/notes.ts";
import {
  type InvoiceWithNotes,
  type NoteFieldsIn,
  type NoteKind,
  type NoteSaved,
  notesApi,
} from "../../lib/notes-api.ts";
import { moneyInput } from "../../lib/settings-form.ts";
import { withCode } from "../../lib/step-up.ts";
import { NoteTotals } from "./notes-parts.tsx";

const CODE_MISSING = "Enter the 6-digit code from your authenticator app.";

export function NoteDialog(props: {
  open: boolean;
  kind: NoteKind;
  /** The issued tax or export invoice the note is against (its view, with the M5.3 parts). */
  parent: InvoiceWithNotes;
  /** The open draft of this kind, if there is one: the dialog opens it again. */
  draftId: string | null;
  onClose: () => void;
  /** Issued or requested: the invoice's page reads itself again. */
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const number = props.parent.number ?? "";
  return (
    <Modal
      open={props.open}
      title={noteDialogTitle(props.kind, number)}
      onClose={props.onClose}
      busy={busy}
      wide
      titleRef={titleRef}
    >
      {props.open && (
        <NoteDialogBody
          {...props}
          onBusy={setBusy}
          onStep={() => requestAnimationFrame(() => titleRef.current?.focus())}
        />
      )}
    </Modal>
  );
}

type Draft = { id: string; updatedAt: number };

function NoteDialogBody(props: {
  kind: NoteKind;
  parent: InvoiceWithNotes;
  draftId: string | null;
  onClose: () => void;
  onDone: () => void;
  onBusy: (b: boolean) => void;
  onStep: () => void;
}) {
  const { kind, parent: p } = props;
  const toast = useToast();
  const currency = p.currency;
  const uid = useId();
  const [form, setForm] = useState<NoteForm>(emptyNoteForm);
  const [errors, setErrors] = useState<NoteFormErrors>({});
  const [closest, setClosest] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<NoteBlockerIn[]>([]);
  const [step, setStep] = useState<"compose" | "confirm">("compose");
  const [saved, setSaved] = useState<NoteSaved | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusyState] = useState(false);
  const needsCode = !stepUpActive();
  const asks = p.issue.decision === "approval";
  const setBusy = (b: boolean) => {
    setBusyState(b);
    props.onBusy(b);
  };

  // A draft left open is read once and its request put back in the form.
  const existing = useLoad(
    () => (props.draftId ? invoicesApi.get(props.draftId) : Promise.resolve(null)),
    props.draftId ?? "",
  );
  const filled = useRef(false);
  useEffect(() => {
    if (filled.current || existing.state !== "ready" || !existing.data) return;
    filled.current = true;
    const d = existing.data as InvoiceWithNotes;
    setDraft({ id: d.id, updatedAt: d.updatedAt });
    if (d.noteOf) setForm(noteFormOf(d.noteOf, currency));
  }, [existing.state, existing.data, currency]);

  // The lines to pick from: a credit note's with what is left on each; a debit note's are the invoice's (anything can be added).
  const lines =
    kind === "credit"
      ? (p.creditable?.lines ?? [])
      : p.lines.map((l) => ({
          line: l.position - 1,
          position: l.position,
          description: l.description,
          taxableLeftMinor: Number.MAX_SAFE_INTEGER,
          grossLeftMinor: Number.MAX_SAFE_INTEGER,
        }));
  const totalLeft = p.creditable?.totalLeftMinor ?? null;
  const set = (patch: Partial<NoteForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setFormError(null);
  };
  const fieldId = (k: string) => `${uid}-${k}`;

  function focusFirst(e: NoteFormErrors) {
    const k = firstErrorKey(e, lines);
    if (!k) return;
    const target = k === "lines" ? lines[0] && `line-${lines[0].line}` : k;
    if (target) requestAnimationFrame(() => document.getElementById(fieldId(target))?.focus());
  }

  /** A refusal of the create or the save, put where it belongs: on a line, the amount, the reason, or the whole form. */
  function placeRefusal(e: unknown) {
    const next: NoteFormErrors = {};
    if (e instanceof RequestError) {
      const text = noteErrorText(e, kind, currency);
      if (e.code === "line_credit_exceeds" && typeof e.extra.line === "number")
        next[`line-${e.extra.line}`] = text;
      else if (e.code === "credit_amount_unfit") {
        setClosest(typeof e.extra.closestMinor === "number" ? e.extra.closestMinor : null);
        next.amount = text;
      } else if (
        (e.code === "credit_exceeds_remaining" || e.code === "nothing_to_credit") &&
        form.mode !== "full"
      )
        next[form.mode === "amount" ? "amount" : "lines"] = text;
      else if (e.code === "note_reason_required")
        next[form.reasonCode === "other" ? "reasonText" : "reason"] = text;
      else setFormError(text);
    } else setFormError(noteErrorText(e, kind, currency));
    setErrors(next);
    focusFirst(next);
  }

  /** Create the draft, or save the open one, with this request; the answer is the note as the server worked it out. */
  async function save(fields: NoteFieldsIn): Promise<NoteSaved> {
    if (draft) return notesApi.save(draft.id, draft.updatedAt, fields);
    const body = { expectedParentUpdatedAt: p.updatedAt, ...fields };
    try {
      if (kind === "credit") return await notesApi.createCredit(p.id, body);
      // a debit note's request is its lines only (the route has no mode)
      const { mode: _mode, grossMinor: _gross, ...debit } = body;
      return await notesApi.createDebit(p.id, { ...debit, lines: fields.lines ?? [] });
    } catch (e) {
      // A draft was made in the meantime (another tab, another person): open it and save this request into it.
      if (e instanceof RequestError && e.code === "note_draft_exists" && e.extra.draftId) {
        const d = await invoicesApi.get(e.extra.draftId);
        setDraft({ id: d.id, updatedAt: d.updatedAt });
        return notesApi.save(d.id, d.updatedAt, fields);
      }
      throw e;
    }
  }

  async function compose(f: NoteForm = form) {
    setClosest(null);
    setBlockers([]);
    const built = buildNoteFields(kind, f, { currency, lines, totalLeftMinor: totalLeft });
    if (!built.ok) {
      setErrors(built.errors);
      focusFirst(built.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      const s = await save(built.fields);
      setSaved(s);
      setDraft({ id: s.id, updatedAt: s.updatedAt });
      setStep("confirm");
      props.onStep();
    } catch (e) {
      placeRefusal(e);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!saved) return;
    if (!asks && needsCode && code.length !== 6) {
      setCodeError(CODE_MISSING);
      document.getElementById(fieldId("code"))?.focus();
      return;
    }
    setCodeError(null);
    setFormError(null);
    setBlockers([]);
    setBusy(true);
    try {
      if (asks) {
        await invoicesApi.requestIssue(saved.id, saved.updatedAt);
        toast("success", INV_COPY.requested);
      } else {
        const r = await withCode(needsCode ? code : undefined, () =>
          invoicesApi.issue(saved.id, saved.updatedAt, saved.contentSha256),
        );
        toast("success", noteIssuedToast(kind, r.number ?? ""));
      }
      props.onDone();
      props.onClose();
    } catch (e) {
      if (e instanceof RequestError && e.code === "issue_blocked" && e.extra.blockers?.length)
        setBlockers(e.extra.blockers);
      else setFormError(noteErrorText(e, kind, currency));
    } finally {
      setBusy(false);
    }
  }

  if (props.draftId && existing.state === "loading")
    return (
      <div className="dialog__body" aria-busy="true">
        <p className="visually-hidden" role="status">
          Loading…
        </p>
      </div>
    );

  const primary = asks ? NOTE_COPY.requestIssue : issueLabel(kind);
  return step === "compose" ? (
    <form
      className="note-dialog"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void compose();
      }}
    >
      <div className="dialog__body note-dialog__body">
        {kind === "debit" && <p className="note-dialog__lede">{NOTE_COPY.debitBody}</p>}
        {kind === "credit" && (
          <fieldset className="radios note-modes" disabled={busy}>
            <legend className="visually-hidden">{noteDialogTitle(kind, p.number ?? "")}</legend>
            {(
              [
                ["lines", NOTE_COPY.modeLines],
                ["amount", NOTE_COPY.modeAmount],
                ["full", NOTE_COPY.modeFull],
              ] as const
            ).map(([m, label]) => (
              <label key={m} className="radio">
                <input
                  type="radio"
                  name={`${uid}-mode`}
                  value={m}
                  checked={form.mode === m}
                  onChange={() => {
                    set({ mode: m });
                    setErrors({});
                    setClosest(null);
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
        )}

        {form.mode === "lines" && (
          <LinePicker
            kind={kind}
            uid={uid}
            lines={lines}
            currency={currency}
            values={form.lines}
            errors={errors}
            disabled={busy}
            onChange={(line, value) => {
              set({ lines: { ...form.lines, [line]: value } });
              if (errors[`line-${line}`] || errors.lines)
                setErrors((x) => ({ ...x, [`line-${line}`]: undefined, lines: undefined }));
            }}
          />
        )}

        {form.mode === "amount" && (
          <FormField
            id={fieldId("amount")}
            label={NOTE_COPY.amountLabel}
            hint={totalLeft !== null ? amountHint(moneyText(totalLeft, currency)) : undefined}
            error={errors.amount}
            className="note-amount"
          >
            {(a) => (
              <div className="money-in">
                <span aria-hidden="true">{currency === "INR" ? "₹" : "$"}</span>
                <input
                  {...a}
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.amount}
                  disabled={busy}
                  onChange={(e) => {
                    set({ amount: e.target.value });
                    setClosest(null);
                    if (errors.amount) setErrors((x) => ({ ...x, amount: undefined }));
                  }}
                />
              </div>
            )}
          </FormField>
        )}
        {form.mode === "amount" && closest !== null && (
          <p className="note-unfit">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={busy}
              onClick={() => {
                const next = { ...form, amount: moneyInput(closest, currency) };
                setForm(next);
                setErrors({});
                setClosest(null);
                void compose(next);
              }}
            >
              {closestButton(moneyText(closest, currency))}
            </button>
          </p>
        )}

        {form.mode === "full" && totalLeft !== null && (
          <p className="note-full">{amountHint(moneyText(totalLeft, currency))}</p>
        )}

        <FormField
          id={fieldId("reason")}
          label={kind === "credit" ? NOTE_COPY.reasonLabel : DEBIT_REASON_LABEL}
          error={errors.reason}
          className="note-reason"
        >
          {(a) => (
            <select
              {...a}
              value={form.reasonCode}
              disabled={busy}
              onChange={(e) => {
                set({ reasonCode: e.target.value });
                if (errors.reason || errors.reasonText)
                  setErrors((x) => ({ ...x, reason: undefined, reasonText: undefined }));
              }}
            >
              <option value=""> </option>
              {reasonsOf(kind).map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
        </FormField>
        {form.reasonCode === "other" && (
          <FormField id={fieldId("reasonText")} label={NOTE_COPY.describeReason} error={errors.reasonText}>
            {(a) => (
              <textarea
                {...a}
                rows={3}
                maxLength={300}
                value={form.reasonText}
                disabled={busy}
                onChange={(e) => {
                  set({ reasonText: e.target.value });
                  if (errors.reasonText && e.target.value.trim())
                    setErrors((x) => ({ ...x, reasonText: undefined }));
                }}
              />
            )}
          </FormField>
        )}
      </div>
      {formError && <Notice tone="error">{formError}</Notice>}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
          {NOTE_COPY.cancel}
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Working…" : primary}
        </button>
      </div>
    </form>
  ) : (
    <>
      <div className="dialog__body note-dialog__body note-confirm">
        {saved && <NotePreview kind={kind} parent={p} saved={saved} />}
        <p className="note-final">{NOTE_COPY.finalStatement}</p>
        {blockers.length > 0 && (
          <div className="inv-issue__blocked">
            <p className="inv-issue__fix">{INV_COPY.fixFirst}</p>
            <ul className="blockers inv-blockers">
              {blockers.map((b, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a code can repeat for different lines; the list is redrawn whole
                <li key={`${b.code}-${i}`} className="blockers__item">
                  <Alert size={16} />
                  <span>{noteBlockerLine(b, kind, currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {!asks && needsCode && (
        <CodeField
          id={fieldId("code")}
          label="Authenticator code"
          hint="Enter the 6-digit code from your authenticator app to continue."
          value={code}
          onChange={setCode}
          error={codeError}
        />
      )}
      {formError && <Notice tone="error">{formError}</Notice>}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
          {NOTE_COPY.cancel}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          onClick={() => {
            setStep("compose");
            setBlockers([]);
            setFormError(null);
            props.onStep();
          }}
        >
          <Pencil size={16} />
          {/* "Change" is the admin's word for going back to what was typed (07-T has none) */}
          Change
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void confirm()}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? "Working…" : asks ? INV_COPY.sendRequest : issueLabel(kind)}
        </button>
      </div>
    </>
  );
}

/** The lines of the invoice with an amount field each: a credit note's says what is left on its line (before GST); a debit note's adds to it. */
function LinePicker(props: {
  kind: NoteKind;
  uid: string;
  lines: readonly { line: number; position: number; description: string; taxableLeftMinor: number }[];
  currency: "INR" | "USD";
  values: Record<number, string>;
  errors: NoteFormErrors;
  disabled: boolean;
  onChange: (line: number, value: string) => void;
}) {
  const head = `${props.uid}-col`;
  const sign = props.currency === "INR" ? "₹" : "$";
  return (
    <div className="note-picker">
      {/* the column's word, once over the fields (each field is named by it and its line) */}
      <p className="note-picker__head" aria-hidden="true">
        <span id={head}>{props.kind === "credit" ? NOTE_COPY.creditColumn : DEBIT_LINE_LABEL}</span>
      </p>
      <ul className="note-picker__lines">
        {props.lines.map((l) => {
          const id = `${props.uid}-line-${l.line}`;
          const desc = `${id}-desc`;
          const hint = `${id}-hint`;
          const err = props.errors[`line-${l.line}`];
          const empty = props.kind === "credit" && l.taxableLeftMinor <= 0;
          return (
            <li key={l.line} className={`note-picker__line${empty ? " note-picker__line--done" : ""}`}>
              <p className="note-picker__desc" id={desc}>
                <span className="note-picker__n tnum" aria-hidden="true">
                  {l.position}
                </span>
                <span>{l.description}</span>
              </p>
              <div className="note-picker__field">
                {/* phones: the column's word over each field (the column head is not shown there) */}
                <span className="note-picker__label" aria-hidden="true">
                  {props.kind === "credit" ? NOTE_COPY.creditColumn : DEBIT_LINE_LABEL}
                </span>
                <div className="money-in">
                  <span aria-hidden="true">{sign}</span>
                  <input
                    id={id}
                    aria-labelledby={`${head} ${desc}`}
                    aria-describedby={
                      [props.kind === "credit" ? hint : null, err ? `${id}-error` : null]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    aria-invalid={err ? true : undefined}
                    inputMode="decimal"
                    autoComplete="off"
                    value={props.values[l.line] ?? ""}
                    disabled={props.disabled || empty}
                    onChange={(e) => props.onChange(l.line, e.target.value)}
                  />
                </div>
                {props.kind === "credit" && (
                  <p className="hint note-picker__hint" id={hint}>
                    {lineHint(moneyText(Math.max(0, l.taxableLeftMinor), props.currency))}
                  </p>
                )}
                {err && <FieldError id={`${id}-error`}>{err}</FieldError>}
              </div>
            </li>
          );
        })}
      </ul>
      {props.errors.lines && <FieldError id={`${props.uid}-lines-error`}>{props.errors.lines}</FieldError>}
    </div>
  );
}

/** The note as it will be issued: its lines against the invoice's, its totals, the effect on the invoice and, in USD, the invoice's rate. */
function NotePreview(props: { kind: NoteKind; parent: InvoiceWithNotes; saved: NoteSaved }) {
  const { kind, parent: p, saved } = props;
  const pv = saved.preview;
  const descOf = (line: number) => p.lines[line]?.description ?? "";
  const rate = p.currency === "USD" ? (p.fx?.value?.rate ?? null) : null;
  return (
    <div className="note-preview">
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a box that may scroll sideways on a phone is a Tab stop of its own (WCAG 2.1.1) */}
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
                {lineColumns.amount}
              </th>
            </tr>
          </thead>
          <tbody>
            {pv.lines.map((l, i) => {
              // The invoice line of the note's line i is the request's take i (the stored request, sorted by line, one take per note line). The
              // preview's own `line` is the invoice's index on a credit note but the note's own on a debit note, so the take is what is read.
              const at = saved.request.takes[i]?.line ?? l.line;
              return (
                <tr key={at}>
                  <th scope="row">
                    <span className="read-lines__desc">{descOf(at)}</span>
                    <span className="read-lines__detail tnum">{againstLine(at + 1)}</span>
                  </th>
                  <td className="num">{moneyText(l.taxableMinor, p.currency)}</td>
                  <td className="num">{moneyText(l.lineTotalMinor, p.currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <NoteTotals kind={kind} currency={p.currency} supplyType={pv.supply.type} totals={pv.totals} />
      <p className="note-effect">
        {effectLine(kind, p.number ?? "", moneyText(pv.totals.totalMinor, p.currency))}
      </p>
      {rate && <p className="note-rate tnum">{rateLine(rate, p.number ?? "")}</p>}
    </div>
  );
}
