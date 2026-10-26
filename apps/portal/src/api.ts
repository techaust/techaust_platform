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
    send<{ declined: { reason: string; at: number } }>(`/offers/${encodeURIComponent(id)}/decline`, {
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
    send<{ declined: { reason: string; at: number } }>("/t/offer/decline", {
      ...pub,
      body: note ? { token, documentId, reason, note } : { token, documentId, reason },
    }),
  pdf: (token: string, documentId: string) => download("/t/offer/pdf", { token, documentId }, false),
  certificate: (token: string, documentId: string) =>
    download("/t/offer/certificate", { token, documentId }, false),
};

const pub = { signedIn: false } as const;

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
