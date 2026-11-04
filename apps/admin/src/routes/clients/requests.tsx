// The client page's Requests panel (M7.1; POR-09, POR-11; run file G.7, L8): what this client's contacts asked for from the portal (a change to someone's
// access, a copy, correction or erasure of their personal data, or a concern about how we handle it), newest first, 50 a page. Staff close a contact change or
// a grievance; every data-rights kind is the Owner's (the API's `canClose` per row, held again in the close UPDATE and trigger `client_requests_owner_close`).
// The close dialog takes the outcome and an optional note for the record (S6: no personal data). The 30-day clock is M7.4's. Words: lib/copy-zp.ts (S2, S6).
import { useId, useState } from "react";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { Modal, useRefusalFocus } from "../../components/dialog.tsx";
import { EmptyState, StatusPill, When } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import { Inbox } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { REQUESTS_CHANGED, ZP_UI } from "../../lib/copy-zp.ts";
import { type ClientRequestView, requestsApi } from "../../lib/m71-api.ts";
import { m71ErrorText } from "../../lib/m71-errors.ts";

const kindText = (k: string) => ZP_UI.kind[k] ?? k;

export function ClientRequests(props: { clientId: string }) {
  const toast = useToast();
  const list = useLoad(() => requestsApi.list({ client: props.clientId }), props.clientId);
  const [more, setMore] = useState<ClientRequestView[]>([]);
  const [after, setAfter] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [closing, setClosing] = useState<ClientRequestView | null>(null);
  const rows = [...(list.data?.items ?? []), ...more];
  const next = after === undefined ? (list.data?.next ?? null) : after;

  function reload() {
    setMore([]);
    setAfter(undefined);
    list.reload(true);
    window.dispatchEvent(new Event(REQUESTS_CHANGED));
  }

  async function showMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const r = await requestsApi.list({ client: props.clientId, after: next });
      setMore((m) => [...m, ...r.items.filter((x) => !m.some((y) => y.id === x.id))]);
      setAfter(r.items.length > 0 ? r.next : null);
    } catch (e) {
      toast("error", m71ErrorText(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const columns: Column<ClientRequestView>[] = [
    { key: "sent", header: ZP_UI.colSent, card: "title", cell: (r) => <When ms={r.createdAt} /> },
    {
      key: "request",
      header: ZP_UI.colRequest,
      cell: (r) => (
        <span className="req-cell">
          <strong>{kindText(r.kind)}</strong>
          {r.details && <span className="req-cell__details">{r.details}</span>}
        </span>
      ),
    },
    {
      key: "from",
      header: ZP_UI.colFrom,
      cell: (r) =>
        r.contact ? (
          <span className="req-cell">
            <span>{r.contact.name ?? "–"}</span>
            {r.contact.email && <span className="req-cell__meta">{r.contact.email}</span>}
          </span>
        ) : (
          <span className="req-cell__meta">–</span>
        ),
    },
    {
      key: "status",
      header: ZP_UI.colStatus,
      cell: (r) => (
        <span className="req-cell">
          {r.status === "open" ? (
            <StatusPill tone="warning" icon="inbox">
              {ZP_UI.requestStatus.open}
            </StatusPill>
          ) : (
            <StatusPill
              tone={r.outcome === "done" ? "success" : "muted"}
              icon={r.outcome === "done" ? "check" : "xCircle"}
            >
              {r.outcome ? (ZP_UI.outcome[r.outcome] ?? r.outcome) : ZP_UI.requestStatus.closed}
            </StatusPill>
          )}
          {r.closedBy?.name && r.closedAt !== null && (
            <span className="req-cell__meta">
              {r.closedBy.name}, <When ms={r.closedAt} inline />
            </span>
          )}
          {r.closeNote && (
            <span className="req-cell__meta">
              {ZP_UI.closeNoteRow}: {r.closeNote}
            </span>
          )}
          {r.status === "open" && !r.canClose && <span className="req-cell__meta">{ZP_UI.ownerOnly}</span>}
        </span>
      ),
    },
  ];

  return (
    <section className="lead-panel req-panel" aria-labelledby="req-h">
      <div className="lead-panel__head">
        <h2 id="req-h" className="lead-panel__title">
          {ZP_UI.requestsTab}
        </h2>
      </div>
      <p className="req-panel__lede">{ZP_UI.requestsLede}</p>
      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="clients-table">
          <DataTable
            caption={ZP_UI.requestsTab}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={list.state === "loading"}
            skeletonRows={3}
            actions={(r) =>
              r.canClose ? (
                <button type="button" className="btn btn--secondary" onClick={() => setClosing(r)}>
                  {ZP_UI.close}
                  <span className="visually-hidden">{` ${kindText(r.kind)}`}</span>
                </button>
              ) : null
            }
            empty={
              <EmptyState icon={<Inbox />} title={ZP_UI.requestsEmpty.replace(/\.$/, "")}>
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
          {loadingMore ? "Loading…" : "Show more"}
        </button>
      )}
      {closing && (
        <CloseDialog
          request={closing}
          onClose={() => setClosing(null)}
          onDone={() => {
            setClosing(null);
            toast("success", ZP_UI.closed);
            reload();
          }}
          onStale={reload}
        />
      )}
    </section>
  );
}

function CloseDialog(props: {
  request: ClientRequestView;
  onClose: () => void;
  onDone: () => void;
  onStale: () => void;
}) {
  const id = useId();
  const [outcome, setOutcome] = useState<"done" | "declined" | null>(null);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = useRefusalFocus();
  async function confirm() {
    if (!outcome) {
      setOutcomeError(ZP_UI.closeOutcomeMissing);
      document.getElementById(`${id}-done`)?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await requestsApi.close(props.request.id, outcome, note.trim() || null);
      props.onDone();
    } catch (e) {
      setBusy(false);
      setFailure(m71ErrorText(e));
      refusal.show();
      props.onStale();
    }
  }
  const r = props.request;
  return (
    <Modal open title={ZP_UI.closeTitle} onClose={props.onClose} busy={busy}>
      <div className="dialog__body">
        <p>
          <strong>{kindText(r.kind)}</strong>
          {r.contact?.name ? `, ${r.contact.name}` : ""}
        </p>
        {r.details && <p className="req-cell__details">{r.details}</p>}
        <fieldset className="radios" aria-describedby={outcomeError ? `${id}-outcome-error` : undefined}>
          <legend>{ZP_UI.closeOutcome}</legend>
          {(["done", "declined"] as const).map((o) => (
            <label key={o} className="radio">
              <input
                id={`${id}-${o}`}
                type="radio"
                name={`${id}-outcome`}
                checked={outcome === o}
                onChange={() => {
                  setOutcome(o);
                  setOutcomeError(null);
                }}
              />
              <span>{o === "done" ? ZP_UI.closeDone : ZP_UI.closeDeclined}</span>
            </label>
          ))}
          {outcomeError && <FieldError id={`${id}-outcome-error`}>{outcomeError}</FieldError>}
        </fieldset>
        {outcome === "declined" && <p className="req-panel__hint">{ZP_UI.closeDeclinedHint}</p>}
        <FormField id={`${id}-note`} label={ZP_UI.closeNoteLabel} hint={ZP_UI.noPersonalData} optional>
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
      </div>
      {failure && (
        <Notice tone="error" ref={refusal.ref}>
          {failure}
        </Notice>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void confirm()}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? "Working…" : ZP_UI.closeConfirm}
        </button>
      </div>
    </Modal>
  );
}
