// The typed client for the portal API (apps/portal/worker, docs/05 §6.2; POR-01, POR-02). Every error body is
// `{ error: { code, message }, request_id }`; a 429 also carries `Retry-After` (seconds). One code is handled here for
// every signed-in caller: `unauthenticated` (401) means the session has ended, so the app goes back to sign-in.
//
// No request is ever retried here: a sign-in link works once, so a second POST of the same token would only fail
// (and count as a failed attempt). The person decides whether to press a button again.

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
  const e = data.error ?? { code: res.status >= 500 ? "server" : "unknown", message: "" };
  const error = new RequestError(res.status, e.code, e.message, data.request_id ?? null, retryAfter(res));
  if (signedIn && res.status === 401 && e.code === "unauthenticated") unauthenticatedHandler?.();
  throw error;
}

const pub = { signedIn: false } as const;

export const api = {
  /** Ask for a sign-in link. Always `{ ok: true }` (known or unknown email alike) unless rate limited (429). */
  requestLink: (email: string) => send<{ ok: true }>("/auth/magic", { ...pub, body: { email } }),
  /** Use a sign-in link: 200 sets the session cookie; 401 `link_invalid` for every kind of bad link. */
  verify: (token: string) => send<{ ok: true }>("/auth/magic/verify", { ...pub, body: { token } }),
  me: () => send<Me>("/me", {}),
  /** 204, no body, with or without a session. */
  logout: () => send<void>("/auth/logout", { ...pub, body: {}, noContent: true }),
  /** Every live session of this contact at this organisation, this one included. */
  revokeAll: () => send<{ ok: true; revoked: number }>("/auth/sessions/revoke-all", { body: {} }),
};
