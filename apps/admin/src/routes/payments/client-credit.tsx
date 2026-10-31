// "Use credit on this invoice" from the client's Overview (07-ZH line 10; ADM-PAY-06; Owner, fresh code): where the credit comes from (first in, first out,
// L13), the invoice it goes on and the amount. The RA-17 warning comes back with the result and is said in the toast (line 10's warning, never a block).
import { useEffect, useState } from "react";
import { type ClientCredit, type Currency, paymentsApi } from "../../api.ts";
import { Modal, useRefusalFocus } from "../../components/dialog.tsx";
import { FormField } from "../../components/form.tsx";
import { Notice } from "../../components/ui.tsx";
import { INVT_COPY } from "../../lib/invoice-types.ts";
import { INV_COPY } from "../../lib/invoices.ts";
import { invoicesApi } from "../../lib/invoices-api.ts";
import {
  amountText,
  creditHeldLine,
  earlierMonthLine,
  type OpenDoc,
  openDocsOf,
  PAY_COPY,
  PAY_ERRORS,
  PAY_UI,
  payErrorText,
  plainAmount,
} from "../../lib/payments.ts";
import { moneyFrom } from "../../lib/settings-form.ts";
import { withCode } from "../../lib/step-up.ts";
import { day, useCodeSlot } from "./parts.tsx";

type Doc = OpenDoc & { updatedAt: number };

/** The open invoice statuses credit can go on, each read as its own keyset list. */
const OPEN_STATUSES = ["issued", "partially_paid", "partially_credited"] as const;
type OpenStatus = (typeof OPEN_STATUSES)[number];
/** Where each status's list continues (code review finding 4: older open invoices behind the first 50 can be picked through "Show more"). */
type Cursors = Partial<Record<OpenStatus, string>>;

/** One more page of every status that has one (all of them on the first call), as open documents with their stamps, and where each continues. */
async function openDocsPage(
  clientId: string,
  after: Cursors | null,
): Promise<{ docs: Doc[]; next: Cursors }> {
  const statuses = after === null ? OPEN_STATUSES : OPEN_STATUSES.filter((s) => after[s] !== undefined);
  const pages = await Promise.all(
    statuses.map((status) =>
      invoicesApi.list({
        clientId,
        status,
        limit: "50",
        ...(after?.[status] ? { after: after[status] } : {}),
      }),
    ),
  );
  const rows = pages.flatMap((p) => p.invoices);
  const next: Cursors = {};
  statuses.forEach((status, i) => {
    const n = pages[i]?.next;
    if (n) next[status] = n;
  });
  const docs = openDocsOf(rows, { kind: "payment", proformas: false }).map((d) => ({
    ...d,
    updatedAt: rows.find((r) => r.id === d.id)?.updatedAt ?? 0,
  }));
  return { docs, next };
}

export function ClientCreditDialog(props: {
  clientId: string;
  onClose: () => void;
  onDone: (toast: string) => void;
}) {
  const [credit, setCredit] = useState<ClientCredit | null>(null);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [more, setMore] = useState<Cursors>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [doc, setDoc] = useState("");
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<{ doc?: string; amount?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const code = useCodeSlot("pay-credit-code", true);
  const refusal = useRefusalFocus();
  useEffect(() => {
    let live = true;
    paymentsApi
      .clientCredit(props.clientId)
      .then((c) => live && setCredit(c))
      .catch((e) => live && setFailure(payErrorText(e)));
    openDocsPage(props.clientId, null)
      .then((page) => {
        if (!live) return;
        setDocs(page.docs);
        setMore(page.next);
      })
      .catch(() => live && setDocs([]));
    return () => {
      live = false;
    };
  }, [props.clientId]);
  const held = credit?.credits[0];
  const currency: Currency = held?.currency ?? "INR";
  const picked = docs?.find((d) => d.id === doc) ?? null;
  const hasMore = Object.keys(more).length > 0;

  async function showMore() {
    setLoadingMore(true);
    try {
      const page = await openDocsPage(props.clientId, more);
      setDocs((was) => {
        const seen = new Set((was ?? []).map((d) => d.id));
        return [...(was ?? []), ...page.docs.filter((d) => !seen.has(d.id))];
      });
      setMore(page.next);
    } catch (e) {
      setFailure(payErrorText(e));
    } finally {
      setLoadingMore(false);
    }
  }

  function pick(id: string) {
    setDoc(id);
    const d = docs?.find((x) => x.id === id);
    if (d && held) setText(plainAmount(Math.min(d.balanceMinor, held.creditMinor), currency));
  }

  async function submit() {
    const m = moneyFrom(text, currency);
    const e: { doc?: string; amount?: string } = {};
    if (!picked) e.doc = PAY_UI.creditInvoiceMissing;
    if (!m.ok) e.amount = m.error;
    else if (m.minor <= 0) e.amount = INVT_COPY.amountZero;
    else if (held && m.minor > held.creditMinor) e.amount = PAY_ERRORS.exceeds_credit;
    else if (picked && m.minor > picked.balanceMinor) e.amount = PAY_UI.allocMore;
    setErrors(e);
    if (e.doc || e.amount || !m.ok || !picked) {
      document.getElementById(e.doc ? "pay-credit-doc" : "pay-credit-amount")?.focus();
      return;
    }
    if (!code.ready()) return;
    setBusy(true);
    setFailure(null);
    try {
      const r = await withCode(code.code, () =>
        paymentsApi.applyCredit(props.clientId, {
          documentId: picked.id,
          amountMinor: m.minor,
          expectedUpdatedAt: picked.updatedAt,
        }),
      );
      const w = r.warnings[0];
      props.onDone(w ? `${PAY_UI.creditUsed} ${earlierMonthLine(w.month)}` : PAY_UI.creditUsed);
    } catch (err) {
      if (code.refused(err)) return;
      setFailure(payErrorText(err));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={PAY_COPY.useCredit} onClose={props.onClose} busy={busy} className="dialog--pay">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="dialog__body pay-form">
          {held ? (
            <p className="pay-credit__held">{creditHeldLine(amountText(held.creditMinor, held.currency))}</p>
          ) : (
            <span className="skeleton" style={{ width: "40%" }} />
          )}
          {credit && credit.sources.length > 0 && (
            <ul className="pay-sources">
              {credit.sources.map((s) => (
                <li key={s.paymentId}>
                  <span>{PAY_UI.fromPayment(day(s.receivedOn))}</span>
                  <span className="tnum">{amountText(s.availableMinor, currency)}</span>
                </li>
              ))}
            </ul>
          )}
          <FormField id="pay-credit-doc" label={PAY_UI.allocInvoice} error={errors.doc}>
            {(a) => (
              <select {...a} value={doc} disabled={docs === null} onChange={(e) => pick(e.target.value)}>
                <option value="">{docs === null ? "Loading…" : ""}</option>
                {(docs ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {`${d.number ?? ""} · ${INV_COPY.colBalance} ${amountText(d.balanceMinor, d.currency)}`}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {hasMore && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => void showMore()}
              disabled={busy || loadingMore}
              aria-busy={loadingMore || undefined}
            >
              {loadingMore ? "Loading…" : "Show more"}
            </button>
          )}
          <FormField id="pay-credit-amount" label={PAY_UI.amountToUse} error={errors.amount}>
            {(a) => (
              <div className="money-in">
                <span aria-hidden="true">{currency === "INR" ? "₹" : "$"}</span>
                <input
                  {...a}
                  inputMode="decimal"
                  autoComplete="off"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
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
          <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
            {INV_COPY.cancel}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Working…" : PAY_COPY.useCredit}
          </button>
        </div>
      </form>
    </Modal>
  );
}
