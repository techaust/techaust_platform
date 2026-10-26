// The confirmations of a proposal or estimate (M4.3): send (ADM-G-04: the amount and the client, and the honest "until M4.5" line), ask
// the owner to approve, make a new version, discard a draft, and the two conversions of an accepted estimate (an invoice draft, or a
// care plan with its start date and billing day). Each says what happens before it happens; each result links to what was made.
import "../../care.css";
import type { CareFromEstimate, CareTier } from "@techaust/core/care";
import { useState } from "react";
import { Link } from "react-router";
import type { Currency } from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { Modal } from "../../components/dialog.tsx";
import { FormField } from "../../components/form.tsx";
import { Notice } from "../../components/ui.tsx";
import { CARE_COPY, CARE_PENDING, type DurationForm, durationMinutes, TIER_LABELS } from "../../lib/care.ts";
import {
  CARE_HOURS_HINT,
  careAiOps,
  careDone,
  careSummary,
  careTitle,
  DOC_COPY,
  DOC_ERRORS,
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
import { COPY as PROJECT_COPY } from "../../lib/projects.ts";
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
  /** ADM-G-04: the amount and the client, before and after. */
  totalMinor: number | null;
  currency: Currency;
  client: string;
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
        let made: { totalMinor: number };
        try {
          made = await documentsApi.toInvoice(props.id);
        } catch (e) {
          throw mappedError(e);
        }
        props.onDone();
        return (
          <>
            <p className="confirm-figure tnum">
              {sendLine(moneyText(made.totalMinor, props.currency), props.client)}
            </p>
            <p>{PROJECT_COPY.createInvoice}</p>
          </>
        );
      }}
      onClose={props.onClose}
    >
      {props.totalMinor !== null && (
        <p className="confirm-figure tnum">
          {sendLine(moneyText(props.totalMinor, props.currency), props.client)}
        </p>
      )}
    </ConfirmDialog>
  );
}

/** An accepted care-plan estimate becomes a care plan: the tier, price and AI Ops amount come from the estimate, never from here. */
export function CareDialog(props: {
  open: boolean;
  id: string;
  number: string;
  version: number;
  client: string;
  currency: Currency;
  /** What the estimate's lines describe (core's mapping of the server's figures), or null while it loads or when they describe none. */
  care: CareFromEstimate | null;
  onDone: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={props.open} title={careTitle(props.number, props.version)} onClose={props.onClose}>
      {props.open && <CareForm {...props} />}
    </Modal>
  );
}

const tierName = (tier: string) => TIER_LABELS[tier as CareTier] ?? tier;

function CareForm(props: {
  id: string;
  client: string;
  currency: Currency;
  care: CareFromEstimate | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const [startDate, setStartDate] = useState("");
  const [billingDay, setBillingDay] = useState("1");
  const [included, setIncluded] = useState<DurationForm>({ hours: "", minutes: "0" });
  const [errors, setErrors] = useState<Partial<Record<"startDate" | "billingDay" | "included", string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<CareConverted | null>(null);
  const care = props.care;
  // Essential has a default (2 hours); every other tier's hours are agreed per client, so the field is required (07-O §10).
  const hoursRequired = care !== null && care.tier !== "essential";

  if (made) {
    return (
      <>
        <div className="dialog__body">
          <Notice tone="success">{careDone(props.client, tierName(made.tier))}</Notice>
          <p className="confirm-figure confirm-figure--sentence tnum">
            {careSummary(tierName(made.tier), props.client, moneyText(made.priceMinor, made.currency))}
            {made.aiOpsMinor !== null && <>, {careAiOps(moneyText(made.aiOpsMinor, made.currency))}</>}
          </p>
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onClose}>
            Done
          </button>
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
    else if (hoursRequired && minutes === null) e.included = DOC_ERRORS.included_minutes_required;
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
        {care && (
          <p className="confirm-figure confirm-figure--sentence tnum">
            {careSummary(tierName(care.tier), props.client, moneyText(care.priceMinor, props.currency))}
            {care.aiOpsMinor !== null && <>, {careAiOps(moneyText(care.aiOpsMinor, props.currency))}</>}
          </p>
        )}
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
          hint={
            care === null
              ? CARE_COPY.includedHint
              : hoursRequired
                ? CARE_HOURS_HINT.required
                : CARE_HOURS_HINT.essential
          }
          optional={!hoursRequired}
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
