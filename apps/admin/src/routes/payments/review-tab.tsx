// "Needs review" (M6.2; run file G2; ADM-PAY-02, ADM-PAY-07, ADM-G-09): the online payments the system couldn't settle on its own, oldest first, each with its
// reason in 07-ZI S20's words. The Owner's actions: "Open payment" (the entry dialog, whose "Confirm" is `POST /payments/:id/verify`: money moves only there or by
// "Confirm by issuing the tax invoice"), "Try again" (the re-fetch, or the automatic tax invoice again, where the item allows it) and "Mark as resolved", which is
// a record only and offers just the resolutions the money is already in (early check 2, finding 5). Nothing here adds up an amount.
import type { Role } from "@techaust/core/permissions";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { paymentsApi, type ReviewItem, type ReviewResolution } from "../../api.ts";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { Modal, useRefusalFocus } from "../../components/dialog.tsx";
import { EmptyState, When } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import { CheckCircle } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import { ZM_DRAFTS } from "../../lib/copy-zm.ts";
import {
  advanceBlockerLine,
  allowedResolutions,
  canRetry,
  GW,
  GW_UI,
  gatewayName,
  gwErrorText,
  itemReason,
  RESOLUTION_LABELS,
} from "../../lib/gateway.ts";
import { INV_COPY, typeLabel } from "../../lib/invoices.ts";
import { amountText } from "../../lib/payments.ts";

/** What tells two rows apart for a screen reader: the amount and the document (or the client). */
const rowName = (r: ReviewItem) =>
  [
    r.amount_minor !== null ? amountText(r.amount_minor, r.currency ?? "INR") : null,
    r.document_number ?? r.client_name,
  ]
    .filter(Boolean)
    .join(" ");

export function ReviewList(props: {
  role: Role;
  onChanged: () => void;
  /** The payment's entry dialog (the page's own, so Confirm and its step-up work as on the other tabs). */
  entry: (id: string, close: () => void, changed: (toast: string) => void) => ReactNode;
}) {
  const owner = allowed(props.role, "payments.review");
  const toast = useToast();
  const list = useLoad(() => paymentsApi.review({ status: "open" }), "open");
  const [more, setMore] = useState<ReviewItem[]>([]);
  const [after, setAfter] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [resolving, setResolving] = useState<ReviewItem | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
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
      const r = await paymentsApi.review({ status: "open", after: next });
      setMore((m) => [...m, ...r.items.filter((x) => !m.some((y) => y.id === x.id))]);
      setAfter(r.items.length > 0 ? r.next : null);
    } catch (e) {
      toast("error", gwErrorText(e));
    } finally {
      setLoadingMore(false);
    }
  }

  async function retry(it: ReviewItem) {
    setRetrying(it.id);
    try {
      const r = await paymentsApi.retryReview(it.id);
      const said = GW_UI.retried[r.result] ?? GW_UI.retried.other;
      const blockers = (r.blockers ?? []).map(advanceBlockerLine);
      toast(r.result === "blocked" ? "error" : "success", [said, ...blockers].join(" "));
      reload();
    } catch (e) {
      toast("error", gwErrorText(e));
    } finally {
      setRetrying(null);
    }
  }

  const reasonCell = (r: ReviewItem) => (
    <span className="pay-reason">
      <span>{itemReason(r)}</span>
      {/* S21 "Open payment": the entry dialog, whose Confirm is POST /payments/:id/verify (the money moves only there) */}
      {r.payment_id && (
        <button
          type="button"
          className="btn btn--text pay-reason__open"
          onClick={() => setOpen(r.payment_id)}
        >
          {GW.openPayment}
          <span className="visually-hidden">{` ${amountText(r.amount_minor ?? 0, r.currency ?? "INR")}`}</span>
        </button>
      )}
    </span>
  );

  const columns: Column<ReviewItem>[] = [
    {
      key: "arrived",
      header: GW_UI.colArrived,
      card: "title",
      cell: (r) => <When ms={r.created_at} />,
    },
    {
      // M6.3 (run file G2): which gateway the item is about (Stripe or Razorpay), a proper name
      key: "gateway",
      header: ZM_DRAFTS.colGateway,
      cell: (r) => <span className="pay-lines__nowrap">{gatewayName(r.provider)}</span>,
    },
    {
      key: "reason",
      header: GW_UI.colReason,
      width: "34%",
      // in the card layout the reason stands under the date, across the card (cardSub)
      card: "hidden",
      cell: (r) => reasonCell(r),
    },
    {
      key: "client",
      header: GW_UI.colClient,
      cell: (r) =>
        r.client_id && r.client_name ? (
          <Link to={`/clients/${encodeURIComponent(r.client_id)}`}>{r.client_name}</Link>
        ) : (
          <span className="pay-lines__meta">{GW_UI.noClient}</span>
        ),
    },
    {
      key: "document",
      header: GW_UI.colDocument,
      cell: (r) =>
        r.document_id ? (
          <Link to={`/invoices/${encodeURIComponent(r.document_id)}`} className="docno">
            {r.document_number ?? (r.document_type ? typeLabel(r.document_type as never) : "…")}
          </Link>
        ) : (
          <span className="pay-lines__meta">–</span>
        ),
    },
    {
      key: "amount",
      header: GW_UI.colAmount,
      align: "end",
      cell: (r) =>
        r.amount_minor !== null ? (
          <span className="tnum pay-lines__nowrap">{amountText(r.amount_minor, r.currency ?? "INR")}</span>
        ) : (
          <span className="pay-lines__meta">–</span>
        ),
    },
  ];

  return (
    <>
      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="clients-table pay-table pay-review">
          <DataTable
            caption={GW.needsReview}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            cardSub={(r) => reasonCell(r)}
            loading={list.state === "loading"}
            skeletonRows={3}
            actions={
              owner
                ? (r) => (
                    <span className="pay-review__acts">
                      {canRetry(r) && (
                        <button
                          type="button"
                          className="btn btn--secondary"
                          disabled={retrying !== null}
                          aria-busy={retrying === r.id || undefined}
                          onClick={() => void retry(r)}
                        >
                          {retrying === r.id ? "Working…" : GW.tryAgain}
                          <span className="visually-hidden">{` ${rowName(r)}`}</span>
                        </button>
                      )}
                      <button type="button" className="btn btn--secondary" onClick={() => setResolving(r)}>
                        {GW.markResolved}
                        <span className="visually-hidden">{` ${rowName(r)}`}</span>
                      </button>
                    </span>
                  )
                : undefined
            }
            empty={
              <EmptyState icon={<CheckCircle />} title={GW.nothingToReview.replace(/\.$/, "")}>
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
      {open &&
        props.entry(
          open,
          () => setOpen(null),
          (text) => {
            setOpen(null);
            toast("success", text);
            reload();
          },
        )}
      {resolving && (
        <ResolveDialog
          item={resolving}
          onClose={() => setResolving(null)}
          onDone={() => {
            setResolving(null);
            toast("success", GW_UI.resolveDone);
            reload();
          }}
        />
      )}
    </>
  );
}

/** "Mark as resolved": only what the money already is (the payment read first), with an optional note (≤ 500, never in the audit log). */
function ResolveDialog(props: { item: ReviewItem; onClose: () => void; onDone: () => void }) {
  const it = props.item;
  const pay = useLoad(
    () => (it.payment_id ? paymentsApi.get(it.payment_id) : Promise.resolve(null)),
    it.payment_id ?? "none",
  );
  const payment = pay.state === "ready" && pay.data ? pay.data.payment : null;
  const options = pay.state === "loading" ? [] : allowedResolutions(it.kind, payment);
  const [choice, setChoice] = useState<ReviewResolution | null>(null);
  const picked = choice && options.includes(choice) ? choice : (options[0] ?? null);
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = useRefusalFocus();

  async function submit() {
    if (!picked) return;
    setBusy(true);
    setFailure(null);
    try {
      await paymentsApi.resolveReview(it.id, { resolution: picked, note: note.trim() || null });
      props.onDone();
    } catch (e) {
      setFailure(gwErrorText(e));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={GW.markResolved} onClose={props.onClose} busy={busy} className="dialog--pay">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="dialog__body pay-form">
          <div className="pay-review__item">
            <p>{itemReason(it)}</p>
            {it.amount_minor !== null && (
              <p className="tnum">
                {amountText(it.amount_minor, it.currency ?? "INR")}
                {it.document_number && <span className="pay-lines__meta">{` ${it.document_number}`}</span>}
              </p>
            )}
          </div>
          {pay.state === "failed" ? (
            <LoadFailed error={pay.error} onRetry={() => pay.reload()} headingLevel={3} />
          ) : pay.state === "loading" ? (
            <div aria-busy="true">
              <span className="skeleton" style={{ width: "70%" }} />
            </div>
          ) : (
            <fieldset className="pay-resolve">
              <legend>{GW_UI.resolveLegend}</legend>
              {options.map((o) => (
                <label key={o} className="pay-resolve__opt">
                  <input
                    type="radio"
                    name="pay-resolution"
                    value={o}
                    checked={picked === o}
                    onChange={() => setChoice(o)}
                  />
                  {RESOLUTION_LABELS[o]}
                </label>
              ))}
            </fieldset>
          )}
          <FormField id="pay-resolve-note" label={GW_UI.resolveNote} optional>
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
            {INV_COPY.cancel}
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !picked || pay.state !== "ready"}
            aria-busy={busy || undefined}
          >
            {busy ? "Working…" : GW.markResolved}
          </button>
        </div>
      </form>
    </Modal>
  );
}
