// Shared parts of the M6.1 payment screens (ADM-PAY-05, ADM-PAY-06, ADM-INV-16, ADM-INV-17): the status chip, the step-up code slot the money dialogs carry
// (the issue and advance dialogs' pattern: a fresh code typed in the same dialog, owner Q2), the proof file picker and the allocation table.
// Design: a payment reads as a ledger line, never a card: the date in tabular figures, the amount right-aligned on its own column, the reference in the mono
// face the document numbers use, and one chip for its state (icon and words, never colour alone; docs/06 §5.5).
import "../invoices/parts.tsx";
import "../../payments.css";
import { useCallback, useRef, useState } from "react";
import type { PaymentStatus } from "../../api.ts";
import { RequestError, stepUpActive } from "../../api.ts";
import { StatusPill } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import { Alert, Upload, X } from "../../components/icons.tsx";
import { CodeField, FieldError } from "../../components/ui.tsx";
import { dayText } from "../../lib/documents.ts";
import { typeLabel } from "../../lib/invoices.ts";
import {
  type AllocRow,
  amountText,
  earlierMonthLine,
  type OpenDoc,
  PAY_COPY,
  PAY_UI,
  STATUS_LABELS,
  STATUS_PILLS,
} from "../../lib/payments.ts";

/**
 * Which dialog is open, for a screen that mounts its dialogs only while open: focus goes back to the control that opened one when it closes (WCAG 2.4.3;
 * an unmounted <dialog> can't hand it back itself), or to `fallbackId` when that control is gone after the change it made.
 */
export function useDialogState<T>(fallbackId: string) {
  const [value, setValue] = useState<T | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const set = useCallback(
    (next: T | null) => {
      if (next !== null) {
        const a = document.activeElement;
        opener.current = a instanceof HTMLElement && a !== document.body ? a : null;
      } else {
        const back = opener.current;
        requestAnimationFrame(() => {
          if (back?.isConnected) back.focus();
          else document.getElementById(fallbackId)?.focus();
        });
      }
      setValue(next);
    },
    [fallbackId],
  );
  return [value, set] as const;
}

export const CODE_MISSING = "Enter the 6-digit code from your authenticator app.";

export function PaymentPill({ status }: { status: PaymentStatus }) {
  const p = STATUS_PILLS[status];
  return (
    <StatusPill tone={p.tone} icon={p.icon} outline={p.outline}>
      {STATUS_LABELS[status]}
    </StatusPill>
  );
}

/**
 * Line 10's RA-17 warning, shown before the submit and kept while the dialog is open (visual review finding 6): the reference warning's box (a warning rule
 * and icon, never colour alone), said politely when it appears. Never a block; the server answers the same warning after the write.
 */
export function EarlierMonthWarning({ month }: { month: string | null }) {
  if (!month) return null;
  return (
    <div className="pay-seen pay-warn" role="status">
      <Alert size={20} />
      <p>{earlierMonthLine(month)}</p>
    </div>
  );
}

export const day = (iso: string | null | undefined) => (iso ? (dayText(iso) ?? iso) : "");

/**
 * The fresh code a money dialog asks for (owner Q2: recording, confirming, withdrawing and using credit): drawn only while no step-up is open, checked by
 * `withCode` before the action runs; a wrong code clears the field, is said under it and takes the focus (the advance dialog's behaviour).
 */
export function useCodeSlot(id: string, wanted: boolean) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const needs = wanted && !stepUpActive();
  return {
    needs,
    code: needs ? code : undefined,
    /** Before sending: false (and the field focused) when a code is needed and isn't six digits. */
    ready(): boolean {
      if (!needs || code.length === 6) {
        setError(null);
        return true;
      }
      setError(CODE_MISSING);
      document.getElementById(id)?.focus();
      return false;
    },
    /** After a refusal: true when it was the code (said under the field). */
    refused(e: unknown): boolean {
      if (!(e instanceof RequestError) || e.code !== "invalid_code") return false;
      setCode("");
      setError(e.message);
      document.getElementById(id)?.focus();
      return true;
    },
    field: needs ? (
      <CodeField
        id={id}
        label="Authenticator code"
        hint="Enter the 6-digit code from your authenticator app to continue."
        value={code}
        onChange={setCode}
        error={error}
      />
    ) : null,
  };
}

/** A proof or a bank's letter: one PDF, JPEG or PNG up to 5 MB (L10), picked with a real button; the chosen name and a way to remove it. */
export function FilePick(props: {
  id: string;
  label: string;
  file: File | null;
  onFile: (f: File | null) => void;
  error?: string | null | undefined;
  optional?: boolean;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <FormField
      id={props.id}
      label={props.label}
      optional={props.optional}
      hint={props.hint ?? PAY_UI.proofFileHint}
      error={props.error}
    >
      {(a) => (
        <div className="file-pick">
          <input
            ref={input}
            {...a}
            type="file"
            className="file-pick__input"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            onChange={(e) => {
              props.onFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          {props.file ? (
            <span className="file-pick__chosen">
              <span className="file-pick__name break">{props.file.name}</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  props.onFile(null);
                  input.current?.focus();
                }}
              >
                <X size={16} />
                <span className="visually-hidden">Remove {props.file.name}</span>
              </button>
            </span>
          ) : (
            <span className="file-pick__face" aria-hidden="true">
              <Upload size={20} />
            </span>
          )}
        </div>
      )}
    </FormField>
  );
}

/**
 * Where the payment goes: the client's open invoices with what each still owes and the amount to put on it (L6: Staff's rows are the request the Owner
 * confirms). A plain table on wide screens; below md each row stacks with its labels (the DataTable's card rule).
 */
export function AllocationTable(props: {
  docs: readonly OpenDoc[];
  rows: readonly AllocRow[];
  onRow: (documentId: string, text: string) => void;
  errors: Record<string, string>;
  idPrefix: string;
  symbol: string;
  loading?: boolean;
  /**
   * Re-check finding 1: documents asked for that can't take the payment (the Confirm step). Each is a row of its own, first, with its amount and its reason
   * shown at once; clearing the amount removes it (line 31's hint).
   */
  refused?: readonly { id: string; number: string | null; type: string | null; error: string }[];
}) {
  const refused = props.refused ?? [];
  if (props.loading)
    return (
      <div className="alloc alloc--loading" aria-busy="true">
        <span className="skeleton" style={{ width: "70%" }} />
        <span className="skeleton" style={{ width: "55%" }} />
      </div>
    );
  if (props.docs.length === 0 && refused.length === 0)
    return <p className="alloc__none">{PAY_UI.allocNone}</p>;
  return (
    <table className="alloc">
      <caption className="visually-hidden">{PAY_UI.allocHeading}</caption>
      <thead>
        <tr>
          <th scope="col">{PAY_UI.allocInvoice}</th>
          <th scope="col" className="num">
            {PAY_COPY.balance}
          </th>
          <th scope="col" className="num">
            {PAY_UI.allocAmount}
          </th>
        </tr>
      </thead>
      <tbody>
        {refused.map((d) => {
          const row = props.rows.find((r) => r.documentId === d.id);
          const id = `${props.idPrefix}-${d.id}`;
          const name = d.number ?? (d.type ? typeLabel(d.type as never) : "");
          return (
            <tr key={d.id} data-invalid={true} data-refused={true}>
              <th scope="row">
                <span className="alloc__doc">
                  <span className="docno">{name || "…"}</span>
                  {d.number && d.type && <span className="alloc__meta">{typeLabel(d.type as never)}</span>}
                </span>
                {/* the reason is about the document, not the amount: it sits under the document, so the columns keep their widths */}
                <FieldError id={`${id}-error`}>{d.error}</FieldError>
              </th>
              <td className="num tnum" data-label={PAY_COPY.balance} />
              <td className="num alloc__cell" data-label={PAY_UI.allocAmount}>
                <label className="visually-hidden" htmlFor={id}>
                  {`${PAY_UI.allocAmount}: ${name}`}
                </label>
                <div className="money-in alloc__in">
                  <span aria-hidden="true">{props.symbol}</span>
                  <input
                    id={id}
                    inputMode="decimal"
                    autoComplete="off"
                    value={row?.text ?? ""}
                    aria-invalid={(row?.text.trim() ?? "") !== "" ? true : undefined}
                    aria-describedby={`${id}-error`}
                    onChange={(e) => props.onRow(d.id, e.target.value)}
                  />
                </div>
              </td>
            </tr>
          );
        })}
        {props.docs.map((d) => {
          const row = props.rows.find((r) => r.documentId === d.id);
          const id = `${props.idPrefix}-${d.id}`;
          const err = props.errors[d.id];
          return (
            <tr key={d.id} data-invalid={err ? true : undefined}>
              <th scope="row">
                <span className="alloc__doc">
                  <span className="docno">{d.number}</span>
                  <span className="alloc__meta">
                    {typeLabel(d.type as never)}
                    {d.dueDate ? ` · ${day(d.dueDate)}` : ""}
                  </span>
                </span>
              </th>
              <td className="num tnum" data-label={PAY_COPY.balance}>
                {amountText(d.balanceMinor, d.currency)}
              </td>
              <td className="num alloc__cell" data-label={PAY_UI.allocAmount}>
                <label className="visually-hidden" htmlFor={id}>
                  {`${PAY_UI.allocAmount}: ${d.number ?? ""}`}
                </label>
                <div className="money-in alloc__in">
                  <span aria-hidden="true">{props.symbol}</span>
                  <input
                    id={id}
                    inputMode="decimal"
                    autoComplete="off"
                    value={row?.text ?? ""}
                    aria-invalid={err ? true : undefined}
                    aria-describedby={err ? `${id}-error` : undefined}
                    onChange={(e) => props.onRow(d.id, e.target.value)}
                  />
                </div>
                {err && <FieldError id={`${id}-error`}>{err}</FieldError>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
