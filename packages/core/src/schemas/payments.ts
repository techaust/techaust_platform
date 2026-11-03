// The request bodies of the payment routes (M6.1; ADM-PAY-05, ADM-PAY-06, ADM-INV-16, ADM-INV-17, Q60; run file C), zod/mini only (the finance Worker must not carry
// classic zod; namespace import, `zod-import.test.ts`). Codes only: a refusal is a zod issue whose `message` is a code (the screens hold the words, 07-ZH). The
// API checks everything that needs the database (the client, the invoices, balances, the duplicate reference) in SQL; these check shape and the rules that
// need nothing else. Schemas are built at module top level (a Worker's start-up, never the metered request); `warmPayments` parses one sample of each.
import * as z from "zod/mini";
import { parseIsoDate } from "../dates.ts";
import { UUID } from "../ids.ts";
import { ALLOCATIONS_MAX, PAYMENT_KINDS, PAYMENT_MODES, PAYMENT_STATUSES } from "../ledger.ts";
import { REFUND_MODES, REFUND_PAID_TO, REFUND_REASONS } from "../refunds.ts";

const isoDate = z.string().check(z.refine((v) => parseIsoDate(v) !== null, { message: "date_invalid" }));
const uuidv7 = z.string().check(z.refine((v) => UUID.test(v) && v[14] === "7", { message: "id_invalid" }));
const ref = z.string().check(z.trim(), z.minLength(1), z.maxLength(64));
const text = (max: number) => z.string().check(z.trim(), z.minLength(1), z.maxLength(max));
const positive = z.int().check(z.gt(0));
const currency = z.enum(["INR", "USD"]);

/** The most a free-text reference may be as typed (spaces included); `normaliseReference` keeps 60 characters of letters, digits, "/" and "-". */
export const REFERENCE_TYPED_MAX = 80;
export const PAYMENT_TEXT_MAX = 500;
/** The TDS section as the client gave it (L8: never asserted by us), and a Form 16A certificate number. */
export const TDS_SECTION_MAX = 40;
export const TDS_CERTIFICATE_MAX = 40;

export const allocationIn = z.strictObject({ documentId: ref, amountMinor: positive });

/** The certificate's number and date come together or not at all (L19: "Certificate awaited" until both are entered). */
export const tdsIn = z
  .strictObject({
    section: text(TDS_SECTION_MAX),
    rateBp: z.int().check(z.gte(1), z.lte(10_000)),
    certificateNo: z.optional(text(TDS_CERTIFICATE_MAX)),
    certificateOn: z.optional(isoDate),
  })
  .check(
    z.refine((v) => (v.certificateNo === undefined) === (v.certificateOn === undefined), {
      message: "certificate_both_or_neither",
      path: ["certificateNo"],
    }),
  );

/**
 * `POST /payments` (record). A `payment` has a mode and no TDS block; a `tds` row has the TDS block, no mode, no charges, is in INR and goes whole onto one
 * invoice (L8); the INR amount of the bank advice is for a USD payment only (L15). `receivedOn` not after today (IST) is checked by the route, which knows the day.
 */
export const recordPaymentBody = z
  .strictObject({
    id: uuidv7,
    clientId: ref,
    kind: z.enum(PAYMENT_KINDS),
    currency,
    amountMinor: positive,
    receivedOn: isoDate,
    mode: z.optional(z.nullable(z.enum(PAYMENT_MODES))),
    reference: z.optional(text(REFERENCE_TYPED_MAX)),
    chargesMinor: z.optional(z.int().check(z.gte(0))),
    inrReceivedMinor: z.optional(positive),
    allocations: z.optional(z.array(allocationIn).check(z.maxLength(ALLOCATIONS_MAX))),
    tds: z.optional(tdsIn),
    note: z.optional(text(PAYMENT_TEXT_MAX)),
    confirmDuplicate: z.optional(z.boolean()),
  })
  .check(
    z.refine((v) => v.kind !== "payment" || (v.mode != null && v.tds === undefined), {
      message: "payment_needs_mode",
      path: ["mode"],
    }),
    // Early check A1: money received always carries its bank reference (the statement's line number when no tax invoice was made for it).
    z.refine((v) => v.kind !== "payment" || v.reference !== undefined, {
      message: "reference_required",
      path: ["reference"],
    }),
    z.refine(
      (v) =>
        v.kind !== "tds" ||
        (v.tds !== undefined &&
          v.mode == null &&
          (v.chargesMinor ?? 0) === 0 &&
          v.currency === "INR" &&
          v.allocations?.length === 1 &&
          v.allocations[0]?.amountMinor === v.amountMinor),
      { message: "tds_shape", path: ["tds"] },
    ),
    z.refine((v) => v.inrReceivedMinor === undefined || v.currency === "USD", {
      message: "inr_received_usd_only",
      path: ["inrReceivedMinor"],
    }),
  );

/** `POST /payments/:id/verify`: the Owner confirms (optionally changing what Staff asked for, L6) or rejects; `expectedRecordedAt` pins the row read. */
export const verifyPaymentBody = z
  .strictObject({
    decision: z.enum(["confirm", "reject"]),
    note: z.optional(text(PAYMENT_TEXT_MAX)),
    allocations: z.optional(z.array(allocationIn).check(z.maxLength(ALLOCATIONS_MAX))),
    expectedRecordedAt: z.int(),
  })
  .check(
    z.refine((v) => v.decision === "confirm" || v.allocations === undefined, {
      message: "reject_has_no_allocations",
      path: ["allocations"],
    }),
  );

/** `POST /payments/:id/withdraw` (L7): a reason is required. */
export const withdrawPaymentBody = z.strictObject({ reason: text(PAYMENT_TEXT_MAX) });

/** `POST /payments/:id/tds-certificate` (L19): the Form 16A number and date, set once. */
export const tdsCertificateBody = z.strictObject({
  certificateNo: text(TDS_CERTIFICATE_MAX),
  certificateOn: isoDate,
});

/** The proof's free-text type and reference sent with `PUT /payments/:id/proof` (L11; OPEN (08-C RB-05): which proof the bank needs). */
export const proofMeta = z.strictObject({ kind: text(60), ref: z.optional(text(REFERENCE_TYPED_MAX)) });

/** `POST /clients/:id/credit/apply` (L13): first in, first out from the credit, onto one invoice read at `expectedUpdatedAt`. */
export const creditApplyBody = z.strictObject({
  documentId: ref,
  amountMinor: positive,
  expectedUpdatedAt: z.int(),
});

/** `POST /invoices/:id/credit/release`: move an invoice's excess to the client's credit. */
export const creditReleaseBody = z.strictObject({ amountMinor: positive, expectedUpdatedAt: z.int() });

/** `POST /invoices/:id/realisation-extensions` (L14, Q60): the new last day and the AD bank's reference (Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 5(1) (08-C RB-04)). */
export const realisationExtensionBody = z.strictObject({ extendedTo: isoDate, bankRef: text(64) });

/** `GET /payments` filters (keyset paging is the route's). */
export const paymentsListQuery = z.strictObject({
  status: z.optional(z.enum(PAYMENT_STATUSES)),
  client: z.optional(ref),
  from: z.optional(isoDate),
  to: z.optional(isoDate),
  /**
   * M6.3 (L11, ADM-INV-17): `awaited`: card and PayPal payments, pending or confirmed, with no proof attached yet (Stripe's payment advice, the bank's e-FIRA or FIRC:
   * Settled by the lead on the safest reading, 2026-10-30 (08-C RB-05)), through the partial index `payments_proof_awaited`.
   */
  proof: z.optional(z.enum(["awaited"])),
});

// ---- M6.5: refunds, bank matches, settlement fetch, FEMA reductions (run file C; codes only, the words are 07-ZO's and the staff lines') ----------------

/**
 * `POST /payments/:id/refunds`. `from`: the client's credit, an invoice's excess (`documentId`, with the credit note that made it), or (L33) a pending gateway
 * payment in full. Exactly one of three ways: through the payment's gateway (neither block), by a bank transfer we make (`manual`: mode, the UTR, the day and the
 * recipient, RB-24), or a refund already made outside the admin or a lost dispute (`outside`: the gateway's id). `confirmExport`: the Owner ticked that the AD bank
 * was asked first (RB-43). The route checks what needs the database (`planRefund`, the live guard, the dates against today).
 */
export const refundBody = z
  .strictObject({
    id: uuidv7,
    amountMinor: positive,
    from: z.enum(["credit", "document", "pending"]),
    documentId: z.optional(ref),
    creditNoteId: z.optional(ref),
    reasonCode: z.enum(REFUND_REASONS),
    note: z.optional(text(PAYMENT_TEXT_MAX)),
    manual: z.optional(
      z.strictObject({
        mode: z.enum(REFUND_MODES),
        reference: text(REFERENCE_TYPED_MAX),
        paidOn: isoDate,
        paidTo: z.enum(REFUND_PAID_TO),
        /** RB-24 (review part 1, finding 10): the payer asked in writing for the refund to another account in their own name; required with `own_account`. */
        writtenRequest: z.optional(z.literal(true)),
      }),
    ),
    outside: z.optional(
      z.strictObject({
        providerRefundId: text(255),
        origin: z.enum(["outside", "chargeback"]),
        settledOn: isoDate,
      }),
    ),
    confirmExport: z.optional(z.boolean()),
    expectedUpdatedAt: z.optional(z.int()),
  })
  .check(
    z.refine((v) => (v.from === "document") === (v.documentId !== undefined), {
      message: "document_invalid",
      path: ["documentId"],
    }),
    z.refine((v) => v.creditNoteId === undefined || v.from === "document", {
      message: "document_invalid",
      path: ["creditNoteId"],
    }),
    z.refine((v) => !(v.manual && v.outside), { message: "refund_way_invalid", path: ["manual"] }),
    // RB-24 (review part 1, finding 10): a refund to the payer's own other account only on their written request, recorded on the server (the audit summary).
    z.refine((v) => v.manual?.paidTo !== "own_account" || v.manual.writtenRequest === true, {
      message: "written_request_missing",
      path: ["manual", "writtenRequest"],
    }),
    // L33: a pending gateway payment goes back through its own gateway, never by our bank transfer; a refund made in the gateway's dashboard is recorded in
    // full (`outside`, early check 1, finding 4: else it could never be recorded and would block the void or withdraw for ever).
    z.refine((v) => v.from !== "pending" || !v.manual, {
      message: "refund_way_invalid",
      path: ["from"],
    }),
    z.refine((v) => (v.outside?.origin === "chargeback") === (v.reasonCode === "chargeback"), {
      message: "reason_invalid",
      path: ["reasonCode"],
    }),
  );

/**
 * `POST /refunds/:id/inr` (review part 1, finding 9; L9): the INR the bank debited for a USD refund that went out, as its advice shows it (set once, by the Owner),
 * for the refunds register's "INR value".
 */
export const refundInrBody = z.strictObject({ inrMinor: positive });

/** `POST /reconciliation/bank-matches`: the Owner's "seen in the bank statement" tick of one payment, settlement or refund. */
export const bankMatchBody = z.strictObject({
  id: uuidv7,
  target: z.strictObject({ kind: z.enum(["payment", "settlement", "refund"]), id: ref }),
  statementOn: isoDate,
  statementRef: z.optional(text(64)),
});
/** `POST /reconciliation/bank-matches/:id/remove`: the undo, with a reason. */
export const bankMatchRemoveBody = z.strictObject({ reason: text(200) });
/** `POST /reconciliation/settlements/fetch`: one IST day (one page; at most one fetch per 5 minutes). */
export const reconFetchBody = z.strictObject({ day: isoDate });
/** `POST /invoices/:id/realisation-reductions` (RB-43): the AD bank's Reg. 6 reduction, its amount, day and reference, and whether it was on our declaration. */
export const realisationReductionBody = z.strictObject({
  id: uuidv7,
  amountMinor: positive,
  approvedOn: isoDate,
  bankRef: text(64),
  declaration: z.boolean(),
  note: z.optional(text(PAYMENT_TEXT_MAX)),
});

/** The M6.5 bodies' warm-up (J: `warm-finance.ts` `warmRefunds()` calls it): one made-up sample each; returns how many parsed (5). */
export function warmRefundBodies(): number {
  try {
    const samples: [{ safeParse: (v: unknown) => { success: boolean } }, unknown][] = [
      [
        refundBody,
        {
          id: "01900000-0000-7000-8000-000000000002",
          amountMinor: 100,
          from: "credit",
          reasonCode: "overpayment",
          manual: { mode: "neft", reference: "WARMUTR2", paidOn: "2026-11-03", paidTo: "original" },
        },
      ],
      [
        bankMatchBody,
        {
          id: "01900000-0000-7000-8000-000000000003",
          target: { kind: "payment", id: "warm-payment" },
          statementOn: "2026-11-03",
        },
      ],
      [bankMatchRemoveBody, { reason: "Warm up" }],
      [reconFetchBody, { day: "2026-11-03" }],
      [
        realisationReductionBody,
        {
          id: "01900000-0000-7000-8000-000000000004",
          amountMinor: 100,
          approvedOn: "2026-11-03",
          bankRef: "WARM",
          declaration: true,
        },
      ],
    ];
    return samples.filter(([s, v]) => s.safeParse(v).success).length;
  } catch {
    return 0;
  }
}

/** Parses one made-up sample of each body at start-up (the warm-up rule of `warm.ts`); returns how many parsed, so a test notices a sample that went stale. */
export function warmPayments(): number {
  try {
    const samples: [{ safeParse: (v: unknown) => { success: boolean } }, unknown][] = [
      [
        recordPaymentBody,
        {
          id: "01900000-0000-7000-8000-000000000001",
          clientId: "warm-client",
          kind: "payment",
          currency: "INR",
          amountMinor: 100,
          receivedOn: "2026-10-31",
          mode: "neft",
          reference: "WARMUTR1",
          allocations: [{ documentId: "warm-document", amountMinor: 100 }],
        },
      ],
      [verifyPaymentBody, { decision: "confirm", expectedRecordedAt: 1 }],
      [withdrawPaymentBody, { reason: "Warm up" }],
      [tdsCertificateBody, { certificateNo: "WARM1", certificateOn: "2026-10-31" }],
      [creditApplyBody, { documentId: "warm-document", amountMinor: 1, expectedUpdatedAt: 1 }],
      [creditReleaseBody, { amountMinor: 1, expectedUpdatedAt: 1 }],
      [realisationExtensionBody, { extendedTo: "2027-10-31", bankRef: "WARM" }],
      [paymentsListQuery, { status: "confirmed" }],
      [proofMeta, { kind: "Warm" }],
    ];
    return samples.filter(([s, v]) => s.safeParse(v).success).length;
  } catch {
    return 0;
  }
}
