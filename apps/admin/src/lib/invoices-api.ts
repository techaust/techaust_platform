// The typed client for the invoices API (M5.1; apps/admin/worker/invoices.ts, invoice-issue.ts, invoice-view.ts, document-pdf.ts, client-tabs.ts,
// approvals.ts). Its own module, so the main chunk does not carry it: only the invoice screens import it. The shapes mirror the Worker's answers
// (`InvoiceView`, the list rows, the issue-request queue). Money is integer minor units in the invoice's currency; the screens only format it
// (through core), never work it out.
import type { IssueBlockerCode, VoidBlockerCode } from "@techaust/core/invoices";
import { hasSupplierCopy } from "@techaust/core/pdf-jobs";
import type { Role } from "@techaust/core/permissions";
import type { Currency } from "../api.ts";
import { qs, request } from "../api.ts";
import { allowed } from "./access.ts";
import type {
  ApprovalInfo,
  ApprovalState,
  Discount,
  Issue,
  LineIn,
  RecipientView,
  SummaryRow,
  Supply,
  Totals,
} from "./documents-api.ts";

/** The invoice family of M5.1 (only `tax_invoice` can be issued now; the others arrive with M5.2 and M5.3). */
export type InvoiceType = "proforma" | "tax_invoice" | "export_invoice" | "credit_note" | "debit_note";
export type InvoiceStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "partially_credited"
  | "credited"
  | "void"
  | "converted";
/** The list's status filter: a stored status, or `overdue` (worked out by the server: a balance past its due date). */
export type InvoiceListStatus = InvoiceStatus | "overdue";

export type InvoiceListRow = {
  id: string;
  type: InvoiceType;
  status: InvoiceStatus;
  number: string | null;
  clientId: string;
  clientCode: string;
  clientName: string;
  currency: Currency;
  totalMinor: number;
  balanceMinor: number;
  issueDate: string | null;
  dueDate: string | null;
  overdue: boolean;
  pdf: "none" | "pending" | "ready";
  createdAt: number;
  updatedAt: number;
  approval: ApprovalState;
};

export type InvoiceListQuery = {
  type?: InvoiceType | undefined;
  status?: InvoiceListStatus | undefined;
  clientId?: string | undefined;
  limit?: "25" | "50" | undefined;
  after?: string | undefined;
};

/**
 * A blocker as the server sends it: a code, and for a line's blocker the line's 1-based position; M5.2: the FY token a missing LUT is for (`fy`), the
 * ISO date a rate is for or was judged against (`date`).
 */
export type InvoiceBlocker = { code: IssueBlockerCode | string; line?: number; fy?: string; date?: string };

/** M5.2: one line of the mandatory-field checklist (ADM-INV-06) as the view sends it; the words are 07-S §3's, by `id`. */
export type ChecklistItemView = {
  id: string;
  locked: boolean;
  available: boolean;
  on: boolean;
  applies: boolean;
  blockers: string[];
  /** Step 5 contract (07-S §3): a house rule, not required by GST law (switchable). Absent from an older API. */
  houseRule?: boolean;
};

/** M5.2: the reminder of ADM-INV-18 for today (IST): `due` in March while the next FY has no letter, `currentMissing` while the running FY has none. */
export type LutStatus = {
  currentFy: string;
  currentFyLabel: string;
  nextFy: string;
  nextFyLabel: string;
  due: boolean;
  currentMissing: boolean;
} | null;

/** M5.2: the INR view the tax engine made of a USD document (minor units in INR). */
export type InrView = {
  rateMicros?: number;
  taxableMinor: number;
  cgstMinor?: number;
  sgstMinor?: number;
  igstMinor: number;
  totalMinor: number;
};

/** M5.2: an issued tax or export invoice made from a proforma (Q9). */
export type ProformaChild = {
  id: string;
  type: InvoiceType;
  number: string | null;
  status: InvoiceStatus;
  totalMinor: number;
  currency: Currency;
  issueDate: string | null;
  receivedOn: string | null;
};

export type InvoiceLine = {
  id: string;
  position: number;
  catalogueItemId: string | null;
  description: string;
  detail: string | null;
  sac: string | null;
  qtyMilli: number;
  unit: string;
  rateMinor: number;
  discount: Discount | null;
  gstRateBp: number;
  taxableMinor: number | null;
  cgstMinor: number | null;
  sgstMinor: number | null;
  igstMinor: number | null;
  lineTotalMinor: number | null;
};

export type InvoiceIssuerView = {
  company?: { tradeName?: string; legalName?: string | null; gstin?: string | null; stateCode?: string };
  sender?: { staffId?: string; name?: string; email?: string };
  [k: string]: unknown;
};

/** GET /invoices/:id (and what a save answers): a draft worked out today, or an issued invoice read back from what was frozen. */
export type InvoiceView = {
  id: string;
  type: InvoiceType;
  status: InvoiceStatus;
  number: string | null;
  series: string | null;
  fy: string | null;
  currency: Currency;
  issueDate: string | null;
  dueDate: string | null;
  dueDays: number;
  /** Settings › Payment terms' due days: the "Net N" of the due-date note (FX-5 review L6). */
  defaultDueDays: number;
  dueDatePreview: string | null;
  createdAt: number;
  updatedAt: number;
  frozenAt: number | null;
  contentSha256: string | null;
  frozen: boolean;
  parentId: string | null;
  sourceDocumentId: string | null;
  client: {
    id: string;
    code: string;
    name: string;
    gstStatus: string;
    stateCode: string | null;
    country: string;
    currency: Currency;
    anonymised: boolean;
  };
  contact: { id: string | null; name: string | null; email: string | null; anonymised: boolean } | null;
  recipient: RecipientView | null;
  issuer: InvoiceIssuerView | null;
  discount: Discount | null;
  lines: InvoiceLine[];
  /** FX-4 (A5 12): the SAC a new custom line starts with (Settings › Tax "default SAC"); null when none is set or on an issued document. Absent from an older API. */
  newLineSac?: string | null;
  totals: Totals | null;
  supply: Supply | null;
  summary: SummaryRow[] | null;
  paidMinor: number;
  creditedMinor: number;
  balanceMinor: number;
  overdue: boolean;
  errors: Issue[];
  warnings: Issue[];
  blockers: InvoiceBlocker[];
  typeIssuable: boolean;
  needsResave: boolean;
  issue: {
    decision: "allow" | "step-up" | "approval" | "deny";
    canIssue: boolean;
    approval: ApprovalInfo;
    preview: { series: string; fy: string; template: string; padding: number };
  };
  void: {
    voidedAt: number | null;
    /** Who voided it, by name (from the audit row); absent from an API older than the M5.1 review fixes. */
    voidedByName?: string | null;
    reason: string | null;
    canVoid: boolean;
    blockers: (VoidBlockerCode | string)[];
  };
  pdf: { state: "none" | "pending" | "ready"; sha256: string | null; fingerprint: string | null };
  milestone: {
    id: string;
    title: string;
    projectId: string;
    /** The project's name (sent to every role that reads the invoice); absent from an API older than the M5.1 review fixes. */
    projectName?: string | null;
    status: string;
  } | null;
  terms: { id: string; version: number; sha256: string } | null;
  // ---- M5.2 (apps/admin/worker/invoice-view.ts); optional so an older API still loads -------------------------------------------------------
  /** The day the service was completed (set once on an issued tax or export invoice). */
  serviceCompletedOn?: string | null;
  /** The tax or export invoice issued for a payment received (Q9): the proforma it settles, as sealed. */
  advance?: {
    proformaId: string;
    proformaNumber: string;
    proformaIssueDate: string;
    receivedOn: string;
    receiptId: string;
    /** Step 5 (Q37, S §9): set when it was issued with IGST because the payment's FY had no LUT (that FY). Optional: an older API has none. */
    igstNoLutFy?: string | null;
  } | null;
  /** Q8: issuing needs the explicit "Issue in INR" (an export invoice in INR). */
  needsInrConfirm?: boolean;
  checklist?: {
    settings: { bankDetails: boolean; paymentLink: false; signatory?: boolean };
    switchable: readonly string[];
    items: ChecklistItemView[];
  };
  fx?: {
    applies: boolean;
    /** `noRateThatDay`: the Owner's statement is in force (a frozen invoice kept it; a draft only while it was made for the day of supply); `noRateDay`: the day it was made for. */
    value: {
      rate: string;
      rateMicros: number;
      date: string;
      source: string;
      noRateThatDay?: boolean;
      noRateDay?: string | null;
    } | null;
    refDate: string;
    maxAgeDays: number;
    dateOk: boolean | null;
    /** The rate's day judged against today's (RA-21): which of the two refusals the issue would give; null when frozen or no rate. Absent from an older API. */
    dateVerdict?: "ok" | "same_day_exists" | "invalid" | null;
    inr: InrView | null;
  };
  export?: {
    mode: "lut" | "igst_paid";
    draftMode: "lut" | "igst_paid" | null;
    settingsMode: "lut" | "igst_paid";
    endorsement: string | null;
    lutRequired: boolean;
    lut: { fy: string; arn: string } | null;
    issueFy: string | null;
    countryCode: string;
    countryName: string | null;
    declaration: { available: boolean; pinned: boolean; id: string | null; text: string | null };
  } | null;
  lutStatus?: LutStatus;
  proforma?: {
    notice: string | null;
    /**
     * FX-4 (A5 5): the tax heads are estimates. A frozen proforma says what it was sealed with (one issued before FX-4 has no marker); a draft is
     * issued with it. Absent from an older API: no "(estimate)".
     */
    gstEstimate?: boolean;
    validUntil: string | null;
    paidMinor: number;
    balanceMinor: number;
    canAdvance: boolean;
    children: ProformaChild[];
    warnAt: number | null;
    warnDate: string | null;
    /** Review 2 (6): the server's own answer to "does recording a payment here need the explicit Issue in INR?" (the client's current status, as the
     * advance route judges it). Absent from an older API: the dialog then decides from the client on screen. */
    advanceNeedsInrConfirm?: boolean;
    /** Review 2 (6): the client's GST status no longer matches the supply the proforma was sealed with, so the advance route refuses
     * (`advance_supply_changed`); the screen says so and offers no action. */
    advanceSupplyChanged?: boolean;
  } | null;
};

// ---- M5.4 (apps/admin/worker/invoice-send.ts `sendsView`, `sendAction`; care-billing.ts `careView`); optional so an older API still loads -------------

/** One email of the document (newest first): who it went to, how it was made (`auto`: the care job), and the last email status from the log. */
export type InvoiceSendRow = {
  id: string;
  contactName: string | null;
  email: string | null;
  kind: "send" | "resend" | "auto" | string;
  createdAt: number;
  queuedAt: number | null;
  cancelledAt: number | null;
  emailStatus: string | null;
  /** The member who sent it by hand; null for an automatic send (kind `auto`) or a member no longer on record. Absent from an older API. */
  sentByName?: string | null;
};
/** One payment reminder: its signed offset from the due date (−3 is before), when it is due (UTC ms, the window's opening hour IST), and what happened. */
export type InvoiceReminderRow = {
  offset: number;
  dueAt: number;
  sentAt: number | null;
  skippedReason: string | null;
};
export type InvoiceM54 = {
  sends?: InvoiceSendRow[];
  links?: { live: number };
  /**
   * `paused`: a paused reminder is still ahead (a paused one whose day passed comes as `skippedReason: "missed_while_paused"`); `window`: the hours
   * reminders go out, IST, from Settings > Payment terms (absent from an older API).
   */
  reminders?: {
    started: boolean;
    paused: boolean;
    rows: InvoiceReminderRow[];
    window?: { from: string; to: string } | null;
  };
  /** A care invoice: the plan and the period it bills; on a draft, whether the system will issue it and why not. */
  care?: {
    planId: string;
    periodStart: string;
    periodEnd: string;
    overageMinutes: number | null;
    auto: { eligible: boolean; reasons: string[] } | null;
  } | null;
};

/** `actions.send` of the view (it rides beside M5.3's note actions): whether this member may email the document now, and why not. Absent from an older API. */
export function sendActionOf(v: unknown): { allowed: boolean; reasons: string[] } | null {
  const a = (v as { actions?: { send?: unknown } | null }).actions?.send as
    | { allowed?: unknown; reasons?: unknown }
    | undefined;
  if (!a || typeof a.allowed !== "boolean") return null;
  return { allowed: a.allowed, reasons: Array.isArray(a.reasons) ? (a.reasons as string[]) : [] };
}

/**
 * POST /invoices/:id/send. `remindersPaused`: the links were revoked (or the reminders paused) before, a paused reminder is still ahead, and this send
 * doesn't resume them (the view's `reminders.paused` rule).
 */
export type SendResult = {
  ok: true;
  kind: "send" | "resend";
  sends: number;
  reminders: number;
  waitingForPdf: boolean;
  remindersPaused: boolean;
};

export type InvoicePatch = {
  expectedUpdatedAt: number;
  fields?: {
    contactId?: string | null;
    discount?: Discount | null;
    /** M5.2: the export route of an export draft (or of a proforma for an overseas client); null follows Settings. */
    exportMode?: "lut" | "igst_paid" | null;
    /** M5.2 (Q7): the exchange rate of a USD tax or export draft; null clears it. */
    fx?: FxIn | null;
    /** M5.2: the day the service was completed (a tax or export draft). */
    serviceCompletedOn?: string | null;
    /** M5.2: add the newest extra export note (Settings › Terms) to an export draft. */
    exportDeclaration?: boolean;
  };
  lines?: LineIn[];
};

export type NewInvoiceInput = {
  clientId: string;
  /** M5.2: `proforma` makes a proforma for any client (default: the type comes from the client). */
  kind?: "invoice" | "proforma";
  contactId?: string;
  fromMilestoneId?: string;
  services?: { catalogueItemId: string; defaultLines?: string[] }[];
};

export type IssuedResult = {
  ok: true;
  id: string;
  number: string | null;
  issueDate: string;
  dueDate: string;
  fy: string;
  fyLabel: string;
  status: "issued";
  updatedAt: number;
  approvalId?: string;
};

/** One row of the owner's queue of issue requests (GET /approvals?kind=issue). */
export type IssueApprovalRow = {
  id: string;
  kind: "issue";
  state: ApprovalState;
  createdAt: number;
  decidedAt: number | null;
  reason: string | null;
  note: string | null;
  requestedBy: string;
  requesterName: string | null;
  decidedBy: string | null;
  deciderName: string | null;
  document: {
    id: string;
    type: InvoiceType;
    status: InvoiceStatus;
    number: string | null;
    currency: Currency;
    clientCode: string;
    clientName: string;
  };
  totalMinor: number;
};

const enc = encodeURIComponent;

/** The PDF of an issued invoice: a same-origin download (the API answers an attachment). */
export const invoicePdfHref = (id: string) => `/api/v1/invoices/${enc(id)}/pdf`;

/**
 * Step 5 contract (Q11, 07-R §6–§7): the stored DUPLICATE FOR SUPPLIER copy, for the Owner and the Accountant, of a tax or export invoice and a credit or
 * debit note (a proforma has none: 404). It answers the PDF once ready; 202 `{state: "making"}` while jobs makes it after the original (M5 owner fixes, B3);
 * 409 `pdf_pending` while the original has no PDF, and for an anonymised client, whose copy is never made (FX-4, full audit A5 9: never a 202 answered forever).
 */
export const invoiceSupplierPdfHref = (id: string) => `/api/v1/invoices/${enc(id)}/pdf/supplier`;

/**
 * Who may download it, and for which document: core's matrix row `invoices.supplierCopy` (Owner and Accountant; `allowed` is the screens' one reading of it) and core's
 * `hasSupplierCopy` (a proforma has none), so neither rule is written a second time here.
 */
export const canDownloadSupplierCopy = (role: Role, type: string) =>
  allowed(role, "invoices.supplierCopy") && hasSupplierCopy(type);

/**
 * `pending`: 202, the copy is being made. `no_original` (FX-4, early check M1): 409 `pdf_pending`, nothing can make it now: the original has no PDF (its
 * own retry is the PDF panel's "Try again"), or the client is anonymised and no copy was made before. The screen offers the copy only once the original
 * is ready, so only the anonymised case is said on screen (`supplierCopyLine`, review L2). `failed`: anything else.
 */
export type SupplierCopyResult =
  | { state: "ready"; blob: Blob; filename: string | null }
  | { state: "pending" | "no_original" | "failed" };

/** One request at a time per document: a second ask while the first is out gets the same answer (a click twice, or two tabs' worth of impatience, is one request). */
const supplierAsks = new Map<string, Promise<SupplierCopyResult>>();

/**
 * Fetches the supplier copy (same origin, the session cookie): `ready` with the file, `pending` (202), `no_original` (409 `pdf_pending`), or `failed`. The
 * screen asks first instead of linking straight to it, so a copy still being made is said in words, never downloaded as an error. While a request for the same
 * document is pending it is not asked again (the server also asks jobs at most once in 5 minutes).
 */
export function fetchSupplierCopy(id: string): Promise<SupplierCopyResult> {
  const pending = supplierAsks.get(id);
  if (pending) return pending;
  const ask = askSupplierCopy(id).finally(() => supplierAsks.delete(id));
  supplierAsks.set(id, ask);
  return ask;
}

async function askSupplierCopy(id: string): Promise<SupplierCopyResult> {
  let res: Response;
  try {
    res = await fetch(invoiceSupplierPdfHref(id), { credentials: "same-origin" });
  } catch {
    return { state: "failed" };
  }
  if (res.ok && (res.headers.get("Content-Type") ?? "").includes("pdf")) {
    const name = /filename="?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? null;
    return { state: "ready", blob: await res.blob(), filename: name };
  }
  // Sweep finding 11 (B3): a copy still being made answers 202 `{state: "making"}`, so the browser logs no error for it. A 409 `pdf_pending` is not
  // "being made" (FX-4, early check M1): nothing will make the copy until the original has its PDF, so the screen says that instead of "Preparing" forever.
  if (res.status === 202) return { state: "pending" };
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
    if (body.error?.code === "pdf_pending") return { state: "no_original" };
  }
  return { state: "failed" };
}

export const invoicesApi = {
  list: (q: InvoiceListQuery = {}) =>
    request<{ invoices: InvoiceListRow[]; next: string | null }>(`/invoices${qs(q)}`),
  clientList: (clientId: string, after?: string, limit?: "25" | "50") =>
    request<{ invoices: InvoiceListRow[]; next: string | null }>(
      `/clients/${enc(clientId)}/invoices${qs({ after, limit })}`,
    ),
  get: (id: string) => request<InvoiceView>(`/invoices/${enc(id)}`),
  create: (body: NewInvoiceInput) =>
    request<{
      id: string;
      type: InvoiceType;
      updatedAt: number;
      contentSha256: string;
      totalMinor: number | null;
    }>("/invoices", { body }),
  save: (id: string, body: InvoicePatch) =>
    request<InvoiceView>(`/invoices/${enc(id)}`, { method: "PATCH", body }),
  discard: (id: string, expectedUpdatedAt: number) =>
    request<{ ok: true }>(`/invoices/${enc(id)}${qs({ expectedUpdatedAt: String(expectedUpdatedAt) })}`, {
      method: "DELETE",
    }),
  issue: (id: string, expectedUpdatedAt: number, expectedContentSha256: string, confirmInrExport = false) =>
    request<IssuedResult>(`/invoices/${enc(id)}/issue`, {
      body: {
        expectedUpdatedAt,
        expectedContentSha256,
        ...(confirmInrExport ? { confirmInrExport: true } : {}),
      },
    }),
  /** M5.2 (Q9): the Owner records a payment received against an issued proforma; a tax or export invoice is issued for it, already paid. */
  advance: (id: string, body: AdvanceInput) =>
    request<AdvanceResult>(`/invoices/${enc(id)}/advance-invoice`, { body }),
  /** M5.2 (LD29): the day the service was completed, set once on an issued tax or export invoice. */
  serviceCompleted: (id: string, expectedUpdatedAt: number, date: string) =>
    request<{ ok: true; serviceCompletedOn: string; updatedAt: number }>(
      `/invoices/${enc(id)}/service-completed`,
      { body: { expectedUpdatedAt, date } },
    ),
  requestIssue: (id: string, expectedUpdatedAt: number) =>
    request<{ id: string; status: "pending" }>(`/invoices/${enc(id)}/issue-request`, {
      body: { expectedUpdatedAt },
    }),
  void: (id: string, expectedUpdatedAt: number, reason: string) =>
    request<{
      ok: true;
      status: "void";
      number: string | null;
      voidedAt: number;
      updatedAt: number;
      /** The milestone the invoice was made from, with the status the void left it in (M5.1 L3); null when there was none. */
      milestone?: { id: string; status: string } | null;
    }>(`/invoices/${enc(id)}/void`, { body: { expectedUpdatedAt, reason } }),
  retryPdf: (id: string) =>
    request<{ ok: true; pdf: { state: "pending" } }>(`/invoices/${enc(id)}/pdf/retry`, { body: {} }),
  /** M5.4: email an issued document to 1 to 5 contacts with portal access (Owner and Staff, Q42). */
  send: (id: string, contactIds: string[], attachPdf: boolean) =>
    request<SendResult>(`/invoices/${enc(id)}/send`, { body: { contactIds, attachPdf } }),
  /** M5.4: cancels the emails still waiting, revokes every live link and pauses the reminders (LD60). */
  revokeLinks: (id: string) =>
    request<{ ok: true; revoked: number; cancelled: number; paused: number }>(
      `/invoices/${enc(id)}/links/revoke`,
      { body: {} },
    ),
  pauseReminders: (id: string) =>
    request<{ ok: true; paused: number }>(`/invoices/${enc(id)}/reminders/pause`, { body: {} }),
  resumeReminders: (id: string) =>
    request<{ ok: true; resumed: number }>(`/invoices/${enc(id)}/reminders/resume`, { body: {} }),
  issueApprovals: (
    q: {
      status?: ApprovalState | undefined;
      after?: string | undefined;
      /** One request by id (a bell's link may name one older than the first page). */
      id?: string | undefined;
      /** The page size (the API's 25 by default); the approvals tabs count the first 50 of each queue. */
      limit?: "25" | "50" | undefined;
    } = {},
  ) =>
    request<{ approvals: IssueApprovalRow[]; next: string | null }>(
      `/approvals${qs({ kind: "issue", ...q })}`,
    ),
  /** Approve = issue (the approver's fresh code first); reject leaves the draft as it was. */
  decide: (id: string, decision: "approve" | "reject", note?: string, confirmInrExport = false) =>
    request<IssuedResult | { ok: true; status: "rejected" }>(`/approvals/${enc(id)}/decide`, {
      body: {
        decision,
        ...(note ? { note } : {}),
        ...(confirmInrExport && decision === "approve" ? { confirmInrExport: true } : {}),
      },
    }),
};

/** POST /invoices/:id/advance-invoice (Q9). */
export type AdvanceInput = {
  expectedProformaUpdatedAt: number;
  amountMinor: number;
  receivedOn: string;
  reference: string;
  fx?: FxIn;
  confirmInrExport?: true;
  /** Step 5 contract (Q37): the route of this payment's invoice; omitted = the proforma's. `igst` on an LUT proforma issues it with IGST 18 %. */
  route?: "lut" | "igst";
};

/** The rate a person enters (07-S §4); `noRateThatDay` (step 5 contract, S §8) says no rate was published on the document's own day. */
export type FxIn = {
  rate: string;
  date: string;
  source: "FBIL" | "RBI" | "OTHER";
  sourceNote?: string;
  noRateThatDay?: boolean;
};
export type AdvanceResult = {
  ok: true;
  id: string;
  type: InvoiceType;
  number: string;
  issueDate: string;
  fy: string;
  fyLabel: string;
  status: "paid";
  receiptId: string;
  warnings: string[];
  proforma: { id: string; status: InvoiceStatus; paidMinor: number; balanceMinor: number };
};
