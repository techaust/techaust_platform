import { warmSesSigning } from "@techaust/email";
import { describe, expect, it, vi } from "vitest";
import { warmConsumers } from "../src/warm.ts";

// The consumers' start-up warm-up (CPU tuning) runs inside workerd: every sample parses and every template renders.
// (The SES warm-up's start-up rules are tested in packages/email.)
describe("jobs start-up warm-up", () => {
  it("parses 5 samples (two leads, a lead email, a sign-in link email, a staff alert) and renders 10 emails (the three 2FA changes and the member line included), plus the M5.5b report messages (3), two report emails and one statement, plus the three M5.4 billing emails and the five other billing templates (review L3), plus the T11 deed message and its email", () => {
    expect(warmConsumers()).toBe(35);
  });

  it("works under workerd's start-up rules and prints nothing (M2.4b: the five new templates and the staff alert are included)", () => {
    // At module top level workerd refuses these with "Disallowed operation called within global scope"; inside a test
    // they are allowed, so make them throw to see what the warm-up does at start-up.
    const refuse = () => {
      throw new Error("Disallowed operation called within global scope");
    };
    const g = globalThis as Record<string, unknown>;
    const saved = { Request: g.Request, Response: g.Response, fetch: g.fetch, setTimeout: g.setTimeout };
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(refuse);
    const random = vi.spyOn(crypto, "getRandomValues").mockImplementation(refuse);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    g.Request = refuse;
    g.Response = refuse;
    g.fetch = refuse;
    g.setTimeout = refuse;
    try {
      expect(warmConsumers()).toBe(35);
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      Object.assign(g, saved);
      timeout.mockRestore();
      random.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  });

  it("signs a made-up SES request in workerd and sends nothing", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    try {
      expect(await warmSesSigning()).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
