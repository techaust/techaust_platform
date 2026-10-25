// JOB-PDF-01: the Browser Run pacer on a fake clock, and a real sleep in workerd.
import { describe, expect, it } from "vitest";
import {
  type Clock,
  DEFAULT_MIN_SPACING_MS,
  MAX_SPACING_MS,
  paced,
  realClock,
  spacingFrom,
} from "../src/pacer.ts";

function fakeClock(start = 1_000_000) {
  let t = start;
  const sleeps: number[] = [];
  const clock: Clock = {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  };
  return { clock, sleeps, advance: (ms: number) => (t += ms), at: () => t };
}

describe("paced", () => {
  it("waits for the rest of the spacing after a fast call", async () => {
    const f = fakeClock();
    const out = await paced(async () => "pdf", 10_000, f.clock);
    expect(out).toBe("pdf");
    expect(f.sleeps).toEqual([10_000]);
  });

  it("counts the call's own time (the spacing is start to start)", async () => {
    const f = fakeClock();
    await paced(async () => f.advance(4_000), 10_000, f.clock);
    expect(f.sleeps).toEqual([6_000]);
  });

  it("does not wait after a call that took longer than the spacing", async () => {
    const f = fakeClock();
    await paced(async () => f.advance(12_000), 10_000, f.clock);
    expect(f.sleeps).toEqual([]);
  });

  it("also waits when the call throws, and rethrows", async () => {
    const f = fakeClock();
    await expect(
      paced(
        async () => {
          throw new Error("boom");
        },
        10_000,
        f.clock,
      ),
    ).rejects.toThrow("boom");
    expect(f.sleeps).toEqual([10_000]);
  });

  it("keeps back-to-back calls at least the spacing apart", async () => {
    const f = fakeClock();
    const starts: number[] = [];
    for (let i = 0; i < 5; i++) await paced(async () => starts.push(f.at()), 10_000, f.clock);
    for (let i = 1; i < starts.length; i++) {
      expect((starts[i] as number) - (starts[i - 1] as number)).toBeGreaterThanOrEqual(10_000);
    }
  });

  it("a zero spacing never sleeps", async () => {
    const f = fakeClock();
    await paced(async () => 1, 0, f.clock);
    expect(f.sleeps).toEqual([]);
  });
});

describe("spacingFrom", () => {
  it("reads the setting, with a default and a ceiling", () => {
    expect(spacingFrom(undefined)).toBe(DEFAULT_MIN_SPACING_MS);
    expect(spacingFrom("abc")).toBe(DEFAULT_MIN_SPACING_MS);
    expect(spacingFrom("-5")).toBe(DEFAULT_MIN_SPACING_MS);
    expect(spacingFrom("0")).toBe(0);
    expect(spacingFrom("2500")).toBe(2500);
    expect(spacingFrom("999999")).toBe(MAX_SPACING_MS);
  });
});

describe("realClock in workerd", () => {
  it("sleeps for about the time asked", async () => {
    const before = Date.now();
    await realClock.sleep(20);
    expect(Date.now() - before).toBeGreaterThanOrEqual(15);
  });
  it("uses scheduler.wait when the runtime has it", () => {
    const s = (globalThis as { scheduler?: { wait?: unknown } }).scheduler;
    expect(typeof s?.wait).toBe("function");
  });
});
