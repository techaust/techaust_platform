import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("admin API", () => {
  it("answers /api/v1/health", async () => {
    const res = await exports.default.fetch("https://admin.example/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "admin", env: "local" });
  });
});
