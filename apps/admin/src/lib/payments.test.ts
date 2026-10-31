// The M6.1 payment screens' pure rules [ADM-PAY-05, ADM-PAY-06, ADM-INV-16, ADM-INV-17, ADM-APR-01]: 07-ZH lines 1–22 word for word, lines 23 onwards marked
// until approved, every API code the screens show mapped to its line, the allocation table's reading (core money only), the open documents a payment or a
// TDS entry can go on, the void blockers, and the payments and TDS register's CSV.
import { describe, expect, it } from "vitest";
import { RequestError } from "../api.ts";
import auditSource from "./audit.ts?raw";
import { APPROVED_07ZH_NEW, PAY_AUDIT, PLACEHOLDER_MARK, ZH } from "./copy-zh.ts";
import { voidBlockedText, voidErrorText, withdrawErrorText } from "./invoices.ts";
import {
  autoFill,
  earlierMonthLine,
  fyChoices,
  monthText,
  openDocsOf,
  overpaymentLine,
  PAY_COPY,
  PAY_ERRORS,
  PAY_UI,
  payErrorText,
  plainAmount,
  readAllocations,
  registerCsv,
  STATUS_LABELS,
  VOID_PAYMENT_PENDING,
  VOID_PAYMENT_RECORDED,
} from "./payments.ts";

const mark = (s: string) => (APPROVED_07ZH_NEW ? s : `${PLACEHOLDER_MARK} ${s}`);
const err = (code: string, message = "", details?: Record<string, string | number>) =>
  new RequestError(409, code, message, null, [], [], [], details ? { details } : {});

describe("07-ZH lines 1–22 (approved) word for word", () => {
  it("the panel, the dialog and the TDS lines", () => {
    expect([
      PAY_COPY.heading,
      PAY_COPY.paid,
      PAY_COPY.tds,
      PAY_COPY.credited,
      PAY_COPY.balance,
      PAY_COPY.excess,
    ]).toEqual([
      "Payments",
      "Paid",
      "TDS deducted by the client",
      "Credited",
      "Balance",
      "Paid above what it owes",
    ]);
    expect(PAY_COPY.recordTitle).toBe("Record a payment");
    expect(PAY_COPY.staffNotice).toBe("The owner checks this payment before it counts toward the balance.");
    expect(PAY_COPY.tdsHint).toBe(
      "The invoice and its GST stay at full value. Enter the section, rate and amount exactly as the client's certificate shows them.",
    );
    expect(PAY_COPY.certificateAwaited).toBe("Certificate awaited");
    expect(PAY_COPY.extendHint).toBe("Only your bank can extend this date.");
    expect(PAY_COPY.register).toBe("Payments and TDS register");
  });
  it("the lines with slots", () => {
    expect(overpaymentLine("₹8,800.00", "Riverside Traders")).toBe(
      "₹8,800.00 is more than this invoice owes. It is kept as Riverside Traders's credit.",
    );
    expect(earlierMonthLine("2026-09")).toBe(
      "This money arrived in September 2026. GST on it was due in that month's return; if that return is filed, add it to the next one with interest.",
    );
    expect(monthText("2026-10")).toBe("October 2026");
    expect(monthText("bad")).toBe("bad");
    expect(VOID_PAYMENT_PENDING).toBe(
      "A payment recorded on it is waiting for the owner's check. Reject it first.",
    );
  });
});

describe("07-ZH lines 23 onwards carry the mark until approved", () => {
  it("every new line is marked, the approved ones never", () => {
    expect(ZH("x")).toBe(mark("x"));
    for (const line of [
      ...Object.values(PAY_ERRORS),
      ...Object.values(STATUS_LABELS),
      VOID_PAYMENT_RECORDED,
      PAY_UI.recordTds,
    ])
      expect(line.startsWith(PLACEHOLDER_MARK)).toBe(!APPROVED_07ZH_NEW);
    expect(PAY_COPY.heading.includes(PLACEHOLDER_MARK)).toBe(false);
    // the words 07-R and 07-V already approved are not marked
    expect([PAY_UI.colClient, PAY_UI.allocInvoice, PAY_UI.colAmount]).toEqual([
      "Client",
      "Invoice",
      "Amount",
    ]);
  });
  it("the audit log reads the eight actions from line 26", () => {
    expect(Object.keys(PAY_AUDIT)).toHaveLength(8);
    for (const k of Object.keys(PAY_AUDIT)) expect(auditSource).toContain(`"${k}": PAY_AUDIT["${k}"]`);
  });
});

describe("errors by code", () => {
  it("the approved codes come from the server word for word", () => {
    expect(
      payErrorText(
        err(
          "reference_seen",
          "This bank reference was already recorded on 28 Oct 2026 for X. Record it again only if it is a different payment.",
        ),
      ),
    ).toContain("Record it again only if it is a different payment.");
    expect(payErrorText(err("payment_not_pending", "This payment was already checked."))).toBe(
      "This payment was already checked.",
    );
    expect(
      payErrorText(
        err(
          "payments_pending",
          "This client has payments waiting for the owner's check. Confirm or reject them first",
        ),
      ),
    ).toMatch(/\.$/);
  });
  it("every code without words maps to its line (never the server's placeholder)", () => {
    for (const [code, line] of Object.entries(PAY_ERRORS))
      expect(payErrorText(err(code, "[Placeholder] server words"))).toBe(line);
  });
  it("the extension refusals name their date", () => {
    expect(payErrorText(err("extension_not_later", "x", { femaDue: "2027-07-31" }))).toBe(
      mark("The new last date must be after 31 Jul 2027."),
    );
    expect(payErrorText(err("extension_too_far", "x", { latest: "2126-10-31" }))).toBe(
      mark("The new last date can't be after 31 Oct 2126."),
    );
  });
});

describe("the void blockers of M6.1", () => {
  it("a waiting payment says line 21 first; a payment put on it says line 25", () => {
    expect(voidBlockedText(["payment_pending", "has_payment"], "tax_invoice")).toBe(VOID_PAYMENT_PENDING);
    expect(voidBlockedText(["payment_recorded"], "tax_invoice")).toBe(VOID_PAYMENT_RECORDED);
    expect(voidBlockedText(["payment_pending"], "proforma")).toBe(VOID_PAYMENT_PENDING);
    expect(voidErrorText(err("payment_recorded"), "tax_invoice")).toBe(VOID_PAYMENT_RECORDED);
  });
  it("L37: a refused withdrawal with a waiting payment says line 46 (line 21's words)", () => {
    expect(withdrawErrorText(err("payment_pending"))).toBe(VOID_PAYMENT_PENDING);
    expect(VOID_PAYMENT_PENDING).toBe(
      "A payment recorded on it is waiting for the owner's check. Reject it first.",
    );
  });
});

describe("the allocation table", () => {
  const docs = [
    {
      id: "a",
      number: "TH/INV/1",
      type: "tax_invoice",
      currency: "INR" as const,
      balanceMinor: 51_200_00,
      dueDate: null,
    },
    {
      id: "b",
      number: "TH/INV/2",
      type: "tax_invoice",
      currency: "INR" as const,
      balanceMinor: 1_000_00,
      dueDate: null,
    },
  ];
  it("reads each row, skips empty and zero rows, and says what is left (an overpayment)", () => {
    const r = readAllocations(
      [
        { documentId: "a", text: "51200" },
        { documentId: "b", text: "" },
      ],
      docs,
      60_000_00,
      "INR",
    );
    expect(r).toEqual({
      ok: true,
      allocations: [{ documentId: "a", amountMinor: 51_200_00 }],
      leftMinor: 8_800_00,
      over: false,
    });
  });
  it("a row above the invoice's balance, or unreadable, is the row's error", () => {
    const r = readAllocations(
      [
        { documentId: "b", text: "1000.01" },
        { documentId: "a", text: "abc" },
      ],
      docs,
      10_000_00,
      "INR",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.b).toBe(PAY_UI.allocMore);
      expect(r.errors.a).toBeTruthy();
    }
  });
  it("more put on invoices than paid is `over`", () => {
    const r = readAllocations([{ documentId: "a", text: "500" }], docs, 100_00, "INR");
    expect(r.ok && r.over).toBe(true);
  });
  it("the opened-from row follows the amount up to the balance", () => {
    expect(autoFill(60_000_00, 51_200_00, "INR")).toBe("51200.00");
    expect(autoFill(1_000_00, 51_200_00, "INR")).toBe("1000.00");
    expect(autoFill(null, 51_200_00, "INR")).toBe("");
    expect(plainAmount(1_23_456_78, "INR")).toBe("123456.78");
  });
});

describe("the documents a payment can go on", () => {
  const row = (over: Partial<Parameters<typeof openDocsOf>[0][number]>) => ({
    id: "x",
    type: "tax_invoice",
    status: "issued",
    number: "N",
    currency: "INR" as const,
    balanceMinor: 100,
    dueDate: null,
    ...over,
  });
  it("issued, with a balance, never a credit note, a draft or a void", () => {
    const rows = [
      row({ id: "1" }),
      row({ id: "2", type: "credit_note" }),
      row({ id: "3", status: "void" }),
      row({ id: "4", balanceMinor: 0 }),
      row({ id: "5", type: "proforma" }),
      row({ id: "1" }),
    ];
    expect(openDocsOf(rows, { kind: "payment", proformas: false }).map((d) => d.id)).toEqual(["1"]);
    expect(openDocsOf(rows, { kind: "payment", proformas: true }).map((d) => d.id)).toEqual(["1", "5"]);
  });
  it("TDS: rupee tax invoices and debit notes only (L8)", () => {
    const rows = [
      row({ id: "1" }),
      row({ id: "2", type: "export_invoice" }),
      row({ id: "3", currency: "USD" }),
      row({ id: "4", type: "debit_note" }),
    ];
    expect(openDocsOf(rows, { kind: "tds", proformas: true }).map((d) => d.id)).toEqual(["1", "4"]);
  });
});

describe("the payments and TDS register", () => {
  it("money rows first, then TDS rows apart, every cell defused", () => {
    const base = {
      currency: "INR" as const,
      chargesMinor: 0,
      inrReceivedMinor: null,
      proof: null,
      client: { code: "X0001", name: "=Riverside, Traders" },
      allocations: [{ number: "TH/INV/1", kind: "allocate", amountMinor: 5_000_00 }],
    };
    const csv = registerCsv([
      {
        ...base,
        kind: "tds",
        receivedOn: "2026-10-28",
        amountMinor: 5_000_00,
        mode: null,
        reference: null,
        tds: { section: "393(1)", rateBp: 1000, certificateNo: null, certificateOn: null },
      },
      {
        ...base,
        kind: "payment",
        receivedOn: "2026-10-29",
        amountMinor: 50_000_00,
        mode: "neft",
        reference: "UTR1",
        tds: null,
      },
    ]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]?.startsWith("Date received,Entry,Client code,Client")).toBe(true);
    expect(lines[1]?.startsWith('2026-10-29,Payment,X0001,"\'=Riverside, Traders",INR,50000.00')).toBe(true);
    expect(lines[1]).toContain("NEFT,UTR1");
    expect(lines[2]).toContain("TDS,X0001");
    expect(lines[2]).toContain("393(1),10,,");
    expect(lines[2]?.endsWith("TH/INV/1 5000.00")).toBe(true);
  });
  it("five financial years, newest first", () => {
    const fys = fyChoices(Date.parse("2026-10-31T06:00:00Z"));
    expect(fys[0]).toEqual({ token: "2627", label: "2026-27" });
    expect(fys).toHaveLength(5);
    expect(fyChoices(Date.parse("2027-03-31T06:00:00Z"))[0]?.token).toBe("2627");
    expect(fyChoices(Date.parse("2027-04-01T06:00:00Z"))[0]?.token).toBe("2728");
  });
});
