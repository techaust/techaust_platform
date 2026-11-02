// M6.4 remittance advices on the admin screens [ADM-INV-17; run file G5, L12, L30]: the pure rules of the "Add advice" form, "Link payments" and the refusals'
// words, so they are tested without a browser. The server holds every rule again (advices.ts, the 0068 triggers); these only stop what can be told before a
// request. Money is parsed and formatted only through core (`moneyFrom`, `amountText`); nothing here adds up an amount.

import type { AdviceKind, AdviceProvider, NewAdvice, WithoutAdviceProvider } from "../api.ts";
import { RequestError } from "../api.ts";
import { ZN_UI } from "./copy-zn.ts";
import { dateError } from "./date-field.ts";
import { payErrorText } from "./payments.ts";
import { moneyFrom } from "./settings-form.ts";

/** At most this many payments go on an advice in one request (`ADVICE_LINK_MAX`). */
export const ADVICE_LINK_MAX = 50;

/** The "Without advice" list a "Link payments" step reads for an advice: its own gateway, or the bank transfers from abroad for a bank's advice (L30). */
export const withoutProviderOf = (p: AdviceProvider): WithoutAdviceProvider => (p === "bank" ? "manual" : p);

/** The kinds each issuer prints (a suggestion order only; the server takes any kind for any issuer). */
export const KINDS_FOR: Record<AdviceProvider, AdviceKind[]> = {
  paypal: ["fira", "efira", "settlement_report", "other"],
  stripe: ["settlement_report", "efira", "firc", "other"],
  bank: ["firc", "efira", "brc", "fira", "other"],
};

export type AdviceForm = {
  provider: AdviceProvider;
  kind: AdviceKind;
  ref: string;
  issuedOn: string;
  periodFrom: string;
  periodTo: string;
  inrTotal: string;
  note: string;
};
export type AdviceFormErrors = Partial<
  Record<"ref" | "issuedOn" | "periodFrom" | "periodTo" | "inrTotal", string>
>;
export type AdviceUnread = Partial<Record<"issuedOn" | "periodFrom" | "periodTo", boolean>>;

/**
 * The form read for `POST /payments/advices`: the reference (1 to 64 after trimming), the issue day (not after today), the period in order when both ends are
 * set, the INR total (optional, more than zero), the note (optional). A date the field can't read is its own error first (`dateError`, the owner's line).
 */
export function readAdviceForm(
  f: AdviceForm,
  unread: AdviceUnread,
  today: string,
): { ok: true; body: NewAdvice } | { ok: false; errors: AdviceFormErrors } {
  const errors: AdviceFormErrors = {};
  const ref = f.ref.trim();
  if (!ref) errors.ref = ZN_UI.refMissing;
  const issued = dateError(unread.issuedOn) ?? (f.issuedOn ? null : ZN_UI.issuedMissing);
  if (issued) errors.issuedOn = issued;
  else if (f.issuedOn > today) errors.issuedOn = ZN_UI.issuedFuture;
  const from = dateError(unread.periodFrom);
  if (from) errors.periodFrom = from;
  const to = dateError(unread.periodTo);
  if (to) errors.periodTo = to;
  else if (!from && f.periodFrom && f.periodTo && f.periodTo < f.periodFrom)
    errors.periodTo = ZN_UI.periodOrder;
  let inrTotalMinor: number | null = null;
  if (f.inrTotal.trim() !== "") {
    const m = moneyFrom(f.inrTotal, "INR");
    if (!m.ok) errors.inrTotal = m.error;
    else if (m.minor <= 0) errors.inrTotal = ZN_UI.inrTotalZero;
    else inrTotalMinor = m.minor;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      provider: f.provider,
      kind: f.kind,
      adviceRef: ref,
      issuedOn: f.issuedOn,
      periodFrom: f.periodFrom || null,
      periodTo: f.periodTo || null,
      inrTotalMinor,
      note: f.note.trim() || null,
    },
  };
}

/** The first field in error, in the order the form shows them (where focus goes on a refused submit). */
export const firstAdviceError = (e: AdviceFormErrors): keyof AdviceFormErrors | null =>
  (["ref", "issuedOn", "periodFrom", "periodTo", "inrTotal"] as const).find((k) => e[k]) ?? null;

/** A payment ticked or unticked in "Link payments": never more than `max` at once (a tick past it is refused, the screen says why). */
export function toggled(
  picked: readonly string[],
  id: string,
  max = ADVICE_LINK_MAX,
): { picked: string[]; refused: boolean } {
  if (picked.includes(id)) return { picked: picked.filter((x) => x !== id), refused: false };
  if (picked.length >= max) return { picked: [...picked], refused: true };
  return { picked: [...picked, id], refused: false };
}

/** "Select all shown": the shown rows not yet picked, added in order, up to `max` in all. */
export function withAll(
  picked: readonly string[],
  shown: readonly string[],
  max = ADVICE_LINK_MAX,
): string[] {
  const out = [...picked];
  for (const id of shown) {
    if (out.length >= max) break;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** The advice's period in words ("1 Oct 2026 to 7 Oct 2026"), one end alone, or null when it has none. */
export function periodText(
  from: string | null,
  to: string | null,
  day: (iso: string) => string,
): string | null {
  if (from && to) return ZN_UI.periodText(day(from), day(to));
  if (from) return ZN_UI.periodFrom(day(from));
  if (to) return ZN_UI.periodTo(day(to));
  return null;
}

/** The advice refusals the finance Worker words itself (S11); everything else as the payment screens say it (the upload's file codes among them). */
const ADVICE_CODES = new Set([
  "advice_ref_exists",
  "file_already_set",
  "payment_not_confirmed",
  "wrong_provider",
  "already_linked",
  "client_anonymised",
  "link_not_on",
]);
export function adviceErrorText(e: unknown): string {
  if (e instanceof RequestError && ADVICE_CODES.has(e.code) && e.message) return e.message;
  return payErrorText(e);
}
