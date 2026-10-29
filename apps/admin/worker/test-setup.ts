import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, vi } from "vitest";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Opt-in shifted clock, to prove a run at any hour (audit A0, finding 1): with `TA_TEST_CLOCK=2026-11-18T01:00:00+05:30` every test runs
// as if the run had started at that instant (Date only; time still moves). A test that sets its own clock keeps it; once it puts the
// real clock back, the next test is shifted again. Unset (the default, and in CI), nothing changes.
const shiftTo = env.TEST_CLOCK_AT ? Date.parse(env.TEST_CLOCK_AT) : Number.NaN;
if (env.TEST_CLOCK_AT && !Number.isFinite(shiftTo)) throw new Error("TA_TEST_CLOCK is not a date");
if (Number.isFinite(shiftTo)) {
  const delta = shiftTo - Date.now();
  const shift = () => {
    if (!vi.isFakeTimers())
      vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true, now: Date.now() + delta });
  };
  beforeAll(shift);
  beforeEach(shift);
}
