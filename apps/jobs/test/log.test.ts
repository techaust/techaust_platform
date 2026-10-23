import { describe, expect, it, vi } from "vitest";
import { logEvent, noteInvocation } from "../src/log.ts";

// CPU tuning 3: every queue log line names its isolate and invocation, so staging readings separate cold from warm.
describe("queue log lines", () => {
  it("carry a stable per-isolate ID and a growing invocation count, and nothing else new", () => {
    const lines: Record<string, unknown>[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((s: unknown) => void lines.push(JSON.parse(String(s))));
    noteInvocation();
    logEvent("email.sent", { template: "staff.lockout" });
    noteInvocation();
    logEvent("email.sent", { template: "staff.lockout" });
    spy.mockRestore();
    const [a, b] = lines;
    expect(Object.keys(a ?? {}).sort()).toEqual(["ev", "iso", "n", "template"]);
    expect(a?.iso).toMatch(/^[0-9a-f]{6}$/);
    expect(b?.iso).toBe(a?.iso);
    expect(Number(b?.n)).toBe(Number(a?.n) + 1);
  });
});
