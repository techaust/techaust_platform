// The CSV writer and the cell formats [ADM-REP-04]: RFC 4180 round trip through a test-only parser, CRLF on every record,
// formula defence on text cells only, exact number text.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Cell,
  cell,
  defuse,
  field,
  formatAmount,
  formatCount,
  formatDate,
  formatMicros,
  formatRate,
  writeCsv,
} from "../../src/gst/index.ts";

/** A test-only RFC 4180 reader: quoted fields may hold commas, quotes (doubled), CR and LF; records end at CRLF. */
function parseCsv(src: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let fieldText = "";
  let quoted = false;
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        fieldText += '"';
        i += 2;
      } else if (c === '"') {
        quoted = false;
        i += 1;
      } else {
        fieldText += c;
        i += 1;
      }
    } else if (c === '"' && fieldText === "") {
      quoted = true;
      i += 1;
    } else if (c === ",") {
      record.push(fieldText);
      fieldText = "";
      i += 1;
    } else if (c === "\r" && src[i + 1] === "\n") {
      record.push(fieldText);
      records.push(record);
      record = [];
      fieldText = "";
      i += 2;
    } else {
      fieldText += c;
      i += 1;
    }
  }
  if (quoted || fieldText !== "" || record.length > 0) throw new Error("record without CRLF");
  return records;
}

const TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

describe("defuse", () => {
  it.each(TRIGGERS)("puts an apostrophe before a leading %j", (t) => {
    expect(defuse(`${t}cmd`)).toBe(`'${t}cmd`);
  });
  it("leaves other text alone", () => {
    for (const s of ["", "Acme", "a=b", "1+1", " =x", "'x", "x-", "19-West Bengal"])
      expect(defuse(s)).toBe(s);
  });
});

describe("number and date text", () => {
  it("amounts have exactly two decimals", () => {
    expect(formatAmount(50_000)).toBe("500.00");
    expect(formatAmount(-50_000)).toBe("-500.00");
    expect(formatAmount(5)).toBe("0.05");
    expect(formatAmount(-5)).toBe("-0.05");
    expect(formatAmount(0)).toBe("0.00");
    expect(formatAmount(-0)).toBe("0.00");
    expect(formatAmount(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
    expect(formatAmount(Number.MIN_SAFE_INTEGER)).toBe("-90071992547409.91");
  });
  it("rates drop trailing zeros", () => {
    expect(formatRate(1800)).toBe("18");
    expect(formatRate(1250)).toBe("12.5");
    expect(formatRate(25)).toBe("0.25");
    expect(formatRate(0)).toBe("0");
    expect(formatRate(10_000)).toBe("100");
    expect(formatRate(1)).toBe("0.01");
    expect(formatRate(10)).toBe("0.1");
  });
  it("micros have six decimals", () => {
    expect(formatMicros(83_500_000)).toBe("83.500000");
    expect(formatMicros(1)).toBe("0.000001");
    expect(formatMicros(0)).toBe("0.000000");
  });
  it("dates are dd-Mmm-yyyy", () => {
    expect(formatDate({ year: 2026, month: 10, day: 5 })).toBe("05-Oct-2026");
    expect(formatDate({ year: 2028, month: 2, day: 29 })).toBe("29-Feb-2028");
    expect(formatDate({ year: 2026, month: 12, day: 31 })).toBe("31-Dec-2026");
  });
  it("counts are plain digits", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1234)).toBe("1234");
  });
  it("refuses what is not a whole, sensible number (a bug, never user input)", () => {
    expect(() => formatAmount(1.5)).toThrow(RangeError);
    expect(() => formatAmount(Number.NaN)).toThrow(RangeError);
    expect(() => formatAmount(2 ** 60)).toThrow(RangeError);
    expect(() => formatRate(-1)).toThrow(RangeError);
    expect(() => formatRate(0.5)).toThrow(RangeError);
    expect(() => formatMicros(-1)).toThrow(RangeError);
    expect(() => formatMicros(0.5)).toThrow(RangeError);
    expect(() => formatCount(-1)).toThrow(RangeError);
    expect(() => formatCount(0.5)).toThrow(RangeError);
    expect(() => formatDate({ year: 2026, month: 13, day: 1 })).toThrow(RangeError);
  });
});

describe("cells and fields", () => {
  it("a blank is empty, a number is never defused, text is defused and quoted", () => {
    expect(field(cell.blank())).toBe("");
    expect(field(cell.amount(-50_000))).toBe("-500.00");
    expect(field(cell.rate(1250))).toBe("12.5");
    expect(field(cell.micros(83_500_000))).toBe("83.500000");
    expect(field(cell.count(3))).toBe("3");
    expect(field(cell.date({ year: 2026, month: 10, day: 5 }))).toBe("05-Oct-2026");
    expect(field(cell.text("-500.00"))).toBe("'-500.00");
    expect(field(cell.text('=HYPERLINK("x","y")'))).toBe(`"'=HYPERLINK(""x"",""y"")"`);
    expect(field(cell.text("-Acme, Ltd"))).toBe(`"'-Acme, Ltd"`);
    expect(field(cell.text("one\ntwo"))).toBe('"one\ntwo"');
    expect(field(cell.text("plain"))).toBe("plain");
  });
});

describe("writeCsv", () => {
  it("ends every record, the header included, in CRLF; no byte-order mark by default", () => {
    const out = writeCsv([
      [cell.text("A"), cell.text("B")],
      [cell.amount(100), cell.blank()],
    ]);
    expect(out).toBe("A,B\r\n1.00,\r\n");
    expect(out.charCodeAt(0)).not.toBe(0xfeff);
  });
  it("writes a byte-order mark only on request", () => {
    expect(writeCsv([[cell.text("A")]], { bom: true })).toBe("﻿A\r\n");
    expect(writeCsv([[cell.text("A")]], { bom: false })).toBe("A\r\n");
  });
  it("an empty list of records is an empty file", () => {
    expect(writeCsv([])).toBe("");
  });
});

const unicodeText = fc.oneof(
  fc.string({ unit: "binary", maxLength: 30 }),
  fc.string({
    unit: fc.constantFrom('"', ",", "\r", "\n", "=", "+", "-", "@", "\t", "a", " ", "é", "₹", "😀"),
    maxLength: 12,
  }),
);

const anyCell: fc.Arbitrary<{ cell: Cell; expected: string }> = fc.oneof(
  unicodeText.map((t) => ({ cell: cell.text(t), expected: defuse(t) })),
  fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }).map((n) => ({
    cell: cell.amount(n),
    expected: formatAmount(n),
  })),
  fc.integer({ min: 0, max: 10_000 }).map((n) => ({ cell: cell.rate(n), expected: formatRate(n) })),
  fc.integer({ min: 0, max: 1_000_000 }).map((n) => ({ cell: cell.count(n), expected: String(n) })),
  fc.constant({ cell: cell.blank(), expected: "" }),
);

describe("CSV round trip (property)", () => {
  it("a test-only RFC 4180 parser gets back the defused text and the exact numbers", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(anyCell, { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 5 }),
        (rows) => {
          const out = writeCsv(rows.map((r) => r.map((c) => c.cell)));
          expect(parseCsv(out)).toEqual(rows.map((r) => r.map((c) => c.expected)));
        },
      ),
      { numRuns: 500 },
    );
  });

  it("every record ends in CRLF, with no bare LF or CR outside quotes", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(anyCell, { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 4 }),
        (rows) => {
          const out = writeCsv(rows.map((r) => r.map((c) => c.cell)));
          expect(out.endsWith("\r\n")).toBe(true);
          // Take the quoted fields away: what is left holds a line break only as CRLF.
          const outside = out.replace(/"(?:[^"]|"")*"/g, "");
          expect(outside.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
          expect(outside.split("\r\n").length - 1).toBe(rows.length);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("no parsed text cell starts with = + - @ tab or CR", () => {
    fc.assert(
      fc.property(fc.array(unicodeText, { minLength: 1, maxLength: 6 }), (texts) => {
        const parsed = parseCsv(writeCsv([texts.map((t) => cell.text(t))]));
        for (const f of parsed[0] as string[]) expect(f).not.toMatch(/^[=+\-@\t\r]/);
      }),
      { numRuns: 300 },
    );
  });

  it("amounts match ^-?\\d+\\.\\d{2}$ and parse back to the same minor units", () => {
    fc.assert(
      fc.property(fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }), (n) => {
        const text = formatAmount(n);
        expect(text).toMatch(/^-?\d+\.\d{2}$/);
        const [whole, frac] = text.replace("-", "").split(".") as [string, string];
        const back = (BigInt(whole) * 100n + BigInt(frac)) * (text.startsWith("-") ? -1n : 1n);
        expect(back).toBe(BigInt(n));
      }),
      { numRuns: 500 },
    );
  });

  it("every rate from 0 to 10,000 basis points parses back", () => {
    for (let bp = 0; bp <= 10_000; bp++) {
      const text = formatRate(bp);
      expect(text).toMatch(/^\d+(\.\d{1,2})?$/);
      expect(text).not.toMatch(/\.\d*0$/);
      const [whole, frac = ""] = text.split(".") as [string, string?];
      expect(Number(whole) * 100 + Number(frac.padEnd(2, "0"))).toBe(bp);
    }
  });
});
