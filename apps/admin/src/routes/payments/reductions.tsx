// FEMA reductions on an export invoice's Payments panel (M6.5; ADM-INV-17; run file "08-C n1–n5" n5 → RB-43): under the realisation dates, the bank's Reg. 6
// reductions as quiet lines (amount, day, reference), the line that says why the invoice isn't realised yet when its stage is `reduction_pending`, and the
// Owner's "Record bank's reduction" (a fresh code: `realisation.reduce` is step-up). Settled by the lead on the safest reading, 2026-11-03 (08-C RB-43): the EDF
// keeps the invoice's full value; FEMA treats it as not realised until the reduction is recorded. Amounts are parsed and formatted by core; nothing is added
// up here.
import "../../refunds.css";
import { uuidv7 } from "@techaust/core/ids";
import { useState } from "react";
import type { Currency } from "../../api.ts";
import { DateField, useUnreadDates } from "../../components/date-field.tsx";
import { Modal, useRefusalFocus } from "../../components/dialog.tsx";
import { FormField } from "../../components/form.tsx";
import { Alert, Plus } from "../../components/icons.tsx";
import { useLoad } from "../../components/states.tsx";
import { Notice } from "../../components/ui.tsx";
import { ZO_UI } from "../../lib/copy-zo.ts";
import { dateError } from "../../lib/date-field.ts";
import { INV_COPY } from "../../lib/invoices.ts";
import { amountText, payErrorText, todayIst } from "../../lib/payments.ts";
import { refundsApi } from "../../lib/refunds-api.ts";
import { moneyFrom } from "../../lib/settings-form.ts";
import { withCode } from "../../lib/step-up.ts";
import { day, useCodeSlot } from "./parts.tsx";

/** The reductions under the realisation dates; nothing while there are none and the stage doesn't need one. */
export function Reductions(props: {
  documentId: string;
  stage: string;
  canAdd: boolean;
  onAdd: () => void;
  refreshKey: string;
}) {
  const list = useLoad(
    () => refundsApi.reductions(props.documentId),
    `${props.documentId}:${props.refreshKey}`,
  );
  const rows = list.state === "ready" ? list.data.items : [];
  const pending = props.stage === "reduction_pending";
  if (!pending && rows.length === 0) return null;
  return (
    <div className="pay-real__ext rf-reductions">
      <div className="rf-reductions__head">
        <h4 className="pay-real__ext-h">{ZO_UI.reductions}</h4>
        {props.canAdd && (
          <button type="button" className="btn btn--secondary" onClick={props.onAdd}>
            <Plus size={20} />
            {ZO_UI.reductionAdd}
          </button>
        )}
      </div>
      {pending && (
        <p className="approval-line" data-state="pending">
          <Alert size={16} />
          <span>{ZO_UI.reductionPendingLine}</span>
        </p>
      )}
      {rows.length > 0 && (
        <ul className="pay-real__list">
          {rows.map((r) => (
            <li key={r.id}>
              <span className="tnum">
                {ZO_UI.reductionRow(amountText(r.amount_minor, r.currency), day(r.approved_on), r.bank_ref)}
              </span>
              {r.declaration === 1 && <span className="pay-lines__meta">{ZO_UI.reductionDeclaration}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Record bank's reduction" (the Owner, fresh code). */
export function ReductionDialog(props: {
  documentId: string;
  currency: Currency;
  onClose: () => void;
  onDone: () => void;
}) {
  const [id] = useState(() => uuidv7());
  const [amount, setAmount] = useState("");
  const [approvedOn, setApprovedOn] = useState(todayIst());
  const [bankRef, setBankRef] = useState("");
  const [declaration, setDeclaration] = useState(false);
  const [errors, setErrors] = useState<{ amount?: string; approvedOn?: string; bankRef?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dates = useUnreadDates<"approvedOn">();
  const code = useCodeSlot("rd-code", true);
  const refusal = useRefusalFocus();
  async function submit() {
    const m = moneyFrom(amount, props.currency);
    const e = {
      ...(!m.ok ? { amount: m.error } : m.minor <= 0 ? { amount: "Enter an amount above zero." } : {}),
      ...((dateError(dates.unread.approvedOn) ?? (approvedOn ? undefined : ZO_UI.requiredText))
        ? { approvedOn: dateError(dates.unread.approvedOn) ?? ZO_UI.requiredText }
        : {}),
      ...(bankRef.trim() ? {} : { bankRef: ZO_UI.requiredText }),
    };
    setErrors(e);
    const first = (["amount", "approvedOn", "bankRef"] as const).find((k) => e[k]);
    if (first || !m.ok) {
      document.getElementById(`rd-${first ?? "amount"}`)?.focus();
      return;
    }
    if (!code.ready()) return;
    setBusy(true);
    setFailure(null);
    try {
      await withCode(code.code, () =>
        refundsApi.addReduction(props.documentId, {
          id,
          amountMinor: m.minor,
          approvedOn,
          bankRef: bankRef.trim(),
          declaration,
        }),
      );
      props.onDone();
    } catch (err) {
      if (code.refused(err)) return;
      setFailure(payErrorText(err));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={ZO_UI.reductionAdd} onClose={props.onClose} busy={busy}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="dialog__body pay-form">
          <p className="approval-line" data-state="pending">
            <Alert size={16} />
            <span>{ZO_UI.reductionPendingLine}</span>
          </p>
          <FormField id="rd-amount" label={ZO_UI.reductionAmount} error={errors.amount}>
            {(a) => (
              <div className="money-in">
                <span aria-hidden="true">{props.currency === "INR" ? "₹" : "$"}</span>
                <input
                  {...a}
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            )}
          </FormField>
          <FormField id="rd-approvedOn" label={ZO_UI.reductionApprovedOn} error={errors.approvedOn}>
            {(a) => (
              <DateField
                {...a}
                {...dates.bind("approvedOn")}
                value={approvedOn}
                max={todayIst()}
                onChange={setApprovedOn}
              />
            )}
          </FormField>
          <FormField id="rd-bankRef" label={ZO_UI.reductionBankRef} error={errors.bankRef}>
            {(a) => (
              <input
                {...a}
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                value={bankRef}
                onChange={(e) => setBankRef(e.target.value)}
              />
            )}
          </FormField>
          <div className="rf-check">
            <label className="check">
              <input
                id="rd-declaration"
                type="checkbox"
                checked={declaration}
                aria-describedby="rd-declaration-hint"
                onChange={(e) => setDeclaration(e.target.checked)}
              />
              <span>{ZO_UI.reductionDeclaration}</span>
            </label>
            <p className="hint" id="rd-declaration-hint">
              {ZO_UI.reductionDeclarationHint}
            </p>
          </div>
        </div>
        {code.field}
        {failure && (
          <Notice tone="error" ref={refusal.ref}>
            {failure}
          </Notice>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
            {INV_COPY.cancel}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Working…" : ZO_UI.reductionAdd}
          </button>
        </div>
      </form>
    </Modal>
  );
}
