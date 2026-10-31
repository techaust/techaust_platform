// 07-ZF (ADM-INV-10, POR-06): the portal's lines 18 to 20, word for word with docs/07-content-appendix/ZF-proforma-withdraw.md (read here, so a change to
// the page that isn't made in the code fails), and the status a withdrawn payment request reads.
import { describe, expect, it } from "vitest";
import zfPage from "../../../docs/07-content-appendix/ZF-proforma-withdraw.md?raw";
import { APPROVED_07ZF, WITHDRAWN_ZF } from "./copy-zf.ts";
import { clientStatus, isWithdrawnDoc, statusLabel } from "./lib/invoices.ts";

const mark = APPROVED_07ZF ? "" : "[Placeholder] ";

/** The one quoted line of 07-ZF's numbered line `n`. */
function only(n: number): string {
  const line = zfPage.split("\n").find((l) => l.startsWith(`${n}. `));
  if (!line) throw new Error(`07-ZF has no line ${n}`);
  const q = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
  expect(q).toHaveLength(1);
  return q[0] as string;
}

describe("07-ZF portal lines [ADM-INV-10, POR-06]", () => {
  it("are approved (owner, 2026-10-31): no mark", () => {
    expect(zfPage).toContain("APPROVED by the owner, 2026-10-31");
    expect(APPROVED_07ZF).toBe(true);
  });

  it("18 to 20: the list status, the page banner and the refused PDF", () => {
    expect(WITHDRAWN_ZF.status).toBe(`${mark}${only(18)}`);
    expect(WITHDRAWN_ZF.banner("{date}")).toBe(`${mark}${only(19)}`);
    expect(WITHDRAWN_ZF.pdfRefused).toBe(`${mark}${only(20)}`);
    for (const line of [WITHDRAWN_ZF.status, WITHDRAWN_ZF.banner("2 Nov 2026"), WITHDRAWN_ZF.pdfRefused])
      expect(line).not.toMatch(/[&→]/);
  });

  it("a withdrawn payment request reads Withdrawn, never Due or Void, whatever its dates", () => {
    const w = { type: "proforma", status: "withdrawn", balanceMinor: null, dueDate: null };
    expect(isWithdrawnDoc(w)).toBe(true);
    expect(clientStatus(w, "2026-11-10")).toBe("withdrawn");
    expect(statusLabel("withdrawn")).toBe(WITHDRAWN_ZF.status);
    // an older API that still sent a balance and a due date past: still Withdrawn, never Overdue
    expect(clientStatus({ ...w, balanceMinor: 100, dueDate: "2026-11-01" }, "2026-11-10")).toBe("withdrawn");
    // a balance the API nulled is never read as owed
    expect(
      clientStatus(
        { type: "tax_invoice", status: "issued", balanceMinor: null, dueDate: null },
        "2026-11-10",
      ),
    ).toBe("paid");
    expect(isWithdrawnDoc({ status: "void" })).toBe(false);
  });
});
