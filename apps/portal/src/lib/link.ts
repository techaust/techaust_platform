// The sign-in link's last step [POR-01, LD3]. The link is `…/auth/callback#t=<token>`: the fragment never reaches a
// server or a log. `captureLinkToken` runs once in main.tsx BEFORE the app renders or sends anything: it reads the
// token, then removes the fragment from the address bar and the history entry at once, so it can't be bookmarked,
// shared or picked up from history. The token stays in memory only.
//
// Nothing is sent until the person presses "Continue to the portal" (`createContinue`): an email scanner that opens
// links (and even runs their JavaScript) never presses the button, so it can't use the link up. One press sends one
// POST; a 401 is final (the link is used or expired) and is never retried.
import { api, RequestError } from "../api.ts";

export const CALLBACK_PATH = "/auth/callback";

/** A token is exactly 43 base64url characters (32 random bytes); anything else can't be a link of ours. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

type Loc = { pathname: string; search: string; hash: string };
type Hist = { replaceState: (data: unknown, unused: string, url?: string) => void };

/**
 * Read `#t=` and strip the fragment from the current history entry. Returns the token, or null when there is none
 * or it isn't the right shape (that reads the same as an expired link, and costs no request).
 */
export function takeLinkToken(loc: Loc, hist: Hist): string | null {
  if (loc.pathname !== CALLBACK_PATH) return null;
  if (loc.hash) hist.replaceState(null, "", loc.pathname + loc.search);
  const t = new URLSearchParams(loc.hash.replace(/^#/, "")).get("t");
  return t && TOKEN.test(t) ? t : null;
}

let captured: string | null = null;

/** main.tsx calls this once, before the router is created. */
export function captureLinkToken(loc: Loc = location, hist: Hist = history) {
  captured = takeLinkToken(loc, hist);
}

/** The token captured at load (null if none). Forgotten once it has been sent successfully. */
export const capturedToken = () => captured;
export const forgetToken = () => {
  captured = null;
};

export type ContinueResult =
  | { kind: "signed_in" }
  | { kind: "invalid" }
  | { kind: "rate_limited"; retryAfterS: number | null }
  | { kind: "network" }
  | { kind: "error"; requestId: string | null };

/**
 * The "Continue" action for one token. Pressing twice while a request is in flight sends nothing more (the same
 * promise comes back). After a network failure or a server fault (5xx) the person may press again; a 401 or a 429
 * is final and repeated presses return it without a request.
 */
export function createContinue(token: string | null, verify: (t: string) => Promise<unknown> = api.verify) {
  let pending: Promise<ContinueResult> | null = null;
  return function press(): Promise<ContinueResult> {
    if (!token) return Promise.resolve({ kind: "invalid" });
    if (pending) return pending;
    pending = verify(token).then(
      (): ContinueResult => ({ kind: "signed_in" }),
      (e: unknown): ContinueResult => {
        if (!(e instanceof RequestError) || e.code === "network") {
          pending = null; // nothing reached the server's answer: a fresh press may try again
          return { kind: "network" };
        }
        if (e.status === 401) return { kind: "invalid" };
        if (e.status === 429) return { kind: "rate_limited", retryAfterS: e.retryAfterS };
        pending = null; // a server fault: the person may press again
        return { kind: "error", requestId: e.requestId };
      },
    );
    return pending;
  };
}
