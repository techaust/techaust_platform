// M7.5 C4 and L20: the website Worker's health route and its request line, in workerd.
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("GET /api/health (M7.5 C4)", () => {
  it("names the Worker and its environment, with no D1 and nothing about the caller", async () => {
    const res = await exports.default.fetch("https://web.test/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "web", env: "local" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("only GET: a POST is the JSON 404", async () => {
    const res = await exports.default.fetch("https://web.test/api/health", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("request line (M7.5 L20, NFR-6)", () => {
  const lines = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.startsWith('{"ev":"req"'))
      .map((s) => JSON.parse(s) as Record<string, unknown>);

  it("one line per request with exactly the pattern, the status and f: 1 on the first run only", async () => {
    const spy = vi.spyOn(console, "log");
    await exports.default.fetch("https://web.test/api/geo?x=secret@example.com", { cf: { country: "IN" } });
    await exports.default.fetch("https://web.test/api/geo");
    await exports.default.fetch("https://web.test/api/nope");
    const got = lines(spy);
    expect(got).toHaveLength(3);
    for (const line of got) {
      expect(Object.keys(line).every((k) => ["ev", "r", "s", "f"].includes(k))).toBe(true);
    }
    expect(got[0]).toMatchObject({ r: "/api/geo", s: 200 });
    expect(got[1]).toEqual({ ev: "req", r: "/api/geo", s: 200 });
    expect(got[2]).toMatchObject({ r: "other", s: 404 });
    expect(JSON.stringify(got)).not.toMatch(/secret|example|IN/);
  });

  it("names the form route by its pattern, never the raw path", async () => {
    const spy = vi.spyOn(console, "log");
    await exports.default.fetch("https://web.test/api/forms/contact", { method: "POST" });
    const [line] = lines(spy);
    expect(line?.r).toBe("/api/forms/:kind");
  });
});
