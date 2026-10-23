// The password step with the Turnstile check (M2.4b) [ADM-AUTH-06]: after `turnstile_required` the next attempt resends
// the same client hash with a token and runs Argon2id no second time; a changed email or password hashes again.
import { describe, expect, it, vi } from "vitest";
import { RequestError } from "../api.ts";
import { passwordSignIn } from "./password-sign-in.ts";

const PARAMS = { v: 1, m: 19456, t: 2, p: 1 };
const required = () => new RequestError(401, "turnstile_required", "Verification required");
const wrong = () => new RequestError(401, "invalid_credentials", "Wrong email or password.");

function setup(...answers: (Error | { challenge: string })[]) {
  const salt = vi.fn(async () => ({ salt: "c2FsdA", params: PARAMS }));
  let n = 0;
  const hash = vi.fn(async ({ password }: { password: string }) => ({
    hash: `h(${password})#${++n}`,
    ms: 400,
  }));
  const login = vi.fn(async (_e: string, _h: string, _t?: string) => {
    const a = answers.shift();
    if (!a || a instanceof Error) throw a ?? new Error("no answer");
    return a;
  });
  const onHashed = vi.fn();
  return { s: passwordSignIn({ salt, hash, login, onHashed }), salt, hash, login, onHashed };
}

describe("password step with the Turnstile check [ADM-AUTH-06]", () => {
  it("a normal sign-in hashes once and sends no token", async () => {
    const t = setup({ challenge: "c1" });
    expect(await t.s.attempt("a@example.test", "pw")).toEqual({ kind: "challenge", challenge: "c1" });
    expect(t.hash).toHaveBeenCalledTimes(1);
    expect(t.onHashed).toHaveBeenCalledWith(400);
    expect(t.login).toHaveBeenCalledWith("a@example.test", "h(pw)#1", undefined);
  });

  it("turnstile_required shows the check; the next attempt resends the SAME hash with the token, no second Argon2id run", async () => {
    const t = setup(required(), { challenge: "c2" });
    expect(await t.s.attempt("a@example.test", "pw")).toEqual({ kind: "check_required" });
    expect(await t.s.attempt("a@example.test", "pw", "tok")).toEqual({ kind: "challenge", challenge: "c2" });
    expect(t.salt).toHaveBeenCalledTimes(1);
    expect(t.hash).toHaveBeenCalledTimes(1);
    expect(t.login.mock.calls[1]).toEqual(["a@example.test", "h(pw)#1", "tok"]);
  });

  it("a changed password (forget) or a different email hashes again", async () => {
    const t = setup(required(), wrong(), wrong());
    await t.s.attempt("a@example.test", "pw");
    t.s.forget();
    await t.s.attempt("a@example.test", "pw2", "tok");
    expect(t.hash).toHaveBeenCalledTimes(2);
    expect(t.login.mock.calls[1]?.[1]).toBe("h(pw2)#2");
    await t.s.attempt("b@example.test", "pw2", "tok2");
    expect(t.hash).toHaveBeenCalledTimes(3);
  });

  it("a successful step drops the held hash", async () => {
    const t = setup({ challenge: "c1" }, { challenge: "c2" });
    await t.s.attempt("a@example.test", "pw");
    await t.s.attempt("a@example.test", "pw");
    expect(t.hash).toHaveBeenCalledTimes(2);
  });

  it("other refusals and hashing failures come back as errors for the screen", async () => {
    const t = setup(wrong());
    const r = await t.s.attempt("a@example.test", "pw", "tok");
    expect(r.kind).toBe("error");
    expect((r as { error: RequestError }).error.code).toBe("invalid_credentials");
    const broken = passwordSignIn({
      salt: async () => ({ salt: "s", params: PARAMS }),
      hash: async () => {
        throw new Error("Hashing failed");
      },
      login: async () => ({ challenge: "x" }),
    });
    expect((await broken.attempt("a@example.test", "pw")).kind).toBe("error");
  });
});
