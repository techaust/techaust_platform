// M6.5 second review, the screen wiring builder B6 made [ADM-PAY-08, -10; run file "Second review" M1, M4, M5, M6, L2, L6]. The pool has no DOM, so these read
// the sources (the `?raw` pattern of components/dialog-focus.test.ts): the record and verify results carry the RA-41 line, the credit-held list marks money
// confirmed after its period, a refund's day never breaks inside itself, a settlement line's id keeps one line from 48rem, the settlement dialog pages its
// lines, the refund dialog sends no credit note of its own and starts USD-abroad refunds on SWIFT. The words and pure helpers are tested in copy-zo.test.ts and
// refunds-api.test.ts; how they look is the reviewer's live check.
import { describe, expect, it } from "vitest";
import creditHeldTab from "../routes/payments/credit-held-tab.tsx?raw";
import recordDialog from "../routes/payments/record-dialog.tsx?raw";
import refundDialog from "../routes/payments/refund-dialog.tsx?raw";
import refundParts from "../routes/payments/refund-parts.tsx?raw";
import paymentsRoute from "../routes/payments.tsx?raw";
import reconciliation from "../routes/reconciliation.tsx?raw";

describe("second review screen wiring", () => {
  it("M1: the Owner's record and the verify add the RA-41 line to their result; the credit-held list marks money confirmed after its period", () => {
    expect(recordDialog).toContain("ra41ConfirmLine(answer.ra41)");
    expect(paymentsRoute).toContain("ra41ConfirmLine(r.ra41)");
    expect(creditHeldTab).toMatch(
      /r\.confirmedAfter && <span className="pay-lines__meta">\{ZO_UI\.creditHeldConfirmedAfter\}<\/span>/,
    );
  });

  it('M4: "Refunded on" keeps its day on one line', () => {
    expect(refundParts).toMatch(/<span className="pay-lines__nowrap">\{day\(r\.settledOn\)\}<\/span>/);
  });

  it("M5: a settlement line's id carries `rcn-id` (one line from 48rem, refunds.css), never the shared `break` that wraps it anywhere", () => {
    // (the pool doesn't load stylesheets, even `?raw`, so the rule itself is read by the reviewer's live check)
    const lines = reconciliation.slice(
      reconciliation.indexOf("function ItemLines"),
      reconciliation.indexOf("function Unmatched"),
    );
    expect(lines.match(/className="docno rcn-id"/g)).toHaveLength(2);
    expect(lines).not.toMatch(/className="[^"]*\bbreak\b/);
  });

  it("M6: the refund dialog sends no credit note of its own (the server links the one that made the excess)", () => {
    expect(refundDialog).not.toMatch(/creditNoteId:/);
  });

  it("L2: the settlement dialog reads its lines page by page with Show more", () => {
    const dialog = reconciliation.slice(
      reconciliation.indexOf("function SettlementDialog"),
      reconciliation.indexOf("function ItemLines"),
    );
    expect(dialog).toContain("usePages<SettlementItemRow>((c) => refundsApi.settlement(r.id, c), r.id)");
    expect(dialog).toContain("<ShowMore cursor={pages.cursor}");
  });

  it('L6: "Paid by" starts from defaultRefundMode (SWIFT for US dollars abroad)', () => {
    expect(refundDialog).toContain(
      "useState<string>(() => defaultRefundMode(cur, props.clientOverseas === true))",
    );
  });
});
