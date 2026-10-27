// The daily LUT check [M5.2 B3, ADM-INV-18, Q22, LD27; VERIFY WITH CA/LEGAL]: the cron adds ONE `lut.check` message to its existing statistics batch (no D1 read,
// no new cron or queue); the consumer reads the stored `tax` row WITHOUT zod, and rings one bell per active owner per IST week, only in March while the next FY has
// no letter, or while the running FY has none; a rerun, a redelivery and a second day of the same week write nothing; the weekly email is M5.4's.
import { env as realEnv } from "cloudflare:workers";
import {
  isLutCheckKind,
  isLutCheckMessage,
  LUT_CHECK_KIND,
  lutBellFor,
  lutCheckMessage,
  lutsFromStoredTax,
  weekMondayOf,
} from "@techaust/core/invoices";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.ts";
import { LUT_BELL_COPY, processLutCheck } from "../src/lut-check.ts";
import { PURGE_CRON } from "../src/purge.ts";
import { handleQueue } from "../src/queue.ts";
import { enqueueStats } from "../src/stats.ts";

const SCHEDULED = Date.UTC(2027, 2, 9, 22, 0); // 22:00 UTC on 9 March = 03:30 IST on 10 March (a Wednesday)
const ARN = "AD0000000000001";

type Sent = unknown[];
const makeEnv = (sent: Sent = [], over: Partial<Record<string, unknown>> = {}) =>
  ({
    DB: realEnv.DB,
    PDF_QUEUE: { sendBatch: async () => undefined },
    ENVIRONMENT: "local",
    LEAD_PURGE_MODE: "live",
    LEAD_ALERT_TO: "owner@example.test",
    ADMIN_URL: "https://admin.example/",
    LEADS_QUEUE: {
      sendBatch: async (items: { body: unknown }[]) => {
        sent.push(...items.map((i) => i.body));
      },
    },
    EMAIL_QUEUE: { sendBatch: async () => undefined },
    ...over,
  }) as unknown as Env;

const all = async <T>(sql: string, ...p: unknown[]) =>
  (
    await realEnv.DB.prepare(sql)
      .bind(...p)
      .all<T>()
  ).results;
const putTax = (value: unknown) =>
  realEnv.DB.prepare(
    "INSERT INTO settings (key, value, version) VALUES ('tax', ?1, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = version + 1",
  )
    .bind(typeof value === "string" ? value : JSON.stringify(value))
    .run();
const bells = () =>
  all<{ user_id: string; kind: string; entity_type: string; entity_id: string; title: string; link: string }>(
    "SELECT user_id, kind, entity_type, entity_id, title, link FROM notifications WHERE kind = 'lut.reminder' ORDER BY entity_id, user_id",
  );
const check = (asOf: string) => processLutCheck(makeEnv(), { kind: LUT_CHECK_KIND, asOf });

beforeEach(async () => {
  await realEnv.DB.batch([
    realEnv.DB.prepare("DELETE FROM notifications"),
    realEnv.DB.prepare("DELETE FROM settings WHERE key = 'tax'"),
    realEnv.DB.prepare("DELETE FROM staff_users WHERE id LIKE 'lut-%'"),
    realEnv.DB.prepare(
      "INSERT INTO staff_users (id, email, name, role, status) VALUES ('lut-owner-1', 'lut1@example.test', 'Owner One', 'owner', 'active'), ('lut-owner-2', 'lut2@example.test', 'Owner Two', 'owner', 'active'), ('lut-owner-off', 'lut3@example.test', 'Owner Gone', 'owner', 'deactivated'), ('lut-staff', 'lut4@example.test', 'Staff', 'staff', 'active')",
    ),
  ]);
});

describe("the message and the cron", () => {
  it("is one message with the IST date of the run; a malformed one is not a message", () => {
    expect(lutCheckMessage(SCHEDULED)).toEqual({ kind: "lut.check", asOf: "2027-03-10" });
    expect(isLutCheckMessage(lutCheckMessage(SCHEDULED))).toBe(true);
    for (const bad of [
      null,
      "x",
      { kind: "lut.check" },
      { kind: "lut.check", asOf: "yesterday" },
      { kind: "lut.check", asOf: "2027-02-30" },
    ])
      expect(isLutCheckMessage(bad), JSON.stringify(bad)).toBe(false);
    expect(isLutCheckKind({ kind: "lut.check" })).toBe(true);
    expect(isLutCheckKind({ kind: "documents.expire" })).toBe(false);
  });

  it("the cron adds it to the existing statistics batch (one queue call) and reads no D1 for it", async () => {
    const dead = new Proxy({}, { get: () => () => Promise.reject(new Error("D1 must not be read")) });
    const sent: Sent = [];
    await enqueueStats(makeEnv(sent, { DB: dead }), SCHEDULED, [lutCheckMessage(SCHEDULED)]);
    expect(sent.filter((b) => (b as { kind?: string }).kind === "lut.check")).toEqual([
      { kind: "lut.check", asOf: "2027-03-10" },
    ]);
  });

  it("the scheduled handler sends it with the daily run only", async () => {
    const sent: Sent = [];
    await worker.scheduled?.(
      { cron: PURGE_CRON, scheduledTime: SCHEDULED } as ScheduledController,
      makeEnv(sent),
      {} as ExecutionContext,
    );
    expect(sent.filter((b) => (b as { kind?: string }).kind === "lut.check")).toEqual([
      { kind: "lut.check", asOf: "2027-03-10" },
    ]);
  });
});

describe("when a bell rings", () => {
  it("in March while the next FY has no letter: one bell per ACTIVE owner (not the suspended one, not Staff), 07-S's banner line, the week in the entity", async () => {
    await putTax({ luts: [{ fy: "2627", arn: ARN, filedOn: null }] });
    const r = await check("2027-03-10");
    expect(r).toEqual({ bell: "next_fy_due", owners: 2 });
    const rows = await bells();
    expect(rows).toEqual([
      {
        user_id: "lut-owner-1",
        kind: "lut.reminder",
        entity_type: "settings",
        entity_id: "lut:2728:2027-03-08",
        title: "File next year's LUT (FY 2027-28) before 1 April, then save its ARN here.",
        link: "/settings/tax",
      },
      {
        user_id: "lut-owner-2",
        kind: "lut.reminder",
        entity_type: "settings",
        entity_id: "lut:2728:2027-03-08",
        title: "File next year's LUT (FY 2027-28) before 1 April, then save its ARN here.",
        link: "/settings/tax",
      },
    ]);
  });

  it("a rerun, a redelivery and the other days of the same week add nothing; the next Monday adds one more each", async () => {
    await putTax({ luts: [{ fy: "2627", arn: ARN, filedOn: null }] });
    expect(await check("2027-03-10")).toMatchObject({ owners: 2 });
    expect(await check("2027-03-10")).toMatchObject({ bell: "next_fy_due", owners: 0 }); // redelivered
    for (const day of ["2027-03-08", "2027-03-11", "2027-03-14"])
      expect(await check(day), day).toMatchObject({ owners: 0 });
    expect(await bells()).toHaveLength(2);
    expect(await check("2027-03-15")).toMatchObject({ owners: 2 }); // the next Monday
    expect((await bells()).map((b) => b.entity_id)).toEqual([
      "lut:2728:2027-03-08",
      "lut:2728:2027-03-08",
      "lut:2728:2027-03-15",
      "lut:2728:2027-03-15",
    ]);
  });

  it("no bell in March once the next FY has its letter (the legacy single letter counts too), and none while the running FY has one", async () => {
    await putTax({
      luts: [
        { fy: "2627", arn: ARN, filedOn: null },
        { fy: "2728", arn: "AD0000000000002", filedOn: null },
      ],
    });
    expect(await check("2027-03-10")).toEqual({ bell: "none", owners: 0 });
    await putTax({ luts: [{ fy: "2627", arn: ARN, filedOn: null }], lut: { arn: "OLD1", fy: "2728" } });
    expect(await check("2027-03-17")).toEqual({ bell: "none", owners: 0 });
    // mid-year, with the running FY's letter: nothing
    await putTax({ luts: [{ fy: "2728", arn: ARN, filedOn: null }] });
    expect(await check("2027-09-15")).toEqual({ bell: "none", owners: 0 });
    expect(await bells()).toHaveLength(0);
  });

  it("from 1 April while the running FY has no letter: the 'missing' bell (07-S has no line yet: [Placeholder]), one a week", async () => {
    await putTax({ luts: [{ fy: "2627", arn: ARN, filedOn: null }] });
    const r = await check("2027-04-07"); // a Wednesday; its Monday is 5 April
    expect(r).toEqual({ bell: "current_missing", owners: 2 });
    expect((await bells()).map((b) => [b.entity_id, b.title])).toEqual([
      ["lut:2728:2027-04-05", "[Placeholder]"],
      ["lut:2728:2027-04-05", "[Placeholder]"],
    ]);
    expect(LUT_BELL_COPY.current_missing("2027-28")).toBe("[Placeholder]");
    expect(await check("2027-04-09")).toMatchObject({ owners: 0 });
    // the owner saves the letter: the bells stop
    await putTax({ luts: [{ fy: "2728", arn: ARN, filedOn: null }] });
    expect(await check("2027-04-14")).toEqual({ bell: "none", owners: 0 });
  });

  it("no settings row at all, or an unreadable one, is 'no letters' (the owners are told, nothing throws)", async () => {
    expect(await check("2027-04-07")).toMatchObject({ bell: "current_missing", owners: 2 });
    await putTax("{not json");
    expect(await check("2027-04-14")).toMatchObject({ bell: "current_missing", owners: 2 });
    await putTax("[1,2]");
    expect(await check("2027-04-21")).toMatchObject({ bell: "current_missing", owners: 2 });
  });

  it("writes nothing but the bells: no email, no other row", async () => {
    await putTax({ luts: [] });
    const before = await all<{ n: number }>("SELECT (SELECT count(*) FROM email_log) AS n");
    await check("2027-03-10");
    expect(await all<{ n: number }>("SELECT (SELECT count(*) FROM email_log) AS n")).toEqual(before);
    expect(await all("SELECT 1 FROM notifications WHERE kind <> 'lut.reminder'")).toHaveLength(0);
  });
});

describe("the reader and the pure rules (no zod in the jobs Worker)", () => {
  it("lutsFromStoredTax reads the list and the legacy key, skips what is malformed, never throws", () => {
    expect(
      lutsFromStoredTax({
        luts: [
          { fy: "2627", arn: "A" },
          { fy: "2627", arn: "DUP" },
          { fy: "26", arn: "B" },
          { fy: "2728", arn: " " },
          5,
          null,
        ],
        lut: { fy: "2728", arn: "OLD" },
      }),
    ).toEqual([
      { fy: "2627", arn: "A" },
      { fy: "2728", arn: "OLD" },
    ]);
    for (const junk of [null, undefined, 7, "x", [], { luts: "x", lut: 3 }])
      expect(lutsFromStoredTax(junk)).toEqual([]);
  });

  it("the week runs Monday to Sunday (IST dates), and a bad date has none", () => {
    expect(weekMondayOf("2027-03-08")).toBe("2027-03-08");
    expect(weekMondayOf("2027-03-14")).toBe("2027-03-08");
    expect(weekMondayOf("2027-03-15")).toBe("2027-03-15");
    expect(weekMondayOf("2027-01-01")).toBe("2026-12-28");
    expect(weekMondayOf("2027-02-30")).toBeNull();
    expect(lutBellFor("nope", [])).toBeNull();
  });
});

describe("the queue", () => {
  const batch = (queue: string, bodies: unknown[]) => {
    const acked: unknown[] = [];
    const retried: unknown[] = [];
    const messages = bodies.map((body) => ({
      body,
      attempts: 1,
      ack: () => acked.push(body),
      retry: () => retried.push(body),
    }));
    return { b: { queue, messages } as unknown as MessageBatch<unknown>, acked, retried };
  };
  const leadCount = async () => (await all<{ n: number }>("SELECT count(*) AS n FROM leads"))[0]?.n ?? 0;

  it("a lut.check on the leads queue is processed and acknowledged, and never becomes a lead; a malformed one is acknowledged and changes nothing", async () => {
    await putTax({ luts: [] });
    const before = await leadCount();
    const { b, acked, retried } = batch("techaust-local-leads", [
      { kind: "lut.check", asOf: "2027-03-10" },
      { kind: "lut.check", asOf: "yesterday" },
      { kind: "lut.check" },
    ]);
    await handleQueue(b, makeEnv());
    expect(acked).toHaveLength(3);
    expect(retried).toHaveLength(0);
    expect(await bells()).toHaveLength(2);
    expect(await leadCount()).toBe(before);
  });

  it("a lut.check that ran out of tries is acknowledged with no alert and no retry", async () => {
    const { b, acked, retried } = batch("techaust-local-leads-dlq", [
      { kind: "lut.check", asOf: "2027-03-10" },
    ]);
    await handleQueue(b, makeEnv());
    expect(acked).toHaveLength(1);
    expect(retried).toHaveLength(0);
    expect(await bells()).toHaveLength(0);
  });
});
