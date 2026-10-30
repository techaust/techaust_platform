// One care plan (M3.5, ADM-CARE-01, ADM-CARE-03): the header (status pill, pause / resume / cancel with the 07-M confirmations, and
// the owner's terms change with the money confirmation of ADM-G-04), the plan strip, the current billing period (hours used
// against included plus carried over, as words and a calm bar, the overage and its amount before GST, or the no-rate line), the
// last 12 periods, the terms in force and any booked for the next period, and the status history. A status change takes effect
// today (or on the start date); new terms from the next billing period (owner's Q1). The server decides every rule again.
import { planPeriodOf } from "@techaust/core/care";
import { istDate, toIsoDate } from "@techaust/core/dates";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { api, type CarePlanPage, type CareStatus, type CareUsage, RequestError } from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { Modal } from "../../components/dialog.tsx";
import { KeepDates, PageHeader, Skeleton, When } from "../../components/display.tsx";
import { Alert, Check, ChevronDown, Info, Pencil, Receipt } from "../../components/icons.tsx";
import { MenuButton } from "../../components/popover.tsx";
import { LoadFailed, NotFound, StaleNotice, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import {
  CARE_COPY,
  CARE_PENDING,
  CARE_TOASTS,
  cancelPlanConfirm,
  careErrorText,
  careMoves,
  hoursText,
  moneyText,
  newestTerms,
  pauseConfirm,
  pendingTermsLine,
  periodText,
  planName,
  planTitle,
  ROLLOVER_LABELS,
  resumeConfirm,
  statusDate,
  statusToast,
  type TermChange,
  type TermsForm,
  TIER_LABELS,
  termsChange,
  termsConfirm,
  termsDate,
  termsFormOf,
} from "../../lib/care.ts";
import { type CarePlanBilling, PLAN_BILLING_COPY, planAutoLines } from "../../lib/invoice-send.ts";
import { badgeOf } from "../../lib/invoices.ts";
import { useUser } from "../../session.tsx";
import { Fact } from "../clients/overview.tsx";
import { InvoiceBadge, invoiceHref, NumberMark } from "../invoices/parts.tsx";
import { Day } from "../projects/parts.tsx";
import { CARE_CRUMBS, CareGate, CarePill, FlagPill, HoursBar } from "./parts.tsx";
import { TermsFields } from "./terms-fields.tsx";

export function Component() {
  const { id = "" } = useParams();
  return (
    <CareGate>
      <PlanScreen key={id} id={id} />
    </CareGate>
  );
}

function PlanScreen({ id }: { id: string }) {
  const page = useLoad(() => api.carePlan(id), id);
  if (page.state === "failed") {
    if (page.error instanceof RequestError && page.error.status === 404) return <NotFound />;
    return (
      <>
        <PageHeader title="Care plan" crumbs={CARE_CRUMBS} />
        <LoadFailed error={page.error} onRetry={() => page.reload()} />
      </>
    );
  }
  if (page.state === "loading") return <PlanSkeleton />;
  return <PlanView data={page.data} reload={() => page.reload(true)} />;
}

function PlanView({ data, reload }: { data: CarePlanPage; reload: () => void }) {
  const user = useUser();
  const { plan, terms } = data;
  const current = terms.current;
  const tier = current?.tier ?? terms.pending?.tier ?? null;
  const name = planName(tier, plan.clientName);
  const canWrite = allowed(user.role, "carePlans.write");
  const isOwner = allowed(user.role, "carePlans.changePrice");
  const live = !data.clientAnonymised;
  const [stale, setStale] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const actions =
    plan.status !== "cancelled" && (canWrite || isOwner) ? (
      <>
        {isOwner && live && (
          <TermsChange data={data} name={name} onStale={() => setStale(true)} onDone={reload} />
        )}
        {canWrite && (
          <StatusMoves
            data={data}
            name={name}
            canCancel={isOwner}
            live={live}
            onStale={() => setStale(true)}
            onFailure={setFailure}
            onDone={reload}
          />
        )}
      </>
    ) : undefined;

  return (
    <>
      <PageHeader
        title={planTitle(tier, plan.clientName)}
        crumbs={CARE_CRUMBS}
        status={<CarePill status={plan.status} />}
        action={actions}
      />
      <PlanStrip data={data} />
      {failure && <Notice tone="error">{failure}</Notice>}
      {data.clientAnonymised && <Notice tone="info">{CARE_COPY.clientAnonymised}</Notice>}
      {stale && (
        <StaleNotice
          title={CARE_PENDING.stalePlan}
          onReload={() => {
            setStale(false);
            reload();
          }}
        />
      )}
      {terms.pending && plan.status !== "cancelled" && (
        <Notice tone="info">{pendingTermsLine(terms.pending.effectiveFrom)}</Notice>
      )}
      <div className="lead-page care-page">
        <div className="lead-page__main">
          <PeriodCard usage={data.usage} data={data} />
          {data.billing && <BillingPanel billing={data.billing} data={data} />}
        </div>
        <aside className="lead-page__side" aria-label="Terms and history">
          <TermsPanel data={data} />
          <StatusPanel data={data} />
        </aside>
      </div>
      <PastPeriods data={data} />
    </>
  );
}

/** The plan at a glance, the same for every role (the M3.3 strip). */
function PlanStrip({ data }: { data: CarePlanPage }) {
  const p = data.plan;
  const t = data.terms.current;
  const facts: [string, ReactNode][] = [
    [
      "Client",
      <span key="c" className="strip-client">
        <Link to={`/clients/${p.clientId}?tab=care-plans`}>{p.clientName}</Link>
        <span className="docno strip-client__code">{p.clientCode}</span>
      </span>,
    ],
    [
      "Tier",
      t ? (
        TIER_LABELS[t.tier]
      ) : (
        <span key="t" className="muted">
          {CARE_COPY.notStarted}
        </span>
      ),
    ],
    [
      "Price per month",
      t ? (
        <span key="p" className="tnum">
          {moneyText(t.priceMinor, p.currency)}
        </span>
      ) : (
        <span key="p" className="muted">
          {CARE_COPY.notStarted}
        </span>
      ),
    ],
    ["Start date", <Day key="s" iso={p.startDate} />],
    [
      "Billing day",
      <span key="b" className="tnum">
        {p.billingDay}
      </span>,
    ],
    [
      "Currency",
      <span key="cur" className="docno">
        {p.currency}
      </span>,
    ],
  ];
  return (
    <dl className="client-strip project-strip">
      {facts.map(([label, v]) => (
        <div key={label} className="client-strip__fact">
          <dt>{label}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---- the current period ---------------------------------------------------------------------------------------------------------

/** The overage of a period in words: minutes, and the amount before GST or the no-rate line. */
function OverageText({ u, currency }: { u: CareUsage; currency: CarePlanPage["plan"]["currency"] }) {
  if (u.overageMinutes === 0) return <span className="tnum">{hoursText(0)}</span>;
  return (
    <span className="overage">
      <span className="tnum">{hoursText(u.overageMinutes)}</span>
      {u.overageMinor !== null ? (
        <span className="tnum overage__amount">{moneyText(u.overageMinor, currency)}</span>
      ) : (
        <span className="muted overage__amount">{CARE_COPY.noRate}</span>
      )}
    </span>
  );
}

function PeriodCard({ usage: u, data }: { usage: CareUsage | null; data: CarePlanPage }) {
  const currency = data.plan.currency;
  if (!u)
    return (
      <section className="lead-panel period-card" aria-labelledby="period-h">
        <h2 id="period-h" className="lead-panel__title">
          {CARE_COPY.notStarted}
        </h2>
        <p className="muted">
          Start date <Day iso={data.plan.startDate} />
        </p>
      </section>
    );
  return (
    <section className="lead-panel period-card" aria-labelledby="period-h">
      <div className="period-card__head">
        <h2 id="period-h" className="lead-panel__title">
          {periodText(u.period)}
        </h2>
        <FlagPill flag={u.flag} />
      </div>
      <HoursBar usage={u} size="lg" />
      <dl className="period-ledger">
        <div>
          <dt>{CARE_COPY.included}</dt>
          <dd className="tnum">{hoursText(u.included)}</dd>
        </div>
        <div>
          <dt>{CARE_COPY.carriedOver}</dt>
          <dd className="tnum">{hoursText(u.rolloverIn)}</dd>
        </div>
        <div>
          <dt>{CARE_COPY.used}</dt>
          <dd className="tnum">{hoursText(u.used)}</dd>
        </div>
        <div>
          <dt>{CARE_COPY.remaining}</dt>
          <dd className="tnum">{hoursText(u.remaining)}</dd>
        </div>
        <div className="period-ledger__overage" data-over={u.overageMinutes > 0 || undefined}>
          <dt>{CARE_COPY.overage}</dt>
          <dd>
            <OverageText u={u} currency={currency} />
          </dd>
        </div>
      </dl>
      <p className="period-card__nonbillable">
        <span>Non-billable</span> <span className="tnum">{hoursText(u.nonBillable)}</span>
      </p>
      <div className="period-card__notes">
        <p className="hint">{CARE_COPY.beforeGst}</p>
        <p className="panel-empty">
          <Receipt size={20} />
          <span>
            {data.overage?.addToInvoice?.available === true
              ? CARE_COPY.addToNextDraft
              : CARE_COPY.addToInvoice}
          </span>
        </p>
      </div>
    </section>
  );
}

// ---- billing (M5.4, ADM-CARE-02, ADM-INV-12; finance roles only) --------------------------------------------------------------

/**
 * The plan's billing drawn as the invoice page draws its reminders: one rule, a node for the last period billed (filled; with its invoice and status) and
 * one for the next billing day (a ring). Under it, for a draft not yet issued, 07-U §6's reasons (or the allowed line), and always the pointer to the
 * draft's own page: `blockersChecked` is false, so this section never says the draft is ready to issue.
 */
function BillingPanel({ billing: b, data }: { billing: CarePlanBilling; data: CarePlanPage }) {
  const last = b.lastBilledPeriod ? planPeriodOf(b.lastBilledPeriod, data.plan) : null;
  const auto = planAutoLines(b.auto);
  const draftId = b.draft?.status === "draft" ? b.draft.id : null;
  return (
    <section className="lead-panel care-billing" aria-labelledby="billing-h">
      <h2 id="billing-h" className="lead-panel__title care-billing__title">
        <Receipt size={20} />
        {PLAN_BILLING_COPY.heading}
      </h2>
      <ol className="remind care-billing__steps">
        <li className="remind__row" data-state={b.lastBilledPeriod ? "sent" : "skipped"}>
          <span className="remind__node" aria-hidden="true">
            {b.lastBilledPeriod && <Check size={16} />}
          </span>
          <span className="remind__day">{PLAN_BILLING_COPY.lastBilled}</span>
          <span className="remind__state">
            {last
              ? periodText(last)
              : b.lastBilledPeriod
                ? billedPeriodStart(b.lastBilledPeriod)
                : PLAN_BILLING_COPY.notBilled}
          </span>
          {b.lastBilledPeriod && (
            <span className="care-billing__doc">
              {b.draft ? (
                <>
                  <Link className="inv-name__link" to={invoiceHref(b.draft.id)}>
                    <NumberMark number={b.draft.number} void={b.draft.status === "void"} />
                  </Link>
                  <InvoiceBadge badge={badgeOf({ status: b.draft.status, overdue: false })} />
                </>
              ) : (
                <span className="muted">{PLAN_BILLING_COPY.noRecord}</span>
              )}
            </span>
          )}
        </li>
        <li
          className="remind__row"
          data-state={b.nextBillingDay ? "due" : "skipped"}
          data-due={b.nextBillingDay ? true : undefined}
        >
          <span className="remind__node" aria-hidden="true" />
          <span className="remind__day">{PLAN_BILLING_COPY.nextDay}</span>
          <span className="remind__state">
            {b.nextBillingDay ? <Day iso={b.nextBillingDay} /> : PLAN_BILLING_COPY.noNextDay}
          </span>
        </li>
      </ol>
      {auto && (
        <div className="care-billing__auto">
          <p className="approval-line" data-state={auto.tone === "pending" ? "pending" : undefined}>
            {auto.tone === "pending" ? <Alert size={16} /> : <Info size={16} />}
            <span>{auto.text}</span>
          </p>
          <p className="care-billing__check">
            <span>{auto.pointer}</span>{" "}
            {draftId && (
              <Link className="inv-name__link" to={invoiceHref(draftId)}>
                {PLAN_BILLING_COPY.openDraft}
              </Link>
            )}
          </p>
        </div>
      )}
    </section>
  );
}

/** A last billed period that falls before the plan's start (never expected): its start date alone, never a guessed end. */
const billedPeriodStart = (iso: string) => <Day iso={iso} />;

// ---- the last 12 periods ---------------------------------------------------------------------------------------------------------

function PastPeriods({ data }: { data: CarePlanPage }) {
  const currency = data.plan.currency;
  const columns: Column<CareUsage>[] = [
    {
      key: "period",
      header: "Billing period",
      card: "title",
      width: "26%",
      cell: (u) => <span className="period-cell">{periodText(u.period)}</span>,
    },
    { key: "included", header: CARE_COPY.included, align: "end", cell: (u) => <Hours m={u.included} /> },
    { key: "carried", header: CARE_COPY.carriedOver, align: "end", cell: (u) => <Hours m={u.rolloverIn} /> },
    { key: "used", header: CARE_COPY.used, align: "end", cell: (u) => <Hours m={u.used} /> },
    { key: "nonbill", header: "Non-billable", align: "end", cell: (u) => <Hours m={u.nonBillable} /> },
    {
      key: "overage",
      header: CARE_COPY.overage,
      align: "end",
      cell: (u) => <OverageText u={u} currency={currency} />,
    },
    {
      key: "flag",
      header: "Flag",
      cell: (u) => (u.flag === "none" ? <span className="muted">None</span> : <FlagPill flag={u.flag} />),
    },
  ];
  // A panel with its heading, not a landmark: when the table scrolls sideways it becomes a region named by its caption, and two regions
  // named "Last 12 billing periods" broke axe landmark-unique (final sweep A10).
  return (
    <div className="lead-panel periods-panel">
      <h2 className="lead-panel__title">Last 12 billing periods</h2>
      <div className="clients-table periods-table">
        <DataTable
          caption="Last 12 billing periods"
          columns={columns}
          rows={data.periods}
          rowKey={(u) => u.period.start}
          empty={<p className="muted">{CARE_COPY.notStarted}</p>}
        />
      </div>
    </div>
  );
}

const Hours = ({ m }: { m: number }) => <span className="tnum">{hoursText(m)}</span>;

// ---- terms and status history ------------------------------------------------------------------------------------------------

function TermsList({
  t,
  currency,
}: {
  t: NonNullable<CarePlanPage["terms"]["current"]>;
  currency: CarePlanPage["plan"]["currency"];
}) {
  const money = (v: number | null) =>
    v === null ? <span className="muted">None</span> : <span className="tnum">{moneyText(v, currency)}</span>;
  return (
    <dl className="facts figures">
      <Fact label="Tier">{TIER_LABELS[t.tier]}</Fact>
      <Fact label="Price per month">{money(t.priceMinor)}</Fact>
      <Fact label="Included hours">
        <span className="tnum">{hoursText(t.includedMinutes)}</span>
      </Fact>
      <Fact label="Rollover">{ROLLOVER_LABELS[t.rollover]}</Fact>
      <Fact label="Overage rate per hour">{money(t.overageRateMinor)}</Fact>
      <Fact label="AI Ops add-on">{money(t.aiOpsMinor)}</Fact>
    </dl>
  );
}

function TermsPanel({ data }: { data: CarePlanPage }) {
  const { current, pending } = data.terms;
  return (
    <section className="lead-panel" aria-labelledby="terms-h">
      <h2 id="terms-h" className="lead-panel__title">
        Terms
      </h2>
      {current ? (
        <TermsList t={current} currency={data.plan.currency} />
      ) : (
        <p className="muted">{CARE_COPY.notStarted}</p>
      )}
      {pending && (
        <div className="terms-pending">
          <h3 className="lead-panel__sub">{pendingTermsLine(pending.effectiveFrom)}</h3>
          <TermsList t={pending} currency={data.plan.currency} />
        </div>
      )}
    </section>
  );
}

function StatusPanel({ data }: { data: CarePlanPage }) {
  return (
    <section className="lead-panel" aria-labelledby="status-h">
      <h2 id="status-h" className="lead-panel__title">
        Status history
      </h2>
      <ol className="status-log">
        {data.statusLog.map((s) => (
          <li key={`${s.effectiveOn}-${s.createdAt}`} className="status-log__item">
            <CarePill status={s.status} />
            <span className="status-log__when">
              <span className="visually-hidden">From </span>
              <Day iso={s.effectiveOn} />
            </span>
            {/* When it was recorded, only when that isn't the day it took effect (one date, not the same one twice). */}
            {toIsoDate(istDate(s.createdAt)) !== s.effectiveOn && <When ms={s.createdAt} inline />}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---- status moves ---------------------------------------------------------------------------------------------------------------

const MOVE_LABELS: Record<CareStatus, string> = {
  paused: "Pause the plan",
  active: "Resume the plan",
  cancelled: "Cancel the plan",
};

function StatusMoves(props: {
  data: CarePlanPage;
  name: string;
  canCancel: boolean;
  live: boolean;
  onStale: () => void;
  onFailure: (text: string | null) => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { plan } = props.data;
  // An anonymised client's plan may only be wound down (cancelled); nothing else is offered.
  const moves = careMoves(plan.status, props.canCancel).filter((to) => props.live || to === "cancelled");
  const [asking, setAsking] = useState<CareStatus | null>(null);
  const date = statusDate(props.data.today, plan);

  async function move(to: CareStatus) {
    try {
      await api.setCareStatus(plan.id, to, plan.updatedAt);
    } catch (e) {
      if (e instanceof RequestError && e.code === "stale_version") {
        props.onStale();
        return;
      }
      throw new RequestError(
        e instanceof RequestError ? e.status : 0,
        e instanceof RequestError ? e.code : "network",
        careErrorText(e, { from: plan.status, to }),
      );
    }
    props.onFailure(null);
    toast("success", statusToast(to));
    props.onDone();
  }

  if (!moves.length) return null;
  const sentenceFor = (to: CareStatus) =>
    to === "paused"
      ? pauseConfirm(props.name, date)
      : to === "active"
        ? resumeConfirm(props.name, date)
        : cancelPlanConfirm(props.name, date);
  return (
    <>
      <MenuButton
        label={`Change the status of ${props.name}`}
        text="Change status"
        icon={<ChevronDown size={16} />}
        items={moves.map((to) => ({
          label: MOVE_LABELS[to],
          tone: to === "cancelled" ? ("danger" as const) : undefined,
          onSelect: () => setAsking(to),
        }))}
      />
      <ConfirmDialog
        open={asking !== null}
        title={asking ? MOVE_LABELS[asking] : ""}
        tone={asking === "cancelled" ? "danger" : "default"}
        confirmLabel={asking ? MOVE_LABELS[asking] : ""}
        onClose={() => setAsking(null)}
        onConfirm={async () => {
          if (asking) await move(asking);
          return undefined;
        }}
      >
        <p>{asking ? <KeepDates text={sentenceFor(asking)} /> : ""}</p>
        {asking && (
          <p className="confirm-move">
            <CarePill status={plan.status} />
            <span className="visually-hidden">to</span>
            <span aria-hidden="true" className="confirm-move__to">
              to
            </span>
            <CarePill status={asking} />
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

// ---- the terms change (owner) -----------------------------------------------------------------------------------------------

function TermsChange(props: { data: CarePlanPage; name: string; onStale: () => void; onDone: () => void }) {
  const toast = useToast();
  const { plan } = props.data;
  const newest = newestTerms(props.data.terms);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<TermsForm | null>(null);
  const [errors, setErrors] = useState<Parameters<typeof TermsFields>[0]["errors"]>({});
  const [review, setReview] = useState<{ body: object; changes: TermChange[] } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const date = termsDate(props.data.today, plan);
  // The review replaces the form under the focused button: the title takes focus so the summary is read next.
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (review) titleRef.current?.focus();
  }, [review]);

  if (!newest) return null;

  function start() {
    if (!newest) return;
    setF(termsFormOf(newest, plan.currency));
    setErrors({});
    setReview(null);
    setFailure(null);
    setOpen(true);
  }

  function next(e: FormEvent) {
    e.preventDefault();
    if (!f || !newest) return;
    const r = termsChange(f, newest, plan.currency);
    if (!r.ok) {
      setErrors(r.errors);
      const first = Object.keys(r.errors)[0];
      if (first) document.getElementById(`tc-${first}`)?.focus();
      return;
    }
    setErrors({});
    if (!r.changes.length) {
      setFailure(CARE_PENDING.noTermsChange);
      return;
    }
    setFailure(null);
    setReview({ body: r.body, changes: r.changes });
  }

  async function confirm() {
    if (!review) return;
    setBusy(true);
    setFailure(null);
    try {
      const r = await api.changeCareTerms(plan.id, { ...review.body, expectedUpdatedAt: plan.updatedAt });
      setOpen(false);
      toast("success", CARE_TOASTS.termsChanged(r.effectiveFrom ?? date));
      props.onDone();
    } catch (e) {
      if (e instanceof RequestError && e.code === "stale_version") {
        setOpen(false);
        props.onStale();
      } else setFailure(careErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn--secondary" onClick={start}>
        <Pencil size={20} />
        Change terms
      </button>
      <Modal
        open={open}
        title={review ? "Confirm the new terms" : "Change terms"}
        onClose={() => setOpen(false)}
        busy={busy}
        wide
        titleRef={review ? titleRef : undefined}
      >
        {review ? (
          <>
            <div className="dialog__body">
              <p>{termsConfirm(props.name, date)}</p>
              <table className="terms-diff">
                <caption className="visually-hidden">What changes</caption>
                <thead>
                  <tr>
                    <th scope="col" className="terms-diff__cell terms-diff__head">
                      Term
                    </th>
                    <th scope="col" className="terms-diff__cell terms-diff__head">
                      Now
                    </th>
                    <th scope="col" className="terms-diff__cell terms-diff__head">
                      From <Day iso={date} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {review.changes.map((c) => (
                    <tr key={c.field}>
                      <th scope="row" className="terms-diff__cell terms-diff__term">
                        {c.field}
                      </th>
                      <td className="tnum terms-diff__cell">{c.from}</td>
                      <td className="tnum terms-diff__cell terms-diff__to">{c.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint">{CARE_COPY.beforeGst}</p>
            </div>
            {failure && <Notice tone="error">{failure}</Notice>}
            <div className="dialog__actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setReview(null)}
                disabled={busy}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={confirm}
                disabled={busy}
                aria-busy={busy || undefined}
              >
                {busy ? "Changing…" : "Change terms"}
              </button>
            </div>
          </>
        ) : (
          f && (
            <form onSubmit={next} noValidate className="terms-form">
              <div className="dialog__body">
                <p className="hint">{pendingTermsLine(date)}</p>
                {failure && <Notice tone="error">{failure}</Notice>}
                <TermsFields
                  prefix="tc"
                  focusTier
                  value={f}
                  currency={plan.currency}
                  errors={errors}
                  onChange={(p) => setF((x) => (x ? { ...x, ...p } : x))}
                />
              </div>
              <div className="dialog__actions">
                <button type="button" className="btn btn--secondary" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary">
                  Review the change
                </button>
              </div>
            </form>
          )
        )}
      </Modal>
    </>
  );
}

function PlanSkeleton() {
  return (
    <>
      <PageHeader title="Care plan" crumbs={CARE_CRUMBS} />
      <p className="visually-hidden" role="status">
        Loading the care plan
      </p>
      <div className="client-strip client-strip--skeleton" aria-hidden="true">
        <Skeleton width="60%" />
      </div>
      <div className="lead-page" aria-hidden="true">
        <div className="lead-page__main">
          <div className="lead-panel stack-sm">
            <Skeleton width="35%" />
            <Skeleton width="100%" />
            <Skeleton width="70%" />
          </div>
          <div className="lead-panel stack-sm">
            <Skeleton width="25%" />
            <Skeleton width="90%" />
            <Skeleton width="90%" />
          </div>
        </div>
        <div className="lead-page__side">
          <div className="lead-panel stack-sm">
            <Skeleton width="40%" />
            <Skeleton width="70%" />
          </div>
        </div>
      </div>
    </>
  );
}
