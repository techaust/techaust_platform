// The M5.2 parts of the invoice screens (ADM-INV-01, -06, -08, -10, -18): the export invoice's facts (its route, the statutory endorsement, the LUT, the
// country, the extra export note), the exchange rate and its dialog, the service completion date, a proforma's money (what came in, what is left, the
// tax invoices issued from it) with the Owner's "Issue tax invoice for payment received", and the line that says which proforma a paid invoice settles.
// Words: 07-S (lib/invoice-types.ts). Money only through core; the screen sends what was typed and the server decides.
// Step 5 (research and wording): a rate dated before the document's day asks whether no rate was published that day (S §8, `noRateThatDay`); a payment
// whose year has no LUT offers "Save the LUT first" or "Issue with IGST" (S §9, Q37; Researched 2026-10-28, 08-C RA-19, RA-21).
//
// One thing is drawn: the STATUTORY LINE. The endorsement of an export invoice and the notice of a proforma are printed on the PDF in a band (an ink bar,
// the words in semibold, word for word as frozen); the screens show the same band in the same words, so what the Owner reads here is what the client
// will read. Everything else stays in the existing panels, facts and dialogs.
import { issueDateOf } from "@techaust/core/invoices";
import { TERMS_BLOCKS } from "@techaust/core/terms";
import { useState } from "react";
import { Link } from "react-router";
import { RequestError, stepUpActive } from "../../api.ts";
import { DateField, useUnreadDates } from "../../components/date-field.tsx";
import { Modal } from "../../components/dialog.tsx";
import { FormField, Switch } from "../../components/form.tsx";
import { Alert, Check, Pencil, Receipt } from "../../components/icons.tsx";
import { useToast } from "../../components/toast.tsx";
import { CodeField, Notice } from "../../components/ui.tsx";
import { dateError } from "../../lib/date-field.ts";
import {
  type AdvanceErrors,
  advanceFocus,
  advanceLine,
  amount,
  arrivedEarlierMonth,
  checkAdvance,
  checkFx,
  childLine,
  day,
  FX_SOURCE_LABELS,
  type FxForm,
  type FxValue,
  fxBody,
  fxFormOf,
  fxLine,
  fyLabel,
  INVT_COPY,
  lutLine,
  rateDateFollows,
  rateDayEarlier,
  splitAdvanceRefusal,
  warn25Line,
} from "../../lib/invoice-types.ts";
import { blockerLine, INV_COPY, invErrorText, issuedToast, typeLabel } from "../../lib/invoices.ts";
import { type InvoiceBlocker, type InvoiceView, invoicesApi } from "../../lib/invoices-api.ts";
import { withCode } from "../../lib/step-up.ts";
import { BlockerList } from "./dialogs.tsx";
import { invoiceHref } from "./parts.tsx";

const CODE_MISSING = "Enter the 6-digit code from your authenticator app.";
const todayIso = () => issueDateOf(Date.now());

/** Focus a field once its error is drawn, and bring the whole field (the error under it too) clear of the dialog's sticky actions. */
const focusField = (id: string) =>
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    el?.focus({ preventScroll: true });
    el?.closest(".field")?.scrollIntoView({ block: "nearest" });
  });

/** The export routes on a draft (07-S §8). */
const ROUTE_LABELS = { lut: INVT_COPY.routeLut, igst_paid: INVT_COPY.routeIgst } as const;

/** The statutory line in its band (07-S §1, §2): the words exactly as they print, with the LUT line or the extra note under them. */
export function StatutoryBand(props: { line: string; sub?: string | null; note?: string | null }) {
  return (
    <div className="inv-band">
      <p className="inv-band__line">{props.line}</p>
      {props.sub && <p className="inv-band__sub">{props.sub}</p>}
      {props.note && <p className="inv-band__note">{props.note}</p>}
    </div>
  );
}

// ---- the export invoice (editor) -------------------------------------------------------------------------------------------------------------------

/**
 * An export draft (or a proforma for an overseas client): the route, the endorsement it will carry, the LUT of the year it would be issued in, the country
 * of destination, and the extra export note. A change saves at once (the editor's `saveFields`).
 */
export function ExportPanel(props: {
  view: InvoiceView;
  canWrite: boolean;
  busy: boolean;
  saveFields: (fields: { exportMode?: "lut" | "igst_paid"; exportDeclaration?: boolean }) => Promise<void>;
}) {
  const x = props.view.export;
  if (!x) return null;
  const isExport = props.view.type === "export_invoice";
  const noteLabel = TERMS_BLOCKS.export_declaration.label;
  return (
    <section className="lead-panel inv-export" aria-labelledby="inv-export-h">
      <h2 id="inv-export-h" className="lead-panel__title">
        {typeLabel(props.view.type)}
      </h2>
      <fieldset className="radios inv-route" disabled={!props.canWrite || props.busy}>
        <legend>{INVT_COPY.routeLegend}</legend>
        <div className="segmented">
          {(["lut", "igst_paid"] as const).map((m) => (
            <label key={m} className="segmented__opt">
              <input
                type="radio"
                name="inv-route"
                value={m}
                checked={x.mode === m}
                onChange={() => void props.saveFields({ exportMode: m })}
              />
              {ROUTE_LABELS[m]}
            </label>
          ))}
        </div>
      </fieldset>
      {isExport && x.endorsement && (
        <StatutoryBand line={x.endorsement} sub={x.lut ? lutLine(x.lut.arn, fyLabel(x.lut.fy)) : null} />
      )}
      {isExport && (
        <dl className="inv-facts">
          <div>
            <dt>{INVT_COPY.countryOfDestination}</dt>
            <dd>{x.countryName ?? x.countryCode}</dd>
          </div>
          <div>
            <dt>Place of supply</dt>
            <dd>Outside India (96)</dd>
          </div>
        </dl>
      )}
      {isExport && x.declaration.available && (
        <div className="setting inv-note">
          <div className="setting__text">
            <span id="inv-note-label" className="setting__label">
              {noteLabel}
            </span>
            <p id="inv-note-desc" className="setting__desc">
              {INVT_COPY.exportNoteHint}
            </p>
          </div>
          <div className="setting__control">
            <Switch
              id="inv-note"
              labelledBy="inv-note-label"
              describedBy="inv-note-desc"
              checked={x.declaration.pinned}
              disabled={!props.canWrite || props.busy}
              onChange={(on) => void props.saveFields({ exportDeclaration: on })}
            />
          </div>
        </div>
      )}
    </section>
  );
}

// ---- the exchange rate (Q7) ----------------------------------------------------------------------------------------------------------------------------

/**
 * The blocker a draft's rate would meet at issue (builder's contract, RA-21): `dateVerdict` names which one; an older API only says `dateOk`.
 */
function fxWarning(fx: NonNullable<InvoiceView["fx"]>): "fx_same_day_exists" | "fx_date_invalid" | null {
  if (fx.dateVerdict === "same_day_exists") return "fx_same_day_exists";
  if (fx.dateVerdict === "invalid") return "fx_date_invalid";
  if (fx.dateVerdict === undefined && fx.dateOk === false) return "fx_date_invalid";
  return null;
}

/** The rate of a USD draft: the line it prints, or the blocker's sentence as the way in; "Change" opens the dialog. */
export function FxPanel(props: { view: InvoiceView; canWrite: boolean; busy: boolean; onOpen: () => void }) {
  const fx = props.view.fx;
  if (!fx?.applies) return null;
  const v = fx.value;
  const warn = fxWarning(fx);
  return (
    <section className="lead-panel inv-fx" aria-labelledby="inv-fx-h">
      <div className="lead-panel__head">
        <h2 id="inv-fx-h" className="lead-panel__title">
          {INVT_COPY.fxTitle}
        </h2>
        {v && props.canWrite && (
          <button type="button" className="btn btn--secondary" onClick={props.onOpen} disabled={props.busy}>
            <Pencil size={16} />
            Change<span className="visually-hidden"> the exchange rate</span>
          </button>
        )}
      </div>
      {v ? (
        <>
          <p className="inv-fx__rate">
            <span className="inv-fx__eq">1 USD = ₹{v.rate}</span>
            <span className="inv-fx__meta">
              {v.source}, {day(v.date)}
            </span>
          </p>
          {v.noRateThatDay === true && <p className="inv-fx__meta">{INVT_COPY.fxNoRateThatDay}</p>}
          {warn && (
            <p className="inv-fx__warn">
              <Alert size={16} />
              <span>
                {blockerLine({ code: warn, date: fx.refDate }, "USD", {
                  maxAgeDays: fx.maxAgeDays,
                })}
              </span>
            </p>
          )}
          {fx.inr && (
            <dl className="inv-facts">
              <div>
                <dt>{INVT_COPY.taxableInInr}</dt>
                <dd className="tnum">{amount(fx.inr.taxableMinor, "INR")}</dd>
              </div>
              {props.view.supply?.type === "export_igst" && (
                <div>
                  <dt>{INVT_COPY.igstInInr}</dt>
                  <dd className="tnum">{amount(fx.inr.igstMinor, "INR")}</dd>
                </div>
              )}
            </dl>
          )}
        </>
      ) : props.canWrite ? (
        // No rate yet: the blocker's own sentence is the way in (the heading already names the dialog it opens).
        <p className="inv-fx__empty">
          <button
            type="button"
            className="blockers__link inv-blockers__jump"
            onClick={props.onOpen}
            disabled={props.busy}
          >
            {blockerLine({ code: "fx_missing", date: fx.refDate }, "USD")}
          </button>
        </p>
      ) : (
        // A role that can't set it reads the same sentence, as text (it says what is missing and for which day).
        <p className="muted">{blockerLine({ code: "fx_missing", date: fx.refDate }, "USD")}</p>
      )}
    </section>
  );
}

/**
 * The three fields of a rate (07-S §4), shared by the draft's dialog and the advance dialog. `refDate` is the document's own day (the invoice date, or
 * the day the payment was received): a rate dated before it asks the Owner to say no rate was published that day (S §8; the server refuses an earlier
 * rate without it, `fx_same_day_exists`).
 */
export function FxFields(props: {
  prefix: string;
  form: FxForm;
  onChange: (f: FxForm) => void;
  errors: Partial<Record<"rate" | "note" | "date", string>>;
  dates: ReturnType<typeof useUnreadDates<"date">>;
  max: string;
  refDate?: string | null | undefined;
}) {
  const f = props.form;
  const set = (p: Partial<FxForm>) => props.onChange({ ...f, ...p });
  const P = props.prefix;
  const earlier = rateDayEarlier(f.date, props.refDate);
  return (
    <div className="form-grid inv-fx-fields">
      <FormField id={`${P}-rate`} label={INVT_COPY.fxRate} error={props.errors.rate}>
        {(a) => (
          <input
            {...a}
            className="tnum"
            inputMode="decimal"
            autoComplete="off"
            value={f.rate}
            onChange={(e) => set({ rate: e.target.value })}
          />
        )}
      </FormField>
      <FormField id={`${P}-date`} label={INVT_COPY.fxDate} error={props.errors.date}>
        {(a) => (
          <DateField
            {...a}
            {...props.dates.bind("date")}
            value={f.date}
            max={props.max}
            onChange={(date) =>
              set({ date, ...(rateDayEarlier(date, props.refDate) ? {} : { noRate: false }) })
            }
          />
        )}
      </FormField>
      {earlier && (
        <label className="check inv-fx-norate">
          <input
            id={`${P}-norate`}
            type="checkbox"
            checked={f.noRate}
            onChange={(e) => set({ noRate: e.target.checked })}
          />
          <span>{INVT_COPY.fxNoRateThatDay}</span>
        </label>
      )}
      <FormField id={`${P}-source`} label={INVT_COPY.fxSource}>
        {(a) => (
          <select
            {...a}
            value={f.source}
            onChange={(e) => set({ source: e.target.value as FxForm["source"] })}
          >
            {(["FBIL", "RBI", "OTHER"] as const).map((c) => (
              <option key={c} value={c}>
                {FX_SOURCE_LABELS[c]}
              </option>
            ))}
          </select>
        )}
      </FormField>
      {f.source === "OTHER" && (
        <FormField id={`${P}-note`} label={INVT_COPY.fxNoteLabel} error={props.errors.note}>
          {(a) => (
            <input
              {...a}
              maxLength={60}
              autoComplete="off"
              value={f.note}
              onChange={(e) => set({ note: e.target.value })}
            />
          )}
        </FormField>
      )}
    </div>
  );
}

/** "Exchange rate for this invoice" (07-S §4): the rate, its date and its source; saved with the draft (its content hash covers it, LD24). */
export function FxDialog(props: {
  open: boolean;
  view: InvoiceView;
  onClose: () => void;
  onSave: (fx: FxValue) => Promise<void>;
}) {
  return (
    <Modal open={props.open} title={INVT_COPY.fxTitle} onClose={props.onClose}>
      {props.open && <FxDialogBody {...props} />}
    </Modal>
  );
}

function FxDialogBody(props: {
  view: InvoiceView;
  onClose: () => void;
  onSave: (fx: FxValue) => Promise<void>;
}) {
  const today = props.view.fx?.refDate ?? todayIso();
  const [form, setForm] = useState<FxForm>(() => fxFormOf(props.view.fx?.value ?? null, today));
  const [errors, setErrors] = useState<Partial<Record<"rate" | "note" | "date", string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dates = useUnreadDates<"date">();

  async function save() {
    const c = checkFx(form);
    const dateErr = dateError(dates.unread.date) ?? undefined;
    const found = { ...(c.ok ? {} : c.errors), ...(dateErr ? { date: dateErr } : {}) };
    setErrors(found);
    if (!c.ok || dateErr) {
      const first = found.rate ? "fxd-rate" : found.date ? "fxd-date" : "fxd-note";
      if (first) document.getElementById(first)?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await props.onSave(c.value);
      props.onClose();
    } catch (e) {
      setFailure(invErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="dialog__body">
        <p>{fxBody(day(today))}</p>
        <FxFields
          prefix="fxd"
          form={form}
          onChange={setForm}
          errors={errors}
          dates={dates}
          max={today}
          refDate={props.view.fx?.refDate ?? null}
        />
        {failure && <Notice tone="error">{failure}</Notice>}
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
          {INVT_COPY.cancel}
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

// ---- the service completion date (LD29) ------------------------------------------------------------------------------------------------------------

/**
 * The day the service was completed (Rule 47; not printed). The label borrows the words of 07-S §8's two lines about it ("The service completion date
 * …"). On a draft it saves with the draft; on an issued tax or export invoice it is set once.
 */
export const SERVICE_DATE_LABEL = "Service completion date";

export function ServiceDateSetOnce(props: { view: InvoiceView; canWrite: boolean; onSaved: () => void }) {
  const v = props.view;
  const set = v.serviceCompletedOn ?? null;
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dates = useUnreadDates<"date">();
  if (v.type !== "tax_invoice" && v.type !== "export_invoice") return null;
  if (v.serviceCompletedOn === undefined) return null;
  if (set)
    return (
      <div className="lead-panel">
        <dl className="inv-facts inv-service">
          <div>
            <dt>{SERVICE_DATE_LABEL}</dt>
            <dd>{day(set)}</dd>
          </div>
        </dl>
      </div>
    );
  if (!props.canWrite || v.status === "void") return null;

  async function save() {
    const unread = dateError(dates.unread.date);
    if (unread || !date) {
      setError(unread ?? INVT_COPY.serviceDateMissing);
      document.getElementById("inv-service")?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await invoicesApi.serviceCompleted(v.id, v.updatedAt, date);
      props.onSaved();
    } catch (e) {
      setError(invErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="lead-panel inv-service"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <FormField id="inv-service" label={SERVICE_DATE_LABEL} optional error={error}>
        {(a) => <DateField {...a} {...dates.bind("date")} value={date} max={todayIso()} onChange={setDate} />}
      </FormField>
      <button type="submit" className="btn btn--secondary" disabled={busy} aria-busy={busy || undefined}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

// ---- the issued export invoice and the paid invoice (read) -----------------------------------------------------------------------------------------

/** An issued export invoice's own facts, as sealed: the endorsement band, the LUT line, the extra note, the country, the place of supply, the INR values. */
export function ExportFacts({ view }: { view: InvoiceView }) {
  const x = view.export;
  const fx = view.fx;
  // A proforma for an overseas client carries its route but no endorsement and no rate: nothing to show here.
  if (view.type !== "export_invoice" && !fx?.value) return null;
  return (
    <section className="lead-panel inv-export" aria-labelledby="inv-xf-h">
      <h2 id="inv-xf-h" className="visually-hidden">
        {typeLabel(view.type)}
      </h2>
      {x?.endorsement && (
        <StatutoryBand
          line={x.endorsement}
          sub={x.lut ? lutLine(x.lut.arn, fyLabel(x.lut.fy)) : null}
          note={x.declaration.text}
        />
      )}
      <dl className="inv-facts">
        {x && view.type === "export_invoice" && (
          <>
            <div>
              <dt>{INVT_COPY.countryOfDestination}</dt>
              <dd>{x.countryName ?? x.countryCode}</dd>
            </div>
            <div>
              <dt>Place of supply</dt>
              <dd>Outside India (96)</dd>
            </div>
          </>
        )}
        {fx?.value && (
          <div className="inv-facts__wide">
            <dt>{INVT_COPY.valueInInr}</dt>
            <dd>{fxLine(fx.value.rate, fx.value.source, day(fx.value.date))}</dd>
          </div>
        )}
        {fx?.inr && (
          <div>
            <dt>{INVT_COPY.taxableInInr}</dt>
            <dd className="tnum">{amount(fx.inr.taxableMinor, "INR")}</dd>
          </div>
        )}
        {fx?.inr && view.supply?.type === "export_igst" && (
          <div>
            <dt>{INVT_COPY.igstInInr}</dt>
            <dd className="tnum">{amount(fx.inr.igstMinor, "INR")}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/** The tax or export invoice issued for a payment received: which proforma it settles and when the money came (07-S §8), the proforma a link. */
export function AdvanceOrigin({ view }: { view: InvoiceView }) {
  const a = view.advance;
  if (!a) return null;
  const line = advanceLine(
    a.proformaNumber,
    day(a.proformaIssueDate),
    day(a.receivedOn),
    a.igstNoLutFy ? fyLabel(a.igstNoLutFy) : null,
  );
  const at = line.indexOf(a.proformaNumber);
  return (
    <p className="inv-origin">
      <Receipt size={16} />
      <span>
        {line.slice(0, at)}
        <Link to={invoiceHref(a.proformaId)}>{a.proformaNumber}</Link>
        {line.slice(at + a.proformaNumber.length)}
      </span>
    </p>
  );
}

// ---- the proforma (read) ----------------------------------------------------------------------------------------------------------------------------

/** An issued proforma: its notice, what has come in and what is left, the tax invoices issued from it, the 25-day warning, and the Owner's action. */
export function ProformaPanel(props: { view: InvoiceView; onIssued: () => void }) {
  const v = props.view;
  const p = v.proforma;
  const [open, setOpen] = useState(false);
  if (!p) return null;
  const late = p.warnAt !== null && Date.now() >= p.warnAt && v.number;
  // The client's GST details changed after the proforma (review 2, 6): the server would refuse, so the action is shown disabled with the reason.
  const supplyChanged = p.advanceSupplyChanged === true;
  return (
    <section className="lead-panel inv-proforma" aria-labelledby="inv-pf-h">
      <div className="lead-panel__head">
        <h2 id="inv-pf-h" className="lead-panel__title">
          {typeLabel("proforma")}
        </h2>
        {p.canAdvance && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setOpen(true)}
            disabled={supplyChanged}
            aria-describedby={supplyChanged ? "inv-pf-supply" : undefined}
          >
            <Receipt size={20} />
            {INVT_COPY.advanceAction}
          </button>
        )}
      </div>
      {p.canAdvance && supplyChanged && (
        <p className="approval-line" data-state="pending" id="inv-pf-supply">
          <Alert size={16} />
          <span>{INVT_COPY.advanceSupplyChanged}</span>
        </p>
      )}
      {p.notice && <StatutoryBand line={p.notice} />}
      {late && (
        <p className="approval-line" data-state="expired">
          <Alert size={16} />
          <span>{warn25Line(v.number as string)}</span>
        </p>
      )}
      {/* Valid until, the total and the balance are in the strip above; this panel holds what only a proforma has. */}
      {p.children.length > 0 && (
        <ul className="inv-children">
          {p.children.map((c) => (
            <li key={c.id}>
              <Receipt size={16} />
              <span>
                {(() => {
                  const line = childLine(c.number ?? "", amount(c.totalMinor, c.currency), day(c.issueDate));
                  const n = c.number ?? "";
                  const at = n ? line.indexOf(n) : -1;
                  return at < 0 ? (
                    line
                  ) : (
                    <>
                      {line.slice(0, at)}
                      <Link to={invoiceHref(c.id)}>{n}</Link>
                      {line.slice(at + n.length)}
                    </>
                  );
                })()}
              </span>
            </li>
          ))}
        </ul>
      )}
      {p.canAdvance && !supplyChanged && (
        <AdvanceDialog
          open={open}
          view={v}
          onClose={() => setOpen(false)}
          onIssued={() => {
            setOpen(false);
            props.onIssued();
          }}
        />
      )}
    </section>
  );
}

/**
 * "Issue tax invoice for payment received" (07-S §6, Q9; the Owner, with a fresh code): the amount, the day and the bank's reference; a USD proforma also
 * takes the rate of the day the money came, and an INR export the explicit "Issue in INR". The server issues the invoice, already paid.
 */
export function AdvanceDialog(props: {
  open: boolean;
  view: InvoiceView;
  onClose: () => void;
  onIssued: () => void;
}) {
  return (
    <Modal
      open={props.open}
      title={INVT_COPY.advanceAction}
      onClose={props.onClose}
      className="dialog--advance"
    >
      {props.open && <AdvanceBody {...props} />}
    </Modal>
  );
}

type AdvErrors = AdvanceErrors;

function AdvanceBody(props: { view: InvoiceView; onClose: () => void; onIssued: () => void }) {
  const v = props.view;
  const p = v.proforma;
  const today = todayIso();
  const usd = v.currency === "USD";
  // Q8: the server's own answer when it sends one (review 2, 6); else the client on screen (an older API).
  const inrExport = p?.advanceNeedsInrConfirm ?? (v.client.gstStatus === "overseas" && v.currency === "INR");
  const [form, setForm] = useState({ amount: "", date: today, reference: "" });
  const [fx, setFx] = useState<FxForm>(() => fxFormOf(null, today));
  // The rate is for the day the money came (Q9): its date follows "Date received" until the Owner picks one of its own (review 2, 1).
  const [fxDateOwn, setFxDateOwn] = useState(false);
  const [confirmInr, setConfirmInr] = useState(false);
  // Q37: the payment's year has no LUT (409 `advance_lut_missing`, its FY); the Owner saves the LUT first or issues this one with IGST.
  const [lutMissingFy, setLutMissingFy] = useState<string | null>(null);
  const [igst, setIgst] = useState(false);
  // What the server refused with: its blocker lines (409 `issue_blocked`), drawn as the issue dialog draws them.
  const [refused, setRefused] = useState<InvoiceBlocker[]>([]);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [errors, setErrors] = useState<AdvErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dates = useUnreadDates<"date">();
  const fxDates = useUnreadDates<"date">();
  const needsCode = !stepUpActive();
  const toast = useToast();
  if (!p) return null;
  const earlier = arrivedEarlierMonth(form.date, today);

  async function issue() {
    const c = checkAdvance(form, v.currency, p?.balanceMinor ?? 0);
    const dErr = dateError(dates.unread.date) ?? (form.date ? undefined : INVT_COPY.dateReceivedMissing);
    const f = usd ? checkFx(fx) : null;
    const fxDateErr = usd ? (dateError(fxDates.unread.date) ?? undefined) : undefined;
    const found: AdvErrors = {
      ...(c.ok ? {} : c.errors),
      ...(dErr ? { date: dErr } : {}),
      ...(f && !f.ok ? f.errors : {}),
      ...(fxDateErr ? { fxDate: fxDateErr } : {}),
    };
    setErrors(found);
    setRefused([]);
    const noCode = needsCode && code.length !== 6;
    setCodeError(noCode ? CODE_MISSING : null);
    const first = advanceFocus(found);
    if (first || !c.ok || (f && !f.ok)) {
      if (first) focusField(first);
      return;
    }
    if (noCode) {
      document.getElementById("adv-code")?.focus();
      return;
    }
    if (inrExport && !confirmInr) {
      setConfirmInr(true);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const r = await withCode(needsCode ? code : undefined, () =>
        invoicesApi.advance(v.id, {
          expectedProformaUpdatedAt: v.updatedAt,
          amountMinor: c.amountMinor,
          receivedOn: form.date,
          reference: form.reference.trim(),
          ...(f?.ok ? { fx: f.value } : {}),
          ...(confirmInr ? { confirmInrExport: true as const } : {}),
          ...(igst ? { route: "igst" as const } : {}),
        }),
      );
      // Q27: a payment from an earlier month is a warning, said with the result.
      toast(
        "success",
        r.warnings.includes("advance_previous_period")
          ? `${issuedToast(r.number)} ${INVT_COPY.previousPeriod}`
          : issuedToast(r.number),
      );
      props.onIssued();
    } catch (e) {
      // The server asks for the INR yes the screen didn't know it needed (the client changed): ask it here, issue on the next press.
      if (e instanceof RequestError && e.code === "export_currency_confirm" && !confirmInr) {
        setConfirmInr(true);
        return;
      }
      // Q37: no LUT for the payment's year; the choice is drawn and takes the focus (S §9).
      if (e instanceof RequestError && e.code === "advance_lut_missing") {
        setLutMissingFy(e.extra.fy ?? "");
        requestAnimationFrame(() => document.getElementById("adv-route-h")?.focus());
        return;
      }
      // The server's blockers (the rate's date against the day the money came, among others): their own lines, the rate's under its field.
      const listed = e instanceof RequestError && e.code === "issue_blocked" ? (e.extra.blockers ?? []) : [];
      if (listed.length > 0) {
        const { rateDate, rest } = splitAdvanceRefusal(listed);
        if (rateDate) {
          setErrors({
            fxDate: blockerLine(rateDate, v.currency, { maxAgeDays: v.fx?.maxAgeDays }),
          });
          focusField("adv-fx-date");
        }
        setRefused(rest);
        return;
      }
      setFailure(invErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  /** "Date received" changed: the rate's date goes with it unless the Owner set its own. A new day may have a LUT: the choice is asked again. */
  function setReceived(date: string) {
    setForm({ ...form, date });
    setFx(rateDateFollows(fx, fxDateOwn, date));
    if (lutMissingFy !== null) {
      setLutMissingFy(null);
      setIgst(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void issue();
      }}
    >
      <div className="dialog__body inv-advance">
        <p>{INVT_COPY.advanceBody}</p>
        <dl className="inv-facts">
          <div>
            <dt>{INV_COPY.colBalance}</dt>
            <dd className="tnum">{amount(p.balanceMinor, v.currency)}</dd>
          </div>
        </dl>
        <div className="form-grid">
          <FormField id="adv-amount" label={INVT_COPY.amountReceived} error={errors.amount}>
            {(a) => (
              <div className="money-in">
                <span aria-hidden="true">{v.currency === "INR" ? "₹" : "$"}</span>
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
          <FormField id="adv-date" label={INVT_COPY.dateReceived} error={errors.date}>
            {(a) => (
              <DateField
                {...a}
                {...dates.bind("date")}
                value={form.date}
                min={v.issueDate ?? undefined}
                max={today}
                onChange={setReceived}
              />
            )}
          </FormField>
        </div>
        <FormField id="adv-ref" label={INVT_COPY.paymentReference} error={errors.reference}>
          {(a) => (
            <input
              {...a}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
          )}
        </FormField>
        {earlier && (
          <p className="approval-line" data-state="pending">
            <Alert size={16} />
            <span>{INVT_COPY.previousPeriod}</span>
          </p>
        )}
        {usd && (
          <fieldset className="form-section inv-advance__fx">
            <legend>{INVT_COPY.fxTitle}</legend>
            <p className="hint">{fxBody(day(form.date))}</p>
            <FxFields
              prefix="adv-fx"
              form={fx}
              onChange={(next) => {
                if (next.date !== fx.date) setFxDateOwn(true);
                setFx(next);
              }}
              errors={{
                ...(errors.rate ? { rate: errors.rate } : {}),
                ...(errors.fxDate ? { date: errors.fxDate } : {}),
                ...(errors.note ? { note: errors.note } : {}),
              }}
              dates={fxDates}
              max={form.date || today}
              refDate={form.date || null}
            />
          </fieldset>
        )}
        {lutMissingFy !== null && (
          <section className="inv-route-choice" aria-labelledby="adv-route-h">
            <h3 id="adv-route-h" className="inv-route-choice__title" tabIndex={-1}>
              {INVT_COPY.advanceRouteLegend}
            </h3>
            <p className="inv-route-choice__why">
              {invErrorText(
                new RequestError(409, "advance_lut_missing", "", null, [], [], [], {
                  ...(lutMissingFy ? { fy: lutMissingFy } : {}),
                }),
              )}
            </p>
            <div className="inv-route-choice__options">
              <Link className="btn btn--secondary" to="/settings/tax#luts">
                {INVT_COPY.advanceRouteSaveLut}
              </Link>
              <button
                type="button"
                className="btn btn--secondary"
                aria-pressed={igst}
                onClick={() => setIgst(!igst)}
                disabled={busy}
              >
                {igst && <Check size={16} />}
                {INVT_COPY.advanceRouteIgst}
              </button>
            </div>
            {igst && <p className="inv-route-choice__note">{INVT_COPY.advanceIgstNote}</p>}
          </section>
        )}
        {refused.length > 0 && (
          <div className="inv-issue__blocked" role="alert">
            <p className="inv-issue__fix">{INV_COPY.fixFirst}</p>
            <BlockerList
              blockers={refused}
              clientId={v.client.id}
              currency={v.currency}
              maxAgeDays={v.fx?.maxAgeDays}
            />
          </div>
        )}
        {confirmInr && <Notice tone="info">{INVT_COPY.inrConfirm}</Notice>}
      </div>
      {needsCode && (
        <CodeField
          id="adv-code"
          label="Authenticator code"
          hint="Enter the 6-digit code from your authenticator app to continue."
          value={code}
          onChange={setCode}
          error={codeError}
        />
      )}
      {failure && <Notice tone="error">{failure}</Notice>}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
          {INVT_COPY.cancel}
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Working…" : confirmInr ? INVT_COPY.issueInInr : INVT_COPY.advanceAction}
        </button>
      </div>
    </form>
  );
}
