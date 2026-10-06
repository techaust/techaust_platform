// Money as integer minor units (paise/cents) plus a currency code [ADM-G-07]. No floats anywhere in this
// file: amounts are safe integers, percentages are basis points, and maths that can overflow uses bigint.
// test/no-floats.test.ts scans the money paths for float operations.

export const CURRENCIES = {
  INR: { locale: "en-IN", symbol: "₹", minorDigits: 2 },
  USD: { locale: "en-US", symbol: "$", minorDigits: 2 },
} as const;

export type Currency = keyof typeof CURRENCIES;
export type Money = { readonly amount: number; readonly currency: Currency };

export const isCurrency = (value: unknown): value is Currency =>
  typeof value === "string" && Object.hasOwn(CURRENCIES, value);

export function money(amount: number, currency: Currency): Money {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`Money amount must be a safe integer: ${amount}`);
  if (!isCurrency(currency)) throw new TypeError(`Unknown currency: ${String(currency)}`);
  return { amount, currency };
}

/** The currency both operands share; mixing currencies is a bug, so it throws. */
const shared = (a: Money, b: Money): Currency => {
  if (a.currency !== b.currency) throw new TypeError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  return a.currency;
};

export const add = (a: Money, b: Money): Money => money(a.amount + b.amount, shared(a, b));
export const subtract = (a: Money, b: Money): Money => money(a.amount - b.amount, shared(a, b));
export const negate = (a: Money): Money => money(a.amount === 0 ? 0 : -a.amount, a.currency);
export const sum = (items: readonly Money[], currency: Currency): Money =>
  items.reduce((acc, m) => add(acc, m), money(0, currency));
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  shared(a, b);
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

/** Divide two bigints, rounding half away from zero (commercial rounding: 0.5 paise → 1 paisa). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

const toSafe = (value: bigint): number => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(`Result out of range: ${value}`);
  return n;
};

/** `amount × bps / 10,000`, rounded half up. 1 % = 100 bps; 18 % GST = 1,800 bps. */
export function applyBps(a: Money, bps: number): Money {
  if (!Number.isSafeInteger(bps)) throw new RangeError(`Basis points must be an integer: ${bps}`);
  return money(toSafe(divRoundHalfUp(BigInt(a.amount) * BigInt(bps), 10_000n)), a.currency);
}

/**
 * Split `total` into parts proportional to `weights` (integers, e.g. bps of a payment schedule) so that
 * the parts always add up to the total exactly. Leftover minor units go to the largest remainders, ties
 * to the earliest part.
 */
export function allocate(total: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) throw new RangeError("allocate needs at least one weight");
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) {
    throw new RangeError("Weights must be non-negative integers");
  }
  const totalWeight = weights.reduce((a, w) => a + BigInt(w), 0n);
  if (totalWeight === 0n) throw new RangeError("Weights must not all be zero");
  const sign = total.amount < 0 ? -1n : 1n;
  const abs = BigInt(Math.abs(total.amount));
  const shares = weights.map((w, i) => ({
    i,
    q: (abs * BigInt(w)) / totalWeight,
    r: (abs * BigInt(w)) % totalWeight,
  }));
  let left = abs - shares.reduce((a, s) => a + s.q, 0n);
  const order = [...shares].sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const s of order) {
    if (left === 0n) break;
    s.q += 1n;
    left -= 1n;
  }
  return shares.map((s) => money(toSafe(s.q * sign) || 0, total.currency));
}

/** Minor units → an exact decimal string, e.g. 12345650 → "123456.50", -5 → "-0.05". */
export function toDecimalString(a: Money): string {
  const digits = CURRENCIES[a.currency].minorDigits;
  const abs = String(Math.abs(a.amount)).padStart(digits + 1, "0");
  const whole = abs.slice(0, abs.length - digits);
  const frac = abs.slice(abs.length - digits);
  return `${a.amount < 0 ? "-" : ""}${whole}.${frac}`;
}

const MINUS = "−"; // the typographic minus, in our fonts (docs/06): −₹1,000.00

const formatters = new Map<string, Intl.NumberFormat>();
function formatter(currency: Currency, symbol: boolean): Intl.NumberFormat {
  const key = `${currency}:${symbol}`;
  let f = formatters.get(key);
  if (!f) {
    const { locale, minorDigits } = CURRENCIES[currency];
    f = new Intl.NumberFormat(locale, {
      ...(symbol ? { style: "currency", currency } : { style: "decimal" }),
      minimumFractionDigits: minorDigits,
      maximumFractionDigits: minorDigits,
    });
    formatters.set(key, f);
  }
  return f;
}

/**
 * Format for display: INR in the Indian system (₹1,23,456.50), USD in the international one ($123,456.50).
 * Negative amounts use a typographic minus (−₹1,000.00). `symbol: false` drops the currency symbol.
 */
export function formatMoney(a: Money, options: { symbol?: boolean } = {}): string {
  // A decimal string is formatted exactly by Intl (no float conversion).
  const out = formatter(a.currency, options.symbol ?? true).format(
    toDecimalString(a) as Intl.StringNumericLiteral,
  );
  return out.replace("-", MINUS);
}

export type ParseResult = { ok: true; value: Money } | { ok: false; error: string };

const PREFIXES: Record<Currency, readonly string[]> = {
  INR: ["₹", "rs.", "rs", "inr"],
  USD: ["us$", "$", "usd"],
};
// Digits with either no grouping, Western grouping (1,234,567) or Indian grouping (12,34,567).
const AMOUNT = /^(\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.(\d{1,2}))?$/;

/**
 * Parse what a person types into a money field: "1,23,456.5", "₹ 5000", "Rs. 1,000.00", "-$12.30",
 * "−₹1,000.00". Rejects more than two decimals rather than rounding them away.
 */
export function parseMoney(input: string, currency: Currency): ParseResult {
  let s = input.trim().replace(/\s+/g, "").toLowerCase();
  let negative = false;
  if (s.startsWith("-") || s.startsWith(MINUS)) {
    negative = true;
    s = s.slice(1);
  }
  const prefix = PREFIXES[currency].find((p) => s.startsWith(p));
  if (prefix) s = s.slice(prefix.length);
  if (!negative && (s.startsWith("-") || s.startsWith(MINUS))) {
    negative = true;
    s = s.slice(1);
  }
  if (s === "") return { ok: false, error: "Enter an amount" };
  const m = AMOUNT.exec(s);
  if (!m) {
    return /\.\d{3,}$/.test(s)
      ? { ok: false, error: "Use at most 2 decimal places" }
      : { ok: false, error: "Enter an amount like 1,23,456.50" };
  }
  const whole = (m[1] ?? "").replaceAll(",", "");
  const digits = CURRENCIES[currency].minorDigits;
  const frac = (m[2] ?? "").padEnd(digits, "0");
  const minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt(frac);
  const amount = Number(minor);
  if (!Number.isSafeInteger(amount)) return { ok: false, error: "That amount is too large" };
  return { ok: true, value: money(negative && amount !== 0 ? -amount : amount, currency) };
}
