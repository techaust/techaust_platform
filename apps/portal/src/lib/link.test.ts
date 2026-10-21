import { afterEach, describe, expect, it, vi } from "vitest";
import { capturedToken, captureLinkToken, createContinue, forgetToken, takeLinkToken } from "./link.ts";

const TOKEN = "A".repeat(20) + "b_-".repeat(7) + "z".repeat(2); // 43 base64url characters
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const LINK_INVALID = {
  error: { code: "link_invalid", message: "This link has expired or was already used. Request a new link." },
  request_id: "r1",
};

/** A stand-in for the browser's LIVE `location` + `history`: replaceState changes what `location` reads afterwards. */
function page(hash: string, pathname = "/auth/callback", search = "") {
  const loc = { pathname, search, hash };
  const hist = {
    replaceState: vi.fn((_d: unknown, _u: string, url?: string) => {
      const u = new URL(url ?? "", "https://portal.example.test");
      Object.assign(loc, { pathname: u.pathname, search: u.search, hash: u.hash });
    }),
  };
  return { loc, hist };
}

afterEach(() => {
  vi.unstubAllGlobals();
  forgetToken();
});

describe("sign-in link callback: the fragment [POR-01, LD3]", () => {
  it("takes the token from #t= and strips the fragment from the history entry", () => {
    expect(TOKEN).toHaveLength(43);
    const { loc, hist } = page(`#t=${TOKEN}`);
    expect(takeLinkToken(loc, hist)).toBe(TOKEN);
    expect(hist.replaceState).toHaveBeenCalledTimes(1);
    expect(hist.replaceState).toHaveBeenCalledWith(null, "", "/auth/callback");
    expect(loc.hash).toBe("");
  });

  it("keeps the query string but never the fragment", () => {
    const { loc, hist } = page(`#t=${TOKEN}`, "/auth/callback", "?utm=x");
    takeLinkToken(loc, hist);
    expect(hist.replaceState).toHaveBeenCalledWith(null, "", "/auth/callback?utm=x");
  });

  it("strips the fragment BEFORE any request, and capturing sends nothing", () => {
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    const { loc, hist } = page(`#t=${TOKEN}`);
    captureLinkToken(loc, hist);
    expect(capturedToken()).toBe(TOKEN);
    expect(hist.replaceState).toHaveBeenCalledTimes(1);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("a missing, empty or malformed token is null (shown as an expired link, no request), fragment still stripped", () => {
    for (const hash of [
      "",
      "#",
      "#t=",
      "#x=abc",
      `#t=${TOKEN}x`,
      `#t=${TOKEN.slice(1)}`,
      `#t=${TOKEN.slice(1)}=`,
    ]) {
      const { loc, hist } = page(hash);
      expect(takeLinkToken(loc, hist), hash).toBeNull();
      expect(hist.replaceState).toHaveBeenCalledTimes(hash ? 1 : 0);
    }
  });

  it("other pages are left alone", () => {
    const { loc, hist } = page(`#t=${TOKEN}`, "/");
    expect(takeLinkToken(loc, hist)).toBeNull();
    expect(hist.replaceState).not.toHaveBeenCalled();
  });
});

describe("sign-in link callback: Continue [POR-01, POR-02, LD3]", () => {
  it("no POST until Continue is pressed; then exactly one POST with only the token in the body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(200, { ok: true }));
    vi.stubGlobal("fetch", fetchFn);
    const { loc, hist } = page(`#t=${TOKEN}`);
    captureLinkToken(loc, hist);
    const press = createContinue(capturedToken());
    expect(fetchFn).not.toHaveBeenCalled();

    expect(await press()).toEqual({ kind: "signed_in" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/auth/magic/verify");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ token: TOKEN });
    expect(String(url)).not.toContain(TOKEN);
    // The fragment was gone before the request went out.
    expect(hist.replaceState.mock.invocationCallOrder[0]).toBeLessThan(
      fetchFn.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("pressing twice (a double click) still sends one POST", async () => {
    let resolve: (r: Response) => void = () => {};
    const fetchFn = vi.fn().mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetchFn);
    const press = createContinue(TOKEN);
    const a = press();
    const b = press();
    resolve(json(200, { ok: true }));
    expect(await a).toEqual({ kind: "signed_in" });
    expect(await b).toEqual({ kind: "signed_in" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("401 link_invalid is final: never retried, even if Continue is pressed again", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(401, LINK_INVALID));
    vi.stubGlobal("fetch", fetchFn);
    const press = createContinue(TOKEN);
    expect(await press()).toEqual({ kind: "invalid" });
    expect(await press()).toEqual({ kind: "invalid" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("no token: the expired-link result without any request", async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    expect(await createContinue(null)()).toEqual({ kind: "invalid" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("429 carries Retry-After and is final", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        json(429, { error: { code: "rate_limited", message: "x" } }, { "Retry-After": "840" }),
      );
    vi.stubGlobal("fetch", fetchFn);
    const press = createContinue(TOKEN);
    expect(await press()).toEqual({ kind: "rate_limited", retryAfterS: 840 });
    await press();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("a network failure lets the person press again (one POST per press, never automatic)", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal("fetch", fetchFn);
    const press = createContinue(TOKEN);
    expect(await press()).toEqual({ kind: "network" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await press()).toEqual({ kind: "signed_in" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("a server fault shows the request ID", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(json(500, { error: { code: "internal", message: "x" }, request_id: "ray-9" })),
    );
    expect(await createContinue(TOKEN)()).toEqual({ kind: "error", requestId: "ray-9" });
  });
});
