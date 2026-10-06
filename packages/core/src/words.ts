// Amounts in words for documents [ADM-INV-05, ADM-INV-06]: the Indian system (lakh, crore) for INR and the
// international system (thousand, million) for USD. Owner-approved style (M1.2):
//   ₹1,23,456.50 → "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Paise Only"
//   $5,000.00    → "US Dollars Five Thousand Only"
import type { Money } from "./money.ts";

const ONES = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
] as const;
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"] as const;

/** Largest whole amount that can be written: 99,99,99,999 (Indian) = 999,999,999 (international). */
export const MAX_WORDS = 999_999_999;

function below100(n: number): string {
  if (n < 20) return ONES[n] as string;
  const t = TENS[Math.trunc(n / 10)] as string;
  return n % 10 === 0 ? t : `${t}-${ONES[n % 10]}`;
}

function below1000(n: number): string {
  const h = Math.trunc(n / 100);
  const rest = n % 100;
  const parts = h > 0 ? [`${ONES[h]} Hundred`] : [];
  if (rest > 0) parts.push(below100(rest));
  return parts.join(" ");
}

type Scale = readonly [divisor: number, name: string];
const INDIAN: readonly Scale[] = [
  [10_000_000, "Crore"],
  [100_000, "Lakh"],
  [1_000, "Thousand"],
];
const INTERNATIONAL: readonly Scale[] = [
  [1_000_000, "Million"],
  [1_000, "Thousand"],
];

function toWords(n: number, scales: readonly Scale[]): string {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_WORDS) {
    throw new RangeError(`Can only write whole numbers from 0 to ${MAX_WORDS} in words: ${n}`);
  }
  if (n === 0) return "Zero";
  const parts: string[] = [];
  let rest = n;
  for (const [divisor, name] of scales) {
    const count = Math.trunc(rest / divisor);
    if (count > 0) parts.push(`${below1000(count)} ${name}`);
    rest %= divisor;
  }
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(" ");
}

/** 1,23,45,678 → "One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight". */
export const numberToWordsIndian = (n: number) => toWords(n, INDIAN);
/** 12,345,678 → "Twelve Million Three Hundred Forty-Five Thousand Six Hundred Seventy-Eight". */
export const numberToWordsInternational = (n: number) => toWords(n, INTERNATIONAL);

const STYLE = {
  INR: { major: "Rupees", minor: ["Paisa", "Paise"], words: numberToWordsIndian },
  USD: { major: "US Dollars", minor: ["Cent", "Cents"], words: numberToWordsInternational },
} as const;

/** The "amount in words" line on a document. Document totals are never negative, so negatives throw. */
export function amountInWords(m: Money): string {
  if (m.amount < 0) throw new RangeError("amountInWords expects a non-negative amount");
  const style = STYLE[m.currency];
  const fraction = m.amount % 100;
  const whole = (m.amount - fraction) / 100;
  const head = `${style.major} ${style.words(whole)}`;
  if (fraction === 0) return `${head} Only`;
  return `${head} and ${below100(fraction)} ${style.minor[fraction === 1 ? 0 : 1]} Only`;
}
