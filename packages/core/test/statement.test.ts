// The statement of account's arithmetic [ADM-CLI-04; M5.5b, LD78; Q58, VERIFY WITH CA/LEGAL]: debits, credits, the running balance and the
// closing balance, in bigint with a checked way back, never rounded or clipped.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  STATEMENT_DEBIT_TYPES,
  STATEMENT_PDF_MAX_ENTRIES,
  type StatementKind,
  type StatementRow,
  statementEntries,
} from "../src/statement.ts";

const row = (kind: StatementKind, amountMinor: number, id = `${kind}-${amountMinor}`): StatementRow => ({
  id,
  kind,
  date: "2026-10-05",
  number: "TH/INV/2627/0001",
  amountMinor,
});

describe("statementEntries", () => {
  it("debits add, credit notes and receipts subtract, and the running balance follows", () => {
    const r = statementEntries(
      [
        row("tax_invoice", 118_000),
        row("export_invoice", 83_500_00),
        row("debit_note", 5_000),
        row("credit_note", 18_000),
        row("receipt", 118_000),
      ],
      0,
    );
    if (!r.ok) throw new Error("ok");
    expect(r.entries.map((e) => [e.debitMinor, e.creditMinor, e.balanceMinor])).toEqual([
      [118_000, 0, 118_000],
      [83_500_00, 0, 118_000 + 83_500_00],
      [5_000, 0, 118_000 + 83_500_00 + 5_000],
      [0, 18_000, 118_000 + 83_500_00 + 5_000 - 18_000],
      [0, 118_000, 83_500_00 + 5_000 - 18_000],
    ]);
    expect(r.totals).toEqual({ debitMinor: 118_000 + 83_500_00 + 5_000, creditMinor: 18_000 + 118_000 });
    expect(r.closingMinor).toBe(83_500_00 + 5_000 - 18_000);
  });

  it("starts from the opening balance, which may be negative (a client in credit)", () => {
    const r = statementEntries([row("tax_invoice", 1_000)], -5_000);
    expect(r.ok && r.closingMinor).toBe(-4_000);
    expect(r.ok && r.entries[0]?.balanceMinor).toBe(-4_000);
  });

  it("an empty page closes at the opening balance", () => {
    expect(statementEntries([], 1234)).toEqual({
      ok: true,
      entries: [],
      totals: { debitMinor: 0, creditMinor: 0 },
      closingMinor: 1234,
    });
  });

  it("keeps every field of the row and the order given", () => {
    const rows = [row("credit_note", 5, "z"), row("tax_invoice", 9, "a")];
    const r = statementEntries(rows, 0);
    expect(r.ok && r.entries.map((e) => e.id)).toEqual(["z", "a"]);
    expect(r.ok && r.entries[0]).toMatchObject({
      kind: "credit_note",
      date: "2026-10-05",
      number: "TH/INV/2627/0001",
    });
  });

  it("opening + debits - credits = closing, and the last running balance is the closing one (property)", () => {
    const kinds: StatementKind[] = ["tax_invoice", "export_invoice", "debit_note", "credit_note", "receipt"];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ kind: fc.constantFrom(...kinds), amount: fc.integer({ min: 1, max: 10 ** 12 }) }),
          {
            maxLength: 60,
          },
        ),
        fc.integer({ min: -(10 ** 12), max: 10 ** 12 }),
        (items, opening) => {
          const r = statementEntries(
            items.map((x, i) => row(x.kind, x.amount, `r${i}`)),
            opening,
          );
          if (!r.ok) return false;
          return (
            r.closingMinor === opening + r.totals.debitMinor - r.totals.creditMinor &&
            (r.entries.at(-1)?.balanceMinor ?? opening) === r.closingMinor
          );
        },
      ),
    );
  });

  it("is split-invariant: two pages chained by the balance equal the whole", () => {
    const rows = [
      row("tax_invoice", 100, "a"),
      row("credit_note", 30, "b"),
      row("debit_note", 7, "c"),
      row("receipt", 20, "d"),
    ];
    const whole = statementEntries(rows, 10);
    const first = statementEntries(rows.slice(0, 2), 10);
    if (!whole.ok || !first.ok) throw new Error("ok");
    const second = statementEntries(rows.slice(2), first.closingMinor);
    expect(second.ok && [...first.entries, ...second.entries]).toEqual(whole.entries);
    expect(second.ok && second.closingMinor).toBe(whole.closingMinor);
  });

  it("refuses an amount that is zero, negative, fractional, NaN or unsafe, and a bad opening balance", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, 2 ** 53, Number.POSITIVE_INFINITY]) {
      expect(statementEntries([row("tax_invoice", bad)], 0), String(bad)).toEqual({
        ok: false,
        code: "amount_invalid",
      });
    }
    for (const opening of [1.5, Number.NaN, 2 ** 53]) {
      expect(statementEntries([], opening)).toEqual({ ok: false, code: "amount_invalid" });
    }
  });

  it("a running balance or a sum beyond the safe-integer range is amount_out_of_range, never clipped", () => {
    const big = Number.MAX_SAFE_INTEGER;
    expect(statementEntries([row("tax_invoice", big), row("tax_invoice", big)], 0)).toEqual({
      ok: false,
      code: "amount_out_of_range",
    });
    expect(statementEntries([row("credit_note", big), row("credit_note", big)], 0)).toEqual({
      ok: false,
      code: "amount_out_of_range",
    });
    // debits and credits each in range, but a total of one side out of range with the balance back in range
    expect(
      statementEntries(
        [row("tax_invoice", big), row("credit_note", big), row("tax_invoice", big), row("credit_note", big)],
        0,
      ),
    ).toEqual({ ok: false, code: "amount_out_of_range" });
  });

  it("names the debit types of the ledger and the PDF limit", () => {
    expect(STATEMENT_DEBIT_TYPES).toEqual(["tax_invoice", "export_invoice", "debit_note"]);
    expect(STATEMENT_PDF_MAX_ENTRIES).toBe(200);
  });
});
