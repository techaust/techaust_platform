// What the portal's proposal and estimate screens show (M4.5; POR-04, POR-05, ADM-PROP-05..10), as one view model.
// DESIGN PROPOSAL (preview): the M4.5 build's API returns the frozen snapshot of the latest sent version in this shape
// (the builder owns the exact fields). Every amount is minor units and every figure comes pre-computed by the M4.2 tax
// engine on the server; the screens only format (`formatMoney`, `formatDate`, `formatIstDateTime` from @techaust/core),
// they never add anything up.
import { type CalendarDate, type Currency, formatMoney, money } from "@techaust/core";
import type { ComputedDocument, ScheduleInstalment } from "@techaust/core/tax";

export type DocKind = "proposal" | "estimate";

/** The six states a client sees (docs/06 §5.5; "Declined" is the PRD's "Rejected", worded for the client). */
export type DocStatus = "sent" | "viewed" | "accepted" | "declined" | "expired" | "revised";

/** One line's words; its figures are `computed.lines[index]`. */
export type LineText = {
  description: string;
  /** A second line under the description (what the line covers). */
  detail?: string | undefined;
  /** "1", "2", "1.5": the snapshot's quantity as written at issue. */
  qty: string;
  unit: string;
  rateMinor: number;
};

export type Milestone = { name: string; what: string; target: CalendarDate; pctBp: number };

export type Acceptance = {
  name: string;
  email: string;
  atMs: number;
  /** The first 12 hex characters of the SHA-256 of the accepted version's PDF (docs/06 §7.1 integrity line). */
  fingerprint: string;
};

export type Decline = { name: string; atMs: number; reason: string; note: string | null };

export type DocumentView = {
  id: string;
  kind: DocKind;
  title: string;
  number: string;
  version: number;
  status: DocStatus;
  currency: Currency;
  client: {
    name: string;
    addressLines: string[];
    /** Shown as it is on the document; null for an unregistered or overseas client. */
    gstin: string | null;
    placeOfSupply: string;
  };
  contact: { name: string; email: string };
  sentOn: CalendarDate;
  validUntil: CalendarDate;
  summary: { outcome: string; timeline: string };
  goals: { intro: string; points: string[] };
  scope: { inScope: string[]; outOfScope: string[] };
  deliverables: string[];
  milestones: Milestone[];
  assumptions: string[];
  terms: { version: string; paragraphs: string[] };
  lines: LineText[];
  computed: ComputedDocument;
  schedule: ScheduleInstalment[];
  documentId: string;
  fingerprint: string;
  acceptance: Acceptance | null;
  decline: Decline | null;
  /** The client opened an older version's link: which version it was, and when the newer one was sent. */
  replaced: { version: number; on: CalendarDate } | null;
};

/** Money for display, always through @techaust/core (lakh grouping for INR, a true minus sign). */
export const amount = (minor: number, currency: Currency) => formatMoney(money(minor, currency));
