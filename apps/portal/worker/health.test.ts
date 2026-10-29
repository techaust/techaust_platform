import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("portal API", () => {
  it("answers /api/v1/health", async () => {
    const res = await exports.default.fetch("https://portal.example/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "portal", env: "local" });
  });
});

describe("security headers on API answers [A1-4, docs/08 3.1]", () => {
  it.each([
    ["an answer", "https://portal.example/api/v1/health", 200],
    ["a refusal", "https://portal.example/api/v1/me", 401],
  ])(
    "%s: HSTS for a year with subdomains, the Permissions-Policy and Hono's defaults",
    async (_, url, status) => {
      const res = await exports.default.fetch(url);
      expect(res.status).toBe(status);
      expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
      expect(res.headers.get("permissions-policy")).toBe(
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      );
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
      expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    },
  );
});
