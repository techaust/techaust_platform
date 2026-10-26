// Invoice rules (M5.1): the status flow, the blockers, the void rule, the due date, the IST day and FY of an issue, and the Table 13 summary.
// VERIFY WITH CA/LEGAL: every rule under test is a researched default.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  canMoveInvoiceStatus,
  documentsIssuedSummary,
  dueDateOf,
  INVOICE_FLOW_TYPES,
  INVOICE_ISSUABLE_TYPES,
  INVOICE_SERIES_OF,
  INVOICE_STATUS_FLOW,
  type IssueFacts,
  invoiceSnapshot,
  invoiceSnapshotSha256,
  issueBlockers,
  issueDateOf,
  issueFyOf,
  LEDGER_STATUSES,
  voidBlockers,
} from "../src/invoices.ts";

describe("which types can be issued [ADM-INV-01, LD2]", () => {
  it("only the domestic tax invoice", () => {
    expect(INVOICE_ISSUABLE_TYPES).toEqual(["tax_invoice"]);
  });
});

describe("the status flow [ADM-INV-02]", () => {
  const ALL = [
    "draft",
    "pending_approval",
    "sent",
    "viewed",
    "accepted",
    "rejected",
    "expired",
    "revised",
    "issued",
    "partially_paid",
    "paid",
    "partially_credited",
    "credited",
    "converted",
    "void",
  ];

  it("a draft can only be issued", () => {
    for (const to of ALL.filter((s) => s !== "draft"))
      expect(canMoveInvoiceStatus("tax_invoice", "draft", to), to).toBe(to === "issued");
  });

  it("void and converted are terminal", () => {
    for (const from of ["void", "converted"])
      for (const to of ALL)
        expect(canMoveInvoiceStatus("proforma", from, to), `${from} to ${to}`).toBe(false);
  });

  it("a ledger status moves to any other ledger status, and a status is never a move to itself", () => {
    for (const from of LEDGER_STATUSES)
      for (const to of LEDGER_STATUSES)
        expect(canMoveInvoiceStatus("tax_invoice", from, to), `${from} to ${to}`).toBe(from !== to);
  });

  it("void only while unpaid, uncredited and with no issued child", () => {
    expect(canMoveInvoiceStatus("tax_invoice", "issued", "void")).toBe(true);
    expect(
      canMoveInvoiceStatus("tax_invoice", "issued", "void", {
        paidMinor: 1,
        creditedMinor: 0,
        hasIssuedChild: false,
      }),
    ).toBe(false);
    expect(
      canMoveInvoiceStatus("tax_invoice", "issued", "void", {
        paidMinor: 0,
        creditedMinor: 1,
        hasIssuedChild: false,
      }),
    ).toBe(false);
    expect(
      canMoveInvoiceStatus("tax_invoice", "issued", "void", {
        paidMinor: 0,
        creditedMinor: 0,
        hasIssuedChild: true,
      }),
    ).toBe(false);
    // only an issued invoice can be voided (not one that is already partly paid)
    expect(canMoveInvoiceStatus("tax_invoice", "partially_paid", "void")).toBe(false);
    expect(canMoveInvoiceStatus("tax_invoice", "paid", "void")).toBe(false);
  });

  it("only a proforma becomes converted, from issued, partly paid or paid", () => {
    for (const from of ["issued", "partially_paid", "paid"]) {
      expect(canMoveInvoiceStatus("proforma", from, "converted"), from).toBe(true);
      expect(canMoveInvoiceStatus("tax_invoice", from, "converted"), from).toBe(false);
    }
    expect(canMoveInvoiceStatus("proforma", "draft", "converted")).toBe(false);
  });

  it("a type outside the flow (a proposal, a receipt) never moves here", () => {
    for (const t of ["proposal", "estimate", "receipt", "receipt_voucher", "nonsense"])
      expect(canMoveInvoiceStatus(t, "draft", "issued"), t).toBe(false);
    for (const t of INVOICE_FLOW_TYPES) expect(canMoveInvoiceStatus(t, "draft", "issued"), t).toBe(true);
  });

  it("the table has no duplicate move", () => {
    const keys = INVOICE_STATUS_FLOW.map((m) => `${m.from}>${m.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("what stops an issue [ADM-INV-07, LD20; Rule 46]", () => {
  const good: IssueFacts = {
    type: "tax_invoice",
    currency: "INR",
    clientCurrency: "INR",
    supplier: {
      legalName: "Example Proprietor",
      tradeName: "Example Trade",
      address: "1 Road, Town",
      gstin: "19ABCDE1234F1Z5",
      stateCode: "19",
    },
    recipient: {
      legalName: "Client Pvt Ltd",
      addressLine1: "2 Street",
      gstStatus: "registered",
      gstin: "27ABCDE1234F1Z5",
      stateCode: "27",
    },
    lines: [{ sac: "998314", description: "Website build" }],
    taxErrorCount: 0,
    totalMinor: 118_000,
    reverseChargeText: "No",
  };
  const codes = (f: IssueFacts) => issueBlockers(f).map((b) => b.code);

  it("nothing blocks a complete invoice", () => {
    expect(issueBlockers(good)).toEqual([]);
  });

  const cases: [string, (f: IssueFacts) => IssueFacts, string][] = [
    [
      "supplier legal name",
      (f) => ({ ...f, supplier: { ...f.supplier, legalName: null } }),
      "supplier_legal_name_missing",
    ],
    [
      "supplier trade name",
      (f) => ({ ...f, supplier: { ...f.supplier, tradeName: " " } }),
      "supplier_trade_name_missing",
    ],
    [
      "supplier address",
      (f) => ({ ...f, supplier: { ...f.supplier, address: null } }),
      "supplier_address_missing",
    ],
    ["supplier GSTIN", (f) => ({ ...f, supplier: { ...f.supplier, gstin: null } }), "supplier_gstin_missing"],
    [
      "supplier state",
      (f) => ({ ...f, supplier: { ...f.supplier, stateCode: null } }),
      "supplier_state_missing",
    ],
    [
      "recipient legal name",
      (f) => ({ ...f, recipient: { ...f.recipient, legalName: "" } }),
      "recipient_legal_name_missing",
    ],
    [
      "recipient address",
      (f) => ({ ...f, recipient: { ...f.recipient, addressLine1: null } }),
      "recipient_address_missing",
    ],
    [
      "recipient GSTIN when registered",
      (f) => ({ ...f, recipient: { ...f.recipient, gstin: null } }),
      "recipient_gstin_missing",
    ],
    [
      "recipient state",
      (f) => ({ ...f, recipient: { ...f.recipient, stateCode: null } }),
      "recipient_state_missing",
    ],
    ["no lines", (f) => ({ ...f, lines: [] }), "no_lines"],
    ["a line without a SAC", (f) => ({ ...f, lines: [{ sac: null, description: "x" }] }), "sac_missing"],
    [
      "a SAC that is not 6 digits",
      (f) => ({ ...f, lines: [{ sac: "9983", description: "x" }] }),
      "sac_missing",
    ],
    [
      "a line without a description",
      (f) => ({ ...f, lines: [{ sac: "998314", description: "  " }] }),
      "description_missing",
    ],
    ["a tax error", (f) => ({ ...f, taxErrorCount: 1, totalMinor: null }), "tax_errors"],
    ["a zero total (Q4)", (f) => ({ ...f, totalMinor: 0 }), "total_zero"],
    ["a total that did not compute", (f) => ({ ...f, totalMinor: null }), "total_zero"],
    ["the reverse-charge statement", (f) => ({ ...f, reverseChargeText: "" }), "reverse_charge_text_missing"],
    ["another currency than the client's", (f) => ({ ...f, currency: "USD" }), "currency_mismatch"],
    [
      "a tax invoice for an overseas client",
      (f) => ({ ...f, recipient: { ...f.recipient, gstStatus: "overseas", gstin: null, stateCode: null } }),
      "type_not_for_client",
    ],
    [
      "an export invoice for a client in India",
      (f) => ({ ...f, type: "export_invoice" }),
      "type_not_for_client",
    ],
  ];
  it.each(cases)("%s blocks with its code", (_n, make, code) => {
    expect(codes(make(good))).toContain(code);
  });

  it("an unregistered recipient needs no GSTIN, and an overseas one no state", () => {
    expect(
      codes({ ...good, recipient: { ...good.recipient, gstStatus: "unregistered", gstin: null } }),
    ).toEqual([]);
    expect(
      codes({
        ...good,
        type: "export_invoice",
        recipient: { ...good.recipient, gstStatus: "overseas", gstin: null, stateCode: null },
      }),
    ).toEqual([]);
  });

  it("names the line a line blocker is about (1-based)", () => {
    const f = {
      ...good,
      lines: [good.lines[0] as (typeof good.lines)[number], { sac: null, description: "" }],
    };
    expect(issueBlockers(f)).toEqual([
      { code: "description_missing", line: 2 },
      { code: "sac_missing", line: 2 },
    ]);
  });

  it("a tax error is reported alone, not also as a zero total", () => {
    expect(codes({ ...good, taxErrorCount: 2, totalMinor: null })).toEqual(["tax_errors"]);
  });

  it("is deterministic and total over any facts (no throw)", () => {
    fc.assert(
      fc.property(
        fc.record({
          legal: fc.option(fc.string(), { nil: null }),
          sac: fc.option(fc.string(), { nil: null }),
          total: fc.option(fc.integer(), { nil: null }),
          status: fc.constantFrom("registered", "unregistered", "overseas"),
        }),
        (r) => {
          const f: IssueFacts = {
            ...good,
            recipient: { ...good.recipient, legalName: r.legal, gstStatus: r.status as "registered" },
            lines: [{ sac: r.sac, description: "d" }],
            totalMinor: r.total,
          };
          expect(issueBlockers(f)).toEqual(issueBlockers(f));
        },
      ),
    );
  });
});

describe("void [Q1, LD7]", () => {
  const base = { status: "issued", paidMinor: 0, creditedMinor: 0, hasIssuedChild: false, emailed: false };
  it("an unsent, unpaid, uncredited issued invoice can be voided", () => {
    expect(voidBlockers(base)).toEqual([]);
  });
  it("each reason has its code", () => {
    expect(voidBlockers({ ...base, status: "void" })).toEqual(["already_void"]);
    expect(voidBlockers({ ...base, status: "draft" })).toEqual(["not_issued"]);
    expect(voidBlockers({ ...base, paidMinor: 5 })).toEqual(["has_payment"]);
    expect(voidBlockers({ ...base, creditedMinor: 5 })).toEqual(["has_credit"]);
    expect(voidBlockers({ ...base, hasIssuedChild: true })).toEqual(["has_child_document"]);
    expect(voidBlockers({ ...base, emailed: true })).toEqual(["already_emailed"]);
    expect(voidBlockers({ ...base, status: "paid", paidMinor: 5 })).toEqual(["not_issued", "has_payment"]);
  });
});

describe("the IST day, the FY and the due date of an issue [LD19, Q3]", () => {
  // 31 March 2027 23:59:59.999 IST = 18:29:59.999 UTC; one millisecond later it is 1 April IST.
  const lastMs = Date.UTC(2027, 2, 31, 18, 29, 59, 999);
  it("31 March 23:59:59.999 IST is still FY 2026-27, and the next millisecond is 2027-28", () => {
    expect(issueFyOf(lastMs)).toBe("2627");
    expect(issueDateOf(lastMs)).toBe("2027-03-31");
    expect(issueFyOf(lastMs + 1)).toBe("2728");
    expect(issueDateOf(lastMs + 1)).toBe("2027-04-01");
  });
  it("the IST day, not the UTC day: 00:30 IST on the 1st is still the 31st in UTC", () => {
    const t = Date.UTC(2026, 9, 31, 19, 0); // 00:30 IST on 1 Nov
    expect(issueDateOf(t)).toBe("2026-11-01");
  });
  it("the due date is the issue date plus the client's days, else the settings' days", () => {
    expect(dueDateOf("2026-10-28", null, 7)).toBe("2026-11-04");
    expect(dueDateOf("2026-10-28", 30, 7)).toBe("2026-11-27");
    expect(dueDateOf("2026-10-28", 0, 7)).toBe("2026-10-28");
    expect(dueDateOf("2027-02-25", null, 7)).toBe("2027-03-04");
    expect(() => dueDateOf("nope", null, 7)).toThrow(RangeError);
    expect(() => dueDateOf("2026-10-28", -1, 7)).toThrow(RangeError);
  });
});

describe("Table 13: documents issued [08-A §4]", () => {
  const row = (series: string, fy: string, n: number, voided = false) => ({
    series,
    fy,
    number: n,
    numberDisplay: `TH/${series.toUpperCase()}/${fy}/${String(n).padStart(4, "0")}`,
    void: voided,
  });
  it("per series and FY: from, to, total, cancelled and net", () => {
    const summary = documentsIssuedSummary([
      row("invoice", "2627", 3),
      row("invoice", "2627", 1),
      row("invoice", "2627", 2, true),
      row("creditNote", "2627", 1),
      row("invoice", "2728", 1),
    ]);
    expect(summary).toEqual([
      {
        series: "creditNote",
        fy: "2627",
        from: "TH/CREDITNOTE/2627/0001",
        to: "TH/CREDITNOTE/2627/0001",
        total: 1,
        cancelled: 0,
        net: 1,
      },
      {
        series: "invoice",
        fy: "2627",
        from: "TH/INVOICE/2627/0001",
        to: "TH/INVOICE/2627/0003",
        total: 3,
        cancelled: 1,
        net: 2,
      },
      {
        series: "invoice",
        fy: "2728",
        from: "TH/INVOICE/2728/0001",
        to: "TH/INVOICE/2728/0001",
        total: 1,
        cancelled: 0,
        net: 1,
      },
    ]);
  });
  it("is empty for no documents, and total = cancelled + net always", () => {
    expect(documentsIssuedSummary([])).toEqual([]);
    fc.assert(
      fc.property(
        fc.array(fc.record({ n: fc.integer({ min: 1, max: 50 }), v: fc.boolean() }), { maxLength: 30 }),
        (xs) => {
          const seen = new Set<number>();
          const rows = xs
            .filter((x) => {
              if (seen.has(x.n)) return false;
              seen.add(x.n);
              return true;
            })
            .map((x) => row("invoice", "2627", x.n, x.v));
          for (const s of documentsIssuedSummary(rows)) expect(s.total).toBe(s.cancelled + s.net);
        },
      ),
    );
  });
});

describe("the series of each invoice-flow type", () => {
  it("every type has one, and an invoice and an export invoice are two series", () => {
    expect(Object.keys(INVOICE_SERIES_OF).sort()).toEqual([...INVOICE_FLOW_TYPES].sort());
    expect(INVOICE_SERIES_OF.tax_invoice).toBe("invoice");
    expect(INVOICE_SERIES_OF.export_invoice).toBe("export");
  });
});

describe("the sealed snapshot of an issued invoice [LD4]", () => {
  const input = {
    document: {
      type: "tax_invoice",
      clientId: "c1",
      currency: "INR",
      issueDate: "2026-10-28",
      dueDate: "2026-11-04",
      contentSha256: "a".repeat(64),
      termsRef: null,
      exportMode: null,
    },
    supply: { type: "intra", placeOfSupplyCode: "19", supplierStateCode: "19" },
    recipient: { legalName: "Client" },
    issuer: { company: { tradeName: "T" }, signature: null },
    computedSha256: "b".repeat(64),
  };

  it("is {v: 3, kind: invoice, header}, and the number is not in it", () => {
    expect(invoiceSnapshot(input)).toEqual({ v: 3, kind: "invoice", header: input });
    expect(JSON.stringify(invoiceSnapshot(input))).not.toContain("number");
  });

  it("hashes deterministically (key order does not matter), and any change moves the hash", async () => {
    const h = await invoiceSnapshotSha256(input);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    const reordered = {
      computedSha256: input.computedSha256,
      issuer: input.issuer,
      recipient: input.recipient,
      supply: input.supply,
      document: { ...input.document },
    };
    expect(await invoiceSnapshotSha256(reordered)).toBe(h);
    for (const changed of [
      { ...input, document: { ...input.document, dueDate: "2026-11-05" } },
      {
        ...input,
        document: { ...input.document, termsRef: { id: "t", version: 1, sha256: "c".repeat(64) } },
      },
      { ...input, recipient: { legalName: "Other" } },
      {
        ...input,
        issuer: {
          company: { tradeName: "T" },
          signature: { key: "k", sha256: "d".repeat(64), mime: "image/png" },
        },
      },
      { ...input, computedSha256: "e".repeat(64) },
    ])
      expect(await invoiceSnapshotSha256(changed)).not.toBe(h);
  });
});
