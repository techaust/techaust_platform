// Tax settings (ADM-SET-03, VERIFY WITH CA): the default GST rate and per-line override, SAC codes per catalogue
// category, the fixed rounding rules, exports under LUT (with the ARN for the year), advances, the USD rate source,
// e-invoicing, the reverse-charge line, and the alert thresholds. The accountant reads them; the owner changes them.
import { financialYear, fyOf } from "@techaust/core";
import type { Settings } from "@techaust/core/settings";
import { StatusPill } from "../../components/display.tsx";
import { NumberUnit, SettingRow, Switch } from "../../components/form.tsx";
import {
  bpToPercent,
  type FieldErrors,
  intIn,
  moneyFrom,
  moneyInput,
  percentToBp,
} from "../../lib/settings-form.ts";
import { type Built, ctl, GroupForm, type GroupSpec, MoneyIn, RowError } from "./kit.tsx";

type Tax = Settings["tax"];
type Category = keyof Tax["sacByCategory"];
const CATEGORIES: { key: Category; label: string }[] = [
  { key: "advise", label: "Advise" },
  { key: "build", label: "Build" },
  { key: "automate", label: "Automate" },
  { key: "connect", label: "Connect" },
  { key: "run", label: "Run" },
];
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

type Form = {
  rate: string;
  allowLineOverride: boolean;
  sac: Record<Category, string>;
  exportMode: Tax["exportMode"];
  lutArn: string;
  lutFy: string;
  advanceMode: Tax["advanceMode"];
  fxSource: Tax["fxSource"];
  eInvoicing: boolean;
  reverseChargeText: string;
  invoiceAlertDays: string;
  cnMonth: string;
  cnDay: string;
  b2c: string;
  warnMonths: string;
  escalateMonths: string;
  escalateExtraDays: string;
  crossBorder: string;
};

const spec: GroupSpec<"tax", Form> = {
  group: "tax",
  what: "the tax settings",
  forDocuments: true,
  savedText: "Tax settings saved. They apply to new documents only.",
  toForm: (v) => ({
    rate: bpToPercent(v.defaultRateBp),
    allowLineOverride: v.allowLineOverride,
    sac: { ...v.sacByCategory },
    exportMode: v.exportMode,
    lutArn: v.lut.arn ?? "",
    lutFy: v.lut.fy ?? "",
    advanceMode: v.advanceMode,
    fxSource: v.fxSource,
    eInvoicing: v.eInvoicing,
    reverseChargeText: v.reverseChargeText,
    invoiceAlertDays: String(v.invoiceAlertDays),
    cnMonth: String(v.creditNoteCutoff.month),
    cnDay: String(v.creditNoteCutoff.day),
    b2c: moneyInput(v.b2cDetailsThresholdInrMinor, "INR"),
    warnMonths: String(v.realisation.warnMonths),
    escalateMonths: String(v.realisation.escalateMonths),
    escalateExtraDays: String(v.realisation.escalateExtraDays),
    crossBorder: moneyInput(v.crossBorderWarnInrMinor, "INR"),
  }),
  build: (f, doc): Built<"tax"> => {
    const e: FieldErrors = {};
    const rate = percentToBp(f.rate);
    if (rate === null) e["f-defaultRateBp"] = "Enter a rate from 0 to 100 %, with at most 2 decimals.";
    for (const c of CATEGORIES)
      if (!/^\d{6}$/.test(f.sac[c.key].trim()))
        e[`f-sacByCategory-${c.key}`] = `The ${c.label} SAC has 6 digits.`;
    if (f.exportMode === "lut" && f.lutArn.trim() && !f.lutFy)
      e["f-lut-fy"] = "Pick the financial year the LUT covers.";
    const alertDays = intIn(f.invoiceAlertDays, 1, 30);
    if (alertDays === null) e["f-invoiceAlertDays"] = "Enter a number of days from 1 to 30.";
    const cnMonth = intIn(f.cnMonth, 1, 12);
    const cnDay = intIn(f.cnDay, 1, 31);
    if (cnDay === null) e["f-creditNoteCutoff-day"] = "Enter a day from 1 to 31.";
    const b2c = moneyFrom(f.b2c, "INR");
    if (!b2c.ok) e["f-b2cDetailsThresholdInrMinor"] = b2c.error;
    const warn = intIn(f.warnMonths, 1);
    if (warn === null) e["f-realisation-warnMonths"] = "Enter a number of months, 1 or more.";
    const esc = intIn(f.escalateMonths, 1);
    if (esc === null) e["f-realisation-escalateMonths"] = "Enter a number of months, 1 or more.";
    const extra = intIn(f.escalateExtraDays, 0);
    if (extra === null) e["f-realisation-escalateExtraDays"] = "Enter a number of days, 0 or more.";
    const cross = moneyFrom(f.crossBorder, "INR");
    if (!cross.ok) e["f-crossBorderWarnInrMinor"] = cross.error;
    if (!f.reverseChargeText.trim()) e["f-reverseChargeText"] = "Enter the reverse-charge line.";
    if (
      Object.keys(e).length ||
      rate === null ||
      alertDays === null ||
      cnMonth === null ||
      cnDay === null ||
      !b2c.ok ||
      warn === null ||
      esc === null ||
      extra === null ||
      !cross.ok
    )
      return { errors: e };
    return {
      value: {
        ...doc.value,
        defaultRateBp: rate,
        allowLineOverride: f.allowLineOverride,
        sacByCategory: Object.fromEntries(
          CATEGORIES.map((c) => [c.key, f.sac[c.key].trim()]),
        ) as Tax["sacByCategory"],
        exportMode: f.exportMode,
        lut: { arn: f.lutArn.trim() || null, fy: f.lutFy || null },
        advanceMode: f.advanceMode,
        fxSource: f.fxSource,
        eInvoicing: f.eInvoicing,
        reverseChargeText: f.reverseChargeText.trim(),
        invoiceAlertDays: alertDays,
        creditNoteCutoff: { month: cnMonth, day: cnDay },
        b2cDetailsThresholdInrMinor: b2c.minor,
        realisation: { warnMonths: warn, escalateMonths: esc, escalateExtraDays: extra },
        crossBorderWarnInrMinor: cross.minor,
      },
    };
  },
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

export function TaxSettings({ readOnly }: { readOnly: boolean }) {
  return (
    <GroupForm spec={spec} readOnly={readOnly}>
      {({ form: f, set, error }) => (
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
              id="tax-arn"
              label="LUT ARN"
              labelFor="f-lut-arn"
              optional
              description="From the GST portal, after you file the LUT for the year."
            >
              <div className="stack-sm">
                <input
                  {...ctl("f-lut-arn", undefined, `tax-arn-desc${!f.lutArn ? " tax-arn-state" : ""}`)}
                  value={f.lutArn}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => set({ lutArn: e.target.value.toUpperCase() })}
                />
                {!f.lutArn && f.exportMode === "lut" && (
                  <span id="tax-arn-state">
                    <StatusPill tone="warning" icon="clock">
                      Missing: exports under LUT are blocked
                    </StatusPill>
                  </span>
                )}
              </div>
            </SettingRow>
            <SettingRow id="tax-lutfy" label="LUT financial year" labelFor="f-lut-fy" optional={!f.lutArn}>
              <select
                {...ctl("f-lut-fy", error("f-lut-fy"))}
                value={f.lutFy}
                onChange={(e) => set({ lutFy: e.target.value })}
              >
                <option value="">Not set</option>
                {fyOptions(f.lutFy).map((fy) => (
                  <option key={fy.token} value={fy.token}>
                    FY {fy.label}
                  </option>
                ))}
              </select>
              <RowError id="f-lut-fy" error={error("f-lut-fy")} />
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
                <option value="FBIL/RBI">RBI reference rate on the invoice date</option>
                <option value="manual">Entered by hand on each invoice</option>
              </select>
            </SettingRow>
          </div>

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
