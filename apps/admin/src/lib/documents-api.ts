// The typed client for the proposals and estimates API (M4.3; apps/admin/worker/documents.ts, document-save.ts, document-send.ts,
// document-convert.ts, approvals.ts). Its own module, so the main chunk does not carry it: only the M4.3 screens import it.
// The shapes mirror the worker's answers (`DocumentView`, `SaveAnswer`, the list rows, the approvals queue). Money is integer minor
// units in the document's currency; the screens only format it (through core), never work it out.
import type { ScheduleTrigger } from "@techaust/core";
import type { Currency } from "../api.ts";
import { qs, request } from "../api.ts";
import type { OfferSection, StartResult } from "./offers.ts";

export type QuoteType = "proposal" | "estimate";
export type QuoteStatus = "draft" | "sent" | "viewed" | "accepted" | "rejected" | "expired" | "revised";
export type ApprovalState = "none" | "pending" | "approved" | "rejected" | "expired";
export type DiscountKind = "fixed" | "percent";
export type Discount = { kind: DiscountKind; value: number };
export type Issue = { code: string; path: readonly (string | number)[] };
export type Blocker = {
  code: string;
  names?: string[];
  codes?: string[];
  issues?: Issue[];
  /** `section_empty`: the visible optional sections with no text, as ids in order; `kinds` is the same list by kind (the names the Worker sends). */
  sections?: string[];
  kinds?: string[];
};

/** What a sent version was addressed to, as frozen at send (review fix 1; the db's `RecipientSnapshot`). */
export type RecipientView = {
  legalName: string;
  displayName?: string | null;
  gstin?: string | null;
  stateCode?: string;
  email?: string | null;
  country: string;
  contactId?: string;
  contactName?: string | null;
  /** The client's address block as frozen (null once anonymised); the staff screens do not print it. */
  address?: unknown;
  /** True when the client, or the contact the offer was addressed to, was anonymised: the names, email, GSTIN and address are replaced (owner, 2026-10-26). */
  anonymised?: boolean;
};
/** Who sent it, as frozen at send (the db's `IssuerSnapshot`). */
export type IssuerView = {
  company: { tradeName: string; legalName: string | null; gstin: string | null; stateCode: string };
  sender: { staffId: string; name: string; email: string };
};

export type Totals = {
  subtotalMinor: number;
  discountMinor: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  roundOffMinor: number;
  totalMinor: number;
  words: string;
  totalInrMinor: number | null;
};
export type Supply = {
  type: "intra" | "inter" | "export_lut" | "export_igst";
  placeOfSupplyCode: string;
  supplierStateCode: string;
};
export type SummaryRow = {
  sac: string | null;
  gstRateBp: number;
  effectiveRateBp: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
};
export type Guard = {
  referenceMinor: number;
  taxableMinor: number;
  discountMinor: number;
  discountBp: number;
  needsApproval: boolean;
  customLines: { id?: string; position: number; description?: string; taxableMinor: number | null }[];
};
export type ApprovalInfo = {
  state: ApprovalState;
  id: string | null;
  requestedBy: string | null;
  requestedAt: number | null;
  decidedBy: string | null;
  decidedAt: number | null;
  note: string | null;
  /** The owner who decided (M4.3 designer: the names behind "Approved by {person}"). */
  decidedByName?: string | null;
  requestedByName?: string | null;
};
export type LineFigures = {
  taxableMinor: number | null;
  cgstMinor: number | null;
  sgstMinor: number | null;
  igstMinor: number | null;
  lineTotalMinor: number | null;
};
export type ViewLine = LineFigures & {
  id: string;
  position: number;
  catalogueItemId: string | null;
  catalogueRateMinor: number | null;
  catalogueLine: string | null;
  description: string;
  detail: string | null;
  sac: string | null;
  qtyMilli: number;
  unit: string;
  rateMinor: number;
  discount: Discount | null;
  gstRateBp: number;
};
export type ViewSection = {
  id: string;
  position: number;
  kind: string;
  hidden: boolean;
  title: string | null;
  bodyMd: string | null;
};
export type ViewStep = {
  id: string;
  position: number;
  label: string;
  trigger: ScheduleTrigger;
  pctBp: number;
  amountMinor: number | null;
  detail: string | null;
  targetDate: string | null;
};
export type VersionRow = {
  id: string;
  version: number;
  status: QuoteStatus;
  number: string | null;
  sentAt: number | null;
  validUntil: string | null;
  totalMinor: number;
  current: boolean;
};

/** GET /documents/:id (a draft worked out today; a sent version read back from what was frozen). */
/** A version as GET /documents/:id answers it: the M4.3 view, and for a sent offer what happened to it (M4.5). */
export type DocumentView = DocumentViewBase & OfferSection;

export type DocumentViewBase = {
  id: string;
  type: QuoteType;
  status: QuoteStatus;
  version: number;
  versionGroupId: string;
  number: string | null;
  title: string | null;
  currency: Currency;
  validityDays: number | null;
  validUntil: string | null;
  issueDate: string | null;
  sentAt: number | null;
  createdAt: number;
  updatedAt: number;
  contentSha256: string | null;
  frozen: boolean;
  client: {
    id: string;
    code: string;
    name: string;
    type: string;
    gstStatus: string;
    stateCode: string | null;
    country: string;
    currency: Currency;
    anonymised: boolean;
  };
  contact: { id: string; name: string; email: string; anonymised: boolean } | null;
  discount: Discount | null;
  exportMode: string | null;
  lines: ViewLine[];
  sections: ViewSection[];
  schedule: ViewStep[];
  totals: Totals | null;
  supply: Supply | null;
  summary: SummaryRow[] | null;
  guard: Guard | null;
  approval: ApprovalInfo;
  versions: VersionRow[];
  /** `bodyMd` is the pinned version's frozen text (the read loads it; a save answer leaves it out). */
  terms: { id: string; version: number; sha256: string; bodyMd?: string | null } | null;
  termsOutdated: boolean;
  /** The newest proposal terms' version (for "Newer terms (version n) exist"). */
  newestTermsVersion?: number | null;
  errors: Issue[];
  warnings: Issue[];
  blockers: Blocker[];
  unresolved: string[];
  canSend: boolean;
  needsResave: boolean;
  /** The client's "Attach PDF" setting (M4.5 review fix 2): what a send applies when it names none; readable by every role that can send. */
  attachPdfDefault: boolean;
  /** A frozen version: the recipient and issuer as frozen (drafts read the live client and contact). */
  recipient?: RecipientView | null;
  issuer?: IssuerView | null;
  /** An accepted estimate that was converted: what it became. */
  convertedTo?: { kind: "invoice" | "care_plan"; id: string } | null;
  /** The PDF of this version (M4.4): none for a draft, pending once sent until the jobs Worker has made it, then ready. */
  pdf?: PdfState;
};

export type PdfState = {
  state: "none" | "pending" | "ready";
  sha256: string | null;
  /** The first 12 hex characters of the PDF's SHA-256. */
  fingerprint: string | null;
};

/** What a PATCH answers: only what the server decided (figures, ids, guard, approval, blockers), never the text it was sent. */
export type SaveAnswer = {
  id: string;
  updatedAt: number;
  contentSha256: string | null;
  totals: Totals | null;
  supply: Supply | null;
  summary: SummaryRow[] | null;
  lines: (LineFigures & { id: string; position: number })[];
  sections: { id: string; position: number }[];
  schedule: { id: string; position: number; amountMinor: number | null }[];
  guard: Guard;
  approval: ApprovalInfo;
  terms: { id: string; version: number; sha256: string } | null;
  termsOutdated: boolean;
  /** The newest proposal terms' version (for "Newer terms (version n) exist"). */
  newestTermsVersion?: number | null;
  errors: Issue[];
  warnings: Issue[];
  blockers: Blocker[];
  unresolved: string[];
  canSend: boolean;
  needsResave: boolean;
};

export type LineIn = {
  id?: string;
  catalogueItemId?: string | null;
  defaultLine?: string;
  description: string;
  detail?: string | null;
  sac?: string | null;
  gstRateBp?: number;
  qtyMilli: number;
  unit: string;
  rateMinor?: number;
  discount?: Discount | null;
};
export type SectionIn = {
  id?: string;
  kind: string;
  title?: string | null;
  bodyMd?: string | null;
  hidden?: boolean;
};
export type StepIn = {
  id?: string;
  label: string;
  trigger: ScheduleTrigger;
  pctBp: number;
  detail?: string | null;
  targetDate?: string | null;
};
export type FieldsIn = {
  title?: string | null;
  contactId?: string | null;
  validityDays?: number;
  discount?: Discount | null;
  refreshTerms?: true;
};
export type DocumentPatch = {
  expectedUpdatedAt: number;
  fields?: FieldsIn;
  lines?: LineIn[];
  sections?: SectionIn[];
  schedule?: StepIn[];
};

export type ListRow = {
  id: string;
  type: QuoteType;
  version: number;
  status: QuoteStatus;
  title: string | null;
  number: string | null;
  clientId: string;
  clientCode: string;
  clientName: string;
  currency: Currency;
  taxableMinor: number;
  totalMinor: number;
  validUntil: string | null;
  createdAt: number;
  updatedAt: number;
  customLines: number;
  customTaxableMinor: number;
  approval: ApprovalState;
  /** A v2+ draft: the group's number (review fix 13), when the API sends it apart from `number`. */
  numberDisplay?: string | null;
};
export type ListQuery = {
  type?: QuoteType | undefined;
  status?: QuoteStatus | undefined;
  clientId?: string | undefined;
  limit?: "25" | "50" | undefined;
  after?: string | undefined;
};

export type ApprovalRow = {
  id: string;
  state: ApprovalState;
  createdAt: number;
  decidedAt: number | null;
  reason: string | null;
  note: string | null;
  requestedBy: string;
  requesterName: string | null;
  decidedBy: string | null;
  deciderName?: string | null;
  document: {
    id: string;
    type: QuoteType;
    title: string | null;
    version: number;
    status: QuoteStatus;
    currency: Currency;
    clientCode: string;
    clientName: string;
  };
  discountBp: number;
  discountMinor: number;
  referenceMinor: number;
  customLineCount: number;
  totalMinor?: number;
};

export type NewDocumentInput = {
  type: QuoteType;
  clientId: string;
  contactId?: string;
  leadId?: string;
  title?: string;
  services: { catalogueItemId: string; defaultLines?: string[] }[];
};
export type Created = { id: string; versionGroupId: string; updatedAt: number; contentSha256: string };
export type SentResult = {
  ok: true;
  id: string;
  number: string | null;
  version: number;
  status: "sent";
  validUntil: string | null;
  discountBp: number;
  updatedAt: number;
};
export type CareConvertInput = {
  startDate: string;
  billingDay: number;
  includedMinutes?: number;
};
export type CareConverted = {
  id: string;
  to: "care_plan";
  sourceDocumentId: string;
  tier: string;
  priceMinor: number;
  aiOpsMinor: number | null;
  includedMinutes: number;
  rollover: string;
  currency: Currency;
  updatedAt: number;
};

const enc = encodeURIComponent;

/** The acceptance certificate of an accepted offer: a same-origin download (the API answers an attachment). */
export const certificateHref = (id: string) => `/api/v1/documents/${enc(id)}/certificate`;

export const documentsApi = {
  list: (q: ListQuery = {}) => request<{ documents: ListRow[]; next: string | null }>(`/documents${qs(q)}`),
  clientList: (clientId: string, after?: string) =>
    request<{ documents: ListRow[]; next: string | null }>(
      `/clients/${enc(clientId)}/documents${qs({ after })}`,
    ),
  get: (id: string) => request<DocumentView>(`/documents/${enc(id)}`),
  create: (body: NewDocumentInput) => request<Created>("/documents", { body }),
  save: (id: string, body: DocumentPatch) =>
    request<SaveAnswer>(`/documents/${enc(id)}`, { method: "PATCH", body }),
  discard: (id: string, expectedUpdatedAt: number) =>
    request<{ ok: true }>(`/documents/${enc(id)}${qs({ expectedUpdatedAt: String(expectedUpdatedAt) })}`, {
      method: "DELETE",
    }),
  /** Asks the jobs Worker to make the PDF again (409 `pdf_done` once it exists). */
  retryPdf: (id: string) =>
    request<{ ok: true; pdf: { state: "pending" } }>(`/documents/${enc(id)}/pdf/retry`, { body: {} }),
  revise: (id: string) =>
    request<{ id: string; versionGroupId: string; version: number; updatedAt: number }>(
      `/documents/${enc(id)}/revise`,
      { body: {} },
    ),
  /**
   * Sends a draft (M4.3) to chosen contacts (M4.5, ADM-PROP-07): 1 to 5 contacts with portal access. `attachPdf` left out uses the
   * client's own setting (the server reads it).
   */
  send: (id: string, expectedUpdatedAt: number, contactIds: string[], attachPdf?: boolean) =>
    request<SentResult>(`/documents/${enc(id)}/send`, {
      body:
        attachPdf === undefined
          ? { expectedUpdatedAt, contactIds }
          : { expectedUpdatedAt, contactIds, attachPdf },
    }),
  /** The latest sent version to more contacts, or again (M4.5): new links; the email waits for the PDF. */
  resend: (id: string, contactIds: string[], attachPdf?: boolean) =>
    request<{ ok: true; sends: number; waitingForPdf: boolean }>(`/documents/${enc(id)}/resend`, {
      body: attachPdf === undefined ? { contactIds } : { contactIds, attachPdf },
    }),
  /** Every live link of the offer stops working; sends still waiting are cancelled (M4.5). */
  revokeLinks: (id: string) =>
    request<{ ok: true; revoked: number; cancelled: number }>(`/documents/${enc(id)}/links/revoke`, {
      body: {},
    }),
  /** An accepted proposal becomes a project with milestones and a first-instalment draft (M4.5, ADM-PROP-09). Idempotent. */
  startProject: (id: string, expectedUpdatedAt?: number) =>
    request<StartResult>(`/documents/${enc(id)}/start-project`, {
      body: expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt },
    }),
  requestApproval: (id: string, expectedUpdatedAt: number, reason?: string) =>
    request<{ id: string; status: "pending"; discountBp: number }>(`/documents/${enc(id)}/approval-request`, {
      body: reason ? { expectedUpdatedAt, reason } : { expectedUpdatedAt },
    }),
  toInvoice: (id: string) =>
    request<{ id: string; type: string; sourceDocumentId: string; totalMinor: number }>(
      `/documents/${enc(id)}/convert`,
      { body: { to: "invoice" } },
    ),
  toCarePlan: (id: string, body: CareConvertInput) =>
    request<CareConverted>(`/documents/${enc(id)}/convert`, { body: { to: "care_plan", ...body } }),
  approvals: (
    q: { status?: ApprovalState | undefined; limit?: "25" | "50"; after?: string | undefined } = {},
  ) => request<{ approvals: ApprovalRow[]; next: string | null }>(`/approvals${qs(q)}`),
  decide: (id: string, decision: "approve" | "reject", note?: string) =>
    request<{ ok: true; status: "approved" | "rejected" }>(`/approvals/${enc(id)}/decide`, {
      body: note ? { decision, note } : { decision },
    }),
};
