// The SQL of the issue batches is a stored contract (M5.1, LD3): `sendStatements` (proposals and estimates, M4.3 and M4.5) must stay
// BYTE-IDENTICAL after `invoiceIssueStatements` shared its helpers. This file's snapshot was taken before the refactor and is compared after:
// a recording stand-in for the database sees every `prepare` text and every bound value, in order. FX-1 (A0 6) moved it once, on purpose: a first version's
// freeze holds `AND (next number) <= 9999` (the series' highest number, as a literal), the invoice freeze's `series_full` guard; nothing else changed.
import { describe, expect, it } from "vitest";
import { sendStatements } from "../src/issue.ts";

type Recorded = { sql: string; values: unknown[] };

function recorder() {
  const out: Recorded[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => {
        out.push({ sql, values });
        return { sql, values } as unknown as D1PreparedStatement;
      },
    }),
  } as unknown as D1Database;
  return { db, out };
}

const recipient = { legalName: "Client", country: "IN" };
const issuer = {
  company: {
    tradeName: "T",
    legalName: "L",
    address: "A",
    gstin: null,
    stateCode: "19",
    logo: "logo-primary-color.svg",
  },
  sender: { staffId: "s1", name: "N", email: "n@example.com" },
};
const base = {
  documentId: "doc1",
  series: "proposal",
  fy: "2627",
  pattern: "TH/PRP/%s/%04d",
  argOrder: ["fy", "n"] as const,
  maxNumber: 9999,
  isFirstVersion: true,
  groupId: "grp1",
  version: 1,
  now: 1_700_000_000_000,
  issueDate: "2026-10-28",
  validUntil: "2026-11-12",
  recipient,
  issuer,
  computedJson: '{"x":1}',
  snapshotSha256: "a".repeat(64),
  issuedBy: "user1",
  expected: { updatedAt: 5, contentSha256: "b".repeat(64), numberingVersion: 3, approvalNeeded: false },
};

describe("sendStatements SQL is unchanged by the shared helpers [LD3]", () => {
  const variants: [string, Parameters<typeof sendStatements>[1]][] = [
    ["first version", base],
    ["first version, number first", { ...base, pattern: "%04d/%s", argOrder: ["n", "fy"] }],
    ["later version", { ...base, isFirstVersion: false, version: 2 }],
    ["approval needed", { ...base, expected: { ...base.expected, approvalNeeded: true } }],
    ["no numbering row", { ...base, expected: { ...base.expected, numberingVersion: null } }],
    [
      "with recipients",
      {
        ...base,
        sends: {
          rows: [
            { id: "s-1", contactId: "c-1" },
            { id: "s-2", contactId: "c-2" },
          ],
          attachPdf: true,
        },
      },
    ],
    [
      "later version with recipients and approval",
      {
        ...base,
        isFirstVersion: false,
        version: 3,
        expected: { ...base.expected, approvalNeeded: true },
        sends: { rows: [{ id: "s-1", contactId: "c-1" }], attachPdf: null },
      },
    ],
  ];
  it.each(variants)("%s", (_name, args) => {
    const { db, out } = recorder();
    const batch = sendStatements(db, args);
    expect(batch.main.length + batch.postAudit.length).toBe(out.length);
    expect(out).toMatchSnapshot();
  });
});
