// The one CSV text-cell writer (M7.5 B1; ASVS 5.0 V1): properties over any text, plus the fixed cases the three old copies held.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { csvCell, defuse, quoteField } from "../src/csv-cell.ts";
import { cell, field, defuse as gstDefuse } from "../src/gst/csv.ts";

/** A minimal RFC 4180 reader of ONE field (quoted or not): the inverse of `quoteField`. */
function readField(f: string): string {
  if (!f.startsWith('"')) return f;
  expect(f.endsWith('"')).toBe(true);
  const inner = f.slice(1, -1);
  // inside the quotes every quote is doubled: no lone quote is left
  expect(inner.replaceAll('""', "")).not.toContain('"');
  return inner.replaceAll('""', '"');
}

const risky = fc.constantFrom("=", "+", "-", "@", "\t", "\r");

describe("csvCell [M7.5 B1]", () => {
  it("never lets a field start with a formula character, whatever the text", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const out = readField(csvCell(s));
        expect(/^[=+\-@\t\r]/.test(out)).toBe(false);
      }),
    );
  });

  it("round-trips: reading the field back gives the defused text exactly", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(readField(csvCell(s))).toBe(defuse(s));
      }),
    );
  });

  it("defuses by one leading quote and nothing else; safe text is unchanged", () => {
    fc.assert(
      fc.property(risky, fc.string(), (head, rest) => {
        expect(defuse(head + rest)).toBe(`'${head}${rest}`);
      }),
    );
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/^[=+\-@\t\r]/.test(s)),
        (s) => {
          expect(defuse(s)).toBe(s);
        },
      ),
    );
  });

  it("quotes exactly when a quote, comma, CR or LF is in the field, so a field never spills into the next", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const q = quoteField(s);
        const needs = /[",\r\n]/.test(s);
        expect(q.startsWith('"')).toBe(needs);
        if (!needs) expect(q).toBe(s);
      }),
    );
  });

  it("keeps the cases the three old copies (audit, payments register, GST layouts) held", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a "quoted", value')).toBe('"a ""quoted"", value"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("\rx")).toBe('"\'\rx"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("")).toBe("");
  });

  it("is the GST layouts' writer too: a text cell is csvCell, a number is never defused", () => {
    expect(gstDefuse).toBe(defuse);
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(field(cell.text(s))).toBe(csvCell(s));
      }),
    );
    expect(field(cell.amount(-50_000))).toBe("-500.00");
  });
});
