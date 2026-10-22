// /api/* Worker tests, in workerd (WEB-G-06 geo default, WEB-G-12 headers on API answers).
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// `cf` is what Cloudflare's edge sets on the request; locally we set it ourselves.
function geo(country?: string) {
  const req = new Request(
    "https://web.test/api/geo",
    country === undefined ? undefined : { cf: { country } },
  );
  return exports.default.fetch(req);
}

describe("GET /api/geo (WEB-G-06)", () => {
  it("India gets INR", async () => {
    const res = await geo("IN");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ currency: "INR" });
  });

  it.each(["US", "GB", "AE", "AU", "SG", "XX"])("%s gets USD", async (country) => {
    expect(await (await geo(country)).json()).toEqual({ currency: "USD" });
  });

  it("a missing country gets USD", async () => {
    expect(await (await geo()).json()).toEqual({ currency: "USD" });
  });

  it("answers only with the currency (no country, no IP)", async () => {
    expect(Object.keys((await (await geo("IN")).json()) as object)).toEqual(["currency"]);
  });

  it("is private and never stored by a shared cache", async () => {
    const cc = (await geo("IN")).headers.get("cache-control") ?? "";
    expect(cc).toContain("private");
    expect(cc).toContain("no-store");
  });
});

describe("API response headers (WEB-G-12)", () => {
  it("carries the security headers", async () => {
    const h = (await geo("IN")).headers;
    expect(h.get("strict-transport-security")).toContain("max-age=31536000");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(h.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(h.get("permissions-policy")).toContain("camera=()");
    const csp = h.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'none'");
  });

  it("unknown API paths are 404 JSON", async () => {
    const res = await exports.default.fetch("https://web.test/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "not_found" });
  });
});
