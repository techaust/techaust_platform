import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import api from "./api.ts";

describe("admin API", () => {
  it("answers /api/v1/health", async () => {
    const res = await exports.default.fetch("https://admin.example/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "admin", env: "local" });
  });
});

/** The docs/08 section 3.1 headers every API answer carries (audit A1 finding 4). */
function expectApiHeaders(res: Response) {
  expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  expect(res.headers.get("permissions-policy")).toBe(
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
}

describe("security headers on API answers [A1-4, docs/08 3.1]", () => {
  it("the front Worker's own answers: HSTS for a year with subdomains, and the Permissions-Policy", async () => {
    expectApiHeaders(await exports.default.fetch("https://admin.example/api/v1/health"));
  });

  it("the API Worker's answers (a refusal included) carry the same set", async () => {
    const ctx = createExecutionContext();
    const res = await api.fetch(new Request("https://admin.example/api/v1/clients"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
    expectApiHeaders(res);
  });
});
