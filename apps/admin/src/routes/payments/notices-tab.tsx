// The Payments "Notices" tab (M7.1; ADM-PAY-05, POR-06; run file G.7, L10, L23, L25): what clients told us they paid, from the portal or an emailed invoice
// link. A notice is never a payment and never money (L10): Staff and the Owner check the bank, then "Record payment" from it (the record dialog filled in from the
// notice, its document the only allocation; the batch marks it recorded) or "Dismiss" it (an optional note, no personal data: S6). A notice on a proforma is the
// Owner's to settle by "Issue tax invoice" (S9; the proforma's own advance dialog, started from the notice, then the notice dismissed
// with S7's note; L25); Staff record it as the whole-amount proforma ask, as any Staff entry. The Accountant reads the tab only. Words: lib/copy-zp.ts (S1).
import type { Role } from "@techaust/core/permissions";
import { useId, useState } from "react";
import { Link } from "react-router";
import type { Currency, PaymentStatus } from "../../api.ts";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { Modal, useRefusalFocus } from "../../components/dialog.tsx";
import { EmptyState, KeepDates, StatusPill, When } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import { Alert, CheckCircle, Inbox } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { Tabs } from "../../components/tabs.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import { ZP_UI } from "../../lib/copy-zp.ts";
import { typeLabel } from "../../lib/invoices.ts";
import { type NoticeStatus, type NoticeView, noticesApi } from "../../lib/m71-api.ts";
import { m71ErrorText } from "../../lib/m71-errors.ts";
import { amountText, STATUS_LABELS } from "../../lib/payments.ts";
import { paymentHref } from "./panel.tsx";
import { day } from "./parts.tsx";
import { RecordPaymentDialog } from "./record-dialog.tsx";

const STATUSES: NoticeStatus[] = ["open", "recorded", "dismissed"];
const LOOK = {
  open: { tone: "warning", icon: "inbox" },
  recorded: { tone: "success", icon: "check" },
  dismissed: { tone: "muted", icon: "archive" },
} as const;

/** Tells two rows apart for a screen reader: the amount and the document. */
const rowName = (n: NoticeView) =>
  `${amountText(n.amountMinor, n.currency)} ${n.document.numberDisplay ?? typeLabel(n.document.type as never)}`;

export function NoticesTab(props: { role: Role; onChanged: () => void }) {
  const [status, setStatus] = useState<NoticeStatus>("open");
  return (
    <div className="pay-notices">
      <p className="pay-notices__lede">{ZP_UI.noticesLede}</p>
      <Tabs
        label={ZP_UI.colStatus}
        tabs={STATUSES.map((s) => ({ key: s, label: ZP_UI.noticeStatus[s] ?? s }))}
        selected={status}
        onSelect={setStatus}
      >
        <NoticeList key={status} status={status} role={props.role} onChanged={props.onChanged} />
      </Tabs>
    </div>
  );
}

function NoticeList(props: { status: NoticeStatus; role: Role; onChanged: () => void }) {
  const toast = useToast();
  const list = useLoad(() => noticesApi.list({ status: props.status }), props.status);
  const [more, setMore] = useState<NoticeView[]>([]);
  const [after, setAfter] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [recording, setRecording] = useState<NoticeView | null>(null);
  const [dismissing, setDismissing] = useState<NoticeView | null>(null);
  const canRecord = allowed(props.role, "payments.record");
  const canDismiss = allowed(props.role, "payments.notices");
  const owner = allowed(props.role, "invoices.advance");
  const rows = [...(list.data?.items ?? []), ...more];
  const next = after === undefined ? (list.data?.next ?? null) : after;

  function reload() {
    setMore([]);
    setAfter(undefined);
    list.reload(true);
    props.onChanged();
  }

  async function showMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const r = await noticesApi.list({ status: props.status, after: next });
      setMore((m) => [...m, ...r.items.filter((x) => !m.some((y) => y.id === x.id))]);
      setAfter(r.items.length > 0 ? r.next : null);
    } catch (e) {
      toast("error", m71ErrorText(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const columns: Column<NoticeView>[] = [
    {
      key: "told",
      header: ZP_UI.colTold,
      card: "title",
      // re-check 2: the time may go under the date, so the Client column keeps its width
      cell: (n) => <When ms={n.createdAt} wrap />,
    },
    {
      key: "client",
      header: ZP_UI.colClient,
      // who told us sits under the client (the contact and the way: the portal or an invoice link), so the row keeps its width for the actions
      cell: (n) => (
        <span className="pay-notice__ref pay-notice__client">
          <span>
            <Link to={`/clients/${encodeURIComponent(n.client.id)}`}>{n.client.name}</Link>{" "}
            <span className="docno pay-lines__code">{n.client.code}</span>
          </span>
          <span className="pay-lines__meta">
            {[n.contact?.name, ZP_UI.via[n.via] ?? n.via].filter(Boolean).join(", ")}
          </span>
        </span>
      ),
    },
    {
      key: "document",
      header: ZP_UI.colDocument,
      cell: (n) => (
        <Link to={`/invoices/${encodeURIComponent(n.document.id)}`} className="docno">
          {n.document.numberDisplay ?? typeLabel(n.document.type as never)}
        </Link>
      ),
    },
    {
      key: "amount",
      header: ZP_UI.colAmount,
      align: "end",
      // the day they say they paid sits under the amount (one column, so the row keeps its width for the actions)
      cell: (n) => (
        <span className="pay-notice__money">
          <span className="tnum pay-lines__nowrap">{amountText(n.amountMinor, n.currency)}</span>
          {/* re-check 2: "Paid on" may go above the date in a narrow column; the date itself never breaks */}
          <span className="pay-lines__meta">
            {ZP_UI.colPaidOn} <span className="when--keep">{day(n.paidOn)}</span>
          </span>
        </span>
      ),
    },
    {
      key: "reference",
      header: ZP_UI.colReference,
      cell: (n) => (
        <span className="pay-notice__ref">
          <span className="docno">{n.reference}</span>
          {n.note && (
            // re-check 3: the client's line breaks show (the portal sends the note as typed, several lines allowed)
            <span className="pay-lines__meta pay-notice__note">
              {ZP_UI.noticeNote}: {n.note}
            </span>
          )}
        </span>
      ),
    },
    // an open notice's status is its tab's; a closed one says who closed it, when, and the note
    ...(props.status === "open"
      ? []
      : ([
          {
            key: "status",
            header: ZP_UI.colStatus,
            cell: (n) => {
              const look = LOOK[n.status] ?? LOOK.dismissed;
              return (
                <span className="pay-notice__ref">
                  <StatusPill tone={look.tone} icon={look.icon}>
                    {ZP_UI.noticeStatus[n.status] ?? n.status}
                  </StatusPill>
                  {n.payment && <NoticePayment payment={n.payment} />}
                  {n.closedBy?.name && n.closedAt !== null && (
                    <span className="pay-lines__meta">
                      {/* re-check 1: the narrower Status column never breaks the date */}
                      <KeepDates text={ZP_UI.closedBy(n.closedBy.name, day(isoDayOf(n.closedAt)))} />
                    </span>
                  )}
                  {n.closeNote && <span className="pay-lines__meta">{n.closeNote}</span>}
                </span>
              );
            },
          },
        ] as Column<NoticeView>[])),
  ];

  const actionsFor = (n: NoticeView) => {
    if (n.status !== "open") return null;
    const proforma = n.document.type === "proforma";
    return (
      <span className="pay-review__acts">
        {proforma && owner ? (
          // L25: the proforma's own advance dialog, started from this notice (then the notice is dismissed with S7)
          <Link
            to={`/invoices/${encodeURIComponent(n.document.id)}?fromNotice=${encodeURIComponent(n.id)}`}
            className="btn btn--primary"
          >
            {/* review M3: a short visible label keeps both actions in view at every width; the accessible name starts with it and says the rest (S9) */}
            {ZP_UI.issueFromNoticeShort}
            <span className="visually-hidden">{` ${ZP_UI.issueFromNoticeRest}, ${rowName(n)}`}</span>
          </Link>
        ) : (
          canRecord && (
            <button type="button" className="btn btn--primary" onClick={() => setRecording(n)}>
              {ZP_UI.recordFromNotice}
              <span className="visually-hidden">{` ${rowName(n)}`}</span>
            </button>
          )
        )}
        {canDismiss && (
          <button type="button" className="btn btn--secondary" onClick={() => setDismissing(n)}>
            {ZP_UI.dismiss}
            <span className="visually-hidden">{` ${rowName(n)}`}</span>
          </button>
        )}
      </span>
    );
  };

  return (
    <>
      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="clients-table pay-table pay-review">
          <DataTable
            caption={`${ZP_UI.noticesTab}: ${ZP_UI.noticeStatus[props.status]}`}
            columns={columns}
            rows={rows}
            rowKey={(n) => n.id}
            loading={list.state === "loading"}
            skeletonRows={3}
            actions={props.status === "open" && (canRecord || canDismiss) ? actionsFor : undefined}
            empty={
              <EmptyState
                icon={props.status === "open" ? <CheckCircle /> : <Inbox />}
                title={(props.status === "open" ? ZP_UI.noticesEmptyOpen : ZP_UI.noticesEmpty).replace(
                  /\.$/,
                  "",
                )}
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
          {loadingMore ? "Loading…" : "Show more"}
        </button>
      )}
      {recording && (
        <RecordPaymentDialog
          open
          kind="payment"
          role={props.role}
          client={{
            id: recording.client.id,
            name: recording.client.name,
            currency: recording.currency as Currency,
          }}
          from={{
            id: recording.document.id,
            number: recording.document.numberDisplay,
            type: recording.document.type,
            balanceMinor: 0,
            currency: recording.currency as Currency,
          }}
          notice={{
            id: recording.id,
            clientName: recording.client.name,
            amountMinor: recording.amountMinor,
            paidOn: recording.paidOn,
            reference: recording.reference,
          }}
          onClose={() => setRecording(null)}
          onDone={() => {
            setRecording(null);
            reload();
          }}
        />
      )}
      {dismissing && (
        <DismissDialog
          notice={dismissing}
          onClose={() => setDismissing(null)}
          onDone={() => {
            setDismissing(null);
            toast("success", ZP_UI.dismissed);
            reload();
          }}
          onStale={reload}
        />
      )}
    </>
  );
}

/**
 * Review M5 (S10): the payment recorded from a notice, by its status now, as a link to the entry. A rejected or withdrawn payment is a warning line with its
 * icon (never colour alone); a waiting or confirmed one is a quiet line in 07-ZH line 27's words.
 */
function NoticePayment(props: { payment: { id: string; status: PaymentStatus } }) {
  const p = props.payment;
  const undone = ZP_UI.noticePaymentUndone[p.status];
  return undone ? (
    <span className="pay-notice__undone">
      <Alert size={16} />
      <Link to={paymentHref(p.id)}>{undone}</Link>
    </span>
  ) : (
    <Link to={paymentHref(p.id)} className="pay-notice__payment">
      {ZP_UI.noticePayment(STATUS_LABELS[p.status] ?? p.status)}
    </Link>
  );
}

/** UTC ms → the IST day `YYYY-MM-DD`, for `day()`. */
const isoDayOf = (ms: number) => new Date(ms + 19_800_000).toISOString().slice(0, 10);

/** "Dismiss this notice?": an optional note (S6: no personal data); a refusal is worded from its code. */
function DismissDialog(props: {
  notice: NoticeView;
  onClose: () => void;
  onDone: () => void;
  onStale: () => void;
}) {
  const id = useId();
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = useRefusalFocus();
  async function confirm() {
    setBusy(true);
    setFailure(null);
    try {
      await noticesApi.dismiss(props.notice.id, note.trim() || null);
      props.onDone();
    } catch (e) {
      setBusy(false);
      setFailure(m71ErrorText(e));
      refusal.show();
      props.onStale();
    }
  }
  return (
    <Modal open title={ZP_UI.dismissTitle} onClose={props.onClose} busy={busy}>
      <div className="dialog__body">
        <p>{ZP_UI.dismissBody}</p>
        <p className="pay-lines__meta">
          {`${props.notice.client.name}, ${rowName(props.notice)}, ${props.notice.reference}`}
        </p>
        <FormField id={`${id}-note`} label={ZP_UI.dismissNoteLabel} hint={ZP_UI.noPersonalData} optional>
          {(a) => (
            <textarea
              {...a}
              rows={3}
              maxLength={300}
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
          {busy ? "Working…" : ZP_UI.dismissConfirm}
        </button>
      </div>
    </Modal>
  );
}
