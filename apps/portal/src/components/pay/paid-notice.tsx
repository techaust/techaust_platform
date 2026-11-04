// "I've paid" (M7.1; POR-06, ADM-PAY-05; run file G.5, L10, L21, L22): the client tells us about a payment they made outside the portal (a bank transfer,
// mostly). A notice is never a payment and never money: TecHaust checks the bank and records the payment, so the balance stays as it is until then (C14).
// The dialog takes the amount (typed the Indian way in rupees, the US way in dollars; parsed by core, never above the balance), the day paid (the date
// field, DD/MM/YYYY, not after today), the transaction reference and an optional note; NO card or bank-account field exists here or anywhere in the portal
// (ADM-PAY-12; Researched 2026-10-28, 08-C RB-07: a UTR is a reference, not a credential), and the hint says not to type them. Every refusal is worded from
// its code (C15). The same dialog on the signed-in page and on the emailed "View & pay" link (the token goes in the body only).
import { useId, useRef, useState } from "react";
import type { PaidNotice, PaidNoticeInput } from "../../api.ts";
import { ZP } from "../../copy-zp.ts";
import { todayIst } from "../../lib/invoices.ts";
import { checkNotice, type NoticeErrors, noticeRefusal } from "../../lib/m71.ts";
import { DateField, useUnreadDates } from "../date-field.tsx";
import { Modal } from "../dialog.tsx";
import { Lock } from "../icons.tsx";
import { FieldError, Notice } from "../ui.tsx";

type Props = {
  currency: string;
  balanceMinor: number;
  /** The document's issue day (`YYYY-MM-DD`): the date field's earliest day (the server refuses an earlier one, `date_before_issue`). */
  issueDate: string | null;
  send: (body: PaidNoticeInput) => Promise<{ notice: PaidNotice }>;
  onSent: () => void;
};

/** The button and its dialog. */
export function PaidNoticeButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn--secondary" onClick={() => setOpen(true)}>
        {ZP.paid}
      </button>
      <Modal open={open} title={ZP.paidTitle} onClose={() => setOpen(false)}>
        {open && (
          <NoticeForm
            {...props}
            onCancel={() => setOpen(false)}
            onSent={() => {
              setOpen(false);
              props.onSent();
            }}
          />
        )}
      </Modal>
    </>
  );
}

const ORDER: (keyof NoticeErrors)[] = ["amount", "paidOn", "reference"];

function NoticeForm(props: Props & { onCancel: () => void }) {
  const id = useId();
  const today = todayIst();
  const [form, setForm] = useState({ amount: "", paidOn: "", reference: "", note: "" });
  const [errors, setErrors] = useState<NoticeErrors>({});
  const [busy, setBusy] = useState(false);
  const dates = useUnreadDates<"paidOn">();
  const failureRef = useRef<HTMLDivElement>(null);
  const sign = props.currency === "USD" ? "$" : "₹";
  const ids = { amount: `${id}-amount`, paidOn: `${id}-date`, reference: `${id}-ref` };

  function focusFirst(e: NoticeErrors) {
    const first = ORDER.find((k) => e[k]);
    requestAnimationFrame(() => {
      if (first && first !== "form") document.getElementById(ids[first])?.focus();
      else if (e.form) failureRef.current?.focus();
    });
  }

  async function submit() {
    const c = checkNotice(form, {
      currency: props.currency,
      balanceMinor: props.balanceMinor,
      dateUnread: dates.unread.paidOn === true,
    });
    if (!c.ok) {
      setErrors(c.errors);
      focusFirst(c.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const note = form.note.trim();
      await props.send({
        amountMinor: c.amountMinor,
        paidOn: form.paidOn,
        reference: form.reference.trim(),
        ...(note ? { note } : {}),
      });
      props.onSent();
    } catch (e) {
      setBusy(false);
      const r = noticeRefusal(e, props.currency);
      setErrors(r);
      focusFirst(r);
    }
  }

  const described = (key: keyof NoticeErrors, ...more: string[]) =>
    [...more, errors[key] ? `${id}-${key}-error` : null].filter(Boolean).join(" ") || undefined;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="dialog__body pnotice">
        <p className="pnotice__hint">
          <Lock size={16} />
          <span id={`${id}-safe`}>{ZP.noCardHint}</span>
        </p>
        <div className="field">
          <label htmlFor={ids.amount}>{ZP.amountPaid}</label>
          <div className="pay-part__in">
            <span aria-hidden="true">{sign}</span>
            <input
              id={ids.amount}
              inputMode="decimal"
              autoComplete="off"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              aria-invalid={errors.amount ? true : undefined}
              aria-describedby={described("amount")}
            />
          </div>
          {errors.amount && <FieldError id={`${id}-amount-error`}>{errors.amount}</FieldError>}
        </div>
        <div className="field">
          <label htmlFor={ids.paidOn} id={`${ids.paidOn}-label`}>
            {ZP.datePaid}
          </label>
          <DateField
            id={ids.paidOn}
            value={form.paidOn}
            max={today}
            min={props.issueDate ?? undefined}
            onChange={(paidOn) => setForm({ ...form, paidOn })}
            {...dates.bind("paidOn")}
            aria-invalid={errors.paidOn ? true : undefined}
            aria-describedby={described("paidOn")}
          />
          {errors.paidOn && <FieldError id={`${id}-paidOn-error`}>{errors.paidOn}</FieldError>}
        </div>
        <div className="field">
          <label htmlFor={ids.reference}>{ZP.reference}</label>
          <input
            id={ids.reference}
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            aria-invalid={errors.reference ? true : undefined}
            aria-describedby={described("reference", `${id}-safe`)}
          />
          {errors.reference && <FieldError id={`${id}-reference-error`}>{errors.reference}</FieldError>}
        </div>
        <div className="field">
          <label htmlFor={`${id}-note`}>{ZP.note}</label>
          <textarea
            id={`${id}-note`}
            rows={3}
            maxLength={300}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            aria-describedby={`${id}-safe`}
          />
        </div>
      </div>
      {errors.form && (
        <div ref={failureRef} tabIndex={-1} className="pay-failure">
          <Notice tone="error">{errors.form}</Notice>
        </div>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onCancel} disabled={busy}>
          {ZP.cancel}
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {ZP.send}
        </button>
      </div>
    </form>
  );
}
