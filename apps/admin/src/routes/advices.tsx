// Remittance advices (M6.4; run file G5; ADM-INV-17, L12, L30): the archive of the papers that prove export money arrived: PayPal's FIRAs, Stripe's settlement
// reports and payment advices, the bank's FIRCs and BRCs. One advice proves many payments (Settled by the lead on the safest reading, 2026-10-30 (08-C RB-05)),
// so the page has two lists: the advices (newest first, keyset) and the confirmed payments no advice proves yet ("Without advice", one gateway at a time, its
// count on the tab and on Payments' link here). An advice opens in a dialog from `?advice=<id>` (the payment's entry and the bells link there): its facts,
// its file (set once), the payments on it (links taken off stay, with the Owner's reason), "Link payments" (1 to 50 at a time, Owner and Staff) and "Remove
// link" (the Owner, with a reason of 1 to 200 characters). The S9 bell lands on `?tab=without` (PayPal). Money is formatted only through core.
import "./invoices/parts.tsx";
import "../payments.css";
import { ANONYMISED_CLIENT } from "@techaust/core/clients";
import { istDate, toIsoDate } from "@techaust/core/dates";
import type { Role } from "@techaust/core/permissions";
import { useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  type AdviceKind,
  type AdvicePayment,
  type AdviceProvider,
  type PaymentWithoutAdvice,
  paymentsApi,
  type RemittanceAdvice,
  sha256Hex,
  uploadPaymentDoc,
  type WithoutAdviceProvider,
} from "../api.ts";
import { type Column, DataTable } from "../components/data-table.tsx";
import { DateField, useUnreadDates } from "../components/date-field.tsx";
import { Modal, useRefusalFocus } from "../components/dialog.tsx";
import { EmptyState, PageHeader, When } from "../components/display.tsx";
import { FormField } from "../components/form.tsx";
import { CheckCircle, FileText, Plus } from "../components/icons.tsx";
import { LoadFailed, NoAccess, useLoad } from "../components/states.tsx";
import { Tabs } from "../components/tabs.tsx";
import { useToast } from "../components/toast.tsx";
import { Notice } from "../components/ui.tsx";
import { allowed } from "../lib/access.ts";
import {
  ADVICE_LINK_MAX,
  type AdviceForm,
  type AdviceFormErrors,
  adviceErrorText,
  firstAdviceError,
  KINDS_FOR,
  periodText,
  readAdviceForm,
  toggled,
  withAll,
  withoutProviderOf,
} from "../lib/advices.ts";
import {
  ADVICE_KIND_LABELS,
  ADVICE_PROVIDER_LABELS,
  WITHOUT_PROVIDER_LABELS,
  ZN,
  ZN_UI,
} from "../lib/copy-zn.ts";
import { INV_COPY } from "../lib/invoices.ts";
import { amountText, PAY_COPY, PAY_UI } from "../lib/payments.ts";
import { useUser } from "../session.tsx";
import { day, FilePick } from "./payments/parts.tsx";

export function Component() {
  const user = useUser();
  if (!allowed(user.role, "payments.read")) return <NoAccess what={ZN.advices} />;
  return <Advices role={user.role} />;
}

type Tab = "advices" | "without";
const WITHOUT: WithoutAdviceProvider[] = ["paypal", "stripe", "manual"];
const isWithout = (v: string | null): v is WithoutAdviceProvider =>
  WITHOUT.includes(v as WithoutAdviceProvider);
const CRUMBS = [{ label: PAY_COPY.heading, to: "/payments" }];

function Advices({ role }: { role: Role }) {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "without" ? "without" : "advices";
  const provider: WithoutAdviceProvider = isWithout(params.get("provider"))
    ? (params.get("provider") as WithoutAdviceProvider)
    : "paypal";
  const opened = params.get("advice");
  const canAdd = allowed(role, "payments.attachProof");
  const [adding, setAdding] = useState(false);
  // Bumped after a change: the lists and the tab's count read again.
  const [changes, setChanges] = useState(0);
  // The tab's count: PayPal's payments without an advice (the S9 reminder's subject); a failed read shows no badge.
  const payPal = useLoad(() => paymentsApi.withoutAdvice("paypal"), `paypal:${changes}`);
  const n = payPal.state === "ready" ? payPal.data.count : 0;

  const set = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === "") next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader
        title={ZN.advices}
        crumbs={CRUMBS}
        lede={ZN.advicesLede}
        action={
          canAdd ? (
            <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
              <Plus size={20} />
              {ZN.addAdvice}
            </button>
          ) : undefined
        }
      />
      <Tabs
        label={ZN.advices}
        tabs={[
          { key: "advices", label: ZN_UI.tabAdvices },
          {
            key: "without",
            label: ZN.withoutAdvice,
            badge: n > 0 ? { text: n > 99 ? "99+" : String(n), label: ZN_UI.withoutCount(n) } : null,
          },
        ]}
        selected={tab}
        onSelect={(k) => set({ tab: k === "advices" ? null : k, provider: null })}
      >
        {tab === "advices" ? (
          <AdviceList key={`a:${changes}`} canAdd={canAdd} onAdd={() => setAdding(true)} />
        ) : (
          <WithoutList
            key={`w:${provider}:${changes}`}
            provider={provider}
            onProvider={(p) => set({ provider: p === "paypal" ? null : p })}
          />
        )}
      </Tabs>
      {adding && (
        <AddAdviceDialog
          onClose={() => setAdding(false)}
          onDone={(id) => {
            setAdding(false);
            setChanges((c) => c + 1);
            // the new advice opens, so its payments can be linked at once
            set({ advice: id, tab: null });
          }}
        />
      )}
      {opened && (
        <AdviceDialog
          id={opened}
          role={role}
          onClose={() => set({ advice: null })}
          onChanged={() => setChanges((c) => c + 1)}
        />
      )}
    </>
  );
}

/** The advice's kind and reference, as the paper prints them. */
function AdviceName({ a }: { a: Pick<RemittanceAdvice, "kind" | "advice_ref"> }) {
  return (
    <span className="adv-name">
      <span className="adv-kind">{ADVICE_KIND_LABELS[a.kind] ?? a.kind}</span>
      <span className="docno break">{a.advice_ref}</span>
    </span>
  );
}

/** A keyset list's pages: the first from `useLoad`, the rest kept here; an empty page ends it. */
function usePages<T, R extends { next: string | null }>(
  first: R | null,
  rowsOf: (r: R) => T[],
  read: (after: string) => Promise<R>,
  onError: (e: unknown) => void,
) {
  const [more, setMore] = useState<T[]>([]);
  const [after, setAfter] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const rows = [...(first ? rowsOf(first) : []), ...more];
  const next = after === undefined ? (first?.next ?? null) : after;
  async function showMore() {
    if (!next) return;
    setBusy(true);
    try {
      const r = await read(next);
      const got = rowsOf(r);
      setMore((m) => [...m, ...got]);
      setAfter(got.length > 0 ? r.next : null);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return { rows, next, busy, showMore };
}

function MoreButton(props: { next: string | null; busy: boolean; onMore: () => void }) {
  if (!props.next) return null;
  return (
    <button
      type="button"
      className="btn btn--secondary notes__more"
      onClick={props.onMore}
      disabled={props.busy}
      aria-busy={props.busy || undefined}
    >
      {props.busy ? "Loading…" : ZN_UI.showMore}
    </button>
  );
}

function AdviceList(props: { canAdd: boolean; onAdd: () => void }) {
  const toast = useToast();
  const list = useLoad(() => paymentsApi.advices(), "advices");
  const pages = usePages(
    list.state === "ready" ? list.data : null,
    (r) => r.items,
    (after) => paymentsApi.advices(after),
    (e) => toast("error", adviceErrorText(e)),
  );
  const href = (id: string) => `/payments/advices?advice=${encodeURIComponent(id)}`;
  const columns: Column<RemittanceAdvice>[] = [
    {
      key: "issued",
      header: ZN_UI.colIssued,
      card: "title",
      cell: (a) => (
        <Link to={href(a.id)} className="tnum pay-row__link">
          {day(a.issued_on)}
        </Link>
      ),
    },
    { key: "advice", header: ZN_UI.colAdvice, cell: (a) => <AdviceName a={a} /> },
    { key: "from", header: ZN_UI.colGateway, cell: (a) => ADVICE_PROVIDER_LABELS[a.provider] ?? a.provider },
    {
      key: "period",
      header: ZN_UI.colPeriod,
      cell: (a) => (
        <span className="tnum adv-period">{periodText(a.period_from, a.period_to, day) ?? "–"}</span>
      ),
    },
    {
      key: "payments",
      header: ZN_UI.colPayments,
      align: "end",
      cell: (a) => <span className="tnum">{a.linked ?? 0}</span>,
    },
    {
      key: "file",
      header: ZN_UI.colFile,
      cell: (a) =>
        a.file_r2_key ? (
          <a href={paymentsApi.adviceFileHref(a.id)} className="pay-proof-link">
            <FileText size={16} />
            {ZN_UI.openFile}
            <span className="visually-hidden">{` ${a.advice_ref}`}</span>
          </a>
        ) : (
          <span className="pay-badge">{ZN_UI.fileAwaited}</span>
        ),
    },
  ];
  if (list.state === "failed") return <LoadFailed error={list.error} onRetry={() => list.reload()} />;
  return (
    <>
      <div className="clients-table pay-table adv-table">
        <DataTable
          caption={ZN.advices}
          columns={columns}
          rows={pages.rows}
          rowKey={(a) => a.id}
          loading={list.state === "loading"}
          skeletonRows={4}
          actions={(a) => (
            <Link to={href(a.id)} className="btn btn--secondary">
              {ZN_UI.open}
              <span className="visually-hidden">{` ${ADVICE_KIND_LABELS[a.kind]} ${a.advice_ref}`}</span>
            </Link>
          )}
          empty={
            <EmptyState
              icon={<FileText />}
              title={ZN.noAdvices.replace(/\.$/, "")}
              action={
                props.canAdd ? (
                  <button type="button" className="btn btn--secondary" onClick={props.onAdd}>
                    <Plus size={20} />
                    {ZN.addAdvice}
                  </button>
                ) : undefined
              }
            >
              {null}
            </EmptyState>
          }
        />
      </div>
      <MoreButton next={pages.next} busy={pages.busy} onMore={() => void pages.showMore()} />
    </>
  );
}

/** The client's name, or "Anonymised client" once erased (the advice keeps the payment, RB-40 note). */
const clientText = (name: string | null) => name ?? ANONYMISED_CLIENT;
/** A payment's own reference: the gateway's id (PayPal's capture, Stripe's payment), else the ledger's normalised one. */
const refOf = (r: { provider_payment_id?: string | null; reference_norm: string | null }) =>
  r.provider_payment_id ?? r.reference_norm ?? "";

function WithoutList(props: {
  provider: WithoutAdviceProvider;
  onProvider: (p: WithoutAdviceProvider) => void;
}) {
  const toast = useToast();
  const legend = useId();
  const list = useLoad(() => paymentsApi.withoutAdvice(props.provider), props.provider);
  const pages = usePages(
    list.state === "ready" ? list.data : null,
    (r) => r.items,
    (after) => paymentsApi.withoutAdvice(props.provider, after),
    (e) => toast("error", adviceErrorText(e)),
  );
  const columns: Column<PaymentWithoutAdvice>[] = [
    {
      key: "received",
      header: ZN_UI.colReceived,
      card: "title",
      cell: (r) => (
        <Link to={`/payments/${encodeURIComponent(r.id)}`} className="tnum pay-row__link">
          {day(r.received_on)}
        </Link>
      ),
    },
    { key: "client", header: ZN_UI.colClient, width: "30%", cell: (r) => clientText(r.client_name) },
    { key: "ref", header: ZN_UI.colReference, cell: (r) => <span className="docno break">{refOf(r)}</span> },
    {
      key: "amount",
      header: ZN_UI.colAmount,
      align: "end",
      cell: (r) => <span className="tnum pay-lines__nowrap">{amountText(r.amount_minor, r.currency)}</span>,
    },
  ];
  return (
    <div className="adv-without">
      <div className="adv-without__head">
        <fieldset className="segmented adv-without__pick" aria-labelledby={legend}>
          <legend id={legend} className="visually-hidden">
            {ZN_UI.colGateway}
          </legend>
          {WITHOUT.map((p) => (
            <label key={p} className="segmented__opt">
              <input
                type="radio"
                name="adv-without"
                checked={props.provider === p}
                onChange={() => props.onProvider(p)}
              />
              {WITHOUT_PROVIDER_LABELS[p]}
            </label>
          ))}
        </fieldset>
        <p className="adv-without__lede">
          {list.state === "ready" && list.data.count > 0 && (
            <strong className="tnum">{`${ZN_UI.withoutCount(list.data.count)}. `}</strong>
          )}
          {ZN_UI.withoutLede}
        </p>
      </div>
      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="clients-table pay-table">
          <DataTable
            caption={`${ZN.withoutAdvice}: ${WITHOUT_PROVIDER_LABELS[props.provider]}`}
            columns={columns}
            rows={pages.rows}
            rowKey={(r) => r.id}
            loading={list.state === "loading"}
            skeletonRows={4}
            empty={
              <EmptyState icon={<CheckCircle />} title={ZN_UI.noneWithout.replace(/\.$/, "")}>
                {null}
              </EmptyState>
            }
          />
        </div>
      )}
      <MoreButton next={pages.next} busy={pages.busy} onMore={() => void pages.showMore()} />
    </div>
  );
}

// ---- Add advice ------------------------------------------------------------------------------------------------------------------------------------------

const PROVIDERS: AdviceProvider[] = ["paypal", "stripe", "bank"];

function AddAdviceDialog(props: { onClose: () => void; onDone: (id: string) => void }) {
  const toast = useToast();
  const [form, setForm] = useState<AdviceForm>({
    provider: "paypal",
    kind: "fira",
    ref: "",
    issuedOn: "",
    periodFrom: "",
    periodTo: "",
    inrTotal: "",
    note: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<AdviceFormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dates = useUnreadDates<"issuedOn" | "periodFrom" | "periodTo">();
  const refusal = useRefusalFocus();
  const today = toIsoDate(istDate(Date.now()));
  const ids = {
    ref: "adv-ref",
    issuedOn: "adv-issued",
    periodFrom: "adv-from",
    periodTo: "adv-to",
    inrTotal: "adv-inr",
  } as const;

  async function submit() {
    setFailure(null);
    const r = readAdviceForm(form, dates.unread, today);
    if (!r.ok) {
      setErrors(r.errors);
      const first = firstAdviceError(r.errors);
      if (first) document.getElementById(ids[first])?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const made = await paymentsApi.createAdvice(r.body);
      let said: string = ZN_UI.added;
      if (file) {
        try {
          await uploadPaymentDoc({ adviceOf: made.id }, file, await sha256Hex(file), () => {});
        } catch (err) {
          // the advice stands; its file can be attached from its own dialog
          said = `${said} ${adviceErrorText(err)}`;
        }
      }
      toast("success", said);
      props.onDone(made.id);
    } catch (err) {
      setFailure(adviceErrorText(err));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }

  const kinds = KINDS_FOR[form.provider];
  return (
    <Modal open title={ZN.addAdvice} onClose={props.onClose} busy={busy} className="dialog--pay">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="dialog__body pay-form">
          <p className="form-intro hint">{ZN_UI.formIntro}</p>
          <fieldset className="adv-who" disabled={busy}>
            <legend>{ZN_UI.provider}</legend>
            <div className="segmented">
              {PROVIDERS.map((p) => (
                <label key={p} className="segmented__opt">
                  <input
                    type="radio"
                    name="adv-provider"
                    checked={form.provider === p}
                    onChange={() => setForm({ ...form, provider: p, kind: KINDS_FOR[p][0] as AdviceKind })}
                  />
                  {ADVICE_PROVIDER_LABELS[p]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="form-grid">
            <FormField id="adv-kind" label={ZN_UI.kind}>
              {(a) => (
                <select
                  {...a}
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value as AdviceKind })}
                >
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {ADVICE_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField id={ids.ref} label={ZN_UI.ref} hint={ZN_UI.refHint} error={errors.ref}>
              {(a) => (
                <input
                  {...a}
                  maxLength={64}
                  autoComplete="off"
                  spellCheck={false}
                  value={form.ref}
                  onChange={(e) => setForm({ ...form, ref: e.target.value })}
                />
              )}
            </FormField>
          </div>
          <FormField id={ids.issuedOn} label={ZN_UI.issuedOn} error={errors.issuedOn}>
            {(a) => (
              <DateField
                {...a}
                {...dates.bind("issuedOn")}
                value={form.issuedOn}
                max={today}
                onChange={(v) => setForm({ ...form, issuedOn: v })}
              />
            )}
          </FormField>
          <div className="form-grid">
            <FormField id={ids.periodFrom} label={ZN_UI.periodFromLabel} optional error={errors.periodFrom}>
              {(a) => (
                <DateField
                  {...a}
                  {...dates.bind("periodFrom")}
                  value={form.periodFrom}
                  onChange={(v) => setForm({ ...form, periodFrom: v })}
                />
              )}
            </FormField>
            <FormField id={ids.periodTo} label={ZN_UI.periodToLabel} optional error={errors.periodTo}>
              {(a) => (
                <DateField
                  {...a}
                  {...dates.bind("periodTo")}
                  value={form.periodTo}
                  min={form.periodFrom || undefined}
                  onChange={(v) => setForm({ ...form, periodTo: v })}
                />
              )}
            </FormField>
          </div>
          <FormField
            id={ids.inrTotal}
            label={ZN_UI.inrTotal}
            optional
            hint={ZN_UI.inrTotalHint}
            error={errors.inrTotal}
          >
            {(a) => (
              <div className="money-in">
                <span aria-hidden="true">₹</span>
                <input
                  {...a}
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.inrTotal}
                  onChange={(e) => setForm({ ...form, inrTotal: e.target.value })}
                />
              </div>
            )}
          </FormField>
          <FilePick id="adv-file" label={ZN_UI.file} file={file} onFile={setFile} optional />
          <FormField id="adv-note" label={ZN_UI.note} optional>
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
        </div>
        {failure && (
          <Notice tone="error" ref={refusal.ref}>
            {failure}
          </Notice>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
            {INV_COPY.cancel}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Working…" : ZN.addAdvice}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---- one advice ------------------------------------------------------------------------------------------------------------------------------------------

type Step =
  | { kind: "view" }
  | { kind: "file" }
  | { kind: "link" }
  | { kind: "remove"; payment: AdvicePayment };

function AdviceDialog(props: { id: string; role: Role; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const loaded = useLoad(() => paymentsApi.advice(props.id), `${props.id}:${version}`);
  const [step, setStep] = useState<Step>({ kind: "view" });
  const titleRef = useRef<HTMLHeadingElement>(null);
  const go = (s: Step) => {
    setStep(s);
    requestAnimationFrame(() => titleRef.current?.focus());
  };
  /** A change landed: say so, read the advice again, back to its view. */
  const done = (said: string) => {
    toast("success", said);
    setVersion((v) => v + 1);
    props.onChanged();
    go({ kind: "view" });
  };
  const title =
    step.kind === "file"
      ? ZN_UI.attachFile
      : step.kind === "link"
        ? ZN.linkPayments
        : step.kind === "remove"
          ? ZN.removeLink
          : ZN_UI.detailTitle;
  return (
    <Modal
      open
      title={title}
      onClose={props.onClose}
      titleRef={titleRef}
      className="dialog--pay dialog--advice"
      tone={step.kind === "remove" ? "danger" : "default"}
    >
      {loaded.state === "loading" ? (
        <div className="dialog__body" aria-busy="true">
          <span className="skeleton" style={{ width: "50%" }} />
          <span className="skeleton" style={{ width: "80%" }} />
          <span className="skeleton" style={{ width: "65%" }} />
        </div>
      ) : loaded.state === "failed" ? (
        <>
          <LoadFailed error={loaded.error} onRetry={() => loaded.reload()} headingLevel={3} />
          <div className="dialog__actions">
            <button type="button" className="btn btn--secondary" onClick={props.onClose}>
              {ZN_UI.close}
            </button>
          </div>
        </>
      ) : step.kind === "view" ? (
        <AdviceView data={loaded.data} role={props.role} onStep={go} onClose={props.onClose} />
      ) : step.kind === "file" ? (
        <FileStep id={props.id} onBack={() => go({ kind: "view" })} onDone={() => done(ZN_UI.fileSaved)} />
      ) : step.kind === "link" ? (
        <LinkStep
          advice={loaded.data.advice}
          onBack={() => go({ kind: "view" })}
          onDone={(n) => done(ZN_UI.linked(n))}
        />
      ) : (
        <RemoveStep
          adviceId={props.id}
          payment={step.payment}
          onBack={() => go({ kind: "view" })}
          onDone={() => done(ZN_UI.removed)}
        />
      )}
    </Modal>
  );
}

function AdviceView(props: {
  data: Awaited<ReturnType<typeof paymentsApi.advice>>;
  role: Role;
  onStep: (s: Step) => void;
  onClose: () => void;
}) {
  const a = props.data.advice;
  const toast = useToast();
  const canAttach = allowed(props.role, "payments.attachProof");
  const owner = allowed(props.role, "payments.adviceUnlink");
  const pages = usePages(
    props.data,
    (r) => r.payments,
    (after) => paymentsApi.advice(a.id, after),
    (e) => toast("error", adviceErrorText(e)),
  );
  const period = periodText(a.period_from, a.period_to, day);
  const on = pages.rows.filter((r) => r.removed_at === null);
  const off = pages.rows.filter((r) => r.removed_at !== null);
  return (
    <>
      <div className="dialog__body pay-entry adv-entry">
        <div className="adv-entry__head">
          <AdviceName a={a} />
          <span className="pay-lines__meta">{ADVICE_PROVIDER_LABELS[a.provider] ?? a.provider}</span>
        </div>
        <dl className="inv-facts pay-entry__facts">
          <div>
            <dt>{ZN_UI.issuedOn}</dt>
            <dd className="tnum">{day(a.issued_on)}</dd>
          </div>
          {period && (
            <div>
              <dt>{ZN_UI.colPeriod}</dt>
              <dd className="tnum">{period}</dd>
            </div>
          )}
          {a.inr_total_minor !== null && (
            <div>
              <dt>{ZN_UI.inrTotal}</dt>
              <dd className="tnum">{amountText(a.inr_total_minor, "INR")}</dd>
            </div>
          )}
          <div>
            <dt>{ZN_UI.colFile}</dt>
            <dd>
              {a.file_r2_key ? (
                <a href={paymentsApi.adviceFileHref(a.id)} className="pay-proof-link">
                  <FileText size={16} />
                  {ZN_UI.openFile}
                </a>
              ) : (
                <span className="pay-badge">{ZN_UI.fileAwaited}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{ZN_UI.recorded}</dt>
            <dd>
              <When ms={a.created_at} inline />
            </dd>
          </div>
          {a.note && (
            <div className="inv-facts__wide">
              <dt>{ZN_UI.note}</dt>
              <dd className="break">{a.note}</dd>
            </div>
          )}
        </dl>
        <div className="adv-payments">
          <h3 className="pay-sub">{ZN_UI.onAdvice}</h3>
          {on.length === 0 && off.length === 0 ? (
            <p className="pay-lines__meta">{ZN_UI.noneLinked}</p>
          ) : (
            <ul className="adv-payments__list">
              {[...on, ...off].map((r) => (
                <li
                  key={`${r.payment_id}:${r.created_at}`}
                  className={r.removed_at ? "adv-pay adv-pay--off" : "adv-pay"}
                >
                  <span className="adv-pay__what">
                    <Link to={`/payments/${encodeURIComponent(r.payment_id)}`} className="tnum pay-row__link">
                      {day(r.received_on)}
                    </Link>
                    <span className="pay-lines__meta">
                      {clientText(r.client_name)} · <span className="docno break">{refOf(r)}</span>
                    </span>
                    {r.removed_at !== null && (
                      <span className="pay-lines__meta adv-pay__removed">
                        {ZN_UI.removedLine(formatDay(r.removed_at), r.remove_reason ?? "")}
                      </span>
                    )}
                  </span>
                  <span className="tnum adv-pay__amount">{amountText(r.amount_minor, r.currency)}</span>
                  {r.removed_at === null && owner ? (
                    <button
                      type="button"
                      className="btn btn--text adv-pay__remove"
                      onClick={() => props.onStep({ kind: "remove", payment: r })}
                    >
                      {ZN.removeLink}
                      <span className="visually-hidden">{` ${day(r.received_on)} ${amountText(r.amount_minor, r.currency)}`}</span>
                    </button>
                  ) : r.removed_at !== null ? (
                    <span className="pay-badge adv-pay__tag">{ZN_UI.removedTag}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <MoreButton next={pages.next} busy={pages.busy} onMore={() => void pages.showMore()} />
        </div>
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose}>
          {ZN_UI.close}
        </button>
        {canAttach && !a.file_r2_key && (
          <button type="button" className="btn btn--secondary" onClick={() => props.onStep({ kind: "file" })}>
            {ZN_UI.attachFile}
          </button>
        )}
        {canAttach && (
          <button type="button" className="btn btn--primary" onClick={() => props.onStep({ kind: "link" })}>
            {ZN.linkPayments}
          </button>
        )}
      </div>
    </>
  );
}

/** A moment as its IST day ("2 Nov 2026"): the day a link was taken off. */
const formatDay = (ms: number) => day(toIsoDate(istDate(ms)));

function FileStep(props: { id: string; onBack: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = useRefusalFocus();
  async function submit() {
    if (!file) {
      setError(PAY_UI.proofFileHint);
      document.getElementById("adv-file-step")?.focus();
      return;
    }
    setError(null);
    setFailure(null);
    setBusy(true);
    try {
      await uploadPaymentDoc({ adviceOf: props.id }, file, await sha256Hex(file), () => {});
      props.onDone();
    } catch (e) {
      setFailure(adviceErrorText(e));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="dialog__body pay-form">
        <FilePick id="adv-file-step" label={ZN_UI.file} file={file} onFile={setFile} error={error} />
      </div>
      {failure && (
        <Notice tone="error" ref={refusal.ref}>
          {failure}
        </Notice>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onBack} disabled={busy}>
          {INV_COPY.cancel}
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Working…" : ZN_UI.attachFile}
        </button>
      </div>
    </form>
  );
}

/**
 * "Link payments": the confirmed payments of the advice's own gateway (a bank advice: bank transfers from abroad, L30) that no advice proves yet, as a
 * DataTable with a checkbox in each row's first cell, at most 50 picked at once (the route's limit). All or none: a refusal names the first reason.
 */
function LinkStep(props: { advice: RemittanceAdvice; onBack: () => void; onDone: (n: number) => void }) {
  const toast = useToast();
  const provider = withoutProviderOf(props.advice.provider);
  const list = useLoad(() => paymentsApi.withoutAdvice(provider), provider);
  const pages = usePages(
    list.state === "ready" ? list.data : null,
    (r) => r.items,
    (after) => paymentsApi.withoutAdvice(provider, after),
    (e) => toast("error", adviceErrorText(e)),
  );
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = useRefusalFocus();
  const who = ZN_UI.linkWho[props.advice.provider];

  function tick(id: string) {
    const r = toggled(picked, id);
    setPicked(r.picked);
    setNote(r.refused ? ZN_UI.atMost(ADVICE_LINK_MAX) : null);
  }

  async function submit() {
    if (picked.length === 0) {
      setNote(ZN_UI.pickOne);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const r = await paymentsApi.linkAdvice(props.advice.id, picked);
      props.onDone(r.linked);
    } catch (e) {
      setFailure(adviceErrorText(e));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<PaymentWithoutAdvice>[] = [
    {
      key: "pick",
      header: ZN_UI.colReceived,
      card: "title",
      cell: (r) => (
        <label className="adv-pick">
          <input
            type="checkbox"
            checked={picked.includes(r.id)}
            onChange={() => tick(r.id)}
            disabled={busy}
          />
          <span className="tnum">{day(r.received_on)}</span>
          <span className="visually-hidden">{` ${clientText(r.client_name)} ${amountText(r.amount_minor, r.currency)}`}</span>
        </label>
      ),
    },
    { key: "client", header: ZN_UI.colClient, cell: (r) => clientText(r.client_name) },
    { key: "ref", header: ZN_UI.colReference, cell: (r) => <span className="docno break">{refOf(r)}</span> },
    {
      key: "amount",
      header: ZN_UI.colAmount,
      align: "end",
      cell: (r) => <span className="tnum pay-lines__nowrap">{amountText(r.amount_minor, r.currency)}</span>,
    },
  ];
  const shown = pages.rows.map((r) => r.id);
  const allShown = shown.length > 0 && shown.every((id) => picked.includes(id));
  // Review 2 finding 10: with nothing to pick (the empty state, or a list that didn't load) the dialog offers only the way back, never a dead primary button.
  const nothingToLink = list.state !== "loading" && shown.length === 0;
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="dialog__body pay-form">
        <div className="adv-entry__head">
          <AdviceName a={props.advice} />
        </div>
        <p className="pay-form__lede">{ZN_UI.linkLede(who)}</p>
        {list.state === "failed" ? (
          <LoadFailed error={list.error} onRetry={() => list.reload()} headingLevel={3} />
        ) : (
          <>
            {shown.length > 0 && (
              <div className="adv-pickbar">
                <button
                  type="button"
                  className="btn btn--text"
                  onClick={() => {
                    setPicked(allShown ? [] : withAll(picked, shown));
                    setNote(
                      !allShown && shown.length + picked.length > ADVICE_LINK_MAX
                        ? ZN_UI.atMost(ADVICE_LINK_MAX)
                        : null,
                    );
                  }}
                  disabled={busy}
                >
                  {allShown ? ZN_UI.clearAll : ZN_UI.selectAll}
                </button>
                <span className="tnum adv-pickbar__count" role="status">
                  {ZN_UI.selected(picked.length)}
                </span>
              </div>
            )}
            <div className="clients-table pay-table adv-linktable">
              <DataTable
                caption={ZN.linkPayments}
                columns={columns}
                rows={pages.rows}
                rowKey={(r) => r.id}
                loading={list.state === "loading"}
                skeletonRows={3}
                empty={
                  <EmptyState
                    icon={<CheckCircle />}
                    title={ZN_UI.noneToLink.replace(/\.$/, "")}
                    headingLevel={3}
                  >
                    {null}
                  </EmptyState>
                }
              />
            </div>
            <MoreButton next={pages.next} busy={pages.busy} onMore={() => void pages.showMore()} />
          </>
        )}
        {note && (
          <p className="hint adv-pick__note" role="status">
            {note}
          </p>
        )}
      </div>
      {failure && (
        <Notice tone="error" ref={refusal.ref}>
          {failure}
        </Notice>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onBack} disabled={busy}>
          {INV_COPY.cancel}
        </button>
        {!nothingToLink && (
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || picked.length === 0}
            aria-busy={busy || undefined}
          >
            {busy
              ? "Working…"
              : picked.length > 0
                ? ZN_UI.pick(ZN_UI.paymentsCount(picked.length))
                : ZN.linkPayments}
          </button>
        )}
      </div>
    </form>
  );
}

/** "Remove link" (the Owner): a reason of 1 to 200 characters; the link stays in the advice's history with it. */
function RemoveStep(props: {
  adviceId: string;
  payment: AdvicePayment;
  onBack: () => void;
  onDone: () => void;
}) {
  const p = props.payment;
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = useRefusalFocus();
  async function submit() {
    if (reason.trim() === "") {
      setError(ZN_UI.removeReasonMissing);
      document.getElementById("adv-remove-reason")?.focus();
      return;
    }
    setError(null);
    setFailure(null);
    setBusy(true);
    try {
      await paymentsApi.unlinkAdvice(props.adviceId, p.payment_id, reason.trim());
      props.onDone();
    } catch (e) {
      setFailure(adviceErrorText(e));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="dialog__body pay-form">
        <div className="pay-entry__head">
          <span className="pay-entry__amount tnum">{amountText(p.amount_minor, p.currency)}</span>
          <span className="pay-lines__meta">
            {clientText(p.client_name)} · {day(p.received_on)}
          </span>
        </div>
        <p>{ZN_UI.removeBody}</p>
        <FormField
          id="adv-remove-reason"
          label={ZN_UI.removeReason}
          hint={ZN_UI.removeReasonHint}
          error={error}
        >
          {(a) => (
            <textarea
              {...a}
              rows={3}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </FormField>
      </div>
      {failure && (
        <Notice tone="error" ref={refusal.ref}>
          {failure}
        </Notice>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onBack} disabled={busy}>
          {INV_COPY.cancel}
        </button>
        <button type="submit" className="btn btn--danger" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Working…" : ZN.removeLink}
        </button>
      </div>
    </form>
  );
}
