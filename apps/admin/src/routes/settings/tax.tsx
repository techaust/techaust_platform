// Tax settings (ADM-SET-03; Researched 2026-10-28 or OPEN per 08-C, noted at each line): the default GST rate and per-line override, SAC codes per catalogue
// category, the fixed rounding rules, exports under LUT (with the ARN for the year), advances, the USD rate source,
// e-invoicing, the reverse-charge line, and the alert thresholds. The accountant reads them; the owner changes them.
// M5.3: the day each year's annual return (GSTR-9) was filed, which closes credit notes for that year (./annual-returns.tsx).
import { financialYear, fyOf } from "@techaust/core";
import { INVOICE_CHECKLIST, issueDateOf, lutReminder } from "@techaust/core/invoices";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { DataTable } from "../../components/data-table.tsx";
import { DateField, useUnreadDates } from "../../components/date-field.tsx";
import { FormField, NumberUnit, SettingRow, Switch } from "../../components/form.tsx";
import { AlertTriangle, Lock, Pencil, Plus, Trash } from "../../components/icons.tsx";
import { dateError } from "../../lib/date-field.ts";
import {
  CHECKLIST_LABELS,
  checkLut,
  day,
  fyLabel,
  INVT_COPY,
  isHouseRule,
  type LutRow,
  lutDueBanner,
  lutMissingBanner,
  lutsByYear,
} from "../../lib/invoice-types.ts";
import { TAX_FIELDS_COPY } from "../../lib/reports.ts";
import {
  buildTax,
  CATEGORIES,
  type TaxForm as Form,
  LUT_UNSAVED,
  lutIsUnsaved,
  TAX_SAC_COPY,
  type Tax,
  taxToForm,
} from "../../lib/tax-settings.ts";
import { AnnualReturns } from "./annual-returns.tsx";
import { ctl, GroupForm, type GroupSpec, MoneyIn, RowError } from "./kit.tsx";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// The form's model and payload (every stored value round-trips, M5.5b early check H2) live in lib/tax-settings.ts, where they are tested.
const spec: GroupSpec<"tax", Form> = {
  group: "tax",
  what: "the tax settings",
  forDocuments: true,
  savedText: "Tax settings saved. They apply to new documents only.",
  toForm: (v) => taxToForm(v),
  build: (f, doc) => buildTax(f, doc),
};

/** The LUT's year: this financial year, the next and the last (and whatever is stored, if older). */
function fyOptions(stored: string) {
  const now = fyOf(Date.now()).startYear;
  const list = [now + 1, now, now - 1].map((y) => financialYear(y));
  if (stored && !list.some((fy) => fy.token === stored)) {
    const start = 2000 + Number(stored.slice(0, 2));
    list.push(financialYear(start));
  }
  return list;
}

/**
 * Letters of undertaking (07-S §5, ADM-INV-18): one per financial year, newest first; "Add LUT" opens the three fields under the list. The banners are
 * worked out from the list as it stands on the screen (core's `lutReminder` for today, IST): from 1 March while next year has none, and while this year
 * has none. They speak only when exports go under LUT. The list saves with the rest of the form.
 */
function LutList(props: {
  luts: LutRow[];
  /** The list as stored: a row not in it is marked "Not saved yet" until "Save changes" (FX-4, A5 8). */
  saved: readonly LutRow[];
  exportMode: Tax["exportMode"];
  readOnly: boolean;
  onChange: (luts: LutRow[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [row, setRow] = useState({ fy: "", arn: "", filedOn: "" });
  const [errors, setErrors] = useState<Partial<Record<"fy" | "arn" | "filedOn", string>>>({});
  const dates = useUnreadDates<"filedOn">();
  const location = useLocation();
  const status = lutReminder(issueDateOf(Date.now()), props.luts);
  const lutRoute = props.exportMode === "lut";

  // A bell or a blocker that links to "#luts" lands on the list.
  useEffect(() => {
    if (location.hash === "#luts") document.getElementById("luts")?.scrollIntoView({ block: "start" });
  }, [location.hash]);

  const taken = new Set(props.luts.map((l) => l.fy));
  const years = fyOptions("").filter((fy) => !taken.has(fy.token));

  function add() {
    const c = checkLut(row, props.luts);
    const unread = dateError(dates.unread.filedOn) ?? undefined;
    const found = { ...(c.ok ? {} : c.errors), ...(unread ? { filedOn: unread } : {}) };
    setErrors(found);
    if (!c.ok || unread) {
      document.getElementById(found.fy ? "lut-fy" : found.arn ? "lut-arn" : "lut-filed")?.focus();
      return;
    }
    props.onChange([...props.luts, c.value]);
    setRow({ fy: "", arn: "", filedOn: "" });
    setAdding(false);
    requestAnimationFrame(() => document.getElementById("lut-add")?.focus());
  }

  return (
    <section className="lut-list" aria-labelledby="luts">
      <h2 id="luts" className="settings-sub" tabIndex={-1}>
        {INVT_COPY.lutSection}
      </h2>
      <p className="hint lut-list__intro">{INVT_COPY.lutIntro}</p>
      {lutRoute && status?.due && (
        <p className="lut-banner" role="status">
          <AlertTriangle size={20} />
          <span>{lutDueBanner(status.nextFyLabel)}</span>
        </p>
      )}
      {lutRoute && status?.currentMissing && (
        <p className="lut-banner" role="status">
          <AlertTriangle size={20} />
          <span>{lutMissingBanner(status.currentFyLabel)}</span>
        </p>
      )}
      {props.luts.length > 0 && (
        <DataTable
          caption={INVT_COPY.lutSection}
          rows={lutsByYear(props.luts)}
          rowKey={(l) => l.fy}
          columns={[
            {
              key: "fy",
              header: INVT_COPY.lutFy,
              card: "title",
              cell: (l) => (
                <span className="lut-year">
                  <span className="tnum">FY {fyLabel(l.fy)}</span>
                  {lutIsUnsaved(l, props.saved) && (
                    <span className="lut-year__unsaved">
                      <Pencil size={16} />
                      <span>{LUT_UNSAVED}</span>
                    </span>
                  )}
                </span>
              ),
            },
            { key: "arn", header: INVT_COPY.lutArn, cell: (l) => <span className="docno">{l.arn}</span> },
            { key: "filed", header: INVT_COPY.lutFiledOn, cell: (l) => (l.filedOn ? day(l.filedOn) : null) },
          ]}
          actions={
            props.readOnly
              ? undefined
              : (l) => (
                  // "Remove" is the word the other lists of the admin use; 07-S has no line for it.
                  <button
                    type="button"
                    className="btn btn--text"
                    onClick={() => props.onChange(props.luts.filter((x) => x.fy !== l.fy))}
                  >
                    <Trash size={16} />
                    Remove<span className="visually-hidden"> the LUT for FY {fyLabel(l.fy)}</span>
                  </button>
                )
          }
        />
      )}
      {!props.readOnly &&
        (adding ? (
          <fieldset className="form-section lut-add">
            <legend>{INVT_COPY.addLut}</legend>
            <div className="form-grid lut-add__grid">
              <FormField id="lut-fy" label={INVT_COPY.lutFy} error={errors.fy}>
                {(a) => (
                  <select {...a} value={row.fy} onChange={(e) => setRow({ ...row, fy: e.target.value })}>
                    <option value="">{" "}</option>
                    {years.map((fy) => (
                      <option key={fy.token} value={fy.token}>
                        FY {fy.label}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField id="lut-arn" label={INVT_COPY.lutArn} error={errors.arn}>
                {(a) => (
                  <input
                    {...a}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={40}
                    value={row.arn}
                    onChange={(e) => setRow({ ...row, arn: e.target.value.toUpperCase() })}
                  />
                )}
              </FormField>
              <FormField id="lut-filed" label={INVT_COPY.lutFiledOn} optional error={errors.filedOn}>
                {(a) => (
                  <DateField
                    {...a}
                    {...dates.bind("filedOn")}
                    value={row.filedOn}
                    max={issueDateOf(Date.now())}
                    onChange={(filedOn) => setRow({ ...row, filedOn })}
                  />
                )}
              </FormField>
            </div>
            <div className="actions-row">
              <button type="button" className="btn btn--primary" onClick={add}>
                <Plus size={20} />
                {INVT_COPY.addLut}
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  setAdding(false);
                  setErrors({});
                  setRow({ fy: "", arn: "", filedOn: "" });
                }}
              >
                {INVT_COPY.cancel}
              </button>
            </div>
          </fieldset>
        ) : (
          <div className="actions-row">
            <button
              id="lut-add"
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setAdding(true);
                requestAnimationFrame(() => document.getElementById("lut-fy")?.focus());
              }}
            >
              <Plus size={20} />
              {INVT_COPY.addLut}
            </button>
          </div>
        ))}
    </section>
  );
}

/**
 * "What every invoice must show" (07-S §3, ADM-INV-06): the 18 lines in core's order. A statutory line carries the lock and is read as required by GST law
 * (the sentence is said once, beside the lock that stands for it). The house rules (bank details, the payment link, the authorised signatory; Researched
 * 2026-10-28, 08-C RA-05, RA-06) carry the "House rule" badge and a switch; the payment link stays off until online payment exists.
 */
type HouseRuleKey = "bankDetails" | "signatory";
function Checklist(props: {
  values: Record<HouseRuleKey, boolean>;
  readOnly: boolean;
  onChange: (key: HouseRuleKey, on: boolean) => void;
}) {
  return (
    <section className="checklist" aria-labelledby="tax-checklist-h">
      <h2 id="tax-checklist-h" className="settings-sub">
        {INVT_COPY.checklistTitle}
      </h2>
      <p className="hint checklist__intro">{INVT_COPY.checklistIntro}</p>
      <p className="checklist__key" id="checklist-locked">
        <Lock size={16} />
        <span>{INVT_COPY.checklistLocked}</span>
      </p>
      <ul className="checklist__items">
        {INVOICE_CHECKLIST.map((item) => {
          const label = CHECKLIST_LABELS[item.id] ?? item.id;
          const labelId = `checklist-${item.id}`;
          if (!isHouseRule(item))
            return (
              <li key={item.id} className="checklist__item">
                <Lock size={16} />
                <span id={labelId}>
                  {label}
                  <span className="visually-hidden">. {INVT_COPY.checklistLocked}</span>
                </span>
              </li>
            );
          const key = item.id === "bankDetails" || item.id === "signatory" ? item.id : null;
          // T4 (07-ZC line 3): the signatory switch says which documents it reaches (notes and invoices for a payment received are always signed)
          const scope = item.id === "signatory" ? INVT_COPY.signatoryScope : null;
          return (
            <li key={item.id} className="checklist__item checklist__item--switch">
              <span className="checklist__label">
                <span id={labelId}>{label}</span>
                <span className="checklist__house" id={`${labelId}-house`}>
                  {INVT_COPY.houseRule}
                </span>
                {scope && (
                  <span className="checklist__scope" id={`${labelId}-scope`}>
                    {scope}
                  </span>
                )}
              </span>
              <Switch
                id={`f-checklist-${item.id}`}
                labelledBy={labelId}
                describedBy={scope ? `${labelId}-house ${labelId}-scope` : `${labelId}-house`}
                checked={key ? props.values[key] : false}
                disabled={props.readOnly || !item.available || key === null}
                onChange={(on) => key && props.onChange(key, on)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function TaxSettings({ readOnly }: { readOnly: boolean }) {
  return (
    <GroupForm spec={spec} readOnly={readOnly}>
      {({ form: f, set, error, readOnly, doc }) => (
        <>
          <h2 className="settings-sub">Rates and codes</h2>
          <div className="settings-rows">
            <SettingRow
              id="tax-rate"
              label="Default GST rate"
              labelFor="f-defaultRateBp"
              description="Used for every new line unless the line sets its own."
            >
              <NumberUnit
                a11y={ctl("f-defaultRateBp", error("f-defaultRateBp"), "tax-rate-desc")}
                value={f.rate}
                onChange={(rate) => set({ rate })}
                unit="%"
              />
              <RowError id="f-defaultRateBp" error={error("f-defaultRateBp")} />
            </SettingRow>
            <SettingRow
              id="tax-override"
              label="Rate per line"
              description="Let a line on a document use a different rate."
            >
              <Switch
                id="f-allowLineOverride"
                labelledBy="tax-override-label"
                describedBy="tax-override-desc"
                checked={f.allowLineOverride}
                onChange={(allowLineOverride) => set({ allowLineOverride })}
              />
            </SettingRow>
            <SettingRow
              id="tax-sac"
              label="SAC codes by category"
              description="The 6-digit service code printed on each line, by its catalogue category."
            >
              <div className="sac-grid">
                {CATEGORIES.map((c) => {
                  const id = `f-sacByCategory-${c.key}`;
                  return (
                    <div key={c.key} className="sac-grid__item">
                      <label htmlFor={id}>{c.label}</label>
                      <input
                        {...ctl(id, error(id))}
                        inputMode="numeric"
                        maxLength={6}
                        autoComplete="off"
                        value={f.sac[c.key]}
                        onChange={(e) =>
                          set({ sac: { ...f.sac, [c.key]: e.target.value.replace(/\D/g, "") } })
                        }
                      />
                      <RowError id={id} error={error(id)} />
                    </div>
                  );
                })}
              </div>
            </SettingRow>
            {/* FX-4 (A5 12): the SAC a new custom line starts with; empty means each custom line gets its own. */}
            <SettingRow
              id="tax-default-sac"
              label={TAX_SAC_COPY.defaultSacLabel}
              labelFor="f-defaultSac"
              description={TAX_SAC_COPY.defaultSacHint}
            >
              <input
                {...ctl("f-defaultSac", error("f-defaultSac"), "tax-default-sac-desc")}
                className="sac-input"
                inputMode="numeric"
                maxLength={6}
                autoComplete="off"
                spellCheck={false}
                value={f.defaultSac}
                onChange={(e) => set({ defaultSac: e.target.value.replace(/\D/g, "") })}
              />
              <RowError id="f-defaultSac" error={error("f-defaultSac")} />
            </SettingRow>
            <SettingRow
              id="tax-round"
              label="Rounding"
              description="Tax per line, rounded half up to the paisa. INR totals to the nearest rupee, with a round-off line. USD totals aren't rounded."
            >
              <span className="muted">Fixed</span>
            </SettingRow>
          </div>

          <h2 className="settings-sub">Exports and advances</h2>
          <div className="settings-rows">
            <SettingRow
              id="tax-export"
              label="Exports by default"
              labelFor="f-exportMode"
              description="Overseas clients. Under LUT needs a saved ARN for the financial year."
            >
              <select
                id="f-exportMode"
                aria-describedby="tax-export-desc"
                value={f.exportMode}
                onChange={(e) => set({ exportMode: e.target.value as Form["exportMode"] })}
              >
                <option value="lut">Under LUT (0 % IGST)</option>
                <option value="igst_paid">IGST paid</option>
              </select>
            </SettingRow>
            <SettingRow
              id="tax-adv"
              label="Advance payments"
              labelFor="f-advanceMode"
              description="How an advance is documented. Can be changed per client and per document."
            >
              <select
                id="f-advanceMode"
                aria-describedby="tax-adv-desc"
                value={f.advanceMode}
                onChange={(e) => set({ advanceMode: e.target.value as Form["advanceMode"] })}
              >
                <option value="proforma">Proforma, then a tax invoice on payment</option>
                <option value="invoice_upfront">Tax invoice upfront</option>
                <option value="receipt_voucher">Receipt voucher</option>
              </select>
            </SettingRow>
            <SettingRow
              id="tax-fx"
              label="USD to INR rate"
              labelFor="f-fxSource"
              description="The rate used to show the INR value of a USD invoice."
            >
              <select
                id="f-fxSource"
                aria-describedby="tax-fx-desc"
                value={f.fxSource}
                onChange={(e) => set({ fxSource: e.target.value as Form["fxSource"] })}
              >
                <option value="FBIL/RBI">RBI reference rate on the date of supply</option>
                <option value="manual">Entered by hand on each invoice</option>
              </select>
            </SettingRow>
          </div>

          <LutList
            luts={f.luts}
            saved={taxToForm(doc.value).luts}
            exportMode={f.exportMode}
            readOnly={readOnly}
            onChange={(luts) => set({ luts })}
          />

          <Checklist
            values={{ bankDetails: f.bankDetails, signatory: f.signatory }}
            readOnly={readOnly}
            onChange={(key, on) => set(key === "bankDetails" ? { bankDetails: on } : { signatory: on })}
          />

          <h2 className="settings-sub">Documents and alerts</h2>
          <div className="settings-rows">
            <SettingRow
              id="tax-einv"
              label="E-invoicing"
              description="Off unless your turnover reaches the e-invoicing threshold. Ask your CA."
            >
              <Switch
                id="f-eInvoicing"
                labelledBy="tax-einv-label"
                describedBy="tax-einv-desc"
                checked={f.eInvoicing}
                onChange={(eInvoicing) => set({ eInvoicing })}
              />
            </SettingRow>
            <SettingRow
              id="tax-rc"
              label="Reverse-charge line"
              labelFor="f-reverseChargeText"
              description="Printed on every tax invoice."
            >
              <input
                {...ctl("f-reverseChargeText", error("f-reverseChargeText"), "tax-rc-desc")}
                value={f.reverseChargeText}
                onChange={(e) => set({ reverseChargeText: e.target.value })}
              />
              <RowError id="f-reverseChargeText" error={error("f-reverseChargeText")} />
            </SettingRow>
            <SettingRow
              id="tax-alert"
              label="Tax invoice reminder"
              labelFor="f-invoiceAlertDays"
              description="Warn this many days after the work is done if no tax invoice has been issued yet."
            >
              <NumberUnit
                a11y={ctl("f-invoiceAlertDays", error("f-invoiceAlertDays"), "tax-alert-desc")}
                value={f.invoiceAlertDays}
                onChange={(invoiceAlertDays) => set({ invoiceAlertDays })}
                unit="days"
              />
              <RowError id="f-invoiceAlertDays" error={error("f-invoiceAlertDays")} />
            </SettingRow>
            <SettingRow
              id="tax-cn"
              label="Credit note cut-off"
              description="After this date following the financial year of the supply, credit notes for it are blocked."
            >
              <div className="pair">
                <label className="visually-hidden" htmlFor="f-creditNoteCutoff-day">
                  Day
                </label>
                <input
                  {...ctl("f-creditNoteCutoff-day", error("f-creditNoteCutoff-day"), "tax-cn-desc")}
                  className="pair__day"
                  inputMode="numeric"
                  value={f.cnDay}
                  onChange={(e) => set({ cnDay: e.target.value })}
                />
                <label className="visually-hidden" htmlFor="f-creditNoteCutoff-month">
                  Month
                </label>
                <select
                  id="f-creditNoteCutoff-month"
                  value={f.cnMonth}
                  onChange={(e) => set({ cnMonth: e.target.value })}
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={String(i + 1)}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <RowError id="f-creditNoteCutoff-day" error={error("f-creditNoteCutoff-day")} />
            </SettingRow>
            <AnnualReturns
              value={f.annualReturns}
              error={error}
              readOnly={readOnly}
              onChange={(fy, filedOn) => set({ annualReturns: { ...f.annualReturns, [fy]: filedOn } })}
            />
            <SettingRow
              id="tax-b2c"
              label="Unregistered buyer details from"
              labelFor="f-b2cDetailsThresholdInrMinor"
              description="At or above this invoice value, a buyer without a GSTIN needs a name, address and state."
            >
              <MoneyIn
                a11y={ctl(
                  "f-b2cDetailsThresholdInrMinor",
                  error("f-b2cDetailsThresholdInrMinor"),
                  "tax-b2c-desc",
                )}
                currency="INR"
                value={f.b2c}
                onChange={(b2c) => set({ b2c })}
              />
              <RowError id="f-b2cDetailsThresholdInrMinor" error={error("f-b2cDetailsThresholdInrMinor")} />
            </SettingRow>
            <SettingRow
              id="tax-b2cl"
              label={TAX_FIELDS_COPY.b2clLabel}
              labelFor="f-b2clThresholdInrMinor"
              description={TAX_FIELDS_COPY.b2clHint}
            >
              <MoneyIn
                a11y={ctl("f-b2clThresholdInrMinor", error("f-b2clThresholdInrMinor"), "tax-b2cl-desc")}
                currency="INR"
                value={f.b2cl}
                onChange={(b2cl) => set({ b2cl })}
              />
              <RowError id="f-b2clThresholdInrMinor" error={error("f-b2clThresholdInrMinor")} />
            </SettingRow>
            <SettingRow
              id="tax-xb"
              label="Cross-border payment warning"
              labelFor="f-crossBorderWarnInrMinor"
              description="Warn above this amount for one payment through an overseas gateway."
            >
              <MoneyIn
                a11y={ctl("f-crossBorderWarnInrMinor", error("f-crossBorderWarnInrMinor"), "tax-xb-desc")}
                currency="INR"
                value={f.crossBorder}
                onChange={(crossBorder) => set({ crossBorder })}
              />
              <RowError id="f-crossBorderWarnInrMinor" error={error("f-crossBorderWarnInrMinor")} />
            </SettingRow>
          </div>

          <h2 className="settings-sub">Export payments received (FEMA)</h2>
          <div className="settings-rows">
            <SettingRow
              id="tax-warn"
              label="Warn after"
              labelFor="f-realisation-warnMonths"
              description="An export invoice still unpaid this long after its date."
            >
              <NumberUnit
                a11y={ctl("f-realisation-warnMonths", error("f-realisation-warnMonths"), "tax-warn-desc")}
                value={f.warnMonths}
                onChange={(warnMonths) => set({ warnMonths })}
                unit="months"
              />
              <RowError id="f-realisation-warnMonths" error={error("f-realisation-warnMonths")} />
            </SettingRow>
            <SettingRow
              id="tax-inr"
              label={TAX_FIELDS_COPY.inrMonthsLabel}
              labelFor="f-realisation-inrMonths"
              description={TAX_FIELDS_COPY.inrMonthsHint}
            >
              <NumberUnit
                a11y={ctl("f-realisation-inrMonths", error("f-realisation-inrMonths"), "tax-inr-desc")}
                value={f.inrMonths}
                onChange={(inrMonths) => set({ inrMonths })}
                unit="months"
              />
              <RowError id="f-realisation-inrMonths" error={error("f-realisation-inrMonths")} />
            </SettingRow>
            <SettingRow id="tax-esc" label="Escalate after" labelFor="f-realisation-escalateMonths">
              <NumberUnit
                a11y={ctl("f-realisation-escalateMonths", error("f-realisation-escalateMonths"))}
                value={f.escalateMonths}
                onChange={(escalateMonths) => set({ escalateMonths })}
                unit="months"
              />
              <RowError id="f-realisation-escalateMonths" error={error("f-realisation-escalateMonths")} />
            </SettingRow>
            <SettingRow
              id="tax-extra"
              label="Then a final reminder"
              labelFor="f-realisation-escalateExtraDays"
              description="Days after the escalation."
            >
              <NumberUnit
                a11y={ctl(
                  "f-realisation-escalateExtraDays",
                  error("f-realisation-escalateExtraDays"),
                  "tax-extra-desc",
                )}
                value={f.escalateExtraDays}
                onChange={(escalateExtraDays) => set({ escalateExtraDays })}
                unit="days"
              />
              <RowError
                id="f-realisation-escalateExtraDays"
                error={error("f-realisation-escalateExtraDays")}
              />
            </SettingRow>
          </div>
        </>
      )}
    </GroupForm>
  );
}
