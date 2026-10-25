// The confirmations of a proposal or estimate (M4.3): send (ADM-G-04: the amount and the client, and the honest "until M4.5" line), ask
// the owner to approve, make a new version, discard a draft, and the two conversions of an accepted estimate (an invoice draft, or a
// care plan with its start date and billing day). Each says what happens before it happens; each result links to what was made.
import "../../care.css";
import { useState } from "react";
import { Link } from "react-router";
import type { Currency } from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { Modal } from "../../components/dialog.tsx";
import { FormField } from "../../components/form.tsx";
import { Notice } from "../../components/ui.tsx";
import { CARE_COPY, CARE_PENDING, type DurationForm, durationMinutes, TIER_LABELS } from "../../lib/care.ts";
import {
  careDone,
  careTitle,
  DOC_COPY,
  DOC_PENDING,
  docErrorText,
  invoiceTitle,
  mappedError,
  moneyText,
  reviseBody,
  sendLine,
  sendTitle,
} from "../../lib/documents.ts";
import { type CareConverted, documentsApi } from "../../lib/documents-api.ts";
import { intIn } from "../../lib/settings-form.ts";
import { DurationFields } from "../care/terms-fields.tsx";

/** ADM-G-04: what is sent, for how much, to whom; then the honest line about email until M4.5. */
export function SendDialog(props: {
  open: boolean;
  title: string;
  version: number;
  totalMinor: number | null;
  currency: Currency;
  client: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open={props.open}
      title={sendTitle(props.title, props.version)}
      confirmLabel={DOC_COPY.send}
      busyLabel="Sending…"
      onConfirm={async () => {
        try {
          await props.onConfirm();
        } catch (e) {
          throw mappedError(e);
        }
        return undefined;
      }}
      onClose={props.onClose}
    >
      {props.totalMinor !== null && (
        <p className="confirm-figure">
          <span className="tnum">{sendLine(moneyText(props.totalMinor, props.currency), props.client)}</span>
        </p>
      )}
      <p>{DOC_COPY.sendIntro}</p>
      <Notice tone="info">{DOC_COPY.untilPortal}</Notice>
    </ConfirmDialog>
  );
}

/** "Ask the owner to approve": a reason for the owner, and the rule that the approval covers this version's exact content only. */
export function RequestDialog(props: {
  open: boolean;
  onSend: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setReason("");
    setError(null);
    props.onClose();
  };
  return (
    <Modal open={props.open} title={DOC_COPY.requestTitle} onClose={close} busy={busy}>
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await props.onSend(reason.trim());
            close();
          } catch (err) {
            setError(docErrorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="dialog__body">
          <FormField id="apr-reason" label={DOC_COPY.reason} optional>
            {(a) => (
              <textarea
                {...a}
                rows={4}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </FormField>
          <p className="hint">{DOC_COPY.requestNote}</p>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Sending…" : DOC_COPY.sendRequest}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ReviseDialog(props: {
  open: boolean;
  version: number;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open={props.open}
      title={DOC_COPY.reviseTitle}
      confirmLabel={DOC_COPY.reviseButton}
      onConfirm={async () => {
        try {
          await props.onConfirm();
        } catch (e) {
          throw mappedError(e);
        }
        return undefined;
      }}
      onClose={props.onClose}
    >
      <p>{reviseBody(props.version)}</p>
    </ConfirmDialog>
  );
}

export function DiscardDialog(props: { open: boolean; onConfirm: () => Promise<void>; onClose: () => void }) {
  return (
    <ConfirmDialog
      open={props.open}
      title={DOC_COPY.discardTitle}
      confirmLabel={DOC_COPY.discardButton}
      tone="danger"
      onConfirm={async () => {
        try {
          await props.onConfirm();
        } catch (e) {
          throw mappedError(e);
        }
        return undefined;
      }}
      onClose={props.onClose}
    >
      <p>{DOC_COPY.discardBody}</p>
    </ConfirmDialog>
  );
}

/** An accepted estimate becomes an invoice draft (100 % upfront small job, ADM-EST-02). Invoices have no screen until M5. */
export function InvoiceDialog(props: {
  open: boolean;
  id: string;
  number: string;
  version: number;
  onDone: () => void;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open={props.open}
      title={invoiceTitle(props.number, props.version)}
      resultTitle={DOC_COPY.invoiceDone}
      confirmLabel={DOC_COPY.invoiceButton}
      onConfirm={async () => {
        try {
          await documentsApi.toInvoice(props.id);
        } catch (e) {
          throw mappedError(e);
        }
        props.onDone();
        return <p>{DOC_COPY.invoiceDone}</p>;
      }}
      onClose={props.onClose}
    >
      {null}
    </ConfirmDialog>
  );
}

/** An accepted care-plan estimate becomes a care plan: the tier, price and AI Ops amount come from the estimate, never from here. */
export function CareDialog(props: {
  open: boolean;
  id: string;
  number: string;
  version: number;
  clientCode: string;
  onDone: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={props.open} title={careTitle(props.number, props.version)} onClose={props.onClose}>
      {props.open && <CareForm {...props} />}
    </Modal>
  );
}

function CareForm(props: { id: string; clientCode: string; onDone: () => void; onClose: () => void }) {
  const [startDate, setStartDate] = useState("");
  const [billingDay, setBillingDay] = useState("1");
  const [included, setIncluded] = useState<DurationForm>({ hours: "", minutes: "0" });
  const [errors, setErrors] = useState<Partial<Record<"startDate" | "billingDay" | "included", string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<CareConverted | null>(null);

  if (made) {
    const code = `${props.clientCode} ${TIER_LABELS[made.tier as keyof typeof TIER_LABELS] ?? made.tier}`;
    return (
      <>
        <div className="dialog__body">
          <Notice tone="success">{careDone(code)}</Notice>
        </div>
        <div className="dialog__actions">
          <Link to={`/care-plans/${encodeURIComponent(made.id)}`} className="btn btn--primary">
            {DOC_PENDING.openCarePlan}
          </Link>
        </div>
      </>
    );
  }

  async function submit() {
    const e: typeof errors = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) e.startDate = CARE_PENDING.enterStartDate;
    const day = intIn(billingDay, 1, 28);
    if (day === null) e.billingDay = CARE_PENDING.enterBillingDay;
    const minutes =
      included.hours.trim() === "" && included.minutes === "0" ? null : durationMinutes(included, 2000);
    if (included.hours.trim() !== "" && minutes === null) e.included = CARE_PENDING.enterHours;
    setErrors(e);
    const first = e.startDate ? "cv-start" : e.billingDay ? "cv-day" : e.included ? "cv-included" : null;
    if (first) {
      document.getElementById(first)?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const r = await documentsApi.toCarePlan(props.id, {
        startDate,
        billingDay: day as number,
        ...(minutes !== null ? { includedMinutes: minutes } : {}),
      });
      setMade(r);
      props.onDone();
    } catch (err) {
      const text = docErrorText(err);
      if ((err as { code?: string }).code === "included_minutes_required") {
        setErrors({ included: text });
        document.getElementById("cv-included")?.focus();
      } else setFailure(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="dialog__body">
        <FormField id="cv-start" label={DOC_COPY.startDate} error={errors.startDate}>
          {(a) => (
            <input {...a} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          )}
        </FormField>
        <FormField
          id="cv-day"
          label={DOC_COPY.billingDay}
          hint={CARE_COPY.billingDayHint}
          error={errors.billingDay}
        >
          {(a) => (
            <input
              {...a}
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              value={billingDay}
              onChange={(e) => setBillingDay(e.target.value)}
            />
          )}
        </FormField>
        <DurationFields
          id="cv-included"
          legend="Included hours"
          hint={CARE_COPY.includedHint}
          optional
          maxHours={2000}
          value={included}
          onChange={setIncluded}
          error={errors.included}
        />
        {failure && <Notice tone="error">{failure}</Notice>}
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Working…" : DOC_COPY.careButton}
        </button>
      </div>
    </form>
  );
}
