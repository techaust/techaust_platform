// The hourly cron and the queue routing of the M5.4 messages [LD61, ADM-INV-13, ADM-CARE-02]: the tick maps every IST hour to the right messages with ONE sendBatch and no D1 read; every new
// kind is routed BEFORE the lead fall-through (a body of the family, valid or not, can never become a lead); the dead letters are handled by kind.
import { uuidv7 } from "@techaust/core";
import { fromIst, parseIsoDate } from "@techaust/core/dates";
import type { SendInput, Transport } from "@techaust/email";
import { describe, expect, it } from "vitest";
import {
  ALERTS_HOUR_IST,
  CARE_SCAN_HOUR_IST,
  enqueueHourly,
  HOURLY_CRON,
  hourlyMessages,
} from "../src/billing.ts";
import { processDeadLetter } from "../src/email.ts";
import worker from "../src/index.ts";
import { PURGE_CRON } from "../src/purge.ts";
import { handleQueue } from "../src/queue.ts";
import { fakes, logs, makeEnv, one, useFakes } from "./billing-fixtures.ts";

useFakes();

const istTick = (iso: string, hour: number) => {
  const d = parseIsoDate(iso);
  if (!d) throw new Error("bad date");
  return fromIst(d, hour); // the top of an IST hour is :30 UTC, which is where `30 * * * *` fires
};

describe("the hourly cron `30 * * * *` [LD61]", () => {
  it("the tick is at :30 UTC, the top of every IST hour", () => {
    expect(new Date(istTick("2026-11-10", 6)).toISOString()).toBe("2026-11-10T00:30:00.000Z");
    expect(HOURLY_CRON).toBe("30 * * * *");
    expect(CARE_SCAN_HOUR_IST).toBe(6);
    expect(ALERTS_HOUR_IST).toBe(9);
  });

  it("all 24 IST hours: the reminder scan every hour, the care scan only at 06:00, the owners' alerts only at 09:00", () => {
    for (let h = 0; h < 24; h++) {
      const kinds = hourlyMessages(istTick("2026-11-10", h)).map((m) => m.kind);
      const expected = [
        ...(h === 6 ? ["care.scan"] : []),
        // M5.5b (LD76, changed on purpose): the realisation scan rides the 09:00 IST tick (the EDF reminder only on days 5 to 7: reports-b.test.ts)
        ...(h === 9 ? ["alerts.daily", "realisation.scan"] : []),
        "reminder.scan",
      ];
      expect(kinds, `hour ${h}`).toEqual(expected);
    }
    expect(hourlyMessages(istTick("2026-11-10", 9))[0]).toEqual({
      kind: "alerts.daily",
      first: true,
      unbilledAfter: null,
      proformaAfter: null,
    });
    expect(hourlyMessages(istTick("2026-11-10", 6))[0]).toEqual({ kind: "care.scan", after: null });
  });

  it("the tick is ONE sendBatch on the leads queue and reads no D1 (the database is a trap)", async () => {
    const dead = new Proxy({}, { get: () => () => Promise.reject(new Error("D1 must not be read")) });
    const env = makeEnv({ DB: dead });
    expect(await enqueueHourly(env, istTick("2026-11-10", 6))).toBe(2);
    expect(fakes.leads.map((s) => s.via)).toEqual(["sendBatch", "sendBatch"]); // two bodies, one call
    expect(fakes.leads.map((s) => (s.body as { kind: string }).kind)).toEqual(["care.scan", "reminder.scan"]);
    expect(fakes.email).toEqual([]);
    expect(fakes.pdf).toEqual([]);
  });

  it("the scheduled handler dispatches by cron: the hourly one sends only the hourly messages; an unknown cron sends nothing; the daily one no longer carries a lut.check", async () => {
    const scheduled = worker.scheduled;
    const run = (cron: string, time: number, env = makeEnv()) =>
      scheduled?.({ cron, scheduledTime: time } as ScheduledController, env, {} as ExecutionContext);
    fakes.leads.length = 0;
    await run(HOURLY_CRON, istTick("2026-11-10", 9));
    expect(fakes.leads.map((s) => (s.body as { kind: string }).kind)).toEqual([
      "alerts.daily",
      "realisation.scan", // M5.5b, changed on purpose
      "reminder.scan",
    ]);
    fakes.leads.length = 0;
    await run("5 5 5 5 5", istTick("2026-11-10", 9));
    expect(fakes.leads).toEqual([]);
    fakes.leads.length = 0;
    await run(PURGE_CRON, Date.UTC(2026, 10, 9, 22, 0), makeEnv({ LEAD_PURGE_MODE: "dry_run" }));
    const daily = fakes.leads.map((s) => (s.body as { kind: string }).kind);
    expect(daily).not.toContain("lut.check");
    expect(daily).not.toContain("reminder.scan");
    expect(daily).not.toContain("care.scan");
  });
});

describe("routing on the leads queue: a body of the billing family can never become a lead", () => {
  const consume = async (
    queue: string,
    body: unknown,
    env = makeEnv(
      {},
      {
        draftCarePlan: () => ({ result: "not_due", autoEligible: false, reasons: [] }),
        issueCareDraft: () => ({ result: "not_found", reasons: [] }),
      },
    ),
  ) => {
    const out: string[] = [];
    await handleQueue(
      {
        queue,
        messages: [
          {
            id: uuidv7(),
            body,
            attempts: 1,
            ack: () => out.push("ack"),
            retry: (o?: { delaySeconds?: number }) => out.push(`retry:${o?.delaySeconds}`),
          },
        ],
      } as never,
      env,
    );
    return out;
  };
  const leadCount = async () => (await one<{ n: number }>("SELECT count(*) AS n FROM leads"))?.n;

  it("valid and invalid bodies of the five kinds are acknowledged and no lead is ever written", async () => {
    const before = await leadCount();
    const bodies: unknown[] = [
      { kind: "care.scan", after: null },
      { kind: "care.scan" },
      { kind: "care.bill", planId: "p1" },
      { kind: "care.bill" },
      { kind: "care.issue", documentId: "d1" },
      { kind: "care.issue", documentId: 3 },
      { kind: "alerts.daily", first: true, unbilledAfter: null, proformaAfter: null },
      { kind: "alerts.daily" },
      { kind: "reminder.scan", after: null },
      { kind: "reminder.scan", after: "x" },
    ];
    for (const b of bodies)
      expect(await consume("techaust-staging-leads", b), JSON.stringify(b)).toEqual(["ack"]);
    expect(await leadCount()).toBe(before);
    expect(logs.join("\n")).toContain("billing.invalid_message");
  });

  it("care.bill is handed to the entrypoint with the plan's id", async () => {
    await consume("techaust-staging-leads", { kind: "care.bill", planId: "plan-77" });
    expect(fakes.rpc).toEqual([{ method: "draftCarePlan", arg: { planId: "plan-77" } }]);
  });

  it("an entrypoint that is down makes the message retry (not ack, not a lead): the queue's own backoff", async () => {
    const leadsBefore = await leadCount();
    const down = makeEnv(
      {},
      {
        draftCarePlan: () => {
          throw new Error("rpc down");
        },
      },
    );
    const out = await consume("techaust-staging-leads", { kind: "care.bill", planId: "p" }, down);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^retry:/);
    expect(await leadCount()).toBe(leadsBefore);
  });
});

describe("dead letters by kind", () => {
  const consume = async (queue: string, body: unknown, env = makeEnv()) => {
    const out: string[] = [];
    await handleQueue(
      {
        queue,
        messages: [
          {
            id: uuidv7(),
            body,
            attempts: 5,
            ack: () => out.push("ack"),
            retry: (o?: { delaySeconds?: number }) => out.push(`retry:${o?.delaySeconds}`),
          },
        ],
      } as never,
      env,
    );
    return out;
  };

  it("a billing message in the leads dead-letter queue is acknowledged with no alert email: a scan or an alert is listed again by the next run", async () => {
    for (const body of [
      { kind: "care.scan", after: null },
      { kind: "reminder.scan", after: null },
      { kind: "alerts.daily", first: true, unbilledAfter: null, proformaAfter: null },
    ])
      expect(await consume("techaust-staging-leads-dlq", body)).toEqual(["ack"]);
    expect(logs.join("\n")).toContain("billing.dead_letter");
    expect(logs.join("\n")).not.toContain("queue.dead_letter");
  });

  it("invoice.send and reminder.send in the email dead-letter queue alert the owner with a label and never an id", async () => {
    const sent: SendInput[] = [];
    const transport: Transport = {
      async send(input) {
        sent.push(input);
        return { kind: "sent", messageId: "m" };
      },
    };
    const sendId = uuidv7();
    await processDeadLetter(
      makeEnv(),
      "techaust-staging-email-dlq",
      { kind: "invoice.send", sendId },
      transport,
    );
    await processDeadLetter(
      makeEnv(),
      "techaust-staging-email-dlq",
      { kind: "reminder.send", reminderId: sendId },
      transport,
    );
    expect(sent).toHaveLength(2);
    expect(sent[0]?.text).toContain("Email: invoice email");
    expect(sent[1]?.text).toContain("Email: payment reminder");
    for (const s of sent) {
      expect(s.subject).not.toContain(sendId);
      expect(s.html).not.toContain(sendId);
      expect(s.to).toBe("alerts@example.test");
    }
  });
});
