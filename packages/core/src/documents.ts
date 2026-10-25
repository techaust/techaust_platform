// Proposals and estimates, pure (M4.3; ADM-PROP-01..07, ADM-EST-01, ADM-APR-01/02, docs/04 §5.11, §5.12, §5.15). No I/O, no zod, no floats.
// One code path serves both types. VERIFY WITH CA/LEGAL: the discount threshold is the owner's commercial rule (Q-P3-2); what a sent
// proposal means as evidence of an offer, and the validity rule, are the lead's and the CA's to confirm (run file, VERIFY items 1 to 12).
//
//   - sections (the caps and the three that are always present),
//   - the status flow (the twin of the `documents_status_flow` trigger),
//   - the discount guard (rule A: only lines from the catalogue count, on both sides),
//   - the content hash (an approval is tied to it) and the frozen snapshot (M4.4 and M4.5 rebuild and verify it),
//   - the validity date.
// Error and warning codes only; the words are the screens'.
import type { CalendarDate } from "./dates.ts";
import { addDays, toIsoDate } from "./dates.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import { divRoundHalfUp } from "./money.ts";
import { SELF_SEND_DISCOUNT_BPS } from "./permissions.ts";
import type { ScheduleTrigger } from "./schedule-text.ts";
import type { ComputedDocument } from "./tax/types.ts";

export const QUOTE_TYPES = ["proposal", "estimate"] as const;
export type QuoteType = (typeof QUOTE_TYPES)[number];
export const isQuoteType = (v: unknown): v is QuoteType => v === "proposal" || v === "estimate";

// ---- sections (ADM-PROP-02; lead decision 12) ---------------------------------------------------------------------------------

export const SECTION_KINDS = [
  "cover",
  "summary",
  "problem_goals",
  "scope",
  "deliverables",
  "timeline",
  "team",
  "how_we_work",
  "estimate",
  "assumptions_exclusions",
  "terms",
  "acceptance",
  "custom",
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** Always present, exactly once, never hidden (they can be moved). */
export const REQUIRED_SECTIONS = ["estimate", "terms", "acceptance"] as const;
export const MAX_SECTIONS = 16;
export const MAX_CUSTOM_SECTIONS = 3;
export const SECTION_BODY_MAX = 6_000;
export const SECTIONS_TOTAL_MAX = 30_000;
export const SECTION_TITLE_MAX = 120;
/** The caps on the text fields of a document. */
export const TITLE_MAX = 200;
export const LINE_DETAIL_MAX = 300;
export const SCHEDULE_DETAIL_MAX = 300;
export const VALIDITY_DAYS_MAX = 90;

export type SectionDraft = {
  readonly kind: string;
  readonly title: string | null;
  readonly bodyMd: string | null;
  readonly hidden: boolean;
};

export type SectionIssue =
  | "too_many_sections"
  | "section_kind_invalid"
  | "section_duplicate"
  | "custom_limit"
  | "required_missing"
  | "required_hidden"
  | "section_title_too_long"
  | "section_too_long"
  | "sections_too_long";

const KINDS: readonly string[] = SECTION_KINDS;

/** Every rule on a document's sections, as the distinct codes that fail (empty = fine). */
export function checkSections(sections: readonly SectionDraft[]): SectionIssue[] {
  const out = new Set<SectionIssue>();
  if (sections.length > MAX_SECTIONS) out.add("too_many_sections");
  const seen = new Set<string>();
  let custom = 0;
  let total = 0;
  for (const s of sections) {
    if (!KINDS.includes(s.kind)) out.add("section_kind_invalid");
    if (s.kind === "custom") custom++;
    else if (seen.has(s.kind)) out.add("section_duplicate");
    seen.add(s.kind);
    if ((REQUIRED_SECTIONS as readonly string[]).includes(s.kind) && s.hidden) out.add("required_hidden");
    if ((s.title?.length ?? 0) > SECTION_TITLE_MAX) out.add("section_title_too_long");
    const body = s.bodyMd?.length ?? 0;
    if (body > SECTION_BODY_MAX) out.add("section_too_long");
    total += body;
  }
  if (custom > MAX_CUSTOM_SECTIONS) out.add("custom_limit");
  if (total > SECTIONS_TOTAL_MAX) out.add("sections_too_long");
  for (const r of REQUIRED_SECTIONS) if (!seen.has(r)) out.add("required_missing");
  return [...out];
}

/** The titles the three always-present sections get when a template lacks them (the section names of ADM-PROP-02). */
export const REQUIRED_TITLES: Record<(typeof REQUIRED_SECTIONS)[number], string> = {
  estimate: "Estimate",
  terms: "Terms",
  acceptance: "Acceptance",
};

/**
 * Sections for a new draft from a rendered template: a section whose key is a section kind (and not used yet) keeps it; any other
 * (the estimate template's "schedule", say) becomes a custom section. More custom sections than the cap are not dropped: their text
 * is added to the last custom section under its heading. A missing estimate, terms or acceptance section is added at the end.
 */
export function sectionsFromTemplate(
  rendered: readonly { key: string; heading: string; text: string }[],
): SectionDraft[] {
  const out: { kind: string; title: string | null; bodyMd: string | null; hidden: boolean }[] = [];
  const used = new Set<string>();
  for (const r of rendered) {
    const body = r.text.trim() === "" ? null : r.text;
    const known = KINDS.includes(r.key) && r.key !== "custom" && !used.has(r.key);
    if (known) {
      used.add(r.key);
      out.push({ kind: r.key, title: r.heading, bodyMd: body, hidden: false });
      continue;
    }
    const customs = out.filter((s) => s.kind === "custom");
    const last = customs.at(-1);
    if (customs.length >= MAX_CUSTOM_SECTIONS && last) {
      const extra = `**${r.heading}**${body ? `\n${body}` : ""}`;
      last.bodyMd = last.bodyMd ? `${last.bodyMd}\n\n${extra}` : extra;
    } else {
      out.push({ kind: "custom", title: r.heading, bodyMd: body, hidden: false });
    }
  }
  for (const k of REQUIRED_SECTIONS) {
    if (!used.has(k)) out.push({ kind: k, title: REQUIRED_TITLES[k], bodyMd: null, hidden: false });
  }
  return out;
}

// ---- the status flow (twin of the `documents_status_flow` trigger) -----------------------------------------------------------

/**
 * The moves a proposal or estimate can make. `pending_approval` is not a status: a document waiting for the owner is still a draft,
 * and "pending approval" is shown from the approvals row (owner, 2026-10-07). `revised` is set when a later version is sent.
 */
export const DOC_STATUS_FLOW: Readonly<Record<string, readonly string[]>> = {
  draft: ["sent"],
  sent: ["viewed", "accepted", "rejected", "expired", "revised"],
  viewed: ["accepted", "rejected", "expired", "revised"],
};

export const canMoveStatus = (from: string, to: string): boolean =>
  Object.hasOwn(DOC_STATUS_FLOW, from) && (DOC_STATUS_FLOW[from] as readonly string[]).includes(to);

/** Statuses a client can still accept in (the owner's rule: a sent version stays acceptable until the next version is sent). */
export const ACCEPTABLE_STATUSES = ["sent", "viewed"] as const;

// ---- the discount guard (ADM-PROP-04; owner O-Q1 and O-Q2, rule A) ---------------------------------------------------------

/** What the guard needs of a line: the catalogue reference is server-side (copied when the line was added), never from a request. */
export type GuardLine = {
  readonly catalogueItemId: string | null;
  readonly catalogueRateMinor: number | null;
  readonly qtyMilli: number;
};

export type GuardResult = {
  /** Σ over the catalogue lines of quantity × catalogue rate (half up). */
  readonly referenceMinor: number;
  /** Σ over the same lines of the taxable value after the line discount and the line's share of the document discount. */
  readonly taxableMinor: number;
  /** max(0, reference − taxable): a premium on one line offsets a discount on another (the owner's "totals" rule). */
  readonly discountMinor: number;
  /** The discount in basis points of the reference, rounded UP: 10.001 % reads 1001, so no one can slip under the threshold. */
  readonly discountBp: number;
  /** More than 10 % (the core constant `SELF_SEND_DISCOUNT_BPS`): Staff and Sales need the owner's approval for this version. */
  readonly needsApproval: boolean;
};

/**
 * The discount against the catalogue. Rule A: only lines that came from the catalogue (`catalogueItemId`) count, on both sides;
 * custom lines and pass-through costs neither offset nor trigger a discount. bigint throughout. `lines[i]` pairs with
 * `computed.lines[i]`. A commercial rule, not a tax rule: the threshold is the owner's (Q-P3-2).
 */
export function catalogueGuard(lines: readonly GuardLine[], computed: ComputedDocument): GuardResult {
  let reference = 0n;
  let taxable = 0n;
  lines.forEach((l, i) => {
    const c = computed.lines[i];
    if (l.catalogueItemId === null || l.catalogueRateMinor === null || c === undefined) return;
    reference += divRoundHalfUp(BigInt(l.qtyMilli) * BigInt(l.catalogueRateMinor), 1000n);
    taxable += BigInt(c.taxableMinor);
  });
  const discount = reference > taxable ? reference - taxable : 0n;
  const bp = reference === 0n ? 0n : (10_000n * discount + reference - 1n) / reference;
  return {
    referenceMinor: Number(reference),
    taxableMinor: Number(taxable),
    discountMinor: Number(discount),
    discountBp: Number(bp),
    needsApproval: 10_000n * discount > BigInt(SELF_SEND_DISCOUNT_BPS) * reference,
  };
}

// ---- the content hash (lead decision 4) ---------------------------------------------------------------------------------------

export type DraftLine = {
  readonly catalogueItemId: string | null;
  readonly description: string;
  readonly detail: string | null;
  readonly sac: string | null;
  readonly qtyMilli: number;
  readonly unit: string;
  readonly rateMinor: number;
  readonly discountKind: string | null;
  readonly discountValue: number | null;
  readonly gstRateBp: number;
  readonly catalogueRateMinor: number | null;
};

export type DraftScheduleStep = {
  readonly label: string;
  readonly trigger: ScheduleTrigger;
  readonly pctBp: number;
  readonly detail: string | null;
  readonly targetDate: string | null;
};

/** Everything a person edits in a draft, in order. Ids (the document's, a line's, a section's) are not part of it. */
export type DraftContent = {
  readonly type: QuoteType;
  readonly clientId: string;
  readonly contactId: string | null;
  readonly title: string | null;
  readonly currency: string;
  readonly validityDays: number | null;
  readonly termsVersionId: string | null;
  readonly discountKind: string | null;
  readonly discountValue: number | null;
  readonly exportMode: string | null;
  readonly lines: readonly DraftLine[];
  readonly sections: readonly SectionDraft[];
  readonly schedule: readonly DraftScheduleStep[];
};

/**
 * The canonical object that is hashed: the document fields, lines, sections and schedule in their order; the supply type and place
 * of supply; and every total (the document's and each line's taxable value, tax heads and total). A different tax setting that moves
 * a total therefore changes the hash too. Ids are left out, so a copy of the content hashes the same.
 */
export function contentHashInput(draft: DraftContent, computed: ComputedDocument | null) {
  return {
    v: 1,
    document: {
      type: draft.type,
      clientId: draft.clientId,
      contactId: draft.contactId,
      title: draft.title,
      currency: draft.currency,
      validityDays: draft.validityDays,
      termsVersionId: draft.termsVersionId,
      discountKind: draft.discountKind,
      discountValue: draft.discountValue,
      exportMode: draft.exportMode,
    },
    lines: draft.lines,
    sections: draft.sections,
    schedule: draft.schedule,
    supply: computed ? computed.supply : null,
    totals: computed
      ? [
          computed.subtotalMinor,
          computed.discountMinor,
          computed.taxableMinor,
          computed.cgstMinor,
          computed.sgstMinor,
          computed.igstMinor,
          computed.roundOffMinor,
          computed.totalMinor,
        ]
      : null,
    lineTotals: computed
      ? computed.lines.map((l) => [l.taxableMinor, l.cgstMinor, l.sgstMinor, l.igstMinor, l.lineTotalMinor])
      : null,
  };
}

/** The hex SHA-256 of `contentHashInput`. */
export const contentHash = (draft: DraftContent, computed: ComputedDocument | null): Promise<string> =>
  sha256Hex(canonicalJson(contentHashInput(draft, computed)));

// ---- validity (VERIFY WITH CA/LEGAL item 5) -----------------------------------------------------------------------------------

/**
 * The last day an offer can be accepted, as a date string: the IST date it was sent plus its validity in days, inclusive (an offer
 * sent on the 1st with 15 days is acceptable through the 16th; it expires when the IST date passes it).
 */
export function validUntil(sentIstDate: CalendarDate, validityDays: number): string {
  if (!Number.isSafeInteger(validityDays) || validityDays < 1 || validityDays > VALIDITY_DAYS_MAX) {
    throw new RangeError(`Validity must be 1 to ${VALIDITY_DAYS_MAX} days: ${validityDays}`);
  }
  return toIsoDate(addDays(sentIstDate, validityDays));
}

// ---- unresolved placeholders (ADM-CAT-03) -------------------------------------------------------------------------------------

/** M4.1's placeholder pattern (`{{ name.part }}`), kept in step with `placeholdersOf` in catalogue.ts by a test. */
export const UNRESOLVED_RE = /\{\{\s*([a-z_]+(?:\.[a-z_]+)*)\s*\}\}/g;

/** The distinct placeholder names still in these texts (a document with any cannot be sent). */
export function unresolvedIn(texts: readonly (string | null | undefined)[]): string[] {
  const names = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(UNRESOLVED_RE)) names.add(m[1] as string);
  }
  return [...names];
}

// ---- the frozen snapshot (lead decision; M4.4 and M4.5 rebuild and verify it) -------------------------------------------------

export type SnapshotInput = {
  readonly document: {
    readonly type: QuoteType;
    readonly clientId: string;
    readonly versionGroupId: string;
    readonly version: number;
    readonly currency: string;
    readonly title: string | null;
    readonly issueDate: string;
    readonly validUntil: string;
    readonly validityDays: number;
    readonly contentSha256: string;
    readonly discountKind: string | null;
    readonly discountValue: number | null;
    readonly exportMode: string | null;
    readonly supplyType: string;
    readonly placeOfSupplyCode: string;
  };
  readonly recipient: unknown;
  readonly issuer: unknown;
  readonly computed: ComputedDocument;
  readonly lines: readonly DraftLine[];
  readonly sections: readonly SectionDraft[];
  readonly schedule: readonly (DraftScheduleStep & { readonly amountMinor: number })[];
  /** The terms version the offer rests on: its id, version and the SHA-256 of its text. */
  readonly terms: { readonly id: string; readonly version: number; readonly sha256: string };
};

/**
 * The canonical frozen content of a sent version. It holds what the client agreed to and who it is between, and NOT the number, the
 * series, the FY or the instants of the send (those are taken inside the send batch, after this is hashed; the number is in the
 * PDF, M4.4, whose SHA-256 is the acceptance evidence). `snapshot_sha256 = sha256Hex(canonicalJson(snapshot))`.
 */
export function documentSnapshot(i: SnapshotInput) {
  return {
    v: 1,
    document: i.document,
    recipient: i.recipient,
    issuer: i.issuer,
    computed: i.computed,
    lines: i.lines,
    sections: i.sections,
    schedule: i.schedule,
    terms: i.terms,
  };
}

/** The hex SHA-256 stored as `documents.snapshot_sha256`. */
export const snapshotSha256 = (i: SnapshotInput): Promise<string> =>
  sha256Hex(canonicalJson(documentSnapshot(i)));

// ---- approvals (ADM-APR-01/02) -------------------------------------------------------------------------------------------------

export type ApprovalState = "none" | "pending" | "approved" | "rejected" | "expired";

/**
 * What the editor shows about the discount approval of a draft, from the newest approval row for its kind: an approved or pending
 * request counts only while it was made for the draft's current content (the hash); otherwise it has expired (and, in the database,
 * is set to expired the next time the draft is saved or the owner opens it). `expired` and `rejected` never revive.
 */
export function approvalState(
  latest: { readonly status: string; readonly contentSha256: string } | null,
  currentContentSha256: string | null,
): ApprovalState {
  if (!latest) return "none";
  if (latest.status === "rejected") return "rejected";
  if (latest.status === "expired") return "expired";
  if (latest.status === "pending" || latest.status === "approved") {
    if (latest.contentSha256 !== currentContentSha256) return "expired";
    return latest.status;
  }
  return "none";
}
