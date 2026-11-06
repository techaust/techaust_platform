// The client page's Requests panel (M7.1; POR-09, POR-11; run file G.7, L8; M7.4 G.1): what this client's contacts asked for, from the portal or logged by
// staff, newest first, 50 a page, each with its reply clock (M7.4). A request opens the same dialog as the inbox (requests/detail.tsx): its steps and its
// close, with the decline reason, the linked erasure and "Export sent" (M7.4 C.3, C.4). Staff close a contact change or a grievance; every data-rights kind
// is the Owner's (the API's `canClose` per row, held again in the close UPDATE and trigger `client_requests_owner_close`). Words: lib/copy-zp.ts (S2) and
// lib/copy-zr.ts (M7.4).
import { useState } from "react";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { EmptyState, StatusPill } from "../../components/display.tsx";
import { Inbox } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { REQUESTS_CHANGED, ZP_UI } from "../../lib/copy-zp.ts";
import { ZR_REQ } from "../../lib/copy-zr.ts";
import { m71ErrorText } from "../../lib/m71-errors.ts";
import { m74Api, type RequestView } from "../../lib/m74-api.ts";
import { channelText, dayText, kindText, stateLook, subjectOf } from "../../lib/requests.ts";
import { ReplyClock } from "../requests/clock.tsx";
import { RequestDialog } from "../requests/detail.tsx";

export function ClientRequests(props: { clientId: string }) {
  const toast = useToast();
  const list = useLoad(() => m74Api.requests({ client: props.clientId }), props.clientId);
  const [more, setMore] = useState<RequestView[]>([]);
  const [after, setAfter] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const rows = [...(list.data?.items ?? []), ...more];
  const next = after === undefined ? (list.data?.next ?? null) : after;
  const now = Date.now();
  const selected = opened ? (rows.find((r) => r.id === opened) ?? null) : null;

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
      const r = await m74Api.requests({ client: props.clientId, after: next });
      setMore((m) => [...m, ...r.items.filter((x) => !m.some((y) => y.id === x.id))]);
      setAfter(r.items.length > 0 ? r.next : null);
    } catch (e) {
      toast("error", m71ErrorText(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const columns: Column<RequestView>[] = [
    {
      key: "request",
      header: ZP_UI.colRequest,
      card: "title",
      width: "30%",
      cell: (r) => (
        <span className="req-cell">
          <button type="button" className="btn btn--text dp-open" onClick={() => setOpened(r.id)}>
            {kindText(r.kind)}
          </button>
          {r.details && <span className="req-cell__details">{r.details}</span>}
        </span>
      ),
    },
    {
      key: "from",
      header: ZP_UI.colFrom,
      cell: (r) => {
        const s = subjectOf(r);
        return (
          <span className="req-cell">
            <span>{s.name}</span>
            {r.contact?.email && <span className="req-cell__meta break">{r.contact.email}</span>}
          </span>
        );
      },
    },
    {
      key: "received",
      header: ZR_REQ.colReceived,
      cell: (r) => (
        <span className="req-cell">
          <span className="when--keep">{dayText(r.receivedAt ?? r.createdAt)}</span>
          <span className="req-cell__meta">{channelText(r.channel)}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: ZP_UI.colStatus,
      cell: (r) => {
        const look = stateLook(r);
        return (
          <span className="req-cell">
            <StatusPill tone={look.tone} icon={look.icon}>
              {look.text}
            </StatusPill>
            {r.status === "open" ? (
              <ReplyClock r={r} now={now} />
            ) : (
              r.closedAt !== null && (
                <span className="req-cell__meta">
                  {r.closedBy?.name ? `${r.closedBy.name}, ` : ""}
                  {dayText(r.closedAt)}
                </span>
              )
            )}
            {r.status === "open" && !r.canClose && <span className="req-cell__meta">{ZP_UI.ownerOnly}</span>}
          </span>
        );
      },
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
      {selected && (
        <RequestDialog request={selected} now={now} onClose={() => setOpened(null)} onChanged={reload} />
      )}
    </section>
  );
}
