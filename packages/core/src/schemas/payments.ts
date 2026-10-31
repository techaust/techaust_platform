// The request bodies of the payment routes (M6.1; ADM-PAY-05, ADM-PAY-06, ADM-INV-16, ADM-INV-17, Q60; run file C), zod/mini only (the finance Worker must not carry
// classic zod; namespace import, `zod-import.test.ts`). Codes only: a refusal is a zod issue whose `message` is a code (the screens hold the words, 07-ZH). The
// API checks everything that needs the database (the client, the invoices, balances, the duplicate reference) in SQL; these check shape and the rules that
// need nothing else. Schemas are built at module top level (a Worker's start-up, never the metered request); `warmPayments` parses one sample of each.
import * as z from "zod/mini";
import { parseIsoDate } from "../dates.ts";
import { UUID } from "../ids.ts";
import { ALLOCATIONS_MAX, PAYMENT_KINDS, PAYMENT_MODES, PAYMENT_STATUSES } from "../ledger.ts";

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

export const tdsIn = z.strictObject({
  section: text(TDS_SECTION_MAX),
  rateBp: z.int().check(z.gte(1), z.lte(10_000)),
  certificateNo: z.optional(text(TDS_CERTIFICATE_MAX)),
  certificateOn: z.optional(isoDate),
});

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
});

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
