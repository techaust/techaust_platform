// The owners' export alerts of M5.5b stage B [ADM-REP-07, ADM-INV-17, LD75, LD76, LD77; Q53, Q54, Q55; Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 5(1) (08-C RB-01)]: the 09:00 IST dispatch (every hour, days 4 to 8, December to January, no D1 read),
// `realisation.scan` (each stage once, the current stage only, the stored settings, the IGST route, month-end issue dates, realised and voided exports, continuation, an anonymised client, emails
// before bells, per owner) and `edf.reminder` (one email and one bell per owner per month, none without exports). Documents are inserted the way the scan finds them; the fake clock is the `now` passed in.
import { uuidv7 } from "@techaust/core";
import { fromIst, parseIsoDate } from "@techaust/core/dates";
import { beforeEach, describe, expect, it } from "vitest";
import { ALERTS_HOUR_IST, EDF_REMINDER_DAYS_IST, enqueueHourly, hourlyMessages } from "../src/billing.ts";
import worker from "../src/index.ts";
import { handleQueue } from "../src/queue.ts";
import { processEdfReminder, processRealisationScan, REALISATION_BELL_TITLE } from "../src/reports.ts";
import { chunksOf, SEND_BATCH_MAX_BYTES, SEND_BATCH_MAX_MESSAGES, sendChunked } from "../src/send-batch.ts";
import {
  all,
  emailsQueued,
  fakes,
  logs,
  makeEnv,
  mkClient,
  mkDoc,
  one,
  run,
  staff,
  useFakes,
} from "./billing-fixtures.ts";

useFakes();

// Tests of one file share a database and an issued document is frozen (it cannot be deleted), so every test starts with every earlier export realised (a zero balance is a mutable column)
// and with only its own owners active (the database refuses to leave no active owner, so the new ones are made first).
beforeEach(async () => {
  await run("UPDATE documents SET balance_minor = 0 WHERE type = 'export_invoice'");
});

/** `n` new active owners, and nobody else active as an owner. */
async function owners(n = 1, names: string[] = []) {
  const made = [];
  for (let i = 0; i < n; i++) made.push(await staff("owner", names[i] ? { name: names[i] as string } : {}));
  await run(
    `UPDATE staff_users SET status = 'deactivated' WHERE role = 'owner' AND status = 'active' AND id NOT IN (${made.map(() => "?").join(", ")})`,
    ...made.map((m) => m.id),
  );
  return made;
}

/** The top of an IST hour on a day: where the 09:00 IST tick fires. */
const tick = (iso: string, hour = 9) => {
  const d = parseIsoDate(iso);
  if (!d) throw new Error("bad date");
  return fromIst(d, hour);
};

describe("the 09:00 IST dispatch [LD76]", () => {
  const kindsAt = (iso: string, hour: number) => hourlyMessages(tick(iso, hour)).map((m) => m.kind);

  it("every IST hour of days 4 to 8: the realisation scan only at 09:00, the EDF reminder only at 09:00 on days 5, 6 and 7", () => {
    expect([...EDF_REMINDER_DAYS_IST]).toEqual([5, 6, 7]);
    for (const day of [4, 5, 6, 7, 8]) {
      for (let h = 0; h < 24; h++) {
        const kinds = kindsAt(`2026-11-${String(day).padStart(2, "0")}`, h);
        const expected = [
          ...(h === 6 ? ["care.scan"] : []),
          ...(h === ALERTS_HOUR_IST ? ["alerts.daily", "realisation.scan"] : []),
          ...(h === ALERTS_HOUR_IST && day >= 5 && day <= 7 ? ["edf.reminder"] : []),
          "reminder.scan",
        ];
        expect(kinds, `day ${day} hour ${h}`).toEqual(expected);
      }
    }
  });

  it("the reminder names the PREVIOUS month, and January names December of the year before", () => {
    const edf = (iso: string) => hourlyMessages(tick(iso)).find((m) => m.kind === "edf.reminder");
    expect(edf("2026-11-05")).toEqual({ v: 1, kind: "edf.reminder", year: 2026, month: 10 });
    expect(edf("2026-11-07")).toEqual({ v: 1, kind: "edf.reminder", year: 2026, month: 10 });
    expect(edf("2027-01-05")).toEqual({ v: 1, kind: "edf.reminder", year: 2026, month: 12 });
    expect(edf("2027-01-06")).toEqual({ v: 1, kind: "edf.reminder", year: 2026, month: 12 });
    expect(edf("2027-02-07")).toEqual({ v: 1, kind: "edf.reminder", year: 2027, month: 1 });
    expect(edf("2027-12-06")).toEqual({ v: 1, kind: "edf.reminder", year: 2027, month: 11 });
  });

  it("the day is the IST day: 23:30 UTC on the 4th is already the 5th in India, 18:30 UTC on the 7th is the 8th", () => {
    // 2026-11-04 23:30 UTC = 2026-11-05 05:00 IST: not 09:00, so nothing; the 09:00 IST tick of the 5th is 03:30 UTC
    expect(hourlyMessages(Date.UTC(2026, 10, 5, 3, 30)).map((m) => m.kind)).toContain("edf.reminder");
    expect(hourlyMessages(Date.UTC(2026, 10, 7, 18, 30)).map((m) => m.kind)).not.toContain("edf.reminder");
  });

  it("the tick stays ONE sendBatch and reads no D1, on a day with every message (the database is a trap)", async () => {
    const dead = new Proxy({}, { get: () => () => Promise.reject(new Error("D1 must not be read")) });
    const env = makeEnv({ DB: dead });
    expect(await enqueueHourly(env, tick("2026-11-05"))).toBe(4);
    expect(fakes.leads.map((s) => s.via)).toEqual(Array(4).fill("sendBatch"));
    expect(fakes.leads.map((s) => (s.body as { kind: string }).kind)).toEqual([
      "alerts.daily",
      "realisation.scan",
      "edf.reminder",
      "reminder.scan",
    ]);
  });

  it("the scheduled handler queues them from the hourly cron", async () => {
    await worker.scheduled?.(
      { cron: "30 * * * *", scheduledTime: tick("2026-11-06") } as ScheduledController,
      makeEnv(),
      {} as ExecutionContext,
    );
    expect(fakes.leads.map((s) => (s.body as { kind: string }).kind)).toEqual([
      "alerts.daily",
      "realisation.scan",
      "edf.reminder",
      "reminder.scan",
    ]);
  });
});

// ---- realisation.scan ------------------------------------------------------------------------------------------------------------------------------

type ExportOver = {
  currency?: "INR" | "USD";
  supply?: "export_lut" | "export_igst";
  balance?: number;
  voided?: boolean;
  anonymised?: boolean;
  name?: string | null;
};

/** An overseas client (in INR for an INR export) and one issued export invoice for it. */
async function mkExport(issueDate: string, o: ExportOver = {}) {
  const currency = o.currency ?? "USD";
  const clientId = await mkClient({ currency: "USD", ...(o.anonymised ? { anonymised: true } : {}) });
  if (currency === "INR") await run("UPDATE clients SET currency = 'INR' WHERE id = ?1", clientId);
  const doc = await mkDoc(clientId, null, {
    type: "export_invoice",
    currency,
    issueDate,
    ...(o.balance === undefined ? {} : { balance: o.balance }),
    ...(o.voided ? { voided: true } : {}),
    supplyType: o.supply ?? "export_lut",
    placeOfSupply: "96",
    recipient: JSON.stringify({
      legalName: o.name === undefined ? "Acme Overseas Inc" : o.name,
      gstStatus: "overseas",
      country: "US",
    }),
  });
  return { ...doc, clientId };
}

const bellsOf = (docId: string) =>
  all<{ user_id: string; kind: string; title: string; link: string; entity_type: string }>(
    "SELECT user_id, kind, title, link, entity_type FROM notifications WHERE entity_id = ?1 ORDER BY kind, user_id",
    docId,
  );
const alertEmails = () => emailsQueued().filter((e) => e.template === "realisation.alert");
const scan = (now: number, after?: { d: string; id: string }, env = makeEnv()) =>
  processRealisationScan(env, { v: 1, kind: "realisation.scan", ...(after ? { after } : {}) }, now);

describe("realisation.scan: each stage rings once", () => {
  it("a USD export under LUT: FEMA approaching 30 days before, overdue the day after, GST approaching, GST overdue the day after 12 months and 15 days; each once, over a second scan and the next day", async () => {
    const [o1, o2] = await owners(2);
    if (!o1 || !o2) throw new Error("owners");
    const ex = await mkExport("2026-11-03"); // femaDue 2027-08-03, gstDue 2027-11-18
    const stages: [string, string, string][] = [
      ["2027-07-03", "ok", ""],
      ["2027-07-04", "fema_approaching", "export.fema_approaching"],
      ["2027-08-03", "fema_approaching", "export.fema_approaching"],
      ["2027-08-04", "fema_overdue", "export.fema_overdue"],
      ["2027-10-18", "fema_overdue", "export.fema_overdue"],
      ["2027-10-19", "gst_approaching", "export.gst_approaching"],
      ["2027-11-18", "gst_approaching", "export.gst_approaching"],
      ["2027-11-19", "gst_overdue", "export.gst_overdue"],
    ];
    const rungKinds = new Set<string>();
    for (const [day, stage, kind] of stages) {
      fakes.email.length = 0;
      const first = await scan(tick(day));
      if (stage === "ok") {
        expect(first).toMatchObject({ kind: "done", alerts: 0 });
        expect(fakes.email).toEqual([]);
        continue;
      }
      const isNew = !rungKinds.has(kind);
      expect(first, day).toMatchObject({ kind: "done", alerts: isNew ? 2 : 0 });
      expect(alertEmails(), day).toHaveLength(isNew ? 2 : 0);
      rungKinds.add(kind);
      // a second scan the same day adds nothing; neither does the next day's, on the first day of a stage (the stage is the same the day after)
      fakes.email.length = 0;
      await scan(tick(day));
      if (["2027-07-04", "2027-08-04", "2027-10-19", "2027-11-19"].includes(day)) {
        const nextDay = parseIsoDate(day);
        if (!nextDay) throw new Error("day");
        await scan(fromIst(nextDay, 9) + 86_400_000);
      }
      expect(alertEmails(), day).toEqual([]);
    }
    const bells = await bellsOf(ex.id);
    expect(bells.map((b) => b.kind)).toEqual(
      [
        "export.fema_approaching",
        "export.fema_approaching",
        "export.fema_overdue",
        "export.fema_overdue",
        "export.gst_approaching",
        "export.gst_approaching",
        "export.gst_overdue",
        "export.gst_overdue",
      ].sort(),
    );
    expect(new Set(bells.map((b) => b.user_id))).toEqual(new Set([o1.id, o2.id]));
    for (const b of bells) {
      expect(b.entity_type).toBe("document");
      expect(b.link).toBe(`/reports/realisation?doc=${ex.id}`);
      expect(b.title).toContain(ex.numberDisplay);
    }
  });

  it("only the current stage alerts: an export first seen overdue gets the overdue bell and email, never the earlier ones", async () => {
    await owners();
    const ex = await mkExport("2026-02-10");
    await scan(tick("2027-04-01")); // FEMA date 2026-11-10 long passed; GST date 2027-02-25 passed too: gst_overdue
    expect((await bellsOf(ex.id)).map((b) => b.kind)).toEqual(["export.gst_overdue"]);
    expect(alertEmails().map((e) => e.data.stage)).toEqual(["gst_overdue"]);
  });

  it("the email carries the stage, number, client, currency, outstanding amount, the stage's own due date and a link; the bell the words of 07-V", async () => {
    const [owner] = await owners(1, ["Rupa Sen"]);
    if (!owner) throw new Error("owner");
    const ex = await mkExport("2026-11-03", { balance: 12_345_00 });
    await scan(tick("2027-07-10"));
    const [email] = alertEmails();
    expect(email).toMatchObject({
      template: "realisation.alert",
      to: owner.email,
      entity: { type: "document", id: `${ex.id}:fema_approaching` },
      data: {
        owner_first_name: "Rupa",
        stage: "fema_approaching",
        number: ex.numberDisplay,
        client: "Acme Overseas Inc",
        currency: "USD",
        outstanding: "$12,345.00",
        due_date: "03 Aug 2027",
        link: `https://admin.example/reports/realisation?doc=${ex.id}`,
      },
    });
    const [bell] = await bellsOf(ex.id);
    expect(bell?.title).toBe(`${ex.numberDisplay}: FEMA date in 30 days (03 Aug 2027)`);
    expect(REALISATION_BELL_TITLE.gst_overdue("N1", "18 Nov 2027")).toBe(
      `N1: past the GST date (18 Nov 2027)`,
    );
    expect(REALISATION_BELL_TITLE.gst_approaching("N1", "d")).toBe(`N1: GST date in 30 days (d)`);
    expect(REALISATION_BELL_TITLE.fema_overdue("N1", "d")).toBe(`N1: past the FEMA date (d)`);
  });

  it("a GST date shows in the email of a GST stage", async () => {
    await owners();
    await mkExport("2026-11-03");
    await scan(tick("2027-10-25"));
    expect(alertEmails().map((e) => [e.data.stage, e.data.due_date])).toEqual([
      ["gst_approaching", "18 Nov 2027"],
    ]);
  });

  it("an INR export has 12 months: approaching from 30 days before the 12-month date", async () => {
    await owners();
    const ex = await mkExport("2026-11-03", { currency: "INR" }); // femaDue 2027-11-03
    await scan(tick("2027-08-04")); // a USD export would be fema_overdue by now; an INR one is not near
    expect(await bellsOf(ex.id)).toEqual([]);
    await scan(tick("2027-10-04"));
    expect((await bellsOf(ex.id)).map((b) => b.kind)).toEqual(["export.fema_approaching"]);
  });

  it("an export with IGST paid has FEMA stages only (Q53): past the GST date it is still fema_overdue", async () => {
    await owners();
    const ex = await mkExport("2026-11-03", { supply: "export_igst" });
    await scan(tick("2027-11-19"));
    expect((await bellsOf(ex.id)).map((b) => b.kind)).toEqual(["export.fema_overdue"]);
    expect(alertEmails().map((e) => e.data.stage)).toEqual(["fema_overdue"]);
  });

  it("issue dates at the end of a month: 31 May + 9 months is 29 February 2028; 29 February 2028 + 9 months is 29 November 2028", async () => {
    await owners();
    const may = await mkExport("2027-05-31"); // femaDue 2028-02-29: approaching from 2028-01-30
    const feb = await mkExport("2028-02-29"); // femaDue 2028-11-29: approaching from 2028-10-30
    await scan(tick("2028-01-29"));
    expect(await bellsOf(may.id)).toEqual([]);
    await scan(tick("2028-01-30"));
    expect((await bellsOf(may.id)).map((b) => b.kind)).toEqual(["export.fema_approaching"]);
    expect(await bellsOf(feb.id)).toEqual([]);
    await scan(tick("2028-10-29"));
    expect(await bellsOf(feb.id)).toEqual([]);
    await scan(tick("2028-10-30"));
    expect((await bellsOf(feb.id)).map((b) => b.kind)).toEqual(["export.fema_approaching"]);
  });

  it("a realised export (credited to nothing outstanding) and a voided one are never alerted", async () => {
    await owners();
    const paid = await mkExport("2026-11-03", { balance: 0 });
    const gone = await mkExport("2026-11-03", { voided: true });
    const open = await mkExport("2026-11-03");
    await scan(tick("2027-08-10"));
    expect(await bellsOf(paid.id)).toEqual([]);
    expect(await bellsOf(gone.id)).toEqual([]);
    expect((await bellsOf(open.id)).length).toBe(1);
    expect(alertEmails()).toHaveLength(1);
  });

  it("an export credited to zero after its first alert stops alerting; nothing already rung is taken back", async () => {
    await owners();
    const ex = await mkExport("2026-11-03");
    await scan(tick("2027-07-10"));
    await run("UPDATE documents SET balance_minor = 0 WHERE id = ?1", ex.id);
    fakes.email.length = 0;
    await scan(tick("2027-08-10")); // would be fema_overdue
    expect(alertEmails()).toEqual([]);
    expect((await bellsOf(ex.id)).map((b) => b.kind)).toEqual(["export.fema_approaching"]);
  });

  it("an anonymised client is named 'Anonymised client', never by its snapshot name", async () => {
    await owners();
    const ex = await mkExport("2026-11-03", { anonymised: true, name: "Secret Person Ltd" });
    await scan(tick("2027-07-10"));
    expect(alertEmails()[0]?.data.client).toBe("Anonymised client");
    expect(JSON.stringify(fakes.email)).not.toContain("Secret Person");
    expect((await bellsOf(ex.id)).map((b) => b.title).join("")).not.toContain("Secret");
  });

  it("a snapshot without a name shows the client's code", async () => {
    await owners();
    const ex = await mkExport("2026-11-03", { name: null });
    const code = (await one<{ code: string }>("SELECT code FROM clients WHERE id = ?1", ex.clientId))?.code;
    await scan(tick("2027-07-10"));
    expect(alertEmails()[0]?.data.client).toBe(code);
  });

  it("per owner: an owner added later gets the alert of a stage the first owner already has; an inactive owner and a staff member get none", async () => {
    const [first] = await owners();
    if (!first) throw new Error("owner");
    await staff("owner", { status: "deactivated" });
    await staff("staff");
    const ex = await mkExport("2026-11-03");
    await scan(tick("2027-07-10"));
    expect(alertEmails().map((e) => e.to)).toEqual([first.email]);
    const late = await staff("owner");
    fakes.email.length = 0;
    await scan(tick("2027-07-11"));
    expect(alertEmails().map((e) => e.to)).toEqual([late.email]);
    expect((await bellsOf(ex.id)).map((b) => b.user_id).sort()).toEqual([first.id, late.id].sort());
  });

  it("the emails are queued BEFORE the bells: a queue that fails leaves no bell, and the retry rings and sends", async () => {
    await owners();
    const ex = await mkExport("2026-11-03");
    const broken = makeEnv({
      EMAIL_QUEUE: {
        sendBatch: async () => {
          throw new Error("queue down");
        },
      },
    });
    await expect(scan(tick("2027-07-10"), undefined, broken)).rejects.toThrow("queue down");
    expect(await bellsOf(ex.id)).toEqual([]);
    await scan(tick("2027-07-10"));
    expect(await bellsOf(ex.id)).toHaveLength(1);
    expect(alertEmails()).toHaveLength(1);
  });

  it("a stored setting the reader refuses skips the scan with a log line: no email, no bell, no continuation", async () => {
    await owners();
    const ex = await mkExport("2026-11-03");
    await run(
      "INSERT INTO settings (key, value, version) VALUES ('tax', ?1, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify({ realisation: { warnMonths: "nine" } }),
    );
    expect(await scan(tick("2027-07-10"))).toEqual({ kind: "invalid_settings" });
    expect(logs.join("\n")).toContain("realisation.settings_invalid");
    expect(fakes.email).toEqual([]);
    expect(fakes.leads).toEqual([]);
    expect(await bellsOf(ex.id)).toEqual([]);
    await run("DELETE FROM settings WHERE key = 'tax'");
  });

  it("the stored months are used: 18 months for INR moves the FEMA date", async () => {
    await owners();
    const ex = await mkExport("2026-11-03", { currency: "INR" });
    await run(
      "INSERT INTO settings (key, value, version) VALUES ('tax', ?1, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify({
        realisation: { inrMonths: 18, warnMonths: 9, escalateMonths: 12, escalateExtraDays: 15 },
      }),
    );
    await scan(tick("2027-10-04")); // 12-month date 2027-11-03 is near; with 18 months the FEMA date is 2028-05-03 (the GST date is later still)
    expect(await bellsOf(ex.id)).toEqual([]);
    await scan(tick("2028-04-04")); // 30 days before the 18-month FEMA date (2028-05-03)
    expect((await bellsOf(ex.id)).map((b) => b.kind)).toEqual(["export.fema_approaching"]);
    await run("DELETE FROM settings WHERE key = 'tax'");
  });

  it("an unreadable message is logged and nothing happens", async () => {
    expect(await processRealisationScan(makeEnv(), { v: 2, kind: "realisation.scan" })).toEqual({
      kind: "invalid_message",
    });
    expect(logs.join("\n")).toContain("realisation.invalid_message");
  });
});

describe("realisation.scan: pages", () => {
  it("51 open exports: 50 are handled, the next page is queued after the last row, and the continuation handles the rest; nobody is alerted twice", async () => {
    await owners();
    const ids: string[] = [];
    for (let i = 0; i < 51; i++) ids.push((await mkExport("2026-11-03")).id);
    const first = await scan(tick("2027-07-10"));
    expect(first).toMatchObject({ kind: "done", rows: 50, alerts: 50, continued: true });
    expect(fakes.leads).toHaveLength(1);
    const next = fakes.leads[0]?.body as { v: number; kind: string; after: { d: string; id: string } };
    expect(next).toMatchObject({ v: 1, kind: "realisation.scan", after: { d: "2026-11-03" } });
    // ids come back in (issue date, id) order, so the cursor is the 50th id
    expect(next.after.id).toBe([...ids].sort()[49]);
    const second = await scan(tick("2027-07-10"), next.after);
    expect(second).toMatchObject({ kind: "done", rows: 1, alerts: 1, continued: false });
    expect(alertEmails()).toHaveLength(51);
    // a rerun from the top finds every bell and queues nothing more
    fakes.email.length = 0;
    await scan(tick("2027-07-10"));
    await scan(tick("2027-07-10"), next.after);
    expect(alertEmails()).toEqual([]);
  });
});

describe("the queue routes the report family before the lead fall-through", () => {
  const consume = async (queue: string, body: unknown, attempts = 1, env = makeEnv()) => {
    const out: string[] = [];
    await handleQueue(
      {
        queue,
        messages: [
          {
            id: uuidv7(),
            body,
            attempts,
            ack: () => out.push("ack"),
            retry: (o?: { delaySeconds?: number }) => out.push(`retry:${o?.delaySeconds}`),
          },
        ],
      } as never,
      env,
    );
    return out;
  };
  const leads = async () => (await one<{ n: number }>("SELECT count(*) AS n FROM leads"))?.n;

  it("valid and invalid bodies of the three kinds are acknowledged and never become a lead", async () => {
    const before = await leads();
    for (const body of [
      { v: 1, kind: "realisation.scan" },
      { kind: "realisation.scan" },
      { v: 1, kind: "edf.reminder", year: 2026, month: 10 },
      { v: 1, kind: "edf.reminder", year: 2026, month: 13 },
      { v: 1, kind: "statement.purge", asOf: 1 },
      { v: 1, kind: "statement.purge" },
    ])
      expect(await consume("techaust-staging-leads", body), JSON.stringify(body)).toEqual(["ack"]);
    expect(await leads()).toBe(before);
  });

  it("a realisation.scan reaches its consumer, an edf.reminder reaches its consumer", async () => {
    await owners();
    await mkExport("2026-11-03");
    // far in the past of the real clock: the stage is computed against today's real date, so only the routing is asserted here
    await consume("techaust-staging-leads", { v: 1, kind: "realisation.scan" });
    expect(logs.join("\n")).toContain('"ev":"realisation.scan"');
    await consume("techaust-staging-leads", { v: 1, kind: "edf.reminder", year: 2000, month: 1 });
    expect(logs.join("\n")).toContain("edf.no_exports");
  });

  it("the three kinds in the leads dead-letter queue are logged and acknowledged: no alert, no retry", async () => {
    for (const body of [
      { v: 1, kind: "realisation.scan" },
      { v: 1, kind: "edf.reminder", year: 2026, month: 10 },
      { v: 1, kind: "statement.purge", asOf: 1 },
    ])
      expect(await consume("techaust-staging-leads-dlq", body, 5)).toEqual(["ack"]);
    expect(logs.join("\n")).toContain("report.dead_letter");
    expect(logs.join("\n")).not.toContain("queue.dead_letter");
    expect(fakes.email).toEqual([]);
  });
});

// ---- edf.reminder ------------------------------------------------------------------------------------------------------------------------------

describe("edf.reminder [Q55]", () => {
  const edf = (year = 2026, month = 10, env = makeEnv()) =>
    processEdfReminder(env, { v: 1, kind: "edf.reminder", year, month });
  const edfEmails = () => emailsQueued().filter((e) => e.template === "edf.reminder");
  const edfBells = (entity: string) =>
    all<{ user_id: string; title: string; link: string; entity_type: string }>(
      "SELECT user_id, title, link, entity_type FROM notifications WHERE kind = 'edf.due' AND entity_id = ?1 ORDER BY user_id",
      entity,
    );

  it("one email and one bell per active owner for the month's exports; the voided, other months and non-exports are not counted; a repeat adds nothing", async () => {
    const [a, b] = await owners(2, ["Anil Das"]);
    if (!a || !b) throw new Error("owners");
    await staff("staff");
    await mkExport("2026-10-02");
    await mkExport("2026-10-31");
    await mkExport("2026-10-15", { voided: true });
    await mkExport("2026-11-01");
    await mkExport("2026-09-30");
    await mkDoc(await mkClient(), null, { issueDate: "2026-10-10" }); // a tax invoice
    const r = await edf();
    expect(r).toEqual({ kind: "done", exports: 2, owners: 2 });
    expect(
      edfEmails()
        .map((e) => e.to)
        .sort(),
    ).toEqual([a.email, b.email].sort());
    expect(edfEmails()[0]).toMatchObject({
      data: {
        month_label: "October 2026",
        count: "2",
        due_date: "30 Nov 2026",
        link: "https://admin.example/reports/edf?month=2026-10",
      },
      entity: { type: "report", id: "edf:2026-10" },
    });
    expect(edfEmails().find((e) => e.to === a.email)?.data.owner_first_name).toBe("Anil");
    const bells = await edfBells("edf:2026-10");
    expect(bells.map((x) => x.user_id).sort()).toEqual([a.id, b.id].sort());
    expect(bells[0]).toMatchObject({
      title: `EDF list for October 2026 is due by 30 Nov 2026`,
      link: "/reports/edf?month=2026-10",
      entity_type: "report",
    });
    // days 6 and 7 queue it again: the bells are there, so nothing more
    fakes.email.length = 0;
    expect(await edf()).toEqual({ kind: "nobody_to_tell" });
    expect(fakes.email).toEqual([]);
    expect(await edfBells("edf:2026-10")).toHaveLength(2);
  });

  it("an owner added after the first reminder gets it on the next day's catch-up; the first owner does not get it twice", async () => {
    const late = await staff("owner");
    fakes.email.length = 0;
    expect(await edf()).toEqual({ kind: "done", exports: 2, owners: 1 });
    expect(edfEmails().map((e) => e.to)).toEqual([late.email]);
  });

  it("a month without exports sends nothing and writes no bell", async () => {
    expect(await edf(2026, 8)).toEqual({ kind: "no_exports" });
    expect(await edfBells("edf:2026-08")).toEqual([]);
  });

  it("February's last day: 28 days in 2027, 29 in 2028; the due date is 30 days after the month's last day", async () => {
    await mkExport("2027-02-28");
    await mkExport("2028-02-29");
    fakes.email.length = 0;
    await edf(2027, 2);
    expect(edfEmails().every((e) => e.data.due_date === "30 Mar 2027")).toBe(true);
    fakes.email.length = 0;
    await run("DELETE FROM notifications WHERE kind = 'edf.due'");
    await edf(2028, 2);
    expect(edfEmails()[0]?.data).toMatchObject({
      month_label: "February 2028",
      count: "2", // the 29 February 2028 export of this test and the one issued on that day by the month-end test above
      due_date: "30 Mar 2028",
    });
  });

  it("the email is queued before the bell; a queue that fails leaves no bell", async () => {
    await mkExport("2029-03-10");
    const broken = makeEnv({
      EMAIL_QUEUE: {
        sendBatch: async () => {
          throw new Error("queue down");
        },
      },
    });
    await expect(edf(2029, 3, broken)).rejects.toThrow("queue down");
    expect(await edfBells("edf:2029-03")).toEqual([]);
    expect((await edf(2029, 3)).kind).toBe("done");
    expect((await edfBells("edf:2029-03")).length).toBeGreaterThan(0);
  });

  it("an unreadable message is logged and nothing happens", async () => {
    expect(await processEdfReminder(makeEnv(), { v: 1, kind: "edf.reminder", year: 2026, month: 0 })).toEqual(
      { kind: "invalid_message" },
    );
  });
});

// ---- sendBatch in chunks ------------------------------------------------------------------------------------------------------------------------

describe("sendBatch within the Queues limits (100 messages, 256 KB)", () => {
  it("250 small messages go in three calls of 100, 100 and 50, in order", async () => {
    const calls: number[][] = [];
    const queue = {
      sendBatch: async (items: { body: number }[]) => void calls.push(items.map((i) => i.body)),
    };
    const bodies = Array.from({ length: 250 }, (_, i) => i);
    expect(await sendChunked(queue as never, bodies)).toBe(3);
    expect(calls.map((c) => c.length)).toEqual([SEND_BATCH_MAX_MESSAGES, SEND_BATCH_MAX_MESSAGES, 50]);
    expect(calls.flat()).toEqual(bodies);
  });

  it("messages of about 40 KB are split by size: a call never carries more than 256 KB in total", () => {
    const big = "x".repeat(40_000);
    const chunks = chunksOf(Array.from({ length: 20 }, () => ({ big })));
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(5);
      expect(JSON.stringify(c).length + c.length * 100).toBeLessThanOrEqual(SEND_BATCH_MAX_BYTES + 5_000);
    }
    expect(chunks.flat()).toHaveLength(20);
  });

  it("nothing to send is no call; one message is one call", async () => {
    const calls: number[] = [];
    const queue = { sendBatch: async (items: unknown[]) => void calls.push(items.length) };
    expect(await sendChunked(queue as never, [])).toBe(0);
    expect(await sendChunked(queue as never, ["a"])).toBe(1);
    expect(calls).toEqual([1]);
  });

  it("a scan page of 50 exports and 5 owners (250 emails) reaches the email queue in chunks of at most 100", async () => {
    await owners(5);
    for (let i = 0; i < 50; i++) await mkExport("2026-11-03");
    fakes.emailBatches.length = 0;
    await scan(tick("2027-07-10"));
    expect(alertEmails()).toHaveLength(250);
    expect(fakes.emailBatches).toEqual([100, 100, 50]);
  });
});
