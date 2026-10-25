// Approvals (M4.3, ADM-APR-01, -02): the owner's queue of discount requests (more than 10 % off the catalogue prices), newest first, with
// the decision dialog; Staff and Sales see the requests they made and how each was decided. A request is for one version's exact content:
// a change to the draft after it expires the request, and the queue shows it as expired. `/approvals/:id` (the bell's link) opens that
// request's dialog for the owner. The custom lines the guard ignores are listed in the dialog, so the owner sees the whole offer (O-Q1).
import "./documents/parts.tsx";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { type Column, DataTable, FilterBar } from "../components/data-table.tsx";
import { Modal } from "../components/dialog.tsx";
import { EmptyState, PageHeader, When } from "../components/display.tsx";
import { FormField } from "../components/form.tsx";
import { ClipboardCheck, Search } from "../components/icons.tsx";
import { LoadFailed, NoAccess, useLoad } from "../components/states.tsx";
import { useToast } from "../components/toast.tsx";
import { Notice } from "../components/ui.tsx";
import { allowed } from "../lib/access.ts";
import {
  APPROVAL_FILTERS,
  APPROVAL_LABELS,
  DOC_COPY,
  DOC_PENDING,
  DOC_TOASTS,
  decisionLine,
  decisionTitle,
  docErrorText,
  moneyText,
  rateText,
  titleOf,
} from "../lib/documents.ts";
import { type ApprovalRow, type ApprovalState, documentsApi } from "../lib/documents-api.ts";
import { useUser } from "../session.tsx";
import { ApprovalPill, docHref } from "./documents/parts.tsx";

export function Component() {
  const user = useUser();
  if (!allowed(user.role, "approvals.readOwn") && !allowed(user.role, "approvals.decide"))
    return <NoAccess what={DOC_COPY.approvalsHeading} />;
  return <Approvals />;
}

const isState = (v: string | null): v is Exclude<ApprovalState, "none"> =>
  APPROVAL_FILTERS.includes(v as ApprovalState);

function Approvals() {
  const user = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  const { id: linked } = useParams();
  const owner = allowed(user.role, "approvals.decide");
  const [params, setParams] = useSearchParams();
  // The owner starts on what waits for them; a bell link shows every state, so the request is on the page whatever happened to it.
  const stateP = params.get("state");
  const state = stateP === "all" ? null : isState(stateP) ? stateP : owner && !linked ? "pending" : null;
  const [deciding, setDeciding] = useState<ApprovalRow | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [more, setMore] = useState<ApprovalRow[]>([]);
  const key = `${state ?? "all"}`;
  const list = useLoad(() => documentsApi.approvals({ status: state ?? undefined }), key);
  const rows = [...(list.data?.approvals ?? []), ...more];
  const next = more.length ? after : (list.data?.next ?? null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new filter starts again from the first page
  useEffect(() => {
    setMore([]);
    setAfter(null);
  }, [key]);

  // The bell's link: open that request (the owner decides it; anyone else sees it in the list).
  useEffect(() => {
    if (!linked || list.state !== "ready" || !owner) return;
    const row = list.data.approvals.find((a) => a.id === linked);
    if (row && row.state === "pending" && row.document.status === "draft") setDeciding(row);
  }, [linked, list.state, list.data, owner]);

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
      <PageHeader title={DOC_COPY.approvalsHeading} />
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
        onClear={() => setParams(new URLSearchParams({ state: "all" }), { replace: true })}
        result={
          list.state === "loading"
            ? "Loading…"
            : `${rows.length === 1 ? "1 request" : `${rows.length} requests`} on this page`
        }
      />
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
                      <button type="button" className="btn btn--secondary" onClick={() => setDeciding(r)}>
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
          if (linked) navigate("/approvals", { replace: true });
        }}
        onDecided={(approved) => {
          toast("success", approved ? DOC_TOASTS.approved : DOC_TOASTS.rejected);
          setDeciding(null);
          if (linked) navigate("/approvals", { replace: true });
          list.reload(true);
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
