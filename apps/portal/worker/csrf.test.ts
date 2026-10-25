// CSRF on the portal API [05 §7.1, POR-02]: the shared corpus (packages/auth/test/csrf-corpus.ts), run through the
// portal's own middleware and error bodies. A refused request does nothing: no D1 call and no access row.
import { describe, expect, it } from "vitest";
import { CSRF_CORPUS } from "../../../packages/auth/test/csrf-corpus.ts";
import { fixtures } from "./fixtures.ts";
import { bodyOf, counted, countOf, nextIp, ORIGIN, send, sessionFor } from "./test-helpers.ts";

const APP_ORIGIN = "https://app.example";

/** The case as a request to the portal: the corpus's app origin is the test origin. */
async function run(c: (typeof CSRF_CORPUS)[number], cookie?: string) {
  const method = c.input.method ?? "POST";
  const headers: Record<string, string> = { "CF-Connecting-IP": nextIp() };
  const origin = c.input.origin === undefined ? APP_ORIGIN : c.input.origin;
  if (origin !== null) headers.Origin = origin.replace(APP_ORIGIN, ORIGIN);
  if (c.input.secFetchSite) headers["Sec-Fetch-Site"] = c.input.secFetchSite;
  const contentType = c.input.contentType === undefined ? "application/json" : c.input.contentType;
  if (contentType !== null) headers["Content-Type"] = contentType;
  if (cookie) headers.Cookie = cookie;
  const hasBody = c.input.hasBody ?? true;
  const safe = ["GET", "HEAD", "OPTIONS"].includes(method);
  const counter = counted();
  const res = await send(
    `${ORIGIN}/api/v1/${safe ? "health" : "auth/logout"}`,
    { method, headers, body: hasBody && !safe ? "{}" : null },
    counter.env,
  );
  return { res, calls: counter.calls() };
}

describe("the shared CSRF corpus, through the portal [05 §7.1]", () => {
  for (const c of CSRF_CORPUS) {
    it(`${c.name}: ${c.verdict}`, async () => {
      const before = await countOf("access_log");
      const { res, calls } = await run(c);
      if (c.verdict === "cross_site") {
        expect(res.status).toBe(403);
        expect(await bodyOf(res)).toEqual({ error: { code: "forbidden", message: "Request refused" } });
        expect(calls).toBe(0);
      } else if (c.verdict === "not_json") {
        expect(res.status).toBe(415);
        expect(await bodyOf(res)).toEqual({
          error: { code: "unsupported_media_type", message: "Send JSON" },
        });
        expect(calls).toBe(0);
      } else {
        expect([403, 415]).not.toContain(res.status);
      }
      expect(await countOf("access_log")).toBe(before); // no access row for any of them (no cookie)
    });
  }
});

describe("the portal stays JSON-only (M3.4: the admin upload exception does not reach it)", () => {
  it("an octet-stream body is a 415 on a portal POST and does nothing", async () => {
    const counter = counted();
    const res = await send(
      `${ORIGIN}/api/v1/auth/logout`,
      {
        method: "POST",
        headers: { "CF-Connecting-IP": nextIp(), Origin: ORIGIN, "Content-Type": "application/octet-stream" },
        body: new Uint8Array([1, 2, 3]),
      },
      counter.env,
    );
    expect(res.status).toBe(415);
    expect(counter.calls()).toBe(0);
  });
});

describe("CSRF on the portal's own routes [POR-02]", () => {
  it("a cross-origin POST to every unsafe route is a 403 and does nothing, even with a valid session", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    for (const path of [
      "/auth/magic",
      "/auth/magic/verify",
      "/auth/logout",
      "/auth/sessions/revoke-all",
      "/t/document",
    ]) {
      const counter = counted();
      const res = await send(
        `${ORIGIN}/api/v1${path}`,
        {
          method: "POST",
          headers: {
            Origin: "https://evil.example",
            "Content-Type": "application/json",
            Cookie: s.cookie,
            "CF-Connecting-IP": nextIp(),
          },
          body: JSON.stringify({ email: "x@example.test", token: "t" }),
        },
        counter.env,
      );
      expect(res.status, path).toBe(403);
      expect(counter.calls(), path).toBe(0);
    }
    expect((await send(`${ORIGIN}/api/v1/me`, { headers: { Cookie: s.cookie } }, counted().env)).status).toBe(
      200,
    ); // the session survived
  });

  it("a same-origin JSON POST and a Sec-Fetch-Site: same-origin POST without Origin pass", async () => {
    const withOrigin = await send(
      `${ORIGIN}/api/v1/auth/logout`,
      { method: "POST", headers: { Origin: ORIGIN } },
      counted().env,
    );
    expect(withOrigin.status).toBe(204);
    const fetchSite = await send(
      `${ORIGIN}/api/v1/auth/logout`,
      { method: "POST", headers: { "Sec-Fetch-Site": "same-origin" } },
      counted().env,
    );
    expect(fetchSite.status).toBe(204);
  });

  it("a body over 16 KB is refused (413, the generic body) before anything runs", async () => {
    const counter = counted();
    const res = await send(
      `${ORIGIN}/api/v1/auth/magic`,
      {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": nextIp() },
        body: JSON.stringify({ email: "a@example.test", padding: "x".repeat(17 * 1024) }),
      },
      counter.env,
    );
    expect(res.status).toBe(413);
    expect(await bodyOf(res)).toEqual({
      error: { code: "bad_request", message: "Check the form and try again" },
    });
    expect(counter.calls()).toBe(0);
  });
});
