// PayPal's OAuth access token for the finance Worker (M6.4; run file C "Token", Step 0.4 row 1: `POST /v1/oauth2/token`, Basic auth of the client id and secret,
// `grant_type=client_credentials`, renewed at `expires_in`). One cache entry per isolate `{origin, keyHash, token, expiresAt}`: it holds no request state, only the
// token PayPal gave this Worker's own keys, and it is dropped whenever the origin or the keys change (the SHA-256 of both, never the keys themselves) or a call
// answers 401. Kept until `expires_in` minus 300 s. The token, the id and the secret are never logged.
import { sha256Hex } from "@techaust/core/hash";

/** Renew this long before PayPal's `expires_in` runs out. */
export const TOKEN_MARGIN_MS = 300_000;
const TOKEN_TIMEOUT_MS = 8_000;

type Entry = { origin: string; keyHash: string; token: string; expiresAt: number };
let cached: Entry | null = null;
/** How many tokens this isolate minted (tests: a cached token makes no second call). */
let minted = 0;

export type TokenResult =
  | { ok: true; token: string }
  | { ok: false; code: "network" | "forbidden" | "bad_answer" | "unconfigured" };

/** Drops the cached token (a 401 from PayPal, or a test). */
export function dropPayPalToken(): void {
  cached = null;
}

/** Test-only: the number of tokens minted by this isolate. */
export const payPalTokensMinted = (): number => minted;

const keyHashOf = (origin: string, clientId: string, clientSecret: string): Promise<string> =>
  sha256Hex(`${origin}\n${clientId}\n${clientSecret}`);

/** The access token for `origin` with these keys: the cached one while it lasts, else a new one. Never throws. */
export async function payPalToken(
  k: { origin: string; clientId: string; clientSecret: string },
  f: typeof fetch,
  now = Date.now(),
  /** M6.4 (L31): false only for the start-up dry run's made-up transport (global scope refuses timers, so no `AbortSignal.timeout`). */
  timeouts = true,
): Promise<TokenResult> {
  const keyHash = await keyHashOf(k.origin, k.clientId, k.clientSecret);
  if (cached && cached.origin === k.origin && cached.keyHash === keyHash && cached.expiresAt > now)
    return { ok: true, token: cached.token };
  // Review part 1, finding 10: keys `btoa` can't encode (outside Latin-1) are a configuration fault, never a network one, and never thrown.
  let basic: string;
  try {
    basic = btoa(`${k.clientId}:${k.clientSecret}`);
  } catch {
    return { ok: false, code: "unconfigured" };
  }
  let res: Response;
  try {
    res = await f(`${k.origin}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
      ...(timeouts ? { signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS) } : {}),
    });
  } catch {
    return { ok: false, code: "network" };
  }
  if (res.status >= 500 || res.status === 429) {
    await res.body?.cancel();
    return { ok: false, code: "network" };
  }
  if (res.status !== 200) {
    await res.body?.cancel();
    return { ok: false, code: res.status === 401 || res.status === 403 ? "forbidden" : "bad_answer" };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, code: "bad_answer" };
  }
  const t = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const token =
    typeof t.access_token === "string" && /^[\x21-\x7e]{1,4096}$/.test(t.access_token)
      ? t.access_token
      : null;
  const life =
    typeof t.expires_in === "number" && Number.isSafeInteger(t.expires_in) && t.expires_in > 0
      ? t.expires_in
      : null;
  if (!token || life === null) return { ok: false, code: "bad_answer" };
  minted++;
  cached = { origin: k.origin, keyHash, token, expiresAt: now + life * 1000 - TOKEN_MARGIN_MS };
  return { ok: true, token };
}
