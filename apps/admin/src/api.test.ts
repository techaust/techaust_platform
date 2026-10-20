import { afterEach, describe, expect, it, vi } from "vitest";
import { api, onStepUpRequired, onUnauthenticated, RequestError } from "./api.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const STEP_UP = { error: { code: "step_up_required", message: "Confirm first" }, request_id: "r1" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API client: step-up and expired sessions [ADM-AUTH-08, ADM-AUTH-05]", () => {
  it("step_up_required opens the dialog, then sends the same request once more", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json(403, STEP_UP))
      .mockResolvedValueOnce(json(201, { link: "https://admin.example.test/invite#t=x", expires_at: 1 }));
    vi.stubGlobal("fetch", fetchFn);
    const handler = vi.fn(async () => true);
    const off = onStepUpRequired(handler);
    const r = await api.invite("new@example.test", "staff");
    off();
    expect(r.expires_at).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0]?.[0]).toBe("/api/v1/users/invites");
    expect(fetchFn.mock.calls[1]?.[1]).toEqual(fetchFn.mock.calls[0]?.[1]);
    expect(JSON.parse(fetchFn.mock.calls[1]?.[1].body)).toEqual({ email: "new@example.test", role: "staff" });
  });

  it("a cancelled step-up sends nothing more and reports that nothing changed", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(json(403, STEP_UP));
    vi.stubGlobal("fetch", fetchFn);
    const off = onStepUpRequired(async () => false);
    await expect(api.deactivate("u1")).rejects.toMatchObject({ code: "step_up_cancelled", status: 403 });
    off();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("a wrong step-up code (400 invalid_code) is an error for the dialog, not a retry or a sign-out", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        json(400, { error: { code: "invalid_code", message: "That code didn't work." } }),
      );
    vi.stubGlobal("fetch", fetchFn);
    const unauth = vi.fn();
    const off = onUnauthenticated(unauth);
    const e = await api.stepUp("123456").catch((x: unknown) => x);
    off();
    expect(e).toBeInstanceOf(RequestError);
    expect((e as RequestError).code).toBe("invalid_code");
    expect(unauth).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("401 unauthenticated on a signed-in route ends the session in the app; on sign-in routes it doesn't", async () => {
    const unauth = vi.fn();
    const off = onUnauthenticated(unauth);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(401, { error: { code: "unauthenticated", message: "Sign in" } })),
    );
    await expect(api.sessions()).rejects.toBeInstanceOf(RequestError);
    expect(unauth).toHaveBeenCalledTimes(1);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(401, { error: { code: "invalid_credentials", message: "Invalid" } })),
    );
    await expect(api.totp("c", "123456")).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(unauth).toHaveBeenCalledTimes(1);
    off();
  });

  it("the invite screen sends the name with the password hash [ADM-AUTH-07]", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(json(200, { totpUri: "otpauth://x", secret: "S", challenge: "c" }));
    vi.stubGlobal("fetch", fetchFn);
    await api.inviteFinish("t".repeat(43), "h".repeat(43), "Asha Verma");
    expect(JSON.parse(fetchFn.mock.calls[0]?.[1].body)).toEqual({
      token: "t".repeat(43),
      clientHash: "h".repeat(43),
      name: "Asha Verma",
    });
  });

  it("a network failure reads as a plain connection message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.me()).rejects.toMatchObject({ code: "network", status: 0 });
  });
});
