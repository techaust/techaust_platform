// The M5.2 issue statements as text (no database): every prepared statement binds exactly as many values as its highest placeholder (D1 refuses more),
// a proforma never moves a milestone, and the advance batch has the statements the run file lists. A recording stand-in for the database sees every
// `prepare` text and every bound value, in order (the same device as issue-sql.test.ts).
import { describe, expect, it } from "vitest";
import { advanceIssueStatements, invoiceIssueStatements } from "../src/issue.ts";

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
  series: "proforma",
  fy: "2627",
  pattern: "TH/PI/%s/%04d",
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
const issueArgs = (over: Record<string, unknown> = {}) =>
  ({
    ...common,
    type: "tax_invoice",
    expected,
    authority: { kind: "owner", sessionId: "s1" },
    bell: { clientName: "C", linkPrefix: "/invoices/" },
    ...over,
  }) as Parameters<typeof invoiceIssueStatements>[1];

describe("the statements bind exactly the placeholders they use [M5.2]", () => {
  it("the invoice issue batch: owner, approval, proforma, and with a declaration block", () => {
    for (const over of [
      {},
      { type: "proforma" },
      { type: "export_invoice", exportDeclarationId: "blk" },
      { authority: { kind: "approval", sessionId: "s1", approvalId: "ap1" } },
    ]) {
      const { db, out } = recorder();
      const s = invoiceIssueStatements(db, issueArgs(over));
      expect(out.length).toBe(s.main.length + s.postAudit.length);
      for (const r of out) expect(r.values.length, r.sql.slice(0, 60)).toBe(highest(r.sql));
    }
  });

  it("the freeze writes valid_until only for a proforma and the declaration id for every type", () => {
    const { db, out } = recorder();
    invoiceIssueStatements(db, issueArgs({ type: "proforma" }));
    const freeze = out.find((r) => r.sql.startsWith("UPDATE documents SET series"));
    expect(freeze?.sql).toContain("valid_until = CASE WHEN ?23 = 'proforma' THEN ?7 ELSE valid_until END");
    expect(freeze?.sql).toContain("export_declaration_id = ?27");
    expect(freeze?.values[22]).toBe("proforma");
    expect(freeze?.values[26]).toBeNull();
    // LD37: the header extras are ?28 (null when there are none, the text as given otherwise)
    expect(freeze?.sql).toContain("header_extras = ?28");
    expect(freeze?.values[27]).toBeNull();
    const again = recorder();
    invoiceIssueStatements(again.db, issueArgs({ headerExtras: '{"proforma":{"notice":"n"}}' }));
    const f2 = again.out.find((r) => r.sql.startsWith("UPDATE documents SET series"));
    expect(f2?.values[27]).toBe('{"proforma":{"notice":"n"}}');
  });

  it("a proforma does not move a milestone; every other type does (finding 2)", () => {
    const count = (type: string) => {
      const { db, out } = recorder();
      invoiceIssueStatements(db, issueArgs({ type }));
      return out.filter((r) => r.sql.includes("UPDATE milestones")).length;
    };
    expect(count("proforma")).toBe(0);
    expect(count("tax_invoice")).toBe(1);
    expect(count("export_invoice")).toBe(1);
  });

  it("the advance batch with ten lines: the statements of the run file, every one with the values it uses", () => {
    const { db, out } = recorder();
    const line = (i: number) => ({
      id: `l${i}`,
      position: i + 1,
      description: "[Placeholder]",
      detail: null,
      sac: "998314",
      qtyMilli: 1000,
      unit: "fixed",
      rateMinor: 100,
      taxableMinor: 100,
      gstRateBp: 1800,
      cgstMinor: 9,
      sgstMinor: 9,
      igstMinor: 0,
      lineTotalMinor: 118,
    });
    const s = advanceIssueStatements(db, {
      ...common,
      type: "export_invoice",
      series: "export",
      proformaId: "p1",
      expectedProformaUpdatedAt: 5,
      sessionId: "s1",
      amountMinor: 1180,
      receivedOn: "2026-10-27",
      referenceNorm: "UTR1",
      receiptId: "r1",
      contentSha256: "c".repeat(64),
      expected: {
        numberingVersion: 1,
        companyVersion: 1,
        taxVersion: 1,
        paymentTermsVersion: 1,
        bankStamp: 5,
        clientUpdatedAt: 5_000,
        contact: null,
      },
      draft: {
        clientId: "c1",
        projectId: null,
        contactId: null,
        currency: "USD",
        exportMode: "lut",
        fx: { rateMicros: 83_123_400, date: "2026-10-27", source: "FBIL reference rate" },
        subtotalMinor: 1,
        discountMinor: 0,
        taxableMinor: 1,
        cgstMinor: 0,
        sgstMinor: 0,
        igstMinor: 0,
        roundOffMinor: 0,
        totalMinor: 1180,
        totalInrMinor: 1,
        supplyType: "export_lut",
        placeOfSupplyCode: "96",
        lines: Array.from({ length: 10 }, (_, i) => line(i)),
      },
    });
    expect(out.length).toBe(s.main.length + s.postAudit.length);
    // before the audit row: the draft, ten lines, the guard, the counter row, the take, the freeze (LAST, so the audit row follows its `changes()`)
    expect(s.main.length).toBe(1 + 10 + 1 + 2 + 1);
    expect((s.main as unknown as Rec[]).at(-1)?.sql).toContain("UPDATE documents SET series");
    // after it: issue_result (unguarded), the receipt, the proforma, the milestone, the invoice paid
    expect(s.postAudit.length).toBe(5);
    expect((s.postAudit as unknown as Rec[])[0]?.sql).toContain("INSERT INTO issue_result");
    expect((s.postAudit as unknown as Rec[])[0]?.sql).not.toContain("WHERE");
    for (const r of out) expect(r.values.length, r.sql.slice(0, 60)).toBe(highest(r.sql));
    const freeze = (s.main as unknown as Rec[]).at(-1);
    // amount, proforma and its stamp are the last three values of the freeze
    expect(freeze?.values.slice(-3)).toEqual([1180, "p1", 5]);
    expect(freeze?.sql).toContain("total_minor = ?29");
    expect(freeze?.sql).toContain("p.balance_minor >= ?29");
    // LD37: the header extras are ?28; the proforma must be the invoice's own client's, in its currency (early check 4)
    expect(freeze?.sql).toContain("header_extras = ?28");
    expect(freeze?.sql).toContain("p.client_id = documents.client_id AND p.currency = documents.currency");
  });
});
