// The typed client for the portal API (apps/portal/worker, docs/05 §6.2; POR-01, POR-02). Every error body is
// `{ error: { code, message }, request_id }`; a 429 also carries `Retry-After` (seconds). One code is handled here for
// every signed-in caller: `unauthenticated` (401) means the session has ended, so the app goes back to sign-in.
//
// No request is ever retried here: a sign-in link works once, so a second POST of the same token would only fail
// (and count as a failed attempt). The person decides whether to press a button again.

import type { PdfView } from "@techaust/pdf/view";

export type { PdfView };

export type Me = {
  contact: { name: string; email: string };
  organisation: { displayName: string };
  canSeeFinance: boolean;
};

type ApiErrorBody = { error?: { code: string; message: string }; request_id?: string };

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
    /** Seconds until a 429 lifts (from `Retry-After`), else null. */
    readonly retryAfterS: number | null = null,
    /** The rest of an error body: `latestId` of a `superseded`, `name` and `at` of an `already_accepted` (M4.5). */
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let unauthenticatedHandler: (() => void) | null = null;

/** The session provider registers itself here: a signed-in call answered 401 means the session has ended. */
export function onUnauthenticated(handler: () => void) {
  unauthenticatedHandler = handler;
  return () => {
    if (unauthenticatedHandler === handler) unauthenticatedHandler = null;
  };
}

type Options = { body?: unknown; signedIn?: boolean; noContent?: boolean };

function retryAfter(res: Response): number | null {
  const n = Number(res.headers.get("Retry-After"));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function send<T>(path: string, { body, signedIn = true, noContent = false }: Options): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new RequestError(0, "network", "network");
  }
  // Sign-out answers 204 with no body whatever happened: never parse it.
  if (noContent && res.ok) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as T & ApiErrorBody;
  if (res.ok) return data;
  throw errorOf(res, data, signedIn);
}

function errorOf(res: Response, data: ApiErrorBody, signedIn: boolean): RequestError {
  const { error: body, request_id, ...extra } = data;
  const e = body ?? { code: res.status >= 500 ? "server" : "unknown", message: "" };
  const error = new RequestError(res.status, e.code, e.message, request_id ?? null, retryAfter(res), extra);
  if (signedIn && res.status === 401 && e.code === "unauthenticated") unauthenticatedHandler?.();
  return error;
}

/** A downloaded file: its bytes and the name the server gave it (`Content-Disposition`). */
export type Download = { blob: Blob; fileName: string | null };

/** `attachment; filename="TH-PRP-2627-0003-v2.pdf"` → the file name (null when there is none). */
export function fileNameOf(disposition: string | null): string | null {
  const m = disposition ? /filename="([^"]+)"/.exec(disposition) : null;
  return m?.[1] ?? null;
}

/**
 * A PDF as a blob (POR-05, POR-06): a GET with the session, or a POST with the link's token in the body (never in the
 * address). An error answers JSON like every other call, so it becomes the same RequestError.
 */
async function download(path: string, body: unknown, signedIn: boolean): Promise<Download> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new RequestError(0, "network", "network");
  }
  if (!res.ok) throw errorOf(res, (await res.json().catch(() => ({}))) as ApiErrorBody, signedIn);
  return { blob: await res.blob(), fileName: fileNameOf(res.headers.get("Content-Disposition")) };
}

// ---- Proposals and estimates (M4.5; apps/portal/worker/offers.ts and offer-token.ts) ------------------------------

/** The statuses a client sees (`effectiveOfferStatus` in @techaust/core/offers). */
export type OfferStatus = "sent" | "viewed" | "accepted" | "declined" | "expired" | "revised";
export type OfferKind = "proposal" | "estimate";
/** A decline's answer (session and link alike): `by` is the deciding contact's name (null if it can't be read). */
export type DeclineAnswer = { declined: { reason: string; at: number; by: string | null } };

/** One row of GET /offers: the latest rendered version of each offer. `total` is already formatted by the server. */
export type OfferItem = {
  id: string;
  kind: OfferKind;
  title: string | null;
  numberDisplay: string | null;
  version: number;
  status: OfferStatus;
  total: string;
  /** `YYYY-MM-DD` (IST). */
  validUntil: string | null;
  decidedAt: number | null;
};

export type OfferAcceptance = { typedName: string; email: string; acceptedAt: number; via: string | null };
export type OfferDecline = {
  reason: string | null;
  note: string | null;
  at: number | null;
  by: string | null;
};

/** GET /offers/:id (and the link's POST /t/offer): the document, its client view, and what was decided. */
export type OfferPage = {
  document: {
    id: string;
    kind: OfferKind;
    status: OfferStatus;
    version: number;
    title: string | null;
    numberDisplay: string | null;
    validUntil: string | null;
    /** SHA-256 of this version's PDF (hex). */
    fingerprint: string;
  };
  view: PdfView;
  acceptance?: OfferAcceptance;
  decline?: OfferDecline;
  certificate: { state: "none" | "pending" | "ready" };
  /** Only on a link: its purpose, and the version it was sent for when a newer one is shown. */
  link?: { purpose: "offer" | "confirmation"; supersededFrom?: number | null };
};

/** A version that a newer sent version replaced: the API names the latest one instead of answering the view. */
export type OfferSuperseded = { superseded: { latestId: string | null; version: number | null } };

export type AcceptRecord = { typedName: string; email: string; acceptedAt: number; fingerprint: string };

// ---- Signed deeds of assignment (T11; apps/portal/worker/deeds.ts) ---------------------------------------------------------------

/** One signed deed of the organisation: shown on its accepted proposal or estimate's page (`sourceDocumentId`). The server lists signed deeds only. */
export type SignedDeed = {
  id: string;
  number: string;
  sourceDocumentId: string;
  offer: { type: string; number: string | null; version: number };
  esignAt: number;
  /** "03 Nov 2026, 14:05 IST", written by the server (the screen writes `esignAt` in the client's own clock, lib/local-time.ts). */
  esignMoment: string;
  esignTxn: string;
  signatureLine: string;
  signedAt: number;
  size: number;
};

export const deedsApi = {
  /** The signed deeds of one accepted version (review L2); finance contacts only (owner, 2026-11-01): anyone else gets the plain 404. */
  list: (documentId: string) =>
    send<{ deeds: SignedDeed[] }>(`/deeds?document=${encodeURIComponent(documentId)}`, {}),
  /** The signed PDF; the deed is named in the request body, never in the address. */
  pdf: (id: string) => download("/deeds/pdf", { id }, true),
};

export const offersApi = {
  list: (after?: string) =>
    send<{ offers: OfferItem[]; next: string | null }>(
      `/offers${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      {},
    ),
  get: (id: string) => send<OfferPage | OfferSuperseded>(`/offers/${encodeURIComponent(id)}`, {}),
  accept: (id: string, typedName: string) =>
    send<AcceptRecord>(`/offers/${encodeURIComponent(id)}/accept`, { body: { typedName, agree: true } }),
  decline: (id: string, reason: string, note: string | null) =>
    send<DeclineAnswer>(`/offers/${encodeURIComponent(id)}/decline`, {
      body: note ? { reason, note } : { reason },
    }),
  pdf: (id: string) => download(`/offers/${encodeURIComponent(id)}/pdf`, undefined, true),
  certificate: (id: string) => download(`/offers/${encodeURIComponent(id)}/certificate`, undefined, true),
};

/** The same through an offer link (POR-06): the token goes in the body only. A bad or ended link is a plain 404. */
export const offerLinkApi = {
  open: (token: string) => send<OfferPage>("/t/offer", { ...pub, body: { token } }),
  accept: (token: string, documentId: string, typedName: string) =>
    send<AcceptRecord>("/t/offer/accept", { ...pub, body: { token, documentId, typedName, agree: true } }),
  decline: (token: string, documentId: string, reason: string, note: string | null) =>
    send<DeclineAnswer>("/t/offer/decline", {
      ...pub,
      body: note ? { token, documentId, reason, note } : { token, documentId, reason },
    }),
  pdf: (token: string, documentId: string) => download("/t/offer/pdf", { token, documentId }, false),
  certificate: (token: string, documentId: string) =>
    download("/t/offer/certificate", { token, documentId }, false),
};

const pub = { signedIn: false } as const;

// ---- Invoices, payment requests and notes (M5.4; apps/portal/worker/invoices.ts, doc-token.ts, invoice-summary.ts) -----------------------------

/**
 * The documents a client can open (never a draft or a void one, except a withdrawn payment request: ADM-INV-10, `status: "withdrawn"`): the server's
 * allow-list.
 */
export type InvoiceType = "proforma" | "tax_invoice" | "export_invoice" | "credit_note" | "debit_note";

/** One row of GET /invoices (newest issued first). `total` and `balance` are formatted by the server through core; the minor units are for sorting only. */
export type InvoiceItem = {
  id: string;
  type: InvoiceType | string;
  status: string;
  numberDisplay: string | null;
  /** `YYYY-MM-DD` (IST). */
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  totalMinor: number;
  /** ADM-INV-10: null on a withdrawn payment request (nothing is owed), as `balance` and `dueDate`. */
  balanceMinor: number | null;
  total: string;
  balance: string | null;
  /** ADM-INV-10: the IST day a withdrawn payment request was withdrawn (`YYYY-MM-DD`); null otherwise. Absent from an older API. */
  withdrawnOn?: string | null;
};

type Bank = {
  accountName: string;
  accountNo: string;
  ifsc: string | null;
  bankName: string;
  branch: string | null;
};
type SwiftBank = {
  accountName: string;
  accountNo: string;
  swift: string;
  bankName: string;
  branch: string | null;
  bankAddress: string | null;
  intermediary: string | null;
  purposeCode: string | null;
};
export type InvoiceBank = { inr: Bank | null } | { swift: SwiftBank | null };

export type InvoiceLine = {
  position: number;
  description: string;
  detail: string | null;
  sac: string | null;
  qtyMilli: number;
  unit: string;
  rateMinor: number;
  /** Final sweep P3: the line's discount as typed ("percent": basis points; "fixed": minor units), null when none. Absent from an older API. */
  discountKind?: "percent" | "fixed" | null;
  discountValue?: number | null;
  /** The discount as the PDF prints it ("10 %", or the amount), null when the line has none. */
  discount?: string | null;
  taxableMinor: number;
  gstRateBp: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  lineTotalMinor: number;
};

/** One document's summary, read from its frozen row (LD62): the same answer for the emailed link and the signed-in page. No payment fields (M6, M7.1). */
export type InvoiceSummary = {
  id: string;
  type: InvoiceType | string;
  status: string;
  numberDisplay: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  /** A credit or debit note: the invoice it is against. */
  parentNumber: string | null;
  /**
   * Final sweep P15: a credit or debit note's invoice id, when the client may open that invoice (same organisation, an open status), so the page can
   * link to it; null otherwise. Absent from an older API.
   */
  parentId?: string | null;
  /** Final sweep P15: a credit or debit note's reason as frozen (`code` from core `NOTE_REASONS`, `text` the words typed); null on other types. */
  noteReason?: { code: string; text: string } | null;
  /** Final sweep P2: the issued credit notes against this invoice, in issue order (the "Credited ({numbers})" row); empty on other types. */
  creditNotes?: { id: string; numberDisplay: string | null }[];
  /**
   * FX-4 (A5 5): a proforma sealed with the estimate marker shows its tax heads as estimates; false on one sealed before FX-4 and on every other type.
   * Absent from an older API: no "(estimate)".
   */
  gstEstimate?: boolean;
  totals: {
    subtotalMinor: number;
    discountMinor: number;
    taxableMinor: number;
    cgstMinor: number;
    sgstMinor: number;
    igstMinor: number;
    roundOffMinor: number;
    totalMinor: number;
    totalInrMinor: number | null;
  };
  paidMinor: number;
  creditedMinor: number;
  /** M6.1 (T8): the TDS the client deducted (0 when none); `tdsRow` is the summary row, 07-ZH line 18 "TDS deducted by you", or null. */
  tdsMinor?: number;
  tdsRow?: { label: string; amount: string } | null;
  /** ADM-INV-10: null on a withdrawn payment request (`status: "withdrawn"`): nothing is owed, so no amount due and no due date. */
  balanceMinor: number | null;
  total: string;
  balance: string | null;
  /** ADM-INV-10: the IST day it was withdrawn (`YYYY-MM-DD`); null unless withdrawn. Absent from an older API. The staff's reason is never sent. */
  withdrawnOn?: string | null;
  lines: InvoiceLine[];
  /** The bank block printed on the document (none on a credit note; never shown for a withdrawn payment request, ADM-INV-10). */
  bank: InvoiceBank | null;
  /** The PDF exists (its download answers 409 `pdf_pending` until it does; false on a withdrawn payment request, whose PDF answers 409 `withdrawn`). */
  pdfReady: boolean;
  /** M6.2 (POR-06): the document can be paid online now (a domestic INR tax invoice, debit note or proforma with something due). Absent from an older API. */
  payOnline?: boolean;
  /** M6.2: a proforma is paid in whole rupees (LD28; 07-ZI line 7). */
  wholeRupees?: boolean;
  /** M6.3: the gateway of the document's currency ("Pay by card" through Stripe for USD; "Pay now" through Razorpay for INR); null when it can't be paid online. */
  provider?: "razorpay" | "stripe" | null;
  /** M6.2: the open link (amount, when it ends), the last payment received online (confirmed or still being checked, so "received"), a proforma's waiting one. */
  online?: OnlineBlock;
};

/** M6.2: the page's Pay now block (no Razorpay ids, nothing about the payer). */
export type OnlineBlock = {
  open: { amountMinor: number; expiresAt: number } | null;
  lastPaid: { amountMinor: number; at: number } | null;
  proformaPending: boolean;
  /**
   * The smallest part payment (Settings › Payment terms' floor, never under ₹1, or the balance if lower; fix round 3 item 1). Null when the document can't be paid
   * online or the floor can't be read: the dialog then offers the full amount only (as it does when the minimum equals the balance).
   */
  minimumMinor: number | null;
  /** M6.3 (core `payment_pending`): a gateway payment still waits on the document: Pay is hidden and 07-ZM line 4 (or 07-ZI line 13) shows. */
  paymentPending?: boolean;
  /** M6.3 (L9, 07-ZM line 6): the most one card payment may be (USD), or null (INR: no maximum). */
  maximumMinor?: number | null;
};

/**
 * M6.2, M6.3: the gateway's page to send the browser to (`url` on that gateway's own hosts: rzp.io or razorpay.com, checkout.stripe.com; checked by the server
 * and again before the browser leaves).
 */
export type PayLink = {
  ok: true;
  provider: "razorpay" | "stripe";
  url: string;
  expiresAt: number;
  reused: boolean;
};

export const invoicesApi = {
  list: (after?: string) =>
    send<{ invoices: InvoiceItem[]; next: string | null }>(
      `/invoices${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      {},
    ),
  get: (id: string) => send<{ document: InvoiceSummary }>(`/invoices/${encodeURIComponent(id)}`, {}),
  /** M6.2: the same, asking the server to check the open link with Razorpay first (once, after 20 s of Processing). */
  getRefreshed: (id: string) =>
    send<{ document: InvoiceSummary }>(`/invoices/${encodeURIComponent(id)}?refresh=1`, {}),
  /**
   * M6.2 Pay now (07-ZI): a Razorpay link for this amount; M6.3 Pay by card (07-ZM): a Stripe page on a USD document (the server picks the gateway by the
   * document's currency). 400 `amount_below_minimum` / `amount_above_balance` / `amount_not_whole_rupee` / `amount_above_maximum` (07-ZI lines 6, 7,
   * 07-ZM line 6, with details); 409 `payment_processing` (07-ZM line 4 or 07-ZI line 13); other 409s, 429, 502, 503 answer 07-ZI line 14.
   */
  pay: (id: string, amountMinor: number) =>
    send<PayLink>(`/invoices/${encodeURIComponent(id)}/pay`, { body: { amountMinor } }),
  pdf: (id: string) => download(`/invoices/${encodeURIComponent(id)}/pdf`, undefined, true),
};

/** The same through an invoice link (`/i#t=…`, POR-06): the token in the body only. A bad, revoked or ended link is a plain 404. */
export const invoiceLinkApi = {
  open: (token: string) => send<{ document: InvoiceSummary }>("/t/document", { ...pub, body: { token } }),
  pdf: (token: string) => download("/t/document/pdf", { token }, false),
  /** M6.2 Pay now from the emailed link (the token in the body only; Razorpay returns to `/pay/return`). */
  pay: (token: string, amountMinor: number) =>
    send<PayLink>("/t/document/pay", { ...pub, body: { token, amountMinor } }),
};

export const api = {
  /**
   * Ask for a sign-in link with the Turnstile token of this attempt (M2.4b). Always `{ ok: true }` (known or unknown email
   * alike) unless the check failed (400 `turnstile_failed`) or rate limited (429).
   */
  requestLink: (email: string, turnstile: string) =>
    send<{ ok: true }>("/auth/magic", { ...pub, body: { email, turnstile } }),
  /** Use a sign-in link: 200 sets the session cookie; 401 `link_invalid` for every kind of bad link. */
  verify: (token: string) => send<{ ok: true }>("/auth/magic/verify", { ...pub, body: { token } }),
  me: () => send<Me>("/me", {}),
  /** 204, no body, with or without a session. */
  logout: () => send<void>("/auth/logout", { ...pub, body: {}, noContent: true }),
  /** Every live session of this contact at this organisation, this one included. */
  revokeAll: () => send<{ ok: true; revoked: number }>("/auth/sessions/revoke-all", { body: {} }),
};
