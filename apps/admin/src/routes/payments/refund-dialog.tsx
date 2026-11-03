// The refund dialog (M6.5; ADM-PAY-08, ADM-INV-09, ADM-INV-11; run file G2, Q1 A, L1, L6 as changed by L33, L7, L40; 08-C RA-40, RA-41, RB-24, RB-43): the
// Owner sends money back, or records a refund made in the gateway's dashboard, or a lost dispute. One form, read top to bottom as the decision is made:
//   1. where the money comes from: the client's credit on this payment, this invoice's excess, or (L33) a payment still waiting for its check, in full;
//      an invoice whose excess can't cover it says "This refund needs a credit note first" (Q1 A) with the credit note's last day (RA-40) and the way to it;
//   2. the amount (at most what that source holds, said under the field), how it goes back (the gateway, our bank transfer with its UTR, day and the
//      payer's account, RB-24) and why;
//   3. the lines the law asks for, only when they apply: RA-41 for credit held across a GST period, RB-43's tick for a client outside India;
//   4. the fresh code (refunds are Owner with step-up), then the one action.
// The dialog's id is a UUIDv7 picked once (the idempotency key the gateway sees too), so pressing again after a lost answer never refunds twice. Amounts are
// parsed and formatted by core; the limits are the server's figures; nothing is added up here.
import "../../refunds.css";
import { uuidv7 } from "@techaust/core/ids";
import { REFUND_MODES, REFUND_REASONS, type RefundReason, refundExportWarning } from "@techaust/core/refunds";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { type Currency, type PaymentStatus, paymentsApi, RequestError } from "../../api.ts";
import { DateField, useUnreadDates } from "../../components/date-field.tsx";
import { Modal, useRefusalFocus } from "../../components/dialog.tsx";
import { FormField } from "../../components/form.tsx";
import { Alert, FileText } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { periodText, ZO_UI } from "../../lib/copy-zo.ts";
import { dateError } from "../../lib/date-field.ts";
import { INV_COPY } from "../../lib/invoices.ts";
import { amountText, MODE_LABELS, payErrorText, plainAmount, todayIst } from "../../lib/payments.ts";
import { type RefundIn, refundsApi } from "../../lib/refunds-api.ts";
import { moneyFrom } from "../../lib/settings-form.ts";
import { withCode } from "../../lib/step-up.ts";
import { day, useCodeSlot } from "./parts.tsx";

type Source = "credit" | "document" | "pending";
type Way = "gateway" | "manual";

/** What the dialog is opened for: a refund, a refund made outside the admin, or a lost dispute (L7, L40). */
export type RefundMode = "refund" | "outside" | "chargeback";

export type RefundDialogProps = {
  mode: RefundMode;
  /**
   * The payments the refund may come from (at least one; with more than one the Owner picks): the invoice's payments, or the client's credit sources. A choice
   * that doesn't carry its gateway, status or amount is read once (`GET /payments/:id`).
   */
  payments: readonly RefundChoice[];
  /** The invoice the dialog was opened from: a refund of its excess (after its credit note). */
  document?:
    | {
        id: string;
        number: string | null;
        type: string;
        updatedAt: number;
        excessMinor: number;
      }
    | undefined;
  /** The client is outside India (RB-43's tick); unknown: the tick shows when the server asks for it. */
  clientOverseas?: boolean | undefined;
  /** From a "Needs review" item: the gateway's refund or dispute id, the amount and the day. */
  prefill?:
    | {
        amountMinor?: number | undefined;
        providerRefundId?: string | undefined;
        settledOn?: string | undefined;
      }
    | undefined;
  /** Opens the invoice's credit-note dialog (Q1 A). Never for a debit note (M5.3 issues no credit note on one; review part 2, P2-5). */
  onCreditNote?: (() => void) | undefined;
  onClose: () => void;
  onDone: (toast: string) => void;
};

/** One payment a refund may come from: what it can give back from credit (`freeMinor`) and what it holds on the invoice (`holdingMinor`). */
export type RefundChoice = {
  id: string;
  receivedOn: string;
  currency: Currency;
  freeMinor: number;
  holdingMinor?: number | undefined;
  provider?: string | undefined;
  status?: PaymentStatus | undefined;
  amountMinor?: number | undefined;
};

/**
 * Review part 2, P2-7 and P2-13: focus a field once its error is drawn and bring its whole block into view (the label above, the error below), clear of the
 * dialog's sticky title and actions (the dialog's scroll padding and the blocks' scroll margins in refunds.css).
 */
const focusBlock = (id: string) =>
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    el?.focus({ preventScroll: true });
    (el?.closest(".field, .rf-check, .rf-export") ?? el)?.scrollIntoView({ block: "nearest" });
  });

const SOURCE_REASON: Record<Source, RefundReason> = {
  credit: "overpayment",
  document: "credit_note",
  pending: "duplicate",
};

export function RefundDialog(props: RefundDialogProps) {
  const [paymentId, setPaymentId] = useState(props.payments[0]?.id ?? "");
  const choice = props.payments.find((x) => x.id === paymentId) ?? props.payments[0];
  const known =
    choice?.provider !== undefined && choice.status !== undefined && choice.amountMinor !== undefined;
  const detail = useLoad(
    () => (known || !choice ? Promise.resolve(null) : paymentsApi.get(choice.id).then((r) => r.payment)),
    `${choice?.id ?? ""}:${known}`,
  );
  const [busy, setBusy] = useState(false);
  const resolved: ResolvedPayment | null = !choice
    ? null
    : known
      ? (choice as ResolvedPayment)
      : detail.state === "ready" && detail.data
        ? {
            ...choice,
            provider: detail.data.provider,
            status: detail.data.status,
            amountMinor: detail.data.amountMinor,
            currency: detail.data.currency,
          }
        : null;
  const title =
    props.mode === "chargeback"
      ? ZO_UI.disputeTitle
      : props.mode === "outside"
        ? ZO_UI.recordTitle
        : ZO_UI.dialogTitle;
  const cur = choice?.currency ?? "INR";
  return (
    <Modal open title={title} onClose={props.onClose} busy={busy} className="dialog--refund">
      {props.payments.length > 1 && (
        <div className="dialog__body rf-choose">
          <FormField id="rf-payment" label={ZO_UI.pickPayment}>
            {(a) => (
              <select {...a} value={paymentId} disabled={busy} onChange={(e) => setPaymentId(e.target.value)}>
                {props.payments.map((x) => (
                  <option key={x.id} value={x.id}>
                    {ZO_UI.pickPaymentOption(day(x.receivedOn), amountText(x.freeMinor, cur))}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>
      )}
      {resolved ? (
        <RefundForm key={resolved.id} {...props} payment={resolved} onBusy={setBusy} />
      ) : detail.state === "failed" ? (
        <LoadFailed error={detail.error} onRetry={() => detail.reload()} />
      ) : (
        <div className="dialog__body" aria-busy="true">
          <span className="skeleton" style={{ width: "60%" }} />
          <span className="skeleton" style={{ width: "80%" }} />
        </div>
      )}
    </Modal>
  );
}

type ResolvedPayment = RefundChoice & { provider: string; status: PaymentStatus; amountMinor: number };

/** The form for one payment (remounted when the Owner picks another, so its amounts start again). */
function RefundForm(props: RefundDialogProps & { payment: ResolvedPayment; onBusy: (b: boolean) => void }) {
  const p = props.payment;
  const cur = p.currency;
  const outside = props.mode !== "refund";
  const chargeback = props.mode === "chargeback";
  const [refundId] = useState(() => uuidv7());
  const pendingOk = p.status === "pending_verification" && p.provider !== "manual";
  // The sources this payment offers: a waiting gateway payment goes back whole (L33); else the invoice's excess and the credit.
  const offered: Source[] = pendingOk
    ? ["pending"]
    : [
        ...(props.document ? (["document"] as const) : []),
        ...(p.freeMinor > 0 || !props.document ? (["credit"] as const) : []),
      ];
  const mostOf = (s: Source) =>
    s === "pending"
      ? p.amountMinor
      : s === "document"
        ? Math.min(props.document?.excessMinor ?? 0, p.holdingMinor ?? 0)
        : p.freeMinor;
  // the first source that holds money is chosen to start with (an invoice with no excess leaves the credit chosen)
  const [source, setSource] = useState<Source>(offered.find((s) => mostOf(s) > 0) ?? offered[0] ?? "credit");
  const paymentId = p.id;
  const provider = p.provider;
  const gatewayPaid = provider !== "manual";
  const [way, setWay] = useState<Way>(gatewayPaid ? "gateway" : "manual");
  const most = mostOf(source);
  // Q1 A (RA-40): the invoice's excess can't cover the refund, so a credit note comes first. A refund made in the gateway's dashboard (outside) follows the
  // same rule with its own amount (review part 2, P2-3; the server's L7); a lost dispute skips the excess (the gateway took the money back).
  const prefilled = props.prefill?.amountMinor;
  const noteFirst =
    source === "document" &&
    !chargeback &&
    (most <= 0 || (props.mode === "outside" && prefilled !== undefined && prefilled > most));
  const [amount, setAmount] = useState(() =>
    props.prefill?.amountMinor !== undefined
      ? plainAmount(props.prefill.amountMinor, cur)
      : most > 0
        ? plainAmount(most, cur)
        : "",
  );
  const [reason, setReason] = useState<RefundReason>(chargeback ? "chargeback" : SOURCE_REASON[source]);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<string>("neft");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(todayIst());
  const [paidTo, setPaidTo] = useState<"original" | "own_account">(gatewayPaid ? "own_account" : "original");
  const [written, setWritten] = useState(false);
  const [gwRef, setGwRef] = useState(props.prefill?.providerRefundId ?? "");
  const [settledOn, setSettledOn] = useState(props.prefill?.settledOn ?? todayIst());
  const [exportOk, setExportOk] = useState(false);
  const [askExport, setAskExport] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<ReactNode | null>(null);
  const [needNote, setNeedNote] = useState<{ advance: boolean } | null>(null);
  const [busy, setBusyState] = useState(false);
  const setBusy = (b: boolean) => {
    setBusyState(b);
    props.onBusy(b);
  };
  const dates = useUnreadDates<"paidOn" | "settledOn">();
  const code = useCodeSlot("rf-code", true);
  const refusal = useRefusalFocus();
  const name = useId();

  // RA-40 and RA-41's facts, read once for this payment (and the invoice the refund would draw on).
  const docId = props.document?.id;
  const facts = useLoad(() => refundsApi.ofPayment(paymentId, docId), `${paymentId}:${docId ?? ""}`);
  const f = facts.state === "ready" ? facts.data.facts : null;
  const exportWarning = refundExportWarning({
    docType: props.document?.type ?? null,
    clientOverseas: props.clientOverseas === true,
  });
  // L47 (RB-43; settled by the lead on the safest reading, 2026-11-03): recording money that has already gone back (outside, a lost dispute) is never held
  // by the bank tick; those modes say what to do after the fact. The tick stays before our own refund (and shows if the server still asks for it).
  const exportTick = askExport || (exportWarning && !outside);
  const exportAfter = outside && exportWarning && !askExport;
  const reasons = useMemo(
    () =>
      REFUND_REASONS.filter((r) =>
        props.mode === "chargeback" ? r === "chargeback" : r !== "chargeback" && r !== "tds_payback",
      ),
    [props.mode],
  );

  const action =
    props.mode === "chargeback"
      ? ZO_UI.disputeButton
      : props.mode === "outside"
        ? ZO_UI.recordButton
        : ZO_UI.refundButton;

  // Review part 2, P2-13: the dialog opens with focus on the chosen source (never on a source that can give nothing), unless the payment picker has it.
  const chosenRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (document.activeElement?.closest(".rf-choose")) return;
      chosenRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  function pickSource(s: Source) {
    setSource(s);
    // Review part 2, P2-13: a "credit note first" answer belonged to the source it was asked for
    setNeedNote(null);
    setFailure(null);
    setReason(chargeback ? "chargeback" : SOURCE_REASON[s]);
    const m = mostOf(s);
    setAmount(m > 0 ? plainAmount(m, cur) : "");
  }

  async function submit() {
    const e: Record<string, string> = {};
    const m = moneyFrom(amount, cur);
    if (!m.ok) e.amount = m.error;
    else if (m.minor <= 0) e.amount = "Enter an amount above zero.";
    else if (!chargeback && m.minor > most && source !== "pending")
      e.amount = ZO_UI.amountMost(amountText(most, cur));
    if (outside) {
      if (!gwRef.trim()) e.gwRef = ZO_UI.requiredText;
      const d = dateError(dates.unread.settledOn) ?? (settledOn ? undefined : ZO_UI.requiredText);
      if (d) e.settledOn = d;
    } else if (way === "manual") {
      if (!reference.trim()) e.reference = ZO_UI.requiredText;
      const d = dateError(dates.unread.paidOn) ?? (paidOn ? undefined : ZO_UI.requiredText);
      if (d) e.paidOn = d;
      if (paidTo === "own_account" && !written) e.written = ZO_UI.writtenRequestMissing;
    }
    if (exportTick && !exportOk) e.export = ZO_UI.exportConfirmMissing;
    setErrors(e);
    const first = ["amount", "gwRef", "settledOn", "reference", "paidOn", "written", "export"].find(
      (k) => e[k],
    );
    if (first || !m.ok) {
      focusBlock(`rf-${first ?? "amount"}`);
      return;
    }
    if (!code.ready()) return;
    const body: RefundIn = {
      id: refundId,
      amountMinor: m.minor,
      from: source,
      reasonCode: reason,
      ...(source === "document" && props.document
        ? {
            documentId: props.document.id,
            expectedUpdatedAt: props.document.updatedAt,
            // Review part 1, finding 6 (RA-40): the invoice's newest issued credit note, as the server read it (the server falls back to the same note).
            ...(f?.issuedCreditNote ? { creditNoteId: f.issuedCreditNote.id } : {}),
          }
        : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(outside
        ? {
            outside: {
              providerRefundId: gwRef.trim(),
              origin: props.mode === "chargeback" ? "chargeback" : "outside",
              settledOn,
            },
          }
        : way === "manual"
          ? {
              manual: {
                mode,
                reference: reference.trim(),
                paidOn,
                paidTo,
                // Review part 1, finding 10 (RB-24): the payer's written request, recorded with the refund.
                ...(paidTo === "own_account" ? { writtenRequest: true as const } : {}),
              },
            }
          : {}),
      ...(exportTick ? { confirmExport: exportOk } : {}),
    };
    setBusy(true);
    setFailure(null);
    try {
      const r = await withCode(code.code, () => refundsApi.create(paymentId, body));
      const s = r.refund?.status;
      props.onDone(
        props.mode === "chargeback"
          ? ZO_UI.disputeRecorded
          : outside
            ? ZO_UI.recorded
            : r.status === "requested" || s === "requested"
              ? ZO_UI.sentRequested
              : s === "processing"
                ? ZO_UI.sentProcessing
                : ZO_UI.sentSucceeded,
      );
    } catch (err) {
      if (code.refused(err)) return;
      if (err instanceof RequestError) {
        const d = err.extra.details ?? {};
        if (err.code === "export_refund_unconfirmed") {
          setAskExport(true);
          setErrors((x) => ({ ...x, export: ZO_UI.exportConfirmMissing }));
          focusBlock("rf-export");
          return;
        }
        if (err.code === "credit_note_needed") {
          setNeedNote({ advance: d.noteReason === "service_not_delivered" });
          return;
        }
        const limit =
          typeof d.refundableMinor === "number"
            ? d.refundableMinor
            : typeof d.holdingMinor === "number"
              ? d.holdingMinor
              : null;
        if (limit !== null) {
          setFailure(`${payErrorText(err)} ${ZO_UI.amountMost(amountText(limit, cur))}`);
          refusal.show();
          return;
        }
        if (err.code === "gateway_refused" && typeof d.code === "string") {
          setFailure(`${payErrorText(err)} ${ZO_UI.failureCode(d.code)}`);
          refusal.show();
          return;
        }
      }
      setFailure(payErrorText(err));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }

  const showNoteFirst = noteFirst || needNote !== null;
  const isDebitNote = props.document?.type === "debit_note";
  const creditNote = f?.creditNote ?? null;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="dialog__body pay-form rf-form">
        <dl className="inv-facts rf-facts">
          <div>
            <dt>{ZO_UI.paymentReceived}</dt>
            <dd className="tnum">{ZO_UI.paymentFact(amountText(p.amountMinor, cur), day(p.receivedOn))}</dd>
          </div>
          {props.document?.number && (
            <div>
              <dt>{ZO_UI.invoiceLabel}</dt>
              <dd className="docno">{props.document.number}</dd>
            </div>
          )}
        </dl>

        {props.mode === "chargeback" && <p className="rf-lede">{ZO_UI.chargebackHint}</p>}

        {offered.length > 1 && (
          <fieldset className="rf-pick">
            <legend className="rf-pick__legend">{ZO_UI.sourceLabel}</legend>
            {offered.map((s) => (
              <label key={s} className="rf-pick__opt">
                <input
                  ref={source === s ? chosenRef : undefined}
                  type="radio"
                  name={`${name}-src`}
                  checked={source === s}
                  onChange={() => pickSource(s)}
                />
                <span className="rf-pick__text">
                  <span className="rf-pick__title">
                    {s === "credit"
                      ? ZO_UI.sourceCredit
                      : s === "document"
                        ? ZO_UI.sourceDocument
                        : ZO_UI.sourcePending}
                  </span>
                  <span className="rf-pick__hint">
                    {s === "credit"
                      ? ZO_UI.sourceCreditHint(amountText(p.freeMinor, cur))
                      : s === "document"
                        ? ZO_UI.sourceDocumentHint(amountText(props.document?.excessMinor ?? 0, cur))
                        : ZO_UI.sourcePendingHint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {offered.length === 1 && source === "pending" && <p className="rf-lede">{ZO_UI.sourcePendingHint}</p>}

        {showNoteFirst ? (
          <section className="rf-note-first" aria-labelledby={`${name}-nf`}>
            <h3 id={`${name}-nf`} className="rf-note-first__h">
              <FileText size={20} />
              {ZO_UI.creditNoteFirst}
            </h3>
            {isDebitNote ? (
              <p>{ZO_UI.debitNoteNoCredit}</p>
            ) : props.mode === "outside" ? (
              <p>{ZO_UI.outsideNoteFirst(provider)}</p>
            ) : (
              <p>{ZO_UI.creditNoteFirstBody}</p>
            )}
            {props.document && (
              <p className="tnum">{ZO_UI.excessNow(amountText(props.document.excessMinor, cur))}</p>
            )}
            {needNote?.advance && <p>{ZO_UI.creditNoteAdvance}</p>}
            {!isDebitNote &&
              creditNote &&
              (creditNote.open ? (
                <p
                  className="tnum"
                  data-state={
                    creditNote.deadlineWarnFrom && todayIst() >= creditNote.deadlineWarnFrom
                      ? "warn"
                      : undefined
                  }
                >
                  {creditNote.deadlineWarnFrom && todayIst() >= creditNote.deadlineWarnFrom
                    ? ZO_UI.creditNoteWarn(day(creditNote.lastDay))
                    : ZO_UI.creditNoteLastDay(day(creditNote.lastDay))}
                </p>
              ) : (
                <p className="rf-note-first__closed">
                  <Alert size={16} />
                  {ZO_UI.creditNoteClosed(day(creditNote.lastDay))}
                </p>
              ))}
            {!isDebitNote &&
              (creditNote === null || creditNote.open) &&
              (props.onCreditNote ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    props.onClose();
                    props.onCreditNote?.();
                  }}
                >
                  {ZO_UI.draftCreditNote}
                </button>
              ) : props.document?.number ? (
                // Opened from "Needs review" (P2-3): the credit note is drafted on the invoice's own page.
                <Link to={`/invoices/${encodeURIComponent(props.document.id)}`} className="btn btn--primary">
                  {ZO_UI.openInvoice(props.document.number)}
                </Link>
              ) : null)}
          </section>
        ) : (
          <>
            <FormField
              id="rf-amount"
              label={chargeback ? ZO_UI.disputeAmountLabel : ZO_UI.amountLabel}
              hint={source !== "pending" && !chargeback ? ZO_UI.amountMost(amountText(most, cur)) : undefined}
              error={errors.amount}
            >
              {(a) => (
                <div className="money-in">
                  <span aria-hidden="true">{cur === "INR" ? "₹" : "$"}</span>
                  <input
                    {...a}
                    inputMode="decimal"
                    autoComplete="off"
                    value={amount}
                    readOnly={source === "pending"}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              )}
            </FormField>

            {outside ? (
              <>
                <FormField
                  id="rf-gwRef"
                  label={
                    props.mode === "chargeback"
                      ? ZO_UI.disputeIdLabel(provider)
                      : ZO_UI.gatewayRefundIdLabel(provider)
                  }
                  error={errors.gwRef}
                >
                  {(a) => (
                    <input
                      {...a}
                      maxLength={255}
                      autoComplete="off"
                      spellCheck={false}
                      className="docno"
                      value={gwRef}
                      onChange={(e) => setGwRef(e.target.value)}
                    />
                  )}
                </FormField>
                <FormField
                  id="rf-settledOn"
                  label={props.mode === "chargeback" ? ZO_UI.disputeClosedOnLabel : ZO_UI.settledOnLabel}
                  error={errors.settledOn}
                >
                  {(a) => (
                    <DateField
                      {...a}
                      {...dates.bind("settledOn")}
                      value={settledOn}
                      max={todayIst()}
                      onChange={setSettledOn}
                    />
                  )}
                </FormField>
              </>
            ) : (
              <>
                {gatewayPaid && source !== "pending" && (
                  <fieldset className="rf-pick">
                    <legend className="rf-pick__legend">{ZO_UI.wayLabel}</legend>
                    {(["gateway", "manual"] as const).map((w) => (
                      <label key={w} className="rf-pick__opt">
                        <input
                          type="radio"
                          name={`${name}-way`}
                          checked={way === w}
                          onChange={() => {
                            setWay(w);
                            if (w === "manual") setPaidTo("own_account");
                          }}
                        />
                        <span className="rf-pick__text">
                          <span className="rf-pick__title">
                            {w === "gateway" ? ZO_UI.wayGateway(provider) : ZO_UI.wayManual}
                          </span>
                          {w === "manual" && <span className="rf-pick__hint">{ZO_UI.gatewayByBank}</span>}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
                {way === "manual" && (
                  <div className="rf-manual">
                    <FormField id="rf-mode" label={ZO_UI.modeLabel}>
                      {(a) => (
                        <select {...a} value={mode} onChange={(e) => setMode(e.target.value)}>
                          {REFUND_MODES.map((m) => (
                            <option key={m} value={m}>
                              {MODE_LABELS[m]}
                            </option>
                          ))}
                        </select>
                      )}
                    </FormField>
                    <FormField id="rf-reference" label={ZO_UI.referenceLabel} error={errors.reference}>
                      {(a) => (
                        <input
                          {...a}
                          maxLength={40}
                          autoComplete="off"
                          spellCheck={false}
                          className="docno"
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                        />
                      )}
                    </FormField>
                    <FormField id="rf-paidOn" label={ZO_UI.paidOnLabel} error={errors.paidOn}>
                      {(a) => (
                        <DateField
                          {...a}
                          {...dates.bind("paidOn")}
                          value={paidOn}
                          max={todayIst()}
                          onChange={setPaidOn}
                        />
                      )}
                    </FormField>
                    <fieldset className="rf-pick">
                      <legend className="rf-pick__legend">{ZO_UI.paidToLabel}</legend>
                      {(gatewayPaid
                        ? (["own_account"] as const)
                        : (["original", "own_account"] as const)
                      ).map((t) => (
                        <label key={t} className="rf-pick__opt">
                          <input
                            type="radio"
                            name={`${name}-to`}
                            checked={paidTo === t}
                            onChange={() => setPaidTo(t)}
                          />
                          <span className="rf-pick__text">
                            <span className="rf-pick__title">
                              {t === "original" ? ZO_UI.paidToOriginal : ZO_UI.paidToOwn}
                            </span>
                            {t === "own_account" && (
                              <span className="rf-pick__hint">{ZO_UI.paidToOwnHint}</span>
                            )}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    {paidTo === "own_account" && (
                      <div className="rf-check">
                        <label className="check">
                          <input
                            id="rf-written"
                            type="checkbox"
                            checked={written}
                            aria-invalid={errors.written ? true : undefined}
                            aria-describedby={errors.written ? "rf-written-error" : undefined}
                            onChange={(e) => setWritten(e.target.checked)}
                          />
                          <span>{ZO_UI.writtenRequest}</span>
                        </label>
                        {errors.written && <FieldError id="rf-written-error">{errors.written}</FieldError>}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {props.mode !== "chargeback" && (
              <FormField id="rf-reason" label={ZO_UI.reasonLabel}>
                {(a) => (
                  <select {...a} value={reason} onChange={(e) => setReason(e.target.value as RefundReason)}>
                    {reasons.map((r) => (
                      <option key={r} value={r}>
                        {ZO_UI.reason[r]}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            )}
            <FormField id="rf-note" label={ZO_UI.noteLabel} optional>
              {(a) => (
                <textarea
                  {...a}
                  rows={2}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </FormField>

            {source === "credit" && f?.ra41.showLine && (
              <div className="pay-seen pay-warn" role="note">
                <Alert size={20} />
                <p>{ZO_UI.ra41Line(periodText(f.ra41.receivedPeriod), periodText(f.ra41.refundPeriod))}</p>
              </div>
            )}

            {exportAfter && (
              <div className="pay-seen pay-warn" role="note">
                <Alert size={20} />
                <p>{ZO_UI.exportLineAfter}</p>
              </div>
            )}
            {exportTick && (
              <div className="rf-export">
                <div className="pay-seen pay-warn" role="note">
                  <Alert size={20} />
                  <p>{ZO_UI.exportLine}</p>
                </div>
                <label className="check">
                  <input
                    id="rf-export"
                    type="checkbox"
                    checked={exportOk}
                    aria-invalid={errors.export ? true : undefined}
                    aria-describedby={errors.export ? "rf-export-error" : undefined}
                    onChange={(e) => setExportOk(e.target.checked)}
                  />
                  <span>{ZO_UI.exportConfirm}</span>
                </label>
                {errors.export && <FieldError id="rf-export-error">{errors.export}</FieldError>}
              </div>
            )}
          </>
        )}
      </div>
      {!showNoteFirst && code.field}
      {failure && (
        <Notice tone="error" ref={refusal.ref}>
          {failure}
        </Notice>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
          {INV_COPY.cancel}
        </button>
        {!showNoteFirst && (
          <button
            type="submit"
            className={props.mode === "refund" ? "btn btn--primary" : "btn btn--danger"}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? "Working…" : action}
          </button>
        )}
      </div>
    </form>
  );
}
