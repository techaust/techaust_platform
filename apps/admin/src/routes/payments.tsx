// Payments (M6.1; ADM-PAY-05, ADM-PAY-06, ADM-APR-01, ADM-INV-16, ADM-INV-17): every payment and TDS entry, newest first, with its status. The Owner opens on
// "Payments to check" (07-ZH line 4), the entries Staff recorded, oldest first, each with Confirm and Reject (a reason is required to reject; a fresh code for
// either, owner Q2). `/payments/:id` (the bells and the approvals queue link here) opens that entry: its facts, the invoices it went on, and the actions the
// role has (withdraw a confirmed entry, Owner with a reason; attach a proof; add a TDS certificate). Filters live in the URL (status, client, received from/to).
import "./invoices/parts.tsx";
import "../payments.css";
import type { Role } from "@techaust/core/permissions";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { type AllocationAsk, type PaymentStatus, type PaymentView, paymentsApi } from "../api.ts";
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
import { CARD_ZM } from "../lib/copy-zm.ts";
import { ADVICE_KIND_LABELS, ZN, ZN_UI } from "../lib/copy-zn.ts";
import { ra41ConfirmLine, ZO_UI } from "../lib/copy-zo.ts";
import { pendingBadge } from "../lib/documents.ts";
import { GW, GW_UI, gatewayLine, gatewayName, REVIEW_CHANGED } from "../lib/gateway.ts";
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
  pendingDecisionOf,
  plainAmount,
  readAllocations,
  STATUS_LABELS,
  showingFirstLine,
  WAITS_REFUND_LINE,
} from "../lib/payments.ts";
import { bpToPercent } from "../lib/settings-form.ts";
import { withCode } from "../lib/step-up.ts";
import { useUser } from "../session.tsx";
import { CreditHeldTab } from "./payments/credit-held-tab.tsx";
import { CertificateDialog, paymentHref } from "./payments/panel.tsx";
import {
  AllocationTable,
  day,
  EarlierMonthWarning,
  PaymentPill,
  useCodeSlot,
  useDialogState,
} from "./payments/parts.tsx";
import { ProofForm } from "./payments/proof-form.tsx";
import { RecordPaymentDialog } from "./payments/record-dialog.tsx";
import { RefundDialog } from "./payments/refund-dialog.tsx";
import { PaymentReceiptAndRefunds } from "./payments/refund-parts.tsx";
import { RefundsTab } from "./payments/refunds-tab.tsx";
import { ReviewList } from "./payments/review-tab.tsx";

export function Component() {
  const user = useUser();
  if (!allowed(user.role, "payments.read")) return <NoAccess what={PAY_COPY.heading} />;
  return <Payments role={user.role} />;
}

type Tab = "check" | "review" | "all" | "refunds" | "credit";
const STATUSES: PaymentStatus[] = ["pending_verification", "confirmed", "rejected", "withdrawn"];
const isStatus = (v: string | null): v is PaymentStatus => STATUSES.includes(v as PaymentStatus);

function Payments({ role }: { role: Role }) {
  const owner = allowed(role, "payments.verify");
  const { id: linked } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // M6.2: "Needs review" (07-ZI S19) is the Owner's third tab; the bells link to `?tab=review`.
  // M6.5 (G4): the Refunds tab, for the roles that read refunds (the Owner and the Accountant)
  const canRefunds = allowed(role, "refunds.read");
  // M6.5 review part 1, finding 3 (RA-41): credit held at a GST period's end, for the roles with the finance reports (the Owner and the Accountant)
  const canCredit = allowed(role, "reports.finance");
  const tab: Tab =
    canRefunds && params.get("tab") === "refunds"
      ? "refunds"
      : canCredit && params.get("tab") === "credit"
        ? "credit"
        : !owner
          ? "all"
          : params.get("tab") === "review"
            ? "review"
            : params.get("tab") !== "all" && !params.get("status") && !params.get("proof")
              ? "check"
              : "all";
  const status =
    tab === "check"
      ? "pending_verification"
      : isStatus(params.get("status"))
        ? (params.get("status") as PaymentStatus)
        : null;
  const client = params.get("client") ?? undefined;
  // M6.3 (07-ZM S15): the card payments whose proof is awaited
  const proof = tab === "all" && params.get("proof") === "awaited";
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
  // M6.2: the open "Needs review" items (the count only; the tab reads its own list and reports changes back).
  const reviewing = useLoad(
    () => (owner ? paymentsApi.review({ status: "open" }) : Promise.resolve(null)),
    `${owner}`,
  );
  const reviewCount = reviewing.state === "ready" && reviewing.data ? reviewing.data.openCount : 0;
  const reviewBadge =
    reviewCount > 0 ? { text: String(reviewCount), label: GW_UI.reviewCount(reviewCount) } : null;

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

  const list =
    tab === "refunds" ? (
      <RefundsTab role={role} />
    ) : tab === "credit" ? (
      <CreditHeldTab role={role} />
    ) : tab === "review" ? (
      <ReviewList
        role={role}
        entry={(id, close, changed) => (
          <EntryDialog id={id} role={role} onClose={close} onChanged={changed} />
        )}
        onChanged={() => {
          reviewing.reload(true);
          window.dispatchEvent(new Event(REVIEW_CHANGED));
          waiting.reload(true);
        }}
      />
    ) : (
      <PaymentList
        key={`${tab}:${status ?? ""}:${client ?? ""}:${from}:${to}:${proof}`}
        tab={tab}
        role={role}
        status={status}
        proof={proof}
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
        lede={<AdvicesLink />}
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
      {owner || canRefunds || canCredit ? (
        <Tabs
          label={PAY_COPY.heading}
          tabs={[
            ...(owner
              ? [
                  { key: "check" as const, label: PAY_COPY.toCheck, badge },
                  { key: "review" as const, label: GW.needsReview, badge: reviewBadge },
                ]
              : []),
            { key: "all" as const, label: PAY_UI.allPayments },
            ...(canRefunds ? [{ key: "refunds" as const, label: ZO_UI.refundsTab }] : []),
            ...(canCredit ? [{ key: "credit" as const, label: ZO_UI.creditHeldTab }] : []),
          ]}
          selected={tab}
          // Visual review finding 3: the other tab's filters never carry over (the check tab has none; its badge and its list must agree).
          onSelect={(k) =>
            set({
              tab: k === "check" || (!owner && k === "all") ? null : k,
              status: null,
              client: null,
              from: null,
              to: null,
              proof: null,
            })
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

/**
 * M6.4 (run file G5): the way to Remittance advices, the page's lede under its heading, with the count of confirmed PayPal payments that no advice
 * proves yet (the S9 reminder's subject). A failed read shows the link without a count (the count is a hint; the page is the record).
 */
function AdvicesLink() {
  const without = useLoad(() => paymentsApi.withoutAdvice("paypal"), "paypal");
  const n = without.state === "ready" ? without.data.count : 0;
  return (
    <Link to="/payments/advices" className="pay-advices-link">
      <FileText size={20} />
      {ZN.advices}
      {n > 0 && (
        <>
          <span className="tabs__badge" aria-hidden="true">
            {n > 99 ? "99+" : n}
          </span>
          <span className="visually-hidden">, {ZN_UI.withoutCount(n)}</span>
        </>
      )}
    </Link>
  );
}

function PaymentList(props: {
  tab: Tab;
  role: Role;
  status: PaymentStatus | null;
  /** M6.3 (07-ZM S15): only the card payments whose proof is awaited (`?proof=awaited`). */
  proof: boolean;
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
    ...(props.proof ? { proof: "awaited" as const } : {}),
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
    props.status !== null ||
    props.proof ||
    props.client !== undefined ||
    props.from !== "" ||
    props.to !== "";

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
          {r.kind === "tds"
            ? PAY_UI.kindTds
            : r.provider !== "manual"
              ? gatewayLine(r.provider, r.mode, null)
              : `${PAY_UI.kindPayment} · ${r.mode ? MODE_LABELS[r.mode] : ""}`}
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
            {
              key: "proof",
              label: PAY_COPY.proof,
              selected: props.proof ? ["awaited"] : [],
              options: [{ value: "awaited", label: CARD_ZM.proofAwaited }],
            },
          ]}
          onToggle={(g, v) =>
            g === "proof"
              ? props.onFilter({ proof: props.proof ? null : "awaited", tab: "all" })
              : props.onFilter({ status: props.status === v ? null : v, tab: "all" })
          }
          onClear={() =>
            props.onFilter({ status: null, proof: null, client: null, from: null, to: null, tab: "all" })
          }
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
                      <CheckActions row={r} onOpen={(act) => setOpen({ id: r.id, act })} />
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

type Step = "view" | "confirm" | "reject" | "withdraw" | "proof" | "certificate" | "refund";

/** One entry: its facts and what it went on; the role's actions open their own step in the same dialog. */
/**
 * The Owner's actions on a row of "Payments to check", stacked (review M1): Reject for a Staff entry (M6.2, L7: a gateway payment can't be rejected here,
 * 409 `gateway_refund_needed`), then the decision (M6.3 staging fix 2, L5): an entry asking for a proforma is confirmed only by issuing its tax invoice, never
 * by the plain Confirm; review M3: money above the proforma's balance has no confirm at all, and an online payment's line says it waits for a refund.
 */
function CheckActions(props: { row: PaymentView; onOpen: (act: "confirm" | "reject") => void }) {
  const r = props.row;
  const decision = pendingDecisionOf(r);
  const hidden = <span className="visually-hidden">{` ${day(r.receivedOn)} ${r.clientName}`}</span>;
  return (
    <span className="pay-row__acts">
      {r.provider === "manual" && (
        <button type="button" className="btn btn--secondary" onClick={() => props.onOpen("reject")}>
          {PAY_COPY.reject}
          {hidden}
        </button>
      )}
      {decision.kind === "refund" ? (
        <span className="pay-row__refund">{WAITS_REFUND_LINE}</span>
      ) : decision.kind === "issue" ? (
        <Link to={`/invoices/${encodeURIComponent(decision.proformaId)}`} className="btn btn--primary">
          {PAY_UI.confirmByIssuing}
          {hidden}
        </Link>
      ) : decision.kind === "confirm" ? (
        <button type="button" className="btn btn--primary" onClick={() => props.onOpen("confirm")}>
          {PAY_COPY.confirm}
          {hidden}
        </button>
      ) : null}
    </span>
  );
}

function EntryDialog(props: {
  id: string;
  act?: "confirm" | "reject" | undefined;
  role: Role;
  onClose: () => void;
  onChanged: (toast: string) => void;
}) {
  const entry = useLoad(() => paymentsApi.get(props.id), props.id);
  const [step, setStep] = useState<Step>(props.act ?? "view");
  // M6.5: what the payment can give back from credit when "Refund" was pressed (read by the entry view)
  const [refundFree, setRefundFree] = useState(0);
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
  if (step === "refund" && entry.state === "ready") {
    const p = entry.data.payment;
    return (
      <RefundDialog
        mode="refund"
        payments={[
          {
            id: p.id,
            receivedOn: p.receivedOn,
            currency: p.currency,
            freeMinor: refundFree,
            provider: p.provider,
            status: p.status,
            amountMinor: p.amountMinor,
          },
        ]}
        onClose={() => setStep("view")}
        onDone={props.onChanged}
      />
    );
  }
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
          onRefund={(free) => {
            setRefundFree(free);
            setStep("refund");
          }}
          onChanged={props.onChanged}
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
        <ProofForm payment={entry.data.payment} onBack={() => setStep("view")} onDone={props.onChanged} />
      )}
    </Modal>
  );
}

function EntryView(props: {
  data: Awaited<ReturnType<typeof paymentsApi.get>>;
  role: Role;
  onStep: (s: Step) => void;
  /** M6.5: "Refund" (the Owner), with what the payment can give back from credit. */
  onRefund: (freeMinor: number) => void;
  onChanged: (toast: string) => void;
  onClose: () => void;
}) {
  const p = props.data.payment;
  const cur = p.currency;
  const owner = allowed(props.role, "payments.verify");
  const pending = p.status === "pending_verification";
  const decision = pendingDecisionOf(p);
  // M6.2 (L7): a gateway payment is never rejected or withdrawn here (the money goes back by a refund, M6.5), and Razorpay is its own proof. M6.3 (L11, 07-ZM
  // S15): a Stripe payment takes a proof (Stripe's payment advice or the bank's e-FIRA).
  const online = p.provider !== "manual";
  // M6.4: a PayPal payment takes a proof as a Stripe one does (PayPal's FIRA usually proves it through a remittance advice instead)
  const card = p.provider === "stripe" || p.provider === "paypal";
  const canProof =
    (!online || card) &&
    allowed(props.role, "payments.attachProof") &&
    p.kind === "payment" &&
    !p.proof?.hasFile &&
    // M6.4: a payment a remittance advice proves needs no proof of its own
    !props.data.advice &&
    !p.clientGone &&
    (p.status === "pending_verification" || p.status === "confirmed");
  const canCert =
    allowed(props.role, "payments.attachProof") &&
    p.kind === "tds" &&
    p.tds?.certificateAwaited === true &&
    !p.clientGone &&
    (p.status === "pending_verification" || p.status === "confirmed");
  const canWithdraw =
    !online &&
    allowed(props.role, "payments.withdraw") &&
    p.status === "confirmed" &&
    !p.advanceReceiptId &&
    !p.clientGone;
  // M6.5 (G1, L33): "Refund" for the Owner: a confirmed payment that still holds credit (the client's credit sources say how much), or a gateway payment still
  // waiting for its check (refunded whole through its gateway). Never for a TDS entry, a withdrawn or rejected one, or an erased client.
  const refundRole = allowed(props.role, "refunds.issue") && p.kind === "payment" && !p.clientGone;
  const credit = useLoad(
    () =>
      refundRole && p.status === "confirmed" ? paymentsApi.clientCredit(p.clientId) : Promise.resolve(null),
    `${p.id}:${refundRole}:${p.status}`,
  );
  const free =
    credit.state === "ready"
      ? (credit.data?.sources.find((s) => s.paymentId === p.id)?.availableMinor ?? 0)
      : 0;
  const canRefund = refundRole && ((p.status === "confirmed" && free > 0) || (pending && online));
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
                <dd>
                  {online ? (
                    <>
                      {GW_UI.paidOnline}
                      <span className="pay-lines__meta">{gatewayLine(p.provider, p.mode, null)}</span>
                    </>
                  ) : p.mode ? (
                    MODE_LABELS[p.mode]
                  ) : (
                    ""
                  )}
                </dd>
              </div>
              <div>
                {/* M6.4: a PayPal payment's reference is its capture id, as PayPal's dashboard shows it (review finding 13's "Payment ID"), not a UTR */}
                <dt>{p.provider === "paypal" ? GW_UI.paymentId : PAY_COPY.reference}</dt>
                <dd className="docno break">
                  {p.provider === "paypal" ? (p.providerPaymentId ?? p.reference) : p.reference}
                </dd>
              </div>
              {p.chargesMinor > 0 &&
                (online ? (
                  <div>
                    <dt>{PAY_COPY.charges}</dt>
                    <dd className="tnum">{GW.feeAbsorbed(amountText(p.chargesMinor, cur))}</dd>
                  </div>
                ) : (
                  <div>
                    <dt>{PAY_COPY.charges}</dt>
                    <dd className="tnum">{amountText(p.chargesMinor, cur)}</dd>
                  </div>
                ))}
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
          {/* M6.4: a payment on a remittance advice is proved by it (its own line below), so "Proof awaited" isn't said of it */}
          {p.kind === "payment" && (!online || card) && (p.proof?.hasFile || !props.data.advice) && (
            <div>
              <dt>{PAY_COPY.proof}</dt>
              <dd>
                {p.proof?.hasFile ? (
                  <a href={paymentsApi.proofHref(p.id)} className="pay-proof-link">
                    <FileText size={16} />
                    {[p.proof.kind, p.proof.ref].filter(Boolean).join(" · ") || PAY_UI.openProof}
                  </a>
                ) : card ? (
                  <span className="pay-badge">{CARD_ZM.proofAwaited}</span>
                ) : (
                  <span className="pay-lines__meta">{PAY_UI.noProof}</span>
                )}
              </dd>
            </div>
          )}
          {/* M6.4 (run file G5): the remittance advice that proves it, when the API says (absent from an older API: no line) */}
          {props.data.advice !== undefined && p.kind === "payment" && p.status === "confirmed" && (
            <div>
              <dt>{ZN_UI.adviceLabel}</dt>
              <dd>
                {props.data.advice ? (
                  <Link
                    to={`/payments/advices?advice=${encodeURIComponent(props.data.advice.id)}`}
                    className="pay-proof-link"
                  >
                    <FileText size={16} />
                    <span>
                      {ADVICE_KIND_LABELS[props.data.advice.kind]}{" "}
                      <span className="docno break">{props.data.advice.adviceRef}</span>
                    </span>
                  </Link>
                ) : (
                  <span className="pay-lines__meta">{ZN_UI.adviceNone}</span>
                )}
              </dd>
            </div>
          )}
          <div>
            <dt>{PAY_UI.recordedBy}</dt>
            <dd>
              {p.recordedByName ?? (online ? gatewayName(p.provider) : "")} <When ms={p.recordedAt} inline />
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
        {/* M6.3 staging fixes, review M3: online money above the proforma's balance waits for a refund (no Confirm of any kind below) */}
        {pending && decision.kind === "refund" && (
          <p className="approval-line" data-state="pending">
            <Alert size={16} />
            <span>{WAITS_REFUND_LINE}</span>
          </p>
        )}
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
        <PaymentReceiptAndRefunds
          paymentId={p.id}
          kind={p.kind}
          status={p.status}
          role={props.role}
          onChanged={props.onChanged}
        />
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose}>
          {PAY_UI.close}
        </button>
        {canRefund && (
          <button type="button" className="btn btn--secondary" onClick={() => props.onRefund(free)}>
            {ZO_UI.refund}
          </button>
        )}
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
            {!online && (
              <button type="button" className="btn btn--secondary" onClick={() => props.onStep("reject")}>
                {PAY_COPY.reject}
              </button>
            )}
            {/* M6.3 staging fix 2 (L5): never the plain Confirm for an entry that asks for a proforma; review M3: nothing for money above its balance */}
            {decision.kind === "issue" ? (
              <Link to={`/invoices/${encodeURIComponent(decision.proformaId)}`} className="btn btn--primary">
                {PAY_UI.confirmByIssuing}
              </Link>
            ) : decision.kind === "confirm" ? (
              <button type="button" className="btn btn--primary" onClick={() => props.onStep("confirm")}>
                {PAY_COPY.confirm}
              </button>
            ) : null}
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
  // M6.3 staging fix 2 (L5): the entry's own proforma (the server's `proformaId`: its request or its online checkout) needs no read; an older API's answer
  // falls back to what the read of its request found.
  const own = pendingDecisionOf(p);
  const proformaAsk =
    own.kind !== "confirm"
      ? own.proformaId
      : load.state === "ready" && load.data.kind === "proforma"
        ? load.data.id
        : null;
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
      // second review, M1: the RA-41 line (S34) when the confirmed credit may be an advance
      props.onDone(
        [PAY_UI.confirmed, w ? earlierMonthLine(w.month) : "", ra41ConfirmLine(r.ra41)]
          .filter(Boolean)
          .join(" "),
      );
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
            <span>{own.kind === "refund" ? WAITS_REFUND_LINE : PAY_COPY.proformaLine}</span>
          </p>
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onBack}>
            {INV_COPY.cancel}
          </button>
          {/* review M3: money above the proforma's balance has no way to be confirmed */}
          {own.kind !== "refund" && own.kind !== "reject" && (
            <Link to={`/invoices/${encodeURIComponent(proformaAsk)}`} className="btn btn--primary">
              {PAY_UI.confirmByIssuing}
            </Link>
          )}
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
