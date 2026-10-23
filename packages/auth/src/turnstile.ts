// Turnstile server-side check (FRM-02, ADM-AUTH-06, POR-01): one `verifyTurnstile` shared by the website forms, the staff
// sign-in and the portal sign-in. The browser sends a token; the Worker asks Cloudflare's siteverify whether it is real,
// fresh (a token works once) and for THIS surface (the `action` the page asked for) on THIS host (`hostname`).
// Everything fails closed: no token, an over-long token, a network error, a non-2xx answer or a non-JSON body is `false`.
// The timeout signal is created inside the call, never at module level (a timer outside a request throws in Workers).

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** A Turnstile token is at most 2,048 characters (Cloudflare's documented limit). */
export const MAX_TOKEN_LENGTH = 2048;
const TIMEOUT_MS = 5_000;

export type VerifyTurnstile = {
  /** The widget's secret (`TURNSTILE_SECRET`). Empty counts as not configured: refused without a fetch. */
  secret: string;
  /** The `cf-turnstile-response` value the browser sent. */
  token: string;
  /** The visitor's address, sent to Cloudflare as `remoteip` (the raw header, never an HMAC or a /64). Empty: not sent. */
  remoteip: string;
  /** The action this surface's widget asks for (`contact`, `quote`, `admin_login`, `portal_link`). */
  action: string;
  /** The hosts this deployment's pages may run on (`TURNSTILE_HOSTNAMES`, comma-separated). */
  hostnames: string;
  /**
   * Local development: Cloudflare's always-pass TEST keys do not echo our action and hostname, so only `success` is
   * checked. Every real environment checks both.
   */
  local: boolean;
};

type SiteverifyAnswer = { success?: unknown; action?: unknown; hostname?: unknown };

/** True only for a real, unused token issued for `action` on one of `hostnames`. */
export async function verifyTurnstile(o: VerifyTurnstile): Promise<boolean> {
  if (!o.secret || o.token.length === 0 || o.token.length > MAX_TOKEN_LENGTH) return false;
  try {
    const form = new URLSearchParams({ secret: o.secret, response: o.token });
    if (o.remoteip) form.set("remoteip", o.remoteip);
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: form,
    });
    if (!res.ok) return false;
    const r = (await res.json()) as SiteverifyAnswer;
    if (r.success !== true) return false;
    if (o.local) return true;
    const hosts = o.hostnames
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    return r.action === o.action && typeof r.hostname === "string" && hosts.includes(r.hostname);
  } catch {
    return false; // fail closed
  }
}
