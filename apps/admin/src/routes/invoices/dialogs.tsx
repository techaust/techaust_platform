// The invoice dialogs (M5.1, ADM-INV-03, -04, -07, ADM-APR-01, ADM-G-04 ConfirmDialog): issue (the owner, with the series preview, what still
// stops it and a fresh code), request issue (Staff), void and withdraw (the owner, a required reason and a fresh code) and delete a draft. Each says what will
// happen before the one button that does it; a refusal is said in 07-R's words and the dialog stays open. The number is never shown as if it
// were known: the preview draws the series and an empty slot, because the number is taken only inside the issue batch.
import { INVOICE_SERIES_OF, isInvoiceFlowType } from "@techaust/core/invoices";
import { useState } from "react";
import { Link } from "react-router";
import { stepUpActive } from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { Modal } from "../../components/dialog.tsx";
import { KeepDates } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import { Alert } from "../../components/icons.tsx";
import { CodeField, Notice } from "../../components/ui.tsx";
import { WITHDRAW_COPY } from "../../lib/copy-zf.ts";
import { INVT_COPY } from "../../lib/invoice-types.ts";
import {
  blockerLine,
  blockerTarget,
  INV_COPY,
  INV_ERRORS,
  invErrorText,
  invMapped,
  issueBody,
  issueLabelFor,
  seriesPreview,
  shownBlockers,
  splitAtPlace,
  voidErrorText,
  voidRefusalStalesPage,
  voidTitle,
  withdrawErrorText,
} from "../../lib/invoices.ts";
import type { InvoiceBlocker, InvoiceView } from "../../lib/invoices-api.ts";
import { withCode } from "../../lib/step-up.ts";

const CODE_MISSING = "Enter the 6-digit code from your authenticator app.";

/** What still stops an issue, one line each, with a link to where it is fixed (07-R §2 "Blockers"). */
export function BlockerList(props: {
  blockers: InvoiceBlocker[];
  clientId: string;
  currency: string;
  /** A line's blocker: put the cursor where that line is fixed (the editor maps the position to the line; `field` says which part). */
  onLine?: ((n: number, field: "description" | "sac") => void) | undefined;
  /** A blocker about the lines as a whole. */
  onLines?: (() => void) | undefined;
  /** M5.2: a blocker about the exchange rate (the editor opens its dialog). */
  onFx?: (() => void) | undefined;
  /** M5.2: the oldest a rate's date may be, in days (Settings › Tax), for its blocker's sentence. */
  maxAgeDays?: number | undefined;
}) {
  const shown = shownBlockers(props.blockers);
  if (shown.length === 0) return null;
  return (
    <ul className="blockers inv-blockers">
      {shown.map((b, i) => {
        const line = blockerLine(b, props.currency, { maxAgeDays: props.maxAgeDays });
        const t = blockerTarget(b, props.clientId);
        let body: React.ReactNode = line;
        if (t?.kind === "page") {
          const parts = splitAtPlace(line, t.place);
          body = parts ? (
            <>
              {parts[0]}
              <Link className="blockers__link inv-blockers__place" to={t.to}>
                {parts[1]}
              </Link>
              {parts[2]}
            </>
          ) : (
            <Link className="blockers__link" to={t.to}>
              {line}
            </Link>
          );
        } else if (t?.kind === "line" && props.onLine) {
          const { n, field } = t;
          const onLine = props.onLine;
          body = (
            <button
              type="button"
              className="blockers__link inv-blockers__jump"
              onClick={() => onLine(n, field)}
            >
              {line}
            </button>
          );
        } else if (t?.kind === "lines" && props.onLines) {
          const onLines = props.onLines;
          body = (
            <button type="button" className="blockers__link inv-blockers__jump" onClick={onLines}>
              {line}
            </button>
          );
        } else if (t?.kind === "fx" && props.onFx) {
          const onFx = props.onFx;
          body = (
            <button type="button" className="blockers__link inv-blockers__jump" onClick={onFx}>
              {line}
            </button>
          );
        }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a code can repeat for different lines; the list is redrawn whole
          <li key={`${b.code}-${b.line ?? ""}-${i}`} className="blockers__item">
            <Alert size={16} />
            <span>{body}</span>
          </li>
        );
      })}
    </ul>
  );
}

type Preview = InvoiceView["issue"]["preview"];

/**
 * The series a draft of this type is numbered in: the view's own preview (review 2: `issue.preview` is the type's series). A view whose preview is
 * another type's series (an older API) shows no series rather than the wrong one.
 */
function usePreview(v: InvoiceView): Preview | null {
  const series = isInvoiceFlowType(v.type) ? INVOICE_SERIES_OF[v.type] : null;
  return series === v.issue.preview.series ? v.issue.preview : null;
}

/** The series with the slot its number takes at issue: "TH/INV/2627/" then an empty box. Decoration for the sentence that says it. */
function SeriesSlot({ preview }: { preview: Preview }) {
  const p = seriesPreview(preview);
  return (
    <p className="inv-series" aria-hidden="true">
      <span className="docno">{p.before}</span>
      <span className="inv-slot inv-slot--lead" />
      {p.after && <span className="docno">{p.after}</span>}
    </p>
  );
}

/**
 * Issue (the owner, 07-R §3): the next number in the series and today's date, final once done. The draft is saved first (and saved once more when
 * its figures are out of date: a converted or "Start project" draft has no stored hash yet), then issued with the version and the content the
 * owner saw. A fresh code is asked for here when the step-up has lapsed.
 */
export function IssueDialog(props: {
  open: boolean;
  view: InvoiceView;
  issueDate: string;
  onClose: () => void;
  /** Saves what was typed (and the out-of-date figures); resolves with the view to issue, or null when it couldn't. */
  prepare: () => Promise<InvoiceView | null>;
  /** `inrConfirmed`: the Owner answered the dialog's INR question with "Issue in INR" (Q8); false when it was not asked. */
  issue: (v: InvoiceView, inrConfirmed: boolean) => Promise<void>;
  onLine: (n: number, field: "description" | "sac") => void;
  onLines: () => void;
  /** M5.2: a rate blocker closes the dialog and opens the rate's. */
  onFx?: (() => void) | undefined;
}) {
  const v = props.view;
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Q8 (07-S §4): an export invoice in INR asks once more before it is issued; the second press is "Issue in INR".
  const [inrAsked, setInrAsked] = useState(false);
  const needsCode = !stepUpActive();
  const blocked = v.blockers.length > 0 || !v.typeIssuable;
  const preview = usePreview(v);
  const p = preview ? seriesPreview(preview) : null;
  const inrStep = v.needsInrConfirm === true && !blocked;

  function close() {
    setCode("");
    setCodeError(null);
    setError(null);
    setInrAsked(false);
    props.onClose();
  }

  async function confirm() {
    if (needsCode && code.length !== 6) {
      setCodeError(CODE_MISSING);
      document.getElementById("issue-code")?.focus();
      return;
    }
    if (inrStep && !inrAsked) {
      setCodeError(null);
      setInrAsked(true);
      return;
    }
    setCodeError(null);
    setError(null);
    setBusy(true);
    try {
      const ready = await props.prepare();
      if (!ready) return;
      if (ready.blockers.length > 0) return; // the dialog now lists them
      // The saved draft turned out to need the INR question the dialog hasn't asked yet: ask it now, issue on the next press.
      if (ready.needsInrConfirm === true && !inrAsked) {
        setInrAsked(true);
        return;
      }
      await withCode(needsCode ? code : undefined, () => props.issue(ready, inrAsked));
      setCode("");
    } catch (e) {
      setError(invErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  const leave = (go: () => void) => () => {
    close();
    requestAnimationFrame(go);
  };

  return (
    <Modal open={props.open} title={issueLabelFor(v.type)} onClose={close} busy={busy}>
      <div className="dialog__body inv-issue">
        {preview && p ? (
          <>
            <SeriesSlot preview={preview} />
            <p>
              {/* A proforma is not a tax invoice and is corrected by a void, so 07-R's credit-note sentence is not its own (07-S §8). */}
              {v.type === "proforma" ? (
                INVT_COPY.proformaIssueStatement
              ) : (
                <KeepDates text={issueBody(p.text, p.example, props.issueDate)} />
              )}
            </p>
          </>
        ) : (
          <p className="inv-series inv-series--loading" aria-hidden="true">
            <span className="inv-slot inv-slot--lead" />
          </p>
        )}
        {blocked && v.blockers.length > 0 && (
          <div className="inv-issue__blocked">
            <p className="inv-issue__fix">{INV_COPY.fixFirst}</p>
            <BlockerList
              blockers={v.blockers}
              clientId={v.client.id}
              currency={v.client.currency}
              maxAgeDays={v.fx?.maxAgeDays}
              onLine={(n, field) => leave(() => props.onLine(n, field))()}
              onLines={leave(props.onLines)}
              onFx={props.onFx ? leave(props.onFx) : undefined}
            />
          </div>
        )}
        {!v.typeIssuable && v.blockers.length === 0 && (
          <Notice tone="info">{INV_ERRORS.type_not_issuable}</Notice>
        )}
        {inrAsked && !blocked && (
          <div className="inv-inr-ask" role="status">
            <p>{INVT_COPY.inrConfirm}</p>
          </div>
        )}
      </div>
      {needsCode && !blocked && (
        <CodeField
          id="issue-code"
          label="Authenticator code"
          hint="Enter the 6-digit code from your authenticator app to continue."
          value={code}
          onChange={setCode}
          error={codeError}
        />
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={close} disabled={busy}>
          {INV_COPY.cancel}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={confirm}
          disabled={busy || blocked}
          aria-busy={busy || undefined}
        >
          {busy ? "Working…" : inrAsked ? INVT_COPY.issueInInr : issueLabelFor(v.type)}
        </button>
      </div>
    </Modal>
  );
}

/** Request issue (Staff, 07-R §3): the owner gets a request; a change to the draft afterwards cancels it. */
export function RequestIssueDialog(props: {
  open: boolean;
  view: InvoiceView;
  onClose: () => void;
  onSend: () => Promise<void>;
  onLine: (n: number, field: "description" | "sac") => void;
  onLines: () => void;
}) {
  const v = props.view;
  const blocked = v.blockers.length > 0;
  return (
    <ConfirmDialog
      open={props.open}
      title={INV_COPY.requestTitle}
      confirmLabel={INV_COPY.sendRequest}
      cancelLabel={INV_COPY.cancel}
      onClose={props.onClose}
      disabled={blocked}
      onConfirm={async () => {
        try {
          await props.onSend();
        } catch (e) {
          throw invMapped(e);
        }
        return undefined;
      }}
    >
      <p>{INV_COPY.requestBody}</p>
      {blocked && (
        <div className="inv-issue__blocked">
          <p className="inv-issue__fix">{INV_COPY.fixFirst}</p>
          <BlockerList
            blockers={v.blockers}
            clientId={v.client.id}
            currency={v.client.currency}
            maxAgeDays={v.fx?.maxAgeDays}
            onLine={(n, field) => {
              props.onClose();
              requestAnimationFrame(() => props.onLine(n, field));
            }}
            onLines={() => {
              props.onClose();
              requestAnimationFrame(props.onLines);
            }}
          />
        </div>
      )}
    </ConfirmDialog>
  );
}

/** What a reason-and-code dialog says (the void's 07-R §4 and 07-ZA words, or the withdrawal's 07-ZF ones). */
type ReasonDialogWords = {
  title: string;
  body: string;
  reasonLabel: string;
  reasonEmpty: string;
  confirm: string;
};

/**
 * The owner's take-back dialogs (void, M5.1; withdraw, ADM-INV-10): what happens, a required reason kept with the document, a fresh code when the
 * step-up has lapsed, and the one danger button. A refusal is said under the fields and the dialog stays open; a refusal that made the page behind it
 * stale (any 409) reloads the page once the dialog closes.
 */
function ReasonCodeDialog(props: {
  open: boolean;
  /** The fields' ids: `{idBase}-reason` and `{idBase}-code`. */
  idBase: string;
  words: ReasonDialogWords;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  errorText: (e: unknown) => string;
  onStale?: (() => void) | undefined;
}) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const needsCode = !stepUpActive();
  const { words, idBase } = props;
  const reasonId = `${idBase}-reason`;
  const codeId = `${idBase}-code`;

  function close() {
    setReason("");
    setReasonError(null);
    setCode("");
    setCodeError(null);
    setError(null);
    setStale(false);
    props.onClose();
    if (stale) props.onStale?.();
  }

  async function confirm() {
    const r = reason.trim();
    const noReason = r === "";
    const noCode = needsCode && code.length !== 6;
    setReasonError(noReason ? words.reasonEmpty : null);
    setCodeError(noCode ? CODE_MISSING : null);
    if (noReason || noCode) {
      document.getElementById(noReason ? reasonId : codeId)?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await withCode(needsCode ? code : undefined, () => props.onConfirm(r));
      setReason("");
      setCode("");
    } catch (e) {
      setError(props.errorText(e));
      if (voidRefusalStalesPage(e)) setStale(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={props.open} title={words.title} onClose={close} busy={busy} tone="danger">
      <div className="dialog__body">
        <p>{words.body}</p>
        <FormField id={reasonId} label={words.reasonLabel} error={reasonError}>
          {(a) => (
            <textarea
              {...a}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError && e.target.value.trim()) setReasonError(null);
              }}
            />
          )}
        </FormField>
      </div>
      {needsCode && (
        <CodeField
          id={codeId}
          label="Authenticator code"
          hint="Enter the 6-digit code from your authenticator app to continue."
          value={code}
          onChange={setCode}
          error={codeError}
        />
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={close} disabled={busy}>
          {INV_COPY.cancel}
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={confirm}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? "Working…" : words.confirm}
        </button>
      </div>
    </Modal>
  );
}

/** Void (the owner, 07-R §4): it keeps its number, the reason is required and kept, a fresh code confirms it. */
export function VoidDialog(props: {
  open: boolean;
  number: string;
  /** The document's type: a refusal names it (a proforma never gets the invoice's credit-note advice, FX-5). */
  type?: string | undefined;
  onClose: () => void;
  onVoid: (reason: string) => Promise<void>;
  /** Called after `onClose` when a refusal made the page's data stale (a portal view landed meanwhile: FX-5 review L2), so the page reloads. */
  onStale?: () => void;
}) {
  const proforma = props.type === "proforma";
  return (
    <ReasonCodeDialog
      open={props.open}
      idBase="void"
      words={{
        title: voidTitle(props.number, props.type),
        body: proforma ? INV_COPY.voidProformaBody : INV_COPY.voidBody,
        reasonLabel: proforma ? INV_COPY.voidProformaReason : INV_COPY.voidReason,
        reasonEmpty: INV_COPY.voidReasonEmpty,
        confirm: proforma ? INV_COPY.voidProformaConfirm : INV_COPY.voidConfirm,
      }}
      onClose={props.onClose}
      onConfirm={props.onVoid}
      errorText={(e) => voidErrorText(e, props.type)}
      onStale={props.onStale}
    />
  );
}

/**
 * Withdraw (the owner, ADM-INV-10; 07-ZF 2 to 5): a proforma the client has received is taken back instead of voided. It keeps its number and stays in
 * the records; the reason is required and kept (07-ZA line 18's label); a fresh code confirms it. A refusal says 07-ZF's line (10 to 14) and reloads the
 * page once the dialog closes, as the void's does.
 */
export function WithdrawDialog(props: {
  open: boolean;
  number: string;
  onClose: () => void;
  onWithdraw: (reason: string) => Promise<void>;
  onStale?: () => void;
}) {
  return (
    <ReasonCodeDialog
      open={props.open}
      idBase="withdraw"
      words={{
        title: WITHDRAW_COPY.title(props.number),
        body: WITHDRAW_COPY.body,
        reasonLabel: WITHDRAW_COPY.reasonLabel,
        reasonEmpty: WITHDRAW_COPY.reasonEmpty,
        confirm: WITHDRAW_COPY.confirm,
      }}
      onClose={props.onClose}
      onConfirm={props.onWithdraw}
      errorText={withdrawErrorText}
      onStale={props.onStale}
    />
  );
}

/** "Delete this draft? It has no number yet, so nothing is lost from the series." (07-R §2): the question as the title, the reason beneath. */
const DELETE_Q = ((t: string) => {
  const i = t.indexOf("? ");
  return [t.slice(0, i + 1), t.slice(i + 2)] as const;
})(INV_COPY.deleteBody);

export function DeleteDraftDialog(props: {
  open: boolean;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  return (
    <ConfirmDialog
      open={props.open}
      title={DELETE_Q[0]}
      tone="danger"
      confirmLabel={INV_COPY.deleteDraft}
      cancelLabel={INV_COPY.keepIt}
      onClose={props.onClose}
      onConfirm={async () => {
        try {
          await props.onDelete();
        } catch (e) {
          throw invMapped(e);
        }
        return undefined;
      }}
    >
      <p>{DELETE_Q[1]}</p>
    </ConfirmDialog>
  );
}
