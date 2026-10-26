// The words and the pure rules of the M3.5 time screens (ADM-TIME-01..03): 07-M copy word for word, the week (Monday to Sunday,
// IST dates), the timesheet grid built from the API's groups, the entry form (15-minute steps, at most 24 hours), the lock state
// and the CSV export, built in the browser from GET /time pages, with every cell defused against spreadsheet formulas.
// Pure, so the copy and the rules are tested without a browser. Copy rules as in lib/care.ts (07-M is a draft; placeholders are
// tagged and listed).
import { addDays, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { authorLocked, DAY_CAP, entryDateCheck, LOCK_DAYS, TIME_STEP, weekOf } from "@techaust/core/time";
import type { CareTier, NewTimeInput, TimeEntry, TimeWeekGroup } from "../api.ts";
import { csvCell } from "./audit.ts";
import { CODE_COPY, dayText, TIER_LABELS } from "./care.ts";
import { intIn } from "./settings-form.ts";

// ---- 07-M copy, word for word (draft, pending the owner) -----------------------------------------------------------------

export const TIME_COPY = {
  total: "Total",
  billable: "Billable",
  nonBillable: "Non-billable",
  minutesHint: "Minutes in steps of 15, up to 24 hours a day.",
  targetHint: "Choose a project or a care plan.",
  logFor: "Log time for",
  locked: "Entries lock 7 days after they're made. Only the owner can change them after that.",
  ownerOverride: "This entry is locked for its author. Your change is recorded in the audit log.",
  emptyWeek: "No time logged this week.",
} as const;

export const weekHeading = (start: string) => `Week of ${dayText(start)}`;

export const TIME_TOASTS = {
  logged: "Time logged.",
  saved: "Time entry saved.",
  deleted: "Time entry deleted.",
} as const;

/** 07-M CSV columns, in order. */
export const CSV_COLUMNS = ["Date", "Person", "Project or care plan", "Minutes", "Billable", "Note"] as const;

// ---- placeholders (not in 07-M; each listed in the designer report) --------------------------------------------------------

export const TIME_PENDING = {
  staleEntry: "Someone else changed this time entry.",
  deleteConfirm: "Delete this time entry? This can't be undone.",
  enterDate: "Enter the date.",
  enterTime: "Enter the time spent, in steps of 15 minutes.",
  noTargetMatch: "No project or care plan starts with that.",
  targetsFound: (n: number) => `${n} ${n === 1 ? "match" : "matches"} found`,
  exportRange: "Choose dates no more than 366 days apart, the first before the second.",
  noteTooLong: "Keep the note to 1,000 characters or fewer.",
  truncated: "This week has more rows than the timesheet shows. Filter by person or target to see them all.",
} as const;

// ---- the week ----------------------------------------------------------------------------------------------------------------

const shift = (iso: string, days: number) => {
  const d = parseIsoDate(iso);
  return d ? toIsoDate(addDays(d, days)) : iso;
};

export { weekOf };
/** The seven IST dates of the week that starts on `monday`. */
export const weekDays = (monday: string): string[] => Array.from({ length: 7 }, (_, i) => shift(monday, i));
export const previousWeek = (monday: string) => shift(monday, -7);
export const nextWeek = (monday: string) => shift(monday, 7);
/** A Monday from the URL, or the week of today when it isn't one. */
export function weekStartFrom(param: string | null, today: string): string {
  if (param && parseIsoDate(param) && weekOf(param).start === param) return param;
  return weekOf(today).start;
}

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const WEEKDAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
/** "Mon 26" for a grid column, with the long form for screen readers. */
export function dayHead(iso: string, index: number): { short: string; long: string } {
  const d = parseIsoDate(iso);
  return {
    short: `${WEEKDAY[index] ?? ""} ${d ? d.day : ""}`,
    long: `${WEEKDAY_LONG[index] ?? ""} ${dayText(iso)}`,
  };
}

// ---- targets -----------------------------------------------------------------------------------------------------------------

export type TargetRef =
  | { kind: "project"; id: string; code: string; label: string }
  | { kind: "plan"; id: string; code: string; label: string };

/** "PRJ-0001" or "Care plan C0001 (Growth)": what an entry or a timesheet row was logged on. */
export function targetOf(
  g: Pick<TimeWeekGroup, "projectId" | "projectCode" | "carePlanId" | "carePlanClientCode"> & {
    carePlanTier?: CareTier | null;
  },
): TargetRef | null {
  if (g.projectId)
    return { kind: "project", id: g.projectId, code: g.projectCode ?? "", label: g.projectCode ?? "" };
  if (g.carePlanId) {
    const tier = g.carePlanTier ? ` (${TIER_LABELS[g.carePlanTier]})` : "";
    const code = g.carePlanClientCode ?? "";
    return { kind: "plan", id: g.carePlanId, code, label: `Care plan ${code}${tier}` };
  }
  return null;
}

// ---- the timesheet grid ------------------------------------------------------------------------------------------------------

export type SheetRow = {
  key: string;
  userId: string;
  userName: string | null;
  target: TargetRef | null;
  /** Minutes by IST date. */
  days: Record<string, number>;
  /** The API's own sums for each date (a row's total is read off the same groups the API sent). */
  billable: Record<string, number>;
};

/** One row per person and target, the days of the week across (the API's groups, laid out; nothing is recomputed but placement). */
export function sheetRows(groups: readonly TimeWeekGroup[]): SheetRow[] {
  const rows = new Map<string, SheetRow>();
  for (const g of groups) {
    const key = `${g.userId}|${g.projectId ?? ""}|${g.carePlanId ?? ""}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, userId: g.userId, userName: g.userName, target: targetOf(g), days: {}, billable: {} };
      rows.set(key, row);
    }
    row.days[g.workDate] = (row.days[g.workDate] ?? 0) + g.minutes;
    row.billable[g.workDate] = (row.billable[g.workDate] ?? 0) + g.billableMinutes;
  }
  return [...rows.values()].sort(
    (a, b) =>
      (a.userName ?? "").localeCompare(b.userName ?? "") ||
      a.userId.localeCompare(b.userId) ||
      (a.target?.label ?? "").localeCompare(b.target?.label ?? ""),
  );
}

/** A row's total minutes over the week. */
export const rowTotal = (r: SheetRow) => Object.values(r.days).reduce((n, m) => n + m, 0);

// ---- the entry form ----------------------------------------------------------------------------------------------------------

export type EntryForm = {
  userId: string;
  workDate: string;
  hours: string;
  minutes: string;
  target: TargetRef | null;
  billable: boolean;
  note: string;
};

export const entryFormOf = (e: TimeEntry | null, today: string, me: string): EntryForm => ({
  // "" is the viewer themselves (the API's default); the owner may pick someone else.
  userId: e?.userId ?? (me || ""),
  workDate: e?.workDate ?? today,
  hours: e ? String(Math.trunc(e.minutes / 60)) : "",
  minutes: e ? String(e.minutes % 60) : "0",
  target: e ? targetOf(e) : null,
  billable: e?.billable ?? true,
  note: e?.note ?? "",
});

export type EntryErrors = Partial<Record<"workDate" | "hours" | "target" | "note", string>>;

/** Minutes from the hours and quarter fields: a whole number of 15-minute steps from 15 minutes to 24 hours, or null. */
export function entryMinutes(f: Pick<EntryForm, "hours" | "minutes">): number | null {
  const h = f.hours.trim() === "" ? 0 : intIn(f.hours, 0, 24);
  const m = intIn(f.minutes, 0, 45);
  if (h === null || m === null || m % TIME_STEP !== 0) return null;
  const total = h * 60 + m;
  return total >= TIME_STEP && total <= DAY_CAP ? total : null;
}

/** The checks the browser makes before sending (the API checks every one again). */
export function entryInput(
  f: EntryForm,
  /** `originalDate`, when editing: the saved date. The date rule applies only if the date changed. */
  ctx: { today: string; canWriteAny: boolean; me: string; originalDate?: string | undefined },
): { ok: true; body: NewTimeInput } | { ok: false; errors: EntryErrors } {
  const errors: EntryErrors = {};
  if (!parseIsoDate(f.workDate)) errors.workDate = TIME_PENDING.enterDate;
  else if (f.workDate !== ctx.originalDate) {
    const check = entryDateCheck({ today: ctx.today, workDate: f.workDate, canWriteAny: ctx.canWriteAny });
    if (check === "future") errors.workDate = CODE_COPY.future_date as string;
    if (check === "owner_only_date") errors.workDate = CODE_COPY.owner_only_date as string;
  }
  const minutes = entryMinutes(f);
  if (minutes === null) errors.hours = TIME_PENDING.enterTime;
  if (!f.target) errors.target = TIME_COPY.targetHint;
  if (f.note.length > 1000) errors.note = TIME_PENDING.noteTooLong;
  if (Object.keys(errors).length || minutes === null || !f.target) return { ok: false, errors };
  const note = f.note.trim();
  return {
    ok: true,
    body: {
      ...(f.userId && f.userId !== ctx.me ? { userId: f.userId } : {}),
      workDate: f.workDate,
      minutes,
      ...(f.target.kind === "project" ? { projectId: f.target.id } : { carePlanId: f.target.id }),
      note: note || null,
      billable: f.billable,
    },
  };
}

/** The earliest date a person may pick: 7 days back, or none for the owner. */
export const earliestDate = (today: string, canWriteAny: boolean) =>
  canWriteAny ? undefined : shift(today, -LOCK_DAYS);

// ---- the lock ----------------------------------------------------------------------------------------------------------------

/**
 * How an entry stands for the viewer: `open` (theirs to change), `locked` (the author's 7 days are over and the viewer can't
 * override), `override` (locked for the author, but the owner may still change it and the audit log records it), or `readonly`
 * (the accountant, who reads everyone's time and writes none). The API's `canEdit` decides; a viewer who logs only their own time
 * sees only their own entries (the API scopes them), so an entry they can't edit is one their lock has closed.
 */
export function lockState(
  e: Pick<TimeEntry, "canEdit" | "createdAt">,
  viewer: { canWriteOwn: boolean; canWriteAny: boolean },
  now = Date.now(),
): "open" | "locked" | "override" | "readonly" {
  if (e.canEdit) return viewer.canWriteAny && authorLocked(e.createdAt, now) ? "override" : "open";
  return viewer.canWriteOwn && !viewer.canWriteAny ? "locked" : "readonly";
}

// ---- the CSV export ------------------------------------------------------------------------------------------------------------

/** A CSV of entries (07-M columns), every cell defused: a value starting with = + - @ (or a tab or return) gets a leading quote. */
export function timeCsv(entries: readonly TimeEntry[]): string {
  const rows = entries.map((e) => [
    e.workDate,
    e.userName ?? "",
    targetOf(e)?.label ?? "",
    String(e.minutes),
    e.billable ? "Yes" : "No",
    e.note ?? "",
  ]);
  return `${[[...CSV_COLUMNS], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** The export range check: both dates, in order, at most 366 days apart (the API's limit). */
export function exportRangeOk(from: string, to: string): boolean {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b || from > to) return false;
  return Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day) <= 366 * 86_400_000;
}
