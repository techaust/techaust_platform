// Payments (M6.1; ADM-PAY-05, ADM-PAY-06, ADM-APR-01, ADM-INV-16, ADM-INV-17): every payment and TDS entry, newest first, with its status. The Owner opens on
// "Payments to check" (07-ZH line 4), the entries Staff recorded, oldest first, each with Confirm and Reject (a reason is required to reject; a fresh code for
// either, owner Q2). `/payments/:id` (the bells and the approvals queue link here) opens that entry: its facts, the invoices it went on, and the actions the
// role has (withdraw a confirmed entry, Owner with a reason; attach a proof; add a TDS certificate). Filters live in the URL (status, client, received from/to).
import "./invoices/parts.tsx";
import "../payments.css";
import type { Role } from "@techaust/core/permissions";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  type AllocationAsk,
  type PaymentStatus,
  type PaymentView,
  paymentsApi,
  sha256Hex,
  uploadPaymentDoc,
} from "../api.ts";
import { type Column, DataTable, FilterBar } from "../components/data-table.tsx";
import { DateField } from "../components/date-field.tsx";
import { Modal, useRefusalFocus } from "../components/dialog.tsx";
import { EmptyState, PageHeader, When } from "../components/display.tsx";
import { FormField } from "../components/form.tsx";
import { Alert, FileText, Plus, Search, Wallet } from "../components/icons.tsx";
import { LoadFailed, NoAccess, useLoad } from "../components/states.tsx";
import { Tabs } from "../components/tabs.tsx";
import { useToast } from "../components/toast.tsx";
import { Notice } from "../components/ui.tsx";
import { allowed } from "../lib/access.ts";
import { pendingBadge } from "../lib/documents.ts";
import { INV_COPY, typeLabel } from "../lib/invoices.ts";
import { invoicesApi } from "../lib/invoices-api.ts";
import { confirmDocsOf, OPEN_DOCS_CAP } from "../lib/open-docs.ts";
import {
  type AllocRow,
  amountText,
  blockingRefusals,
  earlierMonthLine,
  earlierMonthOf,
  leftoverLine,
  MODE_LABELS,
  PAY_COPY,
  PAY_ERRORS,
  PAY_UI,
  payErrorText,
  plainAmount,
  readAllocations,
  STATUS_LABELS,
  showingFirstLine,
} from "../lib/payments.ts";
import { bpToPercent } from "../lib/settings-form.ts";
import { withCode } from "../lib/step-up.ts";
import { useUser } from "../session.tsx";
import { CertificateDialog, paymentHref } from "./payments/panel.tsx";
import {
  AllocationTable,
  day,
  EarlierMonthWarning,
  FilePick,
  PaymentPill,
  useCodeSlot,
  useDialogState,
} from "./payments/parts.tsx";
import { RecordPaymentDialog } from "./payments/record-dialog.tsx";

export function Component() {
  const user = useUser();
  if (!allowed(user.role, "payments.read")) return <NoAccess what={PAY_COPY.heading} />;
  return <Payments role={user.role} />;
}

type Tab = "check" | "all";
const STATUSES: PaymentStatus[] = ["pending_verification", "confirmed", "rejected", "withdrawn"];
const isStatus = (v: string | null): v is PaymentStatus => STATUSES.includes(v as PaymentStatus);

function Payments({ role }: { role: Role }) {
  const owner = allowed(role, "payments.verify");
  const { id: linked } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = owner && params.get("tab") !== "all" && !params.get("status") ? "check" : "all";
  const status =
    tab === "check"
      ? "pending_verification"
      : isStatus(params.get("status"))
        ? (params.get("status") as PaymentStatus)
        : null;
  const client = params.get("client") ?? undefined;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const [recording, setRecording] = useDialogState<"payment" | "tds">("main");
  // Visual review finding 4: a payment recorded here reloads the list in place (the first page again, quietly).
  const [refresh, setRefresh] = useState(0);
  const waiting = useLoad(
    () => (owner ? paymentsApi.list({ status: "pending_verification" }) : Promise.resolve(null)),
    `${owner}`,
  );
  const badge =
    waiting.state === "ready" && waiting.data
      ? pendingBadge({ n: waiting.data.payments.length, more: waiting.data.next !== null })
      : null;

  const set = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === "") n.delete(k);
          else n.set(k, v);
        }
        return n;
      },
      { replace: true },
    );

  const list = (
    <PaymentList
      key={`${tab}:${status ?? ""}:${client ?? ""}:${from}:${to}`}
      tab={tab}
      role={role}
      status={status}
      client={client}
      from={from}
      to={to}
      filters={tab === "all"}
      onFilter={set}
      linked={linked}
      refresh={refresh}
      linkSearch={params.toString()}
      onLinkedDone={() =>
        linked && navigate({ pathname: "/payments", search: params.toString() }, { replace: true })
      }
      onChanged={() => waiting.reload(true)}
    />
  );
  const canRecord = allowed(role, "payments.record");
  return (
    <>
      <PageHeader
        title={PAY_COPY.heading}
        action={
          canRecord ? (
            <button type="button" className="btn btn--primary" onClick={() => setRecording("payment")}>
              <Plus size={20} />
              {PAY_COPY.recordTitle}
            </button>
          ) : undefined
        }
        more={canRecord ? [{ label: PAY_UI.recordTds, onSelect: () => setRecording("tds") }] : undefined}
      />
      {owner ? (
        <Tabs
          label={PAY_COPY.heading}
          tabs={[
            { key: "check", label: PAY_COPY.toCheck, badge },
            { key: "all", label: PAY_UI.allPayments },
          ]}
          selected={tab}
          // Visual review finding 3: the other tab's filters never carry over (the check tab has none; its badge and its list must agree).
          onSelect={(k) =>
            set({ tab: k === "all" ? "all" : null, status: null, client: null, from: null, to: null })
          }
        >
          {list}
        </Tabs>
      ) : (
        list
      )}
      {recording && (
        <RecordPaymentDialog
          open
          kind={recording}
          role={role}
          client={null}
          onClose={() => setRecording(null)}
          onDone={() => {
            setRecording(null);
            waiting.reload(true);
            setRefresh((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

function PaymentList(props: {
  tab: Tab;
  role: Role;
  status: PaymentStatus | null;
  client: string | undefined;
  from: string;
  to: string;
  filters: boolean;
  onFilter: (patch: Record<string, string | null>) => void;
  linked: string | undefined;
  /** Bumped after a payment is recorded on this page: the list reloads its first page. */
  refresh: number;
  /** The page's filters, carried into an entry's link so closing it comes back to the same tab and filters (visual review, low). */
  linkSearch: string;
  onLinkedDone: () => void;
  onChanged: () => void;
}) {
  const owner = allowed(props.role, "payments.verify");
  const toast = useToast();
  const q = {
    ...(props.status ? { status: props.status } : {}),
    ...(props.client ? { client: props.client } : {}),
    ...(props.from ? { from: props.from } : {}),
    ...(props.to ? { to: props.to } : {}),
  };
  const list = useLoad(() => paymentsApi.list(q), JSON.stringify(q));
  const [more, setMore] = useState<PaymentView[]>([]);
  // Re-check finding 6: whether a further page was read is its own fact (an empty page leaves `more` empty), so "Show more" never asks for the same page again.
  const [paged, setPaged] = useState(false);
  const [after, setAfter] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpenState] = useDialogState<{ id: string; act?: "confirm" | "reject" }>("main");
  const setOpen = setOpenState;
  // a bell's or the approvals queue's link opens that entry once the list is drawn
  const linkedOpened = useRef(false);
  useEffect(() => {
    if (props.linked && !linkedOpened.current) {
      linkedOpened.current = true;
      setOpen({ id: props.linked });
    }
  }, [props.linked, setOpen]);
  const reload = list.reload;
  const firstRefresh = useRef(props.refresh);
  useEffect(() => {
    if (props.refresh === firstRefresh.current) return;
    firstRefresh.current = props.refresh;
    setMore([]);
    setPaged(false);
    setAfter(null);
    reload(true);
  }, [props.refresh, reload]);
  const entryHref = (id: string) => `${paymentHref(id)}${props.linkSearch ? `?${props.linkSearch}` : ""}`;
  const rows = [...(list.data?.payments ?? []), ...more];
  const next = paged ? after : (list.data?.next ?? null);
  async function showMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const r = await paymentsApi.list({ ...q, after: next });
      setMore((m) => [...m, ...r.payments.filter((x) => !m.some((y) => y.id === x.id))]);
      setPaged(true);
      // an empty page ends the list, whatever `next` it names
      setAfter(r.payments.length > 0 ? r.next : null);
    } catch (e) {
      toast("error", payErrorText(e));
    } finally {
      setLoadingMore(false);
    }
  }
  const filtered =
    props.status !== null || props.client !== undefined || props.from !== "" || props.to !== "";

  const columns: Column<PaymentView>[] = [
    {
      key: "date",
      header: PAY_COPY.dateReceived,
      card: "title",
      cell: (r) => (
        <Link to={entryHref(r.id)} className="tnum pay-row__link">
          {day(r.receivedOn)}
        </Link>
      ),
    },
    {
      key: "client",
      header: PAY_UI.colClient,
      width: "26%",
      cell: (r) => (
        <span className="pay-row__client">
          <span>{r.clientName}</span> <span className="docno pay-lines__code">{r.clientCode}</span>
        </span>
      ),
    },
    {
      key: "entry",
      header: PAY_UI.colKind,
      cell: (r) => (
        <span className="pay-row__entry">
          {r.kind === "tds" ? PAY_UI.kindTds : `${PAY_UI.kindPayment} · ${r.mode ? MODE_LABELS[r.mode] : ""}`}
        </span>
      ),
    },
    {
      key: "ref",
      header: PAY_COPY.reference,
      cell: (r) =>
        r.kind === "tds" ? (
          r.tds?.certificateAwaited ? (
            <span className="pay-badge">{PAY_COPY.certificateAwaited}</span>
          ) : (
            <span className="docno">{r.tds?.certificateNo}</span>
          )
        ) : (
          <span className="docno break">{r.reference}</span>
        ),
    },
    {
      key: "amount",
      header: PAY_UI.colAmount,
      align: "end",
      cell: (r) => <span className="tnum pay-lines__nowrap">{amountText(r.amountMinor, r.currency)}</span>,
    },
    ...(props.tab === "check"
      ? [
          {
            key: "by",
            header: PAY_UI.recordedBy,
            cell: (r: PaymentView) => <span>{r.recordedByName ?? ""}</span>,
          },
        ]
      : [
          {
            key: "status",
            header: PAY_UI.colStatus,
            cell: (r: PaymentView) => <PaymentPill status={r.status} />,
          },
        ]),
  ];

  const emptyTitle =
    props.tab === "check" ? PAY_UI.noneToCheck : filtered ? PAY_UI.noneMatch : PAY_UI.noneYet;
  return (
    <>
      {props.filters && (
        <FilterBar
          className="filters--clients filters--pay"
          groups={[
            {
              key: "status",
              label: PAY_UI.colStatus,
              selected: props.status ? [props.status] : [],
              options: STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
            },
          ]}
          onToggle={(_, v) => props.onFilter({ status: props.status === v ? null : v, tab: "all" })}
          onClear={() => props.onFilter({ status: null, client: null, from: null, to: null, tab: "all" })}
          extra={
            <div className="pay-range">
              <FormField id="pay-from" label={PAY_UI.from} optional>
                {(a) => (
                  <DateField
                    {...a}
                    keepLastValid
                    value={props.from}
                    onChange={(v) => props.onFilter({ from: v || null })}
                  />
                )}
              </FormField>
              <FormField id="pay-to" label={PAY_UI.to} optional>
                {(a) => (
                  <DateField
                    {...a}
                    keepLastValid
                    value={props.to}
                    onChange={(v) => props.onFilter({ to: v || null })}
                  />
                )}
              </FormField>
            </div>
          }
          extraOn={(props.from ? 1 : 0) + (props.to ? 1 : 0) + (props.client ? 1 : 0)}
          result=""
        />
      )}
      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="clients-table pay-table">
          <DataTable
            caption={props.tab === "check" ? PAY_COPY.toCheck : PAY_COPY.heading}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={list.state === "loading"}
            skeletonRows={4}
            actions={
              owner && props.tab === "check"
                ? (r) =>
                    r.status === "pending_verification" ? (
                      <span className="pay-row__acts">
                        <button
                          type="button"
                          className="btn btn--secondary"
                          onClick={() => setOpen({ id: r.id, act: "reject" })}
                        >
                          {PAY_COPY.reject}
                          <span className="visually-hidden">{` ${day(r.receivedOn)} ${r.clientName}`}</span>
                        </button>
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={() => setOpen({ id: r.id, act: "confirm" })}
                        >
                          {PAY_COPY.confirm}
                          <span className="visually-hidden">{` ${day(r.receivedOn)} ${r.clientName}`}</span>
                        </button>
                      </span>
                    ) : null
                : undefined
            }
            empty={
              <EmptyState
                icon={filtered && props.tab === "all" ? <Search /> : <Wallet />}
                title={emptyTitle.replace(/\.$/, "")}
              >
                {null}
              </EmptyState>
            }
          />
        </div>
      )}
      {next && (
        <button
          type="button"
          className="btn btn--secondary notes__more"
          onClick={() => void showMore()}
          disabled={loadingMore}
          aria-busy={loadingMore || undefined}
        >
          {loadingMore ? "Loading…" : PAY_UI.showMore}
        </button>
      )}
      {open && (
        <EntryDialog
          id={open.id}
          act={open.act}
          role={props.role}
          onClose={() => {
            setOpen(null);
            props.onLinkedDone();
          }}
          onChanged={(text) => {
            setOpen(null);
            props.onLinkedDone();
            toast("success", text);
            setMore([]);
            setPaged(false);
            setAfter(null);
            list.reload(true);
            props.onChanged();
          }}
        />
      )}
    </>
  );
}

type Step = "view" | "confirm" | "reject" | "withdraw" | "proof" | "certificate";

/** One entry: its facts and what it went on; the role's actions open their own step in the same dialog. */
function EntryDialog(props: {
  id: string;
  act?: "confirm" | "reject" | undefined;
  role: Role;
  onClose: () => void;
  onChanged: (toast: string) => void;
}) {
  const entry = useLoad(() => paymentsApi.get(props.id), props.id);
  const [step, setStep] = useState<Step>(props.act ?? "view");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const title =
    step === "confirm"
      ? PAY_UI.confirmTitle
      : step === "reject"
        ? PAY_UI.rejectTitle
        : step === "withdraw"
          ? PAY_UI.withdrawTitle
          : step === "proof"
            ? PAY_UI.attachProof
            : PAY_UI.detailTitle;
  if (step === "certificate")
    return (
      <CertificateDialog
        paymentId={props.id}
        onClose={() => setStep("view")}
        onDone={() => props.onChanged(PAY_UI.certificateSaved)}
      />
    );
  return (
    <Modal
      open
      title={title}
      onClose={props.onClose}
      titleRef={titleRef}
      className="dialog--pay"
      tone={step === "withdraw" || step === "reject" ? "danger" : "default"}
    >
      {entry.state === "loading" ? (
        <div className="dialog__body" aria-busy="true">
          <span className="skeleton" style={{ width: "60%" }} />
          <span className="skeleton" style={{ width: "80%" }} />
        </div>
      ) : entry.state === "failed" ? (
        <>
          <LoadFailed error={entry.error} onRetry={() => entry.reload()} />
          <div className="dialog__actions">
            <button type="button" className="btn btn--secondary" onClick={props.onClose}>
              {PAY_UI.close}
            </button>
          </div>
        </>
      ) : step === "view" ? (
        <EntryView
          data={entry.data}
          role={props.role}
          onStep={(s) => {
            setStep(s);
            requestAnimationFrame(() => titleRef.current?.focus());
          }}
          onClose={props.onClose}
        />
      ) : step === "confirm" ? (
        <ConfirmStep payment={entry.data.payment} onBack={() => setStep("view")} onDone={props.onChanged} />
      ) : step === "reject" ? (
        <ReasonStep
          payment={entry.data.payment}
          kind="reject"
          onBack={() => setStep("view")}
          onDone={props.onChanged}
        />
      ) : step === "withdraw" ? (
        <ReasonStep
          payment={entry.data.payment}
          kind="withdraw"
          onBack={() => setStep("view")}
          onDone={props.onChanged}
        />
      ) : (
        <ProofStep payment={entry.data.payment} onBack={() => setStep("view")} onDone={props.onChanged} />
      )}
    </Modal>
  );
}

function EntryView(props: {
  data: Awaited<ReturnType<typeof paymentsApi.get>>;
  role: Role;
  onStep: (s: Step) => void;
  onClose: () => void;
}) {
  const p = props.data.payment;
  const cur = p.currency;
  const owner = allowed(props.role, "payments.verify");
  const pending = p.status === "pending_verification";
  const canProof =
    allowed(props.role, "payments.attachProof") &&
    p.kind === "payment" &&
    !p.proof?.hasFile &&
    !p.clientGone &&
    (p.status === "pending_verification" || p.status === "confirmed");
  const canCert =
    allowed(props.role, "payments.attachProof") &&
    p.kind === "tds" &&
    p.tds?.certificateAwaited === true &&
    !p.clientGone &&
    (p.status === "pending_verification" || p.status === "confirmed");
  const canWithdraw =
    allowed(props.role, "payments.withdraw") &&
    p.status === "confirmed" &&
    !p.advanceReceiptId &&
    !p.clientGone;
  const allocs = props.data.allocations;
  // What a waiting entry asks for names documents by id only: their numbers are read once (at most 10, L6).
  const askedIds = pending ? p.requestedAllocations.map((a) => a.documentId) : [];
  const asked = useLoad(
    () =>
      Promise.all(
        askedIds.map((id) =>
          invoicesApi.get(id).then((d) => [id, { number: d.number, type: d.type }] as const),
        ),
      ).then((pairs) => Object.fromEntries(pairs) as Record<string, { number: string | null; type: string }>),
    askedIds.join(","),
  );
  return (
    <>
      <div className="dialog__body pay-entry">
        <div className="pay-entry__head">
          <span className="pay-entry__amount tnum">{amountText(p.amountMinor, cur)}</span>
          <PaymentPill status={p.status} />
        </div>
        <dl className="inv-facts pay-entry__facts">
          <div>
            <dt>{INV_COPY.colClient}</dt>
            <dd>
              {p.clientGone ? (
                p.clientName
              ) : (
                <Link to={`/clients/${encodeURIComponent(p.clientId)}`}>{p.clientName}</Link>
              )}{" "}
              <span className="docno">{p.clientCode}</span>
            </dd>
          </div>
          <div>
            <dt>{PAY_COPY.dateReceived}</dt>
            <dd className="tnum">{day(p.receivedOn)}</dd>
          </div>
          {p.kind === "payment" ? (
            <>
              <div>
                <dt>{PAY_COPY.mode}</dt>
                <dd>{p.mode ? MODE_LABELS[p.mode] : ""}</dd>
              </div>
              <div>
                <dt>{PAY_COPY.reference}</dt>
                <dd className="docno break">{p.reference}</dd>
              </div>
              {p.chargesMinor > 0 && (
                <div>
                  <dt>{PAY_COPY.charges}</dt>
                  <dd className="tnum">{amountText(p.chargesMinor, cur)}</dd>
                </div>
              )}
              {p.inrReceivedMinor !== null && (
                <div>
                  <dt>{PAY_UI.inrReceived}</dt>
                  <dd className="tnum">{amountText(p.inrReceivedMinor, "INR")}</dd>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <dt>{PAY_COPY.tdsSection}</dt>
                <dd>{p.tds?.section}</dd>
              </div>
              <div>
                <dt>{PAY_COPY.tdsRate}</dt>
                <dd className="tnum">
                  {p.tds?.rateBp !== null && p.tds?.rateBp !== undefined ? plainRate(p.tds.rateBp) : ""}
                </dd>
              </div>
              <div>
                <dt>{PAY_COPY.tdsCertificate}</dt>
                <dd>
                  {p.tds?.certificateAwaited ? (
                    <span className="pay-badge">{PAY_COPY.certificateAwaited}</span>
                  ) : (
                    <>
                      <span className="docno">{p.tds?.certificateNo}</span> {day(p.tds?.certificateOn)}
                    </>
                  )}
                </dd>
              </div>
            </>
          )}
          {p.kind === "payment" && (
            <div>
              <dt>{PAY_COPY.proof}</dt>
              <dd>
                {p.proof?.hasFile ? (
                  <a href={paymentsApi.proofHref(p.id)} className="pay-proof-link">
                    <FileText size={16} />
                    {[p.proof.kind, p.proof.ref].filter(Boolean).join(" · ") || PAY_UI.openProof}
                  </a>
                ) : (
                  <span className="pay-lines__meta">{PAY_UI.noProof}</span>
                )}
              </dd>
            </div>
          )}
          <div>
            <dt>{PAY_UI.recordedBy}</dt>
            <dd>
              {p.recordedByName ?? ""} <When ms={p.recordedAt} inline />
            </dd>
          </div>
          {p.verifiedAt !== null && p.status !== "pending_verification" && (
            <div>
              <dt>{PAY_UI.checkedBy}</dt>
              <dd>
                {p.verifiedByName ?? ""} <When ms={p.verifiedAt} inline />
              </dd>
            </div>
          )}
          {p.note && (
            <div className="inv-facts__wide">
              <dt>{PAY_COPY.note}</dt>
              <dd className="break">{p.note}</dd>
            </div>
          )}
          {p.status === "rejected" && p.decisionNote && (
            <div className="inv-facts__wide">
              <dt>{PAY_UI.rejectedWhy}</dt>
              <dd className="break">{p.decisionNote}</dd>
            </div>
          )}
          {p.status === "withdrawn" && (
            <div className="inv-facts__wide">
              <dt>{PAY_UI.withdrawnWhy}</dt>
              <dd className="break">
                {p.withdrawReason} {p.withdrawnAt !== null && <When ms={p.withdrawnAt} inline />}
              </dd>
            </div>
          )}
        </dl>
        <PutOn
          heading={pending ? PAY_UI.askedFor : PAY_UI.putOn}
          rows={
            pending
              ? p.requestedAllocations.map((a) => ({
                  documentId: a.documentId,
                  number: asked.state === "ready" ? (asked.data[a.documentId]?.number ?? null) : null,
                  type: asked.state === "ready" ? (asked.data[a.documentId]?.type ?? "") : "",
                  amountMinor: a.amountMinor,
                  kind: "allocate" as const,
                }))
              : allocs
          }
          currency={cur}
        />
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose}>
          {PAY_UI.close}
        </button>
        {canProof && (
          <button type="button" className="btn btn--secondary" onClick={() => props.onStep("proof")}>
            {PAY_UI.attachProof}
          </button>
        )}
        {canCert && (
          <button type="button" className="btn btn--secondary" onClick={() => props.onStep("certificate")}>
            {PAY_UI.addCertificate}
          </button>
        )}
        {canWithdraw && (
          <button type="button" className="btn btn--danger" onClick={() => props.onStep("withdraw")}>
            {PAY_UI.withdraw}
          </button>
        )}
        {owner && pending && (
          <>
            <button type="button" className="btn btn--secondary" onClick={() => props.onStep("reject")}>
              {PAY_COPY.reject}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => props.onStep("confirm")}>
              {PAY_COPY.confirm}
            </button>
          </>
        )}
      </div>
    </>
  );
}

const plainRate = (bp: number) => `${bpToPercent(bp)} %`;

/** The invoices an entry went on (confirmed) or asks for (waiting): number and amount; a release reads as moved to credit. */
function PutOn(props: {
  heading: string;
  rows: {
    documentId: string;
    number: string | null;
    type: string;
    amountMinor: number;
    kind: "allocate" | "release";
  }[];
  currency: PaymentView["currency"];
}) {
  if (props.rows.length === 0) return null;
  return (
    <div className="pay-puton">
      <h3 className="pay-sub">{props.heading}</h3>
      <ul className="pay-puton__list">
        {props.rows.map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an allocation and a later release of the same invoice share the document id
          <li key={`${r.documentId}-${i}`}>
            <Link to={`/invoices/${encodeURIComponent(r.documentId)}`} className="docno">
              {r.number ?? (r.type ? typeLabel(r.type as never) : "…")}
            </Link>
            <span className="pay-lines__meta">{r.kind === "release" ? PAY_UI.movedToCredit : ""}</span>
            <span className="tnum">{amountText(r.amountMinor, props.currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Confirm (line 4; Owner, fresh code): the invoices Staff asked for, which the Owner may change (L6); a proforma is confirmed by its advance (line 12).
 * Re-check finding 1: nothing Staff asked for is dropped. The client's open documents are read in full (the shared paged loader), and an asked-for document the
 * lists didn't return is read by id: a row prefilled with the amount asked, or a refused row with its reason that blocks Confirm until the Owner clears it. A
 * failed read is the failed-load state with "Try again", and Confirm stays disabled.
 */
function ConfirmStep(props: { payment: PaymentView; onBack: () => void; onDone: (t: string) => void }) {
  const p = props.payment;
  const cur = p.currency;
  const load = useLoad(() => confirmDocsOf(p), `${p.id}:${p.recordedAt}`);
  const ready = load.state === "ready" && load.data.kind === "ready" ? load.data : null;
  const docs = ready?.docs ?? null;
  const refused = ready?.refused ?? [];
  const refusedText = Object.fromEntries(refused.map((r) => [r.id, r.error]));
  const proformaAsk = load.state === "ready" && load.data.kind === "proforma" ? load.data.id : null;
  const [rows, setRows] = useState<AllocRow[]>(() =>
    p.requestedAllocations.map((a) => ({ documentId: a.documentId, text: plainAmount(a.amountMinor, cur) })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const code = useCodeSlot("pay-confirm-code", true);
  const refusal = useRefusalFocus();
  const plan = docs ? readAllocations(rows, docs, p.amountMinor, cur, refusedText) : null;
  const blocked = blockingRefusals(rows, refused);
  const leftover =
    docs && plan?.ok ? leftoverLine(plan.leftMinor, p.amountMinor, docs, cur, p.clientName) : null;
  // Line 10's warning before the confirm (visual review finding 6): an invoice it goes on was issued in a later month than the money arrived.
  const month =
    docs && plan?.ok
      ? earlierMonthOf(
          p.receivedOn,
          plan.allocations.map((a) => docs.find((d) => d.id === a.documentId)?.issueDate),
        )
      : null;

  async function submit() {
    if (!plan || blocked.length > 0) return;
    // Visual review finding 5: every attempt starts clean; the rows first, then the code, then the sum.
    setFailure(null);
    if (!plan.ok) {
      setErrors(plan.errors);
      const firstRow = Object.keys(plan.errors)[0];
      if (firstRow) document.getElementById(`pay-confirm-${firstRow}`)?.focus();
      return;
    }
    setErrors({});
    if (!code.ready()) return;
    if (plan.over) {
      setFailure(PAY_ERRORS.exceeds_payment);
      refusal.show();
      return;
    }
    setBusy(true);
    try {
      const r = await withCode(code.code, () =>
        paymentsApi.verify(p.id, {
          decision: "confirm",
          allocations: plan.allocations as AllocationAsk[],
          expectedRecordedAt: p.recordedAt,
        }),
      );
      const w = r.warnings[0];
      props.onDone(w ? `${PAY_UI.confirmed} ${earlierMonthLine(w.month)}` : PAY_UI.confirmed);
    } catch (e) {
      if (code.refused(e)) return;
      setFailure(payErrorText(e));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }

  if (proformaAsk)
    return (
      <>
        <div className="dialog__body pay-form">
          <p className="approval-line" data-state="pending">
            <Alert size={16} />
            <span>{PAY_COPY.proformaLine}</span>
          </p>
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onBack}>
            {INV_COPY.cancel}
          </button>
          <Link to={`/invoices/${encodeURIComponent(proformaAsk)}`} className="btn btn--primary">
            {PAY_UI.confirmByIssuing}
          </Link>
        </div>
      </>
    );
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
          <span className="pay-entry__amount tnum">{amountText(p.amountMinor, cur)}</span>
          <span className="pay-lines__meta">
            {p.clientName} · {day(p.receivedOn)} · <span className="docno">{p.reference}</span>
          </span>
        </div>
        <p>{PAY_UI.confirmBody}</p>
        <fieldset className="form-section pay-alloc">
          <legend>{PAY_UI.allocHeading}</legend>
          {load.state === "failed" ? (
            <LoadFailed error={load.error} onRetry={() => load.reload()} headingLevel={3} />
          ) : (
            <>
              {docs !== null && docs.length + refused.length > 0 && (
                <p className="hint">{PAY_UI.allocHint}</p>
              )}
              <AllocationTable
                docs={docs ?? []}
                refused={refused}
                rows={rows}
                onRow={(id, text) =>
                  setRows([...rows.filter((r) => r.documentId !== id), { documentId: id, text }])
                }
                errors={errors}
                idPrefix="pay-confirm"
                symbol={cur === "INR" ? "₹" : "$"}
                loading={docs === null}
              />
              {ready?.capped && <p className="hint">{showingFirstLine(OPEN_DOCS_CAP)}</p>}
            </>
          )}
          {leftover && (
            <p className="pay-line" role="status" data-kind={leftover.kind}>
              <FileText size={16} />
              <span>{leftover.text}</span>
            </p>
          )}
        </fieldset>
        <EarlierMonthWarning month={month} />
      </div>
      {code.field}
      {failure && (
        <Notice tone="error" ref={refusal.ref}>
          {failure}
        </Notice>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onBack} disabled={busy}>
          {INV_COPY.cancel}
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={busy || docs === null || blocked.length > 0}
          aria-busy={busy || load.state === "loading" || undefined}
        >
          {busy ? "Working…" : PAY_COPY.confirm}
        </button>
      </div>
    </form>
  );
}

/** Reject (line 4; a reason, Owner, fresh code) or Withdraw (a reason, Owner, fresh code; L7). */
function ReasonStep(props: {
  payment: PaymentView;
  kind: "reject" | "withdraw";
  onBack: () => void;
  onDone: (t: string) => void;
}) {
  const p = props.payment;
  const reject = props.kind === "reject";
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const code = useCodeSlot("pay-reason-code", true);
  const refusal = useRefusalFocus();
  async function submit() {
    if (reason.trim() === "") {
      setError(reject ? PAY_ERRORS.reason_required : PAY_UI.withdrawReasonMissing);
      document.getElementById("pay-reason")?.focus();
      return;
    }
    setError(null);
    if (!code.ready()) return;
    setBusy(true);
    setFailure(null);
    try {
      await withCode<unknown>(code.code, () =>
        reject
          ? paymentsApi.verify(p.id, {
              decision: "reject",
              note: reason.trim(),
              expectedRecordedAt: p.recordedAt,
            })
          : paymentsApi.withdraw(p.id, reason.trim()),
      );
      props.onDone(reject ? PAY_UI.rejected : PAY_UI.withdrawn);
    } catch (e) {
      if (code.refused(e)) return;
      setFailure(payErrorText(e));
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
          <span className="pay-entry__amount tnum">{amountText(p.amountMinor, p.currency)}</span>
          <span className="pay-lines__meta">
            {p.clientName} · {day(p.receivedOn)}
          </span>
        </div>
        <p>{reject ? PAY_UI.rejectBody : PAY_UI.withdrawBody}</p>
        <FormField
          id="pay-reason"
          label={reject ? PAY_COPY.rejectReason : PAY_UI.withdrawReason}
          error={error}
        >
          {(a) => (
            <textarea
              {...a}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </FormField>
      </div>
      {code.field}
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
          {busy ? "Working…" : reject ? PAY_COPY.reject : PAY_UI.withdraw}
        </button>
      </div>
    </form>
  );
}

/** Attach a proof to an entry that has none (L11: set once, later). */
function ProofStep(props: { payment: PaymentView; onBack: () => void; onDone: (t: string) => void }) {
  const p = props.payment;
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState("");
  const [ref, setRef] = useState("");
  const [errors, setErrors] = useState<{ file?: string; kind?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = useRefusalFocus();
  async function submit() {
    const e = {
      ...(file ? {} : { file: PAY_UI.proofFileHint }),
      ...(kind.trim() ? {} : { kind: PAY_UI.proofKindMissing }),
    };
    setErrors(e);
    if (e.file || e.kind || !file) {
      document.getElementById(e.file ? "pay-proof-file" : "pay-proof-kind1")?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await uploadPaymentDoc(
        { proofOf: p.id, kind: kind.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}) },
        file,
        await sha256Hex(file),
        () => {},
      );
      props.onDone(PAY_UI.proofSaved);
    } catch (err) {
      setFailure(payErrorText(err));
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
        {p.currency === "USD" && <p className="hint">{PAY_COPY.exportProofHint}</p>}
        <FilePick
          id="pay-proof-file"
          label={PAY_COPY.proof}
          file={file}
          onFile={setFile}
          error={errors.file}
        />
        <FormField
          id="pay-proof-kind1"
          label={PAY_COPY.proofKind}
          hint={PAY_COPY.proofKindHint}
          error={errors.kind}
        >
          {(a) => (
            <input
              {...a}
              maxLength={60}
              autoComplete="off"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            />
          )}
        </FormField>
        <FormField id="pay-proof-ref1" label={PAY_COPY.proofRef} optional>
          {(a) => (
            <input
              {...a}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
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
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Working…" : PAY_UI.attachProof}
        </button>
      </div>
    </form>
  );
}
