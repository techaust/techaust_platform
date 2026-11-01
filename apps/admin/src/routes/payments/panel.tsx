// The invoice's Payments panel (07-ZH line 1; ADM-PAY-06, ADM-INV-02, -09, -16, -17; Q60): the ledger of one document. Its figures (total, paid, TDS, credited,
// balance and what was paid above it) stand as a ledger's column, the balance last on a hairline; then the entries on it, the entries waiting for the Owner's
// check, and the actions the role has: Record payment, Record TDS (rupee tax invoices and debit notes of clients in India, L8), Use credit and Move excess to
// credit (Owner, fresh code). An export invoice adds its realisation dates, the bank's extensions and "Bank extended the date" (line 14, Owner). A proforma
// shows only the entries waiting for it and "Confirm by issuing the tax invoice" (line 12, L5), which opens the advance dialog with the payment.
// Figures come from GET /invoices/:id/payments and are formatted by core; nothing is added up here.
import { PAYABLE_TYPES } from "@techaust/core/ledger";
import type { Role } from "@techaust/core/permissions";
import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  type GatewayPaymentRow,
  type InvoicePaymentsPanel,
  paymentsApi,
  RequestError,
  sha256Hex,
  uploadPaymentDoc,
} from "../../api.ts";
import { DateField, useUnreadDates } from "../../components/date-field.tsx";
import { Modal, useRefusalFocus } from "../../components/dialog.tsx";
import { FormField } from "../../components/form.tsx";
import { Alert, Calendar, CreditCard, FileText, Plus, RefreshCw, Wallet } from "../../components/icons.tsx";
import { useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import { dateError } from "../../lib/date-field.ts";
import { GW_UI, itemReason, razorpayLine } from "../../lib/gateway.ts";
import { INVT_COPY } from "../../lib/invoice-types.ts";
import { INV_COPY } from "../../lib/invoices.ts";
import type { InvoiceView } from "../../lib/invoices-api.ts";
import {
  amountText,
  creditHeldLine,
  earlierMonthLine,
  earlierMonthOf,
  MODE_LABELS,
  moveExcessLine,
  PAY_COPY,
  PAY_ERRORS,
  PAY_UI,
  payErrorText,
  plainAmount,
  todayIst,
} from "../../lib/payments.ts";
import { bpToPercent, moneyFrom } from "../../lib/settings-form.ts";
import { withCode } from "../../lib/step-up.ts";
import {
  DocReviewNotice,
  gatewayOf,
  LinkCard,
  linkable,
  OnlineMode,
  OnlineWaiting,
  useDocReview,
} from "./gateway-parts.tsx";
import { day, EarlierMonthWarning, FilePick, PaymentPill, useCodeSlot, useDialogState } from "./parts.tsx";
import { RecordPaymentDialog } from "./record-dialog.tsx";

type Panel = InvoicePaymentsPanel;
type Dialog =
  | "record"
  | "tds"
  | "credit"
  | "excess"
  | "extend"
  | { certificate: string }
  | { letter: string }
  | null;

/** The types a payment goes on (core, re-check cleanup). */
const PAYABLE: readonly string[] = PAYABLE_TYPES;
/** 07-V §5's title (approved), kept here so the panel doesn't load the reports' words. */
const REALISATION_TITLE = "Export realisation";

export const paymentHref = (id: string) => `/payments/${encodeURIComponent(id)}`;

/** The panel, for an issued tax invoice, export invoice or debit note (and a proforma's waiting entries). Reloads the invoice after every change. */
export function PaymentsPanel(props: {
  view: InvoiceView;
  role: Role;
  onChanged: () => void;
  /** A proforma: the Owner confirms a waiting entry through the advance dialog (L5); an online one carries its gateway row (M6.2). */
  onConfirmByAdvance?:
    | ((payment: Panel["pending"][number], online: GatewayPaymentRow | undefined) => void)
    | undefined;
}) {
  const v = props.view;
  const panel = useLoad(() => paymentsApi.invoicePanel(v.id), `${v.id}:${v.updatedAt}`);
  if (panel.state === "loading")
    return (
      <section className="lead-panel pay-panel" aria-labelledby="pay-h" aria-busy="true">
        <h2 id="pay-h" className="lead-panel__title">
          {PAY_COPY.heading}
        </h2>
        <div className="pay-panel__loading" aria-hidden="true">
          <span className="skeleton" style={{ width: "40%" }} />
          <span className="skeleton skeleton--figure" style={{ width: "60%" }} />
          <span className="skeleton" style={{ width: "85%" }} />
        </div>
      </section>
    );
  if (panel.state === "failed")
    return (
      <section className="lead-panel pay-panel" aria-labelledby="pay-h">
        <h2 id="pay-h" className="lead-panel__title">
          {PAY_COPY.heading}
        </h2>
        {panel.error instanceof RequestError && panel.error.status === 404 ? null : (
          <>
            <p className="panel-empty" role="alert">
              <RefreshCw size={20} />
              <span>This didn't load. Try again in a moment.</span>
            </p>
            <button type="button" className="btn btn--text panel-link" onClick={() => panel.reload()}>
              Try again
            </button>
          </>
        )}
      </section>
    );
  const p = panel.data;
  return v.type === "proforma" ? (
    <ProformaPayments
      view={v}
      panel={p}
      role={props.role}
      onConfirm={props.onConfirmByAdvance}
      onChanged={() => {
        panel.reload(true);
        props.onChanged();
      }}
    />
  ) : (
    <LedgerPanel
      view={v}
      panel={p}
      role={props.role}
      onChanged={() => {
        panel.reload(true);
        props.onChanged();
      }}
    />
  );
}

function LedgerPanel(props: { view: InvoiceView; panel: Panel; role: Role; onChanged: () => void }) {
  const { view: v, panel: p, role } = props;
  const [dialog, setDialog] = useDialogState<NonNullable<Dialog>>("pay-h");
  const toast = useToast();
  const live = v.status !== "void" && !v.client.anonymised && PAYABLE.includes(v.type);
  const canRecord = live && allowed(role, "payments.record") && p.balanceMinor > 0;
  const tdsOk =
    canRecord &&
    v.currency === "INR" &&
    (v.type === "tax_invoice" || v.type === "debit_note") &&
    v.client.country === "IN" &&
    v.client.gstStatus !== "overseas";
  const credit = p.credits.find((c) => c.currency === p.currency)?.creditMinor ?? 0;
  const canCredit = live && allowed(role, "payments.applyCredit") && credit > 0 && p.balanceMinor > 0;
  // Code review finding 1: only what the confirmed payments can give back; the TDS part of an excess stays as refund due.
  const canMove = live && allowed(role, "payments.applyCredit") && p.releasableMinor > 0;
  const canCert = allowed(role, "payments.attachProof") && !v.client.anonymised;
  const done = (text: string) => {
    setDialog(null);
    toast("success", text);
    props.onChanged();
  };
  const cur = p.currency;
  // Visual review (low): one `from` object per invoice and balance, so the dialog's open invoices aren't read again on every render.
  const from = useMemo(
    () => ({ id: v.id, number: v.number, type: v.type, balanceMinor: p.balanceMinor, currency: v.currency }),
    [v.id, v.number, v.type, v.currency, p.balanceMinor],
  );
  const client = useMemo(
    () => ({ id: v.client.id, name: v.client.name, currency: v.currency }),
    [v.client.id, v.client.name, v.currency],
  );
  // M6.2: what came in online and still waits for the Owner (a mismatch, a document no longer payable), and this document's open review items.
  const reviewCount = p.gateway?.openReviewCount ?? 0;
  const review = useDocReview(v.id, reviewCount);
  const onlineWaiting = (p.gateway?.payments ?? []).filter(
    (g) => g.status === "pending_verification" && !g.proformaPending,
  );
  return (
    <section className="lead-panel pay-panel" aria-labelledby="pay-h">
      <div className="lead-panel__head">
        <h2 id="pay-h" className="lead-panel__title" tabIndex={-1}>
          {PAY_COPY.heading}
        </h2>
        {(canRecord || tdsOk) && (
          <div className="pay-panel__actions">
            {tdsOk && (
              <button type="button" className="btn btn--secondary" onClick={() => setDialog("tds")}>
                {PAY_UI.recordTds}
              </button>
            )}
            {canRecord && (
              <button type="button" className="btn btn--primary" onClick={() => setDialog("record")}>
                <Plus size={20} />
                {PAY_COPY.recordTitle}
              </button>
            )}
          </div>
        )}
      </div>

      <dl className="pay-figures">
        <div className="pay-figures__row">
          <dt>{INV_COPY.colTotal}</dt>
          <dd>{amountText(p.totalMinor, cur)}</dd>
        </div>
        <div className="pay-figures__row">
          <dt>{PAY_COPY.paid}</dt>
          <dd>{amountText(p.paidMinor, cur)}</dd>
        </div>
        {(p.tdsMinor > 0 || cur === "INR") && (
          <div className="pay-figures__row">
            <dt>{PAY_COPY.tds}</dt>
            <dd>{amountText(p.tdsMinor, cur)}</dd>
          </div>
        )}
        <div className="pay-figures__row">
          <dt>{PAY_COPY.credited}</dt>
          <dd>{amountText(p.creditedMinor, cur)}</dd>
        </div>
        <div className="pay-figures__row pay-figures__total">
          <dt>{PAY_COPY.balance}</dt>
          <dd>{amountText(p.balanceMinor, cur)}</dd>
        </div>
        {p.excessMinor > 0 && (
          <div className="pay-figures__row pay-figures__excess">
            <dt>{PAY_COPY.excess}</dt>
            <dd>{amountText(p.excessMinor, cur)}</dd>
          </div>
        )}
      </dl>

      {(canCredit || canMove || credit > 0) && (
        <div className="pay-credit">
          {credit > 0 && (
            <p className="pay-credit__held">
              <Wallet size={16} />
              <span>{creditHeldLine(amountText(credit, cur))}</span>
            </p>
          )}
          <div className="pay-credit__actions">
            {canCredit && (
              <button type="button" className="btn btn--secondary" onClick={() => setDialog("credit")}>
                {PAY_COPY.useCredit}
              </button>
            )}
            {canMove && (
              <button type="button" className="btn btn--secondary" onClick={() => setDialog("excess")}>
                {PAY_UI.moveExcess}
              </button>
            )}
          </div>
        </div>
      )}

      <DocReviewNotice items={review.items} count={reviewCount} />
      <LinkCard view={v} panel={p} role={role} onChanged={props.onChanged} />

      <Entries panel={p} canCert={canCert} onCertificate={(id) => setDialog({ certificate: id })} />
      {p.pending.length > 0 && <Waiting panel={p} role={role} />}
      <OnlineWaiting rows={onlineWaiting} />
      {p.realisation && (
        <Realisation
          realisation={p.realisation}
          canExtend={allowed(role, "realisation.extend") && live}
          onExtend={() => setDialog("extend")}
          onLetter={(extensionId) => setDialog({ letter: extensionId })}
        />
      )}

      {(dialog === "record" || dialog === "tds") && (
        <RecordPaymentDialog
          open
          kind={dialog === "tds" ? "tds" : "payment"}
          role={role}
          client={client}
          from={from}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            props.onChanged();
          }}
        />
      )}
      {dialog === "credit" && (
        <CreditDialog
          clientId={v.client.id}
          issueDate={v.issueDate}
          panel={p}
          credit={credit}
          onClose={() => setDialog(null)}
          onDone={(warning) => done(warning ? `${PAY_UI.creditUsed} ${warning}` : PAY_UI.creditUsed)}
        />
      )}
      {dialog === "excess" && (
        <ExcessDialog panel={p} onClose={() => setDialog(null)} onDone={() => done(PAY_UI.excessMoved)} />
      )}
      {dialog === "extend" && p.realisation && (
        <ExtendDialog
          documentId={v.id}
          femaDue={p.realisation.femaDue}
          onClose={() => setDialog(null)}
          onDone={(t) => done(t)}
        />
      )}
      {dialog && typeof dialog === "object" && "letter" in dialog && (
        <LetterDialog
          documentId={v.id}
          extensionId={dialog.letter}
          onClose={() => setDialog(null)}
          onDone={() => done(PAY_UI.letterSaved)}
        />
      )}
      {dialog && typeof dialog === "object" && "certificate" in dialog && (
        <CertificateDialog
          paymentId={dialog.certificate}
          onClose={() => setDialog(null)}
          onDone={() => done(PAY_UI.certificateSaved)}
        />
      )}
    </section>
  );
}

/** The confirmed entries on this invoice, as ledger lines (a table; cards below md through the same markup). */
function Entries(props: { panel: Panel; canCert: boolean; onCertificate: (paymentId: string) => void }) {
  const rows = props.panel.payments;
  if (rows.length === 0)
    return (
      <p className="panel-empty pay-panel__empty">
        <Wallet size={20} />
        <span>{PAY_UI.noneOnInvoice}</span>
      </p>
    );
  return (
    <table className="pay-lines">
      <caption className="visually-hidden">{PAY_COPY.heading}</caption>
      <thead>
        <tr>
          <th scope="col">{PAY_COPY.dateReceived}</th>
          <th scope="col">{PAY_COPY.mode}</th>
          <th scope="col">{PAY_COPY.reference}</th>
          <th scope="col" className="num">
            {PAY_UI.colAmount}
          </th>
          <th scope="col">{PAY_UI.colStatus}</th>
          <th scope="col">{PAY_COPY.proof}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.paymentId}>
            <th scope="row" className="tnum">
              <Link to={paymentHref(r.paymentId)} className="pay-row__link">
                {day(r.receivedOn)}
              </Link>
            </th>
            <td data-label={PAY_COPY.mode}>
              {gatewayOf(props.panel, r.paymentId) ? (
                <OnlineMode row={gatewayOf(props.panel, r.paymentId) as GatewayPaymentRow} />
              ) : r.kind === "tds" ? (
                <span className="pay-tds">
                  <span>{PAY_UI.kindTds}</span>
                  {r.tds?.section && (
                    <span className="pay-lines__meta">
                      {r.tds.section}
                      {r.tds.rateBp !== null ? ` · ${bpToPercent(r.tds.rateBp)}\u00a0%` : ""}
                    </span>
                  )}
                </span>
              ) : r.mode ? (
                MODE_LABELS[r.mode]
              ) : (
                ""
              )}
            </td>
            <td data-label={PAY_COPY.reference}>
              {r.kind === "tds" ? (
                r.tds?.certificateAwaited ? (
                  <span className="pay-await">
                    <span className="pay-badge">
                      <Calendar size={16} />
                      {PAY_COPY.certificateAwaited}
                    </span>
                    {props.canCert && (
                      <button
                        type="button"
                        className="btn btn--text"
                        onClick={() => props.onCertificate(r.paymentId)}
                      >
                        {PAY_UI.addCertificate}
                      </button>
                    )}
                  </span>
                ) : (
                  <span className="docno">{r.tds?.certificateNo}</span>
                )
              ) : (
                <span className="docno break">{r.reference}</span>
              )}
            </td>
            <td className="num tnum" data-label={PAY_UI.colAmount}>
              {amountText(r.heldMinor, r.currency)}
              {r.heldMinor !== r.amountMinor && (
                <span className="pay-lines__meta">{`${PAY_UI.colAmount} ${amountText(r.amountMinor, r.currency)}`}</span>
              )}
            </td>
            <td data-label={PAY_UI.colStatus}>
              <PaymentPill status={r.status} />
            </td>
            <td data-label={PAY_COPY.proof}>
              {gatewayOf(props.panel, r.paymentId) ? (
                // M6.2: Razorpay's own record is the proof of an online payment; nothing to attach
                <span className="pay-lines__meta pay-lines__nowrap">Razorpay</span>
              ) : r.hasProof ? (
                <a href={paymentsApi.proofHref(r.paymentId)} className="pay-proof-link">
                  <FileText size={16} />
                  {PAY_UI.openProof}
                </a>
              ) : (
                <span className="pay-lines__meta pay-lines__nowrap">{PAY_UI.noProof}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The entries Staff recorded against this document, waiting for the Owner's check (line 3): the Owner opens each on Payments. */
function Waiting({ panel, role }: { panel: Panel; role: Role }) {
  const owner = allowed(role, "payments.verify");
  return (
    <div className="pay-waiting">
      <h3 className="pay-sub">{PAY_COPY.toCheck}</h3>
      <ul className="pay-waiting__list">
        {panel.pending.map((w) => (
          <li key={w.paymentId} className="pay-waiting__row">
            <span className="pay-waiting__what">
              <Link to={paymentHref(w.paymentId)} className="tnum pay-row__link">
                {day(w.receivedOn)}
              </Link>
              <span className="pay-lines__meta">
                {[w.mode ? MODE_LABELS[w.mode] : PAY_UI.kindTds, w.reference].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="tnum pay-waiting__amount">{amountText(w.askedMinor, w.currency)}</span>
            <PaymentPill status="pending_verification" />
            {owner && (
              <Link to={paymentHref(w.paymentId)} className="btn btn--secondary pay-waiting__go">
                {PAY_COPY.confirm}
                <span className="visually-hidden">{` ${day(w.receivedOn)} ${amountText(w.askedMinor, w.currency)}`}</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A proforma's waiting entries (line 12): the Owner confirms one by issuing the tax invoice for the payment received. M6.2: an online payment shows "Paid online,
 * tax invoice to follow" with S18's line while the automatic issue runs (L6); if that was blocked, S20's reason stands above as the banner, and "Confirm by
 * issuing the tax invoice" opens the advance dialog with its Razorpay reference (read-only). The Payment link card follows.
 */
function ProformaPayments(props: {
  view: InvoiceView;
  panel: Panel;
  role: Role;
  onConfirm?:
    | ((payment: Panel["pending"][number], online: GatewayPaymentRow | undefined) => void)
    | undefined;
  onChanged: () => void;
}) {
  const p = props.panel;
  const reviewCount = p.gateway?.openReviewCount ?? 0;
  const review = useDocReview(p.documentId, reviewCount);
  const blocked = review.items.filter((i) => i.kind === "advance_blocked");
  const others = review.items.filter((i) => i.kind !== "advance_blocked");
  const hasLink =
    (p.gateway?.links.length ?? 0) > 0 || (p.gateway !== undefined && linkable(props.view, props.role));
  if (p.pending.length === 0 && !hasLink && reviewCount === 0) return null;
  const owner = allowed(props.role, "invoices.advance") && props.onConfirm !== undefined;
  return (
    <section className="lead-panel pay-panel" aria-labelledby="pay-h">
      <h2 id="pay-h" className="lead-panel__title">
        {p.pending.length > 0 ? PAY_COPY.toCheck : PAY_COPY.heading}
      </h2>
      {p.pending.length > 0 && <p className="pay-panel__lede">{PAY_COPY.proformaLine}</p>}
      {blocked.map((b) => (
        <div key={b.id} className="pay-blocked" role="note">
          <Alert size={20} />
          <p>{itemReason(b)}</p>
        </div>
      ))}
      {others.length > 0 && <DocReviewNotice items={others} count={others.length} />}
      {p.pending.length > 0 && (
        <ul className="pay-waiting__list">
          {p.pending.map((w) => {
            const online = gatewayOf(p, w.paymentId);
            const isBlocked = online !== undefined && blocked.some((b) => b.payment_id === w.paymentId);
            return (
              <li key={w.paymentId} className="pay-waiting__row pay-waiting__row--proforma">
                <span className="pay-waiting__what">
                  <Link to={paymentHref(w.paymentId)} className="tnum pay-row__link">
                    {day(w.receivedOn)}
                  </Link>
                  {online ? (
                    <>
                      <span className="pay-online__what">
                        <CreditCard size={16} />
                        {GW_UI.proformaToFollow}
                      </span>
                      <span className="pay-lines__meta break">
                        {razorpayLine(online.mode, online.providerPaymentId)}
                      </span>
                      {!isBlocked && <span className="pay-lines__meta">{GW_UI.issuingNow}</span>}
                    </>
                  ) : (
                    <span className="pay-lines__meta">
                      {[w.mode ? MODE_LABELS[w.mode] : "", w.reference].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
                <span className="tnum pay-waiting__amount">{amountText(w.amountMinor, w.currency)}</span>
                {(!online || isBlocked) && <PaymentPill status="pending_verification" />}
                {owner && (
                  <button
                    type="button"
                    className={`btn ${online && !isBlocked ? "btn--secondary" : "btn--primary"} pay-waiting__go`}
                    onClick={() => props.onConfirm?.(w, online)}
                  >
                    {PAY_UI.confirmByIssuing}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <LinkCard view={props.view} panel={p} role={props.role} onChanged={props.onChanged} />
    </section>
  );
}

/** An export invoice's realisation (Q60): the FEMA and GST dates as the scan works them out, the bank's extensions, and the Owner's action. */
function Realisation(props: {
  realisation: NonNullable<Panel["realisation"]>;
  canExtend: boolean;
  onExtend: () => void;
  onLetter: (extensionId: string) => void;
}) {
  const r = props.realisation;
  return (
    <div className="pay-real">
      <div className="pay-real__head">
        {/* 07-V §5's report title names the block (approved); the dates under it are line 41's */}
        <h3 className="pay-sub">{REALISATION_TITLE}</h3>
        {props.canExtend && (
          <button type="button" className="btn btn--secondary" onClick={props.onExtend}>
            <Calendar size={20} />
            {PAY_COPY.extend}
          </button>
        )}
      </div>
      <dl className="inv-facts pay-real__dates">
        <div>
          <dt>{PAY_UI.femaDate}</dt>
          <dd className="tnum">{day(r.femaDue)}</dd>
        </div>
        <div>
          <dt>{PAY_UI.gstDate}</dt>
          <dd className="tnum">{day(r.gstDue)}</dd>
        </div>
      </dl>
      {r.extensions.length > 0 && (
        <div className="pay-real__ext">
          <h4 className="pay-real__ext-h">{PAY_UI.extensions}</h4>
          <ul className="pay-real__list">
            {r.extensions.map((x) => (
              <li key={x.id}>
                <span>{PAY_UI.extensionRow(day(x.extendedTo), x.bankRef)}</span>
                {x.hasLetter || !props.canExtend ? (
                  <span className="pay-lines__meta">
                    {x.hasLetter ? PAY_COPY.bankLetter : PAY_UI.noLetter}
                  </span>
                ) : (
                  // Visual review finding 9: a letter that came after the extension was saved is attached here (line 48).
                  <span className="pay-real__letter">
                    <span className="pay-lines__meta">{PAY_UI.noLetter}</span>
                    <button type="button" className="btn btn--text" onClick={() => props.onLetter(x.id)}>
                      {PAY_UI.attachLetter}
                      <span className="visually-hidden">{` ${PAY_UI.extensionRow(day(x.extendedTo), x.bankRef)}`}</span>
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---- the dialogs ----------------------------------------------------------------------------------------------------------------------------------------

function AmountDialog(props: {
  title: string;
  lede: string;
  label: string;
  initialMinor: number;
  maxMinor: number;
  currency: Panel["currency"];
  exceedsText: string;
  confirmLabel: string;
  onClose: () => void;
  run: (amountMinor: number) => Promise<void>;
  extra?: ReactNode;
}) {
  const [text, setText] = useState(plainAmount(props.initialMinor, props.currency));
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const code = useCodeSlot("pay-amount-code", true);
  const refusal = useRefusalFocus();
  async function submit() {
    const m = moneyFrom(text, props.currency);
    const e = !m.ok
      ? m.error
      : m.minor <= 0
        ? INVT_COPY.amountZero
        : m.minor > props.maxMinor
          ? props.exceedsText
          : null;
    setError(e);
    if (e || !m.ok) {
      document.getElementById("pay-amount-one")?.focus();
      return;
    }
    if (!code.ready()) return;
    setBusy(true);
    setFailure(null);
    try {
      await withCode(code.code, () => props.run(m.minor));
    } catch (err) {
      if (code.refused(err)) return;
      setFailure(payErrorText(err));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={props.title} onClose={props.onClose} busy={busy}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="dialog__body pay-form">
          <p>{props.lede}</p>
          {props.extra}
          <FormField id="pay-amount-one" label={props.label} error={error}>
            {(a) => (
              <div className="money-in">
                <span aria-hidden="true">{props.currency === "INR" ? "₹" : "$"}</span>
                <input
                  {...a}
                  inputMode="decimal"
                  autoComplete="off"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
            )}
          </FormField>
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
            {busy ? "Working…" : props.confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** "Use credit on this invoice" (line 10; Owner, fresh code): first in, first out from the client's credit; the RA-17 warning comes back with the result. */
function CreditDialog(props: {
  clientId: string;
  issueDate: string | null;
  panel: Panel;
  credit: number;
  onClose: () => void;
  onDone: (warning: string | null) => void;
}) {
  const p = props.panel;
  const most = Math.min(props.credit, p.balanceMinor);
  // Visual review finding 6: first in, first out, so the oldest source is always used first; its month against the invoice's warns before the submit.
  const sources = useLoad(() => paymentsApi.clientCredit(props.clientId), props.clientId);
  const oldest = sources.state === "ready" ? sources.data.sources[0]?.receivedOn : undefined;
  const month = earlierMonthOf(oldest, [props.issueDate]);
  return (
    <AmountDialog
      title={PAY_COPY.useCredit}
      lede={creditHeldLine(amountText(props.credit, p.currency))}
      extra={<EarlierMonthWarning month={month} />}
      label={PAY_UI.amountToUse}
      initialMinor={most}
      maxMinor={most}
      currency={p.currency}
      exceedsText={props.credit < p.balanceMinor ? PAY_ERRORS.exceeds_credit : PAY_UI.allocMore}
      confirmLabel={PAY_COPY.useCredit}
      onClose={props.onClose}
      run={async (amountMinor) => {
        const r = await paymentsApi.applyCredit(props.clientId, {
          documentId: p.documentId,
          amountMinor,
          expectedUpdatedAt: p.updatedAt,
        });
        const w = r.warnings[0];
        props.onDone(w ? earlierMonthLine(w.month) : null);
      }}
    />
  );
}

/** "Move excess to credit" (line 11; Owner, fresh code): what was paid above what the invoice owes goes to the client's credit. */
function ExcessDialog(props: { panel: Panel; onClose: () => void; onDone: () => void }) {
  const p = props.panel;
  return (
    <AmountDialog
      title={PAY_UI.moveExcess}
      lede={moveExcessLine(amountText(p.releasableMinor, p.currency))}
      label={PAY_UI.amountToMove}
      initialMinor={p.releasableMinor}
      maxMinor={p.releasableMinor}
      currency={p.currency}
      exceedsText={PAY_ERRORS.exceeds_excess}
      confirmLabel={PAY_UI.moveExcess}
      onClose={props.onClose}
      run={async (amountMinor) => {
        await paymentsApi.releaseExcess(p.documentId, { amountMinor, expectedUpdatedAt: p.updatedAt });
        props.onDone();
      }}
    />
  );
}

/** "Bank extended the date" (line 14; Owner): the new last date, the bank's reference and its letter (uploaded after the extension is saved). */
function ExtendDialog(props: {
  documentId: string;
  femaDue: string;
  onClose: () => void;
  onDone: (toast: string) => void;
}) {
  const [date, setDate] = useState("");
  const [ref, setRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<{ date?: string; ref?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dates = useUnreadDates<"date">();
  const refusal = useRefusalFocus();
  async function submit() {
    const dErr = dateError(dates.unread.date) ?? (date ? undefined : PAY_UI.newDateMissing);
    const e = { ...(dErr ? { date: dErr } : {}), ...(ref.trim() ? {} : { ref: PAY_UI.bankRefMissing }) };
    setErrors(e);
    if (e.date || e.ref) {
      document.getElementById(e.date ? "pay-ext-date" : "pay-ext-ref")?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const r = await paymentsApi.extendRealisation(props.documentId, {
        extendedTo: date,
        bankRef: ref.trim(),
      });
      let said: string = PAY_UI.extensionSaved;
      if (file) {
        try {
          await uploadPaymentDoc(
            { letterOf: { documentId: props.documentId, extensionId: r.id } },
            file,
            await sha256Hex(file),
            () => {},
          );
        } catch (err) {
          said = `${said} ${payErrorText(err)}`;
        }
      }
      props.onDone(said);
    } catch (err) {
      setFailure(payErrorText(err));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={PAY_COPY.extend} onClose={props.onClose} busy={busy}>
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
            <span>{PAY_COPY.extendHint}</span>
          </p>
          <dl className="inv-facts">
            <div>
              <dt>{PAY_UI.femaDate}</dt>
              <dd className="tnum">{day(props.femaDue)}</dd>
            </div>
          </dl>
          <FormField id="pay-ext-date" label={PAY_COPY.newLastDate} error={errors.date}>
            {(a) => (
              <DateField {...a} {...dates.bind("date")} value={date} min={props.femaDue} onChange={setDate} />
            )}
          </FormField>
          <FormField id="pay-ext-ref" label={PAY_COPY.bankRef} error={errors.ref}>
            {(a) => (
              <input
                {...a}
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              />
            )}
          </FormField>
          <FilePick id="pay-ext-letter" label={PAY_COPY.bankLetter} file={file} onFile={setFile} optional />
        </div>
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
            {busy ? "Working…" : PAY_COPY.extend}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** "Attach the bank's letter" (line 48; Owner): the letter of an extension saved without one, through the extension's upload route (set once). */
function LetterDialog(props: {
  documentId: string;
  extensionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = useRefusalFocus();
  async function submit() {
    if (!file) {
      setError(PAY_UI.letterMissing);
      document.getElementById("pay-letter-file")?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    setFailure(null);
    try {
      await uploadPaymentDoc(
        { letterOf: { documentId: props.documentId, extensionId: props.extensionId } },
        file,
        await sha256Hex(file),
        () => {},
      );
      props.onDone();
    } catch (err) {
      setFailure(payErrorText(err));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={PAY_UI.attachLetter} onClose={props.onClose} busy={busy}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="dialog__body pay-form">
          <FilePick
            id="pay-letter-file"
            label={PAY_COPY.bankLetter}
            file={file}
            onFile={setFile}
            error={error}
          />
        </div>
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
            {busy ? "Working…" : PAY_UI.attachLetter}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** "Add the TDS certificate": the Form 16A number and date, set once (L19). */
export function CertificateDialog(props: { paymentId: string; onClose: () => void; onDone: () => void }) {
  const [no, setNo] = useState("");
  const [on, setOn] = useState("");
  const [errors, setErrors] = useState<{ no?: string; on?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dates = useUnreadDates<"on">();
  const refusal = useRefusalFocus();
  const today = todayIst();
  async function submit() {
    const onErr = dateError(dates.unread.on) ?? (on ? undefined : PAY_UI.certificateBoth);
    const e = { ...(no.trim() ? {} : { no: PAY_UI.certificateBoth }), ...(onErr ? { on: onErr } : {}) };
    setErrors(e);
    if (e.no || e.on) {
      document.getElementById(e.no ? "pay-cert-no1" : "pay-cert-on1")?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await paymentsApi.tdsCertificate(props.paymentId, no.trim(), on);
      props.onDone();
    } catch (err) {
      setFailure(payErrorText(err));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={PAY_UI.certificateTitle} onClose={props.onClose} busy={busy}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="dialog__body pay-form">
          <FormField id="pay-cert-no1" label={PAY_COPY.tdsCertificate} error={errors.no}>
            {(a) => (
              <input
                {...a}
                maxLength={40}
                autoComplete="off"
                spellCheck={false}
                value={no}
                onChange={(e) => setNo(e.target.value)}
              />
            )}
          </FormField>
          <FormField id="pay-cert-on1" label={PAY_UI.certificateOn} error={errors.on}>
            {(a) => <DateField {...a} {...dates.bind("on")} value={on} max={today} onChange={setOn} />}
          </FormField>
        </div>
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
            {busy ? "Working…" : PAY_UI.addCertificate}
          </button>
        </div>
      </form>
    </Modal>
  );
}
