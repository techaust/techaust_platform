// The deed of assignment of copyright (T11; run file docs/runs/t11-deed.md, L1 to L8). Pure: no I/O. Three parts:
//   1. the status flow (L4);
//   2. L2, full payment: `deedEligibility` over a project's facts, the twin of `deedEligibleSql` / `deedFactsSql` (`packages/db/src/deeds.ts`; a db test compares
//      them over a table of cases), with the blockers the project page shows;
//   3. L6, the values: `deedSnapshotOf` assembles every `{…}` value of 07-ZE's text from the settings, the client, the accepted version and L2's documents, and
//      `deedText` fills the approved text word for word (docs/07-content-appendix/ZE-terms-offers-deed.md, section D and "The deed's text").
// Money is integer minor units with bigint sums (the no-floats scan lists this file). Not legal advice: the lead's safest reading under the owner's decision of
// 2026-10-30 (no CA or lawyer); every line rests on the register entry its comment names.
import { type CalendarDate, formatDate, formatIstDateTime, fromIst, istDate, parseIsoDate } from "./dates.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { type Currency, formatMoney, isCurrency } from "./money.ts";
import { compareDocNumbers } from "./numbering.ts";

// ---- 1. the status flow (L4) ------------------------------------------------------------------------------------------------------------------------------

export const DEED_STATUSES = ["draft", "final", "signed", "cancelled"] as const;
export type DeedStatus = (typeof DEED_STATUSES)[number];

const MOVES: Readonly<Record<DeedStatus, readonly DeedStatus[]>> = {
  draft: ["final", "cancelled"],
  final: ["signed"],
  signed: [],
  cancelled: [],
};

/** Draft → final or cancelled, final → signed; nothing else (the trigger `deeds_status_flow` is the twin). A final or signed deed is never edited or deleted. */
export const canMoveDeed = (from: DeedStatus, to: DeedStatus): boolean => MOVES[from].includes(to);

/** The Schedules are editable only on a draft (Owner and Staff, L4). */
export const deedSchedulesEditable = (status: DeedStatus): boolean => status === "draft";

/** The longest text each Schedule field takes (the CHECK constraints of 0061; a db test compares the two). */
export const DEED_SCHEDULE_LIMITS = {
  deliverables: 4000,
  location: 500,
  deliveredDates: 500,
  tools: 2000,
  thirdParty: 4000,
} as const;
export type DeedScheduleField = keyof typeof DEED_SCHEDULE_LIMITS;
export const DEED_SCHEDULE_FIELDS = Object.keys(DEED_SCHEDULE_LIMITS) as DeedScheduleField[];
export type DeedSchedules = Readonly<Record<DeedScheduleField, string | null>>;

/** The Schedule fields still blank (L6: every field must be filled in before finalising; Schedule 2 may say "None", typed explicitly). */
export const blankSchedules = (s: DeedSchedules): DeedScheduleField[] =>
  DEED_SCHEDULE_FIELDS.filter((f) => (s[f] ?? "").trim() === "");

// ---- 2. L2, full payment ----------------------------------------------------------------------------------------------------------------------------------

/** The document types a payment settles (core `PAYABLE_TYPES` of `ledger.ts`): an invoice for a payment received is a tax or export invoice. */
const PAYABLE = ["tax_invoice", "export_invoice", "debit_note"] as const;

/** One document of the project as L2 reads it (the ledger columns of `documents`). */
export type DeedDocFact = {
  readonly type: string;
  readonly frozen: boolean;
  readonly status: string;
  readonly currency: string;
  readonly totalMinor: number;
  readonly paidMinor: number;
  readonly creditedMinor: number;
  readonly tdsMinor: number;
  readonly balanceMinor: number;
  /** The document belongs to a care plan (its `care_plan_id`). */
  readonly carePlan: boolean;
};

/** The project's facts as L2 reads them. */
export type DeedFacts = {
  readonly projectStatus: string;
  /** The project's source document as read, or null when it has none. `sameClient`: it belongs to the project's client. */
  readonly source: {
    readonly type: string;
    readonly status: string;
    readonly frozen: boolean;
    readonly sameClient: boolean;
    readonly currency: string;
    readonly totalMinor: number;
  } | null;
  readonly clientAnonymised: boolean;
  /** A care plan was made from the project's source document. */
  readonly carePlanFromSource: boolean;
  readonly documents: readonly DeedDocFact[];
};

export type DeedBlocker =
  | "not_completed"
  | "no_accepted_source"
  | "client_anonymised"
  | "care_plan"
  | "no_invoices"
  | "balance_due"
  | "short_paid"
  | "nothing_paid";

/** The aggregated facts (`deedFactsSql`'s row, or `deedFactsOf`'s): what `deedBlockersOf` decides on. */
export type DeedFactSums = {
  readonly projectStatus: string;
  readonly sourceOk: boolean;
  readonly acceptedCurrency: string | null;
  readonly acceptedTotalMinor: number | null;
  readonly clientAnonymised: boolean;
  readonly carePlan: boolean;
  readonly payables: number;
  readonly unpaid: number;
  readonly settledMinor: number;
  /** Σ `credited_minor` of the live payables in the accepted currency: credit notes lower the target (owner, 2026-11-01). */
  readonly creditedMinor: number;
};

const big = (n: number, what: string): bigint => {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} must be a whole number of minor units`);
  return BigInt(n);
};

/** A live payable document: frozen, not void, a tax or export invoice or a debit note (never a proforma; a credit note is a reduction). */
export const isLivePayable = (d: Pick<DeedDocFact, "type" | "frozen" | "status">): boolean =>
  d.frozen && d.status !== "void" && (PAYABLE as readonly string[]).includes(d.type);

/**
 * What the money settles on one document: `max(0, min(paid + tds, total - credited))` (the twin of `settledSql`). Money is counted where it is allocated
 * (`paid` is the confirmed allocations net of releases, M6.1), never by a document's total, so an advance's tax invoice and any later invoice each count only
 * their own money; TDS by certificate settles like money (Settled by the lead on the safest reading, 2026-10-30 (08-C RA-30)); a credit note lowers the figure.
 */
export function settledOf(
  d: Pick<DeedDocFact, "totalMinor" | "paidMinor" | "creditedMinor" | "tdsMinor">,
): number {
  const settled = big(d.paidMinor, "paid") + big(d.tdsMinor, "tds");
  const owed = big(d.totalMinor, "total") - big(d.creditedMinor, "credited");
  const v = settled < owed ? settled : owed;
  return Number(v > 0n ? v : 0n);
}

/** The source document is an accepted, frozen proposal or estimate of the project's client. */
const sourceAccepted = (s: NonNullable<DeedFacts["source"]>): boolean =>
  s.sameClient && s.frozen && s.status === "accepted" && (s.type === "proposal" || s.type === "estimate");

/** The sums `deedBlockersOf` needs, from the per-document facts (the SQL row has them already). */
export function deedFactsOf(f: DeedFacts): DeedFactSums {
  const live = f.documents.filter(isLivePayable);
  const currency = f.source?.currency ?? null;
  let settled = 0n;
  let credited = 0n;
  for (const d of live)
    if (d.currency === currency) {
      settled += BigInt(settledOf(d));
      credited += big(d.creditedMinor, "credited");
    }
  return {
    projectStatus: f.projectStatus,
    sourceOk: f.source !== null && sourceAccepted(f.source),
    acceptedCurrency: currency,
    acceptedTotalMinor: f.source?.totalMinor ?? null,
    clientAnonymised: f.clientAnonymised,
    carePlan: f.carePlanFromSource || f.documents.some((d) => d.carePlan),
    payables: live.length,
    unpaid: live.filter((d) => d.balanceMinor !== 0).length,
    settledMinor: Number(settled),
    creditedMinor: Number(credited),
  };
}

/**
 * The amount the money must reach: the accepted total less the credit notes on the project's live payables (owner, 2026-11-01: a credit note given as a
 * discount lowers what is owed, so the client still gets a deed once everything owed is paid). Never below zero. Null without an accepted total.
 */
export function deedTargetOf(s: Pick<DeedFactSums, "acceptedTotalMinor" | "creditedMinor">): number | null {
  if (s.acceptedTotalMinor === null) return null;
  const t = big(s.acceptedTotalMinor, "accepted total") - big(s.creditedMinor, "credited");
  return Number(t > 0n ? t : 0n);
}

/**
 * L2 (run file; Researched 2026-10-31, Copyright Act s.19(1) and (3) (08-C RB-38(a)): the deed records that the price was paid in full): every reason the project
 * cannot have a deed yet, in a fixed order; none means eligible. Care-plan projects and anonymised clients never get one (L2, L7). The money settled must reach the
 * accepted total less the credit notes (owner, 2026-11-01), and some money must have been settled at all: a project credited in full gets no deed (lead,
 * 2026-11-01, decision (a)). The twin of `deedEligibleSql`: `Σ settled + Σ credited >= accepted total AND Σ settled > 0`.
 */
export function deedBlockersOf(s: DeedFactSums): DeedBlocker[] {
  const out: DeedBlocker[] = [];
  if (s.projectStatus !== "completed") out.push("not_completed");
  if (!s.sourceOk || s.acceptedTotalMinor === null) out.push("no_accepted_source");
  if (s.clientAnonymised) out.push("client_anonymised");
  if (s.carePlan) out.push("care_plan");
  if (s.payables === 0) out.push("no_invoices");
  if (s.unpaid > 0) out.push("balance_due");
  const target = deedTargetOf(s);
  if (target !== null && big(s.settledMinor, "settled") < BigInt(target)) out.push("short_paid");
  if (big(s.settledMinor, "settled") <= 0n) out.push("nothing_paid");
  return out;
}

export type DeedEligibility = {
  readonly eligible: boolean;
  readonly blockers: readonly DeedBlocker[];
  /** What the money settled (the deed's `{amount_paid}`). */
  readonly settledMinor: number;
  readonly acceptedTotalMinor: number | null;
  /** The credit notes on the live payables in the accepted currency, and the target they leave (the accepted total less them, never below 0). */
  readonly creditedMinor: number;
  readonly targetMinor: number | null;
  /** How far the settled money is short of the target (0 once it reaches it; null without an accepted total). */
  readonly shortfallMinor: number | null;
  readonly currency: string | null;
};

/** L2 over the per-document facts (the twin of `deedEligibleSql` without "no deed yet"). */
export function deedEligibility(f: DeedFacts): DeedEligibility {
  return eligibilityOfSums(deedFactsOf(f));
}

/** L2 over the aggregated facts (the admin's read of `deedFactsSql`). */
export function eligibilityOfSums(s: DeedFactSums): DeedEligibility {
  const blockers = deedBlockersOf(s);
  const target = deedTargetOf(s);
  const short = target === null ? null : BigInt(target) - big(s.settledMinor, "settled");
  return {
    eligible: blockers.length === 0,
    blockers,
    settledMinor: s.settledMinor,
    acceptedTotalMinor: s.acceptedTotalMinor,
    creditedMinor: s.creditedMinor,
    targetMinor: target,
    shortfallMinor: short === null ? null : Number(short > 0n ? short : 0n),
    currency: s.acceptedCurrency,
  };
}

// ---- 3. L6, the values and the text ------------------------------------------------------------------------------------------------------------------------

/** The layout id of the sealed values (a later change of shape takes a new id; the jobs Worker refuses one it does not know). */
export const DEED_LAYOUT_ID = "deed-v1";

/**
 * Every `{…}` value of 07-ZE's deed text, frozen at finalising (L4) and sealed by its SHA-256. The number (`{deed_number}`) sits outside it, as an invoice's
 * number sits outside its seal: it is assigned in the finalise batch.
 */
export type DeedSnapshot = {
  readonly layout: typeof DEED_LAYOUT_ID;
  /** ISO date (IST) the deed is made on. */
  readonly madeOn: string;
  /** Settings › Company at finalising: the principal place of business on one line, and the GSTIN (L6; lead, 2026-11-01, triage 4). */
  readonly supplier: { readonly address: string; readonly gstin: string };
  /** The client record at finalising (L6): legal name, the billing address as one line, and the GSTIN when it has one. */
  readonly client: {
    readonly legalName: string;
    readonly address: string | null;
    readonly reg: string | null;
  };
  /** The accepted version (L6): its type, number, version and the IST day it was accepted. */
  readonly offer: {
    readonly docType: "proposal" | "estimate";
    readonly number: string;
    readonly version: number;
    readonly acceptedOn: string;
  };
  /** L2's documents (their numbers, in issue order) and what their money settled, in the accepted version's currency. */
  readonly payment: {
    readonly invoiceNumbers: readonly string[];
    readonly amountPaidMinor: number;
    readonly currency: Currency;
  };
  readonly schedule1: {
    readonly deliverables: string;
    readonly location: string;
    readonly deliveredDates: string;
  };
  readonly schedule2: { readonly tools: string; readonly thirdParty: string };
};

/** A billing address as the deed prints it on one line. `countryName` turns a country code into its name (the caller's `Intl`; default: the code). */
export type DeedAddress = {
  readonly line1: string;
  readonly line2?: string | undefined;
  readonly city: string;
  readonly state?: string | undefined;
  readonly postalCode?: string | undefined;
  readonly country: string;
};

const nonBlank = (s: string | null | undefined): s is string => typeof s === "string" && s.trim() !== "";

/** A multi-line text (the principal place as typed in Settings) on one line: each non-blank line trimmed, trailing commas dropped, joined with ", "; null when empty. */
export function deedOneLine(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const parts = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim().replace(/,+$/, "").trim())
    .filter((l) => l !== "");
  return parts.length > 0 ? parts.join(", ") : null;
}

export function deedAddressLine(
  a: DeedAddress | null,
  countryName: (code: string) => string = (c) => c,
): string | null {
  if (!a) return null;
  const parts = [
    a.line1,
    a.line2,
    a.city,
    a.state,
    a.postalCode,
    nonBlank(a.country) ? countryName(a.country) : null,
  ].filter(nonBlank);
  return parts.length > 0 ? parts.map((p) => p.trim()).join(", ") : null;
}

/** What `deedSnapshotOf` needs; the route reads each from its row. */
export type DeedInputs = {
  /** ISO date (IST) of finalising (or of today, for a draft's preview). */
  readonly madeOn: string;
  /**
   * Settings › Company: `principalPlace` (lead, 2026-11-01, triage 4: `{supplier_address}` is the GST principal place of business, the address registered
   * against the GSTIN printed beside it) and the GSTIN.
   */
  readonly company: { readonly principalPlace: string | null; readonly gstin: string | null };
  readonly client: {
    readonly legalName: string;
    readonly address: DeedAddress | null;
    readonly gstin: string | null;
  };
  readonly countryName?: (code: string) => string;
  readonly offer: {
    readonly type: string;
    readonly numberDisplay: string | null;
    readonly version: number;
    /** UTC ms the version was accepted (`decided_at`). */
    readonly decidedAt: number | null;
    readonly currency: string;
  };
  /** The project's documents (live payables are picked here, in the accepted currency). */
  readonly documents: readonly (DeedDocFact & { readonly numberDisplay: string | null })[];
  readonly schedules: DeedSchedules;
};

export type DeedValueProblem =
  | "company_principal_place_missing"
  | "company_gstin_missing"
  | "offer_unreadable"
  | "schedules_blank"
  | "made_on_invalid";

export type DeedSnapshotResult =
  | { readonly ok: true; readonly snapshot: DeedSnapshot }
  | {
      readonly ok: false;
      readonly problems: readonly DeedValueProblem[];
      readonly blankFields: readonly DeedScheduleField[];
    };

/**
 * L6: every value of the deed. Refused (never guessed) when the principal place or the GSTIN is missing from Settings › Company (07-ZE prints "GSTIN {gstin}"
 * unconditionally), when the accepted version has no number, type or decision day, or when a Schedule field is blank.
 */
export function deedSnapshotOf(i: DeedInputs): DeedSnapshotResult {
  const problems: DeedValueProblem[] = [];
  const supplierAddress = deedOneLine(i.company.principalPlace);
  if (supplierAddress === null) problems.push("company_principal_place_missing");
  if (!nonBlank(i.company.gstin)) problems.push("company_gstin_missing");
  const docType = i.offer.type === "proposal" || i.offer.type === "estimate" ? i.offer.type : null;
  if (
    docType === null ||
    !nonBlank(i.offer.numberDisplay) ||
    i.offer.decidedAt === null ||
    !isCurrency(i.offer.currency)
  )
    problems.push("offer_unreadable");
  const blank = blankSchedules(i.schedules);
  if (blank.length > 0) problems.push("schedules_blank");
  if (parseIsoDate(i.madeOn) === null) problems.push("made_on_invalid");
  if (problems.length > 0) return { ok: false, problems, blankFields: blank };
  const live = i.documents.filter((d) => isLivePayable(d) && d.currency === i.offer.currency);
  let paid = 0n;
  for (const d of live) paid += BigInt(settledOf(d));
  const numbers = live
    .map((d) => d.numberDisplay)
    .filter(nonBlank)
    .sort(compareDocNumbers);
  const s = i.schedules;
  return {
    ok: true,
    snapshot: {
      layout: DEED_LAYOUT_ID,
      madeOn: i.madeOn,
      supplier: { address: supplierAddress as string, gstin: (i.company.gstin as string).trim() },
      client: {
        legalName: i.client.legalName.trim(),
        address: deedAddressLine(i.client.address, i.countryName),
        reg: nonBlank(i.client.gstin) ? i.client.gstin.trim() : null,
      },
      offer: {
        docType: docType as "proposal" | "estimate",
        number: i.offer.numberDisplay as string,
        version: i.offer.version,
        acceptedOn: isoOf(istDate(i.offer.decidedAt as number)),
      },
      payment: {
        invoiceNumbers: numbers,
        amountPaidMinor: Number(paid),
        currency: i.offer.currency as Currency,
      },
      schedule1: {
        deliverables: (s.deliverables as string).trim(),
        location: (s.location as string).trim(),
        deliveredDates: (s.deliveredDates as string).trim(),
      },
      schedule2: { tools: (s.tools as string).trim(), thirdParty: (s.thirdParty as string).trim() },
    },
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const isoOf = (d: CalendarDate) => `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`;

/** The canonical text of a snapshot (sorted keys) and its SHA-256: what the finalise seals and the jobs Worker checks before rendering. */
export const deedSnapshotJson = (s: DeedSnapshot): string => canonicalJson(s);
export const deedSnapshotSha256 = (s: DeedSnapshot): Promise<string> => sha256Hex(deedSnapshotJson(s));

/** A stored snapshot read back (null when the text is not a deed snapshot of a known layout: the reader refuses it, never guesses). */
export function parseDeedSnapshot(text: string | null): DeedSnapshot | null {
  if (text === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isObj(v) ||
    v.layout !== DEED_LAYOUT_ID ||
    typeof v.madeOn !== "string" ||
    parseIsoDate(v.madeOn) === null
  )
    return null;
  const { supplier, client, offer, payment, schedule1, schedule2 } = v;
  if (!isObj(supplier) || !isStr(supplier.address) || !isStr(supplier.gstin)) return null;
  if (!isObj(client) || !isStr(client.legalName) || !isStrOrNull(client.address) || !isStrOrNull(client.reg))
    return null;
  if (
    !isObj(offer) ||
    (offer.docType !== "proposal" && offer.docType !== "estimate") ||
    !isStr(offer.number) ||
    !Number.isSafeInteger(offer.version) ||
    !isStr(offer.acceptedOn) ||
    parseIsoDate(offer.acceptedOn) === null
  )
    return null;
  if (
    !isObj(payment) ||
    !Array.isArray(payment.invoiceNumbers) ||
    !payment.invoiceNumbers.every(isStr) ||
    !Number.isSafeInteger(payment.amountPaidMinor) ||
    !isCurrency(payment.currency)
  )
    return null;
  if (
    !isObj(schedule1) ||
    !isStr(schedule1.deliverables) ||
    !isStr(schedule1.location) ||
    !isStr(schedule1.deliveredDates)
  )
    return null;
  if (!isObj(schedule2) || !isStr(schedule2.tools) || !isStr(schedule2.thirdParty)) return null;
  return v as unknown as DeedSnapshot;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/** A run of text, bold or not (07-ZE marks the names and the clause headings in bold). */
export type DeedRun = { readonly text: string; readonly bold?: true };

export type DeedClause = { readonly n: number; readonly heading: string; readonly body: string };

/** The deed's text, filled: what the PDF layout and the screens print, word for word from 07-ZE (the approved lines win over this code). */
export type DeedText = {
  readonly title: string;
  readonly parties: readonly DeedRun[];
  readonly clauses: readonly DeedClause[];
  /**
   * L5: the signature sentence up to "TecHaust Technologies"; the unsigned PDF prints it and leaves the signature space empty (the eSign provider's own signature
   * appearance carries the time and transaction inside the signed PDF). Screens add `{esign_timestamp_ist} · {esign_transaction_id}` with `deedSignatureLine`.
   */
  readonly signatureLead: string;
  readonly schedule1: {
    readonly heading: string;
    readonly deliverables: string;
    readonly location: string;
    readonly deliveredDates: string;
  };
  readonly schedule2: { readonly heading: string; readonly tools: string; readonly thirdParty: string };
  readonly footer: string;
};

/**
 * The stamp-duty line (owner-approved, 2026-10-31; run file). OPEN (08-C RB-21): West Bengal stamp duty on a deed of assignment of copyright: the Indian Stamp Act
 * as amended for West Bengal not read; the deed is not stamped at signing.
 */
export const DEED_STAMP_NOTE =
  "Not stamped at signing. Any stamp duty due will be paid before this deed is produced as evidence.";

/** 07-ZE line 17: the assignor (a proprietorship is not a legal person); fixed wording. */
const ASSIGNOR = "Rupak Sarkar";

/** L5: 07-ZE's signature sentence up to "TecHaust Technologies" (the unsigned PDF prints it; screens add the eSign moment and transaction). */
export const DEED_SIGNATURE_LEAD =
  "Signed by the assignor with an Aadhaar-based electronic signature (eSign): Rupak Sarkar, sole proprietor, TecHaust Technologies";

/** The amount as the deed prints it: core money format, en-IN for INR, en-US for USD (L6). */
export const deedAmount = (minor: number, currency: Currency): string =>
  formatMoney({ amount: minor, currency });

const longDate = (iso: string): string => {
  const d = parseIsoDate(iso);
  if (!d) throw new RangeError(`not an ISO date: ${iso}`);
  return formatDate(d);
};

/**
 * 07-ZE "The deed's text", filled from the snapshot and the number. Tags, from 07-ZE's own: parties and clause 1: Researched 2026-10-31, Copyright Act s.19(1)
 * and (2) (08-C RB-38(a)); clause 2: s.19(3); clause 3: OPEN (08-C RB-38(a)): the s.18(1) proviso on media not yet in use was not read; clause 4: s.19(4) to (6);
 * clause 6: OPEN (08-C RB-38(a)): whether the promise not to use section 57 can be enforced; the signature: OPEN (08-C RB-38(a)): IT Act ss.3A and 5 and the
 * Second Schedule's Aadhaar e-KYC entry read in secondary sources only; the footer: OPEN (08-C RB-21). The deed never claims a lawyer reviewed it (07-ZE line 20).
 */
export function deedText(s: DeedSnapshot, deedNumber: string): DeedText {
  const t = s.offer.docType;
  const reg = s.client.reg === null ? "" : `, GSTIN/registration ${s.client.reg}`;
  const clientAddress = s.client.address === null ? "" : `, ${s.client.address}`;
  const invoices = s.payment.invoiceNumbers.join(", ");
  return {
    title: `Deed of assignment of copyright · No. ${deedNumber}`,
    parties: [
      { text: `This deed is made on ${longDate(s.madeOn)} at Balurghat, West Bengal, India, by ` },
      { text: ASSIGNOR, bold: true },
      {
        text: `, sole proprietor, trading as TecHaust Technologies, ${s.supplier.address}, GSTIN ${s.supplier.gstin} (the `,
      },
      { text: "assignor", bold: true },
      { text: "), in favour of " },
      { text: s.client.legalName, bold: true },
      { text: `${clientAddress}${reg} (the ` },
      { text: "assignee", bold: true },
      { text: ")." },
    ],
    clauses: [
      {
        n: 1,
        heading: "The work.",
        body: `The software, designs and documentation the assignor made for the assignee under ${t} ${s.offer.number} v${s.offer.version}, accepted on ${longDate(s.offer.acceptedOn)}, and listed in Schedule 1.`,
      },
      {
        n: 2,
        heading: "Price.",
        body: `The assignee has paid in full the fees under that ${t} (${invoices}, total ${deedAmount(s.payment.amountPaidMinor, s.payment.currency)}). The assignor acknowledges receipt. No royalty or other sum is payable for this assignment.`,
      },
      {
        n: 3,
        heading: "What is assigned.",
        body: "The assignor assigns to the assignee, wholly, all copyright in the work: every right under section 14 of the Copyright Act, 1957, in every medium and mode of exploitation, including those not yet existing or in commercial use.",
      },
      {
        n: 4,
        heading: "Territory and duration.",
        body: "Worldwide, for the full term of copyright. Section 19(4) does not apply: the assignment does not lapse if the assignee does not use the rights.",
      },
      {
        n: 5,
        heading: "Not assigned.",
        body: "The assignor's pre-existing tools and the third-party or open-source parts listed in Schedule 2. The assignor grants the assignee a non-exclusive, perpetual, worldwide, royalty-free licence to use, copy and change those pre-existing tools as part of the work. Open-source parts stay under their own licences. The assignor keeps general know-how.",
      },
      {
        n: 6,
        heading: "Author's rights.",
        body: "Under section 57 the author keeps the right to be named as the author. The author agrees not to use section 57 to object to changes, adaptations or uses of the work that the assignee makes for its own purposes.",
      },
      {
        n: 7,
        heading: "Ownership.",
        body: `The assignor confirms that it owns the copyright assigned here. This deed gives no other warranty and asks nothing further of the assignee; the warranty in the ${t} is unchanged.`,
      },
      {
        n: 8,
        heading: "Law.",
        body: `Indian law governs this deed; disputes follow item 10 of the terms of the ${t}.`,
      },
    ],
    signatureLead: DEED_SIGNATURE_LEAD,
    schedule1: {
      heading: "Schedule 1, the work",
      deliverables: s.schedule1.deliverables,
      location: s.schedule1.location,
      deliveredDates: s.schedule1.deliveredDates,
    },
    schedule2: {
      heading: "Schedule 2, not assigned",
      tools: s.schedule2.tools,
      thirdParty: s.schedule2.thirdParty,
    },
    footer: `Stamp duty: ${DEED_STAMP_NOTE}`,
  };
}

/** L5: the signature sentence with the stored eSign details, as the admin and portal show it next to the signed copy (07-ZE: "… · {timestamp} · {id}."). */
export const deedSignatureLine = (lead: string, esignAtUtcMs: number, esignTxn: string): string =>
  `${lead} · ${esignMomentIst(esignAtUtcMs)} · ${esignTxn}.`;

/** The eSign moment as the screens print it: "01 Nov 2026, 14:05 IST". */
export const esignMomentIst = (utcMs: number): string => formatIstDateTime(utcMs);

/**
 * The eSign timestamp the Owner types, as the provider shows it in IST ("2026-11-01T14:05" or with ":ss"), to UTC ms; null when it is not a real moment.
 * Refused when it is later than `nowUtcMs` (a signature cannot be in the future) or before the deed was finalised (`notBeforeUtcMs`).
 */
export function parseEsignMoment(
  text: string,
  bounds: { nowUtcMs: number; notBeforeUtcMs: number },
): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!m) return null;
  const date = parseIsoDate(`${m[1]}-${m[2]}-${m[3]}`);
  const [h, mi, se] = [Number(m[4]), Number(m[5]), Number(m[6] ?? "0")];
  if (!date || h > 23 || mi > 59 || se > 59) return null;
  const utc = fromIst(date, h, mi, se);
  // A minute of slack before the finalise: the provider's clock and ours round differently.
  if (utc > bounds.nowUtcMs || utc < bounds.notBeforeUtcMs - 60_000) return null;
  return utc;
}

/**
 * The R2 keys of a deed's PDFs in the private `DOCS` bucket (write-once). The unsigned PDF's key carries the sealed snapshot's SHA-256, so two renders of the
 * same deed land on the same object (the second adopts the first) and a key never names other values; the signed copy's key carries its own SHA-256.
 */
export const deedUnsignedKey = (deedId: string, snapshotSha256: string): string =>
  `deeds/${deedId}/unsigned-${snapshotSha256}.pdf`;
export const deedSignedKey = (deedId: string, sha256: string): string =>
  `deeds/${deedId}/signed-${sha256}.pdf`;
