// The password step of sign-in [ADM-AUTH-01, ADM-AUTH-06], without the screen: salt, Argon2id in the browser, then
// /auth/login. M2.4b: after 3 failures the server answers 401 `turnstile_required` without checking anything, and the
// screen shows the Turnstile check. The next attempt sends the SAME client hash with a token: the hash is held here, in
// memory only (never in storage, never in React state), for the email it was made for, so a second Argon2id run
// isn't needed. The screen calls `forget()` whenever the email or the password changes, and a successful step drops it.
import type { ArgonParams } from "@techaust/auth";
import { RequestError } from "../api.ts";

export type PasswordAttempt =
  | { kind: "challenge"; challenge: string }
  /** The server wants the Turnstile check (show it, or give the visitor a fresh one) before it counts this attempt. */
  | { kind: "check_required" }
  | { kind: "error"; error: unknown };

export type PasswordSignInDeps = {
  salt: (email: string) => Promise<{ salt: string; params: ArgonParams }>;
  hash: (req: {
    password: string;
    salt: string;
    params: ArgonParams;
  }) => Promise<{ hash: string; ms: number }>;
  login: (email: string, clientHash: string, turnstile?: string) => Promise<{ challenge: string }>;
  /** How long Argon2id took (the screen shows it). */
  onHashed?: (ms: number) => void;
};

export function passwordSignIn(deps: PasswordSignInDeps) {
  let held: { email: string; hash: string } | null = null;
  return {
    /** Drop the held hash (the email or the password changed, or the person started again). */
    forget() {
      held = null;
    },
    /** One attempt. `turnstile`: the widget's token, once the check is on the screen. */
    async attempt(email: string, password: string, turnstile?: string): Promise<PasswordAttempt> {
      try {
        if (!held || held.email !== email) {
          const { salt, params } = await deps.salt(email);
          const h = await deps.hash({ password, salt, params });
          deps.onHashed?.(h.ms);
          held = { email, hash: h.hash };
        }
        const { challenge } = await deps.login(email, held.hash, turnstile);
        held = null;
        return { kind: "challenge", challenge };
      } catch (error) {
        if (error instanceof RequestError && error.code === "turnstile_required")
          return { kind: "check_required" };
        return { kind: "error", error };
      }
    },
  };
}
