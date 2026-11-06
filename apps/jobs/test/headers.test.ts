// M7.5 L11 (jobs part) and D2: the jobs Worker's answers carry the website's security headers (HSTS one year, Permissions-Policy) and the API CSP
// `default-src 'none'; frame-ancestors 'none'`, set only when the handler set none.
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const CSP = "default-src 'none'; frame-ancestors 'none'";

describe("jobs response headers (M7.5 D2)", () => {
  it.each([
    ["GET", "/healthz", 200],
    ["GET", "/nope", 404],
    ["GET", "/u", 200],
    ["POST", "/razorpay", 400],
    ["POST", "/stripe", 400],
    ["POST", "/paypal", 400],
    ["POST", "/ses", 401],
  ])(
    "%s %s (%i) carries HSTS for a year, Permissions-Policy, nosniff and the API CSP",
    async (method, path, status) => {
      const res = await exports.default.fetch(`https://jobs.test${path}`, {
        method,
        ...(method === "POST" ? { body: "{}", headers: { "content-type": "application/json" } } : {}),
      });
      expect(res.status).toBe(status);
      const h = res.headers;
      expect(h.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
      expect(h.get("permissions-policy")).toContain("camera=()");
      expect(h.get("permissions-policy")).toContain("payment=()");
      expect(h.get("x-content-type-options")).toBe("nosniff");
      expect(h.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(h.get("content-security-policy")).toBe(CSP);
      await res.body?.cancel();
    },
  );
});
