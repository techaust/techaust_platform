import { afterEach, describe, expect, it, vi } from "vitest";
import { api, onUnauthenticated, RequestError } from "./api.ts";
import { COPY, checkFailed, emailProblem, linkOutcome, waitText } from "./copy.ts";

/** A stand-in Turnstile token (the widget's real ones are opaque strings). */
const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const RATE_LIMITED = { error: { code: "rate_limited", message: "Too many requests." }, request_id: "r1" };

afterEach(() => {
  vi.unstubAllGlobals();
});

async function outcomeOf(p: Promise<unknown>) {
  try {
    await p;
    return linkOutcome();
  } catch (e) {
    return linkOutcome(e);
  }
}

describe("request a sign-in link [POR-01]", () => {
  it("200 shows the one generic sentence, whatever the email", async () => {
    const fetchFn = vi.fn().mockImplementation(async () => json(200, { ok: true, request_id: "r" }));
    vi.stubGlobal("fetch", fetchFn);
    for (const email of ["finance.a@example.test", "nobody@example.test"]) {
      expect(await outcomeOf(api.requestLink(email, TOKEN))).toEqual({ kind: "sent" });
    }
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0]?.[0]).toBe("/api/v1/auth/magic");
    expect(JSON.parse(fetchFn.mock.calls[0]?.[1].body)).toEqual({
      email: "finance.a@example.test",
      turnstile: TOKEN,
    });
    expect(COPY.signIn.sent).toBe(
      "If this email can use the portal, we've sent a sign-in link. It works once, for 15 minutes.",
    );
  });

  it("429 reads as a rate limit with the wait from Retry-After, and is not retried", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(429, RATE_LIMITED, { "Retry-After": "900" }));
    vi.stubGlobal("fetch", fetchFn);
    const o = await outcomeOf(api.requestLink("finance.a@example.test", TOKEN));
    // 07-G §3 (M2.4b): an earlier link still works.
    expect(o).toEqual({
      kind: "rate_limited",
      text: "Too many link requests. If a link already arrived, it still works for 15 minutes. Otherwise wait 15 minutes, then try again.",
      more: COPY.signIn.rateLimitedMore,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("400 turnstile_failed reads as the 07-G check line, not as a server fault, and is not retried [M2.4b]", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      json(400, {
        error: { code: "turnstile_failed", message: "Verification failed. Try again." },
        request_id: "r2",
      }),
    );
    vi.stubGlobal("fetch", fetchFn);
    expect(await outcomeOf(api.requestLink("finance.a@example.test", TOKEN))).toEqual({
      kind: "check_failed",
      text: "We couldn't confirm the check. Please try it again, then request your link.",
    });
    expect(checkFailed()).toEqual({ kind: "check_failed", text: COPY.signIn.checkFailed });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("the wait is rounded up to whole minutes; an hour-long lock reads as about an hour", () => {
    expect(waitText(null)).toBe("a minute");
    expect(waitText(30)).toBe("a minute");
    expect(waitText(61)).toBe("2 minutes");
    expect(waitText(900)).toBe("15 minutes");
    expect(waitText(3600)).toBe("about an hour");
  });

  it("a network failure and a server fault read differently; the fault carries its reference", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await outcomeOf(api.requestLink("a@example.test", TOKEN))).toEqual({
      kind: "error",
      text: COPY.network,
      requestId: null,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(json(500, { error: { code: "internal", message: "x" }, request_id: "ray-1" })),
    );
    expect(await outcomeOf(api.requestLink("a@example.test", TOKEN))).toEqual({
      kind: "error",
      text: COPY.server,
      requestId: "ray-1",
    });
  });

  it("the form checks the shape before sending: empty and incomplete addresses say what to do", () => {
    expect(emailProblem("")).toBe(COPY.signIn.empty);
    expect(emailProblem("   ")).toBe(COPY.signIn.empty);
    expect(emailProblem("finance.a")).toBe(COPY.signIn.invalid);
    expect(emailProblem("finance.a@example")).toBe(COPY.signIn.invalid);
    expect(emailProblem(" finance.a@example.test ")).toBeNull();
  });
});

describe("own session [POR-02]", () => {
  it("sign-out: 204 with no body is success (never parsed as JSON)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchFn);
    await expect(api.logout()).resolves.toBeUndefined();
    expect(fetchFn.mock.calls[0]?.[0]).toBe("/api/v1/auth/logout");
    expect(fetchFn.mock.calls[0]?.[1].method).toBe("POST");
  });

  it("sign-out that can't reach the server fails (the screen says you're still signed in)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.logout()).rejects.toMatchObject({ code: "network", status: 0 });
  });

  it("GET /me returns the contact and the organisation", async () => {
    const me = {
      contact: { name: "Finance A (sample)", email: "finance.a@example.test" },
      organisation: { displayName: "Sample Client A (sample)" },
      canSeeFinance: true,
    };
    const fetchFn = vi.fn().mockResolvedValue(json(200, me));
    vi.stubGlobal("fetch", fetchFn);
    expect(await api.me()).toEqual(me);
    expect(fetchFn.mock.calls[0]?.[0]).toBe("/api/v1/me");
    expect(fetchFn.mock.calls[0]?.[1].method).toBe("GET");
  });

  it("401 unauthenticated on a signed-in call ends the session in the app; a refused link doesn't", async () => {
    const unauth = vi.fn();
    const off = onUnauthenticated(unauth);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(401, { error: { code: "unauthenticated", message: "Sign in" } })),
    );
    await expect(api.revokeAll()).rejects.toBeInstanceOf(RequestError);
    expect(unauth).toHaveBeenCalledTimes(1);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(401, { error: { code: "link_invalid", message: "Expired" } })),
    );
    await expect(api.verify("t".repeat(43))).rejects.toMatchObject({ code: "link_invalid", status: 401 });
    expect(unauth).toHaveBeenCalledTimes(1);
    off();
  });

  it("sign out of all devices posts once to revoke-all", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(200, { ok: true, revoked: 2 }));
    vi.stubGlobal("fetch", fetchFn);
    expect(await api.revokeAll()).toEqual({ ok: true, revoked: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe("/api/v1/auth/sessions/revoke-all");
  });

  it("the confirm text names the organisation (revoke-all is per contact at one organisation)", () => {
    expect(COPY.home.confirmBody("Sample Client A (sample)")).toContain("Sample Client A (sample)");
  });
});
