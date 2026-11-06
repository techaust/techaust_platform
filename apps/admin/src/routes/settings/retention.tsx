// Data retention (ADM-SET-09; Researched 2026-10-28, DPDP Rule 8 and Rule 56 CGST, 08-C RB-09, RB-10, RA-25): how long unconverted leads, email logs, security
// logs, closed data requests, consent records and the financial records with the audit log are kept, each with its legal minimum (the shared schema refuses
// less, and so does the API). M7.4 (G.3, G.7; Q1 A, L20): after the six figures, the nightly clean-up: whether it only reports (trial) or deletes, the
// Owner's switch with a fresh code (refused until a trial report is at most 7 days old), the reports of the last five runs (records by family: would
// delete or deleted, kept for a legal hold, the oldest), the leads due within 14 days, and "Allow emails again to an erased address". The clean-up's bells
// land on the report (`#dp-report`, lib/bell-links.ts).
import "../../dp.css";
import { useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router";
import { RequestError, stepUpActive } from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { EmptyState, StatusPill } from "../../components/display.tsx";
import { FormField, NumberUnit, SettingRow, Switch } from "../../components/form.tsx";
import { History } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { ZR_RETENTION } from "../../lib/copy-zr.ts";
import { m74Api, type RetentionCount, type RetentionReport } from "../../lib/m74-api.ts";
import { dayText } from "../../lib/requests.ts";
import {
  buildRetention,
  RETENTION_ROWS,
  type RetentionForm,
  retentionRowError,
  retentionToForm,
} from "../../lib/retention-form.ts";
import { withCode } from "../../lib/step-up.ts";
import { type Built, ctl, GroupForm, type GroupSpec, RowError } from "./kit.tsx";

const spec: GroupSpec<"retention", RetentionForm> = {
  group: "retention",
  what: "the data retention settings",
  savedText: "Data retention saved.",
  toForm: retentionToForm,
  build: (f): Built<"retention"> => buildRetention(f),
};

export function Retention() {
  return (
    <GroupForm
      spec={spec}
      readOnly={false}
      after={({ readOnly }) => (
        <>
          <CleanUp readOnly={readOnly} />
          {!readOnly && <LiftStop />}
        </>
      )}
    >
      {({ form: f, set, error }) => (
        <div className="settings-rows">
          {RETENTION_ROWS.map((r) => {
            // The minimum is checked as soon as a whole number is typed, not only on save; a refusal of the field (the schema's or the server's) shows the row's own line, never the validator's text.
            const err = retentionRowError(r, f[r.key], error(r.id));
            return (
              <SettingRow key={r.key} id={`rt-${r.key}`} label={r.label} labelFor={r.id} description={r.desc}>
                <NumberUnit
                  a11y={ctl(r.id, err, `rt-${r.key}-desc`)}
                  value={f[r.key]}
                  onChange={(v) => set({ [r.key]: v } as Partial<RetentionForm>)}
                  unit={r.unit}
                />
                <RowError id={r.id} error={err} />
              </SettingRow>
            );
          })}
        </div>
      )}
    </GroupForm>
  );
}

/** The nightly clean-up: the switch, the reports, the leads due. */
function CleanUp(props: { readOnly: boolean }) {
  const report = useLoad(() => m74Api.retentionReport(), "report");
  const { hash } = useLocation();
  // A bell lands on the report: scroll it into view once it is drawn.
  useEffect(() => {
    if (hash === "#dp-report" && report.state === "ready")
      document.getElementById("dp-report")?.scrollIntoView({ block: "start" });
  }, [hash, report.state]);
  return (
    <section className="dp-clean" aria-labelledby="dp-clean-h">
      <h2 id="dp-clean-h" className="dp-clean__h">
        {ZR_RETENTION.cleanTitle}
      </h2>
      <p className="dp-clean__lede">{ZR_RETENTION.cleanLede}</p>
      {report.state === "loading" && (
        <p className="muted" role="status">
          Loading the clean-up reports…
        </p>
      )}
      {report.state === "failed" && <LoadFailed error={report.error} onRetry={() => report.reload()} />}
      {report.state === "ready" && (
        <>
          <LiveSwitch report={report.data} readOnly={props.readOnly} onChanged={() => report.reload(true)} />
          <Reports report={report.data} />
          <LeadsDue report={report.data} />
        </>
      )}
    </section>
  );
}

function LiveSwitch(props: { report: RetentionReport; readOnly: boolean; onChanged: () => void }) {
  const r = props.report;
  const toast = useToast();
  const [asking, setAsking] = useState<boolean | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Turning on needs a fresh trial report (core `retentionLiveVerdict`); off is always allowed.
  const blocked = !r.live && r.liveVerdict !== "ok";
  const blockedText = r.liveVerdict === "no_trial_report" ? ZR_RETENTION.noTrial : ZR_RETENTION.staleTrial;
  const describe = ["dp-live-desc", blocked ? "dp-live-why" : null].filter(Boolean).join(" ");
  return (
    <div className={r.live ? "dp-live dp-live--on" : "dp-live"}>
      <div className="dp-live__row">
        <div className="dp-live__words">
          <p className="dp-live__label" id="dp-live-label">
            {ZR_RETENTION.switchLabel}
          </p>
          <p className="dp-live__desc" id="dp-live-desc">
            {r.live && r.switchedAt !== null
              ? ZR_RETENTION.liveLine(dayText(r.switchedAt), r.switchedBy?.name ?? null)
              : ZR_RETENTION.trialLine}
          </p>
        </div>
        <Switch
          id="dp-live"
          checked={r.live}
          labelledBy="dp-live-label"
          describedBy={describe}
          disabled={props.readOnly || blocked}
          onChange={(on) => {
            setRefusal(null);
            setAsking(on);
          }}
        />
      </div>
      {blocked && (
        <p className="dp-live__why" id="dp-live-why">
          {blockedText}
        </p>
      )}
      {refusal && <Notice tone="error">{refusal}</Notice>}
      {asking !== null && (
        <ConfirmDialog
          open
          stepUp={!stepUpActive()}
          tone={asking ? "danger" : "default"}
          title={asking ? ZR_RETENTION.onTitle : ZR_RETENTION.offTitle}
          confirmLabel={asking ? ZR_RETENTION.onConfirm : ZR_RETENTION.offConfirm}
          onClose={() => setAsking(null)}
          onConfirm={async (code) => {
            try {
              await withCode(code, () => m74Api.retentionLive(asking));
            } catch (e) {
              if (
                e instanceof RequestError &&
                (e.code === "no_trial_report" || e.code === "trial_report_stale")
              ) {
                setAsking(null);
                setRefusal(e.code === "no_trial_report" ? ZR_RETENTION.noTrial : ZR_RETENTION.staleTrial);
                props.onChanged();
                return undefined;
              }
              if (e instanceof RequestError && e.code === "switch_unchanged") {
                setAsking(null);
                setRefusal(ZR_RETENTION.unchanged);
                props.onChanged();
                return undefined;
              }
              throw e;
            }
            toast("success", asking ? ZR_RETENTION.onDone : ZR_RETENTION.offDone);
            props.onChanged();
            return undefined;
          }}
        >
          <p>{asking ? ZR_RETENTION.onBody : ZR_RETENTION.offBody}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

type CountRow = RetentionCount & { key: string };

function Reports({ report }: { report: RetentionReport }) {
  const [picked, setPicked] = useState<string | null>(null);
  const run = report.runs.find((x) => x.id === picked) ?? report.runs[0] ?? null;
  const live = run?.mode === "live";
  const columns: Column<CountRow>[] = [
    {
      key: "what",
      header: ZR_RETENTION.colWhat,
      card: "title",
      width: "40%",
      cell: (c) => (
        <span className="dp-cell">
          <span>{ZR_RETENTION.family[c.family] ?? c.family}</span>
          {c.family === "audit_ip" && <span className="dp-cell__meta">{ZR_RETENTION.auditIpNote}</span>}
        </span>
      ),
    },
    {
      key: "due",
      header: ZR_RETENTION.colDue(live),
      align: "end",
      cell: (c) =>
        c.done || c.due > 0 ? (
          <span className="num">{c.due.toLocaleString("en-IN")}</span>
        ) : (
          <span className="muted">{ZR_RETENTION.partsPending}</span>
        ),
    },
    {
      key: "held",
      header: ZR_RETENTION.colHeld,
      align: "end",
      cell: (c) =>
        c.heldSkipped > 0 ? (
          <span className="num">{c.heldSkipped.toLocaleString("en-IN")}</span>
        ) : (
          <span className="muted">{ZR_RETENTION.none}</span>
        ),
    },
    {
      key: "oldest",
      header: ZR_RETENTION.colOldest,
      cell: (c) =>
        c.oldestAt !== null ? (
          <span className="when--keep">{dayText(c.oldestAt)}</span>
        ) : (
          <span className="muted">–</span>
        ),
    },
  ];
  return (
    <section id="dp-report" className="dp-report" aria-labelledby="dp-report-h" tabIndex={-1}>
      <h3 id="dp-report-h" className="dp-clean__sub">
        {ZR_RETENTION.reportTitle}
      </h3>
      <p className="dp-clean__note">{ZR_RETENTION.reportLede}</p>
      {!run ? (
        <div className="dtable dtable--empty">
          <EmptyState
            icon={<History />}
            title={ZR_RETENTION.reportEmpty.split(". ")[0] ?? ""}
            headingLevel={3}
          >
            <p>{ZR_RETENTION.reportEmpty.split(". ").slice(1).join(". ")}</p>
          </EmptyState>
        </div>
      ) : (
        <>
          <fieldset className="dp-show dp-runs">
            <legend className="dp-show__legend">{ZR_RETENTION.runPicker}</legend>
            <div className="dp-show__row">
              {report.runs.map((x) => (
                <label key={x.id} className="dp-show__opt">
                  <input
                    type="radio"
                    name="dp-run"
                    checked={run.id === x.id}
                    onChange={() => setPicked(x.id)}
                  />
                  {ZR_RETENTION.runLabel(dayText(x.asOf), x.mode)}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="dp-run-state">
            <StatusPill tone={live ? "danger" : "info"} icon={live ? "alert" : "eye"}>
              {live ? ZR_RETENTION.modeLive : ZR_RETENTION.modeTrial}
            </StatusPill>
            {run.finishedAt === null && (
              <StatusPill tone="warning" icon="progress">
                {ZR_RETENTION.running}
              </StatusPill>
            )}
          </p>
          <DataTable
            caption={`${ZR_RETENTION.reportTitle}: ${ZR_RETENTION.runLabel(dayText(run.asOf), run.mode)}`}
            columns={columns}
            rows={run.counts.map((c) => ({ ...c, key: c.family }))}
            rowKey={(c) => c.key}
          />
        </>
      )}
    </section>
  );
}

function LeadsDue({ report }: { report: RetentionReport }) {
  return (
    <section className="dp-leads-due" aria-labelledby="dp-leads-h">
      <h3 id="dp-leads-h" className="dp-clean__sub">
        {ZR_RETENTION.leadsTitle}
      </h3>
      {report.leadsDue.length === 0 ? (
        <p className="muted">{ZR_RETENTION.leadsEmpty}</p>
      ) : (
        <>
          {!report.live && <p className="dp-clean__note">{ZR_RETENTION.leadsTrial}</p>}
          <ul className="dp-leads-due__list">
            {report.leadsDue.map((l) => (
              <li key={l.id}>
                <Link to={`/leads/${encodeURIComponent(l.id)}`} className="docno">
                  {l.ref}
                </Link>{" "}
                <span className="muted">{ZR_RETENTION.leadsWhen(dayText(l.deleteAfter))}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** S9 (L20): the Owner allows emails again to an address whose stop was written at an erasure (step-up, audited by its keyed hash only). */
function LiftStop() {
  const id = useId();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  return (
    <section className="dp-lift" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="dp-clean__h">
        {ZR_RETENTION.liftHeading}
      </h2>
      <p className="dp-clean__lede">{ZR_RETENTION.liftTitle.replace(`${ZR_RETENTION.liftHeading}. `, "")}</p>
      <form
        className="dp-lift__form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const v = email.trim().toLowerCase();
          if (v === "" || !ADDRESS.test(v) || v.length > 254) {
            setError(v === "" ? ZR_RETENTION.emailMissing : ZR_RETENTION.emailInvalid);
            document.getElementById(`${id}-email`)?.focus();
            return;
          }
          setError(null);
          setAsking(v);
        }}
      >
        <FormField id={`${id}-email`} label={ZR_RETENTION.liftField} error={error}>
          {(a) => (
            <input
              {...a}
              type="email"
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
            />
          )}
        </FormField>
        <button type="submit" className="btn btn--secondary">
          {ZR_RETENTION.liftButton}
        </button>
      </form>
      {asking && (
        <ConfirmDialog
          open
          stepUp={!stepUpActive()}
          title={ZR_RETENTION.liftConfirmTitle(asking)}
          confirmLabel={ZR_RETENTION.liftButton}
          onClose={() => setAsking(null)}
          onConfirm={async (code) => {
            try {
              await withCode(code, () => m74Api.liftSuppression(asking));
            } catch (e) {
              if (e instanceof RequestError && e.code === "not_suppressed")
                throw new RequestError(409, e.code, ZR_RETENTION.liftNotFound);
              throw e;
            }
            toast("success", ZR_RETENTION.liftToast);
            setEmail("");
            return undefined;
          }}
        >
          <p>{ZR_RETENTION.liftConfirmBody}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
