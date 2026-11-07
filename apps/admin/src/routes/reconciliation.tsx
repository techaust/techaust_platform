// Reconciliation (M6.5; ADM-PAY-10; run file G5, L11): Razorpay's settlements to our bank and what is left unmatched, for the Owner and the Accountant
// (`reports.finance`); the Owner ticks a settlement or a bank payment "Seen in bank statement" (and undoes it, with a reason) and fetches a day now
// (`payments.reconcile`).
// Design: a ledger page, not a dashboard. Settlements read as a bank statement's lines: the day, the UTR in the document face, then the money right-aligned in
// tabular figures (net to bank first, then the fees and their GST absorbed, each as Razorpay states it: nothing is added up here), how many of its lines
// matched ours, and the bank tick. The unmatched lists are the exceptions to look at, one at a time behind a three-way switch with a sentence saying what
// each list is. The counts that matter ride on the tabs (no stat tiles: a page of 50 rows can't honestly be totalled into a headline figure). Fees and
// their GST are shown absorbed (OPEN (08-C RA-29): is the GST on the MDR invoiced to our GSTIN?).
import "./invoices/parts.tsx";
import "../payments.css";
import "../refunds.css";
import { uuidv7 } from "@techaust/core/ids";
import type { Role } from "@techaust/core/permissions";
import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { type Column, DataTable } from "../components/data-table.tsx";
import { DateField, useUnreadDates } from "../components/date-field.tsx";
import { Modal, useRefusalFocus } from "../components/dialog.tsx";
import { EmptyState, PageHeader } from "../components/display.tsx";
import { FormField } from "../components/form.tsx";
import { CheckCircle, Landmark, RefreshCw } from "../components/icons.tsx";
import { LoadFailed, NoAccess, useLoad } from "../components/states.tsx";
import { Tabs } from "../components/tabs.tsx";
import { useToast } from "../components/toast.tsx";
import { Notice } from "../components/ui.tsx";
import { allowed } from "../lib/access.ts";
import { ZO_UI } from "../lib/copy-zo.ts";
import { dateError } from "../lib/date-field.ts";
import { GW_UI } from "../lib/gateway.ts";
import { INV_COPY } from "../lib/invoices.ts";
import { CHECKING_OLDER_LINE, readPastEmptyPages, showsEmpty } from "../lib/keyset-pages.ts";
import { amountText, PAY_COPY, payErrorText, todayIst } from "../lib/payments.ts";
import {
  refundsApi,
  type SettlementItemRow,
  type SettlementRow,
  type UnmatchedTab,
  type UnsettledPaymentRow,
} from "../lib/refunds-api.ts";
import { useUser } from "../session.tsx";
import { day } from "./payments/parts.tsx";

export function Component() {
  const user = useUser();
  if (!allowed(user.role, "reports.finance")) return <NoAccess what={ZO_UI.reconTitle} />;
  return <Reconciliation role={user.role} />;
}

type Tab = "settlements" | "unmatched";
const UNMATCHED: UnmatchedTab[] = ["items", "gateway", "manual"];

/** Yesterday, IST: the day the 09:00 batch fetches. */
const yesterdayIst = () => new Date(Date.now() + 19_800_000 - 86_400_000).toISOString().slice(0, 10);

function Reconciliation({ role }: { role: Role }) {
  const owner = allowed(role, "payments.reconcile");
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "unmatched" ? "unmatched" : "settlements";
  const which: UnmatchedTab = UNMATCHED.includes(params.get("list") as UnmatchedTab)
    ? (params.get("list") as UnmatchedTab)
    : "items";
  const [fetching, setFetching] = useState(false);
  const [tick, setTick] = useState(0);
  const toast = useToast();
  const set = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) n.delete(k);
          else n.set(k, v);
        }
        return n;
      },
      { replace: true },
    );
  // The unmatched settlement lines' first page: the tab's badge (50+ when there are more).
  const items = useLoad(() => refundsApi.unmatched("items"), `items:${tick}`);
  const badge =
    items.state === "ready" && items.data.items.length > 0
      ? {
          text: `${items.data.items.length}${items.data.next ? "+" : ""}`,
          label: `${items.data.items.length}${items.data.next ? " or more" : ""} ${ZO_UI.tabItems.toLowerCase()}`,
        }
      : null;
  return (
    <>
      <PageHeader
        title={ZO_UI.reconTitle}
        lede={ZO_UI.reconLede}
        action={
          owner ? (
            <button type="button" className="btn btn--primary" onClick={() => setFetching(true)}>
              <RefreshCw size={20} />
              {ZO_UI.fetchNow}
            </button>
          ) : undefined
        }
      />
      <Tabs
        label={ZO_UI.reconTitle}
        tabs={[
          { key: "settlements", label: ZO_UI.settlements },
          { key: "unmatched", label: ZO_UI.unmatched, badge },
        ]}
        selected={tab}
        onSelect={(k) => set({ tab: k === "settlements" ? null : k, list: null })}
      >
        {tab === "settlements" ? (
          <Settlements key={tick} owner={owner} />
        ) : (
          <Unmatched
            key={`${which}:${tick}`}
            which={which}
            owner={owner}
            onWhich={(w) => set({ list: w === "items" ? null : w })}
          />
        )}
      </Tabs>
      <p className="rcn-note">{ZO_UI.feesNote}</p>
      {fetching && (
        <FetchDialog
          onClose={() => setFetching(false)}
          onDone={(t) => {
            setFetching(false);
            toast("success", t);
            setTick((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

/**
 * One keyset list read page by page ("Show more"). M6–M7 audit AU32: the unmatched lists read a bounded window of payments per page, so a page can hold no row
 * and still name a next one: empty pages are read on by themselves (`readPastEmptyPages`, with the "Checking older payments" line), the cursor is the server's
 * `next` whatever the page held, and the empty state shows only when no next page is left (`showsEmpty`).
 */
function usePages<T extends { id: string }>(
  load: (cursor?: string) => Promise<{ items: T[]; next: string | null }>,
  key: string,
) {
  const [checking, setChecking] = useState(false);
  const first = useLoad(async () => {
    try {
      return await readPastEmptyPages(load, undefined, { onEmpty: () => setChecking(true) });
    } finally {
      setChecking(false);
    }
  }, key);
  const toast = useToast();
  const [more, setMore] = useState<T[]>([]);
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  // Review part 2, P2-13: a new key (a tick, an undo) starts again from the first page, so no later page's row stays stale or shows twice.
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setMore([]);
    setNext(undefined);
  }
  const rows = [...(first.data?.items ?? []), ...more];
  const cursor = next === undefined ? (first.data?.next ?? null) : next;
  return {
    first,
    rows,
    cursor,
    loading,
    checking,
    /** AU32: the list's empty state only once no next page is left. */
    empty: showsEmpty(rows.length, cursor),
    async showMore() {
      if (!cursor) return;
      setLoading(true);
      try {
        const r = await readPastEmptyPages(load, cursor, { onEmpty: () => setChecking(true) });
        setMore((m) => [...m, ...r.items.filter((x) => !m.some((y) => y.id === x.id))]);
        setNext(r.next);
      } catch (e) {
        // Code re-check of M6.5, finding 7: a failed "Show more" says so; the cursor stays, so the button can be pressed again
        toast("error", payErrorText(e));
      } finally {
        setLoading(false);
        setChecking(false);
      }
    },
  };
}

/** AU32: the line while empty pages are read on (a plain hint; the designer places it). */
function Checking(props: { on: boolean }) {
  if (!props.on) return null;
  return (
    <p className="hint" role="status">
      {CHECKING_OLDER_LINE}
    </p>
  );
}

function ShowMore(props: { cursor: string | null; loading: boolean; onMore: () => void }) {
  if (!props.cursor) return null;
  return (
    <button
      type="button"
      className="btn btn--secondary notes__more"
      onClick={props.onMore}
      disabled={props.loading}
      aria-busy={props.loading || undefined}
    >
      {props.loading ? "Loading…" : ZO_UI.loadMore}
    </button>
  );
}

function Settlements({ owner }: { owner: boolean }) {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const pages = usePages<SettlementRow>((c) => refundsApi.settlements(c), `s:${tick}`);
  const [open, setOpen] = useState<SettlementRow | null>(null);
  const [ticking, setTicking] = useState<{
    kind: "settlement" | "payment";
    id: string;
    label: string;
  } | null>(null);
  const [undoing, setUndoing] = useState<SettlementRow | null>(null);
  const changed = (t: string) => {
    toast("success", t);
    setTick((n) => n + 1);
  };
  const columns: Column<SettlementRow>[] = [
    {
      key: "day",
      header: ZO_UI.colSettledOn,
      card: "title",
      cell: (r) => (
        <button type="button" className="btn btn--text rcn-open" onClick={() => setOpen(r)}>
          <span className="tnum">{day(r.settled_on)}</span>
          <span className="visually-hidden">{` ${ZO_UI.settlementItems}`}</span>
        </button>
      ),
    },
    {
      key: "utr",
      header: ZO_UI.colUtr,
      // Review part 2, P2-11: only the bank's UTR stands here (Razorpay's settlement id is in the settlement's dialog, under its own name)
      cell: (r) =>
        r.utr ? <span className="docno break">{r.utr}</span> : <span className="pay-lines__meta">{"–"}</span>,
    },
    {
      key: "net",
      header: ZO_UI.colNet,
      align: "end",
      cell: (r) => (
        <span className="tnum pay-lines__nowrap rcn-net">{amountText(r.amount_minor, r.currency)}</span>
      ),
    },
    {
      key: "fees",
      header: ZO_UI.colFees,
      align: "end",
      cell: (r) => (
        <span className="tnum pay-lines__nowrap">
          {amountText(r.fees_minor, r.currency)}
          <span className="pay-lines__meta">{`GST ${amountText(r.tax_minor, r.currency)}`}</span>
        </span>
      ),
    },
    {
      key: "matched",
      header: ZO_UI.colMatched,
      align: "end",
      cell: (r) => (
        <span className={r.matched < r.items ? "tnum rcn-short" : "tnum"}>
          {ZO_UI.matchedOf(r.matched, r.items)}
        </span>
      ),
    },
    {
      // Review part 2, P2-2: the bank tick and the Owner's action share one cell, so the Owner's "Tick as seen" or "Undo" is in view at 1280 with the menu open
      key: "bank",
      header: ZO_UI.colBank,
      cell: (r) =>
        r.bank_match_id ? (
          <span className="rcn-bank">
            <span className="rcn-seen">
              <CheckCircle size={16} />
              {ZO_UI.seenInBank}
            </span>
            {owner && (
              <button type="button" className="btn btn--text rcn-undo" onClick={() => setUndoing(r)}>
                {ZO_UI.undoSeen}
                <span className="visually-hidden">{` ${day(r.settled_on)}`}</span>
              </button>
            )}
          </span>
        ) : owner ? (
          <button
            type="button"
            className="btn btn--secondary rcn-tick"
            onClick={() => setTicking({ kind: "settlement", id: r.id, label: day(r.settled_on) })}
          >
            {ZO_UI.tickSeen}
            <span className="visually-hidden">{` ${day(r.settled_on)}`}</span>
          </button>
        ) : (
          <span className="pay-lines__meta">{"–"}</span>
        ),
    },
  ];
  return (
    <>
      {pages.first.state === "failed" ? (
        <LoadFailed error={pages.first.error} onRetry={() => pages.first.reload()} />
      ) : (
        <div className="clients-table pay-table rcn-table">
          <DataTable
            caption={ZO_UI.settlements}
            columns={columns}
            rows={pages.rows}
            rowKey={(r) => r.id}
            loading={pages.first.state === "loading"}
            skeletonRows={4}
            empty={
              pages.empty ? (
                <EmptyState icon={<Landmark />} title={ZO_UI.noSettlements}>
                  <p>{ZO_UI.noSettlementsBody}</p>
                </EmptyState>
              ) : undefined
            }
          />
        </div>
      )}
      <Checking on={pages.checking} />
      <ShowMore cursor={pages.cursor} loading={pages.loading} onMore={() => void pages.showMore()} />
      {open && <SettlementDialog row={open} onClose={() => setOpen(null)} />}
      {ticking && (
        <TickDialog
          target={ticking}
          onClose={() => setTicking(null)}
          onDone={() => {
            setTicking(null);
            changed(ZO_UI.ticked);
          }}
        />
      )}
      {undoing?.bank_match_id && (
        <UndoDialog
          matchId={undoing.bank_match_id}
          label={day(undoing.settled_on)}
          onClose={() => setUndoing(null)}
          onDone={() => {
            setUndoing(null);
            changed(ZO_UI.unticked);
          }}
        />
      )}
    </>
  );
}

/** One settlement's lines, each with its match, 50 at a time ("Show more"; second review, L2). */
function SettlementDialog(props: { row: SettlementRow; onClose: () => void }) {
  const r = props.row;
  const pages = usePages<SettlementItemRow>((c) => refundsApi.settlement(r.id, c), r.id);
  const one = pages.first;
  return (
    <Modal
      open
      title={`${ZO_UI.settlementItems}: ${day(r.settled_on)}`}
      onClose={props.onClose}
      className="dialog--pay"
    >
      <div className="dialog__body">
        <dl className="inv-facts">
          <div>
            <dt>{ZO_UI.colUtr}</dt>
            <dd className={r.utr ? "docno break" : undefined}>{r.utr ?? "–"}</dd>
          </div>
          <div>
            <dt>{ZO_UI.settlementId}</dt>
            <dd className="docno break">{r.settlement_id}</dd>
          </div>
          <div>
            <dt>{ZO_UI.colNet}</dt>
            <dd className="tnum">{amountText(r.amount_minor, r.currency)}</dd>
          </div>
        </dl>
        {one.state === "loading" ? (
          <span className="skeleton" style={{ width: "80%" }} />
        ) : one.state === "failed" ? (
          <LoadFailed error={one.error} onRetry={() => one.reload()} />
        ) : pages.empty ? (
          <p className="pay-lines__meta">{ZO_UI.itemsEmpty}</p>
        ) : (
          <>
            {pages.rows.length > 0 && <ItemLines rows={pages.rows} currency={r.currency} />}
            <Checking on={pages.checking} />
            <ShowMore cursor={pages.cursor} loading={pages.loading} onMore={() => void pages.showMore()} />
          </>
        )}
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose}>
          {ZO_UI.close}
        </button>
      </div>
    </Modal>
  );
}

function ItemLines(props: { rows: readonly SettlementItemRow[]; currency: "INR" | "USD" }) {
  return (
    <table className="pay-lines rcn-items">
      <caption className="visually-hidden">{ZO_UI.settlementItems}</caption>
      <thead>
        <tr>
          <th scope="col">{ZO_UI.colLine}</th>
          <th scope="col">{ZO_UI.colStatus}</th>
          <th scope="col" className="num">
            {ZO_UI.colAmount}
          </th>
          <th scope="col" className="num">
            {ZO_UI.colFees}
          </th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((i) => (
          <tr key={i.id}>
            <th scope="row">
              <span className="rcn-entity">
                <span>{`${ZO_UI.entity[i.entity_type] ?? i.entity_type} · ${ZO_UI.direction[i.direction] ?? i.direction}`}</span>
                {/* second review, M5: the id keeps one line from 48rem (refunds.css `.rcn-id`); only the cards below it break it */}
                {i.payment_id ? (
                  <Link to={`/payments/${encodeURIComponent(i.payment_id)}`} className="docno rcn-id">
                    {i.entity_id}
                  </Link>
                ) : (
                  <span className="docno rcn-id">{i.entity_id}</span>
                )}
              </span>
            </th>
            <td data-label={ZO_UI.colStatus}>
              <span className={i.match === "unmatched" ? "rcn-short" : undefined}>
                {ZO_UI.matchState[i.match] ?? i.match}
              </span>
              {i.fee_mismatch === 1 && <span className="pay-lines__meta rcn-short">{ZO_UI.feeMismatch}</span>}
            </td>
            <td className="num tnum" data-label={ZO_UI.colAmount}>
              {amountText(i.amount_minor, props.currency)}
            </td>
            <td className="num tnum" data-label={ZO_UI.colFees}>
              {i.fee_minor !== null ? amountText(i.fee_minor, props.currency) : "–"}
              {i.tax_minor !== null && (
                <span className="pay-lines__meta">{`GST ${amountText(i.tax_minor, props.currency)}`}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Unmatched(props: { which: UnmatchedTab; owner: boolean; onWhich: (w: UnmatchedTab) => void }) {
  const legend = useId();
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const pages = usePages<SettlementItemRow & UnsettledPaymentRow>(
    (c) => refundsApi.unmatched(props.which, c),
    `${props.which}:${tick}`,
  );
  const [ticking, setTicking] = useState<{
    kind: "settlement" | "payment";
    id: string;
    label: string;
  } | null>(null);
  const label = { items: ZO_UI.tabItems, gateway: ZO_UI.tabGateway, manual: ZO_UI.tabManual }[props.which];
  const hint = { items: ZO_UI.itemsHint, gateway: ZO_UI.gatewayHint, manual: ZO_UI.manualHint }[props.which];
  const empty = { items: ZO_UI.itemsEmpty, gateway: ZO_UI.gatewayEmpty, manual: ZO_UI.manualEmpty }[
    props.which
  ];
  type Row = SettlementItemRow & UnsettledPaymentRow;
  const columns: Column<Row>[] =
    props.which === "items"
      ? [
          {
            key: "entity",
            header: ZO_UI.colLine,
            card: "title",
            cell: (r) => (
              <span className="rcn-entity">
                <span>{`${ZO_UI.entity[r.entity_type] ?? r.entity_type} · ${ZO_UI.direction[r.direction] ?? r.direction}`}</span>
                <span className="docno break">{r.entity_id}</span>
              </span>
            ),
          },
          {
            key: "amount",
            header: ZO_UI.colAmount,
            align: "end",
            cell: (r) => <span className="tnum pay-lines__nowrap">{amountText(r.amount_minor, "INR")}</span>,
          },
          {
            key: "fee",
            header: ZO_UI.colFees,
            align: "end",
            cell: (r) => (
              <span className="tnum pay-lines__nowrap">
                {r.fee_minor !== null ? amountText(r.fee_minor, "INR") : "–"}
              </span>
            ),
          },
        ]
      : [
          {
            key: "received",
            header: PAY_COPY.dateReceived,
            card: "title",
            cell: (r) => (
              <Link to={`/payments/${encodeURIComponent(r.id)}`} className="tnum">
                {day(r.received_on)}
              </Link>
            ),
          },
          {
            key: "ref",
            header: props.which === "gateway" ? GW_UI.paymentId : ZO_UI.referenceLabel,
            cell: (r) => (
              <span className="docno break">{r.provider_payment_id ?? r.reference_norm ?? "–"}</span>
            ),
          },
          {
            key: "amount",
            header: ZO_UI.colAmount,
            align: "end",
            cell: (r) => (
              <span className="tnum pay-lines__nowrap">{amountText(r.amount_minor, r.currency)}</span>
            ),
          },
        ];
  return (
    <div className="rcn-unmatched">
      <fieldset className="segmented rcn-pick" aria-labelledby={legend}>
        <legend id={legend} className="visually-hidden">
          {ZO_UI.unmatched}
        </legend>
        {UNMATCHED.map((w) => (
          <label key={w} className="segmented__opt">
            <input
              type="radio"
              name="rcn-unmatched"
              checked={props.which === w}
              onChange={() => props.onWhich(w)}
            />
            {{ items: ZO_UI.tabItems, gateway: ZO_UI.tabGateway, manual: ZO_UI.tabManual }[w]}
          </label>
        ))}
      </fieldset>
      <p className="rcn-hint">{hint}</p>
      {pages.first.state === "failed" ? (
        <LoadFailed error={pages.first.error} onRetry={() => pages.first.reload()} />
      ) : (
        <div className="clients-table pay-table rcn-table">
          <DataTable
            caption={label}
            columns={columns}
            rows={pages.rows}
            rowKey={(r) => r.id}
            loading={pages.first.state === "loading"}
            skeletonRows={3}
            actions={
              props.owner && props.which === "manual"
                ? (r) => (
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => setTicking({ kind: "payment", id: r.id, label: day(r.received_on) })}
                    >
                      {ZO_UI.tickSeen}
                      <span className="visually-hidden">{` ${day(r.received_on)} ${amountText(r.amount_minor, r.currency)}`}</span>
                    </button>
                  )
                : undefined
            }
            empty={
              pages.empty ? (
                <EmptyState icon={<CheckCircle />} title={empty.replace(/\.$/, "")}>
                  {null}
                </EmptyState>
              ) : undefined
            }
          />
        </div>
      )}
      <Checking on={pages.checking} />
      <ShowMore cursor={pages.cursor} loading={pages.loading} onMore={() => void pages.showMore()} />
      {ticking && (
        <TickDialog
          target={ticking}
          onClose={() => setTicking(null)}
          onDone={() => {
            setTicking(null);
            toast("success", ZO_UI.ticked);
            setTick((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

/** "Tick as seen": the bank statement's day and (optionally) its reference. */
function TickDialog(props: {
  target: { kind: "settlement" | "payment"; id: string; label: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [id] = useState(() => uuidv7());
  const [on, setOn] = useState(todayIst());
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dates = useUnreadDates<"on">();
  const refusal = useRefusalFocus();
  async function submit() {
    const e = dateError(dates.unread.on) ?? (on ? undefined : ZO_UI.requiredText);
    setError(e);
    if (e) {
      document.getElementById("rcn-on")?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await refundsApi.bankMatch({
        id,
        target: { kind: props.target.kind, id: props.target.id },
        statementOn: on,
        ...(ref.trim() ? { statementRef: ref.trim() } : {}),
      });
      props.onDone();
    } catch (err) {
      setFailure(payErrorText(err));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={`${ZO_UI.seenInBank}: ${props.target.label}`} onClose={props.onClose} busy={busy}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="dialog__body pay-form">
          <FormField id="rcn-on" label={ZO_UI.statementOn} error={error}>
            {(a) => <DateField {...a} {...dates.bind("on")} value={on} max={todayIst()} onChange={setOn} />}
          </FormField>
          <FormField id="rcn-ref" label={ZO_UI.statementRef} optional>
            {(a) => (
              <input
                {...a}
                maxLength={64}
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
          <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
            {INV_COPY.cancel}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Working…" : ZO_UI.tickSeen}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** "Undo" of a tick, with a reason (1 to 200 characters). */
function UndoDialog(props: { matchId: string; label: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = useRefusalFocus();
  async function submit() {
    if (!reason.trim()) {
      setError(ZO_UI.requiredText);
      document.getElementById("rcn-why")?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await refundsApi.bankUnmatch(props.matchId, reason.trim());
      props.onDone();
    } catch (err) {
      setFailure(payErrorText(err));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={`${ZO_UI.undoSeen}: ${props.label}`} onClose={props.onClose} busy={busy} tone="danger">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="dialog__body pay-form">
          <FormField id="rcn-why" label={ZO_UI.undoReason} error={error}>
            {(a) => (
              <textarea
                {...a}
                rows={2}
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
          <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
            {INV_COPY.cancel}
          </button>
          <button type="submit" className="btn btn--danger" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Working…" : ZO_UI.undoSeen}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** "Fetch now": one IST day (yesterday by default; at most one fetch every 5 minutes). */
function FetchDialog(props: { onClose: () => void; onDone: (toast: string) => void }) {
  const [on, setOn] = useState(yesterdayIst());
  const [error, setError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dates = useUnreadDates<"on">();
  const refusal = useRefusalFocus();
  async function submit() {
    const e = dateError(dates.unread.on) ?? (on ? undefined : ZO_UI.requiredText);
    setError(e);
    if (e) {
      document.getElementById("rcn-day")?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const r = await refundsApi.fetchDay(on);
      props.onDone(ZO_UI.fetched(r.result));
    } catch (err) {
      setFailure(payErrorText(err));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={ZO_UI.fetchNow} onClose={props.onClose} busy={busy}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="dialog__body pay-form">
          <FormField id="rcn-day" label={ZO_UI.fetchDay} error={error}>
            {(a) => <DateField {...a} {...dates.bind("on")} value={on} max={todayIst()} onChange={setOn} />}
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
            {busy ? "Working…" : ZO_UI.fetchNow}
          </button>
        </div>
      </form>
    </Modal>
  );
}
