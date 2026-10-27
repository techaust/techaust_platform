// Issue requests in the approvals queue (M5.1, ADM-APR-01/02, Q6): Staff ask the owner to issue a draft invoice; the owner issues it from here
// (approve = issue, with a fresh code and the next number) or rejects it with an optional reason shown to the requester. A request is for one
// content: a change to the draft afterwards expires it, and the queue shows it as expired. Staff see their own requests and how each went.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { stepUpActive } from "../../api.ts";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { Modal } from "../../components/dialog.tsx";
import { EmptyState, When } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import { Ban, CheckCircle, ClipboardCheck, Search } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { CodeField, Notice } from "../../components/ui.tsx";
import { DOC_COPY, DOC_PENDING, DOC_TOASTS } from "../../lib/documents.ts";
import type { ApprovalState } from "../../lib/documents-api.ts";
import { INVT_COPY } from "../../lib/invoice-types.ts";
import {
  INV_COPY,
  invErrorText,
  issuedToast,
  moneyText,
  rejectReasonLabel,
  requestRow,
  typeLabel,
} from "../../lib/invoices.ts";
import { type IssueApprovalRow, invoicesApi } from "../../lib/invoices-api.ts";
import { withCode } from "../../lib/step-up.ts";
import { ApprovalPill } from "../documents/parts.tsx";
import { invoiceHref, NumberMark } from "./parts.tsx";

const CODE_MISSING = "Enter the 6-digit code from your authenticator app.";

export function IssueQueue(props: {
  owner: boolean;
  state: Exclude<ApprovalState, "none"> | null;
  /** The bell's request: its dialog opens for the owner (read by its id when it is older than the first page). */
  linked: string | undefined;
  /** The bell's request as the page already read it (looking it up by id to pick the tab): used instead of a second read. */
  linkedFirst?: { approvals: IssueApprovalRow[]; next: string | null } | null | undefined;
  onLinkedDone: () => void;
  /** A request was decided (the page's counts change). */
  onDecided?: () => void;
}) {
  const toast = useToast();
  const [deciding, setDeciding] = useState<IssueApprovalRow | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [more, setMore] = useState<IssueApprovalRow[]>([]);
  const [result, setResult] = useState<{ approved: boolean; text: string } | null>(null);
  const key = props.state ?? "all";
  const list = useLoad(() => invoicesApi.issueApprovals({ status: props.state ?? undefined }), key);
  // A bell's request older than the first page (M5.1 review finding 8): read by its id and shown first.
  const linkedRow = useLoad(
    () =>
      props.linkedFirst !== undefined
        ? Promise.resolve(props.linkedFirst)
        : props.linked
          ? invoicesApi.issueApprovals({ id: props.linked })
          : Promise.resolve(null),
    props.linked ?? "",
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

  const linkedDone = useRef<string | null>(null);
  useEffect(() => {
    const linked = props.linked;
    if (!linked || list.state !== "ready" || !props.owner || linkedDone.current === linked) return;
    const row =
      list.data.approvals.find((a) => a.id === linked) ??
      (linkedRow.state === "ready" ? linkedRow.data?.approvals.find((a) => a.id === linked) : undefined);
    if (!row && linkedRow.state === "loading") return;
    linkedDone.current = linked;
    if (row && row.state === "pending" && row.document.status === "draft") setDeciding(row);
  }, [props.linked, list.state, list.data, linkedRow.state, linkedRow.data, props.owner]);

  const columns: Column<IssueApprovalRow>[] = [
    {
      key: "doc",
      header: DOC_COPY.colDocument,
      card: "title",
      width: "30%",
      cell: (r) => (
        <span className="person inv-name">
          <Link className="inv-name__link" to={invoiceHref(r.document.id)}>
            <NumberMark number={r.document.number} void={r.document.status === "void"} />
          </Link>
          <span className="client-name__code doc-name__meta">
            <span>{r.document.clientName}</span>
            <span className="docno">{r.document.clientCode}</span>
            <span>{typeLabel(r.document.type)}</span>
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
      key: "total",
      header: DOC_COPY.colTotal,
      align: "end",
      cell: (r) => <span className="tnum">{moneyText(r.totalMinor, r.document.currency)}</span>,
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
        <div className="clients-table approvals-table inv-requests">
          <DataTable
            caption={`${DOC_COPY.approvalsHeading}: ${INV_COPY.kindIssue}`}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={list.state === "loading"}
            skeletonRows={3}
            actions={
              props.owner
                ? (r) =>
                    r.state === "pending" && r.document.status === "draft" ? (
                      <button
                        type="button"
                        data-decide={r.id}
                        className="btn btn--secondary"
                        onClick={() => setDeciding(r)}
                      >
                        Decide
                        <span className="visually-hidden"> on the invoice for {r.document.clientName}</span>
                      </button>
                    ) : null
                : undefined
            }
            empty={
              <EmptyState
                icon={props.state && props.state !== "pending" ? <Search /> : <ClipboardCheck />}
                title={
                  props.owner && props.state === "pending"
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
            const r = await invoicesApi.issueApprovals({ status: props.state ?? undefined, after: next });
            setMore((m) => [...m, ...r.approvals]);
            setAfter(r.next);
          }}
        >
          {DOC_PENDING.showMoreRequests}
        </button>
      )}
      <Modal
        open={!!deciding}
        title={INV_COPY.kindIssue}
        onClose={() => {
          setDeciding(null);
          props.onLinkedDone();
        }}
      >
        {deciding && (
          <IssueDecision
            row={deciding}
            onClose={() => {
              setDeciding(null);
              props.onLinkedDone();
            }}
            onDecided={(approved, number) => {
              const text = approved ? issuedToast(number ?? "") : DOC_TOASTS.rejected;
              toast("success", text);
              setResult({ approved, text });
              setDeciding(null);
              props.onLinkedDone();
              list.reload(true);
              props.onDecided?.();
              requestAnimationFrame(() => document.getElementById("decided-line")?.focus());
            }}
          />
        )}
      </Modal>
    </>
  );
}

/** Issue or reject one request (07-R §3): who asked, for whom, the total; approving issues it now and needs the owner's code. */
function IssueDecision(props: {
  row: IssueApprovalRow;
  onClose: () => void;
  onDecided: (approved: boolean, number: string | null) => void;
}) {
  const r = props.row;
  const requester = r.requesterName ?? DOC_PENDING.theOwner;
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsCode = !stepUpActive();
  // Q8 (07-S §4): an export invoice in INR is approved only with the explicit "Issue in INR"; the question is on the dialog before the button.
  const inrExport = r.document.type === "export_invoice" && r.document.currency === "INR";

  async function decide(decision: "approve" | "reject") {
    if (decision === "approve" && needsCode && code.length !== 6) {
      setCodeError(CODE_MISSING);
      document.getElementById("issue-decide-code")?.focus();
      return;
    }
    setCodeError(null);
    setBusy(decision);
    setError(null);
    try {
      const n = note.trim() || undefined;
      if (decision === "approve") {
        const done = await withCode(needsCode ? code : undefined, () =>
          invoicesApi.decide(r.id, "approve", n, inrExport),
        );
        props.onDecided(true, "number" in done ? done.number : null);
      } else {
        await invoicesApi.decide(r.id, "reject", n);
        props.onDecided(false, null);
      }
    } catch (e) {
      setError(invErrorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="dialog__body decision">
        <p className="inv-request-line">
          {requestRow(requester, r.document.clientName, moneyText(r.totalMinor, r.document.currency))}
        </p>
        <p>{INV_COPY.approveNote}</p>
        <FormField id="issue-decide-note" label={rejectReasonLabel(requester)}>
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
        {inrExport && (
          <div className="inv-inr-ask">
            <p>{INVT_COPY.inrConfirm}</p>
          </div>
        )}
      </div>
      {needsCode && (
        <CodeField
          id="issue-decide-code"
          label="Authenticator code"
          hint="Enter the 6-digit code from your authenticator app to continue."
          value={code}
          onChange={setCode}
          error={codeError}
        />
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy !== null}>
          {INV_COPY.cancel}
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => decide("reject")}
          disabled={busy !== null}
          aria-busy={busy === "reject" || undefined}
        >
          {INV_COPY.rejectButton}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => decide("approve")}
          disabled={busy !== null}
          aria-busy={busy === "approve" || undefined}
        >
          {inrExport ? INVT_COPY.issueInInr : INV_COPY.approveButton}
        </button>
      </div>
    </>
  );
}
