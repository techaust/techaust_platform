// The M3.5 screens' rules [ADM-CARE-01, ADM-CARE-03, ADM-TIME-01..03, ADM-DASH-01, ADM-PRJ-05]: the 07-M copy word for word, every
// sentence 07-M lacks marked as a placeholder, errors by API code, hours as words, the hours bar, the plan and terms forms (only
// changed terms sent, with their summary for the money confirmation), the entry form (15-minute steps, at most 24 hours, the date
// rules), the lock states, the timesheet rows, and the CSV export with formula-injection defused.
import { describe, expect, it } from "vitest";
import {
  type CareDefaults,
  type CareTerms,
  RequestError,
  type TimeEntry,
  type TimeWeekGroup,
} from "../api.ts";
import {
  CARE_COPY,
  CARE_PENDING,
  CARE_TOASTS,
  cancelPlanConfirm,
  careErrorText,
  careMoves,
  clockText,
  durationMinutes,
  flagText,
  hoursBar,
  hoursLoggedLine,
  hoursText,
  invalidCareTransition,
  newestTerms,
  pauseConfirm,
  pendingTermsLine,
  periodText,
  planFormFor,
  planInput,
  planName,
  resumeConfirm,
  statusDate,
  statusToast,
  termsChange,
  termsConfirm,
  termsDate,
  termsFormOf,
} from "./care.ts";

/** The mark a line not yet approved would carry (none should). */
const PLACEHOLDER_TAG = "[Placeholder]";

import {
  ACTIVITY_PENDING,
  activityHref,
  activityText,
  DASH_COPY,
  showingFirst,
  TILE_TITLES,
} from "./dashboard.ts";
import { DATE_INVALID, isUnread, settledValue } from "./date-field.ts";
import {
  CSV_COLUMNS,
  earliestDate,
  entryFormOf,
  entryInput,
  entryMinutes,
  exportRangeOk,
  lockState,
  nextWeek,
  previousWeek,
  rowTotal,
  sheetRows,
  TIME_COPY,
  TIME_PENDING,
  TIME_TOASTS,
  targetOf,
  timeCsv,
  weekDays,
  weekHeading,
  weekStartFrom,
} from "./time.ts";

// Sample data only (clearly fake).
const terms = (over: Partial<CareTerms> = {}): CareTerms => ({
  effectiveFrom: "2026-10-01",
  tier: "growth",
  priceMinor: 2_500_000,
  includedMinutes: 600,
  aiOpsMinor: null,
  overageRateMinor: 150_000,
  rollover: "one_month",
  createdAt: 1,
  ...over,
});
const defaults: CareDefaults = {
  currency: "INR",
  clientAnonymised: false,
  tiers: {
    essential: { priceMinor: 999_900, includedMinutes: 120, rollover: "none" },
    growth: { priceMinor: 2_499_900, includedMinutes: null, rollover: "one_month" },
    scale: { priceMinor: null, includedMinutes: null, rollover: "one_month" },
    dev_subscription: { priceMinor: 8_000_000, includedMinutes: null, rollover: "none" },
    custom: { priceMinor: null, includedMinutes: null, rollover: "none" },
  },
  aiOpsMinor: 500_000,
  overageRateMinor: null,
  undecided: ["includedMinutes", "overageRateMinor"],
};
const entry = (over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: "t1",
  userId: "u1",
  userName: "Sample Staff (sample)",
  workDate: "2026-10-20",
  minutes: 90,
  billable: true,
  note: null,
  projectId: "p1",
  projectCode: "PRJ-0001",
  carePlanId: null,
  carePlanClientCode: null,
  carePlanTier: null,
  createdAt: 1_000,
  updatedAt: 2_000,
  canEdit: true,
  ...over,
});
const err = (code: string, message = "Server words") => new RequestError(409, code, message);

describe("07-M copy, word for word (draft pending the owner)", () => {
  it("care plans", () => {
    expect(`${CARE_COPY.listEmptyTitle}. ${CARE_COPY.listEmptyBody}`).toBe(
      "No care plans yet. A care plan starts when a client signs up for monthly support.",
    );
    expect(CARE_COPY.listNoMatch).toBe("Try fewer filters.");
    expect(CARE_COPY.currencyLine).toBe("The plan uses the client's currency.");
    expect(CARE_COPY.includedHint).toBe(
      "In steps of 15 minutes. Leave empty if the plan has no included hours.",
    );
    expect(CARE_COPY.overageRateHint).toBe("Charged per hour above the included hours, before GST.");
    expect(CARE_COPY.rolloverHint).toBe("Unused hours carry over to the next billing period only.");
    expect(CARE_COPY.billingDayHint).toBe(
      "Day 1 to 28. The plan's hours count from this day to the day before it in the next month.",
    );
    expect([
      CARE_COPY.included,
      CARE_COPY.carriedOver,
      CARE_COPY.used,
      CARE_COPY.remaining,
      CARE_COPY.overage,
    ]).toEqual(["Included", "Carried over", "Used", "Remaining", "Overage"]);
    expect([CARE_COPY.near, CARE_COPY.reached]).toEqual(["Near the limit", "Limit reached"]);
    expect(CARE_COPY.noRate).toBe("No overage rate set, so the overage can't be priced.");
    expect(CARE_COPY.beforeGst).toBe("Amounts are before GST.");
    expect(CARE_COPY.addToInvoice).toBe(
      "Adding overage to the next invoice arrives with recurring invoices.",
    );
    expect(`${CARE_COPY.clientTabEmptyTitle}.`).toBe("No care plans for this client yet.");
    expect(periodText({ start: "2026-11-05", end: "2026-12-04" })).toBe("05 Nov 2026 to 04 Dec 2026");
    expect(pendingTermsLine("2026-12-05")).toBe("New terms from 05 Dec 2026.");
  });

  it("confirmations and toasts", () => {
    const plan = planName("growth", "Riverside Clinic (sample)");
    expect(plan).toBe("the Growth plan for Riverside Clinic (sample)");
    expect(termsConfirm(plan, "2026-12-05")).toBe(
      "Change the terms of the Growth plan for Riverside Clinic (sample) from 05 Dec 2026? The current billing period keeps its terms.",
    );
    expect(pauseConfirm(plan, "2026-11-20")).toBe(
      "Pause the Growth plan for Riverside Clinic (sample) from 20 Nov 2026? No time can be logged to it while it's paused.",
    );
    expect(resumeConfirm(plan, "2026-11-20")).toBe(
      "Resume the Growth plan for Riverside Clinic (sample) from 20 Nov 2026?",
    );
    expect(cancelPlanConfirm(plan, "2026-11-20")).toBe(
      "Cancel the Growth plan for Riverside Clinic (sample) from 20 Nov 2026? This can't be undone. To restart, create a new plan.",
    );
    expect(CARE_TOASTS.added).toBe("Care plan added.");
    expect(CARE_TOASTS.termsChanged("2026-12-05")).toBe("Terms changed from 05 Dec 2026.");
    expect([statusToast("paused"), statusToast("active"), statusToast("cancelled")]).toEqual([
      "Care plan paused.",
      "Care plan resumed.",
      "Care plan cancelled.",
    ]);
    expect([TIME_TOASTS.logged, TIME_TOASTS.saved, TIME_TOASTS.deleted]).toEqual([
      "Time logged.",
      "Time entry saved.",
      "Time entry deleted.",
    ]);
  });

  it("time", () => {
    expect(weekHeading("2026-10-26")).toBe("Week of 26 Oct 2026");
    expect([TIME_COPY.total, TIME_COPY.billable, TIME_COPY.nonBillable]).toEqual([
      "Total",
      "Billable",
      "Non-billable",
    ]);
    expect(TIME_COPY.minutesHint).toBe("Minutes in steps of 15, up to 24 hours a day.");
    expect(TIME_COPY.targetHint).toBe("Choose a project or a care plan.");
    expect(TIME_COPY.logFor).toBe("Log time for");
    expect(TIME_COPY.locked).toBe(
      "Entries lock 7 days after they're made. Only the owner can change them after that.",
    );
    expect(TIME_COPY.ownerOverride).toBe(
      "This entry is locked for its author. Your change is recorded in the audit log.",
    );
    expect(TIME_COPY.emptyWeek).toBe("No time logged this week.");
    expect([...CSV_COLUMNS]).toEqual([
      "Date",
      "Person",
      "Project or care plan",
      "Minutes",
      "Billable",
      "Note",
    ]);
  });

  it("dashboard and the project page", () => {
    expect(Object.values(TILE_TITLES)).toEqual([
      "Leads",
      "Pipeline",
      "Invoiced and collected",
      "Projects",
      "Milestones due in 14 days",
      "Care plan hours",
      "My time",
      "Recent activity",
    ]);
    // M5.5b (on purpose): 07-V §7 replaces 07-J's line (07-V approved 2026-10-28).
    expect(DASH_COPY.financeArrives).toBe("Collected figures arrive with payments.");
    expect(DASH_COPY.paymentsArrive).toBe("Payments waiting for checks arrive with payments.");
    // 07-Y item 4 (owner 2026-10-29): the finance foot line is one sentence
    expect(DASH_COPY.footLine).toBe(
      "Collected figures and payments waiting for checks arrive with payments.",
    );
    expect([DASH_COPY.notStarted, DASH_COPY.system]).toEqual(["Not started", "System"]);
    expect(showingFirst(20)).toBe("Showing the first 20.");
    expect([
      DASH_COPY.noLeads,
      DASH_COPY.noMilestones,
      DASH_COPY.noCarePlans,
      DASH_COPY.noTime,
      DASH_COPY.noActivity,
    ]).toEqual([
      "No open leads.",
      "No milestones due in the next 14 days.",
      "No active care plans.",
      "No time logged this week.",
      "No recent activity.",
    ]);
    expect(hoursLoggedLine(750, 600)).toBe("12 h 30 min, of which 10 h billable");
  });

  it("errors by API code", () => {
    const cases: [string, string][] = [
      ["day_cap", "That would take this person over 24 hours on that day."],
      ["plan_not_active", "The care plan isn't active on that date."],
      ["project_closed", "The project is cancelled, so its time can't change."],
      ["time_locked", "This entry is locked. Only the owner can change it now."],
      ["owner_only_date", "Only the owner can log time more than 7 days back."],
      ["future_date", "Time can't be logged for a future date."],
      ["one_target", "Choose a project or a care plan, not both."],
      ["plan_cancelled", "This care plan is cancelled."],
      [
        "client_anonymised",
        "This client's personal details were removed, so nothing new can be added to it.",
      ],
      ["bad_user", "Choose an active member of staff."],
    ];
    for (const [code, text] of cases) expect(careErrorText(err(code))).toBe(text);
    expect(careErrorText(err("invalid_transition"), { from: "cancelled", to: "active" })).toBe(
      "A care plan can't move from Cancelled to Active.",
    );
    expect(invalidCareTransition("paused", "paused")).toBe("A care plan can't move from Paused to Paused.");
    // An unworded code shows the server's words, marked.
    expect(careErrorText(err("conflict", "The entry could not be saved. Reload and try again"))).toBe(
      `The entry could not be saved. Reload and try again.`,
    );
    expect(careErrorText(new Error("x"))).toBe(
      "Couldn't reach the server. Check your connection and try again.",
    );
  });
});

describe("07-Q lines carry no placeholder tag", () => {
  it("every sentence 07-M lacked has its 07-Q words, with no tag", () => {
    const all = [
      ...(Object.values(CARE_PENDING).filter((v) => typeof v === "string") as string[]),
      CARE_PENDING.serverWords("x"),
      ...(Object.values(TIME_PENDING).filter((v) => typeof v === "string") as string[]),
      TIME_PENDING.targetsFound(2),
      ...Object.values(ACTIVITY_PENDING),
    ];
    for (const s of all) expect(s.includes(PLACEHOLDER_TAG)).toBe(false);
    expect(TIME_PENDING.noteTooLong).toBe("Keep the note to 1,000 characters or fewer.");
  });

  it("activity in words: approved labels, then marked placeholders, then the name itself", () => {
    expect(activityText("project.create")).toBe("added a project");
    expect(activityText("care_plan.terms")).toBe(`changed a care plan's terms`);
    expect(activityText("constructor")).toBe("constructor");
    expect(activityHref("care_plan", "cp 1")).toBe("/care-plans/cp%201");
    expect(activityHref("lead", "l1")).toBe("/leads/l1");
    expect(activityHref("time_log", "t1")).toBeNull();
    expect(activityHref("toString", "x")).toBeNull();
  });
});

describe("hours", () => {
  it("as words and as a timesheet cell", () => {
    expect([hoursText(0), hoursText(45), hoursText(60), hoursText(135), hoursText(1440)]).toEqual([
      "0 min",
      "45 min",
      "1 h",
      "2 h 15 min",
      "24 h",
    ]);
    expect([clockText(45), clockText(135), clockText(600)]).toEqual(["0:45", "2:15", "10:00"]);
  });

  it("the bar fills to the hours available and stops at full; the tone follows the flag", () => {
    expect(hoursBar({ used: 300, available: 600, flag: "none" })).toEqual({ pct: 50, tone: "calm" });
    expect(hoursBar({ used: 485, available: 600, flag: "near" })).toEqual({ pct: 80, tone: "near" });
    expect(hoursBar({ used: 780, available: 600, flag: "reached" })).toEqual({ pct: 100, tone: "reached" });
    expect(hoursBar({ used: 60, available: 0, flag: "none" })).toEqual({ pct: 0, tone: "calm" });
    expect([flagText("none"), flagText("near"), flagText("reached")]).toEqual([
      null,
      "Near the limit",
      "Limit reached",
    ]);
  });

  it("durations are whole 15-minute steps", () => {
    expect(durationMinutes({ hours: "", minutes: "0" }, 2000)).toBe(0);
    expect(durationMinutes({ hours: "10", minutes: "15" }, 2000)).toBe(615);
    expect(durationMinutes({ hours: "1.5", minutes: "0" }, 2000)).toBeNull();
    expect(durationMinutes({ hours: "2001", minutes: "0" }, 2000)).toBeNull();
    expect(durationMinutes({ hours: "1", minutes: "10" }, 2000)).toBeNull();
  });
});

describe("the plan rules shown before asking", () => {
  const plan = { billingDay: 5, startDate: "2026-11-05" };
  it("a status change from today or the start date; new terms from the next period (owner's Q1)", () => {
    expect(statusDate("2026-11-20", plan)).toBe("2026-11-20");
    expect(statusDate("2026-10-20", plan)).toBe("2026-11-05");
    expect(termsDate("2026-11-20", plan)).toBe("2026-12-05");
    expect(termsDate("2026-10-20", plan)).toBe("2026-11-05");
  });
  it("cancelling is the owner's; cancelled is terminal", () => {
    expect(careMoves("active", true)).toEqual(["paused", "cancelled"]);
    expect(careMoves("active", false)).toEqual(["paused"]);
    expect(careMoves("paused", false)).toEqual(["active"]);
    expect(careMoves("cancelled", true)).toEqual([]);
  });
});

describe("the new plan form", () => {
  it("prefills the catalogue's values for a tier and leaves the undecided empty", () => {
    const f = planFormFor("essential", defaults, { startDate: "2026-11-01" });
    expect(f).toMatchObject({ tier: "essential", price: "9,999", rollover: "none", startDate: "2026-11-01" });
    expect(f.included).toEqual({ hours: "2", minutes: "0" });
    const g = planFormFor("growth", defaults);
    expect(g.included).toEqual({ hours: "", minutes: "0" });
    expect(g.overageRate).toBe("");
    expect(planFormFor("scale", defaults).price).toBe("");
  });

  it("makes the API's body in minor units, or says what is missing", () => {
    const f = {
      ...planFormFor("growth", defaults, { startDate: "2026-11-01", billingDay: "5" }),
      overageRate: "1,500",
    };
    const r = planInput(f, "c1", "INR", {});
    expect(r).toEqual({
      ok: true,
      body: {
        clientId: "c1",
        tier: "growth",
        priceMinor: 2_499_900,
        includedMinutes: 0,
        aiOpsMinor: null,
        overageRateMinor: 150_000,
        rollover: "one_month",
        startDate: "2026-11-01",
        billingDay: 5,
      },
    });
    const bad = planInput({ ...f, price: "", billingDay: "29", startDate: "" }, "c1", "INR", {});
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.price).toBe(CARE_PENDING.enterPrice);
      expect(bad.errors.billingDay).toBe(CARE_PENDING.enterBillingDay);
      expect(bad.errors.startDate).toBe(CARE_PENDING.enterStartDate);
    }
    // Review of the fixes, finding 1, and re-check L6: unread text blocks the save, whatever valid date the form still holds.
    const unread = planInput(f, "c1", "INR", { startDate: true });
    expect(unread.ok).toBe(false);
    if (!unread.ok) expect(unread.errors.startDate).toBe(DATE_INVALID);
  });
});

describe("the terms change (owner)", () => {
  const now = terms();
  const pending = terms({ effectiveFrom: "2026-12-01", priceMinor: 3_000_000 });
  it("is laid over the newest terms: the booked change when there is one", () => {
    expect(newestTerms({ current: now, pending })).toBe(pending);
    expect(newestTerms({ current: now, pending: null })).toBe(now);
  });

  it("sends only what changed, with a before-and-after summary for the confirmation", () => {
    const f = { ...termsFormOf(now, "INR"), price: "30,000", included: { hours: "12", minutes: "0" } };
    const r = termsChange(f, now, "INR");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body).toEqual({ priceMinor: 3_000_000, includedMinutes: 720 });
      expect(r.changes).toEqual([
        { field: "Price per month", from: "₹25,000.00", to: "₹30,000.00" },
        { field: "Included hours", from: "10 h", to: "12 h" },
      ]);
    }
  });

  it("removing the rate and adding AI Ops are changes too; nothing changed is an empty change", () => {
    const f = { ...termsFormOf(now, "INR"), overageRate: "", aiOps: true, aiOpsPrice: "5,000" };
    const r = termsChange(f, now, "INR");
    expect(r.ok && r.body).toEqual({ aiOpsMinor: 500_000, overageRateMinor: null });
    const same = termsChange(termsFormOf(now, "INR"), now, "INR");
    expect(same.ok && same.changes).toEqual([]);
  });
});

describe("the time entry", () => {
  const ctx = { today: "2026-10-25", canWriteAny: false, me: "u1", unread: {} };
  const base = { ...entryFormOf(null, "2026-10-25", "u1"), hours: "1", minutes: "30" };
  const target = { kind: "project" as const, id: "p1", code: "PRJ-0001", label: "PRJ-0001" };

  it("minutes: 15-minute steps from 15 minutes to 24 hours", () => {
    expect(entryMinutes({ hours: "", minutes: "15" })).toBe(15);
    expect(entryMinutes({ hours: "24", minutes: "0" })).toBe(1440);
    expect(entryMinutes({ hours: "24", minutes: "15" })).toBeNull();
    expect(entryMinutes({ hours: "0", minutes: "0" })).toBeNull();
    expect(entryMinutes({ hours: "1", minutes: "20" })).toBeNull();
  });

  it("dates: no future date; more than 7 days back is the owner's", () => {
    const at = (workDate: string, canWriteAny = false) =>
      entryInput({ ...base, target, workDate }, { ...ctx, canWriteAny });
    expect(at("2026-10-26")).toMatchObject({
      ok: false,
      errors: { workDate: "Time can't be logged for a future date." },
    });
    expect(at("2026-10-17")).toMatchObject({
      ok: false,
      errors: { workDate: "Only the owner can log time more than 7 days back." },
    });
    expect(at("2026-10-18").ok).toBe(true);
    expect(at("2026-10-01", true).ok).toBe(true);
    expect(earliestDate("2026-10-25", false)).toBe("2026-10-18");
    expect(earliestDate("2026-10-25", true)).toBeUndefined();
  });

  it("a date that can't be read gets the owner's line; a cleared one still says to enter it (review of the fixes, finding 1)", () => {
    // As the form gets it from the field: the last valid date (here the default, today) and the report that the text is unread.
    const at = (typed: string) =>
      entryInput(
        { ...base, target, workDate: settledValue(typed) ?? base.workDate },
        { ...ctx, unread: isUnread(typed) ? { workDate: true } : {} },
      );
    expect(at("31/02/2026")).toMatchObject({ ok: false, errors: { workDate: DATE_INVALID } });
    expect(at("25/10/26")).toMatchObject({ ok: false, errors: { workDate: DATE_INVALID } });
    expect(at("")).toMatchObject({ ok: false, errors: { workDate: TIME_PENDING.enterDate } });
    expect(at("25/10/2026").ok).toBe(true);
  });

  it("editing: the date rule applies only when the date was changed (a 7-day edit window keeps its old date) [review fix 2]", () => {
    const old = "2026-10-17"; // 8 days back: not allowed for a new entry by Staff, but the saved date may stay
    const edit = (workDate: string) =>
      entryInput({ ...base, target, workDate }, { ...ctx, originalDate: old });
    expect(edit(old).ok).toBe(true);
    expect(edit("2026-10-16")).toMatchObject({
      ok: false,
      errors: { workDate: "Only the owner can log time more than 7 days back." },
    });
    expect(edit("2026-10-26").ok).toBe(false);
    expect(entryInput({ ...base, target, workDate: old }, ctx).ok).toBe(false); // a new entry: no original
  });

  it("needs a project or a care plan, and sends exactly one", () => {
    expect(entryInput(base, ctx)).toMatchObject({
      ok: false,
      errors: { target: "Choose a project or a care plan." },
    });
    const r = entryInput({ ...base, target, note: "  Fixed the form (sample)  " }, ctx);
    expect(r).toEqual({
      ok: true,
      body: {
        workDate: "2026-10-25",
        minutes: 90,
        projectId: "p1",
        note: "Fixed the form (sample)",
        billable: true,
      },
    });
    const plan = entryInput(
      { ...base, target: { kind: "plan", id: "cp1", code: "C0001", label: "Care plan C0001" }, userId: "u2" },
      { ...ctx, canWriteAny: true },
    );
    expect(plan.ok && plan.body).toMatchObject({ userId: "u2", carePlanId: "cp1" });
    expect(plan.ok && "projectId" in plan.body).toBe(false);
  });

  it("the lock: the API's canEdit decides; the owner's override is said; the accountant reads", () => {
    const day = 86_400_000;
    const staff = { canWriteOwn: true, canWriteAny: false };
    const owner = { canWriteOwn: true, canWriteAny: true };
    const accountant = { canWriteOwn: false, canWriteAny: false };
    expect(lockState(entry({ canEdit: true, createdAt: 0 }), staff, 6 * day)).toBe("open");
    expect(lockState(entry({ canEdit: false, createdAt: 0 }), staff, 7 * day)).toBe("locked");
    expect(lockState(entry({ canEdit: true, createdAt: 0 }), owner, 7 * day - 1)).toBe("open");
    expect(lockState(entry({ canEdit: true, createdAt: 0 }), owner, 7 * day)).toBe("override");
    expect(lockState(entry({ canEdit: false }), accountant)).toBe("readonly");
  });
});

describe("the timesheet", () => {
  it("weeks run Monday to Sunday", () => {
    expect(weekStartFrom(null, "2026-10-25")).toBe("2026-10-19");
    expect(weekStartFrom("2026-10-21", "2026-10-25")).toBe("2026-10-19");
    expect(weekStartFrom("2026-10-12", "2026-10-25")).toBe("2026-10-12");
    expect(weekDays("2026-10-26")).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    expect([previousWeek("2026-10-26"), nextWeek("2026-10-26")]).toEqual(["2026-10-19", "2026-11-02"]);
  });

  it("rows by person and target, the API's minutes placed by day", () => {
    const g = (over: Partial<TimeWeekGroup>): TimeWeekGroup => ({
      userId: "u1",
      userName: "Asha (sample)",
      projectId: "p1",
      projectCode: "PRJ-0001",
      carePlanId: null,
      carePlanClientCode: null,
      workDate: "2026-10-26",
      minutes: 60,
      billableMinutes: 60,
      entries: 1,
      ...over,
    });
    const rows = sheetRows([
      g({}),
      g({ workDate: "2026-10-27", minutes: 30, billableMinutes: 0 }),
      g({ projectId: null, projectCode: null, carePlanId: "cp1", carePlanClientCode: "C0001", minutes: 45 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map(rowTotal)).toEqual([45, 90]);
    expect(rows[1]?.days).toEqual({ "2026-10-26": 60, "2026-10-27": 30 });
    expect(
      targetOf({
        projectId: null,
        projectCode: null,
        carePlanId: "cp1",
        carePlanClientCode: "C0001",
        carePlanTier: "scale",
      }),
    ).toMatchObject({ kind: "plan", label: "Care plan C0001 (Scale)" });
  });
});

describe("the CSV export", () => {
  it("has the 07-M columns and defuses cells that a spreadsheet would run as formulas", () => {
    const csv = timeCsv([
      entry({ note: '=HYPERLINK("http://example.test")' }),
      entry({ id: "t2", note: "+1 then -1 @home", userName: "@Sample (sample)", billable: false }),
      entry({
        id: "t3",
        note: "-cmd",
        projectId: null,
        projectCode: null,
        carePlanId: "cp1",
        carePlanClientCode: "C0001",
      }),
      entry({ id: "t4", note: "Line one\nline two, with a comma" }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Date,Person,Project or care plan,Minutes,Billable,Note");
    expect(lines[1]).toBe(
      `2026-10-20,Sample Staff (sample),PRJ-0001,90,Yes,"'=HYPERLINK(""http://example.test"")"`,
    );
    expect(lines[2]).toBe("2026-10-20,'@Sample (sample),PRJ-0001,90,No,'+1 then -1 @home");
    expect(lines[3]).toBe("2026-10-20,Sample Staff (sample),Care plan C0001,90,Yes,'-cmd");
    expect(csv).toContain('"Line one\nline two, with a comma"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("the range: both dates, in order, at most 366 days", () => {
    expect(exportRangeOk("2026-10-19", "2026-10-25")).toBe(true);
    expect(exportRangeOk("2026-10-25", "2026-10-19")).toBe(false);
    expect(exportRangeOk("2025-10-25", "2026-10-26")).toBe(true);
    expect(exportRangeOk("2025-10-24", "2026-10-26")).toBe(false);
    expect(exportRangeOk("", "2026-10-26")).toBe(false);
  });
});
