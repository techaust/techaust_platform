// Payment terms (ADM-SET-05; Researched 2026-10-29, commercial settings, MSMED ss.15-16 (08-C RB-39); the liability cap: Settled by the lead on the safest reading, 2026-10-30 (08-C RB-23): the ₹10,000 cap stays, with a consumer carve-out (07-ZE; built in T6)): due days, proposal validity, the small-job threshold in both
// currencies, the Razorpay part-payment floor, the website's liability cap, reminder offsets and their sending window,
// and the build schedule (which must add up to 100 %). Amounts are typed in rupees or dollars and stored in minor units
// through @techaust/core; percentages are stored in basis points. How advances are documented lives under Tax.
import type { Settings } from "@techaust/core/settings";
import { Link } from "react-router";
import { NumberUnit, SettingRow } from "../../components/form.tsx";
import { AlertTriangle, Plus, X } from "../../components/icons.tsx";
import { TERMS_DUE_DAYS_COPY } from "../../lib/copy-z.ts";
import {
  bpToPercent,
  type FieldErrors,
  intIn,
  moneyFrom,
  moneyInput,
  offsetText,
  percentToBp,
  termsDueDaysClash,
} from "../../lib/settings-form.ts";
import { type Built, ctl, GroupForm, type GroupSpec, MoneyIn, RowError } from "./kit.tsx";

type Terms = Settings["payment_terms"];
type Reminder = { uid: string; days: string; when: "before" | "after" };
type Step = { uid: string; label: string; pct: string };
type Form = {
  dueDays: string;
  validity: string;
  smallInr: string;
  smallUsd: string;
  razorpayMin: string;
  cap: string;
  reminders: Reminder[];
  fromHour: string;
  toHour: string;
  schedule: Step[];
};

const MAX_REMINDERS = 8;
const MAX_STEPS = 6;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** Rows of the two lists need a stable key while they are edited (never saved). */
let rows = 0;
const rowId = () => `row-${++rows}`;
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

const TERMS_PAGE = "Settings › Terms";

/** 07-Z §2 line 4 (FX-5), its "Settings › Terms" a link to that page; the words are the line's own. */
function TermsDueDaysWarning({ stated }: { stated: readonly number[] }) {
  const line = TERMS_DUE_DAYS_COPY.warning(stated);
  const at = line.indexOf(TERMS_PAGE);
  return (
    <p className="field-warning setting__warning" id="pt-due-terms">
      <AlertTriangle size={16} />
      {at < 0 ? (
        <span>{line}</span>
      ) : (
        <span>
          {line.slice(0, at)}
          <Link to="/settings/terms">{TERMS_PAGE}</Link>
          {line.slice(at + TERMS_PAGE.length)}
        </span>
      )}
    </p>
  );
}

/** The schedule's total in basis points, or null while a share isn't a valid percentage. */
function scheduleTotal(steps: Step[]): number | null {
  let total = 0;
  for (const s of steps) {
    const bp = percentToBp(s.pct);
    if (bp === null) return null;
    total += bp;
  }
  return total;
}

const spec: GroupSpec<"payment_terms", Form> = {
  group: "payment_terms",
  what: "the payment terms",
  forDocuments: true,
  savedText: "Payment terms saved. They apply to new documents only.",
  toForm: (v) => ({
    dueDays: String(v.dueDays),
    validity: String(v.proposalValidityDays),
    smallInr: moneyInput(v.smallJobThreshold.INR, "INR"),
    smallUsd: moneyInput(v.smallJobThreshold.USD, "USD"),
    razorpayMin: moneyInput(v.razorpayMinPartialInrMinor, "INR"),
    cap: moneyInput(v.websiteLiabilityCapInrMinor, "INR"),
    reminders: v.reminderOffsetsDays.map((d) => ({
      uid: rowId(),
      days: String(Math.abs(d)),
      when: d < 0 ? "before" : "after",
    })),
    fromHour: String(v.reminderWindowIst.fromHour),
    toHour: String(v.reminderWindowIst.toHour),
    schedule: v.buildSchedule.map((s) => ({ uid: rowId(), label: s.label, pct: bpToPercent(s.pctBp) })),
  }),
  build: (f, doc): Built<"payment_terms"> => {
    const e: FieldErrors = {};
    const due = intIn(f.dueDays, 0, 90);
    if (due === null) e["f-dueDays"] = "Enter the payment due days, from 0 to 90.";
    const validity = intIn(f.validity, 1, 90);
    if (validity === null)
      e["f-proposalValidityDays"] = "Enter how many days proposals stay valid, from 1 to 90.";
    const inr = moneyFrom(f.smallInr, "INR");
    if (!inr.ok) e["f-smallJobThreshold-INR"] = `Small-job threshold in rupees: ${inr.error}`;
    const usd = moneyFrom(f.smallUsd, "USD");
    if (!usd.ok) e["f-smallJobThreshold-USD"] = `Small-job threshold in dollars: ${usd.error}`;
    const rz = moneyFrom(f.razorpayMin, "INR");
    if (!rz.ok) e["f-razorpayMinPartialInrMinor"] = `Smallest part-payment: ${rz.error}`;
    const cap = moneyFrom(f.cap, "INR");
    if (!cap.ok) e["f-websiteLiabilityCapInrMinor"] = `Website liability cap: ${cap.error}`;
    const offsets: number[] = [];
    f.reminders.forEach((r, i) => {
      const n = intIn(r.days, 0, r.when === "before" ? 30 : 90);
      if (n === null)
        e[`f-reminderOffsetsDays-${i}`] =
          r.when === "before" ? "Enter 0 to 30 days before." : "Enter 0 to 90 days after.";
      else offsets.push(r.when === "before" ? -n : n);
    });
    if (f.reminders.length === 0) e["f-reminderOffsetsDays"] = "Keep at least one reminder.";
    const from = Number(f.fromHour);
    const to = Number(f.toHour);
    if (to <= from) e["f-reminderWindowIst-toHour"] = "The window has to end after it starts.";
    f.schedule.forEach((s, i) => {
      if (!s.label.trim()) e[`f-buildSchedule-${i}-label`] = `Name instalment ${i + 1}.`;
      if (percentToBp(s.pct) === null)
        e[`f-buildSchedule-${i}-pctBp`] = `Enter a percentage for instalment ${i + 1}.`;
    });
    const total = scheduleTotal(f.schedule);
    if (f.schedule.length === 0) e["f-buildSchedule"] = "Keep at least one instalment.";
    else if (total !== null && total !== 10_000)
      e["f-buildSchedule"] = `The instalments add up to ${bpToPercent(total)} %. Make them add up to 100 %.`;
    if (Object.keys(e).length || due === null || validity === null || !inr.ok || !usd.ok || !rz.ok || !cap.ok)
      return { errors: e };
    const value: Terms = {
      ...doc.value,
      dueDays: due,
      proposalValidityDays: validity,
      smallJobThreshold: { INR: inr.minor, USD: usd.minor },
      razorpayMinPartialInrMinor: rz.minor,
      websiteLiabilityCapInrMinor: cap.minor,
      reminderOffsetsDays: [...new Set(offsets)].sort((a, b) => a - b),
      reminderWindowIst: { fromHour: from, toHour: to },
      buildSchedule: f.schedule.map((s) => ({ label: s.label.trim(), pctBp: percentToBp(s.pct) ?? 0 })),
    };
    return { value };
  },
};

export function PaymentTerms() {
  return (
    <GroupForm
      spec={spec}
      readOnly={false}
      intro={
        <p className="hint form-intro">
          How an advance is documented (proforma, tax invoice upfront or receipt voucher) is under{" "}
          <Link to="/settings/tax">Tax</Link>.
        </p>
      }
    >
      {({ form: f, set, error, doc }) => {
        const total = scheduleTotal(f.schedule);
        // FX-5 (full audit C4): the newest proposal terms state other days to pay than the ones on screen.
        const clash = termsDueDaysClash(doc.meta.termsDueDays?.stated, f.dueDays, doc.value.dueDays);
        return (
          <>
            <h2 className="settings-sub">Due dates</h2>
            <div className="settings-rows">
              <SettingRow
                id="pt-due"
                label="Payment due"
                labelFor="f-dueDays"
                description="Days after the invoice date. Clients can have their own."
              >
                <NumberUnit
                  a11y={ctl(
                    "f-dueDays",
                    error("f-dueDays"),
                    clash.length > 0 ? "pt-due-desc pt-due-terms" : "pt-due-desc",
                  )}
                  value={f.dueDays}
                  onChange={(dueDays) => set({ dueDays })}
                  unit="days"
                />
                <RowError id="f-dueDays" error={error("f-dueDays")} />
                {/* A live region that stays on the page, so the line is read out when typing makes the two disagree. */}
                <div aria-live="polite">{clash.length > 0 && <TermsDueDaysWarning stated={clash} />}</div>
              </SettingRow>
              <SettingRow
                id="pt-valid"
                label="Proposals and estimates valid for"
                labelFor="f-proposalValidityDays"
              >
                <NumberUnit
                  a11y={ctl("f-proposalValidityDays", error("f-proposalValidityDays"))}
                  value={f.validity}
                  onChange={(validity) => set({ validity })}
                  unit="days"
                />
                <RowError id="f-proposalValidityDays" error={error("f-proposalValidityDays")} />
              </SettingRow>
            </div>

            <h2 className="settings-sub">Amounts</h2>
            <div className="settings-rows">
              <SettingRow
                id="pt-small"
                label="Small-job threshold"
                description="Jobs priced under this are paid 100 % upfront, whatever the client's currency."
              >
                <div className="money-pair">
                  <MoneyIn
                    a11y={ctl("f-smallJobThreshold-INR", error("f-smallJobThreshold-INR"), "pt-small-desc")}
                    label="Small-job threshold in rupees"
                    currency="INR"
                    value={f.smallInr}
                    onChange={(smallInr) => set({ smallInr })}
                  />
                  <MoneyIn
                    a11y={ctl("f-smallJobThreshold-USD", error("f-smallJobThreshold-USD"), "pt-small-desc")}
                    label="Small-job threshold in US dollars"
                    currency="USD"
                    value={f.smallUsd}
                    onChange={(smallUsd) => set({ smallUsd })}
                  />
                </div>
                <RowError id="f-smallJobThreshold-INR" error={error("f-smallJobThreshold-INR")} />
                <RowError id="f-smallJobThreshold-USD" error={error("f-smallJobThreshold-USD")} />
              </SettingRow>
              <SettingRow
                id="pt-rz"
                label="Smallest part-payment by Razorpay"
                labelFor="f-razorpayMinPartialInrMinor"
                description="A payment link never asks for less, unless the balance itself is lower."
              >
                <MoneyIn
                  a11y={ctl(
                    "f-razorpayMinPartialInrMinor",
                    error("f-razorpayMinPartialInrMinor"),
                    "pt-rz-desc",
                  )}
                  currency="INR"
                  value={f.razorpayMin}
                  onChange={(razorpayMin) => set({ razorpayMin })}
                />
                <RowError id="f-razorpayMinPartialInrMinor" error={error("f-razorpayMinPartialInrMinor")} />
              </SettingRow>
              <SettingRow
                id="pt-cap"
                label="Website liability cap"
                labelFor="f-websiteLiabilityCapInrMinor"
                description="The limit printed in the website's terms. A change reaches the site with the publish step."
              >
                <MoneyIn
                  a11y={ctl(
                    "f-websiteLiabilityCapInrMinor",
                    error("f-websiteLiabilityCapInrMinor"),
                    "pt-cap-desc",
                  )}
                  currency="INR"
                  value={f.cap}
                  onChange={(cap) => set({ cap })}
                />
                <RowError id="f-websiteLiabilityCapInrMinor" error={error("f-websiteLiabilityCapInrMinor")} />
              </SettingRow>
            </div>

            <h2 className="settings-sub">Reminders</h2>
            <div className="settings-rows">
              <SettingRow
                id="pt-rem"
                label="When reminders go"
                description="Relative to the due date. Each one goes once."
              >
                <ul
                  className="edit-list"
                  aria-labelledby="pt-rem-label"
                  id="f-reminderOffsetsDays"
                  tabIndex={-1}
                >
                  {f.reminders.map((r, i) => {
                    const id = `f-reminderOffsetsDays-${i}`;
                    const days = intIn(r.days, 0);
                    return (
                      <li key={r.uid} className="edit-list__row">
                        <label className="visually-hidden" htmlFor={id}>
                          Reminder {i + 1}, days
                        </label>
                        <input
                          {...ctl(id, error(id))}
                          className="edit-list__num"
                          inputMode="numeric"
                          value={r.days}
                          onChange={(e) =>
                            set({
                              reminders: f.reminders.map((x, j) =>
                                j === i ? { ...x, days: e.target.value } : x,
                              ),
                            })
                          }
                        />
                        <label className="visually-hidden" htmlFor={`${id}-when`}>
                          Reminder {i + 1}, before or after the due date
                        </label>
                        <select
                          id={`${id}-when`}
                          value={r.when}
                          onChange={(e) =>
                            set({
                              reminders: f.reminders.map((x, j) =>
                                j === i ? { ...x, when: e.target.value as Reminder["when"] } : x,
                              ),
                            })
                          }
                        >
                          <option value="before">days before</option>
                          <option value="after">days after</option>
                        </select>
                        {days === 0 && <span className="edit-list__read muted">{offsetText(0)}</span>}
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Remove reminder ${i + 1}`}
                          onClick={() => set({ reminders: f.reminders.filter((_, j) => j !== i) })}
                        >
                          <X size={16} />
                        </button>
                        <RowError id={id} error={error(id)} />
                      </li>
                    );
                  })}
                </ul>
                <RowError id="f-reminderOffsetsDays" error={error("f-reminderOffsetsDays")} />
                {f.reminders.length < MAX_REMINDERS && (
                  <button
                    type="button"
                    className="btn btn--text"
                    onClick={() =>
                      set({ reminders: [...f.reminders, { uid: rowId(), days: "", when: "after" }] })
                    }
                  >
                    <Plus size={16} />
                    Add a reminder
                  </button>
                )}
              </SettingRow>
              <SettingRow
                id="pt-window"
                label="Sending hours"
                description="Reminders go only between these hours, IST."
              >
                <div className="pair">
                  <label className="visually-hidden" htmlFor="f-reminderWindowIst-fromHour">
                    From
                  </label>
                  <select
                    id="f-reminderWindowIst-fromHour"
                    aria-describedby="pt-window-desc"
                    value={f.fromHour}
                    onChange={(e) => set({ fromHour: e.target.value })}
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={String(h)}>
                        {hh(h)}
                      </option>
                    ))}
                  </select>
                  <span aria-hidden="true">to</span>
                  <label className="visually-hidden" htmlFor="f-reminderWindowIst-toHour">
                    To
                  </label>
                  <select
                    {...ctl(
                      "f-reminderWindowIst-toHour",
                      error("f-reminderWindowIst-toHour"),
                      "pt-window-desc",
                    )}
                    value={f.toHour}
                    onChange={(e) => set({ toHour: e.target.value })}
                  >
                    {HOURS.map((h) => h + 1).map((h) => (
                      <option key={h} value={String(h)}>
                        {hh(h)}
                      </option>
                    ))}
                  </select>
                </div>
                <RowError id="f-reminderWindowIst-toHour" error={error("f-reminderWindowIst-toHour")} />
              </SettingRow>
            </div>

            <h2 className="settings-sub">Build schedule</h2>
            <div className="settings-rows">
              <SettingRow
                id="pt-sched"
                label="Instalments for build projects"
                description="Small jobs pay 100 % upfront and care plans monthly in advance; these are for the rest."
              >
                <ol className="edit-list" aria-labelledby="pt-sched-label" id="f-buildSchedule" tabIndex={-1}>
                  {f.schedule.map((s, i) => {
                    const lid = `f-buildSchedule-${i}-label`;
                    const pid = `f-buildSchedule-${i}-pctBp`;
                    return (
                      <li key={s.uid} className="edit-list__row edit-list__row--step">
                        <label className="visually-hidden" htmlFor={lid}>
                          Instalment {i + 1}, when
                        </label>
                        <input
                          {...ctl(lid, error(lid))}
                          value={s.label}
                          onChange={(e) =>
                            set({
                              schedule: f.schedule.map((x, j) =>
                                j === i ? { ...x, label: e.target.value } : x,
                              ),
                            })
                          }
                        />
                        <label className="visually-hidden" htmlFor={pid}>
                          Instalment {i + 1}, share in per cent
                        </label>
                        <NumberUnit
                          a11y={ctl(pid, error(pid))}
                          value={s.pct}
                          onChange={(pct) =>
                            set({ schedule: f.schedule.map((x, j) => (j === i ? { ...x, pct } : x)) })
                          }
                          unit="%"
                        />
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Remove instalment ${i + 1}`}
                          onClick={() => set({ schedule: f.schedule.filter((_, j) => j !== i) })}
                        >
                          <X size={16} />
                        </button>
                        <RowError id={lid} error={error(lid)} />
                        <RowError id={pid} error={error(pid)} />
                      </li>
                    );
                  })}
                </ol>
                <p className={total === 10_000 ? "sum sum--ok" : "sum"} aria-live="polite">
                  {total === null ? "Total: check the shares" : `Total: ${bpToPercent(total)} %`}
                </p>
                <RowError id="f-buildSchedule" error={error("f-buildSchedule")} />
                {f.schedule.length < MAX_STEPS && (
                  <button
                    type="button"
                    className="btn btn--text"
                    onClick={() => set({ schedule: [...f.schedule, { uid: rowId(), label: "", pct: "" }] })}
                  >
                    <Plus size={16} />
                    Add an instalment
                  </button>
                )}
              </SettingRow>
            </div>
          </>
        );
      }}
    </GroupForm>
  );
}
