// The typed client for the admin API (apps/admin/worker). Every error body is `{ error: { code, message },
// request_id }`. Two codes are handled here for every caller:
// - `step_up_required` (403): the step-up dialog opens; on success the same request is sent once more.
// - `unauthenticated` (401) on a signed-in route: the session has ended, so the app goes back to sign-in.
import type { ArgonParams } from "@techaust/auth";
import type { Role } from "@techaust/core/permissions";
import type { HashRequest, HashResponse } from "./hash.worker.ts";

export type User = { name: string; email: string; role: Role };
export type Me = { user: User; stepUpUntil: number | null };
export type Session = {
  id: string;
  created_at: number;
  last_seen_at: number;
  ip: string | null;
  user_agent: string | null;
  current: boolean;
};
export type StaffMember = {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: "invited" | "active" | "deactivated";
  last_login_at: number | null;
  created_at: number;
};
export type Invite = {
  token_hash: string;
  email: string;
  role: Role;
  invited_by: string | null;
  expires_at: number;
  created_at: number;
};
export type InviteLink = { link: string; expires_at: number };

type ApiErrorBody = { error?: { code: string; message: string }; request_id?: string };

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
  ) {
    super(message);
  }
}

/** What the step-up dialog answers: true once a fresh code was accepted, false if the person cancelled. */
type StepUpHandler = () => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;
let unauthenticatedHandler: (() => void) | null = null;

/** The step-up dialog registers itself here (one per app). Returns the unregister function. */
export function onStepUpRequired(handler: StepUpHandler) {
  stepUpHandler = handler;
  return () => {
    if (stepUpHandler === handler) stepUpHandler = null;
  };
}

/** The session provider registers itself here: a signed-in call answered 401 means the session has ended. */
export function onUnauthenticated(handler: () => void) {
  unauthenticatedHandler = handler;
  return () => {
    if (unauthenticatedHandler === handler) unauthenticatedHandler = null;
  };
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Options = { method?: Method; body?: unknown; signedIn?: boolean };

const NETWORK = "Couldn't reach the server. Check your connection and try again.";

async function send<T>(path: string, { method, body, signedIn = true }: Options): Promise<T> {
  const m: Method = method ?? (body === undefined ? "GET" : "POST");
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: m,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new RequestError(0, "network", NETWORK);
  }
  const data = (await res.json().catch(() => ({}))) as T & ApiErrorBody;
  if (res.ok) return data;
  const e = data.error ?? { code: "network", message: NETWORK };
  const error = new RequestError(res.status, e.code, e.message, data.request_id ?? null);
  if (signedIn && res.status === 401 && e.code === "unauthenticated") unauthenticatedHandler?.();
  throw error;
}

/** One request; if it needs a fresh step-up, ask for it and send the same request once more. */
export async function request<T>(path: string, options: Options = {}): Promise<T> {
  try {
    return await send<T>(path, options);
  } catch (e) {
    if (!(e instanceof RequestError) || e.code !== "step_up_required" || !stepUpHandler) throw e;
    const confirmed = await stepUpHandler();
    if (!confirmed) throw new RequestError(403, "step_up_cancelled", "Cancelled. Nothing was changed.");
    return send<T>(path, options);
  }
}

const pub = { signedIn: false } as const;

export const api = {
  // Sign-in (public)
  salt: (email: string) =>
    request<{ salt: string; params: ArgonParams }>("/auth/salt", { ...pub, body: { email } }),
  /**
   * `turnstile`: only once the server has asked for the check (401 `turnstile_required`, after 3 failures; M2.4b,
   * ADM-AUTH-06). A normal sign-in sends none.
   */
  login: (email: string, clientHash: string, turnstile?: string) =>
    request<{ challenge: string }>("/auth/login", {
      ...pub,
      body: turnstile ? { email, clientHash, turnstile } : { email, clientHash },
    }),
  totp: (challenge: string, code: string) =>
    request<{ user: User }>("/auth/totp", { ...pub, body: { challenge, code } }),
  recovery: (challenge: string, code: string) =>
    request<{ user: User }>("/auth/recovery", { ...pub, body: { challenge, code } }),
  logout: () => request<{ ok: true }>("/auth/logout", { ...pub, body: {} }),

  // Invite acceptance (public)
  inviteStart: (token: string) =>
    request<{ email: string; salt: string; params: ArgonParams }>("/auth/invite/start", {
      ...pub,
      body: { token },
    }),
  inviteFinish: (token: string, clientHash: string, name: string) =>
    request<{ totpUri: string; secret: string; challenge: string }>("/auth/invite/finish", {
      ...pub,
      body: { token, clientHash, name },
    }),
  inviteTotp: (challenge: string, code: string) =>
    request<{ user: User; recoveryCodes: string[] }>("/auth/invite/totp", {
      ...pub,
      body: { challenge, code },
    }),

  // The signed-in member's own account
  me: () => request<Me>("/auth/me"),
  stepUp: (code: string) => send<{ ok: true; stepUpUntil: number }>("/auth/step-up", { body: { code } }),
  sessions: () => request<{ sessions: Session[]; recovery_codes_remaining: number }>("/auth/sessions"),
  revokeSession: (id: string) =>
    request<{ ok: true }>(`/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  revokeAllMine: () => request<{ ok: true }>("/auth/sessions/revoke-all", { body: {} }),
  regenerateRecoveryCodes: () =>
    request<{ recoveryCodes: string[] }>("/auth/recovery/regenerate", { body: {} }),

  // Staff and invites (owner)
  users: () => request<{ users: StaffMember[] }>("/users"),
  invites: () => request<{ invites: Invite[] }>("/users/invites"),
  invite: (email: string, role: Role) => request<InviteLink>("/users/invites", { body: { email, role } }),
  revokeInvite: (tokenHash: string) =>
    request<{ ok: true }>(`/users/invites/${encodeURIComponent(tokenHash)}/revoke`, { body: {} }),
  changeRole: (id: string, role: Role) =>
    request<{ ok: true; changed: boolean }>(`/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { role },
    }),
  deactivate: (id: string) =>
    request<{ ok: true }>(`/users/${encodeURIComponent(id)}/deactivate`, { body: {} }),
  resetTwoStep: (id: string) =>
    request<InviteLink>(`/users/${encodeURIComponent(id)}/reset-2fa`, { body: {} }),
  revokeAllStaff: () => request<{ ok: true }>("/users/sessions/revoke-all", { body: {} }),
};

/** A message to show for any failure: the server's own words, or a plain network message. */
export const errorText = (e: unknown) => (e instanceof RequestError ? e.message : NETWORK);

/** Hash a password in a Web Worker. Resolves with the client hash and how long Argon2id took. */
export function hashPassword(req: HashRequest): Promise<{ hash: string; ms: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./hash.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<HashResponse>) => {
      worker.terminate();
      if (e.data.ok) resolve({ hash: e.data.hash, ms: e.data.ms });
      else reject(new Error("Hashing failed"));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("Hashing failed"));
    };
    worker.postMessage(req);
  });
}
