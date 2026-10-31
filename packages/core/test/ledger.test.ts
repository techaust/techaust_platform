// The ledger, pure [ADM-PAY-05, ADM-PAY-06, ADM-INV-02, ADM-INV-09, ADM-INV-16; M6.1, L2, L6 to L9, L13, L17, L19]. Unit tables for each helper, then a
// fast-check model: random sequences of record, confirm, reject, apply credit, release and withdraw, with every invariant of the brief (F) checked after each step.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as invoices from "../src/invoices.ts";
import {
  ALLOCATIONS_MAX,
  balanceOf,
  type CreditPayment,
  canMovePayment,
  creditBalance,
  creditSources,
  docLedger,
  type LedgerDoc,
  ledgerStatusOf,
  PAYMENT_STATUSES,
  planAllocations,
  receiptMonthWarning,
  refundDueOf,
  releasable,
} from "../src/ledger.ts";
import * as notes from "../src/notes.ts";

const doc = (over: Partial<LedgerDoc> = {}): LedgerDoc => ({
  id: "d1",
  clientId: "c1",
  currency: "INR",
  type: "tax_invoice",
  status: "issued",
  frozen: true,
  totalMinor: 1000,
  paidMinor: 0,
  creditedMinor: 0,
  tdsMinor: 0,
  ...over,
});
const pay = { clientId: "c1", currency: "INR", kind: "payment" as const, amountMinor: 1000 };

describe("one document's ledger, with TDS [ADM-INV-16, T8]", () => {
  it("status: paid and TDS settle together; credited first; the M5.3 table keeps its answers with TDS 0", () => {
    expect(ledgerStatusOf(1000, 0, 0)).toBe("issued");
    expect(ledgerStatusOf(1000, 0, 0, 100)).toBe("partially_paid");
    expect(ledgerStatusOf(1000, 900, 0, 100)).toBe("paid");
    expect(ledgerStatusOf(1000, 800, 100, 100)).toBe("paid");
    expect(ledgerStatusOf(1000, 0, 1000, 0)).toBe("credited");
    expect(ledgerStatusOf(1000, 0, 100)).toBe("partially_credited");
    expect(ledgerStatusOf(1000, 400, 100)).toBe("partially_paid");
  });

  it("balance and excess never go below zero; docLedger is the three together", () => {
    expect(balanceOf(1000, 400, 100, 100)).toBe(400);
    expect(balanceOf(1000, 1000, 100, 100)).toBe(0);
    expect(refundDueOf(1000, 1000, 100, 100)).toBe(200);
    expect(refundDueOf(1000, 400, 100, 100)).toBe(0);
    expect(docLedger(1000, 900, 0, 100)).toEqual({ balance: 0, refundDue: 0, status: "paid" });
  });

  it("refuses a figure that is not a safe integer (a float, NaN, 2^53) instead of answering wrongly", () => {
    expect(() => balanceOf(1000.5, 0, 0)).toThrow(RangeError);
    expect(() => ledgerStatusOf(Number.NaN, 0, 0)).toThrow(RangeError);
    expect(() => refundDueOf(2 ** 53, 0, 0)).toThrow(RangeError);
    // A result that leaves the safe range is refused too.
    expect(() => refundDueOf(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0)).toThrow(RangeError);
  });

  it("the M5.3 names still come from @techaust/core/invoices and notes (one function, re-exported)", () => {
    expect(notes.ledgerStatusOf).toBe(ledgerStatusOf);
    expect(invoices.balanceOf).toBe(balanceOf);
    expect(invoices.refundDueOf).toBe(refundDueOf);
    expect(invoices.LEDGER_STATUSES).toEqual([
      "issued",
      "partially_paid",
      "paid",
      "partially_credited",
      "credited",
    ]);
  });
});

describe("payment status moves (the twin of payments_fixed) [ADM-PAY-05, L7]", () => {
  it("pending moves once to confirmed or rejected; confirmed once to withdrawn; nothing else", () => {
    const allowed = new Set([
      "pending_verification>confirmed",
      "pending_verification>rejected",
      "confirmed>withdrawn",
    ]);
    for (const from of PAYMENT_STATUSES)
      for (const to of PAYMENT_STATUSES)
        expect(canMovePayment(from, to), `${from}>${to}`).toBe(allowed.has(`${from}>${to}`));
    expect(canMovePayment("draft", "confirmed")).toBe(false);
  });
});

describe("planAllocations [ADM-PAY-06, L6, L8]", () => {
  it("puts a payment on invoices, sums two asks for one invoice, and leaves the rest as credit", () => {
    const r = planAllocations(
      pay,
      [
        { documentId: "d1", amountMinor: 300 },
        { documentId: "d2", amountMinor: 200 },
        { documentId: "d1", amountMinor: 100 },
      ],
      [doc(), doc({ id: "d2", type: "debit_note" })],
    );
    expect(r).toEqual({
      ok: true,
      allocations: [
        { documentId: "d1", amountMinor: 400 },
        { documentId: "d2", amountMinor: 200 },
      ],
      unallocatedMinor: 400,
    });
  });

  it("refuses with one code each, in order", () => {
    const many = Array.from({ length: ALLOCATIONS_MAX + 1 }, (_, i) => ({
      documentId: `d${i}`,
      amountMinor: 1,
    }));
    expect(planAllocations(pay, many, [])).toEqual({ ok: false, code: "too_many" });
    expect(planAllocations({ ...pay, amountMinor: 0 }, [], [])).toMatchObject({ code: "invalid_amount" });
    expect(planAllocations({ ...pay, allocatedMinor: -1 }, [], [])).toMatchObject({ code: "invalid_amount" });
    expect(planAllocations(pay, [{ documentId: "d1", amountMinor: 1.5 }], [doc()])).toMatchObject({
      code: "invalid_amount",
    });
    expect(planAllocations(pay, [{ documentId: "zz", amountMinor: 1 }], [doc()])).toMatchObject({
      code: "not_payable",
    });
    for (const bad of [
      { type: "proforma" },
      { type: "credit_note" },
      { status: "void" },
      { status: "draft" },
      { frozen: false },
    ])
      expect(
        planAllocations(pay, [{ documentId: "d1", amountMinor: 1 }], [doc(bad)]),
        JSON.stringify(bad),
      ).toMatchObject({
        code: "not_payable",
      });
    expect(
      planAllocations(pay, [{ documentId: "d1", amountMinor: 1 }], [doc({ clientId: "c2" })]),
    ).toMatchObject({
      code: "client_mismatch",
    });
    expect(
      planAllocations(pay, [{ documentId: "d1", amountMinor: 1 }], [doc({ currency: "USD" })]),
    ).toMatchObject({
      code: "currency_mismatch",
    });
    expect(planAllocations(pay, [{ documentId: "d1", amountMinor: 1001 }], [doc()])).toMatchObject({
      code: "exceeds_balance",
    });
    expect(
      planAllocations(pay, [{ documentId: "d1", amountMinor: 1 }], [doc({ tdsMinor: 1000 })]),
    ).toMatchObject({
      code: "exceeds_balance",
    });
    expect(
      planAllocations({ ...pay, amountMinor: 500 }, [{ documentId: "d1", amountMinor: 600 }], [doc()]),
    ).toMatchObject({ code: "exceeds_payment" });
    expect(
      planAllocations({ ...pay, allocatedMinor: 900 }, [{ documentId: "d1", amountMinor: 200 }], [doc()]),
    ).toMatchObject({ code: "exceeds_payment" });
  });

  it("TDS goes whole onto one INR tax invoice or debit note, never an export invoice (L8)", () => {
    const tds = { ...pay, kind: "tds" as const, amountMinor: 100 };
    expect(planAllocations(tds, [{ documentId: "d1", amountMinor: 100 }], [doc()])).toMatchObject({
      ok: true,
      unallocatedMinor: 0,
    });
    expect(
      planAllocations(tds, [{ documentId: "d1", amountMinor: 100 }], [doc({ type: "debit_note" })]),
    ).toMatchObject({ ok: true });
    expect(
      planAllocations(
        { ...tds, currency: "USD" },
        [{ documentId: "d1", amountMinor: 100 }],
        [doc({ type: "export_invoice", currency: "USD" })],
      ),
    ).toMatchObject({ code: "tds_not_allowed" });
    expect(planAllocations(tds, [{ documentId: "d1", amountMinor: 50 }], [doc()])).toMatchObject({
      code: "tds_not_whole",
    });
    expect(planAllocations(tds, [], [doc()])).toMatchObject({ code: "tds_not_whole" });
    expect(
      planAllocations(
        tds,
        [
          { documentId: "d1", amountMinor: 50 },
          { documentId: "d2", amountMinor: 50 },
        ],
        [doc(), doc({ id: "d2" })],
      ),
    ).toMatchObject({ code: "tds_not_whole" });
    expect(
      planAllocations({ ...tds, allocatedMinor: 100 }, [{ documentId: "d1", amountMinor: 100 }], [doc()]),
    ).toMatchObject({
      code: "tds_not_whole",
    });
  });
});

describe("credit, first in first out, and release [ADM-PAY-06, L2, L13]", () => {
  const p = (
    id: string,
    receivedOn: string,
    amountMinor: number,
    net: number,
    over: Partial<CreditPayment> = {},
  ): CreditPayment => ({
    id,
    kind: "payment",
    status: "confirmed",
    receivedOn,
    amountMinor,
    netAllocatedMinor: net,
    ...over,
  });

  it("credit is what confirmed payments hold unallocated; pending, rejected, withdrawn and TDS rows add nothing", () => {
    expect(
      creditBalance([
        p("a", "2026-10-01", 1000, 400),
        p("b", "2026-10-02", 500, 500),
        p("c", "2026-10-03", 700, 0, { status: "pending_verification" }),
        p("d", "2026-10-03", 700, 0, { status: "withdrawn" }),
        p("e", "2026-10-03", 700, 0, { kind: "tds" }),
      ]),
    ).toBe(600);
    expect(creditBalance([])).toBe(0);
  });

  it("draws the oldest money first (then by id), and never more than there is", () => {
    const ps = [p("b", "2026-10-02", 300, 0), p("a2", "2026-10-01", 100, 0), p("a1", "2026-10-01", 200, 150)];
    expect(creditSources(ps, 250)).toEqual({
      ok: true,
      sources: [
        { paymentId: "a1", amountMinor: 50 },
        { paymentId: "a2", amountMinor: 100 },
        { paymentId: "b", amountMinor: 100 },
      ],
    });
    expect(creditSources(ps, 451)).toEqual({ ok: false, code: "exceeds_credit" });
    expect(creditSources(ps, 0)).toEqual({ ok: false, code: "invalid_amount" });
  });

  it("release: at most the document's excess and what the payment holds on it; never a TDS row", () => {
    const d = doc({ paidMinor: 1000, creditedMinor: 300 });
    expect(releasable(d, "payment", 1000)).toBe(300);
    expect(releasable(d, "payment", 120)).toBe(120);
    expect(releasable(d, "tds", 1000)).toBe(0);
    expect(releasable(doc(), "payment", 1000)).toBe(0);
    expect(releasable(d, "payment", -5)).toBe(0);
  });

  it("RA-17: money from an earlier month than the invoice warns; the same or a later month does not", () => {
    expect(receiptMonthWarning("2026-09-30", "2026-10-01")).toBe("received_in_earlier_month");
    expect(receiptMonthWarning("2026-10-01", "2026-10-31")).toBeNull();
    expect(receiptMonthWarning("2026-11-01", "2026-10-31")).toBeNull();
  });
});

// ---- the model -----------------------------------------------------------------------------------------------------------------------------------------

type MPayment = { id: string; kind: "payment" | "tds"; status: string; amount: number; receivedOn: string };
type MAlloc = { paymentId: string; docId: string; amount: number; kind: "allocate" | "release" };
type Model = {
  docs: LedgerDoc[];
  payments: MPayment[];
  allocs: MAlloc[];
  /** Kept incrementally, step by step (the recompute from history must equal these). */
  paid: Map<string, number>;
  tds: Map<string, number>;
};

const netOf = (m: Model, paymentId: string, docId?: string) =>
  m.allocs
    .filter((a) => a.paymentId === paymentId && (docId === undefined || a.docId === docId))
    .reduce((s, a) => s + (a.kind === "allocate" ? a.amount : -a.amount), 0);

const docNow = (m: Model, d: LedgerDoc): LedgerDoc => ({
  ...d,
  paidMinor: m.paid.get(d.id) ?? 0,
  tdsMinor: m.tds.get(d.id) ?? 0,
});

/** Paid and TDS of a document recomputed from the history alone (the SQL recompute's rule). */
function recompute(m: Model, docId: string): { paid: number; tds: number } {
  let paid = 0;
  let tds = 0;
  for (const a of m.allocs) {
    if (a.docId !== docId) continue;
    const p = m.payments.find((x) => x.id === a.paymentId);
    if (p?.status !== "confirmed") continue;
    if (p.kind === "payment") paid += a.kind === "allocate" ? a.amount : -a.amount;
    else if (a.kind === "allocate") tds += a.amount;
  }
  return { paid, tds };
}

function applyAllocs(
  m: Model,
  p: MPayment,
  allocs: readonly { documentId: string; amountMinor: number }[],
  kind: "allocate" | "release",
) {
  for (const a of allocs) {
    m.allocs.push({ paymentId: p.id, docId: a.documentId, amount: a.amountMinor, kind });
    const sign = kind === "allocate" ? 1 : -1;
    const map = p.kind === "payment" ? m.paid : m.tds;
    map.set(a.documentId, (map.get(a.documentId) ?? 0) + sign * a.amountMinor);
  }
}

const creditPayments = (m: Model): CreditPayment[] =>
  m.payments.map((p) => ({
    id: p.id,
    kind: p.kind,
    status: p.status,
    receivedOn: p.receivedOn,
    amountMinor: p.amount,
    netAllocatedMinor: netOf(m, p.id),
  }));

type Op =
  | {
      t: "record";
      id: number;
      kind: "payment" | "tds";
      amount: number;
      confirm: boolean;
      asks: { d: number; a: number }[];
      day: number;
    }
  | { t: "confirm"; p: number; asks: { d: number; a: number }[] }
  | { t: "reject"; p: number }
  | { t: "apply"; d: number; amount: number }
  | { t: "release"; d: number; p: number; amount: number }
  | { t: "withdraw"; p: number };

function step(m: Model, op: Op): void {
  const docIds = m.docs.map((d) => d.id);
  const asksOf = (asks: { d: number; a: number }[]) =>
    asks.map((x) => ({ documentId: docIds[x.d % docIds.length] as string, amountMinor: x.a }));
  const plan = (p: MPayment, asks: { documentId: string; amountMinor: number }[]) =>
    planAllocations(
      {
        clientId: "c1",
        currency: "INR",
        kind: p.kind,
        amountMinor: p.amount,
        allocatedMinor: netOf(m, p.id),
      },
      asks,
      m.docs.map((d) => docNow(m, d)),
    );
  switch (op.t) {
    case "record": {
      const id = `p${op.id}`;
      if (m.payments.some((p) => p.id === id)) return; // the same id again: already recorded, nothing written (L12)
      const p: MPayment = {
        id,
        kind: op.kind,
        status: "pending_verification",
        amount: op.amount,
        receivedOn: `2026-10-${String(1 + (op.day % 28)).padStart(2, "0")}`,
      };
      if (!op.confirm) {
        m.payments.push(p);
        return;
      }
      const asks = asksOf(op.asks);
      const r = plan(
        p,
        op.kind === "tds" ? asks.slice(0, 1).map((a) => ({ ...a, amountMinor: p.amount })) : asks,
      );
      if (!r.ok) return; // the whole batch is refused
      p.status = "confirmed";
      m.payments.push(p);
      applyAllocs(m, p, r.allocations, "allocate");
      return;
    }
    case "confirm": {
      const p = m.payments[op.p % Math.max(1, m.payments.length)];
      if (!p || !canMovePayment(p.status, "confirmed")) return;
      const asks = asksOf(op.asks);
      const r = plan(
        p,
        p.kind === "tds" ? asks.slice(0, 1).map((a) => ({ ...a, amountMinor: p.amount })) : asks,
      );
      if (!r.ok) return;
      p.status = "confirmed";
      applyAllocs(m, p, r.allocations, "allocate");
      return;
    }
    case "reject": {
      const p = m.payments[op.p % Math.max(1, m.payments.length)];
      if (p && canMovePayment(p.status, "rejected")) p.status = "rejected";
      return;
    }
    case "withdraw": {
      const p = m.payments[op.p % Math.max(1, m.payments.length)];
      if (!p || !canMovePayment(p.status, "withdrawn")) return;
      p.status = "withdrawn";
      for (const d of docIds) {
        const held = netOf(m, p.id, d);
        const map = p.kind === "payment" ? m.paid : m.tds;
        map.set(d, (map.get(d) ?? 0) - held);
      }
      return;
    }
    case "apply": {
      const d = m.docs[op.d % m.docs.length] as LedgerDoc;
      const now = docNow(m, d);
      if (op.amount > balanceOf(now.totalMinor, now.paidMinor, now.creditedMinor, now.tdsMinor)) return;
      const src = creditSources(creditPayments(m), op.amount);
      if (!src.ok) return;
      for (const s of src.sources) {
        const p = m.payments.find((x) => x.id === s.paymentId) as MPayment;
        applyAllocs(m, p, [{ documentId: d.id, amountMinor: s.amountMinor }], "allocate");
      }
      return;
    }
    case "release": {
      const d = m.docs[op.d % m.docs.length] as LedgerDoc;
      const p = m.payments[op.p % Math.max(1, m.payments.length)];
      if (p?.status !== "confirmed") return;
      if (op.amount > releasable(docNow(m, d), p.kind, netOf(m, p.id, d.id))) return;
      applyAllocs(m, p, [{ documentId: d.id, amountMinor: op.amount }], "release");
      return;
    }
  }
}

function checkInvariants(m: Model): void {
  const confirmed = m.payments.filter((p) => p.status === "confirmed");
  for (const p of confirmed) {
    const net = netOf(m, p.id);
    expect(net).toBeLessThanOrEqual(p.amount);
    expect(net).toBeGreaterThanOrEqual(0);
    if (p.kind === "tds") expect(net).toBe(p.amount); // allocated once and in full
  }
  for (const d of m.docs) {
    const now = docNow(m, d);
    const again = recompute(m, d.id);
    expect(again).toEqual({ paid: now.paidMinor, tds: now.tdsMinor }); // the recompute from history equals the incremental state
    expect(now.paidMinor).toBeGreaterThanOrEqual(0);
    const l = docLedger(now.totalMinor, now.paidMinor, now.creditedMinor, now.tdsMinor);
    expect(l.balance).toBe(Math.max(0, now.totalMinor - now.paidMinor - now.creditedMinor - now.tdsMinor));
    expect(l.balance).toBeGreaterThanOrEqual(0);
    expect(l.status).toBe(ledgerStatusOf(now.totalMinor, now.paidMinor, now.creditedMinor, now.tdsMinor));
  }
  const credit = creditBalance(creditPayments(m));
  expect(credit).toBeGreaterThanOrEqual(0);
  const sumPaid = m.docs.reduce((s, d) => s + (m.paid.get(d.id) ?? 0), 0);
  const sumTds = m.docs.reduce((s, d) => s + (m.tds.get(d.id) ?? 0), 0);
  // conservation: every confirmed payment is either on an invoice or held as credit
  expect(confirmed.filter((p) => p.kind === "payment").reduce((s, p) => s + p.amount, 0)).toBe(
    sumPaid + credit,
  );
  expect(confirmed.filter((p) => p.kind === "tds").reduce((s, p) => s + p.amount, 0)).toBe(sumTds);
}

const ask = fc.record({ d: fc.nat(5), a: fc.integer({ min: 1, max: 1500 }) });
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    t: fc.constant("record" as const),
    id: fc.nat(12),
    kind: fc.constantFrom("payment" as const, "payment" as const, "tds" as const),
    amount: fc.integer({ min: 1, max: 3000 }),
    confirm: fc.boolean(),
    asks: fc.array(ask, { maxLength: 4 }),
    day: fc.nat(40),
  }),
  fc.record({ t: fc.constant("confirm" as const), p: fc.nat(12), asks: fc.array(ask, { maxLength: 4 }) }),
  fc.record({ t: fc.constant("reject" as const), p: fc.nat(12) }),
  fc.record({ t: fc.constant("apply" as const), d: fc.nat(5), amount: fc.integer({ min: 1, max: 2000 }) }),
  fc.record({
    t: fc.constant("release" as const),
    d: fc.nat(5),
    p: fc.nat(12),
    amount: fc.integer({ min: 1, max: 2000 }),
  }),
  fc.record({ t: fc.constant("withdraw" as const), p: fc.nat(12) }),
);
const docsArb = fc.array(
  fc.record({
    total: fc.integer({ min: 1, max: 5000 }),
    credited: fc.integer({ min: 0, max: 5000 }),
    debit: fc.boolean(),
  }),
  { minLength: 1, maxLength: 4 },
);

const freshModel = (docs: { total: number; credited: number; debit: boolean }[]): Model => ({
  docs: docs.map((d, i) =>
    doc({
      id: `d${i}`,
      type: d.debit ? "debit_note" : "tax_invoice",
      totalMinor: d.total,
      creditedMinor: Math.min(d.credited, d.total),
    }),
  ),
  payments: [],
  allocs: [],
  paid: new Map(),
  tds: new Map(),
});

describe("the ledger model: random sequences keep every invariant [ADM-PAY-06; brief F]", () => {
  it("net allocations, balances, credit, conservation, recompute = incremental, status = ledgerStatusOf, after every step", () => {
    fc.assert(
      fc.property(docsArb, fc.array(opArb, { maxLength: 40 }), (docs, ops) => {
        const m = freshModel(docs);
        for (const op of ops) {
          step(m, op);
          checkInvariants(m);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("a replay changes nothing: running the same record steps twice leaves the state of running them once", () => {
    fc.assert(
      fc.property(docsArb, fc.array(opArb, { maxLength: 25 }), (docs, ops) => {
        const records = ops.filter((o) => o.t === "record");
        const once = freshModel(docs);
        for (const op of records) step(once, op);
        const twice = freshModel(docs);
        for (const op of records) step(twice, op);
        for (const op of records) step(twice, op);
        expect(twice.allocs).toEqual(once.allocs);
        expect(twice.payments).toEqual(once.payments);
      }),
      { numRuns: 200 },
    );
  });

  it("first-in first-out sources never over-draw: they add up to the request and each stays within its payment", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            day: fc.nat(27),
            amount: fc.integer({ min: 1, max: 1000 }),
            net: fc.integer({ min: 0, max: 1000 }),
            status: fc.constantFrom(...PAYMENT_STATUSES),
          }),
          { maxLength: 8 },
        ),
        fc.integer({ min: 1, max: 5000 }),
        (rows, want) => {
          const ps: CreditPayment[] = rows.map((r, i) => ({
            id: `p${String(i).padStart(2, "0")}`,
            kind: "payment",
            status: r.status,
            receivedOn: `2026-10-${String(r.day + 1).padStart(2, "0")}`,
            amountMinor: r.amount,
            netAllocatedMinor: Math.min(r.net, r.amount),
          }));
          const r = creditSources(ps, want);
          const credit = creditBalance(ps);
          if (want > credit) expect(r).toEqual({ ok: false, code: "exceeds_credit" });
          else {
            expect(r.ok).toBe(true);
            if (!r.ok) return;
            expect(r.sources.reduce((s, x) => s + x.amountMinor, 0)).toBe(want);
            for (const s of r.sources) {
              const p = ps.find((x) => x.id === s.paymentId) as CreditPayment;
              expect(p.status).toBe("confirmed");
              expect(s.amountMinor).toBeGreaterThan(0);
              expect(s.amountMinor).toBeLessThanOrEqual(p.amountMinor - p.netAllocatedMinor);
            }
          }
        },
      ),
    );
  });
});
