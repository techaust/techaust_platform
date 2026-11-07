// M7.5 L20: `f: 1` per queue kind and per cron branch, so the staging CPU gate reads first runs of each row of the route inventory. The lines carry codes
// only (NFR-6): the queue's short name, the message kind, the cron branch.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cronBranchOf, HOURLY_CRON } from "../src/billing.ts";
import { PURGE_CRON } from "../src/purge.ts";
import { handleQueue } from "../src/queue.ts";

afterEach(() => vi.restoreAllMocks());

const lines = (spy: { mock: { calls: unknown[][] } }, ev: string) =>
  spy.mock.calls
    .map((c) => String(c[0]))
    .filter((s) => s.startsWith(`{"ev":"${ev}"`))
    .map((s) => JSON.parse(s) as Record<string, unknown>);

function batchOf(queue: string, bodies: unknown[]): MessageBatch<unknown> {
  return {
    queue,
    messages: bodies.map((body, i) => ({
      id: `m${i}`,
      timestamp: new Date(),
      body,
      attempts: 1,
      ack: () => undefined,
      retry: () => undefined,
    })),
    ackAll: () => undefined,
    retryAll: () => undefined,
  } as unknown as MessageBatch<unknown>;
}

describe("queue lines (M7.5 L20)", () => {
  it("one line per message: the queue, the kind and f: 1 only on that kind's first run in this isolate", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    // A queue this Worker does not consume: each message is logged and acknowledged, nothing is read.
    await handleQueue(
      batchOf("techaust-local-l20probe", [
        { kind: "probe.one", email: "a@example.test" },
        { kind: "probe.one" },
        { template: "probe.two" },
        "x",
      ]),
      {} as Env,
    );
    const got = lines(spy, "q");
    expect(got.map((l) => [l.q, l.k, l.f])).toEqual([
      ["l20probe", "probe.one", 1],
      ["l20probe", "probe.one", undefined],
      ["l20probe", "probe.two", 1],
      ["l20probe", "other", 1],
    ]);
    expect(JSON.stringify(got)).not.toContain("example");
  });
});

describe("cron branches (M7.5 L20)", () => {
  // `30 * * * *` UTC fires at the top of each IST hour: 00:30 UTC is 06:00 IST.
  const at = (utcHour: number) => Date.UTC(2026, 10, 9, utcHour, 30);

  it("daily, the care hours, the alerts hours and every other hour", () => {
    expect(cronBranchOf(PURGE_CRON, at(22), PURGE_CRON)).toBe("daily");
    expect(cronBranchOf(HOURLY_CRON, at(0), PURGE_CRON)).toBe("h06");
    expect(cronBranchOf(HOURLY_CRON, at(2), PURGE_CRON)).toBe("h06");
    expect(cronBranchOf(HOURLY_CRON, at(3), PURGE_CRON)).toBe("h09");
    expect(cronBranchOf(HOURLY_CRON, at(5), PURGE_CRON)).toBe("h09");
    expect(cronBranchOf(HOURLY_CRON, at(6), PURGE_CRON)).toBe("hourly");
    expect(cronBranchOf(HOURLY_CRON, at(23), PURGE_CRON)).toBe("hourly");
    expect(cronBranchOf("5 4 * * *", at(4), PURGE_CRON)).toBe("other");
  });
});
