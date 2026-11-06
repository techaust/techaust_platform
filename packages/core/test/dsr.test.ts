// M7.4 B.1: the data-request clock and close rules [ADM-SET-09, POR-11] (run file docs/runs/m7.4-data-protection.md, section I).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysBetween, fromIst, istDate, istDayEnd } from "../src/dates.ts";
import {
  ACK_WINDOW_MS,
  ackDueAt,
  CHANNELS,
  closeVerdict,
  DECLINE_REASONS,
  daysLeft,
  dueSoonBound,
  EMAIL_ONLY_DECLINE_REASONS,
  IDENTITY_CHECKED_KINDS,
  isChannel,
  isDeclineReason,
  isDsrKind,
  loggedReceivedAt,
  REQUEST_KINDS,
  requestDueAt,
  requestDueAtSql,
  requestDueDay,
  requestState,
  STAFF_CHANNELS,
} from "../src/dsr.ts";
import { REQUEST_KINDS as PORTAL_KINDS } from "../src/portal.ts";

/** An IST wall-clock instant, "2027-01-31 10:00" → UTC ms. */
const ist = (s: string) => {
  const [d, t = "00:00"] = s.split(" ");
  const [y, m, day] = (d as string).split("-").map(Number);
  const [h, min] = t.split(":").map(Number);
  return fromIst({ year: y as number, month: m as number, day: day as number }, h, min);
};
const dayEnd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return istDayEnd({ year: y as number, month: m as number, day: d as number });
};
const DAY = 86_400_000;

describe("requestDueAt: the earlier of 30 days and one calendar month, end of the IST day [M.2]", () => {
  it("31 Jan 2027 → 28 Feb 2027 23:59:59.999 IST (the month is clamped and is the earlier)", () => {
    expect(requestDueAt(ist("2027-01-31 10:00"))).toBe(dayEnd("2027-02-28"));
    expect(new Date(requestDueAt(ist("2027-01-31 10:00"))).toISOString()).toBe("2027-02-28T18:29:59.999Z");
  });
  it("30 Jan 2028 (leap year) → 29 Feb 2028", () => {
    expect(requestDueAt(ist("2028-01-30 09:00"))).toBe(dayEnd("2028-02-29"));
  });
  it("1 Jul 2026 → 31 Jul 2026 (30 days is the earlier)", () => {
    expect(requestDueAt(ist("2026-07-01 12:00"))).toBe(dayEnd("2026-07-31"));
  });
  it("00:05 and 23:55 IST on the same day share one reply date", () => {
    expect(requestDueAt(ist("2026-11-06 00:05"))).toBe(requestDueAt(ist("2026-11-06 23:55")));
    expect(requestDueAt(ist("2026-11-06 23:55"))).toBe(dayEnd("2026-12-06"));
  });
  it("counts from the IST day, not the UTC day (02:00 IST on 1 Jul is still 30 Jun in UTC)", () => {
    const t = ist("2026-07-01 02:00");
    expect(new Date(t).toISOString().slice(0, 10)).toBe("2026-06-30");
    expect(requestDueAt(t)).toBe(dayEnd("2026-07-31"));
    // the last minute of 30 Jun IST counts from 30 Jun
    expect(requestDueAt(ist("2026-06-30 23:59"))).toBe(dayEnd("2026-07-30"));
  });
  it("other month ends: 31 Mar → 30 Apr, 31 Dec → 30 Jan, 29 Feb → 29 Mar", () => {
    expect(requestDueDay(ist("2027-03-31 10:00"))).toEqual({ year: 2027, month: 4, day: 30 });
    expect(requestDueDay(ist("2026-12-31 10:00"))).toEqual({ year: 2027, month: 1, day: 30 });
    expect(requestDueDay(ist("2028-02-29 10:00"))).toEqual({ year: 2028, month: 3, day: 29 });
    expect(requestDueDay(ist("2027-02-01 10:00"))).toEqual({ year: 2027, month: 3, day: 1 });
  });
  it("property: due ≤ +30 days and ≤ +1 month, never before the request, always an IST day end", () => {
    const from = Date.UTC(2026, 0, 1);
    const to = Date.UTC(2040, 0, 1);
    fc.assert(
      fc.property(fc.integer({ min: from, max: to }), (t) => {
        const due = requestDueAt(t);
        const day = istDate(t);
        expect(due).toBeGreaterThan(t);
        expect(due).toBe(istDayEnd(istDate(due)));
        expect(daysBetween(istDate(due), addDays(day, 30))).toBeGreaterThanOrEqual(0);
        expect(daysBetween(istDate(due), addMonths(day, 1))).toBeGreaterThanOrEqual(0);
        // and it is one of the two (never earlier than both)
        const d = istDate(due);
        const a = addDays(day, 30);
        const b = addMonths(day, 1);
        expect(daysBetween(d, a) === 0 || daysBetween(d, b) === 0).toBe(true);
        // at least 28 days to reply
        expect(daysBetween(day, d)).toBeGreaterThanOrEqual(28);
      }),
    );
  });
});

describe("ackDueAt: 48 hours", () => {
  it("adds 48 hours", () => {
    expect(ackDueAt(1_000)).toBe(1_000 + 48 * 3_600_000);
    expect(ACK_WINDOW_MS).toBe(172_800_000);
  });
  it("refuses a time that is not whole milliseconds", () => {
    expect(() => ackDueAt(1.5)).toThrow(RangeError);
  });
});

describe("requestDueAtSql: the SQL twin's text (its values are held equal to requestDueAt by a db test, A)", () => {
  it("names the expression it is given and clamps the month", () => {
    const sql = requestDueAtSql("r.created_at");
    expect(sql).toContain("(r.created_at) + 19800000");
    expect(sql).toContain("'+30 days'");
    expect(sql).toContain("'start of month', '+2 months', '-1 day'");
    expect(sql.startsWith("((CAST(strftime('%s', min(")).toBe(true);
  });
});

describe("loggedReceivedAt: the IST day staff type, never in the future", () => {
  const now = ist("2026-11-06 10:00");
  it("today and earlier days give the start of that IST day", () => {
    expect(loggedReceivedAt("2026-11-06", now)).toBe(ist("2026-11-06 00:00"));
    expect(loggedReceivedAt("2026-10-01", now)).toBe(ist("2026-10-01 00:00"));
  });
  it("a future day, a malformed or impossible date is null", () => {
    expect(loggedReceivedAt("2026-11-07", now)).toBeNull();
    expect(loggedReceivedAt("2026-02-30", now)).toBeNull();
    expect(loggedReceivedAt("6/11/2026", now)).toBeNull();
  });
  it("uses the IST day for 'today' (00:30 IST is the previous UTC day)", () => {
    const early = ist("2026-11-06 00:30");
    expect(loggedReceivedAt("2026-11-06", early)).toBe(ist("2026-11-06 00:00"));
    expect(loggedReceivedAt("2026-11-07", ist("2026-11-06 23:59"))).toBeNull();
  });
});

describe("requestState and daysLeft", () => {
  const received = ist("2026-11-06 10:00");
  const row = {
    status: "open",
    dueAt: requestDueAt(received),
    ackDueAt: ackDueAt(received),
    acknowledgedAt: null as number | null,
  };
  it("open, then ack_overdue after 48 hours unacknowledged", () => {
    expect(requestState(row, received + DAY)).toBe("open");
    expect(requestState(row, received + ACK_WINDOW_MS)).toBe("open");
    expect(requestState(row, received + ACK_WINDOW_MS + 1)).toBe("ack_overdue");
    expect(requestState({ ...row, acknowledgedAt: received + DAY }, received + 3 * DAY)).toBe("open");
  });
  it("due_soon from 5 IST days before the reply day, overdue after its last millisecond", () => {
    // due 6 Dec 2026
    expect(requestState({ ...row, acknowledgedAt: received }, ist("2026-11-30 23:59"))).toBe("open");
    expect(requestState({ ...row, acknowledgedAt: received }, ist("2026-12-01 00:00"))).toBe("due_soon");
    expect(requestState({ ...row, acknowledgedAt: received }, dayEnd("2026-12-06"))).toBe("due_soon");
    expect(requestState({ ...row, acknowledgedAt: received }, dayEnd("2026-12-06") + 1)).toBe("overdue");
  });
  it("the reply date wins over a missing acknowledgement", () => {
    expect(requestState(row, ist("2026-12-02 10:00"))).toBe("due_soon");
    expect(requestState(row, ist("2026-12-08 10:00"))).toBe("overdue");
  });
  it("closed is closed; a row with no clock is open", () => {
    expect(requestState({ ...row, status: "closed" }, ist("2027-06-01 10:00"))).toBe("closed");
    expect(
      requestState({ status: "open", dueAt: null, ackDueAt: null, acknowledgedAt: null }, received),
    ).toBe("open");
  });
  it("daysLeft counts IST days to the reply day (0 on it, negative after)", () => {
    expect(daysLeft(row.dueAt, received)).toBe(30);
    expect(daysLeft(row.dueAt, ist("2026-12-06 23:00"))).toBe(0);
    expect(daysLeft(row.dueAt, ist("2026-12-08 01:00"))).toBe(-2);
  });
  it("dueSoonBound is the end of the IST day 5 days ahead", () => {
    expect(dueSoonBound(ist("2026-12-01 00:00"))).toBe(dayEnd("2026-12-06"));
  });
});

describe("enumerations (pinned to the M7.4 triggers in A)", () => {
  it("seven kinds: M7.1's five, then consent_withdrawal and nomination", () => {
    expect(REQUEST_KINDS).toEqual([...PORTAL_KINDS, "consent_withdrawal", "nomination"]);
    expect(REQUEST_KINDS).toHaveLength(7);
    expect(isDsrKind("nomination")).toBe(true);
    expect(isDsrKind("export")).toBe(false);
    expect(isDsrKind(3)).toBe(false);
  });
  it("channels and decline reasons", () => {
    expect(CHANNELS).toEqual(["portal", "email", "post", "phone", "in_person"]);
    expect(STAFF_CHANNELS).not.toContain("portal");
    expect(isChannel("post")).toBe(true);
    expect(isChannel("fax")).toBe(false);
    expect(DECLINE_REASONS).toEqual([
      "legal_hold",
      "law_requires_keeping",
      "identity_not_confirmed",
      "duplicate",
      "not_on_record",
      "other",
    ]);
    expect(isDeclineReason("other")).toBe(true);
    expect(isDeclineReason("busy")).toBe(false);
    for (const r of EMAIL_ONLY_DECLINE_REASONS) expect(DECLINE_REASONS).toContain(r);
    expect(EMAIL_ONLY_DECLINE_REASONS).not.toContain("legal_hold");
    expect(EMAIL_ONLY_DECLINE_REASONS).not.toContain("law_requires_keeping");
  });
});

describe("closeVerdict (C.4; the trigger holds the same rules, A.6)", () => {
  const checked = { identityCheckedAt: 1_000 };
  const contactErase = { kind: "data_erasure", status: "open", contactRef: "c1", leadRef: null, ...checked };
  const emailOnly = { kind: "data_erasure", status: "open", contactRef: null, leadRef: null, ...checked };
  const access = { kind: "data_access", status: "open", contactRef: "c1", leadRef: null, ...checked };
  const no = (code: string) => ({ ok: false, code });
  it("a closed request can't be closed again", () => {
    expect(closeVerdict({ ...access, status: "closed" }, { outcome: "done" })).toEqual(no("request_closed"));
  });
  it("declined needs a known reason, and nothing else", () => {
    expect(closeVerdict(access, { outcome: "declined" })).toEqual(no("decline_reason_required"));
    expect(closeVerdict(access, { outcome: "declined", declineReason: null })).toEqual(
      no("decline_reason_required"),
    );
    expect(closeVerdict(access, { outcome: "declined", declineReason: "busy" })).toEqual(
      no("decline_reason_not_allowed"),
    );
    expect(closeVerdict(access, { outcome: "declined", declineReason: "legal_hold" })).toEqual({ ok: true });
    expect(
      closeVerdict(contactErase, { outcome: "declined", declineReason: "duplicate", actionAuditId: "a1" }),
    ).toEqual(no("action_not_allowed"));
    expect(closeVerdict(access, { outcome: "declined", declineReason: "other", exportSentAt: 5 })).toEqual(
      no("export_sent_not_allowed"),
    );
  });
  it("done takes no decline reason", () => {
    expect(closeVerdict(access, { outcome: "done", declineReason: "other" })).toEqual(
      no("decline_reason_not_allowed"),
    );
  });
  it("a done erasure names the audit row of the erase that fulfilled it", () => {
    expect(closeVerdict(contactErase, { outcome: "done" })).toEqual(no("action_required"));
    expect(closeVerdict(contactErase, { outcome: "done", actionAuditId: "" })).toEqual(no("action_required"));
    expect(closeVerdict(contactErase, { outcome: "done", actionAuditId: "a1" })).toEqual({ ok: true });
    expect(
      closeVerdict(
        { ...contactErase, contactRef: null, leadRef: "l1" },
        { outcome: "done", actionAuditId: "a1" },
      ),
    ).toEqual({ ok: true });
  });
  it("L28: an address-only erasure request closes only as declined, for an L28 reason", () => {
    expect(closeVerdict(emailOnly, { outcome: "done", actionAuditId: "a1" })).toEqual(
      no("action_not_allowed"),
    );
    for (const r of EMAIL_ONLY_DECLINE_REASONS)
      expect(closeVerdict(emailOnly, { outcome: "declined", declineReason: r })).toEqual({ ok: true });
    expect(closeVerdict(emailOnly, { outcome: "declined", declineReason: "legal_hold" })).toEqual(
      no("decline_reason_not_allowed"),
    );
    expect(closeVerdict(emailOnly, { outcome: "declined", declineReason: "law_requires_keeping" })).toEqual(
      no("decline_reason_not_allowed"),
    );
    // an address-only request of another kind may still close done
    expect(closeVerdict({ ...emailOnly, kind: "grievance" }, { outcome: "done" })).toEqual({ ok: true });
  });
  it("'Export sent' (Q2 A) only on a done access request, as a time", () => {
    expect(closeVerdict(access, { outcome: "done", exportSentAt: 1_000 })).toEqual({ ok: true });
    expect(closeVerdict(access, { outcome: "done", exportSentAt: null })).toEqual({ ok: true });
    expect(closeVerdict(access, { outcome: "done", exportSentAt: -1 })).toEqual(
      no("export_sent_not_allowed"),
    );
    expect(closeVerdict(access, { outcome: "done", exportSentAt: 1.5 })).toEqual(
      no("export_sent_not_allowed"),
    );
    expect(closeVerdict(contactErase, { outcome: "done", actionAuditId: "a1", exportSentAt: 1_000 })).toEqual(
      no("export_sent_not_allowed"),
    );
  });
  it("L42: access, correction, erasure and nomination close done only once the identity is checked; declined and the other kinds need no check", () => {
    expect(IDENTITY_CHECKED_KINDS).toEqual(["data_access", "data_correction", "data_erasure", "nomination"]);
    const unchecked = { identityCheckedAt: null };
    for (const kind of IDENTITY_CHECKED_KINDS)
      expect(
        closeVerdict({ ...access, ...unchecked, kind }, { outcome: "done", actionAuditId: "a1" }),
        kind,
      ).toEqual(no("identity_not_checked"));
    expect(closeVerdict(access, { outcome: "done" })).toEqual({ ok: true });
    expect(
      closeVerdict(
        { ...access, ...unchecked },
        { outcome: "declined", declineReason: "identity_not_confirmed" },
      ),
    ).toEqual({ ok: true });
    for (const kind of ["grievance", "contact_change", "consent_withdrawal"])
      expect(closeVerdict({ ...access, ...unchecked, kind }, { outcome: "done" }), kind).toEqual({
        ok: true,
      });
  });
});
