import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// Runs inside workerd (the real Workers runtime) via @cloudflare/vitest-plugin.
describe("jobs worker", () => {
  it("answers /healthz without touching the database", async () => {
    const res = await exports.default.fetch("https://hooks.example/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "jobs", env: "local" });
  });

  it("returns JSON 404 for unknown routes", async () => {
    const res = await exports.default.fetch("https://hooks.example/nope");
    expect(res.status).toBe(404);
  });
});
