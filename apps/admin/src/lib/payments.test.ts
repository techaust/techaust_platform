// The M6.1 payment screens' pure rules [ADM-PAY-05, ADM-PAY-06, ADM-INV-16, ADM-INV-17, ADM-APR-01]: 07-ZH lines 1–22 word for word, lines 23 onwards marked
// until approved, every API code the screens show mapped to its line, the allocation table's reading (core money only), the open documents a payment or a
// TDS entry can go on, the void blockers, and the payments and TDS register's CSV.
import { describe, expect, it } from "vitest";
import { RequestError } from "../api.ts";
import auditSource from "./audit.ts?raw";
import { APPROVED_07ZH_NEW, PAY_AUDIT, PLACEHOLDER_MARK, ZH } from "./copy-zh.ts";
import { voidBlockedText, voidErrorText, withdrawErrorText } from "./invoices.ts";
import type { InvoiceListRow } from "./invoices-api.ts";
import { confirmDocsOf, loadOpenDocs, loadOpenRows, OPEN_DOCS_CAP } from "./open-docs.ts";
import {
  autoFill,
  blockingRefusals,
  earlierMonthLine,
  earlierMonthOf,
  fyChoices,
  keptAsCreditLine,
  leftoverLine,
  monthText,
  openDocsOf,
  overpaymentLine,
  PAY_COPY,
  PAY_ERRORS,
  PAY_UI,
  payErrorText,
  plainAmount,
  putOnText,
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

describe("07-ZH lines 47–49 (visual review fixes, staff-only drafts)", () => {
  it("are the drafted words, marked like every line from 23", () => {
    expect(keptAsCreditLine("₹2,000.00", "Riverside Traders")).toBe(
      mark("₹2,000.00 is kept as Riverside Traders's credit."),
    );
    expect([PAY_UI.attachLetter, PAY_UI.letterSaved, PAY_UI.useCreditShort]).toEqual([
      mark("Attach the bank's letter"),
      mark("Letter attached."),
      mark("Use credit"),
    ]);
    // line 10's button words stay where an invoice is in context
    expect(PAY_COPY.useCredit).toBe("Use credit on this invoice");
  });
  it("line 50 (re-check finding 2): the letter dialog's missing-file error, apart from the file hint", () => {
    expect(PAY_UI.letterMissing).toBe(mark("Choose the bank's letter."));
    expect(PAY_UI.letterMissing).not.toBe(PAY_UI.proofFileHint);
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
  it("re-check finding 1: a row with an amount whose document isn't listed is never skipped; it is the row's error", () => {
    const r = readAllocations(
      [
        { documentId: "gone", text: "999999" },
        { documentId: "b", text: "500" },
      ],
      docs,
      1_000_00,
      "INR",
    );
    expect(r).toEqual({ ok: false, errors: { gone: PAY_ERRORS.not_payable } });
    // the reason the Confirm step found wins; an emptied (removed) row is left out
    const why = readAllocations([{ documentId: "gone", text: "10" }], docs, 1_000_00, "INR", {
      gone: PAY_ERRORS.client_mismatch,
    });
    expect(why).toEqual({ ok: false, errors: { gone: PAY_ERRORS.client_mismatch } });
    expect(readAllocations([{ documentId: "gone", text: "" }], docs, 1_000_00, "INR", { gone: "x" })).toEqual(
      {
        ok: true,
        allocations: [],
        leftMinor: 1_000_00,
        over: false,
      },
    );
    expect(
      blockingRefusals(
        [
          { documentId: "gone", text: "10" },
          { documentId: "kept", text: " " },
        ],
        [{ id: "gone" }, { id: "kept" }],
      ),
    ).toEqual(["gone"]);
  });
  it("line 9 only for a real overpayment; a deliberate split reads line 47 (visual review finding 2)", () => {
    // the listed invoices owe 52,200 together
    expect(leftoverLine(8_800_00, 60_000_00, docs, "INR", "Riverside Traders")).toEqual({
      kind: "over",
      text: overpaymentLine("₹8,800.00", "Riverside Traders"),
    });
    // 10,000 paid, 8,000 put on an invoice that owes more: kept as credit, never "more than this invoice owes"
    expect(leftoverLine(2_000_00, 10_000_00, docs, "INR", "Riverside Traders")).toEqual({
      kind: "kept",
      text: keptAsCreditLine("₹2,000.00", "Riverside Traders"),
    });
    // exactly what they owe together, one left empty on purpose: still a split
    expect(leftoverLine(1_000_00, 52_200_00, docs, "INR", "R")?.kind).toBe("kept");
    // nothing left, no amount yet, or no invoice listed (line 31 already says it): no line
    expect(leftoverLine(0, 10_000_00, docs, "INR", "R")).toBeNull();
    expect(leftoverLine(null, null, docs, "INR", "R")).toBeNull();
    expect(leftoverLine(5_00, 5_00, [], "INR", "R")).toBeNull();
  });
  it("line 10's warning before a submit: money from a month before an invoice's issue month (RA-17, core's rule)", () => {
    expect(earlierMonthOf("2026-09-30", ["2026-10-01"])).toBe("2026-09");
    expect(earlierMonthOf("2026-10-01", ["2026-10-31", "2026-09-02"])).toBeNull();
    expect(earlierMonthOf("2026-09-15", [null, undefined, "2026-09-01", "2026-11-03"])).toBe("2026-09");
    expect(earlierMonthOf(undefined, ["2026-10-01"])).toBeNull();
    expect(earlierMonthOf("2026-09-15", [])).toBeNull();
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
  it("in due-date order, the ones without a due date last (re-check finding 7)", () => {
    const rows = [
      row({ id: "none" }),
      row({ id: "late", dueDate: "2026-12-01" }),
      row({ id: "early", dueDate: "2026-09-01" }),
      row({ id: "mid", dueDate: "2026-10-15" }),
    ];
    expect(openDocsOf(rows, { kind: "payment", proformas: false }).map((d) => d.id)).toEqual([
      "early",
      "mid",
      "late",
      "none",
    ]);
  });
});

// ---- the shared paged loader and the Confirm step's documents (re-check findings 1, 5 and 7) ------------------------------------------------------------

type Row = InvoiceListRow;
const listRow = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  type: "tax_invoice",
  status: "issued",
  number: `TH/INV/${id}`,
  clientId: "c1",
  clientCode: "X0001",
  clientName: "Sample client",
  currency: "INR",
  totalMinor: 1_000_00,
  balanceMinor: 1_000_00,
  issueDate: "2026-10-01",
  dueDate: "2026-10-15",
  overdue: false,
  pdf: "ready",
  createdAt: 0,
  updatedAt: 1,
  approval: null as unknown as Row["approval"],
  ...over,
});
/** A fake list API: `byStatus` rows in pages of `size`, with keyset cursors; `calls` records every request. */
function fakeList(byStatus: Partial<Record<string, Row[]>>, size = 50) {
  const calls: { status?: string | undefined; after?: string | undefined }[] = [];
  const list = async (q: { status?: string | undefined; after?: string | undefined }) => {
    calls.push({ status: q.status, after: q.after });
    const all = byStatus[q.status ?? ""] ?? [];
    const from = q.after ? Number(q.after) : 0;
    const page = all.slice(from, from + size);
    return { invoices: page, next: from + size < all.length ? String(from + size) : null };
  };
  return { list: list as never, calls };
}
const view = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    type: "tax_invoice",
    status: "partially_paid",
    number: `TH/INV/${id}`,
    currency: "INR",
    balanceMinor: 400_00,
    dueDate: "2026-04-30",
    issueDate: "2026-04-01",
    client: { id: "c1" },
    ...over,
  }) as never;
const payment = (asked: string[]) => ({
  clientId: "c1",
  currency: "INR" as const,
  requestedAllocations: asked.map((documentId) => ({ documentId })),
});

describe("the shared paged loader of open documents", () => {
  it("follows `next` to the end of every status, de-duplicates, and sorts by due date", async () => {
    const issued = Array.from({ length: 120 }, (_, i) =>
      listRow(`i${i}`, { dueDate: `2026-${String((i % 9) + 1).padStart(2, "0")}-01` }),
    );
    const f = fakeList({ issued, partially_paid: [listRow("p1"), listRow("i3")] });
    const { rows, capped } = await loadOpenRows("c1", f.list);
    expect(rows.length).toBe(121);
    expect(capped).toBe(false);
    expect(f.calls.filter((c) => c.status === "issued").map((c) => c.after)).toEqual([
      undefined,
      "50",
      "100",
    ]);
    const { docs } = await loadOpenDocs("c1", { kind: "payment", proformas: false }, f.list);
    const dues = docs.map((d) => d.dueDate ?? "");
    expect(dues).toEqual([...dues].sort());
  });
  it("stops at the cap and says so", async () => {
    const f = fakeList({ issued: Array.from({ length: 700 }, (_, i) => listRow(`i${i}`)) });
    const { rows, capped } = await loadOpenRows("c1", f.list, OPEN_DOCS_CAP);
    expect(rows.length).toBe(OPEN_DOCS_CAP);
    expect(capped).toBe(true);
    expect(f.calls.filter((c) => c.status === "issued").length).toBe(OPEN_DOCS_CAP / 50);
  });
  it("an empty page ends a list even if it names a next one (never loops)", async () => {
    const calls: unknown[] = [];
    const list = (async () => {
      calls.push(1);
      return { invoices: [], next: "same" };
    }) as never;
    const { rows } = await loadOpenRows("c1", list);
    expect(rows).toEqual([]);
    expect(calls.length).toBe(3);
  });
});

describe("the Confirm step's documents (re-check finding 1)", () => {
  // 60 newer open invoices fill the first page; Staff asked for an older one, on the second page
  const newer = Array.from({ length: 60 }, (_, i) => listRow(`n${i}`, { dueDate: "2026-11-07" }));
  it("a requested invoice not on the first page is a row, and the leftover line counts it", async () => {
    const f = fakeList({ issued: newer, partially_paid: [] }, 50);
    // even with the loader reading every page, an asked-for document beyond the lists is read by id
    const got: string[] = [];
    const r = await confirmDocsOf(payment(["old", "n59"]), {
      list: f.list,
      get: async (id) => {
        got.push(id);
        return view(id);
      },
    });
    expect(got).toEqual(["old"]);
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect(r.refused).toEqual([]);
    // the rows asked for first, in the order asked; the rest by due date
    expect(r.docs.slice(0, 2).map((d) => d.id)).toEqual(["old", "n59"]);
    expect(r.docs.some((d) => d.id === "n59")).toBe(true);
    // the Owner's rows start from the request: nothing is dropped
    const plan = readAllocations([{ documentId: "old", text: "400" }], r.docs, 5_000_00, "INR");
    expect(plan).toEqual({
      ok: true,
      allocations: [{ documentId: "old", amountMinor: 400_00 }],
      leftMinor: 4_600_00,
      over: false,
    });
    // line 47, not line 9: the listed invoices (the asked-for one included) owe far more than the payment
    expect(leftoverLine(4_600_00, 5_000_00, r.docs, "INR", "R")?.kind).toBe("kept");
  });
  it("a requested document that can't take the payment is a refused row with its reason, blocking Confirm until cleared", async () => {
    const f = fakeList({ issued: [listRow("a")] });
    const r = await confirmDocsOf(payment(["void1", "other", "gone", "paid1"]), {
      list: f.list,
      get: async (id) => {
        if (id === "gone") throw new RequestError(404, "not_found", "Not found.");
        if (id === "void1") return view(id, { status: "void" });
        if (id === "paid1") return view(id, { status: "paid", balanceMinor: 0 });
        return view(id, { client: { id: "c2" } });
      },
    });
    expect(r.kind).toBe("ready");
    if (r.kind !== "ready") return;
    expect(r.docs.map((d) => d.id)).toEqual(["a"]);
    const why = Object.fromEntries(r.refused.map((x) => [x.id, x.error]));
    expect(why.void1).toBe(PAY_ERRORS.not_payable);
    expect(why.other).toBe(PAY_ERRORS.client_mismatch);
    expect(why.paid1).toBe(PAY_UI.allocMore);
    expect(why.gone).toBeTruthy();
    const rows = [
      { documentId: "void1", text: "10" },
      { documentId: "other", text: "" },
      { documentId: "gone", text: "10" },
      { documentId: "paid1", text: "10" },
    ];
    expect(blockingRefusals(rows, r.refused).sort()).toEqual(["gone", "paid1", "void1"]);
    expect(readAllocations(rows, r.docs, 100_00, "INR", why).ok).toBe(false);
  });
  it("a failed read throws (the screen shows Try again and keeps Confirm disabled), never an empty list", async () => {
    const failing = (async () => {
      throw new RequestError(500, "internal", "Something went wrong.");
    }) as never;
    await expect(
      confirmDocsOf(payment(["a"]), { list: failing, get: async (id) => view(id) }),
    ).rejects.toBeInstanceOf(RequestError);
    // the list loads, but reading an asked-for document fails on the server or offline: a failed read too, not a dropped row
    const f = fakeList({ issued: [] });
    await expect(
      confirmDocsOf(payment(["x"]), {
        list: f.list,
        get: async () => {
          throw new RequestError(0, "network", "Offline.");
        },
      }),
    ).rejects.toBeInstanceOf(RequestError);
  });
  it("a request naming a proforma is confirmed through its advance (L5), listed or read by id", async () => {
    const listed = await confirmDocsOf(payment(["pf"]), {
      list: fakeList({ issued: [listRow("pf", { type: "proforma" })] }).list,
      get: async (id) => view(id),
    });
    expect(listed).toEqual({ kind: "proforma", id: "pf" });
    const byId = await confirmDocsOf(payment(["pf2"]), {
      list: fakeList({}).list,
      get: async (id) => view(id, { type: "proforma", status: "issued" }),
    });
    expect(byId).toEqual({ kind: "proforma", id: "pf2" });
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
  it("code review finding 2: Put on nets each document (allocate − release) and leaves out a document released whole", () => {
    const csv = registerCsv([
      {
        kind: "payment",
        receivedOn: "2026-10-29",
        currency: "INR",
        amountMinor: 30_000_00,
        chargesMinor: 0,
        mode: "neft",
        reference: "UTR2",
        inrReceivedMinor: null,
        tds: null,
        proof: null,
        client: { code: "X0002", name: "Hillside Stores" },
        allocations: [
          { documentId: "d1", number: "TH/INV/1", kind: "allocate", amountMinor: 20_000_00 },
          { documentId: "d2", number: "TH/INV/2", kind: "allocate", amountMinor: 5_000_00 },
          { documentId: "d1", number: "TH/INV/1", kind: "release", amountMinor: 8_000_00 },
          { documentId: "d2", number: "TH/INV/2", kind: "release", amountMinor: 5_000_00 },
          { documentId: "d3", number: "TH/INV/3", kind: "allocate", amountMinor: 8_000_00 },
        ],
      },
    ]);
    const line = csv.trim().split("\r\n")[1] ?? "";
    expect(line.endsWith("TH/INV/1 12000.00; TH/INV/3 8000.00")).toBe(true);
    expect(line).not.toContain("TH/INV/2");
    // without document ids (older callers) the number keys the net the same way
    expect(
      putOnText({
        currency: "INR",
        allocations: [
          { number: "TH/INV/1", kind: "allocate", amountMinor: 100 },
          { number: "TH/INV/1", kind: "release", amountMinor: 40 },
        ],
      }),
    ).toBe("TH/INV/1 0.60");
  });
  it("five financial years, newest first", () => {
    const fys = fyChoices(Date.parse("2026-10-31T06:00:00Z"));
    expect(fys[0]).toEqual({ token: "2627", label: "2026-27" });
    expect(fys).toHaveLength(5);
    expect(fyChoices(Date.parse("2027-03-31T06:00:00Z"))[0]?.token).toBe("2627");
    expect(fyChoices(Date.parse("2027-04-01T06:00:00Z"))[0]?.token).toBe("2728");
  });
});
