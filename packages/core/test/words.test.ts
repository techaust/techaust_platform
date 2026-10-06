import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { money } from "../src/money.ts";
import { amountInWords, MAX_WORDS, numberToWordsIndian, numberToWordsInternational } from "../src/words.ts";

// An independent reader for the words, so the property test checks meaning, not the same code twice.
const SMALL: Record<string, number> = {};
[
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
].forEach((w, i) => {
  SMALL[w] = i;
});
["Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"].forEach((w, i) => {
  SMALL[w] = (i + 2) * 10;
});
const SCALE: Record<string, number> = { Crore: 1e7, Lakh: 1e5, Million: 1e6, Thousand: 1e3 };

function readWords(text: string): number {
  let total = 0;
  let group = 0;
  for (const word of text.split(/[ -]/)) {
    if (word in SMALL) group += SMALL[word] as number;
    else if (word === "Hundred") group *= 100;
    else if (word in SCALE) {
      total += group * (SCALE[word] as number);
      group = 0;
    } else throw new Error(`Unexpected word ${word} in "${text}"`);
  }
  return total + group;
}

describe("numbers in words", () => {
  it("writes the Indian system (lakh, crore)", () => {
    expect(numberToWordsIndian(0)).toBe("Zero");
    expect(numberToWordsIndian(7)).toBe("Seven");
    expect(numberToWordsIndian(15)).toBe("Fifteen");
    expect(numberToWordsIndian(40)).toBe("Forty");
    expect(numberToWordsIndian(99)).toBe("Ninety-Nine");
    expect(numberToWordsIndian(100)).toBe("One Hundred");
    expect(numberToWordsIndian(101)).toBe("One Hundred One");
    expect(numberToWordsIndian(1_000)).toBe("One Thousand");
    expect(numberToWordsIndian(1_00_000)).toBe("One Lakh");
    expect(numberToWordsIndian(1_23_456)).toBe("One Lakh Twenty-Three Thousand Four Hundred Fifty-Six");
    expect(numberToWordsIndian(10_00_00_000)).toBe("Ten Crore");
    expect(numberToWordsIndian(1_00_00_001)).toBe("One Crore One");
    expect(numberToWordsIndian(MAX_WORDS)).toBe(
      "Ninety-Nine Crore Ninety-Nine Lakh Ninety-Nine Thousand Nine Hundred Ninety-Nine",
    );
  });

  it("writes the international system (thousand, million)", () => {
    expect(numberToWordsInternational(123_456)).toBe(
      "One Hundred Twenty-Three Thousand Four Hundred Fifty-Six",
    );
    expect(numberToWordsInternational(1_000_000)).toBe("One Million");
    expect(numberToWordsInternational(12_345_678)).toBe(
      "Twelve Million Three Hundred Forty-Five Thousand Six Hundred Seventy-Eight",
    );
    expect(numberToWordsInternational(MAX_WORDS)).toBe(
      "Nine Hundred Ninety-Nine Million Nine Hundred Ninety-Nine Thousand Nine Hundred Ninety-Nine",
    );
  });

  it("refuses what it can't write", () => {
    for (const bad of [-1, MAX_WORDS + 1, 1.5, Number.NaN]) {
      expect(() => numberToWordsIndian(bad)).toThrow(RangeError);
      expect(() => numberToWordsInternational(bad)).toThrow(RangeError);
    }
  });

  it("property: every number from 0 to 99,99,99,999 reads back to itself, in both systems", () => {
    const n = fc.oneof(fc.integer({ min: 0, max: 1_000 }), fc.integer({ min: 0, max: MAX_WORDS }));
    fc.assert(
      fc.property(n, (x) => {
        expect(readWords(numberToWordsIndian(x))).toBe(x);
        expect(readWords(numberToWordsInternational(x))).toBe(x);
      }),
      { numRuns: 5_000 },
    );
  });

  it("every number 0–99,999 reads back (exhaustive over the small range)", () => {
    for (let x = 0; x <= 99_999; x++) {
      if (readWords(numberToWordsIndian(x)) !== x) throw new Error(`Indian ${x}`);
    }
  });
});

describe("amount in words on documents (owner-approved style)", () => {
  it("INR: Rupees … and … Paise Only", () => {
    expect(amountInWords(money(1_23_456_50, "INR"))).toBe(
      "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Paise Only",
    );
    expect(amountInWords(money(5_000_00, "INR"))).toBe("Rupees Five Thousand Only");
    expect(amountInWords(money(1_01, "INR"))).toBe("Rupees One and One Paisa Only");
    expect(amountInWords(money(0, "INR"))).toBe("Rupees Zero Only");
    expect(amountInWords(money(50, "INR"))).toBe("Rupees Zero and Fifty Paise Only");
  });

  it("USD: US Dollars … and … Cents Only", () => {
    expect(amountInWords(money(123_456_50, "USD"))).toBe(
      "US Dollars One Hundred Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Cents Only",
    );
    expect(amountInWords(money(5_000_00, "USD"))).toBe("US Dollars Five Thousand Only");
    expect(amountInWords(money(1, "USD"))).toBe("US Dollars Zero and One Cent Only");
  });

  it("rejects negatives and amounts beyond 99,99,99,999.99", () => {
    expect(() => amountInWords(money(-1, "INR"))).toThrow(RangeError);
    expect(amountInWords(money(MAX_WORDS * 100 + 99, "INR"))).toMatch(
      /^Rupees Ninety-Nine Crore .* and Ninety-Nine Paise Only$/,
    );
    expect(() => amountInWords(money((MAX_WORDS + 1) * 100, "INR"))).toThrow(RangeError);
  });
});
