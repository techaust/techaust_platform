// Approvals (M4.3, ADM-APR-01, -02; M5.1 adds the issue requests, kept in their own tab): the owner's queue of discount requests (more than 10 % off the catalogue prices), newest first, with
// the decision dialog; Staff and Sales see the requests they made and how each was decided. A request is for one version's exact content:
// a change to the draft after it expires the request, and the queue shows it as expired. `/approvals/:id` (the bell's link) opens that
// request's dialog for the owner, loaded by its id when it is older than the first page. The custom lines the guard ignores are listed in the
// dialog, so the owner sees the whole offer (O-Q1). Each tab shows how many requests wait in it, and the page opens on the one that has
// requests waiting when the other has none (M5.1 review findings 7 and 8).
import "./documents/parts.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { paymentsApi } from "../api.ts";
import { type Column, DataTable, FilterBar } from "../components/data-table.tsx";
import { Modal } from "../components/dialog.tsx";
import { EmptyState, PageHeader, When } from "../components/display.tsx";
import { FormField } from "../components/form.tsx";
import { Ban, CheckCircle, ClipboardCheck, Search } from "../components/icons.tsx";
import { LoadFailed, NoAccess, useLoad } from "../components/states.tsx";
import { Tabs } from "../components/tabs.tsx";
import { useToast } from "../components/toast.tsx";
import { Notice } from "../components/ui.tsx";
import { allowed } from "../lib/access.ts";
import {
  APPROVAL_FILTERS,
  APPROVAL_LABELS,
  bellDecided,
  DOC_COPY,
  DOC_PENDING,
  DOC_TOASTS,
  decisionLine,
  decisionTitle,
  docErrorText,
  moneyText,
  pendingBadge,
  rateText,
  titleOf,
} from "../lib/documents.ts";
import { type ApprovalRow, type ApprovalState, documentsApi } from "../lib/documents-api.ts";
import { INV_COPY } from "../lib/invoices.ts";
import { invoicesApi } from "../lib/invoices-api.ts";
import { PAY_COPY } from "../lib/payments.ts";
import { useUser } from "../session.tsx";
import { ApprovalPill, docHref } from "./documents/parts.tsx";
import { IssueQueue } from "./invoices/issue-queue.tsx";
import { PaymentApprovals } from "./payments/approvals-tab.tsx";

export function Component() {
  const user = useUser();
  if (!allowed(user.role, "approvals.readOwn") && !allowed(user.role, "approvals.decide"))
    return <NoAccess what={DOC_COPY.approvalsHeading} />;
  return <Approvals />;
}

type QueueKind = "discount" | "issue" | "payment";

/** The page: the heading, the kind of request (discounts; and, for the roles that read invoices, issue requests, M5.1), the status filter. */
function Approvals() {
  const user = useUser();
  const navigate = useNavigate();
  const { id: linked } = useParams();
  const owner = allowed(user.role, "approvals.decide");
  const invoices = allowed(user.role, "invoices.read");
  const [params, setParams] = useSearchParams();
  const kindP = params.get("kind");
  // M6.1 (ADM-APR-01): the payment items, for the roles that read payments; decided on Payments (L18).
  const payments = allowed(user.role, "payments.read");
  const urlKind: QueueKind =
    invoices && kindP === "issue" ? "issue" : payments && kindP === "payment" ? "payment" : "discount";
  // The owner starts on what waits for them; a bell link shows every state, so the request is on the page whatever happened to it.
  const stateP = params.get("state");
  const state = stateP === "all" ? null : isState(stateP) ? stateP : owner && !linked ? "pending" : null;
  // A bell's link names a request; an older bell's link has no kind: the request is looked up by its id in the issue queue, and found there
  // it switches to that tab.
  const probe = useLoad(
    () =>
      linked && invoices && kindP === null
        ? invoicesApi.issueApprovals({ id: linked })
        : Promise.resolve(null),
    `${linked ?? ""}:${kindP ?? ""}`,
  );
  // Until the lookup answers, neither queue loads (no discount lookup for an issue request); found, the issue queue opens at once and
  // takes the request already read (one read of it, re-check low 4).
  const probing = !!linked && invoices && kindP === null && probe.state === "loading";
  const probeFound = probe.state === "ready" && !!probe.data?.approvals.some((a) => a.id === linked);
  const kind: QueueKind = probeFound ? "issue" : urlKind;
  // How many requests wait in each queue (the first page of each; "50+" past it), for the tabs.
  const counts = useLoad(
    () =>
      invoices
        ? Promise.all([
            documentsApi.approvals({ status: "pending", limit: "50" }),
            invoicesApi.issueApprovals({ status: "pending", limit: "50" }),
            payments ? paymentsApi.approvals({ status: "pending" }) : Promise.resolve(null),
          ])
        : Promise.resolve(null),
    String(invoices),
  );
  const waiting = (r: { approvals: unknown[]; next: string | null } | undefined) =>
    r ? { n: r.approvals.length, more: r.next !== null } : null;
  const discountWaiting = counts.state === "ready" ? waiting(counts.data?.[0]) : null;
  const issueWaiting = counts.state === "ready" ? waiting(counts.data?.[1]) : null;
  const paymentWaiting = counts.state === "ready" ? waiting(counts.data?.[2] ?? undefined) : null;
  const switchTo = useCallback(
    (k: QueueKind) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (k === "issue" || k === "payment") n.set("kind", k);
          else n.delete("kind");
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );
  useEffect(() => {
    if (probeFound) switchTo("issue");
  }, [probeFound, switchTo]);
  // Opened without a kind or a linked request: the queue that has requests waiting, when only the issue queue has some.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || linked || kindP !== null || !discountWaiting || !issueWaiting) return;
    opened.current = true;
    if (discountWaiting.n === 0 && issueWaiting.n > 0) switchTo("issue");
  }, [linked, kindP, discountWaiting, issueWaiting, switchTo]);
  const onLinkedDone = () => {
    if (linked)
      navigate(
        { pathname: "/approvals", search: kind === "discount" ? "" : `?kind=${kind}` },
        { replace: true },
      );
  };

  const filters = (
    <FilterBar
      className="filters--clients filters--care"
      groups={[
        {
          key: "state",
          label: "Status",
          selected: state ? [state] : [],
          options: APPROVAL_FILTERS.map((s) => ({
            value: s,
            label: APPROVAL_LABELS[s as Exclude<ApprovalState, "none">],
          })),
        },
      ]}
      onToggle={(_, value) =>
        setParams(
          (p) => {
            const n = new URLSearchParams(p);
            n.set("state", state === value ? "all" : value);
            return n;
          },
          { replace: true },
        )
      }
      onClear={() =>
        setParams(new URLSearchParams(kind !== "discount" ? { state: "all", kind } : { state: "all" }), {
          replace: true,
        })
      }
      result=""
    />
  );
  const queue = probing ? (
    <div aria-busy="true" />
  ) : kind === "payment" ? (
    <PaymentApprovals key={state ?? "all"} owner={owner} state={state} />
  ) : kind === "issue" ? (
    <IssueQueue
      owner={owner}
      state={state}
      linked={linked}
      linkedFirst={probeFound ? probe.data : undefined}
      onLinkedDone={onLinkedDone}
      onDecided={() => counts.reload(true)}
    />
  ) : (
    <DiscountQueue
      owner={owner}
      state={state}
      linked={linked}
      onLinkedDone={onLinkedDone}
      onDecided={() => counts.reload(true)}
    />
  );

  return (
    <>
      <PageHeader title={DOC_COPY.approvalsHeading} />
      {invoices ? (
        <Tabs
          label={DOC_COPY.approvalsHeading}
          tabs={[
            { key: "discount", label: DOC_COPY.colDiscount, badge: pendingBadge(discountWaiting) },
            { key: "issue", label: INV_COPY.kindIssue, badge: pendingBadge(issueWaiting) },
            ...(payments
              ? [{ key: "payment" as const, label: PAY_COPY.heading, badge: pendingBadge(paymentWaiting) }]
              : []),
          ]}
          selected={kind}
          onSelect={switchTo}
        >
          {filters}
          {queue}
        </Tabs>
      ) : (
        <>
          {filters}
          {queue}
        </>
      )}
    </>
  );
}

/** A row's Decide button in the layout on screen (the table and the cards both draw it; one of them is hidden). */
const visibleDecide = (id: string): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>("[data-decide]")].find(
    (b) => b.dataset.decide === id && b.offsetParent !== null,
  ) ?? null;

const isState = (v: string | null): v is Exclude<ApprovalState, "none"> =>
  APPROVAL_FILTERS.includes(v as ApprovalState);

/** The discount requests (M4.3): more than 10 % off the catalogue prices. */
function DiscountQueue(props: {
  owner: boolean;
  state: Exclude<ApprovalState, "none"> | null;
  linked: string | undefined;
  onLinkedDone: () => void;
  onDecided: () => void;
}) {
  const toast = useToast();
  const { owner, state, linked } = props;
  const [deciding, setDeciding] = useState<ApprovalRow | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [more, setMore] = useState<ApprovalRow[]>([]);
  const key = `${state ?? "all"}`;
  const list = useLoad(() => documentsApi.approvals({ status: state ?? undefined }), key);
  // A bell's request older than the first page: read by its id and shown first.
  const linkedRow = useLoad(
    () => (linked ? documentsApi.approvals({ id: linked }) : Promise.resolve(null)),
    linked ?? "",
  );
  const extra =
    linkedRow.state === "ready" && list.state === "ready"
      ? (linkedRow.data?.approvals ?? []).filter(
          (a) => ![...list.data.approvals, ...more].some((r) => r.id === a.id),
        )
      : [];
  const rows = [...extra, ...(list.data?.approvals ?? []), ...more];
  const next = more.length ? after : (list.data?.next ?? null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new filter starts again from the first page
  useEffect(() => {
    setMore([]);
    setAfter(null);
  }, [key]);

  // After a decision (review fix 6): once the list has the answer, focus goes to the next request waiting for a decision, else to the
  // result line, so it never falls back to the page when the decided row's button leaves the list.
  const [result, setResult] = useState<{
    id: string;
    approved: boolean;
    text: string;
    focused?: boolean;
  } | null>(null);
  useEffect(() => {
    if (!result || result.focused || list.state !== "ready") return;
    if (list.data.approvals.some((a) => a.id === result.id && a.state === "pending")) return; // the old page, still
    const nextRow = [...list.data.approvals, ...more].find(
      (a) => a.id !== result.id && a.state === "pending" && a.document.status === "draft",
    );
    requestAnimationFrame(() => {
      const target = (nextRow && visibleDecide(nextRow.id)) || document.getElementById("decided-line");
      target?.focus();
    });
    setResult({ ...result, focused: true });
  }, [result, list.state, list.data, more]);

  // The bell's link: open that request (the owner decides it; anyone else sees it in the list).
  const linkedDone = useRef<string | null>(null);
  useEffect(() => {
    if (!linked || list.state !== "ready" || !owner || linkedDone.current === linked) return;
    const row =
      list.data.approvals.find((a) => a.id === linked) ??
      (linkedRow.state === "ready" ? linkedRow.data?.approvals.find((a) => a.id === linked) : undefined);
    if (!row && linkedRow.state === "loading") return;
    linkedDone.current = linked;
    if (row && row.state === "pending" && row.document.status === "draft") setDeciding(row);
  }, [linked, list.state, list.data, linkedRow.state, linkedRow.data, owner]);

  const columns: Column<ApprovalRow>[] = [
    {
      key: "doc",
      header: DOC_COPY.colDocument,
      card: "title",
      width: "30%",
      cell: (r) => (
        <span className="person client-name doc-name">
          <Link
            className="person__name client-name__link"
            to={docHref({ id: r.document.id, type: r.document.type })}
          >
            {titleOf(r.document.title)}
          </Link>
          <span className="client-name__code doc-name__meta">
            <span>{r.document.clientName}</span>
            <span className="docno">{r.document.clientCode}</span>
            <span className="docno">v{r.document.version}</span>
          </span>
        </span>
      ),
    },
    {
      key: "by",
      header: DOC_COPY.colRequestedBy,
      cell: (r) => <span>{r.requesterName ?? DOC_PENDING.theOwner}</span>,
    },
    {
      key: "discount",
      header: DOC_COPY.colDiscount,
      align: "end",
      cell: (r) => (
        <span className="doc-amount">
          <span className="tnum">{rateText(r.discountBp)}</span>
          {r.customLineCount > 0 && (
            <span className="doc-amount__custom">{DOC_PENDING.customLinesCount(r.customLineCount)}</span>
          )}
        </span>
      ),
    },
    {
      key: "total",
      header: DOC_COPY.colTotal,
      align: "end",
      cell: (r) =>
        r.totalMinor === undefined ? null : (
          <span className="tnum">{moneyText(r.totalMinor, r.document.currency)}</span>
        ),
    },
    { key: "at", header: DOC_COPY.colRequested, cell: (r) => <When ms={r.createdAt} /> },
    {
      key: "state",
      header: "Status",
      cell: (r) => (r.state === "none" ? null : <ApprovalPill state={r.state} />),
    },
  ];

  return (
    <>
      <p id="decided-line" className="decided-line" tabIndex={-1} role="status">
        {result && (
          <>
            {result.approved ? <CheckCircle size={16} /> : <Ban size={16} />}
            <span>{result.text}</span>
          </>
        )}
      </p>
      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="clients-table approvals-table">
          <DataTable
            caption={DOC_COPY.approvalsHeading}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={list.state === "loading"}
            skeletonRows={4}
            actions={
              owner
                ? (r) =>
                    r.state === "pending" && r.document.status === "draft" ? (
                      <button
                        type="button"
                        data-decide={r.id}
                        className="btn btn--secondary"
                        onClick={() => setDeciding(r)}
                      >
                        Decide<span className="visually-hidden"> on {titleOf(r.document.title)}</span>
                      </button>
                    ) : null
                : undefined
            }
            empty={
              <EmptyState
                icon={state && state !== "pending" ? <Search /> : <ClipboardCheck />}
                title={
                  owner && state === "pending"
                    ? DOC_COPY.approvalsEmpty.replace(/\.$/, "")
                    : DOC_PENDING.noOpenApprovals.replace(/\.$/, "")
                }
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
          onClick={async () => {
            const r = await documentsApi.approvals({ status: state ?? undefined, after: next });
            setMore((m) => [...m, ...r.approvals]);
            setAfter(r.next);
          }}
        >
          {DOC_PENDING.showMoreRequests}
        </button>
      )}
      <DecisionDialog
        row={deciding}
        onClose={() => {
          setDeciding(null);
          props.onLinkedDone();
        }}
        onDecided={(approved) => {
          const r = deciding;
          toast("success", approved ? DOC_TOASTS.approved : DOC_TOASTS.rejected);
          if (r)
            setResult({
              id: r.id,
              approved,
              text: bellDecided(approved, titleOf(r.document.title), r.document.version),
            });
          setDeciding(null);
          props.onLinkedDone();
          list.reload(true);
          props.onDecided();
        }}
      />
    </>
  );
}

/** Approve or reject one request for one content (ADM-APR-01): the discount and total, the custom lines, the requester's reason. */
function DecisionDialog(props: {
  row: ApprovalRow | null;
  onClose: () => void;
  onDecided: (approved: boolean) => void;
}) {
  const r = props.row;
  return (
    <Modal
      open={!!r}
      title={r ? decisionTitle(titleOf(r.document.title), r.document.version) : ""}
      onClose={props.onClose}
    >
      {r && <DecisionForm row={r} onClose={props.onClose} onDecided={props.onDecided} />}
    </Modal>
  );
}

function DecisionForm(props: {
  row: ApprovalRow;
  onClose: () => void;
  onDecided: (approved: boolean) => void;
}) {
  const r = props.row;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The document itself: its total as saved and the custom lines with their descriptions (the queue row carries only the count).
  const doc = useLoad(() => documentsApi.get(r.document.id), r.document.id);
  const total = doc.data?.totals?.totalMinor ?? r.totalMinor ?? null;
  const custom = doc.data?.guard?.customLines ?? [];

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setError(null);
    try {
      await documentsApi.decide(r.id, decision, note.trim() || undefined);
      props.onDecided(decision === "approve");
    } catch (e) {
      setError(docErrorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="dialog__body decision">
        {total !== null && (
          <p className="confirm-figure tnum">
            {decisionLine(r.discountBp, moneyText(total, r.document.currency))}
          </p>
        )}
        <dl className="decision__facts">
          <div>
            <dt>Client</dt>
            <dd>
              {r.document.clientName} <span className="docno">{r.document.clientCode}</span>
            </dd>
          </div>
          <div>
            <dt>{DOC_COPY.colRequestedBy}</dt>
            <dd>{r.requesterName ?? DOC_PENDING.theOwner}</dd>
          </div>
          {r.reason && (
            <div>
              <dt>{DOC_COPY.reason}</dt>
              <dd className="decision__reason">{r.reason}</dd>
            </div>
          )}
        </dl>
        {custom.length > 0 && (
          <div className="decision__custom">
            <p className="decision__custom-h">{DOC_COPY.customLine}</p>
            <ul>
              {custom.map((c) => (
                <li key={c.position}>
                  <span>{c.description}</span>
                  {c.taxableMinor !== null && (
                    <span className="tnum">{moneyText(c.taxableMinor, r.document.currency)}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <FormField id="decision-note" label={DOC_COPY.noteOptional}>
          {(a) => (
            <textarea
              {...a}
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </FormField>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy !== null}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => decide("reject")}
          disabled={busy !== null}
          aria-busy={busy === "reject" || undefined}
        >
          {DOC_COPY.reject}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => decide("approve")}
          disabled={busy !== null}
          aria-busy={busy === "approve" || undefined}
        >
          {DOC_COPY.approve}
        </button>
      </div>
    </>
  );
}
