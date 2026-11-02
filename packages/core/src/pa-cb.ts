// The ₹25 lakh per-transaction warning on a USD document (M6.5; ADM-PAY-13, L12; run file B, Step 0.4). Pure, bigint, no floats.
//
// Researched 2026-10-28, RBI PA Directions 2025, para 11(d) (08-C RB-07): a PA-CB (PayPal) takes at most ₹25 lakh per transaction. Stripe is not a PA-CB (Settled by
// the lead on the safest reading, 2026-11-02 (08-C RA-38)), so for Stripe the same figure is a warning only, never a legal limit: the verdict here is neutral, and the
// screen words it per gateway (07-ZM S18's hint; never calling Stripe a PA-CB). The cap is the existing Owner setting `tax.crossBorderWarnInrMinor` (G-18, default
// ₹25,00,000.00: "warn above this amount per cross-border gateway transaction"); M6.3's hard USD maximum (`overseasOnlineMaxUsdMinor`) stays as it is. A warning,
// never a block (L12, the PRD).

/** How old the Owner-typed USD rate may be before the check says it doesn't know (L12). */
export const PA_CB_RATE_MAX_AGE_DAYS = 30;

export type PaCbVerdict =
  | { readonly ok: true; readonly inrMinor: number }
  | { readonly ok: false; readonly code: "above_pa_cb_cap"; readonly inrMinor: number }
  | { readonly ok: false; readonly code: "rate_unknown" };

const isSafe = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);
const isIsoDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const DAY_MS = 86_400_000;
const dayNumber = (iso: string): number => {
  const ms = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.trunc(ms / DAY_MS);
};

/**
 * Whether a USD amount (`usdMinor`, cents) is above the ₹25 lakh cap at the newest Owner-typed rate (`rateMicros`: INR per USD × 10⁶, as `documents.fx_rate_micros`,
 * dated `rateDate`): INR paise = cents × rate micros / 10⁶, rounded UP (the safe side: a figure at the edge warns). Exactly at the cap is not above it. No rate, a
 * rate of 0, or a rate dated more than 30 days before `today` (or after it): `rate_unknown`.
 */
export function paCbCheck(a: {
  readonly usdMinor: number;
  readonly rateMicros: number | null;
  readonly rateDate: string | null;
  readonly today: string;
  readonly capInrMinor: number;
}): PaCbVerdict {
  if (!isSafe(a.usdMinor) || a.usdMinor < 0 || !isSafe(a.capInrMinor) || a.capInrMinor < 0)
    throw new RangeError("paCbCheck takes safe, non-negative integers");
  if (!isSafe(a.rateMicros) || a.rateMicros <= 0 || !isIsoDay(a.rateDate) || !isIsoDay(a.today))
    return { ok: false, code: "rate_unknown" };
  const age = dayNumber(a.today) - dayNumber(a.rateDate);
  if (age < 0 || age > PA_CB_RATE_MAX_AGE_DAYS) return { ok: false, code: "rate_unknown" };
  const product = BigInt(a.usdMinor) * BigInt(a.rateMicros);
  const inr = (product + 999999n) / 1000000n;
  const inrMinor = Number(inr);
  if (!Number.isSafeInteger(inrMinor)) throw new RangeError("the INR value is not a safe integer");
  return inr > BigInt(a.capInrMinor)
    ? { ok: false, code: "above_pa_cb_cap", inrMinor }
    : { ok: true, inrMinor };
}
