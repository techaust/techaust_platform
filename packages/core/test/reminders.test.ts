// Payment reminders [ADM-INV-13, ADM-SET-05, LD60, LD64]: the rows made at the first send, the 09:00 to 19:00 IST window, and the stop rules in TypeScript.
import { describe, expect, it } from "vitest";
import { fromIst, toIsoDate, toIst } from "../src/dates.ts";
import {
  inWindow,
  isFinalSkip,
  isReminderType,
  istHourOf,
  nextWindowStart,
  REMINDER_TYPES,
  type ReminderFacts,
  reminderPolicy,
  reminderRows,
  skipReasonOf,
} from "../src/reminders.ts";

const at = (y: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0) =>
  fromIst({ year: y, month: m, day: d }, h, mi, s) + ms;
const W = { fromHour: 9, toHour: 19 };
const settings = { reminderOffsetsDays: [-3, 0, 3, 7, 14], reminderWindowIst: W };

describe("reminderPolicy", () => {
  it("the settings' offsets and window, on, unless the client says otherwise", () => {
    expect(reminderPolicy(settings, null)).toEqual({ enabled: true, offsets: [-3, 0, 3, 7, 14], window: W });
    expect(reminderPolicy(settings, {})).toEqual({ enabled: true, offsets: [-3, 0, 3, 7, 14], window: W });
  });
  it("a client's offsets replace the settings' (sorted, distinct); an empty list falls back; off is off", () => {
    expect(reminderPolicy(settings, { offsetsDays: [7, 0, 7, -1] }).offsets).toEqual([-1, 0, 7]);
    expect(reminderPolicy(settings, { offsetsDays: [] }).offsets).toEqual([-3, 0, 3, 7, 14]);
    expect(reminderPolicy(settings, { enabled: false }).enabled).toBe(false);
    expect(reminderPolicy(settings, { enabled: true, offsetsDays: [2] })).toEqual({
      enabled: true,
      offsets: [2],
      window: W,
    });
  });
  it("a later settings change is a different input, not a mutation of what was computed", () => {
    const before = reminderPolicy(settings, null);
    reminderPolicy({ ...settings, reminderOffsetsDays: [1] }, null);
    expect(before.offsets).toEqual([-3, 0, 3, 7, 14]);
  });
});

describe("reminderRows: exact days at the window's opening hour, only after the send day", () => {
  const offsets = [-3, 0, 3, 7, 14];
  it("every default offset, 09:00 IST, for an invoice sent well before its due date", () => {
    const rows = reminderRows("2026-11-10", offsets, 9, "2026-11-01");
    expect(rows.map((r) => r.offset)).toEqual(offsets);
    expect(rows.map((r) => toIsoDate({ ...toIst(r.dueAt) }))).toEqual([
      "2026-11-07",
      "2026-11-10",
      "2026-11-13",
      "2026-11-17",
      "2026-11-24",
    ]);
    for (const r of rows) expect(toIst(r.dueAt)).toMatchObject({ hour: 9, minute: 0, second: 0 });
  });
  it("the window's opening hour is the due hour", () => {
    expect(toIst(reminderRows("2026-11-10", [0], 10, "2026-11-01")[0]?.dueAt ?? 0).hour).toBe(10);
  });
  it("sent on the due date: only the future offsets; sent on the day of an offset: that offset is not made", () => {
    expect(reminderRows("2026-11-10", offsets, 9, "2026-11-10").map((r) => r.offset)).toEqual([3, 7, 14]);
    expect(reminderRows("2026-11-10", offsets, 9, "2026-11-07").map((r) => r.offset)).toEqual([0, 3, 7, 14]);
    expect(reminderRows("2026-11-10", offsets, 9, "2026-11-13").map((r) => r.offset)).toEqual([7, 14]);
  });
  it("sent after the last offset: none", () => {
    expect(reminderRows("2026-11-10", offsets, 9, "2026-11-24")).toEqual([]);
    expect(reminderRows("2026-11-10", offsets, 9, "2027-01-01")).toEqual([]);
  });
  it("month ends: due 31 Jan + 3 is 3 Feb; due 31 Mar + 3 is 3 Apr; due 28 Feb 2027 + 3 is 3 Mar; 29 Feb 2028 + 1", () => {
    const day = (due: string, offset: number) =>
      toIsoDate(toIst(reminderRows(due, [offset], 9, "2020-01-01")[0]?.dueAt ?? 0));
    expect(day("2027-01-31", 3)).toBe("2027-02-03");
    expect(day("2027-03-31", 3)).toBe("2027-04-03");
    expect(day("2027-02-28", 3)).toBe("2027-03-03");
    expect(day("2028-02-28", 1)).toBe("2028-02-29");
    expect(day("2028-02-29", 1)).toBe("2028-03-01");
    expect(day("2026-12-31", 14)).toBe("2027-01-14");
  });
  it("duplicate offsets give one row; a bad date or hour throws", () => {
    expect(reminderRows("2026-11-10", [3, 3, 3], 9, "2026-11-01")).toHaveLength(1);
    expect(() => reminderRows("nope", [0], 9, "2026-11-01")).toThrow(RangeError);
    expect(() => reminderRows("2026-11-10", [0], 24, "2026-11-01")).toThrow(RangeError);
  });
});

describe("the window: 09:00 inclusive, 19:00 exclusive, IST", () => {
  it("nothing at 08:00 or 19:00 and after; everything from 09:00:00.000 to 18:59:59.999", () => {
    expect(inWindow(at(2026, 11, 10, 8, 59, 59, 999), W)).toBe(false);
    expect(inWindow(at(2026, 11, 10, 9), W)).toBe(true);
    expect(inWindow(at(2026, 11, 10, 12, 30), W)).toBe(true);
    expect(inWindow(at(2026, 11, 10, 18, 59, 59, 999), W)).toBe(true);
    expect(inWindow(at(2026, 11, 10, 19), W)).toBe(false);
    expect(inWindow(at(2026, 11, 10, 19, 0, 0, 1), W)).toBe(false);
    expect(inWindow(at(2026, 11, 10, 23, 59, 59, 999), W)).toBe(false);
    expect(inWindow(at(2026, 11, 10, 0), W)).toBe(false);
  });
  it("all 24 hours of an IST day", () => {
    const inside = Array.from({ length: 24 }, (_, h) => h).filter((h) => inWindow(at(2026, 11, 10, h), W));
    expect(inside).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(istHourOf(at(2026, 11, 10, 23, 59, 59, 999))).toBe(23);
    expect(istHourOf(at(2026, 11, 11, 0))).toBe(0);
  });
  it("a window that runs to midnight (toHour 24) is open until the day ends", () => {
    expect(inWindow(at(2026, 11, 10, 23, 59, 59, 999), { fromHour: 20, toHour: 24 })).toBe(true);
    expect(inWindow(at(2026, 11, 11, 0), { fromHour: 20, toHour: 24 })).toBe(false);
  });
  it("the next opening: now when open, today's opening when it is early, tomorrow's when it is late", () => {
    const open = at(2026, 11, 10, 11, 5);
    expect(nextWindowStart(open, W)).toBe(open);
    expect(nextWindowStart(at(2026, 11, 10, 6, 30), W)).toBe(at(2026, 11, 10, 9));
    expect(nextWindowStart(at(2026, 11, 10, 19), W)).toBe(at(2026, 11, 11, 9));
    expect(nextWindowStart(at(2026, 11, 10, 23, 59, 59, 999), W)).toBe(at(2026, 11, 11, 9));
    expect(nextWindowStart(at(2026, 11, 11, 0), W)).toBe(at(2026, 11, 11, 9));
    // across a month end and a year end
    expect(nextWindowStart(at(2026, 12, 31, 20), W)).toBe(at(2027, 1, 1, 9));
  });
});

describe("skipReasonOf: the twin of the claim", () => {
  const live: ReminderFacts = {
    sentAt: null,
    skippedReason: null,
    dueAt: 1_000,
    frozen: true,
    type: "tax_invoice",
    status: "issued",
    balanceMinor: 100,
    voided: false,
    clientAnonymised: false,
    policyEnabled: true,
    hasRecipient: true,
    laterDue: false,
  };
  const now = 2_000;
  const cases: [string, Partial<ReminderFacts>, string | null][] = [
    ["a live invoice sends", {}, null],
    ["a part-paid invoice sends", { status: "partially_paid" }, null],
    ["a part-credited invoice sends", { status: "partially_credited" }, null],
    ["every chased type sends", { type: "proforma" }, null],
    ["a debit note sends", { type: "debit_note" }, null],
    ["already sent", { sentAt: 5 }, "sent"],
    ["paused", { skippedReason: "paused" }, "paused"],
    ["a final skip stays", { skippedReason: "void" }, "void"],
    ["not due yet", { dueAt: 3_000 }, "not_due"],
    ["a draft", { frozen: false }, "not_issued"],
    ["void by status", { status: "void" }, "void"],
    ["void by timestamp", { voided: true }, "void"],
    ["a credit note is never chased", { type: "credit_note" }, "type"],
    ["a receipt is not chased", { type: "receipt" }, "type"],
    ["paid", { status: "paid" }, "paid"],
    ["fully credited", { status: "credited" }, "credited"],
    [
      "a part-paid proforma (converted, a balance left) is still chased (Q47)",
      { type: "proforma", status: "converted" },
      null,
    ],
    ["a settled converted proforma", { type: "proforma", status: "converted", balanceMinor: 0 }, "paid"],
    ["converted is closed for any other type", { type: "debit_note", status: "converted" }, "converted"],
    ["an unknown status", { status: "weird" }, "status"],
    ["nothing left to pay", { balanceMinor: 0 }, "paid"],
    ["an anonymised client", { clientAnonymised: true }, "anonymised"],
    ["the client's policy is off", { policyEnabled: false }, "policy_off"],
    ["no contact can be written to", { hasRecipient: false }, "no_recipient"],
    ["a later offset is already due", { laterDue: true }, "superseded"],
  ];
  for (const [name, over, want] of cases)
    it(name, () => expect(skipReasonOf({ ...live, ...over }, now)).toBe(want));

  it("only paused and the states are not final", () => {
    expect(isFinalSkip("void")).toBe(true);
    expect(isFinalSkip("superseded")).toBe(true);
    expect(isFinalSkip("paused")).toBe(false);
    expect(isFinalSkip("sent")).toBe(false);
    expect(isFinalSkip("not_due")).toBe(false);
    expect(isFinalSkip(null)).toBe(false);
  });
  it("the chased types are the four of the brief", () => {
    expect([...REMINDER_TYPES]).toEqual(["tax_invoice", "export_invoice", "proforma", "debit_note"]);
    expect(isReminderType("credit_note")).toBe(false);
    expect(isReminderType(7)).toBe(false);
  });
});
