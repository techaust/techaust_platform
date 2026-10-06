import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("portal API", () => {
  it("answers /api/v1/health", async () => {
    const res = await exports.default.fetch("https://portal.example/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "portal", env: "local" });
  });
});
