// M5.4 (LD58): the invoice issue batch for the Owner and for an approval is BYTE-IDENTICAL to what M5.3 shipped (this snapshot was taken from M5.3's
// code before the `care_auto` authority was added); the care_auto batch is its own text, binds exactly the placeholders it uses, and has no session in it.
// FX-1 (A0 4) moved the credit note's snapshot once, on purpose: its two ledger statements are one (credited, balance and status from one recomputed sum).
// FX-4 (A5 11) moved it once more, on purpose: the note tail adds the tax-only debit note rule (`taxOnlyNoteExactSql`: no round-off, its total its tax).
import { describe, expect, it } from "vitest";
import { invoiceIssueStatements } from "../src/issue.ts";

type Rec = { sql: string; values: unknown[] };
const recorder = () => {
  const out: Rec[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => {
        out.push({ sql, values });
        return { sql, values } as unknown as D1PreparedStatement;
      },
    }),
  } as unknown as D1Database;
  return { db, out };
};
const highest = (sql: string) => Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));

const issuer = {
  company: {
    tradeName: "T",
    legalName: "L",
    address: "A",
    gstin: null,
    stateCode: "19",
    logo: "logo-primary-color.svg",
  },
  bank: { inr: null },
  signature: null,
  reverseChargeText: "Tax payable on reverse charge: No",
  sender: { staffId: "s1", name: "N", email: "billing@example.com" },
};
const expected = {
  updatedAt: 7_000,
  contentSha256: "h".repeat(64),
  numberingVersion: 1,
  companyVersion: 1,
  taxVersion: 1,
  paymentTermsVersion: 1,
  bankStamp: 5,
  clientUpdatedAt: 5_000,
  contact: { id: "k1", updatedAt: 9 },
};
const common = {
  documentId: "d1",
  series: "invoice",
  fy: "2627",
  pattern: "TH/INV/%s/%04d",
  argOrder: ["fy", "n"] as const,
  maxNumber: 9999,
  now: 1_700_000_000_000,
  issueDate: "2026-10-28",
  dueDate: "2026-11-04",
  recipient: { legalName: "L", country: "IN" },
  issuer,
  computedJson: "{}",
  snapshotSha256: "s".repeat(64),
  issuedBy: "u1",
  termsVersionId: null,
};
const args = (over: Record<string, unknown> = {}) =>
  ({
    ...common,
    type: "tax_invoice",
    expected,
    authority: { kind: "owner", sessionId: "s1" },
    bell: { clientName: "C", linkPrefix: "/invoices/" },
    ...over,
  }) as Parameters<typeof invoiceIssueStatements>[1];

describe("the Owner's and the approval's issue SQL did not move [LD58]", () => {
  it("owner", () => {
    const { db, out } = recorder();
    invoiceIssueStatements(db, args());
    expect(out).toMatchSnapshot();
  });
  it("approval", () => {
    const { db, out } = recorder();
    invoiceIssueStatements(db, args({ authority: { kind: "approval", sessionId: "s1", approvalId: "ap1" } }));
    expect(out).toMatchSnapshot();
  });
  it("a credit note (the note tail follows the approval tail)", () => {
    const { db, out } = recorder();
    invoiceIssueStatements(
      db,
      args({
        type: "credit_note",
        imsStatus: "pending",
        note: {
          kind: "credit",
          parentId: "p1",
          expectedParentUpdatedAt: 3,
          expectedParentCredited: 0,
          deadline: { lastDay: "2027-11-30", filedOn: null },
        },
      }),
    );
    expect(out).toMatchSnapshot();
  });
  it("every statement binds exactly the placeholders it uses", () => {
    for (const over of [{}, { authority: { kind: "approval", sessionId: "s1", approvalId: "ap1" } }]) {
      const { db, out } = recorder();
      invoiceIssueStatements(db, args(over));
      for (const r of out) expect(r.values.length, r.sql.slice(0, 60)).toBe(highest(r.sql));
    }
  });
});
