// "Record a payment" (07-ZH line 2; ADM-PAY-05, ADM-PAY-06, ADM-INV-17) and its TDS variant (line 7; ADM-INV-16, T8): the Owner's entry is confirmed at once
// with a fresh code (owner Q2); a Staff member's waits for the Owner's check (line 3) and asks for invoices as a request (L6). The id is picked once per dialog
// (L12: the same entry sent twice is `already_recorded`); a bank reference already seen asks once more before it is recorded again (line 13). A proof is
// uploaded after the entry is recorded (L10, L11), so a failed upload never loses the payment: it can be attached later from the entry.
// Money is parsed and added only through core (lib/payments.ts); the server decides every rule again.
import { uuidv7 } from "@techaust/core/ids";
import type { Role } from "@techaust/core/permissions";
import { decide } from "@techaust/core/permissions";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  type ClientView,
  type Currency,
  type PaymentMode,
  paymentsApi,
  type RecordPaymentAnswer,
  RequestError,
  sha256Hex,
  uploadPaymentDoc,
} from "../../api.ts";
import { DateField, useUnreadDates } from "../../components/date-field.tsx";
import { Modal, useRefusalFocus } from "../../components/dialog.tsx";
import { FormField } from "../../components/form.tsx";
import { Alert, Info, RefreshCw } from "../../components/icons.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { dateError } from "../../lib/date-field.ts";
import { INVT_COPY } from "../../lib/invoice-types.ts";
import { INV_COPY } from "../../lib/invoices.ts";
import { invoicesApi } from "../../lib/invoices-api.ts";
import {
  type AllocRow,
  amountText,
  autoFill,
  earlierMonthLine,
  earlierMonthOf,
  leftoverLine,
  MODE_LABELS,
  MODES,
  type OpenDoc,
  openDocsOf,
  PAY_COPY,
  PAY_ERRORS,
  PAY_UI,
  payErrorText,
  readAllocations,
  todayIst,
} from "../../lib/payments.ts";
import { moneyFrom, percentToBp } from "../../lib/settings-form.ts";
import { withCode } from "../../lib/step-up.ts";
import { AllocationTable, EarlierMonthWarning, FilePick, useCodeSlot } from "./parts.tsx";

/** The client the entry is for (fixed when the dialog opens from an invoice or a client; picked on /payments). */
export type PayClient = { id: string; name: string; currency: Currency };

/** The invoice the dialog was opened from: its row is filled from the amount until edited, and a TDS entry goes on it. */
export type FromDoc = {
  id: string;
  number: string | null;
  type: string;
  balanceMinor: number;
  currency: Currency;
};

const symbolOf = (c: Currency) => (c === "INR" ? "₹" : "$");
const LIST_STATUSES = ["issued", "partially_paid", "partially_credited"] as const;

/** The client's open invoices (issued, partly paid or partly credited, a balance left), read once when the dialog opens. */
async function loadOpen(clientId: string) {
  const pages = await Promise.all(
    LIST_STATUSES.map((status) => invoicesApi.list({ clientId, status, limit: "50" })),
  );
  return pages.flatMap((p) => p.invoices);
}

export function RecordPaymentDialog(props: {
  open: boolean;
  kind: "payment" | "tds";
  role: Role;
  client: PayClient | null;
  from?: FromDoc | undefined;
  onClose: () => void;
  onDone: (answer: RecordPaymentAnswer) => void;
}) {
  return (
    <Modal
      open={props.open}
      title={props.kind === "tds" ? PAY_COPY.tdsHeading : PAY_COPY.recordTitle}
      onClose={props.onClose}
      className="dialog--pay"
    >
      {props.open && <RecordBody {...props} />}
    </Modal>
  );
}

type Errors = Partial<
  Record<
    | "client"
    | "amount"
    | "date"
    | "mode"
    | "reference"
    | "charges"
    | "inr"
    | "proofKind"
    | "file"
    | "section"
    | "rate"
    | "invoice"
    | "certNo"
    | "certOn",
    string
  >
>;

const FIELD_IDS: [keyof Errors, string][] = [
  ["client", "pay-client"],
  ["invoice", "pay-invoice"],
  ["amount", "pay-amount"],
  ["date", "pay-date"],
  ["mode", "pay-mode"],
  ["reference", "pay-ref"],
  ["charges", "pay-charges"],
  ["inr", "pay-inr"],
  ["section", "pay-section"],
  ["rate", "pay-rate"],
  ["certNo", "pay-cert-no"],
  ["certOn", "pay-cert-on"],
  ["file", "pay-file"],
  ["proofKind", "pay-proof-kind"],
];

function RecordBody(props: {
  kind: "payment" | "tds";
  role: Role;
  client: PayClient | null;
  from?: FromDoc | undefined;
  onClose: () => void;
  onDone: (answer: RecordPaymentAnswer) => void;
}) {
  const tds = props.kind === "tds";
  const owner = decide(props.role, "payments.record") === "step-up";
  const today = todayIst();
  const [id] = useState(() => uuidv7());
  const [client, setClient] = useState<PayClient | null>(props.client);
  const currency: Currency = client?.currency ?? "INR";
  const [form, setForm] = useState({
    amount: "",
    date: today,
    mode: "" as PaymentMode | "",
    reference: "",
    charges: "",
    inr: "",
    note: "",
    section: "",
    rate: "",
    certNo: "",
    certOn: "",
    proofKind: "",
    proofRef: "",
    invoice: props.from?.id ?? "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<AllocRow[]>([]);
  // The opened-from invoice's row follows the amount until a person types in it.
  const [autoRow, setAutoRow] = useState(props.from !== undefined);
  const [errors, setErrors] = useState<Errors>({});
  const [allocErrors, setAllocErrors] = useState<Record<string, string>>({});
  const [seen, setSeen] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = useRefusalFocus();
  const dates = useUnreadDates<"date" | "certOn">();
  const code = useCodeSlot("pay-code", owner);
  const toast = useToast();

  const [docs, setDocs] = useState<OpenDoc[] | null>(null);
  // Visual review finding 7: a failed read is its own state (an error with a retry), never "no open invoices", and the entry can't be sent without it.
  const [docsFailed, setDocsFailed] = useState(false);
  const [docsTry, setDocsTry] = useState(0);
  useEffect(() => {
    setDocsFailed(false);
    if (!client) {
      setDocs(null);
      return;
    }
    let live = true;
    setDocs(null);
    void docsTry;
    loadOpen(client.id)
      .then((list) => {
        if (!live) return;
        const open = openDocsOf(list, { kind: props.kind, proformas: !owner });
        // The invoice the dialog came from is always a row, even past the first page of the list.
        const from = props.from;
        if (from && !open.some((d) => d.id === from.id) && from.balanceMinor > 0)
          open.unshift({ ...from, dueDate: null });
        setDocs(open);
      })
      .catch(() => live && setDocsFailed(true));
    return () => {
      live = false;
    };
  }, [client, props.kind, props.from, owner, docsTry]);
  const docsWaiting = client !== null && (docs === null || docsFailed);

  const parsed = useMemo(() => {
    const m = moneyFrom(form.amount, currency);
    return m.ok && m.minor > 0 ? m.minor : null;
  }, [form.amount, currency]);

  // the opened-from row, filled from the amount
  const shownRows: AllocRow[] =
    autoRow && props.from
      ? [
          ...rows.filter((r) => r.documentId !== props.from?.id),
          { documentId: props.from.id, text: autoFill(parsed, props.from.balanceMinor, currency) },
        ]
      : rows;
  const plan = docs ? readAllocations(shownRows, docs, parsed, currency) : null;
  const leftover =
    docs && plan?.ok && client ? leftoverLine(plan.leftMinor, parsed, docs, currency, client.name) : null;
  // Line 10's warning before the submit (visual review finding 6): the money arrived in a month before an invoice it goes on was issued.
  const month =
    docs && form.date
      ? earlierMonthOf(
          form.date,
          tds
            ? [docs.find((d) => d.id === form.invoice)?.issueDate]
            : plan?.ok
              ? plan.allocations.map((a) => docs.find((d) => d.id === a.documentId)?.issueDate)
              : [],
        )
      : null;

  /** Visual review finding 8: another client's rows and TDS invoice never follow a change of client. */
  function pickClient(c: PayClient | null) {
    if (c?.id === client?.id) return;
    setClient(c);
    setRows([]);
    setAllocErrors({});
    setForm((f) => ({ ...f, invoice: props.from?.id ?? "" }));
  }

  function setRow(documentId: string, text: string) {
    if (documentId === props.from?.id && autoRow) {
      setAutoRow(false);
      setRows([...rows.filter((r) => r.documentId !== documentId), { documentId, text }]);
      return;
    }
    setRows([...rows.filter((r) => r.documentId !== documentId), { documentId, text }]);
  }

  function check(): { ok: false } | { ok: true; body: Parameters<typeof paymentsApi.record>[0] } {
    const e: Errors = {};
    if (!client) e.client = PAY_UI.pickClientMissing;
    const amount = moneyFrom(form.amount, currency);
    if (!amount.ok) e.amount = amount.error;
    else if (amount.minor <= 0) e.amount = INVT_COPY.amountZero;
    const dErr = dateError(dates.unread.date) ?? (form.date ? undefined : INVT_COPY.dateReceivedMissing);
    if (dErr) e.date = dErr;
    else if (form.date > today) e.date = PAY_ERRORS.received_on_future;
    let allocations: { documentId: string; amountMinor: number }[] = [];
    let charges = 0;
    let inr: number | undefined;
    let rateBp = 0;
    if (tds) {
      if (!form.invoice) e.invoice = PAY_UI.tdsInvoiceMissing;
      if (form.section.trim() === "") e.section = PAY_UI.tdsSectionMissing;
      const bp = percentToBp(form.rate);
      if (bp === null || bp < 1) e.rate = PAY_UI.tdsRateInvalid;
      else rateBp = bp;
      const certErr = dateError(dates.unread.certOn);
      if (certErr) e.certOn = certErr;
      else if ((form.certNo.trim() === "") !== (form.certOn === "")) e.certNo = PAY_UI.certificateBoth;
      if (amount.ok && form.invoice) allocations = [{ documentId: form.invoice, amountMinor: amount.minor }];
    } else {
      if (!form.mode) e.mode = PAY_UI.modeMissing;
      if (form.reference.trim() === "") e.reference = INVT_COPY.referenceMissing;
      if (form.charges.trim() !== "") {
        const c = moneyFrom(form.charges, currency);
        if (!c.ok) e.charges = c.error;
        else charges = c.minor;
      }
      if (currency === "USD" && form.inr.trim() !== "") {
        const c = moneyFrom(form.inr, "INR");
        if (!c.ok) e.inr = c.error;
        else if (c.minor > 0) inr = c.minor;
      }
      if (file && form.proofKind.trim() === "") e.proofKind = PAY_UI.proofKindMissing;
      if (plan && !plan.ok) setAllocErrors(plan.errors);
      else {
        setAllocErrors({});
        if (plan?.ok) {
          allocations = plan.allocations;
          if (plan.over) e.amount = PAY_ERRORS.exceeds_payment;
        }
      }
    }
    setErrors(e);
    const first = FIELD_IDS.find(([k]) => e[k])?.[1];
    if (first) {
      requestAnimationFrame(() => {
        const el = document.getElementById(first);
        el?.focus({ preventScroll: true });
        el?.closest(".field")?.scrollIntoView({ block: "nearest" });
      });
      return { ok: false };
    }
    if (plan && !plan.ok && !tds) {
      const firstRow = Object.keys(plan.errors)[0];
      if (firstRow) document.getElementById(`pay-alloc-${firstRow}`)?.focus();
      return { ok: false };
    }
    if (!client || !amount.ok) return { ok: false };
    return {
      ok: true,
      body: {
        id,
        clientId: client.id,
        kind: props.kind,
        currency,
        amountMinor: amount.minor,
        receivedOn: form.date,
        ...(tds
          ? {
              tds: {
                section: form.section.trim(),
                rateBp,
                ...(form.certNo.trim()
                  ? { certificateNo: form.certNo.trim(), certificateOn: form.certOn }
                  : {}),
              },
            }
          : {
              mode: form.mode as PaymentMode,
              reference: form.reference.trim(),
              ...(charges > 0 ? { chargesMinor: charges } : {}),
              ...(inr !== undefined ? { inrReceivedMinor: inr } : {}),
            }),
        ...(allocations.length > 0 ? { allocations } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      },
    };
  }

  async function submit() {
    if (docsWaiting) return;
    const c = check();
    if (!c.ok) return;
    if (!code.ready()) return;
    setBusy(true);
    setFailure(null);
    try {
      const answer = await withCode(code.code, () =>
        paymentsApi.record({ ...c.body, ...(seen ? { confirmDuplicate: true } : {}) }),
      );
      let proofFailed: string | null = null;
      if (file && !tds) {
        try {
          const sha = await sha256Hex(file);
          await uploadPaymentDoc(
            {
              proofOf: answer.id,
              kind: form.proofKind.trim(),
              ...(form.proofRef.trim() ? { ref: form.proofRef.trim() } : {}),
            },
            file,
            sha,
            () => {},
          );
        } catch (e) {
          proofFailed = payErrorText(e);
        }
      }
      const said = tds
        ? PAY_UI.tdsRecorded
        : answer.status === "confirmed"
          ? PAY_UI.recordedConfirmed
          : PAY_UI.recordedPending;
      const warning = answer.warnings[0];
      toast(
        proofFailed ? "error" : "success",
        [said, warning ? earlierMonthLine(warning.month) : "", proofFailed ?? ""].filter(Boolean).join(" "),
      );
      props.onDone(answer);
    } catch (e) {
      if (code.refused(e)) return;
      if (e instanceof RequestError && e.code === "reference_seen") {
        setSeen(payErrorText(e));
        refusal.show();
        return;
      }
      // A refusal that names one invoice (`details.documentId`: over its balance, a proforma that must take the whole payment) is that row's error.
      const rowId = e instanceof RequestError ? e.extra.details?.documentId : undefined;
      if (typeof rowId === "string" && docs?.some((d) => d.id === rowId)) {
        setAllocErrors({ [rowId]: payErrorText(e) });
        requestAnimationFrame(() => document.getElementById(`pay-alloc-${rowId}`)?.focus());
        return;
      }
      setFailure(payErrorText(e));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }

  const tdsDocs = docs ?? [];
  const sym = symbolOf(currency);
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="dialog__body pay-form">
        {tds && <p className="pay-form__lede">{PAY_COPY.tdsHint}</p>}
        <p className="hint form-intro">All fields are needed unless marked optional.</p>
        {!props.client && <ClientPick value={client} onPick={pickClient} error={errors.client} />}
        {tds && (
          <FormField
            id="pay-invoice"
            label={PAY_UI.allocInvoice}
            hint={PAY_UI.tdsInvoiceHint}
            error={errors.invoice}
          >
            {(a) =>
              props.from ? (
                <input {...a} readOnly value={props.from.number ?? ""} className="pay-form__fixed docno" />
              ) : (
                <select
                  {...a}
                  value={form.invoice}
                  disabled={docs === null}
                  onChange={(e) => setForm({ ...form, invoice: e.target.value })}
                >
                  <option value="">{docs === null && !docsFailed && client ? "Loading…" : ""}</option>
                  {tdsDocs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {`${d.number ?? ""} · ${INV_COPY.colBalance} ${amountText(d.balanceMinor, d.currency)}`}
                    </option>
                  ))}
                </select>
              )
            }
          </FormField>
        )}
        {tds && (
          <div className="form-grid">
            <FormField id="pay-section" label={PAY_COPY.tdsSection} error={errors.section}>
              {(a) => (
                <input
                  {...a}
                  maxLength={40}
                  autoComplete="off"
                  value={form.section}
                  onChange={(e) => setForm({ ...form, section: e.target.value })}
                />
              )}
            </FormField>
            <FormField id="pay-rate" label={PAY_COPY.tdsRate} error={errors.rate}>
              {(a) => (
                <input
                  {...a}
                  inputMode="decimal"
                  autoComplete="off"
                  className="pay-form__rate"
                  value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: e.target.value })}
                />
              )}
            </FormField>
          </div>
        )}
        <div className="form-grid">
          <FormField id="pay-amount" label={tds ? PAY_COPY.tdsAmount : PAY_COPY.amount} error={errors.amount}>
            {(a) => (
              <div className="money-in">
                <span aria-hidden="true">{sym}</span>
                <input
                  {...a}
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
            )}
          </FormField>
          <FormField id="pay-date" label={PAY_COPY.dateReceived} error={errors.date}>
            {(a) => (
              <DateField
                {...a}
                {...dates.bind("date")}
                value={form.date}
                max={today}
                onChange={(date) => setForm({ ...form, date })}
              />
            )}
          </FormField>
        </div>
        {!tds && (
          <>
            <div className="form-grid">
              <FormField id="pay-mode" label={PAY_COPY.mode} error={errors.mode}>
                {(a) => (
                  <select
                    {...a}
                    value={form.mode}
                    onChange={(e) => setForm({ ...form, mode: e.target.value as PaymentMode | "" })}
                  >
                    <option value="" />
                    {MODES.map((m) => (
                      <option key={m} value={m}>
                        {MODE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField id="pay-ref" label={PAY_COPY.reference} error={errors.reference}>
                {(a) => (
                  <input
                    {...a}
                    maxLength={80}
                    autoComplete="off"
                    spellCheck={false}
                    className="docno"
                    value={form.reference}
                    onChange={(e) => {
                      setForm({ ...form, reference: e.target.value });
                      setSeen(null);
                    }}
                  />
                )}
              </FormField>
            </div>
            <div className="form-grid">
              <FormField id="pay-charges" label={PAY_COPY.charges} optional error={errors.charges}>
                {(a) => (
                  <div className="money-in">
                    <span aria-hidden="true">{sym}</span>
                    <input
                      {...a}
                      inputMode="decimal"
                      autoComplete="off"
                      value={form.charges}
                      onChange={(e) => setForm({ ...form, charges: e.target.value })}
                    />
                  </div>
                )}
              </FormField>
              {currency === "USD" && (
                <FormField id="pay-inr" label={PAY_UI.inrReceived} optional error={errors.inr}>
                  {(a) => (
                    <div className="money-in">
                      <span aria-hidden="true">₹</span>
                      <input
                        {...a}
                        inputMode="decimal"
                        autoComplete="off"
                        value={form.inr}
                        onChange={(e) => setForm({ ...form, inr: e.target.value })}
                      />
                    </div>
                  )}
                </FormField>
              )}
            </div>
            {client && (
              <fieldset className="form-section pay-alloc">
                <legend>{PAY_UI.allocHeading}</legend>
                {docsFailed ? (
                  <DocsFailed onRetry={() => setDocsTry((n) => n + 1)} />
                ) : (
                  <>
                    {docs !== null && docs.length > 0 && <p className="hint">{PAY_UI.allocHint}</p>}
                    <AllocationTable
                      docs={docs ?? []}
                      rows={shownRows}
                      onRow={setRow}
                      errors={allocErrors}
                      idPrefix="pay-alloc"
                      symbol={sym}
                      loading={docs === null}
                    />
                  </>
                )}
                {leftover && (
                  <p className="pay-line" role="status" data-kind={leftover.kind}>
                    <Info size={16} />
                    <span>{leftover.text}</span>
                  </p>
                )}
              </fieldset>
            )}
            <EarlierMonthWarning month={month} />
            <div className="pay-proof">
              <FilePick
                id="pay-file"
                label={PAY_COPY.proof}
                optional
                {...(currency === "USD"
                  ? { hint: `${PAY_COPY.exportProofHint} ${PAY_UI.proofFileHint}` }
                  : {})}
                file={file}
                onFile={setFile}
                error={errors.file}
              />
              {file && (
                <div className="form-grid">
                  <FormField
                    id="pay-proof-kind"
                    label={PAY_COPY.proofKind}
                    hint={PAY_COPY.proofKindHint}
                    error={errors.proofKind}
                  >
                    {(a) => (
                      <input
                        {...a}
                        maxLength={60}
                        autoComplete="off"
                        value={form.proofKind}
                        onChange={(e) => setForm({ ...form, proofKind: e.target.value })}
                      />
                    )}
                  </FormField>
                  <FormField id="pay-proof-ref" label={PAY_COPY.proofRef} optional>
                    {(a) => (
                      <input
                        {...a}
                        maxLength={80}
                        autoComplete="off"
                        spellCheck={false}
                        value={form.proofRef}
                        onChange={(e) => setForm({ ...form, proofRef: e.target.value })}
                      />
                    )}
                  </FormField>
                </div>
              )}
            </div>
          </>
        )}
        {tds && (
          <div className="form-grid">
            <FormField id="pay-cert-no" label={PAY_COPY.tdsCertificate} optional error={errors.certNo}>
              {(a) => (
                <input
                  {...a}
                  maxLength={40}
                  autoComplete="off"
                  spellCheck={false}
                  value={form.certNo}
                  onChange={(e) => setForm({ ...form, certNo: e.target.value })}
                />
              )}
            </FormField>
            <FormField id="pay-cert-on" label={PAY_UI.certificateOn} optional error={errors.certOn}>
              {(a) => (
                <DateField
                  {...a}
                  {...dates.bind("certOn")}
                  value={form.certOn}
                  max={today}
                  onChange={(certOn) => setForm({ ...form, certOn })}
                />
              )}
            </FormField>
          </div>
        )}
        <FormField id="pay-note" label={PAY_COPY.note} optional>
          {(a) => (
            <textarea
              {...a}
              rows={2}
              maxLength={500}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          )}
        </FormField>
        {tds && client && docsFailed && <DocsFailed onRetry={() => setDocsTry((n) => n + 1)} />}
        {tds && <EarlierMonthWarning month={month} />}
        {!owner && (
          <p className="approval-line" data-state="pending">
            <Alert size={16} />
            <span>{PAY_COPY.staffNotice}</span>
          </p>
        )}
        {seen && (
          <div className="pay-seen" role="alert" tabIndex={-1} ref={refusal.ref}>
            <Alert size={20} />
            <p>{seen}</p>
          </div>
        )}
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
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy || docsWaiting}
          aria-busy={busy || (client !== null && docs === null && !docsFailed) || undefined}
        >
          {busy ? "Working…" : seen ? PAY_UI.recordAgain : tds ? PAY_UI.recordTds : PAY_COPY.recordTitle}
        </button>
      </div>
    </form>
  );
}

/** The open invoices didn't load: the shared words of a failed read (states.tsx, panel.tsx) and a retry, in place of the table. */
function DocsFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="pay-alloc__failed">
      <p className="panel-empty" role="alert">
        <RefreshCw size={20} />
        <span>This didn't load. Try again in a moment.</span>
      </p>
      <button type="button" className="btn btn--secondary" onClick={onRetry}>
        <RefreshCw size={20} />
        Try again
      </button>
    </div>
  );
}

/** The client picker of /payments: a search over the client list (the first 50 matches), one select; each on its own row, so a name and code read in full. */
function ClientPick(props: {
  value: PayClient | null;
  onPick: (c: PayClient | null) => void;
  error?: string | undefined;
}) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<ClientView[] | null>(null);
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      api
        .clients({ limit: "50", ...(q.trim() ? { q: q.trim() } : {}) })
        .then((r) => live && setList(r.clients))
        .catch(() => live && setList([]));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [q]);
  return (
    <div className="pay-client">
      <FormField id="pay-client-q" label={PAY_UI.searchClients} optional>
        {(a) => (
          <input {...a} type="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
        )}
      </FormField>
      <FormField id="pay-client" label={PAY_UI.pickClient} error={props.error}>
        {(a) => (
          <select
            {...a}
            value={props.value?.id ?? ""}
            onChange={(e) => {
              const c = list?.find((x) => x.id === e.target.value);
              props.onPick(c ? { id: c.id, name: c.displayName, currency: c.currency } : null);
            }}
          >
            <option value="">{list === null ? "Loading…" : ""}</option>
            {(list ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {`${c.displayName} (${c.code})`}
              </option>
            ))}
          </select>
        )}
      </FormField>
    </div>
  );
}
