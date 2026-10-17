import type { ArgonParams } from "@techaust/auth";
import type { HashRequest, HashResponse } from "./hash.worker.ts";

export type User = { name: string; email: string; role: string };
type ApiError = { error: { code: string; message: string } };

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as T | ApiError;
  if (!res.ok) {
    const e = (data as ApiError).error ?? { code: "network", message: "Something went wrong. Try again." };
    throw new RequestError(res.status, e.code, e.message);
  }
  return data as T;
}

export const api = {
  me: () => call<{ user: User }>("/me"),
  salt: (email: string) => call<{ salt: string; params: ArgonParams }>("/salt", { email }),
  login: (email: string, clientHash: string) => call<{ challenge: string }>("/login", { email, clientHash }),
  totp: (challenge: string, code: string) => call<{ user: User }>("/totp", { challenge, code }),
  logout: () => call<{ ok: true }>("/logout", {}),
  inviteStart: (token: string) =>
    call<{ email: string; salt: string; params: ArgonParams }>("/invite/start", { token }),
  inviteFinish: (token: string, clientHash: string) =>
    call<{ totpUri: string; secret: string; challenge: string }>("/invite/finish", { token, clientHash }),
  inviteTotp: (challenge: string, code: string) => call<{ user: User }>("/invite/totp", { challenge, code }),
};

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
